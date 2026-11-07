// ISOLATED world in Pearson's opener. Only a recognized Ultra host can authorize the packaged MAIN-world hook.
(() => {
  const L = GZ_PEARSON_EMBED_LIB;
  if (location.origin !== L.socket || location.pathname !== '/uiservice/opener' || top === window || globalThis.__gzPearsonLaunchDoc) return;
  const doc = globalThis.__gzPearsonLaunchDoc = crypto.randomUUID();
  let id = crypto.randomUUID(), helloTimer = null, helloDelay = 250;
  // Pearson redirects can leave an interop referrer. The worker identifies the approved Ultra host.
  let host = null;
  // live: this device holds Pearson's hosts, Glaze and a Pearson switch are on, so a session here stays themed. enabled: also
  // Pearson inside Blackboard, which embeds new launches; turning it off leaves a live session as it is.
  let context = null, live = false, enabled = false, active = false, loading = false, ready = false, ended = false, generation = 0, reading = 0, child = null;
  const send = (op, extra = {}) => { if (!ended && ready && context) parent.postMessage({ gzPearsonEmbed: op, channel: context.channel, ...extra }, host); };
  const tell = () => document.dispatchEvent(new CustomEvent('glaze:pearson-launch-config', { detail: JSON.stringify({ channel: context?.channel, enabled: !ended && ready && enabled && context?.enabled === true }) }));
  const ownFrame = () => document.getElementById('gz-pearson-embedded');
  // Only the homework document that said hello: before it the frame is blank, which Chrome counts as this opener's origin.
  const toChild = m => { const f = ownFrame(); if (f && child?.frame === f) f.contentWindow?.postMessage(m, L.mylab); };
  const childContext = () => { if (!ended && ready && live && context) toChild({ gzPearsonFrame: 'context', channel: context.channel, theme: context.theme }); };
  const hello = () => {
    if (ended || !ready || !host) return;
    parent.postMessage({ gzPearsonEmbed: 'hello', id }, host);
    clearTimeout(helloTimer); helloTimer = setTimeout(hello, helloDelay); helloDelay = Math.min(helloDelay * 2, 10000);
  };
  const start = async () => {
    if (ended) return;
    if (ready) { if (context) { tell(); childContext(); } return; }
    if (loading || !enabled) return;
    loading = true; const at = generation;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'glaze:pearson-embed', op: 'launch', doc });
      if (ended || at !== generation || !enabled) return;
      if (r?.ok && typeof r.host === 'string' && new URL(r.host).protocol === 'https:' && new URL(r.host).origin === r.host) {
        host = r.host; ready = true; hello();
      }
      else send('native');
    } catch { if (!ended && at === generation) send('native'); }
    finally { if (at === generation) loading = false; }
  };
  const read = async () => {
    const at = generation, order = ++reading;
    try {
      const [s, local] = await Promise.all([chrome.storage.sync.get(['enabled','enhance']), chrome.storage.local.get('pearsonAccess')]);
      if (ended || at !== generation || order !== reading) return;
      live = local.pearsonAccess === true && s.enabled !== false && ['pearsonViewer', 'pearsonEmbed', 'pearsonMath'].some(k => s.enhance?.[k] === true);
      enabled = live && s.enhance?.pearsonEmbed === true;
      if (!enabled && ready && context) tell();
      childContext();
      start();
    } catch { if (!ended && at === generation && order === reading) { live = false; enabled = false; if (ready && context) tell(); } }
  };
  document.addEventListener('glaze:pearson-launch-state', e => {
    let data; try { data = JSON.parse(e.detail); } catch { return; }
    if (ended || !ready || !context || data?.channel !== context.channel || !['active','native'].includes(data.phase)) return;
    active ||= data.phase === 'active'; send(data.phase);
    if (active) { const f = ownFrame(); f?.addEventListener('load', childContext); childContext(); }
  });
  addEventListener('message', e => {
    const m = e.data, f = ownFrame();
    if (f && e.source === f.contentWindow && e.origin === L.mylab && L.channel(m?.id)) {
      if (m.gzPearsonFrame === 'hello') child = { frame: f, id: m.id };
      else if (m.gzPearsonFrame === 'bye' && child?.id === m.id) child = null;
    }
    if (ended || !ready) return;
    if (host && e.source === parent && e.origin === host && m?.gzPearsonEmbed === 'context' && L.channel(m.channel)) {
      if (active && context?.channel !== m.channel) return;
      clearTimeout(helloTimer); helloTimer = null;
      const theme = L.theme(m.theme), lookKey = JSON.stringify(theme);
      if (context?.channel === m.channel && context.enabled === (m.enabled === true) && context.lookKey === lookKey) return;
      context = { channel: m.channel, enabled: m.enabled === true, theme, lookKey };
      document.documentElement.style.setProperty('--gz-pearson-scheme', theme['--gz-pearson-scheme'] || 'normal'); start();
    } else if (live && e.source === parent && e.origin === host && context && m?.channel === context.channel && m.gzPearsonEmbed === 'locate' && L.channel(m.request)) {
      toChild({gzPearsonFrame:'locate',channel:context.channel,request:m.request});
    } else if (live && context && e.source === ownFrame()?.contentWindow && e.origin === L.mylab) {
      if (m?.gzPearsonFrame === 'hello') childContext();
      if (m?.gzPearsonFrame === 'place' && m.channel === context.channel) {
        const url = L.homework(m.url); if (url) send('place', { url, ...(L.channel(m.request) ? {request:m.request} : {}) });
      }
    }
  });
  chrome.storage.onChanged.addListener((c, a) => {
    if (!(a === 'sync' && (c.enabled || c.enhance) || a === 'local' && c.pearsonAccess)) return;
    if (a === 'local' && c.pearsonAccess?.newValue !== true || a === 'sync' && (c.enabled?.newValue === false || c.enhance && c.enhance.newValue?.pearsonEmbed !== true)) {
      enabled = false; if (ready && context) tell();
    }
    if (a === 'local' && c.pearsonAccess?.newValue !== true || a === 'sync' && (c.enabled?.newValue === false || c.enhance && !['pearsonViewer', 'pearsonEmbed', 'pearsonMath'].some(k => c.enhance.newValue?.[k] === true))) live = false;
    read();
  });
  addEventListener('pagehide', () => {
    // A cached document must renew both worker authorization and parent consent before resuming its hook.
    clearTimeout(helloTimer); helloTimer = null;
    if (ready && host) parent.postMessage({ gzPearsonEmbed: 'bye', id }, host);
    ended = true; generation++; ready = false; loading = false; live = false; enabled = false; host = null;
    if (context) { context.enabled = false; tell(); }
  });
  addEventListener('pageshow', e => { if (e.persisted) { id = crypto.randomUUID(); helloDelay = 250; ended = false; read(); } });
  // The first hello can land before Blackboard's side listens; it posted to this frame on load before the hello existed.
  addEventListener('load', () => { if (!ended && ready && !context) hello(); });
  read();
})();
