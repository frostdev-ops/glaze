const test = require('node:test');
const assert = require('node:assert/strict');
const worker = require('./helpers/worker-env.cjs');
const writer = { id: 'glaze', url: 'chrome-extension://x/writer.html#pass', origin: 'chrome-extension://x', frameId: 3, tab: { id: 7, url: 'https://school.blackboard.com/ultra/courses/1' } };

test('citation worker: the shipped listener serves only writer.html and checks page grants', async () => {
  const calls = [];
  const w = worker({ fetch: async (url, init) => { calls.push([url, init]); return new Response('{"title":"A work"}', { headers: { 'content-type': 'application/json' } }); } });
  const doi = { type: 'glaze:writer-lookup', kind: 'doi', value: '10.5555/work' };
  assert.equal((await w.send(doi, writer)).ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(await w.send(doi, { ...writer, url: 'chrome-extension://x/options.html' }), { ok: false, error: 'sender' });
  assert.deepEqual(await w.send({ type: doi.type, kind: 'url', value: 'https://news.example.com/' }, writer), { ok: false, error: 'host' });
  assert.equal(calls.length, 1);
});

test('citation feature grant: a framed writer never enrolls or probes the cited host as an LMS', async () => {
  const calls = [];
  const w = worker({ fetch: async (u) => { calls.push(u); return new Response('{"learn":{"major":4001,"minor":2,"patch":0}}'); } });
  const origin = 'https://cited.school.edu';
  assert.deepEqual(await w.send({ type: 'glaze:allow', op: 'feature', origin }, writer), { ok: true });
  w.grants.add(`${origin}/*`);
  for (const f of w.perms.added) f({ origins: [`${origin}/*`] });
  await w.settle();
  assert.deepEqual(calls, []);
  assert.deepEqual(w.store.local.ultra, []);
  assert.equal([...w.registered.keys()].some((k) => k.includes('cited.school.edu')), false);
  assert.deepEqual(await w.send({ type: 'glaze:allow', op: 'ask', origin }, { ...writer, frameId: 0 }), { ok: false, error: 'sender' });
});
