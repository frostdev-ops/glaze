// Share sessions' pure parts (lib/sharing.js, spike S6): links, sealing and tampering, the merge (any order converges,
// clocks far ahead are held, untrusted values are cleaned), edits, and conflict copies. test/relay.test.js runs
// devices against a local relay.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/sharing.js');
const D = require('../defaults.js');
const L = require('../lib/share.js');

const bytes = (n, x = 7) => new Uint8Array(n).fill(x);
const editKeys = () => G.keys({ sid: crypto.getRandomValues(new Uint8Array(16)), seed: crypto.getRandomValues(new Uint8Array(32)) });

test('links: an edit link carries the seed, a read link the read secret and public key, and nothing else parses', async () => {
  const k = await editKeys();
  const edit = G.link('https://share.example', k, true);
  const read = G.link('https://share.example/glaze', k, false);
  assert.match(edit, /^https:\/\/share\.example\/j#1\.e\.[\w-]{64}$/);
  assert.match(read, /^https:\/\/share\.example\/glaze\/j#1\.r\.[\w-]{107}$/);
  const e = G.parse(edit), r = G.parse(read);
  assert.equal(e.server, 'https://share.example');
  assert.equal(r.server, 'https://share.example/glaze');
  assert.deepEqual([G.b64(e.sid), G.b64(e.seed)], [k.sid, G.b64(k.seed)]);
  assert.equal(r.seed, undefined);
  // The read link's holder gets the same encryption key and public key, and no signing key.
  const rk = await G.keys(r);
  assert.equal(rk.sk, null);
  assert.deepEqual([G.b64(rk.secret), G.b64(rk.pub)], [G.b64(k.secret), G.b64(k.pub)]);
  const sealed = await G.seal(k, 'op', { hi: 1 });
  assert.deepEqual(await G.open(rk, 'op', sealed), { hi: 1 });
  await assert.rejects(G.seal(rk, 'op', { hi: 2 }), /read-only/);
  // Not links: other schemes, http off this computer (and on it outside development), a path without /j, wrong sizes.
  for (const bad of [edit.replace('https:', 'http:'), edit.replace('/j#', '/x#'), edit.replace('#1.e.', '#2.e.'), edit.slice(0, -1), edit.replace('#1.e.', '#1.r.'),
    'javascript:alert(1)//j#1.e.' + edit.split('.e.')[1], 'https://u:p@share.example/j#1.e.' + edit.split('.e.')[1], 'not a link']) assert.equal(G.parse(bad), null, bad);
  assert.equal(G.parse('http://127.0.0.1:9/j#1.e.' + edit.split('.e.')[1]), null);
  assert.equal(G.parse('http://127.0.0.1:9/j#1.e.' + edit.split('.e.')[1], true).server, 'http://127.0.0.1:9');
  assert.equal(G.server('https://share.frostdev.io/'), 'https://share.frostdev.io');
  for (const bad of ['http://share.frostdev.io', 'https://share.frostdev.io/?x=1', 'ftp://x', 'nonsense']) assert.equal(G.server(bad), null, bad);
});

test('sealing: a round trip, padded lengths, and any change to a sealed batch is caught', async () => {
  const k = await editKeys(), other = await editKeys();
  const data = { y: 'notes', o: [{ e: 'n', f: 'title', v: 'Résumé ✓', t: '0'.repeat(20), p: '' }] };
  const s = await G.seal(k, 'op', data);
  assert.deepEqual(await G.open(k, 'op', s), data);
  // 12-byte nonce + a multiple of 256 + 16-byte tag: a length says little about what's inside.
  assert.equal((G.unb64(s.op).length - 28) % 256, 0);
  assert.equal(G.unb64((await G.seal(k, 'op', { v: 'x'.repeat(200) })).op).length, G.unb64((await G.seal(k, 'op', { v: 'y' })).op).length);
  const flip = (b64, i) => { const b = G.unb64(b64); b[i] ^= 1; return G.b64(b); };
  for (const i of [0, 11, 12, 40, G.unb64(s.op).length - 1]) await assert.rejects(G.open(k, 'op', { ...s, op: flip(s.op, i) }), undefined, `byte ${i}`);
  await assert.rejects(G.open(k, 'op', { ...s, sig: flip(s.sig, 3) }), /signature/);
  await assert.rejects(G.open(k, 'blob', s), /signature/); // another kind
  await assert.rejects(G.open(k, 'op', await G.seal(k, 'op', data, '5'), '6'), /signature/); // a batch moved to another place in the log
  await assert.rejects(G.open(other, 'op', s), /signature/); // another session
  // Signed by this session's key but sealed under another session's id: the associated data doesn't match.
  await assert.rejects(G.open({ ...other, vk: k.vk }, 'op', s));
  await assert.rejects(G.seal(k, 'op', { v: 'x'.repeat(G.LIMIT.op) }), /big/);
});

// A tiny adapter for the merge's own properties.
const AD = { fields: ['a', 'b'], copy: ['b'], clean: (f, v) => (typeof v === 'number' ? v : undefined), copyOf: (ent, f, v) => ({ a: -1, b: v }) };
const blank = (actor = 'zzzzzzzz') => ({ actor, clock: [0, 0], state: {}, pending: [], held: [], seed: 'x' });

test('merge: every order, with repeats, gives the same state', async () => {
  let seed = 2026; // mulberry32
  const rnd = (n) => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) % n; };
  for (let run = 0; run < 40; run++) {
    // Three devices editing two entities' fields, each seeing some of the others' changes as it goes.
    const devs = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'].map(blank);
    const log = [];
    for (let i = 0; i < 30; i++) {
      const d = devs[rnd(3)];
      if (log.length && rnd(2)) await G.merge(d, AD, [log[rnd(log.length)]], 1e12);
      const v = G.view(d);
      const e = ['x', 'y'][rnd(2)];
      if (rnd(8) === 0) delete v[e]; else v[e] = { ...v[e], [['a', 'b'][rnd(2)]]: rnd(100) };
      await G.edit(d, AD, v, 1e12 + rnd(5));
      log.push(...d.pending.splice(0).flat());
    }
    const states = [];
    for (let k = 0; k < 4; k++) {
      const order = [...log, ...log.slice(0, rnd(log.length))].map((o) => [rnd(1e9), o]).sort((a, b) => a[0] - b[0]).map(([, o]) => o);
      const d = blank('dddddddd');
      for (const o of order) await G.merge(d, AD, [o], 1e12);
      states.push(JSON.stringify(d.state, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v)));
    }
    assert.equal(new Set(states).size, 1, `run ${run}`);
  }
});

