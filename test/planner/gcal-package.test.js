// Calendar's development copy uses the packaged Google manifest, including Drive while it is enabled.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../../extension/planner/gcal.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');

test('the Chrome package carries Calendar and enabled Drive scopes; dev-gcal.sh adds only the store\'s key', () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-gcal-pkg-'));
  try {
    const keyFile = path.join(dir, 'key.txt');
    fs.writeFileSync(keyFile, require('node:crypto').randomBytes(294).toString('base64'));
    const env = { ...process.env, DIST: path.join(dir, 'dist') };
    execFileSync(path.join(__dirname, '../../tools/dev/dev-gcal.sh'), [keyFile, path.join(dir, 'dev')], { env, stdio: 'pipe' });
    const repo = require('../../extension/manifest.json');
    const zip = path.join(dir, 'dist', `glaze-v${repo.version}.zip`);
    const packed = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json']));
    const drive = require('../../extension/background/google.js');
    const config = require('../../extension/background/google-config.js');
    const scopes = [G.SCOPE, ...(drive.ON ? config.scopes : [])];
    const expected = { ...repo, oauth2: { ...repo.oauth2, scopes } };
    assert.deepEqual(packed, expected, 'the store manifest includes every enabled Google feature');
    assert.ok(packed.optional_permissions.includes('identity'));
    assert.ok(!('key' in packed), 'the store adds its own key');
    assert.match(execFileSync('unzip', ['-p', zip, 'planner/gcal.js']).toString(), /\n {2}const ON = true;\n/);
    assert.equal(packed.oauth2.scopes.includes('https://www.googleapis.com/auth/drive.file'), drive.ON, 'Drive scopes follow its build switch');
    const dev = JSON.parse(fs.readFileSync(path.join(dir, 'dev/manifest.json')));
    assert.deepEqual(dev, { ...packed, key: fs.readFileSync(keyFile, 'utf8') }, 'the dev copy: the store manifest and the key');
    assert.equal(fs.readFileSync(path.join(dir, 'dev/planner/gcal.js'), 'utf8'), read('planner/gcal.js'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
