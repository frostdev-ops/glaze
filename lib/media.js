// Media a Look or a mod brings: a looping video, an animated picture or a Lottie animation behind the page (bg.kind
// "media", cleaned in lib/lookparts.js, drawn by lib/scene-media.js), and the stickers a mod carries. Everything here is
// someone else's bytes, so nothing is trusted until it has been read within hard limits: the container is walked (never
// decoded), its size, frames and pixels are capped, and a file Glaze keeps is the cleaned one (a WebP rebuilt from the
// chunks that draw, a Lottie file rewritten from what it may hold), named by its SHA-256. Nothing here runs code.
// Also the worker's 'glaze:media' operations (change): the files this computer keeps for a Look (storage.local
// `lookMedia:<hash>`, put by the editor, or by a Look share), and the Lottie JSON a page asks for, cleaned, from a kept file
// or from the address the worn Look names. Classic script for the worker, the editor and node.
var GZ_MEDIA = globalThis.GZ_MEDIA || (() => {
  const S = globalThis.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const X = () => (typeof GZ_XPARTS !== 'undefined' ? GZ_XPARTS : require('./lookparts.js'));
  const MIB = 1 << 20;
  // bg: a Look's background. file: the most one kept file may be, by type, and all of them together. A picture's side in
  // pixels, its frames and its pixels over all frames (what a decoder may be asked to hold). sticker: the same for a mod's.
  const LIMIT = {
    bg: { video: 12 * MIB, image: { bytes: 6 * MIB, side: 4096, frames: 300, pixels: 4e8 }, lottie: MIB },
    sticker: { image: { bytes: 512 << 10, side: 512, frames: 150, pixels: 6.4e7 }, lottie: 256 << 10 },
    total: 48 * MIB, fetch: 15000, stickers: 24, pets: 4,
  };
  const TYPES = ['video', 'image', 'lottie'];
  const KEY = 'lookMedia:';
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

  // ---- bytes ----------------------------------------------------------------------------------------------------
  const std = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unstd = (s) => { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  const b64u = (bytes) => std(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sha = async (bytes) => b64u(new Uint8Array(await S.digest('SHA-256', bytes)));
  const four = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
  const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };
  const put32 = (n) => Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
  const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

  // ---- WebP -----------------------------------------------------------------------------------------------------
  // A RIFF file walked chunk by chunk, exactly (every length inside the file, the whole file accounted for). Returns the file
  // rebuilt from the chunks that draw it (the header, the colour profile, the animation and its frames, or the one picture),
  // without metadata or anything unknown, with its size, frames and whether it moves. null when it isn't a whole, plain WebP.
  const webp = (b, cap) => {
    if (b.length < 20 || four(b, 0) !== 'RIFF' || four(b, 8) !== 'WEBP' || le32(b, 4) !== b.length - 8) return null;
    const read = (from, to) => {
      const out = [];
      for (let i = from; i < to;) {
        if (i + 8 > to) return null;
        const n = le32(b, i + 4), end = i + 8 + n;
        if (end > to || end + (n & 1) > to) return null;
        out.push({ id: four(b, i), at: i + 8, n });
        i = end + (n & 1);
        if (out.length > cap.frames * 3 + 16) return null;
      }
      return out;
    };
    const chunks = read(12, b.length);
    if (!chunks?.length) return null;
    const raw = (c) => b.subarray(c.at - 8, c.at + c.n + (c.n & 1));
    // One picture: a VP8 or VP8L chunk, and in an extended file an ALPH before a VP8. Its size comes from its own header.
    const still = (list, extended) => {
      const pic = list.filter((c) => c.id === 'VP8 ' || c.id === 'VP8L'), alpha = list.filter((c) => c.id === 'ALPH');
      if (pic.length !== 1 || list.length !== pic.length + alpha.length || alpha.length > (extended && pic[0].id === 'VP8 ' ? 1 : 0) || (alpha.length && list[0] !== alpha[0])) return null;
      const p = pic[0];
      if (p.id === 'VP8L') return p.n >= 5 && b[p.at] === 0x2f ? { w: (le32(b, p.at + 1) & 0x3fff) + 1, h: ((le32(b, p.at + 1) >> 14) & 0x3fff) + 1, list } : null;
      return p.n >= 10 && b[p.at + 3] === 0x9d && b[p.at + 4] === 0x01 && b[p.at + 5] === 0x2a ? { w: (b[p.at + 6] | (b[p.at + 7] << 8)) & 0x3fff, h: (b[p.at + 8] | (b[p.at + 9] << 8)) & 0x3fff, list } : null;
    };
    let w, h, frames = 1, animated = false, out;
    if (chunks[0].id !== 'VP8X') {
      const s = still(chunks, false);
      if (!s) return null;
      ({ w, h } = s);
      out = b.slice();
    } else {
      const x = chunks[0], flags = b[x.at];
      if (x.n !== 10) return null;
      w = le24(b, x.at + 4) + 1; h = le24(b, x.at + 7) + 1;
      animated = !!(flags & 2);
      const rest = chunks.slice(1), icc = rest.filter((c) => c.id === 'ICCP');
      const keep = [];
      if (icc.length > 1 || !!(flags & 0x20) !== !!icc.length || (icc.length && rest[0].id !== 'ICCP')) return null;
      if (icc.length) keep.push(raw(icc[0]));
      if (!animated) {
        const s = still(rest.filter((c) => ['ALPH', 'VP8 ', 'VP8L'].includes(c.id)), true);
        if (!s || rest.some((c) => c.id === 'ANIM' || c.id === 'ANMF') || s.w !== w || s.h !== h) return null; // the header's size is the picture's
        keep.push(...s.list.map(raw));
      } else {
        const anim = rest.filter((c) => c.id === 'ANIM'), frs = rest.filter((c) => c.id === 'ANMF');
        if (anim.length !== 1 || anim[0].n !== 6 || !frs.length || frs.length > cap.frames || rest.some((c) => ['ALPH', 'VP8 ', 'VP8L'].includes(c.id))) return null;
        if (rest.indexOf(anim[0]) > rest.indexOf(frs[0])) return null;
        for (const f of frs) {
          if (f.n < 16) return null;
          const inner = read(f.at + 16, f.at + f.n);
          const s = inner && still(inner, true);
          if (!s || le24(b, f.at) * 2 + le24(b, f.at + 6) + 1 > w || le24(b, f.at + 3) * 2 + le24(b, f.at + 9) + 1 > h) return null;
          // The frame's own width and height must be the picture's.
          if (le24(b, f.at + 6) + 1 !== s.w || le24(b, f.at + 9) + 1 !== s.h) return null;
        }
        keep.push(raw(anim[0]), ...frs.map(raw));
        frames = frs.length;
      }
      const head = cat(ascii('VP8X'), put32(10), Uint8Array.of(flags & 0x32, 0, 0, 0), b.subarray(x.at + 4, x.at + 10));
      const body = cat(ascii('WEBP'), head, ...keep);
      out = cat(ascii('RIFF'), put32(body.length), body);
    }
    if (w < 1 || h < 1 || w > cap.side || h > cap.side || w * h * frames > cap.pixels) return null;
    return { w, h, frames, animated, bytes: out, mime: 'image/webp' };
  };

  // ---- PNG stickers ---------------------------------------------------------------------------------------------
  // Static PNG only. Keep the chunks needed to draw; APNG is refused rather than counted as one frame.
  const png = (b, cap) => {
    if (b.length < 45 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)) return null;
    const keep = [b.subarray(0, 8)];
    let w = 0, h = 0, data = 0, palette = false, alpha = false;
    for (let i = 8, chunks = 0; i < b.length;) {
      if (i + 12 > b.length || ++chunks > 4096) return null;
      const n = be32(b, i), id = four(b, i + 4), end = i + n + 12;
      if (end > b.length || (i === 8 && id !== 'IHDR') || id === 'acTL' || id === 'fcTL' || id === 'fdAT') return null;
      if (id === 'IHDR') {
        if (i !== 8 || n !== 13) return null;
        w = be32(b, i + 8); h = be32(b, i + 12);
        const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        if (!depths[b[i + 17]]?.includes(b[i + 16]) || b[i + 18] || b[i + 19] || b[i + 20] > 1) return null;
        if (!w || !h || w > cap.side || h > cap.side || w * h > cap.pixels) return null;
      } else if (id === 'PLTE') {
        if (palette || data || !n || n > 768 || n % 3) return null;
        palette = true;
      } else if (id === 'tRNS') {
        if (alpha || data || n > 256) return null;
        alpha = true;
      } else if (id === 'IDAT') data += n;
      else if (id === 'IEND') {
        if (n || !data || end !== b.length) return null;
        return { w, h, frames: 1, animated: false, bytes: cat(...keep, b.subarray(i, end)), mime: 'image/png' };
      } else if (!(b[i + 4] & 32)) return null; // unknown critical chunk
      if (['IHDR', 'PLTE', 'tRNS', 'IDAT'].includes(id)) keep.push(b.subarray(i, end));
      i = end;
    }
    return null;
  };

  // Embedded JPEGs: measure the frame header and drop application metadata and comments, including between scans.
  const jpeg = (b, cap) => {
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    const keep = [b.subarray(0, 2)];
    let w = 0, h = 0, scanned = false;
    for (let i = 2, markers = 0; i < b.length;) {
      if (b[i] !== 0xff || ++markers > 4096) return null;
      const start = i;
      while (b[i] === 0xff) i++;
      const marker = b[i++];
      if (marker === 0xd9) return scanned && i === b.length && w && h ? { w, h, bytes: cat(...keep, b.subarray(start, i)), mime: 'image/jpeg' } : null;
      if (marker === 0xd8 || marker === 0 || i + 2 > b.length) return null;
      const n = b[i] * 256 + b[i + 1], end = i + n;
      if (n < 2 || end > b.length) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (n < 8) return null;
        h = b[i + 3] * 256 + b[i + 4]; w = b[i + 5] * 256 + b[i + 6];
        if (!w || !h || w > cap.side || h > cap.side || w * h > cap.pixels) return null;
      }
      if (marker === 0xda) {
        if (!w || !h) return null;
        scanned = true;
        i = end;
        while (i < b.length) {
          if (b[i++] !== 0xff) continue;
          const next = b[i];
          if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { i++; continue; }
          i--; break;
        }
        keep.push(b.subarray(start, i));
      } else {
        // Adobe's colour transform is needed to interpret CMYK pixels.
        if (!(marker >= 0xe0 && marker <= 0xef && marker !== 0xee) && marker !== 0xfe) keep.push(b.subarray(start, end));
        i = end;
      }
    }
    return null;
  };

  // ---- AVIF -----------------------------------------------------------------------------------------------------
  // ISO boxes walked to their ends (every box inside its parent, all accounted for): a still picture ("avif") or a sequence
  // ("avis"), its size from `ispe` and its frames from the sample table. Not rebuilt: the file is kept as it came.
  const boxes = (b, from, to) => {
    const out = [];
    let i = from;
    while (i < to) {
      if (i + 8 > to) return null;
      let size = be32(b, i), head = 8;
      if (size === 1) { if (i + 16 > to || be32(b, i + 8)) return null; size = be32(b, i + 12); head = 16; } else if (size === 0) size = to - i;
      if (size < head || i + size > to) return null;
      out.push({ type: four(b, i + 4), at: i + head, end: i + size });
      i += size;
      if (out.length > 4096) return null;
    }
    return out;
  };
  // The boxes at `path` below `box` (a "meta" box has four bytes of version and flags before its children).
  const dig = (b, box, path, full = false) => {
    if (!path.length) return [box];
    const kids = boxes(b, box.at + (full ? 4 : 0), box.end);
    if (!kids) return null;
    const out = [];
    for (const k of kids.filter((k) => k.type === path[0])) {
      const found = dig(b, k, path.slice(1), k.type === 'meta');
      if (!found || out.length + found.length > 4096) return null;
      out.push(...found);
    }
    return out;
  };
  // Movie containers and visual sample descriptions share the same bounds in MP4 and AVIF sequences.
  const movie = (b, root, cap) => {
    const containers = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf'];
    const visual = ['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp08', 'vp09'];
    let count = 0;
    const walk = (box, depth) => {
      if (++count > 4096 || depth > 8) return false;
      if (box.type === 'stsd') {
        if (box.end - box.at < 8) return false;
        const entries = boxes(b, box.at + 8, box.end);
        if (!entries || entries.length !== be32(b, box.at + 4)) return false;
        for (const e of entries) if (visual.includes(e.type)) {
          if (e.end - e.at < 78) return false;
          const w = b[e.at + 24] * 256 + b[e.at + 25], h = b[e.at + 26] * 256 + b[e.at + 27];
          if (!w || !h || w > cap.side || h > cap.side || w * h > cap.pixels || !boxes(b, e.at + 78, e.end)) return false;
        }
      } else if (containers.includes(box.type)) {
        const children = boxes(b, box.at, box.end);
        if (!children || (box.type === 'moov' && !children.some((c) => c.type === 'trak'))) return false;
        if (!children.every((c) => walk(c, depth + 1))) return false;
      }
      return true;
    };
    return walk(root, 0);
  };
  const avif = (b, cap) => {
    const top = b.length >= 16 && four(b, 4) === 'ftyp' ? boxes(b, 0, b.length) : null;
    if (!top || top[0].type !== 'ftyp') return null;
    const f = top[0], brands = [four(b, f.at)];
    for (let i = f.at + 8; i + 4 <= f.end; i += 4) brands.push(four(b, i));
    const moves = brands.includes('avis');
    if (!moves && !brands.includes('avif')) return null;
    const meta = top.filter((t) => t.type === 'meta');
    if (meta.length !== 1) return null;
    const dims = dig(b, meta[0], ['iprp', 'ipco', 'ispe'], true);
    if (!dims?.length || dims.some((s) => s.end - s.at < 12)) return null;
    let w = Math.max(...dims.map((s) => be32(b, s.at + 4))), h = Math.max(...dims.map((s) => be32(b, s.at + 8)));
    let frames = 1;
    if (moves) {
      const moov = top.filter((t) => t.type === 'moov');
      if (moov.length !== 1 || !movie(b, moov[0], cap)) return null;
      // A sequence's primary image can be smaller than the frames in its video track.
      const descriptions = dig(b, moov[0], ['trak', 'mdia', 'minf', 'stbl', 'stsd']);
      if (!descriptions) return null;
      for (const s of descriptions) {
        if (s.end - s.at < 8) return null;
        const entries = boxes(b, s.at + 8, s.end);
        if (!entries?.length || entries.length !== be32(b, s.at + 4)) return null;
        for (const e of entries) {
          if (e.type !== 'av01' || e.end - e.at < 78) return null;
          const ew = b[e.at + 24] * 256 + b[e.at + 25], eh = b[e.at + 26] * 256 + b[e.at + 27];
          if (!ew || !eh) return null;
          w = Math.max(w, ew); h = Math.max(h, eh);
        }
      }
      const counts = dig(b, moov[0], ['trak', 'mdia', 'minf', 'stbl', 'stsz']);
      if (!counts?.length || counts.some((s) => s.end - s.at < 12)) return null;
      frames = Math.max(...counts.map((s) => be32(b, s.at + 8)));
    }
    if (w < 1 || h < 1 || w > cap.side || h > cap.side || frames < 1 || frames > cap.frames || w * h * frames > cap.pixels) return null;
    return { w, h, frames, animated: moves && frames > 1, bytes: b, mime: 'image/avif' };
  };

  // ---- video ----------------------------------------------------------------------------------------------------
  const webm = (b) => {
    let elements = 0, doc = false, track = false, cluster = false;
    const masters = new Set([0x1a45dfa3, 0x18538067, 0x1654ae6b, 0xae, 0xe0, 0x1f43b675, 0xa0]);
    const walk = (from, to, parent, depth) => {
      if (depth > 8) return false;
      for (let i = from; i < to;) {
        if (++elements > 100000) return false;
        const vint = (id) => {
          let n = 1;
          while (n <= 8 && !(b[i] & (128 >> (n - 1)))) n++;
          if (n > (id ? 4 : 8) || i + n > to) return null;
          let v = b[i++] & (id ? 255 : (128 >> (n - 1)) - 1);
          let unknown = !id && v === (128 >> (n - 1)) - 1;
          for (let j = 1; j < n; j++) { unknown &&= b[i] === 255; v = v * 256 + b[i++]; }
          return unknown ? -1 : Number.isSafeInteger(v) ? v : null;
        };
        const id = vint(true), size = id === null ? null : vint(false);
        if (id === null || size === null || (size === -1 && ![0x18538067, 0x1f43b675].includes(id))) return false;
        const end = size === -1 ? to : i + size;
        if (end > to) return false;
        if (parent === 0 && ![0x1a45dfa3, 0x18538067].includes(id)) return false;
        if (id === 0x4282 && parent === 0x1a45dfa3) doc = td.decode(b.subarray(i, end)) === 'webm';
        if (id === 0x83 && parent === 0xae && size === 1 && b[i] === 1) track = true;
        if ([0xb0, 0xba].includes(id) && parent === 0xe0) {
          if (size < 1 || size > 4) return false;
          let side = 0;
          for (let j = i; j < end; j++) side = side * 256 + b[j];
          if (!side || side > LIMIT.bg.image.side) return false;
        }
        if (id === 0x1f43b675 && parent === 0x18538067) cluster = true;
        if (masters.has(id) && !walk(i, end, id, depth + 1)) return false;
        i = end;
      }
      return true;
    };
    return walk(0, b.length, 0, 0) && doc && track && cluster;
  };
  // A WebM with bounded EBML elements and a video track, or an MP4 (well-formed boxes with a moov).
  // The browser's own decoder does the rest, and its size is capped by the file's.
  const video = (b) => {
    if (b.length > 64 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 && webm(b)) return { bytes: b, mime: 'video/webm' };
    if (b.length > 16 && four(b, 4) === 'ftyp') {
      const top = boxes(b, 0, b.length);
      const f = top?.[0], major = f && four(b, f.at), moov = top?.filter((t) => t.type === 'moov');
      if (top && f.type === 'ftyp' && moov.length === 1 && movie(b, moov[0], LIMIT.bg.image) && !['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1', 'crx '].includes(major)) return { bytes: b, mime: 'video/mp4' };
    }
    return null;
  };

  // ---- Lottie ---------------------------------------------------------------------------------------------------
  // A Lottie file is data for lib/lottie's light player (no expressions, so nothing in it is ever run), but it is also a
  // tree a hostile file can make enormous. It is rewritten from the keys that draw it and refused for anything that could
  // reach out or run away: expressions, text and audio layers, fonts, pictures that are not embedded, a precomp that
  // contains itself, a repeater past 100 copies, too many nodes or levels or frames. → { json, bytes, w, h, frames, fr }.
  const LOTTIE = { nodes: 60000, depth: 32, layers: 500, instances: 2000, comps: 64, nest: 8, frames: 3600, seconds: 60, rep: 100, side: 4096, area: 8388608, embed: 384 << 10, text: 512 };
  const TOP = ['v', 'fr', 'ip', 'op', 'w', 'h', 'nm', 'ddd', 'assets', 'layers', 'markers'];
  const LAYER = [0, 1, 2, 3, 4, 13];
  const matte = (v) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 4);
  const DATA = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  const lottie = (raw, max = LIMIT.bg.lottie) => {
    let o = raw;
    if (typeof raw === 'string') { if (raw.length > max) return null; try { o = JSON.parse(raw); } catch { return null; } }
    if (!isObj(o)) return null;
    const out = {};
    for (const k of TOP) if (Object.hasOwn(o, k)) out[k] = o[k];
    let nodes = 0, copies = 0, expansion = 1;
    const weights = new WeakMap();
    // Keyframe endpoints count too: the player interpolates between s and e.
    const count = (c, lo = 0) => {
      const k = isObj(c) ? c.k : null;
      const unit = (v) => (Array.isArray(v) ? v.length > 0 && v.every(unit) : typeof v === 'number' && v >= 0 && v <= 1);
      // Count endpoints are not a bound if their interpolation handles can overshoot them.
      if (Array.isArray(k) && k.some((f) => !['i', 'o'].every((side) => f?.[side] === undefined
        || (isObj(f[side]) && unit(f[side].x) && unit(f[side].y))))) return null;
      const vals = typeof k === 'number' ? [k] : Array.isArray(k) ? k.flatMap((e) => isObj(e) && Array.isArray(e.s) ? [...e.s, ...(Array.isArray(e.e) ? e.e : [])] : [NaN]) : [NaN];
      return vals.length && vals.every((v) => typeof v === 'number' && v >= lo && v <= LOTTIE.rep) ? Math.ceil(Math.max(...vals)) : null;
    };
    const rep = (c) => {
      const n = count(c);
      copies += n;
      expansion *= Math.max(1, n);
      return n !== null && copies <= LOTTIE.rep && expansion <= LOTTIE.rep;
    };
    const zigzag = (c) => {
      const n = count(c);
      expansion *= Math.max(1, n + 1);
      return n !== null && expansion <= LOTTIE.rep;
    };
    const gradient = (g) => {
      if (!isObj(g) || !Number.isSafeInteger(g.p) || g.p < 1 || !Array.isArray(g.k?.k) || !g.k.k.length) return false;
      const k = g.k.k;
      const samples = typeof k[0] === 'number' ? [k] : k.flatMap((f) => [f?.s, f?.e].filter((v) => v !== undefined));
      const length = samples[0]?.length;
      // The player allocates from p before reading the stops; every allocation must be backed by bounded input.
      return Array.isArray(samples[0]) && length >= 4 * g.p && (length - 4 * g.p) % 2 === 0
        && samples.every((s) => Array.isArray(s) && s.length === length && s.every((v) => typeof v === 'number'));
    };
    const scan = (v, depth, key) => {
      if (++nodes > LOTTIE.nodes || depth > LOTTIE.depth) return false;
      const start = nodes;
      if (typeof v === 'number') return Number.isFinite(v);
      if (typeof v === 'string') return v.length <= (key === 'p' ? LOTTIE.embed : LOTTIE.text);
      if (typeof v === 'boolean' || v === null) return true;
      if (Array.isArray(v)) return v.every((e) => scan(e, depth + 1, key));
      if (!isObj(v)) return false;
      for (const k of Object.keys(v)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype' || (k === 'x' && typeof v[k] === 'string') || !scan(v[k], depth + 1, k)) return false;
      }
      weights.set(v, nodes - start + 1);
      return (v.ty !== 'rp' || (rep(v.c) && (v.o === undefined || count(v.o, -LOTTIE.rep) !== null)))
        && (v.ty !== 'sr' || count(v.pt) !== null) && (v.ty !== 'zz' || zigzag(v.r))
        && (!['gf', 'gs'].includes(v.ty) || gradient(v.g));
    };
    if (!scan(out, 0, '') || nodes * expansion > LOTTIE.nodes) return null;
    const num = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;
    if (!num(out.fr, 1, 60) || !num(out.ip, 0, 1e6) || !num(out.op, 0, 1e6) || !(out.op > out.ip) || out.op - out.ip > LOTTIE.frames || (out.op - out.ip) / out.fr > LOTTIE.seconds) return null;
    if (!num(out.w, 1, LOTTIE.side) || !num(out.h, 1, LOTTIE.side) || out.w * out.h > LOTTIE.area || !Array.isArray(out.layers)) return null;
    const assets = Array.isArray(out.assets) ? out.assets.map((a) => isObj(a) ? { ...a } : a) : out.assets === undefined ? [] : null;
    if (!assets || assets.length > 256 || (out.markers !== undefined && !Array.isArray(out.markers))) return null;
    if (out.assets !== undefined) out.assets = assets;
    const comps = new Map(), images = new Set();
    let embed = 0, imagePixels = 0, layerCount = 0;
    for (const a of assets) {
      if (!isObj(a) || typeof a.id !== 'string' || !a.id || a.id.length > 64 || comps.has(a.id) || images.has(a.id)) return null;
      if (!matte(a.tt)) return null;
      if (Array.isArray(a.layers)) { if (comps.size >= LOTTIE.comps) return null; comps.set(a.id, a.layers); continue; }
      // A picture: embedded as a data address, never a file name or a link to fetch.
      if (typeof a.p !== 'string' || !DATA.test(a.p) || (a.u !== undefined && a.u !== '') || (a.e !== undefined && a.e !== 1)) return null;
      embed += a.p.length;
      if (embed > LOTTIE.embed) return null;
      let bytes;
      try { bytes = unstd(a.p.split(',')[1]); } catch { return null; }
      const cap = { ...LIMIT.bg.image, pixels: LOTTIE.area };
      const pic = png(bytes, cap) || webp(bytes, cap) || jpeg(bytes, cap);
      if (!pic || pic.animated) return null;
      imagePixels += pic.w * pic.h;
      if (imagePixels > LOTTIE.area) return null;
      Object.assign(a, { p: `data:${pic.mime};base64,${std(pic.bytes)}`, w: pic.w, h: pic.h, e: 1 });
      images.add(a.id);
    }
    // Each layer's type is one that draws, and a precomp or a picture names an asset that is there.
    const layers = (list) => {
      if (!Array.isArray(list)) return false;
      layerCount += list.length;
      if (layerCount > LOTTIE.layers) return false;
      // The player's parent walk is recursive, including for null layers.
      const byId = new Map(list.filter(isObj).map((l) => [l.ind, l]));
      if (list.some((l) => l?.parent !== undefined) && byId.size !== list.length) return false;
      for (const l of list) {
        if (!isObj(l) || !LAYER.includes(l.ty) || !matte(l.tt)) return false;
        if (l.ty === 0 && (typeof l.refId !== 'string' || !comps.has(l.refId))) return false;
        if (l.ty === 2 && (typeof l.refId !== 'string' || !images.has(l.refId))) return false;
        const seen = new Set([l]);
        for (let p = l; p.parent !== undefined;) {
          p = byId.get(p.parent);
          if (!p || seen.has(p)) return false;
          seen.add(p);
        }
      }
      return true;
    };
    if (!layers(out.layers)) return null;
    for (const list of comps.values()) if (!layers(list)) return null;
    // No precomp inside itself, no deeper than LOTTIE.nest, and no more layers once every precomp is counted as often as
    // it is used than LOTTIE.instances (a few precomps naming each other twice would make millions).
    // Shape nodes count on each use too: one complex layer can be far heavier than many empty layers.
    const memo = new Map();
    const reach = (id, open) => {
      if (open.has(id)) return { depth: Infinity, count: Infinity, work: Infinity, buffers: Infinity, luma: false };
      if (memo.has(id)) return memo.get(id);
      open.add(id);
      const own = id ? comps.get(id) : out.layers;
      let depth = 0, count = own.length, work = own.reduce((n, l) => n + weights.get(l), 0);
      let buffers = own.filter((l) => l.tt >= 1).length * 2, luma = own.some((l) => l.tt >= 3);
      for (const l of own) if (l.ty === 0) { const r = reach(l.refId, open); depth = Math.max(depth, r.depth); count += r.count; work += r.work; buffers += r.buffers; luma ||= r.luma; }
      open.delete(id);
      const r = { depth: depth + 1, count, work, buffers, luma };
      memo.set(id, r);
      return r;
    };
    for (const id of ['', ...comps.keys()]) {
      const top = reach(id, new Set());
      if (top.depth > LOTTIE.nest + 1 || top.count * expansion > LOTTIE.instances || top.work * expansion > LOTTIE.nodes) return null;
    }
    const extras = assets.filter((a) => a.xt && comps.has(a.id)).map((a) => {
      const r = reach(a.id, new Set());
      return { ...r, buffers: r.buffers + (a.tt >= 1 ? 2 : 0), luma: r.luma || a.tt >= 3 };
    });
    const instances = reach('', new Set()).count + extras.reduce((n, r) => n + r.count, 0);
    const work = reach('', new Set()).work + extras.reduce((n, r) => n + r.work, 0);
    if (instances * expansion > LOTTIE.instances || work * expansion > LOTTIE.nodes) return null;
    const main = reach('', new Set());
    // Mattes allocate viewport-sized buffers, irrespective of the authored composition's dimensions.
    const canvases = 1 + main.buffers + extras.reduce((n, r) => n + r.buffers, 0) + (main.luma || extras.some((r) => r.luma) ? 1 : 0);
    const bytes = te.encode(JSON.stringify(out));
    return bytes.length <= max ? { json: out, bytes, mime: 'application/json', w: out.w, h: out.h, frames: out.op - out.ip, fr: out.fr, canvases } : null;
  };
  const lottieBytes = (b, max) => {
    let i = 0;
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
    while (i < b.length && (b[i] === 32 || b[i] === 9 || b[i] === 10 || b[i] === 13)) i++;
    if (b[i] !== 0x7b || b.length > max) return null;
    let s;
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return null; }
    return lottie(s, max);
  };

  // ---- any of them ----------------------------------------------------------------------------------------------
  // → { type: 'video' | 'image' | 'lottie', mime, bytes (cleaned), ... } or null. use is 'bg' (a Look's background) or
  // 'sticker' (a picture or animation a mod carries, which has no video).
  const check = (b, use = 'bg') => {
    if (!(b instanceof Uint8Array) || !b.length) return null;
    const L = LIMIT[use];
    if (use === 'bg') {
      const v = b.length <= L.video && video(b);
      if (v) return { type: 'video', ...v };
    }
    const pic = b.length <= L.image.bytes ? (webp(b, L.image) || avif(b, L.image) || (use === 'sticker' && png(b, L.image))) : null;
    if (pic) return { type: 'image', ...pic };
    const l = lottieBytes(b, L.lottie);
    return l ? { type: 'lottie', ...l } : null;
  };

  // ---- packs a mod carries --------------------------------------------------------------------------------------
  // mod.json's `packs`: stickers (a picture, an animated WebP or AVIF, or a Lottie file) and pets (a sprite sheet in the pet
  // layout, which lib/petsprites.js decodes, checks and re-encodes when the student adds it). Each is { id, name, file }, the
  // file one of the bundle's (has(file)). Cleaned the way lib/modbundle.js checks a manifest: every key known, every value as
  // written, or null. The bytes of a sticker are read when it is asked for (check), whatever the manifest says of them.
  const PACK_ID = /^[a-z][a-z0-9-]{0,31}$/;
  const PACK_FILE = { stickers: /\.(png|webp|avif|json)$/i, pets: /\.(png|webp)$/i };
  const packs = (raw, has = () => true) => {
    if (!isObj(raw) || !Object.keys(raw).length || Object.keys(raw).some((k) => !Object.hasOwn(PACK_FILE, k))) return null;
    const out = {};
    for (const k of Object.keys(PACK_FILE)) {
      if (!Object.hasOwn(raw, k)) continue;
      const max = k === 'stickers' ? LIMIT.stickers : LIMIT.pets, list = raw[k];
      if (!Array.isArray(list) || !list.length || list.length > max) return null;
      const ids = new Set();
      out[k] = [];
      for (const e of list) {
        if (!isObj(e) || Object.keys(e).length !== 3 || !['id', 'name', 'file'].every((f) => Object.hasOwn(e, f))) return null;
        const { id, name, file } = e;
        const one = typeof name === 'string' && name.length > 0 && name.length <= 160 && name === name.replace(/\s+/g, ' ').trim() && !/[\p{Cc}\p{Bidi_Control}]/u.test(name) && [...name].length <= 40;
        const path = typeof file === 'string' && file.length <= 200 && /^(?:[\w-][\w.-]*\/){0,7}[\w-][\w.-]*$/.test(file) && PACK_FILE[k].test(file);
        if (typeof id !== 'string' || !PACK_ID.test(id) || ids.has(id) || !one || !path || !has(file)) return null;
        ids.add(id);
        out[k].push({ id, name, file });
      }
    }
    return out;
  };

  // ---- the files this computer keeps ----------------------------------------------------------------------------
  const HASH = /^[\w-]{43}$/;
  const size = (rec) => (rec && typeof rec.b === 'string' ? Math.floor(rec.b.length * 3 / 4) : 0);
  // A kept file, read back and checked against its name; null when it is not there or not what it says.
  const read = async (local, h) => {
    if (!HASH.test(h)) return null;
    const rec = (await local.get(`${KEY}${h}`))[`${KEY}${h}`];
    if (!isObj(rec) || typeof rec.b !== 'string' || typeof rec.t !== 'string') return null;
    let bytes;
    try { bytes = unstd(rec.b); } catch { return null; }
    const got = check(bytes, 'bg');
    return got && got.mime === rec.t && await sha(got.bytes) === h ? got : null;
  };
  // The file a `file:<hash>` address names.
  const fileOf = (src) => (typeof src === 'string' && src.startsWith('file:') && HASH.test(src.slice(5)) ? src.slice(5) : null);
  const lottieFrom = async (src, local, env) => {
    const h = fileOf(src);
    if (h) { const f = await read(local, h); return f?.type === 'lottie' ? { ok: true, json: JSON.parse(td.decode(f.bytes)), canvases: f.canvases } : { ok: false, error: 'missing' }; }
    const url = X().MEDIA.url(src);
    if (!url || url !== src || !env.fetch) return { ok: false, error: 'bad' };
    if (!await env.allow(src)) return { ok: false, error: 'bad' };
    let r;
    try {
      r = await env.fetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual', signal: AbortSignal.timeout(LIMIT.fetch) });
    } catch { return { ok: false, error: 'network' }; }
    // A redirect is refused rather than followed to somewhere the Look did not name.
    if (r.type === 'opaqueredirect' || !r.ok || (r.status >= 300 && r.status < 400)) { r.body?.cancel?.().catch(() => {}); return { ok: false, error: 'network' }; }
    if (Number(r.headers.get('content-length')) > LIMIT.bg.lottie) { r.body?.cancel?.().catch(() => {}); return { ok: false, error: 'big' }; }
    const parts = [];
    let n = 0;
    try {
      const reader = r.body.getReader();
      for (let x = await reader.read(); !x.done; x = await reader.read()) {
        n += x.value.length;
        if (n > LIMIT.bg.lottie) { reader.cancel().catch(() => {}); return { ok: false, error: 'big' }; }
        parts.push(x.value);
      }
    } catch { return { ok: false, error: 'network' }; }
    const got = lottie(td.decode(cat(...parts)));
    return got ? { ok: true, json: got.json, canvases: got.canvases } : { ok: false, error: 'type' };
  };
  // ops: put { kind, b64, expect? } → { ok, h (its name), type, mime, size, width?, height?, frames? }; list; drop { h }; lottie { src } → { ok, json }.
  // env: { fetch, allow(src) → whether this page may have that address fetched } for lottie.
  const change = async (m, { local }, env = {}) => {
    if (m.op === 'list') {
      const all = await local.get(null);
      return { ok: true, files: Object.entries(all).filter(([k]) => k.startsWith(KEY) && HASH.test(k.slice(KEY.length))).map(([k, v]) => ({ h: k.slice(KEY.length), t: v?.t, size: size(v) })) };
    }
    if (m.op === 'drop') return HASH.test(m.h) ? { ok: await local.remove(`${KEY}${m.h}`) } : { ok: false, error: 'bad' };
    if (m.op === 'lottie') return lottieFrom(m.src, local, env);
    if (m.op !== 'put' || !TYPES.includes(m.kind) || typeof m.b64 !== 'string') return { ok: false, error: 'bad' };
    const cap = m.kind === 'video' ? LIMIT.bg.video : m.kind === 'image' ? LIMIT.bg.image.bytes : LIMIT.bg.lottie;
    if (m.b64.length > Math.ceil(cap * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(m.b64)) return { ok: false, error: 'big' };
    let bytes;
    try { bytes = unstd(m.b64); } catch { return { ok: false, error: 'bad' }; }
    const got = check(bytes, 'bg');
    if (!got || got.type !== m.kind) return { ok: false, error: 'type' };
    const h = await sha(got.bytes);
    // expect: the name a Look gave the file; bytes that are not that file are not kept.
    if (m.expect !== undefined && m.expect !== h) return { ok: false, error: 'hash' };
    const kept = { ok: true, h, type: got.type, mime: got.mime, size: got.bytes.length, width: got.w, height: got.h, frames: got.frames };
    const all = await local.get(null);
    if (all[`${KEY}${h}`]?.b === std(got.bytes)) return kept;
    const others = Object.entries(all).filter(([k]) => k.startsWith(KEY) && k !== `${KEY}${h}`).reduce((n, [, v]) => n + size(v), 0);
    if (others + got.bytes.length > LIMIT.total) return { ok: false, error: 'full' };
    if (!await local.set({ [`${KEY}${h}`]: { t: got.mime, b: std(got.bytes) } })) return { ok: false, error: 'write' };
    return kept;
  };

  return { LIMIT, TYPES, KEY, HASH, std, unstd, b64u, sha, webp, png, avif, video, lottie, check, packs, read, fileOf, change };
})();
if (typeof module !== 'undefined') module.exports = GZ_MEDIA; else GZ_MEDIA;
