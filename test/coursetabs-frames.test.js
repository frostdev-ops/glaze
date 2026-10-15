// Course tabs' live frames (features/coursetabs.js): each picked tab runs as a page of its own in a frame named
// gz-ctab:<course>, hidden while another is shown; the strip in a frame sends its picks to the page around it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'features/coursetabs.js'), 'utf8');
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const origin = 'https://bb.school.test';

test('the bridge takes picks only from this page\'s own frames, on this origin, and only Ultra addresses to go to', () => {
  let listen;
  const mine = {}, theirs = {}, did = [];
  vm.runInNewContext(part("  if (!framed && !preview) addEventListener('message'", '  // Ultra routes without reloading'), {
    framed: '', preview: false, on: true, location: { origin }, addEventListener: (t, f) => { listen = f; },
    frames: new Map([['_2_1', { el: { contentWindow: mine } }]]), showing: '_2_1',
    visit: (c) => did.push(['visit', c]), shut: (c, k) => did.push(['shut', c, k]), later: () => did.push(['later']),
    drop: (c) => did.push(['drop', c]), show: (c) => did.push(['show', c]), route: (u) => did.push(['route', u]),
  });
  const post = (data, source = mine, from = origin) => listen({ data, source, origin: from });
  post({ gzCtab: 'visit', cid: '_3_1' }, theirs);
  post({ gzCtab: 'visit', cid: '_3_1' }, mine, 'https://other.test');
  post({ gzCtab: 'visit', cid: 'x' });
  post({ gzCtab: 'away', url: 'https://other.test/' });
  assert.deepEqual(did, [], 'another window, another origin, a malformed course or an address off Ultra do nothing');
  post({ gzCtab: 'visit', cid: '_3_1' });
  post({ gzCtab: 'shut', cid: '_3_1', keys: true });
  post({ gzCtab: 'moved' });
  post({ gzCtab: 'away', url: '/ultra/course' });
  assert.deepEqual(did, [['visit', '_3_1'], ['shut', '_3_1', true], ['later'], ['drop', '_2_1'], ['show', ''], ['route', '/ultra/course']]);
});

test('a pick in a tab\'s frame goes to the page around it; on the page, its own course shows the page itself', () => {
  const sent = [], shown = [];
  const run = (framed, courseId) => vm.runInNewContext(part('  const visit = (cid) => {', "  if (!framed && !preview) addEventListener('message'") + '\nvisit;', {
    framed, preview: false, tabs: [{ cid: '_1_1' }, { cid: '_2_1' }], save() {}, Date,
    toTop: (op, m) => sent.push([op, m.cid]), show: (c) => shown.push(c), ctx: { courseId: () => courseId },
  });
  run('_2_1', '_2_1')('_1_1');
  assert.deepEqual(sent, [['visit', '_1_1']]);
  assert.deepEqual(shown, []);
  const visit = run('', '_1_1');
  visit('_2_1'); visit('_1_1'); visit('_9_1');
  assert.deepEqual(shown, ['_2_1', ''], 'another course: its frame; this page\'s course: this page; no tab: nothing');
});

test('at most four frames stay running: the least recently shown go, never the one shown', async () => {
  const frame = (at) => ({ at, ready: true, el: { style: {}, inert: false, focus() {} } });
  const frames = new Map([['_1_1', frame(1)], ['_2_1', frame(5)], ['_3_1', frame(3)], ['_4_1', frame(4)], ['_5_1', frame(2)]]);
  const dropped = [];
  const show = vm.runInNewContext(part('  const show = async (cid) => {', '  // A tab: its frame') + '\nshow;', {
    showTurn: 0, showing: '_2_1', shownFrom: '', shooting: null, on: true, frames, host: { toggleAttribute() {} }, strip: null, list: null,
    LIVE: 4, Date, Promise, setTimeout, location: { pathname: '/ultra/course', search: '' }, document: { activeElement: null },
    html: { toggleAttribute() {} }, ctx: { scene() {} }, sessionStorage: { setItem() {}, removeItem() {} },
    open: () => null, lay() {}, unpicture() {}, picture() {}, draw() {}, later() {}, drop: (k) => { dropped.push(k); frames.delete(k); },
  });
  await show('_3_1');
  assert.deepEqual(dropped, ['_1_1'], 'five frames, four kept: the one shown longest ago goes');
  assert.deepEqual([...frames.keys()].sort(), ['_2_1', '_3_1', '_4_1', '_5_1']);
  assert.equal(frames.get('_3_1').el.style.visibility, '', 'the shown frame is visible');
  assert.equal(frames.get('_2_1').el.style.visibility, 'hidden');
  assert.equal(frames.get('_2_1').el.inert, true, 'a hidden frame takes no input');
});

test('the worker takes a course tab\'s frame as its Ultra page: its origin stands in for the about:blank it reports', () => {
  const bg = fs.readFileSync(path.join(__dirname, '..', 'lib/background.js'), 'utf8');
  const block = bg.slice(bg.indexOf('const addressOf = '), bg.indexOf('const fromUltra = '));
  const { ultraAt, ultraPage } = vm.runInNewContext(`${block}\n({ ultraAt, ultraPage });`, { chrome: { runtime: { id: 'glaze' } }, URL });
  const tab = { id: 1, url: `${origin}/ultra/courses/_1_1/outline` };
  const frame = { id: 'glaze', tab, frameId: 7, url: 'about:blank', origin };
  assert.equal(ultraAt(frame), origin);
  assert.equal(ultraPage(frame), true);
  assert.equal(ultraAt({ ...frame, origin: 'https://other.test' }), null, 'a frame of another origin is not this tab\'s page');
  assert.equal(ultraPage({ ...frame, origin: 'https://other.test' }), false);
  assert.equal(ultraAt({ ...frame, origin: 'null' }), null, 'an opaque frame never stands in');
  assert.equal(ultraAt({ id: 'glaze', tab, frameId: 0, url: 'about:blank', origin }), null, 'the top frame is taken by its own address');
  assert.equal(ultraPage({ id: 'glaze', tab: { id: 1, url: 'https://other.test/x' }, frameId: 7, url: `${origin}/ultra/course`, origin }), false, 'an Ultra frame in another site\'s tab is not its page');
});
