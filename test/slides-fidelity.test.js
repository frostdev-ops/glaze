// Exercise reference validation without starting PowerPoint or a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const script = path.resolve(__dirname, '../scripts/slides-fidelity.js'), realRequire = createRequire(script);
const run = async (names, n = 3) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-fidelity-test-')), errors = [], logs = [];
  const input = path.join(tmp, 'deck.pptx'), reference = path.join(tmp, 'reference'), out = path.join(tmp, 'out');
  fs.mkdirSync(reference);
  fs.writeFileSync(input, 'deck');
  for (const name of names) { const f = path.join(reference, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'png'); }
  const proc = { argv: ['node', script, input, out, '--reference', reference], env: {}, exitCode: 0 };
  let closed = false;
  const page = {
    goto: async () => {}, setViewportSize: async () => {}, screenshot: async () => Buffer.from('png'),
    evaluate: async (_, arg) => typeof arg === 'string' ? { n, w: 2, h: 2, cut: [] } : arg?.a ? { share: 0, png: '' } : undefined,
  };
  try {
    await vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
      __dirname: path.dirname(script), process: proc, Buffer,
      console: { log: (s) => logs.push(s), warn: (s) => errors.push(s), error: (s) => errors.push(s) },
      require: (name) => name === 'playwright' ? { chromium: { launch: async () => ({ newPage: async () => page, close: async () => { closed = true; } }) } }
        : name === 'node:child_process' ? { execFileSync: () => { throw Error('PowerPoint must not run'); } } : realRequire(name),
    });
    return { code: proc.exitCode, errors: errors.join('\n'), logs: logs.join('\n'), closed };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
};

test('fidelity refuses an empty PNG reference instead of passing zero slides', async () => {
  const r = await run([]);
  assert.equal(r.code, 1, r.logs);
  assert.match(r.errors, /no.*PNG/i);
});

test('fidelity requires one unambiguous reference per slide, including hidden slides', async () => {
  for (const names of [['Slide1.png', 'Slide3.png'], ['Slide1.png', 'Slide2.png', 'nested/Slide2.png']]) {
    const r = await run(names);
    assert.equal(r.code, 1, r.logs);
    assert.match(r.errors, /slide|duplicate/i);
  }
});
