// The extension UI's admission order with synthetic trusted events; no browser, account or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../lib/relay.js');
const D = require('../defaults.js'), S = require('../lib/surfaces.js');
const G = require('../lib/sharing.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let n = 0; n < 8; n++) await new Promise(setImmediate); };
const page = async ({ accepted = false, granted = true, selected = G.SERVER, hosts = [] } = {}) => {
  class Element {
    constructor() { this.children = []; this.events = {}; this.value = ''; this.hidden = false; this.classList = { toggle() {} }; }
    addEventListener(name, fn) { this.events[name] = fn; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    querySelectorAll() { return []; }
  }
  const nodes = new Map(), calls = [], confirmations = [];
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const state = { ok: true, on: false, sessions: [], sources: [], accounts: [], hosts, defaultRelay: G.SERVER, relay: selected };
  const context = vm.createContext({ ...D, GZ_SURFACES: S, matchMedia: () => ({ matches: false, addEventListener() {} }), URL, URLSearchParams, setTimeout, clearTimeout, console, GZ_RELAY: R,
    GZ_NOTES: { KEY: /^notesIdx:/ }, MutationObserver: class { observe() {} },
    GZ_I18N: { page() {}, ui: () => 'en', t: (k, v) => k.replace(/\{(\w+)\}/g, (_, key) => v?.[key] ?? '') },
    navigator: { userActivation: { isActive: true } }, location: { search: '' }, addEventListener() {},
    confirm: (text) => { calls.push('confirm'); confirmations.push(text); return accepted; },
    document: { documentElement: { style: { setProperty() {}, removeProperty() {} }, setAttribute() {} }, querySelector: node, createElement: () => new Element() },
    chrome: {
      storage: { sync: { get: async () => ({}) }, onChanged: { addListener() {} } },
      permissions: { contains: async ({ origins }) => { calls.push(['contains', origins]); return granted; }, request: async ({ origins }) => { calls.push(['request', origins]); return true; } },
      runtime: {
        id: 'glaze', sendMessage: async (m) => { calls.push(m.op); if (m.op === 'relaySave') state.relay = m.server; return m.op === 'list' ? structuredClone(state) : { ok: true, result: 'connected' }; },
        connect: () => ({ onMessage: { addListener() {} }, disconnect() {}, postMessage() {} }),
      },
    },
  });
  vm.runInContext(read('lib/sessions-ui.js'), context); await settle(); calls.length = 0;
  return { node, state, calls, confirmations, click: async (id, trusted = true) => { node(id).events.click({ isTrusted: trusted }); await settle(); } };
};
const link = (server) => G.link(server, { sid: G.b64(new Uint8Array(16)), seed: new Uint8Array(32) }, true);

test('E1 UI refuses scripted Join and cancelled custom-host confirmation before permissions or worker messages', async () => {
  const p = await page();
  p.node('#ss-invite').value = link('https://relay.example.edu:8443');
  await p.click('#ss-join', false); assert.deepEqual(p.calls, []);
  await p.click('#ss-join');
  assert.deepEqual(p.calls, ['confirm']);
  assert.match(p.confirmations[0], /relay\.example\.edu:8443, not frostdev\.io/);
  assert.equal(p.node('#ss-invite').value, '');
});

test('E1 UI confirms selected and previously approved custom hosts even with required HTTPS permission', async () => {
  const server = 'https://relay.example.edu';
  const p = await page({ accepted: true, selected: server, hosts: [server] });
  p.node('#ss-invite').value = link(server); await p.click('#ss-join');
  assert.equal(p.calls[0], 'confirm');
  assert.equal(p.calls[1][0], 'contains'); assert.equal(p.calls[2], 'join');
  assert.ok(!p.calls.some((c) => Array.isArray(c) && c[0] === 'request'), 'the required HTTPS grant needs no repeated request');
  const other = await page({ selected: server });
  other.node('#ss-invite').value = link(G.SERVER); await other.click('#ss-join');
  assert.deepEqual(other.calls, ['confirm']);
  assert.match(other.confirmations[0], /share\.frostdev\.io, not your selected relay \(relay\.example\.edu\)/);
});

test('E1 helper stays out of LMS startup, is cached for a worker restart and is packaged for both Safari targets', () => {
  const manifest = require('../manifest.json');
  assert.ok(!manifest.content_scripts.flatMap((s) => s.js).includes('lib/relay.js'));
  assert.ok(!manifest.web_accessible_resources.some((r) => r.resources.includes('lib/relay.js')));
  assert.match(read('lib/background.js'), /addEventListener\?\.\('install', \(\) => importScripts\('relay\.js', 'sharing\.js', 'sessions\.js'\)\)/);
  assert.match(read('options.html'), /<script src="lib\/relay\.js"><\/script>/);
  const safari = require('../scripts/safari-resources.js');
  assert.deepEqual(safari.missing(['lib/relay.js']), []);
  assert.match(read('package.sh'), /defaults\.js lib i18n/);
});
