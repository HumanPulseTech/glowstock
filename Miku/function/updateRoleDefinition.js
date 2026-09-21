const { getPool } = require('../db.js');
const { hasPermission } = require('../permissions.js');
const { canManageRole } = require('../../security/authorization.js');
const allowed = ['dashboard','inventory','pao','manage_products','manage_pao','access_admin','manage_accounts','manage_subscriptions','manage_roles','bypass_subscription','delete_products','delete_accounts','tickets_view','tickets_manage','tickets_assign','tickets_all'];
module.exports = async function updateRoleDefinition(input, socket) {
  let c; try {
    const userId=socket.request.session?.userId, slug=String(input?.slug||''), nom=String(input?.nom||'').trim().slice(0,100), permissions=Array.isArray(input?.permissions)?input.permissions.filter(x=>allowed.includes(x)):[];
    if (!userId || !(await hasPermission(userId,'manage_roles'))) return socket.emit('admin error','Accès refusé.');
    if (!slug || !nom) return socket.emit('admin error','Informations de rôle invalides.');
    c=await (await getPool()).getConnection(); const roles=await c.query('SELECT slug FROM roles WHERE slug=?',[slug]); if(!roles.length)return socket.emit('admin error','Rôle introuvable.');
    if (!(await canManageRole(c, userId, slug, permissions))) return socket.emit('admin error', 'Tu ne peux pas déléguer ou retirer des droits supérieurs aux tiens.');
    await c.query('UPDATE roles SET nom=?, permissions=? WHERE slug=?',[nom,JSON.stringify(permissions),slug]); require('./logError.js')(userId,'modification_role',`Rôle modifié : ${slug}.`); socket.emit('role definition updated');
  } catch(e){require('./logError.js')(socket.request.session?.userId||null,'modification_role',e.message);socket.emit('admin error','Impossible de modifier le rôle.')} finally{if(c)c.release()}
};
