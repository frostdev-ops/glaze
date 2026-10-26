// Settings → AI (lib/editor-ai.js) on stand-in elements, with the worker's real broker (lib/ai/broker.js config) over a
// stand-in store and server, the real lib/site.js asking for hosts, and a stand-in device provider: off by default, the
// switches in storage.local ai, Save and Test asking for exactly the address's host from the click, a key never shown in
// clear, the model picker and "unverified", the device's states and download, the features' toggles, the activity list
// (metadata only) and the last failure, and every word in every language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const I = require('../lib/i18n.js');
const AS = require('../lib/ai/settings.js');
const B = require('../lib/ai/broker.js');
const M = require('../lib/ai/models.js');
require('../lib/ai/providers/openai.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(setImmediate); };
const KEY = 'sk-live-ABCDEF0123456789';
const MASKED = 'sk-l••••6789';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const listing = (ids) => json({ data: ids.map((id) => ({ id })) });

// page({ ai, calls, granted, device, features, server }): Settings with the AI tab mounted.
//   device(m): the device provider's worker side (undefined: Glaze doesn't ship it here); server(url, init): the endpoint.
const page = ({ ai, calls, granted = true, device, features, server = async () => listing(['gpt-x', 'gpt-y']) } = {}) => {
  const ids = new Map(), sent = [], asked = [], onChanged = [], onMessage = [], held = new Set(), vault = new Map(), fetched = [];
  const data = { ...(ai && { ai: structuredClone(ai) }), ...(calls && { aiCalls: structuredClone(calls) }) };
  let gesture = false;
  const doc = { activeElement: null };
  const el = (tag = 'div') => {
    const classes = new Set();
    const e = { tagName: tag.toUpperCase(), children: [], textContent: '', value: '', type: '', hidden: false, disabled: false, checked: false, className: '', attrs: {}, on: {},
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
      append(...k) { this.children.push(...k); }, replaceChildren(...k) { this.children = k; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(type, f) { (this.on[type] ||= []).push(f); }, focus() { doc.activeElement = this; }, select() { this.selected = true; } };
    return e;
  };
  Object.assign(doc, { createElement: el, getElementById: (id) => { if (!ids.has(id)) ids.set(id, el()); return ids.get(id); } });
  const changed = (patch) => { for (const f of onChanged) f(patch, 'local'); };
  const local = {
    get: async (keys) => structuredClone(Object.fromEntries([].concat(keys).filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]]))),
    set: async (patch) => { Object.assign(data, structuredClone(patch)); changed(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { newValue: structuredClone(v) }]))); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; changed(Object.fromEntries([].concat(keys).map((k) => [k, {}]))); },
  };
  const env = {
    vault: { get: async (k) => structuredClone(vault.get(k)), set: async (k, v) => { vault.set(k, structuredClone(v)); return true; }, remove: async (k) => vault.delete(k) },
    reach: async (url) => { const u = new URL(url); return held.has(`${u.protocol}//${u.hostname}/*`); },
    fetch: async (url, init) => { fetched.push(url); return server(url, init); },
  };
  const chrome = {
    runtime: {
      id: 'glaze', getManifest: () => ({ host_permissions: ['https://*.instructure.com/*'] }),
      sendMessage: async (m) => {
        sent.push(structuredClone(m));
        if (m.type === 'glaze:allow') return { ok: true };
        if (m.type !== 'glaze:ai-config') return undefined;
        if (m.id === 'device' || m.provider === 'device') return device ? device(m) : { ok: false, error: 'setup' };
        return B.config(m, env);
      },
      onMessage: { addListener: (f) => onMessage.push(f) },
    },
    storage: { local, onChanged: { addListener: (f) => onChanged.push(f) } },
    permissions: { request: ({ origins }) => { asked.push([[...origins], gesture]); if (granted) origins.forEach((o) => held.add(o)); return Promise.resolve(granted); } },
  };
  const settings = { ...AS, ...(device && { PROVIDERS: [...AS.PROVIDERS, 'device'] }), ...(features && { FEATURES: features, clean: (raw) => ({ ...AS.clean(raw), features: Object.fromEntries(features.map((f) => [f, raw?.features?.[f] === true])) }) }) };
  const ctx = vm.createContext({ chrome, document: doc, URL, Promise, Date, Number, Array, Object, Math, Map, Set, structuredClone, setTimeout, clearTimeout,
    GZ_AI_SETTINGS: settings, GZ_AI_ENDPOINT: require('../lib/ai/endpoint.js') });
  vm.runInContext(read('lib/site.js'), ctx);
  vm.runInContext(read('lib/editor-ai.js'), ctx);
  ctx.GZ_AIEDIT.mount({ t: (k, v) => I.t(k, v, 'en'), when: (at) => `@${at}`, pct: (x) => `${Math.round(x * 100)}%` });
  const $ = (id) => doc.getElementById(id);
  const fire = (id, type, more = {}) => { gesture = true; try { for (const f of $(id).on[type] || []) f({ isTrusted: true, target: $(id), currentTarget: $(id), ...more }); } finally { gesture = false; } };
  // Every word and value on the page, to look for what must never be there.
  const all = (e = null) => (e ? [e.textContent, e.value, ...e.children.flatMap((k) => all(k))] : [...ids.values()].flatMap((x) => all(x)));
  return {
    $, data, sent, asked, held, vault, fetched, doc, all,
    ops: () => sent.filter((m) => m.type === 'glaze:ai-config').map((m) => m.op),
    click: async (id) => { fire(id, 'click'); await settle(); },
    change: async (id, checked) => { $(id).checked = checked; fire(id, 'change'); await settle(); },
    type: async (id, value) => { $(id).value = value; fire(id, 'input'); await settle(); },
    progress: async (m, sender = { id: 'glaze' }) => { for (const f of onMessage) f({ type: 'glaze:ai-config', op: 'progress', provider: 'device', ...m }, sender); await settle(); },
  };
};
const open = async (opts) => {
  const p = page(opts);
  await settle();
  p.endpoint = async (base = 'https://api.example.com/v1/', model = 'gpt-x', key = KEY) => {
    await p.change('ai-on', true); await p.change('ai-use-endpoint', true);
    p.$('ai-base').value = base; p.$('ai-model').value = model; await p.type('ai-key', key);
  };
  return p;
};
const shown = (e) => !e.hidden;
test.beforeEach(() => { B._reset(); M._reset(); });

