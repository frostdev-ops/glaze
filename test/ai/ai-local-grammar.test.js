// Constrained JSON decoding for the local engine (ai/local/grammar.js). Random walks over every task's schema, a random
// sampler picking among the tokens the mask allows, must end in JSON that validate() accepts, every time; the mask must
// equal advancing each token one by one; and after every allowed token the answer can still be finished. Then the edges:
// empty arrays and objects, \u escapes and surrogate pairs, UTF-8 split across tokens, nesting limits, optional and
// required properties, enum strings that share a prefix, number bounds.
// The vocabulary is a seeded byte-level one built here (LFM3's tokenizer.json stays out of the repo); point
// GZ_LFM3_TOKENIZER at it to run the same walks over the real one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const G = require('../../extension/ai/local/grammar.js');
const S = require('../../extension/ai/schema.js');

const enc = new TextEncoder();
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---- the tasks' schemas ---------------------------------------------------------------------------------------------
const tasks = {
  syllabus: require('../../extension/ai/tasks/syllabus-read.js'),
  cite: require('../../extension/ai/tasks/writer-cite.js'),
  decide: require('../../extension/ai/tasks/writer-decide.js'),
  outline: require('../../extension/ai/tasks/writer-outline.js'),
  requirements: require('../../extension/ai/tasks/writer-requirements.js'),
  review: require('../../extension/ai/tasks/writer-review.js'),
  image: require('../../extension/ai/tasks/writer-image.js'),
  feedback: require('../../extension/ai/tasks/writer-feedback.js'),
};
// writer.feedback builds its local schemas inside orchestrate (rowSchema, decisionSchema, scanSchema, COMMENT, SUMMARY):
// the same shapes here, with passage ids as its catalog makes them (d-0, d-70, d-140…, sharing prefixes).
const lean = (v) => (Array.isArray(v) ? v.map(lean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'description').map(([k, x]) => [k, lean(x)])) : v);
const feedbackLocal = () => {
  const row = lean(tasks.feedback.OUTPUT);
  delete row.properties.grade;
  row.properties.criteria.maxItems = 1; row.properties.criteria.minItems = 1;
  const p = row.properties.criteria.items.properties;
  const ids = ['d-0', 'd-7', 'd-70', 'd-700', 'd-7000'], facts = ['a1-0', 'a1-70', 'a10-0'];
  p.criterion = { enum: ['crit_1'] };
  p.level = { anyOf: [{ type: 'string', enum: ['Excellent', 'Excellent+', 'Good'] }, { type: 'null' }] };
  p.quotes = { type: 'array', maxItems: 2, items: { type: 'string', enum: ids } };
  p.score.maximum = 12.5;
  const decision = S.obj({ status: p.status, quotes: p.quotes, facts: { type: 'array', maxItems: 6, items: { type: 'string', enum: facts } },
    level: p.level, score: p.score, complete: { type: 'boolean' } }, ['status', 'quotes', 'facts', 'level', 'score', 'complete']);
  return {
    'feedback.row': row, 'feedback.decision': decision,
    'feedback.scan': S.obj({ quotes: { type: 'array', maxItems: 6, items: { type: 'string', enum: ids } }, complete: { type: 'boolean' } }, ['quotes', 'complete']),
    'feedback.comment': S.obj({ comment: { type: 'string', maxLength: 240 } }, ['comment']),
    'feedback.summary': S.obj({ summary: { type: 'string', maxLength: tasks.feedback.LIMIT.comment } }, ['summary']),
  };
};
const SCHEMAS = {
  'syllabus.read': tasks.syllabus.OUTPUT, 'writer.cite': tasks.cite.OUTPUT, 'writer.decide': tasks.decide.OUTPUT,
  'writer.outline': tasks.outline.OUTPUT, 'writer.outline.role': tasks.outline.ROLE, 'writer.outline.label': tasks.outline.LABEL,
  'writer.requirements': tasks.requirements.OUTPUT, 'writer.review': tasks.review.OUTPUT, 'writer.image': tasks.image.SCHEMA,
  'writer.feedback': tasks.feedback.OUTPUT, ...feedbackLocal(),
};

