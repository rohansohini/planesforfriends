'use strict';

const crypto = require('node:crypto');
const { db, getSetting } = require('./db');
// The same rules the browser applies as you type, so a phone-in booking entered
// through the API is stored exactly like one typed into a form.
const { tidyPhone, tidyEmail } = require('../public/js/format.js');

/* ---------- helpers ---------- */

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I to keep it readable over the phone

function newConfirmationId() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = crypto.randomBytes(6);
    let code = '';
    for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    const id = `PFF-${code}`;
    const taken = db.prepare('SELECT 1 AS ok FROM reservations WHERE confirmation_id = ?').get(id);
    if (!taken) return id;
  }
  throw new Error('Could not generate a unique confirmation ID');
}

function normalizeConfirmationId(raw) {
  const cleaned = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return '';
  const body = cleaned.startsWith('PFF') ? cleaned.slice(3) : cleaned;
  return `PFF-${body}`;
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function uniqueSlug(name, excludeId = null) {
  const base = slugify(name) || 'owner';
  let candidate = base;
  let n = 2;
  for (;;) {
    const row = excludeId
      ? db.prepare('SELECT id FROM owners WHERE slug = ? AND id != ?').get(candidate, excludeId)
      : db.prepare('SELECT id FROM owners WHERE slug = ?').get(candidate);
    if (!row) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

const bool = (v) => (v ? 1 : 0);

/**
 * How much a renter actually handed over. Blank means "nothing recorded", which
 * is not the same as zero — plenty of rentals are settled before anyone gets
 * round to typing the number in. Dollar signs and commas are stripped so a
 * pasted "$1,250.00" works.
 */
function parseAmount(raw) {
  if (raw == null || raw === '') return null;
  const cleaned = typeof raw === 'string' ? raw.replace(/[$,\s]/g, '') : raw;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) throw new HttpError(400, 'Enter the amount as a number, e.g. 240 or 240.50');
  if (value > 1000000) throw new HttpError(400, 'That amount looks too large.');
  return Math.round(value * 100) / 100;
}

/* ---------- owners ---------- */

function listOwners({ includeInactive = false } = {}) {
  const sql = includeInactive
    ? `${OWNER_SELECT} ORDER BY o.name COLLATE NOCASE`
    : `${OWNER_SELECT} WHERE o.active = 1 ORDER BY o.name COLLATE NOCASE`;
  return db.prepare(sql).all().map(mapOwner);
}

function mapOwner(row) {
  if (!row) return null;
  // contactName/contactPhone are who a renter should call: the manager when one
  // is set, otherwise the owner. Everything renter-facing uses these.
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    phone: row.phone,
    email: row.email,
    managerId: row.manager_id ?? null,
    managerName: row.manager_name ?? null,
    managerPhone: row.manager_phone ?? null,
    contactName: row.manager_name || row.name,
    contactPhone: row.manager_name ? row.manager_phone : row.phone,
    active: !!row.active,
    createdAt: row.created_at,
  };
}

const OWNER_SELECT = `
  SELECT o.*, m.name AS manager_name, m.phone AS manager_phone
  FROM owners o LEFT JOIN owners m ON m.id = o.manager_id
`;

/**
 * Managers are one level deep on purpose: Soney handles Vinod's rentals, and
 * that is the whole idea. Chains would raise questions nobody wants to answer,
 * like whose number goes on the confirmation three hops up.
 */
function validateManager(ownerId, managerId) {
  if (managerId == null || managerId === '') return null;
  const id = Number(managerId);
  if (!Number.isFinite(id)) throw new HttpError(400, 'Pick a valid manager.');
  if (ownerId != null && id === Number(ownerId)) {
    throw new HttpError(400, 'Somebody cannot manage their own rentals — leave the manager empty instead.');
  }
  const manager = db.prepare('SELECT id, name, manager_id FROM owners WHERE id = ?').get(id);
  if (!manager) throw new HttpError(400, 'Pick a valid manager.');
  if (manager.manager_id != null) {
    throw new HttpError(
      400,
      `${manager.name}'s own rentals are handled by somebody else, so ${manager.name} cannot manage anyone.`
    );
  }
  if (ownerId != null) {
    const managed = db.prepare('SELECT name FROM owners WHERE manager_id = ?').get(Number(ownerId));
    if (managed) {
      throw new HttpError(
        400,
        `This person manages ${managed.name}'s rentals, so they cannot be managed by someone else. ` +
          'Clear that first if you want to swap them round.'
      );
    }
  }
  return id;
}

function getOwnerBySlug(slug) {
  return mapOwner(db.prepare(`${OWNER_SELECT} WHERE o.slug = ?`).get(String(slug || '').toLowerCase()));
}

function getOwner(id) {
  return mapOwner(db.prepare(`${OWNER_SELECT} WHERE o.id = ?`).get(Number(id)));
}

function createOwner({ name, phone = '', email = '', slug = '', managerId = null }) {
  const finalName = String(name || '').trim();
  if (!finalName) throw new HttpError(400, 'Owner name is required.');
  const finalSlug = uniqueSlug(slug || finalName);
  const manager = validateManager(null, managerId);
  const info = db
    .prepare(
      'INSERT INTO owners (slug, name, phone, email, manager_id, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
    )
    .run(finalSlug, finalName, tidyPhone(phone), tidyEmail(email), manager, Date.now());
  return getOwner(info.lastInsertRowid);
}

function updateOwner(id, patch) {
  const owner = getOwner(id);
  if (!owner) throw new HttpError(404, 'Owner not found.');
  const name = patch.name !== undefined ? String(patch.name).trim() : owner.name;
  if (!name) throw new HttpError(400, 'Owner name cannot be empty.');
  const slug = patch.slug !== undefined ? uniqueSlug(patch.slug || name, owner.id) : owner.slug;
  const manager =
    patch.managerId !== undefined ? validateManager(owner.id, patch.managerId) : owner.managerId;
  db.prepare(
    'UPDATE owners SET name = ?, slug = ?, phone = ?, email = ?, manager_id = ?, active = ? WHERE id = ?'
  ).run(
    name,
    slug,
    patch.phone !== undefined ? tidyPhone(patch.phone) : owner.phone,
    patch.email !== undefined ? tidyEmail(patch.email) : owner.email,
    manager,
    patch.active !== undefined ? bool(patch.active) : bool(owner.active),
    owner.id
  );
  return getOwner(owner.id);
}

function deleteOwner(id) {
  const owner = getOwner(id);
  if (!owner) throw new HttpError(404, 'Owner not found.');
  const managed = db.prepare('SELECT name FROM owners WHERE manager_id = ?').get(owner.id);
  if (managed) {
    throw new HttpError(
      400,
      `${owner.name} manages ${managed.name}'s rentals. Change that first, or renters would have nobody to call.`
    );
  }
  const planes = db.prepare('SELECT COUNT(*) AS n FROM planes WHERE owner_id = ?').get(owner.id).n;
  if (planes > 0) {
    throw new HttpError(400, `${owner.name} still has ${planes} plane(s). Reassign or delete those first.`);
  }
  db.prepare('DELETE FROM owners WHERE id = ?').run(owner.id);
  return { ok: true };
}

/* ---------- planes ---------- */

function mapPlane(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? undefined,
    ownerSlug: row.owner_slug ?? undefined,
    ownerPhone: row.owner_phone ?? undefined,
    tailNumber: row.tail_number,
    model: row.model,
    nickname: row.nickname,
    notes: row.notes,
    active: !!row.active,
    createdAt: row.created_at,
  };
}

