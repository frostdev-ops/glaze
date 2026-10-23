// The hosts a Look's media and a mod reach, asked for in the click that adds them (lib/site.js reach, from Glaze's own pages):
// the editor's mod install prompt (its network:<host> permissions and a remote background's host), a network permission
// switched on later, a channel on a relay of one's own, and Gradescope's switch in Settings. Held already, the browser says
// yes without a prompt; refused, nothing is added. chrome.permissions is stood in: a headless browser can't answer its prompt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/modbundle.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const t = (k, vars = {}) => k.replace(/\{(\w+)\}/g, (s, n) => (n in vars ? String(vars[n]) : s));
const AUTHOR = { kty: 'OKP', crv: 'Ed25519', d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' };
const u8 = (s) => new TextEncoder().encode(s);

// lib/site.js's reach in a page of Glaze's: what the browser was asked, whether inside a click, and what it answers.
const pageChrome = ({ answer = () => true, manifest = { host_permissions: ['https://frostdev.io/*', 'https://share.frostdev.io/*'] }, respond = async () => ({ ok: true }), list = [] } = {}) => {
  const asked = [], sent = [], state = { active: false };
  const chrome = {
    runtime: { id: 'glaze', getManifest: () => manifest, lastError: null,
      sendMessage: async (m) => { sent.push(m); return m.op === 'list' ? { ok: true, mods: list } : respond(m); } },
    permissions: { request: (o) => { asked.push([[...o.origins], state.active]); return Promise.resolve(answer(o.origins)); } },
  };
  return { chrome, asked, sent, state };
};

test('reach: one request for every host, inside the click, the worker told first; Safari\'s every-site manifest asks nothing', async () => {
  const p = pageChrome();
  const g = vm.createContext({ chrome: p.chrome, URL, Promise, console });
  vm.runInContext(read('lib/site.js'), g);
  p.state.active = true;
  const r = g.GZ_SITE.reach(['https://api.weather.gov/points', 'https://media.example/a.webm', 'https://api.weather.gov/x']);
  p.state.active = false;
  assert.equal(await r, true);
  assert.deepEqual(p.asked, [[['https://api.weather.gov/*', 'https://media.example/*'], true]]);
  assert.deepEqual(p.sent.map((m) => [m.type, m.op, m.origin]), [['glaze:allow', 'ask', 'https://api.weather.gov'], ['glaze:allow', 'ask', 'https://media.example']],
    'the worker hears they are a feature\'s hosts, not schools to look at');
  // Refused, or the browser threw (no gesture): no.
  for (const answer of [() => false, () => { throw new Error('This function must be called during a user gesture'); }]) {
    const q = pageChrome({ answer });
    const h = vm.createContext({ chrome: q.chrome, URL, Promise, console });
    vm.runInContext(read('lib/site.js'), h);
    assert.equal(await h.GZ_SITE.reach(['https://api.weather.gov/']), false);
  }
  // Local hosts by their portless pattern; anything else is no host to ask for.
  const l = pageChrome();
  const lg = vm.createContext({ chrome: l.chrome, URL, Promise, console });
  vm.runInContext(read('lib/site.js'), lg);
  assert.equal(await lg.GZ_SITE.reach(['http://localhost:8787/j']), true);
  assert.deepEqual(l.asked, [[['http://localhost/*'], false]]);
  for (const bad of [['http://school.example/'], ['ftp://x.example/'], ['nonsense'], []]) assert.equal(await lg.GZ_SITE.reach(bad), bad.length === 0, String(bad));
  assert.equal(l.asked.length, 1);
  // Safari keeps <all_urls>: nothing to ask.
  const s = pageChrome({ manifest: { host_permissions: ['<all_urls>'] } });
  const sg = vm.createContext({ chrome: s.chrome, URL, Promise, console });
  vm.runInContext(read('lib/site.js'), sg);
  assert.equal(await sg.GZ_SITE.reach(['https://api.weather.gov/']), true);
  assert.deepEqual(s.asked, []);
});

// ---- the editor's Mods tab -----------------------------------------------------------------------------------------------
const el = (doc) => ({ children: [], attrs: {}, dataset: {}, listeners: {}, onchange: null, onclick: null, checked: false, disabled: false, hidden: false, textContent: '', className: '', value: '', open: false,
  classList: { toggle() {} }, addEventListener(type, f) { (this.listeners[type] ||= []).push(f); }, fire(type, e = {}) { for (const f of this.listeners[type] || []) f({ isTrusted: true, preventDefault() {}, target: this, ...e }); },
  append(...k) { this.children.push(...k); }, replaceChildren(...k) { this.children = k; }, prepend() {}, remove() {}, click() { this.fire('click'); },
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'data-f') this.dataset.f = v; }, contains(e) { return this === e || this.children.some((c) => c?.contains?.(e)); },
  focus() { doc.activeElement = this; }, showModal() { this.open = true; }, close() { this.open = false; this.fire('close'); } });
