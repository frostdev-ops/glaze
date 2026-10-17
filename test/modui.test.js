const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {}; this.style = { setProperty() {} }; this.classList = { add() {} }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll() { return []; }
  addEventListener(k, f) { this.events[k] = f; }
  set innerHTML(v) { throw new Error('markup must not reach the renderer'); }
}
const renderer = (sheet = class { constructor() { this.cssRules = [{}]; } }) => {
  const ctx = vm.createContext({
    document: { documentElement: { lang: 'en' }, hidden: false, addEventListener() {}, createElement: (tag) => new Element(tag), createElementNS: (ns, tag) => new Element(tag) },
    CSSStyleSheet: sheet, Intl, Date, setTimeout, clearTimeout,
  });
  return vm.runInContext(fs.readFileSync(path.join(__dirname, '../features/modui.js'), 'utf8'), ctx);
};

test('progress components always have accessible names and preserve explicit labels', () => {
  const U = renderer();
  for (const type of ['ring', 'progress']) for (const label of [undefined, '', 'Assignments']) {
    const root = new Element('root');
    U.render(root, { type, value: 50, ...(label !== undefined && { label }) }, {});
    assert.equal(root.children[0].attrs['aria-label'], label || 'Progress');
    assert.equal(root.children[0].attrs.role, 'progressbar');
    assert.equal(root.children[0].attrs['aria-valuenow'], '50');
  }
});


test('fallback styles survive rendering and decoration without constructable stylesheets', () => {
  const U = renderer(class { constructor() { throw new Error('unsupported'); } });
  for (let i = 0; i < 2; i++) {
    const root = new Element('root');
    U.render(root, { type: 'button', id: 'go', label: 'Open' }, {});
    assert.equal(root.children[0].tag, 'style');
    assert.match(root.children[0].textContent, /focus-visible/);
    assert.equal(root.children[1].textContent, 'Open');
    U.decorate(root, { badge: 'Due' });
    assert.equal(root.children[0].tag, 'style');
    assert.equal(root.children[1].textContent, 'Due');
  }
});
