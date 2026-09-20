const { getPool } = require('./db.js');
const serverLogger = require('./serverLogger.js');

let creationQueue = Promise.resolve();

const cleanText = (value, max = 10000) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);
const sensitiveKey = /(password|pass|secret|token|cookie|authorization|auth|api[_-]?key|credit|card)/i;

function safeValue(value, key = '', depth = 0) {
    if (sensitiveKey.test(key)) return '[masqué]';
    if (value === null || value === undefined) return value;
    if (value instanceof Error) return { name: cleanText(value.name, 100), message: cleanText(value.message, 1000) };
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= 3) return '[objet tronqué]';
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, key, depth + 1));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([childKey, childValue]) => [childKey, safeValue(childValue, childKey, depth + 1)]));
    return cleanText(value, 200);
}

async function performAutoTicket({ userId = null, type = 'server', message = 'Erreur technique', context = null, errorLogId = null } = {}) {
    let connection;
    try {
        const pool = await getPool();
        connection = await pool.getConnection();
        const devUsers = await connection.query(
            'SELECT u.id FROM users u LEFT JOIN roles r ON r.slug = u.role WHERE u.ticket_team = ? AND (u.ticket_team = ? OR JSON_VALID(r.permissions) AND JSON_CONTAINS(r.permissions, JSON_QUOTE(?))) ORDER BY u.id ASC LIMIT 1',
            ['dev', 'fondateur', 'tickets_view']
        );
        const assigneeId = devUsers[0]?.id ? Number(devUsers[0].id) : null;
        const description = [
            `Incident automatique détecté (${cleanText(type, 80)}).`,
            `Message : ${cleanText(message, 2000)}`,
            `Déclenché par le compte : ${userId || 'système'}.`,
            errorLogId ? `Journal incident n°${errorLogId}.` : '',
            context ? `Contexte : ${cleanText(JSON.stringify(safeValue(context)), 6000)}` : ''
        ].filter(Boolean).join('\n');
        await connection.beginTransaction();
        const result = await connection.query(
            'INSERT INTO tickets (titre, description, categorie, equipe, statut, demandeur_id, assigne_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ['auto-ticket', description, 'bug', 'dev', 'non_traite', userId || null, assigneeId]
        );
        const ticketId = Number(result.insertId);
        await connection.query(
            'INSERT INTO ticket_updates (ticket_id, user_id, action, contenu, statut, equipe, assigne_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [ticketId, userId || null, 'creation', description, 'non_traite', 'dev', assigneeId, JSON.stringify({ automatic: true, category: 'bug', sourceType: type, errorLogId })]
        );
        await connection.commit();
        void serverLogger.info('ticket.auto_created', 'Auto-ticket créé après une erreur technique.', { ticketId, type, assigneeId }, { userId: userId || undefined });
        return ticketId;
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        // Une erreur de création d’auto-ticket ne doit jamais masquer l’erreur d’origine.
        console.warn('[Serveur][Tickets] Impossible de créer l’auto-ticket :', error?.message || error);
        return null;
    } finally {
        if (connection) connection.release();
    }
}

function createAutoTicket(options = {}) {
    const job = creationQueue.then(() => performAutoTicket(options));
    creationQueue = job.catch(() => null);
    return job;
}

module.exports = { createAutoTicket };
