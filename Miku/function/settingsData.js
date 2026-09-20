const { getPool } = require('../db.js');
const { getSubscriptionStatus } = require('../subscription.js');
const { ensureSchema: ensureStripeSchema, getBillingStatus, listCheckoutOffers } = require('../stripeBilling.js');

module.exports = async function settingsData(socket) {
    let connexion;
    try {
        const userId = socket.request.session?.userId;
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        await ensureStripeSchema();
        connexion = await (await getPool()).getConnection();
        let users;
        try {
            users = await connexion.query('SELECT nom, email, role, abo, date_abo, abo_cancel_requested_at, pending_offer_id, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, stripe_current_period_end FROM users WHERE id = ?', [userId]);
        } catch (error) {
            // Permet à la page de rester consultable tant que la migration 004 n'est pas appliquée.
            if (!/unknown column|column .* doesn't exist/i.test(error.message || '')) throw error;
            users = await connexion.query('SELECT nom, email, role, abo, date_abo FROM users WHERE id = ?', [userId]);
        }
        if (!users.length) return socket.emit('auth error', 'Compte introuvable.');
        const user = users[0];
        socket.emit('settings data response', {
            user,
            subscription: await getSubscriptionStatus(userId),
            billing: {
                ...getBillingStatus(),
                offers: await listCheckoutOffers(),
                pendingOfferId: user.pending_offer_id ? String(user.pending_offer_id) : null,
                hasCustomer: Boolean(user.stripe_customer_id),
                hasSubscription: Boolean(user.stripe_subscription_id)
            }
        });
    } catch (error) {
        console.error('Erreur paramètres', error);
        require('./logError.js')(socket.request.session?.userId || null, 'parametres', error.message);
        socket.emit('settings error', 'Impossible de charger les paramètres.');
    } finally {
        if (connexion) connexion.release();
    }
};
