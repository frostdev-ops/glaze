// Glaze Writer's Print, Export PDF and text exports (writer.html, after writer.js). A paper prints exactly as its pages are
// laid out: ⌘P (Ctrl+P) or Print… asks the browser to print this frame, and writer-paper.js puts a copy of each page in
// its place for print (its own page size and margins, running header, footnotes; writer-paper.css @media print). Export
// PDF… is the same print, its file named as the .docx is (Lastname_Title), for the browser's Save as PDF. Export .txt and
// Export .md (lib/writer-export.js) save the paper or the post as text. A compose box has the exports in ⋯ and leaves
// ⌘P to the browser; a paper's are items(paper) for its own menu (Versions).
var GZ_WRITER_PRINT = globalThis.GZ_WRITER_PRINT || (() => {
  const api = { items: () => [], print: () => false, save: () => false };
  const F = globalThis.GZ_WRITER_FRAME;
  if (!F || typeof document === 'undefined') return api;
  const t = (k, v) => F.t(k, v);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const paper = () => (F.mode() === 'paper' ? globalThis.GZ_WRITER_PAPER?.current?.() || null : null);
  const safe = (s) => String(s || '').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120) || 'Untitled';
  // The paper's file name as its .docx has it (writer-paper.js fileName), without the extension; a post by its kind.
  const base = () => {
    const p = paper(), ed = F.editor();
    if (!p || !ed) return safe(F.kind() || 'post');
    let surname = '';
    try { surname = globalThis.GZ_WRITER_FORMAT?.surname(ed.view.state.doc, p.format()) || ''; } catch { /* no heading yet */ }
    return safe([surname, p.context()?.assignment?.title || p.paper()?.title || t('Paper')].filter(Boolean).join(' ').replace(/\s+/g, '_'));
  };
  const print = () => {
    if (!paper()) return false;
    const before = document.title;
    document.title = base();
    addEventListener('afterprint', () => { document.title = before; }, { once: true });
    window.print();
    return true;
  };
  const save = (ext) => {
    const ed = F.editor(), X = globalThis.GZ_WRITER_EXPORT;
    if (!ed || !X) return false;
    const text = ext === 'md' ? X.markdown(ed.view.state.doc) : X.text(ed.view.state.doc);
    const url = URL.createObjectURL(new Blob([text], { type: ext === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${base()}.${ext}`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  };
  const ITEMS = [['Print…', print], ['Export PDF…', print], ['Export .txt', () => save('txt')], ['Export .md', () => save('md')]];
  // A paper's menu entries: [{ label, run }].
  const items = () => ITEMS.map(([label, run]) => ({ label: t(label), run }));

  // Compose: ⋯ → Export .txt, Export .md, labelled again in the page's language as ⋯ opens.
  const mine = [];
  F.on('ready', () => {
    if (F.mode() !== 'compose' || mine.length) return;
    for (const [label, run] of ITEMS.slice(2)) mine.push([F.item(t(label), run), label]);
    document.getElementById('more')?.addEventListener('click', () => { for (const [b, label] of mine) b.textContent = t(label); }, true);
  });
  // ⌘P / Ctrl+P on a paper: this frame's pages, not the page around it.
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'p' || e.altKey || e.shiftKey || (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) || !paper()) return;
    e.preventDefault();
    e.stopPropagation();
    print();
  }, true);
  return Object.assign(api, { items, print, save, base });
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_PRINT;
