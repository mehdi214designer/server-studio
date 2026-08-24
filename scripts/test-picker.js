#!/usr/bin/env node
// Opens the native folder picker for real, then cancels it from outside and checks
// the app recovers. Nobody can click a dialog on a build agent, so this covers
// everything except a human actually choosing a folder.
'use strict';

const path = require('path');
const { execFile, execFileSync } = require('child_process');

const plat = require(path.join(__dirname, '..', 'src', 'platform.js'));
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const HELPER = WIN ? 'powershell' : MAC ? 'osascript' : 'zenity';

function done(code, msg) { console.log(msg); process.exit(code); }

// Is the helper even present? Without it, pickFolder should report cancelled.
let helperExists = true;
try {
  execFileSync(WIN ? 'where' : 'which', [HELPER], { stdio: 'ignore' });
} catch (e) { helperExists = false; }

console.log('helper: ' + HELPER + (helperExists ? ' found' : ' NOT found'));

let fired = false;
const t0 = Date.now();

plat.pickFolder((err, picked) => {
  fired = true;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (err) done(1, 'FAIL  pickFolder passed an error instead of cancelling: ' + err.message);
  if (picked !== null) done(1, 'FAIL  expected null after cancelling, got ' + JSON.stringify(picked));
  done(0, helperExists
    ? 'PASS  dialog opened, cancelling it returned null cleanly after ' + secs + 's'
    : 'PASS  no helper installed, reported cancelled instead of erroring (' + secs + 's)');
});

// Give the dialog time to appear, then cancel it the way a user closing it would.
setTimeout(() => {
  if (fired) return;
  console.log('cancelling the dialog...');
  if (WIN) execFile('taskkill', ['/IM', 'powershell.exe', '/F'], () => {});
  else execFile('pkill', [HELPER], () => {});
}, 6000);

setTimeout(() => {
  if (!fired) done(1, 'FAIL  pickFolder never called back, it hung');
}, 25000);
