// Announcements in Glaze's pop-up: lib/announce.js (settings, clicks, references, each site's answer) and lib/popup.js
// (the safe HTML path, the preview's place, the pop-up's motion), against hostile input. The page side is
// test/announce-ui.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const D = require('../defaults.js');
const P = require('../lib/popup.js');
const A = require('../lib/announce.js');
const N = require('../lib/notes.js');
const { El } = require('./stand-in-dom.js');

const O = 'https://school.instructure.com';
const doc = { createElement: (t) => new El(t, doc) };
const all = (nodes) => nodes.flatMap((n) => (n instanceof El ? [n, ...n.all()] : []));

test('the settings are GZ_SPEC entries: defaults, a round trip through GZ_SANITIZE, and junk refused', () => {
  const fresh = D.GZ_SANITIZE({});
  assert.deepEqual(fresh.announce, { open: 'popup', glaze: 'default', ultra: 'default', canvas: 'default', moodle: 'default', glazePreview: true, ultraPreview: true, canvasPreview: true, moodlePreview: true, preview: true, delay: 600, lines: 3 });
  assert.deepEqual(fresh.popup, { anim: 'genie' });
  assert.deepEqual(D.GZ_DEFAULTS.announce, fresh.announce);
  assert.deepEqual(D.GZ_DEFAULTS.popup, fresh.popup);
  const mine = { announce: { ...fresh.announce, open: 'site', glaze: 'popup', ultra: 'site', canvas: 'default', moodle: 'popup', preview: false, canvasPreview: false, delay: 1200, lines: 6 }, popup: { anim: 'fade' } };
  const back = D.GZ_SANITIZE(JSON.parse(JSON.stringify(D.GZ_SANITIZE(mine))));
  assert.deepEqual(back.announce, mine.announce);
  assert.deepEqual(back.popup, mine.popup);
  const junk = D.GZ_SANITIZE({ announce: { open: 'modal', glaze: 'x', preview: 'yes', delay: 5, lines: 99 }, popup: { anim: 'swirl' } });
  assert.deepEqual(junk.announce, fresh.announce);
  assert.equal(junk.popup.anim, 'genie');
});

test('each entry point follows the everyday choice until it has its own', () => {
  const o = (x) => D.GZ_SANITIZE({ announce: x }).announce;
  for (const e of ['glaze', 'ultra', 'canvas', 'moodle']) {
    assert.equal(A.mode(o({}), e), 'popup', `${e}: pop-up by default`);
    assert.equal(A.mode(o({ open: 'site' }), e), 'site', `${e}: follows the everyday choice`);
    assert.equal(A.mode(o({ open: 'site', [e]: 'popup' }), e), 'popup', `${e}: its own wins`);
    assert.equal(A.mode(o({ [e]: 'site' }), e), 'site');
  }
  assert.equal(A.mode(o({ canvas: 'site' }), 'ultra'), 'popup', 'one entry point leaves the others alone');
  assert.equal(A.mode(o({ open: 'site', glaze: 'popup' }), 'elsewhere'), 'site', 'an unknown entry point follows the everyday choice');
  assert.equal(A.mode(undefined, 'glaze'), 'popup');
});

test('a plain click is Glaze\'s; a middle click or any modifier keeps the browser\'s', () => {
  assert.equal(A.plain({ button: 0 }), true);
  for (const e of [{ button: 1 }, { button: 0, ctrlKey: true }, { button: 0, metaKey: true }, { button: 0, shiftKey: true }, { button: 0, altKey: true }, { button: 0, defaultPrevented: true }, null]) {
    assert.equal(A.plain(e), false, JSON.stringify(e));
  }
});

test('a reference names this site only, with ids of the site\'s own shape', () => {
  const r = A.ref({ site: 'canvas', courseId: '25', id: '7', url: '/courses/25/discussion_topics/7', title: ' Lab moved ', course: 'BIO' }, O);
  assert.deepEqual({ ...r }, { site: 'canvas', origin: O, courseId: '25', id: '7', url: `${O}/courses/25/discussion_topics/7`, title: 'Lab moved', course: 'BIO', entry: 'canvas', key: `canvas ${O} 25 7` });
  assert.equal(A.ref({ site: 'canvas', courseId: '25', id: '7', url: 'https://evil.example/x' }, O), null, 'another site\'s address');
  assert.equal(A.ref({ site: 'canvas', courseId: '25', id: '7', url: 'https://evil.example/x', origin: 'https://evil.example' }, O), null, 'a reference cannot override this site');
  assert.equal(A.ref({ site: 'canvas', courseId: '25', id: '7', url: 'javascript:alert(1)' }, O), null);
  assert.equal(A.ref({ site: 'canvas', courseId: '25', id: '../7', url: '/x' }, O), null, 'an id that would leave the path');
  assert.equal(A.ref({ site: 'ultra', courseId: '25', id: '_1_1', url: '/x' }, O), null, 'Ultra ids are _N_N');
  assert.ok(A.ref({ site: 'ultra', courseId: '_101_1', id: '_1001_1', url: '/ultra/courses/_101_1/announcements', entry: 'glaze' }, O));
  assert.ok(A.ref({ site: 'moodle', id: '12', url: '/mod/forum/discuss.php?d=12' }, O), 'Moodle needs no course');
  assert.equal(A.ref({ site: 'blackboard', courseId: '1', id: '1', url: '/' }, O), null);
});