// ---- the vocabulary -------------------------------------------------------------------------------------------------
const words = (schema, out = new Set()) => {
  if (Array.isArray(schema)) { schema.forEach((x) => words(x, out)); return out; }
  if (!schema || typeof schema !== 'object') return out;
  for (const k of Object.keys(schema.properties || {})) out.add(k);
  for (const v of schema.enum || []) if (typeof v === 'string') out.add(v);
  for (const v of Object.values(schema)) words(v, out);
  return out;
};
// Every byte; LFM-style digit runs; JSON's punctuation in the runs a BPE learns; the schemas' keys and enum values whole,
// quoted and cut; words; escapes; characters whole and split across tokens; invalid UTF-8; seeded junk; a duplicate;
// and rows with no text, the last of them the end token.
const synthetic = () => {
  const r = rng(4011), list = [];
  const add = (x) => list.push(typeof x === 'string' ? enc.encode(x) : Uint8Array.from(x));
  for (let b = 0; b < 256; b++) add([b]);
  for (let n = 0; n < 1000; n++) { add(String(n)); if (n < 100) add(String(n).padStart(2, '0')); if (n < 10) add(`00${n}`); }
  for (const s of ['{"', '"}', '":', '":"', '","', '"]', '"],"', '},{"', '}]', '}],"', '":[', '":[]', '":[]}', '":{"', '":null', '":null}', '":true',
    '":false', '":-', '":0', '[]', '{}', '[{"', '"},', ',"', '"}],', ']}', '}}', '"}}', '"}]}', '","', '"],', '],"', 'null', 'nu', 'll', 'true',
    'tr', 'ue', 'false', 'fal', 'se', '-', '.', '.5', '0.', '-1', '1.25', '12.5', '\\', '\\"', '\\\\', '\\n', '\\t', '\\/', '\\u', '\\u00', 'e9',
    '\\ud83d', '\\ude00', '\\udc00', '\\uD83D\\uDE00', '\\u0041', 'ud', '83d', '\\x', '"\\', '."', '!"', ' "', '":"\\', 'null,"', '",', '"]}',
    ',', ':', '[', ']', '{', '}', '"', '":1', '":2', '0,"', '1}', '5]}', '"}]', '":["', '"],"'])
    add(s);
  for (const w of new Set([...Object.values(SCHEMAS).flatMap((s) => [...words(s)])])) {
    add(w); add(`"${w}"`); add(`"${w}`); add(`"${w}":`); add(`${w}"`);
    if (w.length > 2) { add(w.slice(0, Math.ceil(w.length / 2))); add(w.slice(Math.ceil(w.length / 2))); }
  }
  for (const w of ['the', ' the', 'The', ' and', 'ing', 'tion', ' of', ' a', ' to', 'Mor', 'rison', ' river', ' memory', 'Week', ' 3', 'Mon',
    ' 9', 'am', 'Room', ' 101', 'Dr', '.', ' Smith', '@', 'example', '.edu', 'Lecture', 'Lab', 'Exam', 'Final', '%', ' 20', '%"', 'A-', 'B+'])
    add(w);
  for (const s of ['é', ' café', '€', '中文', '😀', 'naïve', 'Ω', 'ß']) {
    const b = enc.encode(s);
    add(b);
    for (let i = 1; i < b.length; i++) { add(b.slice(0, i)); add(b.slice(i)); }
  }
  for (const bad of [[0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf5, 0x80, 0x80, 0x80], [0xff], [0xe0, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80], [0x01, 0x41]]) add(bad);
  const pool = 'abcdefghijklmnopqrstuvwxyz ABC0123456789",:{}[]\\-.é';
  for (let i = 0; i < 600; i++) { let s = ''; for (let n = 1 + Math.floor(r() * 5); n > 0; n--) s += pool[Math.floor(r() * pool.length)]; add(s); }
  for (let i = 0; i < 200; i++) add(Array.from({ length: 1 + Math.floor(r() * 3) }, () => Math.floor(r() * 256)));
  add('"}'); // the same bytes as an earlier id
  const bytes = [...list, null, null, null, null];
  return { bytes, eos: bytes.length - 1 };
};
const real = () => {
  const file = process.env.GZ_LFM3_TOKENIZER;
  if (!file) return null;
  const K = require('../../extension/ai/local/tokenizer.js');
  const tk = K.fromHF(JSON.parse(fs.readFileSync(file, 'utf8')), { eos: '<|im_end|>', rows: 128000 });
  return { bytes: tk.byteStrings(), eos: tk.eos };
};
const VOCAB = real() || synthetic();
const V = G.vocab(VOCAB.bytes, { eos: [VOCAB.eos] });
// Tokens holding a quote, bracket or brace, as a mask.
const CLOSING = new Uint32Array(V.words);
VOCAB.bytes.forEach((b, id) => { if (b && b.some((x) => x === 0x22 || x === 0x5d || x === 0x7d)) CLOSING[id >>> 5] |= 1 << (id & 31); });

