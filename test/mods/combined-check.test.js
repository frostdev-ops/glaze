const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'scripts/mods-combined-check.js'), 'utf8');

test('quiz exclusion assertions reject a page whose extension runtime never loaded', () => {
  for (const label of ['a quiz page of the same site gets none of it', 'an assessment page of the same site gets none of it']) {
    const line = source.split('\n').find((s) => s.includes(`check('${label}`));
    const none = { scene: false, adopted: 0, css: 0, enter: '', x: '', fx: false, rules: false, nav: false };
    for (const ready of [false, true]) {
      let passed;
      new Function('check', 'live', 'none', 'qn', 'qready', line)((name, ok) => { passed = ok; }, true, none, none, ready);
      assert.equal(passed, ready, label);
    }
  }
});

test('the permissive policy control rejects a page that refuses inline styles', () => {
  const line = source.split('\n').find((s) => s.includes("'control: no policy'"));
  let passed;
  new Function('check', 'sc', 'policy', line)((name, ok) => { passed = ok; }, { preview: false, csp: null }, 'none');
  assert.equal(passed, false);
});

test('an unknown --only scenario cannot succeed by skipping every page', () => {
  const start = source.indexOf('    // ---- the pages ');
  const selection = source.slice(start, source.indexOf('      section = sc.id;', start));
  const pick = new Function('SCENARIOS', 'only', `${selection} return sc; } return null;`);
  const scenarios = [{ id: 'ultra-preview' }, { id: 'canvas-strict' }];
  assert.equal(pick(scenarios, 'canvas-strict'), scenarios[1]);
  assert.throws(() => pick(scenarios, 'typo'), /unknown scenario/i);
});
