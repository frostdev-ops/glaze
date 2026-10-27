// Glaze Writer (enhance.writer), loaded on demand: content.js loads this once an Ultra editor box is on the page or
// written in, and hands it each pass. Every box lib/writer-ultra.js knows gets Glaze's editor (writer.html) in a frame in
// its place. Ultra's own editor stays in the page, hidden, and is kept in step through lib/writer-main.js in the page's
// world, so Ultra's Post, Reply, Send and Submit send what was written and its word count and drafts follow. Ctrl/Cmd+Enter
// in the frame clicks Post, Reply or Send when Ultra allows it (never an attempt's Submit). ⋯ → Blackboard editor gives
// the box back, to Ultra and to draft backup (features/drafts.js skips boxes marked data-gz-writer). Whatever fails leaves
// Ultra's editor, or puts it back with the text.
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

  // lib/writer-main.js, in the page's world: its answer comes back inside the dispatch, or not at all.
  const main = (op, m) => {
    let got = null;
    const hear = (e) => { try { const d = JSON.parse(e.detail); if (d?.id === m.id) got = d; } catch { /* not ours */ } };
    document.addEventListener('gz-writer:done', hear);
    try { document.dispatchEvent(new CustomEvent(`gz-writer:${op}`, { detail: JSON.stringify(m) })); } finally { document.removeEventListener('gz-writer:done', hear); }
    return got;
  };
  const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // ---- a box's life: asked for, opened, written in, given back -------------------------------------------------------
  let seq = 0;
  const mount = async (b) => {
    const box = { ...b, id: `gzw-${Date.now().toString(36)}-${(seq++).toString(36)}`, frame: null, port: null, text: squash(b.editor.textContent), display: null };
    boxes.set(b.editor, box);
    b.root.setAttribute('data-gz-writer', b.kind);
    b.container.setAttribute('data-gz-writer-id', box.id);
    // A one-use pass for the frame, which also puts lib/writer-main.js in this page (lib/background.js 'glaze:writer').
    const pass = crypto.randomUUID();
    const ok = await Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:writer', op: 'job', pass })).then((r) => r?.ok === true, () => false);
    if (boxes.get(b.editor) !== box) return;
    if (!ok || !b.editor.isConnected || !on()) { failed.set(b.editor, Date.now()); drop(box); return; }
    open(box, pass);
  };
  const open = (box, pass) => {
    const src = chrome.runtime.getURL('writer.html');
    const f = Object.assign(document.createElement('iframe'), { className: 'gz-writer', title: X.t('Glaze Writer') });
    f.setAttribute('data-gz-writer-frame', box.kind);
    // Out of sight until it says it's ready, then in the box's place at the box's height: the frame's 3px each side
    // holds its focus ring.
    f.style.cssText = `display:block;border:0;width:calc(100% + 6px);margin:-3px;height:${Math.max(120, Math.round(box.root.getBoundingClientRect().height)) + 6}px;background:transparent;color-scheme:${html.hasAttribute('data-gz-dark-theme') ? 'dark' : 'light'};position:absolute;opacity:0;pointer-events:none`;
    const ch = new MessageChannel();
    box.frame = f;
    box.port = ch.port1;
    ch.port1.onmessage = ({ data }) => { if (boxes.get(box.editor) === box && data && typeof data.type === 'string') hear(box, data); };
    box.wait = setTimeout(() => { failed.set(box.editor, Date.now()); drop(box); }, 15000);
    // Only to Glaze's own origin (spelled out: URL.origin of an extension scheme is "null" in some engines), so a frame
    // the page navigated elsewhere gets nothing.
    const origin = src.slice(0, src.indexOf('/', src.indexOf('://') + 3));
    f.addEventListener('load', () => f.contentWindow?.postMessage({ type: 'glaze:writer', pass }, origin, [ch.port2]), { once: true });
    f.src = src;
    box.root.before(f);
  };
  // The frame is up: it takes the box's text and place, and the box hides (still in the page, still synced).
  const swap = (box) => {
    clearTimeout(box.wait);
    const ed = box.editor, f = box.frame, typing = box.root.contains(document.activeElement);
    const l = look();
    worn = JSON.stringify(l);
    box.port.postMessage({ type: 'init', mode: box.mode, kind: box.kind, html: ed.innerHTML, placeholder: ed.getAttribute('data-placeholder') || '', look: l, context: box.context, locale: X.locale() });
    box.display = [box.root.style.getPropertyValue('display'), box.root.style.getPropertyPriority('display')];
    box.root.style.setProperty('display', 'none', 'important');
    for (const k of ['position', 'opacity', 'pointer-events']) f.style.removeProperty(k);
    if (l.motion !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches) f.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
    if (typing) { f.focus(); box.port.postMessage({ type: 'focus' }); }
    // Ultra changing its own editor (a post sent and cleared, its saved draft put back): the frame shows it. Its text, not
    // its markup, says so: Quill tidies markup after each sync.
    box.observer = new MutationObserver(() => {
      const now = squash(ed.textContent);
      if (now === box.text) return;
      box.text = now;
      box.port.postMessage({ type: 'html', html: ed.innerHTML });
    });
    box.observer.observe(ed, { childList: true, subtree: true, characterData: true });
  };
  const hear = (box, m) => {
    if (m.type === 'ready') swap(box);
    else if (m.type === 'height' && Number.isFinite(m.px)) box.frame.style.height = `${Math.max(40, Math.min(20000, Math.round(m.px)))}px`;
    else if (m.type === 'change' && typeof m.html === 'string') sync(box, m.html);
    else if (m.type === 'send') send(box);
    else if (m.type === 'native') giveBack(box, true);
  };
  // Each change goes into Ultra's editor as the student's own edit.
  const sync = (box, h) => {
    const r = main('set', { id: box.id, html: h });
    if (r?.ok) { box.text = squash(box.editor.textContent); return; }
    // Ultra's editor can't be reached: it comes back with what was written, typed in through the browser's own editing.
    giveBack(box, false);
    const ed = box.editor;
    ed.focus();
    getSelection().selectAllChildren(ed);
    document.execCommand('insertHTML', false, h);
  };
  // Ctrl/Cmd+Enter: Post, Reply or Send, once, when Ultra allows it (its Angular may enable the button a moment after
  // the edit that fills the box).
  const send = (box, again = true) => {
    if (!SENDS.has(box.kind)) return;
    const b = box.send?.isConnected ? box.send : U().sendOf(box.editor, box.kind);
    if (U().enabled(b)) b.click();
    else if (again) setTimeout(() => { if (boxes.get(box.editor) === box) send(box, false); }, 60);
  };
  // The frame out and Ultra's editor back, as it was.
  const drop = (box) => {
    boxes.delete(box.editor);
    clearTimeout(box.wait);
    box.observer?.disconnect();
    box.port?.close();
    box.frame?.remove();
    if (box.display) box.root.style.setProperty('display', ...box.display);
    if (box.display && !box.display[0]) box.root.style.removeProperty('display');
    box.root.removeAttribute('data-gz-writer');
    box.container.removeAttribute('data-gz-writer-id');
  };
  // Back to Blackboard's editor, which this editor then stays.
  const giveBack = (box, focus) => {
    drop(box);
    declined.add(box.editor);
    if (focus) box.editor.focus();
    globalThis.GZ_DRAFT_UI?.write({ type: 'input', target: box.editor }); // drafts keep what it holds from now
  };
  const dropAll = () => { for (const box of [...boxes.values()]) drop(box); };
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'sync' && (c.enabled?.newValue === false || c.enhance?.newValue?.writer === false)) dropAll();
  });

  // An attempt's kind, from the course's gradebook ('' until it answers). Once known, the top frame tells the worker, which
  // lets the AI work on an assignment's attempt and keeps it off a test's (lib/background.js 'glaze:attempt-kind').
  let told = '';
  const attempt = () => {
    const a = U().attemptAt(location.pathname);
    if (!a) return '';
    let kind = '';
    try { kind = U().attemptKind(X.bookFor(a.course)?.results, a.content); } catch { /* no gradebook yet */ }
    const key = `${location.pathname}|${kind}`;
    if (kind && window.top === window && told !== key) {
      told = key;
      Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:attempt-kind', kind })).catch(() => {});
    }
    return kind;
  };
  // content.js's pass: boxes gone or unframed go, new ones open.
  const pass = () => {
    if (!on()) { dropAll(); return; }
    for (const box of [...boxes.values()]) if (!box.editor.isConnected || (box.frame && !box.frame.isConnected)) drop(box);
    if (!U()) { X.need('lib/writer-ultra.js', () => globalThis.GZ_WRITER_ULTRA).then(() => on() && pass(), () => {}); return; }
    const at = { path: location.pathname, attempt: attempt() };
    for (const b of U().boxes(document, at)) {
      if (boxes.has(b.editor) || declined.has(b.editor) || Date.now() - (failed.get(b.editor) || 0) < 60000) continue;
      mount(b);
    }
  };
  return { pass, drop: dropAll };
})();

GZ_WRITER;
