const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initialState, applyCommand, totals, recommendAppointment } = require('../src/domain');
const { MemoryStore, eventMac } = require('../src/store');
const { verifyEvents } = require('../src/verify-events');
const context = { day: '2026-09-21', minuteNow: 600, products: [{ id: 7, name: 'Huile', quantity: 2 }], appointments: [{ id: 5, clientName: 'Cliente test', serviceName: 'Pose', startMinute: 580, endMinute: 630, startTime: '09:40' }] };
const tariff = { kind: 'service', name: 'Pose', unitCents: 5500, taxMode: 'vat', taxBps: 2000 };
function setup() { const state = initialState(); const item = applyCommand(state, 'catalog', tariff, context).result; const draft = applyCommand(state, 'open', { key: randomUUID(), appointmentId: 5 }, context).result; return { state, item, draft }; }
test('appointment prefill keeps authoritative tariff and stable ticket on reconnect', () => {
    const { state, draft } = setup();
    assert.equal(draft.clientName, 'Cliente test'); assert.equal(draft.lines[0].unitCents, 5500);
    assert.equal(applyCommand(state, 'open', { key: randomUUID(), appointmentId: 5 }, context).result.id, draft.id);
    assert.equal(state.drafts.length, 1);
});
test('unknown appointment price remains unpriced, never free by default', () => {
    const state = initialState(); const draft = applyCommand(state, 'open', { key: randomUUID(), appointmentId: 5 }, context).result;
    assert.equal(draft.lines[0].unitCents, null); assert.equal(draft.totals.needsPrice, true);
    assert.throws(() => applyCommand(state, 'simulate', { draftId: draft.id, version: draft.version, key: randomUUID(), method: 'card' }, context), /prix/);
});
test('ambiguous appointment selection never chooses an arbitrary client', () => {
    assert.equal(recommendAppointment(context.appointments, [], 600), 5);
    assert.equal(recommendAppointment([...context.appointments, { ...context.appointments[0], id: 6 }], [], 600), null);
    assert.equal(recommendAppointment(context.appointments, [{ appointmentId: 5, status: 'simulated' }], 600), null);
    assert.equal(recommendAppointment(context.appointments, [], 1000), null);
});
test('money and VAT computed in cents; invalid numeric inputs rejected', () => {
    assert.deepEqual(totals([{ ...tariff, quantity: 1, unitCents: 1200 }]), { grossCents: 1200, taxCents: 200, netCents: 1000, needsPrice: false });
    assert.equal(totals([{ ...tariff, unitCents: 10, quantity: 3, taxMode: 'exempt', taxBps: 0 }]).grossCents, 30);
    for (const value of [-1, NaN, Infinity, 0.5, '1200', 1000001]) assert.throws(() => totals([{ ...tariff, quantity: 1, unitCents: value }]));
    assert.throws(() => totals([{ ...tariff, quantity: 0 }]));
});
test('product tariffs must belong to supplied trusted tenant context', () => {
    assert.throws(() => applyCommand(initialState(), 'catalog', { ...tariff, kind: 'product', productId: 999 }, context), /introuvable/);
    assert.throws(() => applyCommand(initialState(), 'open', { key: randomUUID(), appointmentId: 999 }, context), /introuvable/);
});
test('optimistic version check protects other tabs and frozen simulations', () => {
    const { state, draft, item } = setup(); const previous = draft.version;
    applyCommand(state, 'add', { draftId: draft.id, version: previous, catalogId: item.id }, context);
    assert.throws(() => applyCommand(state, 'add', { draftId: draft.id, version: previous, catalogId: item.id }, context), /autre onglet/);
});
test('simulated cash validation is frozen and idempotent with exact change', () => {
    const { state, draft } = setup(); const key = randomUUID();
    assert.throws(() => applyCommand(state, 'simulate', { draftId: draft.id, version: draft.version, key, method: 'cash', tenderedCents: 5000 }, context), /insuffisant/);
    const input = { draftId: draft.id, version: draft.version, key, method: 'cash', tenderedCents: 6000 };
    const first = applyCommand(state, 'simulate', input, context).result;
    assert.equal(first.simulation.changeCents, 500); assert.match(first.simulation.label, /SANS VALEUR FISCALE/);
    assert.equal(applyCommand(state, 'simulate', input, context).result.id, first.id);
    assert.throws(() => applyCommand(state, 'line', { draftId: draft.id, version: first.version, quantity: 0, lineId: first.lines[0].id }, context), /figé/);
});
test('simulation checks product stock but never changes source inventory', () => {
    const { state, draft } = setup(); const item = applyCommand(state, 'catalog', { ...tariff, kind: 'product', productId: 7 }, context).result;
    for (let i = 0; i < 3; i++) applyCommand(state, 'add', { draftId: draft.id, version: draft.version, catalogId: item.id }, context);
    assert.throws(() => applyCommand(state, 'simulate', { draftId: draft.id, version: draft.version, key: randomUUID(), method: 'card' }, context), /Stock insuffisant/);
    assert.equal(context.products[0].quantity, 2);
});
test('memory store isolates tenants and rolls back failed operations', async () => {
    const store = new MemoryStore();
    await store.run('1', '1', state => applyCommand(state, 'catalog', tariff, context));
    assert.equal((await store.run('2', '2', state => ({ result: state.catalog }))).length, 0);
    await assert.rejects(store.run('1', '1', state => { state.catalog.length = 0; throw new Error('abort'); }));
    assert.equal((await store.run('1', '1', state => ({ result: state.catalog }))).length, 1);
});
test('audit chain detects changed payload, reordered events and truncation with a trusted head', () => {
    const key = 'test audit key'; const rows = []; let previous = '';
    for (let sequence = 1; sequence <= 2; sequence++) {
        const row = { tenant_id: '1', sequence_no: sequence, actor_id: '1', occurred_at: '2026-09-21T12:00:00Z', payload: JSON.stringify({ sequence }), previous_mac: previous };
        row.mac = eventMac(key, '1', sequence, '1', row.occurred_at, previous, row.payload); previous = row.mac; rows.push(row);
    }
    const head = { sequence: 2, mac: previous };
    assert.equal(verifyEvents(rows, key, '1', head), true);
    assert.equal(verifyEvents([rows[1], rows[0]], key, '1', head), false);
    assert.equal(verifyEvents(rows.slice(0, 1), key, '1', head), false);
    assert.equal(verifyEvents([{ ...rows[0], payload: '{}' }, rows[1]], key, '1', head), false);
});
