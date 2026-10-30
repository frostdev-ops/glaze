/// <reference path="../../../types/glaze.d.ts" />
// The agent tool in mod.json: how many open to-dos are due on each of the next `days` days, by the student's own calendar
// day, busiest first.
const dayOf = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
glaze.tools.handle('workload', async ({ days = 7 } = {}) => {
  const now = Date.now(), end = now + days * 864e5, counts = new Map();
  for (const item of await glaze.todo()) {
    if (item.done || item.submitted || item.due === null || item.due < now || item.due > end) continue;
    counts.set(dayOf(item.due), (counts.get(dayOf(item.due)) || 0) + 1);
  }
  return { days: [...counts].map(([day, due]) => ({ day, due })).sort((a, b) => b.due - a.due || (a.day < b.day ? -1 : 1)) };
});
