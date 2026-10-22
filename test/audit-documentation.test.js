const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../lib/gcal.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const paragraphs = (text) => text.split(/\n\s*\n/).map((s) => s.replace(/\s+/g, ' '));
const sentences = (text) => paragraphs(text).flatMap((s) => s.split(/(?<=[.!?])\s+(?=[A-Z])/u));
const policy = read('PRIVACY.md');
const summary = read('docs/privacy.md');

// Accept either an explanation in the short guide or a link to the actual detailed section.
const topics = [
  ['encrypted sharing', /shar(?:ing|ed|e)\b/i, /encrypt|relay|server|key/i, 'optional-encrypted-share-sessions'],
  ['mod permissions', /\bmods?\b/i, /permission|grant|sandbox/i, 'user-installed-mods'],
  ['conditional blocklist requests', /\bblocklist\b/i, /Chrome|daily|day|request|signed/i, 'signed-mod-blocklist'],
  ['private backup keys', /backup|export|ZIP/i, /(?:share|session) keys|delete tokens/i, 'optional-encrypted-share-sessions'],
];
for (const [name, subject, facts, anchor] of topics) {
  test(`GZ-03: the privacy summary explains or directly links ${name}`, () => {
    assert.ok(paragraphs(policy).some((s) => subject.test(s) && facts.test(s)),
      'the detailed policy must establish the behavior being checked');
    const explained = sentences(summary).some((s) => subject.test(s) && facts.test(s));
    const linked = [...summary.matchAll(/\]\(([^)]+)\)/g)]
      .some(([, href]) => href === `../PRIVACY.md#${anchor}`);
    assert.ok(explained || linked,
      `the short guide omits ${name}; its generic full-policy link does not resolve the missing description`);
  });
}

const unavailable = /unavailable|not (?:yet )?available|not enabled|disabled|coming soon|future|not shipped|pending (?:verification|approval)|off until Google|when (?:available|supported)|where available/i;
for (const file of ['README.md', 'docs/privacy.md']) {
  test(`GZ-04: ${file} does not advertise disabled Google Calendar sync as connectable`, () => {
    if (G.ON) return;
    const claims = sentences(read(file)).filter((s) => /Google Calendar sync/i.test(s));
    const unqualified = claims.filter((s) => !unavailable.test(s));
    assert.deepEqual(unqualified, [],
      'Google Calendar sync is disabled at build time; current feature claims must disclose that or be removed');
  });
}

test('GZ-04 control: availability wording distinguishes a build gate from an ordinary connection toggle', () => {
  assert.ok(unavailable.test('Google Calendar sync is unavailable in this build.'));
  assert.ok(unavailable.test('Google Calendar sync is pending verification.'));
  assert.ok(!unavailable.test('Google Calendar sync is off until you connect.'));
});

test('GZ-07: named contributor and feature-decision documents resolve in a fresh checkout', () => {
  const missing = [];
  for (const file of ['CONTRIBUTING.md', 'lib/gcal.js']) {
    for (const name of new Set(read(file).match(/\b[A-Z][A-Z0-9_-]*\.md\b/g) || [])) {
      if (!fs.existsSync(path.join(root, name))) missing.push(`${file} refers to missing ${name}`);
    }
  }
  assert.deepEqual(missing, [], 'contributors must be able to follow the stated decision references');
});

// The privacy policy's numbers follow the code that enforces them (audit BLD-3, BLD-5; WP-B1 items 10 and 12).
const code = (file) => read(file);

test('BLD-3: the policy lists Ultra file-preview ticket renewals with the code\'s own pace', () => {
  const docs = code('features/docs.js');
  assert.match(docs, /tries < 20\) setTimeout\(\(\) => renew\(f, tries \+ 1\), 15000\)/, 'renewal pace changed: update PRIVACY.md and this test');
  assert.match(docs, /slice\(0, 5\)/, 'renewal address count changed: update PRIVACY.md and this test');
  const bullet = paragraphs(policy.slice(policy.indexOf('## Network requests'))).find((s) => /File previews on Blackboard Ultra/.test(s));
  assert.ok(bullet, 'the request list has a file-previews entry');
  for (const fact of [/\/learn\/api\//, /about every 15 seconds/, /twenty more times/, /five newest/, /no separate switch/]) assert.match(bullet, fact);
});

test('WP-B1 item 12: the policy states the request queue\'s limits', () => {
  const q = code('lib/lmsq.js');
  assert.match(q, /const MAX = 3, CAP = 600000;/, 'queue limits changed: update PRIVACY.md and this test');
  assert.match(q, /Retry-After/);
  assert.match(policy, /at most three requests at a time/);
  assert.match(policy, /`Retry-After` header, otherwise for\s+2 seconds, doubling[^.]*up to ten minutes/);
});

test('WP-B1 item 10: the policy states the relay\'s expiry periods', () => {
  const relay = code('server/relay.js');
  assert.match(relay, /expiryDays = 365, idleDays = 730, emptyDays = 2/, 'relay expiry defaults changed: update PRIVACY.md, docs/features.md and this test');
  assert.match(policy, /nobody has used for two years is deleted \(one year if its creator chose/);
  assert.match(policy, /never written to is removed after two unused days/);
  assert.match(code('docs/features.md'), /nobody has used for two years is deleted \(one year if its creator opted/);
  assert.match(relay, /stored: \[2 \*\* 30, DAY, 1\]/, 'daily stored budget changed: update PRIVACY.md (1 GiB a day)');
  assert.match(policy, /daily amount of new stored data, 1 GiB/);
});

test('BLD-5: the permission text matches the manifest and the packaging scripts', () => {
  const manifest = JSON.parse(code('manifest.json'));
  assert.ok(manifest.permissions.includes('unlimitedStorage'));
  assert.ok(!/doesn't ask for unlimited/i.test(policy));
  assert.match(policy, /Glaze asks the browser for\s+`unlimitedStorage`/);
  assert.equal(G.ON, false, 'Google Calendar sync is built off, so released builds omit identity');
  assert.match(code('package.sh'), /filter\(\(p\) => p !== "identity"\)/);
  assert.match(code('scripts/package-firefox.sh'), /filter\(\(p\) => p !== 'identity'\)/);
  assert.match(code('scripts/safari-manifest.sh'), /p != 'identity'/);
  assert.match(policy, /`identity` \(Chrome only, optional\) — not requested by released builds/);
  assert.match(policy, /Chrome sync \(or Firefox Sync\)/);
  assert.match(policy, /\*\*Music widget\*\* \(Canvas and Blackboard Ultra/);
  assert.ok(/music/.test(code('lib/widgets.js').match(/const TILES = \[[^\]]*\]/)[0]), 'the music tile is a widget on both sites');
});
