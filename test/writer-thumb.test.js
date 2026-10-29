// lib/writer-thumb.js: firstPage cuts a paper's JSON to page 1 (page break, block and character caps, big pictures
// swapped, always valid for the paper schema), and render/tile build the scaled page through a small document stand-in
// (structure only: class names, the scale, the running header, image attributes, the scoped page CSS). How it looks is the
// Documents home's browser check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../lib/writer-thumb.js');
const S = require('../lib/writer-schema.js');
const ST = require('../lib/writer-styles.js');
const F = require('../lib/writer-format.js');

const p = (text, attrs) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(text ? { content: [{ type: 'text', text }] } : {}) });
const doc = (...content) => ({ type: 'doc', content });
const textOf = (n) => (n.text || '') + (n.content || []).map(textOf).join('');
const valid = (json) => { const n = S.paper.nodeFromJSON(json); n.check(); return n; };

// ---- a document stand-in: what DOMSerializer and render touch
const camel = (k) => k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const styleOf = () => {
  const s = {};
  Object.defineProperty(s, 'cssText', {
    get: () => Object.entries(s).map(([k, v]) => `${k}:${v}`).join(';'),
    set: (v) => { for (const k of Object.keys(s)) delete s[k]; for (const part of String(v).split(';')) { const at = part.indexOf(':'); if (at > 0) s[camel(part.slice(0, at))] = part.slice(at + 1).trim(); } },
  });
  return s;
};
class Node { constructor(doc) { this.ownerDocument = doc; this.childNodes = []; this.parentNode = null; } appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; } append(...k) { for (const c of k) this.appendChild(typeof c === 'string' ? this.ownerDocument.createTextNode(c) : c); } get textContent() { return this.childNodes.map((c) => c.textContent).join(''); } }
class Text extends Node { constructor(doc, t) { super(doc); this.nodeType = 3; this.data = t; } get textContent() { return this.data; } }
class El extends Node {
  constructor(doc, tag) { super(doc); this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attrs = {}; this.style = styleOf(); }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  set textContent(v) { this.childNodes = []; this.appendChild(new Text(this.ownerDocument, String(v))); }
  get textContent() { return super.textContent; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  setAttribute(k, v) { if (k === 'style') this.style.cssText = v; else this.attrs[k] = String(v); }
  getAttribute(k) { return k === 'style' ? this.style.cssText || null : this.attrs[k] ?? null; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) { return this.all().filter((e) => (sel.startsWith('.') ? e.className.split(' ').includes(sel.slice(1)) : e.tagName === sel.toUpperCase())); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
class Sheet { constructor() { this.cssRules = []; } replaceSync() {} insertRule(r, i) { this.cssRules.splice(i, 0, r); return i; } }
const stand = ({ sheets = true } = {}) => {
  const d = { createElement: (t) => new El(d, t), createTextNode: (t) => new Text(d, t), createDocumentFragment: () => new El(d, '#fragment') };
  if (sheets) { d.adoptedStyleSheets = []; d.defaultView = { CSSStyleSheet: Sheet }; }
  return d;
};

// ---- firstPage
test('firstPage stops at the first page break', () => {
  const out = T.firstPage(F.template(ST.FORMATS.apa7, { name: 'Ada Lovelace', title: 'Engines' }));
  assert.ok(!out.content.some((n) => n.type === 'page_break'));
  assert.equal(out.content.length, 10, 'APA\'s title page: three blank lines, the title, a blank line and five lines');
  assert.deepEqual(T.firstPage(doc(p('one'), { type: 'page_break' }, p('two'))).content.map(textOf), ['one']);
  valid(out);
});

test('firstPage caps the blocks', () => {
  const many = doc(...Array.from({ length: 100 }, (_, i) => p(`p${i}`)));
  assert.equal(T.firstPage(many).content.length, 40);
  assert.equal(T.firstPage(many, { blocks: 5, chars: 3000 }).content.length, 5);
  assert.equal(T.firstPage(many, { blocks: 5 }).content.length, 5, 'a missing limit keeps its default');
});

test('firstPage caps the characters, cutting inside the last block and keeping marks', () => {
  const long = 'x'.repeat(500);
  const out = T.firstPage(doc(...Array.from({ length: 10 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: long, marks: [{ type: 'bold' }] }, { type: 'hard_break' }, { type: 'text', text: 'tail' }] }))), { blocks: 40, chars: 1200 });
  assert.equal(out.content.length, 3);
  assert.equal(out.content.map(textOf).join('').length, 1200);
  assert.deepEqual(out.content[2].content, [{ type: 'text', text: 'x'.repeat(1200 - 2 * 504), marks: [{ type: 'bold' }] }], 'what follows the cut goes');
  valid(out);
  const pair = T.firstPage(doc(p('ab\u{1F600}cd')), { chars: 3 });
  assert.equal(textOf(pair.content[0]), 'ab', 'a cut never splits a surrogate pair');
});

