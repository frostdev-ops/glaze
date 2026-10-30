// The stand-in DOM's elements as a failed assertion prints them.
const test = require('node:test'), assert = require('node:assert/strict');
const { El } = require('./stand-in-dom.js');

// node:assert prints a failed value at depth 1000: an element that reaches the document from every node prints the page
// again at each one (a grid test's failed assert.equal(menu, null) took the runner past 6 GB).
test('a failed assertion on a nested element stays small without printing page links', () => {
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
  // Fail on booleans before asking node:assert to inspect anything: even a partial regression must stay safe to report.
  for (const el of [doc.root, ...doc.root.all(), shadow, nested]) {
    for (const key of ['doc', 'parentNode']) assert.equal(Object.prototype.propertyIsEnumerable.call(el, key), false, `${el.tagName}.${key} stays out of assertion output`);
  }
  assert.equal(Object.prototype.propertyIsEnumerable.call(shadow, 'host'), false, 'the shadow host stays out of assertion output');
  // Plenty of room for Node's formatting; no exact snapshot of its version-dependent assertion message.
  for (const el of [nested, list, shadow]) assert.throws(() => assert.equal(el, null), (e) => {
    assert.ok(e instanceof assert.AssertionError);
    assert.ok(e.message.length < 20000, `${e.message.length} characters for ${el.tagName}`);
    return true;
  });
  assert.equal(nested.parentNode, shadow, 'the back links still work');
  assert.equal(shadow.host, host);
  assert.equal(nested.doc, doc);
  assert.ok(list.isConnected);
});
