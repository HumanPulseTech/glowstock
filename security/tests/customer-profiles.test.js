const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { profileInput, consentInput } = require('../../integrations/crm-data');

test('customer profile input minimises text and consent requires explicit state', () => {
    assert.deepEqual(profileInput({ preferences: '  Couleurs nude  ', observations: '  Peau sensible signalée  ' }), { preferences: 'Couleurs nude', observations: 'Peau sensible signalée' });
    assert.deepEqual(consentInput({ type: 'Photos avant/après', action: 'granted', details: 'Instagram' }), { type: 'Photos avant/après', action: 'granted', details: 'Instagram' });
    assert.throws(() => consentInput({ type: 'Photos' }), /accordé|retiré/i);
    assert.throws(() => profileInput({ preferences: 'x'.repeat(4001) }), /trop long/i);
});

test('CRM is no longer gated by cashier availability and media is tenant-scoped', () => {
    const source = fs.readFileSync(require.resolve('../../integrations/crm'), 'utf8');
    assert.doesNotMatch(source, /requireCaisseAccess/);
    assert.match(source, /crm_customer_media WHERE id=\? AND customer_id=\? AND id_user=\?/);
    assert.match(source, /X-Content-Type-Options/);
    assert.match(source, /created_at DESC/);
    assert.match(source, /loyalty_accounts WHERE customer_id=\? AND id_user=\?/);
    assert.match(source, /loyalty_ledger WHERE customer_id=\? AND id_user=\?/);
});
