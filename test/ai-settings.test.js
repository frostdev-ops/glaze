// Settings → AI (lib/editor-ai.js) on stand-in elements, with the worker's real broker (lib/ai/broker.js config) over a
// stand-in store and server, the real lib/site.js asking for hosts, and a stand-in device provider: off by default, the
// switches and models in storage.local ai, the providers' cards and their drawer, Connect asking for exactly the provider's
// host from the click, a key never shown in clear, the model picker, the effort a model takes, a feature's own model,
// Advanced's endpoints and tuning, an older store as Settings shows it, the device's states and download, the activity
// list (metadata only), and every word in every language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const I = require('../lib/i18n.js');
const AS = require('../lib/ai/settings.js');
const B = require('../lib/ai/broker.js');
const M = require('../lib/ai/models.js');
require('../lib/ai/providers/openai.js');
const D = require('../lib/ai/providers/device.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async () => { for (let i = 0; i < 80; i++) await new Promise(setImmediate); };
const KEY = 'sk-live-ABCDEF0123456789';
const MASKED = 'sk-l••••6789';
const OWNER = 'sk-or-v1-0000synthetic0000000000000000000000000000000000000000000000';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const listing = (ids) => json({ data: ids.map((id) => ({ id })) });
// The servers by address: OpenAI's and Groq's lists, anything else a short list.
const SERVERS = async (url) => (url.startsWith('https://api.openai.com/') ? listing(['gpt-5', 'gpt-5-mini', 'gpt-4.1'])
  : url.startsWith('https://api.groq.com/') ? listing(['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']) : listing(['m-1', 'm-2', 'm-3']));
const kept = (id, more = {}) => ({ provider: 'openai', base: AS.PRESETS[id].base, key: `${id}-key-0123456789`, generation: `g-${id}`, ...more });

// page({ ai, calls, conns, granted, device, providers, features, server }): Settings with the AI tab mounted.
//   conns: the worker's kept connections; device(m, gesture): the device provider's worker side; server(url, init): the
//   providers' servers.
const page = ({ ai, calls, conns, granted = true, device, providers, features, embedded = false, save = true, shared, locks, server = SERVERS } = {}) => {
  const ids = new Map(), sent = [], asked = [], reads = [], onChanged = shared?.listeners || [], onMessage = [], held = new Set(), vault = new Map(), fetched = [], docOn = {};
  if (conns) vault.set('connections', structuredClone(conns));
  const data = shared?.data || { ...(ai && { ai: structuredClone(ai) }), ...(calls && { aiCalls: structuredClone(calls) }) };
  let gesture = false;
  const doc = { activeElement: null };
  const walk = (e) => (e && typeof e === 'object' ? [e, ...e.children.flatMap(walk)] : []);
  const el = (tag = 'div') => {
    const e = { tagName: tag.toUpperCase(), children: [], textContent: '', value: '', type: '', id: '', hidden: false, disabled: false, checked: false, className: '', attrs: {}, on: {},
      style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
      classList: {
        toggle: (c, on) => { const set = new Set(e.className.split(/\s+/).filter(Boolean)); if (on ?? !set.has(c)) set.add(c); else set.delete(c); e.className = [...set].join(' '); },
        contains: (c) => e.className.split(/\s+/).includes(c),
      },
      append(...k) { this.children.push(...k); }, replaceChildren(...k) { this.children = k; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(type, f) { (this.on[type] ||= []).push(f); }, focus() { doc.activeElement = this; }, select() { this.selected = true; },
      querySelector() { return walk(this).slice(1).find((x) => x.tagName === 'INPUT' || (x.tagName === 'BUTTON' && x.classList.contains('primary'))) || null; } };
    return e;
  };
  // An element the page has, by id: drawn by the editor first, else the page's own.
  const byId = (id) => {
    for (const r of ids.values()) { const f = walk(r).slice(1).find((x) => x.id === id); if (f) return f; }
    if (!ids.has(id)) { const e = el(); e.id = id; ids.set(id, e); }
    return ids.get(id);
  };
  Object.assign(doc, { createElement: el, getElementById: byId, addEventListener: (type, f) => (docOn[type] ||= []).push(f) });
  const changed = (patch) => { for (const f of onChanged) f(patch, 'local'); };
  const local = {
    get: async (keys) => { reads.push(keys); return structuredClone(Object.fromEntries([].concat(keys).filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]]))); },
    set: async (patch) => { Object.assign(data, structuredClone(patch)); changed(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { newValue: structuredClone(v) }]))); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; changed(Object.fromEntries([].concat(keys).map((k) => [k, {}]))); },
  };
  const env = {
    settings: async () => structuredClone(data.ai), local: { set: async (v) => { await local.set(v); return true; } },
    vault: { get: async (k) => structuredClone(vault.get(k)), set: async (k, v) => { if (!save) return false; vault.set(k, structuredClone(v)); return true; }, remove: async (k) => vault.delete(k) },
    reach: async (url) => { const u = new URL(url); return held.has(`${u.protocol}//${u.hostname}/*`); },
    fetch: async (url, init) => { fetched.push([url, init?.headers]); return server(url, init); },
    say: (m) => { for (const f of onMessage) f(m, { id: 'glaze' }); },
  };
  if (conns) for (const c of Object.values(conns)) if (c.base) { const u = new URL(c.base); held.add(`${u.protocol}//${u.hostname}/*`); }
  const chrome = {
    runtime: {
      id: 'glaze', getManifest: () => ({ host_permissions: ['https://*.instructure.com/*'] }),
      sendMessage: async (m) => {
        sent.push(structuredClone(m));
        if (m.type === 'glaze:allow') return { ok: true };
        if (m.type !== 'glaze:ai-config') return undefined;
        if (device && (m.id === 'device' || m.provider === 'device')) return device(m, gesture);
        const r = await B.config(m, env);
        return m.op === 'get' && providers ? { ...r, providers } : r;
      },
      onMessage: { addListener: (f) => onMessage.push(f) },
    },
    storage: { local, onChanged: { addListener: (f) => onChanged.push(f) } },
    permissions: { request: ({ origins }) => { asked.push([[...origins], gesture]); if (granted) origins.forEach((o) => held.add(o)); return Promise.resolve(granted); } },
  };
  const settings = { ...AS, ...(providers && { PROVIDERS: [...new Set([...AS.PROVIDERS, ...providers])] }), ...(features && { FEATURES: features, clean: (raw) => ({ ...AS.clean(raw), features: Object.fromEntries(features.map((f) => [f, raw?.features?.[f] === true])) }) }) };
  const window = {}; window.top = embedded ? {} : window;
  const ctx = vm.createContext({ chrome, window, navigator: { locks }, document: doc, URL, Promise, Date, Number, Array, Object, Math, Map, Set, structuredClone, setTimeout, clearTimeout,
    GZ_AI_SETTINGS: settings, GZ_AI_ENDPOINT: require('../lib/ai/endpoint.js') });
  vm.runInContext(read('lib/site.js'), ctx);
  vm.runInContext(read('lib/editor-ai.js'), ctx);
  ctx.GZ_AIEDIT.mount({ t: (k, v) => I.t(k, v, 'en'), when: (at) => `@${at}`, pct: (x) => `${Math.round(x * 100)}%` });
  const $ = (id) => doc.getElementById(id);
  const target = (x) => (typeof x === 'string' ? $(x) : x);
  const fire = (x, type, more = {}) => { const e = target(x); gesture = true; try { return Promise.all((e.on[type] || []).map((f) => f({ isTrusted: true, target: e, currentTarget: e, preventDefault() {}, ...more }))); } finally { gesture = false; } };
  // Every word and value on the page, to look for what must never be there.
  const all = (e = null) => (e ? [e.textContent, e.value, ...e.children.flatMap((k) => all(k))] : [...ids.values()].flatMap((x) => all(x)));
  const p = {
    $, data, sent, asked, reads, held, vault, fetched, doc, all, local, fire, walk,
    ops: () => sent.filter((m) => m.type === 'glaze:ai-config').map((m) => m.op),
    click: async (x) => { await fire(x, 'click'); await settle(); },
    change: async (x, checked) => { target(x).checked = checked; fire(x, 'change'); await settle(); },
    type: async (x, value) => { target(x).value = value; fire(x, 'input'); await settle(); },
    key: async (x, key) => { fire(x, 'keydown', { key }); await settle(); },
    outside: async () => { for (const f of docOn.pointerdown || []) f({ target: { closest: () => null } }); await settle(); },
    progress: async (m, sender = { id: 'glaze' }) => { for (const f of onMessage) f({ type: 'glaze:ai-config', event: 'progress', provider: 'device', ...m }, sender); await settle(); },
    // The page's parts: a provider's card, a button by its words, a feature's row and its parts.
    card: (name) => $('ai-providers').children.find((b) => b.children[1]?.textContent === name),
    cards: () => $('ai-providers').children.map((b) => b.children[1].textContent),
    button: (words, within) => walk(within || { children: [...ids.values()] }).find((x) => x.tagName === 'BUTTON' && text(x) === words),
    row: (id) => $('ai-feature-list').children.find((w) => walk(w).some((x) => x.id === `ai-pick-${id}`)),
    stops: (id) => { const e = p.walk(p.row(id)).find((x) => x.className === 'ai-effort' || x.className === 'ai-effort unset'); return e ? e.children[1].children : null; },
    options: () => $('ai-pick-list').children.map((li) => li.children[0]?.textContent ?? li.textContent),
    side: () => walk(p.row(p.picking())).find((x) => x.className === 'side').children,
    picking: () => ['model', ...AS.FEATURES].find((r) => $(`ai-pick-${r}`).attrs['aria-expanded'] === 'true'),
  };
  return p;
};
// An element's words, its children's too, as a screen reader has them (a provider's mark is decoration).
const text = (e) => (e && typeof e === 'object' && e.attrs?.['aria-hidden'] !== 'true' ? `${e.textContent}${e.children.map(text).join('')}` : '');
const open = async (opts) => { const p = page(opts); await settle(); return p; };
const shown = (e) => !e.hidden;
test.beforeEach(() => { B._reset(); M._reset(); D._reset(); });