test('firstPage keeps lists, quotes and tables valid when the cut falls inside them', () => {
  const li = (t) => ({ type: 'list_item', content: [{ type: 'text', text: t }] });
  const cell = (t) => ({ type: 'table_cell', content: [p(t)] });
  const src = doc(p('aaaa'), { type: 'bullet_list', content: [li('bbbb'), li('cccc')] }, { type: 'blockquote', content: [p('dddd'), p('eeee')] },
    { type: 'table', content: [{ type: 'table_row', content: [cell('ffff'), cell('gggg')] }, { type: 'table_row', content: [cell('hhhh'), cell('iiii')] }] });
  for (let chars = 0; chars <= 40; chars++) {
    const out = T.firstPage(src, { blocks: 40, chars });
    valid(out);
    assert.ok(out.content.map(textOf).join('').length <= Math.max(chars, 0), `${chars}`);
  }
  assert.deepEqual(T.firstPage(src, { chars: 6 }).content[1], { type: 'bullet_list', content: [li('bb')] });
});

test('firstPage swaps big pictures for a blank pixel and leaves the input alone', () => {
  const big = `data:image/png;base64,${'A'.repeat(T.MAX_SRC + 1)}`, small = 'data:image/png;base64,iVBORw0KGgo=';
  const src = doc({ type: 'paragraph', content: [{ type: 'image', attrs: { src: big, width: 300 } }, { type: 'text', text: 'and' }, { type: 'image', attrs: { src: small } }] });
  const out = T.firstPage(src), [a, , b] = out.content[0].content;
  assert.equal(a.attrs.src, T.BLANK);
  assert.equal(a.attrs.width, 300, 'the picture keeps its width');
  assert.equal(b.attrs.src, small);
  assert.equal(src.content[0].content[0].attrs.src, big);
  assert.match(T.BLANK, /^data:image\/gif;base64,/);
  assert.ok(S.imageSrc(T.BLANK), 'the paper schema would take the pixel as a picture');
  valid(out);
});

test('firstPage of an empty paper is one empty paragraph', () => {
  for (const x of [null, undefined, {}, doc(), doc({ type: 'page_break' }, p('later'))]) {
    const out = T.firstPage(x);
    assert.deepEqual(out.content, [{ type: 'paragraph' }]);
    valid(out);
  }
  const setup = { page: [8.27, 11.69], margins: [1, 1, 1, 1] };
  assert.equal(T.firstPage({ type: 'doc', attrs: { setup }, content: [p('a')] }).attrs.setup, setup, 'the page setup stays');
});

test('firstPage of every format\'s new paper parses with the paper schema', () => {
  for (const id of ST.IDS) valid(T.firstPage(F.template(ST.FORMATS[id], { name: 'A B', course: 'C', title: 'T' })));
});

// ---- render and tile
test('render builds a scaled page box of the format\'s size, hidden from screen readers', () => {
  const d = stand(), out = T.render(doc(p('Hello')), 'mla9', { document: d });
  assert.equal(out.className, 'gt-thumb');
  assert.equal(out.getAttribute('aria-hidden'), 'true');
  const g = ST.geometry(ST.FORMATS.mla9);
  assert.equal(out.style.width, `${g.width * 0.25}px`);
  assert.equal(out.style.height, `${g.height * 0.25}px`);
  const page = out.children[0];
  assert.deepEqual(page.className.split(' ').slice(0, 2), ['gt-page', 'gp-sheet']);
  assert.equal(page.style.transform, 'scale(0.25)');
  assert.equal(page.style.transformOrigin, 'top left');
  assert.equal(page.style.width, `${g.width}px`);
  assert.equal(page.style.height, `${g.height}px`);
  const flow = page.querySelector('.gp-flow');
  assert.equal(flow.style.left, `${g.left}px`);
  assert.equal(flow.style.top, `${g.top}px`);
  const body = flow.children[0];
  assert.equal(body.className, 'ProseMirror');
  assert.equal(body.children[0].tagName, 'P');
  assert.equal(body.textContent, 'Hello');
  const half = T.render(doc(p('x')), 'mla9', { document: d, scale: 0.5 });
  assert.equal(half.children[0].style.transform, 'scale(0.5)');
  assert.equal(half.style.width, `${g.width * 0.5}px`);
});

test('render shows MLA\'s running header with the heading\'s surname, and none where the format has it off on page 1', () => {
  const d = stand(), mla = F.template(ST.FORMATS.mla9, { name: 'Ada Lovelace', course: 'ENG 101', title: 'Engines' });
  const hdr = T.render(mla, 'mla9', { document: d }).querySelector('.gp-hdr');
  assert.equal(hdr.textContent, 'Lovelace 1');
  assert.equal(T.render(mla, 'mla9', { document: d, surname: 'Byron' }).querySelector('.gp-hdr').textContent, 'Byron 1');
  assert.equal(T.render(doc(p('x')), 'apa7', { document: d }).querySelector('.gp-hdr').textContent, '1');
  assert.equal(T.render(doc(p('x')), 'chicago17', { document: d }).querySelector('.gp-hdr'), null, 'Chicago numbers from page 2');
  const off = ST.custom({ id: 'custom:plain', label: 'Plain', base: 'mla9', header: 'none' });
  assert.equal(T.render(doc(p('x')), off, { document: d }).querySelector('.gp-hdr'), null);
});

