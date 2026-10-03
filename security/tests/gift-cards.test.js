'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const gifts = require('../../integrations/gift-cards');
const { memoryDatabase } = require('./helpers/gift-memory-db');

const issuance = (overrides = {}) => ({ operationKey: randomUUID(), amount: '50,00', expiresAt: '2099-12-31', issueKind: 'gift', taxTreatment: 'multi_purpose', reason: 'Cadeau de bienvenue', ...overrides });
const consumption = (overrides = {}) => ({ operationKey: randomUUID(), amountCents: 2000, reference: randomUUID(), reason: 'Paiement prestation', ...overrides });
const status = expected => error => { assert.equal(error.status, expected); return true; };
function settled(cardId, overrides = {}) {
    return { verifySettlement: async ({ userId, reference, kind, ...details }) => ({ mode: 'production', status: 'settled', kind, userId, reference, giftCardId: cardId, amountCents: 2000, ...details, ...overrides }) };
}
async function fixture(input = {}) {
    const db = memoryDatabase(), created = await gifts.issueCard(db.pool, 7, issuance(input));
    return { ...db, ...created, db };
}

test('gift input uses exact cents, real dates and Paris calendar days', () => {
    assert.equal(gifts.money('12,50'), 1250);
    assert.equal(gifts.money('0.01'), 1);
    assert.equal(gifts.money('10000'), 1000000);
    for (const value of ['-1', '1e2', '1.001', '10000.01', '', 'NaN', 'Infinity']) assert.throws(() => gifts.money(value));
    assert.equal(gifts.expiry('2028-02-29'), '2028-02-29');
    assert.equal(gifts.expiry(''), null);
    for (const value of ['2027-02-29', '2026-13-01', '2026-04-31', '01/12/2026', new Date()]) assert.throws(() => gifts.expiry(value));
    assert.equal(gifts.day(new Date('2026-10-03T22:30:00Z')), '2026-10-04');
    assert.equal(gifts.cardCode('gs-aabbccddeeff'), 'GS-AABBCCDDEEFF');
    assert.throws(() => gifts.cardCode('https://example.test/card'));
});

test('issuance is exactly once, records sequence and rejects changed replay content', async () => {
    const db = memoryDatabase(), input = issuance();
    const first = await gifts.issueCard(db.pool, 7, input), second = await gifts.issueCard(db.pool, 7, input);
    assert.equal(second.replayed, true);
    assert.equal(second.card.id, first.card.id);
    assert.equal(second.operation.id, first.operation.id);
    assert.match(first.card.code, /^GS-[A-F0-9]{32}$/);
    assert.equal(first.card.initial_cents, 5000);
    assert.equal(first.operation.amount_delta_cents, 5000);
    assert.equal(Number(first.operation.entry_no), 1);
    for (const change of [{ amount: '51' }, { reason: 'Autre' }, { reference: 'A' }, { issueKind: 'external_sale', reference: 'Ticket 1' }, { expiresAt: '2099-12-30' }, { taxTreatment: 'single_purpose' }]) {
        await assert.rejects(gifts.issueCard(db.pool, 7, { ...input, ...change }), status(409));
    }
    assert.equal(db.snapshot().cards.length, 1);
    assert.equal(db.snapshot().ledger.length, 1);
});

test('simultaneous issuance retries publish a single card and movement', async () => {
    const db = memoryDatabase(), input = issuance();
    const results = await Promise.all([gifts.issueCard(db.pool, 7, input), gifts.issueCard(db.pool, 7, input)]);
    assert.equal(results.filter(row => row.replayed).length, 1);
    assert.equal(results[0].card.id, results[1].card.id);
    assert.equal(db.snapshot().ledger.length, 1);
});

test('tenant ownership is enforced on detail, lookup, history, disable and consumption', async () => {
    const f = await fixture();
    await assert.rejects(gifts.getCard(f.pool, 8, f.card.id), status(404));
    await assert.rejects(gifts.lookupCard(f.pool, 8, f.card.code), status(404));
    await assert.rejects(gifts.disableCard(f.pool, 8, f.card.id, { operationKey: randomUUID(), reason: 'Test' }), status(404));
    await assert.rejects(gifts.redeemCard(f.pool, 8, f.card.id, consumption(), settled(f.card.id)), status(404));
    assert.deepEqual(await gifts.listCards(f.pool, 8), []);
    const other = await gifts.issueCard(f.pool, 8, issuance());
    await assert.rejects(gifts.getCard(f.pool, 7, f.card.id, other.operation.id), status(400));
    assert.equal((await gifts.lookupCard(f.pool, 7, f.card.code)).card.id, f.card.id);
    assert.equal(f.snapshot().cards.find(row => row.id === f.card.id).balance_cents, 5000);
});

