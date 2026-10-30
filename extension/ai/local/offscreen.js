// Chrome's offscreen document for Glaze's own model (ai/local/link.js, reason WORKERS): the engine host (host.js) in a
// dedicated Worker, and a port named glaze:local to the extension's worker, each message passed on as it is. The port
// goes when the worker stops; the document stays with the weights loaded and connects again when the worker asks
// ('glaze:local-host'). The host's idle word closes the document: the worker closes it, or it closes itself.
(() => {
  const host = new Worker('host.js');
  let port = null, idleTimer = null;
  const connect = () => {
    clearTimeout(idleTimer); idleTimer = null;
    const p = chrome.runtime.connect({ name: 'glaze:local' });
    port = p;
    p.onMessage.addListener((m) => { if (port !== p) return; clearTimeout(idleTimer); idleTimer = null; host.postMessage(m); });
    p.onDisconnect.addListener(() => { if (port !== p) return; port = null; host.postMessage({ op: 'detach' }); });
  };
  host.onmessage = ({ data }) => {
    try { port?.postMessage(data); } catch { port = null; }
    if (data?.type === 'idle') { clearTimeout(idleTimer); idleTimer = setTimeout(() => close(), 2000); }
  };
  chrome.runtime.onMessage.addListener((m, sender) => {
    if (sender?.id === chrome.runtime.id && m?.type === 'glaze:local-host' && m.op === 'connect' && !port) connect();
  });
  connect();
})();
