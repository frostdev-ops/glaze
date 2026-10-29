// Settings → Writer → Papers → Versions kept (writer.versions): lib/writer-papers.js caps each paper's versions at the count
// chosen, read from storage.sync `writer` where the worker runs it, keeping the newest and the last submitted.
const test = require('node:test');
const assert = require('node:assert/strict');
const PA = require('../lib/writer-papers.js');
const D = require('../defaults.js');
globalThis.GZ_WRITER_STYLES = require('../lib/writer-styles.js');

const store = () => {
  const data = {};
  return { data, get: async (k) => ({ [k]: data[k] === undefined ? undefined : JSON.parse(JSON.stringify(data[k])) }), set: async (o) => { for (const [k, v] of Object.entries(o)) data[k] = JSON.parse(JSON.stringify(v)); }, remove: async (ks) => { for (const k of ks) delete data[k]; } };
};
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const words = (n) => Array.from({ length: n }, () => 'word').join(' ');
const K = PA.keyOf({ school: 'bb.school.test', user: '_900_1', course: '_101_1', content: '_7_1' });
const fill = async (P, n, clock) => {
  await P.save(K, { doc: doc(words(10)) }, { reason: 'submit' });
  for (let i = 0; i < n; i++) { clock.t += 11 * 60e3; await P.save(K, { doc: doc(words(11 + i)) }); }
  return P.versions(K);
};

test('the count chosen caps each paper, the newest and the submitted kept', async () => {
  for (const n of [10, 25, 50, 100]) {
    const clock = { t: 0 }, P = PA.open(store(), () => clock.t, { versions: () => n });
    const list = await fill(P, n + 15, clock);
    assert.equal(list.length, n, `${n}`);
    assert.ok(list.some((v) => v.reason === 'submit'), `${n}: the submitted version stays`);
    assert.equal(list[0].at, clock.t, `${n}: the newest stays`);
  }
});

test('in the worker, storage.sync writer.versions is the cap; a value it does not take is today\'s 40', async () => {
  const prev = { chrome: globalThis.chrome, S: globalThis.GZ_SANITIZE };
  let writer = { versions: 10 };
  globalThis.chrome = { storage: { sync: { get: async () => ({ writer }) } } };
  globalThis.GZ_SANITIZE = D.GZ_SANITIZE;
  try {
    let clock = { t: 0 };
    assert.equal((await fill(PA.open(store(), () => clock.t), 20, clock)).length, 10);
    writer = { versions: 7 };
    clock = { t: 0 };
    assert.equal((await fill(PA.open(store(), () => clock.t), 50, clock)).length, 40);
  } finally { globalThis.chrome = prev.chrome; globalThis.GZ_SANITIZE = prev.S; }
});

test('restoring a version restores its imported-format choice, including older versions', async () => {
  const P = PA.open(store());
  const first = await P.save(K, { doc: doc('Imported.'), format: 'apa7', keep: true });
  await P.save(K, { doc: doc('Reformatted.'), format: 'mla9', keep: false });
  assert.equal((await P.restore(K, first.version.id)).paper.keep, true);
  const legacy = await P.save('legacy', { doc: doc('Old paper.') });
  await P.save('legacy', { doc: doc('New import.'), keep: true });
  assert.equal((await P.restore('legacy', legacy.version.id)).paper.keep, false, 'old versions used the format');
});

test('the paper applies the restored version format choice before checking its document', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../writer-paper.js'), 'utf8');
  const from = source.indexOf('    const restore = async '), to = source.indexOf('    const docx = ', from);
  let checked;
  const ctx = vm.createContext({ key: K, keep: false, paper: {}, save: async () => true,
    store: { restore: async () => ({ paper: { doc: doc('Imported.'), keep: true, format: 'mla9' } }) },
    ST: { get: (f) => f }, setFormat: async () => {}, setDoc: () => { checked = ctx.keep; }, toast: () => {}, t: (k) => k });
  await vm.runInContext(`${source.slice(from, to)} restore('v')`, ctx);
  assert.equal(checked, true);
});

test('the Versions menu offers every retained version when more than forty are kept', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../writer-paper.js'), 'utf8');
  const from = source.indexOf('    const versions = async'), to = source.indexOf('    const restore = ', from);
  let click, menu;
  const h = (tag, props, ...kids) => ({ tag, props, kids, addEventListener() {} });
  const list = Array.from({ length: 100 }, (_, i) => ({ id: String(i), at: 1000 + i, words: i }));
  const ctx = { versionsB: { addEventListener: (_event, fn) => { click = fn; } }, open: null, key: K, store: { versions: async () => list },
    document: { documentElement: { lang: 'en' } }, Intl, h, btn: (props, ...kids) => h('button', props, ...kids),
    t: (k) => k, nf: String, REASONS: {}, host: { standalone: true }, own: true, compact: false, popup: (_anchor, el) => { menu = el; } };
  vm.runInNewContext(source.slice(from, to), ctx);
  await click();
  assert.equal(menu.kids.filter((n) => n?.props?.class === 'gp-mi').length, 100);
});

test('the status menu offers Open from Documents on an assignment\'s paper, in its frame or papers.html, never on a standalone document; the compact box\'s Versions shows versions alone', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../writer-paper.js'), 'utf8');
  const from = source.indexOf('    const versions = async'), to = source.indexOf('    const restore = ', from);
  const items = async (standalone, own, compact = false) => {
    let click, menu;
    const h = (tag, props, ...kids) => ({ tag, props, kids: kids.flat(), addEventListener() {} });
    vm.runInNewContext(source.slice(from, to), { versionsB: { addEventListener: (_event, fn) => { click = fn; } }, open: null, key: K, store: { versions: async () => [] },
      document: { documentElement: { lang: 'en' } }, Intl, h, btn: (props, ...kids) => h('button', props, ...kids), t: (k) => k, nf: String, REASONS: {}, host: { standalone }, own, compact, popup: (_anchor, el) => { menu = el; } });
    await click();
    return menu.kids.filter((n) => n?.props?.role === 'menuitem').map((n) => n.kids.join(''));
  };
  assert.deepEqual(await items(undefined, false), ['Export .docx', 'Import…', 'Open from Documents', 'Documents']);
  assert.deepEqual(await items(true, false), ['Export .docx', 'Import .docx…', 'Open from Documents']);
  assert.deepEqual(await items(true, true), ['Export .docx', 'Import .docx…']);
  // Its ⋯ has Open from Documents and Documents; the .docx, print and import are the pages'.
  assert.deepEqual(await items(undefined, false, true), []);
});

test('a restore the store refuses, or of a version gone meanwhile, says so and leaves the paper as it was', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../writer-paper.js'), 'utf8');
  const from = source.indexOf('    const restore = async '), to = source.indexOf('    const docx = ', from);
  for (const restoreIt of [async () => { throw new Error('QUOTA_BYTES quota exceeded'); }, async () => null]) {
    const toasts = [], applied = [];
    const ctx = vm.createContext({ key: K, keep: false, paper: {}, save: async () => true, console: { error() {} },
      store: { restore: restoreIt }, ST: { get: (f) => f }, setFormat: async () => {}, setDoc: (d) => applied.push(d), toast: (m) => toasts.push(m), t: (k) => k });
    await vm.runInContext(`${source.slice(from, to)} restore('v')`, ctx);
    assert.deepEqual(applied, []);
    assert.deepEqual(toasts, ['Not saved. Try again in a moment.']);
  }
});
