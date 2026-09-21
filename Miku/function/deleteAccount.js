const { getPool } = require('../db.js');
const { hasPermission } = require('../permissions.js');
const logError = require('./logError.js');
const { canManageRole } = require('../../security/authorization.js');

module.exports = async function deleteAccount(input, socket) {
  let connexion;
  const adminId = socket.request.session?.userId;
  const targetId = Number(input?.userId ?? input);
  try {
    if (!adminId) return socket.emit('auth error', 'Session expirée.');
    if (adminId === targetId) return socket.emit('admin error', 'Tu ne peux pas supprimer ton propre compte.');
    if (!Number.isInteger(targetId) || targetId <= 0 || !(await hasPermission(adminId, 'delete_accounts'))) {
      return socket.emit('admin error', 'Tu ne peux pas supprimer ce compte.');
    }
    connexion = await (await getPool()).getConnection();
    await connexion.beginTransaction();
    const users = await connexion.query('SELECT id, email, role, ticket_team FROM users WHERE id = ? LIMIT 1', [targetId]);
    if (!users.length) {
      await connexion.rollback();
      return socket.emit('admin error', 'Compte introuvable.');
    }
    if (!(await canManageRole(connexion, adminId, users[0].ticket_team === 'fondateur' ? 'fondateur' : users[0].role))) {
      await connexion.rollback();
      return socket.emit('admin error', 'Ce compte dépasse tes droits.');
    }

    // Les contraintes historiques sont volontairement restrictives : on retire
    // d’abord les mouvements liés aux produits avant de supprimer le compte.
    await connexion.query('DELETE h FROM historique h INNER JOIN produits p ON p.id = h.id_art WHERE p.id_user = ?', [targetId]);
    await connexion.query('DELETE FROM historique WHERE id_user = ?', [targetId]);
    await connexion.query('DELETE FROM produits WHERE id_user = ?', [targetId]);
    await connexion.query('DELETE FROM users WHERE id = ?', [targetId]);
    await connexion.commit();
    void logError(adminId, 'suppression_compte', `Compte supprimé : ${users[0].email}.`, { targetId });
    socket.emit('account deleted', { userId: targetId });
  } catch (error) {
    if (connexion) {
      try { await connexion.rollback(); } catch (_) { /* transaction déjà fermée */ }
    }
    void logError(adminId || null, 'suppression_compte', error?.message || 'Impossible de supprimer le compte.', {
      code: error?.code || null,
      targetId
    });
    socket.emit('admin error', 'Impossible de supprimer ce compte.');
  } finally {
    if (connexion) connexion.release();
  }
};
