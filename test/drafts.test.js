const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../lib/drafts.js');

const essay = 'My response to the reading: the author argues that';
const NBSP = String.fromCharCode(0xa0);
const ZWSP = String.fromCharCode(0x200b);

test('short text is not worth keeping', () => {
  assert.ok(!D.worth('ok thanks'));
  assert.ok(!D.worth(`   \n${NBSP} `));
  assert.ok(!D.worth(undefined));
  assert.ok(D.worth(essay));
});

test('a post is found on the page however its whitespace is laid out', () => {
  // The editor's paragraphs run together in textContent; the rendered post has its own spacing.
  assert.ok(D.posted(`First paragraph here.Second${NBSP}paragraph${ZWSP} here.`, 'Reply  First paragraph here.\n  Second paragraph here.  Like'));
  assert.ok(D.posted(essay, `Posted 2 minutes ago ${essay}`));
  assert.ok(!D.posted(essay, 'My response to the reading: the author claims'));
  assert.ok(!D.posted('ok thanks', 'ok thanks'), 'too short to tell');
  // Only all of it: a post shown by its start only (Read more), or one that starts the same way, is no proof.
  assert.ok(!D.posted(essay.repeat(30), `${essay.repeat(13)}… Read more`));
  const quote = 'A quoted passage that a reply starts with. '.repeat(15);
  assert.ok(!D.posted(`${quote}My own reply.`, `${quote}Someone else's reply.`));
  assert.ok(D.posted(`${quote}My own reply.`, `Reply ${quote}\n\nMy own reply.\nLike`));
});

test('copies expire after 14 days, and all go with the feature off', () => {
  const now = Date.UTC(2026, 9, 13);
  const all = {
    'draft:ultra:https://bb.school.test/_7_1/a#x/1': { at: now - 13 * 864e5 },
    'draft:ultra:https://bb.school.test/_7_1/b#y/2': { at: now - 15 * 864e5 },
    'draft:ultra:https://bb.school.test/_7_1/c#z/3': { html: '<p>no date</p>' },
    'draft:ultra:https://bb.school.test/_7_1/d#w/4': null,
    seenCourses: { 1: 'Biology' },
  };
  const [a, b, c, d] = Object.keys(all);
  assert.deepEqual(D.stale(all, now), [b, c, d]);
  assert.deepEqual(D.stale(all, now, false), [a, b, c, d]);
  assert.deepEqual(D.stale(undefined, now), []);
});

// ACA-4: an Ultra copy's key had only the page's path, so any account on the profile was offered it.
test('Ultra copies are kept per site, signed-in user, page and editor', () => {
  const m = { origin: 'https://bb.school.test', user: '_7_1', path: '/ultra/courses/_5_1/outline/discussion/_9_1', near: '_12_3', id: 'ed1' };
  const key = D.ultraKey(m);
  assert.match(key, /^draft:ultra:/);
  assert.ok(key.includes('https://bb.school.test') && key.includes('_7_1'));
  for (const change of [{ origin: 'https://bb.other.test' }, { user: '_8_1' }, { path: '/ultra/courses/_5_1/outline' }, { near: '_99_1' }, { id: 'ed2' }]) assert.notEqual(D.ultraKey({ ...m, ...change }), key, JSON.stringify(change));
  // Nobody signed in that is known, or an address that is not a site's: no key, so nothing is kept under a stranger's.
  for (const change of [{ user: '' }, { user: undefined }, { user: 'a b' }, { user: '../x' }, { origin: 'bb.school.test' }, { origin: 'https://bb.school.test/x' }, { path: 'ultra' }]) assert.equal(D.ultraKey({ ...m, ...change }), null, JSON.stringify(change));
  // The key a user's id can't be confused across: "_1_1" + "/ultra" is not "_1_1/ultra" on another origin.
  assert.notEqual(D.ultraKey({ ...m, origin: 'https://a.test', user: '_1_1' }), D.ultraKey({ ...m, origin: 'https://a.test/_1_1', user: '_1_1' }));
});