test('off by default: the switch is off, only it shows, and the worker is asked for nothing but the kept connections', async () => {
  const p = await open();
  assert.equal(p.$('ai-on').checked, false);
  for (const id of ['ai-connection', 'ai-features', 'ai-activity', 'ai-mode']) assert.equal(p.$(id).hidden, true, id);
  assert.deepEqual(p.ops(), ['get']);
  assert.deepEqual(p.asked, []);
  assert.deepEqual(p.data, {}, 'opening Settings writes nothing');
  assert.match(read('options.html'), /<input type="checkbox" role="switch" id="ai-on" aria-label="Use AI" data-local>/, 'the switch is not checked in the page');
  assert.deepEqual(AS.clean(undefined), { on: false, mode: 'simple', model: { use: null, model: '' }, models: {}, tune: {}, features: { syllabus: false, completion: false, writing: false } });
});

test('embedded Settings does not initialize AI controls or read its connections and activity', async () => {
  const p = await open({ embedded: true, ai: { on: true, model: { use: 'device' } }, calls: [{ startedAt: 1, feature: 'syllabus', provider: 'device', state: 'completed' }] });
  assert.deepEqual(p.ops(), []);
  assert.deepEqual(p.reads, []);
  assert.deepEqual(p.$('ai-feature-list').children, []);
  await p.change('ai-on', false);
  assert.equal(p.data.ai.on, true, 'the gated frame has no AI change handlers');
});

test('the switch, the mode and the models are kept in storage.local ai, cleaned; the features stay off until each is turned on', async () => {
  const p = await open();
  await p.change('ai-on', true);
  assert.deepEqual(p.data.ai, { on: true, mode: 'simple', model: { use: null, model: '' }, models: {}, tune: {}, features: { syllabus: false, completion: false, writing: false } });
  assert.ok(shown(p.$('ai-connection')) && shown(p.$('ai-features')) && shown(p.$('ai-mode')));
  assert.equal(p.$('ai-mode-simple').checked, true);
  // The overall model first, then each feature: the gray text, Feedback, then the rest.
  assert.deepEqual(p.$('ai-feature-list').children.map((w) => text(w.children[0].children[0])), ['Default', 'Tab completion', 'Feedback', 'Syllabus import']);
  assert.equal(p.$('ai-feature-syllabus').checked, false, 'off until the student turns it on');
  p.$('ai-feature-syllabus').focus();
  await p.change('ai-feature-syllabus', true);
  assert.deepEqual(p.data.ai.features, { syllabus: true, completion: false, writing: false });
  assert.equal(p.doc.activeElement, p.$('ai-feature-syllabus'), 'the row drawn again keeps the focus on its switch');
  await p.change('ai-mode-advanced', true);
  assert.equal(p.data.ai.mode, 'advanced');
  await p.change('ai-on', false);
  assert.deepEqual({ ...p.data.ai, features: p.data.ai.features.syllabus }, { on: false, mode: 'advanced', model: { use: null, model: '' }, models: {}, tune: {}, features: true }, 'off keeps the choices');
  assert.equal(p.$('ai-connection').hidden, true);
  assert.equal(p.$('ai-mode').hidden, true);
});

test('features turned on in quick succession are all kept: no switch is written over by one still saving', async () => {
  const p = await open({ ai: { on: true } });
  const boxes = AS.FEATURES.map((f) => p.$(`ai-feature-${f}`));
  for (const b of boxes) { b.checked = true; p.fire(b, 'change'); }
  await settle();
  assert.deepEqual(p.data.ai.features, { syllabus: true, completion: true, writing: true });
  assert.deepEqual(AS.FEATURES.map((f) => p.$(`ai-feature-${f}`).checked), [true, true, true]);
});

test('features are one row each, from lib/ai/settings.js FEATURES, after the overall model', async () => {
  const p = await open({ ai: { on: true, features: { syllabus: true } }, features: ['syllabus', 'notes'] });
  assert.deepEqual(p.$('ai-feature-list').children.map((w) => text(w.children[0].children[0])), ['Default', 'Syllabus import', 'notes']);
  assert.deepEqual([p.$('ai-feature-syllabus').checked, p.$('ai-feature-notes').checked], [true, false]);
  await p.change('ai-feature-notes', true);
  assert.deepEqual(p.data.ai.features, { syllabus: true, notes: true });
});