test('merge: untrusted changes are checked, and a clock far ahead waits for its time', async () => {
  const d = blank();
  const t = (ms, c = 0, a = 'aaaaaaaa') => ms.toString(36).padStart(9, '0') + c.toString(36).padStart(3, '0') + a;
  const now = 1.7e12;
  await G.merge(d, AD, [null, 5, { e: 'x', f: 'a', v: 1, t: 'bad', p: '' }, { e: 'x', f: 'zz', v: 1, t: t(now), p: '' }, { e: '../x', f: 'a', v: 1, t: t(now), p: '' },
    { e: 'x', f: 'a', v: 'not a number', t: t(now), p: '' }, { e: 'x', f: 'a', v: 1, t: t(now), p: 'nope' }, { e: 'x', f: 'del', v: 'yes', t: t(now), p: '' }], now);
  assert.deepEqual(d.state, {});
  // Ids that reach a prototype are refused; an inherited name becomes an ordinary own entity.
  await G.merge(d, AD, ['__proto__', 'constructor', 'prototype', 'toString'].map((e) => ({ e, f: 'a', v: 1, t: t(now), p: '' })), now);
  assert.deepEqual(Object.keys(d.state), ['toString']);
  assert.equal({}.a, undefined);
  assert.equal(Object.a, undefined);
  delete d.state.toString;
  await G.merge(d, AD, [{ e: 'x', f: 'a', v: 1, t: t(now), p: '' }, { e: 'x', f: 'a', v: 2, t: t(now + 3 * 864e5), p: '' }], now);
  assert.deepEqual(G.view(d), { x: { a: 1 } });
  assert.equal(d.held.length, 1);
  // The clock never runs behind what it has seen, and the next local change sorts after it.
  await G.merge(d, AD, [{ e: 'x', f: 'b', v: 9, t: t(now + 1000, 5), p: '' }], now);
  await G.edit(d, AD, { x: { a: 3, b: 9 } }, now);
  assert.ok(d.state.x.a[1] > t(now + 1000, 5));
  const later = d.held.splice(0);
  await G.merge(d, AD, later, now + 3 * 864e5);
  assert.equal(G.view(d).x.a, 2);
});

