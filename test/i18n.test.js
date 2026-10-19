const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I = require('../lib/i18n.js');
const D = require('../defaults.js');
const F = require('../lib/fonts.js');
const N = require('../lib/news.js');
const P = require('../lib/parts.js');
const XP = require('../lib/lookparts.js');
const X = require('../lib/editor-x.js');
const BG = require('../lib/editor-xbg.js');
const M = require('../lib/editor-xmotion.js');
const MX = require('../lib/motionx.js');
const XE = require('../lib/editor-xparts.js');
const PET = require('../lib/pet.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const LANGS = globalThis.GZ_LANGS;
const files = fs.readdirSync(path.join(root, 'i18n'));
const squash = (s) => s.replace(/\s+/g, ' ').trim();

// The English Glaze writes, as far as it can be found: the pages' own text, the first argument of
// every t() or tr() call, and the tables shown through t(). Lists inside code (content.js's page names, say)
// are kept honest by every language having the same keys.
const fromHtml = (html) => {
  const h = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<(\w+)[^>]*translate="no"[^>]*>[\s\S]*?<\/\1>/g, '');
  const out = [...h.matchAll(/>([^<]+)</g)].map((m) => squash(m[1]));
  for (const [tag] of h.matchAll(/<[^>]+>/g)) if (!/translate="no"/.test(tag)) for (const m of tag.matchAll(/\s(?:title|placeholder|aria-label)="([^"]*)"/g)) out.push(squash(m[1]));
  return out.filter((s) => /\p{L}/u.test(s));
};
const fromJs = (js, calls = /\b(?:t|tr)\s*\(/g) => {
  const out = [];
  for (const m of js.matchAll(calls)) {
    // The argument after the matched prefix, up to a comma or bracket at its own depth; every plain string in it.
    let depth = 0;
    const start = m.index + m[0].length;
    let i = start;
    for (let q = null; i < js.length; i++) {
      const c = js[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') q = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c) && depth-- === 0) break;
      else if (c === ',' && depth === 0) break;
    }
    // Not what a value is compared with: t(kind === 'items' ? …).
    const arg = js.slice(start, i);
    for (const s of arg.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      if (!s[2].includes('${') && !/[=!]==\s*$/.test(arg.slice(0, s.index))) out.push(s[2].replace(/\\(.)/g, '$1'));
    }
  }
  return out.filter(Boolean);
};
// And every feature loaded on demand (features/*.js), which writes through GZ_CTX.t.
const JS = ['sharing/quick.js', 'lib/sessions-ui.js', 'content.js', 'content-ultra.js', 'content-canvas.js', 'options.js', 'popup.js', 'ui.js', 'lib/page.js', 'lib/petlibrary.js', 'lib/petsprites.js', 'lib/todo.js', 'lib/ultra.js', 'lib/editor-x.js', 'lib/editor-xbg.js', 'lib/editor-xmotion.js', 'lib/editor-xparts.js', 'lib/editor-mods.js', 'lib/editor-widget.js', 'lib/editor-navbar.js', 'lib/parts.js', 'lib/lookparts.js', ...fs.readdirSync(path.join(root, 'features')).filter((f) => f.endsWith('.js')).map((f) => `features/${f}`)];
// Tables and generated labels reach t() through variables, not literal arguments.
const tableWords = [
  ...Object.values(PET.DECOR).map((item) => item.name), ...Object.values(PET.HABITATS),
  ...['ultra', 'canvas', 'moodle'].flatMap((site) => P.list(site).map((p) => p.label)),
  ...fromJs(read('lib/lookparts.js'), /\badd\s*\(/g),
  ...Object.values(XP.KIND_WORD), ...Object.values(XE.NAMES),
  ...BG.EXAMPLES.map(([, label]) => label), ...BG.KINDS.map(([, label]) => label), ...BG.PRESETS.map(([label]) => label), ...BG.MEDIA_KINDS.map(([, label]) => label), ...BG.MEDIA_FITS.map(([, label]) => label),
  ...Object.values(M.MOMENTS), ...Object.values(M.EVENTS), ...Object.values(M.KEYS).map(([label]) => label),
  ...[M.ENTER, ...Object.values(M.PRESETS)].flatMap((ps) => Object.values(ps).map(([label]) => label)),
  ...[...MX.SHAPES, ...MX.KINDS, ...MX.CURSORS, ...Object.keys(MX.EASES), ...XP.BLENDS].map(X.tokenName),
];
const used = new Set([
  ...tableWords,
  ...fromJs(read('lib/editor-xparts.js'), /\bheading\([^,]+,\s*/g),
  ...[...read('lib/editor-xparts.js').matchAll(/const (?:WIDGETS|ICONS|PLACES|GROUPS|ACTS|STYLE|SHADOWS) = ([^\n]+);/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((s) => s[1])),
  // Shader diagnostics are translated when the editor groups them by line.
  ...fromJs(read('lib/glsl.js'), /\b(?:e\([^,]+,|bad\(|message:)\s*/g),
  ...fromJs(read('lib/scene.js'), /\bmessage:\s*/g),
  ...['sharing/quick.html', 'options.html', 'popup.html'].flatMap((f) => fromHtml(read(f))),
  ...JS.flatMap((f) => fromJs(read(f))),
  // A mod bundle's refusals are translated by the editor's t(error.why, error.vars) (lib/editor-mods.js).
  ...fromJs(read('lib/modbundle.js'), /\bfail\(/g),
  // Import failures are translated by the editor's t(error.message).
  ...['lib/petsprites.js', 'lib/petlibrary.js'].flatMap((f) => [...read(f).matchAll(/(?:Error|error)\('([^']+)'\)/g)].map((m) => m[1])),
  ...D.GZ_COLORS.map(([, label]) => label),
  ...D.GZ_TABS.map(([, label]) => label),
  ...D.GZ_CONTRAST(D.GZ_DEFAULTS.colors).map((r) => r.label),
  ...Object.values(N.NOTES).flat(),
]);
const keys = new Set(Object.values(LANGS).flatMap((c) => Object.keys(c)));
const vars = (s) => new Set([...s.matchAll(/\{(\w+)(?:\|lower)?\}/g)].map((m) => m[1]));

test('coverage reads t and tr calls, including member calls and conditional keys', () => {
  assert.deepEqual(fromJs(`t('A'); tr ('B'); X.tr("C"); ctx.t(kind === 'items' ? 'D' : 'E', { n: 2 }); tr(label);`), ['A', 'B', 'C', 'D', 'E']);
});

test('every language has every key, and nothing else', () => {
  assert.deepEqual(Object.keys(LANGS).sort(), ['de', 'es', 'fr', 'nl', 'pt-BR']);
  for (const [lang, cat] of Object.entries(LANGS)) {
    for (const k of keys) assert.ok(k in cat, `${lang} is missing "${k}"`);
    for (const k of used) assert.ok(k in cat, `${lang} is missing "${k}"`);
  }
});

test('every key is still used', () => {
  const src = squash([...JS, 'lib/modbundle.js', 'lib/lookx.js', 'lib/grades.js', 'lib/gradecalc.js', 'lib/share.js', 'lib/i18n.js', 'lib/news.js', 'lib/fonts.js', 'defaults.js', 'options.html', 'popup.html', 'sharing/quick.html'].map(read).join(' '));
  for (const k of keys) assert.ok(used.has(k) || src.includes(k), `"${k}" is in no source file`);
});

test('translations keep their placeholders, and counts have an other form', () => {
  for (const [lang, cat] of Object.entries(LANGS)) {
    for (const [k, v] of Object.entries(cat)) {
      const want = vars(k);
      for (const form of typeof v === 'string' ? [v] : (assert.ok(v.other, `${lang}: "${k}" has no other form`), Object.values(v))) {
        assert.ok(form.trim(), `${lang}: "${k}" is empty`);
        const got = vars(form);
        assert.deepEqual([...got].filter((x) => !want.has(x)), [], `${lang}: "${form}" has a placeholder "${k}" doesn't`);
        assert.deepEqual([...want].filter((x) => (x !== 'n' || typeof v === 'string') && !got.has(x)), [], `${lang}: "${form}" drops a placeholder of "${k}"`);
      }
    }
  }
  for (const [k, v] of Object.entries(I.EN)) assert.equal(v.other, k);
});

test('every catalogue is loaded wherever Glaze speaks', () => {
  // On the LMS, only the page's own, on demand (content.js words(), lib/background.js LOADABLE); the extension's
  // pages have them all.
  const content = require('../manifest.json').content_scripts.flatMap((c) => c.js);
  assert.deepEqual(I.CODES, files.map((f) => f.replace(/\.js$/, '')), 'GZ_I18N.CODES lists i18n/');
  for (const f of files) {
    assert.ok(!content.includes(`i18n/${f}`), `manifest: i18n/${f} loads on demand, not with every page`);
    assert.ok(read('lib/background.js').includes(`'i18n/${f}'`), `lib/background.js LOADABLE: i18n/${f}`);
    for (const page of ['options.html', 'popup.html', 'sharing/quick.html']) assert.ok(read(page).includes(`<script src="${page.startsWith('sharing/') ? '../' : ''}i18n/${f}"></script>`), `${page}: i18n/${f}`);
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

test('Look part descriptions use singular and plural catalogue forms', () => {
  for (const key of ['{name}: {n} layers.', 'Layers {n} animated backgrounds.', 'Changes {n} animations.', 'Plays effects for {n} events.', 'Changes how {n} parts of your school pages look.']) {
    for (const lang of I.CODES) {
      const cat = LANGS[lang];
      for (const n of [1, 2]) {
        const form = n === 1 ? cat[key].one : cat[key].other;
        assert.equal(I.t(key, { n, name: 'Example' }, lang), form.replace('{n}', String(n)).replace('{name}', 'Example'));
      }
    }
  }
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
    const keys = [...read(`i18n/${f}`).matchAll(/^\s*(['"])((?:(?!\1)[^\\]|\\.)+)\1\s*:/gm)].map((m) => m[2].replace(/\\(.)/g, '$1'));
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dup, [], `${f} repeats ${dup.join(', ')}`);
  }
});

test('widget labels distinguish the 4.0 GPA from an ordinary grade average', () => {
  for (const cat of Object.values(LANGS)) {
    assert.match(cat['GPA (4.0 scale)'], /GPA/);
    assert.match(cat['Grades — shows your grades and GPA, on this device only.'], /GPA/);
  }
  assert.equal(LANGS.nl['Today’s to-dos by time'], 'Taken van vandaag, gesorteerd op tijd');
  assert.ok(LANGS.nl['Your widgets are signed with it, and only it can update them for people you shared them with. Keep a backup: a lost key means no more updates.'].includes('alleen daarmee'));
});
