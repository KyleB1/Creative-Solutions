const fs = require('fs/promises');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, 'data');
const SQLITE_DB_PATH = path.resolve(process.env.DATA_SQLITE_PATH || path.join(DATA_DIR, 'app-data.sqlite'));
const POSTGRES_URL = String(process.env.DATA_POSTGRES_URL || process.env.DATABASE_URL || '').trim();
const CUSTOMER_STORE_PATH = path.resolve(process.env.CUSTOMER_STORE_PATH || path.join(DATA_DIR, 'customer-accounts.json'));
const ADMIN_STORE_PATH = path.resolve(process.env.ADMIN_STORE_PATH || path.join(DATA_DIR, 'admin-state.json'));
const SESSION_STORE_PATH = path.resolve(process.env.SESSION_STORE_PATH || path.join(DATA_DIR, 'sessions.json'));
const CONTACT_STORE_PATH = path.resolve(process.env.CONTACT_STORE_PATH || path.join(DATA_DIR, 'contact-submissions.json'));

const requestedBackend = String(process.env.DATA_BACKEND || 'sqlite').trim().toLowerCase();
let sqliteAvailable = false;
let sqlite3 = null;
let postgresAvailable = false;
let pg = null;

if (requestedBackend !== 'file') {
  try {
    sqlite3 = require('sqlite3').verbose();
    sqliteAvailable = true;
  } catch (error) {
    logger.warn(`sqlite3 module not available (${error.message}).`);
  }
}

if (requestedBackend === 'postgres') {
  try {
    pg = require('pg');
    postgresAvailable = true;
  } catch (error) {
    logger.warn(`pg module not available (${error.message}).`);
  }
}

function resolveBackend() {
  if (requestedBackend === 'file') {
    return 'file';
  }

  if (requestedBackend === 'postgres') {
    if (!postgresAvailable) {
      logger.warn('DATA_BACKEND=postgres requested but pg is unavailable. Falling back.');
    } else if (!POSTGRES_URL) {
      logger.warn('DATA_BACKEND=postgres requested but DATA_POSTGRES_URL/DATABASE_URL is not set. Falling back.');
    } else {
      return 'postgres';
    }
  }

  if (sqliteAvailable) {
    return 'sqlite';
  }

  if (requestedBackend !== 'file') {
    logger.warn('No database adapter available; using file storage fallback.');
  }
  return 'file';
}

const activeBackend = resolveBackend();
const usingDatabase = activeBackend !== 'file';
let dbPromise = null;
let sqliteWriteQueue = Promise.resolve();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

async function ensureDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (_error) {
    return cloneValue(fallback);
  }
}

