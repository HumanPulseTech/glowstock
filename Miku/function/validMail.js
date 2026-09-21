const { getPool } = require('../db.js');
const { ensureSchema: ensureStripeSchema } = require('../stripeBilling.js');
const { startSession } = require('../../security/runtime.js');

module.exports = async function validMail(token, socket) {
    let connexion;
    try {
        if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return socket.emit('verification error', 'Lien de validation invalide.');
        await ensureStripeSchema();
        connexion = await (await getPool()).getConnection();
        const users = await connexion.query('SELECT id, password, role, pending_offer_id FROM users WHERE verification_token = ? AND email_verified = 0', [token]);
        if (!users.length) return socket.emit('verification error', 'Ce lien est invalide ou a déjà été utilisé.');
        const updated = await connexion.query('UPDATE users SET email_verified = 1, verification_token = NULL, verified_at = NOW(), Token = NULL WHERE id = ? AND verification_token = ? AND email_verified = 0', [users[0].id, token]);
        if (updated.affectedRows !== 1) return socket.emit('verification error', 'Ce lien est invalide ou a déjà été utilisé.');
        await startSession(socket.request, users[0]);
        socket.emit('connection ac', {
            checkoutOfferId: users[0].pending_offer_id ? String(users[0].pending_offer_id) : null
        });
    } catch (error) {
        console.error('Erreur de validation e-mail', error);
        socket.emit('verification error', 'Erreur temporaire.');
    } finally {
        if (connexion) connexion.release();
    }
};
