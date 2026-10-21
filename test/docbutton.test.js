// Glaze's icon buttons (the document tools, a course card's colour and look): named once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const part = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a > 0 && b > a, `${from} … ${to}`); return source.slice(a, b); };

test('an icon button is named by its title alone, so a screen reader says the name once', () => {
  const el = (tag) => ({ tagName: tag, dataset: {}, attrs: {}, kids: [], setAttribute(k, v) { this.attrs[k] = v; }, append(...k) { this.kids.push(...k); }, addEventListener() {} });
  const document = { createElement: el, createElementNS: (ns, tag) => Object.assign(el(tag), { namespaceURI: ns }) };
  const ctx = vm.createContext({ document, ICONS: { paint: 'M0 0' } });
  const docButton = vm.runInContext(`${part('  const docButton = ', '  const setDark = ')}; docButton`, ctx);
  const b = docButton('paint', 'Colour and look for Biology', () => {});
  assert.equal(b.title, 'Colour and look for Biology');
  assert.equal(b.attrs['aria-label'], undefined, 'no aria-label repeating the title: Chrome then reads the title as its description too');
  // A course renamed later: the title follows, or, while the tooltip holds it, the saved title and the name it lent.
  const rename = part("      } else if ((b.dataset.gzTitle ?? b.title) !== label) {", '    globalThis.GZ_COURSE_MENU?.sync(on);');
  const relabel = vm.runInContext(`(b, label) => { if (false) {${rename}`, vm.createContext({}));
  relabel(b, 'Colour and look for Chemistry');
  assert.equal(b.title, 'Colour and look for Chemistry');
  const tipped = Object.assign(docButton('paint', 'Colour and look for Biology', () => {}), { title: '' });
  tipped.dataset.gzTitle = 'Colour and look for Biology'; tipped.dataset.gzAria = '1'; tipped.attrs['aria-label'] = 'Colour and look for Biology';
  relabel(tipped, 'Colour and look for Chemistry');
  assert.deepEqual([tipped.title, tipped.dataset.gzTitle, tipped.attrs['aria-label']], ['', 'Colour and look for Chemistry', 'Colour and look for Chemistry']);
});
