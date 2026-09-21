const { createHash, randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('crypto');
const { promisify } = require('util');
const bcrypt = require('bcrypt');
const scrypt = promisify(scryptCallback);
const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const fingerprint = (hash) => createHash('sha256').update(hash).digest('hex');

function allowedOrigin(origin, configuredOrigin) {
    if (typeof origin !== 'string' || !origin || origin === 'null') return false;
    try { return origin === new URL(configuredOrigin).origin; } catch { return false; }
}

// Same-origin polling GETs may omit Origin. Fetch Metadata is browser-owned.
function allowedSocketRequest(headers, configuredOrigin) {
    if (headers.origin) return allowedOrigin(headers.origin, configuredOrigin);
    try {
        return headers['sec-fetch-site'] === 'same-origin' && headers.host === new URL(configuredOrigin).host;
    } catch { return false; }
}

// Bounded, fixed-window limiter. Fail closed if capacity is exhausted.
function createLimiter(maxKeys = 10000, now = Date.now) {
    const entries = new Map();
    return (key, limit, windowMs) => {
        const time = now();
        if (entries.size >= maxKeys) {
            for (const [id, entry] of entries) if (entry.until <= time) entries.delete(id);
        }
        let entry = entries.get(key);
        if (!entry || entry.until <= time) {
            if (!entry && entries.size >= maxKeys) return false;
            entry = { count: 0, until: time + windowMs };
            entries.set(key, entry);
        }
        if (entry.count >= limit) return false;
        entry.count++;
        return true;
    };
}

async function hashPassword(password) {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
    return `scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
    if (typeof password !== 'string' || password.length > 128 || typeof encoded !== 'string') return false;
    if (encoded.startsWith('$2')) return bcrypt.compare(password, encoded);
    const parts = encoded.split('$');
    if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$3'
        || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
    const key = await scrypt(password, Buffer.from(parts[4], 'hex'), 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(key, Buffer.from(parts[5], 'hex'));
}

async function startSession(request, user) {
    await new Promise((resolve, reject) => request.session.regenerate(error => error ? reject(error) : resolve()));
    Object.assign(request.session, {
        userId: user.id, role: user.role,
        authFingerprint: fingerprint(user.password),
        authenticatedAt: Date.now(), lastActivityAt: Date.now()
    });
    await new Promise((resolve, reject) => request.session.save(error => error ? reject(error) : resolve()));
}
async function validateSession(session, getPool, now = Date.now()) {
    if (!session?.userId || !session.authFingerprint || !Number.isFinite(session.authenticatedAt) || !Number.isFinite(session.lastActivityAt)
        || session.authenticatedAt <= 0 || session.lastActivityAt <= 0 || now < session.authenticatedAt || now < session.lastActivityAt
        || now - session.authenticatedAt >= SESSION_ABSOLUTE_MS || now - session.lastActivityAt >= SESSION_IDLE_MS) return false;
    const pool = await getPool();
    const users = await pool.query('SELECT password, email_verified FROM users WHERE id = ?', [session.userId]);
    return Boolean(users[0] && users[0].email_verified === 1 && fingerprint(users[0].password) === session.authFingerprint);
}
module.exports = { allowedOrigin, allowedSocketRequest, createLimiter, hashPassword, verifyPassword, startSession, validateSession, fingerprint, SESSION_IDLE_MS, SESSION_ABSOLUTE_MS };
