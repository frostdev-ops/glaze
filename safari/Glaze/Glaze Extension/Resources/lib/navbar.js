// Glaze's own navigation bar (features/navbar.js draws it): the one model every site's bar is drawn from. Pure and
// site-neutral: a site's adapter says which native items its page has (the vocabulary of lib/navlayout.js), and this
// orders, groups, labels and icons them with the student's choices (sync navbarItems, clean), a worn Look's layout (x.nav)
// and the student's older rail items (navItems), then adds links, Glaze's own items (opt-in) and mods' items.
// Classic script; module.exports for node.
var GZ_NAVBAR = globalThis.GZ_NAVBAR || (() => {
  const L = typeof GZ_NAV_LAYOUT === 'undefined' ? require('./navlayout.js') : GZ_NAV_LAYOUT;
  const N = typeof GZ_NAV_ITEMS === 'undefined' ? require('./nav-items.js') : GZ_NAV_ITEMS;
  // One 24-unit stroke drawing per name: the bar's own icons, the same on every site, and every icon a link may pick.
  const ICONS = {
    home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M10 21v-6h4v6',
    book: 'M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2M19 17v4H6M9 7h6',
    calendar: 'M5.5 4.5h13A2.5 2.5 0 0 1 21 7v11.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5V7a2.5 2.5 0 0 1 2.5-2.5zM3 9.5h18M8 2.5v4M16 2.5v4',
    inbox: 'M3 13.5 5.5 5h13l2.5 8.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 13.5h5l1.5 2.5h5l1.5-2.5h5',
    grades: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    tools: 'M5 3h3.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM15.5 3H19a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2h-3.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM5 13.5h3.5a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.5a2 2 0 0 1 2-2zM15.5 13.5H19a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2h-3.5a2 2 0 0 1-2-2v-3.5a2 2 0 0 1 2-2z',
    help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.9M12 17.2h.01',
    activity: 'M3 12h4l3-8 4 16 3-8h4',
    organization: 'M3 21V7l9-4 9 4v14M9 21v-5h6v5M8 10h1M15 10h1',
    groups: 'M12.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a5.5 5.5 0 0 1 3.5 6',
    history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2',
    admin: 'M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z',
    account: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 21a8 8 0 0 1 16 0',
    signout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
    glaze: 'M12 3.5s-6.5 7.3-6.5 11a6.5 6.5 0 0 0 13 0c0-3.7-6.5-11-6.5-11z',
    notes: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5',
    todo: 'M4 6.5l2 2 3.5-4M12 7h8M4 13.5l2 2 3.5-4M12 14h8M12 20h8M5 20h2',
    search: 'M16.5 10.5a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM15 15l5.5 5.5',
    settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M18 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM12 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    more: 'M6.6 12a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0zM13.6 12a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0zM20.6 12a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z',
    chevron: 'm9 6 6 6-6 6',
    pin: 'M9 4h6l-1 6 4 3H6l4-3zM12 13v7',
    link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1',
    video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
    chat: 'M4 5h16v11H9l-5 4z',
    doc: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5',
    folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16',
    star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z',
    globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  };
  // The icons a student, a Look or a mod may give an item: every drawing but the bar's own controls.
  const PICKS = Object.keys(ICONS).filter((k) => !['chevron', 'pin', 'more'].includes(k));
  // A native item's icon, by its id in the shared vocabulary.
  const ICON_OF = { 'institution-page': 'home', dashboard: 'home', home: 'home', stream: 'activity', course: 'book', organization: 'organization', groups: 'groups', calendar: 'calendar', messages: 'inbox', grades: 'grades', tools: 'tools', help: 'help', history: 'history', admin: 'admin', profile: 'account', logout: 'signout' };
  // Glaze's own items, opt-in (owner decision 2026-10-19): the page asks Glaze to open them (features/navbar.js).
  const GLAZE = ['notes', 'todo', 'search', 'settings'];
  // The default bar (the design canvas's): the places first, then the rest, separated. The account and signing out sit at
  // the foot, not in a group; Glaze's settings item in Ultra's own nav (content-ultra.js) is the opt-in settings here.
  const DEFAULT = [
    { id: 'main', items: ['institution-page', 'dashboard', 'home', 'stream', 'course', 'organization', 'groups', 'calendar', 'messages', 'grades'] },
    { id: 'more', items: ['tools', 'history', 'help', 'admin'] },
  ];
  const FOOT = ['profile', 'logout', 'glaze'];
  // Mobile's four tabs before More, each the first of its row this page has.
  const TABS = [['institution-page', 'dashboard', 'home'], ['course'], ['calendar'], ['messages']];
  const LINK = /^link:([a-z0-9]{12})$/;
  const MOD = /^mod:[a-z0-9][a-z0-9_-]{0,47}\.[a-z][a-z0-9-]{0,31}$/;
  const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v, max) => (typeof v === 'string' ? [...v.replace(/[\p{Cc}\p{Bidi_Control}]/gu, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('') : '');
  // An id the student may place, hide or rename: a native item, one of their links, a Glaze item or a mod's item.
  const named = (id) => typeof id === 'string' && (L.NATIVE.includes(id) || LINK.test(id) || GLAZE.includes(id.slice(6)) && id.startsWith('glaze:') || MOD.test(id));
  const badge = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? (v > 99 ? '99+' : String(Math.floor(v))) : text(v, 4));

  // clean(raw) -> navbarItems, idempotent: what the student chose, from storage, the editor or a code. Entries that don't
  // fit are dropped, never the whole record.
  //   items: { id: { label, icon, hidden } }  a name, an icon, shown or hidden; a key left out follows the Look or the default
  //   groups: [{ label, items: [id] }]          the student's own grouping and order (up to 8 groups)
  //   tabs: [id]                                mobile's tabs before More (up to 4)
  //   glaze: ['notes' | 'todo' | 'search' | 'settings']   Glaze's own items, opt-in
  //   links: [{ id, n, u, i, tab }]             their own links (lib/nav-items.js link)
  const clean = (raw) => {
    const out = { items: {}, groups: [], tabs: [], glaze: [], links: [] };
    if (!obj(raw)) return out;
    for (const v of Array.isArray(raw.links) ? raw.links.slice(0, 100) : []) {
      const l = N.link(v);
      if (l && !out.links.some((x) => x.id === l.id)) out.links.push(l);
      if (out.links.length === 8) break;
    }
    for (const [id, v] of obj(raw.items) ? Object.entries(raw.items).slice(0, 200) : []) {
      if (!named(id) || !obj(v) || Object.keys(out.items).length === 64) continue;
      const e = {};
      const label = text(v.label, 40);
      if (label) e.label = label;
      if (PICKS.includes(v.icon)) e.icon = v.icon;
      if (typeof v.hidden === 'boolean') e.hidden = v.hidden;
      if (Object.keys(e).length) out.items[id] = e;
    }
    const placed = new Set();
    for (const g of Array.isArray(raw.groups) ? raw.groups.slice(0, 8) : []) {
      if (!obj(g) || !Array.isArray(g.items)) continue;
      const group = { items: [] };
      const label = text(g.label, 24);
      if (label) group.label = label;
      for (const id of g.items.slice(0, 64)) if (named(id) && !FOOT.includes(id) && !placed.has(id)) { placed.add(id); group.items.push(id); }
      out.groups.push(group);
    }
    out.tabs = [...new Set((Array.isArray(raw.tabs) ? raw.tabs : []).filter((id) => named(id) && !FOOT.includes(id)))].slice(0, 4);
    out.glaze = GLAZE.filter((g) => Array.isArray(raw.glaze) && raw.glaze.includes(g));
    return out;
  };

  // build(input) -> the bar. input:
  //   native: [{ id, label, href, active, badge }] the page's own items, in its order (the site's adapter reads them)
  //   prefs: clean()'s navbarItems; look: a worn Look's x.nav (GZ_NAV_LAYOUT.clean); legacy: navItems (lib/nav-items.js)
  //   mods: [{ owner, id, label, icon, href, badge, group, slot }] items mods added (features/navbar.js checks them)
  //   names: { notes, todo, search, settings }: Glaze's own items' names, in the page's language
  // -> { groups: [{ id, label, items }], slots: { top, bottom }, account, signout, tabs, sheet, items }
  // An item: { id, label, icon, href, action, active, badge, owner, tab }. Hidden items are left out everywhere but
  // `items`, which has every item with `hidden` set, for the editor and nav.model().
  const build = ({ native = [], prefs, look = null, legacy = null, mods = [], names = {} } = {}) => {
    const p = prefs || clean();
    const pool = new Map();
    const add = (item) => { if (!pool.has(item.id)) pool.set(item.id, item); };
    for (const n of native) {
      if (!n || !L.NATIVE.includes(n.id) || n.id === 'glaze') continue;
      add({ id: n.id, label: text(n.label, 80) || n.id, icon: ICON_OF[n.id] || 'link', href: typeof n.href === 'string' ? n.href : '', active: !!n.active, badge: badge(n.badge), native: true });
    }
    // A worn Look's links stand in for the student's older rail links (as features/nav.js did); their own new ones add.
    const links = [...(look?.links || legacy?.links || []), ...p.links];
    for (const l of links) add({ id: `link:${l.id}`, label: l.n, icon: PICKS.includes(l.i) ? l.i : 'link', href: l.u, tab: l.tab === true, active: false, badge: '' });
    for (const g of p.glaze) add({ id: `glaze:${g}`, label: names[g] || { notes: 'Notes', todo: 'To Do', search: 'Search', settings: 'Glaze settings' }[g], icon: g === 'settings' ? 'glaze' : g, action: g, active: false, badge: '' });
    for (const m of mods) if (m && MOD.test(m.id)) add({ id: m.id, label: text(m.label, 40) || m.id, icon: PICKS.includes(m.icon) ? m.icon : 'link', href: m.href || '', action: m.href ? '' : 'mod', active: false, badge: badge(m.badge), owner: m.owner, group: m.group, slot: m.slot });
    // Names, icons and hiding: the student's own where they set one, else the worn Look's, else the older rail's.
    const legacyHidden = new Set(look ? [] : legacy?.hidden || []);
    for (const item of pool.values()) {
      const mine = p.items[item.id] || {};
      if (mine.label) item.label = mine.label;
      item.icon = mine.icon || look?.icons?.[item.id] || item.icon;
      item.hidden = 'hidden' in mine ? mine.hidden : !!look?.hidden?.includes(item.id) || legacyHidden.has(item.id);
    }
    // Groups: the student's, else the Look's, else the default. What none places goes where the default would put it
    // (the first group for the page's own items), links and Glaze's items to the last group, a mod's to the group it
    // names or its slot.
    const layout = p.groups.length ? p.groups.map((g, at) => ({ id: `g${at}`, label: g.label || '', items: g.items }))
      : look?.groups?.length ? look.groups.map((g, at) => ({ id: `g${at}`, label: g.label || '', items: g.items.filter((id) => !id.startsWith('w:')) }))
        : DEFAULT.map((g) => ({ ...g, label: '' }));
    const order = legacy && !p.groups.length && !look?.groups?.length ? legacy.order || [] : [];
    const groups = layout.map((g) => ({ id: g.id, label: g.label, items: [] }));
    const placed = new Set(FOOT);
    const slots = { top: [], bottom: [] };
    layout.forEach((g, at) => { for (const id of g.items) if (pool.has(id) && !placed.has(id)) { placed.add(id); groups[at].items.push(pool.get(id)); } });
    for (const item of pool.values()) {
      if (placed.has(item.id)) continue;
      placed.add(item.id);
      if (item.owner && slots[item.slot]) { slots[item.slot].push(item); continue; }
      const own = item.owner && groups.find((g) => g.id === item.group);
      const fallback = groups.find((g) => g.id === DEFAULT.find((d) => d.items.includes(item.id))?.id) || groups[0];
      (own || (item.native ? fallback : groups.at(-1))).items.push(item);
    }
    // The student's older order (navItems.order) still sorts the default groups.
    if (order.length) for (const g of groups) {
      const rank = (i) => { const at = order.indexOf(i.native ? i.id : i.id.replace(/^link:/, '')); return at < 0 ? order.length : at; };
      g.items = g.items.map((i, at) => [i, at]).sort(([a, x], [b, y]) => rank(a) - rank(b) || x - y).map(([i]) => i);
    }
    const shown = (list) => list.filter((i) => !i.hidden);
    const visible = groups.map((g) => ({ ...g, items: shown(g.items) })).filter((g) => g.items.length);
    const mobile = [{ id: 'top', label: '', items: shown(slots.top) }, ...visible, { id: 'bottom', label: '', items: shown(slots.bottom) }];
    const all = mobile.flatMap((g) => g.items);
    // Mobile: the student's tabs, else the default's, then whatever comes first, to four; the rest go in the More sheet.
    const want = p.tabs.length ? p.tabs.map((id) => [id]) : TABS;
    const tabs = [];
    for (const row of want) { const i = all.find((x) => row.includes(x.id) && !tabs.includes(x)); if (i) tabs.push(i); }
    for (const i of all) { if (tabs.length >= 4) break; if (!tabs.includes(i)) tabs.push(i); }
    const sheet = mobile.map((g) => ({ ...g, items: g.items.filter((i) => !tabs.includes(i)) })).filter((g) => g.items.length);
    const foot = (id) => { const i = pool.get(id); return i && !i.hidden ? i : null; };
    return { groups: visible, slots: { top: shown(slots.top), bottom: shown(slots.bottom) }, account: foot('profile'), signout: foot('logout'), tabs, sheet, items: [...pool.values()] };
  };

  // The rail's state, from the student's setting and the window: open (labels), or icons with a peek on hover.
  const railOpen = (rail, width) => rail === 'open' || (rail === 'auto' && width >= 1280);
  // The page's room for the bar, in px: the rail and its gutters on wide windows (theme.css reserves it at first paint).
  const SPACE = { open: 248 + 24, icons: 72 + 24 };

  return { ICONS, PICKS, ICON_OF, GLAZE, DEFAULT, TABS, clean, build, named, railOpen, SPACE };
})();
if (typeof module !== 'undefined') module.exports = GZ_NAVBAR; else GZ_NAVBAR;
