// Canvas's grade arithmetic, worked out from the student's own API data, plus what-if scores and GPA; and Ultra's
// what-if calculator (at the end). Only gradebooks and the GPA need it, so it is loaded on demand. Pure, so node can
// test it against the totals Canvas itself reports (test/gradecalc.test.js). Canvas's rules, as its server applies
// them for current_score/final_score (Instructure's lib/grade_calculator.rb, read for behavior, not copied):
// - An assignment counts unless it is omitted from the final grade, ungraded by type, unpublished, or (where the
//   school has it on) anonymous with grades not posted yet. Excused work never counts.
// - current: graded work only (a quiz waiting for review isn't graded yet); final: ungraded work counts as zero.
// - Drop lowest/highest, never-drop: the set kept is the one that makes the group's share best (or worst), found by
//   bisecting on that share (Kane & Kane, "Dropping Lowest Grades"), not by dropping the lowest percentages.
// - Weighted groups: Σ share × weight over groups with points possible, scaled up when those weights add to < 100.
//   Otherwise Σ points / Σ possible; a zero-possible group adds its points (extra credit).
// - Grading periods: an assignment belongs to the period its (the student's) due date falls in, or the last one
//   when it has none. Weighted periods combine each period's rounded score by weight; unweighted ones don't change
//   the course total. Totals are rounded to two places.
// Classic script (content.js and features/grades.js need() it); module.exports for node.
var GZ_GRADECALC = globalThis.GZ_GRADECALC || (() => {
  const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : 0; };
  // To two places as Canvas stores it (BigDecimal there): 69.125 is 69.13 even when floats make it 69.12499….
  const round2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(Number((x * 100).toPrecision(12))) / 100);
  const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
  const minute = (t) => Math.floor(t / 60000);
  const byId = (a, b) => Number(a.id) - Number(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  // ---- the API's answer, as the calculator reads it -----------------------------------------------------------
  // groups: /courses/:id/assignment_groups?include[]=assignments&include[]=submission. info: { weighted (the
  // course's apply_assignment_group_weights), periods (/courses/:id/grading_periods), weightedPeriods }.
  const periodOf = (due, periods) => {
    if (!periods) return null;
    if (due == null || Number.isNaN(due)) return periods.reduce((a, p) => (!a || p.end > a.end ? p : a), null)?.id ?? null;
    return periods.find((p) => p.start < due && due <= p.end)?.id ?? null;
  };
  const fromApi = (groups, info = {}) => {
    const periods = Array.isArray(info.periods) && info.periods.length
      ? info.periods.map((p) => ({ id: String(p.id), start: minute(Date.parse(p.start_date)), end: minute(Date.parse(p.end_date)), weight: num(p.weight) }))
      : null;
    return {
      weighted: !!info.weighted,
      weightedPeriods: !!(periods && info.weightedPeriods),
      periods,
      last: periodOf(null, periods),
      groups: (Array.isArray(groups) ? groups : []).map((g) => ({
        id: String(g.id),
        name: String(g.name || ''),
        weight: num(g.group_weight),
        rules: { lo: Math.max(0, num(g.rules?.drop_lowest)), hi: Math.max(0, num(g.rules?.drop_highest)), never: (g.rules?.never_drop || []).map(String) },
        items: (g.assignments || []).map((a) => {
          const s = a.submission || {};
          const types = a.submission_types || [];
          return {
            id: String(a.id),
            name: String(a.name || ''),
            possible: num(a.points_possible),
            score: s.score == null || s.score === '' ? null : num(s.score),
            excused: s.excused === true,
            pending: s.workflow_state === 'pending_review',
            counts: !a.omit_from_final_grade && !(types.length === 1 && types[0] === 'not_graded') && a.workflow_state !== 'unpublished' && a.published !== false,
            anon: !!a.anonymize_students,
            period: periodOf(a.due_at ? minute(Date.parse(a.due_at)) : null, periods),
          };
        }),
      })),
    };
  };

  // ---- dropping -------------------------------------------------------------------------------------------------
  // The k of `list` that, together with all of `fixed`, give the highest (best) or lowest share of points. At the
  // best share q, the k largest (smallest) score − q·possible, plus fixed's, sum to zero: bisect for that q.
  const keep = (list, fixed, k, best, maxPossible) => {
    if (list.length <= k) return list;
    const all = [...list, ...fixed];
    const pointed = all.filter((i) => i.possible > 0);
    // Only pointless work left to choose from: by score alone.
    if (!pointed.length) return [...list].sort((a, b) => a.score - b.score || byId(a, b)).slice(-k);
    const shares = pointed.map((i) => i.score / i.possible).sort((a, b) => a - b);
    const unpointed = all.filter((i) => !(i.possible > 0));
    const possible = sum(pointed, (i) => i.possible);
    let lo = shares[0];
    let hi = unpointed.length ? (Math.max(possible, sum(pointed, (i) => i.score)) + sum(unpointed, (i) => i.score)) / possible : shares[shares.length - 1];
    const F = (q) => {
      const rated = list.map((i) => [i.score - q * i.possible, i]).sort(([a, x], [b, y]) => (best ? b - a : a - b) || byId(x, y)).slice(0, k);
      return [sum(rated, ([v]) => v) + sum(fixed, (i) => i.score - q * i.possible), rated.map(([, i]) => i)];
    };
    let mid = (lo + hi) / 2;
    let [x, kept] = F(mid);
    const close = 1 / (2 * k * maxPossible ** 2);
    while (hi - lo >= close) {
      if (x < 0) hi = mid; else lo = mid;
      const next = (lo + hi) / 2;
      if (next === lo || next === hi) break; // floats can't get closer
      mid = next;
      [x, kept] = F(mid);
    }
    return kept;
  };
  // rules: { lo: drop lowest, hi: drop highest, never: ids never dropped }. Returns what is kept.
  const drop = (subs, rules) => {
    let { lo, hi } = rules;
    if (!lo && !hi) return subs;
    const fixed = subs.filter((s) => rules.never.includes(s.id));
    const free = subs.filter((s) => !rules.never.includes(s.id)).sort(byId);
    if (!free.length) return fixed;
    if (lo >= free.length) lo = free.length - 1;
    if (lo + hi >= free.length) hi = 0;
    const most = free.length - lo;
    const least = most - hi;
    if (![...free, ...fixed].some((s) => s.possible > 0)) return [...[...free].sort((a, b) => a.score - b.score || byId(a, b)).slice(-most).slice(0, least), ...fixed];
    const max = Math.max(...[...free, ...fixed].map((s) => s.possible));
    return [...keep(keep(free, fixed, most, true, max), fixed, least, false, max), ...fixed];
  };

  // ---- totals ---------------------------------------------------------------------------------------------------
  // One group's points under current (final = false) or final rules, and what its drop rules left out.
  const groupTotal = (items, rules, final) => {
    let subs = items.filter((i) => !i.excused);
    if (!final) subs = subs.filter((i) => i.score != null && !i.pending);
    subs = subs.map((i) => ({ id: i.id, possible: i.possible, score: i.score ?? 0 }));
    const kept = drop(subs, rules);
    const ids = new Set(kept.map((s) => s.id));
    return { score: sum(kept, (s) => s.score), possible: sum(kept, (s) => s.possible), dropped: subs.filter((s) => !ids.has(s.id)).map((s) => s.id) };
  };
  // A percentage, or null when nothing counts yet.
  const combine = (totals, weighted) => {
    if (weighted) {
      const live = totals.filter((g) => g.possible > 0);
      const weight = sum(live, (g) => g.weight);
      if (!weight) return null;
      const x = sum(live, (g) => (g.score / g.possible) * g.weight);
      return weight < 100 ? (x / weight) * 100 : x;
    }
    const possible = sum(totals, (g) => g.possible);
    return possible > 0 ? (sum(totals, (g) => g.score) / possible) * 100 : null;
  };
  const scoreOf = (course, groups, final) => {
    const totals = groups.map((g) => ({ id: g.id, weight: g.weight, ...groupTotal(g.items, g.rules, final) }));
    return { pct: combine(totals, course.weighted), totals };
  };

  // What-if on top of the course: scores (id → points; overrides a real score, excused or not), hidden (ids left
  // out) and extra (pretend assignments: { id, group, name, possible, score, period? }).
  const apply = (course, what = {}) => {
    const scores = what.scores || {};
    const hidden = new Set(what.hidden || []);
    const extra = what.extra || [];
    return {
      ...course,
      groups: course.groups.map((g) => ({
        ...g,
        items: [
          ...g.items.filter((i) => !hidden.has(i.id)).map((i) => (i.id in scores ? { ...i, score: scores[i.id], excused: false, pending: false } : i)),
          ...extra.filter((e) => e.group === g.id && !hidden.has(e.id)).map((e) => ({ id: e.id, name: e.name, possible: e.possible, score: e.score, excused: false, pending: false, counts: true, anon: false, period: e.period ?? course.last })),
        ],
      })),
    };
  };

  // → { current, final (percentages, unrounded; null when nothing counts), groups: id → { current, final: { score,
  // possible, dropped: [ids] } } }. opts: { period (one grading period's id), anon (leave out anonymous work not
  // yet posted, a school-wide Canvas setting) }.
  const calc = (base, what, opts = {}) => {
    const course = apply(base, what);
    const counted = course.groups.map((g) => ({ ...g, items: g.items.filter((i) => i.counts && !(opts.anon && i.anon)) }));
    const inPeriod = (p) => counted.map((g) => ({ ...g, items: g.items.filter((i) => i.period === p) }));
    const groupsOut = (cur, fin) => Object.fromEntries(cur.totals.map((c, n) => [c.id, {
      current: { score: c.score, possible: c.possible, dropped: c.dropped }, final: { score: fin.totals[n].score, possible: fin.totals[n].possible, dropped: fin.totals[n].dropped } }]));
    if (opts.period || !course.weightedPeriods) {
      const groups = opts.period ? inPeriod(opts.period) : counted;
      const cur = scoreOf(course, groups, false);
      const fin = scoreOf(course, groups, true);
      return { current: cur.pct, final: fin.pct, groups: groupsOut(cur, fin) };
    }
    // Weighted grading periods: each period's score, rounded as Canvas keeps it, then by weight. A period with no
    // graded work leaves current; final counts every period. Scaled up when the weights add to less than 100.
    const each = course.periods.map((p) => {
      const groups = inPeriod(p.id);
      return { weight: p.weight, cur: scoreOf(course, groups, false), fin: scoreOf(course, groups, true) };
    });
    const total = (list, pick) => {
      const weight = sum(list, (e) => e.weight);
      const x = sum(list, (e) => (round2(pick(e)) || 0) * (e.weight / 100));
      return weight ? (weight < 100 ? (x * 100) / weight : x) : 0;
    };
    const live = each.filter((e) => e.cur.pct != null);
    const groups = {};
    for (const e of each) {
      for (const [id, g] of Object.entries(groupsOut(e.cur, e.fin))) {
        const o = (groups[id] ||= { current: { score: 0, possible: 0, dropped: [] }, final: { score: 0, possible: 0, dropped: [] } });
        for (const k of ['current', 'final']) { o[k].score += g[k].score; o[k].possible += g[k].possible; o[k].dropped.push(...g[k].dropped); }
      }
    }
    return { current: live.length ? total(live, (e) => e.cur.pct) : null, final: total(each, (e) => e.fin.pct), groups };
  };

  // Work still to be graded in scope (not excused, hidden or given a what-if score), worth points.
  const remaining = (base, what = {}, opts = {}) => {
    const scores = what.scores || {};
    return apply(base, what).groups.flatMap((g) => g.items).filter((i) => i.counts && !(opts.anon && i.anon) && !i.excused && i.score == null
      && !(i.id in scores) && i.possible > 0 && (!opts.period || i.period === opts.period));
  };
  // The even share f of every remaining item's points that brings the final grade to `target` (%), found by
  // bisection (drops and weights make it no simple formula). { left, best (full marks on the rest), share? or
  // reachable: false }.
  const need = (base, what = {}, target, opts = {}) => {
    const left = remaining(base, what, opts);
    const at = (f) => calc(base, { ...what, scores: { ...what.scores, ...Object.fromEntries(left.map((i) => [i.id, f * i.possible])) } }, opts).final;
    const best = at(1);
    if (!left.length || best == null) return { left: 0, best };
    if (best < target) return { left: left.length, best, reachable: false };
    if (at(0) >= target) return { left: left.length, best, share: 0 };
    let lo = 0;
    let hi = 1;
    for (let n = 0; n < 40; n++) { const mid = (lo + hi) / 2; if (at(mid) >= target) hi = mid; else lo = mid; }
    return { left: left.length, best, share: hi };
  };

  // ---- what-if scores kept on this device ---------------------------------------------------------------------
  // A course's record: { s: { assignment id: [what-if points, the real grade when it was saved] }, h: [hidden
  // ids], p: [pretend: { id, g (group), n (name), s (score), pp (possible) }], c: a what-if course grade (%) for the
  // GPA, at }. The real grade is its points, 'x' if excused, null if not graded. A saved score goes once the real
  // grade differs from the one it was saved against (it arrived, or changed): `gone` says which, to tell the student.
  const real = (i) => (i.excused ? 'x' : i.score);
  const okNum = (v, max = 1e6) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  const reconcile = (rec, course) => {
    const items = new Map(course.groups.flatMap((g) => g.items.map((i) => [i.id, i])));
    const groups = new Set(course.groups.map((g) => g.id));
    const s = {};
    const gone = [];
    for (const [id, e] of Object.entries(rec?.s && typeof rec.s === 'object' ? rec.s : {})) {
      const i = items.get(id);
      if (!i || !Array.isArray(e) || !okNum(e[0]) || !(e[1] === null || e[1] === 'x' || okNum(e[1]))) continue;
      if (real(i) === e[1]) s[id] = [e[0], e[1]];
      else gone.push({ id, name: i.name, was: e[1], now: real(i), score: e[0] });
    }
    const p = (Array.isArray(rec?.p) ? rec.p : []).filter((x) => x && typeof x.id === 'string' && /^p\w{1,19}$/.test(x.id) && groups.has(x.g) && okNum(x.pp) && okNum(x.s))
      .slice(0, 50).map((x) => ({ id: x.id, g: x.g, n: String(x.n || '').slice(0, 100), s: x.s, pp: x.pp }));
    const h = (Array.isArray(rec?.h) ? rec.h : []).filter((id) => items.has(id) || p.some((x) => x.id === id));
    const c = okNum(rec?.c, 1000) ? rec.c : null;
    const kept = { s, h: [...new Set(h)], p, c };
    return { kept, gone, what: whatOf(kept) };
  };
  const whatOf = (rec) => ({
    scores: Object.fromEntries(Object.entries(rec.s).map(([id, [v]]) => [id, v])),
    hidden: rec.h,
    extra: rec.p.map((x) => ({ id: x.id, group: x.g, name: x.n, possible: x.pp, score: x.s })),
  });
  const empty = (rec) => !Object.keys(rec.s).length && !rec.h.length && !rec.p.length && rec.c == null;
  // All of a user's records with this course's in it (or out of it, when empty), newest last, 100 courses at most.
  const store = (all, cid, rec, now = Date.now()) => {
    const { [cid]: _, ...rest } = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    if (!empty(rec)) rest[cid] = { ...rec, at: now };
    return Object.fromEntries(Object.entries(rest).sort(([, a], [, b]) => (a?.at || 0) - (b?.at || 0)).slice(-100));
  };

  // ---- Blackboard Ultra: the what-if calculator -------------------------------------------------------------------
  // Ultra keeps the overall grade's recipe as a formula on the overall column: MathML wrapping
  // BBCalColElem(wgt:{"weights":[{"element":{"type":"cat","alias":"c_1","mode":"proportional"},"weight":25},…],"running":true}),
  // aliases mapping c_1 to a category id. Only what has been seen in the wild is read; anything else
  // (dropped scores, weighted single items, other kinds) is reported rather than guessed. Whatever is
  // read must also reproduce the overall grade Blackboard shows before the calculator is trusted.
  // An item's own column (not the overall grade, not another calculated column), and a graded one.
  const isItem = (g) => !!g.column && g.column.calculationType === 'NON_CALCULATED' && !g.column.externalGrade;
  const isGraded = (g) => g.status === 'GRADED';
  const ELEMENT = ['type', 'alias', 'mode', 'exclude_list'];
  const parse = (column) => {
    const f = column?.calculatedFormula;
    const m = String(f?.formula || '').match(/BBCalColElem\((\w+):(\{[\s\S]*\})\)/);
    if (!m) return { error: "its overall grade uses a formula Glaze can't read" };
    let body;
    try { body = JSON.parse(m[2]); } catch { return { error: "its overall grade uses a formula Glaze can't read" }; }
    if (m[1] !== 'wgt' || !Array.isArray(body.weights) || Object.keys(body).some((k) => !['weights', 'running'].includes(k))) {
      return { error: f.isTotalCalculation ? "its overall grade is a points total Glaze can't read yet" : "its overall grade uses rules Glaze can't read" };
    }
    const cats = [];
    for (const { element: e, weight } of body.weights) {
      const self = (e?.exclude_list || []).every((x) => x?.exclude_alias === e?.alias);
      if (!e || e.type !== 'cat' || !['proportional', 'equal'].includes(e.mode ?? 'proportional') || !self || Object.keys(e).some((k) => !ELEMENT.includes(k)) || typeof weight !== 'number') {
        return { error: "its overall grade uses rules Glaze can't read, like dropped scores or single weighted items" };
      }
      const excluded = (e.exclude_list || []).length > 0;
      if (weight > 0 && !excluded) cats.push({ id: f.aliases?.[e.alias], weight, equal: e.mode === 'equal' });
    }
    if (cats.some((c) => !c.id)) return { error: "its overall grade names a category Glaze can't find" };
    return { cats, running: body.running !== false };
  };

  // results → { kind, note, items, overall (Blackboard's, as a %), percent(overrides), need(target, overrides) }.
  // kind: 'weighted' (the course's weights), 'points' (no overall grade in Blackboard: a plain share of
  // points, labelled as such) or 'unsupported' (with note saying why, and the reason alone as `why`, for
  // translating). overrides: Map columnId → score.
  const model = (results) => {
    const rows = (results || []).filter((g) => g.column);
    const overallRow = rows.find((g) => g.column.externalGrade);
    const items = rows.filter((g) => isItem(g) && g.column.scorable !== false).map((g) => ({
      id: g.columnId,
      name: g.column.effectiveColumnName || g.column.columnName || 'Untitled',
      cat: g.column.gradebookCategoryId,
      possible: Number(g.column.possible) || 0,
      score: isGraded(g) && g.displayGrade?.score != null ? Number(g.displayGrade.score) : null,
      exempt: !!g.isExempt,
    })).filter((i) => !i.exempt);
    let recipe;
    if (overallRow) {
      recipe = parse(overallRow.column);
      if (recipe.error) return { kind: 'unsupported', note: `Glaze can't work out this course's overall grade: ${recipe.error}.`, why: recipe.error, items };
    } else recipe = { cats: [{ id: null, weight: 1 }], running: true };
    const counted = recipe.cats.map((c) => ({ ...c, items: items.filter((i) => c.id === null || i.cat === c.id) }));
    const percent = (overrides = new Map()) => {
      let sum = 0;
      let weights = 0;
      for (const c of counted) {
        const vals = c.items.map((i) => [overrides.get(i.id) ?? i.score ?? (recipe.running ? null : 0), i.possible]).filter(([v]) => v != null);
        const ratio = c.equal
          ? vals.filter(([, p]) => p > 0).reduce((a, [v, p], _, l) => a + v / p / l.length, 0)
          : vals.reduce((a, [v]) => a + v, 0) / vals.reduce((a, [, p]) => a + p, 0);
        if (!vals.length || !Number.isFinite(ratio)) continue;
        sum += c.weight * ratio;
        weights += c.weight;
      }
      return weights ? (sum / weights) * 100 : null;
    };
    const remaining = (overrides) => counted.flatMap((c) => c.items).filter((i) => i.score == null && !overrides.has(i.id) && i.possible > 0);
    // The even share f of every remaining item's points that lands on target; null where none does.
    const need = (target, overrides = new Map()) => {
      const left = remaining(overrides);
      const at = (f) => percent(new Map([...overrides, ...left.map((i) => [i.id, f * i.possible])]));
      const best = at(1);
      if (!left.length || best == null) return { left: 0, best };
      if (best < target) return { left: left.length, best, reachable: false };
      if (at(0) >= target) return { left: left.length, best, share: 0 };
      let lo = 0;
      let hi = 1;
      for (let n = 0; n < 40; n++) { const mid = (lo + hi) / 2; if (at(mid) >= target) hi = mid; else lo = mid; }
      return { left: left.length, best, share: hi };
    };
    const overall = overallRow?.displayGrade?.score != null ? Number(overallRow.displayGrade.score) : null;
    const base = { items: counted.flatMap((c) => c.items), overall, percent, need, remaining };
    if (!overallRow) return { ...base, kind: 'points', note: 'This course has no overall grade in Blackboard. These figures are your share of the points in graded work, which may not be how the course is graded.' };
    // Blackboard's figure is the check: a recipe that doesn't reproduce it isn't trusted.
    const mine = percent();
    if (overall != null && (mine == null || Math.abs(mine - overall) > 0.01)) {
      return { kind: 'unsupported', note: "Glaze can't reproduce this course's overall grade from its recipe, so it won't guess at one.", items: base.items };
    }
    return { ...base, kind: 'weighted', note: '' };
  };

  // ---- Ultra's what-if scores, kept ----------------------------------------------------------------------------
  // Kept in storage.local as whatIf: { cid: { columnId: score } }. A score stays only while its item is
  // in the calculator waiting for a grade: once graded, exempted or gone, it goes.
  const keptScores = (overrides, items) => {
    const open = new Set((items || []).filter((i) => i.score == null && i.possible > 0).map((i) => i.id));
    return new Map([...overrides].filter(([id, v]) => open.has(id) && typeof v === 'number' && Number.isFinite(v) && v >= 0));
  };
  // The stored record with this course's scores in it, last; only the 20 courses touched last are kept.
  const storeScores = (all, cid, overrides) => {
    const { [cid]: _, ...rest } = all && typeof all === 'object' ? all : {};
    if (overrides.size) rest[cid] = Object.fromEntries(overrides);
    return Object.fromEntries(Object.entries(rest).slice(-20));
  };

  // ---- letters and GPA ------------------------------------------------------------------------------------------
  // Canvas's default grading scheme, lower bounds in %; the letter is the highest bound the score reaches (the
  // lowest when it reaches none), from the score rounded as Canvas keeps it.
  const SCHEME = [['A', 94], ['A-', 90], ['B+', 87], ['B', 84], ['B-', 80], ['C+', 77], ['C', 74], ['C-', 70], ['D+', 67], ['D', 64], ['D-', 61], ['F', 0]];
  const letter = (score, scheme = SCHEME) => {
    if (score == null || !scheme?.length) return null;
    const x = round2(score);
    return (scheme.find(([, min]) => x >= min - 1e-9) || scheme[scheme.length - 1])[0];
  };
  // Canvas's own scheme from the course (grading_scheme: [[name, 0.94], …]) in %.
  const schemeOf = (raw) => (Array.isArray(raw) && raw.length ? raw.map(([n, v]) => [String(n), round2(num(v) * 100)]).sort((a, b) => b[1] - a[1]) : null);
  // "A 93, A- 90, B+ 87, …" (or "A=93; B: 83%") → [['A', 93], …], highest first; null if it isn't one.
  const parseScheme = (text) => {
    const out = [];
    for (const part of String(text || '').split(/[,;\n]+/)) {
      if (!part.trim()) continue;
      const m = part.trim().match(/^(\S.{0,11}?)\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*%?$/);
      if (!m || /\d$/.test(m[1])) return null;
      const min = Number(m[2]);
      if (!(min <= 100) || out.some(([n]) => n === m[1])) return null;
      out.push([m[1], min]);
    }
    return out.length && out.length <= 20 ? out.sort((a, b) => b[1] - a[1]) : null;
  };
  const schemeText = (scheme) => scheme.map(([n, v]) => `${n} ${v}`).join(', ');
  // Grade points on a 4.0 scale: with plus/minus, A− is 3.7, B+ 3.3 …; without, any A is 4. A letter outside the
  // usual ones (Pass, Excellent) has none. Weighted adds the course's bonus (honors 0.5, AP/IB 1) to a passing grade.
  const POINTS = { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0, E: 0 };
  const points = (name, plusMinus, bonus = 0) => {
    const L = String(name || '').trim().toUpperCase().replace(/[−–]/g, '-');
    if (!(L in POINTS)) return null;
    const p = plusMinus ? POINTS[L] : POINTS[L[0]];
    return p > 0 ? p + bonus : 0;
  };
  // rows: [{ credits, points }] → { gpa, credits, n } over rows with points and credits; gpa null with none.
  const gpa = (rows) => {
    const live = rows.filter((r) => r.points != null && r.credits > 0);
    const credits = sum(live, (r) => r.credits);
    return { gpa: credits ? sum(live, (r) => r.points * r.credits) / credits : null, credits, n: live.length };
  };

  // The GPA's per-course choices, synced as one small item (gpaCourses), keyed canvas:<origin>/<id>:
  // { c: credits (default 3), l: bonus (0, 0.5, 1), x: 1 to leave the course out, s: its own scale as text }.
  // Sanitized on every read and write, and cut to fit sync's 8 KB per item (100 courses at most).
  const KEY = /^canvas:https?:\/\/[a-z\d.-]+(?::\d+)?\/\d+$/i;
  const CREDITS = 3;
  const cleanGpa = (raw) => {
    const out = {};
    const bytes = () => new TextEncoder().encode(`gpaCourses${JSON.stringify(out)}`).length;
    for (const [id, v] of raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.entries(raw) : []) {
      if (!KEY.test(id) || !v || typeof v !== 'object') continue;
      const e = {};
      if (okNum(v.c, 30) && v.c !== CREDITS) e.c = Math.round(v.c * 100) / 100;
      if ([0.5, 1].includes(v.l)) e.l = v.l;
      if (v.x === 1) e.x = 1;
      const s = typeof v.s === 'string' && v.s.length <= 300 && parseScheme(v.s);
      if (s) e.s = schemeText(s);
      if (!Object.keys(e).length) continue;
      out[id] = e;
      if (Object.keys(out).length > 100 || bytes() > 8000) { delete out[id]; break; }
    }
    return out;
  };

  return { num, round2, real, fromApi, periodOf, drop, calc, remaining, need, reconcile, whatOf, store, SCHEME, letter, schemeOf, parseScheme, schemeText, points, gpa, cleanGpa, CREDITS, parse, model, keptScores, storeScores };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_GRADECALC; else GZ_GRADECALC;
