const test = require('node:test');
const assert = require('node:assert/strict');
const { createSocketGuard } = require('../socket-guard');
const { fingerprint } = require('../runtime');
function fixture() {
    const state = { calls: 0, disconnected: false, events: [], reloadError: false, password: 'stored' };
    const session = { userId: 5, authenticatedAt: Date.now(), lastActivityAt: Date.now(), authFingerprint: fingerprint('stored'), reload(cb) { cb(state.reloadError ? new Error('deleted') : undefined); } };
    const socket = { request: { session, sessionID: 'test-session' }, emit: event => state.events.push(event), disconnect: () => { state.disconnected = true; } };
    const sessionStore = { options: { schema: { tableName: 'sessions', columnNames: { data: 'data', session_id: 'session_id', expires: 'expires' } } }, query: async () => [{ affectedRows: 1 }] };
    const guard = createSocketGuard(socket, { getPool: async () => ({ query: async () => [{ password: state.password, email_verified: 1 }] }), sessionStore, allowAttempt: () => true });
    return { state, guard, socket, next: error => { assert.equal(error, undefined); state.calls++; } };
}
test('Socket.IO reloads session before each protected event; logout invalidates an already open socket', async () => {
    const { state, guard, next } = fixture();
    await guard(['liste inv'], next);
    assert.equal(state.calls, 1);
    state.reloadError = true;
    await guard(['ajout produit'], next);
    assert.equal(state.calls, 1);
    assert.equal(state.disconnected, true);
    assert.deepEqual(state.events, ['auth error']);
});
test('password change invalidates already open sockets on their next operation', async () => {
    const { state, guard, next } = fixture();
    state.password = 'changed';
    await guard(['liste inv'], next);
    assert.equal(state.calls, 0);
    assert.equal(state.disconnected, true);
});
test('only explicit public events bypass session validation', async () => {
    const { state, guard, next } = fixture();
    state.reloadError = true;
    await guard(['feature flags'], next);
    assert.equal(state.calls, 1);
    await guard(['admin data'], next);
    assert.equal(state.calls, 1);
    assert.equal(state.disconnected, true);
});
