const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const { startSession, validateSession, allowedOrigin } = require('../runtime');

test('real HTTP session: regeneration, old cookie invalidated, origin check and logout', async (t) => {
    const app = express();
    const store = new session.MemoryStore();
    const user = { id: 7, role: 'user', password: 'stored hash', email_verified: 1 };
    app.use(session({ store, secret: 'test-only-secret-not-used-in-production-123', saveUninitialized: false, resave: false, cookie: { httpOnly: true, sameSite: 'lax' } }));
    app.post('/preauth', (req, res) => { req.session.preAuth = true; res.json({ ok: true }); });
    app.post('/login', async (req, res) => {
        if (!allowedOrigin(req.get('origin'), 'https://glowstock.fr')) return res.sendStatus(403);
        await startSession(req, user);
        res.json({ ok: true });
    });
    app.get('/protected', async (req, res) => {
        const ok = await validateSession(req.session, async () => ({ query: async () => [user] }));
        res.sendStatus(ok ? 200 : 401);
    });
    app.post('/logout', (req, res) => req.session.destroy(() => res.sendStatus(204)));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}`;
    const initial = await fetch(url + '/preauth', { method: 'POST' });
    const oldCookie = initial.headers.get('set-cookie').split(';')[0];
    const denied = await fetch(url + '/login', { method: 'POST', headers: { Cookie: oldCookie, Origin: 'https://evil.test' } });
    assert.equal(denied.status, 403);
    const login = await fetch(url + '/login', { method: 'POST', headers: { Cookie: oldCookie, Origin: 'https://glowstock.fr' } });
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const cookie = setCookie.split(';')[0];
    assert.notEqual(cookie, oldCookie);
    assert.equal((await fetch(url + '/protected', { headers: { Cookie: oldCookie } })).status, 401);
    assert.equal((await fetch(url + '/protected', { headers: { Cookie: cookie } })).status, 200);
    await fetch(url + '/logout', { method: 'POST', headers: { Cookie: cookie } });
    assert.equal((await fetch(url + '/protected', { headers: { Cookie: cookie } })).status, 401);
});
