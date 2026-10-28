const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const L = require('../lib/writer-submit.js');
const source = fs.readFileSync(require.resolve('../writer-paper.js'), 'utf8');

test('Export names the same paper exactly as Submit does', () => {
  const a = source.indexOf('    const fileName = '), b = source.indexOf('    const exportFile = ', a);
  const name = vm.runInNewContext(`${source.slice(a, b)} fileName()`, { surname: () => 'Rivera', ctx: { assignment: { title: 'Essay 2: Memory in Beloved' } }, paper: null, t: (x) => x, GZ_WRITER_SUBMIT_LIB: L });
  assert.equal(name, L.fileName({ surname: 'Rivera', title: 'Essay 2: Memory in Beloved' }));
});

test('header tab leaders fill the gap before the tabbed text', () => {
  const doc = { createElement: (tag) => new El(tag, doc), boxOf: (e) => ({ left: 0, top: 0, width: e.className === 'gp-part' ? 600 : 50, height: 20 }) };
  const h = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); } e.append(...kids); return e; };
  const el = h('div');
  const a = source.indexOf('    const partEl = '), b = source.indexOf('    const draw = ', a);
  vm.runInNewContext(`${source.slice(a, b)} partEl(parts, el, { tab: .5 })`, { h, el, scale: 1, ST: { lineHeight: () => 20, stack: (x) => x }, parts: [{ runs: [{ text: 'Label\tPage' }], tabs: [[5, 'r', 'dot']] }] });
  const leader = el.querySelector('.gp-tabstop-dot');
  assert.ok(leader, 'a visible dot leader is drawn');
  assert.match(leader.style.cssText, /width:380px/);
  assert.equal(leader.getAttribute('aria-hidden'), 'true');
});
