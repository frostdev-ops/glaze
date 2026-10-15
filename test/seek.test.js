const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../lib/seek.js');

const NOW = Date.parse('2026-10-15T12:00:00Z');
const term = (start_at, end_at) => ({ start_at, end_at });
const later = () => { let resolve, reject; const p = new Promise((y, n) => { resolve = y; reject = n; }); return Object.assign(p, { resolve, reject }); };
const settle = () => new Promise(setImmediate);

test('nothing is asked under 2 characters; the term is trimmed and capped', () => {
  assert.equal(S.term(' a '), '');
  assert.equal(S.term(''), '');
  assert.equal(S.term('  lab   report '), 'lab report');
  assert.equal(S.term('x'.repeat(300)).length, 100);
});

test('the course you are in first, then this term\'s, then the rest; never a course without a numeric id', () => {
  const courses = [
    { id: '1', course_code: 'OLD 100', term: term('2025-01-01T00:00:00Z', '2025-05-01T00:00:00Z') },
    { id: '2', course_code: 'BIO 1100', term: term('2026-08-19T00:00:00Z', '2026-12-09T00:00:00Z') },
    { id: '3', name: 'Advising', term: { name: 'Default Term', start_at: null, end_at: null } },
    { id: '4', course_code: 'NEXT 200', term: term('2027-01-10T00:00:00Z', null) },
    { id: '5', course_code: 'HIST 2010', term: term('2026-08-19T00:00:00Z', '2026-12-09T00:00:00Z') },
    { id: '../x', course_code: 'BAD' },
  ];
  const o = S.order(courses, '5', NOW);
  assert.deepEqual(o.map((c) => c.id), ['5', '2', '3', '1', '4']);
  assert.equal(o[2].name, 'Advising', 'a course without a code goes by its name');
});

test('best titles first: whole, start, word start, anywhere; ties keep Canvas\'s order; accents and case don\'t matter', () => {
  const r = S.rank('Lab', [{ title: 'Collaboration' }, { title: 'Week 2: lab safety' }, { title: 'Labs overview' }, { title: 'lab' }, { title: 'Vocabulary' }, { title: 'Week 3: lab' }]);
  assert.deepEqual(r.map((x) => x.title), ['lab', 'Labs overview', 'Week 2: lab safety', 'Week 3: lab', 'Collaboration', 'Vocabulary']);
  assert.equal(S.rank('resume', [{ title: 'Zzz' }, { title: 'Résumé tips' }])[0].title, 'Résumé tips');
});

test('each kind reads Canvas\'s answer into results that open this Canvas only, by id', () => {
  const c = { id: '25', name: 'BIO 1100' };
  const kind = (k) => S.KINDS.find((x) => x.kind === k);
  assert.deepEqual(S.read(kind('Page'), [{ page_id: '56', url: 'reading-the-cell-membrane', title: 'Reading: the cell membrane', html_url: 'https://elsewhere.example/x' }], c),
    [{ key: '25/page:56', title: 'Reading: the cell membrane', url: '/courses/25/pages/reading-the-cell-membrane', kind: 'Page', course: 'BIO 1100' }]);
  assert.deepEqual(S.read(kind('File'), [{ id: '21', display_name: 'Syllabus.pdf', url: 'https://x/files/21/download?verifier=secret' }], c)[0].url, '/courses/25/files/21');
  assert.equal(S.read(kind('Module'), [{ id: '74', name: 'Unit 1' }], c)[0].url, '/courses/25/modules/74');
  assert.equal(S.read(kind('Announcement'), [{ id: '55', title: 'Lab moved' }], c)[0].url, '/courses/25/discussion_topics/55');
  // A graded discussion is the same thing as its assignment.
  assert.equal(S.read(kind('Assignment'), [{ id: '9', name: 'Debate', discussion_topic: { id: '40' } }], c)[0].key, '25/topic:40');
  assert.equal(S.read(kind('Discussion'), [{ id: '40', title: 'Debate' }], c)[0].key, '25/topic:40');
  // Junk is dropped: no id, an odd id, no title, not a list.
  assert.deepEqual(S.read(kind('Assignment'), [null, { name: 'x' }, { id: '1/../2', name: 'x' }, { id: '3', name: '  ' }, { id: '4' }], c), []);
  assert.deepEqual(S.read(kind('Page'), { errors: [] }, c), []);
});

