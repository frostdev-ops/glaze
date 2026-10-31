const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '../../extension', file), 'utf8');
const policy = read('../PRIVACY.md');
// Google Drive's bullets under What Glaze stores and Network requests; Safari offers Drive once its app sign-in is on
// (background/google-config.js native).
const SAFARI = require('../../extension/background/google-config.js').native === true;
const OFFERED = SAFARI ? 'Chrome, Edge, Brave, Firefox and Safari, off until you connect' : 'Chrome, Edge, Brave and Firefox, off until you connect; Safari doesn\'t offer it';
const STORED = `- **Google Drive** (${OFFERED}):`, NETWORK = `- **Google Drive** (${OFFERED}). The requests`;
const storedDrive = () => { const at = policy.indexOf(STORED); assert.ok(at > 0, STORED); return policy.slice(at, policy.indexOf('- **Gradescope in To Do**', at)); };

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
    assert.ok(text.replaceAll('**', '').includes(`Google Drive (${OFFERED})`), `${file}: where Drive is offered`);
    assert.doesNotMatch(text, /Google Drive[^.]*unavailable in (?:this|the current) build|(?:future|later) build that enables/, file);
    assert.match(limited, /Drive/, file);
    assert.match(limited, /\[Google API Services User Data Policy\]\(https:\/\/developers\.google\.com\/terms\/api-services-user-data-policy\), including\s+the Limited Use requirements/, file);
  }
  const google = policy.slice(policy.indexOf('## Google user data'), policy.indexOf('## Hosting'));
  assert.match(google, /Google Drive \(Chrome, Edge, Brave and Firefox, off until you\s+connect\)/);
  assert.doesNotMatch(google, /Google Drive[^.]*unavailable/);
  assert.doesNotMatch(google, /Google Calendar sync[^.]*unavailable/);
  assert.match(google, /Google Drive access \(`drive\.file`/);
});

// Safari's refresh token in the Keychain is disclosed only while Safari offers Drive.
test('Google Drive storage disclosures include the account id, and Safari\'s refresh token while Safari offers Drive', () => {
  const stored = storedDrive();
  assert.match(stored, /\{ email, sub, flow, at \}/);
  for (const text of [stored, read('../docs/privacy.md')]) {
    if (SAFARI) assert.match(text, /refresh token[^.]*Keychain/i);
    else assert.doesNotMatch(text, /Keychain|refresh token/i);
    assert.match(text, /access\s+tokens?[^.]*memory/i);
  }
  assert.match(read('../docs/privacy.md'), /Google account id/);
  assert.doesNotMatch(policy, /Safari will (?:keep it|use[^.]*keep it)\s+in the Keychain/);
});

