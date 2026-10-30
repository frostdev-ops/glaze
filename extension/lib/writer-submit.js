// Glaze Writer's submit step, the parts that decide: the paper's file name, where Ultra's upload control and footer
// buttons are on an assignment attempt (glaze-plans/writer/probe/skeleton-assignment-attempt.html, probed 2026-10-27), when
// the file shows as attached, the note and text as Quill ops, the order the steps run in, and where a file the student
// brings goes (a .docx asks, and a .pdf, .pptx or .ppsx while its kind opens in the frame; anything else is submitted as
// is). Pure: elements in, values out.
// The sheet (writer-submit.js) and the page's side (features/writer-submit.js) do the rest.
// Classic script, loaded on demand in the frame and the page; module.exports for node.
var GZ_WRITER_SUBMIT_LIB = globalThis.GZ_WRITER_SUBMIT_LIB || (() => {
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  // The files each document kind takes (lib/doc-kinds.js KINDS accept; test/writer-kinds-submit.test.js holds them equal),
  // with the type each is sent as. sheet: the spreadsheet kind's (sheets/grid), here so its files route once it opens.
  const EXT = Object.freeze({
    '.docx': { kind: 'paper', mime: MIME }, '.pdf': { kind: 'pdf', mime: 'application/pdf' },
    '.pptx': { kind: 'slides', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    '.ppsx': { kind: 'slides', mime: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow' },
    '.xlsx': { kind: 'sheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    // A workbook that keeps its macros (lib/sheet-xlsx.js extension) goes as Excel's macro-enabled file.
    '.xlsm': { kind: 'sheet', mime: 'application/vnd.ms-excel.sheet.macroEnabled.12' }, '.csv': { kind: 'sheet', mime: 'text/csv' },
    '.tsv': { kind: 'sheet', mime: 'text/tab-separated-values' },
  });
  const extOf = (name) => /(\.[^./\\]+)$/.exec(typeof name === 'string' ? name : '')?.[1].toLowerCase() || '';
  const kindOf = (name) => (Object.hasOwn(EXT, extOf(name)) ? EXT[extOf(name)].kind : null);
  // Each kind's Settings → Writer switch (storage.sync writer), and the kinds switched on in w.
  const SWITCH = Object.freeze({ pdf: 'pdf', slides: 'slides', sheet: 'sheets' });
  const switched = (w) => Object.keys(SWITCH).filter((id) => w?.[SWITCH[id]] === true);
  const mimeOf = (name) => (Object.hasOwn(EXT, extOf(name)) ? EXT[extOf(name)].mime : null);
  const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  // "Essay 2: Memory in Beloved" → "Essay 2": the title before its subtitle, as the mockup's sheet and file name have it.
  const shortTitle = (title) => { const t = squash(title), main = squash(t.split(/:\s/)[0]); return main || t; };
  // Each word capitalized and run together, letters and digits only: "Essay 2" → "Essay2".
  const word = (s) => squash(s).normalize('NFC').split(' ').map((w) => w.replace(/[^\p{L}\p{N}\p{M}]+/gu, '')).filter(Boolean).map((w) => { const [first, ...rest] = w; return first.toUpperCase() + rest.join(''); }).join('');
  // Cap both Unicode characters and UTF-8 bytes without cutting a surrogate pair. Leave room for suffixes and extension.
  const fit = (s, chars = 101, bytes = 240) => { let out = '', used = 0; for (const c of s) { const n = encodeURIComponent(c).replace(/%[0-9a-f]{2}|./gi, 'x').length; if ([...out].length >= chars || used + n > bytes) break; out += c; used += n; } return out; };
  // Lastname_Title and the kind's extension (Rivera_Essay2.docx, Rivera_FieldTrip.pdf); "Paper.docx" when neither is known.
  const fileName = ({ surname = '', title = '', fallback = 'Paper', ext = '.docx' } = {}) => {
    const parts = [fit(word(surname), 40), fit(word(shortTitle(title)), 60)].filter(Boolean);
    const e = String(ext).toLowerCase();
    return `${fit(parts.length ? parts.join('_') : word(fallback) || 'Paper')}${Object.hasOwn(EXT, e) ? e : '.docx'}`;
  };
  // A built file's name: letters, digits and _, then an extension of the kind it is (a paper's when none is said).
  const safeName = (n, kind = 'paper') => typeof n === 'string' && /^[\p{L}\p{N}\p{M}_]{1,101}\.[a-z]{3,4}$/u.test(n) && kindOf(n) === kind;
  const paperKey = (p = {}) => /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i.test(p.school || '') && [p.user, p.course, p.content].every((id) => /^_\d+_\d+$/.test(id || '')) ?
    `${p.school.toLowerCase()}|${p.user}|${p.course}|${p.content}` : null;
  const MAX_FILE = 50e6;
  const fileError = (f) => f?.size > MAX_FILE ? 'That file is too large.' :
    !f || !asIsName(f.name) || !Number.isSafeInteger(f.size) || f.size <= 0 || typeof f.type !== 'string' || f.type.length > 200 ? 'That file could not be read.' : null;
  const fileBytes = (f, bytes) => bytes instanceof ArrayBuffer && bytes.byteLength === f.size && !fileError(f);
  const kb = (bytes) => Math.max(1, Math.round((Number(bytes) || 0) / 1024));

  // ---- the hand-in: a file from any source ({ name, mime, bytes }: a document of Documents exported by its kind's file(),
  // a Drive file) attached beside the attempt's own file, each one at most Blackboard's 50 MB, at most MAX_ATTACH of them.
  const MAX_ATTACH = 10;
  // → null, or why not: 'large' (over 50 MB), 'file' (no bytes, a name a file can't have, no type).
  const handInError = (f) => {
    const n = f?.bytes instanceof ArrayBuffer || ArrayBuffer.isView(f?.bytes) ? f.bytes.byteLength : -1;
    if (n > MAX_FILE) return 'large';
    return n > 0 && asIsName(f.name) && typeof f.mime === 'string' && f.mime.length <= 200 ? null : 'file';
  };
  // A document's file name: Lastname_Title and its kind's extension, as the attempt's own file is named (a file of a type
  // no kind has keeps its own name), made unique against the names taken (any case) with _2, _3…
  const attachName = ({ surname = '', title = '', fallback = 'Document', name = '', taken = [] } = {}) => {
    const ext = extOf(name), known = Object.hasOwn(EXT, ext);
    const base = known ? fileName({ surname, title, fallback, ext }) : asIsName(name) ? name : fileName({ surname, title, fallback });
    const e = extOf(base), stem = e ? base.slice(0, -e.length) : base, used = new Set([...taken].map((x) => String(x).toLowerCase()));
    if (!used.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) {
      const tail = `_${i}`, n = `${fit(stem, (known ? 101 : 255 - e.length) - tail.length, 255 - e.length - tail.length)}${tail}${e}`;
      if (!used.has(n.toLowerCase())) return n;
    }
  };
  // The note to the instructor with the attached files named after it, on a line of their own (line: the words, as the
  // sheet's language says them, with {names}).
  const noteWith = (note, names = [], line = 'Attached: {names}') => {
    const n = String(note ?? '').replace(/\s+$/, ''), list = [...names].filter(Boolean).join(', ');
    return list ? [n, String(line).replace('{names}', () => list)].filter(Boolean).join('\n\n') : n;
  };
  // What the note sent to the page may hold: the student's 4,000 characters and the files' names.
  const MAX_NOTE = 4000 + MAX_ATTACH * 260;

  // ---- a file the student brings (writer-import.js): a .docx asks Open in Writer or Submit as is, and a file of a kind
  // that opens in the frame (kinds: its switch on, its viewer here; writer-kinds.js) Open in Glaze or Submit as is; any
  // other file goes straight to the submit sheet as is. forFile: the registry's (lib/doc-kinds.js) where it is loaded.
  const route = (name, { kinds = [], forFile = kindOf } = {}) => {
    const k = forFile(String(name || ''));
    return k === 'paper' || (!!k && [...kinds].includes(k)) ? 'choose' : 'submit';
  };
  // A file submitted as is keeps its own name: any name a file can have, never a path.
  const asIsName = (n) => typeof n === 'string' && /^[^/\\\u0000-\u001f\u007f]{1,255}$/u.test(n) && !/^\.*$/.test(n.trim());
  // The file's badge: its extension (DOCX, PDF), else FILE.
  const tag = (name) => (String(name || '').match(/\.([a-z0-9]{1,5})$/i)?.[1] || 'file').toUpperCase();
  // A Word file's page count as Word last saved it (docProps/app.xml), when it says.
  const pagesOf = (xml) => { const n = Number(String(xml || '').match(/<(?:\w+:)?Pages>\s*(\d{1,5})\s*</)?.[1]); return n > 0 ? n : 0; };

  // ---- Ultra's attempt page
  const PANEL = 'bb-assignment-attempt-authoring-panel';
  const SUBMIT = 'button[data-analytics-id="assignment.attempt.authoring.footer.submit"]';
  const SAVE = 'button[data-analytics-id="course.content.assessment.footer.buttons.saveAndClose"]';
  const panelOf = (ed) => ed?.closest?.(PANEL) || null;
  // The submission's part of the panel: its editor and, outside the editor, the separate file area.
  const areaOf = (ed) => ed?.closest?.('[class*="makeStylessubmission-"]') || panelOf(ed);
  const footer = (ed) => { const p = panelOf(ed); return { submit: p?.querySelector(SUBMIT) || null, save: p?.querySelector(SAVE) || null }; };
  const ACTIONS = { 'assignment.attempt.authoring.footer.submit': 'submit', 'course.content.assessment.footer.buttons.saveAndClose': 'save' };
  const actionOf = (b) => (b?.tagName === 'BUTTON' && Object.hasOwn(ACTIONS, b.getAttribute('data-analytics-id') || '') ? ACTIONS[b.getAttribute('data-analytics-id')] : null);
  // Ultra disables Submit and Save and Close while the attempt is empty (Mui marks them three ways).
  const enabled = (b) => !!b && !b.disabled && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true' && !String(b.className || '').split(/\s+/).includes('Mui-disabled');
  // The file area's own input (React's, hidden, multiple), else any file input in the submission outside Quill: never
  // the editor's own chooser (#browseForFiles), which Ultra appends to <body> after a toolbar click.
  const uploadInput = (area) => {
    if (!area) return null;
    const own = area.querySelector('[class*="makeStylespreview-"] [class*="makeStylesinputContainer-"] input[type="file"]');
    if (own) return own;
    return [...area.querySelectorAll('input[type="file"]')].find((i) => !i.closest('.ql-container') && i.id !== 'browseForFiles') || null;
  };
  // Where the file area takes a dropped file, when its input isn't drawn.
  const dropZone = (area) => area?.querySelector('[class*="makeStylesinputContainer-"]') || area?.querySelector('[class*="makeStylespreview-"]') || null;
  // Only full names prove a listing. A visually shortened label can carry the full name in its title.
  const TAGS = 'a, span, p, li, div, button, h3, h4, h5, td, label, strong';
  const listings = (area, name, visible = () => true) => {
    if (!area || !name) return [];
    const stem = String(name).replace(/\.[^.]+$/, '');
    const match = (e) => {
      const title = String(e.getAttribute('title') || '').trim(), text = String(e.textContent || '').trim();
      // Ultra can shorten the visible name; a full title with another extension must never prove this file.
      if (extOf(title)) return title === name;
      return [text, title].some((s) => s === name || s === stem);
    };
    return [...area.querySelectorAll(TAGS)].filter((e) => !e.firstElementChild && !e.closest('.ql-container') && !e.closest('[aria-live]') && !e.closest('[role="status"]') &&
      match(e) && visible(e));
  };
  const listed = (area, name, visible) => listings(area, name, visible).length;

  // ---- what goes into Ultra's text box: what it held (kept), the note, then the paper's text, as plain paragraphs Quill keeps
  const lines = (s) => {
    const out = [];
    for (const l of String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').split('\n')) {
      const x = l.replace(/\s+$/, '');
      if (x.trim() || (out.length && out.at(-1) !== '')) out.push(x.trim() ? x : '');
    }
    while (out.length && out.at(-1) === '') out.pop();
    return out;
  };
  // → Quill ops (one plain insert ending in a newline), or null when there's nothing to write.
  const delta = ({ kept = '', note = '', text = '' } = {}) => {
    const parts = [lines(kept), lines(note), lines(text)].filter((p) => p.length);
    if (!parts.length) return null;
    return [{ insert: `${parts.map((p) => p.join('\n')).join('\n\n')}\n` }];
  };

  // ---- the order: nothing reaches Ultra's Submit unless every step before it went through, in turn: the document saved, its
  // file built (a paper's .docx, a PDF as saved, a deck as brought). A file submitted as is skips both.
  const STEPS = ['save', 'build', 'attach', 'text', 'submit'];
  const start = ({ text = false, asis = false } = {}) => ({ plan: STEPS.filter((s) => (s !== 'text' || text) && !(asis && (s === 'save' || s === 'build'))), at: 0, done: false, error: null });
  const step = (s) => (s.done || s.error ? null : s.plan[s.at]);
  const advance = (s, ev = {}) => {
    if (s.done || s.error) return s;
    if (ev.error) return { ...s, error: String(ev.error) };
    if (ev.step !== s.plan[s.at]) return { ...s, error: 'order' };
    const at = s.at + 1;
    return { ...s, at, done: at === s.plan.length };
  };
  const may = (s, name) => step(s) === name;

  return { MAX_ATTACH, handInError, attachName, noteWith, MAX_NOTE, MIME, EXT, SWITCH, switched, kindOf, mimeOf, shortTitle, fileName, safeName, paperKey, MAX_FILE, fileError, fileBytes, kb, route, asIsName, tag, pagesOf, PANEL, SUBMIT, SAVE, panelOf, areaOf, footer, actionOf, enabled, uploadInput, dropZone, listings, listed, lines, delta, STEPS, start, step, advance, may };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_SUBMIT_LIB;
GZ_WRITER_SUBMIT_LIB;