test('the cache keeps answers five minutes, the newest few hundred, in memory', () => {
  let now = 0;
  const c = S.cache(300000, 3, () => now);
  c.set('a', [1]);
  now = 299999;
  assert.deepEqual(c.get('a'), [1]);
  now = 300000;
  assert.equal(c.get('a'), undefined, 'stale');
  assert.equal(c.size, 0, 'and dropped');
  for (const k of ['a', 'b', 'c', 'd']) c.set(k, k);
  assert.equal(c.size, 3);
  assert.equal(c.get('a'), undefined, 'the oldest went first');
  assert.equal(c.get('d'), 'd');
});

// A Canvas that answers each list when the test says, or straight away.
const canvas = (answer = () => []) => {
  const asked = [];
  let open = 0, most = 0;
  const get = async (p) => {
    asked.push(p);
    most = Math.max(most, ++open);
    try { await settle(); return await answer(p); } finally { open--; }
  };
  return { get, asked, most: () => most };
};
const course = (id) => ({ id, name: `C${id}` });

test('every course is asked for every kind, this course first, a few requests at a time, each kind arriving best first', async () => {
  const cv = canvas((p) => (p.includes('/pages?') ? [{ page_id: '1', url: 'a', title: 'Intro to lab' }, { page_id: '2', url: 'b', title: 'Lab' }] : []));
  const got = [];
  const n = await S.search({ term: 'lab', courses: [course('5'), course('2')], get: cv.get, cache: S.cache(), onBatch: (rs) => got.push(rs), conc: 3 });
  assert.equal(cv.asked.length, 12, 'six kinds in two courses');
  assert.ok(cv.most() <= 3);
  assert.ok(cv.asked.slice(0, 6).every((p) => p.startsWith('/courses/5/')), 'this course first');
  assert.equal(cv.asked[0], '/courses/5/pages?search_term=lab&per_page=10');
  assert.ok(cv.asked.includes('/courses/5/discussion_topics?search_term=lab&per_page=10&only_announcements=true'));
  assert.equal(n, 4);
  assert.deepEqual(got.map((b) => b.map((r) => `${r.course} ${r.title}`)), [['C5 Lab', 'C5 Intro to lab'], ['C2 Lab', 'C2 Intro to lab']]);
});

test('the term is sent encoded, and at most four results come from one course\'s kind', async () => {
  const cv = canvas((p) => (p.includes('/files?') ? Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), display_name: `notes ${i}.pdf` })) : []));
  const got = [];
  await S.search({ term: 'a&b=c #1', courses: [course('7')], get: cv.get, onBatch: (rs) => got.push(...rs) });
  assert.ok(cv.asked[0].includes('search_term=a%26b%3Dc%20%231&'));
  assert.equal(got.length, S.PER);
});

test('a thing found twice (a graded discussion) is given once', async () => {
  const cv = canvas((p) => (p.includes('/assignments?') ? [{ id: '9', name: 'Debate', discussion_topic: { id: '40' } }]
    : p.includes('/discussion_topics?') && !p.includes('announcements') ? [{ id: '40', title: 'Debate' }] : []));
  const got = [];
  assert.equal(await S.search({ term: 'debate', courses: [course('1')], get: cv.get, onBatch: (rs) => got.push(...rs), conc: 1 }), 1);
  assert.deepEqual(got.map((r) => r.kind), ['Assignment']);
});

