// Working with Ultra's gradebook records (gradebook/grades?expand=column), for the extras: what's
// newly graded and what was handed in late. Pure, so node can test it.
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

  return { mark, fresh, awaiting, late };
})();

if (typeof module !== 'undefined') module.exports = GZ_GRADES;
