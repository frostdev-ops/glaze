// Ultra's file previews (Blackboard's document viewer) carry a ticket good for about two minutes, and Ultra reuses the
// address it got with the page whenever a preview is expanded again. content-ultra.js notes the requests that brought
// previews; features/docs.js (in a VM with stand-ins) asks one again and swaps in the same document's fresh address.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ORIGIN = 'https://school.example.edu';
const VIEWER = 'https://annotate-us.foundations.blackboard.com/ui/pdf-viewer/0.0.113-22829e9/index.html';
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const viewer = (doc, expIn, status = 'complete') => `${VIEWER}?env=prod&ticket=${jwt({ document_id: doc, exp: Math.floor((Date.now() + expIn) / 1000) })}&locale=en_US&status=${status}`;
const ASK = `${ORIGIN}/learn/api/v1/courses/_1_1/gradebook/attempts/_7_1?expand=toolAttemptDetail,viewUrl`;

test('content-ultra.js notes the requests that asked for viewer addresses, newest first', () => {
  const line = fs.readFileSync(path.join(root, 'content-ultra.js'), 'utf8').split('\n').find((l) => l.includes('new PerformanceObserver'));
  let seen;
  const ctx = vm.createContext({ PerformanceObserver: class { constructor(f) { seen = f; } observe(o) { assert.equal(JSON.stringify(o), '{"type":"resource","buffered":true}'); } } });
  ctx.self = ctx;
  vm.runInContext(line, ctx);
  seen({ getEntries: () => [{ name: `${ORIGIN}/learn/api/v1/users/me` }, { name: ASK }, { name: `${ORIGIN}/learn/api/v1/files/_9_1?expand=viewerUrl` }] });
  assert.deepEqual([...ctx.GZ_ASKS], [`${ORIGIN}/learn/api/v1/files/_9_1?expand=viewerUrl`, ASK]);
});

const page = ({ src, asks = [ASK], answer }) => {
  const iframe = { src, isConnected: true, addEventListener() {}, getClientRects: () => [] };
  const fetched = [];
  const timers = [];
  const ctx = vm.createContext({
    URL, JSON, Object, Array, Set, Date, Math, atob, location: new URL(`${ORIGIN}/ultra/courses/_1_1/assessment/_3_1/attempt/create`),
    setTimeout: (f, ms) => timers.push({ f, ms }), IntersectionObserver: class { observe() {} unobserve() {} },
    fetch: async (url, init) => { fetched.push({ url, init }); return { ok: true, text: async () => JSON.stringify(answer) }; },
    document: { documentElement: { matches: () => false, removeAttribute() {}, toggleAttribute() {} }, querySelector: () => null, querySelectorAll: () => [iframe], addEventListener() {} },
  });
  ctx.globalThis = ctx;
  ctx.GZ_ASKS = asks;
  ctx.GZ_CTX = { site: 'ultra', solo: true, t: (w) => w, on: () => true, darkTheme: () => false, settings: () => ({ enhance: { toggles: true, docPages: 'plain' } }), PREVIEWS: 'iframe', DOC: '.doc' };
  vm.runInContext(fs.readFileSync(path.join(root, 'features/docs.js'), 'utf8'), ctx);
  return { iframe, fetched, timers, sync: () => ctx.GZ_DOCS.sync() };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

test('an expanded preview whose ticket ran out gets the same document\'s fresh address from Ultra\'s request, asked again', async () => {
  const fresh = viewer('doc-a', 120000);
  // The answer holds the file as a field and another document inside a submission's HTML, entities and all.
  const answer = { studentSubmission: `<a data-bbfile="{&quot;viewerUrl&quot;:&quot;${viewer('doc-b', 120000).replace(/&/g, '&amp;')}&quot;}">b</a>`, studentSubmissionFiles: [{ viewUrl: fresh }] };
  const p = page({ src: viewer('doc-a', -60000), asks: ['https://evil.example/learn/api/x?viewUrl', ASK, ASK], answer });
  p.sync();
  await settle();
  assert.deepEqual(p.fetched.map((f) => f.url), [ASK], 'once, and only this site\'s own Learn API');
  assert.equal(p.fetched[0].init.credentials, 'same-origin');
  assert.equal(p.iframe.src, fresh);
  assert.equal(p.timers.length, 0, 'done: nothing more to ask');
  p.sync();
  await settle();
  assert.equal(p.fetched.length, 1, 'a frame is looked at once');
});

test('a preview with a live ticket asks nothing; one made while the file converts is asked about until it is ready', async () => {
  const live = page({ src: viewer('doc-a', 100000), answer: {} });
  live.sync();
  await settle();
  assert.deepEqual(live.fetched, []);

  const converting = viewer('doc-a', 100000, 'pending');
  const p = page({ src: converting, answer: { studentSubmissionFiles: [{ viewUrl: viewer('doc-a', 120000, 'pending') }] } });
  p.sync();
  await settle();
  assert.equal(p.iframe.src, converting, 'still converting: the open viewer is left alone while its ticket lasts');
  assert.equal(p.timers.length, 1);
  assert.equal(p.timers[0].ms, 15000);
});