test('the providers\' cards: on this device first where the browser has a model, then each provider by name; endpoints in Advanced only', async () => {
  const p = await open({ ai: { on: true } });
  assert.deepEqual(p.cards(), ['Gemini Nano', 'OpenAI', 'Anthropic', 'Google Gemini', 'OpenRouter', 'xAI', 'Mistral', 'Groq', 'DeepSeek']);
  const none = await open({ ai: { on: true }, providers: ['openai'] });
  assert.equal(none.cards()[0], 'OpenAI', 'no model on this device: no card for it');
  const adv = await open({ ai: { on: true, mode: 'advanced' }, conns: { 'custom-1': { provider: 'openai', name: 'Ollama', base: 'http://localhost:11434/v1', generation: 'g' } } });
  assert.deepEqual(adv.cards().slice(-2), ['Ollama', 'Endpoint']);
  const simple = await open({ ai: { on: true }, conns: { 'custom-1': { provider: 'openai', name: 'Ollama', base: 'http://localhost:11434/v1', generation: 'g' } } });
  assert.ok(!simple.cards().includes('Ollama') && !simple.cards().includes('Endpoint'));
  // Each card is a button that says whether its drawer is open.
  const card = p.card('OpenAI');
  assert.deepEqual([card.tagName, card.attrs['aria-expanded'], card.attrs['aria-controls']], ['BUTTON', 'false', 'ai-drawer']);
  await p.click(card);
  assert.equal(p.card('OpenAI').attrs['aria-expanded'], 'true');
  assert.equal(p.$('ai-fold').hidden, false);
  assert.equal(p.doc.activeElement, p.$('ai-key'), 'the key field takes the focus');
  await p.click(p.card('OpenAI'));
  assert.equal(p.$('ai-fold').hidden, true);
});

test('Connect asks for exactly the provider\'s host from the click, then keeps the key in the worker; it comes back only masked', async () => {
  const p = await open({ ai: { on: true } });
  await p.click(p.card('OpenAI'));
  const drawer = p.$('ai-drawer');
  assert.equal(p.$('ai-key').type, 'password');
  assert.equal(p.$('ai-key').attrs.dir, 'ltr');
  const get = p.walk(drawer).find((x) => x.tagName === 'A');
  assert.deepEqual([text(get), get.href, get.target, get.rel], ['Get a key ↗', AS.PRESETS.openai.keys, '_blank', 'noopener noreferrer']);
  p.$('ai-key').value = KEY;
  await p.click(p.button('Connect', drawer));
  assert.deepEqual(p.asked, [[['https://api.openai.com/*'], true]], 'one prompt, for that host, inside the click');
  const set = p.sent.find((m) => m.op === 'set');
  assert.deepEqual(set, { type: 'glaze:ai-config', op: 'set', id: 'openai', cfg: { provider: 'openai', key: KEY } });
  assert.ok(p.sent.findIndex((m) => m.type === 'glaze:allow') < p.sent.indexOf(set), 'the worker hears it is a feature\'s host first');
  assert.deepEqual(p.ops(), ['get', 'set', 'get', 'test', 'models']);
  assert.deepEqual((({ generation: _, ...c }) => c)(p.vault.get('connections').openai), { provider: 'openai', base: 'https://api.openai.com/v1', key: KEY }, 'at the provider\'s own address, the key in the worker');
  assert.equal(AS.clean(p.data.ai).model.use, null, 'connecting chooses no model');
  assert.ok(!p.all().some((x) => String(x).includes(KEY)), 'the key is nowhere on the page');
  assert.ok(p.walk(p.$('ai-drawer')).some((x) => x.textContent === MASKED));
  assert.deepEqual([p.card('OpenAI').children[2].className, p.card('OpenAI').children[2].textContent], ['st ok', 'Connected']);
  assert.ok(p.button('Replace key', p.$('ai-drawer')) && p.button('Remove', p.$('ai-drawer')));
  // A key typed into another provider's drawer goes there only.
  await p.click(p.card('Groq'));
  p.$('ai-key').value = 'gsk_0123456789abcdef';
  await p.click(p.button('Connect', p.$('ai-drawer')));
  assert.deepEqual(p.asked.at(-1), [['https://api.groq.com/*'], true]);
  assert.equal(p.vault.get('connections').groq.base, 'https://api.groq.com/openai/v1');
});

test('Enter in the key field connects from its own key press, and an empty key asks for one before any prompt', async () => {
  const p = await open({ ai: { on: true } });
  await p.click(p.card('OpenAI'));
  await p.click(p.button('Connect', p.$('ai-drawer')));
  assert.deepEqual(p.asked, []);
  assert.equal(text(p.$('ai-drawer')).includes('Enter a key.'), true);
  assert.equal(p.doc.activeElement, p.$('ai-key'));
  p.$('ai-key').value = KEY;
  await p.key('ai-key', 'Enter');
  assert.deepEqual(p.asked, [[['https://api.openai.com/*'], true]], 'the key press is the student\'s');
  assert.equal(p.vault.get('connections').openai.key, KEY);
});

test('a refused host is said and checks nothing; the card isn\'t shown connected', async () => {
  const p = await open({ ai: { on: true }, granted: false });
  await p.click(p.card('OpenAI'));
  p.$('ai-key').value = KEY;
  await p.click(p.button('Connect', p.$('ai-drawer')));
  const said = p.walk(p.$('ai-drawer')).find((x) => x.className === 'err-t');
  assert.equal(said.textContent, 'Glaze isn’t allowed to reach \u2068api.openai.com\u2069.');
  assert.equal(said.attrs.role, 'alert');
  assert.ok(!p.ops().includes('test') && !p.ops().includes('models'), 'nothing is fetched without the host');
  assert.notEqual(p.card('OpenAI').children[2].className, 'st ok');
  assert.ok(!p.all().some((x) => String(x).includes(KEY)));
});

test('a refused key is said on the drawer, its card and every model on it, never the server\'s words', async () => {
  const server = async (url) => (url.startsWith('https://api.openai.com/') ? json({ error: { message: 'invalid api key sk-live-ABCDEF0123456789' } }, 401) : SERVERS(url));
  const p = await open({ ai: { on: true, model: { use: 'openai', model: 'gpt-5' } }, server });
  await p.click(p.card('OpenAI'));
  p.$('ai-key').value = KEY;
  await p.click(p.button('Connect', p.$('ai-drawer')));
  assert.equal(p.walk(p.$('ai-drawer')).find((x) => x.className === 'err-t').textContent, 'Key refused · HTTP 401');
  assert.ok(p.$('ai-key').classList.contains('bad'));
  assert.deepEqual([p.card('OpenAI').children[2].className, p.card('OpenAI').children[2].textContent], ['st bad', 'Key refused']);
  const dot = p.walk(p.$('ai-pick-model')).find((x) => x.className === 'dot');
  assert.deepEqual([dot.attrs.role, dot.attrs['aria-label']], ['img', 'Key refused']);
  assert.ok(!p.all().some((x) => /invalid api key/.test(String(x))), 'no upstream text');
  // A run refused for its key says so too, before any Test this session.
  const later = await open({ ai: { on: true }, conns: { openai: kept('openai') }, calls: [{ id: 'r', startedAt: 5, feature: 'writing', provider: 'openai', model: 'gpt-5', state: 'request-rejected', category: 'request-rejected', status: 403 }] });
  assert.equal(later.card('OpenAI').children[2].className, 'st bad');
  const fine = await open({ ai: { on: true }, conns: { openai: kept('openai') }, calls: [{ id: 'r', startedAt: 5, feature: 'writing', provider: 'openai', state: 'timeout', category: 'timeout' }] });
  assert.equal(fine.card('OpenAI').children[2].className, 'st ok', 'a timeout is no refused key');
});

