// lib/writer-lookup.js: what a pasted DOI, ISBN or address becomes, the worker's fetch (who may ask, which hosts need the
// student's grant, limits), and the parsers over saved synthetic responses (test/fixtures/writer-cite-*, each _note says
// whose shape it copies). lib/writer-sources.js normalize, add and the storage key, too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/writer-lookup.js');
const S = require('../lib/writer-sources.js');
const C = require('../lib/writer-cite.js');

const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
// Node has no DOMParser: the pieces facts() reads from a parsed page, taken out of the fixture by pattern. The browser check
// (scripts/writer-cite-check.js) runs facts() itself on these files through DOMParser and compares.
const factsOf = (html) => {
  const attr = (tag, a) => (new RegExp(`\\s${a}="([^"]*)"`, 'i').exec(tag) || [])[1];
  const metas = [...html.matchAll(/<meta\s[^>]*>/gi)].map(([tag]) => [(attr(tag, 'name') || attr(tag, 'property') || '').toLowerCase(), attr(tag, 'content')]).filter(([k, v]) => k && v != null);
  return { metas, jsonld: [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1]), title: (/<title>([^<]*)<\/title>/i.exec(html) || [])[1] || '',
    canonical: attr((/<link rel="canonical"[^>]*>/i.exec(html) || [''])[0], 'href') || '', text: '' };
};
const NOW = new Date(2026, 9, 27);

test('what the student pastes: a DOI (bare, doi:, or a doi.org link), an ISBN-10 or -13 with its check digit, an https page', () => {
  assert.deepEqual(L.classify('10.1037/ppm0000185'), { kind: 'doi', value: '10.1037/ppm0000185' });
  assert.deepEqual(L.classify('doi: 10.1086/690235.'), { kind: 'doi', value: '10.1086/690235' });
  assert.deepEqual(L.classify('https://doi.org/10.1016/S0140-6736(10)60175-4'), { kind: 'doi', value: '10.1016/S0140-6736(10)60175-4' });
  assert.deepEqual(L.classify('ISBN 0-306-40615-2'), { kind: 'isbn', value: '9780306406157' });
  assert.deepEqual(L.classify('978-0-306-40615-7'), { kind: 'isbn', value: '9780306406157' });
  assert.equal(L.classify('978-0-306-40615-8')?.kind, undefined, 'a wrong check digit is no ISBN');
  assert.deepEqual(L.classify('www.nytimes.com/2019/03/22/health/memory.html#top'), { kind: 'url', value: 'https://www.nytimes.com/2019/03/22/health/memory.html' });
  assert.deepEqual(L.classify('http://example.org/page'), { kind: 'url', value: 'https://example.org/page' });
  for (const no of ['', 'Morrison', 'http://localhost/x', 'https://127.0.0.1/', 'https://192.168.1.1/admin', 'https://intranet/', 'https://printer.local/', 'https://u:p@site.org/', 'https://site.org:8443/', 'javascript:alert(1)', 'file:///etc/passwd'])
    assert.equal(L.classify(no), null, no);
});

test('requests: doi.org with CSL-JSON, Open Library\'s books API, the page itself; only these, and only a page needs a grant', () => {
  assert.deepEqual(L.request('doi', '10.1016/S0140-6736(10)60175-4'), { url: 'https://doi.org/10.1016/S0140-6736(10)60175-4', accept: 'application/vnd.citationstyles.csl+json', json: true, open: true });
  assert.deepEqual(L.request('isbn', '9780306406157'), { url: 'https://openlibrary.org/api/books?bibkeys=ISBN:9780306406157&format=json&jscmd=data', accept: 'application/json', json: true, open: true });
  assert.deepEqual(L.request('url', 'https://example.org/page'), { url: 'https://example.org/page', accept: 'text/html,application/xhtml+xml', json: false, open: false });
  assert.equal(L.request('doi', '10.1/x?y#z'), null);
  assert.equal(L.request('isbn', '0306406152'), null, 'the frame sends the ISBN-13 it classified');
  assert.equal(L.request('url', 'https://localhost/'), null);
  assert.equal(L.request('url', 'http://example.org/'), null);
  assert.equal(L.request('fetch', 'https://example.org/'), null);
});

