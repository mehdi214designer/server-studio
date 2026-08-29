#!/usr/bin/env node
// Server Studio - tiny local backend (Node built-ins only, no npm install needed)
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const plat = require('./platform');
const setport = require('./setport');
const telemetry = require('./telemetry');

const PORT = process.env.PORT || 4587;
const RES = __dirname;
const DATA_DIR = plat.dataDir();
const DATA_FILE = path.join(DATA_DIR, 'data.json');
// Folders are stored separately. data.json stays a plain array so the published
// register-server.js, which reads and writes that array, keeps working untouched.
const FOLDERS_FILE = path.join(DATA_DIR, 'folders.json');

/* ---------- storage ---------- */
function ensureStore() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
}
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || []; }
  catch (e) { return []; }
}
function writeData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}
function readFolders() {
  try { const f = JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8')); return Array.isArray(f) ? f : []; }
  catch (e) { return []; }
}
function writeFolders(f) {
  fs.writeFileSync(FOLDERS_FILE, JSON.stringify(f, null, 2));
}

/* ---------- helpers ---------- */
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}
function body(req) {
  return new Promise(resolve => {
    // Only real JSON requests are accepted. A cross-site HTML form can only send
    // text/plain, multipart or urlencoded, so refusing those blocks form-based CSRF.
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return resolve(null);
    let b = '';
    req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve(null); } });
  });
}

// A browser attaches Origin to any cross-site request. Same-origin GETs and the
// app's own fetches either omit it or send our own origin, so anything else is foreign.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const okHost = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return okHost && u.port === String(PORT);
  } catch (e) { return false; }
}
function checkPort(port) {
  return new Promise(resolve => {
    if (!port) return resolve(false);
    const s = net.connect({ host: '127.0.0.1', port: Number(port) });
    let done = false;
    const fin = v => { if (done) return; done = true; try { s.destroy(); } catch (e) {} resolve(v); };
    s.on('connect', () => fin(true));
    s.on('error', () => fin(false));
    s.setTimeout(800, () => fin(false));
  });
}

function portFromUrl(url) {
  const m = String(url || '').match(/:(\d{2,5})\b/);
  return m ? Number(m[1]) : null;
}

