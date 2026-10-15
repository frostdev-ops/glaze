// The GPA's past terms, trends and goal, loaded on demand: features/grades.js draws it in the Dashboard's GPA, under
// "Past terms, trends and goal", while that is open (and asks for it from the command palette).
// - Past terms: typed in, or read on this device from a transcript's text, a PDF, a picture or screenshot (also
//   pasted), a web page or a Word file (features/import.js), and always shown for review before they are kept.
//   Pass/fail, withdrawn and transfer rows are listed, not counted. Any AI reading waits on the owner (DECISIONS.md).
// - Trends: term and cumulative GPA over time, an inline chart in the palette's colors, with the same figures as a
//   table for screen readers and keyboards.
// - Goal: a cumulative or term GPA to reach; what this term needs, and one way there from the grades now, with the
//   lowest percent for each letter and, on request, what the course's work left needs (features/grades.js needFor).
// The arithmetic is lib/gpa.js. Kept in storage.local through the service worker's queue (features/grades.js savePast).
var GZ_GPA_TERMS = globalThis.GZ_GPA_TERMS || (() => {
  const X = globalThis.GZ_CTX;
  const { t, locale } = X;
  const G = () => globalThis.GZ_GPA;
  const C = () => globalThis.GZ_GRADECALC;
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const label = (el, text) => { el.setAttribute('aria-label', text); return el; };
  const f = (el, key) => { el.dataset.f = key; return el; };
  const btn = (text, key, run, cls = 'gz-calc-btn') => { const b = f(make('button', { type: 'button', className: cls, textContent: text }), key); b.addEventListener('click', run); return b; };
  const note = (text, cls = 'gz-gpa-note') => make('p', { className: cls, textContent: text });
  const sum = (list, k) => list.reduce((n, x) => n + k(x), 0);
  const one = (x) => new Intl.NumberFormat(GZ_I18N.locale(locale()), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x);
  const docIn = () => X.need('lib/doctext.js', () => globalThis.GZ_DOCTEXT);
  // What the view keeps between draws: terms in review, the import's text, a word for the student, the terms open, the
  // goal kind picked before a value, the courses' answers, and where focus goes next.
  // reading: the AbortController and words of a PDF or picture being read, until it ends or another read starts; ocr:
  // what came from a picture, for the review's note.
  const V = { review: null, text: '', note: '', open: new Set(), importOpen: false, kind: 'cum', needs: new Map(), caps: new Map(), focus: null, gen: 0, reading: null, ocr: null };
  let body, api;
  const hooked = new WeakSet();
  const redraw = () => { if (body?.isConnected) draw(body, api); };
  const saved = (ok) => { if (!ok) { V.note = t('Not saved. Try again in a moment.'); redraw(); } };
  const stat = (term, w) => C().gpa(G().rowsOf(term, w));

  // ---- one term's courses ------------------------------------------------------------------------------------------
  // keep(term) saves a change to it; drop() removes it. Rows that don't count say why, beside their grade.
  const editor = (term, keep, drop, w) => {
    const id = term.id;
    const set = (patch) => keep({ ...term, ...patch });
    const setRow = (i, patch) => set({ c: term.c.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
    const tname = term.n || t('this term');
    const name = f(label(make('input', { type: 'text', value: term.n, maxLength: 60, placeholder: t('Fall 2025') }), t('Term name')), `${id}:n`);
    name.addEventListener('change', () => set({ n: name.value }));
    const scale = f(label(make('select', {}, make('option', { value: '1', textContent: t('Plus/minus grade points') }), make('option', { value: '0', textContent: t('Whole letters (A− is 4.0)') })),
      t('Grade points for {name}', { name: tname })), `${id}:p`);
    scale.value = term.p === 0 ? '0' : '1';
    scale.addEventListener('change', () => set({ p: Number(scale.value) }));
    const head = make('tr', {}, ...['Course', 'Credits', 'Grade', ...(w ? ['Level'] : []), 'Counts', ''].map((h) => make('th', { scope: 'col', textContent: h ? t(h) : '' })));
    const rows = term.c.map((r, i) => {
      const cn = r.n || t('Course {n}', { n: i + 1 });
      const nm = f(label(make('input', { type: 'text', value: r.n, maxLength: 100 }), t('Course name')), `${id}:${i}:n`);
      nm.addEventListener('change', () => setRow(i, { n: nm.value }));
      const cr = f(label(make('input', { type: 'number', min: 0, max: 30, step: 0.5, value: r.cr }), t('Credits for {name}', { name: cn })), `${id}:${i}:cr`);
      cr.addEventListener('change', () => { const v = parseFloat(cr.value); if (Number.isFinite(v) && v >= 0 && v <= 30) setRow(i, { cr: v }); else cr.setAttribute('aria-invalid', 'true'); });
      const g = f(label(make('input', { type: 'text', value: r.g, maxLength: 8, placeholder: 'A-' }), t('Grade for {name}: a letter, grade points, or P, W or TR', { name: cn })), `${id}:${i}:g`);
      g.addEventListener('change', () => setRow(i, { g: g.value }));
      const why = G().why(r);
      const tag = why ? make('small', { id: `gz-gpa-why-${id}-${i}`, className: 'gz-gpa-why', textContent: t({ out: 'Left out', pf: 'Pass/fail: not in the GPA', w: 'Withdrawn: not in the GPA', tr: 'Transfer: not in the GPA', none: 'Not a grade the GPA counts', credits: 'No credits' }[why]) }) : '';
      if (tag) g.setAttribute('aria-describedby', tag.id);
      const level = f(label(make('select', {}, ...[[0, 'Regular'], [0.5, 'Honors (+0.5)'], [1, 'AP or IB (+1)']].map(([v, n]) => make('option', { value: v, textContent: t(n), selected: (r.l || 0) === v }))), t('Level of {name}', { name: cn })), `${id}:${i}:l`);
      level.addEventListener('change', () => setRow(i, { l: Number(level.value) }));
      const counts = f(label(make('input', { type: 'checkbox', checked: r.x !== 1 }), t('Count {name} in your GPA', { name: cn })), `${id}:${i}:x`);
      counts.addEventListener('change', () => setRow(i, { x: counts.checked ? 0 : 1 }));
      const del = btn('×', `${id}:${i}:del`, () => { V.focus = `${id}:add`; set({ c: term.c.filter((_, k) => k !== i) }); }, 'gz-calc-x');
      label(del, t('Remove {name}', { name: cn }));
      return make('tr', {}, make('td', {}, nm), make('td', {}, cr), make('td', { className: 'gz-gpa-grade' }, g, tag), w ? make('td', {}, level) : '', make('td', {}, counts), make('td', {}, del));
    });
    const add = btn(t('Add a course'), `${id}:add`, () => { V.focus = `${id}:${term.c.length}:n`; set({ c: [...term.c, { n: '', cr: C().CREDITS, g: '' }] }); });
    const remove = btn(t('Remove this term'), `${id}:drop`, drop);
    return make('div', { className: 'gz-gpa-edit' }, make('div', { className: 'gz-gpa-switches' }, name, scale),
      make('div', { className: 'gz-gpa-scroll' }, make('table', {}, make('thead', {}, head), make('tbody', {}, ...rows))),
      make('div', { className: 'gz-gpa-actions' }, add, remove));
  };

  // ---- trends ------------------------------------------------------------------------------------------------------
  // s: lib/gpa.js series, oldest first, the last one this term's when `now`. The chart is drawn for sighted readers; the
  // table under it has the same figures and is what a screen reader reads.
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };
  const chart = (s, now) => {
    const pts = s.flatMap((x) => [x.gpa, x.cum]).filter((v) => v != null);
    const lo = Math.max(0, Math.floor(Math.min(...pts) * 2) / 2 - 0.5);
    const hi = Math.max(4, Math.ceil(Math.max(...pts) * 2) / 2);
    const [W, H, L, R, T, B] = [640, 190, 34, 10, 10, 30];
    const x = (i) => L + ((i + 0.5) * (W - L - R)) / s.length;
    const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
    const grid = [];
    for (let v = lo; v <= hi + 1e-9; v += 0.5) grid.push(svg('line', { class: 'gz-grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }), svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, one(v)));
    const line = (k, cls) => svg('polyline', { class: cls, points: s.map((p, i) => (p[k] == null ? '' : `${x(i)},${y(p[k])}`)).filter(Boolean).join(' ') });
    const fit = Math.max(4, Math.floor((W - L - R) / s.length / 6.5));
    const names = s.map((p, i) => svg('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, p.name.length > fit ? `${p.name.slice(0, fit - 1)}…` : p.name));
    const dots = s.map((p, i) => (p.gpa == null ? '' : svg('circle', { class: now && i === s.length - 1 ? 'gz-now' : '', cx: x(i), cy: y(p.gpa), r: 4 }, svg('title', {}, `${p.name}: ${api.two(p.gpa)}`))));
    const pic = svg('svg', { class: 'gz-gpa-chart', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' }, ...grid, line('cum', 'gz-cum'), line('gpa', 'gz-term'), ...dots, ...names);
    const key = make('p', { className: 'gz-gpa-key' }, make('span', { className: 'gz-term', textContent: t('Term GPA') }), make('span', { className: 'gz-cum', textContent: t('Cumulative GPA') }));
    key.setAttribute('aria-hidden', 'true');
    return [pic, key];
  };
  const trends = (s, now) => {
    if (!s.length) return [note(t('Add a past term below to see your GPA over time.'))];
    const rows = make('tbody', {}, ...s.map((p, i) => make('tr', {},
      make('th', { scope: 'row' }, make('span', { textContent: p.name }), now && i === s.length - 1 ? make('small', { textContent: t('Now, from Canvas') }) : ''),
      make('td', { textContent: p.gpa == null ? '–' : api.two(p.gpa) }), make('td', { textContent: GZ_I18N.num(p.credits, locale()) }), make('td', { textContent: p.cum == null ? '–' : api.two(p.cum) }))));
    const table = make('table', {}, make('caption', { textContent: t('Your GPA by term') }),
      make('thead', {}, make('tr', {}, ...['Term', 'Term GPA', 'Credits', 'Cumulative GPA'].map((h) => make('th', { scope: 'col', textContent: t(h) })))), rows);
    return [...(s.filter((p) => p.gpa != null).length > 1 ? chart(s, now) : []), make('div', { className: 'gz-gpa-scroll' }, table)];
  };

  // ---- the goal ----------------------------------------------------------------------------------------------------
  // What the work left in a course needs for a letter's lowest percent, once asked (features/grades.js needFor).
  const needText = (r, min) => (r == null ? t("Glaze couldn't load this course's scores.")
    : !r.left ? t('Nothing left to change: {pct}.', { pct: r.best == null ? '–' : api.pct(r.best) })
      : r.reachable === false ? t('Out of reach: full marks on the {n} items left would make {pct}.', { n: r.left, pct: api.pct(r.best) })
        : r.share === 0 ? t("You'd stay at {pct} or above even with zeros on what's left.", { pct: api.pct(min) })
          : t("You'd need about {pct} on each of the {n} items left.", { n: r.left, pct: GZ_I18N.pct(Math.ceil(r.share * 1000) / 10, locale()) }));
  const goal = (past, rows, w, plus) => {
    const g = past.g;
    const kind = f(make('select', {}, ...[['cum', 'Cumulative GPA'], ['term', "This term's GPA"]].map(([v, n]) => make('option', { value: v, textContent: t(n) }))), 'goal:k');
    kind.value = g?.k || V.kind;
    const value = f(make('input', { type: 'number', min: 0, max: 6, step: 0.01, value: g?.v ?? '', placeholder: '3.5' }), 'goal:v');
    const keep = () => {
      V.kind = kind.value;
      const v = parseFloat(value.value);
      api.save({ op: 'goal', goal: Number.isFinite(v) && v > 0 && v <= 6 ? { k: kind.value, v } : null }).then(saved);
    };
    kind.addEventListener('change', keep);
    value.addEventListener('change', keep);
    const out = [make('div', { className: 'gz-gpa-switches' }, make('label', {}, t('Goal GPA'), ' ', value), make('label', {}, t('Goal for'), ' ', kind))];
    if (!g) return out;
    // This term: every course with credits that counts, graded yet or not; a course whose letter has no grade points
    // (Pass, Excellent), or whose best on its scale has none (lib/gpa.js noGpa), is no GPA course. The most each can
    // make is the best letter it can still give (lib/gpa.js topOf: its scale, and what its work left reaches once
    // asked), with its bonus.
    const eligible = rows.filter((r) => r.credits > 0 && (r.pts != null || !r.letter));
    const bonus = (r) => (w ? r.p.l || 0 : 0);
    // A course's lowest percent for a letter needs its scale: the student's own, else the course's own scheme where
    // Canvas gives the letter (asked for once), else Canvas's default.
    const scaleOf = (c) => {
      const own = c.p.s ? C().parseScheme(c.p.s) : null;
      const id = String(c.c.id);
      const canvas = c.c.enrollments?.find((e) => e.type === 'student')?.computed_current_grade;
      if (own || !canvas) return own || C().SCHEME;
      if (!api.schemes.has(id)) api.schemeFor(id);
      return api.schemes.get(id) || null;
    };
    // A course whose work left can't reach a letter (asked with What it takes) is held below it.
    const all = eligible.map((c) => [c, { credits: c.credits, letter: c.pts == null ? null : c.letter, score: c.rqd ? null : c.score, scale: c.rqd ? null : scaleOf(c), bonus: bonus(c), max: V.caps.get(String(c.c.id)) }]);
    const pairs = all.filter(([, x]) => !G().noGpa(x));
    const cur = pairs.map(([c]) => c);
    const courses = pairs.map(([, x]) => x);
    // The plan assumes those pass (an F there counts until then): each is a condition, shown with the route.
    const pass = all.filter(([, x]) => G().noGpa(x)).map(([c, x]) => ({ c, best: G().passOf(x), name: c.c.name || c.c.course_code || '' }));
    const L = G().LADDER[!!plus];
    const credits = sum(cur, (r) => r.credits);
    const done = past.t.flatMap((x) => G().rowsOf(x, w)).filter((x) => x.points != null && x.credits > 0);
    const was = { points: sum(done, (x) => x.points * x.credits), credits: sum(done, (x) => x.credits) };
    const top = credits ? sum(courses, (c) => c.credits * C().points(L[Math.max(0, G().topOf(c, plus))], plus, c.bonus)) / credits : 0;
    const r = G().goal({ past: was, credits, top }, g.k, g.v);
    const say = make('p', { className: 'gz-calc-out', role: 'status' });
    out.push(say);
    if (!r) { say.textContent = t('Give your courses this term credits to plan for a goal.'); return out; }
    if (r.met) { say.textContent = pass.length ? t("You'll reach it as long as you pass {names}.", { names: pass.map((p) => p.name).join(', ') }) : t("You'll reach it whatever this term brings."); return out; }
    if (r.reachable === false) {
      say.textContent = g.k === 'cum' ? t("Out of reach this term: the best grades your courses can still give would bring your cumulative GPA to {gpa}.", { gpa: api.two(r.best) }) : t("Out of reach: the best grades your courses can still give make {gpa} this term.", { gpa: api.two(r.best) });
      return out;
    }
    const avg = L.find((n) => C().points(n, plus) >= r.need - 1e-9) || 'A';
    say.textContent = t('This term needs a GPA of {gpa}: about {letter} in every course.', { gpa: api.two(r.need), letter: avg });
    // One way there. "Your grades now get you there" only when every course has a grade now and none needs to rise.
    const plan = G().route(courses, r.need, plus);
    if (!plan) { out.push(note(t("There's no way there with the work left in your courses."))); return out; }
    // Met now only on grades that count now: a course to pass that has an F now still has to rise, and one with no
    // grade yet leaves it unknown.
    const rise = plan.some((p) => p.up > 0) || pass.some((p) => p.c.pts != null);
    const unknown = plan.some((p) => p.up == null) || pass.some((p) => p.c.pts == null);
    out.push(note(!rise && !unknown ? t('Your grades now get you there. To keep them:')
      : !rise ? t("Some courses have no grade yet, so whether your grades now get you there isn't known. One way there:") : t('One way there, from your grades now:')));
    const rowsOut = cur.map((c, i) => {
      const p = plan[i];
      const name = c.c.name || c.c.course_code || '';
      const key = `${c.c.id}:${p.min}`;
      const cell = make('td', { className: 'gz-gpa-need' });
      cell.setAttribute('aria-live', 'polite');
      if (V.needs.has(key)) cell.textContent = needText(V.needs.get(key), p.min);
      else if (p.min != null && c.score != null && !c.rqd) {
        const b = label(btn(t('What it takes'), `need:${key}`, () => {
          b.disabled = true;
          // Aimed at the lowest raw percent that rounds to the letter's bound, as Canvas rounds (gradecalc reachFrom).
          api.needFor(c.c, C().reachFrom(p.min)).then((x) => x, () => null).then((x) => {
            V.needs.set(key, x);
            if (x?.reachable === false || (x && !x.left)) V.caps.set(String(c.c.id), x.best ?? -1);
            V.focus = 'goal:v';
            redraw();
          });
        }), t('What it takes in {name}', { name }));
        cell.append(b);
      }
      return make('tr', {}, make('th', { scope: 'row', textContent: name }), make('td', { textContent: c.pts == null ? '–' : c.letter }),
        make('td', { className: p.up > 0 ? 'gz-gpa-up' : '', textContent: p.letter }), make('td', { textContent: p.min == null ? '–' : `${api.pct(p.min)}+` }), cell);
    });
    out.push(make('div', { className: 'gz-gpa-scroll' }, make('table', {}, make('thead', {}, make('tr', {}, ...['Course', 'Now', 'Aim for', 'Lowest percent', ''].map((h) => make('th', { scope: 'col', textContent: h ? t(h) : '' })))), make('tbody', {}, ...rowsOut, ...pass.map((p) => make('tr', {}, make('th', { scope: 'row', textContent: p.name }),
      make('td', { textContent: p.c.pts == null ? '–' : p.c.letter }), make('td', { className: 'gz-gpa-up', textContent: p.best[0] }),
      make('td', { textContent: `${api.pct(p.best[1])}+` }), make('td', { textContent: t('Pass {name} (reach {letter}).', { name: p.name, letter: p.best[0] }) })))))));
    return out;
  };

  // ---- importing a transcript --------------------------------------------------------------------------------------
  // Read here, never sent anywhere; what it finds goes to review first. Each read (a file picked, Read it, Cancel) is a
  // new generation: a file still being read when another read starts is dropped, not shown over it.
  const review = (text, ocr = null) => {
    const found = G().parse(text);
    V.note = found.length ? '' : t('Glaze found no terms or courses in that. Paste the part with your courses and grades, or add terms by hand.');
    V.review = found.length ? found.map((x) => ({ ...x, id: G().newId() })) : null;
    V.ocr = found.length ? ocr : null;
    V.focus = found.length ? 'rev:h' : 'imp:text';
    redraw();
  };
  // A PDF or picture is read while "Past terms, trends and goal" is open: closing it (draw's hook), the view gone from
  // the page, Stop reading or another read calls it off, and what it found is shown only if the view is still open.
  const shown = () => !!body?.isConnected && body.closest('details')?.open !== false;
  const readFile = async (file) => {
    const gen = ++V.gen;
    V.reading?.ctl.abort();
    const ctl = new AbortController();
    // Kept from the start, so it can be called off before it has said anything.
    V.reading = { ctl, say: '' };
    const show = (text, ocr) => { if (gen === V.gen && shown()) review(text, ocr); };
    // Only a PDF or picture says how far it has got: its first word draws the progress line and Stop reading.
    const prog = (s) => {
      if (!shown() || gen !== V.gen || V.reading?.ctl !== ctl) return ctl.abort();
      const first = !V.reading.say;
      V.reading.say = s;
      const el = body.querySelector('[data-f="imp:prog"]');
      if (first || !el) redraw(); else el.textContent = s;
    };
    try {
      await X.need('features/import.js', () => globalThis.GZ_IMPORT);
      const r = await GZ_IMPORT.read(file, { signal: ctl.signal, progress: prog });
      if (V.reading?.ctl === ctl) V.reading = null;
      show(r.text, r.ocr);
    } catch (e) {
      if (V.reading?.ctl === ctl) V.reading = null;
      if (gen === V.gen) { V.note = e?.cancelled ? t('Stopped.') : e?.mine ? e.message : t("Glaze couldn't read that file."); V.focus = 'imp:file'; redraw(); }
    }
  };
  const importer = () => {
    const area = f(label(make('textarea', { rows: 5, value: V.text, placeholder: 'Fall 2024\nBIO 101  Introduction to Biology  4.0  A-' }), t("Your transcript's text")), 'imp:text');
    area.addEventListener('input', () => { V.text = area.value; });
    // A table copied from a web page keeps its rows when its HTML is read (lib/doctext.js).
    area.addEventListener('paste', (e) => {
      // A screenshot of the transcript, read like a picture file.
      const img = e.isTrusted && [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (img) { e.preventDefault(); if (!V.reading) readFile(img); return; }
      const html = e.clipboardData?.getData('text/html');
      const plain = e.clipboardData?.getData('text/plain') || '';
      if (!html) return;
      e.preventDefault();
      const [a, b] = [area.selectionStart, area.selectionEnd];
      docIn().then(() => GZ_DOCTEXT.html(html), () => plain).catch(() => plain).then((text) => { area.setRangeText(text, a, b, 'end'); V.text = area.value; });
    });
    const file = f(label(make('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.txt,.htm,.html,.docx,application/pdf,image/*,text/plain,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), t('A transcript file: a PDF, a picture or screenshot, text, a web page or Word')), 'imp:file');
    file.addEventListener('change', () => { if (file.files?.[0]) readFile(file.files[0]); });
    const go = btn(t('Read it'), 'imp:go', () => { V.gen++; V.reading?.ctl.abort(); review(V.text); });
    const busy = V.reading?.say && make('div', { className: 'gz-gpa-actions' }, f(make('span', { className: 'gz-gpa-note', role: 'status', textContent: V.reading.say }), 'imp:prog'),
      btn(t('Stop reading'), 'imp:stop', () => V.reading?.ctl.abort()));
    const box = make('details', { className: 'gz-gpa-more', open: !!V.text || !!V.importOpen || !!V.reading?.say }, make('summary', { textContent: t('Import from a transcript') }),
      note(t('Read on this device; nothing is uploaded. PDFs, pictures and screenshots (paste one into the box), text, web pages and Word files work.')),
      area, make('div', { className: 'gz-gpa-actions' }, go, file), busy || '');
    box.addEventListener('toggle', () => { V.importOpen = box.open; });
    return box;
  };
  const reviewer = (past, w) => {
    const h = f(make('h4', { tabIndex: -1, textContent: t('Check what Glaze found, then add it') }), 'rev:h');
    const terms = V.review.map((term, i) => {
      // What the transcript printed for the term, checked: a matching GPA over different credits doesn't reassure.
      const k = G().check(term, w);
      const lines = [];
      if (!term.n) lines.push(t('Give this term a name.'));
      if (past.t.some((x) => x.n && x.n.toLowerCase() === term.n.toLowerCase())) lines.push(t('This replaces your {name}.', { name: term.n }));
      if (term.skipped?.length) lines.push(t('Glaze skipped these lines: {lines}. Add them by hand if they are courses.', { lines: term.skipped.slice(0, 5).join(' · ') }));
      if (k.credits === false) lines.push(t("These courses come to {credits} credits, a total your transcript doesn't show: check for a course Glaze missed.", { credits: GZ_I18N.num(k.all, locale()) }));
      if (k.gpa != null) lines.push(t('Your transcript says {a}; Glaze makes it {b}.', { a: api.two(term.gpa), b: api.two(k.mine) }) + (k.gpa === false || k.credits === false || term.skipped?.length ? ` ${t('Check the grades and credits.')}` : ''));
      return make('fieldset', { className: 'gz-gpa-term' }, make('legend', { textContent: term.n || t('Unnamed term') }), ...lines.map((x) => note(x)),
        editor(term, (x) => { V.review[i] = x; redraw(); }, () => { V.review.splice(i, 1); if (!V.review.length) V.review = null; V.focus = 'rev:h'; redraw(); }, w));
    });
    const add = btn(t('Add these terms'), 'rev:add', () => {
      const terms = V.review.map(({ gpa, printed, skipped, ...x }) => x);
      for (const x of terms) V.open.delete(x.id);
      Object.assign(V, { review: null, text: '', focus: 'hist' });
      api.save({ op: 'add', terms }).then(saved);
    });
    const cancel = btn(t('Cancel'), 'rev:cancel', () => { Object.assign(V, { review: null, focus: 'imp:text', gen: V.gen + 1 }); redraw(); });
    // Read from a picture: every grade and credit is the OCR engine's reading, so the note says to check them.
    const ocr = V.ocr && globalThis.GZ_IMPORT && note(GZ_IMPORT.note(V.ocr));
    return label(make('section', { className: 'gz-gpa-review' }, h, ocr || '', ...terms, make('div', { className: 'gz-gpa-actions' }, add, cancel)), t('Review'));
  };

  // ---- the view ----------------------------------------------------------------------------------------------------
  const draw = (el, a) => {
    [body, api] = [el, a];
    // Closing the panel this view is in stops a read at once, not at its next word.
    const host = el.closest('details');
    if (host && !hooked.has(host)) { hooked.add(host); host.addEventListener('toggle', () => { if (!host.open) V.reading?.ctl.abort(); }); }
    const focus = V.focus || (el.contains(document.activeElement) && document.activeElement.dataset.f);
    V.focus = null;
    const e = X.settings().enhance;
    const w = !!e.gpaWeighted;
    const past = a.past();
    const rows = a.rows();
    // This term, as one point after the past ones: the current courses with a grade.
    const graded = rows.filter((r) => r.pts != null);
    const names = [...new Set(rows.map((r) => r.termName))];
    const now = graded.length ? { name: names.length === 1 && names[0] ? names[0] : t('This term'), rows: graded.map((r) => ({ credits: r.credits, points: w ? r.wpts : r.pts })) } : null;
    const order = G().order(past.t);
    const s = G().series([...order.map((x) => ({ name: x.n || t('Unnamed term'), rows: G().rowsOf(x, w) })), ...(now ? [now] : [])]);
    const twice = now && past.t.find((x) => x.n.trim().toLowerCase() === now.name.toLowerCase());
    const terms = order.map((term) => {
      const g = stat(term, w).gpa;
      const d = make('details', { className: 'gz-gpa-term', open: V.open.has(term.id) },
        f(make('summary', { textContent: `${term.n || t('Unnamed term')} · ${g == null ? t('No grade yet') : api.two(g)}` }), `${term.id}:s`),
        editor(term, (x) => a.save({ op: 'term', term: x }).then(saved), () => { V.focus = 'add-term'; a.save({ op: 'drop', id: term.id }).then(saved); }, w));
      d.addEventListener('toggle', () => { if (d.open) V.open.add(term.id); else V.open.delete(term.id); });
      return d;
    });
    const addTerm = btn(t('Add a term'), 'add-term', () => {
      const term = { id: G().newId(), n: '', c: [{ n: '', cr: C().CREDITS, g: '' }] };
      V.open.add(term.id);
      V.focus = `${term.id}:n`;
      a.save({ op: 'term', term }).then(saved);
    });
    const clear = past.t.length ? btn(t('Remove all past terms'), 'clear', () => {
      if (confirm(t('Remove all your past terms and your goal from this device?'))) { V.focus = 'add-term'; a.save({ op: 'clear' }).then(saved); }
    }) : '';
    const said = V.note;
    V.note = '';
    el.replaceChildren(
      make('h3', { textContent: t('Trends') }), ...trends(s, !!now),
      twice ? note(t('{name} is also your current term in Canvas, so it counts twice.', { name: twice.n })) : '',
      make('h3', { textContent: t('Goal') }), ...goal(past, rows, w, !!e.gpaPlus),
      make('h3', { textContent: t('Past terms') }), ...terms,
      make('div', { className: 'gz-gpa-actions' }, addTerm, clear),
      importer(),
      ...(V.review ? [reviewer(past, w)] : []),
      make('p', { className: 'gz-gpa-note', role: 'status', textContent: said }),
      note(t('Past terms and your goal stay on this device. Nothing is uploaded.')),
    );
    if (focus) (el.querySelector(`[data-f="${CSS.escape(focus)}"]`) || (focus === 'hist' ? el.closest('details')?.querySelector('summary') : null))?.focus();
  };

  return { draw };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_GPA_TERMS; else GZ_GPA_TERMS;