test('copies kept before accounts (a key of just a path) are swept whatever their age, and the other kinds are not', () => {
  const now = Date.UTC(2026, 9, 13);
  const fresh = { at: now - 864e5 };
  const all = {
    'draft:/ultra/courses/_5_1/outline#_12_3/ed1': fresh,
    'draft:ultra:https://bb.school.test/_7_1/ultra/courses/_5_1/outline#_12_3/ed1': fresh,
    'draft:canvas:["https://school.instructure.com","7","5",["2"],"Lab question"]': fresh,
    'draft:todo:https://school.instructure.com/7': fresh,
  };
  assert.deepEqual(D.stale(all, now), ['draft:/ultra/courses/_5_1/outline#_12_3/ed1']);
  assert.equal(D.stale(all, now, false).length, 4, 'with the feature off, all');
});

// ACA-6: what is stored for an editor is the page's own copy and, beside it, copies it didn't write.
test('a record keeps the newest copy and, in prev, older ones: unpacked newest first, expired ones left out', () => {
  const now = Date.UTC(2026, 9, 13);
  const c = (text, days) => ({ html: `<p>${text}</p>`, text, at: now - days * 864e5 });
  const rec = D.pack(c('new', 0), [c('older', 1), c('oldest', 2), c('ancient', 3)], now);
  assert.deepEqual(D.unpack(rec, now).map((x) => x.text), ['new', 'older', 'oldest'], 'three at most');
  assert.equal(rec.text, 'new');
  assert.deepEqual(rec.prev.map((x) => x.text), ['older', 'oldest']);
  assert.deepEqual(D.pack(null, [c('only', 1)], now), c('only', 1), 'with nothing new, the older copy is the record');
  assert.equal(D.pack(null, [], now), null);
  assert.equal(D.pack(undefined, undefined, now), null);
  assert.equal('prev' in D.pack(c('new', 0), [], now), false, 'no empty prev');
  assert.deepEqual(D.unpack(D.pack(c('new', 0), [c('old', 15)], now), now).map((x) => x.text), ['new'], 'past 14 days: gone');
  // Whatever else is on a copy (an element, a count) is not kept; a canvas identity is.
  const live = { ...c('new', 0), ed: {}, gone: 0, canvas: { subject: 's' } };
  assert.deepEqual(D.pack(live, [], now), { ...c('new', 0), canvas: { subject: 's' } });
  // A record from before copies were kept beside one another is one copy.
  assert.deepEqual(D.unpack(c('plain', 0), now).map((x) => x.text), ['plain']);
  for (const bad of [null, undefined, 'x', 3, { html: 1 }]) assert.deepEqual(D.unpack(bad, now), [], JSON.stringify(bad));
  assert.deepEqual(D.unpack({ prev: [c('kept', 0)] }, now).map((x) => x.text), ['kept'], 'a damaged top does not lose the rest');
  assert.deepEqual(D.unpack({ ...c('top', 0), prev: [null, 3, c('ok', 1), { text: 'no date' }] }, now).map((x) => x.text), ['top', 'ok']);
});

test('Canvas new messages are isolated by site, account, course, exact subject and numeric recipients', () => {
  const m = { origin: 'https://school.instructure.com', user: '3', course: '25', to: ['2', '5'], subject: 'Reading question' };
  const key = D.canvasKey(m);
  assert.equal(D.canvasKey({ ...m, to: ['5', '2', '2'] }), key);
  for (const change of [{ origin: 'https://other.instructure.com' }, { user: '4' }, { course: '26' }, { to: ['6'] }, { subject: 'Another question' }]) assert.notEqual(D.canvasKey({ ...m, ...change }), key);
  for (const change of [{ user: '' }, { course: '' }, { to: [] }, { to: ['group_2'] }, { subject: '' }, { subject: ' '.repeat(20) }, { subject: 'a'.repeat(256) }]) assert.equal(D.canvasKey({ ...m, ...change }), null);
  assert.equal(D.canvasKey(null), null);
});

test('Canvas sent cleanup requires exact author, destination, body and a new enough message', () => {
  const at = Date.now();
  const d = { text: essay, at, canvas: { origin: 'https://school.instructure.com', user: '3', course: '25', to: ['2'], subject: 'Reading question' } };
  const message = { author_id: '3', body: essay, created_at: new Date(at).toISOString() };
  const c = { subject: 'Reading question', context_code: 'course_25', participants: [{ id: '3' }, { id: '2' }], messages: [message] };
  assert.equal(D.sent(d, c), true);
  for (const change of [{ subject: 'Other' }, { context_code: 'course_26' }, { participants: [{ id: '3' }, { id: '5' }] }, { messages: [{ ...message, author_id: '2' }] }, { messages: [{ ...message, body: `${essay}!` }] }, { messages: [{ ...message, created_at: new Date(at - 10000).toISOString() }] }, { messages: [] }]) assert.equal(D.sent(d, { ...c, ...change }), false);
  assert.equal(D.sent({}, c), false);
});


