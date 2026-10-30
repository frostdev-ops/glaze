// Glaze Writer's document thumbnails: page 1 of a paper, drawn small from its stored ProseMirror JSON and format, for the
// Documents home's cards and the New band's format tiles. firstPage() cuts the JSON to what page 1 can show (pure);
// render() builds the page as the editor does (the format's geometry, running header and paragraph CSS, the body through
// the paper schema's DOMSerializer, the editor's own class names so writer-paper.css styles it) and scales it down. No
// canvas, no measuring, no timers: each format's page CSS goes once into an adopted sheet, scoped to its own class.
// Classic script after lib/pm.js, lib/writer-schema.js and lib/writer-styles.js; module.exports for node.
var GZ_WRITER_THUMB = globalThis.GZ_WRITER_THUMB || (() => {
  const ST = () => (typeof GZ_WRITER_STYLES !== 'undefined' ? GZ_WRITER_STYLES : require('./writer-styles.js'));
  const S = () => (typeof GZ_WRITER_SCHEMA !== 'undefined' ? GZ_WRITER_SCHEMA : require('./writer-schema.js'));
  const FMT = () => (typeof GZ_WRITER_FORMAT !== 'undefined' ? GZ_WRITER_FORMAT : typeof require === 'function' ? require('./writer-format.js') : null);
  const PM = () => (S(), globalThis.GZ_PM);

  // ---- page 1's content
  const MAX_SRC = 200 * 1024, BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  // Top-level blocks up to the first page break, at most `blocks` of them, their text cut to `chars` in all. A container
  // keeps its first child whatever is left, so every node stays valid for the paper schema; a cut drops what follows it.
  const firstPage = (docJSON, limits = { blocks: 40, chars: 3000 }) => {
    const { blocks = 40, chars = 3000 } = limits || {};
    let left = chars;
    const inline = (n) => {
      if (n.type === 'text') {
        let text = String(n.text || '').slice(0, Math.max(0, left));
        if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
        left -= text.length;
        return text ? (text === n.text ? n : { ...n, text }) : null;
      }
      if (n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src.length > MAX_SRC) return { ...n, attrs: { ...n.attrs, src: BLANK } };
      return n;
    };
    const block = (n) => {
      if (!Array.isArray(n?.content)) return n;
      const out = [];
      const textblock = n.content.some((c) => c && (c.type === 'text' || c.type === 'image' || c.type === 'hard_break' || c.type === 'footnote_ref'));
      for (const c of n.content) {
        if (left <= 0 && (textblock || out.length)) break;
        const k = textblock ? inline(c) : block(c);
        if (k) out.push(k);
      }
      return out.length === n.content.length && out.every((k, i) => k === n.content[i]) ? n : { ...n, content: out };
    };
    const out = [];
    for (const n of Array.isArray(docJSON?.content) ? docJSON.content : []) {
      if (!n || n.type === 'page_break' || out.length >= blocks || (left <= 0 && out.length)) break;
      out.push(block(n));
    }
    return { type: 'doc', ...(docJSON?.attrs ? { attrs: docJSON.attrs } : {}), content: out.length ? out : [{ type: 'paragraph' }] };
  };

  // ---- the page's CSS: GZ_WRITER_STYLES.css for the look, each selector under the look's class at no extra specificity,
  // so the rules meet writer-paper.css's exactly as the editor's adopted sheet does.
  const sheets = new WeakMap();
  const classFor = (doc, look) => {
    let s = sheets.get(doc);
    if (!s) {
      const C = doc.defaultView?.CSSStyleSheet || globalThis.CSSStyleSheet;
      const sheet = typeof C === 'function' && 'replaceSync' in C.prototype && Array.isArray(doc.adoptedStyleSheets) ? new C() : null;
      if (sheet) doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      s = { sheet, el: null, keys: new Map() };
      sheets.set(doc, s);
    }
    const css = ST().css(look);
    if (s.keys.has(css)) return s.keys.get(css);
    const cls = `gt-l${s.keys.size}`;
    s.keys.set(css, cls);
    const rules = css.split('\n').map((r) => {
      const at = r.indexOf('{');
      return `${r.slice(0, at).split(',').map((x) => (x.trim().startsWith('.gp-sheet') ? `:where(.${cls})${x.trim()}` : `:where(.${cls}) ${x.trim()}`)).join(', ')} ${r.slice(at)}`;
    });
    if (s.sheet) for (const r of rules) s.sheet.insertRule(r, s.sheet.cssRules.length);
    else if (doc.head) { s.el ||= doc.head.appendChild(doc.createElement('style')); s.el.append(doc.createTextNode(rules.join('\n'))); }
    return cls;
  };

  // ---- the page
  const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  // An imported header's or footer's paragraphs (lib/writer-styles.js headerParts), as writer-paper.js draws them; a tab
  // stays a tab character (laying stops out would need measuring).
  const parts = (doc, list, cls, L) => {
    const box = el(doc, 'div', cls);
    for (const x of list) {
      const p = el(doc, 'div', 'gp-part');
      p.style.cssText = `text-align:${x.align || 'left'};line-height:${ST().lineHeight(L, { line: x.line, exact: x.exact, least: x.least })}px;margin:${x.before || 0}pt 0 ${x.after || 0}pt;padding:0 ${x.right || 0}in 0 ${x.left || 0}in;text-indent:${x.first || 0}in`;
      for (const r of x.runs) {
        const run = el(doc, 'span', '', r.text);
        run.style.cssText = [r.b ? 'font-weight:700' : '', r.i ? 'font-style:italic' : '', r.u || r.s ? `text-decoration:${[r.u ? 'underline' : '', r.s ? 'line-through' : ''].join(' ')}` : '', r.sup ? 'vertical-align:super;font-size:.66em' : r.sub ? 'vertical-align:sub;font-size:.66em' : '', r.font ? `font-family:${ST().stack(r.font)}` : '', r.size ? `font-size:${r.size}pt` : '', r.color ? `color:#${r.color}` : ''].filter(Boolean).join(';');
        p.append(run);
      }
      box.append(p);
    }
    return box;
  };
  // What lib/writer-paginate.js's styler decorates the editor's blocks with: a block's own spacing as Word counts it in px,
  // and the list page's entries.
  const dress = (L, n, dom, where = {}) => {
    if (!dom || dom.nodeType !== 1) return;
    if (where.entry) dom.setAttribute('class', [dom.getAttribute('class'), 'gp-entry'].filter(Boolean).join(' '));
    if (n.isTextblock) {
      // An empty line holds its height, and a closing line break its line, as in the editor (and serialize's HTML).
      if (!n.content.size || n.lastChild?.type.name === 'hard_break') dom.appendChild(dom.ownerDocument.createElement('br'));
      if (n.attrs.line != null || n.attrs.exact != null || n.attrs.least != null) dom.style.lineHeight = `${ST().blockBox(L, n.attrs, where).line}px`;
      return;
    }
    const quote = n.type.name === 'blockquote', kids = n.type.name === 'table' ? dom.children[0]?.children : dom.children;
    if (kids) n.forEach((c, _, i) => dress(L, c, kids[i], { quote: quote || where.quote }));
  };

  // doc: a paper's JSON (or Node); format: what the record stores (an id or a preset) or a format. opts: { scale (0.25),
  // surname (MLA's header name; read from the heading when missing), document }.
  const render = (doc, format, opts = {}) => {
    const d = opts.document || globalThis.document, scale = opts.scale ?? 0.25, schema = S().paper;
    const json = firstPage(doc && typeof doc.toJSON === 'function' && doc.type?.schema ? doc.toJSON() : doc);
    let node;
    try { node = schema.nodeFromJSON(json); } catch { node = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] }); }
    const L = ST().look(ST().get(format), node.attrs.setup), g = ST().geometry(L);
    const page = el(d, 'div', `gt-page gp-sheet ${classFor(d, L)}`);
    Object.assign(page.style, { width: `${g.width}px`, height: `${g.height}px`, transform: `scale(${scale})`, transformOrigin: 'top left' });
    const head = ST().headerParts(L, 1);
    if (head) { if (head.length) page.append(parts(d, head, 'gp-hdr', L)); }
    else {
      let surname = opts.surname;
      if (surname == null) { try { surname = FMT()?.surname(json, L) || ''; } catch { surname = ''; } }
      const text = ST().headerText(L, 1, surname);
      if (text) page.append(el(d, 'div', 'gp-hdr', text));
    }
    const foot = L.setup ? ST().footerParts(L, 1) : null;
    if (foot?.length) page.append(parts(d, foot, 'gp-ftr', L));
    const body = el(d, 'div', 'ProseMirror'), flow = el(d, 'div', 'gp-flow');
    Object.assign(flow.style, { left: `${g.left}px`, top: `${g.top}px`, width: `${g.content}px`, height: `${g.body}px` });
    const ser = PM().model.DOMSerializer.fromSchema(schema), list = ST().listAt(json);
    node.forEach((n, _, i) => {
      const dom = ser.serializeNode(n, { document: d });
      body.append(dom);
      dress(L, n, dom, { entry: !!list && i >= list.from && i < list.to && n.type.name === 'paragraph' });
    });
    for (const img of body.querySelectorAll('img')) { img.setAttribute('decoding', 'async'); img.setAttribute('loading', 'lazy'); }
    flow.append(body);
    page.append(flow);
    const thumb = el(d, 'div', 'gt-thumb');
    thumb.setAttribute('aria-hidden', 'true');
    Object.assign(thumb.style, { width: `${Math.round(g.width * scale * 100) / 100}px`, height: `${Math.round(g.height * scale * 100) / 100}px` });
    thumb.append(page);
    return thumb;
  };

  // The New band's tile for a format: a new paper's page 1 (values: name, instructor, course, date, title…; '' leaves a line empty).
  const tile = (format, values = {}, opts = {}) => {
    const f = ST().get(format);
    return render(FMT().template(f, values), f, opts);
  };

  return { firstPage, render, tile, MAX_SRC, BLANK };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_THUMB; else GZ_WRITER_THUMB;
