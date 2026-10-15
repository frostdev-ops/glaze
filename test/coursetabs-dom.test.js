const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const root = process.env.GZ_B8_REPO || path.join(__dirname, '..');
const L = require(path.join(root, 'lib/coursetabs.js'));

// A dormant template tree, with no custom-element registry (as Chrome's isolated world exposes it).
class Element extends El {
  get localName() { return this.tagName.toLowerCase(); }
  get childNodes() { return this.children; }
  get classList() { return { contains: (name) => this.className.split(/\s+/).includes(name) }; }
  get attributes() {
    return [...Object.entries(this.attrs), ...(this.id ? [['id', this.id]] : []), ...(this.className ? [['class', this.className]] : []),
      ...Object.entries(this.dataset).map(([k, v]) => [`data-${k.replace(/[A-Z]/g, (s) => '-' + s.toLowerCase())}`, v])]
      .map(([name, value]) => ({ name, value }));
  }
}

test('snapshot sanitizing works with a null isolated-world registry and never connects a custom name', () => {
  const doc = { root: null };
  let constructors = 0;
  const make = (tag) => new Element(tag, doc);
  const container = make('div'), custom = make('bb-course-navigation'), child = make('late-page-widget');
  const anchor = make('a'); anchor.setAttribute('href', '/ultra/courses/_1_1/outline');
  const input = make('input'); input.setAttribute('value', 'secret');
  custom.append(child, anchor, input); container.append(custom); doc.root = container;
  const document = {
    createElement(tag) { if (tag.includes('-')) { constructors++; throw new Error('custom constructor'); } return make(tag); },
    createTreeWalker(root) {
      const nodes = [root, ...root.all()]; let i = 0;
      return { currentNode: root, nextNode: () => nodes[++i] || null };
    },
  };
  const source = fs.readFileSync(path.join(root, 'features/coursetabs.js'), 'utf8');
  const a = source.indexOf('  const sanitize = '), b = source.indexOf('  // A copy of `live`', a);
  const sanitize = vm.runInNewContext(source.slice(a, b) + '\nsanitize;', {
    L, document, customElements: null, NodeFilter: { SHOW_ELEMENT: 1, SHOW_COMMENT: 128 }, styleText: () => '',
  });
  const safe = sanitize(custom);
  assert.equal(safe.localName, 'div');
  assert.equal(safe.getAttribute('data-gz-tag'), 'bb-course-navigation');
  assert.equal(safe.children[0].localName, 'div');
  assert.equal(safe.children[0].getAttribute('data-gz-tag'), 'late-page-widget');
  assert.equal(safe.children[1], anchor, 'native link is retained');
  assert.equal(anchor.getAttribute('href'), '/ultra/courses/_1_1/outline');
  assert.equal(safe.children.length, 2, 'the field is removed');
  assert.equal(constructors, 0);
});

test('neutral custom tags keep ordinary native CSS type selectors, without changing class/id/attribute selectors', () => {
  assert.equal(typeof L.selectors, 'function');
  const tags = new Set(['bb-course-navigation', 'course-page-header']);
  assert.equal(L.selectors('bb-course-navigation > course-page-header h1, :is(course-page-header).header', tags),
    '[data-gz-tag="bb-course-navigation"] > [data-gz-tag="course-page-header"] h1, :is([data-gz-tag="course-page-header"]).header');
  const unchanged = '.course-page-header #bb-course-navigation [data-kind="course-page-header"]';
  assert.equal(L.selectors(unchanged, tags), unchanged);
  assert.equal(L.selectors('course-page-header:hover', new Set(['x.*'])), 'course-page-header:hover');
});


// Replay records a native link, then follows it only when that same link exists in the live page.
function replay(href) {
  const source = fs.readFileSync(path.join(root, 'features/coursetabs.js'), 'utf8');
  const remember = source.slice(source.indexOf('  const remember = '), source.indexOf('  const fade = '));
  const end = source.slice(source.indexOf('  const end = '), source.indexOf("  // The tab's scroll"));
  const anchor = { getAttribute: () => href, textContent: 'Content', getBoundingClientRect: () => ({ left: 0, right: 10, top: 0, bottom: 10 }) };
  const document = { querySelectorAll: () => [anchor] }, routed = [];
  vm.runInNewContext(remember + end + '\nremember(document, {clientX:5,clientY:5});end();', {
    L, document, go: {}, URL, location: { origin: 'https://bb.school.test' }, shown: () => true,
    safePath: (p, q) => L.safe(p, q), observeView() {},
    clearTimeout() {}, place() {}, draw() {}, route: (url) => routed.push(url),
  });
  return routed;
}

test('snapshot click replay keeps full own-origin native links', () => {
  assert.deepEqual(replay('https://bb.school.test/ultra/courses/_1_1/outline?courseId=_1_1'), ['/ultra/courses/_1_1/outline?courseId=_1_1']);
});

test('snapshot click replay routes only the allowlisted query', () => {
  assert.deepEqual(replay('/ultra/courses/_1_1/outline?launch=lti&courseId=_1_1'), ['/ultra/courses/_1_1/outline?courseId=_1_1']);
});

test('snapshot click replay rejects external origins and assessment routes', () => {
  assert.deepEqual(replay('https://cdn.school.test/ultra/courses/_1_1/outline'), []);
  assert.deepEqual(replay('//other.test/ultra/courses/_1_1/outline'), []);
  assert.deepEqual(replay('/ultra/courses/_1_1/outline/assessment/_2_1/overview'), []);
});


test('customized built-ins are recreated without their internal upgrade name and keep native selectors', () => {
  const doc = { root: null }, make = (tag) => new Element(tag, doc);
  const container = make('div'), button = make('button'), nested = make('button');
  button.setAttribute('is', 'known-button'); nested.setAttribute('is', 'late-button');
  button.append(nested); container.append(button); doc.root = container;
  const created = [];
  const document = {
    createElement(tag) { created.push(tag); return make(tag); },
    createTreeWalker(root) { const nodes = [root, ...root.all()]; let i = 0; return { currentNode: root, nextNode: () => nodes[++i] || null }; },
  };
  const source = fs.readFileSync(path.join(root, 'features/coursetabs.js'), 'utf8');
  const a = source.indexOf('  const sanitize = '), b = source.indexOf('  // A copy of `live`', a);
  const sanitize = vm.runInNewContext(source.slice(a, b) + '\nsanitize;', {
    L, document, customElements: null, NodeFilter: { SHOW_ELEMENT: 1, SHOW_COMMENT: 128 }, styleText: () => '',
  });
  const safe = sanitize(button);
  assert.notEqual(safe, button, 'a new native element has no internal custom-element name');
  assert.notEqual(safe.children[0], nested);
  assert.equal(safe.localName, 'button'); assert.equal(safe.children[0].localName, 'button');
  assert.equal(safe.hasAttribute('is'), false); assert.equal(safe.children[0].hasAttribute('is'), false);
  assert.deepEqual(created, ['button', 'button']);
});
