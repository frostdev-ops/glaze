// Glaze Writer's rich paste (writer.html, after writer-paper.js): HTML from Word, Google Docs and web pages normalised to
// what a paper holds before the paper schema reads it (lib/writer-editor.js transformPastedHTML calls before()). Word's
// clipboard document is read with its <style> block's Mso classes, mso- properties (highlight, exact line heights,
// pagination) and its list paragraphs (mso-list, their marker spans) as real lists; Docs' guid wrapper, its 1.38 / 1.2
// line heights (its 1.15 and single) and aria-level lists; a web page's marks, colours and paper fonts, not its layout.
// Fonts, sizes, colours, highlight, caps, spacing and indents become the paper's marks and paragraph settings, what equals
// the paper's own left unmarked. After a paste with formatting a toast asks once per paper: Keep formatting (the default,
// also when it goes unanswered) or Match the paper; the answer is the paper's doc attribute `paste`, and storage.sync
// writer.pasteAsk false keeps formatting without asking. ⌘⇧V pastes plain text (ProseMirror's shift paste).
// The normaliser, strip() and tidy() are plain functions for node tests; then the frame.
var GZ_WRITER_PASTE = globalThis.GZ_WRITER_PASTE || (() => {
  const S = () => globalThis.GZ_WRITER_SCHEMA || require('./lib/writer-schema.js');
  const limit = () => { throw Object.assign(new RangeError('writer-paste: input exceeds safe limits'), { code: 'WRITER_INPUT_LIMIT' }); };
  const ST = () => globalThis.GZ_WRITER_STYLES || require('./lib/writer-styles.js');

  // ---- a small tree of the clipboard HTML (the schema's tokenizer; nothing reaches a live document)
  const VOID = new Set(['br', 'hr', 'img', 'wbr', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track']);
  const SKIP = new Set(['title', 'script', 'style', 'template', 'noscript', 'xml', 'textarea', 'select', 'button', 'iframe', 'object', 'svg', 'math', 'video', 'audio', 'canvas']);
  const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'blockquote', 'pre', 'hr',
    'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'address', 'dl', 'dt', 'dd', 'center', 'form', 'fieldset', 'details', 'summary', 'caption', 'body', 'html']);
  const styleMap = (raw) => {
    const out = {};
    for (const rule of String(raw || '').split(';')) {
      const at = rule.indexOf(':');
      if (at > 0) out[rule.slice(0, at).trim().toLowerCase()] = rule.slice(at + 1).replace(/!important/i, '').trim();
    }
    return out;
  };
  const tree = (html) => {
    const H = S().html, root = { name: '#root', a: {}, kids: [] }, stack = [root];
    let at = 0, skip = null, depth = 0, css = '', cssAt = -1, count = 0;
    const top = () => stack.at(-1);
    const closeTo = (i) => { stack.length = Math.max(1, i); };
    const find = (names, stops = []) => { for (let i = stack.length - 1; i > 0; i--) { if (names.includes(stack[i].name)) return i; if (stops.includes(stack[i].name)) return -1; } return -1; };
    for (const t of H.tags(html)) {
      if (++count > S().MAX_TOKENS) limit();
      if (!skip && t.start > at) { const s = html.slice(at, t.start); if (s) top().kids.push({ text: H.decode(s) }); }
      at = t.end;
      const name = t.name;
      if (skip) {
        if (name === skip) depth += t.closing ? -1 : 1;
        if (depth === 0) { if (skip === 'style' && cssAt >= 0) css += html.slice(cssAt, t.start); skip = null; cssAt = -1; }
        continue;
      }
      if (!name) continue;
      if (SKIP.has(name) && !t.closing) { if (!VOID.has(name) && !/\/\s*$/.test(t.raw)) { skip = name; depth = 1; if (name === 'style') cssAt = t.end; } continue; }
      if (t.closing) { const i = find([name]); if (i > 0) closeTo(i); continue; }
      if (BLOCK.has(name)) { const i = find(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'], ['li', 'td', 'th', 'blockquote', 'div']); if (i > 0) closeTo(i); }
      if (name === 'li') { const i = find(['li'], ['ul', 'ol']); if (i > 0) closeTo(i); }
      if (name === 'td' || name === 'th') { const i = find(['td', 'th'], ['tr', 'table']); if (i > 0) closeTo(i); }
      if (name === 'tr') { const i = find(['tr'], ['table']); if (i > 0) closeTo(i); }
      const a = H.attrs(t.raw), e = { name, a, style: styleMap(a.style), kids: [] };
      top().kids.push(e);
      if (!VOID.has(name) && !/\/\s*$/.test(t.raw)) { if (stack.length >= S().MAX_DEPTH) limit(); stack.push(e); }
    }
    if (!skip && at < html.length) top().kids.push({ text: H.decode(html.slice(at)) });
    return { root, css };
  };
  // Word's <style> block: tag, .class and tag.class rules (the Mso classes), at-rules left out.
  const rules = (css) => {
    const out = new Map();
    const src = css.replace(/<!--|-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of src.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const before = src.slice(0, m.index), at = before.lastIndexOf('@'), open = before.lastIndexOf('}');
      if (at > open) continue; // inside an at-rule's head (@font-face, @list, @page)
      const decls = styleMap(m[2]);
      for (const sel of m[1].split(',').map((x) => x.trim().toLowerCase())) if (/^[a-z0-9]*(\.[\w-]+)?$/.test(sel) && sel) out.set(sel, { ...(out.get(sel) || {}), ...decls });
    }
    return out;
  };
  const own = (e, ctx) => {
    if (!ctx.rules.size) return e.style;
    const cls = String(e.a.class || '').toLowerCase().split(/\s+/).filter(Boolean);
    return Object.assign({}, ctx.rules.get(e.name), ...cls.map((c) => ctx.rules.get(`.${c}`)), ...cls.map((c) => ctx.rules.get(`${e.name}.${c}`)), e.style);
  };

  // ---- values
  const COLORS = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', lime: '00FF00', blue: '0000FF', yellow: 'FFFF00', aqua: '00FFFF', cyan: '00FFFF', fuchsia: 'FF00FF', magenta: 'FF00FF',
    navy: '000080', teal: '008080', purple: '800080', maroon: '800000', olive: '808000', gray: '808080', grey: '808080', silver: 'C0C0C0', orange: 'FFA500', crimson: 'DC143C' };
  const hex = (v) => {
    const s = String(v || '').trim().toLowerCase();
    let m = /^#([0-9a-f]{6})$/.exec(s);
    if (m) return m[1].toUpperCase();
    if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s))) return `${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase();
    if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s))) {
      if (m[4] != null && parseFloat(m[4]) === 0) return null;
      return [m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    return COLORS[s] || null;
  };
  const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  // Word's highlighter: its mso-highlight names (HTML's colour names), else the nearest of its colours to a background.
  const MSO = { yellow: 'yellow', lime: 'green', aqua: 'cyan', fuchsia: 'magenta', blue: 'blue', red: 'red', navy: 'darkBlue', teal: 'darkCyan', green: 'darkGreen', purple: 'darkMagenta',
    maroon: 'darkRed', olive: 'darkYellow', gray: 'darkGray', silver: 'lightGray', black: 'black' };
  const marker = (bg, mso) => {
    if (mso && MSO[String(mso).trim().toLowerCase()]) return MSO[String(mso).trim().toLowerCase()];
    const h = hex(String(bg || '').split(/\s+/).find((x) => hex(x)) || bg);
    if (!h) return null;
    const [r, g, b] = rgb(h);
    let best = null, d = 60;
    for (const [name, css] of Object.entries(S().HIGHLIGHT)) {
      if (name === 'white') continue;
      const [x, y, z] = rgb(css.slice(1)), dist = Math.hypot(r - x, g - y, b - z);
      if (dist < d) { d = dist; best = name; }
    }
    return best;
  };
  const len = (v) => { const s = String(v ?? '').trim().toLowerCase(); return s === '0' ? 0 : S().html.inches(s.replace(/^(-?)\./, '$10.').replace(/^(-?\d+\.\d+?)0+(pt|in)$/, '$1$2')); };
  const pt = (v) => { const i = len(v); return i == null ? null : Math.round(i * 72 * 100) / 100; };
  const r2 = (n) => Math.round(n * 100) / 100;
  const margins = (st) => {
    const out = {};
    const parts = String(st.margin || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length) { const [t, r = t, b = t, l = r] = parts; Object.assign(out, { top: t, right: r, bottom: b, left: l }); }
    for (const k of ['top', 'right', 'bottom', 'left']) if (st[`margin-${k}`] != null) out[k] = st[`margin-${k}`];
    return out;
  };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---- the computed run style, as a browser would cascade it for the properties a paper keeps
  const INHERIT = ['font-family', 'font-size', 'color', 'font-weight', 'font-style', 'font-variant', 'text-transform'];
  const UA = { b: { 'font-weight': '700' }, strong: { 'font-weight': '700' }, i: { 'font-style': 'italic' }, em: { 'font-style': 'italic' }, cite: { 'font-style': 'italic' }, var: { 'font-style': 'italic' }, dfn: { 'font-style': 'italic' },
    u: { 'text-decoration': 'underline' }, ins: { 'text-decoration': 'underline' }, s: { 'text-decoration': 'line-through' }, strike: { 'text-decoration': 'line-through' }, del: { 'text-decoration': 'line-through' },
    sup: { 'vertical-align': 'super' }, sub: { 'vertical-align': 'sub' }, mark: { 'background-color': 'yellow' } };
  const HEADING = /^h[1-6]$/;
  // An element's own text direction (dir, or Word's direction:rtl).
  const dirOf = (e, st) => { const d = String(e.a.dir || st.direction || '').trim().toLowerCase(); return d === 'ltr' || d === 'rtl' ? d : null; };
  const cascade = (e, up, ctx, block) => {
    const st = own(e, ctx), out = { deco: new Set(up.deco), vert: up.vert, bg: block ? null : up.bg, mso: block ? null : up.mso, link: up.link, dir: dirOf(e, st) || up.dir };
    for (const k of INHERIT) out[k] = up[k];
    const ua = UA[e.name] || (HEADING.test(e.name) ? { 'font-weight': 'bold' } : {});
    const decl = { ...ua, ...st };
    if (e.name === 'font') { if (e.a.face) decl['font-family'] = e.a.face; if (e.a.color) decl.color = e.a.color; }
    for (const k of INHERIT) if (decl[k] != null && decl[k] !== 'inherit') out[k] = decl[k];
    if (decl.font) { const m = /(\d*\.?\d+(?:pt|px))\s*(?:\/\S+)?\s+(.+)$/.exec(decl.font); if (m) { out['font-size'] = m[1]; out['font-family'] = m[2]; } }
    const deco = decl['text-decoration'] || decl['text-decoration-line'] || '';
    if (/underline/.test(deco)) out.deco.add('u');
    if (/line-through/.test(deco)) out.deco.add('s');
    if (decl['text-underline'] && decl['text-underline'] !== 'none') out.deco.add('u');
    if (!block && decl['vertical-align']) out.vert = /super/.test(decl['vertical-align']) ? 'sup' : /sub/.test(decl['vertical-align']) ? 'sub' : decl['vertical-align'] === 'baseline' ? null : out.vert;
    if (!block && (decl['background-color'] || decl.background)) out.bg = decl['background-color'] || decl.background;
    if (!block && decl['mso-highlight']) out.mso = decl['mso-highlight'];
    if (e.name === 'a' && e.a.href) out.link = true;
    return out;
  };
  const NEAR_BLACK = (h) => { const [r, g, b] = rgb(h); return Math.max(r, g, b) <= 0x50 && Math.max(r, g, b) - Math.min(r, g, b) <= 0x18; };
  // A text leaf's marks as Writer's HTML: tags for bold to subscript, one text_style span (font and size), colour,
  // highlight and caps as data attributes.
  const wrap = (text, c, ctx) => {
    const w = String(c['font-weight'] || '').toLowerCase(), bold = /^(bold|bolder)$/.test(w) || +w >= 600;
    const italic = /italic|oblique/.test(String(c['font-style'] || ''));
    const marks = [bold && 'strong', italic && 'em', !c.link && c.deco.has('u') && 'u', c.deco.has('s') && 's', c.vert].filter(Boolean);
    let open = marks.map((m) => `<${m}>`).join(''), close = marks.reverse().map((m) => `</${m}>`).join('');
    if (!ctx.match) {
      const extra = [];
      let font = S().html.fontOf(c['font-family']), size = S().html.sizeOf(String(c['font-size'] || '').toLowerCase().replace(/^(\d*\.?\d+)\.0+(pt|px)$/, '$1$2'));
      if (font && font === ctx.base?.font) font = null;
      if (size && size === ctx.base?.size) size = null;
      if (font || size) extra.push(['span', `style="${[font ? `font-family:${font}` : '', size ? `font-size:${size}pt` : ''].filter(Boolean).join(';')}"`]);
      const color = !c.link && hex(c.color);
      if (color && !['000000'].includes(color) && !(ctx.source === 'web' && NEAR_BLACK(color))) extra.push(['span', `data-gz-color="${color}"`]);
      const hl = marker(c.bg, c.mso);
      if (hl) extra.push(['span', `data-gz-highlight="${hl}"`]);
      if (/small-caps/.test(String(c['font-variant'] || ''))) extra.push(['span', 'data-gz-caps="small"']);
      else if (/uppercase/.test(String(c['text-transform'] || ''))) extra.push(['span', 'data-gz-caps="all"']);
      if (extra.length) ctx.rich = true;
      open += extra.map(([t, a]) => `<${t} ${a}>`).join('');
      close = extra.map(([t]) => `</${t}>`).join('') + close;
    }
    return `${open}${esc(text)}${close}`;
  };

  // ---- blocks
  const hasBlock = (e) => (e.kids || []).some((k) => k.name && (BLOCK.has(k.name) || hasBlock(k)));
  const isMarker = (e) => e.name === 'span' && /mso-list\s*:\s*ignore/i.test(e.a.style || '');
  const inline = (e, c, ctx) => {
    if (e.text != null) return e.text ? wrap(e.text, c, ctx) : '';
    if (isMarker(e)) return '';
    if (e.name === 'br') return '<br>';
    if (e.name === 'img') { const src = String(e.a.src || ''); return S().imageSrc(src) ? `<img src="${esc(src)}" alt="${esc(e.a.alt || '')}"${+e.a.width > 0 ? ` width="${Math.round(+e.a.width)}"` : ''}>` : wrap(e.a.alt || '', c, ctx); }
    const cc = cascade(e, c, ctx, false);
    // Word's empty-paragraph mark: <o:p>&nbsp;</o:p>.
    if (e.name === 'o:p') return e.kids.every((k) => k.text != null && /^[\s ]*$/.test(k.text)) ? '' : e.kids.map((k) => inline(k, cc, ctx)).join('');
    let inner = e.kids.map((k) => inline(k, cc, ctx)).join('');
    if ((cc.dir || 'ltr') !== (c.dir || 'ltr') && inner) inner = `<span dir="${cc.dir}">${inner}</span>`; // a run in another direction than the text around it
    return e.name === 'a' && e.a.href ? `<a href="${esc(e.a.href)}">${inner}</a>` : inner;
  };
  // A paragraph's settings from its own CSS, by source: Word's and Docs' spacing, indents, line rules and pagination; a
  // web page's alignment only. Right-to-left text keeps its direction, which isn't formatting Match the paper takes away.
  const paraOf = (e, ctx, list = false) => {
    const st = own(e, ctx), css = [], gz = {};
    // Heading emphasis is carried by its runs, including mixed emphasis. Suppress the format's heading defaults.
    if (HEADING.test(e.name) && !ctx.match) css.push('font-weight:normal', 'font-style:normal');
    // Left is the default for a paragraph, not for a heading the format centres.
    const align = String(st['text-align'] || e.a.align || '').toLowerCase();
    if (!ctx.match && (['center', 'right', 'justify'].includes(align) || (align === 'left' && HEADING.test(e.name)))) css.push(`text-align:${align}`);
    let brk = false;
    if (ctx.source !== 'web' && !ctx.match) {
      const m = margins(st), lh = String(st['line-height'] || '').trim().toLowerCase();
      if (!list) {
        const before = pt(m.top), after = pt(m.bottom), left = len(m.left), right = len(m.right), first = len(st['text-indent']);
        if (before != null) gz.before = Math.max(0, before);
        if (after != null) gz.after = Math.max(0, after);
        if (left) { if (left > 0 && left <= 4 && Math.abs(left / 0.5 - Math.round(left / 0.5)) < 0.002) css.push(`margin-left:${Math.round(left / 0.5) * 0.5}in`); else gz.left = r2(left); }
        if (right) gz.right = r2(right);
        if (first != null && Math.abs(first) < 22) css.push(`text-indent:${r2(first)}in`);
      }
      let m2;
      if (lh === 'normal') css.push('line-height:1');
      else if ((m2 = /^(\d*\.?\d+)%$/.exec(lh))) css.push(`line-height:${r2(+m2[1] / 100)}`);
      else if (/^\d*\.?\d+$/.test(lh)) css.push(`line-height:${r2(ctx.source === 'docs' ? +lh / 1.2 : +lh)}`);
      else if (pt(lh) != null) gz[/exactly/i.test(st['mso-line-height-rule'] || '') ? 'exact' : 'least'] = pt(lh);
      if (/avoid/.test(st['page-break-after'] || st['break-after'] || '')) gz.keepNext = true;
      if (/avoid/.test(st['page-break-inside'] || st['break-inside'] || '') || /lines-together/.test(st['mso-pagination'] || '')) gz.keepLines = true;
      if (/^(none|no-widow-orphan)/.test(String(st['mso-pagination'] || '').trim())) gz.widow = false;
      brk = /always|page/.test(st['page-break-before'] || st['break-before'] || '');
    }
    const data = S().dataGz({ before: gz.before, after: gz.after, exact: gz.exact, least: gz.least, left: gz.left, right: gz.right, keepNext: gz.keepNext, keepLines: gz.keepLines, widow: gz.widow });
    if (css.length || data) ctx.rich = true;
    return { attrs: `${dirOf(e, st) === 'rtl' ? ' dir="rtl"' : ''}${css.length ? ` style="${css.join(';')}"` : ''}${data ? ` data-gz="${esc(data)}"` : ''}`, brk };
  };
  // Word's list paragraphs: the list and level from mso-list; ordered when the marker is a number or letter, and then
  // the marker's number and style (a level's first marker decides between roman and letters).
  const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const roman = (s) => [...s].reduce((sum, ch, i) => sum + (ROMAN[ch] < (ROMAN[s[i + 1]] || 0) ? -ROMAN[ch] : ROMAN[ch]), 0);
  const counted = (v, known) => {
    const low = v.toLowerCase(), up = v !== low;
    if (/^\d+$/.test(v)) return { num: +v, style: 'decimal' };
    if (/^[ivxlcdm]+$/.test(low) && (known ? /roman/.test(known) : low.length > 1 || low === 'i')) return { num: roman(low), style: up ? 'upper-roman' : 'lower-roman' };
    return /^([a-z])\1*$/.test(low) ? { num: (low.length - 1) * 26 + low.charCodeAt(0) - 96, style: up ? 'upper-alpha' : 'lower-alpha' } : { num: null, style: null }; // a … z, aa … zz
  };
  const wordList = (e, ctx) => {
    const spec = own(e, { rules: new Map() })['mso-list'] || e.style['mso-list'] || '', m = /level(\d)/i.exec(spec);
    if (!m) return null;
    let mark = '';
    const walk = (x) => { for (const k of x.kids || []) { if (k.name && isMarker(k)) { const grab = (y) => (y.text != null ? y.text : (y.kids || []).map(grab).join('')); mark = grab(k); return true; } if (k.name && walk(k)) return true; } return false; };
    walk(e);
    const level = Math.min(8, Math.max(0, +m[1] - 1)), n = /^\s*\(?([0-9]+|[a-z]{1,3}|[ivxlc]+)[.)]/i.exec(mark.replace(/ /g, ' '));
    if (!n) return { level, ordered: false };
    const key = `${(/\b(l\d+)\b/i.exec(spec) || [])[1]}|${level}`, c = counted(n[1], ctx.lists.get(key));
    if (c.style) ctx.lists.set(key, ctx.lists.get(key) || c.style);
    return { level, ordered: true, num: c.num >= 1 && c.num <= 32767 ? c.num : null, style: c.style };
  };
  const ITEM_TAG = (ordered) => (ordered ? 'ol' : 'ul');
  // A numbered list's levels' styles as data-styles, the paper's defaults left out.
  const LEVELS = ['decimal', 'lower-alpha', 'lower-roman'];
  const stylesAttr = (styles) => {
    const all = Array.from(styles, (s, i) => s || LEVELS[i % 3]);
    while (all.length && all.at(-1) === LEVELS[(all.length - 1) % 3]) all.pop();
    return all.length ? ` data-styles="${all.join(',')}"` : '';
  };
  const blocks = (kids, c, ctx) => {
    let out = '', run = [], list = null;
    const endList = () => { if (list) { const tag = ITEM_TAG(list.ordered); out += `<${tag}${list.ordered ? stylesAttr(list.styles) : ''}>${list.html}</${tag}>`; list = null; } };
    const flush = () => {
      if (!run.length) return;
      const html = run.map((k) => inline(k, c, ctx)).join('');
      const onlyBreak = run.every((k) => k.name === 'br' || (k.text != null && !k.text.trim()));
      run = [];
      if (onlyBreak) { if (html.includes('<br>')) { endList(); out += '<p></p>'; } return; }
      if (!html.replace(/<[^>]*>/g, '').trim() && !/<img/.test(html)) return;
      endList();
      out += `<p>${html}</p>`;
    };
    // An item goes on in the open list when it is of its kind and, numbered, of its level's style. num, the number the
    // source shows (an <ol>'s first item, Word's marker), goes on the item as data-start where the paper's count differs.
    const item = (ordered, level, attrs, html, num = null, style = null) => {
      if (list && (list.ordered !== ordered || (style && list.styles[level] && list.styles[level] !== style))) endList();
      if (!list) list = { ordered, styles: [], count: [], html: '' };
      let start = '';
      if (ordered) {
        if (style && !list.styles[level]) list.styles[level] = style;
        const next = (list.count[level] || 0) + 1, n = num ?? next;
        if (n !== next) start = ` data-start="${n}"`;
        list.count[level] = n;
        list.count.length = level + 1;
      }
      list.html += `<li${level ? ` class="ql-indent-${level}"` : ''}${start}${attrs}>${html}</li>`;
    };
    // An HTML list's items, flat: each item's level its aria-level (Docs) or its depth; an <ol> numbered from its start.
    const htmlList = (e, depth, cc) => {
      const ordered = e.name === 'ol';
      let num = ordered ? (/^\d{1,5}$/.test(e.a?.start || '') && +e.a.start >= 1 && +e.a.start <= 32767 ? +e.a.start : 1) : null;
      const put = (level, attrs, html) => { item(ordered, level, attrs, html, num); num = null; };
      for (const k of e.kids) {
        if (!k.name) continue;
        if (k.name === 'ul' || k.name === 'ol') { htmlList(k, depth + 1, cascade(k, cc, ctx, true)); continue; }
        if (k.name !== 'li') continue;
        const lc = cascade(k, cc, ctx, true), level = Math.min(8, /^\d+$/.test(k.a['aria-level'] || '') ? +k.a['aria-level'] - 1 : depth);
        const parts = [];
        let runs = [];
        const push = () => { if (runs.length) { parts.push({ html: runs.map((x) => inline(x, lc, ctx)).join(''), e: k }); runs = []; } };
        for (const x of k.kids) {
          if (x.name === 'ul' || x.name === 'ol') { push(); for (const p of parts.splice(0)) put(level, paraOf(p.e, ctx, true).attrs, p.html); htmlList(x, level + 1, lc); continue; }
          if (x.name && (BLOCK.has(x.name) || hasBlock(x))) { push(); parts.push({ html: x.kids ? x.kids.map((y) => inline(y, cascade(x, lc, ctx, true), ctx)).join('') : '', e: x }); continue; }
          runs.push(x);
        }
        push();
        for (const p of parts) if (p.html.replace(/<[^>]*>/g, '').trim() || /<img|<br>/.test(p.html)) put(level, paraOf(p.e === k ? k : p.e, ctx, true).attrs, p.html);
      }
    };
    for (const k of kids) {
      if (k.text != null || (k.name && !BLOCK.has(k.name) && !hasBlock(k))) { run.push(k); continue; }
      flush();
      const name = k.name;
      if (name === 'p' || HEADING.test(name) || name === 'figcaption' || name === 'dt' || name === 'caption') {
        if (hasBlock(k)) { endList(); out += blocks(k.kids, cascade(k, c, ctx, true), ctx); continue; }
        const cc = cascade(k, c, ctx, true), wl = ctx.source === 'word' && name === 'p' ? wordList(k, ctx) : null;
        const html = k.kids.map((x) => inline(x, cc, ctx)).join('');
        if (wl) { item(wl.ordered, wl.level, paraOf(k, ctx, true).attrs, html, wl.num, wl.style); continue; }
        endList();
        const tag = HEADING.test(name) ? name : 'p', { attrs, brk } = paraOf(k, ctx);
        if (brk) out += '<hr class="gz-page-break">';
        out += `<${tag}${attrs}>${html}</${tag}>`;
      } else if (name === 'ul' || name === 'ol') { htmlList(k, 0, cascade(k, c, ctx, true)); }
      else if (name === 'li') { htmlList({ name: 'ul', kids: [k] }, 0, c); }
      else if (name === 'table') {
        endList();
        const rows = [];
        const walk = (x) => { for (const y of x.kids || []) { if (y.name === 'tr') rows.push(y); else if (['thead', 'tbody', 'tfoot'].includes(y.name)) walk(y); } };
        walk(k);
        const tc = cascade(k, c, ctx, true);
        out += `<table>${rows.map((r) => `<tr>${r.kids.filter((x) => x.name === 'td' || x.name === 'th').map((x) => {
          const span = (key) => (/^\d{1,3}$/.test(x.a[key] || '') && +x.a[key] > 1 ? ` ${key}="${+x.a[key]}"` : '');
          return `<${x.name}${span('colspan')}${span('rowspan')}>${blocks(x.kids, cascade(x, tc, ctx, true), ctx) || '<p></p>'}</${x.name}>`;
        }).join('')}</tr>`).join('')}</table>`;
      } else if (name === 'blockquote') { endList(); out += `<blockquote>${blocks(k.kids, cascade(k, c, ctx, true), ctx)}</blockquote>`; }
      else if (name === 'pre') { endList(); const grab = (y) => (y.text != null ? y.text : y.name === 'br' ? '\n' : (y.kids || []).map(grab).join('')); out += `<pre>${esc(grab(k))}</pre>`; }
      else if (name === 'hr') { endList(); if (ctx.source === 'web') out += '<hr class="gz-rule">'; }
      else { // containers: div, section, the Docs wrapper, an inline element holding blocks
        const cc = cascade(k, c, ctx, !!BLOCK.has(name));
        if (name === 'div' && !hasBlock(k)) { const { attrs } = paraOf(k, ctx); const html = k.kids.map((x) => inline(x, cc, ctx)).join(''); if (html.replace(/<[^>]*>/g, '').trim()) { endList(); out += `<p${attrs}>${html}</p>`; } continue; }
        endList();
        out += blocks(k.kids, cc, ctx);
      }
    }
    flush();
    endList();
    return out;
  };

  // HTML off the clipboard → { html (Writer's paper vocabulary), source ('word' | 'docs' | 'web' | 'writer'), rich (it
  // carried formatting Match the paper would take away) }. o: { match (only the writer's own marks and the structure),
  // base { font, size } (the paper's: runs in them are left unmarked) }.
  const normalize = (html, o = {}) => {
    html = String(html ?? '');
    if (html.length > S().MAX_INPUT) limit();
    if (/data-pm-slice/.test(html)) return { html, source: 'writer', rich: false };
    const source = /docs-internal-guid-/.test(html) ? 'docs' : /urn:schemas-microsoft-com:office:word|content=Word\.Document|class="?Mso|mso-[a-z-]+\s*:/i.test(html) ? 'word' : 'web';
    const { root, css } = tree(html);
    const ctx = { source, match: !!o.match, base: o.base || null, rules: source === 'word' ? rules(css) : new Map(), lists: new Map(), rich: false };
    const start = { deco: new Set(), vert: null, bg: null, mso: null, link: false };
    const out = blocks(root.kids, start, ctx);
    return { html: out, source, rich: ctx.rich && !ctx.match };
  };

  // ---- over a pasted range of a document (a Transform), for "Match the paper" and the paper's own values
  const RUN = ['text_style', 'color', 'highlight', 'small_caps', 'all_caps'];
  const PARA = ['line', 'first', 'before', 'after', 'exact', 'least', 'left', 'right', 'tabs', 'keepNext', 'keepLines', 'widow', 'align'];
  const textblocks = (doc, from, to) => { const out = []; doc.nodesBetween(from, to, (n, pos, parent) => { if (n.isTextblock) { out.push({ n, pos, parent }); return false; } return true; }); return out; };
  // Every run mark but the writer's own (bold to subscript, links) and every paragraph setting away.
  const strip = (tr, from, to) => {
    const marks = tr.doc.type.schema.marks;
    for (const k of RUN) if (marks[k]) tr.removeMark(from, to, marks[k]);
    for (const { n, pos } of textblocks(tr.doc, from, to)) {
      const a = { ...n.attrs };
      for (const k of PARA) if (k in a) a[k] = null;
      if ('indent' in a && n.type.name !== 'list_item') a.indent = 0;
      tr.setNodeMarkup(pos, null, a);
    }
    return tr;
  };
  // What equals the paper's own (L: its look) left unmarked: runs in its font and size, paragraphs' spacing and indents
  // where the format gives the same.
  const tidy = (tr, from, to, L) => {
    const t = tr.doc.type.schema.marks.text_style, runs = [];
    tr.doc.nodesBetween(from, to, (n, pos) => {
      const m = n.isText && t?.isInSet(n.marks);
      if (m && (m.attrs.font === L.font || m.attrs.size === L.size)) runs.push([Math.max(from, pos), Math.min(to, pos + n.nodeSize), m]);
      return true;
    });
    for (const [a, b, m] of runs) {
      const font = m.attrs.font === L.font ? null : m.attrs.font, size = m.attrs.size === L.size ? null : m.attrs.size;
      tr.removeMark(a, b, t);
      if (font || size) tr.addMark(a, b, t.create({ font, size }));
    }
    for (const { n, pos, parent } of textblocks(tr.doc, from, to)) {
      if (!('before' in n.attrs)) continue;
      const where = { quote: parent.type.name === 'blockquote', heading: n.type.name === 'heading' ? n.attrs.level : 0 }, b = ST().paraBase(L, where, n.attrs.align || undefined);
      const a = { ...n.attrs }, eq = (x, y) => x != null && Math.abs(x - y) < 0.005;
      if (eq(a.line, b.line)) a.line = null;
      if (eq(a.after, b.after)) a.after = null;
      if (eq(a.before, 0)) a.before = null;
      if (eq(a.first, b.first)) a.first = null;
      if (eq(a.left, 0)) a.left = null;
      if (eq(a.right, 0)) a.right = null;
      if (Object.keys(a).some((k) => a[k] !== n.attrs[k])) tr.setNodeMarkup(pos, null, a);
    }
    return tr;
  };

  const api = { normalize, strip, tidy, before: null };
  const F = globalThis.GZ_WRITER_FRAME;
  if (!F || typeof document === 'undefined') return api;

  // ---- the frame
  const t = (k, v) => F.t(k, v);
  const PM = globalThis.GZ_PM;
  const paper = () => (F.mode() === 'paper' ? globalThis.GZ_WRITER_PAPER?.current?.() || null : null);
  let ask = true, pending = null;
  // Settings → Writer (lib/writer-settings.js): writer.pasteAsk.
  globalThis.GZ_WRITER_SETTINGS?.follow((w) => { ask = w?.pasteAsk !== false; });
  // lib/writer-editor.js's transformPastedHTML: the clipboard's HTML in Writer's vocabulary.
  api.before = (html, schema) => {
    pending = null;
    try {
      const p = schema === S().paper ? paper() : null, doc = p?.editor.view.state.doc, L = p?.look();
      const r = normalize(html, { match: doc?.attrs.paste === 'match', base: L ? { font: L.font, size: L.size } : null });
      if (p && r.rich) pending = r;
      return r.html;
    } catch (e) { if (e.code === 'WRITER_INPUT_LIMIT') throw e; console.error(e); return html; }
  };
  // The range a paste changed, mapped to the document after it.
  const changed = (tr) => {
    let from = Infinity, to = -Infinity;
    tr.mapping.maps.forEach((map, i) => map.forEach((_a, _b, start, end) => {
      const rest = tr.mapping.slice(i + 1);
      from = Math.min(from, rest.map(start, -1)); to = Math.max(to, rest.map(end, 1));
    }));
    return from <= to ? { from, to } : null;
  };
  const key = new PM.state.PluginKey('gz-paste');
  const plugin = () => new PM.state.Plugin({
    key,
    state: {
      init: () => null,
      apply: (tr, range) => { const m = tr.getMeta(key); if (m !== undefined) return m; return range && tr.docChanged ? { from: tr.mapping.map(range.from, -1), to: tr.mapping.map(range.to, 1) } : range; },
    },
    appendTransaction: (trs, _old, state) => {
      const p = paper(), tr0 = trs.find((x) => x.getMeta('paste') || x.getMeta('uiEvent') === 'paste');
      if (!p || !tr0 || !state.schema.nodes.page_break) return null;
      const range = changed(tr0);
      if (!range) return null;
      const tr = state.tr;
      tidy(tr, range.from, Math.min(range.to, tr.doc.content.size), p.look(state.doc));
      const rich = pending;
      pending = null;
      if (rich && ask && state.doc.attrs.paste == null) { tr.setMeta(key, range); setTimeout(() => offer(), 0); }
      return tr.docChanged || tr.getMeta(key) ? tr : null;
    },
  });
  const settle = (v, answer, run) => {
    const range = key.getState(v.state), tr = v.state.tr;
    if (run && range) run(tr, range.from, Math.min(range.to, tr.doc.content.size));
    tr.setDocAttribute('paste', answer).setMeta(key, null);
    if (!run) tr.setMeta('addToHistory', false);
    v.dispatch(tr);
  };
  const offer = () => {
    const p = paper(), v = p?.editor.view;
    if (!p?.ask || !v) return;
    p.ask(t('Pasted with its formatting'), [
      { label: t('Keep formatting'), run: () => settle(v, 'keep') },
      { label: t('Match the paper'), run: () => { settle(v, 'match', strip); v.focus(); } },
    ], () => { if (v.state.doc.attrs.paste == null) settle(v, 'keep'); });
  };
  F.plugin(plugin());
  return api;
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_PASTE;
