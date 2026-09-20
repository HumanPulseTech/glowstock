const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');
const { validateHours } = require('../planning.js');
const serverLogger = require('../serverLogger.js');

module.exports = async function savePlanningHours(input, socket) {
    let connection;
    const userId = socket.request.session?.userId;
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'manage_products'))) return socket.emit('planning settings error', 'Ce rôle ne peut pas modifier les horaires.');
        const hours = validateHours(input?.hours);
        if (!hours) return socket.emit('planning settings error', 'Vérifie les jours et les horaires renseignés.');
        connection = await (await getPool()).getConnection();
        await connection.beginTransaction();
        for (const day of hours) await connection.query(
            'INSERT INTO planning_business_hours (id_user, day_of_week, is_open, opens_at, closes_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE is_open = VALUES(is_open), opens_at = VALUES(opens_at), closes_at = VALUES(closes_at)',
            [userId, day.dayOfWeek, day.isOpen ? 1 : 0, day.opensAt, day.closesAt]
        );
        await connection.commit();
        void serverLogger.info('planning.hours_saved', 'Horaires du planning enregistrés.', {}, { userId, socketId: socket.id });
        socket.emit('planning settings saved');
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        void serverLogger.error('planning.hours_save_failed', 'Impossible d’enregistrer les horaires du planning.', { code: error?.code || null }, { userId: userId || null, socketId: socket.id });
        socket.emit('planning settings error', error?.code === 'ER_NO_SUCH_TABLE' ? 'Le planning doit être initialisé : applique la migration 019.' : 'Impossible d’enregistrer les horaires pour le moment.');
    } finally { if (connection) connection.release(); }
};
