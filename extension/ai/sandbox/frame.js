// run_js's host side (docs/ai-harness.md "Rime's own tools"): frames ai/sandbox/js.html, hidden, inside a closed shadow root
// when it runs in a school's page (as mods/page/mods.js frames its host), hands it one port with a one-use nonce on its first
// load, and runs code there: run(code) → { ok, value, logs, error?, cut?, ms }. A frame that loads again (something
// navigated it) is never trusted again: the next run makes a new one. Each answer is waited for at most WAIT ms past the
// sandbox's own stop. available(): whether this build has the sandbox page (Chrome's; Firefox and Safari's do not).
// Classic script, loaded on demand (Ask Rime's panel, in integration); a second injection keeps the first.
var GZ_AI_RIME_FRAME = globalThis.GZ_AI_RIME_FRAME || (() => {
  const PAGE = 'ai/sandbox/js.html', WAIT = 1500, MS = 2000;
  const api = () => globalThis.chrome?.runtime || globalThis.browser?.runtime;
  const available = () => { try { return (api().getManifest().sandbox?.pages || []).includes(PAGE); } catch { return false; } };
  let host = null, seq = 0, queue = Promise.resolve();
  const nonce = () => { const b = new Uint8Array(24); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const drop = () => {
    if (!host) return;
    const h = host; host = null;
    h.finishReady(false);
    for (const [, w] of h.waiting) w({ ok: false, value: null, logs: [], error: 'The sandbox closed.' });
    h.waiting.clear(); h.port.close(); h.mount.remove();
  };
  const wait = (promise, ms, fallback) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then((r) => { clearTimeout(timer); resolve(r); });
  });
  const start = () => {
    const mount = document.createElement('div'), frame = document.createElement('iframe'), { port1, port2 } = new MessageChannel(), n = nonce(), proof = nonce();
    mount.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;border:0;';
    frame.style.cssText = 'width:0;height:0;border:0;';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // In an extension page there is no page to hide from; in a school's page, a closed shadow root keeps its script out.
    (location.protocol.endsWith('-extension:') ? mount : mount.attachShadow({ mode: 'closed' })).append(frame);
    const h = { mount, port: port1, waiting: new Map(), loads: 0, authenticated: false };
    let ready;
    h.ready = new Promise((r) => { ready = r; });
    h.finishReady = ready;
    port1.onmessage = (e) => {
      const d = e.data || {};
      // Only the sandbox that read the second secret from its URL can answer. A replacement document sees n in
      // the transfer but never proof; neither secret is broadcast through the school's window messages.
      if (d.ready === true) { if (d.nonce === proof) { h.authenticated = true; ready(true); } return; }
      if (!h.authenticated) return;
      const w = h.waiting.get(d.id);
      if (w) { h.waiting.delete(d.id); w(d); }
    };
    frame.addEventListener('load', () => {
      if (++h.loads === 1) frame.contentWindow.postMessage({ type: 'glaze:rime-js', nonce: n }, '*', [port2]);
      else if (host === h) drop();
    });
    frame.src = `${api().getURL(PAGE)}#${n}.${proof}`;
    document.documentElement.append(mount);
    return h;
  };
  const runOne = async (code) => {
    if (!available()) return { ok: false, value: null, logs: [], error: 'unavailable' };
    if (!host) host = start();
    const h = host, id = ++seq;
    if (await wait(h.ready, 5000, false) !== true || host !== h) { if (host === h) drop(); return { ok: false, value: null, logs: [], error: 'The sandbox did not start.' }; }
    const answer = new Promise((r) => h.waiting.set(id, r));
    try { h.port.postMessage({ id, code }); } catch { if (host === h) drop(); }
    const timeout = { ok: false, value: null, logs: [], error: 'The sandbox did not answer.' };
    const r = await wait(answer, MS + WAIT, timeout);
    h.waiting.delete(id);
    if (r === timeout && host === h) drop();
    return r;
  };
  const run = (code) => { const p = queue.then(() => runOne(code)); queue = p.catch(() => {}); return p; };
  return { PAGE, available, run, stop: drop };
})();
