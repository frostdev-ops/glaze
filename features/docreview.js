// Read-only submission review. Native nodes stay in place; only owned attributes and controls are removed on restore.
var GZ_DOCREVIEW = globalThis.GZ_DOCREVIEW || (() => {
  const pathOK = (site, path) => site === 'ultra'
    ? /^\/ultra\/courses\/_\d+_\d+\/assessment\/_\d+_\d+\/overview\/student-submission-view\/?$/.test(path)
    : site === 'canvas' && /^\/courses\/\d+\/assignments\/\d+\/submissions\/\d+\/?$/.test(path);
  const owned = (e) => !!e.closest?.('[data-gz-review-ui]');
  const unsafe = (root) => [...root.querySelectorAll('input, textarea, select, [contenteditable], button, [role="button"], a[href]')].some((e) => !owned(e) && (
    e.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""], button[type="submit"]')
    || /(?:^|[\s_-])(submit|save|resubmit|attempt|grading)(?:[\s_-]|$)/i.test(`${e.id} ${e.className} ${e.getAttribute('data-testid') || ''} ${e.textContent} ${e.getAttribute('aria-label') || ''}`)));
  const one = (root, sel) => { const es = root.querySelectorAll(sel); return es.length === 1 ? es[0] : null; };
  const childOf = (el, root) => { while (el && el.parentElement !== root) el = el.parentElement; return el; };
  const recognize = (doc, site, path) => {
    if (!pathOK(site, path)) return null;
    if (site === 'canvas') {
      const root = doc.getElementById('content'), header = root && one(root, '.submission-details-header');
      const pane = root && one(root, '.submission-details-frame'), frame = pane && one(pane, 'iframe#preview_frame');
      if (!header || !frame || !one(header, '.submission-details-header__grade-summary') || !one(header, '.submission-details-header__time')) return null;
      // Canvas's local preview can be a download-only page. Only a real canvadocs embed qualifies.
      let inner, innerURL, url;
      try { url = new URL(frame.getAttribute('src'), doc.location.href); inner = frame.contentDocument?.querySelector('iframe[src*="canvadoc_session"]'); } catch { /* cross-origin */ }
      try { if (inner) innerURL = new URL(inner.getAttribute('src'), doc.location.href); } catch { /* malformed viewer */ }
      const direct = url?.protocol === 'https:' && /^canvadocs(?:-[a-z]+)?\.instructure\.com$/.test(url.hostname);
      if (!direct && !(url?.origin === doc.location.origin && innerURL?.origin === doc.location.origin && innerURL.pathname === '/api/v1/canvadoc_session')) return null;
      // Fullscreen remains safe beside comment/resubmission forms; layout and focus changes require a read-only page.
      return { root, pane, frame, heading: one(header, 'h1'), grade: header, tabs: pane, canvas: true, comments: one(root, '.submission-details-comments'), limited: unsafe(root), src: url.href };
    }
    const root = one(doc, 'student-view-submission-panel, .student-view-submission-panel');
    if (!root || unsafe(root)) return null;
    const main = one(root, 'main'), section = main && one(main, 'section'), aside = main && one(main, 'aside');
    const rubric = aside && one(aside, '.rubric-inline-container');
    const feedback = section && one(section, '.js-overall-feedback');
    const panels = section && [...section.querySelectorAll('[role="tabpanel"]')].filter((e) => e.id.startsWith('files-viewer-tab-panel-') && !e.hidden && e.getAttribute('aria-hidden') !== 'true');
    const pane = panels?.length === 1 && panels[0], frame = pane && one(pane, 'iframe');
    let url; try { url = new URL(frame?.getAttribute('src')); } catch { return null; }
    if (!main || section.parentElement !== main || aside?.parentElement !== main || !rubric || !feedback || !frame
      || url.origin !== 'https://annotate-us.foundations.blackboard.com' || !/^\/ui\/pdf-viewer\/[^/]+\/index\.html$/.test(url.pathname)) return null;
    const files = childOf(pane, section), feed = childOf(feedback, section), grade = main.previousElementSibling;
    const tabs = files && one(files, '[role="tablist"]');
    // The title sits before the scrolling body; the grade row sits immediately before main.
    let title = null;
    for (let el = main.parentElement; el && el !== root; el = el.parentElement) {
      const prev = el.previousElementSibling;
      if (prev?.querySelector('h1, h2, [role="heading"]') && one(prev, 'button, a[aria-label]')) { title = prev; break; }
    }
    const heading = title && one(title, 'h1, h2, [role="heading"]'), close = title && one(title, 'button, a[aria-label]');
    const text = feed && [...feed.children].find((e) => e !== feedback && !e.contains(feedback) && !owned(e));
    if (!files || !feed || files === feed || !grade || !tabs || !heading || !close || !text || !grade.textContent.trim()) return null;
    return { root, main, section, aside, rubric, feedback, feed, text, files, tabs, pane, frame, grade, title, heading, close, src: url.href };
  };
  const sheet = (doc) => {
    if (doc.getElementById('gz-review-css')) return;
    const el = doc.createElement('link'); el.id = 'gz-review-css'; el.rel = 'stylesheet';
    el.href = chrome.runtime.getURL('features/docreview.css'); doc.head.append(el);
  };
  const relayable = (e, origin, source, current) => e.origin === origin && e.source === source && current === true
    && !Array.isArray(e.data) && e.data?.gzCtab === 'review' && typeof e.data.on === 'boolean' && Object.keys(e.data).length === 2;
  let chromeOff = null;
  const restoreChrome = () => { chromeOff?.(); chromeOff = null; };
  const chromeBars = (on, guard) => {
    restoreChrome();
    if (!on) return;
    const doc = document, html = doc.documentElement;
    if (guard && !guard.current()) return;
    sheet(doc);
    const button = doc.createElement('button'); button.type = 'button'; button.id = 'gz-review-bars'; button.setAttribute('data-gz-review-ui', '');
    button.textContent = globalThis.GZ_CTX?.t('Show Glaze bars') || 'Show Glaze bars';
    const off = () => { html.removeAttribute('data-gz-review-immersive'); button.remove(); observer.disconnect(); guard?.el.removeEventListener('load', restoreChrome); removeEventListener('pagehide', restoreChrome); removeEventListener('popstate', restoreChrome); removeEventListener('keydown', key); dispatchEvent(new Event('resize')); };
    const reveal = () => { restoreChrome(); if (guard) { try { guard.el.contentWindow.postMessage({ gzCtab: 'review:shown' }, location.origin); } catch { /* gone */ } } else ui?.barsShown(); };
    const key = (e) => { if (e.key === 'Escape') reveal(); };
    button.addEventListener('click', reveal); button.addEventListener('pointerenter', reveal);
    const observer = new MutationObserver(() => { if (guard && !guard.current()) restoreChrome(); });
    observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'inert'] });
    guard?.el.addEventListener('load', restoreChrome); addEventListener('pagehide', restoreChrome); addEventListener('popstate', restoreChrome); addEventListener('keydown', key);
    chromeOff = off; doc.body.append(button); html.setAttribute('data-gz-review-immersive', ''); dispatchEvent(new Event('resize'));
  };
  const create = (ctx, doc = document, win = window) => {
    const html = doc.documentElement, t = ctx.t;
    let enabled = true, active = null, marks = [], nodes = [], focus = false, expanded = false, rubric = false, details = false, previous = null, watching = false, observer, pending = false, remembered = false, bars = true, page = '';
    const settings = () => ctx.settings().docreview;
    const visible = () => !globalThis.GZ_CTABS || GZ_CTABS.visible();
    const mark = (el, part) => { if (!el) return; el.setAttribute('data-gz-review-part', part); marks.push(el); };
    const add = (tag, parent, label, action) => {
      const el = doc.createElement(tag); el.setAttribute('data-gz-review-ui', '');
      if (tag === 'button') { el.type = 'button'; el.textContent = t(label); el.setAttribute('aria-label', t(label)); el.addEventListener('click', action); }
      parent.append(el); nodes.push(el); return el;
    };
    const immersive = (on) => {
      if (ctx.tabFrame) { try { win.top.postMessage({ gzCtab: 'review', on: !!on }, win.location.origin); } catch { /* gone */ } }
      else chromeBars(on);
    };
    const remember = (on) => { if (settings()?.remember) try { win.sessionStorage.setItem(`gz-review:${win.location.pathname}`, on ? '1' : '0'); } catch { /* blocked */ } };
    const stripState = () => {
      html.toggleAttribute('data-gz-review-rubric', focus && rubric); html.toggleAttribute('data-gz-review-details', focus && details);
      doc.getElementById('gz-review-rubric')?.setAttribute('aria-expanded', String(rubric)); doc.getElementById('gz-review-details')?.setAttribute('aria-expanded', String(details));
    };
    const leave = (save = true) => {
      if (!focus) return;
      focus = false; html.removeAttribute('data-gz-review-focus'); immersive(false); rubric = details = false; stripState();
      if (save) remember(false);
      const status = doc.getElementById('gz-review-status'); if (status) status.textContent = t('Document focus ended');
      if (previous?.isConnected) previous.focus({ preventScroll: true }); else doc.getElementById('gz-review-focus')?.focus({ preventScroll: true });
    };
    const enter = () => {
      const current = recognize(doc, ctx.site, win.location.pathname);
      if (!active || active.limited || !settings()?.focus || !visible() || !current || Object.keys(current).some((k) => current[k] !== active[k])) { sync(); return; }
      // A fixed child cannot escape a transformed or contained ancestor. Keep the native layout in that case.
      for (let el = active.pane.parentElement; el; el = el.parentElement) {
        const s = win.getComputedStyle(el);
        if (s.transform !== 'none' || s.filter !== 'none' || (s.backdropFilter && s.backdropFilter !== 'none') || s.perspective !== 'none' || /paint|layout|strict|content/.test(s.contain) || /transform|filter|perspective/.test(s.willChange)) return;
      }
      previous = doc.activeElement; focus = true; bars = settings().hideBars;
      html.setAttribute('data-gz-review-focus', ''); immersive(bars); remember(true);
      doc.getElementById('gz-review-exit').focus({ preventScroll: true }); doc.getElementById('gz-review-status').textContent = t('Document focus');
    };
    const clear = () => {
      leave(false); for (const el of marks) el.removeAttribute('data-gz-review-part'); marks = [];
      for (const el of nodes) el.remove(); nodes = []; active = null;
      for (const k of ['data-gz-review', 'data-gz-review-compact', 'data-gz-review-feedback', 'data-gz-review-focus', 'data-gz-review-rubric', 'data-gz-review-details']) html.removeAttribute(k);
    };
    const fold = () => {
      expanded = !expanded; html.toggleAttribute('data-gz-review-feedback', expanded);
      const b = doc.getElementById('gz-review-feedback'); b.textContent = t(expanded ? 'Hide feedback' : 'Show feedback'); b.setAttribute('aria-label', b.textContent); b.setAttribute('aria-expanded', String(expanded));
    };
    const fullscreen = async () => {
      const frame = active?.frame; if (!frame || !settings().fullscreen) return;
      try { const target = typeof frame.requestFullscreen === 'function' ? frame : active.pane; await target.requestFullscreen(); }
      catch { const status = doc.getElementById('gz-review-status'); if (status) status.textContent = t('Full screen is unavailable here'); }
    };
    const mount = (a) => {
      active = a; html.setAttribute('data-gz-review', a.canvas ? 'canvas' : 'ultra'); sheet(doc);
      for (const k of ['root', 'main', 'section', 'aside', 'feed', 'text', 'files', 'tabs', 'pane', 'frame', 'grade', 'title', 'heading', 'close', 'comments']) mark(a[k], k);
      if (!a.canvas) {
        for (let el = a.pane.parentElement; el && el !== a.files; el = el.parentElement) mark(el, 'chain');
        const b = add('button', a.feed, 'Show feedback', fold); b.id = 'gz-review-feedback'; b.setAttribute('aria-expanded', String(expanded));
        if (expanded) { b.textContent = t('Hide feedback'); b.setAttribute('aria-label', b.textContent); }
        html.toggleAttribute('data-gz-review-feedback', expanded);
      }
      const tools = add('div', a.canvas ? a.pane : a.tabs.parentElement, ''); tools.id = 'gz-review-tools'; tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', t('Document review'));
      const full = add('button', tools, 'Full screen', fullscreen); full.id = 'gz-review-fullscreen';
      const start = add('button', tools, 'Focus document', enter); start.id = 'gz-review-focus';
      const strip = add('div', doc.body, ''); strip.id = 'gz-review-strip'; strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', t('Document focus'));
      const grade = add('button', strip, 'Grade and feedback', () => { details = !details; stripState(); }); grade.id = 'gz-review-details'; grade.setAttribute('aria-expanded', 'false');
      if (a.aside) { const r = add('button', strip, 'Rubric', () => { rubric = !rubric; stripState(); }); r.id = 'gz-review-rubric'; r.setAttribute('aria-expanded', 'false'); }
      const hide = add('button', strip, 'Hide Glaze bars in focus', () => { bars = !bars; immersive(bars); hide.setAttribute('aria-pressed', String(bars)); }); hide.id = 'gz-review-hide-bars'; hide.setAttribute('aria-pressed', String(settings().hideBars));
      const exit = add('button', strip, 'Exit focus', () => leave()); exit.id = 'gz-review-exit';
      const status = add('span', doc.body, ''); status.id = 'gz-review-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    };
    const sync = (on = enabled) => {
      enabled = on;
      if (!on) { clear(); observer?.disconnect(); watching = false; return; }
      if (on && !watching) { observer = new MutationObserver(() => { if (!pending) { pending = true; queueMicrotask(() => { pending = false; sync(); }); } }); observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'src', 'hidden', 'aria-hidden', 'id', 'role', 'type', 'contenteditable', 'style'] }); watching = true; }
      const s = settings(), path = win.location.pathname;
      if (page !== path) { clear(); expanded = false; remembered = false; page = path; }
      const a = on && ctx.on() && visible() && s && (s.compact || s.fullscreen || s.focus) && recognize(doc, ctx.site, path);
      if (!a || a.limited && !s.fullscreen) { clear(); return; }
      if (active && (Object.keys(a).some((k) => a[k] !== active[k]) || nodes.some((e) => !e.isConnected))) clear();
      if (!active) mount(a);
      html.toggleAttribute('data-gz-review-compact', s.compact && !a.limited);
      for (const [id, hide] of [['gz-review-fullscreen', !s.fullscreen], ['gz-review-focus', !s.focus || !!a.limited]]) { const el = doc.getElementById(id); if (el.hidden !== hide) el.hidden = hide; }
      if (!s.focus || a.limited) leave(false);
      if (focus && lastHide !== s.hideBars) { bars = s.hideBars; immersive(bars); doc.getElementById('gz-review-hide-bars').setAttribute('aria-pressed', String(bars)); }
      lastHide = s.hideBars;
      if (!remembered) { remembered = true; if (s.remember && s.focus) try { if (win.sessionStorage.getItem(`gz-review:${path}`) === '1') enter(); } catch { /* blocked */ } }
    };
    let lastHide;
    const key = (e) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !active || !visible()) return;
      const target = doc.activeElement;
      if (e.key === 'Escape' && focus && target?.tagName !== 'IFRAME') { e.preventDefault(); e.stopPropagation(); leave(); return; }
      if (target?.matches('iframe, input, textarea, select, button, a[href]') || target?.isContentEditable || target?.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]')) return;
      if (e.key === 'f' && settings().focus) { e.preventDefault(); if (focus) leave(); else enter(); }
    };
    const loaded = (e) => { if (e.target?.tagName === 'IFRAME') sync(); };
    doc.addEventListener('load', loaded, true);
    doc.addEventListener('keydown', key);
    const cover = () => { if (!visible()) leave(false); sync(); };
    const navigate = () => { clear(); sync(); };
    win.addEventListener('pagehide', clear); win.addEventListener('popstate', navigate);
    const message = (e) => { if (e.origin === win.location.origin && e.source === win.top && e.data?.gzCtab === 'review:shown') barsShown(); };
    win.addEventListener('message', message);
    const barsShown = () => { bars = false; doc.getElementById('gz-review-hide-bars')?.setAttribute('aria-pressed', 'false'); };
    return { sync, enter, leave, cover, barsShown, teardown: () => { enabled = false; clear(); observer?.disconnect(); watching = false; doc.removeEventListener('load', loaded, true); doc.removeEventListener('keydown', key); win.removeEventListener('pagehide', clear); win.removeEventListener('popstate', navigate); win.removeEventListener('message', message); } };
  };
  let ui = null;
  const sync = (on) => { if (!ui && on && globalThis.GZ_CTX) ui = create(GZ_CTX); ui?.sync(on); };
  return { pathOK, recognize, create, relayable, chrome: chromeBars, restoreChrome, sync, cover: () => ui?.cover(), barsShown: () => ui?.barsShown() };
})();
if (typeof module !== 'undefined') module.exports = GZ_DOCREVIEW;
GZ_DOCREVIEW;
