const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');
const serverLogger = require('../serverLogger.js');

module.exports = async function deletePlanningEntry(input, socket) {
    let connection;
    const userId = socket.request.session?.userId;
    const entryId = Number(input?.id);
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'manage_products'))) return socket.emit('planning entry error', 'Ce rôle ne peut pas modifier le planning.');
        if (!Number.isInteger(entryId) || entryId < 1) return socket.emit('planning entry error', 'Rendez-vous invalide.');
        connection = await (await getPool()).getConnection();
        const result = await connection.query('DELETE FROM planning_entries WHERE id = ? AND id_user = ?', [entryId, userId]);
        if (!result.affectedRows) return socket.emit('planning entry error', 'Ce rendez-vous est introuvable.');
        void serverLogger.info('planning.entry_deleted', 'Rendez-vous supprimé du planning.', { entryId }, { userId, socketId: socket.id });
        socket.emit('planning entry deleted', { id: entryId });
    } catch (error) {
        void serverLogger.error('planning.entry_delete_failed', 'Impossible de supprimer un rendez-vous.', { code: error?.code || null }, { userId: userId || null, socketId: socket.id });
        socket.emit('planning entry error', error?.code === 'ER_NO_SUCH_TABLE' ? 'Le planning doit être initialisé : applique la migration 019.' : 'Impossible de supprimer ce rendez-vous pour le moment.');
    } finally { if (connection) connection.release(); }
};