test('once enough is found nothing more is asked, in this term or any other, and nothing past it is given', async () => {
  // Six courses this term, every kind with matches: before, all 36 lists were asked and 144 results given.
  const four = (p) => Array.from({ length: 4 }, (_, i) => ({ id: String(i + 1), page_id: String(i + 1), url: `p${i}`, name: `week ${i}`, title: `week ${i}`, display_name: `week ${i}` }));
  const cv = canvas(four);
  const got = [];
  const courses = ['1', '2', '3', '4', '5', '6'].map((id) => course(id));
  const n = await S.search({ term: 'week', courses, get: cv.get, onBatch: (rs) => got.push(...rs) });
  assert.equal(n, 24);
  assert.equal(got.length, 24, 'never past the limit');
  assert.ok(cv.asked.length <= 6 + 6, `${cv.asked.length} lists asked: the first course, and one more round already going`);
  assert.deepEqual([...new Set(got.map((r) => r.course))], ['C1', 'C2'], 'the first courses in order fill it (C1 has 20: its announcements are its discussions here)');
  // Answers already on their way when the limit is reached are cut to fit.
  const cut = [];
  assert.equal(await S.search({ term: 'week', courses, get: canvas(four).get, onBatch: (rs) => cut.push(...rs), limit: 10, conc: 4 }), 10);
  assert.equal(cut.length, 10);
});

test('results come in priority order, not arrival: a slow answer from the course you\'re in still comes first and isn\'t crowded out', async () => {
  const waiting = [];
  const get = (p) => { const r = later(); waiting.push({ p, r }); return r; };
  const got = [];
  const answer = (pred, n) => { for (const w of waiting.filter((x) => !x.done && pred(x.p))) { w.done = true; w.r.resolve(Array.from({ length: n }, (_, i) => ({ page_id: String(i + 1), id: String(i + 1), url: `p${i}`, title: `lab ${i}`, name: `lab ${i}`, display_name: `lab ${i}` }))); } };
  const done = S.search({ term: 'lab', courses: ['1', '2', '3', '4'].map((id) => course(id)), get, onBatch: (rs) => got.push(...rs), limit: 8, conc: 6 });
  // Course 1's pages are slow; everything else answers at once, with plenty.
  for (let round = 0; round < 6; round++) { answer((p) => !p.startsWith('/courses/1/pages'), 4); await settle(); }
  assert.equal(got.length, 0, 'nothing is given while the first answer is still out');
  answer(() => true, 4);
  await settle();
  for (let round = 0; round < 6; round++) { answer(() => true, 4); await settle(); }
  assert.equal(await done, 8);
  assert.deepEqual(got.slice(0, 4).map((r) => `${r.course} ${r.kind}`), Array(4).fill('C1 Page'), 'the first course\'s pages first');
  assert.equal(got.length, 8);
});

test('a kind that fails (files hidden from students) is skipped, and not kept', async () => {
  const kept = S.cache();
  const cv = canvas((p) => { if (p.includes('/files?')) throw new Error('401'); return p.includes('/modules?') ? [{ id: '3', name: 'Unit 3' }] : []; });
  const got = [];
  assert.equal(await S.search({ term: 'unit', courses: [course('1')], get: cv.get, cache: kept, onBatch: (rs) => got.push(...rs) }), 1);
  assert.equal(got[0].title, 'Unit 3');
  assert.equal(kept.size, 5, 'five answers kept, the failure not');
});

test('a second search for the same term in five minutes asks Canvas nothing', async () => {
  const kept = S.cache();
  const cv = canvas((p) => (p.includes('/pages?') ? [{ page_id: '1', url: 'a', title: 'Syllabus' }] : []));
  const first = [], second = [];
  await S.search({ term: 'Syll', courses: [course('1')], get: cv.get, cache: kept, onBatch: (rs) => first.push(...rs) });
  const asked = cv.asked.length;
  await S.search({ term: 'syll', courses: [course('1')], get: cv.get, cache: kept, onBatch: (rs) => second.push(...rs) });
  assert.equal(cv.asked.length, asked, 'the case of the term is the same search');
  assert.deepEqual(second, first);
});

test('an abort stops it: nothing more is asked, nothing more is given, and nothing half-done is kept', async () => {
  const kept = S.cache();
  const ctl = new AbortController();
  const waiting = [];
  const get = (p) => { const r = later(); waiting.push({ p, r }); return r; };
  const got = [];
  const done = S.search({ term: 'lab', courses: [course('1'), course('2')], get, cache: kept, signal: ctl.signal, onBatch: (rs) => got.push(rs), conc: 2 });
  assert.equal(waiting.length, 2);
  ctl.abort();
  waiting[0].r.resolve([{ page_id: '1', url: 'a', title: 'Lab' }]);
  waiting[1].r.reject(new DOMException('aborted', 'AbortError'));
  assert.equal(await done, 0);
  assert.equal(waiting.length, 2, 'nothing more asked');
  assert.deepEqual(got, []);
  assert.equal(kept.size, 1, 'only the answer that did arrive whole');
});

