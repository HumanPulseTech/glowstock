const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bcrypt = require('bcrypt');
const { allowedOrigin, allowedSocketRequest, createLimiter, hashPassword, verifyPassword, startSession, validateSession, fingerprint, SESSION_IDLE_MS, SESSION_ABSOLUTE_MS } = require('../runtime');
const { refreshSessionActivity } = require('../session-activity');

test('origin exact: reject null, absent, suffix, subdomain, HTTP and wrong port', () => {
    assert.equal(allowedOrigin('https://glowstock.fr', 'https://glowstock.fr'), true);
    for (const value of [null, undefined, 'null', '', 'http://glowstock.fr', 'https://glowstock.fr.evil.test', 'https://evil.glowstock.fr', 'https://glowstock.fr:444']) {
        assert.equal(allowedOrigin(value, 'https://glowstock.fr'), false);
    }
});
test('same-origin polling accepts Fetch Metadata only with expected host', () => {
    const headers = { host: 'glowstock.fr', 'sec-fetch-site': 'same-origin' };
    assert.equal(allowedSocketRequest(headers, 'https://glowstock.fr'), true);
    assert.equal(allowedSocketRequest({ ...headers, origin: 'https://evil.test' }, 'https://glowstock.fr'), false);
    assert.equal(allowedSocketRequest({ ...headers, 'sec-fetch-site': 'same-site' }, 'https://glowstock.fr'), false);
    assert.equal(allowedSocketRequest({ ...headers, host: 'evil.test' }, 'https://glowstock.fr'), false);
    assert.equal(allowedSocketRequest({}, 'https://glowstock.fr'), false);
});
test('bounded rate limiter expires entries and fails closed at capacity', () => {
    let now = 1000;
    const allow = createLimiter(2, () => now);
    assert.equal(allow('a', 2, 100), true);
    assert.equal(allow('a', 2, 100), true);
    assert.equal(allow('a', 2, 100), false);
    assert.equal(allow('b', 2, 100), true);
    assert.equal(allow('c', 2, 100), false);
    now += 100;
    assert.equal(allow('c', 2, 100), true);
});
test('scrypt verifies full Unicode password without bcrypt 72-byte truncation', async () => {
    const password = 'é'.repeat(60) + 'ONE';
    const hash = await hashPassword(password);
    assert.ok(hash.length <= 255);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword('é'.repeat(60) + 'TWO', hash), false);
    assert.equal(await verifyPassword('wrong', hash), false);
    assert.notEqual(await hashPassword(password), hash);
    assert.equal(await verifyPassword(password, hash.replace('$32768$', '$999999$')), false);
    assert.equal(await verifyPassword('a'.repeat(129), hash), false);
});
test('existing bcrypt passwords remain usable', async () => {
    const hash = await bcrypt.hash('Existing password 42!', 4);
    assert.equal(await verifyPassword('Existing password 42!', hash), true);
    assert.equal(await verifyPassword('incorrect', hash), false);
});
test('authentication regenerates before writing identity and saving', async () => {
    const calls = [];
    const request = { session: { old: true, regenerate(cb) {
        calls.push('regenerate');
        request.session = { save(done) { calls.push('save'); done(); } };
        cb();
    } } };
    await startSession(request, { id: 42, role: 'user', password: 'hash' });
    assert.deepEqual(calls, ['regenerate', 'save']);
    assert.equal(request.session.old, undefined);
    assert.equal(request.session.userId, 42);
    assert.equal(request.session.authFingerprint, fingerprint('hash'));
});
test('session regeneration failure never establishes identity', async () => {
    const request = { session: { regenerate(cb) { cb(new Error('store unavailable')); } } };
    await assert.rejects(startSession(request, { id: 42, password: 'hash' }));
    assert.equal(request.session.userId, undefined);
});
test('session validates identity, password revocation, deletion, verification and deadlines', async () => {
    const now = 100000000;
    const session = { userId: 7, authFingerprint: fingerprint('hash'), authenticatedAt: now - 5000, lastActivityAt: now - 1000 };
    let rows = [{ password: 'hash', email_verified: 1 }];
    const pool = async () => ({ query: async (sql, params) => { assert.deepEqual(params, [7]); return rows; } });
    assert.equal(await validateSession(session, pool, now), true);
    for (const update of [{ lastActivityAt: now - SESSION_IDLE_MS }, { authenticatedAt: now - SESSION_ABSOLUTE_MS }, { authenticatedAt: NaN }, { authenticatedAt: now + 1 }, { authFingerprint: null }]) {
        assert.equal(await validateSession({ ...session, ...update }, pool, now), false);
    }
    rows = [{ password: 'new hash', email_verified: 1 }];
    assert.equal(await validateSession(session, pool, now), false);
    rows = [{ password: 'hash', email_verified: 0 }];
    assert.equal(await validateSession(session, pool, now), false);
    rows = [];
    assert.equal(await validateSession(session, pool, now), false);
});
test('session refresh only updates existing records, never inserts a revoked session', async () => {
    const store = { options: { schema: { tableName: 'sessions', columnNames: { data: 'data', session_id: 'session_id', expires: 'expires' } } }, query: async (sql, params) => {
        assert.match(sql, /^UPDATE /);
        assert.doesNotMatch(sql, /INSERT|REPLACE/);
        assert.equal(params[5], 'session-test');
        return [{ affectedRows: 0 }];
    } };
    assert.equal(await refreshSessionActivity(store, 'session-test', 100000), false);
    store.query = async () => [{ affectedRows: 1 }];
    assert.equal(await refreshSessionActivity(store, 'session-test', 100000), true);
});
test('CSV cells escape spreadsheet formula prefixes, quotes and separators', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../public/js/inventaire.js'), 'utf8');
    const snippet = source.slice(source.indexOf('const csvCell ='), source.indexOf('const formatFileDate'));
    const cell = vm.runInNewContext(snippet + '\ncsvCell');
    for (const input of ['=1+1', '+cmd', '-1+1', '@SUM(1)', '\tformula', '\rtest', '\nval', '\0test', '  =1+1']) {
        assert.ok(cell(input).startsWith('"\''), input);
    }
    assert.equal(cell('a;"b"'), '"a;""b"""');
    assert.equal(cell('GlowStock'), '"GlowStock"');
});