// Save to Drive keeps the file it made on the document with its revision (documents/drive.js serve: record.set(key, { id,
// as, rev, mod })) and tags the file with its bytes' SHA-256 (appProperties b): the policy says so, that the next Save
// updates that file, and that one edited outside Glaze is never overwritten (owner, 2026-10-31).
test('Save to Drive discloses what it keeps on the document and the file, and that it never overwrites an outside edit', () => {
  const src = read('documents/drive.js');
  assert.match(src, /record\.set\(m\.key, \{ id: r\.id, as: m\.as, \.\.\.\(r\.rev && \{ rev: r\.rev \}\), \.\.\.\(r\.mod && \{ mod: r\.mod \}\) \}\)/);
  assert.match(src, /appProperties: \{ b: await digest\(bytes\) \}/);
  const save = policy.slice(policy.indexOf('  - **Save to Drive**'), policy.indexOf('  - **Sync to Google Drive**'));
  assert.match(save, /Drive id[^.]*revision[^.]*on the document/);
  assert.match(save, /SHA-256/);
  assert.match(save, /next Save\s+updates/);
  assert.match(save, /edited outside Glaze[^.]*new file beside it/);
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

// Disconnect is this device only (owner, 2026-10-31): Calendar's and Drive's forget the sign-in here and never revoke
// Google's grant; removing Glaze everywhere is Google's own account page, which the privacy texts name.
test('Disconnect, for Calendar and Drive, is disclosed as this device only, never revoking Google\'s access', () => {
  const bg = read('background/background.js');
  const bye = bg.slice(bg.indexOf('  disconnect: async (m) => {'), bg.indexOf('  sync: async (m, epoch) => {'));
  assert.ok(bye.length > 0);
  assert.doesNotMatch(bye + read('planner/gcal.js') + read('background/google.js'), /GZ_GCAL\.revoke|REVOKE|oauth2\.googleapis\.com\/revoke/, 'the code: nothing revokes');
  assert.match(bye, /if \(!driveOn\) await Promise\.resolve\(\)\.then\(releaseIdentity\)/, 'the code: identity goes once Drive isn\'t connected either');
  const network = policy.slice(policy.indexOf('## Network requests'));
  assert.ok(network.includes(NETWORK), NETWORK);
  const calendar = network.slice(network.indexOf('- **Google Calendar sync**'), network.indexOf(NETWORK));
  const drive = network.slice(network.indexOf(NETWORK), network.indexOf('- **Tasks on course cards**'));
  for (const [name, part] of [['Calendar', calendar], ['Drive', drive]]) {
    assert.doesNotMatch(part, /revocation|to revoke|asks Google to revoke/, name);
    const d = part.slice(part.indexOf('**Disconnect**'));
    assert.match(d, /this device only\s+and\s+doesn't\s+revoke/, name);
    assert.match(d, /other\s+devices/, name);
    assert.match(d, /https:\/\/myaccount\.google\.com\/connections/, name);
  }
  assert.match(calendar.slice(calendar.indexOf('**Disconnect**')), /`identity`[^.]*unless Google Drive\s+is\s+connected\s+on\s+this\s+device/);
  assert.match(drive.slice(drive.indexOf('**Disconnect**')), /`identity`[^.]*unless Google Calendar sync\s+is\s+connected\s+on\s+this\s+device/);
  const identity = policy.slice(policy.indexOf('- `identity` (Chrome, Edge and Brave, optional; Firefox, from install)'), policy.indexOf('- `unlimitedStorage`'));
  assert.match(identity, /Calendar's Disconnect removes it unless Google\s+Drive is connected on this device, and Drive's unless Google Calendar sync is\./);
  assert.match(identity, /Firefox has no optional `identity`, so\s+its package holds it from install/);
  const docs = read('../docs/privacy.md');
  assert.doesNotMatch(docs, /revokes? access|to revoke/i);
  assert.match(docs, /\*\*Disconnect\*\* deletes them on this device only[^.]*unless Google Drive/);
  assert.match(docs, /Disconnect forgets the sign-in on this device only[^.]*myaccount\.google\.com\/connections/);
});

test('Safari\'s nativeMessaging names Google Drive while Safari offers it, and the storage permission names Sync to Google Drive', () => {
  assert.match(read('background/background.js'), /native: \(message\) => chrome\.runtime\.sendNativeMessage\(GZ_GOOGLE\.APP, message\)/, 'the code: Safari signs in through the handler');
  const native = policy.slice(policy.indexOf('- `nativeMessaging`'), policy.indexOf('- `activeTab`'));
  if (SAFARI) assert.match(native, /Google Drive/);
  else assert.doesNotMatch(native, /Google Drive/);
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
  const stored = storedDrive();
  for (const k of keys) assert.ok(stored.includes(`\`${k}${k.endsWith(':') ? '…' : ''}\``), `PRIVACY.md names ${k}`);
  assert.doesNotMatch(stored, /While \*\*Sync to Google Drive\*\* is on, `chrome\.storage\.local` also holds/);
  assert.match(stored, /Sync to Google Drive\*\* is on, `chrome\.storage\.local` also holds its state[^:]*turned off/);
});

// Safari signs in with the authorization code flow in its handler (safari/…/GlazeGoogle.swift): the code is exchanged and
// access tokens renewed at oauth2.googleapis.com/token. Both privacy texts name that host while Safari offers Drive, and only then.
test('Safari\'s token requests to oauth2.googleapis.com are disclosed in both privacy texts while Safari offers Drive', () => {
  const swift = fs.readFileSync(path.join(__dirname, '../../safari/Glaze/Glaze Extension/GlazeGoogle.swift'), 'utf8');
  assert.match(swift, /static let tokenURL = URL\(string: "https:\/\/oauth2\.googleapis\.com\/token"\)!/);
  assert.match(swift, /"grant_type": "refresh_token"/);
  const at = policy.indexOf(NETWORK), network = policy.slice(at, policy.indexOf('  - **Connect**', at));
  assert.ok(at > 0 && network.length > 0);
  if (!SAFARI) {
    for (const text of [network, read('../docs/privacy.md')]) assert.doesNotMatch(text, /oauth2\.googleapis\.com/);
    return;
  }
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
  const stored = storedDrive();
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

// Sync's own state (documents/drive-sync.js setState, background/drive-store.js snapshot) keeps the retry bookkeeping (fails,
// wait, busy) and when the day's snapshot was last tried (snap) in driveSync: the storage disclosure names each.
test('Sync to Google Drive\'s storage disclosure names the retry bookkeeping and the snapshot time it keeps in driveSync', () => {
  assert.match(read('documents/drive-sync.js'), /await setState\(\{ problem: why, busy: 0, fails, wait: now\(\) \+ Math\.min\(WAIT\.most, WAIT\.run \* 2 \*\* \(fails - 1\)\) \}\);/, 'the code: a failed run');
  assert.match(read('documents/drive-sync.js'), /await setState\(\{ busy: now\(\) \}\);/, 'the code: a run under way');
  assert.match(read('background/drive-store.js'), /await ctx\.state\(\{ snap: now\(\), snapSkip: null \}\);/, 'the code: the day\'s try');
  const stored = storedDrive();
  const state = stored.slice(stored.indexOf('also holds its state'), stored.indexOf('(`driveSync`)'));
  for (const k of ['fails', 'wait', 'busy', 'snap', 'snapSkip']) assert.ok(state.includes(`\`${k}\``), `driveSync's ${k} named`);
});

// Sync's transfers (documents/drive-sync.js env.staged, which background/background.js sets): a file over 5 MB goes in pieces
// over several runs, its bytes waiting in glaze-drive, its session and progress in driveSyncMoves; only an item past what
// a transfer carries (a JSON copy over MAX_JSON, a record over drive-store.js MAX) stays on the device, marked
// (driveSyncLarge). The day's zip leaves documents' files out. Both privacy texts say so.
test('Sync to Google Drive\'s privacy texts say large files go in pieces and only items past its ceiling stay on the device', () => {
  assert.match(read('documents/drive-sync.js'), /const staging = env\.staged === true;/, 'the code: staging when asked for');
  assert.match(read('background/background.js'), /\bstaged: true,/, 'the code: the worker asks for it');
  assert.match(read('documents/drive-sync.js'), /const MAX_JSON = 64e6;/, 'the code: a JSON copy up to 64 MB');
  assert.match(read('background/drive-store.js'), /const MAX = 32 << 20;/, 'the code: a record up to 32 MB');
  assert.match(read('background/background.js'), /GZ_BACKUP\.pack\(\{ settings, tasks: \{ tasks, pets \}, local: all, notes, version: chrome\.runtime\.getManifest\(\)\.version \}\)/, 'the code: no files in the zip');
  const stored = storedDrive();
  assert.match(stored, /for a file over 5 MB on its way to or from Drive, which file it is, the SHA-256 of its\s+bytes, the address of its resumable upload session and how far it has come \(`driveSyncMoves`\)/);
  assert.match(stored, /in Glaze's own IndexedDB `glaze-drive`, which only its background worker opens/);
  assert.doesNotMatch(stored, /keeps nothing there/);
  const sync = policy.slice(policy.indexOf('  - **Sync to Google Drive**'), policy.indexOf('  - **Submit from Drive**'));
  assert.match(sync, /A file over 5 MB[^.]*goes up or comes in in pieces/);
  assert.match(sync, /JSON copy would be over 64 MB, or\s+a record over 32 MB, doesn't sync: it stays on this device/);
  assert.doesNotMatch(sync, /doesn't sync yet/);
  assert.match(sync, /without their\s+files/);
  const short = read('../docs/privacy.md');
  assert.match(short, /a file over 5 MB goes up or comes in in pieces, waiting between runs in Glaze's own IndexedDB `glaze-drive`/);
  assert.match(short, /a JSON copy over 64 MB, a record over 32 MB\) stays on this device/);
  assert.doesNotMatch(short, /doesn't sync yet/);
});
