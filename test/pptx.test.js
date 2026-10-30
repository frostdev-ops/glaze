const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Z = require('../lib/zip.js');
const P = require('../lib/pptx.js');

// The deck under test/fixtures/pptx/deck, laid out as its package: zipped here as it stands, or with parts swapped.
const DIR = path.join(__dirname, 'fixtures/pptx/deck');
const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== '.DS_Store')
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), `${base}${e.name}/`) : [[`${base}${e.name}`, fs.readFileSync(path.join(dir, e.name))]]));
const FILES = new Map(walk(DIR));
const fixture = (name) => FILES.get(name).toString('utf8');
const pack = (changes = {}) => {
  const all = new Map(FILES);
  for (const [name, data] of Object.entries(changes)) if (data == null) all.delete(name); else all.set(name, Buffer.from(data));
  const files = [...all].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, data]) => ({ name, data: new Uint8Array(data), date: new Date(2026, 9, 29, 12) }));
  return new Uint8Array(Buffer.concat(Z.zip(files)));
};
let base;
const deck = () => (base ||= P.read(pack()));

const all = (s) => s.shapes.flatMap(function flat(x) { return [x, ...(x.shapes || []).flatMap(flat)]; });
const named = (s, name) => all(s).find((x) => x.name === name);
const textOf = (x) => x.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const CALIBRI = { name: 'Calibri', face: 'carlito', generic: 'sans-serif' };
const CALIBRI_LIGHT = { name: 'Calibri Light', face: 'carlito', generic: 'sans-serif' };

