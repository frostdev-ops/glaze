// The mod blocklist (lib/blocklist.js): verification, matching, the daily check and its gates, and the worker's wiring.
// Everything is signed with a TEST key made for these tests; the owner's real key does not exist in the repo.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const B = require('../lib/blocklist.js');

// TEST KEY ONLY. The same key, list and signature are in the server's tests (frostdev.io server/gallery.test.mjs): if
// canon() or the signed text ever differ between the two, one side's tests fail.
const SEED = 'jeLTA3LlloWEPSpToL3asyk4m8JNMrxUvIGeTEvech8';
const PUB = 'riGx9YRdwUKkExiHgkVnUCa3WWqbxDdWy0I533i-uJM';
const VECTOR = {
  list: {
    v: 1, seq: 7, issued: '2026-10-17T00:00:00Z', expires: '2026-10-24T00:00:00Z',
    mods: ['aaaaaaaaaaaaaaaa', 'm5xw6z3mn5zxi2lo'],
    bundles: ['wzEaOI1xdoprftf5JrWf_NQBMKNMhHb94dBxHQEBzCY'],
    authors: ['7pIjr3r-X6ox2CR2I-D-SKptyX982qWdEsp_K1yuMso'],
    reasons: { aaaaaaaaaaaaaaaa: 'Sends grades to a third party.' },
  },
  sig: '1xBKbZIUYQxZdE5APX8EaF9oOE8jeLCA9oMoT8YeR4SsekaMY-aPqhCGqeN8c3McdboT0_pVz9GwLjyB5qrqBw',
  canon: '{"authors":["7pIjr3r-X6ox2CR2I-D-SKptyX982qWdEsp_K1yuMso"],"bundles":["wzEaOI1xdoprftf5JrWf_NQBMKNMhHb94dBxHQEBzCY"],"expires":"2026-10-24T00:00:00Z","issued":"2026-10-17T00:00:00Z","mods":["aaaaaaaaaaaaaaaa","m5xw6z3mn5zxi2lo"],"reasons":{"aaaaaaaaaaaaaaaa":"Sends grades to a third party."},"seq":7,"v":1}',
};
const sk = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(SEED, 'base64url')]), format: 'der', type: 'pkcs8' });
const signed = (list) => ({ list, sig: crypto.sign(null, Buffer.from(`glaze-blocklist-1|${B.canon(list)}`), sk).toString('base64url') });
const listOf = (over = {}) => ({ ...VECTOR.list, ...over });
const doc = (over) => signed(listOf(over));
const copy = (x) => JSON.parse(JSON.stringify(x));

const T0 = Date.parse('2026-10-18T00:00:00Z'), HOUR = 36e5, DAY = 864e5;
const BAD = 'aaaaaaaaaaaaaaaa', OTHER = 'bbbbbbbbbbbbbbbb', BUNDLE = VECTOR.list.bundles[0], AUTHOR = VECTOR.list.authors[0];

