// lib/pdf-doc.js on pdf.js in node, against the fixtures of scripts/pdf-fixtures.js: each fixture is first read back to
// show it is what it claims, then every operation is round-tripped and the result read back with pdf.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const F = require('../scripts/pdf-fixtures.js');

const root = path.join(__dirname, '..');
let loaded = null;
const load = () => loaded ||= (async () => {
  const url = (f) => pathToFileURL(path.join(root, 'lib/pdfjs', f)).href;
  const [log, warn] = [console.log, console.warn];
  console.log = console.warn = () => {}; // pdf.js warns at import that node has no canvas
  try {
    const pdfjs = await import(url('pdf.mjs'));
    pdfjs.GlobalWorkerOptions.workerSrc = url('pdf.worker.mjs');
    await import(url('pdf.worker.mjs'));
    return pdfjs;
  } finally { [console.log, console.warn] = [log, warn]; }
})();

const opened = async (bytes, password) => (await load()).getDocument({ data: bytes.slice(), password, verbosity: 0 }).promise;
// A document as pdf.js reads it: each page's text and turn, and every field's value.
const read = async (bytes, password) => {
  const doc = await opened(bytes, password);
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      pages.push(`${(await page.getTextContent()).items.map((item) => item.str).join('')} ${page.rotate}`);
    }
    const fields = await doc.getFieldObjects();
    const { info } = await doc.getMetadata();
    const permissions = await doc.getPermissions();
    return { pages, info, permissions: permissions && [...permissions].sort((a, b) => a - b), signatures: (await doc.getSignatures())?.length ?? 0,
      fields: fields && Object.fromEntries([...fields].filter(([, [f]]) => f.type !== '').map(([name, [f]]) => [name, f.value])) };
  } finally { await doc.loadingTask.destroy(); }
};
const ALL = (pdfjs) => Object.values(pdfjs.PermissionFlag).sort((a, b) => a - b);

// ---- the fixtures ------------------------------------------------------------------------------------------------------
test('each fixture is what it claims, read back by pdf.js', async () => {
  const pdfjs = await load();
  const three = ['Alpha page one 0', 'Bravo page two 0', 'Charlie page three 0'];
  assert.deepEqual((await read(F.FIXTURES.three())).pages, three);
  assert.deepEqual((await read(F.FIXTURES.rotated())).pages, ['Alpha page one 90', 'Bravo page two 270', 'Charlie page three 180', 'Delta page four 90'],
    "the root's turn, a page's own, an inner node's, the root's");
  const form = await read(F.FIXTURES.acroform());
  assert.deepEqual(form.fields, { name: 'Ada Lovelace', agree: 'Yes', term: 'Spring' });
  assert.equal(form.info.IsAcroFormPresent, true);
  const hybrid = await read(F.FIXTURES.hybridXfa());
  assert.deepEqual([hybrid.info.IsXFAPresent, hybrid.info.IsAcroFormPresent, hybrid.fields['form1[0].name[0]']], [true, true, 'Ada Lovelace']);
  const pure = await read(F.FIXTURES.pureXfa());
  assert.deepEqual([pure.info.IsXFAPresent, pure.info.IsAcroFormPresent], [true, false]);
  assert.match(pure.pages[0], /^Please wait/);
  const signed = await read(F.FIXTURES.signed());
  assert.deepEqual([signed.info.IsSignaturesPresent, signed.signatures], [true, 1]);
  await assert.rejects(opened(F.FIXTURES.encrypted()), { name: 'PasswordException', code: pdfjs.PasswordResponses.NEED_PASSWORD });
  await assert.rejects(opened(F.FIXTURES.encrypted(), 'wrong'), { name: 'PasswordException', code: pdfjs.PasswordResponses.INCORRECT_PASSWORD });
  for (const password of [F.PASSWORDS.user, F.PASSWORDS.owner]) assert.deepEqual((await read(F.FIXTURES.encrypted(), password)).pages, three, password);
  const restricted = await read(F.FIXTURES.restricted());
  assert.deepEqual([restricted.pages, restricted.info.EncryptFilterName], [three, 'Standard']);
  assert.deepEqual(restricted.permissions, ALL(pdfjs).filter((p) => p !== pdfjs.PermissionFlag.PRINT && p !== pdfjs.PermissionFlag.PRINT_HIGH_QUALITY));
  assert.deepEqual((await read(F.FIXTURES.scanned())).pages, [' 0'], 'a picture, no text');
  const scan = await opened(F.FIXTURES.scanned());
  try { assert.ok((await (await scan.getPage(1)).getOperatorList()).fnArray.includes(pdfjs.OPS.paintImageXObject)); } finally { await scan.loadingTask.destroy(); }
});

