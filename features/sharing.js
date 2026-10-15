var GZ_SHARING_UI = globalThis.GZ_SHARING_UI || (() => {
  const surface = () => {
    let p;
    try { p = chrome.runtime.connect({ name: 'glaze:sessions' }); } catch {}
    const online = () => { try { p?.postMessage({ online: true }); } catch {} };
    addEventListener('online', online);
    const close = () => { try { p?.disconnect(); } catch {} p = null; removeEventListener('pagehide', close); removeEventListener('online', online); };
    addEventListener('pagehide', close, { once: true });
    return close;
  };
  return { surface };
})();
GZ_SHARING_UI;