// ---- the format -------------------------------------------------------------------------------------------------------
test('canon is sorted-key JSON with no spaces, and the fixed vector is exactly what was signed', async () => {
  assert.equal(B.canon(VECTOR.list), VECTOR.canon);
  assert.equal(B.canon({ b: [2, { z: 1, a: 'é"' }], a: null }), '{"a":null,"b":[2,{"a":"é\\"","z":1}]}');
  const ok = await B.verify({ list: copy(VECTOR.list), sig: VECTOR.sig }, { key: PUB, now: T0 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.list, VECTOR.list);
});

test('clean takes a list only in its exact form, drops what it does not know, and is idempotent', () => {
  assert.deepEqual(B.clean(VECTOR.list), VECTOR.list);
  assert.deepEqual(B.clean(B.clean({ ...VECTOR.list, note: 'extra', mods: [...VECTOR.list.mods] })), VECTOR.list);
  assert.equal('note' in B.clean({ ...VECTOR.list, note: 'extra' }), false);
  const bad = {
    'not an object': null, array: [], 'wrong version': listOf({ v: 2 }), 'seq 0': listOf({ seq: 0 }), 'seq 1.5': listOf({ seq: 1.5 }), 'seq a string': listOf({ seq: '7' }),
    'issued after expires': listOf({ issued: '2026-10-25T00:00:00Z' }), 'expires as a number': listOf({ expires: 1793000000000 }), 'a date that is not one': listOf({ issued: '2026-13-40T00:00:00Z' }),
    'upper-case id': listOf({ mods: ['AAAAAAAAAAAAAAAA'] }), 'short id': listOf({ mods: ['aaaa'] }), 'id with 0 and 1': listOf({ mods: ['a0a1aaaaaaaaaaaa'] }),
    'short hash': listOf({ bundles: ['abc'] }), 'hash with padding': listOf({ authors: [`${AUTHOR.slice(0, 42)}=`] }), 'mods not an array': listOf({ mods: 'aaaaaaaaaaaaaaaa' }),
    'duplicate': listOf({ mods: [BAD, BAD] }), 'a reason for nothing listed': listOf({ reasons: { [OTHER]: 'x' } }), 'empty reason': listOf({ reasons: { [BAD]: '' } }),
    'long reason': listOf({ reasons: { [BAD]: 'x'.repeat(201) } }), 'reason with a newline': listOf({ reasons: { [BAD]: 'a\nb' } }), 'reason with a bidi mark': listOf({ reasons: { [BAD]: 'a‮b' } }),
    'reasons an array': listOf({ reasons: [] }), 'no reasons': { ...VECTOR.list, reasons: undefined },
  };
  for (const [what, x] of Object.entries(bad)) assert.equal(B.clean(x), null, what);
  assert.notEqual(B.clean(listOf({ reasons: { [BAD]: 'x'.repeat(200) }, mods: [BAD], bundles: [], authors: [] })), null, '200 characters is the limit');
});

// ---- verification -----------------------------------------------------------------------------------------------------
test('verify: a tampered list, a tampered signature and another key all fail the signature', async () => {
  const good = doc();
  const flip = (s) => `${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`;
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x;
  const cases = {
    'seq raised': { ...good, list: { ...good.list, seq: 8 } },
    'a mod added': { ...good, list: { ...good.list, mods: [...good.list.mods, OTHER] } },
    'a mod removed': { ...good, list: { ...good.list, mods: [BAD], reasons: good.list.reasons } },
    'a reason changed': { ...good, list: { ...good.list, reasons: { [BAD]: 'Fine, actually.' } } },
    'expiry extended': { ...good, list: { ...good.list, expires: '2030-01-01T00:00:00Z' } },
    'an unknown field added': { ...good, list: { ...good.list, note: 'hi' } },
    'signature changed': { ...good, sig: flip(good.sig) },
    'signature from another list': { ...good, sig: signed(listOf({ seq: 6 })).sig },
  };
  for (const [what, d] of Object.entries(cases)) assert.deepEqual(await B.verify(d, { key: PUB, now: T0 }), { ok: false, error: 'signature' }, what);
  assert.deepEqual(await B.verify(good, { key: other, now: T0 }), { ok: false, error: 'signature' }, 'a different key');
  assert.equal((await B.verify(good, { key: PUB, now: T0 })).ok, true);
  // An unknown field the owner did sign is fine; it is simply not used.
  const extra = signed({ ...VECTOR.list, note: 'hi' });
  assert.deepEqual((await B.verify(extra, { key: PUB, now: T0 })).list, VECTOR.list);
});

test('verify rejects signatures made without the blocklist domain or for a different protocol', async () => {
  for (const domain of ['', 'glaze-mod-1|', 'glaze-blocklist-2|']) {
    const sig = crypto.sign(null, Buffer.from(domain + B.canon(VECTOR.list)), sk).toString('base64url');
    assert.deepEqual(await B.verify({ list: VECTOR.list, sig }, { key: PUB, now: T0 }), { ok: false, error: 'signature' });
  }
});

test('verify: shapes that are not a signed list, seq going back, and expiry', async () => {
  const good = doc();
  for (const d of [null, 'x', {}, { list: good.list }, { sig: good.sig }, { list: good.list, sig: 'short' }, { list: good.list, sig: `${good.sig}A` }, { list: { ...good.list, v: 2 }, sig: good.sig }]) {
    assert.deepEqual(await B.verify(d, { key: PUB, now: T0 }), { ok: false, error: 'shape' }, JSON.stringify(d)?.slice(0, 60));
  }
  assert.equal((await B.verify(good, { key: PUB, now: T0, seq: 7 })).ok, true, 'the same seq is not a rollback');
  assert.deepEqual(await B.verify(good, { key: PUB, now: T0, seq: 8 }), { ok: false, error: 'rollback' });
  const expires = Date.parse(good.list.expires);
  assert.equal((await B.verify(good, { key: PUB, now: expires - 1 })).ok, true);
  assert.deepEqual(await B.verify(good, { key: PUB, now: expires }), { ok: false, error: 'expired' }, 'at the instant it expires');
  assert.deepEqual(await B.verify(good, { key: PUB, now: expires + DAY }), { ok: false, error: 'expired' });
});

test('verify: the key the extension ships is pinned, and a placeholder key accepts nothing', async () => {
  assert.equal(B.OWNER_KEY, 'KdWyoeAi5qK10c7op_zwFp2D6kBhrBtbXnE1TakrLa4', 'the shipped owner public key');
  for (const key of ['PENDING_OWNER_KEY', '', 'short', PUB.slice(1), 'A'.repeat(43)]) {
    const r = await B.verify(doc(), { key, now: T0 });
    assert.equal(r.ok, false, key);
    assert.ok(['key', 'signature'].includes(r.error), key);
  }
  assert.deepEqual(await B.verify(doc(), { key: 'PENDING_OWNER_KEY', now: T0 }), { ok: false, error: 'key' });
  // With the key as shipped (no key passed), a list signed by the test key is never accepted.
  const shipped = await B.verify(doc(), { now: T0 });
  assert.equal(shipped.ok, false);
  assert.equal(shipped.error, 'signature');
});

// ---- matching ---------------------------------------------------------------------------------------------------------
test('match finds a mod by id, bundle hash or author key, with the reason listed for that entry', () => {
  const list = B.clean(listOf({ reasons: { [BAD]: 'Sends grades away.', [BUNDLE]: 'This build steals tokens.' } }));
  assert.deepEqual(B.match(list, { id: BAD, hash: 'x', key: 'y' }), { by: 'mod', key: BAD, reason: 'Sends grades away.' });
  assert.deepEqual(B.match(list, { id: OTHER, hash: BUNDLE, key: 'y' }), { by: 'bundle', key: BUNDLE, reason: 'This build steals tokens.' });
  assert.deepEqual(B.match(list, { id: OTHER, hash: 'x', key: AUTHOR }), { by: 'author', key: AUTHOR, reason: 'This mod was blocked by Glaze.' });
  assert.equal(B.match(list, { id: OTHER, manifest: { author: { key: AUTHOR } } })?.by, 'author', 'the key in the manifest counts when the record has none');
  assert.equal(B.match(list, { id: 'm5xw6z3mn5zxi2lo' })?.by, 'mod', 'an id without a reason gets the default');
  for (const r of [{ id: OTHER, hash: 'x', key: 'y' }, {}, { id: undefined }, null, undefined, 'x']) assert.equal(B.match(list, r), null, JSON.stringify(r));
  assert.equal(B.match(list, { id: '__proto__' }), null);
});

// ---- storage ----------------------------------------------------------------------------------------------------------
const area = (store, { failOn } = {}) => ({
  get: async (k) => (k === null ? { ...store } : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, structuredClone(store[x])]))),
  set: async (v) => { if (failOn?.(v)) return false; Object.assign(store, structuredClone(v)); return true; },
});
const mod = (id, over = {}) => ({ id, manifest: { name: id, hooks: 'hooks.js', author: { key: 'k'.repeat(43) } }, hash: 'h'.repeat(43), key: 'k'.repeat(43), version: '1.0.0', grants: {}, enabled: true, ...over });
const installed = (...recs) => Object.fromEntries([['mods', recs.map((r) => r.id)], ...recs.map((r) => [`mod:${r.id}`, r])]);

