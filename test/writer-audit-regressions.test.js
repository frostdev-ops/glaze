const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I = require('../lib/i18n.js');
const read = (file) => fs.readFileSync(path.join(process.env.GZ_WRITER_AUDIT_SOURCE || path.join(__dirname, '..'), file), 'utf8');

// Run the real import handler through its refusal path, without replacing any paper.
const refusedImport = async (error, lang) => {
  const source = read('writer-paper.js'), start = source.indexOf('    const importFile = '), end = source.indexOf("    file.addEventListener('change'", start);
  const toasts = [];
  const importFile = vm.runInNewContext(`${source.slice(start, end)} importFile`, {
    RangeError, Uint8Array, console: { error() {} }, view: { props: {} }, need: async () => {}, DOCX: [],
    GZ_WRITER_DOCX: { importDocx: async () => { throw error; } },
    t: (key) => I.t(key, {}, lang), toast: (text) => toasts.push(text),
  });
  await importFile({ arrayBuffer: async () => new ArrayBuffer(0) });
  return toasts[0];
};

test('Word import refusals show translated student messages and never raw parser diagnostics', async () => {
  const generic = 'That file could not be read as a Word document.';
  for (const lang of ['de', 'es', 'fr', 'nl', 'pt-BR']) {
    for (const message of ['too many files', 'document nesting too deep', 'a part of the document is too large', 'unexpected parser diagnostic']) {
      assert.equal(await refusedImport(new RangeError(message), lang), I.t(generic, {}, lang), `${lang}: ${message}`);
    }
    for (const message of ['Choose a Word file smaller than 15 MB.', 'The pictures in this file are larger than 10 MB.', 'The document is too large.', 'A table is too wide.']) {
      assert.equal(await refusedImport(new RangeError(message), lang), I.t(message, {}, lang));
    }
  }
});

test('the Ultra command palette offers Papers and opens it only for a trusted choice', async () => {
  const source = read('features/palette.js'), start = source.indexOf('  const apps = '), end = source.indexOf('  // Notes opens', start);
  const sent = [];
  const apps = vm.runInNewContext(`${source.slice(start, end)} apps`, {
    ultra: true, ctx: { settings: () => ({ enhance: { writer: true } }) }, t: (key) => key, glazeCmds: () => [],
    chrome: { runtime: { sendMessage: async (m) => sent.push(m) } },
  });
  const papers = apps(null).find((row) => row.label === 'Papers');
  assert.ok(papers, 'Papers is reachable without opening an assignment');
  await papers.run({ isTrusted: false });
  assert.equal(sent.length, 0);
  await papers.run({ isTrusted: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0], 'papers');
});

test('the paper Outline uses document translations while appearance Outline keeps its meaning', () => {
  const key = read('writer-paper.js').match(/\['outline', '([^']+)'\]/)?.[1];
  assert.ok(key);
  assert.equal(I.t(key, {}, 'en'), 'Outline');
  assert.equal(I.t(key, {}, 'de'), 'Gliederung');
  assert.equal(I.t(key, {}, 'fr'), 'Plan');
  assert.equal(I.t('Outline', {}, 'de'), 'Umrandung');
});