/* ---------- version check ---------- */
function appVersion() {
  try { return require('../package.json').version || '0.0.0'; } catch (e) { return '0.0.0'; }
}
function isNewer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}
function latestVersion() {
  return new Promise((resolve, reject) => {
    const req = require('https').get({
      host: 'registry.npmjs.org',
      path: '/server-studio/latest',
      headers: { 'User-Agent': 'server-studio' },
      timeout: 2500,
    }, r => {
      if (r.statusCode !== 200) { r.resume(); return resolve(null); }
      let d = '';
      r.on('data', c => { d += c; if (d.length > 2e5) r.destroy(); });
      r.on('end', () => { try { resolve(JSON.parse(d).version || null); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/* ---------- routes ---------- */
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (!sameOrigin(req)) return send(res, 403, { error: 'cross-origin request blocked' });
  // No CORS headers are ever sent, so a preflight must not succeed.
  if (req.method === 'OPTIONS') return send(res, 405, { error: 'method not allowed' });

  // static
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    return fs.readFile(path.join(RES, 'index.html'), (e, buf) => {
      if (e) { res.writeHead(500); return res.end('index.html missing'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
  }

  if (req.method === 'GET' && url === '/api/servers') {
    return send(res, 200, readData());
  }

  if (req.method === 'POST' && url === '/api/servers') {
    const data = await body(req);
    if (!Array.isArray(data)) return send(res, 400, { error: 'expected a JSON array' });
    writeData(data);
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/api/run') {
    const b = await body(req);
    if (!b) return send(res, 415, { error: 'expected application/json' });
    const { cwd, command } = b;
    if (!command) return send(res, 400, { error: 'no command' });
    return plat.runInTerminal(cwd, command, (err) => {
      if (err) return send(res, 500, { error: String(err) });
      send(res, 200, { ok: true });
    });
  }

  if (req.method === 'POST' && url === '/api/open') {
    const b = await body(req);
    if (!b) return send(res, 415, { error: 'expected application/json' });
    const { target } = b;
    if (!target) return send(res, 400, { error: 'no target' });
    return plat.openExternal(target, (err) => {
      if (err) return send(res, 500, { error: String(err) });
      send(res, 200, { ok: true });
    });
  }

  if (req.method === 'POST' && url === '/api/reveal') {
    const b = await body(req);
    if (!b) return send(res, 415, { error: 'expected application/json' });
    const { path: p } = b;
    if (!p) return send(res, 400, { error: 'no path' });
    return plat.revealFolder(p, (err) => {
      if (err) return send(res, 500, { error: String(err) });
      send(res, 200, { ok: true });
    });
  }

  if (req.method === 'POST' && url === '/api/stop') {
    const b = await body(req);
    if (!b) return send(res, 415, { error: 'expected application/json' });
    const { port } = b;
    if (!port) return send(res, 400, { error: 'no port' });
    return plat.killPort(port, () => {
      send(res, 200, { ok: true });
    });
  }

  if (req.method === 'POST' && url === '/api/pickfolder') {
    return plat.pickFolder((err, picked) => {
      if (err || !picked) return send(res, 200, { cancelled: true });
      send(res, 200, { path: picked });
    });
  }

  // Optional email signup. The browser posts here (same-origin), and we forward the
  // user's chosen email to the remote counter. Inert if no analytics URL is set.
  if (req.method === 'POST' && url === '/api/subscribe') {
    const b = await body(req);
    if (!b) return send(res, 415, { error: 'expected application/json' });
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
      return send(res, 400, { error: 'invalid email' });
    }
    // The message is optional. It is what turns this from a mailing list into a
    // place to ask for things, so it is passed through rather than dropped.
    const message = String(b.message || '').trim().slice(0, 2000);
    if (!telemetry.subscribeEnabled) return send(res, 200, { ok: false, disabled: true });
    const r = await telemetry.subscribe(email, message);
    return send(res, r ? 200 : 502, { ok: r });
  }

  if (req.method === 'GET' && url === '/api/subscribe') {
    // Tied to the signup endpoint, not the counter. The box should work even for
    // someone who has turned telemetry off entirely.
    return send(res, 200, { enabled: telemetry.subscribeEnabled });
  }

  // Version check against the public npm registry. No auth, no dependency, and it
  // fails quietly so a blocked network just means no banner.
  if (req.method === 'GET' && url === '/api/update') {
    const current = appVersion();
    return latestVersion().then(latest => {
      send(res, 200, { current, latest, newer: !!(latest && isNewer(latest, current)) });
    }).catch(() => send(res, 200, { current, latest: null, newer: false }));
  }

  if (req.method === 'GET' && url === '/api/folders') {
    return send(res, 200, readFolders());
  }

  if (req.method === 'POST' && url === '/api/folders') {
    const data = await body(req);
    if (!Array.isArray(data)) return send(res, 400, { error: 'expected a JSON array' });
    writeFolders(data);
    return send(res, 200, { ok: true });
  }

  // Writes a fixed port into a project's package.json dev script. Pass apply:false to
  // get the exact before/after first, so the user approves a real diff, not a promise.
  if (req.method === 'POST' && url === '/api/setport') {
    const b = await body(req);
    if (!b) return send(res, 415, { error: 'expected application/json' });
    const port = Number(b.port);
    if (!port || port < 1 || port > 65535) return send(res, 400, { error: 'bad port' });
    const r = b.apply ? setport.apply(String(b.cwd || ''), port) : setport.plan(String(b.cwd || ''), port);
    return send(res, 200, { ok: !!r.ok, reason: r.reason || null, file: r.file || null,
      key: r.key || null, before: r.before || null, after: r.after || null,
      how: r.how || null, backup: r.backup || null });
  }

  if (req.method === 'GET' && url === '/api/platform') {
    return send(res, 200, { platform: process.platform, terminalName: plat.terminalName(), pathExample: plat.pathExample() });
  }

  if (req.method === 'GET' && url === '/api/status') {
    const data = readData();
    const out = {};
    await Promise.all(data.map(async s => {
      const port = s.port || portFromUrl(s.url);
      out[s.id] = port ? await checkPort(port) : false;
    }));
    return send(res, 200, out);
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"error":"not found"}');
});

/* ---------- boot ---------- */
ensureStore();
server.listen(PORT, '127.0.0.1', () => {
  console.log('Server Studio running on http://localhost:' + PORT);
  telemetry.ping('start'); // one anonymous count per real launch (app or CLI)
  plat.openExternal('http://localhost:' + PORT + '/', () => {});
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // already running -> just open the window
    plat.openExternal('http://localhost:' + PORT + '/', () => {});
    setTimeout(() => process.exit(0), 500);
  } else {
    console.error(e);
    process.exit(1);
  }
});
