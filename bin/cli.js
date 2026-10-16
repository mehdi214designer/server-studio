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

// ---- never recursively delete something we did not put there ----
//
// All three destinations are overridable by env var, and every one of them is handed to
// fs.rmSync with recursive:true. One missing path segment was all it took: pointing
// SERVER_STUDIO_SKILL_DEST at ~/.claude/skills instead of ~/.claude/skills/server-studio
// deleted every other skill in that folder and still printed "ok".
//
// So a destination is only ever removed when it carries our own marker files, and never
// when it is the filesystem root, the home folder, or anything above it.
function unsafeTarget(dir) {
  const d = path.resolve(dir);
  const home = path.resolve(os.homedir());
  if (d === path.parse(d).root) return 'it is the filesystem root';
  if (d === home) return 'it is your home folder';
  if (home.startsWith(d + path.sep)) return 'your home folder is inside it';
  return null;
}

// Marker files that prove a directory is one of ours, rather than someone else's.
const MARKERS = {
  app: [path.join('Contents', 'MacOS', 'ServerStudio')],
  skill: ['SKILL.md', 'register-server.js'],
  data: ['data.json'],
};

// Removes dir only when it is safe and ours. Nothing there is success, not failure.
function removeOurs(dir, kind, label) {
  if (!fs.existsSync(dir)) return;
  const why = unsafeTarget(dir);
  if (why) die('refusing to delete ' + dir + ', ' + why + '.');
  const mine = MARKERS[kind].some(m => fs.existsSync(path.join(dir, m)));
  if (!mine) {
    die('refusing to delete ' + dir + '\n' +
      '  It exists but does not look like ' + label + ', so it is probably not ours.\n' +
      '  Expected to find ' + MARKERS[kind].join(' or ') + ' inside it.\n' +
      '  Check the path, or move that folder aside yourself and run this again.');
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
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
      removeOurs(APP_DEST, 'app', 'a Server Studio app bundle');
      fs.cpSync(APP_SRC, APP_DEST, { recursive: true });
      ok('app updated at ' + APP_DEST);
    } else {
      fs.cpSync(APP_SRC, APP_DEST, { recursive: true });
      ok('app installed at ' + APP_DEST);
    }
    // cpSync does not preserve the exec bit on the launcher.
    // src/ is the single source of truth, copied into the bundle at install time.
    fs.cpSync(SRC, path.join(APP_DEST, 'Contents', 'Resources'), { recursive: true });
    // The bundle has no package.json, so stamp the version beside the code. Without this
    // an installed app reports 0.0.0 and therefore thinks an update is always available.
    try {
      fs.writeFileSync(
        path.join(APP_DEST, 'Contents', 'Resources', 'version.json'),
        JSON.stringify({ version: require(path.join(ROOT, 'package.json')).version }) + '\n'
      );
    } catch (e) {}
    fs.chmodSync(path.join(APP_DEST, 'Contents', 'MacOS', 'ServerStudio'), 0o755);
  } else skip('app skipped (--no-app)');

  if (!has('--no-skill')) {
    fs.mkdirSync(path.dirname(SKILL_DEST), { recursive: true });
    removeOurs(SKILL_DEST, 'skill', 'the Server Studio skill');
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

  // npx wipes its cache after running, so the plugin is copied somewhere durable
  // before its path is printed.
  const pluginSrc = path.join(ROOT, 'dist', 'server-studio.plugin');
  let pluginFile = null;
  if (fs.existsSync(pluginSrc)) {
    pluginFile = path.join(DATA_DIR, 'server-studio.plugin');
    try { fs.copyFileSync(pluginSrc, pluginFile); }
    catch (e) { pluginFile = null; }
  }

  console.log(MAC
    ? '\nDone. Open it from Applications, or run:  open -a "Server Studio"'
    : '\nDone. Start it with:  npx server-studio start');
  if (pluginFile) {
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

  if (MAC && fs.existsSync(APP_DEST)) { removeOurs(APP_DEST, 'app', 'a Server Studio app bundle'); ok('removed ' + APP_DEST); }
  else if (MAC) skip('no app at ' + APP_DEST);

  if (fs.existsSync(SKILL_DEST)) { removeOurs(SKILL_DEST, 'skill', 'the Server Studio skill'); ok('removed ' + SKILL_DEST); }
  else skip('no skill at ' + SKILL_DEST);

  // The server list is the user's own data, so it survives unless asked for explicitly.
  if (has('--purge')) {
    if (fs.existsSync(DATA_DIR)) { removeOurs(DATA_DIR, 'data', 'a Server Studio data folder'); ok('deleted saved servers at ' + DATA_DIR); }
    else skip('no saved servers to delete');
  } else if (fs.existsSync(DATA_DIR)) {
    console.log('\nYour saved servers were kept at:\n  ' + DATA_DIR);
    console.log('Delete them too with:  npx server-studio uninstall --purge');
  }
}

// The registration script has nothing Claude-specific in it, so it is exposed as a
// plain command too. Any editor, agent or shell script can call this.
function add() {
  const { spawnSync } = require('child_process');
  const script = path.join(ROOT, 'skill', 'register-server.js');
  const passthrough = args.filter(a => a !== 'add');
  if (!passthrough.length) {
    console.log(`Add or update a server from the command line.

  server-studio add --name "Portfolio Site" --cwd "$PWD" --command "npm run dev" --assign

  --name       what to call it
  --project    a line of context
  --category   groups cards into filter tabs
  --cwd        the project folder
  --command    how to start it
  --url        address or bare port; omit with --assign
  --tag        small label, usually the stack
  --note       anything to remember
  --assign     pick a free port nothing else uses, and print it
  --force      allow an existing project to move to a different port

Re-running for the same project updates its fields but keeps its port locked.`);
    return;
  }
  const r = spawnSync(process.execPath, [script, ...passthrough], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
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
  npx server-studio add ...      save a server from the command line
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
else if (cmd === 'add') add();
else if (cmd === 'uninstall') uninstall();
else { console.error('unknown command: ' + cmd + '\n'); help(); process.exit(1); }
