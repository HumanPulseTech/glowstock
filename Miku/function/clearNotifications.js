const { dismissAllForUser } = require('../notificationCenter.js');

module.exports = async function clearNotifications(socket) {
    try {
        const userId = socket.request.session?.userId;
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        await dismissAllForUser(userId);
        socket.emit('notifications cleared');
    } catch (error) {
        console.error('Erreur suppression notifications', error);
        socket.emit('notification error', 'Impossible de supprimer les notifications pour le moment.');
    }
};