const editor = (chromeRig, data = {}) => {
  const ids = new Map();
  const document = { activeElement: null, querySelector: () => null };
  document.createElement = () => el(document);
  document.getElementById = (id) => { if (!ids.has(id)) ids.set(id, el(document)); return ids.get(id); };
  const local = { get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => Object.hasOwn(data, x)).map((x) => [x, data[x]]))), set: async (p) => { Object.assign(data, p); }, remove: async () => {} };
  const chrome = { ...chromeRig.chrome, storage: { local, onChanged: { addListener() {} } } };
  chrome.runtime.getManifest = ((m) => () => ({ ...m(), sandbox: {} }))(chrome.runtime.getManifest);
  const ctx = vm.createContext({ chrome, document, URL, Promise, console, TextEncoder, TextDecoder, crypto: globalThis.crypto, Uint8Array, atob, btoa, Blob, structuredClone,
    requestAnimationFrame: (f) => f(), confirm: () => true, GZ_MODBUNDLE: M, GZ_XPARTS: require('../lib/lookparts.js'), GZ_MODAPI: require('../lib/modapi.js') });
  vm.runInContext(read('lib/site.js'), ctx);
  vm.runInContext(read('lib/editor-mods.js'), ctx);
  ctx.GZ_MODSEDIT.mount({ t, and: (a) => a.join(' and '), when: String, show() {} });
  const $ = (id) => document.getElementById(id);
  // A .glazemod file opened: the prompt comes up. Install clicked inside the browser's activation, then the dialog closes.
  const open = async (bytes) => { $('mod-file').fire('change', { target: { files: [{ size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }], value: '' } }); await settle(); };
  const install = async () => {
    chromeRig.state.active = true;
    $('mod-prompt-install').fire('click');
    chromeRig.state.active = false;
    $('mod-prompt').close();
    await settle();
  };
  return { $, open, install, ctx };
};
const bundle = (manifest) => M.pack({ 'hooks.js': u8('glaze.ready;\n') }, { glaze: 1, name: 'Weather', version: '1.0.0', author: { name: 'Kai' }, hooks: 'hooks.js', ...manifest }, AUTHOR).then((r) => r.bytes);
const installs = (rig) => rig.sent.filter((m) => m.type === 'glaze:mods' && m.op === 'install');

test('mod install: its network hosts and a remote background\'s host are asked for in the Install click; granted, it installs', async () => {
  const rig = pageChrome();
  const e = editor(rig);
  await e.open(await bundle({ permissions: [{ id: 'network:api.weather.gov', why: 'Rain' }], parts: { bg: { media: { type: 'video', src: 'https://media.example/rain.webm' } } } }));
  assert.equal(e.$('mod-prompt').open, true, 'the prompt is up');
  assert.deepEqual(rig.asked, [], 'nothing asked before Install');
  await e.install();
  assert.deepEqual(rig.asked, [[['https://api.weather.gov/*', 'https://media.example/*'], true]]);
  assert.equal(installs(rig).length, 1);
  assert.deepEqual(installs(rig)[0].grants, ['network:api.weather.gov']);
});