test('the deck: slide and notes size, theme, and the slides in presentation order with their numbers and titles', async () => {
  const d = await deck();
  assert.deepEqual(d.size, { w: 12192000, h: 6858000 });
  assert.deepEqual(d.notesSize, { w: 6858000, h: 9144000 });
  assert.equal(d.theme.name, 'Office Theme');
  assert.deepEqual(d.theme.colors, {
    dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5',
    accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1', folHlink: '#954f72',
  });
  assert.deepEqual(d.theme.fonts, { major: CALIBRI_LIGHT, minor: CALIBRI });
  assert.deepEqual(d.slides.map((s) => s.id), [256, 257, 258, 259, 260, 261, 262, 263, 264, 265]);
  assert.deepEqual(d.slides.map((s) => s.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(d.slides.map((s) => s.title), ['Cell Biology', 'Membrane transport', '', 'Microscopy', 'Transport rates', 'Groups', 'Backup slide', 'Odds and ends', '', '']);
});

test('placeholders inherit position, body properties and list styles master → layout → slide, by idx then type', async () => {
  const [s1, s2] = (await deck()).slides;
  assert.deepEqual(s1.shapes.map((x) => [x.name, x.from]), [['Accent bar', 'master'], ['Course tag', 'master'], ['Title 1', 'slide'], ['Subtitle 2', 'slide']]);
  assert.deepEqual(s2.shapes.map((x) => [x.name, x.from]), [
    ['Accent bar', 'master'], ['Course tag', 'master'], ['Layout stripe', 'layout'], ['Title 1', 'slide'], ['Content Placeholder 2', 'slide'], ['Slide Number Placeholder 3', 'slide'],
  ]);
  assert.ok(![s1, s2].some((s) => all(s).some((x) => x.text && /Click to edit/.test(textOf(x)))), "a layout's prompt text never shows");

  const title = named(s1, 'Title 1');
  assert.equal(title.placeholder, 'ctrTitle');
  assert.deepEqual(title.bounds, { x: 1524000, y: 1122363, w: 9144000, h: 2387600 }); // the layout's
  assert.equal(title.text.anchor, 'b'); // the layout's
  assert.deepEqual(title.text.insets, { l: 91440, t: 45720, r: 91440, b: 45720 }); // the master's
  assert.deepEqual(title.text.autofit, { type: 'normal', fontScale: 1, lineReduction: 0 }); // the master's
  const [tp] = title.text.paragraphs;
  assert.deepEqual(pick(tp, ['align', 'lineSpacing', 'bullet']), { align: 'center', lineSpacing: { pct: 0.9 }, bullet: null });
  assert.deepEqual(pick(tp.runs[0], ['text', 'size', 'color', 'font', 'bold']), { text: 'Cell Biology', size: 60, color: '#000000', font: CALIBRI_LIGHT, bold: false });

  const sub = named(s1, 'Subtitle 2');
  assert.equal(sub.placeholder, 'subTitle');
  assert.deepEqual(sub.bounds, { x: 1524000, y: 3602038, w: 9144000, h: 1655762 });
  const [sp] = sub.text.paragraphs;
  assert.deepEqual(pick(sp, ['align', 'marL', 'indent', 'bullet']), { align: 'center', marL: 0, indent: 0, bullet: null });
  assert.deepEqual(pick(sp.runs[0], ['size', 'font']), { size: 24, font: CALIBRI });

  const t2 = named(s2, 'Title 1');
  assert.deepEqual(t2.bounds, { x: 838200, y: 365125, w: 10515600, h: 1325563 }); // the layout has none: the master's
  assert.equal(t2.text.anchor, 'ctr');
  assert.deepEqual(pick(t2.text.paragraphs[0], ['align']), { align: 'left' });
  assert.equal(t2.text.paragraphs[0].runs[0].size, 44);

  const body = named(s2, 'Content Placeholder 2');
  assert.equal(body.placeholder, 'obj');
  assert.deepEqual(body.bounds, { x: 838200, y: 1825625, w: 10515600, h: 4351338 }); // layout idx 1 → master body by type
  const caption = named((await deck()).slides[3], 'Caption');
  assert.deepEqual(caption.bounds, { x: 6172200, y: 1825625, w: 5181600, h: 4351338 }); // idx 2, not the layout's first content placeholder
  assert.equal(caption.text.paragraphs[0].runs[0].size, 28);

  const num = named(s2, 'Slide Number Placeholder 3');
  assert.equal(num.placeholder, 'sldNum');
  assert.deepEqual(num.bounds, { x: 8610600, y: 6356350, w: 2743200, h: 365125 });
  assert.equal(textOf(num), '2'); // the field's stored "9" is stale
  assert.deepEqual(pick(num.text.paragraphs[0], ['align', 'bullet', 'marL']), { align: 'right', bullet: null, marL: 0 }); // other style, not body
  assert.deepEqual(pick(num.text.paragraphs[0].runs[0], ['size', 'color', 'field']), { size: 12, color: '#898989', field: 'slidenum' });
});

test('text: levels from the list styles, bullets, auto-numbering and the stored autofit scales', async () => {
  const s2 = (await deck()).slides[1];
  const body = named(s2, 'Content Placeholder 2');
  assert.deepEqual(body.text.autofit, { type: 'normal', fontScale: 0.925, lineReduction: 0.1 });
  const ps = body.text.paragraphs;
  assert.deepEqual(ps.map((p) => [p.level, p.runs.map((r) => r.text).join(''), p.runs[0]?.size ?? null, p.bullet && p.bullet.text, p.marL]), [
    [0, 'Passive transport', 28, '•', 228600],
    [1, 'Diffusion', 22, '–', 685800], // size and bullet from the layout's level 2, the rest from the master's
    [2, 'Facilitated', 20, '•', 1143000],
    [0, 'Active transport', 32, '•', 228600],
    [0, '', null, null, 228600], // an empty paragraph has no bullet
    [0, 'Pump', 28, '1.', 457200],
    [1, 'Sodium', 22, 'a)', 914400],
    [1, 'Potassium', 22, 'b)', 914400],
    [0, 'Vesicles', 28, '2.', 457200], // deeper paragraphs keep the count
    [0, 'Endocytosis', 28, 'IV.', 457200], // a new scheme restarts at its startAt
  ]);
  assert.deepEqual(pick(ps[0], ['indent', 'spaceBefore', 'lineSpacing', 'align']), { indent: -228600, spaceBefore: { pt: 10 }, lineSpacing: { pct: 0.9 }, align: 'left' });
  assert.deepEqual(ps[0].bullet, { text: '•', font: { name: 'Arial', face: 'arimo', generic: 'sans-serif' }, color: '#000000', size: 28 });
  assert.deepEqual(ps[1].spaceBefore, { pt: 5 });
  assert.equal(ps[2].runs[0].color, '#2f5597');
  assert.equal(ps[2].bullet.color, '#2f5597'); // a bullet takes its paragraph's first run's colour
  assert.equal(ps[3].runs[0].bold, true);
  assert.equal(ps[4].endSize, 14);
  assert.deepEqual(ps[5].bullet.font, CALIBRI_LIGHT);
  assert.deepEqual(pick(ps[9].bullet, ['text', 'color', 'size']), { text: 'IV.', color: '#c00000', size: 21 });
});

test('theme colours: the colour map and its overrides, lumMod/lumOff, tint, shade and alpha', async () => {
  const d = await deck();
  const [s1, s2, s3, , , s6] = d.slides;
  // PowerPoint's own values for Office's accent 1 (#4472c4): lighter 40% (lumMod 60%, lumOff 40%), its default shapes'
  // outline (shade 50%), the gradient's tint 40%; tx1 tinted 75% is the footers' grey.
  assert.deepEqual(named(s3, 'Default').fill, { type: 'solid', color: '#4472c4' });
  assert.equal(named(s3, 'Default').line.color, '#2f528f');
  assert.deepEqual(named(s3, 'Rounded').fill, { type: 'solid', color: '#8faadc80' });
  assert.deepEqual(named(s3, 'Triangle').fill.stops.map((s) => s.color), ['#cfd5ea', '#2f528f']);
  assert.equal(named(s3, 'Note').text.paragraphs[1].runs.at(-1).color, '#00b05080');
  assert.deepEqual(s1.background, { type: 'solid', color: '#ffffff' }); // the master's bgRef 1001 with bg1
  assert.deepEqual(s3.background, { type: 'solid', color: '#e7e6e6' }); // its own, bg2 → lt2
  assert.deepEqual(named(s2, 'Accent bar').fill, { type: 'solid', color: '#44546a' });
  // Slide 6 maps bg1 → dk1, tx1 → lt1, tx2 → lt2: the master's shapes and background follow it.
  assert.deepEqual(s6.background, { type: 'solid', color: '#000000' });
  assert.deepEqual(named(s6, 'Accent bar').fill, { type: 'solid', color: '#e7e6e6' });
  assert.equal(named(s6, 'Course tag').text.paragraphs[0].runs[0].color, '#ffffff');
  assert.equal(named(s6, 'Title 1').text.paragraphs[0].runs[0].color, '#ffffff');
});

test('shapes: presets with adjust values, custom geometry, style references, lines, arrowheads, effects cut', async () => {
  const s3 = (await deck()).slides[2];
  assert.deepEqual(s3.shapes.map((x) => x.name), ['Default', 'Rounded', 'Arrow', 'Triangle', 'Shadowed', 'Note']); // Blank hides the master's; hidden shapes go
  const def = named(s3, 'Default');
  assert.deepEqual(pick(def, ['type', 'id', 'bounds', 'rotation', 'flipH', 'flipV', 'geometry']), {
    type: 'shape', id: 2, bounds: { x: 609600, y: 609600, w: 2438400, h: 1219200 }, rotation: 0, flipH: false, flipV: false, geometry: { prst: 'rect', avLst: {} },
  });
  assert.deepEqual(def.line, { width: 12700, color: '#2f528f', dash: 'solid', cap: 'flat', join: 'miter', head: null, tail: null });
  assert.equal(def.text.anchor, 'ctr');
  assert.deepEqual(pick(def.text.paragraphs[0].runs[0], ['text', 'color', 'font', 'size']), { text: 'Default', color: '#ffffff', font: CALIBRI, size: 18 }); // fontRef minor, lt1

  const round = named(s3, 'Rounded');
  assert.deepEqual(pick(round, ['rotation', 'geometry']), { rotation: 90, geometry: { prst: 'roundRect', avLst: { adj: 25000 } } });
  assert.deepEqual(round.line, { width: 28575, color: '#ff0000', dash: 'dash', cap: 'round', join: 'round', head: null, tail: null });

  const arrow = named(s3, 'Arrow');
  assert.deepEqual(pick(arrow, ['type', 'flipH', 'flipV', 'fill', 'geometry']), { type: 'shape', flipH: false, flipV: true, fill: null, geometry: { prst: 'straightConnector1', avLst: {} } });
  assert.deepEqual(arrow.line, { width: 19050, color: '#000000', dash: 'solid', cap: 'flat', join: 'round', head: { type: 'oval', w: 'med', len: 'med' }, tail: { type: 'triangle', w: 'med', len: 'lg' } });

  const tri = named(s3, 'Triangle');
  assert.equal(tri.flipH, true);
  // lib/pptx-geom.js's input: custom geometry as written, values as numbers or guide names.
  assert.deepEqual(tri.geometry, {
    avLst: [], gdLst: [{ name: 'mid', fmla: '*/ w 1 2' }], cxnLst: [], rect: { l: '0', t: '0', r: 'r', b: 'b' },
    pathLst: [{ w: 100, h: 100, fill: 'norm', stroke: true, cmds: [
      { cmd: 'moveTo', pts: [{ x: '50', y: '0' }] }, { cmd: 'lnTo', pts: [{ x: '100', y: '100' }] }, { cmd: 'lnTo', pts: [{ x: '0', y: '100' }] }, { cmd: 'close' },
    ] }],
  });
  assert.deepEqual(tri.fill, { type: 'gradient', kind: 'linear', angle: 90, rotate: true, stops: [{ at: 0, color: '#cfd5ea' }, { at: 1, color: '#2f528f' }] });
  assert.equal(tri.line, null);

  const shadowed = named(s3, 'Shadowed');
  assert.deepEqual(pick(shadowed, ['fill', 'cut']), { fill: { type: 'solid', color: '#70ad47' }, cut: ['effects', '3d'] });
  assert.equal(def.cut, undefined);

  const note = named(s3, 'Note');
  assert.deepEqual(pick(note.text, ['wrap', 'autofit']), { wrap: false, autofit: { type: 'shape', fontScale: 1, lineReduction: 0 } });
  const runs = note.text.paragraphs.flatMap((p) => p.runs);
  assert.deepEqual(runs.map((r) => r.text), ['Note ', 'reading', 'Serif', 'Mono', 'Comic', '\n', 'Sans']);
  const [plain, link, serif, mono, comic, br, sans] = runs;
  assert.deepEqual(pick(plain, ['size', 'color', 'font', 'link', 'underline']), { size: 18, color: '#000000', font: CALIBRI, link: false, underline: false });
  assert.deepEqual(pick(link, ['color', 'link', 'underline']), { color: '#0563c1', link: true, underline: 'solid' });
  assert.deepEqual(serif.font, { name: 'Times New Roman', face: 'tinos', generic: 'serif' });
  assert.deepEqual(pick(mono, ['font', 'italic', 'underline', 'strike', 'baseline', 'caps', 'spacing']), {
    font: { name: 'Courier New', face: 'cousine', generic: 'monospace' }, italic: true, underline: 'solid', strike: 'single', baseline: 0.3, caps: 'small', spacing: 1,
  });
  assert.deepEqual(pick(comic, ['font', 'highlight']), { font: { name: 'Comic Sans MS', face: null, generic: 'cursive' }, highlight: '#ffff00' });
  assert.equal(br.br, true);
  assert.deepEqual(sans.font, { name: 'Arial', face: 'arimo', generic: 'sans-serif' });
});

test('pictures: crop, alt text, SVG over its PNG, media parts; metafiles and video cut', async () => {
  const d = await deck();
  const s4 = d.slides[3];
  const pic = named(s4, 'Picture 2');
  assert.deepEqual(pick(pic, ['type', 'media', 'crop', 'alpha', 'alt', 'geometry']), {
    type: 'picture', media: { path: 'ppt/media/image1.png', mime: 'image/png' }, crop: { l: 0.1, t: 0.2, r: 0.3, b: 0 }, alpha: 1, alt: 'Cell under a microscope', geometry: { prst: 'ellipse', avLst: {} },
  });
  assert.deepEqual(pick(pic.line, ['width', 'color']), { width: 12700, color: '#ed7d31' });
  assert.deepEqual(pick(named(s4, 'Diagram EMF'), ['type', 'kind', 'title', 'bounds']), { type: 'box', kind: 'picture', title: '', bounds: { x: 4343400, y: 1825625, w: 2286000, h: 1714500 } });
  assert.deepEqual(pick(named(s4, 'Icon'), ['type', 'media', 'alpha', 'alt']), { type: 'picture', media: { path: 'ppt/media/image3.svg', mime: 'image/svg+xml' }, alpha: 0.6, alt: 'Microscope icon' });
  assert.deepEqual(pick(named(s4, 'Lecture clip'), ['type', 'media', 'cut']), { type: 'picture', media: { path: 'ppt/media/image1.png', mime: 'image/png' }, cut: ['media'] }); // its poster frame
  assert.deepEqual(d.media, [{ path: 'ppt/media/image1.png', mime: 'image/png' }, { path: 'ppt/media/image3.svg', mime: 'image/svg+xml' }]);

  const bytes = pack();
  assert.deepEqual(await P.media(bytes, 'ppt/media/image1.png'), new Uint8Array(FILES.get('ppt/media/image1.png')));
  assert.deepEqual(await P.media(bytes, 'ppt/media/image3.svg'), new Uint8Array(FILES.get('ppt/media/image3.svg')));
  for (const p of ['ppt/media/image2.emf', 'ppt/presentation.xml', 'ppt/media/nope.png']) assert.equal(await P.media(bytes, p), null, p);
  await assert.rejects(P.media(bytes, 'ppt/media/image1.png', { limits: { entry: 16 } }), /too large/);
});

test('tables: grid, spans and merged cells, Medium Style 2 parts, cell fills, borders and margins', async () => {
  const t = named((await deck()).slides[4], 'Table 3');
  assert.deepEqual(pick(t, ['type', 'bounds', 'cols']), { type: 'table', bounds: { x: 838200, y: 1825625, w: 10515600, h: 1483360 }, cols: [3505200, 3505200, 3505200] });
  assert.deepEqual(t.rows.map((r) => r.h), [370840, 370840, 370840, 370840]);
  const grid = t.rows.map((r) => r.cells.map((c) => [textOf(c), c.colSpan, c.rowSpan, c.merged, c.fill && c.fill.color]));
  assert.deepEqual(grid, [
    [['Molecule', 1, 1, false, '#4472c4'], ['Rate', 1, 1, false, '#4472c4'], ['Notes', 1, 1, false, '#4472c4']], // first row
    [['Oxygen fast', 2, 1, false, '#cfd5ea'], ['', 1, 1, true, '#cfd5ea'], ['small', 1, 1, false, '#cfd5ea']], // band 1: tint 40%
    [['Glucose', 1, 2, false, '#e9ebf5'], ['slow', 1, 1, false, '#e9ebf5'], ['carrier', 1, 1, false, '#ffff00']], // whole table: tint 20%; its own fill
    [['', 1, 1, true, '#cfd5ea'], ['slower', 1, 1, false, '#cfd5ea'], ['', 1, 1, false, '#cfd5ea']],
  ]);
  const head = t.rows[0].cells[0], cell = t.rows[1].cells[2], last = t.rows[3].cells[2];
  assert.deepEqual(pick(head.text.paragraphs[0].runs[0], ['bold', 'color', 'font', 'size']), { bold: true, color: '#ffffff', font: CALIBRI, size: 18 });
  assert.deepEqual(pick(cell.text.paragraphs[0].runs[0], ['bold', 'color', 'font', 'size']), { bold: false, color: '#000000', font: CALIBRI, size: 18 });
  assert.deepEqual(pick(head.borders.b, ['width', 'color']), { width: 38100, color: '#ffffff' }); // first row's bottom
  assert.deepEqual(pick(head.borders.t, ['width', 'color']), { width: 12700, color: '#ffffff' });
  assert.deepEqual(pick(cell.borders.l, ['width', 'color']), { width: 12700, color: '#ffffff' }); // inside V
  assert.deepEqual(last.text.insets, { l: 0, t: 45720, r: 91440, b: 45720 });
  assert.equal(last.text.anchor, 'ctr');
  assert.deepEqual(pick(last.borders.b, ['width', 'color']), { width: 25400, color: '#ff0000' });
});

test('tables: a style from tableStyles.xml; an unknown style id falls back to a plain grid', async () => {
  const id = '{11111111-2222-4333-8444-555555555555}';
  const styles = `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${id}"><a:tblStyle styleId="${id}" styleName="Course"><a:wholeTbl><a:tcTxStyle i="on"><a:fontRef idx="major"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="accent2"/></a:tcTxStyle><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent2"><a:lumMod val="20000"/><a:lumOff val="80000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:wholeTbl></a:tblStyle></a:tblStyleLst>`;
  const slide = fixture('ppt/slides/slide5.xml');
  const own = await P.read(pack({ 'ppt/tableStyles.xml': styles, 'ppt/slides/slide5.xml': slide.replace('{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}', id) }));
  const t = named(own.slides[4], 'Table 3'), run = t.rows[2].cells[1].text.paragraphs[0].runs[0];
  assert.equal(t.rows[2].cells[1].fill.color, '#fbe5d6');
  assert.deepEqual(pick(run, ['italic', 'color', 'font']), { italic: true, color: '#ed7d31', font: CALIBRI_LIGHT });
  assert.equal(t.rows[2].cells[1].borders.l, null);

  const unknown = await P.read(pack({ 'ppt/slides/slide5.xml': slide.replace('{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}', '{00000000-0000-4000-8000-000000000000}') }));
  const u = named(unknown.slides[4], 'Table 3');
  assert.equal(u.rows[1].cells[0].fill, null);
  assert.equal(u.rows[2].cells[2].fill.color, '#ffff00');
  assert.deepEqual(pick(u.rows[1].cells[0].borders.l, ['width', 'color']), { width: 12700, color: '#000000' });
  assert.equal(unknown.cut.tableStyles, 1);
});

test('groups: child bounds go through each group\'s scale and offset; rotation and flips stay with each group', async () => {
  const s6 = (await deck()).slides[5];
  const outer = named(s6, 'Outer');
  assert.deepEqual(pick(outer, ['type', 'bounds', 'rotation']), { type: 'group', bounds: { x: 1000000, y: 2000000, w: 4000000, h: 2000000 }, rotation: 0 });
  assert.deepEqual(outer.shapes.map((x) => x.name), ['A', 'Inner']);
  const a = named(s6, 'A');
  assert.deepEqual(pick(a, ['bounds', 'fill']), { bounds: { x: 2000000, y: 2000000, w: 2000000, h: 1000000 }, fill: { type: 'solid', color: '#ffc000' } }); // grpFill
  assert.equal(a.text.paragraphs[0].runs[0].color, '#ffffff');
  assert.deepEqual(pick(named(s6, 'Inner'), ['type', 'bounds', 'rotation']), { type: 'group', bounds: { x: 1000000, y: 3000000, w: 2000000, h: 1000000 }, rotation: 90 });
  assert.deepEqual(pick(named(s6, 'B'), ['bounds', 'rotation', 'fill']), { bounds: { x: 1000000, y: 3000000, w: 1000000, h: 500000 }, rotation: 0, fill: { type: 'solid', color: '#5b9bd5' } });
  assert.deepEqual(pick(named(s6, 'C'), ['bounds', 'rotation']), { bounds: { x: 2000000, y: 3500000, w: 800000, h: 500000 }, rotation: 45 });
});

test('notes, hidden slides and slide-number fields, also in the master\'s shapes and from firstSlideNum', async () => {
  const d = await deck();
  assert.equal(d.slides[0].notes, 'Start with the quiz.\nThen the lab.');
  assert.equal(d.slides[1].notes, '');
  assert.deepEqual(d.slides.map((s) => s.hidden), [false, false, false, false, false, false, true, false, false, false]);
  assert.equal(d.hiddenSkipped, 1);
  assert.equal(d.slides[6].notes, 'Only if asked.');
  assert.equal(textOf(named(d.slides[6], 'Slide Number Placeholder 3')), '7');
  for (const s of d.slides.filter((x) => named(x, 'Course tag'))) assert.equal(textOf(named(s, 'Course tag')), `BIO 110 · ${s.number}`);
  assert.equal(d.slides.filter((x) => named(x, 'Course tag')).length, 7); // not slide 3 (Blank), 9 (broken) or 10 (missing)

  const zero = await P.read(pack({ 'ppt/presentation.xml': fixture('ppt/presentation.xml').replace('saveSubsetFonts="1"', 'saveSubsetFonts="1" firstSlideNum="0"') }));
  assert.deepEqual(zero.slides.map((s) => s.number), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(textOf(named(zero.slides[1], 'Slide Number Placeholder 3')), '1');
});

test('a malformed shape degrades alone; an unreadable or missing slide comes back empty; the deck still opens', async () => {
  const d = await deck();
  const s8 = d.slides[7];
  assert.deepEqual(s8.shapes.filter((x) => x.from === 'slide').map((x) => x.name), ['Title 1', 'Good', 'Bad numbers', 'Missing picture', 'Chart 5', 'Diagram 6', 'Equation', 'Object 8', 'Unclosed']);
  const good = named(s8, 'Good');
  assert.deepEqual(pick(good, ['bounds', 'fill']), { bounds: { x: 838200, y: 4800600, w: 1828800, h: 914400 }, fill: { type: 'solid', color: '#4472c4' } });
  assert.equal(textOf(good), 'Fine');
  const bad = named(s8, 'Bad numbers');
  assert.deepEqual(pick(bad, ['type', 'id', 'bounds', 'rotation', 'flipH', 'geometry', 'fill', 'line']), {
    type: 'shape', id: null, bounds: { x: 0, y: 0, w: 0, h: 0 }, rotation: 0, flipH: false, geometry: { prst: 'nonsense', avLst: {} }, fill: null, line: null,
  });
  assert.equal(textOf(bad), 'Still here');
  assert.equal(bad.text.paragraphs[0].runs[0].size, 18);
  assert.equal(bad.text.insets.l, 91440);
  assert.deepEqual(bad.text.autofit, { type: 'normal', fontScale: 1, lineReduction: 0 });
  assert.deepEqual(pick(named(s8, 'Missing picture'), ['type', 'kind', 'title']), { type: 'box', kind: 'picture', title: 'Lab photo' });
  assert.equal(textOf(named(s8, 'Unclosed')), 'Unclosed');

  assert.deepEqual(pick(d.slides[8], ['number', 'broken', 'shapes', 'background', 'notes']), { number: 9, broken: true, shapes: [], background: null, notes: '' });
  assert.deepEqual(pick(d.slides[9], ['number', 'missing', 'shapes', 'background', 'notes']), { number: 10, missing: true, shapes: [], background: null, notes: '' });
  assert.equal(d.cut.parts, 2);
});

test('SmartArt, equations, OLE and charts: the stored fallback picture, else a titled box', async () => {
  const s8 = (await deck()).slides[7];
  assert.deepEqual(pick(named(s8, 'Chart 5'), ['type', 'kind', 'title', 'bounds']), { type: 'box', kind: 'chart', title: 'Enrolment by term', bounds: { x: 838200, y: 1825625, w: 2286000, h: 1714500 } });
  assert.deepEqual(pick(named(s8, 'Diagram 6'), ['type', 'kind', 'title']), { type: 'box', kind: 'smartart', title: '' });
  const eq = named(s8, 'Equation');
  assert.deepEqual(pick(eq, ['type', 'fallback', 'fill']), {
    type: 'shape', fallback: 'equation', fill: { type: 'picture', media: { path: 'ppt/media/image1.png', mime: 'image/png' }, crop: { l: 0, t: 0, r: 0, b: 0 }, alpha: 1, tile: false },
  });
  assert.equal(eq.text.paragraphs[0].runs[0].color, null); // its text has no fill
  assert.deepEqual(pick(named(s8, 'Object 8'), ['type', 'kind', 'title']), { type: 'box', kind: 'ole', title: '' }); // its preview is an EMF
});

test('what the viewer cannot draw is counted in deck.cut', async () => {
  const { cut } = await deck();
  assert.deepEqual(pick(cut, ['animations', 'fonts', '3d', 'media', 'metafiles', 'charts', 'smartart', 'ole', 'pictures']), {
    animations: 1, fonts: 1, '3d': 1, media: 1, metafiles: 1, charts: 1, smartart: 1, ole: 1, pictures: 1,
  });
  assert.ok(cut.effects >= 1);
});

test('the model is plain data: JSON round-trips it and every number is finite', async () => {
  const d = await deck();
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
  const finite = (v, at) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), at);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) finite(x, `${at}.${k}`);
  };
  finite(d, 'deck');
});

