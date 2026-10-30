const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const worker = () => {
  const loaded = [], install = [];
  let lang = 'de-DE', fail = '';
  const area = { get: async () => ({}), set: async () => {}, remove: async () => {} };
  const none = { addListener() {} };
  const context = vm.createContext({ URL, console, TextEncoder, TextDecoder, AbortController, structuredClone, Date, setTimeout, clearTimeout,
    addEventListener: (name, f) => { if (name === 'install') install.push(f); },
    crypto: globalThis.crypto, atob, btoa, navigator: {},
    importScripts: (...files) => { for (const f of files) { loaded.push(f); if (f === fail) throw new Error('fixture import failure'); vm.runInContext(fs.readFileSync(path.join(root, 'lib', f), 'utf8'), context, { filename: f }); } },
    chrome: { i18n: { getUILanguage: () => lang }, runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://glaze/${f}`, getManifest: () => require('../manifest.json'), onMessage: none, onInstalled: none, onStartup: none, onConnect: none },
      storage: { local: area, sync: area, onChanged: none } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'lib/background.js'), 'utf8'), context);
  vm.runInContext('sessions()', context);
  const copy = (kind = 'notes', title = 'Study') => vm.runInContext(`GZ_SHARING.ADAPTERS[${JSON.stringify(kind)}].copyOf({ title: ${JSON.stringify(title)} }, 'html', '<p>kept</p>')`, context);
  return { loaded, copy, install: () => { for (const f of install) f(); }, language: (l) => { lang = l; }, fail: (f) => { fail = f; } };
};

test('review: actual background worker localizes notes and collection conflict titles and follows UI-language changes', () => {
  const w = worker();
  for (const [lang, suffix] of [['de-DE', 'Konfliktkopie'], ['es-MX', 'copia en conflicto'], ['fr', 'copie en conflit'], ['nl-BE', 'conflictkopie'], ['pt-PT', 'cópia em conflito']]) {
    w.language(lang);
    for (const kind of ['notes', 'collection']) {
      const copy = w.copy(kind);
      assert.equal(copy.title, `Study (${suffix})`, `${kind} ${lang}`);
      assert.equal(copy.html, '<p>kept</p>');
    }
  }
  assert.equal(w.loaded.filter((f) => f === 'i18n.js').length, 1);
  assert.ok(w.loaded.filter((f) => f.startsWith('../i18n/')).every((f) => /^\.\.\/i18n\/(de|es|fr|nl|pt-BR)\.js$/.test(f)));
  assert.ok(w.copy('notes', 'x'.repeat(300)).title.length <= 300);
});

test('review: worker language/import failures fall back without stalling conflict preservation or importing arbitrary paths', () => {
  const w = worker();
  w.fail('../i18n/de.js');
  assert.equal(w.copy().title, 'Study (conflict copy)');
  w.fail('');
  assert.equal(w.copy().title, 'Study (Konfliktkopie)', `a failed catalogue load can recover: ${w.loaded.join(', ')}`);
  for (const lang of ['ja', 'en-GB', '../../evil', '', undefined]) { w.language(lang); assert.equal(w.copy('collection').title, 'Study (conflict copy)'); }
  assert.ok(w.loaded.every((f) => !f.includes('evil')));
});

test('review: service-worker installation caches every later lazy translation import', () => {
  const w = worker();
  w.install();
  for (const file of ['i18n.js', '../i18n/de.js', '../i18n/es.js', '../i18n/fr.js', '../i18n/nl.js', '../i18n/pt-BR.js']) assert.ok(w.loaded.includes(file), file);
});
