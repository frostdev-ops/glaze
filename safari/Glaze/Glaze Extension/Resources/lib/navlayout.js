// A Look's nav layout (x.nav): its cleaner, and the one ordered, grouped model every site's rail draws
// (features/nav.js). Site-neutral and pure: the sites only say which native items they have.
var GZ_NAV_LAYOUT = globalThis.GZ_NAV_LAYOUT || (() => {
  const N = typeof GZ_NAV_ITEMS === 'undefined' ? require('./nav-items.js') : GZ_NAV_ITEMS;
  // One name per kind of native item across the LMSes, so a Look hides "calendar" everywhere. Ultra's names come first.
  const NATIVE = [...N.NATIVE, 'dashboard', 'home', 'history', 'help', 'groups', 'admin'];
  const PLACES = ['left', 'top', 'bottom', 'dock'];
  const CANVAS = { profile: 'profile', dashboard: 'dashboard', courses: 'course', calendar: 'calendar', conversations: 'messages', history: 'history', help: 'help', accounts: 'admin', groups: 'groups' };
  const MOODLE = [[/\/my\/courses\.php$/, 'course'], [/\/my\/(index\.php)?$/, 'dashboard'], [/\/admin\/search\.php$/, 'admin'], [/\/calendar\/view\.php$/, 'calendar'], [/\/message\/index\.php$/, 'messages'], [/\/grade\/report\/overview\/index\.php$/, 'grades']];
  const LINK = /^link:([a-z0-9]{12})$/;
  const KEYS = ['place', 'groups', 'hidden', 'links', 'icons'];
  const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v, max) => [...v.replace(/[\p{Cc}\p{Bidi_Control}]/gu, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');

  // Native ids each site's rail reads off its own markup.
  const canvas = (id) => CANVAS[/^global_nav_([a-z]+)_link$/.exec(id || '')?.[1]] || '';
  const moodle = (href) => {
    if (typeof href !== 'string' || !href || href.startsWith('#')) return '';
    let u;
    try { u = new URL(href, 'https://nav.invalid'); } catch { return ''; }
    // Site home is the site's root, which may sit in a folder: Moodle links it with redirect=0 to skip the Dashboard.
    const home = /\/(index\.php)?$/.test(u.pathname) && (/^\/(index\.php)?$/.test(u.pathname) || u.searchParams.get('redirect') === '0');
    return MOODLE.find(([re]) => re.test(u.pathname))?.[1] || (home ? 'home' : '');
  };

  // clean(raw) -> nav | null, idempotent. Keys left out stay out (codes must decode to exactly what was encoded);
  // a wrong type or an unknown key refuses the whole part, entries that don't fit are dropped.
  const clean = (raw) => {
    if (!obj(raw) || Object.keys(raw).some((k) => !KEYS.includes(k))) return null;
    const out = {};
    if ('place' in raw) { if (!PLACES.includes(raw.place)) return null; out.place = raw.place; }
    const links = [];
    if ('links' in raw) {
      if (!Array.isArray(raw.links)) return null;
      for (const v of raw.links.slice(0, 100)) {
        if (!obj(v) || Object.keys(v).some((k) => !['id', 'n', 'u', 'i'].includes(k))) return null;
        const l = N.link(v);
        if (l && !links.some((x) => x.id === l.id)) links.push({ id: l.id, n: l.n, u: l.u, i: l.i });
        if (links.length === 8) break;
      }
      out.links = links;
    }
    const ids = new Set([...NATIVE, ...links.map((l) => `link:${l.id}`), ...N.WIDGETS.map((w) => `w:${w}`)]);
    let hidden = [];
    if ('hidden' in raw) {
      if (!Array.isArray(raw.hidden)) return null;
      hidden = [...new Set(raw.hidden.filter((id) => NATIVE.includes(id) && id !== 'glaze'))];
      out.hidden = hidden;
    }
    if ('groups' in raw) {
      if (!Array.isArray(raw.groups)) return null;
      const placed = new Set(hidden);
      out.groups = [];
      for (const g of raw.groups.slice(0, 6)) {
        if (!obj(g) || Object.keys(g).some((k) => !['label', 'items'].includes(k)) || ('label' in g && typeof g.label !== 'string') || !Array.isArray(g.items)) return null;
        const group = {};
        const label = 'label' in g ? text(g.label, 24) : '';
        if (label) group.label = label;
        group.items = [];
        for (const id of g.items) if (ids.has(id) && !placed.has(id)) { placed.add(id); group.items.push(id); }
        out.groups.push(group);
      }
    }
    if ('icons' in raw) {
      if (!obj(raw.icons)) return null;
      out.icons = Object.fromEntries(Object.entries(raw.icons).filter(([id, i]) => (NATIVE.includes(id) || (LINK.test(id) && ids.has(id))) && N.ICONS.includes(i)));
    }
    return Object.keys(out).length ? out : null;
  };

  // resolve(nav, present) -> [{ key, kind, id, label?, icon? }]: what the rail shows, in order. present: the native ids
  // this page has, in their own order. Grouped items come first, a group's label before them (left out when none of its
  // items are on this page); what no group names follows in the page's order, then the links. Widgets show only where a
  // group puts them. Hidden items never show; Glaze's settings item always does.
  const resolve = (nav, present = []) => {
    const out = [], used = new Set(), hide = new Set(nav?.hidden || []), icons = nav?.icons || {}, links = nav?.links || [];
    const entry = (id) => {
      if (used.has(id) || hide.has(id)) return null;
      const link = LINK.exec(id)?.[1];
      if (link) return links.some((l) => l.id === link) ? { key: id, kind: 'link', id: link } : null;
      if (id.startsWith('w:')) return N.WIDGETS.includes(id.slice(2)) ? { key: id, kind: 'widget', id: id.slice(2) } : null;
      return present.includes(id) ? { key: id, kind: 'native', id, ...(icons[id] && { icon: icons[id] }) } : null;
    };
    (nav?.groups || []).forEach((g, at) => {
      const items = g.items.map(entry).filter(Boolean);
      for (const e of items) used.add(e.key);
      if (items.length && g.label) out.push({ key: `g:${at}`, kind: 'label', label: g.label });
      out.push(...items);
    });
    for (const id of [...present, ...links.map((l) => `link:${l.id}`)]) { const e = entry(id); if (e) { used.add(e.key); out.push(e); } }
    return out;
  };

  // The shape features/nav.js's rail already draws (navItems): a worn layout stands in for the student's own items.
  const rail = (nav) => ({
    links: (nav.links || []).map((l) => ({ ...l, i: nav.icons?.[`link:${l.id}`] || l.i, tab: false })),
    order: [], hidden: nav.hidden || [],
    widgets: N.WIDGETS.filter((w) => (nav.groups || []).some((g) => g.items.includes(`w:${w}`))).map((id) => ({ id, on: true, at: 'inline' })),
  });

  return { NATIVE, PLACES, clean, resolve, rail, canvas, moodle };
})();
if (typeof module !== 'undefined') module.exports = GZ_NAV_LAYOUT; else GZ_NAV_LAYOUT;
