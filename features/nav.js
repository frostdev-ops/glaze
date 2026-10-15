// Canvas's rail uses CSS at first paint.
// shortcut: cold local pictures start with their fill; revisit if their first paint must block.
var GZ_NAV_UI = globalThis.GZ_NAV_UI || (() => {
  const X = globalThis.GZ_CTX;
  const rail = X.site === 'ultra' && typeof GZ_NAV !== 'undefined' ? GZ_ULTRA_RAIL(X) : null;
  let reading = '', loaded = null, toggle = null;
  const overlay = rail ? GZ_ULTRA_OVERLAY(X, () => X.repaintNav(loaded?.src)) : null;
  const titled = new Map();
  const labels = new Set(), fitted = new Map();
  let fitFrame = 0, fitObserver;
  const fitLabels = () => {
    fitFrame = 0;
    if (!chrome.runtime?.id) { fitObserver?.disconnect(); fitted.clear(); return; }
    if (!X.on() || X.nav().labelOverflow !== 'shrink') return;
    const size = GZ_NAV.dimensions(X.nav()).text;
    for (const [a, label] of fitted) {
      if (!a.isConnected) { fitObserver.unobserve(a); fitted.delete(a); continue; }
      a.style.setProperty('--gz-nav-fit', `${size}px`);
      if (label.scrollWidth > label.clientWidth && label.clientWidth) a.style.setProperty('--gz-nav-fit', `${Math.max(10, Math.floor(size * label.clientWidth / label.scrollWidth * 100) / 100)}px`);
    }
  };
  const forget = () => { if (loaded) URL.revokeObjectURL(loaded.src); loaded = null; };
  const sync = () => {
    const n = X.nav();
    const on = X.on() && X.settings().enabled;
    rail?.sync(on);
    overlay?.sync(on);
    if (X.site === 'ultra' && on && n.labelOverflow === 'shrink' && (!n.collapsed || overlay?.open()) && (n.labels !== 'icons' || overlay?.open())) {
      fitObserver ||= new ResizeObserver(() => { if (!fitFrame) fitFrame = requestAnimationFrame(fitLabels); });
      for (const a of document.querySelectorAll(':is(nav#base_tools, nav:has(> #base_tools), nav[class*="makeStylesnavigation"]) a[href], .MuiDrawer-paper:has(:is(#base_tools, nav[class*="makeStylesnavigation"])) :is(footer, [class*="makeStylesfooter"]) a[href]')) {
        const label = a.querySelector('.MuiTypography-root') || a.querySelector('.MuiListItemText-root, span:not(:has(svg))') || a;
        if (label && !fitted.has(a)) { fitted.set(a, label); fitObserver.observe(a); }
      }
      fitLabels();
    } else if (fitted.size) { for (const a of fitted.keys()) a.style.removeProperty('--gz-nav-fit'); fitted.clear(); fitObserver.disconnect(); cancelAnimationFrame(fitFrame); fitFrame = 0; }
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
    if (!chrome.runtime?.id || !X.on() || !X.nav().collapsed || !e.target.closest?.('#primaryNavToggle')) return;
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

// Expanded paper floats above the page; the saved collapsed rail still owns its narrow layout width.
function GZ_ULTRA_OVERLAY(X, repaint) {
  const html = document.documentElement, titles = new Map();
  let paper, button, enter = 0, leave = 0, expanded = false, hovered = false;
  const valid = () => { if (!chrome.runtime?.id) { cleanup(false); return false; } return X.on() && X.settings().enabled && X.nav().collapsed; };
  let hintStyle;
  const portalHints = () => {
    const ids = new Set();
    for (const el of paper.querySelectorAll('[aria-describedby]')) for (const id of el.getAttribute('aria-describedby').split(/\s+/)) if (id) ids.add(id);
    hintStyle.textContent = [...ids].map((id) => `#${CSS.escape(id)}[role="tooltip"], #${CSS.escape(id)} [role="tooltip"] { visibility: hidden !important; }`).join('\n');
  };
  const suppress = (el) => {
    const title = el.getAttribute('title') ?? el.getAttribute('data-gz-title');
    if (title === '' && titles.has(el)) return;
    titles.set(el, title); if (title !== '') el.setAttribute('title', '');
  };
  const titleObserver = new MutationObserver((ms) => { if (expanded && valid()) for (const m of ms) { if (m.attributeName === 'aria-describedby') portalHints(); else suppress(m.target); } });
  const setOpen = (on) => {
    clearTimeout(enter); clearTimeout(leave); enter = leave = 0;
    if (on === expanded) return;
    expanded = on;
    html.toggleAttribute('data-gz-nav-expanded', on);
    button?.setAttribute('aria-expanded', String(on));
    if (button) button.setAttribute('aria-label', X.t(on ? 'Collapse the sidebar' : 'Expand global navigation'));
    if (on) {
      hintStyle = document.createElement('style'); document.head.append(hintStyle);
      for (const el of paper.querySelectorAll('a, button, [title], [data-gz-title]')) suppress(el);
      portalHints(); titleObserver.observe(paper, { attributes: true, subtree: true, attributeFilter: ['title', 'aria-describedby'] });
      if (X.nav().labelOverflow === 'shrink') queueMicrotask(() => { if (expanded && valid()) GZ_NAV_UI.sync(); });
    } else {
      titleObserver.disconnect();
      hintStyle?.remove(); hintStyle = null;
      for (const [el, title] of titles) if (el.isConnected && (!el.hasAttribute('title') || el.getAttribute('title') === '') && ((X.on() && X.settings().enabled) || !el.closest('nav, footer, [class*="makeStylesfooter"]'))) { if (title === null) el.removeAttribute('title'); else el.setAttribute('title', title); }
      titles.clear();
      if (chrome.runtime?.id && X.on()) repaint();
    }
  };
  const laterClose = () => {
    clearTimeout(enter); enter = 0; clearTimeout(leave);
    leave = setTimeout(() => { leave = 0; if (valid() && !hovered && !paper.contains(document.activeElement)) setOpen(false); }, 300);
  };
  const pointerEnter = (e) => {
    if (!valid() || e.pointerType === 'touch' || !X.nav().expandOnHover || !matchMedia('(hover: hover)').matches) return;
    hovered = true; clearTimeout(leave); clearTimeout(enter); enter = setTimeout(() => { enter = 0; if (valid() && hovered) setOpen(true); }, 150);
  };
  const pointerLeave = (e) => { if (!valid() || e.pointerType === 'touch') return; hovered = false; laterClose(); };
  const focusIn = (e) => { if (valid() && e.target !== button) setOpen(true); };
  const focusOut = (e) => { if (valid() && !paper.contains(e.relatedTarget)) laterClose(); };
  const outside = (e) => { if (valid() && expanded && !paper.contains(e.target)) { hovered = false; setOpen(false); } };
  const toggle = (e) => { if (!valid()) return; e.preventDefault(); e.stopPropagation(); setOpen(!expanded); };
  const keydown = (e) => { if (valid() && expanded && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hovered = false; setOpen(false); button.focus({ preventScroll: true }); } };
  const cleanup = (restore = true) => {
    clearTimeout(enter); clearTimeout(leave); enter = leave = 0; hovered = false;
    if (!paper) return;
    if (restore) setOpen(false); else { expanded = false; titles.clear(); hintStyle?.remove(); hintStyle = null; }
    titleObserver.disconnect();
    for (const [name, fn] of [['pointerenter', pointerEnter], ['pointerleave', pointerLeave], ['focusin', focusIn], ['focusout', focusOut], ['keydown', keydown]]) paper.removeEventListener(name, fn);
    document.removeEventListener('pointerdown', outside, true);
    if (restore && document.activeElement === button) paper.querySelector('a[href]')?.focus({ preventScroll: true });
    button.remove(); button = null; paper = null;
  };
  const sync = (on) => {
    const next = on && X.nav().collapsed && document.querySelector('nav[class*="makeStylesnavigation"], nav#base_tools, nav:has(> #base_tools)')?.closest('.MuiDrawer-paper');
    if (next !== paper) {
      cleanup(); if (!next) return; paper = next;
      button = document.createElement('button'); button.type = 'button'; button.className = 'gz-nav-expand'; button.textContent = '›';
      button.setAttribute('aria-label', X.t('Expand global navigation')); button.setAttribute('aria-expanded', 'false'); button.addEventListener('click', toggle);
      (paper.querySelector('header') || paper).append(button);
      for (const [name, fn] of [['pointerenter', pointerEnter], ['pointerleave', pointerLeave], ['focusin', focusIn], ['focusout', focusOut], ['keydown', keydown]]) paper.addEventListener(name, fn);
      document.addEventListener('pointerdown', outside, true);
    }
    if (!X.nav().expandOnHover) { hovered = false; clearTimeout(enter); enter = 0; if (expanded && !paper.contains(document.activeElement)) setOpen(false); }
  };
  addEventListener('pagehide', cleanup, { once: true });
  return { sync, open: () => expanded };
}

// The modern drawer and legacy rail keep their native links. Comments remember each item's original DOM position.
function GZ_ULTRA_RAIL(X) {
  const N = GZ_NAV, roots = 'nav[class*="makeStylesnavigation"], nav#base_tools, nav:has(> #base_tools)', isPreview = /-extension:$/.test(location.protocol);
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const setText = (e, text) => { if (e.textContent !== text) e.textContent = text; };
  const get = (area, keys) => new Promise((res) => { try { chrome.storage[area].get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } });
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const captured = new Map(), custom = new Map();
  let config = N.clean(), active = false, host, top, bottom, signature = '', clock = 0, logo = null, logoId = '', rev = 0, reads = 0, local = {}, W, P, icons, iconRead;
  let nextItems = [], nextAt = 0, nextBusy = false, nextError = false, nextRetry = { key: '', at: 0 };
  let timerPending = false, advanced = '', timerFailed = '';
  const icon = (name) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', icons?.[name] || icons?.link || 'M5 12h14');
    svg.append(path); return svg;
  };
  const restore = () => {
    clearTimeout(clock); clock = 0;
    const focused = document.activeElement, managed = [...captured.keys(), ...[...custom.values()].map((r) => r.a)].some((a) => a === focused || a.contains(focused));
    const fallback = [...captured.keys()].find((a) => a.isConnected && !captured.get(a).hidden);
    for (const [a, r] of captured) {
      if (r.mark.isConnected && r.unit.isConnected) r.mark.after(r.unit); r.mark.remove();
      r.unit.hidden = r.hidden; delete r.unit.dataset.gzNavId;
    }
    captured.clear();
    for (const r of custom.values()) r.unit.remove(); custom.clear();
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
    get('local', isPreview ? ['todoCache'] : ['widgetTimer', 'todoCache']).then(async (r) => {
      if (!active || token !== rev || read !== reads) return;
      if (r.todoCache?.key !== local.todoCache?.key) { nextItems = []; nextAt = 0; }
      local = { ...r, ...(isPreview && { widgetTimer: local.widgetTimer }) };
      const key = r.todoCache?.key;
      if (typeof key === 'string' && key.startsWith(`todo:${location.origin}/`) && Date.now() - r.todoCache.at < 120000) {
        const petKey = key.replace(/^todo:/, 'pet:');
        local.pet = (await get('local', petKey))[petKey];
      }
      if (active && token === rev && read === reads) drawWidgets();
    });
  };
  const refreshNext = async () => {
    const token = rev, read = reads, url = location.href;
    const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 7);
    const key = `${local.todoCache?.key || location.origin} ${+start}`;
    const current = () => chrome.runtime?.id && active && X.on() && X.settings().enabled && token === rev && read === reads && url === location.href && document.visibilityState !== 'hidden' && config.widgets.some((w) => w.id === 'next' && w.on);
    if (isPreview || nextBusy || Date.now() - nextAt < 120000 || nextRetry.key === key && Date.now() < nextRetry.at || !current()) return;
    nextBusy = true; nextAt = Date.now();
    try {
      await Promise.all([X.need('lib/ultra.js', () => globalThis.GZ_ULTRA), X.need('lib/todo.js', () => globalThis.GZ_TODO)]);
      if (!current()) return;
      const plan = await GZ_ULTRA.page.planned(+start, +end, local.todoCache);
      if (!current()) return;
      const [raw, options] = await Promise.all([get('local', plan.key), get('sync', 'todo')]);
      if (!current()) return;
      const data = GZ_TODO.clean(raw[plan.key]), mode = GZ_SANITIZE(options).todo.done;
      nextItems = plan.items.filter((i) => i && !i.ov?.dismissed && !GZ_TODO.isDone(i, mode, data.items[`${i.type}:${i.id}`]?.done)); nextError = false;
    } catch { nextRetry = { key, at: Date.now() + 60000 }; if (current()) { nextItems = []; nextAt = 0; nextError = true; } }
    finally {
      const fresh = current();
      if (fresh) drawWidgets(); else nextAt = 0;
      nextBusy = false;
      if (!fresh && active && chrome.runtime?.id) drawWidgets();
    }
  };
  const timerAction = async (op, node) => {
    if (!W || timerPending || !node.options) return;
    timerPending = true;
    const token = rev, read = reads;
    let r;
    if (isPreview) {
      const now = Date.now(), before = W.cleanTimer(local.widgetTimer);
      let timer = W.advance(before, now, node.options);
      if (op === 'reset') timer = W.IDLE;
      if (op === 'toggle') timer = timer.end ? W.pause(timer, now) : W.start(timer, now, node.options);
      r = { ok: true, timer };
    } else r = await send({ type: 'glaze:widgetTimer', op });
    timerPending = false;
    if (!active || token !== rev || read !== reads) return;
    node.status.textContent = r?.ok ? '' : X.t('Not saved. Try again in a moment.');
    timerFailed = r?.ok ? '' : JSON.stringify(W.cleanTimer(local.widgetTimer));
    if (r?.ok) { local.widgetTimer = r.timer; if (op !== 'advance') advanced = ''; }
    drawWidgets();
  };
  const widgetNodes = new Map();
  const drawWidgets = () => {
    clearTimeout(clock); clock = 0;
    if (!chrome.runtime?.id || !active || !host || !top || document.visibilityState === 'hidden') return;
    const now = Date.now();
    for (const w of config.widgets.filter((w) => w.on)) {
      const node = widgetNodes.get(w.id); if (!node) continue;
      if (w.id === 'clock') {
        const date = new Date(now), time = new Intl.DateTimeFormat(X.locale(), { hour: 'numeric', minute: '2-digit' }).format(date);
        const day = new Intl.DateTimeFormat(X.locale(), { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
        setText(node.time, time); setText(node.detail, day); node.box.title = `${time} · ${day}`;
        node.box.setAttribute('aria-label', `${X.t('Clock and date')} · ${time} · ${day}`);
      }
      if (w.id === 'next') {
        refreshNext();
        const item = nextItems.filter((i) => typeof i.title === 'string' && Number.isFinite(i.at) && i.at > now && /^_\d+_\d+$/.test(i.cid)).sort((a, b) => a.at - b.at)[0];
        const label = item ? `${item.title.slice(0, 200)} · ${GZ_PAGE.describe(new Date(item.at), true, new Date(now), X.locale()).rel}` : X.t(nextError ? "Glaze couldn't load this. Try again in a moment." : 'No upcoming work');
        setText(node.detail, label); node.box.title = label; node.box.setAttribute('aria-label', label);
        if (item) { node.box.href = /^_\d+_\d+$/.test(item.content) ? `${location.origin}/ultra/redirect?redirectType=nautilus&courseId=${encodeURIComponent(item.cid)}&contentId=${encodeURIComponent(item.content)}` : `${location.origin}/ultra/courses/${item.cid}/outline`; node.box.removeAttribute('aria-disabled'); }
        else { node.box.removeAttribute('href'); node.box.setAttribute('aria-disabled', 'true'); }
      }
      if (w.id === 'timer' && W && node.options) {
        const before = W.cleanTimer(local.widgetTimer), state = timerFailed === JSON.stringify(before) ? before : W.advance(before, now, node.options);
        if (state !== before && advanced !== JSON.stringify(before)) { advanced = JSON.stringify(before); timerAction('advance', node); }
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
    if (config.widgets.some((w) => w.on)) { const step = config.widgets.some((w) => w.on && w.id === 'timer') && local.widgetTimer?.end > now ? 1000 : 60000; clock = setTimeout(drawWidgets, step - now % step + 5); }
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
        node.status = make('span', { role: 'status', className: 'gz-nav-status' });
        go.addEventListener('click', () => timerAction('toggle', node)); reset.addEventListener('click', () => timerAction('reset', node));
        box.append(time, go, reset, node.status); node.go = go;
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
    if (!root) { if (host) restore(); return; }
    const list = root.querySelector(':scope > #base_tools, :scope > ul') || root;
    if (host !== list) { restore(); host = list; top = make('div', { className: 'gz-nav-widgets' }); bottom = make('div', { className: 'gz-nav-widgets' }); list.before(top); list.after(bottom); }
    for (const a of list.querySelectorAll('a:not(.gz-nav-link)')) {
      const id = N.native(a.getAttribute('href')); if (!id) continue;
      if (captured.has(a)) { const r = captured.get(a); if (!r.mark.isConnected) r.unit.before(r.mark); continue; }
      const unit = a.parentElement.tagName === 'LI' ? a.parentElement : a;
      const prior = [...captured].find(([, r]) => r.unit === unit);
      if (prior) captured.delete(prior[0]);
      const mark = prior?.[1].mark || document.createComment('glaze-nav'); if (!mark.isConnected) unit.before(mark);
      const r = { id, unit, mark, hidden: prior?.[1].hidden ?? unit.hidden };
      captured.set(a, r); unit.dataset.gzNavId = id;
    }
    for (const [a, r] of captured) {
      r.unit.hidden = r.hidden || config.hidden.includes(r.id);
    }
    for (const [id, r] of custom) if (!config.links.some((l) => l.id === id)) { r.unit.remove(); custom.delete(id); }
    for (const l of config.links) {
      let a = custom.get(l.id)?.a;
      if (!a) { a = make('a', { className: `MuiButtonBase-root MuiListItemButton-root gz-nav-link${root.matches('[class*="makeStylesnavigation"]') ? '' : ' base-navigation-button-content'}` }, icon(l.i), make('span', { className: 'MuiListItemText-root' })); const parent = [...captured.values()][0]?.mark.parentNode || list; const unit = parent.tagName === 'UL' ? make('li', {}, a) : a; unit.dataset.gzNavId = l.id; custom.set(l.id, { a, unit, parent }); }
      a.href = l.u; a.target = l.tab ? '_blank' : '_self'; a.rel = l.tab ? 'noopener noreferrer' : ''; a.title = l.n; a.setAttribute('aria-label', l.n);
      setText(a.lastElementChild, l.n);
      if (a.dataset.icon !== l.i) { a.firstElementChild.replaceWith(icon(l.i)); a.dataset.icon = l.i; }
    }
    const originals = [...captured.values()].filter((r) => r.unit.isConnected).sort((a, b) => a.mark.compareDocumentPosition(b.mark) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const units = new Map(originals.map((r) => [r.id, r.unit]));
    for (const [id, r] of custom) units.set(id, r.unit);
    const order = N.sequence([...units.keys()], config);
    const parents = new Map([...captured.values()].map((r) => [r.unit, r.mark.parentNode]));
    for (const r of custom.values()) parents.set(r.unit, r.parent);
    const focused = document.activeElement;
    for (const parent of new Set(parents.values())) {
      const wanted = order.map((id) => units.get(id)).filter((unit) => parents.get(unit) === parent);
      if (wanted.some((unit, at) => [...parent.children].filter((e) => e.dataset.gzNavId)[at] !== unit)) parent.append(...wanted);
    }
    if (list.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
    if ((config.links.length || config.widgets.some((w) => w.on && w.id === 'next')) && !iconRead) iconRead = X.need('lib/cards.js', () => globalThis.GZ_CARDS).then(() => { icons = GZ_CARDS.ICONS; if (active) { for (const { a } of custom.values()) a.dataset.icon = ''; sync(true); } }).catch(() => { iconRead = null; });
    mountWidgets(); loadLogo();
  };
  if (isPreview) document.addEventListener('click', (e) => { if (e.target.closest?.('a')) e.preventDefault(); });
  const load = () => get('sync', 'navItems').then((r) => { config = N.clean(r.navItems); if (active) sync(true); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.navItems) { config = N.clean(changes.navItems.newValue); if (active) sync(true); }
    if (area === 'local') {
      if (logoId && changes[`navLogo:${logoId}`]) { logoId = ''; if (active) loadLogo(); }
      if (active && Object.keys(changes).some((k) => (!isPreview && k === 'widgetTimer') || k === 'todoCache' || k.startsWith('todo:') || k.startsWith('pet:'))) { if (changes.todoCache) nextAt = 0; readLocal(); }
    }
    if (area === 'sync' && changes.widgets && active) { signature = ''; mountWidgets(); }
  });
  addEventListener('pagehide', () => { active = false; rev++; restore(); });
  document.addEventListener('visibilitychange', () => { if (active) drawWidgets(); });
  addEventListener('message', (e) => { if (isPreview && e.origin === location.origin && e.source === parent && e.data?.gzNavPreview) { config = N.clean(e.data.gzNavPreview); if (active) sync(true); } });
  load();
  return { sync };
}

if (typeof module !== 'undefined') module.exports = GZ_NAV_UI; else GZ_NAV_UI;
