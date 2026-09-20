const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');
const serverLogger = require('../serverLogger.js');

const cleanReference = (value) => typeof value === 'string' ? value.trim().slice(0, 100) : '';
const countValue = (value) => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1000000
    ? Number(value)
    : null;

module.exports = async function importInventoryCount(input, socket) {
    let connexion;
    const userId = socket.request.session?.userId;
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'manage_products'))) return socket.emit('inventory import error', 'Ce rôle ne peut pas modifier le stock.');

        const sourceRows = Array.isArray(input?.rows) ? input.rows.slice(0, 1000) : [];
        if (!sourceRows.length) return socket.emit('inventory import error', 'Aucune ligne de comptage à importer.');
        if (Array.isArray(input?.rows) && input.rows.length > 1000) return socket.emit('inventory import error', 'Le fichier est limité à 1 000 lignes de comptage par import.');

        const entries = [];
        const references = new Set();
        for (const source of sourceRows) {
            const reference = cleanReference(source?.reference);
            const counted = countValue(source?.counted);
            if (!reference || counted === null) return socket.emit('inventory import error', 'Le fichier contient une référence ou une quantité comptée invalide.');
            if (references.has(reference.toLocaleLowerCase('fr'))) return socket.emit('inventory import error', `La référence « ${reference} » apparaît plusieurs fois dans le fichier.`);
            references.add(reference.toLocaleLowerCase('fr'));
            entries.push({ reference, counted });
        }

        connexion = await (await getPool()).getConnection();
        await connexion.beginTransaction();
        const placeholders = entries.map(() => '?').join(', ');
        const products = await connexion.query(
            `SELECT id, nom, ref_fournisseur, quantite
             FROM produits
             WHERE id_user = ? AND ref_fournisseur IN (${placeholders})
             FOR UPDATE`,
            [userId, ...entries.map((entry) => entry.reference)]
        );
        const productsByReference = new Map(products.map((product) => [String(product.ref_fournisseur).toLocaleLowerCase('fr'), product]));
        const missingReferences = [];
        let updated = 0;
        let unchanged = 0;

        for (const entry of entries) {
            const product = productsByReference.get(entry.reference.toLocaleLowerCase('fr'));
            if (!product) {
                missingReferences.push(entry.reference);
                continue;
            }
            const previousQuantity = Number(product.quantite);
            if (previousQuantity === entry.counted) {
                unchanged += 1;
                continue;
            }
            const difference = entry.counted - previousQuantity;
            await connexion.query('UPDATE produits SET quantite = ? WHERE id = ? AND id_user = ?', [entry.counted, product.id, userId]);
            await connexion.query(
                'INSERT INTO historique (id_user, type_mouv, value, id_art) VALUES (?, ?, ?, ?)',
                [userId, 'Inventaire CSV', `${previousQuantity} → ${entry.counted} (${difference >= 0 ? '+' : ''}${difference})`, product.id]
            );
            updated += 1;
        }
        await connexion.commit();
        void serverLogger.info('inventory.csv_import.success', 'Comptage CSV importé.', {
            rows: entries.length,
            updated,
            unchanged,
            missing: missingReferences.length
        }, { userId, socketId: socket.id });
        socket.emit('inventory import success', {
            updated,
            unchanged,
            missingReferences: missingReferences.slice(0, 20),
            missingCount: missingReferences.length
        });
    } catch (error) {
        if (connexion) await connexion.rollback().catch(() => {});
        void serverLogger.error('inventory.csv_import.failed', 'Impossible d’importer le comptage CSV.', {
            code: error?.code || null
        }, { userId: userId || null, socketId: socket.id });
        socket.emit('inventory import error', 'Impossible d’importer ce comptage pour le moment.');
    } finally {
        if (connexion) connexion.release();
    }
};
