'use strict';

/* Email notifications: when anything happens to an owner's plane, the people
 * that owner listed get told, and the renter hears about their own booking.
 *
 * Sending goes through a provider's plain HTTPS API rather than SMTP, so this
 * stays dependency-free. The key never lives in the database or the repo. It
 * comes from the environment, set on the server by deploy/set-email-key.sh:
 *
 *   PFF_MAIL_PROVIDER=brevo        (brevo | resend | console)
 *   PFF_MAIL_KEY=xkeysib-...
 *
 * With no key set, every call here is a no-op: the site works exactly as it did
 * before, and bookings never fail because an email could not go out.
 *
 * Every message is written once as a list of blocks and rendered twice, as HTML
 * and as plain text, by mailbody.js.
 */

const { getSetting } = require('./db');
const store = require('./store');
const { instructionsFor, contactLine } = require('./instructions');
const { renderText, renderHtml } = require('./mailbody');

const SEND_TIMEOUT_MS = 10000;

/* ---------- providers ---------- */

const PROVIDERS = {
  /* Brevo verifies a single sender address by emailing you a link, so it works
     without owning a domain, which matters on a duckdns.org hostname. */
  brevo: {
    label: 'Brevo',
    url: 'https://api.brevo.com/v3/smtp/email',
    request: (key, msg) => ({
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: {
        sender: { email: msg.fromEmail, name: msg.fromName },
        to: [{ email: msg.to }],
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
      },
    }),
  },
  /* Resend needs a verified domain to reach anybody but your own address, so it
     is the right pick only once there is a real domain. */
  resend: {
    label: 'Resend',
    url: 'https://api.resend.com/emails',
    request: (key, msg) => ({
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: {
        from: `${msg.fromName} <${msg.fromEmail}>`,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      },
    }),
  },
};

function mailConfig() {
  const name = String(process.env.PFF_MAIL_PROVIDER || 'brevo').toLowerCase();
  const key = process.env.PFF_MAIL_KEY || '';
  const fromEmail = getSetting('notify_from_email', '');
  const fromName = getSetting('notify_from_name', 'Planes for Rent') || 'Planes for Rent';
  const provider = PROVIDERS[name] || null;
  return {
    provider,
    providerName: name,
    key,
    fromEmail,
    fromName,
    // "console" is for development: messages are printed, not sent.
    ready: name === 'console' ? !!fromEmail : !!(provider && key && fromEmail),
  };
}

/** What the admin console shows about email setup, with no secrets in it. */
function mailStatus() {
  const cfg = mailConfig();
  return {
    ready: cfg.ready,
    provider: cfg.provider ? cfg.provider.label : cfg.providerName,
    hasKey: cfg.providerName === 'console' || !!cfg.key,
    fromEmail: cfg.fromEmail,
    fromName: cfg.fromName,
  };
}

async function sendOne(cfg, msg) {
  if (cfg.providerName === 'console') {
    console.log(`[planesforfriends] email to ${msg.to}: ${msg.subject}\n${msg.text}\n`);
    return;
  }
  const { headers, body } = cfg.provider.request(cfg.key, msg);
  const res = await fetch(cfg.provider.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`${cfg.provider.label} refused the message (${res.status}): ${detail}`);
  }
}

/**
 * Sends to each address separately so the recipients never see each other's,
 * and never throws: a notification problem must not take a booking down with
 * it. Returns what happened, for the "send a test" button.
 */
async function sendTo(addresses, subject, blocks) {
  const cfg = mailConfig();
  if (!cfg.ready) return { sent: 0, skipped: addresses.length, error: 'Email is not set up yet.' };
  const siteTitle = getSetting('site_title', 'Planes for Rent');
  const text = renderText(blocks);
  const html = renderHtml(blocks, { title: subject, siteTitle });
  let sent = 0;
  let error = null;
  for (const to of addresses) {
    try {
      await sendOne(cfg, { to, subject, text, html, fromEmail: cfg.fromEmail, fromName: cfg.fromName });
      sent += 1;
    } catch (err) {
      error = err.message;
      console.error(`[planesforfriends] could not email ${to}: ${err.message}`);
    }
  }
  return { sent, skipped: addresses.length - sent, error };
}

