// Deterministic worker lifecycle/fault injection; the actual wasm and fairness run in writer-proof-harper.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../lib/harper/shared.js'), 'utf8').replace(/^import .*;\n/gm, '');
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const world = (options = {}) => {
  let closed = 0, disposed = 0, tick;
  const dialects = [], dictionaries = [], readings = [];
  class LocalLinter {
    constructor({ dialect }) { this.dialect = dialect; this.words = []; }
    async setup() { await options.setup?.(); }
    async importWords(words) { this.words.push(...words); dictionaries.push([...words]); }
    async setDialect(dialect) { this.dialect = dialect; this.words = []; }
    async lint() { dialects.push(this.dialect); readings.push([...this.words]); return options.lint ? options.lint() : []; }
    async dispose() { disposed++; await options.dispose?.(); }
  }
  const ctx = vm.createContext({ LocalLinter, Dialect: { American: 0, British: 1 }, slimBinary: {}, crypto: { randomUUID: () => 'worker' }, performance,
    onconnect: null, close: () => closed++, setTimeout: (fn) => { tick = fn; return 1; }, clearTimeout() {} });
  vm.runInContext(source, ctx);
  const port = () => {
    const p = { got: [], postMessage(m) { this.got.push(m); }, close() { this.closed = true; } };
    ctx.onconnect({ ports: [p] });
    p.send = (m) => p.onmessage?.({ data: m });
    return p;
  };
  return { ctx, port, tick: () => tick(), closed: () => closed, disposed: () => disposed, dialects, dictionaries, readings };
};

test('last frame bye releases the worker after in-flight work without replying to the departed frame', async () => {
  let release;
  const w = world({ lint: () => new Promise((r) => { release = r; }) });
  const a = w.port(); a.send({ op: 'lint', id: 1, text: 'word' }); await flush();
  a.send({ op: 'bye' }); release([]); await flush();
  assert.equal(a.got.filter((m) => m.op === 'lint').length, 0);
  assert.equal(a.closed, true);
  assert.equal(w.disposed(), 1);
  assert.equal(w.closed(), 1);
});

test('all wasm lint, span and suggestion handles are freed even when shaping throws', async () => {
  const freed = [];
  const suggestion = { kind: () => { throw Error('broken suggestion'); }, free: () => freed.push('suggestion') };
  const span = { start: 0, end: 3, free: () => freed.push('span') };
  const lint = (id) => ({ span: () => span, lint_kind: () => 'Typo', message: () => 'm', get_problem_text: () => 'teh', suggestions: () => [suggestion], free: () => freed.push(id) });
  const w = world({ lint: () => [lint('first'), lint('second')] });
  const a = w.port(); a.send({ op: 'lint', id: 1, text: 'teh' }); await flush();
  assert.match(a.got[0].error, /broken suggestion/);
  for (const handle of ['span', 'suggestion', 'first', 'second']) assert.ok(freed.includes(handle), `${handle} leaked`);
});

test('worker bounds queued requests and rejects invalid ids and oversized texts without truncation', async () => {
  const w = world({ lint: () => new Promise(() => {}) });
  const a = w.port(); a.send({ op: 'lint', id: 1, text: 'hold' }); await flush();
  for (let id = 2; id <= 150; id++) a.send({ op: 'lint', id, text: 'queued', key: `p${id}` });
  assert.ok(vm.runInContext('[...frames.values()][0].queue.length', w.ctx) <= 64, 'per-frame queue is bounded');
  const before = vm.runInContext('[...frames.values()][0].queue.length', w.ctx);
  for (const id of [NaN, Infinity, -1, 1.5]) a.send({ op: 'lint', id, text: 'bad' });
  a.send({ op: 'lint', id: 999, text: 'x'.repeat(200001) });
  assert.equal(vm.runInContext('[...frames.values()][0].queue.length', w.ctx), before);
  assert.ok(a.got.some((m) => m.id === 999 && m.error), 'oversized text gets an explicit error');
});

test('idle close awaits disposal and rejects a connection arriving during shutdown', async () => {
  let release;
  const w = world({ dispose: () => new Promise((r) => { release = r; }) });
  const a = w.port(); a.send({ op: 'lint', id: 1, text: 'word' }); await flush();
  w.tick(); await flush();
  assert.equal(w.closed(), 0, 'dispose must finish before the scope closes');
  const b = w.port();
  assert.ok(b.got.some((m) => m.op === 'closing'), 'a racing connection must be told to reconnect');
  release(); await flush(); assert.equal(w.closed(), 1);
});

test('a dialect changed during initial load is used for the first lint', async () => {
  let finish, setups = 0;
  const w = world({ setup: () => ++setups === 1 ? new Promise((r) => { finish = r; }) : undefined });
  const p = w.port();
  p.send({ op: 'dict', words: ['Glazeville'] });
  p.send({ op: 'lint', id: 1, text: 'colour' }); await flush();
  p.send({ op: 'dialect', dialect: 'en-GB' }); finish(); await flush();
  assert.deepEqual(w.dialects, [1]);
  assert.deepEqual(w.dictionaries.at(-1), ['glazeville'], 'the replacement linter receives the dictionary');
  assert.equal(w.disposed(), 1);
});

test('a live dialect switch rebuilds after active linting and keeps the dictionary', async () => {
  let finish;
  const w = world({ lint: () => new Promise((r) => { finish = r; }) });
  const p = w.port();
  p.send({ op: 'dict', words: ['Glazeville'] });
  p.send({ op: 'lint', id: 1, text: 'color' }); await flush();
  p.send({ op: 'dialect', dialect: 'en-GB' });
  assert.equal(w.disposed(), 0, 'never dispose handles used by active linting');
  p.send({ op: 'lint', id: 2, text: 'colour' });
  finish([]); await flush();
  assert.deepEqual(w.dialects, [0, 1]);
  assert.deepEqual(w.readings.at(-1), ['glazeville']);
  finish([]); await flush();
  p.send({ op: 'bye' }); await flush();
});
