// Look parts on the page: content.js asks for features/lookparts.js only when a Look has parts, and that module keeps them
// for GZ_CTX.parts() and fires `glaze:parts` when they change. Real scripts in a VM with stand-in storage and document;
// the browser side is scripts/lookparts-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const tick = (n = 6) => new Promise((r) => { let i = 0; const go = () => (++i >= n ? r() : setImmediate(go)); go(); });
const X = require('../lib/lookparts.js');

// ---- content.js: when the module is asked for ------------------------------------------------------------------------
const content = read('content.js');
const gate = content.slice(content.indexOf('  const partsIn = (m) => {'), content.indexOf('  // Mods start'));

const gated = ({ stored, solo = true, isPreview = false, loaded = false, lastError, getCalls = [] } = {}) => {
  const asked = [], reads = [];
  const context = vm.createContext({
    solo, isPreview, lookX: lastError ? undefined : stored, ready: Promise.resolve(),
    chrome: { runtime: { lastError }, storage: { sync: { get: (key, cb) => { getCalls.push(key); assert.equal(key, 'lookX'); cb(stored === undefined ? {} : { lookX: stored }); } } } },
    need: (file, isThere) => { asked.push(file); context.GZ_XPARTS_PAGE ||= { read: () => reads.push('read') }; assert.ok(isThere()); return Promise.resolve(); },
  });
  context.globalThis = context;
  if (loaded) context.GZ_XPARTS_PAGE = { read: () => reads.push('read') };
  vm.runInContext(`${gate}\npartsIn();`, context);
  return tick().then(() => ({ asked, reads }));
};

test('nothing is loaded for a Look without parts, and the module is asked for once a Look has some', async () => {
  assert.deepEqual(await gated(), { asked: [], reads: [] });
  assert.deepEqual(await gated({ stored: '' }), { asked: [], reads: [] }, 'cleared parts are none');
  assert.deepEqual(await gated({ stored: 'x1:AAAA' }), { asked: ['features/lookparts.js'], reads: ['read'] });
  assert.deepEqual(await gated({ stored: { h: 'abc' } }), { asked: ['features/lookparts.js'], reads: ['read'] }, 'parts kept on this computer');
});

test('a module already loaded reads again when the parts go, so the page lets go of them', async () => {
  assert.deepEqual(await gated({ stored: '', loaded: true }), { asked: ['features/lookparts.js'], reads: ['read'] }, 'need() answers at once when the module is there');
});

test('only the top frame and live tab frames read parts, never the editor\'s preview, and a failed read does nothing', async () => {
  assert.deepEqual(await gated({ stored: 'x1:AAAA', solo: false }), { asked: [], reads: [] });
  assert.deepEqual(await gated({ stored: 'x1:AAAA', isPreview: true }), { asked: [], reads: [] });
  assert.deepEqual(await gated({ stored: 'x1:AAAA', lastError: { message: 'gone' } }), { asked: [], reads: [] });
});

test('content.js hands parts to the pages through GZ_CTX.parts(), asks only when storage changes lookX, and feeds the preview', () => {
  // Running code mods lay their parts over the Look's (features/mods.js parts), under the same gate.
  // Course Looks suppress global parts; their pointer is resolved separately.
  assert.match(content, /const partsOn = \(\) => on\(settings\) && \(!isPreview \|\| html\.dataset\.previewPage !== 'quiz'\);/);
  assert.match(content, /partsOn, courseLook: lookHere,\n    parts: \(\) => \(partsOn\(\) && \(globalThis\.GZ_MODS \? GZ_MODS\.parts\(globalThis\.GZ_XPARTS_PAGE\?\.now\(\) \|\| null\) : globalThis\.GZ_XPARTS_PAGE\?\.now\(\)\)\) \|\| null,/);
  assert.match(content, /if \(changes\.lookX && area === 'sync'\) lookX = changes\.lookX\.newValue;/);
  assert.match(content, /globalThis\.GZ_XPARTS_PAGE\?\.preview\(e\.data\.gzPreviewParts\);/);
  // The first-paint path is untouched: parts are asked for after `ready`, which is the settings read.
  assert.ok(content.indexOf('  ready.then(() => modsIn(true));') > content.indexOf('const ready = load().then('));
  assert.match(content.slice(content.indexOf('const load = () =>'), content.indexOf('// The previous palette covers')), /Object.keys\(GZ_DEFAULTS\), 'lookX'/);
  // The worker allows the two files and brings the files they stand on.
  const worker = read('lib/background.js');
  assert.match(worker, /'lib\/lookparts\.js', 'features\/lookparts\.js'/);
  assert.match(worker, /files\.includes\('features\/lookparts\.js'\) \? \['lib\/lookx\.js', 'lib\/lookparts\.js'\]/);
  assert.match(worker, /files\.includes\('lib\/navlayout\.js'\) \? \['lib\/nav\.js', 'lib\/nav-items\.js'\]/);
});

