// The stand-in DOM's elements as a failed assertion prints them.
const test = require('node:test'), assert = require('node:assert/strict');
const { inspect } = require('node:util');
const { El } = require('./stand-in-dom.js');

// node:assert prints a failed value at depth 1000: an element that reaches the document from every node prints the page
// again at each one (a grid test's failed assert.equal(menu, null) took the runner past 6 GB).
test('a failed assertion on a nested element prints that element and its children alone', () => {
  const doc = { listeners: [] };
  doc.root = new El('html', doc);
  const body = new El('body', doc), list = new El('ul', doc);
  doc.root.append(body);
  for (let i = 0; i < 4; i++) { const section = new El('section', doc); body.append(section); section.append(new El('p', doc), new El('p', doc)); }
  body.children[2].append(list);
  for (let i = 0; i < 4; i++) { const item = new El('li', doc); list.append(item); item.append(new El('span', doc), 'text'); }
  const host = list.children[1], shadow = host.attachShadow({ mode: 'open' });
  shadow.append(new El('b', doc));
  const nested = shadow.children[0];
  // A short print first, so a page reached again from every node fails here in milliseconds.
  assert.ok(inspect(nested, { depth: 6, getters: true }).length < 20000, 'the way back up stays out of the print');
  const printed = (el) => { try { assert.equal(el, null); } catch (e) { return e.message.length; } };
  assert.ok(printed(nested) < 20000, `${printed(nested)} characters for a shadow root's child`);
  assert.ok(printed(list) < 20000, `${printed(list)} characters for a list in the page`);
  assert.equal(nested.parentNode, shadow, 'the back links still work');
  assert.equal(shadow.host, host);
  assert.equal(nested.doc, doc);
  assert.ok(list.isConnected);
});