// features/search.js in the palette, with a stand-in page: typing, the pause, cancelling, the order things arrive in.
// `stored` is storage.sync as the attach reads it; `loading` holds lib/seek.js back; `cmd` and `show` can be content.js's own.
const palette = ({ stored = {}, loading = null, cmd = { input: { value: '' }, list: {}, shown: [] }, show = null } = {}) => {
  const timers = [];
  const listeners = {};
  const live = { className: '', textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  Object.assign(cmd, { box: { isConnected: true } });
  cmd.input.addEventListener = (e, f) => { listeners[e] = f; };
  cmd.list.after = (x) => { cmd.live = x; };
  const shows = [];
  const requests = [];
  const settings = { enhance: { search: true } };
  const changed = [];
  const ctx = vm.createContext({
    chrome: { runtime: {}, storage: { onChanged: { addListener: (f) => changed.push(f) }, sync: { get: (keys, f) => setImmediate(() => f(stored)) } } },
    GZ_CTX: {
      on: () => true, settings: () => settings,
      t: (k, v) => k.replace('{n}', v?.n), need: () => loading || Promise.resolve(), canvasCourseId: () => '2',
      canvasCourses: () => Promise.resolve([{ id: '1', course_code: 'ENG', term: {} }, { id: '2', course_code: 'BIO', term: {} }]),
    },
    document: { createElement: () => live },
    location: { origin: 'https://canvas.test', assign() {} },
    fetch: (url, o) => {
      const r = later();
      requests.push({ url, signal: o.signal, r });
      o.signal.addEventListener('abort', () => r.reject(new DOMException('aborted', 'AbortError')));
      return r;
    },
    setTimeout: (f, ms) => { const x = { f, ms }; timers.push(x); return x; }, clearTimeout: (x) => { if (x) x.f = null; },
    AbortController, DOMException, Promise, URL, Date, setImmediate,
  });
  vm.runInContext('globalThis.globalThis = this;', ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/seek.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../features/search.js'), 'utf8'), ctx);
  const type = (v) => { cmd.input.value = v; listeners.input(); };
  const tick = () => { const due = timers.splice(0); for (const x of due) x.f?.(); };
  const answer = (pred, body) => { for (const q of requests.filter((x) => !x.done && pred(x.url))) { q.done = true; q.r.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(body)) }); } };
  const answerAll = (body = []) => answer(() => true, body);
  const change = (ch) => { for (const f of changed) f(ch, 'sync'); };
  return { ctx, cmd, shows, requests, type, tick, answer, answerAll, timers, settings, change, attach: () => ctx.GZ_SEARCH.attach(cmd, (keep) => { shows.push(keep === true ? 'keep' : 'reset'); show?.(keep); }) };
};
const pump = async (p, rounds = 10) => { for (let i = 0; i < rounds; i++) { p.answerAll(); await settle(); } };

test('palette: nothing is asked under 2 characters, nor before the pause; what was typed while it loaded counts', async () => {
  const p = palette();
  p.cmd.input.value = 'la';
  await p.attach();
  assert.equal(p.cmd.seeking, true, 'the searching row is up at once');
  assert.equal(p.cmd.found.length, 0);
  assert.equal(p.requests.length, 0);
  assert.equal(p.timers[0].ms, 150);
  p.type('l');
  assert.equal(p.cmd.found, null, 'one character: no content search');
  assert.equal(p.cmd.seeking, false);
  p.tick();
  await settle();
  assert.equal(p.requests.length, 0);
});

