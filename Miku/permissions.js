const { getPool } = require('./db.js');

async function getPermissions(role) {
  let connexion;
  try {
    connexion = await (await getPool()).getConnection();
    const roles = await connexion.query('SELECT permissions FROM roles WHERE slug = ?', [role]);
    return roles[0] ? JSON.parse(roles[0].permissions || '[]') : [];
  } catch { return []; } finally { if (connexion) connexion.release(); }
}
async function hasPermission(userId, permission) {
  let connexion;
  try {
    connexion = await (await getPool()).getConnection();
    const users = await connexion.query('SELECT role FROM users WHERE id = ?', [userId]);
    if (!users[0]) return false;
    return (await getPermissions(users[0].role)).includes(permission);
  } finally { if (connexion) connexion.release(); }
}
module.exports = { getPermissions, hasPermission };
