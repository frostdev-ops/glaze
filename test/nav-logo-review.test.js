const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../lib/cards.js');
const filename = require.resolve('../lib/nav-store.js');
let Store = require(filename);
if (process.env.GZ_B7C_REVIEW_BASE) {
  const Module = require('node:module');
  const old = new Module(filename, module);
  old.filename = filename;
  old.paths = module.paths;
  old._compile(require('node:child_process').execFileSync('git', ['show', `${process.env.GZ_B7C_REVIEW_BASE}:lib/nav-store.js`], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8' }), filename);
  Store = old.exports;
}

const memory = (start = {}) => {
  const values = structuredClone(start);
  return {
    values,
    get: async (keys) => keys === null ? structuredClone(values) : Object.fromEntries(keys.filter((k) => k in values).map((k) => [k, structuredClone(values[k])])),
    set: async (patch) => { Object.assign(values, structuredClone(patch)); return true; },
    remove: async (keys) => { for (const key of keys) delete values[key]; return true; },
  };
};
const image = (length) => 'data:image/png;base64,' + 'A'.repeat(length - 'data:image/png;base64,'.length);
const oldId = 'aaaaaaaaaaaa', oldKey = `navLogo:${oldId}`;
const full = () => ({
  sync: memory({ nav: { brand: 'custom', li: oldId } }),
  local: memory({ [oldKey]: image(K.IMG_MAX), ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`${i % 2 ? 'ultraCardImg' : 'cardImg'}:${String(i).padStart(12, '0')}`, image(K.IMG_MAX)])) }),
});

test('a logo replacement fits the committed-picture cap and retains old bytes until sync commits', async () => {
  const area = full(), originalSet = area.sync.set;
  area.sync.set = async (patch) => {
    assert.equal(area.local.values[oldKey], image(K.IMG_MAX));
    assert.equal(area.local.values[`navLogo:${patch.nav.li}`], image(K.IMG_MAX));
    return originalSet(patch);
  };
  const r = await Store.change({ nav: {}, logoImage: image(K.IMG_MAX) }, area);
  assert.equal(r.ok, true);
  assert.equal(area.sync.values.nav.li, r.id);
  assert.equal(area.local.values[oldKey], undefined);
  assert.equal(Object.keys(area.local.values).length, 10);
});

test('a near-cap replacement rolls back only new bytes when the sync commit fails', async () => {
  const area = full(), before = structuredClone(area.local.values);
  let attempted = false;
  area.sync.set = async (patch) => {
    attempted = true;
    assert.equal(area.local.values[oldKey], before[oldKey]);
    assert.equal(area.local.values[`navLogo:${patch.nav.li}`], image(K.IMG_MAX));
    return false;
  };
  assert.deepEqual(await Store.change({ nav: {}, logoImage: image(K.IMG_MAX) }, area), { ok: false, error: 'write' });
  assert.equal(attempted, true);
  assert.equal(area.sync.values.nav.li, oldId);
  assert.deepEqual(area.local.values, before);
});

test('replacement capacity still counts card namespaces and other logos and keeps the per-image cap', async () => {
  for (const extra of ['cardImg:bbbbbbbbbbbb', 'ultraCardImg:bbbbbbbbbbbb', 'navLogo:bbbbbbbbbbbb']) {
    const area = full();
    area.local.values[extra] = 'x';
    assert.equal((await Store.change({ nav: {}, logoImage: image(K.IMG_MAX) }, area)).error, 'cap', extra);
    assert.equal(area.sync.values.nav.li, oldId);
    assert.equal(area.local.values[oldKey], image(K.IMG_MAX));
  }
  assert.equal((await Store.change({ nav: {}, logoImage: image(K.IMG_MAX + 1) }, { sync: memory(), local: memory() })).error, 'cap');
  assert.equal((await Store.change({ nav: {}, logoImage: 'data:image/svg+xml;base64,AAAA' }, { sync: memory(), local: memory() })).error, 'cap');
});

test('cleanup follows the committed logo reference and protects both card namespaces', async () => {
  const current = 'bbbbbbbbbbbb', data = image(100);
  const area = { sync: memory({ nav: { brand: 'custom', li: current } }), local: memory({ [oldKey]: data, [`navLogo:${current}`]: data, 'cardImg:cccccccccccc': data, 'ultraCardImg:dddddddddddd': data, unrelated: 'keep' }) };
  assert.equal(await Store.cleanup(area), true);
  assert.deepEqual(Object.keys(area.local.values).sort(), [`navLogo:${current}`, 'cardImg:cccccccccccc', 'ultraCardImg:dddddddddddd', 'unrelated'].sort());
  area.sync.values.nav = { brand: 'glaze', li: '' };
  assert.equal(await Store.cleanup(area), true);
  assert.equal(area.local.values[`navLogo:${current}`], undefined);
  area.local.remove = async () => { assert.fail('no orphan means no removal'); };
  assert.equal(await Store.cleanup(area), true);
});

test('cleanup failure preserves committed bytes and can be retried after a reference change', async () => {
  const current = 'bbbbbbbbbbbb', data = image(100);
  const area = { sync: memory({ nav: { li: current } }), local: memory({ [oldKey]: data, [`navLogo:${current}`]: data }) };
  const remove = area.local.remove;
  area.local.remove = async (keys) => { assert.deepEqual(keys, [oldKey]); return false; };
  assert.equal(await Store.cleanup(area), false);
  assert.equal(area.local.values[`navLogo:${current}`], data);
  assert.equal(area.local.values[oldKey], data);
  area.local.remove = remove;
  assert.equal(await Store.cleanup(area), true);
  assert.deepEqual(area.local.values, { [`navLogo:${current}`]: data });
});

test('a failed nav reference write never runs cleanup or removes its old logo', async () => {
  const data = image(100), area = { sync: memory({ nav: { brand: 'custom', li: oldId } }), local: memory({ [oldKey]: data }) };
  area.sync.set = async () => false;
  area.local.remove = async () => { assert.fail('failed nav write must not clean up'); };
  assert.equal((await Store.change({ nav: { brand: 'glaze', li: '' } }, area)).ok, false);
  assert.equal(area.local.values[oldKey], data);
  assert.equal(area.sync.values.nav.li, oldId);
});
