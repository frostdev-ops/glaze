// The Documents home (documents/papers.js) when a save is refused: the cap on documents (writer/writer-papers.js, 'too many
// documents') gets its own sentence, with the number from the cap; every other failure keeps "Not saved. Try again in a moment."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I = require('../../extension/core/i18n.js');
const PA = require('../../extension/writer/writer-papers.js');
for (const lang of ['de', 'es', 'fr', 'nl', 'pt-BR']) require(`../../extension/i18n/${lang}.js`);

const src = fs.readFileSync(path.join(__dirname, '../../extension/documents/papers.js'), 'utf8');
const cut = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); assert.ok(i >= 0 && j > i, from); return src.slice(i, j); };
const HELPER = src.includes('    const FULL = ') ? `${cut('    const FULL = ', '\n')}\n${cut('    const notSaved = ', '\n')}` : ''; // '' in a source without it
const RUN = cut('    const run = (act, k) => {', "    document.addEventListener('pointerdown'");

const FULL = 'Documents is full ({n}). Delete or export some to save a new one.';
const SAME = 'Not saved. Try again in a moment.';

// The Documents home's menu actions over stand-ins: copy fails with `error`; → what the page said.
const said = async (error, lang = 'en') => {
  const lines = [];
  const ctx = vm.createContext({ PA, t: (k, v) => I.t(k, v, lang), console: { error() {} }, dismiss() {}, say: (s) => lines.push(s), rename() {}, del() {}, out() {}, forever() {},
    copy: () => Promise.reject(error), cards: new Map(), DK: {} });
  vm.runInContext(`${HELPER}\n${RUN}\nglobalThis.run = run;`, ctx);
  ctx.run('copy', 'k');
  await new Promise(setImmediate);
  return lines.filter(Boolean);
};

test('a copy refused by the cap says Documents is full, with the cap\'s number', async () => {
  assert.equal(PA.CAP.rows, 2000);
  assert.deepEqual(await said(new Error('too many documents')), ['Documents is full (2,000). Delete or export some to save a new one.']);
});

test('every other failed copy still says Not saved', async () => {
  for (const error of [new Error('paper storage unavailable'), new Error('document changed in another tab'), new Error('sender'), new RangeError('too many documents in it'), 'too many documents', null, undefined]) {
    assert.deepEqual(await said(error), [SAME], String(error?.message ?? error));
  }
});

test('the sentence is in every catalogue, with the number, and is not the old line', () => {
  for (const lang of ['de', 'es', 'fr', 'nl', 'pt-BR']) {
    const line = I.t(FULL, { n: PA.CAP.rows }, lang);
    assert.equal(typeof globalThis.GZ_LANGS[lang][FULL], 'string', `${lang}: in its catalogue`);
    assert.notEqual(line, I.t(SAME, {}, lang), `${lang}: not the old line`);
    assert.match(line, /2\D?000/, `${lang}: the number`);
    assert.doesNotMatch(line, /[{}]/, `${lang}: nothing left unfilled`);
    assert.doesNotMatch(line, /!/, `${lang}: no exclamation`);
  }
});

// An import's card (importJob and showJob) over stand-ins: the file's kind fails with `error`; → what the card says.
const JOBS = cut('    const showJob = ', '    const removeJob = ');
const READ = 'That file could not be read as a Word document.';
const card = async (error, lang = 'en') => {
  const meta = { textContent: '' }, el = { toggleAttribute() {} };
  const j = { id: 1, file: { size: 3 }, kind: 'paper', p: null, failed: '', key: null, running: false, ui: { el, bar: { setAttribute() {} }, fill: { style: {} }, meta, acts: {} } };
  const ctx = vm.createContext({ PA, RangeError, t: (k, v) => I.t(k, v, lang), console: { error() {} }, count: {}, counted: '', refresh: async () => {}, render() {}, REFUSALS: new Set(), STEPS: {},
    saysOf: () => ({ size: 'Choose a Word file smaller than 15 MB.', read: READ }),
    DK: { progress: (tell) => Object.assign(() => {}, { end() {}, fail: (e) => tell({ failed: e ?? true }) }), said: () => null, get: () => ({ importFile: async () => { throw error; } }) } });
  vm.runInContext(`${HELPER}\n${JOBS}\nglobalThis.importJob = importJob;`, ctx);
  const r = await ctx.importJob(j);
  return { card: meta.textContent, said: r.failed };
};

test('a file the cap refuses as a new document says Documents is full on its card, not that it could not be read', async () => {
  assert.equal((await card(new Error('too many documents'))).card, 'Documents is full (2,000). Delete or export some to save a new one.');
});

test('any other failed import keeps its card line', async () => {
  for (const error of [new Error('paper storage unavailable'), new Error('bad zip'), new RangeError('Choose a Word file smaller than 15 MB.')]) {
    const { card: line } = await card(error);
    assert.equal(line, error instanceof RangeError ? error.message : READ, error.message);
  }
});
