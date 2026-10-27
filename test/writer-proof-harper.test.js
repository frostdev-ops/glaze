// lib/harper/shared.js with the real Harper (lib/harper, the slim wasm), run here as the SharedWorker it is: two frames'
// ports, the fixture texts' issues, each frame's words and ignores, the shared dictionary, a newer lint replacing a queued
// one, frames served in turn, one Harper for both, and the worker closing when idle. In the browser:
// scripts/writer-proof-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const P = require('../lib/writer-proof.js');

const root = path.join(__dirname, '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/writer-proof-texts.json'), 'utf8')).texts;

// The worker's world: a SharedWorkerGlobalScope's onconnect and close, and fetch reading the binary from disk.
let closed = 0;
const port = () => {
  const p = { got: [], waits: [], onmessage: null };
  p.postMessage = (m) => { p.got.push(m); for (const w of p.waits.splice(0)) w(); };
  p.send = (m) => p.onmessage({ data: m });
  p.next = async (pred) => { for (;;) { const hit = p.got.find(pred); if (hit) { p.got.splice(p.got.indexOf(hit), 1); return hit; } await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('worker reply timed out')), 15000); p.waits.push(() => { clearTimeout(timer); resolve(); }); }); } };
  return p;
};
let ids = 0;
const lint = async (p, text, key) => { const id = ++ids; p.send({ op: 'lint', id, text, key }); return p.next((m) => m.op === 'lint' && m.id === id); };
const start = (async () => {
  globalThis.onconnect = null;
  globalThis.close = () => { closed++; };
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => (String(u).startsWith('file:') ? new Response(fs.readFileSync(new URL(String(u))), { headers: { 'content-type': 'application/wasm' } }) : real(u));
  await import(pathToFileURL(path.join(root, 'lib/harper/shared.js')).href);
  const a = port(), b = port();
  globalThis.onconnect({ ports: [a] });
  globalThis.onconnect({ ports: [b] });
  return { a, b };
})();

test('the fixture texts give the expected issues, and only Typo, Capitalization and Repetition with one suggestion are sure', async () => {
  const { a } = await start;
  for (const f of fixtures) {
    const r = await lint(a, f.text);
    assert.ok(!r.error, r.error);
    const got = r.lints.map((l) => ({ l, i: P.toIssue(l) })).map(({ l, i }) => ({ problem: f.text.slice(i.start, i.end), kind: i.kind, rule: i.rule, sure: i.sure, first: i.suggestions[0], match: l.problem }));
    assert.deepEqual(got.map(({ match, ...g }) => g), f.expect, f.text);
    for (const g of got) assert.equal(g.problem, g.match, 'UTF-16 spans');
  }
});

test('a paragraph relints in well under 50 ms once Harper is warm', async () => {
  const { a } = await start;
  const ms = [];
  for (let n = 0; n < 5; n++) ms.push((await lint(a, fixtures[2].text)).ms);
  ms.sort((x, y) => x - y);
  assert.ok(ms[2] < 50, `median ${ms[2]} ms`);
});

test('each frame\'s words and ignores are its own; the dictionary is shared', async () => {
  const { a, b } = await start;
  const text = 'When Sethe returns to Glazeville, the memory is not hers.';
  const flagged = async (p) => (await lint(p, text)).lints.map((l) => l.problem).sort();
  assert.deepEqual(await flagged(a), ['Glazeville', 'Sethe']);
  a.send({ op: 'words', words: ['Sethe'] });
  assert.deepEqual(await flagged(a), ['Glazeville'], 'the box\'s context words');
  assert.deepEqual(await flagged(b), ['Glazeville', 'Sethe'], 'not another box\'s');
  b.send({ op: 'dict', words: ['glazeville'] });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(await flagged(a), [], 'the student\'s dictionary reaches every box, any case');
  const sethe = (await lint(b, text)).lints[0];
  b.send({ op: 'ignore', kind: sethe.kind, problem: sethe.problem, message: sethe.message });
  assert.deepEqual(await flagged(b), [], 'ignored in that box');
  a.send({ op: 'words', words: [] });
  assert.deepEqual(await flagged(a), ['Sethe'], 'and still flagged in the other');
});

test('a newer lint of the same paragraph replaces a queued one, and frames are served in turn', async () => {
  const { a, b } = await start;
  const long = Array(80).fill(fixtures[0].text).join(' ');
  const order = [];
  const watch = (p, name) => { const was = p.postMessage; p.postMessage = (m) => { if (m.op === 'lint') order.push(`${name}${m.stale ? '-stale' : ''}:${m.id}`); was(m); }; return () => { p.postMessage = was; }; };
  const ua = watch(a, 'a'), ub = watch(b, 'b');
  const base = ids;
  a.send({ op: 'lint', id: ++ids, text: long });
  a.send({ op: 'lint', id: ++ids, text: 'one', key: 'p1' });
  a.send({ op: 'lint', id: ++ids, text: 'two', key: 'p1' });
  a.send({ op: 'lint', id: ++ids, text: 'three' });
  b.send({ op: 'lint', id: ++ids, text: 'four' });
  for (let id = base + 1; id <= ids; id++) await (id <= base + 4 ? a : b).next((m) => m.id === id);
  ua(); ub();
  assert.deepEqual(order, [`a-stale:${base + 2}`, `a:${base + 1}`, `b:${base + 5}`, `a:${base + 3}`, `a:${base + 4}`]);
});

test('a 10,000-word paper has valid whole-document spans and measured warm lint cost', async (t) => {
  const { a } = await start;
  const seed = fixtures[0].text.split(/\s+/), text = Array.from({ length: 10000 }, (_, i) => seed[i % seed.length]).join(' ');
  const ms = [];
  for (let n = 0; n < 5; n++) {
    const r = await lint(a, text, 'paper'); assert.ok(!r.error, r.error); ms.push(r.ms);
    for (const l of r.lints) assert.equal(text.slice(l.start, l.end), l.problem);
  }
  ms.sort((a, b) => a - b);
  t.diagnostic(`10000 words, ${text.length} UTF-16 units: median ${ms[2].toFixed(1)} ms, max ${ms[4].toFixed(1)} ms`);
});

test('one Harper for every frame, and it closes when idle, telling them', async () => {
  const { a, b } = await start;
  a.send({ op: 'stats', id: 1 });
  b.send({ op: 'stats', id: 2 });
  const [sa, sb] = [await a.next((m) => m.op === 'stats'), await b.next((m) => m.op === 'stats')];
  assert.equal(sa.worker, sb.worker);
  assert.deepEqual([sa.ports, sa.loads, sa.loaded], [2, 1, true]);
  a.send({ op: 'idle', ms: 1000 });
  await Promise.all([a.next((m) => m.op === 'closing'), b.next((m) => m.op === 'closing')]);
  assert.equal(closed, 1);
});
