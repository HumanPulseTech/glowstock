const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');
const { addDays, getBusinessHours, normaliseEntry, weekStartFor } = require('../planning.js');

module.exports = async function planningData(request, socket) {
    let connection;
    const userId = socket.request.session?.userId;
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'dashboard'))) return socket.emit('planning error', 'Ce rôle ne peut pas consulter le planning.');
        const weekStart = weekStartFor(request?.weekStart);
        const weekEnd = addDays(weekStart, 6);
        connection = await (await getPool()).getConnection();
        const [hours, entries] = await Promise.all([
            getBusinessHours(connection, userId),
            connection.query(`SELECT id, appointment_date, start_time, end_time, client_name, service_name, notes FROM planning_entries WHERE id_user = ? AND appointment_date BETWEEN ? AND ? ORDER BY appointment_date ASC, start_time ASC`, [userId, weekStart, weekEnd])
        ]);
        socket.emit('planning data', { weekStart, weekEnd, hours, entries: entries.map(normaliseEntry), canManagePlanning: await hasPermission(userId, 'manage_products') });
    } catch (error) {
        socket.emit('planning error', error?.code === 'ER_NO_SUCH_TABLE' ? 'Le planning doit être initialisé : applique la migration 019.' : 'Impossible de charger le planning pour le moment.');
    } finally { if (connection) connection.release(); }
};
