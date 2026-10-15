// Plain text out of the documents students import (syllabi, schedules, transcripts, slides), on the device.
// DOCX and PPTX are zip archives of XML; HTML is a page. All of it goes through one small tag scanner instead
// of DOMParser, so it runs anywhere: the service worker, an extension page, a content script, and node.
// Classic script; module.exports for node.
const GZ_DOCTEXT = (() => {
  const LIMIT = 64 << 20; // bytes inflated per file, so a zip bomb stops early

  // name → entry, from the zip's central directory (which, unlike local headers, always has the sizes).
  const entries = (buf) => {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let end = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error('not a zip file');
    const count = v.getUint16(end + 10, true);
    let p = v.getUint32(end + 16, true);
    const out = new Map();
    for (let i = 0; i < count; i++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip file');
      const flags = v.getUint16(p + 8, true), nameLen = v.getUint16(p + 28, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
      out.set(name, { flags, method: v.getUint16(p + 10, true), size: v.getUint32(p + 20, true), at: v.getUint32(p + 42, true) });
      p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    }
    return out;
  };
  // ponytail: no zip64 or encryption; Office files are far below 4 GB and never encrypted this way.
  const read = async (buf, e) => {
    if (e.flags & 1) throw new Error('encrypted zip entry');
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const start = e.at + 30 + v.getUint16(e.at + 26, true) + v.getUint16(e.at + 28, true);
    const raw = buf.subarray(start, start + e.size);
    if (e.method === 0) return raw;
    if (e.method !== 8) throw new Error(`zip method ${e.method}`);
    const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((n += value.length) > LIMIT) { reader.cancel(); throw new Error('file too large'); }
      parts.push(value);
    }
    const out = new Uint8Array(n);
    n = 0;
    for (const p of parts) { out.set(p, n); n += p.length; }
    return out;
  };
  const unzip = (bytes) => {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const list = entries(buf);
    return { names: [...list.keys()], text: async (name) => (list.has(name) ? new TextDecoder().decode(await read(buf, list.get(name))) : null) };
  };

  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×', divide: '÷', frac12: '½', frac14: '¼', frac34: '¾', prime: '′', Prime: '″', minus: '−', laquo: '«', raquo: '»', shy: '', zwnj: '', zwj: '', ensp: ' ', emsp: ' ', thinsp: ' ', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß' };
  // ponytail: named entities beyond this list stay as written; numeric ones always decode.
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]\w*);/gi, (m, e) => {
    if (e[0] !== '#') return NAMED[e] ?? m;
    const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
    return c > 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : '�';
  });

  // The scanner. rules: { text: tags whose content is text (null = all text), skip: tags whose whole content
  // is ignored, line: tags that end a line, cell: tags that end a table cell, br: empty tags that break a
  // line, tab: empty tags that are a tab, layout: tags that still end a line inside a cell }. Inside a cell
  // a line end is a space, so a table row stays on one line with its cells split by tabs; but lists and
  // headings inside a cell mean the table is page layout, so they keep their lines.
  const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[!?][^>]*>|<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  const scan = (src, rules) => {
    let out = '', skip = 0, inText = 0, cells = 0, pre = 0;
    const has = (set, n) => set && set.has(n);
    for (const m of src.matchAll(TAG)) {
      const [, cdata, close, rawName, attrs, txt] = m;
      if (txt != null || cdata != null) {
        if (skip || (rules.text && !inText)) continue;
        const t = cdata ?? decode(txt);
        const s = pre ? t : t.replace(/\s+/g, ' ');
        if (s !== ' ' || !/(^|[\n\t ])$/.test(out)) out += s; // indentation between tags isn't text
        continue;
      }
      if (!rawName) continue;
      const name = rules.html ? rawName.toLowerCase() : rawName;
      const empty = !close && /\/\s*$/.test(attrs);
      if (has(rules.skip, name) && !empty) { skip += close ? -1 : 1; if (skip < 0) skip = 0; continue; }
      if (skip) continue;
      if (has(rules.text, name) && !empty) inText += close ? -1 : 1;
      if (name === 'pre') pre += close ? -1 : 1;
      if (has(rules.cell, name) && !empty) {
        if (rules.html) { if (cells) out += '\t'; cells = close ? 0 : 1; } // HTML may leave </td> out: a new cell closes the open one
        else { cells += close ? -1 : 1; if (close) out += '\t'; } // Word nests tables, so count
        continue;
      }
      if (rules.html && cells && (name === 'tr' || name === 'table')) { out += '\t'; cells = 0; }
      if (has(rules.br, name) && !close) out += cells ? ' ' : '\n';
      else if (has(rules.tab, name) && !close) out += '\t';
      else if (has(rules.line, name) && (close || (rules.html && !empty))) {
        if (cells && !has(rules.layout, name)) out += ' ';
        else if ((out = out.replace(/[\t ]+$/, '')) && !out.endsWith('\n')) out += '\n';
      }
    }
    // Tidy: no spaces at line ends or around tabs, no trailing cell tab, at most one blank line.
    return out.replace(/[  ]*\t[  ]*/g, '\t').replace(/[ \t ]+\n/g, '\n').replace(/\n[  ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  const set = (s) => new Set(s.split(' '));

  const WORD = { text: set('w:t'), skip: set('w:delText w:instrText mc:Fallback w:pPr'), line: set('w:p w:tr'), cell: set('w:tc'), br: set('w:br w:cr'), tab: set('w:tab') };
  // Body text of a .docx: headers first (course title, term), then the document.
  const docx = async (bytes) => {
    const z = unzip(bytes);
    const parts = [...z.names.filter((n) => /^word\/header\d*\.xml$/.test(n)).sort(), 'word/document.xml'];
    const texts = [];
    for (const n of parts) { const x = await z.text(n); if (x) texts.push(scan(x, WORD)); }
    if (!z.names.includes('word/document.xml')) throw new Error('not a Word document');
    return [...new Set(texts.filter(Boolean))].join('\n\n');
  };

  const SLIDE = { text: set('a:t'), skip: set('a:fld mc:Fallback'), line: set('a:p a:tr'), cell: set('a:tc'), br: set('a:br') };
  const rels = async (z, path) => {
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    const x = await z.text(`${dir}_rels/${path.slice(dir.length)}.rels`);
    const out = {};
    for (const m of (x || '').matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0])?.[1], target = /\bTarget="([^"]+)"/.exec(m[0])?.[1], type = /\bType="([^"]+)"/.exec(m[0])?.[1] || '';
      if (!id || !target) continue;
      const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/');
      const norm = [];
      for (const p of parts) if (p === '..') norm.pop(); else if (p !== '.') norm.push(p);
      out[id] = { path: norm.join('/'), type: type.slice(type.lastIndexOf('/') + 1) };
    }
    return out;
  };
  // Slides of a .pptx in presentation order, each with its speaker notes. Text comes in the order shapes are
  // stored, which for the usual layouts is title first, then body.
  const pptx = async (bytes) => {
    const z = unzip(bytes);
    const pres = await z.text('ppt/presentation.xml');
    if (!pres) throw new Error('not a PowerPoint presentation');
    const r = await rels(z, 'ppt/presentation.xml');
    const ids = [...(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(pres)?.[1] || '').matchAll(/r:id="([^"]+)"/g)].map((m) => m[1]);
    const out = [];
    for (const id of ids) {
      const path = r[id]?.path;
      const x = path && await z.text(path);
      if (!x) continue;
      const notes = Object.values(await rels(z, path)).find((t) => t.type === 'notesSlide');
      const nx = notes && await z.text(notes.path);
      // Notes pages repeat the slide image and number as placeholders; only the body placeholder is notes.
      const body = nx && [...nx.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).filter((sp) => /<p:ph [^>]*type="body"/.test(sp)).join('');
      out.push({ text: scan(x, SLIDE), notes: body ? scan(body, SLIDE) : '' });
    }
    return out;
  };

  const HTML = {
    html: true,
    text: null,
    skip: set('head svg math iframe object canvas select button nav'),
    line: set('p div li dt dd tr h1 h2 h3 h4 h5 h6 section article header footer main aside blockquote pre ul ol dl table thead tbody tfoot caption figure figcaption form fieldset legend address details summary'),
    cell: set('td th'),
    layout: set('ul ol li dl dt dd h1 h2 h3 h4 h5 h6 table'),
    br: set('br hr'),
  };
  // Readable text of an HTML page or fragment: block elements on their own lines, table rows on one line
  // with tab-separated cells; scripts, styles, navigation and form controls dropped. Script and style
  // bodies go first, since a "<" inside them isn't a tag.
  const html = (src) => scan(String(src).replace(/<(script|style|template|noscript|textarea|title)\b[\s\S]*?<\/\1\s*>/gi, ' '), HTML);

  return { unzip, docx, pptx, html, decode };
})();

if (typeof module !== 'undefined') module.exports = GZ_DOCTEXT;