test('bounds: slides, shapes, group depth, table cells, text, part size, the archive\'s limits', async () => {
  const bytes = pack();
  const few = await P.read(bytes, { limits: { slides: 3 } });
  assert.equal(few.slides.length, 3);
  assert.equal(few.cut.slides, 7);

  const count = (d) => d.slides.reduce((n, s) => n + all(s).length, 0);
  const shapes = await P.read(bytes, { limits: { shapes: 5 } });
  assert.equal(count(shapes), 5);
  assert.ok(shapes.cut.shapes > 0);

  const shallow = await P.read(bytes, { limits: { depth: 1 } });
  assert.deepEqual(named(shallow.slides[5], 'Outer').shapes.map((x) => x.name), ['A']);
  assert.ok(shallow.cut.shapes >= 1);
  const nest = (n) => (n ? `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${n + 10}" name="G${n}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${nest(n - 1)}</p:grpSp>` : '<p:sp><p:nvSpPr><p:cNvPr id="9" name="Deep"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>');
  const deep = await P.read(pack({ 'ppt/slides/slide3.xml': fixture('ppt/slides/slide3.xml').replace(/(<\/p:grpSpPr>)/, `$1${nest(200)}`) }));
  assert.ok(all(deep.slides[2]).filter((x) => x.type === 'group').length <= P.LIMITS.depth);
  assert.equal(named(deep.slides[2], 'Deep'), undefined);

  const cells = await P.read(bytes, { limits: { cells: 4 } });
  assert.deepEqual(pick(named(cells.slides[4], 'Table 3'), ['type', 'kind']), { type: 'box', kind: 'table' });

  const text = await P.read(bytes, { limits: { text: 30 } });
  const chars = text.slides.flatMap(all).filter((x) => x.text).reduce((n, x) => n + textOf(x).replace(/\n/g, '').length, 0);
  assert.ok(chars <= 30, `${chars} characters`);
  assert.ok(text.cut.text > 0);

  const parts = await P.read(bytes, { limits: { part: 3000 } }); // the master is larger
  assert.equal(parts.slides.length, 10);
  assert.ok(parts.cut.parts > 2);

  await assert.rejects(P.read(bytes, { limits: { entry: 64 } }), /too large/);
  await assert.rejects(P.read(pack({ 'ppt/presentation.xml': null })), /not a PowerPoint presentation/);
  await assert.rejects(P.read(new TextEncoder().encode('%PDF-1.7')), /not a zip/);
});

