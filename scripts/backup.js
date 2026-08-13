#!/usr/bin/env node
'use strict';

/* Safe copy of the live database — VACUUM INTO takes a consistent snapshot even
 * while the site is running, so this can be scheduled without stopping anything.
 *
 *   node scripts/backup.js                  -> data/backups/planesforfriends-<date>.db
 *   node scripts/backup.js /path/to/dir     -> somewhere else
 *   PFF_BACKUP_KEEP=30 node scripts/backup.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { db, DATA_DIR } = require('../src/db');

const targetDir = process.argv[2] || process.env.PFF_BACKUP_DIR || path.join(DATA_DIR, 'backups');
const keep = Number(process.env.PFF_BACKUP_KEEP || 30);

fs.mkdirSync(targetDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(targetDir, `planesforfriends-${stamp}.db`);

// VACUUM INTO refuses to overwrite, so a repeated run in the same second is a no-op.
if (fs.existsSync(target)) {
  console.log(`Backup already exists: ${target}`);
  process.exit(0);
}

db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
const size = fs.statSync(target).size;
console.log(`Backed up to ${target} (${(size / 1024).toFixed(0)} KB)`);

if (keep > 0) {
  const backups = fs
    .readdirSync(targetDir)
    .filter((name) => /^planesforfriends-.*\.db$/.test(name))
    .sort()
    .reverse();
  for (const stale of backups.slice(keep)) {
    fs.rmSync(path.join(targetDir, stale), { force: true });
    console.log(`Removed old backup ${stale}`);
  }
}
