const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const defaults = require('../../extension/content/defaults.js');
const read = f => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const tick = () => new Promise(setImmediate);
const L = require('../../extension/pearson/embed.js');

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
  c.GZ_PEARSON_EMBED.sync(); await tick(); active();
  assert.equal(slot.attrs.has('data-gz-pearson-slot'), false, 'a synced preference cannot act without access on this device');
  assert.ok(messages.every(m => m.enabled !== true), 'no enabled context reaches a launcher that cannot run');
  pearsonAccess = true;
  for (const f of changes) f({ pearsonAccess: { newValue: true } }, 'local');
  await tick(); c.GZ_PEARSON_EMBED.sync(); active();
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
  const settings = { enabled: true, enhance: { pearsonEmbed: true } };
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
  fire('message', { source: frame.contentWindow, origin: L.socket, data: { gzPearsonEmbed: 'active', channel: messages.at(-1)?.channel } });
  assert.equal(slot.attrs.has('data-gz-pearson-slot'), true, 'embedded with access and the switch on');
  settings.enhance = { pearsonEmbed: false };
  c.GZ_PEARSON_EMBED.sync();
  assert.equal(slot.attrs.has('data-gz-pearson-slot'), true, 'switched off: the live session stays where it is');
  assert.ok(watches.at(-1).on, 'and keeps following the Look, so a palette change still reaches it');
});
