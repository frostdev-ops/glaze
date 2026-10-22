// The store listings are release copy (RELEASING.md copies store/listing.md into the Chrome Web Store package), so they
// must describe the version being shipped and may not make claims the privacy policy contradicts (audit BLD-2, BLD-4, BLD-6).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const [major, minor, patch] = manifest.version.split('.');
const listings = fs.readdirSync(path.join(root, 'store')).filter((f) => /^listing(?:-[\w-]+)?\.md$/.test(f));

// "NEW IN 3.3" in each language: the heading of the newest release notes.
const NEWEST = /^(?:NEW IN|NEU IN|NOVEDADES DE|NOUVEAUTÉS DE LA VERSION|NIEUW IN|NOVO NA) (\d+\.\d+(?:\.\d+)?)$/m;

test('BLD-4: there are six listings, English and five translations', () => {
  assert.deepEqual(listings.sort(), ['listing-de.md', 'listing-es.md', 'listing-fr.md', 'listing-nl.md', 'listing-pt-BR.md', 'listing.md']);
});

for (const file of listings) {
  const text = read(`store/${file}`);

  test(`BLD-4: ${file} is headed with the manifest's version (${major}.${minor})`, () => {
    const m = /^# Chrome Web Store listing — Glaze (\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
    assert.ok(m, 'the first line names the Glaze version');
    assert.equal(`${m[1]}.${m[2]}`, `${major}.${minor}`, `the listing describes Glaze ${m[1]}.${m[2]} but the manifest is ${manifest.version}`);
    if (m[3] !== undefined) assert.equal(m[3], patch, 'a patch number in the heading must match the manifest too');
  });

  test(`BLD-4: the newest release notes in ${file} are for the manifest's version`, () => {
    const m = NEWEST.exec(text);
    assert.ok(m, 'a "new in" section is the first release-notes heading');
    assert.equal(m[1].split('.').slice(0, 2).join('.'), `${major}.${minor}`);
  });

  test(`BLD-2: ${file} does not promise that everything stays on the device`, () => {
    const privacy = text.slice(text.search(/^(?:PRIVACY|DATENSCHUTZ|PRIVACIDAD|CONFIDENTIALITÉ|PRIVACIDADE)$/m));
    assert.ok(/Firefox/.test(privacy), 'the privacy paragraph names Firefox sync beside Chrome sync');
    assert.ok(!/(?:What Glaze keeps|Lo que Glaze guarda|Was Glaze speichert|Ce que Glaze conserve|Wat Glaze bewaart|O que o Glaze guarda)[^.]*(?:stays|se queda|bleibt|reste|blijft|fica)/i.test(text),
      'the old blanket claim is gone');
  });
}

test('BLD-4: the English listing fits the store limits it states', () => {
  const text = read('store/listing.md');
  const short = /## Short summary \(132 character maximum\)\n\n(.+)\n/.exec(text)[1];
  assert.ok(short.length <= 132, `short summary is ${short.length} characters`);
  const host = /### Host access: <all_urls> \(1,000 character maximum\)\n\n(.+)\n/.exec(text)[1];
  assert.ok(host.length <= 1000, `host access justification is ${host.length} characters`);
  const remote = /## Remote code \(1,000 character maximum\)\n\n(.+)\n/.exec(text)[1];
  assert.ok(remote.length <= 1000, `remote code statement is ${remote.length} characters`);
  for (const file of listings) {
    const s = /## Short summary \(132 character maximum\)\n\n(.+)\n/.exec(read(`store/${file}`))[1];
    assert.ok(s.length <= 132, `${file}: short summary is ${s.length} characters`);
  }
});

test('BLD-6: the host-access justification names opt-in writes and Canvas tabs, not only reads and Ultra', () => {
  const text = read('store/listing.md');
  const host = /### Host access: <all_urls>[^\n]*\n\n(.+)\n/.exec(text)[1];
  assert.ok(!/read-only/i.test(host), 'it no longer says the requests are read-only');
  assert.match(host, /writes only on (?:their|the user's) click/);
  assert.match(host, /Sign out/);
  assert.match(host, /Ultra and Canvas/);
  assert.match(host, /asks the user first/);
});

test('BLD-2: the README does not promise that everything stays on the device', () => {
  const text = read('README.md');
  assert.ok(!/what Glaze keeps stays on your device/i.test(text));
  assert.match(text, /Chrome or Firefox sync/);
});
