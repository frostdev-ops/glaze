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
  const course = { id: '1', name: 'BIO', enrollments: [{ type: 'student' }], term: { id: 5, name: 'Fall', start_at: '2026-08-24T04:00:00Z', end_at: '2027-12-19T05:00:00Z' } };
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
  return { S, ui, fetches, sent, say, drawn, find };
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
