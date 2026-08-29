// Writes a fixed port into a project's package.json dev script, so the card and the
// project agree instead of drifting.
//
// Deliberately narrow. It only ever touches "scripts.dev" (or "scripts.start"), and only
// when the shape is recognised. It edits the raw text rather than re-serialising the JSON,
// so nothing else in the file moves. Anything unfamiliar is refused, never guessed at.
'use strict';

const fs = require('fs');
const path = require('path');

const UNSAFE = /&&|\|\||;|\|/;   // chained scripts: too easy to break, so decline

// Work out what the script should become, or why it cannot be changed.
function rewriteScript(script, port) {
  const s = String(script || '').trim();
  if (!s) return { ok: false, reason: 'there is no dev script to edit' };
  if (UNSAFE.test(s)) return { ok: false, reason: 'the dev script chains several commands' };

  // Already carries an explicit port: replace the number, do not add another flag.
  const long = s.match(/(--port[= ])(\d{2,5})/);
  if (long) return { ok: true, next: s.replace(long[0], long[1] + port), how: 'updated --port' };
  const short = s.match(/(\s-p[= ])(\d{2,5})/);
  if (short) return { ok: true, next: s.replace(short[0], short[1] + port), how: 'updated -p' };
  const envPort = s.match(/(^|\s)PORT=(\d{2,5})/);
  if (envPort) return { ok: true, next: s.replace(envPort[0], envPort[1] + 'PORT=' + port), how: 'updated PORT=' };

  // No port yet: add one the way that tool expects.
  if (/(^|\s)vite(\s|$)/.test(s))          return { ok: true, next: s + ' --port ' + port + ' --strictPort', how: 'added --port --strictPort' };
  if (/(^|\s)next\s+dev(\s|$)/.test(s))    return { ok: true, next: s + ' -p ' + port, how: 'added -p' };
  if (/(^|\s)astro\s+dev(\s|$)/.test(s))   return { ok: true, next: s + ' --port ' + port, how: 'added --port' };
  if (/react-scripts\s+start/.test(s))     return { ok: true, next: 'PORT=' + port + ' ' + s, how: 'added PORT=' };
  if (/(^|\s)nuxt\s+dev(\s|$)/.test(s))    return { ok: true, next: s + ' --port ' + port, how: 'added --port' };

  return { ok: false, reason: 'the dev script is not a framework this can safely edit' };
}

function plan(cwd, port) {
  if (!cwd) return { ok: false, reason: 'this server has no project folder set' };
  const file = path.join(cwd, 'package.json');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { ok: false, reason: 'no package.json in that folder' }; }

  let pkg;
  try { pkg = JSON.parse(raw); }
  catch (e) { return { ok: false, reason: 'package.json is not valid JSON' }; }

  const scripts = pkg.scripts || {};
  const key = scripts.dev !== undefined ? 'dev' : (scripts.start !== undefined ? 'start' : null);
  if (!key) return { ok: false, reason: 'no dev or start script in package.json' };

  const before = scripts[key];
  const r = rewriteScript(before, port);
  if (!r.ok) return { ok: false, reason: r.reason, script: before };
  if (r.next === before) return { ok: false, reason: 'that script already uses port ' + port, script: before };

  // Match the key together with its value. Matching the value alone is not enough: a dev
  // script of "vite" also appears as the dependency name "vite", which is two hits.
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('("' + esc(key) + '"\\s*:\\s*)' + esc(JSON.stringify(before)));
  const hits = raw.match(new RegExp(re.source, 'g')) || [];
  if (hits.length === 0) return { ok: false, reason: 'could not locate the script safely in the file' };
  if (hits.length > 1) return { ok: false, reason: 'that script appears more than once, too risky to edit' };

  return { ok: true, file, key, before, after: r.next, how: r.how, raw, re };
}

function apply(cwd, port) {
  const p = plan(cwd, port);
  if (!p.ok) return p;
  const backup = p.file + '.backup-' + Date.now();
  try {
    fs.writeFileSync(backup, p.raw);
    fs.writeFileSync(p.file, p.raw.replace(p.re, '$1' + JSON.stringify(p.after).replace(/\$/g, '$$$$')));
  } catch (e) {
    return { ok: false, reason: 'could not write package.json: ' + e.message };
  }
  return { ok: true, file: p.file, key: p.key, before: p.before, after: p.after, how: p.how, backup };
}

module.exports = { plan, apply, rewriteScript };
