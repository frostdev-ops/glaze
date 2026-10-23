const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const m = require('../manifest.json');

// Glaze's first content script, one entry per LMS's own hosts: Ultra's and Canvas's, each with its own part, and MoodleCloud's.
const glaze = m.content_scripts.filter((c) => c.js.at(-1) === 'content.js');
const ultra = glaze.find((c) => c.js.includes('content-ultra.js'));
const canvas = glaze.find((c) => c.js.includes('content-canvas.js'));
const moodle = glaze.find((c) => c.matches.includes('https://*.moodlecloud.com/*'));
const D = require('../defaults.js');
// The Safari manifest scripts/safari-manifest.sh makes from `input`.
const safari = (input) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-safari-manifest-'));
  try {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(input));
    execFileSync('sh', [path.join(__dirname, '../scripts/safari-manifest.sh'), path.join(dir, 'manifest.json')]);
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
const V338 = require('./fixtures/manifest-v3.3.8.json');

test('Ultra matches its bare entry and descendants on Blackboard\'s hosts, without matching lookalike paths', () => {
  assert.deepEqual(ultra.matches, ['https://*.blackboard.com/ultra', 'https://*.blackboard.com/ultra/*']);
  assert.equal(ultra.exclude_matches, undefined, 'no instructure.com host to leave out');
  assert.ok(ultra.js.includes('content-ultra.js') && !canvas.js.includes('content-ultra.js'));
});

// lib/background.js registers the Canvas entry's list for Canvas hosts the student approved, and that list without
// content-canvas.js (as MoodleCloud's entry has it) for Moodle hosts; Ultra sites get Ultra's entry on their /ultra pages.
test('the first content script is Glaze on each LMS\'s own hosts, and nothing runs on other sites', () => {
  assert.equal(glaze.length, 3);
  assert.deepEqual(canvas.matches, ['https://*.instructure.com/*']);
  assert.ok(canvas.js.includes('content-canvas.js') && !ultra.js.includes('content-canvas.js'));
  for (const g of glaze) assert.deepEqual([g.run_at, g.all_frames], ['document_start', true]);
  assert.deepEqual(canvas.exclude_matches, ['https://canvadocs.instructure.com/*'], 'Canvas\'s leaves canvadocs to its viewer script');
  assert.deepEqual(moodle, { matches: ['https://*.moodlecloud.com/*'], js: canvas.js.filter((f) => f !== 'content-canvas.js'), run_at: canvas.run_at, all_frames: canvas.all_frames });
  assert.ok(!m.content_scripts.some((c) => c.js.includes('lib/detect.js')), 'no detector: Chrome\'s own prompt adds a site');
  assert.ok(m.content_scripts.every((c) => c.matches.every((p) => !p.startsWith('https://*/') && p !== '<all_urls>')), 'no entry on every host');
});