async function writeJsonFile(filePath, value) {
  await ensureDirectory(filePath);
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function isPostgresDb(db) {
  return Boolean(db && db.kind === 'postgres');
}

function toDriverSql(db, sql) {
  if (!isPostgresDb(db)) {
    return sql;
  }

  let index = 0;
  return String(sql).replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

function queueSqliteWrite(operation) {
  sqliteWriteQueue = sqliteWriteQueue.then(operation, operation);
  return sqliteWriteQueue;
}

async function openDatabase() {
  if (!usingDatabase) return null;
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    if (activeBackend === 'postgres') {
      const { Pool } = pg;
      const pool = new Pool({
        connectionString: POSTGRES_URL,
        ssl: String(process.env.DATA_POSTGRES_SSL || '').toLowerCase() === 'true'
          ? { rejectUnauthorized: false }
          : undefined
      });

      await pool.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);

      await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_json TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);

      await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_submissions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL
      )
    `);

      const db = { kind: 'postgres', pool };
      await migrateFromFileStores(db);
      return db;
    }

    await ensureDirectory(SQLITE_DB_PATH);
    const sqlite = await new Promise((resolve, reject) => {
      const handle = new sqlite3.Database(SQLITE_DB_PATH, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve(handle);
        }
      });
    });

    const db = { kind: 'sqlite', handle: sqlite };

    await runSql(db, `
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await runSql(db, `
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await runSql(db, `
      CREATE TABLE IF NOT EXISTS contact_submissions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        status TEXT NOT NULL
      )
    `);

    await migrateFromFileStores(db);
    return db;
  })().catch((error) => {
    logger.error(`Failed to initialize ${activeBackend} database. Falling back to file storage for this process.`, error);
    return null;
  });

  return dbPromise;
}

function runSql(db, sql, params = []) {
  if (isPostgresDb(db)) {
    return db.pool.query(toDriverSql(db, sql), params).then((result) => result);
  }

  return new Promise((resolve, reject) => {
    db.handle.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
      } else {
        resolve(this);
      }
    });
  });
}

function getSql(db, sql, params = []) {
  if (isPostgresDb(db)) {
    return db.pool
      .query(toDriverSql(db, sql), params)
      .then((result) => (result.rows && result.rows[0] ? result.rows[0] : null));
  }

  return new Promise((resolve, reject) => {
    db.handle.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
      } else {
        resolve(row || null);
      }
    });
  });
}

function allSql(db, sql, params = []) {
  if (isPostgresDb(db)) {
    return db.pool.query(toDriverSql(db, sql), params).then((result) => result.rows || []);
  }

  return new Promise((resolve, reject) => {
    db.handle.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
      } else {
        resolve(rows || []);
      }
    });
  });
}

async function seedKvIfMissing(db, key, filePath, fallback) {
  const existing = await getSql(db, 'SELECT key FROM kv_store WHERE key = ?', [key]);
  if (existing) return;

  const value = await readJsonFile(filePath, fallback);
  await runSql(
    db,
    'INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)',
    [key, JSON.stringify(value), new Date().toISOString()]
  );
}

async function migrateFromFileStores(db) {
  const migrationSetting = String(process.env.DATA_MIGRATE_FROM_FILES || 'true').trim().toLowerCase();
  if (migrationSetting === 'false' || migrationSetting === '0' || migrationSetting === 'no') {
    return;
  }

  await seedKvIfMissing(db, 'customer_store', CUSTOMER_STORE_PATH, { customers: {} });
  await seedKvIfMissing(db, 'admin_store', ADMIN_STORE_PATH, {
    supportSettings: {
      passwordSalt: null,
      passwordHash: null,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      updatedAt: null,
      updatedBy: null
    },
    supportTickets: [],
    auditLog: []
  });

  const sessionsCount = await getSql(db, 'SELECT COUNT(1) AS count FROM sessions');
  if (!sessionsCount || Number(sessionsCount.count || 0) === 0) {
    const source = await readJsonFile(SESSION_STORE_PATH, { sessions: {} });
    const entries = source && source.sessions && typeof source.sessions === 'object'
      ? Object.entries(source.sessions)
      : [];

    for (const [sessionId, session] of entries) {
      if (!session || typeof session.expiresAt !== 'number' || !session.user) continue;
      await runSql(
        db,
        `INSERT INTO sessions (session_id, user_json, expires_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE
         SET user_json = excluded.user_json,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at`,
        [sessionId, JSON.stringify(session.user), session.expiresAt, new Date().toISOString()]
      );
    }
  }

  const contactsCount = await getSql(db, 'SELECT COUNT(1) AS count FROM contact_submissions');
  if (!contactsCount || Number(contactsCount.count || 0) === 0) {
    const source = await readJsonFile(CONTACT_STORE_PATH, []);
    const submissions = Array.isArray(source) ? source : [];
    for (const entry of submissions) {
      if (!entry || !entry.id) continue;
      await runSql(
        db,
        `INSERT INTO contact_submissions
         (id, name, email, message, submitted_at, status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE
         SET name = excluded.name,
             email = excluded.email,
             message = excluded.message,
             submitted_at = excluded.submitted_at,
             status = excluded.status`,
        [
          String(entry.id),
          String(entry.name || ''),
          String(entry.email || ''),
          String(entry.message || ''),
          String(entry.submittedAt || new Date().toISOString()),
          String(entry.status || 'new')
        ]
      );
    }
  }
}

async function readJsonStore(key, fallback) {
  const db = await openDatabase();
  if (!db) {
    if (key === 'customer_store') return readJsonFile(CUSTOMER_STORE_PATH, fallback);
    if (key === 'admin_store') return readJsonFile(ADMIN_STORE_PATH, fallback);
    return cloneValue(fallback);
  }

  const row = await getSql(db, 'SELECT value FROM kv_store WHERE key = ?', [key]);
  if (!row || !row.value) return cloneValue(fallback);

  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' ? parsed : cloneValue(fallback);
  } catch (_error) {
    return cloneValue(fallback);
  }
}

async function writeJsonStore(key, value) {
  const db = await openDatabase();
  if (!db) {
    if (key === 'customer_store') {
      await writeJsonFile(CUSTOMER_STORE_PATH, value);
      return;
    }
    if (key === 'admin_store') {
      await writeJsonFile(ADMIN_STORE_PATH, value);
      return;
    }
    return;
  }

  await runSql(
    db,
    `INSERT INTO kv_store (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), new Date().toISOString()]
  );
}

