// WP-A1: Glaze never hammers a school's LMS. Ultra's gradebook and content fan-outs and Canvas's module reads go through
// one queue per site (lib/lmsq.js: three at a time, a 429's Retry-After waited out, a 401 refused until the page
// changes), failures are asked again a minute later at most, and list reads follow paging to the end or say they didn't.
// The real content-ultra.js, content-canvas.js and features/download.js in a VM, against a fake school and a fake clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.GZ_A1_ROOT || path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://bb.test';

// A clock the page's timers follow: tick(ms) moves it and runs what fell due.
const clock = () => {
  const c = { now: 1e12, timers: [] };
  c.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [c.now])); } static now() { return c.now; } };
  c.setTimeout = (f, ms = 0) => { c.timers.push({ at: c.now + ms, f }); return c.timers.length; };
  c.tick = async (ms) => {
    c.now += ms;
    for (let due; (due = c.timers.filter((x) => x.at <= c.now)).length;) { c.timers = c.timers.filter((x) => !due.includes(x)); for (const x of due) x.f(); await settle(); }
    await settle();
  };
  return c;
};

// A school: answer(url) → [status, body, headers], or a promise of it (held). Every request is counted, and how many
// were open at once.
const school = (answer) => {
  const s = { asked: [], open: 0, peak: 0 };
  s.fetch = async (url) => {
    const u = new URL(url);
    s.asked.push(u.pathname + u.search);
    s.open += 1; s.peak = Math.max(s.peak, s.open);
    try {
      const [status, body, headers] = await answer(u);
      return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers });
    } finally { s.open -= 1; }
  };
  s.count = (re) => s.asked.filter((p) => re.test(p)).length;
  return s;
};

