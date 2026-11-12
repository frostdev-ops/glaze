// Glaze's first screen as a setup wizard (settings/welcome.html): the student picks a theme, how much motion, their
// navigation (settings/setup-nav.js), which features to keep and their AI (settings/setup-ai.js), then names their school
// (settings/welcome.js). Each step is the address's hash (#/theme,
// #/features/notes: no element's id, which Chrome would scroll to and take focus from), so the browser's back and forward
// walk them too. Every choice is saved the moment it is made, as Settings saves it: a Look
// through the worker ('glaze:look': a built-in Look with its own parts, or Glaze's own theme with none), the navigation's
// switch through 'glaze:navbar', motion, the pointer's animation and the features through 'glaze:setup'. A step of its own
// file (GZ_SETUP_PARTS, loaded before this) is mounted with the page's helpers and gives back its render and summary. The page wears
// what is picked: the Look's palette, its scene (looks/scene.js) or ground, its pointers and effects (looks/page/motionx.js),
// and the motion level; the opening splash wears the Frostdev Look. Classic script; module.exports for node.
var GZ_SETUP = globalThis.GZ_SETUP || (() => {
  const D = typeof GZ_DEFAULTS !== 'undefined' ? { GZ_DEFAULTS, GZ_LOOKS, GZ_LOOK_APPLY, GZ_LOOK_ON } : require('../content/defaults.js');
  const C = typeof GZ_CHOICES !== 'undefined' ? GZ_CHOICES : require('./choices.js');
  const STEPS = ['start', 'theme', 'motion', 'nav', 'features', 'ai', 'school', 'done'];
  // A new paper's formats (settings/editor-writer.js FORMATS): names, the same in every language but Blank's.
  const FORMATS = C.FORMATS;
  // One slide each: its words, its picture (welcome.html [data-art]), its switches as [setting, label, needs], and pick: a
  // choice of one as [setting, label, options ([value, name, raw]), needs].
  const FEATURES = [
    { id: 'sidebar', title: 'Sidebar', says: 'The page’s sidebar, with your widgets docked under it.', keys: [['enhance.sidebar', 'Use the sidebar'], ['enhance.widgets', 'Widgets']] },
    { id: 'todo', title: 'To Do', says: 'Everything due, grouped by day, with tasks of your own.', keys: [['enhance.todo', 'Better To Do'], ['enhance.dashboard', 'Glaze Dashboard']] },
    { id: 'notes', title: 'Notes', says: 'Notes with folders and checklists, kept on this device.', keys: [['enhance.notes', 'Notes']] },
    { id: 'writer', title: 'Writer', says: 'A calmer editor in Blackboard’s discussion, message and assignment boxes.', keys: [['enhance.writer', 'Glaze Writer']],
      pick: ['writer.format', 'Format for new papers', FORMATS, C.NEEDS['writer.format']] },
    { id: 'search', title: 'Search', says: '{keys} jumps to a course, a page or a setting.', keys: [['enhance.palette', 'Command palette'], ['enhance.search', 'Search in your courses', C.NEEDS['enhance.search']], ['enhance.keys', 'Keyboard shortcuts']] },
    { id: 'grades', title: 'Grades', says: 'See what’s new, how you did, and what you need.', keys: [['enhance.newgrades', 'New-grade badges'], ['enhance.scores', 'Score bars'], ['enhance.calc', 'What-if calculator']] },
    { id: 'speed', title: 'Speed', says: 'Pages open at once, with your courses loaded ahead.', keys: [['enhance.instant', 'Open pages instantly'], ['enhance.prefetch', 'Load course data ahead of time'], ['enhance.feedback', 'Show pages loading at once']] },
    { id: 'buddy', title: 'Study buddy', says: 'A buddy that grows with the work you hand in.', keys: [['enhance.pet', 'Pet habitat'], ['enhance.streak', 'Streak']] },
    { id: 'reminders', title: 'Reminders', says: 'A note on the site’s pages before work is due.', keys: [['enhance.remind', 'Due-date reminders'], ['enhance.remindExam', 'Exam reminders'], ['enhance.remindPlan', 'Plan reminders'], ['enhance.remindClass', 'Class reminders']] },
  ];
  const LEVELS = C.LEVELS;
  const get = (s, key) => key.split('.').reduce((o, k) => o?.[k], s);
  // What one switch writes: its whole group, with the one value changed (sync holds a group as one item).
  const change = (s, key, on) => { const [g, k] = key.split('.'); return { [g]: { ...s[g], [k]: on } }; };
  // Glaze's own theme: the default palette, look and background, worn as a Look is (a student's tooltips, hints and picture
  // kept), with light and dark left as they are.
  const OWN = C.OWN;
  const LOOKS = [OWN, ...D.GZ_LOOKS.filter((L) => !L.old)];
  const theme = C.theme;
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
  return { themeArt: C.themeArt, motionArt: C.motionArt, STEPS, FEATURES, LEVELS, OWN, LOOKS, get, change, theme, worn, level, at, hashOf, move, count };
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
  const failed = () => toast(t('Not saved. Try again in a moment.'));
  const send = (m) => chrome.runtime.sendMessage(m).then((r) => { if (!r?.ok) failed(); }, failed);
  const edits = new Map();
  // One setting (group.key) shown changed at once and kept so through reloads until its message is answered; m: the
  // message that saves it (a switch's 'glaze:setup' unless given).
  const save = (key, on, m = { type: 'glaze:setup', key, value: on }) => {
    Object.assign(s, S.change(s, key, on));
    const edit = { value: on };
    edits.set(key, edit);
    return send(m).then(() => { if (edits.get(key) === edit) edits.delete(key); return load().then(refresh); });
  };
  // A Look goes in once the student settles on one: arrow keys walk the cards, and sync takes 120 writes a minute.
  let themeTimer = 0, pending = null, themeChoice = null;
  const flush = () => {
    clearTimeout(themeTimer);
    if (!pending) return;
    const L = pending;
    pending = null;
    const choice = themeChoice;
    send({ type: 'glaze:look', ...(L !== S.OWN && { look: L.name }), parts: null, patch: { version: 2, ...S.theme(s, L) } }).then(() => {
      if (themeChoice === choice) themeChoice = null;
      return load().then(refresh);
    });
  };
  const saveTheme = (L) => { clearTimeout(themeTimer); pending = L; themeChoice = { look: L }; themeTimer = setTimeout(flush, 350); };
  addEventListener('pagehide', flush);
  let readId = 0, raw = {}, fresh = true;
  const load = async () => {
    const id = ++readId;
    const [all, local] = await Promise.all([chrome.storage.sync.get(null).catch(() => ({})), chrome.storage.local.get('freshDefaults').catch(() => ({}))]);
    if (id !== readId) return;
    raw = all;
    fresh = local.freshDefaults ? local.freshDefaults.fresh === true : true;
    s = GZ_SANITIZE(raw, fresh);
    for (const [key, edit] of edits) Object.assign(s, S.change(s, key, edit.value));
    if (themeChoice) Object.assign(s, S.theme(s, themeChoice.look));
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
    const art = S.themeArt(make);
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
    const available = cards.filter((c) => !c.hidden && c.getAttribute('aria-disabled') !== 'true');
    const i = available.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = Math.max(1, available.filter((c) => c.offsetTop === available[0].offsetTop).length);
    const step = { ArrowRight: 1, ArrowDown: cols, ArrowLeft: -1, ArrowUp: -cols, Home: -i, End: available.length - 1 - i }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(available.length - 1, i + (box.matches(':dir(rtl)') && /Left|Right/.test(e.key) ? -step : step)));
    available[j].focus();
    pick(cards.indexOf(available[j]));
  });
  arrows(looksBox, lookCards, (j) => pickLook(S.LOOKS[j], lookCards[j]));

  // ---- motion ----
  const levelsBox = $('#levels');
  const levelCards = S.LEVELS.map(([v, label]) => {
    const b = make('button', { type: 'button', className: `level lv-${v}` },
      S.motionArt(make), make('span', { className: 'name', textContent: t(label) }), tick());
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
      renderPicks();
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

  // ---- a choice of one inside a slide (a paper's format) ----
  let picks = [];
  const oneOf = (key, label, options, needs) => {
    const id = `pick-${key.replace('.', '-')}`;
    const opts = options.map(([v, name, raw]) => {
      const b = make('button', { type: 'button', className: 'opt', textContent: raw ? name : t(name) });
      b.setAttribute('role', 'radio');
      if (raw) b.setAttribute('translate', 'no');
      b.dataset.value = v;
      b.addEventListener('click', () => pickOne(key, v, needs));
      return b;
    });
    const row = make('div', { className: 'opts' }, ...opts);
    const box = make('div', { className: 'choice' }, make('span', { className: 'label', id, textContent: t(label) }), row);
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-labelledby', id);
    arrows(row, opts, (j) => pickOne(key, options[j][0], needs));
    picks = [...picks.filter((p) => p.box.isConnected), { box, opts, key, needs }];
    return box;
  };
  const pickOne = (key, v, needs) => {
    if ((needs && S.get(s, needs) !== true) || S.get(s, key) === v) return;
    save(key, v);
    renderPicks();
  };
  const renderPicks = () => {
    for (const { box, opts, key, needs } of picks) {
      const off = !!needs && S.get(s, needs) !== true;
      box.setAttribute('aria-disabled', String(off));
      const v = S.get(s, key);
      for (const b of opts) {
        b.setAttribute('aria-checked', String(b.dataset.value === v));
        b.tabIndex = b.dataset.value === v ? 0 : -1;
        b.setAttribute('aria-disabled', String(off));
      }
    }
  };

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
    list.replaceChildren(...f.keys.map(([key, label, needs]) => toggle(key, label, needs)), ...(f.pick ? [oneOf(...f.pick)] : []));
    list.dataset.many = String(f.keys.length > 1 || !!f.pick);
    renderSwitches();
    renderPicks();
    renderChips();
  };

  // ---- done ----
  const openSchool = $('#open-school');
  const renderDone = () => {
    const theme = S.worn(s);
    const rows = [[t('Theme'), theme ? theme.name : t('Custom theme'), true], [t('Motion'), t(S.LEVELS.find(([k]) => k === s.motion.level)[1])],
      [t('Features'), t('{n} on', { n: S.count(s) })], ...mounted.flatMap((p) => p.summary?.() || []), ...(school ? [[t('School'), school.host, true]] : [])];
    $('#summary').replaceChildren(...rows.flatMap(([k, v, raw], i) => {
      const dd = make('dd', { textContent: v });
      dd.dataset.k = k;
      dd.style.setProperty('--i', String(i));
      if (raw) dd.setAttribute('translate', 'no');
      return [make('dt', { className: 'sr-only', textContent: k }), dd];
    }));
    checkPin();
    openSchool.hidden = !school;
    if (school) openSchool.querySelector('.label').textContent = school.host;
  };
  // Pin Glaze, shown while the browser keeps it in its extensions menu (action.getUserSettings; hidden where there's none).
  const pin = $('#pin'), action = chrome.action;
  const pinned = (u) => { pin.hidden = u?.isOnToolbar !== false; };
  const checkPin = () => Promise.resolve().then(() => action.getUserSettings()).then(pinned, () => pinned(null));
  action?.onUserSettingsChanged?.addListener(pinned);
  addEventListener('focus', () => { if (place.step === 'done') checkPin(); });
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
    motion();
    renderLooks();
    renderLevels();
    renderSwitches();
    renderPicks();
    renderChips();
    for (const p of mounted) p.render?.();
    if (place.step === 'done') renderDone();
  };
  const show = (to, from) => {
    const was = from && S.STEPS.indexOf(from.step), now = S.STEPS.indexOf(to.step);
    const forward = !from || now > was || (now === was && to.slide >= from.slide);
    html.dataset.step = to.step;
    const lost = document.activeElement && document.activeElement !== document.body && (!document.activeElement.closest(`#${to.step}, .foot, .rail`)
      || (to.step === 'features' && from?.step === 'features' && from.slide !== to.slide && list.contains(document.activeElement)));
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
    const fill = to.step === 'done' ? 1 : (now - 1 + (to.step === 'features' ? to.slide / S.FEATURES.length : 0)) / (S.STEPS.length - 3);
    html.style.setProperty('--progress', String(Math.max(0, Math.min(1, fill))));
    if (to.step === 'features') renderSlide();
    if (to.step === 'done') { renderDone(); if (shown() !== 'off') setTimeout(() => bloom($('.seal')), 450); }
    for (const p of mounted) if (p.step === to.step) p.show?.(from);
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
  $('#skip').addEventListener('click', () => go({ step: 'school', slide: 0 }));
  rail.forEach((b) => b.addEventListener('click', () => go({ step: b.dataset.go, slide: 0 })));

  // ---- the steps of their own files ----
  // Each part: { step, mount(api) → { render?(), show?(from), summary?() → [[label, value, raw?]] } }. render runs after
  // every read of storage and choice; show when its step comes up; summary adds the done step's rows.
  const api = Object.freeze({
    t, make, tick, arrows, toast, failed, send, save, bloom, motion, said, $,
    settings: () => s, raw: () => raw, fresh: () => fresh, reload: () => load().then(refresh), shown, place: () => place,
  });
  const mounted = (globalThis.GZ_SETUP_PARTS || []).map((p) => ({ step: p.step, ...p.mount(api) }));

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
