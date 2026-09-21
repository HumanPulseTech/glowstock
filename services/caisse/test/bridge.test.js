const test = require('node:test');
const assert = require('node:assert/strict');
const { parisClock, loadContext, createCaisseRouter, requireCaisseAccess } = require('../../../integrations/caisse');
const express = require('express');
const { verifyRequest } = require('../src/signing');
test('bridge uses Paris local date including midnight/DST', () => {
    assert.equal(parisClock(new Date('2026-09-20T22:15:00Z')).day, '2026-09-21');
    assert.equal(parisClock(new Date('2026-01-20T23:15:00Z')).minuteNow, 15);
});
test('bridge enforces flag/session/permission/origin and ignores browser tenant/context', async t => {
    const keys = ['CAISSE_ENABLED', 'CAISSE_SERVICE_URL', 'CAISSE_BRIDGE_SECRET', 'CAISSE_ALLOW_PRIVATE_HTTP'];
    const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
    let identity, incoming, requests = 0, loggedIn = true, permission = true, admin = true;
    const secret = 'test-bridge-secret-'.repeat(4);
    const upstream = express(); upstream.use(express.raw({ type: 'application/json' }));
    upstream.post('/v1/workspace', (req, res) => { requests++; identity = verifyRequest(secret, req); incoming = JSON.parse(req.body); res.json({ ok: true }); });
    const privateServer = upstream.listen(0, '127.0.0.1'); await new Promise(r => privateServer.once('listening', r));
    const app = express(); app.use((req, res, next) => { req.session = loggedIn ? { userId: 42, role: 'fondateur' } : {}; next(); });
    const access = { hasPermission: async (id, right) => right === 'access_admin' ? admin : permission, getSubscriptionStatus: async () => ({ level: 'full' }) };
    app.get('/dashboard/caisse/', requireCaisseAccess(access), (req, res) => res.send('Pilot page'));
    app.use('/api/caisse', createCaisseRouter({ getPool: async () => ({ query: async () => [] }), ...access, limitRequest: () => true,
        requireSameOrigin: (req, res, next) => req.headers.origin === 'https://test.example' ? next() : res.sendStatus(403) }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    t.after(() => Promise.all([server, privateServer].map(s => new Promise(r => s.close(r)))));
    Object.assign(process.env, { CAISSE_ENABLED: 'false', CAISSE_SERVICE_URL: `http://127.0.0.1:${privateServer.address().port}`, CAISSE_BRIDGE_SECRET: secret, CAISSE_ALLOW_PRIVATE_HTTP: 'true' });
    const base = `http://127.0.0.1:${server.address().port}/api/caisse`;
    const send = (origin = 'https://test.example') => fetch(base + '/workspace', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ tenant: 999, actor: 999, context: { products: [{ id: 999 }] } }) });
    assert.equal((await (await fetch(base + '/status')).json()).enabled, false);
    assert.equal((await send()).status, 404);
    process.env.CAISSE_ENABLED = 'true'; loggedIn = false;
    assert.equal((await send()).status, 401); loggedIn = true; permission = false;
    assert.equal((await send()).status, 403); permission = true;
    admin = false;
    assert.equal((await (await fetch(base + '/status')).json()).enabled, false);
    assert.equal((await fetch(base + '/inventory')).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/dashboard/caisse/`)).status, 403);
    for (const command of ['workspace', 'catalog', 'open', 'add', 'line', 'simulate']) {
        const denied = await fetch(base + '/' + command, { method: 'POST', headers: { origin: 'https://test.example', 'content-type': 'application/json', 'x-caisse-tenant': '1' }, body: '{"role":"admin"}' });
        assert.equal(denied.status, 403, command);
    }
    admin = true;
    assert.equal((await (await fetch(base + '/status')).json()).enabled, true);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/dashboard/caisse/`)).status, 200);
    assert.equal((await send('https://attacker.example')).status, 403);
    assert.equal(requests, 0);
    assert.equal((await send()).status, 200);
    assert.equal(identity.tenant, '42'); assert.equal(identity.actor, '42');
    assert.deepEqual(incoming.context.products, []);
    // Revocation takes effect on the next request, even with the same session.
    admin = false; assert.equal((await send()).status, 403); admin = true;
    process.env.CAISSE_ALLOW_PRIVATE_HTTP = 'false';
    assert.equal((await send()).status, 503); assert.equal(requests, 1);
});
test('inventory reads only the signed-in account and works without a cashier service or planning table', async t => {
    const previous = process.env.CAISSE_ENABLED; process.env.CAISSE_ENABLED = 'true';
    t.after(() => { if (previous === undefined) delete process.env.CAISSE_ENABLED; else process.env.CAISSE_ENABLED = previous; });
    let account = 42; const calls = [];
    const app = express(); app.use((req, res, next) => { req.session = { userId: account }; next(); });
    app.use('/api/caisse', createCaisseRouter({ hasPermission: async () => true, getSubscriptionStatus: async () => ({ level: 'full' }),
        requireSameOrigin: (req, res, next) => next(), limitRequest: () => true,
        getPool: async () => ({ query: async (sql, args) => {
            calls.push({ sql, args }); assert.match(sql, /^SELECT .* FROM produits WHERE id_user = \?/);
            return [{ id: args[0] + 100, nom: `Produit compte ${args[0]}`, ref_fournisseur: '001259', quantite: 7 }];
        } }) }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    t.after(() => new Promise(r => server.close(r)));
    const base = `http://127.0.0.1:${server.address().port}/api/caisse/inventory?userId=999`;
    const response = await fetch(base); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await response.json()).products, [{ id: 142, name: 'Produit compte 42', reference: '001259', quantity: 7 }]);
    account = 43; assert.equal((await (await fetch(base)).json()).products[0].id, 143);
    assert.deepEqual(calls.map(c => c.args), [[42], [43]]);
});
test('bridge scopes both source queries to authenticated account and excludes notes', async () => {
    const calls = [];
    const pool = { query: async (sql, args) => { calls.push({ sql, args }); return []; } };
    const data = await loadContext(async () => pool, 42);
    assert.equal(calls.length, 2);
    for (const { sql, args } of calls) { assert.match(sql, /WHERE id_user = \?/); assert.equal(args[0], 42); assert.doesNotMatch(sql, /notes/); }
    assert.deepEqual(data.products, []);
});
