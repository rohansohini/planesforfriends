'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.PFF_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.PFF_DB_PATH || path.join(DATA_DIR, 'planesforfriends.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS owners (
  id          INTEGER PRIMARY KEY,
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  phone       TEXT    NOT NULL DEFAULT '',
  email       TEXT    NOT NULL DEFAULT '',
  manager_id  INTEGER REFERENCES owners(id) ON DELETE SET NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS planes (
  id          INTEGER PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  tail_number TEXT    NOT NULL UNIQUE,
  model       TEXT    NOT NULL DEFAULT '',
  nickname    TEXT    NOT NULL DEFAULT '',
  notes       TEXT    NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id              INTEGER PRIMARY KEY,
  confirmation_id TEXT    NOT NULL UNIQUE,
  plane_id        INTEGER NOT NULL REFERENCES planes(id) ON DELETE CASCADE,
  kind            TEXT    NOT NULL DEFAULT 'rental',
  renter_name     TEXT    NOT NULL DEFAULT '',
  renter_phone    TEXT    NOT NULL DEFAULT '',
  renter_email    TEXT    NOT NULL DEFAULT '',
  start_ts        INTEGER NOT NULL,
  end_ts          INTEGER NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'confirmed',
  tach_time       REAL,
  tach_logged_at  INTEGER,
  paid            INTEGER NOT NULL DEFAULT 0,
  paid_at         INTEGER,
  notes           TEXT    NOT NULL DEFAULT '',
  admin_notes     TEXT    NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_res_plane_window ON reservations(plane_id, start_ts, end_ts);
CREATE INDEX IF NOT EXISTS idx_res_confirmation ON reservations(confirmation_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

/* ---------- migrations for databases created by an earlier version ---------- */

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('reservations', 'paid', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('reservations', 'paid_at', 'INTEGER');
addColumnIfMissing('reservations', 'admin_notes', "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('owners', 'manager_id', 'INTEGER REFERENCES owners(id) ON DELETE SET NULL');

/* ---------- password hashing (scrypt, no external deps) ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  let derived;
  try {
    derived = crypto.scryptSync(String(password), salt, expected.length);
  } catch {
    return false;
  }
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/* ---------- settings ---------- */

const DEFAULT_SETTINGS = {
  ops_contact_name: 'Soney',
  ops_contact_phone: '(555) 010-0002',
  timezone: 'America/Chicago',
  open_hour: '5',
  close_hour: '24',
  max_days_ahead: '180',
  site_title: 'Planes for Rent',
};

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  if (key in DEFAULT_SETTINGS) return DEFAULT_SETTINGS[key];
  return fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    if (row.key === 'admin_password_hash') continue;
    out[row.key] = row.value;
  }
  return out;
}

/* ---------- first-run bootstrap ---------- */

/* Two plain words and a number: easy to read over the phone, not guessable. */
const PASSWORD_WORDS = [
  'hangar', 'runway', 'compass', 'propeller', 'rudder', 'aileron', 'throttle', 'altimeter',
  'sunrise', 'tailwind', 'headwind', 'skyline', 'cockpit', 'beacon', 'chart', 'flightplan',
  'checklist', 'magneto', 'glidepath', 'windsock', 'cloudbase', 'airspeed',
];

function generatePassword() {
  const pick = () => PASSWORD_WORDS[crypto.randomInt(PASSWORD_WORDS.length)];
  let first = pick();
  let second = pick();
  while (second === first) second = pick();
  return `${first}-${second}-${crypto.randomInt(100, 1000)}`;
}

function banner(lines) {
  const width = Math.max(...lines.map((line) => line.length)) + 4;
  console.log(`\n┌${'─'.repeat(width)}┐`);
  for (const line of lines) console.log(`│  ${line.padEnd(width - 4)}  │`);
  console.log(`└${'─'.repeat(width)}┘\n`);
}

function bootstrap() {
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get();
  if (!existing) {
    const generated = process.env.ADMIN_PASSWORD ? null : generatePassword();
    setSetting('admin_password_hash', hashPassword(process.env.ADMIN_PASSWORD || generated));
    if (generated) {
      banner([
        'Admin password for this new database:',
        '',
        `    ${generated}`,
        '',
        'Write it down — this is the only time it is shown.',
        'You can change it any time at /admin under Settings.',
      ]);
    }
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const row = db.prepare('SELECT 1 AS ok FROM settings WHERE key = ?').get(key);
    if (!row) setSetting(key, value);
  }
  // Calendar hours used to default to 6am–9pm. Move databases that never
  // changed them to the current 5am–midnight default, but leave custom hours be.
  if (getSetting('calendar_hours_v2') !== 'done') {
    if (getSetting('open_hour') === '6' && getSetting('close_hour') === '21') {
      setSetting('open_hour', DEFAULT_SETTINGS.open_hour);
      setSetting('close_hour', DEFAULT_SETTINGS.close_hour);
    }
    setSetting('calendar_hours_v2', 'done');
  }
  // The site used to be called Planes for Friends. Rename databases still
  // carrying that as their title, but never overwrite a name someone chose.
  if (getSetting('site_title') === 'Planes for Friends') {
    setSetting('site_title', DEFAULT_SETTINGS.site_title);
  }
}

bootstrap();

function close() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
  } catch {
    /* already closed */
  }
}

module.exports = {
  db,
  close,
  DB_PATH,
  DATA_DIR,
  hashPassword,
  verifyPassword,
  getSetting,
  setSetting,
  allSettings,
  DEFAULT_SETTINGS,
};