test('missing media parts become picture boxes and are not listed as drawable media', async () => {
  const bytes = pack({ 'ppt/media/image1.png': null, 'ppt/media/image3.svg': null });
  const d = await P.read(bytes);
  assert.deepEqual(pick(named(d.slides[3], 'Picture 2'), ['type', 'kind', 'title']), { type: 'box', kind: 'picture', title: 'Cell under a microscope' });
  assert.deepEqual(pick(named(d.slides[3], 'Icon'), ['type', 'kind']), { type: 'box', kind: 'picture' });
  assert.deepEqual(d.media, []);
  assert.equal(await P.media(bytes, 'ppt/media/image1.png'), null);
});

test('duplicate ZIP part names are refused by the slide and media readers', async () => {
  const files = [...FILES].map(([name, data]) => ({ name, data: new Uint8Array(data) }));
  files.push({ name: 'ppt/presentation.xml', data: new Uint8Array(FILES.get('ppt/presentation.xml')) });
  const bytes = new Uint8Array(Buffer.concat(Z.zip(files)));
  await assert.rejects(P.read(bytes), /duplicate zip entry/);
  await assert.rejects(P.media(bytes, 'ppt/media/image1.png'), /duplicate zip entry/);
});

test('the part byte limit also bounds relationship XML and multibyte slide XML', async () => {
  const part = 16384;
  const rels = fixture('ppt/_rels/presentation.xml.rels').replace('<Relationships ', `<Relationships pad="${'x'.repeat(part)}" `);
  const d = await P.read(pack({ 'ppt/_rels/presentation.xml.rels': rels }), { limits: { part } });
  assert.equal(d.slides.every((s) => s.missing), true);
  const slide = `<p:sld xmlns:p="p" note="${'é'.repeat(part / 2)}"><p:cSld><p:spTree/></p:cSld></p:sld>`;
  assert.ok(slide.length < part);
  assert.ok(Buffer.byteLength(slide) > part);
  const multi = await P.read(pack({ 'ppt/slides/slide1.xml': slide }), { limits: { part } });
  assert.equal(multi.slides[0].broken, true);
});

