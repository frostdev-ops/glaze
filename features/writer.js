// Glaze Writer (enhance.writer), loaded on demand: content.js loads this once an Ultra editor box is on the page or
// written in, and hands it each pass. Every box lib/writer-ultra.js knows gets Glaze's editor (writer.html) in a frame in
// its place. Ultra's own editor stays in the page, hidden, and is kept in step through lib/writer-main.js in the page's
// world (the frame's Quill ops, written as they are), so Ultra's Post, Reply, Send and Submit send what was written and
// its word count and drafts follow. A box holding what Writer can't keep (an attachment, a table, maths, right-to-left
// text…) stays Blackboard's, untouched: the frame checks before anything is written. Ctrl/Cmd+Enter
// in the frame clicks Post, Reply or Send when Ultra allows it (never an attempt's Submit). ⋯ → Blackboard editor gives
// the box back, to Ultra and to draft backup (features/drafts.js skips boxes marked data-gz-writer). Whatever fails leaves
// Ultra's editor, or keeps the draft in Writer until a native write succeeds.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_WRITER = globalThis.GZ_WRITER || (() => {
  const X = globalThis.GZ_CTX;
  if (!X) return null; // a frame-only injection can outlive its document
  const U = () => globalThis.GZ_WRITER_ULTRA;
  const html = document.documentElement;
  const boxes = new Map(); // Ultra's editor → its box
  const declined = new WeakSet(); // editors given back to Blackboard's editor: Ultra's from then on, on this page
  const failed = new WeakMap(); // editor → when its frame last failed to open; tried again a minute later
  const SENDS = new Set(['post', 'reply', 'message']);
  // A paper (an assignment's attempt) is a page of its own: as tall as the window allows, whatever its text; it stays in
  // Writer's storage and never goes into Ultra's editor (the submit step attaches it as a .docx).
  const PAPER_HEIGHT = 'max(640px, calc(100vh - 120px))';
  const on = () => X.on() && X.site === 'ultra' && X.settings().enabled !== false && !!X.settings().enhance?.writer;

  // The Look as the frame wears it: the palette, radius and font on <html>, light or dark, and the motion level.
  const TOKENS = [...GZ_COLORS.map(([k]) => k), '--gz-radius', '--gz-font'];
  const look = () => {
    const cs = getComputedStyle(html);
    return { tokens: Object.fromEntries(TOKENS.map((k) => [k, cs.getPropertyValue(k).trim()]).filter(([, v]) => v)), dark: html.hasAttribute('data-gz-dark-theme'), motion: html.getAttribute('data-gz-motion') || 'off' };
  };
  let worn = '';
  new MutationObserver(() => {
    if (!boxes.size) return;
    const l = look(), key = JSON.stringify(l);
    if (key === worn) return;
    worn = key;
    for (const box of boxes.values()) { box.port?.postMessage({ type: 'look', look: l }); if (box.frame) box.frame.style.colorScheme = l.dark ? 'dark' : 'light'; }
  }).observe(html, { attributes: true, attributeFilter: ['style', 'data-gz-dark-theme', 'data-gz-motion'] });

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
  const sameBox = (box) => box.path === location.pathname && box.editor.isConnected && box.root === U().rootOf(box.editor) &&
    box.container === box.editor.closest('.ql-container') && box.editor.id === box.editorId &&
    U().kindOf(box.editor, { path: location.pathname, attempt: box.kind === 'test' ? 'test' : '' }) === box.kind &&
    (box.kind !== 'reply' || U().replyTo(box.editor) === (box.context.post?.id || ''));
  let seq = 0;
  const mount = async (b) => {
    const box = { ...b, id: `gzw-${Date.now().toString(36)}-${(seq++).toString(36)}`, frame: null, port: null, text: squash(b.editor.textContent), latest: b.editor.innerHTML, delta: null, path: location.pathname, editorId: b.editor.id, destination: X.draftAt(b.editor), display: null };
    boxes.set(b.editor, box);
    try { await drafts(); if (!await GZ_DRAFT_UI.ready(b.editor)) { declined.add(b.editor); drop(box); return; } } catch { drop(box); return; }
    if (boxes.get(b.editor) !== box || !sameBox(box)) { drop(box); return; }
    b.root.setAttribute('data-gz-writer', b.kind);
    b.container.setAttribute('data-gz-writer-id', box.id);
    // A one-use pass for the frame, which also puts lib/writer-main.js in this page (lib/background.js 'glaze:writer').
    const pass = crypto.randomUUID();
    const ok = await Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'glaze:writer', op: 'job', pass })).then((r) => r?.ok === true, () => false);
    if (boxes.get(b.editor) !== box) return;
    if (!ok || !sameBox(box) || !on()) { failed.set(b.editor, Date.now()); drop(box); return; }
    open(box, pass);
  };
  const open = (box, pass) => {
    const src = chrome.runtime.getURL('writer.html');
    const f = Object.assign(document.createElement('iframe'), { className: 'gz-writer', title: X.t('Glaze Writer') });
    f.setAttribute('data-gz-writer-frame', box.kind);
    // Out of sight until it says it's ready, then in the box's place at the box's height: the frame's 3px each side
    // holds its focus ring.
    f.style.cssText = `display:block;border:0;width:calc(100% + 6px);margin:-3px;height:${box.mode === 'paper' ? PAPER_HEIGHT : `${Math.max(120, Math.round(box.root.getBoundingClientRect().height)) + 6}px`};background:transparent;color-scheme:${html.hasAttribute('data-gz-dark-theme') ? 'dark' : 'light'};position:absolute;opacity:0;pointer-events:none`;
    const ch = new MessageChannel();
    box.frame = f;
    box.ready = false;
    box.port = ch.port1;
    ch.port1.onmessage = ({ data }) => { if (boxes.get(box.editor) === box && data && typeof data.type === 'string') hear(box, data); };
    box.wait = setTimeout(() => { failed.set(box.editor, Date.now()); drop(box); }, 15000);
    // Only to Glaze's own origin (spelled out: URL.origin of an extension scheme is "null" in some engines), so a frame
    // the page navigated elsewhere gets nothing.
    const origin = src.slice(0, src.indexOf('/', src.indexOf('://') + 3));
    let offered = false;
    f.addEventListener('load', () => {
      if (boxes.get(box.editor) !== box || box.frame !== f) return;
      if (offered || box.ready) { reopen(box); return; }
      offered = true;
      f.contentWindow?.postMessage({ type: 'glaze:writer', pass }, origin, [ch.port2]);
    });
    f.src = src;
    box.root.before(f);
  };
  // A crashed or navigated frame gets a fresh one-use channel, initialized from Writer's buffered document.
  const reopen = async (box) => {
    if (box.reopening || boxes.get(box.editor) !== box) return;
    box.reopening = true;
    remember(box);
    clearTimeout(box.wait);
    box.observer?.disconnect();
    box.port?.close();
    box.port = null;
    box.frame?.remove();
    box.frame = null;
    box.ready = false;
    const pass = crypto.randomUUID();
    const ok = await Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'glaze:writer', op: 'job', pass })).then((r) => r?.ok === true, () => false);
    if (boxes.get(box.editor) !== box) return;
    box.reopening = false;
    box.recovered = true;
    if (ok && sameBox(box)) { open(box, pass); return; }
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
    const ed = box.editor, f = box.frame, typing = box.root.contains(document.activeElement);
    const l = look();
    worn = JSON.stringify(l);
    if (!box.recovered) { box.latest = ed.innerHTML; box.delta = null; }
    box.nativeHTML = ed.innerHTML;
    box.ready = true;
    if (box.mode === 'paper') box.context = { ...box.context, recovery: location.origin + location.pathname };
    box.port.postMessage({ type: 'init', mode: box.mode, kind: box.kind, html: box.latest, placeholder: ed.getAttribute('data-placeholder') || '', look: l, context: box.context, locale: X.locale() });
    if (['post', 'reply', 'message'].includes(box.kind)) X.need('lib/writer-context-discussion.js', () => globalThis.GZ_WRITER_CONTEXT_DISCUSSION).then(() => globalThis.GZ_WRITER_CONTEXT_DISCUSSION?.watch(box, X), () => {});
    if (box.kind === 'reply') X.need('features/writer-quote.js', () => globalThis.GZ_WRITER_QUOTE).then(() => globalThis.GZ_WRITER_QUOTE?.arm(box), () => {});
    box.display ||= [box.root.style.getPropertyValue('display'), box.root.style.getPropertyPriority('display')];
    box.root.style.setProperty('display', 'none', 'important');
    for (const k of ['position', 'opacity', 'pointer-events']) f.style.removeProperty(k);
    if (l.motion !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches) f.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
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
    else if (box.mode === 'paper') { if (m.type === 'focus-mode') focusMode(box, m.on === true); else if (m.type === 'native') { drop(box); declined.add(box.editor); } }
    else if (m.type === 'height' && Number.isFinite(m.px)) box.frame.style.height = `${Math.max(40, Math.min(20000, Math.round(m.px)))}px`;
    else if (m.type === 'change' && typeof m.html === 'string' && typeof m.text === 'string') {
      box.snapshot = { ...box.destination, html: m.html, text: m.text, at: Date.now() };
      clearTimeout(box.backup);
      box.backup = setTimeout(() => remember(box), 1000);
      sync(box, m.html, Array.isArray(m.delta) ? m.delta : null);
    }
    else if (m.type === 'send') send(box);
    else if (m.type === 'native' && typeof m.reason === 'string' && m.reason) refuse(box);
    else if (m.type === 'native') giveBack(box, true);
  };
  // A page-world reply is untrusted. Check the native DOM too, and keep Writer's copy on every failure.
  const sameText = (ed, h) => {
    const d = document.createElement('template');
    d.innerHTML = h;
    return (d.content || d).textContent === ed.textContent;
  };
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
  // A normal native Post/Reply/Send has the same flush and clear lifecycle as the shortcut.
  document.addEventListener('click', (e) => {
    const b = e.target?.closest?.('button');
    if (!b) return;
    for (const box of boxes.values()) if (SENDS.has(box.kind) && sameBox(box) && U().sendOf(box.editor, box.kind) === b && U().enabled(b)) {
      if (!sync(box, box.latest)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      remember(box);
      globalThis.GZ_DRAFT_UI?.sent?.(box.editor);
      box.sending = true;
    }
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
    clearTimeout(box.wait);
    clearTimeout(box.retry);
    box.observer?.disconnect();
    box.port?.close();
    box.frame?.remove();
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

  // An attempt's kind, from the course's gradebook ('' until it answers). Once known, the top frame tells the worker, which
  // lets the AI work on an assignment's attempt and keeps it off a test's (lib/background.js 'glaze:attempt-kind').
  let told = '';
  const attempt = () => {
    const a = U().attemptAt(location.pathname);
    if (!a) { told = ''; return ''; }
    let kind = '';
    try { kind = U().attemptKind(X.bookFor(a.course)?.results, a.content); } catch { /* no gradebook yet */ }
    if (document.querySelector('bb-attempt-canvas')) kind = 'test';
    const key = `${location.pathname}|${kind}`;
    if (window.top === window && told !== key) {
      told = key;
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'glaze:attempt-kind', kind: kind || 'unknown' })).catch(() => {});
    }
    return kind;
  };
  // content.js's pass: boxes gone or unframed go, new ones open.
  const pass = () => {
    if (!on()) { dropAll(); return; }
    for (const box of [...boxes.values()]) {
      if (!sameBox(box)) drop(box);
      else if (box.frame && !box.frame.isConnected) { if (box.unsynced) reopen(box); else drop(box); }
    }
    if (!U()) { X.need('lib/writer-ultra.js', () => globalThis.GZ_WRITER_ULTRA).then(() => on() && pass(), () => {}); return; }
    const at = { path: location.pathname, attempt: attempt() };
    for (const b of U().boxes(document, at, (ed) => boxes.has(ed) || declined.has(ed) || Date.now() - (failed.get(ed) || 0) < 60000)) {
      mount(b);
    }
  };
  return { pass, drop: dropAll };
})();

GZ_WRITER;
