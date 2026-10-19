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

test('injecting and registering need scripting and host access; course tabs\' pictures need <all_urls>', () => {
  assert.ok(m.permissions.includes('scripting'));
  // chrome.tabs.captureVisibleTab takes <all_urls> or activeTab (owner, 2026-10-15); it covers every optional host too.
  assert.deepEqual(m.host_permissions, ['<all_urls>']);
  assert.equal(m.optional_host_permissions, undefined, 'Chrome flags and drops optional hosts the required ones cover');
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
  expected.description = 'Restyle Blackboard Ultra, Canvas and Moodle: palettes, fonts, backgrounds and motion, plus handy extras.';
  for (const entry of expected.web_accessible_resources) delete entry.use_dynamic_url;
  // Safari has no manifest sandbox (MDN: not supported on macOS or iOS), so no code mods: their page, CSP and files go.
  delete expected.sandbox;
  delete expected.content_security_policy.sandbox;
  expected.web_accessible_resources = expected.web_accessible_resources.filter((e) => !e.resources.every((r) => r.startsWith('mods/')));
  try {
    const rewrite = () => execFileSync('sh', [path.join(__dirname, '../scripts/safari-manifest.sh'), file]);
    rewrite();
    const once = fs.readFileSync(file, 'utf8');
    assert.deepEqual(JSON.parse(once), expected);
    rewrite();
    assert.equal(fs.readFileSync(file, 'utf8'), once);
    // A staged copy loses the mods host's files too.
    fs.mkdirSync(path.join(dir, 'mods'));
    fs.writeFileSync(path.join(dir, 'mods', 'host.html'), '');
    rewrite();
    assert.ok(!fs.existsSync(path.join(dir, 'mods')));

    // A clean Chrome manifest also gains the permission on its first conversion.
    fs.writeFileSync(file, JSON.stringify(m));
    rewrite();
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).permissions, ['storage', 'scripting', 'unlimitedStorage', 'nativeMessaging']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Code mods (2026-10-17) add the second page a site may frame, mods/host.html: a manifest sandbox
// page (opaque origin, no extension APIs) under its own CSP, which lets no request, frame or inline script out, and eval in
// that sandbox only. Its bootstrap, mods/boot.js, is the only other file it exposes. Both on dynamic URLs.
const SANDBOX_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:; font-src data: blob:; worker-src blob:; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'";
test('Glaze\'s pages may compile WebAssembly for the OCR engine, nothing more; Settings (as a page beside the navigation), the reader, the Notes share panel and the mods host are the pages a site may frame, and load only Glaze\'s files', () => {
  assert.deepEqual(m.content_security_policy, { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'", sandbox: SANDBOX_CSP });
  assert.deepEqual(m.web_accessible_resources.flatMap((w) => w.resources).filter((r) => /\.html?$/.test(r)), ['options.html', 'reader.html', 'sharing/quick.html', 'mods/host.html']);
  // The Notes share panel: Glaze's files only, no network from the page itself (the worker talks to the relay).
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'sharing/quick.html'), 'utf8'), /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">/);
  const reader = fs.readFileSync(path.join(__dirname, '..', 'reader.html'), 'utf8');
  assert.match(reader, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">/);
});

test('the mods host is the one sandbox page: no same-origin, no inline script, no requests, and only it and its bootstrap are exposed', () => {
  assert.deepEqual(m.sandbox, { pages: ['mods/host.html'] });
  const csp = Object.fromEntries(m.content_security_policy.sandbox.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(csp.sandbox, ['allow-scripts'], 'never allow-same-origin, forms, popups or top navigation');
  assert.deepEqual(csp['script-src'], ["'self'", "'unsafe-eval'"], "no 'unsafe-inline': boot.js is the only way a frame UI's code starts");
  for (const d of ['default-src', 'frame-src', 'connect-src']) assert.deepEqual(csp[d], ["'none'"], d);
  const war = m.web_accessible_resources.filter((w) => w.resources.some((r) => r.startsWith('mods/')));
  assert.deepEqual(war, [{ resources: ['mods/host.html', 'mods/boot.js'], matches: ['https://*/*'], use_dynamic_url: true }]);
  for (const f of ['mods/host.html', 'mods/host.js', 'mods/boot.js']) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
});

test('every content script file exists', () => {
  for (const f of m.content_scripts.flatMap((c) => c.js)) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
});
