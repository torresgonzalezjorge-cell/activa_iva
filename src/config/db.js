const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let pool = null;

function sslConfig(connectionString) {
  if (/sslmode=disable/i.test(connectionString)) return false;
  if (/sslmode=require/i.test(connectionString)) return { rejectUnauthorized: false };
  let host = '';
  try {
    host = new URL(connectionString).hostname;
  } catch (_error) {
    host = '';
  }
  if (!host || host === 'localhost' || host === '127.0.0.1') return false;
  return { rejectUnauthorized: false };
}

function postgresUrl() {
  const url = process.env.DATABASE_URL || '';
  return /^postgres(ql)?:\/\//i.test(url) ? url : '';
}

function connectionConfig() {
  const url = postgresUrl();
  if (url) {
    return {
      connectionString: url,
      ssl: sslConfig(url),
    };
  }

  const host = process.env.PGHOST;
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  if (!host || !database || !user || typeof password !== 'string') return null;

  return {
    host,
    port: Number(process.env.PGPORT) || 5432,
    database,
    user,
    password,
    ssl: false,
  };
}

function getPool() {
  const config = connectionConfig();
  if (!config) return null;
  if (!pool) pool = new Pool(config);
  return pool;
}

async function initDb() {
  const current = getPool();
  if (!current) {
    console.warn('No hay conexión PostgreSQL. Defina DATABASE_URL o PGHOST, PGPORT, PGDATABASE, PGUSER y PGPASSWORD.');
    return false;
  }
  const base = path.join(__dirname, '..', '..', 'database');
  const client = await current.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(base, 'schema.sql'), 'utf8'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const tablas = await current.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('empresas', 'periodos_tributarios', 'documentos_f29')
     ORDER BY table_name`
  );
  const nombres = tablas.rows.map((fila) => fila.table_name);
  console.log(`Tablas en ${process.env.PGDATABASE || 'PostgreSQL'}: ${nombres.join(', ')}`);
  return nombres.length === 3;
}

async function seedDemo(userId) {
  const current = getPool();
  if (!current) throw new Error('PostgreSQL no está configurado.');
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'seed_demo.sql'), 'utf8');
  await current.query(sql, [userId]);
}

module.exports = { getPool, initDb, seedDemo };
