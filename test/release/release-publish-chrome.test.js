// publish-chrome.sh with stand-ins for gcloud, curl and sleep on PATH: no network, no credentials, no store. curl's
// arguments are what `ps` shows to every user on the Mac, so the OAuth token must reach curl another way, and a status
// that never leaves IN_PROGRESS must end the script instead of holding the terminal for ever.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.join(__dirname, '../..');
const TOKEN = 'ya29.FAKE-token_for-the-test';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-publish-chrome-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const bin = path.join(scratch, 'bin'), zip = path.join(scratch, 'glaze.zip');
fs.mkdirSync(bin);
fs.writeFileSync(zip, 'zip bytes');
const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
stub('gcloud', `echo ${TOKEN}`);
// A pause that is short whatever the script asks for.
stub('sleep', 'exec /bin/sleep 0.2');
// Records each call's arguments and standard input, then answers by endpoint.
stub('curl', `
n=$(ls "$LOG" | grep -c args || true)
printf '%s\\n' "$@" > "$LOG/curl-$n.args"
cat > "$LOG/curl-$n.stdin"
case "$*" in
  *:upload*) echo '{"uploadState":"IN_PROGRESS"}' ;;
  *:fetchStatus*) echo "{\\"lastAsyncUploadState\\":\\"$STATUS\\"}" ;;
  *) echo '{}' ;;
esac`);

const publish = (status, extra = {}) => {
  const log = fs.mkdtempSync(path.join(scratch, 'log-'));
  const result = spawnSync('sh', ['tools/release/publish-chrome.sh', zip], {
    cwd: repo, encoding: 'utf8', timeout: 25000, input: '',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LOG: log, STATUS: status, CWS_NO_PUBLISH: '', ...extra },
  });
  const calls = fs.readdirSync(log).filter((f) => f.endsWith('.args')).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)))
    .map((f) => ({ args: fs.readFileSync(path.join(log, f), 'utf8'), stdin: fs.readFileSync(path.join(log, f.replace('.args', '.stdin')), 'utf8') }));
  return { ...result, calls };
};

test('the OAuth token is on no curl command line, and still authorizes every call', () => {
  const result = publish('SUCCEEDED');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Submitted for review\./);
  assert.ok(result.calls.length >= 3, 'upload, status and publish all went through curl');
  for (const call of result.calls) {
    assert.ok(!call.args.includes(TOKEN), `the token is in curl's arguments:\n${call.args}`);
    assert.ok(!call.args.includes('Bearer'), 'no Authorization header is passed as an argument');
    assert.ok(call.stdin.includes(`Bearer ${TOKEN}`), 'the header reaches curl on its standard input');
  }
});

test('an upload that never leaves IN_PROGRESS ends with a clear message instead of looping for ever', () => {
  const result = publish('IN_PROGRESS', { CWS_STATUS_TIMEOUT: '2' });
  assert.equal(result.status, 1, `${result.signal || ''} ${result.stdout}`);
  assert.match(result.stderr, /publish-chrome: .*still IN_PROGRESS after 2 seconds/);
  assert.match(result.stderr, /Developer Dashboard/);
  assert.ok(result.calls.some((call) => /:fetchStatus/.test(call.args)), 'it did poll');
  assert.ok(!result.calls.some((call) => /:publish/.test(call.args)), 'and never submitted');
});

test('the wait defaults to ten minutes', () => {
  assert.match(fs.readFileSync(path.join(repo, 'tools/release/publish-chrome.sh'), 'utf8'), /CWS_STATUS_TIMEOUT:-600/);
});
