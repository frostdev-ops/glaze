// Canvas's adapter for Glaze navigation (features/navbar.js). Native links supply names, state and badges;
// trays are Glaze panels, populated only from this Canvas's session. No page-world ENV or off-site data requests.
function GZ_NAVBAR_CANVAS(X) {
  const ROOT = '#menu, .ic-app-header__menu-list', PANELS = new Set(['profile', 'course', 'groups', 'history', 'help', 'admin']);
  const SEEN = `navbarSeen:canvas:${location.origin}`;
  const t = (s) => X.t(s), text = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  let seen = [], saved = '', notify = null, mo = null, swaps = null, watched = [], logo = null, brand = null;
  const url = (raw, external = false) => {
    if (typeof raw !== 'string' || !raw || raw.startsWith('#')) return '';
    try { const u = new URL(raw, location.href); return (/^https?:$/.test(u.protocol) || /-extension:$/.test(location.protocol) && u.protocol === location.protocol && u.host === location.host) && !u.username && !u.password && (external || u.origin === location.origin || /-extension:$/.test(location.protocol) && u.protocol === location.protocol && u.host === location.host) ? u.href : ''; } catch { return ''; }
  };
  const anchors = () => [...(document.querySelector(ROOT)?.querySelectorAll('a[id][href]') || [])];
  const idOf = (a) => GZ_NAV_LAYOUT.canvas(a.id);
  const labelOf = (a) => {
    const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement?.closest('.menu-item__badge, .screenreader-only, .sr-only') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let s = '';
    for (let n = w.nextNode(); n; n = w.nextNode()) s += ` ${n.data}`;
    return text(s) || text(a.getAttribute('aria-label'));
  };
  const courseId = (doc = document) => /\/courses\/(\d+)(?:\/|$)/.exec(doc.location?.pathname || '')?.[1] || '';
  const here = (href, id) => {
    const path = location.pathname.replace(/\/$/, '') || '/', own = new URL(href).pathname.replace(/\/$/, '') || '/';
    if (id === 'history' || id === 'help') return false;
    if (id === 'course') return /^\/courses(?:\/|$)/.test(path);
    if (id === 'profile') return /^\/(?:profile|users\/\d+)(?:\/|$)/.test(path);
    return path === own || own !== '/' && path.startsWith(`${own}/`);
  };
  const color = (id) => {
    const key = `canvas:${location.origin}/${id}`;
    return X.courseColors?.()[key]?.color || X.courseList?.()[key]?.color || '';
  };
  const watch = () => {
    if (!notify) return;
    const nodes = [document.getElementById('header'), document.getElementById('section-tabs'), document.getElementById('breadcrumbs')].filter(Boolean);
    if (nodes.length === watched.length && nodes.every((n, i) => n === watched[i])) return;
    mo.disconnect(); swaps.disconnect(); watched = nodes;
    for (const n of nodes) {
      mo.observe(n, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-current', 'href', 'src'] });
      if (n.parentElement) swaps.observe(n.parentElement, { childList: true });
    }
    // At document_start the header may not have arrived yet; stop the broad discovery as soon as it does.
    if (!nodes.length) swaps.observe(document.body || document.documentElement, { childList: true, subtree: true });
  };
  try { chrome.storage.local.get(SEEN, (r) => { if (!saved && Array.isArray(r?.[SEEN])) { seen = r[SEEN].slice(0, 20); notify?.(); } }); } catch { /* reloaded */ }
  const keep = (items) => {
    const list = items.map((i) => ({ id: i.id, label: i.label.slice(0, 80), path: new URL(i.href).pathname }));
    const json = JSON.stringify(list);
    if (!list.length || json === saved) return;
    saved = json; seen = list;
    try { chrome.storage.local.set({ [SEEN]: list }); } catch { /* reloaded */ }
  };
  // Link pagination is bounded by both pages and rows, and cannot follow a server-provided next link off this origin.
  const get = async (path, list = false) => {
    let next = url(path), out = [], pages = 0;
    const visited = new Set();
    while (next && pages++ < 5 && out.length < 200 && !visited.has(next)) {
      visited.add(next);
      const r = await fetch(next, { credentials: 'same-origin', headers: { Accept: 'application/json' }, mode: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw Error(`Canvas ${r.status}`);
      const data = JSON.parse((await r.text()).replace(/^\s*while\s*\(\s*1\s*\)\s*;\s*/, ''));
      if (!list) return data;
      if (!Array.isArray(data)) throw Error('Canvas list');
      out.push(...data);
      next = url(/<([^>]+)>\s*;\s*rel="next"/.exec(r.headers.get('Link') || '')?.[1]);
      if (next && !new URL(next).pathname.startsWith('/api/v1/')) next = '';
    }
    return out.slice(0, 200);
  };
  const row = (label, href, extra = {}, external = false) => {
    const dest = url(href, external);
    return text(label) && dest ? { label: text(label), href: dest, current: new URL(dest).pathname === location.pathname, ...extra } : null;
  };
  const data = (title, rows, foot = []) => ({ title, filter: true, sections: [{ rows: rows.filter(Boolean) }], foot });
  const helpDom = () => [...document.querySelectorAll('#help_tray a[href], #help-dialog a[href]')].map((a) => row(text(a.textContent), a.getAttribute('href'), {}, true)).filter(Boolean);
  const panel = async (id) => {
    const title = anchors().find((a) => idOf(a) === id);
    const name = title ? labelOf(title) : '';
    if (id === 'course') {
      let courses = await get('/api/v1/users/self/favorites/courses?include[]=term&per_page=100', true);
      if (!courses.length) courses = await get('/api/v1/courses?enrollment_state=active&include[]=term&per_page=100', true);
      return data(name || t('Courses'), courses.map((c) => row(c.name || c.course_code, `/courses/${c.id}`, { sub: c.term?.name || '', color: color(c.id) })), [row(t('All courses'), '/courses')]);
    }
    if (id === 'groups') return data(name || t('Groups'), (await get('/api/v1/users/self/groups?per_page=100', true)).map((g) => row(g.name, g.html_url || `/groups/${g.id}`, { sub: g.course_name || '', icon: 'people' })));
    if (id === 'profile') {
      const tabs = await get('/api/v1/users/self/tabs?per_page=100', true);
      const find = (key, label, href) => { const tab = tabs.find((x) => x.id === key); return row(tab?.label || label, tab?.html_url || href); };
      const rows = [find('profile', t('Profile'), '/profile'), find('settings', t('Settings'), '/profile/settings'), find('notifications', t('Notifications'), '/profile/communication'), find('files', t('Files'), '/files')];
      for (const tab of tabs) if (/eportfolios/i.test(tab.id || '') || /\/eportfolios(?:\/|$)/.test(tab.html_url || '')) rows.push(row(tab.label || t('ePortfolios'), tab.html_url));
      return data(name || t('Your account'), rows, [{ label: t('Sign out'), run: 'logout', icon: 'signout' }]);
    }
    if (id === 'history') return data(name || t('History'), (await get('/api/v1/users/self/history', true)).map((h) => row(h.asset_name, h.visited_url, { sub: h.context_name || '', icon: GZ_NAVBAR.courseIcon((h.asset_icon || '').replace(/^icon-/, '')) })));
    if (id === 'admin') return data(name || t('Admin'), (await get('/api/v1/accounts?per_page=100', true)).map((a) => row(a.name, `/accounts/${a.id}`, { icon: 'gear' })));
    if (id === 'help') {
      let links;
      try {
        // /help_links is the same role-filtered data Canvas's Help tray consumes. Some schools expose only the API.
        links = await get('/help_links');
        if (!Array.isArray(links)) throw Error('Canvas help');
      } catch {
        const dom = helpDom();
        if (dom.length) return data(name || t('Help'), dom);
        const h = await get('/api/v1/accounts/self/help_links');
        links = [...(h.custom_help_links || []), ...(h.default_help_links || [])].filter((l) => !l.available_to?.length || l.available_to.includes('user'));
      }
      return data(name || t('Help'), links.map((l) => row(l.text, l.url, { sub: l.subtext || '' }, true)));
    }
    return null;
  };
  return {
    read: () => {
      watch();
      const ids = new Set();
      const live = anchors().map((a) => {
        const id = idOf(a), href = url(a.getAttribute('href')) || (PANELS.has(id) ? `${location.origin}/` : '');
        if (!id || !href || ids.has(id)) return null;
        ids.add(id);
        return { id, label: labelOf(a), href, active: a.matches('.active, [aria-current="page"]') || !!a.closest('li.active, li.ic-app-header__menu-list-item--active') || here(href, id), badge: text(a.querySelector('.menu-item__badge')?.textContent), panel: PANELS.has(id) };
      }).filter(Boolean);
      if (live.length) { keep(live); return live; }
      return seen.filter((i) => GZ_NAV_LAYOUT.NATIVE.includes(i.id) && typeof i.path === 'string' && /^\/(?!\/)/.test(i.path) && url(i.path) && typeof i.label === 'string').map((i) => ({ id: i.id, label: i.label, href: url(i.path), active: here(url(i.path), i.id), badge: '', panel: PANELS.has(i.id) }));
    },
    // Panel items never dispatch Canvas's tray listeners, even if called directly through the adapter.
    go: (id) => { if (PANELS.has(id)) return false; const a = anchors().find((a) => idOf(a) === id); if (!a) return false; a.click(); return true; },
    brand: () => {
      const el = document.querySelector('#header .ic-app-header__logomark, #header .ic-app-header__logomark-container');
      if (el !== logo || !brand) {
        logo = el;
        const img = el?.querySelector('img');
        // One header mark, once per replacement: Canvas normally supplies its school logo as a CSS background.
        const bg = el && !img ? getComputedStyle(el).backgroundImage : '';
        brand = { src: img?.currentSrc || img?.src || /^url\(["']?(.*?)["']?\)$/.exec(bg)?.[1] || '', name: text(el?.getAttribute('aria-label') || img?.alt || el?.title) };
      }
      return brand;
    },
    avatar: () => { const img = document.querySelector('#global_nav_profile_link img'); return img?.currentSrc || img?.src || ''; },
    home: () => 'dashboard',
    main: () => document.getElementById('content') || document.querySelector('main'),
    inCourse: () => !!courseId() || /-extension:$/.test(location.protocol) && ['outline', 'tabs'].includes(document.documentElement.dataset.previewPage),
    menu: (doc = document) => {
      const list = doc.getElementById('section-tabs');
      if (!list) return null;
      const items = [...list.querySelectorAll('a[href]')].filter((a) => !a.hidden && !a.closest('[hidden]')).map((a) => ({ key: [...a.classList].find((c) => !['active', 'section', 'section-tab-hidden'].includes(c)) || '', label: labelOf(a), href: url(a.getAttribute('href')), active: a.classList.contains('active') || a.getAttribute('aria-current') === 'page' })).filter((a) => a.label && a.href);
      const crumb = doc.querySelector('#breadcrumbs a[href*="/courses/"]');
      const id = courseId(doc) || /\/courses\/(\d+)/.exec(crumb?.getAttribute('href') || items[0]?.href || '')?.[1];
      return items.length ? { name: text(crumb?.textContent || doc.querySelector('.course-title, #course-name')?.textContent), color: color(id), items } : null;
    },
    panel,
    run: async (what) => {
      if (what !== 'logout') return false;
      const token = /(?:^|;\s*)_csrf_token=([^;]*)/.exec(document.cookie)?.[1];
      if (!token) return false;
      try {
        const r = await fetch('/logout', { method: 'DELETE', credentials: 'same-origin', mode: 'same-origin', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ authenticity_token: decodeURIComponent(token) }) });
        if (!r.ok && r.type !== 'opaqueredirect') return false;
        location.assign('/login'); return true;
      } catch { return false; }
    },
    observe: (fn) => { notify = fn; mo = new MutationObserver(() => notify?.()); swaps = new MutationObserver(() => notify?.()); watched = []; watch(); },
    unobserve: () => { mo?.disconnect(); swaps?.disconnect(); mo = swaps = null; watched = []; notify = null; },
  };
}
// The worker checks a serializable completion value; Chrome cannot serialize a factory function.
if (typeof module !== 'undefined') module.exports = GZ_NAVBAR_CANVAS; else typeof GZ_NAVBAR_CANVAS === 'function';
