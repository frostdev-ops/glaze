// Glaze Writer's compose bar (writer.html, after writer.js), as the mockup draws it: the target ring in the `target` slot
// (progress toward the prompt's minimum, "182 / 250"; green once there, amber past a maximum; plain "N words" without a
// target), the sources pill in `sources` when the prompt asks for sources ("❝ 1 / 2"), and the replies asked for only in
// the ring's tooltip. Targets come in the page's context (lib/writer-context-discussion.js → requirements). It also takes
// the page's `quote { text, author }` (features/writer-quote.js) into the editor, and draws compose's quotes (indented
// italic lines, then "— Name": Ultra's Quill has no blockquote) as the mockup's quote block. Nothing here animates.
// Settings → Writer → Discussions (lib/writer-settings.js writer.compose): target off draws the plain count without the ring;
// quote off takes no quote (features/writer-quote.js shows no pop then). Markdown shortcuts are writer-proof.js's gate.
// Pure helpers first (module.exports for node), then the frame.
var GZ_WRITER_COMPOSE = globalThis.GZ_WRITER_COMPOSE || (() => {
  const R = 15, CIRCLE = 2 * Math.PI * R;
  const whole = (v) => (Number.isInteger(v) && v > 0 ? v : null);
  // The ring for n words: the number it counts toward (the minimum until it's reached, then the maximum if there is one),
  // how full it is (full from the minimum on), and its state.
  const ring = (n, req = {}) => {
    const min = whole(req?.minWords), max = whole(req?.maxWords);
    const target = min && n < min ? min : max || min;
    const state = max && n > max ? 'over' : min && n >= min ? 'ok' : '';
    return { target, state, offset: target ? CIRCLE * (1 - Math.min(1, min ? n / min : n / target)) : CIRCLE };
  };
  // The ring's tooltip: the words, sources and replies asked for, a line each.
  const tip = (req = {}, t = (k, v) => k.replace(/\{(\w+)\}/g, (_, x) => v[x])) => {
    const min = whole(req?.minWords), max = whole(req?.maxWords), lines = [];
    if (min && max) lines.push(t('{min}–{max} words', { min, max }));
    else if (min) lines.push(t('At least {n} words', { n: min }));
    else if (max) lines.push(t('At most {n} words', { n: max }));
    if (whole(req?.replies)) lines.push(t('Reply to {n} classmates', { n: req.replies }));
    return lines.join('\n');
  };
  // In-text citations, counted by the sources they name: "(Morrison 42)", "(Baldwin xix)", "(Smith & Lee, 2020, p. 4)",
  // "(Hooks; Davis 1981)", "("Rememory" 12)", and APA's narrative "Morrison (1987)". A stand-in until the cite stream's
  // own count takes over (GZ_WRITER_CITE.count, below).
  const NAME = "[\\p{Lu}][\\p{L}'’\\-]+(?: (?:[\\p{Lu}][\\p{L}'’\\-]+|de|van|von|der|la|le|du))*";
  const WHO = `(?:"[^"]{1,80}"|“[^”]{1,80}”|${NAME})(?:,? (?:et al\\.?|(?:and|&) ${NAME}))?`;
  const WHERE = "(?:\\d{4}[a-z]?|n\\.d\\.|\\d{1,5}(?:[-–]\\d{1,5})?|[ivxlcdm]{1,8}|(?:pp?|para|ch)\\. ?\\d{1,5}(?:[-–]\\d{1,5})?)";
  const ONE = new RegExp(`^(?:(?:see|cf\\.|e\\.g\\.,?) )?(${WHO})(?:,? ${WHERE}(?:[,:] ?${WHERE})*)?$`, 'u');
  const LOCATED = new RegExp(`,? ${WHERE}`, 'u');
  // Parentheses that point inside a text, not to a source: "(Figure 2)", "(Chapter 3)".
  const INSIDE = /^(?:fig(?:ure)?s?|tables?|chapters?|ch|parts?|pages?|weeks?|sections?|appendix|appendices|steps?|units?|modules?|questions?|exhibits?|lessons?|days?|vol(?:ume)?s?|acts?|scenes?|lines?|notes?|book|verse|slides?|problems?|exercises?|items?|level|grade|room|period|session|episode|season)\.?$/i;
  const NARRATIVE = new RegExp(`(${NAME}(?: et al\\.)?) \\((?:\\d{4}[a-z]?|n\\.d\\.)(?:, (?:pp?\\. ?)?\\d{1,5}(?:[-–]\\d{1,5})?)?\\)`, 'gu');
  const citations = (text) => {
    const s = String(text || '').slice(0, 200000), seen = new Set();
    for (const m of s.matchAll(/\(([^()\n]{2,200})\)/g)) {
      for (const part of m[1].split(/\s*;\s*/)) {
        const c = ONE.exec(part.trim());
        // A bare name in parentheses isn't a citation; one with a year, page or "n.d." is, and so is a quoted title.
        if (c && !INSIDE.test(c[1]) && (LOCATED.test(part) || /^["“]/.test(c[1]))) seen.add(c[1].toLowerCase().replace(/[“”]/g, '"'));
      }
    }
    for (const m of s.matchAll(NARRATIVE)) if (!INSIDE.test(m[1])) seen.add(m[1].toLowerCase());
    return seen.size;
  };
  // Compose's quote shape (lib/writer-editor.js quote: indented, wholly italic paragraphs, then "— Name"), found in a
  // document as the blocks to draw: [{ from, to, by, end }]. None in paper mode, which has real blockquotes.
  const quoted = (node) => node.type.name === 'paragraph' && node.attrs.indent === 1 && node.childCount > 0 && node.content.content.every((c) => c.isText && c.marks.some((k) => k.type.name === 'italic'));
  const byline = (node) => node.type.name === 'paragraph' && node.attrs.indent === 1 && /^— \S/.test(node.textContent);
  const quotes = (doc) => {
    const out = [], kids = [];
    if (doc.type.schema.nodes.blockquote) return out;
    doc.forEach((node, pos) => kids.push({ node, pos }));
    for (let i = 0; i < kids.length; i++) {
      if (!quoted(kids[i].node)) continue;
      let j = i;
      while (j + 1 < kids.length && quoted(kids[j + 1].node)) j++;
      const last = j + 1 < kids.length && byline(kids[j + 1].node) ? j + 1 : j;
      for (let k = i; k <= last; k++) out.push({ from: kids[k].pos, to: kids[k].pos + kids[k].node.nodeSize, by: k > j, end: k === last });
      i = last;
    }
    return out;
  };
  const api = { ring, tip, citations, quotes, CIRCLE, refresh: () => {} };

  const F = globalThis.GZ_WRITER_FRAME;
  if (!F || typeof document === 'undefined') return api;

  // ---- the bar --------------------------------------------------------------------------------------------------------
  const target = F.slot('target'), sources = F.slot('sources');
  const NS = 'http://www.w3.org/2000/svg';
  const circle = (cls) => {
    const c = document.createElementNS(NS, 'circle');
    for (const [k, v] of Object.entries({ class: cls, cx: 18, cy: 18, r: R })) c.setAttribute(k, v);
    return c;
  };
  const svg = document.createElementNS(NS, 'svg'), arc = circle('arc'), num = document.createElement('span');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('class', 'gz-ring');
  svg.setAttribute('aria-hidden', 'true');
  arc.setAttribute('stroke-dasharray', CIRCLE.toFixed(2));
  svg.append(circle('track'), arc);
  num.className = 'gz-num';
  const mark = document.createElement('span'), cited = document.createElement('span');
  mark.className = 'gz-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '❝';
  cited.className = 'gz-num';

  // Sources cited: the saved sources the citations name (GZ_WRITER_CITE.count(doc) → { cited, total }), or, when more,
  // the distinct works the text cites (a citation typed without saving its source counts too).
  const count = (ed, text) => {
    let saved = 0;
    try { if (typeof globalThis.GZ_WRITER_CITE?.count === 'function') saved = Number(GZ_WRITER_CITE.count(ed.view.state.doc)?.cited) || 0; } catch (e) { console.error(e); }
    return Math.max(saved, citations(text));
  };
  let queued = false;
  const W = globalThis.GZ_WRITER_SETTINGS, pref = (k) => W?.now()?.compose?.[k] !== false;
  const later = () => { if (!queued) { queued = true; Promise.resolve().then(draw); } };
  const draw = () => {
    queued = false;
    const ed = F.editor();
    if (!ed) return;
    const all = F.context()?.requirements || {}, req = pref('target') ? all : { ...all, minWords: null, maxWords: null };
    const text = ed.text(), n = GZ_WRITER_EDITOR.words(text), r = ring(n, req);
    if (!target.contains(num)) target.append(svg, num);
    svg.toggleAttribute('hidden', !r.target);
    arc.setAttribute('stroke-dashoffset', r.offset.toFixed(2));
    num.textContent = r.target ? `${n} / ${r.target}` : F.t('{n} words', { n });
    if (r.state) target.dataset.state = r.state; else delete target.dataset.state;
    const title = tip(req, F.t);
    if (title) target.title = title; else target.removeAttribute('title');
    const want = whole(req.sources);
    if (!want) { sources.replaceChildren(); return; }
    const got = count(ed, text);
    if (!sources.contains(cited)) sources.append(mark, cited);
    cited.textContent = `${got} / ${want}`;
    sources.title = F.t('Cite {n} sources', { n: want });
    if (got >= want) sources.dataset.state = 'ok'; else delete sources.dataset.state;
  };
  api.refresh = later;
  for (const ev of ['ready', 'change', 'context', 'look', 'count']) F.on(ev, later);
  W?.follow(later);

  // ---- quotes ---------------------------------------------------------------------------------------------------------
  // The page's Quote pop: what was selected in a post, and who wrote it (from the thread, '' when unknown).
  F.handle('quote', (m) => {
    const ed = F.editor(), text = typeof m.text === 'string' ? m.text.slice(0, 4000) : '';
    if (!ed || !text.trim() || !pref('quote')) return;
    ed.run('quote', { text, author: typeof m.author === 'string' ? m.author.slice(0, 120) : '' });
  });
  // Compose's quotes drawn as the mockup's block (writer-compose.css .gz-quote).
  const { Plugin } = GZ_PM.state, { Decoration, DecorationSet } = GZ_PM.view;
  const blocks = (doc) => DecorationSet.create(doc, quotes(doc).map((q) => Decoration.node(q.from, q.to, { class: `gz-quote${q.by ? ' gz-quote-by' : ''}${q.end ? ' gz-quote-end' : ''}` })));
  F.plugin(new Plugin({
    state: { init: (_, state) => blocks(state.doc), apply: (tr, set) => (tr.docChanged ? blocks(tr.doc) : set) },
    props: { decorations(state) { return this.getState(state); } },
  }));
  return api;
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_COMPOSE;