test('off by default: the switch is off, only it shows, and the worker is asked for nothing but the kept connections', async () => {
  const p = await open();
  assert.equal(p.$('ai-on').checked, false);
  for (const id of ['ai-connection', 'ai-features', 'ai-activity']) assert.equal(p.$(id).hidden, true, id);
  assert.deepEqual(p.ops(), ['get']);
  assert.deepEqual(p.asked, []);
  assert.deepEqual(p.data, {}, 'opening Settings writes nothing');
  assert.match(read('options.html'), /<input type="checkbox" id="ai-on" data-local>/, 'the switch is not checked in the page');
  assert.deepEqual(AS.clean(undefined), { on: false, use: null, features: { syllabus: false } });
});

test('the switch and the connection are kept in storage.local ai, cleaned; the features stay off until each is turned on', async () => {
  const p = await open();
  await p.change('ai-on', true);
  assert.deepEqual(p.data.ai, { on: true, use: null, features: { syllabus: false } });
  assert.ok(shown(p.$('ai-connection')) && shown(p.$('ai-features')));
  assert.equal(p.$('ai-endpoint').hidden, true);
  await p.change('ai-use-endpoint', true);
  assert.equal(p.data.ai.use, 'endpoint');
  assert.ok(shown(p.$('ai-endpoint')));
  assert.equal(p.$('ai-device').hidden, true);
  const [label] = p.$('ai-feature-list').children, [box, name] = label.children;
  assert.equal(name.textContent, 'Syllabus import');
  assert.equal(box.checked, false, 'off until the student turns it on');
  box.checked = true; for (const f of box.on.change) f({ isTrusted: true }); await settle();
  assert.deepEqual(p.data.ai.features, { syllabus: true });
  await p.change('ai-on', false);
  assert.deepEqual(p.data.ai, { on: false, use: 'endpoint', features: { syllabus: true } }, 'off keeps the choices');
  assert.equal(p.$('ai-connection').hidden, true);
});

test('features are one row each, from lib/ai/settings.js FEATURES', async () => {
  const p = await open({ ai: { on: true, features: { syllabus: true } }, features: ['syllabus', 'notes'] });
  const rows = p.$('ai-feature-list').children;
  assert.deepEqual(rows.map((r) => r.children[1].textContent), ['Syllabus import', 'notes']);
  assert.deepEqual(rows.map((r) => r.children[0].checked), [true, false]);
  const notes = rows[1].children[0];
  notes.checked = true; for (const f of notes.on.change) f({ isTrusted: true }); await settle();
  assert.deepEqual(p.data.ai.features, { syllabus: true, notes: true });
});