/* ---------- the facts every message is built from ---------- */

function formatWhen(reservation) {
  const timeZone = getSetting('timezone', 'America/Chicago');
  const full = (ts) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ts));
  const clock = (ts) =>
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
  const day = (ts) =>
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).format(
      new Date(ts)
    );
  const hours = (reservation.end - reservation.start) / 3600000;
  // A booking that starts and ends the same day says the date once.
  const span =
    day(reservation.start) === day(reservation.end)
      ? `${full(reservation.start)} to ${clock(reservation.end)}`
      : `${full(reservation.start)} to ${full(reservation.end)}`;
  return `${span} (${hours.toFixed(1)} hr)`;
}

const money = (v) => (v == null ? 'none recorded' : `$${Number(v).toFixed(2)}`);

/** "Sat, Nov 21" is enough to recognise the booking in a subject line. */
function shortDay(ts) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: getSetting('timezone', 'America/Chicago'),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(ts));
}

function planeLabel(r) {
  return [r.planeTail, r.planeModel].filter(Boolean).join(' · ');
}

/* ---------- the owner's blocks ---------- */

function ownerBlocks(reservation, opening, origin, extraNote = null) {
  const block = reservation.kind === 'block';
  const blocks = [{ p: opening }];
  if (extraNote) blocks.push({ note: extraNote });

  const facts = [
    ['Plane', `${planeLabel(reservation)} (${reservation.ownerName})`],
    [block ? 'Blocked' : 'When', formatWhen(reservation)],
    ['Confirmation', reservation.confirmationId],
  ];

  if (!block) {
    facts.push('gap', ['Renter', reservation.renterName || 'not given']);
    if (reservation.renterPhone) facts.push(['Phone', reservation.renterPhone]);
    if (reservation.renterEmail) facts.push(['Email', reservation.renterEmail]);
    if (reservation.notes) facts.push(['Their note', reservation.notes]);

    facts.push('gap', ['Hobbs', reservation.hobbsTime == null ? 'not logged yet' : String(reservation.hobbsTime)]);
    facts.push(['Paid', reservation.paid ? `yes, ${money(reservation.paidAmount)}` : 'no']);
    if (reservation.adminNotes) facts.push(['Owner note', reservation.adminNotes]);
  }
  blocks.push({ facts });

  // The reminder names only what is outstanding, so it stops asking for a
  // Hobbs reading that has already come in.
  if (!block && reservation.status === 'confirmed') {
    const missing = [];
    if (reservation.hobbsTime == null) missing.push('the Hobbs time');
    if (!reservation.paid) missing.push('the payment');
    if (missing.length === 2) blocks.push({ note: 'Once the flight is done, record the Hobbs time and the payment.' });
    else if (missing.length === 1) blocks.push({ note: `Still to record: ${missing[0]}.` });
  }

  if (origin) blocks.push({ action: { label: 'Open the admin page', url: `${origin}/admin` } });
  blocks.push({ fine: `You are on the notify list for ${reservation.ownerName}'s planes.` });
  return blocks;
}

/** Plain-English list of what an edit actually changed. */
function describeChange(before, after) {
  const changes = [];
  if (before.planeId !== after.planeId) changes.push(`Moved to ${planeLabel(after)}`);
  if (before.start !== after.start || before.end !== after.end) {
    changes.push(`Time changed to ${formatWhen(after)}`);
  }
  if (before.status !== after.status) changes.push(`Status is now ${after.status}`);
  if (before.kind !== after.kind) changes.push(`Now ${after.kind === 'block' ? 'blocked-off time' : 'a rental'}`);
  if (before.renterName !== after.renterName) changes.push(`Renter name changed to ${after.renterName || 'blank'}`);
  if (before.renterPhone !== after.renterPhone) changes.push(`Phone changed to ${after.renterPhone || 'blank'}`);
  if (before.renterEmail !== after.renterEmail) changes.push(`Email changed to ${after.renterEmail || 'blank'}`);
  if (before.hobbsTime !== after.hobbsTime) {
    changes.push(after.hobbsTime == null ? 'Hobbs time cleared' : `Hobbs time set to ${after.hobbsTime}`);
  }
  if (before.paid !== after.paid) changes.push(after.paid ? 'Marked paid' : 'Marked unpaid');
  if (before.paidAmount !== after.paidAmount) changes.push(`Amount recorded: ${money(after.paidAmount)}`);
  if (before.adminNotes !== after.adminNotes) changes.push('Owner note changed');
  if (before.notes !== after.notes) changes.push('Renter note changed');
  return changes;
}

