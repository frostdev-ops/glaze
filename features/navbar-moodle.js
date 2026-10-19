// Moodle's adapter for features/navbar.js (the site adapter contract). Native navigation stays intact for turning off.
// Only same-origin Moodle links and AJAX services are used; session keys and panel contents are never cached to disk.
function GZ_NAVBAR_MOODLE(X) {
  const D = GZ_NAVBAR_MOODLE.data, t = X.t;
  const nav = () => document.querySelector('nav.navbar');
  const user = () => document.querySelector('.usermenu');
  const logout = () => user()?.querySelector('a[href*="/login/logout.php"]') || document.querySelector('a[href*="/login/logout.php"]');
  const session = () => D.session(logout()?.href, location.origin);
  const root = () => session()?.root || document.querySelector('.navbar-brand')?.href.replace(/\/my\/(?:index\.php)?(?:\?.*)?$/, '').replace(/\/$/, '') || location.origin;
  const href = (s) => root() + s;
  const safe = (s) => D.here(s, location.href);
  const links = () => [...document.querySelectorAll('.primary-navigation a[href], #theme_boost-drawers-primary a[href], .usermenu a[href]')];
  const label = (a) => (a.querySelector('.mds-nav-pill__label')?.textContent || a.textContent || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  const props = (box) => {
    try { const items = JSON.parse(box?.querySelector('[data-react-props]')?.getAttribute('data-react-props') || '{}').items; return Array.isArray(items) ? items.filter((i) => i && typeof i === 'object') : []; } catch { return []; }
  };
  const entries = (box) => {
    const data = props(box);
    const keys = new Map(data.map((i) => [i.href, i.key]));
    const items = [...(box?.querySelectorAll('a[href]:not([data-bs-toggle], [data-toggle], .dropdown-toggle)') || [])].map((a) => ({ key: a.dataset.key || a.closest('[data-key]')?.dataset.key || keys.get(a.href) || '', label: label(a), href: safe(a.getAttribute('href')), active: a.matches('.active, .mds-nav-pill--selected, [aria-current="page"]') || !!a.closest('li.active') }));
    // Recent Moodle measures away overflow links before its menu opens. Their server data still describes the course.
    for (const i of data) if (i.href && !items.some((a) => a.href === safe(i.href))) items.push({ key: i.key, label: String(i.text || ''), href: safe(i.href), active: !!i.active });
    return items.filter((i) => i.href && i.label);
  };
  const inCourse = (doc = document) => /\bcourse-(?!1\b)\d+\b/.test(doc.body?.className || '') || /\/course\/(view|section)\.php$/.test(doc.location?.pathname || location.pathname);
  const current = (url, id) => {
    if (id === 'course' && inCourse() || GZ_NAV_LAYOUT.moodle(location.href) === id) return true;
    try { const a = new URL(url), b = new URL(location.href); return a.pathname.replace(/\/index\.php$/, '/') === b.pathname.replace(/\/index\.php$/, '/') && (!a.search || a.search === b.search); } catch { return false; }
  };
  const badge = (box) => {
    const b = box?.querySelector('.count-container:not(.hidden):not(.d-none):not([hidden])');
    return D.count(b?.querySelector('[aria-hidden="true"]')?.textContent || b?.textContent);
  };
  const name = () => user()?.querySelector('.userinitials')?.title || user()?.querySelector('img')?.alt || user()?.querySelector('.usertext, .userfirstname')?.textContent.trim() || t('Profile');
  const userId = () => document.querySelector('.popover-region-notifications[data-userid]')?.dataset.userid || document.querySelector('[data-region="view-overview"][data-user-id]')?.dataset.userId || '';
  const cacheKey = () => `navbarSeen:${root()}:${userId() || name()}`;
  let seen = [], saved = '', notify = null, mo = null, key = '';
  const restore = () => {
    const next = cacheKey();
    if (next === key || !session()) return;
    key = next; seen = []; saved = '';
    try { chrome.storage.local.get(key, (r) => { if (key === next) { seen = Array.isArray(r?.[next]) ? r[next].slice(0, 20) : []; notify?.(); } }); } catch { /* reloaded */ }
  };
  const keep = (items) => {
    const list = items.filter((i) => i.id !== 'logout').map(({ id, label, href }) => ({ id, label: label.slice(0, 80), path: new URL(href).pathname + (id === 'home' && new URL(href).searchParams.get('redirect') === '0' ? '?redirect=0' : '') }));
    const json = JSON.stringify(list);
    if (!key || !list.length || json === saved) return;
    saved = json;
    try { chrome.storage.local.set({ [key]: list }); } catch { /* reloaded */ }
  };
  const read = () => {
    restore();
    const items = [], ids = new Set();
    const add = (id, label, url, extra = {}) => { if (!id || !safe(url)) return; if (ids.has(id)) { if (extra.panel) Object.assign(items.find((i) => i.id === id), { label, ...extra }); return; } ids.add(id); items.push({ id, label, href: safe(url), active: current(url, id), badge: '', ...extra }); };
    for (const i of entries(document.querySelector('.primary-navigation'))) add(GZ_NAV_LAYOUT.moodle(i.href), i.label, i.href, { active: i.active || current(i.href, GZ_NAV_LAYOUT.moodle(i.href)) });
    for (const a of links()) if (safe(a.getAttribute('href'))) add(GZ_NAV_LAYOUT.moodle(a.href), label(a), a.href);
    if (!items.length) for (const i of seen) if (i && GZ_NAV_LAYOUT.NATIVE.includes(i.id) && typeof i.label === 'string' && typeof i.path === 'string' && i.path.startsWith('/') && !i.path.startsWith('//')) add(i.id, i.label, location.origin + i.path);
    const profile = user()?.querySelector('a[href*="/user/profile.php"]');
    if (user()) add('profile', name(), profile?.href || href('/user/profile.php'), { panel: true });
    const notifications = document.querySelector('.popover-region-notifications');
    if (notifications) add('notifications', t('Notifications'), href('/message/output/popup/notifications.php'), { panel: true, badge: badge(notifications) });
    const messages = document.querySelector('[data-region="popover-region-messages"], [id^="message-drawer-toggle"]');
    if (messages) add('messages', t('Messages'), href('/message/index.php'), { panel: true, badge: badge(messages) });
    if (logout()) add('logout', label(logout()) || t('Sign out'), logout().href);
    for (const i of items) if (['profile', 'messages', 'notifications'].includes(i.id)) i.panel = true;
    if (nav()) keep(items);
    return items;
  };
  const service = async (methodname, args) => {
    const s = session();
    if (!s) throw new Error('session unavailable');
    const r = await fetch(`${s.root}/lib/ajax/service.php?sesskey=${encodeURIComponent(s.sesskey)}&info=${methodname}`, { method: 'POST', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ index: 0, methodname, args }]) });
    if (!r.ok) throw new Error('service unavailable');
    const answer = (await r.json())?.[0];
    if (!answer || answer.error || !answer.data) throw new Error('service unavailable');
    return answer.data;
  };
  const panel = async (id) => {
    if (id === 'profile') {
      const rows = [...(user()?.querySelectorAll('a[href]') || [])].map((a) => ({ label: label(a), href: safe(a.getAttribute('href')), icon: /logout\.php/.test(a.href) ? 'signout' : 'account' })).filter((r) => r.label && r.href);
      return rows.length ? { title: name(), sections: [{ rows: rows.filter((r) => r.icon !== 'signout') }], foot: rows.filter((r) => r.icon === 'signout') } : null;
    }
    if (id === 'notifications') return { title: t('Notifications'), filter: true, sections: [{ rows: D.notifications(await service('message_popup_get_popup_notifications', { useridto: 0, newestfirst: true, limit: 30, offset: 0 }), root(), t) }], foot: [{ label: t('All notifications'), href: href('/message/output/popup/notifications.php'), icon: 'bell' }], empty: t('No notifications') };
    if (id === 'messages') {
      const uid = userId() || new URL(safe(user()?.querySelector('a[href*="/user/profile.php?id="]')?.href) || href('/')).searchParams.get('id');
      if (!/^\d+$/.test(uid || '')) throw new Error('user unavailable');
      return { title: t('Messages'), filter: true, sections: [{ rows: D.conversations(await service('core_message_get_conversations', { userid: +uid, limitfrom: 0, limitnum: 30 }), root()) }], foot: [{ label: t('All messages'), href: href('/message/index.php'), icon: 'inbox' }], empty: t('No conversations') };
    }
    return null;
  };
  return {
    read, panel, inCourse,
    go: (id) => { const item = read().find((i) => i.id === id); if (!item) return false; const a = links().find((a) => a.href === item.href) || (id === 'logout' && logout()); if (a) a.click(); else location.assign(item.href); return true; },
    brand: () => { const a = document.querySelector('.navbar-brand'), img = a?.querySelector('img'); return { src: img?.currentSrc || img?.src || '', name: (img?.alt || a?.textContent || document.title).trim().slice(0, 80) }; },
    avatar: () => { const img = user()?.querySelector('img'); return img?.currentSrc || img?.src || ''; },
    home: () => GZ_NAV_LAYOUT.moodle(document.querySelector('.navbar-brand')?.href) === 'home' ? 'home' : 'dashboard',
    main: () => document.querySelector('#region-main [role="main"], #region-main, main'),
    menu: (doc) => {
      if (!inCourse(doc)) return null;
      const items = entries(doc.querySelector('.secondary-navigation'));
      const key = X.canvasCourseKey?.(), color = X.courseList?.()[key]?.color || '';
      return items.length ? { name: (doc.querySelector('#page-header h1, .page-header-headings h1')?.textContent || '').trim(), color, items } : null;
    },
    observe: (fn) => { notify = fn; mo?.disconnect(); mo = new MutationObserver(fn); for (const box of [nav(), document.querySelector('.secondary-navigation')]) if (box) mo.observe(box, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'href', 'src', 'aria-current', 'data-react-props'] }); },
    unobserve: () => { mo?.disconnect(); mo = null; notify = null; },
  };
}
// Response shaping is pure. Every row is text, never HTML; a response cannot send a link off this Moodle.
GZ_NAVBAR_MOODLE.data = {
  here: (href, base) => { try { const u = new URL(href, base), b = new URL(base); return typeof href === 'string' && href.trim() && !href.trim().startsWith('#') && (['http:', 'https:'].includes(u.protocol) || /-extension:$/.test(b.protocol) && u.protocol === b.protocol) && u.origin === b.origin && !u.username && !u.password ? u.href : ''; } catch { return ''; } },
  session: (href, origin) => { try { const u = new URL(href); return u.origin === origin && /\/login\/logout\.php$/.test(u.pathname) && u.searchParams.get('sesskey') ? { root: origin + u.pathname.replace(/\/login\/logout\.php$/, ''), sesskey: u.searchParams.get('sesskey') } : null; } catch { return null; } },
  text: (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]{1,6}|\d{1,7});/gi, (_, n) => { const c = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : +n; return c <= 0x10ffff ? String.fromCodePoint(c) : ''; }).replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (s) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }[s])).replace(/\s+/g, ' ').trim().slice(0, 240),
  count: (s) => { const n = /^\s*(\d+)(\+)?/.exec(s || ''); return n && +n[1] ? (+n[1] > 99 ? '99+' : n[1] + (n[2] || '')) : ''; },
  notifications: (data, root, t) => {
    if (!Array.isArray(data?.notifications)) throw new Error('invalid notifications');
    const D = GZ_NAVBAR_MOODLE.data;
    return data.notifications.filter((n) => !n.deleted).slice(0, 30).map((n) => ({ label: D.text(n.subject || n.smallmessage), sub: [n.read ? '' : t('Unread'), D.text(n.contexturlname || n.smallmessage)].filter(Boolean).join(' · '), href: D.here(n.contexturl, root + '/') || `${root}/message/output/popup/notifications.php`, icon: 'bell', badge: n.read ? '' : '•' })).filter((r) => r.label);
  },
  conversations: (data, root) => {
    if (!Array.isArray(data?.conversations)) throw new Error('invalid conversations');
    const D = GZ_NAVBAR_MOODLE.data;
    return data.conversations.filter((c) => /^\d+$/.test(String(c.id))).slice(0, 30).map((c) => ({ label: D.text(c.name || c.members?.map((m) => m.fullname).join(', ')), sub: D.text(c.messages?.[0]?.text), href: `${root}/message/index.php?convid=${c.id}`, icon: 'inbox', badge: D.count(String(c.unreadcount || '')) })).filter((r) => r.label);
  },
};
if (typeof module !== 'undefined') module.exports = GZ_NAVBAR_MOODLE; else ({ ready: true });