test('apply stops every mod the list names and says why; others are left alone', async () => {
  const local = { ...installed(mod(BAD), mod(OTHER), mod('cccccccccccccccc', { hash: BUNDLE }), mod('dddddddddddddddd', { key: AUTHOR, enabled: false })) };
  const list = B.clean(VECTOR.list);
  const r = await B.apply(area(local), list);
  assert.deepEqual(r, { ok: true, blocked: [BAD, 'cccccccccccccccc', 'dddddddddddddddd'] });
  assert.deepEqual([local[`mod:${BAD}`].enabled, local[`mod:${BAD}`].blocked], [false, 'Sends grades to a third party.']);
  assert.deepEqual([local['mod:cccccccccccccccc'].enabled, local['mod:cccccccccccccccc'].blocked], [false, 'This mod was blocked by Glaze.']);
  assert.deepEqual([local['mod:dddddddddddddddd'].enabled, local['mod:dddddddddddddddd'].blocked], [false, 'This mod was blocked by Glaze.'], 'a mod that was already off is marked too');
  assert.deepEqual(local[`mod:${OTHER}`], mod(OTHER), 'untouched');
  assert.equal(local[`mod:${BAD}`].version, '1.0.0', 'the rest of the record is kept');
  // Again: nothing to write.
  const writes = [];
  const again = await B.apply({ get: area(local).get, set: async (v) => { writes.push(v); return true; } }, list);
  assert.deepEqual([again, writes], [{ ok: true, blocked: [] }, []]);
});

