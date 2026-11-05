// Blackboard owns the content slot and controls. Pearson owns its original document, editor and grading events.
var GZ_PEARSON_EMBED = globalThis.GZ_PEARSON_EMBED || (() => {
  const X = globalThis.GZ_CTX, L = globalThis.GZ_PEARSON_EMBED_LIB;
  if (!X || !L || X.site !== 'ultra') return null;
  let view = null, sheet = null, queued = 0, pearsonAccess = false, accessRevision = 0;
  const vars = slot => ['--gz-pearson-gap','--gz-pearson-height','--gz-pearson-scheme'].map(k => [k,slot.style.getPropertyValue(k),slot.style.getPropertyPriority(k)]);
  const restore = v => { v.slot.removeAttribute('data-gz-pearson-slot'); for (const [k,value,priority] of v.vars) { if (value) v.slot.style.setProperty(k,value,priority); else v.slot.style.removeProperty(k); } };
  const nativeExit = header => header?.querySelector('button[data-analytics-id="course.content.header.exit"]') || header?.querySelector('button:not(.gz-pearson-host-controls *)');
  // live: Glaze may act on Pearson here (Glaze on, access on this device, a Pearson switch on). on: also embed new launches. Switching
  // Pearson inside Blackboard off keeps a live session as it is; only later launches go native.
  const live = () => pearsonAccess && X.on() && X.settings().enabled !== false && ['pearsonViewer', 'pearsonEmbed', 'pearsonMath'].some(k => X.settings().enhance[k] === true);
  const on = () => live() && X.settings().enhance.pearsonEmbed === true;
  const context = (force = false) => {
    if (!view) return;
    const enabled = on(), key = `${enabled}:${view.lookKey}`; if (!force && view.sent === key) return;
    view.sent = key; view.frame.contentWindow?.postMessage({ gzPearsonEmbed: 'context', channel: view.channel, enabled, theme: view.theme }, L.socket);
  };
  const look = () => {
    if (!view) return;
    // One bounded root read when the active Look changes, never in the sizing/scroll pass.
    const cs = getComputedStyle(document.documentElement);
    view.theme = L.theme(Object.fromEntries(L.tokens.map(k => [k, k === '--gz-pearson-scheme' ? X.darkTheme() ? 'dark' : 'light' : cs.getPropertyValue(k).trim()])));
    view.slot.style.setProperty('--gz-pearson-scheme', view.theme['--gz-pearson-scheme']);
    view.lookKey = JSON.stringify(view.theme); context();
  };
  const size = () => {
    queued = 0; const v = view; if (!v?.active || !v.frame.isConnected) return;
    const r = v.slot.getBoundingClientRect(), bottom = v.header.getBoundingClientRect().bottom;
    const gap = Math.max(0, Math.ceil(bottom - r.top)), height = Math.max(240, Math.floor((visualViewport?.height || innerHeight) - Math.max(bottom, r.top) - 24));
    for (const [key,value] of [['--gz-pearson-gap',`${gap}px`],['--gz-pearson-height',`${height}px`]]) if (v.slot.style.getPropertyValue(key) !== value) v.slot.style.setProperty(key,value);
  };
  const schedule = () => { if (!queued) queued = requestAnimationFrame(size); };
  const activate = () => {
    const v = view; if (!v || !live()) return;
    if (!sheet) { sheet = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: chrome.runtime.getURL('pearson/embed.css') }); document.head.append(sheet); }
    if (!v.active) {
      if (v.paused) { v.vars = vars(v.slot); v.paused = false; }
      v.resize.observe(v.slot); v.resize.observe(v.header); v.lookWatch.observe(document.documentElement, { attributes: true }); look();
      v.active = true; v.slot.setAttribute('data-gz-pearson-slot', ''); v.frame.setAttribute('data-gz-pearson-frame', ''); v.exit.setAttribute('data-gz-pearson-native-exit', '');
    }
    if (!v.controls) {
      v.controls = Object.assign(document.createElement('div'), { className: 'gz-pearson-host-controls' });
      v.controls.setAttribute('role','group'); v.controls.setAttribute('aria-label','Pearson');
      const open = Object.assign(document.createElement('button'), { type: 'button', textContent: X.t('Open in tab') });
      open.addEventListener('click', async () => {
        if (!view || view !== v || open.disabled) return;
        open.disabled = true;
        try {
          const fresh = !v.url ? null : await new Promise(done => {
            const request = crypto.randomUUID(), timer = setTimeout(() => { v.pending = null; done(null); }, 1500);
            v.pending = {request, timer, done}; v.frame.contentWindow.postMessage({gzPearsonEmbed:'locate',channel:v.channel,request},L.socket);
          });
          if (view !== v) return;
          const url = fresh || L.launch(v.frame.src, location.href);
          if (url) await chrome.runtime.sendMessage({ type: 'glaze:pearson-embed', op: 'open', url });
        } catch { /* original session stays available */ }
        finally { open.disabled = false; }
      });
      const close = Object.assign(document.createElement('button'), { type: 'button', textContent: '×' });
      close.setAttribute('aria-label', X.t('Close Pearson')); close.title = X.t('Close Pearson');
      close.addEventListener('click', () => { if (view === v) { v.exit.click(); sync(); } });
      v.controls.append(open, close); v.exit.parentElement.append(v.controls);
    }
    if (v.controls.firstElementChild.textContent !== X.t('Open in tab')) v.controls.firstElementChild.textContent = X.t('Open in tab');
    if (v.controls.lastElementChild.getAttribute('aria-label') !== X.t('Close Pearson')) v.controls.lastElementChild.setAttribute('aria-label', X.t('Close Pearson'));
    size();
  };
  const pause = () => {
    cancelAnimationFrame(queued); queued = 0;
    if (view && !view.paused) {
      if (view.pending) { clearTimeout(view.pending.timer); view.pending.done(null); view.pending = null; }
      view.resize.disconnect(); view.lookWatch.disconnect(); view.controls?.remove(); view.controls = null;
      view.frame.removeAttribute('data-gz-pearson-frame'); view.exit.removeAttribute('data-gz-pearson-native-exit'); restore(view);
      view.active = false; view.paused = true;
    }
    sheet?.remove(); sheet = null;
  };
  const off = () => { pause(); view?.frame.removeEventListener('load', context); view = null; };
  const sync = () => {
    if (!L.lti(location.href)) return off();
    const frame = document.getElementById('lti-launch-iframe'), header = frame?.closest('.routed-page')?.querySelector('content-page-header > header') || document.querySelector('content-page-header > header');
    if (view && (view.frame !== frame || !frame?.isConnected)) off();
    if (!live()) { context(); return pause(); }
    if (view && view.slot !== frame.parentElement) {
      restore(view); view.resize.unobserve(view.slot); view.slot = frame.parentElement; view.vars = vars(view.slot);
      view.resize.observe(view.slot); view.slot.style.setProperty('--gz-pearson-scheme', view.theme['--gz-pearson-scheme']);
      if (view.active) view.slot.setAttribute('data-gz-pearson-slot','');
    }
    // Ultra can replace its header while retaining the live content frame. Keep the session and channel.
    const exit = nativeExit(header);
    if (view && header && exit && (view.header !== header || view.exit !== exit || view.controls && view.controls.parentElement !== exit.parentElement)) {
      view.exit.removeAttribute('data-gz-pearson-native-exit'); view.header = header; view.exit = exit;
      view.resize.disconnect(); view.resize.observe(view.slot); view.resize.observe(header);
      if (view.controls) exit.parentElement.append(view.controls);
      if (view.active) exit.setAttribute('data-gz-pearson-native-exit','');
    }
    if (!view) {
      const exit = nativeExit(header);
      if (!on() || !frame || !header || !exit || !L.launch(frame.src, location.href)) return;
      const slot = frame.parentElement, resize = new ResizeObserver(schedule), lookWatch = new MutationObserver(look);
      view = { frame, header, exit, slot, resize, lookWatch, theme: {}, lookKey: '', channel: crypto.randomUUID(), sent: null, active: false, url: '', controls: null,
        vars: vars(slot) };
      resize.observe(slot); resize.observe(header); frame.addEventListener('load', context);
      lookWatch.observe(document.documentElement, {attributes:true}); look();
    }
    context(); if (view.active) activate();
  };
  addEventListener('message', e => {
    const v = view, m = e.data;
    if (!v || e.source !== v.frame.contentWindow || e.origin !== L.socket) return;
    if (m?.gzPearsonEmbed === 'hello') { context(true); return; }
    if (m?.channel !== v.channel) return;
    if (m.gzPearsonEmbed === 'active') activate();
    if (m.gzPearsonEmbed === 'place') {
      const url = L.homework(m.url);
      if (url) {
        v.url = url; if (!v.active) activate();
        if (v.pending && v.pending.request === m.request) { clearTimeout(v.pending.timer); const done = v.pending.done; v.pending = null; done(url); }
      }
    }
  });
  addEventListener('resize', schedule); addEventListener('scroll', schedule, true); visualViewport?.addEventListener('resize', schedule);
  addEventListener('pagehide', e => { if (!e.persisted) off(); });
  addEventListener('pageshow', e => { if (e.persisted) sync(); });
  const access = (value) => { pearsonAccess = value === true; sync(); };
  const readAccess = () => {
    const at = ++accessRevision;
    chrome.storage.local.get('pearsonAccess').then(v => { if (at === accessRevision) access(v.pearsonAccess); }, () => { if (at === accessRevision) access(false); });
  };
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.pearsonAccess) { accessRevision++; access(c.pearsonAccess.newValue); } });
  addEventListener('pageshow', e => { if (e.persisted) readAccess(); });
  readAccess();
  return { sync, off };
})();
GZ_PEARSON_EMBED;
