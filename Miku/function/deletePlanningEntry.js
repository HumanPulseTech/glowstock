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
        await connection.beginTransaction();
        // Keep the appointment, its client link and an eventual public-booking record.
        // Removing the row would either break this history or fail on its foreign key.
        const result = await connection.query("UPDATE planning_entries SET status='cancelled', cancelled_at=NOW(), cancellation_reason=? WHERE id = ? AND id_user = ? AND status='confirmed'", ['Annulation par l’établissement', entryId, userId]);
        if (!result.affectedRows) {
            await connection.rollback();
            return socket.emit('planning entry error', 'Ce rendez-vous est introuvable.');
        }
        // A manual-only planning installation can predate the optional booking
        // module. It must still be possible to cancel its appointments.
        try {
            await connection.query("UPDATE booking_requests SET status='cancelled', cancelled_at=NOW() WHERE appointment_id=? AND id_user=? AND status='confirmed'", [entryId, userId]);
        } catch (error) { if (error?.code !== 'ER_NO_SUCH_TABLE') throw error; }
        await connection.commit();
        void serverLogger.info('planning.entry_cancelled', 'Rendez-vous annulé dans le planning.', { entryId }, { userId, socketId: socket.id });
        socket.emit('planning entry deleted', { id: entryId });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        void serverLogger.error('planning.entry_delete_failed', 'Impossible de supprimer un rendez-vous.', { code: error?.code || null }, { userId: userId || null, socketId: socket.id });
        socket.emit('planning entry error', error?.code === 'ER_NO_SUCH_TABLE' ? 'Le planning doit être initialisé : applique la migration 019.' : 'Impossible de supprimer ce rendez-vous pour le moment.');
    } finally { if (connection) connection.release(); }
};