test('apply takes a block off a mod the list no longer names, but leaves it off', async () => {
  const local = installed(mod(BAD, { enabled: false, blocked: 'Old reason.' }), mod(OTHER, { enabled: false, blocked: 'Old reason.' }));
  const r = await B.apply(area(local), B.clean(listOf({ mods: [OTHER], reasons: {} })));
  assert.deepEqual(r, { ok: true, blocked: [OTHER] }, 'only the one still named is stopped (with its new reason)');
  assert.deepEqual([local[`mod:${BAD}`].enabled, 'blocked' in local[`mod:${BAD}`]], [false, false]);
  assert.equal(local[`mod:${OTHER}`].blocked, 'This mod was blocked by Glaze.', 'still named, with the new reason');
});

test('apply copes with no index, a missing record and a failed write', async () => {
  assert.deepEqual(await B.apply(area({}), B.clean(VECTOR.list)), { ok: true, blocked: [] });
  assert.deepEqual(await B.apply(area({ mods: [BAD, 7, null], [`mod:${OTHER}`]: mod(OTHER) }), B.clean(VECTOR.list)), { ok: true, blocked: [] });
  const local = installed(mod(BAD));
  assert.equal((await B.apply(area(local, { failOn: () => true }), B.clean(VECTOR.list))).ok, false);
  assert.equal(local[`mod:${BAD}`].enabled, true);
});

test('blocked answers from the stored list, including after it has expired, and never from nothing', async (t) => {
  const state = { list: VECTOR.list, sig: VECTOR.sig, seq: 7, checkedAt: T0 };
  const local = area({ [B.KEY]: state });
  assert.equal(await B.blocked(local, { id: BAD }), 'Sends grades to a third party.');
  assert.equal(await B.blocked(local, { id: OTHER, hash: BUNDLE }), 'This mod was blocked by Glaze.');
  assert.equal(await B.blocked(local, { id: OTHER, hash: 'x', key: 'y' }), '');
  // Past its expiry the list is unknown (current says so) but the blocks it made stand: waiting it out lifts nothing.
  const late = Date.parse(VECTOR.list.expires) + 30 * DAY;
  assert.equal(B.current(state, T0), true);
  assert.equal(B.current(state, late), false);
  assert.equal(B.current(undefined, T0), false);
  t.mock.timers.enable({ apis: ['Date'], now: late });
  assert.equal(await B.blocked(local, { id: BAD }), 'Sends grades to a third party.', 'with the clock past the expiry');
  t.mock.timers.reset();
  for (const stored of [undefined, {}, { list: 'x' }, { list: { ...VECTOR.list, v: 9 } }]) assert.equal(await B.blocked(area(stored === undefined ? {} : { [B.KEY]: stored }), { id: BAD }), '', JSON.stringify(stored));
});

// ---- the check --------------------------------------------------------------------------------------------------------
const reply = (body, { status = 200, headers } = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const rig = ({ sync = {}, local = installed(mod(BAD), mod(OTHER)), respond = () => reply(doc()), clock = T0, key = PUB, failOn } = {}) => {
  const requests = [], queued = [];
  const env = {
    sync: area(sync), local: area(local, { failOn }), key, clock, now: () => env.clock,
    fetch: async (url, init) => { requests.push({ url, init }); return respond(url, init); },
    enqueue: (f) => { queued.push(f); return f(); },
  };
  return { env, requests, queued, local };
};
const untouched = (r, before) => assert.deepEqual(r.local, before);

test('a due check asks once, with nothing about the student, and stops what the list names', async () => {
  const r = rig();
  const out = await B.check(r.env);
  assert.deepEqual(out, { ok: true, seq: 7, blocked: [BAD] });
  assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].url, 'https://frostdev.io/glaze/mods/api/blocklist');
  const init = r.requests[0].init;
  assert.deepEqual({ ...init, signal: typeof init.signal }, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache', redirect: 'error', signal: 'object' });
  assert.ok(!('headers' in init) && !('body' in init) && !('method' in init), 'a bare GET: no cookies, headers or body');
  assert.deepEqual(r.local[B.KEY], { list: VECTOR.list, sig: doc().sig, seq: 7, checkedAt: T0 });
  assert.deepEqual([r.local[`mod:${BAD}`].enabled, r.local[`mod:${BAD}`].blocked], [false, 'Sends grades to a third party.']);
  assert.equal(r.local[`mod:${OTHER}`].enabled, true);
  assert.equal(r.queued.length, 1, 'the record writes went through the queue');
});

