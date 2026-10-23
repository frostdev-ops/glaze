// Course tabs on Ultra (B8): lib/coursetabs.js, the part without the page. The page itself is checked headless by
// scripts/ultra-tabs-check.js on a synthetic Ultra (test/fixtures/ultra-course.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require(path.join(process.env.GZ_B8_REPO || path.join(__dirname, '..'), 'defaults.js'));
const L = require(path.join(process.env.GZ_B8_REPO || path.join(__dirname, '..'), 'lib/coursetabs.js'));

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const C = '/ultra/courses/_1_1';

test('on by default; its settings join GZ_SPEC from here, so the first content script carries only the switch', () => {
  assert.equal(D.GZ_SPEC.enhance.tabs[0], true);
  assert.equal(D.GZ_SPEC.tabs, L.SPEC);
  assert.deepEqual(D.GZ_SANITIZE({}).tabs, { at: 'above', cap: 8, place: true, shape: 'tab', size: 'medium', width: 180, label: 'short', mark: 'dot', color: 'off' });
  assert.deepEqual(D.GZ_SANITIZE({ tabs: { at: 'inside', cap: 99, width: 200, color: 'theme' } }).tabs, { ...D.GZ_SANITIZE({}).tabs, width: 200, color: 'theme' });
  assert.ok(!/\btabs: \{/.test(read('defaults.js')), 'the group itself is not in defaults.js');
});

test('a tab goes back to any page of its own course, exactly: path and query', () => {
  for (const tool of L.TOOLS) assert.equal(L.safe(`${C}/${tool}`), `${C}/${tool}`, tool);
  for (const p of [`${C}/outline/roster`, `${C}/outline/folder/_9_1`, `${C}/document/_9_1`, `${C}/outline/assessment/_3_1/overview`,
    `${C}/assessment/_3_1/overview/attempt/_4_1`, `${C}/engagement/discussion/_5_1`, `${C}/outline/lti/launchFrame/_7_1`, `${C}/messages/_6_1`]) assert.equal(L.safe(p), p, p);
  // Its query, whole, as the page had it.
  assert.equal(L.safe(`${C}/document/_9_1`, '?view=content&state=view&x=<y>'), `${C}/document/_9_1?view=content&state=view&x=<y>`);
  assert.equal(L.safe(`${C}/assessment/_3_1/overview`, 'courseId=_1_1'), `${C}/assessment/_3_1/overview?courseId=_1_1`);
  assert.equal(L.safe(`${C}/grades`, ''), `${C}/grades`);
});

test('only a course page\'s own address, in plain path characters and of bounded length; anything else goes back to its tool', () => {
  for (const p of ['/ultra/course', '/ultra/courses/1/outline', `${C}/outline/../../x`, `${C}/./x`, `${C}//x`, `${C}/x y`, `${C}/x<y>`, 'javascript:alert(1)',
    `${C}/${'a'.repeat(600)}`, undefined]) assert.equal(L.safe(p), null, String(p).slice(0, 60));
  assert.equal(L.safe(`${C}/grades`, `?${'q'.repeat(601)}`), `${C}/grades`, 'an overlong query is dropped, the page kept');
  assert.equal(L.back(`${C}/grades/assessment/_3_1/attempt`), `${C}/grades`);
  assert.equal(L.back(`${C}/groups/somewhere`), `${C}/groups/enrollments`);
  assert.equal(L.back(`${C}/unknownTool/x`), `${C}/outline`);
  assert.equal(L.back('/ultra/course'), null);
  assert.deepEqual(L.placeOf(`${C}/grades`, ''), { path: `${C}/grades`, exact: true });
  assert.deepEqual(L.placeOf(`${C}/assessment/_3_1/overview`, '?courseId=_1_1'), { path: `${C}/assessment/_3_1/overview?courseId=_1_1`, exact: true });
  assert.deepEqual(L.placeOf(`${C}/x y`, ''), { path: `${C}/outline`, exact: false });
});

test('a click goes to the tab\'s place while it is in its own course', () => {
  assert.equal(L.target({ cid: '_1_1', path: `${C}/grades` }), `${C}/grades`);
  assert.equal(L.target({ cid: '_1_1', path: `${C}/grades` }, false), `${C}/outline`, 'place off: the outline');
  assert.equal(L.target({ cid: '_1_1', path: '/ultra/courses/_2_1/grades' }), `${C}/outline`, 'another course\'s place');
  assert.equal(L.target({ cid: '_1_1', path: `${C}/assessment/_3_1/overview?courseId=_1_1` }), `${C}/assessment/_3_1/overview?courseId=_1_1`, 'an open assignment');
  assert.equal(L.target({ cid: '_1_1', path: `${C}/document/_9_1?view=content&state=view` }), `${C}/document/_9_1?view=content&state=view`);
  assert.equal(L.target({ cid: '_1_1', path: 'javascript:alert(1)' }), `${C}/outline`);
  assert.equal(L.target({ cid: '_1_1' }), `${C}/outline`);
});

test('the stored list is cleaned: known ids, short strings, safe places, pinned first, no repeats, 40 at most', () => {
  const raw = [{ cid: '_2_1', name: 'B', pin: false, at: 2, path: '/ultra/courses/_2_1/grades', top: 300 }, { cid: '_1_1', name: 'A'.repeat(300), code: 7, pin: true, at: 1, path: `${C}/outline/assessment/_3_1/overview`, top: 900 },
    { cid: '_2_1', name: 'dup' }, { cid: 'x' }, null, 'no', { cid: '_3_1', at: -5, top: NaN, path: '/ultra/courses/_1_1/grades' }];
  assert.deepEqual(L.clean(raw), [
    { cid: '_1_1', name: 'A'.repeat(200), code: '', pin: true, at: 1, path: `${C}/outline/assessment/_3_1/overview`, top: 900 },
    { cid: '_2_1', name: 'B', code: '', pin: false, at: 2, path: '/ultra/courses/_2_1/grades', top: 300 },
    { cid: '_3_1', name: '', code: '', pin: false, at: 0, path: '/ultra/courses/_3_1/outline', top: 0 },
  ]);
  assert.equal(L.clean(Array.from({ length: 60 }, (_, i) => ({ cid: `_${i + 1}_1` }))).length, L.MAX);
  assert.deepEqual(L.clean('nope'), []);
  assert.ok(L.KEY.test(L.storeKey('https://bb.school.test', '_42_1')));
  assert.ok(!L.KEY.test('ctabs:http://bb.school.test:_42_1'));
});

test('opening past the cap closes the least recently used unpinned tab, never a pinned one or the one opened', () => {
  const t = (cid, at, pin = false) => ({ cid, name: cid, code: '', pin, at, path: '', top: 0 });
  let r = L.open([t('_1_1', 5, true), t('_2_1', 1), t('_3_1', 3)], { cid: '_4_1', at: 9 }, 3);
  assert.deepEqual(r.tabs.map((x) => x.cid), ['_1_1', '_3_1', '_4_1']);
  assert.deepEqual(r.gone.map((x) => x.cid), ['_2_1']);
  r = L.open([t('_1_1', 1, true), t('_2_1', 2, true)], { cid: '_3_1', at: 9 }, 2);
  assert.deepEqual(r.tabs.map((x) => x.cid), ['_1_1', '_2_1', '_3_1'], 'all pinned: the new one still opens');
  assert.deepEqual(r.gone, []);
  r = L.open([t('_1_1', 1), t('_2_1', 2)], { cid: '_1_1', at: 9, name: 'Renamed' }, 2);
  assert.deepEqual(r.tabs.map((x) => [x.cid, x.at, x.name]), [['_1_1', 9, 'Renamed'], ['_2_1', 2, '_2_1']], 'an open course is updated in place');
});

test('closing, pinning and moving', () => {
  const t = (cid, pin = false) => ({ cid, pin });
  const list = [t('_1_1', true), t('_2_1'), t('_3_1'), t('_4_1')];
  assert.deepEqual(L.close(list, '_2_1'), { tabs: [t('_1_1', true), t('_3_1'), t('_4_1')], next: '_3_1' });
  assert.equal(L.close(list, '_4_1').next, '_3_1', 'the last: its left neighbour');
  assert.equal(L.close([t('_1_1')], '_1_1').next, null);
  assert.equal(L.close(list, '_9_1').tabs, list);
  assert.deepEqual(L.pin(list, '_3_1', true).map((x) => [x.cid, x.pin]), [['_1_1', true], ['_3_1', true], ['_2_1', false], ['_4_1', false]]);
  assert.deepEqual(L.pin(list, '_1_1', false).map((x) => [x.cid, x.pin]), [['_1_1', false], ['_2_1', false], ['_3_1', false], ['_4_1', false]]);
  assert.deepEqual(L.move(list, '_4_1', 1).map((x) => x.cid), ['_1_1', '_4_1', '_2_1', '_3_1']);
  assert.deepEqual(L.move(list, '_4_1', 0).map((x) => x.cid), ['_1_1', '_4_1', '_2_1', '_3_1'], 'kept out of the pinned group');
  assert.deepEqual(L.move(list, '_1_1', 3).map((x) => x.cid), list.map((x) => x.cid), 'a pinned tab stays among the pinned');
  assert.deepEqual(L.move(list, '_2_1', 9).map((x) => x.cid), ['_1_1', '_3_1', '_4_1', '_2_1']);
});

test('the snapshot cache: the least recently kept go first past the total', () => {
  assert.deepEqual(L.fit([['a', 3, 1], ['b', 3, 2], ['c', 3, 3]], 7), ['a']);
  assert.deepEqual(L.fit([['a', 3, 1], ['b', 3, 2]], 7), []);
  assert.deepEqual(L.fit([['a', 9, 5]], 7), ['a']);
  assert.deepEqual(L.fit([['old', 3, 1], ['new', 3, 1]], 3), ['old'], 'same-millisecond captures still evict the older insertion');
  assert.ok(L.SNAP_ONE < L.SNAP_ALL && L.SNAP_ALL <= 1e6, 'sized for sketches, well inside storage.session (10 MB)');
});

// A page for sketch(): elements with boxes and computed styles, text nodes with their lines, hit testing by position
// (fixed elements over the rest, later over earlier).
const page = (spec, { w = 1000, h = 800 } = {}) => {
  const all = [];
  const doc = {
    defaultView: { innerWidth: w, innerHeight: h, getComputedStyle: (el) => ({ display: 'block', visibility: 'visible', opacity: '1', position: 'static', overflowX: 'visible', overflowY: 'visible',
      backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', color: 'rgb(20, 20, 20)', borderTopWidth: '0px', borderTopStyle: 'none', borderTopColor: 'rgb(0, 0, 0)',
      borderTopLeftRadius: '0px', fontSize: '16px', fontWeight: '400', fill: 'rgb(0, 0, 0)', ...el.css }) },
    createRange: () => ({ n: null, selectNodeContents(n) { this.n = n; }, getClientRects() { return (this.n.lines || []).map(rect); } }),
    elementFromPoint: (x, y) => {
      const at = all.filter((e) => e.css.display !== 'none' && e.css.visibility !== 'hidden' && !e.css.pointer && inside(e.box, x, y));
      return [...at.filter((e) => !fixed(e)), ...at.filter(fixed)].at(-1) || null;
    },
  };
  const rect = ([x, y, bw, bh]) => ({ left: x, top: y, right: x + bw, bottom: y + bh, width: bw, height: bh, x, y });
  const inside = (b, x, y) => b && x >= b[0] && x < b[0] + b[2] && y >= b[1] && y < b[1] + b[3];
  const fixed = (e) => { for (let p = e; p; p = p.parentElement) if (p.css.position === 'fixed') return true; return false; };
  const make = (x, parent = null) => {
    if (typeof x === 'string' || x.text !== undefined) return { nodeType: 3, textContent: typeof x === 'string' ? x : x.text, lines: x.lines, parentElement: parent };
    const el = { nodeType: 1, tagName: (x.tag || 'div').toUpperCase(), css: x.css || {}, box: x.box, cls: x.cls || '', role: x.role || null, parentElement: parent,
      getBoundingClientRect: () => rect(x.box || [0, 0, 0, 0]), getAttribute: (k) => (k === 'role' ? el.role : k === 'class' ? el.cls : null),
      matches: (sel) => sel.split(',').some((q) => q.trim().startsWith('.') && el.cls.split(' ').includes(q.trim().slice(1))),
      contains: (o) => { for (let p = o; p; p = p.parentElement) if (p === el) return true; return false; } };
    all.push(el);
    el.childNodes = (x.kids || []).map((k) => make(k, el));
    el.children = el.childNodes.filter((k) => k.nodeType === 1);
    return el;
  };
  doc.body = make({ tag: 'body', box: [0, 0, w, h], kids: spec });
  doc.documentElement = { nodeType: 1 };
  return doc;
};
const hexOf = (css) => {
  const m = String(css).match(/^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  return a ? '#' + [m[1], m[2], m[3], Math.round(a * 255)].map((v) => Number(v).toString(16).padStart(2, '0')).join('') : null;
};

test('a sketch: the page\'s boxes in the window, clipped to it, in paint order, and no text but the course name', () => {
  const name = 'Computer Science I';
  const doc = page([
    { tag: 'main', box: [0, 0, 1000, 2400], kids: [
      // Under the fixed header: covered, so not drawn.
      { box: [0, 0, 1000, 40], css: { backgroundColor: 'rgb(0, 200, 0)' } },
      { cls: 'card', box: [40, 100, 600, 300], css: { backgroundColor: 'rgb(255, 255, 255)', borderTopLeftRadius: '12px' }, kids: [
        { tag: 'p', box: [60, 120, 500, 80], kids: [{ text: 'secret words of the page, three lines of them', lines: [[60, 120, 500, 20], [60, 150, 500, 20], [60, 180, 300, 20]] }] },
      ] },
      { tag: 'img', box: [700, 100, 200, 150], css: { color: 'rgb(20, 20, 20)' } },
      { box: [40, 700, 600, 300], css: { backgroundColor: 'rgb(30, 60, 90)' } },
      { box: [-50, 420, 200, 50], css: { backgroundColor: 'rgb(90, 60, 30)' } },
      { box: [40, 900, 600, 300], css: { backgroundColor: 'rgb(1, 2, 3)' }, kids: [{ text: 'below the fold', lines: [[60, 920, 200, 20]] }] },
      { box: [300, 500, 100, 100], css: { backgroundColor: 'rgb(255, 0, 0)', visibility: 'hidden' } },
      { box: [300, 500, 100, 100], css: { display: 'none' }, kids: [{ box: [300, 500, 100, 100], css: { backgroundColor: 'rgb(255, 0, 1)' }, kids: [{ text: 'none', lines: [[300, 500, 50, 20]] }] }] },
      { cls: 'gz-tip', box: [500, 450, 120, 30], css: { backgroundColor: 'rgb(255, 0, 2)' }, kids: [{ text: 'tip', lines: [[505, 455, 30, 20]] }] },
      // A scroller: what it holds shows inside it only.
      { box: [650, 400, 300, 200], css: { overflowY: 'auto' }, kids: [{ box: [650, 350, 300, 100], css: { backgroundColor: 'rgb(7, 8, 9)' } }] },
      ...Array.from({ length: 80 }, (_, i) => ({ tag: 'li', box: [700 + i % 4 * 70, 620 + Math.floor(i / 4) * 8, 60, 6], css: { backgroundColor: 'rgb(100, 100, 100)' } })),
    ] },
    { tag: 'header', box: [0, 0, 1000, 60], css: { position: 'fixed', backgroundColor: 'rgb(16, 32, 48)' }, kids: [
      { tag: 'h1', box: [20, 10, 400, 40], kids: [{ text: ` ${name} `, lines: [[20, 15, 220, 30]] }] },
      { tag: 'button', box: [900, 12, 80, 36], css: { backgroundColor: 'rgb(255, 136, 0)', borderTopLeftRadius: '8px' }, kids: [{ text: 'Menu', lines: [[915, 20, 40, 20]] }] },
    ] },
  ]);
  const boxes = L.sketch(doc, { w: 1000, h: 800, name, colour: hexOf, skip: (el) => el.matches('.gz-tip') });
  const find = (c) => boxes.filter((b) => b[5] === c), at = (c) => boxes.findIndex((b) => b[5] === c);
  assert.ok(boxes.length <= L.BOXES, `${boxes.length} boxes`);
  for (const [x, y, bw, bh, k, c, r] of boxes) {
    assert.ok([x, y, bw, bh, r].every(Number.isInteger) && x >= 0 && y >= 0 && bw > 0 && bh > 0 && x + bw <= 1000 && y + bh <= 800, `inside the window: ${[x, y, bw, bh]}`);
    assert.ok('btichn'.includes(k) && /^#[0-9a-f]{8}$/.test(c));
  }
  assert.ok(!/secret|Menu|fold|tip|none/.test(JSON.stringify(boxes)), 'no text of the page');
  assert.deepEqual(boxes.filter((b) => b[4] === 'n'), [[20, 15, 220, 30, 'n', '#141414ff', 30]], 'the course name, as its one text');
  assert.deepEqual(find('#ffffffff'), [[40, 100, 600, 300, 'b', '#ffffffff', 12]]);
  assert.deepEqual(boxes.filter((b) => b[4] === 't' && b[0] === 60), [[60, 120, 500, 50, 't', '#141414ff', 30], [60, 180, 300, 20, 't', '#141414ff', 20]], 'a paragraph\'s even lines in one box with their pitch; its last line alone');
  assert.deepEqual(find('#ff8800ff'), [[900, 12, 80, 36, 'c', '#ff8800ff', 8]], 'a control');
  assert.ok(boxes.some((b) => b[4] === 't' && b[0] === 915 && boxes.indexOf(b) > at('#ff8800ff')), 'its label a bar over it');
  assert.equal(boxes.filter((b) => b[4] === 'i').length, 1);
  assert.deepEqual(find('#1e3c5aff'), [[40, 700, 600, 100, 'b', '#1e3c5aff', 0]], 'clipped at the window\'s bottom');
  assert.deepEqual(find('#5a3c1eff'), [[0, 420, 150, 50, 'b', '#5a3c1eff', 0]], 'and its left');
  assert.deepEqual(find('#070809ff'), [[650, 400, 300, 50, 'b', '#070809ff', 0]], 'clipped to its scroller');
  for (const c of ['#00c800ff', '#010203ff', '#ff0000ff', '#ff0001ff', '#ff0002ff']) assert.deepEqual(find(c), [], `${c}: covered, past the window, hidden, not displayed or Glaze's tip`);
  assert.ok(at('#102030ff') > at('#ffffffff') && at('#102030ff') > at('#1e3c5aff'), 'the fixed header is drawn over what scrolls under it');
  assert.ok(at('#ff8800ff') > at('#102030ff'), 'and its button over it');
  assert.ok(find('#646464ff').length < 80 && boxes.length === L.BOXES, 'past the limit, the smallest boxes go');
});

test('a sketch in a tab\'s frame is placed where the frame is in the window', () => {
  const doc = page([{ box: [0, 0, 500, 300], css: { backgroundColor: 'rgb(1, 1, 1)' } }], { w: 800, h: 700 });
  assert.deepEqual(L.sketch(doc, { w: 1000, h: 800, dx: 200, dy: 100, colour: hexOf }), [[200, 100, 500, 300, 'b', '#010101ff', 0]]);
});

test('the stand-in draws a sketch: boxes in their colours and radii, text lines as rounded bars, the course name as its one text', () => {
  const s = { size: [1000, 800], name: 'Computer Science I', boxes: [[40, 100, 600, 300, 'b', '#ffffffff', 12], [20, 15, 220, 30, 'n', '#141414ff', 30], [60, 120, 500, 50, 't', '#141414ff', 30], [900, 12, 80, 36, 'c', '#ff8800ff', 8], [700, 100, 200, 150, 'i', '#14141433', 0], [20, 300, 400, 28, 'h', '#202020ff', 28]] };
  const d = L.drawn(s);
  assert.deepEqual(d.filter((x) => x.text), [{ x: 20, y: 15, w: 220, h: 30, ink: '#141414ff', text: 'Computer Science I', size: 25, line: 30 }]);
  assert.deepEqual(d.filter((x) => !x.text && [40, 900, 700].includes(x.x)).map(({ x, y, w, h, bg, r }) => [x, y, w, h, bg, r]), [[40, 100, 600, 300, '#ffffffff', 12], [900, 12, 80, 36, '#ff8800ff', 8], [700, 100, 200, 150, '#14141433', 0]]);
  const bars = d.filter((x) => x.x === 60);
  assert.equal(bars.length, 2, 'one bar a line');
  for (const [i, b] of bars.entries()) {
    assert.ok(b.y > 120 + i * 30 && b.y + b.h < 120 + i * 30 + 20 && b.w === 500 && b.r * 2 === b.h, `a rounded bar inside line ${i}: ${JSON.stringify(b)}`);
    assert.equal(b.bg.slice(0, 7), '#141414');
    assert.ok(parseInt(b.bg.slice(7), 16) < 255, 'lighter than the ink: glyphs cover only part of a line');
  }
  const head = d.filter((x) => x.x === 20 && x.y >= 300);
  assert.ok(head.length === 1 && head[0].h > bars[0].h * 28 / 30 && parseInt(head[0].bg.slice(7), 16) >= parseInt(bars[0].bg.slice(7), 16), 'a heading\'s bar is bolder');
  assert.equal(L.drawn({ ...s, name: '' }).filter((x) => x.text).length, 0, 'no name, no text');
});

test('wired up: loadable on demand, in the worker and the editor, and both sites load the shared manager on demand', () => {
  const bg = read('lib/background.js');
  assert.ok(bg.includes("'lib/coursetabs.js', 'features/coursetabs.js'") && bg.includes("'coursetabs.js');"));
  assert.ok(read('options.html').includes('<script src="lib/coursetabs.js"></script>'));
  assert.ok(read('content-ultra.js').includes("need('lib/coursetabs.js'") && !read('content.js').includes("need('features/coursetabs.js'") && read('content-canvas.js').includes("need('features/coursetabs.js'"));
  // The copies live in storage.session only, never storage.local: what a page stores there is its tab list.
  const page = read('features/coursetabs.js').replace(/(^|\s)\/\/.*$/gm, '');
  assert.ok(!/storage\.session|indexedDB|localStorage/.test(page));
  assert.ok(/storage\.session/.test(bg));
});


test('the hard tab bound holds even if every existing tab is pinned', () => {
  const pinned = Array.from({ length: L.MAX }, (_, i) => ({ cid: `_${i + 1}_1`, pin: true, at: i }));
  const result = L.open(pinned, { cid: '_999_1', at: 100 }, 8);
  assert.equal(result.tabs.length, L.MAX);
  assert.deepEqual(result.tabs, pinned, 'never silently evict a pinned course');
  assert.equal(result.full, true, 'the page can explain why no tab was added');
});

test("a strip tab's pin and close, drawn at 20px, take presses over 24 (WCAG 2.5.8)", () => {
  const css = read('features/coursetabs.css');
  assert.match(css, /#gz-ctabs :is\(\.gz-ctab-pin, \.gz-ctab-x\) \{ position: relative;[^}]* width: 20px; height: 20px;/);
  assert.match(css, /#gz-ctabs :is\(\.gz-ctab-pin, \.gz-ctab-x\)::after \{ content: ""; position: absolute; inset: -2px; \}/);
});

test('Delete leaves a pinned strip tab, as its close button, hidden while it is pinned, does', () => {
  assert.match(read('features/coursetabs.css'), /#gz-ctabs \.gz-ctab\[data-pin\] \.gz-ctab-x \{ display: none; \}/);
  const src = read('features/coursetabs.js'), shut = [];
  const tab = (cid, pin) => ({ dataset: { courseId: cid }, hasAttribute: (k) => k === 'data-pin' && pin });
  const tabs = [tab('_1_1', true), tab('_2_1', false)];
  const onKey = require('node:vm').runInNewContext(`${src.slice(src.indexOf('  const onKey = '), src.indexOf('  // Dragging a tab:'))}\nonKey;`, {
    tabOf: (e) => e.target, list: { children: tabs }, getComputedStyle: () => ({ direction: 'ltr' }), shut: (cid, keys) => shut.push([cid, keys]), visit() {}, pinTab() {}, moveTab() {} });
  for (const key of ['Delete', 'Backspace']) onKey({ target: tabs[0], key, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(shut, [], 'pinned: P unpins it first');
  onKey({ target: tabs[1], key: 'Delete', preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(shut, [['_2_1', true]]);
});

test('a pin or a move on the strip is said in its word (role=status), as the widgets say theirs', () => {
  const vm = require('node:vm'), src = read('features/coursetabs.js'), said = [];
  const c = vm.createContext({ framed: '', L, tabs: L.clean([{ cid: '_1_1' }, { cid: '_2_1' }, { cid: '_3_1' }]), save() {}, draw() {}, say: (s) => said.push(s),
    t: (k, v) => k.replace(/\{(\w+)\}/g, (_, x) => v[x]), rowsOf: () => c.tabs.map((x) => ({ cid: x.cid, full: `Course ${x.cid}` })) });
  vm.runInContext(`${src.slice(src.indexOf('  const fullOf = '), src.indexOf('  const tabOf = '))}\nglobalThis.pin = pinTab; globalThis.move = moveTab;`, c);
  c.move('_1_1', 2);
  c.pin('_3_1');
  c.pin('_3_1');
  assert.deepEqual(said, ['Course _1_1 moved to 3 of 3.', 'Course _3_1, pinned', 'Course _3_1, unpinned']);
});