// ---- walking --------------------------------------------------------------------------------------------------------
const allowed = (m) => {
  const out = [];
  for (let w = 0; w < m.length; w++) for (let x = m[w]; x; x &= x - 1) out.push(w * 32 + 31 - Math.clz32(x & -x));
  return out;
};
// A random sampler with a lean towards finishing: half the time the end token when it may come, half the time a token
// holding a quote, bracket or brace. It counts bits rather than listing ids: the real vocabulary has 128,000.
const bits = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
const nth = (m, and, r) => {
  let n = 0;
  for (let w = 0; w < m.length; w++) n += bits(and ? m[w] & and[w] : m[w]);
  if (!n) return -1;
  let k = Math.floor(r() * n);
  for (let w = 0; ; w++) {
    let x = and ? m[w] & and[w] : m[w];
    const c = bits(x);
    if (k >= c) { k -= c; continue; }
    for (; ; x &= x - 1) if (!k--) return w * 32 + 31 - Math.clz32(x & -x);
  }
};
const sample = (m, r) => {
  if ((m[VOCAB.eos >>> 5] >>> (VOCAB.eos & 31)) & 1 && r() < 0.5) return VOCAB.eos;
  const id = r() < 0.5 ? nth(m, CLOSING, r) : -1;
  return id >= 0 ? id : nth(m, null, r);
};
const text = (ids) => {
  const parts = ids.filter((id) => id !== VOCAB.eos).map((id) => VOCAB.bytes[id]);
  const all = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of parts) { all.set(b, o); o += b.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
};
// → the ids taken, ending with the end token, or throws with what went wrong.
const walk = (m, r, prefix = [], limit = 4000) => {
  const ids = [...prefix];
  while (!m.done) {
    if (ids.length > limit) throw new Error(`no end after ${limit} tokens: ${text(ids).slice(0, 200)}`);
    const id = sample(m.mask(), r);
    if (id < 0) throw new Error(`stuck with nothing allowed after ${JSON.stringify(text(ids))}`);
    m.advance(id);
    ids.push(id);
  }
  return ids;
};
const valid = (schema, ids) => {
  const t = text(ids);
  let v;
  try { v = JSON.parse(t); } catch (e) { return `not JSON (${e.message}): ${t.slice(0, 300)}`; }
  const errs = S.validate(v, schema);
  return errs.length ? `${errs.join('; ')}: ${t.slice(0, 300)}` : null;
};
const WALKS = Number(process.env.GZ_GRAMMAR_WALKS) || 1000;

for (const [name, schema] of Object.entries(SCHEMAS)) {
  test(`${name}: ${WALKS} random walks all end in JSON its schema accepts`, () => {
    const g = G.compile(schema, V), r = rng(name.length * 7919 + 1);
    assert.equal(g.exact, true);
    let tokens = 0;
    const bad = [];
    for (let i = 0; i < WALKS; i++) {
      const ids = walk(g.matcher(), r);
      tokens += ids.length;
      const why = valid(schema, ids);
      if (why) bad.push(why);
    }
    assert.deepEqual(bad.slice(0, 3), [], `${bad.length} of ${WALKS} invalid`);
    assert.ok(tokens > WALKS * 3);
  });
}

test('the mask is exactly the tokens that advance, and after each of them the answer can still be finished', () => {
  const r = rng(77);
  // Several states per schema, picked along random walks.
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const g = G.compile(schema, V);
    for (let n = 0; n < 3; n++) {
      const path = walk(g.matcher(), r);
      const at = Math.floor(r() * (path.length - 1));
      const m = g.matcher();
      for (const id of path.slice(0, at)) m.advance(id);
      const mask = m.mask();
      const want = new Set(allowed(mask));
      for (let id = 0; id < VOCAB.bytes.length; id++) {
        const fresh = m.fork();
        let ok = true;
        try { fresh.advance(id); } catch { ok = false; }
        assert.equal(want.has(id), ok, `${name} after ${JSON.stringify(text(path.slice(0, at)))}: token ${id} ${JSON.stringify(VOCAB.bytes[id] && Buffer.from(VOCAB.bytes[id]).toString('latin1'))}`);
        if (!ok || id === VOCAB.eos) continue;
        // Finishing from there: every allowed token leaves a state that ends in a valid answer.
        const ids = walk(fresh, r, [...path.slice(0, at), id]);
        assert.equal(valid(schema, ids), null);
      }
    }
  }
});

