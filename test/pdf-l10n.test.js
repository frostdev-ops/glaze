// pdf.js's words in Glaze's (lib/pdf-l10n.js): every pdfjs-* id pdf_viewer.mjs carries (its en-US fallback, which holds the
// whole viewer's) or pdf.mjs's annotation layer and editors set is handled once, either by a Glaze key in the five
// catalogues for the parts the message has (its text, or its attributes), by the date as the student's language writes it,
// or as nothing shown. The DOM side (data-l10n-id elements as they are added) is scripts/pdf-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const L = require('../lib/pdf-l10n.js');
const I = require('../lib/i18n.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const viewer = read('lib/pdfjs/pdf_viewer.mjs'), core = read('lib/pdfjs/pdf.mjs');
const fallback = /const text = ("pdfjs-previous-button[^\n]*");\n/.exec(viewer);
assert.ok(fallback, 'pdf_viewer.mjs keeps its en-US messages');
// The en-US messages: each id with whether it has a value, its attributes, and whether it formats a date.
const FTL = (() => {
  const out = new Map();
  let cur = null;
  for (const line of JSON.parse(fallback[1]).split('\n')) {
    const head = /^(pdfjs-[a-z0-9-]+) =\s?(.*)$/.exec(line);
    if (head) { cur = { value: head[2].trim() !== '', attrs: new Set(), date: /DATETIME\(/.test(head[2]) }; out.set(head[1], cur); continue; }
    const attr = /^\s+\.([a-z-]+) =/.exec(line);
    if (attr && cur) { cur.attrs.add(attr[1]); continue; }
    if (cur && /^\s+\S/.test(line)) { cur.value = true; if (/DATETIME\(/.test(line)) cur.date = true; }
  }
  return out;
})();
const ids = (src) => new Set([...src.matchAll(/pdfjs-[a-z0-9-]+/g)].map((m) => m[0]));
const asked = new Set([...ids(viewer.replace(fallback[0], '')), ...ids(core)]);

test('the ids pdf.js asks for are all in its en-US messages, and no id is built at run time', () => {
  assert.ok(FTL.size > 300, `${FTL.size} messages`);
  for (const id of asked) assert.ok(FTL.has(id), id);
  assert.doesNotMatch(viewer + core, /[`'"]pdfjs-[a-z0-9-]*\$\{/, 'a template-built id would escape this list');
  assert.ok(asked.has('pdfjs-page-landmark') && asked.has('pdfjs-annotation-date-time-string'));
});

test('every pdfjs-* id pdf_viewer.mjs and pdf.mjs reference is handled, once, and none that pdf.js lacks', () => {
  const all = new Set([...ids(viewer), ...ids(core)]);
  for (const id of all) assert.ok(Object.hasOwn(L.IDS, id) !== L.QUIET.has(id), `${id}: ${Object.hasOwn(L.IDS, id) && L.QUIET.has(id) ? 'twice' : 'not handled'}`);
  for (const id of [...Object.keys(L.IDS), ...L.QUIET]) assert.ok(all.has(id), `${id} is not pdf.js's`);
});

test('each mapped id fills only the parts its message has, from keys in all five catalogues', () => {
  for (const [id, m] of Object.entries(L.IDS)) {
    const f = FTL.get(id);
    if (typeof m === 'function') { assert.ok(f.date, `${id} formats a date`); continue; }
    if (typeof m === 'string') { assert.ok(f.value, `${id} has a value`); continue; }
    assert.ok(m && typeof m === 'object' && Object.keys(m).length, `${id}: a key, attributes or a date`);
    for (const a of Object.keys(m)) assert.ok(f.attrs.has(a), `${id} has no .${a}`);
  }
  const keys = new Set(Object.values(L.IDS).flatMap((m) => (typeof m === 'string' ? [m] : typeof m === 'object' ? Object.values(m) : [])));
  for (const k of keys) {
    assert.ok(typeof k === 'string' && k, 'a key is a non-empty string');
    for (const lang of I.CODES) assert.ok(Object.hasOwn(globalThis.GZ_LANGS[lang], k), `${lang}: ${k}`);
  }
});

test('the viewer\'s and editors\' own labels are real; helper text and alt-text prompts are nothing', () => {
  assert.deepEqual(L.IDS['pdfjs-page-landmark'], { 'aria-label': 'Page {page}' });
  assert.deepEqual(L.IDS['pdfjs-editor-highlight-editor'], { 'aria-label': 'Highlight' });
  assert.deepEqual(L.IDS['pdfjs-editor-ink-editor'], { 'aria-label': 'Pen' });
  for (const id of ['pdfjs-editor-alt-text-button', 'pdfjs-editor-new-alt-text-missing-button', 'pdfjs-editor-alt-text-dialog-description', 'pdfjs-text-annotation-type', 'pdfjs-find-reached-top', 'pdfjs-editor-resizer-top-left'])
    assert.ok(L.QUIET.has(id), id);
  // Attributes left out of a mapped message show nothing: a tooltip repeating the label, a placeholder's helper text.
  assert.deepEqual(L.IDS['pdfjs-free-text2'], { 'aria-label': 'Text' });
});

test('messages: a key in the page\'s language with its args, a date in its locale, nothing for the rest', async () => {
  const t = (k, v) => I.t(k, v, 'de');
  const m = L.message(t, 'de');
  assert.deepEqual(m('pdfjs-page-landmark', { page: 3 }), { value: null, attributes: { 'aria-label': 'Seite 3' } });
  assert.deepEqual(m('pdfjs-editor-colorpicker-yellow'), { value: null, attributes: { title: 'Gelb' } });
  assert.deepEqual(m('pdfjs-editor-alt-text-button'), { value: null, attributes: null });
  assert.deepEqual(m('pdfjs-no-such-id'), { value: null, attributes: null });
  const at = Date.UTC(2026, 9, 30, 14, 5, 9);
  assert.equal(m('pdfjs-annotation-date-time-string', { dateObj: at }).value, new Intl.DateTimeFormat('de', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(at)));
  const l10n = L.make({ t, lang: 'de' });
  assert.equal(l10n.getLanguage(), 'de');
  assert.equal(l10n.getDirection(), 'ltr');
  assert.equal(await l10n.get('pdfjs-editor-new-alt-text-generated-alt-text-with-disclaimer', { generatedAltText: 'x' }), '');
  assert.deepEqual(await l10n.get(['pdfjs-editor-colorpicker-red', 'pdfjs-editor-alt-text-button']), ['', '']);
  assert.equal(L.make({ t, lang: 'ar' }).getDirection(), 'rtl');
});
