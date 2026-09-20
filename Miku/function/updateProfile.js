const { getPool } = require('../db.js');

module.exports = async function updateProfile(profile, socket) {
    let connexion;
    try {
        const userId = socket.request.session?.userId;
        const nom = typeof profile?.nom === 'string' ? profile.nom.trim().slice(0, 100) : '';
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        if (!nom) { require('./logError.js')(userId, 'profil_validation', 'Nom de profil vide.'); return socket.emit('settings error', 'Le nom est obligatoire.'); }
        connexion = await (await getPool()).getConnection();
        await connexion.query('UPDATE users SET nom = ? WHERE id = ?', [nom, userId]);
        socket.emit('profile updated', { nom });
    } catch (error) {
        console.error('Erreur profil', error);
        require('./logError.js')(socket.request.session?.userId || null, 'profil', error.message);
        socket.emit('settings error', 'Impossible de mettre à jour le profil.');
    } finally { if (connexion) connexion.release(); }
};
