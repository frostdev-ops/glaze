// Instant copies of Blackboard Ultra's slow pages (enhance.instant, on by default): Grades, the Courses list and Activity,
// and a course's Course Content, Announcements and Gradebook (each per course), open from the student's last visit while
// Ultra builds them; courses/page/instant.js paints, swaps and keeps them.
// A copy is Ultra's own view of its main area rebuilt through an allowlist: a few tags (others become a div or span; a
// button its label), classes, text, aria-hidden, same-origin links, icons and course banners from the site or Ultra's CDN.
// Never ids, handlers, styles with addresses, forms, fields, frames, scripts, shadow roots, Glaze's own parts or a peek panel. Kept as nested lists,
// never markup ([tag, class, attrs, ...children], a child a string of text or another node), and checked again as it's
// rebuilt with createElement, so a stored copy can't put anything else on the page. Bounded in bytes and nodes.
var GZ_INSTANT_LIB = globalThis.GZ_INSTANT_LIB || (() => {
  const ROUTES = { grades: /^\/ultra\/grades\/?$/, courses: /^\/ultra\/course\/?$/, stream: /^\/ultra\/stream\/?$/,
    // A course's own pages, kept per course. Not its Calendar: what that shows depends on the day.
    outline: /^\/ultra\/courses\/(_\d+_\d+)\/outline\/?$/, announcements: /^\/ultra\/courses\/(_\d+_\d+)\/announcements\/?$/, gradebook: /^\/ultra\/courses\/(_\d+_\d+)\/grades\/?$/ };
  const COURSE = new Set(['outline', 'announcements', 'gradebook']);
  const kindOf = (path) => Object.keys(ROUTES).find((k) => ROUTES[k].test(String(path || ''))) || '';
  // The course a course page's address is of; '' for any other page.
  const courseOf = (path) => { const k = kindOf(path); return COURSE.has(k) ? ROUTES[k].exec(String(path))[1] : ''; };
  const MAX_BYTES = 200000, MAX_NODES = 4000, MAX_DEPTH = 120, MAX_TEXT = 2000, MAX_AGE = 30 * 864e5, VERSION = 1;
  const ID = /^_\d+_\d+$/;
  // ultraCopy:<origin>/<uid>/<kind>: one copy per page kind, per site and student; a course's pages one per course,
  // ultraCopy:<origin>/<uid>/<kind>/<course> (purged and bounded by background/background.js).
  const key = (origin, uid, kind, course = '') => `ultraCopy:${origin}/${uid}/${kind}${course ? `/${course}` : ''}`;

  // Ultra's ready markers (glaze-plans/perf-ultra/0b/baseline.md, live-shapes-2026-10-31.md): each names a custom element or
  // an id a copy never has.
  const own = (el) => !!el.closest?.('#gz-instant');
  const live = (root, sel) => [...root.querySelectorAll(sel)].filter((e) => !own(e));
  const READY = {
    // Every course's tile has its recent and upcoming rows, or says it has none.
    grades: (root) => {
      const tiles = live(root, 'bb-base-grades-student .base-grades-course-tile');
      return tiles.length > 0 && tiles.every((t) => t.querySelector('.recent-upcoming .element-card, .base-grades-empty-state'));
    },
    courses: (root) => live(root, 'div.default-group bb-base-course-card > article.course-element-card .js-course-title-element').length > 0,
    stream: (root) => live(root, '#activity-stream .activity-feed > li.stream-item-container .stream-item').length > 0,
    // A course's: its outline's items in Ultra's React list, its announcements' rows, its gradebook's rows (not the head row).
    outline: (root) => live(root, 'react-course-content-outline div.root.content-list-item').length > 0,
    announcements: (root) => live(root, 'announcement-list table.table-content tbody > tr.announcement-item-row').length > 0,
    gradebook: (root) => live(root, 'course-student-grades table.MuiTable-root tbody > tr.MuiTableRow-root').some((r) => !String(r.className).includes('MuiTableRow-head')),
  };
  const ready = (kind, root) => !!root && !!READY[kind]?.(root);
  // An error, or nothing to show: an alert in the main area, or an empty state that isn't one course's tile. Not seen live
  // (the baseline has only the ready markers), so it takes one with words in it: a guess that can only take the copy away early.
  const failed = (root) => !!root && live(root, '[role="alert"], [class*="empty-state"], [class*="no-results"]').some((e) => !e.closest('.base-grades-course-tile') && !!e.textContent.trim());

  // ---- the allowlist ----
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TAGS = new Set(['div', 'span', 'ul', 'li', 'h2', 'h3', 'h4', 'a', 'article', 'section', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td']);
  const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect']);
  // Dropped with everything in them. A button isn't: its label stays, as a span (a folder's title on Course Content is one).
  const DROP = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'select', 'textarea', 'option', 'optgroup', 'datalist', 'output', 'canvas', 'video', 'audio', 'source', 'track', 'picture', 'map', 'area', 'dialog', 'slot', 'portal', 'math', 'br', 'hr', 'wbr', 'base', 'title', 'head']);
  // Laid out as blocks: rebuilt as a div. Any other element (inline ones, custom elements, which are inline until styled) as a span.
  const BLOCK = new Set(['p', 'h1', 'h5', 'h6', 'header', 'footer', 'nav', 'aside', 'main', 'figure', 'figcaption', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'address', 'caption', 'details', 'summary', 'fieldset', 'legend']);
  const CLASS = /^[A-Za-z_][\w-]{0,79}$/;
  // Glaze's own colour tags from its sweep (content.js TAGS), so a dark Look draws the copy as it drew the page.
  const TINTS = ['data-gz-light', 'data-gz-dark', 'data-gz-lift', 'data-gz-brand-bg', 'data-gz-brand-fg'];
  const NUM = /^-?[\d.]+(?:px|em|rem|%)?$/;
  const PAINT = /^(?:none|currentColor|#[\da-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\))$/i;
  const SVG_ATTRS = {
    svg: { viewBox: /^[\d\s.,-]{1,60}$/, width: NUM, height: NUM, fill: PAINT, stroke: PAINT },
    g: { fill: PAINT, stroke: PAINT, 'fill-rule': /^(?:nonzero|evenodd)$/, transform: /^[a-z\d\s().,-]{1,100}$/i },
    path: { d: /^[MmLlHhVvCcSsQqTtAaZz\d\s.,eE+-]{1,6000}$/, fill: PAINT, stroke: PAINT, 'fill-rule': /^(?:nonzero|evenodd)$/, 'clip-rule': /^(?:nonzero|evenodd)$/, 'stroke-width': NUM, transform: /^[a-z\d\s().,-]{1,100}$/i },
    circle: { cx: NUM, cy: NUM, r: NUM, fill: PAINT, stroke: PAINT, 'stroke-width': NUM },
    rect: { x: NUM, y: NUM, width: NUM, height: NUM, rx: NUM, ry: NUM, fill: PAINT, stroke: PAINT, 'stroke-width': NUM },
  };
  // Inline styles keep only colours and sizes (a course's colour, a progress bar's width): never an address or a variable.
  const STYLE_PROPS = new Set(['color', 'background-color', 'border-color', 'border-left-color', 'border-inline-start-color', 'border-top-color', 'width', 'height', 'min-height']);
  const STYLE_VALUE = /^(?:#[\da-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|-?[\d.]+(?:px|em|rem|%|vh|vw)?)$/i;
  const style = (s) => {
    const out = [];
    for (const decl of String(s || '').slice(0, 600).split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const k = decl.slice(0, i).trim().toLowerCase(), v = decl.slice(i + 1).trim().replace(/\s*!important$/i, '');
      if (STYLE_PROPS.has(k) && STYLE_VALUE.test(v)) out.push(`${k}: ${v}`);
    }
    return out.join('; ');
  };
  const classes = (c) => {
    const list = String(c || '').split(/\s+/).filter((x) => CLASS.test(x) && !x.startsWith('gz-') && !x.startsWith('ng-'));
    let n = 0;
    return list.filter((x) => (n += x.length + 1) <= 400).join(' ');
  };
  // A site address of the page, as a path (Ultra's <base href> is its CDN, so a relative link would leave the site).
  const sitePath = (href, origin) => {
    const h = String(href || '').trim();
    let p = null;
    if (/^\/(?!\/)/.test(h)) p = h;
    else { try { const u = new URL(h); if (u.origin === origin) p = u.pathname + u.search + u.hash; } catch { /* not an address */ } }
    return p && p.length <= 600 && !/[\s<>"'\\]/.test(p) ? p : null;
  };
  // A course banner's picture from the site or Ultra's CDN, over https, never data:.
  const picture = (src, { origin, cdn, base }) => {
    try {
      const u = new URL(String(src || ''), base || origin);
      return u.protocol === 'https:' && (u.origin === origin || (cdn && u.origin === cdn)) && u.href.length <= 1000 ? u.href : null;
    } catch { return null; }
  };
  // The attributes an element keeps, by its rebuilt tag; get(name) reads the live element's or the stored record's.
  const attrs = (tag, get, ctx, banner) => {
    const out = {};
    const hidden = get('aria-hidden');
    if (hidden === 'true' || hidden === 'false') out['aria-hidden'] = hidden;
    if (tag === 'a') { const p = sitePath(get('href'), ctx.origin); if (p) out.href = p; }
    if (tag === 'img') { const s = banner && picture(get('src'), ctx); if (!s) return null; out.src = s; }
    const rules = SVG_ATTRS[tag];
    if (rules) for (const [k, re] of Object.entries(rules)) { const v = get(k); if (v != null && re.test(v) && !/url\s*\(/i.test(v)) out[k] = v; }
    else {
      const st = style(get('style'));
      if (st) out.style = st;
      for (const k of TINTS) { const v = get(k); if (v != null && /^[\w -]{0,32}$/.test(v)) out[k] = v; }
    }
    return out;
  };
  // Glaze's own: its ids, an element whose every class is Glaze's, and what its features hide.
  const glazes = (el, cls) => (el.getAttribute('id') || '').startsWith('gz-')
    || (cls.length > 0 && cls.every((c) => c.startsWith('gz-'))) || el.hasAttribute('data-gz-stream-hidden') || el.hasAttribute('data-gz-stream-empty');
  const skipped = (el, cls) => el.hidden || el.hasAttribute('hidden') || cls.includes('peek') || cls.includes('ng-hide') || glazes(el, cls);

  // root's children as a copy: { nodes, full } (full: cut short at a bound). ctx: { origin, cdn, base }.
  const capture = (root, ctx) => {
    let count = 0, bytes = 0, full = false;
    const text = (s) => {
      const t = String(s || '').replace(/\s+/g, ' ').slice(0, MAX_TEXT);
      if (!t) return null;
      if (bytes + t.length + 3 > MAX_BYTES) { full = true; return null; }
      bytes += t.length + 3;
      return t;
    };
    const walk = (el, depth, svg, banner) => {
      const local = String(el.localName || el.tagName || '').toLowerCase();
      if (!local || DROP.has(local) || depth > MAX_DEPTH) return null;
      const cls = String(el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      if (skipped(el, cls)) return null;
      let tag;
      if (svg || local === 'svg') { if (!SVG_TAGS.has(local)) return null; tag = local; }
      else tag = TAGS.has(local) ? local : BLOCK.has(local) ? 'div' : 'span';
      const inBanner = banner || cls.includes('course-banner');
      // An icon sized by Ultra's styles keeps its size: a course page's React styles come only as Ultra draws it.
      let box;
      const size = (k) => { box ||= el.getBoundingClientRect?.() || {}; return box[k] > 0 ? String(Math.round(box[k])) : null; };
      const a = attrs(tag, (k) => el.getAttribute(k) ?? (tag === 'svg' && (k === 'width' || k === 'height') ? size(k) : null), ctx, inBanner);
      if (!a) return null;
      if (count >= MAX_NODES || bytes + 600 >= MAX_BYTES) { full = true; return null; }
      count += 1;
      const c = svg || tag === 'svg' ? cls.filter((x) => CLASS.test(x)).join(' ').slice(0, 200) : classes(cls.join(' '));
      const node = [tag, c, Object.keys(a).length ? a : 0];
      bytes += tag.length + c.length + JSON.stringify(a).length + 12;
      if (tag !== 'img') for (const k of el.childNodes || []) {
        const n = k.nodeType === 3 ? (svg || tag === 'svg' ? null : text(k.data ?? k.textContent)) : k.nodeType === 1 ? walk(k, depth + 1, svg || tag === 'svg', inBanner) : null;
        if (n != null) node.push(n);
        if (full) break;
      }
      return node;
    };
    const nodes = [];
    for (const k of root?.childNodes || []) {
      const n = k.nodeType === 3 ? text(k.data ?? k.textContent) : k.nodeType === 1 ? walk(k, 0, false, false) : null;
      if (n != null && !(typeof n === 'string' && !n.trim())) nodes.push(n);
      if (full) break;
    }
    // The estimate runs ahead of JSON's length; this is the bound.
    if (JSON.stringify(nodes).length > MAX_BYTES) return null;
    return nodes.length ? { nodes, full } : null;
  };

  // A stored copy for this student and page (and course), or null: right shape, this kind, student and course, not older
  // than a month.
  const usable = (rec, uid, kind, course = '', now = Date.now()) => !!rec && typeof rec === 'object' && rec.v === VERSION && ID.test(uid) && rec.uid === uid && rec.kind === kind
    && (COURSE.has(kind) ? ID.test(course) && rec.course === course : rec.course === undefined && !course)
    && Number.isFinite(rec.at) && now - rec.at < MAX_AGE && rec.at <= now + 60000 && Array.isArray(rec.nodes);

  // The copy's nodes into parent, through the same allowlist; text only ever as text. → how many elements it made.
  const build = (doc, parent, nodes, ctx) => {
    let count = 0, bytes = 0;
    const put = (into, n, depth, svg, banner) => {
      if (count >= MAX_NODES || bytes >= MAX_BYTES) return;
      if (typeof n === 'string') { if (svg) return; const t = n.slice(0, MAX_TEXT); bytes += t.length; into.append(t); return; }
      if (!Array.isArray(n) || depth > MAX_DEPTH) return;
      const [tag, cls, a] = n;
      const inSvg = svg || tag === 'svg';
      if (typeof tag !== 'string' || !(inSvg ? SVG_TAGS.has(tag) : TAGS.has(tag))) return;
      const c = inSvg ? String(cls || '').split(/\s+/).filter((x) => CLASS.test(x)).join(' ').slice(0, 200) : classes(cls);
      const inBanner = banner || c.split(' ').includes('course-banner');
      const get = (k) => (a && typeof a === 'object' && Object.hasOwn(a, k) && typeof a[k] === 'string' ? a[k] : null);
      const ok = attrs(tag, get, ctx, inBanner);
      if (!ok) return;
      const el = inSvg ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag);
      if (c) el.setAttribute('class', c);
      // Styles through the CSSOM, which a page's policy on style attributes doesn't refuse.
      for (const [k, v] of Object.entries(ok)) {
        if (k === 'style') for (const d of v.split('; ')) { const i = d.indexOf(': '); el.style.setProperty(d.slice(0, i), d.slice(i + 2)); }
        else el.setAttribute(k, k === 'href' ? ctx.origin + v : v);
      }
      if (tag === 'img') { el.setAttribute('alt', ''); el.setAttribute('loading', 'eager'); }
      count += 1;
      bytes += tag.length + c.length + 8;
      if (tag !== 'img') for (let i = 3; i < n.length; i++) put(el, n[i], depth + 1, inSvg, inBanner);
      into.append(el);
    };
    for (const n of Array.isArray(nodes) ? nodes : []) put(parent, n, 0, false, false);
    return count;
  };

  return { ROUTES, COURSE, kindOf, courseOf, key, ready, failed, capture, build, usable, MAX_BYTES, MAX_NODES, MAX_AGE, VERSION, ID };
})();

if (typeof module !== 'undefined') module.exports = GZ_INSTANT_LIB; else GZ_INSTANT_LIB;
