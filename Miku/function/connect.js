const { getPool } = require('../db.js');
const { verifyPassword, startSession } = require('../../security/runtime.js');
const serverLogger = require('../serverLogger.js');

module.exports = async function connect(credentials, socket) {
    let connexion;
    try {
        if (!credentials || typeof credentials.email !== 'string' || typeof credentials.password !== 'string' || credentials.email.length > 254 || credentials.password.length > 128) return socket.emit('auth error', 'Identifiants invalides.');
        connexion = await (await getPool()).getConnection();
        const users = await connexion.query('SELECT id, password, email_verified, role FROM users WHERE email = ?', [credentials.email.trim().toLowerCase()]);
        if (!users.length || !(await verifyPassword(credentials.password, users[0].password))) {
            void serverLogger.warn('auth.login_denied', 'Identifiants invalides.', {}, { socketId: socket.id });
            return socket.emit('auth error', 'Identifiants invalides.');
        }
        if (users[0].email_verified !== 1) return socket.emit('auth error', 'Veuillez d’abord valider votre adresse e-mail.');
        await startSession(socket.request, users[0]);
        void serverLogger.info('auth.login_success', 'Connexion réussie, session renouvelée.', {}, { userId: users[0].id, socketId: socket.id });
        socket.emit('connection ac');
    } catch (error) {
        console.error('Erreur de connexion', error);
        void serverLogger.error('auth.login_failed', 'Erreur pendant la connexion.', { code: error.code }, { socketId: socket.id });
        socket.emit('auth error', 'Erreur temporaire.');
    } finally {
        if (connexion) connexion.release();
    }
};