test('no request without an installed mod, with the setting off, or with Glaze off', async () => {
  for (const [what, setup, error] of [
    ['no index', { local: {} }, 'none'], ['an empty index', { local: { mods: [] } }, 'none'], ['an index that is not a list', { local: { mods: 'aaaa' } }, 'none'],
    ['setting off', { sync: { mods: { blocklist: false } } }, 'off'], ['Glaze off', { sync: { enabled: false } }, 'off'],
    ['setting off and no mods', { sync: { mods: { blocklist: false } }, local: {} }, 'off'],
  ]) {
    const r = rig(setup);
    const before = copy(r.local);
    assert.deepEqual(await B.check(r.env), { ok: false, error }, what);
    assert.equal(r.requests.length, 0, what);
    untouched(r, before);
  }
  // The setting is on by default.
  assert.equal((await B.check(rig({ sync: {} }).env)).ok, true);
  assert.equal((await B.check(rig({ sync: { mods: { blocklist: true } } }).env)).ok, true);
});

test('only manifest code entries make an installed mod eligible for a request', async () => {
  for (const manifest of [undefined, {}, { parts: { rules: [] } }, { hooks: '' }, { ui: { tiles: [{ tree: {} }], nav: {} } }]) {
    const r = rig({ local: installed(mod(BAD, { manifest })) });
    assert.deepEqual(await B.check(r.env), { ok: false, error: 'none' }, String(JSON.stringify(manifest)));
    assert.equal(r.requests.length, 0);
    assert.equal(B.TRIED in r.local, false);
  }
  const missing = rig({ local: { mods: [BAD] } });
  assert.deepEqual(await B.check(missing.env), { ok: false, error: 'none' });
  assert.equal(missing.requests.length, 0);
  for (const manifest of [
    { hooks: 'hooks.js' }, { worker: 'main.js' },
    { ui: { tiles: [{ file: 'tile.html' }] } }, { ui: { rail: [{ worker: 'rail.js' }] } },
    { ui: { nav: { file: 'nav.html' } } }, { ui: { background: { worker: 'background.js' } } },
  ]) {
    const r = rig({ local: installed(mod(BAD, { manifest, enabled: false })) });
    assert.equal((await B.check(r.env)).ok, true, JSON.stringify(manifest));
    assert.equal(r.requests.length, 1, 'disabled code mods remain installed');
  }
});

test('at most one check a day, one retry an hour after a failure, and a clock set back does not stall it', async () => {
  const r = rig();
  assert.equal((await B.check(r.env)).ok, true);
  for (const later of [0, HOUR, DAY - 1]) {
    r.env.clock = T0 + later;
    assert.deepEqual(await B.check(r.env), { ok: false, error: 'soon' }, `+${later}`);
  }
  assert.equal(r.requests.length, 1);
  r.env.clock = T0 + DAY;
  assert.equal((await B.check(r.env)).ok, true, 'a day on, it asks again');
  assert.equal(r.requests.length, 2);
  // A failure holds the next try off for an hour, not a day.
  r.env.clock = T0 + 3 * DAY - 6 * HOUR;
  r.env.fetch = async (url, init) => { r.requests.push({ url, init }); throw new TypeError('offline'); };
  assert.deepEqual(await B.check(r.env), { ok: false, error: 'fetch' });
  r.env.clock += HOUR - 1;
  assert.deepEqual(await B.check(r.env), { ok: false, error: 'soon' });
  r.env.clock += 1;
  assert.deepEqual(await B.check(r.env), { ok: false, error: 'fetch' });
  assert.equal(r.requests.length, 4);
  // A checkedAt in the future (the clock went back) counts for nothing.
  const back = rig({ local: { ...installed(mod(BAD)), [B.KEY]: { list: VECTOR.list, sig: doc().sig, seq: 7, checkedAt: T0 + 400 * DAY }, [B.TRIED]: T0 + 400 * DAY } });
  assert.equal((await B.check(back.env)).ok, true);
});

test('the same list again only refreshes the time; a different list under the same seq is refused', async () => {
  const r = rig();
  await B.check(r.env);
  r.env.clock = T0 + 2 * DAY;
  assert.deepEqual(await B.check(r.env), { ok: true, seq: 7, blocked: [] });
  assert.equal(r.local[B.KEY].checkedAt, T0 + 2 * DAY);
  r.env.clock = T0 + 4 * DAY;
  r.env.fetch = async () => reply(doc({ mods: [BAD, OTHER], reasons: {} }));
  const before = copy(r.local);
  assert.deepEqual(await B.check(r.env), { ok: false, error: 'rollback' });
  untouched(r, { ...before, [B.TRIED]: T0 + 4 * DAY });
});

