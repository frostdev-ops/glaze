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