// ---- the module -------------------------------------------------------------------------------------------------------
const page = ({ sync = {}, local = {}, path: pathname = '/ultra/courses/_1_1/outline', files = [] } = {}) => {
  const events = [], needed = [], listeners = {};
  const area = (data, delay = () => 0) => ({
    get: (key, cb) => setTimeout(() => cb(Object.fromEntries([].concat(key).filter((k) => k in data).map((k) => [k, structuredClone(data[k])]))), delay(key)),
  });
  const context = vm.createContext({
    console, URL, TextEncoder, TextDecoder, Blob, CompressionStream, DecompressionStream, btoa, atob, setTimeout, structuredClone,
    location: { pathname }, document: { dispatchEvent: (e) => events.push(e), getElementById: () => null },
    addEventListener: (t, f) => { listeners[t] = f; }, navigation: { addEventListener: (t, f) => { listeners[t] = f; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    chrome: { runtime: {}, storage: { sync: area(sync), local: area(local) } },
  });
  context.globalThis = context;
  context.GZ_CTX = { need: async (file, isThere) => { needed.push(file); for (const f of ({ 'lib/navlayout.js': ['lib/nav.js', 'lib/nav-items.js', 'lib/navlayout.js'] })[file] || [file]) vm.runInContext(read(f), context); assert.ok(isThere()); } };
  for (const f of ['lib/color.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js', 'lib/lookx.js', 'lib/lookparts.js', ...files, 'features/lookparts.js']) vm.runInContext(read(f), context, { filename: f });
  return { context, events, needed, listeners, data: { sync, local }, now: () => vm.runInContext('GZ_XPARTS_PAGE.now()', context), run: (code) => vm.runInContext(code, context) };
};
const GLOW = { x: { cursor: { kind: 'glow', size: 14 } } };

test('course parts discard delayed replies, restore the theme, and stay independent in two tabs', async () => {
  const a = page({ sync: { lookX: await X.pack(GLOW) } }), b = page();
  const pending = new Map();
  let course = 'Graveyard';
  a.context.GZ_CTX.courseLook = () => course;
  a.context.chrome.runtime.sendMessage = ({ id }) => new Promise((resolve) => pending.set(id, resolve));
  b.context.GZ_CTX.courseLook = () => 'Terminal';
  b.context.chrome.runtime.sendMessage = async () => ({ ok: true, parts: { x: { pointer: 'terminal' } } });
  const first = a.run('GZ_XPARTS_PAGE.read()');
  course = 'Frostdev';
  const second = a.run('GZ_XPARTS_PAGE.read()');
  pending.get('Frostdev')({ ok: true, parts: { x: { pointer: 'lava' } } });
  await second;
  assert.equal(a.now().pointer, 'lava');
  pending.get('Graveyard')({ ok: true, parts: { x: { pointer: 'ghost' } } });
  await first;
  assert.equal(a.now().pointer, 'lava', 'late course reply cannot replace the current parts');
  await b.run('GZ_XPARTS_PAGE.read()');
  assert.equal(b.now().pointer, 'terminal');
  course = null;
  assert.equal(a.now(), null, 'old course parts are unavailable immediately');
  await a.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(JSON.parse(JSON.stringify(a.now())), GLOW.x);
  assert.equal(b.now().pointer, 'terminal', 'another tab keeps its own course');
  assert.deepEqual(a.listeners, {}, 'course reads add no listeners or polling');
});

test('the page module reads the parts, fires glaze:parts when they change and not otherwise, and keeps them frozen', async () => {
  const p = page({ sync: { lookX: await X.pack(GLOW) } });
  assert.equal(p.now(), null, 'nothing before it has read');
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(JSON.parse(JSON.stringify(p.now())), GLOW.x);
  assert.deepEqual(p.events.map((e) => [e.type, e.detail]), [['glaze:parts', undefined]], 'no detail: pages that fake the event learn and set nothing');
  assert.ok(Object.isFrozen(p.now()) && Object.isFrozen(p.now().cursor));
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.equal(p.events.length, 1, 'the same parts again is no change');
  p.data.sync.lookX = await X.pack({ x: { cursor: { kind: 'trail' } } });
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.equal(p.events.length, 2);
  p.data.sync.lookX = '';
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.equal(p.now(), null);
  assert.equal(p.events.length, 3, 'clearing them is a change');
});

test('parts kept on this computer are read from local storage when sync names them, and not otherwise', async () => {
  const big = await X.pack(GLOW);
  const p = page({ sync: { lookX: { h: X.hash(big) } }, local: { lookX: big } });
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(JSON.parse(JSON.stringify(p.now())), GLOW.x);
  const other = page({ sync: { lookX: { h: X.hash(big) } }, local: {} });
  await other.run('GZ_XPARTS_PAGE.read()');
  assert.equal(other.now(), null, 'saved on another computer');
  const stale = page({ sync: { lookX: { h: 'not-these' } }, local: { lookX: big } });
  await stale.run('GZ_XPARTS_PAGE.read()');
  assert.equal(stale.now(), null);
  // Garbage in storage is no parts, not an error.
  for (const bad of ['x1:!!!', 'hello', 42, { h: 5 }, ['x'], 'x1:AAAA']) {
    const g = page({ sync: { lookX: bad } });
    await g.run('GZ_XPARTS_PAGE.read()');
    assert.equal(g.now(), null, JSON.stringify(bad));
  }
});

test('parts are cleaned again on the way in, and parts with a nav ask for the nav cleaner first', async () => {
  const nav = { place: 'top', hidden: ['grades'] };
  const p = page({ sync: { lookX: await X.pack({ x: { nav, cursor: { kind: 'glow' } } }) } });
  assert.ok(!p.run('typeof GZ_NAV_LAYOUT !== "undefined"'), 'not there until a nav asks for it');
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(p.needed, ['lib/navlayout.js', 'lib/motionx.js'], 'a nav and a cursor each ask for what cleans them');
  assert.deepEqual(JSON.parse(JSON.stringify(p.now().nav)), nav);
  // Each is asked for only by the parts that stand on it.
  const q = page({ sync: { lookX: await X.pack(GLOW) } });
  await q.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(q.needed, ['lib/motionx.js']);
  const shader = page({ sync: { lookX: await X.pack({ x: { bg: { shader: { src: 'vec4 scene(vec2 uv) { return vec4(uC1, 1.0); }' } } } }) } });
  await shader.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(shader.needed, [], 'a shader needs neither');
  const layers = page({ sync: { lookX: await X.pack({ x: { bg: { layers: [{ k: 'particles', shape: 'star' }] } } }) } });
  await layers.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(layers.needed, ['lib/motionx.js'], 'particle shapes are motionx.js\'s');
  // Stored by a program that cleans differently: what doesn't clean is no parts.
  const forged = 'x1:' + X.b64(await X.deflate(new TextEncoder().encode(JSON.stringify({ x: { cursor: { kind: 'laser' } } }))));
  const f = page({ sync: { lookX: forged } });
  await f.run('GZ_XPARTS_PAGE.read()');
  assert.equal(f.now(), null);
  // A nav cleaner that can't be loaded leaves no parts rather than uncleaned ones.
  const n = page({ sync: { lookX: await X.pack({ x: { nav, cursor: { kind: 'glow' } } }) } });
  n.context.GZ_CTX = { need: async () => { throw new Error('not loadable'); } };
  await n.run('GZ_XPARTS_PAGE.read()');
  assert.equal(n.now(), null);
});

test('a quiz or tool page never gets parts, and the answer follows the page as it changes', async () => {
  const p = page({ sync: { lookX: await X.pack(GLOW) } });
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.ok(p.now());
  for (const where of ['/ultra/courses/_1_1/assessment/_5_1', '/courses/4/quizzes/9/take', '/courses/4/external_tools/3', '/mod/quiz/attempt.php']) {
    p.context.location.pathname = where;
    assert.equal(p.now(), null, where);
  }
  p.context.location.pathname = '/ultra/courses/_1_1/outline';
  assert.ok(p.now());
});

test('the latest read wins however the reads finish, and the preview sets and clears parts without storage', async () => {
  const slow = page({ sync: { lookX: await X.pack(GLOW) } });
  slow.run(`chrome.storage.sync.get = ((get) => (k, cb) => get(k, (r) => setTimeout(() => cb(r), globalThis.late.shift())))(chrome.storage.sync.get)`);
  slow.context.late = [30, 0];
  const first = slow.run('GZ_XPARTS_PAGE.read()');
  slow.data.sync.lookX = '';
  const second = slow.run('GZ_XPARTS_PAGE.read()');
  await Promise.all([first, second]);
  assert.equal(slow.now(), null, 'the older read, finishing last, does not bring the parts back');
  const p = page({ files: ['lib/motionx.js'] }); // the preview's page has it in a script tag
  p.run(`GZ_XPARTS_PAGE.preview(${JSON.stringify(GLOW)})`);
  assert.deepEqual(JSON.parse(JSON.stringify(p.now())), GLOW.x);
  assert.equal(p.events.length, 1);
  p.run('GZ_XPARTS_PAGE.preview({ x: { cursor: { kind: "laser" } } })');
  assert.equal(p.now(), null, 'a preview that does not clean is none');
  assert.equal(p.events.length, 2);
  p.run('GZ_XPARTS_PAGE.preview(null)');
  assert.equal(p.events.length, 2, 'none again is no change');
  p.run('GZ_XPARTS_PAGE.preview(undefined)');
  assert.equal(p.now(), null);
});

test('loading the module twice keeps the first', () => {
  const p = page();
  const first = p.run('GZ_XPARTS_PAGE');
  vm.runInContext(read('features/lookparts.js'), p.context);
  assert.equal(p.run('GZ_XPARTS_PAGE'), first);
  const lib = p.run('GZ_XPARTS');
  vm.runInContext(read('lib/lookparts.js'), p.context);
  assert.equal(p.run('GZ_XPARTS'), lib);
});


test('the page loads the registry before accepting rules and refuses unknown part names', async () => {
  const p = page({ sync: { lookX: await X.pack({ x: { rules: [{ p: 'ultra.no-such-part', do: 'hide' }] } }) } });
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.equal(p.now(), null);
  assert.ok(p.needed.includes('lib/parts.js'));
});


test('parts gating reuses the settings read, with no extra storage read for a plain Look', async () => {
  const getCalls = [];
  await gated({ getCalls });
  assert.deepEqual(getCalls, []);
});


test('Canvas and Moodle preview getters suppress parts while disabled or previewing a quiz', () => {
  const source = read('lib/editor-preview.js');
  const getter = source.match(/globalThis\.GZ_CTX \|\|= Object\.freeze\(\{[\s\S]*?\}\);/)[0];
  const context = vm.createContext({ site: 'canvas', settings: { enabled: false }, context: { page: 'courses' }, GZ_XPARTS_PAGE: { now: () => ({ cursor: { kind: 'glow' } }) } });
  vm.runInContext(getter, context);
  assert.equal(context.GZ_CTX.on(), false);
  assert.equal(context.GZ_CTX.parts(), null);
  context.settings.enabled = true;
  assert.equal(context.GZ_CTX.on(), true);
  assert.ok(context.GZ_CTX.parts());
  context.context.page = 'quiz';
  assert.equal(context.GZ_CTX.parts(), null);
  assert.equal(context.GZ_CTX.partsOn(), false, 'the chosen pointer follows the parts');
  context.context.page = 'courses';
  assert.equal(context.GZ_CTX.partsOn(), true);
  context.settings.enabled = false;
  assert.equal(context.GZ_CTX.partsOn(), false);
});

test('the Ultra preview suppresses parts on its mock quiz and restores them on return', () => {
  const lines = content.split('\n'), getter = lines.find((line) => line.trim().startsWith('parts: () =>')), gate = lines.find((line) => line.trim().startsWith('const partsOn = '));
  const context = vm.createContext({ settings: { enabled: true }, on: (s) => s.enabled, lookHere: () => null,
    isPreview: true, html: { dataset: { previewPage: 'courses' } }, GZ_XPARTS_PAGE: { now: () => ({ cursor: { kind: 'glow' } }) } });
  vm.runInContext(`${gate}\nglobalThis.ctx = { partsOn, ${getter} };`, context);
  assert.ok(context.ctx.parts());
  context.html.dataset.previewPage = 'quiz';
  assert.equal(context.ctx.parts(), null);
  context.html.dataset.previewPage = 'courses';
  assert.ok(context.ctx.parts());
  context.html.dataset.previewPage = 'quiz';
  assert.equal(context.ctx.partsOn(), false, 'nor the pointer the student chose');
  context.isPreview = false;
  assert.ok(context.ctx.parts(), 'a live page cannot suppress parts with a preview attribute');
  assert.equal(context.ctx.partsOn(), true);
  // A course Look's parts are features/lookparts.js's to give (its now() is that Look's on that course): no gate here.
  context.lookHere = () => 'Clear';
  assert.equal(context.ctx.partsOn(), true, 'a course Look wears its own parts');
  assert.ok(context.ctx.parts());
});

test('changing the mock page announces parts so rules, scenes and nav follow the preview context', () => {
  const source = read('lib/editor-preview.js');
  const apply = source.slice(source.indexOf('  const applyContext ='), source.indexOf("  addEventListener('message'"));
  const events = [], html = { dataset: {} };
  const ctx = vm.createContext({ html, site: 'ultra', context: { page: 'quiz', viewport: 'desktop' },
    document: { querySelectorAll: () => [], querySelector: () => null, dispatchEvent: (e) => events.push([e.type, html.dataset.previewPage]) },
    CustomEvent: class { constructor(type) { this.type = type; } } });
  vm.runInContext(`${apply}\napplyContext();`, ctx);
  assert.deepEqual(events, [['glaze:parts', 'quiz']]);
});


test('a course Look preview receives its own pointer without the global Look parts', () => {
  const G = require('../defaults.js');
  const base = { ...G.GZ_SANITIZE({ courses: { looks: { _1_1: 'Terminal' } } }), parts: GLOW };
  const settings = G.GZ_COURSE_LOOK(base, '_1_1'), sent = [];
  assert.notEqual(settings, base);
  const lines = read('options.js').split('\n');
  const message = lines.find((line) => line.includes('frame.contentWindow?.postMessage({ gzPreview:') && line.includes('gzPreviewParts:'));
  const pointer = lines.find((line) => line.includes('const coursePointer =')) || '';
  vm.runInNewContext(`${pointer}\n${message}`, { GZ_LOOK_PARTS: require('../lib/lookset.js'), id: '_1_1', frame: { contentWindow: { postMessage: (m) => sent.push(m) } }, base, settings, shown: settings, nav: settings.nav, colors: null, location: { origin: 'chrome-extension://x' } });
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].gzPreviewParts)), { x: { pointer: 'terminal' } });
});


