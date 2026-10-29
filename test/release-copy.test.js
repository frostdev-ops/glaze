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

const listing = (lang) => read(`store/listing${lang ? `-${lang}` : ''}.md`);
const part = (text, heading) => text.split(`\n## ${heading}`)[1].replace(/^[^\n]*\n\n/, '').split(/\n## /)[0];
const description = (lang) => part(listing(lang), 'Detailed description');

// From 3.4: install access covers hosted LMS domains, the gallery and relay; a school's own address is added in Sites.
const access = {
  '': ['Settings › Privacy and data › Sites', 'course tab sketches stay in memory'],
  de: ['Einstellungen › Datenschutz und Daten › Websites', 'Skizzen der Kurs-Tabs bleiben im Arbeitsspeicher'],
  es: ['Ajustes › Privacidad y datos › Sitios', 'bocetos de las pestañas de cursos se quedan en la memoria'],
  fr: ['Réglages › Confidentialité et données › Sites', 'esquisses des onglets de cours restent en mémoire'],
  nl: ['Instellingen › Privacy en gegevens › Sites', 'schetsen van cursustabbladen blijven in het geheugen'],
  'pt-BR': ['Configurações › Privacidade e dados › Sites', 'esboços das abas de cursos ficam na memória'],
};
const disclosures = {
  '': ['Glaze does not collect or sell your data.', 'ordinary network requests', 'encoded streams and visible pixels remain', 'editor recovery', 'Files-folder zips', 'unread counts', 'up to 4 course pages'],
  de: ['Glaze sammelt und verkauft deine Daten nicht.', 'gewöhnliche Netzwerkanfragen', 'kodierte Datenströme und sichtbare Pixel bleiben', 'Texteingabe-Wiederherstellung', 'ZIP-Downloads aus Dateiordnern', 'Ungelesen-Zähler', 'bis zu 4 Kursseiten'],
  es: ['Glaze no recopila ni vende tus datos.', 'solicitudes de red normales', 'flujos codificados y los píxeles visibles', 'recuperación del editor', 'ZIP de carpetas de archivos', 'contadores de no leídos', 'hasta 4 páginas de cursos'],
  fr: ['Glaze ne collecte ni ne vend vos données.', 'requêtes réseau ordinaires', 'flux encodés et pixels visibles restent', 'récupération de texte', 'ZIP de dossiers de fichiers', 'compteurs de non-lus', 'jusqu’à 4 pages de cours'],
  nl: ['Glaze verzamelt en verkoopt je gegevens niet.', 'gewone netwerkverzoeken', 'gecodeerde streams en zichtbare pixels blijven', 'editorherstel', 'ZIP-downloads van bestandsmappen', 'ongelezen-tellers', 'maximaal 4 cursuspagina’s'],
  'pt-BR': ['O Glaze não coleta nem vende seus dados.', 'requisições de rede comuns', 'fluxos codificados e os pixels visíveis permanecem', 'recuperação de texto', 'ZIPs de pastas de arquivos', 'contadores de não lidos', 'até 4 páginas de cursos'],
};
for (const [lang, expected] of Object.entries(access)) test(`listing ${lang || 'en'} names the hosts Glaze works on from install, where to add a school's own address, and that course sketches stay in memory`, () => {
  const text = description(lang);
  for (const term of ['instructure.com', 'blackboard.com', 'moodlecloud.com', 'share.frostdev.io', ...expected]) assert.ok(text.toLowerCase().includes(term.toLowerCase()), term);
  for (const term of disclosures[lang]) assert.ok(text.includes(term), term);
  for (const store of ['firefox', 'app-store']) {
    assert.ok(read(`store/${store}${lang ? `-${lang}` : ''}.md`).includes(disclosures[lang][0]), `${store}: collect and sell`);
  }
  assert.ok(!/(?:ten tabs|zehn Tabs|diez pestañas|dix onglets|tien tabbladen|dez abas)/.test(listing(lang)), 'no settings editor in ten tabs');
});

const writerRelease = {
  '': ['NEW IN 4.0.0', 'Spelling, grammar and autocorrect', 'no AI or completion', 'rubric and instructions', 'explains estimated grades or why no score is available', 'Glaze never drafts.'],
  de: ['NEU IN 4.0.0', 'Rechtschreibung, Grammatik und Autokorrektur', 'ohne KI oder Textvervollständigung', 'Bewertungsraster und Anweisungen', 'erklärt geschätzte Noten oder warum keine Punktzahl möglich ist', 'Glaze verfasst keine Entwürfe.'],
  es: ['NOVEDADES DE 4.0.0', 'La ortografía, la gramática y la autocorrección', 'sin IA ni autocompletado', 'la rúbrica y las instrucciones', 'explican las notas estimadas o por qué no hay puntuación', 'Glaze nunca redacta por ti.'],
  fr: ['NOUVEAUTÉS DE LA VERSION 4.0.0', 'Orthographe, grammaire et correction automatique', 'sans IA ni complétion', 'la grille et les consignes', 'expliquent les notes estimées ou l’absence de score', 'Glaze ne rédige jamais à votre place.'],
  nl: ['NIEUW IN 4.0.0', 'Spelling, grammatica en autocorrectie', 'zonder AI of aanvulling', 'het beoordelingsschema en de instructies', 'verklaart geschatte cijfers of waarom er geen score is', 'Glaze schrijft nooit een tekst voor je.'],
  'pt-BR': ['NOVO NA 4.0.0', 'Ortografia, gramática e correção automática', 'sem IA nem preenchimento de texto', 'a rubrica e as instruções', 'explicam as notas estimadas ou por que não há pontuação', 'O Glaze nunca redige por você.'],
};
for (const [lang, expected] of Object.entries(writerRelease)) test(`4.0.0 release notes ${lang || 'en'} describe Writer, local proofing, optional AI feedback and paper backups`, () => {
  const text = listing(lang), block = part(text, 'Release notes');
  const context = {};
  if (lang) vm.runInNewContext(read(`i18n/${lang}.js`), context);
  const ui = (key) => lang ? context.GZ_LANGS[lang][key] : key;
  assert.ok(block.includes(`${ui('Settings')} › ${ui('AI')}`), 'the release notes use the AI settings UI path');
  for (const key of ['Back up…', 'Restore…']) assert.ok(block.includes(ui(key)), key);
  for (const term of ['Glaze Writer', 'MLA 9', 'APA 7', 'Chicago 17', '.docx']) assert.ok(block.includes(term), term);
  for (const term of expected) assert.ok(block.includes(term), term);
  assert.ok(!/\b(?:CI|audit)\b/i.test(block), 'no internal process in store copy');
  assert.ok(!/(?:Export and import all your settings|Exportiere und importiere alle|Exporta e importa todos|Exportez et importez tous|Exporteer en importeer al|Exporte e importe todas)/.test(text), 'one-file backup replaces settings export');
  for (const key of ['Back up…', 'Restore…']) assert.ok(description(lang).includes(ui(key)), `the description names ${key} too`);
});

// Typing effects (3.3.6) draw at the caret: the listing says they never read what is typed and stay out of password fields.
const terms = {
  '': ['never read what you type', 'password', 'Look › Pointer'],
  de: ['nie lesen, was du tippst', 'Passwort', 'Aussehen › Mauszeiger'],
  es: ['nunca leen lo que escribes', 'contraseña', 'Aspecto › Puntero'],
  fr: ['ne lisent jamais ce que vous tapez', 'mot de passe', 'Apparence › Pointeur'],
  nl: ['nooit lezen wat je typt', 'wachtwoord', 'Uiterlijk › Aanwijzer'],
  'pt-BR': ['nunca leem o que você digita', 'senha', 'Aparência › Ponteiro'],
};
for (const [lang, expected] of Object.entries(terms)) test(`listing ${lang || 'en'} keeps typing privacy and the pointer setting's path`, () => {
  const text = description(lang);
  for (const term of expected) assert.ok(text.includes(term), term);
});

test('4.0.0 versions agree and the exact pure notes transform fits Apple', () => {
  assert.equal(JSON.parse(read('manifest.json')).version, '4.0.0');
  assert.equal(JSON.parse(read('safari/Glaze/Glaze Extension/Resources/manifest.json')).version, '4.0.0');
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
  assert.ok(!result.includes('## [3.4.5]'));
});

test('review: Step 4 copy discloses redirected Download all files in every language\'s description', () => {
  for (const file of ['PRIVACY.md', 'CHANGELOG.md', 'store/listing.md']) assert.match(read(file), /redirected files/i, file);
  for (const [lang, term] of Object.entries({ '': 'redirected files', de: 'Weitergeleitete Dateien', es: 'archivos redirigidos', fr: 'fichiers redirigés', nl: 'omgeleide bestanden', 'pt-BR': 'arquivos redirecionados' })) {
    assert.ok(description(lang).toLowerCase().includes(term.toLowerCase()), `${lang || 'en'}: redirected file limit`);
  }
});
