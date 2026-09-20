const { hasPermission } = require('../permissions.js');
const { updateFeatureFlag } = require('../featureFlags.js');
const data = require('../array.js');

module.exports = async function updateFeatureFlagAction(input, socket) {
    try {
        const userId = socket.request.session?.userId;
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        if (!(await hasPermission(userId, 'access_admin'))) return socket.emit('admin error', 'Accès administrateur requis.');
        if (typeof input?.enabled !== 'boolean') return socket.emit('admin error', 'Valeur de fonctionnalité invalide.');

        const flags = await updateFeatureFlag(String(input?.key || ''), input.enabled, userId);
        const payload = { key: input.key, enabled: input.enabled, flags };
        const sockets = data.io?.sockets?.sockets;
        if (sockets?.values) {
            for (const connectedSocket of sockets.values()) connectedSocket.emit('feature flag updated', payload);
        } else {
            socket.emit('feature flag updated', payload);
        }
    } catch (error) {
        socket.emit('admin error', error?.message || 'Impossible de mettre à jour cette fonctionnalité.');
    }
};
