'use strict';

// Transaction-aware SQL double for the application contract. This is deliberately
// not an SQL parser or a substitute for testing migrations/locks with MariaDB.
// The register lock serializes transactions, and only commit publishes a snapshot.
function memoryDatabase() {
    let committed = { cards: [], ledger: [], registers: [], clock: 0 };
    let tail = Promise.resolve(), failure = null;
    const calls = [];
    const copy = value => structuredClone(value);
    const same = (left, right) => String(left) === String(right);
    const duplicate = () => Object.assign(new Error('Duplicate key'), { code: 'ER_DUP_ENTRY' });
    function execute(state, rawSql, args = []) {
        const sql = rawSql.replace(/\s+/g, ' ').trim();
        if (failure?.test(sql)) { failure = null; throw new Error('Injected ledger storage failure'); }
        if (/^INSERT IGNORE INTO gift_card_registers/.test(sql)) {
            if (!state.registers.some(row => same(row.id_user, args[0]))) state.registers.push({ id_user: args[0], next_entry: 1 });
            return { affectedRows: 1 };
        }
        if (/^SELECT next_entry FROM gift_card_registers/.test(sql)) return copy(state.registers.filter(row => same(row.id_user, args[0])));
        if (/^UPDATE gift_card_registers/.test(sql)) {
            state.registers.find(row => same(row.id_user, args[0])).next_entry++;
            return { affectedRows: 1 };
        }
        if (/^INSERT INTO gift_cards /.test(sql)) {
            const [id, id_user, code, initial_cents, balance_cents, expires_at, issue_kind, tax_treatment, reference] = args;
            if (state.cards.some(row => row.id === id || row.code === code)) throw duplicate();
            state.cards.push({ id, id_user, code, initial_cents, balance_cents, expires_at, issue_kind, tax_treatment, reference, status: 'active', created_at: ++state.clock });
            return { affectedRows: 1 };
        }
        if (/^UPDATE gift_cards SET (status|balance_cents)=/.test(sql)) {
            const field = sql.match(/^UPDATE gift_cards SET (status|balance_cents)=/)[1];
            const row = state.cards.find(row => same(row.id_user, args[1]) && row.id === args[2]);
            if (!row) return { affectedRows: 0 };
            row[field] = args[0]; return { affectedRows: 1 };
        }
        if (/^INSERT INTO gift_card_ledger /.test(sql)) {
            const [id, id_user, gift_card_id, operation_key, request_hash, entry_no, operation_type, amount_delta_cents, balance_after_cents, reason, reference, reversal_of, source_key] = args;
            if (state.ledger.some(row => row.id === id || (same(row.id_user, id_user) && (row.operation_key === operation_key || row.entry_no === entry_no || (source_key && row.source_key === source_key))))) throw duplicate();
            state.ledger.push({ id, id_user, gift_card_id, operation_key, request_hash, entry_no, operation_type, amount_delta_cents, balance_after_cents, reason, reference, reversal_of, source_key, created_at: ++state.clock });
            return { affectedRows: 1 };
        }
        if (/ FROM gift_cards WHERE id_user=\?/.test(sql)) {
            let rows = state.cards.filter(row => same(row.id_user, args[0]));
            if (/ AND id=\?/.test(sql)) rows = rows.filter(row => row.id === args[1]);
            if (/ AND code=\?/.test(sql)) rows = rows.filter(row => row.code === args[1]);
            if (/ AND status='active' AND expires_at < \?/.test(sql)) rows = rows.filter(row => row.status === 'active' && row.expires_at && row.expires_at < args[1]).sort((a, b) => a.expires_at.localeCompare(b.expires_at) || a.id.localeCompare(b.id));
            else rows = rows.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
            const limit = sql.match(/LIMIT (\d+)/)?.[1];
            return copy(limit ? rows.slice(0, Number(limit)) : rows);
        }
        if (/ FROM gift_card_ledger WHERE id_user=\?/.test(sql)) {
            let rows = state.ledger.filter(row => same(row.id_user, args[0]));
            if (/ AND operation_key=\?/.test(sql)) rows = rows.filter(row => row.operation_key === args[1]);
            else if (/ AND source_key=\?/.test(sql)) rows = rows.filter(row => row.source_key === args[1]);
            else if (/ AND gift_card_id=\?/.test(sql)) {
                rows = rows.filter(row => row.gift_card_id === args[1]);
                if (/ AND id=\?/.test(sql)) rows = rows.filter(row => row.id === args[2]);
                if (/ AND reversal_of=\?/.test(sql)) rows = rows.filter(row => row.reversal_of === args[2]);
                if (/COALESCE\(entry_no,0\) < \?/.test(sql)) rows = rows.filter(row => Number(row.entry_no || 0) < Number(args[2]) || (Number(row.entry_no || 0) === Number(args[3]) && (row.created_at < args[4] || (row.created_at === args[5] && row.id < args[6]))));
            } else if (/ AND id=\?/.test(sql)) rows = rows.filter(row => row.id === args[1]);
            const type = sql.match(/operation_type='([^']+)'/)?.[1];
            if (type) rows = rows.filter(row => row.operation_type === type);
            if (/SUM\(amount_delta_cents\)/.test(sql)) return [{ total: rows.reduce((sum, row) => sum + row.amount_delta_cents, 0) }];
            rows = rows.sort((a, b) => Number(b.entry_no || 0) - Number(a.entry_no || 0) || b.created_at - a.created_at || b.id.localeCompare(a.id));
            const limit = sql.match(/LIMIT (\d+)/)?.[1];
            return copy(limit ? rows.slice(0, Number(limit)) : rows);
        }
        throw new Error(`Unsupported test SQL: ${sql}`);
    }
    const pool = {
        query: async (sql, args) => { calls.push({ connection: 'pool', sql, args: copy(args) }); return execute(committed, sql, args); },
        getConnection: async () => {
            let state = null, unlock = null, begun = false;
            return {
                async beginTransaction() { begun = true; calls.push('begin'); },
                async query(sql, args) {
                    if (!begun) throw new Error('Query outside transaction');
                    if (!state) {
                        if (!sql.startsWith('INSERT IGNORE INTO gift_card_registers')) throw new Error('Mutation must acquire register lock first');
                        const previous = tail;
                        tail = new Promise(resolve => { unlock = resolve; });
                        await previous;
                        state = copy(committed);
                    }
                    calls.push({ connection: 'transaction', sql, args: copy(args) });
                    return execute(state, sql, args);
                },
                async commit() { if (state) committed = state; state = null; calls.push('commit'); unlock?.(); unlock = null; },
                async rollback() { state = null; calls.push('rollback'); unlock?.(); unlock = null; },
                release() { calls.push('release'); unlock?.(); unlock = null; }
            };
        }
    };
    return { pool, calls, snapshot: () => copy(committed), failNext: expression => { failure = expression; },
        seedCard: (id, patch) => Object.assign(committed.cards.find(card => card.id === id), patch) };
}

module.exports = { memoryDatabase };
