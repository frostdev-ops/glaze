// Runs only in the storage broker's existing queue. Custom logos use their own namespace so older card cleanup is safe.
var GZ_NAV_STORE = globalThis.GZ_NAV_STORE || (() => {
  const K = typeof GZ_CARDS === 'undefined' ? require('./cards.js') : GZ_CARDS;
  const N = typeof GZ_NAV === 'undefined' ? require('./nav.js') : GZ_NAV;
  const sanitize = (raw) => (typeof GZ_SANITIZE === 'undefined' ? require('../defaults.js').GZ_SANITIZE : GZ_SANITIZE)({ nav: raw }).nav;
  const change = async (op, area) => {
    if (op.items) {
      const items = N.clean(op.items);
      if (K.bytes('navItems', items) > K.ITEM_MAX) return { ok: false, error: 'sync' };
      return await area.sync.set({ navItems: items }) ? { ok: true, items } : { ok: false, error: 'write' };
    }
    let id, r;
    if (op.logoImage) {
      const all = await area.local.get(null);
      const sizes = Object.fromEntries(Object.entries(all).filter(([k]) => /^(?:cardImg|ultraCardImg|navLogo):/.test(k)).map(([k, v]) => [k, String(v).length]));
      if (typeof op.logoImage !== 'string' || !K.DATA.test(op.logoImage) || !K.room(op.logoImage.length, sizes)) return { ok: false, error: 'cap' };
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
      const nav = sanitize({ ...(await area.sync.get(['nav'])).nav, ...op.nav, brand: 'custom', li: id });
      if (!await area.local.set({ [`navLogo:${id}`]: op.logoImage })) return { ok: false, error: 'write' };
      if (!await area.sync.set({ nav })) { await area.local.remove([`navLogo:${id}`]); return { ok: false, error: 'write' }; }
      r = { ok: true, nav, id };
    } else r = await K.change(op, area);
    if (!r.ok) return r;
    const nav = (await area.sync.get(['nav'])).nav;
    const gone = Object.keys(await area.local.get(null)).filter((k) => /^navLogo:/.test(k) && k !== `navLogo:${nav?.li}`);
    if (gone.length && !await area.local.remove(gone)) return { ...r, cleanup: false };
    return r;
  };
  const timer = async (op, area, now = Date.now()) => {
    if (!['toggle', 'reset', 'advance'].includes(op)) return { ok: false, error: 'bad' };
    const W = typeof GZ_WIDGETS === 'undefined' ? require('./widgets.js') : GZ_WIDGETS;
    const raw = await area.sync.get(['widgets']);
    const o = (typeof GZ_SANITIZE === 'undefined' ? require('../defaults.js').GZ_SANITIZE : GZ_SANITIZE)(raw).widgets;
    const before = W.cleanTimer((await area.local.get(['widgetTimer'])).widgetTimer);
    let timer = W.advance(before, now, o);
    if (op === 'reset') timer = W.IDLE;
    if (op === 'toggle') timer = timer.end ? W.pause(timer, now) : W.start(timer, now, o);
    if (JSON.stringify(timer) !== JSON.stringify(before) && !await area.local.set({ widgetTimer: timer })) return { ok: false, error: 'write' };
    return { ok: true, timer };
  };
  return { change, timer };
})();
if (typeof module !== 'undefined') module.exports = GZ_NAV_STORE; else GZ_NAV_STORE;