test('Save asks for exactly the address\'s host from the click, then keeps the connection; the key comes back only masked', async () => {
  const p = await open();
  await p.endpoint();
  await p.click('ai-save');
  assert.deepEqual(p.asked, [[['https://api.example.com/*'], true]], 'one prompt, for that host, inside the click');
  const set = p.sent.find((m) => m.op === 'set');
  assert.deepEqual(set, { type: 'glaze:ai-config', op: 'set', id: 'endpoint', cfg: { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: KEY } });
  assert.ok(p.sent.findIndex((m) => m.type === 'glaze:allow') < p.sent.indexOf(p.sent.find((m) => m.op === 'set')), 'the worker hears it is a feature\'s host first');
  assert.deepEqual(p.ops(), ['get', 'set', 'get', 'models']);
  assert.equal(p.vault.get('connections').endpoint.key, KEY, 'the key lives in the worker');
  assert.equal(p.$('ai-key').value, MASKED);
  assert.ok(!p.all().some((x) => String(x).includes(KEY)), 'the key is nowhere on the page');
  assert.equal(p.$('ai-said').textContent, 'Saved');
  assert.ok(shown(p.$('ai-where')));
  assert.equal(p.$('ai-where').textContent, 'Sent to \u2068api.example.com\u2069');
  // A server on this computer: plain http, and its host whatever the port.
  const q = await open();
  await q.endpoint('http://localhost:11434/v1', 'llama3.2', '');
  await q.click('ai-save');
  assert.deepEqual(q.asked, [[['http://localhost/*'], true]]);
  assert.equal(q.$('ai-where').textContent, 'Sent to \u2068localhost:11434\u2069');
});

test('a key left masked is kept, an emptied one is removed, a new one replaces it; none is ever read back', async () => {
  const p = await open();
  await p.endpoint();
  await p.click('ai-save');
  p.$('ai-model').value = 'gpt-y';
  await p.click('ai-save');
  assert.equal(Object.hasOwn(p.sent.filter((m) => m.op === 'set').at(-1).cfg, 'key'), false, 'the masked key is not sent back');
  assert.equal(p.vault.get('connections').endpoint.key, KEY);
  assert.equal(p.$('ai-key').value, MASKED);
  await p.type('ai-key', '');
  await p.click('ai-save');
  assert.equal(p.sent.filter((m) => m.op === 'set').at(-1).cfg.key, '');
  assert.equal(p.vault.get('connections').endpoint.key, undefined, 'empty removes the key');
  assert.equal(p.$('ai-key').value, '');
  assert.equal(p.$('ai-key').type, 'password');
  await p.type('ai-key', 'sk-other-1234567890');
  assert.equal(p.$('ai-key').type, 'password', 'a typed key is hidden');
  await p.click('ai-save');
  assert.equal(p.vault.get('connections').endpoint.key, 'sk-other-1234567890');
  assert.equal(p.$('ai-key').value, 'sk-o••••7890');
  assert.ok(!p.all().some((x) => String(x).includes('sk-other-1234567890')));
});

test('a refused host is said; an address that is no endpoint is refused before any prompt', async () => {
  const p = await open({ granted: false });
  await p.endpoint();
  await p.click('ai-save');
  assert.equal(p.$('ai-said').textContent, 'Glaze isn’t allowed to reach \u2068api.example.com\u2069.');
  assert.ok(p.$('ai-said').classList.contains('err'));
  assert.ok(!p.ops().includes('models'), 'nothing is fetched without the host');
  const q = await open();
  await q.endpoint('http://example.com/v1');
  await q.click('ai-save');
  assert.deepEqual(q.asked, []);
  assert.deepEqual(q.ops(), ['get']);
  assert.equal(q.doc.activeElement, q.$('ai-base'));
  await q.endpoint('https://api.example.com/v1', '');
  await q.click('ai-test');
  assert.deepEqual(q.asked, []);
  assert.equal(q.doc.activeElement, q.$('ai-model'));
});

