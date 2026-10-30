// The kinds of document the Documents home (papers.html) holds: each kind's fixed facts here, its page code (edit, thumb,
// file → { name, mime, bytes }, exportFile, text, importFile, measure, copy → the fields of its own a copy keeps, create → a
// new one from the New band) attached by the page script that draws it (papers.js the paper's, sheet-kind.js the
// spreadsheet's, pdf-kind.js the PDF's, slides-kind.js the slides'; each one's importFile and create only while its
// Settings → Writer switch is on). Only a kind registered with importFile takes files; a script that decides late what it
// registers says so with wait(), and the page routes once settled(). A stored record or index row without a kind was
// written before kinds and is a paper (lib/writer-papers.js). Later kinds join KINDS; a build that lacks one leaves its
// rows alone rather than guessing at them.
// Classic script; module.exports for node.
var GZ_DOC_KINDS = globalThis.GZ_DOC_KINDS || (() => {
  const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
  // The largest PDF or deck, in bytes: what Blackboard takes as an upload, the worker's file store keeps (lib/doc-files.js
  // MAX), an attachment opened in Glaze reads and the submit sheet sends (lib/writer-submit.js MAX_FILE); the tests hold
  // them equal.
  const FILE = 50e6;
  // label: the kind's name for i18n; icon: its glyph's name; accept and mime: the files it opens and the one it saves;
  // max: the largest file it opens, in bytes (pdf-kind.js and slides-kind.js STORE.max), and big: what the page says of a
  // larger one; param: its name in a page's address.
  const KINDS = freeze({
    paper: { label: 'Document', icon: 'paper', accept: ['.docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', max: 15e6, param: 'paper' },
    sheet: { label: 'Spreadsheet', icon: 'sheet', accept: ['.xlsx', '.csv', '.tsv'], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', max: 15e6, param: 'sheet' },
    pdf: { label: 'PDF', icon: 'pdf', accept: ['.pdf'], mime: 'application/pdf', max: FILE, big: 'Choose a PDF smaller than 50 MB.', param: 'pdf' },
    slides: { label: 'Slides', icon: 'slides', accept: ['.pptx', '.ppsx'], mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', max: FILE, big: 'Choose a PowerPoint file smaller than 50 MB.', param: 'slides' },
  });
  // What a page says when the worker's file store (lib/doc-files.js) refuses a PDF's or deck's bytes, by its why: each a plain
  // reason, never a silent drop. A kind's says carries them, so Documents and Open in Glaze say them as they are.
  const SAYS = freeze({ missing: 'This file is missing.', quota: "There isn't enough room in this browser for this file.", unavailable: "This browser can't keep files larger than 3 MB right now.",
    interrupted: "The file didn't finish copying. Try again." });
  const known = (id) => typeof id === 'string' && Object.hasOwn(KINDS, id);
  const kindOf = (row) => (typeof row?.kind === 'string' && row.kind) || 'paper';
  // A file's kind by its extension, or null when no kind opens it.
  const forFile = (name) => {
    const ext = /(\.[^./\\]+)$/.exec(typeof name === 'string' ? name : '')?.[1].toLowerCase();
    return (ext && Object.keys(KINDS).find((id) => KINDS[id].accept.includes(ext))) || null;
  };
  const impls = new Map();
  const register = (id, impl) => { if (!known(id)) throw new Error(`no document kind ${id}`); impls.set(id, impl); };
  const get = (id) => (known(id) ? { ...KINDS[id], ...impls.get(id) } : null);
  // The kinds that take files: registered with an importFile (a kind behind a switch that is off omits importFile but can
  // still view). opens(name): the one that takes this file, or null; accept(): their extensions and types, as a file
  // chooser's accept.
  const taking = () => Object.keys(KINDS).filter((id) => typeof impls.get(id)?.importFile === 'function');
  const opens = (name) => { const id = forFile(name); return id && taking().includes(id) ? id : null; };
  const accept = () => taking().flatMap((id) => [...KINDS[id].accept, KINDS[id].mime]).join(',');
  // A kind's script that decides late whether to register (it reads its switch first) hands that decision to wait(); the
  // page's settled() resolves once every one has, a failed one included.
  const pending = new Set();
  const wait = (p) => { const q = Promise.resolve(p).catch((e) => console.error(e)); pending.add(q); q.then(() => pending.delete(q)); return q; };
  const settled = async () => { while (pending.size) await Promise.all([...pending]); };
  // ---- an import's progress: the kind doing it reports { stage, done, total } as each stage starts and as its bytes go;
  // the page showing it hears { stage, done, total, fraction } and, at the end, end or failed. stages: the ones the kind
  // goes through, in order; each its share of the bar by what it took when measured (copying a 50 MB PDF into the file
  // store is most of an import). A stage only goes forward, its bytes only up, the bar never back.
  const STAGES = freeze({ read: 3, prepare: 15, copy: 77, save: 5 });
  const progress = (listen, stages = Object.keys(STAGES)) => {
    const order = stages.filter((s) => Object.hasOwn(STAGES, s)), sum = order.reduce((a, s) => a + STAGES[s], 0) || 1;
    let at = -1, done = 0, total = 0, fraction = 0, over = false;
    const tell = (more) => { try { listen?.({ stage: order[at] ?? null, done, total, fraction, ...more }); } catch (e) { console.error(e); } };
    const report = ({ stage, done: d = 0, total: n = 0 } = {}) => {
      const i = order.indexOf(stage);
      if (over || i < 0 || i < at) return;
      if (i > at) { at = i; done = 0; total = 0; }
      if (Number.isFinite(n) && n > 0) total = n;
      if (Number.isFinite(d) && d > done) done = total ? Math.min(d, total) : d;
      const before = order.slice(0, at).reduce((a, s) => a + STAGES[s], 0);
      fraction = Math.max(fraction, Math.min(1, (before + STAGES[stage] * (total ? done / total : 0)) / sum));
      tell();
    };
    report.end = () => { if (over) return; over = true; fraction = 1; tell({ end: true }); };
    report.fail = (error) => { if (over) return; over = true; tell({ failed: error ?? true }); };
    return report;
  };
  // What a page says of a progress state: [English words, their values], or null before the first stage. The bytes show
  // from 1 MB (a smaller file is copied at once); spoken: the words without them (a live region hears each stage once).
  const PREPARING = freeze({ paper: 'Preparing pages…', pdf: 'Preparing pages…', slides: 'Preparing slides…', sheet: 'Preparing sheets…' });
  const mb = (n) => Math.round(n / 1e5) / 10;
  const said = (p, id, { spoken = false } = {}) => {
    if (p?.stage === 'read') return ['Reading…'];
    if (p?.stage === 'prepare') return [PREPARING[id] || PREPARING.pdf];
    if (p?.stage === 'copy') return spoken || !(p.total >= 1e6) ? ['Copying…'] : ['Copying… {done} / {total} MB', { done: mb(p.done), total: mb(p.total) }];
    if (p?.stage === 'save') return ['Saving…'];
    return null;
  };
  return { KINDS, FILE, SAYS, STAGES, kindOf, forFile, register, get, taking, opens, accept, wait, settled, progress, said };
})();

if (typeof module !== 'undefined') module.exports = GZ_DOC_KINDS; else GZ_DOC_KINDS;
