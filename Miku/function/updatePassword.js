const { getPool } = require('../db.js');
const bcrypt = require('bcrypt');

module.exports = async function updatePassword(passwords, socket) {
    let connexion;
    try {
        const userId = socket.request.session?.userId;
        const current = typeof passwords?.current === 'string' ? passwords.current : '';
        const next = typeof passwords?.next === 'string' ? passwords.next : '';
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        if (next.length < 12 || next.length > 128) { require('./logError.js')(userId, 'mot_de_passe_validation', 'Mot de passe trop court.'); return socket.emit('settings error', 'Le nouveau mot de passe doit contenir au moins 12 caractères.'); }
        connexion = await (await getPool()).getConnection();
        const users = await connexion.query('SELECT password FROM users WHERE id = ?', [userId]);
        if (!users.length || !(await bcrypt.compare(current, users[0].password))) { require('./logError.js')(userId, 'mot_de_passe_validation', 'Mot de passe actuel incorrect.'); return socket.emit('settings error', 'Le mot de passe actuel est incorrect.'); }
        await connexion.query('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(next, 12), userId]);
        socket.emit('password updated');
    } catch (error) {
        console.error('Erreur mot de passe', error);
        require('./logError.js')(socket.request.session?.userId || null, 'mot_de_passe', error.message);
        socket.emit('settings error', 'Impossible de modifier le mot de passe.');
    } finally { if (connexion) connexion.release(); }
};
