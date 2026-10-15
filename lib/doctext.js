// Plain text out of the documents students import (syllabi, schedules, transcripts, slides), on the device.
// DOCX and PPTX are zip archives of XML; HTML is a page. All of it goes through one small tokenizer instead
// of DOMParser, so it runs anywhere: the service worker, an extension page, a content script, and node.
// Classic script; module.exports for node.
//
// Work is bounded for hostile or broken files: input size, entries, bytes inflated per entry and per
// document, slides, and text out. Every limit can be lowered per call with { limits }.
const GZ_DOCTEXT = (() => {
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
    let end = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error('not a zip file');
    const count = v.getUint16(end + 10, true), cdSize = v.getUint32(end + 12, true), cdAt = v.getUint32(end + 16, true);
    if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true) || v.getUint16(end + 8, true) !== count) throw new Error('multi-disk zip files are not supported');
    if (count === 0xffff || cdSize === 0xffffffff || cdAt === 0xffffffff) throw new Error('zip64 files are not supported');
    if (count > L.entries) fail('too many files in the archive');
    if (cdAt + cdSize > end) throw new Error('damaged zip file');
    const out = new Map();
    let p = cdAt;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cdAt + cdSize || v.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip file');
      const nameLen = v.getUint16(p + 28, true), next = p + 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
      if (next > cdAt + cdSize) throw new Error('damaged zip file');
      const e = { flags: v.getUint16(p + 8, true), method: v.getUint16(p + 10, true), crc: v.getUint32(p + 16, true), csize: v.getUint32(p + 20, true), size: v.getUint32(p + 24, true), at: v.getUint32(p + 42, true) };
      if (e.csize === 0xffffffff || e.size === 0xffffffff || e.at === 0xffffffff) throw new Error('zip64 files are not supported');
      out.set(new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen)), e);
      p = next;
    }
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
  const inflate = async (buf, e) => {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (e.at + 30 > buf.length || v.getUint32(e.at, true) !== 0x04034b50 || v.getUint16(e.at + 8, true) !== e.method) throw new Error('damaged zip file');
    const start = e.at + 30 + v.getUint16(e.at + 26, true) + v.getUint16(e.at + 28, true);
    if (start + e.csize > buf.length) throw new Error('damaged zip file');
    const raw = buf.subarray(start, start + e.csize);
    let out;
    if (e.method === 0) {
      if (e.csize !== e.size) throw new Error('damaged zip file');
      out = raw;
    } else {
      // The declared size can lie, so the stream is cut off as soon as it passes it.
      const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
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

  // XML bytes → text, honouring a byte-order mark or the declared encoding (XML 1.0 §4.3.3).
  const xmlText = (b) => {
    const dec = (label) => new TextDecoder(label).decode(b);
    if (b[0] === 0xfe && b[1] === 0xff) return dec('utf-16be');
    if (b[0] === 0xff && b[1] === 0xfe) return dec('utf-16le');
    if (b[0] === 0x3c && b[1] === 0 && b[2] === 0x3f && b[3] === 0) return dec('utf-16le');
    if (b[0] === 0 && b[1] === 0x3c && b[2] === 0 && b[3] === 0x3f) return dec('utf-16be');
    const head = String.fromCharCode(...b.subarray(0, 200));
    const label = /^(?:\xef\xbb\xbf)?<\?xml[^>]*?\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1];
    if (!label || /^(utf-?8|(us-)?ascii)$/i.test(label)) return dec('utf-8');
    try { return dec(label); } catch { throw new Error(`unsupported XML encoding ${label}`); }
  };

  const unzip = (bytes, opts = {}) => {
    const L = { ...LIMITS, ...opts.limits };
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const list = entries(buf, L);
    const budget = { total: 0 };
    const cache = new Map(); // a part read twice is inflated and counted once
    const text = (name) => {
      if (!list.has(name)) return Promise.resolve(null);
      if (!cache.has(name)) cache.set(name, read(buf, list.get(name), L, budget).then(xmlText));
      return cache.get(name);
    };
    return { names: [...list.keys()], text };
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
    let out = '', skip = 0, inText = 0, cells = 0, pre = 0;
    const has = (set, n) => set && set.has(n);
    const last = () => out[out.length - 1];
    const space = () => { if (out && last() !== ' ' && last() !== '\n' && last() !== '\t') out += ' '; };
    for (const tk of tokens(src, rules.raw)) {
      if (tk.text != null || tk.cdata != null) {
        if (skip || (rules.text && !inText)) continue;
        const t = tk.cdata ?? decode(tk.text);
        if (pre) { out += t; continue; }
        const s = t.replace(/\s+/g, ' ');
        if (s === ' ') space(); // indentation between tags isn't text
        else out += s;
        continue;
      }
      const name = rules.html ? tk.name.toLowerCase() : tk.name;
      const { close, empty } = tk;
      if (has(rules.skip, name) && !empty) { skip += close ? -1 : 1; if (skip < 0) skip = 0; continue; }
      if (skip) continue;
      if (has(rules.text, name) && !empty) inText += close ? -1 : 1;
      if (name === 'pre') pre = Math.max(0, pre + (close ? -1 : 1));
      if (has(rules.cell, name) && !empty) {
        if (rules.html) { if (cells) out += '\t'; cells = close ? 0 : 1; } // HTML may leave </td> out: a new cell closes the open one
        else { cells += close ? -1 : 1; if (close) out += '\t'; } // Word nests tables, so count
        continue;
      }
      if (rules.html && cells && (name === 'tr' || name === 'table')) { out += '\t'; cells = 0; }
      if (has(rules.br, name) && !close) { if (cells) space(); else out += '\n'; }
      else if (has(rules.tab, name) && !close) out += '\t';
      else if (has(rules.line, name) && (close || (rules.html && !empty))) {
        if (cells && !has(rules.layout, name)) space();
        else {
          let k = out.length;
          while (k && (out[k - 1] === ' ' || out[k - 1] === '\t')) k--;
          if (k < out.length) out = out.slice(0, k);
          if (out && last() !== '\n') out += '\n';
        }
      }
      if (out.length > L.text) fail('document too large');
    }
    return tidy(out);
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

  return { unzip, docx, pptx, html, decode, LIMITS };
})();

if (typeof module !== 'undefined') module.exports = GZ_DOCTEXT;
