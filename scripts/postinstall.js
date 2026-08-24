#!/usr/bin/env node
// npm only puts the command on PATH. Setting up the app and the skill writes outside
// the package, so it stays an explicit step rather than a silent side effect of install.
// This just makes sure nobody is left wondering why nothing appeared.
'use strict';

const path = require('path');

// Quiet in CI, and quiet while developing this repo itself.
if (process.env.CI) process.exit(0);
if (process.env.INIT_CWD && path.resolve(process.env.INIT_CWD) === path.resolve(__dirname, '..')) {
  process.exit(0);
}
// npx runs the command straight after installing, so the hint would be noise.
if ((process.env.npm_command === 'exec') || /_npx/.test(__dirname)) process.exit(0);

console.log(`
Server Studio: the command is installed, but nothing is set up yet.

Finish with:
  server-studio install

That adds the app and the Claude Code skill. See what it will do first with:
  server-studio install --dry-run
`);
