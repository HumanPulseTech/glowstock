const { eventMac } = require('./store');
function verifyEvents(rows, key, expectedTenant, expectedHead) {
    let previous = '', sequence = 0;
    for (const row of rows) {
        sequence++;
        if (row.tenant_id !== expectedTenant || Number(row.sequence_no) !== sequence || row.previous_mac !== previous) return false;
        const expected = eventMac(key, expectedTenant, sequence, row.actor_id, row.occurred_at, previous, row.payload);
        if (row.mac !== expected) return false;
        previous = expected;
    }
    // A trusted external head is needed to detect truncation of the chain tail.
    return expectedHead && expectedHead.sequence === sequence && expectedHead.mac === previous;
}
module.exports = { verifyEvents };
