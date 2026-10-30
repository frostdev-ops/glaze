// A zip archive in the store method (course files are PDFs, slides and pictures: already compressed),
// with UTF-8 names; zipAsync also deflates (an .xlsx is XML). Pure, so node can test it. Classic script for the content
// script; module.exports for node.
// Loaded on demand (content.js need()): a second injection into the same frame keeps the first.
var GZ_ZIP = globalThis.GZ_ZIP || (() => {
  const TABLE = new Uint32Array(256).map((_, i) => {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc32 = (b) => {
    let c = ~0;
    for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
    return ~c >>> 0;
  };
  // [value, width] pairs, little-endian.
  const le = (...fields) => {
    const out = new Uint8Array(fields.reduce((n, [, w]) => n + w, 0));
    const v = new DataView(out.buffer);
    let o = 0;
    for (const [x, w] of fields) { if (w === 2) v.setUint16(o, x, true); else v.setUint32(o, x, true); o += w; }
    return out;
  };

  // files: [{ name: 'Week 1/notes.pdf', data: Uint8Array, date? }] → the archive as Blob parts. packed: each file's
  // deflated bytes, or null to store it.
  // ponytail: no zip64, so 65,535 files and 4 GB at most; the caller's size cap keeps far below that.
  const build = (files, packed) => {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach((f, i) => {
      const name = enc.encode(f.name);
      const d = f.date || new Date();
      const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const day = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      const body = packed?.[i] || f.data;
      // version 2.0, flag 11 (UTF-8 name), method 0 (store) or 8 (deflate), time, date, crc, both sizes, name and extra lengths
      const meta = [[20, 2], [0x800, 2], [body === f.data ? 0 : 8, 2], [time, 2], [day, 2], [crc32(f.data), 4], [body.length, 4], [f.data.length, 4], [name.length, 2], [0, 2]];
      parts.push(le([0x04034b50, 4], ...meta), name, body);
      // made by 2.0, then comment length, disk, internal and external attributes, where the local header is
      central.push(le([0x02014b50, 4], [20, 2], ...meta, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]), name);
      offset += 30 + name.length + body.length;
    });
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    return [...parts, ...central, le([0x06054b50, 4], [0, 2], [0, 2], [files.length, 2], [files.length, 2], [cdSize, 4], [offset, 4], [0, 2])];
  };
  const zip = (files) => build(files, null);

  // Raw deflate through CompressionStream (Chrome 103, Firefox 113, Safari 16.4), written straight in as doctext.js
  // inflates; node without it uses zlib.
  const deflateRaw = async (bytes) => {
    if (typeof CompressionStream === 'undefined') return new Uint8Array(require('node:zlib').deflateRawSync(bytes));
    const stream = new CompressionStream('deflate-raw'), writer = stream.writable.getWriter();
    writer.write(bytes).then(() => writer.close()).catch(() => {});
    const reader = stream.readable.getReader(), chunks = [];
    let n = 0;
    for (let r = await reader.read(); !r.done; r = await reader.read()) { chunks.push(r.value); n += r.value.length; }
    const out = new Uint8Array(n);
    n = 0;
    for (const c of chunks) { out.set(c, n); n += c.length; }
    return out;
  };
  // zip(), with { deflate: true } compressing each file that deflate makes smaller.
  const zipAsync = async (files, { deflate = false } = {}) => {
    if (!deflate) return zip(files);
    const packed = [];
    for (const f of files) {
      const d = f.data.length ? await deflateRaw(f.data) : null;
      packed.push(d && d.length < f.data.length ? d : null);
    }
    return build(files, packed);
  };

  // A title as one path segment every system can unpack: no separators, reserved or control characters, no trailing dot or
  // space (Windows), not too long. A long name is cut in its base so it keeps its extension (".pdf" decides what opens it),
  // never inside a surrogate pair (half an emoji isn't valid UTF-8), and a base Windows reserves ("CON", "nul.txt", "COM1")
  // gets an underscore in front.
  const MAX = 120;
  const RESERVED = /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i;
  const clip = (s, n) => { const c = s.charCodeAt(n - 1); return s.length <= n ? s : s.slice(0, c >= 0xd800 && c < 0xdc00 ? n - 1 : n); };
  const safeName = (s) => {
    const name = String(s || '').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
    const ext = /\.[^.\s]{1,16}$/.exec(name)?.[0] || '';
    const raw = name.slice(0, name.length - ext.length).replace(/[. ]+$/, '');
    const prefix = RESERVED.test(raw + ext) ? '_' : '';
    const base = clip(raw, MAX - ext.length - prefix.length).replace(/[. ]+$/, '');
    const safe = base + ext;
    return !safe ? 'Untitled' : prefix + safe;
  };
  // A path not yet in `taken` (case-insensitive, as on Windows and macOS): "a.pdf", "a (2).pdf", …
  // Directories reserve their path too; a renamed directory is shared by every later file under it.
  const directories = new WeakMap();
  const unique = (path, taken) => {
    if (!directories.has(taken)) directories.set(taken, new Map());
    const dirs = directories.get(taken), parts = path.split('/');
    let parent = '', original = '';
    for (let i = 0; i < parts.length; i++) {
      const dir = i < parts.length - 1, name = parts[i];
      original += `${name.toLowerCase()}/`;
      if (dir && dirs.has(original)) { parent = dirs.get(original); continue; }
      const [, base, ext = ''] = name.match(/^(.*?)(\.[^.\s]{1,16})?$/);
      let p = parent + name;
      for (let n = 2; taken.has(p.toLowerCase()) || taken.has(p.toLowerCase() + '/'); n++) {
        const suffix = ` (${n})`;
        p = parent + clip(base, MAX - suffix.length - ext.length).replace(/[. ]+$/, '') + suffix + ext;
      }
      taken.add(p.toLowerCase() + (dir ? '/' : ''));
      if (!dir) return p;
      parent = p + '/';
      dirs.set(original, parent);
    }
  };

  // An unmet view requirement wins over another reference to the same attachment in this module.
  const canvasUnopened = (items) => new Set(items.filter((f) => f.type === 'File' && f.completion_requirement?.type === 'must_view' && f.completion_requirement.completed !== true).map((f) => String(f.content_id)));
  const canvasFiles = (items) => {
    const unopened = canvasUnopened(items);
    return [...new Set(items.filter((f) => f.type === 'File' && /^\d+$/.test(f.content_id) && !f.content_details?.locked_for_user && !unopened.has(String(f.content_id))).map((f) => String(f.content_id)))];
  };
  const canvasURL = (file, origin) => {
    if (!file || typeof file.url !== 'string' || !file.url || file.locked_for_user || file.hidden_for_user) return null;
    try {
      const url = new URL(file.url, origin);
      return (url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === origin)) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  };

  return { crc32, zip, zipAsync, safeName, unique, canvasUnopened, canvasFiles, canvasURL };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_ZIP; else GZ_ZIP;
