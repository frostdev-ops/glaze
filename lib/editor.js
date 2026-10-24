// Extension settings page only. DOM ownership drives resets and coverage; no LMS startup imports.
var GZ_EDITOR = (() => {
  const keys = (root) => [...new Set([...root.querySelectorAll('[data-key], input[type="radio"], [data-setting-owner]')].flatMap((el) =>
    el.dataset.settingOwner?.split(/\s+/) || (el.dataset.key ? [el.dataset.key] : !el.hasAttribute('data-local') && el.name.includes('.') ? [el.name] : [])))];
  // A preference reset must not delete a palette library or orphan locally stored pictures.
  const kept = (path) => ['presets', 'nav.i', 'nav.li'].includes(path) || path.startsWith('navItems.');
  const at = (o, parts) => parts.reduce((x, k) => x?.[k], o);
  const expand = (path, value) => value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).length ? Object.keys(value).flatMap((k) => expand(`${path}.${k}`, value[k])) : [path];
  // Every resettable leaf under the paths, as [parent path parts, key].
  const leaves = (paths, defaults) => paths.flatMap((path) => expand(path, at(defaults, path.split('.')))).filter((path) => !kept(path)).map((path) => {
    const parts = path.split('.'), key = parts.pop();
    return [parts, key];
  });
  const reset = (state, paths, defaults) => {
    const touched = new Set();
    for (const [parts, key] of leaves(paths, defaults)) {
      const target = at(state, parts), source = at(defaults, parts);
      if (!target || !source || !Object.hasOwn(source, key)) continue;
      target[key] = structuredClone(source[key]); touched.add(parts[0] || key);
    }
    return [...touched];
  };
  // Whether a reset of these paths would change anything: what decides if its Reset button shows.
  const differs = (state, paths, defaults) => leaves(paths, defaults).some(([parts, key]) => {
    const source = at(defaults, parts);
    return !!source && Object.hasOwn(source, key) && JSON.stringify(at(state, parts)?.[key]) !== JSON.stringify(source[key]);
  });
  // Addresses from before the settings were grouped by what they change: each still opens its section. Bare names are the old
  // categories, which a remembered editorTab may hold.
  const MOVED = {
    'look/cards': 'courses/cards', 'look/courses': 'courses/list', 'look/navigation': 'navigation/bar', 'blackboard/nav': 'navigation/bar',
    'blackboard/dashboard': 'pages/dashboard', 'blackboard/stream': 'pages/dashboard', 'blackboard/folders': 'pages/declutter',
    'blackboard/declutter': 'pages/declutter', 'blackboard/tabs': 'navigation/tabs', 'canvas/documents': 'pages/documents',
    'canvas/quizzes': 'pages/documents', 'canvas/shared': 'pages/content', 'moodle/courses': 'look/palette', 'study/tools': 'pages/content',
    blackboard: 'pages/dashboard', canvas: 'pages/documents', moodle: 'look/palette',
    'bb-folders': 'pages/declutter', 'canvas-quizzes': 'pages/documents', 'canvas-shared': 'pages/content', 'moodle-courses': 'look/palette',
  };
  // Old sections that became a part of another section's More options: their address opens it there.
  const INSIDE = { 'blackboard/stream': 'bb-stream', 'blackboard/nav': 'bb-navigation' };
  // A control shows only where it has an effect ([data-show] names its rule). Surface opacity: lib/surfaces.js paints its value only
  // over a blurred, non-solid page; elsewhere any custom value is opaque.
  const SHOW = {
    surfaceOpacity: (s) => s.look.glass > 0 && s.bg.kind !== 'solid',
    tintSource: (s) => s.look.surfaceTint > 0,
    tooltips: (s) => s.look.tooltips,
    auto: (s) => s.auto.on,
    remind: (s) => s.enhance.remind, remindExam: (s) => s.enhance.remindExam, remindPlan: (s) => s.enhance.remindPlan, remindClass: (s) => s.enhance.remindClass,
    navbar: (s) => s.navbar.on, siteNav: (s) => !s.navbar.on,
    logo: (s) => (s.navbar.on ? s.navbar.brand : s.nav.brand) === 'custom',
  };
  // The section the side list marks while the page scrolls: the top-most one still showing below the header line, or at the
  // page's end the last. rects: [{ route, top, bottom }] in page order.
  const spy = (rects, line, end) => (end ? rects.at(-1) : rects.find((r) => r.bottom > line + 1) || rects.at(-1))?.route || '';
  const mount = ({ doc = document, onRoute = () => {} } = {}) => {
    const tabs = [...doc.querySelectorAll('[data-editor-tab]')], panels = [...doc.querySelectorAll('[data-editor-panel]')];
    const sections = [...doc.querySelectorAll('[data-editor-section]')], routes = new Map(sections.map((s) => [s.dataset.editorSection, s]));
    const first = (tab) => sections.find((s) => s.dataset.editorSection.startsWith(`${tab}/`))?.dataset.editorSection;
    const legacy = new Map([...doc.querySelectorAll('[data-editor-section], [data-editor-section] [id]')].filter((s) => s.id).map((s) => [s.id, s.closest('[data-editor-section]').dataset.editorSection]));
    const mores = [...doc.querySelectorAll('details.more')], all = doc.getElementById?.('editor-all');
    const jumps = doc.querySelector?.('.jumps'), groups = [...doc.querySelectorAll('[data-editor-jumps]')], links = [...doc.querySelectorAll('[data-editor-jump]')];
    let route = '', part = '', finding = false, searchScroll = null, wide = true, opened = null, everything = false, current = '', pinned = 0;
    // One accent mark slides to the marked link (CSS moves it; motion off holds it still).
    const mark = jumps && Object.assign(doc.createElement('span'), { className: 'jump-mark' });
    if (mark) { mark.setAttribute('aria-hidden', 'true'); jumps.prepend(mark); }
    const markAt = (next) => {
      current = next;
      for (const a of links) {
        if (a.getAttribute('href') === `#${next}`) a.setAttribute('aria-current', 'location');
        else a.removeAttribute('aria-current');
      }
      if (!mark) return;
      const link = links.find((a) => a.hasAttribute('aria-current') && !a.closest('[hidden]') && !a.hidden);
      mark.hidden = !link || finding;
      if (!link) return;
      // A new category's list: the mark starts there, without sliding across.
      const group = link.parentElement.dataset.editorJumps;
      mark.classList.toggle('instant', mark.dataset.group !== group); mark.dataset.group = group;
      mark.style.transform = `translateY(${link.offsetTop}px)`; mark.style.height = `${link.offsetHeight}px`;
    };
    // Power-user sections an address led to stay in view, All settings or not.
    const shown = new Set();
    const resolve = (hash) => {
      const value = hash.replace(/^#/, '');
      return routes.has(value) ? value : MOVED[value] && routes.has(MOVED[value]) ? MOVED[value] : legacy.get(value) || first(value) || first('look');
    };
    // The active category's sections under its tab: the list is laid over the room left below the tab.
    const place = () => {
      if (!jumps) return;
      const tab = route.split('/')[0], active = tabs.find((el) => el.dataset.editorTab === tab);
      for (const g of groups) g.hidden = g.dataset.editorJumps !== tab;
      for (const el of tabs) el.style.marginBlockEnd = '';
      if (!active) return;
      // In one column the categories are a row: the active one scrolled into it.
      if (!wide) { const row = active.parentElement; row.scrollLeft = active.offsetLeft - row.offsetLeft - (row.clientWidth - active.offsetWidth) / 2; return; }
      if (finding) return;
      active.style.marginBlockEnd = `${jumps.offsetHeight}px`;
      jumps.style.top = `${active.offsetTop + active.offsetHeight}px`;
    };
    const sync = () => {
      for (const s of sections) s.toggleAttribute('data-folded', s.hasAttribute('data-editor-power') && !everything && !finding && !shown.has(s.dataset.editorSection));
      for (const a of links) { const s = routes.get(a.getAttribute('href').slice(1)); a.hidden = !s || s.hidden || s.hasAttribute('data-folded'); }
      place();
      markAt(current || route);
    };
    // Scrolling marks the section in view; just after a jump to one, that one stays marked while the page settles.
    const follow = () => {
      if (finding || Date.now() < pinned) return;
      const tab = route.split('/')[0], line = parseFloat(doc.documentElement.style.getPropertyValue('--editor-header')) || 0;
      const rects = sections.filter((s) => s.dataset.editorSection.startsWith(`${tab}/`) && s.getClientRects().length)
        .map((s) => { const r = s.getBoundingClientRect(); return { route: s.dataset.editorSection, top: r.top, bottom: r.bottom }; });
      const next = spy(rects, line, innerHeight + scrollY >= doc.documentElement.scrollHeight - 2);
      if (next && next !== current) markAt(next);
    };
    const show = (next, { scroll = false, focus = false, remember = false } = {}) => {
      const value = next.replace(/^#/, ''), target = doc.getElementById?.(INSIDE[value] || value);
      route = resolve(next); const tab = route.split('/')[0];
      shown.add(route);
      // An address of something inside a More options opens it, and is what the page scrolls to.
      const more = target?.matches?.('details.more') ? target : target?.closest?.('details.more');
      more?.setAttribute('open', '');
      for (const el of tabs) { const active = el.dataset.editorTab === tab; el.setAttribute('aria-selected', String(active)); el.tabIndex = active ? 0 : -1; if (active && focus) el.focus(); }
      for (const el of panels) el.hidden = !finding && el.dataset.editorPanel !== tab;
      current = route;
      if (remember) chrome.storage.local.set({ editorTab: tab }).catch(() => {});
      sync();
      if (scroll) { pinned = Date.now() + 400; (more ? target : routes.get(route)).scrollIntoView({ block: 'start' }); }
      part = more ? target.id : '';
      onRoute(route, part);
    };
    // All settings: every More options open and the power-user sections in view. Kept on this device, not a setting.
    const setAll = (on, keep = true) => {
      everything = on; if (all) all.checked = on;
      for (const d of mores) d.open = on;
      if (keep) chrome.storage.local.set({ editorAll: on }).catch(() => {});
      sync();
    };
    all?.addEventListener('change', () => setAll(all.checked));
    for (const el of tabs) {
      const activate = (tab) => { const next = first(tab); if (location.hash !== `#${next}`) location.hash = next; show(next, { focus: true, remember: true }); };
      el.addEventListener('click', () => activate(el.dataset.editorTab));
      el.addEventListener('keydown', (e) => {
        const at = tabs.indexOf(el), next = (at + 1) % tabs.length, back = (at + tabs.length - 1) % tabs.length;
        const rtl = typeof getComputedStyle === 'function' && getComputedStyle(doc.documentElement).direction === 'rtl';
        const index = { ArrowRight: rtl ? back : next, ArrowDown: next, ArrowLeft: rtl ? next : back, ArrowUp: back, Home: 0, End: tabs.length - 1 }[e.key];
        if (index === undefined) return; e.preventDefault(); activate(tabs[index].dataset.editorTab);
      });
    }
    if (jumps && typeof matchMedia === 'function') {
      const narrow = matchMedia('(max-width: 980px)');
      const layout = () => { wide = !narrow.matches; doc.querySelector('[role="tablist"]')?.setAttribute('aria-orientation', wide ? 'vertical' : 'horizontal'); place(); };
      narrow.addEventListener('change', layout); layout();
      new ResizeObserver(place).observe(jumps);
      // A section shown or hidden by a setting (Navigation items, Google Calendar sync) takes its link with it.
      const watch = new MutationObserver(sync);
      for (const s of sections) watch.observe(s, { attributes: true, attributeFilter: ['hidden'] });
      let frame = 0;
      const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; follow(); }); };
      addEventListener('scroll', soon, { passive: true }); addEventListener('resize', soon);
      // Sections crossing into or out of view (a More options opening, a panel switch) move the mark too.
      const seen = new IntersectionObserver(soon);
      for (const s of sections) seen.observe(s);
    }
    addEventListener('hashchange', () => show(location.hash, { scroll: true, remember: true }));
    show(location.hash);
    chrome.storage.local.get(['editorTab', 'editorAll']).then((r) => {
      if (r.editorAll === true) setAll(true, false);
      if (!location.hash) show(MOVED[r.editorTab] || first(r.editorTab) || first('look'));
    }).catch(() => {});
    return { keys, reset, differs, route: () => route, part: () => part, show, finding: (on) => {
      if (on && !finding) { searchScroll = { route, y: scrollY }; opened = new Map(mores.map((d) => [d, d.open])); }
      if (!on && finding) {
        for (const [d, open] of opened || []) d.open = open;
        if (searchScroll?.route === route) requestAnimationFrame(() => scrollTo({ top: searchScroll.y }));
      }
      finding = on;
      for (const panel of panels) { panel.setAttribute('role', on ? 'region' : 'tabpanel'); panel.hidden = !on && panel.dataset.editorPanel !== route.split('/')[0]; }
      sync();
    } };
  };
  return { keys, reset, differs, MOVED, INSIDE, SHOW, spy, mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_EDITOR;
