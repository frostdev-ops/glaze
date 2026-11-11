// The Mac app's Sparkle settings and the appcast tool must agree. An app told to require a signed feed (Sparkle 2.9+,
// with SUVerifyUpdateBeforeExtraction) ignores every feed that isn't signed as Sparkle 2.10 reads it, so the appcast tool
// must sign the feed first; until it does, the key stays off and the staging script says why, where the keys are set.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const stage = read('tools/build/stage-safari-dmg.py'), appcast = read('tools/release/safari-appcast.sh');
const code = stage.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

test('the staged app requires a signed feed only if the appcast tool signs the feed', () => {
  if (/SURequireSignedFeed/.test(code)) {
    assert.match(code, /SUVerifyUpdateBeforeExtraction/, 'Sparkle needs it for signed feeds');
    assert.match(appcast, /sparkle-signatures/, 'the appcast tool signs the feed');
  } else {
    assert.doesNotMatch(appcast, /sparkle-signatures/, 'the tool signs a feed nothing requires: turn the requirement on, with its proof');
  }
});

test('where the Sparkle keys are set, the staging script says why SURequireSignedFeed stays off and what turning it on takes', () => {
  if (/SURequireSignedFeed/.test(code)) return;
  const comment = stage.split('\n').filter((line) => /^\s*#/.test(line)).join('\n');
  assert.match(comment, /SURequireSignedFeed/);
  assert.match(comment, /stays off/);
  assert.match(comment, /generate_appcast/, 'the only documented feed signer, which this pipeline does not use');
  assert.match(comment, /sparkle-signatures/, 'the block the appcast tool would have to append');
  assert.match(comment, /SUVerifyUpdateBeforeExtraction/);
  assert.ok(stage.indexOf('SURequireSignedFeed') < stage.indexOf('SUPublicEDKey=public_key'), 'next to the keys');
});
