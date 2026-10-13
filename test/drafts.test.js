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
