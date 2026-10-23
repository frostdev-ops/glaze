const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(process.env.EXT || path.join(__dirname, '..'), 'scripts/background-pages-check.js'), 'utf8');
const start = source.indexOf("    await until(()=>frame.locator('#gz-scene')");
const end = source.indexOf("    check(await page.locator", start);

// A scene can arrive while the owning tab is still preparing its first visible document.
const ready = async (after) => {
  let polls = 0, visible = false;
  const c = vm.createContext({
    document: { documentElement: { hasAttribute: () => !visible }, querySelector: () => visible ? null : {} },
    frame: { locator: () => ({ count: async () => 1 }), evaluate: async (fn) => { visible = ++polls >= after; return fn(); } },
    until: async (fn) => { for (let i = 0; i < 10; i++) if (await fn()) return; throw Error('background did not settle'); },
  });
  await vm.runInContext('(async () => {\n' + source.slice(start, end) + '\n})()', c);
  return visible;
};

test('background check waits for the retained course to become visible before opening Gradebook', async () => {
  assert.equal(await ready(3), true, 'a rendered scene alone does not make the retained course ready');
});

test('background check refuses a retained course that never becomes visible', async () => {
  await assert.rejects(ready(Infinity), /background did not settle/);
});
