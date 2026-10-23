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

  test(`${lang}: the release notes are this version's own "new in" block, for AMO and Apple alike`, async () => {
    const { readListings } = await load();
    const { firefox, apple, chrome } = readListings(real, version)[lang];
    assert.ok(firefox.notes.startsWith('• '), firefox.notes.slice(0, 40));
    assert.ok(chrome.description.includes(firefox.notes), 'the block is taken from the listing as written');
    assert.ok(!/\n\n/.test(firefox.notes), 'it stops at the next heading');
    assert.equal(apple.whatsNew, firefox.notes, 'this version has no bullet that belongs to one browser');
    assert.ok(firefox.notes.length <= 3000 && apple.whatsNew.length <= 4000);
  });

  test(`${lang}: AMO keeps the summary, and a description without the older release blocks that fits its 15,000`, async () => {
    const { readListings } = await load();
    const { firefox, chrome } = readListings(real, version)[lang];
    assert.equal(firefox.summary, chrome.summary);
    assert.ok(firefox.description.length <= 15000, `${firefox.description.length} characters`);
    assert.ok(firefox.description.includes(firefox.notes), 'the current block stays');
    const headings = chrome.description.split('\n').filter((line) => /\s\d+\.\d+(?:\.\d+)?$/.test(line));
    assert.ok(headings.length > 1);
    for (const heading of headings.slice(1)) assert.ok(!firefox.description.includes(`\n${heading}\n`), heading);
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

test('English App Store text is the copy live on the store, not a new one', async () => {
  const { readListings } = await load();
  const { apple } = readListings(real, version).en;
  assert.equal(apple.name, 'Glaze for Safari');
  assert.equal(apple.subtitle, 'Your courses, your colors');
  assert.equal(apple.description.length, 3310);
  assert.match(apple.description, /^Make Blackboard Ultra, Canvas and Moodle feel like your own study space\. Glaze is a Safari extension/);
  assert.equal(apple.keywords, 'blackboard,canvas,moodle,dark mode,themes,student,grades,notes,planner,study,safari,extension');
});

test('AMO and Apple filter browser-labelled bullets; Chrome keeps the full listing', async () => {
  const { readListings } = await load();
  const de = real('store/listing-de.md'), fr = real('store/listing-fr.md');
  const block = (text, heading, bullets) => text.replace(`${heading}\n\n`, `${heading}\n\n${bullets}\n`);
  const listings = readListings(readWith({
    'store/listing-de.md': block(de, `NEU IN ${version}`, '• Chrome: nur Chrome.\n• Firefox: nur Firefox.\n• Safari: nur Safari.'),
    'store/listing-fr.md': block(fr, `NOUVEAUTÉS DE LA VERSION ${version}`, '• Safari : seulement Safari.'),
  }), version);
  const { firefox, apple, chrome } = listings.de;
  assert.ok(chrome.description.includes('• Chrome: nur Chrome.'), 'Chrome text is the listing exactly');
  assert.ok(chrome.description.includes('• Firefox: nur Firefox.') && chrome.description.includes('• Safari: nur Safari.'), 'the Chrome paste kit retains the other browser labels too');
  assert.ok(firefox.notes.includes('nur Firefox') && !firefox.notes.includes('nur Chrome') && !firefox.notes.includes('nur Safari'));
  assert.ok(apple.whatsNew.includes('nur Safari') && !apple.whatsNew.includes('nur Chrome') && !apple.whatsNew.includes('nur Firefox'));
  assert.ok(firefox.notes.includes('Frostdev') && apple.whatsNew.includes('Frostdev'), 'unlabelled bullets go everywhere');
  assert.ok(!listings.fr.firefox.notes.includes('seulement Safari') && listings.fr.apple.whatsNew.includes('seulement Safari'), 'French spacing before the colon');
});

test('a language without this version\'s block stops the release before anything is built', async () => {
  const { readListings } = await load();
  const nl = real('store/listing-nl.md').replace(`NIEUW IN ${version}`, 'NIEUW IN 3.3.7');
  assert.throws(() => readListings(readWith({ 'store/listing-nl.md': nl }), version), (error) => {
    assert.match(error.message, new RegExp(`store/listing-nl\\.md: no "NIEUW IN ${version.replace(/\./g, '\\.')}" block`));
    return true;
  });
  assert.throws(() => readListings(real, '9.9.9'), /no "NEW IN 9\.9\.9" block/);
});

test('every problem is named at once, with the store limit it breaks', async () => {
  const { readListings } = await load();
  const en = real('store/app-store.md').replace('Your courses, your colors', 'Your courses, your colors, your Chrome');
  const es = real('store/listing-es.md').replace(/(## Short summary[^\n]*\n\n)[^\n]+/, `$1${'x'.repeat(140)}`);
  assert.throws(() => readListings(readWith({ 'store/app-store.md': en, 'store/listing-es.md': es }), version), (error) => {
    assert.match(error.message, /store\/app-store\.md: subtitle is 38 characters; the App Store allows 30/);
    assert.match(error.message, /store\/app-store\.md: subtitle names another browser \(Chrome\)/);
    assert.match(error.message, /store\/listing-es\.md: short summary is 140 characters; the Chrome Web Store allows 132/);
    return true;
  });
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-dry-run-'));
  const { privateKey } = require('node:crypto').generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  fs.writeFileSync(path.join(dir, 'k.p8'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const config = path.join(dir, 'stores.env');
  fs.writeFileSync(config, 'AMO_JWT_ISSUER=user:1:2\nAMO_JWT_SECRET=amo-secret\nASC_KEY_PATH=k.p8\nASC_KEY_ID=KEY123\nASC_ISSUER_ID=issuer-uuid\n');
  const kit = path.join(root, 'release', version, 'chrome-web-store', 'listing-de.txt'), kitBefore = fs.existsSync(kit) && fs.statSync(kit).mtimeMs;
  const answers = [
    [/addons\.mozilla\.org\/api\/v5\/addons\/addon\/glaze@frostdev\.io\/$/, { summary: { 'en-US': listings.en.firefox.summary }, description: {} }],
    [/addons\.mozilla\.org\/.*\/versions\//, null],
    [/\/v1\/apps\?filter\[bundleId\]=/, { data: [{ id: 'app-1' }] }],
    [/\/v1\/apps\/app-1\/appStoreVersions\?filter\[platform\]=MAC_OS&filter\[versionString\]=/, { data: [] }],
    [/\/v1\/apps\/app-1\/appStoreVersions\?filter\[platform\]=MAC_OS&limit=20$/, { data: [{ id: 'ver-live', attributes: { appVersionState: 'READY_FOR_DISTRIBUTION' } }] }],
    [/\/v1\/apps\/app-1\/appInfos$/, { data: [{ id: 'info-live', attributes: { state: 'READY_FOR_DISTRIBUTION' } }] }],
    [/\/v1\/appInfos\/info-live\/appInfoLocalizations/, { data: [{ id: 'ail-en', attributes: { locale: 'en-US', name: 'Glaze for Safari', subtitle: 'Your courses, your colors' } }] }],
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
  assert.match(output, new RegExp(`^Chrome de: paste kit write \\(release/${version.replace(/\./g, '\\.')}/chrome-web-store/listing-de\\.txt\\)$`, 'm'));
  assert.match(output, /^Firefox en-US: description add, release notes add$/m);
  assert.match(output, /^Firefox pt-BR: summary add, description add, release notes add$/m);
  assert.match(output, /^Apple MAC_OS en-US: What's New change$/m);
  assert.match(output, /^Apple MAC_OS de-DE: name create, subtitle create, description create, keywords create, promotional text create, What's New create, screenshots en-US's until de-DE has its own$/m);
  assert.equal(fs.existsSync(kit) && fs.statSync(kit).mtimeMs, kitBefore, 'the paste kit is not written by a dry run');
});
