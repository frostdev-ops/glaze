const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('../defaults.js');
const F = require('../lib/fonts.js');
const S = require('../lib/share.js');
const X = require('../lib/lookparts.js');
const K = require('../lib/cards.js');
const P = require('../lib/parts.js');

const offer = async (code) => {
  const source = fs.readFileSync(require.resolve('../options.js'), 'utf8');
  const section = source.slice(source.indexOf('  const tryCode ='), source.indexOf("  $('#share-try').addEventListener"));
  const notes = [], paints = [], hints = [];
  const controls = {
    '#share-code': { value: code }, '#share-offer': {},
    '#share-what': { replaceChildren() {}, append: (...xs) => notes.push(...xs.map((x) => x.textContent ?? x)) },
  };
  const context = vm.createContext({
    GZ_SHARE: S, GZ_XPARTS: X, GZ_PARTS: P, GZ_SANITIZE: G.GZ_SANITIZE, GZ_MATCH_PRESET: G.GZ_MATCH_PRESET,
    GZ_CARDS: K, GZ_FONTS: F, GZ_I18N: { ui: () => 'en', locale: () => 'en' },
    s: G.GZ_SANITIZE(), offer: null, from: null, offerFile: '', offerGeneration: 0, letGo() {}, URL, Intl,
    $: (id) => controls[id], document: { createElement: () => ({}) }, fontName: (f) => f.name,
    t: (s, vars) => s.replace(/\{(\w+)(?:\|\w+)?\}/g, (_, k) => vars[k]),
    endOffer() {}, hint: (...xs) => hints.push(xs), preview() {}, GZ_UI: { paint: (s) => paints.push(s) },
  });
  await vm.runInContext(section + '\ntryCode();', context);
  return { text: notes.join(' '), paints, hints };
};

test('the offer discloses rule web fonts and their hosts before preview, including the maximum rule list', async () => {
  const parts = { x: { rules: Array.from({ length: P.MAX }, (_, i) => ({ p: 'canvas.footer', do: 'style', st: { f: i % 2 ? 'lexend' : 'opendyslexic' } })) } };
  const result = await offer(await S.encode(G.GZ_SANITIZE(), {}, parts));
  for (const name of ['Lexend', 'OpenDyslexic', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net']) assert.ok(result.text.includes(name), name);
  assert.equal(result.paints.length, 1);
  assert.equal(result.hints.length, 0);
});

test('malformed rule font data never reaches the offer preview', async () => {
  const raw = { c: G.GZ_COLORS.map(([, , c]) => c.slice(1)).join(''), x: { rules: [{ p: 'canvas.footer', do: 'style', st: { f: 'url(https://attacker.invalid/font)' } }] } };
  const code = 'glaze2:' + X.b64(await X.deflate(new TextEncoder().encode(JSON.stringify(raw))));
  const result = await offer(code);
  assert.equal(result.paints.length, 0);
  assert.equal(result.hints.length, 1);
});

test('an offer from the gallery is taken by the editor tab the worker opens, not by Settings framed in a school page', async () => {
  const source = fs.readFileSync(require.resolve('../options.js'), 'utf8');
  const take = source.slice(source.indexOf('  const takeOffer = '), source.indexOf("  local.get(['lookFavorites', 'lookHistory']"));
  for (const embedded of [true, false]) {
    const stored = { galleryOffer: { code: 'glaze1:abc', name: 'Garden' } }, tried = [];
    const context = vm.createContext({
      embedded, offer: null, t: (s) => s, $: () => ({ value: '', focus() {} }), editor: { show() {} }, tryCode: async (o) => tried.push(o.name),
      local: { get: async (k) => ({ [k]: stored[k] }), remove: async (k) => { delete stored[k]; } },
    });
    await vm.runInContext(`${take}\ntakeOffer();`, context);
    assert.deepEqual([embedded, 'galleryOffer' in stored, tried], [embedded, embedded, embedded ? [] : ['Garden']]);
  }
});

test('a background picture link the settings would drop is refused when typed, not lost when saved', () => {
  const source = fs.readFileSync(require.resolve('../options.js'), 'utf8');
  const handler = source.slice(source.indexOf("  $('#bg-image').addEventListener"), source.indexOf("  $('#save-preset').addEventListener"));
  for (const [link, kept] of [['https://example.com/a.jpg', true], [`https://example.com/${'a'.repeat(2100)}.jpg`, false], ['https://example.com/a.jpg?x\\', false]]) {
    let change;
    const hints = [], saved = [], s = G.GZ_SANITIZE();
    vm.runInNewContext(handler, { $: () => ({ addEventListener: (_, f) => { change = f; } }), GZ_SANITIZE: G.GZ_SANITIZE, URL, s, t: (x) => x,
      hint: (...h) => hints.push(h), fill() {}, save: (g) => saved.push(g) });
    change({ target: { value: link } });
    assert.deepEqual([s.bg.image === link, saved.length, hints.length], kept ? [true, 1, 0] : [false, 0, 1], link.slice(0, 40));
  }
});
