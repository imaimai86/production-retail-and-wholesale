const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pg = require('pg');
const { Pool } = pg;

// pg returns name[] (e.g. array_agg(attname)) as a raw string; parse it like text[].
const NAME_ARRAY_OID = 1003;
const types = {
  getTypeParser(oid, format) {
    if (oid === NAME_ARRAY_OID) {
      return value => (value === '{}' ? [] : value.slice(1, -1).split(',').map(v => v.replace(/^"|"$/g, '')));
    }
    return pg.types.getTypeParser(oid, format);
  },
};

const MISSING_URL = 'DATABASE_URL is required for integration tests';
const NAME_PATTERN = /^prw_test_[0-9a-f]{8}$/;
const MIGRATIONS_DIR = path.join(__dirname, '../migrations');
const SCHEMA_FILE = path.join(__dirname, '../schema.sql');

const created = new Set();
let pools = [];
let adminUrl = null;

function requireDatabaseUrl(env = process.env) {
  const url = (env.DATABASE_URL || '').trim();
  if (!url) throw new Error(MISSING_URL);
  return url;
}

function scratchName() {
  return `prw_test_${crypto.randomBytes(4).toString('hex')}`;
}

function withDatabaseName(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

// Failures from the admin connection can embed host, port or user, so only a
// generic message (plus the error code) leaves this module.
function adminError(err) {
  const out = new Error('Could not connect to the admin database');
  if (err && err.code) out.code = err.code;
  return out;
}

// The admin url is captured on first use: useScratchEnv later rewrites
// process.env.DATABASE_URL to point at the scratch database.
function currentAdminUrl() {
  return adminUrl || requireDatabaseUrl();
}

async function runAdmin(sql) {
  const pool = new Pool({ connectionString: currentAdminUrl() });
  try {
    await pool.query(sql);
  } catch (err) {
    throw adminError(err);
  } finally {
    try { await pool.end(); } catch (e) { /* ignore */ }
  }
}

async function createScratchDb() {
  const base = currentAdminUrl();
  const name = scratchName();
  if (!NAME_PATTERN.test(name)) throw new Error('Invalid scratch database name');
  adminUrl = base;
  await runAdmin(`CREATE DATABASE "${name}"`);
  created.add(name);
  return { name, url: withDatabaseName(base, name) };
}

function useScratchEnv(url) {
  const u = new URL(url);
  process.env.DATABASE_URL = url;
  process.env.PGHOST = u.hostname.replace(/^\[|\]$/g, '');
  process.env.PGPORT = u.port || '5432';
  process.env.PGUSER = decodeURIComponent(u.username);
  process.env.PGPASSWORD = decodeURIComponent(u.password);
  process.env.PGDATABASE = u.pathname.replace(/^\//, '');
}

function openPool(url) {
  const pool = new Pool({ connectionString: url, types });
  // An idle client killed by DROP ... WITH (FORCE) must not crash the run.
  pool.on('error', () => {});
  pools.push(pool);
  return pool;
}

async function closePools() {
  const open = pools;
  pools = [];
  await Promise.all(open.map(p => p.end().catch(() => {})));
}

async function runSql(url, sql) {
  const pool = openPool(url);
  await pool.query(sql);
}

async function applyMigrations(url, files) {
  const names = files || fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const file of names) {
    await runSql(url, fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
}

async function applySchema(url) {
  await runSql(url, fs.readFileSync(SCHEMA_FILE, 'utf8'));
}

async function dropScratchDb(name) {
  if (typeof name !== 'string' || !name.startsWith('prw_test_') || !NAME_PATTERN.test(name)) {
    throw new Error('Refusing to drop a database that is not a prw_test_ scratch database');
  }
  if (!created.has(name)) {
    throw new Error('Refusing to drop a scratch database this process did not create');
  }
  await closePools();
  await runAdmin(`DROP DATABASE "${name}" WITH (FORCE)`);
  created.delete(name);
}

module.exports = {
  requireDatabaseUrl,
  scratchName,
  withDatabaseName,
  createScratchDb,
  useScratchEnv,
  openPool,
  closePools,
  applyMigrations,
  applySchema,
  dropScratchDb,
};