test('a higher seq replaces the list, and a mod it no longer names can be turned on again', async () => {
  const r = rig();
  await B.check(r.env);
  r.env.clock = T0 + 2 * DAY;
  r.env.fetch = async () => reply(doc({ seq: 8, mods: [OTHER], bundles: [], authors: [], reasons: {} }));
  assert.deepEqual(await B.check(r.env), { ok: true, seq: 8, blocked: [OTHER] });
  assert.equal(r.local[B.KEY].seq, 8);
  assert.deepEqual([r.local[`mod:${BAD}`].enabled, 'blocked' in r.local[`mod:${BAD}`]], [false, false], 'off, but no longer blocked');
  assert.equal(r.local[`mod:${OTHER}`].enabled, false);
  assert.equal(await B.blocked(area(r.local), { id: BAD }), '');
  assert.equal(await B.blocked(area(r.local), { id: OTHER }), 'This mod was blocked by Glaze.');
});

test('a bad, rolled-back or expired list changes nothing, and the last good list keeps its blocks', async () => {
  const run = async (respond, expected, clock = T0 + 2 * DAY) => {
    const r = rig({ respond: () => reply(doc()) });
    await B.check(r.env);
    // The student turns a mod the list does not name on, and one that it names stays off.
    r.local[`mod:${OTHER}`].enabled = true;
    const before = copy(r.local);
    r.env.fetch = async () => respond();
    r.env.clock = clock;
    const out = await B.check(r.env);
    assert.deepEqual(out, { ok: false, error: expected });
    untouched(r, { ...before, [B.TRIED]: clock });
    assert.equal(await B.blocked(area(r.local), { id: BAD }), 'Sends grades to a third party.');
    assert.equal(await B.blocked(area(r.local), { id: OTHER }), '');
  };
  const good = doc({ seq: 9 });
  await run(() => reply({ ...good, sig: good.sig.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) }), 'signature');
  await run(() => reply({ ...good, list: { ...good.list, mods: [BAD, OTHER] } }), 'signature');
  await run(() => reply(doc({ seq: 6 })), 'rollback');
  await run(() => reply(doc({ seq: 9, issued: '2026-10-01T00:00:00Z', expires: '2026-10-08T00:00:00Z' })), 'expired');
  await run(() => reply({ list: 'nope' }), 'shape');
  await run(() => reply('not json'), 'fetch');
  await run(() => reply('', { status: 503 }), 'fetch');
  await run(() => reply('', { status: 404 }), 'fetch');
  await run(() => { throw new TypeError('offline'); }, 'fetch');
  // Long after the list has expired (a stale server, or no new list for weeks), it is unknown but still enforced.
  const late = Date.parse(VECTOR.list.expires) + 40 * DAY;
  await run(() => reply(doc({ seq: 7 })), 'expired', late);
  const r = rig();
  await B.check(r.env);
  assert.equal(B.current(r.local[B.KEY], late), false);
  assert.equal(await B.blocked(area(r.local), { id: BAD }), 'Sends grades to a third party.');
});

test('the key the extension ships accepts nothing signed by anyone else', async () => {
  const r = rig();
  delete r.env.key; // as the worker runs it
  const before = copy(r.local);
  const out = await B.check(r.env);
  assert.deepEqual(out, { ok: false, error: 'signature' });
  untouched(r, { ...before, [B.TRIED]: T0 });
});

test('an oversized response is refused unread: by its length, or by counting what streams in', async () => {
  let r = rig({ respond: () => reply('{}', { headers: { 'content-length': String(B.CAP + 1) } }) });
  let before = copy(r.local);
  assert.deepEqual(await B.check(r.env), { ok: false, error: 'size' });
  untouched(r, { ...before, [B.TRIED]: T0 });
  // No length given: the stream is cut off at the cap and never read to its end.
  let pulled = 0, cancelled = false;
  const endless = () => new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(64 << 10).fill(32)); }, cancel() { cancelled = true; } });
  r = rig({ respond: () => new Response(endless()) });
  before = copy(r.local);
  assert.deepEqual(await B.check(r.env), { ok: false, error: 'size' });
  assert.ok(cancelled && pulled <= 8, `cancelled after ${pulled} pulls`);
  untouched(r, { ...before, [B.TRIED]: T0 });
  // Just under the cap is read.
  const room = JSON.stringify(doc()).length;
  r = rig({ respond: () => reply(`${JSON.stringify(doc())}${' '.repeat(B.CAP - room)}`) });
  assert.equal((await B.check(r.env)).ok, true);
  r = rig({ respond: () => reply(`${JSON.stringify(doc())}${' '.repeat(B.CAP - room + 1)}`) });
  assert.deepEqual(await B.check(r.env), { ok: false, error: 'size' });
});

test('if the mod records cannot be written the list is not kept, so the next try starts afresh', async () => {
  const r = rig({ failOn: (v) => Object.keys(v).some((k) => k.startsWith('mod:')) });
  const before = copy(r.local);
  assert.deepEqual(await B.check(r.env), { ok: false, error: 'apply' });
  untouched(r, { ...before, [B.TRIED]: T0 });
  assert.equal(r.local[`mod:${BAD}`].enabled, true);
  const r2 = rig({ failOn: (v) => B.KEY in v });
  assert.deepEqual(await B.check(r2.env), { ok: false, error: 'apply' });
  assert.equal(B.KEY in r2.local, false);
});

