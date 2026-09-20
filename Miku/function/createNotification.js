const { createAnnouncement, emitToUser } = require('../notificationCenter.js');
const { hasPermission } = require('../permissions.js');

module.exports = async function createNotification(input, socket) {
    try {
        const authorId = socket.request.session?.userId;
        if (!authorId) return socket.emit('auth error', 'Session expirée.');
        if (!(await hasPermission(authorId, 'access_admin'))) return socket.emit('admin error', 'Accès administrateur requis.');

        const recipientIds = await createAnnouncement({
            authorId,
            audience: input?.audience,
            recipientId: input?.recipientId,
            title: input?.title,
            message: input?.message
        });
        recipientIds.forEach((recipientId) => emitToUser(recipientId, 'notification created', { type: 'announcement' }));
        socket.emit('admin notification created', { recipients: recipientIds.length });
    } catch (error) {
        const message = error?.message || 'Impossible de créer cette notification.';
        socket.emit('admin notification error', message);
    }
};