test('Canvas recipients use actual user IDs from numeric or canonical MessageableUser Relay tags', () => {
  assert.equal(D.canvasRecipient('address-book-label-2-user'), '2');
  assert.equal(D.canvasRecipient(`address-book-label-${btoa('MessageableUser-2')}-user`), '2');
  for (const value of [undefined, '', 'address-book-label-2-group', `address-book-label-${btoa('Course-2')}-user`, 'address-book-label-!-user']) assert.equal(D.canvasRecipient(value), null);
});

// ---- the worker's queue ('glaze:drafts'): each page's change applied to what is stored when its turn comes ----------
const mem = (s = {}) => ({ s, get: async (k) => Object.fromEntries([].concat(k ?? Object.keys(s)).filter((x) => x in s).map((x) => [x, structuredClone(s[x])])),
  set: async (v) => { Object.assign(s, structuredClone(v)); return true; }, remove: async (k) => { for (const x of [].concat(k)) delete s[x]; return true; } });
const copy = (text, at, id) => ({ html: `<p>${text}</p>`, text, at, ...(id && { id }) });
const UKEY = D.ultraKey({ origin: 'https://bb.school.test', user: '_7_1', path: '/ultra/courses/_5_1/outline', near: '_12_3', id: 'ed1' });

test("a page's change replaces its own copy and drops only the copies it names, beside every other page's", async () => {
  const now = Date.UTC(2026, 9, 13), area = mem();
  const A = 'tab0000000a', B = 'tab0000000b';
  const texts = () => D.unpack(area.s[UKEY], now).map((x) => x.text);
  await D.change({ key: UKEY, put: copy(`${essay} A`, now - 3000, A) }, area, now);
  await D.change({ key: UKEY, put: copy(`${essay} B`, now - 2000, B) }, area, now);
  const r = await D.change({ key: UKEY, put: copy(`${essay} A2`, now - 1000, A) }, area, now);
  assert.deepEqual(texts(), [`${essay} A2`, `${essay} B`], 'one copy a page, newest first');
  assert.deepEqual(r.copies.map((x) => x.text), texts(), 'and the page is told what is kept');
  await D.change({ key: UKEY, put: copy(`${essay} A1`, now - 1500, A) }, area, now);
  assert.deepEqual(texts(), [`${essay} A2`, `${essay} B`], 'an older version of a page\'s copy, arriving late, does not replace a newer one');
  await D.change({ key: UKEY, drop: [{ id: B, at: now - 9000 }] }, area, now);
  assert.deepEqual(texts(), [`${essay} A2`, `${essay} B`], 'another version of a copy than the one named stays');
  await D.change({ key: UKEY, drop: [{ id: B, at: now - 2000 }] }, area, now);
  assert.deepEqual(texts(), [`${essay} A2`]);
  await D.change({ key: UKEY, drop: [{ id: A, at: now - 1000 }] }, area, now);
  assert.deepEqual(D.unpack(area.s[UKEY], now), [], 'the exact version is gone; its deletion marker blocks delayed writes');
  // A copy kept before copies had ids is named by when it was written and a hash of what it says.
  area.s[UKEY] = copy(essay, now - 5000);
  await D.change({ key: UKEY, drop: [D.mark({ at: now - 5000, text: `${essay}!` })] }, area, now);
  assert.deepEqual(texts(), [essay]);
  await D.change({ key: UKEY, drop: [D.mark({ at: now - 5000, text: essay })] }, area, now);
  assert.deepEqual(D.unpack(area.s[UKEY], now), []);
  assert.equal(JSON.stringify(area.s).includes(essay), false, 'its marker keeps no text');
  // Three at most: the newest.
  for (let i = 1; i <= 4; i++) await D.change({ key: UKEY, put: copy(`${essay} ${i}`, now - 10000 + i, `tab000000${i}`) }, area, now);
  assert.deepEqual(texts(), [`${essay} 4`, `${essay} 3`, `${essay} 2`]);
  // What isn't a copy worth keeping is refused, and nothing is written.
  const before = structuredClone(area.s);
  for (const put of [copy('too short', now, 'tab0000000c'), copy(essay, now, 'no'), copy(essay, now - 15 * 864e5, 'tab0000000c'), { ...copy(essay, now, 'tab0000000c'), html: 3 }]) {
    assert.deepEqual(await D.change({ key: UKEY, put }, area, now), { ok: false, error: 'bad' }, JSON.stringify(put));
  }
  assert.deepEqual((await D.change({ key: UKEY }, area, now)).copies.length, 3, 'nothing asked: only told');
  assert.deepEqual(area.s, before);
});

