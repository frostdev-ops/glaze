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
    execFileSync('sh', ['scripts/package-firefox.sh'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DIST: dist }, stdio: 'pipe' });
    const version = require('../manifest.json').version;
    const zip = path.join(dist, `glaze-v${version}-firefox.zip`);
    const files = new Set(execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n'));
    const m = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }));
    assert.equal(m.background.service_worker, undefined);
    assert.deepEqual(m.background.scripts.slice(0, 1), ['lib/firefox-background.js']);
    assert.equal(m.background.scripts.at(-1), 'lib/background.js');
    for (const f of m.background.scripts) assert.ok(files.has(f), `${f} is a background script but isn't packaged`);
    for (const f of ['lib/relay.js', 'lib/sessions.js', 'defaults.js']) assert.ok(m.background.scripts.includes(f), f);
    assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
    assert.equal(m.oauth2, undefined);
    assert.ok(!(m.optional_permissions || []).includes('identity'));
    assert.ok(m.web_accessible_resources.every((e) => !('use_dynamic_url' in e)));
    // Code mods need Chrome: no sandbox page, CSP or files, so content.js never starts them.
    assert.equal(m.sandbox, undefined);
    assert.deepEqual(m.content_security_policy, { extension_pages: require('../manifest.json').content_security_policy.extension_pages });
    assert.ok(m.web_accessible_resources.every((e) => e.resources.length && e.resources.every((r) => !r.startsWith('mods/'))));
    assert.ok(![...files].some((f) => f.startsWith('mods/') || f === 'features/mods.js'), 'no mods host, bootstrap or sandbox page side');
    assert.ok(files.has('lib/modbroker.js') && m.background.scripts.includes('lib/modbroker.js'), 'the worker imports the broker, so it ships');
    // Declarative widgets are not code: their page side, its renderer and the checks they run through ship, and nothing of theirs
    // reaches for the sandbox.
    for (const f of ['features/modwidgets.js', 'features/modui.js', 'lib/modwidget.js']) assert.ok(files.has(f), f);
    assert.ok(m.background.scripts.includes('lib/modwidget.js') && m.background.scripts.includes('lib/modapi.js'), 'the worker imports what checks a widget');
    for (const f of ['features/modwidgets.js', 'features/modui.js', 'lib/modwidget.js']) {
      const src = execFileSync('unzip', ['-p', zip, f], { encoding: 'utf8' });
      assert.ok(!/mods\/(host|boot)|GZ_MODS\b|sandbox/.test(src.replace(/\/\/.*$/gm, '')), `${f} needs nothing the package drops`);
    }
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
