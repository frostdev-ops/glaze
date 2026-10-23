// The DocViewer: its manifest entry, its budget, and what the Canvas page tells a canvadocs frame (features/docs.js,
// run in a VM with stand-ins, and content.js's hook). The frame's side and the drawing run in
// a headless browser against test/fixtures/canvas-docviewer.html (scripts/docviewer-check.js); the math is test/ink.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const m = require('../manifest.json');
const D = require('../defaults.js');

const root = path.join(__dirname, '..');
const DOCS = ['https://canvadocs.instructure.com/*']; // what Canvas's own entry leaves out: the US host
// The viewer entry matches every instructure.com host, so the regional ones (canvadocs-syd, canvadocs-eu…) get it too; the
// script keeps to canvadocs hostnames itself. Match patterns can't say "canvadocs-*", and a list of regions would go stale.
const VIEWER_MATCHES = ['https://*.instructure.com/*'];
const entry = m.content_scripts.find((c) => c.js.includes('features/docviewer.js'));

test('canvadocs gets its own small script in every frame, and not the first content script', () => {
  assert.deepEqual(entry.matches, VIEWER_MATCHES);
  assert.deepEqual(entry.js, ['lib/ink.js', 'lib/surfaces.js', 'features/docviewer.js']);
  assert.equal(entry.all_frames, true, 'the viewer is always framed');
  assert.equal(entry.run_at, 'document_start');
  const glaze = m.content_scripts.filter((x) => x.js.includes('content.js'));
  assert.deepEqual(glaze.find((c) => c.js.includes('content-canvas.js')).exclude_matches, DOCS);
  assert.ok(glaze.find((c) => c.js.includes('content-ultra.js')).matches.every((p) => p.startsWith('https://*.blackboard.com/')), 'nor does Ultra\'s: Blackboard\'s hosts only');
  assert.deepEqual(glaze.find((c) => c.matches.includes('https://*.moodlecloud.com/*')).matches, ['https://*.moodlecloud.com/*'], 'nor MoodleCloud\'s');
});

// Chrome's match pattern for one scheme://host/path: "*." in front of the host is any subdomain of it.
const matchesHost = (pattern, host) => { const h = /^https:\/\/([^/]+)\//.exec(pattern)[1]; return h.startsWith('*.') ? host.endsWith(h.slice(1)) : host === h; };
const runViewer = (hostname) => {
  const ctx = vm.createContext({ document: { contentType: 'text/html', documentElement: {} }, top: {}, location: { hostname }, parent: {}, GZ_INK: {}, URL }); // no Canvas page named: it stops after the hostname gate
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(root, 'features/docviewer.js'), 'utf8'), ctx);
  return ctx.__gzDocs === true;
};
test('regional DocViewer hosts get the viewer script, and it keeps to canvadocs hostnames', () => {
  const hosts = ['canvadocs.instructure.com', 'canvadocs-syd.instructure.com', 'canvadocs-eu-west-1.instructure.com'];
  for (const host of hosts) {
    assert.ok(entry.matches.some((p) => matchesHost(p, host)), `${host} is matched by the viewer entry`);
    assert.equal(runViewer(host), true, `${host} runs it`);
  }
  // The wider match reaches every Canvas frame; the script must stand down on all of them.
  for (const host of ['school.instructure.com', 'canvadocs.instructure.com.evil.example', 'evil-canvadocs.instructure.com', 'canvadocs-.example.com']) assert.equal(runViewer(host), false, `${host} does not`);
  assert.ok(!DOCS.some((p) => matchesHost(p, 'canvadocs-syd.instructure.com')), 'Canvas\'s entry only skips the US host: the page side bails on the others');
});

// A ratchet, as the first script's: lib/ink.js and features/docviewer.js as W9 left them (with the review's fixes), plus about 2%.
const DOCVIEWER_BASELINE = 34317; // Shared surface model and local viewer controls, including message validation.
test('the DocViewer script stays within its budget', () => {
  const total = entry.js.reduce((n, f) => n + fs.statSync(path.join(root, f)).size, 0);
  assert.ok(total <= Math.round(DOCVIEWER_BASELINE * 1.02), `${total} bytes in ${entry.js.join(', ')}: over ${DOCVIEWER_BASELINE} + 2%`);
});

