const { getPool } = require('./db.js');
const { getPermissions } = require('./permissions.js');

function getStatus(user) {
    if (user.permissions?.includes('bypass_subscription')) return { level: 'full', daysExpired: 0 };
    if (user.abo === 1 && !user.date_abo) return { level: 'full', daysExpired: 0 };
    if (!user.date_abo) return { level: 'blocked', daysExpired: null };

    const expiryDate = user.date_abo instanceof Date
        ? `${user.date_abo.getUTCFullYear()}-${String(user.date_abo.getUTCMonth() + 1).padStart(2, '0')}-${String(user.date_abo.getUTCDate()).padStart(2, '0')}`
        : String(user.date_abo).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (!expiryDate) return { level: 'blocked', daysExpired: null };
    const expiry = new Date(`${expiryDate}T23:59:59`);
    const now = new Date();
    if (expiry >= now) return { level: 'full', daysExpired: 0 };
    const daysExpired = Math.floor((now - expiry) / (1000 * 60 * 60 * 24));
    return { level: daysExpired <= 15 ? 'limited' : 'blocked', daysExpired };
}

async function getSubscriptionStatus(userId) {
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        const users = await connexion.query('SELECT id, role, abo, date_abo FROM users WHERE id = ?', [userId]);
        if (!users.length) return { level: 'blocked', daysExpired: null };
        return getStatus({ ...users[0], permissions: await getPermissions(users[0].role) });
    } finally {
        if (connexion) connexion.release();
    }
}

function allows(status, access) {
    return status.level === 'full' || (status.level === 'limited' && access === 'consultation');
}

module.exports = { getStatus, getSubscriptionStatus, allows };
