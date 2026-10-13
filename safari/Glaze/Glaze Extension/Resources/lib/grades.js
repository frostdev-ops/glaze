// Working with Ultra's gradebook records (gradebook/grades?expand=column), for the extras: what's
// newly graded, what was handed in late, and the what-if calculator. Pure, so node can test it.
// Classic script for the content script; module.exports for node.
const GZ_GRADES = (() => {
  // An item's own column: not the overall grade, not another calculated column.
  const isItem = (g) => !!g.column && g.column.calculationType === 'NON_CALCULATED' && !g.column.externalGrade;
  const isGraded = (g) => g.status === 'GRADED';

  // ---- new grades --------------------------------------------------------------------------------
  // What a grade looked like when last seen: a regrade counts as new too.
  const mark = (g) => `${g.displayGrade?.score ?? ''}|${g.displayGrade?.text ?? ''}`;
  // seen: { columnId: mark } from the last time the course's gradebook was shown, or undefined if it
  // never was; then whatever Ultra says the student hasn't viewed counts as new. Returns the new
  // column ids and the record to keep once they've been shown.
  const fresh = (results, seen) => {
    const graded = (results || []).filter((g) => isItem(g) && isGraded(g));
    const ids = graded.filter((g) => (seen ? seen[g.columnId] !== mark(g) : g.hasBeenViewedByStudent === false)).map((g) => g.columnId);
    return { ids: new Set(ids), seen: Object.fromEntries(graded.map((g) => [g.columnId, mark(g)])) };
  };

  // ---- submitted late ----------------------------------------------------------------------------
  // Handed in and waiting for a grade, with a due date: the ones whose latest attempt's date matters.
  const awaiting = (results) => (results || []).filter((g) => isItem(g) && g.status === 'NEEDS_GRADING' && g.column.dueDate && g.lastAttemptId);
  const late = (attemptDate, dueDate) => !!attemptDate && !!dueDate && new Date(attemptDate) > new Date(dueDate);

  // ---- what-if calculator ------------------------------------------------------------------------
  // Ultra keeps the overall grade's recipe as a formula on the overall column: MathML wrapping
  // BBCalColElem(wgt:{"weights":[{"element":{"type":"cat","alias":"c_1","mode":"proportional"},"weight":25},…],"running":true}),
  // aliases mapping c_1 to a category id. Only what has been seen in the wild is read; anything else
  // (dropped scores, weighted single items, other kinds) is reported rather than guessed. Whatever is
  // read must also reproduce the overall grade Blackboard shows before the calculator is trusted.
  const ELEMENT = ['type', 'alias', 'mode', 'exclude_list'];
  const parse = (column) => {
    const f = column?.calculatedFormula;
    const m = String(f?.formula || '').match(/BBCalColElem\((\w+):(\{[\s\S]*\})\)/);
    if (!m) return { error: 'its overall grade uses a formula Glaze can\'t read' };
    let body;
    try { body = JSON.parse(m[2]); } catch { return { error: 'its overall grade uses a formula Glaze can\'t read' }; }
    if (m[1] !== 'wgt' || !Array.isArray(body.weights) || Object.keys(body).some((k) => !['weights', 'running'].includes(k))) {
      return { error: f.isTotalCalculation ? 'its overall grade is a points total Glaze can\'t read yet' : 'its overall grade uses rules Glaze can\'t read' };
    }
    const cats = [];
    for (const { element: e, weight } of body.weights) {
      const self = (e?.exclude_list || []).every((x) => x?.exclude_alias === e?.alias);
      if (!e || e.type !== 'cat' || !['proportional', 'equal'].includes(e.mode ?? 'proportional') || !self || Object.keys(e).some((k) => !ELEMENT.includes(k)) || typeof weight !== 'number') {
        return { error: 'its overall grade uses rules Glaze can\'t read, like dropped scores or single weighted items' };
      }
      const excluded = (e.exclude_list || []).length > 0;
      if (weight > 0 && !excluded) cats.push({ id: f.aliases?.[e.alias], weight, equal: e.mode === 'equal' });
    }
    if (cats.some((c) => !c.id)) return { error: 'its overall grade names a category Glaze can\'t find' };
    return { cats, running: body.running !== false };
  };

  // results → { kind, note, items, overall (Blackboard's, as a %), percent(overrides), need(target, overrides) }.
  // kind: 'weighted' (the course's weights), 'points' (no overall grade in Blackboard: a plain share of
  // points, labelled as such) or 'unsupported' (with note saying why). overrides: Map columnId → score.
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
      if (recipe.error) return { kind: 'unsupported', note: `Glaze can't work out this course's overall grade: ${recipe.error}.`, items };
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

  return { mark, fresh, awaiting, late, parse, model };
})();

if (typeof module !== 'undefined') module.exports = GZ_GRADES;
