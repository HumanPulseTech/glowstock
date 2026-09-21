async function assertPasswordStorage(connection) {
    const rows = await connection.query(
        "SELECT CHARACTER_MAXIMUM_LENGTH AS capacity FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password'"
    );
    if (!rows[0] || Number(rows[0].capacity) < 255) {
        const error = new Error('La migration 020 du stockage des mots de passe est requise.');
        error.code = 'PASSWORD_SCHEMA_REQUIRED';
        throw error;
    }
}
module.exports = { assertPasswordStorage };
