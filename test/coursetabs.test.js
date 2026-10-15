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
  assert.deepEqual(D.GZ_SANITIZE({}).tabs, { at: 'above', cap: 8, place: true, shape: 'tab', size: 'medium', width: 180, label: 'name', mark: 'dot', color: 'off' });
  assert.deepEqual(D.GZ_SANITIZE({ tabs: { at: 'inside', cap: 99, width: 200, color: 'theme' } }).tabs, { ...D.GZ_SANITIZE({}).tabs, width: 200, color: 'theme' });
  assert.ok(!/\btabs: \{/.test(read('defaults.js')), 'the group itself is not in defaults.js');
});

test('a tab goes back only to an allowed place: a course tool, a details page, a document or folder', () => {
  for (const tool of L.TOOLS) assert.equal(L.safe(`${C}/${tool}`), `${C}/${tool}`, tool);
  assert.equal(L.safe(`${C}/outline/roster`), `${C}/outline/roster`);
  assert.equal(L.safe(`${C}/outline/edit/document/_9_1`, '?courseId=_1_1&view=content'), `${C}/outline/edit/document/_9_1?courseId=_1_1&view=content`);
  assert.equal(L.safe(`${C}/outline/folder/_9_1`), `${C}/outline/folder/_9_1`);
  // The query keeps only what it may, and only for this course.
  assert.equal(L.safe(`${C}/outline/booksAndTools`, '?parentId=_5_1&launch=1&x=<y>'), `${C}/outline/booksAndTools?parentId=_5_1`);
  assert.equal(L.safe(`${C}/outline/edit/document/_9_1`, '?courseId=_2_1&view=edit'), `${C}/outline/edit/document/_9_1`);
});

test('never a test, attempt, assessment, discussion or message: those go back to their tool', () => {
  for (const p of [`${C}/outline/assessment/_3_1/overview`, `${C}/outline/assessment/test/_3_1/attempt/_4_1`, `${C}/grades/assessment/_3_1/overview/attempt/_4_1`,
    `${C}/outline/discussion/_5_1`, `${C}/engagement/discussion/_5_1`, `${C}/messages/_6_1`, `${C}/outline/lti/launch/_7_1`, `${C}/outline/edit/document/_9_1/attempt`,
    `${C}/outline/journal/_8_1`, `${C}/outline`.replace('outline', 'outline/test'), '/ultra/course', '/ultra/courses/1/outline', `${C}/outline/../../x`]) {
    assert.equal(L.safe(p), null, p);
  }
  assert.equal(L.back(`${C}/outline/assessment/_3_1/overview`), `${C}/outline`);
  assert.equal(L.back(`${C}/grades/assessment/_3_1/attempt`), `${C}/grades`);
  assert.equal(L.back(`${C}/engagement/discussion/_5_1`), `${C}/engagement`);
  assert.equal(L.back(`${C}/groups/somewhere`), `${C}/groups/enrollments`);
  assert.equal(L.back(`${C}/unknownTool/x`), `${C}/outline`);
  assert.equal(L.back('/ultra/course'), null);
  assert.deepEqual(L.placeOf(`${C}/grades`, ''), { path: `${C}/grades`, exact: true });
  assert.deepEqual(L.placeOf(`${C}/outline/assessment/_3_1/overview`, '?courseId=_1_1'), { path: `${C}/outline`, exact: false });
});

test('a click goes to the tab\'s place only while it is safe and in its own course', () => {
  assert.equal(L.target({ cid: '_1_1', path: `${C}/grades` }), `${C}/grades`);
  assert.equal(L.target({ cid: '_1_1', path: `${C}/grades` }, false), `${C}/outline`, 'place off: the outline');
  assert.equal(L.target({ cid: '_1_1', path: '/ultra/courses/_2_1/grades' }), `${C}/outline`, 'another course\'s place');
  assert.equal(L.target({ cid: '_1_1', path: `${C}/outline/assessment/_3_1/overview` }), `${C}/outline`, 'a stored assessment');
  assert.equal(L.target({ cid: '_1_1', path: 'javascript:alert(1)' }), `${C}/outline`);
  assert.equal(L.target({ cid: '_1_1' }), `${C}/outline`);
});

