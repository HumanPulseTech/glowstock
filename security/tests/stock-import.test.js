const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { readWorkbook, mappingInput, normalizeRows, recommendedMapping } = require('../../integrations/stockImport');

test('stock import proposes recognised columns and normalises French amounts', () => {
    const headers = ['Référence fournisseur', 'Nom produit', 'Quantité', 'Prix achat', 'Prix vente', 'Seuil alerte'];
    const map = mappingInput(recommendedMapping(headers), headers.length);
    const result = normalizeRows([['REF-01', 'Base Nude', '12', '4,50', '12.90', '2']], map);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.valid[0], {
        row: 2, reference: 'REF-01', name: 'Base Nude', quantity: 12, category: '', supplier: '', purchasePriceCents: 450,
        salePriceCents: 1290, threshold: 2, barcode: null
    });
});

test('stock import refuses ambiguous mappings and duplicate identifiers', () => {
    assert.throws(() => mappingInput({ reference: 0, name: 0, quantity: 1 }, 3), /correspondre/i);
    const map = mappingInput({ reference: 0, name: 1, quantity: 2, barcode: 3 }, 4);
    const result = normalizeRows([['R-1', 'Gel', '1', '376123'], ['R-2', 'Vernis', '2', '376123']], map);
    assert.equal(result.valid.length, 1);
    assert.match(result.errors[0].message, /Code-barres en doublon/i);
});

test('stock import rejects formula-looking CSV cells', async () => {
    await assert.rejects(() => readWorkbook(Buffer.from('Référence,Nom,Quantité\n=CMD(),Gel,1\n'), 'stock.csv'), /formule/i);
});

test('stock import rejects Excel formulas', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Stock');
    sheet.addRow(['Référence', 'Nom', 'Quantité']);
    sheet.addRow(['R-1', 'Gel', 1]);
    sheet.getCell('C2').value = { formula: '1+1', result: 2 };
    const file = await workbook.xlsx.writeBuffer();
    await assert.rejects(() => readWorkbook(Buffer.from(file), 'stock.xlsx'), /formules/i);
});
