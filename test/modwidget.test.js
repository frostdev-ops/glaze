// Declarative widgets (lib/modwidget.js): the strict cleaner for their blocks, what the data paths give, the worker's
// 'widget' ask (a binding resolves only with its permission declared and granted, for this site's data alone), buttons limited
// to Glaze's own actions, and a widget bundle's round trip through lib/modbundle.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/modwidget.js');
const API = require('../lib/modapi.js');
const B = require('../lib/modbroker.js');
const M = require('../lib/modbundle.js');

const enc = new TextEncoder();
const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const H = 36e5;
const clean = (b) => W.blocks(b);
const one = (b) => clean([b]);
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---- the cleaner ---------------------------------------------------------------------------------------------------------
const EVERY = [
  { type: 'text', text: 'Next: {next.title} ({next.course}), due {next.due}. {{literal}}', size: 'l', weight: 'bold', color: 'accent', muted: true },
  { type: 'number', value: 'todo.count', label: 'Open', unit: 'tasks', digits: 1, size: 'xl', color: '#336699' },
  { type: 'number', value: 42 },
  { type: 'ring', value: 'todo.done', max: 'todo.total', label: 'Done', color: 'ok' },
  { type: 'ring', value: 'grades.average' },
  { type: 'list', items: 'todo.items', max: 3, ordered: true, label: 'Soon', empty: 'Nothing due' },
  { type: 'countdown', to: 'next.due', label: 'Until', done: 'Due now' },
  { type: 'countdown', to: 1900000000000 },
  { type: 'image', src: 'img/leaf.png', alt: 'A leaf', w: 40, h: 40, fit: 'cover' },
  { type: 'button', label: 'Open it', action: 'next', tone: 'primary' },
];

test('every block type is kept as written, and cleaning again changes nothing', () => {
  const got = clean(EVERY);
  assert.deepEqual(plain(got), EVERY);
  assert.deepEqual(clean(got), got, 'idempotent');
  assert.ok(W.same(got, EVERY));
  assert.ok(W.same({ b: 1, a: [{ y: 1, x: 2 }] }, { a: [{ x: 2, y: 1 }], b: 1 }), 'same ignores key order');
  assert.ok(!W.same([{ a: 1 }], [{ a: 2 }]));
  // The keys come out in the cleaner's order whatever order they came in, and the data is the same.
  const shuffled = clean([{ muted: true, text: 'x', type: 'text' }]);
  assert.deepEqual(Object.keys(shuffled[0]), ['type', 'text', 'muted']);
});

test('limits: 1 to 12 blocks, short text and labels, at most 8 holes, at most 10 list rows', () => {
  const t = { type: 'text', text: 'x' };
  assert.equal(clean([]), null);
  assert.equal(clean(Array(13).fill(t)), null);
  assert.equal(clean(Array(12).fill(t)).length, 12);
  assert.equal(one({ type: 'text', text: 'x'.repeat(201) }), null);
  assert.ok(one({ type: 'text', text: 'x'.repeat(200) }));
  assert.equal(one({ type: 'text', text: '' }), null, 'empty text says nothing');
  assert.equal(one({ type: 'text', text: '{todo.count}'.repeat(9) }), null);
  assert.ok(one({ type: 'text', text: '{todo.count}'.repeat(8) }), 'eight holes fit');
  assert.equal(one({ type: 'number', value: 1, label: 'x'.repeat(81) }), null);
  assert.equal(one({ type: 'number', value: 1, unit: 'x'.repeat(13) }), null);
  assert.equal(one({ type: 'list', items: 'todo.items', max: 11 }), null);
  assert.equal(one({ type: 'list', items: 'todo.items', max: 0 }), null);
  assert.equal(one({ type: 'list', items: 'todo.items', max: 2.5 }), null);
  assert.equal(one({ type: 'button', label: '', action: 'next' }), null);
  assert.equal(one({ type: 'button', label: 'x'.repeat(61), action: 'next' }), null);
  assert.equal(one({ type: 'image', src: 'a.png', alt: 'x'.repeat(201) }), null);
  assert.equal(one({ type: 'image', src: 'a.png', alt: 'x', w: 2001 }), null);
});

test('wrong types, unknown keys, unknown blocks and values outside the ranges refuse the whole list', () => {
  for (const raw of [null, undefined, {}, 'text', 5, [null], [[]], ['text'], [{}], [{ type: 7 }]]) assert.equal(clean(raw), null, JSON.stringify(raw));
  // Blocks that are not on the list: Worker UI, markup and anything inherited.
  for (const type of ['html', 'canvas', 'input', 'stack', 'row', 'progress', 'script', 'iframe', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '']) {
    assert.equal(one({ type, text: 'x' }), null, type);
  }
  // Keys the block does not have.
  for (const more of [{ html: '<b>x</b>' }, { style: 'x' }, { onclick: 'x' }, { id: 'a' }, { href: 'https://x.test' }, { url: 'https://x.test' }]) assert.equal(one({ type: 'text', text: 'x', ...more }), null, JSON.stringify(more));
  assert.equal(clean(JSON.parse('[{"type":"text","text":"x","__proto__":{"a":1}}]')), null, 'a __proto__ key is a key');
  assert.equal(clean(JSON.parse('[{"type":"text","text":"x","constructor":1}]')), null);
  // Required keys.
  for (const b of [{ type: 'text' }, { type: 'number' }, { type: 'ring' }, { type: 'list' }, { type: 'countdown' }, { type: 'image', src: 'a.png' }, { type: 'image', alt: 'x' }, { type: 'button', label: 'x' }, { type: 'button', action: 'next' }]) assert.equal(one(b), null, JSON.stringify(b));
  // Types and ranges.
  for (const b of [
    { type: 'text', text: 5 }, { type: 'text', text: 'x', size: 'huge' }, { type: 'text', text: 'x', weight: 'heavy' }, { type: 'text', text: 'x', muted: 'yes' }, { type: 'text', text: 'x', color: 'url(x)' }, { type: 'text', text: 'x', color: 'red' },
    { type: 'number', value: NaN }, { type: 'number', value: Infinity }, { type: 'number', value: 1e16 }, { type: 'number', value: -1e16 }, { type: 'number', value: '12' }, { type: 'number', value: null }, { type: 'number', value: 1, digits: 5 }, { type: 'number', value: 1, digits: 1.5 },
    { type: 'ring', value: 1, max: 0 }, { type: 'ring', value: 1, max: -5 }, { type: 'ring', value: 1, max: 'grades.courses' },
    { type: 'list', items: 'todo.count' }, { type: 'list', items: ['a'] }, { type: 'list', items: 'todo.items', ordered: 1 },
    { type: 'countdown', to: -1 }, { type: 'countdown', to: 1.5 }, { type: 'countdown', to: 1e14 }, { type: 'countdown', to: 'todo.count' }, { type: 'countdown', to: '2026-10-17' },
    { type: 'image', src: 'a.png', alt: 'x', fit: 'stretch' }, { type: 'image', src: 'a.png', alt: 'x', w: 0 }, { type: 'image', src: 'a.png', alt: 'x', h: 1.5 },
    { type: 'button', label: 'x', action: 'next', tone: 'danger' },
  ]) assert.equal(one(b), null, JSON.stringify(b));
  // One bad block among good ones refuses all of them; nothing is dropped or trimmed.
  assert.equal(clean([{ type: 'text', text: 'ok' }, { type: 'text', text: 'x', style: 1 }]), null);
});