test('the cross-reference fixtures: object streams with an XRef stream, and a table whose every offset misses', async () => {
  const text = (bytes) => Buffer.from(bytes).toString('latin1');
  const streams = text(F.FIXTURES.xrefStream());
  assert.match(streams, /\/Type \/XRef/);
  assert.match(streams, /\/Type \/ObjStm/);
  assert.doesNotMatch(streams, /\nxref\n/);
  assert.deepEqual((await read(F.FIXTURES.xrefStream())).pages, ['Alpha page one 0', 'Bravo page two 0', 'Charlie page three 0']);
  const broken = text(F.FIXTURES.brokenXref());
  const rows = broken.slice(broken.lastIndexOf('\nxref\n')).split('\n').filter((l) => / 00000 n $/.test(l));
  assert.ok(rows.length > 5);
  rows.forEach((row, i) => assert.ok(!broken.startsWith(`${i + 1} 0 obj`, parseInt(row, 10)), `object ${i + 1} is where the table says`));
  assert.deepEqual((await read(F.FIXTURES.brokenXref())).pages, ['Alpha page one 0', 'Bravo page two 0', 'Charlie page three 0'], 'pdf.js rebuilds the table');
});

test('the large fixture: pages of noise that does not compress, about the size asked for', async () => {
  const bytes = F.large({ count: 6, size: 1.2e6 });
  assert.ok(Math.abs(bytes.length - 1.2e6) < 0.1e6, `${bytes.length} bytes`);
  const { pages } = await read(bytes);
  assert.deepEqual(pages, Array.from({ length: 6 }, (_, i) => `Page ${i + 1} of 6 0`));
});

// ---- lib/pdf-doc.js ----------------------------------------------------------------------------------------------------
const D = require('../lib/pdf-doc.js');
const api = async () => D.use(await load());
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const THREE = ['Alpha page one 0', 'Bravo page two 0', 'Charlie page three 0'];
const refused = (name) => (e) => { assert.equal(e.name, name, e.stack); return true; };
// A page's size as pdf.js shows it: its box, turned.
const shown = async (bytes, n) => {
  const doc = await opened(bytes);
  try { const page = await doc.getPage(n); const { width, height } = page.getViewport({ scale: 1 }); return [width, height]; } finally { await doc.loadingTask.destroy(); }
};

test('open says what a file is and allows, keeps the caller\'s bytes, and names its hash', async () => {
  const pdf = await api();
  const bytes = F.FIXTURES.three();
  const r = await pdf.open(bytes);
  try {
    assert.deepEqual({ ...r, doc: undefined }, { doc: undefined, pages: 3, permissions: null, hasForms: false, signed: false, encrypted: false,
      allows: { pages: true, add: true }, hash: sha(bytes) });
    assert.equal(r.doc.numPages, 3);
    assert.equal(bytes.length, F.FIXTURES.three().length, 'not handed to the worker');
  } finally { await r.doc.loadingTask.destroy(); }
  const facts = async (bytes, opts) => { const { doc, hash, ...rest } = await pdf.open(bytes, opts); await doc.loadingTask.destroy(); return rest; };
  assert.equal((await facts(F.FIXTURES.acroform())).hasForms, true);
  assert.equal((await facts(F.FIXTURES.hybridXfa())).hasForms, true, 'a hybrid XFA form opens as its AcroForm');
  assert.deepEqual(await facts(F.FIXTURES.signed()), { pages: 3, permissions: null, hasForms: true, signed: true, encrypted: false, allows: { pages: false, add: false } });
  const P = (await load()).PermissionFlag;
  const restricted = await facts(F.FIXTURES.restricted());
  assert.deepEqual(restricted, { pages: 3, permissions: [P.MODIFY_CONTENTS, P.COPY, P.MODIFY_ANNOTATIONS, P.FILL_INTERACTIVE_FORMS, P.COPY_FOR_ACCESSIBILITY, P.ASSEMBLE],
    hasForms: false, signed: false, encrypted: true, allows: { pages: true, add: false } });
  assert.equal((await facts(F.FIXTURES.encrypted(), { password: F.PASSWORDS.user })).encrypted, true);
  for (const name of ['brokenXref', 'xrefStream', 'scanned', 'rotated']) assert.ok((await facts(F.FIXTURES[name]())).allows.pages, name);
  assert.equal((await facts(new Uint8Array(F.FIXTURES.three()).buffer)).pages, 3, 'an ArrayBuffer is a PDF too');
});