/* ---------- the events themselves ---------- */

function recipientsFor(ownerIds) {
  const out = [];
  for (const id of new Set(ownerIds.filter((v) => v != null))) {
    const owner = store.getOwner(id);
    if (!owner) continue;
    for (const address of owner.notifyEmails) if (!out.includes(address)) out.push(address);
  }
  return out;
}

/**
 * Fire-and-forget: the caller does not wait, and a failure is logged rather
 * than thrown. Nothing a renter does should break because of an email.
 */
function queue(ownerIds, subject, blocks) {
  const addresses = recipientsFor(ownerIds);
  if (!addresses.length) return;
  if (!mailConfig().ready) return;
  sendTo(addresses, subject, blocks).catch((err) =>
    console.error('[planesforfriends] notification failed:', err.message)
  );
}

const subjectFor = (r, what) => `${r.planeTail} · ${what}`;

function reservationCreated(reservation, { origin = '', byAdmin = false } = {}) {
  const who = reservation.renterName || 'Someone';
  const opening =
    reservation.kind === 'block'
      ? `${reservation.planeTail} has been blocked off.`
      : byAdmin
        ? `A booking for ${reservation.planeTail} was entered in the admin console.`
        : `${who} booked ${reservation.planeTail} on the website.`;
  queue(
    [reservation.ownerId],
    subjectFor(reservation, reservation.kind === 'block' ? 'time blocked off' : 'new booking'),
    ownerBlocks(reservation, opening, origin)
  );
}

function reservationChanged(before, after, { origin = '' } = {}) {
  const changes = describeChange(before, after);
  if (!changes.length) return;
  const cancelled = before.status === 'confirmed' && after.status === 'cancelled';
  const blocks = ownerBlocks(after, `A booking for ${after.planeTail} was changed.`, origin);
  blocks.splice(1, 0, { bullets: changes });
  queue(
    [before.ownerId, after.ownerId],
    subjectFor(after, cancelled ? 'reservation cancelled' : 'reservation changed'),
    blocks
  );
}

function reservationDeleted(reservation, { origin = '' } = {}) {
  queue(
    [reservation.ownerId],
    subjectFor(reservation, 'reservation deleted'),
    ownerBlocks(reservation, `${reservation.confirmationId} was deleted from the schedule.`, origin)
  );
}

function timeTakenBack(cancelled, block, { origin = '' } = {}) {
  queue(
    [cancelled.ownerId],
    subjectFor(cancelled, 'time taken back'),
    ownerBlocks(
      cancelled,
      `${cancelled.renterName || 'A renter'} was cancelled and the time is now blocked off.`,
      origin,
      'They have been emailed, but somebody should call them as well.'
    )
  );
}

function hobbsLogged(reservation, { origin = '' } = {}) {
  queue(
    [reservation.ownerId],
    subjectFor(reservation, `Hobbs time ${reservation.hobbsTime}`),
    ownerBlocks(
      reservation,
      `${reservation.renterName || 'A renter'} logged a Hobbs time of ${reservation.hobbsTime}.`,
      origin
    )
  );
}

/* ---------- the renter's own emails ---------- */

/**
 * Everything here is built from renter-safe fields only. What the owners keep
 * to themselves, such as owner notes and whether a booking is paid, never
 * appears, the same rule the renter API shape follows.
 */
function renterMailOn() {
  return getSetting('notify_renters', 'on') !== 'off';
}

function canEmailRenter(reservation) {
  return (
    renterMailOn() &&
    reservation &&
    reservation.kind === 'rental' &&
    !!reservation.renterEmail &&
    mailConfig().ready
  );
}

