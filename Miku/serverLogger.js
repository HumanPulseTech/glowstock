const fs = require('fs');
const path = require('path');
const { getPool } = require('./db.js');

const fallbackDirectory = process.env.SERVER_LOG_DIR || path.join(__dirname, '..', 'logs');
const fallbackFile = path.join(fallbackDirectory, 'server.log.jsonl');
let tableReadyPromise = null;
let databaseUnavailableUntil = 0;

const SENSITIVE_KEY = /(password|pass|secret|token|cookie|authorization|auth|api[_-]?key|credit|card|current|next)/i;

function cleanString(value, maxLength = 500) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, maxLength);
}

function normalizeUserId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function sanitize(value, key = '', depth = 0) {
    if (SENSITIVE_KEY.test(key)) return '[masqué]';
    if (value === null || value === undefined) return value;
    if (value instanceof Error) return { name: cleanString(value.name, 100), message: cleanString(value.message, 1000), stack: cleanString(value.stack, 3000) };
    if (typeof value === 'string') return cleanString(value, 1000);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= 3) return '[objet tronqué]';
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, key, depth + 1));
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).slice(0, 40).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey, depth + 1)]));
    }
    return cleanString(value, 200);
}

function serializeContext(context) {
    if (context === null || context === undefined) return null;
    try {
        const serialized = JSON.stringify(sanitize(context));
        return serialized ? serialized.slice(0, 10000) : null;
    } catch (error) {
        return JSON.stringify({ value: '[contexte non sérialisable]', error: cleanString(error.message, 300) });
    }
}

function summarizePayload(payload) {
    if (!Array.isArray(payload)) return { type: typeof payload };
    return payload.map((value) => {
        if (value === null) return null;
        if (Array.isArray(value)) return { type: 'array', length: value.length };
        if (typeof value === 'object') return { type: 'object', keys: Object.keys(value).slice(0, 30) };
        return { type: typeof value };
    });
}

async function ensureTable() {
    if (!tableReadyPromise) {
        tableReadyPromise = (async () => {
            let connection;
            try {
                const pool = await getPool();
                connection = await pool.getConnection();
                await connection.query(`
                    CREATE TABLE IF NOT EXISTS server_logs (
                        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                        level VARCHAR(16) NOT NULL,
                        event VARCHAR(100) NOT NULL,
                        message VARCHAR(2000) NOT NULL,
                        id_user INT(11) NULL,
                        request_id VARCHAR(80) NULL,
                        socket_id VARCHAR(80) NULL,
                        context TEXT NULL,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (id),
                        KEY idx_server_logs_created (created_at),
                        KEY idx_server_logs_event (event),
                        KEY idx_server_logs_user_created (id_user, created_at),
                        CONSTRAINT fk_server_logs_user FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE SET NULL
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
                `);
            } finally {
                if (connection) connection.release();
            }
        })().catch((error) => {
            tableReadyPromise = null;
            throw error;
        });
    }
    return tableReadyPromise;
}

async function writeFallback(record) {
    try {
        await fs.promises.mkdir(fallbackDirectory, { recursive: true });
        await fs.promises.appendFile(fallbackFile, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
        console.error('[Serveur][Logger] Impossible d’écrire le journal JSON', error.message);
    }
}

async function writeDatabase(record) {
    if (Date.now() < databaseUnavailableUntil) return false;
    let connection;
    try {
        await ensureTable();
        const pool = await getPool();
        connection = await pool.getConnection();
        await connection.query(
            'INSERT INTO server_logs (level, event, message, id_user, request_id, socket_id, context) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [record.level, record.event, record.message, record.userId, record.requestId, record.socketId, record.context]
        );
        databaseUnavailableUntil = 0;
        return true;
    } catch (error) {
        databaseUnavailableUntil = Date.now() + 60 * 1000;
        throw error;
    } finally {
        if (connection) connection.release();
    }
}

async function cleanupExpiredLogs(retentionDays = 31) {
    const days = Math.max(1, Math.min(3650, Number(retentionDays) || 31));
    let connection;
    try {
        const pool = await getPool();
        connection = await pool.getConnection();
        const interval = `INTERVAL ${days} DAY`;
        for (const table of ['server_logs', 'error_logs']) {
            try {
                await connection.query(`DELETE FROM ${table} WHERE created_at < DATE_SUB(NOW(), ${interval})`);
            } catch (error) {
                // Les anciennes installations peuvent ne pas avoir encore
                // appliqué la migration du journal concerné.
                console.warn(`[Serveur][Logger] Nettoyage ignoré pour ${table}: ${error.message}`);
            }
        }
    } catch (error) {
        console.warn(`[Serveur][Logger] Nettoyage DB impossible: ${error.message}`);
    } finally {
        if (connection) connection.release();
    }

    try {
        const content = await fs.promises.readFile(fallbackFile, 'utf8');
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const kept = content.split(/\r?\n/).filter((line) => {
            if (!line.trim()) return false;
            try {
                const createdAt = Date.parse(JSON.parse(line).created_at);
                return !Number.isFinite(createdAt) || createdAt >= cutoff;
            } catch (error) {
                return true;
            }
        });
        const nextContent = kept.length ? `${kept.join('\n')}\n` : '';
        if (nextContent !== content) await fs.promises.writeFile(fallbackFile, nextContent, 'utf8');
    } catch (error) {
        if (error?.code !== 'ENOENT') console.warn(`[Serveur][Logger] Nettoyage du journal JSON impossible: ${error.message}`);
    }
}

async function log(level, event, message, context = null, options = {}) {
    const record = {
        created_at: new Date().toISOString(),
        level: cleanString(level, 16).toLowerCase() || 'info',
        event: cleanString(event, 100) || 'server.event',
        message: cleanString(message, 2000) || 'Événement serveur',
        userId: normalizeUserId(options.userId),
        requestId: options.requestId ? cleanString(options.requestId, 80) : null,
        socketId: options.socketId ? cleanString(options.socketId, 80) : null,
        context: serializeContext(context)
    };

    const consoleLine = `[Serveur][${record.level.toUpperCase()}][${record.event}] ${record.message}`;
    if (record.level === 'error') console.error(consoleLine);
    else if (record.level === 'warn') console.warn(consoleLine);
    else console.log(consoleLine);

    try {
        if (!(await writeDatabase(record))) await writeFallback(record);
    } catch (error) {
        await writeFallback({ ...record, persistence_error: cleanString(error.message, 500) });
    }
    return record;
}

function emergency(event, message, context = null, options = {}) {
    const record = {
        created_at: new Date().toISOString(),
        level: 'fatal',
        event: cleanString(event, 100) || 'process.fatal',
        message: cleanString(message, 2000) || 'Erreur fatale du serveur',
        userId: normalizeUserId(options.userId),
        requestId: options.requestId ? cleanString(options.requestId, 80) : null,
        socketId: options.socketId ? cleanString(options.socketId, 80) : null,
        context: serializeContext(context)
    };
    console.error(`[Serveur][FATAL][${record.event}] ${record.message}`);
    try {
        fs.mkdirSync(fallbackDirectory, { recursive: true });
        fs.appendFileSync(fallbackFile, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
        console.error('[Serveur][Logger] Impossible d’écrire le journal fatal', error.message);
    }
    return record;
}

module.exports = {
    log,
    emergency,
    cleanupExpiredLogs,
    info: (event, message, context, options) => log('info', event, message, context, options),
    warn: (event, message, context, options) => log('warn', event, message, context, options),
    error: (event, message, context, options) => log('error', event, message, context, options),
    summarizePayload
};
