const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const defaults = require('../../extension/content/defaults.js');
const read = f => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const tick = () => new Promise(setImmediate);
const L = require('../../extension/pearson/embed.js');
const openerDoc = '44444444-4444-4444-8444-444444444444';

test('an already themed homework document restores its native appearance after revocation and after all switches go off', async () => {
  const attrs = new Map(), styles = new Map(), listeners = [], math = [];
  let pearsonAccess = true, enhance = { pearsonViewer: true };
  const html = {
    style: { getPropertyValue: k => styles.get(k) || '', getPropertyPriority: () => '', setProperty: (k,v) => styles.set(k,v), removeProperty: k => styles.delete(k) },
    getAttribute: k => attrs.get(k) ?? null, setAttribute: (k,v) => attrs.set(k,v), removeAttribute: k => attrs.delete(k),
  };
  const local = { get: async () => ({ pearsonAccess }) };
  const c = vm.createContext({ URL, console, setTimeout, clearTimeout, location: new URL('https://mylab.pearson.com/Student/PlayerHomework.aspx?homeworkId=1'),
    document: { contentType: 'text/html', documentElement: html, body: null, querySelectorAll: () => [] },
    chrome: { runtime: { id: 'own' }, storage: { sync: { get: (keys, callback) => callback({ enabled: true, enhance }) }, onChanged: { addListener: f => listeners.push(f) } } },
    ...defaults, GZ_I18N: { ui: () => 'en', file: () => null }, GZ_XPARTS: { areas: () => ({ local }), stored: async () => null, parse: async () => null },
    GZ_MX: { compile: () => '' }, GZ_FONTS: { stack: () => 'system-ui', load() {} }, GZ_UI: { readable: () => 100 },
    GZ_SURFACE_VARS: () => ({}), GZ_COLOR: { parse: () => [1,1,1], brightness: () => 1 }, GZ_LX: { pointerOf: () => 'system', CURSORS: {} },
    GZ_PEARSON_MATH: { update: on => math.push(on) }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    MutationObserver: class { observe() {} disconnect() {} }, addEventListener() {},
  });
  c.window = c; c.top = c;
  vm.runInContext(read('content/pearson.js'), c); await tick();
  assert.equal(attrs.get('data-gz-pearson'), 'shell');
  pearsonAccess = false;
  for (const f of listeners) f({ pearsonAccess: { newValue: false } }, 'local');
  await tick();
  assert.equal(attrs.has('data-gz-pearson'), false, 'unregistering alone cannot undo an injected script');
  assert.equal(styles.size, 0, 'appearance overrides are restored');
  assert.equal(math.at(-1), false);
  pearsonAccess = true;
  for (const f of listeners) f({ pearsonAccess: { newValue: true } }, 'local');
  await tick(); assert.equal(attrs.get('data-gz-pearson'), 'shell');
  enhance = {};
  for (const f of listeners) f({ enhance: { newValue: {} } }, 'sync');
  await tick(); assert.equal(attrs.has('data-gz-pearson'), false, 'the last switch off also restores native appearance');
});

