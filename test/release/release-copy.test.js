const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const latest = read('../CHANGELOG.md').split('## [3.3.6]')[1]?.split(/^## /m)[0] || '';

test('3.3.6 release claims keep typing effects private and the pointer choice out of codes', () => {
  assert.match(latest, /never read what you type/);
  assert.match(latest, /password, card or one-time-code/);
  assert.match(latest, /never put in a Look or a theme code/);
  assert.match(latest, /moves into the Look you're wearing, once/);
  assert.match(latest, /Safari: Settings opened inside/);
});

const listing = (lang) => read(`../store/listing${lang ? `-${lang}` : ''}.md`);
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
    assert.ok(read(`../store/${store}${lang ? `-${lang}` : ''}.md`).includes(disclosures[lang][0]), `${store}: collect and sell`);
  }
  assert.ok(!/(?:ten tabs|zehn Tabs|diez pestañas|dix onglets|tien tabbladen|dez abas)/.test(listing(lang)), 'no settings editor in ten tabs');
});

// 4.0.2 is fixes only: each listing's block names the settings it fixes by their names in that language, and labels the
// Safari-only fixes so AMO leaves them out.
const release402 = {
  '': ['NEW IN 4.0.2', 'course bar', 'slower laptops'],
  de: ['NEU IN 4.0.2', 'Kursleiste', 'langsameren Laptops'],
  es: ['NOVEDADES DE 4.0.2', 'barra del curso', 'portátiles más lentos'],
  fr: ['NOUVEAUTÉS DE LA VERSION 4.0.2', 'barre du cours', 'portables plus lents'],
  nl: ['NIEUW IN 4.0.2', 'cursusbalk', 'tragere laptops'],
  'pt-BR': ['NOVO NA 4.0.2', 'barra do curso', 'notebooks mais lentos'],
};
for (const [lang, expected] of Object.entries(release402)) test(`4.0.2 release notes ${lang || 'en'} name the fixed settings and label Safari's fixes`, () => {
  const text = listing(lang), block = part(text, 'Release notes');
  const context = {};
  if (lang) vm.runInNewContext(read(`i18n/${lang}.js`), context);
  const ui = (key) => lang ? context.GZ_LANGS[lang][key] : key;
  for (const key of ['Open Blackboard on the dashboard', 'Reset layout', 'Writer']) assert.ok(block.toLowerCase().includes(ui(key).toLowerCase()), key);
  for (const term of expected) assert.ok(block.toLowerCase().includes(term.toLowerCase()), term);
  for (const line of block.split('\n').filter((l) => /Google|Writer/.test(l))) assert.match(line, /^•\s*Safari\s*:/, 'Safari\'s fixes are labelled');
  assert.ok(!/\b(?:CI|audit)\b/i.test(block), 'no internal process in store copy');
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

test('4.0.2 versions agree and the exact pure notes transform fits Apple', () => {
  assert.equal(JSON.parse(read('manifest.json')).version, '4.0.2');
  assert.equal(JSON.parse(read('../safari/Glaze/Glaze Extension/Resources/manifest.json')).version, '4.0.2');
  // The helper and its Claude Desktop bundle, glaze-mcp-4.0.2.mcpb on the GitHub release, carry Glaze's version.
  assert.equal(JSON.parse(read('../mcp/package.json')).version, '4.0.2');
  assert.equal(JSON.parse(read('../mcp/mcpb/manifest.json')).version, '4.0.2');
  // Extract only this synchronous reader. Do not import or execute the release command or its top-level operations.
  const script = read('../tools/release/store-release.mjs');
  const body = script.slice(script.indexOf('function notes(source) {'), script.indexOf('\nasync function build('));
  assert.ok(body.startsWith('function notes(source) {'));
  const notes = vm.runInNewContext(`(${body})`, {
    fs: { readFileSync: fs.readFileSync }, path,
    json: (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
    requireValue: (value) => { assert.ok(value); return value; },
  });
  const result = notes(path.join(root, '..'));
  assert.ok(result.length <= 4000, `${result.length} characters`);
  assert.match(result, /^Fixed\n/);
  assert.ok(result.length <= 3000, `AMO: ${result.length} characters`);
  assert.ok(!result.includes('## [3.4.5]'));
});

test('review: Step 4 copy discloses redirected Download all files in every language\'s description', () => {
  for (const file of ['../PRIVACY.md', '../CHANGELOG.md', '../store/listing.md']) assert.match(read(file), /redirected files/i, file);
  for (const [lang, term] of Object.entries({ '': 'redirected files', de: 'Weitergeleitete Dateien', es: 'archivos redirigidos', fr: 'fichiers redirigés', nl: 'omgeleide bestanden', 'pt-BR': 'arquivos redirecionados' })) {
    assert.ok(description(lang).toLowerCase().includes(term.toLowerCase()), `${lang || 'en'}: redirected file limit`);
  }
});

test('Writer disclosures describe the complete Feedback material budget and automatic picture preparation', () => {
  const budget = require('../../extension/ai/tasks/writer-feedback.js').LIMIT.material;
  assert.equal(budget, 200000);
  const policy = read('../PRIVACY.md').split('**Feedback**')[1].split('- **PDFs')[0];
  assert.match(policy, /200,000 characters/);
  assert.doesNotMatch(policy, /24,000 characters|12,000 characters/);
  const harness = read('../docs/ai-harness.md').split('| `writer.feedback`')[1].split('\n')[0];
  assert.match(harness, /200,000 characters/);
  assert.doesNotMatch(harness, /12,000 characters|24,000 in all/);
  for (const lang of ['', 'de', 'es', 'fr', 'nl', 'pt-BR']) {
    const detail = description(lang);
    assert.match(detail, /128/, `${lang || 'en'}: bounded local readings disclosed`);
    assert.match(detail, /30/, `${lang || 'en'}: retention disclosed`);
  }
});
