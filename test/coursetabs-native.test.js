const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.GZ_B8_REPO || path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'content-ultra.js'), 'utf8');

test('automatic native new-content callbacks wait while a tab\'s frame covers the page; live and explicit reads remain', async () => {
  const render = source.slice(source.indexOf('  const renderNew = '), source.indexOf('  // ---- new content (Extras)'));
  const reader = source.slice(source.indexOf('  const contents = new Map()'), source.indexOf('  const shownItems = '));
  let active = true, requests = 0, nativePasses = 0, fns;
  const window = {}; window.top = window;
  fns = vm.runInNewContext(render + reader + '\n({renderNew,courseItems});', {
    I: { settings: { enhance: { newcontent: true, newgrades: false } }, observer: {} }, window, solo: true,
    GZ_CTABS: { showing: () => active }, tabFrame: '', seen: {}, courseId: () => '_102_1',
    location: { pathname: '/ultra/courses/_102_1/outline' },
    renderItems(cid) { nativePasses++; fns.courseItems(cid); },
    api: async () => { requests++; return { results: [] }; },
  });
  fns.renderNew();
  assert.equal(requests, 0, 'the covered page\'s callback starts no contents request');
  assert.equal(nativePasses, 0, 'nor marks its rows seen while hidden');
  fns.courseItems('_103_1');
  assert.equal(requests, 1, 'an explicit reader remains available while a frame covers the page');
  await new Promise(setImmediate);
  active = false; fns.renderNew();
  assert.equal(requests, 2, 'the genuine live target still reads its contents');
  await new Promise(setImmediate);
});

test('a revoked document cannot recreate the first-paint tab reservation', () => {
  const line = source.slice(source.indexOf('  const tabsOn = '), source.indexOf('  const syncTabs = '));
  const tabsOn = vm.runInNewContext(line + '\ntabsOn;', {
    I: { links: [{}], settings: { enhance: { tabs: true } } }, isPreview: true,
    GZ_CTABS: { revoked: () => true },
  });
  assert.equal(tabsOn(), false);
});


test('automatic new-content callbacks pause in a retained hidden live frame', () => {
  let passes = 0;
  const render = source.slice(source.indexOf('  const renderNew = '), source.indexOf('  // ---- new content (Extras)'));
  const renderNew = vm.runInNewContext(render + '\nrenderNew;', {
    GZ_CTABS: { showing: () => false }, tabFrame: '_102_1', html: { hasAttribute: () => true },
    I: { settings: { enhance: { newcontent: true } }, observer: {} }, solo: true, seen: {},
    courseId: () => '_102_1', renderItems: () => passes++,
  });
  renderNew();
  assert.equal(passes, 0, 'an invisible retained page cannot mark its rows seen or start a new-content refresh');
});
