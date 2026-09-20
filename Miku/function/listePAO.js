const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');

module.exports = async function listePAO(socket) {
    let connexion;
    try {
        const userId = socket.request.session?.userId;
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'consultation')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'pao'))) return socket.emit('auth error', 'Ce rôle ne peut pas consulter les PAO.');
        connexion = await (await getPool()).getConnection();
        await connexion.query(
            'UPDATE PAO pao INNER JOIN produits p ON p.id = pao.id_produit SET pao.active = 0 WHERE p.id_user = ? AND pao.active = 1 AND pao.dFin < CURDATE()',
            [userId]
        );
        const paos = await connexion.query(
            'SELECT p.id, p.nom, p.ref_fournisseur, pao.dStart, pao.dFin, pao.ref, pao.active FROM PAO pao INNER JOIN produits p ON p.id = pao.id_produit WHERE p.id_user = ? ORDER BY pao.dFin ASC',
            [userId]
        );
        const produits = await connexion.query('SELECT id, nom, ref_fournisseur, code_barres FROM produits WHERE id_user = ? ORDER BY nom ASC', [userId]);
        socket.emit('reponse liste pao', { paos, produits });
    } catch (error) {
        console.error('Erreur PAO', error);
        socket.emit('server error', 'Erreur temporaire.');
    } finally {
        if (connexion) connexion.release();
    }
};
