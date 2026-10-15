// Keyboard shortcuts (enhance.keys), loaded on demand: content.js loads this on the first key that starts one while the
// switch is on (`g`; on Ultra also `/` and `?`), hands it that key, then every keydown of the top frame (key).
// "g" then a letter goes somewhere, "/" searches, "?" lists them. Never while typing, never with a modifier.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_KEYS = globalThis.GZ_KEYS || (() => {
  const ctx = globalThis.GZ_CTX;
  const ultra = ctx.site === 'ultra';
  const { t, typing } = ctx;
  const GO = ultra ? { c: ['/ultra/course', 'Courses'], a: ['/ultra/calendar', 'Calendar'], g: ['/ultra/grades', 'Grades'], m: ['/ultra/messages', 'Messages'], s: ['/ultra/stream', 'Activity stream'] } : { d: ['/', 'Dashboard'], c: ['/courses', 'Courses'], a: ['/calendar', 'Calendar'], g: ['/grades', 'Grades'], m: ['/conversations', 'Inbox'] };
  let gAt = 0;
  let keysBox = null;
  let keysBack = null;
  const closeKeys = () => { keysBox?.remove(); keysBox = null; if (!ultra && keysBack?.isConnected) keysBack.focus({ preventScroll: true }); keysBack = null; };
  const openKeys = () => {
    keysBox = document.createElement('div');
    keysBox.id = 'gz-keys';
    keysBox.dataset.path = location.pathname;
    keysBox.setAttribute('role', 'dialog');
    keysBox.setAttribute('aria-label', t('Keyboard shortcuts'));
    const h = document.createElement('h2');
    h.textContent = t('Keyboard shortcuts');
    const dl = document.createElement('dl');
    const row = (keys, what) => {
      const dt = document.createElement('dt');
      for (const k of keys) { const kbd = document.createElement('kbd'); kbd.textContent = k; dt.append(kbd); }
      const dd = document.createElement('dd');
      dd.textContent = what;
      dl.append(dt, dd);
    };
    for (const [k, [, label]] of Object.entries(GO)) row(['g', k], t(label));
    if (ultra) row(['/'], t('Search'));
    if (ctx.settings().enhance.palette) row([/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl', 'K'], t('Go to anything'));
    row(ultra ? ['?'] : ['g', '?'], t('Show or hide this list'));
    const panel = document.createElement('div');
    panel.className = 'gz-keys-panel';
    panel.append(h, dl);
    if (!ultra) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = t('Dismiss'); b.addEventListener('click', closeKeys); panel.append(b);
      keysBox.setAttribute('aria-modal', 'true');
      keysBox.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); b.focus(); } });
      keysBack = document.activeElement;
    }
    keysBox.append(panel);
    keysBox.addEventListener('click', (e) => { if (e.target === keysBox) closeKeys(); });
    document.body.append(keysBox);
    if (!ultra) keysBox.querySelector('button').focus();
  };
  // Opened before the page's words arrived: drawn again in them, keeping where focus goes back to.
  ctx.wordsIn.add(() => {
    if (!keysBox) return;
    const back = keysBack;
    keysBox.remove();
    keysBox = null;
    openKeys();
    keysBack = back;
  });
  const key = (e) => {
    if (!ultra && e.key === 'Escape' && keysBox && !typing(e.target)) { e.preventDefault(); closeKeys(); return; }
    if (!ultra && e.key === 'Shift') return; // g then Shift+? must keep its prefix.
    if (!ctx.keyOn(e)) { gAt = 0; return; }
    const now = e.at || Date.now(); // a key pressed while this file loaded keeps its time
    if (e.key === 'Escape' && keysBox) { closeKeys(); return; }
    if (!ultra && now - gAt < 1200 && e.key === '?') {
      e.preventDefault(); e.stopImmediatePropagation(); gAt = 0;
      if (keysBox) closeKeys(); else openKeys();
      return;
    }
    if (now - gAt < 1200 && GO[e.key]) {
      e.preventDefault();
      gAt = 0;
      location.assign(location.origin + GO[e.key][0]);
      return;
    }
    gAt = e.key === 'g' ? now : 0;
    if (!ultra) return; // Canvas owns both / and its global ? help dialog.
    if (e.key === '/') {
      // By Ultra's ids (courses-overview-filter-search, search-button…), which no language changes.
      const target = [...document.querySelectorAll('input[type="search"], :is(input, button)[id*="search" i]')].find((el) => el.offsetWidth > 0);
      if (!target) return;
      e.preventDefault();
      if (target.tagName === 'BUTTON') target.click();
      else target.focus();
    } else if (e.key === '?') {
      e.preventDefault();
      if (keysBox) closeKeys();
      else openKeys();
    }
  };
  return {
    key,
    // A Canvas page changed under the open list: it was about that page.
    sync: () => { if (!ultra && keysBox && keysBox.dataset.path !== location.pathname) closeKeys(); },
    off: () => { gAt = 0; closeKeys(); },
  };
})();

GZ_KEYS;
