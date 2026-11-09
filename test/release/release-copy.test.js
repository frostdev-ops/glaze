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

// Install access covers hosted LMS domains, the gallery and relay; a school's own address is added in School.
const access = {
  '': ['Settings › Privacy and data › School', 'course tab sketches stay in memory'],
  de: ['Einstellungen › Datenschutz und Daten › Schule', 'Skizzen der Kurs-Tabs bleiben im Arbeitsspeicher'],
  es: ['Ajustes › Privacidad y datos › Centro', 'bocetos de las pestañas de cursos se quedan en la memoria'],
  fr: ['Réglages › Confidentialité et données › Établissement', 'esquisses des onglets de cours restent en mémoire'],
  nl: ['Instellingen › Privacy en gegevens › School', 'schetsen van cursustabbladen blijven in het geheugen'],
  'pt-BR': ['Configurações › Privacidade e dados › Escola', 'esboços das abas de cursos ficam na memória'],
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

// 4.0.5: the setup guide, labelled for Chrome and Firefox (Safari doesn't open it), then two Ask Rime fixes under its name and
// Pearson inside Blackboard under its switch's name, unlabelled so every store carries them.
const release405 = {
  '': 'NEW IN 4.0.5', de: 'NEU IN 4.0.5', es: 'NOVEDADES DE 4.0.5', fr: 'NOUVEAUTÉS DE LA VERSION 4.0.5', nl: 'NIEUW IN 4.0.5', 'pt-BR': 'NOVO NA 4.0.5',
};
for (const [lang, heading] of Object.entries(release405)) test(`4.0.5 release notes ${lang || 'en'} label the setup guide for Chrome and Firefox and send the fixes to every store`, () => {
  const text = listing(lang), notes = part(text, 'Release notes');
  const block = notes.slice(notes.indexOf(heading));
  const context = {};
  if (lang) vm.runInNewContext(read(`i18n/${lang}.js`), context);
  const ui = (key) => lang ? context.GZ_LANGS[lang][key] : key;
  assert.ok(block.startsWith(heading), heading);
  const bullets = block.split('\n').filter((l) => l.startsWith('•'));
  const label = (l) => /^•\s*(Chrome|Firefox|Safari)\s*:/.exec(l)?.[1];
  assert.deepEqual(bullets.map((l) => label(l) || (l.includes(ui('Ask Rime')) ? 'Ask Rime' : l.includes(ui('Pearson inside Blackboard')) ? 'Pearson' : l)), ['Chrome', 'Firefox', 'Ask Rime', 'Ask Rime', 'Pearson']);
  assert.equal(bullets[0].replace('Chrome', ''), bullets[1].replace('Firefox', ''), 'one setup-guide line per browser that opens it');
  assert.ok(bullets[0].toLowerCase().includes(ui('Navigation').toLowerCase()) && bullets[0].includes(ui('AI')), 'the setup line names its navigation and AI steps');
  assert.ok(!/\b(?:CI|audit|eval|R\d+)\b/i.test(block), 'no internal process or model rounds in store copy');
});

test('4.0.3 access instructions account for browsers that already hold the hosts', () => {
  const changelog = read('../CHANGELOG.md').split('## [4.0.3]')[1].split('## [4.0.2]')[0];
  for (const key of ['Pearson problem viewer', 'Pearson inside Blackboard', 'Modern Pearson equations', 'when needed']) assert.ok(changelog.includes(key), key);
});

test('Rime privacy separates the opening list request from the model download click', () => {
  const policy = read('../PRIVACY.md').split('- **Rime** (Settings')[1].split('- **Agent access**')[0];
  assert.match(policy, /model files only after you click Download/, 'the click restriction applies to model files, not the first list request');
  assert.match(policy, /opening Settings → AI asks `huggingface.co`, at most once a day/);
  assert.match(policy, /never in Safari or with Data Saver on/);
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

test('release versions agree and the exact pure notes transform fits Apple', () => {
  const version = JSON.parse(read('manifest.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(JSON.parse(read('../safari/Glaze/Glaze Extension/Resources/manifest.json')).version, version);
  // The helper and its Claude Desktop bundle on the GitHub release carry Glaze's version.
  assert.equal(JSON.parse(read('../mcp/package.json')).version, version);
  assert.equal(JSON.parse(read('../mcp/mcpb/manifest.json')).version, version);
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
  assert.match(result, /^(Added|Changed|Fixed)\n/);
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
