const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const U = require('../lib/ultra.js');
const S = require('../lib/seek.js');
const D = require('../lib/doctext.js');
const fixture = require('./fixtures/ultra-search.json');
const source = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const origin = 'https://lms.example.edu';
const now = Date.parse('2026-10-15T12:00:00Z');
const course = { id: '_101_1', name: 'BIO 1100' };
const json = (j) => ({ ok: true, text: async () => JSON.stringify(j) });
const settle = () => new Promise(setImmediate);

test('public search lists project only safe fields; bodies become text, unavailable content and hidden ancestors stay out', () => {
  const rows = U.SEARCH_KINDS.flatMap((k) => U.searchItems(k, fixture[k.list], course, D.html, now));
  assert.deepEqual(rows.map((r) => r.title), ['Laboratory', 'Reading: Cell membrane', 'Lab report', 'Lab moved', 'Cell questions']);
  assert.match(rows[1].text, /Résumé & safety notes: mitochondria/);
  assert.doesNotMatch(JSON.stringify(rows), /forbiddenword|files.example.com|isRead|contentDetail|topic/);
  assert.equal(rows[1].url, '/ultra/redirect?redirectType=nautilus&courseId=_101_1&contentId=_701_1');
  assert.equal(rows[3].url, '/ultra/courses/_101_1/announcements');
  assert.equal(rows[4].url, '/ultra/courses/_101_1/engagement');
  assert.deepEqual(U.searchItems(U.SEARCH_KINDS[0], fixture.contents, { id: '../bad' }, D.html), []);
  for (const k of U.SEARCH_KINDS) assert.doesNotMatch(k.fields, /contentDetail|contentHandler|isRead|secret|key|url|links/);
});

test('Ultra shares the Canvas scheduler, course priority, title ranking, deduplication and 24-result cap', async () => {
  const cs = S.order([
    { id: '_1_1', name: 'Old', term: { end_at: '2025-01-01' } },
    { id: '_2_1', name: 'Current', term: {} },
    { id: '_3_1', name: 'Here', term: { end_at: '2025-01-01' } },
  ], '_3_1', now, (id) => /^_\d+_\d+$/.test(id));
  assert.deepEqual(cs.map((c) => c.id), ['_3_1', '_2_1', '_1_1']);
  const got = [];
  const n = await S.search({ term: 'lab', courses: cs, kinds: U.SEARCH_KINDS, conc: 3,
    load: async (c, k) => Array.from({ length: 20 }, (_, i) => ({ key: `${c.id}/${k.kind}/${i}`, title: i ? `Lab ${i}` : 'Lab', kind: k.kind, course: c.name })),
    onBatch: (rs) => got.push(...rs),
  });
  assert.equal(n, 24);
  assert.equal(got.length, 24);
  assert.deepEqual([...new Set(got.map((r) => r.course))], ['Here', 'Current']);
  assert.equal(got[0].title, 'Lab');
});

test('public readers page only the same list, preserve projection, refuse redirects and obey request/page limits', async () => {
  const asked = [];
  const r = U.read({ origin, maxPages: 2, maxRequests: 3, f: async (url, init) => {
    asked.push([new URL(url), init]);
    return json({ results: fixture.contents, paging: { nextPage: '/learn/api/public/v1/courses/_101_1/contents?offset=200&fields=contentDetail' } });
  } });
  await r.search(course, U.SEARCH_KINDS[0], D.html);
  assert.equal(asked.length, 2);
  for (const [u, init] of asked) {
    assert.equal(u.origin, origin);
    assert.equal(u.pathname, '/learn/api/public/v1/courses/_101_1/contents');
    assert.equal(u.searchParams.get('fields'), U.SEARCH_KINDS[0].fields);
    assert.equal(u.searchParams.get('recursive'), 'true');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'same-origin');
  }
  await assert.rejects(r.search(course, U.SEARCH_KINDS[0], D.html), /budget/);
  assert.equal(asked.length, 3);
  let repeated = 0;
  await U.read({ origin, f: async () => { repeated++; return json({ results: [], paging: { nextPage: '/learn/api/public/v1/courses/_101_1/contents?fields=contentDetail' } }); } }).search(course, U.SEARCH_KINDS[0], D.html);
  assert.equal(repeated, 1, 'a repeated page cannot spend the budget or crowd out unique results');
  for (const nextPage of [origin + '/learn/api/v1/courses/_101_1/discussions/_901_1', 'https://other.invalid/learn/api/public/v1/courses/_101_1/contents', '/learn/api/public/v1/courses/_101_1/contents/_701_1']) {
    let count = 0;
    const reader = U.read({ origin, f: async () => { count++; return json({ results: [], paging: { nextPage } }); } });
    await reader.search(course, U.SEARCH_KINDS[0], D.html);
    assert.equal(count, 1, nextPage);
  }
});

