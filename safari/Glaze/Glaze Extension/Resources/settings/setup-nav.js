// The setup wizard's Navigation step (settings/welcome.html #nav), mounted by settings/setup.js (GZ_SETUP_PARTS): Glaze's own bar
// on or off, at the side or the top, its rail's labels, its style, and Glaze's own items in it (navigation/navbar.js GLAZE),
// beside a small page wearing the bar as chosen. The bar's fields save through 'glaze:navbar', one at a time; its items through
// 'glaze:navbarItems', which changes only Glaze's own. Classic script; module.exports for node.
var GZ_SETUP_NAV = globalThis.GZ_SETUP_NAV || (() => {
  const M = typeof GZ_NAVBAR !== 'undefined' ? GZ_NAVBAR : require('../navigation/navbar.js');
  // Each choice as [value, label] (defaults.js navbar): rail's auto opens the labels on a wide window (navbar.js railOpen).
  const PLACES = [['rail', 'Side rail'], ['top', 'Top bar']];
  const RAILS = [['auto', 'Auto'], ['open', 'Labels'], ['icons', 'Icons']];
  const STYLES = [['float', 'Floating'], ['embed', 'Embedded']];
  // Glaze's own items, by their names in the bar (navigation/navbar.js build).
  const NAMES = { notes: 'Notes', documents: 'Documents', todo: 'To Do', search: 'Search', settings: 'Glaze settings' };
  // The site's own items the preview's bar holds, by the bar's icons.
  const NATIVE = ['home', 'book', 'calendar', 'inbox', 'grades'];
  // Glaze's items in the bar, as the bar reads them from sync (a fresh install's settings item included).
  const items = (raw, fresh) => M.initial(raw?.navbarItems, raw?.navItems, fresh).glaze;
  // The items with one turned on or off, in the bar's own order.
  const flip = (list, id) => M.GLAZE.filter((g) => (g === id) !== list.includes(g));
  const iconOf = (g) => (g === 'settings' ? 'glaze' : g);
  // The done step's word for the bar.
  const summary = (n) => (!n.on ? 'Off' : n.place === 'top' ? 'Top bar' : 'Side rail');
  return { PLACES, RAILS, STYLES, NAMES, NATIVE, GLAZE: M.GLAZE, ICONS: M.ICONS, items, flip, iconOf, summary };
})();

