// Glaze's own pages as pages of the site (owner decisions 2026-10-19, 2026-10-29): Settings (options.html) or Documents
// (papers.html) fills the page's room beside Glaze's navigation, the way any page of the LMS opens, and the bar marks it as
// where you are. Its frame sits in a closed shadow root, so the page's scripts can't read its address or reach into it. The
// page could still cover it and borrow a click, so Settings itself sends what holds keys and grants (Sharing, Mods, Backup)
// to its own tab (options.js, embedded). Leaving: its Close button, Escape, the browser's Back, or any place picked in the bar.
// Documents opens a document in the same frame (papers.html?paper=). The frame replaces its address rather than adding to
// the tab's history, and this page adds the entry: a removed frame's own entries stay in Chrome's and Safari's history,
// where Back after leaving did nothing. So Back returns to the list, and leaving goes back past every entry it added.
var GZ_SETTINGS_PAGE = globalThis.GZ_SETTINGS_PAGE || (() => {
  const html = document.documentElement;
  const PAGES = { settings: 'options.html', papers: 'papers.html' };
  let host = null, root = null, frame = null, shown = '', back = false, opener = null, port = null, spare = '', hellos = 0, turn = 0, going = false, resent = false;
  // Where Documents was, by each entry it added (history.state.gzAt): the page's scripts can read history.state, so the
  // address of the document opened stays here.
  const visits = [];
  // The page under it, children of <body> and <html> alike and what comes while it's open: out of reach (Tab, a screen
  // reader's reading, the pointer) and unseen. An overlay of the page's, Glaze's own too (the pet's world, the sidebar's
  // buttons, floating tiles), drew over Settings from above its z-index and took its clicks. Glaze's bar stays in use.
  const stilled = new Set(); // made inert here
  const veiled = new Map(); // made unseen here: its own opacity, to put back
  const still = (e) => {
    if (!e?.tagName || e === host || e === document.body || e === document.head || e.id === 'gz-navbar') return;
    if (!e.inert) { e.inert = true; stilled.add(e); }
    if (e.style && !veiled.has(e)) {
      veiled.set(e, [e.style.getPropertyValue('opacity'), e.style.getPropertyPriority?.('opacity') || '', e.hasAttribute('style')]);
      e.style.setProperty('opacity', '0', 'important');
    }
  };
  const watch = typeof MutationObserver === 'function' ? new MutationObserver((ms) => { if (host) for (const m of ms) for (const n of m.addedNodes) if (n.parentNode === m.target) still(n); }) : null;
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
  // Glaze's own origin, spelled out (URL.origin of an extension scheme is "null" in some engines) and lowercase, as a
  // frame's is: Safari's getURL keeps its UUID uppercase.
  const ORIGIN = (() => { try { const u = chrome.runtime.getURL(''); return u.slice(0, u.indexOf('/', u.indexOf('://') + 3)).toLowerCase(); } catch { return ''; } })();
  // History entries this page added: gzSettings counts them (1, the page itself), gzPage says which page, gzAt where Documents was.
  const mark = (n, page, at = '') => {
    const s = { ...(history.state || {}), gzSettings: n, gzPage: page };
    delete s.gzAt;
    if (at) s.gzAt = visits.push(at) - 1;
    return s;
  };
  const depth = () => Math.max(1, Number(history.state?.gzSettings) || 1);
  const where = () => visits[history.state?.gzAt] ?? '';
  // Back or Forward within Documents: the frame goes where the entry says. Sent to a document already going, it is lost, so
  // `going` holds until the frame says it is there.
  const go = () => { going = true; port?.postMessage({ type: 'go', at: where() }); };
  // Documents' frame, from its own document: it is at `at` (its query: '' for the list, '?paper=…' for a document), or asks
  // to leave. Somewhere else after a link of its own is a page of its own in the tab's history. After Back or Forward it is
  // sent on once more; still elsewhere (a document deleted since shows the list), the entry says where it is.
  const heard = (data) => {
    if (data?.type === 'leave') { close(); return; }
    if (data?.type !== 'opened' || typeof data.at !== 'string' || data.at.length > 600 || !back || history.state?.gzPage !== 'papers') return;
    try {
      if (data.at === where()) going = resent = false;
      else if (going && !resent) { resent = true; go(); }
      else if (going) { going = resent = false; history.replaceState(mark(depth(), 'papers', data.at), ''); }
      else history.pushState(mark(depth() + 1, 'papers', data.at), '');
    } catch { /* the tab keeps its entries */ }
  };
  // Each document Documents' frame loads says hello (publicly, as Writer's does) and gets a one-use pass, which the worker
  // trusts its writes for, and this page's end of a MessageChannel. Whatever end the frame took is the one it answers on.
  const greet = async (f) => {
    const n = ++hellos;
    let pass = spare;
    spare = '';
    if (!pass) pass = await job();
    if (frame !== f || n !== hellos || !pass) return;
    const ch = new MessageChannel();
    ch.port1.onmessage = ({ data }) => { if (frame !== f) return; port = ch.port1; heard(data); };
    port = ch.port1;
    try { f.contentWindow.postMessage({ type: 'glaze:papers', pass }, ORIGIN, [ch.port2]); } catch { /* the frame went */ }
  };
  const onMessage = (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    if (shown === 'settings' && e.data?.gzSettings === 'close') close();
    else if (shown === 'papers' && e.origin === ORIGIN && e.data?.type === 'glaze:papers:hello') greet(frame);
  };
  const onKey = (e) => { if (e.key === 'Escape' && host && !e.defaultPrevented) { e.preventDefault(); close(); } };
  // Back leaves it, as it would leave a page; within Documents it goes where the entry says (the list, a document), and
  // between Glaze's pages to the one it was.
  const onPop = () => {
    if (!host) return;
    const s = history.state;
    if (!s?.gzSettings) { back = false; close(); return; }
    const page = s.gzPage === 'papers' ? 'papers' : 'settings';
    if (page !== shown) swap(page, { at: where() });
    else if (page === 'papers') { resent = false; go(); }
  };
  const close = () => {
    if (!host) return;
    // Focus in Settings (or nowhere) goes back to what opened it; a place picked in the bar keeps it.
    const from = [host, document.body, null].includes(document.activeElement) ? opener : null;
    host.remove(); host = root = frame = opener = port = null; shown = spare = ''; turn++; going = resent = false;
    watch?.disconnect();
    for (const e of stilled) e.inert = false;
    stilled.clear();
    for (const [e, [value, priority, had]] of veiled) {
      if (value) e.style.setProperty('opacity', value, priority); else e.style.removeProperty('opacity');
      if (!had && !e.style.length) e.removeAttribute('style');
    }
    veiled.clear();
    html.removeAttribute('data-gz-settings');
    removeEventListener('message', onMessage); removeEventListener('keydown', onKey, true); removeEventListener('resize', fit); removeEventListener('popstate', onPop);
    if (back && history.state?.gzSettings) { const n = depth(); back = false; if (n > 1) history.go(-n); else history.back(); }
    globalThis.GZ_NAVBAR_UI?.sync();
    again(from)?.focus({ preventScroll: true });
  };
  // Settings shows itself in a frame only with a one-use ticket the worker gives this tab (lib/background.js), in its address;
  // Documents with a pass for each document, sent to it after its hello (greet).
  const ticket = () => new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'glaze:settings-ticket' }, (r) => res(chrome.runtime.lastError || !r?.ok || !/^[0-9a-f]{32}$/.test(r.ticket) ? '' : r.ticket)); } catch { res(''); } });
  const job = () => { const pass = crypto.randomUUID(); return Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'glaze:papers', op: 'job', pass })).then((r) => (r?.ok === true ? pass : ''), () => ''); };
  const passFor = (page) => (page === 'settings' ? ticket() : job());
  // The page's frame in the host, in place of the other page's: Settings at a section, Documents at the list or a document.
  const show = (page, pass, { hash = '', at = '' } = {}) => {
    frame?.remove();
    port = null; hellos++; going = resent = false;
    frame = document.createElement('iframe');
    frame.title = 'Glaze';
    frame.allow = 'clipboard-write';
    for (const [k, v] of [['display', 'block'], ['width', '100%'], ['height', '100%'], ['border', '0'], ['background', 'transparent']]) frame.style.setProperty(k, v);
    frame.src = page === 'settings' ? `${chrome.runtime.getURL(PAGES.settings)}?t=${pass}${hash}` : `${chrome.runtime.getURL(PAGES.papers)}${/^\?paper=[^#]*$/.test(at) ? at : ''}`;
    shown = page;
    spare = page === 'papers' ? pass : '';
    root.append(frame);
  };
  const swap = async (page, at) => {
    const n = ++turn, pass = await passFor(page);
    if (n !== turn || !host) return;
    if (!pass) { close(); return; }
    show(page, pass, at);
    frame.focus();
    globalThis.GZ_NAVBAR_UI?.sync();
  };
  const open = async (section = '', page = 'settings') => {
    if (!chrome.runtime?.id || !Object.hasOwn(PAGES, page)) return false;
    const hash = page === 'settings' && /^[a-z][a-z-]*(\/[a-z-]+)?$/.test(section) ? `#${section}` : '';
    if (host && shown === page) { if (hash) frame.contentWindow?.postMessage({ gzSettings: 'go', hash }, '*'); frame.focus(); return true; }
    const from = focused(), n = ++turn;
    const pass = await passFor(page);
    if (n !== turn) return true; // something since (another open, leaving) said where to be
    if (!pass) return false;
    // The other of Glaze's pages is open: this one takes its place, as a page of its own in the tab's history.
    if (host) {
      show(page, pass, { hash });
      if (back) try { history.pushState(mark(depth() + 1, page), ''); } catch { /* the entry stays as it was */ }
      frame.focus();
      globalThis.GZ_NAVBAR_UI?.sync();
      return true;
    }
    opener = from;
    host = document.createElement('div');
    host.id = 'gz-settings-page';
    // Styled through the CSSOM: a school's style-src can refuse a <style>, never these.
    for (const [k, v] of [['all', 'initial'], ['position', 'fixed'], ['z-index', '1255'], ['inset-inline-end', '0px'], ['display', 'block'],
      ['background-color', 'var(--gz-surface, #0b1220)'], ['color-scheme', 'normal']]) host.style.setProperty(k, v);
    root = host.attachShadow({ mode: 'closed' });
    show(page, pass, { hash });
    fit();
    (document.body || html).append(host);
    for (const e of [...(document.body || html).children, ...html.children]) still(e);
    for (const t of new Set([document.body || html, html])) watch?.observe(t, { childList: true });
    html.setAttribute('data-gz-settings', '');
    addEventListener('message', onMessage); addEventListener('keydown', onKey, true); addEventListener('resize', fit); addEventListener('popstate', onPop);
    try { history.pushState(mark(1, page), ''); back = true; } catch { back = false; }
    frame.focus();
    globalThis.GZ_NAVBAR_UI?.sync();
    return true;
  };
  // Which of Glaze's pages is open here: 'settings', 'papers' (Documents) or ''.
  return { open, close, isOpen: () => !!host, showing: () => (host ? shown : '') };
})();

GZ_SETTINGS_PAGE;
