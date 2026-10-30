// An import's progress (documents/doc-kinds.js progress and said): what each kind reports as it goes, as the Documents home's
// importing card, the frame's status bar and Save to Documents show it.
const test = require('node:test');
const assert = require('node:assert/strict');
const DK = require('../../extension/documents/doc-kinds.js');

const heard = (stages) => { const got = []; const report = DK.progress((p) => got.push(p), stages); return { got, report }; };

test('stages in order fill the bar by their shares, bytes within a stage', () => {
  const { got, report } = heard();
  report({ stage: 'read', done: 0, total: 1000 });
  report({ stage: 'read', done: 1000, total: 1000 });
  report({ stage: 'prepare' });
  report({ stage: 'copy', done: 0, total: 1000 });
  report({ stage: 'copy', done: 500, total: 1000 });
  report({ stage: 'copy', done: 1000, total: 1000 });
  report({ stage: 'save' });
  report.end();
  const f = got.map((p) => p.fraction);
  const S = DK.STAGES, sum = S.read + S.prepare + S.copy + S.save;
  assert.deepEqual(got.map((p) => p.stage), ['read', 'read', 'prepare', 'copy', 'copy', 'copy', 'save', 'save']);
  assert.equal(f[0], 0);
  assert.equal(f[1], S.read / sum);
  assert.equal(f[4], (S.read + S.prepare + S.copy / 2) / sum);
  assert.equal(f[6], (S.read + S.prepare + S.copy) / sum);
  assert.equal(f.at(-1), 1);
  assert.ok(f.every((x, i) => i === 0 || x >= f[i - 1]), `never back: ${f}`);
  assert.deepEqual({ done: got[4].done, total: got[4].total }, { done: 500, total: 1000 });
  assert.equal(got.at(-1).end, true);
});

test('the copy dominates a PDF import, as measured', () => {
  const S = DK.STAGES;
  assert.ok(S.copy > S.read + S.prepare + S.save);
});

test('a stage only goes forward and its bytes only up; unknown stages and calls after the end are ignored', () => {
  const { got, report } = heard();
  report({ stage: 'copy', done: 600, total: 1000 });
  report({ stage: 'copy', done: 400, total: 1000 });
  report({ stage: 'read', done: 1000, total: 1000 });
  report({ stage: 'teleport' });
  report({ stage: 'copy', done: 5000, total: 1000 });
  assert.deepEqual(got.map((p) => [p.stage, p.done]), [['copy', 600], ['copy', 600], ['copy', 1000]]);
  report.end();
  report({ stage: 'save' });
  report.fail(new Error('late'));
  report.end();
  assert.equal(got.length, 4);
});

test('a kind without a copy stage (a workbook, a Word file) spreads its bar over the stages it has', () => {
  const { got, report } = heard(['read', 'prepare', 'save']);
  report({ stage: 'read', done: 10, total: 10 });
  report({ stage: 'copy', done: 5, total: 10 });
  report({ stage: 'save' });
  const S = DK.STAGES, sum = S.read + S.prepare + S.save;
  assert.deepEqual(got.map((p) => p.stage), ['read', 'save']);
  assert.equal(got[0].fraction, S.read / sum);
  assert.equal(got[1].fraction, (S.read + S.prepare) / sum);
});

test('a failure is heard once, with its error, and the bar stays where it stopped', () => {
  const { got, report } = heard();
  report({ stage: 'copy', done: 250, total: 1000 });
  const e = new RangeError('There isn\'t enough room in this browser for this file.');
  report.fail(e);
  report.fail(new Error('again'));
  report({ stage: 'save' });
  assert.equal(got.length, 2);
  assert.equal(got[1].failed, e);
  assert.equal(got[1].stage, 'copy');
  assert.equal(got[1].fraction, got[0].fraction);
  assert.ok(!got[1].end);
});

test('a listener that throws does not stop the import', () => {
  const report = DK.progress(() => { throw new Error('page gone'); });
  const error = console.error;
  console.error = () => {};
  try { assert.doesNotThrow(() => { report({ stage: 'read' }); report.end(); }); } finally { console.error = error; }
});

test('said: one status word a stage, the bytes while copying, none of them spoken', () => {
  assert.equal(DK.said(null, 'pdf'), null);
  assert.deepEqual(DK.said({ stage: 'read' }, 'pdf'), ['Reading…']);
  assert.deepEqual(DK.said({ stage: 'prepare' }, 'pdf'), ['Preparing pages…']);
  assert.deepEqual(DK.said({ stage: 'prepare' }, 'slides'), ['Preparing slides…']);
  assert.deepEqual(DK.said({ stage: 'prepare' }, 'sheet'), ['Preparing sheets…']);
  assert.deepEqual(DK.said({ stage: 'copy', done: 12_345_678, total: 49_500_000 }, 'pdf'), ['Copying… {done} / {total} MB', { done: 12.3, total: 49.5 }]);
  assert.deepEqual(DK.said({ stage: 'copy', done: 12_345_678, total: 49_500_000 }, 'pdf', { spoken: true }), ['Copying…']);
  assert.deepEqual(DK.said({ stage: 'copy', done: 0, total: 0 }, 'pdf'), ['Copying…']);
  assert.deepEqual(DK.said({ stage: 'copy', done: 300e3, total: 900e3 }, 'pdf'), ['Copying…']);
  assert.deepEqual(DK.said({ stage: 'save' }, 'sheet'), ['Saving…']);
});

test('every word said is in every catalogue', () => {
  const I = require('../../extension/core/i18n.js');
  const words = ['Reading…', 'Preparing pages…', 'Preparing slides…', 'Preparing sheets…', 'Copying…', 'Copying… {done} / {total} MB', 'Saving…', 'Saving… {n}%', 'Retry', 'Remove'];
  for (const code of I.CODES) for (const w of words) assert.ok(typeof globalThis.GZ_LANGS[code][w] === 'string', `${code}: ${w}`);
  assert.equal(I.t('Copying… {done} / {total} MB', { done: 12.3, total: 49.5 }, 'de'), 'Wird kopiert… 12,3 / 49,5 MB');
});