test('partial consumption and partial refunds preserve append-only balances', async () => {
    const f = await fixture(), debitInput = consumption();
    const debit = await gifts.redeemCard(f.pool, 7, f.card.id, debitInput, settled(f.card.id));
    assert.equal(debit.card.balance_cents, 3000);
    const replay = await gifts.redeemCard(f.pool, 7, f.card.id, debitInput, settled(f.card.id));
    assert.equal(replay.replayed, true);
    const refundInput = consumption({ amountCents: 500, reversalOf: debit.operation.id });
    const proof = settled(f.card.id, { amountCents: 500, reversalOf: debit.operation.id });
    const refund = await gifts.refundCard(f.pool, 7, f.card.id, refundInput, proof);
    assert.equal(refund.card.balance_cents, 3500);
    assert.equal(refund.operation.reversal_of, debit.operation.id);
    assert.equal((await gifts.refundCard(f.pool, 7, f.card.id, refundInput, proof)).replayed, true);
    await assert.rejects(gifts.refundCard(f.pool, 7, f.card.id, consumption({ amountCents: 1600, reversalOf: debit.operation.id }), settled(f.card.id, { amountCents: 1600, reversalOf: debit.operation.id })), status(409));
    await gifts.refundCard(f.pool, 7, f.card.id, consumption({ amountCents: 1500, reversalOf: debit.operation.id }), settled(f.card.id, { amountCents: 1500, reversalOf: debit.operation.id }));
    const ledger = f.snapshot().ledger;
    assert.deepEqual(ledger.map(row => row.amount_delta_cents), [5000, -2000, 500, 1500]);
    assert.deepEqual(ledger.map(row => row.balance_after_cents), [5000, 3000, 3500, 5000]);
    assert.deepEqual(ledger.map(row => row.entry_no), [1, 2, 3, 4]);
    assert.equal(ledger[1].id, debit.operation.id);
    assert.equal(ledger[1].amount_delta_cents, -2000);
});

test('competing debit transactions cannot overspend and failed write rolls back balance and sequence', async () => {
    const f = await fixture();
    const attempts = await Promise.allSettled([1, 2].map(() => gifts.redeemCard(f.pool, 7, f.card.id, consumption({ amountCents: 3500 }), settled(f.card.id, { amountCents: 3500 }))));
    assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(row => row.status === 'rejected').reason.status, 409);
    assert.equal(f.snapshot().cards[0].balance_cents, 1500);
    const before = f.snapshot();
    f.failNext(/^INSERT INTO gift_card_ledger/);
    const retryable = consumption({ amountCents: 1000 });
    await assert.rejects(gifts.redeemCard(f.pool, 7, f.card.id, retryable, settled(f.card.id, { amountCents: 1000 })), /Injected/);
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.calls.slice(-2), ['rollback', 'release']);
    const completed = await gifts.redeemCard(f.pool, 7, f.card.id, retryable, settled(f.card.id, { amountCents: 1000 }));
    assert.equal(completed.card.balance_cents, 500);
    assert.equal(Number(completed.operation.entry_no), 3);
});

test('failed issuance does not leave a funded card or consume its operation key', async () => {
    const db = memoryDatabase(), input = issuance();
    db.failNext(/^INSERT INTO gift_card_ledger/);
    await assert.rejects(gifts.issueCard(db.pool, 7, input), /Injected/);
    assert.equal(db.snapshot().cards.length, 0);
    const result = await gifts.issueCard(db.pool, 7, input);
    assert.equal(result.replayed, false);
    assert.equal(Number(result.operation.entry_no), 1);
});

test('settled evidence is mandatory and bound to exact tenant/card/allocation; environment cannot authorize debit', async () => {
    const f = await fixture(), input = consumption(), old = process.env.CAISSE_MODE;
    process.env.CAISSE_MODE = 'production';
    try {
        await assert.rejects(gifts.redeemCard(f.pool, 7, f.card.id, input), status(409));
        for (const patch of [{ mode: 'simulation' }, { status: 'pending' }, { kind: 'refund' }, { userId: 8 }, { reference: 'wrong' }, { giftCardId: randomUUID() }, { amountCents: 1999 }, { amountCents: 2001 }, { amountCents: '2000' }]) {
            await assert.rejects(gifts.redeemCard(f.pool, 7, f.card.id, input, settled(f.card.id, patch)), status(409));
        }
        await assert.rejects(gifts.redeemCard(f.pool, 7, f.card.id, input, { verifySettlement: async () => null }), status(409));
    } finally { if (old === undefined) delete process.env.CAISSE_MODE; else process.env.CAISSE_MODE = old; }
    assert.equal(f.snapshot().cards[0].balance_cents, 5000);
    assert.equal(f.snapshot().ledger.length, 1);
});

