const test = require('node:test');
const assert = require('node:assert/strict');
const { availableStarts, slugFor } = require('../../integrations/booking');

test('public booking only accepts safe salon slugs', () => {
    assert.equal(slugFor('mon-salon-75'), 'mon-salon-75');
    assert.throws(() => slugFor('../admin'), /adresse/i);
    assert.throws(() => slugFor('ab'), /adresse/i);
});
test('availability applies service duration and the configured buffer on both sides', () => {
    const starts = availableStarts({ opensAt: '09:00', closesAt: '10:00' }, [{ start_time: '09:30', end_time: '09:45' }], 15, 15);
    assert.deepEqual(starts, ['09:00']);
});
