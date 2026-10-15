// Canvas's rail uses CSS at first paint.
// shortcut: cold local pictures start with their fill; revisit if their first paint must block.
var GZ_NAV_UI = globalThis.GZ_NAV_UI || (() => {
  const X = globalThis.GZ_CTX;
  const rail = X.site === 'ultra' && typeof GZ_NAV !== 'undefined' ? GZ_ULTRA_RAIL(X) : null;
  let reading = '', loaded = null, toggle = null;
  const titled = new Map();
  const labels = new Set();
  const forget = () => { if (loaded) URL.revokeObjectURL(loaded.src); loaded = null; };
  const sync = () => {
    const n = X.nav();
    const on = X.on() && X.settings().enabled;
    rail?.sync(on);
    for (const [a, text] of titled) if (a.isConnected === false) { if (a.getAttribute('title') === text) a.removeAttribute('title'); titled.delete(a); }
    const b = X.site === 'ultra' ? null : document.getElementById('primaryNavToggle');
    for (const el of labels) if (!on || (!n.collapsed && n.labels !== 'icons') || !el.isConnected) { el.classList.remove('gz-nav-label'); labels.delete(el); }
    if (X.site === 'ultra' && on && (n.collapsed || n.labels === 'icons')) {
      for (const a of document.querySelectorAll(':is(nav:has(> #base_tools), nav#base_tools, nav[class*="makeStylesnavigation"]) a')) {
        for (const el of a.querySelectorAll('.MuiListItemText-root, .MuiTypography-root, span:not(:has(svg))')) {
          if (!el.querySelector('svg') && !el.closest('.MuiBadge-root') && el.textContent.trim() && !labels.has(el)) { el.classList.add('gz-nav-label'); labels.add(el); }
        }
      }
    }
    if (on && (n.collapsed || n.labels === 'icons')) {
      for (const a of document.querySelectorAll(X.site === 'ultra' ? ':is(nav:has(> #base_tools), nav#base_tools, nav[class*="makeStylesnavigation"]) a' : '#header .ic-app-header__menu-list-link')) if (!titled.has(a) && !a.hasAttribute('title')) {
        const text = a.getAttribute('aria-label') || a.textContent.trim();
        if (text) { titled.set(a, text); a.title = text; }
      }
    } else {
      for (const [a, text] of titled) if (a.getAttribute('title') === text) a.removeAttribute('title');
      titled.clear();
    }
    if (on && n.collapsed && b) {
      if (toggle?.el !== b) toggle = { el: b, label: b.getAttribute('aria-label'), title: b.getAttribute('title') };
      const text = X.t('Expand global navigation');
      if (b.getAttribute('aria-label') !== text) { b.setAttribute('aria-label', text); b.title = text; }
    } else if (toggle) {
      for (const k of ['label', 'title']) {
        const a = k === 'label' ? 'aria-label' : k;
        if (toggle[k] === null) toggle.el.removeAttribute(a); else toggle.el.setAttribute(a, toggle[k]);
      }
      toggle = null;
    }
    if (!on || !n.i) {
      reading = ''; forget();
      return;
    }
    if (reading === n.i) { if (loaded?.id === n.i) X.repaintNav(loaded.src); return; }
    reading = n.i;
    forget();
    X.local((area) => area.get(`cardImg:${n.i}`, (r) => {
      if (!X.on() || X.nav().i !== n.i || reading !== n.i) return;
      const src = r?.[`cardImg:${n.i}`];
      if (typeof src !== 'string' || src.length > 400000 || !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(src)) return;
      const [type, bytes] = src.split(',');
      let decoded;
      try { decoded = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)); } catch { return; }
      const blob = new Blob([decoded], { type: type.slice(5, type.indexOf(';')) });
      loaded = { id: n.i, src: URL.createObjectURL(blob) };
      X.repaintNav(loaded.src);
    }));
  };
  document.addEventListener('click', (e) => {
    if (!X.on() || !X.nav().collapsed || !e.target.closest?.('#primaryNavToggle')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    chrome.runtime.sendMessage({ type: 'glaze:nav', nav: { collapsed: false } }).then((r) => {
      if (r?.ok && X.on()) document.body.classList.add('primary-nav-expanded');
    }).catch(() => {});
  }, true);
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && X.nav().i && c[`cardImg:${X.nav().i}`]) { reading = ''; sync(); }
  });
  return { sync };
})();
GZ_NAV_UI;

