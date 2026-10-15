// The notes app around lib/notes.js: who the service worker takes notes changes from, and the rules the page keeps when
// it asks Canvas for links (features/notes.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test("the worker takes a page's notes changes for its own site's index only", async () => {
  const listeners = [];
  const store = { local: {}, sync: {} };
  const area = (s) => ({ get: async (k) => Object.fromEntries([].concat(k ?? Object.keys(s)).filter((x) => x in s).map((x) => [x, structuredClone(s[x])])), set: async (v) => { Object.assign(s, structuredClone(v)); }, remove: async () => {} });
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto, atob, btoa,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    navigator: {}, // no IndexedDB here: a change that gets past the sender check fails on the database, closed
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener() {} } },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (msg, sender) => new Promise((res) => { for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) return; res('ignored'); });
  const page = (url) => ({ id: 'glaze', tab: {}, url });
  const m = { type: 'glaze:notesapp', key: 'notesIdx:https://school.instructure.com/5', op: 'tidy' };
  for (const [sender, why] of [
    [page('https://other.instructure.com/courses/1'), "another site's page"],
    [{ id: 'other', tab: {}, url: 'https://school.instructure.com/' }, 'another extension'],
    [{ id: 'glaze', url: 'https://school.instructure.com/' }, 'not in a tab'],
    [page('https://evil.example/'), 'a site Glaze does not run on'],
  ]) assert.deepEqual(await send(m, sender), { ok: false, error: 'sender' }, why);
  assert.deepEqual(await send({ ...m, key: 'notesIdx:https://school.instructure.com/5/../6' }, page('https://school.instructure.com/')), { ok: false, error: 'sender' }, 'a key outside the pattern');
  assert.deepEqual(await send(m, page('https://school.instructure.com/courses/1')), { ok: false, error: 'db' }, 'its own site: past the check, and the database it lacks fails it');
  assert.deepEqual(store.local, {}, 'nothing written');
});

test('the Canvas link picker: read-only GETs on this site, redirects refused, stopped when the picker or the view closes', () => {
  const src = read('features/notes.js');
  const fetches = [...src.matchAll(/\bfetch\(([^;]+)\);/g)].map((x) => x[1]);
  assert.equal(fetches.length, 1, 'one place asks Canvas for anything');
  assert.match(fetches[0], /^url, \{ credentials: 'same-origin', redirect: 'error', signal,/);
  assert.doesNotMatch(fetches[0], /method|body/);
  assert.match(src, /let url = `\$\{location\.origin\}\/api\/v1\$\{path\}`/, 'starts on this site');
  assert.match(src, /new URL\(next, location\.origin\)\.origin === location\.origin \?/, 'the next page only on this site');
  assert.match(src, /box\.addEventListener\('close', \(\) => \{[\s\S]{0,200}pick\?\.abort\(\);/, 'closing the view stops it');
  assert.match(src, /const done = \(\) => \{ ctl\.abort\(\);/, 'closing the picker stops it');
  // Nothing else leaves the page: no other request, no beacon, no remote picture.
  for (const word of ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']) assert.ok(!src.includes(word), word);
});
