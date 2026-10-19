const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');

// Exercise the renderer's real asynchronous panel lifecycle with a deferred site response.
const panelHarness = () => {
  const doc = { activeElement: null, addEventListener() {}, removeEventListener() {} };
  const box = new El('div', doc), from = new El('button', doc);
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(new El(tag, doc), props); e.append(...kids); return e; };
  const root = { querySelectorAll: () => [], get activeElement() { return doc.activeElement; } };
  let resolve;
  const context = vm.createContext({ document: doc, root, el: { panel: box }, host: {}, panel: '', panelTurn: 0, panelFrom: null, panels: new Map(),
    byId: () => ({ label: 'Messages' }), make, put: (e, ...kids) => { e.append(...kids); return e; }, part: (e) => e, icon: () => new El('svg', doc), t: (s) => s, emit() {},
    menuTo() {}, sheetTo() {}, placePanel() {}, outsidePanel() {}, sameSite: () => true, M: { PICKS: ['bell'] }, site: { panel: () => new Promise((r) => { resolve = r; }) } });
  const src = fs.readFileSync(require.resolve('../features/navbar.js'), 'utf8');
  vm.runInContext(src.slice(src.indexOf('  const panelRow ='), src.indexOf('  const outsidePanel =')) + '\nglobalThis.open = panelTo;', context);
  return { doc, box, from, open: context.open, resolve: (v) => resolve(v) };
};

test('a panel response preserves focus after the user tabs back to the page', async () => {
  const h = panelHarness();
  const pending = h.open('messages', h.from);
  assert.ok(h.box.contains(h.doc.activeElement), 'loading panel receives initial focus');
  const main = new El('button', h.doc); main.focus();
  h.resolve({ sections: [] }); await pending;
  assert.ok(h.doc.activeElement === main, 'completion must leave page focus alone');
});

test('a response keeps focus in the panel if the user is still there; closing discards late responses', async () => {
  const h = panelHarness();
  let pending = h.open('messages', h.from);
  h.resolve({ sections: [] }); await pending;
  assert.ok(h.box.contains(h.doc.activeElement));
  pending = h.open('notifications', h.from);
  await h.open('', null, false);
  h.resolve({ title: 'Late', sections: [] }); await pending;
  assert.equal(h.box.hidden, true);
  assert.equal(h.box.textContent, '');
});

test('panel response labels and descriptions remain literal text', async () => {
  const h = panelHarness(), pending = h.open('notifications', h.from);
  const text = '<img src=x onerror=alert(1)>';
  h.resolve({ title: text, sections: [{ label: text, rows: [{ label: text, sub: text, href: 'https://school.test/mod/assign/view.php?id=8', icon: 'bell' }] }] });
  await pending;
  assert.equal(h.box.querySelector('img'), null);
  assert.ok(h.box.textContent.includes(text));
  assert.equal(h.box.querySelector('a').href, 'https://school.test/mod/assign/view.php?id=8');
});

test('turning the bar off restores tabindex added by Skip to content', () => {
  const src = fs.readFileSync(require.resolve('../features/navbar.js'), 'utf8');
  for (const tabindex of [null, '2']) {
    const doc = { activeElement: null }, main = new El('main', doc), skip = new El('a', doc), html = new El('html', doc);
    if (tabindex !== null) main.setAttribute('tabindex', tabindex);
    // Mirror the browser's reflected tabindex property in this small DOM stand-in.
    Object.defineProperty(main, 'tabIndex', { set(v) { this.setAttribute('tabindex', String(v)); } });
    const context = vm.createContext({ document: doc, html, el: { skip }, host: new El('div', doc), site: { main: () => main, unobserve() {} },
      chrome: { runtime: { id: "glaze" } }, clearLogo() {},
      enter: 0, leave: 0, frame: 0, queued: 0, sheetOpen: false, sizes: null, words: '', panels: new Map(),
      clearTimeout() {}, cancelAnimationFrame() {}, menuTo() {}, panelTo() {}, emit() {} });
    const declarations = src.slice(src.indexOf('  let cmenu ='), src.indexOf('  const panels ='));
    vm.runInContext(declarations + src.slice(src.indexOf('  const click ='), src.indexOf('  const key =')) + src.slice(src.indexOf('  const stop ='), src.indexOf('  const sync =')) + '\nglobalThis.skip = click; globalThis.stop = stop;', context);
    context.skip({ type: 'click', composedPath: () => [skip], preventDefault() {} });
    assert.equal(doc.activeElement, main);
    context.stop();
    assert.equal(main.getAttribute('tabindex'), tabindex);
  }
});
