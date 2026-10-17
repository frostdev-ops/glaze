/// <reference path="../../../types/glaze.d.ts" />
// Runs in the widget's own frame: it has no data permissions, so it may have a page of its own.
const root = document.documentElement;
const count = document.getElementById('count');
const today = () => new Date().toDateString();
let day = today(), breaths = 0;

const show = () => { count.textContent = `${breaths} today`; };
const theme = async () => {
  const { tokens, motion } = await glaze.theme();
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--gz-${name}`, value);
  root.dataset.motion = motion;
};

document.getElementById('done').addEventListener('click', () => {
  if (day !== today()) { day = today(); breaths = 0; }
  breaths++;
  show();
  glaze.storage.set('breaths', { day, n: breaths });
});
glaze.on('theme', theme);
glaze.on('visible', (shown) => root.toggleAttribute('data-paused', !shown));
glaze.storage.get('breaths').then((saved) => { day = today(); breaths = saved?.day === day ? saved.n : 0; show(); });
theme();
