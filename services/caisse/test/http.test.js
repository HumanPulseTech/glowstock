const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { MemoryStore } = require('../src/store');
const { signRequest, verifyRequest } = require('../src/signing');
const secret = 'test-only-bridge-secret-'.repeat(4);
test('signature binds tenant, actor, body, path and time', () => {
    const body = '{}', path = '/v1/workspace'; const headers = signRequest(secret, path, 1, 1, body);
    const req = { method: 'POST', originalUrl: path, body: Buffer.from(body), headers };
    assert.equal(verifyRequest(secret, req).tenant, '1');
    for (const patch of [{ originalUrl: '/v1/simulate' }, { body: Buffer.from('{"admin":true}') }, { headers: { ...headers, 'x-caisse-tenant': '2' } }, { method: 'GET' }]) assert.equal(verifyRequest(secret, { ...req, ...patch }), null);
    assert.equal(verifyRequest(secret, req, Date.now() + 31000), null);
});
test('service HTTP denies replay/unsigned requests and blocks real checkout', async t => {
    const app = createApp({ store: new MemoryStore(), secret });
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const body = JSON.stringify({ context: { products: [], appointments: [] }, input: {} });
    const headers = signRequest(secret, '/v1/workspace', 1, 1, body);
    assert.equal((await fetch(base + '/v1/workspace', { method: 'POST', headers, body })).status, 200);
    assert.equal((await fetch(base + '/v1/workspace', { method: 'POST', headers, body })).status, 401);
    assert.equal((await fetch(base + '/v1/workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
    assert.equal((await fetch(base + '/v1/checkout', { method: 'POST', headers: signRequest(secret, '/v1/checkout', 1, 1, body), body })).status, 501);
});