test('hostile numeric geometry and nested group scales keep model numbers finite and bounded', async () => {
  const group = fixture('ppt/slides/slide6.xml').replace('chExt cx="2000000" cy="1000000"', 'chExt cx="1e-320" cy="1"');
  const geom = fixture('ppt/slides/slide3.xml').replace('val 25000', `val ${'9'.repeat(400)}`);
  const d = await P.read(pack({ 'ppt/slides/slide6.xml': group, 'ppt/slides/slide3.xml': geom }));
  for (const s of d.slides.flatMap(all)) {
    for (const v of Object.values(s.bounds)) assert.ok(Number.isFinite(v) && Math.abs(v) <= 1e9, `${s.name}: ${v}`);
    if (s.geometry?.avLst && !Array.isArray(s.geometry.avLst)) {
      for (const v of Object.values(s.geometry.avLst)) assert.ok(Number.isFinite(v));
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
});

test('placeholder idx defaults to zero before type fallback', async () => {
  const layout = fixture('ppt/slideLayouts/slideLayout2.xml').replace('ph type="title"', 'ph type="title" idx="0"');
  const slide = fixture('ppt/slides/slide2.xml').replace('ph type="title"', 'ph');
  const d = await P.read(pack({ 'ppt/slideLayouts/slideLayout2.xml': layout, 'ppt/slides/slide2.xml': slide }));
  const title = named(d.slides[1], 'Title 1');
  assert.deepEqual(title.bounds, named((await deck()).slides[1], 'Title 1').bounds);
  assert.equal(title.text.paragraphs[0].runs[0].size, 44);
});

test('long malformed attribute names do not cause quadratic attribute scans', async () => {
  const slide = fixture('ppt/slides/slide3.xml').replace('name="Default"', `name="Default" ${'x'.repeat(64000)}`);
  const bytes = pack({ 'ppt/slides/slide3.xml': slide });
  const cpu = process.cpuUsage();
  const d = await P.read(bytes);
  const used = process.cpuUsage(cpu);
  assert.equal(named(d.slides[2], 'Default').type, 'shape');
  assert.ok(used.user + used.system < 500000, `attribute scan used ${used.user + used.system} microseconds of CPU`);
});

test('paragraph default run properties apply below explicit run and end-paragraph properties', async () => {
  const p = '<a:p><a:pPr><a:defRPr sz="3600" b="1"><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:defRPr></a:pPr><a:r><a:t>Inherited</a:t></a:r><a:r><a:rPr sz="2000" b="0"/><a:t>Own</a:t></a:r><a:endParaRPr sz="1400"/></a:p>';
  const slide = fixture('ppt/slides/slide3.xml').replace(/<a:p>[\s\S]*?<\/a:p>/, p);
  assert.ok(slide.includes('Inherited'));
  const d = await P.read(pack({ 'ppt/slides/slide3.xml': slide }));
  const para = named(d.slides[2], 'Default').text.paragraphs[0];
  assert.deepEqual(para.runs.map((r) => pick(r, ['text', 'size', 'bold', 'color'])), [
    { text: 'Inherited', size: 36, bold: true, color: '#123456' }, { text: 'Own', size: 20, bold: false, color: '#123456' },
  ]);
  assert.equal(para.endSize, 14);
});

test('relationship targets stay within the package while root paths and parent paths resolve', async () => {
  const rels = fixture('ppt/_rels/presentation.xml.rels');
  for (const target of ['/ppt/slides/slide1.xml', '../ppt/slides/slide1.xml']) {
    const d = await P.read(pack({ 'ppt/_rels/presentation.xml.rels': rels.replace('Target="slides/slide1.xml"', `Target="${target}"`) }));
    assert.equal(d.slides[0].title, 'Cell Biology', target);
  }
  const escaped = rels.replace('Target="slides/slide1.xml"', 'Target="../../ppt/slides/slide1.xml"');
  const d = await P.read(pack({ 'ppt/_rels/presentation.xml.rels': escaped }));
  assert.equal(d.slides[0].missing, true);
  const D = require('../lib/doctext.js');
  assert.equal((await D.rels(D.unzip(pack({ 'ppt/_rels/presentation.xml.rels': escaped })), 'ppt/presentation.xml')).get('rId2').path, 'ppt/slides/slide1.xml');
});

test('preset colours include standard long names and abbreviated aliases', async () => {
  const values = { aliceBlue: '#f0f8ff', dkBlue: '#00008b', darkBlue: '#00008b', ltBlue: '#add8e6', lightBlue: '#add8e6', medPurple: '#9370db', mediumPurple: '#9370db', tomato: '#ff6347' };
  for (const [val, color] of Object.entries(values)) {
    const slide = fixture('ppt/slides/slide3.xml').replace('<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>', `<a:solidFill><a:prstClr val="${val}"/></a:solidFill>`);
    const d = await P.read(pack({ 'ppt/slides/slide3.xml': slide }));
    assert.deepEqual(named(d.slides[2], 'Rounded').fill, { type: 'solid', color }, val);
  }
});
