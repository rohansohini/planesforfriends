#!/usr/bin/env node
'use strict';

/* One-time clean-up of phone numbers and email addresses that were saved before
 * the forms started formatting them.
 *
 *   node scripts/tidy-contacts.js            -> shows what would change, changes nothing
 *   node scripts/tidy-contacts.js --apply    -> writes the changes
 *
 * Only rows that actually differ are touched, and only the phone/email columns.
 * Anything that is not a plain ten-digit number — an international number, one
 * with an extension — is left exactly as it was.
 */

const { db, close } = require('../src/db');
const { tidyPhone, tidyEmail } = require('../public/js/format.js');

const apply = process.argv.includes('--apply');
const changes = [];

for (const row of db.prepare('SELECT id, name, phone, email FROM owners').all()) {
  const phone = tidyPhone(row.phone);
  const email = tidyEmail(row.email);
  if (phone === row.phone && email === row.email) continue;
  changes.push({
    table: 'owners',
    id: row.id,
    label: row.name,
    from: `${row.phone} / ${row.email}`,
    to: `${phone} / ${email}`,
    run: () => db.prepare('UPDATE owners SET phone = ?, email = ? WHERE id = ?').run(phone, email, row.id),
  });
}

for (const row of db
  .prepare("SELECT id, confirmation_id, renter_phone, renter_email FROM reservations WHERE kind = 'rental'")
  .all()) {
  const phone = tidyPhone(row.renter_phone);
  const email = tidyEmail(row.renter_email);
  if (phone === row.renter_phone && email === row.renter_email) continue;
  changes.push({
    table: 'reservations',
    id: row.id,
    label: row.confirmation_id,
    from: `${row.renter_phone} / ${row.renter_email}`,
    to: `${phone} / ${email}`,
    run: () =>
      db
        .prepare('UPDATE reservations SET renter_phone = ?, renter_email = ?, updated_at = ? WHERE id = ?')
        .run(phone, email, Date.now(), row.id),
  });
}

if (!changes.length) {
  console.log('Nothing to tidy — every phone and email is already in the house style.');
  close();
  process.exit(0);
}

for (const change of changes) {
  console.log(`${change.table} ${change.label}`);
  console.log(`   ${change.from}`);
  console.log(`-> ${change.to}`);
}

if (!apply) {
  console.log(`\n${changes.length} record(s) would change. Re-run with --apply to write them.`);
  close();
  process.exit(0);
}

db.exec('BEGIN');
try {
  for (const change of changes) change.run();
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}
console.log(`\nUpdated ${changes.length} record(s).`);
close();
