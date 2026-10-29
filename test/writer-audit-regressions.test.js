const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I = require('../lib/i18n.js');
const read = (file) => fs.readFileSync(path.join(process.env.GZ_WRITER_AUDIT_SOURCE || path.join(__dirname, '..'), file), 'utf8');

// Run the real import handler through its refusal path, without replacing any paper.
const refusedImport = async (error, lang) => {
  const source = read('writer-paper.js'), start = source.indexOf('    // The paper becomes the Word file'), end = source.indexOf("    file.addEventListener('change'", start);
  const toasts = [];
  const importFile = vm.runInNewContext(`${source.slice(start, end)} importFile`, {
    RangeError, ArrayBuffer, Uint8Array, console: { error() {} }, current: null, api: null, key: 'paper', root: { isConnected: true }, view: { state: { doc: {} }, props: {}, setProps() {}, focus() {} }, need: async () => {}, DOCX: [], format: 'mla9',
    GZ_WRITER_DOCX: { importDocx: async () => { throw error; } },
    t: (key) => I.t(key, {}, lang), toast: (text) => toasts.push(text),
  });
  await importFile({ size: 1, arrayBuffer: async () => new ArrayBuffer(1) });
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

test('the command palette offers Documents on Ultra and Canvas while Writer is on, and opens it only for a trusted choice', async () => {
  const source = read('features/palette.js'), start = source.indexOf("  // Glaze Writer's Documents"), end = source.indexOf('  // Notes opens', start);
  assert.ok(start > 0 && end > start);
  for (const ultra of [true, false]) {
    for (const [enhance, shown] of [[{ writer: true }, true], [{}, true], [{ writer: false }, false]]) {
      const sent = [];
      const apps = vm.runInNewContext(`${source.slice(start, end)} apps`, {
        ultra, ctx: { settings: () => ({ enhance }) }, t: (key) => key, glazeCmds: () => [],
        chrome: { runtime: { sendMessage: async (m) => sent.push(m) } },
      });
      const rows = apps(null);
      assert.ok(!rows.some((row) => row.label === 'Papers'), 'the old name is gone');
      const docs = rows.find((row) => row.label === 'Documents');
      assert.equal(!!docs, shown, `${ultra ? 'Ultra' : 'Canvas'}, enhance ${JSON.stringify(enhance)}`);
      if (!docs) continue;
      assert.deepEqual([docs.hint, docs.group], ['Glaze', 'Glaze']);
      await docs.run({ isTrusted: false });
      await docs.run();
      assert.equal(sent.length, 0, 'a scripted choice opens nothing');
      await docs.run({ isTrusted: true });
      assert.deepEqual(sent, ['papers']);
    }
  }
});

test("Moodle's command palette offers Documents too, and its row opens the page for the student's own click", async () => {
  const { El } = require('./stand-in-dom.js');
  const D = require('../defaults.js');
  for (const [writer, shown] of [[true, true], [false, false]]) {
    const doc = { activeElement: null };
    doc.root = new El('html', doc); doc.body = new El('body', doc); doc.root.append(doc.body);
    // insertBefore: the list's "Loading…" row while Moodle's commands come.
    doc.createElement = (tag) => Object.assign(new El(tag, doc), { insertBefore(x, at) { if (at) at.before(x); else this.append(x); } });
    const sent = [];
    const settings = D.GZ_SANITIZE({ enhance: { writer } });
    const ctx = vm.createContext({ document: doc, location: { origin: 'https://moodle.school.test', pathname: '/my/' }, URL, GZ_PAGE: require('../lib/page.js'), GZ_I18N: I,
      GZ_LOOKS: D.GZ_LOOKS, GZ_LOOK_ON: D.GZ_LOOK_ON, GZ_LOOK_APPLY: D.GZ_LOOK_APPLY, GZ_ALL_PRESETS: D.GZ_ALL_PRESETS,
      chrome: { runtime: { sendMessage: async (m) => sent.push(m) }, storage: { sync: { set() {} } } },
      GZ_CTX: { site: 'moodle', t: (k) => k, locale: () => 'en', settings: () => settings, need: () => Promise.reject(new Error('not here')),
        moodleIn: async () => ({ commands: async () => [] }), dueWeek: async () => [], courseId: () => '' } });
    const cmd = vm.runInContext(read('features/palette.js'), ctx);
    cmd.open();
    for (let i = 0; i < 20; i++) await new Promise(setImmediate);
    const input = doc.body.querySelector('input');
    input.value = 'Documents';
    input.dispatchEvent({ type: 'input' });
    const row = doc.body.querySelectorAll('li').find((li) => li.querySelector('span')?.textContent === 'Documents');
    assert.equal(!!row, shown, `Moodle, Writer ${writer ? 'on' : 'off'}`);
    if (!row) { cmd.close(); continue; }
    row.dispatchEvent({ type: 'click', isTrusted: true });
    await new Promise(setImmediate);
    assert.deepEqual(sent, ['papers']);
    assert.equal(cmd.isOpen(), false);
  }
});

test('the paper Outline uses document translations while appearance Outline keeps its meaning', () => {
  const source = read('writer-paper.js');
  const key = source.match(/\['outline', '([^']+)'\]/)?.[1];
  const translate = (lang) => vm.runInNewContext(`(${source.match(/\bt = (\(k, v\) => [\s\S]+?), store = PA.open\(\)/)[1]})`, { host: { t: (k, v) => I.t(k, v, lang) } });
  assert.ok(key);
  assert.equal(translate('en')(key), 'Outline');
  assert.equal(translate('de')(key), 'Gliederung');
  assert.equal(translate('fr')(key), 'Plan');
  assert.equal(I.t('Outline', {}, 'de'), 'Umrandung');
});

test('Documents opens only from Glaze on an approved LMS page (Ultra, Canvas, Moodle) or from Glaze\'s own pages', async () => {
  const listeners = [], opened = [];
  const local = { ultra: ['https://school.test'], canvas: ['https://canvas.school.test/*'], moodle: ['https://moodle.school.test/*'] };
  const area = (data) => ({ get: async (key) => ({ [key]: data[key] }), set: async () => {}, remove: async () => {} });
  const context = vm.createContext({ URL, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto, atob, btoa,
    navigator: {}, importScripts: (...files) => { for (const file of files) vm.runInContext(read(`lib/${file}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (file = '') => `chrome-extension://glaze/${file}`, getManifest: () => require('../manifest.json'),
        onMessage: { addListener: (fn) => listeners.push(fn) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(local), sync: area({}), onChanged: { addListener() {} } },
      tabs: { create: async (opts) => opened.push(opts.url) },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const sender = { id: 'glaze', frameId: 0, tab: { id: 1 }, url: 'https://school.test/ultra/course' };
  const send = async (s) => {
    for (const fn of listeners) fn('papers', s, () => {});
    for (let i = 0; i < 10; i++) await new Promise(setImmediate);
  };
  for (const s of [{ ...sender, id: 'other' }, { ...sender, tab: undefined }, { ...sender, url: 'https://unapproved.test/ultra/course' }, { ...sender, url: 'https://school.test/unrelated' },
    { ...sender, url: 'https://canvas.unapproved.test/courses/1' }, { ...sender, url: 'https://moodle.unapproved.test/my/' }, { id: 'other', url: 'chrome-extension://other/options.html' }]) await send(s);
  assert.deepEqual(opened, []);
  // Glaze's bar on each LMS, and in Settings' preview of it (an extension page).
  for (const s of [sender, { ...sender, url: 'https://canvas.school.test/courses/1' }, { ...sender, url: 'https://moodle.school.test/my/' }, { id: 'glaze', frameId: 0, url: 'chrome-extension://glaze/preview.html', origin: 'chrome-extension://glaze' }]) await send(s);
  assert.deepEqual(opened, Array(4).fill('chrome-extension://glaze/papers.html'));
});
