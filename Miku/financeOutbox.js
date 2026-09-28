// Human Pulse Finance boundary: only Human Pulse Tech revenue/refund events belong here.
// Do not import this module from point-of-sale modules or services.
const { randomUUID } = require('node:crypto');
const { getPool } = require('./db.js');
const serverLogger = require('./serverLogger.js');

let schemaPromise = null;
let workerTimer = null;
let workerRunning = false;

function enabled() { return String(process.env.FINANCE_OUTBOX_ENABLED || '').toLowerCase() === 'true'; }
function config() {
    if (!enabled()) return null;
    const base = String(process.env.HUMAN_PULSE_FINANCE_URL || '').trim().replace(/\/$/, '');
    const apiKey = String(process.env.HUMAN_PULSE_FINANCE_API_KEY || '').trim();
    try {
        const url = new URL(base);
        if (url.protocol !== 'https:' || !/^hpf_[A-Za-z0-9_-]+$/.test(apiKey)) return null;
        return { base, apiKey };
    } catch (_) { return null; }
}
function invoiceId(invoice) { return typeof invoice?.id === 'string' && /^in_[A-Za-z0-9_]+$/.test(invoice.id) ? invoice.id : null; }
function minor(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 && n <= 1000000000 ? n : null; }
function effectiveDate(value) { const date = new Date(Number(value || 0) * 1000); return Number.isNaN(date.valueOf()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10); }
function financePayload({ type, externalEventId, amountMinor, effectiveAt, category, description }) {
    return { type, amountMinor, currency: 'EUR', effectiveAt, sourceSystem: 'glowstock', externalEventId, category, description, metadata: { invoiceId: externalEventId } };
}
async function ensureSchema() {
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
        let c;
        try {
            c = await (await getPool()).getConnection();
            await c.query(`CREATE TABLE IF NOT EXISTS finance_outbox (
                event_id VARCHAR(191) NOT NULL PRIMARY KEY, event_type VARCHAR(40) NOT NULL, source_reference VARCHAR(255) NOT NULL,
                origin_event_id VARCHAR(191) NULL, payload LONGTEXT NOT NULL CHECK (JSON_VALID(payload)), status VARCHAR(20) NOT NULL DEFAULT 'pending',
                attempt_count INT UNSIGNED NOT NULL DEFAULT 0, next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                locked_until DATETIME NULL, lease_token CHAR(36) NULL, finance_entry_id VARCHAR(100) NULL, last_error VARCHAR(1000) NULL,
                sent_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY finance_outbox_source (event_type, source_reference), KEY finance_outbox_ready (status, next_attempt_at, locked_until), KEY finance_outbox_origin (origin_event_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
        } catch (error) { schemaPromise = null; throw error; } finally { if (c) c.release(); }
    })();
    return schemaPromise;
}
async function enqueue(connection, event) {
    if (!enabled()) return { queued: false, reason: 'disabled' };
    await connection.query(`INSERT IGNORE INTO finance_outbox (event_id,event_type,source_reference,origin_event_id,payload,status,next_attempt_at)
        VALUES (?,?,?,?,?,'pending',NOW())`, [event.eventId, event.eventType, event.sourceReference, event.originEventId || null, JSON.stringify(event.payload)]);
    return { queued: true, eventId: event.eventId };
}
async function enqueueInvoicePaid(connection, invoice) {
    const id = invoiceId(invoice), amount = minor(invoice?.amount_paid);
    // A paid invoice settled entirely by an already-accounted credit is not a new cash receipt.
    if (!id || !amount) return { queued: false, reason: 'not_a_cash_receipt' };
    return enqueue(connection, { eventId: `glowstock:invoice:${id}`, eventType: 'revenue', sourceReference: id,
        payload: financePayload({ type: 'REVENUE', externalEventId: id, amountMinor: amount, effectiveAt: effectiveDate(invoice.status_transitions?.paid_at || invoice.created), category: 'subscription', description: `Abonnement GlowStock - facture ${invoice.number || id}` }) });
}
async function enqueueRefund(connection, refund, invoice) {
    const refundId = typeof refund?.id === 'string' && /^re_[A-Za-z0-9_]+$/.test(refund.id) ? refund.id : null;
    const originInvoiceId = invoiceId(invoice), amount = minor(refund?.amount);
    if (!refundId || !originInvoiceId || !amount) return { queued: false, reason: 'unsupported_refund' };
    const originEventId = `glowstock:invoice:${originInvoiceId}`;
    return enqueue(connection, { eventId: `glowstock:refund:${refundId}`, eventType: 'refund', sourceReference: refundId, originEventId,
        payload: financePayload({ type: 'REFUND', externalEventId: refundId, amountMinor: amount, effectiveAt: effectiveDate(refund.created), category: 'refund', description: `Remboursement GlowStock - facture ${invoice.number || originInvoiceId}` }) });
}
function retryDelayMs(attempt) { return Math.min(6 * 60 * 60 * 1000, 30000 * (2 ** Math.min(10, Math.max(0, attempt - 1)))); }
function errorText(value) { return String(value || 'Erreur Finance inconnue.').replace(/[\u0000-\u001F]/g, ' ').slice(0, 1000); }
async function claimNext(pool) {
    const lease = randomUUID(); let c;
    try {
        c = await pool.getConnection(); await c.beginTransaction();
        const rows = await c.query(`SELECT * FROM finance_outbox WHERE status IN ('pending','retry') AND next_attempt_at <= NOW()
            AND (locked_until IS NULL OR locked_until < NOW()) ORDER BY created_at ASC LIMIT 1 FOR UPDATE`);
        const row = rows[0];
        if (!row) { await c.commit(); return null; }
        await c.query(`UPDATE finance_outbox SET status='processing', lease_token=?, locked_until=DATE_ADD(NOW(), INTERVAL 2 MINUTE), attempt_count=attempt_count+1
            WHERE event_id=?`, [lease, row.event_id]);
        await c.commit(); return { ...row, leaseToken: lease, attemptCount: Number(row.attempt_count) + 1 };
    } catch (error) { if (c) await c.rollback().catch(() => {}); throw error; } finally { if (c) c.release(); }
}
function entryId(response) { return response?.id || response?.entryId || response?.entry?.id || response?.data?.id || null; }
async function markSent(pool, item, financeEntryId) { await pool.query(`UPDATE finance_outbox SET status='sent', sent_at=NOW(), locked_until=NULL, lease_token=NULL, last_error=NULL, finance_entry_id=COALESCE(?,finance_entry_id)
    WHERE event_id=? AND lease_token=?`, [financeEntryId, item.event_id, item.leaseToken]); }
async function markRetry(pool, item, message, terminal = false) {
    if (terminal) return pool.query(`UPDATE finance_outbox SET status='failed', locked_until=NULL, lease_token=NULL,last_error=? WHERE event_id=? AND lease_token=?`, [errorText(message), item.event_id, item.leaseToken]);
    const next = new Date(Date.now() + retryDelayMs(item.attemptCount)).toISOString().slice(0, 19).replace('T', ' ');
    return pool.query(`UPDATE finance_outbox SET status='retry',next_attempt_at=?,locked_until=NULL,lease_token=NULL,last_error=? WHERE event_id=? AND lease_token=?`, [next, errorText(message), item.event_id, item.leaseToken]);
}
async function deliver(pool, item, settings) {
    let payload; try { payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload; } catch (_) { await markRetry(pool, item, 'Payload Finance invalide.', true); return; }
    let endpoint = item.event_type === 'refund' ? '/api/v1/refunds' : '/api/v1/revenues';
    if (item.event_type === 'refund') {
        const origins = await pool.query(`SELECT finance_entry_id FROM finance_outbox WHERE event_id=? AND status='sent' LIMIT 1`, [item.origin_event_id]);
        const originEntryId = origins[0]?.finance_entry_id;
        if (!originEntryId) { await markRetry(pool, item, 'Revenu d’origine Finance pas encore confirmé.'); return; }
        payload.originEntryId = originEntryId;
    }
    let response;
    try { response = await fetch(`${settings.base}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': item.event_id }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) }); }
    catch (error) { await markRetry(pool, item, `Transport Finance : ${error.name || 'erreur'}.`); return; }
    let body = null; try { body = await response.json(); } catch (_) { /* status remains authoritative */ }
    if (response.ok) { await markSent(pool, item, entryId(body)); return; }
    const detail = body?.message || body?.error || `Finance HTTP ${response.status}`;
    await markRetry(pool, item, detail, [400, 401, 403, 409].includes(response.status));
}
async function processOnce() {
    const settings = config(); if (!settings || workerRunning) return { processed: false, reason: settings ? 'busy' : 'not_configured' };
    workerRunning = true;
    try { await ensureSchema(); const pool = await getPool(); const item = await claimNext(pool); if (!item) return { processed: false, reason: 'empty' }; await deliver(pool, item, settings); return { processed: true, eventId: item.event_id }; }
    catch (error) { void serverLogger.error('finance.outbox.worker_failed', 'Le worker Finance a échoué ; GlowStock continue de fonctionner.', { code: error?.code || null, name: error?.name || null }); return { processed: false, reason: 'error' }; }
    finally { workerRunning = false; }
}
function startWorker() { if (workerTimer || !enabled()) return workerTimer; workerTimer = setInterval(() => { void processOnce(); }, 10000); workerTimer.unref?.(); void processOnce(); return workerTimer; }
async function getStats() { await ensureSchema(); const pool = await getPool(); const rows = await pool.query(`SELECT status,COUNT(*) AS count, MIN(CASE WHEN status IN ('pending','retry') THEN created_at END) AS oldest_pending_at FROM finance_outbox GROUP BY status`); return rows; }
module.exports = { ensureSchema, enabled, config, enqueueInvoicePaid, enqueueRefund, claimNext, processOnce, startWorker, getStats, financePayload, retryDelayMs };
