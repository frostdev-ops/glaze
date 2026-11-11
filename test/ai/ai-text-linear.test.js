// Writer's AI cleaners and checks stay linear on hostile text (audit K2–K4): ten times the input takes far less than a
// hundred times the time, whatever the machine's speed.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../extension/ai/tasks/writer-context.js');

// The best of three runs of f(n), in ms; at least a tenth of one, so a fast small case can't make the ratio huge.
const time = (f, n) => {
  let best = Infinity;
  for (let i = 0; i < 3; i++) { const at = process.hrtime.bigint(); f(n); best = Math.min(best, Number(process.hrtime.bigint() - at) / 1e6); }
  return Math.max(best, 0.1);
};
const linear = (name, f, n) => {
  f(n); // warm
  const small = time(f, n), big = time(f, n * 10);
  assert.ok(big < small * 30, `${name}: ${n} took ${small.toFixed(1)} ms, ${n * 10} took ${big.toFixed(1)} ms`);
};

test('W.plain is linear on unclosed tags: a run of <, "a < b", an open <br', () => {
  linear('<', (n) => W.plain('<'.repeat(n)), 5000);
  linear('a < b', (n) => W.plain('a < b '.repeat(n)), 2000);
  linear('<br', (n) => W.plain('<br'.repeat(n)), 2000);
  assert.equal(W.plain('a < b <i>c</i> <br>d < e'), 'a c\nd < e', 'a tag runs from a < to the next >, as before');
  assert.equal(W.plain('<p>x</p><'), 'x\n<');
});

const fs = require('node:fs');
const path = require('node:path');
const X = require('../../extension/ai/text.js');
const WD = require('../../extension/ai/tasks/wording.js');
const R = require('../../extension/ai/tasks/writer-review.js');

// A draft of n characters with its words and a quote now and then.
const draft = (n) => { let s = '', i = 0; while (s.length < n) s += `Sentence ${i++} has “some dialogue” and it's plain. `; return s.slice(0, n); };

test('Check with AI anchors its issues without folding the draft again for each one', () => {
  const issues = Array.from({ length: 40 }, (_, i) => ({ quote: `Sentence ${i * 5} has`, before: '', after: '', kind: 'grammar', message: 'Fix this.', suggestions: [] }));
  const check = (n) => R.task.check({ issues }, { text: draft(n), mode: 'compose', kind: 'assignment' });
  assert.equal(check(12000).issues.length, 40);
  // Forty issues cost about one fold of the draft, not forty.
  const one = time((n) => X.anchor(draft(n), 'Sentence 7 has'), 60000), all = time(check, 60000);
  assert.ok(all < one * 8, `one anchor ${one.toFixed(1)} ms, forty ${all.toFixed(1)} ms`);
});

test('anchor over a prepared fold answers as over the text', () => {
  const text = 'He said “go now” and left. He said “go now” again.';
  const f = X.fold(text);
  for (const [q, o] of [['go now', {}], ['go now', { after: 'again' }], ['He said', { before: 'left.' }], ['nope', {}], ['g', { min: 1 }]]) assert.deepEqual(X.anchor(f, q, o), X.anchor(text, q, o), q);
  assert.equal(X.anchor({ text: 'abc', from: [0, 1, 2], to: [1, 2, 3] }, 'abc'), null, 'only a fold anchor made');
});

test('quotedRanges is linear in quote marks, in both copies', () => {
  const dialogue = (n) => { let s = ''; while (s.length < n) s += '"Go," she said. \'No,\' he said; “Why?” ‘Because.’ It’s late. „Gut“ «oui» '; return s.slice(0, n); };
  linear('quotedRanges', (n) => WD.quotedRanges(dialogue(n)), 4000);
  linear('quotedRanges with locales', (n) => WD.quotedRanges(dialogue(n), true), 4000);
  const src = (f) => { const s = fs.readFileSync(path.join(__dirname, '../../extension/ai/tasks', f), 'utf8'), at = s.indexOf('  const quotedRanges = '); return s.slice(at, s.indexOf('\n  };\n', at)); };
  assert.equal(src('writer-feedback.js'), src('wording.js'), 'writer-feedback.js keeps wording.js\'s copy');
});

test('writer.complete\'s check is linear in a reply with no space or punctuation (a provider that ignores maxTokens)', () => {
  const C = require('../../extension/ai/tasks/writer-complete.js');
  for (const before of ['The river keeps what the ', 'The river keeps what the tow']) {
    const inp = C.task.input({ before });
    linear(`letters after ${JSON.stringify(before.slice(-4))}`, (n) => C.finish('a'.repeat(n), inp, { truncated: true }), 2000);
    linear(`CJK after ${JSON.stringify(before.slice(-4))}`, (n) => C.finish('漢'.repeat(n), inp, { truncated: true }), 1000);
  }
  const inp = C.task.input({ before: 'Read more at the ' });
  assert.equal(C.finish('site example.com now.', inp), null, 'a link stays refused');
  assert.equal(C.finish('river-bank.org today.', inp), null);
});
