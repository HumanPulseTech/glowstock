const { getPool } = require('./db.js');
const { parsePermissions } = require('../security/authorization.js');

async function getPermissions(role) {
  let connexion;
  try {
    connexion = await (await getPool()).getConnection();
    const roles = await connexion.query('SELECT permissions FROM roles WHERE slug = ?', [role]);
    return parsePermissions(roles[0]?.permissions);
  } catch { return []; } finally { if (connexion) connexion.release(); }
}
async function hasPermission(userId, permission) {
  // One query: acquiring another connection while holding the first can
  // exhaust the pool when several permission checks run concurrently.
  const users = await (await getPool()).query(
    'SELECT r.permissions FROM users u LEFT JOIN roles r ON r.slug = u.role WHERE u.id = ?', [userId]
  );
  return parsePermissions(users[0]?.permissions).includes(permission);
}
module.exports = { getPermissions, hasPermission };
