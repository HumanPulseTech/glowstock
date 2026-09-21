const fs = require('node:fs');
const mysql = require('mysql2/promise');
const { createApp } = require('./app');
const { SqlStore } = require('./store');
const env = process.env;
for (const key of ['CAISSE_DB_HOST', 'CAISSE_DB_NAME', 'CAISSE_DB_USER', 'CAISSE_DB_PASSWORD', 'CAISSE_BRIDGE_SECRET', 'CAISSE_AUDIT_KEY']) {
    if (!env[key]) throw new Error(`${key} requis.`);
}
if (env.CAISSE_AUDIT_KEY.length < 48 || env.CAISSE_AUDIT_KEY === env.CAISSE_BRIDGE_SECRET) throw new Error('Clé audit indépendante, aléatoire, minimum 48 caractères requise.');
if (env.CAISSE_MODE !== 'simulation') throw new Error('Cette version accepte uniquement CAISSE_MODE=simulation.');
const pool = mysql.createPool({ host: env.CAISSE_DB_HOST, port: Number(env.CAISSE_DB_PORT || 3306), database: env.CAISSE_DB_NAME,
    user: env.CAISSE_DB_USER, password: env.CAISSE_DB_PASSWORD, connectionLimit: 5, waitForConnections: true, queueLimit: 30,
    connectTimeout: 5000, ...(env.CAISSE_DB_CA_FILE ? { ssl: { ca: fs.readFileSync(env.CAISSE_DB_CA_FILE), rejectUnauthorized: true } } : {}) });
const app = createApp({ store: new SqlStore(pool, env.CAISSE_AUDIT_KEY), secret: env.CAISSE_BRIDGE_SECRET });
const server = app.listen(Number(env.PORT || 8090), '0.0.0.0', () => console.log('Caisse pilote démarrée — simulation uniquement.'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => pool.end().finally(() => process.exit(0))));
