// Insights' loading (features/insights.js) on a small stand-in for the page: what it asks Canvas for, and when it stops.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../features/insights.js'), 'utf8');
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const later = () => { let resolve, reject; const p = new Promise((y, n) => { resolve = y; reject = n; }); return Object.assign(p, { resolve, reject }); };
const ORIGIN = 'https://school.instructure.com';

class El {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], listeners: {}, className: '', textContent: '', dataset: {}, style: {} }); }
  append(...k) { this.children.push(...k.filter((x) => x != null && x !== '')); }
  prepend(...k) { this.children.unshift(...k); }
  replaceChildren(...k) { this.children = k; }
  setAttribute() {}
  addEventListener(type, f) { (this.listeners[type] ||= []).push(f); }
  querySelector(sel) {
    for (const c of this.children) {
      if (!(c instanceof El)) continue;
      if (sel.startsWith('.') ? c.className.split(' ').includes(sel.slice(1)) : c.tagName === sel.toUpperCase()) return c;
      const deep = c.querySelector(sel);
      if (deep) return deep;
    }
    return null;
  }
  showModal() {}
  focus() {}
  remove() {}
  close() { for (const f of this.listeners.close || []) f(); }
  get isConnected() { return true; }
}

// One page with Insights on; fetches wait until the test answers them. kept: what storage.local holds.
const page = ({ kept = {} } = {}) => {
  const S = { enabled: true, enhance: { insights: true, streak: false } };
  const fetches = [], sent = [];
  const course = { id: '1', name: 'BIO', enrollments: [{ type: 'student' }], term: { id: 5, name: 'Fall', start_at: '2026-08-24T04:00:00Z', end_at: '2099-12-19T05:00:00Z' } };
  const drawn = []; // text the summary picture draws
  const canvas = () => Object.assign(new El('canvas'), {
    getContext: () => ({ fillText: (s) => drawn.push(s), measureText: () => ({ width: 0 }), fillRect() {}, beginPath() {}, roundRect() {}, fill() {} }),
    toBlob: (cb) => cb(null),
  });
  const doc = { body: new El('body'), activeElement: null, createElement: (t) => (t === 'canvas' ? canvas() : new El(t)), createElementNS: (ns, t) => new El(t) };
  const context = vm.createContext({
    GZ_CTX: { t: (k) => k, locale: () => 'en', on: () => true, settings: () => S, need: () => Promise.resolve(),
      profile: async () => ({ id: '3', time_zone: 'America/New_York' }), canvasCourses: async () => [course] },
    GZ_TODO: require('../lib/todo.js'), GZ_GRADECALC: require('../lib/gradecalc.js'), GZ_INSIGHTS: require('../lib/insights.js'), GZ_I18N: require('../lib/i18n.js'),
    chrome: { runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true }; } }, storage: { local: { get: (k, cb) => cb(kept) } } },
    document: doc, location: { origin: ORIGIN, pathname: '/' }, window: {}, navigator: {}, URL, Date, Promise, JSON, setTimeout,
    getComputedStyle: () => ({ getPropertyValue: () => '', fontFamily: '' }),
    fetch: (url, init) => { const r = later(); fetches.push({ url, init, r }); return r; },
  });
  context.window.top = context.window;
  const ui = vm.runInContext(source, context);
  const say = () => doc.body.children[0]?.querySelector('.gz-ins-say')?.textContent;
  const find = (text, el = doc.body) => el.textContent === text ? el : el.children.filter((c) => c instanceof El).map((c) => find(text, c)).find(Boolean);
  return { S, ui, fetches, sent, say, drawn, find, doc };
};
const reply = (body, link) => ({ ok: true, text: async () => JSON.stringify(body), headers: { get: (h) => (h === 'link' && link ? link : null) } });
const GROUPS = [{ id: 1, assignments: [{ id: 7, name: 'Lab', points_possible: 10, published: true, due_at: '2026-09-10T20:00:00Z', submission: { score: 9, workflow_state: 'graded', submitted_at: '2026-09-09T20:00:00Z' } }] }];

test('a page held while Insights is turned off: the next page is never asked for', async () => {
  const p = page();
  p.ui.open();
  await settle();
  assert.equal(p.fetches.length, 1);
  assert.match(p.fetches[0].url, /\/api\/v1\/courses\/1\/assignment_groups\?/);
  p.S.enabled = false;
  p.fetches[0].r.resolve(reply(GROUPS, `<${ORIGIN}/api/v1/courses/1/assignment_groups?page=2>; rel="next"`));
  await settle();
  assert.equal(p.fetches.length, 1, 'no second page');
  assert.ok(!p.sent.some((m) => m.op === 'put'), 'nothing kept');
});

