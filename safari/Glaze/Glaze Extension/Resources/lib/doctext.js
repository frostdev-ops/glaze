// Plain text out of the documents students import (syllabi, schedules, transcripts, slides), on the device.
// DOCX and PPTX are zip archives of XML; HTML is a page. All of it goes through one small tokenizer instead
// of DOMParser, so it runs anywhere: the service worker, an extension page, a content script, and node.
// Classic script, also loaded on demand (content.js need()); module.exports for node.
//
// Work is bounded for hostile or broken files: input size, entries, bytes inflated per entry and per
// document, slides, and text out. Every limit can be lowered per call with { limits }.
var GZ_DOCTEXT = globalThis.GZ_DOCTEXT || (() => {
  const LIMITS = { input: 256 << 20, entries: 20000, entry: 64 << 20, total: 256 << 20, slides: 5000, text: 32 << 20 };
  const fail = (what) => { throw new RangeError(what); };

  const CRC = new Uint32Array(256).map((_, i) => {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc32 = (b) => {
    let c = ~0;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return ~c >>> 0;
  };

  // name → entry, from the zip's central directory (which, unlike local headers, always has the sizes,
  // even when the writer used data descriptors). No zip64, multi-disk or encrypted archives: Office files
  // never need them, so they are refused rather than misread.
  const entries = (buf, L) => {
    if (buf.length > L.input) fail('file too large');
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    // The end record, searched backward over the last 65,535 + 22 bytes. A candidate counts only if its
    // comment runs exactly to the end of the file and its central directory ends where it starts, so an
    // archive comment that happens to contain the signature isn't taken for it. Zip64 is refused only for a
    // candidate that is really one: zip64 markers with the zip64 locator right before it. A look-alike in a
    // comment is skipped like any other.
    let end = -1, seen = false;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
      if (v.getUint32(i, true) !== 0x06054b50) continue;
      seen = true;
      if (i + 22 + v.getUint16(i + 20, true) !== buf.length) continue;
      if (v.getUint32(i + 16, true) + v.getUint32(i + 12, true) === i) { end = i; break; }
      const zip64 = v.getUint16(i + 10, true) === 0xffff || v.getUint32(i + 12, true) === 0xffffffff || v.getUint32(i + 16, true) === 0xffffffff;
      if (zip64 && i >= 20 && v.getUint32(i - 20, true) === 0x07064b50) throw new Error('zip64 files are not supported');
    }
    if (end < 0) throw new Error(seen ? 'damaged zip file' : 'not a zip file');
    const count = v.getUint16(end + 10, true), cdSize = v.getUint32(end + 12, true), cdAt = v.getUint32(end + 16, true);
    if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true) || v.getUint16(end + 8, true) !== count) throw new Error('multi-disk zip files are not supported');
    if (count > L.entries) fail('too many files in the archive');
    const out = new Map();
    let p = cdAt;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cdAt + cdSize || v.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip file');
      const nameLen = v.getUint16(p + 28, true), next = p + 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
      if (next > cdAt + cdSize) throw new Error('damaged zip file');
      if (v.getUint16(p + 34, true)) throw new Error('multi-disk zip files are not supported');
      const e = { flags: v.getUint16(p + 8, true), method: v.getUint16(p + 10, true), crc: v.getUint32(p + 16, true), csize: v.getUint32(p + 20, true), size: v.getUint32(p + 24, true), at: v.getUint32(p + 42, true), name: buf.subarray(p + 46, p + 46 + nameLen), cdAt };
      if (e.csize === 0xffffffff || e.size === 0xffffffff || e.at === 0xffffffff) throw new Error('zip64 files are not supported');
      out.set(new TextDecoder().decode(e.name), e);
      p = next;
    }
    if (p !== cdAt + cdSize) throw new Error('damaged zip file');
    return out;
  };

  // One entry's bytes, checked against the local header, its sizes and its CRC, within the budgets. The
  // entry's size is reserved before the first await, so reads running at the same time can't all pass the
  // document budget; a read that fails gives its reservation back.
  const read = async (buf, e, L, budget) => {
    if (e.flags & 1) throw new Error('encrypted zip entry');
    if (e.method !== 0 && e.method !== 8) throw new Error(`zip method ${e.method}`);
    if (e.size > L.entry) fail('file too large');
    if (budget.total + e.size > L.total) fail('document too large');
    budget.total += e.size;
    try {
      return await inflate(buf, e);
    } catch (err) {
      budget.total -= e.size;
      throw err;
    }
  };
  // The local header must agree with the central directory: signature, name, method, the encryption and
  // data-descriptor flags, and (without a descriptor) CRC and sizes; with one, the descriptor after the
  // data must agree instead. Members lie before the central directory.
  const inflate = async (buf, e) => {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const damaged = () => { throw new Error('damaged zip file'); };
    if (e.at + 30 > e.cdAt || v.getUint32(e.at, true) !== 0x04034b50 || v.getUint16(e.at + 8, true) !== e.method) damaged();
    const flags = v.getUint16(e.at + 6, true), nameLen = v.getUint16(e.at + 26, true);
    if ((flags & 9) !== (e.flags & 9) || nameLen !== e.name.length) damaged();
    for (let k = 0; k < nameLen; k++) if (buf[e.at + 30 + k] !== e.name[k]) damaged();
    const start = e.at + 30 + nameLen + v.getUint16(e.at + 28, true);
    let after = start + e.csize;
    if (e.flags & 8) {
      // Data descriptor: an optional signature, then CRC and both sizes.
      const d = after + 16 <= e.cdAt && v.getUint32(after, true) === 0x08074b50 ? after + 4 : after;
      if (d + 12 > e.cdAt || v.getUint32(d, true) !== e.crc || v.getUint32(d + 4, true) !== e.csize || v.getUint32(d + 8, true) !== e.size) damaged();
      after = d + 12;
    } else if (v.getUint32(e.at + 14, true) !== e.crc || v.getUint32(e.at + 18, true) !== e.csize || v.getUint32(e.at + 22, true) !== e.size) damaged();
    if (after > e.cdAt) damaged();
    const raw = buf.subarray(start, start + e.csize);
    let out;
    if (e.method === 0) {
      if (e.csize !== e.size) throw new Error('damaged zip file');
      out = raw;
    } else {
      // The declared size can lie, so the stream is cut off as soon as it passes it.
      // Written straight in, not through a Blob's stream: Safari's content scripts refuse that stream's chunks here.
      const inflate = new DecompressionStream('deflate-raw'), writer = inflate.writable.getWriter();
      writer.write(new Uint8Array(raw)).then(() => writer.close()).catch(() => {});
      const reader = inflate.readable.getReader();
      const parts = [];
      let n = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if ((n += value.length) > e.size) { reader.cancel().catch(() => {}); throw new Error('damaged zip file'); }
          parts.push(value);
        }
      } catch (err) {
        throw err instanceof RangeError || /damaged/.test(err.message) ? err : new Error('damaged zip file');
      }
      out = new Uint8Array(n);
      n = 0;
      for (const p of parts) { out.set(p, n); n += p.length; }
    }
    if (out.length !== e.size || crc32(out) !== e.crc) throw new Error('damaged zip file');
    return out;
  };

  // XML bytes → text, honouring a byte-order mark or the declared encoding (XML 1.0 §4.3.3). The whole
  // declaration is read (up to 4 KiB, through "?>"), so a long one can't hide its encoding.
  const xmlText = (b) => {
    const dec = (label) => new TextDecoder(label).decode(b);
    if (b[0] === 0xfe && b[1] === 0xff) return dec('utf-16be');
    if (b[0] === 0xff && b[1] === 0xfe) return dec('utf-16le');
    if (b[0] === 0x3c && b[1] === 0 && b[2] === 0x3f && b[3] === 0) return dec('utf-16le');
    if (b[0] === 0 && b[1] === 0x3c && b[2] === 0 && b[3] === 0x3f) return dec('utf-16be');
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return dec('utf-8');
    let label = null;
    if (/^<\?xml\s$/.test(String.fromCharCode(...b.subarray(0, 6)))) {
      const max = Math.min(b.length, 4096);
      let k = 5;
      while (k < max - 1 && !(b[k] === 0x3f && b[k + 1] === 0x3e)) k++;
      if (k >= max - 1) throw new Error('XML declaration too long or unterminated');
      label = /\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(String.fromCharCode(...b.subarray(0, k)))?.[1];
    }
    if (!label || /^(utf-?8|(us-)?ascii)$/i.test(label)) return dec('utf-8');
    try { return dec(label); } catch { throw new Error(`unsupported XML encoding ${label}`); }
  };

  const unzip = (bytes, opts = {}) => {
    const L = { ...LIMITS, ...opts.limits };
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const list = entries(buf, L);
    const budget = { total: 0 };
    const cache = new Map(); // a part read twice is inflated and counted once
    const raw = (name) => {
      if (!list.has(name)) return Promise.resolve(null);
      if (!cache.has(name)) cache.set(name, read(buf, list.get(name), L, budget));
      return cache.get(name);
    };
    const text = (name) => raw(name).then((b) => b && xmlText(b));
    return { names: [...list.keys()], text, bytes: raw };
  };

  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×', divide: '÷', frac12: '½', frac14: '¼', frac34: '¾', prime: '′', Prime: '″', minus: '−', laquo: '«', raquo: '»', shy: '', zwnj: '', zwj: '', ensp: ' ', emsp: ' ', thinsp: ' ', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß' };
  // ponytail: named entities beyond this list stay as written; numeric ones always decode.
  const decode = (s) => s.replace(/&(#x[0-9a-f]{1,8}|#\d{1,8}|[a-z]\w{0,31});/gi, (m, e) => {
    if (e[0] !== '#') return Object.hasOwn(NAMED, e) ? NAMED[e] : m;
    const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
    return c > 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : '�';
  });

  // The tokenizer: one pass with one cursor, so malformed markup (an unfinished tag, a comment that never
  // closes) costs linear time. Yields { text } | { cdata } | { name, close, attrs, empty, at, end }.
  // `raw`: lower-case HTML element names whose body isn't markup (script, style), skipped to their end tag.
  function* tokens(src, raw) {
    const n = src.length;
    let i = 0;
    while (i < n) {
      const lt = src.indexOf('<', i);
      if (lt < 0) { yield { text: src.slice(i) }; return; }
      if (lt > i) yield { text: src.slice(i, lt) };
      if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); if (e < 0) return; i = e + 3; continue; }
      if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt + 9); yield { cdata: src.slice(lt + 9, e < 0 ? n : e) }; if (e < 0) return; i = e + 3; continue; }
      const c = src[lt + 1];
      if (c === '!' || c === '?') { const e = src.indexOf('>', lt); if (e < 0) return; i = e + 1; continue; }
      const close = c === '/';
      const ns = lt + (close ? 2 : 1);
      const name = /^[A-Za-z][\w:.-]*/.exec(src.slice(ns, ns + 128))?.[0];
      if (!name) { yield { text: '<' }; i = lt + 1; continue; } // a lone "<" is text
      // The tag ends at the first ">" outside a quoted attribute value (a quote counts only after "=").
      let j = ns + name.length, q = '', eq = false;
      for (; j < n; j++) {
        const ch = src[j];
        if (q) { if (ch === q) q = ''; continue; }
        if (ch === '>') break;
        if ((ch === '"' || ch === "'") && eq) q = ch;
        else if (ch === '=') eq = true;
        else if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') eq = false;
      }
      if (j >= n) { yield { text: src.slice(lt) }; return; } // an unfinished tag: the rest is text
      const attrs = src.slice(ns + name.length, j);
      const empty = !close && attrs.trimEnd().endsWith('/');
      yield { name, close, attrs, empty, at: lt, end: j + 1 };
      i = j + 1;
      if (raw && !close && !empty && raw.has(name.toLowerCase())) {
        const e = endTag(src, i, name.toLowerCase());
        if (e < 0) return;
        i = e;
      }
    }
  }
  // Where a raw-text element's end tag starts: "</name" in any ASCII case, then whitespace, "/" or ">"
  // ("</scripture>" doesn't end a script). Compares in place, so source indices never shift (lower-casing
  // the whole string would: "İ" becomes two characters).
  const endTag = (src, from, name) => {
    for (let k = src.indexOf('</', from); k >= 0; k = src.indexOf('</', k + 2)) {
      let c = 0;
      for (; c < name.length; c++) {
        const ch = src.charCodeAt(k + 2 + c);
        if ((ch >= 65 && ch <= 90 ? ch + 32 : ch) !== name.charCodeAt(c)) break;
      }
      if (c === name.length && /[\s/>]/.test(src[k + 2 + c] || '')) return k;
    }
    return -1;
  };
  const local = (name) => name.slice(name.lastIndexOf(':') + 1);
  // An attribute's value, either quote style, entities decoded. `name` may be "*:id" for any prefix.
  const attr = (attrs, name) => {
    const n = name.startsWith('*:') ? `[\\w.-]+:${name.slice(2)}` : name.replace(/[.:]/g, '\\$&');
    const m = new RegExp(`(?:^|\\s)${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
    return m ? decode(m[1] ?? m[2]) : null;
  };

  // Tidy, line by line: no spaces at line ends or around tabs, no trailing cell tab, at most one blank line.
  const tidy = (s) => {
    const out = [];
    let blank = 0;
    for (const l of s.split('\n')) {
      let t = l.split('\t').map((c) => c.trim()).join('\t');
      let k = t.length;
      while (k && t[k - 1] === '\t') k--;
      t = t.slice(0, k);
      if (!t) { if (out.length && !blank++) out.push(''); continue; }
      blank = 0;
      out.push(t);
    }
    while (out.length && !out.at(-1)) out.pop();
    return out.join('\n');
  };

  // The scanner. rules: { text: tags whose content is text (null = all text), skip: tags whose whole content
  // is ignored, line: tags that end a line, cell: tags that end a table cell, br: empty tags that break a
  // line, tab: empty tags that are a tab, layout: tags that still end a line inside a cell }. Inside a cell
  // a line end is a space, so a table row stays on one line with its cells split by tabs; but lists and
  // headings inside a cell mean the table is page layout, so they keep their lines.
  const scan = (src, rules, L = LIMITS) => {
    if (src.length > L.text) fail('document too large');
    // The output is a list of chunks with a running length, joined once at the end: reading the end of a string that has just been
    // appended to flattens it, which made a long document quadratic (3 s for 16,000 paragraphs, 11 s for 1.6 MB of HTML).
    const out = [];
    let len = 0, skip = 0, inText = 0, cells = 0, pre = 0;
    const has = (set, n) => set && set.has(n);
    const put = (s) => { if (s) { out.push(s); len += s.length; } };
    const last = () => out.at(-1)?.at(-1);
    const space = () => { if (len && last() !== ' ' && last() !== '\n' && last() !== '\t') put(' '); };
    const trimEnd = () => { // spaces and tabs off the end
      while (out.length) {
        const c = out.at(-1);
        let k = c.length;
        while (k && (c[k - 1] === ' ' || c[k - 1] === '\t')) k--;
        len -= c.length - k;
        if (k) { out[out.length - 1] = c.slice(0, k); return; }
        out.pop();
      }
    };
    for (const tk of tokens(src, rules.raw)) {
      if (tk.text != null || tk.cdata != null) {
        if (skip || (rules.text && !inText)) continue;
        const t = tk.cdata ?? decode(tk.text);
        if (pre) { put(t); continue; }
        const s = t.replace(/\s+/g, ' ');
        if (s === ' ') space(); // indentation between tags isn't text
        else put(s);
        continue;
      }
      const name = rules.html ? tk.name.toLowerCase() : tk.name;
      const { close, empty } = tk;
      if (has(rules.skip, name) && !empty) { skip += close ? -1 : 1; if (skip < 0) skip = 0; continue; }
      if (skip) continue;
      if (has(rules.text, name) && !empty) inText += close ? -1 : 1;
      if (name === 'pre') pre = Math.max(0, pre + (close ? -1 : 1));
      if (has(rules.cell, name) && !empty) {
        if (rules.html) { if (cells) put('\t'); cells = close ? 0 : 1; } // HTML may leave </td> out: a new cell closes the open one
        else { cells += close ? -1 : 1; if (close) put('\t'); } // Word nests tables, so count
        continue;
      }
      if (rules.html && cells && (name === 'tr' || name === 'table')) { put('\t'); cells = 0; }
      if (has(rules.br, name) && !close) { if (cells) space(); else put('\n'); }
      else if (has(rules.tab, name) && !close) put('\t');
      else if (has(rules.line, name) && (close || (rules.html && !empty))) {
        if (cells && !has(rules.layout, name)) space();
        else {
          trimEnd();
          if (len && last() !== '\n') put('\n');
        }
      }
      if (len > L.text) fail('document too large');
    }
    return tidy(out.join(''));
  };
  const set = (s) => new Set(s.split(' '));

  const WORD = { text: set('w:t'), skip: set('w:delText w:instrText mc:Fallback w:pPr'), line: set('w:p w:tr'), cell: set('w:tc'), br: set('w:br w:cr'), tab: set('w:tab') };
  // Body text of a .docx: headers first (course title, term), then the document.
  const docx = async (bytes, opts = {}) => {
    const L = { ...LIMITS, ...opts.limits };
    const z = unzip(bytes, opts);
    if (!z.names.includes('word/document.xml')) throw new Error('not a Word document');
    const parts = [...z.names.filter((n) => /^word\/header\d*\.xml$/.test(n)).sort(), 'word/document.xml'];
    const texts = [];
    for (const n of parts) texts.push(scan(await z.text(n), WORD, L));
    const out = [...new Set(texts.filter(Boolean))].join('\n\n');
    return out.length > L.text ? fail('document too large') : out;
  };

  const SLIDE = { text: set('a:t'), skip: set('a:fld mc:Fallback'), line: set('a:p a:tr'), cell: set('a:tc'), br: set('a:br') };
  // A part's relationships: rId → { path, type }.
  const rels = async (z, path) => {
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    const x = await z.text(`${dir}_rels/${path.slice(dir.length)}.rels`);
    const out = new Map();
    for (const tk of tokens(x || '')) {
      if (!tk.name || tk.close || local(tk.name) !== 'Relationship') continue;
      const id = attr(tk.attrs, 'Id'), target = attr(tk.attrs, 'Target'), type = attr(tk.attrs, 'Type') || '';
      if (!id || !target || attr(tk.attrs, 'TargetMode') === 'External') continue;
      const norm = [];
      for (const p of (target.startsWith('/') ? target.slice(1) : dir + target).split('/')) if (p === '..') norm.pop(); else if (p !== '.') norm.push(p);
      out.set(id, { path: norm.join('/'), type: type.slice(type.lastIndexOf('/') + 1) });
    }
    return out;
  };
  // The body placeholder shapes of a notes slide (the others repeat the slide image and number).
  const notesBody = (x) => {
    let depth = 0, from = 0, body = false, out = '';
    for (const tk of tokens(x)) {
      if (!tk.name) continue;
      const n = local(tk.name);
      if (n === 'sp' && !tk.empty) {
        if (!tk.close && depth++ === 0) { from = tk.at; body = false; }
        else if (tk.close && --depth === 0 && body) out += x.slice(from, tk.end);
        if (depth < 0) depth = 0;
      } else if (n === 'ph' && depth && attr(tk.attrs, 'type') === 'body') body = true;
    }
    return out;
  };
  // Slides of a .pptx in presentation order, each with its speaker notes. Text comes in the order shapes are
  // stored, which for the usual layouts is title first, then body. A slide the presentation lists but the
  // archive lacks comes back as { missing: true } rather than being dropped.
  const pptx = async (bytes, opts = {}) => {
    const L = { ...LIMITS, ...opts.limits };
    const z = unzip(bytes, opts);
    const pres = await z.text('ppt/presentation.xml');
    if (!pres) throw new Error('not a PowerPoint presentation');
    const r = await rels(z, 'ppt/presentation.xml');
    const ids = [];
    let inList = false;
    for (const tk of tokens(pres)) {
      if (!tk.name) continue;
      const n = local(tk.name);
      if (n === 'sldIdLst') inList = !tk.close && !tk.empty;
      else if (inList && n === 'sldId' && !tk.close) ids.push(attr(tk.attrs, '*:id'));
    }
    const out = [], seen = new Set();
    let size = 0;
    for (const id of ids) {
      const path = r.get(id)?.path;
      if (path && seen.has(path)) continue; // a slide listed twice is read once
      if (path) seen.add(path);
      if (out.length >= L.slides) fail('too many slides');
      const x = path && await z.text(path);
      if (!x) { out.push({ text: '', notes: '', missing: true }); continue; }
      const notes = [...(await rels(z, path)).values()].find((t) => t.type === 'notesSlide');
      const nx = notes && await z.text(notes.path);
      const body = nx ? notesBody(nx) : '';
      const slide = { text: scan(x, SLIDE, L), notes: body ? scan(body, SLIDE, L) : '' };
      if ((size += slide.text.length + slide.notes.length) > L.text) fail('document too large');
      out.push(slide);
    }
    return out;
  };

  const HTML = {
    html: true,
    text: null,
    raw: set('script style template noscript textarea title'),
    skip: set('head svg math iframe object canvas select button nav'),
    line: set('p div li dt dd tr h1 h2 h3 h4 h5 h6 section article header footer main aside blockquote pre ul ol dl table thead tbody tfoot caption figure figcaption form fieldset legend address details summary'),
    cell: set('td th'),
    layout: set('ul ol li dl dt dd h1 h2 h3 h4 h5 h6 table'),
    br: set('br hr'),
  };
  // Readable text of an HTML page or fragment: block elements on their own lines, table rows on one line
  // with tab-separated cells; scripts, styles, navigation and form controls dropped.
  const html = (src, opts = {}) => scan(String(src), HTML, { ...LIMITS, ...opts.limits });

  // ---- PDFs and pictures ----------------------------------------------------------------------------------------
  // pdf.js and the OCR engine run in Glaze's reader (reader.html, an extension page in a hidden frame): they need
  // workers and WebAssembly, which a content script can't host under the LMS page's CSP. What's here needs neither, so
  // the reader, the import dialogs and node share it: the bounds, what a file is, a picture's size from its header, a
  // picture made ready for OCR, and pdf.js's text runs or the OCR engine's words as lines, a table's row on one line
  // with its cells split by tabs, as docx() and html() give them.
  // Bounds, each checked before the work it bounds: bytes per PDF or picture, pages per PDF, scanned pages read by
  // OCR, pixels per picture (from its header, before it is decoded), and the longest side a picture is read at.
  const READ = { pdf: 50 << 20, image: 30 << 20, pages: 100, scans: 20, pixels: 60e6, side: 4000 };

  // What a file is, by its first bytes where they say (a renamed file still reads), else by its name and type:
  // 'pdf', 'image', 'docx', 'pptx', 'html', 'text' or ''.
  const kind = (name = '', type = '', b = new Uint8Array(0)) => {
    const is = (s, at = 0) => b.length >= at + s.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
    if (is('%PDF-')) return 'pdf';
    if (is('\x89PNG') || is('\xff\xd8\xff') || is('GIF8') || (is('RIFF') && is('WEBP', 8)) || (is('ftyp', 4) && /^(hei|hev|mif1|msf1|avi)/.test(String.fromCharCode(...b.subarray(8, 12))))) return 'image';
    const n = name.toLowerCase();
    if (/\.pdf$/.test(n) || type === 'application/pdf') return 'pdf';
    if (/\.(png|jpe?g|jfif|gif|webp|heic|heif|avif|bmp)$/.test(n) || type.startsWith('image/')) return 'image';
    if (/\.docx$/.test(n)) return 'docx';
    if (/\.pptx$/.test(n)) return 'pptx';
    if (/\.html?$/.test(n) || type === 'text/html') return 'html';
    if (/\.(txt|text|md)$/.test(n) || type === 'text/plain') return 'text';
    return '';
  };

  // A picture's width and height from its header (PNG, JPEG, GIF, WebP, BMP, HEIC/AVIF), so its pixels can be
  // counted before it is decoded; null when the header doesn't say.
  const imageSize = (b) => {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const ok = (w, h) => (w > 0 && h > 0 ? { w, h } : null);
    const is = (s, at = 0) => b.length >= at + s.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
    if (is('\x89PNG') && b.length >= 24) return ok(v.getUint32(16), v.getUint32(20));
    if (is('GIF8') && b.length >= 10) return ok(v.getUint16(6, true), v.getUint16(8, true));
    if (is('BM') && b.length >= 26) return ok(v.getInt32(18, true), Math.abs(v.getInt32(22, true)));
    if (is('RIFF') && is('WEBP', 8) && b.length >= 30) {
      if (is('VP8 ', 12)) return ok(v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff);
      if (is('VP8L', 12)) { const n = v.getUint32(21, true); return ok((n & 0x3fff) + 1, ((n >>> 14) & 0x3fff) + 1); }
      if (is('VP8X', 12)) return ok((v.getUint32(24, true) & 0xffffff) + 1, (v.getUint32(26, true) >>> 8) + 1);
      return null;
    }
    if (is('\xff\xd8')) {
      // Segment by segment to the frame header (SOF0–15, not DHT, JPG or DAC), past any EXIF and its thumbnail.
      for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(v.getUint16(i + 7), v.getUint16(i + 5));
        if (m === 0xd9 || m === 0xda) return null;
        i += 2 + (m >= 0xd0 && m <= 0xd7 ? 0 : v.getUint16(i + 2));
      }
      return null;
    }
    if (is('ftyp', 4)) {
      // HEIC and AVIF: the largest image spatial extent ('ispe') in the top-level 'meta' box, a grid's whole picture
      // rather than its tiles; never the picture data's bytes, which can hold the same four letters by chance.
      for (let at = 0; at + 8 <= b.length;) {
        let size = v.getUint32(at);
        if (size === 1 && at + 16 <= b.length) size = Number(v.getBigUint64(at + 8));
        else if (size === 0) size = b.length - at;
        if (size < 8) return null;
        if (is('meta', at + 4)) {
          let best = null;
          const stop = Math.min(b.length, at + size);
          for (let i = b.indexOf(0x69, at + 8); i >= 0 && i + 16 <= stop; i = b.indexOf(0x69, i + 1)) {
            if (!is('ispe', i)) continue;
            const s = ok(v.getUint32(i + 8), v.getUint32(i + 12));
            if (s && (!best || s.w * s.h > best.w * best.h)) best = s;
          }
          return best;
        }
        at += size;
      }
      return null;
    }
    return null;
  };

  // A picture ready for the OCR engine, from canvas pixels (RGBA): grey, transparent as white paper, turned around
  // when it is mostly dark (a dark theme's screenshot), since the engine reads dark ink on light paper, and twice the
  // size (bilinear) when it is small: a screenshot's 12–14 px interface text is below what the engine reads well (on
  // the class schedule's own screenshot it misread "BIO 1100" and "MATH 1350" at 1×, not at 2×). A binary PGM, which
  // the engine reads as it is.
  const pgm = (rgba, w, h) => {
    let g = new Uint8Array(w * h), sum = 0;
    for (let i = 0; i < w * h; i++) {
      const k = i * 4, a = rgba[k + 3] / 255;
      sum += g[i] = Math.round((rgba[k] * 0.299 + rgba[k + 1] * 0.587 + rgba[k + 2] * 0.114) * a + 255 * (1 - a));
    }
    if (sum < 128 * w * h) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
    if (Math.max(w, h) < 2000) {
      const W = w * 2, H = h * 2, big = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        const sy = Math.max(0, (y - 0.5) / 2), y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
        for (let x = 0; x < W; x++) {
          const sx = Math.max(0, (x - 0.5) / 2), x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
          big[y * W + x] = Math.round((g[y0 * w + x0] * (1 - fx) + g[y0 * w + x1] * fx) * (1 - fy) + (g[y1 * w + x0] * (1 - fx) + g[y1 * w + x1] * fx) * fy);
        }
      }
      [g, w, h] = [big, W, H];
    }
    const head = new TextEncoder().encode(`P5\n${w} ${h}\n255\n`);
    const out = new Uint8Array(head.length + g.length);
    out.set(head);
    out.set(g, head.length);
    return out;
  };

  // A PDF's text from pdf.js's text runs, a page each ({ items: getTextContent().items, vt: the page viewport's
  // transform }), in the order the file draws them: S4 found that order right on every PDF it tried, two-column ones
  // included, where rebuilding lines by position mixed the columns. Position (on the page as shown, so a rotated page
  // reads across) only decides what goes between two runs: a new line where the next run starts on another line (or
  // pdf.js marked the end of one), a tab across a gap wider than the letters are tall (a table's next cell), a space
  // across a word's gap. Pages are split by a blank line.
  const pdfText = (pages) => tidy(pages.map(({ items, vt = [1, 0, 0, 1, 0, 0] }) => {
    let out = '', prev = null, eol = false;
    for (const it of items) {
      if (typeof it.str !== 'string') continue; // a marked-content marker
      if (!it.str.trim()) { eol ||= !!it.hasEOL; continue; }
      const [, , c, d, e, f] = it.transform;
      const r = { s: it.str, x: vt[0] * e + vt[2] * f + vt[4], y: vt[1] * e + vt[3] * f + vt[5], w: it.width, h: Math.hypot(vt[0] * c + vt[2] * d, vt[1] * c + vt[3] * d), eol: it.hasEOL };
      if (prev) {
        const size = Math.max(r.h, prev.h, 1), gap = r.x - (prev.x + prev.w);
        if (eol || Math.abs(r.y - prev.y) > size / 2 || gap < -size) out += '\n';
        else if (gap > size) out += '\t';
        else if (gap > size * 0.15 && !/\s$/.test(out) && !/^\s/.test(r.s)) out += ' ';
      }
      out += r.s;
      prev = r;
      eol = !!r.eol;
    }
    return out;
  }).join('\n\n'));

  // What the OCR engine read (its JSON: blocks → paragraphs → lines → words { text, confidence, bbox }) as lines, laid
  // out again from where the words are, since the engine's own lines follow its page segmentation, not the page:
  // - a run of words is a cell; a gap wider than the letters are tall (or a step back) starts the next, as pdfText;
  // - cells level with each other are a line, as pdfText's runs;
  // - a table's row whose cells are several lines, or centred in the row ("Nov. 2 – 8" beside "Module 1" over
  //   "Lesson 5"), is one line, each cell's lines joined (a bulleted list's items by " · "); rows with their cells
  //   level stay lines, as do a paragraph's: only touching lines are a row, with at most one of them across every
  //   column, and either a cell level with nothing beside it or a single cell in the first column;
  // - a chart's label over its value ("Video" / "Assignments" / "10%") is one line ("Video Assignments 10%").
  // Its usual slips are mended: "|" or "!" alone is "I" ("Calculus |", "Chemistry I!"), stray marks at a word's edges
  // ("‘Principles", "MTWR_") or as words of their own ("©", "=") go, as do an icon read as a word (a few letters
  // several times the page's letters tall). → { text, conf: the words' mean confidence
  // (0–100), unsure: the lines with a word it was less sure of than LOW }.
  const LOW = 65;
  const BULLET = /^[•·∙●○◦▪■□►▸‣*+«°eo©]$/u;
  const PERCENT = /^\d{1,3}(?:[.,]\d+)?\s?%$/;
  const mend = (text) => {
    const s = String(text || '').trim();
    if (/^[|!I]{1,3}$/.test(s) && /[|!]/.test(s)) return 'I'.repeat(s.length);
    if (/[\p{L}\p{N}]/u.test(s)) return s.replace(/[_~«»©®]+/g, ' ').trim().replace(/^[‘’“”`´|=—]+|[‘’“”`´|=—]+$/g, '');
    // A dash between times stays, as do "&", "/", "%" and "+"; a lone "—" is most often a table's rule, and a lone ".",
    // ":" or ";" a speck (real punctuation sits on its word). "•" is kept here for the bullet test below.
    return /^[-–&/%+•·]$/.test(s) ? s : '';
  };
  const ocrText = (json) => {
    const tall = (w) => w.bbox.y1 - w.bbox.y0;
    // The middle height, not a box's: a tilted line's box is taller than its letters, and an icon is no letter.
    const mid = (xs) => { const s = xs.sort((a, b) => a - b); return Math.max(1, s[s.length >> 1] || 0); };
    const lines = [];
    for (const bl of json?.blocks || []) for (const p of bl.paragraphs || []) for (const ln of p.lines || []) lines.push(ln.words || []);
    const page = mid(lines.flat().map(tall));
    let sum = 0, n = 0;
    const cells = [];
    for (const words of lines) {
      const h = mid(words.map(tall));
      let cell = null, prev = null;
      for (const w of words) {
        const s = mend(w.text);
        if (!s || (s.length <= 3 && w.confidence < 90 && tall(w) > 2.5 * page)) continue;
        sum += w.confidence;
        n++;
        if (!cell || Math.abs(w.bbox.x0 - prev.bbox.x1) > h) cells.push(cell = { words: [] });
        cell.words.push({ s, w });
        prev = w;
      }
    }
    for (const c of cells) {
      const [b, next] = c.words;
      // A bullet: one small mark or letter starting the cell, well apart from its first word.
      if (next && BULLET.test(b.s) && tall(b.w) <= 0.7 * tall(next.w) && next.w.bbox.x0 - b.w.bbox.x1 >= 0.5 * tall(next.w)) { c.bullet = true; c.words.shift(); }
      else if (c.words.length === 1 && /^[•·]$/.test(b.s)) c.words = [];
      const ws = c.words.map((x) => x.w);
      Object.assign(c, {
        text: c.words.map((x) => x.s).join(' '), low: ws.some((w) => w.confidence < LOW), h: mid(ws.map(tall)),
        x0: Math.min(...ws.map((w) => w.bbox.x0)), x1: Math.max(...ws.map((w) => w.bbox.x1)), y0: Math.min(...ws.map((w) => w.bbox.y0)), y1: Math.max(...ws.map((w) => w.bbox.y1)),
      });
      c.cy = (c.y0 + c.y1) / 2;
    }
    let left = cells.filter((c) => c.text);
    const level = (a, b) => Math.abs(a.cy - b.cy) <= Math.min(a.h, b.h) / 2;
    const over = (a, b) => a.x0 < b.x1 && b.x0 < a.x1;
    const out = []; // { y, text, low }
    // A chart's labels: a value alone ("45%"; one with a cell level with it on its left is that row's), not one of a
    // column of them, under at most three short lines of words, each with nothing close beside it, stacked closely.
    const below = (a, b) => b.y0 >= a.y1 - a.h * 0.3 && b.y0 - a.y1 <= 1.25 * Math.max(a.h, b.h) && over(a, b);
    const near = (a) => left.some((o) => o !== a && level(o, a) && Math.max(o.x0 - a.x1, a.x0 - o.x1) < 3 * Math.max(a.h, o.h));
    for (const v of left.filter((c) => PERCENT.test(c.text) && !near(c) && !left.some((o) => o.x1 <= c.x0 && level(o, c)))) {
      if (left.some((o) => o !== v && below(v, o) && PERCENT.test(o.text))) continue;
      const parts = [v];
      while (parts.length < 4) {
        const up = left.filter((a) => !parts.includes(a) && below(a, parts[0])).sort((a, b) => b.y1 - a.y1)[0];
        if (!up || up.text.length > 30 || /\d\s?%/.test(up.text) || !/\p{L}/u.test(up.text) || near(up)) break;
        parts.unshift(up);
      }
      if (parts.length < 2) continue;
      out.push({ y: parts[0].y0, k: 0, text: parts.map((c) => c.text).join(' '), low: parts.some((c) => c.low) });
      left = left.filter((c) => !parts.includes(c));
    }
    // Rows: cells touching from top to bottom, then laid out as above.
    left.sort((a, b) => a.y0 - b.y0);
    const bands = [];
    for (const c of left) {
      const b = bands.at(-1);
      if (b && c.y0 <= b.y1 + 0.25 * c.h) { b.cells.push(c); b.y1 = Math.max(b.y1, c.y1); } else bands.push({ cells: [c], y1: c.y1 });
    }
    for (const { cells: band } of bands) {
      const rows = [];
      for (const c of [...band].sort((a, b) => a.cy - b.cy)) {
        const r = rows.at(-1);
        if (r && level(r[0], c)) r.push(c); else rows.push([c]);
      }
      const cols = [];
      for (const c of [...band].sort((a, b) => a.x0 - b.x0)) {
        const k = cols.at(-1);
        if (k && c.x0 < k.x1) { k.cells.push(c); k.x1 = Math.max(k.x1, c.x1); } else cols.push({ cells: [c], x1: c.x1 });
      }
      const col = (c) => cols.findIndex((k) => k.cells.includes(c));
      const one = rows.length > 1 && cols.length > 1 && cols.every((k) => k.cells.length <= 4)
        && rows.filter((r) => cols.every((k) => r.some((c) => k.cells.includes(c)))).length <= 1
        && (cols[0].cells.length === 1 || band.some((c) => !band.some((o) => col(o) !== col(c) && level(o, c))));
      const emit = (cs, text) => out.push({ y: band[0].y0, k: out.length, text, low: cs.some((c) => c.low) });
      if (one) emit(band, cols.map((k) => k.cells.sort((a, b) => a.y0 - b.y0).map((c, i) => (i && c.bullet ? '· ' : '') + c.text).join(' ')).join('\t'));
      else for (const r of rows) emit(r, r.sort((a, b) => a.x0 - b.x0).map((c) => c.text).join('\t'));
    }
    const unsure = [], text = [];
    for (const l of out.sort((a, b) => a.y - b.y || a.k - b.k)) {
      // A thin dash between two clock times is often lost ("11:00 AM  12:15 PM"): two times side by side are a range.
      // Mended here, line by line, so an unsure line is reported as the text has it and the review can find it.
      const t = tidy(l.text).replace(/(\d{1,2}:\d{2}(?: ?[AaPp]\.?[Mm]\.?)?)[ \t]+(?=\d{1,2}:\d{2})/g, '$1 - ');
      if (!t) continue;
      text.push(t);
      if (l.low) unsure.push(t);
    }
    return { text: tidy(text.join('\n')), conf: n ? Math.round(sum / n) : 0, unsure };
  };

  return { unzip, docx, pptx, html, decode, tokens, LIMITS, READ, kind, imageSize, pgm, pdfText, ocrText };
})();

if (typeof module !== 'undefined') module.exports = GZ_DOCTEXT; else GZ_DOCTEXT;
