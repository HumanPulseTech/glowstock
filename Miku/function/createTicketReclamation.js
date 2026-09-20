const serverLogger = require('../serverLogger.js');
const logError = require('./logError.js');
const { getPoolConnection, positiveId, cleanText } = require('../ticketAccess.js');

/**
 * Permet à la demanderesse de contester une seule fois un ticket terminé.
 * La contestation est automatiquement envoyée au fondateur.
 */
module.exports = async function createTicketReclamation(input, socket) {
    let connection;
    const userId = socket.request.session?.userId;
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const ticketId = positiveId(input?.ticketId);
        const message = cleanText(input?.message, 5000);
        if (!ticketId || !message) return socket.emit('ticket reclamation error', 'Sélectionne un ticket fermé et explique ta réclamation.');

        connection = await getPoolConnection();
        await connection.beginTransaction();
        const rows = await connection.query(
            `SELECT id, titre, equipe, statut, demandeur_id, assigne_id, reclamation_utilisee_at
             FROM tickets WHERE id = ? AND demandeur_id = ? FOR UPDATE`,
            [ticketId, userId]
        );
        const ticket = rows[0];
        if (!ticket) {
            await connection.rollback();
            return socket.emit('ticket reclamation error', 'Ticket introuvable ou inaccessible.');
        }
        if (ticket.statut !== 'termine') {
            await connection.rollback();
            return socket.emit('ticket reclamation error', 'Une réclamation est possible uniquement après la fermeture du ticket.');
        }
        if (ticket.reclamation_utilisee_at) {
            await connection.rollback();
            return socket.emit('ticket reclamation error', 'Une seule réclamation est autorisée pour ce ticket.');
        }

        const founderRows = await connection.query(
            `SELECT u.id
             FROM users u
             WHERE u.ticket_team = 'fondateur' OR u.role = 'fondateur'
             ORDER BY (u.ticket_team = 'fondateur') DESC, u.id ASC
             LIMIT 1`
        );
        const founderId = founderRows[0]?.id ? Number(founderRows[0].id) : null;
        await connection.query(
            `UPDATE tickets
             SET statut = 'reclamation', equipe = 'fondateur', assigne_id = ?,
                 reclamation_utilisee_at = NOW(), reclamation_message = ?,
                 reclamation_decision = 'en_attente', reclamation_decision_note = NULL,
                 reclamation_decidee_par = NULL, reclamation_decidee_at = NULL,
                 reclamation_previous_team = ?, reclamation_previous_status = ?, reclamation_previous_assignee_id = ?
             WHERE id = ? AND demandeur_id = ? AND statut = 'termine' AND reclamation_utilisee_at IS NULL`,
            [founderId, message, ticket.equipe, ticket.statut, ticket.assigne_id || null, ticketId, userId]
        );
        await connection.query(
            `INSERT INTO ticket_updates (ticket_id, user_id, action, contenu, statut, equipe, assigne_id, meta)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [ticketId, userId, 'reclamation', message, 'reclamation', 'fondateur', founderId, JSON.stringify({ reclamation: true, previousTeam: ticket.equipe, previousStatus: ticket.statut })]
        );
        await connection.commit();
        void serverLogger.info('ticket.reclamation_created', 'Réclamation de ticket créée.', { ticketId, founderId }, { userId, socketId: socket.id });
        socket.emit('ticket reclamation created', { ticketId });
        socket.emit('ticket updated', { ticketId });
        socket.broadcast.emit('ticket updated', { ticketId });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        const context = { code: error?.code || null, message: error?.message || null };
        void serverLogger.error('ticket.reclamation_failed', 'Erreur lors de la création de la réclamation.', context, { userId, socketId: socket.id });
        void logError(userId || null, 'ticket_reclamation', 'Impossible de créer la réclamation du ticket.', context);
        socket.emit('ticket reclamation error', error?.code === 'ER_BAD_FIELD_ERROR' ? 'La migration des réclamations manque en base. Applique la migration 009.' : 'Impossible de créer la réclamation.');
    } finally {
        if (connection) connection.release();
    }
};