const PAGE = 'chrome-extension://gz/writer.html';
const env = (over = {}) => ({ id: 'gz', page: PAGE, reach: async () => false, calls: [], ...over });
const sender = { id: 'gz', url: `${PAGE}#x`, tab: { id: 1 }, frameId: 3 };
const response = (body, { status = 200, type = 'application/json', url } = {}) => {
  const bytes = Buffer.from(body);
  return { ok: status >= 200 && status < 300, status, url, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : k.toLowerCase() === 'content-length' ? String(bytes.length) : null) },
    body: { getReader: () => { let sent = 0; return { read: async () => (sent < bytes.length ? { done: false, value: bytes.subarray(sent, (sent += 65536)) } : { done: true }), cancel: async () => {} }; } } };
};

test('the worker\'s fetch: writer.html only; doi.org and Open Library without a grant, a page only with its host held', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push([url, init]); return response(fixture('writer-cite-doi.json'), { url, type: 'application/vnd.citationstyles.csl+json' }); };
  for (const s of [null, { ...sender, id: 'other' }, { ...sender, url: 'chrome-extension://gz/options.html' }, { ...sender, url: 'https://bb.school.edu/writer.html' }])
    assert.deepEqual(await L.serve({ kind: 'doi', value: '10.5555/gz.2026.001' }, s, env({ fetch })), { ok: false, error: 'sender' });
  const r = await L.serve({ kind: 'doi', value: '10.5555/gz.2026.001' }, sender, env({ fetch }));
  assert.equal(r.ok, true);
  assert.equal(r.text, fixture('writer-cite-doi.json'));
  const [url, init] = calls.at(-1);
  assert.equal(url, 'https://doi.org/10.5555/gz.2026.001');
  assert.deepEqual({ ...init, signal: !!init.signal }, { method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/vnd.citationstyles.csl+json' }, signal: true });
  // A page: refused while its host isn't held, and nothing is fetched.
  const before = calls.length;
  assert.deepEqual(await L.serve({ kind: 'url', value: 'https://news.example.com/a' }, sender, env({ fetch })), { ok: false, error: 'host' });
  assert.equal(calls.length, before);
  const asked = [];
  const page = await L.serve({ kind: 'url', value: 'https://news.example.com/a' }, sender, env({ reach: async (u) => { asked.push(u); return true; }, fetch: async () => response(fixture('writer-cite-page.html'), { type: 'text/html; charset=utf-8', url: 'https://news.example.com/a' }) }));
  assert.deepEqual(asked, ['https://news.example.com/a']);
  assert.equal(page.ok, true);
  assert.match(page.text, /NewsArticle/);
});

test('the worker\'s limits: 2 MB (a page is cut there, JSON refused), the right content type, https to the end, status and timeouts', async () => {
  const big = `<html><head><title>x</title></head><body>${'a'.repeat(3 << 20)}</body></html>`;
  const held = { reach: async () => true };
  const cut = await L.serve({ kind: 'url', value: 'https://e.org/' }, sender, env({ ...held, fetch: async () => response(big, { type: 'text/html' }) }));
  assert.equal(cut.ok, true);
  assert.equal(cut.text.length, 2 << 20);
  assert.deepEqual(await L.serve({ kind: 'doi', value: '10.5555/x' }, sender, env({ fetch: async () => { const r = response(`{"a":"${'b'.repeat(3 << 20)}"}`); r.headers.get = (k) => (k === 'content-type' ? 'application/json' : null); return r; } })), { ok: false, error: 'size' });
  assert.deepEqual(await L.serve({ kind: 'url', value: 'https://e.org/' }, sender, env({ ...held, fetch: async () => response('{}', { type: 'application/json' }) })), { ok: false, error: 'type' });
  assert.deepEqual(await L.serve({ kind: 'isbn', value: '9780306406157' }, sender, env({ fetch: async () => response('<html>', { type: 'text/html' }) })), { ok: false, error: 'type' });
  assert.deepEqual(await L.serve({ kind: 'url', value: 'https://e.org/' }, sender, env({ ...held, fetch: async () => response('<html>', { type: 'text/html', url: 'http://e.org/' }) })), { ok: false, error: 'failed' });
  assert.deepEqual(await L.serve({ kind: 'doi', value: '10.5555/x' }, sender, env({ fetch: async () => response('', { status: 404 }) })), { ok: false, error: 'missing' });
  assert.deepEqual(await L.serve({ kind: 'doi', value: '10.5555/x' }, sender, env({ fetch: async () => response('', { status: 503 }) })), { ok: false, error: 'status', status: 503 });
  assert.deepEqual(await L.serve({ kind: 'doi', value: '10.5555/x' }, sender, env({ fetch: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } })), { ok: false, error: 'timeout' });
  assert.deepEqual(await L.serve({ kind: 'doi', value: '10.5555/x' }, sender, env({ fetch: async () => { throw new TypeError('Failed to fetch'); } })), { ok: false, error: 'failed' });
});