const HOSTILE = `<p onclick="steal()">Lab <b>moved</b> to room 2.</p><script>alert(1)</script><style>body{display:none}</style>
<iframe src="https://evil.example/frame"></iframe><img src="/courses/25/files/9/preview" alt="Map" onerror="steal()">
<img src="https://tracker.example/pixel.gif" alt="pixel"><a href="javascript:alert(1)">bad</a><a href="https://example.org/read">Read</a>
<svg><script>alert(2)</script></svg><form action="https://evil.example"><input name="pw"></form><div style="position:fixed">styled</div>`;

test('the safe path: no scripts, frames, styles, handlers or forms; pictures from this site only; links in a new tab', () => {
  const nodes = P.safe(HOSTILE, O, N, doc);
  const els = all(nodes);
  const tags = new Set(els.map((e) => e.tagName.toLowerCase()));
  for (const bad of ['script', 'style', 'iframe', 'svg', 'form', 'input']) assert.ok(!tags.has(bad), bad);
  for (const e of els) {
    for (const k of Object.keys(e.attrs)) assert.ok(!/^on|^style$/.test(k), `${e.tagName} ${k}`);
    assert.ok(!e.className, 'no classes from the site');
  }
  const imgs = els.filter((e) => e.tagName === 'IMG');
  assert.deepEqual(imgs.map((e) => e.getAttribute('src')), [null], 'pictures must not load before their redirect policy can be applied');
  assert.equal(P.picture(imgs[0]), `${O}/courses/25/files/9/preview`);
  assert.equal(imgs[0].getAttribute('alt'), 'Map');
  const links = els.filter((e) => e.tagName === 'A');
  assert.deepEqual(links.map((e) => e.getAttribute('href')), ['https://tracker.example/pixel.gif', 'https://example.org/read'], 'the other site\'s picture is a link; javascript: is gone');
  for (const a of links) { assert.equal(a.getAttribute('target'), '_blank'); assert.equal(a.getAttribute('rel'), 'noopener noreferrer'); }
  const text = P.text(P.tree(HOSTILE, O, N));
  assert.match(text, /^Lab moved to room 2\./);
  assert.doesNotMatch(text, /alert|display:none|steal/);
});

test('Canvas: the topic as Canvas sends it, its read state, and the read mark only for an unread one', () => {
  const j = { title: 'Lab moved', message: HOSTILE, posted_at: '2026-10-20T14:00:00Z', read_state: 'unread', author: { display_name: 'Dr. Rivera' },
    attachments: [{ display_name: 'map.pdf', url: `${O}/files/9/download?download_frd=1` }, { display_name: 'x', url: 'https://evil.example/x' }] };
  const it = A.SITES.canvas.item(j, O);
  assert.equal(it.title, 'Lab moved');
  assert.equal(it.author, 'Dr. Rivera');
  assert.equal(it.at, Date.parse('2026-10-20T14:00:00Z'));
  assert.deepEqual(it.files, [{ name: 'map.pdf', url: `${O}/files/9/download?download_frd=1` }], 'attachments from this site only');
  assert.equal(it.unread, true);
  const r = A.ref({ site: 'canvas', courseId: '25', id: '7', url: '/courses/25/discussion_topics/7' }, O);
  assert.deepEqual(A.SITES.canvas.get(r), { url: `${O}/api/v1/courses/25/discussion_topics/7`, method: 'GET' });
  assert.deepEqual(A.SITES.canvas.mark(r, it), { url: `${O}/api/v1/courses/25/discussion_topics/7/read`, method: 'PUT' });
  assert.equal(A.SITES.canvas.mark(r, A.SITES.canvas.item({ ...j, read_state: 'read' }, O)), null);
  assert.equal(A.SITES.canvas.mark(r, A.SITES.canvas.item({ ...j, message: '', locked_for_user: true }, O)), null, 'nothing to show, nothing marked');
  assert.equal(A.SITES.canvas.item({ ...j, message: '', locked_for_user: true }, O).locked, true);
});

