#!/usr/bin/env node
// Server Studio installer. Node built-ins only, no dependencies.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP_NAME = 'Server Studio.app';
const APP_SRC = path.join(ROOT, 'app', APP_NAME);
const SRC = path.join(ROOT, 'src');
const MAC = process.platform === 'darwin';
const APP_DEST = process.env.SERVER_STUDIO_APP_DEST || path.join('/Applications', APP_NAME);
const SKILL_SRC = path.join(ROOT, 'skill');
const SKILL_DEST = process.env.SERVER_STUDIO_SKILL_DEST ||
  path.join(os.homedir(), '.claude', 'skills', 'server-studio');


const args = process.argv.slice(2);
let DATA_DIR;
const has = f => args.includes(f);
const cmd = has('-h') || has('--help') ? 'help' : (args.find(a => !a.startsWith('-')) || 'install');
const DRY = has('--dry-run');

function die(msg) { console.error('error: ' + msg); process.exit(1); }
function ok(msg) { console.log('  ok  ' + msg); }
function skip(msg) { console.log('  --  ' + msg); }

function dataDir() {
  if (process.env.SERVER_STUDIO_DATA_DIR) return process.env.SERVER_STUDIO_DATA_DIR;
  if (MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'Server Studio');
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Server Studio');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'server-studio');
}

function hasNode() {
  try { execFileSync('/usr/bin/env', ['which', 'node'], { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}

/* ---------- install ---------- */
function install() {
  DATA_DIR = dataDir();
  if (DRY) {
    console.log('Dry run, nothing will be written.\n');
    console.log('  app   -> ' + APP_DEST);
    console.log('  skill -> ' + SKILL_DEST);
    console.log('  data  -> ' + path.join(DATA_DIR, 'data.json') + '  (created only if missing)');
    return;
  }
  console.log('Installing Server Studio...\n');

  if (!MAC) {
    skip('Mac app skipped, this is ' + process.platform + '. Use:  npx server-studio start');
  } else if (!has('--no-app')) {
    if (fs.existsSync(APP_DEST)) {
      fs.rmSync(APP_DEST, { recursive: true, force: true });
      fs.cpSync(APP_SRC, APP_DEST, { recursive: true });
      ok('app updated at ' + APP_DEST);
    } else {
      fs.cpSync(APP_SRC, APP_DEST, { recursive: true });
      ok('app installed at ' + APP_DEST);
    }
    // cpSync does not preserve the exec bit on the launcher.
    // src/ is the single source of truth, copied into the bundle at install time.
    fs.cpSync(SRC, path.join(APP_DEST, 'Contents', 'Resources'), { recursive: true });
    fs.chmodSync(path.join(APP_DEST, 'Contents', 'MacOS', 'ServerStudio'), 0o755);
  } else skip('app skipped (--no-app)');

  if (!has('--no-skill')) {
    fs.mkdirSync(path.dirname(SKILL_DEST), { recursive: true });
    fs.rmSync(SKILL_DEST, { recursive: true, force: true });
    fs.cpSync(SKILL_SRC, SKILL_DEST, { recursive: true });
    ok('Claude Code skill at ' + SKILL_DEST);
  } else skip('skill skipped (--no-skill)');

  // Your saved servers live outside the app, so installing never touches them.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const dataFile = path.join(DATA_DIR, 'data.json');
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, '[]');
    ok('created empty server list at ' + dataFile);
  } else {
    ok('kept existing server list (' + JSON.parse(fs.readFileSync(dataFile, 'utf8') || '[]').length + ' servers)');
  }

  if (!hasNode()) {
    console.log('\nnote: Node.js was not found on PATH. The app needs it to run.');
  }

  const pluginFile = path.join(ROOT, 'dist', 'server-studio.plugin');
  console.log(MAC
    ? '\nDone. Open it from Applications, or run:  open -a "Server Studio"'
    : '\nDone. Start it with:  npx server-studio start');
  if (fs.existsSync(pluginFile)) {
    console.log('\nUsing Claude Cowork? Install the plugin by opening this file:');
    console.log('  ' + pluginFile);
  }
}

/* ---------- uninstall ---------- */
function uninstall() {
  DATA_DIR = dataDir();
  if (DRY) {
    console.log('Dry run, nothing will be removed.\n');
    console.log('  would remove ' + APP_DEST);
    console.log('  would remove ' + SKILL_DEST);
    console.log('  would keep   ' + DATA_DIR + (has('--purge') ? '  (--purge: would DELETE)' : ''));
    return;
  }
  console.log('Removing Server Studio...\n');

  if (MAC && fs.existsSync(APP_DEST)) { fs.rmSync(APP_DEST, { recursive: true, force: true }); ok('removed ' + APP_DEST); }
  else if (MAC) skip('no app at ' + APP_DEST);

  if (fs.existsSync(SKILL_DEST)) { fs.rmSync(SKILL_DEST, { recursive: true, force: true }); ok('removed ' + SKILL_DEST); }
  else skip('no skill at ' + SKILL_DEST);

  // The server list is the user's own data, so it survives unless asked for explicitly.
  if (has('--purge')) {
    if (fs.existsSync(DATA_DIR)) { fs.rmSync(DATA_DIR, { recursive: true, force: true }); ok('deleted saved servers at ' + DATA_DIR); }
    else skip('no saved servers to delete');
  } else if (fs.existsSync(DATA_DIR)) {
    console.log('\nYour saved servers were kept at:\n  ' + DATA_DIR);
    console.log('Delete them too with:  npx server-studio uninstall --purge');
  }
}

function start() {
  DATA_DIR = dataDir();
  const { spawn } = require('child_process');
  const server = path.join(SRC, 'server.js');
  const child = spawn(process.execPath, [server], { stdio: 'inherit' });
  child.on('exit', code => process.exit(code || 0));
  process.on('SIGINT', () => { child.kill('SIGINT'); });
}

function help() {
  console.log(`Server Studio

  npx server-studio install      install the app + Claude Code skill
  npx server-studio start        run the dashboard (works on macOS, Windows and Linux)
  npx server-studio uninstall    remove them (keeps your saved servers)

Options
  --no-app        do not install the Mac app (ignored off macOS)
  --no-skill      do not install the Claude Code skill
  --purge         uninstall only: also delete your saved server list
  --dry-run       print what would happen, change nothing
`);
}

if (cmd === 'help') help();
else if (cmd === 'install') install();
else if (cmd === 'start') start();
else if (cmd === 'uninstall') uninstall();
else { console.error('unknown command: ' + cmd + '\n'); help(); process.exit(1); }
