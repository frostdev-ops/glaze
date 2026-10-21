// Glaze's settings as a page of the site (owner decision 2026-10-19): Settings (options.html) fills the page's room beside
// Glaze's navigation, the way any page of the LMS opens, and the bar marks it as where you are. Its frame sits in a closed
// shadow root, so the page's scripts can't read its address or reach into it. The page could still cover it and borrow a
// click, so Settings itself sends what holds keys and grants (Sharing, Mods, Backup) to its own tab (options.js, embedded).
// Leaving: its Close button, Escape, the browser's Back, or any place picked in the bar.
var GZ_SETTINGS_PAGE = globalThis.GZ_SETTINGS_PAGE || (() => {
  const html = document.documentElement;
  let host = null, frame = null, back = false, opener = null;
  const stilled = new Set(); // the page's elements made inert under it
  const wide = () => matchMedia('(min-width: 900px)').matches;
  // The page's room, as Glaze's navigation keeps it (theme.css and each site's sheet set the two variables).
  const fit = () => {
    if (!host) return;
    const s = host.style;
    s.setProperty('top', wide() ? 'var(--gz-navbar-top, 0px)' : '0px');
    s.setProperty('inset-inline-start', wide() ? 'var(--gz-navbar-left, 0px)' : '0px');
    s.setProperty('bottom', !wide() && html.getAttribute('data-gz-navbar') && !html.getAttribute('data-gz-navbar').includes('none') ? 'calc(84px + env(safe-area-inset-bottom, 0px))' : '0px');
  };
  // What opened it, through open shadow roots: the document sees only the bar's host, which can't take focus.
  const focused = () => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; };
  // The bar draws itself again as Settings opens and closes: what opened it is found there again by what it is.
  const again = (e) => {
    if (!e || e.isConnected) return e;
    const by = e.dataset?.id ? `[data-id="${CSS.escape(e.dataset.id)}"]` : e.dataset?.act ? `[data-act="${CSS.escape(e.dataset.act)}"]` : e.classList?.length ? `.${[...e.classList].map(CSS.escape).join('.')}` : '';
    return (by && [...(document.getElementById('gz-navbar')?.shadowRoot?.querySelectorAll(e.tagName + by) || [])].find((x) => x.getClientRects().length)) || null;
  };
  const onMessage = (e) => { if (frame && e.source === frame.contentWindow && e.data?.gzSettings === 'close') close(); };
  const onKey = (e) => { if (e.key === 'Escape' && host && !e.defaultPrevented) { e.preventDefault(); close(); } };
  // Back closes it, as it would leave a page: opening adds one history entry at the same address.
  const onPop = () => { if (host && !history.state?.gzSettings) { back = false; close(); } };
  const close = () => {
    if (!host) return;
    // Focus in Settings (or nowhere) goes back to what opened it; a place picked in the bar keeps it.
    const from = [host, document.body, null].includes(document.activeElement) ? opener : null;
    host.remove(); host = frame = opener = null;
    for (const e of stilled) e.inert = false;
    stilled.clear();
    html.removeAttribute('data-gz-settings');
    removeEventListener('message', onMessage); removeEventListener('keydown', onKey, true); removeEventListener('resize', fit); removeEventListener('popstate', onPop);
    if (back && history.state?.gzSettings) { back = false; history.back(); }
    globalThis.GZ_NAVBAR_UI?.sync();
    again(from)?.focus({ preventScroll: true });
  };
  // Settings shows itself in a frame only with a one-use ticket the worker gives this tab (lib/background.js).
  const ticket = () => new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'glaze:settings-ticket' }, (r) => res(chrome.runtime.lastError || !r?.ok ? '' : r.ticket)); } catch { res(''); } });
  const open = async (section = '') => {
    if (!chrome.runtime?.id) return false;
    const hash = /^[a-z]+(\/[a-z-]+)?$/.test(section) ? `#${section}` : '';
    if (host) { if (hash) frame.contentWindow?.postMessage({ gzSettings: 'go', hash }, '*'); frame.focus(); return true; }
    const from = focused();
    const t = await ticket();
    if (!/^[0-9a-f]{32}$/.test(t) || host) return !!host;
    opener = from;
    const url = `${chrome.runtime.getURL('options.html')}?t=${t}${hash}`;
    host = document.createElement('div');
    host.id = 'gz-settings-page';
    // Styled through the CSSOM: a school's style-src can refuse a <style>, never these.
    for (const [k, v] of [['all', 'initial'], ['position', 'fixed'], ['z-index', '1255'], ['inset-inline-end', '0px'], ['display', 'block'],
      ['background-color', 'var(--gz-surface, #0b1220)'], ['color-scheme', 'normal']]) host.style.setProperty(k, v);
    frame = document.createElement('iframe');
    frame.title = 'Glaze';
    frame.allow = 'clipboard-write';
    for (const [k, v] of [['display', 'block'], ['width', '100%'], ['height', '100%'], ['border', '0'], ['background', 'transparent']]) frame.style.setProperty(k, v);
    frame.src = url;
    host.attachShadow({ mode: 'closed' }).append(frame);
    fit();
    (document.body || html).append(host);
    // The page it covers is out of reach while it's open (Tab, a screen reader's reading); Glaze's bar stays in use.
    for (const e of (document.body || html).children) if (e !== host && e.id !== 'gz-navbar' && !e.inert) { e.inert = true; stilled.add(e); }
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