// ---- edges ----------------------------------------------------------------------------------------------------------
// The tokens spelling s exactly, one byte each (every byte is a token in the synthetic vocabulary).
const byteIds = (s) => [...(typeof s === 'string' ? enc.encode(s) : s)].map((b) => VOCAB.bytes.findIndex((x) => x && x.length === 1 && x[0] === b));
// Whether a matcher takes the bytes of s and then, when end is set, may end there.
const takes = (schema, s, end = true) => {
  const m = G.compile(schema, V).matcher();
  try { for (const id of byteIds(s)) m.advance(id); } catch { return false; }
  return end ? m.complete : true;
};
const accepts = (schema, s) => {
  const ok = takes(schema, s);
  if (ok) assert.deepEqual(S.validate(JSON.parse(s), schema), [], s);
  return ok;
};

test('empty arrays and objects', () => {
  assert.ok(accepts({ type: 'array' }, '[]'));
  assert.ok(accepts({ type: 'array', maxItems: 0 }, '[]'));
  assert.ok(!takes({ type: 'array', maxItems: 0 }, '[1', false));
  assert.ok(!takes({ type: 'array', minItems: 1, items: { type: 'integer' } }, '[]'));
  assert.ok(accepts(S.obj({}), '{}'));
  assert.ok(!takes(S.obj({}), '{"', false), 'a closed object with no properties is only {}');
  assert.ok(accepts(S.obj({ a: { type: 'array', items: { type: 'string' } } }, ['a']), '{"a":[]}'));
  assert.ok(accepts({ type: 'object' }, '{}'));
  assert.ok(accepts({ type: 'object' }, '{"x":[{}],"y":null}'));
  assert.ok(accepts(tasks.review.OUTPUT, '{"issues":[]}'));
  // An array whose items nothing fits is only [].
  assert.ok(accepts({ type: 'array', items: { type: 'string', minLength: 3, maxLength: 2 } }, '[]'));
  assert.throws(() => G.compile({ type: 'array', minItems: 1, items: { enum: [] } }, V), /outside|fits/);
});

test('strings: escapes, \\u escapes, surrogate pairs, UTF-8 split across tokens, lengths in code points', () => {
  const s = { type: 'string' };
  for (const ok of ['"a\\"b"', '"\\\\"', '"\\/\\b\\f\\n\\r\\t"', '"\\u0041\\u00e9\\uFFFF"', '"\\ud83d\\ude00"', '"\\uD83D\\uDE00x"', '"é€😀中"', '""'])
    assert.ok(accepts(s, ok), ok);
  for (const bad of ['"\\x"', '"\\udc00"', '"\\ud83d"', '"\\ud83dx"', '"\\ud83d\\u0041"', '"\\u12G4"', '"a\nb"', '"\u0001"']) assert.ok(!takes(s, bad), bad);
  for (const bytes of [[0x22, 0xc0, 0x80, 0x22], [0x22, 0xed, 0xa0, 0x80, 0x22], [0x22, 0xf4, 0x90, 0x80, 0x80, 0x22], [0x22, 0xe2, 0x82, 0x22], [0x22, 0xff, 0x22]])
    assert.ok(!takes(s, Uint8Array.from(bytes)), bytes.join(' '));
  // A token may end inside a character: the split halves of € and 😀 are allowed in turn, the quote not between them.
  const m = G.compile(s, V).matcher();
  const id = (b) => VOCAB.bytes.findIndex((x) => x && x.length === b.length && x.every((v, i) => v === b[i]));
  m.advance(id([0x22]));
  const euro = enc.encode('€');
  assert.ok(allowed(m.mask()).includes(id(euro.slice(0, 1))));
  m.advance(id(euro.slice(0, 1)));
  const mid = new Set(allowed(m.mask()));
  assert.ok(mid.has(id(euro.slice(1))) && !mid.has(id([0x22])) && !mid.has(id([0x41])) && !mid.has(VOCAB.eos));
  m.advance(id(euro.slice(1)));
  m.advance(id([0x22]));
  assert.ok(m.complete);
  // Lengths count code points, as validate() does: a pair is one, so is a 4-byte character, an escape is one.
  const one = { type: 'string', minLength: 1, maxLength: 1 };
  for (const ok of ['"\\ud83d\\ude00"', '"😀"', '"\\n"', '"é"']) assert.ok(accepts(one, ok), ok);
  for (const bad of ['""', '"ab"', '"\\n\\n"', '"😀a"']) assert.ok(!takes(one, bad), bad);
  assert.ok(!takes({ type: 'string', minLength: 2 }, '"a"'));
});

