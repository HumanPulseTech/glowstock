const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');
const serverLogger = require('../serverLogger.js');
const logError = require('./logError.js');

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const wholeNumber = (value, min, max) => Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : null;

module.exports = async function addProduit(input, socket) {
    let connexion;
    const operationId = `${socket.id}:${Date.now()}`;
    let userId = null;
    let productId = null;
    let commitAttempted = false;
    try {
        userId = socket.request.session?.userId;
        void serverLogger.info('product.add.start', 'Demande d’ajout de produit reçue.', { operationId }, { userId, socketId: socket.id });
        if (!userId) {
            void serverLogger.warn('product.add.auth_missing', 'Ajout produit refusé : session absente.', { operationId }, { socketId: socket.id });
            return socket.emit('auth error', 'Session expirée.');
        }
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) {
            void serverLogger.warn('product.add.subscription_blocked', 'Ajout produit refusé par l’abonnement.', { operationId, level: subscription.level }, { userId, socketId: socket.id });
            void logError(userId, 'ajout_produit_abonnement', 'Ajout produit refusé par l’abonnement.', { operationId, level: subscription.level });
            return socket.emit('subscription blocked', subscription.level);
        }
        if (!(await hasPermission(userId, 'manage_products'))) {
            void serverLogger.warn('product.add.permission_denied', 'Ajout produit refusé par le rôle.', { operationId }, { userId, socketId: socket.id });
            void logError(userId, 'ajout_produit_permission', 'Ce rôle ne peut pas ajouter de produit.', { operationId });
            return socket.emit('auth error', 'Ce rôle ne peut pas ajouter de produit.');
        }
        const produit = {
            nom: text(input?.nom, 255), reference: text(input?.reference, 100), codeBarres: text(input?.codeBarres, 100) || null, marque: text(input?.marque, 100) || null,
            categorie: text(input?.categorie, 50) || null, description: text(input?.description, 5000) || null,
            quantite: wholeNumber(input?.quantite, 0, 1000000), seuil: wholeNumber(input?.seuil, 0, 1000000),
            alertes: input?.alertes ? 1 : 0
        };
        if (!produit.nom || !produit.reference || produit.quantite === null || produit.seuil === null) {
            void logError(userId, 'ajout_produit_validation', 'Informations produit invalides.', { operationId });
            return socket.emit('produit error', 'Veuillez renseigner un nom, une référence et des quantités valides.');
        }
        connexion = await (await getPool()).getConnection();
        await connexion.beginTransaction();
        if (produit.marque) {
            const existingBrand = await connexion.query(
                `SELECT MIN(TRIM(marque)) AS marque
                 FROM produits
                 WHERE id_user = ? AND marque IS NOT NULL AND TRIM(marque) <> ''
                   AND LOWER(TRIM(marque)) = LOWER(TRIM(?))
                 GROUP BY LOWER(TRIM(marque))
                 LIMIT 1`,
                [userId, produit.marque]
            );
            if (existingBrand[0]?.marque) produit.marque = existingBrand[0].marque;
        }
        const result = await connexion.query(
            'INSERT INTO produits (nom, ref_fournisseur, code_barres, marque, categorie, description, quantite, seuil_alerte, suive_alertes, id_user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [produit.nom, produit.reference, produit.codeBarres, produit.marque, produit.categorie, produit.description, produit.quantite, produit.seuil, produit.alertes, userId]
        );
        productId = Number(result?.insertId) || null;
        await connexion.query('INSERT INTO historique (id_user, type_mouv, value, id_art) VALUES (?, ?, ?, ?)', [userId, 'Création produit', String(produit.quantite), productId]);
        commitAttempted = true;
        await connexion.commit();
        void serverLogger.info('product.add.success', 'Produit enregistré.', {
            operationId,
            productId
        }, { userId, socketId: socket.id });
        socket.emit('produit ajoute', { id: productId, nom: produit.nom, operationId });
    } catch (error) {
        // Une coupure peut arriver juste après le COMMIT : la base a bien
        // enregistré le produit, mais le pilote renvoie quand même une erreur.
        // On vérifie ce cas avant d’afficher une fausse erreur à l’utilisatrice.
        if (commitAttempted && productId && userId) {
            if (connexion) {
                try { await connexion.rollback(); } catch (_) { /* connexion déjà fermée ou COMMIT déjà appliqué */ }
                try { connexion.release(); } catch (_) { /* connexion déjà fermée */ }
                connexion = null;
            }
            let verificationConnection;
            try {
                verificationConnection = await (await getPool()).getConnection();
                const persisted = await verificationConnection.query(
                    'SELECT id, nom FROM produits WHERE id = ? AND id_user = ? LIMIT 1',
                    [productId, userId]
                );
                if (persisted.length) {
                    void serverLogger.warn('product.add.commit_uncertain', 'Produit retrouvé après une erreur de confirmation du COMMIT.', {
                        operationId,
                        productId,
                        originalCode: error?.code || null
                    }, { userId, socketId: socket.id });
                    socket.emit('produit ajoute', { id: productId, nom: persisted[0].nom, operationId });
                    return;
                }
            } catch (verificationError) {
                void serverLogger.error('product.add.commit_verification_failed', 'Impossible de vérifier le produit après une erreur de COMMIT.', {
                    operationId,
                    productId,
                    code: verificationError?.code || null
                }, { userId, socketId: socket.id });
            } finally {
                if (verificationConnection) verificationConnection.release();
            }
        }
        if (connexion) {
            try { await connexion.rollback(); } catch (rollbackError) {
                void serverLogger.error('product.add.rollback_failed', 'Impossible d’annuler la transaction produit.', {
                    operationId,
                    code: rollbackError?.code || null
                }, { userId, socketId: socket.id });
            }
        }
        const context = { code: error?.code || null, operationId };
        if (error?.code === 'ER_DUP_ENTRY') {
            void serverLogger.warn('product.add.duplicate', 'Référence fournisseur ou code-barres déjà utilisé.', context, { userId, socketId: socket.id });
            void logError(userId, 'ajout_produit_duplicate', 'Référence fournisseur ou code-barres déjà utilisé.', context);
            return socket.emit('produit error', 'Cette référence fournisseur ou ce code-barres existe déjà dans votre inventaire.');
        }
        void serverLogger.error('product.add.failed', 'Erreur lors de l’enregistrement du produit.', context, { userId, socketId: socket.id });
        void logError(userId, 'ajout_produit', error?.message || 'Erreur inconnue.', context);
        if (error?.code === 'ER_BAD_FIELD_ERROR' && /code_barres/i.test(error?.message || '')) {
            return socket.emit('produit error', 'La base de données doit être mise à jour avec la colonne code-barres avant cet ajout.');
        }
        socket.emit('produit error', 'Impossible d’enregistrer ce produit.');
    } finally {
        if (connexion) connexion.release();
    }
};
