// Documents' Look (papers.js theme): the newest storage read wins, a refusal after a live change is handled, and the home
// wears the whole Look: the motion level as content.js takes it, Settings' backdrop only while the Look has a background
// and Glaze is on, fed the Look and its parts once it says it is ready.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const theme = async ({ whole = false, reduced = false } = {}) => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'papers.js'), 'utf8');
  const body = raw.slice(raw.indexOf('  const theme = async () => {'), raw.indexOf('  theme().catch'));
  const pending = [], events = {}, errors = [], painted = [], posted = [], listeners = [];
  const attrs = new Map();
  const root = { style: {}, dataset: {}, toggleAttribute(k, on) { if (on) attrs.set(k, ''); else attrs.delete(k); }, getAttribute: (k) => attrs.get(k) ?? null };
  const frames = [];
  const element = () => {
    const a = new Map(), e = { contentWindow: { postMessage: (m, o) => posted.push([m, o]) }, contentDocument: null, removed: false,
      setAttribute: (k, v) => a.set(k, v), hasAttribute: (k) => a.has(k), remove() { e.removed = true; } };
    frames.push(e);
    return e;
  };
  const ctx = vm.createContext({ document: { documentElement: root, createElement: element, body: { prepend() {} } }, console: { error: (e) => errors.push(e) },
    matchMedia: (q) => ({ matches: /reduced-motion/.test(q) ? reduced : false, addEventListener: (k, fn) => { events[/reduced/.test(q) ? 'calm' : 'scheme'] = fn; } }),
    addEventListener: (type, fn) => listeners.push(fn), location: { origin: 'chrome-extension://glaze' }, requestAnimationFrame: () => 0,
    look: { whole, paint: () => {}, sheet: () => {} }, GZ_WRITER_PAPER: { need: async () => {} },
    GZ_UI: { load: () => new Promise((resolve, reject) => pending.push({ resolve, reject })), paint: (s, o) => { painted.push([s, o]); root.style.colorScheme = s.scheme; attrs.set('data-gz-bg', s.bg.kind); } },
    chrome: { storage: { onChanged: { addListener: (fn) => { events.storage = fn; } } } } });
  const loading = vm.runInContext(`${body}\ntheme()`, ctx);
  await new Promise(setImmediate);
  return { loading, pending, events, errors, root, painted, posted, frames, listeners, ctx };
};
const look = (over = {}) => ({ scheme: 'dark', enabled: true, motion: { level: 'subtle', followSystem: true }, bg: { kind: 'solid' }, parts: null, ...over });

test('an older theme read never repaints over a newer settings change', async () => {
  const r = await theme();
  const changed = r.events.storage({}, 'sync');
  r.pending[1].resolve(look({ scheme: 'dark' })); await changed; await new Promise(setImmediate);
  r.pending[0].resolve(look({ scheme: 'light' })); await r.loading;
  assert.equal(r.root.style.colorScheme, 'dark');
});

test('live theme storage failures are handled by the listener', async () => {
  const r = await theme(); r.pending[0].resolve(look({ scheme: 'light' })); await r.loading;
  const changed = r.events.scheme(); r.pending[1].reject(Error('storage refused'));
  await assert.doesNotReject(Promise.resolve(changed));
  assert.equal(r.errors.length, 1);
  assert.equal(r.root.style.colorScheme, 'light');
});

test('the editor wears the palette only; the home the whole Look', async () => {
  const editor = await theme(); editor.pending[0].resolve(look({ bg: { kind: 'scene' } })); await editor.loading;
  assert.deepEqual(JSON.parse(JSON.stringify(editor.painted[0][1])), { page: false });
  assert.equal(editor.frames.length, 0, 'no background frame for the editor');
  const home = await theme({ whole: true }); home.pending[0].resolve(look({ bg: { kind: 'scene' } })); await home.loading;
  assert.deepEqual(JSON.parse(JSON.stringify(home.painted[0][1])), { page: true });
  assert.equal(home.frames.length, 1, 'the home draws the background');
});

test('the motion level follows the system\'s reduced motion only while the Look follows it', async () => {
  for (const [reduced, followSystem, want] of [[true, true, 'off'], [true, false, 'expressive'], [false, true, 'expressive']]) {
    const r = await theme({ reduced }); r.pending[0].resolve(look({ motion: { level: 'expressive', followSystem } })); await r.loading;
    assert.equal(r.root.dataset.motion, want, `reduced ${reduced}, follows ${followSystem}`);
  }
});

test('the backdrop is fed the Look and its parts once ready, and goes with a solid Look or with Glaze off', async () => {
  const r = await theme({ whole: true });
  const s = look({ bg: { kind: 'image', image: 'https://photos.test/a.png' }, parts: { x: { bg: { shader: { src: 'x' } } } } });
  r.pending[0].resolve(s); await r.loading;
  const [frame] = r.frames;
  assert.equal(r.posted.length, 0, 'nothing is posted before the frame says it is ready');
  for (const fn of r.listeners) fn({ origin: 'https://evil.test', source: frame.contentWindow, data: { gzPreviewReady: true } });
  for (const fn of r.listeners) fn({ origin: 'chrome-extension://glaze', source: {}, data: { gzPreviewReady: true } });
  assert.equal(r.posted.length, 0, 'only the frame itself, from this origin');
  for (const fn of r.listeners) fn({ origin: 'chrome-extension://glaze', source: frame.contentWindow, data: { gzPreviewReady: true } });
  assert.equal(r.posted.length, 1);
  assert.equal(r.posted[0][0].gzPreview, s);
  assert.equal(r.posted[0][0].gzPreviewParts, s.parts);
  assert.equal(r.posted[0][1], 'chrome-extension://glaze');
  const settle = () => new Promise(setImmediate);
  r.events.storage({}, 'sync'); r.pending[1].resolve(look({ enabled: false, bg: { kind: 'scene' } })); await settle();
  assert.ok(frame.removed, 'Glaze off: no background');
  assert.equal(r.painted.at(-1)[0].bg.kind, 'solid', 'Glaze off: the surfaces are opaque, as on a solid ground');
  r.events.storage({}, 'sync'); r.pending[2].resolve(look({ bg: { kind: 'scene' } })); await settle();
  assert.equal(r.frames.length, 2);
  r.events.storage({}, 'sync'); r.pending[3].resolve(look()); await settle();
  assert.ok(r.frames[1].removed, 'a solid Look has no background frame');
  r.events.storage({ lookX: {} }, 'local'); r.events.storage({ writerPapers: [] }, 'local');
  assert.equal(r.pending.length, 5, 'the Look\'s parts kept on this device repaint; other local writes don\'t');
  r.pending[4].resolve(look()); await settle();
});