test('mod install: refused, the mod isn\'t installed, and the editor says it couldn\'t', async () => {
  const rig = pageChrome({ answer: () => false });
  const e = editor(rig);
  await e.open(await bundle({ permissions: [{ id: 'network:api.weather.gov', why: 'Rain' }] }));
  await e.install();
  assert.equal(rig.asked.length, 1);
  assert.deepEqual(installs(rig), []);
  assert.equal(e.$('mods-said').textContent, 'Glaze couldn’t do that.');
});

test('mod install: a mod that reaches no host asks the browser nothing; Cancel asks nothing either', async () => {
  const rig = pageChrome();
  const e = editor(rig);
  await e.open(await bundle({}));
  await e.install();
  assert.deepEqual(rig.asked, []);
  assert.equal(installs(rig).length, 1);
  const c = pageChrome();
  const f = editor(c);
  await f.open(await bundle({ permissions: [{ id: 'network:api.weather.gov', why: 'Rain' }] }));
  f.$('mod-prompt').close();
  await settle();
  assert.deepEqual(c.asked, []);
  assert.deepEqual(installs(c), []);
});

test('a network permission switched on later is asked for in its click; refused, it stays off', async () => {
  const manifest = { glaze: 1, name: 'Weather', version: '1.0.0', author: { name: 'Kai', key: 'k'.repeat(43) }, hooks: 'h.js', permissions: [{ id: 'network:api.weather.gov', why: 'Rain' }] };
  const record = { id: 'abcdefghijklmnop', enabled: true, manifest, prompt: M.prompt(manifest), grants: {} };
  for (const yes of [true, false]) {
    const rig = pageChrome({ answer: () => yes, list: [record] });
    const e = editor(rig);
    await settle();
    const find = (f, n = e.$('mods-list')) => (n?.dataset?.f === f ? n : n?.children?.map((c) => find(f, c)).find(Boolean));
    const box = find('abcdefghijklmnop:perm:network:api.weather.gov');
    box.checked = true;
    rig.state.active = true;
    box.onchange({ target: box, isTrusted: true });
    rig.state.active = false;
    await settle();
    assert.deepEqual(rig.asked, [[['https://api.weather.gov/*'], true]]);
    assert.equal(rig.sent.filter((m) => m.op === 'grant').length, yes ? 1 : 0, `granted: ${yes}`);
    if (!yes) assert.equal(box.checked, false);
  }
});

test('a mod channel\'s relay is asked for in Read code\'s click before the channel is followed (Glaze\'s own is held: no prompt)', async () => {
  for (const [link, yes, want] of [['https://relay.school.example/j#1.r.abc', true, [['https://relay.school.example/*'], true]], ['https://relay.school.example/j#1.r.abc', false, [['https://relay.school.example/*'], true]], ['https://share.frostdev.io/j#1.r.abc', true, [['https://share.frostdev.io/*'], true]]]) {
    const rig = pageChrome({ answer: () => yes, respond: async () => ({ ok: false, error: 'network' }) });
    const e = editor(rig);
    e.$('mod-code').value = link;
    rig.state.active = true;
    e.$('mod-code-read').fire('click');
    rig.state.active = false;
    await settle();
    assert.deepEqual(rig.asked, want ? [want] : [], link);
    assert.equal(rig.sent.filter((m) => m.type === 'glaze:modchannel' && m.op === 'follow').length, yes ? 1 : 0, `${link}: followed only when held`);
  }
});

// ---- Settings: the Gradescope switch -------------------------------------------------------------------------------------
test('Settings: the Gradescope switch asks for www.gradescope.com in its click; refused, it stays off and nothing is saved', () => {
  const src = read('options.js');
  const at = src.indexOf("if (key === 'enhance.gradescope'");
  assert.ok(at > 0, 'the switch has its own path');
  const body = src.slice(at, src.indexOf('\n', at));
  assert.match(body, /GZ_SITE\.reach\(\[GZ_GRADESCOPE\.HOST\]\)/, 'asks for Gradescope through reach');
  assert.ok(body.indexOf('GZ_SITE.reach') < body.indexOf('.then('), 'before anything is awaited');
});
