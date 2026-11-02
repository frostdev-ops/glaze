// tools/vendor/model-list.js, behind model-manifest.js --keygen and --sign: the owner's tool that builds and signs the
// model list (docs/ai-harness.md "Publishing a model"). The key stays outside the repo at mode 600; a list is signed only
// with the key the extension trusts (unless forced for a test), only above the live serial, only when every entry passes
// the extension's own schema and keeps a shipped size's id; what it writes verifies in ai/local/updates.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../../tools/vendor/model-list.js');
const U = require('../../extension/ai/local/updates.js');
const { entry, bytes } = require('../helpers/model-store-fakes.cjs');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-model-list-'));
const r6 = entry(bytes(3000, 4), { id: 'rime-1.7b-q4_k_m', file: 'Rime-1.7B-Q4_K_M.gguf', commit: 'd'.repeat(40), version: 'r6', tools: 3, minGlaze: '4.0.2' });
const bundled = [{ ...r6, id: 'rime-1.7b-q4_k_m', tier: 1 }, { ...r6, id: 'rime-1.7b-q8_0', tier: 4 }];

test('keygen writes the private key at mode 600 outside the repo, never over another, and gives the public key', () => {
  const d = dir(), f = path.join(d, 'models.key');
  const pub = L.keygen(f);
  assert.match(pub, /^[\w-]{43}$/);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.throws(() => L.keygen(f), /already exists/);
  assert.throws(() => L.keygen(path.join(__dirname, 'nope.key')), /outside the repo/);
});

test('sign builds a list that verifies against its key, and refuses a key the extension doesn\'t trust unless forced', async () => {
  const d = dir(), f = path.join(d, 'models.key');
  const pub = L.keygen(f);
  assert.throws(() => L.sign(f, { entries: [r6], serial: 2, bundled }), /not the key/);
  const doc = L.sign(f, { entries: [r6], serial: 2, bundled, force: true, now: Date.parse('2026-11-01T10:20:30.400Z') });
  assert.equal(doc.list.serial, 2);
  assert.equal(doc.list.issued, '2026-11-01T10:20:30Z');
  assert.deepEqual(await U.verify(doc, { key: pub, serial: 1 }), { ok: true, list: U.clean(doc.list) });
  fs.chmodSync(f, 0o644);
  assert.throws(() => L.sign(f, { entries: [r6], serial: 2, bundled, force: true }), /chmod 600/);
});

test('sign refuses a serial at or below the live one, an entry out of the schema, and a shipped size under a new id', () => {
  const d = dir(), f = path.join(d, 'models.key');
  L.keygen(f);
  const go = (o) => L.sign(f, { entries: [r6], serial: 5, bundled, force: true, ...o });
  assert.throws(() => go({ live: 5 }), /serial 5 must be above the live list's 5/);
  assert.throws(() => go({ entries: [{ ...r6, minGlaze: undefined }] }), /schema/);
  assert.throws(() => go({ entries: [{ ...r6, id: 'rime-2b-q4_k_m' }] }), /keeps its id/);
  assert.ok(go({ live: 4 }));
});

test('the serial defaults to one above the live list', () => {
  assert.equal(L.nextSerial(null), 1);
  assert.equal(L.nextSerial({ list: { serial: 7 } }), 8);
});

test('the shipped models.json says each Rime size\'s version', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '../../extension/ai/local/models.json'), 'utf8'));
  for (const m of doc.models.filter((x) => !x.role && !x.stock)) assert.equal(m.version, 'r8-test-20261102', m.id);
});
