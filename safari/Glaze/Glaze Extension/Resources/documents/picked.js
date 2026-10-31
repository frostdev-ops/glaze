// Safari's From Google Drive comes back here (background/google.js pick, native): the picker page leaves its answer (the
// state, then the files picked or a cancel) in this page's fragment. The address goes to the worker, which checks it is
// the pick under way in this tab, then closes the tab. The fragment leaves the address bar at once. Nothing else.
(() => {
  const url = location.href;
  history.replaceState(null, '', location.pathname);
  chrome.runtime.sendMessage({ type: 'glaze:google', op: 'back', url }).catch(() => {});
})();