test('open refuses what Glaze cannot keep: too large, too many pages, pure XFA, a password not given, not a PDF', async () => {
  const pdf = await api();
  assert.deepEqual(D.LIMITS, { bytes: 50e6, pages: 500, merged: 50e6, text: 20000, thumbnail: 24576 });
  await assert.rejects(pdf.open(new Uint8Array(50e6 + 1)), refused('PdfTooLargeError'));
  await assert.rejects(pdf.open(F.FIXTURES.three(), { limits: { bytes: 1000 } }), refused('PdfTooLargeError'));
  const many = F.write(F.pagesOf(Array.from({ length: 501 }, () => ({}))).objects);
  await assert.rejects(pdf.open(many), refused('PdfTooManyPagesError'));
  await assert.rejects(pdf.open(many, { limits: { pages: 1000 } }), refused('PdfTooManyPagesError'), 'a limit is only lowered');
  await assert.rejects(pdf.open(F.FIXTURES.three(), { limits: { pages: 2 } }), refused('PdfTooManyPagesError'));
  await assert.rejects(pdf.open(F.FIXTURES.pureXfa()), refused('PdfXfaError'));
  await assert.rejects(pdf.open(F.FIXTURES.encrypted()), (e) => refused('PdfPasswordError')(e) && e.reason === 'needed');
  await assert.rejects(pdf.open(F.FIXTURES.encrypted(), { password: 'wrong' }), (e) => refused('PdfPasswordError')(e) && e.reason === 'incorrect');
  await assert.rejects(pdf.open(new TextEncoder().encode('%PDF-1.7\nnothing here\n')), refused('PdfInvalidError'));
  await assert.rejects(pdf.open(new Uint8Array(0)), refused('PdfInvalidError'));
  await assert.rejects(pdf.open('%PDF-1.7'), TypeError);
});

test('save appends the editor\'s changes: field values, a new note, all still editable; each save names the one before', async () => {
  const pdfjs = await load();
  const pdf = await api();
  const original = F.acroform();
  const { doc, hash } = await pdf.open(original);
  try {
    const same = await pdf.save(doc);
    assert.deepEqual([same.changed, same.hash, same.base, Buffer.compare(same.bytes, original)], [false, hash, hash, 0], 'nothing changed: the same bytes');
    const fields = await doc.getFieldObjects();
    doc.annotationStorage.setValue(fields.get('name')[0].id, { value: 'Grace Hopper' });
    doc.annotationStorage.setValue(fields.get('agree')[0].id, { value: false });
    doc.annotationStorage.setValue(fields.get('term')[0].id, { value: 'Fall' });
    const first = await pdf.save(doc);
    assert.deepEqual([first.changed, first.base, first.hash], [true, hash, sha(first.bytes)]);
    assert.equal(Buffer.compare(first.bytes.subarray(0, original.length), original), 0, 'an incremental update after the original bytes');
    assert.deepEqual((await read(first.bytes)).fields, { name: 'Grace Hopper', agree: 'Off', term: 'Fall' });
    doc.annotationStorage.setValue('pdfjs_internal_editor_0', { annotationType: pdfjs.AnnotationEditorType.FREETEXT, color: [0, 0, 255], fontSize: 12,
      value: 'Glaze note', pageIndex: 2, rect: [20, 20, 150, 50], rotation: 0, structTreeParentId: null, id: null });
    const second = await pdf.save(doc);
    assert.equal(second.base, first.hash, 'one step back is the save before');
    const back = await opened(second.bytes);
    try {
      const annotations = await (await back.getPage(3)).getAnnotations();
      assert.deepEqual(annotations.map((a) => [a.annotationType, a.contentsObj?.str]), [[pdfjs.AnnotationType.FREETEXT, 'Glaze note']], 'a FreeText annotation, not drawn into the page');
      assert.equal((await (await back.getPage(3)).getTextContent()).items.map((i) => i.str).join(''), 'Charlie page three');
    } finally { await back.loadingTask.destroy(); }
    assert.deepEqual((await read(second.bytes)).fields, { name: 'Grace Hopper', agree: 'Off', term: 'Fall' });
  } finally { await doc.loadingTask.destroy(); }
});

