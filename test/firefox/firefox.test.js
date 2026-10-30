// The Firefox package: its event page loads every script the Chrome worker imports, and the AMO keys are set.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

test('package-firefox.sh builds a Firefox manifest whose background scripts all ship', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-firefox-'));
  try {
    // Exercise package format from any source checkout; the separate release-readiness tests enforce provenance.
    execFileSync('sh', ['../tools/build/package-firefox.sh', '--development'], { cwd: path.join(__dirname, '../../extension'), env: { ...process.env, DIST: dist }, stdio: 'pipe' });
    const version = require('../../extension/manifest.json').version;
    const zip = path.join(dist, `glaze-v${version}-firefox.zip`);
    const files = new Set(execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n'));
    const m = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }));
    assert.equal(m.name, 'Glaze (Firefox development)');
    assert.equal(m.short_name, 'Glaze');
    assert.equal(m.default_locale, 'en');
    for (const lang of ['en', 'de', 'es', 'fr', 'nl', 'pt_BR']) assert.ok(files.has(`_locales/${lang}/messages.json`));
    assert.equal(m.background.service_worker, undefined);
    assert.deepEqual(m.background.scripts.slice(0, 1), ['background/firefox-background.js']);
    assert.equal(m.background.scripts.at(-1), 'background/background.js');
    for (const f of m.background.scripts) assert.ok(files.has(f), `${f} is a background script but isn't packaged`);
    for (const f of ['sharing/relay.js', 'sharing/sessions.js', 'content/defaults.js', 'navigation/sidebar.js', 'planner/gcal-auth.js']) assert.ok(m.background.scripts.includes(f), f);
    for (const f of ['navigation/page/sidebar.js', 'navigation/page/sidebar.css', 'courses/page/docreview.js', 'courses/page/docreview.css']) assert.ok(files.has(f), f);
    // Nothing without consent; agent access sends the student's course data to an app on this computer, outside the browser.
    assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'], optional: ['websiteContent'] });
    assert.equal(m.oauth2, undefined);
    assert.deepEqual(m.optional_permissions, ['nativeMessaging'], 'no identity; agent access asks for native messaging');
    assert.ok(m.web_accessible_resources.every((e) => !('use_dynamic_url' in e)));
    // Code mods need Chrome: no sandbox page, CSP or files, so content.js never starts them.
    assert.equal(m.sandbox, undefined);
    assert.deepEqual(m.content_security_policy, { extension_pages: require('../../extension/manifest.json').content_security_policy.extension_pages });
    assert.ok(m.web_accessible_resources.every((e) => e.resources.length && e.resources.every((r) => !r.startsWith('mods/'))));
    assert.ok(![...files].some((f) => ['mods/boot.js', 'mods/host.html', 'mods/host.js', 'mods/page/mods.js'].includes(f)), 'no mods host, bootstrap or sandbox page side');
    assert.ok(files.has('mods/modbroker.js') && m.background.scripts.includes('mods/modbroker.js'), 'the worker imports the broker, so it ships');
    // Agent access: the link and every MCP file are background scripts, the frames before the link, which reads them as it loads.
    for (const f of ['agents/agent-frames.js', 'agents/agent-link.js', 'mods/modtools.js', 'ai/failure.js', 'ai/loop.js', 'agents/grants.js', 'agents/registry.js',
      'agents/tools-study.js', 'agents/tools-grades.js', 'agents/wire.js', 'agents/approve.js', 'agents/calls.js']) assert.ok(m.background.scripts.includes(f), f);
    assert.ok(m.background.scripts.indexOf('agents/agent-frames.js') < m.background.scripts.indexOf('agents/agent-link.js'));
    for (const f of ['agents/approve.html', 'agents/approve-page.js', 'agents/approve.css']) assert.ok(files.has(f), f);
    // Declarative widgets are not code: their page side, its renderer and the checks they run through ship, and nothing of theirs
    // reaches for the sandbox.
    for (const f of ['mods/page/modwidgets.js', 'mods/page/modui.js', 'mods/modwidget.js']) assert.ok(files.has(f), f);
    assert.ok(m.background.scripts.includes('mods/modwidget.js') && m.background.scripts.includes('mods/modapi.js'), 'the worker imports what checks a widget');
    for (const f of ['mods/page/modwidgets.js', 'mods/page/modui.js', 'mods/modwidget.js']) {
      const src = execFileSync('unzip', ['-p', zip, f], { encoding: 'utf8' });
      assert.ok(!/mods\/(host|boot)|GZ_MODS\b|sandbox/.test(src.replace(/\/\/.*$/gm, '')), `${f} needs nothing the package drops`);
    }
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

// Firefox has no declarativeContent and no addHostAccessRequest (AMO's linter flags both), and its button starts on the toolbar
// for new installs (a Firefox-only key). The hosts are Chrome's: the built-in ones required, a school's own asked for.
test('package-firefox.sh: no declarativeContent or addHostAccessRequest, the button on the toolbar, the hosts as Chrome asks', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-firefox-'));
  try {
    execFileSync('sh', ['../tools/build/package-firefox.sh', '--development'], { cwd: path.join(__dirname, '../../extension'), env: { ...process.env, DIST: dist }, stdio: 'pipe' });
    const chrome = require('../../extension/manifest.json');
    const zip = path.join(dist, `glaze-v${chrome.version}-firefox.zip`);
    const m = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }));
    assert.deepEqual(m.permissions, chrome.permissions.filter((p) => p !== 'declarativeContent'));
    assert.ok(m.permissions.includes('activeTab'));
    assert.equal(m.action.default_area, 'navbar');
    assert.equal(chrome.action.default_area, undefined, "Chrome's manifest has no Firefox-only key");
    assert.deepEqual(m.host_permissions, chrome.host_permissions);
    assert.deepEqual(m.optional_host_permissions, chrome.optional_host_permissions);
    assert.ok(m.optional_host_permissions.includes('https://*/*'));
    const popup = execFileSync('unzip', ['-p', zip, 'settings/popup.js'], { encoding: 'utf8' });
    assert.ok(!popup.includes('addHostAccessRequest'), "the Firefox popup doesn't name Chrome's extensions-menu request");
    assert.ok(popup.includes('chrome.permissions.request({ origins: [site.pattern] })'), 'the popup still asks for the site');
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