test('no request is made if the retry timestamp cannot be saved', async () => {
  const r = rig({ failOn: (v) => B.TRIED in v });
  const before = copy(r.local);
  for (let i = 0; i < 3; i++) assert.deepEqual(await B.check(r.env), { ok: false, error: 'apply' });
  assert.equal(r.requests.length, 0);
  untouched(r, before);
});

test('a failed list write cannot leave partial blocks or unblocks behind', async () => {
  const local = {
    ...installed(mod(BAD, { enabled: false, blocked: 'Sends grades to a third party.' }), mod(OTHER)),
    [B.KEY]: { list: VECTOR.list, sig: VECTOR.sig, seq: 7, checkedAt: T0 - 2 * DAY },
  };
  const r = rig({ local, failOn: (v) => B.KEY in v,
    respond: () => reply(doc({ seq: 8, mods: [OTHER], bundles: [], authors: [], reasons: {} })) });
  const before = copy(local);
  assert.deepEqual(await B.check(r.env), { ok: false, error: 'apply' });
  untouched(r, { ...before, [B.TRIED]: T0 });
});

// ---- the worker ---------------------------------------------------------------------------------------------------------
// lib/background.js as the browser would run it: what wakes a check, and who may.
const settle = () => new Promise((res) => setTimeout(res, 20));
const worker = ({ local: seed = installed(mod(BAD)), sync: seedSync = {}, protocol = 'chrome-extension:', source = fs.readFileSync(require.resolve('../lib/background.js'), 'utf8') } = {}) => {
  const listeners = [], local = structuredClone(seed), sync = structuredClone(seedSync), fetches = [];
  const store = (s) => ({
    get: async (k) => (k === null ? structuredClone(s) : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, structuredClone(s[x])]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); },
  });
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, Blob, CompressionStream, DecompressionStream, btoa, atob, structuredClone, Promise, Date, crypto,
    setTimeout, clearTimeout,
    fetch: async (url, init) => { fetches.push({ url, init }); return new Response('{}', { status: 503 }); },
    importScripts: (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(require.resolve(`../lib/${f}`), 'utf8'), context); },
    chrome: {
      runtime: {
        id: 'ext', getURL: (p = '') => `${protocol}//x/${p}`, getManifest: () => require('../manifest.json'),
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      scripting: { executeScript: async () => [{ result: 1 }] },
      storage: { local: store(local), sync: store(sync), onChanged: { addListener() {} } },
    },
  });
  vm.runInContext(source, context);
  const send = (m, s) => new Promise((res) => {
    let replied = false;
    const answer = (x) => { replied = true; res(x); };
    for (const f of listeners) if (f(m, s, answer) === true) return;
    if (!replied) res(undefined);
  });
  return { send, local, fetches, context };
};
const page = { id: 'ext', tab: { id: 1 }, frameId: 0, url: 'https://school.instructure.com/' };

test('the worker checks when the editor or a page asks, once at a time, and never for anyone else', async () => {
  const w = worker();
  const both = await Promise.all([w.send({ type: 'glaze:blocklist' }, page), w.send({ type: 'glaze:blocklist' }, page)]);
  assert.deepEqual(copy(both), [{ ok: false, error: 'fetch' }, { ok: false, error: 'fetch' }], 'both asks get the one answer (the mock server says 503)');
  assert.equal(w.fetches.length, 1, 'two asks at once make one request');
  assert.equal(w.fetches[0].url, 'https://frostdev.io/glaze/mods/api/blocklist');
  assert.equal(w.local[B.TRIED] > 0, true);
  // The editor page.
  const editor = worker();
  await editor.send({ type: 'glaze:blocklist' }, { id: 'ext', frameId: 0, url: 'chrome-extension://x/options.html' });
  assert.equal(editor.fetches.length, 1);
  // Not Glaze's own content script or editor: no request.
  for (const [what, sender] of [['another extension', { ...page, id: 'other' }], ['a frame of the extension that is not the editor', { id: 'ext', frameId: 0, url: 'chrome-extension://x/popup.html' }], ['no sender', {}]]) {
    const w2 = worker();
    assert.deepEqual(copy(await w2.send({ type: 'glaze:blocklist' }, sender)), { ok: false, error: 'sender' }, what);
    assert.equal(w2.fetches.length, 0, what);
  }
  // No mods, or the setting off: asked, but nothing leaves.
  for (const setup of [{ local: {} }, { sync: { mods: { blocklist: false } } }]) {
    const w3 = worker(setup);
    assert.equal(copy(await w3.send({ type: 'glaze:blocklist' }, page)).ok, false);
    assert.equal(w3.fetches.length, 0);
  }
});