test('save keeps what the file is: a hybrid form\'s XFA data follows its field, an encrypted file stays encrypted, a signature stays', async () => {
  const pdfjs = await load();
  const pdf = await api();
  const note = (doc, pageIndex) => doc.annotationStorage.setValue('pdfjs_internal_editor_0', { annotationType: pdfjs.AnnotationEditorType.FREETEXT,
    color: [0, 0, 0], fontSize: 10, value: 'kept', pageIndex, rect: [20, 20, 120, 40], rotation: 0, structTreeParentId: null, id: null });
  const saved = async (bytes, edit, opts) => {
    const { doc } = await pdf.open(bytes, opts);
    try { await edit(doc); return (await pdf.save(doc)).bytes; } finally { await doc.loadingTask.destroy(); }
  };
  const hybrid = await saved(F.FIXTURES.hybridXfa(), async (doc) => doc.annotationStorage.setValue((await doc.getFieldObjects()).get('form1[0].name[0]')[0].id, { value: 'Grace Hopper' }));
  assert.equal((await read(hybrid)).fields['form1[0].name[0]'], 'Grace Hopper');
  const datasets = Buffer.from(hybrid).toString('latin1').match(/<xfa:datasets[\s\S]*?<\/xfa:datasets>/g);
  assert.match(datasets.at(-1), /<name>Grace Hopper<\/name>/, 'the datasets packet Acrobat reads has the new value');
  const restricted = await saved(F.FIXTURES.restricted(), (doc) => note(doc, 1));
  const r = await read(restricted);
  assert.deepEqual([r.info.EncryptFilterName, r.permissions], ['Standard', (await read(F.FIXTURES.restricted())).permissions]);
  const locked = await saved(F.FIXTURES.encrypted(), (doc) => note(doc, 0), { password: F.PASSWORDS.user });
  await assert.rejects(opened(locked), { name: 'PasswordException' });
  assert.deepEqual((await read(locked, F.PASSWORDS.user)).pages, THREE);
  const signed = await saved(F.FIXTURES.signed(), (doc) => note(doc, 0));
  assert.equal((await read(signed)).signatures, 1, 'the signed bytes are untouched; the change comes after them');
});

test('save refuses a file past the size limit, so every saved file opens again', async () => {
  const pdfjs = await load();
  const pdf = await api();
  const { doc } = await pdf.open(F.FIXTURES.three());
  try {
    doc.annotationStorage.setValue('pdfjs_internal_editor_0', { annotationType: pdfjs.AnnotationEditorType.FREETEXT, color: [0, 0, 0], fontSize: 10,
      value: 'x'.repeat(2000), pageIndex: 0, rect: [20, 20, 120, 40], rotation: 0, structTreeParentId: null, id: null });
    await assert.rejects(pdf.save(doc, { limits: { bytes: 2000 } }), refused('PdfTooLargeError'));
    assert.ok((await pdf.save(doc)).changed);
  } finally { await doc.loadingTask.destroy(); }
});

