const { getForUser } = require('../notificationCenter.js');
const serverLogger = require('../serverLogger.js');

const socketSafe = (value) => {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(socketSafe);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, socketSafe(child)]));
    }
    return value;
};

module.exports = async function notificationData(socket) {
    try {
        const userId = socket.request.session?.userId;
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const { notifications, count } = await getForUser(userId);
        socket.emit('notifications response', socketSafe({ notifications, count }));
    } catch (error) {
        console.error('Erreur notifications', error);
        void serverLogger.error('notifications.load_failed', 'Impossible de charger les notifications.', { code: error?.code || null, message: error?.message || null }, { userId: socket.request.session?.userId || null, socketId: socket.id });
        socket.emit('notification error', 'Impossible de charger les notifications pour le moment.');
    }
};