test('Firefox and Safari never request the blocklist, even with code mods installed', async () => {
  for (const protocol of ['moz-extension:', 'safari-web-extension:']) {
    const w = worker({ protocol });
    assert.deepEqual(copy(await w.send({ type: 'glaze:blocklist' }, page)), { ok: false, error: 'off' });
    assert.equal(w.fetches.length, 0, protocol);
    assert.equal(B.TRIED in w.local, false, protocol);
  }
});

test('a failed check is not repeated by the next page within the hour, and a bad answer blocks nothing', async () => {
  const w = worker();
  await w.send({ type: 'glaze:blocklist' }, page);
  const again = await w.send({ type: 'glaze:blocklist' }, page);
  assert.deepEqual(copy(again), { ok: false, error: 'soon' });
  assert.equal(w.fetches.length, 1);
  assert.equal(w.local[`mod:${BAD}`].enabled, true);
});

test('a page that loads the mods runtime wakes the check; other loads do not', async () => {
  // features/mods.js is the mods runtime's entry, in LOADABLE.
  const source = fs.readFileSync(require.resolve('../lib/background.js'), 'utf8');
  assert.match(source, /LOADABLE = new Set\(\[[^\]]*'features\/mods\.js'/);
  const w = worker({ source });
  const loaded = await w.send({ type: 'glaze:load', files: ['features/mods.js'], doc: 'd' }, { ...page, documentId: 'doc1' });
  assert.deepEqual(copy(loaded), { ok: true });
  await settle();
  assert.equal(w.fetches.length, 1);
  const other = worker({ source });
  await other.send({ type: 'glaze:load', files: ['lib/glsl.js'], doc: 'd' }, { ...page, documentId: 'doc1' });
  await settle();
  assert.equal(other.fetches.length, 0);
  // A sender that may not load anything wakes nothing.
  const stranger = worker({ source });
  assert.deepEqual(copy(await stranger.send({ type: 'glaze:load', files: ['features/mods.js'] }, { ...page, id: 'other', documentId: 'doc1' })), { ok: false, error: 'not loadable' });
  await settle();
  assert.equal(stranger.fetches.length, 0);
});

test('worker restarts retain failure backoff and do not fetch with declarative-only records', async () => {
  const first = worker();
  await first.send({ type: 'glaze:blocklist' }, page);
  const restarted = worker({ local: first.local });
  assert.deepEqual(copy(await restarted.send({ type: 'glaze:blocklist' }, page)), { ok: false, error: 'soon' });
  assert.equal(restarted.fetches.length, 0);
  const data = worker({ local: installed(mod(BAD, { manifest: { parts: {} } })) });
  assert.deepEqual(copy(await data.send({ type: 'glaze:blocklist' }, page)), { ok: false, error: 'none' });
  assert.equal(data.fetches.length, 0);
});

test('the worker lends the mods code blocked(record), which reads the last good list', async () => {
  const w = worker({ local: { ...installed(mod(BAD)), [B.KEY]: { list: VECTOR.list, sig: VECTOR.sig, seq: 7, checkedAt: T0 } } });
  assert.equal(await vm.runInContext('blocked({ id: "aaaaaaaaaaaaaaaa" })', w.context), 'Sends grades to a third party.');
  assert.equal(await vm.runInContext('blocked({ id: "bbbbbbbbbbbbbbbb" })', w.context), '');
});

test('the setting defaults on, is a boolean, and has one owning control', () => {
  const D = require('../defaults.js');
  assert.equal(D.GZ_DEFAULTS.mods.blocklist, true);
  assert.equal(D.GZ_SANITIZE({ mods: { blocklist: false } }).mods.blocklist, false);
  assert.equal(D.GZ_SANITIZE({ mods: { blocklist: 'no' } }).mods.blocklist, true);
  assert.equal(D.GZ_SANITIZE({}).mods.blocklist, true);
  const html = fs.readFileSync(require.resolve('../options.html'), 'utf8');
  assert.equal(html.match(/data-key="mods\.blocklist"/g).length, 1);
});

test('the manifest asks for no alarms and nothing new: the check rides on events that already happen', () => {
  const m = require('../manifest.json');
  assert.ok(!(m.permissions || []).includes('alarms'));
  assert.ok(m.host_permissions.includes('<all_urls>'));
  assert.ok(!/alarms|setInterval/.test(fs.readFileSync(require.resolve('../lib/blocklist.js'), 'utf8').replace(/\/\/.*$/gm, '')));
});
