const { createHmac } = require('node:crypto');
const { initialState } = require('./domain');
function eventMac(key, tenant, sequence, actor, time, previous, payload) {
    return createHmac('sha256', key).update(JSON.stringify([tenant, sequence, actor, time, previous, payload])).digest('hex');
}
class SqlStore {
    constructor(pool, key) { this.pool = pool; this.key = key; }
    async claimNonce(nonce) {
        await this.pool.query('DELETE FROM caisse_nonces WHERE expires_at < ? LIMIT 1000', [Date.now()]);
        try { await this.pool.query('INSERT INTO caisse_nonces (nonce, expires_at) VALUES (?, ?)', [nonce, Date.now() + 60000]); return true; }
        catch (error) { if (error.code === 'ER_DUP_ENTRY') return false; throw error; }
    }
    async run(tenant, actor, operation) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query('INSERT IGNORE INTO caisse_state (tenant_id, data) VALUES (?, ?)', [tenant, JSON.stringify(initialState())]);
            const [rows] = await connection.query('SELECT data, sequence_no, last_mac FROM caisse_state WHERE tenant_id = ? FOR UPDATE', [tenant]);
            const row = rows[0];
            let state;
            try {
                // mysql2 returns LONGTEXT as a string but returns a native object for a JSON column.
                // Supporting both avoids treating a valid JSON-column state as the string "[object Object]".
                const stored = Buffer.isBuffer(row.data) ? row.data.toString('utf8') : row.data;
                state = typeof stored === 'string' ? JSON.parse(stored) : structuredClone(stored);
            } catch (error) {
                error.code = 'CAISSE_INVALID_STATE';
                throw error;
            }
            const outcome = operation(state);
            if (outcome.event) {
                const sequence = Number(row.sequence_no) + 1;
                if (!Number.isSafeInteger(sequence)) throw new Error('Sequence exhausted');
                const occurredAt = new Date().toISOString(), payload = JSON.stringify(outcome.event);
                const mac = eventMac(this.key, tenant, sequence, actor, occurredAt, row.last_mac, payload);
                await connection.query('INSERT INTO caisse_events (tenant_id, sequence_no, actor_id, occurred_at, payload, previous_mac, mac) VALUES (?, ?, ?, ?, ?, ?, ?)', [tenant, sequence, actor, occurredAt, payload, row.last_mac, mac]);
                if (outcome.event.type === 'cash_session.closed') {
                    const closure = state.cashClosures?.at(-1);
                    if (!closure || closure.id !== outcome.event.session.id) throw new Error('Cash closure seal state mismatch');
                    closure.auditSeal = mac;
                    if (state.cashSession?.id === closure.id) state.cashSession.auditSeal = mac;
                }
                if (outcome.event.type === 'simulation.frozen') {
                    const ticket = state.drafts?.find(item => item.id === outcome.event.draft.id);
                    if (!ticket?.simulation) throw new Error('Simulation seal state mismatch');
                    ticket.simulation.auditSeal = mac;
                }
                if (outcome.event.type === 'simulation.cancelled') {
                    const correction = state.corrections?.find(item => item.id === outcome.event.correction.id);
                    if (!correction) throw new Error('Correction seal state mismatch');
                    correction.auditSeal = mac;
                }
                await connection.query('UPDATE caisse_state SET data = ?, sequence_no = ?, last_mac = ? WHERE tenant_id = ?', [JSON.stringify(state), sequence, mac, tenant]);
            }
            await connection.commit();
            return outcome.result;
        } catch (error) { await connection.rollback().catch(() => {}); throw error; }
        finally { connection.release(); }
    }
    async verify(tenant) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [states] = await connection.query('SELECT data, sequence_no, last_mac FROM caisse_state WHERE tenant_id = ?', [tenant]);
            const [events] = await connection.query('SELECT tenant_id, sequence_no, actor_id, occurred_at, payload, previous_mac, mac FROM caisse_events WHERE tenant_id = ? ORDER BY sequence_no', [tenant]);
            await connection.commit();
            const state = states[0];
            const head = { sequence: Number(state?.sequence_no || 0), mac: state?.last_mac || '' };
            const { verifyEvents } = require('./verify-events');
            let sealsMatch = true, sealedClosures = 0, sealedTickets = 0, sealedCorrections = 0;
            if (state) {
                const stored = Buffer.isBuffer(state.data) ? state.data.toString('utf8') : state.data;
                const data = typeof stored === 'string' ? JSON.parse(stored) : stored;
                for (const closure of data?.cashClosures || []) {
                    if (!closure.auditSeal) continue;
                    sealedClosures++;
                    const event = events.find(row => row.mac === closure.auditSeal);
                    let payload;
                    try { payload = event && JSON.parse(event.payload); } catch { sealsMatch = false; break; }
                    const report = { ...closure }; delete report.auditSeal;
                    if (payload?.type !== 'cash_session.closed' || JSON.stringify(payload.session) !== JSON.stringify(report)) { sealsMatch = false; break; }
                }
                for (const ticket of data?.drafts || []) {
                    if (ticket.status !== 'simulated' || !ticket.simulation?.auditSeal) continue;
                    sealedTickets++;
                    const event = events.find(row => row.mac === ticket.simulation.auditSeal);
                    let payload;
                    try { payload = event && JSON.parse(event.payload); } catch { sealsMatch = false; break; }
                    const record = structuredClone(ticket); delete record.simulation.auditSeal;
                    if (payload?.type !== 'simulation.frozen' || JSON.stringify(payload.draft) !== JSON.stringify(record)) { sealsMatch = false; break; }
                }
                for (const correction of data?.corrections || []) {
                    if (!correction.auditSeal) continue;
                    sealedCorrections++;
                    const event = events.find(row => row.mac === correction.auditSeal);
                    let payload;
                    try { payload = event && JSON.parse(event.payload); } catch { sealsMatch = false; break; }
                    const record = { ...correction }; delete record.auditSeal;
                    if (payload?.type !== 'simulation.cancelled' || JSON.stringify(payload.correction) !== JSON.stringify(record)) { sealsMatch = false; break; }
                }
            }
            return { ok: verifyEvents(events, this.key, String(tenant), head) && sealsMatch, eventCount: events.length, sequence: head.sequence, sealedClosures, sealedTickets, sealedCorrections, scope: 'sql-audit-chain' };
        } catch (error) { await connection.rollback().catch(() => {}); throw error; }
        finally { connection.release(); }
    }
}
// Only for isolated tests/visual demo; production entry point cannot select this store.
class MemoryStore {
    constructor() { this.states = new Map(); this.nonces = new Map(); }
    async claimNonce(nonce) {
        for (const [key, until] of this.nonces) if (until < Date.now()) this.nonces.delete(key);
        if (this.nonces.has(nonce) || this.nonces.size > 10000) return false;
        this.nonces.set(nonce, Date.now() + 60000); return true;
    }
    async run(tenant, actor, operation) {
        const state = structuredClone(this.states.get(tenant) || initialState());
        const outcome = operation(state);
        if (outcome.event) this.states.set(tenant, state);
        return structuredClone(outcome.result);
    }
    async verify() { return { ok: true, eventCount: 0, sequence: 0, scope: 'memory-demo' }; }
}
module.exports = { SqlStore, MemoryStore, eventMac };
