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
test('SQL store rolls back instead of committing an incomplete event/state change', async () => {
    const { calls, store } = fixture(true);
    await assert.rejects(store.run('42', '42', () => ({ event: { type: 'test' } })), /interruption/);
    assert.deepEqual(calls.slice(-2), ['rollback', 'release']); assert.equal(calls.includes('commit'), false);
});
