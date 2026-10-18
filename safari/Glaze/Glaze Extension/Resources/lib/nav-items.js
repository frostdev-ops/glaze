// Item validation and editing stay on demand; worker, editor and live rail share this exact sanitizer.
var GZ_NAV_ITEMS = globalThis.GZ_NAV_ITEMS || (() => {
  const N = typeof GZ_NAV === 'undefined' ? require('./nav.js') : GZ_NAV;
  const { NATIVE } = N;
  const WIDGETS = ['clock', 'next', 'timer', 'pet'];
  const ICONS = ['link', 'book', 'video', 'chat', 'doc', 'calendar', 'folder', 'code', 'star', 'globe'];
  const ID = /^[a-z0-9]{12}$/;
  const link = (v) => {
    if (typeof v?.id !== 'string' || !ID.test(v.id) || NATIVE.includes(v.id) || typeof v?.n !== 'string' || typeof v.u !== 'string' || v.u.length > 512) return null;
    let u;
    try { u = new URL(v.u); } catch { return null; }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.href.length > 512) return null;
    const n = [...v.n.replace(/[\p{Cc}\p{Bidi_Control}]/gu, '').replace(/\s+/g, ' ').trim()].slice(0, 40).join('');
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
  Object.assign(N, { WIDGETS, ICONS, link, clean, sequence });
  return N;
})();
if (typeof module !== 'undefined') module.exports = GZ_NAV_ITEMS; else GZ_NAV_ITEMS;