// The Ultra part as content.js calls it: its api() is content.js's (same origin, the student's session); need() puts a
// loadable file in as lib/background.js would.
const ultra = ({ answer, pathname = '/ultra/courses/_1_1/outline', local = {}, cards = [], rows = [], enhance = {} }) => {
  const c = clock(), s = school(answer);
  const El = class { constructor() { this.attrs = new Map(); this.dataset = {}; } setAttribute(k, v) { this.attrs.set(k, String(v)); } getAttribute(k) { return this.attrs.get(k) ?? null; } hasAttribute(k) { return this.attrs.has(k); } removeAttribute(k) { this.attrs.delete(k); } querySelector() { return null; } querySelectorAll() { return []; } addEventListener() {} append() {} };
  const html = new El();
  const document = { documentElement: html, body: new El(), contentType: 'text/html', querySelector: () => null, getElementById: () => null, addEventListener() {},
    querySelectorAll: (sel) => (sel === 'article' ? cards : sel.startsWith('.content-list-item') ? rows : []), createTreeWalker: () => ({ nextNode: () => null }), createElement: () => new El() };
  const location = { origin: ORIGIN, protocol: 'https:', hostname: 'bb.test', port: '', pathname, href: ORIGIN + pathname };
  const ctx = vm.createContext({
    document, location, console, Promise, Date: c.Date, setTimeout: c.setTimeout, clearTimeout() {}, queueMicrotask, JSON, Map, Set, Object, Array, String, Number, RegExp, Math, Intl,
    URL, URLSearchParams, Response, fetch: s.fetch, structuredClone,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    addEventListener() {}, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: { runtime: { id: 'x' }, storage: { local: { get: (k, cb) => cb(structuredClone(local)), set: (o) => Object.assign(local, o) }, onChanged: { addListener() {} } } },
    GZ_GRADES: require(path.join(root, 'lib/grades.js')), GZ_PAGE: require(path.join(root, 'lib/page.js')), GZ_COURSES: require(path.join(root, 'defaults.js')).GZ_COURSES,
  });
  ctx.globalThis = ctx; ctx.window = ctx; ctx.top = ctx;
  vm.runInContext(read('content-ultra.js'), ctx);
  const need = (file, ready) => {
    try { if (!ready()) vm.runInContext(read(file), ctx); } catch (e) { return Promise.reject(e); }
    return ready() ? Promise.resolve() : Promise.reject(new Error('not ready'));
  };
  const api = (p, base = '/learn/api/v1') => s.fetch(`${ORIGIN}${base}${p}`).then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((t) => JSON.parse(t));
  const badges = [];
  const inView = new Set(cards.filter((x) => x.seen).map((x) => x.el));
  const I = { C: {}, html, isPreview: false, solo: true, tabFrame: '', need, t: (x) => x, locale: () => 'en', api,
    courseId: () => location.pathname.match(/\/ultra\/courses\/(_\d+_\d+)\//)?.[1], markDue() {}, drawProgress() {}, cardBadge: (el, id, n, kind = 'grades') => badges.push([id, n, kind]),
    cardsInView: { observe() {}, unobserve() {} }, inView, tagCards() {}, tagExtras() {}, courseSlots: {}, courseColors: () => ({}), varText: () => '', CARD: 'article', dueLabelled: () => false,
    links: [1], settings: { enabled: true, enhance: { inline: true, progress: true, newgrades: false, newcontent: false, ...enhance }, nav: { brand: 'x' }, courses: { names: {}, tint: false, tinted: [] }, sidebar: {} },
    observer: {}, worn: { nav: {} }, courseList: {} };
  return { X: ctx.GZ_SITE_ULTRA(I), s, c, location, badges, local, I };
};
// A course card on the Courses page, on screen or not.
const card = (cid, seen = true) => { const el = { isConnected: true }; return { id: `course-element-card${cid}`, el, seen, querySelector: (sel) => (sel.startsWith('h4') ? el : null) }; };
const ME = [200, { id: '_9_1' }];

test('ULT-1: a failing gradebook is asked once a minute, however many passes ask for it', async () => {
  for (const status of [403, 500]) {
    const u = ultra({ answer: (r) => (/users\/me$/.test(r.pathname) ? ME : /memberships/.test(r.pathname) ? [200, { results: [] }] : [status, {}]) });
    for (let i = 0; i < 20; i++) { u.X.ctx.bookFor('_1_1', true); await u.c.tick(100); }
    assert.equal(u.s.count(/gradebook\/grades/), 1, `${status}: 20 passes in two seconds send one request`);
    await u.c.tick(60000);
    u.X.ctx.bookFor('_1_1', true); await settle();
    assert.equal(u.s.count(/gradebook\/grades/), 2, `${status}: a minute later it is asked again`);
  }
});

test('ULT-1: a failing /users/me is asked once a minute', async () => {
  const u = ultra({ answer: () => [500, {}] });
  for (let i = 0; i < 20; i++) { u.X.ctx.me().catch(() => {}); u.X.ctx.bookFor('_1_1', true); await u.c.tick(100); }
  assert.equal(u.s.count(/users\/me$/), 1);
  await u.c.tick(60000);
  await u.X.ctx.me().catch(() => {});
  assert.equal(u.s.count(/users\/me$/), 2);
});

test('ULT-1: a 401 stops the gradebook until the page changes', async () => {
  const u = ultra({ answer: (r) => (/users\/me$/.test(r.pathname) ? ME : [401, {}]) });
  u.X.ctx.bookFor('_1_1', true); await settle();
  for (let i = 0; i < 20; i++) { u.X.ctx.bookFor('_1_1', true); u.X.ctx.bookFor('_2_1'); await u.c.tick(10000); }
  assert.equal(u.s.count(/gradebook\/grades/), 1, 'one 401, then nothing asked on this page, for any course, even minutes later');
  u.location.pathname = '/ultra/courses/_1_1/grades';
  u.X.ctx.bookFor('_1_1', true); await settle();
  assert.equal(u.s.count(/gradebook\/grades/), 2, 'another page may ask again');
});

test('ULT-1: a 429 with Retry-After holds the next request to the school until it has passed', async () => {
  const u = ultra({ answer: (r) => (/users\/me$/.test(r.pathname) ? ME : /_1_1/.test(r.pathname) ? [429, {}, { 'Retry-After': '30' }] : [200, { results: [] }]) });
  u.X.ctx.bookFor('_1_1'); await settle();
  u.X.ctx.bookFor('_2_1'); await settle();
  assert.equal(u.s.count(/_2_1\/gradebook/), 0, 'held while the school asked for 30 s');
  await u.c.tick(29000);
  assert.equal(u.s.count(/_2_1\/gradebook/), 0);
  await u.c.tick(1000);
  assert.equal(u.s.count(/_2_1\/gradebook/), 1, 'then sent');
  assert.equal(u.X.ctx.bookFor('_2_1').results.length, 0);
});

test('ULT-5: eight courses never have more than three requests open at once, and only cards on screen ask', async () => {
  const held = [];
  const answer = (r) => (/users\/me$/.test(r.pathname) ? ME : new Promise((done) => held.push(() => done([200, { results: [] }]))));
  const ids = Array.from({ length: 8 }, (_, i) => `_${i + 1}_1`);
  const u = ultra({ answer });
  for (const id of ids) { u.X.ctx.bookFor(id); u.X.ctx.courseItems(id); }
  await settle();
  for (let guard = 0; held.length && guard < 40; guard++) { assert.ok(u.s.open <= 3, `${u.s.open} open`); held.shift()(); await settle(); }
  assert.equal(u.s.peak, 3, 'three at a time');
  assert.equal(u.s.count(/gradebook\/grades/), 8, 'every course is still asked, in turn');
  assert.equal(u.s.count(/\/contents\?/), 8);
  // The Courses page: three of eight cards on screen.
  const page = ultra({ answer: (r) => (/users\/me$/.test(r.pathname) ? ME : [200, { results: [] }]), pathname: '/ultra/course', enhance: { newgrades: true },
    cards: ids.map((id, i) => card(id, i < 3)) });
  page.X.renderNew(); await settle(); page.X.renderNew(); await settle();
  assert.deepEqual(page.s.asked.filter((p) => /gradebook/.test(p)).map((p) => p.split('/')[5]), ids.slice(0, 3), 'the cards on screen, none off it');
});

// lib/lmsq.js alone: its queue's order and its holds.
const lmsq = (answer) => {
  const c = clock(), s = school(answer);
  const g = { URL, Response, Promise, Map, Date: c.Date, setTimeout: c.setTimeout, fetch: s.fetch, location: { origin: ORIGIN, pathname: '/ultra/course' } };
  g.globalThis = g;
  vm.createContext(g);
  vm.runInContext(read('lib/lmsq.js'), g);
  return { Q: g.GZ_LMSQ, s, c, g };
};

test('the queue: on screen first, a Retry-After date, doubling holds on 5xx, an abort while waiting, a task\'s status', async () => {
  const held = [];
  const q = lmsq(() => new Promise((done) => held.push(done)));
  const order = [];
  const get = (p, prio) => q.Q.fetch(`${ORIGIN}/${p}`, {}, prio).then(() => order.push(p));
  for (const p of ['a', 'b', 'c']) get(p, 1);
  for (const p of ['d', 'e']) get(p, 1);
  get('f', 0);
  await settle();
  assert.equal(q.s.open, 3);
  while (held.length) { held.shift()([200]); await settle(); }
  assert.deepEqual(q.s.asked, ['/a', '/b', '/c', '/f', '/d', '/e'], 'what is on screen goes before what waited longer');
  // A Retry-After date, then 5xx with none: 2 s, then 4 s.
  const r = lmsq((u) => (u.pathname === '/busy' ? [503, {}, { 'Retry-After': new Date(1e12 + 20000).toUTCString() }] : u.pathname === '/err' ? [500, {}] : [200]));
  await r.Q.fetch(`${ORIGIN}/busy`);
  r.Q.fetch(`${ORIGIN}/x`); await settle();
  assert.equal(r.s.count(/\/x/), 0);
  await r.c.tick(20000);
  assert.equal(r.s.count(/\/x/), 1, 'the date passed');
  await r.Q.fetch(`${ORIGIN}/err`);
  const again = r.Q.fetch(`${ORIGIN}/err`); await settle();
  await r.c.tick(1999);
  assert.equal(r.s.count(/\/err/), 1, 'held 2 s');
  await r.c.tick(1); await again;
  assert.equal(r.s.count(/\/err/), 2);
  r.Q.fetch(`${ORIGIN}/y`); await settle();
  await r.c.tick(3999);
  assert.equal(r.s.count(/\/y/), 0, 'a second 5xx in a row: held 4 s');
  await r.c.tick(1);
  assert.equal(r.s.count(/\/y/), 1);
  // Waiting, then given up: never sent.
  await r.Q.fetch(`${ORIGIN}/err`);
  const ctl = new AbortController();
  const gone = r.Q.fetch(`${ORIGIN}/z`, { signal: ctl.signal });
  ctl.abort();
  await assert.rejects(gone);
  await r.c.tick(600000);
  assert.equal(r.s.count(/\/z/), 0);
  // A task (content.js's capi) rejecting with 429 holds the site too.
  const t = lmsq(() => [200]);
  await assert.rejects(t.Q.run(() => Promise.reject(429)), (e) => e === 429);
  let ran = false;
  t.Q.run(async () => { ran = true; }); await settle();
  assert.equal(ran, false);
  await t.c.tick(2000);
  assert.equal(ran, true);
});

// Ultra's public contents list, 200 a page, with nextPage while more remain; `off` sends the last nextPage elsewhere.
const course = (n, { first = 1000, drop = [] } = {}) => Array.from({ length: n }, (_, i) => ({ id: `_${first + i}_1`, parentId: '_1_1', title: 't' })).filter((x) => !drop.includes(x.id));
const contents = (items) => (r) => {
  if (/users\/me$/.test(r.pathname)) return ME;
  const at = +(r.searchParams.get('offset') || 0), limit = +(r.searchParams.get('limit') || 200);
  const page = items.slice(at, at + limit);
  return [200, { results: page, ...(at + limit < items.length && { paging: { nextPage: `${r.pathname}?offset=${at + limit}&limit=${limit}` } }) }];
};

test('ULT-6: items past the first 200 are read, and a new one there is badged', async () => {
  const items = course(260);
  const u = ultra({ answer: contents(items) });
  const got = await u.X.ctx.courseItems('_1_1').p;
  assert.equal(got.length, 260);
  assert.equal(u.s.count(/\/contents\?/), 2, 'two pages');
  // Seen all 260 (a record kept with paged reads: '+'); one added at the end of the course.
  const page = ultra({ answer: contents([...items, { id: '_5000_1', parentId: '_1_1' }]), pathname: '/ultra/course', enhance: { newcontent: true },
    local: { seenContent: { _1_1: [...items.map((x) => x.id), '+'] } }, cards: [card('_1_1')] });
  page.X.renderNew(); await settle(); page.X.renderNew(); await settle();
  assert.deepEqual(page.badges.filter(([, , k]) => k === 'items').at(-1), ['_1_1', 1, 'items']);
});

test('ULT-6: a record kept from one page of 200 starts afresh instead of calling the rest of the course new', async () => {
  const items = course(260);
  const row = (x) => ({ dataset: { contentId: x.id }, querySelector: (sel) => (/contentItemTitle/.test(sel) ? { parentElement: { id: x.id } } : null) });
  const u = ultra({ answer: contents(items), local: { seenContent: { _1_1: items.slice(0, 200).map((x) => x.id) } }, enhance: { newcontent: true }, rows: items.map(row) });
  u.X.renderNew(); await settle(); u.X.renderNew(); await settle();
  assert.ok(u.badges.some(([, , k]) => k === 'item'), 'the rows were drawn');
  assert.deepEqual(u.badges.filter(([, n, k]) => k === 'item' && n), [], 'no row is new');
  assert.deepEqual([...u.local.seenContent._1_1], [...items.map((x) => x.id), '+'], 'the whole course is the record now');
});

test('ULT-6: after a read that stopped short, old items that slid into its window are not new', async () => {
  // Seen as an earlier visit had it (its first 200), the course too big to read whole; three old items deleted.
  const before = course(2600);
  const now = course(2600, { drop: ['_1001_1', '_1002_1', '_1003_1'] });
  const u = ultra({ answer: contents(now), pathname: '/ultra/course', enhance: { newcontent: true },
    local: { seenContent: { _1_1: before.slice(0, 200).map((x) => x.id) } }, cards: [card('_1_1')] });
  u.X.renderNew(); await settle(); u.X.renderNew(); await settle(20);
  const counts = u.badges.filter(([, , k]) => k === 'items').map(([, n]) => n);
  assert.ok(counts.length && counts.every((n) => n === 0), `nothing new: ${counts}`);
  const got = await u.X.ctx.courseItems('_1_1').p;
  assert.equal(got.complete, false, 'the read says it stopped short');
});

// ---- Canvas ------------------------------------------------------------------------------------------------------
// A Canvas that caps per_page at 50, as a self-hosted default install does, and says what follows in its Link header.
const canvas = ({ nextLink, stopAfterFirst = false } = {}) => {
  const asked = [];
  const settings = { enhance: {} };
  const capi = (p, reply) => {
    asked.push(p);
    const u = new URL(p, 'https://canvas.test/api/v1/');
    const per = Math.min(+u.searchParams.get('per_page') || 10, 50), page = +u.searchParams.get('page') || 1;
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: String(i + 1), type: 'File' })).slice((page - 1) * per, page * per);
    u.searchParams.set('page', page + 1);
    const next = nextLink ?? (page * per < 120 ? `<https://canvas.test/api/v1${u.pathname}${u.search}>; rel="next"` : '');
    reply?.({ headers: { get: () => next } });
    if (stopAfterFirst) settings.enabled = false;
    return Promise.resolve(rows);
  };
  const c = { console, URL, Map, Set, Promise, JSON, Date, setTimeout, clearTimeout, addEventListener() {},
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    sessionStorage: { getItem: () => null, setItem() {} }, location: { origin: 'https://canvas.test', pathname: '/courses/7/modules' }, chrome: {} };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(read('content-canvas.js'), c);
  return { X: c.GZ_SITE_CANVAS({ capi, settings, links: [], t: (s) => s, locale: () => 'en', need: () => Promise.reject(new Error('none')) }), asked };
};

