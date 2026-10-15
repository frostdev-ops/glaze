var GZ_SHARING_UI = globalThis.GZ_SHARING_UI || (() => {
  const surface = () => {
    let p;
    try { p = chrome.runtime.connect({ name: 'glaze:sessions' }); } catch {}
    const close = () => { try { p?.disconnect(); } catch {} p = null; removeEventListener('pagehide', close); };
    addEventListener('pagehide', close, { once: true });
    return close;
  };
  return { surface };
})();
GZ_SHARING_UI;
