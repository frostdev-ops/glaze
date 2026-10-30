const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const policy = read('PRIVACY.md');

test('media policy bounds container cleanup and preserves the local-only legacy exception', () => {
  assert.match(policy, /removed from the file’s container/);
  assert.match(policy, /saved before 3\.3\.5[^.]*not shared/);
  assert.match(read('docs/privacy.md'), /saved before 3\.3\.5[^.]*not shared/);
});

test('Moodle navigation retention names the actual site and user cache dimensions', () => {
  assert.ok(read('features/navbar-moodle.js').includes('`navbarSeen:${root()}:${userId() || name()}`'));
  assert.match(policy, /navbarSeen:<site-root>:<user-id-or-name>/);
  assert.doesNotMatch(policy, /navbarSeen:<origin>`/);
});

test('LMS request limits describe the document-local bulk queue and header boundary', () => {
  assert.match(read('lib/lmsq.js'), /const sites = new Map\(\)/);
  const paragraph = policy.slice(policy.indexOf('**How often Glaze asks'), policy.indexOf("The extension's own links"));
  assert.match(paragraph, /per document/);
  assert.match(paragraph, /Separate tabs and frames/);
  assert.match(paragraph, /Canvas[^.]*does not expose[^.]*`Retry-After`/);
  assert.match(paragraph, /identity, memberships and due-date exceptions/);
});

test('relay storage limits do not promise lifetime ownership quotas or persisted counters', () => {
  assert.match(read('server/relay.js'), /stored: \[2 \*\* 30, DAY, 1\]/);
  assert.match(policy, /counters reset when the relay restarts/);
  assert.match(policy, /not a lifetime storage quota/);
});

test('share identifier wording separates derived ids from staged protocol enforcement', () => {
  assert.match(read('server/relay.js'), /gzs2 = process.env.GZS2 === '1'/);
  assert.match(policy, /`GZS2=1`/);
  assert.match(policy, /off by default/);
  assert.match(policy, /older members[^.]*update/);
});

test('kept background backups and older-browser reset limits are disclosed', () => {
  assert.match(read('options.js'), /if \(mediaMissing\) next.bg.kind = 'gradient'/);
  assert.match(policy, /Settings backups omit[^.]*background file bytes/);
  assert.match(policy, /same computer[^.]*gradient/);
  assert.match(policy, /without[\s\S]{0,70}getKeys[\s\S]{0,70}unknown legacy/);
  assert.match(read('docs/privacy.md'), /background file bytes/);
});

test('optional Google Drive is disclosed in both privacy texts, with its scope, picker hosts and Limited Use', () => {
  for (const file of ['PRIVACY.md', 'docs/privacy.md']) {
    const text = read(file);
    const limited = text.split(/\n\n|\n(?=Google )/).find((part) => part.includes('Limited Use')) || '';
    assert.match(text, /`(?:https:\/\/www\.googleapis\.com\/auth\/)?drive\.file`/, file);
    assert.match(text, /frostdev\.io\/glaze\/drive-picker\//, file);
    assert.match(text, /frostdev-ops\.github\.io\/glaze-drive-picker\//, file);
    assert.match(text, /Google Drive[^.]*unavailable in (?:this|the current) build while Google verification is pending/, file);
    assert.match(limited, /Drive/, file);
    assert.match(limited, /\[Google API Services User Data Policy\]\(https:\/\/developers\.google\.com\/terms\/api-services-user-data-policy\), including\s+the Limited Use requirements/, file);
  }
  const google = policy.slice(policy.indexOf('## Google user data'), policy.indexOf('## Hosting'));
  assert.match(google, /Google Calendar sync and Google Drive are unavailable/);
  assert.match(google, /Google Drive access \(`drive\.file`/);
});

const languages = {
  '': /account identifiers/, de: /Kontokennungen/, es: /identificadores de escuela, curso y cuenta/,
  fr: /identifiants d’établissement, de cours et de compte/, nl: /account-ID/, 'pt-BR': /identificadores de escola, curso e conta/,
};
const grants = { '': /granted hosts/, de: /genehmigte Hosts/, es: /hosts autorizados/,
  fr: /hôtes autorisés/, nl: /goedgekeurde hosts/, 'pt-BR': /hosts autorizados/ };
for (const [lang, account] of Object.entries(languages)) {
  test(`listing ${lang || 'en'} explains automatic/previous approvals and synced identifiers`, () => {
    const text = read(`store/listing${lang ? `-${lang}` : ''}.md`);
    assert.match(text, /instructure\.com/);
    assert.match(text, /blackboard\.com/);
    assert.match(text, account);
  });
  test(`listing ${lang || 'en'} discloses granted mod data transfers in its privacy paragraph`, () => {
    const text = read(`store/listing${lang ? `-${lang}` : ''}.md`);
    const start = text.search(/^(?:PRIVACY|DATENSCHUTZ|PRIVACIDAD|CONFIDENTIALITÉ|PRIVACIDADE)$/m);
    const paragraph = text.slice(start).split('\n\n')[1];
    assert.match(paragraph, grants[lang]);
  });
}
