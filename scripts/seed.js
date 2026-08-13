#!/usr/bin/env node
'use strict';

/* Seeds the starting owners and planes.
 *   node scripts/seed.js            add anything missing
 *   node scripts/seed.js --demo     also add a few sample reservations
 *   node scripts/seed.js --reset    wipe owners/planes/reservations first
 */

const { db } = require('../src/db');
const store = require('../src/store');

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const demo = args.includes('--demo');

const SEED = [
  {
    name: 'Vinod',
    slug: 'vinod',
    phone: '(555) 010-0001',
    email: 'vinod@example.com',
    planes: [{ tailNumber: 'N4521T', model: 'Cessna 172N Skyhawk', nickname: 'The Skyhawk' }],
  },
  {
    name: 'Soney',
    slug: 'soney',
    phone: '(555) 010-0002',
    email: 'soney@example.com',
    planes: [
      { tailNumber: 'N738QP', model: 'Cessna 182Q Skylane', nickname: 'Skylane' },
      { tailNumber: 'N9047L', model: 'Piper PA-28-181 Archer II', nickname: 'Archer' },
      { tailNumber: 'N152DB', model: 'Cessna 152', nickname: 'The trainer' },
      { tailNumber: 'N6721J', model: 'Beechcraft A36 Bonanza', nickname: 'Bonanza' },
      { tailNumber: 'N4109X', model: 'Piper PA-32 Cherokee Six', nickname: 'Six-seater' },
    ],
  },
];

if (reset) {
  db.exec('DELETE FROM reservations; DELETE FROM planes; DELETE FROM owners;');
  console.log('Cleared owners, planes and reservations.');
}

for (const entry of SEED) {
  let owner = store.getOwnerBySlug(entry.slug);
  if (!owner) {
    owner = store.createOwner({ name: entry.name, slug: entry.slug, phone: entry.phone, email: entry.email });
    console.log(`Added owner ${owner.name} -> /rent/${owner.slug}`);
  }
  const existing = new Set(store.listPlanes({ ownerId: owner.id, includeInactive: true }).map((p) => p.tailNumber));
  for (const plane of entry.planes) {
    if (existing.has(plane.tailNumber)) continue;
    store.createPlane({ ownerId: owner.id, ...plane });
    console.log(`  + ${plane.tailNumber} (${plane.model})`);
  }
}

if (demo) {
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  const startOfTomorrow = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() + DAY;
  })();
  const planes = store.listPlanes();
  const samples = [
    { planeIndex: 0, offsetDays: 1, startHour: 9, hours: 3, name: 'Sample Renter', phone: '(555) 222-3344' },
    { planeIndex: 1, offsetDays: 2, startHour: 13, hours: 2, name: 'Another Renter', phone: '(555) 777-8899' },
    { planeIndex: 1, offsetDays: 4, startHour: 8, hours: 4, name: 'Weekend Flyer', phone: '(555) 444-1122' },
  ];
  for (const sample of samples) {
    const plane = planes[sample.planeIndex];
    if (!plane) continue;
    const start = startOfTomorrow + sample.offsetDays * DAY + sample.startHour * HOUR;
    try {
      const reservation = store.createReservation(
        {
          planeId: plane.id,
          start,
          end: start + sample.hours * HOUR,
          renterName: sample.name,
          renterPhone: sample.phone,
          renterEmail: `${sample.name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
        },
        { asAdmin: true }
      );
      console.log(`  demo booking ${reservation.confirmationId} on ${plane.tailNumber}`);
    } catch (err) {
      console.log(`  demo booking skipped: ${err.message}`);
    }
  }
}

console.log('Seed complete.');
