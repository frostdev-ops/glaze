// Spans (ai/schema.js span, ai/local/grammar.js compile's sources): a string Glaze's own model can only write as words of
// its source. A stub model that spells a misspelt word its own way is held to the draft's spelling, and writer.review keeps
// the issue; random walks over sources with escapes, control characters, a lone surrogate, combining marks and characters
// split across tokens end in JSON whose every span is in the source, folds as ai/text.js anchor and source() fold it, and
// keeps its bounds; a missing or empty source is an ordinary string; and no provider is sent the keyword.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../extension/ai/local/grammar.js');
const S = require('../../extension/ai/schema.js');
const X = require('../../extension/ai/text.js');
const T = require('../../extension/ai/task.js');
require('../../extension/ai/providers/mock.js');
const RV = require('../../extension/ai/tasks/writer-review.js');
const CT = require('../../extension/ai/tasks/writer-cite.js');

const enc = new TextEncoder(), dec = new TextDecoder();
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---- a vocabulary: every byte, JSON's runs, the tasks' keys, words whole and cut, escapes, characters split --------------
const keys = (s, out = new Set()) => {
  if (!s || typeof s !== 'object') return out;
  for (const k of Object.keys(s.properties || {})) out.add(k);
  for (const v of s.enum || []) if (typeof v === 'string') out.add(v);
  for (const v of Object.values(s)) keys(v, out);
  return out;
};
const VOCAB = (() => {
  const list = [];
  const add = (x) => list.push(typeof x === 'string' ? enc.encode(x) : Uint8Array.from(x));
  for (let b = 0; b < 256; b++) add([b]);
  for (const s of ['{"', '"}', '":', '":"', '","', '"]', '"],"', '},{"', '}]', '}]}', '"}]}', '":[', '":[]', '":["', '":null', 'null', '[]', '{}', '"},{"',
    '.",', '."', ' "', '\\"', '\\\\', '\\n', '\\t', '\\/', '\\u', '\\u00', '\\u0001', '\\u001F', '01', 'u00', 'pave', 'pavem', 'nts', 'etns', 'ments',
    ' were', 'The', ' pave', 'were', ' cracked', 'cracked', 'crack', 'ed', ' the', ' and', ' a', 'ing', 'tion', 'Smith', ' Smith', 'John', 'Journal', ' of'])
    add(s);
  for (const w of keys([RV.OUTPUT, CT.OUTPUT])) { add(w); add(`"${w}"`); add(`"${w}":"`); add(`,"${w}":"`); }
  for (const s of ['é', ' café', 'naïve', '€', '中文', '😀', 'e\u0301', '\u0301']) {
    const b = enc.encode(s);
    add(b);
    for (let i = 1; i < b.length; i++) { add(b.slice(0, i)); add(b.slice(i)); }
  }
  return { bytes: [...list, null], eos: list.length };
})();
const V = G.vocab(VOCAB.bytes, { eos: [VOCAB.eos] });
const EOS = VOCAB.eos;
const on = (m, id) => ((m[id >>> 5] >>> (id & 31)) & 1) === 1;
const allowed = (m) => { const out = []; for (let w = 0; w < m.length; w++) for (let x = m[w]; x; x &= x - 1) out.push(w * 32 + 31 - Math.clz32(x & -x)); return out; };
const text = (ids) => dec.decode(Uint8Array.from(ids.flatMap((id) => [...VOCAB.bytes[id]])));

// A stub model: it writes `want` where the mask lets it, the longest token that does; where it can't, it spells on in
// letters (the longest allowed run), and out of letters takes `want` up again at its next quote.
const stub = (g, want) => {
  const w = enc.encode(want), m = g.matcher(), out = [];
  let at = 0;
  for (let n = 0; n < 4000; n++) {
    const mask = m.mask();
    if (at >= w.length) { assert.ok(on(mask, EOS), 'the answer is whole'); m.advance(EOS); return text(out); }
    let best = -1;
    for (const id of allowed(mask)) {
      const b = VOCAB.bytes[id];
      if (b && b.length <= w.length - at && b.every((x, i) => x === w[at + i]) && (best < 0 || b.length > VOCAB.bytes[best].length)) best = id;
    }
    if (best >= 0) { at += VOCAB.bytes[best].length; out.push(best); m.advance(best); continue; }
    for (const id of allowed(mask)) { const b = VOCAB.bytes[id]; if (b && b.every((x) => x >= 0x61 && x <= 0x7a) && (best < 0 || b.length > VOCAB.bytes[best].length)) best = id; }
    if (best >= 0) { out.push(best); m.advance(best); continue; }
    const q = w.indexOf(0x22, at + 1);
    assert.ok(q > at, `the stub is stuck at ${want.slice(0, at)}`);
    at = q;
  }
  throw new Error('the stub never finished');
};

