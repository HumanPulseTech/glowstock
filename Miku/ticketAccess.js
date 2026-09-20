const { getPool } = require('./db.js');

const TICKET_STATUSES = Object.freeze({
    non_traite: 'Non traité',
    en_cours: 'En cours',
    traite: 'Traité',
    reclamation: 'Réclamation',
    termine: 'Terminé'
});

const TICKET_TEAMS = Object.freeze({
    dev: 'Développement',
    sav: 'Service après-vente',
    contentieux: 'Contentieux',
    fondateur: 'Fondateur'
});

const TICKET_CATEGORIES = Object.freeze({
    bug: 'Bug',
    abonnement: 'Problème d’abonnement'
});

const cleanText = (value, max = 5000) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const isStatus = (value) => Object.prototype.hasOwnProperty.call(TICKET_STATUSES, value);
const isTeam = (value) => Object.prototype.hasOwnProperty.call(TICKET_TEAMS, value);
const isCategory = (value) => Object.prototype.hasOwnProperty.call(TICKET_CATEGORIES, value);
const positiveId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

function parsePermissions(value) {
    try {
        const permissions = typeof value === 'string' ? JSON.parse(value || '[]') : value;
        return Array.isArray(permissions) ? permissions : [];
    } catch {
        return [];
    }
}

async function getTicketAccess(connection, userId) {
    const rows = await connection.query(
        'SELECT u.id, u.role, u.ticket_team, r.permissions FROM users u LEFT JOIN roles r ON r.slug = u.role WHERE u.id = ?',
        [userId]
    );
    if (!rows[0]) return null;
    const permissions = parsePermissions(rows[0].permissions);
    const isFounder = rows[0].role === 'fondateur' || rows[0].ticket_team === 'fondateur';
    if (isFounder) permissions.push('tickets_view', 'tickets_manage', 'tickets_assign', 'tickets_all');
    const normalizedTeam = String(rows[0].ticket_team ?? '').trim().toLowerCase();
    const team = isTeam(normalizedTeam) ? normalizedTeam : null;
    // Une équipe attribuée cloisonne toujours les tickets. La vue globale est
    // réservée au fondateur, ou à un compte sans équipe explicitement autorisé.
    const canSeeAll = isFounder || (!team && permissions.includes('tickets_all'));
    return {
        userId: Number(rows[0].id),
        role: rows[0].role,
        team,
        permissions: [...new Set(permissions)],
        canView: permissions.includes('tickets_view'),
        canManage: permissions.includes('tickets_manage'),
        canAssign: permissions.includes('tickets_assign'),
        canSeeAll
    };
}

function ticketScope(access, alias = 't') {
    if (access.canSeeAll) return { sql: '', params: [] };
    if (access.team) return { sql: ` WHERE ${alias}.equipe = ?`, params: [access.team] };
    return { sql: ' WHERE 1 = 0', params: [] };
}

function normalizeTicketUpdate(input = {}) {
    const status = isStatus(input.status) ? input.status : null;
    const team = isTeam(input.team) ? input.team : null;
    const assigneeId = input.assigneeId === '' || input.assigneeId === null || input.assigneeId === undefined
        ? null
        : positiveId(input.assigneeId);
    const cost = input.cost === '' || input.cost === null || input.cost === undefined ? null : Number(input.cost);
    const minutes = input.minutes === '' || input.minutes === null || input.minutes === undefined ? null : Number(input.minutes);
    return {
        status,
        team,
        assigneeId,
        cost: cost !== null && Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 100) / 100 : null,
        minutes: minutes !== null && Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : null,
        note: cleanText(input.note, 5000)
    };
}

async function getPoolConnection() {
    return (await getPool()).getConnection();
}

module.exports = {
    TICKET_STATUSES,
    TICKET_TEAMS,
    TICKET_CATEGORIES,
    cleanText,
    parsePermissions,
    isStatus,
    isTeam,
    isCategory,
    positiveId,
    getTicketAccess,
    ticketScope,
    normalizeTicketUpdate,
    getPoolConnection
};
