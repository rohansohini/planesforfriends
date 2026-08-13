'use strict';

const crypto = require('node:crypto');
const { db, getSetting, setSetting, hashPassword, verifyPassword } = require('./db');

const COOKIE_NAME = 'pff_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function purgeExpired() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

function login(password) {
  const stored = getSetting('admin_password_hash', '');
  if (!verifyPassword(password, stored)) return null;
  purgeExpired();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)').run(
    token,
    now,
    now + SESSION_TTL_MS
  );
  return token;
}

function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function isAuthed(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
  if (!row) return false;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return false;
  }
  return true;
}

function sessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || null;
}

function cookieHeader(token, { clear = false, secure = false } = {}) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) flags.push('Secure');
  if (clear) return `${COOKIE_NAME}=; ${flags.join('; ')}; Max-Age=0`;
  return `${COOKIE_NAME}=${token}; ${flags.join('; ')}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function changePassword(currentPassword, newPassword) {
  const stored = getSetting('admin_password_hash', '');
  if (!verifyPassword(currentPassword, stored)) return { ok: false, error: 'Current password is incorrect.' };
  const next = String(newPassword || '');
  if (next.length < 4) return { ok: false, error: 'Pick a password with at least 4 characters.' };
  setSetting('admin_password_hash', hashPassword(next));
  db.prepare('DELETE FROM sessions').run();
  return { ok: true };
}

module.exports = { COOKIE_NAME, login, logout, isAuthed, sessionToken, cookieHeader, changePassword, parseCookies };
