const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const ExcelJS = require('exceljs');
const { InputError } = require('./crm-data');

const FIELDS = ['reference', 'name', 'category', 'supplier', 'purchasePrice', 'salePrice', 'quantity', 'threshold', 'barcode'];
const REQUIRED = ['reference', 'name', 'quantity'];
const ALIASES = {
    reference: ['reference', 'reference fournisseur', 'ref fournisseur', 'ref', 'sku'],
    name: ['nom', 'produit', 'nom produit', 'designation', 'désignation'],
    category: ['categorie', 'catégorie', 'famille'], supplier: ['fournisseur', 'marque', 'supplier'],
    purchasePrice: ['prix achat', "prix d'achat", 'cout', 'coût'], salePrice: ['prix vente', 'prix public', 'prix ttc'],
    quantity: ['quantite', 'quantité', 'stock', 'stock initial'], threshold: ['seuil', 'seuil alerte', "seuil d'alerte"],
    barcode: ['code barres', 'code-barres', 'ean', 'barcode']
};
const clean = (value, max = 500) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const header = value => clean(value, 150).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[_\s-]+/g, ' ');
const quantity = value => /^\d{1,7}$/.test(clean(value, 20)) ? Number(clean(value, 20)) : null;
const amount = value => { const text = clean(value, 30).replace(',', '.'); if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) return null; const [whole, fraction = ''] = text.split('.'); return Number(whole) * 100 + Number(fraction.padEnd(2, '0')); };
const cleanReference = value => clean(value, 100);
const cleanBarcode = value => clean(value, 100);
function safeFilename(value) { const name = path.basename(clean(value, 255)); if (!/^[^\\/:*?"<>|]+\.(csv|xlsx)$/i.test(name)) throw new InputError('Choisissez un fichier CSV ou XLSX.'); return name; }
function recommendedMapping(headers) { const normalized = headers.map(header); return Object.fromEntries(FIELDS.map(field => [field, normalized.findIndex(value => ALIASES[field].includes(value))])); }
function inspectXlsxArchive(buffer) {
    const minOffset = Math.max(0, buffer.length - 65557); let eocd = -1;
    for (let offset = buffer.length - 22; offset >= minOffset; offset--) if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
    if (eocd < 0 || eocd + 22 > buffer.length) throw new InputError('Le fichier XLSX est invalide.');
    const entries = buffer.readUInt16LE(eocd + 10), centralSize = buffer.readUInt32LE(eocd + 12), centralOffset = buffer.readUInt32LE(eocd + 16);
    if (!entries || entries > 80 || centralOffset + centralSize > buffer.length) throw new InputError('L’archive XLSX est invalide ou trop complexe.');
    let offset = centralOffset, uncompressed = 0;
    for (let index = 0; index < entries; index++) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new InputError('L’archive XLSX est invalide.');
        const flags = buffer.readUInt16LE(offset + 8), compressed = buffer.readUInt32LE(offset + 20), expanded = buffer.readUInt32LE(offset + 24), nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
        const end = offset + 46 + nameLength + extraLength + commentLength;
        if ((flags & 1) || end > buffer.length || expanded > 20 * 1024 * 1024 || (compressed && expanded > compressed * 100)) throw new InputError('Le fichier XLSX dépasse les limites de sécurité.');
        const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
        if (name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new InputError('Le fichier XLSX contient un chemin invalide.');
        uncompressed += expanded; if (uncompressed > 20 * 1024 * 1024) throw new InputError('Le fichier XLSX dépasse les limites de sécurité.');
        offset = end;
    }
}
function csvRows(buffer) {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const separator = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length && firstLine.includes(';') ? ';' : ',';
    const rows = []; let row = []; let cell = ''; let quoted = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (char === '"') { if (quoted && text[index + 1] === '"') { cell += char; index++; } else quoted = !quoted; }
        else if (char === separator && !quoted) { row.push(cell); cell = ''; }
        else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[index + 1] === '\n') index++; row.push(cell); if (row.some(value => value !== '')) rows.push(row); row = []; cell = ''; }
        else cell += char;
    }
    if (quoted) throw new InputError('Le CSV contient des guillemets non fermés.');
    row.push(cell); if (row.some(value => value !== '')) rows.push(row);
    return rows;
}
async function readWorkbook(buffer, filename) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 5 * 1024 * 1024) throw new InputError('Le fichier doit peser au maximum 5 Mo.');
    if (/\.xlsx$/i.test(filename) && buffer.subarray(0, 2).toString('ascii') !== 'PK') throw new InputError('Le fichier XLSX est invalide.');
    let data;
    if (/\.csv$/i.test(filename)) data = csvRows(buffer);
    else {
        try {
            inspectXlsxArchive(buffer);
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer, { ignoreNodes: ['drawing', 'legacyDrawing', 'picture', 'extLst'] });
            const sheet = workbook.worksheets[0];
            if (!sheet) throw new InputError('Le fichier ne contient aucune feuille.');
            data = [];
            sheet.eachRow({ includeEmpty: false }, row => {
                const values = [];
                row.eachCell({ includeEmpty: true }, (cell, column) => {
                    if (cell.type === ExcelJS.ValueType.Formula || (cell.value && typeof cell.value === 'object' && 'formula' in cell.value)) throw new InputError('Les formules ne sont pas autorisées dans un import de stock.');
                    values[column - 1] = cell.text || cell.value || '';
                });
                data.push(values);
            });
        } catch (error) { if (error instanceof InputError) throw error; throw new InputError('Le fichier ne peut pas être lu.'); }
    }
    if (data.length < 2 || data.length > 1001) throw new InputError('Le fichier doit contenir entre 1 et 1 000 lignes de produits.');
    const headers = data[0].map(value => clean(value, 150));
    if (!headers.some(Boolean) || headers.length > 50) throw new InputError('Les colonnes du fichier sont invalides.');
    if (headers.some(value => /^[=+@]/.test(value))) throw new InputError('Les en-têtes ne peuvent pas contenir de formule.');
    const rows = data.slice(1).map((row, index) => {
        const cells = headers.map((_, column) => clean(row[column], 5000));
        if (cells.some(value => /^[=+@]/.test(value))) throw new InputError(`La ligne ${index + 2} contient une formule non autorisée.`);
        return cells;
    }).filter(row => row.some(Boolean));
    if (!rows.length) throw new InputError('Le fichier ne contient aucune ligne de produit.');
    return { headers, rows };
}
function mappingInput(value, columnCount) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Correspondance des colonnes invalide.');
    const result = {};
    for (const field of FIELDS) {
        const index = Number(value[field]);
        result[field] = Number.isInteger(index) && index >= 0 && index < columnCount ? index : -1;
    }
    if (REQUIRED.some(field => result[field] < 0)) throw new InputError('Référence, nom et quantité sont obligatoires.');
    const used = Object.values(result).filter(index => index >= 0);
    if (new Set(used).size !== used.length) throw new InputError('Une colonne ne peut correspondre qu’à un seul champ.');
    return result;
}
function value(row, map, field, max) { return map[field] < 0 ? '' : clean(row[map[field]], max); }
function normalizeRows(rawRows, map) {
    const seen = new Set(), seenBarcodes = new Set(), valid = [], errors = [];
    rawRows.forEach((row, index) => {
        const reference = cleanReference(value(row, map, 'reference', 100)), name = value(row, map, 'name', 255), count = quantity(value(row, map, 'quantity', 20));
        const purchase = map.purchasePrice < 0 || !value(row, map, 'purchasePrice', 30) ? null : amount(value(row, map, 'purchasePrice', 30));
        const sale = map.salePrice < 0 || !value(row, map, 'salePrice', 30) ? null : amount(value(row, map, 'salePrice', 30));
        const threshold = map.threshold < 0 || !value(row, map, 'threshold', 20) ? 0 : quantity(value(row, map, 'threshold', 20));
        const barcode = cleanBarcode(value(row, map, 'barcode', 100));
        const invalidPurchase = map.purchasePrice >= 0 && value(row, map, 'purchasePrice', 30) && purchase === null;
        const invalidSale = map.salePrice >= 0 && value(row, map, 'salePrice', 30) && sale === null;
        if (!reference || !name || count === null || count > 1000000 || invalidPurchase || invalidSale || threshold === null || threshold > 1000000) return errors.push({ row: index + 2, message: 'Référence, nom, quantité, prix ou seuil invalide.' });
        const key = reference.toLocaleLowerCase('fr'); if (seen.has(key)) return errors.push({ row: index + 2, message: 'Référence en doublon dans le fichier.' }); seen.add(key);
        const barcodeKey = barcode.toLocaleLowerCase('fr'); if (barcodeKey && seenBarcodes.has(barcodeKey)) return errors.push({ row: index + 2, message: 'Code-barres en doublon dans le fichier.' }); if (barcodeKey) seenBarcodes.add(barcodeKey);
        valid.push({ row: index + 2, reference, name, quantity: count, category: value(row, map, 'category', 50), supplier: value(row, map, 'supplier', 150), purchasePriceCents: purchase, salePriceCents: sale, threshold, barcode: barcode || null });
    });
    return { valid, errors };
}
async function access(req, deps) {
    const userId = req.session?.userId; if (!userId) throw new InputError('Session expirée.', 401);
    if (!(await deps.hasPermission(userId, 'manage_products')) || (await deps.getSubscriptionStatus(userId)).level !== 'full') throw new InputError('Ce rôle ne peut pas importer le stock.', 403);
    return userId;
}
async function getImport(pool, id, userId, lock = false) { const rows = await pool.query(`SELECT * FROM stock_imports WHERE id=? AND id_user=?${lock ? ' FOR UPDATE' : ''}`, [id, userId]); if (!rows.length) throw new InputError('Import introuvable.', 404); return rows[0]; }
function importId(value) { return typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value) ? value : (() => { throw new InputError('Identifiant d’import invalide.'); })(); }
function createRouter(deps) {
    const router = express.Router();
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); if (!deps.limitRequest(`stock-import:${req.session?.userId || 'anon'}`, 30, 60000)) return res.sendStatus(429); next(); });
    router.post('/preview', deps.requireSameOrigin, express.raw({ type: 'application/octet-stream', limit: '5mb' }), async (req, res, next) => {
        try { const userId = await access(req, deps); const filename = safeFilename(req.get('x-import-filename') || ''); const parsed = await readWorkbook(req.body, filename), id = crypto.randomUUID(); const pool = await deps.getPool();
            await pool.query('INSERT INTO stock_imports (id,id_user,source_filename,source_sha256,status,raw_rows) VALUES (?,?,?,?,?,?)', [id,userId,filename,crypto.createHash('sha256').update(req.body).digest('hex'),'preview',JSON.stringify(parsed)]);
            res.status(201).json({ importId: id, headers: parsed.headers, sample: parsed.rows.slice(0, 20), recommendedMapping: recommendedMapping(parsed.headers), rowCount: parsed.rows.length });
        } catch (error) { next(error); }
    });
    router.post('/:id/analyze', deps.requireSameOrigin, express.json({ limit: '12kb' }), async (req, res, next) => {
        try { const userId = await access(req, deps), id = importId(req.params.id), pool = await deps.getPool(), record = await getImport(pool, id, userId); if (record.status === 'committed') throw new InputError('Cet import est déjà validé.', 409);
            const source = typeof record.raw_rows === 'string' ? JSON.parse(record.raw_rows) : record.raw_rows, map = mappingInput(req.body.mapping, source.headers.length), normalized = normalizeRows(source.rows, map), refs = normalized.valid.map(item => item.reference), barcodes = normalized.valid.map(item => item.barcode).filter(Boolean);
            const existing = refs.length ? await pool.query(`SELECT id,ref_fournisseur,code_barres FROM produits WHERE id_user=? AND (ref_fournisseur IN (${refs.map(() => '?').join(',')})${barcodes.length ? ` OR code_barres IN (${barcodes.map(() => '?').join(',')})` : ''})`, [userId,...refs,...barcodes]) : [];
            const byRef = new Map(existing.map(item => [String(item.ref_fournisseur).toLocaleLowerCase('fr'), item]));
            const byBarcode = new Map(existing.filter(item => item.code_barres).map(item => [String(item.code_barres).toLocaleLowerCase('fr'), item]));
            const rows = normalized.valid.map(item => {
                const matchingReference = byRef.get(item.reference.toLocaleLowerCase('fr'));
                const barcodeOwner = item.barcode ? byBarcode.get(item.barcode.toLocaleLowerCase('fr')) : null;
                return { row:item.row, reference:item.reference, name:item.name, quantity:item.quantity, status:matchingReference?'existing':'new', barcodeConflict:Boolean(barcodeOwner && (!matchingReference || Number(barcodeOwner.id) !== Number(matchingReference.id))) };
            });
            const report = { total: source.rows.length, valid: normalized.valid.length, invalid: normalized.errors.length, existing: rows.filter(item => item.status==='existing').length, barcodeConflicts: rows.filter(item => item.barcodeConflict).length, errors: normalized.errors.slice(0,100), rows: rows.slice(0,100) };
            await pool.query('UPDATE stock_imports SET status=?,mapping_json=?,report_json=? WHERE id=? AND id_user=?', ['analyzed',JSON.stringify(map),JSON.stringify(report),id,userId]); res.json(report);
        } catch (error) { next(error); }
    });
    router.post('/:id/commit', deps.requireSameOrigin, express.json({ limit: '4kb' }), async (req, res, next) => {
        let c; try { const userId = await access(req, deps), id = importId(req.params.id), strategy = ['skip','add_quantity','update_and_add'].includes(req.body.strategy) ? req.body.strategy : null; if (!strategy) throw new InputError('Choisissez le traitement des produits existants.');
            const pool = await deps.getPool(); c = await pool.getConnection(); await c.beginTransaction(); const record = await getImport(c,id,userId,true); if (record.status === 'committed') { await c.commit(); return res.json(typeof record.report_json === 'string' ? JSON.parse(record.report_json) : record.report_json); } if (record.status !== 'analyzed') throw new InputError('Analysez le fichier avant de l’importer.',409);
            const source = typeof record.raw_rows === 'string' ? JSON.parse(record.raw_rows) : record.raw_rows, map = typeof record.mapping_json === 'string' ? JSON.parse(record.mapping_json) : record.mapping_json, normalized = normalizeRows(source.rows,map); const earlier = typeof record.report_json === 'string' ? JSON.parse(record.report_json) : record.report_json;
            if (normalized.errors.length || earlier.barcodeConflicts) throw new InputError('Corrigez les erreurs ou conflits de code-barres avant validation.',409);
            let created=0, updated=0, skipped=0, movements=0;
            for (const item of normalized.valid) { const products = await c.query('SELECT id,quantite FROM produits WHERE id_user=? AND ref_fournisseur=? FOR UPDATE',[userId,item.reference]); let product=products[0];
                if (product && strategy==='skip') { skipped++; continue; }
                if (product) { const after=Number(product.quantite)+item.quantity; if (after>1000000) throw new InputError(`Stock maximal dépassé pour ${item.reference}.`); if(strategy==='update_and_add') await c.query('UPDATE produits SET nom=?,categorie=?,marque=?,fournisseur=?,prix_achat_centimes=?,code_barres=COALESCE(?,code_barres),seuil_alerte=? WHERE id=? AND id_user=?',[item.name,item.category||null,item.supplier||null,item.supplier||null,item.purchasePriceCents,item.barcode,item.threshold,product.id,userId]); await c.query('UPDATE produits SET quantite=? WHERE id=? AND id_user=?',[after,product.id,userId]); updated++; product={...product,quantite:after}; }
                else { const insert=await c.query('INSERT INTO produits (nom,ref_fournisseur,code_barres,marque,fournisseur,categorie,prix_achat_centimes,quantite,seuil_alerte,suive_alertes,id_user) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[item.name,item.reference,item.barcode,item.supplier||null,item.supplier||null,item.category||null,item.purchasePriceCents,item.quantity,item.threshold,1,userId]); product={id:Number(insert.insertId),quantite:item.quantity}; created++; }
                if(item.salePriceCents!==null) await c.query('INSERT INTO product_prices (product_id,id_user,price_cents) VALUES (?,?,?) ON DUPLICATE KEY UPDATE price_cents=VALUES(price_cents)',[product.id,userId,item.salePriceCents]);
                if(item.quantity>0) { await c.query('INSERT INTO stock_movements (id,id_user,product_id,import_id,source_row,movement_type,quantity_delta,quantity_after) VALUES (?,?,?,?,?,?,?,?)',[crypto.randomUUID(),userId,product.id,id,item.row,'initial_import',item.quantity,Number(product.quantite)]); await c.query('INSERT INTO historique (id_user,type_mouv,value,id_art) VALUES (?,?,?,?)',[userId,'Import stock initial',`+${item.quantity} · import ${id}`,product.id]); movements++; }
            }
            const result={created,updated,skipped,movements,status:'committed'}; await c.query('UPDATE stock_imports SET status=?,report_json=?,committed_at=NOW() WHERE id=? AND id_user=?',['committed',JSON.stringify(result),id,userId]); await c.commit(); res.json(result);
        } catch(error) { if(c) await c.rollback().catch(()=>{}); next(error); } finally { if(c)c.release(); }
    });
    router.use((error,req,res,next)=>{ if(res.headersSent)return next(error); res.status(error.status||503).json({error:error instanceof InputError?error.message:error.code==='ER_NO_SUCH_TABLE'?'Appliquez la migration 024 dans la base GlowStock pour activer l’import initial.':'Import impossible. Réessayez plus tard.'}); }); return router;
}
module.exports = { createRouter, readWorkbook, mappingInput, normalizeRows, recommendedMapping, inspectXlsxArchive };
