// Glaze's own navigation (owner decision 2026-10-19), drawn from one model (lib/navbar.js) on every site, in a shadow root
// of its own so the school's CSS can't reach it. The site's own nav stays in the page, hidden (theme.css), so its links,
// badges and menus keep working through it and turning the bar off shows it again. Wide windows: a floating rail, open or
// icons with a peek on hover. Below 900px: a bottom bar and a More sheet. Looks and mods style it by part (::part(item));
// mods add items and listen through the API at the end (features/mods.js carries their calls here).
var GZ_NAVBAR_UI = globalThis.GZ_NAVBAR_UI || (() => {
  const X = globalThis.GZ_CTX, M = GZ_NAVBAR, L = GZ_NAV_LAYOUT, N = GZ_NAV_ITEMS, html = document.documentElement;
  const isPreview = /-extension:$/.test(location.protocol);
  const site = { ultra: globalThis.GZ_NAVBAR_ULTRA }[X.site]?.(X) || null;
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
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const plain = (e) => !e.button && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  const wide = () => matchMedia('(min-width: 900px)').matches;

  let host = null, root, el = {}, model = null, sig = '', prefs = M.clean(), legacy = null, read = false;
  let rail = null, peek = false, shown = false, sheetOpen = false, enter = 0, leave = 0, queued = false, placed = false;
  const listeners = new Map(), mods = new Map(); // event -> Set(fn); owner -> Map(id -> item)
  const emit = (event, data) => { for (const fn of listeners.get(event) || []) { try { fn(data); } catch { /* one listener's error isn't the bar's */ } } };
  const settings = () => X.settings().navbar || {};
  const on = () => !!site && !!chrome.runtime?.id && X.on() && X.settings().enabled && !!settings().on && (isPreview || window.top === window);
  // The rail's state: the student's choice (or the one just picked, until storage says so), and the window's width.
  const pinned = () => M.railOpen(rail || settings().rail, innerWidth);
  const byId = (id) => model?.items.find((i) => i.id === id) || null;

  // ---- drawing --------------------------------------------------------------------------------------------------------
  const mount = () => {
    host = make('div', { id: 'gz-navbar', hidden: true });
    root = host.attachShadow({ mode: 'open' });
    const sheet = make('link', { rel: 'stylesheet', href: chrome.runtime.getURL('features/navbar.css') });
    // Unstyled, the bar would flash as a list: it shows once its sheet is in.
    sheet.addEventListener('load', () => { if (host && on()) { host.hidden = false; layout(); } }, { once: true });
    el.skip = part(make('a', { className: 'skip', href: '#', textContent: t('Skip to content') }), 'skip');
    el.brand = part(make('a', { className: 'brand' }), 'brand');
    el.top = make('div', { className: 'slot' }); el.top.dataset.slot = 'top';
    el.ind = part(make('span', { className: 'ind', hidden: true }), 'indicator');
    el.list = make('div', { className: 'list' });
    el.bottom = make('div', { className: 'slot' }); el.bottom.dataset.slot = 'bottom';
    el.account = make('div', { className: 'foot' });
    el.toggle = part(make('button', { type: 'button', className: 'item toggle' }, icon('chevron')), 'toggle');
    el.pin = part(make('button', { type: 'button', className: 'item pin label' }, icon('pin'), make('span')), 'toggle pin');
    el.pin.style.setProperty('--i', 9);
    el.out = part(make('button', { type: 'button', className: 'item out label' }, icon('signout')), 'item signout');
    el.out.dataset.id = 'logout';
    el.rail = part(make('nav', { className: 'rail' }, el.brand, el.top, el.list, make('div', { className: 'fill' }), el.bottom, el.account,
      make('div', { className: 'controls' }, el.toggle, el.pin, el.out)), 'bar rail');
    el.tip = make('div', { className: 'tip' }); el.tip.setAttribute('aria-hidden', 'true');
    el.pill = part(make('span', { className: 'pill', hidden: true }), 'indicator');
    el.tabs = part(make('nav', { className: 'tabs' }, el.pill), 'bar tabs');
    el.scrim = make('div', { className: 'scrim' });
    el.sheet = part(make('div', { className: 'sheet', role: 'dialog' }), 'sheet');
    el.sheet.setAttribute('aria-modal', 'true');
    for (const n of [el.rail, el.tabs]) n.setAttribute('aria-label', t('Glaze navigation'));
    el.sheet.setAttribute('aria-label', t('More navigation'));
    root.append(sheet, el.skip, el.rail, el.tip, el.tabs, el.scrim, el.sheet);
    root.addEventListener('click', click);
    root.addEventListener('keydown', key);
    el.rail.addEventListener('pointerenter', pointIn);
    el.rail.addEventListener('pointerleave', pointOut);
    el.rail.addEventListener('focusin', focusIn);
    el.rail.addEventListener('focusout', focusOut);
    for (const ev of ['pointerover', 'focusin']) el.rail.addEventListener(ev, tipFor);
    for (const ev of ['pointerout', 'focusout']) el.rail.addEventListener(ev, () => tip(null));
    el.scrim.addEventListener('click', () => sheetTo(false));
    (document.body || html).append(host);
    site.observe(queue);
  };

  const badge = (text) => part(make('span', { className: 'badge', textContent: text }), 'badge');
  const label = (text, i) => { const s = part(make('span', { className: 'label', textContent: text }), 'label'); s.style.setProperty('--i', i); return s; };
  // One item: a link where it goes somewhere (open in a new tab works), a button where Glaze does something.
  const node = (item, cls, partName) => {
    const link = item.href && !item.action;
    const e = make(link ? 'a' : 'button', { className: cls });
    if (link) { e.href = item.href; if (item.tab) { e.target = '_blank'; e.rel = 'noopener noreferrer'; } } else e.type = 'button';
    e.dataset.id = item.id;
    part(e, item.active ? `${partName} active` : partName);
    if (item.active) e.setAttribute('aria-current', 'page');
    return e;
  };
  const badgeOf = (item) => (settings().badges !== false && item.badge ? item.badge : '');
  const desktopItem = (item, i) => {
    const e = node(item, 'item', 'item');
    const b = badgeOf(item);
    put(e, icon(item.icon), label(item.label, i), b ? badge(b) : null);
    e.dataset.tip = b ? `${item.label} · ${b}` : item.label;
    return e;
  };
  const initials = (name) => [...(name.match(/\p{L}[\p{L}'’-]*/gu) || [])].filter((w, i, a) => i === 0 || i === a.length - 1).map((w) => [...w][0].toUpperCase()).join('') || '?';
  const avatar = (account) => {
    const a = part(make('span', { className: 'avatar' }), 'avatar');
    const src = site.avatar?.();
    if (src) a.append(make('img', { src, alt: '' })); else a.textContent = initials(account.label);
    return a;
  };
  const render = () => {
    const focused = root.activeElement?.dataset?.id;
    const brand = site.brand();
    const mode = settings().brand || 'glaze';
    el.brand.hidden = mode === 'none';
    const home = byId(site.home());
    el.brand.href = home?.href || '/';
    el.brand.dataset.id = home?.id || '';
    el.brand.setAttribute('aria-label', home ? `${home.label} · ${brand.name || 'Glaze'}` : brand.name || 'Glaze');
    const logo = mode === 'school' && brand.src ? make('img', { className: 'logo', src: brand.src, alt: '' }) : glazeLogo();
    el.brand.replaceChildren(logo);
    if (mode !== 'school' || !brand.src) el.brand.append(make('span', { className: 'label' }, make('b', { textContent: 'Glaze' }), brand.name ? make('small', { textContent: brand.name }) : null));
    // The rail: groups, a divider between, the active marker that glides from item to item.
    let i = 1;
    const kids = [el.ind];
    model.groups.forEach((g, at) => {
      if (at) kids.push(part(make('div', { className: 'divider', role: 'separator' }), 'divider'));
      const group = part(make('div', { className: 'group' }), 'group');
      group.dataset.group = g.id;
      if (g.label) group.append(part(make('div', { className: 'group-label', textContent: g.label }), 'group-label'));
      for (const item of g.items) group.append(desktopItem(item, i++));
      kids.push(group);
    });
    el.list.replaceChildren(...kids);
    el.top.replaceChildren(...model.slots.top.map((item) => desktopItem(item, i++)));
    el.bottom.replaceChildren(...model.slots.bottom.map((item) => desktopItem(item, i++)));
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
    // Mobile: four tabs and More; the rest in the sheet with the account, signing out and the editor.
    const tabs = model.tabs.map((item) => {
      const e = node(item, 'tab', 'tab');
      const b = badgeOf(item);
      return put(e, icon(item.icon), make('span', { textContent: item.label }), b ? badge(b) : null);
    });
    el.more = part(make('button', { type: 'button', className: 'tab more' }, icon('more'), make('span', { textContent: t('More') })), 'tab more');
    el.more.setAttribute('aria-haspopup', 'dialog'); el.more.setAttribute('aria-expanded', String(sheetOpen));
    el.tabs.replaceChildren(el.pill, ...tabs, el.more);
    const row = (item) => { const b = badgeOf(item); return put(node(item, 'row', 'row'), icon(item.icon), make('span', { textContent: item.label }), b ? badge(b) : null); };
    const rows = [make('div', { className: 'handle' })];
    model.sheet.forEach((g, at) => { if (at) rows.push(part(make('div', { className: 'divider', role: 'separator' }), 'divider')); rows.push(...g.items.map(row)); });
    rows.push(part(make('div', { className: 'divider', role: 'separator' }), 'divider'));
    if (acc) rows.push(row({ ...acc, label: t('Account') }));
    if (model.signout) rows.push(row(model.signout));
    const custom = part(make('button', { type: 'button', className: 'row customize' }, icon('settings'), make('span', { textContent: t('Customize navigation') })), 'row customize');
    custom.dataset.act = 'customize';
    rows.push(custom);
    el.sheet.replaceChildren(...rows);
    if (focused) root.querySelector(`[data-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    placed = false;
    layout();
  };
  const glazeLogo = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 128 128'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'logo');
    svg.innerHTML = '<defs><linearGradient id="gz-nb-drop" x1="0.1" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="#6fdcff"/><stop offset="1" stop-color="#17c8f4"/></linearGradient></defs><rect width="128" height="128" rx="30" fill="#0d1b2e"/><path d="M64 18C64 18 28 59 28 80a36 36 0 0 0 72 0C100 59 64 18 64 18Z" fill="url(#gz-nb-drop)"/><ellipse cx="79" cy="76" rx="10" ry="15" transform="rotate(20 79 76)" fill="#fff" opacity=".55"/>';
    return svg;
  };

  // ---- state: open or icons, the peek, the page's room, the markers --------------------------------------------------
  const layout = () => {
    if (!host) return;
    const pin = pinned(), open = pin || peek;
    el.rail.toggleAttribute('data-open', open);
    el.rail.toggleAttribute('data-peek', peek && !pin);
    el.toggle.setAttribute('aria-expanded', String(open));
    el.toggle.setAttribute('aria-label', t(open ? 'Collapse navigation' : 'Expand navigation'));
    el.toggle.dataset.tip = el.toggle.getAttribute('aria-label');
    el.pin.setAttribute('aria-pressed', String(pin));
    el.pin.lastElementChild.textContent = t(pin ? 'Pinned' : 'Pin open');
    // The page keeps the rail's room (theme.css reads this); a peek floats over it.
    X.setVar('--gz-navbar-space', `${pin ? M.SPACE.open : M.SPACE.icons}px`);
    if (open !== shown) { shown = open; emit(open ? 'expand' : 'collapse', {}); if (open) tip(null); }
    if (host.hidden) return;
    // The markers glide; the first placement after a redraw doesn't (it would slide in from the top).
    const now = el.list.querySelector('.item[aria-current="page"]');
    el.ind.hidden = !now;
    if (now) { if (!placed) el.ind.style.transition = 'none'; el.ind.style.setProperty('--y', `${now.offsetTop}px`); }
    const tabs = [...el.tabs.querySelectorAll('.tab')];
    const at = tabs.findIndex((e) => e.getAttribute('aria-current') === 'page');
    const target = tabs[at >= 0 ? at : model.sheet.some((g) => g.items.some((i) => i.active)) ? tabs.length - 1 : -1];
    for (const e of tabs) e.toggleAttribute('data-active', e === target);
    el.pill.hidden = !target;
    if (target && target.offsetWidth) {
      if (!placed) el.pill.style.transition = 'none';
      const rtl = host.getAttribute('dir') === 'rtl';
      el.pill.style.setProperty('--w', `${target.offsetWidth}px`);
      el.pill.style.setProperty('--x', `${rtl ? target.offsetLeft + target.offsetWidth - el.tabs.clientWidth + 6 : target.offsetLeft - 6}px`);
    }
    if (!placed) { placed = true; requestAnimationFrame(() => { el.ind.style.transition = ''; el.pill.style.transition = ''; }); }
  };
  const tip = (target) => {
    if (!el.tip) return;
    if (!target || shown || !wide()) { el.tip.removeAttribute('data-on'); return; }
    const r = target.getBoundingClientRect(), rtl = host.getAttribute('dir') === 'rtl';
    el.tip.textContent = target.dataset.tip;
    el.tip.style.left = `${rtl ? r.left - 10 : r.right + 10}px`;
    el.tip.style.top = `${r.top + r.height / 2}px`;
    el.tip.setAttribute('data-on', '');
  };
  const tipFor = (e) => { const target = e.composedPath().find((n) => n.dataset?.tip); if (target && el.rail.contains(target)) tip(target); };
  const peekTo = (v) => { clearTimeout(enter); clearTimeout(leave); enter = leave = 0; if (peek !== v) { peek = v; layout(); } };
  const pointIn = (e) => {
    clearTimeout(leave); leave = 0;
    if (e.pointerType === 'touch' || pinned() || settings().peek === false || !matchMedia('(hover: hover)').matches) return;
    enter = setTimeout(() => { enter = 0; peekTo(true); }, 120);
  };
  const pointOut = (e) => {
    if (e.pointerType === 'touch') return;
    clearTimeout(enter); enter = 0;
    leave = setTimeout(() => { leave = 0; if (!el.rail.contains(root.activeElement)) peekTo(false); }, 220);
  };
  const focusIn = (e) => { if (!pinned() && e.target !== el.toggle && e.target !== el.pin) peekTo(true); };
  const focusOut = (e) => { if (!el.rail.contains(e.relatedTarget)) { clearTimeout(leave); leave = setTimeout(() => { leave = 0; if (!el.rail.matches(':hover') && !el.rail.contains(root.activeElement)) peekTo(false); }, 220); } };
  // Pinning is saved for every page and tab (the worker writes it); the bar follows at once.
  const pinTo = (open) => {
    rail = open ? 'open' : 'icons';
    peekTo(false);
    // The editor's preview shows it without saving: the editor's own control saves.
    if (isPreview) { layout(); return; }
    send({ type: 'glaze:navbar', patch: { rail } }).then((r) => { if (!r?.ok) { rail = null; layout(); } });
    layout();
  };
  const sheetTo = (open) => {
    if (sheetOpen === open || !host) return;
    sheetOpen = open;
    el.sheet.toggleAttribute('data-open', open); el.scrim.toggleAttribute('data-open', open);
    el.more?.setAttribute('aria-expanded', String(open));
    emit('sheet', { open });
    if (open) el.sheet.querySelector('a, button')?.focus({ preventScroll: true }); else if (root.activeElement && el.sheet.contains(root.activeElement)) el.more?.focus({ preventScroll: true });
  };

  // ---- acting ---------------------------------------------------------------------------------------------------------
  const glaze = (what, e) => {
    if (what === 'settings' || what === 'customize') { send(what === 'customize' ? { type: 'glaze:sessions-open', section: 'look/navigation' } : 'options'); return; }
    if (what === 'search') { X.need('features/palette.js', () => globalThis.GZ_CMD).then(() => GZ_CMD.open(), () => {}); return; }
    if (what === 'notes') { X.need('features/notes.js', () => globalThis.GZ_NOTES_UI).then(() => GZ_NOTES_UI.open({ event: e }), () => {}); return; }
    // To Do lives on the site's home (the Glaze Dashboard on Ultra, the Canvas dashboard): go there.
    if (what === 'todo') { const home = byId(site.home()); if (home && !site.go(home.id)) location.assign(home.href); }
  };
  const click = (e) => {
    const target = e.composedPath().find((n) => n.dataset && (n.dataset.id !== undefined || n.dataset.act));
    if (!target) {
      if (e.composedPath().includes(el.toggle)) { e.preventDefault(); pinTo(!(pinned() || peek)); }
      else if (e.composedPath().includes(el.pin)) { e.preventDefault(); pinTo(!pinned()); }
      else if (e.composedPath().includes(el.more)) { e.preventDefault(); sheetTo(!sheetOpen); }
      else if (e.composedPath().includes(el.skip)) { e.preventDefault(); const main = site.main(); if (main) { if (!main.hasAttribute('tabindex')) main.tabIndex = -1; main.focus(); } }
      return;
    }
    if (target.dataset.act) { e.preventDefault(); sheetTo(false); glaze(target.dataset.act, e); return; }
    const item = byId(target.dataset.id);
    if (!item) return;
    emit('navigate', { id: item.id });
    if (item.owner) { if (!item.href) e.preventDefault(); mods.get(item.owner)?.get(item.id)?.select?.(); }
    else if (item.action) { e.preventDefault(); glaze(item.action, e); }
    // The site's own items go through its own links, so its router (and its trays) handle them as it would.
    else if (item.native && plain(e)) { e.preventDefault(); if (!site.go(item.id)) location.assign(item.href); }
    sheetTo(false);
    if (!pinned()) peekTo(false);
  };
  const key = (e) => {
    if (e.key === 'Escape') {
      if (sheetOpen) { e.preventDefault(); sheetTo(false); return; }
      if (peek) { e.preventDefault(); peekTo(false); el.toggle.focus({ preventScroll: true }); }
      return;
    }
    // Up and down move between the rail's items; Tab still goes through them in order.
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || !el.rail.contains(root.activeElement)) return;
    const items = [...el.rail.querySelectorAll('.item, .brand')].filter((n) => !n.hidden && n.getClientRects().length);
    const at = items.indexOf(root.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next.focus();
  };

  // ---- the loop -------------------------------------------------------------------------------------------------------
  const stop = () => {
    clearTimeout(enter); clearTimeout(leave); enter = leave = 0;
    if (!host) return;
    site?.unobserve();
    host.remove(); host = null; root = null; el = {}; sig = ''; model = null; peek = false; shown = false; sheetOpen = false; rail = null;
    html.style.removeProperty('--gz-navbar-space');
    emit('collapse', {});
  };
  const sync = () => {
    if (!on()) { stop(); return; }
    if (!read) { read = true; get(['navbarItems', 'navItems']).then((r) => { prefs = M.clean(r.navbarItems); legacy = r.navItems ? N.clean(r.navItems) : null; sig = ''; sync(); }); }
    if (!host) mount();
    host.setAttribute('dir', (html.dir || document.body?.dir) === 'rtl' ? 'rtl' : 'ltr');
    host.dataset.motion = html.getAttribute('data-gz-motion') || '';
    host.toggleAttribute('data-footer', html.hasAttribute('data-gz-footer'));
    if (rail && rail === settings().rail) rail = null;
    const look = X.parts()?.nav ? L.clean(X.parts().nav) : null;
    model = M.build({ native: site.read(), prefs, look, legacy, mods: [...mods.values()].flatMap((m) => [...m.values()]),
      names: { notes: t('Notes'), todo: 'To Do', search: t('Search'), settings: t('Glaze settings') } });
    const next = JSON.stringify([model, settings(), site.brand(), site.avatar?.(), X.locale()]);
    if (next !== sig) { sig = next; render(); emit('change', view()); } else layout();
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } };
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'sync' || !chrome.runtime?.id) return;
    if (c.navbarItems) prefs = M.clean(c.navbarItems.newValue);
    if (c.navItems) legacy = c.navItems.newValue ? N.clean(c.navItems.newValue) : null;
    if (c.navbarItems || c.navItems) { sig = ''; if (host) sync(); }
  });
  addEventListener('resize', () => { if (host) { tip(null); if (!wide()) { peekTo(false); } else sheetTo(false); layout(); } });
  document.addEventListener('visibilitychange', () => { if (host && document.visibilityState === 'visible') queue(); });
  addEventListener('pagehide', stop);

  // ---- the API (mods: features/mods.js; Looks style the parts) --------------------------------------------------------
  // What a reader sees: the items, groups and state, never the elements.
  const strip = (i) => ({ id: i.id, label: i.label, icon: i.icon, href: i.href || '', active: !!i.active, badge: i.badge || '', hidden: !!i.hidden, ...(i.owner && { owner: i.owner }) });
  const view = () => (model ? { groups: model.groups.map((g) => ({ id: g.id, label: g.label, items: g.items.map((i) => i.id) })), items: model.items.map(strip),
    tabs: model.tabs.map((i) => i.id), active: model.items.find((i) => i.active && !i.hidden)?.id || '', open: shown, sheet: sheetOpen } : null);
  const OWNER = /^[a-z0-9][a-z0-9_-]{0,47}$/, ID = /^[a-z][a-z0-9-]{0,31}$/;
  const SLOTS = ['top', 'bottom'];
  // A mod's item, checked: a name, one of the bar's icons, an https address or the page's own, a short badge, and a
  // group of the bar or a slot. Anything else refuses (null).
  const check = (owner, raw) => {
    if (!OWNER.test(owner) || !raw || typeof raw !== 'object' || !ID.test(raw.id) || typeof raw.label !== 'string') return null;
    const label = raw.label.replace(/[\p{Cc}\p{Bidi_Control}]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!label || [...label].length > 40) return null;
    let href = '';
    if (raw.href !== undefined) {
      try { const u = new URL(raw.href, location.href); if (u.protocol !== 'https:' && u.origin !== location.origin) return null; href = u.href; } catch { return null; }
    }
    if (raw.icon !== undefined && !M.PICKS.includes(raw.icon)) return null;
    if (raw.badge !== undefined && !(typeof raw.badge === 'number' || (typeof raw.badge === 'string' && [...raw.badge].length <= 4))) return null;
    if (raw.slot !== undefined && !SLOTS.includes(raw.slot)) return null;
    if (raw.group !== undefined && typeof raw.group !== 'string') return null;
    return { id: `mod:${owner}.${raw.id}`, owner, label, icon: raw.icon || 'link', href, badge: raw.badge ?? '', group: raw.group, slot: raw.slot, select: typeof raw.select === 'function' ? raw.select : null };
  };
  const api = {
    sync,
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
      const { owner: _o, id: _i, select, ...rest } = had;
      const item = check(owner, { ...rest, label: rest.label, ...patch, id, ...(select && { select }) });
      if (!item) return false;
      mods.get(owner).set(item.id, item); queue(); return true;
    },
    remove: (owner, id) => { const ok = !!mods.get(owner)?.delete(`mod:${owner}.${id}`); if (ok) queue(); return ok; },
    clear: (owner) => { if (mods.delete(owner)) queue(); },
    // Opens an item as a click on it would: the site's own through its own link.
    go: (id) => {
      const item = byId(id);
      if (!item || item.hidden && !item.native) return false;
      emit('navigate', { id });
      if (item.action) glaze(item.action);
      else if (item.native) { if (!site.go(id)) location.assign(item.href); }
      else if (item.href) location.assign(item.href);
      return true;
    },
  };
  return api;
})();

// Blackboard Ultra: its own nav (the drawer's list) read for items, labels, badges and which is current; its links clicked
// for the bar's, so Ultra's router opens them as its own would.
function GZ_NAVBAR_ULTRA(X) {
  const ROOT = '[data-gz-nav-root], nav#base_tools, nav:has(> #base_tools), nav[class*="makeStylesnavigation"]';
  let mo = null, watched = null, notify = null;
  const rootOf = () => document.querySelector(ROOT);
  const anchors = () => [...(rootOf()?.querySelectorAll('a[href]') || [])];
  const idOf = (a) => GZ_NAV.native(a.getAttribute('href'));
  // Its words without its badge's: every text node outside a badge.
  const labelOf = (a) => {
    const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('.MuiBadge-badge, .gz-nav-dashboard-icon') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let s = '';
    for (let n = w.nextNode(); n; n = w.nextNode()) s += ` ${n.data}`;
    return s.replace(/\s+/g, ' ').trim() || a.getAttribute('aria-label') || '';
  };
  const current = (a, id) => {
    if (a.matches('.Mui-selected, .active, [aria-current]:not([aria-current="false"])')) return true;
    if (!/^\/ultra\//.test(a.getAttribute('href') || '')) return false;
    const path = location.pathname.replace(/\/$/, ''), own = new URL(a.href).pathname.replace(/\/$/, '');
    return path === own || path.startsWith(`${own}/`) || (id === 'course' && path.startsWith('/ultra/courses/'));
  };
  const watch = () => {
    const root = rootOf();
    const scope = root?.closest('.MuiDrawer-paper') || root;
    if (scope === watched || !notify) return;
    mo?.disconnect(); watched = scope;
    if (scope) mo.observe(scope, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-current', 'href', 'src'] });
  };
  return {
    read: () => {
      watch();
      const seen = new Set();
      return anchors().map((a) => {
        const id = idOf(a);
        if (!id || seen.has(id)) return null;
        seen.add(id);
        const b = a.querySelector('.MuiBadge-badge:not(.MuiBadge-invisible)');
        return { id, label: labelOf(a), href: a.href, active: current(a, id), badge: b?.textContent.trim() || '' };
      }).filter(Boolean);
    },
    go: (id) => { const a = anchors().find((x) => idOf(x) === id); if (!a) return false; a.click(); return true; },
    brand: () => { const img = rootOf()?.closest('.MuiDrawer-paper')?.querySelector('header img'); return { src: img?.currentSrc || img?.src || '', name: (img?.alt || '').trim().slice(0, 80) }; },
    avatar: () => { const img = anchors().find((a) => idOf(a) === 'profile')?.querySelector('img'); return img?.currentSrc || img?.src || ''; },
    // Home: the Glaze Dashboard where it's on (it takes Ultra's institution page), else Courses, as Ultra's logo does in Glaze.
    home: () => (X.settings().enhance.dashboard ? 'institution-page' : 'course'),
    main: () => document.getElementById('main-content') || document.querySelector('main'),
    observe: (fn) => { notify = fn; mo = new MutationObserver(() => notify?.()); watched = null; watch(); },
    unobserve: () => { mo?.disconnect(); mo = null; watched = null; notify = null; },
  };
}

if (typeof module !== 'undefined') module.exports = GZ_NAVBAR_UI; else GZ_NAVBAR_UI;
