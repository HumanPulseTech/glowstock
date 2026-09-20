const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');
const serverLogger = require('../serverLogger.js');
const logError = require('./logError.js');

module.exports = async function listeMarques(socket) {
    let connection;
    const userId = socket.request.session?.userId;
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'manage_products'))) return socket.emit('auth error', 'Ce rôle ne peut pas créer de produit.');
        connection = await (await getPool()).getConnection();
        const brands = await connection.query(
            `SELECT MIN(TRIM(marque)) AS marque
             FROM produits
             WHERE id_user = ? AND marque IS NOT NULL AND TRIM(marque) <> ''
             GROUP BY LOWER(TRIM(marque))
             ORDER BY LOWER(TRIM(marque)) ASC`,
            [userId]
        );
        socket.emit('marques disponibles', brands.map((item) => item.marque).filter(Boolean));
    } catch (error) {
        const context = { code: error?.code || null, message: error?.message || null };
        void serverLogger.error('product.brands_failed', 'Impossible de charger les marques existantes.', context, { userId, socketId: socket.id });
        void logError(userId || null, 'marques_chargement', 'Impossible de charger les marques existantes.', context);
        socket.emit('marques error', 'Impossible de charger les suggestions de marques.');
    } finally {
        if (connection) connection.release();
    }
};
