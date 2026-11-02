// ISOLATED world in Pearson's opener. Only a recognized Ultra host can authorize the packaged MAIN-world hook.
(() => {
  const L = GZ_PEARSON_EMBED_LIB;
  if (location.origin !== L.socket || location.pathname !== '/uiservice/opener' || top === window || globalThis.__gzPearsonLaunchDoc) return;
  const doc = globalThis.__gzPearsonLaunchDoc = crypto.randomUUID();
  // Pearson redirects can leave an interop referrer. The worker identifies the approved Ultra host.
  let host = null;
  let context = null, enabled = false, active = false, loading = false, ready = false, ended = false, generation = 0, reading = 0;
  const send = (op, extra = {}) => { if (!ended && ready && context) parent.postMessage({ gzPearsonEmbed: op, channel: context.channel, ...extra }, host); };
  const tell = () => document.dispatchEvent(new CustomEvent('glaze:pearson-launch-config', { detail: JSON.stringify({ channel: context?.channel, enabled: !ended && ready && enabled && context?.enabled === true }) }));
  const ownFrame = () => document.getElementById('gz-pearson-embedded');
  const childContext = () => { if (!ended && ready && context) ownFrame()?.contentWindow?.postMessage({ gzPearsonFrame: 'context', channel: context.channel, theme: context.theme }, L.mylab); };
  const start = async () => {
    if (ended) return;
    if (ready) { if (context) { tell(); childContext(); } return; }
    if (loading || !enabled) return;
    loading = true; const at = generation;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'glaze:pearson-embed', op: 'launch', doc });
      if (ended || at !== generation || !enabled) return;
      if (r?.ok && typeof r.host === 'string' && new URL(r.host).protocol === 'https:' && new URL(r.host).origin === r.host) {
        host = r.host; ready = true; parent.postMessage({ gzPearsonEmbed: 'hello' }, host);
      }
      else send('native');
    } catch { if (!ended && at === generation) send('native'); }
    finally { if (at === generation) loading = false; }
  };
  const read = async () => {
    const at = generation, order = ++reading;
    try {
      const s = await chrome.storage.sync.get(['enabled','enhance']);
      if (ended || at !== generation || order !== reading) return;
      enabled = s.enabled !== false && s.enhance?.pearsonEmbed !== false; start();
    } catch { if (!ended && at === generation && order === reading) { enabled = false; if (ready && context) tell(); } }
  };
  document.addEventListener('glaze:pearson-launch-state', e => {
    let data; try { data = JSON.parse(e.detail); } catch { return; }
    if (ended || !ready || !context || data?.channel !== context.channel || !['active','native'].includes(data.phase)) return;
    active ||= data.phase === 'active'; send(data.phase);
    if (active) { const f = ownFrame(); f?.addEventListener('load', childContext); childContext(); }
  });
  addEventListener('message', e => {
    if (ended || !ready) return;
    const m = e.data;
    if (host && e.source === parent && e.origin === host && m?.gzPearsonEmbed === 'context' && L.channel(m.channel)) {
      if (active && context?.channel !== m.channel) return;
      const theme = L.theme(m.theme), lookKey = JSON.stringify(theme);
      if (context?.channel === m.channel && context.enabled === (m.enabled === true) && context.lookKey === lookKey) return;
      context = { channel: m.channel, enabled: m.enabled === true, theme, lookKey };
      document.documentElement.style.setProperty('--gz-pearson-scheme', theme['--gz-pearson-scheme'] || 'normal'); start();
    } else if (e.source === parent && e.origin === host && context && m?.channel === context.channel && m.gzPearsonEmbed === 'locate' && L.channel(m.request)) {
      ownFrame()?.contentWindow?.postMessage({gzPearsonFrame:'locate',channel:context.channel,request:m.request},L.mylab);
    } else if (context && e.source === ownFrame()?.contentWindow && e.origin === L.mylab) {
      if (m?.gzPearsonFrame === 'hello') childContext();
      if (m?.gzPearsonFrame === 'place' && m.channel === context.channel) {
        const url = L.homework(m.url); if (url) send('place', { url, ...(L.channel(m.request) ? {request:m.request} : {}) });
      }
    }
  });
  chrome.storage.onChanged.addListener((c, a) => {
    if (a !== 'sync' || (!c.enabled && !c.enhance)) return;
    if (c.enabled?.newValue === false || c.enhance?.newValue?.pearsonEmbed === false) {
      enabled = false; if (ready && context) tell();
    }
    read();
  });
  addEventListener('pagehide', () => {
    // A cached document must renew both worker authorization and parent consent before resuming its hook.
    ended = true; generation++; ready = false; loading = false; enabled = false; host = null;
    if (context) { context.enabled = false; tell(); }
  });
  addEventListener('pageshow', e => { if (e.persisted) { ended = false; read(); } });
  read();
})();
