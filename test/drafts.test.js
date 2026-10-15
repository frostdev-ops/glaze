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
    'draft:/a#x': { at: now - 13 * 864e5 },
    'draft:/b#y': { at: now - 15 * 864e5 },
    'draft:/c#z': { html: '<p>no date</p>' },
    'draft:/d#w': null,
    seenCourses: { 1: 'Biology' },
  };
  assert.deepEqual(D.stale(all, now), ['draft:/b#y', 'draft:/c#z', 'draft:/d#w']);
  assert.deepEqual(D.stale(all, now, false), ['draft:/a#x', 'draft:/b#y', 'draft:/c#z', 'draft:/d#w']);
  assert.deepEqual(D.stale(undefined, now), []);
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