test('render draws an imported file\'s own header parts', () => {
  const setup = { page: [8.5, 11], margins: [1, 1, 1, 1], headers: { default: [{ align: 'right', runs: [{ text: 'Report ' }, { field: 'PAGE' }] }], first: null } };
  const hdr = T.render({ type: 'doc', attrs: { setup }, content: [p('x')] }, 'mla9', { document: stand() }).querySelector('.gp-hdr');
  assert.equal(hdr.children[0].className, 'gp-part');
  assert.equal(hdr.textContent, 'Report 1');
});

test('render leaves page 2 out and sets pictures to decode and load lazily', () => {
  const d = stand(), src = doc({ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } }] }, { type: 'page_break' }, p('page two'));
  const out = T.render(src, 'mla9', { document: d }), img = out.querySelector('img');
  assert.equal(img.getAttribute('decoding'), 'async');
  assert.equal(img.getAttribute('loading'), 'lazy');
  assert.ok(!out.textContent.includes('page two'));
});

test('render puts each format\'s page CSS in one adopted sheet, scoped to its class at no extra specificity', () => {
  const d = stand();
  const a = T.render(doc(p('x')), 'mla9', { document: d }).children[0], b = T.render(doc(p('y')), 'mla9', { document: d }).children[0];
  const c = T.render(doc(p('z')), 'chicago17', { document: d }).children[0];
  const cls = (e) => e.className.split(' ')[2];
  assert.equal(cls(a), cls(b), 'one class per look');
  assert.notEqual(cls(a), cls(c));
  assert.equal(d.adoptedStyleSheets.length, 1);
  const rules = d.adoptedStyleSheets[0].cssRules;
  assert.equal(rules.length, 2 * ST.css(ST.FORMATS.mla9).split('\n').length);
  assert.ok(rules.includes(`:where(.${cls(a)}).gp-sheet { width: 816px; height: 1056px; }`), 'the sheet rule names the page itself');
  for (const r of rules) for (const sel of r.slice(0, r.indexOf('{')).split(',')) assert.match(sel.trim(), /^:where\(\.gt-l\d+\)/);
  assert.ok(rules.some((r) => r.startsWith(`:where(.${cls(a)}) .gp-flow .ProseMirror p, `)));
  T.render(doc(p('x')), 'mla9', { document: stand({ sheets: false }) }); // no constructable sheets and no head: still renders
});

test('render marks the list page\'s entries and a block\'s own spacing as the editor\'s styler does', () => {
  const src = doc(p('Works Cited', { align: 'center' }), p('Entry one.'), p('Single', { line: 1 }));
  const body = T.render(src, 'mla9', { document: stand() }).querySelector('.ProseMirror');
  assert.equal(body.children[1].className, 'gp-entry');
  assert.equal(body.children[2].className, 'gp-entry');
  assert.equal(body.children[2].style.lineHeight, `${ST.blockBox(ST.FORMATS.mla9, { line: 1 }, { entry: true }).line}px`);
});

test('render keeps empty lines and a closing line break a line tall, as the editor does', () => {
  const br = (e) => e.childNodes.at(-1)?.tagName === 'BR';
  const apa = T.tile('apa7', { title: 'Engines' }, { document: stand() }).querySelector('.ProseMirror').children;
  assert.deepEqual(apa.slice(0, 4).map(br), [true, true, true, false], 'APA\'s title sits three lines down');
  const src = doc({ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hard_break' }] },
    { type: 'table', content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [p('')] }] }] });
  const body = T.render(src, 'mla9', { document: stand() }).querySelector('.ProseMirror');
  assert.ok(br(body.children[0]));
  assert.ok(br(body.querySelector('td').children[0]), 'inside a table too');
});

test('a broken record still renders an empty page', () => {
  const out = T.render(doc({ type: 'no_such_node' }), 'mla9', { document: stand() });
  assert.equal(out.querySelector('.ProseMirror').children.length, 1);
});

test('tile draws each format\'s new paper, its lines empty or filled', () => {
  const d = stand();
  for (const id of ST.IDS) {
    const out = T.tile(id, { name: '', course: '', title: '' }, { document: d });
    assert.equal(out.className, 'gt-thumb', id);
    assert.ok(!out.textContent.includes(ST.FORMATS[id].list.title), `${id}: the list page is not page 1`);
  }
  assert.equal(T.tile('mla9', { name: '' }, { document: d }).querySelector('.gp-hdr').textContent, '1');
  const filled = T.tile('apa7', { name: 'Ada Lovelace', title: 'Engines' }, { document: d });
  assert.ok(filled.textContent.includes('Engines') && filled.textContent.includes('Ada Lovelace'));
});

test('writer-thumb reads no layout, sets no timers and writes no HTML strings', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'writer-thumb.js'), 'utf8');
  for (const bad of ['getBoundingClientRect', 'getComputedStyle', 'offsetWidth', 'offsetHeight', 'clientWidth', 'scrollHeight', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'innerHTML', 'insertAdjacentHTML', '<canvas', 'getContext']) assert.ok(!src.includes(bad), bad);
});
