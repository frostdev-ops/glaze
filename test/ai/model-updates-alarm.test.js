// The worker's model-update alarm (background/background.js): a browser without a Rime model downloaded loads nothing but
// ai/local/updates.js when gz-models:daily fires, and makes no request; with one, the AI harness loads and the check runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(ROOT, 'extension/background/background.js'), 'utf8');
const block = source.slice(source.indexOf('// Background updates of Rime (ai/local/updates.js'), source.indexOf('// Glaze\'s own model\'s engine host (ai/local/link.js)'));

const run = async (folder) => {
  const imported = [], listeners = [], checks = [];
  let harness = 0;
  const dir = (kids) => ({ getDirectoryHandle: async (n) => { if (!kids[n]?.dir) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); return dir(kids[n].dir); },
    getFileHandle: async (n) => { if (!kids[n]?.file) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); return {}; },
    keys: async function* keys() { yield* Object.keys(kids); } });
  const ctx = {
    SAFARI: false, fetch: () => { throw new Error('no request'); },
    navigator: { storage: { getDirectory: async () => dir(folder ? { 'glaze-models': { dir: folder } } : {}) } },
    importScripts: (...f) => { imported.push(...f); vm.runInContext(fs.readFileSync(path.join(ROOT, 'extension/background', f[0]), 'utf8'), ctx); },
    ai: () => { harness++; Object.assign(ctx, { GZ_AI_STORE: {}, GZ_AI_LOCAL: {}, GZ_AI_SETTINGS: { PROVIDERS: ['local'] } }); ctx.GZ_AI_MODEL_UPDATES.alarm = async (env, a) => { checks.push(a.name); }; },
    chrome: { alarms: { onAlarm: { addListener: (f) => listeners.push(f) } }, runtime: { onStartup: { addListener() {} }, onInstalled: { addListener() {} }, getManifest: () => ({ version: '4.0.1' }) },
      storage: { local: {}, onChanged: { addListener() {} } } },
    crypto: globalThis.crypto, TextEncoder, atob, setTimeout, clearTimeout, Promise, Object, Array, Number, String, Map, Set, JSON, Math, Error, Uint8Array, DataView, Uint32Array,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  for (const f of listeners) f({ name: 'gz-models:daily' });
  for (let i = 0; i < 20; i++) await new Promise(setImmediate);
  return { imported, harness, checks };
};

test('no Rime model downloaded: the daily alarm loads only updates.js, never the harness', async () => {
  for (const folder of [null, { '~none': { file: true }, 'rime-1.7b-q4_k_m': { dir: {} } }]) {
    const r = await run(folder);
    assert.deepEqual(r.imported, ['../ai/local/updates.js']);
    assert.equal(r.harness, 0);
    assert.deepEqual(r.checks, []);
  }
});

test('a Rime model downloaded (or a folder from before the mark): the harness loads and the check runs', async () => {
  for (const folder of [{ '~rime': { file: true } }, { 'rime-1.7b-q4_k_m': { dir: {} } }]) {
    const r = await run(folder);
    assert.equal(r.harness, 1);
    assert.deepEqual(r.checks, ['gz-models:daily']);
  }
});