test("a Canvas copy is taken only for the destination its key names, and the sweep takes only what is still stale", async () => {
  const now = Date.UTC(2026, 9, 13), area = mem();
  const m = { origin: 'https://school.instructure.com', user: '3', course: '25', to: ['2'], subject: 'Reading question' };
  const key = D.canvasKey(m);
  assert.deepEqual(await D.change({ key, put: { ...copy(essay, now, 'tab0000000a'), canvas: { ...m, subject: 'Other' } } }, area, now), { ok: false, error: 'bad' });
  assert.equal((await D.change({ key, put: { ...copy(essay, now, 'tab0000000a'), canvas: m } }, area, now)).ok, true);
  assert.deepEqual(area.s[key].canvas, m);
  // A key a page found stale, written to since by another tab, stays.
  const old = UKEY, legacy = 'draft:/ultra/courses/_5_1/outline#_12_3/ed1';
  Object.assign(area.s, { [old]: copy(essay, now), [legacy]: copy(essay, now) });
  assert.deepEqual(await D.sweep([old, legacy, 'draft:gone'], area, now), { ok: true });
  assert.deepEqual(Object.keys(area.s).sort(), [key, old].sort());
  area.s[old] = copy(essay, now - 15 * 864e5);
  await D.sweep([old], area, now);
  assert.equal(old in area.s, false);
});

