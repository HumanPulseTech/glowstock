const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initialState, applyCommand } = require('../src/domain');
const { MemoryStore } = require('../src/store');
const { createApp } = require('../src/app');
const { signRequest } = require('../src/signing');
const { createCaisseRouter } = require('../../../integrations/caisse');
const { InputError } = require('../../../integrations/crm-data');
const express = require('express');
const secret = 'isolated-test-gift-bridge-'.repeat(4);
const giftCode = 'GS-0123456789ABCDEF0123456789ABCDEF';
function context(tenant = '42') {
    return { tenantId: tenant, day: '2099-01-01', minuteNow: 600, products: [], appointments: [],
        services: [{ id: 'service-1', kind: 'service', name: 'Pose', unitCents: 3000, taxMode: 'exempt', taxBps: 0 }],
        giftCard: { id: 'gift-1', tenantId: tenant, code: giftCode, availableCents: 5000, status: 'active', expiresAt: '2099-12-31' } };
}
function draft(state, ctx = context()) {
    const d = applyCommand(state, 'open', { key: randomUUID() }, ctx).result;
    return applyCommand(state, 'add', { draftId: d.id, version: d.version, catalogId: 'service-1' }, ctx).result;
}
function input(d, patch = {}) {
    return { draftId: d.id, version: d.version, key: randomUUID(), method: 'cash', tenderedCents: 1500,
        giftCardCode: giftCode, giftCardAmountCents: 2000, ...patch };
}
function quote(state, ctx = context()) { return applyCommand(state, 'gift-card-check', { giftCardCode: giftCode }, ctx).result; }

test('partial gift simulation splits cash/change and closure without changing the actual card snapshot', () => {
    const state = initialState(), ctx = context(), original = structuredClone(ctx);
    const opened = applyCommand(state, 'cash-open', { key: randomUUID(), openingCents: 1000 }, ctx).result;
    const d = draft(state, ctx), result = applyCommand(state, 'simulate', input(d), ctx).result;
    assert.equal(result.simulation.amountCents, 1000);
    assert.equal(result.simulation.changeCents, 500);
    assert.equal(result.simulation.giftCard.amountCents, 2000);
    assert.equal(result.simulation.giftCard.remainingCents, 3000);
    assert.equal(quote(state, ctx).availableCents, 3000);
    assert.equal(quote(state, ctx).realBalanceCents, 5000);
    assert.deepEqual(ctx, original);
    const closed = applyCommand(state, 'cash-close', { key: randomUUID(), sessionId: opened.id, closingCents: 2000 }, ctx).result;
    assert.equal(closed.expectedCents, 2000);
    assert.deepEqual(closed.payments, { ticketCount: 1, cashCents: 1000, cardCents: 0, otherCents: 0, giftCardCents: 2000 });
});

test('repeated simulated use derives remaining balance and cancellation releases it exactly once', () => {
    const state = initialState(), ctx = context();
    const first = draft(state), second = draft(state);
    applyCommand(state, 'simulate', input(first, { giftCardAmountCents: 3000, method: 'card' }), ctx);
    assert.equal(quote(state).availableCents, 2000);
    assert.throws(() => applyCommand(state, 'simulate', input(second, { giftCardAmountCents: 3000 }), ctx), /insuffisant/);
    assert.equal(second.status, 'draft');
    const frozen = structuredClone(first);
    const cancel = { ticketId: first.id, key: randomUUID(), reason: 'Test annulé' };
    const correction = applyCommand(state, 'cancel', cancel, ctx).result;
    assert.equal(correction.giftCardRefundCents, 3000);
    assert.equal(quote(state).availableCents, 5000);
    applyCommand(state, 'cancel', cancel, ctx);
    assert.equal(state.corrections.length, 1);
    assert.equal(quote(state).availableCents, 5000);
    assert.deepEqual(first, frozen);
    assert.throws(() => applyCommand(state, 'cancel', { ...cancel, reason: 'Motif différent' }, ctx), /autre motif/);
    applyCommand(state, 'simulate', input(second, { giftCardAmountCents: 3000, method: 'other' }), ctx);
    assert.equal(second.simulation.amountCents, 0);
    assert.equal(quote(state).availableCents, 2000);
});

test('simulated payment replay checks original version and payload, works after card expires or is disabled', () => {
    const state = initialState(), ctx = context(), d = draft(state), request = input(d);
    const first = structuredClone(applyCommand(state, 'simulate', request, ctx).result);
    ctx.giftCard.status = 'disabled'; ctx.giftCard.availableCents = 0;
    ctx.giftCard.expiresAt = '2000-01-01';
    assert.deepEqual(applyCommand(state, 'simulate', request, ctx).result, first);
    for (const patch of [{ version: first.version }, { giftCardAmountCents: 1000 }, { giftCardCode: 'GS-FFFFFFFFFFFF' }, { method: 'card' }, { tenderedCents: 1800 }, { terminalReference: 'different' }]) {
        assert.throws(() => applyCommand(state, 'simulate', { ...request, ...patch }, ctx), /autre règlement/);
    }
    const second = draft(state, ctx);
    assert.throws(() => applyCommand(state, 'simulate', input(second, { key: request.key }), ctx), /clé.*utilisée/);
});

