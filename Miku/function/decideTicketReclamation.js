const serverLogger = require('../serverLogger.js');
const logError = require('./logError.js');
const {
    getTicketAccess,
    getPoolConnection,
    positiveId,
    cleanText,
    isStatus,
    isTeam
} = require('../ticketAccess.js');

const DECISIONS = new Set(['reouvrir', 'maintenir', 'modifier']);

module.exports = async function decideTicketReclamation(input, socket) {
    let connection;
    const userId = socket.request.session?.userId;
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const ticketId = positiveId(input?.ticketId);
        const decision = String(input?.decision || '').trim();
        const note = cleanText(input?.note, 5000);
        if (!ticketId || !DECISIONS.has(decision) || !note) return socket.emit('ticket reclamation error', 'Choisis une décision et ajoute une explication.');

        connection = await getPoolConnection();
        const access = await getTicketAccess(connection, userId);
        const isFounder = access?.role === 'fondateur' || access?.team === 'fondateur';
        if (!access?.canManage || !isFounder) {
            return socket.emit('ticket reclamation error', 'Seul le fondateur peut décider de la suite d’une réclamation.');
        }

        await connection.beginTransaction();
        const rows = await connection.query(
            `SELECT id, titre, statut, reclamation_previous_team, reclamation_previous_status,
                    reclamation_previous_assignee_id
             FROM tickets WHERE id = ? FOR UPDATE`,
            [ticketId]
        );
        const ticket = rows[0];
        if (!ticket || ticket.statut !== 'reclamation') {
            await connection.rollback();
            return socket.emit('ticket reclamation error', 'Ce ticket n’est pas en attente de décision.');
        }

        const previousTeam = isTeam(ticket.reclamation_previous_team) ? ticket.reclamation_previous_team : 'dev';
        let targetStatus;
        if (decision === 'reouvrir') targetStatus = 'en_cours';
        else if (decision === 'maintenir') targetStatus = 'termine';
        else targetStatus = isStatus(input?.status) && input.status !== 'reclamation' ? input.status : null;
        if (!targetStatus) {
            await connection.rollback();
            return socket.emit('ticket reclamation error', 'Choisis un nouvel état pour modifier la décision.');
        }

        const targetTeam = isTeam(input?.team) && input.team !== 'fondateur' ? input.team : previousTeam;
        const resolvedAt = targetStatus === 'termine' ? 'NOW()' : 'NULL';
        await connection.query(
            `UPDATE tickets
             SET statut = ?, equipe = ?, assigne_id = NULL,
                 resolved_at = ${resolvedAt}, reclamation_decision = ?,
                 reclamation_decision_note = ?, reclamation_decidee_par = ?, reclamation_decidee_at = NOW()
             WHERE id = ? AND statut = 'reclamation'`,
            [targetStatus, targetTeam, decision, note, userId, ticketId]
        );
        await connection.query(
            `INSERT INTO ticket_updates (ticket_id, user_id, action, contenu, statut, equipe, assigne_id, meta)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [ticketId, userId, 'reclamation_decision', note, targetStatus, targetTeam, null, JSON.stringify({ decision, previousStatus: ticket.reclamation_previous_status, targetStatus, targetTeam })]
        );
        await connection.commit();
        void serverLogger.info('ticket.reclamation_decided', 'Décision de réclamation enregistrée.', { ticketId, decision, targetStatus, targetTeam }, { userId, socketId: socket.id });
        socket.emit('ticket reclamation decided', { ticketId, decision, status: targetStatus });
        socket.emit('ticket updated', { ticketId });
        socket.broadcast.emit('ticket updated', { ticketId });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        const context = { code: error?.code || null, message: error?.message || null };
        void serverLogger.error('ticket.reclamation_decision_failed', 'Erreur lors de la décision de réclamation.', context, { userId, socketId: socket.id });
        void logError(userId || null, 'ticket_reclamation_decision', 'Impossible d’enregistrer la décision de réclamation.', context);
        socket.emit('ticket reclamation error', error?.code === 'ER_BAD_FIELD_ERROR' ? 'La migration des réclamations manque en base. Applique la migration 009.' : 'Impossible d’enregistrer la décision.');
    } finally {
        if (connection) connection.release();
    }
};
