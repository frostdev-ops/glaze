const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const m = require('../manifest.json');

// Glaze's first content script, one entry per site with its own part: Ultra's and Canvas's.
const glaze = m.content_scripts.filter((c) => c.js.at(-1) === 'content.js');
const [ultra, canvas] = glaze;
const detector = m.content_scripts.find((c) => c.js.includes('lib/detect.js'));

test('Ultra matches its bare entry and descendants without matching lookalike paths', () => {
  assert.deepEqual(ultra.matches, ['https://*/ultra', 'https://*/ultra/*']);
  assert.ok(ultra.js.includes('content-ultra.js') && !canvas.js.includes('content-ultra.js'));
});

// lib/background.js injects and registers the Canvas entry's list for Canvas hosts the detector finds, and that list
// without content-canvas.js for Moodle hosts.
test('the first content script is Glaze, and the detector covers the rest of https', () => {
  assert.equal(glaze.length, 2);
  assert.deepEqual(canvas.matches, ['https://*.instructure.com/*']);
  assert.ok(canvas.js.includes('content-canvas.js') && !ultra.js.includes('content-canvas.js'));
  for (const g of glaze) assert.deepEqual([g.run_at, g.all_frames], ['document_start', true]);
  // The two never both match a page: one list each, as the one entry was. Canvas's leaves canvadocs to its viewer script.
  assert.deepEqual(ultra.exclude_matches, canvas.matches);
  assert.deepEqual(canvas.exclude_matches, ['https://canvadocs.instructure.com/*']);
  assert.deepEqual(detector.js, ['lib/detect.js']);
  assert.deepEqual(detector.matches, ['https://*/*']);
  assert.deepEqual(detector.exclude_matches, glaze.flatMap((g) => g.matches), 'what Glaze already matches is not detected twice');
  assert.ok(!detector.all_frames, 'top frame only');
  assert.equal(detector.run_at, 'document_start');
});

test('injecting and registering need scripting and host access', () => {
  assert.ok(m.permissions.includes('scripting'));
  assert.deepEqual(m.host_permissions, ['https://*/*']);
});

test('Chrome retains exactly its existing permissions without native messaging', () => {
  assert.deepEqual(m.permissions, ['storage', 'scripting', 'unlimitedStorage']); // notes are never cleared for space (owner, 2026-10-15)
  assert.ok(!m.permissions.includes('nativeMessaging'));
});

test('Safari manifest rewriting adds native messaging once and preserves unrelated fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-safari-manifest-'));
  const file = path.join(dir, 'manifest.json');
  const input = structuredClone(m);
  input.custom_field = { retained: true };
  input.permissions.push('nativeMessaging');
  fs.writeFileSync(file, JSON.stringify(input));
  const expected = structuredClone(input);
  delete expected.options_ui.open_in_tab;
  delete expected.oauth2; // Safari has no identity API: Google Calendar sync is Chrome's
  delete expected.optional_permissions;
  expected.description = 'Restyle Blackboard Ultra and Canvas: palettes, fonts, backgrounds and motion, plus handy extras.';
  for (const entry of expected.web_accessible_resources) delete entry.use_dynamic_url;
  try {
    const rewrite = () => execFileSync('sh', [path.join(__dirname, '../scripts/safari-manifest.sh'), file]);
    rewrite();
    const once = fs.readFileSync(file, 'utf8');
    assert.deepEqual(JSON.parse(once), expected);
    rewrite();
    assert.equal(fs.readFileSync(file, 'utf8'), once);

    // A clean Chrome manifest also gains the permission on its first conversion.
    fs.writeFileSync(file, JSON.stringify(m));
    rewrite();
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).permissions, ['storage', 'scripting', 'unlimitedStorage', 'nativeMessaging']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every content script file exists', () => {
  for (const f of m.content_scripts.flatMap((c) => c.js)) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
});
