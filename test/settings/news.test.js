const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../../extension/settings/news.js');
const { version } = require('../../extension/manifest.json');

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
  todo: N.cmp(newest, version) > 0 && `settings/news.js has ${newest} notes but manifest.json says ${version}; they show once it's bumped`,
}, () => assert.ok(N.cmp(newest, version) <= 0));

// What a student sees after an update: check() reads what the last shown version was (storage.local newsSeen), and the options page
// and the popup mark it seen once they have shown the notes (audit 2026-11-11 A8 #6: no note since 3.0.2, so no 4.x update showed any).
const afterUpdate = (to, seen, used = true) => {
  const store = { local: seen === undefined ? {} : { newsSeen: seen }, sync: used ? { version: 2 } : {} };
  const area = (s) => ({ get: (k, cb) => cb(Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))), set: (o) => { Object.assign(s, o); } });
  globalThis.chrome = { runtime: { getManifest: () => ({ version: to }) }, storage: { local: area(store.local), sync: area(store.sync) } };
  const shown = () => { let out; N.check((notes) => { out = notes; }); return out; };
  return { store, shown };
};

test('an update from 4.0.6 to 4.0.7 shows the 4.0.7 note once', () => {
  try {
    const u = afterUpdate('4.0.7', '4.0.6');
    const first = u.shown();
    assert.deepEqual(first.map(([v]) => v), ['4.0.7']);
    assert.ok(first[0][1].length >= 1 && first[0][1].some((l) => /Writer on Canvas/.test(l)), 'it says Writer on Canvas');
    N.seen();
    assert.equal(u.store.local.newsSeen, '4.0.7');
    assert.deepEqual(u.shown(), [], 'not again once seen');
    assert.deepEqual(afterUpdate('4.0.7', '4.0.7').shown(), []);
    assert.deepEqual(afterUpdate('4.0.6', '4.0.6').shown(), [], 'nothing ahead of the version that is installed');
  } finally { delete globalThis.chrome; }
});

test('a student coming from before 4.0 is told about each 4.x release that changed what they see, newest first', () => {
  assert.deepEqual(Object.keys(N.NOTES).filter((v) => N.cmp(v, '4') >= 0).sort((a, b) => N.cmp(b, a)), ['4.0.8', '4.0.7', '4.0.6', '4.0.5', '4.0.3', '4.0.1', '4.0.0']);
  assert.deepEqual(N.unseen('4.0.7', '3.0.1', true).map(([v]) => v), ['4.0.7', '4.0.6', '4.0.5', '4.0.3', '4.0.1', '4.0.0', '3.0.2']);
  assert.deepEqual(N.unseen('4.0.6', '4.0.5', true).map(([v]) => v), ['4.0.6']);
  assert.deepEqual(N.unseen('4.0.2', '4.0.1', true), [], 'a release with no note shows none');
});

test('release: the notes reach the manifest\'s minor version, so an update to 4.1 cannot go out with 3.0.2\'s', () => {
  const minor = (v) => String(v).split('.').slice(0, 2).join('.');
  assert.ok(N.cmp(newest, minor(version)) >= 0, `the newest notes are for ${newest}, the manifest says ${version}: add notes for ${minor(version)}`);
});
