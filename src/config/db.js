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
      ssl: sslConfig(url) || { rejectUnauthorized: false },
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
  await current.query(fs.readFileSync(path.join(base, 'schema.sql'), 'utf8'));
  await current.query(fs.readFileSync(path.join(base, 'seed_demo.sql'), 'utf8'));

  const tablas = await current.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('empresas', 'periodos_tributarios', 'documentos_f29')
     ORDER BY table_name`
  );
  const empresas = await current.query(
    'SELECT id, rut, razon_social, regimen_tributario FROM empresas ORDER BY id'
  );
  const nombres = tablas.rows.map((fila) => fila.table_name);
  console.log(`Tablas en ${process.env.PGDATABASE || 'PostgreSQL'}: ${nombres.join(', ')}`);
  if (empresas.rows[0]) {
    const empresa = empresas.rows[0];
    console.log(`Empresa de ejemplo: ${empresa.razon_social} (RUT ${empresa.rut}, ${empresa.regimen_tributario})`);
  } else {
    console.log('La tabla empresas quedó vacía.');
  }
  return nombres.length === 3 && empresas.rows.length > 0;
}

module.exports = { getPool, initDb };
