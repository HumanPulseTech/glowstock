const serverLogger = require('../serverLogger.js');
const logError = require('./logError.js');
const {
    TICKET_STATUSES,
    isCategory,
    getTicketAccess,
    getPoolConnection,
    cleanText,
    isTeam,
    positiveId,
    parsePermissions
} = require('../ticketAccess.js');

module.exports = async function createTicket(input, socket) {
    let connection;
    const userId = socket.request.session?.userId;
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        connection = await getPoolConnection();
        const access = await getTicketAccess(connection, userId);
        const internalManager = Boolean(access?.canManage);

        const titre = cleanText(input?.title, 200);
        const description = cleanText(input?.description, 10000);
        const sourcePath = cleanText(input?.sourcePath, 300);
        const category = isCategory(input?.category) ? input.category : 'bug';
        const requestedTeam = internalManager ? (isTeam(input?.team) ? input.team : access.team) : 'dev';
        const assigneeId = internalManager ? positiveId(input?.assigneeId) : null;
        if (!titre || !description || !requestedTeam) return socket.emit('ticket error', 'Renseigne un titre, une description et une équipe.');
        if (internalManager && !access.canSeeAll && requestedTeam !== access.team) return socket.emit('ticket error', 'Tu ne peux créer un ticket que dans ton équipe.');
        if (internalManager && assigneeId && !access.canAssign) return socket.emit('ticket error', 'Tu ne peux pas attribuer ce ticket.');
        if (assigneeId) {
            const assignees = await connection.query('SELECT u.ticket_team, r.permissions FROM users u LEFT JOIN roles r ON r.slug = u.role WHERE u.id = ?', [assigneeId]);
            const assignee = assignees[0];
            const canReceiveTicket = assignee && (assignee.ticket_team === 'fondateur' || parsePermissions(assignee.permissions).includes('tickets_view'));
            if (!assignee || !canReceiveTicket || (assignee.ticket_team !== requestedTeam && assignee.ticket_team !== 'fondateur')) return socket.emit('ticket error', 'La personne sélectionnée ne fait pas partie de cette équipe.');
        }

        await connection.beginTransaction();
        const fullDescription = sourcePath ? `${description}\n\nPage concernée : ${sourcePath}` : description;
        const result = await connection.query(
            'INSERT INTO tickets (titre, description, categorie, equipe, statut, demandeur_id, assigne_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [titre, fullDescription, category, requestedTeam, 'non_traite', userId, assigneeId]
        );
        const ticketId = Number(result.insertId);
        await connection.query(
            'INSERT INTO ticket_updates (ticket_id, user_id, action, contenu, statut, equipe, assigne_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [ticketId, userId, 'creation', fullDescription, 'non_traite', requestedTeam, assigneeId, JSON.stringify({ title: titre, category, sourcePath: sourcePath || null, publicCreation: !internalManager })]
        );
        await connection.commit();
        void serverLogger.info('ticket.created', 'Ticket créé.', { ticketId, team: requestedTeam }, { userId, socketId: socket.id });
        socket.emit('ticket created', { ticketId });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        const context = { code: error?.code || null, message: error?.message || null };
        void serverLogger.error('ticket.create_failed', 'Erreur lors de la création du ticket.', context, { userId, socketId: socket.id });
        void logError(userId || null, 'ticket_creation', 'Impossible de créer le ticket.', context);
        socket.emit('ticket error', error?.code === 'ER_NO_SUCH_TABLE' ? 'Les tables de tickets manquent en base. Applique la migration 009.' : 'Impossible de créer le ticket.');
    } finally {
        if (connection) connection.release();
    }
};