test('Replace key keeps a new key in its place; Remove takes the connection and every model chosen on it', async () => {
  const p = await open({ ai: { on: true, model: { use: 'openai', model: 'gpt-5' }, models: { writing: { use: 'openai', model: 'gpt-5-mini' }, completion: { use: 'groq', model: 'llama-3.3-70b-versatile' } } },
    conns: { openai: kept('openai'), groq: kept('groq') } });
  await p.click(p.card('OpenAI'));
  await p.click(p.button('Replace key', p.$('ai-drawer')));
  assert.equal(p.doc.activeElement, p.$('ai-key'));
  assert.equal(p.$('ai-key').value, '', 'the kept key is never read back');
  p.$('ai-key').value = 'sk-other-1234567890';
  await p.click(p.button('Connect', p.$('ai-drawer')));
  assert.equal(p.vault.get('connections').openai.key, 'sk-other-1234567890');
  assert.notEqual(p.vault.get('connections').openai.generation, 'g-openai', 'a new key is a new generation');
  assert.ok(p.walk(p.$('ai-drawer')).some((x) => x.textContent === 'sk-o••••7890'));
  assert.ok(!p.all().some((x) => String(x).includes('sk-other-1234567890')));
  await p.click(p.button('Remove', p.$('ai-drawer')));
  assert.equal(p.vault.get('connections').openai, undefined);
  assert.deepEqual(p.data.ai.model, { use: null, model: '' });
  assert.deepEqual(p.data.ai.models, { completion: { use: 'groq', model: 'llama-3.3-70b-versatile' } });
  assert.equal(p.$('ai-fold').hidden, true);
  assert.equal(p.card('OpenAI').children[2].className, 'st');
});

test('a key being typed, and a search, keep their words and the focus when a call is recorded in another tab', async () => {
  const p = await open({ ai: { on: true }, conns: { openai: kept('openai') } });
  await p.click(p.card('Groq'));
  const field = p.$('ai-key');
  field.value = 'gsk_half-typ';
  await p.local.set({ aiCalls: [{ id: 'r', startedAt: 9, feature: 'writing', provider: 'openai', model: 'gpt-5', state: 'completed' }] }); await settle();
  assert.equal(p.$('ai-key'), field, 'the same field');
  assert.deepEqual([field.value, p.doc.activeElement], ['gsk_half-typ', field]);
  assert.equal(p.$('ai-calls').children.length, 1, 'the activity shows the call');
  await p.click('ai-pick-model');
  await p.click(p.side().find((b) => text(b) === 'OpenAI'));
  await p.type('ai-pick-search', 'gpt');
  const search = p.$('ai-pick-search');
  await p.local.set({ aiCalls: [] }); await settle();
  assert.deepEqual([p.$('ai-pick-search'), search.value, p.doc.activeElement], [search, 'gpt', search]);
});

test('a rejected save removes the submitted key from the page', async () => {
  const p = await open({ ai: { on: true }, save: false });
  await p.click(p.card('OpenAI'));
  p.$('ai-key').value = KEY;
  await p.click(p.button('Connect', p.$('ai-drawer')));
  assert.equal(p.walk(p.$('ai-drawer')).find((x) => x.className === 'err-t').textContent, 'Could not save. Try again.');
  assert.ok(!p.all().some((x) => String(x).includes(KEY)), 'the submitted key is no longer readable from an input');
  assert.equal(p.vault.size, 0);
});

test('the model picker lists each connected provider\'s catalog; search, arrows and Enter choose; Escape and a click outside close it', async () => {
  const p = await open({ ai: { on: true, features: { completion: true, writing: true } }, conns: { openai: kept('openai'), groq: kept('groq') } });
  assert.deepEqual(text(p.$('ai-pick-model')), 'Choose a model');
  assert.deepEqual([text(p.$('ai-pick-writing')), p.$('ai-pick-writing').className], ['Same as default', 'ai-pick same']);
  await p.click('ai-pick-model');
  assert.equal(p.picking(), 'model');
  assert.equal(p.$('ai-pick-model').attrs['aria-haspopup'], 'dialog');
  assert.deepEqual(p.side().map(text), ['Gemini Nano', 'OpenAI', 'Groq'], 'the overall model is always one: no "Same as default"');
  assert.equal(p.doc.activeElement, p.$('ai-pick-search'));
  await p.click(p.side()[1]);
  assert.deepEqual(p.options(), ['gpt-4.1', 'gpt-5', 'gpt-5-mini']);
  assert.equal(p.$('ai-pick-list').attrs.role, 'listbox');
  await p.type('ai-pick-search', 'mini');
  assert.deepEqual(p.options(), ['gpt-5-mini']);
  await p.key('ai-pick-search', 'ArrowDown');
  assert.equal(p.$('ai-pick-search').attrs['aria-activedescendant'], 'ai-opt-0');
  await p.key('ai-pick-search', 'Enter');
  assert.deepEqual(p.data.ai.model, { use: 'openai', model: 'gpt-5-mini' });
  assert.equal(p.picking(), undefined);
  assert.equal(p.doc.activeElement, p.$('ai-pick-model'), 'focus goes back to the button');
  assert.equal(text(p.$('ai-pick-model')), 'gpt-5-mini · OpenAI');
  // A feature on its own model, then back on the overall one.
  await p.click('ai-pick-completion');
  assert.equal(text(p.side()[0]), 'Same as default');
  await p.click(p.side().find((b) => text(b) === 'Groq'));
  await p.click(p.$('ai-pick-list').children.find((li) => text(li) === 'llama-3.3-70b-versatile'));
  assert.deepEqual(p.data.ai.models, { completion: { use: 'groq', model: 'llama-3.3-70b-versatile' } });
  assert.equal(text(p.$('ai-pick-completion')), 'llama-3.3-70b-versatile · Groq');
  assert.equal(text(p.$('ai-pick-writing')), 'Same as default');
  await p.click('ai-pick-completion');
  await p.key(p.walk(p.row('completion')).find((x) => x.className === 'ai-picker'), 'Escape');
  assert.equal(p.picking(), undefined);
  assert.equal(p.doc.activeElement, p.$('ai-pick-completion'));
  await p.click('ai-pick-completion');
  await p.outside();
  assert.equal(p.picking(), undefined, 'a click outside closes it');
  await p.click('ai-pick-completion');
  await p.click(p.side()[0]);
  assert.deepEqual(p.data.ai.models, {});
  // A search that finds nothing says so.
  await p.click('ai-pick-model');
  await p.type('ai-pick-search', 'zzz');
  assert.deepEqual(p.options(), ['No models']);
});

test('the model on this device is listed at once, and needs no model id', async () => {
  const device = async (m) => (m.op === 'set' ? { ok: true } : { ok: true, state: 'ready' });
  const p = await open({ ai: { on: true }, device });
  await p.click('ai-pick-model');
  assert.deepEqual(p.options(), ['Gemini Nano'], 'the picker opens on it, its one model there');
  await p.click(p.side()[0]);
  assert.deepEqual(p.options(), ['Gemini Nano']);
  await p.click(p.$('ai-pick-list').children[0]);
  assert.deepEqual(p.data.ai.model, { use: 'device', model: '' });
  assert.equal(text(p.$('ai-pick-model')), 'Gemini Nano');
  assert.equal(p.stops('model'), null, 'no effort to set');
});

