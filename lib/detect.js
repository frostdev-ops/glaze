// Glaze — LMS detector. GZ_DETECT: which LMS a page is, by its own markup, as content.js knows each. Canvas: a stylesheet
// under /dist/brandable_css/ in its <head>. Moodle: its core's keywords meta ("moodle, <title>") and, as a page about Moodle
// may say that too, the page id and layout on <body>. Ultra: its <base> under /ultra/, on an /ultra page. → 'canvas',
// 'moodle', 'ultra', null (none, or Glaze is in the page), or undefined (not parsed far enough). Self-contained: the popup
// runs it in its tab (executeScript). As a content script (top frame, document_start, where the worker registers it) it
// watches the head as it's parsed and tells the background the LMS found (the tab and host come with the sender).
var GZ_DETECT = globalThis.GZ_DETECT || function () {
  const C = 'link[rel~="stylesheet"][href*="/dist/brandable_css/"]', U = 'base[href*="/ultra/"]';
  const hit = document.head?.querySelector(`${C}, ${U}, meta[name="keywords"][content^="moodle,"]`), body = document.body;
  if (!body && !hit?.matches(`${C}, ${U}`)) return;
  return (!window.__gzGlaze && hit && (hit.matches(C) ? 'canvas' : hit.matches(U) ? /^\/ultra(\/|$)/.test(location.pathname) && 'ultra'
    : body.matches('[id^="page-"][class*="pagelayout-"][class*="path-"]') && 'moodle')) || null;
};
if (/^https?:$/.test(location.protocol) && /html/.test(document.contentType)) (() => {
  const look = () => {
    const lms = GZ_DETECT();
    if (lms === undefined) return;
    mo.disconnect();
    document.removeEventListener('DOMContentLoaded', look);
    if (lms) chrome.runtime.sendMessage(lms, () => void chrome.runtime.lastError);
  };
  const mo = new MutationObserver(look);
  mo.observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', look);
  look();
})();
