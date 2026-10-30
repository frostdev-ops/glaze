// Glaze Writer's word count popover (writer.html, after writer.js), as glaze-plans/writer/mockups/edit draws it: the word
// count in the bar opens it (compose's target slot, which keeps its ring; a paper's status bar calls open(anchor)), with
// words as the bar counts them, characters with and without spaces (as a reader sees them: an accented letter or an
// emoji is one), paragraphs (the ones with text), sentences, pages on a paper and reading time (238 words a minute), and a
// column for the selection when text is selected. It follows edits and the selection while open; Escape or a click
// elsewhere closes it. Note marks and pictures aren't text; a note's own words aren't counted, as the bar doesn't.
// counts() is a plain function over a document, for node tests; then the frame.
var GZ_WRITER_COUNTS = globalThis.GZ_WRITER_COUNTS || (() => {
  const words = (s) => (globalThis.GZ_WRITER_EDITOR || require('./lib/writer-editor.js')).words(s);
  const WPM = 238;
  const seg = (granularity) => (typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity }) : null);
  const graphemes = seg('grapheme'), sentenceOf = seg('sentence');
  const chars = (s) => (graphemes ? [...graphemes.segment(s)].length : [...s].length);
  const sentences = (s) => (sentenceOf ? [...sentenceOf.segment(s)].map((x) => x.segment) : s.split(/(?<=[.!?…]["'”’)\]]*)\s+/)).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
  // → { words, chars, charsNoSpaces, paragraphs, sentences, minutes } for the document, or from..to of it.
  const counts = (doc, from = 0, to = doc.content.size) => {
    const out = { words: 0, chars: 0, charsNoSpaces: 0, paragraphs: 0, sentences: 0, minutes: 0 };
    doc.nodesBetween(from, to, (block, pos) => {
      if (!block.isTextblock) return true;
      let s = '';
      block.forEach((c, off) => {
        const a = pos + 1 + off;
        if (c.isText) s += c.text.slice(Math.max(0, from - a), Math.max(0, to - a));
        else if (c.type.name === 'hard_break' && a >= from && a < to) s += '\n';
      });
      if (!/\S/.test(s)) return false;
      out.paragraphs++;
      out.words += words(s);
      out.chars += chars(s.replace(/\n/g, ''));
      out.charsNoSpaces += chars(s.replace(/\s/g, ''));
      out.sentences += s.split('\n').reduce((n, line) => n + sentences(line), 0);
      return false;
    });
    out.minutes = out.words ? Math.max(1, Math.round(out.words / WPM)) : 0;
    return out;
  };
  const api = { counts, open: () => {}, close: () => {} };

  const F = globalThis.GZ_WRITER_FRAME;
  if (!F || typeof document === 'undefined') return api;
  const t = (k, v) => F.t(k, v);
  const ROWS = [['Words', 'words'], ['Characters', 'chars'], ['Characters excluding spaces', 'charsNoSpaces'], ['Paragraphs', 'paragraphs'], ['Sentences', 'sentences'], ['Pages', 'pages'], ['Reading time', 'minutes']];
  const pop = document.createElement('div');
  pop.className = 'pop ge-counts';
  pop.setAttribute('role', 'dialog');
  pop.tabIndex = -1;
  pop.hidden = true;
  let opener = null, frame = 0;
  const nf = (n) => new Intl.NumberFormat(document.documentElement.lang || undefined).format(n);
  const cell = (tag, text, cls) => { const c = document.createElement(tag); c.textContent = text; if (cls) c.className = cls; return c; };
  const draw = () => {
    frame = 0;
    const v = F.editor()?.view;
    if (!v || pop.hidden) return;
    const { from, to, empty } = v.state.selection, all = counts(v.state.doc), sel = empty ? null : counts(v.state.doc, from, to);
    const paper = F.mode() === 'paper' ? globalThis.GZ_WRITER_PAPER?.current?.() : null;
    if (paper) all.pages = paper.pages();
    const head = cell('h3', t('Word count'));
    const table = document.createElement('table');
    if (sel) { const r = table.insertRow(); r.append(cell('th', ''), cell('th', t('Selection')), cell('th', t('Total'))); }
    for (const [label, k] of ROWS) {
      if (all[k] == null) continue;
      const show = (c) => (c?.[k] == null ? '' : k === 'minutes' ? t('{n} min', { n: c[k] }) : nf(c[k]));
      const r = table.insertRow();
      r.append(cell('td', t(label)), ...(sel ? [cell('td', show(sel), 'ge-sel')] : []), cell('td', show(all)));
    }
    pop.setAttribute('aria-label', t('Word count'));
    pop.replaceChildren(head, table);
    place();
  };
  // Above the count, from its left edge, inside the frame.
  const place = () => {
    if (!opener || pop.hidden) return;
    const r = opener.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(4, Math.min(r.left - 6, innerWidth - w - 4))}px`;
    pop.style.top = `${Math.max(4, r.top - h - 8)}px`;
  };
  const close = (back) => {
    if (pop.hidden) return;
    pop.hidden = true;
    pop.removeAttribute('data-open');
    opener?.setAttribute('aria-expanded', 'false');
    if (back) opener?.focus();
  };
  const open = (anchor) => {
    if (!anchor || !F.editor()) return;
    if (!pop.hidden && opener === anchor) { close(true); return; }
    opener?.setAttribute('aria-expanded', 'false');
    opener = anchor;
    if (!pop.isConnected) document.body.append(pop);
    pop.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    draw();
    pop.getBoundingClientRect();
    pop.setAttribute('data-open', '');
  };
  const soon = () => { if (!pop.hidden) frame ||= requestAnimationFrame(draw); };
  F.plugin(new GZ_PM.state.Plugin({ view: () => ({ update: (v, before) => { if (v.state.doc !== before.doc || !v.state.selection.eq(before.selection)) soon(); } }) }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { e.preventDefault(); close(true); } }, true);
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !opener?.contains(e.target)) close(); }, true);
  addEventListener('resize', place);

  // Compose: the target slot (the ring and its count, writer-compose.js) opens it.
  const target = F.slot('target');
  if (target) {
    target.classList.add('ge-count-btn');
    target.setAttribute('role', 'button');
    target.tabIndex = 0;
    target.setAttribute('aria-haspopup', 'dialog');
    target.setAttribute('aria-expanded', 'false');
    target.addEventListener('click', () => open(target));
    target.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(target); } });
  }
  return Object.assign(api, { open, close });
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_COUNTS;
