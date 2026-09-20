const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');

module.exports = async function listeInv(socket) {
    let connexion;
    try {
        const userId = socket.request.session?.userId;
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'consultation')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'inventory'))) return socket.emit('auth error', 'Ce rôle ne peut pas consulter l’inventaire.');
        connexion = await (await getPool()).getConnection();
        const products = await connexion.query('SELECT nom, ref_fournisseur, code_barres, marque, categorie, quantite, seuil_alerte, suive_alertes FROM produits WHERE id_user = ? ORDER BY nom ASC', [userId]);
        socket.emit('reponse liste inv', products);
        socket.emit('charge information', products.length);
        socket.emit('inventaire stats', {
            total: products.length,
            marques: new Set(products.map(product => product.marque).filter(Boolean)).size,
            bas: products.filter(product => product.suive_alertes && product.quantite <= product.seuil_alerte).length,
            alertesDesactivees: products.filter(product => !product.suive_alertes).length
        });
    } catch (error) {
        console.error('Erreur inventaire', error);
        socket.emit('server error', 'Erreur temporaire.');
    } finally {
        if (connexion) connexion.release();
    }
};
