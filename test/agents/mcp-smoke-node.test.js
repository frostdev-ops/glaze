const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const N = require('../../mcp/lib/native.js');

const file = path.join(__dirname, '../../mcp/scripts/smoke-node.js');
const local = createRequire(file), version = local('../package.json').version;
const simulate = ({ hello = true, published = true } = {}) => {
  const p = Object.assign(new EventEmitter(), {
    pid: 123, stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: { writableEnded: false, write() {}, end() { this.writableEnded = true; } }, kill() {},
  });
  const proc = { ...process, exitCode: undefined }, errors = [];
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    __dirname: path.dirname(file), process: proc,
    require: (name) => name === 'node:child_process' ? { spawn: () => p, execFileSync: () => version }
      : name === 'node:fs' ? { mkdtempSync: () => '/scratch', rmSync() {} }
      : name === '../lib/rendezvous.js' ? { dir: () => '/run', list: () => published ? [{ alive: true, rec: { browser: 'chrome', instance: 'smoke', pid: p.pid } }] : [] }
      : local(name),
    console: { error: (s) => errors.push(s), log() {} },
    setTimeout: () => 1, clearTimeout() {},
  }, { filename: file });
  if (hello) p.stdout.emit('data', N.encode({ t: 'hello', node: process.version }));
  p.stderr.emit('data', Buffer.from('ready for agents\n'));
  p.emit('exit', 0);
  return { code: proc.exitCode || 0, errors };
};

test('the minimum-Node smoke cannot pass with a ready log but no native hello', () => {
  const r = simulate({ hello: false });
  assert.equal(r.code, 1, r.errors.join('\n'));
});

test('the minimum-Node smoke requires the host run record as well as its ready log', () => {
  const r = simulate({ published: false });
  assert.equal(r.code, 1, r.errors.join('\n'));
  assert.equal(simulate().code, 0);
});
