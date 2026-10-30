const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../scripts/frame-tap.js'), 'utf8');
const code = source.slice(source.indexOf('const taps = '), source.indexOf('module.exports'));

// Exercise tap's routing decisions without Chromium: a pre-click hit test passes, then the browser reports where the
// click actually went. Only its known iframe-routing failure may change the frame width and try again.
const harness = (miss) => {
  let clicks = 0, nudges = 0;
  const log = [];
  const handle = { evaluate: async (fn) => fn.name === 'AIM' ? { x: 10, y: 10, box: 'control' } : undefined };
  const frame = { evaluate: async (fn) => {
    if (fn.name === 'PLACE') return { x: 30, y: 30, box: 'frame|control' };
    if (fn.name !== 'MISS') nudges++;
  } };
  const page = { mouse: { click: async () => { clicks++; } }, evaluate: async () => miss === 'iframe' ? ['iframe'] : ['div.overlay'] };
  const fr = { page: () => page, frameElement: async () => frame, $: async () => handle,
    evaluate: async () => ({ heard: clicks > 1 ? 1 : 0, other: miss === 'inside' && clicks === 1 ? ['div.overlay'] : [] }) };
  const ctx = vm.createContext({ pause: async () => {}, Date, console: { log: (s) => log.push(s) } });
  vm.runInContext(`${code}\nglobalThis.run = (fr) => tap(fr, '.control'); globalThis.retries = taps.again;`, ctx);
  return { run: () => ctx.run(fr), clicks: () => clicks, nudges: () => nudges, retries: ctx.retries, log };
};

test('tap fails on a click that reached another product element or a page overlay without nudging the frame', async () => {
  for (const miss of ['inside', 'page']) {
    const h = harness(miss);
    await assert.rejects(h.run(), /landed (?:on|in the page on)/);
    assert.equal(h.clicks(), 1);
    assert.equal(h.nudges(), 0);
  }
});

test('tap retries only a confirmed page iframe hit and logs its reason', async () => {
  const h = harness('iframe');
  await h.run();
  assert.equal(h.clicks(), 2);
  assert.equal(h.nudges(), 1);
  assert.match(h.retries[0], /given to the page's <iframe>/);
  assert.ok(h.log.some((s) => s.includes(h.retries[0])));
});
