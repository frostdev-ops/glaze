// Glaze Writer's submit sheet (glaze-plans/writer/mockups D), in an assignment's paper frame: the first two pages as
// they're laid out and the .docx it makes, a note to the instructor, "Also paste the text in the text box", the open
// checks, Cancel and Submit. It opens from the paper's Submit… and from Ultra's own Submit (writer/page/writer-submit.js
// catches it). Its Submit, the student's click, runs the steps in order (writer/writer-submit.js): the paper saved as a
// 'sending' version, the .docx built, then the page attaches it through Ultra's upload, writes the note and text into
// Ultra's box and clicks Ultra's Submit once, the worker marking that version Submitted as it does (writer/writer-papers.js
// submitted). Every failure stops before that click, says why here, and the paper stays.
// Submit as is (a file the student brought, writer-import.js): the file large in place of the pages, the note, Cancel and
// Submit; the file's own bytes go to the page unchanged, and the paper is neither saved nor built. A PDF or deck shown in
// its viewer (writer-kinds.js) goes as its file large too, saved as a 'sending' version and built by its surface's file()
// (the PDF as saved, the deck as brought), named Lastname_Title with its own extension.
// Text already in Ultra's text box (the page says, at open and after a failure) is shown with Keep, off: off, the note and
// text replace it, or it's emptied; on, it goes as shown, the note and text after it.
// Attach from Documents: the student's documents of any kind (writer-paper.js pick), each exported by its kind's file()
// as it's picked (progress in its row), named Lastname_Title as the attempt's own file is, listed with its size and
// removable; up to 10, each at most Blackboard's 50 MB; the page hands each in after the attempt's own file, the note
// naming them and the 'sending' version keeping them (attached). Exports are staged in the file store (its orphan-file
// grace covers the open sheet), then transferred to the page one at a time. add({ name, mime, bytes }) stages an external file.
// The compact box's ⋯ → Attach from Documents opens the sheet with the files alone: Ultra's text box keeps the paper as
// the compact box wrote it, the note going after it.
// frame → page: submit:arm (this paper owns the attempt), submit:held, submit:go { run, name, bytes, note, text, held, keep,
//   until, asis, mime, kind, version }, submit:saved { ok }, submit:review; page → frame: submit:open, submit:held { text },
//   submit:save (Ultra's Save and Close), submit:step { run, step }, submit:done { run, ok, error }. A test's box is
//   compose, never a paper: it gets none of this.
// "Also paste the text" starts as it was at the last Submit while Settings → Writer → Submitting's remember is on
// (writer.submit: rememberText, text; writer/writer-settings.js), else off. Cancel and Escape keep nothing.
// Classic script after writer-paper.js.
var GZ_WRITER_SUBMIT_SHEET = globalThis.GZ_WRITER_SUBMIT_SHEET || (() => {
  const frame = globalThis.GZ_WRITER_FRAME;
  if (!frame) return null;
  const P = () => globalThis.GZ_WRITER_PAPER, L = () => globalThis.GZ_WRITER_SUBMIT_LIB;
  const t = (k, v) => frame.t(k, v);
  const nf = (n) => new Intl.NumberFormat(document.documentElement.lang || undefined).format(n);
  const SAYS = {
    save: 'The paper could not be saved. Nothing was submitted.',
    build: 'The .docx could not be made. Nothing was submitted.',
    made: 'The file could not be made. Nothing was submitted.',
    upload: 'Ultra’s file upload isn’t on this page. Nothing was submitted.',
    attach: 'Ultra didn’t list the file as attached. Nothing was submitted. Use Blackboard editor to review or remove the upload.',
    text: 'The text didn’t go into Ultra’s text box. Nothing was submitted.',
    submit: 'Ultra’s Submit didn’t turn on. Nothing was submitted.',
    page: 'The attempt page changed. Nothing was submitted.',
    busy: 'This attempt is already being submitted or needs review. Use Blackboard editor to continue.',
    review: 'Ultra may already have the file. Use Blackboard editor to review or remove it before submitting.',
    cancel: 'Submission stopped. Use Blackboard editor to review or remove any upload before submitting.',
    claimed: 'This attempt is already being submitted or needs review. Use Blackboard editor to continue.',
    large: 'A file is larger than 50 MB. Nothing was submitted.',
    file: 'A file could not be read. Nothing was submitted.',
    changed: 'The document changed or was deleted. Remove it and pick it again. Nothing was submitted.',
  };
  // A document of Documents as its file, { name, mime, bytes }: a paper as its .docx (as papers.js exports it), another
  // kind by its own file() (writer-kinds.js loads it), report hearing its progress (documents/doc-kinds.js progress).
  const DOCX = ['writer/writer-color.js', 'core/zip.js', 'core/doctext.js', 'writer/writer-docx.js', 'writer/writer-objects-docx.js'];
  let store = null;
  const exportDoc = async (row, report) => {
    const kind = row.kind || 'paper';
    if (kind === 'paper') {
      report({ stage: 'prepare' });
      await P().need(DOCX);
      const p = await (store ||= GZ_WRITER_PAPERS.open()).get(row.key);
      if (!p?.doc) return null;
      const f = GZ_WRITER_STYLES.get(p.format), surname = GZ_WRITER_FORMAT.surname(p.doc, f);
      const out = GZ_WRITER_DOCX.exportDocx(p.doc, { format: f, surname, title: p.title });
      return { name: L().fileName({ surname, title: p.title, fallback: t('Paper') }), mime: out.type, bytes: out.bytes };
    }
    const k = await globalThis.GZ_WRITER_KINDS?.kind(kind);
    return typeof k?.file === 'function' ? k.file(row.key, { progress: report }) : null;
  };
  const bufferOf = (b) => (b instanceof ArrayBuffer ? b : b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const files = async () => { await P().need(['documents/doc-files.js']); return GZ_DOC_FILES.client(); };
  const record = (key) => (store ||= GZ_WRITER_PAPERS.open()).get(key);
  const stamp = (p) => p && !GZ_WRITER_PAPERS.trashed(p) ? JSON.stringify([p.key, p.kind || 'paper', p.revision, p.updated, p.title]) : null;
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    e.append(...kids.flat().filter((x) => x != null && x !== false));
    return e;
  };

  // The first two pages, drawn small from the paged view itself: each sheet with its header and notes, and the text
  // flow clipped to that page (as the paper's print copy does).
  const previews = () => {
    const sheets = [...document.querySelectorAll('.gp-zoom .gp-sheet')].slice(0, 2), flow = document.querySelector('.gp-zoom > .gp-flow');
    const ST = globalThis.GZ_WRITER_STYLES, api = P()?.current();
    if (!sheets.length || !flow || !ST || !api) return [];
    const geo = ST.geometry(api.look?.() || api.format()), scale = 130 / geo.width;
    return sheets.map((sheet) => {
      const page = sheet.cloneNode(true), clip = h('div', { class: 'gs-clip' }), copy = flow.cloneNode(true);
      page.style.top = '0px';
      page.style.transform = `scale(${scale})`;
      clip.style.cssText = `top:${geo.top}px;width:${geo.width}px;height:${geo.body}px`;
      copy.style.top = `${-(parseFloat(sheet.style.top) || 0)}px`;
      copy.style.visibility = '';
      copy.querySelector('.ProseMirror')?.removeAttribute('contenteditable');
      clip.append(copy);
      page.append(clip);
      const thumb = h('div', { class: 'gs-thumb' }, page);
      thumb.style.height = `${Math.round(geo.height * scale)}px`;
      return thumb;
    });
  };

  // The big file's paper clip (the mockup's).
  const clip = () => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    s.setAttribute('viewBox', '0 0 24 44'); s.setAttribute('class', 'gs-clip');
    p.setAttribute('d', 'M17 14v18a5 5 0 0 1-10 0V8a3.5 3.5 0 0 1 7 0v22a1.8 1.8 0 0 1-3.6 0V14');
    s.append(p);
    return s;
  };

  let sheet = null, runs = 0, waiting = null, openings = 0;
  const close = () => {
    openings++;
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    s.stop?.();
    s.layer.remove();
    for (const [el, was] of s.inert) el.inert = was;
    if (s.back?.isConnected) s.back.focus();
  };
  // The compact box sends text through Ultra's own Submit: the sheet there is a brought file's (writer-import.js), or the
  // documents attached from Documents alone (opts.attach: the first one picked).
  const open = async (api = P()?.current(), file = null, opts = {}) => {
    if (!api || api.importing?.() || frame.mode() !== 'paper' || frame.kind() !== 'assignment' || (!file && api.compact?.() && !opts.attach)) return;
    if (sheet) { if (opts.attach) sheet.addDoc?.(opts.attach); sheet.first.focus(); return; }
    const opening = ++openings;
    await P().need(['writer/writer-submit.js']);
    // The sheet names the assignment (its heading, the file's name, the .docx's title): it waits for the page to say
    // which one this is (writer/writer-context-assignment.js), ten seconds at most.
    for (let i = 0; i < 50 && !api.context?.()?.assignment && opening === openings && P()?.current() === api; i++) await new Promise((r) => setTimeout(r, 200));
    if (sheet || opening !== openings || P()?.current() !== api || api.importing?.() || frame.mode() !== 'paper' || frame.kind() !== 'assignment') return;
    if (file) { const error = L().fileError(file); if (error) { api.notify?.(error); return; } }
    globalThis.GZ_WRITER_IMPORT?.close();
    // other: a kind's viewer (writer-kinds.js), its file the one built.
    const kindId = api.kind?.() || 'paper', other = !file && kindId !== 'paper', only = !file && !!api.compact?.();
    const ctx = api.context() || {}, paper = api.paper() || {}, view = api.editor?.view || null;
    const docNow = () => view?.state.doc ?? null, formatNow = () => JSON.stringify(api.format?.() ?? null);
    const snapshot = { doc: docNow(), format: formatNow(), key: api.key(), title: ctx.assignment?.title || paper.title || '' };
    const same = () => P()?.current() === api && docNow() === snapshot.doc && formatNow() === snapshot.format && api.key() === snapshot.key &&
      (api.context()?.assignment?.title || api.paper()?.title || '') === snapshot.title;
    const title = L().shortTitle(snapshot.title);
    const F = globalThis.GZ_WRITER_FORMAT;
    const surname = (view && F?.surname(view.state.doc, api.format())) || ctx.user?.family || '';
    // Whom the note is for: Ultra's name for them, else the one the student typed in the paper's heading.
    const instructor = String(ctx.instructor || (view && F?.read(view.state.doc, api.format())?.lines.instructor) || '').trim().slice(0, 80);
    let name = only ? null : file ? file.name : L().fileName({ surname, title, fallback: t('Paper'), ext: other ? api.ext?.() : '.docx' });
    const pages = api.pages() || (other ? 0 : 1), issues = file || other ? 0 : globalThis.GZ_WRITER_ISSUES?.list?.().length || 0;
    const kind = only ? '' : L().tag(name).toLowerCase();

    const note = h('textarea', { id: 'gs-note', maxlength: '4000', rows: '4' });
    const prefs = globalThis.GZ_WRITER_SETTINGS?.now()?.submit, remember = prefs?.rememberText !== false;
    const sw = h('button', { type: 'button', class: 'gs-sw', role: 'switch', 'aria-checked': String(remember && prefs?.text === true), id: 'gs-paste' });
    const size = h('small', { text: file ? t('{n} KB', { n: nf(L().kb(file.size)) }) : pages ? t('{n} pages', { n: pages }) : '' });
    const keep = h('button', { type: 'button', class: 'gs-sw', role: 'switch', 'aria-checked': 'false', id: 'gs-keep' });
    const shown = h('textarea', { id: 'gs-held', rows: '3', readonly: true, 'aria-labelledby': 'gs-keep-label' });
    const kept = [h('label', { class: 'gs-toggle', for: 'gs-keep' }, h('span', { id: 'gs-keep-label', text: t('Keep the text already in the text box') }), keep), h('div', { class: 'gs-field' }, shown)];
    const err = h('div', { class: 'gs-err', role: 'alert' });
    const native = h('button', { type: 'button', class: 'gs-native gs-review', text: t('Blackboard editor'), hidden: true });
    const cancel = h('button', { type: 'button', class: 'gs-btn', text: t('Cancel') });
    const submit = h('button', { type: 'button', class: 'gs-btn gs-primary', text: t('Submit') });
    const review = issues ? h('button', { type: 'button', class: 'gs-review', text: t('Review') }) : null;
    const atts = h('ul', { class: 'gs-atts' });
    const attachB = typeof P()?.pick === 'function' ? h('button', { type: 'button', class: 'gs-attach', text: t('Attach from Documents') }) : null;
    const driveB = globalThis.GZ_DRIVE?.page?.connected?.() === true ? h('button', { type: 'button', class: 'gs-attach gs-drive', text: t('From Google Drive') }) : null;
    const layer = h('div', { class: 'gs-layer' },
      h('div', { class: 'gs-dim' }),
      h('div', { class: `gs-sheet${file || other || only ? ' gs-asis' : ''}${only ? ' gs-only' : ''}`, role: 'dialog', tabindex: '-1', 'aria-modal': 'true', 'aria-labelledby': 'gs-title' },
        only ? null : h('div', { class: 'gs-prev' },
          file || other ? h('div', { class: 'gs-big', 'aria-hidden': 'true' }, clip(), h('span', { class: 'gs-doc', 'data-kind': kind, text: L().tag(name) })) : h('div', { class: 'gs-thumbs', 'aria-hidden': 'true' }, previews()),
          h('div', { class: 'gs-file' }, h('span', { class: 'gs-doc', 'data-kind': kind, 'aria-hidden': 'true', text: L().tag(name) }), h('div', {}, h('span', { class: 'gs-name', text: name }), size))),
        h('div', { class: 'gs-form' },
          h('h2', { id: 'gs-title', text: title ? t('Submit {title}', { title }) : t('Submit') }),
          h('div', { class: 'gs-body' },
          h('div', { class: 'gs-field' }, h('label', { for: 'gs-note', text: instructor ? t('Note to {name}', { name: instructor }) : t('Note to your instructor') }), note),
          file || other || only ? null : h('label', { class: 'gs-toggle', for: 'gs-paste' }, h('span', { text: t('Also paste the text in the text box') }), sw),
          atts, attachB, driveB,
          review ? h('div', { class: 'gs-open' }, h('span', { class: 'gs-dot' }), h('span', { class: 'gs-grow', text: t('{n} checks open', { n: issues }) }), review) : null,
          err, native),
          h('div', { class: 'gs-foot' }, cancel, submit))));
    const inert = [...document.body.children].map((el) => [el, el.inert]);
    for (const [el] of inert) el.inert = true;
    document.body.append(layer);
    sheet = { layer, first: note, back: document.activeElement !== document.body ? document.activeElement : document.querySelector('.gp-submit'), inert, busy: false };
    const mine = sheet;
    layer.getBoundingClientRect();
    layer.setAttribute('data-open', '');
    note.focus();

    // The file's size, once it's built (nothing leaves the frame until Submit); a brought file's pages, when it says.
    let built = null;
    const build = () => {
      const doc = docNow(), format = formatNow(), key = api.key();
      return api.file().then((out) => { built = { doc, format, key, out }; return out; });
    };
    const renameOwn = (out) => {
      const ext = /(\.[^./\\]+)$/.exec(String(out.name || ''))?.[1].toLowerCase();
      if (!other || !ext || L().kindOf(`x${ext}`) !== kindId) return false;
      const next = name.replace(/\.[^.]+$/, ext);
      if (next === name) return false;
      name = next;
      layer.querySelector('.gs-file .gs-name').textContent = name;
      for (const badge of layer.querySelectorAll('.gs-prev .gs-doc')) { badge.textContent = L().tag(name); badge.dataset.kind = L().tag(name).toLowerCase(); }
      for (const a of list) if (a.ref) take(a, { name: a.sourceName, mime: a.mime, bytes: { byteLength: a.size } });
      return true;
    };
    if (file) globalThis.GZ_WRITER_IMPORT?.about(file).then((s) => { if (sheet === mine) size.textContent = s; }, () => {});
    else if (!only) build().then((out) => { if (sheet === mine && !mine.busy) { renameOwn(out); size.textContent = [pages ? t('{n} pages', { n: pages }) : '', t('{n} KB', { n: nf(L().kb(out.bytes.length)) })].filter(Boolean).join(' · '); } }, () => {});

    sw.addEventListener('click', () => { if (!mine.busy) sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); });
    keep.addEventListener('click', () => { if (!mine.busy) keep.setAttribute('aria-checked', String(keep.getAttribute('aria-checked') !== 'true')); });
    // What Ultra's text box holds, as the page says: shown before the checks, or gone when it's empty.
    let held = '';
    mine.held = (text) => {
      if (mine.busy || typeof text !== 'string' || text === held) return;
      if (only) { held = text; return; }
      held = text;
      shown.value = text;
      keep.setAttribute('aria-checked', 'false');
      if (!text) for (const x of kept) x.remove();
      else if (!kept[0].isConnected) { const at = layer.querySelector('.gs-open') || err; for (const x of kept) at.before(x); }
    };
    const ask = () => frame.say({ type: 'submit:held' });
    ask();

    // ---- the attached files: metadata and a file-store ref once ready; making ones hold Submit
    const list = [];
    let making = 0, jobs = Promise.resolve(), picking = false;
    const alive = (a) => !a.gone && sheet === mine && !mine.cancelled;
    const unchanged = async (a) => { if (a.doc && stamp(await record(a.doc.key)) !== a.stamp) throw { error: 'changed', file: a.name || a.title }; };
    const validate = async () => { for (const a of list) await unchanged(a); };
    const stage = async (a, f) => {
      const why = L().handInError(f);
      if (why) throw { error: why, file: a.title };
      if (!alive(a)) return;
      const client = await files();
      if (!alive(a)) return;
      const ref = await client.put(new Uint8Array(bufferOf(f.bytes)), f.mime);
      if (!alive(a)) return;
      a.ref = ref; take(a, f);
    };
    const ready = () => {
      submit.disabled = mine.busy || picking || making > 0 || (only && !list.some((a) => a.ref));
      for (const b of [attachB, driveB]) if (b) b.disabled = mine.busy || list.length >= L().MAX_ATTACH || (b === driveB && picking);
    };
    const row = (label, tagText, kindTag) => {
      const nameEl = h('span', { class: 'gs-name', text: label }), sizeEl = h('small', {});
      const x = h('button', { type: 'button', class: 'gs-att-x', 'aria-label': t('Remove {name}', { name: label }), title: t('Remove') }, '×');
      const el = h('li', { class: 'gs-att' }, h('span', { class: 'gs-doc', 'data-kind': kindTag, 'aria-hidden': 'true', text: tagText }), h('div', {}, nameEl, sizeEl), x);
      atts.append(el);
      return { el, nameEl, sizeEl, x };
    };
    const drop = (a, focus) => {
      const i = list.indexOf(a);
      if (i < 0 || mine.busy) return;
      list.splice(i, 1); a.gone = true; a.stop?.(); a.ui.el.remove();
      if (focus) (list[Math.min(i, list.length - 1)]?.ui.x || attachB || note).focus();
      ready();
    };
    const take = (a, f) => {
      a.sourceName = f.name;
      a.name = L().attachName({ surname, title: a.title, fallback: t('Document'), name: f.name, taken: [name, ...list.filter((b) => b !== a && b.name).map((b) => b.name)].filter(Boolean) });
      a.mime = (typeof f.mime === 'string' && f.mime ? f.mime : L().mimeOf(a.name) || 'application/octet-stream').toLowerCase();
      a.size = f.bytes.byteLength;
      a.ui.nameEl.textContent = a.name;
      a.ui.el.querySelector('.gs-doc').textContent = L().tag(a.name);
      a.ui.el.querySelector('.gs-doc').dataset.kind = L().tag(a.name).toLowerCase();
      a.ui.sizeEl.textContent = t('{n} KB', { n: nf(L().kb(a.size)) });
      a.ui.x.setAttribute('aria-label', t('Remove {name}', { name: a.name }));
    };
    const refuse = (a, why) => { drop(a, false); err.textContent = why; };
    const room = () => { if (list.length < L().MAX_ATTACH) return true; err.textContent = t('Attach up to {n} documents.', { n: L().MAX_ATTACH }); return false; };
    // A document picked from Documents, exported here.
    mine.addDoc = (doc) => {
      if (mine.busy || sheet !== mine || !doc?.key || !room()) return;
      err.textContent = '';
      const title = doc.title || t('Untitled document'), a = { title, doc };
      const tag = L().tag(`x.${{ paper: 'docx', sheet: 'xlsx', pdf: 'pdf', slides: 'pptx' }[doc.kind || 'paper'] || 'file'}`);
      a.ui = row(title, tag, tag.toLowerCase());
      a.ui.x.addEventListener('click', () => drop(a, true));
      list.push(a);
      making++; ready();
      // Queue descriptors, never exported bytes. Every export is staged before the next one starts.
      jobs = jobs.then(async () => {
        if (!alive(a)) return;
        const p = await record(doc.key);
        if (!alive(a)) return;
        a.stamp = stamp(p);
        if (!a.stamp || (p.kind || 'paper') !== (doc.kind || 'paper') || p.updated !== doc.updated || (p.title || '') !== (doc.title || '')) throw { error: 'changed', file: title };
        // PDFs and decks have a known stored size: refuse before their kind reads the bytes.
        if (Math.max(p.size || 0, p.file?.size || 0) > L().MAX_FILE) throw { error: 'large', file: title };
        await P().need(['documents/doc-kinds.js']);
        if (!alive(a)) return;
        const id = doc.kind || 'paper';
        const report = GZ_DOC_KINDS.progress((p) => { if (p.end || p.failed || !alive(a)) return; const w = GZ_DOC_KINDS.said(p, id); if (w) a.ui.sizeEl.textContent = t(...w); }, id === 'pdf' || id === 'slides' ? ['copy'] : ['prepare']);
        let f;
        try { f = await exportDoc(doc, report); } finally { report.end(); }
        if (!alive(a)) return;
        await unchanged(a);
        if (!f || !(f.bytes?.byteLength > 0)) throw { error: 'made', file: title };
        await stage(a, f);
      }).catch((e) => {
        if (!alive(a)) return;
        refuse(a, e?.error === 'large' ? t('{name} is larger than 50 MB.', { name: title }) : e?.error === 'changed' ? `${title}: ${t(SAYS.changed)}` : t('{name} could not be made.', { name: title }));
      }).finally(() => { making--; if (sheet === mine) ready(); });
    };
    // An external caller retries after the current file is staged; accepting another buffer would retain both.
    mine.add = (f) => {
      if (mine.busy || making || sheet !== mine || !room()) return false;
      const why = L().handInError(f);
      if (why) { err.textContent = why === 'large' ? t('{name} is larger than 50 MB.', { name: String(f?.name || '') }) : t(SAYS.file); return false; }
      const a = { title: String(f.name).replace(/\.[^.]+$/, '') };
      a.ui = row(f.name, L().tag(f.name), L().tag(f.name).toLowerCase());
      a.ui.x.addEventListener('click', () => drop(a, true));
      list.push(a); making++; ready();
      jobs = jobs.then(() => stage(a, f)).catch(() => { if (alive(a)) refuse(a, t(SAYS.file)); }).finally(() => { making--; if (sheet === mine) ready(); });
      return true;
    };
    attachB?.addEventListener('click', async () => {
      if (mine.busy || !room()) return;
      const doc = await P().pick({ back: attachB });
      if (doc && sheet === mine) mine.addDoc(doc);
    });
    // From Google Drive (shown while Drive is connected): the files picked in Google's Picker (the worker opens it), each
    // read as it is through the worker's Drive port (documents/drive.js raw: any type up to 50 MB, a Google Doc, Sheet or
    // deck exported as Open from Drive exports it), one at a time in the attachments' queue, its row saying Reading… until
    // it's staged. Remove, Cancel or the sheet closing aborts its read, a stalled one included. A file that can't come names
    // itself and leaves the list.
    const SIGN_IN = ['off', 'connect', 'setup', 'account', 'auth', 'permission', 'scope', 'browser', 'unsupported', 'state'];
    const driveWhy = (why) => (why === 'cancel' ? '' : why === 'missing' || why === 'denied' ? t("Glaze can't reach this file in Google Drive.")
      : why === 'busy' ? t('Google Drive is busy. Try again in a moment.') : why === 'type' || why === 'bad' ? t('That file could not be read.')
      : SIGN_IN.includes(why) ? t('Connect Google Drive again in Settings.') : t("Couldn't reach Google Drive. Try again in a moment."));
    const tell = (why) => { if (why) err.textContent = err.textContent ? `${err.textContent} ${why}` : why; };
    const fromDrive = (f) => {
      const name = String(f.name), a = { title: name.replace(/\.[^.]+$/, '') };
      a.ui = row(name, L().tag(name), L().tag(name).toLowerCase());
      a.ui.x.addEventListener('click', () => drop(a, true));
      list.push(a);
      making++; ready();
      jobs = jobs.then(async () => {
        if (!alive(a)) return;
        const quit = new AbortController();
        a.stop = () => quit.abort();
        const report = GZ_DOC_KINDS.progress((p) => { if (p.end || p.failed || !alive(a)) return; const w = GZ_DOC_KINDS.said(p, 'paper'); if (w) a.ui.sizeEl.textContent = t(...w); }, ['read']);
        let file;
        try {
          file = await GZ_DRIVE.client().raw(f.id, (p) => report({ stage: 'read', ...p }), quit.signal);
        } catch (e) { throw { why: e?.why || 'network' }; } finally { report.end(); a.stop = null; }
        if (!alive(a)) return;
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!alive(a)) return;
        await stage(a, { name: file.name, mime: file.type, bytes });
      }).catch((e) => {
        if (!alive(a)) return;
        drop(a, false);
        tell(e?.why === 'size' || e?.error === 'large' ? t('{name} is larger than 50 MB.', { name }) : `${name}: ${(e?.why && driveWhy(e.why)) || t('That file could not be read.')}`);
      }).finally(() => { making--; if (sheet === mine) ready(); });
    };
    driveB?.addEventListener('click', async () => {
      if (mine.busy || picking || !room()) return;
      picking = true; err.textContent = ''; ready();
      let r = null;
      try { r = await chrome.runtime.sendMessage({ type: 'glaze:google', op: 'pick' }); } catch { r = null; }
      try {
        if (sheet !== mine || mine.busy || mine.cancelled) return;
        if (!r?.ok || !Array.isArray(r.files)) { tell(driveWhy(r?.why || 'network')); return; }
        if (!r.files.length) return; // the Picker closed
        await P().need(['documents/doc-kinds.js']);
        if (sheet !== mine || mine.busy || mine.cancelled) return;
        for (const f of r.files) {
          if (list.length >= L().MAX_ATTACH) { tell(t('Attach up to {n} documents.', { n: L().MAX_ATTACH })); break; }
          fromDrive(f);
        }
      } catch {
        if (sheet === mine && !mine.cancelled) tell(t('That file could not be read.'));
      } finally { picking = false; if (sheet === mine) ready(); }
    });
    mine.stop = () => { for (const a of list) a.stop?.(); };
    // What goes with the run: the files, the note naming them, and what the version keeps.
    const extras = () => {
      const ok = list.filter((a) => a.ref), names = ok.map((a) => a.name);
      return { files: ok.map((a) => ({ name: a.name, mime: a.mime, size: a.size })), note: L().noteWith(note.value, names, t('Attached: {names}', { names: '{names}' })),
        attached: ok.map((a) => ({ name: a.name, size: a.size, mime: a.mime })) };
    };
    ready();
    if (opts.attach) mine.addDoc(opts.attach);
    const cancelIt = () => {
      mine.cancelled = true;
      if (mine.busy) {
        frame.say({ type: 'submit:cancel', run: mine.run });
        if (waiting?.run === mine.run) waiting.done({ ok: false, error: 'page' });
        lock(false); submit.disabled = true; native.hidden = false;
        err.textContent = t(SAYS.cancel);
        ask();
        return;
      }
      close();
    };
    native.addEventListener('click', async () => {
      if (mine.busy || !await api.save()) return;
      mine.back = null; close(); frame.say({ type: 'submit:review' }); frame.say({ type: 'native' });
    });
    cancel.addEventListener('click', cancelIt);
    layer.querySelector('.gs-dim').addEventListener('click', cancelIt);
    review?.addEventListener('click', () => {
      if (mine.busy) return;
      mine.back = null;
      close();
      const tab = document.getElementById('gp-tab-checks');
      tab?.click();
      (document.querySelector('#gp-checks .gp-issue') || tab)?.focus();
    });
    layer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelIt(); return; }
      if (e.key !== 'Tab') return;
      const all = [...layer.querySelectorAll('textarea, button')].filter((x) => !x.disabled && !x.hidden);
      if (!all.length) { e.preventDefault(); layer.querySelector('.gs-sheet').focus(); return; }
      const i = all.indexOf(document.activeElement);
      if (e.shiftKey ? i <= 0 : i === all.length - 1) { e.preventDefault(); all[e.shiftKey ? all.length - 1 : 0].focus(); }
    });
    const lock = (on) => {
      mine.busy = on;
      for (const x of [note, sw, keep, submit, review, ...atts.querySelectorAll('button')]) if (x) x.disabled = on;
      if (!on) ready(); else for (const b of [attachB, driveB]) if (b) b.disabled = true;
      layer.querySelector('.gs-sheet').setAttribute('aria-busy', String(on));
      submit.textContent = on ? t('Submitting…') : t('Submit');
      if (on) cancel.focus();
    };
    // The page's steps, bounded: its answer, or 'page' after 85 seconds.
    // Each attached file has a minute more.
    const send = (run, m) => new Promise((resolve) => {
      const more = 60000 * (m.files?.length || 0), timer = setTimeout(() => resolve({ ok: false, error: 'page' }), 85000 + more);
      waiting = { run, step: (st) => { if (st === 'attach') submit.textContent = t('Attaching…'); else submit.textContent = t('Submitting…'); }, done: (x) => { clearTimeout(timer); resolve(x); } };
      mine.supply = async (index) => {
        try {
          if (mine.cancelled || sheet !== mine || !same()) throw { error: 'page' };
          if (index === list.length) { await validate(); return { ok: true }; }
          const a = list[index];
          if (!a?.ref) throw { error: 'file' };
          await unchanged(a);
          const bytes = bufferOf(await (await files()).get(a.ref));
          await unchanged(a);
          if (mine.cancelled || sheet !== mine || !same()) throw { error: 'page' };
          return { ok: true, bytes };
        } catch (e) { return { ok: false, error: e?.error || 'file', file: e?.file }; }
      };
      frame.say({ type: 'submit:go', run, ...m, stream: true, until: Date.now() + 80000 + more }, m.bytes ? [m.bytes] : []);
    }).finally(() => { if (waiting?.run === run) waiting = null; });
    submit.addEventListener('click', async (e) => {
      if (!e.isTrusted || mine.busy || mine.cancelled || picking || making > 0) return;
      const x = extras();
      if (only && !x.files.length) return;
      lock(true);
      err.textContent = ''; native.hidden = true;
      const run = mine.run = ++runs, paste = !file && !other && sw.getAttribute('aria-checked') === 'true', ultra = { held, keep: !!held && keep.getAttribute('aria-checked') === 'true' };
      const text = paste ? api.editor.text() : null;
      if (remember && !file && !other) globalThis.GZ_WRITER_SETTINGS?.patch((w) => ({ ...w, submit: { ...w.submit, text: paste } })).catch((e) => console.error(e));
      let s = L().start({ text: !!L().delta({ note: x.note, text: text || '' }), asis: !!file });
      try {
        await validate();
        if (mine.cancelled || sheet !== mine) throw 'page';
        if (file) {
          // As is: the student's own file, byte for byte; the paper isn't touched.
          if (mine.cancelled || sheet !== mine || P()?.current() !== api || api.key() !== snapshot.key || !L().may(s, 'attach')) throw 'page';
          let bytes;
          try { bytes = await file.arrayBuffer(); } catch (e) { console.error(e); throw 'page'; }
          if (mine.cancelled || sheet !== mine || P()?.current() !== api || api.key() !== snapshot.key || !L().fileBytes(file, bytes)) throw 'page';
          const r = await send(run, { key: snapshot.key, name, bytes, note: x.note, text: null, ...ultra, asis: true, mime: file.type || '', files: x.files });
          if (mine.cancelled || sheet !== mine) return;
          if (!r.ok) throw r;
          mine.back = null;
          lock(false);
          close();
          return;
        }
        if (mine.cancelled || sheet !== mine || !same()) throw 'page';
        const sending = await api.version('sending', { attached: x.attached.length ? x.attached : null });
        if (!sending) throw 'save';
        if (mine.cancelled || sheet !== mine || !same()) throw 'page';
        s = L().advance(s, { step: 'save' });
        if (only) {
          // The files alone: Ultra's text box as the compact box wrote it, the note after it.
          s = L().advance(s, { step: 'build' });
          const r = await send(run, { key: snapshot.key, note: x.note, text: null, ...ultra, keep: false, append: true, files: x.files, kind: 'paper', version: sending.version?.id ?? null });
          if (mine.cancelled || sheet !== mine) return;
          if (!r.ok) throw r;
          mine.back = null; lock(false); close();
          return;
        }
        let out;
        try { out = !other && built && built.doc === snapshot.doc && built.format === snapshot.format && built.key === snapshot.key ? built.out : await build(); } catch (e) { console.error(e); throw other ? 'made' : 'build'; }
        s = L().advance(s, { step: 'build' });
        if (mine.cancelled || !same() || !L().may(s, 'attach') || sheet !== mine) throw 'page';
        // A kind's file names its own extension (a spreadsheet with macros: .xlsm): the one sent says it too.
        if (renameOwn(out)) throw 'page'; // the student must review changed names before a fresh Submit
        const sent = name;
        const mime = out.mime || L().mimeOf(sent);
        built = null;
        const bytes = bufferOf(out.bytes); out = null;
        const r = await send(run, { key: snapshot.key, name: sent, bytes, note: x.note, text, files: x.files, ...ultra, kind: kindId, mime, version: sending.version?.id ?? null });
        if (mine.cancelled || sheet !== mine) return;
        if (!r.ok) throw r;
        mine.back = null;
        lock(false);
        close();
      } catch (code) {
        if (waiting?.run === run) waiting = null;
        const detail = code && typeof code === 'object' ? code : null;
        if (detail && !detail.error) console.error(code);
        if (mine.cancelled || sheet !== mine) return;
        lock(false);
        native.hidden = false;
        err.textContent = [detail?.file ? t('File: {name}.', { name: detail.file }) : '', t(SAYS[detail?.error || code] || SAYS.page), detail?.retained?.length ? t('Use Blackboard editor to review or remove these uploads: {names}.', { names: detail.retained.join(', ') }) : ''].filter(Boolean).join(' ');
        for (const a of list) if (a.name === detail?.file) { a.ui.el.setAttribute('data-error', ''); a.ui.sizeEl.textContent = t('Not attached'); }
        ask();
      }
    });
  };

  // The page catches Ultra's Submit from the frame's ready, a moment before the paper mounts: a press waits for the paper.
  const paper = async () => { for (let i = 0; i < 150 && !P()?.current(); i++) await new Promise((r) => setTimeout(r, 100)); return P()?.current() || null; };
  frame.handle('submit:open', async () => { const api = P()?.current() || await paper(); if (api) open(api); });
  frame.handle('submit:step', (m) => { if (waiting && m.run === waiting.run) waiting.step(m.step); });
  frame.handle('submit:held', (m) => { sheet?.held?.(m.text); });
  frame.handle('submit:unavailable', (m) => P()?.current()?.notify?.(m.action === 'save' ? 'Not saved. Try again in a moment.' : 'Nothing was submitted. Try again in a moment.'));
  frame.handle('submit:file', async (m) => {
    const mine = sheet;
    if (!mine?.busy || mine.cancelled || mine.run !== m.run || !Number.isInteger(m.index) || m.index < 0 || !mine.supply) return;
    const reply = await mine.supply(m.index);
    if (sheet === mine && mine.busy && !mine.cancelled) frame.say({ type: 'submit:file', run: m.run, index: m.index, ...reply }, reply.bytes ? [reply.bytes] : []);
  });
  frame.handle('submit:done', (m) => { if (waiting && m.run === waiting.run) waiting.done({ ok: m.ok === true, error: typeof m.error === 'string' ? m.error : 'page', file: m.file, retained: m.retained }); });
  // Ultra's Save and Close: the paper saved first (it attaches nothing), then the page lets Ultra's own go on. A press
  // made as the frame opened waits for the paper; a save the worker hasn't answered in SAVE_WAIT says so, and Ultra's
  // button stays (the save may still land; it sends nothing then).
  const SAVE_WAIT = 30000;
  frame.handle('submit:save', async (m) => {
    const api = P()?.current() || await paper();
    const doc = api?.editor?.view?.state.doc, key = api?.key();
    let ok = false;
    let timer;
    try {
      ok = !!(api && await Promise.race([api.save(), new Promise((r) => { timer = setTimeout(r, SAVE_WAIT, null); })]));
      ok = ok && P()?.current() === api && api.key() === key && (api.editor?.view?.state.doc ?? null) === (doc ?? null);
    } catch (e) { console.error(e); } finally { clearTimeout(timer); }
    if (!ok) api?.notify?.('Not saved. Try again in a moment.');
    frame.say({ type: 'submit:saved', request: m.request, ok });
  });
  frame.on('ready', () => {
    if (frame.mode() !== 'paper' || frame.kind() !== 'assignment' || !P()) return;
    P().submit = (api) => open(api);
    frame.say({ type: 'submit:arm' });
  });
  // add: a file from elsewhere ({ name, mime, bytes }) onto the open sheet's list (false when it isn't taken).
  return { open, close, add: (f) => !!sheet?.add?.(f), opened: () => !!sheet, busy: () => !!sheet?.busy };
})();