test('gift simulation rejects cross-tenant, disabled, expired, missing, malformed and exaggerated balances', () => {
    const state = initialState(), d = draft(state);
    const cases = [
        { giftCard: null },
        { giftCard: { ...context().giftCard, tenantId: '99' } },
        { giftCard: { ...context().giftCard, status: 'disabled' } },
        { giftCard: { ...context().giftCard, status: 'expired' } },
        { giftCard: { ...context().giftCard, expiresAt: '2000-01-01' } },
        { giftCard: { ...context().giftCard, expiresAt: 'invalid' } },
        { giftCard: { ...context().giftCard, availableCents: '99999' } },
        { giftCard: { ...context().giftCard, availableCents: 1000 } }
    ];
    for (const patch of cases) assert.throws(() => applyCommand(state, 'simulate', input(d), { ...context(), ...patch }));
    for (const amount of [0, -1, 0.5, '1000', 3001, Number.MAX_SAFE_INTEGER]) assert.throws(() => applyCommand(state, 'simulate', input(d, { giftCardAmountCents: amount }), context()));
    assert.throws(() => applyCommand(state, 'simulate', input(d, { giftCardCode: '' }), context()), /Code/);
    assert.equal(d.status, 'draft');
    assert.equal(quote(state).availableCents, 5000);
});

test('simultaneous HTTP simulations cannot overconsume a card and are isolated per signed tenant', async t => {
    const store = new MemoryStore(), ctx = context();
    const first = await store.run('42', '42', state => ({ result: draft(state, ctx), event: { type: 'test.draft' } }));
    const second = await store.run('42', '42', state => ({ result: draft(state, ctx), event: { type: 'test.draft' } }));
    const app = createApp({ store, secret }), server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const send = async (command, request, tenant = '42', trusted = ctx) => {
        const path = `/v1/${command}`, body = JSON.stringify({ context: trusted, input: request });
        return fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: signRequest(secret, path, tenant, tenant, body), body });
    };
    const responses = await Promise.all([first, second].map(d => send('simulate', input(d, { giftCardAmountCents: 3000, method: 'card' }))));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const checked = await (await send('gift-card-check', { giftCardCode: giftCode })).json();
    assert.equal(checked.availableCents, 2000);
    assert.equal((await send('gift-card-check', { giftCardCode: giftCode }, '99')).status, 403);
    const other = await (await send('gift-card-check', { giftCardCode: giftCode }, '99', context('99'))).json();
    assert.equal(other.availableCents, 5000);
});

test('bridge fetches card from authenticated owner, discards browser balance, and exposes cancellation', async t => {
    const keys = ['CAISSE_ENABLED', 'CAISSE_SERVICE_URL', 'CAISSE_BRIDGE_SECRET', 'CAISSE_ALLOW_PRIVATE_HTTP', 'CAISSE_MODE'];
    const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
    const snapshots = [], reads = [], upstream = express();
    upstream.use(express.raw({ type: 'application/json' }));
    upstream.post('/v1/:command', (req, res) => {
        assert.equal(verify(req).tenant, '42');
        snapshots.push(JSON.parse(req.body)); res.json({ ok: true });
    });
    function verify(req) { return require('../src/signing').verifyRequest(secret, req); }
    const service = upstream.listen(0, '127.0.0.1'); await new Promise(resolve => service.once('listening', resolve));
    Object.assign(process.env, { CAISSE_ENABLED: 'true', CAISSE_SERVICE_URL: `http://127.0.0.1:${service.address().port}`, CAISSE_BRIDGE_SECRET: secret, CAISSE_ALLOW_PRIVATE_HTTP: 'true', CAISSE_MODE: 'production' });
    const app = express(); app.use((req, res, next) => { req.session = { userId: 42 }; next(); });
    const pool = { query: async () => [] };
    app.use('/api/caisse', createCaisseRouter({ getPool: async () => pool, hasPermission: async () => true, getSubscriptionStatus: async () => ({ level: 'full' }),
        limitRequest: () => true, requireSameOrigin: (req, res, next) => next(), lookupGiftCard: async (db, owner, code) => {
            reads.push({ owner, code }); assert.equal(db, pool);
            if (code === 'GS-FFFFFFFFFFFF') throw new InputError('Carte introuvable.', 404);
            return { card: { id: 'gift-1', code: giftCode, balance_cents: 5000, initial_cents: 5000, expires_at: null, effective_status: 'active' } };
        } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => Promise.all([server, service].map(s => new Promise(resolve => s.close(resolve)))));
    const send = (command, input) => fetch(`http://127.0.0.1:${server.address().port}/api/caisse/${command}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal((await send('simulate', { giftCardCode: giftCode, context: { giftCard: { availableCents: 999999 } }, userId: 99 })).status, 200);
    assert.deepEqual(reads, [{ owner: 42, code: giftCode }]);
    assert.equal(snapshots[0].context.giftCard.availableCents, 5000);
    assert.equal(snapshots[0].context.giftCard.tenantId, '42');
    assert.equal((await send('gift-card-check', { giftCardCode: 'GS-FFFFFFFFFFFF' })).status, 404);
    assert.equal(snapshots.length, 1);
    assert.equal((await send('cancel', { ticketId: 'ticket-test' })).status, 200);
    assert.equal(reads.length, 2);
});
