// Glaze Writer's Papers (papers.html): every paper on this device, newest first, each opened in the same paper chrome the
// assignment's frame has (writer-paper.js), exported as a .docx, or brought back to an earlier version from its status
// bar. ?paper=<key> opens one. Reads and writes only Writer's own storage (lib/writer-papers.js).
(() => {
  const $ = (id) => document.getElementById(id);
  const locale = (() => { try { return chrome.i18n.getUILanguage(); } catch { return navigator.language || 'en'; } })();
  const t = (k, v) => GZ_I18N.t(k, v, locale);
  const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((x) => x != null)); return e; };
  const catalogue = () => new Promise((ok) => {
    const file = GZ_I18N.file(locale);
    if (!file || globalThis.GZ_LANGS?.[file.slice(5, -3)]) { ok(); return; }
    const s = h('script', { src: file, onload: ok, onerror: ok });
    document.head.append(s);
  });

  const list = async () => {
    await GZ_WRITER_PAPER.need(['lib/writer-styles.js', 'lib/writer-format.js', 'lib/writer-papers.js']);
    const store = GZ_WRITER_PAPERS.open(), rows = await store.list();
    document.title = t('Papers');
    $('heading').textContent = t('Papers');
    const when = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const nf = new Intl.NumberFormat(locale);
    $('rows').replaceChildren(...rows.sort((a, b) => b.updated - a.updated).map((r) => {
      const f = GZ_WRITER_STYLES.get(r.format);
      const open = h('a', { className: 'gp-sbtn', href: `papers.html?paper=${encodeURIComponent(r.key)}`, textContent: t('Open') });
      const exp = h('button', { type: 'button', className: 'gp-sbtn gp-ghost', textContent: t('Export .docx') }), said = h('span', { className: 'gp-state' });
      said.setAttribute('role', 'status');
      exp.addEventListener('click', () => { said.textContent = ''; exportPaper(store, r.key).catch(() => { said.textContent = t('The .docx could not be made.'); }); });
      return h('article', { className: 'gp-paper' },
        h('div', { className: 'gp-paper-main' }, h('h2', { textContent: r.title || t('Paper') }), h('p', { textContent: [r.course, f.label, t('{n} words', { n: nf.format(r.words || 0) }), when.format(r.updated)].filter(Boolean).join(' · ') })),
        r.submitted ? h('span', { className: 'gp-badge', textContent: t('Submitted') }) : null,
        h('div', { className: 'gp-row' }, said, open, exp));
    }));
    $('list').hidden = false;
  };
  const exportPaper = async (store, key) => {
    await GZ_WRITER_PAPER.need(['lib/zip.js', 'lib/doctext.js', 'lib/writer-docx.js', 'lib/writer-objects-docx.js', 'lib/writer-submit.js']);
    const p = await store.get(key);
    if (!p?.doc) return;
    const f = GZ_WRITER_STYLES.get(p.format), surname = GZ_WRITER_FORMAT.surname(p.doc, f);
    const out = GZ_WRITER_DOCX.exportDocx(p.doc, { format: f, surname, title: p.title });
    const url = URL.createObjectURL(new Blob([out.bytes], { type: out.type }));
    const a = h('a', { href: url, download: GZ_WRITER_SUBMIT_LIB.fileName({ surname, title: p.title, fallback: t('Paper') }) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const edit = async (key) => {
    document.documentElement.dataset.mode = 'paper';
    await GZ_WRITER_PAPER.need(['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'defaults.js', 'lib/writer-settings.js']);
    await GZ_WRITER_SETTINGS.load();
    const plugins = [], hooks = { ready: [], change: [], context: [] };
    let editor = null;
    // The same editor modules as an assignment frame, with a local host and no page messaging or submission.
    globalThis.GZ_WRITER_FRAME = {
      t, mode: () => 'paper', kind: () => 'paper', editor: () => editor, slot: () => null, context: () => ({ school: 'local', user: { id: 'local' }, course: { id: 'papers' }, item: { id: key } }),
      on: (event, fn) => { if (hooks[event] && typeof fn === 'function') hooks[event].push(fn); },
      plugin: (p) => { if (editor) editor.addPlugins([p]); else plugins.push(p); },
    };
    await GZ_WRITER_PAPER.need(['lib/writer-sources.js', 'lib/writer-bibliography.js', 'lib/writer-cite.js', 'lib/writer-lookup.js', 'writer-cite.js', 'lib/writer-export.js', 'writer-objects.js', 'writer-find.js', 'writer-counts.js', 'writer-print.js', 'writer-ruler.js', 'lib/writer-color.js', 'writer-paste.js']);
    const mountEl = h('div');
    document.body.append(mountEl);
    editor = GZ_WRITER_EDITOR.create({ mount: mountEl, mode: 'paper', html: '', plugins, onChange: (change) => { for (const fn of hooks.change) fn(change); } });
    await GZ_WRITER_PAPER.mount({ editor, t, standalone: true, key, context: () => ({}) });
    for (const fn of hooks.ready) fn(editor);
  };
  catalogue().then(() => {
    const key = new URLSearchParams(location.search).get('paper');
    (key ? edit(key) : list()).catch((e) => console.error(e));
  });
})();
