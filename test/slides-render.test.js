// The slides viewer's renderer (lib/slides-render.js): one slide of lib/pptx.js's model as DOM, built with createElement,
// createElementNS and textContent only, on a document stub that refuses HTML strings. The fixture deck is
// test/fixtures/pptx/deck, zipped with lib/zip.js as test/pptx.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Z = require('../lib/zip.js');
const P = require('../lib/pptx.js');
const R = require('../lib/slides-render.js');

const DIR = path.join(__dirname, 'fixtures/pptx/deck');
const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== '.DS_Store')
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), `${base}${e.name}/`) : [[`${base}${e.name}`, fs.readFileSync(path.join(dir, e.name))]]));
const bytes = new Uint8Array(Buffer.concat(Z.zip(walk(DIR).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, data]) => ({ name, data: new Uint8Array(data), date: new Date(2026, 9, 29, 12) })))));
let model;
const deck = () => (model ||= P.read(bytes));

// ---- a document that builds elements and refuses every HTML string ------------------------------------------------------
const HTML_NS = 'http://www.w3.org/1999/xhtml', SVG_NS = 'http://www.w3.org/2000/svg';
const refuse = (what) => () => { throw new Error(`${what} is not allowed`); };
class Style {
  constructor() { this.props = new Map(); }
  setProperty(k, v) { if (v == null || v === '') this.props.delete(k); else this.props.set(k, String(v)); }
  getPropertyValue(k) { return this.props.get(k) ?? ''; }
}
class Text {
  constructor(data) { this.nodeType = 3; this.data = String(data); this.parentNode = null; }
  get textContent() { return this.data; }
}
class El {
  constructor(ns, tag) { this.nodeType = 1; this.namespaceURI = ns; this.tagName = ns === HTML_NS ? tag.toUpperCase() : tag; this.localName = tag; this.attrs = new Map(); this.childNodes = []; this.style = new Style(); this.parentNode = null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  append(...kids) { for (const k of kids) { const n = typeof k === 'string' ? new Text(k) : k; n.parentNode = this; this.childNodes.push(n); } }
  appendChild(k) { this.append(k); return k; }
  replaceChildren(...kids) { this.childNodes = []; this.append(...kids); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.childNodes = []; if (v !== '' && v != null) this.append(String(v)); }
  set innerHTML(_) { refuse('innerHTML')(); }
  get innerHTML() { return refuse('innerHTML')(); }
  set outerHTML(_) { refuse('outerHTML')(); }
  insertAdjacentHTML() { refuse('insertAdjacentHTML')(); }
  addEventListener() {}
}
const doc = {
  createElement: (tag) => new El(HTML_NS, tag),
  createElementNS: (ns, tag) => new El(ns, tag),
  createTextNode: (s) => new Text(s),
  createDocumentFragment: refuse('fragments'),
  write: refuse('document.write'),
};
const all = (el) => [el, ...el.children.flatMap(all)];
const find = (el, fn) => all(el).find(fn);
const cls = (name) => (e) => e.className.split(/\s+/).includes(name);
const tag = (name) => (e) => e.localName === name;
const named = (root, name) => find(root, (e) => e.getAttribute('data-name') === name);
// The paths a shape draws: its SVG's own, not those inside its defs (markers, clip paths).
const drawn = (box) => find(box, tag('svg')).children.find(tag('path'));
const MEDIA = new Map([['ppt/media/image1.png', 'blob:test/png'], ['ppt/media/image3.svg', 'blob:test/svg']]);
const LABELS = { chart: 'Chart', smartart: 'Diagram', ole: 'Object', picture: 'Picture', media: 'Video', table: 'Table', broken: '', other: '' };
const draw = async (n, o = {}) => { const d = await deck(); return R.slide(d.slides[n], d, { document: doc, media: MEDIA, labels: LABELS, ...o }); };
const px = (s) => Number(/^(-?[\d.]+)px$/.exec(s)?.[1]);

test('a slide is its own size in CSS pixels (9525 EMU each), its background, and a box per shape in model order', async () => {
  const el = await draw(0);
  assert.equal(el.localName, 'div');
  assert.ok(cls('gs-slide')(el));
  assert.equal(el.style.getPropertyValue('width'), '1280px');
  assert.equal(el.style.getPropertyValue('height'), '720px');
  assert.equal(el.style.getPropertyValue('background-color'), '#ffffff');
  assert.equal(el.style.getPropertyValue('position'), 'relative');
  assert.equal(el.style.getPropertyValue('overflow'), 'hidden');
  const boxes = el.children.filter(cls('gs-shape'));
  assert.deepEqual(boxes.map((b) => b.getAttribute('data-name')), ['Accent bar', 'Course tag', 'Title 1', 'Subtitle 2']);
  const bar = boxes[0];
  assert.deepEqual(['left', 'top', 'width', 'height'].map((k) => px(bar.style.getPropertyValue(k))), [0, 6705600 / 9525, 1280, 152400 / 9525]);
  // Each shape draws in an SVG of its own whose viewBox is its EMU box.
  const svg = bar.children.find(tag('svg'));
  assert.equal(svg.namespaceURI, SVG_NS);
  assert.equal(svg.getAttribute('viewBox'), '0 0 12192000 152400');
  assert.equal(svg.getAttribute('preserveAspectRatio'), 'none');
  const p = svg.children.find(tag('path'));
  assert.equal(p.getAttribute('d'), 'M 0 0 L 12192000 0 L 12192000 152400 L 0 152400 Z');
  assert.match(p.getAttribute('fill'), /^#[0-9a-f]{6}$/);
});

test('scale: the slide fits its box, and a stage is the slide scaled with its layout box the scaled size', async () => {
  const d = await deck();
  assert.equal(R.EMU, 9525);
  assert.equal(R.px(9525), 1);
  assert.equal(R.fit(d.size, 640, 640), 0.5);
  assert.equal(R.fit(d.size, 1280, 360), 0.5);
  assert.equal(R.fit({ w: 9144000, h: 6858000 }, 480, 1000), 0.5); // 4:3 is 960 × 720
  assert.equal(R.fit(d.size, 0, 0), 0);
  const stage = R.stage(d.slides[0], d, { document: doc, media: MEDIA, labels: LABELS, scale: 0.25 });
  assert.ok(cls('gs-stage')(stage));
  assert.equal(stage.style.getPropertyValue('width'), '320px');
  assert.equal(stage.style.getPropertyValue('height'), '180px');
  const inner = stage.children[0];
  assert.ok(cls('gs-slide')(inner));
  assert.equal(inner.style.getPropertyValue('transform'), 'scale(0.25)');
  assert.equal(inner.style.getPropertyValue('transform-origin'), '0 0');
});

test('text: runs in their fonts (the vendored faces by the names writer-paper.css gives them), sizes in points and vertical anchors', async () => {
  const el = await draw(0);
  const title = named(el, 'Title 1');
  const body = find(title, cls('gs-body'));
  assert.equal(body.style.getPropertyValue('justify-content'), 'flex-end'); // anchor b
  const run = find(title, (e) => e.localName === 'span' && e.textContent === 'Cell Biology');
  assert.equal(run.style.getPropertyValue('font-family'), '"Calibri Light", "Calibri", sans-serif');
  assert.equal(px(run.style.getPropertyValue('font-size')), 80); // 60 pt
  assert.equal(run.style.getPropertyValue('color'), '#000000');
  const para = find(title, cls('gs-p'));
  assert.equal(para.style.getPropertyValue('text-align'), 'center');
  assert.equal(para.style.getPropertyValue('line-height'), '1.08'); // 90% of PowerPoint's single line (1.2)
  // The master's slide-number field shows this slide's number.
  assert.equal(named(el, 'Course tag').textContent, 'BIO 110 · 1');
  // Other faces: Times New Roman, Courier New and Arial by the vendored names; a font Glaze lacks keeps its name and generic.
  const note = named(await draw(2), 'Note');
  const fam = (text) => find(note, (e) => e.localName === 'span' && e.textContent === text).style.getPropertyValue('font-family');
  assert.equal(fam('Serif'), '"Times New Roman", serif');
  assert.equal(fam('Mono'), '"Courier New", monospace');
  assert.equal(fam('Comic'), '"Comic Sans MS", cursive');
  assert.equal(fam('Sans'), '"Arial", sans-serif');
  assert.equal(find(note, cls('gs-body')).style.getPropertyValue('white-space'), 'pre'); // wrap none
  const link = find(note, (e) => e.localName === 'span' && e.textContent === 'reading');
  assert.equal(link.style.getPropertyValue('text-decoration-line'), 'underline');
  assert.ok(find(note, tag('br')), 'a line break');
  assert.equal(find(note, (e) => e.localName === 'span' && e.textContent === 'Sans').style.getPropertyValue('color'), 'rgba(0, 176, 80, 0.502)');
});

test('bullets and auto-numbering hang in the indent; autofit scales the type', async () => {
  const el = await draw(1);
  const body = named(el, 'Content Placeholder 2');
  const paras = all(body).filter(cls('gs-p'));
  assert.deepEqual(paras.map((p) => find(p, cls('gs-bu'))?.textContent ?? null), ['•', '–', '•', '•', null, '1.', 'a)', 'b)', '2.', 'IV.']);
  const [first] = paras;
  assert.equal(px(first.style.getPropertyValue('padding-left')), 24); // marL 228600
  assert.equal(px(first.style.getPropertyValue('text-indent')), -24);
  const bu = find(first, cls('gs-bu'));
  assert.equal(px(bu.style.getPropertyValue('min-width')), 24);
  assert.equal(bu.style.getPropertyValue('font-family'), '"Arial", sans-serif');
  // fontScale 92.5%: 28 pt → 25.9 pt; lnSpcReduction 10% off 90%.
  const run = find(first, (e) => e.localName === 'span' && e.textContent === 'Passive transport');
  assert.equal(px(run.style.getPropertyValue('font-size')), Math.round(28 * 0.925 * 4 / 3 * 100) / 100);
  assert.equal(first.style.getPropertyValue('line-height'), '0.96'); // (0.9 - 0.1) × 1.2
  assert.equal(px(first.style.getPropertyValue('margin-top')), Math.round(10 * 0.925 * 4 / 3 * 100) / 100); // spcBef 10 pt, scaled
  assert.equal(find(paras[9], cls('gs-bu')).style.getPropertyValue('color'), '#c00000');
  // An empty paragraph keeps its line: the end mark's size.
  assert.equal(px(paras[4].style.getPropertyValue('font-size')), Math.round(14 * 0.925 * 4 / 3 * 100) / 100);
  assert.ok(find(paras[4], tag('br')));
});

test('geometry: presets and custom paths, gradients, dashes, caps and arrowheads; rotation and flips on the box', async () => {
  const el = await draw(2);
  const rounded = named(el, 'Rounded');
  assert.match(rounded.style.getPropertyValue('transform'), /rotate\(90deg\)/);
  const rp = drawn(rounded);
  assert.match(rp.getAttribute('d'), /A /, 'roundRect has arcs');
  assert.equal(rp.getAttribute('stroke'), '#ff0000');
  assert.equal(rp.getAttribute('stroke-width'), '28575');
  assert.equal(rp.getAttribute('stroke-linecap'), 'round');
  assert.equal(rp.getAttribute('stroke-dasharray'), '114300 85725'); // dash: 4 and 3 line widths
  const arrow = named(el, 'Arrow');
  assert.match(arrow.style.getPropertyValue('transform'), /scale\(1, -1\)/);
  const ap = drawn(arrow);
  assert.equal(ap.getAttribute('fill'), 'none');
  const markers = all(arrow).filter(tag('marker'));
  assert.equal(markers.length, 2);
  assert.match(ap.getAttribute('marker-start'), /^url\(#gs\d+-\d+\)$/);
  assert.match(ap.getAttribute('marker-end'), /^url\(#gs\d+-\d+\)$/);
  const head = markers.find((m) => `url(#${m.getAttribute('id')})` === ap.getAttribute('marker-start'));
  assert.ok(find(head, tag('ellipse')), 'an oval head');
  assert.equal(head.getAttribute('orient'), 'auto-start-reverse');
  const tri = named(el, 'Triangle');
  assert.match(tri.style.getPropertyValue('transform'), /scale\(-1, 1\)/);
  const grad = find(tri, tag('linearGradient'));
  assert.ok(grad, 'a linear gradient');
  assert.deepEqual(grad.children.filter(tag('stop')).map((s) => [s.getAttribute('offset'), s.getAttribute('stop-color')]), [['0', '#cfd5ea'], ['1', '#2f528f']]);
  assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map((k) => grad.getAttribute(k)), ['0.5', '0', '0.5', '1']); // 90°: top to bottom
  const tp = drawn(tri);
  assert.equal(tp.getAttribute('fill'), `url(#${grad.getAttribute('id')})`);
  assert.equal(tp.getAttribute('d'), 'M 914400 0 L 1828800 1828800 L 0 1828800 Z'); // its 100 × 100 path space stretched
  // Effects and 3-D are dropped: the shadowed ellipse is its plain fill.
  assert.equal(drawn(named(el, 'Shadowed')).getAttribute('fill'), '#70ad47');
});

test('pictures: a blob: URL from the media map, cropped, clipped to their geometry, with alt text; undrawable ones are titled frames', async () => {
  const el = await draw(3);
  const pic = named(el, 'Picture 2');
  const img = find(pic, tag('image'));
  assert.equal(img.getAttribute('href'), 'blob:test/png');
  // Crop l 10%, t 20%, r 30%: the visible part stretched to the box.
  const w = 3200400 / 0.6, h = 2400300 / 0.8;
  assert.deepEqual(['x', 'y', 'width', 'height'].map((k) => Math.round(Number(img.getAttribute(k)))), [-0.1 * w, -0.2 * h, w, h].map(Math.round));
  assert.equal(img.getAttribute('preserveAspectRatio'), 'none');
  const clip = find(pic, tag('clipPath'));
  assert.equal(img.getAttribute('clip-path'), `url(#${clip.getAttribute('id')})`);
  assert.match(find(clip, tag('path')).getAttribute('d'), /A /, 'clipped to the ellipse');
  assert.equal(pic.getAttribute('role'), 'img');
  assert.equal(named(el, 'Icon').getAttribute('aria-label'), 'Microscope icon');
  assert.equal(find(named(el, 'Icon'), tag('image')).getAttribute('opacity'), '0.6');
  const emf = named(el, 'Diagram EMF');
  assert.ok(cls('gs-box')(emf));
  assert.equal(emf.textContent, 'Picture');
  const boxes = await draw(7);
  assert.equal(named(boxes, 'Chart 5').textContent, 'Enrolment by term');
  assert.equal(named(boxes, 'Diagram 6').textContent, 'Diagram');
  assert.equal(named(boxes, 'Object 8').textContent, 'Object');
  assert.equal(named(boxes, 'Missing picture').textContent, 'Lab photo');
  // A picture fill (an equation's stored picture) is an image in the shape's own SVG.
  assert.equal(find(named(boxes, 'Equation'), tag('image')).getAttribute('href'), 'blob:test/png');
  // A media part the map lacks draws no image at all.
  const bare = R.slide((await deck()).slides[3], await deck(), { document: doc, media: new Map(), labels: LABELS });
  assert.equal(all(bare).filter(tag('image')).length, 0);
});

test('tables: columns, row heights, spans with the merged cells left out, fills and borders', async () => {
  const el = await draw(4);
  const table = find(el, tag('table'));
  assert.ok(table);
  assert.deepEqual(find(table, tag('colgroup')).children.map((c) => px(c.style.getPropertyValue('width'))), [368, 368, 368].map((x) => Math.round(3505200 / 9525 * 100) / 100 || x));
  const rows = all(table).filter(tag('tr'));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.children.length), [3, 2, 3, 2]);
  assert.equal(rows[1].children[0].getAttribute('colspan'), '2');
  assert.equal(rows[2].children[0].getAttribute('rowspan'), '2');
  assert.deepEqual(rows.map((r) => r.children.map((c) => c.textContent)), [['Molecule', 'Rate', 'Notes'], ['Oxygen fast', 'small'], ['Glucose', 'slow', 'carrier'], ['slower', '']]);
  assert.equal(rows[0].children[0].style.getPropertyValue('background-color'), '#4472c4');
  assert.equal(rows[2].children[2].style.getPropertyValue('background-color'), '#ffff00');
  assert.equal(rows[0].children[0].style.getPropertyValue('border-bottom'), `${Math.round(38100 / 9525 * 100) / 100}px solid #ffffff`);
  assert.equal(px(rows[0].style.getPropertyValue('height')), Math.round(370840 / 9525 * 100) / 100);
  assert.equal(table.style.getPropertyValue('table-layout'), 'fixed');
  assert.equal(table.style.getPropertyValue('border-collapse'), 'collapse');
});

test('groups nest: each box at its place in its group, the group turned and flipped about its centre', async () => {
  const el = await draw(5);
  const outer = named(el, 'Outer');
  assert.ok(cls('gs-group')(outer));
  assert.deepEqual(['left', 'top', 'width', 'height'].map((k) => px(outer.style.getPropertyValue(k))), [1000000, 2000000, 4000000, 2000000].map((v) => Math.round(v / 9525 * 100) / 100));
  const a = named(outer, 'A'), inner = named(outer, 'Inner');
  assert.equal(a.parentNode, outer);
  assert.equal(inner.parentNode, outer);
  assert.deepEqual(['left', 'top'].map((k) => px(a.style.getPropertyValue(k))), [Math.round(1000000 / 9525 * 100) / 100, 0]); // A at (2e6, 2e6) in a group at (1e6, 2e6)
  assert.match(inner.style.getPropertyValue('transform'), /rotate\(90deg\)/);
  assert.equal(inner.style.getPropertyValue('transform-origin'), '50% 50%');
  const c = named(inner, 'C');
  assert.equal(c.parentNode, inner);
  assert.deepEqual(['left', 'top'].map((k) => px(c.style.getPropertyValue(k))), [1000000, 500000].map((v) => Math.round(v / 9525 * 100) / 100));
  assert.match(c.style.getPropertyValue('transform'), /rotate\(45deg\)/);
  assert.equal(drawn(a).getAttribute('fill'), '#ffc000'); // the group's fill
});

test('find marks each match in the slide\'s text; text() is what find searches; hidden slides are left out of visible()', async () => {
  const d = await deck();
  const el = await draw(1, { find: 'TRANSPORT' });
  const marks = all(el).filter(tag('mark'));
  assert.deepEqual(marks.map((m) => m.textContent), ['transport', 'transport', 'transport']); // title, Passive, Active
  assert.ok(marks.every(cls('gs-hit')));
  assert.match(R.text(d.slides[1]), /Membrane transport/);
  assert.match(R.text(d.slides[1]), /Potassium/);
  assert.match(R.text(d.slides[4]), /Glucose/, 'table cells');
  assert.match(R.text(d.slides[5]), /Inside/, 'grouped shapes');
  assert.equal(R.count(R.text(d.slides[1]), 'transport'), 3);
  assert.equal(R.count('aaa', 'aa'), 1, 'matches do not overlap');
  assert.equal(R.count('anything', ''), 0);
  assert.deepEqual(R.visible(d), [0, 1, 2, 3, 4, 5, 7, 8, 9]);
  // A missing or broken slide draws as an empty white slide.
  const empty = R.slide(d.slides[9], d, { document: doc, media: MEDIA, labels: LABELS });
  assert.equal(empty.children.length, 0);
  assert.equal(empty.style.getPropertyValue('background-color'), '#ffffff');
});

test('every slide of the fixture draws, through DOM calls alone', async () => {
  const d = await deck();
  for (const s of d.slides) R.slide(s, d, { document: doc, media: MEDIA, labels: LABELS });
  const src = fs.readFileSync(path.join(__dirname, '../lib/slides-render.js'), 'utf8');
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'createContextualFragment', 'DOMParser']) assert.ok(!src.includes(sink), sink);
  assert.ok(!/setAttribute\(\s*['"]style['"]/.test(src), 'styles through the CSSOM, never a style attribute (papers.html allows no inline style)');
});


test('find spans adjacent formatted runs as one hit and excludes merged table continuations', async () => {
  const d = await deck(), s = structuredClone(d.slides[1]);
  s.shapes = [s.shapes.find((s) => s.text?.paragraphs.some((p) => p.runs.some((r) => r.text === 'Passive transport')))];
  const p = s.shapes[0].text.paragraphs.find((p) => p.runs.some((r) => r.text === 'Passive transport'));
  const r = p.runs[0];
  p.runs = [{ ...r, text: 'Passive trans' }, { ...r, text: 'port', bold: true }];
  const el = R.slide(s, d, { document: doc, find: 'Passive transport' });
  const marks = all(el).filter(tag('mark'));
  assert.equal(R.count(R.text(s), 'Passive transport'), 1);
  assert.equal(marks.map((m) => m.textContent).join(''), 'Passive transport');
  assert.deepEqual(marks.map((m) => m.getAttribute('data-gs-hit')), ['0', '0'], 'two styled fragments of one find hit');
  const table = structuredClone(d.slides[4]);
  const merged = table.shapes.find((s) => s.type === 'table').rows.flatMap((r) => r.cells).find((c) => c.merged);
  merged.text.paragraphs[0].runs = [{ ...r, text: 'invisible continuation' }];
  assert.equal(R.count(R.text(table), 'invisible continuation'), 0, 'a cell the renderer skips is not a find hit');
});
