// Glaze Writer (enhance.writer), loaded on demand: content.js loads this once an Ultra editor box is on the page or
// written in, and hands it each pass. Every box lib/writer-ultra.js knows gets Glaze's editor (writer.html) in a frame in
// its place. Ultra's own editor stays in the page, hidden, and is kept in step through lib/writer-main.js in the page's
// world (the frame's Quill ops, written as they are), so Ultra's Post, Reply, Send and Submit send what was written and
// its word count and drafts follow. A box holding what Writer can't keep (an attachment, a table, maths, right-to-left
// text…) stays Blackboard's, untouched: the frame checks before anything is written. Ctrl/Cmd+Enter
// in the frame clicks Post, Reply or Send when Ultra allows it (never an attempt's Submit). ⋯ → Blackboard editor gives
// the box back, to Ultra and to draft backup (features/drafts.js skips boxes marked data-gz-writer). Whatever fails leaves
// Ultra's editor, or keeps the draft in Writer until a native write succeeds. An assignment's paper is the exception, below.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_WRITER = globalThis.GZ_WRITER || (() => {
  const X = globalThis.GZ_CTX;
  if (!X) return null; // a frame-only injection can outlive its document
  const U = () => globalThis.GZ_WRITER_ULTRA;
  const html = document.documentElement;
  const boxes = new Map(); // Ultra's editor → its box
  const declined = new WeakSet(); // editors given back to Blackboard's editor: Ultra's from then on, on this page
  const failed = new WeakMap(); // editor → when its frame last failed to open; tried again a minute later
  const SENDS = new Set(['post', 'reply', 'message', 'journal']);
  // A paper (an assignment's attempt) in its full view (Settings → Writer → Full writer) is a page of its own: as tall as the
  // window allows, whatever its text; it stays in Writer's storage and never goes into Ultra's editor (the submit step
  // attaches it as a .docx). In its compact view (the default) the frame is a box as compose's, growing with its text, and
  // the paper's compose projection goes into Ultra's editor as a post's does, for Ultra's own Submit (writer-paper.js).
  // The frame says which (view) and asks for the full height while a sheet is open over the box (room).
  const PAPER_HEIGHT = 'max(640px, calc(100vh - 120px))';
  const paged = (box) => box.mode === 'paper' && (box.full || box.room);
  const FRAME_RETRIES = 2;
  const on = () => X.on() && X.site === 'ultra' && X.settings().enabled !== false && !!X.settings().enhance?.writer;

  // The Look as the frame wears it: the palette, radius and font on <html>, light or dark, and the motion level; and its
  // surfaces (features/surfaces.css), resolved: the page's ground (transparent over a background), the glass mix and edges.
  // Glass only over a background: on a solid one the panels stay opaque, as the mockups draw them. An unset opacity is opaque.
  const TOKENS = [...GZ_COLORS.map(([k]) => k), '--gz-radius', '--gz-font', '--gz-ground', '--gz-surface-paint', '--gz-surface-paint-2', '--gz-surface-opacity', '--gz-glass-mix', '--gz-border-line', '--gz-border-strong'];
  const look = () => {
    const cs = getComputedStyle(html), bg = html.getAttribute('data-gz-bg'), glass = !!bg && bg !== 'solid';
    const value = (k) => (k === '--gz-glass-mix' && !glass ? '100%' : cs.getPropertyValue(k).trim() || (k === '--gz-surface-opacity' ? '100%' : ''));
    return { tokens: Object.fromEntries(TOKENS.map((k) => [k, value(k)]).filter(([, v]) => v)), dark: html.hasAttribute('data-gz-dark-theme'), glass, motion: html.getAttribute('data-gz-motion') || 'off' };
  };
  let worn = '';
  new MutationObserver(() => {
    if (!boxes.size) return;
    const l = look(), key = JSON.stringify(l);
    if (key === worn) return;
    worn = key;
    for (const box of boxes.values()) { box.port?.postMessage({ type: 'look', look: l }); if (box.frame) box.frame.style.colorScheme = l.dark ? 'dark' : 'light'; }
  }).observe(html, { attributes: true, attributeFilter: ['style', 'data-gz-dark-theme', 'data-gz-motion', 'data-gz-bg'] });

  // lib/writer-main.js, in the page's world: its answer comes back inside the dispatch, or not at all. Every answer for
  // the id is kept, since the page can add its own: what counts is the one the native editor bears out.
  const main = (op, m) => {
    const got = [];
    const hear = (e) => { try { const d = JSON.parse(e.detail); if (d?.id === m.id) got.push(d); } catch { /* not ours */ } };
    document.addEventListener('gz-writer:done', hear);
    try { document.dispatchEvent(new CustomEvent(`gz-writer:${op}`, { detail: JSON.stringify(m) })); } finally { document.removeEventListener('gz-writer:done', hear); }
    return got;
  };
  const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // ---- a box's life: asked for, opened, written in, given back -------------------------------------------------------
  const drafts = () => X.need('lib/drafts.js', () => globalThis.GZ_DRAFTS).then(() => X.need('features/drafts.js', () => globalThis.GZ_DRAFT_UI));
  const remember = (box) => {
    clearTimeout(box.backup);
    if (!box.snapshot) return;
    const s = box.snapshot;
    if (globalThis.GZ_DRAFT_UI?.keep) GZ_DRAFT_UI.keep(s, true);
    else drafts().then(() => GZ_DRAFT_UI.keep(s, true), () => {});
  };
  // An assignment's paper is the same when Ultra numbers its attempt in the address (/attempt/create → /attempt/_N_1).
  const samePath = (box) => {
    if (box.path === location.pathname) return true;
    const was = box.mode === 'paper' && U().attemptAt(box.path), now = was && U().attemptAt(location.pathname);
    return !!now && now.course === was.course && now.content === was.content;
  };
  const sameBox = (box) => samePath(box) && box.editor.isConnected && box.root === U().rootOf(box.editor) &&
    box.container === box.editor.closest('.ql-container') && box.editor.id === box.editorId &&
    U().kindOf(box.editor, { path: location.pathname, attempt: box.kind === 'test' ? 'test' : '' }) === box.kind &&
    (box.kind !== 'reply' || U().replyTo(box.editor) === (box.context.post?.id || ''));
  // An assignment's paper key (lib/writer-papers.js keyOf: the school, the student, the course and the assignment), as
  // lib/writer-context-assignment.js builds it, from the student's id alone, so the frame opens the student's paper rather
  // than a stand-in while the rest of the context is read. null when the id isn't known within a few seconds.
  const paperOf = async () => {
    const a = U().attemptAt(location.pathname);
    const uid = a ? await Promise.race([Promise.resolve().then(() => X.account()).then(String), new Promise((r) => setTimeout(r, 5000, ''))]).catch(() => '') : '';
    return /^_\d+_\d+$/.test(uid) ? { school: location.host.toLowerCase(), user: uid, course: a.course, content: a.content, url: location.origin + location.pathname } : null;
  };
  let seq = 0;
  const mount = async (b) => {
    const box = { ...b, id: `gzw-${Date.now().toString(36)}-${(seq++).toString(36)}`, frame: null, port: null, text: squash(b.editor.textContent), latest: b.editor.innerHTML, delta: null, path: location.pathname, editorId: b.editor.id, destination: X.draftAt(b.editor), display: null,
      full: b.mode === 'paper' && X.settings().writer?.full === true, room: false, px: 0 };
    boxes.set(b.editor, box);
    try { await drafts(); if (!await GZ_DRAFT_UI.ready(b.editor)) { declined.add(b.editor); drop(box); return; } } catch { drop(box); return; }
    if (boxes.get(b.editor) !== box || !sameBox(box)) { drop(box); return; }
    if (b.mode === 'paper') {
      const paper = await paperOf();
      if (boxes.get(b.editor) !== box || !sameBox(box)) { drop(box); return; }
      if (paper) box.context = { ...box.context, paper };
    }
    b.root.setAttribute('data-gz-writer', b.kind);
    b.container.setAttribute('data-gz-writer-id', box.id);
    if (!on()) { drop(box); return; }
    open(box);
  };
  const open = (box) => {
    let src;
    try { src = chrome.runtime.getURL('writer.html'); } catch { recover(box); return; }
    const f = Object.assign(document.createElement('iframe'), { className: 'gz-writer', title: X.t('Glaze Writer') });
    f.setAttribute('data-gz-writer-frame', box.kind);
    // Out of sight until it says it's ready, then in the box's place at the box's height: the frame's 3px each side
    // holds its focus ring.
    box.room = false;
    f.style.cssText = `display:block;border:0;width:calc(100% + 6px);margin:-3px;height:${paged(box) ? PAPER_HEIGHT : `${Math.max(120, Math.round(box.root.getBoundingClientRect().height)) + 6}px`};background:transparent;color-scheme:${html.hasAttribute('data-gz-dark-theme') ? 'dark' : 'light'};position:absolute;opacity:0;pointer-events:none`;
    const ch = new MessageChannel();
    box.frame = f;
    box.ready = false;
    box.port = ch.port1;
    ch.port1.onmessage = ({ data }) => { if (boxes.get(box.editor) === box && box.frame === f && box.port === ch.port1 && data && typeof data.type === 'string') hear(box, data); };
    box.wait = setTimeout(() => reopen(box), 15000);
    // Only to Glaze's own origin (spelled out: URL.origin of an extension scheme is "null" in some engines), so a frame
    // the page navigated elsewhere gets nothing. Lowercase, as the frame's origin is: Safari's getURL keeps its UUID
    // uppercase (lib/background.js OWN_ORIGIN).
    const origin = src.slice(0, src.indexOf('/', src.indexOf('://') + 3)).toLowerCase();
    let offered = false, transferred = false;
    const hello = async (e) => {
      if (boxes.get(box.editor) !== box || box.frame !== f || offered || box.ready || e.source !== f.contentWindow || e.origin !== origin || e.data?.type !== 'glaze:writer:hello') return;
      offered = true;
      // The initial about:blank/srcdoc load belongs to the LMS. Only Writer itself, after all its scripts load, can
      // ask for a pass. Keep it out of the URL and never offer it to an inherited or navigated document.
      const pass = crypto.randomUUID();
      const ok = await Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'glaze:writer', op: 'job', pass })).then((r) => r?.ok === true, () => false);
      if (boxes.get(box.editor) !== box || box.frame !== f || box.port !== ch.port1) return;
      if (!ok || !sameBox(box) || !on()) { recover(box); return; }
      if (!f.isConnected) { reopen(box); return; }
      try { f.contentWindow.postMessage({ type: 'glaze:writer', pass }, origin, [ch.port2]); transferred = true; }
      catch { reopen(box); }
    };
    box.unhello = () => { removeEventListener('message', hello); if (!transferred) ch.port2.close(); };
    addEventListener('message', hello);
    f.addEventListener('load', () => {
      if (boxes.get(box.editor) !== box || box.frame !== f) return;
      if (offered || box.ready) { reopen(box); return; }
    });
    f.addEventListener('error', () => { if (box.frame === f) reopen(box); });
    // The parent origin is public; it lets the boot signal use an exact target even with an empty referrer.
    f.src = `${src}?host=${encodeURIComponent(location.origin)}`;
    box.root.before(f);
  };
  // A crashed or navigated frame gets a fresh one-use channel, initialized from Writer's buffered document.
  const retire = (box) => {
    endFlush(box);
    if (box.focused) focusMode(box, false);
    clearTimeout(box.wait);
    box.unhello?.();
    box.unhello = null;
    box.observer?.disconnect();
    box.port?.close();
    box.port = null;
    box.frame?.remove();
    box.frame = null;
    box.ready = false;
  };
  const reopen = (box) => {
    if (box.reopening || boxes.get(box.editor) !== box) return;
    box.reopening = true;
    remember(box);
    retire(box);
    box.reopening = false;
    box.recovered = true;
    box.reopens = (box.reopens || 0) + 1;
    if (box.reopens <= FRAME_RETRIES && sameBox(box) && on()) { open(box); return; }
    recover(box);
  };
  const recover = (box) => {
    if (boxes.get(box.editor) !== box) return;
    failed.set(box.editor, Date.now());
    remember(box);
    retire(box);
    // A paper lives in Writer's storage, out of reach now: Ultra's editor comes back as it was, and a reload brings Writer.
    if (box.mode === 'paper' || !box.snapshot || !sameBox(box)) { drop(box); return; }
    // Even an invalidated extension keeps the student's plain text available to copy or hand back. Never insert it as HTML.
    const wrap = document.createElement('div'), field = document.createElement('textarea'), back = document.createElement('button');
    field.setAttribute('data-gz-writer-recovery', '');
    field.setAttribute('aria-label', X.t('Glaze Writer'));
    field.value = box.snapshot?.text || box.editor.textContent;
    field.style.cssText = 'display:block;width:100%;min-height:190px;font:inherit;color:inherit;background:transparent';
    back.type = 'button';
    back.textContent = X.t('Blackboard editor');
    back.addEventListener('click', () => giveBack(box, true));
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); } });
    field.addEventListener('input', () => {
      const lines = field.value.replace(/\r\n?/g, '\n').split('\n'), wrap = document.createElement('div');
      for (const l of lines) { const p = document.createElement('p'); if (l) p.textContent = l; else p.append(document.createElement('br')); wrap.append(p); }
      box.snapshot = { ...box.destination, html: wrap.innerHTML, text: field.value, at: Date.now() };
      sync(box, box.snapshot.html, [{ insert: `${lines.join('\n')}\n` }]); remember(box);
    });
    wrap.append(field, back);
    box.frame = wrap;
    if (box.root.isConnected) box.root.before(wrap); else document.body.append(wrap);
    field.focus();
  };
  // The frame is up: it takes the box's text and place, and the box hides (still in the page, still synced).
  const swap = (box) => {
    clearTimeout(box.wait);
    box.unhello?.();
    box.unhello = null;
    const ed = box.editor, f = box.frame, typing = box.root.contains(document.activeElement);
    const l = look();
    worn = JSON.stringify(l);
    if (!box.recovered) { box.latest = ed.innerHTML; box.delta = null; }
    box.nativeHTML = ed.innerHTML;
    box.ready = true;
    const selection = typing && box.mode === 'compose' && !box.recovered ? main('get', { id: box.id }).find((r) => r?.ok && r.html === ed.innerHTML && r.selection)?.selection : null;
    if (box.mode === 'paper') box.context = { ...box.context, recovery: location.origin + location.pathname };
    box.port.postMessage({ type: 'init', mode: box.mode, kind: box.kind, html: box.latest, selection, placeholder: ed.getAttribute('data-placeholder') || '', look: l, context: box.context, locale: X.locale() });
    if (['post', 'reply', 'message', 'journal'].includes(box.kind)) X.need('lib/writer-context-discussion.js', () => globalThis.GZ_WRITER_CONTEXT_DISCUSSION).then(() => globalThis.GZ_WRITER_CONTEXT_DISCUSSION?.watch(box, X), () => {});
    if (box.kind === 'reply') X.need('features/writer-quote.js', () => globalThis.GZ_WRITER_QUOTE).then(() => globalThis.GZ_WRITER_QUOTE?.arm(box), () => {});
    box.display ||= [box.root.style.getPropertyValue('display'), box.root.style.getPropertyPriority('display')];
    box.root.style.setProperty('display', 'none', 'important');
    for (const k of ['position', 'opacity', 'pointer-events']) f.style.removeProperty(k);
    if (!typing && l.motion !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches) f.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
    if (typing) { f.focus(); box.port.postMessage({ type: 'focus' }); }
    if (box.mode === 'paper') { X.need('lib/writer-context-assignment.js', () => globalThis.GZ_WRITER_CONTEXT_ASSIGNMENT).then(() => GZ_WRITER_CONTEXT_ASSIGNMENT.send(X, box, () => boxes.get(ed) === box)).catch(() => {}); return; }
    // Ultra changing its own editor (a post sent and cleared, its saved draft put back): the frame shows it. Its text, not
    // its markup, says so: Quill tidies markup after each sync.
    box.observer = new MutationObserver(() => {
      if (!sameBox(box)) return;
      if (ed.innerHTML === box.nativeHTML) return;
      if (!U().canEdit(ed)) { drop(box); return; }
      if (box.unsynced) return;
      const now = squash(ed.textContent);
      if (now === box.text) return;
      if (box.snapshot && !box.sending) { box.unsynced = true; return; }
      remember(box);
      box.text = now;
      box.latest = box.nativeHTML = ed.innerHTML;
      box.delta = null;
      box.sending = false;
      box.port.postMessage({ type: 'html', html: ed.innerHTML });
    });
    box.observer.observe(ed, { childList: true, subtree: true, characterData: true });
  };
  const hear = (box, m) => {
    if (m.type === 'ready' && !box.ready) swap(box);
    else if (m.type.startsWith('submit:')) { if (box.mode === 'paper') X.need('lib/writer-submit.js', () => globalThis.GZ_WRITER_SUBMIT_LIB).then(() => X.need('features/writer-submit.js', () => globalThis.GZ_WRITER_SUBMIT)).then(() => boxes.get(box.editor) === box && GZ_WRITER_SUBMIT.hear(box, m, X, () => boxes.get(box.editor) === box && sameBox(box)), () => {}); }
    else if (m.type === 'attachments') { if (box.mode === 'paper') X.need('lib/writer-context-assignment.js', () => globalThis.GZ_WRITER_CONTEXT_ASSIGNMENT).then(() => GZ_WRITER_CONTEXT_ASSIGNMENT.attachments(X, box, m, () => boxes.get(box.editor) === box && sameBox(box)), () => {}); }
    else if (m.type === 'compact:flushed') {
      const f = box.flushing;
      if (!f || m.request !== f.request) return;
      // Saved: Ultra's own button goes on with the text (Ultra may have drawn its footer again meanwhile), or the compact
      // bar says why not. A paper too long for Ultra's box: the frame has said so and focused Full writer itself (focusing
      // the frame from here would put its focus back on its body).
      let why = null;
      try {
        if (m.ok === true) {
          const b = f.button.isConnected ? f.button : [...box.editor.closest('bb-assignment-attempt-authoring-panel')?.querySelectorAll('button[data-analytics-id]') || []].find((x) => x.getAttribute('data-analytics-id') === f.id);
          if (box.full || !sameBox(box) || !b) why = 'page';
          else if (typeof m.html !== 'string' || !Array.isArray(m.delta) || !sync(box, m.html, m.delta)) why = 'text';
          else if (!U().enabled(b)) why = f.action === 'submit' ? 'submit' : 'page';
          else { passing = b; try { b.click(); } finally { passing = null; } }
        }
      } finally { endFlush(box, why); }
    }
    else if (m.type === 'view' || m.type === 'room') { if (box.mode === 'paper') { if (m.type === 'view') box.viewedOn = box.port; view(box, m); } }
    else if (box.mode === 'paper' && box.full) { if (m.type === 'focus-mode') focusMode(box, m.on === true); else if (m.type === 'native') { drop(box); declined.add(box.editor); } }
    else if (m.type === 'height' && Number.isFinite(m.px)) { box.px = Math.max(40, Math.min(20000, Math.round(m.px))); if (!paged(box) && !box.focused) box.frame.style.height = `${box.px}px`; }
    else if (m.type === 'change' && typeof m.html === 'string' && typeof m.text === 'string') {
      // A compact paper is in Writer's storage already: Ultra's editor takes its text, the draft backup nothing.
      if (box.mode === 'compose') {
        box.snapshot = { ...box.destination, html: m.html, text: m.text, at: Date.now() };
        clearTimeout(box.backup);
        box.backup = setTimeout(() => remember(box), 1000);
      }
      sync(box, m.html, Array.isArray(m.delta) ? m.delta : null);
    }
    else if (m.type === 'send') send(box);
    else if (m.type === 'native' && typeof m.reason === 'string' && m.reason) refuse(box);
    else if (m.type === 'native') giveBack(box, true);
  };
  // A paper's view (full or compact) or a sheet's room over its compact box: the frame's height; on a switch, the page
  // scrolled by what it moved the caret (from, to: its top in the frame before and after), so its line stays where it was
  // on screen; a full frame or a sheet's room brought into sight.
  const view = (box, m) => {
    if (m.type === 'view') endFlush(box);
    const was = box.full, switched = m.type === 'view' && Number.isFinite(m.from) && Number.isFinite(m.to);
    if (m.type === 'room') box.room = m.on === true;
    else { box.full = m.full === true; if (Number.isFinite(m.px)) box.px = Math.max(40, Math.min(20000, Math.round(m.px))); }
    const f = box.frame;
    if (!f || box.focused) return;
    const top = f.getBoundingClientRect().top;
    if (paged(box) || box.px) f.style.height = paged(box) ? PAPER_HEIGHT : `${box.px}px`;
    if (switched && was && !box.full) scroller(f)?.scrollBy?.(0, m.to - m.from + f.getBoundingClientRect().top - top);
    else if (paged(box) && (m.type === 'room' ? box.room : switched && !was)) f.scrollIntoView?.({ block: 'nearest' });
  };
  const scroller = (el) => {
    for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e; }
    return document.scrollingElement;
  };
  // A page-world reply is untrusted. Check the native DOM too, and keep Writer's copy on every failure.
  // An explicit body keeps fragment-leading whitespace and head-like elements in the text being verified.
  const sameText = (ed, h) => new DOMParser().parseFromString('<body>' + h, 'text/html').body.textContent === ed.textContent;
  // h: what the frame shows; d: its Quill ops, or null when it came from Ultra's editor (which then already holds it).
  const sync = (box, h, d = h === box.latest ? box.delta : null) => {
    if (!sameBox(box)) { box.latest = h; box.delta = d; box.unsynced = true; return false; }
    if (h !== box.latest) { box.sending = false; clearTimeout(box.retry); box.retry = null; }
    if (!box.unsynced && h === box.latest && box.nativeHTML === box.editor.innerHTML && sameText(box.editor, h)) return true;
    box.latest = h;
    box.delta = d;
    const said = d ? main('set', { id: box.id, delta: d }) : [{ ok: box.editor.innerHTML === h, html: box.editor.innerHTML }];
    const ok = said.some((r) => r?.ok && r.html === box.editor.innerHTML) && sameText(box.editor, h);
    box.unsynced = !ok;
    if (ok) { box.text = squash(box.editor.textContent); box.nativeHTML = box.editor.innerHTML; }
    return ok;
  };
  // Ctrl/Cmd+Enter: Post, Reply or Send, once, when Ultra allows it (its Angular may enable the button a moment after
  // the edit that fills the box).
  const send = (box, until = Date.now() + 1000) => {
    if (Date.now() >= until || box.sending || box.retry || box.path !== location.pathname || !SENDS.has(box.kind) || U().kindOf(box.editor, { path: location.pathname }) !== box.kind || !sync(box, box.latest)) return;
    const b = U().sendOf(box.editor, box.kind);
    if (b?.isConnected && U().enabled(b)) { remember(box); globalThis.GZ_DRAFT_UI?.sent?.(box.editor); box.sending = true; b.click(); }
    else if (box.text) box.retry = setTimeout(() => { box.retry = null; if (boxes.get(box.editor) === box) send(box, until); }, 60);
  };
  // A compact native action must read the frame's current document, not merely its last delivered change. The frame
  // saves and holds editing until the native click is dispatched, however long the save takes (its bar says Saving…);
  // a failed one never clicks Ultra, and the bar says why (reason: text, submit or page; the frame's own it says itself).
  let passing = null;
  const endFlush = (box, reason = null) => {
    const f = box.flushing;
    if (!f) return;
    box.flushing = null;
    box.port?.postMessage({ type: 'compact:resume', request: f.request, ...(reason && { reason }) });
  };
  // A normal native Post/Reply/Send has the same flush and clear lifecycle as the shortcut.
  document.addEventListener('click', (e) => {
    const b = e.target?.closest?.('button');
    if (!b || b === passing || globalThis.GZ_WRITER_SUBMIT?.passing?.(b)) return;
    // Ultra collapses an empty new-post editor on Cancel without removing its node. Release the empty frame too,
    // so its next click can activate the native composer again.
    if (b.getAttribute('ng-click') === 'messageControl.onCancelClick()') {
      for (const box of boxes.values()) if (box.kind === 'post' && !box.text && sameBox(box) && box.editor.closest('form')?.contains(b)) drop(box);
    }
    for (const box of boxes.values()) if (SENDS.has(box.kind) && sameBox(box) && U().sendOf(box.editor, box.kind) === b && U().enabled(b)) {
      if (!sync(box, box.latest)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      remember(box);
      globalThis.GZ_DRAFT_UI?.sent?.(box.editor);
      box.sending = true;
    }
    // An attempt's Submit and Save and Close send its box: a compact paper's last edit goes in first; a full paper's
    // press waits for its submit step (features/writer-submit.js) while the frame isn't up to have one.
    for (const box of boxes.values()) {
      if (box.mode !== 'paper' || !/\.footer\..*(?:submit|saveAndClose)$/.test(b.getAttribute('data-analytics-id') || '') || !box.editor.closest('bb-assignment-attempt-authoring-panel')?.contains(b) || !sameBox(box)) continue;
      if (box.full && globalThis.GZ_WRITER_SUBMIT?.armed?.(box)) continue;
      e.preventDefault(); e.stopImmediatePropagation();
      hold(box, b);
      return;
    }
  }, true);
  // Ultra's button, held until the frame can take it, marked busy meanwhile: while the frame opens or reopens there's no
  // frame to save the paper, and Ultra's box may not hold its last words (a full paper's, none). Compact: the frame's
  // save asked (compact:flush) once it is up and has said its view (a view ends a flush asked before it), asked again of
  // a frame that reopened before answering; a press while one is asked waits on that one (the bar says Saving…). Full:
  // pressed again once the submit step has the box, or Ultra's own after HOLD_ARM if it never takes it (as before). A box
  // Writer gives back holds nothing: Ultra's editor is there again to press.
  const HOLD_ARM = 5000;
  const hold = (box, b) => {
    if (box.flushing || (box.held && !box.held.request)) return;
    const id = b.getAttribute('data-analytics-id'), action = /submit$/.test(id) ? 'submit' : 'save';
    const busy = (x, on) => { if (on) { x.setAttribute('aria-busy', 'true'); x.style.setProperty('cursor', 'progress'); } else { x.removeAttribute('aria-busy'); x.style.removeProperty('cursor'); } };
    if (box.held) busy(box.held.button, false);
    const p = box.held = { button: b, request: null, port: null, up: null };
    const button = () => (b.isConnected ? b : [...box.editor.closest('bb-assignment-attempt-authoring-panel')?.querySelectorAll('button[data-analytics-id]') || []].find((x) => x.getAttribute('data-analytics-id') === id));
    const end = () => { if (box.held === p) box.held = null; busy(b, false); };
    const step = () => {
      if (box.held !== p) return;
      if (boxes.get(box.editor) !== box || !sameBox(box)) { end(); return; }
      if (p.request && box.flushing?.request === p.request) { setTimeout(step, 100); return; } // the frame saves it
      if (p.request && box.port === p.port) { end(); return; } // answered: Ultra's button went, or the bar says why
      const x = button();
      if (!x) { end(); return; }
      if (box.full) {
        if (globalThis.GZ_WRITER_SUBMIT?.armed?.(box)) { end(); x.click(); return; }
        if (box.ready && Date.now() - (p.up ??= Date.now()) > HOLD_ARM) { end(); passing = x; try { x.click(); } finally { passing = null; } return; }
      } else if (box.ready && box.port && box.viewedOn === box.port) {
        p.request = crypto.randomUUID(); p.port = box.port;
        box.flushing = { request: p.request, button: x, id, action };
        box.port.postMessage({ type: 'compact:flush', request: p.request, action });
      }
      setTimeout(step, 100);
    };
    busy(b, true);
    step();
  };
  // Ultra collapses an empty new Post when its editor loses focus, and the frame taking the typing is such a loss. While
  // the frame stands in, the hidden editor's blur never reaches Ultra (live Ultra, 2026-10-28).
  for (const type of ['blur', 'focusout']) addEventListener(type, (e) => {
    if (!(e.target instanceof Node)) return;
    for (const box of boxes.values()) if (box.kind === 'post' && box.ready && box.root.contains(e.target)) { e.stopImmediatePropagation(); return; }
  }, true);
  // Focus: the paper's frame fills the window over a dimmed page, until the frame says otherwise or the dim is clicked.
  const focusMode = (box, on) => {
    const f = box.frame;
    if (!f || !!box.focused === on) return;
    if (on) {
      box.focused = { style: f.style.cssText };
      const dim = box.focused.dim = document.createElement('div');
      dim.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(2,6,12,.66)';
      dim.addEventListener('click', () => { box.port?.postMessage({ type: 'focus-mode', on: false }); focusMode(box, false); });
      document.body.append(dim);
      f.style.cssText += ';position:fixed;inset:0;width:100vw;height:100vh;margin:0;z-index:2147483647';
      f.focus();
    } else {
      f.style.cssText = box.focused.style;
      box.focused.dim.remove();
      box.focused = null;
    }
  };
  // The frame out and Ultra's editor back, as it was.
  const drop = (box) => {
    if (boxes.get(box.editor) !== box) return;
    if (box.focused) focusMode(box, false);
    remember(box);
    boxes.delete(box.editor);
    globalThis.GZ_WRITER_CONTEXT_DISCUSSION?.unwatch(box);
    globalThis.GZ_WRITER_QUOTE?.disarm(box);
    clearTimeout(box.retry);
    retire(box);
    if (box.display) box.root.style.setProperty('display', ...box.display);
    if (box.display && !box.display[0]) box.root.style.removeProperty('display');
    box.root.removeAttribute('data-gz-writer');
    box.container.removeAttribute('data-gz-writer-id');
  };
  // The frame found what it can't keep in the box (lib/writer-schema.js loses) before writing anything: the box stays
  // Blackboard's as it is, nothing synced.
  const refuse = (box) => {
    if (box.snapshot) { giveBack(box, false); return; }
    drop(box);
    declined.add(box.editor);
  };
  // Back to Blackboard's editor, which this editor then stays.
  const giveBack = (box, focus) => {
    if (!sync(box, box.latest)) return;
    drop(box);
    declined.add(box.editor);
    if (focus) box.editor.focus();
    globalThis.GZ_DRAFT_UI?.write({ type: 'input', target: box.editor }); // drafts keep what it holds from now
  };
  const dropAll = () => { for (const box of [...boxes.values()]) { if (box.unsynced && sameBox(box) && box.frame?.isConnected && !sync(box, box.latest)) { remember(box); continue; } drop(box); } };
  addEventListener('beforeunload', (e) => { if ([...boxes.values()].some((box) => box.unsynced && box.snapshot?.text)) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('pagehide', () => { for (const box of boxes.values()) remember(box); });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'sync' && (c.enabled?.newValue === false || c.enhance?.newValue?.writer === false)) dropAll();
  });

  // An attempt's kind, from the page Ultra draws and its gradebook (lib/writer-ultra.js pageKind). This document,
  // including a course tab's frame, tells the worker, which keeps AI off tests (lib/background.js
  // 'glaze:attempt-kind'). Once the worker has it, each frame on the page is told ('ai'): one that asked before asks again.
  let told = null;
  // A canvas can disappear while Ultra redraws. Once seen as a test, this assessment stays one for this document,
  // including /attempt/create becoming a persisted attempt. A different assignment remains eligible.
  const tests = new Set();
  const submissions = new WeakMap(); // a rendered submission editor belongs to the assessment where it was seen
  const attempt = () => {
    const a = U().attemptAt(location.pathname);
    if (!a) { told = null; return ''; }
    let rows;
    try { rows = X.bookFor(a.course)?.results; } catch { /* no gradebook yet */ }
    const assessment = `${a.course}|${a.content}`;
    let kind = U().pageKind(document, rows, a.content);
    if (kind === 'assignment') {
      const editor = document.querySelector('#bb-editorassignment-attempt-authoring-submission');
      if (submissions.has(editor) && submissions.get(editor) !== assessment) kind = '';
      else submissions.set(editor, assessment);
    }
    if (kind === 'test') tests.add(assessment);
    if (tests.has(assessment)) kind = 'test';
    const page = location.origin + location.pathname + (location.search || '');
    const key = `${page}|${kind}`;
    if (told?.key !== key) {
      const report = told = { key };
      // Send from the route just sampled, before yielding. Only this report's acknowledgement can wake a frame;
      // a refusal or a disconnected worker leaves the next observer pass free to try again.
      (async () => {
        try {
          const r = await chrome.runtime.sendMessage({ type: 'glaze:attempt-kind', kind: kind || 'unknown', page });
          if (told !== report) return;
          if (!r?.ok) { told = null; return; }
          for (const b of boxes.values()) b.port?.postMessage({ type: 'ai' });
        } catch { if (told === report) told = null; }
      })();
    }
    return kind;
  };
  // content.js's pass: boxes gone or unframed go, new ones open.
  const pass = () => {
    if (!on()) { dropAll(); return; }
    for (const box of [...boxes.values()]) {
      if (!sameBox(box)) drop(box);
      else if (box.kind === 'post' && !box.text && box.editor.closest('form')?.querySelector('.panel-editor-controls.ng-hide, .panel-editor-controls[aria-hidden="true"]')) drop(box);
      else if (box.kind === 'journal' && !U().sendOf(box.editor, 'journal')) drop(box); // its Cancel, or the entry sent
      else if (box.frame && !box.frame.isConnected) { if (box.unsynced || box.mode === 'paper') reopen(box); else drop(box); }
    }
    if (!U()) { X.need('lib/writer-ultra.js', () => globalThis.GZ_WRITER_ULTRA).then(() => on() && pass(), () => {}); return; }
    const at = { path: location.pathname, attempt: attempt() };
    if (U().attemptAt(at.path) && !at.attempt) return;
    for (const b of U().boxes(document, at, (ed) => boxes.has(ed) || declined.has(ed) || Date.now() - (failed.get(ed) || 0) < 60000)) {
      mount(b);
    }
  };
  return { pass, drop: dropAll };
})();

GZ_WRITER;
