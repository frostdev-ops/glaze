// Glaze's Allow frame (an extension page; features/download.js shows it in a Canvas module's header when Download all meets a
// file server Glaze doesn't hold): one button for the host after #. Its click asks the browser for that host alone, and the
// answer goes to the page around it, which asks the worker for the file again (the worker checks the grant itself, so a page
// that frames this on its own gains nothing but the browser's prompt). Copy: the button.
// Where the frame has no permissions API (Firefox gives an extension page framed in a web page none), its click has the worker
// open this page in a tab of its own (lib/background.js, glaze:allow-tab): there the same button asks, the worker hears it
// was answered, checks the grant, tells the frame and closes the tab.
(() => {
  const t = (key, vars) => GZ_I18N.t(key, vars, GZ_I18N.ui());
  let host = '';
  try { host = decodeURIComponent(location.hash.slice(1)); } catch { /* not a host */ }
  const button = document.getElementById('allow');
  // A plain public host name, as the worker writes it: no scheme, port, path, wildcard or address.
  if (!/^(?=.{4,253}$)([a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z][a-z\d-]{0,62}$/.test(host)) { button.hidden = true; return; }
  const origins = [`https://${host}/*`];
  button.textContent = t('Allow {host}', { host });
  let asking = false;
  const once = (e) => {
    if (!e.isTrusted || asking) return false;
    asking = true;
    button.setAttribute('aria-disabled', 'true');
    return true;
  };
  if (globalThis.top === globalThis) {
    document.documentElement.setAttribute('data-tab', '');
    button.focus();
    // In the click's own task: the browser's prompt needs it. Whatever came back, the worker looks at the grant itself.
    button.addEventListener('click', (e) => {
      if (!once(e)) return;
      new Promise((res) => res(chrome.permissions.request({ origins }))).catch(() => false)
        .then(() => chrome.runtime.sendMessage({ type: 'glaze:allow-answer', host })).catch(() => {});
    });
    return;
  }
  let port;
  const tell = (m) => port?.postMessage({ gzAllow: host, ...m });
  addEventListener('message', (e) => {
    if (port || e.data?.gzAllow !== host || !e.ports?.[0]) return;
    port = e.ports[0];
    requestAnimationFrame(() => tell({ size: [document.body.scrollWidth, document.body.scrollHeight] }));
  });
  const ask = () => (typeof chrome.permissions?.request === 'function' ? chrome.permissions.request({ origins })
    : chrome.runtime.sendMessage({ type: 'glaze:allow-tab', host }).then((r) => r?.ok === true));
  button.addEventListener('click', (e) => {
    if (!once(e)) return;
    // In the click's own task: the browser's prompt needs it.
    new Promise((res) => res(ask())).then((yes) => tell({ ok: yes === true }), () => tell({ ok: false }));
  });
})();