test('CVM-3: a Canvas list capped at 50 a page is read whole, as its Link header says', async () => {
  for (const fresh of [true, false]) {
    const cv = canvas();
    const items = await cv.X.ctx.moduleItems('7', '42', fresh);
    assert.equal(items.length, 120, 'all 120 files');
    assert.equal(cv.asked.length, 3);
    assert.equal(items.complete, true);
  }
});

// The Modules page: modules Canvas drew (open, or folded with their rows) and folded ones it drew empty.
const modulesPage = (mods) => {
  const c = clock(), calls = [], held = [], buttons = new Map();
  let open = 0, peak = 0;
  const item = ({ id, collapsed = false, rows = [] }, i) => {
    const header = { append: (b) => buttons.set(b.id, b) };
    return { dataset: { moduleId: id }, isConnected: true, classList: { contains: (k) => k === 'collapsed_module' && collapsed },
      getBoundingClientRect: () => ({ top: i * 300 }),
      querySelector: (sel) => (sel === '.ig-header' ? header : sel === '.context_module_item' ? (rows.length ? {} : null)
        : sel === '.context_module_item.attachment' ? (rows.includes('File') ? {} : null) : sel === '.name' ? { textContent: id } : null) };
  };
  const items = mods.map(item);
  const document = { querySelectorAll: (sel) => (sel.startsWith('.context_module') ? items : []), getElementById: (id) => buttons.get(id) || null,
    createElement: () => ({ addEventListener() {}, setAttribute() {}, toggleAttribute() {}, style: { setProperty() {} } }) };
  const ctx = { site: 'canvas', t: (s) => s, locale: () => 'en', capi: () => Promise.resolve([]), canvasCourseId: () => '7', courseId: () => null,
    settings: () => ({ enhance: { download: true } }), on: () => true,
    moduleItems: (cid, mid) => { calls.push(mid); open += 1; peak = Math.max(peak, open); return new Promise((done) => held.push(() => { open -= 1; done([{ type: 'File' }]); })); } };
  const g = { GZ_CTX: ctx, document, location: { pathname: '/courses/7/modules', origin: 'https://canvas.test' }, chrome: { runtime: { connect() {} } }, innerHeight: 900,
    Date: c.Date, setTimeout: c.setTimeout, clearTimeout() {}, WeakMap, Map, Set, Promise, URL, Response, console };
  g.globalThis = g;
  vm.createContext(g);
  ctx.need = (file, ready) => { try { if (!ready()) vm.runInContext(read(file), g); } catch (e) { return Promise.reject(e); } return ready() ? Promise.resolve() : Promise.reject(new Error('not ready')); };
  vm.runInContext(read('features/download.js'), g);
  return { sync: () => g.GZ_DOWNLOAD.sync(), calls, held, buttons, c, ctx, g, peak: () => peak, open: () => open };
};

