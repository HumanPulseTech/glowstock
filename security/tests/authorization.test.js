const test = require('node:test');
const assert = require('node:assert/strict');
const { canManageRole, parsePermissions } = require('../authorization');
const { assertPasswordStorage } = require('../password-storage');
test('role management denies granting missing rights or modifying a superior role', async () => {
    const actor = { role: 'support', permissions: '["manage_roles","tickets_view"]' };
    const connection = { query: async (sql) => sql.includes('FROM users') ? [actor] : [{ permissions: '["tickets_view"]' }] };
    assert.equal(await canManageRole(connection, 1, 'reader', ['tickets_view']), true);
    assert.equal(await canManageRole(connection, 1, 'reader', ['manage_accounts']), false);
    assert.equal(await canManageRole(connection, 1, 'fondateur', []), false);
    connection.query = async sql => sql.includes('FROM users') ? [actor] : [{ permissions: '["manage_accounts"]' }];
    assert.equal(await canManageRole(connection, 1, 'administrator', []), false);
});
test('founder delegation requires a database-backed founder identity', async () => {
    const connection = { query: async () => [{ role: 'fondateur', permissions: '[]' }] };
    assert.equal(await canManageRole(connection, 1, 'fondateur', ['manage_roles']), true);
    connection.query = async () => [];
    assert.equal(await canManageRole(connection, 1, 'user', []), false);
});
test('malformed permissions do not become privileges', () => {
    for (const value of [null, 'invalid', '{}', '[123]', '{"manage_roles":true}']) assert.deepEqual(parsePermissions(value), []);
});
test('password writes fail closed if schema cannot hold the new hash', async () => {
    for (const capacity of [null, 60, 128]) await assert.rejects(assertPasswordStorage({ query: async () => capacity ? [{ capacity }] : [] }), { code: 'PASSWORD_SCHEMA_REQUIRED' });
    await assertPasswordStorage({ query: async () => [{ capacity: 255 }] });
});
