// Settings → Sharing's relay Test (settings/options.js relayAction): the relay's host is asked for inside the click, before
// anything is awaited. Firefox refuses permissions.request once a handler has awaited (settings/editor-agents.js says the
// same of its own prompt). The relay block run on its own, with the page and the worker stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../../extension/settings/options.js'), 'utf8');
const block = src.slice(src.indexOf('  let relayBusy = false'), src.indexOf('  const relayHuman ='));

const harness = ({ held }) => {
  const log = [], els = {};
  const $ = (q) => (els[q] ||= { value: q === '#relay-kind' ? 'custom' : q === '#relay-url' ? 'https://relay.example.edu' : '', disabled: false, hidden: false, textContent: '', classList: { toggle() {} } });
  const chrome = {
    permissions: {
      contains: async () => { log.push('contains'); return held; },
      request: async () => { log.push('request'); return true; },
    },
    runtime: { sendMessage: async (m) => { log.push(m.op); return { ok: true, result: 'connected' }; } },
  };
  const ctx = vm.createContext({ $, chrome, t: (k) => k, showResets: () => {}, defaultRelay: 'https://share.example.com', GZ_RELAY: { normalize: (u) => u }, navigator: {} });
  vm.runInContext(`${block}\nglobalThis.relayAction = relayAction;`, ctx);
  return { log, run: (testing) => ctx.relayAction(testing), status: () => $('#relay-status').textContent };
};

test('the relay Test asks for its host before it awaits anything, and tests once it is granted', async () => {
  for (const held of [false, true]) {
    const h = harness({ held });
    const done = h.run(true);
    assert.deepEqual(h.log, ['request'], `held ${held}: the prompt starts inside the click`);
    await done;
    assert.ok(h.log.includes('relayTest'), JSON.stringify(h.log));
  }
});
