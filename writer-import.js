// Glaze Writer's import card (glaze-plans/writer/mockups/settings-ai/import.html), in an assignment's paper frame. A file
// the student brings (dropped on the paper, ⋯ → Import…, or Ultra's own file area, which the page hands over before Ultra
// hears it: features/writer-submit.js) is routed by lib/writer-submit.js: a .docx asks Open in Writer (the default, Enter)
// or Submit as is, and a .pdf, .pptx or .ppsx Open in Glaze or Submit as is while its kind opens here (writer-kinds.js:
// Settings → Writer → PDFs, Slides); any other file goes straight to the submit sheet as is. Open in Writer replaces the
// paper, what it held kept as a version first (writer-paper.js importFile, whose toast has Undo); Open in Glaze shows the
// file in its kind's viewer in the paper's place, the paper kept as a version first. The close button, Escape and the dim
// change nothing.
// page → frame: import:file { name, mime, bytes, open } (open: an attachment's Open in Glaze, no card), import:failed
// { name, why } (why 'size': past what the kind opens, said in the kind's words: lib/doc-kinds.js big).
// Classic script after writer-submit.js.
var GZ_WRITER_IMPORT = globalThis.GZ_WRITER_IMPORT || (() => {
  const frame = globalThis.GZ_WRITER_FRAME;
  if (!frame) return null;
  const P = () => globalThis.GZ_WRITER_PAPER, L = () => globalThis.GZ_WRITER_SUBMIT_LIB, SHEET = () => globalThis.GZ_WRITER_SUBMIT_SHEET, K = () => globalThis.GZ_WRITER_KINDS;
  const route = (name) => L().route(name, { kinds: K()?.opens() || [] });
  const t = (k, v) => frame.t(k, v);
  const nf = (n) => new Intl.NumberFormat(document.documentElement.lang || undefined).format(n);
  const SVG = 'http://www.w3.org/2000/svg';
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    e.append(...kids.flat().filter((x) => x != null && x !== false));
    return e;
  };
  // The tiles' pictures, as the mockup draws them: the file's page opening into an editor (behind it, the paper it
  // replaces), and the file, clipped, going up.
  const lines = (x, y) => [0, 1, 2, 3, 4, 5, 6].map((k) => `<rect class="gi-ln" x="${x + 7}" y="${y + 10 + k * 7}" width="${k === 6 ? 18 : k % 3 === 2 ? 26 : 32}" height="2.4" rx="1"/>`).join('');
  const ART = {
    open: (replace) => { const x = replace ? 52 : 43, y = replace ? 14 : 8; return `${replace ? '<rect class="gi-old" x="30" y="10" width="46" height="62" rx="3"/>' : ''}<rect class="gi-pg" x="${x}" y="${y}" width="46" height="62" rx="3"/>${lines(x, y)}<rect class="gi-accf" x="${x + 27}" y="${y + 50}" width="2" height="9" rx="1"/><path class="gi-acc" d="M${replace ? 104 : 96} ${replace ? 62 : 58}l14-14 5 5-14 14h-5z"/>`; },
    asis: () => '<rect class="gi-pg" x="43" y="12" width="46" height="62" rx="3"/><rect class="gi-tagf" x="53" y="34" width="26" height="14" rx="3"/><text class="gi-tagt" x="66" y="44.2" text-anchor="middle">DOCX</text><path class="gi-acc" d="M50 6v14a4 4 0 0 0 8 0V9"/><path class="gi-acc" d="M104 52V22M96 30l8-8 8 8"/>',
  };
  // Parsed as SVG rather than set as innerHTML, which Firefox Add-ons' linter refuses.
  const art = (markup) => document.importNode(new DOMParser().parseFromString(`<svg xmlns="${SVG}" viewBox="0 0 132 84" class="gi-art" aria-hidden="true">${markup}</svg>`, 'image/svg+xml').documentElement, true);
  const HISTORY = 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2', X = 'M6 6l12 12M18 6 6 18';
  const icon = (d) => { const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); return s; };

  // "4 pages · 38 KB": a Word file's pages as Word saved them, when it says; its size always.
  const about = async (file) => {
    const size = t('{n} KB', { n: nf(L().kb(file.size)) });
    if (L().kindOf(file.name) !== 'paper') return size;
    try {
      await P().need(['lib/doctext.js']);
      const xml = await GZ_DOCTEXT.unzip(new Uint8Array(await file.arrayBuffer())).bytes('docProps/app.xml');
      const n = xml ? L().pagesOf(new TextDecoder().decode(xml)) : 0;
      return n ? `${t('{n} pages', { n })} · ${size}` : size;
    } catch { return size; }
  };

  let card = null, requests = 0;
  const close = () => {
    requests++;
    if (!card) return;
    const c = card;
    card = null;
    c.layer.remove();
    for (const [el, was] of c.inert) el.inert = was;
    if (c.back?.isConnected) c.back.focus();
  };
  const choose = (api, file) => {
    close();
    const replace = !api.blank(), word = L().kindOf(file.name) === 'paper';
    const meta = h('small', { text: t('{n} KB', { n: nf(L().kb(file.size)) }) });
    const x = h('button', { type: 'button', class: 'gi-x', 'aria-label': t('Close'), title: t('Close') }, icon(X));
    const open = h('button', { type: 'button', class: 'gi-choice gi-default' }, art(ART.open(replace)), h('span', { text: t(word ? 'Open in Writer' : 'Open in Glaze') }),
      replace ? h('span', { class: 'gi-kept' }, icon(HISTORY), t('Saves current paper')) : null);
    const asis = h('button', { type: 'button', class: 'gi-choice' }, art(ART.asis()), h('span', { text: t('Submit as is') }));
    const layer = h('div', { class: 'gi-layer' },
      h('div', { class: 'gi-dim' }),
      h('div', { class: 'gi-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gi-name' },
        h('div', { class: 'gi-file' }, h('span', { class: 'gs-doc', 'data-kind': 'docx', 'aria-hidden': 'true', text: L().tag(file.name) }), h('div', {}, h('b', { id: 'gi-name', class: 'gs-name', text: file.name }), meta), x),
        h('div', { class: 'gi-choices' }, open, asis)));
    const inert = [...document.body.children].map((el) => [el, el.inert]);
    for (const [el] of inert) el.inert = true;
    document.body.append(layer);
    card = { layer, inert, back: document.activeElement !== document.body ? document.activeElement : null };
    const mine = card;
    layer.getBoundingClientRect();
    layer.setAttribute('data-open', '');
    open.focus();
    about(file).then((s) => { if (card === mine) meta.textContent = s; });

    x.addEventListener('click', close);
    layer.querySelector('.gi-dim').addEventListener('click', close);
    // From the compact box, Open in Writer opens the pages too (Full writer on): the file is a paper now.
    open.addEventListener('click', () => { if (card !== mine) return; mine.back = null; close(); if (word) api.importFile(file, { full: true }); else K()?.open(api, file); });
    asis.addEventListener('click', () => { if (card !== mine) return; mine.back = null; close(); SHEET()?.open(api, file); });
    layer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      const all = [open, asis, x], i = all.indexOf(document.activeElement);
      e.preventDefault();
      all[(i + (e.shiftKey ? all.length - 1 : 1)) % all.length].focus();
    });
  };
  // Where a brought file goes. A sheet already submitting keeps going; one only open gives way to the new file.
  const bring = async (api, file) => {
    if (!api || !file || api.importing?.() || SHEET()?.busy()) return;
    const request = ++requests;
    await P().need(['lib/writer-submit.js']);
    if (request !== requests || P()?.current() !== api || api.importing?.() || SHEET()?.busy()) return;
    const error = L().fileError(file);
    if (error) { api.notify?.(error); return; }
    SHEET()?.close();
    if (route(file.name) === 'choose') choose(api, file);
    else { close(); SHEET()?.open(api, file); }
  };

  // The page takes Ultra's file area from the frame's ready, a moment before the paper mounts: a file waits for the paper.
  const paper = async () => { for (let i = 0; i < 150 && !P()?.current(); i++) await new Promise((r) => setTimeout(r, 100)); return P()?.current() || null; };
  frame.handle('import:file', async (m) => {
    if (frame.mode() !== 'paper' || frame.kind() !== 'assignment' || !(m.bytes instanceof ArrayBuffer) || !m.bytes.byteLength) return;
    const request = ++requests;
    const api = P()?.current() || await paper();
    if (!api || request !== requests) return;
    await P().need(['lib/writer-submit.js']);
    if (m.bytes.byteLength > L().MAX_FILE || request !== requests || P()?.current() !== api || L().fileError({ name: m.name, size: m.bytes.byteLength, type: m.mime ?? '' })) return;
    const file = new File([m.bytes], m.name, { type: typeof m.mime === 'string' ? m.mime : '' });
    // An attachment's Open in Glaze (lib/writer-context-assignment.js open): straight to its kind, no card, while it is on.
    if (m.open === true) { if (K()?.opens().includes(L().kindOf(m.name)) && !api.importing?.() && !SHEET()?.busy()) { close(); K().open(api, file); } return; }
    bring(api, file);
  });
  frame.handle('import:failed', async (m) => {
    let says = 'That file could not be read.';
    if (m?.why === 'size') {
      await P().need(['lib/writer-submit.js', 'lib/doc-kinds.js']).catch(() => {});
      says = globalThis.GZ_DOC_KINDS?.KINDS[L()?.kindOf(m.name)]?.big || 'That file is too large.';
    }
    P()?.current()?.notify?.(says);
  });
  return { bring, about, close, opened: () => !!card };
})();
