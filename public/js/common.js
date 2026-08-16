/* Shared helpers for every page. */

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------- DOM ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function showMessage(container, text, kind = 'error') {
  if (!container) return;
  if (!text) {
    container.className = 'hidden';
    container.textContent = '';
    return;
  }
  container.className = `msg msg-${kind}`;
  container.textContent = text;
}

/* ---------- phone and email boxes tidy themselves ---------- */

/* Delegated from the document so this covers every phone and email field on
   the site at once — the booking form, the admin forms, and the ones the
   modals build on the fly — with nothing to remember to wire up. The rules
   themselves live in format.js, which the server uses too. */

function reformatPhoneField(input) {
  const before = input.value;
  const next = formatPhone(before);
  if (next === before) return;
  // Keep the caret where the person is actually typing: count the digits ahead
  // of it, then find that spot again in the reformatted text.
  const caret = input.selectionStart == null ? before.length : input.selectionStart;
  const digitsBefore = before.slice(0, caret).replace(/\D/g, '').length;
  input.value = next;
  let pos = 0;
  let seen = 0;
  while (pos < next.length && seen < digitsBefore) {
    if (/\d/.test(next[pos])) seen += 1;
    pos += 1;
  }
  while (pos < next.length && !/\d/.test(next[pos])) pos += 1;
  try {
    input.setSelectionRange(pos, pos);
  } catch {
    /* some input types refuse a selection; the value is still formatted */
  }
}

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target && target.matches && target.matches('input[type="tel"]')) reformatPhoneField(target);
});

/* Email waits until the box is left: lowercasing mid-word would drag the caret
   to the end while somebody is editing the middle of an address. */
document.addEventListener('focusout', (event) => {
  const target = event.target;
  if (!target || !target.matches) return;
  if (target.matches('input[type="tel"]')) target.value = tidyPhone(target.value);
  else if (target.matches('input[type="email"]')) target.value = tidyEmail(target.value);
});

const fmtMoney = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

/* ---------- dates (all in the browser's local time) ---------- */

const fmtDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtDateLong = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtDateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ts) {
  const d = new Date(startOfDay(ts));
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

function isSameDay(a, b) {
  return startOfDay(a) === startOfDay(b);
}

function formatRange(start, end) {
  if (isSameDay(start, end)) {
    return `${fmtDateLong.format(new Date(start))}, ${fmtTime.format(new Date(start))} – ${fmtTime.format(new Date(end))}`;
  }
  return `${fmtDateTime.format(new Date(start))} – ${fmtDateTime.format(new Date(end))}`;
}

/** Compact form for dense tables: "Sat, Aug 15 · 4:00 – 7:00 AM". */
function formatRangeShort(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const year = startDate.getFullYear() === new Date().getFullYear() ? '' : `, ${startDate.getFullYear()}`;
  if (isSameDay(start, end)) {
    return `${fmtDate.format(startDate)}${year} · ${fmtTime.format(startDate)} – ${fmtTime.format(endDate)}`;
  }
  return `${fmtDate.format(startDate)} ${fmtTime.format(startDate)} – ${fmtDate.format(endDate)} ${fmtTime.format(endDate)}`;
}

function durationLabel(start, end) {
  const hours = (end - start) / HOUR;
  const whole = Math.floor(hours);
  const mins = Math.round((hours - whole) * 60);
  if (whole && mins) return `${whole} hr ${mins} min`;
  if (whole) return `${whole} hr`;
  return `${mins} min`;
}

/** ts -> "YYYY-MM-DDTHH:MM" for <input type="datetime-local">. */
function toLocalInput(ts) {
  if (ts == null) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ts -> "YYYY-MM-DD" for <input type="date">. */
function toDateInput(ts) {
  return toLocalInput(ts).slice(0, 10);
}

function fromLocalInput(value) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function fromDateInput(value, endOfDay = false) {
  if (!value) return null;
  const ts = new Date(`${value}T${endOfDay ? '23:59' : '00:00'}`).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/* ---------- header: current page + text size ---------- */

const TEXT_KEY = 'pff-text';

function setTextSize(size) {
  if (size === 'large') document.documentElement.dataset.text = 'large';
  else delete document.documentElement.dataset.text;
  try {
    localStorage.setItem(TEXT_KEY, size);
  } catch {
    /* private browsing — the choice just won't stick */
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const here = window.location.pathname.replace(/\/+$/, '') || '/';
  $$('.site-header nav a').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === here || (href !== '/' && here.startsWith(href))) link.setAttribute('aria-current', 'page');
  });

  const nav = $('.site-header nav');
  if (!nav) return;
  const button = el('button', {
    type: 'button',
    class: 'text-toggle',
    title: 'Switch between normal and larger text',
  });
  const paint = () => {
    const large = document.documentElement.dataset.text === 'large';
    button.textContent = large ? 'Normal text' : 'Larger text';
    button.setAttribute('aria-pressed', String(large));
  };
  button.addEventListener('click', () => {
    setTextSize(document.documentElement.dataset.text === 'large' ? 'normal' : 'large');
    paint();
  });
  paint();
  nav.append(button);
});
