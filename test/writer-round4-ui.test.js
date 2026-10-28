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

test('autocorrect Undo does not intercept an issue at a different caret position', () => {
  const proof = fs.readFileSync(require.resolve('../writer-proof.js'), 'utf8');
  const a = proof.indexOf('  const openNext = '), b = proof.indexOf('  // ---- the autocorrect pop', a);
  let card = false, focused = false;
  const view = { state: { selection: { head: 30 } } };
  vm.runInNewContext(`${proof.slice(a, b)} openNext()`, { view, I: { list: () => [{ from: 28, to: 35 }] },
    fixPop: { hidden: false, fix: { from: 1, to: 4 }, querySelector: () => ({ focus: () => { focused = true; } }) },
    clearTimeout() {}, fixTimer: 1, openCard: () => { card = true; } });
  assert.equal(card, true);
  assert.equal(focused, false);
});

test('clicking the far half of a footnote opens the note at its node position', () => {
  const S = require('../lib/writer-schema.js');
  const a = source.indexOf('    const watch = new PM.state.Plugin('), b = source.indexOf('    ed.addPlugins(', a);
  let opened;
  const plugin = vm.runInNewContext(`${source.slice(a, b)} watch`, { PM: globalThis.GZ_PM, editNote: (pos) => { opened = pos; } });
  const node = S.paper.nodes.footnote_ref.create({ content: 'A note.' });
  assert.equal(plugin.props.handleClickOn({}, 6, node, 5, {}, true), true);
  assert.equal(opened, 5);
});

test('the page-foot highlight selects the same footnote letters that Find matched', () => {
  const S = require('../lib/writer-schema.js'), FIND = require('../writer-find.js');
  const content = '<p>First<br>line.</p><p>Second target.</p>';
  const doc = S.paper.node('doc', null, S.paper.node('paragraph', null, [S.paper.text('Body'), S.paper.node('footnote_ref', { content })]));
  const hit = FIND.search(doc, 'target')[0];
  const text = ['1', ' ', 'First', 'line.', 'Second target.'].map((data) => ({ data }));
  let at = 0, from, to;
  const range = { setStart: (n, off) => { from = [text.indexOf(n), off]; }, setEnd: (n, off) => { to = [text.indexOf(n), off]; } };
  const document = { querySelectorAll: () => [{ firstChild: { textContent: '1' } }], createTreeWalker: () => ({ nextNode: () => text[at++] }), createRange: () => range };
  const findSource = fs.readFileSync(process.env.WRITER_FIND_SOURCE || require.resolve('../writer-find.js'), 'utf8');
  const a = findSource.indexOf('  const noteMark = '), b = findSource.indexOf('  F.plugin(plugin());', a);
  vm.runInNewContext(`${findSource.slice(a, b)} noteMark(v, s)`, { document, v: { state: { doc } }, s: { hits: [hit], current: 0 },
    CSS: { highlights: new Map() }, Highlight: class {}, NodeFilter: { SHOW_TEXT: 4 }, requestAnimationFrame: (fn) => fn(), noteRange: FIND.noteRange });
  assert.deepEqual(from, [4, 7]);
  assert.deepEqual(to, [4, 13]);
});
