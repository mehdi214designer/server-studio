#!/usr/bin/env node
// Adds (or updates) a server entry in the Server Studio app's data file.
// Each project gets ONE permanent, unique port. A project's port is LOCKED:
// re-registering the same project never changes its port (unless --force).
//
// No npm deps. Usage:
//   node register-server.js --name "Portfolio Site" --project "Client redesign" \
//        --cwd "/Users/you/Sites/portfolio" --command "npm run dev" --url "localhost:3001" \
//        --folder "WordPress" --tag "Vite" --note "admin: ninja/ninja"
//
//   # let it pick a fresh, never-used port for a NEW project:
//   node register-server.js --name "New Site" --cwd "/path" --command "npm run dev" --assign
//
// On success it prints "PORT <n>" so the caller can bake that exact port into the
// project's dev config (with strictPort) so the server ALWAYS uses it.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Must match src/platform.js dataDir(); this script ships on its own, so it is inlined.
const DATA_DIR = (function () {
  if (process.env.SERVER_STUDIO_DATA_DIR) return process.env.SERVER_STUDIO_DATA_DIR;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Server Studio');
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Server Studio');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'server-studio');
})();
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const FOLDERS_FILE = path.join(DATA_DIR, 'folders.json');
const BASE_PORT = 3001; // assigned ports start here and go up

// ---- parse --flag "value" args ----
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const val = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    args[key] = val === '' ? true : val;
  }
}

function portFromUrl(url) {
  const m = String(url || '').match(/:(\d{2,5})\b/);
  return m ? Number(m[1]) : null;
}

const entry = {
  name: args.name || '',
  project: args.project || '',
  folder: resolveFolder(args.folder || args.category),
  cwd: args.cwd || '',
  command: args.command || '',
  url: typeof args.url === 'string' ? args.url : '',
  tag: args.tag || '',
  note: args.note || '',
};

if (!entry.name && !entry.url && !entry.command) {
  console.error('Need at least --name, --url or --command.');
  process.exit(1);
}

// ---- read existing ----
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
let data = [];
try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || []; } catch (e) { data = []; }
if (!Array.isArray(data)) data = [];

function uid() { return 's_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }

// The app groups by folder id. Take a folder NAME on the command line and resolve it,
// creating the folder if it does not exist yet, so a registered server lands in the
// right place instead of sitting unfiled.
function resolveFolder(name) {
  const wanted = String(name || '').trim();
  if (!wanted) return '';
  let folders = [];
  try { folders = JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8')) || []; } catch (e) { folders = []; }
  if (!Array.isArray(folders)) folders = [];
  const hit = folders.find(f => String(f.name || '').toLowerCase() === wanted.toLowerCase());
  if (hit) return hit.id;
  const f = { id: 'f_' + Math.random().toString(36).slice(2, 9), name: wanted };
  folders.push(f);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FOLDERS_FILE, JSON.stringify(folders, null, 2)); }
  catch (e) { return ''; }
  return f.id;
}
const norm = s => String(s || '').trim().toLowerCase();
function usedPorts(excludeId) {
  return new Set(data.filter(s => s.id !== excludeId).map(s => portFromUrl(s.url)).filter(Boolean));
}
function nextFreePort(excludeId) {
  const used = usedPorts(excludeId);
  let p = Number(args.base) || BASE_PORT;
  while (used.has(p)) p++;
  return p;
}

// ---- find existing entry for this project ----
const match = data.find(s =>
  (entry.cwd && norm(s.cwd) === norm(entry.cwd)) ||
  (entry.name && norm(s.name) === norm(entry.name))
);

let finalPort = null;
let action;

if (match) {
  const lockedPort = portFromUrl(match.url);
  // Update everything EXCEPT the port, which stays locked to the project.
  const keepUrl = match.url;
  Object.assign(match, entry);
  if (lockedPort && !args.force) {
    match.url = keepUrl; // never move a project to a different port
    finalPort = lockedPort;
    if (entry.url && portFromUrl(entry.url) !== lockedPort) {
      console.warn(`note: kept locked port ${lockedPort} (use --force to override)`);
    }
  } else {
    if (!match.url || args.assign) match.url = 'localhost:' + nextFreePort(match.id);
    finalPort = portFromUrl(match.url);
  }
  action = 'updated';
} else {
  // New project: use given port if free, otherwise assign a fresh unique one.
  let port = portFromUrl(entry.url);
  const used = usedPorts();
  if (!port || used.has(port)) {
    if (port && used.has(port)) console.warn(`note: port ${port} already taken, assigning a free one`);
    port = nextFreePort();
    entry.url = 'localhost:' + port;
  }
  data.push({ id: uid(), pinned: false, ...entry });
  finalPort = port;
  action = 'added';
}

fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
console.log(`${action}: "${entry.name || entry.url}" -> ${data.length} server(s) total`);
if (finalPort) console.log(`PORT ${finalPort}`);
console.log('Reload not needed: the dashboard auto-refreshes within a few seconds.');
