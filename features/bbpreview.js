// Blackboard Ultra's file previews in Glaze's PDF viewer (enhance.bbPreviews, and only with Settings → Writer → PDFs on),
// loaded on demand: content.js loads this once a preview's frame is on an Ultra page and hands it each pass. Ultra converts
// every attachment to a PDF and shows it in its own viewer, a frame at the attachment's data-bbfile viewerUrl (live probe,
// 2026-10-30; the shapes: scripts/ultra-mock.js PREVIEW). Expanded, or open already, the worker is asked for that PDF
// (lib/bb-preview.js) while Blackboard's frame stays. Done: this page reads the converted PDF from its presigned S3 address
// (the bucket lets the page's own origin read it, as the probe found; at most MAX, the worker asked again once if S3
// refuses an address that ran out) while Glaze's viewer (writer.html in view mode, pdf-kind.js show) loads out of sight
// beside Blackboard's frame; the bytes go to it over its port, and it takes Blackboard's place once its first page is
// drawn, as tall as an assignment's paper. Converting: asked again on Ultra's own cadence, for as long as Ultra waits.
// Anything else, or nothing in time, keeps Blackboard's frame, and so does a viewer that fails later. Collapsing (Ultra removes its frame) or the switch off puts
// Blackboard's back. Esc in the viewer returns to the attachment's Preview button. Dark documents never inverts Glaze's
// frame (.gz-pv: content.js PREVIEWS, extras.css). Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_BB_PREVIEW_UI = globalThis.GZ_BB_PREVIEW_UI || (() => {
  const X = globalThis.GZ_CTX;
  if (!X || X.site !== 'ultra') return null;
  const html = document.documentElement;
  const FRAMES = '#site-wrap :is(.js-file-viewer-inline-preview, [class*="fileViewerContainer"]) iframe:not(.gz-pv)';
  const HEIGHT = 'max(640px, calc(100vh - 120px))'; // an assignment's paper (features/writer.js PAPER_HEIGHT)
  const ASK = 20000, SHOW = 30000, EVERY = 15000, FOR = 5 * 60e3; // EVERY and FOR: lib/bb-preview.js, Ultra's own
  const MAX = 50e6; // a converted PDF's bytes, at most
  const on = () => { const s = X.settings(); return X.on() && s.enabled !== false && s.enhance?.bbPreviews !== false && s.writer?.pdf !== false; };
  const views = new Map(); // Blackboard's frame → its view
  const answers = new Map(); // a frame's address → the worker's done answer, kept until two minutes before it ends

  // The Look as the frame wears it (features/writer.js look).
  const TOKENS = [...GZ_COLORS.map(([k]) => k), '--gz-radius', '--gz-font', '--gz-ground', '--gz-surface-paint', '--gz-surface-paint-2', '--gz-surface-opacity', '--gz-glass-mix', '--gz-border-line', '--gz-border-strong'];
  const look = () => {
    const cs = getComputedStyle(html), bg = html.getAttribute('data-gz-bg'), glass = !!bg && bg !== 'solid';
    const value = (k) => (k === '--gz-glass-mix' && !glass ? '100%' : cs.getPropertyValue(k).trim() || (k === '--gz-surface-opacity' ? '100%' : ''));
    return { tokens: Object.fromEntries(TOKENS.map((k) => [k, value(k)]).filter(([, v]) => v)), dark: html.hasAttribute('data-gz-dark-theme'), glass, motion: html.getAttribute('data-gz-motion') || 'off' };
  };

  // Blackboard's frame → its attachment: the data-bbfile whose viewerUrl it shows (else the one around it), that address on
  // this site (data, so read against the page's own address: Ultra's <base> is its CDN), its name, and the original's link
  // here. null: a frame that isn't an attachment's preview (it stays Blackboard's).
  const own = (u) => { try { const x = new URL(u, location.href); return x.origin === location.origin ? x : null; } catch { return null; } };
  const same = (a, b) => !!a && !!b && a.pathname === b.pathname && a.search === b.search;
  const fileOf = (bf) => {
    let at = null;
    try { at = new URL(bf.src); } catch { return null; }
    const read = (x) => { try { return JSON.parse(x.getAttribute('data-bbfile')); } catch { return null; } };
    const near = bf.closest('[data-bbfile]');
    const el = same(own(read(near)?.viewerUrl), at) ? near : [...document.querySelectorAll('#site-wrap [data-bbfile]')].find((x) => same(own(read(x)?.viewerUrl), at)) || null;
    const j = el && read(el), viewer = own(j?.viewerUrl);
    if (!viewer || j.render !== 'inline') return null;
    const a = el.querySelector('a[href*="/bbcswebdav/"]'), href = own(a?.getAttribute('href') || '')?.href || '';
    return { el, viewer: viewer.href, name: String(j.linkName || a?.textContent || bf.title || '').replace(/\s+/g, ' ').trim().slice(0, 200), href };
  };

  // The worker's answer for a frame's address (a done one kept while it lasts): { ok, status, pdf, expires } or a failure.
  const asked = (url, fresh = false) => {
    const hit = answers.get(url);
    if (!fresh && hit && hit.expires - Date.now() > 120e3) return Promise.resolve(hit);
    return Promise.race([Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'glaze:bb-preview', url })), new Promise((r) => setTimeout(r, ASK, null))])
      .catch(() => null).then((r) => { if (r?.ok && r.status === 'done' && typeof r.pdf === 'string') answers.set(url, r); return r; });
  };

  const live = (v) => views.get(v.bf) === v && v.bf.isConnected && on();
  // The converted PDF from its presigned address, as this page (no cookies), read to its end and stopped past MAX.
  const bytesOf = async (url, signal) => {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal });
    if (!r.ok || !r.body || +r.headers.get('content-length') > MAX) { r.body?.cancel().catch(() => {}); throw new Error(r.ok ? 'pdf:too-big' : `pdf:${r.status}`); }
    const reader = r.body.getReader(), parts = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if ((size += value.byteLength) > MAX) throw new Error('pdf:too-big');
        parts.push(value);
      }
    } finally { reader.cancel().catch(() => {}); }
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.byteLength; }
    return out;
  };
  // Refused or unreachable: the worker asked again for a fresh address (the last ran out), and that one read, once.
  const pdfOf = async (v, signal) => {
    try { return await bytesOf(v.answer.pdf, signal); } catch (e) {
      if (signal.aborted || e.message === 'pdf:too-big') throw e;
      const r = await asked(v.file.viewer, true);
      if (!(r?.ok && r.status === 'done') || signal.aborted) throw e;
      v.answer = r;
      return bytesOf(r.pdf, signal);
    }
  };
  // Where a preview is, on Blackboard's frame (for a look in the inspector, and the check): asking, converting, loading,
  // shown, or ended:<why> (Blackboard's frame for good).
  const mark = (v, state) => { if (state) v.bf.setAttribute('data-gz-pv', state); else v.bf.removeAttribute('data-gz-pv'); };
  // Back to Blackboard's frame for good (on this frame): Glaze's goes, and Blackboard's shows.
  const fail = (v, reason) => {
    clearTimeout(v.timer); clearTimeout(v.wait);
    v.reading?.abort(); v.reading = null;
    v.unhello?.(); v.unhello = null;
    v.port?.close(); v.port = null;
    v.gz?.remove(); v.gz = null;
    v.bf.removeAttribute('data-gz-pv-hidden');
    v.bf.parentElement?.removeAttribute('data-gz-pv-box');
    v.shown = false;
    v.ended = reason;
    mark(v, `ended:${reason}`);
  };
  const drop = (v) => { fail(v, 'gone'); mark(v, ''); views.delete(v.bf); };
  // Glaze's viewer is drawn: it takes Blackboard's place, at the paper's height and the box's width.
  const swap = (v) => {
    clearTimeout(v.wait);
    v.unhello?.(); v.unhello = null;
    v.shown = true;
    mark(v, 'shown');
    v.bf.setAttribute('data-gz-pv-hidden', '');
    v.bf.parentElement?.setAttribute('data-gz-pv-box', '');
    v.gz.style.cssText = `display:block;border:0;width:100%;height:${HEIGHT};background:transparent;color-scheme:${html.hasAttribute('data-gz-dark-theme') ? 'dark' : 'light'}`;
    v.gz.removeAttribute('tabindex');
  };
  // Esc in the viewer: the attachment's Preview button (aria-expanded), where the student opened it.
  const back = (v) => {
    const label = `Preview File ${v.file.name}`;
    const b = v.file.el.querySelector('button[aria-expanded="true"]') || [...document.querySelectorAll('button[aria-expanded]')].find((x) => x.getAttribute('aria-label') === label);
    b?.focus();
  };
  const hear = (v, m) => {
    if (m.type === 'ready') {
      // The bytes, once read, handed over (transferred: this page keeps no copy).
      const port = v.port;
      v.bytes.then((b) => {
        if (v.port !== port || !live(v)) return;
        port.postMessage({ type: 'init', mode: 'view', kind: 'pdf', view: { bytes: b.buffer, name: v.file.name, href: v.file.href }, look: look(), locale: X.locale() }, [b.buffer]);
      }, () => {});
    } else if (m.type === 'view:shown') swap(v);
    else if (m.type === 'view:failed') fail(v, `viewer:${String(m.reason || '').slice(0, 20)}`);
    else if (m.type === 'view:esc') back(v);
  };
  // The PDF read, and writer.html in view mode out of sight beside Blackboard's frame (on the one-use pass Writer's frames
  // use), both at once; the read failing, or the two not done and drawn within SHOW, keeps Blackboard's frame.
  const load = (v) => {
    let src;
    try { src = chrome.runtime.getURL('writer.html'); } catch { return; }
    const reading = new AbortController();
    v.reading = reading;
    v.bytes = pdfOf(v, reading.signal);
    v.bytes.catch((e) => { if (v.reading === reading) fail(v, String(e?.message || 'pdf').startsWith('pdf:') ? e.message : 'pdf'); });
    const origin = src.slice(0, src.indexOf('/', src.indexOf('://') + 3)).toLowerCase(); // as features/writer.js
    const f = Object.assign(document.createElement('iframe'), { className: 'gz-pv', title: v.file.name || X.t('PDF') });
    f.setAttribute('data-gz-preview', '');
    f.tabIndex = -1;
    const w = Math.round(v.bf.getBoundingClientRect().width) || 600;
    f.style.cssText = `display:block;border:0;width:${w}px;height:${HEIGHT};background:transparent;position:absolute;left:0;top:0;opacity:0;pointer-events:none`;
    const ch = new MessageChannel();
    v.gz = f;
    v.port = ch.port1;
    ch.port1.onmessage = ({ data }) => { if (v.gz === f && live(v) && data && typeof data.type === 'string') hear(v, data); };
    v.wait = setTimeout(() => { if (v.gz === f && !v.shown) fail(v, 'timeout'); }, SHOW);
    let offered = false, transferred = false;
    const hello = async (e) => {
      if (v.gz !== f || offered || e.source !== f.contentWindow || e.origin !== origin || e.data?.type !== 'glaze:writer:hello') return;
      offered = true;
      const pass = crypto.randomUUID();
      const ok = await Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'glaze:writer', op: 'job', pass })).then((r) => r?.ok === true, () => false);
      if (v.gz !== f || !live(v)) return;
      if (!ok || !f.isConnected) { fail(v, 'pass'); return; }
      try { f.contentWindow.postMessage({ type: 'glaze:writer', pass }, origin, [ch.port2]); transferred = true; } catch { fail(v, 'pass'); }
    };
    v.unhello = () => { removeEventListener('message', hello); if (!transferred) ch.port2.close(); };
    addEventListener('message', hello);
    // A second load is a frame that went elsewhere.
    f.addEventListener('load', () => { if (v.gz === f && offered) fail(v, 'navigated'); });
    f.src = `${src}?host=${encodeURIComponent(location.origin)}`;
    mark(v, 'loading');
    v.bf.after(f);
  };
  const ask = async (v) => {
    const r = await asked(v.file.viewer);
    if (!live(v) || v.ended) return;
    if (r?.ok && r.status === 'done') { v.answer = r; load(v); return; }
    if (r?.ok && r.status === 'converting' && Date.now() - v.since < FOR) { mark(v, 'converting'); v.timer = setTimeout(() => ask(v), EVERY); return; }
    fail(v, r?.error || (r ? 'converting' : 'timeout'));
  };
  const start = (bf) => {
    const v = { bf, src: bf.src, file: null, since: Date.now(), gz: null, port: null, timer: 0, wait: 0, shown: false, ended: '' };
    views.set(bf, v);
    try { v.file = fileOf(bf); } catch { v.file = null; }
    if (v.file) { mark(v, 'asking'); ask(v); } else v.ended = 'not a file';
  };

  const sync = () => {
    const ok = on();
    for (const v of [...views.values()]) {
      if (!ok || !v.bf.isConnected || v.bf.src !== v.src) drop(v);
      else if (v.gz && !v.gz.isConnected) fail(v, 'removed');
    }
    if (!ok) return;
    for (const bf of document.querySelectorAll(FRAMES)) if (!views.has(bf) && bf.src) start(bf);
  };
  // What a check reads: each preview's state.
  const state = () => [...views.values()].map((v) => ({ name: v.file?.name || '', shown: v.shown, loading: !!v.gz && !v.shown, ended: v.ended }));
  return { sync, state };
})();

GZ_BB_PREVIEW_UI;
