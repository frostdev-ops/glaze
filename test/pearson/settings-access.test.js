const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const L = require('../../extension/pearson/embed.js');
const source = fs.readFileSync(path.join(__dirname, '../../extension/settings/options.js'), 'utf8');
const keys = ['pearsonViewer', 'pearsonEmbed', 'pearsonMath'];
const tick = () => new Promise(setImmediate);
const settings = ({ held = false, grant = true, wide = false, framed = false } = {}) => {
  const s = { enabled: true, colors: {}, bg: {}, enhance: Object.fromEntries(keys.map(k => [k, true])), declutter: { tabs: [] }, sidebar: { off: [] } };
  const controls = keys.map(k => ({ type: 'checkbox', dataset: { key: 'enhance.' + k }, addEventListener(event, f) { this[event] = f; } }));
  const nodes = new Map(), added = [], removed = [], local = [], requests = [], saves = [];
  const c = vm.createContext({ URL, Promise, GZ_PEARSON_EMBED_LIB: L, s,
    chrome: { runtime: { getManifest: () => ({ host_permissions: wide ? ['<all_urls>'] : [] }) },
      permissions: framed ? undefined : { contains: async () => held, onAdded: { addListener: f => added.push(f) }, onRemoved: { addListener: f => removed.push(f) } },
      storage: { local: { get: async () => ({ pearsonAccess: held }) }, onChanged: { addListener: f => local.push(f) } } },
    GZ_SITE: { reach: async urls => { requests.push([...urls]); if (grant) held = true; return grant; } },
    $$: selector => selector === '[data-key]' ? controls : [], $: selector => { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); },
    get: key => key.split('.').reduce((o,k) => o[k], s), set: (key,value) => { s.enhance[key.split('.')[1]] = value; }, group: () => 'enhance', save: () => saves.push(structuredClone(s.enhance)),
    refresh: () => c.paintPearson?.(), GZ_COLORS: [], tabBoxes: [], sidebarBoxes: [],
    presetOptions() {}, renderFonts() {}, renderCourses() {}, renderNavItems() {},
  });
  const start = source.indexOf('  const PEARSON_KEYS');
  const loop = source.indexOf("  for (const el of $$('[data-key]')) {", start);
  vm.runInContext(source.slice(start, loop) + '\nthis.paintPearson = typeof pearsonControls === "function" ? pearsonControls : null;', c);
  vm.runInContext(source.slice(loop, source.indexOf('  for (const r of', loop)), c);
  const fill = source.indexOf('  const fill = () =>');
  vm.runInContext(source.slice(fill, source.indexOf('  // ---- fonts:', fill)) + '\nthis.fill = fill;', c);
  c.fill();
  return { controls, s, requests, saves, fill: c.fill,
    access: async value => { held = value; for (const f of value ? added : removed) f({ origins: [L.hosts[0] + '/*'] }); for (const f of local) f({ pearsonAccess: { newValue: value } }, 'local'); await tick(); },
    click: async (index, on) => { controls[index].checked = on; controls[index].change(); await tick(); },
  };
};

test('synced Pearson preferences show off on a device without all hosts and a denied click stays off', async () => {
  const h = settings({ grant: false }); await tick();
  assert.deepEqual(h.controls.map(c => c.checked), [false, false, false]);
  assert.deepEqual(Object.values(h.s.enhance), [true, true, true], 'this device does not overwrite the synced preferences');
  await h.click(0, true);
  assert.deepEqual(h.requests, [[...L.hosts]]);
  assert.deepEqual(h.controls.map(c => c.checked), [false, false, false]);
  assert.equal(h.saves.length, 0);
  h.fill(); assert.deepEqual(h.controls.map(c => c.checked), [false, false, false], 'another Settings redraw cannot imply access');
});

test('granting and revoking hosts updates open Settings, including framed Settings', async () => {
  for (const framed of [false, true]) {
    const h = settings({ held: true, framed }); await tick();
    assert.deepEqual(h.controls.map(c => c.checked), [true, true, true]);
    await h.access(false); assert.deepEqual(h.controls.map(c => c.checked), [false, false, false]);
    await h.access(true); assert.deepEqual(h.controls.map(c => c.checked), [true, true, true]);
  }
  const h = settings(); await tick(); await h.click(1, true);
  assert.equal(h.controls[1].checked, true); assert.equal(h.saves.length, 1);
});

test('a manifest holding every host shows the stored Pearson switches without an optional grant', async () => {
  const h = settings({ wide: true }); await tick();
  assert.deepEqual(h.controls.map(c => c.checked), [true, true, true]);
});
