// Canvas extras for grades, loaded on demand (content.js canvasGrades) where one is switched on:
// - The what-if calculator on a course's Grades page (enhance.calc): scores for work not graded yet, changes to real
//   scores, work left out, pretend assignments, and what you'd need for a target. It sits above Canvas's own table and
//   never writes to Canvas: what you change is kept on this device (storage.local, whatIf:<origin>:<user>, by course
//   and assignment) and goes when the real grade arrives, with a word saying so. Canvas's own what-if (click a score)
//   is left as Canvas has it: it resets when the page reloads, and its total is Canvas's sidebar Total, labelled
//   "NOT your official score" by Canvas; Glaze's figures are labelled as its own.
// - The GPA on the Dashboard (enhance.gpa): per term and cumulative over your current courses, 4.0 or plus/minus,
//   weighted for honors and AP, with credits, a scale of your own and a what-if grade per course. Past terms, trends
//   and a goal are features/gpaterms.js (lib/gpa.js), loaded when there are past terms or that view is opened.
// The arithmetic is lib/gradecalc.js (tested against Canvas's own totals). Canvas's helpers come through GZ_CTX.
// On Blackboard Ultra (content-ultra.js renderCalc) the same two, read by lib/ultra.js into the same calculator: the what-if
// under the overall grade on a course's Grades, by the course's own overall-grade recipe where Ultra gives it and Glaze
// reproduces Ultra's figure with it, and otherwise as an estimate from the share of points, said to be one (owner decision
// 3); the GPA on Ultra's Grades page, for this term's courses, with each course's letter cut-offs from its own grading
// schema. Scores typed with Glaze 2.2's simpler Ultra what-if move into the same store (C.oldScores).
var GZ_GRADES_UI = globalThis.GZ_GRADES_UI || (() => {
  const X = globalThis.GZ_CTX;
  const { t, locale, capi, canvasCourses, canvasCourseId } = X;
  const ultra = X.site === 'ultra';
  const S = () => X.settings();
  let C = globalThis.GZ_GRADECALC;
  const calcIn = () => X.need('lib/gradecalc.js', () => globalThis.GZ_GRADECALC).then(() => { C = globalThis.GZ_GRADECALC; });
  const ultraIn = () => X.need('lib/ultra.js', () => globalThis.GZ_ULTRA);
  // Which LMS the words name.
  const lms = (canvas, bb) => (ultra ? bb : canvas);

  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const label = (el, text) => { el.setAttribute('aria-label', text); return el; };
  const getArea = (area, key) => new Promise((res) => { try { chrome.storage[area].get(key, (r) => res(r?.[key])); } catch { res(undefined); } });
  // A read that says whether it worked ({ ok, v }): a failed one (runtime.lastError, no answer) is no empty store.
  const readArea = (area, key) => new Promise((res) => {
    try { chrome.storage[area].get(key, (r) => res(chrome.runtime.lastError || !r || typeof r !== 'object' ? { ok: false } : { ok: true, v: r[key] })); } catch { res({ ok: false }); }
  });
  // Ultra writes a grade cut, not rounded, to two places (82.456 is 82.45%); Canvas rounds it.
  const pct = (x) => GZ_I18N.pct(ultra ? Math.floor(x * 100 + 1e-9) / 100 : C.round2(x), locale());
  const two = (x) => (x == null ? '–' : new Intl.NumberFormat(GZ_I18N.locale(locale()), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x));
  const studentIn = (c) => c?.enrollments?.find((e) => e.type === 'student');
  // Only while Glaze runs in this frame and is switched on: work that finishes after that draws nothing.
  const live = () => X.on() && S().enabled !== false;
  // Saved what-ifs are changed by the service worker, in the one queue every tab shares (lib/background.js
  // 'glaze:whatif'): a change made before a Clear all, in this tab or another, can't bring records back.
  // Answers the worker's reply ({ ok }), or null when it couldn't be asked.
  const send = (m) => { try { return Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:whatif', at: Date.now(), ...m })).catch(() => null); } catch { return Promise.resolve(null); } };
  // A Clear all from any tab empties what this tab shows for that user too.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && D.tkey && changes[D.tkey]) pastIn(changes[D.tkey].newValue);
      const marks = area === 'local' && changes.whatIfCleared?.newValue;
      if (!marks) return;
      const was = changes.whatIfCleared.oldValue || {};
      const cleared = (key) => key && marks[key] !== was[key];
      for (const s of W.values()) {
        if (!s.rec || !cleared(s.key)) continue;
        Object.assign(s, { rec: { s: {}, h: [], p: [], c: null }, gone: [], cut: (s.cut || 0) + 1 });
        s.what = C.whatOf(s.rec);
        s.v++;
      }
      if (cleared(D.wkey)) { D.wi = {}; D.v++; }
      whatIf();
      gpa();
    });
  } catch { /* extension reloaded */ }
  // A course list that didn't come (content.js asks again a minute later) is tried again, three times at most.
  const again = (s) => s.tries < 3 && Date.now() - s.at > 60000;
  const whatIfKey = (me) => `whatIf:${location.origin}:${me.user_id}`;
  // Puts a box in place of the old one (or moves it), keeping focus on the same control (its data-f) when redrawn.
  const put = (old, box, place) => {
    const f = old?.contains(document.activeElement) && document.activeElement.dataset.f;
    if (old && old !== box) old.remove();
    place(box);
    if (f) box.querySelector(`[data-f="${CSS.escape(f)}"]`)?.focus();
  };

  // Every page of a list (Canvas pages by Link headers), from this Canvas only.
  const getAll = async (path) => {
    let url = `${location.origin}/api/v1${path}`;
    const out = [];
    for (let n = 0; url && n < 20; n++) {
      const r = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json+canvas-string-ids' } });
      if (!r.ok) throw new Error(r.status);
      out.push(...JSON.parse((await r.text()).replace(/^while\(1\);/, '')));
      const next = (r.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/)?.[1];
      url = next && new URL(next, location.origin).origin === location.origin ? next : null;
    }
    return out;
  };

  // ---- what-if calculator ------------------------------------------------------------------------------------------
  const W = new Map(); // course id → { status: start|none|idle|loading|ready|failed, v (drawn version), … }
  const GRADES = ultra ? /^\/ultra\/courses\/_\d+_\d+\/grades/ : /^\/courses\/\d+\/grades\/?$/;
  const courseHere = () => (ultra ? X.courseId() : canvasCourseId());

  // The course's row (Canvas's totals, your user id) and what you saved; the course's work is asked for only once
  // you open the calculator, or at once if something is saved (a grade may have arrived since). Ultra: your user id
  // from your course list, and what Glaze 2.2's Ultra what-if kept for the course (whatIf), to move over.
  const begin = async (st) => {
    st.status = 'asking';
    const at = Date.now(); // before anything is read: the old store's scores are moved as of then, never later
    const row = ultra ? { id: st.cid, enrollments: [{ type: 'student', user_id: (await X.myCourses()).find((m) => m?.courseId === st.cid)?.userId }] }
      : (await canvasCourses()).find((c) => String(c.id) === st.cid);
    const me = studentIn(row);
    const none = () => Object.assign(st, { status: 'none', at: Date.now(), tries: (st.tries || 0) + 1 });
    if (!me || (ultra && !/^_\d+_\d+$/.test(me.user_id || ''))) return none();
    Object.assign(st, { row, me, key: whatIfKey(me), status: 'idle' });
    // With the weights the student's syllabus lists, if one was imported (features/syllabus.js): shown, never used.
    const [saved, syl, old] = await Promise.all([readArea('local', st.key), getArea('local', `syllabus:${location.origin}/${me.user_id}/${st.cid}`), ultra ? readArea('local', 'whatIf') : {}]);
    // What you saved couldn't be read: no calculator over it (a change from here would replace it), asked again later.
    if (!saved.ok) return none();
    st.saved = saved.v?.[st.cid];
    st.syl = Array.isArray(syl?.weights) ? syl.weights : [];
    // The old store couldn't be read: nothing moves now; the next page tries again.
    st.old = old.ok ? old.v?.[st.cid] : undefined;
    st.oldAt = at;
    // Ultra's page has the course's gradebook already (bookFor): no request, so its figure is shown at once, closed.
    if (st.saved || st.old || (ultra && X.bookFor(st.cid).results)) load(st); else whatIf();
  };
  // Ultra: the course's gradebook as its own Grades page already has it (content-ultra.js bookFor, asked there anyway),
  // else asked through lib/ultra.js; the titles of its categories only when one in the recipe has no work to name it.
  // → { g: GZ_ULTRA.grade(), book: the page's answer it came from (its key), or null }.
  const reader = () => GZ_ULTRA.read({ origin: location.origin, live: () => live() });
  const pageBook = (cid) => (GRADES.test(location.pathname) && courseHere() === cid ? X.bookFor(cid) : {});
  const ultraGrade = async (st) => {
    await ultraIn();
    const b = pageBook(st.cid);
    const rows = b.results || await reader().grades(st.cid, st.me.user_id);
    const g = GZ_ULTRA.grade(rows);
    st.names = {};
    if (g.kind === 'weighted' && g.course.groups.some((x) => !x.name)) {
      const cats = await reader().all(`/learn/api/v1/courses/${st.cid}/gradebook/categories`).catch(() => []);
      st.names = Object.fromEntries(cats.map((c) => [c?.id, String(c?.title || '').slice(0, 100)]));
    }
    return { g: GZ_ULTRA.grade(rows, [], st.names), book: b.results ? b.key : null };
  };
  // Ultra's page asked for the course's gradebook again (content-ultra.js, at most once a minute) and the answer changed:
  // the course is read anew and what you have now (not what was saved when the page loaded) is checked against it as at
  // load. A grade that arrived or changed takes the what-if typed for it away, with a word, and the record is kept so.
  const rebuild = (st, rows, book) => {
    const g = GZ_ULTRA.grade(rows, [], st.names);
    const r = C.reconcile(st.rec, g.course);
    const changed = JSON.stringify(r.kept) !== JSON.stringify(st.rec);
    Object.assign(st, { g, course: g.course, book, rec: r.kept, what: r.what, gone: [...st.gone, ...r.gone], v: st.v + 1 });
    if (r.gone.length) st.open = true;
    if (changed) keep(st);
  };
  const load = (st) => {
    if (st.status === 'loading' || st.status === 'ready') return st.p;
    st.status = 'loading';
    st.partial = false;
    st.v++;
    whatIf();
    const { cid, row } = st;
    if (ultra) {
      return (st.p = Promise.all([ultraGrade(st), calcIn()]).then(([{ g, book }]) => {
        Object.assign(st, { g, course: g.course, book, scheme: C.SCHEME, period: null, truth: null, anon: false });
        const r = C.reconcile(st.saved, st.course);
        // Glaze 2.2's scores, saved against no grade (C.oldScores): those whose grade has come in are gone, with a word.
        const old = C.oldScores({ [cid]: st.old }, cid);
        const was = C.reconcile({ s: old }, st.course);
        Object.assign(st, { rec: r.kept, what: r.what, gone: [...r.gone, ...was.gone], status: 'ready' });
        if (st.gone.length) st.open = true;
        if (r.gone.length) keep(st);
        if (Object.keys(old).length) migrate(st, old, Object.keys(was.kept.s));
      }, (e) => { st.status = 'failed'; st.partial = e.code === 'incomplete'; }).then(() => { st.v++; whatIf(); }));
    }
    return (st.p = Promise.all([
      getAll(`/courses/${cid}/assignment_groups?include[]=assignments&include[]=submission&exclude_response_fields[]=description&exclude_response_fields[]=rubric&per_page=100`),
      row.has_grading_periods ? capi(`/courses/${cid}/grading_periods`).then((j) => j.grading_periods) : null,
      row.restrict_quantitative_data ? capi(`/courses/${cid}?include[]=grading_scheme`).then((j) => j.grading_scheme) : null,
      calcIn(),
    ]).then(([groups, periods, scheme]) => {
      st.course = C.fromApi(groups, { weighted: row.apply_assignment_group_weights, periods, weightedPeriods: row.has_weighted_grading_periods });
      st.scheme = C.schemeOf(scheme) || C.SCHEME;
      // The page's grading period: the one picked, or Canvas's current one; 0 is all of them.
      const picked = st.whole ? null : new URLSearchParams(location.search).get('grading_period_id') ?? (row.has_grading_periods ? st.me.current_grading_period_id : null);
      st.period = picked && picked !== '0' ? String(picked) : null;
      const me = st.me;
      st.truth = !st.period ? [me.computed_current_score, me.computed_final_score]
        : st.period === String(me.current_grading_period_id) ? [me.current_period_computed_current_score, me.current_period_computed_final_score] : null;
      // Anonymous work not posted yet is left out where the school says so: whichever reproduces Canvas's final.
      const anon = st.course.groups.some((g) => g.items.some((i) => i.anon));
      st.anon = anon && st.truth?.[1] != null && C.round2(C.calc(st.course, {}, { period: st.period, anon: true }).final) === st.truth[1];
      const r = C.reconcile(st.saved, st.course);
      Object.assign(st, { rec: r.kept, what: r.what, gone: r.gone, status: 'ready' });
      if (r.gone.length) { st.open = true; keep(st); }
    }, () => { st.status = 'failed'; }).then(() => { st.v++; whatIf(); }));
  };
  const keep = (st) => {
    st.what = C.whatOf(st.rec);
    // Not while Glaze 2.2's scores are moving in (migrate): a whole record written then would take them out again, so
    // it's written once the move has answered, with them.
    if (st.moving) return st.moving.then(() => keep(st));
    const rec = st.rec;
    return send({ op: 'course', key: st.key, cid: st.cid, rec: { s: rec.s, h: rec.h, p: rec.p } });
  };
  // Glaze 2.2's scores for the course move in the worker, in one step with leaving its old store (whatIf, by course id
  // alone), as of before they were read (st.oldAt) and against the record's last Clear all (lib/gradecalc.js moveLegacy):
  // seen, as read; keep, those still waiting for a grade. Shown here only once the worker says which came in; a failure
  // leaves both stores as they were, for the next page to try again.
  // A reply that comes after a clear shows nothing (the clear took them too); one that comes after the gradebook was read
  // again is checked against it as rebuild does, so a grade that came in meanwhile takes its old score away, with a word.
  const migrate = (st, old, waiting) => {
    const cut = st.cut;
    return (st.moving = send({ op: 'legacy', key: st.key, cid: st.cid, at: st.oldAt, seen: Object.fromEntries(Object.entries(old).map(([id, [v]]) => [id, v])), keep: waiting })
      .then((x) => {
        st.moving = null;
        const add = (x?.ok ? x.moved || [] : []).filter((id) => old[id] && !(id in st.rec.s));
        if (st.cut !== cut || !add.length) return;
        const r = C.reconcile({ s: Object.fromEntries(add.map((id) => [id, old[id]])) }, st.course);
        Object.assign(st.rec.s, r.kept.s);
        st.gone = [...st.gone, ...r.gone];
        if (r.gone.length) { st.open = true; keep(st); } else st.what = C.whatOf(st.rec);
        st.v++;
        whatIf();
      }));
  };

  const whatIf = () => {
    const old = document.getElementById('gz-calc');
    // Canvas: above its table of grades. Ultra: under the overall grade, in the column beside the grades.
    const anchor = live() && S().enhance.calc && GRADES.test(location.pathname) && (ultra ? document.querySelector('aside.student-grade-overview') : document.getElementById('grades_summary'));
    if (!anchor) return old?.remove();
    const cid = courseHere();
    let st = W.get(cid);
    if (!st) { W.set(cid, (st = { cid, status: 'start', v: 0, open: false, target: '' })); begin(st); }
    if (st.status === 'none' && again(st)) begin(st);
    if (['start', 'asking', 'none'].includes(st.status)) return old?.remove();
    if (ultra && st.status === 'ready') {
      const b = pageBook(cid);
      if (b.results && b.key !== st.book) {
        if (b.results.complete === false) Object.assign(st, { status: 'failed', partial: true, v: st.v + 1 });
        else rebuild(st, b.results, b.key);
      }
    }
    const key = `${cid} ${st.v} ${locale()}`;
    if (old?.dataset.key === key && (ultra ? old.previousElementSibling === anchor : old.nextElementSibling === anchor)) return;
    const box = old?.dataset.key === key ? old : drawWhatIf(st);
    box.dataset.key = key;
    put(old, box, (b) => (ultra ? anchor.after(b) : anchor.before(b)));
  };

  const drawWhatIf = (st) => {
    const now = make('b');
    const summary = make('summary', { className: 'gz-calc-head' }, make('span', { textContent: t('What-if calculator') }), now);
    summary.dataset.f = 'summary';
    const box = label(make('details', { id: 'gz-calc', open: st.open }, summary), t('What-if grade calculator'));
    // Opening it asks for the course's work; after a failure, opening it again (or Try again) asks once more.
    box.addEventListener('toggle', () => { st.open = box.open; if (box.open && (st.status === 'idle' || st.status === 'failed')) load(st); });
    if (st.status !== 'ready') {
      box.append(make('p', { className: 'gz-calc-note', textContent: st.partial ? t('Some scores could not be read. The calculator needs the complete gradebook.') : st.status === 'failed' ? t("Glaze couldn't load this course's scores.") : t('Loading your scores…') }));
      if (st.status === 'failed') {
        const retry = make('button', { type: 'button', className: 'gz-calc-btn', textContent: t('Try again') });
        retry.dataset.f = 'retry';
        retry.addEventListener('click', () => { st.focus = 'summary'; load(st); });
        box.append(retry);
      }
      return box;
    }
    const { course, rec } = st;
    const rqd = !!st.row.restrict_quantitative_data;
    const opts = { period: st.period, anon: st.anon };
    // Letters only where the course shows letters only (restricted quantitative data).
    const show = (x) => (x == null ? '–' : rqd ? C.letter(x, st.scheme) : pct(x));
    // An Ultra recipe that counts work not graded yet as zero (not a running total) makes the final figure its grade.
    const pick = (r) => (course.zeros ? r.final : r.current);
    const base = C.calc(course, {}, opts);
    const canvas = ultra ? st.g.overall : st.truth?.[0];
    const est = ultra && st.g.estimate;
    if (ultra) {
      // An exact course's recipe reproduced Blackboard's own figure before it got here (lib/gradecalc.js model).
      if (est) box.append(make('p', { className: 'gz-calc-note', textContent: st.g.why ? `${t("Glaze can't work out this course's overall grade: {why}.", { why: t(st.g.why) })} ${t('These figures are an estimate: your share of the points in graded work.')}` : t('This course has no overall grade in Blackboard. These figures are your share of the points in graded work, which may not be how the course is graded.') }));
    } else if (canvas != null && C.round2(base.current) !== canvas) {
      box.append(make('p', { className: 'gz-calc-note', textContent: t("Canvas shows {canvas}, but your scores add up to {glaze} here: your teacher may have set your grade by hand, or the course has a rule Glaze can't see. The what-if figures may be off by the same.", { canvas: show(canvas), glaze: show(base.current) }) }));
    } else if (!st.truth || st.row.hide_final_grades) {
      box.append(make('p', { className: 'gz-calc-note', textContent: t("Canvas doesn't show a total here. These figures are Glaze's sum of your scores.") }));
    }
    if (est) summary.append(make('span', { className: 'gz-calc-tag', textContent: t('Estimate') }));
    if (st.note) box.append(make('p', { className: 'gz-calc-note', role: 'status', textContent: st.note }));
    if (st.gone.length) {
      box.append(make('ul', { className: 'gz-calc-gone' }, ...st.gone.map((g) => make('li', { textContent: t(g.was === null ? 'Your grade for {name} is in, so your what-if score for it is gone.' : 'Your grade for {name} changed, so your what-if score for it is gone.', { name: g.name }) }))));
    }
    const outNow = make('b');
    const outFinal = make('b');
    const row = (name, dd) => make('div', {}, make('dt', { textContent: name }), dd);
    const totals = make('dl', { className: 'gz-calc-totals' },
      // An estimate is shown beside Blackboard's own figure, where it has one, never in its place.
      ...(est ? [canvas != null && row(t('Blackboard now'), make('dd', { textContent: show(canvas) })), row(t('Estimate now'), make('dd', { textContent: show(pick(base)) }))]
        : [row(t(lms('Canvas now', 'Blackboard now')), make('dd', { textContent: show(canvas ?? pick(base)) }))]).filter(Boolean),
      row(t('With your changes'), make('dd', {}, outNow)),
      ...(course.zeros ? [] : [row(t('With work not graded yet as zero'), make('dd', {}, outFinal))]));
    totals.setAttribute('aria-live', 'polite');
    box.append(totals);
    if (st.syl.length) box.append(make('p', { className: 'gz-calc-note', textContent: t(lms('Your syllabus lists {list}. Glaze counts the weights Canvas has.', 'Your syllabus lists {list}. Glaze counts the weights Blackboard has.'), { list: st.syl.map((w) => `${w.name} ${GZ_I18N.pct(w.weight, locale())}`).join(', ') }) }));

    const updates = [];
    const update = () => {
      const r = C.calc(course, st.what, opts);
      now.textContent = show(pick(r));
      outNow.textContent = show(pick(r));
      outFinal.textContent = show(r.final);
      for (const f of updates) f(r);
    };
    const changed = () => { keep(st); update(); };
    const redraw = () => { keep(st); st.v++; whatIf(); };
    const unit = (i) => rqd && i.possible > 0;
    for (const g of course.groups) {
      const items = g.items.filter((i) => i.counts && i.possible >= 0 && !(st.anon && i.anon) && (!st.period || i.period === st.period));
      const pretend = rec.p.filter((p) => p.g === g.id && (!st.period || (p.pd ?? course.last) === st.period));
      if (!items.length && !pretend.length && !g.weight) continue;
      const gOut = make('b');
      updates.push((r) => {
        const x = r.groups[g.id]?.current;
        gOut.textContent = x?.possible > 0 ? show((x.score / x.possible) * 100) : '–';
      });
      const legend = make('legend', {}, make('span', { textContent: course.weighted ? `${g.name} · ${GZ_I18N.pct(g.weight, locale())}` : g.name }), gOut);
      const list = make('ul');
      const count = (id, name) => {
        const c = label(make('input', { type: 'checkbox', checked: !rec.h.includes(id) }), t('Count {name}', { name }));
        c.dataset.f = `c:${id}`;
        c.addEventListener('change', () => { rec.h = c.checked ? rec.h.filter((x) => x !== id) : [...rec.h, id]; changed(); });
        return c;
      };
      for (const i of items) {
        const saved = rec.s[i.id];
        const real = i.excused ? null : i.score;
        const toPts = (x) => (unit(i) ? (x / 100) * i.possible : x);
        const fromPts = (x) => (unit(i) ? C.round2((x / i.possible) * 100) : x);
        const input = make('input', { type: 'number', min: 0, step: 'any', value: saved ? fromPts(saved[0]) : '',
          placeholder: i.excused ? t('Excused') : real == null ? '–' : unit(i) ? C.letter(fromPts(real), st.scheme) : GZ_I18N.num(real, locale()) });
        label(input, unit(i) ? t('Score for {name}, in percent', { name: i.name }) : t('Score for {name}, out of {n}', { name: i.name, n: i.possible }));
        input.dataset.f = `s:${i.id}`;
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          if (Number.isFinite(v) && v >= 0) rec.s[i.id] = [toPts(v), C.real(i)]; else delete rec.s[i.id];
          changed();
        });
        const tag = make('span', { className: 'gz-calc-tag', textContent: t('Dropped'), hidden: true });
        updates.push((r) => { tag.hidden = !r.groups[g.id]?.current.dropped.includes(i.id); });
        list.append(make('li', {}, count(i.id, i.name), make('span', { className: 'gz-calc-name', textContent: i.name, title: i.name }), tag,
          make('span', { className: 'gz-calc-score' }, input, unit(i) ? ' %' : ` / ${GZ_I18N.num(i.possible, locale())}`)));
      }
      for (const p of pretend) {
        const name = label(make('input', { type: 'text', className: 'gz-calc-pname', value: p.n, maxLength: 100 }), t('Name of the pretend assignment'));
        name.dataset.f = `n:${p.id}`;
        name.addEventListener('change', () => { p.n = name.value.trim().slice(0, 100) || t('Pretend assignment'); redraw(); });
        const num = (key, what) => {
          const el = label(make('input', { type: 'number', min: 0, step: 'any', value: p[key] }), what);
          el.dataset.f = `${key}:${p.id}`;
          el.addEventListener('input', () => { const v = parseFloat(el.value); if (Number.isFinite(v) && v >= 0 && v <= 1e6) { p[key] = v; changed(); } });
          return el;
        };
        const drop = label(make('button', { type: 'button', className: 'gz-calc-x', textContent: '×' }), t('Remove {name}', { name: p.n }));
        drop.addEventListener('click', () => {
          rec.p = rec.p.filter((x) => x !== p);
          rec.h = rec.h.filter((x) => x !== p.id);
          st.focus = `add:${g.id}`;
          redraw();
        });
        list.append(make('li', { className: 'gz-calc-pretend' }, count(p.id, p.n), name, drop,
          make('span', { className: 'gz-calc-score' }, num('s', t('Score for {name}, out of {n}', { name: p.n, n: p.pp })), ' / ', num('pp', t('Points possible for {name}', { name: p.n })))));
      }
      const add = make('button', { type: 'button', className: 'gz-calc-btn', textContent: t('Add a pretend assignment') });
      add.dataset.f = `add:${g.id}`;
      add.addEventListener('click', () => {
        // Scored at the group's share so far, so adding one changes nothing until you say how it went.
        const x = C.calc(course, st.what, opts).groups[g.id]?.current;
        const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        rec.p.push({ id, g: g.id, n: t('Pretend assignment'), pp: 10, s: x?.possible > 0 ? C.round2((x.score / x.possible) * 10) : 10, pd: st.period });
        st.focus = `n:${id}`;
        redraw();
      });
      box.append(make('fieldset', { className: 'gz-calc-group' }, legend, list, add));
    }

    // What you'd need: one even share of every item left, for a percentage (or, letters only, a letter's lowest).
    const target = label(make('input', { type: rqd ? 'text' : 'number', min: 0, step: 'any', value: st.target, placeholder: rqd ? st.scheme[0][0] : '90' }),
      t(rqd ? 'Target overall grade' : 'Target overall grade, in percent'));
    target.dataset.f = 'target';
    const need = make('p', { className: 'gz-calc-out' });
    need.setAttribute('aria-live', 'polite');
    updates.push(() => {
      const raw = st.target.trim();
      const goal = rqd ? st.scheme.find(([n]) => n.toLowerCase() === raw.toLowerCase())?.[1] ?? parseFloat(raw) : parseFloat(raw);
      if (!Number.isFinite(goal)) { need.textContent = ''; return; }
      const r = C.need(course, st.what, goal, opts);
      need.textContent = !r.left ? t('Nothing left to change: {pct}.', { pct: show(C.calc(course, st.what, opts).final) })
        : r.reachable === false ? t('Out of reach: full marks on the {n} items left would make {pct}.', { n: r.left, pct: show(r.best) })
          : r.share === 0 ? t("You'd stay at {pct} or above even with zeros on what's left.", { pct: show(goal) })
            : t("You'd need about {pct} on each of the {n} items left.", { n: r.left, pct: rqd ? C.letter(r.share * 100, st.scheme) : GZ_I18N.pct(Math.ceil(r.share * 1000) / 10, locale()) });
    });
    target.addEventListener('input', () => { st.target = target.value; update(); });
    const [before, after] = t('Aim for {target}% overall').split('{target}');
    box.append(make('label', { className: 'gz-calc-target' }, before, target, rqd ? after.replace(/^\s*%/, '') : after), need);

    const clear = make('button', { type: 'button', className: 'gz-calc-btn', textContent: t('Clear this course') });
    clear.addEventListener('click', () => { Object.assign(st, { rec: { s: {}, h: [], p: [], c: st.rec.c }, cut: (st.cut || 0) + 1 }); st.focus = 'summary'; redraw(); });
    const clearAll = make('button', { type: 'button', className: 'gz-calc-btn', textContent: t('Clear all courses') });
    clearAll.addEventListener('click', () => send({ op: 'clear', key: st.key }).then((r) => {
      st.focus = 'summary';
      st.note = r?.ok ? '' : t('Not cleared. Try again in a moment.');
      // Cleared: every course this page holds for that user is emptied with it.
      if (r?.ok) {
        for (const s of W.values()) {
          if (s.key !== st.key || !s.rec) continue;
          Object.assign(s, { rec: { s: {}, h: [], p: [], c: null }, gone: [], cut: (s.cut || 0) + 1 });
          s.what = C.whatOf(s.rec);
          s.v++;
        }
        if (D.wkey === st.key) D.wi = {};
      }
      st.v++;
      whatIf();
    }));
    box.append(make('div', { className: 'gz-calc-actions' }, clear, clearAll),
      make('p', { className: 'gz-calc-note', textContent: t(lms('Kept on this device only. Canvas never sees these scores.', 'Kept on this device only. Blackboard never sees these scores.')) }));
    update();
    if (st.focus) { const f = st.focus; st.focus = null; queueMicrotask(() => box.querySelector(`[data-f="${CSS.escape(f)}"]`)?.focus()); }
    return box;
  };

  // ---- GPA on the Dashboard ----------------------------------------------------------------------------------------
  // Your current courses as a student, from the course list content.js already has (with each course's term). A
  // course's letter: the scale you gave it, else Canvas's letter where the course has a scheme, else Canvas's
  // default scheme on its current score. Choices per course sync (gpaCourses); what-if grades stay on this device.
  // Ultra: on its Grades page, this term's courses (lib/ultra.js current) in the shape of Canvas's list, each one's grade
  // from its gradebook (ultraRow), read once a page through lib/ultra.js as Canvas's course list is (D.books: course id →
  // rows, null while asked, [] when it couldn't be read); its letter cut-offs are its overall column's grading schema.
  const D = { status: 'start', v: 0, tries: 0, schemes: new Map(), raw: new Map(), books: new Map() };
  const bookOf = (c) => {
    if (!D.books.has(c.id)) {
      D.books.set(c.id, null);
      const got = (rows) => { D.books.set(c.id, rows); D.v++; gpa(); };
      ultraIn().then(() => reader().grades(c.id, c.enrollments[0].user_id)).then(got, () => got([]));
    }
    return D.books.get(c.id);
  };
  const ultraList = async () => {
    await ultraIn();
    const memberships = await X.myCourses();
    if (memberships.complete === false) throw new Error('Incomplete Ultra memberships');
    return GZ_ULTRA.current(memberships, Date.now()).courses.filter((c) => /^_\d+_\d+$/.test(c.m.userId || ''))
      .map((c) => ({ id: c.id, name: c.name, course_code: c.code, term: c.term, enrollments: [{ type: 'student', user_id: c.m.userId }] }));
  };
  // A course's grade as Canvas's enrollment gives it: Blackboard's own overall figure and the letter it writes (or the
  // schema's letter for it), else the share of points, marked est; none until the course's gradebook is in.
  const ultraRow = (c) => {
    const rows = bookOf(c);
    const e = c.enrollments[0];
    if (!rows) return e;
    if (rows.complete === false || D.raw.get(c.id)?.complete === false) return Object.assign(e, { computed_current_score: null, computed_current_grade: null });
    if (rows.some((r) => r?.column?.externalGrade)) schemeFor(c.id); // a scale is its overall column's, so only with one
    const g = GZ_ULTRA.grade(rows, D.raw.get(c.id) || []);
    if (D.raw.get(c.id)) D.schemes.set(c.id, g.scale || false);
    const score = g.overall ?? g.percent();
    return Object.assign(e, { computed_current_score: score, computed_current_grade: g.letter || (score != null && g.scale ? C.letter(score, g.scale) : null), est: score != null && g.overall == null });
  };
  const gpaBegin = async () => {
    D.status = 'loading';
    try {
      await calcIn();
      const list = ultra ? await ultraList() : (await canvasCourses()).filter((c) => studentIn(c));
      if (!list.length) throw new Error('no courses');
      const me = studentIn(list[0]);
      D.wkey = me ? whatIfKey(me) : null;
      D.tkey = me ? `gpaTerms:${location.origin}:${me.user_id}` : null;
      const [prefs, wi, terms] = await Promise.all([getArea('sync', 'gpaCourses'), D.wkey ? getArea('local', D.wkey) : null, D.tkey ? getArea('local', D.tkey) : null]);
      await pastIn(terms);
      Object.assign(D, { list, prefs: C.cleanGpa(prefs), wi: wi && typeof wi === 'object' ? wi : {}, status: 'ready' });
    } catch { Object.assign(D, { status: 'failed', at: Date.now(), tries: D.tries + 1 }); }
    D.v++;
    gpa();
  };
  // A course's own grading scheme, asked for once a page, and only for a what-if grade under a letter Canvas gives:
  // the what-if is read on the same scale as the grade. Until it comes there is no what-if letter for that course.
  // Ultra: its grading schemas, for every course with a grade (ultraRow reads its letter cut-offs from them).
  const schemeFor = (id) => {
    if (ultra) {
      if (D.raw.has(id)) return;
      D.raw.set(id, null);
      const got = (list) => { D.raw.set(id, list); D.v++; gpa(); };
      return void ultraIn().then(() => reader().schemas(id)).then(got, () => got([]));
    }
    if (D.schemes.has(id)) return;
    D.schemes.set(id, null);
    capi(`/courses/${id}?include[]=grading_scheme`).then((j) => {
      // No scheme in the answer counts as none: the note below says so, rather than waiting for ever.
      D.schemes.set(id, C.schemeOf(j?.grading_scheme) || false);
      D.v++;
      gpa();
    }, () => { D.schemes.set(id, false); D.v++; gpa(); });
  };
  // Past terms and the goal (lib/gpa.js), as stored: asked for only when there are some, a Remove all happened, or their
  // view is open. A change from any tab redraws; this tab's own (already shown) doesn't. A read from before the last
  // Remove all this page has seen (one held up while it came) is dropped; `fresh` is a read made to set things right.
  const gpaIn = () => X.need('lib/gpa.js', () => globalThis.GZ_GPA);
  const pastIn = (raw, fresh) => (raw?.t?.length || raw?.g || raw?.cl || D.hist ? gpaIn() : Promise.resolve()).then(() => {
    const rec = globalThis.GZ_GPA ? GZ_GPA.clean(raw) : { t: [] };
    if (!fresh && (rec.cl || 0) < (D.past?.cl || 0)) return;
    if (JSON.stringify(rec) === JSON.stringify(D.past)) return;
    D.past = rec;
    D.refresh?.();
  }, () => {});
  // One change to them (lib/gpa.js change), shown at once and kept by the service worker's queue ('glaze:gpaterms'),
  // with the last Remove all this view knows of. One that isn't kept (refused as made on an older view, or not
  // written) puts back what is stored.
  const savePast = (m) => {
    const at = Date.now();
    const base = D.past?.cl || 0;
    D.past = GZ_GPA.change(D.past, { ...m, at, base }) || D.past;
    D.refresh?.();
    let sent;
    try { sent = Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:gpaterms', key: D.tkey, at, base, ...m })).then((r) => !!r?.ok, () => false); } catch { sent = Promise.resolve(false); }
    return sent.then((ok) => (ok ? ok : getArea('local', D.tkey).then((raw) => pastIn(raw, true)).then(() => false)));
  };
  // What a course's work left needs for `goal` (%), over the whole course and with its saved what-ifs: the calculator's
  // own answer (C.need), or null when the course's work can't be had.
  const needFor = (c, goal) => {
    const cid = String(c.id);
    if (!W.has(cid)) W.set(cid, { cid, status: 'idle', v: 0, open: false, target: '', row: c, me: studentIn(c), key: D.wkey, saved: D.wi[cid], whole: true });
    const st = W.get(cid);
    return Promise.resolve(st.status === 'ready' || st.status === 'none' || load(st))
      .then(() => (st.status === 'ready' ? C.need(st.course, st.what, goal, { period: st.period, anon: st.anon }) : null));
  };

  const rowsOf = () => {
    const e = S().enhance;
    return D.list.map((c) => {
      const me = ultra ? ultraRow(c) : studentIn(c);
      const key = `${ultra ? 'ultra' : 'canvas'}:${location.origin}/${c.id}`;
      const p = D.prefs[key] || {};
      const wi = D.wi[c.id]?.c;
      const r = C.gpaRow(me, p, typeof wi === 'number' && Number.isFinite(wi) ? wi : null, { plus: e.gpaPlus }, D.schemes.get(String(c.id)) || null);
      if (r.needs) schemeFor(String(c.id));
      return {
        ...r, c, key, p, rqd: !!c.restrict_quantitative_data, est: !!me?.est,
        term: c.term?.id != null ? String(c.term.id) : '', termName: c.term?.name || '', termAt: Date.parse(c.term?.start_at) || 0,
      };
    });
  };
  const gpa = () => {
    const e = S().enhance;
    const old = document.getElementById('gz-gpa');
    const shown = (id) => { const el = document.getElementById(id); return el && !/none/.test(el.style.display) ? el : null; };
    const anchor = live() && e.gpa && (ultra ? ULTRA_GPA.test(location.pathname) && ultraSpot()
      : location.pathname === '/' && (shown('DashboardCard_Container') || shown('dashboard-planner') || shown('dashboard-activity')));
    if (!anchor) {
      // The panel going (Glaze or the GPA turned off, another page): a transcript still being read in it stops now.
      if (old) globalThis.GZ_GPA_TERMS?.stop();
      return old?.remove();
    }
    if (D.status === 'start' || (D.status === 'failed' && again(D))) gpaBegin();
    if (location.hash === '#gz-gpa' && !D.hashed) D.hist = D.hashed = D.scroll = true;
    // Ultra: asked for from another page (the command palette), once.
    if (ultra && sessionStorage.getItem('gz-gpa-open')) { sessionStorage.removeItem('gz-gpa-open'); D.hist = D.scroll = true; }
    if (D.status !== 'ready') return;
    const key = `${D.v} ${locale()} ${e.gpaPlus} ${e.gpaWeighted}`;
    const placed = (e.gpaAfter ? anchor.nextElementSibling : anchor.previousElementSibling) === old;
    if (old?.dataset.key === key && placed) return;
    const box = old?.dataset.key === key ? old : drawGpa(e);
    box.dataset.key = key;
    put(old, box, (b) => (e.gpaAfter ? anchor.after(b) : anchor.before(b)));
    if (D.scroll) { D.scroll = false; box.querySelector('.gz-gpa-hist summary')?.focus(); box.scrollIntoView({ block: 'start' }); }
  };
  // The command palette's "GPA: past terms, trends and goal", on the Dashboard (Ultra: its Grades page).
  const open = () => { D.hist = D.scroll = true; D.v++; gpa(); };
  const ULTRA_GPA = /^\/ultra\/grades\/?$/;
  // Ultra's Grades page: the GPA goes above its terms (or, with gpaAfter, below them), outside their carousel, whose
  // slides are the terms side by side (B4 [M]).
  const ultraSpot = () => document.getElementById('container-term-current')?.closest('div.base-grades');

  const drawGpa = (e) => {
    const figs = make('div', { className: 'gz-gpa-figs' });
    figs.setAttribute('aria-live', 'polite');
    const note = make('p', { className: 'gz-gpa-note', role: 'status' });
    const box = make('section', { id: 'gz-gpa' }, make('h2', { id: 'gz-gpa-h', textContent: t('GPA') }), figs);
    box.setAttribute('aria-labelledby', 'gz-gpa-h');
    const fig = (value, name, sub) => make('div', { className: 'gz-gpa-fig' }, make('b', { textContent: two(value) }), make('span', { textContent: name }), sub ? make('small', { textContent: sub }) : '');
    const incomplete = () => ultra && D.list.some((c) => D.books.get(c.id)?.complete === false || D.raw.get(c.id)?.complete === false);
    const cells = [];
    const figures = () => {
      const rows = rowsOf().filter((r) => !r.out);
      const of = (list, k) => C.gpa(list.map((r) => ({ credits: r.credits, points: r[k] })));
      const terms = [...new Set(rows.filter((r) => r.pts != null).map((r) => r.term))]
        .sort((a, b) => (rows.find((r) => r.term === b).termAt - rows.find((r) => r.term === a).termAt));
      const weighted = (list) => (e.gpaWeighted ? t('Weighted {gpa}', { gpa: two(of(list, 'wpts').gpa) }) : '');
      const out = terms.map((term) => { const list = rows.filter((r) => r.term === term); return fig(of(list, 'pts').gpa, list[0].termName || t('Your courses'), weighted(list)); });
      if (terms.length > 1) out.push(fig(of(rows, 'pts').gpa, t('Cumulative'), weighted(rows)));
      // Past terms and these, as one GPA.
      if (D.past?.t.length) {
        const all = (k) => [...D.past.t.flatMap((x) => GZ_GPA.rowsOf(x, k === 'wpts')).map((r) => ({ ...r, [k]: r.points })), ...rows];
        out.push(fig(of(all('pts'), 'pts').gpa, t('Overall, with past terms'), weighted(all('wpts'))));
      }
      if (rows.some((r) => r.whatIf != null)) {
        const wi = rows.map((r) => ({ ...r, ...r.wi }));
        out.push(fig(of(wi, 'pts').gpa, t('With your what-if grades'), weighted(wi)));
      }
      // A what-if under Canvas's letter whose scheme didn't come: say so rather than read it on another scale.
      const unread = rows.filter((r) => r.needs && D.schemes.get(String(r.c.id)) === false);
      figs.replaceChildren(...(incomplete() ? [make('p', { className: 'gz-gpa-note', textContent: t('Some scores could not be read. The calculator needs the complete gradebook.') })] : out.length ? out : [make('p', { className: 'gz-gpa-note', textContent: t('No grade yet') })]),
        ...unread.map((r) => make('p', { className: 'gz-gpa-note', textContent: t('Give {name} a grading scale below to count its what-if grade.', { name: r.c.name || r.c.course_code || '' }) })));
      for (const f of cells) f();
      drawHist();
    };
    D.refresh = () => { if (box.isConnected) figures(); };
    // One course's changed choice goes to the worker ('glaze:gpa'), which applies it to what is stored then: another tab's
    // or syllabus import's change to another course (or another choice) stays.
    const savePrefs = (key, f) => {
      D.prefs = C.cleanGpa(D.prefs);
      try {
        Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:gpa', key, patch: { [f]: D.prefs[key]?.[f] ?? null } })).then((r) => { note.textContent = r?.ok ? '' : r?.error === 'full' ? t('Not saved: too many course settings are stored. Clear a course you no longer need.') : t('Not saved. Try again in a moment.'); }, () => { note.textContent = t('Not saved. Try again in a moment.'); });
      } catch { /* reloaded */ }
      figures();
    };
    const saveWhatIf = (id, c) => {
      D.wi = C.withCourseGrade(D.wi, id, c);
      send({ op: 'grade', key: D.wkey, cid: String(id), c });
      figures();
    };

    // The scale and its options, then a row per course.
    const switches = make('div', { className: 'gz-gpa-switches' }, ...[['gpaPlus', 'Plus/minus grade points'], ['gpaWeighted', 'Weighted grade points'], ['gpaAfter', 'Grade point average below the cards']].map(([k, name]) => {
      const c = make('input', { type: 'checkbox', checked: !!e[k] });
      c.dataset.f = k;
      c.addEventListener('change', () => { try { chrome.storage.sync.set({ version: 2, enhance: { ...S().enhance, [k]: c.checked } }); } catch { /* reloaded */ } });
      return make('label', {}, c, ` ${t(name)}`);
    }));
    const head = make('tr', {}, ...['Course', 'Grade', 'Credits', ...(e.gpaWeighted ? ['Level'] : []), 'What-if %', 'Scale', 'Counts'].map((h) => make('th', { scope: 'col', textContent: t(h) })));
    const body = make('tbody');
    for (const r of rowsOf()) {
      const name = r.c.name || r.c.course_code || '';
      const id = String(r.c.id);
      const grade = make('td', { className: 'gz-gpa-grade' });
      cells.push(() => {
        const now = rowsOf().find((x) => x.key === r.key);
        grade.textContent = now.letter ? [now.letter, now.rqd || now.score == null ? '' : pct(now.score), now.pts != null ? two(e.gpaWeighted ? now.wpts : now.pts) : '', now.est ? t('Estimate') : ''].filter(Boolean).join(' · ') : t('No grade yet');
      });
      const pref = () => (D.prefs[r.key] ||= {});
      const credits = label(make('input', { type: 'number', min: 0, max: 30, step: 0.5, value: r.credits }), t('Credits for {name}', { name }));
      credits.dataset.f = `cr:${id}`;
      credits.addEventListener('change', () => { const v = parseFloat(credits.value); if (Number.isFinite(v) && v >= 0 && v <= 30) { pref().c = v; savePrefs(r.key, 'c'); } });
      const level = label(make('select', {}, ...[[0, 'Regular'], [0.5, 'Honors (+0.5)'], [1, 'AP or IB (+1)']].map(([v, n]) => make('option', { value: v, textContent: t(n), selected: (r.p.l || 0) === v }))), t('Level of {name}', { name }));
      level.dataset.f = `l:${id}`;
      level.addEventListener('change', () => { pref().l = Number(level.value); savePrefs(r.key, 'l'); });
      const whatIf = label(make('input', { type: 'number', min: 0, max: 200, step: 'any', value: r.whatIf ?? '', placeholder: r.score == null || r.rqd ? '–' : String(C.round2(r.score)) }), t('What-if grade for {name}, in percent', { name }));
      whatIf.dataset.f = `w:${id}`;
      whatIf.addEventListener('change', () => { const v = parseFloat(whatIf.value); saveWhatIf(id, Number.isFinite(v) && v >= 0 && v <= 200 ? v : null); });
      const scale = label(make('input', { type: 'text', value: r.p.s || '', placeholder: C.schemeText(C.SCHEME.slice(0, 4)) + ', …', maxLength: 300 }), t('Grading scale for {name}', { name }));
      scale.dataset.f = `s:${id}`;
      scale.addEventListener('change', () => {
        const ok = !scale.value.trim() || C.parseScheme(scale.value);
        scale.setAttribute('aria-invalid', String(!ok));
        if (!ok) { note.textContent = t('Write a scale as letters and their lowest percent: A 93, A- 90, B+ 87.'); return; }
        if (scale.value.trim()) pref().s = C.schemeText(ok); else delete pref().s;
        scale.value = pref().s || '';
        savePrefs(r.key, 's');
      });
      const counts = label(make('input', { type: 'checkbox', checked: !r.out }), t('Count {name} in your GPA', { name }));
      counts.dataset.f = `x:${id}`;
      counts.addEventListener('change', () => { if (counts.checked) delete pref().x; else pref().x = 1; savePrefs(r.key, 'x'); });
      body.append(make('tr', {}, make('th', { scope: 'row' }, make('span', { textContent: name }), r.termName ? make('small', { textContent: r.termName }) : ''),
        grade, make('td', {}, credits), ...(e.gpaWeighted ? [make('td', {}, level)] : []), make('td', {}, whatIf), make('td', {}, scale), make('td', {}, counts)));
    }
    const more = make('details', { className: 'gz-gpa-more' }, make('summary', { textContent: t('Courses, credits and scales') }), switches,
      make('div', { className: 'gz-gpa-scroll' }, make('table', {}, make('thead', {}, head), body)),
      make('p', { className: 'gz-gpa-note', textContent: t(lms('From your current grades in Canvas. Credits and scales sync with your browser; what-if grades stay on this device.', "From your current grades in Blackboard. Where Blackboard doesn't show a course's letter cut-offs, Glaze uses a common scale until you give the course its own. Credits and scales sync with your browser; what-if grades stay on this device.")) }));
    more.addEventListener('toggle', () => { D.more = more.open; });
    more.open = !!D.more;
    // Past terms, trends and the goal (features/gpaterms.js), drawn while open.
    const histBody = make('div', { className: 'gz-gpa-hist-body' });
    const histHead = make('summary', { textContent: t('Past terms, trends and goal') });
    histHead.dataset.f = 'hist';
    const hist = make('details', { className: 'gz-gpa-more gz-gpa-hist' }, histHead, histBody);
    function drawHist() {
      if (!hist.open) return;
      Promise.all([gpaIn(), X.need('features/gpaterms.js', () => globalThis.GZ_GPA_TERMS)]).then(() => {
        D.past ||= GZ_GPA.clean(null);
        if (hist.open && hist.isConnected) {
          if (incomplete()) {
            GZ_GPA_TERMS.stop();
            histBody.textContent = t('Some scores could not be read. The calculator needs the complete gradebook.');
            return;
          }
          GZ_GPA_TERMS.draw(histBody, { rows: () => rowsOf().filter((r) => !r.out), past: () => D.past, save: savePast, needFor, schemeFor, schemes: D.schemes, two, pct });
        }
      }, () => { histBody.textContent = t("Glaze couldn't load this. Try again in a moment."); });
    }
    hist.addEventListener('toggle', () => { D.hist = hist.open; drawHist(); });
    hist.open = !!D.hist;
    box.append(note, more, hist);
    figures();
    return box;
  };

  const render = () => { whatIf(); gpa(); };
  return { render, open };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_GRADES_UI; else GZ_GRADES_UI;
