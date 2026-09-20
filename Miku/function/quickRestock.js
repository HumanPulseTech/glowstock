const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');
const serverLogger = require('../serverLogger.js');
const logError = require('./logError.js');

const cleanReference = (value) => typeof value === 'string'
    ? value.trim().slice(0, 100)
    : '';
const validQuantity = (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100000
    ? Number(value)
    : null;

module.exports = async function quickRestock(input, socket) {
    let connexion;
    const userId = socket.request.session?.userId;
    const reference = cleanReference(input?.reference);
    const quantity = validQuantity(input?.quantity);
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'manage_products'))) return socket.emit('stock restock error', 'Ce rôle ne peut pas modifier le stock.');
        if (!reference || quantity === null) return socket.emit('stock restock error', 'Saisis une référence fournisseur et une quantité valide.');

        connexion = await (await getPool()).getConnection();
        await connexion.beginTransaction();
        const products = await connexion.query(
            `SELECT id, nom, ref_fournisseur, quantite
             FROM produits
             WHERE id_user = ? AND TRIM(ref_fournisseur) = ?
             LIMIT 1 FOR UPDATE`,
            [userId, reference]
        );
        const product = products[0];
        if (!product) {
            await connexion.rollback();
            return socket.emit('stock restock error', 'Aucun produit ne correspond à cette référence fournisseur.');
        }

        const newQuantity = Number(product.quantite) + quantity;
        await connexion.query('UPDATE produits SET quantite = ? WHERE id = ? AND id_user = ?', [newQuantity, product.id, userId]);
        await connexion.query(
            'INSERT INTO historique (id_user, type_mouv, value, id_art) VALUES (?, ?, ?, ?)',
            [userId, 'Réception fournisseur', `+${quantity}`, product.id]
        );
        await connexion.commit();
        void serverLogger.info('stock.quick_restock.success', 'Stock mis à jour depuis une référence fournisseur.', {
            productId: product.id,
            quantityAdded: quantity,
            newQuantity
        }, { userId, socketId: socket.id });
        socket.emit('stock restock success', {
            reference: product.ref_fournisseur,
            name: product.nom,
            quantityAdded: quantity,
            newQuantity
        });
    } catch (error) {
        if (connexion) await connexion.rollback().catch(() => {});
        void serverLogger.error('stock.quick_restock.failed', 'Impossible de mettre à jour le stock rapidement.', {
            code: error?.code || null,
            reference
        }, { userId: userId || null, socketId: socket.id });
        void logError(userId || null, 'reassort_rapide', 'Impossible de mettre à jour le stock via la référence fournisseur.', { code: error?.code || null });
        socket.emit('stock restock error', 'Impossible de mettre le stock à jour pour le moment.');
    } finally {
        if (connexion) connexion.release();
    }
};
