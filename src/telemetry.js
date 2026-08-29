// Anonymous usage counter + optional email signup. Built-ins only, no dependencies.
//
// Two things live here, and they are very different:
//   ping(event)        anonymous, opt-out, fire-and-forget. A random id + OS/version.
//   subscribe(email)   an explicit, user-typed signup. Sends the email the user chose
//                      to give. Never automatic, never affected by the opt-out flag.
//
// Both are INERT until SERVER_STUDIO_ANALYTICS_URL points at your Worker origin, e.g.
//   SERVER_STUDIO_ANALYTICS_URL=https://server-studio-analytics.you.workers.dev
// The code appends /collect and /subscribe itself.
'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const BASE = (process.env.SERVER_STUDIO_ANALYTICS_URL || '').replace(/\/+$/, '');

// Signups go to the site's own subscriber list, not to the counter. They are two
// separate things: one is an anonymous tally, this is a person asking to be emailed.
// Overridable so a fork points somewhere else instead of at this list.
const SUBSCRIBE_URL = process.env.SERVER_STUDIO_SUBSCRIBE_URL || 'https://www.mahdicreates.com/api/subscribe';

function optedOut() {
  if (process.env.SERVER_STUDIO_NO_TELEMETRY) return true;
  const dnt = String(process.env.DO_NOT_TRACK || '').toLowerCase();
  return dnt === '1' || dnt === 'true';
}

function appVersion() {
  try { return require('../package.json').version; } catch (e) { return '0.0.0'; }
}

function dataDir() {
  try { return require('./platform').dataDir(); }
  catch (e) {
    const os = require('os');
    if (process.env.SERVER_STUDIO_DATA_DIR) return process.env.SERVER_STUDIO_DATA_DIR;
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Server Studio');
    if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Server Studio');
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'server-studio');
  }
}

// { id, fresh }. `fresh` is true the first time an id is minted.
function installId() {
  const dir = dataDir();
  const file = path.join(dir, 'analytics-id');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return { id: existing, fresh: false };
  } catch (e) { /* not created yet */ }
  const id = crypto.randomUUID();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, id + '\n');
    return { id, fresh: true };
  } catch (e) {
    return { id, fresh: false }; // read-only home: still count, just cannot dedupe
  }
}

function notice() {
  let link = '';
  try { link = (require('../package.json').homepage || '').split('#')[0]; } catch (e) {}
  console.error(
    'Server Studio sends one anonymous ping (a random id + your OS and version, no\n' +
    'personal data) so installs can be counted. Turn it off any time with\n' +
    '  SERVER_STUDIO_NO_TELEMETRY=1' + (link ? '   ·  ' + link + '#telemetry' : '')
  );
}

// Low-level POST. Resolves { ok } and never rejects.
function post(pathname, obj, timeout, keepAlive) {
  return new Promise(resolve => {
    try {
      if (!BASE) return resolve({ ok: false });
      const payload = JSON.stringify(obj);
      const u = new URL(BASE + pathname);
      const client = u.protocol === 'http:' ? require('http') : require('https');
      const req = client.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: timeout || 1500,
      }, res => {
        res.resume(); // drain
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 });
      });
      req.on('error', () => resolve({ ok: false }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
      // Never keep the process alive for a ping. On a network that cannot reach the
      // endpoint this is the difference between exiting now and waiting out the
      // timeout. A ping that would not have arrived is not worth a second of anyone's
      // install. Subscribe passes keepAlive because a person is waiting on the answer.
      //
      // The socket has to be unref'd as well as the request. On Node 18 unref'ing the
      // request before a socket exists does not propagate, and the process sat there
      // for seconds on a blocked network.
      if (!keepAlive) {
        req.on('socket', sock => { if (sock && typeof sock.unref === 'function') sock.unref(); });
        if (typeof req.unref === 'function') req.unref();
      }
      req.end(payload);
    } catch (e) { resolve({ ok: false }); }
  });
}

// POST to an absolute URL and hand back the parsed body. Never rejects.
function postTo(absUrl, obj, timeout) {
  return new Promise(resolve => {
    try {
      const payload = JSON.stringify(obj);
      const u = new URL(absUrl);
      const client = u.protocol === 'http:' ? require('http') : require('https');
      const req = client.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + (u.search || ''),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: timeout || 6000,
      }, res => {
        let d = '';
        res.on('data', c => { d += c; if (d.length > 1e5) res.destroy(); });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(d || '{}'); } catch (e) { parsed = null; }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, json: parsed });
        });
      });
      req.on('error', () => resolve({ ok: false, json: null }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, json: null }); });
      req.end(payload);
    } catch (e) { resolve({ ok: false, json: null }); }
  });
}

// Anonymous, fire-and-forget.
function ping(event) {
  try {
    if (!BASE || optedOut() || process.env.CI) return;
    const { id, fresh } = installId();
    if (fresh) { try { notice(); } catch (e) {} }
    post('/collect', {
      event: String(event || 'ping'),
      id,
      v: appVersion(),
      os: process.platform,
      arch: process.arch,
      node: process.versions.node.split('.')[0],
    }, 1500);
  } catch (e) { /* best-effort, always */ }
}

// Explicit signup. Returns a Promise<boolean> so the UI can confirm.
async function subscribe(email, message) {
  try {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 254) return false;
    if (!SUBSCRIBE_URL) return false;
    const body = { email: e };
    const m = String(message || '').trim().slice(0, 2000);
    if (m) body.message = m;
    // Deliberately not gated on the telemetry opt-out: typing an address and pressing
    // send is an explicit request, not tracking, and refusing it would be wrong.
    const r = await postTo(SUBSCRIBE_URL, body, 6000);
    return !!(r && r.ok && r.json && r.json.success);
  } catch (e) { return false; }
}

module.exports = { ping, subscribe, enabled: !!BASE, subscribeEnabled: !!SUBSCRIBE_URL };