test('data bindings must be on the allowlist, and of the kind the block takes', () => {
  assert.deepEqual(Object.keys(W.PATHS).sort(), ['courses.count', 'courses.names', 'grades.average', 'grades.courses', 'grades.gpa', 'next.course', 'next.due', 'next.title', 'schedule.today', 'todo.count', 'todo.done', 'todo.items', 'todo.overdue', 'todo.today', 'todo.total']);
  for (const [path, [kind, perm]] of Object.entries(W.PATHS)) {
    assert.ok(['text', 'number', 'time', 'list'].includes(kind) && ['todo', 'grades', 'courses'].includes(perm), path);
    assert.equal(W.kind(path), kind);
  }
  for (const p of ['next.url', 'next.id', 'todo.notes', 'grades.all', 'user.name', 'todo', 'TODO.count', 'todo.count ', 'todo.count.x', '__proto__', 'constructor.name', 'toString', 'hasOwnProperty', 'courses.id', 'storage.local']) {
    assert.equal(W.kind(p), null, p);
    assert.equal(one({ type: 'number', value: p }), null, p);
    assert.equal(one({ type: 'text', text: `{${p}}` }), null, `in text: ${p}`);
    assert.equal(one({ type: 'countdown', to: p }), null, p);
    assert.equal(one({ type: 'list', items: p }), null, p);
  }
  // The kinds: numbers in number and ring blocks, a time in a countdown, a list in a list; text, numbers and times in holes.
  assert.equal(one({ type: 'number', value: 'next.title' }), null);
  assert.equal(one({ type: 'number', value: 'next.due' }), null);
  assert.equal(one({ type: 'ring', value: 'todo.items' }), null);
  assert.equal(one({ type: 'countdown', to: 'next.title' }), null);
  assert.equal(one({ type: 'list', items: 'next.title' }), null);
  assert.equal(one({ type: 'text', text: '{todo.items}' }), null, 'a list does not fit a hole');
  assert.equal(one({ type: 'text', text: '{schedule.today}' }), null);
  for (const p of ['next.title', 'next.due', 'todo.count', 'grades.gpa', 'courses.count']) assert.ok(one({ type: 'text', text: `{${p}}` }), p);
});

test('the placeholder syntax is fixed: {path}, {{ and }}, and no other brace', () => {
  for (const text of ['{', '}', 'a { b', 'a } b', '{todo.count}}', '{ todo.count }', '{todo.count', '{todo}', '{todo.}', '{.count}', '{todo.count.x}', '{TODO.COUNT}', '${todo.count}x{']) {
    assert.equal(one({ type: 'text', text }), null, text);
  }
  for (const text of ['{{', '}}', '{{todo.count}}', 'a {{ b }} c', '{todo.count}{todo.done}', '{{{todo.count}', '{todo.count}}}']) assert.ok(one({ type: 'text', text }), text);
  // Markup is only text: it is kept as typed, and drawn as the text it is.
  const html = '<img src=x onerror=alert(1)> <script>x</script> &amp;';
  const [b] = one({ type: 'text', text: html });
  assert.equal(b.text, html);
  const r = W.resolve([b], {}, { now: NOW });
  assert.equal(r.tree.children[0].text, html);
  assert.equal(r.tree.children[0].type, 'text');
});

