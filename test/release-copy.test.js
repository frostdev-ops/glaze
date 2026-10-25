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
for (const [lang, expected] of Object.entries(fresh)) test(`3.4 listing ${lang || 'en'} names both browsers' install access, MoodleCloud and the course sketch`, () => {
  const text = read(`store/listing${lang ? `-${lang}` : ''}.md`);
  const block = text.slice(text.indexOf(' 3.4\n')).split(/\n(?:FROM|AUS|DE|DE LA VERSION|UIT|DA) 3.3/)[0];
  for (const term of expected) assert.ok(block.includes(term), term);
});

const settings = {
  '': ['\nFROM 3.4\n', 'More options', 'All settings', 'pet habitat', 'Automatic', 'Moodle: Density'],
  de: ['\nAUS 3.4\n', '„Weitere Optionen“', '„Alle Einstellungen“', 'Haustier-Zuhause', '„Automatisch“', 'Moodle: Dichte'],
  es: ['\nDE 3.4\n', '«Más opciones»', '«Todos los ajustes»', 'hábitat de la mascota', '«Automático»', 'Moodle: la densidad'],
  fr: ['\nDE LA VERSION 3.4\n', '« Plus d’options »', '« Tous les réglages »', 'habitat du compagnon', '« Automatique »', 'Moodle : la densité'],
  nl: ['\nUIT 3.4\n', '“Meer opties”', '“Alle instellingen”', 'huisdierverblijf', '“Automatisch”', 'Moodle: dichtheid'],
  'pt-BR': ['\nDA 3.4\n', '“Mais opções”', '“Todas as configurações”', 'habitat do mascote', '“Automática”', 'Moodle: densidade'],
};
for (const [lang, expected] of Object.entries(settings)) test(`3.4 listing ${lang || 'en'} keeps 3.4.2's regrouped settings, the habitat, Automatic course tabs and Moodle's density`, () => {
  const text = read(`store/listing${lang ? `-${lang}` : ''}.md`);
  const block = text.slice(text.indexOf(expected[0])).split(/\n(?:FROM|AUS|DE|DE LA VERSION|UIT|DA) 3.3/)[0];
  for (const term of expected) assert.ok(block.includes(term), term);
  assert.ok(!/(?:ten tabs|zehn Tabs|diez pestañas|dix onglets|tien tabbladen|dez abas)/.test(text), 'no settings editor in ten tabs');
});

const backup = {
  '': ['NEW IN 3.4.3', 'Look › Pointer', 'Custom pointer', 'Back up…', 'Restore…', 'Draft backup', 'Restoring Notes', 'Stop reading', 'narrow windows', 'signed-in account'],
  de: ['NEU IN 3.4.3', 'Look › Mauszeiger', '„Eigener Mauszeiger“', '„Sichern…“', '„Wiederherstellen…“', 'Entwurfssicherung', 'Wiederherstellen von Notizen', '„Lesen abbrechen“', 'schmale Fenster', 'angemeldet'],
  es: ['NOVEDADES DE 3.4.3', 'Look › Puntero', '«Puntero personalizado»', '«Hacer una copia…»', '«Restaurar…»', 'copia de borradores', 'restaurar las Notas', '«Dejar de leer»', 'ventanas estrechas', 'sesión iniciada'],
  fr: ['NOUVEAUTÉS DE LA VERSION 3.4.3', 'Look › Pointeur', '« Pointeur personnalisé »', '« Sauvegarder… »', '« Restaurer… »', 'sauvegarde de brouillon', 'Restaurer les Notes', '« Arrêter la lecture »', 'fenêtres étroites', 'compte connecté'],
  nl: ['NIEUW IN 3.4.3', 'Look › Aanwijzer', '“Eigen aanwijzer”', '“Back-up maken…”', '“Herstellen…”', 'Back-up van concepten', 'herstellen van Notities', '“Stoppen met lezen”', 'smalle vensters', 'ingelogd'],
  'pt-BR': ['NOVO NA 3.4.3', 'Look › Ponteiro', '“Ponteiro personalizado”', '“Fazer backup…”', '“Restaurar…”', 'backup de rascunhos', 'Restaurar as Notas', '“Parar a leitura”', 'janelas estreitas', 'conta conectada'],
};
for (const [lang, expected] of Object.entries(backup)) test(`3.4.3 listing ${lang || 'en'} names the pointer switch, one-file Back up and Restore, drafts, Notes, the schedule, narrow settings and mods' account`, () => {
  const text = read(`store/listing${lang ? `-${lang}` : ''}.md`);
  const block = text.slice(text.indexOf(expected[0])).split(/\n(?:FROM|AUS|DE|DE LA VERSION|UIT|DA) 3.4\n/)[0];
  for (const term of expected) assert.ok(block.includes(term), term);
  assert.ok(!/\b(?:CI|audit)\b/i.test(block), 'no internal process in store copy');
  assert.ok(!/(?:Export and import all your settings|Exportiere und importiere alle|Exporta e importa todos|Exportez et importez tous|Exporteer en importeer al|Exporte e importe todas)/.test(text), 'one-file backup replaces settings export');
  assert.ok(text.split(expected[3]).length > 2, 'the everywhere paragraph names Back up… too');
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

test('3.4.3 versions agree and the exact pure notes transform fits Apple', () => {
  assert.equal(JSON.parse(read('manifest.json')).version, '3.4.3');
  assert.equal(JSON.parse(read('safari/Glaze/Glaze Extension/Resources/manifest.json')).version, '3.4.3');
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
  assert.ok(!result.includes('## [3.4.2]'));
});

test('review: Step 4 copy discloses redirected Download all files in every language\'s 3.4 notes', () => {
  for (const file of ['PRIVACY.md', 'CHANGELOG.md', 'store/listing.md']) assert.match(read(file), /redirected files/i, file);
  for (const [lang, term] of Object.entries({ '': 'redirected files', de: 'Weitergeleitete Dateien', es: 'archivos redirigidos', fr: 'fichiers redirigés', nl: 'omgeleide bestanden', 'pt-BR': 'arquivos redirecionados' })) {
    const file = `store/listing${lang ? `-${lang}` : ''}.md`, text = read(file);
    const block = text.slice(text.indexOf(' 3.4\n')).split(/\n(?:FROM|AUS|DE|DE LA VERSION|UIT|DA) 3.3/)[0];
    assert.ok(block.toLowerCase().includes(term.toLowerCase()), `${file}: redirected file limit`);
  }
});