test('nesting: the schema subset\'s depth limit, and values with no schema stop nesting at LIMIT.depth', () => {
  let deep = { type: 'integer' };
  for (let i = 0; i < 6; i++) deep = { type: 'array', items: deep, maxItems: 2 };
  assert.ok(accepts(deep, '[[[[[[1]]]]]]'));
  assert.ok(accepts(deep, '[[],[[[[[2,3]]]]]]'));
  assert.ok(!takes(deep, '[[[[[[[', false));
  let tooDeep = { type: 'integer' };
  for (let i = 0; i < 13; i++) tooDeep = { type: 'array', items: tooDeep };
  assert.throws(() => G.compile(tooDeep, V), /subset/);
  const free = { type: 'array' };
  assert.ok(takes(free, '['.repeat(G.LIMIT.depth), false));
  assert.ok(!takes(free, '['.repeat(G.LIMIT.depth + 1), false));
  assert.ok(accepts(free, `${'['.repeat(G.LIMIT.depth)}1${']'.repeat(G.LIMIT.depth)}`));
});

test('properties: in the schema\'s order, required ones always, optional ones skippable, extra keys only when open', () => {
  const s = { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'boolean' }, c: { type: 'null' } }, required: ['b'], additionalProperties: false };
  for (const ok of ['{"b":true}', '{"a":1,"b":false}', '{"b":true,"c":null}', '{"a":1,"b":true,"c":null}']) assert.ok(accepts(s, ok), ok);
  for (const bad of ['{}', '{"a":1}', '{"c":null,"b":true}', '{"b":true,"a":1}', '{"b":true,"d":1}', '{"b":true,}', '{"b":true,"b":true}']) assert.ok(!takes(s, bad), bad);
  const open = { ...s, additionalProperties: true };
  assert.ok(accepts(open, '{"b":true,"d":[1,"x"],"e":{}}'));
  assert.ok(!takes(open, '{"b":true,"a":1}'), 'an extra key never repeats a declared name');
  assert.ok(!takes(open, '{"d":1,"b":true}'), 'extra keys come after the required ones');
  // A required key with no property schema takes any value; with additionalProperties false nothing fits.
  assert.ok(accepts({ type: 'object', required: ['z'] }, '{"z":[true]}'));
  assert.throws(() => G.compile({ type: 'object', required: ['z'], additionalProperties: false }, V), /fits/);
  // Keys that share a prefix.
  const pre = S.obj({ ab: { type: 'null' }, a: { type: 'null' }, abc: { type: 'null' } });
  for (const ok of ['{"a":null}', '{"ab":null,"abc":null}', '{"ab":null,"a":null,"abc":null}']) assert.ok(accepts(pre, ok), ok);
  assert.ok(!takes(pre, '{"abd":null}'));
});

test('enum and const: strings sharing a prefix, values checked against the rest of the schema', () => {
  const e = { enum: ['a', 'ab', 'abc', 'b'] };
  for (const ok of ['"a"', '"ab"', '"abc"', '"b"']) assert.ok(accepts(e, ok), ok);
  for (const bad of ['"abd"', '"abcd"', '""', '"c"']) assert.ok(!takes(e, bad), bad);
  assert.ok(accepts({ enum: [1, 10, 100] }, '10'));
  assert.ok(accepts({ type: 'array', items: { enum: [1, 10, 100] } }, '[1,10,100,1]'));
  assert.ok(!takes({ enum: [1, 10] }, '11'));
  assert.ok(accepts({ type: 'string', maxLength: 2, enum: ['a', 'abc', 7] }, '"a"'));
  assert.ok(!takes({ type: 'string', maxLength: 2, enum: ['a', 'abc', 7] }, '"abc"'));
  assert.ok(!takes({ type: 'string', maxLength: 2, enum: ['a', 'abc', 7] }, '7'));
  assert.ok(accepts({ const: { x: [1, 'é'] } }, '{"x":[1,"é"]}'));
  assert.ok(accepts({ anyOf: [{ type: 'string', enum: ['Good', 'Good+'] }, { type: 'null' }] }, '"Good+"'));
  assert.ok(accepts({ type: ['string', 'null'], maxLength: 1, anyOf: [{ type: 'string' }, { type: 'integer' }] }, '"x"'));
  assert.ok(!takes({ type: ['string', 'null'], maxLength: 1, anyOf: [{ type: 'string' }, { type: 'integer' }] }, 'null'));
});