test('the effort slider shows the levels a model takes, and hides for a model that takes none or isn\'t known', async () => {
  const server = async (url) => (url.startsWith('https://api.groq.com/') ? json({}, 500) : SERVERS(url));
  const p = await open({ ai: { on: true, model: { use: 'openai', model: 'gpt-5' }, models: { completion: { use: 'openai', model: 'gpt-4.1' }, writing: { use: 'groq', model: 'llama-3.3-70b-versatile' } }, features: { completion: true, writing: true } },
    conns: { openai: kept('openai'), groq: kept('groq') }, server });
  const stops = p.stops('model');
  assert.deepEqual(stops.map(text), ['Minimal', 'Low', 'Medium', 'High']);
  assert.ok(p.walk(p.row('model')).some((x) => x.className === 'ai-effort unset'), 'the task\'s own until the student sets one');
  assert.deepEqual(stops.map((b) => [b.attrs.role, b.attrs['aria-checked'], b.tabIndex]), [['radio', 'false', 0], ['radio', 'false', -1], ['radio', 'false', -1], ['radio', 'false', -1]]);
  assert.equal(p.walk(p.row('model')).find((x) => x.className.startsWith('ai-effort')).attrs.role, 'radiogroup');
  assert.equal(p.stops('completion'), null, 'gpt-4.1 takes no effort');
  assert.equal(p.stops('writing'), null, 'a catalog that didn\'t answer: not known, so hidden');
  assert.equal(p.stops('syllabus'), null, 'a feature on the overall model takes its effort, set on its row');
  await p.click(stops[1]);
  assert.deepEqual(p.data.ai.model, { use: 'openai', model: 'gpt-5', effort: 'low' });
  assert.equal(p.stops('model')[1].attrs['aria-checked'], 'true');
  assert.equal(p.doc.activeElement, p.$('ai-effort-model-low'));
  await p.key(p.stops('model')[1], 'ArrowRight');
  assert.equal(p.data.ai.model.effort, 'medium');
  await p.click(p.stops('model')[2]);
  assert.deepEqual(p.data.ai.model, { use: 'openai', model: 'gpt-5' }, 'the chosen level again gives the task its own');
  // Another model drops the effort, the same one keeps it.
  await p.click('ai-pick-model');
  await p.click(p.side().find((b) => text(b) === 'OpenAI'));
  await p.click(p.$('ai-pick-list').children.find((li) => text(li) === 'gpt-5-mini'));
  await p.click(p.stops('model')[3]);
  assert.deepEqual(p.data.ai.model, { use: 'openai', model: 'gpt-5-mini', effort: 'high' });
  await p.click('ai-pick-model');
  await p.click(p.$('ai-pick-list').children.find((li) => text(li) === 'gpt-5-mini'));
  assert.equal(p.data.ai.model.effort, 'high', 'the same model keeps its effort');
  await p.click('ai-pick-model');
  await p.click(p.$('ai-pick-list').children.find((li) => text(li) === 'gpt-5'));
  assert.deepEqual(p.data.ai.model, { use: 'openai', model: 'gpt-5' }, 'another model drops it');
});

test('Advanced adds an endpoint of the student\'s own: its name, address and key, Ollama\'s address a click away', async () => {
  const p = await open({ ai: { on: true } });
  assert.equal(p.button('Endpoint', p.$('ai-providers')), undefined);
  await p.change('ai-mode-advanced', true);
  await p.click(p.card('Endpoint'));
  for (const id of ['ai-ep-name', 'ai-ep-base', 'ai-ep-key']) assert.equal(p.$(id).tagName, 'INPUT', id);
  assert.equal(p.$('ai-ep-key').type, 'password');
  assert.equal(p.$('ai-ep-base').attrs['aria-label'], 'Address');
  // An address that is no endpoint is refused before any prompt.
  await p.type('ai-ep-base', 'ftp://example.com');
  await p.click(p.button('Save', p.$('ai-drawer')));
  assert.deepEqual(p.asked, []);
  assert.equal(p.walk(p.$('ai-drawer')).find((x) => x.className === 'err-t').textContent, 'Use an https address, or http on localhost or 127.0.0.1.');
  assert.equal(p.doc.activeElement, p.$('ai-ep-base'));
  assert.equal(p.$('ai-ep-base').value, 'ftp://example.com', 'what was typed stays to be corrected');
  await p.click(p.button('Ollama', p.$('ai-drawer')));
  assert.deepEqual([p.$('ai-ep-name').value, p.$('ai-ep-base').value], ['Ollama', 'http://localhost:11434/v1']);
  await p.click(p.button('Save', p.$('ai-drawer')));
  assert.deepEqual(p.asked, [[['http://localhost/*'], true]]);
  assert.deepEqual(p.sent.find((m) => m.op === 'set'), { type: 'glaze:ai-config', op: 'set', id: 'custom-1', cfg: { provider: 'openai', name: 'Ollama', base: 'http://localhost:11434/v1', key: '' } });
  assert.deepEqual(p.cards().slice(-2), ['Ollama', 'Endpoint']);
  assert.equal(p.card('Ollama').attrs['aria-expanded'], 'true', 'its drawer stays open');
  assert.ok(text(p.$('ai-drawer')).includes('3 models'));
  // Its key: kept masked, left masked kept, emptied removed.
  p.$('ai-ep-key').value = KEY;
  await p.click(p.button('Save', p.$('ai-drawer')));
  assert.equal(p.vault.get('connections')['custom-1'].key, KEY);
  assert.equal(p.$('ai-ep-key').value, MASKED);
  await p.click(p.button('Save', p.$('ai-drawer')));
  assert.equal(Object.hasOwn(p.sent.filter((m) => m.op === 'set').at(-1).cfg, 'key'), false, 'the masked key is not sent back');
  assert.equal(p.vault.get('connections')['custom-1'].key, KEY);
  p.$('ai-ep-key').value = '';
  await p.click(p.button('Save', p.$('ai-drawer')));
  assert.equal(p.vault.get('connections')['custom-1'].key, undefined);
  assert.ok(!p.all().some((x) => String(x).includes(KEY)));
  // It is a provider in every picker, and Simple hides it.
  await p.click('ai-pick-model');
  assert.ok(p.side().map(text).includes('Ollama'));
  await p.key(p.walk(p.row('model')).find((x) => x.className === 'ai-picker'), 'Escape');
  await p.change('ai-mode-simple', true);
  assert.ok(!p.cards().includes('Ollama'));
  assert.equal(p.$('ai-fold').hidden, true);
  // A second endpoint takes the next id, named by its host when unnamed.
  await p.change('ai-mode-advanced', true);
  await p.click(p.card('Endpoint'));
  p.$('ai-ep-base').value = 'https://llm.example.edu/v1';
  await p.click(p.button('Save', p.$('ai-drawer')));
  assert.deepEqual(p.sent.filter((m) => m.op === 'set').at(-1).cfg, { provider: 'openai', name: 'llm.example.edu', base: 'https://llm.example.edu/v1', key: '' });
  assert.equal(p.sent.filter((m) => m.op === 'set').at(-1).id, 'custom-2');
});

