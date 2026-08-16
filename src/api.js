'use strict';

const { allSettings, getSetting, setSetting, DEFAULT_SETTINGS } = require('./db');
const store = require('./store');
const { HttpError } = store;
const auth = require('./auth');

/* ---------- rental instructions ---------- */

function instructionsFor(reservation) {
  const opsName = getSetting('ops_contact_name', 'Soney');
  const opsPhone = getSetting('ops_contact_phone', '');
  // Whoever handles this owner's rentals — the manager if there is one.
  const ownerName = reservation.contactName || reservation.ownerName || 'the owner';
  const ownerPhone = reservation.contactPhone || reservation.ownerPhone || 'the number on file';
  return [
    `Contact ${ownerName} at ${ownerPhone} about renting.`,
    'Treat the plane as if it was your own.',
    'Top off the gas once you are finished.',
    `Contact ${opsName} at ${opsPhone} if there are any problems.`,
  ];
}

/* ---------- date helpers for CSV ---------- */

function formatInZone(ts, timeZone) {
  if (ts == null) return '';
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  } catch {
    return new Date(ts).toISOString();
  }
}

function csvCell(value) {
  const str = value == null ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function buildCsv(reservations, timeZone) {
  const header = [
    'Confirmation ID',
    'Type',
    'Status',
    'Owner',
    'Tail Number',
    'Model',
    'Start',
    'End',
    'Hours Reserved',
    'Hobbs Time',
    'Hobbs Logged',
    'Paid',
    'Amount Paid',
    'Paid On',
    'Renter Name',
    'Renter Phone',
    'Renter Email',
    'Renter Notes',
    'Owner Notes',
    'Booked At',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const r of reservations) {
    lines.push(
      [
        r.confirmationId,
        r.kind === 'block' ? 'Blocked' : 'Rental',
        r.status,
        r.ownerName,
        r.planeTail,
        r.planeModel,
        formatInZone(r.start, timeZone),
        formatInZone(r.end, timeZone),
        ((r.end - r.start) / 3600000).toFixed(2),
        r.hobbsTime == null ? '' : r.hobbsTime,
        formatInZone(r.hobbsLoggedAt, timeZone),
        r.paid ? 'Paid' : 'Unpaid',
        r.paidAmount == null ? '' : Number(r.paidAmount).toFixed(2),
        formatInZone(r.paidAt, timeZone),
        r.renterName,
        r.renterPhone,
        r.renterEmail,
        r.notes,
        r.adminNotes,
        formatInZone(r.createdAt, timeZone),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/* ---------- public shapes ---------- */

function publicPlane(p) {
  return {
    id: p.id,
    tailNumber: p.tailNumber,
    model: p.model,
    nickname: p.nickname,
    notes: p.notes,
    ownerName: p.ownerName,
    ownerSlug: p.ownerSlug,
  };
}

function renterView(r) {
  return {
    confirmationId: r.confirmationId,
    status: r.status,
    kind: r.kind,
    start: r.start,
    end: r.end,
    planeTail: r.planeTail,
    planeModel: r.planeModel,
    planeNickname: r.planeNickname,
    ownerName: r.ownerName,
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    ownerSlug: r.ownerSlug,
    renterName: r.renterName,
    renterPhone: r.renterPhone,
    renterEmail: r.renterEmail,
    hobbsTime: r.hobbsTime,
    hobbsLoggedAt: r.hobbsLoggedAt,
    instructions: instructionsFor(r),
  };
}

function publicSettings() {
  const s = allSettings();
  return {
    siteTitle: s.site_title,
    opsContactName: s.ops_contact_name,
    opsContactPhone: s.ops_contact_phone,
    timezone: s.timezone,
    openHour: Number(s.open_hour),
    closeHour: Number(s.close_hour),
    maxDaysAhead: Number(s.max_days_ahead),
  };
}

/* ---------- router ---------- */

const num = (v) => (v == null || v === '' ? null : Number(v));
const paidFilter = (v) => (v === '1' ? true : v === '0' ? false : null);

async function handleApi(req, res, ctx) {
  const { pathname, query, body, method, send } = ctx;

  /* ----- public ----- */

  if (pathname === '/api/config' && method === 'GET') {
    return send(200, publicSettings());
  }

  if (pathname === '/api/owners' && method === 'GET') {
    const owners = store.listOwners();
    return send(
      200,
      owners.map((o) => ({
        slug: o.slug,
        name: o.name,
        contactName: o.contactName,
        contactPhone: o.contactPhone,
        managed: !!o.managerId,
        planeCount: store.listPlanes({ ownerId: o.id }).length,
      }))
    );
  }

  const ownerMatch = pathname.match(/^\/api\/owners\/([A-Za-z0-9-]+)$/);
  if (ownerMatch && method === 'GET') {
    const owner = store.getOwnerBySlug(ownerMatch[1]);
    if (!owner || !owner.active) throw new HttpError(404, 'We could not find that page.');
    return send(200, {
      owner: {
        slug: owner.slug,
        name: owner.name,
        contactName: owner.contactName,
        contactPhone: owner.contactPhone,
        managed: !!owner.managerId,
      },
      planes: store.listPlanes({ ownerId: owner.id }).map(publicPlane),
    });
  }

  if (pathname === '/api/availability' && method === 'GET') {
    const planeId = num(query.get('planeId'));
    const from = num(query.get('from'));
    const to = num(query.get('to'));
    if (planeId == null || from == null || to == null) throw new HttpError(400, 'planeId, from and to are required.');
    const plane = store.getPlane(planeId);
    if (!plane || !plane.active) throw new HttpError(404, 'Plane not found.');
    return send(200, { planeId, from, to, busy: store.busyWindows({ planeId, from, to }) });
  }

  if (pathname === '/api/reservations' && method === 'POST') {
    const reservation = store.createReservation({
      planeId: body.planeId,
      start: body.start,
      end: body.end,
      renterName: body.renterName,
      renterPhone: body.renterPhone,
      renterEmail: body.renterEmail,
      notes: body.notes,
      kind: 'rental',
    });
    return send(201, renterView(reservation));
  }

  const lookupMatch = pathname.match(/^\/api\/reservations\/([A-Za-z0-9-]+)$/);
  if (lookupMatch && method === 'GET') {
    const reservation = store.getReservationByConfirmation(lookupMatch[1]);
    if (!reservation || reservation.kind !== 'rental') throw new HttpError(404, 'We could not find that confirmation ID.');
    return send(200, renterView(reservation));
  }

  // /tach is the old spelling, kept so a page left open across an update still works.
  const hobbsMatch = pathname.match(/^\/api\/reservations\/([A-Za-z0-9-]+)\/(?:hobbs|tach)$/);
  if (hobbsMatch && method === 'POST') {
    const reservation = store.logHobbsTime(hobbsMatch[1], body.hobbsTime ?? body.tachTime);
    return send(200, renterView(reservation));
  }

  /* ----- admin auth ----- */

  if (pathname === '/api/admin/login' && method === 'POST') {
    const token = auth.login(body.password);
    if (!token) throw new HttpError(401, 'Wrong password.');
    res.setHeader('Set-Cookie', auth.cookieHeader(token, { secure: ctx.isSecure }));
    return send(200, { ok: true });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    auth.logout(auth.sessionToken(req));
    res.setHeader('Set-Cookie', auth.cookieHeader('', { clear: true, secure: ctx.isSecure }));
    return send(200, { ok: true });
  }

  if (pathname === '/api/admin/session' && method === 'GET') {
    return send(200, { authed: auth.isAuthed(req) });
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!auth.isAuthed(req)) throw new HttpError(401, 'Please sign in.');
  }

  /* ----- admin data ----- */

  if (pathname === '/api/admin/bootstrap' && method === 'GET') {
    return send(200, {
      owners: store.listOwners({ includeInactive: true }),
      planes: store.listPlanes({ includeInactive: true }),
      settings: publicSettings(),
    });
  }

  if (pathname === '/api/admin/reservations' && method === 'GET') {
    const reservations = store.listReservations({
      planeId: num(query.get('planeId')),
      ownerId: num(query.get('ownerId')),
      from: num(query.get('from')),
      to: num(query.get('to')),
      paid: paidFilter(query.get('paid')),
    });
    return send(200, reservations);
  }

  if (pathname === '/api/admin/reservations' && method === 'POST') {
    const reservation = store.createReservation(
      {
        planeId: body.planeId,
        start: body.start,
        end: body.end,
        renterName: body.renterName,
        renterPhone: body.renterPhone,
        renterEmail: body.renterEmail,
        notes: body.notes,
        adminNotes: body.adminNotes,
        paid: body.paid,
        paidAmount: body.paidAmount,
        kind: body.kind,
      },
      { asAdmin: true }
    );
    if (body.hobbsTime !== undefined && body.hobbsTime !== null && body.hobbsTime !== '') {
      return send(201, store.updateReservation(reservation.id, { hobbsTime: body.hobbsTime }));
    }
    return send(201, reservation);
  }

  const takeBackMatch = pathname.match(/^\/api\/admin\/reservations\/(\d+)\/take-back$/);
  if (takeBackMatch && method === 'POST') {
    return send(200, store.takeBackTime(Number(takeBackMatch[1]), { notes: body.notes }));
  }

  const adminResMatch = pathname.match(/^\/api\/admin\/reservations\/(\d+)$/);
  if (adminResMatch && method === 'PATCH') {
    return send(200, store.updateReservation(Number(adminResMatch[1]), body));
  }
  if (adminResMatch && method === 'DELETE') {
    return send(200, store.deleteReservation(Number(adminResMatch[1])));
  }

  if (pathname === '/api/admin/owners' && method === 'POST') {
    return send(201, store.createOwner(body));
  }
  const adminOwnerMatch = pathname.match(/^\/api\/admin\/owners\/(\d+)$/);
  if (adminOwnerMatch && method === 'PATCH') {
    return send(200, store.updateOwner(Number(adminOwnerMatch[1]), body));
  }
  if (adminOwnerMatch && method === 'DELETE') {
    return send(200, store.deleteOwner(Number(adminOwnerMatch[1])));
  }

  if (pathname === '/api/admin/planes' && method === 'POST') {
    return send(201, store.createPlane(body));
  }
  const adminPlaneMatch = pathname.match(/^\/api\/admin\/planes\/(\d+)$/);
  if (adminPlaneMatch && method === 'PATCH') {
    return send(200, store.updatePlane(Number(adminPlaneMatch[1]), body));
  }
  if (adminPlaneMatch && method === 'DELETE') {
    return send(200, store.deletePlane(Number(adminPlaneMatch[1])));
  }

  if (pathname === '/api/admin/settings' && method === 'GET') {
    return send(200, allSettings());
  }
  if (pathname === '/api/admin/settings' && method === 'PATCH') {
    const allowed = Object.keys(DEFAULT_SETTINGS);
    for (const [key, value] of Object.entries(body || {})) {
      if (!allowed.includes(key)) continue;
      setSetting(key, value);
    }
    return send(200, allSettings());
  }

  if (pathname === '/api/admin/password' && method === 'POST') {
    const result = auth.changePassword(body.currentPassword, body.newPassword);
    if (!result.ok) throw new HttpError(400, result.error);
    res.setHeader('Set-Cookie', auth.cookieHeader('', { clear: true, secure: ctx.isSecure }));
    return send(200, { ok: true });
  }

  if (pathname === '/api/admin/export.csv' && method === 'GET') {
    const reservations = store.listReservations({
      planeId: num(query.get('planeId')),
      ownerId: num(query.get('ownerId')),
      from: num(query.get('from')),
      to: num(query.get('to')),
      paid: paidFilter(query.get('paid')),
    });
    const timeZone = getSetting('timezone', 'America/Chicago');
    const csv = buildCsv(reservations, timeZone);
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="planesforfriends-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.end(csv);
    return undefined;
  }

  throw new HttpError(404, 'Unknown endpoint.');
}

module.exports = { handleApi, instructionsFor, buildCsv, formatInZone };