test('layout applies page operations in order, each counting the pages as the ones before left them', () => {
  const at = (pages) => pages.map((p) => (p.source === 'blank' ? `blank${p.size ? p.size.join('x') : ''}` : `${p.source}:${p.page}`) + (p.turn ? `@${p.turn}` : ''));
  assert.deepEqual(at(D.layout(3, [])), ['0:0', '0:1', '0:2']);
  assert.deepEqual(at(D.layout(3, [{ op: 'reorder', order: [2, 0, 1] }])), ['0:2', '0:0', '0:1']);
  assert.deepEqual(at(D.layout(3, [{ op: 'delete', pages: [0, 2] }])), ['0:1']);
  assert.deepEqual(at(D.layout(3, [{ op: 'duplicate', pages: [0, 2] }])), ['0:0', '0:0', '0:1', '0:2', '0:2']);
  assert.deepEqual(at(D.layout(3, [{ op: 'rotate', pages: [0, 1], by: -90 }, { op: 'rotate', pages: [1], by: 450 }])), ['0:0@270', '0:1', '0:2']);
  assert.deepEqual(at(D.layout(3, [{ op: 'blank', at: 1 }, { op: 'blank', size: [100, 50] }])), ['0:0', 'blank', '0:1', '0:2', 'blank100x50']);
  assert.deepEqual(at(D.layout(2, [{ op: 'merge', at: 1 }, { op: 'merge', at: 0 }], [2, 1])), ['2:0', '0:0', '1:0', '1:1', '0:1']);
  assert.deepEqual(at(D.layout(3, [{ op: 'duplicate', pages: [1] }, { op: 'rotate', pages: [2], by: 90 }, { op: 'reorder', order: [2, 1, 0, 3] }, { op: 'delete', pages: [3] }])),
    ['0:1@90', '0:1', '0:0'], 'a copy turns on its own');
  for (const [ops, counts] of [[[{ op: 'reorder', order: [0, 1] }]], [[{ op: 'reorder', order: [0, 0, 1] }]], [[{ op: 'delete', pages: [3] }]], [[{ op: 'delete', pages: [0, 1, 2] }]],
    [[{ op: 'rotate', pages: [0], by: 45 }]], [[{ op: 'rotate', pages: [0], by: '90' }]], [[{ op: 'blank', at: 4 }]], [[{ op: 'blank', size: [1, 1] }]], [[{ op: 'merge' }], []], [[{ op: 'merge' }], [0]]]) {
    assert.throws(() => D.layout(3, ops, counts), RangeError, JSON.stringify(ops));
  }
  assert.throws(() => D.layout(3, [{ op: 'flatten' }]), TypeError);
});

test('bake round trips each page operation, read back by pdf.js, and names the bytes it replaces', async () => {
  const pdf = await api();
  const three = F.FIXTURES.three();
  const baked = async (ops, bytes = three) => {
    const r = await pdf.bake(bytes, ops);
    assert.deepEqual([r.base, r.hash, r.pages], [sha(bytes), sha(r.bytes), (await read(r.bytes)).pages.length]);
    return (await read(r.bytes)).pages;
  };
  assert.deepEqual(await baked([{ op: 'reorder', order: [2, 0, 1] }]), ['Charlie page three 0', 'Alpha page one 0', 'Bravo page two 0']);
  assert.deepEqual(await baked([{ op: 'delete', pages: [1] }]), ['Alpha page one 0', 'Charlie page three 0']);
  assert.deepEqual(await baked([{ op: 'duplicate', pages: [0] }]), ['Alpha page one 0', 'Alpha page one 0', 'Bravo page two 0', 'Charlie page three 0']);
  assert.deepEqual(await baked([{ op: 'rotate', pages: [0], by: 90 }, { op: 'rotate', pages: [2], by: -90 }]), ['Alpha page one 90', 'Bravo page two 0', 'Charlie page three 270']);
  assert.deepEqual(await baked([{ op: 'blank', at: 1 }]), ['Alpha page one 0', ' 0', 'Bravo page two 0', 'Charlie page three 0']);
  const other = F.FIXTURES.rotated();
  assert.deepEqual(await baked([{ op: 'merge', bytes: other, at: 1 }]),
    ['Alpha page one 0', 'Alpha page one 90', 'Bravo page two 270', 'Charlie page three 180', 'Delta page four 90', 'Bravo page two 0', 'Charlie page three 0'], 'the merged file keeps its turns');
  assert.deepEqual(await baked([{ op: 'duplicate', pages: [1] }, { op: 'rotate', pages: [2], by: 180 }, { op: 'merge', bytes: F.FIXTURES.xrefStream(), at: 0 }, { op: 'delete', pages: [1, 2] },
    { op: 'blank', at: 0 }, { op: 'reorder', order: [5, 0, 1, 2, 3, 4] }]),
  ['Charlie page three 0', ' 0', 'Alpha page one 0', 'Alpha page one 0', 'Bravo page two 0', 'Bravo page two 180'], 'all at once, in one pass');
  const same = await pdf.bake(three, []);
  assert.deepEqual([same.bytes, same.hash, same.base], [three, sha(three), sha(three)], 'no ops, no change');
});

