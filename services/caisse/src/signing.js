const { createHmac, timingSafeEqual, randomUUID } = require('node:crypto');
function signature(secret, { method, path, tenant, actor, timestamp, nonce, body }) {
    return createHmac('sha256', secret).update([method, path, tenant, actor, timestamp, nonce, body].join('\n')).digest('hex');
}
function signRequest(secret, path, tenant, actor, body) {
    const timestamp = String(Date.now()), nonce = randomUUID();
    const data = { method: 'POST', path, tenant: String(tenant), actor: String(actor), timestamp, nonce, body };
    return { 'content-type': 'application/json', 'x-caisse-tenant': data.tenant, 'x-caisse-actor': data.actor,
        'x-caisse-time': timestamp, 'x-caisse-nonce': nonce, 'x-caisse-signature': signature(secret, data) };
}
function verifyRequest(secret, req, now = Date.now()) {
    const { 'x-caisse-tenant': tenant, 'x-caisse-actor': actor, 'x-caisse-time': timestamp, 'x-caisse-nonce': nonce, 'x-caisse-signature': supplied } = req.headers;
    if (![tenant, actor].every(s => typeof s === 'string' && /^[1-9][0-9]{0,14}$/.test(s))) return null;
    if (typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 30000) return null;
    if (typeof nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(nonce) || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) return null;
    const expected = signature(secret, { method: req.method, path: req.originalUrl, tenant, actor, timestamp, nonce, body: req.body.toString('utf8') });
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex')) ? { tenant, actor, nonce } : null;
}
module.exports = { signRequest, verifyRequest };
