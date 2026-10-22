// Mod channels (lib/modchannel.js) against a local relay (server/relay.js, in memory): links, publish and follow, the
// bundle checks a channel can't skip (forged, unsigned, another key, older, same), permission growth waiting for the
// prompt, the daily throttle, stop following, and an unreachable relay.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/sharing.js');
const M = require('../lib/modbundle.js');
const CH = require('../lib/modchannel.js');
const { relay } = require('../server/relay.js');

const u8 = (s) => new TextEncoder().encode(s);
const memory = () => { const m = new Map(); return { put: async (k, b) => { m.set(k, Buffer.from(b)); }, get: async (k) => m.get(k) || null, del: async (k) => { m.delete(k); } }; };
const up = async (t) => {
  const r = relay({ db: ':memory:', store: memory() });
  const a = await r.listen(0, '127.0.0.1');
  t.after(() => r.close());
  return `http://127.0.0.1:${a.port}`;
};
const area = (s = {}) => ({
  s,
  get: async (k) => structuredClone(k == null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
  set: async (v) => { Object.assign(s, structuredClone(v)); return true; },
  remove: async (k) => { for (const x of [].concat(k)) delete s[x]; return true; },
});
const manifest = (version, permissions = []) => ({ glaze: 1, name: 'Countdown', version, author: { name: 'Kai' }, permissions, hooks: 'hooks.js' });
const files = (v) => ({ 'hooks.js': u8(`// ${v}\n`) });
let keys;
const authors = async () => (keys ||= { a: await M.makeKey(), b: await M.makeKey() });
const pack = async (version, { key = 'a', permissions } = {}) => (await M.pack(files(version), manifest(version, permissions), (await authors())[key])).bytes;

// A follower: storage, and the worker's env (the real 'glaze:mods' install).
const follower = (fetchImpl = fetch) => {
  const local = area();
  let clock = Date.parse('2026-10-17T00:00:00Z');
  const env = { local, fetch: (...a) => fetchImpl(...a), now: () => clock, blocked: async () => '', enqueue: (f) => f(),
    install: (m) => M.change(m, { local }, { blocked: async () => '' }) };
  return { local, env, later: (ms) => { clock += ms; } };
};
const installFrom = async (f, link) => {
  const got = await CH.latest(link, f.env);
  const b = await M.read(got.bytes);
  const r = await f.env.install({ op: 'install', zip: M.std(got.bytes), hash: b.hash, grants: (b.manifest.permissions || []).map((p) => p.id), source: 'link', channel: got.link });
  assert.equal(r.ok, true, JSON.stringify(r));
  return b.id;
};
// The author writes straight to the channel's session, as a forger holding its edit key could.
const raw = async (author, id, bytes) => {
  const st = (await author.get(CH.OWN(id)))[CH.OWN(id)].st;
  const s = G.session(st);
  const ref = await s.put(bytes);
  await s.edit({ m: { bundle: { ...ref, n: 'x', t: 'application/octet-stream' } } });
  await s.sync();
  await author.set({ [CH.OWN(id)]: { ...(await author.get(CH.OWN(id)))[CH.OWN(id)], st } });
};

test('links: read and edit links parse, anything else is refused; followers keep the read link', async () => {
  const st = G.create('modchannel', { server: 'https://share.frostdev.io' });
  const s = G.session(st);
  const read = await s.link(false), edit = await s.link(true);
  assert.ok(CH.parse(read) && CH.parse(edit));
  assert.equal(await CH.readLink(edit), read);
  for (const bad of ['', 'glazemod1:abc', 'https://share.frostdev.io/j#1.r.short', 'ftp://x/j#1.r.' + 'a'.repeat(107), 'http://evil.example/j#1.r.' + 'a'.repeat(107), 'x'.repeat(700), 42, null])
    assert.equal(CH.parse(bad), null, String(bad));
  await assert.rejects(CH.readLink('nonsense'), { code: 'link' });
  // The record keeps only a read link.
  const local = area();
  const bytes = await pack('1.0.0'), b = await M.read(bytes);
  assert.equal((await M.change({ op: 'install', zip: M.std(bytes), hash: b.hash, grants: [], source: 'link', channel: edit }, { local }, { blocked: async () => '' })).error, 'bad');
  assert.equal((await M.change({ op: 'install', zip: M.std(bytes), hash: b.hash, grants: [], source: 'link', channel: read }, { local }, { blocked: async () => '' })).ok, true);
  assert.equal(local.s[`mod:${b.id}`].channel, read);
});

test('publish and follow: a newer signed version installs quietly; older, same, unsigned, forged and other-key ones are refused', async (t) => {
  const server = await up(t), author = area();
  const p1 = await CH.publish(await pack('1.0.0'), { local: author, fetch, server });
  assert.equal(p1.ok, true, JSON.stringify(p1));
  assert.match(p1.link, /\/j#1\.r\./);
  assert.equal((await CH.publish(await pack('1.0.0'), { local: author, fetch, server })).error, 'version');
  assert.equal((await CH.publish(u8('not a zip'), { local: author, fetch, server })).error, 'bundle');

  const f = follower();
  const id = await installFrom(f, p1.link);
  assert.equal(f.local.s[`mod:${id}`].version, '1.0.0');

  // Same version: nothing to do, no error.
  assert.equal((await CH.check(f.env, { force: true })).checked[id], 'ok');

  const p2 = await CH.publish(await pack('1.1.0'), { local: author, fetch, server });
  assert.equal(p2.ok, true);
  assert.equal(p2.link, p1.link);
  assert.equal((await CH.check(f.env, { force: true })).checked[id], 'ok');
  assert.equal(f.local.s[`mod:${id}`].version, '1.1.0');
  assert.equal(f.local.s[`mod:${id}`].channel, p1.link);

  // Whatever the channel's key holder puts there, only a signed, same-key, newer bundle installs.
  const bad = {
    older: await pack('1.0.5'),
    same: await pack('1.1.0'),
    otherKey: await pack('2.0.0', { key: 'b' }),
    unsigned: null,
  };
  // Unsigned: the 2.0.0 files without mod.sig. Forged: a mod.sig from another bundle.
  const signed = await M.read(await pack('2.0.0'));
  const plain = Object.fromEntries(Object.entries(signed.files).filter(([p]) => p !== 'mod.sig'));
  bad.unsigned = M.archive(plain);
  bad.forged = M.archive({ ...plain, 'hooks.js': u8('// evil\n'), 'mod.sig': signed.files['mod.sig'] });
  for (const [why, bytes] of Object.entries(bad)) {
    await raw(author, id, bytes);
    const r = await CH.check(f.env, { force: true });
    assert.equal(f.local.s[`mod:${id}`].version, '1.1.0', why);
    assert.equal(f.local.s[`mod:${id}`].hash, (await M.read(await pack('1.1.0'))).hash, why);
    if (['older', 'same'].includes(why)) assert.equal(r.checked[id], 'ok', why);
    else assert.ok(['refused', 'bundle'].includes(r.checked[id]), `${why}: ${r.checked[id]}`);
  }
  assert.equal((await CH.publish(bad.unsigned, { local: author, fetch, server })).error, 'unsigned');
});

test('permission growth waits for the prompt; the blocklist applies', async (t) => {
  const server = await up(t), author = area();
  const { link } = await CH.publish(await pack('1.0.0'), { local: author, fetch, server });
  const f = follower();
  const id = await installFrom(f, link);
  await CH.publish(await pack('1.1.0', { permissions: [{ id: 'todo', why: 'Counts down to your next due date.' }] }), { local: author, fetch, server });
  assert.equal((await CH.check(f.env, { force: true })).checked[id], 'pending');
  assert.equal(f.local.s[`mod:${id}`].version, '1.0.0');
  assert.equal(f.local.s[CH.STATE(id)].pending.version, '1.1.0');
  assert.deepEqual(f.local.s[`mod:${id}`].grants, {});
  await CH.dismiss(id, f.env);
  assert.equal(f.local.s[CH.STATE(id)].pending, undefined);

  await CH.publish(await pack('1.2.0'), { local: author, fetch, server });
  f.env.blocked = async () => 'Harmful';
  assert.equal((await CH.check(f.env, { force: true })).checked[id], 'blocked');
  assert.equal(f.local.s[`mod:${id}`].version, '1.0.0');
});

test('an update that turns a widget Glaze draws into a code mod waits for the prompt, with the same permissions', async (t) => {
  const server = await up(t), author = area(), todo = [{ id: 'todo', why: 'Shows what is due next.' }];
  const widget = { ...manifest('1.0.0', todo), hooks: undefined, ui: { tiles: [{ id: 'main', name: 'Due soon', sizes: ['m'], blocks: [{ type: 'text', text: 'Next: {next.title}' }] }] } };
  const packed = async (m, f = {}) => (await M.pack(f, JSON.parse(JSON.stringify(m)), (await authors()).a)).bytes;
  const { link } = await CH.publish(await packed(widget), { local: author, fetch, server });
  const f = follower();
  const id = await installFrom(f, link);
  await CH.publish(await packed({ ...manifest('1.0.1', todo), ui: { tiles: [{ id: 'main', name: 'Due soon', sizes: ['m'] }] } }, files('1.0.1')), { local: author, fetch, server });
  assert.equal((await CH.check(f.env, { force: true })).checked[id], 'pending', 'no code, then code: the student is asked');
  assert.equal(f.local.s[`mod:${id}`].version, '1.0.0', 'and nothing is installed meanwhile');
  assert.equal(f.local.s[CH.STATE(id)].pending.version, '1.0.1');
});

test('daily throttle, only enabled followed mods, stop following, and an unreachable relay', async (t) => {
  const server = await up(t), author = area();
  const { link } = await CH.publish(await pack('1.0.0'), { local: author, fetch, server });
  let calls = 0, online = true;
  const f = follower((...a) => { calls++; return online ? fetch(...a) : Promise.reject(new TypeError('offline')); });
  const id = await installFrom(f, link);
  calls = 0;
  assert.equal((await CH.check(f.env)).checked[id], 'ok');
  const n = calls;
  assert.ok(n > 0);
  f.later(CH.DAY - 1);
  assert.equal((await CH.check(f.env)).checked[id], 'soon');
  assert.equal(calls, n);
  f.later(1);
  online = false;
  assert.equal((await CH.check(f.env)).checked[id], 'network');
  assert.equal(f.local.s[CH.STATE(id)].error, 'network');
  assert.equal(f.local.s[`mod:${id}`].version, '1.0.0'); // nothing else changes
  // A failed try also waits a day.
  f.later(1000);
  assert.equal((await CH.check(f.env)).checked[id], 'soon');
  // A turned-off mod isn't checked while pages run; Check now still does.
  f.later(CH.DAY);
  f.local.s[`mod:${id}`].enabled = false;
  online = true;
  assert.equal((await CH.check(f.env)).checked[id], undefined);
  assert.equal((await CH.check(f.env, { force: true, id })).checked[id], 'ok');
  // Stop following: the mod stays, its channel and state go, nothing is checked again.
  assert.equal((await CH.unfollow(id, f.env)).ok, true);
  assert.equal(f.local.s[`mod:${id}`].channel, undefined);
  assert.equal(f.local.s[CH.STATE(id)], undefined);
  calls = 0;
  assert.deepEqual((await CH.check(f.env, { force: true })).checked, {});
  assert.equal(calls, 0);
  // Publishing with no relay: an error, nothing stored as published.
  const off = area();
  const r = await CH.publish(await pack('1.0.0'), { local: off, fetch: () => Promise.reject(new TypeError('offline')), server });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'network');
  assert.equal(Object.values(off.s)[0]?.link, undefined);
  // Following with no relay.
  await assert.rejects(CH.latest(link, { fetch: () => Promise.reject(new TypeError('offline')) }), { code: 'network' });
  // A share session of another kind isn't a channel.
  const look = G.create('look', { server });
  const s = G.session(look);
  await s.sync();
  await assert.rejects(CH.latest(await s.link(false), { fetch }), (e) => ['kind', 'empty'].includes(e.code));
});

test('record links obey the relay URL rules and never enter exported bundles', async () => {
  const bytes = await pack('1.0.0'), b = await M.read(bytes);
  const fragment = (await G.session(G.create('modchannel')).link(false)).split('#')[1];
  const install = (local, channel) => M.change({ op: 'install', zip: M.std(bytes), hash: b.hash, grants: [], source: 'link', channel }, { local }, { blocked: async () => '' });
  for (const base of ['http://remote.example', 'https://host:99999', 'https://[bad]', 'https://user:pass@host', 'https://host?query']) {
    const local = area();
    assert.equal((await install(local, `${base}/j#${fragment}`)).error, 'bad', base);
    assert.deepEqual(local.s, {});
  }
  for (const base of ['https://relay.example:8443/a%20path', 'http://127.0.0.1:1234', 'http://[::1]:1234']) {
    const local = area(), link = `${base}/j#${fragment}`;
    assert.equal((await install(local, link)).ok, true, base);
    assert.ok(CH.parse(local.s[`mod:${b.id}`].channel));
    const out = await M.change({ op: 'export', id: b.id }, { local });
    assert.deepEqual(Buffer.from(out.zip, 'base64'), Buffer.from(bytes));
    assert.equal((await M.read(Buffer.from(out.zip, 'base64'))).manifest.channel, undefined);
  }
});

test('concurrent checks share one request and cannot revive an unfollowed or removed mod', async (t) => {
  const server = await up(t), author = area();
  const { link } = await CH.publish(await pack('1.0.0'), { local: author, fetch, server });
  await CH.publish(await pack('1.1.0'), { local: author, fetch, server });
  for (const stop of ['unfollow', 'remove']) {
    const f = follower();
    // Keep the older bundle installed while following the current channel.
    const bytes = await pack('1.0.0'), b = await M.read(bytes), id = b.id;
    await f.env.install({ op: 'install', zip: M.std(bytes), hash: b.hash, grants: [], source: 'link', channel: link });
    let started, release, calls = 0;
    const waiting = new Promise((r) => { started = r; }), gate = new Promise((r) => { release = r; });
    f.env.fetch = async (...args) => { calls++; started(); await gate; return fetch(...args); };
    const first = CH.check(f.env), second = CH.check(f.env);
    await waiting;
    try {
      if (stop === 'unfollow') await CH.unfollow(id, f.env);
      else await M.change({ op: 'remove', id }, { local: f.local });
    } finally { release(); }
    await Promise.all([first, second]);
    assert.equal(calls, 2, 'one sync and one file download for both checks');
    assert.equal(f.local.s[CH.STATE(id)], undefined, stop);
    if (stop === 'unfollow') {
      assert.equal(f.local.s[`mod:${id}`].channel, undefined);
      assert.equal(f.local.s[`mod:${id}`].version, '1.0.0');
    } else {
      assert.equal(f.local.s[`mod:${id}`], undefined);
      assert.deepEqual(f.local.s.mods, []);
    }
    calls = 0;
    await CH.check(f.env, { force: true });
    assert.equal(calls, 0);
  }
});

test('opening the editor skips disabled mods; only an explicit Check now overrides that', async (t) => {
  const server = await up(t), author = area();
  const { link } = await CH.publish(await pack('1.0.0'), { local: author, fetch, server });
  const f = follower(), id = await installFrom(f, link);
  f.local.s[`mod:${id}`].enabled = false;
  let calls = 0;
  f.env.fetch = (...args) => { calls++; return fetch(...args); };
  assert.deepEqual((await CH.check(f.env, { force: true })).checked, {});
  assert.equal(calls, 0);
  assert.equal((await CH.check(f.env, { force: true, id })).checked[id], 'ok');
});

test('a failed install is retried next day even when the channel file has not changed', async (t) => {
  const server = await up(t), author = area();
  const { link } = await CH.publish(await pack('1.0.0'), { local: author, fetch, server });
  const f = follower(), id = await installFrom(f, link), install = f.env.install;
  await CH.publish(await pack('1.1.0'), { local: author, fetch, server });
  f.env.install = async () => ({ ok: false, error: 'write' });
  await CH.check(f.env);
  f.later(CH.DAY);
  f.env.install = install;
  await CH.check(f.env);
  assert.equal(f.local.s[`mod:${id}`].version, '1.1.0');
});

test('publishing deletes the previous file only after the new reference is acknowledged', async (t) => {
  const server = await up(t), author = area(), first = await pack('1.0.0'), id = (await M.read(first)).id;
  const p = await CH.publish(first, { local: author, fetch, server });
  const old = (await CH.latest(p.link, { fetch })).ref;
  const st = author.s[CH.OWN(id)].st, oldURL = `${server}/s/${st.sid}/b/${old.id}`;
  const events = [];
  const net = async (url, init) => { events.push([init?.method || 'GET', url]); return fetch(url, init); };
  const failed = await CH.publish(await pack('1.1.0'), { local: author, fetch: (url, init) => init?.method === 'PUT' ? Promise.reject(Error('offline')) : net(url, init), server });
  assert.equal(failed.ok, false);
  assert.equal((await fetch(oldURL)).status, 200);
  assert.ok(!events.some(([method]) => method === 'DELETE'));
  const failedSync = await CH.publish(await pack('1.1.1'), { local: author, fetch: (url, init) => init?.method === 'POST' ? Promise.reject(Error('offline')) : net(url, init), server });
  assert.equal(failedSync.ok, false);
  assert.equal((await fetch(oldURL)).status, 200);
  assert.ok(!events.some(([method]) => method === 'DELETE'));
  const newer = await pack('1.2.0');
  assert.equal((await CH.publish(newer, { local: author, fetch: net, server })).ok, true);
  assert.equal((await fetch(oldURL)).status, 404);
  assert.equal(events.at(-1)[0], 'DELETE');
  assert.deepEqual(Buffer.from((await CH.latest(p.link, { fetch })).bytes), Buffer.from(newer));
  // Cleanup failure must not turn a successful publication into a failure.
  assert.equal((await CH.publish(await pack('1.3.0'), { local: author, fetch: (url, init) => init?.method === 'DELETE' ? Promise.reject(Error('offline')) : net(url, init), server })).ok, true);
});

test('overlapping publications keep one channel and its highest published version', async (t) => {
  const server = await up(t), author = area();
  const old = await pack('1.0.0'), newer = await pack('1.1.0'), id = (await M.read(old)).id;
  let started, release, calls = 0;
  const waiting = new Promise((r) => { started = r; }), gate = new Promise((r) => { release = r; });
  const net = async (...args) => { if (++calls === 1) { started(); await gate; } return fetch(...args); };
  const first = CH.publish(old, { local: author, fetch: net, server });
  await waiting;
  const second = CH.publish(newer, { local: author, fetch: net, server });
  let during;
  try { await new Promise((r) => setTimeout(r, 30)); during = calls; } finally { release(); }
  const [a, b] = await Promise.all([first, second]);
  assert.equal(during, 1, 'the second publish waits for the first');
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.link, b.link);
  assert.equal(author.s[CH.OWN(id)].version, '1.1.0');
  assert.deepEqual(Buffer.from((await CH.latest(a.link, { fetch })).bytes), Buffer.from(newer));
});

