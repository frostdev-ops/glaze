// The release command logs each command it runs, on the console and at the top of the step's log file. No value from the
// credentials file, and nothing after a credential flag, may appear in either.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const load = () => import('../scripts/store-release.mjs');
const SECRET = { ASC_KEY_ID: 'KEYXYZ7788', ASC_ISSUER_ID: 'issuer-5c1e-4b7a', AMO_JWT_ISSUER: 'user:999:42', SPARKLE_BIN: '/opt/sparkle-private/bin', SAFARI_TEAM_ID: 'TEAMQ12345' };

const capture = async (fn) => {
  const lines = [], log = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = log; }
  return lines.join('\n');
};

test('a logged command keeps its shape but none of the credentials file\'s values or credential flag values', async () => {
  const { options, environment, run } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-redact-'));
  const saved = Object.fromEntries(Object.keys(SECRET).map((k) => [k, process.env[k]]));
  try {
    for (const key of Object.keys(SECRET)) delete process.env[key];
    const config = path.join(dir, 'stores.env');
    fs.writeFileSync(config, Object.entries(SECRET).map(([k, v]) => `${k}=${v}`).join('\n') + '\nASC_KEY_PATH=keys/AuthKey.p8\n');
    const env = environment(options(['submit', '--config', config]));
    const log = path.join(dir, 'upload.log');
    const printed = await capture(() => run('true', ['altool', '--upload-package', 'glaze.pkg', '--api-key', env.ASC_KEY_ID, '--api-issuer', env.ASC_ISSUER_ID,
      '--team', SECRET.SAFARI_TEAM_ID, `${SECRET.SPARKLE_BIN}/sign_update`, env.ASC_KEY_PATH, '-p', 'app-specific-pass', '--token=tok-abc-123'], dir, env, log));
    const logged = fs.readFileSync(log, 'utf8');
    for (const [where, text] of [['console', printed], ['log file', logged]]) {
      assert.match(text, /altool --upload-package glaze\.pkg --api-key \[redacted\] --api-issuer \[redacted\]/, where);
      for (const value of [...Object.values(SECRET), env.ASC_KEY_PATH, 'keys/AuthKey.p8', 'app-specific-pass', 'tok-abc-123']) {
        assert.ok(!text.includes(value), `${where} shows ${value}`);
      }
      assert.match(text, /--token=\[redacted\]/, where);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('credentials given in the environment instead of the file are hidden too', async () => {
  const { options, environment, commandLine } = await load();
  const saved = process.env.ASC_ISSUER_ID, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-redact-'));
  try {
    process.env.ASC_ISSUER_ID = 'env-issuer-31337';
    fs.writeFileSync(path.join(dir, 'stores.env'), '');
    environment(options(['submit', '--config', path.join(dir, 'stores.env')]));
    assert.equal(commandLine('xcrun', ['notarytool', 'submit', 'a.zip', '--issuer', 'env-issuer-31337']), 'xcrun notarytool submit a.zip --issuer [redacted]');
    assert.equal(commandLine('echo', ['issuer=env-issuer-31337']), 'echo issuer=[redacted]');
  } finally {
    if (saved === undefined) delete process.env.ASC_ISSUER_ID; else process.env.ASC_ISSUER_ID = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const logging of [false, true]) test(`child stdout and stderr redact split credentials with a log file: ${logging}`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-child-redact-'));
  try {
    const config = path.join(dir, 'stores.env'), log = path.join(dir, 'step.log');
    fs.writeFileSync(config, 'AMO_JWT_SECRET=synthetic-child-secret\n');
    const child = `process.stdout.write('normal stdout: ' + process.env.AMO_JWT_SECRET.slice(0, 8));
      setTimeout(() => { process.stdout.write(process.env.AMO_JWT_SECRET.slice(8));
        process.stderr.write('normal stderr: ' + process.argv[2]); }, 20);`;
    const harness = `import { environment, options, run } from ${JSON.stringify(require('node:url').pathToFileURL(path.join(__dirname, '../scripts/store-release.mjs')).href)};
      const env = environment(options(['plan', '--config', ${JSON.stringify(config)}]));
      await run(process.execPath, ['-e', ${JSON.stringify(child)}, '--', '--token', 'synthetic-flag-secret'], ${JSON.stringify(dir)}, env, ${logging ? JSON.stringify(log) : 'undefined'});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', harness], { encoding: 'utf8', env: { ...process.env, AMO_JWT_SECRET: 'synthetic-child-secret' } });
    assert.equal(result.status, 0, result.stderr);
    const output = result.stdout + result.stderr + (logging ? fs.readFileSync(log, 'utf8') : '');
    assert.ok(!output.includes('synthetic-child-secret'), 'child stdout leaked configured credential');
    assert.ok(!output.includes('synthetic-flag-secret'), 'child stderr leaked credential flag value');
    // stdout and stderr may interleave in a shared file, including between an ordinary prefix and its value.
    assert.ok(output.includes('normal ') && (output.match(/\[redacted\]/g) || []).length >= 2, 'ordinary output and redaction markers survive');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
