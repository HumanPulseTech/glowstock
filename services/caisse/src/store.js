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
            const state = JSON.parse(row.data);
            const outcome = operation(state);
            if (outcome.event) {
                const sequence = Number(row.sequence_no) + 1;
                if (!Number.isSafeInteger(sequence)) throw new Error('Sequence exhausted');
                const occurredAt = new Date().toISOString(), payload = JSON.stringify(outcome.event);
                const mac = eventMac(this.key, tenant, sequence, actor, occurredAt, row.last_mac, payload);
                await connection.query('INSERT INTO caisse_events (tenant_id, sequence_no, actor_id, occurred_at, payload, previous_mac, mac) VALUES (?, ?, ?, ?, ?, ?, ?)', [tenant, sequence, actor, occurredAt, payload, row.last_mac, mac]);
                await connection.query('UPDATE caisse_state SET data = ?, sequence_no = ?, last_mac = ? WHERE tenant_id = ?', [JSON.stringify(state), sequence, mac, tenant]);
            }
            await connection.commit();
            return outcome.result;
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
}
module.exports = { SqlStore, MemoryStore, eventMac };
