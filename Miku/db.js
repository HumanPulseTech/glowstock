require('dotenv').config();

let pool = null;

async function getPool() {
  if (pool) return pool;

  const mariadbModule = await import('mariadb');
  const mariadb = mariadbModule.default || mariadbModule;

  pool = mariadb.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'glowstock',
    connectionLimit: 5
  });

  return pool;
}

module.exports = { getPool };