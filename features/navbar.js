// Glaze's own navigation (owner decision 2026-10-19), drawn from one model (lib/navbar.js) on every site, in a shadow root
// of its own so the school's CSS can't reach it. The site's own nav stays in the page, hidden (theme.css), so its links,
// badges and menus keep working through it and turning the bar off shows it again. Wide windows: a side rail (open, or
// icons with a peek on hover) or a top bar, floating over the page or set into it; inside a course it can change (icons,
// a top bar, or none). Glaze's course tabs show in it too. A site's own menus (Canvas's trays: Courses, Account, Help…)
// open as Glaze's panels beside the bar, and a course's own menu (Canvas's course navigation, Moodle's) is a part of
// the bar inside a course. Below 900px: a bottom bar and a More sheet. Looks and mods style it by part (::part(item));
// mods add items and listen through the API at the end (features/mods.js carries their calls here). Glaze's widgets (the
// clock, the next thing due, the focus timer, the pet: features/navbar-widgets.js) sit in the rail, compact in the icons
// rail and the top bar, and in a phone's sheet; mods' navigation widgets sit in the rail's dock, which never moves (a frame
// moved loads again): with a top bar or on a phone, the rail stands invisible and the dock opens over the page from a
// Widgets button.
//
// A site's adapter (GZ_NAVBAR_<SITE>(X), below for Ultra, features/navbar-<site>.js for the others):
//   read() -> [{ id, label, href, active, badge, panel }]   the site's own items (lib/navlayout.js's vocabulary)
//                              or, for what that has no name for, id 'link:<12 of a-z0-9>' (the same address, the same id), with
//                              icon, panel (a menu, opened through panel(id)) or checked (a boolean: a switch, driven through go(id))
//   go(id) -> bool             open one through the site's own link     brand() -> { src, name }    avatar() -> url
//   home() -> id               the logo's item                          main(doc) -> the main element of doc (the page, or the course tab's frame on screen)
//   observe(fn), unobserve()   call fn when the site's nav changes
//   inCourse() -> bool         (optional) a course is open
//   menu(doc) -> { name, color, items: [{ key, label, href, active, badge, tab }] } | null   (optional) the open course's own
//                              menu, read from doc (the page, or the course tab's frame on screen)
//   panel(id) -> Promise<{ title, filter, sections: [{ label, rows: [{ label, sub, href, color, icon, badge, current,
//                run, tab }] }], foot: [rows], empty } | null>   (optional) an item marked panel, drawn as Glaze's panel
//   current(href) -> bool      (optional) a panel link's current state, including cached and already drawn rows
//   run(what)                  (optional) a panel row's action that isn't a link (signing out)
var GZ_NAVBAR_UI = globalThis.GZ_NAVBAR_UI || (() => {
  const X = globalThis.GZ_CTX, M = GZ_NAVBAR, L = GZ_NAV_LAYOUT, N = GZ_NAV_ITEMS, html = document.documentElement;
  const isPreview = /-extension:$/.test(location.protocol);
  const site = { ultra: globalThis.GZ_NAVBAR_ULTRA, canvas: globalThis.GZ_NAVBAR_CANVAS, moodle: globalThis.GZ_NAVBAR_MOODLE }[X.site]?.(X) || null;
  const t = (k, v) => X.t(k, v);
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
  const part = (e, name) => { e.setAttribute('part', name); return e; };
  const put = (e, ...kids) => { e.append(...kids.filter((k) => k != null)); return e; };
  const icon = (name, cls) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('part', 'icon');
    if (cls) svg.setAttribute('class', cls);
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', M.ICONS[name] || M.ICONS.link);
    svg.append(path); return svg;
  };
  const get = (keys) => new Promise((res) => { try { chrome.storage.sync.get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } });
  let itemRead = 0;
  const readItems = () => {
    const n = ++itemRead;
    return Promise.all([get(['navbarItems', 'navItems']), new Promise((res) => {
      try { chrome.storage.local.get('freshDefaults', (r) => res(r?.freshDefaults?.fresh === true)); } catch { res(false); }
    })]).then(([r, fresh]) => {
      if (n !== itemRead) return;
      prefs = M.initial(r.navbarItems, r.navItems, fresh); legacy = r.navItems ? N.clean(r.navItems) : null; sig = ''; sync();
    });
  };
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const plain = (e) => !e.button && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  const wide = () => matchMedia('(min-width: 900px)').matches;
  const rtl = () => host?.getAttribute('dir') === 'rtl';

  let host = null, root, el = {}, sizes = null, model = null, rows = [], sig = '', prefs = M.clean(), legacy = null, read = false, lay = null, words = '';
  let rail = null, applied = null, peek = false, shown = false, sheetOpen = false, menu = '', enter = 0, leave = 0, queued = 0, placed = false, frame = 0, sleeping = false, measured = '';
  let cmenu = null, panel = '', panelFrom = null, panelFromId = '', panelTurn = 0; // panelFromId: the item it came from by id, for when the bar is drawn again
  let wx = null, docked = false; // Glaze's widgets (features/navbar-widgets.js), once any is on; the dock open over the page
  const skipMain = new Set(); // Elements given a temporary focus target by Skip to content.
  const mainAt = () => { try { return site.main(tabsApi()?.doc?.() || document); } catch { return site.main(); } };
  const panels = new Map(); // id -> { at, data }: a panel's rows, kept a minute
  const listeners = new Map(), mods = new Map(); // event -> Set(fn); owner -> Map(id -> item)
  const emit = (event, data) => { for (const fn of listeners.get(event) || []) { try { fn(data); } catch { /* one listener's error isn't the bar's */ } } };
  const settings = () => X.settings().navbar || {};
  const on = () => !(X.site === 'canvas' && /^\/(?:login|logout)(?:\/|$)/.test(location.pathname)) && !sleeping && !!site && !!chrome.runtime?.id && X.on() && X.settings().enabled && !!settings().on && (isPreview || window.top === window);
  const tabsApi = () => (X.settings().enhance?.tabs && globalThis.GZ_CTABS?.bar) || null;
  // Inside a course: its own page, or one of Glaze's course tabs showing over the page.
  // A course tab's frame on screen is in a course; Canvas's frame for its pages outside one ('page') is not, whatever page it covers.
  const inCourse = () => { const shown = globalThis.GZ_CTABS?.showing?.(); return shown ? shown !== 'page' : !!site?.inCourse?.(); };
  const byId = (id) => model?.items.find((i) => i.id === id) || cmenu?.items.find((i) => i.id === id) || null;
  // A page of this site: through the course tabs where they run (into the course's frame, or leaving it), else a load.
  const openHere = (href) => { const api = tabsApi(); if (!api?.open || api.open(href) === false) location.assign(href); };
  const safeHref = (href) => { if (typeof href !== 'string' || !href.trim()) return null; try { const u = new URL(href, location.href); return !u.username && !u.password && (/^https?:$/.test(u.protocol) || isPreview && u.protocol === location.protocol && u.host === location.host) ? u : null; } catch { return null; } };
  const sameSite = (href) => { const u = safeHref(href); return !!u && (u.origin === location.origin || isPreview && u.protocol === location.protocol && u.host === location.host); };
  // The open course's own menu, from the page or the course tab's frame on screen: its pages, each with an icon by what it is.
  const readMenu = () => {
    if (settings().cmenu === false || !site?.menu || !inCourse()) return null;
    let m = null;
    try { m = site.menu(tabsApi()?.doc?.() || document); } catch { return null; }
    const items = (Array.isArray(m?.items) ? m.items : []).filter((x) => x && typeof x.label === 'string' && typeof x.href === 'string' && sameSite(x.href))
      .map((x, at) => ({ id: `cm:${at}`, key: String(x.key || ''), label: x.label.replace(/\s+/g, ' ').trim().slice(0, 60), href: x.href, active: !!x.active, tab: x.tab === true, badge: typeof x.badge === 'string' || typeof x.badge === 'number' ? String(x.badge).slice(0, 4) : '', icon: M.courseIcon(x.key, x.label), course: true }))
      .filter((x) => x.label);
    return items.length ? { name: String(m.name || '').replace(/\s+/g, ' ').trim().slice(0, 80), color: /^#[0-9a-f]{3,8}$/i.test(m.color || '') ? m.color : '', items } : null;
  };

  // A mod's layout the bar wears (features/mods.js): said quietly beside Customize navigation, with the way back.
  const arranged = () => globalThis.GZ_MODS?.arranger?.() || null;
  const arrangedRow = (role) => {
    const a = arranged();
    if (!a) return [];
    const b = part(make('button', { type: 'button', className: 'row customize' }, icon('layers'), make('span', { textContent: `${t('Arranged by {name}', { name: a.name })} · ${t('Use my own')}` })), 'row arranged');
    b.dataset.act = 'nav-own'; b.dataset.mod = a.id;
    if (role) b.setAttribute('role', role);
    return [b];
  };

  // ---- drawing --------------------------------------------------------------------------------------------------------
  const sep = () => part(make('div', { className: 'divider', role: 'separator' }), 'divider');
  const mount = () => {
    host = make('div', { id: 'gz-navbar', hidden: true });
    root = host.attachShadow({ mode: 'open' });
    const sheet = make('link', { rel: 'stylesheet', href: chrome.runtime.getURL('features/navbar.css') });
    // Unstyled, the bar would flash as a list: it shows once its sheet is in.
    const mounted = host;
    sheet.addEventListener('load', () => { if (host === mounted && on()) { host.hidden = false; placed = false; layout(); } }, { once: true });
    el.skip = part(make('a', { className: 'skip', href: '#', textContent: t('Skip to content') }), 'skip');
    // The rail.
    el.brand = part(make('a', { className: 'brand' }), 'brand');
    el.top = make('div', { className: 'slot' }); el.top.dataset.slot = 'top';
    el.wtop = make('div', { className: 'widgets wtop' }); el.wbottom = make('div', { className: 'widgets wbottom' });
    el.dock = part(make('div', { className: 'dock', role: 'group', id: 'gz-navbar-widgets' }), 'dock');
    el.dock.setAttribute('aria-label', t('Widgets')); el.dock.tabIndex = -1;
    el.ind = part(make('span', { className: 'ind', hidden: true }), 'indicator');
    el.list = make('div', { className: 'list' });
    el.list.addEventListener('scroll', () => listScroll(), { passive: true });
    el.bottom = make('div', { className: 'slot' }); el.bottom.dataset.slot = 'bottom';
    el.account = make('div', { className: 'foot' });
    el.toggle = part(make('button', { type: 'button', className: 'item toggle' }, icon('chevron')), 'toggle');
    el.pin = part(make('button', { type: 'button', className: 'item pin label' }, icon('pin'), make('span')), 'toggle pin');
    el.pin.style.setProperty('--i', 9);
    el.out = part(make('button', { type: 'button', className: 'item out label' }, icon('signout')), 'item signout');
    el.out.dataset.id = 'logout';
    el.rail = part(make('nav', { className: 'rail' }, el.brand, el.wtop, el.top, el.list, make('div', { className: 'fill' }), el.wbottom, el.dock, el.bottom, el.account,
      make('div', { className: 'controls' }, el.toggle, el.pin, el.out)), 'bar rail');
    // The top bar: its items (what doesn't fit goes under More), the course tabs, the account.
    el.tbrand = part(make('a', { className: 'brand' }), 'brand');
    el.tind = part(make('span', { className: 'tind', hidden: true }), 'indicator');
    el.titems = make('div', { className: 'titems' });
    el.tmore = part(make('button', { type: 'button', className: 'item tmore' }, icon('more'), make('span', { className: 'label', textContent: t('More') })), 'item more');
    el.tmore.setAttribute('aria-haspopup', 'menu');
    el.ttabs = make('div', { className: 'ttabs' });
    // A wheel turned over the course tabs moves them along (a mouse has no sideways wheel), smoothly, never the page.
    el.ttabs.addEventListener('wheel', (e) => {
      const box = el.ttabs;
      if (e.ctrlKey || box.scrollWidth <= box.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      box.scrollBy({ left: (rtl() ? -1 : 1) * e.deltaY * (e.deltaMode === 1 ? 32 : 1), behavior: e.deltaMode === 0 && Math.abs(e.deltaY) < 40 ? 'auto' : 'smooth' });
    }, { passive: false });
    el.ttabs.addEventListener('scroll', () => tabsScroll(), { passive: true });
    el.tdock = part(make('button', { type: 'button', className: 'tdock', hidden: true }, icon('layers')), 'item widgets');
    el.tdock.dataset.act = 'widgets'; el.tdock.setAttribute('aria-haspopup', 'dialog'); el.tdock.setAttribute('aria-controls', el.dock.id); el.tdock.setAttribute('aria-label', t('Widgets')); el.tdock.dataset.tip = t('Widgets');
    el.twidgets = make('div', { className: 'twidgets' }, el.tdock);
    el.swidgets = make('div', { className: 'swidgets' });
    el.tacc = part(make('button', { type: 'button', className: 'tacc' }), 'account');
    el.tacc.setAttribute('aria-haspopup', 'menu');
    el.topbar = part(make('nav', { className: 'topbar' }, el.tbrand, make('div', { className: 'tlist' }, el.tind, el.titems, el.tmore), el.ttabs, el.twidgets, el.tacc), 'bar top');
    // Inside a course: its own menu, as a second row under the top bar.
    el.tsub = part(make('nav', { className: 'tsub', hidden: true }), 'bar course-menu');
    // A site's own menus (Courses, Account, Help…), drawn by Glaze beside the rail, under the top bar, or as a sheet.
    el.panel = part(make('div', { className: 'panel', role: 'dialog', hidden: true }), 'panel');
    el.menu = part(make('div', { className: 'menu', role: 'menu', hidden: true }), 'menu');
    el.tip = make('div', { className: 'tip' }); el.tip.setAttribute('aria-hidden', 'true');
    // Phones.
    el.pill = part(make('span', { className: 'pill', hidden: true }), 'indicator');
    el.tabs = part(make('nav', { className: 'tabs' }, el.pill), 'bar tabs');
    el.sheet = part(make('dialog', { className: 'sheet', id: 'gz-navbar-more' }), 'sheet');
    el.sheet.setAttribute('aria-modal', 'true');
    for (const n of [el.rail, el.topbar, el.tabs]) n.setAttribute('aria-label', t('Glaze navigation'));
    el.sheet.setAttribute('aria-label', t('More navigation'));
    root.append(sheet, el.skip, el.rail, el.topbar, el.tsub, el.menu, el.panel, el.tip, el.tabs, el.sheet);
    root.addEventListener('click', click);
    root.addEventListener('auxclick', click);
    root.addEventListener('keydown', key);
    root.addEventListener('focusout', leftPanel);
    el.rail.addEventListener('pointerenter', pointIn);
    el.rail.addEventListener('pointerleave', pointOut);
    el.rail.addEventListener('focusin', focusIn);
    el.rail.addEventListener('focusout', focusOut);
    for (const bar of [el.rail, el.topbar, el.tsub]) {
      for (const ev of ['pointerover', 'focusin']) bar.addEventListener(ev, tipFor);
      for (const ev of ['pointerout', 'focusout']) bar.addEventListener(ev, () => tip(null));
    }
    el.sheet.addEventListener('cancel', (e) => { e.preventDefault(); sheetTo(false); });
    el.sheet.addEventListener('click', (e) => {
      const r = el.sheet.getBoundingClientRect();
      if (e.target === el.sheet && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) sheetTo(false);
    });
    // First in the page, as the site's own navigation it stands in for: keyboard and screen-reader order meet it, and its
    // Skip to content, before the page (it's fixed, so nothing moves on screen).
    (document.body || html).prepend(host);
    if (typeof ResizeObserver === 'function') {
      sizes = new ResizeObserver(() => { if (host === mounted) { measured = ''; queue(); } });
      for (const box of [el.tbrand, el.titems, el.ttabs, el.twidgets]) sizes.observe(box);
    }
    site.observe(queue);
  };

  const badge = (text) => part(make('span', { className: 'badge', textContent: text }), 'badge');
  const label = (text, i) => { const s = part(make('span', { className: 'label', textContent: text }), 'label'); if (i !== undefined) s.style.setProperty('--i', i); return s; };
  // One item: a link where it goes somewhere (open in a new tab works), a button where Glaze does something.
  const node = (item, cls, partName) => {
    const link = item.href && !item.action && !item.panel;
    const e = make(link ? 'a' : 'button', { className: cls });
    if (link) { e.href = item.href; if (item.tab) { e.target = '_blank'; e.rel = 'noopener noreferrer'; } } else e.type = 'button';
    e.dataset.id = item.id;
    part(e, item.active ? `${partName} active` : partName);
    if (item.switch) { e.setAttribute('role', 'switch'); e.setAttribute('aria-checked', String(!!item.checked)); e.disabled = !!item.disabled; part(e, `${partName} switch${item.checked ? ' switch-on' : ''}`); }
    if (item.active) e.setAttribute('aria-current', 'page');
    if (item.by) { const from = t('From {name}', { name: item.by }); e.setAttribute('aria-description', from); e.setAttribute('title', from); }
    // A worn Look's link that leaves the site says where it goes, in its name too: the Look's "Grades" isn't the school's.
    if (item.from) { const from = fromHost(item); e.setAttribute('aria-label', `${item.label} · ${from}`); e.setAttribute('title', from); }
    return e;
  };
  const fromHost = (item) => (item.from ? t('From {name}', { name: item.from }) : '');
  const badgeOf = (item) => (settings().badges !== false && item.badge ? item.badge : '');
  const barItem = (item, i) => {
    const e = node(item, 'item', 'item');
    const b = badgeOf(item);
    put(e, icon(item.icon), label(item.label, i), b ? badge(b) : null);
    e.dataset.tip = [item.label, b, item.by, fromHost(item)].filter(Boolean).join(' · ');
    return e;
  };
  const initials = (name) => [...(name.match(/\p{L}[\p{L}'’-]*/gu) || [])].filter((w, i, a) => i === 0 || i === a.length - 1).map((w) => [...w][0].toUpperCase()).join('') || [...name.trim()][0] || '?';
  // A course's mark: two letters of its name (a code like 202640-SPAN1100-802 gives SP), never digits.
  const mark = (name) => { const w = name.match(/\p{L}+/gu) || []; return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || name).slice(0, 2)).toUpperCase(); };
  const avatar = (account) => {
    const a = part(make('span', { className: 'avatar' }), 'avatar');
    const src = site.avatar?.();
    if (src) a.append(make('img', { src, alt: '' })); else a.textContent = initials(account.label);
    return a;
  };
  // A course tab: its colour and initials, its name, and on hover or focus its pin and close buttons.
  const courseTab = (r, cls, i) => {
    const go = part(make('button', { type: 'button', className: `${cls} ctab-go` }), r.cur ? 'course-tab active' : 'course-tab');
    go.dataset.act = 'tab'; go.dataset.cid = r.cid;
    if (r.cur) go.setAttribute('aria-current', 'page');
    const dot = part(make('span', { className: 'dot', textContent: mark(r.label) }), 'course-dot');
    if (r.color) dot.style.setProperty('--c', r.color);
    put(go, dot, label(r.label, i), r.pin ? icon('pin', 'pinned') : null);
    go.dataset.tip = r.full;
    go.setAttribute('aria-label', r.pin ? t('{name}, pinned', { name: r.full }) : r.full);
    const pin = make('button', { type: 'button', className: 'ctab-do' }, icon('pin'));
    pin.dataset.act = 'tab-pin'; pin.dataset.cid = r.cid; pin.setAttribute('aria-label', `${t(r.pin ? 'Unpin tab' : 'Pin tab')} · ${r.label}`);
    const x = make('button', { type: 'button', className: 'ctab-do' }, icon('close'));
    x.dataset.act = 'tab-close'; x.dataset.cid = r.cid; x.setAttribute('aria-label', `${t('Close tab')} · ${r.label}`);
    const wrap = part(make('div', { className: 'ctab' }, go, make('span', { className: 'ctab-tools' }, pin, x)), 'course-tab-row');
    wrap.dataset.cid = r.cid;
    return wrap;
  };
  // The student's own logo: a picture kept on this device (storage.local navLogo:<nav.li>, which Settings writes), drawn from
  // a blob: address made here. Until it is read, and on a device without it, the Glaze logo stands in.
  let logo = { id: '', url: '' };
  const clearLogo = () => {
    if (logo.url) URL.revokeObjectURL(logo.url);
    logo = { id: '', url: '' };
  };
  const ownLogo = () => {
    const id = settings().brand === 'custom' ? X.settings().nav?.li || '' : '';
    if (id === logo.id) return logo.url;
    clearLogo();
    const request = logo = { id, url: '' };
    if (id) try {
      chrome.storage.local.get(`navLogo:${id}`, (r) => {
        const src = r?.[`navLogo:${id}`];
        if (chrome.runtime.lastError || logo !== request || !on() || typeof src !== 'string' || src.length > 400000 || !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(src)) return;
        try {
          const [type, bytes] = src.split(',');
          logo.url = URL.createObjectURL(new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], { type: type.slice(5, type.indexOf(';')) }));
        } catch { return; } // malformed bytes leave the Glaze logo in place
        sig = ''; if (host) sync();
      });
    } catch { /* reloaded */ }
    return '';
  };
  const brandInto = (a) => {
    const brand = site.brand(), mode = settings().brand || 'glaze', home = byId(site.home());
    const own = ownLogo(), src = own || (mode === 'school' && brand.src);
    a.hidden = mode === 'none';
    a.href = home?.href || '/';
    a.dataset.id = home?.id || '';
    a.setAttribute('aria-label', home ? `${home.label} · ${brand.name || 'Glaze'}` : brand.name || 'Glaze');
    a.replaceChildren(src ? make('img', { className: own ? 'logo own' : 'logo', src, alt: '' }) : glazeLogo());
    if (!src) a.append(make('span', { className: 'label' }, make('b', { textContent: 'Glaze' }), brand.name ? make('small', { textContent: brand.name }) : null));
  };
  // Glaze's widgets where the bar is: the rail (its top or its bottom), the top bar's row, or a phone's sheet. A widget is
  // moved only when its place changes (a pet, a running timer or a focused button stay as they are).
  const fill = (box, kids) => { if (kids.length !== box.childNodes.length || kids.some((k, i) => box.childNodes[i] !== k)) box.replaceChildren(...kids); };
  const placeWidgets = () => {
    const ws = wx ? model.widgets.filter((w) => wx.nodes.has(w.id)) : [], box = (w) => wx.nodes.get(w.id).box;
    const phone = !wide(), top = !phone && lay.place === 'top';
    fill(el.wtop, phone || top ? [] : ws.filter((w) => w.at === 'top').map(box));
    fill(el.wbottom, phone || top ? [] : ws.filter((w) => w.at !== 'top').map(box));
    fill(el.twidgets, [...(top ? ws.map(box) : []), el.tdock]);
    fill(el.swidgets, phone ? ws.map(box) : []);
    el.tdock.hidden = !el.dock.childElementCount;
    el.tdock.setAttribute('aria-expanded', String(docked));
  };
  const render = () => {
    const active = root.activeElement, pane = active?.closest('.rail, .topbar, .tsub, .tabs, .sheet, .menu'), focused = active?.dataset?.id, focusedTab = active?.dataset?.cid && `${active.dataset.act}|${active.dataset.cid}`;
    const focusedCourse = focused?.startsWith('cm:') && active.href;
    const tabAt = focusedTab ? [...pane.querySelectorAll('.ctab-go')].findIndex((e) => e.dataset.cid === active.dataset.cid) : -1, wasMenu = menu;
    brandInto(el.brand); brandInto(el.tbrand);
    // The rail: groups, a divider between, the course tabs, the active marker that glides from item to item.
    let i = 1;
    const kids = [el.ind];
    model.groups.forEach((g, at) => {
      if (at) kids.push(sep());
      const group = part(make('div', { className: 'group' }), 'group');
      group.dataset.group = g.id;
      if (g.label) group.append(part(make('div', { className: 'group-label', textContent: g.label }), 'group-label'));
      for (const item of g.items) group.append(barItem(item, i++));
      kids.push(group);
    });
    const courseLabel = () => {
      const l = part(make('div', { className: 'group-label cm-name', textContent: cmenu.name || t('This course') }), 'group-label');
      if (cmenu.color) l.style.setProperty('--c', cmenu.color);
      return l;
    };
    if (cmenu) {
      kids.push(sep());
      const group = part(make('div', { className: 'group cmenu', role: 'group' }), 'group course-menu');
      group.setAttribute('aria-label', cmenu.name || t('This course'));
      group.append(courseLabel());
      for (const item of cmenu.items) group.append(barItem(item, i++));
      kids.push(group);
    }
    if (lay.tabs && rows.length) {
      kids.push(sep());
      const group = part(make('div', { className: 'group courses', role: 'group' }), 'group course-tabs');
      group.setAttribute('aria-label', t('Course tabs'));
      group.append(part(make('div', { className: 'group-label', textContent: t('Course tabs') }), 'group-label'));
      for (const r of rows) group.append(courseTab(r, 'item', i++));
      kids.push(group);
    }
    el.list.replaceChildren(...kids);
    el.top.replaceChildren(...model.slots.top.map((item) => barItem(item, i++)));
    el.bottom.replaceChildren(...model.slots.bottom.map((item) => barItem(item, i++)));
    const acc = model.account;
    if (acc) {
      const a = node(acc, 'item account', 'account');
      a.append(avatar(acc), make('span', { className: 'label' }, make('b', { textContent: acc.label }), make('small', { textContent: t('Account') })));
      a.querySelector('.label').style.setProperty('--i', i);
      a.dataset.tip = t('Your account');
      a.setAttribute('aria-label', `${acc.label} · ${t('Your account')}`);
      el.account.replaceChildren(a);
    } else el.account.replaceChildren();
    el.out.hidden = !model.signout;
    if (model.signout) { el.out.setAttribute('aria-label', model.signout.label); el.out.dataset.tip = model.signout.label; }
    // The top bar: every item in a row (fit() moves what doesn't fit under More), the course tabs, the account's menu.
    el.titems.replaceChildren(...model.groups.flatMap((g, at) => [...(at ? [part(make('span', { className: 'tsep', role: 'separator' }), 'divider')] : []), ...g.items.map((item) => barItem(item))]),
      ...[...model.slots.top, ...model.slots.bottom].map((item) => barItem(item)));
    el.ttabs.replaceChildren(...(lay.tabs ? rows.map((r) => courseTab(r, 'chip')) : []));
    el.tsub.replaceChildren(...(lay.menu && cmenu ? [courseLabel(), ...cmenu.items.map((item) => barItem(item))] : []));
    el.tsub.setAttribute('aria-label', cmenu?.name || t('This course'));
    el.ttabs.hidden = !(lay.tabs && rows.length);
    el.ttabs.setAttribute('role', 'group'); el.ttabs.setAttribute('aria-label', t('Course tabs'));
    el.tacc.hidden = !acc && !model.signout;
    el.tacc.replaceChildren(acc ? avatar(acc) : icon('account'));
    el.tacc.setAttribute('aria-label', acc ? `${acc.label} · ${t('Your account')}` : t('Your account'));
    el.tacc.dataset.tip = el.tacc.getAttribute('aria-label');
    // Phones: four tabs and More; the rest in the sheet with the course tabs, the account, signing out and the editor.
    const tabs = model.tabs.map((item) => {
      const e = node(item, 'tab', 'tab');
      const b = badgeOf(item);
      return put(e, icon(item.icon), make('span', { textContent: item.label }), b ? badge(b) : null);
    });
    el.more = part(make('button', { type: 'button', className: 'tab more' }, icon('more'), make('span', { textContent: t('More') })), 'tab more');
    el.more.setAttribute('aria-haspopup', 'dialog'); el.more.setAttribute('aria-expanded', String(sheetOpen)); el.more.setAttribute('aria-controls', el.sheet.id);
    el.tabs.replaceChildren(el.pill, ...tabs, el.more);
    const row = (item) => { const b = badgeOf(item); return put(node(item, 'row', 'row'), icon(item.icon), make('span', { textContent: item.label }), b ? badge(b) : null); };
    placeWidgets();
    const sheetRows = [make('div', { className: 'handle' }), ...(el.swidgets.childElementCount ? [el.swidgets] : [])];
    model.sheet.forEach((g, at) => { if (at) sheetRows.push(sep()); sheetRows.push(...g.items.map(row)); });
    if (cmenu) { sheetRows.push(sep(), courseLabel(), ...cmenu.items.map(row)); }
    if (lay.tabs && rows.length) { sheetRows.push(sep(), make('div', { className: 'group-label', textContent: t('Course tabs') }), ...rows.map((r) => courseTab(r, 'row'))); }
    if (el.dock.childElementCount) {
      const dock = part(make('button', { type: 'button', className: 'row' }, icon('layers'), make('span', { textContent: t('Widgets') })), 'row widgets');
      dock.dataset.act = 'widgets'; dock.setAttribute('aria-haspopup', 'dialog'); dock.setAttribute('aria-controls', el.dock.id); dock.setAttribute('aria-expanded', String(docked));
      sheetRows.push(sep(), dock);
    }
    sheetRows.push(sep());
    if (acc) sheetRows.push(row({ ...acc, label: t('Account') }));
    if (model.signout) sheetRows.push(row(model.signout));
    const custom = part(make('button', { type: 'button', className: 'row customize' }, icon('settings'), make('span', { textContent: t('Customize navigation') })), 'row customize');
    custom.dataset.act = 'customize';
    sheetRows.push(custom, ...arrangedRow());
    el.sheet.replaceChildren(...sheetRows);
    if (menu) menuTo('', false);
    for (const e of root.querySelectorAll('[data-id]')) if (byId(e.dataset.id)?.panel) { e.setAttribute('aria-haspopup', 'dialog'); e.setAttribute('aria-expanded', String(panel === e.dataset.id)); }
    placed = false;
    layout();
    if (wasMenu && lay.place === 'top' && wide() && !(wasMenu === 'more' ? el.tmore : el.tacc).hidden) menuTo(wasMenu, false);
    const restore = active === el.brand || active === el.tbrand ? active
      : focusedTab ? pane?.querySelector(`[data-act="${focusedTab.split('|')[0]}"][data-cid="${CSS.escape(focusedTab.split('|')[1])}"]`)
        : focusedCourse ? [...(pane?.querySelectorAll('[data-id]') || [])].find((e) => e.dataset.id.startsWith('cm:') && e.href === focusedCourse)
          : focused ? pane?.querySelector(`[data-id="${CSS.escape(focused)}"]:not(.brand)`) : active?.classList.contains('more') ? el.more : active?.dataset.act === 'customize' ? pane?.querySelector('[data-act="customize"]') : null;
    const nearby = tabAt >= 0 ? [...pane.querySelectorAll('.ctab-go')].at(Math.min(tabAt, pane.querySelectorAll('.ctab-go').length - 1)) || pane.querySelector('a, button') : null;
    const target = restore || nearby || (active?.isConnected ? active : sheetOpen ? el.sheet.querySelector('a[href], button:not([disabled])') : wasMenu ? el.menu.querySelector('a, button') || (wasMenu === 'more' ? el.tmore : el.tacc) : null);
    if (target?.getClientRects().length) target.focus({ preventScroll: true });
  };
  let logos = 0;
  const glazeLogo = () => {
    const id = `gz-nb-drop-${++logos}`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 128 128'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'logo');
    const el = (tag, attrs, ...kids) => { const n = document.createElementNS(svg.namespaceURI, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };
    svg.append(el('defs', {}, el('linearGradient', { id, x1: '0.1', y1: '0', x2: '0.9', y2: '1' }, el('stop', { offset: '0', 'stop-color': '#6fdcff' }), el('stop', { offset: '1', 'stop-color': '#17c8f4' }))),
      el('rect', { width: '128', height: '128', rx: '30', fill: '#0d1b2e' }), el('path', { d: 'M64 18C64 18 28 59 28 80a36 36 0 0 0 72 0C100 59 64 18 64 18Z', fill: `url(#${id})` }),
      el('ellipse', { cx: '79', cy: '76', rx: '10', ry: '15', transform: 'rotate(20 79 76)', fill: '#fff', opacity: '.55' }));
    return svg;
  };

  // ---- state: where and how, the peek, the page's room, the markers --------------------------------------------------
  // The page's room and <html data-gz-navbar> (theme.css reads both); the course tabs' strip steps aside when the bar has them.
  const room = () => {
    X.setVar('--gz-navbar-left', `${lay.left}px`);
    X.setVar('--gz-navbar-top', `${lay.top}px`);
    if (lay.words === words) return;
    words = lay.words;
    html.setAttribute('data-gz-navbar', words);
    tabsApi()?.place(); // 'auto' follows top/rail changes too, even if both hold tabs
  };
  const geometry = () => JSON.stringify([innerWidth, innerHeight, host?.dir, host?.hasAttribute('data-footer'), X.settings().look]);
  const layout = () => {
    if (!host) return;
    host.dataset.place = lay.place;
    host.dataset.style = lay.style;
    const pin = lay.open, open = pin || (peek && lay.place === 'rail');
    el.rail.toggleAttribute('data-open', open);
    el.rail.toggleAttribute('data-peek', peek && !pin);
    el.toggle.setAttribute('aria-expanded', String(open));
    el.toggle.setAttribute('aria-label', t(open ? 'Collapse navigation' : 'Expand navigation'));
    el.toggle.dataset.tip = el.toggle.getAttribute('aria-label');
    // Inside a course set to icons, the rail can't be pinned open there: the setting decides.
    el.pin.hidden = inCourse() && settings().course === 'icons';
    el.toggle.hidden = el.pin.hidden;
    // One name, pressed or not: a screen reader says "Pin open, pressed" once it's pinned, not a new name and the state.
    el.pin.setAttribute('aria-pressed', String(pin));
    el.pin.lastElementChild.textContent = t('Pin open');
    el.tsub.hidden = !(lay.menu && cmenu && lay.place === 'top' && wide());
    room();
    if (panel) placePanel();
    if (docked) { if (lay.place === 'rail' && wide() || lay.place === 'none' || !el.dock.childElementCount) dockTo(false, false); else placeDock(); }
    if (open !== shown) { shown = open; emit(open ? 'expand' : 'collapse', {}); if (open) tip(null); }
    if (host.hidden) return;
    const moved = measured !== geometry();
    measured = geometry();
    if (lay.place === 'top' && wide()) { fit(); if (!placed) tabsReveal(); }
    if (lay.place === 'rail' && wide()) { if (!placed || moved) listReveal(); listScroll(); }
    // The markers glide; the first placement after a redraw doesn't (it would slide in from the top).
    const still = !placed;
    const glide = (ind, target, horizontal) => {
      ind.hidden = !target;
      if (!target) return;
      if (still) ind.style.transition = 'none';
      if (horizontal) { ind.style.setProperty('--x', `${target.offsetLeft}px`); ind.style.setProperty('--w', `${target.offsetWidth}px`); } else ind.style.setProperty('--y', `${target.offsetTop}px`);
    };
    const current = (box) => box.querySelector('.cmenu .item[aria-current="page"]') || box.querySelector('.item[aria-current="page"]:not([data-over])') || box.querySelector('.ctab-go[aria-current="page"]');
    glide(el.ind, current(el.list), false);
    glide(el.tind, el.titems.querySelector('.item[aria-current="page"]:not([data-over])'), true);
    const tabs = [...el.tabs.querySelectorAll('.tab')];
    const at = tabs.findIndex((e) => e.getAttribute('aria-current') === 'page');
    const target = tabs[at >= 0 ? at : model.sheet.some((g) => g.items.some((i) => i.active)) || rows.some((r) => r.cur) ? tabs.length - 1 : -1];
    for (const e of tabs) e.toggleAttribute('data-active', e === target);
    el.pill.hidden = !target;
    if (target && target.offsetWidth) {
      if (still) el.pill.style.transition = 'none';
      el.pill.style.setProperty('--w', `${target.offsetWidth}px`);
      el.pill.style.setProperty('--x', `${rtl() ? target.offsetLeft + target.offsetWidth - el.tabs.clientWidth + 6 : target.offsetLeft - 6}px`);
    }
    if (still) { placed = true; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { frame = 0; if (!host) return; for (const ind of [el.ind, el.tind, el.pill]) ind.style.transition = ''; }); }
  };
  // The top bar's row: labels go first (icons with a tip), then the last items, under More, until it fits.
  // The course tabs share the row: when they'd be squeezed below their shrunk size (92px each), labels go first too.
  const fit = () => {
    const box = el.titems, items = [...box.querySelectorAll('.item')];
    el.tmore.hidden = true;
    el.topbar.removeAttribute('data-compact');
    for (const e of items) e.removeAttribute('data-over');
    const separators = [...box.querySelectorAll('.tsep')];
    for (const s of separators) s.hidden = false;
    const over = () => box.scrollWidth > box.clientWidth + 1;
    const squeezed = () => !el.ttabs.hidden && el.ttabs.scrollWidth > el.ttabs.clientWidth + 1;
    if (over() || squeezed()) el.topbar.setAttribute('data-compact', '');
    tabsScroll();
    if (!over()) return;
    el.tmore.hidden = false;
    for (let n = items.length - 1; n >= 0 && over(); n--) {
      items[n].setAttribute('data-over', '');
      for (const s of separators) s.hidden = !s.nextElementSibling || s.nextElementSibling.hasAttribute('data-over');
    }
  };
  // The course tabs' row, when it scrolls: which edges fade, and the open course's tab kept in view.
  const tabsScroll = () => {
    const box = el.ttabs, max = box.scrollWidth - box.clientWidth;
    if (max <= 1) { box.removeAttribute('data-scroll'); return; }
    const at = Math.abs(box.scrollLeft);
    box.setAttribute('data-scroll', [at > 1 ? 'start' : '', at < max - 1 ? 'end' : ''].join(' ').trim());
  };
  const tabsReveal = () => {
    const box = el.ttabs, cur = box.querySelector('.ctab-go[aria-current="page"]')?.closest('.ctab');
    if (!cur || box.scrollWidth <= box.clientWidth + 1) return;
    const b = box.getBoundingClientRect(), r = cur.getBoundingClientRect();
    if (r.left < b.left + 28) box.scrollLeft -= b.left + 28 - r.left; else if (r.right > b.right - 28) box.scrollLeft += r.right - (b.right - 28);
  };
  // The rail's list, on a window too short for it, scrolls with no bar: the same fade at the edges it goes on past, and
  // where the student is kept in view (a course's page, else the open course's tab, else the bar's item), on a redraw and
  // when the window changes size.
  const listScroll = () => {
    const box = el.list, max = box.scrollHeight - box.clientHeight;
    if (max <= 1) { box.removeAttribute('data-scroll'); return; }
    box.setAttribute('data-scroll', [box.scrollTop > 1 ? 'start' : '', box.scrollTop < max - 1 ? 'end' : ''].join(' ').trim());
  };
  const listReveal = () => {
    const box = el.list, cur = box.querySelector('.cmenu .item[aria-current="page"]') || box.querySelector('.ctab-go[aria-current="page"]') || box.querySelector('.item[aria-current="page"]');
    if (!cur || box.scrollHeight <= box.clientHeight + 1) return;
    const b = box.getBoundingClientRect(), r = cur.getBoundingClientRect();
    if (r.top < b.top + 28) box.scrollTop -= b.top + 28 - r.top; else if (r.bottom > b.bottom - 28) box.scrollTop += r.bottom - (b.bottom - 28);
  };
  // A tip shown stays until the pointer or focus leaves, and Escape dismisses it wherever focus is (WCAG 1.4.13).
  const escapeTip = (e) => { if (e.key === 'Escape') tip(null); };
  const tip = (target) => {
    if (!el.tip) return;
    const vertical = lay?.place === 'top';
    if (!target || !wide() || (!vertical && shown) || (vertical && !el.topbar.hasAttribute('data-compact') && !target.classList.contains('tacc') && !target.classList.contains('ctab-go') && !target.closest('.twidgets'))) { el.tip.removeAttribute('data-on'); document.removeEventListener('keydown', escapeTip, true); return; }
    const r = target.getBoundingClientRect();
    el.tip.textContent = target.dataset.tip;
    el.tip.toggleAttribute('data-below', vertical);
    el.tip.style.left = `${vertical ? r.left + r.width / 2 : rtl() ? r.left - 10 : r.right + 10}px`;
    el.tip.style.top = `${vertical ? r.bottom + 8 : r.top + r.height / 2}px`;
    // Kept on screen: a tip under the top bar's last item would run off the window's edge.
    if (vertical) { const half = el.tip.offsetWidth / 2; el.tip.style.left = `${Math.max(8 + half, Math.min(innerWidth - 8 - half, r.left + r.width / 2))}px`; }
    el.tip.setAttribute('data-on', '');
    document.addEventListener('keydown', escapeTip, true);
  };
  const tipFor = (e) => { const target = e.composedPath().find((n) => n.dataset?.tip); if (target && !target.hasAttribute('data-over')) tip(target); };
  const peekTo = (v) => { clearTimeout(enter); clearTimeout(leave); enter = leave = 0; if (peek !== v) { peek = v; if (lay) layout(); } };
  const pointIn = (e) => {
    clearTimeout(leave); leave = 0;
    if (e.pointerType === 'touch' || lay.open || settings().peek === false || !matchMedia('(hover: hover)').matches) return;
    enter = setTimeout(() => { enter = 0; peekTo(true); }, 120);
  };
  const pointOut = (e) => {
    if (e.pointerType === 'touch') return;
    clearTimeout(enter); enter = 0;
    leave = setTimeout(() => { leave = 0; if (!el.rail.contains(root.activeElement)) peekTo(false); }, 220);
  };
  const focusIn = (e) => { if (!lay.open && e.target !== el.toggle) peekTo(true); };
  const focusOut = (e) => { if (!el.rail.contains(e.relatedTarget)) { clearTimeout(leave); leave = setTimeout(() => { leave = 0; if (!el.rail.matches(':hover') && !el.rail.contains(root.activeElement)) peekTo(false); }, 220); } };
  // Pinning is saved for every page and tab (the worker writes it); the bar follows at once.
  const pinTo = (open) => {
    rail = open ? 'open' : 'icons';
    peekTo(false);
    sync();
    // The editor's preview shows it without saving: the editor's own control saves.
    if (isPreview) return;
    const mounted = host, choice = rail;
    send({ type: 'glaze:navbar', patch: { rail } }).then((r) => { if (!r?.ok && host === mounted && rail === choice) { rail = null; sync(); } });
  };
  const sheetTo = (open) => {
    if (sheetOpen === open || !host || open && wide()) return;
    if (open) dockTo(false, false);
    sheetOpen = open;
    el.sheet.toggleAttribute('data-open', open);
    if (open) el.sheet.showModal(); else el.sheet.close();
    el.more?.setAttribute('aria-expanded', String(open));
    emit('sheet', { open });
    if (open) el.sheet.querySelector('a[href], button:not([disabled])')?.focus({ preventScroll: true }); else (wide() ? el.toggle : el.more)?.focus({ preventScroll: true });
  };
  // The top bar's menus: More (the items that don't fit) and the account's.
  const menuTo = (which, focus = true) => {
    if (!host) return;
    const from = which === 'more' ? el.tmore : el.tacc, was = menu;
    menu = which;
    el.tmore.setAttribute('aria-expanded', String(which === 'more'));
    el.tacc.setAttribute('aria-expanded', String(which === 'account'));
    if (!which) {
      el.menu.hidden = true; el.menu.replaceChildren();
      document.removeEventListener('pointerdown', outside, true);
      if (focus && was) (was === 'more' ? el.tmore : el.tacc).focus({ preventScroll: true });
      return;
    }
    const entry = (item) => { const e = node(item, 'row', 'menu-item'); e.setAttribute('role', item.switch ? 'menuitemcheckbox' : 'menuitem'); const b = badgeOf(item); return put(e, icon(item.icon), make('span', { textContent: item.label }), b ? badge(b) : null); };
    const items = which === 'more' ? [...el.titems.querySelectorAll('.item[data-over]')].map((e) => byId(e.dataset.id)).filter(Boolean).map(entry)
      : [model.account && entry({ ...model.account, label: t('Account') }), model.signout && entry(model.signout)].filter(Boolean);
    const custom = make('button', { type: 'button', className: 'row customize' }, icon('settings'), make('span', { textContent: t('Customize navigation') }));
    custom.dataset.act = 'customize'; custom.setAttribute('role', 'menuitem');
    el.menu.replaceChildren(...items, sep(), custom, ...arrangedRow('menuitem'));
    el.menu.setAttribute('aria-label', which === 'more' ? t('More') : t('Your account'));
    el.menu.hidden = false;
    const r = from.getBoundingClientRect(), w = el.menu.offsetWidth;
    const x = which === 'account' !== rtl() ? r.right - w : r.left;
    el.menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x))}px`;
    el.menu.style.top = `${r.bottom + 8}px`;
    document.addEventListener('pointerdown', outside, true);
    if (focus) el.menu.querySelector('a, button')?.focus({ preventScroll: true });
  };
  const outside = (e) => { if (!e.composedPath().includes(host)) menuTo('', false); };
  // Mods' widgets with a top bar or on a phone: the rail's dock, open over the page under its button or over the phone's
  // bar. The rail stands invisible around it (features/navbar.css), so the widgets' frames stay where they were.
  const dockTo = (open, focus = true) => {
    if (!host || docked === open || open && (!el.dock.childElementCount || lay.place === 'rail' && wide())) return;
    docked = open;
    host.toggleAttribute('data-dock', open);
    for (const e of root.querySelectorAll('[data-act="widgets"]')) e.setAttribute('aria-expanded', String(open));
    el.dock.setAttribute('role', open ? 'dialog' : 'group');
    if (open) { placeDock(); document.addEventListener('pointerdown', outsideDock, true); if (focus) el.dock.focus({ preventScroll: true }); return; }
    document.removeEventListener('pointerdown', outsideDock, true);
    el.dock.style.left = el.dock.style.top = '';
    if (focus) (wide() ? el.tdock : el.more)?.focus({ preventScroll: true });
  };
  const placeDock = () => {
    if (!docked || !wide()) { el.dock.style.left = el.dock.style.top = ''; return; }
    const r = el.tdock.getBoundingClientRect(), w = el.dock.offsetWidth;
    el.dock.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, rtl() ? r.left : r.right - w))}px`;
    el.dock.style.top = `${r.bottom + 8}px`;
  };
  const outsideDock = (e) => { const path = e.composedPath(); if (!path.includes(el.dock) && !path.includes(el.tdock) && !path.includes(el.sheet)) dockTo(false, false); };

  // ---- panels: a site's own menus, drawn by Glaze ----------------------------------------------------------------------
  // Beside the rail (its full height), under the top bar's item, or on a phone as a sheet over the bottom bar.
  const panelAnchor = () => {
    const same = panelFromId ? root.querySelectorAll(`[data-id="${CSS.escape(panelFromId)}"]:not(.brand)`) : [];
    // A connected opener can still be in a closed More sheet/menu, or in the rail hidden behind a top bar.
    return [panelFrom, ...same].find((e) => e?.isConnected && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
      || (!wide() ? el.more : lay?.place === 'top' ? panelFromId === 'profile' ? el.tacc : el.tmore : el.toggle);
  };
  const placePanel = () => {
    if (!panel || el.panel.hidden) return;
    el.panel.toggleAttribute('data-phone', !wide());
    if (!wide()) { el.panel.style.left = el.panel.style.top = el.panel.style.height = ''; return; }
    const w = el.panel.offsetWidth;
    if (lay.place === 'rail') {
      const r = el.rail.getBoundingClientRect();
      el.panel.style.left = `${rtl() ? r.left - w - 8 : r.right + 8}px`;
      el.panel.style.top = `${r.top}px`;
      el.panel.style.height = `${r.height}px`;
    } else {
      const r = (panelAnchor() || el.topbar).getBoundingClientRect();
      el.panel.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, rtl() ? r.right - w : r.left))}px`;
      el.panel.style.top = `${r.bottom + 8}px`;
      el.panel.style.height = '';
    }
  };
  const panelRow = (r) => {
    const link = r.href && !r.run, current = link && site.current ? site.current(r.href) : r.current;
    const e = part(make(link ? 'a' : 'button', { className: 'row' }), current ? 'panel-row active' : 'panel-row');
    if (link) { e.href = r.href; if (r.tab || !sameSite(r.href)) { e.target = '_blank'; e.rel = 'noopener noreferrer'; } } else { e.type = 'button'; e.dataset.run = r.run || ''; }
    if (current) e.setAttribute('aria-current', 'page');
    const lead = r.color ? part(make('span', { className: 'dot', textContent: mark(r.label) }), 'course-dot') : icon(M.PICKS.includes(r.icon) ? r.icon : 'chevron');
    if (r.color) lead.style.setProperty('--c', r.color);
    const text = make('span', { className: 'text' }, make('span', { className: 'name', textContent: r.label }), r.sub ? make('small', { textContent: r.sub }) : null);
    const b = typeof r.badge === 'string' || typeof r.badge === 'number' ? String(r.badge).slice(0, 4) : '';
    return put(e, lead, text, b ? badge(b) : null);
  };
  const drawPanel = (id, data, state) => {
    const cleanRows = (rows, limit) => (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.label === 'string' && r.label.trim())
      .map((r) => ({ ...r, href: typeof r.href === 'string' ? safeHref(r.href)?.href || '' : '', run: typeof r.run === 'string' ? r.run : '', color: /^#[0-9a-f]{3,8}$/i.test(r.color || '') ? r.color : '' }))
      .filter((r) => r.href || r.run).slice(0, limit);
    const item = byId(id);
    const close = part(make('button', { type: 'button', className: 'close' }, icon('close')), 'panel-close');
    close.dataset.act = 'panel-close'; close.setAttribute('aria-label', t('Close'));
    const title = make('h2', { textContent: data?.title || item?.label || '' });
    const kids = [make('header', {}, title, close)];
    if (state === 'loading') kids.push(make('p', { className: 'note', textContent: t('Loading…') }));
    else if (state === 'error' || !data) {
      const retry = make('button', { type: 'button', className: 'row', textContent: t('Try again') }); retry.dataset.act = 'panel-retry';
      kids.push(make('p', { className: 'note', textContent: t("Couldn't load this. Try again in a moment.") }), retry);
    } else {
      const body = make('div', { className: 'body' });
      const sections = (Array.isArray(data.sections) ? data.sections : []).map((x) => ({ label: x?.label, rows: cleanRows(x?.rows, 200) })).filter((x) => x.rows.length);
      for (const sec of sections) body.append(...(sec.label ? [part(make('div', { className: 'group-label', textContent: sec.label }), 'group-label')] : []), ...sec.rows.map(panelRow));
      if (!sections.length) body.append(make('p', { className: 'note', textContent: data.empty || t('Nothing here yet.') }));
      if (data.filter && sections.reduce((n, x) => n + x.rows.length, 0) > 6) {
        const find = make('input', { type: 'search', className: 'find', placeholder: t('Filter') });
        find.setAttribute('aria-label', t('Filter'));
        find.addEventListener('input', () => { const q = find.value.trim().toLowerCase(); for (const e of body.querySelectorAll('.row')) e.hidden = !!q && !e.textContent.toLowerCase().includes(q); });
        kids.push(find);
      }
      kids.push(body);
      const foot = cleanRows(data.foot, 8);
      if (foot.length) kids.push(make('div', { className: 'foot' }, ...foot.map(panelRow)));
    }
    el.panel.replaceChildren(...kids);
    el.panel.setAttribute('aria-label', title.textContent);
  };
  const panelTo = async (id, from = null, focus = true) => {
    if (!host) return;
    const was = panel, turn = ++panelTurn;
    panel = id || '';
    for (const e of root.querySelectorAll('[aria-haspopup="dialog"][data-id]')) e.setAttribute('aria-expanded', String(e.dataset.id === panel));
    if (!panel) {
      el.panel.hidden = true; el.panel.replaceChildren();
      document.removeEventListener('pointerdown', outsidePanel, true);
      document.removeEventListener('keydown', escapePanel, true);
      // The button it came from, or (the bar redrew its items while the panel was open) the same item drawn again.
      const back = panelAnchor();
      if (focus && was && back) back.focus({ preventScroll: true });
      panelFrom = null; panelFromId = ''; emit('panel', { id: '' });
      return;
    }
    panelFrom = from; panelFromId = from?.dataset?.id || '';
    menuTo('', false); sheetTo(false);
    const kept = panels.get(panel);
    const fresh = kept && Date.now() - kept.at < 60000;
    drawPanel(panel, kept?.data, fresh ? '' : kept ? '' : 'loading');
    el.panel.hidden = false;
    placePanel();
    document.addEventListener('pointerdown', outsidePanel, true);
    document.addEventListener('keydown', escapePanel, true);
    emit('panel', { id: panel });
    if (focus) (el.panel.querySelector('.find, .body .row, .row') || el.panel.querySelector('.close'))?.focus({ preventScroll: true });
    if (fresh) return;
    let data = null, state = '';
    try { data = await site.panel(panel); } catch { state = 'error'; }
    if (turn !== panelTurn || !host) return;
    if (data) panels.set(panel, { at: Date.now(), data }); else if (!kept) state = 'error';
    const had = root.activeElement && el.panel.contains(root.activeElement);
    drawPanel(panel, data || kept?.data, state);
    placePanel();
    if (had) (el.panel.querySelector('.find, .body .row, .row') || el.panel.querySelector('.close'))?.focus({ preventScroll: true });
  };
  const outsidePanel = (e) => { if (!e.composedPath().includes(host)) panelTo('', null, false); };
  // Tabbed on past it into the page, it closes, as the top bar's menus do, and focus stays where it went: left open, it
  // would cover what's focused there. (A row redrawn under focus leaves for nowhere: no relatedTarget, it stays.)
  const leftPanel = (e) => { if (panel && e.relatedTarget && !root.contains(e.relatedTarget)) panelTo('', null, false); };
  // Escape from the page too (the bar's own keys hear it inside): focus goes back to its button only from nowhere.
  const escapePanel = (e) => { if (e.key === 'Escape' && !e.composedPath().includes(host)) panelTo('', null, !document.activeElement || document.activeElement === document.body); };

  // ---- acting ---------------------------------------------------------------------------------------------------------
  const glaze = (what, e) => {
    // "Use my own": this mod's layouts stay off until the student lets it arrange again (Settings → Navigation).
    if (what === 'nav-own') { const id = e?.target?.closest?.('[data-mod]')?.dataset.mod || arranged()?.id; if (id && /^[a-z2-7]{16}$/.test(id)) try { chrome.storage.local.set({ [`modNavLayout:${id}`]: false }); } catch { /* reloaded */ } return; }
    // Settings opens as a page of the site, beside the bar (features/settingspage.js); the editor's preview keeps a tab.
    if (what === 'settings' || what === 'customize') {
      const tab = () => send(what === 'customize' ? { type: 'glaze:sessions-open', section: 'navigation/bar' } : 'options');
      if (isPreview) { tab(); return; }
      X.need('features/settingspage.js', () => globalThis.GZ_SETTINGS_PAGE).then(() => globalThis.GZ_SETTINGS_PAGE?.open(what === 'customize' ? 'navigation/bar' : '')).then((opened) => { if (!opened) tab(); }, tab);
      return;
    }
    // Over a course tab's frame, the palette is that frame's (features/coursetabs.js).
    if (what === 'search') { if (!globalThis.GZ_CTABS?.palette?.(true)) X.need('features/palette.js', () => globalThis.GZ_CMD).then(() => GZ_CMD.open(), () => {}); return; }
    if (what === 'notes') { X.need('features/notes.js', () => globalThis.GZ_NOTES_UI).then(() => GZ_NOTES_UI.open({ event: e }), () => {}); return; }
    // Writer's Documents (papers.html), for the student's own click: as a page of the site like Settings, else (the editor's
    // preview, a page Glaze can't open it in) a tab of its own, which the worker opens.
    if (what === 'documents') {
      if (!e?.isTrusted) return;
      const tab = () => send('papers');
      if (isPreview) { tab(); return; }
      X.need('features/settingspage.js', () => globalThis.GZ_SETTINGS_PAGE).then(() => globalThis.GZ_SETTINGS_PAGE?.open('', 'papers')).then((opened) => { if (!opened) tab(); }, tab);
      return;
    }
    // To Do lives on the site's home (the Glaze Dashboard on Ultra, the Canvas dashboard): go there.
    if (what === 'todo') goNative(site.home());
  };
  // The site's own item: through its own link, after leaving a course tab shown over the page.
  const goNative = (id) => {
    const item = byId(id);
    if (!item) return;
    const api = tabsApi();
    // Canvas: a page's address goes through the course tabs while their frames run, so none of them reloads.
    if (X.site === 'canvas' && globalThis.GZ_CTABS?.frames?.() && /^https?:[^#]*$/.test(item.href || '') && api?.open?.(item.href)) return;
    api?.leave();
    if (id === 'logout') api?.signout?.();
    if (!site.go(id)) location.assign(item.href);
  };
  const tabAct = (act, cid, e) => {
    const api = tabsApi();
    if (!api) return;
    if (act === 'tab' && e?.type === 'auxclick') { if (e.button === 1) api.shut(cid); return; }
    if (act === 'tab') api.visit(cid);
    else if (act === 'tab-pin') api.pin(cid);
    else if (act === 'tab-close') api.shut(cid);
  };
  // Glaze reloaded or updated under an open page: this copy can't reach Glaze any more, and Chrome doesn't run the new one
  // here until the page loads again. The bar stays, as plain links: a link loads its page (with Glaze running again), and
  // anything else reloads this one.
  const orphaned = (e, path) => {
    const a = path.find((n) => n instanceof HTMLAnchorElement && n.href);
    if (a && /^https?:/.test(a.href)) { if (a.target !== '_blank') { e.preventDefault(); location.assign(a.href); } return; }
    if (path.some((n) => n instanceof HTMLButtonElement)) { e.preventDefault(); location.reload(); }
  };
  const click = (e) => {
    if (e.type === 'auxclick' && e.button !== 1) return;
    const path = e.composedPath();
    if (!chrome.runtime?.id) { if (e.type === 'click') orphaned(e, path); return; }
    // A panel's row: a page of this site opens here (through the course tabs where they run), another site's in a new tab.
    const prow = el.panel && path.includes(el.panel) && path.find((n) => n.classList?.contains('row') && n.parentElement && !n.dataset.act);
    if (prow && e.type === 'click') {
      if (prow.dataset.run !== undefined && prow.tagName === 'BUTTON') { e.preventDefault(); const what = prow.dataset.run; panelTo('', null, false); if (what === 'logout') tabsApi()?.signout?.(); site.run?.(what); return; }
      if (prow.href && prow.target !== '_blank' && sameSite(prow.href) && plain(e)) { e.preventDefault(); const href = prow.href; panelTo('', null, false); openHere(href); return; }
      if (prow.href) { panelTo('', null, false); return; }
    }
    // What's due next, a page of this site: through the course tabs where they run, as the bar's other links.
    const due = path.find((n) => n.dataset?.w === 'next');
    if (due && e.type === 'click') {
      globalThis.GZ_SETTINGS_PAGE?.close();
      if (due.href && due.target !== '_blank' && sameSite(due.href) && plain(e)) { e.preventDefault(); const href = due.href; sheetTo(false); openHere(href); }
      return;
    }
    const target = path.find((n) => n.dataset && (n.dataset.id !== undefined || n.dataset.act));
    // Somewhere else picked in the bar leaves Glaze's page (Settings, Documents), as leaving any page; the other of the two
    // takes its place.
    if (target && e.type === 'click' && !['glaze:settings', 'glaze:documents'].includes(target.dataset.id) && !['customize', 'panel-close', 'panel-retry', 'tab-pin', 'tab-close', 'widgets'].includes(target.dataset.act)) globalThis.GZ_SETTINGS_PAGE?.close();
    if (e.type === 'auxclick' && target?.dataset.act !== 'tab') return;
    if (!target) {
      if (path.includes(el.toggle)) { e.preventDefault(); pinTo(!(lay.open || peek)); }
      else if (path.includes(el.pin)) { e.preventDefault(); pinTo(!lay.open); }
      else if (path.includes(el.more)) { e.preventDefault(); sheetTo(!sheetOpen); }
      else if (path.includes(el.tmore)) { e.preventDefault(); menuTo(menu === 'more' ? '' : 'more'); }
      else if (path.includes(el.tacc)) { e.preventDefault(); if (model.account?.panel && site.panel) panelTo(panel === 'profile' ? '' : 'profile', el.tacc); else menuTo(menu === 'account' ? '' : 'account'); }
      else if (path.includes(el.skip)) { e.preventDefault(); const main = mainAt(); if (main) { if (!main.hasAttribute('tabindex')) { skipMain.add(main); main.tabIndex = -1; } main.focus(); } }
      return;
    }
    const act = target.dataset.act;
    if (act === 'panel-close') { e.preventDefault(); panelTo(''); return; }
    if (act === 'panel-retry') { e.preventDefault(); panels.delete(panel); panelTo(panel, panelFrom); return; }
    if (act === 'widgets') { e.preventDefault(); sheetTo(false); dockTo(!docked); return; }
    if (act?.startsWith('tab')) { e.preventDefault(); tabAct(act, target.dataset.cid, e); if (act === 'tab') { sheetTo(false); if (!lay.open) peekTo(false); } return; }
    if (act) { e.preventDefault(); sheetTo(false); menuTo('', false); glaze(act, e); return; }
    const item = byId(target.dataset.id);
    if (!item) return;
    // A site's own menu (Courses, Account, Help…) is a button opening Glaze's panel.
    if (item.panel && site.panel) { e.preventDefault(); sheetTo(false); panelTo(panel === item.id ? '' : item.id, target); return; }
    emit('navigate', { id: item.id });
    // The course's own pages: through the course tabs where they run, so a course tab's frame follows.
    if (item.course) { if (plain(e) && !item.tab) { e.preventDefault(); openHere(item.href); } sheetTo(false); if (!lay.open) peekTo(false); return; }
    if (item.owner) { if (!item.href) e.preventDefault(); if (e.isTrusted) mods.get(item.owner)?.get(item.id)?.select?.(); }
    else if (item.switch) { e.preventDefault(); if (e.isTrusted) site.go(item.id); }
    else if (item.action) { e.preventDefault(); glaze(item.action, e); }
    // The site's own items go through its own links, so its router (and its trays) handle them as it would.
    else if (item.native && plain(e)) { e.preventDefault(); goNative(item.id); }
    sheetTo(false);
    menuTo('', false);
    if (!lay.open) peekTo(false);
  };
  const key = (e) => {
    if (menu && e.key === 'Tab') { menuTo(''); return; }
    if ([el.tmore, el.tacc].includes(root.activeElement) && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault(); menuTo(root.activeElement === el.tmore ? 'more' : 'account');
      if (e.key === 'ArrowUp') [...el.menu.querySelectorAll('a, button')].at(-1)?.focus();
      return;
    }
    if (sheetOpen && e.key === 'Tab') {
      const items = [...el.sheet.querySelectorAll('a, button')].filter((e) => !e.disabled && (e.tagName !== 'A' || e.hasAttribute('href')) && e.getClientRects().length), first = items[0], last = items.at(-1);
      if (e.shiftKey && root.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && root.activeElement === last) { e.preventDefault(); first?.focus(); }
      return;
    }
    if (e.key === 'Escape') {
      if (panel) { e.preventDefault(); panelTo(''); return; }
      if (docked) { e.preventDefault(); dockTo(false); return; }
      if (sheetOpen) { e.preventDefault(); sheetTo(false); return; }
      if (menu) { e.preventDefault(); menuTo(''); return; }
      // The peek folds away; focus stays on the item that had it (its icon), not the rail's foot.
      if (peek) { e.preventDefault(); peekTo(false); }
      return;
    }
    // A course tab: Delete closes it and P pins it, as on the strip.
    const tab = root.activeElement?.dataset?.act === 'tab' && root.activeElement.dataset.cid;
    if (tab && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); tabAct('tab-close', tab); return; }
    if (tab && e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); tabAct('tab-pin', tab); return; }
    // Arrow keys move along the bar (up and down the rail, along the top bar and its menus); Tab still goes in order.
    const box = [el.menu, el.panel, el.rail, el.topbar, el.tsub].find((b) => b.contains(root.activeElement));
    if (!box || box === el.panel && root.activeElement?.matches('input')) return;
    const along = box === el.topbar || box === el.tsub ? (rtl() ? { ArrowLeft: 1, ArrowRight: -1 } : { ArrowLeft: -1, ArrowRight: 1 }) : { ArrowUp: -1, ArrowDown: 1 };
    if (!(e.key in along) && !['Home', 'End'].includes(e.key)) return;
    const items = [...box.querySelectorAll('.item, .brand, .row, .ctab-go, .chip, .tacc, .close')].filter((n) => !n.hidden && !n.hasAttribute('data-over') && n.getClientRects().length);
    const at = items.indexOf(root.activeElement);
    if (at < 0) return;
    e.preventDefault();
    items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + along[e.key] + items.length) % items.length].focus();
  };

  // ---- the loop -------------------------------------------------------------------------------------------------------
  const stop = () => {
    clearTimeout(enter); clearTimeout(leave); enter = leave = 0;
    cancelAnimationFrame(frame); frame = 0;
    cancelAnimationFrame(queued); queued = 0;
    clearLogo();
    document.removeEventListener('keydown', escapeTip, true);
    if (!host) return;
    if (sheetOpen) sheetTo(false);
    dockTo(false, false);
    wx?.stop();
    menuTo('', false);
    panelTo('', null, false);
    for (const main of skipMain) if (main.getAttribute('tabindex') === '-1') main.removeAttribute('tabindex');
    skipMain.clear();
    site?.unobserve();
    sizes?.disconnect(); sizes = null;
    // Closing a dialog or removing a focused bar can schedule focusout's delayed peek close.
    host.remove();
    clearTimeout(enter); clearTimeout(leave); enter = leave = 0;
    host = null; root = null; el = {}; sig = ''; measured = ''; model = null; rows = []; lay = null; cmenu = null; panels.clear(); peek = false; shown = false; sheetOpen = false; rail = null;
    const hadTabs = words.split(' ').includes('tabs');
    words = '';
    html.removeAttribute('data-gz-navbar');
    for (const v of ['--gz-navbar-left', '--gz-navbar-top']) html.style.removeProperty(v);
    if (hadTabs) globalThis.GZ_CTABS?.bar?.place();
    emit('collapse', {});
  };
  const sync = () => {
    // Orphaned (orphaned() above): the bar stays as it is drawn, rather than leave the page without any navigation.
    if (host && !chrome.runtime?.id) return;
    if (!on()) { stop(); return; }
    if (!read) { read = true; readItems(); }
    if (applied !== settings()) { rail = null; peekTo(false); applied = settings(); }
    if (rail && rail === settings().rail) rail = null;
    if (host && !host.isConnected) stop();
    if (!host) mount();
    // A mod's nav stands in for the bar (features/mods.js): the bar hides, and still keeps the page's room.
    const stands = !!globalThis.GZ_MODS?.navStands?.();
    if (stands !== host.hasAttribute('data-replaced')) {
      host.toggleAttribute('data-replaced', stands);
      if (stands) { menuTo('', false); sheetTo(false); dockTo(false, false); tip(null); }
    }
    host.setAttribute('dir', (html.dir || document.body?.dir) === 'rtl' ? 'rtl' : 'ltr');
    host.dataset.motion = html.getAttribute('data-gz-motion') || '';
    // The bar stands on Glaze's footer where it runs under the bar: fixed on Ultra, last in Moodle's page. Canvas's is in its
    // body, above the room kept under the page for the bar: raised, the bar went over it and over Canvas's Previous and Next.
    host.toggleAttribute('data-footer', X.site !== 'canvas' && html.hasAttribute('data-gz-footer'));
    const api = tabsApi();
    if (skipMain.size) {
      const main = mainAt();
      for (const old of skipMain) if (old !== main) { if (old.getAttribute('tabindex') === '-1') old.removeAttribute('tabindex'); skipMain.delete(old); }
    }
    if (panel && site.current) for (const e of el.panel.querySelectorAll('a.row')) {
      const current = site.current(e.href); part(e, current ? 'panel-row active' : 'panel-row');
      if (current) e.setAttribute('aria-current', 'page'); else e.removeAttribute('aria-current');
    }
    cmenu = readMenu();
    const by = arranged(), place = { left: 'rail', top: 'top' }[by?.place];
    lay = M.layout(place ? { ...settings(), place } : settings(), { width: innerWidth, course: inCourse(), rail, tabs: !!api, menu: !!cmenu });
    rows = lay.tabs && api ? api.rows() : [];
    // A course tab shown over the page is in Courses, whatever the page under it is.
    const framed = !!globalThis.GZ_CTABS?.showing?.() && globalThis.GZ_CTABS.showing() !== 'page'; // (not Canvas's page frame: the page in it says)
    // Glaze's settings or Documents open as the page: nothing else is where you are.
    const glazePage = globalThis.GZ_SETTINGS_PAGE?.showing?.() || '';
    const native = site.read().map((n) => (glazePage ? { ...n, active: false } : framed ? { ...n, active: n.id === 'course' } : n));
    const look = X.parts()?.nav ? L.clean(X.parts().nav) : null;
    // What the site has no shared name for (link:<id>, see the adapter contract) the model takes as links of the student's own,
    // so they hide, rename and move like any; what a link lacks (a menu, a switch's state, the page it is) is set on them after.
    const sited = native.filter((n) => /^link:[a-z0-9]{12}$/.test(n.id));
    model = M.build({ native: sited.length ? native.filter((n) => !sited.includes(n)) : native, look, legacy, mods: [...mods.values()].flatMap((m) => [...m.values()]),
      prefs: sited.length ? { ...prefs, links: [...prefs.links.filter((l) => !sited.some((n) => n.id === 'link:' + l.id)), ...sited.map((n) => ({ id: n.id.slice(5), n: n.label, u: n.href, i: n.icon || 'link' }))] } : prefs,
      names: { notes: t('Notes'), documents: t('Documents'), todo: t('To Do'), search: t('Search'), settings: t('Glaze settings') }, origin: location.origin });
    for (const n of sited) {
      const i = model.items.find((x) => x.id === n.id);
      if (i) Object.assign(i, { active: !!n.active, ...(n.panel && { panel: true }), ...(typeof n.checked === 'boolean' && { switch: true, checked: n.checked, disabled: !!n.disabled }) });
    }
    if (glazePage) for (const i of model.items) if (i.id === (glazePage === 'papers' ? 'glaze:documents' : 'glaze:settings')) i.active = true;
    // Glaze's widgets load with the first one turned on; mods' navigation widgets go in the dock, once each.
    const wants = model.widgets.map((w) => w.id);
    if (wants.length && !wx) {
      if (globalThis.GZ_NAVBAR_WIDGETS) wx = GZ_NAVBAR_WIDGETS(X, { make, icon, isPreview });
      else X.need('features/navbar-widgets.js', () => globalThis.GZ_NAVBAR_WIDGETS).then(() => { sig = ''; queue(); }, () => {});
    }
    wx?.set(wants);
    const docks = [...(globalThis.GZ_MODS?.rail() || []), ...(globalThis.GZ_MODWIDGETS?.rail() || [])];
    for (const d of docks) if (d.el.parentNode !== el.dock) el.dock.append(d.el);
    const next = JSON.stringify([model, rows, lay, cmenu, settings(), site.brand(), site.avatar?.(), X.locale(), X.settings().nav?.li, logo.url, by, !!wx, docks.map((d) => d.key), wide()]);
    if (next !== sig) { sig = next; render(); emit('change', view()); } else if (measured !== geometry()) layout();
  };
  const queue = () => { if (!queued && !sleeping) queued = requestAnimationFrame(() => { queued = 0; sync(); }); };
  chrome.storage.onChanged.addListener((c, area) => {
    if ((area === 'local' && c.freshDefaults) || (area === 'sync' && (c.navbarItems || c.navItems))) readItems();
    if (area === 'local' && logo.id && c[`navLogo:${logo.id}`]) { clearLogo(); sig = ''; if (host) sync(); }
    if (area !== 'sync' || !chrome.runtime?.id) return;
  });
  addEventListener('resize', () => { if (!host) return; measured = ''; tip(null); menuTo('', false); placePanel(); if (!wide()) peekTo(false); else sheetTo(false); sync(); });
  addEventListener('popstate', () => { if (host) { panelTo('', null, false); queue(); } });
  document.addEventListener('visibilitychange', () => { if (host && document.visibilityState === 'visible') queue(); });
  addEventListener('pagehide', () => { sleeping = true; stop(); });
  addEventListener('pageshow', (e) => { sleeping = false; if (e.persisted) queue(); });
  // The editor's preview has this file as a <script> after content.js, whose first ask came before it was in: it starts
  // itself, and follows the editor's edits there.
  if (isPreview) { addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.gzPreview) setTimeout(sync); }); setTimeout(sync); }

  // ---- the API (mods: features/mods.js; Looks style the parts) --------------------------------------------------------
  // What a reader sees: the items, groups and state, never the elements.
  const strip = (i) => ({ id: i.id, label: i.label, icon: i.icon, href: i.href || '', active: !!i.active, badge: i.badge || '', hidden: !!i.hidden, ...(i.owner && { owner: i.owner }) });
  const view = () => (model ? { groups: model.groups.map((g) => ({ id: g.id, label: g.label, items: g.items.map((i) => i.id) })), items: model.items.map(strip),
    tabs: model.tabs.map((i) => i.id), active: model.items.find((i) => i.active && !i.hidden)?.id || '', open: shown, sheet: sheetOpen,
    place: lay?.place || 'none', style: lay?.style || 'float', course: inCourse(), menu: cmenu ? { name: cmenu.name, items: cmenu.items.map(strip) } : null, panel } : null);
  const OWNER = /^[a-z0-9][a-z0-9_-]{0,47}$/, ID = /^[a-z][a-z0-9-]{0,31}$/;
  const SLOTS = ['top', 'bottom'];
  // A mod's item, checked: a name, one of the bar's icons, an address of this site only (lib/navlayout.js onSite), a short
  // badge, and a group of the bar or a slot. It never passes for one of Glaze's own items: not their icons, nor their names
  // (in any of Glaze's languages, or as this page and the student name them; lib/navlayout.js reserved). Anything else
  // refuses (null).
  const check = (owner, raw) => {
    if (!OWNER.test(owner) || !raw || typeof raw !== 'object' || !ID.test(raw.id) || typeof raw.label !== 'string') return null;
    const label = raw.label.replace(/[\p{Cc}\p{Bidi_Control}]/gu, ' ').replace(/\s+/g, ' ').trim();
    const own = [t('Glaze settings'), t('Sign out'), ...(model?.items || []).filter((i) => i.id === 'glaze:settings' || i.id === 'logout').map((i) => i.label)];
    if (!label || [...label].length > 40 || L.reserved(label, own)) return null;
    let href = '';
    if (raw.href !== undefined && raw.href !== '') {
      href = L.onSite(raw.href, location.origin);
      if (!href) return null;
    }
    if (raw.icon !== undefined && !M.MOD_PICKS.includes(raw.icon)) return null;
    if (raw.badge !== undefined && !(typeof raw.badge === 'number' || (typeof raw.badge === 'string' && [...raw.badge].length <= 4))) return null;
    if (raw.slot !== undefined && !SLOTS.includes(raw.slot)) return null;
    if (raw.group !== undefined && typeof raw.group !== 'string' && !Number.isInteger(raw.group)) return null;
    const by = typeof raw.by === 'string' ? raw.by.replace(/[\p{Cc}\p{Bidi_Control}]/gu, ' ').trim().slice(0, 80) : '';
    return { id: `mod:${owner}.${raw.id}`, owner, label, icon: raw.icon || 'link', href, badge: raw.badge ?? '', group: raw.group, slot: raw.slot, by, select: typeof raw.select === 'function' ? raw.select : null };
  };
  const api = {
    sync,
    // Whether the bar is drawn: it then says <html data-gz-navbar> itself (content-ultra.js only at first paint).
    live: () => !!host?.isConnected,
    model: view,
    on: (event, fn) => { if (typeof fn === 'function') { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); } },
    off: (event, fn) => { listeners.get(event)?.delete(fn); },
    // add, update and remove change only the owner's own items; clear takes all of them away (the mod stopped).
    add: (owner, raw) => {
      const item = check(owner, raw);
      if (!item || (mods.get(owner)?.size || 0) >= 8 && !mods.get(owner).has(item.id)) return false;
      if (!mods.has(owner)) mods.set(owner, new Map());
      mods.get(owner).set(item.id, item); queue(); return true;
    },
    update: (owner, id, patch) => {
      const had = mods.get(owner)?.get(`mod:${owner}.${id}`);
      if (!had || !patch || typeof patch !== 'object') return false;
      const { owner: _o, id: _i, ...rest } = had;
      const item = check(owner, { ...rest, ...patch, id });
      if (!item) return false;
      mods.get(owner).set(item.id, item); queue(); return true;
    },
    remove: (owner, id) => { const ok = !!mods.get(owner)?.delete(`mod:${owner}.${id}`); if (ok) queue(); return ok; },
    clear: (owner) => { if (mods.delete(owner)) queue(); },
    // Opens an item as a click on it would: the site's own through its own link.
    go: (id) => {
      const item = byId(id);
      if (!item || item.hidden && !item.native || item.switch || item.href && !sameSite(item.href)) return false; // a switch changes the site's state: a student's click only
      emit('navigate', { id });
      if (item.panel && site.panel) panelTo(panel === id ? '' : id);
      else if (item.course) openHere(item.href);
      else if (item.owner) { mods.get(item.owner)?.get(item.id)?.select?.(); if (item.href) location.assign(item.href); }
      else if (item.action) glaze(item.action);
      else if (item.native) goNative(id);
      else if (item.href) location.assign(item.href);
      return true;
    },
  };
  return api;
})();

// Blackboard Ultra: its own nav (the drawer's list) read for items, labels, badges and which is current; its links clicked
// for the bar's, so Ultra's router opens them as its own would. A course opened at its own address has no drawer: the
// items last read on this site (storage.local navbarSeen:<origin>, this device only) stand in, else Ultra's usual ones,
// and open as plain links.
function GZ_NAVBAR_ULTRA(X) {
  const ROOT = '[data-gz-nav-root], nav#base_tools, nav:has(> #base_tools), nav[class*="makeStylesnavigation-"]';
  const SEEN = `navbarSeen:${location.origin}`;
  const USUAL = [['institution-page', 'Institution page'], ['stream', 'Activity'], ['course', 'Courses'], ['organization', 'Organizations'], ['calendar', 'Calendar'], ['messages', 'Messages'], ['grades', 'Grades'], ['tools', 'Tools'], ['profile', 'Profile']];
  let mo = null, swap = null, watched = null, notify = null, seen = null, saved = '';
  const rootOf = () => document.querySelector(ROOT);
  const anchors = () => { const root = rootOf(); return [...(root?.querySelectorAll('a[href]') || []), ...(root?.closest('.MuiDrawer-paper')?.querySelectorAll('footer a[href], [class*="makeStylesfooter"] a[href]') || [])]; };
  const idOf = (a) => GZ_NAV.native(a.getAttribute('href'));
  // Its words without its badge's: every text node outside a badge.
  const labelOf = (a) => {
    const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('.MuiBadge-badge, .gz-nav-dashboard-icon') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let s = '';
    for (let n = w.nextNode(); n; n = w.nextNode()) s += ` ${n.data}`;
    return s.replace(/\s+/g, ' ').trim() || a.getAttribute('aria-label') || '';
  };
  const here = (href, id) => {
    if (!/^\/ultra\//.test(href)) return false;
    const path = location.pathname.replace(/\/$/, ''), own = href.replace(/\/$/, '');
    return path === own || path.startsWith(`${own}/`) || (id === 'course' && path.startsWith('/ultra/courses/'));
  };
  const current = (a, id) => a.matches('.Mui-selected, .active, [aria-current]:not([aria-current="false"])') || here(new URL(a.href).pathname, id);
  const watch = () => {
    const root = rootOf();
    const scope = root?.closest('.MuiDrawer-paper') || root;
    if (scope === watched || !notify) return;
    mo?.disconnect(); swap?.disconnect(); watched = scope;
    if (scope) mo.observe(scope, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-current', 'href', 'src'] });
    // Ultra redraws the drawer whole: its parent sees the new one come in.
    if (scope?.parentElement) swap.observe(scope.parentElement, { childList: true });
  };
  try { chrome.storage.local.get(SEEN, (r) => { const list = r?.[SEEN]; if (Array.isArray(list)) { seen = list.slice(0, 20); notify?.(); } }); } catch { /* reloaded */ }
  // What the drawer had, kept for the pages without one: ids, names and same-site paths only.
  const keep = (items) => {
    const list = items.filter((i) => i.id !== 'logout').map((i) => { try { const u = new URL(i.href); return u.origin === location.origin ? { id: i.id, label: i.label.slice(0, 80), path: u.pathname } : null; } catch { return null; } }).filter(Boolean);
    const json = JSON.stringify(list);
    if (!list.length || json === saved || json === JSON.stringify(seen)) { saved = json; return; }
    saved = json; seen = list;
    try { chrome.storage.local.set({ [SEEN]: list }); } catch { /* reloaded */ }
  };
  return {
    read: () => {
      watch();
      const ids = new Set();
      const live = anchors().map((a) => {
        const id = idOf(a);
        if (!id || ids.has(id)) return null;
        ids.add(id);
        const b = a.querySelector('.MuiBadge-badge:not(.MuiBadge-invisible)');
        return { id, label: labelOf(a), href: a.href, active: current(a, id), badge: b?.textContent.trim() || '' };
      }).filter(Boolean);
      if (live.length) { keep(live); return live; }
      const list = seen?.length ? seen : USUAL.map(([id, label]) => ({ id, label: X.t(label), path: `/ultra/${id}` }));
      return list.filter((i) => GZ_NAV.NATIVE.includes(i.id) && /^\/ultra\/[\w-]+$/.test(i.path)).map((i) => ({ id: i.id, label: i.label, href: location.origin + i.path, active: here(i.path, i.id), badge: '' }));
    },
    go: (id) => { const a = anchors().find((x) => idOf(x) === id); if (!a) return false; a.click(); return true; },
    brand: () => { const img = rootOf()?.closest('.MuiDrawer-paper')?.querySelector('header img'); return { src: img?.currentSrc || img?.src || '', name: (img?.alt || '').trim().slice(0, 80) }; },
    avatar: () => { const img = anchors().find((a) => idOf(a) === 'profile')?.querySelector('img'); return img?.currentSrc || img?.src || ''; },
    // Home: the Glaze Dashboard where it's on (it takes Ultra's institution page), else Courses, as Ultra's logo does in Glaze.
    home: () => (X.settings().enhance.dashboard ? 'institution-page' : 'course'),
    // The page's, or the course tab's frame on screen (same origin), which the covered page is not.
    main: (doc = document) => doc.getElementById('main-content') || doc.querySelector('main'),
    inCourse: () => /^\/ultra\/courses\//.test(location.pathname),
    observe: (fn) => { notify = fn; mo = new MutationObserver(() => notify?.()); swap = new MutationObserver(() => notify?.()); watched = null; watch(); },
    unobserve: () => { mo?.disconnect(); swap?.disconnect(); mo = swap = null; watched = null; notify = null; },
  };
}

if (typeof module !== 'undefined') module.exports = GZ_NAVBAR_UI; else GZ_NAVBAR_UI;