test('images name the mod\'s own picture files only', () => {
  for (const src of ['https://example.com/a.png', 'http://example.com/a.png', '//example.com/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'a.svg', 'a.html', 'a.js', '../a.png', '/a.png', 'a/../b.png', 'a\\b.png', '.hidden.png', 'a.png?x', 'a.png#x', 'a b.png', '', 'a'.repeat(201) + '.png']) {
    assert.equal(one({ type: 'image', src, alt: 'x' }), null, src);
  }
  for (const src of ['a.png', 'img/leaf.JPG', 'a/b/c.webp', 'x.gif', 'y.avif', 'z.jpeg']) assert.ok(one({ type: 'image', src, alt: '' }), src);
  assert.deepEqual(W.images(clean(EVERY)), ['img/leaf.png']);
});

test('buttons run only Glaze\'s own actions', () => {
  assert.deepEqual(W.ACTIONS, ['next', 'course', 'dashboard', 'courses', 'grades', 'calendar']);
  for (const action of W.ACTIONS) assert.ok(one({ type: 'button', label: 'Go', action }), action);
  for (const action of ['https://example.com', 'http://example.com', 'javascript:alert(1)', '/ultra/course', 'open', 'mailto:a@b.c', 'next ', 'NEXT', '__proto__', 'constructor', '', null, 1, ['next']]) assert.equal(one({ type: 'button', label: 'Go', action }), null, String(action));
  // No address field exists on a button at all.
  for (const k of ['url', 'href', 'to', 'target', 'link', 'src']) assert.equal(one({ type: 'button', label: 'Go', action: 'next', [k]: 'https://example.com' }), null, k);
});

test('needs: the permissions a widget\'s paths ask for', () => {
  assert.deepEqual(W.needs(clean([{ type: 'text', text: 'hi' }, { type: 'image', src: 'a.png', alt: '' }])), []);
  assert.deepEqual(W.needs(clean([{ type: 'text', text: '{next.title}' }])), ['todo']);
  assert.deepEqual(W.needs(clean([{ type: 'number', value: 'grades.gpa' }, { type: 'ring', value: 'todo.done', max: 'todo.total' }])), ['grades', 'todo']);
  assert.deepEqual(W.needs(clean([{ type: 'list', items: 'courses.names' }, { type: 'countdown', to: 'next.due' }])), ['courses', 'todo']);
  assert.deepEqual(W.needs(clean(EVERY)), ['grades', 'todo']);
  assert.deepEqual(W.needs(clean([{ type: 'text', text: '{{todo.count}}' }])), [], 'a brace written out names nothing');
});

// ---- what the paths give -------------------------------------------------------------------------------------------------
const day = (d) => new Date(d);
const todo = (over) => ({ id: '1', type: 'assignment', courseId: '42', course: 'Chem', title: 'Lab', due: NOW + 3 * H, url: 'https://school.instructure.com/courses/42/assignments/1', done: false, submitted: false, ...over });
const ITEMS = [
  todo({ id: 'a', title: 'Essay', due: NOW + 30 * H, course: 'History', courseId: '7' }),
  todo({ id: 'b', title: 'Lab', due: NOW + 3 * H }),
  todo({ id: 'c', title: 'Old', due: NOW - 2 * H }),
  todo({ id: 'd', title: 'Done already', due: NOW + 1 * H, done: true }),
  todo({ id: 'e', title: 'Handed in', due: NOW + 2 * H, submitted: true }),
  todo({ id: 'f', title: 'Someday', due: null, url: '' }),
];
const GRADES = [{ courseId: '1', name: 'Biology', percent: 91.5 }, { courseId: '2', name: 'History', percent: 84 }, { courseId: '3', name: 'Calculus', percent: 77.2 }, { courseId: '4', name: 'Empty', percent: null }];
const COURSES = [{ id: '1', name: 'Biology' }, { id: '2', name: 'History' }];
const DATA = { todo: ITEMS, grades: GRADES, courses: COURSES };
const text = (path, data = DATA, opts = {}) => W.resolve(clean([{ type: 'text', text: `{${path}}` }]), data, { now: NOW, lang: 'en', ...opts }).tree?.children[0].text;
const num = (path, data = DATA) => W.resolve(clean([{ type: 'number', value: path }]), data, { now: NOW, lang: 'en' }).tree?.children[0].value;
const rows = (path, data = DATA, max = 10) => W.resolve(clean([{ type: 'list', items: path, max }]), data, { now: NOW, lang: 'en' }).tree?.children[0].children.map((c) => c.text);

test('to-do paths: open items only, the next one due from now on, counts, and the device\'s own day', () => {
  assert.equal(text('next.title'), 'Lab');
  assert.equal(text('next.course'), 'Chem');
  assert.match(text('next.due'), /\d/);
  assert.equal(num('todo.count'), 4, 'open: not done, not handed in (the one with no date counts)');
  assert.equal(num('todo.overdue'), 1);
  assert.equal(num('todo.done'), 2);
  assert.equal(num('todo.total'), 6);
  const lo = new Date(NOW); lo.setHours(0, 0, 0, 0);
  const inDay = (n) => ITEMS.filter((i) => !i.done && !i.submitted && i.due !== null && i.due >= lo.getTime() && i.due < lo.getTime() + 864e5).length;
  assert.equal(num('todo.today'), inDay());
  assert.equal(rows('todo.items').length, 4);
  assert.match(rows('todo.items')[0], /^Old · Chem · /, 'soonest first, overdue ahead');
  assert.match(rows('todo.items')[3], /^Someday · Chem$/, 'no date: last, no time');
  assert.equal(rows('todo.items', DATA, 2).length, 2, 'the block\'s own max');
  // Today's items by time, done ones marked, whatever zone the machine is in.
  const mine = ITEMS.filter((i) => i.due !== null && i.due >= lo.getTime() && i.due < lo.getTime() + 864e5).sort((a, b) => a.due - b.due);
  const today = rows('schedule.today');
  assert.equal(today.length, mine.length);
  today.forEach((r, i) => { assert.ok(r.includes(mine[i].title) && /\d/.test(r), r); assert.equal(r.startsWith('✓'), mine[i].done || mine[i].submitted, r); });
  assert.ok(!today.some((r) => r.includes('Someday')), 'only items with a time today');
  // Nothing upcoming: no next.*, and the block with only it says nothing.
  const none = { todo: [todo({ due: NOW - H })] };
  assert.equal(text('next.title', none), '–');
  assert.equal(W.resolve(clean([{ type: 'number', value: 'todo.count' }]), none, { now: NOW }).tree.children[0].value, 1);
  // Links for the next-to-do button.
  assert.deepEqual(W.resolve(clean([{ type: 'button', label: 'Go', action: 'next' }]), DATA, { now: NOW }).links, { next: 'https://school.instructure.com/courses/42/assignments/1', cid: '42' });
});

test('grade and course paths: the GPA on the 4.0 scale, the average, each course, the names', () => {
  assert.equal(num('grades.gpa'), (3.7 + 3 + 2.3) / 3, 'A- B C+, courses weighted equally, a course with no grade left out');
  assert.equal(num('grades.average'), (91.5 + 84 + 77.2) / 3);
  assert.deepEqual(rows('grades.courses'), ['Biology: 91.5%', 'History: 84%', 'Calculus: 77.2%']);
  assert.equal(num('courses.count'), 2);
  assert.deepEqual(rows('courses.names'), ['Biology', 'History']);
  assert.equal(num('grades.gpa', { grades: [] }), undefined, 'no grades: no value, so no block');
  assert.equal(W.resolve(clean([{ type: 'number', value: 'grades.gpa' }]), { grades: [] }, { now: NOW }).why, 'empty');
});

test('data of the wrong shape is left out or clipped, never trusted: times out of range, huge numbers, odd values', () => {
  const odd = { todo: [todo({ title: 5, course: null, due: 1e300 }), todo({ title: 'Far', due: 2e13 }), todo({ title: 'Neg', due: -5 }), todo({ title: 'Nan', due: NaN }), 'text', null, [], todo({ title: 'Real', due: NOW + H, course: 'C'.repeat(500) })],
    grades: [{ name: 'Huge', percent: 1e9 }, { name: 'Inf', percent: Infinity }, { name: 'Str', percent: '90' }, null, 'x', { name: 'Ok', percent: 80 }], courses: [{ name: 5 }, null, { name: 'Real' }] };
  const r = W.resolve(clean(EVERY.slice(0, 7)), odd, { now: NOW, lang: 'en' });
  assert.ok(r.tree, 'a tree is made');
  assert.deepEqual(plain(API.tree(r.tree)), plain(r.tree), 'and it is a valid one');
  assert.equal(text('next.title', odd), 'Real');
  assert.equal(num('todo.count', odd), 5, 'five objects are to-dos (an out-of-range time is no time, the to-do still counts)');
  assert.equal(num('grades.average', odd), 80, 'only the percent that is a sane number counts');
  assert.equal(num('grades.gpa', odd), 2.7, '80 is a B-');
  assert.deepEqual(rows('courses.names', odd), ['Real']);
  assert.ok(rows('todo.items', odd).every((l) => l.length <= 120));
  for (const bad of [{ todo: 'x' }, { todo: {} }, { grades: 7 }, { courses: 'x' }, { todo: [null], grades: [null], courses: [null] }]) assert.doesNotThrow(() => W.resolve(clean(EVERY.slice(0, 7)), bad, { now: NOW }), JSON.stringify(bad));
});

test('a binding with no granted data resolves to nothing: the block goes, and the answer says why', () => {
  for (const [path, data] of [['todo.count', { grades: GRADES, courses: COURSES }], ['grades.gpa', { todo: ITEMS }], ['courses.count', { todo: ITEMS, grades: GRADES }]]) {
    const r = W.resolve(clean([{ type: 'number', value: path }]), data, { now: NOW });
    assert.equal(r.tree, null, path);
    assert.equal(r.why, 'denied', path);
  }
  const r = W.resolve(clean([{ type: 'text', text: 'Grades {grades.gpa}, due {next.title}' }]), { todo: ITEMS }, { now: NOW });
  assert.equal(r.tree.children[0].text, 'Grades –, due Lab', 'inside text a missing value is a dash');
  // Nothing to draw at all.
  assert.equal(W.resolve(clean([{ type: 'number', value: 'todo.count' }]), undefined, { now: NOW }).why, 'denied');
  assert.equal(W.resolve(clean([{ type: 'list', items: 'todo.items' }]), { todo: [] }, { now: NOW }).why, 'empty');
  assert.equal(W.resolve(clean([{ type: 'list', items: 'todo.items', empty: 'Nothing due' }]), { todo: [] }, { now: NOW }).tree.children[0].text, 'Nothing due');
});

test('the answer is a cleaned component tree: no input, canvas or markup, ids only on buttons, pictures only the mod\'s own', () => {
  const blocks = clean(EVERY);
  const r = W.resolve(blocks, DATA, { now: NOW, lang: 'de', paths: ['img/leaf.png'] });
  assert.deepEqual(plain(API.tree(r.tree)), plain(r.tree), 'the component cleaner keeps it as it is');
  const kinds = new Set();
  (function walk(n) { kinds.add(n.type); (n.children || []).forEach(walk); })(r.tree);
  assert.deepEqual([...kinds].sort(), ['button', 'countdown', 'image', 'list', 'number', 'ring', 'stack', 'text']);
  assert.deepEqual(r.acts, { b9: 'next' });
  assert.equal(r.tree.children.find((c) => c.type === 'button').id, 'b9');
  assert.equal(W.resolve(blocks, DATA, { now: NOW, paths: [] }).tree.children.some((c) => c.type === 'image'), false, 'a picture the mod does not have is left out');
  // A ring over nothing is not drawn (the cleaner of the tree would refuse a maximum of 0).
  const ring = W.resolve(clean([{ type: 'ring', value: 'todo.done', max: 'todo.total' }, { type: 'text', text: 'x' }]), { todo: [] }, { now: NOW });
  assert.deepEqual(ring.tree.children.map((c) => c.type), ['text']);
  // Long values are clipped, and the tree stays within the component limits.
  const long = W.resolve(clean([{ type: 'text', text: '{next.title} {next.course} {next.title} {next.course} {next.title} {next.course}' }]), { todo: [todo({ title: 'T'.repeat(300), course: 'C'.repeat(300) })] }, { now: NOW });
  assert.ok(long.tree.children[0].text.length <= 500 && long.tree.children[0].text.includes('…'));
});

test('buttons: next and course need a to-do; every action is one of Glaze\'s names, never an address', () => {
  const blocks = clean(W.ACTIONS.map((action) => ({ type: 'button', label: action, action })));
  const r = W.resolve(blocks, { todo: [] }, { now: NOW });
  assert.deepEqual(r.acts, Object.fromEntries(W.ACTIONS.map((a, i) => [`b${i}`, a])));
  assert.deepEqual(r.tree.children.map((c) => !!c.disabled), [true, true, false, false, false, false], 'no next to-do: next and course are off');
  const ok = W.resolve(blocks, DATA, { now: NOW });
  assert.deepEqual(ok.tree.children.map((c) => !!c.disabled), [false, false, false, false, false, false]);
  assert.equal(JSON.stringify(ok.tree).includes('http'), false, 'no address in the tree');
  assert.equal(W.resolve(blocks, { courses: COURSES }, { now: NOW }).tree.children[0].disabled, true, 'next without the to-do data is off too');
});

test('a bad language never throws, and times follow it', () => {
  for (const lang of ['', 'x', 'not a tag', 'en-', undefined, null, 'zz-ZZ-ZZ-ZZ-ZZ']) assert.doesNotThrow(() => W.resolve(clean([{ type: 'text', text: '{next.due} {todo.count}' }]), DATA, { now: NOW, lang }), String(lang));
  assert.notEqual(text('next.due', DATA, { lang: 'en' }), text('next.due', DATA, { lang: 'de' }));
});

test('until: when the answer next changes by itself', () => {
  const r = W.resolve(clean([{ type: 'number', value: 'todo.count' }]), DATA, { now: NOW });
  assert.equal(r.until, NOW + 3 * H, 'the next due time');
  const end = new Date(NOW); end.setHours(24, 0, 0, 0);
  assert.equal(W.resolve(clean([{ type: 'number', value: 'todo.count' }]), { todo: [] }, { now: NOW }).until, end.getTime(), 'else the end of the day');
});

test('collect reads only the permissions it is given, and a failed read is no data', async () => {
  const asked = [];
  const got = await W.collect(['todo', 'grades'], async (p) => { asked.push(p); if (p === 'grades') throw new Error('no'); return [1]; });
  assert.deepEqual(asked.sort(), ['grades', 'todo']);
  assert.deepEqual(got, { todo: [1], grades: [] });
  assert.deepEqual(await W.collect([], async () => { throw new Error('never'); }), {});
  assert.deepEqual(await W.collect(['todo'], async () => 'not a list'), { todo: [] });
});

// ---- the worker's ask ------------------------------------------------------------------------------------------------------
const SITE = 'https://school.instructure.com';
const ID = 'abcdefghijklmnop', OTHER = 'qrstuvwxyz234567';
const flush = () => new Promise(setImmediate);
const area = (data = {}) => ({
  data, reads: [],
  async get(k) { await flush(); const keys = k === null ? Object.keys(data) : [].concat(k); this.reads.push(...keys); return structuredClone(Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, data[x]]))); },
  async set(p) { await flush(); Object.assign(data, structuredClone(p)); return true; },
  async remove(k) { await flush(); for (const x of [].concat(k)) delete data[x]; return true; },
});
const BLOCKS = clean([
  { type: 'text', text: 'Next: {next.title}' }, { type: 'number', value: 'grades.gpa', label: 'GPA' }, { type: 'list', items: 'courses.names', max: 5 },
  { type: 'image', src: 'leaf.png', alt: '' }, { type: 'button', label: 'Open', action: 'next' },
]);
const widgetRec = (over = {}) => ({
  id: ID, enabled: true, hash: 'h1', key: 'k1', version: '1.0.0', paths: ['leaf.png'],
  manifest: { glaze: 1, name: 'Dash', permissions: [{ id: 'todo', why: 'w' }, { id: 'grades', why: 'w' }, { id: 'courses', why: 'w' }],
    ui: { tiles: [{ id: 'main', name: 'Main', sizes: ['m'], blocks: BLOCKS }], rail: [{ id: 'side', name: 'Side', blocks: clean([{ type: 'text', text: 'x' }]) }] } },
  grants: { todo: true, grades: true, courses: true }, ...over,
});
// The broker reads with the real clock, so the cached to-do stays ahead of it.
const DB = () => ({
  todoCache: { key: `todo:${SITE}/5`, at: 1, items: [{ id: '1', type: 'assignment', cid: '42', course: 'Chem', title: 'Lab', at: Date.now() + 3 * H, url: '/courses/42/assignments/1', note: 'private words' }] },
  [`insights:${SITE}/5`]: { at: 10, courses: [{ id: '42', name: 'Chem', trend: [[1, 91.5]] }] },
  'insights:https://other.instructure.com/5': { at: 99, courses: [{ id: '1', name: 'Other school', trend: [[1, 10]] }] },
  seenCourses: { _1_1: { name: 'Bio', site: SITE }, _2_1: { name: 'Elsewhere', site: 'https://other.edu' } },
});
const env = ({ site = SITE, record = widgetRec(), local = {}, list = null } = {}) => {
  const l = area({ [`mod:${ID}`]: record, mods: [ID], ...DB(), ...local });
  let turn = Promise.resolve();
  return { site, local: l, sync: area({}), queue: (f) => (turn = turn.then(f, f)), keys: async () => Object.keys(l.data), record: async (id) => (await l.get(`mod:${id}`))[`mod:${id}`], blocklist: async () => list };
};
const ask = (e, over = {}) => B.page({ op: 'widget', mod: ID, slot: 'tile:main', lang: 'en', ...over }, e);
const dataKeys = (e) => e.local.reads.filter((k) => /^(todoCache|seenCourses|insights:)/.test(k));

