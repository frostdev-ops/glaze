// The word at the caret (the gray text's fits(), in the frame and the task) and autocorrect's fix() read only the end of
// the text: a long unbroken run of letters (a pasted DNA sequence or hash) before a full stop costs about what a short one does.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../extension/writer/frame/writer-ai.js');
const C = require('../../extension/ai/tasks/writer-complete.js');
const P = require('../../extension/writer/writer-proof.js');

const time = (f) => { let best = Infinity; for (let i = 0; i < 3; i++) { const t = process.hrtime.bigint(); f(); best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6); } return best; };
// A 10× longer run may take 10× as long, with room for a busy machine; a scan from every start takes about 100×.
const linear = (name, f) => {
  f(200);
  const short = time(() => f(2000)), long = time(() => f(20000));
  assert.ok(long < 10 * short + 50, `${name}: ${long.toFixed(1)} ms for 20,000 letters, ${short.toFixed(1)} ms for 2,000`);
};

test('the gray text\'s word test and autocorrect stay fast on a 20,000-letter run', () => {
  linear('frame fits', (n) => assert.equal(A.fits(`This is a sentence of words ${'A'.repeat(n)}.`), false));
  linear('task fits', (n) => assert.equal(C.fits(`This is a sentence of words ${'A'.repeat(n)}.`), false));
  linear('fix', (n) => assert.equal(P.fix(`The sequence ${'ACGT'.repeat(n / 4)}.`), null));
  linear('fix before a space', (n) => assert.equal(P.fix(`The sequence ${'ACGT'.repeat(n / 4)}-`), null));
});

test('the word at the caret is the one the pattern found', () => {
  // The pattern both files used before: what it found at the end of the last token.
  const TAIL = /[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*['’-]?$/u;
  const ref = (s) => { const w = / $/.test(s) ? s.slice(0, -1) : s; let at = w.length; while (at && !/\s/u.test(w[at - 1])) at--; return TAIL.exec(w.slice(at))?.[0] ?? null; };
  const input = (before) => C.task.input({ before, after: '', mode: 'compose', kind: 'reply', context: { kind: 'reply' }, past: [] });
  for (const s of ['We read the well-known', 'We read the well-known ', 'They said rock’n’roll', 'A list of students’', 'Ends with x--y', 'Ends with x-\'y', 'A small dash-',
    'Two quotes ab\'\'', 'Then we 𝐀𝐁𝐂', 'All done now.', 'Mixed in 東京タワー', 'one two three', 'one two (three', 'one two thr\u0301ee', 'one two 3-4', 'one two -x']) {
    assert.equal(A.fits(s), ref(s) !== null && C.fits(s), s);
    assert.equal(input(s)?.word ?? null, C.fits(s) ? ref(s) : null, s);
  }
  assert.equal(A.fits('We read the well-known'), true);
  assert.equal(A.fits('We read the well-known.'), false);
  assert.equal(C.fits('A list of students’'), true);
  assert.equal(C.fits('Two quotes ab\'\''), false);
  const t = C.task.input({ before: 'We read the well-known', after: '', mode: 'compose', kind: 'reply', context: { kind: 'reply' }, past: [] });
  assert.equal(t?.word, 'well-known');
  assert.equal(C.task.input({ before: 'This is rock’n’roll ', after: '', mode: 'compose', kind: 'reply', context: { kind: 'reply' }, past: [] })?.word, 'rock’n’roll');
  assert.deepEqual(P.fix('I said teh'), { from: 7, to: 10, was: 'teh', now: 'the', rule: 'typo' });
  assert.deepEqual(P.fix('so the the'), { from: 3, to: 10, was: 'the the', now: 'the', rule: 'twice' });
  assert.equal(P.fix('at www.teh'), null);
});
