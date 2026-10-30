'use strict';
// hdiutil create can fail transiently (a busy disk image service). The release's DMG step says why and tries again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'make-dmg.sh');
const src = fs.readFileSync(script, 'utf8');
const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('make-dmg prints hdiutil\'s error instead of hiding it', () => {
  assert.doesNotMatch(code, /hdiutil create[^\n]*-quiet/);
});

test('make-dmg tries hdiutil create again after a failure, a bounded number of times', () => {
  const create = code.indexOf('hdiutil create');
  assert.ok(create > 0);
  const loop = code.lastIndexOf('while', create);
  assert.ok(loop >= 0 && create - loop < 400, 'hdiutil create sits inside a retry loop');
  assert.match(code.slice(loop, create + 400), /-ge 3|-lt 3|attempt/);
});

// Every packaging/signing tool is a fixture. Only ordinary shell/file utilities and
// the JSON parser run for real; no app, credentials, or installed Safari data are used.
function runDmg(t, failures) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-dmg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const stage = path.join(dir, 'stage with spaces');
  const app = path.join(dir, 'Fixture App.app');
  const out = path.join(dir, 'fixture image.dmg');
  for (const folder of [bin, stage, app]) fs.mkdirSync(folder);
  fs.writeFileSync(path.join(app, 'fixture.txt'), 'fixture app');
  const shim = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const name = path.basename(process.argv[1]), args = process.argv.slice(2);
const dir = process.env.DMG_TEST_DIR, log = path.join(dir, 'calls.jsonl');
fs.appendFileSync(log, JSON.stringify({ name, args }) + '\\n');
if (name === 'hdiutil') {
  const count = path.join(dir, 'attempts');
  const attempt = (fs.existsSync(count) ? Number(fs.readFileSync(count, 'utf8')) : 0) + 1;
  fs.writeFileSync(count, String(attempt));
  const out = args[args.length - 1];
  if (fs.existsSync(out) && !args.includes('-ov')) process.exit(17);
  const failed = attempt <= Number(process.env.DMG_TEST_FAILURES);
  fs.writeFileSync(out, failed ? 'partial ' + attempt + '\\n' : 'complete image\\n');
  if (failed) {
    if (!args.includes('-quiet')) process.stderr.write('hdiutil: simulated failure ' + attempt + '\\n');
    process.exit(16);
  }
} else if (name === 'ditto') {
  fs.cpSync(args[0], args[1], { recursive: true });
} else if (name !== 'sleep') {
  const file = name === 'xcrun' ? args[2] : args[args.length - 1];
  if (fs.readFileSync(file, 'utf8') !== 'complete image\\n') process.exit(18);
  if (name === 'xcrun' && args[0] === 'notarytool') console.log('{"status":"Accepted"}');
  if (name === 'shasum') console.log('fixture-sha256  ' + file);
}
`;
  for (const name of ['ditto', 'hdiutil', 'sleep', 'codesign', 'xcrun', 'spctl', 'shasum']) {
    fs.writeFileSync(path.join(bin, name), shim, { mode: 0o755 });
  }
  const result = spawnSync('/bin/sh', [script, app, out], {
    cwd: dir, encoding: 'utf8', timeout: 15000,
    env: {
      PATH: `${bin}:/usr/bin:/bin`, TMPDIR: stage,
      SAFARI_SIGN_IDENTITY: 'fixture identity', NOTARY_PROFILE: 'fixture profile',
      DMG_TEST_DIR: dir, DMG_TEST_FAILURES: String(failures),
    },
  });
  assert.ifError(result.error);
  const calls = fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(fs.readdirSync(stage), [], 'the staging directory is removed on exit');
  return { result, calls, out };
}

for (const failures of [0, 2]) {
  test(`make-dmg completes after ${failures} failures and signs only the overwritten image`, (t) => {
    const { result, calls, out } = runDmg(t, failures);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(calls.map(({ name }) => name), [
      'ditto', ...Array.from({ length: failures }, () => ['hdiutil', 'sleep']).flat(),
      'hdiutil', 'codesign', 'xcrun', 'xcrun', 'spctl', 'shasum',
    ]);
    assert.deepEqual(calls.filter(({ name }) => name === 'sleep').map(({ args }) => args), Array.from({ length: failures }, () => ['5']));
    assert.equal(result.stderr, Array.from({ length: failures }, (_, i) => `hdiutil: simulated failure ${i + 1}\n`).join(''));
    assert.equal(fs.readFileSync(out, 'utf8'), 'complete image\n');
    assert.match(result.stdout, /Built /);
    assert.equal(fs.readFileSync(`${out}.sha256`, 'utf8'), 'fixture-sha256  fixture image.dmg\n');
  });
}

test('make-dmg stops after three failures without signing or notarizing the partial image', (t) => {
  const { result, calls, out } = runDmg(t, 3);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(calls.map(({ name }) => name), ['ditto', 'hdiutil', 'sleep', 'hdiutil', 'sleep', 'hdiutil']);
  assert.deepEqual(calls.filter(({ name }) => name === 'sleep').map(({ args }) => args), [['5'], ['5']]);
  assert.equal(result.stderr, 'hdiutil: simulated failure 1\nhdiutil: simulated failure 2\nhdiutil: simulated failure 3\nmake-dmg: hdiutil create failed 3 times\n');
  assert.equal(fs.readFileSync(out, 'utf8'), 'partial 3\n');
  assert.equal(result.stdout, '');
  assert.equal(fs.existsSync(`${out}.sha256`), false);
});
