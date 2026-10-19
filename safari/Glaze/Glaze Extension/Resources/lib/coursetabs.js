// Course tabs on Canvas and Blackboard Ultra: what features/coursetabs.js decides without the page, so node can test it. Which
// addresses a tab may go back to, the tab list's edits, the snapshot cache's limits and what a snapshot keeps of a page.
// Classic script; module.exports for node. Loaded on demand (each site asks for it before features/coursetabs.js);
// the editor and the worker load it too. A second injection keeps the first.
var GZ_CTABS_LIB = globalThis.GZ_CTABS_LIB || (() => {
  // A frame-only injection may land after navigation, before this document's bootstrap.
  if (typeof GZ_SPEC === 'undefined' && typeof module === 'undefined') return null;

  // Its settings (storage.sync `tabs`; the switch is enhance.tabs), added to GZ_SPEC from here so the first content script
  // carries only the switch. at: the strip above the course's top bar, between its two rows, or below it; nav: no strip,
  // only Glaze's own navigation's tabs (the strip's `above` where that bar doesn't hold them). cap: how many
  // tabs before the least recently used unpinned one closes. place: a tab goes back to where it was. The rest is the tab
  // buttons' look; color: none, a tint of each course's colour, or more of it.
  const SPEC = {
    at: ['above', ['above', 'between', 'below', 'nav']], cap: [8, [2, 20]], place: [true, 'bool'],
    shape: ['tab', ['tab', 'rounded', 'pill', 'square']], size: ['medium', ['small', 'medium', 'large']], width: [180, [96, 320]],
    label: ['short', ['short', 'name', 'code']], mark: ['dot', ['dot', 'icon', 'none']], color: ['off', ['off', 'tint', 'theme']],
  };
  (typeof GZ_SPEC !== 'undefined' ? GZ_SPEC : require('../defaults.js').GZ_SPEC).tabs = SPEC;

  const ID = /^(?:_\d+_\d+|\d+)$/;
  const validId = (id, site) => typeof id === 'string' && id.length <= 80 && (site === 'canvas' ? /^\d+$/ : site === 'ultra' ? /^_\d+_\d+$/ : ID).test(id);
  const rootOf = (cid) => /^\d+$/.test(cid) ? `/courses/${cid}` : `/ultra/courses/${cid}`;
  const homeOf = (cid) => rootOf(cid) + (/^\d+$/.test(cid) ? '' : '/outline');
  const owns = (path, cid) => typeof path === 'string' && validId(cid) && (path === rootOf(cid) || path.startsWith(`${rootOf(cid)}/`));
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

  // ---- snapshots ---------------------------------------------------------------------------------------------
  // Limits, in characters of a picture's data URL (JPEG, at the screen's own pixels): one course's, and all of them, in
  // the page and in the worker alike (storage.session holds 10 MB). Past the total the least recently kept go first:
  // fit([[key, size, at]]) → the keys to drop.
  const SNAP_ONE = 3_000_000;
  const SNAP_ALL = 8_000_000;
  const fit = (items, all = SNAP_ALL) => {
    let sum = 0;
    return [...items].reverse().sort((a, b) => b[2] - a[2]).filter(([, n]) => (sum += n) > all).map(([k]) => k);
  };

  return { validId, rootOf, homeOf, owns, SPEC, shortName, TOOLS, safe, back, placeOf, target, clean, open, close, pin, move, order, MAX, KEY, storeKey, SNAP_ONE, SNAP_ALL, fit };
})();

if (typeof module !== 'undefined') module.exports = GZ_CTABS_LIB; else GZ_CTABS_LIB;
