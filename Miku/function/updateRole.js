const { getPool } = require('../db.js');
const { hasPermission } = require('../permissions.js');
const { canManageRole } = require('../../security/authorization.js');
module.exports = async function updateRole(change, socket) {
  let connexion;
  try {
    const adminId = socket.request.session?.userId, targetId = Number(change?.userId), role = String(change?.role || '');
    if (!adminId) return socket.emit('auth error', 'Session expirée.');
    if (targetId === adminId) return socket.emit('admin error', 'Tu ne peux pas modifier ton propre rôle.');
    if (!Number.isInteger(targetId) || !(await hasPermission(adminId, 'manage_accounts'))) return socket.emit('admin error', 'Accès refusé.');
    connexion = await (await getPool()).getConnection();
    const targets = await connexion.query('SELECT role FROM users WHERE id = ?', [targetId]);
    if (!targets[0] || !(await canManageRole(connexion, adminId, targets[0].role)) || !(await canManageRole(connexion, adminId, role))) return socket.emit('admin error', 'Tu ne peux pas attribuer ou modifier un rôle supérieur à tes droits.');
    const roles = await connexion.query('SELECT slug FROM roles WHERE slug = ?', [role]);
    if (!roles.length) return socket.emit('admin error', 'Rôle introuvable.');
    await connexion.query('UPDATE users SET role = ? WHERE id = ?', [role, targetId]);
    require('./logError.js')(adminId, 'changement_role', `Rôle modifié vers ${role}.`, { targetId, role }); socket.emit('role updated');
  } catch (error) { require('./logError.js')(socket.request.session?.userId || null, 'changement_role', error.message); socket.emit('admin error', 'Impossible de modifier le rôle.'); }
  finally { if (connexion) connexion.release(); }
};
