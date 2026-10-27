// Glaze Writer's documents: the compose and paper schemas, HTML in and out, Quill ops out, and the text that proofing and
// AI anchor issues to. compose holds only what Ultra's Quill 1.x keeps, and serialize writes the HTML Quill renders back
// unchanged (checked against quill@1.3.7). paper holds a whole paper. Lists are flat, as in Quill and Word: each item
// carries its indent level. parse never touches a live document: the HTML is rebuilt from an allowlist into a small
// tree of its own, then read by ProseMirror's DOMParser through the same parseDOM rules the view uses.
// Classic script after lib/pm.js; module.exports for node.
var GZ_WRITER_SCHEMA = globalThis.GZ_WRITER_SCHEMA || (() => {
  const PM = typeof GZ_PM !== 'undefined' ? GZ_PM
    : require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, 'pm.js'), 'utf8'), { filename: 'lib/pm.js' });
  const { Schema, DOMParser } = PM.model;

  const MAX_INDENT = 8, ALIGNS = ['center', 'right', 'justify'];
  const MAX_INPUT = 2000000, MAX_TOKENS = 50000, MAX_DEPTH = 64;
  const limit = () => { throw Object.assign(new RangeError('writer-schema: input exceeds safe limits'), { code: 'WRITER_INPUT_LIMIT' }); };
  const FONTS = ['Times New Roman', 'Arial', 'Calibri', 'Courier New'];
  const SAME_METRICS = { tinos: 'Times New Roman', arimo: 'Arial', carlito: 'Calibri', cousine: 'Courier New' };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  // ---- reading attributes, from a live element (the view) or this file's own tree (parse)
  const css = (dom, prop) => String((dom.style && dom.style.getPropertyValue(prop)) || '').trim().toLowerCase();
  const classes = (dom) => String(dom.getAttribute('class') || '').split(/\s+/);
  const indentOf = (dom) => { for (const c of classes(dom)) { const m = /^ql-indent-([1-8])$/.exec(c); if (m) return +m[1]; } return 0; };
  const alignOf = (dom) => {
    for (const c of classes(dom)) { const m = /^ql-align-(center|right|justify)$/.exec(c); if (m) return m[1]; }
    const a = css(dom, 'text-align') || String(dom.getAttribute('align') || '').toLowerCase();
    return ALIGNS.includes(a) ? a : null;
  };
  // A CSS length in inches (Word pastes .5in, 36pt, 48px, 1.27cm).
  const inches = (v) => {
    const m = /^(-?\d*\.?\d+)(in|pt|px|cm|mm|em)$/.exec(v || '');
    return m ? +m[1] / { in: 1, pt: 72, px: 96, cm: 2.54, mm: 25.4, em: 6 }[m[2]] : null;
  };
  const lineOf = (dom) => {
    const v = css(dom, 'line-height'), m = /^(\d*\.?\d+)(%?)$/.exec(v);
    const n = m ? (m[2] ? +m[1] / 100 : +m[1]) : NaN;
    return n >= 0.5 && n <= 4 ? Math.round(n * 100) / 100 : null;
  };
  const firstOf = (dom) => { const n = inches(css(dom, 'text-indent')); return n ? Math.round(clamp(n, -2, 2) * 100) / 100 : null; };
  const fontOf = (v) => {
    for (const f of String(v || '').split(',')) {
      const name = f.replace(/["']/g, '').trim().toLowerCase();
      const hit = FONTS.find((x) => x.toLowerCase() === name) || SAME_METRICS[name];
      if (hit) return hit;
    }
    return null;
  };
  const sizeOf = (v) => {
    const m = /^(\d*\.?\d+)(pt|px)$/.exec(v || '');
    const pt = m ? (m[2] === 'px' ? +m[1] * 0.75 : +m[1]) : NaN;
    return pt >= 6 && pt <= 96 ? Math.round(pt * 2) / 2 : null;
  };
  // Links Quill keeps (http, https, mailto, tel; it turns the rest into about:blank). loose also takes "example.com".
  const href = (raw, loose) => {
    const v = String(raw ?? '').trim();
    if (v.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(v.replace(/^tel:[\d\s()+.-]+$/i, ''))) return null;
    if (/^(https?:\/\/[^/?#]+|mailto:[^@]+@|tel:\+?\d)/i.test(v)) return v;
    return loose && /^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(v) ? `https://${v}` : null;
  };
  const imageSrc = (raw) => {
    const v = String(raw ?? '').trim();
    return /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(v) || /^https:\/\/[^\s"<>]+$/i.test(v) ? v : null;
  };

  // ---- schemas
  const blockAttrs = (paper) => paper
    ? { align: { default: null }, indent: { default: 0 }, line: { default: null }, first: { default: null } }
    : { align: { default: null }, indent: { default: 0 } };
  const readBlock = (paper) => (dom) => {
    const a = { align: alignOf(dom), indent: indentOf(dom) };
    if (!paper) return a;
    const left = inches(css(dom, 'margin-left'));
    return { ...a, indent: a.indent || (left > 0 ? clamp(Math.round(left / 0.5), 0, MAX_INDENT) : 0), line: lineOf(dom), first: firstOf(dom) };
  };
  // Indent and alignment as Quill's classes (so Quill's list counters and indents apply); paper's spacing inline.
  const blockDOM = (a) => {
    const cls = [a.indent ? `ql-indent-${a.indent}` : '', a.align ? `ql-align-${a.align}` : ''].filter(Boolean).join(' ');
    const style = [a.line != null ? `line-height:${a.line}` : '', a.first != null ? `text-indent:${a.first}in` : ''].filter(Boolean).join(';');
    return { class: cls || null, style: style || null };
  };

  const make = (paper) => {
    const levels = paper ? [1, 2, 3, 4] : [3, 4]; // Ultra starts headings at h3
    const attrs = blockAttrs(paper), read = readBlock(paper);
    const nodes = {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*', attrs, parseDOM: [{ tag: 'p', getAttrs: read }], toDOM: (n) => ['p', blockDOM(n.attrs), 0] },
      heading: {
        group: 'block', content: 'inline*', defining: true, levels, attrs: { level: { default: levels[0] }, ...attrs },
        parseDOM: [1, 2, 3, 4, 5, 6].map((n) => ({ tag: `h${n}`, getAttrs: (dom) => ({ level: clamp(n, levels[0], levels.at(-1)), ...read(dom) }) })),
        toDOM: (n) => [`h${n.attrs.level}`, blockDOM(n.attrs), 0],
      },
      code_block: {
        group: 'block', content: 'text*', marks: '', code: true, defining: true,
        parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }], toDOM: () => ['pre', { class: 'ql-syntax', spellcheck: 'false' }, 0],
      },
      bullet_list: { group: 'block', content: 'list_item+', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
      ordered_list: { group: 'block', content: 'list_item+', parseDOM: [{ tag: 'ol' }], toDOM: () => ['ol', 0] },
      list_item: { content: 'inline*', defining: true, attrs, parseDOM: [{ tag: 'li', getAttrs: read }], toDOM: (n) => ['li', blockDOM(n.attrs), 0] },
      text: { group: 'inline' },
    };
    if (paper) {
      Object.assign(nodes, {
        blockquote: { group: 'block', content: 'block+', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
        page_break: { group: 'block', atom: true, parseDOM: [{ tag: 'hr.gz-page-break' }], toDOM: () => ['hr', { class: 'gz-page-break' }] },
        hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
        // The note's text (inline HTML, marks only) lives on the node; the frame numbers the notes.
        footnote_ref: {
          inline: true, group: 'inline', atom: true, attrs: { content: { default: '' } },
          parseDOM: [{ tag: 'sup.gz-footnote', priority: 60, getAttrs: (dom) => ({ content: inline(dom.getAttribute('data-footnote')) }) }],
          toDOM: (n) => ['sup', { class: 'gz-footnote', 'data-footnote': n.attrs.content }],
        },
        image: {
          inline: true, group: 'inline', draggable: true, attrs: { src: {}, alt: { default: '' }, width: { default: null } },
          parseDOM: [{ tag: 'img[src]', getAttrs: (dom) => {
            const src = imageSrc(dom.getAttribute('src')), width = Math.round(+dom.getAttribute('width'));
            return src ? { src, alt: String(dom.getAttribute('alt') || '').slice(0, 1000), width: width > 0 && width <= 2000 ? width : null } : false;
          } }],
          toDOM: (n) => ['img', { src: n.attrs.src, alt: n.attrs.alt, width: n.attrs.width }],
        },
        ...PM.tables.tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} }),
      });
    }
    // Outermost first, the order Quill nests them: link, script, bold, italic, strike, underline.
    const marks = {
      link: {
        attrs: { href: {} }, inclusive: false,
        parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => { const h = href(dom.getAttribute('href')); return h ? { href: h } : false; } }],
        toDOM: (m) => ['a', { href: m.attrs.href, rel: 'noopener noreferrer', target: '_blank' }, 0],
      },
      sup: { excludes: 'sup sub', parseDOM: [{ tag: 'sup' }, { style: 'vertical-align=super' }], toDOM: () => ['sup', 0] },
      sub: { excludes: 'sup sub', parseDOM: [{ tag: 'sub' }, { style: 'vertical-align=sub' }], toDOM: () => ['sub', 0] },
      bold: {
        parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: (dom) => !/^(normal|[1-4]00)$/.test(css(dom, 'font-weight')) && null },
          { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[6-9]00)$/.test(v) && null }],
        toDOM: () => ['strong', 0],
      },
      italic: { parseDOM: [{ tag: 'em' }, { tag: 'i', getAttrs: (dom) => css(dom, 'font-style') !== 'normal' && null }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
      strike: { parseDOM: [{ tag: 's' }, { tag: 'strike' }, { tag: 'del' }, { style: 'text-decoration', getAttrs: (v) => /line-through/.test(v) && null }], toDOM: () => ['s', 0] },
      underline: { parseDOM: [{ tag: 'u' }, { tag: 'ins' }, { style: 'text-decoration', getAttrs: (v) => /underline/.test(v) && null }], toDOM: () => ['u', 0] },
    };
    if (paper) {
      marks.text_style = {
        attrs: { font: { default: null }, size: { default: null } },
        parseDOM: [{ tag: 'span', getAttrs: (dom) => { const font = fontOf(css(dom, 'font-family')), size = sizeOf(css(dom, 'font-size')); return font || size ? { font, size } : false; } }],
        toDOM: (m) => ['span', { style: [m.attrs.font ? `font-family:${m.attrs.font}` : '', m.attrs.size ? `font-size:${m.attrs.size}pt` : ''].filter(Boolean).join(';') }, 0],
      };
    }
    return new Schema({ nodes, marks });
  };

  // ---- HTML in: tokens → an allowlisted tree → normalised to what the schemas hold → ProseMirror
  const NAMED = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', shy: '\u00ad',
    zwj: '\u200d', zwnj: '\u200c', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c',
    rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb', bull: '\u2022', middot: '\u00b7', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
    deg: '\u00b0', times: '\u00d7', divide: '\u00f7', euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', sect: '\u00a7', para: '\u00b6',
  };
  const decode = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(?:#(x[0-9a-f]{1,6}|\d{1,7});?|([a-z][a-z0-9]{1,31});)/gi, (whole, num, name) => {
    if (name) return NAMED[name] ?? whole;
    const cp = num[0] === 'x' || num[0] === 'X' ? parseInt(num.slice(1), 16) : parseInt(num, 10);
    return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : '\ufffd';
  })).replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '');

  // Tags once, without a backtracking tag regex: a quoted > is data, an unfinished tag is text (Rimeward's scanner).
  function* tags(input) {
    const head = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)(?=[\s/>]|$)/y;
    let cursor = 0;
    while (cursor < input.length) {
      const start = input.indexOf('<', cursor);
      if (start < 0) return;
      if (input.startsWith('<!--', start)) {
        const close = input.indexOf('-->', start + 4);
        cursor = close < 0 ? input.length : close + 3;
        yield { start, end: cursor, name: '' };
        continue;
      }
      head.lastIndex = start;
      const name = head.exec(input)?.[1];
      if (!name) {
        if ('!?/'.includes(input[start + 1] ?? '\0')) {
          const close = input.indexOf('>', start + 2);
          cursor = close < 0 ? input.length : close + 1;
          yield { start, end: cursor, name: '' };
        } else cursor = start + 1;
        continue;
      }
      let end = head.lastIndex, quote = '';
      for (; end < input.length; end++) {
        const c = input[end];
        if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
      }
      if (end === input.length) return;
      cursor = end + 1;
      yield { start, end: cursor, name: name.toLowerCase(), raw: input.slice(head.lastIndex, end), closing: input[start + 1] === '/' };
    }
  }
  const attrsOf = (raw) => {
    const out = {};
    for (const m of (raw || '').matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const k = m[1].toLowerCase();
      if (!(k in out)) out[k] = decode(m[2] ?? m[3] ?? m[4] ?? '');
    }
    return out;
  };

  // The small tree ProseMirror's DOMParser reads: what it uses of Element and Text, nothing more.
  const DOC = { createTextNode: (t) => txt(t) };
  const SELECTOR = /^([a-z0-9]+)((?:\.[\w-]+|\[[\w-]+\])*)$/;
  const proto = {
    get firstChild() { return this.childNodes[0] || null; },
    get nextSibling() { return this.parentNode?.childNodes[this.index + 1] || null; },
    get previousSibling() { return this.parentNode?.childNodes[this.index - 1] || null; },
    getAttribute(k) { return this.attrs?.[k] ?? null; },
    hasAttribute(k) { return this.attrs?.[k] != null; },
    matches(sel) {
      const m = SELECTOR.exec(sel);
      if (!m) throw new Error(`writer-schema: unsupported selector ${sel}`);
      if (m[1].toUpperCase() !== this.nodeName) return false;
      return (m[2].match(/\.[\w-]+|\[[\w-]+\]/g) || []).every((p) => (p[0] === '.' ? classes(this).includes(p.slice(1)) : this.hasAttribute(p.slice(1, -1))));
    },
    appendChild(c) { c.parentNode?.childNodes.splice(c.index, 1); c.parentNode?.relink(); this.childNodes.push(c); this.relink(); return c; },
    relink() { this.childNodes.forEach((c, i) => { c.parentNode = this; c.index = i; }); },
  };
  const ownStyle = (map) => ({ length: Object.keys(map).length, getPropertyValue: (p) => map[p] || '' });
  const el = (name, attrs = {}, kids = []) => {
    const e = Object.create(proto);
    const map = {};
    for (const rule of String(attrs.style || '').split(';')) {
      const at = rule.indexOf(':'), k = rule.slice(0, at).trim().toLowerCase(), v = rule.slice(at + 1).replace(/!important/i, '').replace(/["']/g, '').trim().toLowerCase();
      if (at > 0 && STYLES.has(k) && /^[\w\s.,%#()+-]{1,120}$/.test(v)) map[k] = v;
    }
    return Object.assign(e, { nodeType: 1, nodeName: name.toUpperCase(), tagName: name.toUpperCase(), attrs, childNodes: kids, style: ownStyle(map), ownerDocument: DOC });
  };
  const txt = (t) => Object.assign(Object.create(proto), { nodeType: 3, nodeName: '#text', nodeValue: t, ownerDocument: DOC });
  const STYLES = new Set(['text-align', 'font-weight', 'font-style', 'text-decoration', 'vertical-align', 'font-family', 'font-size', 'line-height', 'margin-left', 'text-indent']);

  const INLINE = new Set(['a', 'span', 'strong', 'b', 'em', 'i', 'u', 'ins', 's', 'strike', 'del', 'sup', 'sub', 'br', 'img']);
  const ALIAS = { font: 'span', mark: 'span', code: 'span', small: 'span', big: 'span', abbr: 'span', cite: 'span', q: 'span', dfn: 'span', kbd: 'span',
    samp: 'span', var: 'span', time: 'span', label: 'span', bdi: 'span', bdo: 'span', tt: 'span' };
  const BLOCKISH = new Set(['div', 'address', 'article', 'aside', 'center', 'dd', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header',
    'hgroup', 'main', 'nav', 'section', 'details', 'summary', 'legend', 'caption']);
  const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr']);
  const VOID = new Set(['br', 'hr', 'img', 'wbr', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track']);
  // Dropped with everything inside them. What a post holds that compose can't keep is reported by loses().
  const DROP = { script: '', style: '', template: '', noscript: '', title: '', head: '', textarea: '', select: '', button: '', xmp: '', noembed: '', noframes: '',
    iframe: 'media', object: 'media', embed: 'media', video: 'media', audio: 'media', canvas: 'media', picture: 'media', map: 'media', svg: 'media', math: 'math' };
  const CLASS = /^(ql-indent-[1-8]|ql-align-(center|right|justify)|ql-syntax|gz-page-break|gz-footnote)$/;
  const KEEP = { a: ['href'], img: ['src', 'alt', 'width'], ol: ['data-list'], ul: ['data-list'], li: ['data-list'], sup: ['data-footnote'],
    td: ['colspan', 'rowspan', 'data-colwidth'], th: ['colspan', 'rowspan', 'data-colwidth'], p: ['align'], div: ['align'] };

  const tree = (html, o) => {
    const root = el('body'), stack = [{ e: root, src: 'body' }];
    let skip = null, depth = 0, at = 0, tokens = 0;
    const top = () => stack.at(-1).e;
    const add = (n) => { top().childNodes.push(n); };
    const closeTo = (i) => { stack.length = i; };
    const find = (names, stop) => { for (let i = stack.length - 1; i > 0; i--) { if (names.includes(stack[i].src)) return i; if (stop?.includes(stack[i].e.nodeName)) return -1; } return -1; };
    const text = (s) => { if (s && !skip) add(txt(decode(s))); };
    for (const t of tags(html)) {
      if (++tokens > MAX_TOKENS) limit();
      text(html.slice(at, t.start));
      at = t.end;
      const name = t.name;
      if (skip) { if (name === skip) depth += t.closing ? -1 : VOID.has(name) ? 0 : 1; if (depth === 0) skip = null; continue; }
      if (!name) continue;
      const a = attrsOf(t.raw);
      // Inspect source blots before dropping or unwrapping unknown tags, including empty embeds.
      const blot = `${name} ${a.class || ''}`;
      if (/attachment|formula|latex|lti|embedded-?app|gz-footnote/i.test(blot) || a['data-bbtype'] || a['data-bbfile']) o.lost.add('attachment');
      if (/\b(?:ql-)?math\b/i.test(blot)) o.lost.add('math');
      if (/inlineimage|video-studio|\b(?:ql-)?(?:image|video|audio)\b/i.test(blot) && !(o.paper && name === 'img')) o.lost.add('media');
      if (!o.paper && /\b(?:ql-)?table-(?:cell|head|row|body|container)\b/i.test(blot)) o.lost.add('table');
      if (!o.paper && (/color|background|font-family|font-size|line-height|text-indent|margin-left|direction/i.test(a.style || '')
        || /ql-(font|size|color|bg|customcolor|lineheight|direction|customClass)/i.test(a.class || '')
        || /\bql-indent-(?![1-8]\b)\d+\b/.test(a.class || '') || a.dir?.toLowerCase() === 'rtl' || name === 'font'
        || (name === 'a' && a.href != null && !href(a.href)))) o.lost.add('format');
      if (name in DROP || (name === 'span' && /mso-list\s*:\s*ignore/i.test(a.style || ''))) {
        if (DROP[name]) o.lost.add(DROP[name]);
        if (!t.closing && !VOID.has(name) && !/\/\s*$/.test(t.raw)) { skip = name; depth = 1; }
        continue;
      }
      const kind = ALIAS[name] || (BLOCKISH.has(name) ? 'div' : name);
      if (!INLINE.has(kind) && !BLOCK.has(kind) && kind !== 'div') continue;
      if (t.closing) {
        const i = find([name]);
        if (i > 0) closeTo(i);
        continue;
      }
      if (!o.paper && (kind === 'img' || kind === 'table')) o.lost.add(kind === 'img' ? 'media' : 'table');
      // The implied closes a browser makes: a block ends an open paragraph or heading; an item ends the item before it.
      if (BLOCK.has(kind) || kind === 'div') { const i = find(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'], ['LI', 'TD', 'TH', 'BLOCKQUOTE', 'DIV']); if (i > 0) closeTo(i); }
      if (kind === 'li') { const i = find(['li'], ['UL', 'OL']); if (i > 0) closeTo(i); }
      if (kind === 'td' || kind === 'th') { const i = find(['td', 'th'], ['TR', 'TABLE']); if (i > 0) closeTo(i); }
      if (kind === 'tr') { const i = find(['tr'], ['TABLE']); if (i > 0) closeTo(i); }
      const keep = {};
      for (const k of KEEP[kind] || []) if (a[k] != null) keep[k] = a[k];
      const cls = String(a.class || '').split(/\s+/).filter((c) => CLASS.test(c)).join(' ');
      if (cls) keep.class = cls;
      if (a.style) keep.style = a.style;
      if (kind === 'a' && !href(keep.href)) delete keep.href;
      if (kind === 'img' && !(o.paper && imageSrc(keep.src))) continue;
      const e = el(kind, keep);
      add(e);
      if (!VOID.has(kind)) { if (stack.length >= MAX_DEPTH) limit(); stack.push({ e, src: name }); }
    }
    text(html.slice(at));
    return root;
  };

  const isInline = (n) => n.nodeType === 3 || INLINE.has(n.nodeName.toLowerCase());
  const hasBlock = (n) => n.nodeType === 1 && n.childNodes.some((c) => !isInline(c) || hasBlock(c));
  const meaningful = (n) => (n.nodeType === 3 ? /[^ \t\n\r\f]/.test(n.nodeValue) : n.nodeName === 'BR' || n.nodeName === 'IMG' || n.childNodes.some(meaningful));
  const blockClass = (e, indent, align) => { e.attrs = { ...e.attrs, class: [indent ? `ql-indent-${indent}` : '', align ? `ql-align-${align}` : ''].filter(Boolean).join(' ') }; return e; };
  const shallow = (e) => el(e.nodeName.toLowerCase(), { ...e.attrs });

  // Inline content as leaves, each with the inline elements around it, rebuilt into a block (marks as DOMSerializer nests them).
  const leaves = (e, chain = [], out = []) => {
    for (const c of e.childNodes) {
      if (c.nodeType === 3 || !c.childNodes.length) out.push({ n: c, chain });
      else leaves(c, [...chain, c], out);
    }
    return out;
  };
  const rebuild = (shell, items) => {
    const open = [];
    for (const { n, chain } of items) {
      let k = 0;
      while (k < open.length && k < chain.length && open[k][0] === chain[k]) k++;
      open.length = k;
      for (let j = k; j < chain.length; j++) { const c = shallow(chain[j]); (open.at(-1)?.[1] || shell).childNodes.push(c); open.push([chain[j], c]); }
      (open.at(-1)?.[1] || shell).childNodes.push(n.nodeType === 3 ? txt(n.nodeValue) : n);
    }
    return shell;
  };
  // Whitespace as Quill's clipboard reads it: a run inside one text node collapses to its no-break spaces (or one
  // space), and a text node that is the block's own first or last child loses its plain edge spaces. Then no-break
  // spaces become plain ones; serialize writes back as no-break the spaces Quill would collapse, so text holds only plain.
  const keepNbsp = (collapse) => (run) => { const nb = run.replace(/[^\u00a0]/g, ''); return !nb && collapse ? ' ' : nb; };
  const spaces = (items) => {
    items.forEach((it, i) => {
      if (it.n.nodeType !== 3) return;
      let v = it.n.nodeValue.replace(/\r?\n/g, ' ').replace(/\s\s+/g, keepNbsp(true));
      if (!it.chain.length && i === 0) v = v.replace(/^\s+/, keepNbsp(false));
      if (!it.chain.length && i === items.length - 1) v = v.replace(/\s+$/, keepNbsp(false));
      it.n = txt(v.replace(/\u00a0/g, ' '));
    });
    return items.filter((it) => it.n.nodeType !== 3 || it.n.nodeValue);
  };
  // A textblock as the schema keeps it. Quill has no line break inside a block, so in compose a <br> starts a new block
  // with the same attributes, and a trailing one makes none; paper drops only the rendering placeholder at the end.
  const textblock = (e, o) => {
    let items = leaves(e).filter((it) => it.n.nodeType === 3 || ['BR', 'IMG', 'SUP'].includes(it.n.nodeName));
    if (o.paper) {
      if (items.at(-1)?.n.nodeName === 'BR') items.pop();
      return [rebuild(shallow(e), spaces(items))];
    }
    const segs = [[]];
    for (const it of items) { if (it.n.nodeName === 'BR') segs.push([]); else segs.at(-1).push(it); }
    if (segs.length > 1 && !segs.at(-1).length) segs.pop();
    return segs.map((s) => rebuild(shallow(e), spaces(s)));
  };
  const pre = (e) => {
    let s = '';
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) s += c.nodeValue; else if (c.nodeName === 'BR') s += '\n'; else walk(c); } };
    walk(e);
    s = s.replace(/\r\n?/g, '\n').replace(/\n$/, '').replace(/\u00a0/g, ' ');
    return el('pre', {}, s ? [txt(s)] : []);
  };
  // Lists flattened the way Quill reads nested ones: each item's level is its depth plus its own ql-indent.
  const LIST_KIND = { bullet: false, checked: false, unchecked: false, ordered: true };
  const items = (list, o, depth, out) => {
    const ordered = list.nodeName === 'OL';
    for (const c of list.childNodes) {
      if (c.nodeName === 'UL' || c.nodeName === 'OL') { items(c, o, depth + 1, out); continue; }
      if (c.nodeName !== 'LI') { if (meaningful(c)) for (const b of blocks(el('div', {}, [c]), o)) take(b, ordered, depth, out, o); continue; }
      const kind = LIST_KIND[c.getAttribute('data-list')] ?? ordered, level = clamp(depth + indentOf(c), 0, MAX_INDENT), align = alignOf(c);
      const start = out.length;
      let run = [];
      const flush = () => { if (run.some(meaningful)) for (const seg of textblock(el('li', {}, run), o)) out.push({ ordered: kind, li: blockClass(seg, level, align) }); run = []; };
      for (const n of c.childNodes) {
        if (isInline(n) && !hasBlock(n)) { run.push(n); continue; }
        flush();
        if (n.nodeName === 'UL' || n.nodeName === 'OL') items(n, o, level + 1, out);
        else for (const b of blocks(el('div', {}, [n]), o)) take(b, kind, level, out, o);
      }
      flush();
      if (out.length === start) out.push({ ordered: kind, li: blockClass(el('li'), level, align) });
    }
    return out;
  };
  const take = (b, ordered, level, out, o) => {
    if (b.nodeName === 'UL' || b.nodeName === 'OL') {
      for (const li of b.childNodes) out.push({ ordered: b.nodeName === 'OL', li: blockClass(li, clamp(indentOf(li) + level + 1, 0, MAX_INDENT), alignOf(li)) });
    } else if (b.nodeName === 'PRE' || b.nodeName === 'HR' || b.nodeName === 'TABLE' || b.nodeName === 'BLOCKQUOTE') {
      for (const x of textblock(el('li', {}, b.nodeName === 'PRE' ? b.childNodes : []), o)) if (meaningful(x)) out.push({ ordered, li: blockClass(x, level, null) });
    } else out.push({ ordered, li: blockClass(el('li', {}, b.childNodes), level, alignOf(b)) });
  };
  const table = (t, o) => {
    const rows = [];
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeName === 'TR') rows.push(c); else if (['THEAD', 'TBODY', 'TFOOT'].includes(c.nodeName)) walk(c); } };
    walk(t);
    let width = 0;
    for (const r of rows) {
      let cols = 0;
      for (const c of r.childNodes.filter((n) => n.nodeName === 'TD' || n.nodeName === 'TH')) {
        const span = (key, max) => {
          const v = c.getAttribute(key);
          if (v == null) return 1;
          if (!/^\d{1,4}$/.test(v) || +v < 1 || +v > max) limit();
          return +v;
        };
        const col = span('colspan', 100), row = span('rowspan', 1000);
        cols += col;
        o.cells += col * row;
        if (o.cells > 10000) limit();
        const widths = c.getAttribute('data-colwidth');
        if (widths && (!/^\d{1,4}(,\d{1,4})*$/.test(widths) || widths.split(',').length !== col)) delete c.attrs['data-colwidth'];
      }
      width = Math.max(width, cols);
    }
    if (width * rows.length > 10000) limit();
    const out = rows.map((r) => el('tr', {}, r.childNodes.filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH').map((c) => {
      const inner = blocks(c, o);
      return el(c.nodeName.toLowerCase(), { ...c.attrs }, inner.length ? inner : [el('p')]);
    }))).filter((r) => r.childNodes.length);
    return out.length ? [el('table', {}, out)] : [];
  };
  // A container's children as the blocks a schema holds: textblocks of inline content, flat lists, pre, and in paper
  // blockquotes, tables and page breaks. Adjacent lists of one kind merge, as Quill merges them.
  const blocks = (parent, o) => {
    const out = [];
    let run = [];
    const flush = () => { if (run.some(meaningful)) out.push(...textblock(el('p', {}, run), o)); run = []; };
    for (const n of parent.childNodes) {
      if (isInline(n) && !hasBlock(n)) { run.push(n); continue; }
      flush();
      const name = n.nodeName;
      if (isInline(n) || name === 'DIV' || ['THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH'].includes(name)) {
        if (name === 'DIV' && !hasBlock(n) && n.childNodes.some(meaningful)) out.push(...textblock(el('p', { ...n.attrs }, n.childNodes), o));
        else out.push(...blocks(n, o));
      } else if (/^H[1-6]$/.test(name) || name === 'P') {
        if (hasBlock(n)) out.push(...blocks(n, o)); else out.push(...textblock(n, o));
      } else if (name === 'UL' || name === 'OL' || name === 'LI') {
        for (const it of items(name === 'LI' ? el('ul', {}, [n]) : n, o, 0, [])) {
          const kind = it.ordered ? 'OL' : 'UL';
          if (out.at(-1)?.nodeName !== kind) out.push(el(kind.toLowerCase()));
          out.at(-1).childNodes.push(it.li);
        }
      } else if (name === 'PRE') out.push(pre(n));
      else if (name === 'BLOCKQUOTE') {
        const inner = blocks(n, o);
        if (o.paper) { if (inner.length) out.push(el('blockquote', {}, inner)); } else {
          for (const b of inner) {
            if (b.nodeName === 'PRE') out.push(b);
            else if (b.nodeName === 'UL' || b.nodeName === 'OL') { b.childNodes.forEach((li) => blockClass(li, clamp(indentOf(li) + 1, 0, MAX_INDENT), alignOf(li))); out.push(b); }
            else out.push(blockClass(b, clamp(indentOf(b) + 1, 0, MAX_INDENT), alignOf(b)));
          }
        }
      } else if (name === 'TABLE') out.push(...(o.paper ? table(n, o) : blocks(n, o)));
      else if (name === 'HR') { if (o.paper && classes(n).includes('gz-page-break')) out.push(n); }
    }
    flush();
    for (let i = out.length - 1; i > 0; i--) {
      if ((out[i].nodeName === 'UL' || out[i].nodeName === 'OL') && out[i].nodeName === out[i - 1].nodeName) out[i - 1].childNodes.push(...out.splice(i, 1)[0].childNodes);
    }
    return out;
  };
  const link = (e) => { e.childNodes.forEach((c, i) => { c.parentNode = e; c.index = i; if (c.nodeType === 1) link(c); }); return e; };
  const prepare = (schema, html) => {
    html = String(html ?? '');
    if (html.length > MAX_INPUT) limit();
    const o = { paper: !!schema.nodes.page_break, lost: new Set(), cells: 0 };
    const root = link(el('body', {}, blocks(tree(html, o), o)));
    return { root, o };
  };
  const parsers = new WeakMap();
  const parser = (schema) => { if (!parsers.has(schema)) parsers.set(schema, DOMParser.fromSchema(schema)); return parsers.get(schema); };

  // HTML → doc. doc (a Document) is accepted for the shared signature and not needed: nothing here reaches a live page.
  const parse = (schema, html) => parser(schema).parse(prepare(schema, html).root, { preserveWhitespace: true });
  // HTML → an open Slice, for paste and drop (the view's clipboardParser).
  const slice = (schema, html) => parser(schema).parseSlice(prepare(schema, html).root, { preserveWhitespace: true });
  // 'limit' refuses takeover too, before parsing an input that would exhaust the editor.
  const loses = (schema, html) => {
    try { return [...prepare(schema, html).o.lost].sort(); }
    catch (e) { if (e.code === 'WRITER_INPUT_LIMIT') return ['limit']; throw e; }
  };

  // ---- HTML out: a string renderer over the schema's own toDOM, so attribute order and escaping are exact
  const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
  const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
  const spec = (s, hole) => {
    if (typeof s === 'string') return escText(s);
    const [tag, ...rest] = s;
    let i = 0, attrs = '', inner = '';
    if (rest[0] && typeof rest[0] === 'object' && !Array.isArray(rest[0])) { for (const [k, v] of Object.entries(rest[0])) if (v != null && v !== '') attrs += ` ${k}="${escAttr(String(v))}"`; i = 1; }
    if (VOID.has(tag)) return `<${tag}${attrs}>`;
    for (; i < rest.length; i++) inner += rest[i] === 0 ? hole() : spec(rest[i], hole);
    return `<${tag}${attrs}>${inner}</${tag}>`;
  };
  const wrap = (mark) => spec(mark.type.spec.toDOM(mark, true), () => '\u0000').split('\u0000');
  // Each text node's spaces that Quill's clipboard would collapse or trim, as no-break spaces, which it keeps: a run of
  // two or more, and the plain edges of the block's own first and last child. Lengths don't change, so offsets hold.
  const nbsp = (run) => '\u00a0'.repeat(run.length);
  const shown = (block) => block.content.content.map((c, i, all) => {
    if (!c.isText) return null;
    let v = c.text.replace(/[ \u00a0]{2,}/g, nbsp);
    if (!c.marks.length && i === 0) v = v.replace(/^[ \u00a0]+/, nbsp);
    if (!c.marks.length && i === all.length - 1) v = v.replace(/[ \u00a0]+$/, nbsp);
    return v;
  });
  const inlineHTML = (block) => {
    const texts = shown(block), active = [];
    let out = '';
    block.forEach((c, _, i) => {
      let k = 0;
      while (k < active.length && k < c.marks.length && c.marks[k].eq(active[k][0])) k++;
      while (active.length > k) out += active.pop()[1];
      for (let j = k; j < c.marks.length; j++) { const [open, close] = wrap(c.marks[j]); out += open; active.push([c.marks[j], close]); }
      out += c.isText ? escText(texts[i]) : spec(c.type.spec.toDOM(c), () => '');
    });
    while (active.length) out += active.pop()[1];
    return out;
  };
  const block = (n) => {
    if (n.type.spec.code) return n.textContent || n.type.schema.nodes.page_break ? spec(n.type.spec.toDOM(n), () => escText(`${n.textContent}\n`)) : '<p><br></p>';
    if (n.isTextblock) return spec(n.type.spec.toDOM(n), () => (inlineHTML(n) || '<br>') + (n.lastChild?.type.name === 'hard_break' ? '<br>' : ''));
    if (n.isLeaf) return spec(n.type.spec.toDOM(n), () => '');
    let inner = '';
    n.forEach((c) => { inner += block(c); });
    return spec(n.type.spec.toDOM(n), () => inner);
  };
  // doc (or any block node) → HTML. Compose output is the HTML Quill 1.x renders back unchanged; an empty code block is
  // written as the empty line Quill makes of it.
  const serialize = (schema, node) => {
    if (node.type !== node.type.schema.topNodeType) return block(node);
    let out = '', code = '', codeNode = null;
    const flush = () => { if (codeNode) out += spec(codeNode.type.spec.toDOM(codeNode), () => escText(code)); code = ''; codeNode = null; };
    node.forEach((c) => {
      if (!schema.nodes.page_break && c.type.spec.code && c.textContent) { codeNode = c; code += `${c.textContent}\n`; }
      else { flush(); out += block(c); }
    });
    flush();
    return out;
  };
  // Inline HTML (marks only), as a footnote keeps it.
  let inlineDepth = 0;
  const inline = (html) => {
    if (inlineDepth >= 16) limit();
    inlineDepth++;
    try {
    const doc = parse(paperSchema, `<p>${String(html ?? '').slice(0, 20000)}</p>`), parts = [];
    doc.descendants((n) => { if (!n.isTextblock) return true; parts.push(inlineHTML(n.type.create(null, n.content.content.filter((c) => c.isText)))); return false; });
      return parts.filter(Boolean).join(' ');
    } finally { inlineDepth--; }
  };

  // A compose doc as Quill 1.x ops (setContents takes them as they are; no clipboard heuristics in between).
  const delta = (doc) => {
    const ops = [];
    const same = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
    const push = (insert, attributes) => {
      const last = ops.at(-1);
      if (last && same(last.attributes, attributes)) last.insert += insert;
      else ops.push(attributes ? { insert, attributes } : { insert });
    };
    const line = (n, list) => {
      const a = {};
      if (n.type.name === 'heading') a.header = n.attrs.level;
      if (list) a.list = list;
      if (n.attrs.indent) a.indent = n.attrs.indent;
      if (n.attrs.align) a.align = n.attrs.align;
      return Object.keys(a).length ? a : null;
    };
    const ATTR = { bold: () => ({ bold: true }), italic: () => ({ italic: true }), underline: () => ({ underline: true }), strike: () => ({ strike: true }),
      sup: () => ({ script: 'super' }), sub: () => ({ script: 'sub' }), link: (m) => ({ link: m.attrs.href }) };
    const textblock = (n, list) => {
      if (n.type.spec.code) {
        if (!n.textContent) return push('\n');
        for (const l of n.textContent.split('\n')) { if (l) push(l); push('\n', { 'code-block': true }); }
        return;
      }
      const texts = shown(n);
      n.forEach((c, _, i) => {
        if (!c.isText) return;
        const a = Object.assign({}, ...c.marks.map((m) => ATTR[m.type.name]?.(m) || {}));
        push(texts[i], Object.keys(a).length ? a : null);
      });
      push('\n', line(n, list));
    };
    doc.forEach((n) => {
      if (n.type.name === 'bullet_list' || n.type.name === 'ordered_list') n.forEach((li) => textblock(li, n.type.name === 'bullet_list' ? 'bullet' : 'ordered'));
      else if (n.isTextblock) textblock(n, null);
    });
    return ops;
  };

  // The doc's text, textblocks joined by '\n' (a hard break is '\n' too; an image or note mark is no text), with UTF-16
  // offsets ↔ doc positions. runs: { start, end, pos }, each a stretch where offset and position advance together.
  const text = (doc) => {
    let out = '';
    const runs = [];
    doc.descendants((n, pos) => {
      if (!n.isTextblock) return true;
      if (runs.length) out += '\n';
      let run = { start: out.length, end: out.length, pos: pos + 1 };
      runs.push(run);
      n.forEach((c, off) => {
        if (c.isText || c.type.name === 'hard_break') { out += c.isText ? c.text : '\n'; run.end = out.length; return; }
        run = { start: out.length, end: out.length, pos: pos + 1 + off + c.nodeSize };
        runs.push(run);
      });
      return false;
    });
    const last = (key, v) => { let lo = 0, hi = runs.length - 1, hit = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (runs[mid][key] <= v) { hit = mid; lo = mid + 1; } else hi = mid - 1; } return hit; };
    const posAt = (i) => {
      if (!runs.length) return 0;
      const r = runs[Math.max(0, last('start', clamp(i, 0, out.length)))];
      return r.pos + clamp(i - r.start, 0, r.end - r.start);
    };
    const offsetAt = (pos) => {
      const k = last('pos', pos);
      if (k < 0) return 0;
      const r = runs[k];
      return r.start + clamp(pos - r.pos, 0, r.end - r.start);
    };
    return { text: out, runs, posAt, offsetAt };
  };

  const compose = make(false), paperSchema = make(true);
  return { compose, paper: paperSchema, parse, slice, serialize, delta, text, loses, href, inline, MAX_INDENT, MAX_INPUT, FONTS };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_SCHEMA; else GZ_WRITER_SCHEMA;
