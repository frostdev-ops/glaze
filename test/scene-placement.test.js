const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const host = fs.readFileSync(require.resolve('../lib/scene-host.js'), 'utf8');
const start = source.indexOf('  const placeScene = '), end = source.indexOf('  const stopScene = ', start);

test('the lazy script returns its API to the injection broker', () => {
  assert.equal(typeof vm.runInNewContext(host).place, 'function');
});

const rig = () => {
  const element = (name, parent = null) => ({
    name, parentNode: parent, attrs: new Set(),
    get parentElement() { return this.parentNode; },
    append(c) { c.parentNode = this; }, getClientRects: () => [1],
    setAttribute(k) { this.attrs.add(k); }, removeAttribute(k) { this.attrs.delete(k); },
    hasAttribute(k) { return this.attrs.has(k); },
    closest(selector) {
      for (let p = this; p; p = p.parentNode) {
        if (selector.includes('.bb-offcanvas-panel') && p.name === 'screen' || selector.includes('.course-content-container') && p.name === 'course'
          || selector.includes('.routed-page') && p.name === 'routed') return p;
      }
      return null;
    },
  });
  const body = element('body'), course = element('course', body), outline = element('outline', course);
  const tool = element('tool', outline), screen = element('screen', course), inner = element('inner', screen);
  course.querySelector = () => outline;
  const c = { ultra: true, LAYERS: '', document: { body, documentElement: { hasAttribute: () => !!c.framed }, querySelectorAll: () => c.layers }, layers: [outline],
    sceneCanvas: element('canvas'), modBg: null, scene: { draw() {} } };
  vm.createContext(c); vm.runInContext(`${host}\n${source.slice(start, end)}globalThis.placeScene = placeScene;`, c);
  return { c, body, course, outline, tool, screen, inner, element };
};

test('the outline scene covers the navbar gutter outside its clipped content scroller', () => {
  const r = rig(); r.c.placeScene();
  assert.equal(r.c.sceneCanvas.parentNode, r.course);
});
for (const tool of ['calendar', 'announcements', 'discussions', 'gradebook', 'messages', 'groups', 'achievements']) {
  test(`${tool}: narrowing a tool panel for the sidebar keeps a full course backdrop`, () => {
    const r = rig(); r.c.layers = [r.outline, r.tool]; r.c.placeScene();
    assert.equal(r.c.sceneCanvas.parentNode, r.course);
  });
}
test('an item overlay owns its backdrop outside its inner scroller and releases it when closed', () => {
  const r = rig(); r.c.layers = [r.outline, r.screen, r.inner]; r.c.placeScene();
  assert.equal(r.c.sceneCanvas.parentNode, r.screen);
  assert.ok(r.screen.attrs.has('data-gz-scene-host'));
  r.c.layers = [r.outline]; r.c.placeScene();
  assert.equal(r.c.sceneCanvas.parentNode, r.course);
  assert.ok(!r.screen.attrs.has('data-gz-scene-host'));
});
test('a mod background uses the same full course surface', () => {
  const r = rig(); r.c.modBg = r.element('mod'); r.c.placeScene();
  assert.equal(r.c.modBg.parentNode, r.course);
});
test('a standalone item panel covers the underlying course instead of sharing its backdrop', () => {
  const r = rig(), item = r.element('item', r.course); r.c.layers = [r.outline, item]; r.c.placeScene();
  assert.equal(r.c.sceneCanvas.parentNode, item);
});
test('a routed discussion covers its full-width page shell, not just the clipped panel beside the navbar', () => {
  const r = rig(), routed = r.element('routed', r.body), panel = r.element('panel', routed); r.c.layers = [panel]; r.c.placeScene();
  assert.equal(r.c.sceneCanvas.parentNode, routed);
});
test('base pages and other LMSs keep the body backdrop', () => {
  const r = rig(); r.c.layers = []; r.c.placeScene(); assert.equal(r.c.sceneCanvas.parentNode, r.body);
  r.c.ultra = false; r.c.layers = [r.outline]; r.c.placeScene(); assert.equal(r.c.sceneCanvas.parentNode, r.body);
});
test('unchanged placement does not move or redraw the renderer, and cleanup releases the shell', () => {
  const r = rig(); let draws = 0; r.c.scene.draw = () => draws++;
  r.c.placeScene(); r.c.placeScene();
  assert.equal(draws, 1);
  r.c.GZ_SCENE_HOST.clear(r.c.sceneCanvas);
  assert.ok(!r.course.attrs.has('data-gz-scene-host'));
});
test('a mod detached before its cleanup still releases the old shell', () => {
  const r = rig(); r.c.modBg = r.element('mod'); r.c.placeScene();
  r.c.modBg.parentNode = null;
  r.c.GZ_SCENE_HOST.clear(r.c.modBg);
  assert.ok(!r.course.attrs.has('data-gz-scene-host'));
});
test('native content replacement can detach and restore the same renderer in the same shell', () => {
  const r = rig(); r.c.placeScene(); r.c.sceneCanvas.parentNode = null;
  r.c.placeScene();
  assert.equal(r.c.sceneCanvas.parentNode, r.course);
  assert.ok(r.course.attrs.has('data-gz-scene-host'));
});
test('a retained course tab keeps the shared navbar scene outside the hidden native course', () => {
  const r = rig(); r.c.placeScene(); r.c.framed = true; r.c.placeScene();
  assert.equal(r.c.sceneCanvas.parentNode, r.body);
  assert.ok(!r.course.attrs.has('data-gz-scene-host'));
  r.c.framed = false; r.c.placeScene();
  assert.equal(r.c.sceneCanvas.parentNode, r.course);
  assert.ok(!r.body.attrs.has('data-gz-scene-host'));
});