test('CVM-4: the Modules page places buttons from the rows Canvas drew, asks only about folded empty modules, three at a time, and never on a timer', async () => {
  const p = modulesPage([
    { id: '1', rows: ['File', 'Page'] }, { id: '2', rows: ['Page'] }, { id: '3', collapsed: true, rows: ['File'] }, { id: '4' },
    ...['5', '6', '7', '8', '9', '10'].map((id) => ({ id, collapsed: true })),
  ]);
  p.sync(); await settle();
  for (let guard = 0; p.held.length && guard < 20; guard++) { assert.ok(p.open() <= 3, `${p.open()} open`); p.held.shift()(); await settle(); p.sync(); await settle(); }
  assert.deepEqual([...p.calls].sort((a, b) => a - b), ['5', '6', '7', '8', '9', '10'], 'no request for a module whose rows are drawn, open or folded');
  assert.ok(p.peak() <= 3, `${p.peak()} at once`);
  assert.deepEqual([...p.buttons.keys()].sort(), ['gz-dl-1', 'gz-dl-10', 'gz-dl-3', 'gz-dl-5', 'gz-dl-6', 'gz-dl-7', 'gz-dl-8', 'gz-dl-9'].sort());
  for (let i = 0; i < 5; i++) { await p.c.tick(61000); p.sync(); await settle(); }
  assert.equal(p.calls.length, 6, 'five minutes of passes later, nothing asked again');
});

