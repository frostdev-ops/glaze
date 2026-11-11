// Exercise the agent's stream boundaries without opening an operating-system socket.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');

const file = require.resolve('../../mcp/lib/agent.js');
const local = createRequire(file);
const source = fs.readFileSync(file, 'utf8');
const stream = () => Object.assign(new EventEmitter(), {
  paused: false, writes: [], writableLength: 0, writable: true, accepting: true,
  pause() { this.paused = true; }, resume() { this.paused = false; },
  write(s) { this.writes.push(s); return this.accepting; },
  destroy() { this.emit('close'); }, end(cb) { cb?.(); },
});
const start = async (t, { connected = true, limit = 64 } = {}) => {
  const stdin = stream(), stdout = stream(), socket = stream(), stderr = stream();
  const record = { rec: { browser: 'chrome', instance: 'test', path: '/socket', token: 'test' }, alive: true };
  const R = { ...local('./rendezvous.js'), dir: () => '/run', check: () => true, sweep() {}, list: () => connected ? [record] : [], connect: () => socket };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    require: (name) => name === './rendezvous.js' ? R : name === './handshake.js' ? { offer: async () => ({ rest: Buffer.alloc(0) }) }
      : name === './peer.js' ? { self: () => ({ verified: false }) } : name === './lines.js' ? { ...local(name), LINE: limit } : local(name),
    module, Buffer, process,
    setTimeout: () => ({ unref() {} }), clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  }, { filename: file });
  const run = module.exports.main({ io: { stdin, stdout, stderr, exit() {}, env: {} } });
  t.after(() => stdin.emit('end'));
  await new Promise(setImmediate);
  return { stdin, stdout, socket, stderr, run };
};

test('the agent refuses a complete overlong stdin line before forwarding it', async (t) => {
  const a = await start(t);
  a.stdin.emit('data', Buffer.from(`${'x'.repeat(65)}\n`));
  assert.deepEqual(a.socket.writes, [], 'a newline in the same chunk cannot bypass the line limit');
  assert.equal(await a.run, 1);
});
