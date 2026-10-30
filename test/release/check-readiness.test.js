// Execute the checks' measurement/removal helpers against controlled state changes, without browser timing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = (name) => fs.readFileSync(path.join(__dirname, '../scripts', name), 'utf8');

const removeSites = async ({ delayCanvas = false, missingBB = false } = {}) => {
  const source = read('sites-check.js');
  const polling = source.slice(source.indexOf('const until ='), source.indexOf('const results ='));
  const removal = source.slice(source.indexOf('    const removeRow ='), source.indexOf('    // Embedded Settings:'));
  let now = 0, removedAt = 0, last = '';
  const rows = new Set(['canvas.school.edu', 'bb.school.edu']);
  const BB = 'https://bb.school.edu', CANVAS = 'https://canvas.school.edu';
  const grants = { removed: [], required: [], held: new Set([`${BB}/*`, `${CANVAS}/*`]) };
  const page = { click: async (selector) => {
    last = selector.includes('canvas.school.edu') ? 'canvas.school.edu' : 'bb.school.edu';
    rows.delete(last); removedAt = now;
    const pattern = `https://${last}/*`;
    if (!grants.required.includes(pattern)) { grants.removed.push([pattern]); grants.held.delete(pattern); }
  } };
  const state = async () => ({
    rows: [...rows].map((h) => [h]),
    status: last && !(last === 'bb.school.edu' && missingBB) && !(last === 'canvas.school.edu' && delayCanvas && now - removedAt < 200)
      ? `Removed ${last}. Glaze no longer runs there.` : '',
  });
  return vm.runInNewContext(`(async () => { ${polling}\n${removal} })()`, {
    page, state, BB, CANVAS, __gz: grants, gz: async (fn, arg) => fn(arg), local: async () => ({ canvas: [] }),
    shot: async () => {}, check: (ok, why) => assert.ok(ok, why), Date: { now: () => now }, pause: async (ms) => { now += ms; },
  });
};

test('Sites reads Remove status after the grant has gone back and the status has landed', async () => {
  await removeSites({ delayCanvas: true });
});

test('Sites fails when Remove never reports completion, even if the list and grant are correct', async () => {
  await assert.rejects(removeSites({ missingBB: true }), /Removed|status|completion/);
});

const layoutProbe = () => {
  const source = read('settings-ia-check.js');
  const helper = source.slice(source.indexOf('const layoutState ='), source.indexOf('let context,'));
  const body = {}, document = { body, documentElement: { scrollWidth: 320 } };
  let controls = [];
  document.querySelectorAll = () => controls;
  document.querySelector = (selector) => controls.find((el) => selector === `[data-f="${el.dataset.f}"]`) || null;
  const measure = vm.runInNewContext(`${helper}\nlayoutState`, {
    document, window: {}, innerWidth: 320, CSS: { escape: (s) => s }, getComputedStyle: () => ({ overflowX: 'visible' }),
  });
  const control = ({ visible = true, left = 0 } = {}) => ({
    dataset: { f: 'rule:add' }, textContent: 'Add tweak', isConnected: true, parentElement: body,
    matches: () => false, closest: () => null,
    checkVisibility() { return this.isConnected && visible; },
    getBoundingClientRect: () => ({ left, right: left + 100, width: 100, height: 30 }),
  });
  const old = control(); controls = [old];
  measure({ remember: 'look/palette' });
  return {
    measure: () => measure({ route: 'look/palette' }),
    replace: (opts) => { old.isConnected = false; controls = opts === null ? [] : [control(opts)]; },
  };
};

test('translated layout measures the current rule controls after the preview redraws them', () => {
  const p = layoutProbe();
  p.replace({});
  assert.deepEqual(Array.from(p.measure().off), [], 'a replaced Add tweak button is still present and fits');
});

test('translated layout still catches removed, hidden or clipped replacement controls', () => {
  for (const [replacement, why] of [[null, /hidden/], [{ visible: false }, /hidden/], [{ left: -20 }, /outside the viewport/]]) {
    const p = layoutProbe();
    p.replace(replacement);
    assert.match(p.measure().off.join('; '), why);
  }
});

test('first-screen guards report a missing screen even when the browser leaves no live handles', () => {
  const { spawnSync } = require('node:child_process');
  for (const name of ['popup-check.js', 'sites-check.js']) {
    const source = read(name);
    const start = source.indexOf('    let welcomeTimer;');
    const guard = source.slice(start, source.indexOf('\n    } finally { clearTimeout(welcomeTimer); }', start) + '\n    } finally { clearTimeout(welcomeTimer); }'.length);
    const child = `const timer = globalThis.setTimeout; const setTimeout = (fn) => timer(fn, 5);
      const welcomed = new Promise(() => {});
      (async () => { ${guard} })().catch((e) => { console.error(e.message); process.exitCode = 1; });`;
    const result = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1, `${name}: a pending first-screen wait cannot exit successfully`);
    assert.match(result.stderr, /the install never closed its first screen/);
  }
});