test('widget: a binding resolves with its permission declared and granted, from this site\'s data alone', async () => {
  const e = env();
  const r = await ask(e);
  assert.equal(r.ok, true);
  assert.equal(r.why, '');
  const t = r.tree.children;
  assert.equal(t[0].text, 'Next: Lab');
  assert.equal(t[1].value, 3.7, '91.5 is an A-');
  assert.deepEqual(t[2].children.map((c) => c.text), ['Bio']);
  assert.equal(t[3].src, 'leaf.png');
  assert.deepEqual(r.acts, { b4: 'next' });
  assert.equal(r.links.next, `${SITE}/courses/42/assignments/1`);
  assert.equal(JSON.stringify(r).includes('private words'), false, 'a planner note\'s text never leaves');
  assert.equal(JSON.stringify(r).includes('Other school'), false);
  assert.equal(JSON.stringify(r).includes('Elsewhere'), false);
});

test('widget: no grant, no read: an ungranted permission\'s data is not even fetched', async () => {
  for (const [grants, gone] of [[{ todo: true, courses: true }, 'grades'], [{ grades: true, courses: true }, 'todo'], [{ todo: true, grades: true }, 'courses'], [{}, 'all']]) {
    const e = env({ record: widgetRec({ grants }) });
    const r = await ask(e);
    assert.equal(r.ok, true, gone);
    const asked = dataKeys(e);
    if (gone === 'grades') assert.ok(!asked.some((k) => k.startsWith('insights:')) && asked.includes('todoCache'), gone);
    if (gone === 'todo') assert.ok(!asked.includes('todoCache') && asked.some((k) => k.startsWith('insights:')), gone);
    if (gone === 'courses') assert.ok(!asked.includes('seenCourses') && asked.includes('todoCache'), gone);
    if (gone === 'all') { assert.deepEqual(asked, []); assert.equal(r.tree.children.some((c) => c.type === 'number' || c.type === 'list'), false); assert.equal(r.tree.children[0].text, 'Next: –'); }
    const text = JSON.stringify(r);
    if (gone === 'todo' || gone === 'all') assert.ok(!text.includes('Lab'), gone);
    if (gone === 'grades' || gone === 'all') assert.ok(!text.includes('3.7'), gone);
  }
  // A widget that shows only grades-less things and is granted nothing is simply drawn.
  assert.equal((await ask(env({ record: widgetRec({ grants: {} }) }), { slot: 'rail:side' })).tree.children[0].text, 'x');
});

