// Glaze Writer's Ultra adapter: which of Ultra's Quill boxes Glaze's editor stands in for, as what, and what goes with
// each one (its send button, what it answers). Pure: elements in, values out; features/writer.js does the rest. Shapes
// from the owner's Ultra (4001.2.0, probed 2026-10-27, read-only); a box whose shape wasn't seen there stays Ultra's own.
// Classic script, loaded on demand (features/writer.js); module.exports for node.
var GZ_WRITER_ULTRA = globalThis.GZ_WRITER_ULTRA || (() => {
  const EDITOR = '.ql-editor[contenteditable="true"]';
  // A box's whole editor (toolbar, text, word count): what Glaze's editor takes the place of. Its Post or Send stays.
  const rootOf = (ed) => ed.closest('bb-rich-text-editor') || ed.closest('react-editor-wrapper') || ed.closest('.bb-editor-root') || ed.closest('.ql-container');
  const ATTEMPT = /^\/ultra\/courses\/(_\d+_\d+)\/(?:.*\/)?assessment\/(_\d+_\d+)\/attempt(?:\/|$)/;
  // An attempt page's course and content ids, or null.
  const attemptAt = (path) => { const m = ATTEMPT.exec(path || ''); return m ? { course: m[1], content: m[2] } : null; };
  // An attempt's kind from the course's gradebook rows (content-ultra.js bookFor): 'test', 'assignment', or '' while
  // unknown. assessmentSubtype is the field lib/ultra.js reads for tests (not yet seen live).
  const attemptKind = (rows, content) => {
    const cols = (Array.isArray(rows) ? rows : []).filter((r) => r?.column?.contentId === content).map((r) => r.column);
    return cols.some((c) => c.assessmentSubtype === 'Test') ? 'test' : cols.length && cols.every((c) => c.assessmentSubtype === 'Assignment') ? 'assignment' : '';
  };

  // Kinds: 'post' | 'reply' | 'message' | 'assignment' | 'test', else 'unknown' (left to Ultra). An attempt is an assignment
  // where Ultra draws its React authoring panel (it renders only for assignments) and a test in its attempt canvas, where
  // the AI stays off; attempt: the attempt's kind from the gradebook (attemptKind), which can only make it a test.
  // Journals and submission comments ('journal', 'comment') weren't seen on the owner's Ultra, and editing a post is
  // Ultra's: all 'unknown' for now.
  const KINDS = ['post', 'reply', 'message', 'journal', 'assignment', 'test', 'comment', 'unknown'];
  const SUBMISSION = 'bb-editorassignment-attempt-authoring-submission';
  const kindOf = (ed, { path = '', attempt = '' } = {}) => {
    if (ed?.closest?.(EDITOR) !== ed) return 'unknown';
    if (attemptAt(path)) {
      if (ed.closest('bb-attempt-canvas')) return 'test';
      return ed.id === SUBMISSION && ed.closest('bb-assignment-attempt-authoring-panel') ? (attempt === 'test' ? 'test' : 'assignment') : 'unknown';
    }
    if (ed.id === 'message-reply' && ed.closest('.message-reply-panel')) return 'message';
    if (!/\/discussion\//.test(path) || !ed.closest('form.text-editor-form')) return 'unknown';
    if (ed.closest('.reply-input-wrapper')) return ed.closest('.comment-and-reply') ? 'reply' : 'unknown';
    return !ed.closest('.comment-and-reply') && ed.closest('bb-rich-text-editor[analytics-id="components.directives.discussion.message.onEditorClick"]') ? 'post' : 'unknown';
  };
  // An assignment's attempt is a paper (paper mode: pages, formats, a .docx at submit); every other box writes compose,
  // which Ultra's Quill keeps exactly.
  const MODE = { assignment: 'paper' };
  // A quick look before a frame opens: a box with Ultra's embeds or extra formats stays native. It passes everything
  // compose itself writes (Quill's indent and alignment classes, its code blocks and cursor), so a box Writer has synced
  // stays Writer's; the frame's own check (lib/writer-schema.js loses) has the last word.
  const TAGS = new Set('P BR STRONG B EM I U S STRIKE DEL SUP SUB A H3 H4 OL UL LI PRE CODE SPAN'.split(' '));
  const CLASS = { P: /^(ql-indent-[1-8]|ql-align-(center|right|justify))$/, H3: null, H4: null, LI: null, PRE: /^ql-syntax$/, SPAN: /^ql-cursor$/ };
  CLASS.H3 = CLASS.H4 = CLASS.LI = CLASS.P;
  const classes = (e) => { const c = (e.getAttribute('class') || '').split(/\s+/).filter(Boolean); return !c.length || (!!CLASS[e.tagName] && c.every((k) => CLASS[e.tagName].test(k))); };
  const canEdit = (ed) => [...ed.querySelectorAll('*')].every((e) => TAGS.has(e.tagName) && !e.getAttribute('style') && classes(e) &&
    (e.tagName !== 'A' || /^(https?:|mailto:)/i.test(e.getAttribute('href') || '')) && !e.hasAttribute('dir') && !e.hasAttribute('start'));


  const top = (e) => { while (e.parentNode) e = e.parentNode; return e; };
  // The button that sends the box: Post or Reply (js-text-editor-save) in its form, Send in a message's panel, an
  // attempt's Submit (an assignment's in its panel's footer; a test's footer is drawn twice, outside the canvas).
  const sendOf = (ed, kind) => {
    if (kind === 'post' || kind === 'reply') return ed.closest('form.text-editor-form')?.querySelector('button.js-text-editor-save') || null;
    if (kind === 'message') return ed.closest('.message-reply-container')?.querySelector('button[data-analytics-id="components.directives.messages.courseConversation.sendMessage.button"]') || null;
    if (kind === 'assignment') return ed.closest('bb-assignment-attempt-authoring-panel')?.querySelector('button[data-analytics-id="assignment.attempt.authoring.footer.submit"]') || null;
    if (kind === 'test') return top(ed).querySelector('button[analytics-id="course.content.assessment.footer.buttons.submit"]');
    return null;
  };
  // Whether Ultra lets it send now: it disables Post, Reply and Submit while the box is empty.
  const enabled = (b) => !!b && !b.disabled && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true';

  const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const REPLY_TO = 'Reply to message from ';
  const replyTo = (ed) => { const thread = ed.closest('.comment-and-reply'); return thread?.getAttribute('message-id') || thread?.querySelector('[message-id]')?.getAttribute('message-id') || ''; };
  // A read-only Quill's text, a line per paragraph, heading or list item.
  const textOf = (ed) => {
    const blocks = ed ? [...ed.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, pre')] : [];
    return (blocks.length ? blocks.map((b) => squash(b.textContent)).filter(Boolean).join('\n') : squash(ed?.textContent)).slice(0, 20000);
  };
  // What the box answers, read off the page: for a reply, the post (its message id, author and text; the author from the
  // post's Reply button, whose label names them: English only, '' elsewhere); for an assignment, its instructions.
  const contextOf = (ed, kind) => {
    if (kind === 'assignment') {
      const text = textOf(top(ed).querySelector('#bb-editorassignment-attempt-authoring-instructions'));
      return text ? { prompt: text } : {};
    }
    if (kind !== 'reply') return {};
    const thread = ed.closest('.comment-and-reply');
    const post = [thread, ...thread.querySelectorAll('[message-id]')].find((e) => e.getAttribute('message-id'));
    if (!post) return {};
    const body = [...post.querySelectorAll('.ql-editor')].find((e) => e.getAttribute('contenteditable') === 'false' && !e.closest('.reply-input-wrapper'));
    const label = [...thread.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label')).find((l) => l.startsWith(REPLY_TO)) || '';
    return { post: { id: post.getAttribute('message-id'), author: squash(label.slice(REPLY_TO.length)).slice(0, 120), text: textOf(body) } };
  };

  // Every writable Quill box under `root` that Glaze's editor can stand in for, as
  // { editor, container, root, kind, mode, send, context }.
  const boxes = (root, at = {}, skip = () => false) => [...root.querySelectorAll(EDITOR)].map((editor) => {
    if (skip(editor)) return null;
    const kind = kindOf(editor, at), container = editor.closest('.ql-container');
    // Ultra's collapsed Post has not initialized its message model. Let its first click activate the native editor;
    // the toolbar appears then, and the next pass can replace it without bypassing that activation.
    if (kind === 'post' && !rootOf(editor).querySelector('.bb-editor-toolbar')) return null;
    return kind === 'unknown' || !container || !canEdit(editor) ? null : { editor, container, root: rootOf(editor), kind, mode: MODE[kind] || 'compose', send: sendOf(editor, kind), context: contextOf(editor, kind) };
  }).filter(Boolean);

  return { EDITOR, KINDS, boxes, kindOf, rootOf, sendOf, enabled, contextOf, replyTo, canEdit, attemptAt, attemptKind };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_ULTRA;
GZ_WRITER_ULTRA;