test('the host keeps native launch controls without access and restores them when a grant is revoked', async () => {
  const events = new Map(), changes = [], messages = [];
  const listen = (k,f) => events.set(k, [...events.get(k) || [], f]);
  const fire = (k,e) => { for (const f of events.get(k) || []) f(e); };
  const node = () => {
    const attrs = new Map(), styles = new Map();
    return { attrs, children: [], isConnected: true,
      style: { getPropertyValue: k => styles.get(k) || '', getPropertyPriority: () => '', setProperty: (k,v) => styles.set(k,v), removeProperty: k => styles.delete(k) },
      setAttribute: (k,v) => attrs.set(k,v), removeAttribute: k => attrs.delete(k), getAttribute: k => attrs.get(k) ?? null,
      addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ top: 0, bottom: 20 }),
      append(...nodes) { this.children.push(...nodes); for (const n of nodes) n.parentElement = this; },
      remove() { this.isConnected = false; },
      get firstElementChild() { return this.children[0]; }, get lastElementChild() { return this.children.at(-1); },
    };
  };
  let pearsonAccess = false;
  const slot = node(), header = node(), exit = node(), frame = node(), controls = node();
  controls.append(exit); header.querySelector = () => exit;
  frame.src = 'https://school.blackboard.com/webapps/blackboard/execute/ultraFramePassThrough?redirectTo=' + encodeURIComponent('https://school.blackboard.com/webapps/blackboard/execute/blti/launchLink?course_id=_1_1&content_id=_2_1&from_ultra=true');
  frame.parentElement = slot; frame.closest = () => ({ querySelector: () => header });
  frame.contentWindow = { postMessage: m => messages.push(m) };
  let serial = 0;
  const c = vm.createContext({ URL, crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}` },
    GZ_PEARSON_EMBED_LIB: L, GZ_CTX: { site: 'ultra', on: () => true, settings: () => ({ enabled: true, enhance: { pearsonEmbed: true } }), darkTheme: () => false, t: x => x },
    location: new URL('https://school.blackboard.com/ultra/courses/_1_1/lti/launchFrame'),
    document: { getElementById: () => frame, querySelector: () => header, createElement: node, documentElement: node(), head: node() },
    chrome: { runtime: { getURL: x => x }, storage: { local: { get: async () => ({ pearsonAccess }) }, onChanged: { addListener: f => changes.push(f) } } },
    MutationObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), visualViewport: { height: 800, addEventListener() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener: listen,
  });
  vm.runInContext(read('courses/page/pearson-embed.js'), c);
  const active = () => fire('message', { source: frame.contentWindow, origin: L.socket, data: { gzPearsonEmbed: 'active', channel: messages.at(-1)?.channel } });
  const hello = () => fire('message', { source: frame.contentWindow, origin: L.socket, data: { gzPearsonEmbed: 'hello', id: openerDoc } });
  c.GZ_PEARSON_EMBED.sync(); await tick(); hello(); active();
  assert.equal(slot.attrs.has('data-gz-pearson-slot'), false, 'a synced preference cannot act without access on this device');
  assert.ok(messages.every(m => m.enabled !== true), 'no enabled context reaches a launcher that cannot run');
  pearsonAccess = true;
  for (const f of changes) f({ pearsonAccess: { newValue: true } }, 'local');
  await tick(); c.GZ_PEARSON_EMBED.sync(); hello(); active();
  assert.equal(slot.attrs.has('data-gz-pearson-slot'), true);
  const channel = messages.at(-1).channel;
  pearsonAccess = false;
  for (const f of changes) f({ pearsonAccess: { newValue: false } }, 'local');
  await tick(); active();
  assert.equal(slot.attrs.has('data-gz-pearson-slot'), false);
  assert.equal(exit.attrs.has('data-gz-pearson-native-exit'), false, 'native Exit returns');
  assert.equal(messages.at(-1).enabled, false, 'prepared launches lose parent consent before cleanup');
  pearsonAccess = true;
  for (const f of changes) f({ pearsonAccess: { newValue: true } }, 'local');
  await tick();
  assert.equal(messages.at(-1).channel, channel, 'the live opener accepts only its established channel');
  active(); assert.equal(slot.attrs.has('data-gz-pearson-slot'), true);
});

test('turning Pearson inside Blackboard off keeps a live session in step with the Look; only later launches go native', async () => {
  const events = new Map(), messages = [], watches = [];
  const listen = (k,f) => events.set(k, [...events.get(k) || [], f]);
  const fire = (k,e) => { for (const f of events.get(k) || []) f(e); };
  const node = () => {
    const attrs = new Map(), styles = new Map();
    return { attrs, children: [], isConnected: true,
      style: { getPropertyValue: k => styles.get(k) || '', getPropertyPriority: () => '', setProperty: (k,v) => styles.set(k,v), removeProperty: k => styles.delete(k) },
      setAttribute: (k,v) => attrs.set(k,v), removeAttribute: k => attrs.delete(k), getAttribute: k => attrs.get(k) ?? null,
      addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ top: 0, bottom: 20 }),
      append(...nodes) { this.children.push(...nodes); for (const n of nodes) n.parentElement = this; },
      remove() { this.isConnected = false; },
      get firstElementChild() { return this.children[0]; }, get lastElementChild() { return this.children.at(-1); },
    };
  };
  const settings = { enabled: true, enhance: { pearsonEmbed: true, pearsonViewer: true } };
  const slot = node(), header = node(), exit = node(), frame = node(), controls = node();
  controls.append(exit); header.querySelector = () => exit;
  frame.src = 'https://school.blackboard.com/webapps/blackboard/execute/ultraFramePassThrough?redirectTo=' + encodeURIComponent('https://school.blackboard.com/webapps/blackboard/execute/blti/launchLink?course_id=_1_1&content_id=_2_1&from_ultra=true');
  frame.parentElement = slot; frame.closest = () => ({ querySelector: () => header });
  frame.contentWindow = { postMessage: m => messages.push(m) };
  const c = vm.createContext({ URL, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    GZ_PEARSON_EMBED_LIB: L, GZ_CTX: { site: 'ultra', on: () => true, settings: () => settings, darkTheme: () => false, t: x => x },
    location: new URL('https://school.blackboard.com/ultra/courses/_1_1/lti/launchFrame'),
    document: { getElementById: () => frame, querySelector: () => header, createElement: node, documentElement: node(), head: node() },
    chrome: { runtime: { getURL: x => x }, storage: { local: { get: async () => ({ pearsonAccess: true }) }, onChanged: { addListener() {} } } },
    MutationObserver: class { constructor() { this.on = false; watches.push(this); } observe() { this.on = true; } disconnect() { this.on = false; } },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), visualViewport: { height: 800, addEventListener() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener: listen,
  });
  vm.runInContext(read('courses/page/pearson-embed.js'), c);
  await tick(); c.GZ_PEARSON_EMBED.sync();
  fire('message', { source: frame.contentWindow, origin: L.socket, data: { gzPearsonEmbed: 'hello', id: openerDoc } });
  fire('message', { source: frame.contentWindow, origin: L.socket, data: { gzPearsonEmbed: 'active', channel: messages.at(-1)?.channel } });
  assert.equal(slot.attrs.has('data-gz-pearson-slot'), true, 'embedded with access and the switch on');
  settings.enhance = { pearsonEmbed: false, pearsonViewer: true };
  c.GZ_PEARSON_EMBED.sync();
  assert.equal(slot.attrs.has('data-gz-pearson-slot'), true, 'switched off: the live session stays where it is');
  assert.ok(watches.at(-1).on, 'and keeps following the Look, so a palette change still reaches it');
  settings.enhance = {};
  c.GZ_PEARSON_EMBED.sync();
  assert.equal(slot.attrs.has('data-gz-pearson-slot'), false, 'the last switch off restores the native slot even when the device still holds the hosts');
  assert.equal(exit.attrs.has('data-gz-pearson-native-exit'), false, 'the native Exit returns');
  assert.equal(watches.at(-1).on, false, 'the paused session stops following the Look');
});

// Ultra's launch frame starts on Blackboard's own redirect pages; a post aimed at Pearson's opener there is refused and logged.
test('the host posts to the launch frame only after its opener says hello, and stops at that opener\'s bye', async () => {
  const events = new Map(), messages = [], opened = [];
  const listen = (k,f) => events.set(k, [...events.get(k) || [], f]);
  const fire = (k,e) => { for (const f of events.get(k) || []) f(e); };
  const node = () => {
    const attrs = new Map(), styles = new Map(), on = new Map();
    return { attrs, on, children: [], isConnected: true,
      style: { getPropertyValue: k => styles.get(k) || '', getPropertyPriority: () => '', setProperty: (k,v) => styles.set(k,v), removeProperty: k => styles.delete(k) },
      setAttribute: (k,v) => attrs.set(k,v), removeAttribute: k => attrs.delete(k), getAttribute: k => attrs.get(k) ?? null,
      addEventListener(k,f) { on.set(k,f); }, removeEventListener() {}, getBoundingClientRect: () => ({ top: 0, bottom: 20 }), click() {},
      append(...nodes) { this.children.push(...nodes); for (const n of nodes) n.parentElement = this; },
      remove() { this.isConnected = false; },
      get firstElementChild() { return this.children[0]; }, get lastElementChild() { return this.children.at(-1); },
    };
  };
  const settings = { enabled: true, enhance: { pearsonEmbed: true } };
  const slot = node(), header = node(), exit = node(), frame = node(), controls = node();
  controls.append(exit); header.querySelector = () => exit;
  frame.src = 'https://school.blackboard.com/webapps/blackboard/execute/ultraFramePassThrough?redirectTo=' + encodeURIComponent('https://school.blackboard.com/webapps/blackboard/execute/blti/launchLink?course_id=_1_1&content_id=_2_1&from_ultra=true');
  frame.parentElement = slot; frame.closest = () => ({ querySelector: () => header });
  frame.contentWindow = { postMessage: (m, origin) => messages.push({ m, origin }) };
  const c = vm.createContext({ URL, setTimeout, clearTimeout, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    GZ_PEARSON_EMBED_LIB: L, GZ_CTX: { site: 'ultra', on: () => true, settings: () => settings, darkTheme: () => false, t: x => x },
    location: new URL('https://school.blackboard.com/ultra/courses/_1_1/lti/launchFrame'),
    document: { getElementById: () => frame, querySelector: () => header, createElement: node, documentElement: node(), head: node() },
    chrome: { runtime: { getURL: x => x, sendMessage: async m => opened.push(m) }, storage: { local: { get: async () => ({ pearsonAccess: true }) }, onChanged: { addListener() {} } } },
    MutationObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), visualViewport: { height: 800, addEventListener() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener: listen,
  });
  vm.runInContext(read('courses/page/pearson-embed.js'), c);
  const say = data => fire('message', { source: frame.contentWindow, origin: L.socket, data });
  await tick(); settings.enhance = {}; c.GZ_PEARSON_EMBED.sync();
  say({ gzPearsonEmbed: 'hello', id: '77777777-7777-4777-8777-777777777777' });
  settings.enhance = { pearsonEmbed: true }; c.GZ_PEARSON_EMBED.sync();
  assert.equal(messages.at(-1)?.m.gzPearsonEmbed, 'context', 'an opener that said hello before Pearson inside Blackboard was switched on gets the context');
  say({ gzPearsonEmbed: 'bye', id: '77777777-7777-4777-8777-777777777777' }); c.GZ_PEARSON_EMBED.off(); messages.length = 0; c.GZ_PEARSON_EMBED.sync();
  frame.on.get('load')?.();
  assert.equal(messages.length, 0, 'the frame still shows Blackboard\'s launch redirect');
  say({ gzPearsonEmbed: 'hello' });
  fire('message', { source: frame.contentWindow, origin: 'https://school.blackboard.com', data: { gzPearsonEmbed: 'hello', id: openerDoc } });
  assert.equal(messages.length, 0, 'a hello needs the opener\'s name and Pearson\'s origin');
  say({ gzPearsonEmbed: 'hello', id: openerDoc });
  assert.deepEqual(messages.map(x => [x.m.gzPearsonEmbed, x.origin]), [['context', L.socket]]);
  const channel = messages[0].m.channel;
  say({ gzPearsonEmbed: 'place', channel, url: 'https://mylab.pearson.com/Student/PlayerHomework.aspx?homeworkId=101' });
  say({ gzPearsonEmbed: 'bye', id: '55555555-5555-4555-8555-555555555555' });
  settings.enhance = { pearsonEmbed: false, pearsonViewer: true }; c.GZ_PEARSON_EMBED.sync();
  assert.equal(messages.at(-1).m.enabled, false, 'a bye from another document does not end the opener');
  say({ gzPearsonEmbed: 'bye', id: openerDoc });
  const count = messages.length;
  settings.enhance = { pearsonEmbed: true }; c.GZ_PEARSON_EMBED.sync();
  const open = controls.children.find(n => n.className === 'gz-pearson-host-controls').firstElementChild;
  await open.on.get('click')(); await tick();
  assert.equal(messages.length, count, 'nothing is posted while the frame is between documents');
  assert.equal(opened.at(-1)?.url, L.launch(frame.src, 'https://school.blackboard.com/ultra/courses/_1_1/lti/launchFrame'), 'Open in tab falls back to a fresh launch at once');
  say({ gzPearsonEmbed: 'hello', id: '66666666-6666-4666-8666-666666666666' });
  assert.equal(messages.at(-1).m.gzPearsonEmbed, 'context', 'a returning opener gets the context again');
});
