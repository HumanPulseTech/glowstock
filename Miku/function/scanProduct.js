const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');

module.exports = async function scanProduct(reference, socket) {
    let connexion;
    const userId = socket.request.session?.userId;
    const value = typeof reference === 'string' ? reference.trim().slice(0, 100) : '';

    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'inventory'))) {
            return socket.emit('scan error', 'Ce rôle ne peut pas consulter l’inventaire.');
        }
        if (!value) {
            require('./logError.js')(userId, 'scan_code_barres_validation', 'Code-barres vide.');
            return socket.emit('scan error', 'Aucun code-barres reçu.');
        }

        connexion = await (await getPool()).getConnection();
        const products = await connexion.query(
            'SELECT id, nom, ref_fournisseur, code_barres, marque, categorie, quantite, seuil_alerte FROM produits WHERE id_user = ? AND (code_barres = ? OR ref_fournisseur = ?) ORDER BY CASE WHEN code_barres = ? THEN 0 ELSE 1 END LIMIT 1',
            [userId, value, value, value]
        );

        if (!products.length) {
            return socket.emit('barcode lookup response', {
                found: false,
                reference: value,
                barcode: value,
                canCreateProduct: await hasPermission(userId, 'manage_products')
            });
        }

        const product = products[0];
        const paos = await connexion.query(
            'SELECT id, dStart, dFin, ref, active FROM PAO WHERE id_produit = ? ORDER BY dFin DESC',
            [product.id]
        );
        socket.emit('barcode lookup response', {
            found: true,
            reference: value,
            barcode: product.code_barres || null,
            product,
            paos,
            canManagePao: await hasPermission(userId, 'manage_pao')
        });
    } catch (error) {
        console.error('Erreur recherche code-barres', error);
        require('./logError.js')(userId || null, 'scan_code_barres', error.message, { code: error.code });
        socket.emit('scan error', 'Impossible de rechercher ce code-barres pour le moment.');
    } finally {
        if (connexion) connexion.release();
    }
};
