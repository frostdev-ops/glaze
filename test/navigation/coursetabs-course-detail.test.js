const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../features/coursetabs.js'), 'utf8');
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const origin = 'https://bb.test';

function navigate(mode, href, { site = 'ultra', framed = '_2_1' } = {}) {
  const sent = [], location = new URL(href, origin);
  const toTop = (op, m) => sent.push([op, m.url]);
  if (mode === 'pass') {
    // Match the pathname-only readers in content.js; a query must not override another course's path.
    const cid = site === 'canvas' ? location.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1]
      : location.pathname.match(/\/ultra\/courses\/(_\d+_\d+)\//)?.[1];
    vm.runInNewContext(part('  const pass = ', '  const sync = ') + '\npass();', {
      on: true, framed, PAGE: 'page', preview: false, ctx: { site }, location, URLSearchParams, toTop,
      awayFrom: '', here: () => cid, observeView() {}, showing: '', frames: new Map(), loaded: false,
      last: cid, lastPath: location.pathname + location.search, restored: true,
      flag() {}, place() {}, draw() {}, lay() {}, later() {}, moved() {},
    });
  } else {
    let listener;
    class Anchor {}
    const a = Object.assign(new Anchor(), { href: location.href, getAttribute: () => href, hasAttribute: (k) => k === 'href' });
    vm.runInNewContext(part("  if (framed && !preview && ctx.site !== 'canvas') document.addEventListener('click'", '  if (framed && !preview) {'), {
      on: true, framed, preview: false, ctx: { site }, HTMLAnchorElement: Anchor, URL, toTop,
      location: { origin, href: `${origin}/ultra/courses/_2_1/announcements` },
      document: { addEventListener: (_, f) => { listener = f; } },
      window: { open: (...args) => sent.push(['external', ...args]) },
    });
    listener?.({ isTrusted: true, composedPath: () => [a], preventDefault() {}, stopImmediatePropagation() {} });
  }
  return sent;
}

for (const mode of ['pass', 'click']) {
  test(`course detail: legacy grade and tool pages still leave (${mode})`, () => {
    for (const href of ['/webapps/gradebook/do/student/viewGrades?course_id=_2_1', '/webapps/tool/launch?courseId=_2_1', '/ultra-other/tool?courseId=_2_1']) {
      assert.deepEqual(navigate(mode, href), [['away', href]], href);
    }
  });

  test(`course detail: a matching query cannot keep another course's path (${mode})`, () => {
    for (const href of ['/ultra/courses/_3_1/grades?courseId=_2_1', '/ultra/courses/_3_1?course_id=_2_1']) {
      assert.deepEqual(navigate(mode, href), [['away', href]], href);
    }
  });

  test(`course detail: empty repeated or mixed course identifiers leave (${mode})`, () => {
    for (const search of ['?courseId=_2_1&courseId=', '?course_id=&courseId=_2_1', '?course_id=_2_1&courseId=']) {
      const href = '/ultra/stream/announcement-detail' + search;
      assert.deepEqual(navigate(mode, href), [['away', href]], href);
    }
  });

  test(`course detail: valid panels and the redirect exception keep their boundaries (${mode})`, () => {
    for (const [search, stays] of [['?courseId=_2_1', true], ['?course_id=_2_1', true], ['?courseId=_2_1&course_id=_2_1&courseId=_2_1', true],
      ['', false], ['?courseId=', false], ['?courseId=_3_1', false], ['?courseId=_2_1&courseId=_3_1', false], ['?course_id=_3_1&courseId=_2_1', false]]) {
      const href = '/ultra/stream/announcement-detail' + search;
      assert.deepEqual(navigate(mode, href), stays ? [] : [['away', href]], href);
    }
    for (const search of ['', '?courseId=', '?course_id=&courseId=_2_1']) {
      assert.deepEqual(navigate(mode, '/ultra/redirect' + search), [], 'redirect keeps its old empty-id rule');
    }
    assert.deepEqual(navigate(mode, '/ultra/courses/_2_1/grades'), [], 'native course tools still stay');
  });
}

test('course detail: Canvas course and PAGE frames retain their existing routing', () => {
  for (const framed of ['2', 'page']) {
    for (const href of ['/courses/3/grades?courseId=' + framed, '/courses/3/grades?course_id=' + framed]) {
      assert.deepEqual(navigate('pass', href, { site: 'canvas', framed }), [['away', href]]);
      assert.deepEqual(navigate('click', href, { site: 'canvas', framed }), [], 'Ultra click listener is not installed');
    }
  }
  assert.deepEqual(navigate('pass', '/calendar?courseId=page', { site: 'canvas', framed: 'page' }), []);
  assert.deepEqual(navigate('pass', '/courses/2/grades?courseId=3', { site: 'canvas', framed: '2' }), []);
});

test('course detail: another origin with the matching query still opens externally', () => {
  const href = 'https://other.test/ultra/stream/announcement-detail?courseId=_2_1';
  assert.deepEqual(navigate('click', href), [['external', href, '_blank', 'noopener']]);
});
