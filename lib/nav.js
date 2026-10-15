// Ultra-only first-paint schema; the worker, editor and preview use this same sanitizer.
var GZ_NAV = globalThis.GZ_NAV || (() => {
  const G = typeof GZ_SPEC === 'undefined' ? require('../defaults.js') : { GZ_SPEC, GZ_DEFAULTS };
  const SPEC = {
    width: [200, [160, 320]], icon: [24, [16, 36]], text: [14, [10, 20]], height: [44, [36, 72]], gap: [2, [0, 16]], padding: [8, [0, 24]],
    detailed: [false, 'bool'], brand: ['glaze', ['glaze', 'school', 'custom']], li: ['', 'picture'],
  };
  Object.assign(G.GZ_SPEC.nav, SPEC);
  Object.assign(G.GZ_DEFAULTS.nav, Object.fromEntries(Object.entries(SPEC).map(([k, [d]]) => [k, d])));
  const dimensions = (n) => {
    const preset = { small: [176, 20, 12, 40], medium: [200, 24, 14, 44], large: [240, 30, 17, 58] }[n.size];
    return Object.fromEntries(['width', 'icon', 'text', 'height', 'gap', 'padding'].map((k, i) => [k, !n.detailed && i < 4 ? k === 'text' && n.labels === 'small' ? 11 : preset[i] : n[k]]));
  };
  const NATIVE = ['profile', 'institution-page', 'stream', 'course', 'organization', 'calendar', 'messages', 'grades', 'tools', 'logout'];
  const WIDGETS = ['clock', 'next', 'timer', 'pet'];
  const ICONS = ['link', 'book', 'video', 'chat', 'doc', 'calendar', 'folder', 'code', 'star', 'globe'];
  const ID = /^[a-z0-9]{12}$/;
  const native = (href) => {
    if (href === '#') return 'logout';
    try { return NATIVE.find((id) => new URL(href, 'https://nav.invalid').pathname.replace(/\/$/, '') === `/ultra/${id}`) || ''; } catch { return ''; }
  };
  const link = (v) => {
    if (typeof v?.id !== 'string' || !ID.test(v.id) || NATIVE.includes(v.id) || typeof v?.n !== 'string' || typeof v.u !== 'string' || v.u.length > 512) return null;
    let u;
    try { u = new URL(v.u); } catch { return null; }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.href.length > 512) return null;
    const n = [...v.n.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 40).join('');
    return n ? { id: v.id, n, u: u.href, i: ICONS.includes(v.i) ? v.i : 'link', tab: v.tab === true } : null;
  };
  const clean = (raw) => {
    const links = [], seen = new Set();
    for (const v of Array.isArray(raw?.links) ? raw.links.slice(0, 100) : []) {
      const l = link(v);
      if (l && !seen.has(l.id)) { links.push(l); seen.add(l.id); }
      if (links.length === 8) break;
    }
    const ids = [...NATIVE, ...links.map((l) => l.id)];
    const only = (v, allowed) => [...new Set((Array.isArray(v) ? v : []).filter((id) => allowed.includes(id)))];
    const widgets = [];
    for (const w of [...(Array.isArray(raw?.widgets) ? raw.widgets.slice(0, 20) : []), ...WIDGETS.map((id) => ({ id }))]) {
      if (WIDGETS.includes(w?.id) && !widgets.some((x) => x.id === w.id)) widgets.push({ id: w.id, on: w.on === true, at: w.at === 'top' ? 'top' : 'bottom' });
    }
    return { links, order: only(raw?.order, ids), hidden: only(raw?.hidden, NATIVE), widgets };
  };
  const sequence = (ids, config) => [...new Set([...config.order, ...ids, ...config.links.map((l) => l.id)])].filter((id) => ids.includes(id) || config.links.some((l) => l.id === id));
  return { SPEC, dimensions, NATIVE, WIDGETS, ICONS, native, link, clean, sequence };
})();
if (typeof module !== 'undefined') module.exports = GZ_NAV; else GZ_NAV;
