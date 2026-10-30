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
const PTR = require('../lib/editor-pointer.js');
const XE = require('../lib/editor-xparts.js');
const PET = require('../lib/pet.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const LANGS = globalThis.GZ_LANGS;
const files = fs.readdirSync(path.join(root, 'i18n'));
const squash = (s) => s.replace(/\s+/g, ' ').trim();
// The code Glaze ships to a browser (not the catalogues, which every key appears in, nor the tests).
const CODE = [...fs.readdirSync(root).filter((f) => /\.(js|html)$/.test(f)), ...['lib', 'lib/mcp', 'features', 'sharing'].flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => /\.(js|html)$/.test(f)).map((f) => `${d}/${f}`))];
// Preserve quoted URLs while dropping comments; literal tables are evidence for dynamic callers, not proof of reachability.
const withoutComments = (js) => js.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, q) => q ? m : ' ');
const literalsOf = (js) => [...withoutComments(js).matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].filter((m) => !m[2].includes('${')).map((m) => m[2].replace(/\\(.)/g, '$1'));

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
  js = withoutComments(js);
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
const JS = ['sharing/quick.js', 'lib/mcp/approve-page.js', 'features/welcome.js', 'lib/sessions-ui.js', 'content.js', 'content-ultra.js', 'content-canvas.js', 'options.js', 'popup.js', 'ui.js', 'lib/page.js', 'lib/petlibrary.js', 'lib/petsprites.js', 'lib/todo.js', 'lib/ultra.js', 'lib/editor-x.js', 'lib/editor-xbg.js', 'lib/editor-xmotion.js', 'lib/editor-pointer.js', 'lib/editor-xparts.js', 'lib/editor-mods.js', 'lib/editor-widget.js', 'lib/editor-navbar.js', 'lib/editor-ai.js', 'lib/editor-writer.js', 'lib/parts.js', 'lib/lookparts.js', ...fs.readdirSync(path.join(root, 'features')).filter((f) => f.endsWith('.js')).map((f) => `features/${f}`)];
// Glaze Writer's frame (writer.html, papers.html) and the libraries whose words it shows. lib/writer-docx.js's t() reads
// a run's marks, so only its warnings and refusals are words (below).
const WRITER = ['writer.js', 'papers.js', 'sheet-kind.js', 'sheet-grid.js', 'pdf-kind.js', 'slides-kind.js', ...fs.readdirSync(root).filter((f) => /^writer-.+\.js$/.test(f)), ...fs.readdirSync(path.join(root, 'lib')).filter((f) => /^writer-.+\.js$/.test(f) && f !== 'writer-docx.js').map((f) => `lib/${f}`)];
JS.push(...WRITER);
// The capitalised strings of a `const NAME = …;` table (its labels and messages, not its ids, CSS or numbers).
const tableOf = (f, ...names) => {
  const js = withoutComments(read(f));
  return names.flatMap((name) => {
    const at = js.indexOf(`const ${name} = `);
    assert.ok(at >= 0, `${f} has no table ${name}`);
    let i = at, depth = 0;
    for (let q = null; i < js.length; i++) {
      const c = js[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') q = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if ((c === ';' || c === '\n') && depth === 0 && i > at + name.length + 9) break;
    }
    return literalsOf(js.slice(at, i)).filter((s) => /^\p{Lu}/u.test(s));
  });
};
const writerWords = [
  ...tableOf('writer.js', 'LABELS'), ...tableOf('writer-cite.js', 'TYPES', 'FIELDS'), ...tableOf('writer-ai.js', 'STATUS'),
  ...tableOf('writer-submit.js', 'SAYS'), ...tableOf('writer-proof.js', 'LABEL'),
  ...tableOf('writer-paper.js', 'SPACING', 'KIND', 'STYLES', 'REASONS'), ...tableOf('lib/writer-format.js', 'ROWS', 'names'),
  ...tableOf('lib/ai/tasks/writer-feedback.js', 'GRADE_REASONS'), ...tableOf('lib/ai/failure.js', 'REASONS', 'ERRORS'),
  // Labels handed to the paper chrome's helpers, which translate them.
  ...fromJs(read('writer-paper.js'), /\b(?:mark\('\w+',|row\(|setState\()\s*/g),
  ...[...read('writer-paper.js').matchAll(/\['\w+', '([A-Z][^']*)'\]/g)].map((m) => m[1]),
  // Format messages (the frame translates each issue's key) and the list titles they name.
  ...fromJs(read('lib/writer-format.js'), /\badd\('\w+',\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*/g),
  ...Object.values(require('../lib/writer-styles.js').FORMATS).map((f) => f.list.title), ...Object.values(require('../lib/writer-cite.js').TITLES),
  // .docx import warnings and the refusals worded for students.
  ...[...read('lib/writer-docx.js').matchAll(/\b(?:warn|RangeError)\('((?:[^'\\]|\\.)+)'\)/g)].map((m) => m[1].replace(/\\(.)/g, '$1')).filter((s) => /^[A-Z]/.test(s)),
];
// Tables and generated labels reach t() through variables, not literal arguments.
const tableWords = [
  ...Object.values(PET.DECOR).map((item) => item.name), ...Object.values(PET.HABITATS),
  ...['ultra', 'canvas', 'moodle'].flatMap((site) => P.list(site).map((p) => p.label)),
  ...fromJs(read('lib/lookparts.js'), /\badd\s*\(/g),
  ...Object.values(XP.KIND_WORD), ...Object.values(XE.NAMES),
  ...BG.EXAMPLES.map(([, label]) => label), ...BG.KINDS.map(([, label]) => label), ...BG.PRESETS.map(([label]) => label), ...BG.MEDIA_KINDS.map(([, label]) => label), ...BG.MEDIA_FITS.map(([, label]) => label),
  ...Object.values(M.MOMENTS), ...Object.values(M.EVENTS), ...Object.values(M.KEYS).map(([label]) => label),
  ...[M.ENTER, ...Object.values(M.PRESETS)].flatMap((ps) => Object.values(ps).map(([label]) => label)),
  ...[...MX.SHAPES, ...MX.MARKS, ...MX.KINDS, ...MX.CURSORS, ...Object.keys(MX.EASES), ...XP.BLENDS].map(X.tokenName),
  ...Object.values(M.POINTERS), ...Object.values(M.TYPES), ...Object.values(PTR.NAMES),
  // Ultra's own gradebook categories, named in the what-if calculator (features/grades.js).
  ...Object.values(require('../lib/gradecalc.js').ULTRA_CATS),
];
const used = new Set([
  ...tableWords, ...writerWords,
  ...fromJs(read('lib/editor-xparts.js'), /\bheading\([^,]+,\s*/g),
  ...[...read('lib/editor-xparts.js').matchAll(/const (?:WIDGETS|ICONS|PLACES|GROUPS|ACTS|STYLE|SHADOWS) = ([^\n]+);/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((s) => s[1])),
  // Shader diagnostics are translated when the editor groups them by line.
  ...fromJs(read('lib/glsl.js'), /\b(?:e\([^,]+,|bad\(|message:)\s*/g),
  ...fromJs(read('lib/scene.js'), /\bmessage:\s*/g),
  ...['sharing/quick.html', 'lib/mcp/approve.html', 'options.html', 'popup.html', 'features/welcome.html'].flatMap((f) => fromHtml(read(f))),
  ...JS.flatMap((f) => fromJs(read(f))),
  // Helpers that translate their own label argument (t() inside add() and check()).
  ...fromJs(read('features/docreview.js'), /\badd\('button',\s*[^,]+,\s*/g),
  ...fromJs(read('lib/editor-navbar.js'), /\bcheck\(/g),
  // A mod bundle's refusals are translated by the editor's t(error.why, error.vars) (lib/editor-mods.js).
  ...fromJs(read('lib/modbundle.js'), /\bfail\(/g),
  // Import failures are translated by the editor's t(error.message).
  ...['lib/petsprites.js', 'lib/petlibrary.js'].flatMap((f) => [...read(f).matchAll(/(?:Error|error)\('([^']+)'\)/g)].map((m) => m[1])),
  ...D.GZ_COLORS.map(([, label]) => label),
  ...D.GZ_TABS.map(([, label]) => label),
  ...D.GZ_SIDEBAR_KINDS.map(([, label]) => label),
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
  // A key is used when it is a whole string literal somewhere in the shipped code (a table, a helper's label, a
  // page), not when its text happens to occur inside a longer string: "Extras" is inside many sentences.
  const literals = new Set(CODE.flatMap((f) => literalsOf(read(f).replace(/<!--[\s\S]*?-->/g, ''))));
  for (const k of keys) assert.ok(used.has(k) || literals.has(k), `"${k}" is in no t() or tr() call, page or table`);
});

test('review: stale-key evidence ignores comments and substrings but retains dynamic table literals', () => {
  const source = `const labels = { a: 'Live', b: "Canvas" }; t(labels[k]); // 'Stale'
    /* t('Also stale') */ t('Live longer'); const url = 'https://school.test/';`;
  const literals = new Set(literalsOf(source));
  assert.ok(literals.has('Live') && literals.has('Canvas') && literals.has('https://school.test/'));
  assert.ok(!literals.has('Stale') && !literals.has('Also stale') && !literals.has('longer'));
  assert.deepEqual(fromJs(source), ['Live longer']);
});

test('no shipped file points at a DECISIONS.md the repo does not have', () => {
  // A comment that cites a file the repo lacks sends the reader nowhere: say what it means instead.
  for (const f of [...CODE, ...files.map((x) => `i18n/${x}`), 'test/gcal.test.js', 'test/gradecalc-parity.test.js']) assert.ok(!read(f).includes('DECISIONS.md'), `${f} cites DECISIONS.md`);
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

test('every count key has English singular and plural forms', () => {
  // English is the key itself, so a count key with no EN entry prints its plural for every number: "1 fonts".
  const counts = new Set(Object.values(LANGS).flatMap((cat) => Object.keys(cat).filter((k) => typeof cat[k] === 'object')));
  for (const k of counts) {
    assert.ok(I.EN[k]?.one && I.EN[k]?.other, `lib/i18n.js EN has no singular and plural for "${k}"`);
  }
  assert.equal(I.t('{n} fonts', { n: 1 }), '1 font');
  assert.equal(I.t('{n} fonts', { n: 2 }), '2 fonts');
  assert.equal(I.t('Changes {n} animations.', { n: 1 }), 'Changes 1 animation.');
  assert.equal(I.t('{name}: {n} layers.', { n: 1, name: 'Sky' }), 'Sky: 1 layer.');
});

test('review: one card style still applies to all unstyled cards', () => {
  assert.equal(I.t('{n} card styles from a theme take turns on the cards that have no style of their own.', { n: 1 }), '1 card style from a theme takes turns on the cards that have no style of their own.');
});

test('review: all English count forms select one only for one and preserve interpolation and locale fallback', () => {
  const fill = (text, values, loc) => text.replace(/\{(\w+)\}/g, (_, k) => typeof values[k] === 'number' ? new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(values[k]) : values[k]);
  for (const [key, forms] of Object.entries(I.EN)) for (const n of [0, 1, 2, 1.5, 1234]) {
    const values = { n, done: 1, got: 1, pct: '50%', name: 'Sky', parts: 'Header', fonts: 'Inter' };
    const expected = forms[n === 1 ? 'one' : 'other'];
    for (const loc of ['en', 'en-GB', 'ja', 'invalid tag']) assert.equal(I.t(key, values, loc), fill(expected, values, loc.startsWith('en') ? loc : 'en'), `${key} n=${n} ${loc}`);
  }
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
  for (const key of ['{name}: {n} layers.', 'Layers {n} animated backgrounds.', 'Changes {n} animations.', 'Plays effects for {n} events.', 'Hides {n} parts of your school pages: {parts}.', 'Makes {n} parts of your school pages see-through: {parts}.', 'Changes how {n} parts of your school pages look: {parts}.']) {
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

// The stores take the name and summary from the manifest. The name says what Glaze is for ("for Canvas, Blackboard & Moodle"),
// never that it belongs to them; toolbars and menus show the short name.
test('the manifest name and description are localized and fit the stores', () => {
  const m = require('../manifest.json');
  assert.equal(m.name, '__MSG_name__');
  assert.equal(m.default_locale, 'en');
  assert.equal(m.short_name, 'Glaze');
  assert.equal(m.action.default_title, 'Glaze');
  assert.equal(m.description, '__MSG_description__');
  const dirs = fs.readdirSync(path.join(root, '_locales')).sort();
  assert.deepEqual(dirs, ['de', 'en', 'es', 'fr', 'nl', 'pt_BR']);
  const FOR = { de: 'für', es: 'para', fr: 'pour', nl: 'voor', pt_BR: 'para' };
  for (const d of dirs) {
    const msgs = JSON.parse(read(`_locales/${d}/messages.json`));
    assert.deepEqual(Object.keys(msgs), ['name', 'description'], d);
    const name = msgs.name.message;
    assert.ok(name.length <= 75, `${d}: Chrome Web Store allows 75 characters in a name (${name.length})`);
    assert.match(name, /^Glaze ?: /, d);
    for (const site of ['Canvas', 'Blackboard', 'Moodle']) assert.ok(name.includes(site), `${d}: ${site}`);
    assert.ok(name.split(' ').includes(FOR[d] || 'for'), `${d}: "${FOR[d] || 'for'}" keeps the sites as what Glaze works with`);
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
  assert.match(LANGS.nl['Only this key can update the widgets you share; keep a backup of it.'], /alleen/);
});
