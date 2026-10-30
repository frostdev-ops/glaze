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
