// Glaze — Canvas detector. Content script, document_start, top frame, on every https page the manifest's
// Glaze entry doesn't already cover. Canvas also runs on schools' own domains, so no address gives it away;
// its <head> does: a render-blocking stylesheet under /dist/brandable_css/. This looks for that one <link>
// while the head is parsed and gives up at <body>. A hit sends the background an empty message (it learns
// the tab and host from the sender), unless Glaze is already in the page: a registered script ran first.
(() => {
  if (!/html/.test(document.contentType)) return;
  const MARK = 'link[rel~="stylesheet"][href*="/dist/brandable_css/"]';
  const look = () => {
    const hit = document.head?.querySelector(MARK); // the head only: a page's body says nothing
    if (!hit && !document.body) return;
    mo.disconnect();
    document.removeEventListener('DOMContentLoaded', look);
    if (hit && !window.__gzGlaze) chrome.runtime.sendMessage('canvas', () => void chrome.runtime.lastError);
  };
  const mo = new MutationObserver(look);
  mo.observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', look);
  look();
})();