test('doi.org CSL-JSON → a journal article, the title\'s markup down to its italics, the doi.org link dropped for the DOI', () => {
  const s = L.fromCSL(fixture('writer-cite-doi.json'));
  assert.equal(s.type, 'article-journal');
  assert.equal(s.title, 'Rememory and the River in <i>Beloved</i>');
  assert.deepEqual(s.author, [{ family: 'Okafor', given: 'Ana' }, { family: 'Park', given: 'Lee' }]);
  assert.deepEqual([s['container-title'], s.volume, s.issue, s.page, s.DOI, s.URL], ['Journal of Synthetic Studies', '42', '2', '113–131', '10.5555/gz.2026.001', undefined]);
  assert.deepEqual(s.issued, { 'date-parts': [[2019, 6]] });
  assert.equal(C.format(s, 'apa7').entry, 'Okafor, A., &amp; Park, L. (2019). Rememory and the River in <i>Beloved</i>. <i>Journal of Synthetic Studies</i>, <i>42</i>(2), 113–131. https://doi.org/10.5555/gz.2026.001');
  assert.equal(L.fromCSL('not json'), null);
  assert.equal(L.fromCSL('[1]'), null);
  assert.equal(L.fromCSL({ type: 'book-chapter', title: 'A chapter', author: [{ family: 'X' }], 'container-title': ['The Book'] }).type, 'chapter');
});

test('Open Library → a book: subtitle joined, author split, publisher, place and year', () => {
  const s = L.fromOpenLibrary(fixture('writer-cite-openlibrary.json'), '9780306406157');
  assert.deepEqual({ ...s, id: undefined }, { id: undefined, type: 'book', title: 'The River Keeps: A novel', author: [{ family: 'Rivera', given: 'Alex' }], publisher: 'Plume', 'publisher-place': 'New York', issued: { 'date-parts': [[1988]] }, ISBN: '9780306406157' });
  assert.equal(C.format(s, 'chicago17').entry, 'Rivera, Alex. <i>The River Keeps: A novel</i>. New York: Plume, 1988.');
  assert.equal(L.fromOpenLibrary('{}', '9780306406157'), null);
});

test('a page\'s metadata: JSON-LD NewsArticle over og:, the site name off the <title>, an author link ignored, read today', () => {
  const s = L.fromFacts(factsOf(fixture('writer-cite-page.html')), 'https://news.example.com/2019/03/22/forgetting.html?utm=x', NOW);
  assert.deepEqual({ ...s, id: undefined }, { id: undefined, type: 'article-newspaper', title: 'Can We Get Better at Forgetting?', author: [{ family: 'Carey', given: 'Benedict' }], 'container-title': 'The Daily Synthetic',
    issued: { 'date-parts': [[2019, 3, 22]] }, accessed: { 'date-parts': [[2026, 10, 27]] }, URL: 'https://news.example.com/2019/03/22/forgetting.html' });
  assert.equal(C.format(s, 'mla9').entry, 'Carey, Benedict. “Can We Get Better at Forgetting?” <i>The Daily Synthetic</i>, 22 Mar. 2019, news.example.com/2019/03/22/forgetting.html.');
  // citation_* (journal platforms) win over everything else.
  const j = L.fromFacts(factsOf(fixture('writer-cite-journal.html')), 'https://journal.example.org/article/1', NOW);
  assert.deepEqual([j.type, j.title, j.author, j.page, j.DOI, j.publisher, j.issued], ['article-journal', 'Rememory and the River', [{ family: 'Okafor', given: 'Ana' }, { family: 'Park', given: 'Lee' }], '113–131', '10.5555/gz.2026.001', 'Synthetic University Press', { 'date-parts': [[2019, 6, 1]] }]);
  assert.equal(L.thin(j), false);
  // Only a <title>: a web page with the title, flagged thin (the AI fallback's cue).
  const bare = L.fromFacts({ metas: [], jsonld: ['{not json'], title: 'Plain page - Some Site', canonical: 'https://elsewhere.example/x' }, 'https://plain.example.org/p', NOW);
  assert.deepEqual([bare.type, bare.title, bare.URL], ['webpage', 'Plain page - Some Site', 'https://plain.example.org/p']);
  assert.equal(L.thin(bare), true);
  // A video: its channel uploaded it.
  const v = L.fromFacts({ metas: [['og:type', 'video.other'], ['og:title', 'Capybara Eat Huge Pumpkin'], ['og:site_name', 'YouTube']], jsonld: ['{"@type":"VideoObject","name":"Capybara Eat Huge Pumpkin","uploadDate":"2021-01-12","author":"Alex Smith"}'], title: '' }, 'https://www.youtube.com/watch?v=8YNwxZnABzA', NOW);
  assert.equal(C.format(v, 'mla9').entry, '“Capybara Eat Huge Pumpkin.” <i>YouTube</i>, uploaded by Alex Smith, 12 Jan. 2021, www.youtube.com/watch?v=8YNwxZnABzA.');
  assert.equal(L.merge(bare, { title: 'Other', author: ['Ana Okafor'] }).title, 'Plain page - Some Site');
  assert.deepEqual(L.merge(bare, { title: 'Other', author: ['Ana Okafor'] }).author, [{ family: 'Okafor', given: 'Ana' }]);
});

