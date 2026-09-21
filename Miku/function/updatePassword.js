const { getPool } = require('../db.js');
const { hashPassword, verifyPassword } = require('../../security/runtime.js');
const { assertPasswordStorage } = require('../../security/password-storage.js');

module.exports = async function updatePassword(passwords, socket) {
    let connexion;
    try {
        const userId = socket.request.session?.userId;
        const current = typeof passwords?.current === 'string' ? passwords.current : '';
        const next = typeof passwords?.next === 'string' ? passwords.next : '';
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        if (Array.from(next).length < 12 || next.length > 128) { require('./logError.js')(userId, 'mot_de_passe_validation', 'Longueur de mot de passe invalide.'); return socket.emit('settings error', 'Le nouveau mot de passe doit contenir de 12 à 128 caractères (certains symboles comptent double pour la limite maximale).'); }
        connexion = await (await getPool()).getConnection();
        await assertPasswordStorage(connexion);
        const users = await connexion.query('SELECT password FROM users WHERE id = ?', [userId]);
        if (!users.length || !(await verifyPassword(current, users[0].password))) { require('./logError.js')(userId, 'mot_de_passe_validation', 'Mot de passe actuel incorrect.'); return socket.emit('settings error', 'Le mot de passe actuel est incorrect.'); }
        const updated = await connexion.query('UPDATE users SET password = ? WHERE id = ? AND password = ?', [await hashPassword(next), userId, users[0].password]);
        if (updated.affectedRows !== 1) return socket.emit('settings error', 'Le mot de passe a changé. Reconnectez-vous.');
        socket.emit('password updated');
    } catch (error) {
        console.error('Erreur mot de passe', error?.code || 'UNKNOWN');
        require('./logError.js')(socket.request.session?.userId || null, 'mot_de_passe', 'Échec du changement de mot de passe.', { code: error?.code || null });
        socket.emit('settings error', 'Impossible de modifier le mot de passe.');
    } finally { if (connexion) connexion.release(); }
};
