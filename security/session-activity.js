// Update an existing session only. Unlike session.save(), this cannot recreate
// a session destroyed concurrently by logout (HTTP or Socket.IO).
async function refreshSessionActivity(store, sessionId, now = Date.now()) {
    const schema = store.options.schema;
    const columns = schema.columnNames;
    const [result] = await store.query(
        "UPDATE ?? SET ?? = JSON_SET(??, '$.lastActivityAt', ?) WHERE ?? = ? AND ?? >= ?",
        [schema.tableName, columns.data, columns.data, now, columns.session_id, sessionId, columns.expires, Math.floor(now / 1000)]
    );
    return result.affectedRows === 1;
}
module.exports = { refreshSessionActivity };