if (typeof document !== 'undefined' && globalThis.chrome?.runtime?.id) (globalThis.GZ_SETUP_PARTS ||= []).push({
  step: 'nav',
  mount: (api) => {
    const N = GZ_SETUP_NAV, { t, make, tick } = api;
    const NS = 'http://www.w3.org/2000/svg';
    const icon = (name) => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', N.ICONS[name] || N.ICONS.link);
      svg.append(p);
      return svg;
    };
    const radio = (el, value) => { el.setAttribute('role', 'radio'); el.dataset.value = value; return el; };
    const nav = () => api.settings().navbar;
    const glaze = () => api.settings().navbarItems?.glaze || N.items(api.raw(), api.fresh());

    // ---- the choices ----
    const power = make('button', { type: 'button', className: 'switch nv-power' }, make('span', { className: 'label', textContent: t('Use Glaze navigation') }), make('span', { className: 'knob' }));
    power.setAttribute('role', 'switch');
    power.dataset.key = 'navbar.on';
    const mock = (place) => {
      const m = make('span', { className: `nv-mock nv-mock-${place}` }, make('i', { className: 'nv-mpg' }, make('b'), make('b'), make('b')),
        make('i', { className: 'nv-mbar' }, make('b'), make('b'), make('b'), make('b'), make('s')));
      m.setAttribute('aria-hidden', 'true');
      return m;
    };
    const places = make('div', { className: 'nv-places' });
    places.setAttribute('role', 'radiogroup');
    places.setAttribute('aria-label', t('Placement'));
    const placeCards = N.PLACES.map(([v, label]) => radio(make('button', { type: 'button', className: 'nv-place' }, mock(v), make('span', { className: 'name', textContent: t(label) }), tick()), v));
    places.append(...placeCards);
    const seg = (key, table, label) => {
      const box = make('div', { className: 'nv-seg' });
      box.setAttribute('role', 'radiogroup');
      box.setAttribute('aria-label', t(label));
      box.dataset.key = key;
      box.style.setProperty('--n', String(table.length));
      const opts = table.map(([v, name]) => radio(make('button', { type: 'button', className: 'nv-opt', textContent: t(name) }), v));
      box.append(make('span', { className: 'thumb' }), ...opts);
      return { box, opts, table };
    };
    const rail = seg('rail', N.RAILS, 'Rail'), style = seg('style', N.STYLES, 'Style');
    const fold = make('div', { className: 'nv-fold' }, make('div', {}, rail.box));
    const chips = make('div', { className: 'nv-chips' });
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', t('Shortcuts'));
    const chipEls = N.GLAZE.map((g) => {
      const b = make('button', { type: 'button', className: 'nv-chip' }, icon(N.iconOf(g)), make('span', { textContent: t(N.NAMES[g]) }));
      b.dataset.id = g;
      return b;
    });
    chips.append(...chipEls);
    const choices = make('div', { className: 'nv-choices' }, places, fold, style.box, chips);
    const controls = make('div', { className: 'nv-controls' }, power, choices);

    // ---- the preview: a page wearing the bar ----
    const bars = (n) => Array.from({ length: n }, () => make('b'));
    const item = (name, cls = '') => make('span', { className: `nv-item ${cls}` }, icon(name), make('b', { className: 'nv-label' }));
    const natives = N.NATIVE.map((name, i) => item(name, i === 0 ? 'on' : ''));
    const own = Object.fromEntries(N.GLAZE.map((g) => { const e = item(N.iconOf(g), 'nv-own'); e.dataset.id = g; return [g, e]; }));
    const divider = make('i', { className: 'nv-div' });
    const bar = make('div', { className: 'nv-bar' },
      make('span', { className: 'nv-brand' }, make('i', { className: 'logo' }), make('b', { className: 'nv-label' })),
      make('span', { className: 'nv-items' }, ...natives, divider, ...Object.values(own)),
      make('span', { className: 'nv-foot' }, make('span', { className: 'nv-item nv-me' }, make('i', { className: 'face' }), make('b', { className: 'nv-label' }))));
    const page = make('div', { className: 'nv-page' }, make('b', { className: 'title' }),
      make('span', { className: 'cards' }, ...[0, 1, 2].map(() => make('i', { className: 'card' }, ...bars(3)))), make('i', { className: 'wide' }, ...bars(2)));
    const site = make('div', { className: 'nv-site' }, make('i'), ...bars(4));
    const stage = make('div', { className: 'nv-stage' }, site, page, bar);
    const win = make('div', { className: 'nv-win' }, make('i', { className: 'nv-chrome' }, make('b'), make('b'), make('b'), make('s')), stage);
    const preview = make('div', { className: 'nv-preview' }, win);
    preview.setAttribute('aria-hidden', 'true');
    api.$('#nav-body').append(make('div', { className: 'nv' }, controls, preview));

    // ---- the preview moves between states: each item slides from where it was in the bar, new ones grow in ----
    const still = () => api.shown() === 'off';
    const spring = 'cubic-bezier(0.34, 1.3, 0.64, 1)', ease = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
    const morph = (apply) => {
      if (still()) { apply(); return; }
      const els = [...bar.querySelectorAll('.nv-item, .nv-brand, .nv-div')];
      const before = new Map(els.map((e) => [e, e.hidden ? null : { x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight }]));
      apply();
      const x = api.shown() === 'expressive';
      let born = 0;
      for (const e of els) {
        const was = before.get(e);
        if (e.hidden) {
          if (!was) continue;
          // Gone: a copy of it shrinks away where it stood.
          const ghost = e.cloneNode(true);
          ghost.hidden = false;
          ghost.classList.add('nv-ghost');
          Object.assign(ghost.style, { left: `${was.x}px`, top: `${was.y}px`, width: `${was.w}px`, height: `${was.h}px` });
          bar.append(ghost);
          ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.4)' }], { duration: 220, easing: ease }).finished.then(() => ghost.remove(), () => ghost.remove());
          continue;
        }
        if (!was) {
          e.animate([{ opacity: 0, transform: 'scale(0.3)' }, { opacity: 1, transform: 'none' }], { duration: x ? 520 : 360, delay: 60 + born++ * 40, easing: x ? spring : ease, fill: 'backwards' });
          continue;
        }
        const dx = was.x - e.offsetLeft, dy = was.y - e.offsetTop;
        if (dx || dy) e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: x ? 620 : 440, easing: x ? spring : ease });
      }
    };

    // ---- saving: each choice the moment it's made ----
    const put = (key, value) => {
      if (nav()[key] === value) return;
      api.save(`navbar.${key}`, value, { type: 'glaze:navbar', patch: { [key]: value } });
      render();
    };
    power.addEventListener('click', () => put('on', !nav().on));
    const pickPlace = (v) => { put('place', v); api.said.textContent = t(N.PLACES.find(([k]) => k === v)[1]); };
    placeCards.forEach((b) => b.addEventListener('click', () => pickPlace(b.dataset.value)));
    api.arrows(places, placeCards, (j) => pickPlace(placeCards[j].dataset.value));
    for (const [key, s] of [['rail', rail], ['style', style]]) {
      const pick = (v) => { put(key, v); api.said.textContent = t(s.table.find(([k]) => k === v)[1]); };
      s.opts.forEach((b) => b.addEventListener('click', () => pick(b.dataset.value)));
      api.arrows(s.box, s.opts, (j) => pick(s.opts[j].dataset.value));
    }
    chipEls.forEach((b) => b.addEventListener('click', () => {
      const list = N.flip(glaze(), b.dataset.id);
      api.save('navbarItems.glaze', list, { type: 'glaze:navbarItems', glaze: list });
      render();
    }));

    // ---- drawing what is chosen ----
    const wide = matchMedia('(min-width: 1280px)');
    wide.addEventListener('change', () => { preview.dataset.wide = String(wide.matches); });
    preview.dataset.wide = String(wide.matches);
    const check = (els, value) => els.forEach((b) => {
      const yes = b.dataset.value === value;
      b.setAttribute('aria-checked', String(yes));
      b.tabIndex = yes ? 0 : -1;
    });
    let drawn = '';
    function render() {
      const n = nav(), list = glaze();
      power.setAttribute('aria-checked', String(n.on));
      choices.inert = !n.on;
      choices.dataset.off = String(!n.on);
      check(placeCards, n.place);
      check(rail.opts, n.rail);
      check(style.opts, n.style);
      rail.box.style.setProperty('--at', String(Math.max(0, N.RAILS.findIndex(([v]) => v === n.rail))));
      style.box.style.setProperty('--at', String(Math.max(0, N.STYLES.findIndex(([v]) => v === n.style))));
      fold.dataset.shut = String(n.place !== 'rail');
      chipEls.forEach((b) => b.setAttribute('aria-pressed', String(list.includes(b.dataset.id))));
      const state = JSON.stringify([n.on, n.place, n.rail, n.style, list]);
      if (state === drawn) return;
      const first = !drawn;
      drawn = state;
      const apply = () => {
        Object.assign(preview.dataset, { on: String(n.on), place: n.place, rail: n.rail, style: n.style });
        for (const g of N.GLAZE) own[g].hidden = !list.includes(g);
        divider.hidden = !list.length;
      };
      if (first) apply(); else morph(apply);
    }
    render();
    return {
      render,
      summary: () => [[t('Navigation'), t(N.summary(nav()))]],
    };
  },
});

if (typeof module !== 'undefined') module.exports = GZ_SETUP_NAV;