test('review: small legacy content records rebaseline once; incomplete reads never mark a legacy baseline complete', async () => {
  const row = (x) => ({ dataset: { contentId: x.id }, querySelector: (sel) => (/contentItemTitle/.test(sel) ? { parentElement: { id: x.id } } : null) });
  const old = course(3), current = course(4);
  const u = ultra({ answer: contents(current), local: { seenContent: { _1_1: old.map((x) => x.id) } }, enhance: { newcontent: true }, rows: current.map(row) });
  u.X.renderNew(); await settle(); u.X.renderNew(); await settle();
  assert.deepEqual(u.badges.filter(([, n, k]) => k === 'item' && n), [], 'unmarked legacy lists rebaseline even below 200');
  assert.ok(u.local.seenContent._1_1.includes('+'));
  const huge = course(2200);
  const partial = ultra({ answer: contents(huge), local: { seenContent: { _1_1: old.map((x) => x.id) } }, enhance: { newcontent: true }, rows: huge.slice(0, 3).map(row) });
  partial.X.renderNew(); await settle(30); partial.X.renderNew(); await settle();
  assert.deepEqual(partial.local.seenContent._1_1, old.map((x) => x.id), 'partial read neither advances nor certifies the old baseline');
});

test('review: queued Modules reads stop when Glaze turns off', async () => {
  const p = modulesPage(Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1), collapsed: true })));
  p.sync(); await settle();
  assert.equal(p.calls.length, 3);
  p.ctx.on = () => false;
  for (const done of p.held.splice(0)) done();
  await settle();
  assert.equal(p.calls.length, 3, 'waiting reads must check liveness at dispatch');
});