test('a plain palette code offer clears the previous Look parts', () => {
  const source = read('options.js');
  const code = source.slice(source.indexOf('    const paletteOnly ='), source.indexOf('    const palette = offer.preset'));
  const context = vm.createContext({ got: { look: {}, bg: {}, nav: {}, cards: [], parts: null }, offer: {}, s: { parts: GLOW } });
  vm.runInContext(code, context);
  assert.equal(context.offer.parts, null);
});


// ---- installed mods' parts ----------------------------------------------------------------------------------------------
const RULE = (n) => ({ p: 'ultra.course-card.title', do: 'label', t: `r${n}` });
const loaders = async ({ lookX, mods = ['abcdefghijklmnop'], runtimes = false, enabled = true, top = true, isPreview = false } = {}) => {
  const reads = [], asked = [], messages = [];
  const ctx = vm.createContext({ lookX, solo: true, isPreview, settings: { enabled }, ready: Promise.resolve(), window: {},
    on: (s) => s.enabled, local: (f) => f({ get: (_, cb) => setImmediate(() => cb({ mods })) }),
    need: async (file) => { asked.push(file); ctx.GZ_XPARTS_PAGE ||= { read: () => reads.push('read') }; },
    chrome: { runtime: { sendMessage: async (m) => { messages.push(m); return {}; } }, storage: { onChanged: { addListener: (f) => { ctx.changed = f; } } } },
    GZ_SPEC: {}, links: [], load: async () => ctx.settings, enable() {}, disable() {}, applySettings() {}, no() {},
  });
  ctx.window.top = top ? ctx.window : {};
  if (runtimes) { ctx.GZ_MODS = {}; ctx.GZ_MODWIDGETS = {}; ctx.GZ_XPARTS_PAGE = { read: () => reads.push('read') }; }
  const start = content.slice(content.indexOf('  const partsIn ='), content.indexOf('  // The preview is fed'));
  const listener = content.slice(content.indexOf('  chrome.storage.onChanged.addListener((changes, area)'), content.indexOf('  // Moodle\'s course is on'));
  vm.runInContext(start + listener, ctx);
  await tick();
  return { ctx, reads, asked, messages, setMods: (v) => { mods = v; } };
};