test('Advanced\'s tuning: each feature\'s sliders at its task\'s own until moved, the pause the gray text\'s alone, Reset; Simple shows none and keeps them', async () => {
  const p = await open({ ai: { on: true, mode: 'advanced', model: { use: 'openai', model: 'gpt-5' }, features: { completion: true } }, conns: { openai: kept('openai') } });
  assert.equal(p.walk(p.row('model')).some((x) => x.className === 'ai-tune'), false, 'the overall model has no tuning of its own');
  const ranges = (row) => p.walk(p.row(row)).filter((x) => x.type === 'range').map((x) => x.id);
  assert.deepEqual(ranges('completion'), ['ai-tune-completion-temperature', 'ai-tune-completion-maxTokens', 'ai-tune-completion-context', 'ai-tune-completion-timeoutMs', 'ai-tune-completion-pause']);
  assert.deepEqual(ranges('writing'), ['ai-tune-writing-temperature', 'ai-tune-writing-maxTokens', 'ai-tune-writing-context', 'ai-tune-writing-timeoutMs']);
  const temp = p.$('ai-tune-completion-temperature');
  assert.deepEqual([temp.attrs['aria-valuetext'], temp.classList.contains('unset')], ['Default', true]);
  temp.value = '2';
  await p.fire(temp, 'change'); await settle();
  p.$('ai-tune-completion-pause').value = '5';
  await p.fire('ai-tune-completion-pause', 'change'); await settle();
  assert.deepEqual(p.data.ai.tune, { completion: { temperature: 0.2, pause: 350 } });
  assert.equal(p.$('ai-tune-completion-temperature').attrs['aria-valuetext'], '0.2');
  assert.equal(p.$('ai-tune-completion-pause').attrs['aria-valuetext'], '350 ms');
  const reset = p.button('Reset', p.row('completion'));
  assert.equal(reset.disabled, false);
  assert.equal(p.button('Reset', p.row('writing')).disabled, true);
  await p.change('ai-mode-simple', true);
  assert.equal(p.walk(p.$('ai-feature-list')).some((x) => x.className === 'ai-tune'), false);
  assert.deepEqual(p.data.ai.tune, { completion: { temperature: 0.2, pause: 350 } }, 'kept for Advanced');
  await p.change('ai-mode-advanced', true);
  await p.click(p.button('Reset', p.row('completion')));
  assert.deepEqual(p.data.ai.tune, {});
});

