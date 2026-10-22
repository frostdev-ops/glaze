const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const latest = read('CHANGELOG.md').split('## [3.3.5]')[1]?.split(/^## /m)[0] || '';

test('3.3.5 release claims retain queue, identity and compatibility boundaries', () => {
  assert.match(latest, /Selected bulk reads/);
  assert.match(latest, /per document/);
  assert.match(latest, /Due this week[^\n]*per site/);
  assert.doesNotMatch(latest, /Blackboard course records and draft backups are kept per site and student/);
  assert.match(latest, /older members must update/);
  assert.match(latest, /unless you choose to keep/);
  assert.match(latest, /best effort/);
});

test('3.3.5 media release notes retain container and local-only legacy boundaries', () => {
  assert.match(latest, /container metadata/);
  assert.match(latest, /older files[^\n]*local[^\n]*not shared/);
});

const terms = {
  '': ['not already approved', 'Selected bulk reads', 'container metadata', 'older files stay local'],
  de: ['noch nicht genehmigten', 'Ausgewählte Sammelabrufe', 'Container-Metadaten', 'ältere Dateien bleiben lokal'],
  es: ['aún no aprobado', 'Las lecturas masivas seleccionadas', 'metadatos del contenedor', 'archivos anteriores quedan solo en este dispositivo'],
  fr: ['pas encore approuvé', 'Certaines lectures groupées', 'métadonnées du conteneur', 'anciens fichiers restent sur cet appareil'],
  nl: ['nog niet goedgekeurde', 'Geselecteerde bulkverzoeken', 'containermetadata', 'oudere bestanden blijven lokaal'],
  'pt-BR': ['ainda não aprovado', 'Leituras em lote selecionadas', 'metadados do contêiner', 'arquivos antigos ficam apenas neste dispositivo'],
};
for (const [lang, expected] of Object.entries(terms)) test(`3.3.5 listing ${lang || 'en'} retains consent, queue and media limits`, () => {
  const text = read(`store/listing${lang ? `-${lang}` : ''}.md`);
  const block = text.slice(text.indexOf('3.3.5\n')).split(/\n(?:FROM|AUS|DE|DE LA VERSION|UIT|DA) 3.3/)[0];
  for (const term of expected) assert.ok(block.includes(term), term);
});

test('3.3.5 versions agree and the exact pure notes transform fits Apple', () => {
  assert.equal(JSON.parse(read('manifest.json')).version, '3.3.5');
  assert.equal(JSON.parse(read('safari/Glaze/Glaze Extension/Resources/manifest.json')).version, '3.3.5');
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
  assert.ok(!result.includes('## [3.3.4]'));
});
