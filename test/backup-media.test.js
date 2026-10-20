const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('../defaults.js');
const P = require('../lib/lookparts.js');
const C = require('../lib/cards.js');
const B = require('../lib/navbar.js');

const source = fs.readFileSync(require.resolve('../options.js'), 'utf8');
const backup = source.slice(source.indexOf('  // ---- backup ----'), source.indexOf('  // Two clicks, so a stray'));
const restore = async (src, kind = 'media', extra = {}, roundTrip = false) => {
  let raw = { ...structuredClone(G.GZ_DEFAULTS), bg: { ...G.GZ_DEFAULTS.bg, kind }, parts: { x: { bg: { media: { type: 'video', src } }, cursor: { kind: 'glow' } } }, ...extra };
  const elements = {}, sent = [], hints = [], s = {};
  let exported;
  const context = {
    s, navigator: {}, document: { createElement: () => ({ click() {} }) }, URL: { createObjectURL: (blob) => { exported = blob; return 'blob:test'; }, revokeObjectURL() {} }, Blob, setTimeout: () => 0, structuredClone, GZ_SANITIZE: G.GZ_SANITIZE, GZ_CARDS: C, GZ_XPARTS: P,
    GZ_TODO: { STORE_KEY: /^todo:/ }, GZ_PET: { KEY: /^pet:/, backup: () => ({}) }, GZ_NAVBAR: B, GZ_FOLDERS: { backup: () => ({}) }, N: { clean: () => ({}) },
    $: (id) => (elements[id] ||= { addEventListener: (type, fn) => { elements[id][type] = fn; } }),
    flush() {}, fill() {}, renderNavItems() {}, showNavPreview() {}, cardsOp: async () => true,
    hint: (...v) => hints.push(v), t: (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k]),
    chrome: { storage: { local: { get: async () => ({}) }, sync: { get: async () => ({}) } }, runtime: { sendMessage: (m, cb) => { if (m.type === 'glaze:sessions') return Promise.resolve({ ok: true, keys: [] }); sent.push(m); cb?.({ ok: true }); } } },
  };
  vm.runInNewContext(backup, context);
  if (roundTrip) {
    Object.assign(s, G.GZ_SANITIZE(raw));
    await elements['#export'].click({ isTrusted: true });
    assert.ok(exported, hints.map((x) => x[0]).join(', '));
    raw = JSON.parse(await exported.text());
  }
  await elements['#import'].change({ isTrusted: true, target: { files: [{ name: 'backup.json', text: async () => JSON.stringify(raw) }] } });
  return { s, sent: JSON.parse(JSON.stringify(sent)), hints };
};

test('a backup without its kept background file restores the gradient and explains what was omitted', async () => {
  const r = await restore(`file:${'A'.repeat(43)}`);
  assert.equal(r.sent[0].restore.settings.bg.kind, 'gradient');
  assert.equal(r.s.bg.kind, 'gradient');
  assert.equal(r.s.parts.x.cursor.kind, 'glow', 'the rest of the Look survives');
  assert.match(r.hints.at(-1)[0], /background file was not included.*gradient/i);
});

test('backup restore preserves URL backgrounds and inactive media drafts', async () => {
  for (const [src, kind] of [['https://cdn.example.com/loop.webm', 'media'], [`file:${'A'.repeat(43)}`, 'solid']]) {
    const r = await restore(src, kind);
    assert.equal(r.s.bg.kind, kind);
    assert.equal(r.s.parts.x.bg.media.src, src);
    assert.equal(r.hints.at(-1)[0], 'Imported backup.json.');
  }
});

test('Backup export and import preserve every synced sidebar option through the real handlers', async () => {
  const sidebar = { title: 'My tools', style: 'embed', open: 'drawer', width: 416, order: 'widgets', page: 'folded', heading: false, jump: false,
    surface: 'solid', blur: 30, opacity: 60, radius: 'large', density: 'compact', min: 800, grades: 1000, canvas: false, ultra: false,
    off: ['discussion', 'quiz'], todo: 'all', absorb: false };
  const r = await restore('https://cdn.example.com/loop.webm', 'media', { sidebar }, true);
  assert.deepEqual(r.sent[0].restore.settings.sidebar, sidebar);
  assert.deepEqual(r.s.sidebar, sidebar);
});
