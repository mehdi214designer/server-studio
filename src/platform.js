// Per-OS shims. Everything the dashboard does that is not plain Node lives here.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, exec } = require('child_process');

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';

/* ---------- quoting ---------- */
function shQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function osaQuote(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

/* ---------- where the server list is stored ---------- */
function dataDir() {
  if (process.env.SERVER_STUDIO_DATA_DIR) return process.env.SERVER_STUDIO_DATA_DIR;
  if (MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'Server Studio');
  if (WIN) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Server Studio');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'server-studio');
}

/* ---------- open a URL or a folder in the desktop's default handler ---------- */
function openExternal(target, cb) {
  if (MAC) return execFile('open', [target], cb);
  // The empty string is start's window-title argument; without it a quoted
  // target would be swallowed as the title.
  if (WIN) return execFile('cmd', ['/c', 'start', '', target], cb);
  return execFile('xdg-open', [target], cb);
}

function revealFolder(p, cb) {
  if (MAC) return execFile('open', [p], cb);
  if (WIN) return execFile('explorer', [p], () => cb(null)); // explorer exits non-zero even on success
  return execFile('xdg-open', [p], cb);
}

/* ---------- run a command in a visible terminal window ---------- */
function runInTerminal(cwd, command, cb) {
  if (MAC) {
    let line = command;
    if (cwd) line = 'cd ' + shQuote(cwd) + ' && ' + command;
    return execFile('osascript', [
      '-e', 'tell application "Terminal" to do script ' + osaQuote(line),
      '-e', 'tell application "Terminal" to activate',
    ], cb);
  }
  if (WIN) {
    // The command goes into a .bat rather than onto cmd's command line. Node escapes
    // embedded quotes as \" which cmd.exe does not accept as an escape, so passing a
    // quoted path through `start cmd /k "..."` mangles it. A file has no such problem.
    let bat;
    try {
      bat = path.join(os.tmpdir(), 'server-studio-' + Date.now() + '-' + process.pid + '.bat');
      fs.writeFileSync(bat, [
        '@echo off',
        cwd ? 'cd /d "' + cwd + '"' : '',
        command,
      ].filter(Boolean).join('\r\n') + '\r\n');
    } catch (e) { return cb(e); }
    // The empty string is start's window-title argument, and /k keeps the window open
    // so a dev server keeps running and its output stays readable.
    return execFile('cmd', ['/c', 'start', '', 'cmd', '/k', bat], cb);
  }
  // Linux has no standard terminal, so try the common ones in turn.
  const line = (cwd ? 'cd ' + shQuote(cwd) + ' && ' : '') + command + '; exec $SHELL';
  const candidates = [
    ['x-terminal-emulator', ['-e', 'bash', '-lc', line]],
    ['gnome-terminal', ['--', 'bash', '-lc', line]],
    ['konsole', ['-e', 'bash', '-lc', line]],
    ['xfce4-terminal', ['-e', 'bash -lc ' + shQuote(line)]],
    ['xterm', ['-e', 'bash', '-lc', line]],
  ];
  (function tryNext(i) {
    if (i >= candidates.length) {
      return cb(new Error('No terminal emulator found. Install xterm, or run the command yourself.'));
    }
    execFile(candidates[i][0], candidates[i][1], err => (err ? tryNext(i + 1) : cb(null)));
  })(0);
}

/* ---------- kill whatever holds a TCP port ---------- */
function killPort(port, cb) {
  const p = Number(port);
  if (!p) return cb(new Error('bad port'));
  if (WIN) {
    // netstat lists the owning PID in the last column of LISTENING rows.
    return exec('netstat -ano -p tcp | findstr LISTENING | findstr :' + p, (err, stdout) => {
      const pids = new Set(String(stdout || '').trim().split(/\r?\n/)
        .map(l => l.trim().split(/\s+/).pop())
        .filter(x => /^\d+$/.test(x) && x !== '0'));
      if (!pids.size) return cb(null);
      exec([...pids].map(id => 'taskkill /PID ' + id + ' /T /F').join(' & '), () => cb(null));
    });
  }
  return exec('lsof -nti tcp:' + p + ' | xargs kill 2>/dev/null', () => cb(null));
}

/* ---------- native "choose a folder" dialog ---------- */
function pickFolder(cb) {
  if (MAC) {
    return execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "Pick the project folder")'],
      (err, stdout) => (err ? cb(null, null) : cb(null, String(stdout).trim())));
  }
  if (WIN) {
    const ps = 'Add-Type -AssemblyName System.Windows.Forms;' +
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
      'if ($d.ShowDialog() -eq "OK") { $d.SelectedPath }';
    return execFile('powershell', ['-NoProfile', '-STA', '-Command', ps],
      (err, stdout) => (err ? cb(null, null) : cb(null, String(stdout).trim() || null)));
  }
  return execFile('zenity', ['--file-selection', '--directory'],
    (err, stdout) => (err ? cb(null, null) : cb(null, String(stdout).trim() || null)));
}

/* ---------- what the UI should call the terminal ---------- */
function terminalName() { return WIN ? 'Command Prompt' : MAC ? 'Terminal' : 'your terminal'; }

// Placeholder text for the project folder field, so the example looks native.
function pathExample() {
  if (WIN) return 'C:\\Users\\you\\Projects\\app';
  if (MAC) return '/Users/you/Sites/project';
  return '/home/you/projects/app';
}

module.exports = { dataDir, openExternal, revealFolder, runInTerminal, killPort, pickFolder, terminalName, pathExample, WIN, MAC };