const PLANE_SELECT = `
  SELECT p.*, o.name AS owner_name, o.slug AS owner_slug, o.phone AS owner_phone
  FROM planes p JOIN owners o ON o.id = p.owner_id
`;

function listPlanes({ ownerId = null, includeInactive = false } = {}) {
  const where = [];
  const args = [];
  if (ownerId != null) {
    where.push('p.owner_id = ?');
    args.push(Number(ownerId));
  }
  if (!includeInactive) where.push('p.active = 1');
  const sql = `${PLANE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY o.name COLLATE NOCASE, p.tail_number COLLATE NOCASE`;
  return db.prepare(sql).all(...args).map(mapPlane);
}

function getPlane(id) {
  return mapPlane(db.prepare(`${PLANE_SELECT} WHERE p.id = ?`).get(Number(id)));
}

function createPlane({ ownerId, tailNumber, model = '', nickname = '', notes = '', active = true }) {
  const owner = getOwner(ownerId);
  if (!owner) throw new HttpError(400, 'Pick a valid owner for this plane.');
  const tail = String(tailNumber || '').trim().toUpperCase();
  if (!tail) throw new HttpError(400, 'Tail number is required.');
  const clash = db.prepare('SELECT id FROM planes WHERE tail_number = ?').get(tail);
  if (clash) throw new HttpError(400, `Tail number ${tail} is already in the system.`);
  const info = db
    .prepare(
      `INSERT INTO planes (owner_id, tail_number, model, nickname, notes, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(owner.id, tail, String(model).trim(), String(nickname).trim(), String(notes).trim(), bool(active), Date.now());
  return getPlane(info.lastInsertRowid);
}

function updatePlane(id, patch) {
  const plane = getPlane(id);
  if (!plane) throw new HttpError(404, 'Plane not found.');
  let ownerId = plane.ownerId;
  if (patch.ownerId !== undefined) {
    const owner = getOwner(patch.ownerId);
    if (!owner) throw new HttpError(400, 'Pick a valid owner for this plane.');
    ownerId = owner.id;
  }
  let tail = plane.tailNumber;
  if (patch.tailNumber !== undefined) {
    tail = String(patch.tailNumber).trim().toUpperCase();
    if (!tail) throw new HttpError(400, 'Tail number cannot be empty.');
    const clash = db.prepare('SELECT id FROM planes WHERE tail_number = ? AND id != ?').get(tail, plane.id);
    if (clash) throw new HttpError(400, `Tail number ${tail} is already in the system.`);
  }
  db.prepare(
    'UPDATE planes SET owner_id = ?, tail_number = ?, model = ?, nickname = ?, notes = ?, active = ? WHERE id = ?'
  ).run(
    ownerId,
    tail,
    patch.model !== undefined ? String(patch.model).trim() : plane.model,
    patch.nickname !== undefined ? String(patch.nickname).trim() : plane.nickname,
    patch.notes !== undefined ? String(patch.notes).trim() : plane.notes,
    patch.active !== undefined ? bool(patch.active) : bool(plane.active),
    plane.id
  );
  return getPlane(plane.id);
}

function deletePlane(id) {
  const plane = getPlane(id);
  if (!plane) throw new HttpError(404, 'Plane not found.');
  db.prepare('DELETE FROM reservations WHERE plane_id = ?').run(plane.id);
  db.prepare('DELETE FROM planes WHERE id = ?').run(plane.id);
  return { ok: true };
}

/* ---------- reservations ---------- */

function mapReservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    confirmationId: row.confirmation_id,
    planeId: row.plane_id,
    planeTail: row.tail_number ?? undefined,
    planeModel: row.model ?? undefined,
    planeNickname: row.nickname ?? undefined,
    ownerId: row.owner_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    ownerSlug: row.owner_slug ?? undefined,
    ownerPhone: row.owner_phone ?? undefined,
    contactName: row.manager_name || row.owner_name,
    contactPhone: row.manager_name ? row.manager_phone : row.owner_phone,
    kind: row.kind,
    renterName: row.renter_name,
    renterPhone: row.renter_phone,
    renterEmail: row.renter_email,
    start: row.start_ts,
    end: row.end_ts,
    status: row.status,
    hobbsTime: row.hobbs_time,
    hobbsLoggedAt: row.hobbs_logged_at,
    paid: !!row.paid,
    paidAt: row.paid_at,
    paidAmount: row.paid_amount,
    notes: row.notes,
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const RES_SELECT = `
  SELECT r.*, p.tail_number, p.model, p.nickname, p.owner_id,
         o.name AS owner_name, o.slug AS owner_slug, o.phone AS owner_phone,
         m.name AS manager_name, m.phone AS manager_phone
  FROM reservations r
  JOIN planes p ON p.id = r.plane_id
  JOIN owners o ON o.id = p.owner_id
  LEFT JOIN owners m ON m.id = o.manager_id
`;

function getReservation(id) {
  return mapReservation(db.prepare(`${RES_SELECT} WHERE r.id = ?`).get(Number(id)));
}

function getReservationByConfirmation(confirmationId) {
  const id = normalizeConfirmationId(confirmationId);
  if (!id) return null;
  return mapReservation(db.prepare(`${RES_SELECT} WHERE r.confirmation_id = ?`).get(id));
}

function listReservations({
  planeId = null,
  ownerId = null,
  from = null,
  to = null,
  paid = null,
  includeCancelled = true,
} = {}) {
  const where = [];
  const args = [];
  if (planeId != null) {
    where.push('r.plane_id = ?');
    args.push(Number(planeId));
  }
  if (ownerId != null) {
    where.push('p.owner_id = ?');
    args.push(Number(ownerId));
  }
  if (from != null) {
    where.push('r.end_ts > ?');
    args.push(Number(from));
  }
  if (to != null) {
    where.push('r.start_ts < ?');
    args.push(Number(to));
  }
  if (paid != null) {
    where.push('r.paid = ?');
    args.push(bool(paid));
  }
  if (!includeCancelled) where.push("r.status = 'confirmed'");
  const sql = `${RES_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.start_ts`;
  return db.prepare(sql).all(...args).map(mapReservation);
}

function findConflicts({ planeId, start, end, excludeId = null }) {
  const args = [Number(planeId), Number(end), Number(start)];
  let sql = `${RES_SELECT} WHERE r.plane_id = ? AND r.status = 'confirmed' AND r.start_ts < ? AND r.end_ts > ?`;
  if (excludeId != null) {
    sql += ' AND r.id != ?';
    args.push(Number(excludeId));
  }
  return db.prepare(sql).all(...args).map(mapReservation);
}

function validateWindow(start, end) {
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw new HttpError(400, 'Pick a start and end time.');
  if (e <= s) throw new HttpError(400, 'The end time has to be after the start time.');
  if (e - s > 30 * 24 * 60 * 60 * 1000) throw new HttpError(400, 'That reservation is longer than 30 days.');
  return { start: s, end: e };
}

function createReservation(input, { asAdmin = false } = {}) {
  const plane = getPlane(input.planeId);
  if (!plane) throw new HttpError(400, 'Pick a plane.');
  if (!plane.active && !asAdmin) throw new HttpError(400, 'That plane is not available for rental right now.');

  const { start, end } = validateWindow(input.start, input.end);
  const kind = input.kind === 'block' ? 'block' : 'rental';

  const name = String(input.renterName || '').trim();
  const phone = tidyPhone(input.renterPhone);
  const email = tidyEmail(input.renterEmail);

  if (kind === 'rental') {
    if (!name) throw new HttpError(400, 'Please enter your name.');
    if (!phone) throw new HttpError(400, 'Please enter a phone number.');
    if (!email) throw new HttpError(400, 'Please enter an email address.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'That email address does not look right.');
    if (phone.replace(/\D/g, '').length < 7) throw new HttpError(400, 'That phone number does not look right.');
  }

  if (!asAdmin) {
    const now = Date.now();
    if (start < now - 60 * 60 * 1000) throw new HttpError(400, 'That start time is in the past.');
    const maxAhead = Number(getSetting('max_days_ahead', '180')) * 24 * 60 * 60 * 1000;
    if (start > now + maxAhead) {
      throw new HttpError(400, `Reservations open ${getSetting('max_days_ahead', '180')} days ahead.`);
    }
  }

  const conflicts = findConflicts({ planeId: plane.id, start, end });
  if (conflicts.length) throw new HttpError(409, 'That time was just taken on this plane. Please pick another slot.');

  const now = Date.now();
  const confirmationId = newConfirmationId();
  const info = db
    .prepare(
      `INSERT INTO reservations
        (confirmation_id, plane_id, kind, renter_name, renter_phone, renter_email,
         start_ts, end_ts, status, hobbs_time, hobbs_logged_at, paid, paid_at, paid_amount,
         notes, admin_notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      confirmationId,
      plane.id,
      kind,
      name,
      phone,
      email,
      start,
      end,
      asAdmin && input.paid ? 1 : 0,
      asAdmin && input.paid ? now : null,
      asAdmin ? parseAmount(input.paidAmount) : null,
      String(input.notes || '').trim(),
      asAdmin ? String(input.adminNotes || '').trim() : '',
      now,
      now
    );
  return getReservation(info.lastInsertRowid);
}

function updateReservation(id, patch) {
  const existing = getReservation(id);
  if (!existing) throw new HttpError(404, 'Reservation not found.');

  let planeId = existing.planeId;
  if (patch.planeId !== undefined) {
    const plane = getPlane(patch.planeId);
    if (!plane) throw new HttpError(400, 'Pick a valid plane.');
    planeId = plane.id;
  }

  const start = patch.start !== undefined ? Number(patch.start) : existing.start;
  const end = patch.end !== undefined ? Number(patch.end) : existing.end;
  validateWindow(start, end);

  const status = patch.status !== undefined ? String(patch.status) : existing.status;
  if (!['confirmed', 'cancelled'].includes(status)) throw new HttpError(400, 'Unknown reservation status.');

  const kind = patch.kind !== undefined ? (patch.kind === 'block' ? 'block' : 'rental') : existing.kind;

  // Relabelling somebody's booking as blocked-off time would strand them: their
  // confirmation ID would stop working with no explanation. Taking the time back
  // is a real action (takeBackTime) that cancels the booking properly instead.
  if (kind === 'block' && existing.kind === 'rental' && existing.renterName) {
    throw new HttpError(
      400,
      `${existing.renterName} is booked on this time. Use “Take this time back” so the reservation is cancelled ` +
        'and they can still look it up.'
    );
  }

  if (kind === 'rental' && existing.kind === 'block') {
    const name = patch.renterName !== undefined ? String(patch.renterName).trim() : existing.renterName;
    const phone = patch.renterPhone !== undefined ? tidyPhone(patch.renterPhone) : existing.renterPhone;
    const email = patch.renterEmail !== undefined ? tidyEmail(patch.renterEmail) : existing.renterEmail;
    if (!name || !phone || !email) {
      throw new HttpError(400, 'A rental needs a renter name, phone and email. Add those, or leave this as blocked-off time.');
    }
  }

  if (status === 'confirmed') {
    const conflicts = findConflicts({ planeId, start, end, excludeId: existing.id });
    if (conflicts.length) {
      const c = conflicts[0];
      throw new HttpError(
        409,
        `That overlaps ${c.confirmationId} (${c.kind === 'block' ? 'blocked time' : c.renterName || 'a reservation'}).`
      );
    }
  }

  let hobbsTime = existing.hobbsTime;
  let hobbsLoggedAt = existing.hobbsLoggedAt;
  if (patch.hobbsTime !== undefined) {
    if (patch.hobbsTime === null || patch.hobbsTime === '') {
      hobbsTime = null;
      hobbsLoggedAt = null;
    } else {
      const value = Number(patch.hobbsTime);
      if (!Number.isFinite(value) || value < 0) throw new HttpError(400, 'Hobbs time must be a positive number.');
      hobbsTime = value;
      hobbsLoggedAt = Date.now();
    }
  }

  let paid = existing.paid;
  let paidAt = existing.paidAt;
  if (patch.paid !== undefined) {
    paid = !!patch.paid;
    // Keep the original timestamp when it was already marked paid.
    paidAt = paid ? existing.paidAt || Date.now() : null;
  }

  // The amount stands on its own: someone may record $240 before the cheque
  // clears, or tick paid without ever typing a figure. Clearing the box does
  // not wipe a number that was already entered.
  const paidAmount = patch.paidAmount !== undefined ? parseAmount(patch.paidAmount) : existing.paidAmount;

  db.prepare(
    `UPDATE reservations SET plane_id = ?, kind = ?, renter_name = ?, renter_phone = ?, renter_email = ?,
       start_ts = ?, end_ts = ?, status = ?, hobbs_time = ?, hobbs_logged_at = ?, paid = ?, paid_at = ?,
       paid_amount = ?, notes = ?, admin_notes = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    planeId,
    kind,
    patch.renterName !== undefined ? String(patch.renterName).trim() : existing.renterName,
    patch.renterPhone !== undefined ? tidyPhone(patch.renterPhone) : existing.renterPhone,
    patch.renterEmail !== undefined ? tidyEmail(patch.renterEmail) : existing.renterEmail,
    start,
    end,
    status,
    hobbsTime,
    hobbsLoggedAt,
    bool(paid),
    paidAt,
    paidAmount,
    patch.notes !== undefined ? String(patch.notes).trim() : existing.notes,
    patch.adminNotes !== undefined ? String(patch.adminNotes).trim() : existing.adminNotes,
    Date.now(),
    existing.id
  );
  return getReservation(existing.id);
}

function deleteReservation(id) {
  const existing = getReservation(id);
  if (!existing) throw new HttpError(404, 'Reservation not found.');
  db.prepare('DELETE FROM reservations WHERE id = ?').run(existing.id);
  return { ok: true };
}

function logHobbsTime(confirmationId, hobbsTime) {
  const reservation = getReservationByConfirmation(confirmationId);
  if (!reservation || reservation.kind !== 'rental') throw new HttpError(404, 'We could not find that confirmation ID.');
  if (reservation.status !== 'confirmed') throw new HttpError(400, 'That reservation was cancelled.');
  const value = Number(hobbsTime);
  if (!Number.isFinite(value) || value < 0) throw new HttpError(400, 'Enter the Hobbs time as a number, e.g. 3.4');
  if (value > 100000) throw new HttpError(400, 'That Hobbs reading looks too large.');
  const now = Date.now();
  db.prepare('UPDATE reservations SET hobbs_time = ?, hobbs_logged_at = ?, updated_at = ? WHERE id = ?').run(
    value,
    now,
    now,
    reservation.id
  );
  return getReservation(reservation.id);
}

/**
 * "I need my plane back that day." Cancels the renter's booking — so their
 * confirmation ID keeps working and shows them it was cancelled — and blocks
 * the same time off for the owner, in one step that cannot half-succeed.
 */
function takeBackTime(id, { notes = '' } = {}) {
  const reservation = getReservation(id);
  if (!reservation) throw new HttpError(404, 'Reservation not found.');
  if (reservation.kind !== 'rental') throw new HttpError(400, 'That time is already blocked off.');
  if (reservation.status !== 'confirmed') throw new HttpError(400, 'That reservation is already cancelled.');

  db.exec('BEGIN');
  try {
    db.prepare("UPDATE reservations SET status = 'cancelled', updated_at = ? WHERE id = ?").run(Date.now(), reservation.id);
    const block = createReservation(
      {
        planeId: reservation.planeId,
        start: reservation.start,
        end: reservation.end,
        kind: 'block',
        notes: notes || `Taken back from ${reservation.renterName || 'a renter'}`,
      },
      { asAdmin: true }
    );
    db.exec('COMMIT');
    return { cancelled: getReservation(reservation.id), block };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* ---------- availability (privacy-preserving) ---------- */

/**
 * Busy windows for a plane, with no renter details at all — the public
 * calendar only ever learns that a block of time is taken.
 */
function busyWindows({ planeId, from, to }) {
  const rows = db
    .prepare(
      `SELECT start_ts, end_ts, kind FROM reservations
       WHERE plane_id = ? AND status = 'confirmed' AND end_ts > ? AND start_ts < ?
       ORDER BY start_ts`
    )
    .all(Number(planeId), Number(from), Number(to));
  return rows.map((r) => ({ start: r.start_ts, end: r.end_ts, kind: r.kind }));
}

/* ---------- errors ---------- */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  HttpError,
  newConfirmationId,
  normalizeConfirmationId,
  slugify,
  listOwners,
  getOwner,
  getOwnerBySlug,
  createOwner,
  updateOwner,
  deleteOwner,
  listPlanes,
  getPlane,
  createPlane,
  updatePlane,
  deletePlane,
  getReservation,
  getReservationByConfirmation,
  listReservations,
  findConflicts,
  createReservation,
  updateReservation,
  deleteReservation,
  logHobbsTime,
  takeBackTime,
  busyWindows,
};
