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

  const MAX_INDENT = 8, ALIGNS = ['left', 'center', 'right', 'justify'];
  const MAX_INPUT = 2000000, MAX_DOCUMENT_INPUT = 16 * 1024 * 1024, MAX_IMAGE_BYTES = 10e6, MAX_TOKENS = 50000, MAX_DEPTH = 64;
  const limit = () => { throw Object.assign(new RangeError('writer-schema: input exceeds safe limits'), { code: 'WRITER_INPUT_LIMIT' }); };
  const FONTS = ['Times New Roman', 'Arial', 'Calibri', 'Courier New'];
  const SAME_METRICS = { tinos: 'Times New Roman', arimo: 'Arial', carlito: 'Calibri', cousine: 'Courier New' };
  // An imported file's well-known fonts (lib/writer-styles.js LOCAL), kept by name with their bundled twin behind them.
  const LOCAL = { aptos: ['Aptos', 'Calibri'], 'aptos display': ['Aptos Display', 'Calibri'], 'calibri light': ['Calibri Light', 'Calibri'], cambria: ['Cambria', 'Times New Roman'],
    georgia: ['Georgia', 'Times New Roman'], 'century gothic': ['Century Gothic', 'Arial'], 'book antiqua': ['Book Antiqua', 'Times New Roman'] };
  const familyCSS = (font) => { const l = LOCAL[font.toLowerCase()]; return l ? `"${l[0]}", "${l[1]}"` : font; };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  // ---- reading attributes, from a live element (the view) or this file's own tree (parse)
  const css = (dom, prop) => String((dom.style && dom.style.getPropertyValue(prop)) || '').trim().toLowerCase();
  const classes = (dom) => String(dom.getAttribute('class') || '').split(/\s+/);
  const indentOf = (dom) => { for (const c of classes(dom)) { const m = /^ql-indent-([1-8])$/.exec(c); if (m) return +m[1]; } return 0; };
  const alignOf = (dom) => {
    for (const c of classes(dom)) { const m = /^ql-align-(left|center|right|justify)$/.exec(c); if (m) return m[1]; }
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
  const firstOf = (dom) => { const n = inches(css(dom, 'text-indent')); return n != null ? Math.round(clamp(n, -2, 2) * 100) / 100 : null; };
  // loose: the well-known fonts too (a paper's own HTML); without, the four and their twins (what a paste may set).
  const fontOf = (v, loose = false) => {
    for (const f of String(v || '').split(',')) {
      const name = f.replace(/["']/g, '').trim().toLowerCase();
      const hit = FONTS.find((x) => x.toLowerCase() === name) || SAME_METRICS[name] || (loose && LOCAL[name]?.[0]);
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
    return /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(v) ? v : null;
  };

  // ---- schemas
  // A paper's paragraph keeps what Word sets on one (an imported file's, or the format's when null): space before and
  // after (pt), exactly or at-least line heights (pt), exact left and right indents (in, where the half-inch steps of
  // indent can't say it), its own tab stops ([position in, 'l' | 'c' | 'r' | 'd', leader]), keep with next, keep lines
  // together, and widow control off. They travel as one data-gz attribute, so only Writer's own HTML carries them.
  const PAPER_ATTRS = ['before', 'after', 'exact', 'least', 'left', 'right', 'tabs', 'keepNext', 'keepLines', 'widow'];
  const LEADERS = ['dot', 'hyphen', 'underscore', 'middleDot', 'heavy'];
  const blockAttrs = (paper) => paper
    ? { align: { default: null }, indent: { default: 0 }, line: { default: null }, first: { default: null }, ...Object.fromEntries(PAPER_ATTRS.map((k) => [k, { default: null }])) }
    : { align: { default: null }, indent: { default: 0 } };
  const num2 = (v, lo, hi) => { const n = +v; return v !== '' && Number.isFinite(n) ? Math.round(clamp(n, lo, hi) * 100) / 100 : null; };
  // "before:12;after:8;exact:18;left:0.6;right:1;tabs:1l 3.25c 6.49r:dot;keep:next lines;widow:0" → attrs.
  const readGz = (raw) => {
    const out = {};
    for (const part of String(raw || '').slice(0, 2000).split(';')) {
      const at = part.indexOf(':'), k = part.slice(0, at).trim(), v = part.slice(at + 1).trim();
      if (['before', 'after'].includes(k)) out[k] = num2(v, 0, 1584);
      else if (['exact', 'least'].includes(k)) out[k] = num2(v, 0.5, 1584);
      else if (['left', 'right'].includes(k)) out[k] = num2(v, -22, 22);
      else if (k === 'tabs') {
        const stops = [];
        for (const t of v.split(/\s+/).slice(0, 64)) {
          const m = /^(\d*\.?\d+)([lcrd])(?::(\w+))?$/.exec(t);
          if (m && +m[1] <= 22) stops.push(m[3] && LEADERS.includes(m[3]) ? [num2(m[1], 0, 22), m[2], m[3]] : [num2(m[1], 0, 22), m[2]]);
        }
        out.tabs = stops.length ? stops.sort((a, b) => a[0] - b[0]) : null;
      } else if (k === 'keep') { const w = v.split(/\s+/); if (w.includes('next')) out.keepNext = true; if (w.includes('lines')) out.keepLines = true; }
      else if (k === 'widow' && v === '0') out.widow = false;
    }
    return out;
  };
  const writeGz = (a) => [
    ...['before', 'after', 'exact', 'least', 'left', 'right'].filter((k) => a[k] != null).map((k) => `${k}:${a[k]}`),
    a.tabs?.length ? `tabs:${a.tabs.map(([pos, kind, leader]) => `${pos}${kind}${leader ? `:${leader}` : ''}`).join(' ')}` : '',
    a.keepNext || a.keepLines ? `keep:${[a.keepNext ? 'next' : '', a.keepLines ? 'lines' : ''].filter(Boolean).join(' ')}` : '',
    a.widow === false ? 'widow:0' : '',
  ].filter(Boolean).join(';');
  const readBlock = (paper) => (dom) => {
    const a = { align: alignOf(dom), indent: indentOf(dom) };
    if (!paper) return { ...a, align: a.align === 'left' ? null : a.align };
    const left = inches(css(dom, 'margin-left'));
    return { ...a, indent: a.indent || (left > 0 ? clamp(Math.round(left / 0.5), 0, MAX_INDENT) : 0), line: lineOf(dom), first: firstOf(dom), ...readGz(dom.getAttribute('data-gz')) };
  };
  // Indent and alignment as Quill's classes (so Quill's list counters and indents apply); paper's spacing inline.
  const blockDOM = (a) => {
    const cls = [a.indent ? `ql-indent-${a.indent}` : '', a.align ? `ql-align-${a.align}` : ''].filter(Boolean).join(' ');
    const style = [a.line != null ? `line-height:${a.line}` : '', a.first != null ? `text-indent:${a.first}in` : '',
      a.before != null ? `margin-top:${a.before}pt` : '', a.after != null ? `margin-bottom:${a.after}pt` : '',
      a.left != null ? `padding-left:${a.left}in` : '', a.right != null ? `padding-right:${a.right}in` : '',
      ['normal', 'bold'].includes(a.weight) ? `font-weight:${a.weight}` : '', ['normal', 'italic'].includes(a.slant) ? `font-style:${a.slant}` : ''].filter(Boolean).join(';');
    const gz = a.before !== undefined ? writeGz(a) : '';
    return { class: cls || null, style: style || null, ...(gz ? { 'data-gz': gz } : {}) };
  };
  // Word's highlighter colours.
  const HIGHLIGHT = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000',
    darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff' };

  // A paper list's numbering (or bullet) style for each level, as data-styles="upper-roman,lower-alpha"; a numbered list
  // can continue the one before it (data-continue) and an item can restart its level at a number (data-start). The styles
  // reach the page's markers as custom properties (writer-objects.css draws them).
  const NUMBERS = ['decimal', 'lower-alpha', 'lower-roman', 'upper-alpha', 'upper-roman'], BULLETS = ['disc', 'circle', 'square', 'dash'];
  const BULLET_MARK = { disc: '\u2022', circle: '\u25e6', square: '\u25aa', dash: '\u2013' };
  const stylesOf = (v, allowed) => {
    const out = [];
    for (const s of String(v || '').split(',').slice(0, MAX_INDENT + 1)) { if (!allowed.includes(s.trim())) break; out.push(s.trim()); }
    return out.length ? out.join(',') : null;
  };
  const startOf = (v) => (/^\d{1,5}$/.test(String(v ?? '')) && +v >= 1 && +v <= 32767 ? +v : null);
  const listNode = (tag, allowed, ordered) => ({
    group: 'block', content: 'list_item+',
    attrs: ordered ? { styles: { default: null }, continue: { default: false } } : { styles: { default: null } },
    parseDOM: [{ tag, getAttrs: (dom) => ({ styles: stylesOf(dom.getAttribute('data-styles'), allowed), ...(ordered ? { continue: dom.getAttribute('data-continue') === 'true' } : {}) }) }],
    toDOM: (n) => {
      const styles = n.attrs.styles ? n.attrs.styles.split(',') : [];
      const vars = styles.map((s, i) => (ordered ? `--gzs${i}:${s}` : `--gzb${i}:"${BULLET_MARK[s]}"`)).join(';');
      return [tag, { 'data-styles': n.attrs.styles, 'data-continue': n.attrs.continue ? 'true' : null, style: vars || null }, 0];
    },
  });
  const itemDOM = (a) => {
    const d = blockDOM(a);
    if (a.start == null) return d;
    const lv = a.indent || 0, deeper = Array.from({ length: MAX_INDENT - lv }, (_, i) => ` gzl${lv + 1 + i} 0`).join('');
    return { ...d, 'data-start': String(a.start), style: [d.style, `counter-set:gzl${lv} ${a.start}${deeper}`].filter(Boolean).join(';') };
  };
  // prosemirror-tables' nodes, with a table's borders (on unless data-borders="none").
  const tables = (spec) => ({
    ...spec,
    table: { ...spec.table, attrs: { borders: { default: true } }, parseDOM: [{ tag: 'table', getAttrs: (dom) => ({ borders: dom.getAttribute('data-borders') !== 'none' }) }],
      toDOM: (n) => ['table', { 'data-borders': n.attrs.borders ? null : 'none' }, ['tbody', 0]] },
  });
  const make = (paper) => {
    const levels = paper ? [1, 2, 3, 4] : [3, 4]; // Ultra starts headings at h3
    const attrs = blockAttrs(paper), read = readBlock(paper);
    const nodes = {
      doc: paper ? { content: 'block+', attrs: { setup: { default: null }, paste: { default: null } } } : { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*', attrs, parseDOM: [{ tag: 'p', getAttrs: read }], toDOM: (n) => ['p', blockDOM(n.attrs), 0] },
      heading: {
        group: 'block', content: 'inline*', defining: true, levels, attrs: { level: { default: levels[0] }, ...attrs, ...(paper ? { weight: { default: null }, slant: { default: null } } : {}) },
        parseDOM: [1, 2, 3, 4, 5, 6].map((n) => ({ tag: `h${n}`, getAttrs: (dom) => ({ level: clamp(n, levels[0], levels.at(-1)), ...read(dom), ...(paper ? { weight: ['normal', '400'].includes(css(dom, 'font-weight')) ? 'normal' : ['bold', '700'].includes(css(dom, 'font-weight')) ? 'bold' : null, slant: ['normal', 'italic'].includes(css(dom, 'font-style')) ? css(dom, 'font-style') : null } : {}) }) })),
        toDOM: (n) => [`h${n.attrs.level}`, blockDOM(n.attrs), 0],
      },
      code_block: {
        group: 'block', content: 'text*', marks: '', code: true, defining: true,
        parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }], toDOM: () => ['pre', { class: 'ql-syntax', spellcheck: 'false' }, 0],
      },
      bullet_list: paper ? listNode('ul', BULLETS, false) : { group: 'block', content: 'list_item+', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
      ordered_list: paper ? listNode('ol', NUMBERS, true) : { group: 'block', content: 'list_item+', parseDOM: [{ tag: 'ol' }], toDOM: () => ['ol', 0] },
      list_item: paper
        ? { content: 'inline*', defining: true, attrs: { ...attrs, start: { default: null } }, parseDOM: [{ tag: 'li', getAttrs: (dom) => ({ ...read(dom), start: startOf(dom.getAttribute('data-start')) }) }], toDOM: (n) => ['li', itemDOM(n.attrs), 0] }
        : { content: 'inline*', defining: true, attrs, parseDOM: [{ tag: 'li', getAttrs: read }], toDOM: (n) => ['li', blockDOM(n.attrs), 0] },
      text: { group: 'inline' },
    };
    if (paper) {
      Object.assign(nodes, {
        blockquote: { group: 'block', content: 'block+', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
        page_break: { group: 'block', atom: true, parseDOM: [{ tag: 'hr.gz-page-break' }], toDOM: () => ['hr', { class: 'gz-page-break' }] },
        horizontal_rule: { group: 'block', atom: true, parseDOM: [{ tag: 'hr.gz-rule' }], toDOM: () => ['hr', { class: 'gz-rule' }] },
        hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
        // The note's text (inline HTML, marks only) lives on the node; the frame numbers the notes.
        footnote_ref: {
          inline: true, group: 'inline', atom: true, attrs: { content: { default: '' } },
          parseDOM: [{ tag: 'sup.gz-footnote', priority: 60, getAttrs: (dom) => ({ content: inline(dom.getAttribute('data-footnote')) }) }],
          toDOM: (n) => ['sup', { class: 'gz-footnote', 'data-footnote': n.attrs.content }],
        },
        image: {
          inline: true, group: 'inline', draggable: true,
          attrs: { src: {}, alt: { default: '' }, width: { default: null }, display: { default: 'inline' }, align: { default: null }, caption: { default: '' } },
          parseDOM: [{ tag: 'img[src]', getAttrs: (dom) => {
            const src = imageSrc(dom.getAttribute('src')), width = Math.round(+dom.getAttribute('width'));
            const display = dom.getAttribute('data-display') === 'block' ? 'block' : 'inline', align = dom.getAttribute('data-align');
            return src ? { src, alt: String(dom.getAttribute('alt') || '').slice(0, 1000), width: width > 0 && width <= 2000 ? width : null,
              display, align: ['left', 'center', 'right'].includes(align) ? align : null, caption: String(dom.getAttribute('data-caption') || '').replace(/\s+/g, ' ').trim().slice(0, 500) } : false;
          } }],
          // A picture set as a block, its alignment and its caption go as data attributes; the frame draws them.
          toDOM: (n) => ['img', { src: n.attrs.src, alt: n.attrs.alt, width: n.attrs.width, 'data-display': n.attrs.display === 'block' ? 'block' : null, 'data-align': n.attrs.align, 'data-caption': n.attrs.caption || null }],
        },
        ...tables(PM.tables.tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {
          valign: { default: null, getFromDOM: (dom) => (['middle', 'bottom'].includes(dom.getAttribute('data-valign')) ? dom.getAttribute('data-valign') : null), setDOMAttr: (v, a) => { if (v) a['data-valign'] = v; } },
        } })),
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
        parseDOM: [{ tag: 'span', getAttrs: (dom) => { const font = fontOf(css(dom, 'font-family'), true), size = sizeOf(css(dom, 'font-size')); return font || size ? { font, size } : false; } }],
        toDOM: (m) => ['span', { style: [m.attrs.font ? `font-family:${familyCSS(m.attrs.font)}` : '', m.attrs.size ? `font-size:${m.attrs.size}pt` : ''].filter(Boolean).join(';') }, 0],
      };
      // A run's colour (hex, no #) and Word's highlighter, from an imported file (data attributes: pasted pages keep none).
      marks.color = {
        attrs: { color: {} },
        parseDOM: [{ tag: 'span[data-gz-color]', getAttrs: (dom) => { const c = String(dom.getAttribute('data-gz-color')); return /^[0-9a-f]{6}$/i.test(c) ? { color: c.toUpperCase() } : false; } }],
        toDOM: (m) => ['span', { 'data-gz-color': m.attrs.color, style: `color:#${m.attrs.color}` }, 0],
      };
      marks.highlight = {
        attrs: { color: {} },
        parseDOM: [{ tag: 'span[data-gz-highlight]', getAttrs: (dom) => { const c = String(dom.getAttribute('data-gz-highlight')); return HIGHLIGHT[c] ? { color: c } : false; } }],
        toDOM: (m) => ['span', { 'data-gz-highlight': m.attrs.color, style: `background-color:${HIGHLIGHT[m.attrs.color] || 'transparent'}` }, 0],
      };
      // Small caps and all caps (Word's w:smallCaps and w:caps): the letters as typed, drawn in capitals.
      marks.small_caps = { excludes: 'small_caps all_caps', parseDOM: [{ tag: 'span[data-gz-caps]', getAttrs: (dom) => dom.getAttribute('data-gz-caps') === 'small' && null }], toDOM: () => ['span', { 'data-gz-caps': 'small', style: 'font-variant:small-caps' }, 0] };
      marks.all_caps = { excludes: 'small_caps all_caps', parseDOM: [{ tag: 'span[data-gz-caps]', getAttrs: (dom) => dom.getAttribute('data-gz-caps') === 'all' && null }], toDOM: () => ['span', { 'data-gz-caps': 'all', style: 'text-transform:uppercase' }, 0] };
    }
    return new Schema({ nodes, marks });
  };

  // ---- HTML in: tokens → an allowlisted tree → normalised to what the schemas hold → ProseMirror
  // HTML named character references, including the legacy forms without a semicolon.
  const NAMED = {
    "AElig": "\u00c6",
    "AElig;": "\u00c6",
    "AMP": "&",
    "AMP;": "&",
    "Aacute": "\u00c1",
    "Aacute;": "\u00c1",
    "Abreve;": "\u0102",
    "Acirc": "\u00c2",
    "Acirc;": "\u00c2",
    "Acy;": "\u0410",
    "Afr;": "\ud835\udd04",
    "Agrave": "\u00c0",
    "Agrave;": "\u00c0",
    "Alpha;": "\u0391",
    "Amacr;": "\u0100",
    "And;": "\u2a53",
    "Aogon;": "\u0104",
    "Aopf;": "\ud835\udd38",
    "ApplyFunction;": "\u2061",
    "Aring": "\u00c5",
    "Aring;": "\u00c5",
    "Ascr;": "\ud835\udc9c",
    "Assign;": "\u2254",
    "Atilde": "\u00c3",
    "Atilde;": "\u00c3",
    "Auml": "\u00c4",
    "Auml;": "\u00c4",
    "Backslash;": "\u2216",
    "Barv;": "\u2ae7",
    "Barwed;": "\u2306",
    "Bcy;": "\u0411",
    "Because;": "\u2235",
    "Bernoullis;": "\u212c",
    "Beta;": "\u0392",
    "Bfr;": "\ud835\udd05",
    "Bopf;": "\ud835\udd39",
    "Breve;": "\u02d8",
    "Bscr;": "\u212c",
    "Bumpeq;": "\u224e",
    "CHcy;": "\u0427",
    "COPY": "\u00a9",
    "COPY;": "\u00a9",
    "Cacute;": "\u0106",
    "Cap;": "\u22d2",
    "CapitalDifferentialD;": "\u2145",
    "Cayleys;": "\u212d",
    "Ccaron;": "\u010c",
    "Ccedil": "\u00c7",
    "Ccedil;": "\u00c7",
    "Ccirc;": "\u0108",
    "Cconint;": "\u2230",
    "Cdot;": "\u010a",
    "Cedilla;": "\u00b8",
    "CenterDot;": "\u00b7",
    "Cfr;": "\u212d",
    "Chi;": "\u03a7",
    "CircleDot;": "\u2299",
    "CircleMinus;": "\u2296",
    "CirclePlus;": "\u2295",
    "CircleTimes;": "\u2297",
    "ClockwiseContourIntegral;": "\u2232",
    "CloseCurlyDoubleQuote;": "\u201d",
    "CloseCurlyQuote;": "\u2019",
    "Colon;": "\u2237",
    "Colone;": "\u2a74",
    "Congruent;": "\u2261",
    "Conint;": "\u222f",
    "ContourIntegral;": "\u222e",
    "Copf;": "\u2102",
    "Coproduct;": "\u2210",
    "CounterClockwiseContourIntegral;": "\u2233",
    "Cross;": "\u2a2f",
    "Cscr;": "\ud835\udc9e",
    "Cup;": "\u22d3",
    "CupCap;": "\u224d",
    "DD;": "\u2145",
    "DDotrahd;": "\u2911",
    "DJcy;": "\u0402",
    "DScy;": "\u0405",
    "DZcy;": "\u040f",
    "Dagger;": "\u2021",
    "Darr;": "\u21a1",
    "Dashv;": "\u2ae4",
    "Dcaron;": "\u010e",
    "Dcy;": "\u0414",
    "Del;": "\u2207",
    "Delta;": "\u0394",
    "Dfr;": "\ud835\udd07",
    "DiacriticalAcute;": "\u00b4",
    "DiacriticalDot;": "\u02d9",
    "DiacriticalDoubleAcute;": "\u02dd",
    "DiacriticalGrave;": "`",
    "DiacriticalTilde;": "\u02dc",
    "Diamond;": "\u22c4",
    "DifferentialD;": "\u2146",
    "Dopf;": "\ud835\udd3b",
    "Dot;": "\u00a8",
    "DotDot;": "\u20dc",
    "DotEqual;": "\u2250",
    "DoubleContourIntegral;": "\u222f",
    "DoubleDot;": "\u00a8",
    "DoubleDownArrow;": "\u21d3",
    "DoubleLeftArrow;": "\u21d0",
    "DoubleLeftRightArrow;": "\u21d4",
    "DoubleLeftTee;": "\u2ae4",
    "DoubleLongLeftArrow;": "\u27f8",
    "DoubleLongLeftRightArrow;": "\u27fa",
    "DoubleLongRightArrow;": "\u27f9",
    "DoubleRightArrow;": "\u21d2",
    "DoubleRightTee;": "\u22a8",
    "DoubleUpArrow;": "\u21d1",
    "DoubleUpDownArrow;": "\u21d5",
    "DoubleVerticalBar;": "\u2225",
    "DownArrow;": "\u2193",
    "DownArrowBar;": "\u2913",
    "DownArrowUpArrow;": "\u21f5",
    "DownBreve;": "\u0311",
    "DownLeftRightVector;": "\u2950",
    "DownLeftTeeVector;": "\u295e",
    "DownLeftVector;": "\u21bd",
    "DownLeftVectorBar;": "\u2956",
    "DownRightTeeVector;": "\u295f",
    "DownRightVector;": "\u21c1",
    "DownRightVectorBar;": "\u2957",
    "DownTee;": "\u22a4",
    "DownTeeArrow;": "\u21a7",
    "Downarrow;": "\u21d3",
    "Dscr;": "\ud835\udc9f",
    "Dstrok;": "\u0110",
    "ENG;": "\u014a",
    "ETH": "\u00d0",
    "ETH;": "\u00d0",
    "Eacute": "\u00c9",
    "Eacute;": "\u00c9",
    "Ecaron;": "\u011a",
    "Ecirc": "\u00ca",
    "Ecirc;": "\u00ca",
    "Ecy;": "\u042d",
    "Edot;": "\u0116",
    "Efr;": "\ud835\udd08",
    "Egrave": "\u00c8",
    "Egrave;": "\u00c8",
    "Element;": "\u2208",
    "Emacr;": "\u0112",
    "EmptySmallSquare;": "\u25fb",
    "EmptyVerySmallSquare;": "\u25ab",
    "Eogon;": "\u0118",
    "Eopf;": "\ud835\udd3c",
    "Epsilon;": "\u0395",
    "Equal;": "\u2a75",
    "EqualTilde;": "\u2242",
    "Equilibrium;": "\u21cc",
    "Escr;": "\u2130",
    "Esim;": "\u2a73",
    "Eta;": "\u0397",
    "Euml": "\u00cb",
    "Euml;": "\u00cb",
    "Exists;": "\u2203",
    "ExponentialE;": "\u2147",
    "Fcy;": "\u0424",
    "Ffr;": "\ud835\udd09",
    "FilledSmallSquare;": "\u25fc",
    "FilledVerySmallSquare;": "\u25aa",
    "Fopf;": "\ud835\udd3d",
    "ForAll;": "\u2200",
    "Fouriertrf;": "\u2131",
    "Fscr;": "\u2131",
    "GJcy;": "\u0403",
    "GT": ">",
    "GT;": ">",
    "Gamma;": "\u0393",
    "Gammad;": "\u03dc",
    "Gbreve;": "\u011e",
    "Gcedil;": "\u0122",
    "Gcirc;": "\u011c",
    "Gcy;": "\u0413",
    "Gdot;": "\u0120",
    "Gfr;": "\ud835\udd0a",
    "Gg;": "\u22d9",
    "Gopf;": "\ud835\udd3e",
    "GreaterEqual;": "\u2265",
    "GreaterEqualLess;": "\u22db",
    "GreaterFullEqual;": "\u2267",
    "GreaterGreater;": "\u2aa2",
    "GreaterLess;": "\u2277",
    "GreaterSlantEqual;": "\u2a7e",
    "GreaterTilde;": "\u2273",
    "Gscr;": "\ud835\udca2",
    "Gt;": "\u226b",
    "HARDcy;": "\u042a",
    "Hacek;": "\u02c7",
    "Hat;": "^",
    "Hcirc;": "\u0124",
    "Hfr;": "\u210c",
    "HilbertSpace;": "\u210b",
    "Hopf;": "\u210d",
    "HorizontalLine;": "\u2500",
    "Hscr;": "\u210b",
    "Hstrok;": "\u0126",
    "HumpDownHump;": "\u224e",
    "HumpEqual;": "\u224f",
    "IEcy;": "\u0415",
    "IJlig;": "\u0132",
    "IOcy;": "\u0401",
    "Iacute": "\u00cd",
    "Iacute;": "\u00cd",
    "Icirc": "\u00ce",
    "Icirc;": "\u00ce",
    "Icy;": "\u0418",
    "Idot;": "\u0130",
    "Ifr;": "\u2111",
    "Igrave": "\u00cc",
    "Igrave;": "\u00cc",
    "Im;": "\u2111",
    "Imacr;": "\u012a",
    "ImaginaryI;": "\u2148",
    "Implies;": "\u21d2",
    "Int;": "\u222c",
    "Integral;": "\u222b",
    "Intersection;": "\u22c2",
    "InvisibleComma;": "\u2063",
    "InvisibleTimes;": "\u2062",
    "Iogon;": "\u012e",
    "Iopf;": "\ud835\udd40",
    "Iota;": "\u0399",
    "Iscr;": "\u2110",
    "Itilde;": "\u0128",
    "Iukcy;": "\u0406",
    "Iuml": "\u00cf",
    "Iuml;": "\u00cf",
    "Jcirc;": "\u0134",
    "Jcy;": "\u0419",
    "Jfr;": "\ud835\udd0d",
    "Jopf;": "\ud835\udd41",
    "Jscr;": "\ud835\udca5",
    "Jsercy;": "\u0408",
    "Jukcy;": "\u0404",
    "KHcy;": "\u0425",
    "KJcy;": "\u040c",
    "Kappa;": "\u039a",
    "Kcedil;": "\u0136",
    "Kcy;": "\u041a",
    "Kfr;": "\ud835\udd0e",
    "Kopf;": "\ud835\udd42",
    "Kscr;": "\ud835\udca6",
    "LJcy;": "\u0409",
    "LT": "<",
    "LT;": "<",
    "Lacute;": "\u0139",
    "Lambda;": "\u039b",
    "Lang;": "\u27ea",
    "Laplacetrf;": "\u2112",
    "Larr;": "\u219e",
    "Lcaron;": "\u013d",
    "Lcedil;": "\u013b",
    "Lcy;": "\u041b",
    "LeftAngleBracket;": "\u27e8",
    "LeftArrow;": "\u2190",
    "LeftArrowBar;": "\u21e4",
    "LeftArrowRightArrow;": "\u21c6",
    "LeftCeiling;": "\u2308",
    "LeftDoubleBracket;": "\u27e6",
    "LeftDownTeeVector;": "\u2961",
    "LeftDownVector;": "\u21c3",
    "LeftDownVectorBar;": "\u2959",
    "LeftFloor;": "\u230a",
    "LeftRightArrow;": "\u2194",
    "LeftRightVector;": "\u294e",
    "LeftTee;": "\u22a3",
    "LeftTeeArrow;": "\u21a4",
    "LeftTeeVector;": "\u295a",
    "LeftTriangle;": "\u22b2",
    "LeftTriangleBar;": "\u29cf",
    "LeftTriangleEqual;": "\u22b4",
    "LeftUpDownVector;": "\u2951",
    "LeftUpTeeVector;": "\u2960",
    "LeftUpVector;": "\u21bf",
    "LeftUpVectorBar;": "\u2958",
    "LeftVector;": "\u21bc",
    "LeftVectorBar;": "\u2952",
    "Leftarrow;": "\u21d0",
    "Leftrightarrow;": "\u21d4",
    "LessEqualGreater;": "\u22da",
    "LessFullEqual;": "\u2266",
    "LessGreater;": "\u2276",
    "LessLess;": "\u2aa1",
    "LessSlantEqual;": "\u2a7d",
    "LessTilde;": "\u2272",
    "Lfr;": "\ud835\udd0f",
    "Ll;": "\u22d8",
    "Lleftarrow;": "\u21da",
    "Lmidot;": "\u013f",
    "LongLeftArrow;": "\u27f5",
    "LongLeftRightArrow;": "\u27f7",
    "LongRightArrow;": "\u27f6",
    "Longleftarrow;": "\u27f8",
    "Longleftrightarrow;": "\u27fa",
    "Longrightarrow;": "\u27f9",
    "Lopf;": "\ud835\udd43",
    "LowerLeftArrow;": "\u2199",
    "LowerRightArrow;": "\u2198",
    "Lscr;": "\u2112",
    "Lsh;": "\u21b0",
    "Lstrok;": "\u0141",
    "Lt;": "\u226a",
    "Map;": "\u2905",
    "Mcy;": "\u041c",
    "MediumSpace;": "\u205f",
    "Mellintrf;": "\u2133",
    "Mfr;": "\ud835\udd10",
    "MinusPlus;": "\u2213",
    "Mopf;": "\ud835\udd44",
    "Mscr;": "\u2133",
    "Mu;": "\u039c",
    "NJcy;": "\u040a",
    "Nacute;": "\u0143",
    "Ncaron;": "\u0147",
    "Ncedil;": "\u0145",
    "Ncy;": "\u041d",
    "NegativeMediumSpace;": "\u200b",
    "NegativeThickSpace;": "\u200b",
    "NegativeThinSpace;": "\u200b",
    "NegativeVeryThinSpace;": "\u200b",
    "NestedGreaterGreater;": "\u226b",
    "NestedLessLess;": "\u226a",
    "NewLine;": "\n",
    "Nfr;": "\ud835\udd11",
    "NoBreak;": "\u2060",
    "NonBreakingSpace;": "\u00a0",
    "Nopf;": "\u2115",
    "Not;": "\u2aec",
    "NotCongruent;": "\u2262",
    "NotCupCap;": "\u226d",
    "NotDoubleVerticalBar;": "\u2226",
    "NotElement;": "\u2209",
    "NotEqual;": "\u2260",
    "NotEqualTilde;": "\u2242\u0338",
    "NotExists;": "\u2204",
    "NotGreater;": "\u226f",
    "NotGreaterEqual;": "\u2271",
    "NotGreaterFullEqual;": "\u2267\u0338",
    "NotGreaterGreater;": "\u226b\u0338",
    "NotGreaterLess;": "\u2279",
    "NotGreaterSlantEqual;": "\u2a7e\u0338",
    "NotGreaterTilde;": "\u2275",
    "NotHumpDownHump;": "\u224e\u0338",
    "NotHumpEqual;": "\u224f\u0338",
    "NotLeftTriangle;": "\u22ea",
    "NotLeftTriangleBar;": "\u29cf\u0338",
    "NotLeftTriangleEqual;": "\u22ec",
    "NotLess;": "\u226e",
    "NotLessEqual;": "\u2270",
    "NotLessGreater;": "\u2278",
    "NotLessLess;": "\u226a\u0338",
    "NotLessSlantEqual;": "\u2a7d\u0338",
    "NotLessTilde;": "\u2274",
    "NotNestedGreaterGreater;": "\u2aa2\u0338",
    "NotNestedLessLess;": "\u2aa1\u0338",
    "NotPrecedes;": "\u2280",
    "NotPrecedesEqual;": "\u2aaf\u0338",
    "NotPrecedesSlantEqual;": "\u22e0",
    "NotReverseElement;": "\u220c",
    "NotRightTriangle;": "\u22eb",
    "NotRightTriangleBar;": "\u29d0\u0338",
    "NotRightTriangleEqual;": "\u22ed",
    "NotSquareSubset;": "\u228f\u0338",
    "NotSquareSubsetEqual;": "\u22e2",
    "NotSquareSuperset;": "\u2290\u0338",
    "NotSquareSupersetEqual;": "\u22e3",
    "NotSubset;": "\u2282\u20d2",
    "NotSubsetEqual;": "\u2288",
    "NotSucceeds;": "\u2281",
    "NotSucceedsEqual;": "\u2ab0\u0338",
    "NotSucceedsSlantEqual;": "\u22e1",
    "NotSucceedsTilde;": "\u227f\u0338",
    "NotSuperset;": "\u2283\u20d2",
    "NotSupersetEqual;": "\u2289",
    "NotTilde;": "\u2241",
    "NotTildeEqual;": "\u2244",
    "NotTildeFullEqual;": "\u2247",
    "NotTildeTilde;": "\u2249",
    "NotVerticalBar;": "\u2224",
    "Nscr;": "\ud835\udca9",
    "Ntilde": "\u00d1",
    "Ntilde;": "\u00d1",
    "Nu;": "\u039d",
    "OElig;": "\u0152",
    "Oacute": "\u00d3",
    "Oacute;": "\u00d3",
    "Ocirc": "\u00d4",
    "Ocirc;": "\u00d4",
    "Ocy;": "\u041e",
    "Odblac;": "\u0150",
    "Ofr;": "\ud835\udd12",
    "Ograve": "\u00d2",
    "Ograve;": "\u00d2",
    "Omacr;": "\u014c",
    "Omega;": "\u03a9",
    "Omicron;": "\u039f",
    "Oopf;": "\ud835\udd46",
    "OpenCurlyDoubleQuote;": "\u201c",
    "OpenCurlyQuote;": "\u2018",
    "Or;": "\u2a54",
    "Oscr;": "\ud835\udcaa",
    "Oslash": "\u00d8",
    "Oslash;": "\u00d8",
    "Otilde": "\u00d5",
    "Otilde;": "\u00d5",
    "Otimes;": "\u2a37",
    "Ouml": "\u00d6",
    "Ouml;": "\u00d6",
    "OverBar;": "\u203e",
    "OverBrace;": "\u23de",
    "OverBracket;": "\u23b4",
    "OverParenthesis;": "\u23dc",
    "PartialD;": "\u2202",
    "Pcy;": "\u041f",
    "Pfr;": "\ud835\udd13",
    "Phi;": "\u03a6",
    "Pi;": "\u03a0",
    "PlusMinus;": "\u00b1",
    "Poincareplane;": "\u210c",
    "Popf;": "\u2119",
    "Pr;": "\u2abb",
    "Precedes;": "\u227a",
    "PrecedesEqual;": "\u2aaf",
    "PrecedesSlantEqual;": "\u227c",
    "PrecedesTilde;": "\u227e",
    "Prime;": "\u2033",
    "Product;": "\u220f",
    "Proportion;": "\u2237",
    "Proportional;": "\u221d",
    "Pscr;": "\ud835\udcab",
    "Psi;": "\u03a8",
    "QUOT": "\"",
    "QUOT;": "\"",
    "Qfr;": "\ud835\udd14",
    "Qopf;": "\u211a",
    "Qscr;": "\ud835\udcac",
    "RBarr;": "\u2910",
    "REG": "\u00ae",
    "REG;": "\u00ae",
    "Racute;": "\u0154",
    "Rang;": "\u27eb",
    "Rarr;": "\u21a0",
    "Rarrtl;": "\u2916",
    "Rcaron;": "\u0158",
    "Rcedil;": "\u0156",
    "Rcy;": "\u0420",
    "Re;": "\u211c",
    "ReverseElement;": "\u220b",
    "ReverseEquilibrium;": "\u21cb",
    "ReverseUpEquilibrium;": "\u296f",
    "Rfr;": "\u211c",
    "Rho;": "\u03a1",
    "RightAngleBracket;": "\u27e9",
    "RightArrow;": "\u2192",
    "RightArrowBar;": "\u21e5",
    "RightArrowLeftArrow;": "\u21c4",
    "RightCeiling;": "\u2309",
    "RightDoubleBracket;": "\u27e7",
    "RightDownTeeVector;": "\u295d",
    "RightDownVector;": "\u21c2",
    "RightDownVectorBar;": "\u2955",
    "RightFloor;": "\u230b",
    "RightTee;": "\u22a2",
    "RightTeeArrow;": "\u21a6",
    "RightTeeVector;": "\u295b",
    "RightTriangle;": "\u22b3",
    "RightTriangleBar;": "\u29d0",
    "RightTriangleEqual;": "\u22b5",
    "RightUpDownVector;": "\u294f",
    "RightUpTeeVector;": "\u295c",
    "RightUpVector;": "\u21be",
    "RightUpVectorBar;": "\u2954",
    "RightVector;": "\u21c0",
    "RightVectorBar;": "\u2953",
    "Rightarrow;": "\u21d2",
    "Ropf;": "\u211d",
    "RoundImplies;": "\u2970",
    "Rrightarrow;": "\u21db",
    "Rscr;": "\u211b",
    "Rsh;": "\u21b1",
    "RuleDelayed;": "\u29f4",
    "SHCHcy;": "\u0429",
    "SHcy;": "\u0428",
    "SOFTcy;": "\u042c",
    "Sacute;": "\u015a",
    "Sc;": "\u2abc",
    "Scaron;": "\u0160",
    "Scedil;": "\u015e",
    "Scirc;": "\u015c",
    "Scy;": "\u0421",
    "Sfr;": "\ud835\udd16",
    "ShortDownArrow;": "\u2193",
    "ShortLeftArrow;": "\u2190",
    "ShortRightArrow;": "\u2192",
    "ShortUpArrow;": "\u2191",
    "Sigma;": "\u03a3",
    "SmallCircle;": "\u2218",
    "Sopf;": "\ud835\udd4a",
    "Sqrt;": "\u221a",
    "Square;": "\u25a1",
    "SquareIntersection;": "\u2293",
    "SquareSubset;": "\u228f",
    "SquareSubsetEqual;": "\u2291",
    "SquareSuperset;": "\u2290",
    "SquareSupersetEqual;": "\u2292",
    "SquareUnion;": "\u2294",
    "Sscr;": "\ud835\udcae",
    "Star;": "\u22c6",
    "Sub;": "\u22d0",
    "Subset;": "\u22d0",
    "SubsetEqual;": "\u2286",
    "Succeeds;": "\u227b",
    "SucceedsEqual;": "\u2ab0",
    "SucceedsSlantEqual;": "\u227d",
    "SucceedsTilde;": "\u227f",
    "SuchThat;": "\u220b",
    "Sum;": "\u2211",
    "Sup;": "\u22d1",
    "Superset;": "\u2283",
    "SupersetEqual;": "\u2287",
    "Supset;": "\u22d1",
    "THORN": "\u00de",
    "THORN;": "\u00de",
    "TRADE;": "\u2122",
    "TSHcy;": "\u040b",
    "TScy;": "\u0426",
    "Tab;": "\t",
    "Tau;": "\u03a4",
    "Tcaron;": "\u0164",
    "Tcedil;": "\u0162",
    "Tcy;": "\u0422",
    "Tfr;": "\ud835\udd17",
    "Therefore;": "\u2234",
    "Theta;": "\u0398",
    "ThickSpace;": "\u205f\u200a",
    "ThinSpace;": "\u2009",
    "Tilde;": "\u223c",
    "TildeEqual;": "\u2243",
    "TildeFullEqual;": "\u2245",
    "TildeTilde;": "\u2248",
    "Topf;": "\ud835\udd4b",
    "TripleDot;": "\u20db",
    "Tscr;": "\ud835\udcaf",
    "Tstrok;": "\u0166",
    "Uacute": "\u00da",
    "Uacute;": "\u00da",
    "Uarr;": "\u219f",
    "Uarrocir;": "\u2949",
    "Ubrcy;": "\u040e",
    "Ubreve;": "\u016c",
    "Ucirc": "\u00db",
    "Ucirc;": "\u00db",
    "Ucy;": "\u0423",
    "Udblac;": "\u0170",
    "Ufr;": "\ud835\udd18",
    "Ugrave": "\u00d9",
    "Ugrave;": "\u00d9",
    "Umacr;": "\u016a",
    "UnderBar;": "_",
    "UnderBrace;": "\u23df",
    "UnderBracket;": "\u23b5",
    "UnderParenthesis;": "\u23dd",
    "Union;": "\u22c3",
    "UnionPlus;": "\u228e",
    "Uogon;": "\u0172",
    "Uopf;": "\ud835\udd4c",
    "UpArrow;": "\u2191",
    "UpArrowBar;": "\u2912",
    "UpArrowDownArrow;": "\u21c5",
    "UpDownArrow;": "\u2195",
    "UpEquilibrium;": "\u296e",
    "UpTee;": "\u22a5",
    "UpTeeArrow;": "\u21a5",
    "Uparrow;": "\u21d1",
    "Updownarrow;": "\u21d5",
    "UpperLeftArrow;": "\u2196",
    "UpperRightArrow;": "\u2197",
    "Upsi;": "\u03d2",
    "Upsilon;": "\u03a5",
    "Uring;": "\u016e",
    "Uscr;": "\ud835\udcb0",
    "Utilde;": "\u0168",
    "Uuml": "\u00dc",
    "Uuml;": "\u00dc",
    "VDash;": "\u22ab",
    "Vbar;": "\u2aeb",
    "Vcy;": "\u0412",
    "Vdash;": "\u22a9",
    "Vdashl;": "\u2ae6",
    "Vee;": "\u22c1",
    "Verbar;": "\u2016",
    "Vert;": "\u2016",
    "VerticalBar;": "\u2223",
    "VerticalLine;": "|",
    "VerticalSeparator;": "\u2758",
    "VerticalTilde;": "\u2240",
    "VeryThinSpace;": "\u200a",
    "Vfr;": "\ud835\udd19",
    "Vopf;": "\ud835\udd4d",
    "Vscr;": "\ud835\udcb1",
    "Vvdash;": "\u22aa",
    "Wcirc;": "\u0174",
    "Wedge;": "\u22c0",
    "Wfr;": "\ud835\udd1a",
    "Wopf;": "\ud835\udd4e",
    "Wscr;": "\ud835\udcb2",
    "Xfr;": "\ud835\udd1b",
    "Xi;": "\u039e",
    "Xopf;": "\ud835\udd4f",
    "Xscr;": "\ud835\udcb3",
    "YAcy;": "\u042f",
    "YIcy;": "\u0407",
    "YUcy;": "\u042e",
    "Yacute": "\u00dd",
    "Yacute;": "\u00dd",
    "Ycirc;": "\u0176",
    "Ycy;": "\u042b",
    "Yfr;": "\ud835\udd1c",
    "Yopf;": "\ud835\udd50",
    "Yscr;": "\ud835\udcb4",
    "Yuml;": "\u0178",
    "ZHcy;": "\u0416",
    "Zacute;": "\u0179",
    "Zcaron;": "\u017d",
    "Zcy;": "\u0417",
    "Zdot;": "\u017b",
    "ZeroWidthSpace;": "\u200b",
    "Zeta;": "\u0396",
    "Zfr;": "\u2128",
    "Zopf;": "\u2124",
    "Zscr;": "\ud835\udcb5",
    "aacute": "\u00e1",
    "aacute;": "\u00e1",
    "abreve;": "\u0103",
    "ac;": "\u223e",
    "acE;": "\u223e\u0333",
    "acd;": "\u223f",
    "acirc": "\u00e2",
    "acirc;": "\u00e2",
    "acute": "\u00b4",
    "acute;": "\u00b4",
    "acy;": "\u0430",
    "aelig": "\u00e6",
    "aelig;": "\u00e6",
    "af;": "\u2061",
    "afr;": "\ud835\udd1e",
    "agrave": "\u00e0",
    "agrave;": "\u00e0",
    "alefsym;": "\u2135",
    "aleph;": "\u2135",
    "alpha;": "\u03b1",
    "amacr;": "\u0101",
    "amalg;": "\u2a3f",
    "amp": "&",
    "amp;": "&",
    "and;": "\u2227",
    "andand;": "\u2a55",
    "andd;": "\u2a5c",
    "andslope;": "\u2a58",
    "andv;": "\u2a5a",
    "ang;": "\u2220",
    "ange;": "\u29a4",
    "angle;": "\u2220",
    "angmsd;": "\u2221",
    "angmsdaa;": "\u29a8",
    "angmsdab;": "\u29a9",
    "angmsdac;": "\u29aa",
    "angmsdad;": "\u29ab",
    "angmsdae;": "\u29ac",
    "angmsdaf;": "\u29ad",
    "angmsdag;": "\u29ae",
    "angmsdah;": "\u29af",
    "angrt;": "\u221f",
    "angrtvb;": "\u22be",
    "angrtvbd;": "\u299d",
    "angsph;": "\u2222",
    "angst;": "\u00c5",
    "angzarr;": "\u237c",
    "aogon;": "\u0105",
    "aopf;": "\ud835\udd52",
    "ap;": "\u2248",
    "apE;": "\u2a70",
    "apacir;": "\u2a6f",
    "ape;": "\u224a",
    "apid;": "\u224b",
    "apos;": "'",
    "approx;": "\u2248",
    "approxeq;": "\u224a",
    "aring": "\u00e5",
    "aring;": "\u00e5",
    "ascr;": "\ud835\udcb6",
    "ast;": "*",
    "asymp;": "\u2248",
    "asympeq;": "\u224d",
    "atilde": "\u00e3",
    "atilde;": "\u00e3",
    "auml": "\u00e4",
    "auml;": "\u00e4",
    "awconint;": "\u2233",
    "awint;": "\u2a11",
    "bNot;": "\u2aed",
    "backcong;": "\u224c",
    "backepsilon;": "\u03f6",
    "backprime;": "\u2035",
    "backsim;": "\u223d",
    "backsimeq;": "\u22cd",
    "barvee;": "\u22bd",
    "barwed;": "\u2305",
    "barwedge;": "\u2305",
    "bbrk;": "\u23b5",
    "bbrktbrk;": "\u23b6",
    "bcong;": "\u224c",
    "bcy;": "\u0431",
    "bdquo;": "\u201e",
    "becaus;": "\u2235",
    "because;": "\u2235",
    "bemptyv;": "\u29b0",
    "bepsi;": "\u03f6",
    "bernou;": "\u212c",
    "beta;": "\u03b2",
    "beth;": "\u2136",
    "between;": "\u226c",
    "bfr;": "\ud835\udd1f",
    "bigcap;": "\u22c2",
    "bigcirc;": "\u25ef",
    "bigcup;": "\u22c3",
    "bigodot;": "\u2a00",
    "bigoplus;": "\u2a01",
    "bigotimes;": "\u2a02",
    "bigsqcup;": "\u2a06",
    "bigstar;": "\u2605",
    "bigtriangledown;": "\u25bd",
    "bigtriangleup;": "\u25b3",
    "biguplus;": "\u2a04",
    "bigvee;": "\u22c1",
    "bigwedge;": "\u22c0",
    "bkarow;": "\u290d",
    "blacklozenge;": "\u29eb",
    "blacksquare;": "\u25aa",
    "blacktriangle;": "\u25b4",
    "blacktriangledown;": "\u25be",
    "blacktriangleleft;": "\u25c2",
    "blacktriangleright;": "\u25b8",
    "blank;": "\u2423",
    "blk12;": "\u2592",
    "blk14;": "\u2591",
    "blk34;": "\u2593",
    "block;": "\u2588",
    "bne;": "=\u20e5",
    "bnequiv;": "\u2261\u20e5",
    "bnot;": "\u2310",
    "bopf;": "\ud835\udd53",
    "bot;": "\u22a5",
    "bottom;": "\u22a5",
    "bowtie;": "\u22c8",
    "boxDL;": "\u2557",
    "boxDR;": "\u2554",
    "boxDl;": "\u2556",
    "boxDr;": "\u2553",
    "boxH;": "\u2550",
    "boxHD;": "\u2566",
    "boxHU;": "\u2569",
    "boxHd;": "\u2564",
    "boxHu;": "\u2567",
    "boxUL;": "\u255d",
    "boxUR;": "\u255a",
    "boxUl;": "\u255c",
    "boxUr;": "\u2559",
    "boxV;": "\u2551",
    "boxVH;": "\u256c",
    "boxVL;": "\u2563",
    "boxVR;": "\u2560",
    "boxVh;": "\u256b",
    "boxVl;": "\u2562",
    "boxVr;": "\u255f",
    "boxbox;": "\u29c9",
    "boxdL;": "\u2555",
    "boxdR;": "\u2552",
    "boxdl;": "\u2510",
    "boxdr;": "\u250c",
    "boxh;": "\u2500",
    "boxhD;": "\u2565",
    "boxhU;": "\u2568",
    "boxhd;": "\u252c",
    "boxhu;": "\u2534",
    "boxminus;": "\u229f",
    "boxplus;": "\u229e",
    "boxtimes;": "\u22a0",
    "boxuL;": "\u255b",
    "boxuR;": "\u2558",
    "boxul;": "\u2518",
    "boxur;": "\u2514",
    "boxv;": "\u2502",
    "boxvH;": "\u256a",
    "boxvL;": "\u2561",
    "boxvR;": "\u255e",
    "boxvh;": "\u253c",
    "boxvl;": "\u2524",
    "boxvr;": "\u251c",
    "bprime;": "\u2035",
    "breve;": "\u02d8",
    "brvbar": "\u00a6",
    "brvbar;": "\u00a6",
    "bscr;": "\ud835\udcb7",
    "bsemi;": "\u204f",
    "bsim;": "\u223d",
    "bsime;": "\u22cd",
    "bsol;": "\\",
    "bsolb;": "\u29c5",
    "bsolhsub;": "\u27c8",
    "bull;": "\u2022",
    "bullet;": "\u2022",
    "bump;": "\u224e",
    "bumpE;": "\u2aae",
    "bumpe;": "\u224f",
    "bumpeq;": "\u224f",
    "cacute;": "\u0107",
    "cap;": "\u2229",
    "capand;": "\u2a44",
    "capbrcup;": "\u2a49",
    "capcap;": "\u2a4b",
    "capcup;": "\u2a47",
    "capdot;": "\u2a40",
    "caps;": "\u2229\ufe00",
    "caret;": "\u2041",
    "caron;": "\u02c7",
    "ccaps;": "\u2a4d",
    "ccaron;": "\u010d",
    "ccedil": "\u00e7",
    "ccedil;": "\u00e7",
    "ccirc;": "\u0109",
    "ccups;": "\u2a4c",
    "ccupssm;": "\u2a50",
    "cdot;": "\u010b",
    "cedil": "\u00b8",
    "cedil;": "\u00b8",
    "cemptyv;": "\u29b2",
    "cent": "\u00a2",
    "cent;": "\u00a2",
    "centerdot;": "\u00b7",
    "cfr;": "\ud835\udd20",
    "chcy;": "\u0447",
    "check;": "\u2713",
    "checkmark;": "\u2713",
    "chi;": "\u03c7",
    "cir;": "\u25cb",
    "cirE;": "\u29c3",
    "circ;": "\u02c6",
    "circeq;": "\u2257",
    "circlearrowleft;": "\u21ba",
    "circlearrowright;": "\u21bb",
    "circledR;": "\u00ae",
    "circledS;": "\u24c8",
    "circledast;": "\u229b",
    "circledcirc;": "\u229a",
    "circleddash;": "\u229d",
    "cire;": "\u2257",
    "cirfnint;": "\u2a10",
    "cirmid;": "\u2aef",
    "cirscir;": "\u29c2",
    "clubs;": "\u2663",
    "clubsuit;": "\u2663",
    "colon;": ":",
    "colone;": "\u2254",
    "coloneq;": "\u2254",
    "comma;": ",",
    "commat;": "@",
    "comp;": "\u2201",
    "compfn;": "\u2218",
    "complement;": "\u2201",
    "complexes;": "\u2102",
    "cong;": "\u2245",
    "congdot;": "\u2a6d",
    "conint;": "\u222e",
    "copf;": "\ud835\udd54",
    "coprod;": "\u2210",
    "copy": "\u00a9",
    "copy;": "\u00a9",
    "copysr;": "\u2117",
    "crarr;": "\u21b5",
    "cross;": "\u2717",
    "cscr;": "\ud835\udcb8",
    "csub;": "\u2acf",
    "csube;": "\u2ad1",
    "csup;": "\u2ad0",
    "csupe;": "\u2ad2",
    "ctdot;": "\u22ef",
    "cudarrl;": "\u2938",
    "cudarrr;": "\u2935",
    "cuepr;": "\u22de",
    "cuesc;": "\u22df",
    "cularr;": "\u21b6",
    "cularrp;": "\u293d",
    "cup;": "\u222a",
    "cupbrcap;": "\u2a48",
    "cupcap;": "\u2a46",
    "cupcup;": "\u2a4a",
    "cupdot;": "\u228d",
    "cupor;": "\u2a45",
    "cups;": "\u222a\ufe00",
    "curarr;": "\u21b7",
    "curarrm;": "\u293c",
    "curlyeqprec;": "\u22de",
    "curlyeqsucc;": "\u22df",
    "curlyvee;": "\u22ce",
    "curlywedge;": "\u22cf",
    "curren": "\u00a4",
    "curren;": "\u00a4",
    "curvearrowleft;": "\u21b6",
    "curvearrowright;": "\u21b7",
    "cuvee;": "\u22ce",
    "cuwed;": "\u22cf",
    "cwconint;": "\u2232",
    "cwint;": "\u2231",
    "cylcty;": "\u232d",
    "dArr;": "\u21d3",
    "dHar;": "\u2965",
    "dagger;": "\u2020",
    "daleth;": "\u2138",
    "darr;": "\u2193",
    "dash;": "\u2010",
    "dashv;": "\u22a3",
    "dbkarow;": "\u290f",
    "dblac;": "\u02dd",
    "dcaron;": "\u010f",
    "dcy;": "\u0434",
    "dd;": "\u2146",
    "ddagger;": "\u2021",
    "ddarr;": "\u21ca",
    "ddotseq;": "\u2a77",
    "deg": "\u00b0",
    "deg;": "\u00b0",
    "delta;": "\u03b4",
    "demptyv;": "\u29b1",
    "dfisht;": "\u297f",
    "dfr;": "\ud835\udd21",
    "dharl;": "\u21c3",
    "dharr;": "\u21c2",
    "diam;": "\u22c4",
    "diamond;": "\u22c4",
    "diamondsuit;": "\u2666",
    "diams;": "\u2666",
    "die;": "\u00a8",
    "digamma;": "\u03dd",
    "disin;": "\u22f2",
    "div;": "\u00f7",
    "divide": "\u00f7",
    "divide;": "\u00f7",
    "divideontimes;": "\u22c7",
    "divonx;": "\u22c7",
    "djcy;": "\u0452",
    "dlcorn;": "\u231e",
    "dlcrop;": "\u230d",
    "dollar;": "$",
    "dopf;": "\ud835\udd55",
    "dot;": "\u02d9",
    "doteq;": "\u2250",
    "doteqdot;": "\u2251",
    "dotminus;": "\u2238",
    "dotplus;": "\u2214",
    "dotsquare;": "\u22a1",
    "doublebarwedge;": "\u2306",
    "downarrow;": "\u2193",
    "downdownarrows;": "\u21ca",
    "downharpoonleft;": "\u21c3",
    "downharpoonright;": "\u21c2",
    "drbkarow;": "\u2910",
    "drcorn;": "\u231f",
    "drcrop;": "\u230c",
    "dscr;": "\ud835\udcb9",
    "dscy;": "\u0455",
    "dsol;": "\u29f6",
    "dstrok;": "\u0111",
    "dtdot;": "\u22f1",
    "dtri;": "\u25bf",
    "dtrif;": "\u25be",
    "duarr;": "\u21f5",
    "duhar;": "\u296f",
    "dwangle;": "\u29a6",
    "dzcy;": "\u045f",
    "dzigrarr;": "\u27ff",
    "eDDot;": "\u2a77",
    "eDot;": "\u2251",
    "eacute": "\u00e9",
    "eacute;": "\u00e9",
    "easter;": "\u2a6e",
    "ecaron;": "\u011b",
    "ecir;": "\u2256",
    "ecirc": "\u00ea",
    "ecirc;": "\u00ea",
    "ecolon;": "\u2255",
    "ecy;": "\u044d",
    "edot;": "\u0117",
    "ee;": "\u2147",
    "efDot;": "\u2252",
    "efr;": "\ud835\udd22",
    "eg;": "\u2a9a",
    "egrave": "\u00e8",
    "egrave;": "\u00e8",
    "egs;": "\u2a96",
    "egsdot;": "\u2a98",
    "el;": "\u2a99",
    "elinters;": "\u23e7",
    "ell;": "\u2113",
    "els;": "\u2a95",
    "elsdot;": "\u2a97",
    "emacr;": "\u0113",
    "empty;": "\u2205",
    "emptyset;": "\u2205",
    "emptyv;": "\u2205",
    "emsp13;": "\u2004",
    "emsp14;": "\u2005",
    "emsp;": "\u2003",
    "eng;": "\u014b",
    "ensp;": "\u2002",
    "eogon;": "\u0119",
    "eopf;": "\ud835\udd56",
    "epar;": "\u22d5",
    "eparsl;": "\u29e3",
    "eplus;": "\u2a71",
    "epsi;": "\u03b5",
    "epsilon;": "\u03b5",
    "epsiv;": "\u03f5",
    "eqcirc;": "\u2256",
    "eqcolon;": "\u2255",
    "eqsim;": "\u2242",
    "eqslantgtr;": "\u2a96",
    "eqslantless;": "\u2a95",
    "equals;": "=",
    "equest;": "\u225f",
    "equiv;": "\u2261",
    "equivDD;": "\u2a78",
    "eqvparsl;": "\u29e5",
    "erDot;": "\u2253",
    "erarr;": "\u2971",
    "escr;": "\u212f",
    "esdot;": "\u2250",
    "esim;": "\u2242",
    "eta;": "\u03b7",
    "eth": "\u00f0",
    "eth;": "\u00f0",
    "euml": "\u00eb",
    "euml;": "\u00eb",
    "euro;": "\u20ac",
    "excl;": "!",
    "exist;": "\u2203",
    "expectation;": "\u2130",
    "exponentiale;": "\u2147",
    "fallingdotseq;": "\u2252",
    "fcy;": "\u0444",
    "female;": "\u2640",
    "ffilig;": "\ufb03",
    "fflig;": "\ufb00",
    "ffllig;": "\ufb04",
    "ffr;": "\ud835\udd23",
    "filig;": "\ufb01",
    "fjlig;": "fj",
    "flat;": "\u266d",
    "fllig;": "\ufb02",
    "fltns;": "\u25b1",
    "fnof;": "\u0192",
    "fopf;": "\ud835\udd57",
    "forall;": "\u2200",
    "fork;": "\u22d4",
    "forkv;": "\u2ad9",
    "fpartint;": "\u2a0d",
    "frac12": "\u00bd",
    "frac12;": "\u00bd",
    "frac13;": "\u2153",
    "frac14": "\u00bc",
    "frac14;": "\u00bc",
    "frac15;": "\u2155",
    "frac16;": "\u2159",
    "frac18;": "\u215b",
    "frac23;": "\u2154",
    "frac25;": "\u2156",
    "frac34": "\u00be",
    "frac34;": "\u00be",
    "frac35;": "\u2157",
    "frac38;": "\u215c",
    "frac45;": "\u2158",
    "frac56;": "\u215a",
    "frac58;": "\u215d",
    "frac78;": "\u215e",
    "frasl;": "\u2044",
    "frown;": "\u2322",
    "fscr;": "\ud835\udcbb",
    "gE;": "\u2267",
    "gEl;": "\u2a8c",
    "gacute;": "\u01f5",
    "gamma;": "\u03b3",
    "gammad;": "\u03dd",
    "gap;": "\u2a86",
    "gbreve;": "\u011f",
    "gcirc;": "\u011d",
    "gcy;": "\u0433",
    "gdot;": "\u0121",
    "ge;": "\u2265",
    "gel;": "\u22db",
    "geq;": "\u2265",
    "geqq;": "\u2267",
    "geqslant;": "\u2a7e",
    "ges;": "\u2a7e",
    "gescc;": "\u2aa9",
    "gesdot;": "\u2a80",
    "gesdoto;": "\u2a82",
    "gesdotol;": "\u2a84",
    "gesl;": "\u22db\ufe00",
    "gesles;": "\u2a94",
    "gfr;": "\ud835\udd24",
    "gg;": "\u226b",
    "ggg;": "\u22d9",
    "gimel;": "\u2137",
    "gjcy;": "\u0453",
    "gl;": "\u2277",
    "glE;": "\u2a92",
    "gla;": "\u2aa5",
    "glj;": "\u2aa4",
    "gnE;": "\u2269",
    "gnap;": "\u2a8a",
    "gnapprox;": "\u2a8a",
    "gne;": "\u2a88",
    "gneq;": "\u2a88",
    "gneqq;": "\u2269",
    "gnsim;": "\u22e7",
    "gopf;": "\ud835\udd58",
    "grave;": "`",
    "gscr;": "\u210a",
    "gsim;": "\u2273",
    "gsime;": "\u2a8e",
    "gsiml;": "\u2a90",
    "gt": ">",
    "gt;": ">",
    "gtcc;": "\u2aa7",
    "gtcir;": "\u2a7a",
    "gtdot;": "\u22d7",
    "gtlPar;": "\u2995",
    "gtquest;": "\u2a7c",
    "gtrapprox;": "\u2a86",
    "gtrarr;": "\u2978",
    "gtrdot;": "\u22d7",
    "gtreqless;": "\u22db",
    "gtreqqless;": "\u2a8c",
    "gtrless;": "\u2277",
    "gtrsim;": "\u2273",
    "gvertneqq;": "\u2269\ufe00",
    "gvnE;": "\u2269\ufe00",
    "hArr;": "\u21d4",
    "hairsp;": "\u200a",
    "half;": "\u00bd",
    "hamilt;": "\u210b",
    "hardcy;": "\u044a",
    "harr;": "\u2194",
    "harrcir;": "\u2948",
    "harrw;": "\u21ad",
    "hbar;": "\u210f",
    "hcirc;": "\u0125",
    "hearts;": "\u2665",
    "heartsuit;": "\u2665",
    "hellip;": "\u2026",
    "hercon;": "\u22b9",
    "hfr;": "\ud835\udd25",
    "hksearow;": "\u2925",
    "hkswarow;": "\u2926",
    "hoarr;": "\u21ff",
    "homtht;": "\u223b",
    "hookleftarrow;": "\u21a9",
    "hookrightarrow;": "\u21aa",
    "hopf;": "\ud835\udd59",
    "horbar;": "\u2015",
    "hscr;": "\ud835\udcbd",
    "hslash;": "\u210f",
    "hstrok;": "\u0127",
    "hybull;": "\u2043",
    "hyphen;": "\u2010",
    "iacute": "\u00ed",
    "iacute;": "\u00ed",
    "ic;": "\u2063",
    "icirc": "\u00ee",
    "icirc;": "\u00ee",
    "icy;": "\u0438",
    "iecy;": "\u0435",
    "iexcl": "\u00a1",
    "iexcl;": "\u00a1",
    "iff;": "\u21d4",
    "ifr;": "\ud835\udd26",
    "igrave": "\u00ec",
    "igrave;": "\u00ec",
    "ii;": "\u2148",
    "iiiint;": "\u2a0c",
    "iiint;": "\u222d",
    "iinfin;": "\u29dc",
    "iiota;": "\u2129",
    "ijlig;": "\u0133",
    "imacr;": "\u012b",
    "image;": "\u2111",
    "imagline;": "\u2110",
    "imagpart;": "\u2111",
    "imath;": "\u0131",
    "imof;": "\u22b7",
    "imped;": "\u01b5",
    "in;": "\u2208",
    "incare;": "\u2105",
    "infin;": "\u221e",
    "infintie;": "\u29dd",
    "inodot;": "\u0131",
    "int;": "\u222b",
    "intcal;": "\u22ba",
    "integers;": "\u2124",
    "intercal;": "\u22ba",
    "intlarhk;": "\u2a17",
    "intprod;": "\u2a3c",
    "iocy;": "\u0451",
    "iogon;": "\u012f",
    "iopf;": "\ud835\udd5a",
    "iota;": "\u03b9",
    "iprod;": "\u2a3c",
    "iquest": "\u00bf",
    "iquest;": "\u00bf",
    "iscr;": "\ud835\udcbe",
    "isin;": "\u2208",
    "isinE;": "\u22f9",
    "isindot;": "\u22f5",
    "isins;": "\u22f4",
    "isinsv;": "\u22f3",
    "isinv;": "\u2208",
    "it;": "\u2062",
    "itilde;": "\u0129",
    "iukcy;": "\u0456",
    "iuml": "\u00ef",
    "iuml;": "\u00ef",
    "jcirc;": "\u0135",
    "jcy;": "\u0439",
    "jfr;": "\ud835\udd27",
    "jmath;": "\u0237",
    "jopf;": "\ud835\udd5b",
    "jscr;": "\ud835\udcbf",
    "jsercy;": "\u0458",
    "jukcy;": "\u0454",
    "kappa;": "\u03ba",
    "kappav;": "\u03f0",
    "kcedil;": "\u0137",
    "kcy;": "\u043a",
    "kfr;": "\ud835\udd28",
    "kgreen;": "\u0138",
    "khcy;": "\u0445",
    "kjcy;": "\u045c",
    "kopf;": "\ud835\udd5c",
    "kscr;": "\ud835\udcc0",
    "lAarr;": "\u21da",
    "lArr;": "\u21d0",
    "lAtail;": "\u291b",
    "lBarr;": "\u290e",
    "lE;": "\u2266",
    "lEg;": "\u2a8b",
    "lHar;": "\u2962",
    "lacute;": "\u013a",
    "laemptyv;": "\u29b4",
    "lagran;": "\u2112",
    "lambda;": "\u03bb",
    "lang;": "\u27e8",
    "langd;": "\u2991",
    "langle;": "\u27e8",
    "lap;": "\u2a85",
    "laquo": "\u00ab",
    "laquo;": "\u00ab",
    "larr;": "\u2190",
    "larrb;": "\u21e4",
    "larrbfs;": "\u291f",
    "larrfs;": "\u291d",
    "larrhk;": "\u21a9",
    "larrlp;": "\u21ab",
    "larrpl;": "\u2939",
    "larrsim;": "\u2973",
    "larrtl;": "\u21a2",
    "lat;": "\u2aab",
    "latail;": "\u2919",
    "late;": "\u2aad",
    "lates;": "\u2aad\ufe00",
    "lbarr;": "\u290c",
    "lbbrk;": "\u2772",
    "lbrace;": "{",
    "lbrack;": "[",
    "lbrke;": "\u298b",
    "lbrksld;": "\u298f",
    "lbrkslu;": "\u298d",
    "lcaron;": "\u013e",
    "lcedil;": "\u013c",
    "lceil;": "\u2308",
    "lcub;": "{",
    "lcy;": "\u043b",
    "ldca;": "\u2936",
    "ldquo;": "\u201c",
    "ldquor;": "\u201e",
    "ldrdhar;": "\u2967",
    "ldrushar;": "\u294b",
    "ldsh;": "\u21b2",
    "le;": "\u2264",
    "leftarrow;": "\u2190",
    "leftarrowtail;": "\u21a2",
    "leftharpoondown;": "\u21bd",
    "leftharpoonup;": "\u21bc",
    "leftleftarrows;": "\u21c7",
    "leftrightarrow;": "\u2194",
    "leftrightarrows;": "\u21c6",
    "leftrightharpoons;": "\u21cb",
    "leftrightsquigarrow;": "\u21ad",
    "leftthreetimes;": "\u22cb",
    "leg;": "\u22da",
    "leq;": "\u2264",
    "leqq;": "\u2266",
    "leqslant;": "\u2a7d",
    "les;": "\u2a7d",
    "lescc;": "\u2aa8",
    "lesdot;": "\u2a7f",
    "lesdoto;": "\u2a81",
    "lesdotor;": "\u2a83",
    "lesg;": "\u22da\ufe00",
    "lesges;": "\u2a93",
    "lessapprox;": "\u2a85",
    "lessdot;": "\u22d6",
    "lesseqgtr;": "\u22da",
    "lesseqqgtr;": "\u2a8b",
    "lessgtr;": "\u2276",
    "lesssim;": "\u2272",
    "lfisht;": "\u297c",
    "lfloor;": "\u230a",
    "lfr;": "\ud835\udd29",
    "lg;": "\u2276",
    "lgE;": "\u2a91",
    "lhard;": "\u21bd",
    "lharu;": "\u21bc",
    "lharul;": "\u296a",
    "lhblk;": "\u2584",
    "ljcy;": "\u0459",
    "ll;": "\u226a",
    "llarr;": "\u21c7",
    "llcorner;": "\u231e",
    "llhard;": "\u296b",
    "lltri;": "\u25fa",
    "lmidot;": "\u0140",
    "lmoust;": "\u23b0",
    "lmoustache;": "\u23b0",
    "lnE;": "\u2268",
    "lnap;": "\u2a89",
    "lnapprox;": "\u2a89",
    "lne;": "\u2a87",
    "lneq;": "\u2a87",
    "lneqq;": "\u2268",
    "lnsim;": "\u22e6",
    "loang;": "\u27ec",
    "loarr;": "\u21fd",
    "lobrk;": "\u27e6",
    "longleftarrow;": "\u27f5",
    "longleftrightarrow;": "\u27f7",
    "longmapsto;": "\u27fc",
    "longrightarrow;": "\u27f6",
    "looparrowleft;": "\u21ab",
    "looparrowright;": "\u21ac",
    "lopar;": "\u2985",
    "lopf;": "\ud835\udd5d",
    "loplus;": "\u2a2d",
    "lotimes;": "\u2a34",
    "lowast;": "\u2217",
    "lowbar;": "_",
    "loz;": "\u25ca",
    "lozenge;": "\u25ca",
    "lozf;": "\u29eb",
    "lpar;": "(",
    "lparlt;": "\u2993",
    "lrarr;": "\u21c6",
    "lrcorner;": "\u231f",
    "lrhar;": "\u21cb",
    "lrhard;": "\u296d",
    "lrm;": "\u200e",
    "lrtri;": "\u22bf",
    "lsaquo;": "\u2039",
    "lscr;": "\ud835\udcc1",
    "lsh;": "\u21b0",
    "lsim;": "\u2272",
    "lsime;": "\u2a8d",
    "lsimg;": "\u2a8f",
    "lsqb;": "[",
    "lsquo;": "\u2018",
    "lsquor;": "\u201a",
    "lstrok;": "\u0142",
    "lt": "<",
    "lt;": "<",
    "ltcc;": "\u2aa6",
    "ltcir;": "\u2a79",
    "ltdot;": "\u22d6",
    "lthree;": "\u22cb",
    "ltimes;": "\u22c9",
    "ltlarr;": "\u2976",
    "ltquest;": "\u2a7b",
    "ltrPar;": "\u2996",
    "ltri;": "\u25c3",
    "ltrie;": "\u22b4",
    "ltrif;": "\u25c2",
    "lurdshar;": "\u294a",
    "luruhar;": "\u2966",
    "lvertneqq;": "\u2268\ufe00",
    "lvnE;": "\u2268\ufe00",
    "mDDot;": "\u223a",
    "macr": "\u00af",
    "macr;": "\u00af",
    "male;": "\u2642",
    "malt;": "\u2720",
    "maltese;": "\u2720",
    "map;": "\u21a6",
    "mapsto;": "\u21a6",
    "mapstodown;": "\u21a7",
    "mapstoleft;": "\u21a4",
    "mapstoup;": "\u21a5",
    "marker;": "\u25ae",
    "mcomma;": "\u2a29",
    "mcy;": "\u043c",
    "mdash;": "\u2014",
    "measuredangle;": "\u2221",
    "mfr;": "\ud835\udd2a",
    "mho;": "\u2127",
    "micro": "\u00b5",
    "micro;": "\u00b5",
    "mid;": "\u2223",
    "midast;": "*",
    "midcir;": "\u2af0",
    "middot": "\u00b7",
    "middot;": "\u00b7",
    "minus;": "\u2212",
    "minusb;": "\u229f",
    "minusd;": "\u2238",
    "minusdu;": "\u2a2a",
    "mlcp;": "\u2adb",
    "mldr;": "\u2026",
    "mnplus;": "\u2213",
    "models;": "\u22a7",
    "mopf;": "\ud835\udd5e",
    "mp;": "\u2213",
    "mscr;": "\ud835\udcc2",
    "mstpos;": "\u223e",
    "mu;": "\u03bc",
    "multimap;": "\u22b8",
    "mumap;": "\u22b8",
    "nGg;": "\u22d9\u0338",
    "nGt;": "\u226b\u20d2",
    "nGtv;": "\u226b\u0338",
    "nLeftarrow;": "\u21cd",
    "nLeftrightarrow;": "\u21ce",
    "nLl;": "\u22d8\u0338",
    "nLt;": "\u226a\u20d2",
    "nLtv;": "\u226a\u0338",
    "nRightarrow;": "\u21cf",
    "nVDash;": "\u22af",
    "nVdash;": "\u22ae",
    "nabla;": "\u2207",
    "nacute;": "\u0144",
    "nang;": "\u2220\u20d2",
    "nap;": "\u2249",
    "napE;": "\u2a70\u0338",
    "napid;": "\u224b\u0338",
    "napos;": "\u0149",
    "napprox;": "\u2249",
    "natur;": "\u266e",
    "natural;": "\u266e",
    "naturals;": "\u2115",
    "nbsp": "\u00a0",
    "nbsp;": "\u00a0",
    "nbump;": "\u224e\u0338",
    "nbumpe;": "\u224f\u0338",
    "ncap;": "\u2a43",
    "ncaron;": "\u0148",
    "ncedil;": "\u0146",
    "ncong;": "\u2247",
    "ncongdot;": "\u2a6d\u0338",
    "ncup;": "\u2a42",
    "ncy;": "\u043d",
    "ndash;": "\u2013",
    "ne;": "\u2260",
    "neArr;": "\u21d7",
    "nearhk;": "\u2924",
    "nearr;": "\u2197",
    "nearrow;": "\u2197",
    "nedot;": "\u2250\u0338",
    "nequiv;": "\u2262",
    "nesear;": "\u2928",
    "nesim;": "\u2242\u0338",
    "nexist;": "\u2204",
    "nexists;": "\u2204",
    "nfr;": "\ud835\udd2b",
    "ngE;": "\u2267\u0338",
    "nge;": "\u2271",
    "ngeq;": "\u2271",
    "ngeqq;": "\u2267\u0338",
    "ngeqslant;": "\u2a7e\u0338",
    "nges;": "\u2a7e\u0338",
    "ngsim;": "\u2275",
    "ngt;": "\u226f",
    "ngtr;": "\u226f",
    "nhArr;": "\u21ce",
    "nharr;": "\u21ae",
    "nhpar;": "\u2af2",
    "ni;": "\u220b",
    "nis;": "\u22fc",
    "nisd;": "\u22fa",
    "niv;": "\u220b",
    "njcy;": "\u045a",
    "nlArr;": "\u21cd",
    "nlE;": "\u2266\u0338",
    "nlarr;": "\u219a",
    "nldr;": "\u2025",
    "nle;": "\u2270",
    "nleftarrow;": "\u219a",
    "nleftrightarrow;": "\u21ae",
    "nleq;": "\u2270",
    "nleqq;": "\u2266\u0338",
    "nleqslant;": "\u2a7d\u0338",
    "nles;": "\u2a7d\u0338",
    "nless;": "\u226e",
    "nlsim;": "\u2274",
    "nlt;": "\u226e",
    "nltri;": "\u22ea",
    "nltrie;": "\u22ec",
    "nmid;": "\u2224",
    "nopf;": "\ud835\udd5f",
    "not": "\u00ac",
    "not;": "\u00ac",
    "notin;": "\u2209",
    "notinE;": "\u22f9\u0338",
    "notindot;": "\u22f5\u0338",
    "notinva;": "\u2209",
    "notinvb;": "\u22f7",
    "notinvc;": "\u22f6",
    "notni;": "\u220c",
    "notniva;": "\u220c",
    "notnivb;": "\u22fe",
    "notnivc;": "\u22fd",
    "npar;": "\u2226",
    "nparallel;": "\u2226",
    "nparsl;": "\u2afd\u20e5",
    "npart;": "\u2202\u0338",
    "npolint;": "\u2a14",
    "npr;": "\u2280",
    "nprcue;": "\u22e0",
    "npre;": "\u2aaf\u0338",
    "nprec;": "\u2280",
    "npreceq;": "\u2aaf\u0338",
    "nrArr;": "\u21cf",
    "nrarr;": "\u219b",
    "nrarrc;": "\u2933\u0338",
    "nrarrw;": "\u219d\u0338",
    "nrightarrow;": "\u219b",
    "nrtri;": "\u22eb",
    "nrtrie;": "\u22ed",
    "nsc;": "\u2281",
    "nsccue;": "\u22e1",
    "nsce;": "\u2ab0\u0338",
    "nscr;": "\ud835\udcc3",
    "nshortmid;": "\u2224",
    "nshortparallel;": "\u2226",
    "nsim;": "\u2241",
    "nsime;": "\u2244",
    "nsimeq;": "\u2244",
    "nsmid;": "\u2224",
    "nspar;": "\u2226",
    "nsqsube;": "\u22e2",
    "nsqsupe;": "\u22e3",
    "nsub;": "\u2284",
    "nsubE;": "\u2ac5\u0338",
    "nsube;": "\u2288",
    "nsubset;": "\u2282\u20d2",
    "nsubseteq;": "\u2288",
    "nsubseteqq;": "\u2ac5\u0338",
    "nsucc;": "\u2281",
    "nsucceq;": "\u2ab0\u0338",
    "nsup;": "\u2285",
    "nsupE;": "\u2ac6\u0338",
    "nsupe;": "\u2289",
    "nsupset;": "\u2283\u20d2",
    "nsupseteq;": "\u2289",
    "nsupseteqq;": "\u2ac6\u0338",
    "ntgl;": "\u2279",
    "ntilde": "\u00f1",
    "ntilde;": "\u00f1",
    "ntlg;": "\u2278",
    "ntriangleleft;": "\u22ea",
    "ntrianglelefteq;": "\u22ec",
    "ntriangleright;": "\u22eb",
    "ntrianglerighteq;": "\u22ed",
    "nu;": "\u03bd",
    "num;": "#",
    "numero;": "\u2116",
    "numsp;": "\u2007",
    "nvDash;": "\u22ad",
    "nvHarr;": "\u2904",
    "nvap;": "\u224d\u20d2",
    "nvdash;": "\u22ac",
    "nvge;": "\u2265\u20d2",
    "nvgt;": ">\u20d2",
    "nvinfin;": "\u29de",
    "nvlArr;": "\u2902",
    "nvle;": "\u2264\u20d2",
    "nvlt;": "<\u20d2",
    "nvltrie;": "\u22b4\u20d2",
    "nvrArr;": "\u2903",
    "nvrtrie;": "\u22b5\u20d2",
    "nvsim;": "\u223c\u20d2",
    "nwArr;": "\u21d6",
    "nwarhk;": "\u2923",
    "nwarr;": "\u2196",
    "nwarrow;": "\u2196",
    "nwnear;": "\u2927",
    "oS;": "\u24c8",
    "oacute": "\u00f3",
    "oacute;": "\u00f3",
    "oast;": "\u229b",
    "ocir;": "\u229a",
    "ocirc": "\u00f4",
    "ocirc;": "\u00f4",
    "ocy;": "\u043e",
    "odash;": "\u229d",
    "odblac;": "\u0151",
    "odiv;": "\u2a38",
    "odot;": "\u2299",
    "odsold;": "\u29bc",
    "oelig;": "\u0153",
    "ofcir;": "\u29bf",
    "ofr;": "\ud835\udd2c",
    "ogon;": "\u02db",
    "ograve": "\u00f2",
    "ograve;": "\u00f2",
    "ogt;": "\u29c1",
    "ohbar;": "\u29b5",
    "ohm;": "\u03a9",
    "oint;": "\u222e",
    "olarr;": "\u21ba",
    "olcir;": "\u29be",
    "olcross;": "\u29bb",
    "oline;": "\u203e",
    "olt;": "\u29c0",
    "omacr;": "\u014d",
    "omega;": "\u03c9",
    "omicron;": "\u03bf",
    "omid;": "\u29b6",
    "ominus;": "\u2296",
    "oopf;": "\ud835\udd60",
    "opar;": "\u29b7",
    "operp;": "\u29b9",
    "oplus;": "\u2295",
    "or;": "\u2228",
    "orarr;": "\u21bb",
    "ord;": "\u2a5d",
    "order;": "\u2134",
    "orderof;": "\u2134",
    "ordf": "\u00aa",
    "ordf;": "\u00aa",
    "ordm": "\u00ba",
    "ordm;": "\u00ba",
    "origof;": "\u22b6",
    "oror;": "\u2a56",
    "orslope;": "\u2a57",
    "orv;": "\u2a5b",
    "oscr;": "\u2134",
    "oslash": "\u00f8",
    "oslash;": "\u00f8",
    "osol;": "\u2298",
    "otilde": "\u00f5",
    "otilde;": "\u00f5",
    "otimes;": "\u2297",
    "otimesas;": "\u2a36",
    "ouml": "\u00f6",
    "ouml;": "\u00f6",
    "ovbar;": "\u233d",
    "par;": "\u2225",
    "para": "\u00b6",
    "para;": "\u00b6",
    "parallel;": "\u2225",
    "parsim;": "\u2af3",
    "parsl;": "\u2afd",
    "part;": "\u2202",
    "pcy;": "\u043f",
    "percnt;": "%",
    "period;": ".",
    "permil;": "\u2030",
    "perp;": "\u22a5",
    "pertenk;": "\u2031",
    "pfr;": "\ud835\udd2d",
    "phi;": "\u03c6",
    "phiv;": "\u03d5",
    "phmmat;": "\u2133",
    "phone;": "\u260e",
    "pi;": "\u03c0",
    "pitchfork;": "\u22d4",
    "piv;": "\u03d6",
    "planck;": "\u210f",
    "planckh;": "\u210e",
    "plankv;": "\u210f",
    "plus;": "+",
    "plusacir;": "\u2a23",
    "plusb;": "\u229e",
    "pluscir;": "\u2a22",
    "plusdo;": "\u2214",
    "plusdu;": "\u2a25",
    "pluse;": "\u2a72",
    "plusmn": "\u00b1",
    "plusmn;": "\u00b1",
    "plussim;": "\u2a26",
    "plustwo;": "\u2a27",
    "pm;": "\u00b1",
    "pointint;": "\u2a15",
    "popf;": "\ud835\udd61",
    "pound": "\u00a3",
    "pound;": "\u00a3",
    "pr;": "\u227a",
    "prE;": "\u2ab3",
    "prap;": "\u2ab7",
    "prcue;": "\u227c",
    "pre;": "\u2aaf",
    "prec;": "\u227a",
    "precapprox;": "\u2ab7",
    "preccurlyeq;": "\u227c",
    "preceq;": "\u2aaf",
    "precnapprox;": "\u2ab9",
    "precneqq;": "\u2ab5",
    "precnsim;": "\u22e8",
    "precsim;": "\u227e",
    "prime;": "\u2032",
    "primes;": "\u2119",
    "prnE;": "\u2ab5",
    "prnap;": "\u2ab9",
    "prnsim;": "\u22e8",
    "prod;": "\u220f",
    "profalar;": "\u232e",
    "profline;": "\u2312",
    "profsurf;": "\u2313",
    "prop;": "\u221d",
    "propto;": "\u221d",
    "prsim;": "\u227e",
    "prurel;": "\u22b0",
    "pscr;": "\ud835\udcc5",
    "psi;": "\u03c8",
    "puncsp;": "\u2008",
    "qfr;": "\ud835\udd2e",
    "qint;": "\u2a0c",
    "qopf;": "\ud835\udd62",
    "qprime;": "\u2057",
    "qscr;": "\ud835\udcc6",
    "quaternions;": "\u210d",
    "quatint;": "\u2a16",
    "quest;": "?",
    "questeq;": "\u225f",
    "quot": "\"",
    "quot;": "\"",
    "rAarr;": "\u21db",
    "rArr;": "\u21d2",
    "rAtail;": "\u291c",
    "rBarr;": "\u290f",
    "rHar;": "\u2964",
    "race;": "\u223d\u0331",
    "racute;": "\u0155",
    "radic;": "\u221a",
    "raemptyv;": "\u29b3",
    "rang;": "\u27e9",
    "rangd;": "\u2992",
    "range;": "\u29a5",
    "rangle;": "\u27e9",
    "raquo": "\u00bb",
    "raquo;": "\u00bb",
    "rarr;": "\u2192",
    "rarrap;": "\u2975",
    "rarrb;": "\u21e5",
    "rarrbfs;": "\u2920",
    "rarrc;": "\u2933",
    "rarrfs;": "\u291e",
    "rarrhk;": "\u21aa",
    "rarrlp;": "\u21ac",
    "rarrpl;": "\u2945",
    "rarrsim;": "\u2974",
    "rarrtl;": "\u21a3",
    "rarrw;": "\u219d",
    "ratail;": "\u291a",
    "ratio;": "\u2236",
    "rationals;": "\u211a",
    "rbarr;": "\u290d",
    "rbbrk;": "\u2773",
    "rbrace;": "}",
    "rbrack;": "]",
    "rbrke;": "\u298c",
    "rbrksld;": "\u298e",
    "rbrkslu;": "\u2990",
    "rcaron;": "\u0159",
    "rcedil;": "\u0157",
    "rceil;": "\u2309",
    "rcub;": "}",
    "rcy;": "\u0440",
    "rdca;": "\u2937",
    "rdldhar;": "\u2969",
    "rdquo;": "\u201d",
    "rdquor;": "\u201d",
    "rdsh;": "\u21b3",
    "real;": "\u211c",
    "realine;": "\u211b",
    "realpart;": "\u211c",
    "reals;": "\u211d",
    "rect;": "\u25ad",
    "reg": "\u00ae",
    "reg;": "\u00ae",
    "rfisht;": "\u297d",
    "rfloor;": "\u230b",
    "rfr;": "\ud835\udd2f",
    "rhard;": "\u21c1",
    "rharu;": "\u21c0",
    "rharul;": "\u296c",
    "rho;": "\u03c1",
    "rhov;": "\u03f1",
    "rightarrow;": "\u2192",
    "rightarrowtail;": "\u21a3",
    "rightharpoondown;": "\u21c1",
    "rightharpoonup;": "\u21c0",
    "rightleftarrows;": "\u21c4",
    "rightleftharpoons;": "\u21cc",
    "rightrightarrows;": "\u21c9",
    "rightsquigarrow;": "\u219d",
    "rightthreetimes;": "\u22cc",
    "ring;": "\u02da",
    "risingdotseq;": "\u2253",
    "rlarr;": "\u21c4",
    "rlhar;": "\u21cc",
    "rlm;": "\u200f",
    "rmoust;": "\u23b1",
    "rmoustache;": "\u23b1",
    "rnmid;": "\u2aee",
    "roang;": "\u27ed",
    "roarr;": "\u21fe",
    "robrk;": "\u27e7",
    "ropar;": "\u2986",
    "ropf;": "\ud835\udd63",
    "roplus;": "\u2a2e",
    "rotimes;": "\u2a35",
    "rpar;": ")",
    "rpargt;": "\u2994",
    "rppolint;": "\u2a12",
    "rrarr;": "\u21c9",
    "rsaquo;": "\u203a",
    "rscr;": "\ud835\udcc7",
    "rsh;": "\u21b1",
    "rsqb;": "]",
    "rsquo;": "\u2019",
    "rsquor;": "\u2019",
    "rthree;": "\u22cc",
    "rtimes;": "\u22ca",
    "rtri;": "\u25b9",
    "rtrie;": "\u22b5",
    "rtrif;": "\u25b8",
    "rtriltri;": "\u29ce",
    "ruluhar;": "\u2968",
    "rx;": "\u211e",
    "sacute;": "\u015b",
    "sbquo;": "\u201a",
    "sc;": "\u227b",
    "scE;": "\u2ab4",
    "scap;": "\u2ab8",
    "scaron;": "\u0161",
    "sccue;": "\u227d",
    "sce;": "\u2ab0",
    "scedil;": "\u015f",
    "scirc;": "\u015d",
    "scnE;": "\u2ab6",
    "scnap;": "\u2aba",
    "scnsim;": "\u22e9",
    "scpolint;": "\u2a13",
    "scsim;": "\u227f",
    "scy;": "\u0441",
    "sdot;": "\u22c5",
    "sdotb;": "\u22a1",
    "sdote;": "\u2a66",
    "seArr;": "\u21d8",
    "searhk;": "\u2925",
    "searr;": "\u2198",
    "searrow;": "\u2198",
    "sect": "\u00a7",
    "sect;": "\u00a7",
    "semi;": ";",
    "seswar;": "\u2929",
    "setminus;": "\u2216",
    "setmn;": "\u2216",
    "sext;": "\u2736",
    "sfr;": "\ud835\udd30",
    "sfrown;": "\u2322",
    "sharp;": "\u266f",
    "shchcy;": "\u0449",
    "shcy;": "\u0448",
    "shortmid;": "\u2223",
    "shortparallel;": "\u2225",
    "shy": "\u00ad",
    "shy;": "\u00ad",
    "sigma;": "\u03c3",
    "sigmaf;": "\u03c2",
    "sigmav;": "\u03c2",
    "sim;": "\u223c",
    "simdot;": "\u2a6a",
    "sime;": "\u2243",
    "simeq;": "\u2243",
    "simg;": "\u2a9e",
    "simgE;": "\u2aa0",
    "siml;": "\u2a9d",
    "simlE;": "\u2a9f",
    "simne;": "\u2246",
    "simplus;": "\u2a24",
    "simrarr;": "\u2972",
    "slarr;": "\u2190",
    "smallsetminus;": "\u2216",
    "smashp;": "\u2a33",
    "smeparsl;": "\u29e4",
    "smid;": "\u2223",
    "smile;": "\u2323",
    "smt;": "\u2aaa",
    "smte;": "\u2aac",
    "smtes;": "\u2aac\ufe00",
    "softcy;": "\u044c",
    "sol;": "/",
    "solb;": "\u29c4",
    "solbar;": "\u233f",
    "sopf;": "\ud835\udd64",
    "spades;": "\u2660",
    "spadesuit;": "\u2660",
    "spar;": "\u2225",
    "sqcap;": "\u2293",
    "sqcaps;": "\u2293\ufe00",
    "sqcup;": "\u2294",
    "sqcups;": "\u2294\ufe00",
    "sqsub;": "\u228f",
    "sqsube;": "\u2291",
    "sqsubset;": "\u228f",
    "sqsubseteq;": "\u2291",
    "sqsup;": "\u2290",
    "sqsupe;": "\u2292",
    "sqsupset;": "\u2290",
    "sqsupseteq;": "\u2292",
    "squ;": "\u25a1",
    "square;": "\u25a1",
    "squarf;": "\u25aa",
    "squf;": "\u25aa",
    "srarr;": "\u2192",
    "sscr;": "\ud835\udcc8",
    "ssetmn;": "\u2216",
    "ssmile;": "\u2323",
    "sstarf;": "\u22c6",
    "star;": "\u2606",
    "starf;": "\u2605",
    "straightepsilon;": "\u03f5",
    "straightphi;": "\u03d5",
    "strns;": "\u00af",
    "sub;": "\u2282",
    "subE;": "\u2ac5",
    "subdot;": "\u2abd",
    "sube;": "\u2286",
    "subedot;": "\u2ac3",
    "submult;": "\u2ac1",
    "subnE;": "\u2acb",
    "subne;": "\u228a",
    "subplus;": "\u2abf",
    "subrarr;": "\u2979",
    "subset;": "\u2282",
    "subseteq;": "\u2286",
    "subseteqq;": "\u2ac5",
    "subsetneq;": "\u228a",
    "subsetneqq;": "\u2acb",
    "subsim;": "\u2ac7",
    "subsub;": "\u2ad5",
    "subsup;": "\u2ad3",
    "succ;": "\u227b",
    "succapprox;": "\u2ab8",
    "succcurlyeq;": "\u227d",
    "succeq;": "\u2ab0",
    "succnapprox;": "\u2aba",
    "succneqq;": "\u2ab6",
    "succnsim;": "\u22e9",
    "succsim;": "\u227f",
    "sum;": "\u2211",
    "sung;": "\u266a",
    "sup1": "\u00b9",
    "sup1;": "\u00b9",
    "sup2": "\u00b2",
    "sup2;": "\u00b2",
    "sup3": "\u00b3",
    "sup3;": "\u00b3",
    "sup;": "\u2283",
    "supE;": "\u2ac6",
    "supdot;": "\u2abe",
    "supdsub;": "\u2ad8",
    "supe;": "\u2287",
    "supedot;": "\u2ac4",
    "suphsol;": "\u27c9",
    "suphsub;": "\u2ad7",
    "suplarr;": "\u297b",
    "supmult;": "\u2ac2",
    "supnE;": "\u2acc",
    "supne;": "\u228b",
    "supplus;": "\u2ac0",
    "supset;": "\u2283",
    "supseteq;": "\u2287",
    "supseteqq;": "\u2ac6",
    "supsetneq;": "\u228b",
    "supsetneqq;": "\u2acc",
    "supsim;": "\u2ac8",
    "supsub;": "\u2ad4",
    "supsup;": "\u2ad6",
    "swArr;": "\u21d9",
    "swarhk;": "\u2926",
    "swarr;": "\u2199",
    "swarrow;": "\u2199",
    "swnwar;": "\u292a",
    "szlig": "\u00df",
    "szlig;": "\u00df",
    "target;": "\u2316",
    "tau;": "\u03c4",
    "tbrk;": "\u23b4",
    "tcaron;": "\u0165",
    "tcedil;": "\u0163",
    "tcy;": "\u0442",
    "tdot;": "\u20db",
    "telrec;": "\u2315",
    "tfr;": "\ud835\udd31",
    "there4;": "\u2234",
    "therefore;": "\u2234",
    "theta;": "\u03b8",
    "thetasym;": "\u03d1",
    "thetav;": "\u03d1",
    "thickapprox;": "\u2248",
    "thicksim;": "\u223c",
    "thinsp;": "\u2009",
    "thkap;": "\u2248",
    "thksim;": "\u223c",
    "thorn": "\u00fe",
    "thorn;": "\u00fe",
    "tilde;": "\u02dc",
    "times": "\u00d7",
    "times;": "\u00d7",
    "timesb;": "\u22a0",
    "timesbar;": "\u2a31",
    "timesd;": "\u2a30",
    "tint;": "\u222d",
    "toea;": "\u2928",
    "top;": "\u22a4",
    "topbot;": "\u2336",
    "topcir;": "\u2af1",
    "topf;": "\ud835\udd65",
    "topfork;": "\u2ada",
    "tosa;": "\u2929",
    "tprime;": "\u2034",
    "trade;": "\u2122",
    "triangle;": "\u25b5",
    "triangledown;": "\u25bf",
    "triangleleft;": "\u25c3",
    "trianglelefteq;": "\u22b4",
    "triangleq;": "\u225c",
    "triangleright;": "\u25b9",
    "trianglerighteq;": "\u22b5",
    "tridot;": "\u25ec",
    "trie;": "\u225c",
    "triminus;": "\u2a3a",
    "triplus;": "\u2a39",
    "trisb;": "\u29cd",
    "tritime;": "\u2a3b",
    "trpezium;": "\u23e2",
    "tscr;": "\ud835\udcc9",
    "tscy;": "\u0446",
    "tshcy;": "\u045b",
    "tstrok;": "\u0167",
    "twixt;": "\u226c",
    "twoheadleftarrow;": "\u219e",
    "twoheadrightarrow;": "\u21a0",
    "uArr;": "\u21d1",
    "uHar;": "\u2963",
    "uacute": "\u00fa",
    "uacute;": "\u00fa",
    "uarr;": "\u2191",
    "ubrcy;": "\u045e",
    "ubreve;": "\u016d",
    "ucirc": "\u00fb",
    "ucirc;": "\u00fb",
    "ucy;": "\u0443",
    "udarr;": "\u21c5",
    "udblac;": "\u0171",
    "udhar;": "\u296e",
    "ufisht;": "\u297e",
    "ufr;": "\ud835\udd32",
    "ugrave": "\u00f9",
    "ugrave;": "\u00f9",
    "uharl;": "\u21bf",
    "uharr;": "\u21be",
    "uhblk;": "\u2580",
    "ulcorn;": "\u231c",
    "ulcorner;": "\u231c",
    "ulcrop;": "\u230f",
    "ultri;": "\u25f8",
    "umacr;": "\u016b",
    "uml": "\u00a8",
    "uml;": "\u00a8",
    "uogon;": "\u0173",
    "uopf;": "\ud835\udd66",
    "uparrow;": "\u2191",
    "updownarrow;": "\u2195",
    "upharpoonleft;": "\u21bf",
    "upharpoonright;": "\u21be",
    "uplus;": "\u228e",
    "upsi;": "\u03c5",
    "upsih;": "\u03d2",
    "upsilon;": "\u03c5",
    "upuparrows;": "\u21c8",
    "urcorn;": "\u231d",
    "urcorner;": "\u231d",
    "urcrop;": "\u230e",
    "uring;": "\u016f",
    "urtri;": "\u25f9",
    "uscr;": "\ud835\udcca",
    "utdot;": "\u22f0",
    "utilde;": "\u0169",
    "utri;": "\u25b5",
    "utrif;": "\u25b4",
    "uuarr;": "\u21c8",
    "uuml": "\u00fc",
    "uuml;": "\u00fc",
    "uwangle;": "\u29a7",
    "vArr;": "\u21d5",
    "vBar;": "\u2ae8",
    "vBarv;": "\u2ae9",
    "vDash;": "\u22a8",
    "vangrt;": "\u299c",
    "varepsilon;": "\u03f5",
    "varkappa;": "\u03f0",
    "varnothing;": "\u2205",
    "varphi;": "\u03d5",
    "varpi;": "\u03d6",
    "varpropto;": "\u221d",
    "varr;": "\u2195",
    "varrho;": "\u03f1",
    "varsigma;": "\u03c2",
    "varsubsetneq;": "\u228a\ufe00",
    "varsubsetneqq;": "\u2acb\ufe00",
    "varsupsetneq;": "\u228b\ufe00",
    "varsupsetneqq;": "\u2acc\ufe00",
    "vartheta;": "\u03d1",
    "vartriangleleft;": "\u22b2",
    "vartriangleright;": "\u22b3",
    "vcy;": "\u0432",
    "vdash;": "\u22a2",
    "vee;": "\u2228",
    "veebar;": "\u22bb",
    "veeeq;": "\u225a",
    "vellip;": "\u22ee",
    "verbar;": "|",
    "vert;": "|",
    "vfr;": "\ud835\udd33",
    "vltri;": "\u22b2",
    "vnsub;": "\u2282\u20d2",
    "vnsup;": "\u2283\u20d2",
    "vopf;": "\ud835\udd67",
    "vprop;": "\u221d",
    "vrtri;": "\u22b3",
    "vscr;": "\ud835\udccb",
    "vsubnE;": "\u2acb\ufe00",
    "vsubne;": "\u228a\ufe00",
    "vsupnE;": "\u2acc\ufe00",
    "vsupne;": "\u228b\ufe00",
    "vzigzag;": "\u299a",
    "wcirc;": "\u0175",
    "wedbar;": "\u2a5f",
    "wedge;": "\u2227",
    "wedgeq;": "\u2259",
    "weierp;": "\u2118",
    "wfr;": "\ud835\udd34",
    "wopf;": "\ud835\udd68",
    "wp;": "\u2118",
    "wr;": "\u2240",
    "wreath;": "\u2240",
    "wscr;": "\ud835\udccc",
    "xcap;": "\u22c2",
    "xcirc;": "\u25ef",
    "xcup;": "\u22c3",
    "xdtri;": "\u25bd",
    "xfr;": "\ud835\udd35",
    "xhArr;": "\u27fa",
    "xharr;": "\u27f7",
    "xi;": "\u03be",
    "xlArr;": "\u27f8",
    "xlarr;": "\u27f5",
    "xmap;": "\u27fc",
    "xnis;": "\u22fb",
    "xodot;": "\u2a00",
    "xopf;": "\ud835\udd69",
    "xoplus;": "\u2a01",
    "xotime;": "\u2a02",
    "xrArr;": "\u27f9",
    "xrarr;": "\u27f6",
    "xscr;": "\ud835\udccd",
    "xsqcup;": "\u2a06",
    "xuplus;": "\u2a04",
    "xutri;": "\u25b3",
    "xvee;": "\u22c1",
    "xwedge;": "\u22c0",
    "yacute": "\u00fd",
    "yacute;": "\u00fd",
    "yacy;": "\u044f",
    "ycirc;": "\u0177",
    "ycy;": "\u044b",
    "yen": "\u00a5",
    "yen;": "\u00a5",
    "yfr;": "\ud835\udd36",
    "yicy;": "\u0457",
    "yopf;": "\ud835\udd6a",
    "yscr;": "\ud835\udcce",
    "yucy;": "\u044e",
    "yuml": "\u00ff",
    "yuml;": "\u00ff",
    "zacute;": "\u017a",
    "zcaron;": "\u017e",
    "zcy;": "\u0437",
    "zdot;": "\u017c",
    "zeetrf;": "\u2128",
    "zeta;": "\u03b6",
    "zfr;": "\ud835\udd37",
    "zhcy;": "\u0436",
    "zigrarr;": "\u21dd",
    "zopf;": "\ud835\udd6b",
    "zscr;": "\ud835\udccf",
    "zwj;": "\u200d",
    "zwnj;": "\u200c",
  };
  const C1 = { 128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225, 136: 710, 137: 8240,
    138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216, 146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212,
    152: 732, 153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376 };
  const decode = (s, attribute = false) => (s.indexOf('&') < 0 ? s : s.replace(/&(?:#(?:x([0-9a-f]+)|(\d+));?|([a-z][a-z0-9]{0,31});?)/gi, (whole, hex, num, name, at) => {
    if (name) {
      for (let n = name.length; n > 0; n--) {
        const key = name.slice(0, n) + (n === name.length && whole.endsWith(';') ? ';' : '');
        if (!Object.hasOwn(NAMED, key)) continue;
        const tail = whole.slice(key.length + 1);
        if (attribute && !key.endsWith(';') && /^[a-z0-9=]/i.test(tail || s[at + whole.length] || '')) return whole;
        return NAMED[key] + tail;
      }
      return whole;
    }
    const cp = parseInt(hex || num, hex ? 16 : 10);
    return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(C1[cp] || cp) : '\ufffd';
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
      if (!(k in out)) out[k] = decode(m[2] ?? m[3] ?? m[4] ?? '', true);
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
  const CLASS = /^(ql-indent-[1-8]|ql-align-(left|center|right|justify)|ql-syntax|gz-page-break|gz-rule|gz-footnote)$/;
  const KEEP = { a: ['href'], img: ['src', 'alt', 'width', 'data-display', 'data-align', 'data-caption'], ol: ['data-list', 'data-styles', 'data-continue'], ul: ['data-list', 'data-styles'], li: ['data-list', 'data-start', 'data-gz'], sup: ['data-footnote'],
    td: ['colspan', 'rowspan', 'data-colwidth', 'data-valign'], th: ['colspan', 'rowspan', 'data-colwidth', 'data-valign'], p: ['align', 'data-gz'], div: ['align'], table: ['data-borders'],
    span: ['data-gz-color', 'data-gz-highlight', 'data-gz-caps'], ...Object.fromEntries(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((h) => [h, ['data-gz']])) };

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
      if (!o.paper && (['font', 'small', 'big', 'mark', 'center'].includes(name) || a['data-checked'] != null
        || /^(checked|unchecked)$/.test(a['data-list'] || '')
        || String(a.style || '').split(';').some((rule) => {
          if (!rule.trim()) return false;
          const key = rule.slice(0, rule.indexOf(':')).trim().toLowerCase();
          return !['font-weight', 'font-style', 'text-decoration', 'vertical-align', 'text-align'].includes(key);
        }))) o.lost.add('format');
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
      if (kind === 'img' && !(o.paper && imageSrc(keep.src))) {
        if (o.paper) { o.lost.add('media'); if (keep.alt) add(txt(keep.alt)); }
        continue;
      }
      if (kind === 'img') {
        const src = keep.src;
        o.images += Math.floor((src.length - src.indexOf(',') - 1) * 3 / 4) - (src.endsWith('==') ? 2 : src.endsWith('=') ? 1 : 0);
        if (o.images > MAX_IMAGE_BYTES) limit();
      }
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
  // o.pre (a Word file's text): every space, tab and line break as written, no placeholder to drop.
  const textblock = (e, o) => {
    let items = leaves(e).filter((it) => it.n.nodeType === 3 || ['BR', 'IMG', 'SUP'].includes(it.n.nodeName));
    if (o.pre) return [rebuild(shallow(e), items.map((it) => (it.n.nodeType === 3 ? { ...it, n: txt(it.n.nodeValue.replace(/\u00a0/g, ' ')) } : it)))];
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
      const flush = () => { if (run.some(meaningful)) for (const seg of textblock(el('li', o.paper ? { ...c.attrs } : {}, run), o)) out.push({ ordered: kind, li: blockClass(seg, level, align) }); run = []; };
      for (const n of c.childNodes) {
        if (isInline(n) && !hasBlock(n)) { run.push(n); continue; }
        flush();
        if (n.nodeName === 'UL' || n.nodeName === 'OL') items(n, o, level + 1, out);
        else for (const b of blocks(el('div', {}, [n]), o)) take(b, kind, level, out, o);
      }
      flush();
      if (out.length === start) out.push({ ordered: kind, li: blockClass(el('li', o.paper ? { ...c.attrs } : {}), level, align) });
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
    return out.length ? [el('table', t.getAttribute('data-borders') === 'none' ? { 'data-borders': 'none' } : {}, out)] : [];
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
          const attrs = o.paper && n.nodeName === kind ? listAttrs(n) : {};
          if (out.at(-1)?.nodeName !== kind || o.paper && !['data-styles', 'data-continue'].every((k) => out.at(-1).attrs[k] === attrs[k])) out.push(el(kind.toLowerCase(), attrs));
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
      else if (name === 'HR') { if (o.paper && (classes(n).includes('gz-page-break') || classes(n).includes('gz-rule'))) out.push(n); }
    }
    flush();
    for (let i = out.length - 1; i > 0; i--) {
      if ((out[i].nodeName === 'UL' || out[i].nodeName === 'OL') && out[i].nodeName === out[i - 1].nodeName && (!o.paper || ['data-styles', 'data-continue'].every((k) => out[i].attrs[k] === out[i - 1].attrs[k]))) out[i - 1].childNodes.push(...out.splice(i, 1)[0].childNodes);
    }
    return out;
  };
  const listAttrs = (n) => Object.fromEntries(['data-styles', 'data-continue'].filter((k) => n.getAttribute(k) != null).map((k) => [k, n.getAttribute(k)]));
  const link = (e) => { e.childNodes.forEach((c, i) => { c.parentNode = e; c.index = i; if (c.nodeType === 1) link(c); }); return e; };
  const prepare = (schema, html, opts = {}) => {
    html = String(html ?? '');
    if (html.length > (schema.nodes.page_break && opts.document === true ? MAX_DOCUMENT_INPUT : MAX_INPUT)) limit();
    const o = { paper: !!schema.nodes.page_break, pre: !!schema.nodes.page_break && opts.pre === true, lost: new Set(), cells: 0, images: 0 };
    const root = link(el('body', {}, blocks(tree(html, o), o)));
    return { root, o };
  };
  const parsers = new WeakMap();
  const parser = (schema) => { if (!parsers.has(schema)) parsers.set(schema, DOMParser.fromSchema(schema)); return parsers.get(schema); };

  // HTML → doc. doc (a Document) is accepted for the shared signature and not needed: nothing here reaches a live page.
  // opts.pre: imported whitespace is the file's own. opts.document: a bounded whole-document read (import or backup),
  // with room for pictures up to the 10 MB image cap; clipboard reads keep their smaller input limit.
  const parse = (schema, html, opts) => parser(schema).parse(prepare(schema, html, opts && typeof opts === 'object' && !opts.nodeType ? opts : {}).root, { preserveWhitespace: true });
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
  return { compose, paper: paperSchema, parse, slice, serialize, delta, text, loses, href, imageSrc, inline, MAX_INDENT, MAX_INPUT, MAX_DOCUMENT_INPUT, MAX_IMAGE_BYTES, MAX_TOKENS, MAX_DEPTH, FONTS, HIGHLIGHT, dataGz: writeGz, readGz, html: { tags, attrs: attrsOf, decode, fontOf, sizeOf, inches } };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_SCHEMA; else GZ_WRITER_SCHEMA;