// features/docs.js answers; content-canvas.js only hands it the message (and loads it for that).
const page = ({ src, href = 'https://school.instructure.com/courses/1/modules', profile = () => Promise.resolve({ id: '170000000000077' }) } = {}) => {
  const sent = [];
  const frame = { closed: false, postMessage: (msg, origin) => sent.push({ msg, origin }) };
  const iframe = { src, contentWindow: frame };
  const later = new Set();
  const timers = [];
  const settings = D.GZ_SANITIZE({ enhance: { docTheme: true, docPages: 'dim', docInk: true, toggles: true } });
  const ctx = vm.createContext({
    URL, URLSearchParams, JSON, Object, String, Array, Math, setTimeout: (f, ms) => timers.push({ f, ms }), location: new URL(href), window: {}, IntersectionObserver: class { observe() {} },
    GZ_COLORS: [['--gz-surface'], ['--gz-ink']], GZ_COURSE_LOOK: D.GZ_COURSE_LOOK,
    document: {
      documentElement: { style: { getPropertyValue: (v) => ({ '--gz-surface': '#0d1b2e', '--gz-ink': '#e8f2fa', '--gz-surface-course': '#445566' })[v] }, matches: () => false, removeAttribute() {} },
      getElementsByTagName: () => [iframe], querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    },
  });
  ctx.globalThis = ctx;
  ctx.GZ_CTX = { site: 'canvas', canvasCourseKey: () => { const id = new URL(href).pathname.match(/\/courses\/(\d+)/)?.[1]; return id ? `canvas:${new URL(href).origin}/${id}` : null; }, t: (w) => ({ Pen: 'Stift' })[w] || w, on: () => true, darkTheme: () => true, settings: () => settings, wordsIn: later, PREVIEWS: 'iframe', DOC: '.doc',
    profile: () => { ctx.profiles = (ctx.profiles || 0) + 1; return profile(); } };
  vm.runInContext(fs.readFileSync(path.join(root, 'features/docs.js'), 'utf8'), ctx);
  const ask = (data, origin = 'https://canvadocs.instructure.com', source = frame) => ctx.GZ_DOCS.ask({ data, origin, source });
  return { sent, ask, frame, iframe, docs: ctx.GZ_DOCS, later, settings, ctx, timers };
};

test('Canvas\'s part (content-canvas.js) loads features/docs.js for a canvadocs frame\'s question only, and hands it the message', async () => {
  const src = fs.readFileSync(path.join(root, 'content-canvas.js'), 'utf8');
  const line = src.split('\n').find((l) => l.includes("e.data?.gz === 'docs?'"));
  const asked = [];
  let listener;
  const ctx = vm.createContext({ ultra: false, moodle: false, addEventListener: (t, f) => { if (t === 'message') listener = f; },
    need: (file) => { asked.push(file); return Promise.resolve(); }, globalThis: {} });
  ctx.GZ_DOCS = { ask: (e) => asked.push(e.origin) };
  vm.runInContext(line, ctx);
  for (const origin of ['https://evil.example', 'https://canvadocs.instructure.com.evil.example', 'http://canvadocs.instructure.com']) listener({ data: { gz: 'docs?' }, origin });
  listener({ data: { gz: 'other' }, origin: 'https://canvadocs.instructure.com' });
  assert.deepEqual(asked, []);
  listener({ data: { gz: 'docs?' }, origin: 'https://canvadocs.instructure.com' });
  await new Promise(setImmediate);
  assert.deepEqual(asked, ['features/docs.js', 'https://canvadocs.instructure.com']);
});

const BLOB = encodeURIComponent(JSON.stringify({ user_id: 170000000000042, attachment_id: 21, type: 'canvadoc' }));

test('a canvadocs frame of this page is told the palette, the switches, the file and whose, at its own origin', () => {
  const { sent, ask } = page({ src: `/api/v1/canvadoc_session?blob=${BLOB}&hmac=abc` });
  ask({ gz: 'docs?', words: ['Pen', 'Eraser'] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].origin, 'https://canvadocs.instructure.com', 'never "*"');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].msg)), {
    gz: 'docs', on: true, dark: true, look: D.GZ_DEFAULTS.look, colors: { '--gz-surface': '#0d1b2e', '--gz-ink': '#e8f2fa', '--gz-surface-course': '#445566' }, theme: true, pages: 'dim', ink: true,
    file: '21', user: '170000000000042', words: { Pen: 'Stift', Eraser: 'Eraser' },
  });
});

test('the file comes from the page when the frame\'s address has no session blob; regional hosts are answered too', () => {
  const { sent, ask } = page({ src: 'https://canvadocs-syd.instructure.com/1/sessions/x/view', href: 'https://canvas.school.edu/courses/1/files/77?module_item_id=3' });
  ask({ gz: 'docs?' }, 'https://canvadocs-syd.instructure.com');
  assert.equal(sent[0].origin, 'https://canvadocs-syd.instructure.com');
  assert.equal(sent[0].msg.file, '77');
  assert.equal(sent[0].msg.user, '');
});

