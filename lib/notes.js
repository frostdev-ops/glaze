// Notes (Canvas, enhance.notesApp): the parts that don't touch the page, so node can test them. The rich-text sanitizer
// (an allowlist, run on paste, on save and on load), plain text and Markdown out of a note, the library's sort, filter
// and search, the export zip and its import, and every change to the library, applied in the service worker's queue
// (lib/background.js 'glaze:notesapp', run). Where things live: a small index per Canvas site and user in storage.local
// (notesIdx:<origin>/<uid>: titles, folders, courses, times, the trash), and each note's body and its pictures and
// attachments in the extension's own IndexedDB, which only the worker opens: never the school page's storage.
// Classic script for the worker and the page (loaded on demand); module.exports for node. A second injection keeps the first.
var GZ_NOTES = globalThis.GZ_NOTES || (() => {
  const D = () => globalThis.GZ_DOCTEXT || require('./doctext.js');
  const Z = () => globalThis.GZ_ZIP || require('./zip.js');
  const DAY = 864e5;
  const TRASH = 30 * DAY; // the trash keeps notes and folders this long, then they go for good
  // Pictures and attachments each, everything stored on this device (all sites and accounts), one note's HTML, a title,
  // a folder's name, and how many notes and folders one account keeps.
  const LIMIT = { image: 5 << 20, file: 20 << 20, total: 200 << 20, body: 2 << 20, title: 300, name: 80, notes: 5000, folders: 300 };
  const KEY = /^notesIdx:https?:\/\/[a-z\d.-]+(?::\d+)?\/\d{1,20}$/i;
  const storeKey = (origin, uid) => `notesIdx:${origin}/${uid}`;
  const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const COURSE = /^\d{1,20}$/;
  const set = (s) => new Set(s.split(' '));

  // ---- the sanitizer ---------------------------------------------------------------------------------------------
  // HTML in, HTML out, through the one tokenizer lib/doctext.js uses (no DOMParser: it runs in the worker and in node).
  // What comes out is built from scratch: only the elements and attributes below, every attribute quoted and escaped,
  // every text escaped, every element closed. So the browser reads exactly what was checked, whatever the input meant.
  // Dropped with what's in them: scripts, styles, frames, forms' controls, SVG and MathML, media. Kept: headings, bold,
  // italic, underline, strikethrough, lists and checklists, links, quotes, code, tables. Links: http(s) and mailto only,
  // made absolute (against `base`, the page a paste came from), opened with rel="noopener noreferrer". Pictures: only
  // Glaze's own stored ones (data-gz-file; the page shows them through revocable blob: addresses); any other picture
  // becomes a link to it, so opening a note never loads anything from anywhere.
  const RAW = set('script style template noscript textarea title xmp iframe noembed noframes plaintext');
  const DROP = set('script style template noscript textarea title xmp iframe noembed noframes plaintext head svg math object embed applet select option optgroup datalist button input canvas video audio source track picture link meta base frameset frame map area param keygen dialog portal');
  const VOID = set('area base br col embed hr img input link meta param source track wbr keygen');
  const MAP = {
    p: 'p', div: 'div', br: 'br', hr: 'hr', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h3', h5: 'h3', h6: 'h3', strong: 'strong', b: 'strong', em: 'em', i: 'em', cite: 'em',
    u: 'u', ins: 'u', s: 's', strike: 's', del: 's', sub: 'sub', sup: 'sup', code: 'code', kbd: 'code', samp: 'code', tt: 'code', pre: 'pre', blockquote: 'blockquote',
    ul: 'ul', ol: 'ol', li: 'li', a: 'a', img: 'img', table: 'table', thead: 'thead', tbody: 'tbody', tfoot: 'tbody', tr: 'tr', th: 'th', td: 'td',
    section: 'div', article: 'div', header: 'div', footer: 'div', main: 'div', aside: 'div', nav: 'div', figure: 'div', figcaption: 'div', address: 'div',
    center: 'div', details: 'div', summary: 'p', dl: 'div', dt: 'p', dd: 'div',
  };
  const VOID_OUT = set('br hr img');
  const KINDS = set('file page module course');
  const MAX_DEPTH = 48, MAX_NODES = 40000;
  const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const attrsOf = (s) => {
    const out = new Map();
    for (const m of s.matchAll(ATTR)) { const k = m[1].toLowerCase(); if (!out.has(k)) out.set(k, D().decode(m[2] ?? m[3] ?? m[4] ?? '')); }
    return out;
  };
  // An address a note may link to, made absolute, or null. The URL parser is the browser's own algorithm (WHATWG), so
  // "java\tscript:" and friends are seen as what they are; what's written out is the parsed href that was checked.
  const safeUrl = (v, base) => {
    try {
      const u = base ? new URL(v, base) : new URL(v);
      return ['https:', 'http:', 'mailto:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
    } catch { return null; }
  };
  const int = (v, lo, hi) => (/^\d{1,7}$/.test(v.trim()) && +v >= lo && +v <= hi ? String(+v) : null);
  // Google Docs and Word put bold and italics in a span's style (and wrap a whole paste in <b style="font-weight:normal">).
  // ponytail: one of them per span; both on one span keeps the bold.
  const styled = (style) => (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style) ? 'strong' : /font-style\s*:\s*italic/i.test(style) ? 'em'
    : /text-decoration[^;]*underline/i.test(style) ? 'u' : /text-decoration[^;]*line-through/i.test(style) ? 's' : null);
  const clip = (s, n) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
  // What an open tag becomes: an element { tag, attrs, kids }, or null to keep only what's inside it.
  const element = (name, a, base) => {
    let tag = MAP[name] || null;
    if (name === 'span' || name === 'font' || (name === 'b' && /font-weight\s*:\s*(normal|[1-4]00)/i.test(a.get('style') || ''))) tag = styled(a.get('style') || '');
    if (!tag) return null;
    const attrs = {};
    if (tag === 'a') {
      const href = a.has('href') ? safeUrl(a.get('href').trim(), base) : null;
      const file = ID.test(a.get('data-gz-file') || '') ? a.get('data-gz-file') : null;
      if (file) attrs['data-gz-file'] = file;
      else if (href) attrs.href = href;
      else return null;
      if (KINDS.has(a.get('data-gz-kind'))) attrs['data-gz-kind'] = a.get('data-gz-kind');
      if (a.get('title')) attrs.title = clip(a.get('title'), LIMIT.title);
    } else if (tag === 'img') {
      const file = a.get('data-gz-file') || '';
      if (ID.test(file)) attrs['data-gz-file'] = file;
      else {
        // Another site's picture: a link to it instead, named by its alt text or its file name.
        const href = safeUrl((a.get('src') || '').trim(), base);
        if (!href || href.startsWith('mailto:')) return { drop: true };
        const last = new URL(href).pathname.split('/').pop() || '';
        let label = clip(a.get('alt') || '', LIMIT.title).trim();
        try { label ||= decodeURIComponent(last); } catch { label ||= last; }
        return { tag: 'a', attrs: { href }, kids: [label || href], done: true };
      }
      if (a.get('alt')) attrs.alt = clip(a.get('alt'), LIMIT.title);
    } else if (tag === 'ul' && a.has('data-check')) attrs['data-check'] = 'true';
    else if (tag === 'li' && a.get('data-done') === 'true') attrs['data-done'] = 'true';
    else if (tag === 'ol' && a.has('start') && int(a.get('start'), 0, 1e6)) attrs.start = int(a.get('start'), 0, 1e6);
    else if (tag === 'td' || tag === 'th') for (const k of ['colspan', 'rowspan']) if (a.has(k) && int(a.get(k), 1, 100)) attrs[k] = int(a.get(k), 1, 100);
    return { tag, attrs, kids: [] };
  };
  // Opening one of these ends an open <p> (as HTML does), unless a list item, cell, quote or block is between them.
  const ENDS_P = set('p div h1 h2 h3 ul ol li pre blockquote table hr');
  const WALL = set('li td th blockquote div table ul ol');
  // The tree of what's kept: { kids } of { tag, attrs, kids } and strings.
  const parse = (html, { base } = {}) => {
    const root = { kids: [] };
    const stack = []; // { name, node }, node null for an element kept only for what's inside it
    let drop = null, depth = 0, nodes = 0;
    const parent = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].node) return stack[i].node; return root; };
    const popTo = (i) => { stack.length = i; };
    const find = (want, wall) => {
      for (let i = stack.length - 1; i >= 0; i--) {
        const out = stack[i].node?.tag;
        if (want(stack[i], out)) return i;
        if (out && wall.has(out)) return -1;
      }
      return -1;
    };
    for (const tk of D().tokens(String(html || '').slice(0, LIMIT.body * 2), RAW)) {
      if (nodes > MAX_NODES) break;
      if (tk.text != null || tk.cdata != null) {
        if (drop) continue;
        const s = clip(tk.cdata ?? D().decode(tk.text), Infinity);
        if (!s) continue;
        const kids = parent().kids;
        if (typeof kids[kids.length - 1] === 'string') kids[kids.length - 1] += s; else { kids.push(s); nodes++; }
        continue;
      }
      const name = tk.name.toLowerCase();
      if (drop) {
        if (name === drop.name && !VOID.has(name)) drop.depth += tk.close ? -1 : tk.empty ? 0 : 1;
        if (!drop.depth) drop = null;
        continue;
      }
      if (tk.close) {
        const i = find((e) => e.name === name, new Set());
        if (i >= 0) popTo(i);
        continue;
      }
      if (DROP.has(name)) { if (!VOID.has(name) && !tk.empty) drop = { name, depth: 1 }; continue; }
      const el = element(name, attrsOf(tk.attrs), base);
      if (el?.drop) continue;
      const tag = el?.tag;
      if (tag && ENDS_P.has(tag)) { const i = find((e, out) => out === 'p', WALL); if (i >= 0) popTo(i); }
      if (tag === 'li') { const i = find((e, out) => out === 'li', set('ul ol table td th blockquote')); if (i >= 0) popTo(i); }
      if (tag === 'tr') { const i = find((e, out) => out === 'tr', set('table')); if (i >= 0) popTo(i); }
      if (tag === 'td' || tag === 'th') { const i = find((e, out) => out === 'td' || out === 'th', set('tr table')); if (i >= 0) popTo(i); }
      if (/^h[123]$/.test(tag || '') && /^h[123]$/.test(parent().tag || '')) popTo(stack.findLastIndex((e) => e.node === parent()));
      const keep = el && stack.length < MAX_DEPTH;
      if (keep) { parent().kids.push(el); nodes++; }
      if (VOID.has(name) || tk.empty || el?.done) continue;
      stack.push({ name, node: keep && !el.done ? el : null });
      depth = Math.max(depth, stack.length);
    }
    return root;
  };
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escA = (s) => esc(s).replace(/"/g, '&quot;');
  // o.src(id): a picture's address, for an exported page.
  const ser = (n, o = {}) => {
    if (typeof n === 'string') return esc(n);
    let a = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escA(v)}"`).join('');
    if (n.tag === 'a' && n.attrs.href) a += ' rel="noopener noreferrer" target="_blank"';
    if (n.tag === 'img' && o.src) { const src = o.src(n.attrs['data-gz-file']); if (src) a += ` src="${escA(src)}"`; }
    return `<${n.tag}${a}>${VOID_OUT.has(n.tag) ? '' : `${n.kids.map((k) => ser(k, o)).join('')}</${n.tag}>`}`;
  };
  const sanitize = (html, opts) => parse(html, opts).kids.map((k) => ser(k, opts)).join('');

  // ---- text and Markdown out of a note -----------------------------------------------------------------------------
  const BLOCK = set('p div h1 h2 h3 ul ol li pre blockquote table thead tbody tr hr');
  const text = (html) => {
    let out = '';
    const walk = (n) => {
      if (typeof n === 'string') { out += n; return; }
      if (n.tag === 'br') { out += '\n'; return; }
      if (n.tag === 'img') { out += n.attrs.alt ? ` ${n.attrs.alt} ` : ' '; return; }
      if (BLOCK.has(n.tag) || n.tag === 'td' || n.tag === 'th') out += n.tag === 'td' || n.tag === 'th' ? '\t' : '\n';
      n.kids.forEach(walk);
      if (BLOCK.has(n.tag)) out += '\n';
    };
    parse(html).kids.forEach(walk);
    return out.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  };
  const excerpt = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 140);
  // o.path(id): where a picture or attachment is in the export (relative to the note's file), or null.
  const raw = (n) => (typeof n === 'string' ? n : n.tag === 'br' ? '\n' : n.kids.map(raw).join(''));
  const markdown = (html, o = {}) => {
    const mdEsc = (s) => s.replace(/[\\`*_[\]<>~]/g, '\\$&');
    const inline = (n) => {
      if (typeof n === 'string') return mdEsc(n.replace(/\s+/g, ' '));
      const x = () => n.kids.map((k) => inline(k)).join('');
      switch (n.tag) {
        case 'br': return '\\\n';
        case 'strong': return wrap('**', x());
        case 'em': return wrap('*', x());
        case 's': return wrap('~~', x());
        case 'u': case 'sub': case 'sup': return `<${n.tag}>${x()}</${n.tag}>`;
        case 'code': { const s = raw(n); const fence = '`'.repeat((s.match(/`+/g) || ['']).reduce((m, r) => Math.max(m, r.length), 0) + 1); return `${fence}${/^`|`$/.test(s) ? ` ${s} ` : s}${fence}`; }
        case 'a': { const href = n.attrs.href || o.path?.(n.attrs['data-gz-file']); return href ? `[${x() || mdEsc(href)}](<${href.replace(/[<>]/g, encodeURIComponent)}>)` : x(); }
        case 'img': { const p = o.path?.(n.attrs['data-gz-file']); return p ? `![${mdEsc(n.attrs.alt || '')}](<${p}>)` : ''; }
        default: return BLOCK.has(n.tag) ? block(n) : x();
      }
    };
    const wrap = (m, s) => (s.trim() ? s.replace(/^(\s*)([\s\S]*?)(\s*)$/, `$1${m}$2${m}$3`) : s);
    const blocks = (kids) => {
      const out = [];
      let run = [];
      const flush = () => { const s = run.map((k) => inline(k)).join('').replace(/^ +| +$/gm, '').trim(); if (s) out.push(s); run = []; };
      for (const k of kids) { if (typeof k !== 'string' && BLOCK.has(k.tag)) { flush(); const b = block(k); if (b) out.push(b); } else run.push(k); }
      flush();
      return out.join('\n\n');
    };
    const indent = (s, by) => s.split('\n').map((l, i) => (i && l ? by + l : l)).join('\n');
    const block = (n) => {
      switch (n.tag) {
        case 'h1': case 'h2': case 'h3': { const s = n.kids.map((k) => inline(k)).join('').replace(/\s+/g, ' ').trim(); return s && `${'#'.repeat(+n.tag[1])} ${s}`; }
        case 'blockquote': return blocks(n.kids).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
        case 'pre': { const s = raw(n).replace(/\n$/, ''); const f = '`'.repeat(Math.max(3, ...(s.match(/`{3,}/g) || []).map((r) => r.length + 1))); return `${f}\n${s}\n${f}`; }
        case 'hr': return '---';
        case 'ul': case 'ol': {
          let i = Number(n.attrs.start || 1);
          return n.kids.filter((k) => typeof k !== 'string' || k.trim()).map((k) => {
            const mark = n.tag === 'ol' ? `${i++}. ` : n.attrs['data-check'] ? `- [${k.attrs?.['data-done'] ? 'x' : ' '}] ` : '- ';
            return mark + indent(typeof k === 'string' ? mdEsc(k.trim()) : k.tag === 'li' ? blocks(k.kids) : inline(k), ' '.repeat(n.tag === 'ol' ? mark.length : 2));
          }).join('\n');
        }
        case 'li': return `- ${indent(blocks(n.kids), '  ')}`;
        case 'table': {
          const rows = [];
          const walk = (k) => { if (typeof k === 'string') return; if (k.tag === 'tr') rows.push(k.kids.filter((c) => typeof c !== 'string').map((c) => c.kids.map((x) => inline(x)).join('').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim())); else k.kids.forEach(walk); };
          n.kids.forEach(walk);
          if (!rows.length) return '';
          const w = Math.max(...rows.map((r) => r.length));
          const line = (r) => `| ${Array.from({ length: w }, (_, j) => r[j] || '').join(' | ')} |`;
          return [line(rows[0]), `|${' --- |'.repeat(w)}`, ...rows.slice(1).map(line)].join('\n');
        }
        case 'thead': case 'tbody': case 'tr': return blocks(n.kids);
        default: return blocks(n.kids);
      }
    };
    return blocks(parse(html).kids);
  };

  // ---- the library: what's kept in storage.local ------------------------------------------------------------------
  // { notes: { id: { title, folder, course, created, at (last edit), rev, ft {title, folder, course: when each was last
  //   set}, ex (the start of its text), sid (the last save applied), del? (when trashed), with? (the folder it went to
  //   the trash with) } }, folders: { id: { name, course, order, created, del? } }, gone: { id: when it was deleted for
  //   good } }. A course is a Canvas course id on the same site; folder '' is No folder.
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const str = (v, max) => (typeof v === 'string' ? clip(v, max) : '');
  const time = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const cid = (v) => (typeof v === 'string' && COURSE.test(v) ? v : '');
  const clean = (raw) => {
    const r = obj(raw);
    const folders = {}, notes = {}, gone = {};
    for (const [id, f] of Object.entries(obj(r.folders))) {
      if (!ID.test(id) || !f || typeof f !== 'object') continue;
      folders[id] = { name: str(f.name, LIMIT.name).trim() || '…', course: cid(f.course), cn: str(f.cn, 120), order: Number.isFinite(f.order) ? f.order : 0, created: time(f.created), ...(time(f.del) && { del: f.del }) };
    }
    for (const [id, n] of Object.entries(obj(r.notes))) {
      if (!ID.test(id) || !n || typeof n !== 'object') continue;
      const ft = obj(n.ft);
      notes[id] = {
        title: str(n.title, LIMIT.title), folder: folders[n.folder] ? n.folder : '', course: cid(n.course), cn: str(n.cn, 120), created: time(n.created), at: time(n.at),
        rev: Number.isInteger(n.rev) && n.rev >= 0 ? n.rev : 0, ft: { title: time(ft.title), folder: time(ft.folder), course: time(ft.course) }, ex: str(n.ex, 160), sid: str(n.sid, 40),
        ...(time(n.del) && { del: n.del }), ...(time(n.del) && folders[n.with] && { with: n.with }),
      };
    }
    for (const [id, at] of Object.entries(obj(r.gone))) if (ID.test(id) && time(at)) gone[id] = at;
    return { notes, folders, gone };
  };
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const terms = (q) => fold(q).split(/\s+/).filter(Boolean).slice(0, 8);
  // The library's list: { trash, course ('' every course, '-' none, or an id), folder ('*' every folder, '' none, or an id),
  // q (searched in titles here; `found` adds the notes whose text the worker found it in), sort ('at', 'created', 'title') }.
  const list = (idx, { trash = false, course = '', folder = '*', q = '', found = null, sort = 'at' } = {}) => {
    const want = terms(q);
    const by = sort === 'title' ? (a, b) => (a[1].title || '').localeCompare(b[1].title || '', undefined, { numeric: true, sensitivity: 'base' }) || b[1].at - a[1].at
      : sort === 'created' ? (a, b) => b[1].created - a[1].created : (a, b) => b[1].at - a[1].at;
    return Object.entries(idx.notes).filter(([id, n]) => !!n.del === trash
      && (course === '' || (course === '-' ? !n.course : n.course === course))
      && (folder === '*' || n.folder === folder)
      && (!want.length || want.every((w) => fold(n.title).includes(w)) || !!found?.has(id))).sort(by);
  };
  const folderList = (idx, { trash = false } = {}) => Object.entries(idx.folders).filter(([, f]) => !!f.del === trash)
    .sort((a, b) => a[1].order - b[1].order || a[1].created - b[1].created);
  // Gone for good: from the index (with a tombstone, so a change still on its way can't bring it back) → the notes whose
  // bodies go. A folder's notes still in the library stay, in No folder.
  const purge = (idx, ids, now) => {
    const out = [];
    for (const id of ids) {
      if (idx.notes[id]) { delete idx.notes[id]; idx.gone[id] = now; out.push(id); } else if (idx.folders[id]) {
        delete idx.folders[id];
        idx.gone[id] = now;
        for (const n of Object.values(idx.notes)) { if (n.folder === id) n.folder = ''; if (n.with === id) delete n.with; }
      }
    }
    return out;
  };
  // The trash's 30 days, and tombstones kept as long.
  const expire = (idx, now) => {
    for (const [id, at] of Object.entries(idx.gone)) if (at < now - TRASH) delete idx.gone[id];
    return purge(idx, [...Object.entries(idx.folders), ...Object.entries(idx.notes)].filter(([, x]) => x.del && x.del < now - TRASH).map(([id]) => id), now);
  };
  // A course and its name as Canvas showed it (so a past term's course still reads as a name), from a change or, failing
  // that, from the folder a note goes into.
  const courseOf = (m, f) => (cid(m?.course) ? { course: cid(m.course), cn: str(m.cn, 120) } : { course: f?.course || '', cn: f?.cn || '' });
  const liveFolder = (idx, id) => (idx.folders[id] && !idx.folders[id].del ? id : '');

  // ---- files ---------------------------------------------------------------------------------------------------------
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const r = atob(s); const b = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) b[i] = r.charCodeAt(i); return b; };
  // A picture by its first bytes, not its name or the type it claims: PNG, JPEG, GIF or WebP, nothing else (an SVG can
  // carry script; shown from a blob: address it would run as the school's site).
  const imageType = (b) => {
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
    return null;
  };
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  const fileName = (s) => str(s, 200).replace(/[\\/]/g, '_').trim() || 'file';
  const refs = (html) => new Set([...String(html).matchAll(/data-gz-file="([0-9a-f-]{36})"/g)].map((m) => m[1]));

  // ---- changes, in the worker's queue ----------------------------------------------------------------------------
  // m: { key (this site's and account's index), op, … }. db: the worker's IndexedDB, as get(store, key), put(store, key,
  // value), del(store, keys), scan(store, prefix) → [[key, value]] and estimate(). Stores: bodies ({ html, t: its text,
  // folded for search }), files (what each is) and blobs (its bytes), each keyed <origin>/<uid>/<id>. Every change is applied to what is
  // stored when its turn comes. A read that fails fails the change: nothing is written from a guess.
  const run = async (m, { local }, db, now = Date.now()) => {
    if (typeof m?.key !== 'string' || !KEY.test(m.key)) return { ok: false, error: 'bad' };
    const scope = m.key.slice('notesIdx:'.length);
    const bk = (id) => `${scope}/${id}`;
    let idx, before;
    try { const got = await local.get(m.key); before = JSON.stringify(got?.[m.key] ?? null); idx = clean(got?.[m.key]); } catch { return { ok: false, error: 'read' }; }
    const purged = expire(idx, now);
    const save = async () => (JSON.stringify(idx) === before || await local.set({ [m.key]: idx }));
    // Pictures and attachments no note in this account uses any more: those of notes gone for good at once, the
    // rest after a day (an undo can bring a removed picture back, and a paste is stored before its note is saved).
    const gc = async () => {
      const used = new Set();
      for (const [, b] of await db.scan('bodies', `${scope}/`)) for (const id of refs(b?.html || '')) used.add(id);
      const drop = (await db.scan('files', `${scope}/`)).filter(([k, f]) => !used.has(k.slice(scope.length + 1)) && (!idx.notes[f?.note] || !(f?.at > now - DAY))).map(([k]) => k);
      if (drop.length) { await db.del('files', drop); await db.del('blobs', drop); }
      return drop.length;
    };
    const finish = async (reply) => {
      if (!await save()) return { ok: false, error: 'write' };
      if (purged.length) { await db.del('bodies', purged.map(bk)); await gc(); }
      return reply;
    };
    const count = () => Object.keys(idx.notes).length;
    const at = time(m.at) || now;
    const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && ID.test(x)).slice(0, LIMIT.notes) : []);
    // A note's body goes in first, then the index: if the index can't be written the save fails, and the page tries
    // again from the same base, which still matches.
    const write = async (id, html, note) => {
      const plain = text(html);
      await db.put('bodies', bk(id), { html, t: fold(plain), at: now, rev: note.rev });
      idx.notes[id] = { ...note, ex: excerpt(plain) };
    };
    switch (m.op) {
      case 'load': {
        const n = idx.notes[m.id];
        if (!n) return finish({ ok: false, error: 'gone' });
        const b = await db.get('bodies', bk(m.id));
        // A note that was saved but whose text can't be found: an error, never an empty note to type over.
        if (!b && n.rev > 0) return finish({ ok: false, error: 'missing' });
        return finish({ ok: true, html: sanitize(b?.html || ''), rev: n.rev });
      }
      case 'save': {
        // m: { id, base (the revision the page started from; 0 for a new note), sid (this save, so a retry is
        // recognised), html, copy (an id for a conflict copy), copyTitle, and for a new note title, folder, course }.
        if (!ID.test(m.id) || typeof m.sid !== 'string' || !m.sid || m.sid.length > 40 || !Number.isInteger(m.base) || typeof m.html !== 'string') return { ok: false, error: 'bad' };
        const html = sanitize(m.html);
        if (html.length > LIMIT.body) return { ok: false, error: 'big' };
        const n = idx.notes[m.id];
        // A retry of a save that landed (its answer was lost): again, so the page sends anything typed since afresh.
        if (n?.sid === m.sid) return finish({ ok: true, id: m.id, rev: n.rev, again: true });
        if (ID.test(m.copy || '') && idx.notes[m.copy]?.sid === m.sid) return finish({ ok: true, id: m.copy, rev: idx.notes[m.copy].rev, conflict: true, again: true });
        if (n ? !n.del && n.rev === m.base : m.base === 0 && !idx.gone[m.id]) {
          if (!n && count() >= LIMIT.notes) return finish({ ok: false, error: 'many' });
          const folder = liveFolder(idx, m.folder);
          const note = n ? { ...n, at: now, rev: n.rev + 1, sid: m.sid }
            : { title: str(m.title, LIMIT.title).trim(), folder, ...courseOf(m, idx.folders[folder]), created: now, at: now, rev: 1, ft: { title: at, folder: at, course: at }, ex: '', sid: m.sid };
          await write(m.id, html, note);
          return finish({ ok: true, id: m.id, rev: note.rev });
        }
        // Both changed (another tab saved since this page read it), or it went to the trash or for good meanwhile: what
        // this page has becomes a copy beside it, and the stored note stays as it is. Nothing is lost.
        if (!ID.test(m.copy || '') || idx.notes[m.copy] || idx.gone[m.copy]) return finish({ ok: false, error: 'bad' });
        if (count() >= LIMIT.notes) return finish({ ok: false, error: 'many' });
        const folder = liveFolder(idx, n?.folder);
        const title = str(m.copyTitle, LIMIT.title).trim() || n?.title || str(m.title, LIMIT.title);
        await write(m.copy, html, { title, folder, ...(n ? { course: n.course, cn: n.cn } : courseOf(m)), created: now, at: now, rev: 1, ft: { title: at, folder: at, course: at }, ex: '', sid: m.sid });
        return finish({ ok: true, id: m.copy, rev: 1, conflict: true });
      }
      case 'meta': {
        // Rename, move, or change the course: each field is set only by a change made after its last one.
        const n = idx.notes[m.id];
        if (!n) return finish({ ok: false, error: 'gone' });
        if (typeof m.title === 'string' && at >= n.ft.title) { n.title = str(m.title, LIMIT.title).trim(); n.ft.title = at; }
        if (typeof m.folder === 'string' && at >= n.ft.folder) {
          n.folder = liveFolder(idx, m.folder);
          n.ft.folder = at;
          if (idx.folders[n.folder]?.course && at >= n.ft.course) { Object.assign(n, courseOf(idx.folders[n.folder])); n.ft.course = at; }
        }
        if (typeof m.course === 'string' && at >= n.ft.course) { Object.assign(n, courseOf(m)); n.ft.course = at; }
        return finish({ ok: true });
      }
      case 'trash': {
        for (const id of ids(m.ids)) if (idx.notes[id] && !idx.notes[id].del) idx.notes[id].del = now;
        return finish({ ok: true });
      }
      case 'restore': {
        for (const id of ids(m.ids)) {
          const f = idx.folders[id];
          if (f?.del) {
            delete f.del;
            for (const n of Object.values(idx.notes)) if (n.with === id) { delete n.del; delete n.with; }
          }
          const n = idx.notes[id];
          if (n?.del) { delete n.del; delete n.with; n.folder = liveFolder(idx, n.folder); }
        }
        return finish({ ok: true });
      }
      case 'purge': {
        purged.push(...purge(idx, ids(m.ids).filter((id) => idx.notes[id]?.del || idx.folders[id]?.del), now));
        return finish({ ok: true });
      }
      case 'empty': {
        // Empty trash: what was in the trash when it was pressed. Something trashed after that (another tab) stays.
        purged.push(...purge(idx, [...Object.entries(idx.folders), ...Object.entries(idx.notes)].filter(([, x]) => x.del && x.del <= at).map(([id]) => id), now));
        return finish({ ok: true });
      }
      case 'folder': {
        if (!ID.test(m.id)) return { ok: false, error: 'bad' };
        if (idx.gone[m.id]) return finish({ ok: false, error: 'gone' });
        let f = idx.folders[m.id];
        if (!f) {
          if (Object.keys(idx.folders).length >= LIMIT.folders) return finish({ ok: false, error: 'many' });
          f = idx.folders[m.id] = { name: '…', course: '', order: Math.max(0, ...Object.values(idx.folders).map((x) => x.order + 1)), created: now };
        }
        if (typeof m.name === 'string' && m.name.trim()) f.name = str(m.name, LIMIT.name).trim();
        if (typeof m.course === 'string') Object.assign(f, courseOf(m));
        return finish({ ok: true });
      }
      case 'order': {
        ids(m.ids).forEach((id, i) => { if (idx.folders[id]) idx.folders[id].order = i; });
        return finish({ ok: true });
      }
      case 'folderDel': {
        // A folder to the trash, and its notes as the student chose: out to No folder ('keep'), or to the trash with it
        // ('trash', back with it when it's restored).
        const f = idx.folders[m.id];
        if (!f || !['keep', 'trash'].includes(m.notes)) return finish({ ok: false, error: f ? 'bad' : 'gone' });
        f.del = now;
        for (const n of Object.values(idx.notes)) {
          if (n.folder !== m.id || n.del) continue;
          if (m.notes === 'trash') { n.del = now; n.with = m.id; } else { n.folder = ''; n.ft.folder = at; }
        }
        return finish({ ok: true });
      }
      case 'file': {
        // m: { id, kind ('image' or 'file'), name, data (base64), note }. A picture must be one (by its bytes); an
        // attachment is kept as bytes only, and only ever offered as a download.
        if (!ID.test(m.id) || !['image', 'file'].includes(m.kind) || typeof m.data !== 'string' || !ID.test(m.note || '')) return { ok: false, error: 'bad' };
        const cap = LIMIT[m.kind];
        if (m.data.length > Math.ceil(cap / 3) * 4 + 4) return { ok: false, error: 'big' };
        let bytes;
        try { bytes = unb64(m.data); } catch { return { ok: false, error: 'bad' }; }
        if (bytes.length > cap) return { ok: false, error: 'big' };
        const type = m.kind === 'image' ? imageType(bytes) : 'application/octet-stream';
        if (!type) return { ok: false, error: 'type' };
        if (await db.get('files', bk(m.id))) return finish({ ok: true, id: m.id });
        const used = (await db.scan('files', '')).reduce((n, [, f]) => n + (f?.size || 0), 0);
        if (used + bytes.length > LIMIT.total) return finish({ ok: false, error: 'full' });
        const est = await Promise.resolve(db.estimate?.()).catch(() => null);
        if (est?.quota && est.quota - est.usage < bytes.length * 2) return finish({ ok: false, error: 'full' });
        // The bytes first, then what they are: a listing never reads the bytes, and a file without bytes is never listed.
        await db.put('blobs', bk(m.id), bytes);
        await db.put('files', bk(m.id), { kind: m.kind, name: fileName(m.name), type, size: bytes.length, note: m.note, at: now });
        return finish({ ok: true, id: m.id });
      }
      case 'getFile': {
        const f = ID.test(m.id || '') && await db.get('files', bk(m.id));
        const bytes = f && await db.get('blobs', bk(m.id));
        return finish(bytes ? { ok: true, kind: f.kind, name: f.name, type: f.type, size: f.size, data: b64(bytes) } : { ok: false, error: 'gone' });
      }
      case 'search': {
        // The notes whose text has every word (titles are searched on the page, from the index).
        const want = terms(m.q);
        if (!want.length) return finish({ ok: true, ids: [] });
        const found = [];
        for (const [k, b] of await db.scan('bodies', `${scope}/`)) {
          const id = k.slice(scope.length + 1);
          if (idx.notes[id] && found.length < 1000 && typeof b?.t === 'string' && want.every((w) => b.t.includes(w))) found.push(id);
        }
        return finish({ ok: true, ids: found });
      }
      case 'usage': {
        const files = await db.scan('files', '');
        const mine = files.filter(([k]) => k.startsWith(`${scope}/`)).reduce((n, [, f]) => n + (f?.size || 0), 0);
        const bodies = (await db.scan('bodies', `${scope}/`)).reduce((n, [, b]) => n + (b?.html?.length || 0), 0);
        const est = await Promise.resolve(db.estimate?.()).catch(() => null);
        return finish({ ok: true, mine: mine + bodies, files: files.reduce((n, [, f]) => n + (f?.size || 0), 0), limit: LIMIT.total, usage: est?.usage ?? null, quota: est?.quota ?? null });
      }
      case 'tidy': return finish({ ok: true, freed: await gc() });
      case 'import': {
        // A batch read from an export (parseExport): new folders and new notes, never over existing ones.
        const fs = Array.isArray(m.folders) ? m.folders.slice(0, LIMIT.folders) : [];
        const ns = Array.isArray(m.notes) ? m.notes.slice(0, 50) : [];
        for (const f of fs) {
          if (!ID.test(f?.id || '') || idx.folders[f.id] || idx.gone[f.id]) continue;
          if (Object.keys(idx.folders).length >= LIMIT.folders) return finish({ ok: false, error: 'many' });
          idx.folders[f.id] = { name: str(f.name, LIMIT.name).trim() || '…', ...courseOf(f), order: Math.max(0, ...Object.values(idx.folders).map((x) => x.order + 1)), created: now };
        }
        let n = 0;
        for (const x of ns) {
          if (!ID.test(x?.id || '') || idx.notes[x.id] || idx.gone[x.id] || typeof x.html !== 'string') continue;
          if (count() >= LIMIT.notes) return finish({ ok: false, error: 'many', done: n });
          const html = sanitize(x.html);
          if (html.length > LIMIT.body) continue;
          const created = Math.min(time(x.created) || now, now);
          const folder = liveFolder(idx, x.folder);
          await write(x.id, html, { title: str(x.title, LIMIT.title).trim(), folder, ...courseOf(x, idx.folders[folder]), created, at: Math.min(Math.max(time(x.at), created), now), rev: 1, ft: { title: at, folder: at, course: at }, ex: '', sid: '' });
          n++;
        }
        return finish({ ok: true, done: n });
      }
      default: return { ok: false, error: 'bad' };
    }
  };

  // ---- export and import -----------------------------------------------------------------------------------------
  // Everything as one zip: notes.json (folders, notes with their HTML, the files' list: what an import reads, so it
  // round-trips), each note as Markdown under notes/<folder>/, and its pictures and attachments under files/.
  // data: { site, folders [{ id, name, course, order }], notes [{ id, title, folder, course, created, at, html }],
  // files [{ id, kind, name, type, bytes }] } → the zip's entries for GZ_ZIP.zip.
  const FORMAT = 'glaze-notes';
  const exportZip = ({ site, folders, notes, files }, date = new Date()) => {
    const Zp = Z();
    const enc = new TextEncoder();
    const taken = new Set();
    const where = new Map();
    for (const f of files) {
      const path = Zp.unique(f.kind === 'image' ? `files/${f.id}.${EXT[f.type] || 'bin'}` : `files/${f.id}/${Zp.safeName(f.name)}`, taken);
      where.set(f.id, path);
    }
    const names = new Map(folders.map((f) => [f.id, Zp.safeName(f.name)]));
    const out = [];
    const list = notes.map((n) => {
      const dir = names.has(n.folder) ? `notes/${names.get(n.folder)}/` : 'notes/';
      const path = Zp.unique(`${dir}${Zp.safeName(n.title)}.md`, taken);
      const up = '../'.repeat(path.split('/').length - 1);
      const md = `# ${(n.title || '').replace(/\s+/g, ' ')}\n\n${markdown(n.html, { path: (id) => (where.has(id) ? up + where.get(id) : null) })}\n`;
      out.push({ name: path, data: enc.encode(md), date });
      return { id: n.id, title: n.title, folder: n.folder, course: n.course, cn: n.cn || '', created: n.created, at: n.at, html: n.html, path };
    });
    const manifest = { format: FORMAT, version: 1, site, exported: date.toISOString(), folders: folders.map(({ id, name, course, cn, order }) => ({ id, name, course, cn: cn || '', order })), notes: list,
      files: files.map((f) => ({ id: f.id, kind: f.kind, name: f.name, type: f.type, size: f.bytes.length, path: where.get(f.id) })) };
    for (const f of files) out.push({ name: where.get(f.id), data: f.bytes, date });
    return [{ name: 'notes.json', data: enc.encode(JSON.stringify(manifest, null, 1)), date }, ...out];
  };
  // notes.json read back: checked field by field (nothing in it runs; JSON.parse only), HTML sanitized, every file named
  // by an id and a path inside the zip, its size declared. Course ids are kept only from this same site. ids: a fresh
  // id per folder, note and file (so an import never touches what's there), from the caller.
  const parseExport = (json, { site, id }) => {
    const r = obj(typeof json === 'string' ? JSON.parse(json) : json);
    if (r.format !== FORMAT || r.version !== 1) throw new Error('not a Glaze notes export');
    const same = r.site === site;
    const fmap = new Map(), nmap = new Map(), xmap = new Map();
    const files = (Array.isArray(r.files) ? r.files : []).slice(0, 5000).filter((f) => ID.test(f?.id || '') && ['image', 'file'].includes(f.kind)
      && typeof f.path === 'string' && /^files\//.test(f.path) && !f.path.split('/').includes('..') && Number.isInteger(f.size) && f.size >= 0 && f.size <= LIMIT[f.kind] && !xmap.has(f.id) && xmap.set(f.id, id()))
      .map((f) => ({ id: xmap.get(f.id), from: f.id, kind: f.kind, name: fileName(f.name), path: f.path, size: f.size }));
    const folders = (Array.isArray(r.folders) ? r.folders : []).slice(0, LIMIT.folders).filter((f) => ID.test(f?.id || '') && !fmap.has(f.id) && fmap.set(f.id, id()))
      .map((f) => ({ id: fmap.get(f.id), name: str(f.name, LIMIT.name).trim() || '…', course: same ? cid(f.course) : '', cn: same ? str(f.cn, 120) : '', order: Number.isFinite(f.order) ? f.order : 0 }));
    const remap = (html) => sanitize(String(html).replace(/data-gz-file="([0-9a-f-]{36})"/g, (m, x) => (xmap.has(x) ? `data-gz-file="${xmap.get(x)}"` : '')));
    const notes = (Array.isArray(r.notes) ? r.notes : []).slice(0, LIMIT.notes).filter((n) => ID.test(n?.id || '') && typeof n.html === 'string' && n.html.length <= LIMIT.body * 2 && !nmap.has(n.id) && nmap.set(n.id, id()))
      .map((n) => ({ id: nmap.get(n.id), title: str(n.title, LIMIT.title).trim(), folder: fmap.get(n.folder) || '', course: same ? cid(n.course) : '', cn: same ? str(n.cn, 120) : '', created: time(n.created), at: time(n.at), html: remap(n.html) }));
    return { folders, notes, files };
  };

  // ---- Canvas links -----------------------------------------------------------------------------------------------
  // A course's files, pages and module items, as Canvas's API lists them, into links: { title, href, kind }. Only
  // addresses on this Canvas site are kept; only the link and its title are ever stored.
  const canvasLinks = (kind, items, origin, course) => {
    const here = (u) => { try { const x = new URL(u, origin); return x.origin === origin ? x.href : null; } catch { return null; } };
    const out = [];
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || typeof it !== 'object') continue;
      if (kind === 'file' && /^\d+$/.test(String(it.id))) out.push({ title: str(it.display_name || it.filename, LIMIT.title), href: `${origin}/courses/${course}/files/${it.id}`, kind });
      else if (kind === 'page' && typeof it.url === 'string') out.push({ title: str(it.title, LIMIT.title), href: here(it.html_url) || `${origin}/courses/${course}/pages/${encodeURIComponent(it.url)}`, kind });
      else if (kind === 'module') for (const x of Array.isArray(it.items) ? it.items : []) { const href = x?.type !== 'SubHeader' && here(x?.html_url); if (href) out.push({ title: str(x.title, LIMIT.title), href, kind, group: str(it.name, LIMIT.title) }); }
    }
    return out.filter((l) => l.title && l.href);
  };

  return { LIMIT, TRASH, KEY, ID, storeKey, sanitize, text, excerpt, markdown, clean, fold, terms, list, folderList, run, b64, unb64, imageType, EXT, refs, exportZip, parseExport, canvasLinks, safeUrl };
})();

if (typeof module !== 'undefined') module.exports = GZ_NOTES; else GZ_NOTES;