test('Test asks for the host from its click, and a failure shows its category and reference, never the server\'s words', async () => {
  let refuse = true;
  const p = await open({ server: async (url) => (refuse ? json({ error: { message: `invalid api key ${KEY}` } }, 401) : listing(['gpt-x'])) });
  await p.endpoint();
  await p.click('ai-save');
  await p.click('ai-test');
  assert.deepEqual(p.asked.at(-1), [['https://api.example.com/*'], true]);
  assert.deepEqual(p.ops().slice(-2), ['test', 'models'], 'nothing changed, so nothing is saved again');
  assert.equal(p.$('ai-said').textContent, 'Refused');
  const line = p.$('ai-failure');
  assert.ok(shown(line));
  assert.match(line.textContent, /^Last failure: Refused \(HTTP 401\) · Reference \u2068[0-9a-f-]{36}\u2069$/);
  assert.ok(!p.all().some((x) => /invalid api key/.test(String(x))), 'no upstream text');
  refuse = false; M._reset();
  await p.click('ai-test');
  assert.equal(p.$('ai-said').textContent, 'Ready');
  assert.equal(line.hidden, true, 'a later success clears it');
  // Changed fields are saved before the test.
  p.$('ai-model').value = 'gpt-y';
  await p.click('ai-test');
  assert.deepEqual(p.ops().slice(-4), ['set', 'get', 'test', 'models']);
  assert.equal(p.vault.get('connections').endpoint.model, 'gpt-y');
  assert.equal(p.$('ai-said').textContent, 'This endpoint doesn’t list that model.');
});

test('a run that failed shows on the last-failure line, with its reference', async () => {
  const ref = '0b6c4f7e-2c1d-4c5e-9a7b-1f2e3d4c5b6a';
  const p = await open({ ai: { on: true, use: 'endpoint' }, calls: [{ id: 'a', feature: 'syllabus', provider: 'openai', state: 'completed', startedAt: 1 },
    { id: ref, feature: 'syllabus', provider: 'openai', state: 'timeout', category: 'timeout', startedAt: 2 }] });
  assert.equal(p.$('ai-failure').textContent, `Last failure: Timed out · Reference \u2068${ref}\u2069`);
  const q = await open({ ai: { on: true, use: 'endpoint' }, calls: [{ id: ref, feature: 'syllabus', provider: 'openai', state: 'cancelled', category: 'cancelled', startedAt: 2 }] });
  assert.equal(q.$('ai-failure').hidden, true, 'a cancel is no failure');
});

test('the model picker is the connection\'s catalog; a model it doesn\'t list, or a list that isn\'t live, is unverified', async () => {
  let down = false;
  const p = await open({ server: async () => (down ? new Response('', { status: 503 }) : listing(['gpt-x', 'gpt-y'])) });
  assert.equal(p.$('ai-model-unverified').hidden, true, 'nothing to verify before a connection is kept');
  await p.endpoint();
  await p.click('ai-save');
  assert.deepEqual(p.$('ai-models').children.map((o) => o.value), ['gpt-x', 'gpt-y']);
  assert.equal(p.$('ai-model-unverified').hidden, true);
  await p.type('ai-model', 'gpt-z');
  assert.equal(p.$('ai-model-unverified').hidden, false, 'free text the list doesn\'t have');
  await p.type('ai-model', 'gpt-y');
  assert.equal(p.$('ai-model-unverified').hidden, true);
  // The server is down: the kept list (cache) is all there is.
  down = true; M._reset();
  await p.click('ai-test');
  assert.equal(p.sent.filter((m) => m.op === 'models').length, 2);
  assert.equal(p.$('ai-model-unverified').hidden, false, 'a cached list can\'t vouch for it');
  // No list at all: free text, unverified.
  const q = await open({ server: async () => new Response('', { status: 404 }) });
  await q.endpoint('https://other.example.org/v1', 'my-model', '');
  await q.click('ai-save');
  assert.deepEqual(q.$('ai-models').children, []);
  assert.equal(q.$('ai-model').value, 'my-model');
  assert.equal(q.$('ai-model-unverified').hidden, false);
});

