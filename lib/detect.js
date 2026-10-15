// Glaze — LMS detector. Content script, document_start, top frame, on every https page the manifest's
// Glaze entry doesn't already cover. Canvas and Moodle also run on schools' own domains, so no address gives
// them away; their pages do. Canvas: a render-blocking stylesheet under /dist/brandable_css/ in its <head>.
// Moodle: the keywords meta its core writes into every <head> ("moodle, <title>"), and, as a page about Moodle
// may say that too, the page id and layout Moodle puts on <body>. This watches the head as it is parsed and
// decides by <body>. A hit sends the background the LMS's name (it learns the tab and host from the sender),
// unless Glaze is already in the page: a registered script ran first.
(() => {
  if (!/html/.test(document.contentType)) return;
  const CANVAS = 'link[rel~="stylesheet"][href*="/dist/brandable_css/"]';
  const look = () => {
    const hit = document.head?.querySelector(`${CANVAS}, meta[name="keywords"][content^="moodle,"]`); // the head only
    const body = document.body;
    if (!body && !hit?.matches(CANVAS)) return;
    mo.disconnect();
    document.removeEventListener('DOMContentLoaded', look);
    const lms = hit && (hit.matches(CANVAS) ? 'canvas' : body.matches('[id^="page-"][class*="pagelayout-"][class*="path-"]') && 'moodle');
    if (lms && !window.__gzGlaze) chrome.runtime.sendMessage(lms, () => void chrome.runtime.lastError);
  };
  const mo = new MutationObserver(look);
  mo.observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', look);
  look();
})();
