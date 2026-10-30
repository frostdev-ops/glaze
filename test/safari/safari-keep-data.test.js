const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const shell = (body, options = {}) => spawnSync('/bin/sh', ['-eu', '-c', body], { encoding: 'utf8', ...options });

// Run only validation fragments. Never build, register or copy an app.
test('the release signature scan checks Mach-O libraries without an execute bit', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-signature-test-'));
  try {
    const binary = path.join(temp, 'library with spaces.dylib');
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(0x0100000c, 4);
    header.writeUInt32LE(6, 12);
    fs.writeFileSync(binary, header, { mode: 0o644 });
    const scan = read('scripts/build-safari.sh').match(/^find "\$app"[^\n]*\n[\s\S]*?^done$/m)?.[0];
    assert.ok(scan);
    const log = path.join(temp, 'signatures.log');
    const body = `codesign() { printf '%s\\n' "$2" >> "$signature_log"; printf 'Authority=%s\\n' "$signature_authority"; }\n${scan}`;
    const env = { ...process.env, app: temp, identity: 'Release signer', signature_log: log };
    const wrong = shell(body, { env: { ...env, signature_authority: 'Another signer' } });
    assert.equal(wrong.status, 1, `unsigned library was skipped: ${wrong.stdout}${wrong.stderr}`);
    assert.equal(wrong.stderr.trim(), `build-safari: ${binary} is not signed with Release signer`);
    assert.equal(fs.readFileSync(log, 'utf8').trim(), binary);
    const signed = shell(body, { env: { ...env, signature_authority: 'Release signer' } });
    assert.equal(signed.status, 0, signed.stderr);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('a legacy release app stops the build before packaging or deleting anything', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-legacy-test-'));
  try {
    const build = read('scripts/build-safari.sh');
    const start = build.indexOf('\n', build.indexOf('version=$(node'));
    const preflight = build.slice(start, build.indexOf('./package.sh', start));
    const folder = path.join(temp, 'release/0/build');
    fs.mkdirSync(folder, { recursive: true });
    const marker = path.join(temp, 'plain-text-marker');
    fs.writeFileSync(marker, 'preserve');
    // A symlink to plain text exercises the path check without creating an app.
    const legacy = path.join(folder, 'Glaze.app');
    fs.symlinkSync(marker, legacy);
    const result = shell(`version=0\n${preflight}\nprintf 'packaging would run'`, { cwd: temp });
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.stderr.trim(), 'build-safari: release/0/build/Glaze.app must be removed with a Safari data backup before building.');
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve');
    assert.ok(fs.lstatSync(legacy).isSymbolicLink());
    assert.doesNotMatch(build, /^rm -rf "\$out\/build\/Glaze\.app"/m);
    fs.unlinkSync(legacy);
    const clean = shell(`version=0\n${preflight}\nprintf 'packaging would run'`, { cwd: temp });
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(clean.stdout, 'packaging would run');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
