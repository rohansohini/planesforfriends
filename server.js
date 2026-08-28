'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { handleApi } = require('./src/api');
const { HttpError } = require('./src/store');
const { DB_PATH, close: closeDatabase, getSetting } = require('./src/db');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendFile(res, filePath) {
  const data = await fsp.readFile(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': data.length,
    // no-cache means "ask me if it changed", not "do not store". Browsers still
    // get a cheap 304 for unchanged files, but an update shows up on the next
    // reload instead of up to five minutes later, which otherwise looks like a
    // failed deploy.
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Pages carry %SITE_TITLE% rather than a hard-coded name, filled in here. Doing
 * it in the browser meant every page flashed the old name before the script
 * swapped it — most visibly when clicking the logo.
 */
async function sendPage(res, fileName) {
  const html = await fsp.readFile(path.join(PUBLIC_DIR, fileName), 'utf8');
  const body = html.replaceAll('%SITE_TITLE%', escapeHtml(getSetting('site_title', 'Planes for Rent')));
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function safeStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const resolved = path.resolve(PUBLIC_DIR, `.${path.posix.normalize(decoded)}`);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) return null;
  return resolved;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  const send = (status, payload) => {
    const data = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(data),
      'Cache-Control': 'no-store',
    });
    res.end(data);
  };

  try {
    if (pathname.startsWith('/api/')) {
      let body = {};
      if (['POST', 'PATCH', 'PUT'].includes(method)) {
        const raw = await readBody(req);
        if (raw.length) {
          try {
            body = JSON.parse(raw.toString('utf8'));
          } catch {
            throw new HttpError(400, 'Malformed JSON body.');
          }
        }
      }
      const isSecure = req.headers['x-forwarded-proto'] === 'https';
      await handleApi(req, res, { pathname, query: url.searchParams, body, method, send, isSecure });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end('Method not allowed');
      return;
    }

    // Platform health check
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('ok');
      return;
    }

    // Page routes
    if (pathname === '/' || pathname === '/rent') {
      await sendPage(res, 'index.html');
      return;
    }
    if (/^\/rent\/[^/]+$/.test(pathname)) {
      await sendPage(res, 'rent.html');
      return;
    }
    if (pathname === '/lookup' || pathname === '/hobbs' || pathname === '/tach') {
      await sendPage(res, 'lookup.html');
      return;
    }
    if (pathname === '/admin') {
      await sendPage(res, 'admin.html');
      return;
    }

    // Static assets
    const filePath = safeStaticPath(pathname);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      await sendFile(res, filePath);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><meta charset="utf-8"><title>Not found</title>' +
        '<body style="font-family:system-ui;padding:3rem;text-align:center">' +
        '<h1>Page not found</h1><p><a href="/">Back to Planes for Friends</a></p>'
    );
  } catch (err) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[planesforfriends]', err);
    send(status, { error: status >= 500 ? 'Something went wrong on our end.' : err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[planesforfriends] listening on http://localhost:${PORT}`);
  console.log(`[planesforfriends] database: ${DB_PATH}`);
});

// Hosts stop a container by sending SIGTERM; check the write-ahead log back into
// the database file before the process goes away.
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[planesforfriends] ${signal} received, shutting down`);
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    setTimeout(() => {
      closeDatabase();
      process.exit(0);
    }, 5000).unref();
  });
}

module.exports = server;