test('bake honours inherited turns, sizes a blank page as the page before it shows, and survives odd cross-references', async () => {
  const pdf = await api();
  const rotated = F.FIXTURES.rotated();
  const turned = await pdf.bake(rotated, [{ op: 'rotate', pages: [0, 1, 2, 3], by: 90 }]);
  assert.deepEqual((await read(turned.bytes)).pages, ['Alpha page one 180', 'Bravo page two 0', 'Charlie page three 270', 'Delta page four 180']);
  const moved = await pdf.bake(rotated, [{ op: 'reorder', order: [3, 2, 1, 0] }]);
  assert.deepEqual((await read(moved.bytes)).pages, ['Delta page four 90', 'Charlie page three 180', 'Bravo page two 270', 'Alpha page one 90'], 'a turn from the tree stays with its page');
  const blanks = await pdf.bake(rotated, [{ op: 'blank', at: 1 }, { op: 'blank', at: 0 }, { op: 'blank', size: [100, 50] }]);
  assert.deepEqual((await read(blanks.bytes)).pages.map((p) => p.split(' ').at(-1)), ['0', '90', '0', '270', '180', '90', '0']);
  assert.deepEqual(await shown(blanks.bytes, 3), await shown(rotated, 1), 'after a page turned by its tree: its turned size');
  assert.deepEqual(await shown(blanks.bytes, 1), await shown(rotated, 1), 'first: the size of the page after it');
  assert.deepEqual(await shown(blanks.bytes, 7), [100, 50], 'the size asked for');
  for (const name of ['brokenXref', 'xrefStream']) {
    const r = await pdf.bake(F.FIXTURES[name](), [{ op: 'reorder', order: [1, 2, 0] }, { op: 'rotate', pages: [0], by: 90 }]);
    assert.deepEqual((await read(r.bytes)).pages, ['Bravo page two 90', 'Charlie page three 0', 'Alpha page one 0'], name);
  }
  const scan = await pdf.bake(F.FIXTURES.scanned(), [{ op: 'duplicate', pages: [0] }, { op: 'rotate', pages: [1], by: 270 }]);
  assert.deepEqual((await read(scan.bytes)).pages, [' 0', ' 270']);
});

test('bake keeps form fields and their saved values, and an encrypted file\'s lock and permissions', async () => {
  const pdf = await api();
  const { doc } = await pdf.open(F.acroform());
  let filled;
  try {
    doc.annotationStorage.setValue((await doc.getFieldObjects()).get('name')[0].id, { value: 'Grace Hopper' });
    filled = (await pdf.save(doc)).bytes;
  } finally { await doc.loadingTask.destroy(); }
  const r = await pdf.bake(filled, [{ op: 'reorder', order: [1, 2, 0] }, { op: 'rotate', pages: [2], by: 90 }, { op: 'blank', at: 1 }]);
  const back = await read(r.bytes);
  assert.deepEqual(back.pages, ['Bravo page two 0', ' 0', 'Charlie page three 0', 'Alpha page one 90']);
  assert.deepEqual(back.fields, { name: 'Grace Hopper', agree: 'Yes', term: 'Spring' });
  const twice = await pdf.bake(filled, [{ op: 'duplicate', pages: [0] }]);
  assert.deepEqual((await read(twice.bytes)).fields, { name: 'Grace Hopper', agree: 'Yes', term: 'Spring' }, 'a copied page shows the same field');
  const hybrid = await pdf.bake(F.FIXTURES.hybridXfa(), [{ op: 'rotate', pages: [0], by: 90 }]);
  assert.equal((await read(hybrid.bytes)).fields['form1[0].name[0]'], 'Ada Lovelace');
  const restricted = await pdf.bake(F.FIXTURES.restricted(), [{ op: 'reorder', order: [2, 1, 0] }, { op: 'rotate', pages: [0], by: 90 }]);
  const kept = await read(restricted.bytes);
  assert.deepEqual([kept.pages, kept.info.EncryptFilterName, kept.permissions],
    [['Charlie page three 90', 'Bravo page two 0', 'Alpha page one 0'], 'Standard', (await read(F.FIXTURES.restricted())).permissions]);
  const locked = await pdf.bake(F.FIXTURES.encrypted(), [{ op: 'delete', pages: [0] }], { password: F.PASSWORDS.user });
  await assert.rejects(opened(locked.bytes), { name: 'PasswordException' });
  assert.deepEqual((await read(locked.bytes, F.PASSWORDS.user)).pages, THREE.slice(1));
});

