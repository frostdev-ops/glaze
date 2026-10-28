// Glaze Writer's Find and Replace (writer.html, after writer.js), as glaze-plans/writer/mockups/edit draws it: ⌘F (Ctrl+F)
// opens a bar over the paper or the compose box, ⌘⇧H or Ctrl+H with Replace open; the count ("3 of 12"), Enter and ⇧Enter
// (or ⌘G and ⇧⌘G) to step, every match marked and the current one stronger, match case and whole word, Replace (the
// current match, then on to the next) and Replace all, each one undoable step. Escape closes it with the current match
// selected. It searches every paragraph, heading, list item and table cell, across page breaks and marks but never across
// a paragraph or a note mark, and the notes' text too: a match in a note is shown on its mark (and in the note at the
// page's foot where the browser has CSS highlights). Straight and curly quotes find each other, as the editor types the
// curly ones. While the bar is open, matches follow edits at once (mapped, not drawn again) and are found again after a
// pause in typing. A screen reader hears the count and each replace (a polite live region).
// The search and replace are plain functions over a document and an EditorState, for node tests; then the frame.
var GZ_WRITER_FIND = globalThis.GZ_WRITER_FIND || (() => {
  const S = () => globalThis.GZ_WRITER_SCHEMA || require('./lib/writer-schema.js');
  const PM = () => { S(); return globalThis.GZ_PM; };
  const MAX = 500, LIMIT = 20000;
  const QUOTES = { "'": "['‘’]", '‘': "['‘’]", '’': "['‘’]", '"': '["“”]', '“': '["“”]', '”': '["“”]' };
  // The query as a pattern: its text as written (no pattern syntax), quotes either way; opts { cs, word }.
  const pattern = (query, { cs = false, word = false } = {}) => {
    const q = String(query || '').slice(0, MAX);
    if (!q) return null;
    const body = [...q].map((c) => QUOTES[c] || c.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&')).join('');
    return new RegExp(word ? `(?<![\\p{L}\\p{N}\\p{M}_])(?:${body})(?![\\p{L}\\p{N}\\p{M}_])` : body, cs ? 'gu' : 'giu');
  };
  // A note's plain text, by its content (inline HTML).
  const notes = new Map();
  const noteText = (content) => {
    if (!notes.has(content)) { if (notes.size > 500) notes.clear(); notes.set(content, S().parse(S().paper, `<div>${content}</div>`).textContent); }
    return notes.get(content);
  };
  // → [{ from, to, note? { start, end } }] in document order; a note's match spans its mark (to = from + 1), start and end
  // in the note's text. Inline atoms and line breaks stand for one character no query has, so nothing matches across them.
  const search = (doc, query, opts = {}) => {
    const re = pattern(query, opts), hits = [];
    if (!re) return hits;
    doc.descendants((block, pos) => {
      if (hits.length >= LIMIT) return false;
      if (!block.isTextblock) return true;
      let s = '';
      const mine = [];
      block.forEach((c, off) => {
        if (c.isText) { s += c.text; return; }
        s += '￼';
        if (c.type.name === 'footnote_ref') for (const m of noteText(c.attrs.content).matchAll(re)) mine.push({ from: pos + 1 + off, to: pos + 2 + off, note: { start: m.index, end: m.index + m[0].length } });
      });
      for (const m of s.matchAll(re)) if (m[0].length) mine.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
      mine.sort((a, b) => a.from - b.from);
      hits.push(...mine);
      return false;
    });
    return hits.slice(0, LIMIT);
  };
  // The index of the first match at or after pos, wrapping to the first; -1 with none.
  const near = (hits, pos) => { if (!hits.length) return -1; const i = hits.findIndex((h) => h.from >= pos); return i < 0 ? 0 : i; };

  // Text in place of each match, as one transaction that starts its own undo step. The new text takes the marks of the
  // match's first character; a note is rewritten with its marks kept.
  const swap = (tr, from, to, text) => {
    const marks = tr.doc.nodeAt(from)?.marks || [];
    if (text) tr.replaceWith(from, to, tr.doc.type.schema.text(text, marks)); else tr.delete(from, to);
  };
  const rewrite = (content, parts, text) => {
    const { paper, parse, serialize, inline } = S(), note = parse(paper, `<div>${content}</div>`), map = S().text(note);
    const tr = new (PM().transform.Transform)(note);
    for (const p of [...parts].sort((a, b) => b.start - a.start)) swap(tr, map.posAt(p.start), map.posAt(p.end), text);
    const html = serialize(paper, tr.doc).replace(/^\s*<p[^>]*>([\s\S]*)<\/p>\s*$/, '$1');
    return inline(html);
  };
  const replace = (state, hits, text = '') => {
    const tr = state.tr, list = [...hits].sort((a, b) => a.from - b.from);
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      if (!h.note) { swap(tr, h.from, h.to, text); continue; }
      const parts = [h.note];
      while (i > 0 && list[i - 1].note && list[i - 1].from === h.from) parts.push(list[--i].note);
      const node = tr.doc.nodeAt(h.from);
      if (node?.type.name === 'footnote_ref') tr.setNodeMarkup(h.from, null, { ...node.attrs, content: rewrite(node.attrs.content, parts, text) });
    }
    return PM().history.closeHistory(tr);
  };

  // ---- the plugin: { query, opts, hits, current, decos }; meta { query?, opts?, at?, current?, refresh? }
  const key = new (PM().state.PluginKey)('gz-find');
  const EMPTY = { query: '', opts: {}, hits: [], current: -1, decos: null };
  const decorate = (doc, hits, current) => {
    const { Decoration, DecorationSet } = PM().view;
    return DecorationSet.create(doc, hits.map((h, i) => {
      const attrs = { class: i === current ? 'ge-hit ge-cur' : 'ge-hit' };
      return h.note ? Decoration.node(h.from, h.to, attrs) : Decoration.inline(h.from, h.to, attrs);
    }));
  };
  const plugin = () => new (PM().state.Plugin)({
    key,
    state: {
      init: () => ({ ...EMPTY, decos: PM().view.DecorationSet.empty }),
      apply: (tr, prev) => {
        const meta = tr.getMeta(key);
        if (meta) {
          const next = { ...prev, ...('query' in meta ? { query: meta.query } : {}), ...('opts' in meta ? { opts: meta.opts } : {}) };
          if ('query' in meta || 'opts' in meta || meta.refresh) {
            next.hits = search(tr.doc, next.query, next.opts);
            next.current = meta.at != null ? near(next.hits, meta.at) : Math.min(prev.current, next.hits.length - 1);
          }
          if (Number.isInteger(meta.current) && next.hits.length) next.current = ((meta.current % next.hits.length) + next.hits.length) % next.hits.length;
          next.decos = next.hits.length ? decorate(tr.doc, next.hits, next.current) : PM().view.DecorationSet.empty;
          return next;
        }
        if (!tr.docChanged || !prev.hits.length) return prev;
        const hits = [];
        let current = -1;
        prev.hits.forEach((h, i) => {
          const from = tr.mapping.map(h.from, 1), to = tr.mapping.map(h.to, -1);
          if (to <= from) return;
          if (i === prev.current) current = hits.length;
          hits.push({ ...h, from, to });
        });
        if (current < 0 && hits.length) current = Math.min(prev.current, hits.length - 1);
        // The marks mapped, not drawn again.
        return { ...prev, hits, current, decos: hits.length ? prev.decos.map(tr.mapping, tr.doc) : PM().view.DecorationSet.empty };
      },
    },
    props: { decorations(state) { return key.getState(state).decos; } },
    view: () => ({ update: (v, before) => { api.onUpdate?.(v, key.getState(before)); } }),
  });

  const api = { pattern, search, near, replace, plugin, key, onUpdate: null };
  const F = globalThis.GZ_WRITER_FRAME;
  if (!F || typeof document === 'undefined') return api;

  // ---- the bar --------------------------------------------------------------------------------------------------------
  const t = (k, v) => F.t(k, v);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const SVG = 'http://www.w3.org/2000/svg';
  const PATHS = { open: 'm9 6 6 6-6 6', up: 'm18 15-6-6-6 6', down: 'm6 9 6 6 6-6', close: 'M6 6l12 12M18 6 6 18' };
  const icon = (d) => { const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', PATHS[d]); s.append(p); return s; };
  const el = (tag, cls, props = {}) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const [k, v] of Object.entries(props)) e.setAttribute(k, v); return e; };
  const button = (cls, label, ...kids) => { const b = el('button', cls, { type: 'button' }); b.append(...kids); b.dataset.label = label; return b; };

  const bar = el('div', 'pop ge-find', { role: 'search' });
  const toggle = button('ge-tg', 'Find and replace', icon('open')), find = el('input', 'ge-in', { type: 'text', spellcheck: 'false', autocomplete: 'off' });
  const count = el('small', 'ge-count', { 'aria-hidden': 'true' }), field = el('label', 'ge-field');
  const caseB = button('ge-ib', 'Match case', 'Aa'), wordB = button('ge-ib', 'Whole word', Object.assign(el('span', 'ge-ww'), { textContent: 'ab' }));
  const prev = button('ge-ib', 'Previous', icon('up')), next = button('ge-ib', 'Next', icon('down')), closeB = button('ge-ib', 'Close', icon('close'));
  const withB = el('input', 'ge-in', { type: 'text', spellcheck: 'false', autocomplete: 'off' }), withField = el('label', 'ge-field');
  const one = button('ge-sb', 'Replace'), all = button('ge-sb', 'Replace all');
  const live = el('div', 'ge-sr', { 'aria-live': 'polite' });
  field.append(find, count);
  withField.append(withB);
  const row1 = el('div', 'ge-row'), row2 = el('div', 'ge-row ge-with');
  row1.append(field, caseB, wordB, el('span', 'ge-sepv'), prev, next, closeB);
  row2.append(withField, one, all);
  bar.append(toggle, row1, row2);
  bar.hidden = true;
  row2.hidden = true;
  caseB.setAttribute('aria-pressed', 'false'); wordB.setAttribute('aria-pressed', 'false'); toggle.setAttribute('aria-expanded', 'false');
  const label = () => {
    for (const b of bar.querySelectorAll('[data-label]')) { const l = t(b.dataset.label); b.title = l; if (b.matches('.ge-tg, .ge-ib')) b.setAttribute('aria-label', l); else b.textContent = l; }
    bar.setAttribute('aria-label', t('Find and replace'));
    find.placeholder = t('Find'); find.setAttribute('aria-label', t('Find'));
    withB.placeholder = t('Replace with'); withB.setAttribute('aria-label', t('Replace with'));
  };

  const view = () => F.editor()?.view;
  const state = () => (view() ? key.getState(view().state) : null);
  const opts = () => ({ cs: caseB.getAttribute('aria-pressed') === 'true', word: wordB.getAttribute('aria-pressed') === 'true' });
  let anchor = 0, said = 0, timer = 0;
  // A repeat (a second "1 replaced") still changes the region's text, so it is heard again.
  const say = (s) => { live.textContent = live.textContent === s ? `${s}\u00a0` : s; };
  const status = () => {
    const s = state();
    if (!s || !find.value) return '';
    return s.hits.length ? t('{n} of {m}', { n: s.current + 1, m: s.hits.length }) : t('No results');
  };
  const drawCount = () => { const s = status(); if (count.textContent !== s) count.textContent = s; };
  const announce = () => { clearTimeout(said); said = setTimeout(() => { const s = status(); if (s) say(s); }, 350); };

  // The current match: selected (a note's mark as a node) and scrolled into view, the bar keeping the focus.
  const reveal = () => {
    const v = view(), s = state();
    if (!v || !s?.hits.length) return;
    const h = s.hits[s.current], { TextSelection, NodeSelection } = PM().state;
    try {
      const sel = h.note ? NodeSelection.create(v.state.doc, h.from) : TextSelection.create(v.state.doc, h.from, h.to);
      v.dispatch(v.state.tr.setSelection(sel).scrollIntoView());
    } catch { /* stale until the next search */ }
  };
  const set = (meta, show = true) => {
    const v = view();
    if (!v) return;
    v.dispatch(v.state.tr.setMeta(key, meta));
    drawCount();
    if (show) reveal();
    announce();
  };
  const search2 = (at = anchor) => set({ query: find.value, opts: opts(), at });
  const step = (d) => {
    if (timer) { clearTimeout(timer); again(); }
    const s = state();
    if (s?.hits.length) set({ current: s.current + d });
  };
  const replaceOne = () => {
    const v = view(), s = state();
    if (!v || !s?.hits.length) return;
    const h = s.hits[s.current];
    v.dispatch(replace(v.state, [h], withB.value));
    v.dispatch(PM().history.closeHistory(v.state.tr));
    set({ refresh: true, at: h.note ? h.to : h.from + withB.value.length });
    say(t('{n} replaced', { n: 1 }));
  };
  const replaceAll = () => {
    const v = view();
    if (!v || !find.value) return;
    const hits = search(v.state.doc, find.value, opts());
    if (!hits.length) return;
    v.dispatch(replace(v.state, hits, withB.value));
    v.dispatch(PM().history.closeHistory(v.state.tr));
    set({ refresh: true, at: 0 }, false);
    clearTimeout(said);
    say(t('{n} replaced', { n: hits.length }));
  };

  // Over the paper's pages, at the top right under its toolbar; in compose, inside the box's top right.
  const place = () => {
    if (bar.hidden || F.mode() !== 'paper') return;
    const c = document.querySelector('.gp-canvas')?.getBoundingClientRect();
    bar.style.top = `${Math.max(8, (c ? c.top : 0) + 12)}px`;
    bar.style.right = `${Math.max(8, innerWidth - (c ? c.right : innerWidth) + 20)}px`;
  };
  const expand = (on) => { toggle.setAttribute('aria-expanded', String(on)); row2.hidden = !on; };
  const open = (replacing) => {
    const v = view();
    if (!v) return;
    if (!bar.isConnected) {
      label();
      if (F.mode() === 'paper') { bar.classList.add('ge-fixed'); document.body.append(bar, live); } else document.getElementById('gw').append(bar, live);
    }
    const sel = v.state.selection, picked = sel.empty ? '' : v.state.doc.textBetween(sel.from, sel.to, '\n');
    anchor = sel.from;
    if (picked && !picked.includes('\n') && picked.length <= MAX) find.value = picked;
    expand(replacing || !row2.hidden && !bar.hidden);
    bar.hidden = false;
    bar.getBoundingClientRect();
    bar.setAttribute('data-open', '');
    place();
    (replacing && find.value ? withB : find).focus();
    find.select();
    search2();
  };
  const close = () => {
    if (bar.hidden) return;
    const v = view();
    bar.hidden = true;
    bar.removeAttribute('data-open');
    clearTimeout(timer); timer = 0;
    if (!v) return;
    v.dispatch(v.state.tr.setMeta(key, { query: '' }));
    v.focus();
  };

  find.addEventListener('input', () => search2());
  find.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
  });
  withB.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } });
  bar.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  for (const b of [caseB, wordB]) b.addEventListener('click', () => { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); search2(view()?.state.selection.from ?? 0); });
  toggle.addEventListener('click', () => { expand(row2.hidden); (row2.hidden ? find : withB).focus(); });
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  closeB.addEventListener('click', close);
  one.addEventListener('click', replaceOne);
  all.addEventListener('click', replaceAll);
  addEventListener('resize', place);

  // ⌘F / Ctrl+F, ⌘⇧H / Ctrl+H (and Ctrl+Shift+H), ⌘G / ⇧⌘G, anywhere in the frame, ahead of the editor and the browser.
  document.addEventListener('keydown', (e) => {
    if (!view() || e.altKey || (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'f' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); open(false); }
    else if (k === 'h' && (e.shiftKey || !mac)) { e.preventDefault(); e.stopPropagation(); open(true); }
    else if (k === 'g' && !bar.hidden) { e.preventDefault(); e.stopPropagation(); step(e.shiftKey ? -1 : 1); }
  }, true);

  // Edits: the matches follow at once (the plugin maps them); found again after a pause, never while an input method
  // composes. A note's current match is marked at the page's foot too.
  const again = () => {
    timer = 0;
    const v = view();
    if (bar.hidden || !v) return;
    if (v.composing) { timer = setTimeout(again, 300); return; }
    const s = state(), cur = s?.hits[s.current];
    set({ refresh: true, at: cur ? cur.from : v.state.selection.from }, false);
  };
  api.onUpdate = (v, before) => {
    const s = key.getState(v.state);
    if (bar.hidden) return;
    if (v.state.doc !== before.doc || s !== before) { if (v.state.doc !== before.doc) { clearTimeout(timer); timer = setTimeout(again, 250); } drawCount(); noteMark(v, s); }
  };
  const noteMark = (v, s) => {
    if (!globalThis.CSS?.highlights || typeof Highlight !== 'function') return;
    const h = s.hits[s.current];
    if (!h?.note) { if (CSS.highlights.has('ge-note')) CSS.highlights.delete('ge-note'); return; }
    CSS.highlights.delete('ge-note');
    let n = 0;
    v.state.doc.nodesBetween(0, h.from + 1, (x) => { if (x.type.name === 'footnote_ref') n++; });
    requestAnimationFrame(() => {
      const p = [...document.querySelectorAll('.gp-sheet .gp-notes p')].find((x) => x.firstChild?.textContent === String(n));
      if (!p) return;
      const at = String(n).length + 1, walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), r = document.createRange();
      let seen = 0, started = false;
      for (let x = walk.nextNode(); x; x = walk.nextNode()) {
        const len = x.data.length;
        if (!started && seen + len > at + h.note.start) { r.setStart(x, at + h.note.start - seen); started = true; }
        if (started && seen + len >= at + h.note.end) { r.setEnd(x, at + h.note.end - seen); CSS.highlights.set('ge-note', new Highlight(r)); return; }
        seen += len;
      }
    });
  };

  F.plugin(plugin());
  F.on('ready', label);
  api.open = open;
  api.close = close;
  return api;
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_FIND;
