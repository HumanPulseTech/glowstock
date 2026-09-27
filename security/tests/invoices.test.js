const test = require('node:test');
const assert = require('node:assert/strict');
const { companyInput, templateInput, customerInput, draftInput } = require('../../integrations/invoices');

test('invoice preparation validates company and professional customer identifiers', () => {
    assert.equal(companyInput({ legalName: ' Institut test ', siret: '12345678901234', email: 'pro@example.test', iban: 'FR7612345678901234567890123' }).legalName, 'Institut test');
    assert.throws(() => companyInput({ siret: '123' }), /invalides/);
    assert.throws(() => customerInput({ invoiceEmail: 'pas-un-email' }), /invalides/);
    assert.equal(customerInput({ companyName: 'Client Pro', electronicAddress: 'factures@example.test' }).companyName, 'Client Pro');
});

test('invoice templates only permit HTTPS logo URLs and hex colors', () => {
    assert.equal(templateInput({ name: 'Sauge', logoUrl: 'https://cdn.example.test/logo.svg', primaryColor: '#4b7158', accentColor: '#efe1d6' }).name, 'Sauge');
    assert.throws(() => templateInput({ name: 'Non', logoUrl: 'http://example.test/logo.png', primaryColor: '#000000', accentColor: '#ffffff' }));
    assert.throws(() => templateInput({ name: 'Non', primaryColor: 'green', accentColor: '#ffffff' }));
});

test('invoice draft retains integer-cent totals and explicit VAT', () => {
    const draft = draftInput({ label: 'Facture octobre', dueDate: '2026-10-31', lines: [{ description: 'Pose', quantity: 2, unitCents: 5500, taxBps: 2000 }] });
    assert.deepEqual(draft.totals, { grossCents: 11000, netCents: 9167, taxCents: 1833 });
    assert.throws(() => draftInput({ label: 'X', lines: [{ description: 'X', quantity: 1.5, unitCents: 1, taxBps: 2000 }] }));
});
