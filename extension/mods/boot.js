// Glaze's bootstrap for a mod's frame UI. mods/host.js makes each frame UI's srcdoc with this as
// its only script, and the sandbox CSP runs no inline script, so this runs before anything of the mod's, and is the only
// way code starts anywhere in the frame or in frames the mod nests. It takes every RTC* global away (WebRTC sends packets
// past connect-src; the 2026-10-16 spike measured zero after this), then boots once, for its parent only (the LMS page can
// get a handle to this frame once a mod posts to it), and runs what the parent sends over the port it handed over: Glaze's
// client, which then runs the mod's code.
(() => {
  for (const k of Object.getOwnPropertyNames(globalThis)) {
    if (/^(webkit)?rtc/i.test(k)) try { Object.defineProperty(globalThis, k, { value: undefined, writable: false, configurable: false }); } catch { /* checked below */ }
  }
  // One that couldn't be taken away: this frame never boots.
  const open = Object.getOwnPropertyNames(globalThis).some((k) => /^(webkit)?rtc/i.test(k) && globalThis[k] !== undefined);
  let booted = false;
  const boot = (e) => {
    if (booted || open || e.source !== parent || e.data?.type !== 'glaze:boot' || e.ports?.length !== 1) return;
    booted = true;
    removeEventListener('message', boot);
    const port = e.ports[0];
    port.onmessage = (m) => {
      port.onmessage = null;
      try { (0, eval)(m.data.client)(port); } catch (err) { port.postMessage({ error: String(err?.message || err) }); }
    };
  };
  addEventListener('message', boot);
})();
