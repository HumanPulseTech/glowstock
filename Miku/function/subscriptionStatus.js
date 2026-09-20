const { getSubscriptionStatus } = require('../subscription.js');

module.exports = async function subscriptionStatus(socket) {
    const userId = socket.request.session?.userId;
    if (!userId) return socket.emit('auth error', 'Session expirée.');
    try {
        socket.emit('subscription status', await getSubscriptionStatus(userId));
    } catch (error) {
        console.error('Erreur statut abonnement', error);
    }
};