test('edit: deletions and restores are changes too, and a value too big to share stays local', async () => {
  const d = blank();
  assert.deepEqual(await G.edit(d, AD, { x: { a: 1 }, y: { a: 2 } }, 1e12), { n: 2, big: [] });
  assert.deepEqual(await G.edit(d, AD, { x: { a: 1 }, y: { a: 2 } }, 1e12), { n: 0, big: [] });
  await G.edit(d, AD, { x: { a: 1 } }, 1e12);
  assert.deepEqual(G.view(d), { x: { a: 1 } });
  await G.edit(d, AD, { x: { a: 1 }, y: { a: 2 } }, 1e12);
  assert.deepEqual(G.view(d), { x: { a: 1 }, y: { a: 2 } });
  // A restore sends its fields again; a deleted entity's fields aren't sent again with the whole state.
  assert.deepEqual(d.pending.flat().map((o) => [o.e, o.f, o.v]), [['x', 'a', 1], ['y', 'a', 2], ['y', 'del', true], ['y', 'del', false], ['y', 'a', 2]]);
  await G.edit(d, AD, { x: { a: 1 } }, 1e12);
  assert.deepEqual(G.everything(d).flat().map((o) => [o.e, o.f]).sort(), [['x', 'a'], ['y', 'del']]);
  const big = { fields: ['t'], clean: (f, v) => v };
  const n = blank();
  assert.deepEqual(await G.edit(n, big, { a: { t: 'x'.repeat(G.LIMIT.op) }, b: { t: 'ok' } }, 1e12), { n: 1, big: ['a'] });
  assert.deepEqual(G.view(n), { b: { t: 'ok' } });
  await assert.rejects(G.edit({ ...blank(), seed: undefined }, AD, { x: { a: 1 } }, 1e12), /read-only/);
});

test('conflicts: the device whose concurrent edit lost is the one that sees it lost', async () => {
  const a = blank('aaaaaaaa'), b = blank('bbbbbbbb');
  await G.edit(a, AD, { x: { a: 1, b: 1 } }, 1e12);
  const base = a.pending.splice(0).flat();
  await G.merge(b, AD, base, 1e12);
  // Both change b from the same value; b's change is later, so it wins everywhere.
  await G.edit(a, AD, { x: { a: 1, b: 2 } }, 1e12 + 1);
  await G.edit(b, AD, { x: { a: 1, b: 3 } }, 1e12 + 2);
  const fromA = a.pending.splice(0).flat(), fromB = b.pending.splice(0).flat();
  assert.deepEqual(await G.merge(b, AD, fromA, 1e12), []); // b's own value stays: nothing lost here
  assert.deepEqual(await G.merge(a, AD, fromB, 1e12), [{ e: 'x', f: 'b', v: 2 }]); // a's 2 was displaced
  assert.deepEqual(G.view(a), G.view(b));
  // A change made on top of a's value is an edit, not a conflict.
  await G.edit(a, AD, { x: { a: 1, b: 6 } }, 1e12 + 5);
  await G.merge(b, AD, a.pending.splice(0).flat(), 1e12);
  await G.edit(b, AD, { x: { a: 1, b: 7 } }, 1e12 + 6);
  assert.deepEqual(await G.merge(a, AD, b.pending.splice(0).flat(), 1e12), []);
  assert.equal(G.view(a).x.b, 7);
});

