'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createPublicRouter } = require('../../integrations/booking');

async function request(app, path) {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        return { status: response.status, body: await response.json() };
    } finally { await new Promise(resolve => server.close(resolve)); }
}

test('public cancellation retains the appointment and customer history instead of deleting it', async () => {
    const calls = [], token = 'A'.repeat(43);
    const connection = {
        async beginTransaction() { calls.push('begin'); }, async commit() { calls.push('commit'); }, async rollback() { calls.push('rollback'); }, release() { calls.push('release'); },
        async query(sql, args = []) {
            calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), args });
            if (/SELECT b\.id/.test(sql)) return [{ id: 'booking-1', appointment_id: 42, status: 'confirmed', cancellation_hours: 1, day: '2030-02-01', start: '12:00' }];
            if (/UPDATE booking_requests/.test(sql)) return { affectedRows: 1 };
            if (/UPDATE planning_entries/.test(sql)) return { affectedRows: 1 };
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };
    const pool = { getConnection: async () => connection };
    const app = express();
    app.use('/booking', createPublicRouter({ getPool: async () => pool, limitRequest: () => true }));
    const result = await request(app, `/booking/cancel/${token}`);
    assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true });
    const sql = calls.filter(item => item.sql).map(item => item.sql).join('\n');
    assert.doesNotMatch(sql, /DELETE FROM planning_entries/i);
    assert.match(sql, /UPDATE planning_entries SET status="cancelled"/);
    assert.match(sql, /cancellation_reason/);
    assert.deepEqual(calls.filter(item => typeof item === 'string'), ['begin', 'commit', 'release']);
});

test('cancelled appointments are excluded from availability, planning and cashier contexts but remain in CRM history', () => {
    const files = {
        booking: require('node:fs').readFileSync(require.resolve('../../integrations/booking'), 'utf8'),
        planning: require('node:fs').readFileSync(require.resolve('../../Miku/function/planningData'), 'utf8'),
        caisse: require('node:fs').readFileSync(require.resolve('../../integrations/caisse'), 'utf8'),
        crm: require('node:fs').readFileSync(require.resolve('../../integrations/crm'), 'utf8')
    };
    for (const source of [files.booking, files.planning, files.caisse]) assert.match(source, /status='confirmed'/);
    assert.match(files.crm, /p\.status, p\.cancelled_at/);
    assert.match(files.crm, /p\.cancellation_reason/);
});
