// The kinds of document the Documents home (papers.html) holds: each kind's fixed facts here, its page code (edit, thumb,
// file → { name, mime, bytes }, exportFile, text, importFile, measure, and copy → the fields of its own a copy keeps)
// attached by the page script that draws it (papers.js the paper's, slides-kind.js the slides'). A stored record or index row without a kind
// was written before kinds and is a paper (lib/writer-papers.js). Later kinds join KINDS; a build that lacks one leaves
// its rows alone rather than guessing at them.
// Classic script; module.exports for node.
var GZ_DOC_KINDS = globalThis.GZ_DOC_KINDS || (() => {
  const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
  // label: the kind's name for i18n; icon: its glyph's name; accept and mime: the files it opens and the one it saves;
  // max: the largest file it opens, in bytes; param: its name in a page's address.
  const KINDS = freeze({
    paper: { label: 'Document', icon: 'paper', accept: ['.docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', max: 15e6, param: 'paper' },
    slides: { label: 'Slides', icon: 'slides', accept: ['.pptx', '.ppsx'], mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', max: 50e6, param: 'slides' },
  });
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
  // What the page takes in: a file's kind when that kind's script registered an importFile (a kind behind a switch that is
  // off omits importFile but can still view), and the file chooser's accept for those kinds.
  const importer = (id) => typeof impls.get(id)?.importFile === 'function';
  const opens = (name) => { const id = forFile(name); return id && importer(id) ? id : null; };
  const accept = () => Object.keys(KINDS).filter(importer).flatMap((id) => [...KINDS[id].accept, KINDS[id].mime]).join(',');
  // A kind's script that decides late whether to register (it reads its switch first) hands that decision to wait(); the
  // page's settled() resolves once every one has, a failed one included.
  const pending = new Set();
  const wait = (p) => { const q = Promise.resolve(p).catch((e) => console.error(e)); pending.add(q); q.then(() => pending.delete(q)); return q; };
  const settled = async () => { while (pending.size) await Promise.all([...pending]); };
  return { KINDS, kindOf, forFile, register, get, opens, accept, wait, settled };
})();

if (typeof module !== 'undefined') module.exports = GZ_DOC_KINDS; else GZ_DOC_KINDS;