test('review: queued Ultra fanouts stop when Glaze turns off', async () => {
  const held = [];
  const u = ultra({ answer: (r) => /users\/me$/.test(r.pathname) ? ME : new Promise((done) => held.push(() => done([200, { results: [] }]))) });
  for (let i = 1; i <= 8; i++) u.X.ctx.bookFor(`_${i}_1`);
  await settle();
  assert.equal(u.s.count(/gradebook/), 3);
  u.I.settings.enabled = false;
  for (const done of held.splice(0)) done();
  await settle();
  assert.equal(u.s.count(/gradebook/), 3);
});

test('review: synchronous fetch exceptions release queue slots', async () => {
  const q = lmsq(() => [200]);
  q.g.fetch = () => { throw new TypeError('invalid fetch init'); };
  for (let i = 0; i < 3; i++) await assert.rejects(q.Q.fetch(`${ORIGIN}/bad`));
  let ran = false;
  q.Q.run(async () => { ran = true; });
  await settle();
  assert.equal(ran, true, 'failed dispatches must not consume the entire queue');
});

test('review: a late old-route 401 does not lock the new route; query navigation unlocks a current 401', async () => {
  const held = [];
  const q = lmsq(() => new Promise((done) => held.push(done)));
  const old = q.Q.fetch(`${ORIGIN}/old`);
  await settle();
  q.g.location.pathname = '/ultra/grades';
  held.shift()([401]); await old; await settle();
  const next = q.Q.fetch(`${ORIGIN}/new`);
  await settle();
  assert.equal(q.s.count(/\/new/), 1, '401 belongs to the route that sent it');
  held.shift()([401]); await next; await settle();
  q.g.location.search = '?courseId=_2_1';
  q.Q.fetch(`${ORIGIN}/query`);
  await settle();
  assert.equal(q.s.count(/\/query/), 1, 'a navigation with a different query may reauthenticate');
  held.shift()([200]); await settle();
});

