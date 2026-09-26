const test = require('node:test');
const assert = require('node:assert/strict');
const { SqlStore, eventMac } = require('../src/store');
function fixture(failUpdate = false) {
    const calls = [];
    const connection = {
        beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
        rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
        query: async (sql, args) => {
            calls.push({ sql, args });
            if (sql.startsWith('SELECT')) return [[{ data: '{"catalog":[],"drafts":[]}', sequence_no: 0, last_mac: '' }]];
            if (failUpdate && sql.startsWith('UPDATE')) throw new Error('database interruption');
            return [{}];
        }
    };
    return { calls, store: new SqlStore({ getConnection: async () => connection }, 'audit-test-key') };
}
test('SQL store locks tenant and commits event and state in one transaction', async () => {
    const { calls, store } = fixture();
    await store.run('42', '42', state => { state.catalog.push({ id: 'test' }); return { result: 'ok', event: { type: 'test' } }; });
    assert.equal(calls[0], 'begin'); assert.deepEqual(calls.slice(-2), ['commit', 'release']);
    const locked = calls.find(c => c.sql?.startsWith('SELECT'));
    assert.match(locked.sql, /FOR UPDATE/); assert.deepEqual(locked.args, ['42']);
    const event = calls.find(c => c.sql?.startsWith('INSERT INTO caisse_events'));
    const [tenant, seq, actor, time, payload, previous, mac] = event.args;
    assert.equal(mac, eventMac('audit-test-key', tenant, seq, actor, time, previous, payload));
    const update = calls.find(c => c.sql?.startsWith('UPDATE'));
    assert.deepEqual(update.args.slice(1), [1, mac, '42']);
});
test('SQL store accepts a native JSON value returned by the MariaDB driver', async () => {
    const connection = {
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
        query: async sql => sql.startsWith('SELECT') ? [[{ data: { catalog: [], drafts: [] }, sequence_no: 0, last_mac: '' }]] : [{}]
    };
    const jsonStore = new SqlStore({ getConnection: async () => connection }, 'audit-test-key');
    await jsonStore.run('42', '42', state => ({ result: state.catalog.length }));
    assert.equal(await jsonStore.run('42', '42', state => ({ result: state.drafts.length })), 0);
});
test('SQL store verifies the persisted audit chain against its current head', async () => {
    const calls = [];
    const connection = {
        beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'), rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
        query: async sql => {
            if (sql.includes('FROM caisse_state')) return [[{ sequence_no: 0, last_mac: '' }]];
            if (sql.includes('FROM caisse_events')) return [[]];
            throw new Error('Unexpected query');
        }
    };
    const store = new SqlStore({ getConnection: async () => connection }, 'audit-test-key');
    const result = await store.verify('42');
    assert.deepEqual(result, { ok: true, eventCount: 0, sequence: 0, sealedClosures: 0, scope: 'sql-audit-chain' });
    assert.deepEqual(calls, ['begin', 'commit', 'release']);
});
test('SQL store seals a closing report with its immutable event MAC', async () => {
    const starting = { catalog: [], drafts: [], cashSession: { id: 'close-1', status: 'closed' }, cashClosures: [{ id: 'close-1', status: 'closed', closingCents: 1200 }] };
    const calls = [];
    const connection = {
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
        query: async (sql, args) => {
            calls.push({ sql, args });
            if (sql.startsWith('SELECT')) return [[{ data: JSON.stringify(starting), sequence_no: 0, last_mac: '' }]];
            return [{}];
        }
    };
    const store = new SqlStore({ getConnection: async () => connection }, 'audit-test-key');
    const result = await store.run('42', '42', state => ({ result: state.cashClosures[0], event: { type: 'cash_session.closed', session: structuredClone(state.cashClosures[0]) } }));
    const event = calls.find(call => call.sql.startsWith('INSERT INTO caisse_events'));
    const update = calls.find(call => call.sql.startsWith('UPDATE caisse_state'));
    assert.equal(result.auditSeal, event.args[6]);
    assert.equal(JSON.parse(update.args[0]).cashClosures[0].auditSeal, event.args[6]);
});
test('SQL store rolls back instead of committing an incomplete event/state change', async () => {
    const { calls, store } = fixture(true);
    await assert.rejects(store.run('42', '42', () => ({ event: { type: 'test' } })), /interruption/);
    assert.deepEqual(calls.slice(-2), ['rollback', 'release']); assert.equal(calls.includes('commit'), false);
});
