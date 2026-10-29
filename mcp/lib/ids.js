// The extension ids a Chromium host manifest lets in: the Chrome Web Store copy (Edge, Brave, Vivaldi and Arc install
// from it too), plus copies named with --extension-id or --dev <folder>, and any already in an installed manifest.
// Firefox lets in Glaze by its add-on id instead.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STORE = 'jmmaeoajomodnbnlmdikjooalmcilooh';
const FIREFOX = 'glaze@frostdev.io';
const ID = /^[a-p]{32}$/;
const ORIGIN = /^chrome-extension:\/\/([a-p]{32})\/$/;

const usage = (message) => Object.assign(new Error(message), { code: 'USAGE' });
const valid = (id) => typeof id === 'string' && ID.test(id);
const origin = (id) => `chrome-extension://${id}/`;
// The id Chrome gives a folder loaded unpacked: sha256 of its real path, the first 32 hex digits mapped onto a–p.
// On Windows Chrome hashes the path as UTF-16, so --dev is POSIX only there.
const devId = (p) => [...crypto.createHash('sha256').update(p).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const fromManifest = (m) => (m && Array.isArray(m.allowed_origins) ? m.allowed_origins : [])
  .map((o) => (typeof o === 'string' ? ORIGIN.exec(o) : null)).filter(Boolean).map((x) => x[1]);
// The store id first, then each other valid id once, in the order given.
const merge = (...lists) => [...new Set([STORE, ...lists.flat().filter(valid)])];

// --extension-id <id> and --dev <folder>, each repeatable, as `--flag value` or `--flag=value`; the rest comes back.
const fromArgs = (args, { platform = process.platform, realpath = fs.realpathSync } = {}) => {
  const ids = [], rest = [];
  for (let i = 0; i < args.length; i++) {
    const m = /^(--extension-id|--dev)(?:=(.*))?$/s.exec(args[i]);
    if (!m) { rest.push(args[i]); continue; }
    const v = m[2] !== undefined ? m[2] : args[++i];
    if (!v) throw usage(`${m[1]} needs a value`);
    if (m[1] === '--extension-id') {
      if (!valid(v)) throw usage(`not an extension id: ${v} (32 letters a to p, as chrome://extensions shows it)`);
      ids.push(v);
    } else {
      if (platform === 'win32') throw usage('--dev works on macOS and Linux; on Windows use --extension-id with the id chrome://extensions shows');
      let real;
      try { real = realpath(path.resolve(v)); } catch { throw usage(`no such folder: ${v}`); }
      if (!fs.statSync(real).isDirectory()) throw usage(`not a folder: ${v}`);
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(path.join(real, 'manifest.json'), 'utf8')); }
      catch (e) { if (e.code !== 'ENOENT') throw usage(`cannot read manifest.json in ${v}`); }
      if (manifest && Object.hasOwn(manifest, 'key')) throw usage('this manifest has a key; use --extension-id with the id chrome://extensions shows');
      ids.push(devId(real));
    }
  }
  return { ids, rest };
};

module.exports = { STORE, FIREFOX, valid, origin, devId, fromManifest, merge, fromArgs };
