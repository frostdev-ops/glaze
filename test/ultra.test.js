// lib/ultra.js: Blackboard Ultra's answers in the shapes Glaze's features use, on the synthetic fixtures
// (test/fixtures/ultra-*.json, shapes from parity/spikes/B0.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../lib/ultra.js');
const Z = require('../lib/zip.js');

const load = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `ultra-${n}.json`), 'utf8'));
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const o = 'https://lms.example.edu';
// Ultra applies a `fields` list to each item's top-level keys.
const project = (items, fields) => items.map((i) => Object.fromEntries(fields.split(',').filter((k) => k in i).map((k) => [k, i[k]])));
const LTI = /synthetic-lti-(secret|key)/;

// ---- the LTI credential fields (parity/spikes/B0.md, Safety notes) ---------------------------------------------------
test('private content is asked for without contentDetail, by both callers', () => {
  for (const f of [U.PEEK_FIELDS, U.FILES_FIELDS]) assert.doesNotMatch(f, /contentDetail|\//);
  assert.match(src('features/previews.js'), /\/children\?fields=\$\{GZ_ULTRA\.PEEK_FIELDS\}/);
  assert.match(src('features/download.js'), /\/children\?limit=200&fields=\$\{GZ_ULTRA\.FILES_FIELDS\}/);
  // Neither caller reads contentDetail, nor does anything else Glaze ships.
  for (const f of ['content.js', 'features/previews.js', 'features/download.js', 'lib/page.js', 'lib/ultra.js', 'lib/grades.js']) {
    assert.doesNotMatch(src(f).replace(/^\s*\/\/.*$/gm, ''), /contentDetail/, f);
  }
});

test("a folder preview keeps only an item's id, title, state and due date, never an LTI link's secret or key", () => {
  const raw = load('children').results;
  assert.ok(raw.some((i) => LTI.test(JSON.stringify(i))), 'the fixture carries them, as Ultra sends them unasked');
  for (const items of [raw, project(raw, U.PEEK_FIELDS)]) {
    const kept = items.map(U.peekItem);
    assert.doesNotMatch(JSON.stringify(kept), LTI);
    for (const k of kept) assert.deepEqual(Object.keys(k), ['id', 'title', 'state', 'genericReadOnlyData']);
    assert.deepEqual(kept.find((k) => k.id === '_703_1'), { id: '_703_1', title: 'Lab Report 3', state: 'None', genericReadOnlyData: { dueDate: '2026-10-19T03:59:00.000Z' } });
    assert.equal(kept.find((k) => k.id === '_731_1').genericReadOnlyData.dueDate, undefined);
  }
});

test('Download all finds the same files from what the fields list leaves, and keeps nothing else', async () => {
  const raw = {
    _730_1: load('children').results,
    _731_1: [{ id: '_741_1', title: 'Week 2 reading', contentHandler: 'resource/x-bb-file', state: 'Started', contentDetail: {} }],
    _732_1: [{ id: '_742_1', title: 'Block', contentHandler: 'resource/x-bb-document', state: 'None',
      body: { rawText: `<a data-bbfile="{&quot;fileName&quot;:&quot;notes.pdf&quot;}" href="${o}/bbcswebdav/xid-10_1">notes</a>` } }],
  };
  const pub = { _731_1: false, _732_1: true, _733_1: false, _741_1: false };
  const att = { _733_1: [{ id: '_51_1', fileName: 'handout.pdf' }], _741_1: [{ id: '_52_1', fileName: 'reading.pdf' }] };
  const run = async (fields) => {
    const asked = [];
    const r = await U.files({
      root: '_730_1', origin: o, safeName: Z.safeName,
      list: async (id) => (fields ? project(raw[id] || [], fields) : raw[id] || []),
      isPage: async (c) => pub[c.id] ?? false,
      attachments: async (id) => { asked.push(id); return U.attachments(o, '_101_1', id, att[id]); },
    });
    return { ...r, asked };
  };
  const want = {
    found: [
      { url: `${o}/learn/api/public/v1/courses/_101_1/contents/_741_1/attachments/_52_1/download`, name: 'reading.pdf', size: undefined, dir: 'Week 2/' },
      { url: `${o}/bbcswebdav/xid-10_1`, name: 'notes.pdf', size: undefined, dir: '' },
      { url: `${o}/learn/api/public/v1/courses/_101_1/contents/_733_1/attachments/_51_1/download`, name: 'handout.pdf', size: undefined, dir: '' },
      { url: `${o}/bbcswebdav/pid-1-dt-content-rid-9_1/xid-9_1`, name: 'slides.pdf', size: 2048, dir: '' },
    ],
    // The unopened File item (_734_1) is counted and left out, its attachments never asked for.
    skipped: 1, failed: 0, asked: ['_741_1', '_733_1'],
  };
  assert.deepEqual(await run(U.FILES_FIELDS), want);
  // Fed everything Ultra could send, contentDetail and the LTI link's secret and key included, nothing of it is kept.
  const all = await run(null);
  assert.deepEqual(all, want);
  assert.doesNotMatch(JSON.stringify(all), LTI);
});

test('a File item whose attachments cannot be read counts as failed; attachment addresses stay on the site', async () => {
  const r = await U.files({ root: '_1_1', origin: o, safeName: Z.safeName, isPage: async () => false,
    list: async () => [{ id: '_2_1', title: 'f', contentHandler: 'resource/x-bb-file', state: 'Completed' }], attachments: async () => null });
  assert.deepEqual(r, { found: [], skipped: 0, failed: 1 });
  assert.deepEqual(U.attachments(o, '_1_1', '_2_1', [{ id: '../x', fileName: 'a' }, { id: '_3_1' }, null]),
    [{ url: `${o}/learn/api/public/v1/courses/_1_1/contents/_2_1/attachments/_3_1/download`, name: 'file' }]);
  for (const [cid, id] of [['x', '_2_1'], ['_1_1', '../_2_1']]) assert.deepEqual(U.attachments(o, cid, id, [{ id: '_3_1' }]), []);
});
