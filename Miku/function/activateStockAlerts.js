const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');
const serverLogger = require('../serverLogger.js');

module.exports = async function activateStockAlerts(socket) {
    let connexion;
    const userId = socket.request.session?.userId;
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'manage_products'))) return socket.emit('dashboard setup error', 'Ce rôle ne peut pas modifier les alertes de stock.');

        connexion = await (await getPool()).getConnection();
        const result = await connexion.query(
            'UPDATE produits SET suive_alertes = 1 WHERE id_user = ? AND COALESCE(suive_alertes, 0) = 0',
            [userId]
        );
        const activated = Number(result?.affectedRows) || 0;
        void serverLogger.info('dashboard.alerts_activated', 'Alertes de stock activées depuis le configurateur.', {
            activated
        }, { userId, socketId: socket.id });
        socket.emit('dashboard setup updated', { activated });
    } catch (error) {
        void serverLogger.error('dashboard.alerts_activation_failed', 'Impossible d’activer les alertes de stock.', {
            code: error?.code || null
        }, { userId: userId || null, socketId: socket.id });
        socket.emit('dashboard setup error', 'Impossible d’activer les alertes pour le moment.');
    } finally {
        if (connexion) connexion.release();
    }
};
