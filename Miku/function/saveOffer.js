const { hasPermission } = require('../permissions.js');
const { saveOffer } = require('../marketingOffers.js');

module.exports = async function saveOfferAction(input, socket) {
    try {
        const userId = socket.request.session?.userId;
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        if (!(await hasPermission(userId, 'access_admin'))) return socket.emit('admin error', 'Accès administrateur requis.');
        const id = await saveOffer(input);
        socket.emit('offer saved', { id });
    } catch (error) {
        socket.emit('offer error', error?.message || 'Impossible d’enregistrer cette offre.');
    }
};
