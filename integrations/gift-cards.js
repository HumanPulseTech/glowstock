'use strict';

const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { InputError } = require('./crm-data');

const MAX_CENTS = 1000000;
const PAGE_SIZE = 50;
const sha = value => createHash('sha256').update(value).digest('hex');
const uuid = value => {
    if (typeof value !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)) throw new InputError('Identifiant d’opération invalide.');
    return value.toLowerCase();
};
const owner = value => {
    if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new InputError('Établissement invalide.');
    return Number(value);
};
function field(value, max, required = false) {
    const result = typeof value === 'string' ? value.trim() : '';
    if (result.length > max || /[\u0000-\u001f\u007f]/.test(result) || (required && !result)) throw new InputError('Un champ est manquant ou invalide.');
    return result;
}
function money(value) {
    const text = String(value ?? '').trim().replace(',', '.');
    if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(text)) throw new InputError('Montant invalide.');
    const [whole, fraction = ''] = text.split('.');
    const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (result > MAX_CENTS) throw new InputError('Montant maximal : 10 000 €.');
    return result;
}
function cents(value) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_CENTS) throw new InputError('Montant invalide.');
    return value;
}
function day(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}
function expiry(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '9999-12-31') throw new InputError('Date de validité invalide.');
    const d = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new InputError('Date de validité invalide.');
    return value;
}
function cardCode(value) {
    const code = field(value, 40, true).toUpperCase();
    if (!/^GS-(?:[A-F0-9]{12}|[A-F0-9]{32})$/.test(code)) throw new InputError('Code de carte invalide.');
    return code;
}
function present(card, today = day()) {
    return { ...card, initial_cents: Number(card.initial_cents), balance_cents: Number(card.balance_cents),
        effective_status: card.status === 'active' && card.expires_at && card.expires_at < today ? 'expired' : card.status };
}
// DATE_FORMAT avoids timezone-dependent conversion of a MariaDB DATE to a JS instant.
const CARD_COLUMNS = "id, code, initial_cents, balance_cents, DATE_FORMAT(expires_at, '%Y-%m-%d') AS expires_at, status, issue_kind, tax_treatment, reference, created_at";
const ENTRY_COLUMNS = 'id, gift_card_id, CAST(entry_no AS CHAR) AS entry_no, operation_type, amount_delta_cents, balance_after_cents, reason, reference, reversal_of, created_at';
async function transaction(pool, work) {
    const c = await pool.getConnection();
    try {
        await c.beginTransaction();
        const result = await work(c);
        await c.commit();
        return result;
    } catch (error) { await c.rollback().catch(() => {}); throw error; }
    finally { c.release(); }
}
async function lockRegister(c, userId) {
    // One serialization point per establishment, including issuance and cross-card retries.
    await c.query('INSERT IGNORE INTO gift_card_registers (id_user, next_entry) VALUES (?, 1)', [userId]);
    await c.query('SELECT next_entry FROM gift_card_registers WHERE id_user=? FOR UPDATE', [userId]);
}
async function readCard(c, userId, id, lock = false) {
    const rows = await c.query(`SELECT ${CARD_COLUMNS} FROM gift_cards WHERE id_user=? AND id=?${lock ? ' FOR UPDATE' : ''}`, [userId, id]);
    if (!rows.length) throw new InputError('Carte introuvable.', 404);
    return rows[0];
}
async function append(c, userId, card, op) {
    const [register] = await c.query('SELECT next_entry FROM gift_card_registers WHERE id_user=?', [userId]);
    const sequence = Number(register.next_entry);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= Number.MAX_SAFE_INTEGER) throw new Error('GIFT_SEQUENCE_INVALID');
    const id = randomUUID();
    await c.query(`INSERT INTO gift_card_ledger
        (id,id_user,gift_card_id,operation_key,request_hash,entry_no,operation_type,amount_delta_cents,balance_after_cents,reason,reference,reversal_of,source_key)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,userId,card.id,op.key,op.hash,sequence,op.type,op.delta,card.balance_cents,op.reason,op.reference || '',op.reversalOf || null,op.sourceKey || null]);
    await c.query('UPDATE gift_card_registers SET next_entry=next_entry+1 WHERE id_user=?', [userId]);
    const [entry] = await c.query(`SELECT ${ENTRY_COLUMNS} FROM gift_card_ledger WHERE id_user=? AND id=?`, [userId, id]);
    return entry;
}
async function mutate(pool, userId, operationKey, payload, work) {
    userId = owner(userId);
    const key = sha(uuid(operationKey)), hash = sha(JSON.stringify(payload));
    return transaction(pool, async c => {
        await lockRegister(c, userId);
        const [prior] = await c.query('SELECT id,gift_card_id,request_hash FROM gift_card_ledger WHERE id_user=? AND operation_key=?', [userId, key]);
        if (prior) {
            if (prior.request_hash !== hash) throw new InputError('Cette opération a déjà été utilisée avec des données différentes. Rechargez la fiche.', 409);
            const card = await readCard(c, userId, prior.gift_card_id);
            const [operation] = await c.query(`SELECT ${ENTRY_COLUMNS} FROM gift_card_ledger WHERE id_user=? AND id=?`, [userId, prior.id]);
            return { card: present(card), operation, replayed: true };
        }
        return work(c, userId, { key, hash });
    });
}
async function issueCard(pool, userId, input = {}) {
    const amount = money(input.amount);
    if (amount < 100) throw new InputError('Le montant minimal est de 1 €.');
    const expiresAt = expiry(input.expiresAt), reason = field(input.reason, 500, true);
    const issueKind = input.issueKind, taxTreatment = input.taxTreatment || 'unspecified';
    if (!['gift', 'external_sale'].includes(issueKind) || !['unspecified','single_purpose','multi_purpose'].includes(taxTreatment)) throw new InputError('Nature de la carte invalide.');
    const reference = field(input.reference, 100, issueKind === 'external_sale');
    const payload = { type: 'issued', amount, expiresAt, reason, issueKind, taxTreatment, reference };
    return mutate(pool, userId, input.operationKey, payload, async (c, u, identity) => {
        if (expiresAt && expiresAt < day()) throw new InputError('La date de validité est déjà passée.');
        const id = randomUUID(), code = `GS-${randomBytes(16).toString('hex').toUpperCase()}`;
        await c.query(`INSERT INTO gift_cards (id,id_user,code,initial_cents,balance_cents,expires_at,issue_kind,tax_treatment,reference)
            VALUES (?,?,?,?,?,?,?,?,?)`, [id,u,code,amount,amount,expiresAt,issueKind,taxTreatment,reference]);
        const card = await readCard(c, u, id);
        const operation = await append(c, u, card, { ...identity, type: 'issued', delta: amount, reason, reference });
        return { card: present(card), operation, replayed: false };
    });
}
async function disableCard(pool, userId, id, input = {}) {
    id = uuid(id);
    const reason = field(input.reason, 500, true);
    return mutate(pool, userId, input.operationKey, { type: 'disabled', id, reason }, async (c, u, identity) => {
        const card = await readCard(c, u, id, true);
        if (card.status === 'disabled') throw new InputError('Cette carte est déjà désactivée.', 409);
        await c.query('UPDATE gift_cards SET status=? WHERE id_user=? AND id=?', ['disabled', u, id]);
        card.status = 'disabled';
        const operation = await append(c, u, card, { ...identity, type: 'disabled', delta: 0, reason });
        return { card: present(card), operation, replayed: false };
    });
}
async function getCard(pool, userId, id, before) {
    userId = owner(userId); id = uuid(id);
    const card = await readCard(pool, userId, id);
    let cursor = '', params = [userId, id];
    if (before) {
        const [row] = await pool.query('SELECT entry_no,created_at,id FROM gift_card_ledger WHERE id_user=? AND gift_card_id=? AND id=?', [userId, id, uuid(before)]);
        if (!row) throw new InputError('Page d’historique invalide.');
        cursor = ' AND (COALESCE(entry_no,0) < ? OR (COALESCE(entry_no,0) = ? AND (created_at < ? OR (created_at = ? AND id < ?))))';
        params.push(row.entry_no || 0, row.entry_no || 0, row.created_at, row.created_at, row.id);
    }
    const rows = await pool.query(`SELECT ${ENTRY_COLUMNS} FROM gift_card_ledger WHERE id_user=? AND gift_card_id=?${cursor} ORDER BY gift_card_ledger.entry_no DESC,created_at DESC,id DESC LIMIT ${PAGE_SIZE + 1}`, params);
    return { card: present(card), ledger: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}
async function lookupCard(pool, userId, code) {
    userId = owner(userId); code = cardCode(code);
    const [card] = await pool.query('SELECT id FROM gift_cards WHERE id_user=? AND code=?', [userId, code]);
    if (!card) throw new InputError('Carte introuvable.', 404);
    return getCard(pool, userId, card.id);
}
async function listCards(pool, userId) {
    return (await pool.query(`SELECT ${CARD_COLUMNS} FROM gift_cards WHERE id_user=? ORDER BY created_at DESC,id DESC LIMIT 101`, [owner(userId)])).map(c => present(c));
}
async function expireCards(pool, userId, limit = 100) {
    userId = owner(userId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new InputError('Limite invalide.');
    return transaction(pool, async c => {
        await lockRegister(c, userId);
        const today = day();
        const cards = await c.query(`SELECT ${CARD_COLUMNS} FROM gift_cards WHERE id_user=? AND status='active' AND expires_at < ? ORDER BY expires_at,id LIMIT ${limit} FOR UPDATE`, [userId, today]);
        for (const card of cards) {
            await c.query('UPDATE gift_cards SET status=? WHERE id_user=? AND id=?', ['expired', userId, card.id]);
            await append(c, userId, card, { key: sha(`expiry:${card.id}`), hash: sha(`expiry:${card.expires_at}`), type: 'expired', delta: 0, reason: 'Fin de validité de la carte cadeau' });
        }
        return { expired: cards.length, hasMore: cards.length === limit };
    });
}
// Server-only contract for a FUTURE settled-sale connector. Never called by a browser
// route or the simulation bridge. An environment variable is not settlement evidence.
async function verifiedSettlement(verifySettlement, userId, input, kind) {
    if (typeof verifySettlement !== 'function') throw new InputError('Le connecteur d’encaissement réel n’est pas disponible.', 409);
    const proof = await verifySettlement({ userId, reference: input.reference, kind });
    if (!proof || proof.mode !== 'production' || proof.status !== 'settled' || proof.kind !== kind || Number(proof.userId) !== Number(userId) || proof.reference !== input.reference || proof.giftCardId !== input.giftCardId || !Number.isSafeInteger(proof.amountCents) || proof.amountCents !== input.amountCents || (kind === 'refund' && proof.reversalOf !== input.reversalOf)) throw new InputError('Règlement confirmé introuvable.', 409);
}
async function redeemCard(pool, userId, id, input = {}, { verifySettlement } = {}) {
    id = uuid(id); userId = owner(userId);
    const amountCents = cents(input.amountCents), reference = field(input.reference, 100, true), reason = field(input.reason, 500, true);
    await verifiedSettlement(verifySettlement, userId, { reference, amountCents, giftCardId: id }, 'sale');
    return mutate(pool, userId, input.operationKey, { type: 'redeemed', id, amountCents, reference, reason }, async (c, u, identity) => {
        const card = await readCard(c, u, id, true);
        if (present(card).effective_status !== 'active') throw new InputError('Cette carte est expirée ou désactivée.', 409);
        if (card.tax_treatment === 'unspecified') throw new InputError('Le traitement du bon doit être défini avant son utilisation réelle.', 409);
        if (amountCents > Number(card.balance_cents)) throw new InputError('Solde de carte insuffisant.', 409);
        const sourceKey = sha(`sale:${reference}`);
        if ((await c.query('SELECT id FROM gift_card_ledger WHERE id_user=? AND source_key=?', [u, sourceKey])).length) throw new InputError('Cette vente a déjà débité cette carte. Réutilisez la clé d’origine.', 409);
        card.balance_cents = Number(card.balance_cents) - amountCents;
        await c.query('UPDATE gift_cards SET balance_cents=? WHERE id_user=? AND id=?', [card.balance_cents, u, id]);
        const operation = await append(c, u, card, { ...identity, type: 'redeemed', delta: -amountCents, reference, reason, sourceKey });
        return { card: present(card), operation, replayed: false };
    });
}
async function refundCard(pool, userId, id, input = {}, { verifySettlement } = {}) {
    id = uuid(id); userId = owner(userId);
    const amountCents = cents(input.amountCents), reversalOf = uuid(input.reversalOf), reference = field(input.reference, 100, true), reason = field(input.reason, 500, true);
    await verifiedSettlement(verifySettlement, userId, { reference, amountCents, giftCardId: id, reversalOf }, 'refund');
    return mutate(pool, userId, input.operationKey, { type: 'refunded', id, amountCents, reversalOf, reference, reason }, async (c, u, identity) => {
        const card = await readCard(c, u, id, true);
        const [debit] = await c.query("SELECT amount_delta_cents FROM gift_card_ledger WHERE id_user=? AND gift_card_id=? AND id=? AND operation_type='redeemed'", [u, id, reversalOf]);
        if (!debit) throw new InputError('Débit d’origine introuvable.', 404);
        const [refunded] = await c.query("SELECT COALESCE(SUM(amount_delta_cents),0) AS total FROM gift_card_ledger WHERE id_user=? AND gift_card_id=? AND reversal_of=? AND operation_type='refunded'", [u, id, reversalOf]);
        if (Number(refunded.total) + amountCents > -Number(debit.amount_delta_cents) || Number(card.balance_cents) + amountCents > Number(card.initial_cents)) throw new InputError('Le remboursement dépasse le montant utilisé.', 409);
        const sourceKey = sha(`refund:${reference}`);
        if ((await c.query('SELECT id FROM gift_card_ledger WHERE id_user=? AND source_key=?', [u, sourceKey])).length) throw new InputError('Ce remboursement est déjà enregistré.', 409);
        card.balance_cents = Number(card.balance_cents) + amountCents;
        await c.query('UPDATE gift_cards SET balance_cents=? WHERE id_user=? AND id=?', [card.balance_cents, u, id]);
        const operation = await append(c, u, card, { ...identity, type: 'refunded', delta: amountCents, reference, reason, sourceKey, reversalOf });
        return { card: present(card), operation, replayed: false };
    });
}

module.exports = { money, day, expiry, cardCode, present, issueCard, disableCard, getCard, lookupCard, listCards, expireCards, redeemCard, refundCard };
