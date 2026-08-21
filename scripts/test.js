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
  }
  srv.kill();

  // ---- uninstall ----
  execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'uninstall'], { env, stdio: 'ignore' });
  if (MAC) check('app removed', !fs.existsSync(env.SERVER_STUDIO_APP_DEST));
  check('skill removed', !fs.existsSync(env.SERVER_STUDIO_SKILL_DEST));
  check('saved servers kept without --purge', fs.existsSync(path.join(env.SERVER_STUDIO_DATA_DIR, 'data.json')));

  execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'uninstall', '--purge'], { env, stdio: 'ignore' });
  check('--purge deletes saved servers', !fs.existsSync(env.SERVER_STUDIO_DATA_DIR));

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
