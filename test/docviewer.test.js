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
const DOCS = ['https://canvadocs.instructure.com/*'];
const entry = m.content_scripts.find((c) => c.js.includes('features/docviewer.js'));

test('canvadocs gets its own small script in every frame, and not the first content script', () => {
  assert.deepEqual(entry.matches, DOCS);
  assert.deepEqual(entry.js, ['lib/ink.js', 'lib/surfaces.js', 'features/docviewer.js']);
  assert.equal(entry.all_frames, true, 'the viewer is always framed');
  assert.equal(entry.run_at, 'document_start');
  const glaze = m.content_scripts.filter((x) => x.js.includes('content.js'));
  assert.deepEqual(glaze.find((c) => c.js.includes('content-canvas.js')).exclude_matches, DOCS);
  assert.ok(glaze.find((c) => c.js.includes('content-ultra.js')).exclude_matches.includes('https://*.instructure.com/*'), 'nor does Ultra\'s: no instructure.com host');
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
  const settings = D.GZ_SANITIZE({ enhance: { docTheme: true, docPages: 'dim', docInk: true, toggles: true } });
  const ctx = vm.createContext({
    URL, URLSearchParams, JSON, Object, String, Array, location: new URL(href), window: {}, IntersectionObserver: class { observe() {} },
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
  return { sent, ask, frame, iframe, docs: ctx.GZ_DOCS, later, settings, ctx };
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

test('with no user in the blob, Canvas names you; signed out is "anon"; any other failure is no one', async () => {
  const src = 'https://canvadocs.instructure.com/1/sessions/x/view';
  for (const [profile, want] of [[() => Promise.resolve({ id: '170000000000077' }), '170000000000077'], [() => Promise.reject(401), 'anon'],
    [() => Promise.reject(403), 'anon'], [() => Promise.reject(500), ''], [() => Promise.reject(new TypeError('offline')), ''], [() => Promise.resolve({}), '']]) {
    const { sent, ask } = page({ src, href: 'https://school.instructure.com/courses/1/files/77', profile });
    ask({ gz: 'docs?' });
    assert.equal(sent[0].msg.user, '', 'not known yet: no one');
    await new Promise(setImmediate);
    assert.equal(sent.at(-1).msg.user, want, String(want));
  }
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
