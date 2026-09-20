const serverLogger = require('../serverLogger.js');
const logError = require('./logError.js');
const { getPoolConnection, getTicketAccess, isTeam, positiveId } = require('../ticketAccess.js');

module.exports = async function updateTicketTeam(input, socket) {
    let connection;
    const actorId = socket.request.session?.userId;
    try {
        if (!actorId) return socket.emit('auth error', 'Session expirée.');
        const targetId = positiveId(input?.userId);
        const team = input?.team ? (isTeam(input.team) ? input.team : null) : null;
        if (!targetId || (input?.team && !team)) return socket.emit('admin error', 'Équipe invalide.');
        connection = await getPoolConnection();
        const access = await getTicketAccess(connection, actorId);
        if (!access?.permissions.includes('manage_accounts')) return socket.emit('admin error', 'Accès refusé.');
        const result = await connection.query('UPDATE users SET ticket_team = ? WHERE id = ?', [team, targetId]);
        if (!result.affectedRows) return socket.emit('admin error', 'Compte introuvable.');
        void serverLogger.info('ticket.team_updated', 'Équipe tickets modifiée pour un compte.', { targetId, team }, { userId: actorId, socketId: socket.id });
        socket.emit('ticket team updated');
    } catch (error) {
        const context = { code: error?.code || null, message: error?.message || null };
        void serverLogger.error('ticket.team_update_failed', 'Erreur lors de la modification de l’équipe tickets.', context, { userId: actorId, socketId: socket.id });
        void logError(actorId || null, 'ticket_equipe', 'Impossible de modifier l’équipe tickets.', context);
        socket.emit('admin error', error?.code === 'ER_BAD_FIELD_ERROR' ? 'La colonne d’équipe tickets manque en base. Applique la migration 009.' : 'Impossible de modifier l’équipe tickets.');
    } finally {
        if (connection) connection.release();
    }
};
