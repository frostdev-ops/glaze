const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const M = require('../lib/navbar.js');
const L = require('../lib/navlayout.js');

const source = fs.readFileSync(require.resolve('../features/navbar.js'), 'utf8');
const part = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const plain = (x) => JSON.parse(JSON.stringify(x));
const origin = 'https://school.test';

test('phone tabs, sheet rows and overflow entries identify mod items', () => {
  const c = vm.createContext({
    make: (tag, props) => Object.assign(new El(tag, {}), props), part: (e) => e,
    t: (s, v) => s.replace('{name}', v.name),
  });
  const node = vm.runInContext(part('  const node =', '  const badgeOf =') + '\nnode;', c);
  for (const [cls, name] of [['tab', 'tab'], ['row', 'row'], ['row', 'menu-item']]) {
    const e = node({ id: 'mod:abcdefghijklmnop.login', label: 'Sign in', by: '<Study>' }, cls, name);
    assert.equal(e.getAttribute('aria-description'), 'From <Study>', name);
    assert.equal(e.getAttribute('title'), 'From <Study>', name);
  }
  assert.equal(node({ id: 'calendar' }, 'tab', 'tab').getAttribute('aria-description'), null);
});

test('student links and worn Look links keep off-site HTTPS addresses', () => {
  const link = { id: 'library0000a', n: 'Library', u: 'https://library.test/', i: 'book' };
  for (const input of [{ prefs: M.clean({ links: [link] }) }, { look: L.clean({ links: [link] }) }]) {
    const item = M.build(input).items.find((i) => i.id === `link:${link.id}`);
    assert.equal(item.href, link.u);
    assert.equal(item.owner, undefined);
  }
});
