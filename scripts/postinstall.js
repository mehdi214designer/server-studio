#!/usr/bin/env node
// Runs the setup automatically after `npm install -g server-studio`, so one command
// is enough. Deliberately narrow: only a global install triggers it, because setting
// up writes outside the package and that should never happen to someone who merely
// pulled this in as a dependency.
//
// This must never fail the install. Every path exits 0.
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

function skip(why) {
  if (process.env.SERVER_STUDIO_DEBUG) console.log('server-studio: skipped setup (' + why + ')');
  process.exit(0);
}

if (process.env.CI) skip('CI');
// A dependency install must not touch /Applications or ~/.claude.
if (process.env.npm_config_global !== 'true') skip('not a global install');
// Do not run while developing this repo itself.
if (process.env.INIT_CWD && path.resolve(process.env.INIT_CWD) === path.resolve(__dirname, '..')) {
  skip('local checkout');
}

try {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'install'], {
    encoding: 'utf8',
  });
  console.log(out.trim());
} catch (e) {
  // Setup failing is not a reason for `npm install` to fail. Say so and move on.
  console.log(
    'server-studio: could not finish setup automatically.\n' +
    '  Run it yourself with:  server-studio install\n' +
    '  Reason: ' + (e && e.message ? e.message.split('\n')[0] : 'unknown')
  );
}
process.exit(0);
