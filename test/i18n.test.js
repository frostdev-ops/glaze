const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I = require('../lib/i18n.js');
const D = require('../defaults.js');
const F = require('../lib/fonts.js');
const N = require('../lib/news.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const LANGS = globalThis.GZ_LANGS;
const files = fs.readdirSync(path.join(root, 'i18n'));
const squash = (s) => s.replace(/\s+/g, ' ').trim();

// The English Glaze writes, as far as it can be found: the pages' own text, the first argument of
// every t() call, and the tables shown through t(). Lists inside code (content.js's page names, say)
// are kept honest by every language having the same keys.
const fromHtml = (html) => {
  const h = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<(\w+)[^>]*translate="no"[^>]*>[\s\S]*?<\/\1>/g, '');
  const out = [...h.matchAll(/>([^<]+)</g)].map((m) => squash(m[1]));
  for (const [tag] of h.matchAll(/<[^>]+>/g)) if (!/translate="no"/.test(tag)) for (const m of tag.matchAll(/\s(?:title|placeholder|aria-label)="([^"]*)"/g)) out.push(squash(m[1]));
  return out.filter((s) => /\p{L}/u.test(s));
};
const fromJs = (js) => {
  const out = [];
  for (const m of js.matchAll(/\bt\(/g)) {
    // The first argument, up to a comma or bracket at its own depth; every plain string in it.
    let depth = 0;
    let i = m.index + 2;
    for (let q = null; i < js.length; i++) {
      const c = js[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') q = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c) && depth-- === 0) break;
      else if (c === ',' && depth === 0) break;
    }
    // Not what a value is compared with: t(kind === 'items' ? …).
    const arg = js.slice(m.index + 2, i);
    for (const s of arg.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      if (!s[2].includes('${') && !/[=!]==\s*$/.test(arg.slice(0, s.index))) out.push(s[2].replace(/\\(.)/g, '$1'));
    }
  }
  return out;
};
// And every feature loaded on demand (features/*.js), which writes through GZ_CTX.t.
const JS = ['content.js', 'options.js', 'popup.js', 'ui.js', 'lib/page.js', 'lib/todo.js', ...fs.readdirSync(path.join(root, 'features')).filter((f) => f.endsWith('.js')).map((f) => `features/${f}`)];
const used = new Set([
  ...['options.html', 'popup.html'].flatMap((f) => fromHtml(read(f))),
  ...JS.flatMap((f) => fromJs(read(f))),
  ...D.GZ_COLORS.map(([, label]) => label),
  ...D.GZ_TABS.map(([, label]) => label),
  ...D.GZ_CONTRAST(D.GZ_DEFAULTS.colors).map((r) => r.label),
  ...Object.values(N.NOTES).flat(),
]);
const keys = new Set(Object.values(LANGS).flatMap((c) => Object.keys(c)));
const vars = (s) => new Set([...s.matchAll(/\{(\w+)(?:\|lower)?\}/g)].map((m) => m[1]));

test('every language has every key, and nothing else', () => {
  assert.deepEqual(Object.keys(LANGS).sort(), ['de', 'es', 'fr', 'nl', 'pt-BR']);
  for (const [lang, cat] of Object.entries(LANGS)) {
    for (const k of keys) assert.ok(k in cat, `${lang} is missing "${k}"`);
    for (const k of used) assert.ok(k in cat, `${lang} is missing "${k}"`);
  }
});

test('every key is still used', () => {
  const src = squash([...JS, 'lib/lookx.js', 'lib/grades.js', 'lib/gradecalc.js', 'lib/share.js', 'lib/i18n.js', 'lib/news.js', 'lib/fonts.js', 'defaults.js', 'options.html', 'popup.html'].map(read).join(' '));
  for (const k of keys) assert.ok(src.includes(k), `"${k}" is in no source file`);
});

test('translations keep their placeholders, and counts have an other form', () => {
  for (const [lang, cat] of Object.entries(LANGS)) {
    for (const [k, v] of Object.entries(cat)) {
      const want = vars(k);
      for (const form of typeof v === 'string' ? [v] : (assert.ok(v.other, `${lang}: "${k}" has no other form`), Object.values(v))) {
        assert.ok(form.trim(), `${lang}: "${k}" is empty`);
        const got = vars(form);
        assert.deepEqual([...got].filter((x) => !want.has(x)), [], `${lang}: "${form}" has a placeholder "${k}" doesn't`);
        assert.deepEqual([...want].filter((x) => x !== 'n' && !got.has(x)), [], `${lang}: "${form}" drops a placeholder of "${k}"`);
      }
    }
  }
  for (const [k, v] of Object.entries(I.EN)) assert.equal(v.other, k);
});

test('every catalogue is loaded wherever Glaze speaks', () => {
  // On the LMS, only the page's own, on demand (content.js words(), lib/background.js LOADABLE); the extension's
  // pages have them all.
  const content = require('../manifest.json').content_scripts[0].js;
  assert.deepEqual(I.CODES, files.map((f) => f.replace(/\.js$/, '')), 'GZ_I18N.CODES lists i18n/');
  for (const f of files) {
    assert.ok(!content.includes(`i18n/${f}`), `manifest: i18n/${f} loads on demand, not with every page`);
    assert.ok(read('lib/background.js').includes(`'i18n/${f}'`), `lib/background.js LOADABLE: i18n/${f}`);
    for (const page of ['options.html', 'popup.html']) assert.ok(read(page).includes(`<script src="i18n/${f}"></script>`), `${page}: i18n/${f}`);
  }
  assert.equal(I.file('de-AT'), 'i18n/de.js');
  assert.equal(I.file('pt-PT'), 'i18n/pt-BR.js');
  for (const tag of ['en', 'en-GB', 'ja', '', undefined, 'not a locale!']) assert.equal(I.file(tag), null, String(tag));
  assert.ok(content.indexOf('lib/i18n.js') < content.indexOf('lib/page.js'));
  assert.ok(read('preview.html').includes('<script src="lib/i18n.js"></script>'));
});

test('lookup, placeholders and plurals', () => {
  assert.equal(I.t('Restore'), 'Restore');
  assert.equal(I.t('Restore', {}, 'de'), LANGS.de.Restore);
  assert.equal(I.t('Saved {n} files', { n: 1 }), 'Saved 1 file');
  assert.equal(I.t('Saved {n} files', { n: 3 }), 'Saved 3 files');
  assert.equal(I.t('Saved {n} files', { n: 1234 }, 'de'), LANGS.de['Saved {n} files'].other.replace('{n}', '1.234'));
  // French counts 0 as one.
  assert.equal(I.t('Saved {n} files', { n: 0 }, 'fr'), LANGS.fr['Saved {n} files'].one.replace('{n}', '0'));
  assert.equal(I.t('Turn on {name|lower}', { name: 'Score bars' }), 'Turn on score bars');
  assert.equal(I.t('Graded · {mark}', {}), 'Graded · {mark}', 'a missing value stays visible');
});

test('fallback: a region gets its language, anything else English', () => {
  assert.equal(I.t('Restore', {}, 'es-MX'), LANGS.es.Restore);
  assert.equal(I.t('Restore', {}, 'pt-PT'), LANGS['pt-BR'].Restore);
  assert.equal(I.t('Restore', {}, 'nl-BE'), LANGS.nl.Restore);
  for (const l of ['ar-SA', 'ja', 'en-GB', 'not a locale!', '', undefined]) assert.equal(I.t('Restore', {}, l), 'Restore', String(l));
  assert.equal(I.locale('es-MX'), 'es-MX');
  assert.equal(I.locale('ar-SA'), 'en', 'numbers stay with the words');
  assert.equal(I.locale('en-GB'), 'en-GB');
  // A key no language has yet is English everywhere.
  assert.equal(I.t('Not a key {n}', { n: 2 }, 'de'), 'Not a key 2');
});

test('numbers and percentages in the language', () => {
  assert.equal(I.pct(82.45), '82.45%');
  assert.equal(I.pct(82.45, 'de'), '82,45 %');
  assert.equal(I.num(18.5, 'fr'), '18,5');
});

test('the manifest description is localized and fits the stores', () => {
  const m = require('../manifest.json');
  assert.equal(m.description, '__MSG_description__');
  assert.equal(m.name, 'Glaze');
  const dirs = fs.readdirSync(path.join(root, '_locales')).sort();
  assert.deepEqual(dirs, ['de', 'en', 'es', 'fr', 'nl', 'pt_BR']);
  for (const d of dirs) {
    const msgs = JSON.parse(read(`_locales/${d}/messages.json`));
    assert.deepEqual(Object.keys(msgs), ['description'], d);
    assert.ok(msgs.description.message.length <= 132, `${d}: Chrome Web Store allows 132 characters`);
  }
});

test('no catalogue lists the same English key twice', () => {
  for (const f of files) {
    const keys = [...read(`i18n/${f}`).matchAll(/^\s*'((?:[^'\\]|\\.)+)'\s*:/gm)].map((m) => m[1]);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dup, [], `${f} repeats ${dup.join(', ')}`);
  }
});