test('adapters: notes come in sanitized, a Look only as a code Glaze accepts', async () => {
  const notes = G.ADAPTERS.notes;
  assert.equal(await notes.clean('html', '<p onclick="x()">hi<script>alert(1)</script><img src=x onerror=alert(1)></p>'), '<p>hi</p>');
  assert.equal(await notes.clean('html', 42), undefined);
  assert.equal(await notes.clean('title', 'x'.repeat(301)), undefined);
  assert.deepEqual(notes.copyOf({ title: 'Week 1' }, 'html', '<p>mine</p>'), { title: 'Week 1 (conflict copy)', html: '<p>mine</p>' });
  const look = G.ADAPTERS.look;
  const code = await L.encode(D.GZ_SANITIZE({}));
  assert.equal(await look.clean('code', code), code);
  assert.equal(await look.clean('code', code.slice(0, -4)), undefined);
  assert.equal(await look.clean('code', 'glaze1:' + 'A'.repeat(50)), undefined);
  assert.equal(await look.clean('name', 'Frost'), 'Frost');
  assert.equal(await look.clean('name', { x: 1 }), undefined);
});

test('adapters: a notes file is a reference checked field by field', async () => {
  const notes = G.ADAPTERS.notes;
  const ref = { id: 'A'.repeat(22), h: 'B'.repeat(43), s: 1234, n: 'diagram.png', t: 'Image/PNG' };
  assert.deepEqual(await notes.clean('file', { ...ref, extra: 1 }), { ...ref, t: 'image/png' });
  for (const bad of [null, 'x', { ...ref, id: '../x' }, { ...ref, h: 'short' }, { ...ref, s: -1 }, { ...ref, s: (20 << 20) + 1 }, { ...ref, n: 'x'.repeat(201) }, { ...ref, t: 'text/html; x=1' }]) {
    assert.equal(await notes.clean('file', bad), undefined, JSON.stringify(bad));
  }
});

// The extension loads these as classic scripts in one page, with no require(): the adapters must find the codecs there
// (lib/share.js declares GZ_SHARE as a top-level const, which isn't a property of globalThis).
test('adapters work as classic scripts, without require()', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const ctx = vm.createContext({ crypto, TextEncoder, TextDecoder, Blob, CompressionStream, DecompressionStream, btoa, atob, URL, console });
  // The worker's order (lib/background.js importScripts), then this file.
  for (const f of ['lib/color.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js', 'lib/cards.js', 'lib/lookparts.js', 'lib/share.js', 'lib/doctext.js', 'lib/notes.js', 'lib/sharing.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  const code = await L.encode(D.GZ_SANITIZE({}));
  assert.equal(await vm.runInContext('GZ_SHARING.ADAPTERS.look.clean', ctx)('code', code), code);
  assert.equal(await vm.runInContext('GZ_SHARING.ADAPTERS.notes.clean', ctx)('html', '<p>hi<script>x</script></p>'), '<p>hi</p>');
});

test('keys for Export all: a new computer can rejoin, and the creator can still delete', async () => {
  const st = G.create('notes', { server: 'https://share.example', expire: true });
  const rec = G.exportKeys(st);
  assert.deepEqual(Object.keys(rec).sort(), ['del', 'expire', 'seed', 'server', 'sid', 'type', 'v']);
  const back = G.importKeys(JSON.parse(JSON.stringify(rec)));
  assert.deepEqual([back.sid, back.seed, back.del, back.expire, back.type, back.made, back.cursor], [st.sid, st.seed, st.del, true, 'notes', true, 0]);
  assert.notEqual(back.actor, st.actor); // a new device writes as itself
  const reader = G.join(await G.session(st).link(false), false);
  assert.deepEqual(Object.keys(G.exportKeys(reader)).sort(), ['pub', 'secret', 'server', 'sid', 'type', 'v']);
  for (const bad of [null, { ...rec, v: 2 }, { ...rec, server: 'http://share.example' }, { ...rec, sid: 'x' }, { ...rec, type: 'nope' }, { ...rec, seed: 'x' },
    { ...rec, del: 'x' }, { v: 1, type: null, server: 'https://share.example', sid: st.sid, secret: 'A'.repeat(43), pub: 'A'.repeat(43), del: 'A'.repeat(43) }]) {
    assert.equal(G.importKeys(bad), null, JSON.stringify(bad));
  }
  assert.equal(G.SERVER, 'https://share.frostdev.io');
  assert.equal(G.create('look').server, G.SERVER);
});
