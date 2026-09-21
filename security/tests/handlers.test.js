const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtime = require('../runtime');
function load(name, overrides) {
    const filename = path.join(__dirname, '../../Miku/function', name + '.js');
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, require(id) {
        if (Object.hasOwn(overrides, id)) return overrides[id];
        throw new Error('Unexpected dependency: ' + id);
    } }, { filename });
    return module.exports;
}
const silentLog = { info() {}, warn() {}, error() {} };
test('activation consumes token conditionally and refuses replay/race loser', async () => {
    let consumed = false, sessions = 0, releases = 0;
    const handler = load('validMail', {
        '../db.js': { getPool: async () => ({ getConnection: async () => ({ query: async (sql) => {
            if (sql.startsWith('SELECT')) return [{ id: 1, password: 'hash', role: 'user' }];
            assert.match(sql, /verification_token = \? AND email_verified = 0/);
            const affectedRows = consumed ? 0 : 1;
            consumed = true;
            return { affectedRows };
        }, release() { releases++; } }) }) },
        '../stripeBilling.js': { ensureSchema: async () => {} },
        '../../security/runtime.js': { startSession: async () => { sessions++; } }
    });
    const events = [];
    const socket = { request: {}, emit: (event) => events.push(event) };
    await handler('a'.repeat(64), socket);
    await handler('a'.repeat(64), socket);
    assert.equal(sessions, 1);
    assert.deepEqual(events, ['connection ac', 'verification error']);
    assert.equal(releases, 2);
});
test('login never trusts client role or user id and rejects invalid credentials', async () => {
    let identity;
    const handler = load('connect', {
        '../db.js': { getPool: async () => ({ getConnection: async () => ({ query: async (sql, params) => {
            assert.match(sql, /WHERE email = \?/);
            assert.equal(params[0], 'user@example.test');
            return [{ id: 12, role: 'user', password: 'stored', email_verified: 1 }];
        }, release() {} }) }) },
        '../../security/runtime.js': { verifyPassword: async password => password === 'correct', startSession: async (req, user) => { identity = user; } },
        '../serverLogger.js': silentLog
    });
    const events = [];
    const socket = { request: {}, emit: event => events.push(event) };
    await handler({ email: 'USER@example.test', password: 'wrong', role: 'admin', userId: 99 }, socket);
    assert.equal(identity, undefined);
    await handler({ email: 'USER@example.test', password: 'correct', role: 'admin', userId: 99 }, socket);
    assert.equal(identity.id, 12);
    assert.equal(identity.role, 'user');
    assert.deepEqual(events, ['auth error', 'connection ac']);
});
test('password change compares current secret and refuses concurrent stale update', async () => {
    const events = [];
    const handler = load('updatePassword', {
        '../db.js': { getPool: async () => ({ getConnection: async () => ({ query: async (sql, params) => {
            if (sql.startsWith('SELECT')) return [{ password: 'old' }];
            assert.match(sql, /AND password = \?/);
            assert.equal(params[2], 'old');
            return { affectedRows: 0 };
        }, release() {} }) }) },
        '../../security/runtime.js': { hashPassword: async () => 'new', verifyPassword: async () => true },
        '../../security/password-storage.js': { assertPasswordStorage: async () => {} },
        './logError.js': () => {}
    });
    await handler({ current: 'current', next: 'a valid new password' }, { request: { session: { userId: 1 } }, emit: event => events.push(event) });
    assert.deepEqual(events, ['settings error']);
});

test('stock rejects unowned references and overflows before writing', async () => {
    for (const product of [null, { id: 5, quantite: 999999 }]) {
        let rollback = false;
        const events = [];
        const handler = load('quickRestock', {
            '../db.js': { getPool: async () => ({ getConnection: async () => ({
                beginTransaction: async () => {}, rollback: async () => { rollback = true; }, release() {},
                query: async (sql, params) => {
                    assert.match(sql, /WHERE id_user = \? AND TRIM\(ref_fournisseur\) = \?/);
                    assert.equal(params[0], 7);
                    return product ? [product] : [];
                }
            }) }) },
            '../subscription.js': { getSubscriptionStatus: async () => ({}), allows: () => true },
            '../permissions.js': { hasPermission: async () => true },
            '../serverLogger.js': silentLog,
            './logError.js': () => {}
        });
        await handler({ reference: 'foreign-or-overflow', quantity: 10, userId: 123 }, { request: { session: { userId: 7 } }, emit: event => events.push(event) });
        assert.equal(rollback, true);
        assert.deepEqual(events, ['stock restock error']);
    }
});
