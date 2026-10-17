// The worker's side of media (lib/background.js): who may keep and drop the files a Look names (the editor's top frame), and who may
// ask for a Lottie file's cleaned JSON (a page Glaze runs on, only for the address the worn Look names; the editor and its preview
// frame, for the address they are showing). Run from the worker's own source, with stand-ins for storage and the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/media.js');
const X = require('../lib/lookparts.js');

const source = fs.readFileSync(path.join(__dirname, '../lib/background.js'), 'utf8');
const slice = source.slice(source.indexOf('// Media for a Look (lib/media.js)'), source.indexOf("// Share keys and relay traffic"));
const spin = fs.readFileSync(path.join(__dirname, 'fixtures/media/spin.json'), 'utf8');
const URL1 = 'https://cdn.example.com/spin.json';
const OTHER = 'https://cdn.example.com/other.json';

const rig = async ({ worn = URL1, lms = 'https://school.instructure.com' } = {}) => {
  const listeners = [], fetched = [], local = { data: {} };
  const lookX = worn ? await X.pack({ x: { bg: { media: { type: 'lottie', src: worn } } } }) : '';
  const area = (data) => ({ get: async (k) => Object.fromEntries([].concat(k === null ? Object.keys(data) : k).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])),
    set: async (p) => { Object.assign(data, structuredClone(p)); return true; }, remove: async (k) => { for (const x of [].concat(k)) delete data[x]; return true; } });
  const sync = { lookX }, local2 = {};
  const ctx = vm.createContext({
    BROKER: {}, BROKER_FILES: {}, GZ_MEDIA: M, GZ_XPARTS: X, importScripts() {}, URL, console,
    chrome: { runtime: { id: 'glaze', getURL: (p = '') => `chrome-extension://glaze/${p}`, onMessage: { addListener: (f) => listeners.push(f) } } },
    fromEditor: (s) => s.id === 'glaze' && s.url?.split(/[?#]/)[0] === 'chrome-extension://glaze/options.html',
    fromLms: async (s) => (s.id === 'glaze' && s.tab && s.frameId === 0 && s.url?.startsWith(lms) ? lms : null),
    brokerArea: (name) => area(name === 'sync' ? sync : local2),
    fetch: async (u, i) => { fetched.push([u, i]); return new Response(spin, { status: 200 }); },
  });
  vm.runInContext(`${slice}\nglobalThis.media = BROKER.media;`, ctx);
  const ask = (m, s) => new Promise((res) => { for (const f of listeners) if (f(m, s, (r) => res(JSON.parse(JSON.stringify(r)))) === true) return; res('ignored'); });
  return { media: ctx.media, ask, fetched, sync };
};
const editor = { id: 'glaze', frameId: 0, url: 'chrome-extension://glaze/options.html#look/background' };
const preview = { id: 'glaze', frameId: 0, url: 'chrome-extension://glaze/preview.html?site=ultra' };
const page = { id: 'glaze', frameId: 0, tab: { id: 1 }, url: 'https://school.instructure.com/ultra/stream' };

test('only the editor\'s top frame puts, lists and drops the files kept for a Look', async () => {
  const { media } = await rig();
  for (const op of ['put', 'list', 'drop']) assert.equal(media.allow({ op }, editor), true, op);
  for (const op of ['lottie', 'nope', undefined]) assert.equal(media.allow({ op }, editor), false, String(op));
  for (const s of [{ ...editor, frameId: 1 }, preview, page, { ...editor, id: 'another-extension' }, { id: 'glaze', frameId: 0, url: 'https://evil.example/options.html' }]) assert.equal(media.allow({ op: 'put' }, s), false, JSON.stringify(s));
  assert.equal(typeof media.run, 'function');
});

test('a page gets a Lottie file only for the address the worn Look names; the editor and its preview for the one they show', async () => {
  const r = await rig();
  const ask = (src, s) => r.ask({ type: 'glaze:lottie', src }, s);
  const fine = await ask(URL1, page);
  assert.equal(fine.ok, true);
  assert.equal(fine.json.w, 200);
  assert.equal(r.fetched.length, 1);
  assert.deepEqual([r.fetched[0][0], r.fetched[0][1].credentials, r.fetched[0][1].redirect, r.fetched[0][1].referrerPolicy], [URL1, 'omit', 'manual', 'no-referrer']);
  // Another address: refused before anything is fetched.
  assert.deepEqual(await ask(OTHER, page), { ok: false, error: 'bad' });
  assert.equal(r.fetched.length, 1);
  assert.equal((await ask(OTHER, editor)).ok, true, 'the editor may try an address');
  assert.equal((await ask(OTHER, preview)).ok, true, 'and so may its preview frame');
  assert.equal(r.fetched.length, 3);
  for (const bad of [{ ...page, frameId: 2 }, { ...page, tab: undefined }, { ...page, id: 'other' }, { ...page, url: 'https://elsewhere.example/ultra' }, { ...preview, id: 'x' }, { id: 'glaze', frameId: 0, url: 'chrome-extension://glaze/sharing/sessions.html' }]) {
    assert.deepEqual(await ask(URL1, bad), { ok: false, error: 'sender' }, JSON.stringify(bad));
  }
  assert.equal(r.fetched.length, 3, 'a refused sender fetches nothing');
  // Other messages are not this listener's.
  assert.equal(await r.ask({ type: 'glaze:other' }, page), 'ignored');
  assert.equal(await r.ask(null, page), 'ignored');
});

test('with no Look worn that names an address, a page may have none; a file the Look names needs no fetch', async () => {
  const none = await rig({ worn: null });
  assert.deepEqual(await none.ask({ type: 'glaze:lottie', src: URL1 }, page), { ok: false, error: 'bad' });
  assert.equal(none.fetched.length, 0);
  for (const src of [5, null, undefined, '', 'http://cdn.example.com/a.json', 'https://127.0.0.1/a.json', `file:${'A'.repeat(43)}`, {}]) {
    const r = await rig();
    const got = await r.ask({ type: 'glaze:lottie', src }, page);
    assert.equal(got.ok, false, String(src));
    assert.equal(r.fetched.length, 0, `${String(src)} fetches nothing`);
  }
});

test('a Lottie fetch is not held up by, and does not hold up, the broker\'s queue', () => {
  assert.match(slice, /chrome\.runtime\.onMessage\.addListener\(\(m, s, reply\) => \{\n  if \(m\?\.type !== 'glaze:lottie'\) return;/);
  assert.doesNotMatch(slice.split("'glaze:lottie'")[1], /brokerTurn|GZ_CARDS/);
});
