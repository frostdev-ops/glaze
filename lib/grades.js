// Working with Ultra's gradebook records (gradebook/grades?expand=column), for the extras: what's
// newly graded and what was handed in late; and what's new in a course's content. Pure, so node can test it.
// The what-if calculator, which only a gradebook needs, is in lib/gradecalc.js, loaded on demand.
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

  // ---- new content -------------------------------------------------------------------------------
  // items: a course's visible content (contents?recursive=true); seen: the content ids already looked
  // at, or undefined the first time, when everything counts as seen; looked: the ids on the page now.
  // An Ultra document is a page (isBbPage) whose blocks are its children, never shown on their own, so
  // they're left out. Returns the new ids, the record to keep (the same array while nothing new has
  // been looked at) and, per folder, how many new items are inside it at any depth.
  const newItems = (items, seen, looked = new Set()) => {
    if (!items) return { ids: new Set(), seen, inside: new Map() };
    const pages = new Set(items.filter((c) => c.contentHandler?.isBbPage).map((c) => c.id));
    const own = items.filter((c) => !pages.has(c.parentId));
    if (!seen) return { ids: new Set(), seen: own.map((c) => c.id), inside: new Map() };
    const had = new Set(seen);
    const ids = new Set(own.map((c) => c.id).filter((id) => !had.has(id)));
    const parent = new Map(own.map((c) => [c.id, c.parentId]));
    const inside = new Map();
    for (const id of ids) for (let p = parent.get(id); parent.has(p); p = parent.get(p)) inside.set(p, (inside.get(p) || 0) + 1);
    const add = [...ids].filter((id) => looked.has(id));
    return { ids, seen: add.length ? [...seen, ...add] : seen, inside };
  };

  // Canvas includes module items in one request, except oversized modules. Locked/unpublished content
  // isn't new yet; SubHeaders are labels. Missing item arrays aren't treated as empty courses.
  const canvasItems = (modules) => {
    if (!Array.isArray(modules)) return null;
    const open = modules.filter((m) => m.published !== false && m.state !== 'locked');
    if (open.some((m) => !Array.isArray(m.items))) return null;
    return open.flatMap((m) => m.items.filter((i) => i.type !== 'SubHeader' && i.published !== false).map((i) => ({ id: String(i.id) })));
  };

  // A stale tab can refresh grades without replacing another tab's content cache or visit baseline.
  const canvasNewsRecord = (kept, patch) => ({ ...kept, ...patch, ...(patch.seen ? {
    seen: [...new Set([...(kept?.seen || []), ...patch.seen])],
  } : {}) });

  // ---- submitted late ----------------------------------------------------------------------------
  // Handed in and waiting for a grade, with a due date: the ones whose latest attempt's date matters.
  const awaiting = (results) => (results || []).filter((g) => isItem(g) && g.status === 'NEEDS_GRADING' && g.column.dueDate && g.lastAttemptId);
  const late = (attemptDate, dueDate) => !!attemptDate && !!dueDate && new Date(attemptDate) > new Date(dueDate);

  return { mark, fresh, newItems, canvasItems, canvasNewsRecord, awaiting, late };
})();

if (typeof module !== 'undefined') module.exports = GZ_GRADES;