test('parts load once at startup and once per mod change, including mixed storage notifications', async () => {
  const p = await loaders({ lookX: 'stored' });
  assert.equal(p.reads.length, 1, 'a Look and installed mods need one merged read');
  for (const k of ['mods', 'mod:abcdefghijklmnop', 'modDev', 'modOrder', 'modsBlocklist']) {
    p.reads.length = 0;
    p.ctx.changed({ [k]: { newValue: true } }, 'local');
    await tick();
    assert.equal(p.reads.length, 1, k);
  }
  p.reads.length = 0;
  p.ctx.changed({ lookX: { newValue: '' }, mods: { newValue: [] } }, 'local');
  await tick();
  assert.equal(p.reads.length, 1, 'one notification needs one read');
  p.reads.length = 0;
  p.ctx.changed({ lookX: { newValue: '' }, enabled: { newValue: true } }, 'sync');
  await tick();
  assert.equal(p.reads.length, 1, 'an enable and Look change share one read');
  p.setMods([]);
  p.reads.length = 0;
  p.ctx.changed({ mods: { newValue: [] } }, 'local');
  await tick();
  assert.equal(p.reads.length, 1, 'removing the last mod clears its parts');
});

test('parts discovery stays idle without mods and ignores unrelated settings and mod data', async () => {
  for (const opts of [{ mods: [] }, { enabled: false }, { isPreview: true }]) {
    const p = await loaders(opts);
    assert.deepEqual(p.asked, []);
    assert.deepEqual(p.messages, []);
  }
  const p = await loaders();
  p.reads.length = 0;
  for (const k of ['modData:x', 'modSettings:x', 'modStops', 'modsX', 'modOrders']) p.ctx.changed({ [k]: { newValue: {} } }, 'local');
  p.ctx.changed({ colors: { newValue: {} } }, 'sync');
  await tick();
  assert.deepEqual(p.reads, []);
});

