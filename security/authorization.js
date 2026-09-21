function parsePermissions(value) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : [];
    } catch { return []; }
}
// A delegated administrator cannot grant or manage privileges they do not hold.
async function canManageRole(connection, actorId, role, proposedPermissions = []) {
    const actors = await connection.query('SELECT u.role, r.permissions FROM users u LEFT JOIN roles r ON r.slug = u.role WHERE u.id = ?', [actorId]);
    if (!actors[0]) return false;
    if (actors[0].role === 'fondateur') return true;
    if (role === 'fondateur') return false;
    const roles = await connection.query('SELECT permissions FROM roles WHERE slug = ?', [role]);
    const own = new Set(parsePermissions(actors[0].permissions));
    return [...parsePermissions(roles[0]?.permissions), ...proposedPermissions].every(permission => own.has(permission));
}
module.exports = { canManageRole, parsePermissions };