test('a model that re-spells the word it quotes is held to the draft\'s spelling, and writer.review keeps the issue', () => {
  const draft = 'The pavemetns were cracked.';
  const want = JSON.stringify({ issues: [{ quote: 'pavemnts', before: 'The', after: 'were', kind: 'spelling', message: 'Spelling.', suggestions: ['pavements'] }] });
  const check = (answer) => RV.task.check(JSON.parse(answer), { text: draft });
  // Unheld (a cloud provider's schema, or no draft to hold it to), the stub writes its own spelling, and the issue is lost.
  const free = stub(G.compile(RV.OUTPUT, V), want);
  assert.equal(JSON.parse(free).issues[0].quote, 'pavemnts');
  assert.deepEqual(check(free).issues, []);
  const held = stub(G.compile(RV.OUTPUT, V, { sources: { draft } }), want);
  assert.equal(JSON.parse(held).issues[0].quote, 'pavemetns');
  assert.deepEqual(check(held).issues.map((i) => [i.quote, i.start, i.end, i.kind]), [['pavemetns', 4, 13, 'spelling']]);
});

// ---- random walks ---------------------------------------------------------------------------------------------------
const SOURCE = 'The pavemetns were "cracked" — a \\ back\nslash\tand naïve café e\u0301 x \u0001 😀 中文 \ud800 Smith, John. Journal of 2020 end.';
const span = (o, extra = {}) => ({ type: 'string', ...extra, span: { source: 'src', ...o } });
const WALK = S.obj({
  list: { type: 'array', maxItems: 3, items: S.obj({
    q: span({ min: 1 }, { maxLength: 12 }), b: span({}, { maxLength: 6 }), w: span({ min: 1, word: true }, { maxLength: 30 }),
    t: { ...span({ min: 3 }, { maxLength: 40 }), type: ['string', 'null'] }, f: { type: 'string', maxLength: 4 },
  }, ['q', 'b', 'w', 't', 'f']) },
}, ['list']);
const WORD = (v, page) => { const value = X.norm(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(`(?<![\\p{L}\\p{N}])${value}(?![\\p{L}\\p{N}])`, 'u').test(X.norm(page)); };
const once = (hay, v) => hay.indexOf(v) >= 0 && hay.indexOf(v) === hay.lastIndexOf(v);
// A walk: a random allowed token each step, leaning to the end and to quotes; each step's mask agrees with advance() on a
// token it allows and one it doesn't, and what it allows can still finish.
const walk = (g, r, source) => {
  const m = g.matcher(), ids = [];
  for (let n = 0; n < 3000; n++) {
    const mask = m.mask(), ok = allowed(mask);
    assert.ok(ok.length > 0, `a dead end after ${JSON.stringify(text(ids))}`);
    if (on(mask, EOS) && r() < 0.6) { m.advance(EOS); return text(ids); }
    const no = Math.floor(r() * V.size);
    if (!on(mask, no) && no !== EOS && VOCAB.bytes[no]) assert.throws(() => m.fork().advance(no), RangeError);
    const quoted = ok.filter((id) => id !== EOS && VOCAB.bytes[id].includes(0x22));
    const id = quoted.length && r() < 0.3 ? quoted[Math.floor(r() * quoted.length)] : ok[Math.floor(r() * ok.length)];
    if (id === EOS) { m.advance(EOS); return text(ids); }
    m.advance(id); ids.push(id);
  }
  throw new Error(`no end: ${source}`);
};

test('random walks: every span is words of its source, folds as anchor and source() fold it, and keeps its bounds', () => {
  const g = G.compile(WALK, V, { sources: { src: SOURCE } });
  assert.equal(g.exact, true);
  const r = rng(91);
  let spans = 0;
  for (let i = 0; i < 150; i++) {
    const out = walk(g, r, SOURCE);
    const v = JSON.parse(out);
    assert.deepEqual(S.validate(v, WALK), [], out);
    for (const it of v.list) {
      for (const [k, min] of [['q', 1], ['b', 0], ['w', 1], ['t', 3]]) {
        const s = it[k];
        if (s === null) continue;
        spans++;
        assert.ok(SOURCE.includes(s), `${k} ${JSON.stringify(s)} is in the source`);
        if (min) assert.ok(X.source(SOURCE, { min }).has(s), `${k} ${JSON.stringify(s)} grounds with min ${min}`);
        if (min && once(X.norm(SOURCE), X.norm(s))) assert.ok(X.anchor(SOURCE, s, { min }), `${k} ${JSON.stringify(s)} anchors with min ${min}`);
      }
      assert.ok(WORD(it.w, SOURCE), `w ${JSON.stringify(it.w)} is whole words of the page`);
    }
  }
  assert.ok(spans > 200, `${spans} spans`);
});

test('escapes as JSON.stringify writes them; characters whole; no start on a combining mark, no end before one', () => {
  const src = 'a "q" \\ b\nc\td \u0001 é e\u0301 😀';
  const g = G.compile(S.obj({ q: span({ min: 1 }) }, ['q']), V, { sources: { src } });
  const after = (s) => { const m = g.matcher(); for (const b of [...enc.encode('{"q":"'), ...(typeof s === 'string' ? enc.encode(s) : s)]) m.advance(b); return m; };
  const takes = (s) => { try { after(s); return true; } catch { return false; } };
  for (const s of ['a \\"q\\"', '\\\\ b\\nc\\td', '\\u0001', 'é', 'e\u0301', '😀']) assert.ok(takes(s), s);
  for (const s of ['a \\"q\\" \\/', '\\u001F', '\\u00e9', 'b\nc', '\\u000a', '\u0301', 'zz']) assert.ok(!takes(s), s);
  // The end: after a whole character only, never between e and its accent; a span may end at the source's very end.
  const closes = (s) => on(after(s).mask(), 0x22);
  assert.ok(closes('e\u0301'));
  assert.ok(!closes('é e'));
  assert.ok(closes('😀'));
  assert.ok(!on(after(enc.encode('😀').slice(0, 2)).mask(), 0x22), 'not inside a character');
  // A token split across a character, and one that closes the span and goes on into the object.
  const m = after('d ');
  assert.ok(on(m.mask(), VOCAB.bytes.findIndex((b) => b && b.length === 1 && b[0] === 0x5c)), 'the backslash of \\u0001');
  const closer = VOCAB.bytes.findIndex((b) => b && dec.decode(b) === '"}');
  assert.ok(on(after('a').mask(), closer));
});

test('min and maxLength: at least min characters that fold to something, at most maxLength characters', () => {
  const src = 'x   \u00ad  yz';
  const g = G.compile(S.obj({ q: span({ min: 2 }, { maxLength: 4 }) }, ['q']), V, { sources: { src } });
  const r = rng(7);
  for (let i = 0; i < 60; i++) {
    const q = JSON.parse(walk(g, r, src)).q;
    assert.ok(src.includes(q) && [...q].length <= 4 && X.source(src, { min: 2 }).has(q), JSON.stringify(q));
  }
  // No span of this source holds two such characters within three: an ordinary string.
  const m = G.compile(S.obj({ q: span({ min: 2 }, { maxLength: 3 }) }, ['q']), V, { sources: { src: 'x    y' } }).matcher();
  for (const b of enc.encode('{"q":"zzz"}')) m.advance(b);
  assert.ok(m.complete);
});

test('a source that is missing, empty or holds no span: an ordinary string, never a dead end', () => {
  const schema = S.obj({ q: span({ min: 1 }, { maxLength: 8 }), b: span({}, { maxLength: 8 }) }, ['q', 'b']);
  const r = rng(3);
  for (const sources of [undefined, {}, { other: 'zzz' }, { src: '' }, { src: '   \n ' }, { src: '\u0301' }]) {
    const g = G.compile(schema, V, sources ? { sources } : {});
    for (let i = 0; i < 20; i++) {
      const v = JSON.parse(walk(g, r, JSON.stringify(sources)));
      assert.deepEqual(S.validate(v, schema), []);
      if (sources?.src !== undefined) assert.ok(sources.src.includes(v.b), `b ${JSON.stringify(v.b)} is still a span (empty, at least)`);
    }
    // The quote, with nothing to copy, takes any string.
    const m = g.matcher();
    for (const b of enc.encode('{"q":"zz')) m.advance(b);
  }
  assert.throws(() => G.compile(schema, V, { sources: { src: 1 } }), /sources/);
});

test('no provider is sent span: a task\'s request carries its schema bare, the same as before the keyword', async () => {
  for (const s of [RV.OUTPUT, CT.OUTPUT]) {
    assert.ok(JSON.stringify(s).includes('"span"'));
    assert.ok(!JSON.stringify(S.bare(s)).includes('"span"'));
    assert.equal(S.bare(S.bare(s)), S.bare(s));
    assert.deepEqual(S.validate({ issues: [] }, RV.OUTPUT), []);
  }
  const plain = S.obj({ span: S.str('a property named span stays') }, ['span']);
  assert.equal(S.bare(plain), plain);
  assert.equal(S.clean({ type: 'string', span: { source: 'draft', min: 65 } }), null);
  assert.equal(S.clean({ type: 'string', span: { source: 'draft', at: 1 } }), null);
  const cfg = { replies: [{ json: { issues: [] } }], seen: [] };
  await T.run(RV.task, { text: 'The pavemetns were cracked.' }, { provider: 'mock', cfg });
  assert.ok(!JSON.stringify(cfg.seen[0].schema).includes('"span"'));
  assert.deepEqual(cfg.seen[0].schema, S.bare(RV.OUTPUT));
});
