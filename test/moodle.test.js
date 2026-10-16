// Moodle (W20): the detector and host registration, the parsers in lib/moodle.js, what features/moodle.js does with them,
// and the fixtures they are checked against (test/fixtures/moodle-*: pages captured from the local Moodle with
// `scripts/canvas-shots.js --lms moodle --settings '{enabled:false}' --html test/fixtures …`, service answers scrubbed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/moodle.js');
const { score } = require('../lib/page.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const dir = path.join(__dirname, 'fixtures');
const fixtures = fs.readdirSync(dir).filter((f) => /^moodle-.*\.html$/.test(f)).map((f) => ({ f, html: fs.readFileSync(path.join(dir, f), 'utf8') }));
const json = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const ORIGIN = 'http://localhost:8081';
const settle = () => new Promise(setImmediate);
// What a vm hands back, as plain data (its objects come from another realm).
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---- the detector -------------------------------------------------------------------------------------------------
// Tags as the parser makes them, with just enough of matches() for the attribute selectors detect.js uses.
const tag = (src) => {
  const attrs = Object.fromEntries([...src.matchAll(/\s([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const el = { tag: src.match(/^<(\w+)/)[1].toLowerCase(), attrs };
  el.matches = (selector) => [...selector.matchAll(/([a-z]*)((?:\[[^\]]*\])+)/g)].some(([, name, conds]) => (!name || name === el.tag)
    && [...conds.matchAll(/\[([\w-]+)([~^*]?=)"([^"]*)"\]/g)].every(([, a, op, v]) => {
      const x = attrs[a];
      return x !== undefined && (op === '=' ? x === v : op === '~=' ? x.split(/\s+/).includes(v) : op === '^=' ? x.startsWith(v) : x.includes(v));
    }));
  return el;
};
// detect.js on a page: its head as parsed so far, then its body. Returns what it told the background.
const detect = (html, { glazed = false, type = 'text/html' } = {}) => {
  const head = html.slice(0, html.search(/<body[\s>]/));
  const els = [...head.matchAll(/<(?:link|meta|base)\b[^>]*>/gi)].map((m) => tag(m[0]));
  const said = [];
  let observer = null;
  const document = {
    contentType: type, body: null,
    head: { querySelector: (sel) => els.find((e) => e.matches(sel)) || null },
    addEventListener() {}, removeEventListener() {},
  };
  vm.runInNewContext(read('lib/detect.js'), {
    document, window: { __gzGlaze: glazed },
    chrome: { runtime: { sendMessage: (m) => said.push(m), lastError: null } },
    MutationObserver: class { constructor(fn) { observer = this; this.fn = fn; } observe() { this.on = true; } disconnect() { this.on = false; } },
  });
  if (observer?.on) {
    document.body = tag(html.match(/<body\b[^>]*>/i)?.[0] || '<body>');
    observer.fn();
  }
  return { said, watching: !!observer?.on };
};

test('the detector finds Moodle by its keywords meta and its body, and Canvas by its stylesheet', () => {
  assert.ok(fixtures.length >= 8, 'the Moodle page fixtures are missing');
  for (const { f, html } of fixtures) assert.deepEqual(detect(html).said, ['moodle'], f);
  for (const f of fs.readdirSync(dir).filter((x) => /^canvas-.*\.html$/.test(x) && x !== 'canvas-docviewer.html')) {
    assert.deepEqual(detect(fs.readFileSync(path.join(dir, f), 'utf8')).said, ['canvas'], f);
  }
  assert.deepEqual(detect(fs.readFileSync(path.join(dir, 'ultra-boot.html'), 'utf8')).said, []);
});

test('the detector never takes a page that only talks about Moodle', () => {
  const page = (meta, body) => `<html><head><title>x</title>${meta}<link rel="stylesheet" href="/style.css"></head>${body}</html>`;
  const MOODLE_BODY = '<body id="page-my-index" class="path-my pagelayout-mydashboard">';
  for (const [why, html] of [
    ['a blog post tagged moodle', page('<meta name="keywords" content="moodle, lms, e-learning">', '<body class="post-template-default single single-post postid-12 page-moodle-tips">')],
    ['a WordPress page whose id starts with page-', page('<meta name="keywords" content="moodle, plugins">', '<body id="page-top" class="page page-id-2">')],
    ['Moodle-like body classes without Moodle\'s meta', page('<meta name="keywords" content="lms, moodle">', MOODLE_BODY)],
    ['no keywords at all', page('<meta name="description" content="moodle, the LMS">', MOODLE_BODY)],
    ['the meta in the body, not the head', `<html><head></head><body id="page-x" class="pagelayout-standard path-x"><meta name="keywords" content="moodle, x"></body></html>`],
  ]) assert.deepEqual(detect(html).said, [], why);
  const moodle = page('<meta name="keywords" content="moodle, Dashboard">', MOODLE_BODY);
  assert.deepEqual(detect(moodle).said, ['moodle']);
  assert.deepEqual(detect(moodle, { glazed: true }).said, [], 'Glaze is already in the page');
  const other = detect(moodle, { type: 'application/json' });
  assert.deepEqual([other.said, other.watching], [[], false], 'not an HTML page: nothing watched');
});

test('the detector stays under 2 KB', () => {
  assert.ok(fs.statSync(path.join(root, 'lib/detect.js')).size < 2048);
});

// ---- the background: a Moodle host is injected now and registered for good, in its own list --------------------------
// Each LMS's first content script: Canvas's is the manifest's for *.instructure.com, with its part; Moodle's is the same
// without it (B0b).
const CANVAS_FIRST = require('../manifest.json').content_scripts.find((c) => c.matches.includes('https://*.instructure.com/*')).js;
const MOODLE_FIRST = CANVAS_FIRST.filter((f) => f !== 'content-canvas.js');
test('a Moodle host is injected now and registered from then on, apart from Canvas hosts', async () => {
  const store = { canvas: ['https://canvas.school.edu/*'] };
  const injected = [], registered = [], lists = {};
  let message;
  const none = { addListener() {} };
  const context = vm.createContext({ solo: false, tabFrame: '',
    URL, console, setTimeout, clearTimeout,
    importScripts: (file) => vm.runInContext(read(path.join('lib', file)), context),
    chrome: {
      runtime: { id: 'id', getURL: (p = '') => `chrome-extension://id/${p}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => { message ||= []; message.push(f); } }, onInstalled: none, onStartup: none, onConnect: none },
      storage: { local: { get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]])), set: async (o) => Object.assign(store, o) }, sync: { get: async () => ({}) }, onChanged: none },
      scripting: {
        executeScript: async (o) => { injected.push(o); return [{ result: {} }]; },
        getRegisteredContentScripts: async () => registered.map((id) => ({ id })),
        registerContentScripts: async (list) => { for (const s of list) { assert.ok(!registered.includes(s.id), `registered twice: ${s.id}`); registered.push(s.id); lists[s.id] = s.js; } },
      },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = async (m, url) => { for (const f of message) f(m, { tab: { id: 4 }, frameId: 0, url }, () => {}); await settle(); await settle(); };
  await send('moodle', 'https://moodle.school.edu/my/');
  assert.deepEqual(injected.map((o) => o.files), [MOODLE_FIRST], 'Moodle\'s whole first content script, into that page: no Canvas part');
  assert.deepEqual(plain(store.moodle), ['https://moodle.school.edu/*']);
  assert.deepEqual(plain(store.canvas), ['https://canvas.school.edu/*'], 'the Canvas list (which Download all trusts) is untouched');
  assert.deepEqual(registered.sort(), ['https://canvas.school.edu/*', 'https://moodle.school.edu/*']);
  assert.deepEqual(plain(lists), { 'https://canvas.school.edu/*': CANVAS_FIRST, 'https://moodle.school.edu/*': MOODLE_FIRST }, 'each host its own LMS\'s list');
  assert.ok(CANVAS_FIRST.includes('content-canvas.js') && !MOODLE_FIRST.includes('content-canvas.js') && MOODLE_FIRST.at(-1) === 'content.js');
  await send('moodle', 'https://moodle.school.edu/course/view.php?id=2');
  assert.deepEqual(plain(store.moodle), ['https://moodle.school.edu/*'], 'a host once');
  await send('blackboard', 'https://x.edu/');
  assert.equal(injected.length, 2, 'only the two LMSs it knows');
  // A Canvas host found on a page gets Canvas's list, part and all; one on both lists too (Canvas's holds Moodle's).
  store.moodle.push('https://both.school.edu/*');
  await send('canvas', 'https://both.school.edu/courses/1');
  assert.deepEqual(injected.at(-1).files, CANVAS_FIRST);
  assert.deepEqual(plain(lists['https://both.school.edu/*']), CANVAS_FIRST);
});

// ---- lib/moodle.js ------------------------------------------------------------------------------------------------
test('due this week: the Timeline\'s events from now to a week on, soonest first, as paths on this site', () => {
  const answer = json('moodle-timeline.json');
  const now = 1792050235000; // when the fixture was captured
  const list = M.due(M.answer(answer), now, ORIGIN);
  assert.deepEqual(list.map((d) => d.title), ['Problem set 3', 'Quiz: Grammar check', 'Field notes', 'Quiz 2: Limits', 'Map assignment', 'Problem set 4']);
  assert.deepEqual(list[0], { title: 'Problem set 3', cid: '18', due: 1792076106000, course: 'MATH 1350', url: '/mod/assign/view.php?id=130' });
  assert.ok(list.every((d, i) => d.due >= now && d.due < now + 7 * 864e5 && (!i || list[i - 1].due <= d.due)));
  assert.ok(!list.some((d) => /Primary source|Osmosis/.test(d.title)), 'overdue work is left out');
  // Another site's address never becomes a path here; the course's own page stands in, or the item goes.
  const one = (e) => M.due({ events: [{ activityname: 'A', timesort: now / 1000 + 60, course: { id: 7, shortname: 'C', viewurl: `${ORIGIN}/course/view.php?id=7` }, ...e }] }, now, ORIGIN);
  assert.equal(one({ url: 'https://evil.example/x' })[0].url, '/course/view.php?id=7');
  assert.deepEqual(one({ url: 'javascript:alert(1)', course: { id: 7, viewurl: 'https://evil.example/' } }), []);
  assert.equal(one({ url: `${ORIGIN}/moodle/mod/quiz/view.php?id=3#x` })[0].url, '/moodle/mod/quiz/view.php?id=3#x', 'Moodle in a folder');
  assert.deepEqual(one({ course: { id: 'x' } }), [], 'no course id, no item');
  for (const bad of [null, {}, { events: 'no' }, { events: [null, 1, 'x'] }]) assert.deepEqual(M.due(bad, now, ORIGIN), []);
});

test('service answers: the data, or an error naming Moodle\'s own code', () => {
  assert.deepEqual(M.call('core_x', { a: 1 }), [{ index: 0, methodname: 'core_x', args: { a: 1 } }]);
  assert.deepEqual(M.answer([{ error: false, data: { ok: 1 } }]), { ok: 1 });
  assert.throws(() => M.answer([{ error: true, exception: { errorcode: 'servicenotavailable' } }]), /servicenotavailable/);
  for (const bad of [null, [], {}, [null], [{ error: false }]]) assert.throws(() => M.answer(bad));
});

test('courses for the palette, from the Course overview\'s own call', () => {
  const list = M.courses(M.answer(json('moodle-courses.json')), ORIGIN);
  assert.deepEqual(list.map((c) => c.code), ['BIO 1100', 'ENG 1100', 'HIST 2010', 'MATH 1350']);
  assert.deepEqual(list[0], { id: '16', name: 'BIO 1100: Introduction to Biology', code: 'BIO 1100', url: '/course/view.php?id=16' });
  assert.deepEqual(M.courses({ courses: [{ id: 3, fullname: 'X', viewurl: 'https://elsewhere.example/course/view.php?id=3' }] }, ORIGIN), []);
});

test('the grades overview: each course\'s total, by the link to its grades', () => {
  const html = fixtures.find(({ f }) => f === 'moodle-grades.html').html;
  assert.deepEqual(M.overview(html), { 16: '93.00', 17: '74.00', 18: '176.00', 19: '5.00' });
  // What other Moodles and settings draw: the user report link, a rank column, letters and percentages, a course whose
  // grades the student can't open (no link), no grade yet, entities.
  const row = (a, total, more = '') => `<tr><td class="cell c0">${a}</td><td class="cell c1">${total}</td>${more}</tr>`;
  const other = `<table id="overview-grade"><tbody>
    ${row('<a href="https://m.edu/moodle/grade/report/user/index.php?id=12&amp;userid=3&amp;group=0">Chemistry</a>', '85.00&nbsp;% (B)', '<td class="cell c2">3/40</td>')}
    ${row('<a href="https://m.edu/course/user.php?mode=grade&amp;id=13&amp;user=3">Art</a>', 'A-')}
    ${row('Hidden grades course', '70.00')}
    ${row('<a href="https://m.edu/course/user.php?mode=grade&amp;id=14&amp;user=3">Latin</a>', '-')}
    ${row('<a href="https://m.edu/course/user.php?mode=grade&amp;id=15&amp;user=3">Music</a>', '<span>91,5 %</span>')}
    <tr class="emptyrow"><td class="cell c0"></td><td class="cell c1"></td></tr></tbody></table>`;
  assert.deepEqual(M.overview(other), { 12: '85.00 % (B)', 13: 'A-', 15: '91,5 %' });
  for (const bad of [null, '', '<table><tr><td>x</td></tr></table>', 42]) assert.deepEqual(M.overview(bad), {});
});

test('a total\'s chip: Moodle\'s own text, and its share where it says a percentage', () => {
  assert.deepEqual(M.grade('93.00'), { label: '93.00', pct: null }, 'points: no band without the maximum');
  assert.deepEqual(M.grade('84.55 %'), { label: '84.55 %', pct: 84.55 });
  assert.deepEqual(M.grade('91,5 %'), { label: '91,5 %', pct: 91.5 });
  assert.deepEqual(M.grade('85.00 % (B)'), { label: '85.00 % (B)', pct: 85 });
  assert.deepEqual(M.grade('B+ (88.00 %)'), { label: 'B+ (88.00 %)', pct: 88 });
  assert.deepEqual(M.grade('A-'), { label: 'A-', pct: null });
  assert.equal(M.grade('105.00 %').pct, 100);
  assert.equal(M.text('A&amp;B&nbsp;<b>C</b> &#8211; &#x41; &bogus;'), 'A&B C – A &bogus;');
  assert.equal(M.text('x&#x110000;y&#9999999;z&#99999999999;'), 'xyz&#99999999999;', 'a code point past Unicode is dropped, never thrown on');
});

// ---- features/moodle.js, in a stand-in page ---------------------------------------------------------------------------
const D = require('../defaults.js');
const page = ({ logout = `${ORIGIN}/login/logout.php?sesskey=abc123`, cards = [], settings = { enabled: true, enhance: { overall: true } }, overview = '', courses = [], stored = {}, root = ORIGIN, list = {}, dark = true, live = { on: true } } = {}) => {
  const asked = [];
  // storage.local, as GZ_CTX.local hands it over.
  const local = { get: (k, cb) => cb(Object.fromEntries([k].flat().map((x) => [x, stored[x]]))), set: (o) => Object.assign(stored, o) };
  const el = (attrs = {}) => ({ attrs, getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; } });
  const style = () => { const vars = {}; return { vars, getPropertyValue: (k) => vars[k] || '', setProperty: (k, v) => { vars[k] = v; }, removeProperty: (k) => { delete vars[k]; } }; };
  const cardEls = cards.map(([id, name = true]) => { const name_ = name && el(); return { dataset: { courseId: id }, style: style(), querySelector: () => name_, name: name_ }; });
  const document = {
    querySelector: (sel) => (sel.includes('logout.php') && logout ? { href: logout } : null),
    querySelectorAll: (sel) => (sel.includes('course-content') ? cardEls : []),
  };
  const context = vm.createContext({ solo: false, tabFrame: '',
    URL, Promise, JSON, Date, document, location: { origin: ORIGIN }, matchMedia: () => ({ matches: dark }),
    GZ_COURSE_COLOR: D.GZ_COURSE_COLOR, GZ_SURFACE_VARS: D.GZ_SURFACE_VARS, GZ_ACTIVE_COLORS: D.GZ_ACTIVE_COLORS, GZ_COURSE_LOOK: D.GZ_COURSE_LOOK, GZ_TINT: D.GZ_TINT, GZ_COLORS: D.GZ_COLORS, GZ_COLOR: require('../lib/color.js'),
    GZ_MOODLE: M, GZ_PAGE: { score },
    GZ_CTX: { t: (k) => k, settings: () => settings, local: (fn) => fn(local), canvasCourseKey: (id) => (id ? `moodle:${root}/${id}` : null), courseList: () => list, on: () => live.on },
    fetch: async (url, opts = {}) => { asked.push({ url, ...opts }); return { ok: true, status: 200, text: async () => overview, json: async () => [{ error: false, data: { events: [], courses } }] }; },
  });
  context.globalThis = context;
  const api = vm.runInContext(read('features/moodle.js'), context);
  return { api, asked, cards: cardEls, context, stored };
};

test('the session comes from the log-out link: Moodle\'s root (a folder too) and its key; none when signed out or elsewhere', () => {
  assert.deepEqual(plain(page().api.session()), { root: ORIGIN, sesskey: 'abc123' });
  assert.deepEqual(plain(page({ logout: `${ORIGIN}/moodle/login/logout.php?sesskey=k` }).api.session()), { root: `${ORIGIN}/moodle`, sesskey: 'k' });
  assert.equal(page({ logout: null }).api.session(), null);
  assert.equal(page({ logout: 'https://evil.example/login/logout.php?sesskey=x' }).api.session(), null);
  assert.equal(page({ logout: `${ORIGIN}/login/logout.php?sesskey=` }).api.session(), null);
});

test('it asks only the page\'s own Moodle, read-only calls with the page\'s key, and nothing at all when signed out', async () => {
  const p = page({ logout: `${ORIGIN}/moodle/login/logout.php?sesskey=k1` });
  await p.api.due(1792050235000);
  await p.api.commands(() => () => {});
  await p.api.record();
  // The due list, the palette's courses in progress, then every course (the editor's, the course menu's, the tint's).
  assert.deepEqual(p.asked.map((a) => [a.url, a.method, a.credentials]), [
    [`${ORIGIN}/moodle/lib/ajax/service.php?sesskey=k1&info=core_calendar_get_action_events_by_timesort`, 'POST', 'same-origin'],
    [`${ORIGIN}/moodle/lib/ajax/service.php?sesskey=k1&info=core_course_get_enrolled_courses_by_timeline_classification`, 'POST', 'same-origin'],
    [`${ORIGIN}/moodle/lib/ajax/service.php?sesskey=k1&info=core_course_get_enrolled_courses_by_timeline_classification`, 'POST', 'same-origin'],
  ]);
  assert.deepEqual(JSON.parse(p.asked[0].body)[0].args, { timesortfrom: 1792050235, timesortto: 1792050235 + 7 * 86400, limitnum: 50, limittononsuspendedevents: true });
  assert.equal(JSON.parse(p.asked[1].body)[0].args.classification, 'inprogress');
  assert.equal(JSON.parse(p.asked[2].body)[0].args.classification, 'all');
  const out = page({ logout: null });
  await assert.rejects(out.api.due(Date.now()));
  out.api.cards();
  assert.deepEqual(out.asked, []);
});

test('course cards get their total from the grades overview, asked once a page load, and lose it when there is none', async () => {
  const overview = fixtures.find(({ f }) => f === 'moodle-grades.html').html.replace('>93.00<', '>93.00 %<');
  const p = page({ cards: [['16'], ['17'], ['99'], ['18', false]], overview });
  p.cards[2].name.attrs['data-gz-grade'] = 'stale';
  p.api.cards();
  await settle();
  p.api.cards();
  await settle();
  assert.equal(p.asked.length, 1);
  assert.equal(p.asked[0].url, `${ORIGIN}/grade/report/overview/index.php`);
  assert.deepEqual(p.cards.map((c) => c.name?.attrs), [{ 'data-gz-grade': '93.00 %', 'data-gz-chip': 'graded-hi' }, { 'data-gz-grade': '74.00' }, {}, undefined]);
  const off = page({ cards: [['16']], overview, settings: { enabled: true, enhance: { overall: false } } });
  off.api.cards();
  await settle();
  assert.deepEqual(off.cards[0].name.attrs, {}, 'switched off while it was asked');
});

test('Moodle\'s files load on demand, end on a value, and keep the first copy when loaded twice', () => {
  const list = JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  for (const f of ['lib/moodle.js', 'features/moodle.js']) assert.ok(list.includes(f) && !MOODLE_FIRST.includes(f), f);
  const context = vm.createContext({ solo: false, tabFrame: '', URL, document: {}, location: { origin: ORIGIN } });
  context.globalThis = context;
  for (const [f, name] of [['lib/moodle.js', 'GZ_MOODLE'], ['features/moodle.js', 'GZ_MOODLE_PAGE']]) {
    const value = vm.runInContext(read(f), context);
    assert.ok(value && value === vm.runInContext(name, context), `${f}: no last value`);
    assert.equal(vm.runInContext(read(f), context), value, `${f}: a second copy replaced the first`);
  }
});

test('Moodle is packaged: its stylesheet is exposed to pages, and the zip carries it and features/', () => {
  const m = require('../manifest.json');
  assert.ok(m.web_accessible_resources[0].resources.includes('moodle.css'));
  const pkg = read('package.sh');
  for (const f of ['moodle.css', 'features']) assert.equal(pkg.match(new RegExp(` ${f} `, 'g'))?.length, 2, `package.sh: ${f}`);
});

test('the words features/moodle.js shows are in every language', () => {
  const src = read('features/moodle.js');
  const words = [...src.matchAll(/\bt\('([^']+)'\)/g), ...src.matchAll(/\['\/[^']*', '([^']+)'\]/g)].map((m) => m[1]);
  assert.ok(words.length >= 8);
  require('../lib/i18n.js');
  for (const f of fs.readdirSync(path.join(root, 'i18n'))) require(`../i18n/${f}`);
  for (const [lang, cat] of Object.entries(globalThis.GZ_LANGS)) for (const w of words) assert.ok(w in cat, `${lang}: "${w}"`);
});

// ---- the fixtures ---------------------------------------------------------------------------------------------------
test('the Moodle fixtures are safe to commit: no code, no session key, Glaze off, small, this machine only', () => {
  for (const { f, html } of fixtures) {
    assert.match(html, /^<!-- Glaze test fixture: \S+ on the local Moodle /, `${f}: its provenance note`);
    assert.ok(Buffer.byteLength(html) <= 160 * 1024, `${f}: over 160 KB`);
    assert.doesNotMatch(html, /<script\b[^>]*>[^<]/, `${f}: a script still has a body`);
    assert.doesNotMatch(html, /sesskey(?:=|%3D)(?!REDACTED)|"sesskey"\s*:|name="(?:sesskey|logintoken)"[^>]*value="[^"]/i, `${f}: a session key`);
    assert.doesNotMatch(html, /MoodleSession/i, `${f}: a session cookie`);
    assert.doesNotMatch(html, /\sdata-gz-|\sid="gz-/, `${f}: captured with Glaze on`);
    // The test bed's own address, and the "Powered by Moodle" link in Moodle's footer.
    for (const [, host] of html.matchAll(/(?:href|src|action)="https?:\/\/([^/"]+)/g)) assert.ok(['localhost:8081', 'moodle.com'].includes(host), `${f}: ${host}`);
  }
  for (const f of ['moodle-timeline.json', 'moodle-courses.json']) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(text, /sesskey=(?!REDACTED)/, f);
    assert.doesNotMatch(text, /;base64,[A-Za-z0-9+/]{40}/, `${f}: a course picture`);
  }
});

// What Glaze's Moodle code and moodle.css key on, each still in the pages: when a reseed or a Moodle update drops one,
// this fails instead of a page quietly losing its theme or its extras.
const KEYS = [
  ['every page', /<meta name="keywords" content="moodle, /, 'all'],
  ['every page', /<body id="page-[\w-]+" class="[^"]*\bpath-[\w-]+[^"]*\bpagelayout-\w+/, 'all'],
  ['signed-in pages: the session', /href="[^"]*\/login\/logout\.php\?sesskey=/, 'signed-in'],
  ['course cards', /data-region="course-content"[^>]*data-course-id="\d+"|data-course-id="\d+"[^>]*data-region="course-content"/, 'moodle-dashboard.html'],
  ['course cards: the name', /class="[^"]*\bcoursename\b/, 'moodle-my-courses.html'],
  ['course tabs', /class="[^"]*\bsecondary-navigation\b/, 'moodle-course.html'],
  ['grades overview rows', /href="[^"]*\/course\/user\.php\?mode=grade&amp;id=\d+/, 'moodle-grades.html'],
];
const CLASSES = ['navbar fixed-top', 'drawers', 'drawer drawer-left', 'courseindex', 'course-section', 'activity-item', 'activity-header', 'user-grade', 'generaltable',
  'maincalendar', 'calendarmonth', 'message-app', 'login-container', 'btn-footer-popover', 'card-footer menu', 'dropdown-menu', 'form-control', 'btn btn-primary',
  'submissionstatussubmitted', 'quizinfo', 'popover-region', 'mds-nav-pill'];

test('every page fixture still has what Glaze keys on', () => {
  for (const [what, re, where] of KEYS) {
    const pick = where === 'all' ? fixtures : where === 'signed-in' ? fixtures.filter(({ f }) => f !== 'moodle-login.html') : fixtures.filter(({ f }) => f === where);
    assert.ok(pick.length, where);
    for (const { f, html } of pick) assert.match(html, re, `${f}: ${what}`);
  }
  const all = fixtures.map(({ html }) => html).join('\n');
  for (const c of CLASSES) {
    const words = c.split(' ');
    assert.ok([...all.matchAll(/class="([^"]*)"/g)].some(([, v]) => { const have = v.split(/\s+/); return words.every((w) => have.includes(w)); }), `no fixture has class "${c}"`);
    assert.ok(read('moodle.css').includes(`.${words.at(-1)}`), `"${c}" is not keyed on any more: drop it here`);
  }
});

test('the capture scrubber takes Moodle\'s session key and login token out, wherever they sit', () => {
  const { redact, fixture } = require('../scripts/redact.js');
  for (const [raw, want] of [
    ['/login/logout.php?sesskey=Ab12Cd34Ef', '/login/logout.php?sesskey=REDACTED'],
    ['/course/mod.php?update=136&amp;return=1&amp;sesskey=Myb5ZNzBEH"', '/course/mod.php?update=136&amp;return=1&amp;sesskey=REDACTED"'],
    ['/lib/ajax/service.php?sesskey=k9&info=x', '/lib/ajax/service.php?sesskey=REDACTED&info=x'],
    ['/login/index.php?logintoken=zzz', '/login/index.php?logintoken=REDACTED'],
  ]) assert.equal(redact(raw), want, raw);
  assert.match(fixture('/my/', '<html></html>', 'moodle'), /^<!-- Glaze test fixture: \/my\/ on the local Moodle \(seed: ~\/Projects\/moodle-dev\/seed\.php\)/);
  assert.match(fixture('/', '<html></html>'), /on the local Canvas/, 'Canvas stays the default');
});

// scripts/canvas-shots.js needs Playwright, so its Moodle lookup is run from its source with a stand-in browser context.
const shots = read('scripts/canvas-shots.js');
const sliceFn = (name) => { const a = shots.indexOf(`const ${name} = `); return shots.slice(a, shots.indexOf('\n};\n', a) + 4); };
const harness = () => vm.runInNewContext(`${shots.match(/^const fail = .*$/m)[0]}\n${sliceFn('moodleLookup')}\n${sliceFn('moodlePages')}\n({ moodleLookup, moodlePages })`, {
  BASE: ORIGIN, COURSES: { bio: 'BIO 1100', eng: 'ENG 1100' }, Object, Array, Error, RegExp,
});

test('the capture harness never repeats Moodle\'s session key when its lookup fails, and fails without exiting', async () => {
  const KEY = 'SeSsKeY123';
  const page = { text: async () => `M.cfg = {"sesskey":"${KEY}"};` };
  const urlError = (url) => Object.assign(new Error(`apiRequestContext.post: connect ECONNREFUSED\nCall log:\n  - → POST ${url}`), { url });
  for (const request of [
    { get: async () => page, post: async (url) => { throw urlError(url); } },
    { get: async () => page, post: async (url) => ({ json: async () => { throw urlError(url); } }) },
    { get: async () => page, post: async () => ({ json: async () => [{ error: true, exception: { errorcode: 'invalidsesskey', message: `bad ${KEY}` } }] }) },
    { get: async () => { throw new Error(`GET ${ORIGIN}/my/ failed`); }, post: async () => assert.fail('no key, no call') },
    { get: async () => ({ text: async () => '<html>login</html>' }), post: async () => assert.fail('no key, no call') },
  ]) {
    const { moodleLookup } = harness();
    const err = await moodleLookup({ request }).then(() => assert.fail('resolved'), (e) => e);
    assert.equal(err.message, `Moodle did not list the student's courses (is ${ORIGIN} up, and did the login take?)`);
    assert.ok(!`${err.message}\n${err.stack}\n${err.cause}`.includes(KEY), 'the key is nowhere in the error');
    assert.equal(err.cause, undefined);
  }
  const { moodleLookup, moodlePages } = harness();
  const ok = await moodleLookup({ request: { get: async () => page, post: async () => ({ json: async () => [{ error: false, data: { courses: [{ id: 16, shortname: 'BIO 1100' }] } }] }) } });
  assert.deepEqual(plain(ok.ids), { bio: 16 });
  await assert.rejects(moodlePages({ ids: {}, context: {} }), /Moodle has no course BIO 1100/, 'an error the run closes the browser on, not an exit');
  await assert.rejects(moodlePages({ ids: { bio: 16 }, context: { request: { get: async () => ({ text: async () => '<a href="/mod/assign/view.php?id=4">' }) } } }), /BIO 1100 has no quiz/);
});

// ---- course keys, tint, Looks, the course menu and the shortcuts (W20b) -----------------------------------------------
// content.js's course key, as it runs on a page: Moodle's from <body> and its theme's sheet, Canvas's from the address.
const keyLine = read('content.js').match(/^ {2}const canvasCourseKey = [^\n]*;$/m)[0];
const courseKey = ({ site = 'moodle', body, sheet = `${ORIGIN}/theme/styles.php/boost/1792050189_1/all`, origin = ORIGIN, canvasId } = {}) => vm.runInNewContext(`${keyLine} canvasCourseKey`, {
  site, moodle: site === 'moodle', location: { origin }, canvasCourseId: () => canvasId,
  document: { body: body === undefined ? null : { className: body }, querySelector: (sel) => (sel.includes('/theme/styles') && sheet ? { href: sheet } : null) },
});
const G = require('../defaults.js');

test('a Moodle course is keyed by its site\'s root and its id, from Moodle\'s own markup, on its pages and nowhere else', () => {
  for (const { f, html } of fixtures) {
    const body = html.match(/<body[^>]*class="([^"]*)"/)[1];
    const sheet = html.match(/<link[^>]*href="([^"]*\/theme\/styles\.php[^"]*)"/)[1];
    const want = /^moodle-(course|assign|quiz|user-report)\.html$/.test(f) ? `moodle:${ORIGIN}/16` : null;
    assert.equal(courseKey({ body, sheet })(), want, f);
  }
  assert.equal(courseKey()(), null, 'before <body> is in');
  assert.equal(courseKey({ body: 'course-1 context-15 path-course-view' })(), null, 'the site itself (course 1) is no course');
  assert.equal(courseKey({ body: 'pagelayout-incourse course-10' })(), `moodle:${ORIGIN}/10`);
  assert.equal(courseKey()('17'), `moodle:${ORIGIN}/17`, 'a course card names its own');
  // Moodle in a folder: two of them on one host (a school's archive) are two sites.
  const here = courseKey({ body: 'course-5', sheet: 'https://school.edu/moodle/theme/styles.php/boost/1/all', origin: 'https://school.edu' })();
  const archive = courseKey({ body: 'course-5', sheet: 'https://school.edu/archive/2024/theme/styles_debug.php?theme=boost&type=scss', origin: 'https://school.edu' })();
  assert.deepEqual([here, archive], ['moodle:https://school.edu/moodle/5', 'moodle:https://school.edu/archive/2024/5']);
  // Canvas's keys are as they were (nothing to migrate), and never one of Moodle's on the same host.
  assert.equal(courseKey({ site: 'canvas', canvasId: '25', origin: 'https://school.edu' })(), 'canvas:https://school.edu/25');
  assert.notEqual(courseKey({ site: 'canvas', canvasId: '5', origin: 'https://school.edu' })(), courseKey({ body: 'course-5', sheet: 'https://school.edu/theme/styles.php/x', origin: 'https://school.edu' })());
});

test('Moodle courses\' tint and Look survive sanitizing; a malformed Moodle key does not', () => {
  const keys = [`moodle:${ORIGIN}/16`, 'moodle:https://school.edu/moodle/5', 'moodle:https://school.edu/archive/2024/5', 'canvas:https://school.edu/5'];
  const looks = Object.fromEntries(keys.map((k) => [k, 'Lagoon']));
  const s = G.GZ_SANITIZE({ courses: { tint: true, tinted: keys, looks } });
  assert.deepEqual(s.courses.tinted, keys);
  assert.deepEqual(s.courses.looks, looks);
  assert.notEqual(G.GZ_COURSE_LOOK(s, keys[1]), s, 'worn on its pages');
  assert.equal(G.GZ_COURSE_LOOK(s, 'moodle:https://school.edu/moodle/6'), s, 'and only there');
  const bad = ['moodle:16', 'moodle:javascript:alert(1)/5', 'moodle:https://h/x', 'moodle:https://h/a b/5', 'moodle:https://h//5'];
  assert.deepEqual(G.GZ_SANITIZE({ courses: { tinted: bad, looks: Object.fromEntries(bad.map((k) => [k, 'Lagoon'])) } }).courses, G.GZ_SANITIZE({}).courses);
});

test('Moodle courses are kept with Moodle\'s own color for each, the one its card draws', () => {
  const key = (id) => `moodle:${ORIGIN}/${id}`;
  // The fixture's pictures are scrubbed: Moodle's default colors, by id.
  const seen = M.seen(M.answer(json('moodle-courses.json')), key);
  assert.deepEqual(Object.keys(seen), [16, 17, 19, 18].map(key));
  assert.deepEqual(seen[key(16)], { name: 'BIO 1100: Introduction to Biology', code: 'BIO 1100', moodle: true, color: '#b2bec3' });
  assert.equal(seen[key(19)].color, '#6c5ce7');
  // The start of the pattern Moodle 5.3 draws for HIST 2010 (course 19): its first rect is the course's color.
  const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="532" height="532"><rect x="0" y="0" width="100%" height="100%" fill="rgb(108, 92, 231)" /><rect x="4.9" y="4.9" width="69" height="69" fill="none" stroke="#222" /></svg>';
  const one = (c) => M.seen({ courses: [{ id: 3, fullname: 'X', ...c }] }, key)[key(3)];
  assert.equal(one({ courseimage: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` }).color, '#6c5ce7');
  assert.equal(one({ courseimage: `data:image/svg+xml;base64,${Buffer.from(svg.replace('108, 92, 231', '255,0,10')).toString('base64')}` }).color, '#ff000a');
  assert.equal(one({ courseimage: `${ORIGIN}/pluginfile.php/40/course/overviewfiles/photo.jpg` }).color, '#dfe6e9', 'a picture of its own: the default for its id');
  assert.equal(one({ courseimage: 'data:image/svg+xml;base64,%%%' }).color, '#dfe6e9');
  assert.equal(one({ fullname: 'A &amp; B <b>2</b>' }).name, 'A & B 2');
  assert.deepEqual(M.seen({ courses: [{ id: 'x', fullname: 'X' }, { id: 4, fullname: '' }, null] }, key), {});
  assert.deepEqual(M.seen({ courses: [{ id: 4, fullname: 'X' }] }, () => null), {}, 'no key (no theme sheet found): not kept');
  for (const bad of [null, {}, { courses: 'no' }]) assert.deepEqual(M.seen(bad, key), {});
});

// content.js's own recordCourses and dueWeek, as a page load runs them (startSweep), over the real features/moodle.js:
// the course list doesn't wait on the due list's cache, and is fresh per Moodle root, not per host.
const contentBlock = (start, end) => {
  const src = read('content.js');
  const at = src.indexOf(start);
  return src.slice(at, src.indexOf(end, at) + end.length);
};
const pageLoad = async ({ stored, root = ORIGIN, courses = [{ id: 16, fullname: 'BIO 1100', shortname: 'BIO 1100' }], now = Date.now() } = {}) => {
  const p = page({ stored, root, courses });
  const chrome = { storage: { local: { get: (k, cb) => cb(Object.fromEntries([k].flat().map((x) => [x, stored[x]]))), set: (o) => Object.assign(stored, o) } } };
  const ctx = vm.createContext({ solo: true, tabFrame: '',
    ultra: false, moodle: true, window: {}, chrome, Date: { now: () => now }, Promise, Object,
    location: { origin: new URL(root).origin }, moodleIn: () => Promise.resolve(p.api),
  });
  ctx.window.top = ctx.window;
  vm.runInContext(`let canvasRecorded = false; ${contentBlock('  const recordCourses = () => {', '\n  };\n')} let dueSoon = null; ${contentBlock('  const dueWeek = () =>', '  }));\n')}
    this.load = () => { recordCourses(); return dueWeek(); };`, ctx);
  await ctx.load();
  await settle(); await settle();
  return p;
};
const kinds = (p) => p.asked.map((a) => JSON.parse(a.body)[0].methodname.replace(/^core_(course|calendar)_get_/, ''));

test('a page load reads the courses of a Moodle root that has none kept, even while the due list is fresh', async () => {
  const now = Date.now();
  const warm = { dueWeek: [], dueWeekAt: now - 60000, dueWeekFrom: ORIGIN };
  const canvas = { 'canvas:https://c.example/1': { name: 'Canvas course', canvas: true } };
  const stored = { ...warm, seenCourses: { ...canvas } };
  const p = await pageLoad({ stored, now });
  assert.deepEqual(kinds(p), ['enrolled_courses_by_timeline_classification'], 'the due list from its cache, the courses asked');
  assert.deepEqual(plain(stored.seenCourses), { ...canvas, [`moodle:${ORIGIN}/16`]: { name: 'BIO 1100', code: 'BIO 1100', moodle: true, color: '#b2bec3' } });
  assert.ok(stored[`seenCoursesAt moodle:${ORIGIN}/`] > 0);
  // The next page, within ten minutes: nothing asked.
  assert.deepEqual(kinds(await pageLoad({ stored, now: now + 60000 })), []);
  // Ten minutes on, the list again (the due list's cache, fresh or not, has no say).
  stored[`seenCoursesAt moodle:${ORIGIN}/`] -= 601000;
  stored.dueWeekAt = now;
  assert.deepEqual(kinds(await pageLoad({ stored, now })), ['enrolled_courses_by_timeline_classification']);
});

test('two Moodles on one host keep their course lists apart: one\'s fresh list never stands in for the other\'s', async () => {
  const now = Date.now();
  const stored = { dueWeek: [], dueWeekAt: now, dueWeekFrom: 'https://school.edu', 'seenCoursesAt moodle:https://school.edu/': now,
    seenCourses: { 'moodle:https://school.edu/16': { name: 'A', moodle: true } } };
  const b = await pageLoad({ stored, root: 'https://school.edu/archive', now });
  assert.deepEqual(kinds(b), ['enrolled_courses_by_timeline_classification']);
  assert.deepEqual(Object.keys(stored.seenCourses), ['moodle:https://school.edu/16', 'moodle:https://school.edu/archive/16']);
  // And the other way round: the root at the host's top doesn't count the folder's courses as its own.
  delete stored['seenCoursesAt moodle:https://school.edu/'];
  stored.seenCourses = { 'moodle:https://school.edu/archive/16': { name: 'B', moodle: true } };
  stored['seenCoursesAt moodle:https://school.edu/'] = now;
  assert.deepEqual(kinds(await pageLoad({ stored, root: 'https://school.edu', now })), ['enrolled_courses_by_timeline_classification']);
});

test('a failed or empty course read changes nothing kept, and is asked again on the next page', async () => {
  const canvas = { 'canvas:https://c.example/1': { name: 'Canvas course', canvas: true } };
  const stored = { seenCourses: { ...canvas } };
  const p = await pageLoad({ stored, courses: [] });
  assert.equal(kinds(p).filter((k) => k.startsWith('enrolled')).length, 1);
  assert.deepEqual(plain(stored.seenCourses), canvas);
  // Nothing of this root kept: asked again, however fresh the time.
  assert.equal(kinds(await pageLoad({ stored, courses: [] })).filter((k) => k.startsWith('enrolled')).length, 1);
});

// content.js's recordCourses alone, over a module content.js is still waiting for (moodleIn).
const recorder = (moodleIn) => {
  const ctx = vm.createContext({ solo: true, tabFrame: '', ultra: false, moodle: true, window: {}, moodleIn });
  ctx.window.top = ctx.window;
  vm.runInContext(`let canvasRecorded = false; ${contentBlock('  const recordCourses = () => {', '\n  };\n')} this.recordCourses = recordCourses;`, ctx);
  return ctx;
};
const noUnhandled = async (run) => {
  let unhandled = 0;
  const count = () => { unhandled++; };
  process.on('unhandledRejection', count);
  try { await run(); await settle(); await settle(); } finally { process.off('unhandledRejection', count); }
  assert.equal(unhandled, 0, 'no unhandled rejection');
};

test('switched off while the Moodle module loads: no course read starts, and one does when Glaze is back on', () => noUnhandled(async () => {
  const settings = { enabled: true, enhance: {} };
  const live = { on: true };
  const stored = {};
  const p = page({ stored, settings, live, courses: [{ id: 16, fullname: 'BIO 1100', shortname: 'BIO 1100' }] });
  let release;
  const ctx = recorder(() => new Promise((res) => { release = res; }));
  ctx.recordCourses(); // the sweep starts, Glaze on
  settings.enabled = false; live.on = false; // switched off before the module is in
  release(p.api);
  await settle(); await settle();
  assert.deepEqual(p.asked, [], 'nothing asked while off');
  // Back on: startSweep runs recordCourses again, and this time it reads.
  settings.enabled = true; live.on = true;
  ctx.moodleIn = () => Promise.resolve(p.api);
  ctx.recordCourses();
  await settle(); await settle(); await settle();
  assert.deepEqual(kinds(p), ['enrolled_courses_by_timeline_classification']);
  assert.ok(stored.seenCourses[`moodle:${ORIGIN}/16`]);
  // Switched off after storage was asked, before Moodle is: nothing asked either.
  const q = page({ stored: {}, settings, live });
  const r = q.api.record();
  live.on = false;
  await assert.rejects(r, /off/);
  assert.deepEqual(q.asked, []);
}));

test('a signed-out page or a failed course read is caught, and asked again when the sweep starts again', () => noUnhandled(async () => {
  const p = page({ logout: null });
  let calls = 0;
  const ctx = recorder(() => Promise.resolve({ record: () => { calls++; return p.api.record(); } }));
  await ctx.recordCourses();
  await settle();
  await ctx.recordCourses(); // let go after the failure: the next start asks again
  assert.equal(calls, 2);
  assert.deepEqual(p.asked, [], 'signed out: Moodle never asked');
}));

test('each course card wears its own course\'s Look and tint, painted only on change and taken off with them', () => {
  const k = (id) => `moodle:${ORIGIN}/${id}`;
  const settings = D.GZ_SANITIZE({ enabled: true, look: { radius: 24, depth: 3, surfaceCustom: true, surfaceColor: '#ff0000', surfaceFrost: 40 }, courses: { tint: true, tinted: [k(16)], looks: { [k(17)]: 'Library' } } });
  const list = { [k(16)]: { name: 'BIO', moodle: true, color: '#b2bec3' }, [k(17)]: { name: 'ENG', moodle: true, color: '#fdcb6e' }, [k(18)]: { name: 'MATH', moodle: true, color: '#fd79a8' } };
  const p = page({ cards: [['16'], ['17'], ['18']], settings, list });
  p.api.paint();
  const [bio, eng, math] = p.cards;
  const base = D.GZ_ACTIVE_COLORS(settings, true);
  for (const [key, value] of Object.entries(D.GZ_TINT(base, '#b2bec3', settings.courses.strength / 100))) assert.equal(bio.style.vars[key], value, 'tinted as its pages are');
  assert.equal(bio.dataset.gzCourseLook, 'dark');
  for (const [key, value] of Object.entries(D.GZ_ACTIVE_COLORS(D.GZ_COURSE_LOOK(settings, k(17)), true))) assert.equal(eng.style.vars[key], value, 'its Look');
  assert.equal(bio.style.vars['--gz-surface-color'], '#ff0000'); assert.equal(bio.dataset.gzDepth, '3');
  assert.equal(eng.style.vars['--gz-surface-color'], 'initial', 'own Look clears inherited custom fill');
  assert.equal(eng.style.vars['--gz-surface-grain'], 'none'); assert.equal(eng.style.vars['--gz-radius'], '6px');
  assert.equal(eng.dataset.gzDepth, '1');
  assert.equal(eng.dataset.gzCourseLook, 'light', 'Library is a light Look');
  assert.deepEqual([plain(math.style.vars), math.dataset.gzCourseLook], [{ '--gz-course': '#fd79a8' }, undefined], 'no palette override: known course color remains available');
  // Only on change: a card already painted isn't written again.
  bio.style.setProperty = () => assert.fail('painted again');
  p.api.paint();
  // Unticked and its Look gone: back to the page's palette.
  settings.courses.tinted = [];
  delete settings.courses.looks[k(17)];
  delete bio.style.setProperty;
  bio.style.setProperty = (x, v) => { bio.style.vars[x] = v; };
  p.api.paint();
  assert.deepEqual([plain(bio.style.vars), bio.dataset.gzCourseLook, plain(eng.style.vars), eng.dataset.gzCourseLook], [{ '--gz-course': '#b2bec3' }, undefined, { '--gz-course': '#fdcb6e' }, undefined]);
});

// features/keys.js on Moodle, as content.js hands it keys.
const moodleKeys = ({ id = 'page-course-view-topics', sheet = `${ORIGIN}/theme/styles.php/boost/1/all`, origin = ORIGIN } = {}) => {
  const went = [];
  const document = { body: { id }, querySelector: (sel) => (sel.includes('/theme/styles') ? { href: sheet } : null), addEventListener() {} };
  const ctx = vm.createContext({ solo: false, tabFrame: '',
    document, location: { origin, pathname: '/course/view.php', assign: (u) => went.push(u) }, navigator: { platform: 'MacIntel' }, Date,
    GZ_CTX: { site: 'moodle', settings: () => ({ enhance: { keys: true } }), typing: () => false, keyOn: () => true, wordsIn: new Set(), t: (k) => k },
  });
  vm.runInContext(read('features/keys.js'), ctx);
  const press = (...keys) => { for (const key of keys) ctx.GZ_KEYS.key({ key, target: document.body, preventDefault() {}, stopImmediatePropagation() {} }); };
  return { press, went };
};

test('Moodle\'s shortcuts are Canvas\'s keys, going to Moodle\'s own pages at its root', () => {
  const k = moodleKeys();
  k.press('g', 'd', 'g', 'c', 'g', 'a', 'g', 'g', 'g', 'm');
  assert.deepEqual(k.went, ['/my/', '/my/courses.php', '/calendar/view.php?view=month', '/grade/report/overview/index.php', '/message/index.php'].map((p) => ORIGIN + p));
  const folder = moodleKeys({ sheet: 'https://school.edu/moodle/theme/styles.php/boost/1/all', origin: 'https://school.edu' });
  folder.press('g', 'c');
  assert.deepEqual(folder.went, ['https://school.edu/moodle/my/courses.php']);
});

test('Moodle\'s shortcuts work on its main pages, a course\'s and its activities\', and not where a student is busy', () => {
  const on = (id) => { const k = moodleKeys({ id }); k.press('g', 'd'); return k.went.length === 1; };
  const ids = fixtures.map(({ html }) => html.match(/<body id="([^"]+)"/)[1]);
  for (const id of ids) assert.equal(on(id), id !== 'page-login-index', id);
  for (const id of ['page-course-view-weeks', 'page-course-section', 'page-mod-forum-discuss', 'page-mod-page-view', 'page-mod-resource-view']) assert.ok(on(id), id);
  for (const id of ['page-mod-quiz-attempt', 'page-mod-quiz-review', 'page-mod-forum-post', 'page-course-edit', 'page-course-modedit', 'page-mod-assign-grader', 'page-user-edit', 'page-admin-index', 'page-mod-quiz-view-x']) assert.ok(!on(id), id);
});

test('content.js hands Moodle\'s keys to keys.js, with Canvas\'s guards: not repeated, not taken, not in a menu or dialog', () => {
  const line = read('content.js').match(/^ {2}const keyOn = [^\n]*\n[^\n]*;$/m)[0];
  const keyOn = (site, e, pathname = '/course/view.php') => vm.runInNewContext(`${line} keyOn`, {
    chrome: { runtime: { id: 'glaze' } },
    settings: { enhance: { keys: true } }, observer: {}, typing: () => false, ultra: site === 'ultra', moodle: site === 'moodle', location: { pathname }, GZ_PAGE: require('../lib/page.js'),
  })({ key: 'g', target: { closest: () => null }, ...e });
  assert.ok(keyOn('moodle', {}));
  for (const e of [{ repeat: true }, { defaultPrevented: true }, { ctrlKey: true }, { target: { closest: () => ({}) } }]) assert.ok(!keyOn('moodle', e), JSON.stringify(e));
  assert.ok(!keyOn('canvas', {}), 'Canvas has no such page');
  assert.ok(keyOn('canvas', {}, '/courses/25'));
});

test('Moodle card surface tint uses known colors without whole-palette tint and clears changes while off', () => {
  const key = `moodle:${ORIGIN}/16`, settings = D.GZ_SANITIZE({ courses: { tint: false } });
  const list = { [key]: { color: '#445566' } }, live = { on: true };
  const p = page({ cards: [['16'], ['99']], settings, list, live });
  p.api.paint();
  assert.deepEqual(plain(p.cards[0].style.vars), { '--gz-course': '#445566' });
  assert.deepEqual(plain(p.cards[1].style.vars), {}, 'unknown course does not get an invented color');
  p.cards[0].style.setProperty = () => assert.fail('unchanged color written again');
  p.api.paint();
  p.cards[0].style.setProperty = (k, v) => { p.cards[0].style.vars[k] = v; };
  settings.courses.colors[key] = '#abcdef'; p.api.paint();
  assert.equal(p.cards[0].style.vars['--gz-course'], '#abcdef');
  settings.courses.colors[key] = 'invalid'; delete list[key].color; p.api.paint();
  assert.deepEqual(plain(p.cards[0].style.vars), {}, 'lost records clear the previous color');
  list[key].color = '#112233'; p.api.paint(); live.on = false; p.api.paint();
  assert.deepEqual(plain(p.cards[0].style.vars), {}, 'Glaze off clears the course color');
});
