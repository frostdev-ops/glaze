const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('public privacy descriptions disclose user-installed mod code and granted data/network access', () => {
  for (const file of ['README.md', 'PRIVACY.md', 'store/listing.md']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(text, /user-installed mods/i, file);
    assert.match(text, /sandbox/i, file);
    assert.match(text, /declared and granted/i, file);
    assert.match(text, /frame UI/i, file);
    assert.doesNotMatch(text, /None\. All executable code ships in the package/, file);
  }
  const privacy = fs.readFileSync(path.join(__dirname, '../PRIVACY.md'), 'utf8');
  assert.match(privacy, /Per-mod storage and its private-data classification remain/i);
});

test('gallery privacy discloses the media request without promising network anonymity', () => {
  const privacy = fs.readFileSync(path.join(__dirname, '../PRIVACY.md'), 'utf8').split('## The Looks gallery')[1].split('\n## ')[0];
  assert.doesNotMatch(privacy, /nothing is sent anywhere|no cookies, referrer or anything about you/i);
  assert.match(privacy, /no cookies or referrer/i);
  assert.match(privacy, /network address and normal browser headers/i);
  assert.match(privacy, /doesn't already keep/i);
});
