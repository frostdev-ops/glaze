// The DocViewer: its manifest entry, its budget, and what the Canvas page tells a canvadocs frame (content.js's
// "DocViewer" block, run in a VM with stand-ins, as test/ondemand.test.js does). The frame's side and the drawing run in
// a headless browser against test/fixtures/canvas-docviewer.html (scripts/docviewer-check.js); the math is test/ink.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const m = require('../manifest.json');

const root = path.join(__dirname, '..');
const DOCS = ['https://canvadocs.instructure.com/*'];
const entry = m.content_scripts.find((c) => c.js.includes('features/docviewer.js'));

test('canvadocs gets its own small script in every frame, and not the first content script', () => {
  assert.deepEqual(entry.matches, DOCS);
  assert.deepEqual(entry.js, ['lib/ink.js', 'features/docviewer.js']);
  assert.equal(entry.all_frames, true, 'the viewer is always framed');
  assert.equal(entry.run_at, 'document_start');
  assert.deepEqual(m.content_scripts[0].exclude_matches, DOCS);
});

// A ratchet, as the first script's: lib/ink.js and features/docviewer.js as W9 left them, plus about 2%.
const DOCVIEWER_BASELINE = 29869;
test('the DocViewer script stays within its budget', () => {
  const total = entry.js.reduce((n, f) => n + fs.statSync(path.join(root, f)).size, 0);
  assert.ok(total <= Math.round(DOCVIEWER_BASELINE * 1.02), `${total} bytes in ${entry.js.join(', ')}: over ${DOCVIEWER_BASELINE} + 2%`);
});

const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const block = (from, to) => {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert.ok(a > 0 && b > a, `markers ${from} … ${to}`);
  return source.slice(a, b);
};
const page = ({ src, href = 'https://school.instructure.com/courses/1/modules', words = true } = {}) => {
  const sent = [];
  const listeners = [];
  const frame = { closed: false, postMessage: (msg, origin) => sent.push({ msg, origin }) };
  const iframe = { src, contentWindow: frame };
  const later = new Set();
  const ctx = vm.createContext({
    ultra: false, moodle: false, links: [1], darkTheme: true, URL, URLSearchParams, JSON, Object, String, Array,
    location: new URL(href),
    settings: { enhance: { docTheme: true, docPages: 'dim', docInk: true } },
    GZ_COLORS: [['--gz-surface'], ['--gz-ink']],
    html: { style: { getPropertyValue: (v) => ({ '--gz-surface': '#0d1b2e', '--gz-ink': '#e8f2fa' })[v] } },
    document: { getElementsByTagName: () => [iframe] },
    addEventListener: (type, f) => listeners.push([type, f]),
    t: (w) => ({ Pen: 'Stift' })[w] || w,
    words: () => words, wordsIn: later,
  });
  vm.runInContext(`${block('  // ---- DocViewer (Canvas)', '  const frameIO')}; globalThis.tellDocs = tellDocs;`, ctx);
  const ask = (data, origin = 'https://canvadocs.instructure.com', source = frame) => listeners.find(([t]) => t === 'message')[1]({ data, origin, source });
  return { sent, ask, frame, ctx, later };
};
const BLOB = encodeURIComponent(JSON.stringify({ user_id: 170000000000042, attachment_id: 21, type: 'canvadoc' }));

test('a canvadocs frame of this page is told the palette, the switches, the file and whose, at its own origin', () => {
  const { sent, ask } = page({ src: `/api/v1/canvadoc_session?blob=${BLOB}&hmac=abc` });
  ask({ gz: 'docs?', words: ['Pen', 'Eraser'] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].origin, 'https://canvadocs.instructure.com', 'never "*"');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].msg)), {
    gz: 'docs', on: true, dark: true, colors: { '--gz-surface': '#0d1b2e', '--gz-ink': '#e8f2fa' }, theme: true, pages: 'dim', ink: true,
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

test('the frame is told again when settings change and when the words arrive, until it is gone', () => {
  const { sent, ask, frame, ctx, later } = page({ src: `/api/v1/canvadoc_session?blob=${BLOB}`, words: false });
  ask({ gz: 'docs?' });
  assert.equal(later.size, 1, 'waits for the words');
  for (const f of later) f();
  ctx.tellDocs();
  assert.equal(sent.length, 3);
  frame.closed = true;
  ctx.tellDocs();
  assert.equal(sent.length, 3);
});