test('the stored list is cleaned: known ids, short strings, safe places, pinned first, no repeats, 40 at most', () => {
  const raw = [{ cid: '_2_1', name: 'B', pin: false, at: 2, path: '/ultra/courses/_2_1/grades', top: 300 }, { cid: '_1_1', name: 'A'.repeat(300), code: 7, pin: true, at: 1, path: `${C}/outline/assessment/_3_1/overview`, top: 900 },
    { cid: '_2_1', name: 'dup' }, { cid: 'x' }, null, 'no', { cid: '_3_1', at: -5, top: NaN, path: '/ultra/courses/_1_1/grades' }];
  assert.deepEqual(L.clean(raw), [
    { cid: '_1_1', name: 'A'.repeat(200), code: '', pin: true, at: 1, path: `${C}/outline`, top: 0 },
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
  assert.ok(L.SNAP_ONE < L.SNAP_ALL && L.SNAP_ALL <= 6e6, 'the total fits storage.session (10 MB) with room to spare');
});

test('a snapshot keeps nothing that runs, loads or takes input', () => {
  for (const tag of ['script', 'iframe', 'object', 'embed', 'input', 'textarea', 'select', 'video', 'audio', 'canvas', 'link', 'meta', 'base', 'style', 'template', 'frame', 'animatemotion', 'animatetransform', 'discard']) assert.ok(L.DROP.has(tag), tag);
  for (const tag of ['div', 'a', 'button', 'svg', 'img', 'section', 'course-page-header']) assert.ok(!L.DROP.has(tag), tag);
  for (const [k, v] of [['onclick', 'x()'], ['ONLOAD', 'x'], ['srcset', 'a.png 2x'], ['srcdoc', '<p>'], ['formaction', '/x'], ['ping', '/p'], ['tabindex', '0'], ['contenteditable', 'true'],
    ['href', 'javascript:alert(1)'], ['href', ' JavaScript:x'], ['xlink:href', 'javascript:x'], ['src', 'data:text/html,<script>'], ['data-gz-loading', ''], ['autofocus', '']]) assert.equal(L.keepAttr(k, v), false, `${k}=${v}`);
  for (const [k, v] of [['class', 'a b'], ['href', '/ultra/courses/_1_1/outline'], ['src', 'data:image/png;base64,AAAA'], ['style', 'color: red'], ['aria-current', 'page'], ['data-content-id', '_1_1'], ['id', 'x']]) assert.equal(L.keepAttr(k, v), true, `${k}=${v}`);
});

test('wired up: loadable on demand, in the worker and the editor, and only Ultra\'s first script holds the hook', () => {
  const bg = read('lib/background.js');
  assert.ok(bg.includes("'lib/coursetabs.js', 'features/coursetabs.js'") && bg.includes("'coursetabs.js');"));
  assert.ok(read('options.html').includes('<script src="lib/coursetabs.js"></script>'));
  assert.ok(read('content-ultra.js').includes("need('lib/coursetabs.js'") && !read('content.js').includes('coursetabs') && !read('content-canvas.js').includes('coursetabs'));
  // The copies live in storage.session only, never storage.local: what a page stores there is its tab list.
  const page = read('features/coursetabs.js').replace(/(^|\s)\/\/.*$/gm, '');
  assert.ok(!/storage\.session|indexedDB|localStorage/.test(page));
  assert.ok(/storage\.session/.test(bg));
});


test('snapshot attributes cannot load network resources or keep page credentials', () => {
  for (const [name, value, tag] of [
    ['src', 'https://cdn.school.test/image.png', 'img'], ['href', 'https://cdn.school.test/image.svg', 'image'],
    ['href', '/sprite.svg#icon', 'use'], ['src', 'data:image/svg+xml,<svg/>', 'img'],
    ['style', 'background:url(https://cdn.school.test/image.png)', 'div'], ['fill', 'url(https://cdn.school.test/s.svg#x)', 'path'],
    ['style', 'background:u\\72l(https://cdn.school.test/image.png)', 'div'],
    ['style', 'background:paint(page-code)', 'div'], ['style', 'background:image("https://cdn.school.test/image.png")', 'div'], ['background', 'https://cdn.school.test/x.png', 'table'],
    ['data-token', 'private-token', 'div'], ['value', 'password', 'button'], ['is', 'live-widget', 'button'],
  ]) assert.equal(L.keepAttr(name, value, tag), false, `${tag} ${name}=${value}`);
  assert.equal(L.keepAttr('href', '#local-icon', 'use'), false, 'the page base may point at a CDN, even for fragments');
  assert.equal(L.keepAttr('href', `${C}/grades`, 'a'), true);
  assert.equal(L.keepAttr('data-content-id', '_1_1', 'div'), true);
});

test('the hard tab bound holds even if every existing tab is pinned', () => {
  const pinned = Array.from({ length: L.MAX }, (_, i) => ({ cid: `_${i + 1}_1`, pin: true, at: i }));
  const result = L.open(pinned, { cid: '_999_1', at: 100 }, 8);
  assert.equal(result.tabs.length, L.MAX);
  assert.deepEqual(result.tabs, pinned, 'never silently evict a pinned course');
  assert.equal(result.full, true, 'the page can explain why no tab was added');
});