test('bake refuses what would break or unlock a file, or pass the limits', async () => {
  const pdf = await api();
  const three = F.FIXTURES.three();
  const turn = [{ op: 'rotate', pages: [0], by: 90 }];
  await assert.rejects(pdf.bake(F.FIXTURES.signed(), turn), refused('PdfSignedError'));
  await assert.rejects(pdf.bake(F.FIXTURES.pureXfa(), turn), refused('PdfXfaError'));
  await assert.rejects(pdf.bake(F.FIXTURES.encrypted(), turn), refused('PdfPasswordError'));
  await assert.rejects(pdf.bake(F.FIXTURES.restricted(), [{ op: 'blank' }]), refused('PdfProtectedError'), 'pdf.js would write it unencrypted');
  await assert.rejects(pdf.bake(F.FIXTURES.restricted(), [{ op: 'merge', bytes: three }]), refused('PdfProtectedError'));
  const nothing = F.write(F.pagesOf(LABELS3()).objects, { id: 'locked-pages', encrypt: { owner: 'o', permissions: (0xfffffffc & ~0x400 & ~0x8) | 0 } });
  await assert.rejects(pdf.bake(nothing, turn), refused('PdfLockedError'), 'neither assembling nor changing the document allowed');
  assert.equal((await pdf.bake(nothing, [])).pages, 3, 'no ops ask for nothing');
  for (const [other, name] of [[F.FIXTURES.pureXfa(), 'PdfXfaError'], [F.FIXTURES.signed(), 'PdfSignedError'], [F.FIXTURES.restricted(), 'PdfProtectedError'],
    [F.FIXTURES.encrypted(), 'PdfProtectedError'], [new Uint8Array([37, 80, 68, 70]), 'PdfInvalidError']]) {
    await assert.rejects(pdf.bake(three, [{ op: 'merge', bytes: other }]), refused(name), name);
  }
  await assert.rejects(pdf.bake(three, [{ op: 'merge', bytes: F.FIXTURES.three() }], { limits: { merged: 2000 } }), refused('PdfTooLargeError'));
  await assert.rejects(pdf.bake(three, [{ op: 'merge', bytes: new Uint8Array(50e6 + 1) }]), refused('PdfTooLargeError'));
  await assert.rejects(pdf.bake(new Uint8Array(50e6 + 1), turn), refused('PdfTooLargeError'));
  const many = F.write(F.pagesOf(Array.from({ length: 498 }, () => ({}))).objects);
  await assert.rejects(pdf.bake(three, [{ op: 'merge', bytes: many }]), refused('PdfTooManyPagesError'));
  assert.equal((await pdf.bake(three, [{ op: 'merge', bytes: many }, { op: 'delete', pages: [0] }])).pages, 500, 'exactly the limit');
  await assert.rejects(pdf.bake(three, [{ op: 'delete', pages: [0, 1, 2] }]), RangeError);
  await assert.rejects(pdf.bake(three, { op: 'delete' }), TypeError);
});

test('text reads a page in order, bounded; thumbnail says why it drew nothing where there is no canvas', async () => {
  const pdf = await api();
  const doc = await opened(F.FIXTURES.three());
  try {
    assert.equal(await pdf.text(await doc.getPage(2)), 'Bravo page two');
    assert.equal(await pdf.text(await doc.getPage(3), { max: 7 }), 'Charlie');
    assert.equal(typeof OffscreenCanvas, 'undefined');
    assert.deepEqual(await pdf.thumbnail(await doc.getPage(1), 200), { png: null, reason: 'no canvas to draw on' });
  } finally { await doc.loadingTask.destroy(); }
  const long = F.write(F.pagesOf([{ content: Array.from({ length: 3000 }, (_, i) => `BT /F1 4 Tf 2 ${i % 190} Td (word${i}  and \\t  more) Tj ET`).join('\n') }]).objects);
  const big = await opened(long);
  try {
    const t = await pdf.text(await big.getPage(1));
    assert.equal(t.length, D.LIMITS.text);
    assert.doesNotMatch(t, / {2}|\t/);
    assert.ok(t.startsWith('word0 and more'), t.slice(0, 40));
  } finally { await big.loadingTask.destroy(); }
  const scan = await opened(F.FIXTURES.scanned());
  try { assert.equal(await pdf.text(await scan.getPage(1)), ''); } finally { await scan.loadingTask.destroy(); }
});
const LABELS3 = () => F.LABELS.map((label) => ({ label }));

