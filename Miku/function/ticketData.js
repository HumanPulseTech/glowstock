const serverLogger = require('../serverLogger.js');
const logError = require('./logError.js');
const {
    TICKET_STATUSES,
    TICKET_TEAMS,
    TICKET_CATEGORIES,
    getTicketAccess,
    getPoolConnection,
    positiveId,
    isStatus,
    parsePermissions
} = require('../ticketAccess.js');

const socketSafe = (value) => {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(socketSafe);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, socketSafe(child)]));
    return value;
};

module.exports = async function ticketData(socket, request = {}) {
    let connection;
    const userId = socket.request.session?.userId;
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        connection = await getPoolConnection();
        const access = await getTicketAccess(connection, userId);
        if (!access) return socket.emit('auth error', 'Session expirée.');

        // Chaque compte suit ses propres tickets. Les membres d'une équipe voient
        // également les tickets de cette équipe, tandis que le fondateur voit tout.
        const scope = access.canSeeAll
            ? { sql: '', params: [] }
            : access.canView && access.team
                ? { sql: ' WHERE (t.equipe = ? OR t.demandeur_id = ?)', params: [access.team, userId] }
                : { sql: ' WHERE t.demandeur_id = ?', params: [userId] };
        const status = isStatus(request?.status) ? request.status : null;
        const statusClause = status ? `${scope.sql ? ' AND' : ' WHERE'} t.statut = ?` : '';
        const params = [...scope.params];
        if (status) params.push(status);
        const tickets = await connection.query(
            `SELECT t.id, t.titre, t.description, t.categorie, t.equipe, t.statut, t.demandeur_id, t.assigne_id, t.cout_total, t.temps_total_minutes, t.created_at, t.updated_at, t.resolved_at,
                    t.reclamation_utilisee_at, t.reclamation_message, t.reclamation_decision, t.reclamation_decision_note, t.reclamation_decidee_at,
                    requester.nom AS demandeur_nom, requester.email AS demandeur_email,
                    assignee.nom AS assigne_nom, assignee.email AS assigne_email
             FROM tickets t
             LEFT JOIN users requester ON requester.id = t.demandeur_id
             LEFT JOIN users assignee ON assignee.id = t.assigne_id
             ${scope.sql}${statusClause}
             ORDER BY t.updated_at DESC, t.id DESC
             LIMIT 500`,
            params
        );
        const visibleTickets = access.canView
            ? tickets
            : tickets.map((item) => ({ ...item, assigne_id: null, cout_total: null, temps_total_minutes: null }));

        const teamsRows = await connection.query('SELECT slug, nom FROM ticket_teams ORDER BY id ASC');
        const teams = teamsRows.length ? teamsRows : Object.entries(TICKET_TEAMS).map(([slug, nom]) => ({ slug, nom }));
        const assigneeRows = await connection.query(
            'SELECT u.id, u.nom, u.email, u.role, u.ticket_team, r.permissions FROM users u LEFT JOIN roles r ON r.slug = u.role WHERE u.ticket_team IS NOT NULL ORDER BY u.nom ASC, u.email ASC'
        );
        const assignees = access.canView
            ? assigneeRows
                .filter((item) => item.ticket_team === 'fondateur' || parsePermissions(item.permissions).includes('tickets_view'))
                .map(({ permissions, ...item }) => item)
            : [];

        const ticketId = positiveId(request?.ticketId);
        let ticket = null;
        let updates = [];
        if (ticketId) {
            const detailScope = access.canSeeAll
                ? { sql: '', params: [ticketId] }
                : access.canView && access.team
                    ? { sql: ' AND (t.equipe = ? OR t.demandeur_id = ?)', params: [ticketId, access.team, userId] }
                    : { sql: ' AND t.demandeur_id = ?', params: [ticketId, userId] };
            const detail = await connection.query(
            `SELECT t.id, t.titre, t.description, t.categorie, t.equipe, t.statut, t.demandeur_id, t.assigne_id, t.cout_total, t.temps_total_minutes, t.created_at, t.updated_at, t.resolved_at,
                        t.reclamation_utilisee_at, t.reclamation_message, t.reclamation_decision, t.reclamation_decision_note, t.reclamation_decidee_at,
                        requester.nom AS demandeur_nom, requester.email AS demandeur_email,
                        assignee.nom AS assigne_nom, assignee.email AS assigne_email
                 FROM tickets t
                 LEFT JOIN users requester ON requester.id = t.demandeur_id
                 LEFT JOIN users assignee ON assignee.id = t.assigne_id
                 WHERE t.id = ?${detailScope.sql}`,
                detailScope.params
            );
            if (detail[0]) {
                ticket = detail[0];
                updates = await connection.query(
                    `SELECT h.id, h.action, h.contenu, h.statut, h.equipe, h.assigne_id, h.cout_delta, h.temps_delta_minutes, h.meta, h.created_at,
                            u.nom AS auteur_nom, u.email AS auteur_email,
                            assigned.nom AS assigne_nom
                     FROM ticket_updates h
                     LEFT JOIN users u ON u.id = h.user_id
                     LEFT JOIN users assigned ON assigned.id = h.assigne_id
                     WHERE h.ticket_id = ?
                     ORDER BY h.created_at ASC, h.id ASC`,
                    [ticketId]
                );
            }
        }

        const isRequester = Boolean(ticket && Number(ticket.demandeur_id) === Number(userId));
        // Les coûts et métadonnées internes restent réservés aux équipes de gestion.
        if (isRequester && !access.canView) {
            ticket = ticket ? { ...ticket, cout_total: null, temps_total_minutes: null } : ticket;
            updates = updates.map((update) => ({ ...update, cout_delta: null, temps_delta_minutes: null, meta: null }));
        }

        socket.emit('ticket data response', socketSafe({
            tickets: visibleTickets,
            ticket,
            updates,
            teams,
            assignees,
            statuses: TICKET_STATUSES,
            categories: TICKET_CATEGORIES,
            currentUserId: access.userId,
            currentTeam: access.team,
            isFounder: access.role === 'fondateur' || access.team === 'fondateur',
            canManage: access.canManage,
            canAssign: access.canAssign,
            canSeeAll: access.canSeeAll,
            isRequester,
            filter: { status }
        }));
    } catch (error) {
        const context = { code: error?.code || null, message: error?.message || null };
        void serverLogger.error('ticket.data_failed', 'Erreur lors du chargement des tickets.', context, { userId, socketId: socket.id });
        void logError(userId || null, 'tickets_chargement', 'Impossible de charger les tickets.', context);
        socket.emit('ticket error', error?.code === 'ER_NO_SUCH_TABLE' ? 'Les tables de tickets manquent en base. Applique la migration 009.' : 'Impossible de charger les tickets.');
    } finally {
        if (connection) connection.release();
    }
};
