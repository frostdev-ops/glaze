// Working with Ultra's gradebook records (gradebook/grades?expand=column), for the extras: what was
// handed in late. Pure, so node can test it.
// Classic script for the content script; module.exports for node.
const GZ_GRADES = (() => {
  // An item's own column: not the overall grade, not another calculated column.
  const isItem = (g) => !!g.column && g.column.calculationType === 'NON_CALCULATED' && !g.column.externalGrade;

  // ---- submitted late ----------------------------------------------------------------------------
  // Handed in and waiting for a grade, with a due date: the ones whose latest attempt's date matters.
  const awaiting = (results) => (results || []).filter((g) => isItem(g) && g.status === 'NEEDS_GRADING' && g.column.dueDate && g.lastAttemptId);
  const late = (attemptDate, dueDate) => !!attemptDate && !!dueDate && new Date(attemptDate) > new Date(dueDate);

  return { awaiting, late };
})();

if (typeof module !== 'undefined') module.exports = GZ_GRADES;