// ---- scripts/pdf-fidelity.js: how it reads the other readers, and what it calls a difference --------------------------
test('the fidelity script reads pdfinfo and pdftotext, and marks what a reader shows differently from what was asked', () => {
  const V = require('../scripts/pdf-fidelity.js');
  assert.deepEqual(V.parseInfo('Pages:           2\nEncrypted:       yes (print:no copy:yes change:yes addNotes:yes algorithm:RC4)\nPage    1 size:  300 x 200 pts\nPage    1 rot:   90\nPage    2 size:  300 x 200 pts\nPage    2 rot:   0\n'),
    { pages: 2, rotations: [90, 0], encrypted: true, printing: false });
  assert.deepEqual(V.parseInfo('Pages:           1\nEncrypted:       no\nPage    1 rot:   0\n'), { pages: 1, rotations: [0], encrypted: false, printing: true });
  assert.deepEqual(V.splitPages('Alpha page one\n\n\f\n\fCharlie\n  page\n\f'), ['Alpha page one', '', 'Charlie page']);
  const sources = [{ pages: [{ text: 'A', rotate: 90 }, { text: 'B', rotate: 0 }] }, { pages: [{ text: 'M', rotate: 180 }] }];
  const slots = D.layout(2, [{ op: 'rotate', pages: [0], by: 270 }, { op: 'blank', at: 1 }, { op: 'merge' }, { op: 'rotate', pages: [1], by: 90 }], [1]);
  assert.deepEqual(V.expectedOf(sources, slots), [{ text: 'A', rotate: 0 }, { text: '', rotate: 90, blank: true }, { text: 'B', rotate: 0 }, { text: 'M', rotate: 180 }]);
  const want = { pages: [{ text: 'A', rotate: 0 }, { text: 'B', rotate: 90 }], fields: { name: 'Ada' } };
  assert.deepEqual(V.compare(want, { pages: [{ text: 'A', rotate: 0 }, { text: 'B', rotate: 90 }], fields: { name: 'Ada', other: 'x' } }), { pages: 'ok', order: 'ok', rotation: 'ok', fields: 'ok' });
  assert.deepEqual(V.compare(want, { pages: [{ text: 'B', rotate: 0 }, { text: 'A', rotate: 0 }], fields: null }), { pages: 'ok', order: 'pages 1, 2: "B", "A"', rotation: 'pages 2: 0', fields: 'n/a' });
  assert.deepEqual(V.compare(want, { pages: [{ text: 'A', rotate: 0 }], fields: { name: 'Grace' } }), { pages: '1, not 2', order: 'pages 2: null', rotation: 'pages 2: null', fields: 'name="Grace"' });
  assert.deepEqual(V.compare({ ...want, fields: null }, { pages: want.pages, fields: {} }).fields, '', 'no fields asked about');
  assert.deepEqual(V.compare(want, { error: 'locked' }), { pages: 'locked', order: '', rotation: '', fields: '' });
  const drawn = { pages: [{ text: 'A Glaze note', rotate: 0 }, { text: 'Ada B', rotate: 90 }], fields: null, drawnFields: true };
  assert.deepEqual(V.compare(want, drawn), { pages: 'ok', order: 'ok', rotation: 'ok', fields: 'drawn' }, "a page's text may hold its annotations' too");
  assert.equal(V.compare({ ...want, fields: { name: 'Grace', agree: 'Yes' } }, drawn).fields, 'not drawn: name', 'a check box draws no text');
  assert.equal(V.compare({ pages: [{ text: '', rotate: 0, blank: true }] }, { pages: [{ text: 'A', rotate: 0 }] }).order, 'pages 1: "A"', 'a blank page holds no text');
  assert.equal(V.compare({ pages: [{ text: '', rotate: 0 }] }, { pages: [{ text: 'Glaze note', rotate: 0 }] }).order, 'ok', 'a scan tells no order by its text');
  assert.equal(V.compare({ pages: [{ text: '', rotate: 0 }] }, { pages: [] }).order, 'pages 1: null', 'but it is there');
  assert.match(V.table([{ file: 'three', output: 'baked', reader: 'PDFKit', pages: 'ok', order: 'ok', rotation: 'ok', fields: '', notes: 'a | b' }]),
    /^\| three \| baked \| PDFKit \| ok \| ok \| ok \|  \| a \\\| b \|$/m);
});