test('Ultra: the public announcement, its embedded files on this site, no author and no read mark', () => {
  const U = 'https://lms.example.edu';
  const r = A.ref({ site: 'ultra', courseId: '_101_1', id: '_1001_1', url: '/ultra/courses/_101_1/announcements' }, U);
  assert.equal(A.SITES.ultra.path(r), '/learn/api/public/v1/courses/_101_1/announcements/_1001_1?fields=id,title,body,created,availability');
  const it = A.SITES.ultra.item({ id: '_1001_1', title: 'Lab 3 is up', created: '2026-10-12T13:00:00.000Z',
    body: '<p>See <img src="@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-1_1" alt="lab"></p><img src="https://cdn.evil.example/a.png">' }, U);
  assert.equal(it.author, '');
  assert.equal(it.at, Date.parse('2026-10-12T13:00:00.000Z'));
  assert.equal(it.unread, null, 'the public API says nothing of it');
  const imgs = all(P.safe(it.html, U, N, doc)).filter((e) => e.tagName === 'IMG');
  assert.deepEqual(imgs.map((e) => P.picture(e)), [`${U}/bbcswebdav/xid-1_1`]);
  assert.equal(A.SITES.ultra.mark(r, it), null);
  // Ultra's private list shape (test/fixtures/ultra-announcements.json): its body object and read state are read too.
  const priv = JSON.parse(fs.readFileSync(require.resolve('./fixtures/ultra-announcements.json'), 'utf8')).results[0];
  const p = A.SITES.ultra.item(priv, U);
  assert.equal(p.html, '<p>Lab 3 is posted.</p>');
  assert.equal(p.unread, true);
  assert.equal(p.at, Date.parse('2026-10-12T13:00:00.000Z'));
});

test('Moodle: the discussion\'s first post through service.php, with the session key; a preview never asks', () => {
  const r = A.ref({ site: 'moodle', id: '12', url: '/mod/forum/discuss.php?d=12' }, O);
  const g = A.SITES.moodle.get(r, { root: `${O}/moodle`, sesskey: 'k1 2' });
  assert.equal(g.url, `${O}/moodle/lib/ajax/service.php?sesskey=k1%202&info=mod_forum_get_discussion_posts`);
  assert.deepEqual(JSON.parse(g.body), [{ index: 0, methodname: 'mod_forum_get_discussion_posts', args: { discussionid: 12, sortby: 'created', sortdirection: 'ASC' } }]);
  assert.equal(A.SITES.moodle.peek, false, 'Moodle marks posts read as it answers');
  const answer = [{ error: false, data: { posts: [
    { id: 41, subject: 'Re: Exam', hasparent: true, parentid: 40, message: '<p>reply</p>', author: { fullname: 'Sam' }, timecreated: 1760000100 },
    { id: 40, subject: 'Exam room', hasparent: false, parentid: null, message: HOSTILE, author: { fullname: 'Dr. Rivera' }, timecreated: 1760000000, unread: true,
      attachments: [{ filename: 'seating.pdf', url: `${O}/pluginfile.php/5/mod_forum/attachment/40/seating.pdf` }, { filename: 'x', url: 'https://evil.example/x' }] },
  ] } }];
  const it = A.SITES.moodle.item(answer, O);
  assert.equal(it.title, 'Exam room', 'the discussion\'s own post, not a reply');
  assert.equal(it.author, 'Dr. Rivera');
  assert.equal(it.at, 1760000000000);
  assert.equal(it.unread, true);
  assert.deepEqual(it.files.map((f) => f.name), ['seating.pdf']);
  assert.throws(() => A.SITES.moodle.item([{ error: true, exception: { errorcode: 'invalidrecord' } }], O), /invalidrecord/);
  assert.throws(() => A.SITES.moodle.item([{ error: false, data: { posts: [] } }], O), /no post/);
});

test('the preview goes beside the link, never over it, inside the viewport, at 320px too', () => {
  const cases = [
    [{ left: 20, right: 220, top: 100, bottom: 120 }, 300, 120, 1440, 900],
    [{ left: 1300, right: 1420, top: 850, bottom: 870 }, 380, 150, 1440, 900], // bottom right: above, pulled in
    [{ left: 10, right: 300, top: 300, bottom: 320 }, 380, 200, 320, 640],
    [{ left: 10, right: 300, top: 200, bottom: 220 }, 300, 900, 320, 480], // taller than either side: capped
  ];
  for (const [a, w, h, vw, vh] of cases) {
    const p = P.place(a, w, h, vw, vh);
    const height = Math.min(h, p.maxHeight), width = Math.min(w, vw - 16);
    assert.ok(p.left >= 8 && p.left + width <= vw - 8, `inside horizontally ${JSON.stringify(p)}`);
    assert.ok(p.top >= 8 && p.top + height <= vh - 8, `inside vertically ${JSON.stringify(p)}`);
    assert.ok(p.top >= a.bottom || p.top + height <= a.top, `not over the link ${JSON.stringify(p)}`);
  }
  assert.equal(P.place({ left: 1300, right: 1420, top: 850, bottom: 870 }, 380, 150, 1440, 900).side, 'above');
});