test('palette: each keystroke cancels what was being asked, and old answers never show', async () => {
  const p = palette();
  await p.attach();
  p.type('la');
  p.tick();
  await settle();
  await settle();
  const first = p.requests.slice();
  assert.ok(first.length > 0 && first.length <= 6);
  assert.ok(first[0].url.startsWith('https://canvas.test/api/v1/courses/2/'), 'this course first');
  p.type('lab');
  assert.ok(first.every((q) => q.signal.aborted), 'cancelled on the keystroke');
  assert.equal(p.cmd.found.length, 0);
  p.answer(() => true, [{ page_id: '1', url: 'a', title: 'Lab (old)' }]);
  await settle();
  assert.equal(p.cmd.found.length, 0, 'nothing from the old term');
  p.tick();
  await settle();
  await settle();
  p.answer((u) => u.includes('/courses/2/pages?search_term=lab&'), [{ page_id: '1', url: 'a', title: 'Lab safety' }]);
  await pump(p);
  assert.equal(JSON.stringify(p.cmd.found.map((c) => [c.label, c.group, c.hint])), JSON.stringify([['Lab safety', 'Page', 'BIO']]));
  assert.equal(p.cmd.seeking, false);
  assert.equal(p.cmd.live.textContent, 'Results from your courses: 1');
  assert.equal(p.cmd.live.attrs['aria-live'], 'polite');
  assert.ok(p.shows.includes('keep'), 'arrivals keep the choice where it is');
});

test('palette: nothing found is said, and closing cancels', async () => {
  const p = palette();
  await p.attach();
  p.type('zz');
  p.tick();
  await pump(p, 20);
  assert.equal(p.cmd.live.textContent, 'Nothing found in your courses.');
  p.type('zzz');
  p.tick();
  await settle();
  await settle();
  const out = p.requests.filter((q) => !q.done);
  assert.ok(out.length);
  p.cmd.stop();
  assert.ok(out.every((q) => q.signal.aborted));
});

test('palette: turned off while it is open, nothing more is asked, and what was running stops', async () => {
  const p = palette();
  await p.attach();
  p.type('la');
  p.tick();
  await settle();
  await settle();
  const out = p.requests.slice();
  assert.ok(out.length);
  // The popup or the editor turns it off: storage says so before content.js's own copy of the settings does.
  p.change({ enhance: { newValue: { search: false }, oldValue: { search: true } } });
  assert.ok(out.every((q) => q.signal.aborted), 'in flight, cancelled');
  assert.equal(p.cmd.found, null);
  assert.equal(p.cmd.seeking, false);
  // content.js's settings still say on (stale): typing asks for nothing all the same.
  p.type('lab');
  p.tick();
  await settle();
  await settle();
  assert.equal(p.requests.length, out.length, 'no new requests');
  assert.equal(p.cmd.found, null);
  // Off between the keystroke and the pause: the search doesn't start.
  p.change({ enhance: { newValue: { search: true } } });
  p.type('labs');
  p.change({ enabled: { newValue: false } });
  p.tick();
  await settle();
  await settle();
  assert.equal(p.requests.length, out.length);
  assert.equal(p.cmd.seeking, false);
  // Back on: searching again.
  p.change({ enabled: { newValue: true } });
  p.type('lab report');
  p.tick();
  await settle();
  await settle();
  assert.ok(p.requests.length > out.length);
});

test('palette: turned off while the search code is still loading, or before it loaded at all, it never starts', async () => {
  // The change comes while lib/seek.js loads; content.js's settings haven't caught up (still on).
  const loading = later();
  const p = palette({ loading, stored: { enhance: { search: true } } });
  p.cmd.input.value = 'lab';
  const attached = p.attach();
  p.change({ enhance: { newValue: { search: false } } });
  loading.resolve();
  await attached;
  p.tick();
  for (let i = 0; i < 4; i++) await settle();
  assert.equal(p.requests.length, 0);
  assert.ok(!p.cmd.found);
  // Turned off before this file was even here: storage, read on attach, says so.
  const q = palette({ stored: { enhance: { search: false } } });
  q.cmd.input.value = 'lab';
  await q.attach();
  q.tick();
  for (let i = 0; i < 4; i++) await settle();
  assert.equal(q.requests.length, 0);
  assert.ok(!q.cmd.found);
});