test('a settled sale reference cannot charge twice, including with another card or operation key', async () => {
    const f = await fixture(), other = await gifts.issueCard(f.pool, 7, issuance()), input = consumption();
    await gifts.redeemCard(f.pool, 7, f.card.id, input, settled(f.card.id));
    await assert.rejects(gifts.redeemCard(f.pool, 7, f.card.id, { ...input, operationKey: randomUUID() }, settled(f.card.id)), status(409));
    await assert.rejects(gifts.redeemCard(f.pool, 7, other.card.id, { ...input, operationKey: randomUUID() }, settled(other.card.id)), status(409));
    await assert.rejects(gifts.redeemCard(f.pool, 7, other.card.id, input, settled(other.card.id)), status(409));
    assert.equal(f.snapshot().cards.find(row => row.id === other.card.id).balance_cents, 5000);
});

test('refund evidence binds the original debit, cannot repeat source reference or exceed remaining refundable value', async () => {
    const f = await fixture(), debit = await gifts.redeemCard(f.pool, 7, f.card.id, consumption(), settled(f.card.id));
    const input = consumption({ amountCents: 1000, reversalOf: debit.operation.id });
    await assert.rejects(gifts.refundCard(f.pool, 7, f.card.id, input), status(409));
    await assert.rejects(gifts.refundCard(f.pool, 7, f.card.id, input, settled(f.card.id, { amountCents: 1000, reversalOf: randomUUID() })), status(409));
    const proof = settled(f.card.id, { amountCents: 1000, reversalOf: debit.operation.id });
    await gifts.refundCard(f.pool, 7, f.card.id, input, proof);
    await assert.rejects(gifts.refundCard(f.pool, 7, f.card.id, { ...input, operationKey: randomUUID() }, proof), status(409));
    const attempts = await Promise.allSettled([1, 2].map(() => gifts.refundCard(f.pool, 7, f.card.id, consumption({ amountCents: 1000, reversalOf: debit.operation.id }), proof)));
    assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(row => row.status === 'rejected').reason.status, 409);
    assert.equal(f.snapshot().cards[0].balance_cents, 5000);
});

test('expired/disabled cards cannot spend; expiration is bounded, tenant-scoped and idempotent without erasing value', async () => {
    const f = await fixture(), other = await gifts.issueCard(f.pool, 8, issuance());
    f.seedCard(f.card.id, { expires_at: '2001-01-01' });
    f.seedCard(other.card.id, { expires_at: '2001-01-01' });
    assert.equal((await gifts.getCard(f.pool, 7, f.card.id)).card.effective_status, 'expired');
    await assert.rejects(gifts.redeemCard(f.pool, 7, f.card.id, consumption(), settled(f.card.id)), status(409));
    assert.deepEqual(await gifts.expireCards(f.pool, 7), { expired: 1, hasMore: false });
    assert.deepEqual(await gifts.expireCards(f.pool, 7), { expired: 0, hasMore: false });
    assert.equal(f.snapshot().cards.find(row => row.id === other.card.id).status, 'active');
    const card = f.snapshot().cards.find(row => row.id === f.card.id);
    assert.equal(card.balance_cents, 5000);
    assert.equal(card.status, 'expired');
    assert.equal(f.snapshot().ledger.at(-1).amount_delta_cents, 0);
    const active = await gifts.issueCard(f.pool, 7, issuance());
    const disable = { operationKey: randomUUID(), reason: 'Carte perdue' };
    await gifts.disableCard(f.pool, 7, active.card.id, disable);
    assert.equal((await gifts.disableCard(f.pool, 7, active.card.id, disable)).replayed, true);
    await assert.rejects(gifts.redeemCard(f.pool, 7, active.card.id, consumption(), settled(active.card.id)), status(409));
    await assert.rejects(gifts.disableCard(f.pool, 7, active.card.id, { ...disable, operationKey: randomUUID() }), status(409));
});

test('refund restores credit but cannot reactivate a disabled or expired card', async () => {
    for (const cardStatus of ['disabled', 'expired']) {
        const f = await fixture(), debit = await gifts.redeemCard(f.pool, 7, f.card.id, consumption(), settled(f.card.id));
        f.seedCard(f.card.id, { status: cardStatus });
        const input = consumption({ reversalOf: debit.operation.id });
        const result = await gifts.refundCard(f.pool, 7, f.card.id, input, settled(f.card.id, { reversalOf: debit.operation.id }));
        assert.equal(result.card.balance_cents, 5000);
        assert.equal(result.card.status, cardStatus);
    }
});

test('unclassified vouchers cannot be debited and external sales require a reference', async () => {
    const f = await fixture({ taxTreatment: 'unspecified' });
    await assert.rejects(gifts.redeemCard(f.pool, 7, f.card.id, consumption(), settled(f.card.id)), status(409));
    await assert.rejects(gifts.issueCard(f.pool, 7, issuance({ issueKind: 'external_sale', reference: '' })), status(400));
    await assert.rejects(gifts.issueCard(f.pool, 7, issuance({ expiresAt: '2001-01-01' })), status(400));
    assert.equal(f.snapshot().cards.length, 1);
});
