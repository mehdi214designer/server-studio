#!/usr/bin/env node
// Builds dist/server-studio.plugin from skill/ + plugin/, so the plugin copy of the
// skill can never drift from the source in skill/.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'server-studio.plugin');

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-plugin-'));
const skillDir = path.join(stage, 'skills', 'server-studio');
fs.mkdirSync(skillDir, { recursive: true });

fs.cpSync(path.join(ROOT, 'skill'), skillDir, { recursive: true });
fs.cpSync(path.join(ROOT, 'plugin'), stage, { recursive: true });

fs.mkdirSync(DIST, { recursive: true });
fs.rmSync(OUT, { force: true });
// -r zips the staged tree; the plugin format is a plain zip.
execFileSync('zip', ['-qr', OUT, '.', '-x', '.DS_Store'], { cwd: stage });
fs.rmSync(stage, { recursive: true, force: true });

console.log('built ' + path.relative(ROOT, OUT));
