// Document buttons (enhance.toggles), loaded on demand: content.js loads this where they can appear (a course document
// with the switch on, or a file preview's frame), and calls sync() from its passes and esc() on every keydown.
// Round buttons in the bottom-right gutter, top frame only: dark documents while a file preview is on screen (dark
// palettes only), focus mode on a course document, with its reading time. Dark documents invert the preview's frame
// (extras.css), which works whatever its origin; where a frame is same-origin, its images and videos are turned back.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_DOCS = globalThis.GZ_DOCS || (() => {
  const ctx = globalThis.GZ_CTX;
  const ultra = ctx.site === 'ultra';
  const { t, typing, docButton, setVar, setDark, PREVIEWS, DOC } = ctx;
  const html = document.documentElement;
  const UNFLIP = 'img, video, picture, canvas { filter: invert(1) hue-rotate(180deg); }';
  const framesShown = new Set();
  const framesSeen = new WeakSet();
  let docTools = null;
  let focusAt = null; // the document focus mode is on for
  let focusPath = '';
  let readBar = null;
  const unflip = (f) => {
    if (!ultra) return; // Canvas viewers may contain annotations: invert the frame, never reach inside.
    try {
      const d = f.contentDocument;
      const old = d?.getElementById('gz-unflip');
      const on = html.matches('[data-gz-dark-theme][data-gz-enhance-docPages="dark"]'); // as extras.css
      if (!d?.documentElement || on === !!old) return;
      if (old) return old.remove();
      const s = d.createElement('style');
      s.id = 'gz-unflip';
      s.textContent = UNFLIP;
      d.documentElement.append(s);
    } catch { /* another origin */ }
  };
  // Ultra's file preview is Blackboard's document viewer, at an address holding a ticket good for about two minutes. Ultra
  // keeps the address it got with the page and opens the viewer with it whenever the preview is expanded, so later on the
  // viewer is refused and says the file can't be shown; one taken while an upload converts says so until a reload. Such a
  // frame gets a fresh address: a request that brought one (content-ultra.js notes them), asked again, and the same
  // document's address in the answer; while the file converts, asked again every 15 seconds for five minutes.
  const VIEWER = /^https:\/\/annotate[\w.-]*\.blackboard\.com\/ui\/pdf-viewer\//;
  const ticket = (src) => {
    try {
      const u = new URL(src);
      const j = JSON.parse(atob(u.searchParams.get('ticket').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return VIEWER.test(src) && typeof j.document_id === 'string' && j.document_id && Number.isFinite(j.exp) && { doc: j.document_id, exp: j.exp * 1000, done: u.searchParams.get('status') === 'complete' };
    } catch { return null; }
  };
  const renew = async (f, tries = 0) => {
    if (!f.isConnected || !ctx.on() || (typeof chrome !== 'undefined' && !chrome.runtime?.id)) return;
    const old = ticket(f.src);
    if (!old || (old.done && old.exp > Date.now() + 20000)) return;
    for (const url of [...new Set(globalThis.GZ_ASKS)].slice(0, 5)) { // newest first
      if (!url.startsWith(`${location.origin}/learn/api/`)) continue;
      const found = [];
      try {
        const r = await fetch(url, { credentials: 'same-origin', redirect: 'error', headers: { accept: 'application/json' } });
        // Wherever it is in the answer: a field, or an attachment in a document's HTML.
        if (r.ok) JSON.parse(await r.text(), (_, v) => { if (typeof v === 'string') for (const m of v.replace(/&quot;/g, '"').replace(/&amp;/g, '&').matchAll(/https:\/\/annotate[^"'\s<>\\]+/g)) found.push(m[0]); return v; });
      } catch { /* signed out, or not JSON */ }
      const src = found.find((s) => ticket(s)?.doc === old.doc);
      if (!f.isConnected || !ctx.on() || (typeof chrome !== 'undefined' && !chrome.runtime?.id)) return;
      if (!src) continue;
      if (ticket(src).done || old.exp < Date.now() + 20000) f.src = src; // a converting one only replaces an expired one
      break;
    }
    if (f.isConnected && !ticket(f.src)?.done && tries < 20) setTimeout(() => renew(f, tries + 1), 15000);
  };
  const onRead = () => {
    if (!readBar) return;
    let sc = ultra ? focusAt.parentElement : document.scrollingElement;
    if (!ultra) for (let p = focusAt.parentElement; p; p = p.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) { sc = p; break; }
    }
    // On <html>, outside the observed body: a style write on the bar would wake the sweep every scroll.
    setVar('--gz-read', GZ_PAGE.readShare(sc.scrollTop, sc.scrollHeight, sc.clientHeight));
  };
  const setFocus = (on) => {
    const doc = on && !(!ultra && document.querySelector('.ef-file-preview-overlay, #file-preview-modal-alert')) && document.querySelector(DOC);
    if ((doc || null) === focusAt) return;
    focusAt = doc || null;
    focusPath = focusAt ? location.pathname : '';
    html.toggleAttribute('data-gz-focus', !!focusAt);
    readBar?.remove();
    readBar = null;
    if (focusAt) {
      readBar = document.createElement('div');
      readBar.id = 'gz-read';
      readBar.setAttribute('aria-hidden', 'true');
      document.body.append(readBar);
      onRead();
    }
    sync();
    if (!ultra) docTools?.querySelector('[data-gz="focus"]')?.focus({ preventScroll: true });
  };
  const sync = () => {
    tellDocs();
    const on = ctx.solo && ctx.on() && ctx.settings().enhance.toggles;
    const doc = on && !(!ultra && document.querySelector('.ef-file-preview-overlay, #file-preview-modal-alert')) && document.querySelector(DOC);
    if (focusAt && (focusAt !== doc || focusPath !== location.pathname)) setFocus(false);
    for (const f of document.querySelectorAll(PREVIEWS)) {
      if (!framesSeen.has(f)) { framesSeen.add(f); frameIO.observe(f); f.addEventListener('load', () => unflip(f)); if (ultra) renew(f); }
      unflip(f);
    }
    for (const f of framesShown) if (!f.isConnected) { framesShown.delete(f); frameIO.unobserve(f); }
    const visible = [...framesShown].find((f) => f.isConnected && f.getClientRects().length);
    const dark = on && ctx.darkTheme() && !!visible;
    if (!doc && !dark) {
      docTools?.remove();
      docTools = null;
      html.removeAttribute('data-gz-doc-tools');
      return;
    }
    if (!docTools) {
      docTools = document.createElement('div');
      docTools.id = 'gz-doc-tools';
      docTools.setAttribute('role', 'toolbar');
      docTools.setAttribute('aria-label', t('Document'));
      const time = document.createElement('span');
      time.className = 'gz-doc-time';
      docTools.append(time, docButton('dark', t('Dark documents'), () => setDark({ plain: 'dim', dim: 'dark' }[ctx.settings().enhance.docPages] || 'plain')), docButton('focus', t('Focus mode'), () => setFocus(!focusAt)));
      document.body.append(docTools);
    }
    if (!ultra) {
      // In the reading flow (including a modal's flow), so neither content nor Canvas controls sit under it.
      const before = doc || visible?.closest('#doc_preview, .ef-file-preview-stretch, .file_preview') || visible;
      if (before && docTools.nextElementSibling !== before) before.before(docTools);
    }
    const [time, darkB, focusB] = docTools.children;
    const mins = focusAt && GZ_PAGE.readMinutes(ultra ? focusAt.querySelector('.bbml-editor')?.textContent : focusAt.textContent);
    time.hidden = !mins;
    // Only on change: a text write is itself a mutation the observer would hand back.
    const read = mins && t('{n} min read', { n: mins });
    if (mins && time.textContent !== read) time.textContent = read;
    darkB.hidden = !dark;
    darkB.setAttribute('aria-pressed', String(ctx.settings().enhance.docPages !== 'plain'));
    focusB.hidden = !doc;
    focusB.setAttribute('aria-pressed', String(!!focusAt));
    html.setAttribute('data-gz-doc-tools', '');
  };
  const frameIO = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) framesShown.add(e.target); else framesShown.delete(e.target);
    sync();
  });
  document.addEventListener('scroll', onRead, { capture: true, passive: true });
  // Esc leaves focus mode, and Ultra doesn't also act on it. An open menu or dialog gets its Esc as
  // usual. Focus inside a preview's frame keeps the key there; the button still works.
  const esc = (e) => {
    if (e.key !== 'Escape' || !focusAt || (!ultra && typing(e.target)) || (e.target instanceof Element && e.target.closest('[role="menu"], [role="dialog"], [role="listbox"]'))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setFocus(false);
  };
  // ---- Canvas's document viewer ----------------------------------------------------------------------------------
  // features/docviewer.js, in a canvadocs frame of this page, asks (content.js hands the message here) for the palette,
  // the switches, which file and whose (the frame's /api/v1/canvadoc_session blob names both; else this page's file),
  // and Glaze's words. Answered at that frame's origin only, never '*'; told again when any of it changes (every sync:
  // content.js calls it from applySettings and disable) and once the words are in.
  const docFrames = new Map(); // a DocViewer frame's window -> what tells it
  const tellDocs = () => { for (const [w, tell] of docFrames) if (w.closed) docFrames.delete(w); else tell(); };
  const ask = (e) => {
    const q = e.data;
    if (q?.gz !== 'docs?' || !/^https:\/\/canvadocs(-[\w-]+)?\.instructure\.com$/.test(e.origin)) return;
    const f = [...document.getElementsByTagName('iframe')].find((x) => x.contentWindow === e.source);
    if (!f) return;
    let b = {};
    try { b = JSON.parse(new URL(f.src, location.href).searchParams.get('blob')) || {}; } catch { /* another address */ }
    const id = (v) => (/^\d{1,20}$/.test(v) ? String(v) : '');
    const file = id(b.attachment_id) || id(location.pathname.match(/\/files\/(\d+)/)?.[1]) || id(new URLSearchParams(location.search).get('preview'));
    const asked = (Array.isArray(q.words) ? q.words : []).filter((w) => typeof w === 'string' && w.length < 100).slice(0, 40);
    // Whose marks: the blob's user, else Canvas is asked (your own /users/self/profile), only while annotations are on.
    // Signed out (401) is the site's "anon". Any other failure, a 403 for throttling or a forbidden read included, is
    // nobody for now (no marks, none moved to "anon" or anyone else) and is asked again after a pause that grows.
    let user = id(b.user_id) || null, asking = false, fails = 0;
    const whose = () => {
      if (user !== null || asking) return;
      asking = true;
      ctx.profile().then((p) => id(p?.id) || null, (s) => (s === 401 ? 'anon' : null)).then((u) => {
        if (u !== null) { user = u; tell(); return; }
        setTimeout(() => { asking = false; tell(); }, Math.min(300000, 15000 * 2 ** fails++));
      });
    };
    let said = '';
    // Only the frame's latest question is answered: a profile or the words arriving for an earlier one (another file in
    // the same frame) say nothing.
    const tell = () => {
      if (docFrames.get(e.source) !== tell) return;
      if (e.source.closed || ![...document.getElementsByTagName('iframe')].includes(f)) { docFrames.delete(e.source); ctx.wordsIn.delete(tell); return; }
      const s = ctx.settings().enhance;
      if (ctx.on() && s.docInk) whose(); // Glaze off: the frame is told so, and Canvas isn't asked who you are
      const msg = { gz: 'docs', on: ctx.on(), dark: ctx.darkTheme(), colors: Object.fromEntries([...GZ_COLORS.map(([v]) => v), '--gz-surface-course'].map((v) => [v, html.style.getPropertyValue(v)])),
        look: GZ_COURSE_LOOK(ctx.settings(), ultra ? ctx.courseId() : ctx.canvasCourseKey(), ctx.looks?.()).look, theme: s.docTheme, pages: s.docPages, ink: s.docInk, file, user: user || '', words: Object.fromEntries(asked.map((w) => [w, t(w)])) };
      const j = JSON.stringify(msg);
      if (j === said) return; // sync runs on every pass; the frame hears only changes
      said = j;
      try { e.source.postMessage(msg, e.origin); } catch { docFrames.delete(e.source); }
    };
    ctx.wordsIn.delete(docFrames.get(e.source));
    docFrames.set(e.source, tell);
    tell();
    ctx.wordsIn.add(tell);
  };
  return { sync, esc, ask };
})();

GZ_DOCS;
