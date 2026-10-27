// Glaze Writer's submit sheet (glaze-plans/writer/mockups D), in an assignment's paper frame: the first two pages as
// they're laid out and the .docx it makes, a note to the instructor, "Also paste the text in the text box", the open
// checks, Cancel and Submit. It opens from the paper's Submit… and from Ultra's own Submit (features/writer-submit.js
// catches it). Its Submit, the student's click, runs the steps in order (lib/writer-submit.js): the paper saved as a
// 'submit' version, the .docx built, then the page attaches it through Ultra's upload, writes the note and text into
// Ultra's box and clicks Ultra's Submit once. Every failure stops before that click, says why here, and the paper stays.
// frame → page: submit:arm (this paper owns the attempt), submit:go { run, name, bytes, note, text, until },
//   submit:saved { ok }; page → frame: submit:open, submit:save (Ultra's Save and Close), submit:step { run, step },
//   submit:done { run, ok, error }. A test's box is compose, never a paper: it gets none of this.
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
    review: 'Ultra may already have the file. Use Blackboard editor to review or remove it before submitting.',
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
    const geo = ST.geometry(api.format()), scale = 130 / geo.width;
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

  let sheet = null, runs = 0, waiting = null;
  const close = () => {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    s.layer.remove();
    for (const [el, was] of s.inert) el.inert = was;
    if (s.back?.isConnected) s.back.focus();
  };
  const open = async (api = P()?.current()) => {
    if (!api || frame.mode() !== 'paper' || frame.kind() !== 'assignment') return;
    if (sheet) { sheet.first.focus(); return; }
    await P().need(['lib/writer-submit.js']);
    if (sheet) return;
    const ctx = api.context() || {}, paper = api.paper() || {}, view = api.editor.view;
    const snapshot = { doc: view.state.doc, format: JSON.stringify(api.format()), key: api.key(), title: ctx.assignment?.title || paper.title || '' };
    const same = () => P()?.current() === api && view.state.doc === snapshot.doc && JSON.stringify(api.format()) === snapshot.format && api.key() === snapshot.key &&
      (api.context()?.assignment?.title || api.paper()?.title || '') === snapshot.title;
    const title = L().shortTitle(snapshot.title);
    const F = globalThis.GZ_WRITER_FORMAT;
    const surname = F?.surname(view.state.doc, api.format()) || ctx.user?.family || '';
    // Whom the note is for: Ultra's name for them, else the one the student typed in the paper's heading.
    const instructor = String(ctx.instructor || F?.read(view.state.doc, api.format())?.lines.instructor || '').trim().slice(0, 80);
    const name = L().fileName({ surname, title, fallback: t('Paper') });
    const pages = api.pages() || 1, issues = globalThis.GZ_WRITER_ISSUES?.list?.().length || 0;

    const note = h('textarea', { id: 'gs-note', maxlength: '4000', rows: '4' });
    const sw = h('button', { type: 'button', class: 'gs-sw', role: 'switch', 'aria-checked': 'false', id: 'gs-paste' });
    const size = h('small', { text: t('{n} pages', { n: pages }) });
    const err = h('div', { class: 'gs-err', role: 'alert' });
    const cancel = h('button', { type: 'button', class: 'gs-btn', text: t('Cancel') });
    const submit = h('button', { type: 'button', class: 'gs-btn gs-primary', text: t('Submit') });
    const review = issues ? h('button', { type: 'button', class: 'gs-review', text: t('Review') }) : null;
    const layer = h('div', { class: 'gs-layer' },
      h('div', { class: 'gs-dim' }),
      h('div', { class: 'gs-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-title' },
        h('div', { class: 'gs-prev' },
          h('div', { class: 'gs-thumbs', 'aria-hidden': 'true' }, previews()),
          h('div', { class: 'gs-file' }, h('span', { class: 'gs-doc', 'aria-hidden': 'true', text: 'DOCX' }), h('div', {}, h('span', { class: 'gs-name', text: name }), size))),
        h('div', { class: 'gs-form' },
          h('h2', { id: 'gs-title', text: title ? t('Submit {title}', { title }) : t('Submit') }),
          h('div', { class: 'gs-field' }, h('label', { for: 'gs-note', text: instructor ? t('Note to {name}', { name: instructor }) : t('Note to your instructor') }), note),
          h('label', { class: 'gs-toggle', for: 'gs-paste' }, h('span', { text: t('Also paste the text in the text box') }), sw),
          review ? h('div', { class: 'gs-open' }, h('span', { class: 'gs-dot' }), h('span', { class: 'gs-grow', text: t('{n} checks open', { n: issues }) }), review) : null,
          err,
          h('div', { class: 'gs-foot' }, cancel, submit))));
    const inert = [...document.body.children].map((el) => [el, el.inert]);
    for (const [el] of inert) el.inert = true;
    document.body.append(layer);
    sheet = { layer, first: note, back: document.activeElement !== document.body ? document.activeElement : document.querySelector('.gp-submit'), inert, busy: false };
    const mine = sheet;
    layer.getBoundingClientRect();
    layer.setAttribute('data-open', '');
    note.focus();

    // The file's size, once it's built (nothing leaves the frame until Submit).
    let built = null;
    const build = () => {
      const doc = view.state.doc, format = JSON.stringify(api.format()), key = api.key();
      return api.docx().then((out) => { built = { doc, format, key, out }; return out; });
    };
    build().then((out) => { if (sheet === mine) size.textContent = `${t('{n} pages', { n: pages })} · ${t('{n} KB', { n: nf(L().kb(out.bytes.length)) })}`; }, () => {});

    sw.addEventListener('click', () => { if (!mine.busy) sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); });
    const cancelIt = () => { if (!mine.busy) close(); };
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
      const all = [...layer.querySelectorAll('textarea, button')].filter((x) => !x.disabled);
      const i = all.indexOf(document.activeElement);
      if (e.shiftKey ? i <= 0 : i === all.length - 1) { e.preventDefault(); all[e.shiftKey ? all.length - 1 : 0].focus(); }
    });
    const lock = (on) => {
      mine.busy = on;
      for (const x of [note, sw, cancel, submit, review]) if (x) x.disabled = on;
      layer.querySelector('.gs-sheet').setAttribute('aria-busy', String(on));
      submit.textContent = on ? t('Submitting…') : t('Submit');
    };
    submit.addEventListener('click', async () => {
      if (mine.busy) return;
      lock(true);
      err.textContent = '';
      const run = ++runs, paste = sw.getAttribute('aria-checked') === 'true';
      const text = paste ? api.editor.text() : null;
      let s = L().start({ text: !!L().delta({ note: note.value, text: text || '' }) });
      try {
        if (!same()) throw 'page';
        if (!await api.version('submit')) throw 'save';
        if (!same()) throw 'page';
        s = L().advance(s, { step: 'save' });
        let out;
        try { out = built && built.doc === snapshot.doc && built.format === snapshot.format && built.key === snapshot.key ? built.out : await build(); } catch (e) { console.error(e); throw 'docx'; }
        s = L().advance(s, { step: 'docx' });
        if (!same() || !L().may(s, 'attach') || sheet !== mine) throw 'page';
        const bytes = out.bytes.slice().buffer, until = Date.now() + 80000;
        const r = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ ok: false, error: 'page' }), 85000);
          waiting = { run, step: (st) => { if (st === 'attach') submit.textContent = t('Attaching…'); else submit.textContent = t('Submitting…'); }, done: (x) => { clearTimeout(timer); resolve(x); } };
          frame.say({ type: 'submit:go', run, name, bytes, note: note.value, text, until });
        });
        waiting = null;
        if (!r.ok) throw r.error || 'page';
        mine.back = null;
        lock(false);
        close();
      } catch (code) {
        waiting = null;
        if (typeof code !== 'string') console.error(code);
        lock(false);
        err.textContent = t(SAYS[code] || SAYS.page);
      }
    });
  };

  frame.handle('submit:open', () => { open(); });
  frame.handle('submit:step', (m) => { if (waiting && m.run === waiting.run) waiting.step(m.step); });
  frame.handle('submit:done', (m) => { if (waiting && m.run === waiting.run) waiting.done({ ok: m.ok === true, error: typeof m.error === 'string' ? m.error : 'page' }); });
  // Ultra's Save and Close: the paper saved first (it attaches nothing), then the page lets Ultra's own go on.
  frame.handle('submit:save', async () => {
    const api = P()?.current();
    let ok = false;
    try { ok = !!(api && await api.save()); } catch (e) { console.error(e); }
    frame.say({ type: 'submit:saved', ok });
  });
  frame.on('ready', () => {
    if (frame.mode() !== 'paper' || frame.kind() !== 'assignment' || !P()) return;
    P().submit = (api) => open(api);
    frame.say({ type: 'submit:arm' });
  });
  return { open, close, opened: () => !!sheet };
})();
