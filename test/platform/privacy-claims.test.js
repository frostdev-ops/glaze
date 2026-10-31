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
  assert.match(bye, /if \(driveOn && drive\.flow === 'chrome'\) \{\s*await chrome\.storage\.local\.remove\(\['gcal', 'gcalSync'\]\);[\s\S]*?shared: true \};/, 'the code: Drive connected through Chrome\'s own client, only Calendar\'s state goes');
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

// The daily snapshot is Back up…'s zip with every Notes account in it (background/background.js snapshot: notesOut per
// account, handed to pack): the Backups line names Notes rather than sending them elsewhere.
test('Sync to Google Drive\'s daily Backups zip discloses the Notes it carries', () => {
  const bg = read('background/background.js');
  const snap = bg.slice(bg.indexOf('    snapshot: async () => {'), bg.indexOf('  const P = () => (openPapers(), GZ_WRITER_PAPERS), PAPER'));
  assert.match(snap, /notes\.push\(\{ account, entries: await GZ_BACKUP\.notesOut\(account, notesSend\) \}\)/, 'the code: each Notes account goes in the zip');
  assert.match(snap, /GZ_BACKUP\.pack\(\{ settings, tasks: \{ tasks, pets \}, local: all, notes,/);
  const backups = policy.slice(policy.indexOf('in Glaze/Backups, once a day'), policy.indexOf('- Never in Drive:'));
  assert.match(backups, /zip of[^.]*\bNotes\b/);
  assert.doesNotMatch(backups, /Notes are in Glaze\/Data/);
});

// Every storage.local key Sync keeps (documents/drive-sync.js and background/drive-store.js) is named where the policy lists
// them, and the policy says they stay once Sync is turned off: the worker keeps stamping changes while Sync is off but
// still bound to its account (background/background.js), and turning it off keeps its state (drive-sync.js set).
test('Sync to Google Drive\'s storage disclosure names every key it keeps, and that they stay once it is turned off', () => {
  const keys = new Set();
  for (const f of ['documents/drive-sync.js', 'background/drive-store.js']) {
    const line = read(f).split('\n').find((l) => /^ {2}const [A-Z]+ = 'driveSync/.test(l));
    assert.ok(line, `${f}: its storage keys`);
    for (const [, k] of line.matchAll(/'(driveSync[\w]*:?)'/g)) keys.add(k);
  }
  assert.ok(keys.has('driveSyncWaiting') && keys.has('driveSyncStamps'), [...keys].join());
  assert.match(read('background/background.js'), /if \(!\(on \|\| typeof st\?\.account === 'string'\) \|\| !googleLib\(\)\.ON\) return;/, 'the code: stamped while off but bound');
  assert.match(read('documents/drive-sync.js'), /if \(!on\) \{ stopped\+\+; await setState\(\{ on: false, off: true, busy: 0 \}\);/, 'the code: turning it off keeps its state');
  const stored = policy.slice(policy.indexOf('- **Google Drive** (off until you connect), unavailable'), policy.indexOf('- **Gradescope in To Do**'));
  for (const k of keys) assert.ok(stored.includes(`\`${k}${k.endsWith(':') ? '…' : ''}\``), `PRIVACY.md names ${k}`);
  assert.doesNotMatch(stored, /While \*\*Sync to Google Drive\*\* is on, `chrome\.storage\.local` also holds/);
  assert.match(stored, /Sync to Google Drive\*\* is on, `chrome\.storage\.local` also holds its state[^:]*turned off/);
});

// Safari signs in with the authorization code flow in its handler (safari/…/GlazeGoogle.swift): the code is exchanged and
// access tokens renewed at oauth2.googleapis.com/token, not only revoked there.
test('Safari\'s token requests to oauth2.googleapis.com are disclosed in both privacy texts', () => {
  const swift = fs.readFileSync(path.join(__dirname, '../../safari/Glaze/Glaze Extension/GlazeGoogle.swift'), 'utf8');
  assert.match(swift, /static let tokenURL = URL\(string: "https:\/\/oauth2\.googleapis\.com\/token"\)!/);
  assert.match(swift, /"grant_type": "refresh_token"/);
  const at = policy.indexOf('- **Google Drive** (off until you connect). Unavailable'), network = policy.slice(at, policy.indexOf('  - **Connect**', at));
  assert.ok(at > 0 && network.length > 0);
  assert.match(network, /`https:\/\/oauth2\.googleapis\.com`[^.]*Safari[^.]*access tokens/);
  assert.match(read('../docs/privacy.md'), /`oauth2\.googleapis\.com`[^)]*Safari[^)]*access tokens/);
});

// Another account's Connect forgets Sync's state only through Sync's binding check (documents/drive-sync.js runNow, set):
// while Sync is off the worker's listener leaves it as it is (background/background.js), until Sync is turned on for that
// account. The policy says when it goes, not that every Connect deletes it.
test('Sync to Google Drive\'s storage disclosure says when another account deletes its state', () => {
  const bg = read('background/background.js'), sync = read('documents/drive-sync.js');
  assert.match(bg, /if \(!googleLib\(\)\.ON \|\| st\?\.off === true\) return;\n\s*\/\/ Reconnecting a different account/, 'the code: Sync off, another account\'s Connect leaves its state');
  assert.match(sync, /if \(st\.account && st\.account !== who\) \{\s*await forget\(\);/, 'the code: a run under another account forgets it');
  assert.match(sync, /changed = st\.account && st\.account !== who;\s*if \(changed\) await forget\(\);/, 'the code: turning it on for another account forgets it');
  const stored = policy.slice(policy.indexOf('- **Google Drive** (off until you connect), unavailable'), policy.indexOf('- **Gradescope in To Do**'));
  assert.doesNotMatch(stored, /Connecting another account deletes all of it/);
  assert.match(stored, /Connecting another account while Sync is on, or turning Sync on for\s+another account, deletes all of it\./);
});

// Glaze's own daily snapshots past the newest five are deleted for good (background/drive-store.js snapshot, documents/drive.js
// remove); every other Drive file it removes goes to Drive's trash. Both privacy texts say so.
test('Sync to Google Drive\'s privacy texts say only Glaze\'s own older daily zips are deleted for good', () => {
  assert.match(read('background/drive-store.js'), /m\?\.appProperties\?\.glaze !== 'snapshot'[^\n]*\n\s*await ctx\.D\(\(c\) => c\.remove\(f\.id\)\)/, 'the code: a checked snapshot alone');
  const sync = policy.slice(policy.indexOf('  - **Sync to Google Drive**'), policy.indexOf('  - **Submit from Drive**'));
  assert.doesNotMatch(sync, /older\s+snapshot goes to Drive's trash/);
  assert.match(sync, /Glaze deletes no Drive file for good except its own daily zips\s+past the newest\s+five/);
  const short = read('../docs/privacy.md');
  assert.doesNotMatch(short, /never deletes a Drive file for good\)/);
  assert.match(short, /no Drive file is deleted for good except Glaze's own daily zips past the newest five/);
});