test('widget: a permission must be declared as well as granted, and only true grants', async () => {
  const noDecl = widgetRec({ manifest: { ...widgetRec().manifest, permissions: [{ id: 'courses', why: 'w' }] } });
  const e = env({ record: noDecl });
  const r = await ask(e);
  assert.equal(r.tree.children[0].text, 'Next: –', 'granted but never declared');
  assert.ok(!dataKeys(e).includes('todoCache'));
  for (const bad of ['true', 1, 'yes', {}, []]) {
    const e2 = env({ record: widgetRec({ grants: { todo: bad, grades: bad, courses: bad } }) });
    assert.equal((await ask(e2)).tree.children[0].text, 'Next: –', JSON.stringify(bad));
    assert.deepEqual(dataKeys(e2), [], JSON.stringify(bad));
  }
  const all = env({ record: widgetRec({ grants: { todo: true } }) });
  assert.equal((await ask(all)).tree.children[0].text, 'Next: Lab', 'revoking the others leaves the one granted');
});

test('widget: only a mod that is installed, on, not blocklisted, from an LMS tab, and a slot that is a declarative one', async () => {
  assert.deepEqual(await ask(env({ site: null })), { ok: false, error: 'sender' });
  assert.deepEqual(await ask(env(), { mod: OTHER }), { ok: false, error: 'mod' });
  for (const mod of ['ABCDEFGHIJKLMNOP', 'abc', '', 7, null, '__proto__', undefined]) assert.deepEqual(await ask(env(), { mod }), { ok: false, error: 'op' }, String(mod));
  assert.deepEqual(await ask(env({ record: widgetRec({ enabled: false }) })), { ok: false, error: 'mod' });
  assert.deepEqual(await ask(env({ record: widgetRec({ blocked: 'bad' }) })), { ok: false, error: 'mod' });
  assert.deepEqual(await ask(env({ list: { mods: [ID] } })), { ok: false, error: 'mod' });
  for (const slot of [7, null, undefined, {}, ['tile:main']]) assert.deepEqual(await ask(env(), { slot }), { ok: false, error: 'op' }, JSON.stringify(slot));
  for (const slot of ['tile:nope', 'tile:', 'rail:main', 'rail:nope', 'nav', 'background', 'tile:main:x', '', '__proto__', 'tile:__proto__']) assert.deepEqual(await ask(env(), { slot }), { ok: false, error: 'slot' }, slot);
  // A record whose blocks are not what the cleaner keeps (a tampered store) draws nothing.
  const bad = widgetRec();
  bad.manifest.ui.tiles[0].blocks = [{ type: 'html', html: '<img src=x onerror=alert(1)>' }];
  assert.deepEqual(await ask(env({ record: bad })), { ok: false, error: 'slot' });
  const bad2 = widgetRec();
  bad2.manifest.ui.tiles[0].blocks = [{ type: 'number', value: 'storage.local' }];
  assert.deepEqual(await ask(env({ record: bad2 })), { ok: false, error: 'slot' });
  // A slot that has a file or no blocks at all is not a declarative widget.
  const code = widgetRec();
  delete code.manifest.ui.tiles[0].blocks;
  assert.deepEqual(await ask(env({ record: code })), { ok: false, error: 'slot' });
});

