// LMS rules on the page: the worn Look's x.rules, folded by lib/parts.js into each named part's
// end state, put on that part's elements. Hide and style are attributes and --gz-r-* variables that features/rules.css
// reads (never inline display); a move leaves a marker where the element was; a label swaps the element's first text and
// puts it back exactly, as nicknames do (content-ultra.js). content.js loads this once the Look has rules and calls
// sync() on every pass (flush), on glaze:parts and on disable; with the theme off, on a quiz or a tool's page, or with
// no rules for this LMS, sync() takes everything back off. Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_RULES = globalThis.GZ_RULES || (() => {
  const ctx = globalThis.GZ_CTX;
  const html = document.documentElement;
  const libs = () => Promise.all([ctx.need('lib/parts.js', () => globalThis.GZ_PARTS), ctx.need('lib/lookx.js', () => globalThis.GZ_LX)]);
  // Rules stay off whole quiz and tool routes, including their overview and entry pages.
  const quiet = () => GZ_LX.quiet(location.pathname, document) || /\/(quizzes|external_tools)(\/|$)|\/mod\/(quiz|lti)(\/|$)/.test(location.pathname)
    || (ctx.site === 'ultra' && /\/(assessment|attempt|lti)(\/|$)/.test(location.pathname));
  // Glaze's own pieces are never a part's, and nothing that holds Glaze settings is hidden.
  const OWN = '[id^="gz-"], [class^="gz-"], [class*=" gz-"]';
  const GLAZE_ITEM = 'a[href="#glaze"]';
  const CONTROL = 'a[href], button, input, select, textarea, summary, [contenteditable], [role="button"], [tabindex]';

  const done = new Map(); // element -> { hide, st: 'bg r', vars: {name: value}, mark: Comment | null, moves }
  const labels = new Map(); // text node -> { real, mine }
  const sheet = (on) => {
    const l = document.getElementById('gz-rules-css');
    if (on && !l) (document.head || html).append(Object.assign(document.createElement('link'), { id: 'gz-rules-css', rel: 'stylesheet', href: chrome.runtime.getURL('features/rules.css') }));
    else if (!on) l?.remove();
  };

  const unlabel = (n, r) => {
    if (n.data === r.mine) n.data = r.real;
    // A nickname swapped in over the label keeps the real name to put back (content-ultra.js unname).
    const p = n.parentElement;
    if (p?.dataset.gzReal === r.mine) p.dataset.gzReal = r.real;
  };
  // The element's first text that isn't Glaze's. Kept once found, so a label that changes swaps the same text.
  const textOf = (el, was) => {
    if (was && el.contains(was)) return was;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.trim() && !n.parentElement?.closest(OWN) ? 1 : 3) });
    return walk.nextNode();
  };
  const label = (el, text, was) => {
    const n = textOf(el, was);
    if (!n) return null;
    let r = labels.get(n);
    // A course's nickname (content-ultra.js) is the student's own: it wins, before or after the label.
    if (n.parentElement?.dataset.gzReal !== undefined) {
      if (r) { unlabel(n, r); labels.delete(n); }
      return null;
    }
    if (!r) labels.set(n, (r = { real: n.data, mine: null }));
    else if (n.data !== r.mine) r.real = n.data; // the LMS wrote it again: that is the text to put back
    // The real text's own spacing stays around the label, so the layout doesn't shift.
    const [, a, , b] = r.real.match(/^(\s*)([\s\S]*?)(\s*)$/);
    r.mine = a + text + b;
    if (n.data !== r.mine) n.data = r.mine;
    return n;
  };

  // Out of the way of the page: the element's own attributes and variables, and its place back from the marker.
  const undo = (el, d) => {
    el.removeAttribute('data-gz-r-hide');
    el.removeAttribute('data-gz-r-st');
    for (const k of Object.keys(d.vars)) el.style.removeProperty(k);
    if (el.getAttribute('style') === '') el.removeAttribute('style');
    if (d.mark) { if (el.isConnected && d.mark.isConnected) d.mark.replaceWith(el); else d.mark.remove(); }
  };
  const clear = () => {
    for (const [el, d] of done) undo(el, d);
    done.clear();
    for (const [n, r] of labels) unlabel(n, r);
    labels.clear();
    sheet(false);
  };

  // Each part's elements on the page now, with what its end state asks of them; an element two parts name takes both.
  const want = (plan) => {
    const els = new Map();
    for (const [name, s] of plan) {
      const part = GZ_PARTS.get(name);
      for (const el of document.querySelectorAll(part.s)) {
        if (el.closest(OWN)) continue;
        const w = els.get(el) || { hide: false, vars: {}, st: [], t: '', move: null, part };
        els.set(el, w);
        if (s.hide) w.hide = true;
        Object.assign(w.vars, s.vars);
        w.st.push(...Object.keys(s.st));
        if (s.t) w.t = s.t;
        if (s.move) w.move = s.move;
      }
      for (const f of s.fonts) GZ_FONTS.load(f);
    }
    for (const [el, w] of els) {
      if ((w.hide || w.st.includes('o')) && (el.matches(GLAZE_ITEM) || el.querySelector(GLAZE_ITEM)
        || [...el.querySelectorAll(OWN)].some((node) => node.matches(CONTROL) || node.querySelector(CONTROL)))) {
        w.hide = false;
        delete w.vars['--gz-r-o'];
        w.st = w.st.filter((k) => k !== 'o');
      }
    }
    return els;
  };
  // Beside the first element of the other part in the same container. An LMS that keeps putting it back wins after a few
  // tries, rather than the two of them moving it on every pass.
  const move = (el, m, part, d) => {
    if (d.move?.to !== m.to || d.move?.at !== m.at) { d.moves = 0; d.move = m; }
    const box = el.parentElement?.closest(part.in);
    const to = box && [...box.querySelectorAll(GZ_PARTS.get(m.to).s)].find((b) => b !== el && !b.contains(el) && !el.contains(b));
    if (!to || (m.at === 'before' ? to.previousElementSibling : to.nextElementSibling) === el || d.moves > 3) return;
    if (!d.mark) { d.mark = document.createComment('gz-rule'); el.before(d.mark); }
    d.moves++;
    if (m.at === 'before') to.before(el); else to.after(el);
  };

  const apply = (plan) => {
    sheet(true);
    const els = want(plan);
    const texts = new Set();
    for (const [el, d] of done) if (!els.has(el)) { undo(el, d); done.delete(el); }
    for (const [el, w] of els) {
      const d = done.get(el) || { vars: {}, mark: null, moves: 0, text: null };
      done.set(el, d);
      if (el.hasAttribute('data-gz-r-hide') !== w.hide) el.toggleAttribute('data-gz-r-hide', w.hide);
      const st = [...new Set(w.st)].join(' ');
      if (!st) el.removeAttribute('data-gz-r-st'); else if (el.getAttribute('data-gz-r-st') !== st) el.setAttribute('data-gz-r-st', st);
      for (const k of Object.keys(d.vars)) if (!(k in w.vars)) el.style.removeProperty(k);
      for (const [k, v] of Object.entries(w.vars)) if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v);
      d.vars = w.vars;
      if (w.t) { d.text = label(el, w.t, d.text); if (d.text) texts.add(d.text); }
      if (w.move) move(el, w.move, w.part, d);
      else if (d.mark) { if (d.mark.isConnected) d.mark.replaceWith(el); d.mark = null; d.moves = 0; }
    }
    for (const [n, r] of labels) if (!texts.has(n)) { unlabel(n, r); labels.delete(n); }
  };

  const sync = () => {
    const x = ctx.on() && ctx.parts();
    if (!x?.rules?.length) return clear();
    if (!globalThis.GZ_PARTS || !globalThis.GZ_LX) { libs().then(sync, () => {}); return; }
    const plan = quiet() ? null : GZ_PARTS.plan(x.rules, ctx.site);
    if (!plan?.size) return clear();
    apply(plan);
  };
  return { sync };
})();
GZ_RULES;
