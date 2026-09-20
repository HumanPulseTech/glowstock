const { getFeatureFlags } = require('../featureFlags.js');

module.exports = async function featureFlagsData(socket) {
    try {
        if (!socket.request.session?.userId) return socket.emit('auth error', 'Session expirée.');
        socket.emit('feature flags response', await getFeatureFlags());
    } catch (error) {
        console.error('Erreur chargement fonctionnalités', error);
        socket.emit('feature flags error', 'Impossible de charger les fonctionnalités actives.');
    }
};
