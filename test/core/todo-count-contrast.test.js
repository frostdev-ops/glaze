// The To Do list's count (#gz-todo .gz-todo-n, core/page/apps.css, shared with Ultra) in the light Look Paper, from the
// palette's own values: WCAG AA text on the surface and the ground the list sits on (audit 2026-11-11 D2: faint ink was 3.15:1).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../extension/core/color.js');
const { GZ_PRESETS } = require('../../extension/content/defaults.js');

const css = fs.readFileSync(path.join(__dirname, '../../extension/core/page/apps.css'), 'utf8');

test('the To Do count reaches 4.5:1 in Paper, on the surface and on the ground', () => {
  const rule = css.match(/^#gz-todo \.gz-todo-n \{([^}]*)\}/m);
  assert.ok(rule, 'the count has a rule of its own');
  const token = rule[1].match(/(?:^|[\s;])color:\s*var\((--gz-[\w-]+)\)/)?.[1];
  assert.ok(token, 'its colour is a palette token');
  const paper = GZ_PRESETS.find(([name]) => name === 'Paper')[1];
  for (const ground of ['--gz-surface', '--gz-surface-2']) {
    const ratio = C.contrast(paper[token], paper[ground]);
    assert.ok(ratio >= 4.5, `${token} ${paper[token]} on ${ground} ${paper[ground]}: ${ratio.toFixed(2)}:1`);
  }
});
