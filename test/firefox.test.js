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
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