test("the worker takes draft changes from a page of the copy's own site only, with backup on, one at a time", async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const listeners = [];
  const store = { local: { canvas: ['https://canvas.school.edu/*'], ultra: ['https://bb.school.test'] }, sync: {} };
  const area = (s) => ({ get: async (k) => Object.fromEntries([].concat(k ?? Object.keys(s)).filter((x) => x in s).map((x) => [x, structuredClone(s[x])])),
    set: async (v) => { Object.assign(s, structuredClone(v)); }, remove: async (k) => { for (const x of [].concat(k)) delete s[x]; } });
  const fetched = [];
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto, atob, btoa, navigator: {},
    fetch: async (url) => { fetched.push(String(url)); throw new Error('offline'); },
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener() {} } },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (msg, sender) => new Promise((res) => { for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) return; res('ignored'); });
  const page = (url, extra = {}) => ({ id: 'glaze', tab: { id: 1 }, frameId: 0, url, ...extra });
  const now = Date.now();
  const ultra = 'https://bb.school.test/ultra/courses/_5_1/outline', inbox = 'https://canvas.school.edu/conversations';
  const put = (text, id) => ({ type: 'glaze:drafts', key: UKEY, put: copy(text, now, id) });
  for (const [sender, why] of [
    [page('https://other.school.test/ultra/courses/_5_1/outline'), "another site's page"],
    [page('https://bb.school.test/courses/_5_1'), 'not an Ultra page'],
    [page(inbox), 'a Canvas page'],
    [{ id: 'other', tab: {}, frameId: 0, url: ultra }, 'another extension'],
    [{ id: 'glaze', frameId: 0, url: ultra }, 'not in a tab'],
  ]) assert.deepEqual(await send(put(essay, 'tab0000000a'), sender), { ok: false, error: 'sender' }, why);
  const dest = { origin: 'https://canvas.school.edu', user: '3', course: '25', to: ['2'], subject: 'Reading question' };
  const ckey = D.canvasKey(dest), cput = { ...copy(essay, now, 'tab0000000a'), canvas: dest };
  assert.deepEqual(await send({ type: 'glaze:drafts', key: ckey, put: copy(essay, now, 'tab0000000a') }, page(ultra)), { ok: false, error: 'sender' }, "a Canvas key from an Ultra page");
  assert.deepEqual(await send({ type: 'glaze:drafts', key: ckey.replace('canvas.school.edu', 'canvas.other.edu') }, page(inbox)), { ok: false, error: 'sender' }, "another Canvas site's key");
  assert.deepEqual(await send({ type: 'glaze:drafts', key: 'notes:x' }, page(ultra)), { ok: false, error: 'sender' });
  assert.equal(Object.keys(store.local).some((k) => k.startsWith('draft:')), false, 'nothing written for any of them');
  for (const op of [{}, { put: copy(essay, now, 'tab0000000a') }, { drop: [{ id: 'tab0000000a', at: now }] }]) {
    const key = UKEY.replace('bb.school.test', 'elsewhere.blackboard.com');
    assert.deepEqual(await send({ type: 'glaze:drafts', key, ...op }, page(ultra)), { ok: false, error: 'sender' }, "another Ultra site's key");
  }
  assert.deepEqual(await send({ type: 'glaze:drafts', key: 'draft:ultra:https://bb.school.test/anything' }, page(ultra)), { ok: false, error: 'sender' }, 'malformed Ultra destination');
  assert.deepEqual(await send({ type: 'glaze:drafts', key: UKEY.replace('bb.school.test', 'canvas.school.edu'), put: copy(essay, now, 'tab0000000a') }, page(inbox)), { ok: false, error: 'sender' }, 'an Ultra key from a Canvas page of its origin');
  assert.deepEqual(await send({ type: 'glaze:drafts', key: ckey, put: cput }, page(inbox, { frameId: 3 })), { ok: false, error: 'sender' }, 'a Canvas frame');
  assert.equal(Object.keys(store.local).some((k) => k.startsWith('draft:')), false, 'nothing written for any of them');
  // A Canvas page keeps its own site's copies.
  assert.equal((await send({ type: 'glaze:drafts', key: ckey, put: cput }, page(inbox))).ok, true);
  assert.ok(ckey in store.local);
  // Two tabs at once: both land.
  const both = await Promise.all([send(put(`${essay} A`, 'tab0000000a'), page(ultra)), send(put(`${essay} B`, 'tab0000000b'), page(ultra, { tab: { id: 2 } }))]);
  assert.ok(both.every((r) => r.ok));
  assert.deepEqual(D.unpack(store.local[UKEY]).map((x) => x.text).sort(), [`${essay} A`, `${essay} B`]);
  // A sweep takes only the sender's site's expired copies (and Ultra's path-only ones, which name no site), never another
  // origin's or the other site kind's.
  store.local['draft:/ultra/old'] = copy(essay, now);
  const sameSite = UKEY.replace('/_7_1/', '/_8_1/'), otherSite = UKEY.replace('bb.school.test', 'elsewhere.blackboard.com');
  const otherKind = D.canvasKey({ origin: 'https://bb.school.test', user: '3', course: '25', to: ['2'], subject: 'Reading question' });
  const otherPending = D.pendingKey({ key: otherSite, at: now - 15 * 864e5 });
  for (const k of [sameSite, otherSite, otherKind]) store.local[k] = copy(essay, now - 15 * 864e5);
  store.local[otherPending] = { key: otherSite, at: now - 15 * 864e5, drop: [] };
  assert.deepEqual(await send({ type: 'glaze:drafts', sweep: ['draft:/ultra/old', UKEY, sameSite, otherSite, otherKind, otherPending] }, page(ultra)), { ok: true });
  assert.ok(otherSite in store.local && otherKind in store.local && otherPending in store.local, "another origin's or site kind's expired copies are untouched");
  assert.equal(sameSite in store.local, false, "this site's expired copies go");
  assert.equal('draft:/ultra/old' in store.local, false);
  assert.ok(UKEY in store.local);
  store.local[ckey] = copy(essay, now - 15 * 864e5);
  assert.deepEqual(await send({ type: 'glaze:drafts', sweep: [ckey, otherSite] }, page(inbox)), { ok: true });
  assert.equal(ckey in store.local, false);
  assert.ok(otherSite in store.local, 'a Canvas page leaves Ultra copies alone');
  assert.deepEqual(fetched, [], 'no request to the school per change');
  assert.deepEqual(await send({ type: 'glaze:drafts', sweep: ['seenCourses'] }, page(inbox)), { ok: false, error: 'sender' }, 'drafts only');
  // With the backup switched off the worker takes nothing.
  store.sync.enhance = { drafts: false };
  assert.deepEqual(await send(put(`${essay} C`, 'tab0000000c'), page(ultra)), { ok: false, error: 'sender' });
  assert.equal(D.unpack(store.local[UKEY]).length, 2);
});