// The actual shared search UI, with synthetic API responses and a minimal palette DOM.
const ui = ({ hold = false, count = 2, loading = null } = {}) => {
  const timers = [], requests = [], changed = [], pending = [];
  const settings = { enhance: { search: true } };
  const live = { setAttribute() {}, textContent: '' };
  const cmd = { box: { isConnected: true }, input: { value: '', addEventListener(_, fn) { this.change = fn; } }, list: { after() {} }, shown: [] };
  const memberships = Array.from({ length: count }, (_, i) => ({ courseId: `_${i + 101}_1`, courseCardColorIndex: i,
    course: { name: `Course ${i + 1}`, displayId: `C${i + 1}`, term: { id: '_1_1', name: 'Current' } } }));
  const ctx = vm.createContext({
    GZ_CTX: { site: 'ultra', on: () => true, settings: () => settings, t: (k, v) => k.replace('{n}', v?.n),
      need: async () => { if (loading) await loading; }, courseId: () => '_102_1' },
    GZ_PAGE: require('../lib/page.js'), GZ_COURSES: require('../defaults.js').GZ_COURSES,
    chrome: { runtime: {}, storage: { onChanged: { addListener: (fn) => changed.push(fn) }, sync: { get: (_, fn) => fn({ enabled: true, enhance: { search: true } }) } } },
    document: { createElement: () => live }, location: { origin, assign() {} },
    fetch: async (url, init) => {
      requests.push({ url, init });
      const u = new URL(url);
      if (u.pathname.endsWith('/users/me')) return json({ id: '_999_1' });
      if (u.pathname.endsWith('/memberships')) return json({ results: memberships });
      if (u.pathname.endsWith('/terms')) return json({ results: [] });
      if (hold) await new Promise((resolve, reject) => {
        pending.push(resolve);
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return json({ results: count > 2 ? [] : fixture[u.pathname.split('/').at(-1)] || [] });
    },
    setTimeout: (fn, ms) => { const x = { fn, ms }; timers.push(x); return x; }, clearTimeout: (x) => { if (x) x.fn = null; },
    AbortController, URL, URLSearchParams, Date,
  });
  for (const f of ['lib/seek.js', 'lib/doctext.js', 'lib/ultra.js', 'features/search.js']) vm.runInContext(source(f), ctx);
  const type = async (value, run = true) => {
    cmd.input.value = value;
    cmd.input.change();
    if (run) for (const timer of timers.splice(0)) timer.fn?.();
    for (let i = 0; i < 30; i++) await settle();
  };
  return { cmd, live, requests, timers, settings, attach: () => ctx.GZ_SEARCH.attach(cmd, () => {}), type,
    change: (ch) => changed.forEach((fn) => fn(ch, 'sync')), release: () => pending.splice(0).forEach((fn) => fn()) };
};

test('Ultra palette debounces, matches public body text and accents, prioritizes the current course, and reuses per-course lists across queries', async () => {
  const p = ui();
  await p.attach();
  await p.type('l');
  assert.equal(p.requests.length, 0);
  await p.type('lab', false);
  assert.equal(p.requests.length, 0);
  assert.equal(p.timers[0].ms, 150);
  await p.type('lab');
  assert.equal(p.requests.length, 9, 'identity, memberships, terms, and three lists per course');
  assert.ok(p.requests[3].url.includes('/courses/_102_1/contents?'), 'current course first');
  assert.equal(p.cmd.found.length, 8, 'title matches and the discussion opening post');
  assert.equal(p.live.textContent, 'Results from your courses: 8');
  await p.type('resume');
  assert.equal(p.requests.length, 9, 'a different query searches the same cached lists');
  assert.deepEqual(Array.from(p.cmd.found, (r) => r.label), ['Reading: Cell membrane', 'Reading: Cell membrane']);
  assert.equal(p.cmd.found[0].hint, 'C2');
  await p.type('forbiddenword');
  assert.equal(p.cmd.found.length, 0, 'script text is never searched');
  assert.equal(p.live.textContent, 'Nothing found in your courses.');
});

test('Ultra cancels requests on typing, close and disabling search, without showing old answers', async () => {
  const p = ui({ hold: true });
  await p.attach();
  await p.type('lab');
  const first = p.requests.slice(3);
  assert.equal(first.length, 3, 'three lists at a time');
  await p.type('resume', false);
  assert.ok(first.every((r) => r.init.signal.aborted));
  p.release();
  await settle();
  assert.equal(p.cmd.found.length, 0);
  await p.type('resume');
  p.cmd.stop();
  assert.ok(p.requests.every((r) => r.init.signal.aborted));
  await p.type('safety');
  const asks = p.requests.length;
  p.change({ enhance: { newValue: { search: false } } });
  assert.ok(p.requests.every((r) => r.init.signal.aborted));
  await p.type('cells');
  assert.equal(p.requests.length, asks);
  assert.equal(p.cmd.found, null);
  p.release();
});

test('Ultra bounds empty queries to 30 requests and never asks threads, attempts or private contents', async () => {
  const p = ui({ count: 30 });
  await p.attach();
  await p.type('zz');
  assert.equal(p.requests.length, 30);
  assert.equal(p.cmd.seeking, false);
  assert.equal(p.cmd.found.length, 0);
  for (const { url } of p.requests.slice(3)) {
    assert.match(new URL(url).pathname, /^\/learn\/api\/public\/v1\/courses\/_\d+_1\/(contents|announcements|discussions)$/);
    assert.doesNotMatch(url, /contentDetail|contentHandler|attempt|thread|message/);
  }
});

test('Ultra search stays on demand, with the existing palette accessibility and translations', () => {
  const manifest = require('../manifest.json');
  for (const c of manifest.content_scripts) assert.ok(!c.js.some((f) => /features\/search|lib\/(seek|ultra|doctext)/.test(f)));
  assert.match(source('features/palette.js'), /const searchHere = \(\) => !moodle && ctx.settings\(\).enhance.search/);
  for (const name of ['de', 'es', 'fr', 'nl', 'pt-BR']) {
    const ctx = vm.createContext({});
    vm.runInContext(source(`i18n/${name}.js`), ctx);
    for (const key of ['Search in your courses', 'Searching your courses…', 'Results from your courses: {n}', 'Nothing found in your courses.', 'Page', 'Announcement', 'Discussion']) assert.ok(ctx.GZ_LANGS[name][key], `${name}: ${key}`);
  }
  assert.match(source('features/palette.js'), /\['role', 'combobox'\]/);
  assert.match(source('features/search.js'), /setAttribute\('aria-live', 'polite'\)/);
});
