const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('Ultra native card check enables its school and keeps the native page visible', async () => {
  const script = path.join(__dirname, '../scripts/ultra-cards-check.js'), req = createRequire(script);
  const stop = new Error('fixture ready'), local = {}, sync = {};
  const page = { goto: async () => {}, setViewportSize: async () => {}, evaluate: (fn, arg) => fn(arg),
    waitForFunction: async () => {
      assert.deepEqual(Array.from(local.ultra || []), ['https://bb.school.test'], 'enable the invented Ultra site before waiting for its theme');
      assert.equal(sync.navbar?.on, false, 'the check measures the native Courses page');
      throw stop;
    } };
  const chrome = { storage: { local: { set: async (s) => Object.assign(local, s) }, sync: { clear: async () => {}, set: async (s) => Object.assign(sync, s) } } };
  const ctx = { route: async () => {}, newPage: async () => page, close: async () => {} };
  const result = vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
    __dirname: path.dirname(script), console: { log() {} }, chrome,
    process: { env: {}, argv: ['node', script, '/unused'] },
    require: (id) => id === './wait-for-browser.js' ? async () => {}
      : id === 'playwright' ? { chromium: { launchPersistentContext: async (profile, options) => { assert.equal(options.headless, true); return ctx; } } }
      : id === 'fs' ? { ...fs, mkdirSync() {}, mkdtempSync: () => '/unused', rmSync() {} } : req(id),
  });
  await assert.rejects(result, (e) => e === stop);
});

test('Moodle title restoration ignores a resweep of unrelated course menu buttons', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/rules-check.js'), 'utf8');
  const line = source.split('\n').find((l) => l.includes('const moodleCards ='));
  let late = false;
  const title = '<a class="coursename"><span class="multiline">Biology</span><span>Course is starred</span></a>';
  const document = { querySelectorAll: (selector) => [{ outerHTML: selector === '.course-card .coursename' ? title : `${title}<button${late ? '' : ' data-gz-light=""'}></button>` }] };
  const snapshot = vm.runInNewContext(`${line}; moodleCards`, { document, moodle: { evaluate: (fn) => fn() } });
  const before = await snapshot(); late = true;
  assert.equal(JSON.stringify(await snapshot()), JSON.stringify(before), 'menu theme tags are outside the title restore contract');
});

test('the widget fixture keeps its floating mod through worker layout normalization', () => {
  const W = require('../lib/widgets.js');
  const source = fs.readFileSync(path.join(__dirname, '../scripts/widgets-builder-check.js'), 'utf8');
  const code = source.slice(source.indexOf('    const layout ='), source.indexOf('    await sw.evaluate((l)'));
  const mid = 'abcdefghijklmnop';
  const layout = vm.runInNewContext(`${code}; layout`, { mid, W });
  const kept = W.layout(layout, W.mods(layout));
  assert.equal(kept.boards.pages.find((t) => t.id === `m${mid.slice(0, 14)}0`)?.on, true,
    'fresh-profile normalization must retain the floating tile before the page declares its mods');
});
