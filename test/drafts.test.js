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
  // A long post shows only its start in a list.
  assert.ok(D.posted(essay.repeat(30), `${essay.repeat(13)}… Read more`));
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
