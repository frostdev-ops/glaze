// A zip archive in the store method (course files are PDFs, slides and pictures: already compressed),
// with UTF-8 names. Pure, so node can test it. Classic script for the content script; module.exports for node.
const GZ_ZIP = (() => {
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

  // files: [{ name: 'Week 1/notes.pdf', data: Uint8Array, date? }] → the archive as Blob parts.
  // ponytail: no zip64, so 65,535 files and 4 GB at most; the caller's size cap keeps far below that.
  const zip = (files) => {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const d = f.date || new Date();
      const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const day = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      const size = f.data.length;
      // version 2.0, flag 11 (UTF-8 name), method 0 (store), time, date, crc, both sizes, name and extra lengths
      const meta = [[20, 2], [0x800, 2], [0, 2], [time, 2], [day, 2], [crc32(f.data), 4], [size, 4], [size, 4], [name.length, 2], [0, 2]];
      parts.push(le([0x04034b50, 4], ...meta), name, f.data);
      // made by 2.0, then comment length, disk, internal and external attributes, where the local header is
      central.push(le([0x02014b50, 4], [20, 2], ...meta, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    return [...parts, ...central, le([0x06054b50, 4], [0, 2], [0, 2], [files.length, 2], [files.length, 2], [cdSize, 4], [offset, 4], [0, 2])];
  };

  // A title as one path segment every system can unpack: no separators, reserved or control
  // characters, no trailing dot or space (Windows), not too long.
  const safeName = (s) => String(s || '').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').slice(0, 120).replace(/[. ]+$/, '').trim() || 'Untitled';
  // A path not yet in `taken` (case-insensitive, as on Windows and macOS): "a.pdf", "a (2).pdf", …
  const unique = (path, taken) => {
    const [, base, ext] = path.match(/^(.*?)(\.[^./]*)?$/);
    let p = path;
    for (let n = 2; taken.has(p.toLowerCase()); n++) p = `${base} (${n})${ext || ''}`;
    taken.add(p.toLowerCase());
    return p;
  };

  return { crc32, zip, safeName, unique };
})();

if (typeof module !== 'undefined') module.exports = GZ_ZIP;
