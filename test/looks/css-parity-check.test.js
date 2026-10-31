// Exercise the parity runner's decisions without launching a browser. The page supplies deterministic style/pixel results.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.resolve(__dirname, '../../checks/looks/css-parity-check.js');
const source = fs.readFileSync(file, 'utf8');

const run = async ({ differentStyles = false, shots = [] } = {}) => {
  let variant = 'defaults', active = 'base', report, closed = false;
  const page = {
    route: async () => {}, goto: async () => { variant = 'defaults'; }, addScriptTag: async () => {},
    evaluate: async (fn, arg) => {
      if (arg && typeof arg === 'object') { variant = 'other'; return; }
      if (typeof arg === 'string') { active = arg; return; }
      if (fn.toString().includes('getAnimations')) return;
      if (fn.toString().includes('P.rules(')) return { diffs: [], pairs: 1, rewritten: 1, elements: 1 };
      if (fn.toString().includes('P.style(')) return [[`color:${differentStyles && variant === 'other' && active === 'head' ? 'blue' : 'red'};`, '', '']];
      throw Error('unexpected page evaluation');
    },
    screenshot: async () => Buffer.from(shots.shift() || 'same'),
  };
  const fakeFs = {
    mkdirSync() {}, readdirSync: () => ['ultra-review.html'],
    readFileSync: (f) => String(f).endsWith('.html') ? '<html><head></head><body><div></div></body></html>' : '.a { color: red; }',
    writeFileSync: (_, data) => { if (typeof data === 'string') report = JSON.parse(data); },
  };
  const process = { env: { PARITY_BASE: 'base' }, argv: ['node', file] };
  const context = vm.createContext({ __dirname: path.dirname(file), process, console: { log() {}, error(e) { throw e; } }, require: (id) => {
    if (id === 'playwright') return { chromium: { launch: async () => ({ newPage: async () => page, close: async () => { closed = true; } }) } };
    if (id === 'node:fs') return fakeFs;
    if (id === 'node:child_process') return { execFileSync: () => '.a { color: red; }' };
    if (id.endsWith('/check-env.js')) return { chromeLaunch: () => ({}) };
    if (id.endsWith('/wait-for-browser.js')) return async () => {};
    return require(id);
  } });
  await vm.runInContext(source, context, { filename: file });
  assert.equal(closed, true, 'the runner closes its browser on completion');
  return { report, exitCode: process.exitCode };
};

test('CSS parity catches cascade changes in the other attribute modes', async () => {
  const { report, exitCode } = await run({ differentStyles: true });
  assert.equal(exitCode, 1, 'equal matches do not imply equal cascade specificity');
  assert.equal(report.fixtures.find((r) => r.variant === 'other').styles, 1);
  assert.ok(report.failures.some((s) => s.includes('color: red → blue')));
});

test('CSS parity lists unstable base pixels even when they happen to equal the head pixels', async () => {
  const { report, exitCode } = await run({ shots: ['base', 'head', 'head'] });
  assert.equal(exitCode, undefined);
  assert.equal(report.unstable?.length, 1);
});

test('CSS parity rejects a stable pixel change', async () => {
  const { report, exitCode } = await run({ shots: ['base', 'head', 'base'] });
  assert.equal(exitCode, 1);
  assert.ok(report.failures.some((s) => s.includes('pixels differ')));
});
