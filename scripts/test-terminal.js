#!/usr/bin/env node
// Launches a real terminal window through platform.runInTerminal and checks the
// command actually ran, by having it write a marker file.
//
// This needs a desktop session. On a headless machine it reports SKIP rather than
// failing, so CI can run it wherever a session exists and stay honest where it does not.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const plat = require(path.join(__dirname, '..', 'src', 'platform.js'));
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-term-'));
const marker = path.join(SB, 'ran.txt');
// Writes the marker, proves cwd was honoured, then closes the window.
const command = WIN
  ? 'echo %CD%> "' + marker + '" & exit'
  : 'pwd > ' + JSON.stringify(marker) + '; exit';

function headless() {
  if (WIN || MAC) return false;
  return !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
}

function cleanup() {
  try { fs.rmSync(SB, { recursive: true, force: true }); } catch (e) {}
}

function finish(code, msg) {
  console.log(msg);
  cleanup();
  process.exit(code);
}

if (headless()) {
  finish(0, 'SKIP  no DISPLAY, cannot open a terminal window here');
}

console.log('opening a terminal in ' + SB + ' ...');
plat.runInTerminal(SB, command, err => {
  if (err) finish(1, 'FAIL  runInTerminal errored: ' + err.message);

  // Give the window time to appear and the shell time to run one line.
  let waited = 0;
  const tick = setInterval(() => {
    if (fs.existsSync(marker)) {
      clearInterval(tick);
      const got = fs.readFileSync(marker, 'utf8').trim();
      // macOS reports /private/var for /var, so compare the resolved paths.
      const ok = fs.realpathSync(got) === fs.realpathSync(SB);
      if (MAC) {
        execFile('osascript', ['-e',
          'tell application "Terminal" to close (every window whose processes = {})'], () => {});
      }
      finish(ok ? 0 : 1, ok
        ? 'PASS  terminal opened, ran the command, and was in the right folder'
        : 'FAIL  command ran but cwd was ' + got + ', expected ' + SB);
    }
    waited += 500;
    if (waited >= 25000) {
      clearInterval(tick);
      finish(1, 'FAIL  no marker after 25s, the command did not run');
    }
  }, 500);
});