test('enabling Glaze refreshes installed parts even when both mod runtimes are already loaded', async () => {
  const p = await loaders({ runtimes: true });
  p.reads.length = 0;
  p.ctx.settings.enabled = false;
  p.ctx.changed({ enabled: { newValue: false } }, 'sync');
  await tick();
  p.ctx.changed({ modOrder: { newValue: [] } }, 'local');
  await tick();
  p.ctx.settings.enabled = true;
  p.reads.length = 0;
  p.ctx.changed({ enabled: { newValue: true } }, 'sync');
  await tick();
  assert.equal(p.reads.length, 1, 'changes made while off are read on re-enable');
});

test('over: the Look is the base, the first mod in the order wins a key, rules add up to 64', () => {
  const look = { cursor: { kind: 'glow' }, fx: { complete: { kind: 'burst' } }, rules: [RULE(0)] };
  const a = { cursor: { kind: 'trail' }, rules: [RULE(1)] }, b = { cursor: { kind: 'ring' }, bg: { shader: { src: 's' } }, rules: [RULE(2)] };
  assert.deepEqual(X.over(look, [a, b]), { cursor: { kind: 'trail' }, fx: look.fx, bg: b.bg, rules: [RULE(0), RULE(1), RULE(2)] });
  assert.deepEqual(X.over(look, [b, a]).cursor, b.cursor, 'the order decides');
  assert.deepEqual(X.over(null, [a]), a);
  assert.deepEqual(X.over(look, []), look);
  assert.equal(X.over(null, []), null);
  const many = X.over({ rules: Array.from({ length: 40 }, (_, i) => RULE(i)) }, [{ rules: Array.from({ length: 40 }, (_, i) => RULE(100 + i)) }]);
  assert.equal(many.rules.length, 64);
  assert.equal(many.rules[39].t, 'r39', 'the Look\'s rules first');
  assert.equal(many.rules[63].t, 'r123');
});

