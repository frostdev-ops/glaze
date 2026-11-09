// Glaze Writer's hand in a Canvas page's own world: the only place Canvas's Rich Content Editor (TinyMCE, `tinymce.get`)
// can be reached. background/background.js puts it into a Canvas page that asked for a writer pass, with
// scripting.executeScript world MAIN (Chrome 95, Firefox 128, Safari 15.4), as it puts writer/writer-main.js into Ultra's.
// writer/page/writer.js asks it over document events, each detail a JSON string:
//   gz-writer:canvas-set { id, html } puts Writer's document, in Canvas's dialect (writer/writer-schema.js canvas) and
//     nothing else, into the box's editor as an edit Canvas hears: setContent, an undo step, then TinyMCE's change, which
//     Canvas's React state, a quiz's answer backup and its autosave all follow. { id, text } writes the Inbox's plain
//     textarea through the value setter React tracks, with a bubbling input event;
//   gz-writer:canvas-get { id };
//   gz-writer:canvas-exec { id, command } runs one of Canvas's Insert tools (image, media, document, equation, course
//     link) with the caret at the end of the box;
//   gz-writer:canvas-watch { id } from then on says gz-writer:canvas-changed { id } when Canvas changes the box itself
//     (its reset after Reply, its autosave restored, an undo), never for Writer's own writes;
//   each answered by gz-writer:done { id, ok, html, text } (the Inbox's: { id, ok, text }).
// The box is the textarea whose data-gz-writer-id is `id`: an RCE's must be the element of a drawn, shown TinyMCE 5-7 editor
// Canvas has marked ready (data-rich_text); the Inbox's is its compose dialog's message field. Nothing here moves focus but
// exec, which Canvas's tools need. Runs once per document.
(() => {
  if (document.documentElement.hasAttribute('data-gz-writer-main-canvas')) return;
  document.documentElement.setAttribute('data-gz-writer-main-canvas', '');
  const area = (id) => (typeof id === 'string' && /^[\w-]{1,64}$/.test(id) ? document.querySelector(`textarea[data-gz-writer-id="${id}"]`) : null);
  const inbox = (ta) => !!ta && ta.getAttribute('data-testid') === 'message-body' && !!ta.closest('#compose-message-modal') && ta.getAttribute('data-rich_text') !== 'true';
  const editor = (ta) => {
    const t = window.tinymce;
    if (!ta || ta.getAttribute('data-rich_text') !== 'true' || !t || !/^[5-7]$/.test(String(t.majorVersion)) || typeof t.get !== 'function') return null;
    const ed = t.get(ta.id);
    return ed && ed.getElement() === ta && ed.initialized && !ed.removed && !ed.isHidden() && ed.getBody() ? ed : null;
  };

  // Canvas's dialect, and nothing else: its tags, a link's address, and the styles Writer writes (alignment and 40px
  // indents on a block, the unmarked item a skipped list level sits in). No comments or other markup.
  const TAGS = new Set('p br strong em u s sup sub a h3 h4 ol ul li pre blockquote'.split(' '));
  const STYLE = {
    p: /^(text-align: (center|right|justify);)?( ?padding-left: (40|80|120|160|200|240|280|320)px;)?$/,
    li: /^(text-align: (center|right|justify);|list-style-type: none;)$/,
  };
  STYLE.h3 = STYLE.h4 = STYLE.p;
  const dialect = (html) => {
    if (typeof html !== 'string' || html.length > 2000000 || /<[!?]/.test(html)) return false;
    for (const m of html.matchAll(/<(\/?)([^\s>/]*)([^>]*)>/g)) {
      const tag = m[2].toLowerCase(), raw = m[3];
      if (!TAGS.has(tag)) return false;
      if (m[1]) { if (raw.trim()) return false; continue; }
      const attrs = [...raw.matchAll(/\s([a-z-]+)="([^"<>]*)"/g)];
      if (raw.replace(/\s([a-z-]+)="([^"<>]*)"/g, '').trim()) return false;
      for (const [, k, v] of attrs) {
        if (k === 'href' && tag === 'a' && v.length <= 2048 && /^(https?:\/\/|mailto:|tel:\+?\d)/i.test(v)) continue;
        if (k === 'style' && STYLE[tag]?.test(v)) continue;
        return false;
      }
    }
    return true;
  };
  const TOOLS = new Set(['instructureTrayForImages', 'mceInstructureImage', 'instructureRecord', 'instructureTrayForMedia', 'mceInstructureDocuments',
    'instructureTrayForDocuments', 'instructureEquation', 'instructureTrayForCourseLinks', 'instructureLinkCreate']);

  const done = (m) => document.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify(m) }));
  const answer = (ed) => ({ html: ed.getBody().innerHTML, text: ed.getBody().textContent });
  let own = false; // Writer's own write in progress: its events are no change of Canvas's
  const watched = new WeakSet();
  const on = (type, fn) => document.addEventListener(type, (e) => {
    let m;
    try { m = JSON.parse(e.detail); } catch { return; }
    try {
      const ta = area(m?.id), r = ta && fn(ta, m);
      done(r ? { id: m.id, ok: true, ...r } : { id: m?.id, ok: false });
    } catch { done({ id: m?.id, ok: false }); }
  });
  on('gz-writer:canvas-set', (ta, m) => {
    if (inbox(ta)) {
      if (ta.disabled || typeof m.text !== 'string' || m.text.length > 200000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(m.text) || m.html !== undefined) return null;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, m.text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return { text: ta.value };
    }
    const ed = editor(ta);
    if (!ed || m.text !== undefined || !dialect(m.html)) return null;
    own = true;
    try { ed.setContent(m.html); ed.undoManager.add(); ed.fire('change'); } finally { own = false; }
    return answer(ed);
  });
  on('gz-writer:canvas-get', (ta) => (inbox(ta) ? { text: ta.value } : editor(ta) && answer(editor(ta))));
  on('gz-writer:canvas-exec', (ta, m) => {
    const ed = editor(ta);
    if (!ed || !TOOLS.has(m.command)) return null;
    ed.focus();
    ed.selection.select(ed.getBody(), true);
    ed.selection.collapse(false);
    ed.execCommand(m.command);
    return answer(ed);
  });
  on('gz-writer:canvas-watch', (ta) => {
    const ed = editor(ta);
    if (!ed) return null;
    if (!watched.has(ed)) {
      watched.add(ed);
      ed.on('SetContent Change Undo Redo', () => {
        const id = ta.getAttribute('data-gz-writer-id');
        if (!own && id) document.dispatchEvent(new CustomEvent('gz-writer:canvas-changed', { detail: JSON.stringify({ id }) }));
      });
    }
    return answer(ed);
  });
})();
true;
