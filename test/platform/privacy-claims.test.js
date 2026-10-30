const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '../../extension', file), 'utf8');
const policy = read('../PRIVACY.md');

test('media policy bounds container cleanup and preserves the local-only legacy exception', () => {
  assert.match(policy, /removed from the file’s container/);
  assert.match(policy, /saved before 3\.3\.5[^.]*not shared/);
  assert.match(read('../docs/privacy.md'), /saved before 3\.3\.5[^.]*not shared/);
});

test('Moodle navigation retention names the actual site and user cache dimensions', () => {
  assert.ok(read('navigation/page/navbar-moodle.js').includes('`navbarSeen:${root()}:${userId() || name()}`'));
  assert.match(policy, /navbarSeen:<site-root>:<user-id-or-name>/);
  assert.doesNotMatch(policy, /navbarSeen:<origin>`/);
});

test('LMS request limits describe the document-local bulk queue and header boundary', () => {
  assert.match(read('courses/lmsq.js'), /const sites = new Map\(\)/);
  const paragraph = policy.slice(policy.indexOf('**How often Glaze asks'), policy.indexOf("The extension's own links"));
  assert.match(paragraph, /per document/);
  assert.match(paragraph, /Separate tabs and frames/);
  assert.match(paragraph, /Canvas[^.]*does not expose[^.]*`Retry-After`/);
  assert.match(paragraph, /identity, memberships and due-date exceptions/);
});

test('relay storage limits do not promise lifetime ownership quotas or persisted counters', () => {
  assert.match(read('../server/relay.js'), /stored: \[2 \*\* 30, DAY, 1\]/);
  assert.match(policy, /counters reset when the relay restarts/);
  assert.match(policy, /not a lifetime storage quota/);
});

test('share identifier wording separates derived ids from staged protocol enforcement', () => {
  assert.match(read('../server/relay.js'), /gzs2 = process.env.GZS2 === '1'/);
  assert.match(policy, /`GZS2=1`/);
  assert.match(policy, /off by default/);
  assert.match(policy, /older members[^.]*update/);
});

test('kept background backups and older-browser reset limits are disclosed', () => {
  assert.match(read('settings/options.js'), /if \(mediaMissing\) next.bg.kind = 'gradient'/);
  assert.match(policy, /Settings backups omit[^.]*background file bytes/);
  assert.match(policy, /same computer[^.]*gradient/);
  assert.match(policy, /without[\s\S]{0,70}getKeys[\s\S]{0,70}unknown legacy/);
  assert.match(read('../docs/privacy.md'), /background file bytes/);
});

test('optional Google Drive is disclosed in both privacy texts, with its scope, picker hosts and Limited Use', () => {
  for (const file of ['../PRIVACY.md', '../docs/privacy.md']) {
    const text = read(file);
    const limited = text.split(/\n\n|\n(?=Google )/).find((part) => part.includes('Limited Use')) || '';
    assert.match(text, /`(?:https:\/\/www\.googleapis\.com\/auth\/)?drive\.file`/, file);
    assert.match(text, /frostdev\.io\/glaze\/drive-picker\//, file);
    assert.match(text, /frostdev-ops\.github\.io\/glaze-drive-picker\//, file);
    assert.match(text, /Google Drive[^.]*unavailable in (?:this|the current) build/, file);
    assert.match(limited, /Drive/, file);
    assert.match(limited, /\[Google API Services User Data Policy\]\(https:\/\/developers\.google\.com\/terms\/api-services-user-data-policy\), including\s+the Limited Use requirements/, file);
  }
  const google = policy.slice(policy.indexOf('## Google user data'), policy.indexOf('## Hosting'));
  assert.match(google, /Google Drive is unavailable in this build/);
  assert.doesNotMatch(google, /Google Calendar sync[^.]*unavailable/);
  assert.match(google, /Google Drive access \(`drive\.file`/);
});

test('Google Drive storage disclosures include the account id and Safari refresh token', () => {
  const stored = policy.slice(policy.indexOf('- **Google Drive**'), policy.indexOf('- **Gradescope in To Do**'));
  assert.match(stored, /\{ email, sub, flow, at \}/);
  for (const text of [stored, read('../docs/privacy.md')]) {
    assert.match(text, /refresh token[^.]*Keychain/i);
    assert.match(text, /access tokens?[^.]*memory/i);
  }
  assert.match(read('../docs/privacy.md'), /Google account id/);
  assert.doesNotMatch(policy, /Safari will (?:keep it|use[^.]*keep it)\s+in the Keychain/);
});

// Save to Drive keeps the file it made on the document (documents/drive.js serve: record.set(key, { id, as })): the policy
// says so, and that the next Save updates that file.
test('Save to Drive discloses the Drive file id it keeps on the document', () => {
  assert.match(read('documents/drive.js'), /record\.set\(m\.key, \{ id: r\.id, as: m\.as \}\)/);
  const save = policy.slice(policy.indexOf('  - **Save to Drive**'), policy.indexOf('  - **Sync to Google Drive**'));
  assert.match(save, /Drive id[^.]*on the document/);
  assert.match(save, /next Save\s+updates/);
});

const languages = {
  '': /account identifiers/, de: /Kontokennungen/, es: /identificadores de escuela, curso y cuenta/,
  fr: /identifiants d’établissement, de cours et de compte/, nl: /account-ID/, 'pt-BR': /identificadores de escola, curso e conta/,
};
const grants = { '': /granted hosts/, de: /genehmigte Hosts/, es: /hosts autorizados/,
  fr: /hôtes autorisés/, nl: /goedgekeurde hosts/, 'pt-BR': /hosts autorizados/ };
for (const [lang, account] of Object.entries(languages)) {
  test(`listing ${lang || 'en'} explains automatic/previous approvals and synced identifiers`, () => {
    const text = read(`../store/listing${lang ? `-${lang}` : ''}.md`);
    assert.match(text, /instructure\.com/);
    assert.match(text, /blackboard\.com/);
    assert.match(text, account);
  });
  test(`listing ${lang || 'en'} discloses granted mod data transfers in its privacy paragraph`, () => {
    const text = read(`../store/listing${lang ? `-${lang}` : ''}.md`);
    const start = text.search(/^(?:PRIVACY|DATENSCHUTZ|PRIVACIDAD|CONFIDENTIALITÉ|PRIVACIDADE)$/m);
    const paragraph = text.slice(start).split('\n\n')[1];
    assert.match(paragraph, grants[lang]);
  });
}

test('Calendar\'s Disconnect discloses that, while Google Drive shares the grant, it revokes nothing and keeps identity', () => {
  const bg = read('background/background.js');
  const bye = bg.slice(bg.indexOf('  disconnect: async (m) => {'), bg.indexOf('  sync: async (m, epoch) => {'));
  assert.match(bye, /google\?\.email === 'string'\) \{\s*await chrome\.storage\.local\.remove\(\['gcal', 'gcalSync'\]\);[\s\S]*?shared: true \};/, 'the code: Drive connected, only Calendar\'s state goes');
  const network = policy.slice(policy.indexOf('## Network requests'));
  const calendar = network.slice(network.indexOf('- **Google Calendar sync**'), network.indexOf('- **Google Drive** (off until you connect)'));
  assert.match(calendar.slice(calendar.indexOf('**Disconnect**')), /Google Drive[^.]*same access[^.]*doesn't revoke/);
  const identity = policy.slice(policy.indexOf('- `identity` (Chrome only, optional)'), policy.indexOf('- `unlimitedStorage`'));
  assert.match(identity, /removed on\s+Disconnect[^.;]*unless Google Drive/);
  assert.match(read('../docs/privacy.md'), /\*\*Disconnect\*\* deletes them and revokes access[^.]*unless Google Drive/);
});

test('Safari\'s nativeMessaging and the storage permission name what Google Drive uses them for', () => {
  assert.match(read('background/background.js'), /native: \(message\) => chrome\.runtime\.sendNativeMessage\(GZ_GOOGLE\.APP, message\)/, 'the code: Safari signs in through the handler');
  const native = policy.slice(policy.indexOf('- `nativeMessaging`'), policy.indexOf('- `activeTab`'));
  assert.match(native, /Google Drive/);
  const storage = policy.slice(policy.indexOf('- `storage`'), policy.indexOf('- No permission for reading PDFs'));
  assert.match(storage, /Sync to Google Drive/);
});

test('what Glaze stores says Sync to Google Drive copies records it otherwise keeps on this device only, the Gradescope account with them', () => {
  const store = read('background/drive-store.js');
  assert.match(store, /cat: 'gradescope'[^\n]*view: \(v\) => \(obj\(v\) \? \{ acct: v\.acct/, 'the code: Gradescope\'s account goes with its placings');
  const stores = policy.slice(policy.indexOf('## What Glaze stores'), policy.indexOf('- **Glaze navigation**'));
  assert.match(stores, /Sync to Google Drive[^.]*your own\s+Google Drive[^.]*on this device only/);
  const data = policy.slice(policy.indexOf('in Glaze/Data, one JSON file per setting'), policy.indexOf('in Glaze/Backups'));
  assert.match(data, /Gradescope's account/);
});
