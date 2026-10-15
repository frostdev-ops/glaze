// Grades on Canvas worked out from the student's own API data, plus what-if scores and GPA; and Ultra's what-if
// calculator (at the end). Only gradebooks and the GPA need it, so it is loaded on demand. Pure, so node can test it.
//
// Provenance. Written for Glaze (MIT) from public descriptions of how Canvas grades: Instructure's REST API reference
// (Courses, Assignments, Assignment Groups, Grading Periods, Enrollments) and its Canvas guides on assignment-group
// rules, weighted groups and grading periods. Dropped scores follow D. M. Kane and J. M. Kane, "Dropping Lowest
// Grades", Mathematics Magazine 79(3), 2006 (the paper Canvas itself cites): a search for the best share, by halving.
// The numbers are checked against the totals a live Canvas reports for real courses (test/fixtures/canvas-grades.json).
// Canvas's open-source server was read to settle behavior only (where its search starts and stops, which decides
// ties); no code, names or comments were taken from it.
//
// The rules, as Canvas applies them to current_score and final_score:
// - An assignment counts unless it is omitted from the final grade, ungraded by type, unpublished, or (where the
//   school has it on) anonymous with grades not posted yet. Excused work never counts.
// - current: graded work only (a quiz waiting for review isn't graded yet); final: ungraded work counts as zero.
// - Drop lowest/highest, never-drop: what is kept is the set that does most (or least) for the group's share of
//   points, not simply the lowest percentages.
// - Weighted groups: share x weight summed over groups with points possible, scaled up when those weights add to
//   less than 100. Otherwise points over points possible; a zero-possible group adds its points (extra credit).
// - Grading periods: an assignment belongs to the period its (the student's) due date falls in, or the last one
//   when it has none. Weighted periods combine each period's rounded score by weight; unweighted ones don't change
//   the course total. Totals are rounded to two places, halves away from zero.
// Classic script (content.js and features/grades.js need() it); module.exports for node.
var GZ_GRADECALC = globalThis.GZ_GRADECALC || (() => {
  const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : 0; };
  // To two places, a half away from zero, in decimal: 69.125 is 69.13 (and -69.125 is -69.13) even when the float
  // underneath is 69.12499...
  const round2 = (x) => (x == null || !Number.isFinite(x) ? null : (Math.sign(x) * Math.round(Number((Math.abs(x) * 100).toPrecision(12)))) / 100 || 0);
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

  // ---- dropped scores ---------------------------------------------------------------------------------------------
  // Kane & Kane: keeping `size` of a group's scores so the group's share of points is as high as it can be is the same
  // as finding the highest share q that some `size` of them reach together with the scores never dropped, meaning
  // their points minus q times their points possible is at least zero. For a given q the best `size` are just the
  // ones with the largest points minus q times points possible, so q can be found by halving an interval that holds
  // it. Canvas's totals come from such a search, and where sets tie or nearly tie, which one it keeps depends on
  // where the search stops; so this one stops where Canvas's does:
  // - the interval runs from the lowest share of a single score to the highest; when some work is worth no points,
  //   up to the share the whole group would have with full marks (or more, if earned) plus every extra point;
  // - halving stops once the interval is narrower than 1 / (2 x size x (most points possible)^2), or when a float
  //   can't split it any further, and the set kept is the best one at the last share tried.
  // Dropping the highest is the same search the other way up: the `size` that make the share lowest.
  const search = (pool, always, size, up, most) => {
    if (pool.length <= size) return pool;
    const everything = [...pool, ...always];
    const worth = everything.filter((i) => i.possible > 0);
    // What is left is all worth no points (the first pass dropped the rest): Canvas then keeps the highest scores,
    // even when it is dropping the highest.
    if (!worth.length) return [...pool].sort((a, b) => a.score - b.score || byId(a, b)).slice(-size);
    const rate = (i, q) => i.score - q * i.possible;
    const bestAt = (q) => {
      const chosen = [...pool].sort((a, b) => (up ? rate(b, q) - rate(a, q) : rate(a, q) - rate(b, q)) || byId(a, b)).slice(0, size);
      return { chosen, margin: sum(chosen, (i) => rate(i, q)) + sum(always, (i) => rate(i, q)) };
    };
    const shares = worth.map((i) => i.score / i.possible).sort((a, b) => a - b);
    const extra = everything.filter((i) => !(i.possible > 0));
    const out = sum(worth, (i) => i.possible);
    let from = shares[0];
    let to = extra.length ? (Math.max(out, sum(worth, (i) => i.score)) + sum(extra, (i) => i.score)) / out : shares[shares.length - 1];
    const width = 1 / (2 * size * most * most);
    let q = (from + to) / 2;
    let best = bestAt(q);
    for (let n = 0; n < 2000 && to - from >= width; n++) {
      if (best.margin < 0) to = q; else from = q;
      const half = (from + to) / 2;
      if (half === from || half === to) break;
      q = half;
      best = bestAt(q);
    }
    return best.chosen;
  };
  // rules: { lo: how many lowest to drop, hi: how many highest, never: ids never dropped }. At least one droppable
  // score stays: the lowest go first, then the highest of the rest, if any are left to go. Returns what is kept.
  const drop = (subs, rules) => {
    if (!rules.lo && !rules.hi) return subs;
    const always = subs.filter((s) => rules.never.includes(s.id));
    const pool = subs.filter((s) => !rules.never.includes(s.id)).sort(byId);
    if (!pool.length) return always;
    const afterLow = Math.max(1, pool.length - rules.lo);
    const afterHigh = afterLow - rules.hi >= 1 ? afterLow - rules.hi : afterLow;
    // Nothing in the group is worth points: the scores themselves go, the lowest and then the highest.
    if (![...pool, ...always].some((i) => i.possible > 0)) {
      const high = [...pool].sort((a, b) => b.score - a.score || byId(a, b)).slice(0, afterLow);
      return [...high.sort((a, b) => a.score - b.score || byId(a, b)).slice(0, afterHigh), ...always];
    }
    const most = Math.max(...[...pool, ...always].map((i) => i.possible));
    return [...search(search(pool, always, afterLow, true, most), always, afterHigh, false, most), ...always];
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
  // out) and extra (pretend assignments: { id, group, name, possible, score, period }; in the last grading period
  // when they name none the course has).
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
          ...extra.filter((e) => e.group === g.id && !hidden.has(e.id)).map((e) => ({ id: e.id, name: e.name, possible: e.possible, score: e.score, excused: false, pending: false, counts: true, anon: false, period: course.periods?.some((p) => p.id === e.period) ? e.period : course.last })),
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
  // ids], p: [pretend: { id, g (group), n (name), s (score), pp (possible), pd (grading period) }], c: a what-if
  // course grade (%) for the GPA, at }. The real grade is its points (negative too: Canvas allows that), 'x' if
  // excused, null if not graded. A saved score goes once the real grade differs from the one it was saved against
  // (it arrived, or changed): `gone` says which, to tell the student. What you type is never negative.
  const real = (i) => (i.excused ? 'x' : i.score);
  const okNum = (v, max = 1e6) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  const okReal = (v) => v === null || v === 'x' || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6);
  const reconcile = (rec, course) => {
    const items = new Map(course.groups.flatMap((g) => g.items.map((i) => [i.id, i])));
    const groups = new Set(course.groups.map((g) => g.id));
    const s = {};
    const gone = [];
    for (const [id, e] of Object.entries(rec?.s && typeof rec.s === 'object' ? rec.s : {})) {
      const i = items.get(id);
      if (!i || !Array.isArray(e) || !okNum(e[0]) || !okReal(e[1])) continue;
      if (real(i) === e[1]) s[id] = [e[0], e[1]];
      else gone.push({ id, name: i.name, was: e[1], now: real(i), score: e[0] });
    }
    const p = (Array.isArray(rec?.p) ? rec.p : []).filter((x) => x && typeof x.id === 'string' && /^p\w{1,19}$/.test(x.id) && groups.has(x.g) && okNum(x.pp) && okNum(x.s))
      .slice(0, 50).map((x) => ({ id: x.id, g: x.g, n: String(x.n || '').slice(0, 100), s: x.s, pp: x.pp, pd: course.periods?.some((p) => p.id === x.pd) ? x.pd : null }));
    const h = (Array.isArray(rec?.h) ? rec.h : []).filter((id) => items.has(id) || p.some((x) => x.id === id));
    const c = okNum(rec?.c, 1000) ? rec.c : null;
    const kept = { s, h: [...new Set(h)], p, c };
    return { kept, gone, what: whatOf(kept) };
  };
  const whatOf = (rec) => ({
    scores: Object.fromEntries(Object.entries(rec.s).map(([id, [v]]) => [id, v])),
    hidden: rec.h,
    extra: rec.p.map((x) => ({ id: x.id, group: x.g, name: x.n, possible: x.pp, score: x.s, period: x.pd })),
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

  // A course's what-if grade for the GPA, set (a number) or cleared (null), in all of a user's records, keeping the
  // rest of that course's record. The Dashboard has no assignments to check it against.
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const withCourseGrade = (all, cid, c, now = Date.now()) => applyWhatIf({ op: 'grade', cid, c, at: now }, all, 0).all;
  // A course's record as a tab sends it, made safe to store: well-formed entries only, within the same limits.
  const ID = /^\w{1,20}$/;
  const cleanRecord = (rec) => {
    const r = obj(rec);
    return {
      s: Object.fromEntries(Object.entries(obj(r.s)).filter(([id, e]) => ID.test(id) && Array.isArray(e) && okNum(e[0]) && okReal(e[1])).slice(0, 500).map(([id, e]) => [id, [e[0], e[1]]])),
      h: (Array.isArray(r.h) ? r.h : []).filter((id) => typeof id === 'string' && ID.test(id)).slice(0, 500),
      p: (Array.isArray(r.p) ? r.p : []).filter((x) => x && typeof x.id === 'string' && /^p\w{1,19}$/.test(x.id) && typeof x.g === 'string' && ID.test(x.g) && okNum(x.pp) && okNum(x.s))
        .slice(0, 50).map((x) => ({ id: x.id, g: x.g, n: String(x.n || '').slice(0, 100), s: x.s, pp: x.pp, pd: typeof x.pd === 'string' && ID.test(x.pd) ? x.pd : null })),
      c: okNum(r.c, 1000) ? r.c : null,
    };
  };
  // Stored records keep, for each of their parts, when it was last changed: a score [points, real grade, time], a
  // left-out id (ht: id -> time), a pretend assignment (t) and the course grade (ct). A part stored before these
  // times were kept takes its record's. `fresh` gives a record's parts changed after `since`, each with its time, or
  // null when none are left.
  const num0 = (t, d) => (Number.isFinite(t) ? t : d);
  const fresh = (raw, since, now = Date.now()) => {
    const r = obj(raw);
    // Stored data is checked like a tab's (cleanRecord), and a time from the future counts as now, so a damaged
    // record can't keep over-limit parts or outlive every clear.
    const t = (v, d) => Math.min(num0(v, d), now);
    const d = t(r.at, 0);
    const k = cleanRecord(r);
    const s = Object.fromEntries(Object.entries(k.s).map(([id, e]) => [id, [e[0], e[1], t(obj(r.s)[id]?.[2], d)]]).filter(([, e]) => e[2] > since));
    const h = k.h.filter((id) => t(obj(r.ht)[id], d) > since);
    const ht = Object.fromEntries(h.map((id) => [id, t(obj(r.ht)[id], d)]));
    const p = k.p.map((x) => ({ ...x, t: t((Array.isArray(r.p) ? r.p : []).find((y) => y?.id === x.id)?.t, d) })).filter((x) => x.t > since);
    const ct = t(r.ct, d);
    const c = k.c != null && ct > since ? k.c : null;
    const rec = { s, h, ht, p, c, ...(c == null ? {} : { ct }) };
    return empty(rec) ? null : rec;
  };
  // A Grades page's assignment what-ifs (cleaned) over what is stored: unchanged parts keep their times, new or
  // changed ones take `at`; the course grade stays as stored.
  const stamped = (rec, old, at) => {
    const was = (x) => (old.p || []).find((y) => y.id === x.id);
    const same = (x, y) => !!y && ['g', 'n', 's', 'pp', 'pd'].every((k) => x[k] === y[k]);
    return {
      s: Object.fromEntries(Object.entries(rec.s).map(([id, e]) => { const o = old.s?.[id]; return [id, [e[0], e[1], o && o[0] === e[0] && o[1] === e[1] ? o[2] : at]]; })),
      h: rec.h,
      ht: Object.fromEntries(rec.h.map((id) => [id, old.ht?.[id] ?? at])),
      p: rec.p.map((x) => ({ ...x, t: same(x, was(x)) ? was(x).t : at })),
      c: old.c ?? null,
      ...(old.c == null ? {} : { ct: old.ct }),
    };
  };
  // A what-if change from any tab, applied by the service worker, in its one queue, to what is stored at that moment
  // (lib/background.js 'glaze:whatif'). m: { op, cid, at: when the student made it }, where op is
  // - 'course': the assignment what-ifs of a course (rec: scores, work left out, pretend assignments), from its
  //   Grades page; its what-if course grade stays as stored;
  // - 'grade': that course grade alone (c), from the Dashboard's GPA; the assignment what-ifs stay as stored;
  // - 'clear': everything, for this user on this site.
  // Each op changes only the parts it carries, never writes back the rest from a tab's older copy. `cleared` is when
  // the what-ifs were last cleared: a change made before that is dropped however late it arrives, and a clear takes
  // every part changed before it was asked for, part by part (a score typed before it goes even when the course grade
  // was changed after it), including any its own removal didn't finish. → { all: the item's new value ({} to remove
  // it), cleared }.
  const applyWhatIf = (m, stored, cleared = 0) => {
    const since = m.op === 'clear' ? Math.max(cleared, m.at) : cleared;
    const all = {};
    for (const [cid, r] of Object.entries(obj(stored))) { const k = fresh(r, since); if (k) all[cid] = { ...k, at: num0(obj(r).at, 0) }; }
    if (m.op === 'clear' || !(m.at > cleared)) return { all, cleared: since };
    const cid = String(m.cid);
    const old = all[cid] || { s: {}, h: [], ht: {}, p: [], c: null };
    if (m.op === 'course') return { all: store(all, cid, stamped(cleanRecord(m.rec), old, m.at), m.at), cleared };
    if (m.op === 'grade') {
      const c = okNum(m.c, 1000) ? m.c : null;
      const { ct: _, ...rest } = old;
      return { all: store(all, cid, { ...rest, c, ...(c == null ? {} : { ct: m.at }) }, m.at), cleared };
    }
    return { all, cleared };
  };

  // ---- letters and GPA ------------------------------------------------------------------------------------------
  // Canvas's default grading scheme, lower bounds in %; the letter is the highest bound the score reaches (the
  // lowest when it reaches none), from the score rounded as Canvas keeps it.
  const SCHEME = [['A', 94], ['A-', 90], ['B+', 87], ['B', 84], ['B-', 80], ['C+', 77], ['C', 74], ['C-', 70], ['D+', 67], ['D', 64], ['D-', 61], ['F', 0]];
  // Whether a score earns a letter whose lowest bound is `min`: rounded as Canvas keeps it (89.995 reaches 90).
  const reaches = (score, min) => round2(score) >= min - 1e-9;
  // The lowest raw percent that reaches it (89.995 for 90): what a "what you'd need" search aims at for a letter.
  const reachFrom = (min) => min - 0.005;
  const letter = (score, scheme = SCHEME) => {
    if (score == null || !scheme?.length) return null;
    return (scheme.find(([, min]) => reaches(score, min)) || scheme[scheme.length - 1])[0];
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
  // A course on the GPA: its letter, and with a what-if grade (%), and the points for each. One scale converts any
  // percentage: the student's own for the course, else the course's own scheme, else Canvas's default. The letter now
  // is Canvas's own where it reports one (the course's scheme, a teacher's override included). `needs`: a what-if is
  // set under Canvas's letter but the course's scheme isn't known yet; until it is, there is no what-if letter.
  // e: the student's enrollment from the course list; pref: its gpaCourses entry; opts: { plus } (plus/minus points).
  const gpaRow = (e, pref = {}, whatIf = null, opts = {}, courseScheme = null) => {
    const own = pref.s ? parseScheme(pref.s) : null;
    const scale = own || courseScheme || SCHEME;
    const score = e?.computed_current_score ?? null;
    const canvas = e?.computed_current_grade || e?.computed_current_letter_grade || null;
    const now = own ? letter(score, own) : canvas || letter(score, scale);
    const needs = whatIf != null && !own && !courseScheme && !!canvas;
    const at = (name) => ({ pts: points(name, opts.plus), wpts: points(name, opts.plus, pref.l || 0) });
    const wiLetter = whatIf == null || needs ? null : letter(whatIf, scale);
    return { score, letter: now, credits: pref.c ?? CREDITS, out: pref.x === 1, whatIf, needs, wiLetter, ...at(now), wi: wiLetter ? at(wiLetter) : at(now) };
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
  // One course's choices changed on what is stored (the worker's 'glaze:gpa', the one writer of gpaCourses):
  // patch { c, l, x, s }, each optional, null (or its default) taking it away. → { prefs, ok, error }: 'bad' for a value
  // cleanGpa refuses, 'full' when there's no room left for it in the synced item without dropping another course's
  // choices; prefs is then what is stored.
  const patchGpa = (raw, key, patch) => {
    const prefs = cleanGpa(raw);
    const F = ['c', 'l', 'x', 's'];
    if (!KEY.test(key) || !patch || typeof patch !== 'object') return { prefs, ok: false, error: 'bad' };
    const e = { ...prefs[key] };
    for (const f of F) if (f in patch) { if (patch[f] == null) delete e[f]; else e[f] = patch[f]; }
    const alone = cleanGpa({ [key]: e })[key] || {};
    const dflt = { c: CREDITS, l: 0, x: 0 };
    if (F.some((f) => patch[f] != null && patch[f] !== dflt[f] && !(f in alone))) return { prefs, ok: false, error: 'bad' };
    const next = cleanGpa({ ...prefs, [key]: alone });
    // Refused whole when it doesn't fit: cleanGpa would otherwise keep it by dropping another course's choices.
    if (F.some((f) => JSON.stringify(next[key]?.[f]) !== JSON.stringify(alone[f])) || Object.keys(prefs).some((k) => k !== key && !(k in next))) return { prefs, ok: false, error: 'full' };
    return { prefs: next, ok: true };
  };

  return { num, round2, real, fromApi, periodOf, drop, calc, remaining, need, reconcile, whatOf, store, withCourseGrade, cleanRecord, applyWhatIf, SCHEME, reaches, reachFrom, letter, schemeOf, parseScheme, schemeText, points, gpaRow, gpa, cleanGpa, patchGpa, CREDITS, parse, model, keptScores, storeScores };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_GRADECALC; else GZ_GRADECALC;