test('widget: the language is a tag or nothing, and a picture the mod does not have is not drawn', async () => {
  for (const lang of ['en', 'pt-BR', 'zh-Hant-TW', 'de']) assert.equal((await ask(env(), { lang })).ok, true, lang);
  for (const lang of ['x', 'en_US', 'a'.repeat(50), '../..', { toString: 1 }, 7, null, '<script>']) assert.equal((await ask(env(), { lang })).ok, true, JSON.stringify(lang));
  const r = await ask(env({ record: widgetRec({ paths: [] }) }));
  assert.equal(r.tree.children.some((c) => c.type === 'image'), false);
});

test('widget: the page\'s list names declarative mods and starts nothing; a button is never given Worker UI', async () => {
  const e = env({ local: { modOrder: [OTHER, ID] } });
  const r = await B.page({ op: 'list' }, e);
  assert.deepEqual(r.mods, []);
  assert.deepEqual(r.plain, [{ id: ID, name: 'Dash', slots: [{ key: 'tile:main', name: 'Main', size: 'm' }, { key: 'rail:side', name: 'Side', size: 's' }] }]);
  assert.deepEqual((await B.page({ op: 'list' }, env({ record: widgetRec({ enabled: false }) }))).plain, []);
  assert.deepEqual((await B.page({ op: 'list' }, env({ list: { authors: ['k1'] } }))).plain, []);
  assert.deepEqual((await B.page({ op: 'list' }, env({ site: null }))), { ok: false, error: 'sender' });
  // A code mod with a plain tile in a forged record cannot draw over it from its Worker.
  const forged = widgetRec({ files: { 'hooks.js': Buffer.from('void 0').toString('base64') } });
  forged.manifest.hooks = 'hooks.js';
  const call = await B.handle({ mod: ID, call: 'ui.render', args: ['tile:main', { type: 'text', text: 'x' }], via: 'worker' }, env({ record: forged }));
  assert.deepEqual(call, { ok: false, error: 'slot' });
});

// ---- a widget's bundle -----------------------------------------------------------------------------------------------------
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const manifest = (over = {}) => ({
  glaze: 1, name: 'Due Soon', version: '1.0.0', author: { name: 'Kai' },
  permissions: [{ id: 'todo', why: 'Shows what is due.' }, { id: 'grades', why: 'Shows your GPA.' }],
  ui: { tiles: [{ id: 'due', name: 'Due soon', sizes: ['m'], blocks: clean(EVERY) }], rail: [{ id: 'gpa', name: 'GPA', blocks: clean([{ type: 'number', value: 'grades.gpa' }]) }] },
  ...over,
});
const FILES = () => ({ 'img/leaf.png': PNG });
let key;
const author = async () => (key ||= await M.makeKey());