test('on this device: its status from the worker, a download the student starts, its progress, and why it can\'t run', async () => {
  let state = 'download';
  const device = async (m) => (m.op === 'set' ? { ok: true } : m.op === 'test' ? (state === 'none' ? { ok: false, error: 'setup' } : { ok: true, state, ...(state === 'unavailable' && { reason: 'browser' }) }) : m.op === 'prepare' ? { ok: true } : { ok: false, error: 'op' });
  const p = await open({ device });
  assert.equal(p.$('ai-use-device').disabled, false);
  assert.equal(p.$('ai-device-off').hidden, true);
  await p.change('ai-on', true);
  await p.change('ai-use-device', true);
  assert.equal(p.data.ai.use, 'device');
  assert.ok(shown(p.$('ai-device')) && p.$('ai-endpoint').hidden);
  assert.equal(p.$('ai-device-state').textContent, 'Needs a download');
  assert.ok(shown(p.$('ai-device-download')));
  assert.equal(p.$('ai-where').hidden, true, 'nothing leaves this device');
  state = 'downloading';
  await p.click('ai-device-download');
  assert.deepEqual(p.sent.find((m) => m.op === 'prepare'), { type: 'glaze:ai-config', op: 'prepare', provider: 'device' });
  assert.equal(p.$('ai-device-download').hidden, true);
  await p.progress({ loaded: 0.42 });
  assert.equal(p.$('ai-device-state').textContent, 'Downloading 42%');
  assert.ok(shown(p.$('ai-device-progress')));
  assert.equal(p.$('ai-device-progress').value, 0.42);
  await p.progress({ loaded: 0.9 }, { id: 'someone-else' });
  assert.equal(p.$('ai-device-progress').value, 0.42, 'only Glaze\'s own messages');
  await p.progress({ loaded: 50, total: 100 });
  assert.equal(p.$('ai-device-state').textContent, 'Downloading 50%');
  state = 'ready';
  await p.progress({ progress: 1 });
  assert.equal(p.$('ai-device-state').textContent, 'Ready');
  assert.equal(p.$('ai-device-progress').hidden, true);
  // Not on this browser or this computer: said, with nothing to press.
  state = 'unavailable';
  const q = await open({ device, ai: { on: true, use: 'device' } });
  assert.equal(q.$('ai-device-state').textContent, 'Not available in this browser');
  assert.equal(q.$('ai-device-download').hidden, true);
  // A first choice makes the device's connection, then asks its status.
  state = 'none';
  const r = await open({ device: async (m) => { if (m.op === 'set') state = 'ready'; return device(m); } });
  await r.change('ai-on', true);
  await r.change('ai-use-device', true);
  assert.deepEqual(r.sent.filter((m) => m.id === 'device').map((m) => m.op), ['test', 'set', 'test']);
  assert.deepEqual(r.sent.find((m) => m.op === 'set'), { type: 'glaze:ai-config', op: 'set', id: 'device', cfg: { provider: 'device' } });
  assert.equal(r.$('ai-device-state').textContent, 'Ready');
});

test('where Glaze has no device provider, On this device is disabled and says why', async () => {
  const p = await open({ ai: { on: true } });
  assert.equal(p.$('ai-use-device').disabled, true);
  assert.ok(shown(p.$('ai-device-off')));
  assert.match(read('options.html'), /id="ai-use-device" aria-describedby="ai-device-off"/);
  assert.equal(p.$('ai-device').hidden, true);
});

test('activity: the recent calls, newest first, metadata only, and Clear', async () => {
  const calls = [
    { id: 'r1', task: 'syllabus.read', feature: 'syllabus', provider: 'openai', state: 'completed', startedAt: 1000, ms: 900, usage: { input: 1200, output: 34 }, prompt: 'secret words', key: KEY, base: 'https://api.example.com' },
    { id: 'r2', task: 'syllabus.read', feature: 'syllabus', provider: 'device', state: 'request-rejected', category: 'request-rejected', status: 400, startedAt: 2000 },
  ];
  const p = await open({ calls });
  assert.ok(shown(p.$('ai-activity')), 'a record shows with AI off too, so it can be cleared');
  const text = p.$('ai-calls').children.map((li) => li.children[0].children.map((x) => x.textContent).join(' | '));
  assert.deepEqual(text, ['Syllabus import · On this device | @2000 · Refused', 'Syllabus import · Endpoint | @1000 · 1,234 tokens · Done']);
  assert.ok(!p.all().some((x) => /secret words|api\.example\.com|sk-live/.test(String(x))), 'nothing but metadata');
  assert.equal(p.$('ai-calls-empty').hidden, true);
  await p.click('ai-calls-clear');
  assert.equal(p.data.aiCalls, undefined);
  assert.deepEqual(p.$('ai-calls').children, []);
  assert.equal(p.$('ai-calls-empty').hidden, false);
  assert.equal(p.$('ai-calls-clear').disabled, true);
  assert.equal(p.$('ai-activity').hidden, true, 'off and empty: out of the way');
  assert.ok(!p.fetched.length && !p.asked.length, 'nothing is sent anywhere');
});

