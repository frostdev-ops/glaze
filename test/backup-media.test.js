const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('../defaults.js');
const P = require('../lib/lookparts.js');
const C = require('../lib/cards.js');

const source = fs.readFileSync(require.resolve('../options.js'), 'utf8');
const backup = source.slice(source.indexOf('  // ---- backup ----'), source.indexOf('  // Two clicks, so a stray'));
const restore = async (src, kind = 'media') => {
  const raw = { ...structuredClone(G.GZ_DEFAULTS), bg: { ...G.GZ_DEFAULTS.bg, kind }, parts: { x: { bg: { media: { type: 'video', src } }, cursor: { kind: 'glow' } } } };
  const elements = {}, sent = [], hints = [], s = {};
  const context = {
    s, navigator: {}, document: {}, URL, Blob, setTimeout, structuredClone, GZ_SANITIZE: G.GZ_SANITIZE, GZ_CARDS: C, GZ_XPARTS: P,
    GZ_TODO: { STORE_KEY: /^todo:/ }, GZ_FOLDERS: { backup: () => ({}) }, N: { clean: () => ({}) },
    $: (id) => (elements[id] ||= { addEventListener: (type, fn) => { elements[id][type] = fn; } }),
    flush() {}, fill() {}, renderNavItems() {}, showNavPreview() {}, cardsOp: async () => true,
    hint: (...v) => hints.push(v), t: (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k]),
    chrome: { runtime: { sendMessage: (m, cb) => { sent.push(m); cb?.({ ok: true }); } } },
  };
  vm.runInNewContext(backup, context);
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
