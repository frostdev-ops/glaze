const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const m = require('../manifest.json');

const [glaze, detector] = m.content_scripts;

test('Ultra matches its bare entry and descendants without matching lookalike paths', () => {
  assert.deepEqual(glaze.matches.filter((pattern) => pattern.includes('/ultra')), ['https://*/ultra', 'https://*/ultra/*']);
});

// lib/background.js injects and registers content_scripts[0].js for hosts the detector finds.
test('the first content script is Glaze, and the detector covers the rest of https', () => {
  assert.equal(glaze.js.at(-1), 'content.js');
  assert.deepEqual(detector.js, ['lib/detect.js']);
  assert.deepEqual(detector.matches, ['https://*/*']);
  assert.deepEqual(detector.exclude_matches, glaze.matches, 'what Glaze already matches is not detected twice');
  assert.ok(!detector.all_frames, 'top frame only');
  assert.equal(detector.run_at, 'document_start');
});

test('injecting and registering need scripting and host access', () => {
  assert.ok(m.permissions.includes('scripting'));
  assert.deepEqual(m.host_permissions, ['https://*/*']);
});

test('every content script file exists', () => {
  for (const f of m.content_scripts.flatMap((c) => c.js)) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
});
