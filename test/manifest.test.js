const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
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

test('Glaze\'s pages may compile WebAssembly for the OCR engine, nothing more; the reader is the one page a site may frame, and loads only Glaze\'s files', () => {
  assert.deepEqual(m.content_security_policy, { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" });
  assert.deepEqual(m.web_accessible_resources.flatMap((w) => w.resources).filter((r) => /\.html?$/.test(r)), ['reader.html']);
  const reader = fs.readFileSync(path.join(__dirname, '..', 'reader.html'), 'utf8');
  assert.match(reader, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">/);
});

test('every content script file exists', () => {
  for (const f of m.content_scripts.flatMap((c) => c.js)) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
});
