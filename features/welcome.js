// Glaze's first screen (features/welcome.html), opened once when Glaze is installed on a browser that asks for each site
// (lib/background.js): a school on its own address needs its host granted before Glaze can reach it. The student types or
// pastes it; Allow asks the browser for exactly that host, and Open goes there. All sites asks for every https site at once,
// after which Glaze asks on each school's pages itself (features/consent.js). It wears the Frostdev Look: its terrain
// (lib/scene.js), palette, pointers and motion (features/motionx.js), all from the Look's own definitions. Nothing here
// talks to the network. Classic script; module.exports for node (the address parser and the button's state).
var GZ_WELCOME = globalThis.GZ_WELCOME || (() => {
  const LOCAL = new Set(['localhost', '127.0.0.1']);
  // What a student types or pastes, as the site Glaze would ask for: { host, origin, pattern, url } or null. Any page's
  // address will do (its path, query and case go); a bare host gets https. Plain http only for this computer (local
  // Canvas or Moodle); a school's own host is always asked for as https, and a match pattern can't name a port.
  const address = (text) => {
    let s = String(text ?? '').trim();
    if (!s || /[\s@\\]/.test(s)) return null;
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(s)) s = `https://${s}`;
    let u;
    try { u = new URL(s); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/\.$/, '');
    const local = LOCAL.has(host);
    const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    if (!local && !ip && !/^([a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+(?:[a-z]{2,63}|xn--[a-z\d-]{1,59})$/.test(host)) return null;
    const scheme = local ? 'http:' : 'https:';
    const port = local && u.port ? `:${u.port}` : '';
    return { host, origin: `${scheme}//${host}${port}`, pattern: `${scheme}//${host}/*`, url: `${scheme}//${host}${port}/` };
  };
  // The button: nothing to do yet ('none', shown as a dimmed Allow), Glaze can already reach the site ('open'), or it must
  // ask first ('allow').
  const act = (site, held) => (!site ? 'none' : held ? 'open' : 'allow');
  return { address, act };
})();

if (typeof document !== 'undefined' && globalThis.chrome?.runtime?.id) (() => {
  const { address, act } = GZ_WELCOME;
  const html = document.documentElement;
  const $ = (s) => document.querySelector(s);
  const form = $('#site'), bar = $('.bar'), input = $('#address'), go = $('#go'), label = go.querySelector('.label');
  const error = $('#error'), all = $('#all'), another = $('#another'), said = $('#said');
  const t = (key, vars) => GZ_I18N.t(key, vars, GZ_I18N.ui());
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

  // Example addresses take turns in the empty field, one for each LMS, until the student types.
  const EXAMPLES = ['canvas.school.edu', 'bb.school.edu', 'moodle.school.edu'];
  let shown = 0;
  const turn = setInterval(() => {
    if (input.value || still.matches) return;
    input.setAttribute('data-swap', '');
    setTimeout(() => { shown = (shown + 1) % EXAMPLES.length; input.placeholder = EXAMPLES[shown]; input.removeAttribute('data-swap'); }, 450);
  }, 2800);

  let site = null, held = false, allHeld = false, busy = false, done = false, ask = 0;
  const render = () => {
    const a = act(site, held || allHeld);
    go.dataset.act = a;
    label.textContent = t(a === 'open' ? 'Open' : 'Allow');
    go.setAttribute('aria-disabled', String(a === 'none'));
    if (!bar.hasAttribute('data-state') || bar.dataset.state !== 'bad') bar.dataset.state = done ? 'done' : a === 'open' ? 'ready' : '';
    all.setAttribute('aria-pressed', String(allHeld));
    all.disabled = allHeld;
  };
  // Whether Glaze can reach the typed site already: a built-in host, one granted before, or every site.
  const check = async () => {
    const mine = ++ask;
    site = address(input.value);
    held = false;
    render();
    if (!site) return;
    const has = await chrome.permissions.contains({ origins: [site.pattern] }).catch(() => false);
    if (mine === ask) { held = has; render(); }
  };
  const refresh = async () => {
    allHeld = await chrome.permissions.contains({ origins: ['https://*/*'] }).catch(() => false);
    await check();
  };
  const fail = () => {
    bar.dataset.state = 'bad';
    error.hidden = false;
    input.focus();
  };
  const settle = (s) => {
    done = true;
    input.value = s.host;
    input.readOnly = true;
    another.hidden = false;
    said.textContent = t('Allowed {host}', { host: s.host });
    render();
    go.focus();
    bloom($('.lead'));
    // The worker puts Glaze on the site from its first page (permissions.onAdded tells it too).
    chrome.runtime.sendMessage({ type: 'glaze:allow', origin: s.origin }).catch(() => {});
  };
  const again = () => {
    done = false;
    input.readOnly = false;
    input.value = '';
    another.hidden = true;
    check();
    input.focus();
  };

  input.addEventListener('input', () => {
    clearInterval(turn);
    error.hidden = true;
    if (bar.dataset.state === 'bad') delete bar.dataset.state;
    check();
  });
  // A pasted page's address shows as the site it stands for, so the student sees what Glaze will ask for.
  input.addEventListener('paste', () => setTimeout(() => {
    const s = address(input.value);
    if (s && input.value !== s.origin.replace(/^https:\/\//, '')) { input.value = s.origin.replace(/^https:\/\//, ''); input.dispatchEvent(new Event('input')); }
  }));
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || busy) return;
    if (done) again(); else if (input.value) { input.value = ''; input.dispatchEvent(new Event('input')); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    const s = address(input.value);
    if (!s) return fail();
    if (go.dataset.act === 'open' || done) return location.assign(s.url);
    // The browser's prompt opens from this click: nothing may be awaited before the request.
    busy = true;
    go.setAttribute('data-busy', '');
    input.readOnly = true;
    chrome.permissions.request({ origins: [s.pattern] }).then((ok) => {
      busy = false;
      go.removeAttribute('data-busy');
      if (ok) { held = true; settle(s); } else { input.readOnly = false; input.focus(); }
    }, () => { busy = false; go.removeAttribute('data-busy'); input.readOnly = false; });
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
      chrome.runtime.sendMessage({ type: 'glaze:allow', all: true }).catch(() => {});
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
