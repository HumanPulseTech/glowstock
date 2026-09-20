const { getPool } = require('../db.js');
const bcrypt = require('bcrypt');
const serverLogger = require('../serverLogger.js');

module.exports = async function connect(credentials, socket) {
    let connexion;
    try {
        if (!credentials || typeof credentials.email !== 'string' || typeof credentials.password !== 'string' || credentials.email.length > 254 || credentials.password.length > 128) return socket.emit('auth error', 'Identifiants invalides.');
        connexion = await (await getPool()).getConnection();
        const users = await connexion.query('SELECT id, password, email_verified, role FROM users WHERE email = ?', [credentials.email.trim().toLowerCase()]);
        if (!users.length || !(await bcrypt.compare(credentials.password, users[0].password))) return socket.emit('auth error', 'Identifiants invalides.');
        if (users[0].email_verified !== 1) return socket.emit('auth error', 'Veuillez d’abord valider votre adresse e-mail.');
        socket.request.session.userId = users[0].id;
        socket.request.session.role = users[0].role;
        socket.request.session.save((error) => {
            if (error) {
                void serverLogger.error('auth.session.save_failed', 'Impossible de sauvegarder la session de connexion.', { code: error.code }, { userId: users[0].id, socketId: socket.id });
                return socket.emit('auth error', 'Impossible de créer la session.');
            }
            void serverLogger.info('auth.session.saved', 'Session de connexion sauvegardée.', { role: users[0].role }, { userId: users[0].id, socketId: socket.id });
            socket.emit('connection ac');
        });
    } catch (error) {
        console.error('Erreur de connexion', error);
        void serverLogger.error('auth.login_failed', 'Erreur pendant la connexion.', { code: error.code }, { socketId: socket.id });
        socket.emit('auth error', 'Erreur temporaire.');
    } finally {
        if (connexion) connexion.release();
    }
};