test('how a pop-up moves: none with motion off or reduced or None; the genie only on Expressive', () => {
  for (const level of ['off', 'subtle', 'expressive']) for (const anim of ['genie', 'fade', 'none']) {
    assert.equal(P.motion({ anim, level, reduced: true }), 'none', `${anim} ${level} reduced`);
  }
  assert.equal(P.motion({ anim: 'genie', level: 'off' }), 'none');
  assert.equal(P.motion({ anim: 'none', level: 'expressive' }), 'none');
  assert.equal(P.motion({ anim: 'fade', level: 'expressive' }), 'fade');
  assert.equal(P.motion({ anim: 'fade', level: 'subtle' }), 'fade');
  assert.equal(P.motion({ anim: 'genie', level: 'subtle' }), 'scale');
  assert.equal(P.motion({ anim: 'genie', level: 'expressive' }), 'genie');
  assert.ok(P.timing('fade', false).duration <= 120, 'a fade is short');
  const g = P.timing('genie', false), back = P.timing('genie', true);
  assert.ok(g.duration >= 350 && g.duration <= 450 && back.duration < g.duration, 'the genie: about 350–450 ms in, a little less out');
});

test('the genie funnels from the link: only transform, opacity and clip-path, the near edge as wide as the link first', () => {
  const s = { left: 100, right: 260, top: 40, bottom: 60, width: 160, height: 20 };
  const d = { left: 300, right: 900, top: 150, bottom: 650, width: 600, height: 500 };
  const g = P.genie(s, d);
  for (const f of g.frames) for (const k of Object.keys(f)) assert.ok(['offset', 'opacity', 'transform', 'clipPath'].includes(k), k);
  const pts = (f) => f.clipPath.match(/^polygon\((.*)\)$/)[1].split(', ').map((p) => p.split(' ').map(parseFloat));
  assert.ok(g.frames.every((f) => pts(f).length === 6), 'the same points throughout, so the shape morphs');
  const first = pts(g.frames[0]), last = pts(g.frames.at(-1));
  assert.ok(g.frames.every((f) => /^polygon\((?:-?[\d.]+% -?[\d.]+%(?:, )?)+\)$/.test(f.clipPath)), 'in shares of the box, so a growing dialog keeps the shape');
  // The link sits left of the dialog: the first edge still starts at the text's actual position and width.
  assert.equal(first[0][1], 0, 'the near edge is the top: the link is above');
  assert.ok(first[1][0] - first[0][0] >= 2 && first[1][0] - first[0][0] < 100, 'narrow at the start');
  assert.deepEqual([last[0], last[1]], [[0, 0], [100, 0]], 'full width at the end');
  assert.equal(g.frames.at(-1).transform, 'none');
  const [dx, dy] = g.frames[0].transform.match(/-?[\d.]+/g).map(Number);
  assert.ok(Math.abs(d.left + first[0][0] / 100 * d.width + dx - s.left) < 0.1, 'it starts at the link horizontally');
  assert.ok(Math.abs((first[1][0] - first[0][0]) / 100 * d.width - s.width) < 0.1, 'the starting width is the text width');
  assert.equal(d.top + dy, s.top, 'it starts at the link vertically');
  // Below the dialog, the bottom edge is the near one.
  const up = P.genie({ ...s, top: 700, bottom: 720 }, d);
  assert.equal(pts(up.frames[0])[0][1], 100);
  assert.match(up.origin, / 100%$/);
  assert.equal(P.onScreen({ left: -50, right: -10, top: 0, bottom: 10, width: 40, height: 10 }, 1440, 900), false);
});

test('pictures reject data URLs, credentials and external URLs before any network request', () => {
  const html = '<img src="data:image/svg+xml,<svg onload=alert(1)>"><img src="//tracker.example/a"><img src="https://a:b@school.instructure.com/a"><img src="/ok" style="background:url(https://tracker.example/css)">';
  const els = all(P.safe(html, O, N, doc));
  const imgs = els.filter((e) => e.tagName === 'IMG');
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].getAttribute('src'), null);
  assert.equal(P.picture(imgs[0]), `${O}/ok`);
  assert.equal(imgs[0].getAttribute('style'), null);
});
