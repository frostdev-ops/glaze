// Course tabs on Blackboard Ultra (B8): what features/coursetabs.js decides without the page, so node can test it. Which
// addresses a tab may go back to, the tab list's edits, the snapshot cache's limits and what a snapshot keeps of a page.
// Classic script; module.exports for node. Loaded on demand (content-ultra.js asks for it before features/coursetabs.js);
// the editor and the worker load it too. A second injection keeps the first.
var GZ_CTABS_LIB = globalThis.GZ_CTABS_LIB || (() => {
  // Its settings (storage.sync `tabs`; the switch is enhance.tabs), added to GZ_SPEC from here so the first content script
  // carries only the switch. at: the strip above the course's top bar, between its two rows, or below it. cap: how many
  // tabs before the least recently used unpinned one closes. place: a tab goes back to where it was. The rest is the tab
  // buttons' look; color: none, a tint of each course's colour, or more of it.
  const SPEC = {
    at: ['above', ['above', 'between', 'below']], cap: [8, [2, 20]], place: [true, 'bool'],
    shape: ['tab', ['tab', 'rounded', 'pill', 'square']], size: ['medium', ['small', 'medium', 'large']], width: [180, [96, 320]],
    label: ['name', ['name', 'code']], mark: ['dot', ['dot', 'icon', 'none']], color: ['off', ['off', 'tint', 'theme']],
  };
  (typeof GZ_SPEC !== 'undefined' ? GZ_SPEC : require('../defaults.js').GZ_SPEC).tabs = SPEC;

  const ID = /^_\d+_\d+$/;
  // ---- where a tab may go back to ----------------------------------------------------------------------------
  // An allowlist: a course's tools (parity/spikes/B8.md), its outline's details pages, and a document, folder or learning
  // module opened from it. Anything else (a test, an attempt, an assignment, a discussion, a message) goes back to its
  // tool instead, and a tool not listed to the outline, so a tab can never start or resume an attempt.
  const TOOLS = ['outline', 'calendar', 'announcements', 'engagement', 'grades', 'messages', 'groups/enrollments', 'achievements'];
  const SAFE = new RegExp(`^/ultra/courses/(_\\d+_\\d+)/(?:${TOOLS.join('|')}|outline/(?:roster|attendanceGrade|booksAndTools)|outline/(?:edit/)?(?:document|folder|learningModule)/_\\d+_\\d+)/?$`);
  // And never anything that names one, whatever the route looks like.
  const NEVER = /assess|attempt|test|quiz|exam|survey|submi|discussion|journal|blog|wiki|lti|launch/i;
  // What the address's query may keep: the course itself, a details page's folder, a document's view.
  const QUERY = { courseId: ID, parentId: ID, view: /^content$/, state: /^view$/ };
  // The path (and the query it may keep) if a tab may go back there, else null.
  const safe = (path, search = '') => {
    const m = typeof path === 'string' && path.length < 300 ? SAFE.exec(path) : null;
    if (!m || NEVER.test(path)) return null;
    let q;
    try { q = new URLSearchParams(typeof search === 'string' && search.length < 300 ? search : ''); } catch { q = new URLSearchParams(); }
    const keep = [...q].filter(([k, v]) => QUERY[k]?.test(v) && (k !== 'courseId' || v === m[1]));
    return keep.length ? `${path}?${new URLSearchParams(keep)}` : path;
  };
  // A course page's tool, or its outline: where a page that isn't safe goes back to.
  const back = (path) => {
    const m = typeof path === 'string' && path.match(/^\/ultra\/courses\/(_\d+_\d+)\/([^/?#]+)(?:\/([^/?#]+))?/);
    if (!m) return null;
    const tool = TOOLS.find((x) => x === m[2] || x === `${m[2]}/${m[3]}`) || (m[2] === 'groups' ? 'groups/enrollments' : 'outline');
    return `/ultra/courses/${m[1]}/${tool}`;
  };
  // What a course page is to its tab: { path, exact } (exact: the page itself, so its scroll means something there).
  const placeOf = (path, search) => { const p = safe(path, search); return { path: p || back(path), exact: !!p }; };
  // Where a click on tab `t` goes: its remembered place when that's still safe and in its own course, else its outline.
  const target = (t, remember = true) => {
    const [p, q] = String(remember && t.path || '').split('?');
    return (p.startsWith(`/ultra/courses/${t.cid}/`) && safe(p, q)) || `/ultra/courses/${t.cid}/outline`;
  };

  // ---- the tab list -------------------------------------------------------------------------------------------
  // [{ cid, name, code, pin, at (last used), path (a safe place, or its tool), top (scroll there) }], pinned first.
  // ponytail: 40 tabs at most, pinned or not.
  const MAX = 40;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const num = (v, max) => (Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0);
  const order = (list) => [...list.filter((x) => x.pin), ...list.filter((x) => !x.pin)];
  const clean = (raw) => {
    const out = [];
    for (const x of Array.isArray(raw) ? raw : []) {
      if (!x || !ID.test(x.cid) || out.length >= MAX || out.some((y) => y.cid === x.cid)) continue;
      const path = target({ cid: x.cid, path: str(x.path, 300) });
      out.push({ cid: x.cid, name: str(x.name, 200), code: str(x.code, 80), pin: x.pin === true, at: num(x.at, 9e15), path, top: path === x.path ? num(x.top, 1e7) : 0 });
    }
    return order(out);
  };
  // Course `x` opened ({ cid, name?, code?, at }): its tab, made if it has none; past the cap, the least recently used
  // unpinned tab other than this one goes (gone: what went). Pinned tabs never go.
  const open = (tabs, x, cap) => {
    let list = tabs.some((t) => t.cid === x.cid) ? tabs.map((t) => (t.cid === x.cid ? { ...t, ...x } : t)) : [...tabs, { name: '', code: '', pin: false, path: '', top: 0, ...x }];
    const gone = [];
    while (list.length > Math.min(cap, MAX)) {
      const lru = list.filter((t) => !t.pin && t.cid !== x.cid).sort((a, b) => a.at - b.at)[0];
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
  const KEY = /^ctabs:https:\/\/[^/:]+(:\d+)?:_\d+_\d+$/;
  const storeKey = (origin, uid) => `ctabs:${origin}:${uid}`;

  // ---- snapshots ---------------------------------------------------------------------------------------------
  // Limits, in characters of HTML: one course's view, and all of them, in the page and in the worker alike. Past the total
  // the least recently kept go first: fit([[key, size, at]]) → the keys to drop.
  const SNAP_ONE = 1_000_000;
  const SNAP_ALL = 6_000_000;
  const fit = (items, all = SNAP_ALL) => {
    let sum = 0;
    return [...items].sort((a, b) => b[2] - a[2]).filter(([, n]) => (sum += n) > all).map(([k]) => k);
  };
  // What a snapshot keeps of a page: it is shown inert, but nothing that runs, loads, plays or takes input is copied at all.
  // No scripts, frames (LTI tools), plug-ins, form fields, media or canvases, no styles or links of its own (the page's are
  // mirrored), no handlers, and no address that runs script.
  const DROP = new Set(['script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'fencedframe', 'input', 'textarea',
    'select', 'option', 'datalist', 'video', 'audio', 'source', 'track', 'canvas', 'template', 'slot', 'link', 'meta', 'base', 'style', 'animate', 'set']);
  const RISKY = /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i;
  const keepAttr = (name, value) => {
    const n = String(name).toLowerCase();
    if (n.startsWith('on') || ['srcset', 'srcdoc', 'formaction', 'action', 'ping', 'autofocus', 'contenteditable', 'tabindex', 'accesskey', 'popover', 'data-gz-loading', 'data-gz-reveal'].includes(n)) return false;
    return !(/(^|:)(href|src|data|poster|xlink:href)$/.test(n) && RISKY.test(String(value)));
  };

  return { SPEC, TOOLS, safe, back, placeOf, target, clean, open, close, pin, move, order, MAX, KEY, storeKey, SNAP_ONE, SNAP_ALL, fit, DROP, keepAttr };
})();

if (typeof module !== 'undefined') module.exports = GZ_CTABS_LIB; else GZ_CTABS_LIB;
