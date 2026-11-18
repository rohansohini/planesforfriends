'use strict';

/* Email notifications: when anything happens to an owner's plane, the people
 * that owner listed get told.
 *
 * Sending goes through a provider's plain HTTPS API rather than SMTP, so this
 * stays dependency-free. The key never lives in the database or the repo — it
 * comes from the environment, set on the server by deploy/set-email-key.sh:
 *
 *   PFF_MAIL_PROVIDER=brevo        (brevo | resend | console)
 *   PFF_MAIL_KEY=xkeysib-...
 *
 * With no key set, every call here is a no-op: the site works exactly as it did
 * before, and bookings never fail because an email could not go out.
 */

const { getSetting } = require('./db');
const store = require('./store');
const { instructionsFor, contactLine } = require('./instructions');

const SEND_TIMEOUT_MS = 10000;

/* ---------- providers ---------- */

const PROVIDERS = {
  /* Brevo verifies a single sender address by emailing you a link, so it works
     without owning a domain — which matters on a duckdns.org hostname. */
  brevo: {
    label: 'Brevo',
    url: 'https://api.brevo.com/v3/smtp/email',
    request: (key, msg) => ({
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: {
        sender: { email: msg.fromEmail, name: msg.fromName },
        to: [{ email: msg.to }],
        subject: msg.subject,
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
async function sendTo(addresses, subject, text) {
  const cfg = mailConfig();
  if (!cfg.ready) return { sent: 0, skipped: addresses.length, error: 'Email is not set up yet.' };
  let sent = 0;
  let error = null;
  for (const to of addresses) {
    try {
      await sendOne(cfg, { to, subject, text, fromEmail: cfg.fromEmail, fromName: cfg.fromName });
      sent += 1;
    } catch (err) {
      error = err.message;
      console.error(`[planesforfriends] could not email ${to}: ${err.message}`);
    }
  }
  return { sent, skipped: addresses.length - sent, error };
}

/* ---------- what the emails say ---------- */

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
      ? `${full(reservation.start)} – ${clock(reservation.end)}`
      : `${full(reservation.start)} – ${full(reservation.end)}`;
  return `${span} (${hours.toFixed(1)} hr)`;
}

const money = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);

/** "Sat, Nov 21" — enough to recognise the booking in a subject line. */
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

/**
 * The owner's email. The subject already says what happened, so `lines` is only
 * for things the facts below cannot show — what an edit changed, or that
 * somebody needs a phone call. Every line stands on its own rather than relying
 * on lined-up spaces, because some mail apps render plain text as HTML and
 * collapse the padding.
 */
function body(reservation, lines = []) {
  const out = [];
  if (lines.length) out.push(...lines, '');
  out.push(`Plane: ${planeLabel(reservation)} (${reservation.ownerName})`);
  out.push(`When: ${formatWhen(reservation)}`);
  if (reservation.kind === 'block') {
    out.push('Renter: none — this is time blocked off');
  } else {
    out.push(`Renter: ${reservation.renterName || '—'}`);
    if (reservation.renterPhone) out.push(`Phone: ${reservation.renterPhone}`);
    if (reservation.renterEmail) out.push(`Email: ${reservation.renterEmail}`);
  }
  out.push(`Hobbs: ${reservation.hobbsTime == null ? 'not logged yet' : reservation.hobbsTime}`);
  out.push(
    `Paid: ${reservation.paid ? 'yes' : 'no'}${reservation.paidAmount != null ? ` · ${money(reservation.paidAmount)}` : ''}`
  );
  out.push(`Confirmation: ${reservation.confirmationId}`);
  if (reservation.adminNotes) out.push(`Owner note: ${reservation.adminNotes}`);
  // Name only what is actually still outstanding, so the reminder stops asking
  // for a Hobbs reading that has already come in.
  if (reservation.kind === 'rental' && reservation.status === 'confirmed') {
    const missing = [];
    if (reservation.hobbsTime == null) missing.push('the Hobbs time');
    if (!reservation.paid) missing.push('the payment');
    if (missing.length) {
      out.push('', `Once the flight is done, put ${missing.join(' and ')} into the admin page.`);
    }
  }
  out.push('', 'You are getting this because you are on the notify list for this owner’s planes.');
  return out.join('\n');
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
  if (before.renterName !== after.renterName) changes.push(`Renter name changed to ${after.renterName || '—'}`);
  if (before.renterPhone !== after.renterPhone) changes.push(`Phone changed to ${after.renterPhone || '—'}`);
  if (before.renterEmail !== after.renterEmail) changes.push(`Email changed to ${after.renterEmail || '—'}`);
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
function queue(ownerIds, subject, text) {
  const addresses = recipientsFor(ownerIds);
  if (!addresses.length) return;
  const cfg = mailConfig();
  if (!cfg.ready) return;
  sendTo(addresses, subject, text).catch((err) =>
    console.error('[planesforfriends] notification failed:', err.message)
  );
}

const subjectFor = (r, what) => `${r.planeTail} · ${what}`;

function reservationCreated(reservation) {
  const what = reservation.kind === 'block' ? 'time blocked off' : 'new booking';
  queue([reservation.ownerId], subjectFor(reservation, what), body(reservation));
}

function reservationChanged(before, after) {
  const changes = describeChange(before, after);
  if (!changes.length) return;
  const cancelled = before.status === 'confirmed' && after.status === 'cancelled';
  queue(
    [before.ownerId, after.ownerId],
    subjectFor(after, cancelled ? 'reservation cancelled' : 'reservation changed'),
    body(after, [`${after.confirmationId} was changed:`, ...changes.map((c) => `  • ${c}`)])
  );
}

function reservationDeleted(reservation) {
  queue(
    [reservation.ownerId],
    subjectFor(reservation, 'reservation deleted'),
    body(reservation, [`${reservation.confirmationId} was deleted from the schedule.`])
  );
}

function timeTakenBack(cancelled, block) {
  queue(
    [cancelled.ownerId],
    subjectFor(cancelled, 'time taken back'),
    body(cancelled, [
      `${cancelled.renterName || 'A renter'} was cancelled and the time is now blocked off.`,
      'They have been emailed, but somebody should call them as well.',
    ])
  );
}

function hobbsLogged(reservation) {
  queue([reservation.ownerId], subjectFor(reservation, `Hobbs time ${reservation.hobbsTime}`), body(reservation));
}

/* ---------- the renter's own emails ---------- */

/**
 * Everything here is built from renter-safe fields only. What the owners keep
 * to themselves — owner notes, whether a booking is paid, how much — never
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

function renterFooter(reservation, origin) {
  const lines = ['', `Any questions: contact ${contactLine(reservation)}.`];
  if (origin) {
    lines.push(`Look your reservation up any time: ${origin}/lookup?id=${reservation.confirmationId}`);
  }
  lines.push('', 'This message was sent by the booking site. You cannot reply to it.');
  return lines;
}

function queueRenter(reservation, subject, lines, origin) {
  if (!canEmailRenter(reservation)) return;
  const text = [...lines, ...renterFooter(reservation, origin)].join('\n');
  sendTo([reservation.renterEmail], subject, text).catch((err) =>
    console.error('[planesforfriends] renter email failed:', err.message)
  );
}

function renterConfirmation(reservation, { origin = '' } = {}) {
  const site = getSetting('site_title', 'Planes for Rent');
  queueRenter(
    reservation,
    `Your booking is confirmed — ${reservation.planeTail}, ${shortDay(reservation.start)}`,
    [
      `${reservation.renterName || 'Hello'} — your plane is booked.`,
      '',
      `Confirmation number: ${reservation.confirmationId}`,
      '',
      `Plane: ${planeLabel(reservation)}`,
      `When:  ${formatWhen(reservation)}`,
      '',
      'Before you fly:',
      ...instructionsFor(reservation).map((line, i) => `  ${i + 1}. ${line}`),
      '',
      'After you fly, come back to the site with your confirmation number and',
      'enter the Hobbs reading.',
      '',
      `— ${site}`,
    ],
    origin
  );
}

function renterChangedNotice(before, after, { origin = '' } = {}) {
  const what = [];
  if (before.planeId !== after.planeId) what.push(`Plane is now ${planeLabel(after)}`);
  if (before.start !== after.start || before.end !== after.end) what.push(`Time is now ${formatWhen(after)}`);
  if (!what.length) return;
  queueRenter(
    after,
    `Your booking changed — ${after.planeTail}, ${shortDay(after.start)}`,
    [
      `${after.renterName || 'Hello'} — your reservation ${after.confirmationId} has been changed.`,
      '',
      ...what.map((line) => `  • ${line}`),
      '',
      `Plane: ${planeLabel(after)}`,
      `When:  ${formatWhen(after)}`,
      '',
      'If that does not work for you, please get in touch.',
    ],
    origin
  );
}

function renterCancelledNotice(reservation, { origin = '', takenBack = false } = {}) {
  queueRenter(
    reservation,
    `Your booking was cancelled — ${reservation.planeTail}, ${shortDay(reservation.start)}`,
    [
      `${reservation.renterName || 'Hello'} — your reservation ${reservation.confirmationId} has been cancelled.`,
      '',
      `Plane: ${planeLabel(reservation)}`,
      `Was:   ${formatWhen(reservation)}`,
      '',
      takenBack
        ? 'The owner needs the plane during that time. Somebody should be calling you as well.'
        : 'The booking is no longer on the schedule.',
      '',
      'You are welcome to book another time on the site whenever you like.',
    ],
    origin
  );
}

async function sendTest(owner, origin) {
  if (!owner.notifyEmails.length) {
    return { sent: 0, skipped: 0, error: `Nobody is on ${owner.name}'s notify list yet.` };
  }
  return sendTo(
    owner.notifyEmails,
    `Test message from ${getSetting('site_title', 'Planes for Rent')}`,
    [
      `This is a test from ${getSetting('site_title', 'Planes for Rent')}.`,
      '',
      `You are on the list to be told when anything happens to ${owner.name}'s planes:`,
      'new bookings, changes, cancellations, Hobbs times and payments.',
      '',
      'Nothing is wrong — somebody just pressed the test button.',
      origin ? `\n${origin}` : '',
    ].join('\n')
  );
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