// The modern drawer and legacy rail keep their native links. Comments remember each item's original DOM position.
function GZ_ULTRA_RAIL(X) {
  const N = GZ_NAV, roots = 'nav[class*="makeStylesnavigation"], nav#base_tools, nav:has(> #base_tools)';
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const setText = (e, text) => { if (e.textContent !== text) e.textContent = text; };
  const get = (area, keys) => new Promise((res) => { try { chrome.storage[area].get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } });
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const captured = new Map(), custom = new Map();
  let config = N.clean(), active = false, host, top, bottom, signature = '', clock = 0, logo = null, logoId = '', rev = 0, reads = 0, local = {}, W, P, icons;
  const icon = (name) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', name === 'dashboard' ? 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' : icons?.[name] || icons?.link || 'M5 12h14');
    svg.append(path); return svg;
  };
  const restore = () => {
    clearTimeout(clock); clock = 0;
    const focused = document.activeElement, managed = [...captured.keys(), ...custom.values()].some((a) => a === focused || a.contains(focused));
    const fallback = [...captured.keys()].find((a) => !captured.get(a).hidden);
    for (const [a, r] of captured) {
      if (r.mark.isConnected) { r.mark.after(r.unit); r.mark.remove(); }
      r.unit.hidden = r.hidden; delete r.unit.dataset.gzNavId;
      if (r.label && r.label.textContent === X.t('Dashboard')) r.label.textContent = r.text;
      if (r.aria === null) a.removeAttribute('aria-label'); else a.setAttribute('aria-label', r.aria);
      r.icon?.classList.remove('gz-nav-native-icon'); r.own?.remove();
    }
    captured.clear();
    for (const a of custom.values()) a.remove(); custom.clear();
    top?.remove(); bottom?.remove(); top = bottom = host = null; signature = '';
    logoId = ''; if (logo) URL.revokeObjectURL(logo); logo = null;
    document.documentElement.style.removeProperty('--gz-nav-logo');
    if (managed) (focused.isConnected ? focused : fallback)?.focus({ preventScroll: true });
  };
  const loadLogo = () => {
    const id = X.nav().li;
    if (id === logoId) return;
    logoId = id;
    if (logo) URL.revokeObjectURL(logo); logo = null;
    document.documentElement.style.removeProperty('--gz-nav-logo');
    if (!id) return;
    get('local', `navLogo:${id}`).then((r) => {
      if (!active || logoId !== id || X.nav().li !== id) return;
      const src = r[`navLogo:${id}`];
      if (typeof src !== 'string' || src.length > 400000 || !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(src)) return;
      try {
        const [type, bytes] = src.split(',');
        const next = URL.createObjectURL(new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], { type: type.slice(5, type.indexOf(';')) }));
        logo = next;
        const image = new Image();
        image.onload = () => { if (active && logo === next && logoId === id) document.documentElement.style.setProperty('--gz-nav-logo', `url("${next}")`); else URL.revokeObjectURL(next); };
        image.onerror = () => { URL.revokeObjectURL(next); if (logo === next) logo = null; };
        image.src = next;
      } catch { /* Damaged pictures keep Glaze's bundled logo. */ }
    });
  };
  const readLocal = () => {
    const token = rev, read = ++reads;
    get('local', ['widgetTimer', 'todoCache', 'dueWeek', 'dueWeekFrom']).then(async (r) => {
      if (!active || token !== rev || read !== reads) return;
      local = r;
      const key = r.todoCache?.key;
      if (typeof key === 'string' && key.startsWith(`todo:${location.origin}/`) && Date.now() - r.todoCache.at < 120000) {
        const petKey = key.replace(/^todo:/, 'pet:');
        local.pet = (await get('local', petKey))[petKey];
      }
      if (active && token === rev && read === reads) drawWidgets();
    });
  };
  const widgetNodes = new Map();
  const drawWidgets = () => {
    clearTimeout(clock); clock = 0;
    if (!active || !host || !top || document.visibilityState === 'hidden') return;
    const now = Date.now();
    for (const w of config.widgets.filter((w) => w.on)) {
      const node = widgetNodes.get(w.id); if (!node) continue;
      if (w.id === 'clock') {
        const date = new Date(now), time = new Intl.DateTimeFormat(X.locale(), { hour: 'numeric', minute: '2-digit' }).format(date);
        const day = new Intl.DateTimeFormat(X.locale(), { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
        setText(node.time, time); setText(node.detail, day); node.box.title = `${time} · ${day}`;
      }
      if (w.id === 'next') {
        const list = local.dueWeekFrom === location.origin && Array.isArray(local.dueWeek) ? local.dueWeek : [];
        const item = list.filter((i) => i && typeof i.title === 'string' && Number.isFinite(i.due) && i.due > now && /^_\d+_\d+$/.test(i.cid) && /^_\d+_\d+$/.test(i.content)).sort((a, b) => a.due - b.due)[0];
        const label = item ? `${item.title.slice(0, 200)} · ${GZ_PAGE.describe(new Date(item.due), true, new Date(now), X.locale()).rel}` : X.t('No upcoming work');
        setText(node.detail, label); node.box.title = label; node.box.setAttribute('aria-label', label);
        if (item) { node.box.href = `${location.origin}/ultra/redirect?redirectType=nautilus&courseId=${encodeURIComponent(item.cid)}&contentId=${encodeURIComponent(item.content)}`; node.box.removeAttribute('aria-disabled'); }
        else { node.box.removeAttribute('href'); node.box.setAttribute('aria-disabled', 'true'); }
      }
      if (w.id === 'timer' && W && node.options) {
        const before = W.cleanTimer(local.widgetTimer), state = W.advance(before, now, node.options);
        if (state !== before) send({ type: 'glaze:widgetTimer', op: 'advance' });
        const left = W.clock(W.left(state, now, node.options));
        setText(node.time, left); setText(node.go, X.t(state.end ? 'Pause' : 'Start'));
        node.go.setAttribute('aria-label', `${X.t(state.end ? 'Pause' : 'Start')} · ${X.t('Focus timer')}`);
      }
      if (w.id === 'pet' && P) {
        const data = P.view(local.pet);
        const label = X.t('Level {level}', { level: data?.level || 1 }); setText(node.detail, label);
        node.box.title = `${X.t('Pet habitat')} · ${label}`; node.box.setAttribute('aria-label', node.box.title);
        const art = P.WEAR[data?.wear || 'plain'].art;
        const src = chrome.runtime.getURL(`assets/art/stickers/critters/${art}.webp`);
        if (node.image.src !== src) node.image.src = src;
      }
    }
    if (config.widgets.some((w) => w.on)) { const step = config.widgets.some((w) => w.on && w.id === 'timer') && local.widgetTimer?.end ? 1000 : 60000; clock = setTimeout(drawWidgets, step - now % step + 5); }
  };
  const mountWidgets = () => {
    const sig = JSON.stringify(config.widgets);
    if (sig === signature) return;
    signature = sig; widgetNodes.clear(); top.replaceChildren(); bottom.replaceChildren();
    const token = ++rev;
    for (const w of config.widgets.filter((w) => w.on)) {
      const box = make(w.id === 'next' ? 'a' : 'div', { className: 'gz-nav-widget' });
      if (w.id !== 'next') box.setAttribute('role', 'group');
      box.setAttribute('aria-label', X.t({ clock: 'Clock and date', next: 'Next due', timer: 'Focus timer', pet: 'Pet habitat' }[w.id]));
      const time = make('span'), detail = make('span', { className: 'gz-nav-detail' });
      const node = { box, time, detail }; widgetNodes.set(w.id, node);
      if (w.id === 'clock') box.append(time, detail);
      if (w.id === 'next') box.append(icon('calendar'), detail);
      if (w.id === 'timer') {
        const go = make('button', { type: 'button', textContent: X.t('Start') }), reset = make('button', { type: 'button', textContent: X.t('Reset') });
        reset.setAttribute('aria-label', `${X.t('Reset')} · ${X.t('Focus timer')}`);
        const action = async (op) => { const r = await send({ type: 'glaze:widgetTimer', op }); if (active && r?.ok) { local.widgetTimer = r.timer; drawWidgets(); } };
        go.addEventListener('click', () => action('toggle')); reset.addEventListener('click', () => action('reset'));
        box.append(time, go, reset); node.go = go;
        X.need('lib/widgets.js', () => globalThis.GZ_WIDGETS).then(async () => {
          const settings = await get('sync', 'widgets');
          if (!active || token !== rev) return;
          W = GZ_WIDGETS; node.options = GZ_SANITIZE(settings).widgets; drawWidgets();
        }).catch(() => {});
      }
      if (w.id === 'pet') {
        node.image = make('img', { alt: '', width: 28, height: 28 }); detail.classList.add('gz-nav-pet-level'); box.append(node.image, detail);
        X.need('lib/pet.js', () => globalThis.GZ_PET).then(() => { if (active && token === rev) { P = GZ_PET; drawWidgets(); } }).catch(() => {});
      }
      (w.at === 'top' ? top : bottom).append(box);
    }
    readLocal(); drawWidgets();
  };
  const sync = (on) => {
    active = on;
    if (!on) { rev++; restore(); widgetNodes.clear(); return; }
    const root = document.querySelector(roots);
    if (!root) return;
    const list = root.querySelector(':scope > #base_tools, :scope > ul') || root;
    if (host !== list) { restore(); host = list; top = make('div', { className: 'gz-nav-widgets' }); bottom = make('div', { className: 'gz-nav-widgets' }); list.before(top); list.after(bottom); }
    for (const a of list.querySelectorAll('a:not(.gz-nav-link)')) {
      const id = N.native(a.getAttribute('href')); if (!id || captured.has(a)) continue;
      const unit = a.parentElement.tagName === 'LI' ? a.parentElement : a;
      const mark = document.createComment('glaze-nav'); unit.before(mark);
      const label = a.querySelector('.MuiListItemText-root, .MuiTypography-root, span:not(:has(svg))');
      const r = { id, unit, mark, hidden: unit.hidden, label, text: label?.textContent, aria: a.getAttribute('aria-label') };
      captured.set(a, r); unit.dataset.gzNavId = id;
      if (id === 'institution-page') { r.icon = a.querySelector('svg'); r.icon?.classList.add('gz-nav-native-icon'); r.own = icon('dashboard'); a.prepend(r.own); }
    }
    for (const [a, r] of captured) {
      r.unit.hidden = r.hidden || config.hidden.includes(r.id);
      if (r.id === 'institution-page') { if (r.label) setText(r.label, X.t('Dashboard')); a.setAttribute('aria-label', X.t('Dashboard')); }
    }
    for (const [id, a] of custom) if (!config.links.some((l) => l.id === id)) { a.remove(); custom.delete(id); }
    for (const l of config.links) {
      let a = custom.get(l.id);
      if (!a) { a = make('a', { className: 'MuiButtonBase-root MuiListItemButton-root base-navigation-button-content gz-nav-link' }, icon(l.i), make('span', { className: 'MuiListItemText-root' })); a.dataset.gzNavId = l.id; custom.set(l.id, a); }
      a.href = l.u; a.target = l.tab ? '_blank' : '_self'; a.rel = l.tab ? 'noopener noreferrer' : ''; a.title = l.n; a.setAttribute('aria-label', l.n);
      setText(a.lastElementChild, l.n);
      if (a.dataset.icon !== l.i) { a.firstElementChild.replaceWith(icon(l.i)); a.dataset.icon = l.i; }
    }
    const units = new Map([...captured.values()].filter((r) => r.unit.isConnected).map((r) => [r.id, r.unit]));
    for (const [id, a] of custom) units.set(id, a);
    const order = N.sequence([...units.keys()], config);
    if (JSON.stringify([...list.children].map((e) => e.dataset.gzNavId).filter(Boolean)) !== JSON.stringify(order)) { const focused = document.activeElement; for (const id of order) list.append(units.get(id)); if (list.contains(focused)) focused.focus({ preventScroll: true }); }
    mountWidgets(); loadLogo();
  };
  if (location.pathname.endsWith('/preview.html')) document.addEventListener('click', (e) => { if (e.target.closest?.('a')) e.preventDefault(); });
  const load = () => get('sync', 'navItems').then((r) => { config = N.clean(r.navItems); if (active) sync(true); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.navItems) { config = N.clean(changes.navItems.newValue); if (active) sync(true); }
    if (area === 'local') {
      if (logoId && changes[`navLogo:${logoId}`]) { logoId = ''; if (active) loadLogo(); }
      if (active && Object.keys(changes).some((k) => ['widgetTimer', 'todoCache', 'dueWeek', 'dueWeekFrom'].includes(k) || k.startsWith('pet:'))) readLocal();
    }
    if (area === 'sync' && changes.widgets && active) { signature = ''; mountWidgets(); }
  });
  addEventListener('pagehide', () => { active = false; rev++; restore(); });
  document.addEventListener('visibilitychange', () => { if (active) drawWidgets(); });
  addEventListener('message', (e) => { if (e.origin === location.origin && e.source === parent && e.data?.gzNavPreview) { config = N.clean(e.data.gzNavPreview); if (active) sync(true); } });
  X.need('lib/cards.js', () => globalThis.GZ_CARDS).then(() => { icons = GZ_CARDS.ICONS; signature = ''; if (active) { for (const a of custom.values()) a.dataset.icon = ''; sync(true); } }).catch(() => {});
  load();
  return { sync };
}

if (typeof module !== 'undefined') module.exports = GZ_NAV_UI; else GZ_NAV_UI;
