const { validateSession } = require('./runtime');
const { refreshSessionActivity } = require('./session-activity');

function createSocketGuard(socket, { getPool, sessionStore, allowAttempt }) {
    return async ([event], next) => {
        if (!allowAttempt(socket, 'events', 120, 60000)) return next(new Error('Trop de requêtes.'));
        if (['inscription', 'feature flags', 'client error'].includes(event)) return next();
        try {
            await new Promise((resolve, reject) => socket.request.session.reload(error => error ? reject(error) : resolve()));
            if (!(await validateSession(socket.request.session, getPool))) throw new Error('Session expirée.');
            if (event === 'update password' && !allowAttempt(socket, 'password', 5)) return next(new Error('Trop de tentatives.'));
            if (!(await refreshSessionActivity(sessionStore, socket.request.sessionID))) throw new Error('Session expirée.');
            next();
        } catch (_) {
            socket.emit('auth error', 'Session expirée. Reconnectez-vous.');
            socket.disconnect(true);
        }
    };
}
module.exports = { createSocketGuard };
