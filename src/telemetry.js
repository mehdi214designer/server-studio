// The email signup / "ask" box. Built-ins only, no dependencies.
//
// This file used to also hold an anonymous install counter. It was never switched on:
// the endpoint came from an env var with no default, so no build ever sent a ping, and
// the Cloudflare Worker meant to receive them was never deployed. It is gone rather
// than left dormant. Server Studio now makes exactly one outbound request, and only
// when someone types a message and presses send.
//
//   subscribe(email, message)   explicit, user-typed. Never automatic.
'use strict';

// Overridable so a fork points at its own list instead of this one.
const SUBSCRIBE_URL = process.env.SERVER_STUDIO_SUBSCRIBE_URL || 'https://www.mahdicreates.com/api/subscribe';

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
      // Deliberately not unref'd: a person pressed send and is waiting on the answer.
      req.end(payload);
    } catch (e) { resolve({ ok: false, json: null }); }
  });
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
    // 6s was not enough. The endpoint fans out to WordPress, FluentCRM and an SMTP
    // relay, and a cold function walked past it, so a first-time sender saw a silent
    // failure on the one attempt they were ever going to make. Warm it answers in
    // about 2s. A person is watching a spinner, so waiting is better than lying.
    const r = await postTo(SUBSCRIBE_URL, body, 15000);
    return !!(r && r.ok && r.json && r.json.success);
  } catch (e) { return false; }
}

module.exports = { subscribe, subscribeEnabled: !!SUBSCRIBE_URL };