function queueRenter(reservation, subject, blocks) {
  if (!canEmailRenter(reservation)) return;
  const all = [...blocks, { fine: 'Sent by the booking site. You cannot reply to this message.' }];
  sendTo([reservation.renterEmail], subject, all).catch((err) =>
    console.error('[planesforfriends] renter email failed:', err.message)
  );
}

const lookupLink = (reservation, origin) =>
  origin ? `${origin}/lookup?id=${reservation.confirmationId}` : '';

function renterConfirmation(reservation, { origin = '' } = {}) {
  const link = lookupLink(reservation, origin);
  const firstName = reservation.renterName ? reservation.renterName.split(' ')[0] : '';
  queueRenter(reservation, `Your booking is confirmed: ${reservation.planeTail}, ${shortDay(reservation.start)}`, [
    { p: `Your plane is booked${firstName ? `, ${firstName}` : ''}.` },
    {
      facts: [
        ['Plane', planeLabel(reservation)],
        ['When', formatWhen(reservation)],
        ['Confirmation', reservation.confirmationId],
      ],
    },
    { steps: { title: 'Before you fly', items: instructionsFor(reservation) } },
    {
      steps: {
        title: 'After you fly',
        items: ['Enter the Hobbs reading on the site.', 'Pay by the end of the day.'],
      },
    },
    ...(link ? [{ action: { label: 'Open my reservation', url: link } }] : []),
  ]);
}

function renterChangedNotice(before, after, { origin = '' } = {}) {
  const movedPlane = before.planeId !== after.planeId;
  const movedTime = before.start !== after.start || before.end !== after.end;
  if (!movedPlane && !movedTime) return;
  const what =
    movedPlane && movedTime ? 'a different plane and time' : movedPlane ? 'a different plane' : 'a different time';
  const link = lookupLink(after, origin);
  queueRenter(after, `Your booking changed: ${after.planeTail}, ${shortDay(after.start)}`, [
    { p: `Your booking has moved to ${what}.` },
    {
      facts: [
        ['Plane', planeLabel(after)],
        ['When', formatWhen(after)],
        ['Confirmation', after.confirmationId],
      ],
    },
    { note: `If that does not work for you, contact ${contactLine(after)}.` },
    ...(link ? [{ action: { label: 'Open my reservation', url: link } }] : []),
  ]);
}

function renterCancelledNotice(reservation, { origin = '', takenBack = false } = {}) {
  queueRenter(reservation, `Your booking was cancelled: ${reservation.planeTail}, ${shortDay(reservation.start)}`, [
    { p: 'Your booking has been cancelled.' },
    {
      facts: [
        ['Plane', planeLabel(reservation)],
        ['Was', formatWhen(reservation)],
        ['Confirmation', reservation.confirmationId],
      ],
    },
    {
      note: takenBack
        ? `The owner needs the plane during that time. Please contact ${contactLine(reservation)}.`
        : `If you have any questions, contact ${contactLine(reservation)}.`,
    },
    { p: 'You can book another time on the site whenever you like.' },
  ]);
}

async function sendTest(owner, origin) {
  if (!owner.notifyEmails.length) {
    return { sent: 0, skipped: 0, error: `Nobody is on ${owner.name}'s notify list yet.` };
  }
  const site = getSetting('site_title', 'Planes for Rent');
  return sendTo(owner.notifyEmails, `Test message from ${site}`, [
    { p: `This is a test from ${site}.` },
    {
      p:
        `You are on the list to be told whenever anything happens to ${owner.name}'s planes: ` +
        'new bookings, changes, cancellations, Hobbs times and payments.',
    },
    { note: 'Nothing is wrong. Somebody just pressed the test button.' },
    ...(origin ? [{ action: { label: 'Open the admin page', url: `${origin}/admin` } }] : []),
  ]);
}

module.exports = {
  mailStatus,
  sendTest,
  describeChange,
  reservationCreated,
  reservationChanged,
  reservationDeleted,
  timeTakenBack,
  hobbsLogged,
  renterConfirmation,
  renterChangedNotice,
  renterCancelledNotice,
};
