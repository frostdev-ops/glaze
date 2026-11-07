// Appearance and current navigation only, in known MyLab/tdx homework documents. Never read inputs or problem text.
(() => {
  const L = GZ_PEARSON_EMBED_LIB, origin = L.child(location.href);
  if (!origin || globalThis.__gzPearsonEmbedded) return;
  globalThis.__gzPearsonEmbedded = true;
  const standalone = top === window;
  // Referrer changes to the previous homework page after in-frame navigation; the parent stays the same.
  const from = origin === L.mylab ? L.socket : /^\/assignment\//i.test(location.pathname) ? L.mylab : L.tdx;
  const html = document.documentElement;
  const childAttrs = new Map(), id = crypto.randomUUID();
  // Child frames whose current document said hello. Before that a frame can still hold its MyLab launch redirect, where
  // Chrome refuses and logs a post to tdx.
  const said = new WeakMap();
  let channel = null, enabled = false, stopped = false, nav = null, mode = null, question = null, lastQuestion = null, theme = {}, lookKey = '', sheet = null;
  const emit = m => parent.postMessage(m, from);
  const place = request => {
    if (!enabled || !channel || stopped) return;
    if (origin === L.mylab) {
      const safe = L.homework(location.href); if (!safe) return;
      const url = new URL(safe); if (question && /PlayerHomework/i.test(url.pathname)) url.searchParams.set('questionId', question);
      emit({ gzPearsonFrame: 'place', channel, url: url.href, ...(L.channel(request) ? {request} : {}) });
    }
  };
  const canvas = () => enabled && !stopped && (origin === L.mylab || mode?.classList.contains('playmode-homework'));
  const children = () => {
    const on = canvas();
    for (const [f,value] of childAttrs) if (!on || !f.isConnected || !L.frameOrigin(f.src)) {
      if (value === null) f.removeAttribute('data-gz-pearson-child'); else f.setAttribute('data-gz-pearson-child',value);
      childAttrs.delete(f);
    }
    if (!on) return;
    for (const f of document.getElementsByTagName('iframe')) {
      const to = L.frameOrigin(f.src); if (!to) continue;
      if (!childAttrs.has(f)) childAttrs.set(f,f.getAttribute('data-gz-pearson-child'));
      f.setAttribute('data-gz-pearson-child','');
      if (channel && !standalone && said.has(f)) f.contentWindow?.postMessage({ gzPearsonFrame: 'context', channel, theme }, to);
    }
  };
  const mark = () => {
    const on = !standalone && !!channel && canvas();
    html.toggleAttribute('data-gz-pearson-embedded', on);
    if (!on) { sheet?.remove(); return; }
    sheet ||= Object.assign(document.createElement('style'), {id:'gz-pearson-embedded-theme'});
    const css = ':root[data-gz-pearson-embedded]{' + Object.entries(theme).map(([k,v]) => `${k}:${v}!important`).join(';') + '}';
    if (sheet.textContent !== css) sheet.textContent = css;
    if (!sheet.isConnected) (document.head || html).append(sheet);
  };
  const selected = () => {
    if (!enabled || origin !== L.tdx || !nav || !document.querySelector('#playerViewer.playmode-homework') || !channel) return;
    const rows = [...nav.querySelectorAll('li')], at = rows.findIndex(row => row.classList.contains('selected'));
    if (at >= 0 && at !== lastQuestion) { lastQuestion = at; emit({ gzPearsonFrame: 'question', channel, question: at + 1 }); }
  };
  const navWatch = new MutationObserver(selected);
  const modeWatch = new MutationObserver(() => mount());
  const mount = () => {
    const root = document.querySelector('#playerViewer,#assignmentViewer');
    if (root !== mode) { modeWatch.disconnect(); mode = root; if (mode) modeWatch.observe(mode,{attributes:true,attributeFilter:['class']}); }
    mark();
    const next = document.querySelector('#playerViewer.playmode-homework .assignmentreviewnavListContainer');
    if (next !== nav) { navWatch.disconnect(); nav = next; lastQuestion = null; if (nav) navWatch.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true }); selected(); }
    children();
  };
  const watched = 'iframe,#playerViewer,#assignmentViewer,.assignmentreviewnavListContainer';
  const watch = new MutationObserver(records => { if (records.some(r => [...r.addedNodes,...r.removedNodes].some(n => n.nodeType === 1 && (n.matches(watched) || n.querySelector(watched))))) mount(); });
  watch.observe(html, { childList: true, subtree: true });
  addEventListener('load', e => { if (e.target?.localName === 'iframe') children(); }, true);
  const frameOf = e => [...document.getElementsByTagName('iframe')].find(f => f.contentWindow === e.source && L.frameOrigin(f.src) === e.origin);
  addEventListener('message', e => {
    const m = e.data;
    if ((m?.gzPearsonFrame === 'hello' || m?.gzPearsonFrame === 'bye') && L.channel(m.id) && [L.mylab,L.tdx].includes(e.origin)) {
      const f = frameOf(e);
      if (f && m.gzPearsonFrame === 'hello') said.set(f, m.id); else if (f && said.get(f) === m.id) said.delete(f);
    }
    if (!standalone && e.source === parent && e.origin === from && m?.gzPearsonFrame === 'context' && L.channel(m.channel)) {
      const next = L.theme(m.theme), key = JSON.stringify(next);
      if (channel === m.channel && lookKey === key) return;
      const changed = channel !== m.channel;
      channel = m.channel; theme = next; lookKey = key; mark();
      if (changed) { lastQuestion = null; place(); mount(); selected(); } else children();
    } else if (enabled && !standalone && e.source === parent && e.origin === from && m?.channel === channel && m?.gzPearsonFrame === 'locate' && L.channel(m.request)) {
      if (origin === L.tdx && /^\/Player\//i.test(location.pathname)) {
        const rows = [...(nav?.querySelectorAll('li') || [])], at = rows.findIndex(row=>row.classList.contains('selected'));
        emit({gzPearsonFrame:'located',channel,request:m.request,question:at>=0 ? at+1 : null});
      } else {
        let sent = false;
        for (const f of document.getElementsByTagName('iframe')) {
          const to = L.frameOrigin(f.src); if (to) { sent = true; if (said.has(f)) f.contentWindow?.postMessage(m,to); }
        }
        if (!sent) place(m.request);
      }
    } else if (enabled && channel && [L.mylab,L.tdx].includes(e.origin)) {
      if (!frameOf(e)) return;
      if (m?.gzPearsonFrame === 'hello') children();
      if (m?.channel === channel && m.gzPearsonFrame === 'question' && Number.isInteger(m.question) && m.question > 0 && m.question <= 10000) {
        if (origin === L.mylab) { question = m.question; place(); } else emit({ gzPearsonFrame: 'question', channel, question: m.question });
      }
      if (m?.channel === channel && m.gzPearsonFrame === 'located' && L.channel(m.request)) {
        const valid = Number.isInteger(m.question) && m.question > 0 && m.question <= 10000;
        if (origin === L.mylab) { question = valid ? m.question : null; if (valid) place(m.request); }
        else emit({gzPearsonFrame:'located',channel,request:m.request,question:valid ? m.question : null});
      }
    }
  });
  let reading = 0;
  const read = async () => {
    const at = ++reading;
    try {
      const [s, local] = await Promise.all([chrome.storage.sync.get(['enabled', 'enhance']), chrome.storage.local.get('pearsonAccess')]);
      if (at !== reading) return;
      enabled = local.pearsonAccess === true && s.enabled !== false && ['pearsonViewer', 'pearsonEmbed', 'pearsonMath'].some(k => s.enhance?.[k] === true);
    } catch { if (at !== reading) return; enabled = false; }
    mark(); children(); if (enabled) { place(); selected(); }
  };
  chrome.storage.onChanged.addListener((c,a) => {
    if (a === 'local' && c.pearsonAccess && c.pearsonAccess.newValue !== true) { enabled = false; mark(); children(); }
    if (a === 'sync' && (c.enabled || c.enhance) || a === 'local' && c.pearsonAccess) read();
  });
  addEventListener('pagehide', e => { if (!e.persisted) { if (!standalone) parent.postMessage({ gzPearsonFrame: 'bye', id }, '*'); stopped = true; watch.disconnect(); navWatch.disconnect(); modeWatch.disconnect(); } mark(); children(); });
  addEventListener('pageshow', e => { if (e.persisted) { read(); children(); place(); } });
  if (!standalone) parent.postMessage({ gzPearsonFrame: 'hello', id }, '*');
  read(); mount();
})();
