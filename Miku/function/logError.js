const { getPool } = require('../db.js');
const serverLogger = require('../serverLogger.js');
const { createAutoTicket } = require('../autoTicket.js');

const AUTO_TICKET_TYPES = new Set([
    'client',
    'inscription',
    'inscription_email',
    'ajout_produit',
    'administration_chargement'
]);

module.exports = async function logError(userId, type, message, context = null) {
    const cleanType = String(type || 'server').slice(0, 50);
    const cleanMessage = String(message || 'Erreur inconnue').slice(0, 2000);
    void serverLogger.error(`error.${cleanType}`, cleanMessage, context, { userId });

    let connexion;
    let errorLogId = null;
    try {
        connexion = await (await getPool()).getConnection();
        const result = await connexion.query(
            'INSERT INTO error_logs (id_user, type, message, context) VALUES (?, ?, ?, ?)',
            [userId, cleanType, cleanMessage, context ? JSON.stringify(context).slice(0, 5000) : null]
        );
        errorLogId = Number(result?.insertId) || null;
    } catch (error) {
        void serverLogger.error('error.legacy_persistence', 'Impossible de journaliser une erreur dans error_logs.', { originalType: cleanType, persistenceError: error.message }, { userId });
    } finally {
        if (connexion) connexion.release();
    }
    if (AUTO_TICKET_TYPES.has(cleanType)) {
        void createAutoTicket({ userId, type: cleanType, message: cleanMessage, context, errorLogId });
    }
};