test('a mod-only page loads the module even without a Look', async () => {
  const asked = [];
  const context = vm.createContext({ solo: true, isPreview: false, lookX: undefined, ready: Promise.resolve(),
    need: (file) => { asked.push(file); context.GZ_XPARTS_PAGE = { read: () => {} }; return Promise.resolve(); } });
  context.globalThis = context;
  vm.runInContext(`${gate}\npartsIn(1);`, context);
  await tick();
  assert.deepEqual(asked, ['features/lookparts.js']);
});

const modPage = async ({ look, mods, top = true, tabFrame = '', ids = ['abcdefghijklmnop'] }) => {
  const p = page({ sync: look ? { lookX: await X.pack(look) } : {}, local: { mods: ids } });
  const asks = [];
  p.context.chrome.runtime.sendMessage = async (m) => { asks.push(m); return { ok: true, parts: p.context.answer }; };
  p.context.answer = mods;
  if (!top) p.context.window = { top: {} }; else p.context.window = p.context;
  p.context.window.top = top ? p.context.window : {};
  p.context.GZ_CTX.solo = top || !!tabFrame;
  return { ...p, asks };
};
test('live course-tab frames read installed parts under the same solo rule as Look parts', async () => {
  const p = await modPage({ look: GLOW, mods: [{ cursor: { kind: 'trail' } }], top: false, tabFrame: '_1_1' });
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(JSON.parse(JSON.stringify(p.now())), { cursor: { kind: 'trail' } });
  assert.equal(p.asks.length, 1);
  const f = await loaders({ top: false });
  assert.equal(f.reads.length, 1, 'a frame without a Look still discovers installed parts');
  assert.deepEqual(f.messages, [], 'code and widgets stay top-frame only');
});
test('the page lays installed mods\' parts over the Look, cleans them again, and gives the Look back when they go', async () => {
  const shader = { bg: { shader: { src: 'vec4 scene(vec2 uv) { return vec4(uC1, 1.0); }' } } };
  const p = await modPage({ look: GLOW, mods: [{ ...shader, cursor: { kind: 'trail' } }, { cursor: { kind: 'laser' } }, { cursor: { kind: 'ring' } }] });
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(JSON.parse(JSON.stringify(p.asks)), [{ type: 'glaze:modpage', op: 'parts' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(p.now())), { cursor: { kind: 'trail' }, ...shader }, 'the first mod wins; one that doesn\'t clean is dropped');
  assert.equal(p.run('GZ_XPARTS_PAGE.bgKind(GZ_XPARTS_PAGE.now().bg)'), 'shader');
  assert.equal(p.events.length, 1);
  p.context.answer = [];
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(JSON.parse(JSON.stringify(p.now())), GLOW.x, 'turned off: the Look is back');
  assert.equal(p.run('GZ_XPARTS_PAGE.bgKind({ layers: [{ k: "noise" }] })'), null);
  assert.equal(p.events.length, 2);
  p.context.answer = 'garbage';
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.equal(p.events.length, 2, 'a bad answer is no mods');
  // On a quiz page nothing, mods' parts included.
  p.context.answer = [{ cursor: { kind: 'trail' } }];
  await p.run('GZ_XPARTS_PAGE.read()');
  p.context.location.pathname = '/courses/4/quizzes/9/take';
  assert.equal(p.now(), null);
});

test('a mod background becoming the Look background still announces the selected kind change', async () => {
  const shader = { bg: { shader: { src: 'vec4 scene(vec2 uv) { return vec4(uC1, 1.0); }' } } };
  const p = await modPage({ look: { x: shader }, mods: [shader] });
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.equal(p.events.length, 1);
  p.context.answer = [];
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(JSON.parse(JSON.stringify(p.now())), shader, 'the parts themselves have not changed');
  assert.equal(p.events.length, 2, 'the scene must return to the selected kind');
});

test('no mods installed or a framed page: no ask', async () => {
  const none = await modPage({ look: GLOW, mods: [{ cursor: { kind: 'trail' } }], ids: [] });
  await none.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(none.asks, []);
  assert.deepEqual(none.listeners, {}, 'no navigation work for a Look without installed mods');
  const framed = await modPage({ look: GLOW, mods: [{ cursor: { kind: 'trail' } }], top: false });
  await framed.run('GZ_XPARTS_PAGE.read()');
  assert.deepEqual(framed.asks, []);
  assert.deepEqual(JSON.parse(JSON.stringify(framed.now())), GLOW.x);
});

test('installed parts stay off whole quiz and tool routes after in-place navigation', async () => {
  const p = await modPage({ mods: [{ cursor: { kind: 'trail' } }] });
  await p.run('GZ_XPARTS_PAGE.read()');
  for (const path of ['/courses/4/quizzes/9', '/courses/4/quizzes', '/courses/4/external_tools', '/mod/quiz/view.php', '/mod/lti/index.php', '/ultra/courses/_1_1/assessment']) {
    p.context.location.pathname = path;
    assert.equal(p.now(), null, path);
  }
  p.context.location.pathname = '/ultra/courses/_1_1/outline';
  p.context.document.getElementById = () => ({});
  assert.equal(p.now(), null, 'a tool frame inserted without a route change');
});

test('installed parts recover when leaving a quiz without reloading the document', async () => {
  const p = await modPage({ mods: [] });
  p.context.location.pathname = '/ultra/courses/_1_1/assessment/_2_1';
  await p.run('GZ_XPARTS_PAGE.read()');
  assert.equal(p.now(), null, 'the worker gives no parts on a quiz');
  p.context.answer = [{ cursor: { kind: 'trail' } }];
  p.context.location.pathname = '/ultra/courses/_1_1/outline';
  p.listeners.popstate?.();
  p.listeners.navigatesuccess?.();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(JSON.parse(JSON.stringify(p.now())), { cursor: { kind: 'trail' } });
  assert.equal(p.asks.length, 2, 'the two navigation events share one refresh');
  p.context.location.pathname = '/ultra/courses/_1_1/assessment/_2_1';
  const before = p.events.length;
  p.listeners.popstate();
  assert.equal(p.events.length, before + 1, 'renderers are told immediately when parts become quiet');
  assert.equal(p.now(), null);
});

test('a tool inserted without navigation tells installed parts renderers to stop on the page sweep', async () => {
  const p = await modPage({ mods: [{ bg: { layers: [{ k: 'noise' }] } }] });
  await p.run('GZ_XPARTS_PAGE.read()');
  const before = p.events.length;
  p.context.document.getElementById = () => ({});
  p.run('GZ_XPARTS_PAGE.pass()');
  assert.equal(p.events.length, before + 1, 'the scene and other renderers hear that their parts are gated');
  assert.equal(p.now(), null);
  p.run('GZ_XPARTS_PAGE.pass()');
  assert.equal(p.events.length, before + 1, 'no repeat work while still quiet');
  assert.match(content.slice(content.indexOf('  const flush ='), content.indexOf('  // ---- the sweep')), /globalThis\.GZ_XPARTS_PAGE\?\.pass\(\)/);
});

test('a mod\'s background picks the scene\'s kind, but only while parts apply here', () => {
  const line = content.split('\n').find((l) => l.startsWith('  const bgKind = '));
  const ctx = vm.createContext({ worn: { bg: { kind: 'gradient' } }, parts: { bg: { shader: { src: 's' } } } });
  ctx.globalThis = ctx;
  vm.runInContext(`const modBg = true; (() => { ${read('features/lookparts.js').split('\n').find((l) => l.startsWith('  const bgKind ='))}\nglobalThis.GZ_XPARTS_PAGE = { bgKind }; })();`, ctx);
  vm.runInContext(`${line}\nconst partsOf = () => parts; globalThis.k = bgKind;`, ctx);
  assert.equal(ctx.k(), 'shader');
  ctx.parts = { bg: { media: { type: 'video', src: 'https://example.com/a.webm' } } };
  assert.equal(ctx.k(), 'media'); // drawn by lib/scene-media.js
  ctx.parts = null; // a course with its own Look, a quiz, Glaze off
  assert.equal(ctx.k(), 'gradient');
});

test('a mod background repaints the CSS kind, dim and blur when its parts arrive or go away', () => {
  const attrs = {}, vars = {}, listeners = {};
  let kind = null, paints = 0, scenes = 0;
  const s = { bg: { kind: 'image', image: 'https://example.com/a.webp', dim: 80, blur: 12, intensity: 25, colors: [] } };
  const paint = content.slice(content.indexOf('    const kind =', content.indexOf('  const applySettings =')), content.indexOf('    GZ_BG_COLORS', content.indexOf('  const applySettings =')));
  const ctx = vm.createContext({ s, bgKind: () => kind || s.bg.kind, setAttr: (k, v) => { attrs[k] = v; }, setVar: (k, v) => { vars[k] = v; },
    GZ_SCENE_LOOK: () => ({ dim: 0.2 }), settings: { enabled: true }, links: [{}],
    document: { addEventListener: (name, f) => { listeners[name] = f; } },
    syncScene: () => { scenes++; }, applySettings: () => { paints++; vm.runInContext(`{ ${paint} }`, ctx); } });
  vm.runInContext(content.split('\n').find((l) => l.includes("document.addEventListener('glaze:parts',") && l.includes('syncScene')), ctx);
  for (const next of ['shader', 'layers', 'media', null]) {
    kind = next;
    listeners['glaze:parts']();
    assert.equal(attrs['data-gz-bg'], next || 'image');
    assert.equal(vars['--gz-bg-blur'], next ? '0px' : '12px');
    assert.equal(vars['--gz-bg-dim'], next ? '20%' : '80%');
  }
  assert.equal(paints, 4);
  ctx.settings.enabled = false;
  listeners['glaze:parts']();
  assert.equal(paints, 4, 'no theme paint while Glaze is off');
  assert.equal(scenes, 1, 'the existing scene still stops');
});
