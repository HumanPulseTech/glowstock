const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');

module.exports = async function needListe(socket) {
    let connexion;
    try {
        const userId = socket.request.session?.userId;
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'dashboard'))) return socket.emit('auth error', 'Ce rôle ne peut pas accéder au tableau de bord.');
        connexion = await (await getPool()).getConnection();
        const products = await connexion.query('SELECT nom, ref_fournisseur, marque, quantite, seuil_alerte FROM produits WHERE id_user = ? AND suive_alertes = 1 AND quantite <= seuil_alerte ORDER BY quantite ASC', [userId]);
        socket.emit('rep produit a surveiller', products);
    } catch (error) {
        console.error('Erreur alertes stock', error);
        socket.emit('server error', 'Erreur temporaire.');
    } finally {
        if (connexion) connexion.release();
    }
};
