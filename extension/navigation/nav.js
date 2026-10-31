// Ultra-only first-paint schema; the worker, editor and preview use this same sanitizer.
var GZ_NAV = globalThis.GZ_NAV || (() => {
  const G = typeof GZ_SPEC === 'undefined' ? require('../content/defaults.js') : { GZ_SPEC, GZ_DEFAULTS };
  const SPEC = {
    width: [200, [160, 400]], icon: [24, [16, 36]], text: [14, [10, 20]], height: [44, [36, 72]], gap: [2, [0, 16]], padding: [8, [0, 24]],
    labelOverflow: ['ellipsis', ['ellipsis', 'wrap', 'shrink']], itemStyle: ['tile', ['tile', 'pill', 'flat']], itemBackground: [false, 'bool'], activeIndicator: ['bar', ['bar', 'outline', 'background', 'none']],
    logoSize: [48, [24, 96]], logoAlign: ['center', ['start', 'center', 'end']], footer: [true, 'bool'],
    expandOnHover: [true, 'bool'], detailed: [false, 'bool'], brand: ['glaze', ['glaze', 'school', 'custom']], li: ['', 'picture'],
  };
  Object.assign(G.GZ_SPEC.nav, SPEC);
  Object.assign(G.GZ_DEFAULTS.nav, Object.fromEntries(Object.entries(SPEC).map(([k, [d]]) => [k, d])));
  const dimensions = (n) => {
    const preset = { small: [176, 20, 12, 40], medium: [200, 24, 14, 44], large: [240, 30, 17, 48] }[n.size];
    return Object.fromEntries(['width', 'icon', 'text', 'height', 'gap', 'padding'].map((k, i) => [k, !n.detailed && i < 4 ? k === 'text' && n.labels === 'small' ? 11 : preset[i] : n[k]]));
  };
  // glaze: Glaze settings, an item content-ultra.js adds last (href #glaze); hidden and moved like Ultra's own.
  const NATIVE = ['profile', 'institution-page', 'stream', 'course', 'organization', 'calendar', 'messages', 'grades', 'tools', 'logout', 'glaze'];
  const native = (href) => {
    if (href === '#') return 'logout';
    if (href === '#glaze') return 'glaze';
    try { return NATIVE.find((id) => new URL(href, 'https://nav.invalid').pathname.replace(/\/$/, '') === `/ultra/${id}`) || ''; } catch { return ''; }
  };
  // Glaze's bar at first paint, as this tab last drew it (navigation/page/navbar.js keep), until the bar takes it over:
  // not after a sign-in (a page off Ultra led here), ten minutes on, for other settings or window size, or another account.
  const key = (s) => JSON.stringify([s.navbar, s.enhance?.tabs, s.enhance?.dashboard, s.nav?.li]);
  const kept = (raw, at) => {
    const s = JSON.parse(raw), from = at.from && new URL(at.from);
    return s && typeof s.u === 'string' && s.u && s.w === at.words && s.k === at.key && s.v === at.size && Number.isFinite(s.t) && s.t <= at.now && at.now - s.t < 6e5 && (!from || from.origin === at.origin && /^\/ultra(?:\/|$)/.test(from.pathname)) && typeof s.m === 'string' && Array.isArray(s.p) && s.p.every((x) => typeof x === 'string') && Array.isArray(s.a) && s.a.every((p) => Array.isArray(p) && p.length === 2 && /^(dir|data-(place|style|footer|motion))$/.test(p[0]) && typeof p[1] === 'string') ? s : null;
  };
  // The bar's elements only, no handlers or other addresses; where the student is, marked.
  const paint = (box, path) => {
    for (const e of box.querySelectorAll('*')) {
      if (!/^(nav|div|span|a|button|b|small|img|svg|path|defs|linearGradient|stop|rect|ellipse)$/.test(e.localName)) { e.remove(); continue; }
      for (const k of e.getAttributeNames()) if (/^on|^(srcset|formaction)$|:/i.test(k) || /^(src|href|action)$/i.test(k) && !/^https:/i.test(e.getAttribute(k))) e.removeAttribute(k);
      const c = e.classList.contains('ctab-go') && e.dataset.cid, id = !e.classList.contains('brand') && e.dataset.id, p = id && e.pathname;
      if (!c && !id) continue;
      const on = c ? path.startsWith(`/ultra/courses/${c}/`) : !!p && (path == p || path.startsWith(p + '/') || id == 'course' && path.startsWith('/ultra/courses/'));
      if (on) e.setAttribute('aria-current', 'page'); else e.removeAttribute('aria-current');
      e.part.toggle('active', on);
    }
  };
  const drop = () => document.querySelector('#gz-navbar[data-first]')?.remove();
  let asked;
  const first = (s, words, account) => {
    if (!words) return drop();
    if (asked) return;
    asked = 1;
    let k;
    try { k = kept(sessionStorage.getItem('gz-navbar'), { words, key: key(s), size: innerWidth + 'x' + innerHeight, now: Date.now(), from: document.referrer, origin: location.origin }); sessionStorage.removeItem('gz-navbar'); } catch { /* none */ }
    if (!k || document.getElementById('gz-navbar')) return;
    const host = Object.assign(document.createElement('div'), { id: 'gz-navbar', hidden: true, inert: true }), root = host.attachShadow({ mode: 'open' });
    const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: chrome.runtime.getURL('navigation/page/navbar.css') });
    for (const [n, v] of k.a) host.setAttribute(n, v);
    host.dataset.first = '';
    const path = location.pathname.replace(/\/$/, ''), parse = (m) => { const t = document.createElement('template'); t.innerHTML = m; paint(t.content, path); return t.content; };
    // Its markers on the current item, as the bar's layout() puts them.
    const glide = () => {
      for (const i of root.querySelectorAll('.ind, .tind')) {
        const c = i.parentNode.querySelector('.item[aria-current="page"]:not([data-over]), .ctab-go[aria-current="page"]'), y = i.matches('.ind');
        i.hidden = !c;
        if (c) for (const [v, n] of y ? [['--y', c.offsetTop]] : [['--x', c.offsetLeft], ['--w', c.offsetWidth]]) i.style.setProperty(v, n + 'px');
      }
    };
    // Shown with its sheet; the account's own parts (kept apart, their room held) once the account is the one they were drawn
    // for, and the copy gone for any other.
    const live = () => host.isConnected && host.hasAttribute('data-first');
    l.onload = () => { if (live()) { host.hidden = false; glide(); } };
    root.append(l, parse(k.m));
    (document.body || document.documentElement).prepend(host);
    const gone = () => live() && host.remove();
    Promise.resolve().then(() => account?.()).then((id) => {
      if (!live()) return;
      if (!id || String(id) !== k.u) return gone();
      for (const e of root.querySelectorAll('[data-p]')) e.replaceWith(parse(k.p[e.dataset.p] || ''));
      if (!host.hidden) glide();
    }, gone);
  };
  return { SPEC, dimensions, NATIVE, native, key, kept, paint, first, drop };
})();
if (typeof module !== 'undefined') module.exports = GZ_NAV; else GZ_NAV;
