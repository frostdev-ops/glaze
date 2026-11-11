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
  // The whole editor (menus, toolbar, text, status bar), or the Inbox's field itself (its InstUI label, and Canvas's messages
  // under it, stay shown): what Glaze's editor takes the place of.
  const rootOf = (ed) => (plain(ed) ? ed.parentElement : ed.closest('.rce-wrapper'));
  // The textarea carries data-gz-writer-id: writer/writer-main-canvas.js finds its editor as tinymce.get(textarea.id).
  const containerOf = (ed) => ed;

  // Kinds: 'assignment' (a classic assignment's Text Entry, or Assignments 2's), 'reply' (to a discussion or an announcement,
  // in its topic, a thread or split screen), 'message' (the Inbox) and 'test' (a classic quiz's essay, where the AI stays
  // off), else 'unknown' (left to Canvas): wiki pages, comments, editing a post, the teacher's side.
  const KINDS = ['assignment', 'reply', 'message', 'test', 'unknown'];
  const ASSIGNMENT = /^\/courses\/\d+\/assignments\/\d+\/?$/;
  const QUIZ = /^\/courses\/\d+\/quizzes\/\d+\/take(?:\/questions\/\d+)?\/?$/;
  const TOPIC = /^\/(?:courses|groups)\/\d+\/discussion_topics\/(\d+)\/?$/;
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
  // Every button that sends the box: its send, and on a quiz each of Canvas's buttons that records the answers (the form's
  // submit buttons with an action: Submit Quiz, and one question at a time Next and Previous; the times-up dialog's has none).
  const sends = (ed, kind) => kind === 'test' ? [...(ed.closest('form#submit_quiz_form')?.querySelectorAll('button[type="submit"][data-action]') || [])] : [sendOf(ed, kind)].filter(Boolean);
  const enabled = (b) => !!b && !b.disabled && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true';
  // The Inbox keeps Send enabled under its sending modal. Canvas's modal stack hides the underlying compose dialog.
  const busy = (ed) => plain(ed) && !!ed.closest('[aria-hidden="true"], [inert]');

  // What the box answers, the frame's `context` in the shape Ultra's has (writer/writer-context-assignment.js,
  // writer-context-discussion.js), read off the page Canvas drew, with no request: an assignment's title, due date and
  // description (its instructions); a reply's topic (its title and message, the prompt) and, for a reply to an entry, that
  // entry alone with its author; and whether a reply is to an announcement (its breadcrumb goes to the course's
  // Announcements). The Inbox gets none (a private thread is no course material) and a quiz page never builds one.
  // Text only, as Ultra's page reads take it: block by block, scripts, buttons and screen-reader-only words left out, within
  // LIMIT. Files the description links to aren't read (Ultra's reads stay Ultra's): the assignment says it is incomplete.
  // Seen on the local Canvas: the topic and entry bodies' data-resource-type/-id, the entry's author_name, the classic
  // page's #assignment_show (h1.title, its description, the hidden .timestamp), Assignments 2's title, description and
  // due-date testids. Not seen live, and gating nothing: announcement.reply, and a description's file link (data-api-returntype).
  const LIMIT = { prompt: 20000, post: 4000, name: 120, title: 300 };
  const squash = (s) => String(s ?? '').replace(/[ \t ]+/g, ' ').trim();
  const BLOCK = new Set('P DIV LI UL OL H1 H2 H3 H4 H5 H6 PRE BLOCKQUOTE TABLE TR'.split(' '));
  const SKIP = new Set('SCRIPT STYLE BUTTON SVG TEMPLATE NOSCRIPT IFRAME OBJECT'.split(' '));
  // An element's text, a line a block, at most n characters → { text, cut }.
  const textOf = (el, n) => {
    let out = '';
    const walk = (node, depth) => {
      if (out.length > n * 2) return;
      if (node.nodeType === 3) { out += node.textContent; return; }
      const tag = String(node.tagName || '').toUpperCase();
      if (!tag || SKIP.has(tag) || depth > 60 || String(node.className).split(/\s+/).includes('screenreader-only')) return;
      if (tag === 'BR') { out += '\n'; return; }
      const block = BLOCK.has(tag);
      if (block) out += '\n';
      for (const c of node.childNodes || node.children || []) walk(c, depth + 1);
      if (block) out += '\n';
    };
    if (el) walk(el, 0);
    const all = out.split('\n').map(squash).filter(Boolean).join('\n');
    return { text: all.slice(0, n), cut: all.length > n };
  };
  const line = (el, n) => squash(el?.textContent).replace(/\s+/g, ' ').slice(0, n);
  const courseOf = (doc, id) => {
    const a = [...doc.querySelectorAll('#breadcrumbs a')].find((x) => /^\/courses\/(\d+)\/?$/.exec(x.getAttribute('href') || '')?.[1] === id);
    return { id, name: line(a, LIMIT.name) };
  };
  const isoOf = (v) => { const t = new Date(v); return Number.isFinite(t.getTime()) ? t.toISOString() : null; };
  const FILE = 'a[data-api-returntype="File"], a[href*="/files/"]';
  const assignmentOf = (doc, ed, course) => {
    const classic = ed.id === 'submission_body', show = classic ? doc.querySelector('#assignment_show') : doc.querySelector('[data-testid="assignments-2-student-view"]');
    if (!show) return {};
    const body = classic ? show.querySelector('[data-resource-type="assignment.body"]') || show.querySelector('.description.user_content') : show.querySelector('[data-testid="assignments-2-assignment-description"]');
    const title = line(classic ? show.querySelector('h1.title') : show.querySelector('[data-testid="assignment-student-header"] [data-testid="title"]'), LIMIT.title);
    const stamp = classic ? squash(show.querySelector('.timestamp')?.textContent) : '';
    const due = classic ? (/^\d{9,11}$/.test(stamp) ? isoOf(Number(stamp) * 1000) : null) : isoOf(show.querySelector('time[data-testid="due-date"]')?.getAttribute('datetime') || '');
    const { text, cut } = textOf(body, LIMIT.prompt);
    const incomplete = cut || !!body?.querySelector(FILE);
    return { kind: 'assignment', course, assignment: { title, due, instructions: text, description: '', rubric: null, files: [], ...(incomplete && { incomplete: true }) } };
  };
  const replyOf = (doc, ed, course, topic) => {
    const body = doc.querySelector(`[data-resource-type="discussion_topic.body"][data-resource-id="${topic}"], [data-resource-type="announcement.body"][data-resource-id="${topic}"]`);
    const title = line(doc.querySelector('[data-testid="discussion-topic-container"] h1[data-testid="message_title"] [aria-hidden="true"]'), LIMIT.title);
    const prompt = [title, textOf(body, LIMIT.prompt).text].filter(Boolean).join('\n').slice(0, LIMIT.prompt);
    const entry = /^message-body-(\d+)$/.exec(ed.id)?.[1];
    const said = entry ? textOf(doc.querySelector(`[data-resource-type="discussion_topic.reply"][data-resource-id="${entry}"], [data-resource-type="announcement.reply"][data-resource-id="${entry}"]`), LIMIT.post).text : '';
    const replyTo = said ? { id: entry, author: line(doc.querySelector(`[data-entry-id="${entry}"] [data-testid="author_name"]`), LIMIT.name), text: said } : null;
    const announcement = [...doc.querySelectorAll('#breadcrumbs a')].some((a) => /^\/(?:courses|groups)\/\d+\/announcements\/?$/.test(a.getAttribute('href') || ''));
    return { kind: 'reply', course, prompt: prompt ? { text: prompt } : null, requirements: null, thread: [], replyTo, ...(announcement && { announcement: true }) };
  };
  const contextOf = (ed, kind, { path = '' } = {}) => {
    if (QUIZ.test(path) || kind === 'test' || !ed) return {};
    const doc = top(ed), course = /^\/courses\/(\d+)\//.exec(path)?.[1];
    const at = course ? courseOf(doc, course) : null;
    if (kind === 'assignment' && ASSIGNMENT.test(path)) return assignmentOf(doc, ed, at);
    const topic = TOPIC.exec(path)?.[1];
    if (kind === 'reply' && topic) return replyOf(doc, ed, at, topic);
    return {};
  };
  // Which of the prompt's targets a reply answers to (writer/writer-target.js forKind): a reply to the topic is Canvas's
  // own post on it, a reply to an entry a reply. Only replies have targets, as on Ultra only discussions do.
  const targetOf = (box) => (box?.kind !== 'reply' ? null : box.identity === 'message-body-root' ? 'post' : 'reply');
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
    return !restoring(ed);
  };
  // Canvas's restore-autosave dialog is open for the page's one Rich Content Editor (it may come after Writer opened).
  const restoring = (ed) => !plain(ed) && !!top(ed).querySelector(RESTORE);

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
  // An empty <span class="post_mention"> is where Canvas puts a reply's caret a second after the box opens (DiscussionEdit's
  // positionCursor): bookkeeping, as TinyMCE's own is.
  const editable = (html) => [...String(html ?? '').replace(/<span class="post_mention"><\/span>/g, '').matchAll(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)].every((m) => tagOk(m[1].toUpperCase(), m[2]));
  const canEdit = (ed) => plain(ed) ? !ed.disabled && !ed.readOnly && !ed.hasAttribute('disabled') && !ed.hasAttribute('readonly')
    : !!bodyOf(ed) && bodyOf(ed).getAttribute('contenteditable') !== 'false' && editable(read(ed).html);

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
  // box, says so for its id, and an RCE's body is observed too. The Inbox's value: an input event, or React setting it (the
  // signature Canvas adds once it has loaded it) or disabling the field (translating), which fire nothing, so it is looked at
  // twice a second.
  const watch = (box, fn, observe, main) => {
    const ed = box.editor, doc = ed.ownerDocument, b = !plain(ed) && bodyOf(ed), o = b ? observe(b, fn) : null;
    if (b) main?.('canvas-watch', { id: box.id });
    const changed = (e) => { try { if (JSON.parse(e.detail)?.id === box.id) fn(); } catch { /* not ours */ } };
    doc?.addEventListener?.('gz-writer:canvas-changed', changed);
    let last = plain(ed) ? ed.value : null, off = plain(ed) && ed.disabled;
    const look = plain(ed) && setInterval(() => { if (ed.value !== last || ed.disabled !== off) { last = ed.value; off = ed.disabled; fn(); } }, 500);
    const input = () => { last = ed.value; fn(); };
    if (plain(ed)) ed.addEventListener('input', input);
    return { disconnect: () => { o?.disconnect(); clearInterval(look); doc?.removeEventListener?.('gz-writer:canvas-changed', changed); ed.removeEventListener('input', input); } };
  };
  const NATIVE = 'Canvas editor';
  const attemptAt = () => null; // Canvas has no Ultra-style attempt pages: a quiz essay is a test by its route
  // Every Canvas send waits for the frame's document as it is now (writer/page/writer.js hold), not only its last change.
  const HOLD = true;
  // Assignments 2's Submit sends the draft Canvas saves a second after the box's last change (createSubmissionDraft), never
  // the box: its press waits until writer-main-canvas.js says that draft holds the box as it is now. Every other box's
  // send reads the box itself.
  const drafts = (ed) => ed.id === 'textentry_text';
  const kept = (box, main) => !drafts(box.editor) || main('canvas-draft', { id: box.id }).some((r) => r?.ok === true && r.kept === true);
  // ⋯ → Insert from Canvas: the frame's tool → Canvas's command (writer-main-canvas.js TOOLS), run once the box is Canvas's.
  const TOOLS = Object.freeze({ image: 'mceInstructureImage', media: 'instructureRecord', document: 'mceInstructureDocuments', equation: 'instructureEquation', link: 'instructureTrayForCourseLinks' });
  // A reply box opens to be written in: Canvas focuses its RCE a second after it is up, so Writer takes the caret as it opens.
  const focuses = (kind) => kind === 'reply';
  // Where the Text Entry form says an empty box won't submit. Canvas then focuses its editor, which is hidden under Writer.
  const errorsOf = (ed) => (ed.id === 'submission_body' && ed.closest('form#submit_online_text_entry_form')?.querySelector('#body_errors')) || null;
  // Back to Canvas's editor: the caret into its frame's body (TinyMCE follows its focus), or the Inbox's field.
  const focus = (ed) => {
    if (plain(ed)) { ed.focus(); return; }
    try { frameOf(ed)?.contentWindow?.focus(); bodyOf(ed)?.focus(); } catch { /* the frame went */ }
  };

  // Every Canvas box under `root` that Glaze's editor can stand in for, as
  // { editor, container, root, kind, mode, send, context, identity }. Skipped: an RCE not drawn yet (a quiz's essays past the
  // fifth until they scroll into view), in an HTML view or behind Canvas's restore dialog, a disabled Inbox field (it is
  // translating).
  const boxes = (root, at = {}, skip = () => false) => [...root.querySelectorAll(`${EDITOR}, ${INBOX}`)].map((editor) => {
    if (skip(editor)) return null;
    const kind = kindOf(editor, at);
    if (kind === 'unknown') return null;
    if (plain(editor) ? !canEdit(editor) || !rootOf(editor) : !ready(editor) || !canEdit(editor)) return null;
    return { editor, container: containerOf(editor), root: rootOf(editor), kind, mode: modeOf(kind), send: sendOf(editor, kind), context: contextOf(editor, kind, at), identity: identity(editor) };
  }).filter(Boolean);

  return { EDITOR, INBOX, KINDS, NATIVE, HOLD, TOOLS, drafts, kept, restoring, busy, focus, focuses, errorsOf, boxes, kindOf, rootOf, containerOf, identity, sendOf, sends, enabled, contextOf, targetOf, canEdit, editable, read, write, watch, attemptAt, paragraphs, linesOf };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_CANVAS;
GZ_WRITER_CANVAS;