test("Insights opened from Glaze's bar (its palette) gives focus back to the bar's item, not the bar's host", async () => {
  const p = page();
  let back = null;
  const item = { isConnected: true, focus: () => { back = item; } }, host = { isConnected: true, shadowRoot: { activeElement: item }, focus: () => { back = host; } };
  p.doc.activeElement = host; // the document sees only the host of the bar's shadow root
  await p.ui.open();
  p.doc.body.children[0].close();
  assert.equal(back, item);
});

test('a closed view stops paging too', async () => {
  const p = page();
  p.ui.open();
  await settle();
  p.S.enhance.insights = false; // the dialog closes through sync()
  p.ui.sync();
  p.fetches[0].r.resolve(reply(GROUPS, `<${ORIGIN}/api/v1/courses/1/assignment_groups?page=2>; rel="next"`));
  await settle();
  assert.equal(p.fetches.length, 1);
});

test('every request refuses redirects; a next page on another site is never asked for', async () => {
  const p = page();
  p.ui.open();
  await settle();
  p.fetches[0].r.resolve(reply(GROUPS, '<https://elsewhere.example/api/v1/x?page=2>; rel="next"'));
  await settle();
  assert.equal(p.fetches.length, 1);
  assert.ok(p.fetches.every((f) => f.init.redirect === 'error' && f.init.credentials === 'same-origin'));
  const put = p.sent.find((m) => m.op === 'put');
  assert.equal(put.rec.courses[0].items.length, 1);
  assert.equal(put.rec.courses[0].more, false);
});

test('a redirect fails the load: the saved summary stays, shown and kept, and the error is said', async () => {
  const key = `insights:${ORIGIN}/3`;
  const old = { term: '5', name: 'Fall', at: Date.now() - 7 * 36e5, cl: 0, courses: [{ id: '1', name: 'BIO', items: [], trend: [] }] };
  const p = page({ kept: { [key]: old } });
  p.ui.open();
  await settle();
  assert.equal(p.fetches.length, 1, 'six hours old: asked again');
  p.fetches[0].r.reject(new TypeError('Failed to fetch')); // what redirect: 'error' does with a redirect
  await settle();
  assert.equal(p.say(), "Couldn't read your courses. Try again in a moment.");
  assert.ok(p.ui && p.fetches[0].init.redirect === 'error');
  assert.ok(!p.sent.some((m) => m.op === 'put'), 'the saved summary is not replaced');
});

test('the saved picture of a summary that left work out says so, as the dialog does', async () => {
  const key = `insights:${ORIGIN}/3`;
  const rec = (cut) => ({ term: '5', name: 'Fall', at: Date.now(), cl: 0, courses: [{ id: '1', name: 'BIO', cut, items: [], trend: [] }] });
  for (const [cut, says] of [[1, true], [0, false]]) {
    const p = page({ kept: { [key]: rec(cut) } });
    p.ui.open();
    await settle();
    assert.equal(p.fetches.length, 0, 'fresh: drawn from what is saved');
    for (const f of p.find('Save as picture').listeners.click) f({ isTrusted: true });
    assert.ok(p.drawn.includes('Your term in numbers'));
    assert.equal(p.drawn.includes("Some work couldn't be counted, so these figures leave it out."), says);
  }
});

