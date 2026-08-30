#!/usr/bin/env node
// End to end check: installs into a temp folder and attacks a temp server.
// Never touches /Applications, ~/.claude or your real server list.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAC = process.platform === 'darwin';
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-test-'));
const PORT = 4400 + Math.floor(process.pid % 300);
const env = {
  ...process.env,
  SERVER_STUDIO_APP_DEST: path.join(SB, 'Server Studio.app'),
  SERVER_STUDIO_SKILL_DEST: path.join(SB, 'skill'),
  SERVER_STUDIO_DATA_DIR: path.join(SB, 'data'),
};

let failed = 0;
function check(name, pass, detail) {
  console.log((pass ? '  pass  ' : '  FAIL  ') + name + (detail && !pass ? '  -> ' + detail : ''));
  if (!pass) failed++;
}

function req(opts, body) {
  return new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port: PORT, ...opts }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ code: res.statusCode, body: b }));
    });
    r.on('error', e => resolve({ code: 0, body: String(e) }));
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  console.log('sandbox: ' + SB + '\n');

  // ---- installer ----
  execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'install'], { env, stdio: 'ignore' });
  if (MAC) {
    check('app installed', fs.existsSync(path.join(env.SERVER_STUDIO_APP_DEST, 'Contents', 'Resources', 'server.js')));
    check('shared src copied into bundle', fs.existsSync(path.join(env.SERVER_STUDIO_APP_DEST, 'Contents', 'Resources', 'platform.js')));
    check('launcher is executable', (fs.statSync(path.join(env.SERVER_STUDIO_APP_DEST, 'Contents', 'MacOS', 'ServerStudio')).mode & 0o111) !== 0);
  } else {
    check('app bundle skipped off macOS', !fs.existsSync(env.SERVER_STUDIO_APP_DEST));
  }
  check('skill installed', fs.existsSync(path.join(env.SERVER_STUDIO_SKILL_DEST, 'SKILL.md')));
  check('empty data file created', fs.readFileSync(path.join(env.SERVER_STUDIO_DATA_DIR, 'data.json'), 'utf8').trim() === '[]');
  // The path printed for the Cowork plugin must survive npx clearing its cache.
  check('plugin copied out of the package', fs.existsSync(path.join(env.SERVER_STUDIO_DATA_DIR, 'server-studio.plugin')));

  // Existing data must survive a reinstall.
  fs.writeFileSync(path.join(env.SERVER_STUDIO_DATA_DIR, 'data.json'), '[{"id":"keep","name":"keep me"}]');
  execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'install'], { env, stdio: 'ignore' });
  check('reinstall keeps existing servers',
    JSON.parse(fs.readFileSync(path.join(env.SERVER_STUDIO_DATA_DIR, 'data.json'), 'utf8'))[0].id === 'keep');

  // ---- running server ----
  const serverPath = MAC
    ? path.join(env.SERVER_STUDIO_APP_DEST, 'Contents', 'Resources', 'server.js')
    : path.join(ROOT, 'src', 'server.js');
  const srv = spawn(process.execPath, [serverPath],
    { env: { ...env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const up = await new Promise(res => {
    const t = setTimeout(() => res(false), 5000);
    srv.stdout.on('data', d => { if (String(d).includes('running on')) { clearTimeout(t); res(true); } });
  });
  check('server started on its own port', up);

  if (up) {
    const marker = path.join(SB, 'pwned.txt');
    const payload = JSON.stringify({
      command: process.platform === 'win32' ? 'type nul > "' + marker + '"' : 'touch ' + marker,
    });

    const a1 = await req({ method: 'POST', path: '/api/run', headers: { 'Content-Type': 'text/plain' } }, payload);
    check('text/plain CSRF rejected', a1.code === 415, 'got ' + a1.code);

    const a2 = await req({ method: 'POST', path: '/api/run',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' } }, payload);
    check('foreign Origin rejected', a2.code === 403, 'got ' + a2.code);

    const a3 = await req({ method: 'OPTIONS', path: '/api/run', headers: { Origin: 'https://evil.example' } });
    check('preflight refused', a3.code === 403 || a3.code === 405, 'got ' + a3.code);

    const good = await req({ method: 'POST', path: '/api/servers',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:' + PORT } }, '[]');
    check('same-origin write accepted', good.code === 200, 'got ' + good.code);

    await new Promise(r => setTimeout(r, 300));
    check('no attack executed a command', !fs.existsSync(marker));

    // The picker itself is a modal dialog and cannot be automated. What can be
    // checked is the path that matters when the helper is missing: it must report
    // cancelled instead of hanging or erroring. Skipped where a dialog would open
    // and block this process.
    let hasPicker = MAC || process.platform === 'win32';
    if (!hasPicker) {
      try { execFileSync('which', ['zenity'], { stdio: 'ignore' }); hasPicker = true; }
      catch (e) { hasPicker = false; }
    }
    if (!hasPicker) {
      const picked = await req({ method: 'POST', path: '/api/pickfolder' });
      let cancelled = false;
      try { cancelled = JSON.parse(picked.body).cancelled === true; } catch (e) {}
      check('folder picker reports cancelled when no dialog is available',
        picked.code === 200 && cancelled, 'got ' + picked.code + ' ' + picked.body);
    } else {
      console.log('  skip  folder picker, a dialog would block this process');
    }
  }
  srv.kill();

  // ---- uninstall ----
  execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'uninstall'], { env, stdio: 'ignore' });
  if (MAC) check('app removed', !fs.existsSync(env.SERVER_STUDIO_APP_DEST));
  check('skill removed', !fs.existsSync(env.SERVER_STUDIO_SKILL_DEST));
  check('saved servers kept without --purge', fs.existsSync(path.join(env.SERVER_STUDIO_DATA_DIR, 'data.json')));

  execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'uninstall', '--purge'], { env, stdio: 'ignore' });
  check('--purge deletes saved servers', !fs.existsSync(env.SERVER_STUDIO_DATA_DIR));

  // ---- the add command, which must work without Claude anywhere near it ----
  const addDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-add-'));
  const addEnv = { ...process.env, SERVER_STUDIO_DATA_DIR: addDir };
  const cli = path.join(ROOT, 'bin', 'cli.js');
  const first = execFileSync(process.execPath,
    [cli, 'add', '--name', 'Demo', '--cwd', addDir, '--command', 'npm run dev', '--assign'],
    { env: addEnv, encoding: 'utf8' });
  const port = (first.match(/PORT (\d+)/) || [])[1];
  check('add registers a server and prints its port', !!port, first.trim());
  execFileSync(process.execPath,
    [cli, 'add', '--name', 'Demo', '--cwd', addDir, '--command', 'npm start', '--assign'],
    { env: addEnv, encoding: 'utf8' });
  const rows = JSON.parse(fs.readFileSync(path.join(addDir, 'data.json'), 'utf8'));
  check('re-adding the same project keeps one entry', rows.length === 1, 'got ' + rows.length);
  check('re-adding keeps the port locked', rows[0].url.includes(port), rows[0].url);
  check('re-adding updates the other fields', rows[0].command === 'npm start', rows[0].command);
  fs.rmSync(addDir, { recursive: true, force: true });

  // ---- plugin build ----
  // The archive is hand-written, so verify a real zip reader can open it and that
  // the skill inside matches the source it was built from.
  const zlib = require('zlib');
  const pluginPath = path.join(ROOT, 'dist', 'server-studio.plugin');
  if (fs.existsSync(pluginPath)) {
    const buf = fs.readFileSync(pluginPath);
    check('plugin has a zip signature', buf.readUInt32LE(0) === 0x04034b50);
    check('plugin has an end-of-central-directory record',
      buf.readUInt32LE(buf.length - 22) === 0x06054b50);
    // Walk the local headers and inflate the skill file to prove the bytes are sound.
    let off = 0, found = null, seen = 0;
    while (off + 30 < buf.length && buf.readUInt32LE(off) === 0x04034b50) {
      const method = buf.readUInt16LE(off + 8);
      const compSize = buf.readUInt32LE(off + 18);
      const nameLen = buf.readUInt16LE(off + 26);
      const extraLen = buf.readUInt16LE(off + 28);
      const name = buf.slice(off + 30, off + 30 + nameLen).toString('utf8');
      const body = buf.slice(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + compSize);
      if (name === 'skills/server-studio/SKILL.md') {
        found = method === 8 ? zlib.inflateRawSync(body) : body;
      }
      seen++;
      off += 30 + nameLen + extraLen + compSize;
    }
    check('plugin contains every entry', seen === 7, 'saw ' + seen);
    check('skill inside plugin matches skill/ source',
      !!found && found.equals(fs.readFileSync(path.join(ROOT, 'skill', 'SKILL.md'))));
  } else {
    check('plugin built', false, 'run npm run build:plugin first');
  }

  // ---- writing a port into a project ----
  const sp = require(path.join(ROOT, 'src', 'setport.js'));
  check('rewrites a bare vite script', sp.rewriteScript('vite', 4000).next === 'vite --port 4000 --strictPort');
  check('replaces an existing next port', sp.rewriteScript('next dev -p 3001', 4000).next === 'next dev -p 4000');
  check('never doubles the flag', sp.rewriteScript('vite --port 5173 --strictPort', 4000).next === 'vite --port 4000 --strictPort');
  check('refuses an unknown dev script', !sp.rewriteScript('node server.js', 4000).ok);
  check('refuses a chained dev script', !sp.rewriteScript('vite && echo hi', 4000).ok);
  (function () {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sp-'));
    const orig = '{\n    "name": "x",\n    "scripts": {\n        "dev": "vite"\n    },\n    "devDependencies": { "vite": "^5" }\n}\n';
    fs.writeFileSync(path.join(d, 'package.json'), orig);
    const planOnly = sp.plan(d, 4000);
    check('plan does not write anything', planOnly.ok && fs.readFileSync(path.join(d, 'package.json'), 'utf8') === orig);
    const r = sp.apply(d, 4000);
    const after = fs.readFileSync(path.join(d, 'package.json'), 'utf8');
    check('apply changes only the dev script',
      after === orig.replace('"dev": "vite"', '"dev": "vite --port 4000 --strictPort"'));
    check('apply keeps a backup', r.ok && fs.existsSync(r.backup));
    check('result is still valid JSON', (() => { try { JSON.parse(after); return true; } catch (e) { return false; } })());
    fs.rmSync(d, { recursive: true, force: true });
  })();

  // ---- version comparison behind the update pill ----
  (function () {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
    const m = src.match(/function isNewer\(a, b\) \{[\s\S]*?\n\}/);
    const isNewer = eval('(' + m[0].replace('function isNewer', 'function') + ')');
    check('1.2.0 is newer than 1.1.1', isNewer('1.2.0', '1.1.1'));
    check('1.1.1 is not newer than itself', !isNewer('1.1.1', '1.1.1'));
    check('1.1.1 is not newer than 1.2.0', !isNewer('1.1.1', '1.2.0'));
    check('1.10.0 beats 1.9.0', isNewer('1.10.0', '1.9.0'));
    check('2.0.0 beats 1.99.99', isNewer('2.0.0', '1.99.99'));
  })();

  // ---- version reporting from an installed bundle ----
  // The bundle carries no package.json, so without a stamped version an installed app
  // reports 0.0.0 and believes an update is permanently available.
  (function () {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ver-'));
    execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'install'], {
      env: { ...process.env, SERVER_STUDIO_APP_DEST: path.join(d, 'app'),
        SERVER_STUDIO_SKILL_DEST: path.join(d, 'skill'), SERVER_STUDIO_DATA_DIR: path.join(d, 'data') },
      stdio: 'ignore',
    });
    const stamped = path.join(d, 'app', 'Contents', 'Resources', 'version.json');
    check('install stamps a version into the bundle', fs.existsSync(stamped));
    if (fs.existsSync(stamped)) {
      const v = JSON.parse(fs.readFileSync(stamped, 'utf8')).version;
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
      check('stamped version matches package.json', v === pkg, v + ' vs ' + pkg);
    }
    fs.rmSync(d, { recursive: true, force: true });
  })();
  check('update actions handle an unreachable server', (() => {
    const h = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
    const block = h.slice(h.indexOf('async function runUpdate'), h.indexOf('async function runUpdate') + 900);
    return /try\s*\{/.test(block) && /catch/.test(block);
  })());

  // ---- telemetry ----
  // It ships inert and must stay that way until an endpoint is configured, must honour
  // both opt-outs, and must never keep a process alive on a network it cannot reach.
  function loadTelemetry(extra) {
    const keys = ['SERVER_STUDIO_ANALYTICS_URL','SERVER_STUDIO_NO_TELEMETRY','DO_NOT_TRACK','CI'];
    const saved = {};
    keys.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
    Object.assign(process.env, extra || {});
    delete require.cache[require.resolve(path.join(ROOT, 'src', 'telemetry.js'))];
    const m = require(path.join(ROOT, 'src', 'telemetry.js'));
    keys.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    return m;
  }
  check('telemetry is inert with no endpoint set', loadTelemetry({}).enabled === false);
  check('telemetry enables only when an endpoint is set',
    loadTelemetry({ SERVER_STUDIO_ANALYTICS_URL: 'https://example.invalid' }).enabled === true);
  check('ping never throws when opted out', (() => {
    try { loadTelemetry({ SERVER_STUDIO_ANALYTICS_URL: 'https://example.invalid', SERVER_STUDIO_NO_TELEMETRY: '1' }).ping('start'); return true; }
    catch (e) { return false; }
  })());
  check('DO_NOT_TRACK is honoured', (() => {
    try { loadTelemetry({ SERVER_STUDIO_ANALYTICS_URL: 'https://example.invalid', DO_NOT_TRACK: '1' }).ping('start'); return true; }
    catch (e) { return false; }
  })());
  (function () {
    const t = fs.readFileSync(path.join(ROOT, 'src', 'telemetry.js'), 'utf8');
    check('the request is unref\'d so it cannot hold a process open', /req\.unref\(\)/.test(t));
    // Node 18 does not propagate an early req.unref() to the socket, so the socket
    // must be unref'd too or a blocked network stalls the process for seconds.
    check('the socket is unref\'d as well, which Node 18 needs', /sock\.unref\(\)/.test(t));
  })();
  check('README documents telemetry and the opt-out', (() => {
    const r = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    return /^## Telemetry/m.test(r) && r.includes('SERVER_STUDIO_NO_TELEMETRY');
  })());

  // A blocked endpoint must not slow an install down. Comparing the two runs matters
  // more than an absolute number: a slow CI runner makes any fixed threshold flaky,
  // while the gap between them is exactly what unref is supposed to remove.
  function timedInstall(extraEnv) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-timed-'));
    const t = Date.now();
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'install'], {
        env: { ...process.env, SERVER_STUDIO_APP_DEST: path.join(dir, 'app'),
          SERVER_STUDIO_SKILL_DEST: path.join(dir, 'skill'),
          SERVER_STUDIO_DATA_DIR: path.join(dir, 'data'), ...extraEnv },
        stdio: 'ignore',
      });
    } catch (e) {}
    const ms = Date.now() - t;
    fs.rmSync(dir, { recursive: true, force: true });
    return ms;
  }
  const baseline = timedInstall({ SERVER_STUDIO_ANALYTICS_URL: '' });
  const blocked = timedInstall({ SERVER_STUDIO_ANALYTICS_URL: 'https://10.255.255.1' });
  // Without unref the pending socket holds the process for the full 1500ms timeout.
  check('an unreachable endpoint does not delay install',
    blocked - baseline < 700, 'baseline ' + baseline + 'ms, blocked ' + blocked + 'ms, delta ' + (blocked - baseline) + 'ms');

  // ---- platform shims ----
  // The real Windows and Linux behaviour cannot run here, so this only proves the
  // module picks the right command and data path for each OS.
  function loadPlatformAs(name) {
    const real = process.platform;
    Object.defineProperty(process, 'platform', { value: name, configurable: true });
    delete require.cache[require.resolve(path.join(ROOT, 'src', 'platform.js'))];
    const m = require(path.join(ROOT, 'src', 'platform.js'));
    Object.defineProperty(process, 'platform', { value: real, configurable: true });
    return m;
  }
  const saved = process.env.SERVER_STUDIO_DATA_DIR;
  delete process.env.SERVER_STUDIO_DATA_DIR;
  const win = loadPlatformAs('win32');
  const lin = loadPlatformAs('linux');
  const mac = loadPlatformAs('darwin');
  check('windows data dir uses AppData', /AppData|Roaming|Server Studio/.test(win.dataDir()) && !win.dataDir().includes('Library'));
  check('linux data dir uses .config', lin.dataDir().includes('.config'));
  check('mac data dir uses Application Support', mac.dataDir().includes('Application Support'));
  check('windows terminal is named Command Prompt', win.terminalName() === 'Command Prompt');
  check('mac terminal is named Terminal', mac.terminalName() === 'Terminal');
  if (saved) process.env.SERVER_STUDIO_DATA_DIR = saved;

  fs.rmSync(SB, { recursive: true, force: true });
  console.log('\n' + (failed ? failed + ' failed' : 'all passed'));
  process.exit(failed ? 1 : 0);
})();
