// scripts/store-listings.mjs: each store's listing text in six languages, read from store/ and checked before a release
// builds or sends anything. The fixtures are the listings in the repository, for the manifest's version.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const real = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const version = JSON.parse(real('manifest.json')).version;
const load = () => import('../scripts/store-listings.mjs');
const LANGS = ['en', 'de', 'es', 'fr', 'nl', 'pt-BR'];
const listingFile = (lang) => `store/listing${lang === 'en' ? '' : `-${lang}`}.md`;
const appStoreFile = (lang) => `store/app-store${lang === 'en' ? '' : `-${lang}`}.md`;
const section = (text, heading) => text.split(`\n## ${heading}`)[1].replace(/^[^\n]*\n\n/, '').split(/\n## /)[0].trim();
// A reader that changes one file and leaves the rest as committed.
const readWith = (changes) => (file) => (file in changes ? changes[file] : real(file));

test('six languages, each with its AMO and App Store locale code', async () => {
  const { readListings } = await load();
  const listings = readListings(real, version);
  assert.deepEqual(Object.keys(listings), LANGS);
  assert.deepEqual(LANGS.map((l) => listings[l].amoLocale), ['en-US', 'de', 'es-ES', 'fr', 'nl', 'pt-BR']);
  assert.deepEqual(LANGS.map((l) => listings[l].appleLocale), ['en-US', 'de-DE', 'es-ES', 'fr-FR', 'nl-NL', 'pt-BR']);
});

for (const lang of LANGS) {
  test(`${lang}: Chrome gets the listing's short summary and description exactly`, async () => {
    const { readListings } = await load();
    const { chrome } = readListings(real, version)[lang];
    const text = real(listingFile(lang));
    assert.equal(chrome.summary, section(text, 'Short summary'));
    assert.equal(chrome.description, section(text, 'Detailed description'));
  });

  test(`${lang}: the release notes are this version's own "new in" block in ## Release notes, with each browser's bullet in its own store's notes`, async () => {
    const { readListings } = await load();
    const { firefox, apple, chrome } = readListings(real, version)[lang];
    assert.ok(firefox.notes.startsWith('• '), firefox.notes.slice(0, 40));
    assert.ok(section(real(listingFile(lang)), 'Release notes').includes(firefox.notes), 'the block is taken from the listing as written');
    assert.ok(!chrome.description.includes(firefox.notes), 'and is not in the description');
    assert.ok(!/\n\n/.test(firefox.notes), 'it stops at the next heading');
    assert.ok(!/^•\s*(?:Chrome|Safari)\s*:/m.test(firefox.notes), 'no other browser\'s bullet on AMO');
    assert.ok(!/^•\s*(?:Chrome|Firefox)\s*:/m.test(apple.whatsNew), 'no other browser\'s bullet on the App Store');
    // 4.0.0's Agents bullet is AMO's alone: the App Store build has no Agents, and Chrome has no notes field.
    const firefoxOnly = (line) => /^•\s*Firefox\s*:/.test(line);
    assert.equal(apple.whatsNew, firefox.notes.split('\n').filter((line) => !firefoxOnly(line)).join('\n'), 'Apple gets AMO\'s notes without their Firefox bullets');
    assert.ok(firefox.notes.split('\n').some((line) => firefoxOnly(line) && /\bAgent(?:s|en|es)\b/.test(line)), 'Agents is in AMO\'s notes, labelled Firefox');
    const agents = /\bagent(?:e|s|en|es)?\b|glaze-mcp|\bMCP\b/i;
    for (const field of ['whatsNew', 'description', 'promotionalText', 'keywords']) assert.doesNotMatch(apple[field], agents, `no Agents in the App Store ${field}`);
    assert.ok(firefox.notes.length <= 3000 && apple.whatsNew.length <= 4000);
  });

  test(`${lang}: AMO keeps the summary, and the description with Firefox's privacy, within its 15,000`, async () => {
    const { readListings } = await load();
    const { firefox, chrome } = readListings(real, version)[lang];
    assert.equal(firefox.summary, chrome.summary);
    assert.ok(firefox.description.length <= 15000, `${firefox.description.length} characters`);
    const privacy = section(real(`store/firefox${lang === 'en' ? '' : `-${lang}`}.md`), 'Privacy');
    const [before, after] = chrome.description.split(/\n\n(?:PRIVACY|DATENSCHUTZ|PRIVACIDAD|CONFIDENTIALITÉ|PRIVACIDADE)\n\n[^\n]+/);
    assert.ok(firefox.description.startsWith(before) && firefox.description.endsWith(after) && firefox.description.includes(privacy));
    assert.ok(!/^•\s*Safari\s*:/m.test(firefox.description), 'a Safari-only bullet is not Firefox copy');
    assert.ok(!/[*_`]|^\s*(?:#|>|[-+] |\d+\. )/m.test(firefox.description), 'no Markdown that AMO would render differently');
  });

  test(`${lang}: the App Store text is its own, translated, within Apple's limits and names no other browser`, async () => {
    const { readListings } = await load();
    const listings = readListings(real, version), { apple } = listings[lang];
    const limits = { name: 30, subtitle: 30, promotionalText: 170, keywords: 100, description: 4000 };
    for (const [field, max] of Object.entries(limits)) {
      assert.ok(apple[field], `${field} is set`);
      assert.ok(apple[field].length <= max, `${field}: ${apple[field].length} > ${max}`);
      assert.ok(!/\b(?:Chrome|Chromium|Firefox|Android|Microsoft Edge)\b/.test(apple[field]), field);
    }
    assert.ok(Buffer.byteLength(apple.keywords) <= 100, 'keywords fit in 100 bytes too');
    if (lang !== 'en') {
      for (const field of ['subtitle', 'promotionalText', 'keywords', 'description']) assert.notEqual(apple[field], listings.en.apple[field], `${field} is translated`);
      assert.equal(apple.description.split('\n\n').length, listings.en.apple.description.split('\n\n').length, 'same paragraphs as English');
    }
  });
}

// The stores list each version's notes on their own; a description is what Glaze does now.
for (const lang of LANGS) test(`${lang}: the description has no release notes or version history`, async () => {
  const { readListings } = await load();
  const { chrome, firefox } = readListings(real, version)[lang];
  const history = /^(?:NEW IN|FROM|NEU IN|AUS|NOVEDADES DE|DE|NOUVEAUTÉS DE LA VERSION|DE LA VERSION|NIEUW IN|UIT|NOVO NA|DA)\s+\d+\.\d+(?:\.\d+)?$/m;
  for (const text of [chrome.description, firefox.description]) {
    assert.doesNotMatch(text, history);
    assert.doesNotMatch(text, /^[^\n•]*\b\d+\.\d+(?:\.\d+)?\s*$/m, 'no heading ends in a version');
  }
  assert.doesNotMatch(real(listingFile(lang)), /^## What's new in/m);
});

test('a description with a release block stops the release, naming where notes go', async () => {
  const { readListings } = await load();
  for (const heading of ['NOVEDADES DE 3.4.2', 'NOVEDADES DE 3.4.2 ', 'Novedades de 3.4.2', '### De 3.4.2']) {
    const es = real('store/listing-es.md').replace('\nTU ASPECTO\n', `\n${heading}\n\n• Algo.\n\nTU ASPECTO\n`);
    assert.throws(() => readListings(readWith({ 'store/listing-es.md': es }), version), /store\/listing-es\.md: the detailed description has release notes .*; they go in ## Release notes/, heading);
  }
});

// Lead with the theme/platform terms. Put study tools in their supported-platform sentence,
// and retain the other useful search terms in the feature descriptions rather than stuffing the opening.
const SEARCH = {
  en: { summary: ['theme', 'dark mode'], detail: ['student', 'planner', 'to-do', 'GPA', 'colors', 'fonts', 'grades', 'notes', 'course tabs', 'LMS'] },
  de: { summary: ['Designs', 'Dunkelmodus'], detail: ['Studierende', 'Planer', 'To-do', 'Notendurchschnitt', 'Farben', 'Schriften', 'GPA', 'Noten', 'Notizen', 'Kurs-Tabs', 'LMS'] },
  es: { summary: ['tema', 'modo oscuro'], detail: ['estudiantes', 'agenda', 'tareas', 'promedio', 'colores', 'fuentes', 'GPA', 'calificaciones', 'notas', 'pestañas de cursos', 'LMS'] },
  fr: { summary: ['thème', 'mode sombre'], detail: ['étudiant', 'agenda', 'tâches', 'moyenne', 'couleurs', 'polices', 'GPA', 'notes', 'onglets de cours', 'LMS'] },
  nl: { summary: ['thema', 'donkere modus'], detail: ['studenten', 'planner', 'takenlijst', 'kleuren', 'lettertypen', 'GPA', 'cijfers', 'notities', 'cursustabbladen', 'LMS'] },
  'pt-BR': { summary: ['tema', 'modo escuro'], detail: ['estudantes', 'planner', 'tarefas', 'média', 'cores', 'fontes', 'GPA', 'notas', 'anotações', 'abas de cursos', 'LMS'] },
};
for (const lang of LANGS) test(`${lang}: search copy leads with themes and scopes study tools to Canvas and Blackboard`, async () => {
  const { readListings } = await load();
  const { chrome } = readListings(real, version)[lang];
  const opening = chrome.description.split('\n\n')[0];
  const has = (text, term) => text.toLowerCase().includes(term.toLowerCase());
  for (const text of [chrome.summary, opening]) {
    const [themes, study] = text.split('. ');
    for (const term of ['Canvas', 'Blackboard', 'Moodle', ...SEARCH[lang].summary]) assert.ok(has(themes, term), `themes: ${term}`);
    for (const term of ['Canvas', 'Blackboard', 'GPA']) assert.ok(has(study || '', term), `study: ${term}`);
    assert.doesNotMatch(study, /Moodle/, 'Moodle has no planner, GPA or Notes');
  }
  for (const term of SEARCH[lang].detail) assert.ok(has(chrome.description, term), `description: ${term}`);
  assert.ok(chrome.summary.indexOf('Canvas') < 20, 'the supported platforms appear early');
  const locale = JSON.parse(real(`_locales/${lang.replace('-', '_')}/messages.json`));
  assert.equal(locale.description.message, chrome.summary, 'the browser shows the store summary');
});

test('the App Store name and subtitle name no other company\'s product, in any language', async () => {
  for (const lang of LANGS) {
    const text = real(appStoreFile(lang));
    for (const field of ['Name', 'Subtitle']) assert.doesNotMatch(section(text, field), /Canvas|Blackboard|Moodle|Instructure|Anthology/i, `${lang} ${field}`);
  }
});

test('App Store keywords hold the platforms and repeat no word of the name or subtitle', async () => {
  const { readListings } = await load();
  const listings = readListings(real, version, ['apple']);
  for (const lang of LANGS) {
    const { name, subtitle, keywords } = listings[lang].apple;
    assert.doesNotMatch(keywords, /, /, `${lang}: no space after a comma`);
    const list = keywords.split(',');
    for (const site of ['canvas', 'blackboard', 'moodle']) assert.ok(list.includes(site), `${lang}: ${site}`);
    const normalize = (text) => text.normalize('NFC').toLowerCase().replace(/[-’']/g, '');
    const words = new Set(normalize(`${name} ${subtitle}`).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
    assert.equal(new Set(list.map(normalize)).size, list.length, `${lang}: keywords are unique`);
    for (const keyword of list) {
      assert.ok(keyword.trim() === keyword && keyword.length > 2, `${lang}: nonempty comma-separated terms`);
      for (const word of normalize(keyword).split(' ')) assert.ok(!words.has(word), `${lang}: "${word}" is already in the name or subtitle`);
    }
  }
});

test('English App Store copy keeps the generic name and subtitle, useful keywords and privacy disclosures', async () => {
  const { readListings } = await load();
  const { apple } = readListings(real, version).en;
  assert.equal(apple.name, 'Glaze: Course Themes & Planner');
  assert.equal(apple.subtitle, 'Dark mode, GPA, notes & to-do');
  assert.equal(apple.description, section(real('store/app-store.md'), 'Description'));
  assert.match(apple.description, /Glaze does not collect or sell your data\./);
  assert.match(apple.description, /^Make Blackboard Ultra, Canvas and Moodle feel like your own study space\. Glaze is a Safari extension/);
  assert.equal(apple.keywords, 'canvas,blackboard,moodle,student,grades,deadlines,study,school,college,homework,calendar,ultra,focus');
});

test('AMO and Apple filter browser-labelled bullets; Chrome keeps the full listing', async () => {
  const { readListings } = await load();
  const de = real('store/listing-de.md'), fr = real('store/listing-fr.md');
  const block = (text, heading, bullets) => text.replace(`${heading}\n\n`, `${heading}\n\n${bullets}\n`);
  const labelled = '• Chrome: nur Chrome.\n• Firefox: nur Firefox.\n• Safari: nur Safari.';
  const listings = readListings(readWith({
    'store/listing-de.md': block(block(de, `NEU IN ${version}`, labelled), 'CANVAS', labelled.replace(/nur/g, 'Beschreibung nur')),
    'store/listing-fr.md': block(fr, `NOUVEAUTÉS DE LA VERSION ${version}`, '• Safari : seulement Safari.'),
  }), version);
  const { firefox, apple, chrome } = listings.de;
  assert.ok(chrome.description.includes('• Chrome: Beschreibung nur Chrome.'), 'Chrome text is the listing exactly');
  assert.ok(chrome.description.includes('• Firefox: Beschreibung nur Firefox.') && chrome.description.includes('• Safari: Beschreibung nur Safari.'), 'the Chrome paste kit retains the other browser labels too');
  assert.ok(firefox.description.includes('Beschreibung nur Firefox') && !firefox.description.includes('Beschreibung nur Chrome') && !firefox.description.includes('Beschreibung nur Safari'), 'AMO filters the description too');
  assert.ok(firefox.notes.includes('nur Firefox') && !firefox.notes.includes('nur Chrome') && !firefox.notes.includes('nur Safari'));
  assert.ok(apple.whatsNew.includes('nur Safari') && !apple.whatsNew.includes('nur Chrome') && !apple.whatsNew.includes('nur Firefox'));
  assert.ok(firefox.notes.includes('Glaze Writer') && apple.whatsNew.includes('Glaze Writer'), 'unlabelled bullets go everywhere');
  assert.ok(!listings.fr.firefox.notes.includes('seulement Safari') && listings.fr.apple.whatsNew.includes('seulement Safari'), 'French spacing before the colon');
});

test('a language without this version\'s block stops the release before anything is built', async () => {
  const { readListings } = await load();
  const nl = real('store/listing-nl.md').replace(`NIEUW IN ${version}`, 'NIEUW IN 3.3.7');
  assert.throws(() => readListings(readWith({ 'store/listing-nl.md': nl }), version), (error) => {
    assert.match(error.message, new RegExp(`store/listing-nl\\.md: no "NIEUW IN ${version.replace(/\./g, '\\.')}" block in ## Release notes`));
    return true;
  });
  assert.throws(() => readListings(real, '9.9.9'), /no "NEW IN 9\.9\.9" block/);
});

test('every problem is named at once, with the store limit it breaks', async () => {
  const { readListings } = await load();
  const en = real('store/app-store.md').replace('Dark mode, GPA, notes & to-do', 'Dark mode, GPA, notes & to-do, your Chrome');
  const es = real('store/listing-es.md').replace(/(## Short summary[^\n]*\n\n)[^\n]+/, `$1${'x'.repeat(140)}`);
  assert.throws(() => readListings(readWith({ 'store/app-store.md': en, 'store/listing-es.md': es }), version), (error) => {
    assert.match(error.message, /store\/app-store\.md: subtitle is 42 characters; the App Store allows 30/);
    assert.match(error.message, /store\/app-store\.md: subtitle names another browser \(Chrome\)/);
    assert.match(error.message, /store\/listing-es\.md: short summary is 140 characters; the Chrome Web Store allows 132/);
    return true;
  });
  const missing = real('store/listing.md').replace(/## Detailed description\n[\s\S]*?(?=## Release notes)/, '');
  for (const stores of [['chrome', 'firefox', 'apple'], ['firefox']]) {
    assert.throws(() => readListings(readWith({ 'store/listing.md': missing, 'store/listing-es.md': es }), version, stores), (error) => {
      assert.match(error.message, /store\/listing\.md: description is missing/);
      assert.match(error.message, /store\/listing\.md: no PRIVACY paragraph/);
      assert.ok(!(error instanceof TypeError));
      return true;
    });
  }
});

test('only the selected stores\' sources are required', async () => {
  const { readListings } = await load();
  const missing = (file) => { if (file.startsWith('store/app-store')) throw new Error(`no ${file}`); return real(file); };
  assert.throws(() => readListings(missing, version), /app-store/);
  const listings = readListings(missing, version, ['chrome', 'firefox']);
  assert.equal(listings.de.apple, undefined);
  assert.ok(listings.de.firefox.notes);
});

test('App Store keyword limits count UTF-8 bytes before any store requests', async () => {
  const { readListings } = await load();
  const file = 'store/app-store-fr.md';
  const changed = real(file).replace(/(## Keywords[^\n]*\n\n)[^\n]+/, `$1${'é'.repeat(51)}`);
  assert.throws(() => readListings(readWith({ [file]: changed }), version, ['apple']), /keywords is 102 bytes; the App Store allows 100/);
});

test('App Store promotional text is optional in a source', async () => {
  const { readListings } = await load();
  const file = 'store/app-store-fr.md';
  const changed = real(file).replace(/## Promotional text[^\n]*\n[\s\S]*?(?=## Keywords)/, '');
  assert.equal(readListings(readWith({ [file]: changed }), version, ['apple']).fr.apple.promotionalText, undefined);
});

for (const lang of LANGS) test(`${lang}: Firefox privacy describes Firefox and excludes executable mod permissions`, async () => {
  const { readListings } = await load();
  const { firefox } = readListings(real, version, ['firefox'])[lang];
  assert.ok(!/\b(?:Chrome|Chromium|Safari|Microsoft Edge)\b/i.test(firefox.description), 'Firefox copy names another browser');
  const file = `store/firefox${lang === 'en' ? '' : `-${lang}`}.md`;
  const privacy = section(real(file), 'Privacy');
  assert.ok(firefox.description.includes(privacy), 'use the Firefox-specific privacy source');
  assert.ok(!/\bmod\b/i.test(privacy), 'Firefox runs no downloaded mod JavaScript');
});

test('the Chrome paste kit holds each language\'s exact summary and description, one file per language', async () => {
  const { readListings, writeChromeKit } = await load();
  const listings = readListings(real, version), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-kit-'));
  try {
    const files = writeChromeKit(dir, listings);
    assert.deepEqual(files.map((f) => path.basename(f)), LANGS.map((l) => `listing-${l}.txt`));
    for (const lang of LANGS) {
      const text = fs.readFileSync(path.join(dir, `listing-${lang}.txt`), 'utf8');
      assert.ok(text.includes(`\n${listings[lang].chrome.summary}\n`));
      assert.ok(text.includes(`\n${listings[lang].chrome.description}\n`));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the dry-run report has one line per store and language, naming only what would change', async () => {
  const { describeChanges } = await load();
  const lines = describeChanges([
    { store: 'Firefox', locale: 'en-US', field: 'summary', action: 'same' },
    { store: 'Firefox', locale: 'en-US', field: 'description', action: 'change' },
    { store: 'Firefox', locale: 'de', field: 'summary', action: 'same' },
    { store: 'Apple MAC_OS', locale: 'de-DE', field: 'name', action: 'create' },
    { store: 'Apple MAC_OS', locale: 'de-DE', field: "What's New", action: 'skip', detail: 'first release' },
  ]);
  assert.deepEqual(lines, [
    'Firefox en-US: description change',
    'Firefox de: unchanged',
    "Apple MAC_OS de-DE: name create, What's New skip (first release)",
  ]);
});

test('the listings command is a dry run: it reads the stores, prints what would change, and writes nothing', async () => {
  const { main } = await import('../scripts/store-release.mjs');
  const { readListings } = await load();
  const listings = readListings(real, version);
  // The command reads committed HEAD; a pending version bump in this checkout is not its selected source.
  const selectedVersion = JSON.parse(require('node:child_process').execFileSync('git', ['show', 'HEAD:manifest.json'], { cwd: root, encoding: 'utf8' })).version;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-dry-run-'));
  const { privateKey } = require('node:crypto').generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  fs.writeFileSync(path.join(dir, 'k.p8'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const config = path.join(dir, 'stores.env');
  fs.writeFileSync(config, 'AMO_JWT_ISSUER=user:1:2\nAMO_JWT_SECRET=amo-secret\nASC_KEY_PATH=k.p8\nASC_KEY_ID=KEY123\nASC_ISSUER_ID=issuer-uuid\n');
  const kit = path.join(root, 'release', selectedVersion, 'chrome-web-store', 'listing-de.txt'), kitBefore = fs.existsSync(kit) && fs.statSync(kit).mtimeMs;
  const answers = [
    [/addons\.mozilla\.org\/api\/v5\/addons\/addon\/glaze@frostdev\.io\/$/, { summary: { 'en-US': listings.en.firefox.summary }, description: {} }],
    [/addons\.mozilla\.org\/.*\/versions\//, null],
    [/\/v1\/apps\?filter\[bundleId\]=/, { data: [{ id: 'app-1' }] }],
    [/\/v1\/apps\/app-1\/appStoreVersions\?filter\[platform\]=MAC_OS&filter\[versionString\]=/, { data: [] }],
    [/\/v1\/apps\/app-1\/appStoreVersions\?filter\[platform\]=MAC_OS&limit=20$/, { data: [{ id: 'ver-live', attributes: { appVersionState: 'READY_FOR_DISTRIBUTION' } }] }],
    [/\/v1\/apps\/app-1\/appInfos$/, { data: [{ id: 'info-live', attributes: { state: 'READY_FOR_DISTRIBUTION' } }] }],
    [/\/v1\/appInfos\/info-live\/appInfoLocalizations/, { data: [{ id: 'ail-en', attributes: { locale: 'en-US', name: listings.en.apple.name, subtitle: listings.en.apple.subtitle } }] }],
    [/\/v1\/appStoreVersions\/ver-live\/appStoreVersionLocalizations/, { data: [{ id: 'loc-en', attributes: { locale: 'en-US', ...listings.en.apple, whatsNew: 'Older notes' } }] }],
  ];
  const calls = [], lines = [], original = { fetch: globalThis.fetch, log: console.log, error: console.error, exitCode: process.exitCode };
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    const hit = answers.find(([pattern]) => pattern.test(decodeURIComponent(String(url))));
    if (!hit) throw new Error(`unrouted ${url}`);
    return hit[1] ? new Response(JSON.stringify(hit[1])) : new Response('{"detail":"not found"}', { status: 404 });
  };
  console.log = console.error = (...args) => lines.push(args.join(' '));
  try {
    await main(['listings', '--config', config, '--apple-platforms', 'MAC_OS']);
  } finally {
    globalThis.fetch = original.fetch; console.log = original.log; console.error = original.error;
    var exitCode = process.exitCode; process.exitCode = original.exitCode;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const output = lines.join('\n');
  assert.notEqual(exitCode, 1, output);
  assert.ok(calls.length && calls.every((c) => c.startsWith('GET ')), calls.join('\n'));
  assert.match(output, new RegExp(`^Chrome de: paste kit write \\(release/${selectedVersion.replace(/\./g, '\\.')}/chrome-web-store/listing-de\\.txt\\)$`, 'm'));
  assert.match(output, /^Firefox en-US: description add, release notes add$/m);
  assert.match(output, /^Firefox pt-BR: summary add, description add, release notes add$/m);
  assert.match(output, /^Apple MAC_OS en-US: What's New change$/m);
  assert.match(output, /^Apple MAC_OS de-DE: name create, subtitle create, description create, keywords create, promotional text create, What's New create, screenshots en-US's until de-DE has its own$/m);
  assert.equal(fs.existsSync(kit) && fs.statSync(kit).mtimeMs, kitBefore, 'the paste kit is not written by a dry run');
});