test('sources: cleaned, told apart and merged; a box\'s key needs every part', async () => {
  assert.equal(S.normalize({ type: 'book' }), null);
  const n = S.normalize({ type: 'journal-article', title: '  A\u0000 <b>bold</b> <i>ship</i> title<script>x</script> ', author: 'Morrison, Toni\nWorld Health Organization\nLudwig van Beethoven', issued: 'Spring 2017', DOI: 'https://doi.org/10.1234/abc.', ISBN: '0-306-40615-2', URL: 'javascript:alert(1)', page: '12 - 19' });
  assert.equal(n.type, 'article-journal');
  assert.equal(n.title, 'A bold <i>ship</i> titlex');
  assert.deepEqual(n.author, [{ family: 'Morrison', given: 'Toni' }, { literal: 'World Health Organization' }, { family: 'van Beethoven', given: 'Ludwig' }]);
  assert.deepEqual(n.issued, { 'date-parts': [[2017]], season: 'spring' });
  assert.deepEqual([n.DOI, n.ISBN, n.URL, n.page], ['10.1234/abc', '9780306406157', undefined, '12–19']);
  for (const [v, want] of [['1987', [1987]], ['2019-03-08', [2019, 3, 8]], ['March 8, 2017', [2017, 3, 8]], ['8 Mar. 2017', [2017, 3, 8]], ['Sept. 2020', [2020, 9]], ['2019-02-31T10:00', [2019, 2, 31]]])
    assert.deepEqual(S.date(v)['date-parts'][0], want, v);
  assert.equal(S.date('someday'), null);
  let { sources, id } = S.add([], { type: 'book', title: 'Beloved', author: ['Toni Morrison'], issued: '1987' });
  ({ sources } = S.add(sources, { type: 'book', title: 'beloved', author: ['Morrison, T.'], issued: 1987, publisher: 'Knopf' }));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, id);
  assert.equal(sources[0].publisher, 'Knopf');
  ({ sources } = S.add(sources, { type: 'article-journal', title: 'X', DOI: '10.5555/A', author: ['A B'] }));
  ({ sources } = S.add(sources, { type: 'article-journal', title: 'Y', DOI: '10.5555/a', author: ['A B'] }));
  assert.equal(sources.length, 2, 'one DOI, any case, is one work');
  assert.equal(S.key({ school: 'https://bb.school.edu', user: '_42_1', course: '_101_1', item: '_9_1' }), 'writer:sources:https%3A%2F%2Fbb.school.edu|_42_1|_101_1|_9_1');
  assert.equal(S.key({ school: 'https://bb.school.edu', user: '_42_1', course: '_101_1' }), null);
  assert.equal(S.keyOf({ school: 'https://bb.school.edu', user: { id: '_42_1' }, course: { id: '_101_1' }, item: { id: '_9_1' } }), 'writer:sources:https%3A%2F%2Fbb.school.edu|_42_1|_101_1|_9_1');
  // Storage: only keys of this kind; what comes back is cleaned again.
  const store = {};
  const area = { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o), remove: async (k) => { delete store[k]; } };
  const k = S.key({ school: 'a', user: 'b', course: 'c', item: 'd' });
  assert.equal(await S.save(k, sources, area), true);
  assert.deepEqual((await S.load(k, area)).map((s) => s.title), ['Beloved', 'X']);
  store[k].sources.push({ type: 'book', title: '<img src=x onerror=1>Evil' }, 'junk');
  assert.deepEqual((await S.load(k, area)).map((s) => s.title), ['Beloved', 'X', 'Evil']);
  assert.equal(await S.save('settings', sources, area), false);
  assert.deepEqual(await S.load('settings', area), []);
  assert.equal(await S.save(k, [], area), true);
  assert.equal(store[k], undefined);
});