// content.js's palette list (showCmd), sliced from the source with a stand-in DOM: where search results go.
const rows = () => {
  const src = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
  const a = src.indexOf('  let cmd = null; // {'), b = src.indexOf('  const openCmd = () => {', a);
  assert.ok(a > 0 && b > a, 'palette markers');
  const el = () => ({
    children: [], attrs: {}, id: '', textContent: '', className: '',
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener() {}, scrollIntoView() {},
    append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; },
    insertBefore(c, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); },
    querySelector(sel) { return sel === '[aria-selected="true"]' ? this.children.find((c) => c.attrs['aria-selected'] === 'true') || null : null; },
  });
  const ctx = vm.createContext({ document: { createElement: el }, GZ_PAGE: require('../lib/page.js'), t: (k) => k });
  vm.runInContext(`${src.slice(a, b)}; globalThis.api = { showCmd, set: (c) => { cmd = c; } };`, ctx);
  const cmd = { input: el(), list: el(), all: [], shown: [], active: 0 };
  ctx.api.set(cmd);
  const text = () => cmd.list.children.map((li) => li.children[0]?.textContent ?? `(${li.textContent})`);
  return { cmd, show: ctx.api.showCmd, text };
};
const cmdOf = (label, group = 'Glaze', hint = 'Glaze') => ({ label, hint, group, run() {} });

test('palette: search results arrive below what is shown, so no row moves under a still pointer; loose matches come after', () => {
  const p = rows();
  p.cmd.all = [cmdOf('Unit 2 quiz', 'Due this week', 'tomorrow'), cmdOf('Turn on grade point average'), cmdOf('Turn off what-if calculator')];
  p.cmd.input.value = 'unit';
  p.cmd.found = [];
  p.cmd.seeking = true;
  p.show();
  assert.deepEqual(p.text(), ['Unit 2 quiz', '(Searching your courses…)']);
  // Three arrivals: each lands below the rows already there.
  for (const label of ['Unit 1: Cells', 'Unit 2: Energy', 'Unit 1 quiz']) {
    const was = p.text().filter((x) => !x.startsWith('('));
    p.cmd.found.push(cmdOf(label, 'Module', 'BIO 1100'));
    p.show(true);
    assert.deepEqual(p.text().slice(0, was.length), was, `rows kept their places when ${label} came`);
  }
  // Done: the looser matches join at the end.
  p.cmd.seeking = false;
  p.show(true);
  assert.deepEqual(p.text().slice(0, 4), ['Unit 2 quiz', 'Unit 1: Cells', 'Unit 2: Energy', 'Unit 1 quiz']);
  assert.ok(p.text().length > 4 && p.text().slice(4).every((x) => x.startsWith('Turn')), 'loose matches last');
});

test('palette: the keyboard choice stays on the same item as results arrive', () => {
  const p = rows();
  p.cmd.all = [cmdOf('Lab safety rules'), cmdOf('Lab notes')];
  p.cmd.input.value = 'lab';
  p.cmd.found = [];
  p.cmd.seeking = true;
  p.show();
  p.cmd.active = 1;
  const chosen = p.cmd.shown[1].label;
  p.cmd.found.push(cmdOf('Lab report 1', 'Assignment', 'BIO 1100'));
  p.show(true);
  assert.equal(p.cmd.shown[p.cmd.active].label, chosen);
  assert.equal(p.cmd.list.children[p.cmd.active].attrs['aria-selected'], 'true');
});

test('palette: when search starts on a query typed while it loaded, the rows on screen stay put and "Searching…" goes below them', async () => {
  const r = rows();
  r.cmd.all = [cmdOf('Lab local'), cmdOf('Learning about biology')];
  r.cmd.input.value = 'lab';
  r.show();
  const before = r.text();
  assert.deepEqual(before, ['Lab local', 'Learning about biology'], 'a loose match is on screen');
  const p = palette({ cmd: r.cmd, show: r.show });
  await p.attach();
  assert.deepEqual(r.text(), [...before, '(Searching your courses…)']);
  p.tick();
  for (let i = 0; i < 3; i++) await settle();
  p.answer((u) => u.includes('/courses/2/pages?'), [{ page_id: '9', url: 'x', title: 'Lab report' }]);
  await pump(p, 20);
  assert.deepEqual(r.text().slice(0, 3), [...before, 'Lab report'], 'arrivals below, nothing above moved');
});