test('bundle: a widget packs, signs and reads back as it was, with no code in it', async () => {
  const k = await author();
  const got = await M.pack(FILES(), manifest(), k);
  const back = await M.read(got.bytes);
  assert.equal(back.signed, true);
  assert.deepEqual(plain(back.manifest.ui), plain(manifest().ui));
  assert.equal(back.id, got.id);
  assert.ok(!Object.keys(back.files).some((p) => p.endsWith('.js') || p.endsWith('.html')), 'no code or page in it');
  assert.deepEqual(M.caps(back.manifest), ['todo', 'grades'], 'two permissions and no page of its own');
  assert.deepEqual(plain(W.slots(back.manifest)), [{ key: 'tile:due', name: 'Due soon', size: 'm' }, { key: 'rail:gpa', name: 'GPA', size: 's' }]);
  // As a code to paste, too.
  assert.equal((await M.read(await M.decode(await M.encode(got.bytes)))).hash, got.hash);
  // The key order of a hand-written mod.json does not matter, but the data must be exactly what the cleaner keeps.
  const reordered = manifest();
  reordered.ui.tiles[0].blocks = EVERY.map((b) => Object.fromEntries(Object.entries(b).reverse()));
  assert.equal((await M.pack(FILES(), reordered, k)).hash.length, 43);
});

test('bundle: a widget\'s blocks are checked like the rest of mod.json', async () => {
  const k = await author();
  const refuse = async (files, m, field) => await assert.rejects(M.pack(files, m, k), (e) => { assert.match(e.message, new RegExp(field.replace('.', '\\.'))); return true; });
  const blocks = (b) => manifest({ ui: { tiles: [{ id: 'due', name: 'Due', sizes: ['m'], blocks: b }] } });
  await refuse(FILES(), blocks([{ type: 'html', html: '<b>x</b>' }]), 'ui.tiles.0.blocks');
  await refuse(FILES(), blocks([{ type: 'number', value: 'user.secret' }]), 'ui.tiles.0.blocks');
  await refuse(FILES(), blocks([{ type: 'button', label: 'Go', action: 'https://example.com' }]), 'ui.tiles.0.blocks');
  await refuse(FILES(), blocks([]), 'ui.tiles.0.blocks');
  await refuse(FILES(), blocks('text'), 'ui.tiles.0.blocks');
  // Not exactly what the cleaner keeps: text with a run of spaces, a number as a string.
  await refuse(FILES(), blocks([{ type: 'text', text: 'two  spaces' }]), 'ui.tiles.0.blocks');
  await refuse(FILES(), blocks([{ type: 'number', value: 1, digits: '1' }]), 'ui.tiles.0.blocks');
  // Pictures are the bundle's own files, and pictures.
  const pic = (src) => blocks([{ type: 'image', src, alt: '' }]);
  await refuse({}, pic('img/leaf.png'), 'ui.tiles.0.blocks');
  await refuse({ 'img/leaf.png': enc.encode('x'), 'other.png': PNG }, pic('img/leaf.png'), 'png|kind|file');
  await refuse({ 'a.json': enc.encode('{}') }, pic('a.json'), 'ui.tiles.0.blocks');
  // Data comes with a declared permission and a reason.
  await refuse(FILES(), manifest({ permissions: [{ id: 'todo', why: 'x' }] }), 'permissions');
  await refuse(FILES(), manifest({ permissions: [] }), 'permissions');
  await refuse(FILES(), { ...manifest(), permissions: undefined }, 'permissions');
  // ... and no more than it uses: not a data permission it never draws, not a network host.
  await refuse(FILES(), manifest({ permissions: [{ id: 'todo', why: 'x' }, { id: 'grades', why: 'y' }, { id: 'courses', why: 'z' }] }), 'permissions');
  await refuse(FILES(), manifest({ permissions: [...manifest().permissions, { id: 'network:api.weather.gov', why: 'z' }] }), 'permissions');
  // A widget has no code and no page of its own: not beside hooks, not with a file.
  const free = (more) => { const m = manifest(more); delete m.permissions; return m; };
  const hi = clean([{ type: 'text', text: 'x' }]);
  await refuse({ ...FILES(), 'hooks.js': enc.encode('void 0') }, manifest({ hooks: 'hooks.js' }), 'ui');
  await refuse({ ...FILES(), 'p.html': enc.encode('<p>') }, free({ ui: { tiles: [{ id: 'due', name: 'Due', sizes: ['m'], blocks: hi }], rail: [{ id: 'r', name: 'R', file: 'p.html' }] } }), 'ui');
  await refuse({ ...FILES(), 'p.html': enc.encode('<p>') }, free({ ui: { tiles: [{ id: 'due', name: 'Due', sizes: ['m'], file: 'p.html', blocks: hi }] } }), 'ui.tiles.0.blocks');
  // Slots stay within the manifest's limits.
  await refuse(FILES(), free({ ui: { tiles: [{ id: 'due', name: 'Due', blocks: hi }] } }), 'ui.tiles.0');
  await refuse(FILES(), free({ ui: { rail: [{ id: 'r', name: 'R', sizes: ['m'], blocks: hi }] } }), 'ui.rail.0');
  await refuse(FILES(), free({ ui: { tiles: [{ id: 'due', name: 'Due', sizes: ['m'], blocks: hi, extra: 1 }] } }), 'ui.tiles.0');
});

