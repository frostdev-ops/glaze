// Glaze Writer's other document kinds in an assignment's frame (writer.html). An attempt whose record is a PDF or a slide
// deck (documents/doc-kinds.js) shows that kind's viewer in the paper's place, as a page of its own (pdf-kind.js: its pages, its
// form filled and saved; slides-kind.js: the deck to view), the paper parked (writer-paper.js hand). Open in Glaze, the
// import card's choice for a brought file whose kind's Settings → Writer switch is on (writer.pdf, writer.slides), saves
// the paper, then makes the attempt's record that kind with the file's bytes (the kind's into, whose 'import' save keeps
// the paper as a version first). The viewer's Submit… and Ultra's own open the submit sheet (writer-submit.js) on its
// surface, whose file() is the PDF as saved or the deck as brought. A Word file brought over a viewer makes the record a
// paper again (Open in Writer). An empty attempt offers Document or Spreadsheet while the spreadsheet kind is here
// (FRAME.sheet, sheets/grid's) and writer.sheets is on; until then nothing offers it.
// Classic script after writer-import.js.
var GZ_WRITER_KINDS = globalThis.GZ_WRITER_KINDS || (() => {
  const frame = globalThis.GZ_WRITER_FRAME;
  if (!frame) return null;
  const P = () => globalThis.GZ_WRITER_PAPER, L = () => globalThis.GZ_WRITER_SUBMIT_LIB;
  const t = (k, v) => frame.t(k, v);
  // What each kind loads in the frame (its switch: writer/writer-submit.js SWITCH).
  const FRAME = Object.freeze({
    pdf: Object.freeze({ scripts: ['documents/doc-kinds.js', 'documents/pdf/pdf-doc.js', 'documents/pdf/pdf-kind.js'], css: 'documents/pdf/pdf-kind.css' }),
    slides: Object.freeze({ scripts: ['documents/doc-kinds.js', 'documents/slides/slides-kind.js'], css: 'documents/slides/slides-kind.css' }),
    // The grid (sheet-kind.js loads its engine and sheet-grid.js itself) and the .xlsx codecs, so it reads and writes .xlsx.
    sheet: Object.freeze({ scripts: ['documents/doc-kinds.js', 'core/doctext.js', 'core/zip.js', 'documents/sheets/sheet-xlsx.js', 'documents/sheets/sheet-kind.js'], css: 'documents/sheets/sheet.css' }),
  });
  const prefs = () => globalThis.GZ_WRITER_SETTINGS?.now() || {};
  // The kinds a brought file may open as here: in this frame, and switched on.
  const opens = (w = prefs(), frameKinds = FRAME) => L().switched(w).filter((id) => Object.hasOwn(frameKinds, id));
  // What an empty attempt offers: Document and Spreadsheet once the spreadsheet kind is here and writer.sheets is on.
  const offers = (w = prefs(), frameKinds = FRAME, kinds = globalThis.GZ_DOC_KINDS?.KINDS) => (Object.hasOwn(frameKinds, 'sheet') && !!kinds?.sheet && L().switched(w).includes('sheet') ? ['paper', 'sheet'] : []);
  const sheets = new Map();
  const sheet = (href) => {
    if (!sheets.has(href)) sheets.set(href, new Promise((ok) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = ok; l.onerror = ok; document.head.append(l); }));
    return sheets.get(href);
  };
  const kind = async (id) => {
    if (!Object.hasOwn(FRAME, id)) return null;
    await P().need(FRAME[id].scripts);
    await Promise.all([sheet(FRAME[id].css), GZ_DOC_KINDS.settled()]);
    return GZ_DOC_KINDS.get(id);
  };
  let st = null;
  const store = () => (st ||= GZ_WRITER_PAPERS.open());

  // ---- the viewer in the paper's place. → its surface (what writer-paper.js makes current), or null.
  let shown = null, busy = false;
  const mount = async (id, key, paper) => {
    const k = await kind(id).catch((e) => { console.error(e); return null; });
    if (typeof k?.view !== 'function' || !key) return null;
    const rec = await store().get(key).catch(() => null);
    if (GZ_DOC_KINDS.kindOf(rec) !== id) return null;
    const root = document.documentElement, el = document.createElement('div'), was = root.dataset.view;
    el.className = 'gk';
    document.body.append(el);
    // The page first: the hidden paper's next height report would fold a compact frame to 40 px while the viewer builds.
    frame.say({ type: 'view', full: true });
    root.dataset.doc = id;
    root.dataset.view = 'full';
    let v = null;
    const ext = rec?.ext && GZ_DOC_KINDS.KINDS[id]?.accept.includes(rec.ext) ? rec.ext : GZ_DOC_KINDS.KINDS[id]?.accept[0] || '';
    const submitB = document.createElement('button');
    submitB.type = 'button'; submitB.className = 'gp-submit'; submitB.textContent = t('Submit…');
    submitB.disabled = typeof P().submit !== 'function';
    const owns = async () => GZ_DOC_KINDS.kindOf(await store().get(key)) === id;
    const surface = {
      // A spreadsheet's file always waits for the .xlsx writer (sheet-kind.js fileOf): .xlsm when its record says so.
      kind: () => id, key: () => key, ext: () => (id === 'sheet' ? (ext === '.xlsm' ? '.xlsm' : '.xlsx') : ext), context: () => paper.context(), paper: () => paper.paper(), compact: () => false, blank: () => false, importing: () => busy,
      pages: () => v?.pages?.() || null, notify: (m) => v?.say?.(t(m)), focused: () => {}, resume: () => {}, look: () => null,
      version: async (reason = 'submit', { attached = null } = {}) => {
        if (!await surface.save()) return null;
        if (typeof k.version === 'function') return k.version(key, reason, { attached }).catch((e) => { console.error(e); return null; });
        return store().save(key, {}, { reason, expectedKind: id, ...(attached && { attached }) }).catch((e) => { console.error(e); return null; });
      },
      save: async () => !!v && await owns() && await v.save() && await owns(),
      file: async () => { if (!await owns()) throw new Error('document kind changed'); const out = await v.file(); if (!await owns()) throw new Error('document kind changed'); return out; },
      importFile: (f) => open(surface, f),
      // Ultra's buttons over a compact box never reach a viewer: the page treats it as the full view (view below).
      flush: (request) => frame.say({ type: 'compact:flushed', request, ok: false }),
    };
    submitB.addEventListener('click', () => P().submit?.(surface));
    try {
      v = await k.view(key, { mount: el, t, title: () => paper.context()?.assignment?.title || '', tools: [submitB] });
      if (!await owns()) throw new Error('document kind changed');
    } catch (e) {
      console.error(e);
      try { await v?.dispose?.(); } catch (e) { console.error(e); }
      el.remove(); delete root.dataset.doc;
      if (was !== 'full') { if (was) root.dataset.view = was; else delete root.dataset.view; frame.say({ type: 'view', full: false }); }
      return null;
    }
    if (typeof P().submit === 'function') submitB.disabled = false;
    shown = { id, key, el, surface, paper, viewer: v };
    return surface;
  };
  const unmount = async () => {
    if (!shown) return;
    await shown.viewer?.dispose?.();
    shown.el.remove();
    delete document.documentElement.dataset.doc;
    shown = null;
  };

  // ---- Open in Glaze: a brought file of a kind that opens here becomes the attempt's record, and shows. api: the paper
  // or the viewer that shows now.
  let arriving = null;
  const said = (k, e) => (e instanceof RangeError && Object.values(k?.says || {}).includes(e.message) ? e.message : k?.says?.read || 'That file could not be read.');
  const open = async (api, f) => {
    if (busy || !f) return;
    const id = L().kindOf(f.name);
    if (id === 'paper') { if (shown) await back(f); else await api.importFile(f, { full: true }); return; }
    if (!opens().includes(id)) return;
    busy = true;
    const paper = shown ? shown.paper : api, key = paper.key();
    let k = null;
    try {
      k = await kind(id);
      if (typeof k?.into !== 'function' || !key) throw new Error('no viewer');
      // The paper's last words saved first: into's 'import' save keeps them as the version.
      if (shown) { if (!await (shown.id === 'sheet' ? shown.surface.version('import') : shown.surface.save())) throw new Error('not saved'); }
      else if (!await paper.save()) throw new Error('paper could not be saved');
      paper.hold();
      // The file arriving, stage by stage (documents/doc-kinds.js progress): in the paper's status bar, or the viewer's line,
      // until its viewer shows (finally, below).
      const steps = id === 'sheet' ? ['read', 'prepare', 'save'] : ['read', 'prepare', 'copy', 'save'];
      let stage = null;
      const progress = GZ_DOC_KINDS.progress((p) => {
        const w = GZ_DOC_KINDS.said(p, id);
        if (!w || p.end || p.failed) return;
        if (shown) {
          if (stage !== p.stage) { stage = p.stage; shown.viewer?.say?.(t(...GZ_DOC_KINDS.said(p, id, { spoken: true }))); }
        }
        else paper.arriving?.({ name: f.name, text: t(...w), spoken: t(...GZ_DOC_KINDS.said(p, id, { spoken: true })), fraction: p.fraction });
      }, steps);
      arriving = paper;
      const rec = await k.into(key, f, { progress });
      progress.end();
      if (shown) { await unmount(); const s = await mount(id, key, paper); if (!s) { frame.say({ type: 'native', reason: 'kind' }); throw new Error('no viewer'); } paper.take(s); }
      else if (!await paper.hand(rec)) throw new Error('no viewer');
      if (rec?.notice) shown?.surface.notify(rec.notice);
    } catch (e) {
      console.error(e);
      paper.release();
      (shown?.surface || paper).notify?.(said(k, e));
    } finally { busy = false; arriving?.arriving?.(null); arriving = null; }
  };
  // A Word file over a viewer: the record a paper again (its kind's fields cleared), then the file opens as a paper does.
  const back = async (f) => {
    const { paper, surface, el } = shown;
    busy = true;
    try {
      if (!await (shown.id === 'sheet' ? surface.version('import') : surface.save())) throw new Error('not saved');
      el.inert = true;
      paper.unpark();
      // The paper importer validates and writes the Word document in one import save. A refusal leaves this file intact.
      if (!await paper.importFile(f, { full: true, fromKind: true })) { paper.take(surface); return; }
      await unmount();
    } catch (e) { console.error(e); paper.take(surface); surface.notify('Not saved. Try again in a moment.'); }
    finally { el.inert = false; busy = false; }
  };

  // ---- an empty attempt: Document or Spreadsheet (offers above). Spreadsheet makes the record the sheet kind, empty.
  // any: ⋯ → New spreadsheet, over a paper with words in it too (kept as the version).
  const start = async (paper, id, { any = false } = {}) => {
    if (busy || !offers().includes(id) || id === 'paper' || (!any && !paper.blank())) return;
    busy = true;
    try {
      const k = await kind(id);
      if (typeof k?.view !== 'function') throw new Error('no viewer');
      if (!await paper.save()) throw new Error('paper could not be saved');
      paper.hold();
      const r = await store().save(paper.key(), { kind: id, doc: null, words: 0, ...(k.empty?.() || {}) }, { reason: 'import' });
      if (!await paper.hand(r.paper)) throw new Error('no viewer');
    } catch (e) { console.error(e); paper.release(); paper.notify('Not saved. Try again in a moment.'); } finally { busy = false; }
  };
  const choice = (paper) => {
    if (offers().length < 2 || !paper.blank() || paper.kind?.() !== 'paper' || document.querySelector('.gk-choose')) return null;
    const row = document.createElement('div');
    row.className = 'gk-choose';
    row.setAttribute('role', 'group');
    const dismiss = () => { row.remove(); (paper.compact?.() ? frame.editor?.() : paper.editor)?.focus(); };
    row.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); } });
    for (const [id, label] of [['paper', 'Document'], ['sheet', 'Spreadsheet']]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'gk-pick'; b.dataset.kind = id; b.textContent = t(label);
      b.addEventListener('click', () => { if (id === 'paper') dismiss(); else { row.remove(); start(paper, id); } });
      row.append(b);
    }
    document.getElementById('gw')?.prepend(row);
    return row;
  };
  let readyPaper = null, newSheet = null;
  const refreshChoices = () => {
    if (!readyPaper) return;
    const paper = P()?.current();
    if (paper?.kind?.() !== 'paper' || offers().length < 2) {
      document.querySelector('.gk-choose')?.remove();
      newSheet?.remove(); newSheet = null;
      return;
    }
    newSheet ||= frame.item(t('New spreadsheet'), () => start(paper, 'sheet', { any: true }));
    choice(paper);
  };
  globalThis.GZ_WRITER_SETTINGS?.follow?.(refreshChoices);
  frame.on('ready', () => {
    if (frame.mode() !== 'paper' || frame.kind() !== 'assignment') return;
    // ⋯ → New spreadsheet, and the choice, once the paper has loaded and only where both are offered.
    (async () => {
      for (let i = 0; i < 150 && !P()?.current(); i++) await new Promise((r) => setTimeout(r, 100));
      // The registry says whether this build has the spreadsheet kind (offers).
      if (Object.hasOwn(FRAME, 'sheet')) await P().need(['documents/doc-kinds.js']);
      readyPaper = P()?.current();
      refreshChoices();
    })().catch((e) => console.error(e));
  });

  // ---- a file shown from elsewhere (writer.js view mode; courses/page/bbpreview.js: Blackboard's preview of an attachment,
  // converted to a PDF, which the page read; courses/page/canvasopen.js: a Canvas file the page read on a click): init { kind:
  // 'pdf', 'slides' or 'sheet', view: { bytes (an ArrayBuffer, transferred), name, href } } → the kind's show, nothing kept unless the
  // student saves it to Documents. The page hears view:shown once page 1 is
  // drawn, view:failed (with a reason) for anything else, so it keeps Blackboard's frame, and view:esc for an Esc the
  // viewer didn't take.
  const SHOWN = ['pdf', 'slides', 'sheet'];
  frame.on('view', async (m) => {
    const v = m.view, failed = (reason) => frame.say({ type: 'view:failed', reason: String(reason || 'error') });
    const bytes = v?.bytes instanceof ArrayBuffer && v.bytes.byteLength ? new Uint8Array(v.bytes) : null;
    if (!SHOWN.includes(m.kind) || !bytes) { failed('init'); return; }
    const k = await kind(m.kind).catch((e) => { console.error(e); return null; });
    if (typeof k?.show !== 'function') { failed('kind'); return; }
    const root = document.documentElement, el = document.createElement('div');
    el.className = 'gk';
    document.body.append(el);
    root.dataset.doc = m.kind;
    root.dataset.view = 'full';
    const name = typeof v.name === 'string' ? v.name.slice(0, 200) : '', href = typeof v.href === 'string' && /^https?:/.test(v.href) ? v.href : '';
    try {
      await k.show({ bytes, name, href }, { mount: el, t, title: () => name,
        shown: () => frame.say({ type: 'view:shown' }), failed, esc: () => frame.say({ type: 'view:esc' }) });
    } catch (e) { console.error(e); failed('error'); }
  });

  return { FRAME, opens, offers, kind, mount, open, start, shown: () => shown?.id || null };
})();