test('host access: each LMS\'s own hosts, Glaze\'s gallery and share relay; any other https site, local Canvas and Moodle only when granted', () => {
  assert.ok(m.permissions.includes('scripting'));
  assert.deepEqual(m.host_permissions, ['https://*.instructure.com/*', 'https://*.blackboard.com/*', 'https://*.moodlecloud.com/*', 'https://frostdev.io/*', 'https://share.frostdev.io/*']);
  assert.deepEqual(m.optional_host_permissions, ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
  // Every content script's host is held from the start.
  const held = (p) => m.host_permissions.some((h) => { const [, hh] = /^https:\/\/([^/]+)\//.exec(h), [, ph] = /^https:\/\/([^/]+)\//.exec(p); return hh === ph || (hh.startsWith('*.') && ph.endsWith(hh.slice(1))); });
  for (const c of m.content_scripts) for (const p of c.matches) assert.ok(held(p), p);
});

test('Chrome adds only activeTab and declarativeContent to its permissions, without native messaging', () => {
  assert.deepEqual(m.permissions, ['storage', 'scripting', 'unlimitedStorage', 'activeTab', 'declarativeContent']); // notes are never cleared for space (owner, 2026-10-15)
  assert.ok(!m.permissions.includes('nativeMessaging'));
});

// content.js, content-ultra.js, options.js and lib/background.js all ask defaults.js GZ_BUILT_IN.
test('the built-in hosts are the manifest\'s, in one place', () => {
  const host = (c) => /^https:\/\/\*\.([^/]+)\//.exec(c.matches[0])[1];
  for (const [kind, entry] of [['canvas', canvas], ['moodle', moodle], ['ultra', ultra]]) {
    const h = host(entry);
    assert.ok(m.host_permissions.includes(`https://*.${h}/*`), kind);
    assert.equal(D.GZ_BUILT_IN(kind, new URL(`https://school.${h}/x`)), true, `${kind} on school.${h}`);
    for (const u of [`https://school.${h}:8443/`, `http://school.${h}/`, `https://school.${h}.evil.test/`, `https://evil-${h}/`]) assert.equal(D.GZ_BUILT_IN(kind, new URL(u)), false, `${kind} ${u}`);
    for (const other of ['canvas', 'moodle', 'ultra'].filter((k) => k !== kind)) assert.equal(D.GZ_BUILT_IN(other, new URL(`https://school.${h}/`)), false, `${other} on ${h}`);
  }
  assert.equal(D.GZ_BUILT_IN(null, new URL('https://school.instructure.com/')), false, 'no LMS found');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['content.js', 'content-ultra.js', 'options.js', 'lib/background.js']) {
    assert.match(read(f), /GZ_BUILT_IN\(/, f);
    assert.doesNotMatch(read(f), /instructure\\\.com\$|blackboard\\\.com\$|endsWith\('\.(instructure|blackboard)\.com'\)/, `${f} keeps no host list of its own`);
  }
});

test('Safari keeps 3.3.8\'s access: every host, Ultra on /ultra anywhere and the detector; MoodleCloud\'s entry may stay', () => {
  const now = safari(m), then = safari(V338);
  for (const k of ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions']) assert.deepEqual(now[k], then[k], k);
  const detector = now.content_scripts.find((c) => c.js.includes('lib/detect.js'));
  assert.ok(detector.exclude_matches.includes('https://*.moodlecloud.com/*'), 'MoodleCloud has its own entry, so the detector leaves it alone');
  const as338 = now.content_scripts.filter((c) => !c.matches.includes('https://*.moodlecloud.com/*'))
    .map((c) => (c === detector ? { ...c, exclude_matches: c.exclude_matches.filter((p) => p !== 'https://*.moodlecloud.com/*') } : c));
  assert.deepEqual(as338, then.content_scripts);
  assert.deepEqual(now.content_scripts.find((c) => c.matches.includes('https://*.moodlecloud.com/*')), moodle);
});

test('the 3.3.8 manifest fixture is the tagged release\'s', (t) => {
  let tagged;
  try { tagged = execFileSync('git', ['show', 'v3.3.8:manifest.json'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return t.skip('no v3.3.8 tag in this clone'); }
  assert.equal(fs.readFileSync(path.join(__dirname, 'fixtures/manifest-v3.3.8.json'), 'utf8'), tagged);
});

test('Safari runs exactly one first bundle on MoodleCloud, including Ultra paths', () => {
  const entries = safari(m).content_scripts.filter((c) => c.js.includes('content.js'));
  const matches = (p, url) => {
    const [, host, pathname] = /^https:\/\/([^/]+)(\/.*)$/.exec(p), u = new URL(url);
    const hostOK = host === '*' || host === u.hostname || host.startsWith('*.') && (u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1)));
    const pathRE = new RegExp('^' + pathname.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return u.protocol === 'https:' && hostOK && pathRE.test(u.pathname);
  };
  for (const host of ['school.moodlecloud.com', 'moodlecloud.com']) for (const pathname of ['/my/', '/ultra', '/ultra/', '/ultra/course', '/ultralookalike']) {
    const url = `https://${host}${pathname}`;
    const first = entries.filter((c) => c.matches.some((p) => matches(p, url)) && !c.exclude_matches?.some((p) => matches(p, url)));
    assert.equal(first.length, 1, `${url} must not redeclare the shared bundle's globals`);
  }
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
  // Safari's access stays as it was (the test above).
  expected.permissions = ['storage', 'scripting', 'unlimitedStorage', 'nativeMessaging'];
  expected.host_permissions = ['<all_urls>'];
  delete expected.optional_host_permissions;
  expected.content_scripts = safari(m).content_scripts;
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
test('Glaze\'s pages may compile WebAssembly for the OCR engine, nothing more; Settings (as a page beside the navigation) and its live preview, the reader, the Notes share panel and the mods host are the pages a site may frame, and load only Glaze\'s files', () => {
  assert.deepEqual(m.content_security_policy, { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'", sandbox: SANDBOX_CSP });
  assert.deepEqual(m.web_accessible_resources.flatMap((w) => w.resources).filter((r) => /\.html?$/.test(r)), ['reader.html', 'sharing/quick.html', 'options.html', 'preview.html', 'mods/host.html']);
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