test('bundle: a widget needing no data needs no permission, and installs from the builder with its grants', async () => {
  const k = await author();
  const m = manifest({ name: 'Quote', permissions: undefined, ui: { tiles: [{ id: 'q', name: 'Quote', sizes: ['s'], blocks: clean([{ type: 'text', text: 'One page at a time' }]) }] } });
  delete m.permissions;
  const got = await M.pack({}, m, k);
  assert.deepEqual(M.caps(got.manifest), []);
  // The worker's install, as the editor's builder sends it: a signed bundle, its hash, the grants it chose, source 'builder'.
  const local = area({ modDev: false, modAuthor: k });
  const std = (b) => Buffer.from(b).toString('base64');
  const r = await M.change({ op: 'install', zip: std(got.bytes), hash: got.hash, grants: [], source: 'builder' }, { local }, { blocked: () => '' });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'install');
  assert.equal(local.data[`mod:${got.id}`].source, 'builder');
  assert.equal(local.data[`mod:${got.id}`].dev, false);
  // With data: the grants must be declared.
  const withData = await M.pack(FILES(), manifest({ name: 'Due Two' }), k);
  const bad = await M.change({ op: 'install', zip: std(withData.bytes), hash: withData.hash, grants: ['courses'], source: 'builder' }, { local }, { blocked: () => '' });
  assert.deepEqual(bad, { ok: false, error: 'grants' });
  const good = await M.change({ op: 'install', zip: std(withData.bytes), hash: withData.hash, grants: ['todo', 'grades'], source: 'builder' }, { local }, { blocked: () => '' });
  assert.equal(good.ok, true);
  assert.deepEqual(local.data[`mod:${withData.id}`].grants, { todo: true, grades: true });
  // An update that adds a permission prompts (the builder sends the grants it chose); an equal or lower version does not install.
  const more = manifest({ name: 'Due Two', version: '1.0.1', permissions: [...manifest().permissions, { id: 'courses', why: 'Names.' }] });
  more.ui.rail.push({ id: 'names', name: 'Names', blocks: clean([{ type: 'list', items: 'courses.names' }]) });
  const v2 = await M.pack(FILES(), more, k);
  const up = await M.change({ op: 'install', zip: std(v2.bytes), hash: v2.hash, grants: ['todo', 'grades', 'courses'], source: 'builder' }, { local }, { blocked: () => '' });
  assert.equal(up.ok, true);
  assert.equal(up.action, 'update');
  const again = await M.change({ op: 'install', zip: std(v2.bytes), hash: v2.hash, grants: ['todo', 'grades', 'courses'], source: 'builder' }, { local }, { blocked: () => '' });
  assert.deepEqual(again, { ok: false, error: 'refused', reason: 'same' });
  assert.deepEqual(await M.change({ op: 'install', zip: std(v2.bytes), hash: v2.hash, grants: [], source: 'elsewhere' }, { local }, { blocked: () => '' }), { ok: false, error: 'bad' });
});

test('next and course buttons declare and collect the to-do permission without another data block', async () => {
  for (const action of ['next', 'course']) {
    const blocks = clean([{ type: 'button', label: 'Open', action }]);
    assert.deepEqual(W.needs(blocks), ['todo']);
    const rec = widgetRec();
    rec.manifest.ui.tiles[0].blocks = blocks;
    const allowed = await ask(env({ record: rec }));
    assert.equal(allowed.tree.children[0].disabled, undefined);
    assert.ok(allowed.links.next);
    const denied = env({ record: { ...rec, grants: {} } });
    assert.equal((await ask(denied)).tree.children[0].disabled, true);
    assert.deepEqual(dataKeys(denied), []);
  }
  for (const action of ['dashboard', 'courses', 'grades', 'calendar']) assert.deepEqual(W.needs(clean([{ type: 'button', label: 'Go', action }])), []);
});

test('long placeholder expansions keep the widget within the component text limit', () => {
  const blocks = clean([{ type: 'text', text: '{next.title}'.repeat(8) }, { type: 'number', value: 'todo.count' }]);
  const r = W.resolve(blocks, { todo: [todo({ title: '😀'.repeat(300) })] }, { now: NOW });
  assert.ok(r.tree, 'long text must not discard every block');
  assert.equal([...r.tree.children[0].text].length, API.LIMIT.text);
  assert.ok(r.tree.children[0].text.endsWith('…'));
  assert.equal(r.tree.children[1].value, 1);
});

test('dev widgets resolve only while dev mode is on, matching the page list', async () => {
  const rec = widgetRec({ dev: true });
  assert.equal((await ask(env({ record: rec, local: { modDev: true } }))).ok, true);
  assert.deepEqual(await ask(env({ record: rec, local: { modDev: false } })), { ok: false, error: 'mod' });
});

test('widget revocation during a data read returns no stale data', async () => {
  const control = new AbortController();
  const e = { ...env(), signal: control.signal }, get = e.local.get;
  e.local.get = async (k) => { const v = await get.call(e.local, k); if (k === 'todoCache') control.abort(); return v; };
  assert.deepEqual(await ask(e), { ok: false, error: 'cancelled' });
});

test('builder provenance requires the local author and code-less blocks without a channel', async () => {
  const localKey = await author(), stranger = await M.makeKey();
  const local = area({ modAuthor: localKey, modDev: true });
  const install = async (got, extra = {}) => M.change({ op: 'install', zip: M.std(got.bytes), hash: got.hash, grants: [], source: 'builder', ...extra }, { local }, { blocked: () => '' });
  const m = { glaze: 1, name: 'Button', version: '1.0.0', author: { name: 'Kai' }, ui: { tiles: [{ id: 'main', name: 'Main', sizes: ['m'], blocks: [{ type: 'button', label: 'Courses', action: 'courses' }] }] } };
  assert.deepEqual(await install(await M.pack({}, m, stranger)), { ok: false, error: 'bad' });
  assert.deepEqual(await install(await M.pack({ 'hooks.js': enc.encode('void 0') }, { glaze: 1, name: 'Code', version: '1.0.0', author: { name: 'Kai' }, hooks: 'hooks.js' }, localKey)), { ok: false, error: 'bad' });
  const got = await M.pack({}, m, localKey);
  assert.deepEqual(await install(got, { channel: `https://share.example/j#1.r.${'A'.repeat(107)}` }), { ok: false, error: 'bad' });
  delete local.data.modAuthor;
  assert.deepEqual(await install(got), { ok: false, error: 'bad' });
  local.data.modAuthor = localKey;
  assert.equal((await install(got)).ok, true);
});

test('the API links the block format and documents the ring maximum correctly', () => {
  const fs = require('node:fs'), path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8');
  assert.match(read('mods-api.md'), /\]\(mods-widgets\.md\)/);
  assert.match(read('mods-widgets.md'), /non-positive maximum/);
});