test('numbers: bounds held exactly, integers whole, no completion that can\'t fit', () => {
  const year = { type: 'integer', minimum: 1000, maximum: 2999 };
  for (const ok of ['1000', '2999', '2026']) assert.ok(accepts(year, ok), ok);
  for (const bad of ['0', '3', '999', '3000', '-1', '2026.5', '20260']) assert.ok(!takes(year, bad), bad);
  assert.ok(!takes(year, '3', false), 'no year starts with 3');
  const score = { type: ['number', 'null'], minimum: 0, maximum: 12.5 };
  for (const ok of ['0', '12.5', '12.49', '0.000001', '7', 'null']) assert.ok(accepts(score, ok), ok);
  for (const bad of ['-0.1', '12.51', '13', '01', '1.', '.5', '1e3', '12.5000001']) assert.ok(!takes(score, bad), bad);
  assert.ok(accepts({ type: 'integer', minimum: 0 }, '-0'), '-0 is not below 0');
  assert.ok(accepts({ type: 'number', minimum: 0.1, maximum: 0.3 }, '0.3'));
  assert.ok(!takes({ type: 'number', minimum: 0.1, maximum: 0.3 }, '0.30001'));
  assert.ok(accepts({ type: 'integer', minimum: -5, maximum: -3 }, '-4'));
  assert.throws(() => G.compile({ type: 'integer', minimum: 1.2, maximum: 1.8 }, V), /fits/);
  // A complete number at the top may end, or go on.
  const m = G.compile({ type: 'integer' }, V).matcher();
  for (const id of byteIds('12')) m.advance(id);
  assert.ok(m.complete && allowed(m.mask()).includes(VOCAB.eos) && allowed(m.mask()).includes(byteIds('3')[0]));
});

test('the end token only once the value is whole; nothing after it; no whitespace', () => {
  const g = G.compile(tasks.decide.OUTPUT, V), m = g.matcher();
  for (const id of byteIds('{"verdict":"keep","choice":null')) { assert.ok(!allowed(m.mask()).includes(VOCAB.eos)); m.advance(id); }
  assert.throws(() => m.advance(VOCAB.eos), /whole/);
  m.advance(byteIds('}')[0]);
  assert.deepEqual(allowed(m.mask()), [VOCAB.eos]);
  m.advance(VOCAB.eos);
  assert.ok(m.done);
  assert.deepEqual(allowed(m.mask()), []);
  assert.throws(() => m.advance(byteIds('}')[0]), /ended/);
  assert.ok(!takes(tasks.decide.OUTPUT, '{ "verdict"', false));
  assert.throws(() => g.matcher().advance(VOCAB.bytes.length - 2), /not text/);
});

test('pattern is not enforced: the grammar says so, and still writes strings', () => {
  const g = G.compile({ type: 'string', pattern: '^[a-z]+$' }, V);
  assert.equal(g.exact, false);
  assert.ok(takes({ type: 'string', pattern: '^[a-z]+$' }, '"abc"'));
  assert.equal(G.compile({ enum: ['ab'], pattern: '^a' }, V).exact, true, 'enum values are checked against the pattern');
});

test('schemas outside the subset, or that nothing fits, are refused', () => {
  assert.throws(() => G.compile({ type: 'string', format: 'email' }, V), /subset/);
  assert.throws(() => G.compile({ enum: ['a'], type: 'integer' }, V), /fits/);
  assert.throws(() => G.compile({ maxLength: 2, anyOf: [{ maxLength: 3 }] }, V), /anyOf/);
  assert.throws(() => G.compile({ type: 'string' }, null), /vocab/);
  assert.throws(() => G.vocab([enc.encode('a')], { eos: [5] }), /end token/);
});

test('the mask is a Uint32Array over every id; repeated states reuse it', () => {
  const g = G.compile(tasks.syllabus.OUTPUT, V), m = g.matcher();
  const first = m.mask();
  assert.ok(first instanceof Uint32Array);
  assert.equal(first.length, Math.ceil(VOCAB.bytes.length / 32));
  assert.equal(g.matcher().mask(), first);
});