async function readSessionMap() {
  const db = await openDatabase();
  if (!db) {
    const payload = await readJsonFile(SESSION_STORE_PATH, { sessions: {} });
    return payload && payload.sessions && typeof payload.sessions === 'object' ? payload.sessions : {};
  }

  const rows = await allSql(db, 'SELECT session_id, user_json, expires_at FROM sessions');
  const map = {};
  for (const row of rows) {
    try {
      map[row.session_id] = {
        user: JSON.parse(row.user_json),
        expiresAt: Number(row.expires_at)
      };
    } catch (_error) {
      // Ignore corrupted rows.
    }
  }
  return map;
}

async function writeSessionMap(map) {
  const safeMap = map && typeof map === 'object' ? map : {};
  const db = await openDatabase();
  if (!db) {
    await writeJsonFile(SESSION_STORE_PATH, { sessions: safeMap });
    return;
  }

  const writer = async () => {
    await runSql(db, 'BEGIN TRANSACTION');
    try {
      await runSql(db, 'DELETE FROM sessions');
      const entries = Object.entries(safeMap);
      for (const [sessionId, session] of entries) {
        if (!session || !session.user || typeof session.expiresAt !== 'number') continue;
        await runSql(
          db,
          `INSERT INTO sessions (session_id, user_json, expires_at, updated_at)
           VALUES (?, ?, ?, ?)`,
          [sessionId, JSON.stringify(session.user), session.expiresAt, new Date().toISOString()]
        );
      }
      await runSql(db, 'COMMIT');
    } catch (error) {
      await runSql(db, 'ROLLBACK');
      throw error;
    }
  };

  if (isPostgresDb(db)) {
    await writer();
    return;
  }

  await queueSqliteWrite(writer);
}

async function readContactSubmissions() {
  const db = await openDatabase();
  if (!db) {
    const payload = await readJsonFile(CONTACT_STORE_PATH, []);
    return Array.isArray(payload) ? payload : [];
  }

  const rows = await allSql(
    db,
    `SELECT id, name, email, message, submitted_at, status
     FROM contact_submissions
     ORDER BY submitted_at ASC`
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    message: row.message,
    submittedAt: row.submitted_at,
    status: row.status
  }));
}

async function writeContactSubmissions(list) {
  const safeList = Array.isArray(list) ? list : [];
  const db = await openDatabase();
  if (!db) {
    await writeJsonFile(CONTACT_STORE_PATH, safeList);
    return;
  }

  const writer = async () => {
    await runSql(db, 'BEGIN TRANSACTION');
    try {
      await runSql(db, 'DELETE FROM contact_submissions');
      for (const entry of safeList) {
        await runSql(
          db,
          `INSERT INTO contact_submissions (id, name, email, message, submitted_at, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            String(entry.id || ''),
            String(entry.name || ''),
            String(entry.email || ''),
            String(entry.message || ''),
            String(entry.submittedAt || new Date().toISOString()),
            String(entry.status || 'new')
          ]
        );
      }
      await runSql(db, 'COMMIT');
    } catch (error) {
      await runSql(db, 'ROLLBACK');
      throw error;
    }
  };

  if (isPostgresDb(db)) {
    await writer();
    return;
  }

  await queueSqliteWrite(writer);
}

module.exports = {
  backend: activeBackend,
  isUsingDatabase: usingDatabase,
  openDatabase,
  readJsonStore,
  writeJsonStore,
  readSessionMap,
  writeSessionMap,
  readContactSubmissions,
  writeContactSubmissions
};
