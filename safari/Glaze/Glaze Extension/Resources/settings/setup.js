// Glaze's first screen as a setup wizard (settings/welcome.html): the student picks a theme, how much motion, and which
// features to keep, then names their school (settings/welcome.js). Each step is the address's hash (#/theme,
// #/features/notes: no element's id, which Chrome would scroll to and take focus from), so the browser's back and forward
// walk them too. Every choice is saved the moment it is made, as Settings saves it: a Look
// through the worker ('glaze:look': a built-in Look with its own parts, or Glaze's own theme with none), the navigation's
// switch through 'glaze:navbar', motion, the pointer's animation and the features straight to storage.sync. The page wears
// what is picked: the Look's palette, its scene (looks/scene.js) or ground, its pointers and effects (looks/page/motionx.js),
// and the motion level; the opening splash wears the Frostdev Look. Classic script; module.exports for node.
var GZ_SETUP = globalThis.GZ_SETUP || (() => {
  const D = typeof GZ_DEFAULTS !== 'undefined' ? { GZ_DEFAULTS, GZ_LOOKS, GZ_LOOK_APPLY, GZ_LOOK_ON } : require('../content/defaults.js');
  const STEPS = ['start', 'theme', 'motion', 'features', 'school', 'done'];
  // One slide each: its words, its picture (welcome.html [data-art]), and its switches as [setting, label, needs].
  const FEATURES = [
    { id: 'navigation', title: 'Navigation', says: 'Glaze’s own rail or top bar in place of the site’s menus.', keys: [['navbar.on', 'Use Glaze navigation']] },
    { id: 'sidebar', title: 'Sidebar', says: 'The page’s sidebar, with your widgets docked under it.', keys: [['enhance.sidebar', 'Use the sidebar'], ['enhance.widgets', 'Widgets']] },
    { id: 'todo', title: 'To Do', says: 'Everything due, grouped by day, with tasks of your own.', keys: [['enhance.todo', 'Better To Do'], ['enhance.dashboard', 'Glaze Dashboard']] },
    { id: 'notes', title: 'Notes', says: 'Notes with folders and checklists, kept on this device.', keys: [['enhance.notes', 'Notes']] },
    { id: 'writer', title: 'Writer', says: 'A calmer editor in Blackboard’s discussion, message and assignment boxes.', keys: [['enhance.writer', 'Glaze Writer']] },
    { id: 'search', title: 'Search', says: '{keys} jumps to a course, a page or a setting.', keys: [['enhance.palette', 'Command palette'], ['enhance.search', 'Search in your courses', 'enhance.palette'], ['enhance.keys', 'Keyboard shortcuts']] },
    { id: 'grades', title: 'Grades', says: 'See what’s new, how you did, and what you need.', keys: [['enhance.newgrades', 'New-grade badges'], ['enhance.scores', 'Score bars'], ['enhance.calc', 'What-if calculator']] },
    { id: 'speed', title: 'Speed', says: 'Pages open at once, with your courses loaded ahead.', keys: [['enhance.instant', 'Open pages instantly'], ['enhance.prefetch', 'Load course data ahead of time'], ['enhance.feedback', 'Show pages loading at once']] },
    { id: 'buddy', title: 'Study buddy', says: 'A buddy that grows with the work you hand in.', keys: [['enhance.pet', 'Pet habitat'], ['enhance.streak', 'Streak']] },
    { id: 'reminders', title: 'Reminders', says: 'A note on the site’s pages before work is due.', keys: [['enhance.remind', 'Due-date reminders']] },
  ];
  const LEVELS = [['off', 'Off'], ['subtle', 'Subtle'], ['expressive', 'Expressive']];
  const get = (s, key) => key.split('.').reduce((o, k) => o?.[k], s);
  // What one switch writes: its whole group, with the one value changed (sync holds a group as one item).
  const change = (s, key, on) => { const [g, k] = key.split('.'); return { [g]: { ...s[g], [k]: on } }; };
  // Glaze's own theme: the default palette, look and background, worn as a Look is (a student's tooltips, hints and picture
  // kept), with light and dark left as they are.
  const OWN = Object.freeze({ name: 'Frost', colors: D.GZ_DEFAULTS.colors, palette: D.GZ_DEFAULTS.preset, look: {}, bg: {} });
  const LOOKS = [OWN, ...D.GZ_LOOKS];
  const theme = (s, L) => { const { auto, ...rest } = D.GZ_LOOK_APPLY(s, L); return L === OWN ? rest : { auto, ...rest }; };
  const worn = (s) => LOOKS.find((L) => D.GZ_LOOK_ON(s, L)) || null;
  // The motion the page shows: the student's level, off where the system asks for less and they follow it.
  const level = (s, reduced) => (s.motion.followSystem && reduced ? 'off' : s.motion.level);
  // A place in the wizard: { step, slide } from a hash and back; Next and Back walk the feature slides first.
  const at = (hash) => {
    const [step, id] = String(hash || '').replace(/^#\/?/, '').split('/');
    if (!STEPS.includes(step)) return { step: 'start', slide: 0 };
    return { step, slide: step === 'features' ? Math.max(0, FEATURES.findIndex((f) => f.id === id)) : 0 };
  };
  const hashOf = ({ step, slide }) => (step === 'features' ? `#/features/${FEATURES[slide].id}` : `#/${step}`);
  const move = ({ step, slide }, by) => {
    if (step === 'features' && slide + by >= 0 && slide + by < FEATURES.length) return { step, slide: slide + by };
    const to = STEPS[Math.max(0, Math.min(STEPS.length - 1, STEPS.indexOf(step) + by))];
    return { step: to, slide: to === 'features' && by < 0 ? FEATURES.length - 1 : 0 };
  };
  // How many of the wizard's switches are on.
  const count = (s) => FEATURES.flatMap((f) => f.keys).filter(([k]) => get(s, k) === true).length;
  return { STEPS, FEATURES, LEVELS, OWN, LOOKS, get, change, theme, worn, level, at, hashOf, move, count };
})();

if (typeof document !== 'undefined' && globalThis.chrome?.runtime?.id) (() => {
  const S = GZ_SETUP;
  const html = document.documentElement, $ = (q) => document.querySelector(q);
  const t = (key, vars) => GZ_I18N.t(key, vars, GZ_I18N.ui());
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const said = $('#told'), toastEl = $('#toast'), next = $('#next'), back = $('#back');
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  // Until storage answers, a fresh install's settings (the worker records the install a moment after opening this page).
  let s = GZ_SANITIZE({}, true);
  let place = S.at(location.hash), school = null, parts = null, worn = null;

  // ---- saving ----
  let toastTimer = 0;
  const toast = (text) => {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
  };
  const failed = () => { toast(t('Not saved. Try again in a moment.')); load().then(refresh); };
  const send = (m) => chrome.runtime.sendMessage(m).then((r) => { if (!r?.ok) failed(); }, failed);
  const save = (key, on) => {
    Object.assign(s, S.change(s, key, on));
    if (key === 'navbar.on') return send({ type: 'glaze:navbar', patch: { on } });
    return send({ type: 'glaze:setup', key, value: on });
  };
  // A Look goes in once the student settles on one: arrow keys walk the cards, and sync takes 120 writes a minute.
  let themeTimer = 0, pending = null;
  const flush = () => {
    clearTimeout(themeTimer);
    if (!pending) return;
    const L = pending;
    pending = null;
    send({ type: 'glaze:look', ...(L !== S.OWN && { look: L.name }), parts: null, patch: { version: 2, ...S.theme(s, L) } });
  };
  const saveTheme = (L) => { clearTimeout(themeTimer); pending = L; themeTimer = setTimeout(flush, 350); };
  addEventListener('pagehide', flush);
  const load = async () => {
    const [raw, local] = await Promise.all([chrome.storage.sync.get(null).catch(() => ({})), chrome.storage.local.get('freshDefaults').catch(() => ({}))]);
    s = GZ_SANITIZE(raw, local.freshDefaults ? local.freshDefaults.fresh === true : true);
  };

  // ---- the page wears the Look ----
  const FROSTDEV = GZ_LOOKS.find((l) => l.name === 'Frostdev');
  const canvas = $('#terrain'), ground = $('.ground');
  const shown = () => S.level(s, reduced.matches);
  let scene = null, starting = null;
  const space = CSS.supports('background-image', 'linear-gradient(in oklab, red, blue)') ? 'oklab' : '';
  const paint = () => {
    const bg = { ...GZ_DEFAULTS.bg, ...worn.bg };
    if (bg.kind !== 'scene') {
      canvas.classList.remove('live');
      scene?.update({ kind: 'scene', name: scene.name || 'mist', palette: worn.colors, ground: worn.colors['--gz-surface-2'], colors: GZ_BG_COLORS(bg.colors, worn.colors), dim: 1, amount: 0, speed: 0 });
      return;
    }
    if (!scene) {
      starting ||= import(chrome.runtime.getURL('looks/scene.js')).then((m) => {
        scene = m.start(canvas, () => true, () => { scene = null; canvas.classList.remove('live'); });
        paint();
      }, () => {});
      return;
    }
    const L = GZ_SCENE_LOOK(bg.intensity);
    scene.name = bg.scene;
    scene.update({ kind: 'scene', name: bg.scene, palette: worn.colors, ground: worn.colors['--gz-surface-2'], colors: GZ_BG_COLORS(bg.colors, worn.colors), dim: L.dim, amount: L.amount, speed: shown() === 'off' ? 0 : L.pace });
    requestAnimationFrame(() => scene && canvas.classList.add('live'));
  };
  const wear = (L) => {
    if (worn === L) return;
    worn = L;
    const colors = L.colors, bg = { ...GZ_DEFAULTS.bg, ...L.bg };
    for (const [k, v] of Object.entries(colors)) html.style.setProperty(k, v);
    GZ_BG_COLORS(bg.colors, colors).forEach((c, i) => html.style.setProperty(`--gz-bg-${i + 1}`, c));
    const dark = GZ_COLOR.brightness(GZ_COLOR.parse(colors['--gz-surface'])) < 0.5;
    html.style.colorScheme = dark ? 'dark' : 'light';
    html.dataset.tone = dark ? 'dark' : 'light';
    html.dataset.bg = bg.kind;
    ground.style.setProperty('--wash', bg.kind === 'gradient' ? GZ_GRADIENT(bg, space) : 'none');
    // Its pointer set over the page, and its pointer's, typing's and effects' motion.
    parts = GZ_LOOK_PARTS(L)?.x || null;
    const set = parts?.pointer && GZ_LX.CURSORS[parts.pointer] ? parts.pointer : null;
    const url = (f) => chrome.runtime.getURL(f);
    if (set) {
      html.style.setProperty('--arrow', `${GZ_LX.cursorCss(set, 'default', url)}, default`);
      html.style.setProperty('--hand', `${GZ_LX.cursorCss(set, 'pointer', url)}, pointer`);
    } else { html.style.setProperty('--arrow', 'default'); html.style.setProperty('--hand', 'pointer'); }
    paint();
    globalThis.GZ_MOTIONX?.sync();
  };
  // The Look's "complete" effect from the middle of el, once its parts are in.
  const bloom = async (el) => {
    await globalThis.GZ_MOTIONX?.sync();
    const r = el.getBoundingClientRect();
    document.dispatchEvent(new CustomEvent('glaze:moment', { detail: { name: 'complete', x: r.left + r.width / 2, y: r.top + r.height / 2 } }));
  };
  const motion = () => { html.setAttribute('data-gz-motion', shown()); if (worn) paint(); globalThis.GZ_MOTIONX?.sync(); };
  globalThis.GZ_CTX ||= Object.freeze({
    need: (file, ready) => (ready() ? Promise.resolve() : Promise.reject(new Error(file))),
    on: () => true,
    parts: () => parts,
    settings: () => ({ extras: { pointerAnim: s.extras.pointerAnim } }),
  });
  const fx = document.createElement('script');
  fx.src = chrome.runtime.getURL('looks/page/motionx.js');
  fx.onload = () => globalThis.GZ_MOTIONX?.sync();
  document.body.append(fx);
  // The splash wears Frostdev; every step after it the student's theme: a Look, Glaze's own, or a palette and background
  // of their own (synced from another device), drawn without parts.
  let mine = null;
  const custom = () => {
    const key = JSON.stringify([s.colors, s.bg]);
    if (mine?.key !== key) mine = { key, name: '', colors: { ...s.colors }, look: {}, bg: { ...s.bg } };
    return mine;
  };
  const dress = () => wear(place.step === 'start' ? FROSTDEV : S.worn(s) || custom());

  // ---- theme ----
  const looksBox = $('#looks');
  const lookCards = S.LOOKS.map((L, i) => {
    const c = L.colors, bg = { ...GZ_DEFAULTS.bg, ...L.bg }, three = GZ_BG_COLORS(bg.colors, c);
    const b = make('button', { type: 'button', className: 'look' });
    b.setAttribute('role', 'radio');
    b.setAttribute('translate', 'no');
    b.dataset.look = L.name;
    b.dataset.bg = bg.kind;
    b.style.setProperty('--i', String(i));
    for (const [k, v] of [['--c-ground', c['--gz-surface-2']], ['--c-surface', c['--gz-surface']], ['--c-accent', c['--gz-accent']], ['--c-hi', c['--gz-accent-hi']],
      ['--c-ink', c['--gz-ink']], ['--c-muted', c['--gz-ink-muted']], ['--c-line', c['--gz-line-strong']], ['--c-1', three[0]], ['--c-2', three[1]], ['--c-3', three[2]]]) b.style.setProperty(k, v);
    const art = make('span', { className: 'mock' }, make('i', { className: 'sky' }), make('i', { className: 'side' }),
      make('i', { className: 'card' }, make('b'), make('b'), make('b')), make('i', { className: 'pill' }));
    art.setAttribute('aria-hidden', 'true');
    b.append(art, make('span', { className: 'name', textContent: L.name }), tick());
    b.addEventListener('click', () => pickLook(L, b));
    return b;
  });
  looksBox.append(...lookCards);
  function tick() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'tick');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M5 12.5l4.4 4.4L19 7.3');
    svg.append(p);
    return svg;
  }
  const pickLook = (L, card) => {
    if (S.worn(s) === L && worn === L) return;
    Object.assign(s, S.theme(s, L));
    wear(L);
    renderLooks();
    saveTheme(L);
    said.textContent = L.name;
    if (shown() !== 'off') bloom(card);
  };
  const renderLooks = () => {
    const on = S.worn(s);
    lookCards.forEach((b, i) => {
      const yes = S.LOOKS[i] === on;
      b.setAttribute('aria-checked', String(yes));
      b.tabIndex = yes || (!on && i === 0) ? 0 : -1;
    });
  };

  // ---- radio groups: arrow keys move and choose, as native radios do ----
  const arrows = (box, cards, pick) => box.addEventListener('keydown', (e) => {
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = Math.max(1, cards.filter((c) => c.offsetTop === cards[0].offsetTop).length);
    const step = { ArrowRight: 1, ArrowDown: cols, ArrowLeft: -1, ArrowUp: -cols, Home: -i, End: cards.length - 1 - i }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(cards.length - 1, i + (getComputedStyle(box).direction === 'rtl' && /Left|Right/.test(e.key) ? -step : step)));
    cards[j].focus();
    pick(j);
  });
  arrows(looksBox, lookCards, (j) => pickLook(S.LOOKS[j], lookCards[j]));

  // ---- motion ----
  const levelsBox = $('#levels');
  const levelCards = S.LEVELS.map(([v, label]) => {
    const b = make('button', { type: 'button', className: `level lv-${v}` },
      make('span', { className: 'demo' }, make('i'), make('i'), make('i'), make('em')), make('span', { className: 'name', textContent: t(label) }), tick());
    b.setAttribute('role', 'radio');
    b.querySelector('.demo').setAttribute('aria-hidden', 'true');
    b.dataset.level = v;
    b.addEventListener('click', () => pickLevel(v, b));
    return b;
  });
  levelsBox.append(...levelCards);
  const pickLevel = (v, card) => {
    if (s.motion.level === v) return;
    save('motion.level', v);
    motion();
    renderLevels();
    said.textContent = t(S.LEVELS.find(([k]) => k === v)[1]);
    if (v === 'expressive' && shown() !== 'off') bloom(card);
  };
  const renderLevels = () => levelCards.forEach((b) => {
    const yes = b.dataset.level === s.motion.level;
    b.setAttribute('aria-checked', String(yes));
    b.tabIndex = yes ? 0 : -1;
  });
  arrows(levelsBox, levelCards, (j) => pickLevel(S.LEVELS[j][0], levelCards[j]));

  // ---- switches ----
  const switches = [];
  const toggle = (key, label, needs) => {
    const b = make('button', { type: 'button', className: 'switch' }, make('span', { className: 'label', textContent: t(label) }), make('span', { className: 'knob' }));
    b.setAttribute('role', 'switch');
    b.dataset.key = key;
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      const on = S.get(s, key) !== true;
      save(key, on);
      if (key.startsWith('motion.')) motion();
      if (key === 'extras.pointerAnim') globalThis.GZ_MOTIONX?.sync();
      renderSwitches();
      renderChips();
    });
    switches.push({ b, key, needs });
    return b;
  };
  const renderSwitches = () => {
    for (const { b, key, needs } of switches) {
      if (!b.isConnected) continue;
      b.setAttribute('aria-checked', String(S.get(s, key) === true));
      b.setAttribute('aria-disabled', String(!!needs && S.get(s, needs) !== true));
    }
  };
  $('#motion-switches').append(toggle('motion.followSystem', 'Turn motion off when the system asks for reduced motion'), toggle('extras.pointerAnim', 'Pointer animation'));

  // ---- features ----
  const chipsBox = $('#chips'), art = $('#art'), list = $('#feature-switches');
  const chips = S.FEATURES.map((f, i) => {
    const b = make('button', { type: 'button', className: 'chip' }, make('span', { className: 'dot' }));
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', t(f.title));
    b.setAttribute('aria-controls', 'slide');
    b.addEventListener('click', () => go({ step: 'features', slide: i }));
    return b;
  });
  chipsBox.append(...chips);
  const renderChips = () => chips.forEach((b, i) => {
    const f = S.FEATURES[i];
    b.setAttribute('aria-selected', String(place.step === 'features' && place.slide === i));
    b.tabIndex = place.slide === i ? 0 : -1;
    b.dataset.on = String(S.get(s, f.keys[0][0]) === true);
  });
  arrows(chipsBox, chips, (j) => go({ step: 'features', slide: j }));
  const renderSlide = () => {
    const f = S.FEATURES[place.slide];
    $('#count').textContent = `${place.slide + 1} / ${S.FEATURES.length}`;
    $('#feature-title').textContent = t(f.title);
    $('#says').textContent = t(f.says, { keys: /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K' });
    art.dataset.show = f.id;
    for (const v of art.children) v.hidden = v.dataset.art !== f.id;
    switches.splice(0, switches.length, ...switches.filter((w) => !list.contains(w.b)));
    list.replaceChildren(...f.keys.map(([key, label, needs]) => toggle(key, label, needs)));
    list.dataset.many = String(f.keys.length > 1);
    renderSwitches();
    renderChips();
  };

  // ---- done ----
  const openSchool = $('#open-school');
  const renderDone = () => {
    const theme = S.worn(s);
    const rows = [[t('Theme'), theme ? theme.name : t('Custom theme'), true], [t('Motion'), t(S.LEVELS.find(([k]) => k === s.motion.level)[1])],
      [t('Features'), t('{n} on', { n: S.count(s) })], ...(school ? [[t('School'), school.host, true]] : [])];
    $('#summary').replaceChildren(...rows.flatMap(([k, v, raw], i) => {
      const dd = make('dd', { textContent: v });
      dd.dataset.k = k;
      dd.style.setProperty('--i', String(i));
      if (raw) dd.setAttribute('translate', 'no');
      return [make('dt', { textContent: k }), dd];
    }));
    openSchool.hidden = !school;
    if (school) openSchool.querySelector('.label').textContent = school.host;
  };
  openSchool.addEventListener('click', () => { if (school) location.assign(school.url); });
  $('#open-settings').addEventListener('click', () => location.assign(chrome.runtime.getURL('options.html')));
  document.addEventListener('glaze:school', (e) => { school = e.detail; renderFoot(); });

  // ---- steps ----
  const rail = [...document.querySelectorAll('.rail [data-go]')];
  const renderFoot = () => {
    const { step } = place;
    back.hidden = step === 'start';
    next.querySelector('.label').textContent = t(step === 'school' ? 'Finish' : 'Next');
  };
  const refresh = () => {
    dress();
    renderLooks();
    renderLevels();
    renderSwitches();
    renderChips();
    if (place.step === 'done') renderDone();
  };
  const show = (to, from) => {
    const was = from && S.STEPS.indexOf(from.step), now = S.STEPS.indexOf(to.step);
    const forward = !from || now > was || (now === was && to.slide >= from.slide);
    html.dataset.step = to.step;
    const lost = document.activeElement && document.activeElement !== document.body && !document.activeElement.closest(`#${to.step}, .foot, .rail`);
    const enter = (el) => { el.dataset.in = forward ? 'fwd' : 'back'; el.addEventListener('animationend', () => delete el.dataset.in, { once: true }); };
    for (const id of S.STEPS) {
      const sec = document.getElementById(id);
      if (id === to.step && sec.hidden) enter(sec);
      else if (id === to.step && to.step === 'features' && from?.slide !== to.slide) enter($('#slide'));
      sec.hidden = id !== to.step;
    }
    rail.forEach((b, i) => {
      const k = S.STEPS.indexOf(b.dataset.go);
      b.closest('li').dataset.state = k < now ? 'past' : k === now ? 'now' : 'next';
      if (k === now) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    // The rail fills to the step shown, feature by feature through Features.
    const fill = to.step === 'done' ? 1 : (now - 1 + (to.step === 'features' ? to.slide / S.FEATURES.length : 0)) / 3;
    html.style.setProperty('--progress', String(Math.max(0, Math.min(1, fill))));
    if (to.step === 'features') renderSlide();
    if (to.step === 'done') { renderDone(); if (shown() !== 'off') setTimeout(() => bloom($('.seal')), 450); }
    renderFoot();
    dress();
    const heading = document.getElementById(to.step === 'features' ? 'feature-title' : `${to.step}-title`);
    said.textContent = heading.textContent;
    if (to.step === 'school' && from?.step !== 'school' && matchMedia('(pointer: fine)').matches) $('#address').focus({ preventScroll: true });
    else if (to.step === 'start') $('#begin').focus({ preventScroll: true });
    else if (lost || !from) heading.focus({ preventScroll: true });
    scrollTo({ top: 0, behavior: shown() === 'off' ? 'instant' : 'smooth' });
  };
  const go = (to) => {
    const hash = S.hashOf(to);
    if (location.hash === hash) return;
    location.hash = hash;
  };
  addEventListener('hashchange', () => { const from = place; place = S.at(location.hash); show(place, from); });
  next.addEventListener('click', () => go(S.move(place, 1)));
  back.addEventListener('click', () => go(S.move(place, -1)));
  $('#begin').addEventListener('click', () => go({ step: 'theme', slide: 0 }));
  rail.forEach((b) => b.addEventListener('click', () => go({ step: b.dataset.go, slide: 0 })));

  // ---- start ----
  reduced.addEventListener('change', motion);
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'sync' || (area === 'local' && c.freshDefaults)) load().then(refresh);
  });
  motion();
  show(place, null);
  load().then(() => { motion(); refresh(); });
})();

if (typeof module !== 'undefined') module.exports = GZ_SETUP;
