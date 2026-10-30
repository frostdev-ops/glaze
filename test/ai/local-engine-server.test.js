const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { serve } = require('../../checks/ai/local-engine-check.js');

function request(server, url, headers = {}, method = 'HEAD') {
  const result = {};
  server.emit('request', { url, method, headers: { host: '127.0.0.1:8000', ...headers } }, {
    writeHead(status, h) { result.status = status; result.headers = h; },
    end() { result.ended = true; },
  });
  return result;
}

test('the model-check server confines reference paths, including symlinks, to its reference directory', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-engine-server-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const refs = path.join(dir, 'refs'); fs.mkdirSync(refs);
  fs.writeFileSync(path.join(dir, 'private.txt'), 'private');
  fs.writeFileSync(path.join(refs, 'prompt.json'), '{}');
  fs.symlinkSync(path.join(dir, 'private.txt'), path.join(refs, 'link.json'));
  const s = serve({ ref: refs });
  assert.equal(request(s, '/f/ref/prompt.json').status, 200);
  assert.equal(request(s, '/f/ref/..%2fprivate.txt').status, 404);
  assert.equal(request(s, '/f/ref/link.json').status, 404);
});

test('the model-check server refuses rebinding hosts and handles malformed paths and ranges', () => {
  const s = serve({ tiny: Buffer.from('tiny') });
  assert.equal(request(s, '/f/tiny', { host: 'attacker.example:8000' }).status, 403);
  assert.equal(request(s, '/f/%').status, 400);
  assert.equal(request(s, '/f/toString').status, 404);
  assert.equal(request(s, '/f/tiny', { range: 'bytes=9-1' }, 'GET').status, 416);
  assert.equal(request(s, '/f/tiny', { range: 'bytes=0-3' }).status, 200);
});
