// Glaze Writer's other document kinds in an assignment's frame (writer.html). An attempt whose record is a PDF or a slide
// deck (lib/doc-kinds.js) shows that kind's viewer in the paper's place, as a page of its own (pdf-kind.js: its pages, its
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
  // What each kind loads in the frame (its switch: lib/writer-submit.js SWITCH).
  const FRAME = Object.freeze({
    pdf: Object.freeze({ scripts: ['lib/doc-kinds.js', 'lib/pdf-doc.js', 'pdf-kind.js'], css: 'pdf-kind.css' }),
    slides: Object.freeze({ scripts: ['lib/doc-kinds.js', 'slides-kind.js'], css: 'slides-kind.css' }),
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
    const root = document.documentElement, el = document.createElement('div');
    el.className = 'gk';
    document.body.append(el);
    root.dataset.doc = id;
    root.dataset.view = 'full';
    let v = null;
    const rec = await store().get(key).catch(() => null), ext = rec?.ext && GZ_DOC_KINDS.KINDS[id]?.accept.includes(rec.ext) ? rec.ext : GZ_DOC_KINDS.KINDS[id]?.accept[0] || '';
    const submitB = document.createElement('button');
    submitB.type = 'button'; submitB.className = 'gp-submit'; submitB.textContent = t('Submit…');
    submitB.disabled = typeof P().submit !== 'function';
    const surface = {
      kind: () => id, key: () => key, ext: () => ext, context: () => paper.context(), paper: () => paper.paper(), compact: () => false, blank: () => false, importing: () => busy,
      pages: () => v?.pages?.() || null, notify: (m) => v?.say?.(t(m)), focused: () => {}, resume: () => {}, look: () => null,
      version: (reason = 'submit') => store().save(key, {}, { reason }).catch((e) => { console.error(e); return null; }),
      save: () => (v ? v.save() : Promise.resolve(false)), file: () => v.file(), importFile: (f) => open(surface, f),
      // Ultra's buttons over a compact box never reach a viewer: the page treats it as the full view (view below).
      flush: (request) => frame.say({ type: 'compact:flushed', request, ok: false }),
    };
    submitB.addEventListener('click', () => P().submit?.(surface));
    try {
      v = await k.view(key, { mount: el, t, title: () => paper.context()?.assignment?.title || '', tools: [submitB] });
    } catch (e) { console.error(e); el.remove(); delete root.dataset.doc; return null; }
    if (typeof P().submit === 'function') submitB.disabled = false;
    shown = { id, key, el, surface, paper };
    frame.say({ type: 'view', full: true });
    return surface;
  };
  const unmount = () => {
    if (!shown) return;
    shown.el.remove();
    delete document.documentElement.dataset.doc;
    shown = null;
  };

  // ---- Open in Glaze: a brought file of a kind that opens here becomes the attempt's record, and shows. api: the paper
  // or the viewer that shows now.
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
      if (shown) { if (!await shown.surface.save()) throw new Error('not saved'); }
      else if (!await paper.save()) throw new Error('paper could not be saved');
      paper.hold();
      const rec = await k.into(key, f);
      if (shown) { unmount(); const s = await mount(id, key, paper); if (!s) throw new Error('no viewer'); paper.take(s); }
      else if (!await paper.hand(rec)) throw new Error('no viewer');
    } catch (e) {
      console.error(e);
      paper.release();
      (shown?.surface || paper).notify?.(said(k, e));
    } finally { busy = false; }
  };
  // A Word file over a viewer: the record a paper again (its kind's fields cleared), then the file opens as a paper does.
  const back = async (f) => {
    const { paper, key, surface } = shown;
    busy = true;
    try {
      if (!await surface.save()) throw new Error('not saved');
      await store().save(key, { kind: 'paper', file: null, size: null, pages: null, thumb: null, ext: null, slides: null, text: null }, { reason: 'import' });
    } catch (e) { console.error(e); surface.notify('Not saved. Try again in a moment.'); return; } finally { busy = false; }
    unmount();
    paper.unpark();
    await paper.importFile(f, { full: true });
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
    for (const [id, label] of [['paper', 'Document'], ['sheet', 'Spreadsheet']]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'gk-pick'; b.dataset.kind = id; b.textContent = t(label);
      b.addEventListener('click', () => { row.remove(); if (id !== 'paper') start(paper, id); });
      row.append(b);
    }
    document.getElementById('gw')?.prepend(row);
    return row;
  };
  frame.on('ready', () => {
    if (frame.mode() !== 'paper' || frame.kind() !== 'assignment') return;
    // ⋯ → New spreadsheet, and the choice, once the paper has loaded and only where both are offered.
    (async () => {
      for (let i = 0; i < 150 && !P()?.current(); i++) await new Promise((r) => setTimeout(r, 100));
      const paper = P()?.current();
      if (!paper || paper.kind?.() !== 'paper' || offers().length < 2) return;
      frame.item(t('New spreadsheet'), () => start(paper, 'sheet', { any: true }));
      choice(paper);
    })().catch((e) => console.error(e));
  });

  return { FRAME, opens, offers, mount, open, start, shown: () => shown?.id || null };
})();
