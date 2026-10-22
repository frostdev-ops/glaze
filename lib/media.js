// Media a Look or a mod brings: a looping video, an animated picture or a Lottie animation behind the page (bg.kind
// "media", cleaned in lib/lookparts.js, drawn by lib/scene-media.js), and the stickers a mod carries. Everything here is
// someone else's bytes, so nothing is trusted until it has been read within hard limits: the container is walked (never
// decoded), its size, frames and pixels are capped, and a file Glaze keeps is the cleaned one (a WebP rebuilt from the
// chunks that draw, a Lottie file rewritten from what it may hold, a video or AVIF picture with the details a phone or an editor
// put in it taken out), named by its SHA-256. Nothing here runs code.
// Also the worker's 'glaze:media' operations (change): the files this computer keeps for a Look (the worker's IndexedDB, with
// a small index in storage.local; put by the editor, a Look share or the gallery), and what a page asks for, cleaned: a Lottie
// file's JSON, or a video or picture, from a kept file or from the address the worn Look names (fetched here under the same
// limits, never loaded by the page). Classic script for the worker, the editor and node.
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
      out = new Uint8Array(b);
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
  // ("avis"), its size from `ispe` and its frames from the sample table. Not rebuilt: the picture's own stream is kept as it came,
  // and what names a person, a place or a device is taken out of the boxes around it afterwards (see "metadata" below).
  const boxes = (b, from, to) => {
    const out = [];
    let i = from;
    while (i < to) {
      if (i + 8 > to) return null;
      let size = be32(b, i), head = 8;
      if (size === 1) { if (i + 16 > to || be32(b, i + 8)) return null; size = be32(b, i + 12); head = 16; } else if (size === 0) size = to - i;
      if (size < head || i + size > to) return null;
      out.push({ type: four(b, i + 4), start: i, at: i + head, end: i + size });
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

  // ---- metadata -------------------------------------------------------------------------------------------------
  // WebP, PNG and JPEG are rebuilt from the parts that draw them. A video or an AVIF picture is not decoded or rebuilt, so what
  // names a person, a place, a device or a time is taken out of the containers around the stream instead (LOOK-11): boxes and
  // elements that carry it are overwritten with free space (an ISO `free` box, a Matroska Void), times are set to zero, handler
  // and compressor names are blanked, a movie's timed-metadata tracks (GPS, faces) lose their samples, and an AVIF picture's Exif
  // and XMP items are taken out of its item tables. Everything but those tables is done in place, so the file keeps its size
  // and no offset in it moves. Doing it twice changes nothing more, which keeps a kept file's name (its hash) what it was.
  // What stays: the codec's own bytes (an encoder may have left its name in the stream's user data) and the pixels. A file whose
  // structure can't be taken apart safely is refused (examine: error 'meta'), never kept with its metadata. Each cleaner gives
  // the new bytes, or null; the file it is given has already been walked whole by its reader above.
  const be16 = (b, i) => b[i] * 256 + b[i + 1];
  const be = (b, i, n) => { let v = 0; for (let j = 0; j < n; j++) v = v * 256 + b[i + j]; return v; }; // n bytes, 0 to 8
  const put16 = (n) => Uint8Array.of((n >> 8) & 255, n & 255);
  const put32be = (n) => Uint8Array.of((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  const free = (out, box) => { out.set(ascii('free'), box.start + 4); out.fill(0, box.at, box.end); };
  const insideData = (data, at, size) => {
    let lo = 0, hi = data.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (data[mid][0] <= at) lo = mid + 1; else hi = mid; }
    return lo > 0 && Number.isSafeInteger(at + size) && at + size <= data[lo - 1][1];
  };

  // ISO boxes: what each container of a movie may hold and still play. The rest is set to free space.
  const MOVIE = {
    moov: ['mvhd', 'trak', 'mvex'], trak: ['tkhd', 'edts', 'mdia', 'tref'], edts: ['elst'], mdia: ['mdhd', 'elng', 'hdlr', 'minf'],
    minf: ['vmhd', 'smhd', 'nmhd', 'hmhd', 'sthd', 'hdlr', 'dinf', 'stbl'], dinf: ['dref'],
    stbl: ['stsd', 'stts', 'ctts', 'cslg', 'stsc', 'stsz', 'stz2', 'stco', 'co64', 'stss', 'stps', 'stsh', 'sdtp', 'sbgp', 'sgpd', 'saiz', 'saio', 'subs', 'padb', 'stdp'],
    mvex: ['mehd', 'trex', 'trep', 'leva'], moof: ['mfhd', 'traf'], traf: ['tfhd', 'tfdt', 'trun', 'sbgp', 'sgpd', 'subs', 'saiz', 'saio', 'senc'],
  };
  // The tracks that draw or sound. Any other (timed metadata, text, timecode, hints) is taken out whole, with its samples.
  const DRAWS = ['vide', 'soun', 'pict', 'auxv'];
  const PICTURES = ['vide', 'pict', 'auxv'];
  // The bytes a track's samples take in the file, set to zero: its chunks (stco or co64) hold as many samples as stsc says, each as
  // long as stsz says, inside the data boxes (data: [start, end] of each). false when the tables don't add up.
  const emptied = (b, out, trak, data, budget) => {
    const stbl = dig(b, trak, ['mdia', 'minf', 'stbl'])?.[0];
    if (!stbl) return true;
    const kids = boxes(b, stbl.at, stbl.end);
    if (!kids || kids.some((k) => k.type === 'stz2')) return false;
    const one = (t) => kids.filter((k) => k.type === t);
    const [stsc] = one('stsc'), [stsz] = one('stsz'), [stco] = one('stco'), [co64] = one('co64'), table = stco || co64;
    if (one('stsc').length > 1 || one('stsz').length > 1 || (stco && co64) || !stsc || !stsz || !table || stsc.end - stsc.at < 8 || stsz.end - stsz.at < 12 || table.end - table.at < 8) return false;
    const w = stco ? 4 : 8, chunks = be32(b, table.at + 4), runs = be32(b, stsc.at + 4), fixed = be32(b, stsz.at + 4), count = be32(b, stsz.at + 8);
    if (table.end - table.at < 8 + chunks * w || stsc.end - stsc.at < 8 + runs * 12 || (!fixed && stsz.end - stsz.at < 12 + count * 4) || (chunks && !runs)) return false;
    // Fixed-size samples have no per-sample table to bound their count: the bytes must bound it instead.
    if (fixed && count > Math.floor(b.length / fixed)) return false;
    for (let r = 0; r < runs; r++) {
      const first = be32(b, stsc.at + 8 + r * 12);
      if ((!r && first !== 1) || (r && first <= be32(b, stsc.at + 8 + (r - 1) * 12)) || first > chunks || !be32(b, stsc.at + 12 + r * 12)) return false;
    }
    let sample = 0, run = 0;
    for (let c = 1; c <= chunks; c++) {
      while (run + 1 < runs && be32(b, stsc.at + 8 + (run + 1) * 12) <= c) run++;
      let size = 0;
      for (let i = be32(b, stsc.at + 12 + run * 12); i > 0; i--, sample++) {
        if (sample >= count) return false;
        size += fixed || be32(b, stsz.at + 12 + sample * 4);
      }
      const at = be(b, table.at + 8 + (c - 1) * w, w);
      if (!insideData(data, at, size) || (budget.n += size) > b.length) return false;
      out.fill(0, at, at + size);
    }
    return sample === count;
  };
  // One box of a movie and what is in it: times at zero, names blanked, whatever its container may not hold set to free space.
  const tidy = (b, out, box, picture) => {
    const n = box.end - box.at;
    if (['mvhd', 'tkhd', 'mdhd'].includes(box.type)) {
      const times = b[box.at] === 1 ? 16 : 8; // creation and modification
      if (n < 4 + times + 4) return false;
      out.fill(0, box.at + 4, box.at + 4 + times);
      return true;
    }
    if (box.type === 'hdlr') { if (n < 24) return false; out.fill(0, box.at + 24, box.end); return true; } // the handler's name
    if (box.type === 'dref') {
      // Data in other files can't play and may say where they are: every reference must be to this file.
      const refs = n >= 8 && boxes(b, box.at + 8, box.end);
      return !!refs && refs.length === be32(b, box.at + 4) && refs.every((r) => r.type === 'url ' && r.end - r.at === 4 && (b[r.at + 3] & 1));
    }
    if (box.type === 'stsd') {
      const entries = n >= 8 && boxes(b, box.at + 8, box.end);
      if (!entries) return false;
      for (const e of entries) {
        const head = picture ? 78 : 28;
        if (e.end - e.at < head || (!picture && (!['mp4a', 'Opus', 'ac-3', 'ec-3', 'alac', 'fLaC'].includes(e.type) || be16(b, e.at + 8) !== 0))) return false;
        if (picture) out.fill(0, e.at + 42, e.at + 74); // the compressor's name
        const ext = boxes(b, e.at + head, e.end);
        if (!ext) return false;
        const keep = picture ? ['avcC', 'hvcC', 'av1C', 'vpcC', 'pasp', 'clap', 'colr', 'btrt', 'fiel', 'gama'] : ['esds', 'dOps', 'dac3', 'dec3', 'alac', 'dfLa', 'chan', 'btrt'];
        for (const x of ext) if (!keep.includes(x.type)) free(out, x);
      }
      return true;
    }
    const allowed = MOVIE[box.type];
    if (!allowed) return true;
    const kids = boxes(b, box.at, box.end);
    if (!kids) return false;
    for (const k of kids) if (!allowed.includes(k.type)) free(out, k); else if (!tidy(b, out, k, picture)) return false;
    return true;
  };
  const handlerOf = (b, trak) => { const h = dig(b, trak, ['mdia', 'hdlr'])?.[0]; return h && h.end - h.at >= 12 ? four(b, h.at + 8) : ''; };
  // A movie box: tidied, and without the tracks that neither draw nor sound. A movie in fragments can't lose a track, because its
  // samples can't be found from its tables.
  const scrubMovie = (b, out, moov, data, fragments = false) => {
    const kids = boxes(b, moov.at, moov.end);
    if (!kids) return false;
    const fragmented = fragments || kids.some((k) => k.type === 'mvex');
    const tracks = [];
    const budget = { n: 0 }; // repeated or overlapping sample ranges cannot amplify work beyond the file size
    let dropped = false;
    for (const k of kids) {
      if (k.type !== 'trak') { if (!MOVIE.moov.includes(k.type)) free(out, k); else if (!tidy(b, out, k)) return false; continue; }
      const handler = handlerOf(b, k);
      if (!DRAWS.includes(handler)) {
        if (fragmented || !emptied(b, out, k, data, budget)) return false;
        free(out, k);
        dropped = true;
      } else if (tidy(b, out, k, PICTURES.includes(handler))) tracks.push(k); else return false;
    }
    if (!tracks.length && kids.some((k) => k.type === 'trak')) return false;
    // What a track referred to is gone with it.
    if (dropped) for (const k of tracks) for (const r of boxes(b, k.at, k.end).filter((x) => x.type === 'tref')) free(out, r);
    return true;
  };
  // An MP4: the movie scrubbed, the data and the fragments left alone, every other box (user data, meta, uuid and XMP boxes, padding,
  // anything unknown) set to free space.
  const scrubMp4 = (b) => {
    const top = boxes(b, 0, b.length), out = new Uint8Array(b);
    if (!top) return null;
    const fragments = top.some((t) => t.type === 'moof'), data = top.filter((t) => t.type === 'mdat').map((t) => [t.at, t.end]);
    for (const t of top) {
      if (['ftyp', 'mdat', 'sidx', 'styp', 'mfra'].includes(t.type)) continue;
      if (t.type === 'moov') { if (!scrubMovie(b, out, t, data, fragments)) return null; } else if (t.type === 'moof') { if (!tidy(b, out, t)) return null; } else free(out, t);
    }
    return out;
  };

  // AVIF: a picture's Exif and XMP are items like its pictures: named in `iinf`, placed by `iloc`, tied by `iref`, their bytes in `mdat`
  // (or `idat`). They are taken out of the tables, which makes `meta` shorter: the difference becomes a `free` box right after it,
  // so nothing after it moves, and their bytes are zeroed. A decoder reads an Exif item it finds, so one left empty isn't safe.
  const METADATA = ['Exif', 'mime', 'uri '];
  const scrubMeta = (b, out, meta, data) => {
    const kids = boxes(b, meta.at + 4, meta.end);
    if (!kids || meta.at - meta.start !== 8) return false;
    if (['hdlr', 'pitm', 'iloc', 'iinf', 'iref', 'iprp', 'idat', 'dinf'].some((type) => kids.filter((k) => k.type === type).length > 1)) return false;
    const properties = dig(b, meta, ['iprp', 'ipco'], true);
    if (!properties || properties.length > 1) return false;
    for (const co of properties) {
      const props = boxes(b, co.at, co.end);
      if (!props) return false;
      for (const p of props) {
        if (!['ispe', 'pixi', 'av1C', 'colr', 'clap', 'irot', 'imir', 'auxC', 'pasp', 'lsel', 'a1lx', 'a1op'].includes(p.type)) return false;
        // ICC profiles may contain device names, dates and arbitrary metadata; a numeric NCLX color description does not.
        if (p.type === 'colr' && (p.end - p.at !== 11 || four(b, p.at) !== 'nclx')) return false;
      }
    }
    for (const k of kids) {
      if (k.type === 'hdlr') { if (k.end - k.at < 24) return false; out.fill(0, k.at + 24, k.end); } else if (!['pitm', 'iloc', 'iinf', 'iref', 'iprp', 'idat', 'grpl', 'dinf'].includes(k.type)) free(out, k);
    }
    const [iinf] = kids.filter((k) => k.type === 'iinf');
    if (!iinf) return true;
    // iinf: the items, by number and kind.
    const wide = b[iinf.at] > 0, entries = iinf.end - iinf.at >= 8 ? boxes(b, iinf.at + (wide ? 8 : 6), iinf.end) : null;
    if (!entries || entries.length !== (wide ? be32(b, iinf.at + 4) : be16(b, iinf.at + 4)) || !entries.every((e) => e.type === 'infe' && b[e.at] >= 2 && b[e.at] <= 3 && e.end - e.at >= 12)) return false;
    const items = entries.map((e) => ({ box: e, id: b[e.at] === 2 ? be16(b, e.at + 4) : be(b, e.at + 4, 4), kind: four(b, e.at + (b[e.at] === 2 ? 8 : 10)) }));
    for (const e of entries) {
      const name = e.at + (b[e.at] === 2 ? 12 : 14);
      let end = name;
      while (end < e.end && b[end]) end++;
      if (end === e.end) return false;
      out.fill(0, name, end); // item names may identify the device or author even on a retained picture
    }
    const gone = new Set(items.filter((i) => METADATA.includes(i.kind)).map((i) => i.id));
    if (!gone.size) return true;
    // Each item has its own number; the primary picture is not one of these, and no property is attached to one.
    const pitm = kids.find((k) => k.type === 'pitm');
    const primary = pitm && pitm.end - pitm.at >= 6 ? (b[pitm.at] ? be(b, pitm.at + 4, 4) : be16(b, pitm.at + 4)) : -1;
    if (new Set(items.map((i) => i.id)).size !== items.length || gone.has(primary) || !items.some((i) => i.id === primary)) return false;
    const ipma = dig(b, meta, ['iprp', 'ipma'], true);
    if (!ipma) return false;
    for (const ma of ipma) {
      const ver = b[ma.at], width = b[ma.at + 3] & 1 ? 2 : 1, idSize = ver ? 4 : 2, n = ma.end - ma.at >= 8 ? be32(b, ma.at + 4) : -1;
      if (n < 0) return false;
      for (let i = ma.at + 8, e = 0; e < n; e++) {
        if (i + idSize + 1 > ma.end) return false;
        if (gone.has(be(b, i, idSize))) return false;
        i += idSize + 1 + b[i + idSize] * width;
      }
    }
    // iloc: where their bytes are, and the table without them.
    const iloc = kids.find((k) => k.type === 'iloc');
    if (!iloc || iloc.end - iloc.at < 8) return false;
    const lv = b[iloc.at], offSize = b[iloc.at + 4] >> 4, lenSize = b[iloc.at + 4] & 15, baseSize = b[iloc.at + 5] >> 4, idxSize = lv ? b[iloc.at + 5] & 15 : 0;
    const ids = lv === 2 ? 4 : 2, count = lv === 2 ? be32(b, iloc.at + 6) : be16(b, iloc.at + 6);
    if (lv > 2 || count > items.length || count > 4096 || iloc.end - iloc.at < 6 + ids || [offSize, lenSize, baseSize, idxSize].some((n) => ![0, 4, 8].includes(n))) return false;
    const rows = [], zero = [];
    const itemIds = new Set(items.map((x) => x.id)), placed = new Set();
    let totalExtents = 0, zeroBytes = 0;
    let i = iloc.at + 6 + ids;
    for (let n = 0; n < count; n++) {
      if (i + ids + (lv ? 2 : 0) + 2 + baseSize + 2 > iloc.end) return false;
      const from = i, id = be(b, i, ids);
      if (!itemIds.has(id) || placed.has(id)) return false;
      placed.add(id);
      const method = lv ? b[i + ids + 1] & 15 : 0;
      i += ids + (lv ? 2 : 0) + 2;
      const base = be(b, i, baseSize), extents = be16(b, i + baseSize);
      i += baseSize + 2;
      const stride = idxSize + offSize + lenSize;
      if ((totalExtents += extents) > 4096 || (extents && !stride) || extents * stride > iloc.end - i) return false;
      for (let e = 0; e < extents; e++) {
        if (i + idxSize + offSize + lenSize > iloc.end) return false;
        const at = be(b, i + idxSize, offSize), size = be(b, i + idxSize + offSize, lenSize);
        i += idxSize + offSize + lenSize;
        // Where their bytes are can be told for a file offset or a place in `idat`, and a length of nothing means "all of it".
        if (gone.has(id)) { if (!lenSize || !size || method > 1 || !Number.isSafeInteger(base + at + size)) return false; zero.push({ method, at: base + at, size }); }
      }
      if (i > iloc.end) return false;
      rows.push({ id, from, to: i });
    }
    if (i !== iloc.end) return false;
    if ([...gone].some((id) => !placed.has(id))) return false;
    const idat = kids.find((k) => k.type === 'idat');
    for (const z of zero) {
      if (z.method && !idat) return false;
      const at = z.method ? idat.at + z.at : z.at;
      if ((zeroBytes += z.size) > b.length || (z.method ? at < idat.at || at + z.size > idat.end : !insideData(data, at, z.size))) return false;
      out.fill(0, at, at + z.size);
    }
    // iref: the links that start at one of them go; a link that points at one means this file isn't one to take apart.
    const iref = kids.find((k) => k.type === 'iref');
    let links = null;
    if (iref) {
      const w = b[iref.at] ? 4 : 2, all = boxes(b, iref.at + 4, iref.end);
      if (!all) return false;
      links = [];
      for (const l of all) {
        const n = l.end - l.at >= w + 2 ? be16(b, l.at + w) : -1;
        if (n < 0 || l.end - l.at !== w + 2 + n * w) return false;
        if (gone.has(be(b, l.at, w))) continue;
        if (Array.from({ length: n }, (_, j) => be(b, l.at + w + 2 + j * w, w)).some((t) => gone.has(t))) return false;
        links.push(b.subarray(l.start, l.end));
      }
    }
    // The tables without them, and `meta` around the tables.
    const box = (type, ...parts) => { const body = cat(...parts); return cat(put32be(body.length + 8), ascii(type), body); };
    const left = items.filter((x) => !gone.has(x.id)), place = rows.filter((r) => !gone.has(r.id));
    const tables = new Map([
      [iinf, box('iinf', b.subarray(iinf.at, iinf.at + 4), wide ? put32be(left.length) : put16(left.length), ...left.map((x) => out.subarray(x.box.start, x.box.end)))],
      [iloc, box('iloc', b.subarray(iloc.at, iloc.at + 6), lv === 2 ? put32be(place.length) : put16(place.length), ...place.map((r) => b.subarray(r.from, r.to)))],
    ]);
    if (iref) tables.set(iref, links.length ? box('iref', b.subarray(iref.at, iref.at + 4), ...links) : new Uint8Array());
    const inner = cat(b.subarray(meta.at, meta.at + 4), ...kids.map((k) => tables.get(k) ?? out.slice(k.start, k.end)));
    const whole = cat(put32be(inner.length + 8), ascii('meta'), inner), pad = meta.end - meta.start - whole.length;
    if (pad < 8) return false;
    out.set(whole, meta.start);
    out.set(cat(put32be(pad), ascii('free')), meta.start + whole.length);
    out.fill(0, meta.start + whole.length + 8, meta.end);
    return true;
  };
  const scrubAvif = (b) => {
    const top = boxes(b, 0, b.length), out = new Uint8Array(b);
    if (!top) return null;
    const data = top.filter((t) => t.type === 'mdat').map((t) => [t.at, t.end]);
    for (const t of top) {
      if (['ftyp', 'mdat'].includes(t.type)) continue;
      if (t.type === 'meta') { if (!scrubMeta(b, out, t, data)) return null; } else if (t.type === 'moov') { if (!scrubMovie(b, out, t, data)) return null; } else free(out, t);
    }
    return out;
  };

  // WebM: Matroska elements. Anything that names a person or a time is overwritten with a Void element of the same length (an
  // ID, a length and zeros), so every size and offset in the file stands. The segment keeps its seek head, info, tracks, clusters and
  // cues; its tags, attachments, chapters and anything unknown go. Info keeps the clock and the duration, a track keeps what plays
  // it, and the names, the dates and the program that wrote the file are gone.
  const EBML = { Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966, Tracks: 0x1654ae6b, Cluster: 0x1f43b675, Cues: 0x1c53bb6b, Void: 0xec, CRC: 0xbf, TrackEntry: 0xae };
  const INFO_KEEP = [0x2ad7b1, 0x4489]; // TimecodeScale, Duration
  const INFO_BLANK = [0x4d80, 0x5741]; // MuxingApp and WritingApp stay, with nothing in them
  const TRACK_DROP = [0x536e, 0x258688, 0x7446, 0x6624, EBML.CRC]; // Name, CodecName, AttachmentLink, TrackTranslate
  // What a cluster holds, so an unknown length can be told from where the next segment child begins.
  const IN_CLUSTER = [0xe7, 0x5854, 0xa7, 0xab, 0xa3, 0xa0, 0xaf, EBML.Void, EBML.CRC];
  // The element at i: { id, start, at (where its payload begins), end } with end -1 for an unknown length, or null.
  const element = (b, i, to) => {
    if (i >= to) return null;
    let n = 1;
    while (n <= 4 && !(b[i] & (128 >> (n - 1)))) n++;
    if (n > 4 || i + n >= to) return null;
    const id = be(b, i, n);
    let m = 1;
    while (m <= 8 && !(b[i + n] & (128 >> (m - 1)))) m++;
    if (m > 8 || i + n + m > to) return null;
    let size = b[i + n] & ((128 >> (m - 1)) - 1), unknown = size === (128 >> (m - 1)) - 1;
    for (let j = 1; j < m; j++) { unknown &&= b[i + n + j] === 255; size = size * 256 + b[i + n + j]; }
    const at = i + n + m;
    return { id, start: i, at, end: unknown ? -1 : Number.isSafeInteger(size) && at + size <= to ? at + size : null };
  };
  // The children of an element between from and to, in order and covering all of it, or null.
  const children = (b, from, to, segment = false) => {
    const out = [];
    for (let i = from; i < to;) {
      const e = element(b, i, to);
      if (!e || e.end === null) return null;
      if (e.end === -1) {
        // A segment or cluster of no stated length runs to its parent's end; a cluster ends where something that isn't in one begins.
        let end = to;
        if (segment && e.id === EBML.Cluster) {
          end = e.at;
          for (let x = element(b, end, to); x && IN_CLUSTER.includes(x.id) && x.end > 0; x = element(b, end, to)) end = x.end;
        } else if (e.id !== EBML.Segment) return null;
        e.end = end;
      }
      out.push(e);
      i = e.end;
      if (out.length > 100000) return null;
    }
    return out;
  };
  // A Void element over [start, end): the ID, a length that makes the whole element end - start long, and zeros.
  const voided = (out, start, end) => {
    const total = end - start;
    for (let m = 1; m <= 8; m++) {
      const payload = total - 1 - m;
      if (payload >= 0 && payload < 2 ** (7 * m) - 1) {
        out.fill(0, start, end);
        out[start] = EBML.Void;
        for (let j = 0, v = payload; j < m; j++, v = Math.floor(v / 256)) out[start + m - j] = v & 255;
        out[start + 1] |= 128 >> (m - 1);
        return true;
      }
    }
    return false;
  };
  const scrubWebm = (b) => {
    const out = new Uint8Array(b), top = children(b, 0, b.length, true);
    if (!top) return null;
    const drop = (e) => voided(out, e.start, e.end);
    for (const seg of top) {
      if (seg.id !== EBML.Segment) continue;
      const parts = children(b, seg.at, seg.end, true);
      if (!parts) return null;
      for (const p of parts) {
        if (p.id === EBML.Info || p.id === EBML.Tracks) {
          const inside = children(b, p.at, p.end);
          if (!inside) return null;
          for (const e of inside) {
            if (p.id === EBML.Info) {
              if (INFO_BLANK.includes(e.id)) out.fill(0, e.at, e.end); else if (!INFO_KEEP.includes(e.id) && !drop(e)) return null;
            } else if (e.id === EBML.TrackEntry) {
              const fields = children(b, e.at, e.end);
              if (!fields) return null;
              const types = fields.filter((f) => f.id === 0x83);
              // Dropping subtitle/metadata blocks without disturbing cluster offsets needs more than a track-header rewrite.
              if (types.length !== 1 || types[0].end - types[0].at !== 1 || ![1, 2].includes(b[types[0].at])) return null;
              for (const f of fields) if (TRACK_DROP.includes(f.id) && !drop(f)) return null;
            } else if (e.id === EBML.CRC && !drop(e)) return null;
          }
        } else if (p.id === EBML.Void) out.fill(0, p.at, p.end);
        else if (![EBML.SeekHead, EBML.Cluster, EBML.Cues].includes(p.id) && !drop(p)) return null;
      }
    }
    return out;
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
        if (k.startsWith('__') || k === 'constructor' || k === 'prototype' || (k === 'x' && typeof v[k] === 'string') || !scan(v[k], depth + 1, k)) return false;
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
        // Only the player may expand refId into children or mark a layer as already processed.
        if (Object.hasOwn(l, 'layers') || Object.hasOwn(l, 'completed')) return false;
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
  // 'sticker' (a picture or animation a mod carries, which has no video). examine tells a file that isn't one of these ({ error:
  // 'type' }) from one that is but whose metadata can't be taken out ({ error: 'meta', type }); a video or AVIF picture comes back
  // with its metadata gone (see "metadata" above).
  const SCRUB = { 'video/webm': scrubWebm, 'video/mp4': scrubMp4, 'image/avif': scrubAvif };
  const examine = (b, use = 'bg') => {
    if (!(b instanceof Uint8Array) || !b.length) return { error: 'type' };
    const L = LIMIT[use];
    let got = null;
    const v = use === 'bg' && b.length <= L.video && video(b);
    if (v) got = { type: 'video', ...v };
    const pic = !got && b.length <= L.image.bytes ? (webp(b, L.image) || avif(b, L.image) || (use === 'sticker' && png(b, L.image))) : null;
    if (pic) got = { type: 'image', ...pic };
    const l = !got && lottieBytes(b, L.lottie);
    if (l) got = { type: 'lottie', ...l };
    if (!got) return { error: 'type' };
    const clean = SCRUB[got.mime];
    if (!clean) return { got };
    // A cleaner that broke what it cleaned is as good as one that could not clean it: the result is read again whole.
    const bytes = clean(got.bytes), again = bytes && (got.type === 'video' ? video(bytes) : avif(bytes, L.image));
    return again?.mime === got.mime ? { got: { ...got, bytes } } : { error: 'meta', type: got.type };
  };
  const check = (b, use = 'bg') => examine(b, use).got || null;

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
  // Each file's bytes, as base64 (what a page is handed), live in the worker's own IndexedDB, which no school page can open:
  // area.files is { get(h), put(h, rec), del([h]), keys() } over records { t: mime, b, c?: Lottie canvases }. storage.local keeps only a small
  // index, `lookMediaIndex`: { [h]: { t, n: bytes, at: when kept, p: true while only an offer names it } }, so listing and
  // sizing never read a file. A file is checked and named by its hash when it is put, and trusted after: only put writes it.
  const HASH = /^[\w-]{43}$/;
  const INDEX = 'lookMediaIndex';
  const MINUTE = 60e3, HOUR = 60 * MINUTE;
  const index = async (local) => {
    const v = (await local.get(INDEX))[INDEX];
    return Object.fromEntries(Object.entries(isObj(v) ? v : {}).filter(([h, e]) => HASH.test(h) && isObj(e) && typeof e.t === 'string' && Number.isFinite(e.n)));
  };
  const keepIndex = (local, idx) => (Object.keys(idx).length ? local.set({ [INDEX]: idx }) : local.remove(INDEX));
  const kindOf = (mime) => (mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'lottie');
  // A record checked against the name it is kept under: what it holds, its type and its hash; null when it isn't that file.
  const verify = async (rec, h) => {
    if (!isObj(rec) || typeof rec.b !== 'string' || typeof rec.t !== 'string') return null;
    let bytes;
    try { bytes = unstd(rec.b); } catch { return null; }
    const seen = examine(bytes, 'bg'), got = seen.got;
    if (!got) {
      // A new metadata refusal must not destroy an older local original. examine already bounded its size/container;
      // the original MIME, dimensions and exact hash still have to agree. New put/remote paths never use this exception.
      if (seen.error !== 'meta' || !SCRUB[rec.t]) return null;
      const original = seen.type === 'video' ? video(bytes) : avif(bytes, LIMIT.bg.image);
      return original?.mime === rec.t && await sha(bytes) === h ? { type: seen.type, ...original, legacy: true } : null;
    }
    if (got.mime !== rec.t) return null;
    if (await sha(got.bytes) === h) return got;
    // A video or AVIF picture an older Glaze kept was named by the file as it came, metadata and all. It still plays and moves
    // over, but it is no file to send anywhere (read gives none of these): keeping it again makes the clean one, with its own name.
    return SCRUB[got.mime] && await sha(bytes) === h ? { ...got, bytes, legacy: true } : null;
  };
  // Files an older Glaze kept as base64 in storage.local (`lookMedia:<hash>`) move to the files store, each checked once more;
  // one that isn't what its name says is dropped. keys: the storage keys to look at. → { [h]: record } for those moved.
  const migrate = async ({ local, files }, keys) => {
    const old = Object.entries(await local.get(keys.filter((k) => k.startsWith(KEY))));
    const moved = {};
    if (!old.length) return moved;
    const idx = await index(local);
    for (const [k, rec] of old) {
      const h = k.slice(KEY.length), got = HASH.test(h) && await verify(rec, h);
      if (!got) continue;
      await files.put(h, { t: rec.t, b: rec.b, ...(got.canvases && { c: got.canvases }) });
      idx[h] = { t: rec.t, n: got.bytes.length, at: Date.now() };
      moved[h] = { t: rec.t, b: rec.b };
    }
    // Callers such as Reset must not proceed as if migration finished while a legacy copy can still reappear later.
    if (Object.keys(moved).length && !await keepIndex(local, idx)) throw new Error('write');
    if (!await local.remove(old.map(([k]) => k))) throw new Error('write');
    return moved;
  };
  // A kept file's record, as put, or null. One an older Glaze kept moves over the first time it is asked for (in queue's turn).
  const stored = async (area, h, queue = (f) => f()) => {
    if (!HASH.test(h)) return null;
    const rec = await area.files.get(h);
    if (isObj(rec) && typeof rec.b === 'string' && typeof rec.t === 'string') return rec;
    return (await queue(() => migrate(area, [`${KEY}${h}`])))[h] || null;
  };
  // A kept file, read back and checked against its name (the worker's own reads: a Lottie file's JSON, a share's upload).
  const read = async (area, h) => { const got = await stored(area, h).then((rec) => rec && verify(rec, h)); return got && !got.legacy ? got : null; };
  // The file a `file:<hash>` address names.
  const fileOf = (src) => (typeof src === 'string' && src.startsWith('file:') && HASH.test(src.slice(5)) ? src.slice(5) : null);
  // The files the Looks on this computer name: `now`, the Look worn (its parts, wherever they are kept), and `saved`, history's
  // and favorites' Looks. decode: lib/share.js decode, for a favorite's code.
  const uses = async ({ sync, local }, decode) => {
    const now = new Set(), saved = new Set();
    const add = (set, parts) => { const h = fileOf(parts?.x?.bg?.media?.src); if (h) set.add(h); };
    const [{ lookX }, { lookHistory, lookFavorites, rotateLooks }] = await Promise.all([sync ? sync.get('lookX') : {}, local.get(['lookHistory', 'lookFavorites', 'rotateLooks'])]);
    // A failed read is not evidence that a file is unused: let collection stop and retry later.
    add(now, await X().fromStored(lookX, local));
    for (const e of Array.isArray(lookHistory) ? lookHistory : []) add(saved, e?.theme?.parts);
    for (const f of Array.isArray(lookFavorites) ? lookFavorites : []) {
      if (typeof f?.code === 'string') add(saved, await Promise.resolve().then(() => decode(f.code)).then((got) => got?.parts, () => null));
    }
    for (const code of Array.isArray(rotateLooks) ? rotateLooks : []) {
      if (typeof code === 'string') add(saved, await Promise.resolve().then(() => decode(code)).then((got) => got?.parts, () => null));
    }
    return { now, saved };
  };
  // Files no Look names any more go: not the Look worn, nor history's or favorites' (env.decode reads their codes). A file just
  // kept waits a minute for the Look that names it to be saved, and one only an offer named waits an hour (the editor's Cancel
  // takes it at once). A record the index doesn't list (a write cut short) goes too, and so does an entry with no record.
  const collect = async (area, { decode, now = Date.now } = {}) => {
    const idx = await index(area.local);
    const named = await uses(area, decode), at = now(), records = new Set(await area.files.keys()), gone = [];
    let changed = false;
    for (const [h, e] of Object.entries(idx)) {
      const used = named.now.has(h) || named.saved.has(h);
      if (!records.has(h) || (!used && at - (e.at || 0) > (e.p ? HOUR : MINUTE))) { delete idx[h]; gone.push(h); changed = true; } else if (used && e.p) { delete e.p; changed = true; }
    }
    if (changed && !await keepIndex(area.local, idx)) return { ok: false, error: 'write', gone: [] };
    const drop = [...records].filter((h) => !Object.hasOwn(idx, h));
    if (drop.length) await area.files.del(drop);
    return { ok: true, gone };
  };
  // How long a fetch may take, and the most bytes a file of each type may be (the editor's put and every fetch below count the same).
  const WAIT = { video: 60000, image: 30000, lottie: LIMIT.fetch };
  const capOf = (type) => (type === 'video' ? LIMIT.bg.video : type === 'image' ? LIMIT.bg.image.bytes : LIMIT.bg.lottie);
  // A response's body, counted as it arrives: → { bytes }, or { error: 'big' | 'network' } with the rest left unread.
  const pull = async (r, cap) => {
    if (Number(r.headers.get('content-length')) > cap) { r.body?.cancel?.().catch(() => {}); return { error: 'big' }; }
    const parts = [];
    let n = 0;
    try {
      const reader = r.body.getReader();
      for (let x = await reader.read(); !x.done; x = await reader.read()) {
        n += x.value.length;
        if (n > cap) { reader.cancel().catch(() => {}); return { error: 'big' }; }
        parts.push(x.value);
      }
    } catch { return { error: 'network' }; }
    return { bytes: cat(...parts) };
  };
  const lottieFrom = async (src, area, env) => {
    const h = fileOf(src);
    if (h) {
      const rec = await stored(area, h);
      // The canvas budget was checked when kept, just as its hash was: pages need neither check again.
      if (rec?.t === 'application/json' && Number.isInteger(rec.c) && rec.c > 0) return { ok: true, json: JSON.parse(td.decode(unstd(rec.b))), canvases: rec.c };
      const f = rec && await read(area, h); // an older record without the checked budget
      return f?.type === 'lottie' ? { ok: true, json: JSON.parse(td.decode(f.bytes)), canvases: f.canvases } : { ok: false, error: 'missing' };
    }
    const url = X().MEDIA.url(src);
    if (!url || url !== src || !env.fetch) return { ok: false, error: 'bad' };
    if (!await env.allow(src)) return { ok: false, error: 'bad' };
    let r;
    try {
      r = await env.fetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual', signal: AbortSignal.timeout(LIMIT.fetch) });
    } catch { return { ok: false, error: 'network' }; }
    // A redirect is refused rather than followed to somewhere the Look did not name.
    if (r.type === 'opaqueredirect' || r.redirected || !r.ok || (r.status >= 300 && r.status < 400)) { r.body?.cancel?.().catch(() => {}); return { ok: false, error: 'network' }; }
    const body = await pull(r, LIMIT.bg.lottie);
    if (!body.bytes) return { ok: false, error: body.error };
    const got = lottie(td.decode(body.bytes));
    return got ? { ok: true, json: got.json, canvases: got.canvases } : { ok: false, error: 'type' };
  };
  // ---- a file at an address a Look names ------------------------------------------------------------------------
  // A video or an animated picture by https address (a page asks through the worker, which allows only the address the worn Look
  // names: env.allow). Fetched here with no cookies, no referrer and no redirect, a time limit and a byte cap by type, then read
  // as any file Glaze keeps is (check: container, size, frames, pixels, metadata), so the page plays a checked copy and never
  // the address, and a file past the limits is refused wherever it is hosted. → { ok: true, type, mime, b64 } or { ok: false,
  // error }: bad (not an address that may be fetched), network, big, type (not that kind of file, or past a limit).
  const remoteFrom = async (src, kind, env) => {
    if (kind !== 'video' && kind !== 'image') return { ok: false, error: 'bad' };
    const url = X().MEDIA.url(src);
    if (!url || url !== src || !env.fetch) return { ok: false, error: 'bad' };
    if (!await env.allow(src)) return { ok: false, error: 'bad' };
    let r;
    try {
      r = await env.fetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual', signal: AbortSignal.timeout(WAIT[kind]) });
    } catch { return { ok: false, error: 'network' }; }
    // A redirect is refused rather than followed to somewhere the Look did not name (the worker is not held to the page's
    // rules about the local network, so where a request lands matters).
    if (r.type === 'opaqueredirect' || r.redirected || !r.ok || (r.status >= 300 && r.status < 400)) { r.body?.cancel?.().catch(() => {}); return { ok: false, error: 'network' }; }
    const body = await pull(r, capOf(kind));
    if (!body.bytes) return { ok: false, error: body.error };
    const got = check(body.bytes, 'bg');
    return got?.type === kind ? { ok: true, type: got.type, mime: got.mime, b64: std(got.bytes) } : { ok: false, error: 'type' };
  };
  // ---- a gallery Look's file ------------------------------------------------------------------------------------
  // "Use this Look in Glaze" on the gallery, for a Look whose background is `file:<h>`: the one file the gallery keeps under
  // that name, from this fixed address only, with no cookies, no referrer and no redirects, a time limit and a byte cap by
  // type (counted as it arrives). → { ok: true, b64 } for put with expect: h (which cleans it again and requires the name),
  // or { ok: false, error }. Nothing is sent but the name.
  const GALLERY = 'https://frostdev.io/glaze/looks/api/media/';
  const fromGallery = async (h, type, { fetch }) => {
    if (!HASH.test(h) || !TYPES.includes(type)) return { ok: false, error: 'bad' };
    let r;
    try {
      r = await fetch(`${GALLERY}${h}`, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(WAIT[type]) });
    } catch { return { ok: false, error: 'network' }; }
    if (r.status !== 200 || r.type === 'opaqueredirect' || r.redirected || !r.body) { r.body?.cancel?.().catch(() => {}); return { ok: false, error: 'network' }; }
    const body = await pull(r, capOf(type));
    return body.bytes ? { ok: true, b64: std(body.bytes) } : { ok: false, error: body.error };
  };

  // ops: put { kind, b64, expect?, pending? } → { ok, h (its name), type, mime, size, width?, height?, frames? }; list → { files:
  // [{ h, t, size, pending?, saved? }] }; drop { h, pending? }; keep { h } (an offer's file, now used); reset; file { h } →
  // { ok, mime, b64 } (as kept, for a page); lottie { src } → { ok, json }; remote { src, kind } → { ok, type, mime, b64 } (a video
  // or picture at an address, fetched and cleaned). area: { local, sync, files }.
  // env: { fetch, allow(src) → whether this page may have that address fetched } for lottie and remote; decode (lib/share.js) for
  // list's `saved`; queue for moving a file an older Glaze kept.
  const change = async (m, area, env = {}) => {
    const { local, files } = area;
    if (m.op === 'list') {
      const idx = await index(local), named = env.decode && Object.keys(idx).length ? await uses(area, env.decode) : null;
      return { ok: true, files: Object.entries(idx).map(([h, e]) => ({ h, t: e.t, size: e.n, ...(e.p && { pending: true }), ...(named?.saved.has(h) && { saved: true }) })) };
    }
    if (m.op === 'reset') {
      // The records first: an index left behind by a failed reset is forgotten by collect, a record without one would not be.
      const all = [...new Set([...Object.keys(await index(local)), ...await files.keys()])];
      if (all.length) await files.del(all);
      return { ok: !!await local.remove(INDEX) };
    }
    if (m.op === 'lottie') return lottieFrom(m.src, area, env);
    if (m.op === 'remote') return remoteFrom(m.src, m.kind, env);
    if (['file', 'drop', 'keep'].includes(m.op) && !HASH.test(m.h)) return { ok: false, error: 'bad' };
    if (m.op === 'file') {
      const rec = await stored(area, m.h, env.queue);
      return rec ? { ok: true, mime: rec.t, b64: rec.b } : { ok: false, error: 'missing' };
    }
    if (m.op === 'drop' || m.op === 'keep') {
      const idx = await index(local), e = idx[m.h];
      if (m.op === 'keep') {
        if (!e) return { ok: false, error: 'missing' };
        delete e.p;
        e.at = Date.now();
        return { ok: await keepIndex(local, idx) };
      }
      // A cancelled offer takes its file only while nothing else has kept it.
      if (m.pending === true && !e?.p) return { ok: true };
      if (m.pending === true) {
        const named = await uses(area, env.decode);
        if (named.now.has(m.h) || named.saved.has(m.h)) {
          delete e.p;
          return { ok: await keepIndex(local, idx) };
        }
      }
      delete idx[m.h];
      if (e && !await keepIndex(local, idx)) return { ok: false, error: 'write' };
      await files.del([m.h]);
      return { ok: true };
    }
    if (m.op !== 'put' || !TYPES.includes(m.kind) || typeof m.b64 !== 'string') return { ok: false, error: 'bad' };
    const cap = capOf(m.kind);
    if (m.b64.length > Math.ceil(cap * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(m.b64)) return { ok: false, error: 'big' };
    let bytes;
    try { bytes = unstd(m.b64); } catch { return { ok: false, error: 'bad' }; }
    const seen = examine(bytes, 'bg'), got = seen.got;
    if (!got || got.type !== m.kind) return { ok: false, error: seen.error === 'meta' && seen.type === m.kind ? 'meta' : 'type' };
    const h = await sha(got.bytes);
    // expect: the name a Look gave the file; bytes that are not that file are not kept.
    if (m.expect !== undefined && m.expect !== h) return { ok: false, error: 'hash' };
    const kept = { ok: true, h, type: got.type, mime: got.mime, size: got.bytes.length, width: got.w, height: got.h, frames: got.frames };
    const idx = await index(local), had = idx[h], at = Date.now();
    // Kept already: an offer never makes a kept file pending again, and putting it outside an offer keeps it for good.
    if (had && (await files.keys()).includes(h)) {
      if (m.pending !== true) delete had.p;
      had.at = at;
      return await keepIndex(local, idx) ? kept : { ok: false, error: 'write' };
    }
    // No room: offers nobody answered make way first, oldest first.
    let others = Object.entries(idx).reduce((n, [k, e]) => n + (k === h ? 0 : e.n), 0);
    const named = others + got.bytes.length > LIMIT.total ? await uses(area, env.decode) : null;
    const spare = Object.entries(idx).filter(([k, e]) => k !== h && e.p && !named?.now.has(k) && !named?.saved.has(k)).sort(([, a], [, b]) => (a.at || 0) - (b.at || 0)), freed = [];
    while (others + got.bytes.length > LIMIT.total && spare.length) { const [k, e] = spare.shift(); others -= e.n; delete idx[k]; freed.push(k); }
    if (others + got.bytes.length > LIMIT.total) return { ok: false, error: 'full' };
    try { await files.put(h, { t: got.mime, b: std(got.bytes), ...(got.canvases && { c: got.canvases }) }); } catch { return { ok: false, error: 'write' }; }
    idx[h] = { t: got.mime, n: got.bytes.length, at, ...(m.pending === true && { p: true }) };
    if (!await keepIndex(local, idx)) { await Promise.resolve().then(() => files.del([h])).catch(() => {}); return { ok: false, error: 'write' }; }
    if (freed.length) await files.del(freed);
    return kept;
  };

  return { LIMIT, TYPES, KEY, INDEX, HASH, GALLERY, std, unstd, b64u, sha, webp, png, avif, video, lottie, check, examine, packs, index, kindOf, migrate, read, fileOf, uses, collect, fromGallery, change };
})();
if (typeof module !== 'undefined') module.exports = GZ_MEDIA; else GZ_MEDIA;
