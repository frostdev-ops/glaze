const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const latest = read('CHANGELOG.md').split('## [3.3.6]')[1]?.split(/^## /m)[0] || '';

test('3.3.6 release claims keep typing effects private and the pointer choice out of codes', () => {
  assert.match(latest, /never read what you type/);
  assert.match(latest, /password, card or one-time-code/);
  assert.match(latest, /never put in a Look or a theme code/);
  assert.match(latest, /moves into the Look you're wearing, once/);
  assert.match(latest, /Safari: Settings opened inside/);
});

const fresh = {
  '': ['Chrome: Glaze asks at install', 'Firefox: Glaze asks at install', 'Moodle on moodlecloud.com', 'sketch of the course'],
  de: ['Chrome: Glaze fordert', 'Firefox: Glaze fordert', 'Moodle auf moodlecloud.com', 'Skizze des Kurses'],
  es: ['Chrome: Al instalarse', 'Firefox: Al instalarse', 'Moodle en moodlecloud.com', 'boceto del curso'],
  fr: ['Chrome : À l’installation', 'Firefox : À l’installation', 'Moodle sur moodlecloud.com', 'esquisse du cours'],
  nl: ['Chrome: Bij installatie', 'Firefox: Bij installatie', 'Moodle op moodlecloud.com', 'schets van de cursus'],
  'pt-BR': ['Chrome: Na instalação', 'Firefox: Na instalação', 'Moodle em moodlecloud.com', 'esboço do curso'],
};
for (const [lang, expected] of Object.entries(fresh)) test(`3.4.1 listing ${lang || 'en'} names both browsers' install access, MoodleCloud and the course sketch`, () => {
  const text = read(`store/listing${lang ? `-${lang}` : ''}.md`);
  const block = text.slice(text.indexOf('3.4.1\n')).split(/\n(?:FROM|AUS|DE|DE LA VERSION|UIT|DA) 3.3/)[0];
  for (const term of expected) assert.ok(block.includes(term), term);
});

const terms = {
  '': ['never read what you type', 'Look › Pointer', 'Safari: Settings'],
  de: ['lesen nie, was du tippst', 'Look › Mauszeiger', 'Safari: Die Einstellungen'],
  es: ['Nunca leen lo que escribes', 'Look › Puntero', 'Safari: la configuración'],
  fr: ['ne lisent jamais ce que vous tapez', 'Look › Pointeur', 'Safari : les réglages'],
  nl: ['lezen nooit wat je typt', 'Look › Aanwijzer', 'Safari: instellingen'],
  'pt-BR': ['nunca leem o que você digita', 'Look › Ponteiro', 'Safari: as configurações'],
};
for (const [lang, expected] of Object.entries(terms)) test(`3.3.6 listing ${lang || 'en'} keeps typing privacy, the pointer choice and the Safari fix`, () => {
  const text = read(`store/listing${lang ? `-${lang}` : ''}.md`);
  const block = text.slice(text.indexOf('3.3.6\n')).split(/\n(?:FROM|AUS|DE|DE LA VERSION|UIT|DA) 3.3/)[0];
  for (const term of expected) assert.ok(block.includes(term), term);
});

test('3.4.1 versions agree and the exact pure notes transform fits Apple', () => {
  assert.equal(JSON.parse(read('manifest.json')).version, '3.4.1');
  assert.equal(JSON.parse(read('safari/Glaze/Glaze Extension/Resources/manifest.json')).version, '3.4.1');
  // Extract only this synchronous reader. Do not import or execute the release command or its top-level operations.
  const script = read('scripts/store-release.mjs');
  const body = script.slice(script.indexOf('function notes(source) {'), script.indexOf('\nasync function build('));
  assert.ok(body.startsWith('function notes(source) {'));
  const notes = vm.runInNewContext(`(${body})`, {
    fs: { readFileSync: fs.readFileSync }, path,
    json: (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
    requireValue: (value) => { assert.ok(value); return value; },
  });
  const result = notes(root);
  assert.ok(result.length <= 4000, `${result.length} characters`);
  assert.match(result, /^Added\n/);
  assert.ok(result.length <= 3000, `AMO: ${result.length} characters`);
  assert.ok(!result.includes('## [3.3.8]'));
});

test('review: Step 4 copy discloses redirected Download all files in every language\'s 3.4.1 notes', () => {
  for (const file of ['PRIVACY.md', 'CHANGELOG.md', 'store/listing.md']) assert.match(read(file), /redirected files/i, file);
  for (const [lang, term] of Object.entries({ '': 'redirected files', de: 'Weitergeleitete Dateien', es: 'archivos redirigidos', fr: 'fichiers redirigés', nl: 'omgeleide bestanden', 'pt-BR': 'arquivos redirecionados' })) {
    const file = `store/listing${lang ? `-${lang}` : ''}.md`, text = read(file);
    const block = text.slice(text.indexOf('3.4.1\n')).split(/\n(?:FROM|AUS|DE|DE LA VERSION|UIT|DA) 3.3/)[0];
    assert.ok(block.toLowerCase().includes(term.toLowerCase()), `${file}: redirected file limit`);
  }
});