test('the owner\'s older endpoint shows as OpenRouter connected with its key, its model the overall one, the features as they were', async () => {
  const routed = read('test/fixtures/openrouter-models.json');
  const server = async (url) => (url === M.OPENROUTER ? new Response(routed, { headers: { 'content-type': 'application/json' } }) : json({ data: { label: 'x' } }));
  const p = await open({ ai: { on: true, use: 'endpoint', features: { syllabus: true, completion: true, writing: true } }, server,
    conns: { endpoint: { provider: 'openai', base: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v4.1-flash-1017', key: OWNER, generation: 'g-1' } } });
  assert.deepEqual(p.data.ai, { on: true, mode: 'simple', model: { use: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017' }, models: {}, tune: {}, features: { syllabus: true, completion: true, writing: true } });
  assert.deepEqual(p.vault.get('connections'), { openrouter: { provider: 'openai', base: 'https://openrouter.ai/api/v1', key: OWNER, generation: 'g-1' } });
  assert.equal(p.card('OpenRouter').children[2].className, 'st ok');
  assert.equal(text(p.$('ai-pick-model')), 'DeepSeek: DeepSeek V4.1 Flash 1017 · OpenRouter');
  assert.deepEqual(p.stops('model').map(text), ['Off', 'Low', 'High'], 'the efforts its catalog lists');
  assert.deepEqual(AS.FEATURES.map((f) => text(p.$(`ai-pick-${f}`))), ['Same as default', 'Same as default', 'Same as default']);
  assert.ok(!p.all().some((x) => String(x).includes(OWNER)));
  await p.click(p.card('OpenRouter'));
  assert.ok(p.walk(p.$('ai-drawer')).some((x) => x.textContent === 'sk-o••••0000'));
});

test('on this device: its status from the worker, a download the student starts, its progress, and why it can\'t run', async () => {
  let state = 'download';
  const device = async (m) => (m.op === 'set' ? { ok: true } : ['test', 'prepare'].includes(m.op) ? { ok: true, state, ...(state === 'unavailable' && { reason: 'browser' }) } : { ok: false, error: 'op' });
  const p = await open({ ai: { on: true }, device });
  const note = () => p.walk(p.$('ai-drawer')).find((x) => x.className === 'note');
  await p.click(p.card('Gemini Nano'));
  assert.deepEqual(p.sent.filter((m) => m.id === 'device' || m.provider === 'device').map((m) => m.op), ['set', 'test']);
  assert.deepEqual([note().textContent, note().attrs.role], ['Needs a download', 'status']);
  state = 'downloading';
  await p.click(p.button('Download', p.$('ai-drawer')));
  assert.deepEqual(p.sent.find((m) => m.op === 'prepare'), { type: 'glaze:ai-config', op: 'prepare', provider: 'device' });
  assert.equal(p.button('Download', p.$('ai-drawer')), undefined);
  await p.progress({ loaded: 0.42 });
  const bar = () => p.walk(p.$('ai-drawer')).find((x) => x.tagName === 'PROGRESS');
  assert.equal(note().textContent, '42%');
  assert.equal(bar().value, 0.42);
  assert.equal(bar().attrs['aria-label'], 'Gemini Nano');
  assert.deepEqual([p.card('Gemini Nano').children[2].textContent, p.card('Gemini Nano').children[3].className], ['42%', 'bar']);
  await p.progress({ loaded: 0.9 }, { id: 'someone-else' });
  assert.equal(bar().value, 0.42, 'only Glaze\'s own messages');
  await p.progress({ loaded: 50, total: 100 });
  assert.equal(note().textContent, '50%');
  state = 'ready';
  await p.progress({ loaded: 1 });
  assert.equal(note().textContent, 'Ready');
  assert.equal(bar(), undefined);
  assert.equal(p.card('Gemini Nano').children[2].className, 'st ok');
});

test('the shipped device provider drives progress and completion through the real broker', async () => {
  let finish, notify;
  globalThis.LanguageModel = {
    availability: async () => 'downloadable',
    create: ({ monitor }) => {
      monitor({ addEventListener: (name, f) => { notify = f; }, removeEventListener() {} });
      return new Promise((r) => { finish = () => r({ contextWindow: 4096, destroy() {} }); });
    },
  };
  try {
    const p = await open({ ai: { on: true } });
    await p.click(p.card('Gemini Nano'));
    assert.equal(p.vault.get('connections').device.provider, 'device');
    await p.click(p.button('Download', p.$('ai-drawer')));
    notify({ loaded: 0.42 }); await settle();
    const note = () => p.walk(p.$('ai-drawer')).find((x) => x.className === 'note');
    assert.equal(note().textContent, '42%');
    finish(); await settle();
    assert.equal(note().textContent, 'Ready', 'prepare is authoritative even if availability lags');
  } finally { finish?.(); await settle(); delete globalThis.LanguageModel; D._reset(); }
});

test('activation keeps Download available and retries prepare directly from the next click', async () => {
  let attempts = 0;
  const p = await open({ ai: { on: true, model: { use: 'device' } }, device: async (m, gesture) => {
    if (m.op === 'prepare') {
      assert.equal(gesture, true, 'prepare is dispatched before yielding the click');
      return ++attempts === 1 ? { ok: true, state: 'download', reason: 'activation' } : { ok: true, state: 'ready' };
    }
    return m.op === 'set' ? { ok: true } : { ok: true, state: 'download' };
  } });
  await p.click(p.card('Gemini Nano'));
  await p.click(p.button('Download', p.$('ai-drawer')));
  const note = () => p.walk(p.$('ai-drawer')).find((x) => x.className === 'note');
  assert.equal(note().textContent, 'Click Download to continue');
  await p.click(p.button('Download', p.$('ai-drawer')));
  assert.equal(attempts, 2);
  assert.equal(note().textContent, 'Ready');
});

test('a device that can\'t run says why: the browser, the hardware, a timeout', async () => {
  const p = await open({ ai: { on: true, model: { use: 'device' } } });
  await p.click(p.card('Gemini Nano'));
  assert.equal(p.walk(p.$('ai-drawer')).find((x) => x.className === 'note').textContent, 'Not available in this browser');
  for (const [reason, said] of [['device', 'Not available on this device'], ['timeout', 'Not available: Timed out']]) {
    const q = await open({ ai: { on: true, model: { use: 'device' } }, device: async (m) => (m.op === 'set' ? { ok: true } : { ok: true, state: 'unavailable', reason }) });
    await q.click(q.card('Gemini Nano'));
    assert.equal(q.walk(q.$('ai-drawer')).find((x) => x.className === 'note').textContent, said);
    assert.equal(q.button('Download', q.$('ai-drawer')), undefined);
  }
});

test('On this device is one card: Apple Intelligence on a Mac that has it, Gemini Nano elsewhere', async () => {
  const markup = read('options.html') + read('lib/editor-ai.js');
  assert.doesNotMatch(markup, /ai-use-apple|ai-choice-apple|id="ai-apple/, 'no separate Apple choice');
  let st = { state: 'ready' };
  const mac = await open({ ai: { on: true, model: { use: 'device' } }, providers: ['openai', 'device', 'apple'], device: async (m) => (m.op === 'set' ? { ok: true } : { ok: true, ...st, provider: 'apple' }) });
  assert.equal(mac.cards()[0], 'Apple Intelligence');
  assert.equal(text(mac.$('ai-pick-model')), 'Apple Intelligence');
  await mac.click(mac.card('Apple Intelligence'));
  assert.equal(mac.walk(mac.$('ai-drawer')).find((x) => x.className === 'note').textContent, 'Ready');
  st = { state: 'unavailable', reason: 'off' };
  await mac.click(mac.card('Apple Intelligence')); await mac.click(mac.card('Apple Intelligence'));
  assert.equal(mac.walk(mac.$('ai-drawer')).find((x) => x.className === 'note').textContent, 'Apple Intelligence is off');
  st = { state: 'download' };
  await mac.click(mac.card('Apple Intelligence')); await mac.click(mac.card('Apple Intelligence'));
  assert.equal(mac.button('Download', mac.$('ai-drawer')), undefined, 'nothing to download from here');
  // Safari without Apple Intelligence on this Mac: the browser's model, if it has one.
  const other = await open({ ai: { on: true, model: { use: 'device' } }, providers: ['openai', 'device', 'apple'], device: async (m) => (m.op === 'set' ? { ok: true } : { ok: true, state: 'download', provider: 'device' }) });
  assert.equal(other.cards()[0], 'Gemini Nano');
  const t = (k, v) => I.t(k, v, 'en'), E = require('../lib/editor-ai.js');
  assert.equal(E.appleText({ state: 'unavailable', reason: 'os' }, t), 'Not available on this device');
  assert.equal(E.appleText({ state: 'unavailable', reason: 'native' }, t), 'Not available: Not ready');
  assert.equal(E.providerName('apple', t), 'Apple Intelligence');
  assert.equal(AS.clean({ on: true, use: 'apple' }).model.use, 'device', 'a saved Apple Intelligence choice is On this device now');
});

test('activity: the recent calls, newest first, feature · provider · model, metadata only, and Clear', async () => {
  const calls = [
    { id: 'r1', task: 'syllabus.read', feature: 'syllabus', provider: 'openai', state: 'completed', startedAt: 1000, ms: 900, usage: { input: 1200, output: 34 }, prompt: 'secret words', key: KEY, base: 'https://api.example.com' },
    { id: 'r2', task: 'syllabus.read', feature: 'syllabus', provider: 'device', state: 'request-rejected', category: 'request-rejected', status: 400, startedAt: 2000 },
    { id: 'r3', task: 'writer.feedback', feature: 'writing', provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', state: 'completed', startedAt: 3000, ms: 1, count: 12 },
    { id: 'r4', task: 'writer.complete', feature: 'completion', provider: 'custom-1', model: 'qwen2.5-coder:7b', state: 'timeout', category: 'timeout', startedAt: 4000 },
  ];
  const p = await open({ calls, conns: { 'custom-1': { provider: 'openai', name: 'Ollama', base: 'http://localhost:11434/v1', generation: 'g' } } });
  assert.ok(shown(p.$('ai-activity')), 'a record shows with AI off too, so it can be cleared');
  const lines = p.$('ai-calls').children.map((li) => li.children.map((x) => x.textContent).join(' | '));
  assert.deepEqual(lines, ['Tab completion · Ollama · qwen2.5-coder:7b | @4000 · Timed out', 'Feedback · OpenRouter · deepseek/deepseek-v4.1-flash-1017 | @3000 · ×12 · Done',
    'Syllabus import · Gemini Nano | @2000 · Refused (HTTP 400)', 'Syllabus import · Endpoint | @1000 · 1,234 tokens · Done']);
  assert.ok(p.$('ai-calls').children[0].children[1].classList.contains('bad'), 'a failure stands out');
  assert.ok(!p.all().some((x) => /secret words|api\.example\.com|localhost|sk-live/.test(String(x))), 'nothing but metadata');
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
  // The page's own ids once each; the ones the editor draws, never in the page.
  const drawn = new Set([...js.matchAll(/\bid: '([\w-]+)'|\.id = '([\w-]+)'/g)].map((m) => m[1] || m[2]));
  const used = new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]).filter((id) => !drawn.has(id)));
  assert.ok(used.size >= 14, String([...used]));
  for (const id of used) assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
  for (const id of drawn) assert.equal(html.split(`id="${id}"`).length - 1, 0, id);
  const order = ['lib/site.js', 'lib/ai/settings.js', 'lib/ai/endpoint.js', 'lib/editor-ai.js', 'options.js'].map((f) => html.indexOf(`<script src="${f}"></script>`));
  assert.ok(order.every((i) => i > 0) && order.every((i, k) => !k || i > order[k - 1]), String(order));
  const panel = html.slice(html.indexOf('<div id="panel-ai"'), html.indexOf('<div id="panel-backup"'));
  for (const [, tag] of panel.matchAll(/(<input[^>]*>)/g)) assert.match(tag, /data-local/, tag);
  assert.match(panel, /id="ai-said" role="status" aria-live="polite"/);
  assert.match(panel, /class="seg ai-mode" id="ai-mode" role="radiogroup" aria-labelledby="heading-ai-setup"/);
  assert.match(panel, /id="ai-providers" role="group" aria-labelledby="ai-providers-head"/);
  // Keys are typed hidden and kept left to right; the address too.
  assert.equal((js.match(/type: 'password'/g) || []).length, 2);
  assert.ok((js.match(/setAttribute\('dir', 'ltr'\)/g) || []).length >= 4);
  // Quick and plain motion: none where the student or the system asks for less.
  const css = html.slice(html.indexOf('/* Settings → AI'), html.indexOf('.site-add {'));
  for (const sel of [/html\[data-gz-motion="off"\] :is\(\.ai-fold, \.ai-picker, \.ai-tune \.g\) \{ animation: none; \}/, /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.ai-prov, \.ai-prov \.bar i, \.ai-effort \.fill, \.ai-effort \.thumb \{ transition: none; \}/]) assert.match(css, sel);
  // Words reach the page as text only.
  for (const word of ['innerHTML', 'outerHTML', 'insertAdjacentHTML']) assert.ok(!js.includes(word), word);
});

test('every word of Settings → AI is in every language', () => {
  const html = read('options.html'), js = read('lib/editor-ai.js').replace(/\/\/[^\n]*/g, '');
  const panel = html.slice(html.indexOf('<div id="panel-ai"'), html.indexOf('<div id="panel-backup"'));
  const fromHtml = [...panel.replace(/<(\w+)[^>]*translate="no"[^>]*>[\s\S]*?<\/\1>/g, '').matchAll(/>([^<]+)</g)].map((m) => m[1].replace(/\s+/g, ' ').trim()).filter((s) => /\p{L}/u.test(s));
  const fromJs = [...js.matchAll(/\bt\('((?:\\.|[^'\\])*)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  const words = new Set([...fromHtml, ...fromJs, 'AI', 'Use AI']);
  assert.ok(words.size > 60, `${words.size} words`);
  for (const [lang, cat] of Object.entries(globalThis.GZ_LANGS)) for (const w of words) assert.ok(w in cat, `${lang}: "${w}"`);
  assert.equal(I.t('{n} tokens', { n: 1 }), '1 token');
  assert.equal(I.t('{n} models', { n: 1 }), '1 model');
  assert.equal(I.t('{n} models', { n: 3 }), '3 models');
  assert.equal(I.t('{n} models', { n: 1 }, 'de'), '1 Modell');
});

test('the helpers: a download\'s progress, the record\'s rows, a refused key and the tuning\'s words', () => {
  const E = require('../lib/editor-ai.js'), t = (k, v) => I.t(k, v, 'en');
  assert.equal(E.progress({ loaded: 0.5 }), 0.5);
  assert.equal(E.progress({ loaded: 30, total: 60 }), 0.5);
  assert.equal(E.progress({ progress: 2 }), 1);
  assert.equal(E.progress({}), null);
  assert.deepEqual(E.rows([null, { startedAt: 'x' }, { id: 'a', startedAt: 5, feature: 'syllabus', provider: 'openrouter', model: 'm/1', state: 'completed', prompt: 'no' }]),
    [{ at: 5, feature: 'syllabus', provider: 'openrouter', model: 'm/1', state: 'completed', reference: 'a' }]);
  assert.equal(E.refused([{ startedAt: 2, provider: 'groq', state: 'completed' }, { startedAt: 1, provider: 'groq', category: 'request-rejected', status: 401 }], 'groq'), false, 'its newest run went through');
  assert.equal(E.refused([{ startedAt: 1, provider: 'groq', category: 'request-rejected', status: 401 }], 'groq'), true);
  assert.equal(E.refused([{ startedAt: 1, provider: 'groq', category: 'request-rejected', status: 400 }], 'groq'), false, 'a refused request is no refused key');
  assert.deepEqual([E.tuneText('temperature', 0.2, t), E.tuneText('maxTokens', 4096, t), E.tuneText('context', 32000, t), E.tuneText('context', 1000000, t), E.tuneText('timeoutMs', 4000, t), E.tuneText('pause', 350, t)],
    ['0.2', '4,096', '32K', '1M', '4 s', '350 ms']);
  assert.deepEqual(AS.EFFORTS.map((e) => E.effortName(e, t)), ['Off', 'Minimal', 'Low', 'Medium', 'High']);
  assert.deepEqual(Object.keys(E.CARDS), Object.keys(AS.PRESETS), 'a card for every provider Glaze knows by name');
  for (const [k, stops] of Object.entries(E.STOPS)) for (const v of stops) assert.ok(v >= AS.TUNE[k][0] && v <= AS.TUNE[k][1], `${k} ${v}`);
});

for (const op of ['get', 'set']) test(`a failed Settings ${op} is reported and later changes still save`, async () => {
  const p = await open({ ai: { on: false, model: { use: 'openai', model: 'gpt-5' } } });
  const original = p.local[op];
  p.local[op] = async () => { p.local[op] = original; throw Error('synthetic storage failure'); };
  p.$('ai-on').checked = true;
  await assert.doesNotReject(p.fire('ai-on', 'change'));
  await settle();
  assert.deepEqual([p.$('ai-said').textContent, p.$('ai-said').hidden], ['Could not save. Try again.', false]);
  assert.equal(p.$('ai-on').checked, false, 'the failed change does not look saved');
  await p.change('ai-on', true);
  await p.change('ai-feature-writing', true);
  assert.equal(p.data.ai.on, true);
  assert.equal(p.data.ai.features.writing, true, 'a failed write never poisons the queue');
  assert.equal(p.$('ai-said').hidden, true, 'a later save clears it');
});

test('two Settings tabs preserve simultaneous feature changes in the same extension origin', async () => {
  const shared = { data: { ai: { on: true, model: { use: 'openai', model: 'gpt-5' } } }, listeners: [] };
  let turn = Promise.resolve();
  const locks = { request: (name, save) => { assert.equal(name, 'glaze:ai-settings'); const next = turn.then(save); turn = next.catch(() => {}); return next; } };
  const a = await open({ shared, locks }), b = await open({ shared, locks });
  const first = a.$('ai-feature-syllabus'), last = b.$('ai-feature-writing');
  first.checked = true; last.checked = true;
  a.fire(first, 'change'); b.fire(last, 'change');
  await settle();
  assert.deepEqual(shared.data.ai.features, { syllabus: true, completion: false, writing: true });
  assert.equal(a.$('ai-feature-syllabus').checked, true); assert.equal(b.$('ai-feature-writing').checked, true);
});


test('saving a changed endpoint refreshes its picker catalog and drops its previous test result', async () => {
  const p = await open({ ai: { on: true, mode: 'advanced', model: { use: 'custom-1', model: 'old-model' } },
    conns: { 'custom-1': { provider: 'openai', name: 'Local', base: 'https://old.example/v1', generation: 'old' } },
    server: async (url) => listing(url.startsWith('https://old.example/') ? ['old-model'] : ['new-model']) });
  await p.click(p.card('Local'));
  await p.type('ai-ep-base', 'https://new.example/v1');
  await p.click(p.button('Save', p.$('ai-drawer')));
  await p.click('ai-pick-model');
  await p.click(p.side().find((b) => text(b) === 'Local'));
  assert.deepEqual(p.options(), ['new-model'], 'the previous address must not supply the new address\'s models');
  assert.ok(p.fetched.some(([url]) => url === 'https://new.example/v1/models'));
});


test('Same as default returns keyboard focus to the feature model button', async () => {
  const p = await open({ ai: { on: true, model: { use: 'openai', model: 'gpt-5' }, models: { writing: { use: 'openai', model: 'gpt-4.1' } } }, conns: { openai: kept('openai') } });
  await p.click('ai-pick-writing');
  const same = p.side()[0];
  same.focus();
  await p.click(same);
  assert.deepEqual(p.data.ai.models, {});
  assert.equal(p.doc.activeElement, p.$('ai-pick-writing'));
});


test('device progress preserves a key being typed in another provider drawer', async () => {
  const p = await open({ ai: { on: true } });
  await p.click(p.card('Groq'));
  const field = p.$('ai-key');
  await p.type(field, 'gsk_partially-typed');
  field.focus();
  await p.progress({ loaded: 0.42 });
  assert.equal(p.$('ai-key'), field, 'unrelated device progress must not replace the key field');
  assert.equal(field.value, 'gsk_partially-typed');
  assert.equal(p.doc.activeElement, field);
});
