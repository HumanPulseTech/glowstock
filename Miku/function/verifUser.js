const data = require('../array.js');
const { getPool } = require('../db.js');
const { hasPermission } = require('../permissions.js');

module.exports = async function verifUser(socket) {
    let connexion;
    try {
        const userId = socket.request.session?.userId;
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        connexion = await (await getPool()).getConnection();
        const users = await connexion.query('SELECT id, nom, role, abo FROM users WHERE id = ?', [userId]);
        if (!users.length) return socket.emit('auth error', 'Session invalide.');
        const products = await connexion.query('SELECT COUNT(*) AS total FROM produits WHERE id_user = ?', [userId]);
        const lowStock = await connexion.query('SELECT COUNT(*) AS total FROM produits WHERE id_user = ? AND suive_alertes = 1 AND quantite <= seuil_alerte', [userId]);
        const configuredAlerts = await connexion.query('SELECT COUNT(*) AS total FROM produits WHERE id_user = ? AND COALESCE(suive_alertes, 0) = 1', [userId]);
        const productCount = Number(products[0].total);
        const alertsEnabled = Number(configuredAlerts[0].total);
        socket.emit('reponse information user', users[0]);
        socket.emit('charge information', productCount);
        socket.emit('dashboard stats', { lowStock: Number(lowStock[0].total) });
        socket.emit('dashboard setup', {
            productCount,
            alertsEnabled,
            alertsPending: Math.max(0, productCount - alertsEnabled),
            canManageProducts: await hasPermission(userId, 'manage_products')
        });
    } catch (error) {
        console.error('Erreur utilisateur', error);
        socket.emit('server error', 'Erreur temporaire.');
    } finally {
        if (connexion) connexion.release();
    }
};
