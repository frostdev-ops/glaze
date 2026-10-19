const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const loaders = [
  { file: 'lib/scene-media.js', end: '\nconst layer =', name: 'loadLottie', media: true },
  { file: 'features/lookx.js', end: '\n  const mute =', name: 'lottieIn', media: false },
];
const rig = ({ file, end, name }, failure) => {
  const source = process.env.GZ_ANIMATION_IMPORT_BASE
    ? execFileSync('git', ['show', `${process.env.GZ_ANIMATION_IMPORT_BASE}:${file}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8');
  const start = source.indexOf('let lottieLoad =');
  const finish = source.indexOf(end, start);
  assert.ok(start >= 0 && finish > start, `${file}: actual loader markers`);
  // Keep the actual URL expression: failed module URLs remain poisoned even after the network recovers.
  const block = source.slice(start, finish).replace(/\bimport\(/g, 'importLottie(');
  const calls = [], cache = new Map(), player = { loadAnimation() {} };
  let remaining = failure ? 2 : 0;
  const context = vm.createContext({ chrome: { runtime: { getURL: (f) => `chrome-extension://glaze/${f}` } },
    importLottie(url) {
      calls.push(url);
      if (!cache.has(url)) cache.set(url, Promise.resolve().then(() => {
        if (remaining-- > 0) {
          if (failure === 'import') throw new Error('temporary blocked request');
          return; // An evaluated module with no player also needs a fresh URL on retry.
        }
        context.lottie = player;
      }));
      return cache.get(url);
    },
  });
  return { load: vm.runInContext(`${block}\n${name}`, context), calls, player };
};

for (const loader of loaders) {
  for (const failure of ['import', 'player']) test(`${loader.file}: a failed ${failure} can recover on the same page`, async () => {
    const r = rig(loader, failure);
    let error;
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = r.load();
      assert.equal(r.load(), pending, 'concurrent consumers share one player load');
      await assert.rejects(pending, (e) => { error = e; return true; });
    }
    assert.equal(await r.load(), r.player, 'the next redraw/startup can load the player');
    if (loader.media) assert.equal(error.why, 'module', 'player startup failures permit the caller to retry');
    assert.equal(r.calls.length, 3);
    assert.equal(new Set(r.calls).size, 3, 'do not reuse a poisoned browser module URL');
    assert.equal(await r.load(), r.player);
    assert.equal(r.calls.length, 3, 'retain a healthy player promise');
  });
  test(`${loader.file}: healthy player consumers import only once`, async () => {
    const r = rig(loader);
    assert.deepEqual(await Promise.all([r.load(), r.load(), r.load()]), [r.player, r.player, r.player]);
    assert.equal(r.calls.length, 1);
  });
}
