// Mod bundles: a .glazemod zip holding mod.json, the mod's files
// and mod.sig, the author's Ed25519 signature over all of them. Every byte here is someone else's: the zip is read within
// hard limits before anything is inflated, every path and file type is checked, mod.json must pass a strict check
// unchanged, and the signature covers every file. Nothing here runs a mod's code.
// Also the author's side (key, backup file, pack), glazemod1: codes, the install and update rules (plan) and the worker's
// 'glaze:mods' operations (change), which keep mods in storage.local: `mod:<id>` records and the `mods` index.
// Classic script for the worker, the editor and node.
var GZ_MODBUNDLE = globalThis.GZ_MODBUNDLE || (() => {
  const S = globalThis.crypto.subtle;
  const te = new TextEncoder();
  const Z = () => (typeof GZ_ZIP !== 'undefined' ? GZ_ZIP : require('./zip.js'));
  const X = () => (typeof GZ_XPARTS !== 'undefined' ? GZ_XPARTS : require('./lookparts.js'));
  const MX = () => (typeof GZ_MX !== 'undefined' ? GZ_MX : require('./motionx.js'));
  const W = () => (typeof GZ_WIDGETS !== 'undefined' ? GZ_WIDGETS : require('./widgets.js'));
  // The packs a mod carries are read with lib/media.js; the worker brings it on first use.
  const MEDIA = () => (typeof GZ_MEDIA !== 'undefined' ? GZ_MEDIA : typeof require === 'function' ? require('./media.js') : (importScripts('media.js'), GZ_MEDIA));
  const WG = () => (typeof GZ_MODWIDGET !== 'undefined' ? GZ_MODWIDGET : require('./modwidget.js'));

  // Files in a bundle, bytes of them all (mod.json and mod.sig too), bytes of .js, bytes of mod.json, a path's characters
  // and folders, the zip itself (the files plus room for headers), and a glazemod1: code's characters.
  const CAP = { files: 256, total: 2 << 20, code: 256 << 10, manifest: 64 << 10, path: 200, depth: 8, archive: (2 << 20) + (256 << 10), text: 64 << 10 };

  // why is English with {placeholders}; the editor shows it through t().
  const fail = (why, vars = {}) => { throw Object.assign(new Error(why.replace(/\{(\w+)\}/g, (_, k) => vars[k])), { why, vars }); };
  const damaged = () => fail("That mod file is damaged, or isn't a Glaze mod.");
  const bad = (field) => fail("That mod's mod.json has a value Glaze can't use ({field}).", { field });
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const own = (o, k) => Object.hasOwn(o, k);

  const std = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unstd = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64u = (bytes) => std(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => unstd(s.replace(/-/g, '+').replace(/_/g, '/'));
  // Exactly one spelling per value, so two strings never stand for the same key or signature.
  const canon = (s, n) => typeof s === 'string' && s.length === Math.ceil(n * 4 / 3) && /^[\w-]+$/.test(s) && b64u(unb64u(s)) === s;
  const keyOk = (s) => canon(s, 32);
  const latin1 = (b) => String.fromCharCode(...b);
  const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };
  const sha = async (b) => new Uint8Array(await S.digest('SHA-256', b));
  const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
  const base32 = (bytes) => {
    let out = '', v = 0, n = 0;
    for (const b of bytes) {
      v = ((v & 31) << 8) | b;
      for (n += 8; n >= 5; n -= 5) out += 'abcdefghijklmnopqrstuvwxyz234567'[(v >>> (n - 5)) & 31];
    }
    return n ? out + 'abcdefghijklmnopqrstuvwxyz234567'[(v << (5 - n)) & 31] : out;
  };

  // ---- the zip ---------------------------------------------------------------------------------------------------
  // Store and deflate entries, no zip64, no encryption, no archive comment (so the end record is the last 22 bytes and
  // nothing is searched for). Sizes come from the central directory and are capped before anything is inflated; each
  // inflate stops at its declared size and must land on it exactly, with its CRC. Entries may not overlap, which is
  // how a small zip names the same compressed bytes thousands of times. → [[name, bytes]] in the archive's order.
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const tooBig = () => fail('That mod is too big: a mod holds at most 2 MiB in 256 files, 256 KiB of it code.');
  const extras = (bytes, at, length) => {
    const end = at + length;
    if (end > bytes.length) damaged();
    while (at < end) {
      // No ZIP64 or Unicode path overrides: all readers must see the same bounded ASCII paths.
      if (at + 4 > end || [1, 0x7075].includes(u16(bytes, at))) damaged();
      at += 4 + u16(bytes, at + 2);
      if (at > end) damaged();
    }
  };
  const unzip = async (bytes) => {
    if (!(bytes instanceof Uint8Array)) damaged();
    if (bytes.length > CAP.archive) tooBig();
    const end = bytes.length - 22;
    if (end < 0 || u32(bytes, end) !== 0x06054b50 || u16(bytes, end + 20)) damaged();
    const count = u16(bytes, end + 10), cdSize = u32(bytes, end + 12), cdAt = u32(bytes, end + 16);
    if (u16(bytes, end + 4) || u16(bytes, end + 6) || u16(bytes, end + 8) !== count || cdAt + cdSize !== end) damaged();
    if (count > CAP.files) tooBig();
    const entries = [];
    let o = cdAt, declared = 0;
    for (let i = 0; i < count; i++) {
      if (o + 46 > end || u32(bytes, o) !== 0x02014b50) damaged();
      const flags = u16(bytes, o + 8), method = u16(bytes, o + 10), csize = u32(bytes, o + 20), size = u32(bytes, o + 24), nl = u16(bytes, o + 28);
      const at = u32(bytes, o + 42), name = bytes.subarray(o + 46, o + 46 + nl);
      // Only the option bits deflate may set, a trailing data descriptor and UTF-8 names; never encryption.
      if (flags & ~0x080e || (method !== 0 && method !== 8) || (method === 0 && csize !== size) || u16(bytes, o + 34) || nl > CAP.path + 1
        || [csize, size, at].includes(0xffffffff)) damaged();
      const extra = u16(bytes, o + 30), comment = u16(bytes, o + 32);
      if (o + 46 + nl + extra + comment > end) damaged();
      extras(bytes, o + 46 + nl, extra);
      entries.push({ name, flags, method, crc: u32(bytes, o + 16), csize, size, at });
      declared += size;
      o += 46 + nl + extra + comment;
    }
    if (o !== end) damaged();
    if (declared > CAP.total) tooBig();
    const spans = [];
    for (const x of entries) {
      const a = x.at;
      if (a + 30 > cdAt || u32(bytes, a) !== 0x04034b50 || u16(bytes, a + 6) !== x.flags || u16(bytes, a + 8) !== x.method) damaged();
      const start = a + 30 + u16(bytes, a + 26) + u16(bytes, a + 28);
      // The local name must be the central one: two readers of the same zip never see different files.
      if (u16(bytes, a + 26) !== x.name.length || bytes.subarray(a + 30, a + 30 + x.name.length).some((c, i) => c !== x.name[i]) || start + x.csize > cdAt) damaged();
      extras(bytes, a + 30 + x.name.length, u16(bytes, a + 28));
      const fields = [x.crc, x.csize, x.size];
      if (fields.some((v, i) => { const local = u32(bytes, a + 14 + i * 4); return local !== v && (!(x.flags & 8) || local !== 0); })) damaged();
      let finish = start + x.csize;
      if (x.flags & 8) {
        const matches = (at) => at + 12 <= cdAt && fields.every((v, i) => u32(bytes, at + i * 4) === v);
        if (u32(bytes, finish) === 0x08074b50 && matches(finish + 4)) finish += 16;
        else if (matches(finish)) finish += 12;
        else damaged();
      }
      spans.push([a, finish]);
      x.data = bytes.subarray(start, start + x.csize);
    }
    // The archive starts with its first entry (nothing hides in front of it), and no two entries share bytes.
    spans.sort((p, q) => p[0] - q[0]);
    if (spans.length && spans[0][0] !== 0) damaged();
    for (let i = 1; i < spans.length; i++) if (spans[i][0] !== spans[i - 1][1]) damaged();
    if ((spans.at(-1)?.[1] || 0) !== cdAt) damaged();
    const named = new Map();
    for (const x of entries) {
      x.path = latin1(x.name);
      const folder = x.path.endsWith('/'), p = folder ? x.path.slice(0, -1) : x.path;
      if (!pathOk(p)) {
        if (folder) damaged();
        fail("That mod has a file Glaze won't open: {path}.", { path: p.slice(0, 80) });
      }
      if (named.has(p.toLowerCase())) fail('That mod has two files named {path}.', { path: p });
      named.set(p.toLowerCase(), folder);
    }
    for (const p of named.keys()) for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) {
      if (named.get(p.slice(0, i)) === false) fail('That mod has two files named {path}.', { path: p.slice(0, i) });
    }
    const out = [];
    for (const x of entries) {
      const name = x.path;
      // A folder entry, as zip tools write them: nothing in it, and a path like any other.
      if (name.endsWith('/') && x.size) damaged();
      const data = x.method === 0 ? x.data.slice() : await X().inflate(x.data, x.size).catch(damaged);
      if (data.length !== x.size || Z().crc32(data) !== x.crc) damaged();
      if (!name.endsWith('/')) out.push([name, data]);
    }
    return out;
  };

  // The zip Glaze writes: sorted paths, stored, one fixed date, so the same files are always the same bytes.
  const DATE = new Date(1980, 0, 1);
  const archive = (files) => cat(...Z().zip(Object.keys(files).sort().map((name) => ({ name, data: files[name], date: DATE }))));

  // ---- files -----------------------------------------------------------------------------------------------------
  // Paths: ASCII letters, digits, _ - and dots, folders by '/', no part starting with a dot (so no '.', '..' or hidden
  // files), nothing absolute, no backslashes or drive letters. Kinds by extension, checked against their bytes: text is
  // UTF-8 without control characters (which also keeps a zip or gzip from hiding in a .txt), pictures and fonts start as
  // their format does. No SVG (it can carry script), no archives, no wasm.
  const PATH = /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/;
  const pathOk = (p) => p.length <= CAP.path && PATH.test(p) && p.split('/').length <= CAP.depth;
  const TYPES = {
    js: 'text/javascript', html: 'text/html', css: 'text/css', json: 'application/json', txt: 'text/plain', md: 'text/markdown',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', woff2: 'font/woff2',
  };
  const ext = (p) => (/\.([a-z0-9]+)$/i.exec(p.slice(p.lastIndexOf('/') + 1))?.[1] || '').toLowerCase();
  const type = (p) => (own(TYPES, ext(p)) ? TYPES[ext(p)] : null);
  const ascii = (b, from, to) => latin1(b.subarray(from, to));
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const textOk = (b) => { try { return !/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(utf8.decode(b)); } catch { return false; } };
  const MAGIC = {
    png: (b) => ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n',
    jpeg: (b) => ascii(b, 0, 3) === '\xff\xd8\xff',
    gif: (b) => /^GIF8[79]a$/.test(ascii(b, 0, 6)),
    webp: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
    avif: (b) => ascii(b, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(b, 8, 12)),
    woff2: (b) => ascii(b, 0, 4) === 'wOF2',
  };
  const kindOk = (p, b) => {
    const e = ext(p);
    if (!own(TYPES, e)) return false;
    return TYPES[e].startsWith('text/') || e === 'json' ? textOk(b) : MAGIC[e === 'jpg' ? 'jpeg' : e](b);
  };
  // [[path, bytes]] → { path: bytes }, or a refusal naming the file.
  const check = (list) => {
    if (!Array.isArray(list) || list.length > CAP.files) tooBig();
    const out = {}, seen = new Set();
    let total = 0, code = 0;
    for (const [p, b] of list) {
      const name = String(p).slice(0, 80);
      if (typeof p !== 'string' || !pathOk(p) || !(b instanceof Uint8Array)) fail("That mod has a file Glaze won't open: {path}.", { path: name });
      if (seen.has(p.toLowerCase())) fail('That mod has two files named {path}.', { path: name });
      seen.add(p.toLowerCase());
      if (p === 'mod.sig' ? b.length !== 86 || !canon(latin1(b), 64) : !kindOk(p, b)) fail("That mod has a file of a kind mods can't carry: {path}.", { path: name });
      total += b.length;
      if (ext(p) === 'js') code += b.length;
      out[p] = b;
    }
    // A file named like another's folder ('a.js' and 'a.js/b.png'): no folder could hold both.
    for (const p of seen) for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) if (seen.has(p.slice(0, i))) fail('That mod has two files named {path}.', { path: p.slice(0, i) });
    if (total > CAP.total || code > CAP.code) tooBig();
    if (!own(out, 'mod.json')) fail('That mod has no mod.json.');
    if (out['mod.json'].length > CAP.manifest) tooBig();
    return out;
  };

  // ---- mod.json --------------------------------------------------------------------------------------------------
  // Strict: every key known, every value exactly as Glaze would keep it, or the mod is refused naming the field. Nothing is
  // trimmed or dropped. Returns the manifest (plain JSON data, so the stored copy is the signed one).
  const keys = (o, allowed, field, req = []) => { if (!isObj(o) || Object.keys(o).some((k) => !allowed.includes(k)) || req.some((k) => !own(o, k))) bad(field); };
  // One line of text: no runs of spaces, no edges, no control or direction-changing characters, at most `max` characters.
  const line = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max * 2 && v === v.replace(/\s+/g, ' ').trim()
    && !/[\p{Cc}\p{Bidi_Control}]/u.test(v) && [...v].length <= max;
  const slug = (name) => String(name).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  // Semantic versions without build metadata (which wouldn't order): 1.2.3 and 1.2.3-beta.2, numbers up to six digits.
  const ID_PART = '(?:0|[1-9]\\d{0,5}|\\d*[A-Za-z-][\\dA-Za-z-]*)';
  const SEMVER = new RegExp(`^(0|[1-9]\\d{0,5})\\.(0|[1-9]\\d{0,5})\\.(0|[1-9]\\d{0,5})(?:-(${ID_PART}(?:\\.${ID_PART})*))?$`);
  const ver = (v) => { const m = typeof v === 'string' && v.length <= 40 && SEMVER.exec(v); return m ? [+m[1], +m[2], +m[3], m[4] ? m[4].split('.') : null] : null; };
  // -1, 0 or 1, as semver orders them: a release after its pre-releases, numeric parts by value and before words.
  const compare = (a, b) => {
    const [x, y] = [ver(a), ver(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    if (!x[3] || !y[3]) return !x[3] === !y[3] ? 0 : x[3] ? -1 : 1;
    for (let i = 0; ; i++) {
      const [p, q] = [x[3][i], y[3][i]];
      if (p === undefined || q === undefined) return p === q ? 0 : p === undefined ? -1 : 1;
      if (p === q) continue;
      const [pn, qn] = [/^\d+$/.test(p), /^\d+$/.test(q)];
      if (pn && qn) return +p < +q ? -1 : 1;
      if (pn !== qn) return pn ? -1 : 1;
      return p < q ? -1 : 1;
    }
  };

  // Personal data: these grants never come with a page of the mod's own.
  const DATA = ['courses', 'todo', 'grades'];
  const HOSTS_MAX = 8;
  // A DNS name as a browser asks for it: lowercase ASCII (punycode for the rest), two labels at least, a top label that
  // starts with a letter (so never an IPv4 address), no port, no wildcard, no trailing dot.
  const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
  const permissions = (v) => {
    if (!Array.isArray(v) || v.length > DATA.length + HOSTS_MAX) bad('permissions');
    const seen = new Set();
    v.forEach((p, i) => {
      keys(p, ['id', 'why'], `permissions.${i}`, ['id', 'why']);
      const host = typeof p.id === 'string' && p.id.startsWith('network:') ? p.id.slice(8) : null;
      if (!(DATA.includes(p.id) || (host && HOST.test(host))) || seen.has(p.id)) bad(`permissions.${i}.id`);
      if (!line(p.why, 280)) bad(`permissions.${i}.why`);
      seen.add(p.id);
    });
    if (v.filter((p) => p.id.startsWith('network:')).length > HOSTS_MAX) bad('permissions');
  };
  const isFile = (files, p, e) => typeof p === 'string' && own(files, p) && ext(p) === e;
  // Slots: tiles and rail widgets drawn from the mod's Worker (a component tree and a canvas), or, for a mod without data
  // permissions, an HTML file of its own (frame UI), or, with no code at all, `blocks` Glaze draws itself (lib/modwidget.js).
  // nav and background: null, {} (drawn from the Worker) or { file }.
  const SLOT_ID = /^[a-z][a-z0-9-]{0,31}$/;
  const PICTURES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'];
  const ui = (v, files) => {
    keys(v, ['tiles', 'rail', 'nav', 'background'], 'ui');
    const file = (o, f) => { if (own(o, 'file') && !isFile(files, o.file, 'html')) bad(`${f}.file`); };
    for (const [k, max] of [['tiles', 8], ['rail', 4]]) {
      if (!own(v, k)) continue;
      if (!Array.isArray(v[k]) || v[k].length > max) bad(`ui.${k}`);
      const ids = new Set();
      v[k].forEach((s, i) => {
        const f = `ui.${k}.${i}`, tile = k === 'tiles';
        keys(s, ['id', 'name', 'file', 'blocks', ...(tile ? ['sizes'] : [])], f, ['id', 'name', ...(tile ? ['sizes'] : [])]);
        if (typeof s.id !== 'string' || !SLOT_ID.test(s.id) || ids.has(s.id)) bad(`${f}.id`);
        ids.add(s.id);
        if (!line(s.name, 40)) bad(`${f}.name`);
        file(s, f);
        if (own(s, 'blocks')) {
          // Pictures are the mod's own files; the blocks must be exactly what the cleaner would keep.
          const b = own(s, 'file') ? null : WG().blocks(s.blocks);
          if (!b || !WG().same(b, s.blocks) || WG().images(b).some((p) => !own(files, p) || !PICTURES.includes(ext(p)))) bad(`${f}.blocks`);
        }
        if (tile && (!Array.isArray(s.sizes) || !s.sizes.length || s.sizes.some((z) => !W().SIZES.includes(z)) || new Set(s.sizes).size !== s.sizes.length)) bad(`${f}.sizes`);
      });
    }
    for (const k of ['nav', 'background']) {
      if (!own(v, k) || v[k] === null) continue;
      keys(v[k], ['file'], `ui.${k}`);
      file(v[k], `ui.${k}`);
    }
  };
  // What a mod may take over from Glaze: the background, the nav, a moment's effect or a built-in tile.
  const replaceOk = (r) => typeof r === 'string' && (['bg', 'nav'].includes(r) || (r.startsWith('effect:') && MX().EVENTS.includes(r.slice(7)))
    || (r.startsWith('tile:') && W().TILES.includes(r.slice(5))));
  // The settings Glaze draws in the editor for a mod: each type's keys, then the ones it must have.
  const SETTING = { toggle: [['default'], []], choice: [['options', 'default'], ['options']], number: [['min', 'max', 'step', 'default'], ['min', 'max']], text: [['max', 'default'], []], color: [['default'], []] };
  const num = (x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e9;
  const settings = (v) => {
    if (!Array.isArray(v) || v.length > 32) bad('settings');
    const ids = new Set();
    v.forEach((s, i) => {
      const f = `settings.${i}`;
      if (!isObj(s) || typeof s.type !== 'string' || !own(SETTING, s.type)) bad(`${f}.type`);
      const [more, req] = SETTING[s.type];
      keys(s, ['id', 'type', 'label', ...more], f, ['id', 'type', 'label', ...req]);
      if (typeof s.id !== 'string' || !SLOT_ID.test(s.id) || ids.has(s.id)) bad(`${f}.id`);
      ids.add(s.id);
      if (!line(s.label, 60)) bad(`${f}.label`);
      const has = (k) => own(s, k);
      const ok = {
        toggle: () => !has('default') || typeof s.default === 'boolean',
        choice: () => Array.isArray(s.options) && s.options.length >= 2 && s.options.length <= 16 && s.options.every((o) => line(o, 40))
          && new Set(s.options).size === s.options.length && (!has('default') || s.options.includes(s.default)),
        number: () => num(s.min) && num(s.max) && s.min < s.max && (!has('step') || (num(s.step) && s.step > 0))
          && (!has('default') || (num(s.default) && s.default >= s.min && s.default <= s.max)),
        text: () => (!has('max') || (Number.isInteger(s.max) && s.max >= 1 && s.max <= 500)) && (!has('default') || (typeof s.default === 'string'
          && (s.default === '' || line(s.default, has('max') ? s.max : 500)))),
        color: () => !has('default') || (typeof s.default === 'string' && /^#[0-9a-f]{6}$/.test(s.default)),
      }[s.type];
      if (!ok()) bad(f);
    });
  };
  const hasBlocks = (m) => [...(m.ui?.tiles || []), ...(m.ui?.rail || [])].some((s) => own(s, 'blocks'));
  const MANIFEST = ['glaze', 'name', 'version', 'author', 'permissions', 'parts', 'ui', 'hooks', 'replaces', 'settings', 'packs'];
  // raw: mod.json as parsed; files: the bundle's { path: bytes }, for the files mod.json names.
  const clean = (raw, files) => {
    keys(raw, MANIFEST, 'mod.json', ['glaze', 'name', 'version', 'author']);
    if (raw.glaze !== 1) bad('glaze');
    if (!line(raw.name, 40) || !slug(raw.name)) bad('name');
    if (!ver(raw.version)) bad('version');
    keys(raw.author, ['name', 'key'], 'author', ['name', 'key']);
    if (!line(raw.author.name, 40)) bad('author.name');
    if (!keyOk(raw.author.key)) bad('author.key');
    if (own(raw, 'permissions')) permissions(raw.permissions);
    if (own(raw, 'parts')) { const p = X().clean(raw.parts); if (!p || !X().same(p, raw.parts)) bad('parts'); }
    if (own(raw, 'ui')) {
      ui(raw.ui, files);
      // A widget's data comes with its permission, declared and explained like any other, and asks for no more than its
      // blocks show: no network host, which it could do nothing with, and no data it never draws.
      if (hasBlocks(raw)) {
        const want = [...new Set([...(raw.ui.tiles || []), ...(raw.ui.rail || [])].flatMap((s) => (own(s, 'blocks') ? WG().needs(s.blocks) : [])))].sort();
        if (want.join() !== (raw.permissions || []).map((p) => p.id).sort().join()) bad('permissions');
      }
    }
    if (own(raw, 'hooks') && !isFile(files, raw.hooks, 'js')) bad('hooks');
    if (own(raw, 'replaces') && (!Array.isArray(raw.replaces) || !raw.replaces.every(replaceOk) || new Set(raw.replaces).size !== raw.replaces.length)) bad('replaces');
    if (own(raw, 'settings')) settings(raw.settings);
    // Stickers and pets it carries, as lib/media.js cleans them; each file is one of the bundle's.
    if (own(raw, 'packs')) { const p = MEDIA().packs(raw.packs, (f) => own(files, f)); if (!p || !X().same(p, raw.packs)) bad('packs'); }
    // A declarative widget is the whole of a mod without code: no hooks and no page of any slot's own.
    if (hasBlocks(raw) && (own(raw, 'hooks') || [...(raw.ui.tiles || []), ...(raw.ui.rail || []), raw.ui.nav, raw.ui.background].some((s) => s && own(s, 'file')))) bad('ui');
    // A mod that reads personal data never has a page of its own: it has no HTML at all.
    if ((raw.permissions || []).some((p) => DATA.includes(p.id)) && Object.keys(files).some((p) => ext(p) === 'html')) bad('ui');
    return raw;
  };
  // What a manifest can do that the student is asked about: its permissions, and 'frame' when it has a page of its own
  // (which can contact other sites).
  const caps = (m) => {
    const slots = [...(m.ui?.tiles || []), ...(m.ui?.rail || []), m.ui?.nav, m.ui?.background];
    return [...(m.permissions || []).map((p) => p.id), ...(slots.some((s) => s?.file) ? ['frame'] : [])];
  };

  // Display-only manifest for install prompts and editor labels; the signed manifest and files stay byte-for-byte intact.
  const prompt = (v) => typeof v === 'string' ? v.replace(/[\p{Cf}\p{Bidi_Control}]/gu, '') : Array.isArray(v) ? v.map(prompt)
    : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, prompt(x)])) : v;

  // ---- hashes, ids and the signature -----------------------------------------------------------------------------
  // bundleHash = SHA-256 of the JSON of [[path, base64url(SHA-256(file))], …] for every file but mod.sig, by path.
  const digest = async (files) => {
    const list = [];
    for (const p of Object.keys(files).filter((p) => p !== 'mod.sig').sort()) list.push([p, b64u(await sha(files[p]))]);
    return sha(te.encode(JSON.stringify(list)));
  };
  const message = (hash) => te.encode(`glaze-mod-1|${b64u(hash)}`);
  // The first 16 base32 characters of SHA-256(raw author key ‖ the name's slug): an author's mod keeps its id through
  // every version, and nobody else can make one with that id.
  const modId = async (key, name) => base32(await sha(cat(key, te.encode(slug(name))))).slice(0, 16);

  // Probe once with the Ed25519 base point; every install, signed or dev, requires the browser's crypto.
  let edSupport;
  const canSign = () => (edSupport ||= S.importKey('raw', Uint8Array.from([0x58, ...Array(31).fill(0x66)]), 'Ed25519', false, ['verify'])
    .then(() => true, () => false));
  const requireEd = async () => { if (!await canSign()) fail('Update your browser to install Glaze mods. This browser does not support WebCrypto Ed25519.'); };
  const verify = async (pub, msg, sig) => {
    await requireEd();
    try { return await S.verify('Ed25519', await S.importKey('raw', pub, 'Ed25519', false, ['verify']), sig, msg); } catch { return false; }
  };

  // ---- reading a bundle ------------------------------------------------------------------------------------------
  // [[path, bytes]] (an unpacked zip, or a mod folder in dev mode) → { id, manifest, files, hash, key, version, signed }.
  // A bundle without mod.sig is unsigned (dev); one with a mod.sig that doesn't verify is refused.
  const bundle = async (list) => {
    await requireEd();
    const files = check(list);
    let raw;
    try { raw = JSON.parse(utf8.decode(files['mod.json'])); } catch { fail("That mod's mod.json is damaged."); }
    if (!isObj(raw)) bad('mod.json');
    if (!isObj(raw.author) || !keyOk(raw.author.key)) bad('author.key');
    const key = unb64u(raw.author.key), hash = await digest(files);
    const signed = own(files, 'mod.sig');
    if (signed && !await verify(key, message(hash), unb64u(latin1(files['mod.sig'])))) fail("That mod's signature doesn't match its files: it was changed after its author signed it.");
    const manifest = clean(raw, files);
    return { id: await modId(key, manifest.name), manifest, prompt: prompt(manifest), files, hash: b64u(hash), key: raw.author.key, version: manifest.version, signed };
  };
  const read = async (bytes) => bundle(await unzip(bytes));

  // glazemod1: + base64url(deflate-raw(the .glazemod zip)), at most 64 KiB of text: the same bundle, pasteable.
  const PREFIX = 'glazemod1:';
  const encode = async (bytes) => {
    const code = PREFIX + b64u(await X().deflate(bytes));
    if (code.length > CAP.text) fail('This mod is too big for a code. Share its .glazemod file instead.');
    return code;
  };
  // A code → the zip's bytes (read() checks them). A short code can't inflate past a zip's cap.
  const decode = async (text) => {
    if (typeof text !== 'string' || text.length > CAP.text * 2) fail('That mod code is damaged.');
    const t = text.replace(/\s+/g, '');
    if (!t.startsWith(PREFIX)) fail("That isn't a Glaze mod code. Mod codes start with glazemod1:");
    const body = t.slice(PREFIX.length);
    if (t.length > CAP.text || !/^[\w-]+$/.test(body)) fail('That mod code is damaged.');
    try { return await X().inflate(unb64u(body), CAP.archive); } catch { return fail('That mod code is damaged, cut short or too big.'); }
  };

  // ---- the author's side -----------------------------------------------------------------------------------------
  // The author key is an Ed25519 key kept as a JWK in storage.local `modAuthor` (the editor writes it). It has to be
  // extractable: a lost key means no more updates, and a non-extractable key could never be saved to a backup file. So
  // it is exactly as safe as storage.local, like the share-session keys. Signing needs WebCrypto's Ed25519 (Chrome 137).
  const jwkOk = (j) => isObj(j) && j.kty === 'OKP' && j.crv === 'Ed25519' && keyOk(j.x) && keyOk(j.d);
  const signer = (j) => S.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', d: j.d, x: j.x }, 'Ed25519', false, ['sign']);
  const makeKey = async () => {
    const { privateKey } = await S.generateKey('Ed25519', true, ['sign', 'verify']);
    const { kty, crv, d, x } = await S.exportKey('jwk', privateKey);
    return { kty, crv, d, x };
  };
  // The private half must sign for the public half it names, or the key is refused.
  const keyPair = async (j) => {
    if (!jwkOk(j)) return false;
    try {
      const probe = te.encode('glaze-author-key-check');
      return await verify(unb64u(j.x), probe, new Uint8Array(await S.sign('Ed25519', await signer(j), probe)));
    } catch { return false; }
  };
  // The backup file: { glazeAuthorKey: 1, key } or, with a passphrase, the key under AES-GCM with a PBKDF2-SHA-256 key,
  // the public key in the clear (so the editor can say whose it is) and bound in as associated data.
  const ITER = 600000, ITER_RANGE = [100000, 10000000];
  const passKey = async (pass, salt, iterations) => S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    await S.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const aad = (x) => te.encode(`glaze-author-key-1|${x}`);
  const backup = async (j, pass = '') => {
    if (!await keyPair(j)) fail('That author key is damaged.');
    const key = { kty: 'OKP', crv: 'Ed25519', d: j.d, x: j.x };
    if (!pass) return JSON.stringify({ glazeAuthorKey: 1, key }, null, 2);
    const salt = rand(16), iv = rand(12);
    const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv, additionalData: aad(key.x) }, await passKey(pass, salt, ITER), te.encode(JSON.stringify(key))));
    return JSON.stringify({ glazeAuthorKey: 1, x: key.x, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITER, salt: b64u(salt) }, iv: b64u(iv), ct: b64u(ct) }, null, 2);
  };
  const restore = async (text, pass = '') => {
    let f;
    try { f = typeof text === 'string' && text.length <= 4096 ? JSON.parse(text) : null; } catch { f = null; }
    if (!isObj(f) || f.glazeAuthorKey !== 1) fail("That isn't a Glaze author key file.");
    let key = f.key;
    if (own(f, 'ct')) {
      const k = f.kdf;
      if (!keyOk(f.x) || !isObj(k) || k.name !== 'PBKDF2' || k.hash !== 'SHA-256' || !Number.isInteger(k.iterations) || k.iterations < ITER_RANGE[0]
        || k.iterations > ITER_RANGE[1] || !canon(k.salt, 16) || !canon(f.iv, 12) || typeof f.ct !== 'string' || !/^[\w-]{1,1024}$/.test(f.ct)) fail('That author key file is damaged.');
      if (!pass) fail('That author key file needs its passphrase.');
      try {
        key = JSON.parse(utf8.decode(await S.decrypt({ name: 'AES-GCM', iv: unb64u(f.iv), additionalData: aad(f.x) }, await passKey(pass, unb64u(k.salt), k.iterations), unb64u(f.ct))));
      } catch { fail("That passphrase doesn't open this key file."); }
      if (key?.x !== f.x) fail('That author key file is damaged.');
    }
    if (!await keyPair(key)) fail('That author key file is damaged.');
    return { kty: 'OKP', crv: 'Ed25519', d: key.d, x: key.x };
  };
  // files: { path: Uint8Array } without mod.json and mod.sig; manifest: mod.json's object (author.key is the signing
  // key's, filled in when left out); j: the author's JWK. → read()'s answer plus `bytes`, the .glazemod file. What
  // Glaze would refuse to install is refused here, so a packed mod always reads back.
  const pack = async (files, manifest, j) => {
    if (!await keyPair(j)) fail('That author key is damaged.');
    if (!isObj(files) || !isObj(manifest) || own(files, 'mod.json') || own(files, 'mod.sig')) fail("That mod can't be packed.");
    if (isObj(manifest.author) && own(manifest.author, 'key') && manifest.author.key !== j.x) fail('mod.json names a different author key.');
    const all = { ...files, 'mod.json': te.encode(`${JSON.stringify({ ...manifest, author: { ...manifest.author, key: j.x } }, null, 2)}\n`) };
    const hash = await digest(all);
    all['mod.sig'] = te.encode(b64u(new Uint8Array(await S.sign('Ed25519', await signer(j), message(hash)))));
    const bytes = archive(all);
    return { ...await read(bytes), bytes };
  };

  // ---- install and update rules ----------------------------------------------------------------------------------
  // installed: the stored record (or null); incoming: read()'s answer; dev: dev mode is on; blocked: what the blocklist
  // says about incoming (lib/blocklist.js: its reason, or '' when it isn't blocked; the caller asks, since the list lives
  // in storage). → { action: 'install'|'update'|'refuse', reason, newPermissions, prompt }, plus `blocked` when that is
  // why. newPermissions: what the student hasn't been asked about ('frame' included); an install always prompts, an
  // update only when that list isn't empty. trust: the separate author pin and highest signed version/hash, kept after removal.
  const plan = (installed, incoming, { dev = false, blocked = '', trust = null } = {}) => {
    const no = (reason) => ({ action: 'refuse', reason, newPermissions: [], prompt: false });
    if (blocked) return { ...no('blocked'), blocked: String(blocked) };
    if (!incoming.signed && !dev) return no('dev-off');
    if (trust) {
      if (incoming.key !== trust.key) return no('key');
      if (!incoming.signed) return no('signed');
      const order = compare(incoming.version, trust.version);
      if (order < 0 || (order === 0 && incoming.hash !== trust.hash)) return no('version');
    }
    const want = caps(incoming.manifest);
    if (!installed) return { action: 'install', reason: incoming.signed ? 'new' : 'dev', newPermissions: want, prompt: true };
    if (installed.id !== incoming.id) return no('id');
    if (installed.key !== incoming.key) return no('key');
    // An unsigned copy never replaces a signed mod; a signed one asks for the dev copy to be removed first, since a dev
    // copy's key was never proven.
    if (!incoming.signed && !installed.dev) return no('signed');
    if (incoming.signed && installed.dev) return no('dev');
    if (installed.hash === incoming.hash) return no('same');
    if (incoming.signed && compare(incoming.version, installed.version) <= 0) return no('version');
    const had = caps(installed.manifest || {});
    const grown = want.filter((p) => !had.includes(p));
    return { action: 'update', reason: incoming.signed ? 'newer' : 'dev', newPermissions: grown, prompt: grown.length > 0 };
  };

  // ---- the worker's 'glaze:mods' operations ----------------------------------------------------------------------
  // Only lib/background.js calls this, for the editor's top frame, inside the broker's queue. Every bundle is read and
  // checked again here, whatever the editor showed: the editor sends the zip, the hash the student saw and the grants
  // they gave. Records: storage.local `mod:<id>` = { id, manifest, files: { path: base64 }, hash, key, version,
  // grants: { permission: true }, source, installedAt, enabled, dev }; `mods` = [id], in the student's order. The
  // blocklist (lib/blocklist.js) marks a blocked record `enabled: false, blocked: <reason>`; the list keeps
  // that field, and nothing blocked installs, updates or turns back on. Dev mode is storage.local `modDev: true`, set by
  // the editor's dev mode switch.
  const ID = /^[a-z2-7]{16}$/;
  const SOURCES = ['file', 'code', 'link', 'gallery', 'dev', 'builder'];
  // A mod channel's read link (lib/modchannel.js), kept on the record of a mod installed from one.
  const channelOk = (text) => {
    if (typeof text !== 'string' || text.length > 600) return false;
    try {
      const u = new URL(text);
      return (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
        && !u.username && !u.password && !u.search && u.pathname.endsWith('/j')
        && u.hash.startsWith('#1.r.') && canon(u.hash.slice(5), 80);
    } catch { return false; }
  };
  const OPS = ['install', 'list', 'enable', 'disable', 'revoke', 'grant', 'remove', 'clearTrust', 'export', 'dismissOffer', 'replace'];
  const slot = (id) => `mod:${id}`;
  const replaceSlot = (id) => `modReplace:${id}`;
  const api = () => (typeof GZ_MODAPI !== 'undefined' ? GZ_MODAPI : require('./modapi.js'));
  const trustSlot = (id) => `modTrust:${id}`;
  const pin = ({ key, version, hash }) => ({ key, version, hash });
  const summary = ({ files, ...r }) => ({ ...r, prompt: prompt(r.manifest) });
  // The broker loads lib/blocklist.js before every decision; a missing module is an error, never an empty list.
  const change = async (m, { local }, { blocked = (r) => GZ_BLOCKLIST.blocked(local, r) } = {}) => {
    if (m.op === 'dismissOffer') {
      if (m.zip !== null && (typeof m.zip !== 'string' || m.zip.length > Math.ceil(CAP.archive / 3) * 4)) return { ok: false, error: 'bad' };
      const offer = (await local.get('modOffer')).modOffer;
      return { ok: !offer || (offer.zip ?? null) !== m.zip || (m.zip === null && offer.at !== m.at) || await local.remove('modOffer') };
    }
    const reason = async ({ id, hash, key }) => String((await blocked({ id, hash, key })) || '');
    const index = async () => { const v = (await local.get('mods')).mods; return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && ID.test(x)) : []; };
    const get = async (id) => { const r = (await local.get(slot(id)))[slot(id)]; return isObj(r) && r.id === id && isObj(r.files) ? r : null; };
    // Older signed installs already have a pin; persist it before removing their record, too.
    const trust = async (id, record) => (await local.get(trustSlot(id)))[trustSlot(id)] || (record && !record.dev ? pin(record) : null);
    if (m.op === 'list') {
      const ids = await index(), got = ids.length ? await local.get(ids.map(slot)) : {};
      return { ok: true, mods: ids.map((id) => got[slot(id)]).filter((r) => isObj(r)).map(summary) };
    }
    if (m.op === 'install') {
      if (typeof m.zip !== 'string' || m.zip.length > Math.ceil(CAP.archive / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(m.zip)
        || typeof m.hash !== 'string' || !SOURCES.includes(m.source) || (m.channel !== undefined && !channelOk(m.channel))) return { ok: false, error: 'bad' };
      let got;
      try { got = await read(unstd(m.zip)); } catch (e) { return { ok: false, error: 'bundle', why: e.why || "That mod file is damaged, or isn't a Glaze mod.", vars: e.vars || {} }; }
      if (got.hash !== m.hash) return { ok: false, error: 'hash' };
      // Builder saves are local signed widgets, never an imported author's bundle or a followed channel.
      if (m.source === 'builder' && (!got.signed || !hasBlocks(got.manifest) || m.channel !== undefined
        || got.key !== (await local.get('modAuthor')).modAuthor?.x)) return { ok: false, error: 'bad' };
      // 'gallery' (shown as Reviewed) only for the bundle the worker itself fetched from the gallery: the pending offer.
      if (m.source === 'gallery') {
        const offer = (await local.get('modOffer')).modOffer;
        if (!got.signed || offer?.id !== got.id || offer.hash !== m.hash || offer.zip !== m.zip) return { ok: false, error: 'bad' };
      }
      const before = await get(got.id);
      const p = plan(before, got, { dev: (await local.get('modDev')).modDev === true, blocked: await reason(got), trust: await trust(got.id, before) });
      if (p.action === 'refuse') return { ok: false, error: 'refused', reason: p.reason, ...(p.blocked && { blocked: p.blocked }) };
      const declared = (got.manifest.permissions || []).map((x) => x.id);
      let grants;
      // A quiet update keeps what the student granted, less what the mod no longer asks for; after a prompt, the grants
      // are the ones the student gave there.
      if (!p.prompt) grants = Object.fromEntries(Object.keys(isObj(before.grants) ? before.grants : {}).filter((k) => declared.includes(k)).map((k) => [k, true]));
      else if (Array.isArray(m.grants) && m.grants.every((g) => declared.includes(g)) && new Set(m.grants).size === m.grants.length) grants = Object.fromEntries(m.grants.map((g) => [g, true]));
      else return { ok: false, error: 'grants' };
      const record = { id: got.id, manifest: got.manifest, files: Object.fromEntries(Object.entries(got.files).map(([k, v]) => [k, std(v)])), hash: got.hash,
        key: got.key, version: got.version, grants, source: m.source, installedAt: before?.installedAt ?? Date.now(), ...(before && { updatedAt: Date.now() }), enabled: before ? before.enabled !== false : true, dev: !got.signed,
        ...((m.channel ?? before?.channel) && { channel: m.channel ?? before.channel }) };
      const ids = await index();
      // An update keeps the replacements the student turned on that the mod still declares; a key it adds starts off.
      const kept = before ? api().enabled((await local.get(replaceSlot(got.id)))[replaceSlot(got.id)], got.manifest) : [];
      if (!await local.set({ [slot(got.id)]: record, ...(before && { [replaceSlot(got.id)]: Object.fromEntries(kept.map((k) => [k, true])) }), ...(got.signed && { [trustSlot(got.id)]: pin(got) }), mods: ids.includes(got.id) ? ids : [...ids, got.id] })) return { ok: false, error: 'write' };
      if (m.source === 'gallery') await local.remove('modOffer');
      return { ok: true, action: p.action, mod: summary(record) };
    }
    if (!OPS.includes(m.op) || typeof m.id !== 'string' || !ID.test(m.id)) return { ok: false, error: 'bad' };
    const r = await get(m.id);
    if (m.op === 'clearTrust') return r ? { ok: false, error: 'installed' } : { ok: await local.remove(trustSlot(m.id)) };
    if (!r) return { ok: false, error: 'missing' };
    const put = async (patch) => ({ ok: await local.set({ [slot(r.id)]: { ...r, ...patch } }) });
    if (m.op === 'enable') {
      const why = (typeof r.blocked === 'string' && r.blocked) || await reason(r);
      if (why) return { ok: false, error: 'refused', reason: 'blocked', blocked: why };
      if (r.dev && (await local.get('modDev')).modDev !== true) return { ok: false, error: 'refused', reason: 'dev-off' };
      return put({ enabled: true });
    }
    if (m.op === 'disable') return put({ enabled: false });
    if (m.op === 'replace') {
      const set = api().replace(m.set, r.manifest);
      if (!set) return { ok: false, error: 'bad' };
      // Merge only the edited keys in the worker's queue, so another switch or editor cannot overwrite them.
      const on = api().enabled((await local.get(replaceSlot(r.id)))[replaceSlot(r.id)], r.manifest);
      return { ok: await local.set({ [replaceSlot(r.id)]: { ...Object.fromEntries(on.map((k) => [k, true])), ...set } }) };
    }
    if (m.op === 'grant') {
      if (typeof m.perm !== 'string' || !(r.manifest.permissions || []).some((p) => p.id === m.perm)) return { ok: false, error: 'bad' };
      return put({ grants: { ...r.grants, [m.perm]: true } });
    }
    if (m.op === 'revoke') {
      if (typeof m.perm !== 'string' || !isObj(r.grants) || !own(r.grants, m.perm)) return { ok: false, error: 'bad' };
      const grants = { ...r.grants };
      delete grants[m.perm];
      return put({ grants });
    }
    if (m.op === 'remove') {
      const kept = await trust(r.id, r);
      if (!await local.set({ ...(kept && { [trustSlot(r.id)]: kept }), mods: (await index()).filter((x) => x !== r.id) })) return { ok: false, error: 'write' };
      return { ok: await local.remove([slot(r.id), `modChannel:${r.id}`, replaceSlot(r.id)]) };
    }
    return { ok: true, zip: std(archive(Object.fromEntries(Object.entries(r.files).map(([k, v]) => [k, unstd(v)])))), name: r.manifest?.name || '' };
  };

  // ---- the gallery's "Use in Glaze" -------------------------------------------------------------------------------
  // The worker's one request to the gallery, made on the student's click there (lib/gallery.js): the signed bundle for
  // exactly that id and hash, with no cookies, no referrer and no redirects, read up to the zip cap. It must verify, be
  // that id and hash, and not be blocked. → storage.local `modOffer`: { id, hash, zip (base64), at } for the editor's
  // prompt, or { error, vars, at } with English for t().
  const GALLERY = 'https://frostdev.io/glaze/mods/api/mods/';
  const download = async (res, cap) => {
    if (+res.headers.get('content-length') > cap) { await res.body.cancel().catch(() => {}); tooBig(); }
    const reader = res.body.getReader(), parts = [];
    for (let n = 0; ;) {
      const { done, value } = await reader.read();
      if (done) return cat(...parts);
      n += value.length;
      if (n > cap) { reader.cancel().catch(() => {}); tooBig(); }
      parts.push(value);
    }
  };
  const fromGallery = async (g, { fetch, blocked }) => {
    if (!isObj(g) || Object.keys(g).length !== 2 || typeof g.id !== 'string' || !ID.test(g.id) || !canon(g.hash, 32)) fail("That gallery link isn't a Glaze mod.");
    let res = null;
    try {
      res = await fetch(`${GALLERY}${g.id}/${g.hash}.glazemod`, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    } catch { /* below */ }
    if (!res?.ok || !res.body) fail("Glaze couldn't download that mod from the gallery. Try again later.");
    const bytes = await download(res, CAP.archive), got = await read(bytes);
    if (!got.signed) fail("That mod isn't signed by its author, so Glaze won't take it from the gallery.");
    if (got.id !== g.id || got.hash !== g.hash) fail("That mod isn't the one the gallery listed.");
    const why = String((await blocked(got)) || '');
    if (why) fail('Glaze has blocked this mod: {reason}', { reason: why });
    return { ...got, bytes };
  };
  const offer = async (g, env) => {
    try {
      const got = await fromGallery(g, env);
      return { id: got.id, hash: got.hash, zip: std(got.bytes), at: Date.now() };
    } catch (e) { return { error: e.why || "That mod file is damaged, or isn't a Glaze mod.", vars: e.vars || {}, at: Date.now() }; }
  };

  return { CAP, TYPES, DATA, PREFIX, OPS, GALLERY, fromGallery, offer, std, type, slug, base32, compare, unzip, archive, check, clean, caps, prompt, digest, modId, verify, bundle, read, encode, decode,
    canSign, makeKey, keyPair, backup, restore, pack, plan, change };
})();

if (typeof module !== 'undefined') module.exports = GZ_MODBUNDLE; else GZ_MODBUNDLE;