test('the page: an AI tab before Privacy and data, kept out of embedded Settings, every id once, labelled controls and its scripts first', () => {
  const html = read('options.html'), js = read('lib/editor-ai.js'), opts = read('options.js');
  const tabs = [...html.matchAll(/data-editor-tab="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(tabs.indexOf('ai'), tabs.indexOf('backup') - 1);
  assert.match(opts, /\['ai', 'AI'\]/, 'embedded Settings sends it to a tab of its own');
  assert.match(opts, /GZ_AIEDIT\.mount\(/);
  const used = new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
  assert.ok(used.size > 20);
  for (const id of used) assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
  const order = ['lib/site.js', 'lib/ai/settings.js', 'lib/ai/endpoint.js', 'lib/editor-ai.js', 'options.js'].map((f) => html.indexOf(`<script src="${f}"></script>`));
  assert.ok(order.every((i) => i > 0) && order.every((i, k) => !k || i > order[k - 1]), String(order));
  const panel = html.slice(html.indexOf('<div id="panel-ai"'), html.indexOf('<div id="panel-backup"'));
  assert.match(panel, /<input id="ai-key" type="password"[^>]*autocomplete="off"/);
  for (const [, tag] of panel.matchAll(/(<input[^>]*>)/g)) assert.match(tag, /data-local/, tag);
  for (const id of ['ai-said', 'ai-device-state']) assert.match(panel, new RegExp(`id="${id}" role="status" aria-live="polite"`), id);
  assert.match(panel, /role="radiogroup" aria-labelledby="ai-connection-head"/);
  assert.match(panel, /<progress id="ai-device-progress"[^>]*aria-labelledby="ai-device-state"/);
  for (const id of ['ai-base', 'ai-model', 'ai-key']) assert.match(panel, new RegExp(`id="${id}"[^>]*dir="ltr"`), `${id} keeps its direction`);
  // Words reach the page as text only.
  for (const word of ['innerHTML', 'outerHTML', 'insertAdjacentHTML']) assert.ok(!js.includes(word), word);
});

test('every word of Settings → AI is in every language', () => {
  const html = read('options.html'), js = read('lib/editor-ai.js').replace(/\/\/[^\n]*/g, '');
  const panel = html.slice(html.indexOf('<div id="panel-ai"'), html.indexOf('<div id="panel-backup"'));
  const fromHtml = [...panel.replace(/<(\w+)[^>]*translate="no"[^>]*>[\s\S]*?<\/\1>/g, '').matchAll(/>([^<]+)</g)].map((m) => m[1].replace(/\s+/g, ' ').trim()).filter((s) => /\p{L}/u.test(s));
  const fromJs = [...js.matchAll(/\bt\('((?:\\.|[^'\\])*)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  const words = new Set([...fromHtml, ...fromJs, 'AI']);
  assert.ok(words.size > 40, `${words.size} words`);
  for (const [lang, cat] of Object.entries(globalThis.GZ_LANGS)) for (const w of words) assert.ok(w in cat, `${lang}: "${w}"`);
  assert.equal(I.t('{n} tokens', { n: 1 }), '1 token');
  assert.equal(I.t('{n} tokens', { n: 2 }), '2 tokens');
});

test('the helpers: a download\'s progress, the record\'s rows and the last failure', () => {
  const E = require('../lib/editor-ai.js');
  assert.equal(E.progress({ loaded: 0.5 }), 0.5);
  assert.equal(E.progress({ loaded: 30, total: 60 }), 0.5);
  assert.equal(E.progress({ progress: 2 }), 1);
  assert.equal(E.progress({}), null);
  assert.deepEqual(E.rows([null, { startedAt: 'x' }, { id: 'a', startedAt: 5, feature: 'syllabus', provider: 'openai', state: 'completed', prompt: 'no' }]),
    [{ at: 5, feature: 'syllabus', provider: 'openai', state: 'completed', reference: 'a' }]);
  assert.equal(E.lastFailure([{ id: 'a', startedAt: 1, state: 'timeout', category: 'timeout' }], { at: 2, failed: false }), null, 'a later good test');
  assert.equal(E.lastFailure([{ id: 'a', startedAt: 3, state: 'timeout', category: 'timeout' }], { at: 2, failed: false }).reference, 'a');
});