test('with no user in the blob, Canvas names you; only a signed-out answer is "anon"; any other failure is no one', async () => {
  const src = 'https://canvadocs.instructure.com/1/sessions/x/view';
  for (const [profile, want] of [[() => Promise.resolve({ id: '170000000000077' }), '170000000000077'], [() => Promise.reject(401), 'anon'],
    [() => Promise.reject(403), ''], [() => Promise.reject(429), ''], [() => Promise.reject(500), ''], [() => Promise.reject(new TypeError('offline')), ''], [() => Promise.resolve({}), '']]) {
    const { sent, ask } = page({ src, href: 'https://school.instructure.com/courses/1/files/77', profile });
    ask({ gz: 'docs?' });
    assert.equal(sent[0].msg.user, '', 'not known yet: no one');
    await new Promise(setImmediate);
    assert.equal(sent.at(-1).msg.user, want, String(want));
  }
});

// Canvas answers a throttled or forbidden read with 403 as well; filing a student's marks under the site's shared "anon"
// key for that would show them on (and mix them with) every signed-out viewer's, and lose them once the read works.
test('a throttled or forbidden profile read files nothing under "anon", and is asked again later until it answers', async () => {
  const src = 'https://canvadocs.instructure.com/1/sessions/x/view';
  const answers = [() => Promise.reject(403), () => Promise.reject(429), () => Promise.resolve({ id: '170000000000077' })];
  const { sent, ask, timers, ctx } = page({ src, href: 'https://school.instructure.com/courses/1/files/77', profile: () => (answers[ctx.profiles - 1] || answers.at(-1))() });
  ask({ gz: 'docs?' });
  await new Promise(setImmediate);
  assert.deepEqual([ctx.profiles, sent.at(-1).msg.user, timers.length], [1, '', 1], 'no one for now; one retry waiting');
  for (const send of sent) assert.notEqual(send.msg.user, 'anon');
  const waits = [timers.at(-1).ms];
  assert.ok(waits[0] >= 10000, `a pause before asking again (${waits[0]} ms)`);
  timers.pop().f();
  await new Promise(setImmediate);
  assert.deepEqual([ctx.profiles, sent.at(-1).msg.user, timers.length], [2, '', 1], 'throttled again: still no one, and it waits longer');
  waits.push(timers.at(-1).ms);
  assert.ok(waits[1] > waits[0], `backs off (${waits})`);
  timers.pop().f();
  await new Promise(setImmediate);
  assert.deepEqual([ctx.profiles, sent.at(-1).msg.user, timers.length], [3, '170000000000077', 0], 'answered: the marks are the student\'s, and nothing more is asked');
  ask({ gz: 'docs?' });
  await new Promise(setImmediate);
  assert.equal(ctx.profiles, 4, 'a new question from the frame starts over');
});

test('signed out (401) is final: "anon", and Canvas is not asked again', async () => {
  const { sent, ask, timers, ctx } = page({ src: 'https://canvadocs.instructure.com/1/sessions/x/view', href: 'https://school.instructure.com/courses/1/files/77', profile: () => Promise.reject(401) });
  ask({ gz: 'docs?' });
  await new Promise(setImmediate);
  assert.deepEqual([sent.at(-1).msg.user, ctx.profiles, timers.length], ['anon', 1, 0]);
});

test('an unreadable profile answer retries, and a detached viewer stops retrying', async () => {
  const p = page({ src: 'https://canvadocs.instructure.com/1/sessions/x/view', profile: () => Promise.resolve({}) });
  p.ask({ gz: 'docs?' });
  await new Promise(setImmediate);
  assert.equal(p.timers.length, 1, 'no user id is unknown, not a permanent empty identity');
  p.ctx.document.getElementsByTagName = () => [];
  p.timers.pop().f();
  await new Promise(setImmediate);
  assert.equal(p.ctx.profiles, 1, 'the removed frame never asks again');
  assert.equal(p.later.size, 0, 'the removed frame no longer waits for words');
});

