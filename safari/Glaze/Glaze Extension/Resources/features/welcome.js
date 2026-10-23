// Glaze's first screen (features/welcome.html), opened once when Glaze is installed on a browser that asks for each site
// (lib/background.js): a school on its own address needs its host granted before Glaze can reach it. The student types or
// pastes it (lib/site.js); Allow asks the browser for exactly that host, then checks that it is Blackboard, Canvas or
// Moodle before Glaze takes it: anything else has its grant handed straight back, with course sites nearby to pick instead.
// Open goes there. All sites asks for every https site at once, after which Glaze asks on each school's pages itself
// (features/consent.js). It wears the Frostdev Look: its terrain (lib/scene.js), palette, pointers and motion
// (features/motionx.js), all from the Look's own definitions. It talks only to the school sites the student names.
// Classic script; module.exports for node (the button's state).
var GZ_WELCOME = globalThis.GZ_WELCOME || (() => {
  // The button: nothing to do yet ('none', shown as a dimmed Allow), Glaze can already reach the site ('open'), or it must
  // ask first ('allow').
  const act = (site, held) => (!site ? 'none' : held ? 'open' : 'allow');
  return { act };
})();

if (typeof document !== 'undefined' && globalThis.chrome?.runtime?.id) (() => {
  const { act } = GZ_WELCOME;
  const { address, probe, nearby } = GZ_SITE;
  const html = document.documentElement;
  const $ = (s) => document.querySelector(s);
  const form = $('#site'), bar = $('.bar'), input = $('#address'), go = $('#go'), label = go.querySelector('.label');
  const note = $('#note'), error = $('#error'), picks = $('#picks'), kindTag = $('#kind'), all = $('#all'), another = $('#another'), said = $('#said');
  const t = (key, vars) => GZ_I18N.t(key, vars, GZ_I18N.ui());
  const arrow = go.querySelector('.arrow');
  GZ_I18N.page();
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  // The Frostdev Look, as defaults.js defines it: its palette on <html> (features/motionx.js reads the colours there), its
  // terrain behind everything, and its pointer's, typing's and success's motion.
  const { colors: palette, bg } = GZ_LOOKS.find((l) => l.name === 'Frostdev');
  for (const [k, v] of Object.entries(palette)) html.style.setProperty(k, v);
  const motion = () => html.setAttribute('data-gz-motion', still.matches ? 'off' : 'subtle');
  motion();
  const canvas = $('#terrain');
  let scene = null;
  const paint = () => {
    const L = GZ_SCENE_LOOK(bg.intensity);
    scene?.update({ kind: 'scene', name: bg.scene, palette, ground: palette['--gz-surface-2'], colors: bg.colors, dim: L.dim, amount: L.amount, speed: still.matches ? 0 : L.pace });
  };
  import(chrome.runtime.getURL('lib/scene.js')).then((m) => {
    scene = m.start(canvas, () => true, () => { scene = null; canvas.classList.remove('live'); });
    paint();
    requestAnimationFrame(() => scene && canvas.classList.add('live'));
  }, () => {});
  still.addEventListener('change', () => { motion(); paint(); globalThis.GZ_MOTIONX?.sync(); });
  globalThis.GZ_CTX ||= Object.freeze({
    need: (file, ready) => (ready() ? Promise.resolve() : Promise.reject(new Error(file))),
    on: () => true,
    parts: () => GZ_LOOK_PARTS({ name: 'Frostdev' })?.x || null,
    settings: () => ({ extras: { pointerAnim: true } }),
  });
  const fx = document.createElement('script');
  fx.src = chrome.runtime.getURL('features/motionx.js');
  fx.onload = () => globalThis.GZ_MOTIONX?.sync();
  document.body.append(fx);
  // The Look's "complete" effect (contour rings and its snowflake) from the middle of el.
  const bloom = (el) => {
    const r = el.getBoundingClientRect();
    document.dispatchEvent(new CustomEvent('glaze:moment', { detail: { name: 'complete', x: r.left + r.width / 2, y: r.top + r.height / 2 } }));
  };

  // Example addresses take turns in the empty field, one for each LMS, for three rounds or until the student types.
  const EXAMPLES = ['canvas.school.edu', 'bb.school.edu', 'moodle.school.edu'];
  let shown = 0, turns = 0, turn = 0;
  const next = () => {
    if (input.value || still.matches || document.hidden || ++turns > EXAMPLES.length * 3) return;
    input.setAttribute('data-swap', '');
    turn = setTimeout(() => { shown = (shown + 1) % EXAMPLES.length; input.placeholder = EXAMPLES[shown]; input.removeAttribute('data-swap'); turn = setTimeout(next, 2800); }, 450);
  };
  turn = setTimeout(next, 2800);

  let site = null, held = false, allHeld = false, busy = false, done = null, ask = 0, pasted = null;
  const typed = () => { const s = address(input.value); return s && !s.path && pasted?.origin === s.origin ? { ...s, path: pasted.path } : s; };
  const NAMES = { ultra: 'Blackboard', canvas: 'Canvas', moodle: 'Moodle' };
  const render = () => {
    const a = act(site, held || allHeld);
    go.dataset.act = done ? 'open' : a;
    label.textContent = t(done || a === 'open' ? 'Open' : 'Allow');
    go.setAttribute('aria-disabled', String(!done && a === 'none'));
    if (bar.dataset.state !== 'bad') bar.dataset.state = done ? 'done' : a === 'open' ? 'ready' : '';
    all.setAttribute('aria-pressed', String(allHeld));
    all.disabled = allHeld;
  };
  // Whether Glaze can reach the typed site already: a built-in host, one granted before, or every site.
  const check = async () => {
    const mine = ++ask;
    site = typed();
    held = false;
    render();
    if (!site) return;
    const has = await chrome.permissions.contains({ origins: [site.pattern] }).catch(() => false);
    if (mine === ask) { held = has; render(); }
  };
  const refresh = async () => {
    allHeld = await chrome.permissions.contains({ origins: ['https://*/*'] }).catch(() => false);
    if (!done) await check(); else render();
  };
  // What went wrong, under the bar, and the course sites to pick instead (each one goes the same way as typing it).
  const tell = (text, hosts = []) => {
    error.textContent = text;
    picks.replaceChildren(...hosts.map((h) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'pick' });
      b.setAttribute('translate', 'no');
      b.append(h, arrow.cloneNode(true));
      b.addEventListener('click', () => { if (busy) return; input.value = h; clear(); allow(address(h)); });
      return b;
    }));
    note.hidden = false;
    bar.dataset.state = 'bad';
  };
  const clear = () => { note.hidden = true; picks.replaceChildren(); if (bar.dataset.state === 'bad') delete bar.dataset.state; };
  const hold = (on) => { busy = on; go.toggleAttribute('data-busy', on); input.readOnly = on || !!done; };
  const settle = (s, found) => {
    done = { ...s, ...found };
    input.value = s.host;
    kindTag.textContent = NAMES[found.kind];
    kindTag.hidden = false;
    another.hidden = false;
    said.textContent = t('Allowed {host}', { host: s.host });
    hold(false);
    render();
    go.focus();
    bloom($('.lead'));
    // The worker puts Glaze on the site from its first page.
    chrome.runtime.sendMessage({ type: 'glaze:allow', op: 'yes', origin: s.origin, kind: found.kind, url: found.url }).catch(() => {});
  };
  const again = () => {
    done = null;
    kindTag.hidden = true;
    input.readOnly = false;
    input.value = '';
    another.hidden = true;
    clear();
    check();
    input.focus();
  };
  // Allow: the browser's prompt opens from the click that called this, so nothing is awaited before the request. Granted,
  // the site is checked; a site that isn't Blackboard, Canvas or Moodle gives its grant back at once (after its own
  // homepage was read for links), and the student gets the course sites nearby to pick.
  const allow = (s) => {
    hold(true);
    chrome.runtime.sendMessage({ type: 'glaze:allow', op: 'ask', origin: s.origin }).catch(() => {});
    chrome.permissions.request({ origins: [s.pattern] }).then(async (ok) => {
      if (!ok) { hold(false); input.focus(); return; }
      said.textContent = t('Checking {host}', { host: s.host });
      const found = await probe(s);
      if (typeof found === 'object') return settle(s, found);
      const hosts = await nearby(s, { held: found === 'none' });
      await chrome.permissions.remove({ origins: [s.pattern] }).catch(() => {});
      held = false;
      hold(false);
      tell(t(found === 'none' ? 'No course site at {host}' : "Can't reach {host}", { host: s.host }), hosts);
      (picks.firstChild || input).focus();
    }, () => { hold(false); });
  };

  input.addEventListener('input', () => {
    clearTimeout(turn);
    clear();
    check();
  });
  // A pasted page's address shows as the site it stands for, so the student sees what Glaze will ask for; its first folder
  // is kept for the check (a Moodle may live there).
  input.addEventListener('paste', () => setTimeout(() => {
    const s = address(input.value);
    if (!s) return;
    pasted = s;
    const shown = s.origin.replace(/^https:\/\//, '');
    if (input.value !== shown) { input.value = shown; input.dispatchEvent(new Event('input')); }
  }));
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || busy) return;
    if (done) again(); else if (input.value) { input.value = ''; input.dispatchEvent(new Event('input')); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    if (done) return location.assign(done.url);
    const s = typed();
    if (!s) return tell(t('Not a web address'));
    if (go.dataset.act === 'open') return location.assign(s.url);
    allow(s);
  });
  all.addEventListener('click', () => {
    if (busy || allHeld) return;
    busy = true;
    chrome.permissions.request({ origins: ['https://*/*'] }).then((ok) => {
      busy = false;
      if (!ok) return;
      allHeld = true;
      said.textContent = t('All sites allowed');
      render();
      bloom(all);
      chrome.runtime.sendMessage({ type: 'glaze:allow', op: 'all' }).catch(() => {});
    }, () => { busy = false; });
  });
  another.addEventListener('click', again);
  // A grant made or taken back elsewhere (the browser's own menu, Settings) shows here too.
  chrome.permissions.onAdded?.addListener(refresh);
  chrome.permissions.onRemoved?.addListener(refresh);
  refresh();
  input.focus();
})();

if (typeof module !== 'undefined') module.exports = GZ_WELCOME;
