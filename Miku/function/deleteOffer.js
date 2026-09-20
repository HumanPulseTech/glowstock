const { hasPermission } = require('../permissions.js');
const { deleteOffer } = require('../marketingOffers.js');

module.exports = async function deleteOfferAction(id, socket) {
    try {
        const userId = socket.request.session?.userId;
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        if (!(await hasPermission(userId, 'access_admin'))) return socket.emit('admin error', 'Accès administrateur requis.');
        await deleteOffer(id);
        socket.emit('offer deleted');
    } catch (error) {
        socket.emit('offer error', error?.message || 'Impossible de supprimer cette offre.');
    }
};
