// Course tabs on Canvas and Blackboard Ultra: what features/coursetabs.js decides without the page, so node can test it. Which
// addresses a tab may go back to, the tab list's edits, and the sketches a tab's stand-in is drawn from.
// Classic script; module.exports for node. Loaded on demand (each site asks for it before features/coursetabs.js);
// the editor and the worker load it too. A second injection keeps the first.
var GZ_CTABS_LIB = globalThis.GZ_CTABS_LIB || (() => {
  // A frame-only injection may land after navigation, before this document's bootstrap.
  if (typeof GZ_SPEC === 'undefined' && typeof module === 'undefined') return null;

  // Its settings (storage.sync `tabs`; the switch is enhance.tabs), added to GZ_SPEC from here so the first content script
  // carries only the switch. at: the strip above the course's top bar, between its two rows, or below it; nav: no strip,
  // only Glaze's own navigation's tabs (the strip's `above` where that bar doesn't hold them); auto (the default): nav where
  // that bar is a top bar holding them, else above (GZ_TABS_AUTO). cap: how many
  // tabs before the least recently used unpinned one closes. place: a tab goes back to where it was. The rest is the tab
  // buttons' look; color: none, a tint of each course's colour, or more of it.
  const SPEC = {
    at: ['auto', ['auto', 'above', 'between', 'below', 'nav']], cap: [8, [2, 20]], place: [true, 'bool'],
    shape: ['tab', ['tab', 'rounded', 'pill', 'square']], size: ['medium', ['small', 'medium', 'large']], width: [180, [96, 320]],
    label: ['short', ['short', 'name', 'code']], mark: ['dot', ['dot', 'icon', 'none']], color: ['off', ['off', 'tint', 'theme']],
  };
  (typeof GZ_SPEC !== 'undefined' ? GZ_SPEC : require('../defaults.js').GZ_SPEC).tabs = SPEC;

  const ID = /^(?:_\d+_\d+|\d+)$/;
  const validId = (id, site) => typeof id === 'string' && id.length <= 80 && (site === 'canvas' ? /^\d+$/ : site === 'ultra' ? /^_\d+_\d+$/ : ID).test(id);
  const rootOf = (cid) => /^\d+$/.test(cid) ? `/courses/${cid}` : `/ultra/courses/${cid}`;
  const homeOf = (cid) => rootOf(cid) + (/^\d+$/.test(cid) ? '' : '/outline');
  const owns = (path, cid) => typeof path === 'string' && validId(cid) && (path === rootOf(cid) || path.startsWith(`${rootOf(cid)}/`));
  // Redirects carry the course in their query rather than their path. Reject conflicting identifiers.
  const courseOf = (path, search = '') => {
    const direct = typeof path === 'string' && path.match(/^\/ultra\/courses\/(_\d+_\d+)(?:\/|$)/);
    if (direct) return safe(path, search) && direct[1];
    if (path !== '/ultra/redirect') return null;
    const q = new URLSearchParams(search), ids = ['courseId', 'course_id'].flatMap((k) => q.getAll(k));
    return ids.length && validId(ids[0], 'ultra') && ids.every((id) => id === ids[0]) ? ids[0] : null;
  };
  // Common term/section wrappers, without a school's particular subject list. A doubtful result keeps the full name.
  const shortName = (name) => {
    const full = String(name || '').trim();
    if (full.length > 200) return full;
    const term = '(?:\\d{4}(?:\\d{2})?|(?:FA|SP|SU|WI)\\d{2}(?:\\d{2})?|\\d{4}(?:FA|SP|SU|WI)|(?:Fall|Autumn|Spring|Summer|Winter)\\s*\\d{4})';
    let s = full;
    for (let n = 0; n < 2; n++) {
      s = s.replace(new RegExp(`^[([]?${term}[)\\]]?(?:[\\s_/-]+|$)`, 'i'), '')
        .replace(new RegExp(`(?:[\\s_/-]+|^)[([]?${term}[)\\]]?$`, 'i'), '');
      const section = s.match(/^(.*?)(?:[.-]\d{1,3}|\s+(?:Section|Sec\.?)\s*\d+)$/i);
      if (section && /[a-z]/i.test(section[1]) && (/\d/.test(section[1]) || /\bSec(?:tion)?\.?\s*\d+$/i.test(s))) s = section[1].trim();
    }
    s = s.replace(/\b([a-z]{1,8})(\d{2,5}[a-z]?)\b/gi, '$1 $2').trim();
    return s && /[a-z]/i.test(s) ? s : full;
  };
  // ---- where a tab may go back to ----------------------------------------------------------------------------
  // Any page of its own course, exactly as it was (path and query), like a browser tab: an item, an assignment, a
  // discussion, a test's page, a tool. Only the address's shape is checked: the course's own path, plain path characters,
  // a bounded length. Going back opens what was open; it never presses anything there.
  const TOOLS = ['outline', 'calendar', 'announcements', 'engagement', 'grades', 'messages', 'groups/enrollments', 'achievements'];
  const PAGE = /^(?:\/ultra\/courses\/_\d+_\d+\/[\w\-./]*|\/courses\/\d+(?:\/(?:[\w\-./]|%[0-9a-fA-F]{2})*)?)$/;
  // The path (and its query) if a tab may go back there, else null.
  const safe = (path, search = '') => {
    if (typeof path !== 'string' || path.length > 600 || !PAGE.test(path) || /(^|\/)\.\.?(\/|$)|\/\//.test(path)) return null;
    // Canvas page slugs may contain encoded spaces or Unicode. Keep the original URL, but never accept an
    // encoded traversal, separator or control character (nor a second layer of percent escapes).
    if (path.startsWith('/courses/') && path.includes('%')) {
      try { if (path.split('/').some((s) => { const d = decodeURIComponent(s); return d === '.' || d === '..' || /[/\\%\x00-\x1f\x7f]/.test(d); })) return null; }
      catch { return null; }
    }
    const q = typeof search === 'string' ? search.replace(/^\?/, '') : '';
    return q && q.length <= 600 ? `${path}?${q}` : path;
  };
  // A Canvas page outside a course, for the frame those open in (features/coursetabs.js): a plain path of this site, no
  // traversal, doubled slash or escaped separator, nor a course's page (those are safe's).
  const outside = (path, search = '') => {
    if (typeof path !== 'string' || path.length > 600 || !/^\/(?:[\w\-.~/]|%[0-9a-fA-F]{2})*$/.test(path) || /(^|\/)\.\.?(\/|$)|\/\/|%(?:2[eEfF]|5[cC]|25)/.test(path) || /^\/courses\/\d+(?:[/?]|$)/.test(path)) return null;
    const q = typeof search === 'string' ? search.replace(/^\?/, '') : '';
    return q && q.length <= 600 ? `${path}?${q}` : path;
  };
  // A course page's tool, or its outline: where a page that isn't safe goes back to.
  const back = (path) => {
    const canvas = typeof path === 'string' && path.match(/^\/courses\/(\d+)(?:[/?#]|$)/);
    if (canvas) return `/courses/${canvas[1]}`;
    const m = typeof path === 'string' && path.match(/^\/ultra\/courses\/(_\d+_\d+)\/([^/?#]+)(?:\/([^/?#]+))?/);
    if (!m) return null;
    const tool = TOOLS.find((x) => x === m[2] || x === `${m[2]}/${m[3]}`) || (m[2] === 'groups' ? 'groups/enrollments' : 'outline');
    return `/ultra/courses/${m[1]}/${tool}`;
  };
  // What a course page is to its tab: { path, exact } (exact: the page itself, so its scroll means something there).
  const placeOf = (path, search) => { const p = safe(path, search); return { path: p || back(path), exact: !!p }; };
  // Where a click on tab `t` goes: its remembered place when that's still safe and in its own course, else its outline.
  const target = (t, remember = true) => {
    const s = String(remember && t.path || ''), i = s.indexOf('?'), p = i < 0 ? s : s.slice(0, i);
    return (owns(p, t.cid) && safe(p, i < 0 ? '' : s.slice(i + 1))) || homeOf(t.cid);
  };

  // ---- the tab list -------------------------------------------------------------------------------------------
  // [{ cid, name, code, pin, at (last used), path (a safe place, or its tool), top (scroll there) }], pinned first.
  // A hard memory bound, including pinned tabs.
  const MAX = 40;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const num = (v, max) => (Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0);
  const order = (list) => [...list.filter((x) => x.pin), ...list.filter((x) => !x.pin)];
  const clean = (raw, site) => {
    const out = [];
    for (const x of Array.isArray(raw) ? raw : []) {
      if (!x || !validId(x.cid, site) || out.length >= MAX || out.some((y) => y.cid === x.cid)) continue;
      const path = target({ cid: x.cid, path: str(x.path, 1300) });
      out.push({ cid: x.cid, name: str(x.name, 200), code: str(x.code, 80), pin: x.pin === true, at: num(x.at, 9e15), path, top: path === x.path ? num(x.top, 1e7) : 0 });
    }
    return order(out);
  };
  // Course `x` opened ({ cid, name?, code?, at }): its tab, made if it has none; past the cap, the least recently used
  // unpinned tab other than this one goes (gone: what went). Pinned tabs never go.
  const open = (tabs, x, cap, keep = () => false) => {
    let list = tabs.some((t) => t.cid === x.cid) ? tabs.map((t) => (t.cid === x.cid ? { ...t, ...x } : t)) : [...tabs, { name: '', code: '', pin: false, path: '', top: 0, ...x }];
    if (list.length > MAX && !list.some((t) => !t.pin && t.cid !== x.cid && !keep(t.cid))) return { tabs, gone: [], full: true };
    const gone = [];
    while (list.length > Math.min(cap, MAX)) {
      const lru = list.filter((t) => !t.pin && t.cid !== x.cid && !keep(t.cid)).sort((a, b) => a.at - b.at)[0];
      if (!lru) break;
      gone.push(lru);
      list = list.filter((t) => t !== lru);
    }
    return { tabs: list, gone };
  };
  // Tab `cid` closed: the list without it, and the tab to its right (else left) to go to if it was the one shown.
  const close = (tabs, cid) => {
    const i = tabs.findIndex((t) => t.cid === cid);
    if (i < 0) return { tabs, next: null };
    const list = tabs.filter((t) => t.cid !== cid);
    return { tabs: list, next: (list[i] || list[i - 1])?.cid || null };
  };
  // Pinned: to the end of the pinned tabs; unpinned: to the start of the others.
  const pin = (tabs, cid, on) => {
    const t = tabs.find((x) => x.cid === cid);
    if (!t || t.pin === on) return tabs;
    const rest = tabs.filter((x) => x !== t);
    const n = rest.filter((x) => x.pin).length;
    return [...rest.slice(0, n), { ...t, pin: on }, ...rest.slice(n)];
  };
  // Tab `cid` moved to index `to`, kept inside its own group (pinned or not).
  const move = (tabs, cid, to) => {
    const i = tabs.findIndex((t) => t.cid === cid);
    if (i < 0) return tabs;
    const n = tabs.filter((t) => t.pin).length;
    const [lo, hi] = tabs[i].pin ? [0, n - 1] : [n, tabs.length - 1];
    const j = Math.max(lo, Math.min(hi, to));
    if (j === i) return tabs;
    const list = tabs.filter((t) => t.cid !== cid);
    list.splice(j, 0, tabs[i]);
    return list;
  };
  // Each site and account keeps its own list (storage.local).
  const KEY = /^ctabs:(?:https:\/\/[^/:]+|http:\/\/localhost)(:\d+)?:(?:_\d+_\d+|\d+)$/;
  const storeKey = (origin, uid) => `ctabs:${origin}:${uid}`;

  // ---- sketches ----------------------------------------------------------------------------------------------
  // What a tab shows while its frame first loads: a stand-in drawn from a sketch of how its page last looked
  // (features/coursetabs.js picture). The page takes it of what is on screen: the window's size, the course's scroll there,
  // its name, Glaze's strip's box, and up to BOXES of the page's boxes in the window, each [x, y, w, h, kind, colour, r].
  // kind: b a block, c a control, i an image, t text lines, h a heading's, n the course's name; colour #rrggbbaa, the
  // background as painted or, for text, its ink; r the corner radius, or for text the line pitch (a box holds a paragraph's
  // lines of one width). No other text, no image data, no addresses.
  const BOXES = 60, KINDS = 'bcithn';
  const px = (v) => parseFloat(v) || 0;
  const HEADING = /^H[1-6]$/, CONTROL = /^(?:BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/, IMAGE = /^(?:IMG|SVG|VIDEO|CANVAS|PICTURE|IFRAME|EMBED|OBJECT)$/;
  const LEAF = /^(?:SVG|VIDEO|CANVAS|IFRAME|EMBED|OBJECT|SELECT|TEXTAREA|SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/;
  const CONTROLS = /^(?:button|tab|checkbox|radio|switch|menuitem|option|combobox|textbox|searchbox|link)$/;
  const fade = (hex, k) => hex.slice(0, 7) + Math.round(parseInt(hex.slice(7), 16) * k).toString(16).padStart(2, '0');
  // doc: the page's document or a tab frame's, at (dx, dy) in a window w × h. colour(css) → #rrggbbaa, or null for none;
  // skip(el): Glaze's own passing marks (a tip), left out with what they hold.
  const sketch = (doc, { w, h, dx = 0, dy = 0, name = '', colour, skip = () => false }) => {
    const win = doc.defaultView, vw = Math.min(win.innerWidth, w - dx), vh = Math.min(win.innerHeight, h - dy);
    const found = [];
    let order = 0;
    // A box in the document cut to the clip (the viewport, and the scrollers around it), in the window's pixels.
    const cut = (r, c) => {
      const x = Math.max(r.left, c[0]), y = Math.max(r.top, c[1]), x2 = Math.min(r.right, c[2]), y2 = Math.min(r.bottom, c[3]);
      if (x2 - x < 2 || y2 - y < 2) return null;
      const X = Math.round(x + dx), Y = Math.round(y + dy);
      return [X, Y, Math.round(x2 + dx) - X, Math.round(y2 + dy) - Y];
    };
    const add = (b, kind, c, r, el, layer, score) => found.push({ b, kind, c, r, el, layer, score, order: order++ });
    const all = (s) => (s.match(/(?:rgba?|hsla?|color|lab|lch|oklab|oklch)\([^()]*\)|#[0-9a-f]{3,8}\b/gi) || []).map(colour).filter(Boolean);
    const text = (n, el, s, c, layer, head) => {
      const ink = colour(s.color);
      if (!ink) return;
      const range = doc.createRange();
      range.selectNodeContents(n);
      const lines = [];
      for (const r of range.getClientRects()) {
        const b = cut(r, c);
        if (!b || b[2] < 3) continue;
        const l = lines.at(-1);
        if (l && Math.abs(l[1] - b[1]) <= 1 && Math.abs(l[3] - b[3]) <= 1) { const x2 = Math.max(l[0] + l[2], b[0] + b[2]); l[0] = Math.min(l[0], b[0]); l[2] = x2 - l[0]; } else lines.push(b);
      }
      const named = !!name && !found.some((x) => x.kind === 'n') && n.textContent.trim() === name;
      const kind = named ? 'n' : head || px(s.fontSize) >= 22 || (px(s.fontSize) >= 18 && px(s.fontWeight) >= 600) ? 'h' : 't';
      // Lines of one width, at one pitch, one box: [x, y, w, h, pitch] (a single line's pitch is its height).
      const runs = [];
      for (const l of lines) {
        const p = runs.at(-1), pitch = p && l[1] - (p.y + p.n * p.pitch - p.pitch);
        if (!named && p && p.x === l[0] && Math.abs(p.w - l[2]) <= p.w * 0.12 && p.lh === l[3] && pitch >= l[3] && (p.n === 1 || Math.abs(pitch - p.pitch) <= 1)) {
          if (p.n === 1) p.pitch = pitch;
          p.n++; p.w = Math.max(p.w, l[2]);
        } else runs.push({ x: l[0], y: l[1], w: l[2], lh: l[3], n: 1, pitch: l[3] });
      }
      for (const p of runs) {
        const bh = (p.n - 1) * p.pitch + p.lh;
        if (p.y + bh > h) continue;
        add([p.x, p.y, p.w, bh], kind, ink, p.n > 1 ? p.pitch : bh, el, layer, named ? Infinity : p.w * bh * (kind === 'h' ? 4 : 2));
      }
    };
    // What shows at a grid of points, and what holds it: a box off screen is passed over only if nothing under it shows
    // (Ultra places its course panel over the page from a container below the window).
    const held = new Set();
    for (let i = 0; i < 12 * 9; i++) for (let e of doc.elementsFromPoint((i % 12 + 0.5) * vw / 12, (Math.floor(i / 12) + 0.5) * vh / 9)) for (; e && !held.has(e); e = e.parentElement) held.add(e);
    // [element, clip, layer (1: fixed or sticky, drawn over the rest), in a heading, the paint under it]
    const stack = [[doc.body, [0, 0, vw, vh], 0, false, '']];
    while (stack.length) {
      const [el, c, up, inHead, under] = stack.pop();
      if (skip(el)) continue;
      // Off screen, or past its scroller (unless fixed), with what it holds, unless some of that shows. The box first: most of
      // a long page is off screen, and its styles are never read.
      const r = el.getBoundingClientRect(), box = r.width > 0 && r.height > 0;
      const off = (k) => box && !held.has(el) && (r.right <= k[0] || r.bottom <= k[1] || r.left >= k[2] || r.top >= k[3]);
      if (off([0, 0, vw, vh])) continue;
      const s = win.getComputedStyle(el), tag = String(el.tagName).toUpperCase();
      if (s.display === 'none' || px(s.opacity) <= 0.05) continue;
      const clip = s.position === 'fixed' ? [0, 0, vw, vh] : c;
      if (off(clip)) continue;
      const layer = up || /^(?:fixed|sticky)$/.test(s.position) ? 1 : 0;
      const head = inHead || HEADING.test(tag) || el.getAttribute('role') === 'heading';
      const shows = s.visibility === 'visible';
      let paint = under;
      if (shows && box && el !== doc.body) {
        const b = cut(r, clip);
        const bg = colour(s.backgroundColor), grad = /gradient\(/.test(s.backgroundImage) ? all(s.backgroundImage) : [];
        const line = px(s.borderTopWidth) >= 1 && s.borderTopStyle !== 'none' && colour(s.borderTopColor);
        let fill = bg || (grad.length ? grad[Math.floor(grad.length / 2)] : null) || (line ? fade(line, 0.4) : null);
        const image = IMAGE.test(tag) || (!fill && /url\(/.test(s.backgroundImage));
        if (image && !fill) fill = fade(colour(tag === 'SVG' && !/url\(/.test(s.fill) && s.fill !== 'none' ? s.fill : s.color) || '#80808080', tag === 'SVG' ? 0.6 : 0.2);
        const radius = /%$/.test(s.borderTopLeftRadius) ? px(s.borderTopLeftRadius) / 100 * Math.min(r.width, r.height) : px(s.borderTopLeftRadius);
        if (b && fill && b[2] >= 4 && b[3] >= 4 && (fill !== under || image)) {
          const kind = image ? 'i' : CONTROL.test(tag) || CONTROLS.test(el.getAttribute('role') || '') || (tag === 'A' && bg) ? 'c' : 'b';
          add(b, kind, fill, Math.min(Math.round(radius), Math.floor(Math.min(b[2], b[3]) / 2)), el, layer, b[2] * b[3] * (kind === 'c' ? 3 : 1));
          paint = fill;
        }
      }
      if (LEAF.test(tag)) continue;
      const inner = s.overflowX === 'visible' && s.overflowY === 'visible' || !box
        ? clip : [Math.max(clip[0], r.left), Math.max(clip[1], r.top), Math.min(clip[2], r.right), Math.min(clip[3], r.bottom)];
      if (shows) for (const n of el.childNodes) if (n.nodeType === 3 && /\S/.test(n.textContent)) text(n, el, s, inner, layer, head);
      for (let i = el.children.length - 1; i >= 0; i--) stack.push([el.children[i], inner, layer, head, paint]);
    }
    // The largest first, past what covers them (a box whose middle is another's that isn't in it or around it); then
    // drawn in the page's order, what stays on screen over what scrolls under it.
    const kept = [];
    for (const x of found.sort((a, b) => b.score - a.score)) {
      if (kept.length >= BOXES) break;
      const hit = doc.elementFromPoint(x.b[0] + x.b[2] / 2 - dx, x.b[1] + x.b[3] / 2 - dy);
      if (!hit || x.el.contains(hit) || hit.contains(x.el)) kept.push(x);
    }
    return kept.sort((a, b) => a.layer - b.layer || a.order - b.order).map((x) => [...x.b, x.kind, x.c, x.r]);
  };
  // The sketch as the worker keeps it, or null: every field checked, every number a whole one inside the window.
  const whole = (v, lo, hi) => (typeof v === 'number' && v >= lo && v <= hi ? Math.round(v) : null);
  const clip = (m) => {
    const size = Array.isArray(m?.size) && m.size.length === 2 ? m.size.map((v) => whole(v, 1, 1e5)) : null;
    if (!size || size.includes(null)) return null;
    const [W, H] = size, top = whole(m.top, 0, 1e7);
    const inside = (a) => { const [x, y, w, h] = a.slice(0, 4).map((v) => whole(v, 0, 1e5)); return x !== null && y !== null && w >= 1 && h >= 1 && x + w <= W && y + h <= H ? [x, y, w, h] : null; };
    const name = typeof m.name === 'string' && m.name.length <= 200 && !/[\x00-\x1f\x7f]/.test(m.name) ? m.name : null;
    const strip = m.strip === null ? null : Array.isArray(m.strip) && m.strip.length === 4 ? inside(m.strip) : false;
    if (top === null || name === null || strip === false || (m.strip !== null && !strip) || !Array.isArray(m.boxes) || m.boxes.length > BOXES) return null;
    const boxes = [];
    for (const x of m.boxes) {
      const b = Array.isArray(x) && x.length === 7 ? inside(x) : null;
      const text = b && 'thn'.includes(x[4]), r = b && whole(x[6], 0, text ? b[3] : Math.floor(Math.min(b[2], b[3]) / 2));
      if (!b || typeof x[4] !== 'string' || x[4].length !== 1 || !KINDS.includes(x[4]) || typeof x[5] !== 'string' || !/^#[0-9a-f]{8}$/.test(x[5]) || r === null || (text && r < 1)) return null;
      boxes.push([...b, x[4], x[5], r]);
    }
    if (boxes.filter((b) => b[4] === 'n').length > (name ? 1 : 0)) return null;
    return { size, top, name, strip, boxes };
  };
  // What the stand-in draws of sketch `s`, in the window's pixels: { x, y, w, h, bg, r } rounded boxes, a line of text a
  // bar across the middle of its glyphs (fainter than the ink: glyphs cover only part of a line), and the course's name
  // itself in its own place, size and ink: { x, y, w, h, ink, text, size, line }.
  const drawn = (s) => s.boxes.flatMap(([x, y, w, h, kind, c, r]) => {
    if (kind === 'n' && s.name) return [{ x, y, w, h, ink: c, text: s.name, size: Math.round(Math.min(r, h) / 1.2), line: r }];
    if (!'thn'.includes(kind)) return [{ x, y, w, h, bg: c, r }];
    const n = Math.max(1, Math.min(200, Math.ceil(h / r))), lh = h - (n - 1) * r, bar = Math.max(2, Math.round(lh * (kind === 't' ? 0.42 : 0.5)));
    return Array.from({ length: n }, (_, i) => ({ x, y: y + i * r + Math.round(lh * (kind === 't' ? 0.3 : 0.25)), w, h: bar, bg: fade(c, kind === 't' ? 0.32 : 0.45), r: bar / 2 }));
  });
  // Limits, in characters of a kept sketch (JSON): one course's (the largest clip() lets through fits), and all of them, in
  // the page and in the worker alike, room for every tab of a few accounts. Past the total the least recently kept go
  // first: fit([[key, size, at]]) → the keys to drop.
  const SNAP_ONE = 8_000;
  const SNAP_ALL = 400_000;
  const fit = (items, all = SNAP_ALL) => {
    let sum = 0;
    return [...items].reverse().sort((a, b) => b[2] - a[2]).filter(([, n]) => (sum += n) > all).map(([k]) => k);
  };

  return { courseOf, validId, rootOf, homeOf, owns, SPEC, shortName, TOOLS, safe, outside, back, placeOf, target, clean, open, close, pin, move, order, MAX, KEY, storeKey, BOXES, sketch, clip, drawn, SNAP_ONE, SNAP_ALL, fit };
})();

if (typeof module !== 'undefined') module.exports = GZ_CTABS_LIB; else GZ_CTABS_LIB;
