/// <reference path="../../../types/glaze.d.ts" />
// A tile that counts down to the next item that is due and not handed in yet.
const draw = async () => {
  const [items, settings] = await Promise.all([glaze.todo(), glaze.settings()]);
  const now = Date.now();
  const next = items.filter((i) => i.due && i.due > now && !i.done && !i.submitted).sort((a, b) => a.due - b.due)[0];
  await glaze.ui.render('tile:next-due', next
    ? {
      type: 'stack',
      children: [
        { type: 'text', text: next.title, weight: 'bold' },
        ...(settings.course && next.course ? [{ type: 'text', text: next.course, size: 's', muted: true }] : []),
        { type: 'countdown', to: Math.round(next.due), label: 'until it is due', done: 'Due now' },
      ],
    }
    : { type: 'text', text: 'Nothing due soon.', muted: true });
};
const show = () => draw().catch(() => {});
glaze.on('todo', show);
glaze.on('settings', show);
show();
