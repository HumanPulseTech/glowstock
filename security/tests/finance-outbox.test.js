const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const finance = require('../../Miku/financeOutbox');

test('a confirmed GlowStock Stripe invoice becomes one stable, minimal Finance revenue event', async () => {
    const before = process.env.FINANCE_OUTBOX_ENABLED;
    process.env.FINANCE_OUTBOX_ENABLED = 'true';
    const calls = [];
    try {
        await finance.enqueueInvoicePaid({ query: async (sql, params) => { calls.push({ sql, params }); return { affectedRows: 1 }; } }, {
            id: 'in_subscription_42', amount_paid: 7990, number: 'GS-42', created: 1780000000,
            customer: 'cus_private_customer_data', metadata: { glowstock_user_id: '123' }
        });
    } finally {
        if (before === undefined) delete process.env.FINANCE_OUTBOX_ENABLED; else process.env.FINANCE_OUTBOX_ENABLED = before;
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params[0], 'glowstock:invoice:in_subscription_42');
    const payload = JSON.parse(calls[0].params[4]);
    assert.deepEqual(payload, { type: 'REVENUE', amountMinor: 7990, currency: 'EUR', effectiveAt: '2026-05-28', sourceSystem: 'glowstock', externalEventId: 'in_subscription_42', category: 'subscription', description: 'Abonnement GlowStock - facture GS-42', metadata: { invoiceId: 'in_subscription_42' } });
    assert.equal(JSON.stringify(payload).includes('cus_private'), false);
});

test('retry delay increases but stable event IDs never change', () => {
    assert.equal(finance.retryDelayMs(1), 30000);
    assert.equal(finance.retryDelayMs(2), 60000);
    assert.equal(finance.retryDelayMs(50), 21600000);
    const event = finance.financePayload({ type: 'REVENUE', externalEventId: 'in_1', amountMinor: 100, effectiveAt: '2026-09-28', category: 'subscription', description: 'Test' });
    assert.equal(event.externalEventId, 'in_1');
});

test('a claimed Finance event cannot be claimed by the next worker', async () => {
    const state = { row: { event_id: 'glowstock:invoice:in_1', attempt_count: 0, status: 'pending' } };
    const pool = { getConnection: async () => ({
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
        query: async (sql) => {
            if (sql.startsWith('SELECT')) return state.row?.status === 'pending' ? [state.row] : [];
            if (sql.startsWith('UPDATE')) { state.row.status = 'processing'; return { affectedRows: 1 }; }
            throw new Error('Requête inattendue');
        }
    }) };
    const first = await finance.claimNext(pool);
    const second = await finance.claimNext(pool);
    assert.equal(first.event_id, 'glowstock:invoice:in_1');
    assert.equal(second, null);
});

test('Finance is attached only to GlowStock Stripe billing and is structurally absent from Caisse', () => {
    const root = path.join(__dirname, '../..');
    const stripe = fs.readFileSync(path.join(root, 'Miku/stripeBilling.js'), 'utf8');
    const outbox = fs.readFileSync(path.join(root, 'Miku/financeOutbox.js'), 'utf8');
    const caisseBridge = fs.readFileSync(path.join(root, 'integrations/caisse.js'), 'utf8');
    const caisseServer = fs.readFileSync(path.join(root, 'services/caisse/src/server.js'), 'utf8');
    assert.match(stripe, /await enqueueInvoicePaid\(connexion, invoice\)/);
    assert.match(stripe, /case 'refund\.created'/);
    assert.doesNotMatch(outbox, /caisse/i);
    assert.doesNotMatch(caisseBridge, /financeOutbox|HUMAN_PULSE_FINANCE|finance_outbox/i);
    assert.doesNotMatch(caisseServer, /HUMAN_PULSE_FINANCE|finance_outbox/i);
});