test('an exact clear arriving before its put blocks that delayed version, but allows the next edit', async () => {
  const now = Date.now(), area = mem(), id = 'tab0000000a';
  await D.change({ key: UKEY, drop: [{ id, at: now }] }, area, now);
  await D.change({ key: UKEY, put: copy(essay, now, id) }, area, now);
  assert.deepEqual(D.unpack(area.s[UKEY], now), [], 'a cleared version cannot return');
  await D.change({ key: UKEY, put: copy(essay + ' again', now + 1, id) }, area, now + 1);
  assert.equal(D.unpack(area.s[UKEY], now + 1)[0].text, essay + ' again');
});

test('a stale legacy head cannot sweep a fresh previous copy', async () => {
  const now = Date.now(), area = mem({ [UKEY]: { ...copy(essay, now - 15 * 864e5), prev: [copy(essay + ' fresh', now)] } });
  await D.sweep([UKEY], area, now);
  assert.equal(D.unpack(area.s[UKEY], now)[0]?.text, essay + ' fresh');
});

test('clearing a newer version also retires an older version of the same tab that arrived first', async () => {
  const now = Date.now(), area = mem(), id = 'tab0000000a';
  await D.change({ key: UKEY, put: copy(essay, now - 1, id) }, area, now);
  await D.change({ key: UKEY, drop: [{ id, at: now }] }, area, now);
  assert.deepEqual(D.unpack(area.s[UKEY], now), []);
});

test('a restarted MV3 worker can import the drafts broker from its installation cache', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const cached = new Set(), store = { local: { ultra: ['https://bb.school.test'] }, sync: {} };
  const boot = (installed) => {
    const events = [], listeners = [], noop = { addListener() {} };
    const storage = (s) => ({ get: async (keys) => Object.fromEntries([].concat(keys ?? Object.keys(s)).filter((k) => k in s).map((k) => [k, structuredClone(s[k])])),
      set: async (o) => { Object.assign(s, structuredClone(o)); }, remove: async (keys) => { for (const k of [].concat(keys)) delete s[k]; } });
    const ctx = vm.createContext({ URL, console, TextEncoder, TextDecoder, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto, atob, btoa, navigator: {},
      addEventListener: (event, f) => { if (event === 'install') events.push(f); },
      importScripts: (...files) => { for (const f of files) {
        if (installed && !cached.has(f)) throw Error('importScripts() of new scripts after service worker installation is not allowed.');
        cached.add(f); vm.runInContext(read(`lib/${f}`), ctx);
      } },
      fetch: async () => ({ ok: true, json: async () => ({ id: '_7_1' }) }),
      chrome: { runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'),
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: noop, onStartup: noop, onConnect: noop },
        storage: { local: storage(store.local), sync: storage(store.sync), onChanged: noop } },
    });
    vm.runInContext(read('lib/background.js'), ctx);
    return { install: () => events.forEach((f) => f()), send: (m) => new Promise((resolve) => {
      for (const f of listeners) if (f(m, { id: 'glaze', tab: { id: 1 }, frameId: 0, url: 'https://bb.school.test/ultra/courses/_5_1/outline' }, (r) => resolve(JSON.parse(JSON.stringify(r)))) === true) return;
    }) };
  };
  boot(false).install();
  const response = await boot(true).send({ type: 'glaze:drafts', key: UKEY, put: copy(essay, Date.now(), 'tab0000000a') });
  assert.equal(response.ok, true, `first draft after worker restart: ${JSON.stringify(response)}`);
  assert.equal(D.unpack(store.local[UKEY])[0]?.text, essay);
});
