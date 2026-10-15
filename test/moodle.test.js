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
test('a Moodle host is injected now and registered from then on, apart from Canvas hosts', async () => {
  const store = { canvas: ['https://canvas.school.edu/*'] };
  const injected = [], registered = [];
  let message;
  const none = { addListener() {} };
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout,
    importScripts: (file) => vm.runInContext(read(path.join('lib', file)), context),
    chrome: {
      runtime: { id: 'id', getURL: (p = '') => `chrome-extension://id/${p}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => { message ||= []; message.push(f); } }, onInstalled: none, onStartup: none, onConnect: none },
      storage: { local: { get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]])), set: async (o) => Object.assign(store, o) }, sync: { get: async () => ({}) }, onChanged: none },
      scripting: {
        executeScript: async (o) => { injected.push(o); return [{ result: {} }]; },
        getRegisteredContentScripts: async () => registered.map((id) => ({ id })),
        registerContentScripts: async (list) => { for (const s of list) { assert.ok(!registered.includes(s.id), `registered twice: ${s.id}`); registered.push(s.id); } },
      },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = async (m, url) => { for (const f of message) f(m, { tab: { id: 4 }, frameId: 0, url }, () => {}); await settle(); await settle(); };
  await send('moodle', 'https://moodle.school.edu/my/');
  assert.deepEqual(injected.map((o) => o.files), [require('../manifest.json').content_scripts[0].js], 'the whole first content script, into that page');
  assert.deepEqual(plain(store.moodle), ['https://moodle.school.edu/*']);
  assert.deepEqual(plain(store.canvas), ['https://canvas.school.edu/*'], 'the Canvas list (which Download all trusts) is untouched');
  assert.deepEqual(registered.sort(), ['https://canvas.school.edu/*', 'https://moodle.school.edu/*']);
  await send('moodle', 'https://moodle.school.edu/course/view.php?id=2');
  assert.deepEqual(plain(store.moodle), ['https://moodle.school.edu/*'], 'a host once');
  await send('blackboard', 'https://x.edu/');
  assert.equal(injected.length, 2, 'only the two LMSs it knows');
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
const page = ({ logout = `${ORIGIN}/login/logout.php?sesskey=abc123`, cards = [], settings = { enabled: true, enhance: { overall: true } }, overview = '' } = {}) => {
  const asked = [];
  const el = (attrs = {}) => ({ attrs, getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; } });
  const cardEls = cards.map(([id, name = true]) => { const name_ = name && el(); return { dataset: { courseId: id }, querySelector: () => name_, name: name_ }; });
  const document = {
    querySelector: (sel) => (sel.includes('logout.php') && logout ? { href: logout } : null),
    querySelectorAll: (sel) => (sel.includes('course-content') ? cardEls : []),
  };
  const context = vm.createContext({
    URL, Promise, JSON, document, location: { origin: ORIGIN },
    GZ_MOODLE: M, GZ_PAGE: { score }, GZ_CTX: { t: (k) => k, settings: () => settings },
    fetch: async (url, opts = {}) => { asked.push({ url, ...opts }); return { ok: true, status: 200, text: async () => overview, json: async () => [{ error: false, data: { events: [], courses: [] } }] }; },
  });
  context.globalThis = context;
  const api = vm.runInContext(read('features/moodle.js'), context);
  return { api, asked, cards: cardEls, context };
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
  assert.deepEqual(p.asked.map((a) => [a.url, a.method, a.credentials]), [
    [`${ORIGIN}/moodle/lib/ajax/service.php?sesskey=k1&info=core_calendar_get_action_events_by_timesort`, 'POST', 'same-origin'],
    [`${ORIGIN}/moodle/lib/ajax/service.php?sesskey=k1&info=core_course_get_enrolled_courses_by_timeline_classification`, 'POST', 'same-origin'],
  ]);
  assert.deepEqual(JSON.parse(p.asked[0].body)[0].args, { timesortfrom: 1792050235, timesortto: 1792050235 + 7 * 86400, limitnum: 50, limittononsuspendedevents: true });
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
  const first = require('../manifest.json').content_scripts[0].js;
  for (const f of ['lib/moodle.js', 'features/moodle.js']) assert.ok(list.includes(f) && !first.includes(f), f);
  const context = vm.createContext({ URL, document: {}, location: { origin: ORIGIN } });
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
