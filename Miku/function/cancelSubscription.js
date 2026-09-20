const { getPool } = require('../db.js');
const { BillingError, ensureSchema: ensureStripeSchema, requestSubscriptionCancellation } = require('../stripeBilling.js');

module.exports = async function cancelSubscription(socket) {
    let connexion;
    const userId = socket.request.session?.userId;
    if (!userId) return socket.emit('auth error', 'Session expirée.');

    try {
        await ensureStripeSchema();
        connexion = await (await getPool()).getConnection();
        const users = await connexion.query(
            'SELECT abo, date_abo, abo_cancel_requested_at, stripe_subscription_id FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        if (!users.length) return socket.emit('settings error', 'Compte introuvable.');

        const user = users[0];
        if (user.abo_cancel_requested_at) {
            return socket.emit('settings error', 'L’annulation de ton abonnement est déjà programmée.');
        }
        if (!user.abo || !user.date_abo) {
            return socket.emit('settings error', 'Aucun abonnement actif à annuler.');
        }

        let stripeCancellation = null;
        if (user.stripe_subscription_id) stripeCancellation = await requestSubscriptionCancellation(userId);
        const dateAbo = stripeCancellation?.dateAbo || user.date_abo;
        await connexion.query(
            'UPDATE users SET abo_cancel_requested_at = CURRENT_TIMESTAMP WHERE id = ?',
            [userId]
        );
        socket.emit('subscription cancellation requested', {
            dateAbo,
            requestedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Erreur annulation abonnement', error);
        require('./logError.js')(userId, 'abonnement_annulation', error.message);
        socket.emit('settings error', error instanceof BillingError ? error.message : 'Impossible d’annuler l’abonnement pour le moment.');
    } finally {
        if (connexion) connexion.release();
    }
};