test('channel responses are capped and cancelled, and failed downloads leave the installed mod untouched', async (t) => {
  const server = await up(t), author = area();
  const { link } = await CH.publish(await pack('1.0.0'), { local: author, fetch, server });
  const f = follower(), id = await installFrom(f, link);
  const before = structuredClone(f.local.s[`mod:${id}`]), trust = structuredClone(f.local.s[`modTrust:${id}`]);
  await CH.publish(await pack('1.1.0'), { local: author, fetch, server });
  const got = await CH.latest(link, { fetch });
  const padded = Math.max(1, Math.ceil(got.ref.s / 4096)) * 4096 + 28;
  for (const mode of ['header', 'stream', 'partial']) {
    let cancelled = false, pulled = 0;
    f.env.fetch = async (url, init) => {
      assert.equal(init.credentials, 'omit');
      assert.equal(init.referrerPolicy, 'no-referrer');
      assert.equal(init.redirect, 'error');
      if (!url.includes('/b/')) return fetch(url, init);
      if (mode === 'partial') return new Response(new Uint8Array([1, 2]));
      const body = new ReadableStream({
        pull(c) { pulled += 4096; c.enqueue(new Uint8Array(4096)); },
        cancel() { cancelled = true; },
      });
      return new Response(body, { headers: mode === 'header' ? { 'content-length': String(G.LIMIT.blob + 1) } : {} });
    };
    assert.equal((await CH.check(f.env, { force: true, id })).checked[id], 'network', mode);
    assert.deepEqual(f.local.s[`mod:${id}`], before, mode);
    assert.deepEqual(f.local.s[`modTrust:${id}`], trust, mode);
    assert.deepEqual(f.local.s.mods, [id]);
    if (mode !== 'partial') {
      assert.equal(cancelled, true, mode);
      assert.ok(pulled <= padded + 12288, `${mode}: ${pulled}`);
    }
  }
});