test('review: failing memberships are cached for a minute, and a 401 until navigation', async () => {
  for (const status of [500, 401]) {
    const u = ultra({ answer: (r) => /users\/me$/.test(r.pathname) ? ME : [status, {}] });
    for (let i = 0; i < 20; i++) { await u.X.ctx.myCourses(); await u.c.tick(100); }
    assert.equal(u.s.count(/memberships/), 1, `${status}: repeated passes share the failure`);
    await u.c.tick(61000); await u.X.ctx.myCourses();
    assert.equal(u.s.count(/memberships/), status === 401 ? 1 : 2);
    if (status === 401) { u.location.pathname = '/ultra/grades'; await u.X.ctx.myCourses(); assert.equal(u.s.count(/memberships/), 2); }
  }
});

test('review: Canvas rejected or malformed next links report incomplete coverage', async () => {
  for (const nextLink of ['<https://evil.test/api/v1/files?page=2>; rel="next"', '<https://canvas.test/login>; rel="next"', '<https://[bad>; rel="next"']) {
    const c = canvas({ nextLink });
    const list = await c.X.ctx.moduleItems('7', '42', true);
    assert.equal(c.asked.length, 1);
    assert.equal(list.complete, false, nextLink);
  }
});

test('review: Ultra queue slots cover response bodies, not only response headers', async () => {
  const q = lmsq(() => [200]), bodies = [];
  q.g.fetch = async () => new Response(new ReadableStream({ start(c) { bodies.push(c); } }));
  const reads = Array.from({ length: 7 }, (_, i) => q.Q.fetch(`${ORIGIN}/${i}`).then((r) => r.text()));
  await settle();
  assert.equal(bodies.length, 3, 'three streaming requests remain in flight');
  for (let n = 0; n < 3; n++) { for (const c of bodies.splice(0)) c.close(); await settle(); }
  await Promise.all(reads);
});

test('review: background jobs eventually run under a continued stream of visible work', async () => {
  const q = lmsq(() => [200]), held = [], order = [];
  for (let i = 0; i < 3; i++) q.Q.run(() => new Promise((done) => held.push(done)));
  q.Q.run(async () => { order.push('background'); }, 1);
  await q.c.tick(30000);
  q.Q.run(async () => { order.push('visible'); }, 0);
  held.shift()(); await settle();
  assert.equal(order[0], 'background', 'a waiting job ages into service instead of starving');
  for (const done of held) done(); await settle();
});

test('review: identity 401 cache resets on query navigation', async () => {
  const u = ultra({ answer: () => [401, {}] });
  await u.X.ctx.me().catch(() => {});
  await u.c.tick(61000);
  await u.X.ctx.me().catch(() => {});
  assert.equal(u.s.count(/users\/me/), 1);
  u.location.search = '?courseId=_2_1';
  await u.X.ctx.me().catch(() => {});
  assert.equal(u.s.count(/users\/me/), 2);
});

test('review: incomplete Canvas module lists cannot become progress or new-item baselines', async () => {
  const src = read('content-canvas.js');
  const a = src.indexOf('  const canvasModuleLists ='), b = src.indexOf('  // Hidden modules', a);
  const rows = Object.defineProperty([], 'complete', { value: false });
  const get = vm.runInNewContext(`${src.slice(a, b)} canvasModules`, { Map, Date, Error, canvasAll: async () => rows });
  await assert.rejects(get('7'), /Incomplete/);
});

test('review: Download all refuses an incomplete Canvas list instead of saving a partial zip', async () => {
  const src = read('features/download.js'), a = src.indexOf('        const items = await moduleItems('), b = src.indexOf('        for (const id', a);
  const rows = Object.defineProperty([], 'complete', { value: false });
  const result = vm.runInNewContext(`(async () => { ${src.slice(a, b)} })()`, { moduleItems: async () => rows, cid: '7', fid: '42', skipped: 0, GZ_ZIP: { canvasUnopened: () => new Set() } });
  await assert.rejects(result, /Incomplete/);
});

test('review: Canvas pagination stops before another page when Glaze switches off', async () => {
  const c = canvas({ stopAfterFirst: true });
  await assert.rejects(c.X.ctx.moduleItems('7', '42', true), /stale/);
  assert.equal(c.asked.length, 1);
});