test('an answer still on its way for the frame\'s earlier file (its profile, its words) is dropped once the frame asks again', async () => {
  let held;
  const profile = () => new Promise((y) => { held = y; });
  const { sent, ask, iframe, later } = page({ src: 'https://canvadocs.instructure.com/1/sessions/x/view', href: 'https://school.instructure.com/courses/1/files/21', profile });
  ask({ gz: 'docs?' });
  assert.equal(sent.at(-1).msg.file, '21');
  // The same frame moves on to file 22, whose address names user 42.
  iframe.src = `/api/v1/canvadoc_session?blob=${encodeURIComponent(JSON.stringify({ user_id: 42, attachment_id: 22 }))}`;
  ask({ gz: 'docs?' });
  const now = sent.length;
  assert.deepEqual([sent.at(-1).msg.file, sent.at(-1).msg.user], ['22', '42']);
  held({ id: '42' }); // file 21's profile comes back
  await new Promise(setImmediate);
  for (const f of later) f(); // and the words arrive
  assert.equal(sent.length, now, 'nothing said for file 21');
  assert.equal(later.size, 1, 'only the latest question waits for the words');
});

test('Canvas is asked who you are only while annotations are on, and once', async () => {
  const { ask, ctx, settings, docs } = page({ src: 'https://canvadocs.instructure.com/1/sessions/x/view' });
  settings.enhance = { ...settings.enhance, docInk: false };
  ask({ gz: 'docs?' });
  docs.sync();
  assert.equal(ctx.profiles, undefined);
  settings.enhance = { ...settings.enhance, docInk: true };
  docs.sync();
  docs.sync();
  await new Promise(setImmediate);
  docs.sync();
  assert.equal(ctx.profiles, 1);
});

test('with Glaze off, Canvas isn\'t asked who you are, even with annotations on', async () => {
  const { ask, ctx, docs, sent } = page({ src: 'https://canvadocs.instructure.com/1/sessions/x/view' });
  ctx.GZ_CTX.on = () => false;
  ask({ gz: 'docs?' });
  docs.sync();
  await new Promise(setImmediate);
  assert.equal(ctx.profiles, undefined);
  assert.equal(sent.at(-1).msg.on, false);
});

test('nobody else is answered: other origins, other windows, other messages', () => {
  const { sent, ask } = page({ src: `/api/v1/canvadoc_session?blob=${BLOB}` });
  ask({ gz: 'docs?' }, 'https://evil.example');
  ask({ gz: 'docs?' }, 'https://canvadocs.instructure.com.evil.example');
  ask({ gz: 'docs?' }, 'http://canvadocs.instructure.com');
  ask({ gz: 'docs?' }, 'https://canvadocs.instructure.com', { postMessage: () => assert.fail('a window that is not a frame of this page') });
  ask({ gz: 'other' });
  ask(null);
  assert.equal(sent.length, 0);
});

test('a malformed blob or ids are not passed on', () => {
  const bad = encodeURIComponent(JSON.stringify({ user_id: '1"><x', attachment_id: '../2' }));
  const { sent, ask } = page({ src: `/api/v1/canvadoc_session?blob=${bad}`, href: 'https://school.instructure.com/courses/1/pages/x' });
  ask({ gz: 'docs?', words: Array(100).fill('x'.repeat(200)) });
  assert.equal(sent[0].msg.file, '');
  assert.equal(sent[0].msg.user, '');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].msg.words)), {});
});

test('the frame is told again when anything it was told changes and when the words arrive, until it is gone', () => {
  const { sent, ask, frame, docs, later, settings } = page({ src: `/api/v1/canvadoc_session?blob=${BLOB}` });
  ask({ gz: 'docs?' });
  assert.equal(later.size, 1, 'waits for the words');
  docs.sync();
  assert.equal(sent.length, 1, 'nothing changed: not told again');
  settings.enhance = { ...settings.enhance, docPages: 'dark' };
  docs.sync();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].msg.pages, 'dark');
  frame.closed = true;
  settings.enhance = { ...settings.enhance, docPages: 'plain' };
  docs.sync();
  assert.equal(sent.length, 2);
});

test('a DocViewer receives its containing course Look rather than global surfaces', () => {
  const p = page({ src: `/api/v1/canvadoc_session?blob=${BLOB}` });
  p.settings.look.surfaceCustom = true; p.settings.look.surfaceColor = '#ff0000'; p.settings.look.radius = 24;
  p.settings.courses.looks['canvas:https://school.instructure.com/1'] = 'Terminal';
  p.ask({ gz: 'docs?' });
  assert.equal(p.sent[0].msg.colors['--gz-surface-course'], '#445566');
  const look = p.sent[0].msg.look;
  assert.equal(look.radius, 2); assert.equal(look.glass, 0); assert.equal(look.depth, 0);
  assert.equal(look.surfaceCustom, false); assert.equal(look.surfaceFrost, 0);
});
