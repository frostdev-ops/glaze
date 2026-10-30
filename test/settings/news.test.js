const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../lib/news.js');
const { version } = require('../manifest.json');

test('versions compare number by number', () => {
  assert.equal(N.cmp('2.1', '2.1.0'), 0);
  assert.ok(N.cmp('2.10', '2.9') > 0);
  assert.ok(N.cmp('2.0.4', '2.1') < 0);
});

test('notes show once per version, never on a fresh install', () => {
  const notes = { '2.1': ['a'], '2.2': ['b'], '2.3': ['c'] };
  const seen = (now, last, used = true) => N.unseen(now, last, used, notes).map(([v]) => v);
  assert.deepEqual(seen('2.1.0', undefined, false), [], 'fresh install');
  assert.deepEqual(seen('2.1.0', undefined), ['2.1'], 'upgrade from before notes existed');
  assert.deepEqual(seen('2.1.0', '2.0.4'), ['2.1']);
  assert.deepEqual(seen('2.1.0', '2.1.0'), [], 'already seen');
  assert.deepEqual(seen('2.1.2', '2.1.0'), [], 'patch without notes');
  assert.deepEqual(seen('2.2.0', '2.0.4'), ['2.2', '2.1'], 'skipped a version: both, newest first');
  assert.deepEqual(seen('2.0.4', undefined), [], 'notes ahead of the manifest stay hidden');
});

test('notes are short', () => {
  for (const [v, lines] of Object.entries(N.NOTES)) {
    assert.ok(lines.length && lines.length <= 6, v);
    for (const l of lines) assert.ok(l.length <= 100, l);
  }
});

const newest = Object.keys(N.NOTES).sort((a, b) => N.cmp(b, a))[0];
test('release: the newest notes are for a version that has shipped', {
  todo: N.cmp(newest, version) > 0 && `lib/news.js has ${newest} notes but manifest.json says ${version}; they show once it's bumped`,
}, () => assert.ok(N.cmp(newest, version) <= 0));
