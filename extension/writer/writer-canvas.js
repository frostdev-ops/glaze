// Glaze Writer's Canvas adapter: which of Canvas's editor boxes Glaze's editor stands in for, as what, and what goes with
// each one (its send button, what it answers), answering what writer/page/writer.js asks of a site as
// writer/writer-ultra.js does for Ultra. Pure: elements in, values out. Shapes from the local Canvas 1c9f0bb8
// (test/fixtures/canvas-writer-*.html and canvas-writer-rce.json, captured 2026-11-09): the Rich Content Editor (TinyMCE 5) is
// a textarea Canvas marks data-rich_text once its editor is up, hidden by TinyMCE, with its frame <id>_ifr beside it in one
// .rce-wrapper; the Inbox writes in a plain textarea. A box whose shape wasn't seen there stays Canvas's own.
// Classic script, loaded on demand (writer/page/writer.js); module.exports for node.
var GZ_WRITER_CANVAS = globalThis.GZ_WRITER_CANVAS || (() => {
  const EDITOR = 'textarea[data-rich_text="true"]';
  const INBOX = '#compose-message-modal textarea[data-testid="message-body"]';
  const RESTORE = '[data-testid="RCE_RestoreAutoSaveModal"]';
  const plain = (ed) => ed?.tagName === 'TEXTAREA' && ed.getAttribute('data-testid') === 'message-body' && !!ed.closest('#compose-message-modal');
  // The whole editor (menus, toolbar, text, status bar), or the Inbox's field: what Glaze's editor takes the place of.
  const rootOf = (ed) => (plain(ed) ? ed.closest('label[data-cid="TextArea"]') || ed.parentElement : ed.closest('.rce-wrapper'));
  // The textarea carries data-gz-writer-id: writer/writer-main-canvas.js finds its editor as tinymce.get(textarea.id).
  const containerOf = (ed) => ed;

  // Kinds: 'assignment' (a classic assignment's Text Entry, or Assignments 2's), 'reply' (to a discussion or an announcement,
  // in its topic, a thread or split screen), 'message' (the Inbox) and 'test' (a classic quiz's essay, where the AI stays
  // off), else 'unknown' (left to Canvas): wiki pages, comments, editing a post, the teacher's side.
  const KINDS = ['assignment', 'reply', 'message', 'test', 'unknown'];
  const ASSIGNMENT = /^\/courses\/\d+\/assignments\/\d+\/?$/;
  const QUIZ = /^\/courses\/\d+\/quizzes\/\d+\/take(?:\/questions\/\d+)?\/?$/;
  const TOPIC = /^\/(?:courses|groups)\/\d+\/discussion_topics\/\d+\/?$/;
  const kindOf = (ed, { path = '' } = {}) => {
    if (plain(ed)) return /^\/conversations\/?$/.test(path) ? 'message' : 'unknown';
    if (ed?.closest?.(EDITOR) !== ed) return 'unknown';
    if (ASSIGNMENT.test(path)) {
      if (ed.id === 'submission_body' && ed.closest('form#submit_online_text_entry_form')) return 'assignment';
      if (ed.id === 'textentry_text' && ed.closest('[data-testid="text-editor"]')) return 'assignment';
      return 'unknown';
    }
    if (QUIZ.test(path)) return String(ed.className).split(/\s+/).includes('question_input') && ed.closest('form#submit_quiz_form') ? 'test' : 'unknown';
    // A reply's box is message-body-root (the topic's) or message-body-<entry> (a thread's); editing is <entry>-edit.
    if (TOPIC.test(path) && ed.closest('[data-testid="DiscussionEdit-container"]')) return /^message-body-(?:root|\d+)$/.test(ed.id) ? 'reply' : 'unknown';
    return 'unknown';
  };
  // The Inbox is plain text (paragraphs only); every other box writes compose in Canvas's dialect.
  const modeOf = (kind) => (kind === 'message' ? 'plain' : 'compose');

  const top = (e) => { while (e.parentNode) e = e.parentNode; return e; };
  const button = (e) => (!e ? null : e.tagName === 'BUTTON' ? e : e.querySelector('button'));
  // The button that sends the box: the Text Entry form's Submit, Assignments 2's Submit Assignment, a reply's Reply, the
  // Inbox's Send, a quiz's Submit Quiz (which Writer never presses itself).
  const sendOf = (ed, kind) => {
    if (kind === 'assignment') return ed.id === 'submission_body' ? ed.closest('form#submit_online_text_entry_form')?.querySelector('button[type="submit"]') || null : button(top(ed).querySelector('[data-testid="submit-button"]'));
    if (kind === 'reply') return button(ed.closest('[data-testid="DiscussionEdit-container"]')?.querySelector('[data-testid="DiscussionEdit-submit"]'));
    if (kind === 'message') return button(ed.closest('#compose-message-modal')?.querySelector('[data-testid="send-button"]'));
    if (kind === 'test') return ed.closest('form#submit_quiz_form')?.querySelector('#submit_quiz_button') || null;
    return null;
  };
  const enabled = (b) => !!b && !b.disabled && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true';

  // What the box answers: for now, whether a reply is to an announcement (its breadcrumb goes to the course's Announcements).
  const contextOf = (ed, kind) => {
    if (kind !== 'reply') return {};
    const crumbs = top(ed).querySelectorAll('#breadcrumbs a');
    return [...crumbs].some((a) => /^\/(?:courses|groups)\/\d+\/announcements\/?$/.test(a.getAttribute('href') || '')) ? { announcement: true } : {};
  };
  // A textarea id is stable while Canvas keeps the box; a reply's names its entry.
  const identity = (ed) => String(ed.id || '');

  // The RCE's own document: its frame's body (same origin, about:blank), or null before TinyMCE has drawn it.
  const frameOf = (ed) => (/^[\w-]{1,80}$/.test(ed.id || '') ? rootOf(ed)?.querySelector(`#${ed.id}_ifr`) || null : null);
  const bodyOf = (ed) => { try { return frameOf(ed)?.contentDocument?.body || null; } catch { return null; } };
  // TinyMCE's editor, drawn and in its WYSIWYG view: Canvas's HTML views hide it (or show the textarea), and while its
  // restore-autosave dialog is open the box is Canvas's until the student answers it.
  const ready = (ed) => {
    const root = rootOf(ed), box = root?.querySelector('.tox-tinymce');
    if (!root || !box || !frameOf(ed) || ed.style?.display !== 'none' || box.style?.display === 'none' || ed.parentElement?.style?.display === 'none') return false;
    return !top(ed).querySelector(RESTORE);
  };

  // A quick look before a frame opens: a box holding what Canvas's dialect in Writer can't keep stays Canvas's (colours,
  // sizes, h2, tables, pictures, embeds, maths, mentions, file links). It passes everything Writer writes and TinyMCE's own
  // bookkeeping (data-mce-* attributes, its bogus <br>); the frame's check (writer/writer-schema.js loses) has the last word.
  // It reads the box's HTML as read() gives it, tag by tag.
  const TAGS = new Set('P BR STRONG B EM I U S STRIKE DEL SUP SUB A H3 H4 OL UL LI PRE BLOCKQUOTE SPAN'.split(' '));
  const STYLE = {
    P: /^(text-align:\s*(left|center|right|justify)|padding-left:\s*(40|80|120|160|200|240|280|320)px)$/,
    LI: /^(text-align:\s*(left|center|right|justify)|list-style-type:\s*none)$/,
    SPAN: /^text-decoration:\s*(underline|line-through)$/,
  };
  STYLE.H3 = STYLE.H4 = STYLE.P;
  const ATTRS = { A: ['href', 'target', 'rel', 'title'] };
  const DECODE = { amp: '&', quot: '"', lt: '<', gt: '>', '#39': "'" };
  const tagOk = (tag, raw) => {
    if (!TAGS.has(tag)) return false;
    const attrs = {};
    for (const a of raw.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1].toLowerCase()] = (a[2] ?? a[3] ?? a[4] ?? '').replace(/&(amp|quot|lt|gt|#39);/g, (_, k) => DECODE[k]);
    for (const k of Object.keys(attrs)) if (!k.startsWith('data-mce-') && k !== 'style' && !ATTRS[tag]?.includes(k)) return false;
    const rules = String(attrs.style || '').split(';').map((r) => r.trim().toLowerCase()).filter(Boolean);
    if (!rules.every((r) => STYLE[tag]?.test(r)) || (tag === 'SPAN' && !rules.length)) return false;
    return tag !== 'A' || /^(https?:|mailto:|tel:\+?\d)/i.test(attrs.href || '');
  };
  const editable = (html) => [...String(html ?? '').matchAll(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)].every((m) => tagOk(m[1].toUpperCase(), m[2]));
  const canEdit = (ed) => plain(ed) || (!!bodyOf(ed) && editable(read(ed).html));

  // The Inbox's text as Writer's plain document holds it: a paragraph a line. Its text is what that HTML reads as.
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = (value) => String(value ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => (l ? `<p>${esc(l)}</p>` : '<p><br></p>')).join('');
  const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  const linesOf = (html) => String(html ?? '').split(/<\/p>/i).filter((p, i, all) => i < all.length - 1 || p.trim())
    .map((p) => p.replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, k) => ENTITY[k]).replace(/ /g, ' ')).join('\n');
  // The box's native HTML and text. An RCE's are its frame's body, as writer-main-canvas.js answers them; the Inbox's, its value
  // as paragraphs (the text, those paragraphs' text).
  const read = (ed) => {
    if (plain(ed)) { const html = paragraphs(ed.value); return { html, text: String(ed.value ?? '').replace(/\r?\n/g, '') }; }
    const b = bodyOf(ed);
    return b ? { html: b.innerHTML, text: b.textContent } : { html: '', text: '' };
  };
  // Writer's document into the box, through writer-main-canvas.js in the page's world: an RCE takes Canvas's dialect, the
  // Inbox its lines (the page's answer carries the value it then holds, as paragraphs here).
  const write = (box, html, delta, main) => {
    if (!plain(box.editor)) return main('canvas-set', { id: box.id, html });
    return main('canvas-set', { id: box.id, text: linesOf(html) }).map((r) => (r?.ok && typeof r.text === 'string' ? { ...r, html: paragraphs(r.text) } : { ok: false }));
  };
  // Canvas changing the box (a reset after Reply, its autosave restored, an undo): writer-main-canvas.js, asked to watch the
  // box, says so for its id, and an RCE's body is observed too; the Inbox's value changes only with an input event.
  const watch = (box, fn, observe, main) => {
    const doc = box.editor.ownerDocument, b = !plain(box.editor) && bodyOf(box.editor), o = b ? observe(b, fn) : null;
    if (b) main?.('canvas-watch', { id: box.id });
    const changed = (e) => { try { if (JSON.parse(e.detail)?.id === box.id) fn(); } catch { /* not ours */ } };
    doc?.addEventListener?.('gz-writer:canvas-changed', changed);
    if (plain(box.editor)) box.editor.addEventListener('input', fn);
    return { disconnect: () => { o?.disconnect(); doc?.removeEventListener?.('gz-writer:canvas-changed', changed); box.editor.removeEventListener('input', fn); } };
  };
  const NATIVE = 'Canvas editor';
  const attemptAt = () => null; // Canvas has no Ultra-style attempt pages: a quiz essay is a test by its route

  // Every Canvas box under `root` that Glaze's editor can stand in for, as
  // { editor, container, root, kind, mode, send, context, identity }. Skipped: an RCE not drawn yet (a quiz's essays past the
  // fifth until they scroll into view), in an HTML view or behind Canvas's restore dialog, a disabled Inbox field (it is
  // translating).
  const boxes = (root, at = {}, skip = () => false) => [...root.querySelectorAll(`${EDITOR}, ${INBOX}`)].map((editor) => {
    if (skip(editor)) return null;
    const kind = kindOf(editor, at);
    if (kind === 'unknown') return null;
    if (plain(editor) ? editor.disabled || editor.hasAttribute('disabled') || !rootOf(editor) : !ready(editor) || !canEdit(editor)) return null;
    return { editor, container: containerOf(editor), root: rootOf(editor), kind, mode: modeOf(kind), send: sendOf(editor, kind), context: contextOf(editor, kind), identity: identity(editor) };
  }).filter(Boolean);

  return { EDITOR, INBOX, KINDS, NATIVE, boxes, kindOf, rootOf, containerOf, identity, sendOf, enabled, contextOf, canEdit, editable, read, write, watch, attemptAt, paragraphs, linesOf };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_CANVAS;
GZ_WRITER_CANVAS;