const redirect = (to) => ({ ok: false, status: 302, headers: { get: (k) => k === 'location' ? to : null }, body: { cancel: async () => {} } });
test('review: redirects are inspected before any next fetch; only held public HTTPS destinations are followed', async () => {
  for (const to of ['https://127.0.0.1/', 'https://[::1]/', 'https://printer.local/', 'http://www.example.org/', 'https://other.example.org/']) {
    const calls = [];
    const e = env({ reach: async (u) => new URL(u).hostname === 'example.org', fetch: async (url, init) => { calls.push([url, init.redirect]); return redirect(to); } });
    const r = await L.serve({ kind: 'url', value: 'https://example.org/' }, sender, e);
    assert.equal(r.ok, false, to);
    assert.deepEqual(calls, [['https://example.org/', 'manual']], to);
  }
  const calls = [];
  const e = env({ reach: async (u) => ['example.org', 'www.example.org'].includes(new URL(u).hostname), fetch: async (url) => { calls.push(url); return calls.length === 1 ? redirect('https://www.example.org/') : response('<title>Final</title>', { url, type: 'text/html' }); } });
  assert.equal((await L.serve({ kind: 'url', value: 'https://example.org/' }, sender, e)).url, 'https://www.example.org/');
  assert.deepEqual(calls, ['https://example.org/', 'https://www.example.org/']);
});

test('review: opaque DOI redirects use fixed agency routes; opaque page redirects never auto-follow', async () => {
  const calls = [];
  const e = env({ reach: async () => true, fetch: async (url, init) => {
    calls.push([url, init.redirect]);
    return calls.length === 1 ? { type: 'opaqueredirect', status: 0, headers: new Headers() } : response('{"title":"A work"}', { url });
  } });
  assert.equal((await L.serve({ kind: 'doi', value: '10.5555/work' }, sender, e)).ok, true);
  assert.deepEqual(calls, [['https://doi.org/10.5555/work', 'manual'], ['https://api.crossref.org/v1/works/10.5555%2Fwork/transform', 'manual']]);
  calls.length = 0;
  assert.deepEqual(await L.serve({ kind: 'url', value: 'https://example.org/' }, sender, e), { ok: false, error: 'redirect' });
  assert.equal(calls.length, 1);
});

test('review: an oversized or failed stream is cancelled and its reader released', async () => {
  let cancelled = 0, released = 0;
  const e = env({ fetch: async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(L.LIMIT.bytes + 1) }), cancel: async () => { cancelled++; }, releaseLock: () => { released++; } }) } }) });
  assert.deepEqual(await L.serve({ kind: 'doi', value: '10.5555/work' }, sender, e), { ok: false, error: 'size' });
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('review: a deadline also bounds a hung response body', async () => {
  const original = L.LIMIT.time;
  let cancelled = 0;
  L.LIMIT.time = 25;
  try {
    const e = env({ fetch: async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => { cancelled++; }, releaseLock() {} }) } }) });
    const result = await Promise.race([L.serve({ kind: 'doi', value: '10.5555/work' }, sender, e), new Promise((r) => setTimeout(() => r('hung'), 150))]);
    assert.deepEqual(result, { ok: false, error: 'timeout' });
    assert.equal(cancelled, 1);
  } finally { L.LIMIT.time = original; }
});

test('review: DOI punctuation preserves balanced suffix parentheses', () => {
  assert.equal(S.doi('https://doi.org/10.5555/work(part)'), '10.5555/work(part)');
  assert.equal(S.doi('(10.5555/work(part)).'), '10.5555/work(part)');
});

test('review: reserved home-network and localdomain aliases are never public lookup hosts', async () => {
  for (const value of ['https://localhost.localdomain/', 'https://printer.localdomain/', 'https://router.home.arpa/']) {
    assert.equal(L.pageUrl(value), '', value);
    let fetched = false;
    assert.deepEqual(await L.serve({ kind: 'url', value }, sender, env({ reach: async () => true, fetch: async () => { fetched = true; } })), { ok: false, error: 'input' });
    assert.equal(fetched, false);
  }
});
