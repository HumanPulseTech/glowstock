const { getPool } = require('../db.js');
const { hasPermission } = require('../permissions.js');
const allowed = ['dashboard','inventory','pao','manage_products','manage_pao','access_admin','manage_accounts','manage_subscriptions','manage_roles','bypass_subscription','delete_products','delete_accounts','tickets_view','tickets_manage','tickets_assign','tickets_all'];
module.exports = async function createRole(input, socket) {
  let connexion;
  try {
    const userId = socket.request.session?.userId, nom = String(input?.nom || '').trim().slice(0,100), permissions = Array.isArray(input?.permissions) ? input.permissions.filter(x => allowed.includes(x)) : [];
    const slug = nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,50);
    if (!userId || !(await hasPermission(userId, 'manage_roles'))) return socket.emit('admin error', 'Accès refusé.');
    if (!nom || !slug) return socket.emit('admin error', 'Nom de rôle invalide.');
    connexion = await (await getPool()).getConnection(); await connexion.query('INSERT INTO roles (slug, nom, permissions) VALUES (?, ?, ?)', [slug, nom, JSON.stringify(permissions)]);
    require('./logError.js')(userId, 'creation_role', `Rôle créé : ${nom}.`, { slug, permissions }); socket.emit('role created');
  } catch (error) { socket.emit('admin error', error?.code === 'ER_DUP_ENTRY' ? 'Ce rôle existe déjà.' : 'Impossible de créer le rôle.'); }
  finally { if (connexion) connexion.release(); }
};
