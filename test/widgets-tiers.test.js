// Tiles fit their room (features/apps.css): every tile body is a size container, and each widget lays out by its real width and
// dragged height, not by its size name. The browser check (scripts/widgets-sizes-check.js) measures the result at every size; these
// keep the rules it depends on from going missing.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../features/apps.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const W = require('../lib/widgets.js');
// Each rule as [selector, body], and each @container block as [query, its rules].
const rules = (text) => [...text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
const blocks = [...css.matchAll(/@container\s+([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)].map((m) => [m[1].trim(), rules(m[2])]);
const top = rules(css.replace(/@container[^{]+\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, ''));

test('every tile body is a container: by width always, by height once dragged to one; the habitat dialog too', () => {
  assert.ok(top.some(([s, b]) => s === '.gz-w > .gz-w-body' && /container:\s*gz-tile\s*\/\s*inline-size/.test(b)));
  assert.ok(top.some(([s, b]) => s === '.gz-w > .gz-w-body[style*="height"]' && /container-type:\s*size/.test(b)));
  assert.ok(top.some(([s, b]) => s === '.gz-game-dialog > div' && /container:\s*gz-tile/.test(b)));
  assert.ok(blocks.length && blocks.every(([q]) => q.startsWith('gz-tile ')), 'every tier asks the tile');
});

test("the study buddy's centring is its own: the habitat (whose pet is a .gz-w-pet too) fills its tile", () => {
  assert.ok(!top.some(([s]) => s.includes('.gz-w-body:has(.gz-w-pet)')));
  assert.ok(top.some(([s]) => s.includes('.gz-w-body:has(> .gz-w-pet)')));
});

test('the habitat has no fixed height; narrow or short it shows More and hides its sections; very wide it goes two columns', () => {
  for (const [s, b] of top) if (s.includes('.gz-game-habitat') && !s.includes('[data-habitat')) assert.doesNotMatch(b, /(?:^|;)\s*height:\s*\d+px/, s);
  const compact = blocks.filter(([q]) => /width < 300px/.test(q));
  assert.ok(compact.some(([, r]) => r.some(([s, b]) => s.includes('.gz-game-more') && /display:\s*inline-flex/.test(b))), 'More in narrow tiles');
  assert.ok(compact.some(([, r]) => r.some(([s, b]) => s.includes('.gz-game-section') && /display:\s*none/.test(b))), 'sections go to the dialog');
  assert.ok(blocks.some(([q, r]) => /height < 520px/.test(q) && r.some(([s, b]) => s.includes('.gz-game-more') && /inline-flex/.test(b))), 'and in short ones');
  assert.ok(blocks.some(([q, r]) => /width >= 600px/.test(q) && r.some(([, b]) => /grid-template-areas:\s*"stage overview"/.test(b))), 'two columns');
  assert.ok(top.some(([s, b]) => s === '.gz-game-more' && /display:\s*none/.test(b)), 'no More where the sections show');
});

// Each built-in widget takes its size from its tile: container units or a tier of its own.
const OWN = { notes: /\.gz-w-note|\[data-tile="notes"\]/, agenda: /\.gz-w-agenda/, timer: /\.gz-w-clock|\[data-tile="timer"\]/, quotes: /\.gz-w-quote|\[data-tile="quotes"\]/,
  music: /\.gz-w-music|\.gz-w-stage/, breathe: /\.gz-w-breath|\[data-tile="breathe"\]/, buddy: /\[data-tile="buddy"\]/, todo: /\[data-tile="todo"\]/,
  settings: /\[data-tile="settings"\]/, pet: /\.gz-game/ };
test('every built-in widget reflows by its tile, not its size name', () => {
  assert.deepEqual(Object.keys(OWN).sort(), [...W.TILES].sort());
  const sized = (b) => /\d(?:cqi|cqb)\b/.test(b);
  for (const [id, sel] of Object.entries(OWN)) {
    const own = top.filter(([s]) => sel.test(s));
    const ok = own.some(([s, b]) => sized(b) || s.includes('[style*="height"]')) || blocks.some(([, r]) => r.some(([s]) => sel.test(s)));
    assert.ok(ok, `${id} has a rule by its tile's room`);
  }
  assert.ok(top.some(([s, b]) => s.includes('[data-tile^="course:"]') && s.includes('.course-banner') && sized(b)), 'a course card gives up its banner in a short tile');
});
