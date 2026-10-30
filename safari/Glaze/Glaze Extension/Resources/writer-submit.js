// Glaze Writer's submit sheet (glaze-plans/writer/mockups D), in an assignment's paper frame: the first two pages as
// they're laid out and the .docx it makes, a note to the instructor, "Also paste the text in the text box", the open
// checks, Cancel and Submit. It opens from the paper's Submit… and from Ultra's own Submit (features/writer-submit.js
// catches it). Its Submit, the student's click, runs the steps in order (lib/writer-submit.js): the paper saved as a
// 'sending' version, the .docx built, then the page attaches it through Ultra's upload, writes the note and text into
// Ultra's box and clicks Ultra's Submit once, the worker marking that version Submitted as it does (lib/writer-papers.js
// submitted). Every failure stops before that click, says why here, and the paper stays.
// Submit as is (a file the student brought, writer-import.js): the file large in place of the pages, the note, Cancel and
// Submit; the file's own bytes go to the page unchanged, and the paper is neither saved nor built.
// Text already in Ultra's text box (the page says, at open and after a failure) is shown with Keep, off: off, the note and
// text replace it, or it's emptied; on, it goes as shown, the note and text after it.
// frame → page: submit:arm (this paper owns the attempt), submit:held, submit:go { run, name, bytes, note, text, held, keep,
//   until, asis, mime, version }, submit:saved { ok }, submit:review; page → frame: submit:open, submit:held { text },
//   submit:save (Ultra's Save and Close), submit:step { run, step }, submit:done { run, ok, error }. A test's box is
//   compose, never a paper: it gets none of this.
// "Also paste the text" starts as it was at the last Submit while Settings → Writer → Submitting's remember is on
// (writer.submit: rememberText, text; lib/writer-settings.js), else off. Cancel and Escape keep nothing.
// Classic script after writer-paper.js.
var GZ_WRITER_SUBMIT_SHEET = globalThis.GZ_WRITER_SUBMIT_SHEET || (() => {
  const frame = globalThis.GZ_WRITER_FRAME;
  if (!frame) return null;
  const P = () => globalThis.GZ_WRITER_PAPER, L = () => globalThis.GZ_WRITER_SUBMIT_LIB;
  const t = (k, v) => frame.t(k, v);
  const nf = (n) => new Intl.NumberFormat(document.documentElement.lang || undefined).format(n);
  const SAYS = {
    save: 'The paper could not be saved. Nothing was submitted.',
    docx: 'The .docx could not be made. Nothing was submitted.',
    upload: 'Ultra’s file upload isn’t on this page. Nothing was submitted.',
    attach: 'Ultra didn’t list the file as attached. Nothing was submitted. Use Blackboard editor to review or remove the upload.',
    text: 'The text didn’t go into Ultra’s text box. Nothing was submitted.',
    submit: 'Ultra’s Submit didn’t turn on. Nothing was submitted.',
    page: 'The attempt page changed. Nothing was submitted.',
    busy: 'This attempt is already being submitted or needs review. Use Blackboard editor to continue.',
    review: 'Ultra may already have the file. Use Blackboard editor to review or remove it before submitting.',
    cancel: 'Submission stopped. Use Blackboard editor to review or remove any upload before submitting.',
    claimed: 'This attempt is already being submitted or needs review. Use Blackboard editor to continue.',
  };
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
    s.layer.remove();
    for (const [el, was] of s.inert) el.inert = was;
    if (s.back?.isConnected) s.back.focus();
  };
  // The compact box sends text through Ultra's own Submit: the sheet there is a brought file's only (writer-import.js).
  const open = async (api = P()?.current(), file = null) => {
    if (!api || api.importing?.() || frame.mode() !== 'paper' || frame.kind() !== 'assignment' || (!file && api.compact?.())) return;
    if (sheet) { sheet.first.focus(); return; }
    const opening = ++openings;
    await P().need(['lib/writer-submit.js']);
    // The sheet names the assignment (its heading, the file's name, the .docx's title): it waits for the page to say
    // which one this is (lib/writer-context-assignment.js), ten seconds at most.
    for (let i = 0; i < 50 && !api.context?.()?.assignment && opening === openings && P()?.current() === api; i++) await new Promise((r) => setTimeout(r, 200));
    if (sheet || opening !== openings || P()?.current() !== api || api.importing?.() || frame.mode() !== 'paper' || frame.kind() !== 'assignment') return;
    if (file) { const error = L().fileError(file); if (error) { api.notify?.(error); return; } }
    globalThis.GZ_WRITER_IMPORT?.close();
    const ctx = api.context() || {}, paper = api.paper() || {}, view = api.editor.view;
    const snapshot = { doc: view.state.doc, format: JSON.stringify(api.format()), key: api.key(), title: ctx.assignment?.title || paper.title || '' };
    const same = () => P()?.current() === api && view.state.doc === snapshot.doc && JSON.stringify(api.format()) === snapshot.format && api.key() === snapshot.key &&
      (api.context()?.assignment?.title || api.paper()?.title || '') === snapshot.title;
    const title = L().shortTitle(snapshot.title);
    const F = globalThis.GZ_WRITER_FORMAT;
    const surname = F?.surname(view.state.doc, api.format()) || ctx.user?.family || '';
    // Whom the note is for: Ultra's name for them, else the one the student typed in the paper's heading.
    const instructor = String(ctx.instructor || F?.read(view.state.doc, api.format())?.lines.instructor || '').trim().slice(0, 80);
    const name = file ? file.name : L().fileName({ surname, title, fallback: t('Paper') });
    const pages = api.pages() || 1, issues = file ? 0 : globalThis.GZ_WRITER_ISSUES?.list?.().length || 0;
    const kind = L().tag(name).toLowerCase();

    const note = h('textarea', { id: 'gs-note', maxlength: '4000', rows: '4' });
    const prefs = globalThis.GZ_WRITER_SETTINGS?.now()?.submit, remember = prefs?.rememberText !== false;
    const sw = h('button', { type: 'button', class: 'gs-sw', role: 'switch', 'aria-checked': String(remember && prefs?.text === true), id: 'gs-paste' });
    const size = h('small', { text: file ? t('{n} KB', { n: nf(L().kb(file.size)) }) : t('{n} pages', { n: pages }) });
    const keep = h('button', { type: 'button', class: 'gs-sw', role: 'switch', 'aria-checked': 'false', id: 'gs-keep' });
    const shown = h('textarea', { id: 'gs-held', rows: '3', readonly: true, 'aria-labelledby': 'gs-keep-label' });
    const kept = [h('label', { class: 'gs-toggle', for: 'gs-keep' }, h('span', { id: 'gs-keep-label', text: t('Keep the text already in the text box') }), keep), h('div', { class: 'gs-field' }, shown)];
    const err = h('div', { class: 'gs-err', role: 'alert' });
    const native = h('button', { type: 'button', class: 'gs-native gs-review', text: t('Blackboard editor'), hidden: true });
    const cancel = h('button', { type: 'button', class: 'gs-btn', text: t('Cancel') });
    const submit = h('button', { type: 'button', class: 'gs-btn gs-primary', text: t('Submit') });
    const review = issues ? h('button', { type: 'button', class: 'gs-review', text: t('Review') }) : null;
    const layer = h('div', { class: 'gs-layer' },
      h('div', { class: 'gs-dim' }),
      h('div', { class: `gs-sheet${file ? ' gs-asis' : ''}`, role: 'dialog', tabindex: '-1', 'aria-modal': 'true', 'aria-labelledby': 'gs-title' },
        h('div', { class: 'gs-prev' },
          file ? h('div', { class: 'gs-big', 'aria-hidden': 'true' }, clip(), h('span', { class: 'gs-doc', 'data-kind': kind, text: L().tag(name) })) : h('div', { class: 'gs-thumbs', 'aria-hidden': 'true' }, previews()),
          h('div', { class: 'gs-file' }, h('span', { class: 'gs-doc', 'data-kind': kind, 'aria-hidden': 'true', text: L().tag(name) }), h('div', {}, h('span', { class: 'gs-name', text: name }), size))),
        h('div', { class: 'gs-form' },
          h('h2', { id: 'gs-title', text: title ? t('Submit {title}', { title }) : t('Submit') }),
          h('div', { class: 'gs-field' }, h('label', { for: 'gs-note', text: instructor ? t('Note to {name}', { name: instructor }) : t('Note to your instructor') }), note),
          file ? null : h('label', { class: 'gs-toggle', for: 'gs-paste' }, h('span', { text: t('Also paste the text in the text box') }), sw),
          review ? h('div', { class: 'gs-open' }, h('span', { class: 'gs-dot' }), h('span', { class: 'gs-grow', text: t('{n} checks open', { n: issues }) }), review) : null,
          err, native,
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
      const doc = view.state.doc, format = JSON.stringify(api.format()), key = api.key();
      return api.docx().then((out) => { built = { doc, format, key, out }; return out; });
    };
    if (file) globalThis.GZ_WRITER_IMPORT?.about(file).then((s) => { if (sheet === mine) size.textContent = s; }, () => {});
    else build().then((out) => { if (sheet === mine) size.textContent = `${t('{n} pages', { n: pages })} · ${t('{n} KB', { n: nf(L().kb(out.bytes.length)) })}`; }, () => {});

    sw.addEventListener('click', () => { if (!mine.busy) sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); });
    keep.addEventListener('click', () => { if (!mine.busy) keep.setAttribute('aria-checked', String(keep.getAttribute('aria-checked') !== 'true')); });
    // What Ultra's text box holds, as the page says: shown before the checks, or gone when it's empty.
    let held = '';
    mine.held = (text) => {
      if (mine.busy || typeof text !== 'string' || text === held) return;
      held = text;
      shown.value = text;
      keep.setAttribute('aria-checked', 'false');
      if (!text) for (const x of kept) x.remove();
      else if (!kept[0].isConnected) { const at = layer.querySelector('.gs-open') || err; for (const x of kept) at.before(x); }
    };
    const ask = () => frame.say({ type: 'submit:held' });
    ask();
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
      for (const x of [note, sw, keep, submit, review]) if (x) x.disabled = on;
      layer.querySelector('.gs-sheet').setAttribute('aria-busy', String(on));
      submit.textContent = on ? t('Submitting…') : t('Submit');
      if (on) cancel.focus();
    };
    // The page's steps, bounded: its answer, or 'page' after 85 seconds.
    const send = (run, m) => new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'page' }), 85000);
      waiting = { run, step: (st) => { if (st === 'attach') submit.textContent = t('Attaching…'); else submit.textContent = t('Submitting…'); }, done: (x) => { clearTimeout(timer); resolve(x); } };
      frame.say({ type: 'submit:go', run, ...m, until: Date.now() + 80000 });
    }).finally(() => { if (waiting?.run === run) waiting = null; });
    submit.addEventListener('click', async (e) => {
      if (!e.isTrusted || mine.busy || mine.cancelled) return;
      lock(true);
      err.textContent = ''; native.hidden = true;
      const run = mine.run = ++runs, paste = !file && sw.getAttribute('aria-checked') === 'true', ultra = { held, keep: !!held && keep.getAttribute('aria-checked') === 'true' };
      const text = paste ? api.editor.text() : null;
      if (remember && !file) globalThis.GZ_WRITER_SETTINGS?.patch((w) => ({ ...w, submit: { ...w.submit, text: paste } })).catch((e) => console.error(e));
      let s = L().start({ text: !!L().delta({ note: note.value, text: text || '' }), asis: !!file });
      try {
        if (file) {
          // As is: the student's own file, byte for byte; the paper isn't touched.
          if (mine.cancelled || sheet !== mine || P()?.current() !== api || api.key() !== snapshot.key || !L().may(s, 'attach')) throw 'page';
          let bytes;
          try { bytes = await file.arrayBuffer(); } catch (e) { console.error(e); throw 'page'; }
          if (mine.cancelled || sheet !== mine || P()?.current() !== api || api.key() !== snapshot.key || !L().fileBytes(file, bytes)) throw 'page';
          const r = await send(run, { key: snapshot.key, name, bytes, note: note.value, text: null, ...ultra, asis: true, mime: file.type || '' });
          if (mine.cancelled || sheet !== mine) return;
          if (!r.ok) throw r.error || 'page';
          mine.back = null;
          lock(false);
          close();
          return;
        }
        if (mine.cancelled || sheet !== mine || !same()) throw 'page';
        const sending = await api.version('sending');
        if (!sending) throw 'save';
        if (mine.cancelled || sheet !== mine || !same()) throw 'page';
        s = L().advance(s, { step: 'save' });
        let out;
        try { out = built && built.doc === snapshot.doc && built.format === snapshot.format && built.key === snapshot.key ? built.out : await build(); } catch (e) { console.error(e); throw 'docx'; }
        s = L().advance(s, { step: 'docx' });
        if (mine.cancelled || !same() || !L().may(s, 'attach') || sheet !== mine) throw 'page';
        const r = await send(run, { key: snapshot.key, name, bytes: out.bytes.slice().buffer, note: note.value, text, ...ultra, version: sending.version?.id ?? null });
        if (mine.cancelled || sheet !== mine) return;
        if (!r.ok) throw r.error || 'page';
        mine.back = null;
        lock(false);
        close();
      } catch (code) {
        if (waiting?.run === run) waiting = null;
        if (typeof code !== 'string') console.error(code);
        if (mine.cancelled || sheet !== mine) return;
        lock(false);
        native.hidden = false;
        err.textContent = t(SAYS[code] || SAYS.page);
        ask();
      }
    });
  };

  // The page catches Ultra's Submit from the frame's ready, a moment before the paper mounts: a press waits for the paper.
  const paper = async () => { for (let i = 0; i < 150 && !P()?.current(); i++) await new Promise((r) => setTimeout(r, 100)); return P()?.current() || null; };
  frame.handle('submit:open', async () => { const api = P()?.current() || await paper(); if (api) open(api); });
  frame.handle('submit:step', (m) => { if (waiting && m.run === waiting.run) waiting.step(m.step); });
  frame.handle('submit:held', (m) => { sheet?.held?.(m.text); });
  frame.handle('submit:done', (m) => { if (waiting && m.run === waiting.run) waiting.done({ ok: m.ok === true, error: typeof m.error === 'string' ? m.error : 'page' }); });
  // Ultra's Save and Close: the paper saved first (it attaches nothing), then the page lets Ultra's own go on. A press
  // made as the frame opened waits for the paper; a save the worker hasn't answered in SAVE_WAIT says so, and Ultra's
  // button stays (the save may still land; it sends nothing then).
  const SAVE_WAIT = 30000;
  frame.handle('submit:save', async (m) => {
    const api = P()?.current() || await paper();
    let ok = false;
    try { ok = !!(api && await Promise.race([api.save(), new Promise((r) => setTimeout(r, SAVE_WAIT, null))])); } catch (e) { console.error(e); }
    if (!ok) api?.notify?.('Not saved. Try again in a moment.');
    frame.say({ type: 'submit:saved', request: m.request, ok });
  });
  frame.on('ready', () => {
    if (frame.mode() !== 'paper' || frame.kind() !== 'assignment' || !P()) return;
    P().submit = (api) => open(api);
    frame.say({ type: 'submit:arm' });
  });
  return { open, close, opened: () => !!sheet, busy: () => !!sheet?.busy };
})();
