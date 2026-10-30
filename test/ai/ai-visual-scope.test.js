const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const worker = require('./helpers/worker-env.cjs');

const ORIGIN = 'https://school.blackboard.com';
const ATTEMPT = `${ORIGIN}/ultra/courses/_1_1/assessment/_2_1/attempt/create`;
const plain = (v) => JSON.parse(JSON.stringify(v));
const setup = async () => {
  const w = worker();
  let href = ATTEMPT, user = '_31_1', afterFetch, afterFrameRead;
  const calls = [];
  w.context.chrome.tabs.get = async (id) => ({ id, url: href });
  w.context.chrome.scripting.executeScript = async ({ func }) => {
    const location = { get href() { return href; }, get origin() { return new URL(href).origin; } };
    const window = { location }; window.top = window; window.parent = window;
    const result = await vm.runInNewContext(`(${func.toString()})()`, { location, window, URL, AbortController, setTimeout, clearTimeout,
      GZ_CTX: { account: () => { throw Error('Memoized account lookup must not be used.'); } },
      fetch: async (url, options) => { calls.push({ url, options }); const id = user; afterFetch?.(); return { ok: true, json: async () => ({ id }) }; },
    });
    if (func.name === 'aiFramePage' && afterFrameRead) { const next = afterFrameRead; afterFrameRead = null; next(); }
    return [{ frameId: 0, documentId: 'host-doc', result }];
  };
  const frame = { id: 'glaze', frameId: 3, documentId: 'writer-doc', url: 'chrome-extension://x/writer.html', origin: 'chrome-extension://x', tab: { id: 7, url: ATTEMPT } };
  const host = { id: 'glaze', frameId: 0, documentId: 'host-doc', url: ATTEMPT, origin: ORIGIN, tab: { id: 7, url: ATTEMPT } };
  await vm.runInContext('aiFrameHost', w.context)(frame, host);
  assert.deepEqual(await w.send({ type: 'glaze:attempt-kind', kind: 'assignment' }, host), { ok: true });
  return { calls, scope: () => vm.runInContext('aiVisualScope', w.context)(frame), setUser: (v) => { user = v; },
    setAfterFetch: (f) => { afterFetch = f; }, setAfterFrameRead: (f) => { afterFrameRead = f; }, setHref: (v) => { href = v; } };
};

test('visual cache authority rechecks the authenticated account instead of the content document’s memoized identity', async () => {
  const w = await setup();
  assert.deepEqual(plain(await w.scope()), { school: 'school.blackboard.com', account: '_31_1', assignment: '_1_1/_2_1' });
  w.setUser('_32_1');
  assert.equal((await w.scope()).account, '_32_1');
  assert.equal(w.calls.length, 2);
  assert.ok(w.calls.every((c) => c.url === `${ORIGIN}/learn/api/v1/users/me` && c.options.cache === 'no-store' && c.options.credentials === 'same-origin' && c.options.redirect === 'error'));
});

test('a route change during the fresh account read cannot retain the former assignment’s cache authority', async () => {
  const w = await setup();
  w.setAfterFetch(() => w.setHref(`${ORIGIN}/ultra/courses/_1_1/assessment/_9_1/attempt/create`));
  assert.equal(await w.scope(), null);
});

test('a route changed between admission and the scope script needs its own verified assignment evidence', async () => {
  const w = await setup();
  // The new route shares the document and school but has never reported a verified assignment kind.
  w.setAfterFrameRead(() => w.setHref(`${ORIGIN}/ultra/courses/_1_1/assessment/_9_1/attempt/create`));
  assert.equal(await w.scope(), null);
});
