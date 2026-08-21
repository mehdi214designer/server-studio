#!/usr/bin/env node
// Builds dist/server-studio.plugin from skill/ + plugin/, so the plugin copy of the
// skill can never drift from the source in skill/.
//
// The archive is written with Node's zlib rather than the `zip` binary, so this
// works the same on Windows, where no such binary exists.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'server-studio.plugin');

/* ---------- zip writing ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Zip stores timestamps as DOS date/time. A fixed value keeps builds reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const isDir = e.name.endsWith('/');
    const raw = isDir ? Buffer.alloc(0) : e.data;
    const deflated = isDir ? Buffer.alloc(0) : zlib.deflateRawSync(raw, { level: 9 });
    // Only use compression when it actually helps.
    const useDeflate = !isDir && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra field length
    locals.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);              // version made by
    cen.writeUInt16LE(20, 6);              // version needed
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);              // extra
    cen.writeUInt16LE(0, 32);              // comment
    cen.writeUInt16LE(0, 34);              // disk number
    cen.writeUInt16LE(0, 36);              // internal attrs
    cen.writeUInt32LE(isDir ? 0x41ff0010 : 0x81a40000, 38); // unix mode + dir flag
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

/* ---------- collect what goes in ---------- */
function walk(dir, prefix, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === '.DS_Store') continue;
    const full = path.join(dir, name);
    // Zip paths always use forward slashes, whatever the host OS does.
    const rel = prefix + name;
    if (fs.statSync(full).isDirectory()) {
      out.push({ name: rel + '/' });
      walk(full, rel + '/', out);
    } else {
      out.push({ name: rel, data: fs.readFileSync(full) });
    }
  }
  return out;
}

const entries = [];
// plugin/ supplies the metadata, skill/ supplies the one true copy of the skill.
walk(path.join(ROOT, 'plugin'), '', entries);
entries.push({ name: 'skills/' }, { name: 'skills/server-studio/' });
walk(path.join(ROOT, 'skill'), 'skills/server-studio/', entries);

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(OUT, makeZip(entries));
console.log('built ' + path.relative(ROOT, OUT) + ' (' + entries.length + ' entries)');
