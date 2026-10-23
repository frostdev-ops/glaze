// Glaze's Allow frame (an extension page; features/download.js shows it in a Canvas module's header when Download all meets a
// file server Glaze doesn't hold): one button for the host after #. Its click asks the browser for that host alone, and the
// answer goes to the page around it, which asks the worker for the file again (the worker checks the grant itself, so a page
// that frames this on its own gains nothing but the browser's prompt). Copy: the button.
(() => {
  const t = (key, vars) => GZ_I18N.t(key, vars, GZ_I18N.ui());
  let host = '';
  try { host = decodeURIComponent(location.hash.slice(1)); } catch { /* not a host */ }
  const button = document.getElementById('allow');
  // A plain public host name, as the worker writes it: no scheme, port, path, wildcard or address.
  if (!/^(?=.{4,253}$)([a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z][a-z\d-]{0,62}$/.test(host)) { button.hidden = true; return; }
  const tell = (m) => parent.postMessage({ gzAllow: host, ...m }, '*');
  button.textContent = t('Allow {host}', { host });
  let asking = false;
  button.addEventListener('click', (e) => {
    if (!e.isTrusted || asking) return;
    asking = true;
    button.setAttribute('aria-disabled', 'true');
    // In the click's own task: the browser's prompt needs it.
    new Promise((res) => res(chrome.permissions.request({ origins: [`https://${host}/*`] })))
      .then((yes) => tell({ ok: yes === true }), () => tell({ ok: false }));
  });
  // Its size, for the page to fit the frame to the button.
  requestAnimationFrame(() => tell({ size: [document.body.scrollWidth, document.body.scrollHeight] }));
})();
