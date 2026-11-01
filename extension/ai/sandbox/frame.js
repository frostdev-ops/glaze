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
  let host = null, seq = 0;
  const nonce = () => { const b = new Uint8Array(24); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const drop = () => { if (!host) return; for (const [, w] of host.waiting) w({ ok: false, value: null, logs: [], error: 'The sandbox closed.' }); host.mount.remove(); host = null; };
  const start = () => {
    const mount = document.createElement('div'), frame = document.createElement('iframe'), { port1, port2 } = new MessageChannel(), n = nonce();
    mount.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;border:0;';
    frame.style.cssText = 'width:0;height:0;border:0;';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // In an extension page there is no page to hide from; in a school's page, a closed shadow root keeps its script out.
    (location.protocol.endsWith('-extension:') ? mount : mount.attachShadow({ mode: 'closed' })).append(frame);
    const h = { mount, port: port1, waiting: new Map(), loads: 0 };
    let ready;
    h.ready = new Promise((r) => { ready = r; });
    port1.onmessage = (e) => {
      const d = e.data || {};
      if (d.ready === true) return ready(true);
      const w = h.waiting.get(d.id);
      if (w) { h.waiting.delete(d.id); w(d); }
    };
    frame.addEventListener('load', () => {
      if (++h.loads === 1) frame.contentWindow.postMessage({ type: 'glaze:rime-js', nonce: n }, '*', [port2]);
      else if (host === h) drop();
    });
    frame.src = `${api().getURL(PAGE)}#${n}`;
    document.documentElement.append(mount);
    return h;
  };
  const run = async (code) => {
    if (!available()) return { ok: false, value: null, logs: [], error: 'unavailable' };
    if (!host) host = start();
    const h = host, id = ++seq;
    const late = (ms) => new Promise((r) => setTimeout(r, ms, { ok: false, value: null, logs: [], error: 'The sandbox did not answer.' }));
    if (await Promise.race([h.ready, late(5000)]) !== true) { if (host === h) drop(); return { ok: false, value: null, logs: [], error: 'The sandbox did not start.' }; }
    const answer = new Promise((r) => h.waiting.set(id, r));
    h.port.postMessage({ id, code });
    const r = await Promise.race([answer, late(MS + WAIT)]);
    h.waiting.delete(id);
    return r;
  };
  return { PAGE, available, run, stop: drop };
})();
