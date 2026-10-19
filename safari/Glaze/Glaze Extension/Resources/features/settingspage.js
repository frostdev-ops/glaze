// Glaze's settings as a page of the site (owner decision 2026-10-19): Settings (options.html) fills the page's room beside
// Glaze's navigation, the way any page of the LMS opens, and the bar marks it as where you are. Its frame sits in a closed
// shadow root, so the page's scripts can't read its address or reach into it. The page could still cover it and borrow a
// click, so Settings itself sends what holds keys and grants (Sharing, Mods, Backup) to its own tab (options.js, embedded).
// Leaving: its Close button, Escape, the browser's Back, or any place picked in the bar.
var GZ_SETTINGS_PAGE = globalThis.GZ_SETTINGS_PAGE || (() => {
  const html = document.documentElement;
  let host = null, frame = null, back = false;
  const wide = () => matchMedia('(min-width: 900px)').matches;
  // The page's room, as Glaze's navigation keeps it (theme.css and each site's sheet set the two variables).
  const fit = () => {
    if (!host) return;
    const s = host.style;
    s.setProperty('top', wide() ? 'var(--gz-navbar-top, 0px)' : '0px');
    s.setProperty('inset-inline-start', wide() ? 'var(--gz-navbar-left, 0px)' : '0px');
    s.setProperty('bottom', !wide() && html.getAttribute('data-gz-navbar') && !html.getAttribute('data-gz-navbar').includes('none') ? 'calc(84px + env(safe-area-inset-bottom, 0px))' : '0px');
  };
  const onMessage = (e) => { if (frame && e.source === frame.contentWindow && e.data?.gzSettings === 'close') close(); };
  const onKey = (e) => { if (e.key === 'Escape' && host && !e.defaultPrevented) { e.preventDefault(); close(); } };
  // Back closes it, as it would leave a page: opening adds one history entry at the same address.
  const onPop = () => { if (host && !history.state?.gzSettings) { back = false; close(); } };
  const close = () => {
    if (!host) return;
    host.remove(); host = frame = null;
    html.removeAttribute('data-gz-settings');
    removeEventListener('message', onMessage); removeEventListener('keydown', onKey, true); removeEventListener('resize', fit); removeEventListener('popstate', onPop);
    if (back && history.state?.gzSettings) { back = false; history.back(); }
    globalThis.GZ_NAVBAR_UI?.sync();
  };
  const open = (section = '') => {
    if (!chrome.runtime?.id) return false;
    const url = chrome.runtime.getURL('options.html') + (/^[a-z]+(\/[a-z-]+)?$/.test(section) ? `#${section}` : '');
    if (host) { frame.src = url; frame.focus(); return true; }
    host = document.createElement('div');
    host.id = 'gz-settings-page';
    // Styled through the CSSOM: a school's style-src can refuse a <style>, never these.
    for (const [k, v] of [['all', 'initial'], ['position', 'fixed'], ['z-index', '1255'], ['inset-inline-end', '0px'], ['display', 'block'],
      ['background', 'var(--gz-surface-grain, none), var(--gz-ground, #0b1220)'], ['color-scheme', 'normal']]) host.style.setProperty(k, v);
    frame = document.createElement('iframe');
    frame.title = 'Glaze';
    frame.allow = 'clipboard-write';
    for (const [k, v] of [['display', 'block'], ['width', '100%'], ['height', '100%'], ['border', '0'], ['background', 'transparent']]) frame.style.setProperty(k, v);
    frame.src = url;
    host.attachShadow({ mode: 'closed' }).append(frame);
    fit();
    (document.body || html).append(host);
    html.setAttribute('data-gz-settings', '');
    addEventListener('message', onMessage); addEventListener('keydown', onKey, true); addEventListener('resize', fit); addEventListener('popstate', onPop);
    try { history.pushState({ ...(history.state || {}), gzSettings: true }, ''); back = true; } catch { back = false; }
    frame.focus();
    globalThis.GZ_NAVBAR_UI?.sync();
    return true;
  };
  return { open, close, isOpen: () => !!host };
})();

GZ_SETTINGS_PAGE;