test('an incomplete or damaged session sync never downloads a stale bundle reference', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const link = await G.session(G.create('modchannel')).link(false);
  for (const result of [{ more: true }, { bad: 1 }]) {
    let downloads = 0;
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../lib/modchannel.js'), 'utf8'), {
      module, require: () => M,
      GZ_SHARING: { ...G, session: (st) => ({
        sync: async () => { st.type = 'modchannel'; return result; },
        view: () => ({ m: { bundle: { id: 'a'.repeat(22), h: 'b'.repeat(43), s: 1 } } }),
        get: async () => { downloads++; return new Uint8Array([1]); }, link: async () => link,
      }) },
    });
    await assert.rejects(module.exports.latest(link, { fetch }), { code: 'network' });
    assert.equal(downloads, 0);
  }
});

test('failed local writes cannot publish without saved edit keys or claim a successful Stop following', async (t) => {
  const server = await up(t), author = area();
  const bytes = await pack('1.0.0');
  let calls = 0;
  const net = (...args) => { calls++; return fetch(...args); };
  const broken = area();
  broken.set = async () => false;
  assert.equal((await CH.publish(bytes, { local: broken, fetch: net, server })).error, 'write');
  assert.equal(calls, 0, 'save edit keys before any relay request');
  const { link } = await CH.publish(bytes, { local: author, fetch, server });
  const f = follower(net), id = await installFrom(f, link);
  f.local.set = async () => false;
  calls = 0;
  assert.equal((await CH.check(f.env)).checked[id], 'write');
  assert.equal(calls, 0, 'save the daily attempt before fetching');
  assert.equal((await CH.unfollow(id, f.env)).error, 'write');
  assert.equal(f.local.s[`mod:${id}`].channel, link);
});