// ---- Blackboard Ultra (B4): the same view, from Ultra through lib/ultra.js ----
const UO = 'https://lms.example.edu';
const ufix = (n) => JSON.parse(fs.readFileSync(require.resolve(`./fixtures/ultra-${n}.json`), 'utf8'));
const U_NOW = Date.parse('2026-10-15T12:00:00Z'); // in the fixtures' Fall 2026 term
class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [U_NOW])); } static now() { return U_NOW; } }
const ultraPage = ({ partial = false } = {}) => {
  const S = { enabled: true, enhance: { insights: true, streak: false } };
  const asked = [], sent = [];
  // Ultra's header tools, and B5's panel bar (features/widgets.js) with its What Glaze can do.
  const tools = new El('div'), bar = new El('div');
  bar.append(Object.assign(new El('button'), { textContent: 'What Glaze can do' }));
  const doc = { body: new El('body'), activeElement: null, createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t),
    querySelector: (sel) => ({ 'div.base-courses-header-container div.base-header-tools': tools, '#gz-toolbar': bar })[sel] || null };
  const books = { _101_1: ufix('grades'), _102_1: ufix('grades-status') };
  if (partial) books._101_1.paging = { nextPage: '?offset=200' };
  const context = vm.createContext({
    GZ_CTX: { site: 'ultra', t: (k) => k, locale: () => 'en', on: () => true, settings: () => S, need: () => Promise.resolve(), myCourses: async () => ufix('memberships').results },
    GZ_TODO: require('../lib/todo.js'), GZ_GRADECALC: require('../lib/gradecalc.js'), GZ_INSIGHTS: require('../lib/insights.js'), GZ_I18N: require('../lib/i18n.js'),
    GZ_PAGE: require('../lib/page.js'), GZ_COURSES: require('../defaults.js').GZ_COURSES,
    chrome: { runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true }; } }, storage: { local: { get: (k, cb) => cb({}) } } },
    document: doc, location: { origin: UO, pathname: '/ultra/course' }, window: {}, navigator: {}, URL, Date: FixedDate, Promise, JSON, setTimeout, Intl,
    getComputedStyle: () => ({ getPropertyValue: () => '', fontFamily: '' }),
    fetch: async (url, init) => {
      asked.push({ url: url.replace(UO, ''), init });
      const cid = url.match(/courses\/(_\d+_\d+)\/gradebook\/grades/)?.[1];
      const body = cid ? books[cid] || { results: [] } : /\/exceptions\?/.test(url) ? { results: [] } : null;
      return body ? { ok: true, text: async () => JSON.stringify(body) } : { ok: false, status: 404 };
    },
  });
  context.window.top = context.window;
  vm.runInContext(fs.readFileSync(require.resolve('../lib/ultra.js'), 'utf8'), context);
  const ui = vm.runInContext(source, context);
  return { ui, asked, sent, tools, bar, S, doc };
};

test('GZ-01: Insights retains a partial marker and withholds grade trends for a capped gradebook', async () => {
  const p = ultraPage({ partial: true });
  p.ui.open(); await settle(50);
  const course = p.sent.find((m) => m.op === 'put')?.rec.courses.find((c) => c.id === '_101_1');
  assert.ok(course, 'retain useful work summaries');
  assert.equal(course.more, true);
  assert.deepEqual([...course.trend], [], 'a partial gradebook cannot establish the course trend');
  assert.equal(p.asked.filter((a) => a.url.includes('/courses/_101_1/gradebook/grades')).length, 10, 'retain the page cap');
  const texts = (el) => [el.textContent, ...(el.children || []).flatMap(texts)].join(' ');
  assert.ok(texts(p.doc.body).includes("Some work couldn't be counted, so these figures leave it out:"));
});

test("on Ultra: a button in the Courses page's header, and this term read from Ultra, each course's gradebook", async () => {
  const p = ultraPage();
  p.ui.sync();
  assert.equal(p.tools.children[0]?.textContent, 'Insights', 'no panel (notes and widgets off): in the header');
  assert.equal(p.tools.children[0].className, 'gz-w-small gz-ins-open');
  // With Glaze's panel on, in its bar, after What Glaze can do (append moves it: one button).
  p.S.enhance.widgets = true;
  p.ui.sync();
  assert.deepEqual(p.bar.children.map((b) => b.textContent), ['What Glaze can do', 'Insights']);
  p.ui.open();
  await settle(30);
  // Every request a GET to this Ultra's API, redirects refused: the four courses' gradebooks, and one course's due-date
  // exceptions, asked only because it has late work.
  assert.ok(p.asked.every((a) => a.init.method === 'GET' && a.init.redirect === 'error' && a.url.startsWith('/learn/api/v1/')));
  assert.equal(p.asked.filter((a) => /gradebook\/grades\?/.test(a.url)).length, 4);
  assert.deepEqual(p.asked.filter((a) => /exceptions/.test(a.url)).map((a) => a.url), ['/learn/api/v1/courses/_102_1/gradebook/memberships/_302_1/exceptions?columnId=_612_1']);
  const put = p.sent.find((m) => m.op === 'put');
  assert.equal(put.key, `${'insights:'}${UO}/_900_1`);
  assert.equal(put.rec.name, 'Fall 2026');
  const by = Object.fromEntries(put.rec.courses.map((c) => [c.id, c]));
  assert.deepEqual([...by._102_1.items.map((i) => i.s)], ['on', 'late', 'open']);
  assert.equal(by._101_1.trend.at(-1)[1], 88, "Blackboard's own overall grade is the trend's last point");
});
