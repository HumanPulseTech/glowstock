const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('webhook registration and local effects commit together; failures roll back; duplicates do not execute', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../Miku/stripeBilling.js'), 'utf8');
    const snippet = source.slice(source.indexOf('async function processWebhookEvent('), source.indexOf('async function handleWebhook('));
    for (const mode of ['success', 'duplicate', 'failure']) {
        const operations = [];
        const connection = {
            beginTransaction: async () => operations.push('begin'),
            query: async sql => { assert.match(sql, /^INSERT IGNORE/); operations.push('register'); return { affectedRows: mode === 'duplicate' ? 0 : 1 }; },
            rollback: async () => operations.push('rollback'),
            commit: async () => operations.push('commit'),
            release: () => operations.push('release')
        };
        const processEvent = vm.runInNewContext(snippet + '\nprocessWebhookEvent', {
            ensureSchema: async () => {}, getPool: async () => ({ getConnection: async () => connection }),
            syncInvoicePaid: async () => { operations.push('effect'); if (mode === 'failure') throw new Error('DB failure'); }
        });
        if (mode === 'failure') await assert.rejects(processEvent({ id: 'evt-test', type: 'invoice.paid', data: { object: {} } }));
        else await processEvent({ id: 'evt-test', type: 'invoice.paid', data: { object: {} } });
        assert.deepEqual(operations, mode === 'duplicate' ? ['begin', 'register', 'rollback', 'release'] : ['begin', 'register', 'effect', mode === 'failure' ? 'rollback' : 'commit', 'release']);
    }
});
