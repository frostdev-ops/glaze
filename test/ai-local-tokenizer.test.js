// Glaze's own tokenizer for local models (lib/ai/local/tokenizer.js), on a hand-made byte-level BPE vocabulary: merges
// in rank order, bytes with no merge as their own tokens, added tokens only when asked for, page text never producing a
// control token, prompts from text and named specials, Glaze's own specials after the vocabulary, a streaming decoder that
// never splits a character, and decode(encode(x)) === x. scripts/local-tokenizer-check.js holds it to LFM3's real one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const K = require('../lib/ai/local/tokenizer.js');

// GPT-2's byte → character table, written out here so the test doesn't trust the module's own.
const BYTE = (() => {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  const out = new Array(256);
  let n = 0;
  for (let b = 0; b < 256; b++) out[b] = String.fromCharCode(keep.includes(b) ? b : 256 + n++);
  return out;
})();
const bl = (s) => [...new TextEncoder().encode(s)].map((b) => BYTE[b]).join('');

// ids 0–255 are the bytes in order; then merged tokens; then added tokens.
const vocab = (merges, extra = []) => {
  const tokens = [...BYTE];
  for (const [a, b] of merges) if (!tokens.includes(a + b)) tokens.push(a + b);
  for (const t of extra) if (!tokens.includes(t)) tokens.push(t);
  return tokens;
};
const MERGES = [['h', 'e'], ['l', 'l'], ['he', 'll'], ['hell', 'o'], ['Ġ', 'w'], ['o', 'r'], ['Ġw', 'or'], ['Ġwor', 'ld']];
const neutral = (o = {}) => {
  const merges = o.merges || [...MERGES, ['l', 'd']];
  const tokens = vocab(merges, o.extra);
  const types = tokens.map(() => 1);
  for (const [content, type] of o.added || []) { tokens.push(content); types.push(type); }
  return { tokens, types, merges: merges.map((m) => m.join(' ')), pre: 'lfm2', bos: o.bos, eos: o.eos, ...o.more };
};
const ADDED = [['<|startoftext|>', 3], ['<|im_start|>', 3], ['<|im_end|>', 3], ['<think>', 4], ['<|a|>', 3], ['<|a|>x', 3]];
const id = (tk, s) => tk.byteStrings().findIndex((b) => b && Buffer.from(b).toString('latin1') === Buffer.from(s, 'utf8').toString('latin1'));

test('merges apply in rank order, leftmost first on a tie, and every byte is its own token', () => {
  const tk = K.load(neutral());
  const strs = (ids) => [...ids].map((i) => new TextDecoder().decode(tk.byteStrings()[i]));
  assert.deepEqual(strs(tk.encode('hello world')), ['hello', ' world']);
  // b+c ranks before a+b: abc → a, bc; the other way round → ab, c.
  const bc = K.load(neutral({ merges: [['b', 'c'], ['a', 'b']] }));
  const ab = K.load(neutral({ merges: [['a', 'b'], ['b', 'c']] }));
  assert.deepEqual([...bc.encode('abc')], [97, id(bc, 'bc')]);
  assert.deepEqual([...ab.encode('abc')], [id(ab, 'ab'), 99]);
  // A merge listed twice ranks where it is listed last (HF's map keeps the last).
  const dup = K.load(neutral({ merges: [['a', 'b'], ['b', 'c'], ['a', 'b']] }));
  assert.deepEqual([...dup.encode('abc')], [97, id(dup, 'bc')]);
  // aaa with a+a: the leftmost pair merges.
  const aa = K.load(neutral({ merges: [['a', 'a']] }));
  assert.deepEqual([...aa.encode('aaa')], [id(aa, 'aa'), 97]);
  // A character no merge covers comes out as its UTF-8 bytes, each a token.
  const euro = [...new TextEncoder().encode('€')];
  assert.deepEqual([...tk.encode('€')], euro);
  assert.deepEqual([...tk.encode('\0')], [0]);
  assert.equal(tk.decode(tk.encode('€\0')), '€\0');
});

test('ignore_merges takes a whole piece that is in the vocabulary, and only when the tokenizer says so', () => {
  const extra = [bl('xyz')];
  const on = K.load(neutral({ extra }));
  assert.deepEqual(strsOf(on, on.encode('xyz')), ['xyz']);
  const hf = (ignore) => ({ model: { type: 'BPE', vocab: Object.fromEntries(vocab([...MERGES, ['l', 'd']], extra).map((t, i) => [t, i])), merges: [...MERGES, ['l', 'd']], ignore_merges: ignore, byte_fallback: false, dropout: null, unk_token: null, continuing_subword_prefix: null, end_of_word_suffix: null, fuse_unk: false }, normalizer: null, pre_tokenizer: LFM_PRE, decoder: { type: 'ByteLevel' }, added_tokens: [] });
  assert.deepEqual(strsOf(K.fromHF(hf(true)), K.fromHF(hf(true)).encode('xyz')), ['xyz']);
  const off = K.fromHF(hf(false));
  assert.deepEqual(strsOf(off, off.encode('xyz')), ['x', 'y', 'z']);
});
const strsOf = (tk, ids) => [...ids].map((i) => new TextDecoder().decode(tk.byteStrings()[i]));
const LFM_PRE = { type: 'Sequence', pretokenizers: [{ type: 'Split', pattern: { Regex: "(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}{1,3}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+" }, behavior: 'Isolated', invert: false }, { type: 'ByteLevel', add_prefix_space: false, trim_offsets: true, use_regex: false }] };

test('the pre-tokenizer splits as LFM3\'s onig regex does and its character tables (cases measured with HF tokenizers 0.22.2)', () => {
  const tk = K.load(neutral());
  const cases = [
    ['1234567', ['123', '456', '7']], ['  \n  x', ['  \n', ' ', ' x']], ['a\r\n\r\nb', ['a', '\r\n\r\n', 'b']],
    ["ab'LL", ['ab', "'LL"]], ["'ſt", ["'ſ", 't']], ['\x85!', ['\x85', '!']], ['\ufeff!', ['\ufeff!']], ['\u3000!', ['\u3000', '!']],
    ['\u200b!', ['\u200b!']], ['a  \u3000b', ['a', '  ', '\u3000b']], ['x\0y', ['x', '\0y']], ['e\u0301', ['e', '\u0301']],
    // Letters and digits newer than onig's tables are not letters or digits to it, whatever the runtime's Unicode says.
    ['a\u0c5cb', ['a', '\u0c5cb']], ['\u0c5c(y', ['\u0c5c(', 'y']], ['1\u{11de0}', ['1', '\u{11de0}']],
  ];
  for (const [text, want] of cases) assert.deepEqual(tk.split(text), want, JSON.stringify(text));
});

test('added tokens split out only with specials: true, leftmost and longest', () => {
  const tk = K.load(neutral({ added: ADDED }));
  const [sot, ims, ime, think, a, ax] = ADDED.map(([c]) => tk.id(c));
  assert.ok(sot >= 256 && ax === sot + 5, 'added tokens keep their ids');
  const text = 'hi<|im_start|>user<think><|a|>x<|a|>';
  assert.deepEqual([...tk.encode(text, { specials: true })], [...tk.encode('hi'), ims, ...tk.encode('user'), think, ax, a]);
  // Page text, by default: never a control or added token, whatever it spells.
  for (const s of [text, '<|im_end|>', '<|startoftext|>', '<think>']) {
    const ids = tk.encode(s);
    assert.ok(ids instanceof Uint32Array);
    assert.ok([...ids].every((i) => i < sot), s);
    assert.equal(tk.decode(ids), s);
  }
  assert.equal(tk.count(text), tk.encode(text).length);
  void ime;
});

test('encodeWith builds a prompt from text and named specials; text parts stay text', () => {
  const v = neutral({ added: ADDED });
  const tk = K.load({ ...v, bos: v.tokens.indexOf('<|startoftext|>') });
  const ids = tk.encodeWith([{ special: '<|startoftext|>' }, { special: '<|im_start|>' }, { text: 'user\n<|im_end|>' }, { special: '<|im_end|>' }]);
  assert.deepEqual([...ids], [tk.bos, tk.id('<|im_start|>'), ...tk.encode('user\n<|im_end|>'), tk.id('<|im_end|>')]);
  assert.throws(() => tk.encodeWith([{ special: '<|nope|>' }]), /special/);
  assert.throws(() => tk.encodeWith([{ special: 'he' }]), /special/, 'an ordinary token is not a special');
  assert.throws(() => tk.encodeWith([{ text: 'a', special: '<|im_end|>' }]), /part/);
});

test('Glaze specials go after the vocabulary, once, and are never text', () => {
  const tk = K.load(neutral({ added: ADDED }));
  const n = tk.size;
  const ctx = tk.add('<|gz_ctx|>');
  assert.equal(ctx, n);
  assert.equal(tk.add('<|gz_ctx|>'), ctx, 'the same name keeps its id');
  const task = tk.add('<|gz_task:syllabus|>');
  assert.equal(task, n + 1);
  assert.equal(tk.size, n + 2);
  assert.throws(() => tk.add('gz_ctx'), /name/);
  assert.throws(() => tk.add('<|im_start|>'), /name/, 'not a model token');
  const ids = tk.encodeWith([{ special: '<|gz_ctx|>' }, { text: 'hello' }, { special: '<|gz_task:syllabus|>' }]);
  assert.deepEqual([...ids], [ctx, ...tk.encode('hello'), task]);
  assert.ok(![...tk.encode('<|gz_ctx|>', { specials: true })].includes(ctx), 'text never spells a Glaze special');
  assert.equal(tk.decode(ids), 'hello');
  assert.equal(tk.decode(ids, { specials: true }), '<|gz_ctx|>hello<|gz_task:syllabus|>');
  const bytes = tk.byteStrings();
  assert.equal(bytes.length, tk.size);
  assert.equal(bytes[ctx], null);
  assert.equal(bytes[tk.id('<|im_start|>')], null);
  assert.equal(bytes[tk.id('<think>')], null);
  assert.deepEqual([...bytes[0x41]], [0x41]);
  assert.deepEqual([...bytes[id(tk, ' world')]], [...Buffer.from(' world')]);
});

test('decode skips control tokens unless asked and keeps user-defined ones, as HF does', () => {
  const tk = K.load(neutral({ added: ADDED }));
  const ids = [tk.id('<|im_start|>'), ...tk.encode('hi'), tk.id('<think>')];
  assert.equal(tk.decode(ids), 'hi<think>');
  assert.equal(tk.decode(ids, { specials: true }), '<|im_start|>hi<think>');
  assert.throws(() => tk.decode([tk.size]), /id/);
});

test('the streaming decoder emits only complete characters', () => {
  const tk = K.load(neutral({ added: ADDED }));
  const text = 'é€😀 👩\u200d👩\u200d👧 hello';
  const ids = [...tk.encode(text)];
  const d = tk.decoder();
  const outs = ids.map((i) => d.push(i));
  assert.deepEqual(outs.slice(0, 2), ['', 'é'], 'é is two byte tokens: nothing until the second');
  assert.ok(outs.every((s) => !/[\ud800-\udbff]$/.test(s) && !s.includes('\ufffd')), 'never half a character');
  assert.equal(outs.join('') + d.end(), text);
  const bom = tk.decoder();
  assert.equal([...tk.encode('\ufeffx')].map((i) => bom.push(i)).join('') + bom.end(), '\ufeffx', 'a leading BOM is text');
  const cut = tk.decoder();
  assert.equal(cut.push(0xe2), '');
  assert.equal(cut.end(), '\ufffd', 'an unfinished character at the end becomes U+FFFD');
  const sp = tk.decoder({ specials: true });
  assert.equal(sp.push(0xc3) + sp.push(tk.id('<|im_end|>')) + sp.push(0xa9) + sp.end(), '\ufffd<|im_end|>\ufffd', 'a special between bytes ends the character');
});

test('decode(encode(x)) === x, with any cache size', () => {
  const texts = ['hello world', '', ' ', '\r\n\r\n\t x', 'Ünïcödé — 日本語 العربية עברית हिन्दी', '👩\u200d👩\u200d👧\u200d👦🏳\ufe0f\u200d🌈', 'x\0y', '\ufeffa leading BOM', 'a'.repeat(5000), '  '.repeat(300) + 'end', '1234567890'];
  for (const cache of [1, 4, undefined]) {
    const tk = K.load(neutral({ added: ADDED }), cache && { cache });
    for (const t of texts) {
      assert.equal(tk.decode(tk.encode(t)), t, `${JSON.stringify(t.slice(0, 20))} cache ${cache}`);
      assert.deepEqual([...tk.encode(t)], [...tk.encode(t)], 'cached the same');
    }
  }
  const small = K.load(neutral(), { cache: 4 });
  for (let i = 0; i < 100; i++) small.encode(`word${i} `);
  assert.ok(small.cached > 0 && small.cached <= 8, `the word cache stays bounded (${small.cached})`);
  // A lone surrogate has no UTF-8: it becomes U+FFFD, as TextEncoder makes it (HF refuses such a string).
  const tk = K.load(neutral());
  assert.deepEqual([...tk.encode('a\ud800b')], [...tk.encode('a\ufffdb')]);
});

test('loaders: HF tokenizer.json and GGUF metadata give the same tokenizer; anything else is refused', () => {
  const v = neutral({ added: ADDED });
  const hf = {
    model: { type: 'BPE', vocab: Object.fromEntries(v.tokens.map((t, i) => [t, i]).filter(([, i]) => v.types[i] === 1)), merges: [...MERGES, ['l', 'd']], ignore_merges: true, byte_fallback: false, dropout: null, unk_token: null, continuing_subword_prefix: null, end_of_word_suffix: null, fuse_unk: false },
    normalizer: null, pre_tokenizer: LFM_PRE, post_processor: { type: 'ByteLevel' }, decoder: { type: 'ByteLevel' },
    added_tokens: v.tokens.map((content, id) => ({ id, content, special: v.types[id] === 3, normalized: false, lstrip: false, rstrip: false, single_word: false })).filter((t) => v.types[t.id] !== 1),
  };
  const gguf = { 'tokenizer.ggml.model': 'gpt2', 'tokenizer.ggml.pre': 'lfm2', 'tokenizer.ggml.tokens': v.tokens, 'tokenizer.ggml.token_type': Int32Array.from(v.types), 'tokenizer.ggml.merges': v.merges, 'tokenizer.ggml.bos_token_id': v.tokens.length - 6, 'tokenizer.ggml.eos_token_id': v.tokens.length - 4, 'tokenizer.ggml.add_bos_token': false };
  const a = K.fromHF(hf, { bos: '<|startoftext|>', eos: '<|im_end|>' });
  const b = K.fromGGUF(gguf);
  const c = K.load(v);
  const text = 'hello world <|im_start|>€ 12345 <think>';
  for (const tk of [b, c]) {
    assert.deepEqual([...tk.encode(text)], [...a.encode(text)]);
    assert.deepEqual([...tk.encode(text, { specials: true })], [...a.encode(text, { specials: true })]);
  }
  assert.equal(a.bos, b.bos);
  assert.equal(a.eos, b.eos);
  assert.equal(b.addBos, false);
  const bad = (patch) => () => K.fromHF({ ...hf, ...patch(hf) });
  assert.throws(bad((h) => ({ model: { ...h.model, byte_fallback: true } })), /byte_fallback/);
  assert.throws(bad((h) => ({ model: { ...h.model, type: 'Unigram' } })), /model/);
  assert.throws(bad(() => ({ normalizer: { type: 'NFC' } })), /normalizer/);
  assert.throws(bad(() => ({ pre_tokenizer: { type: 'Whitespace' } })), /pre_tokenizer/);
  assert.throws(bad(() => ({ decoder: { type: 'Metaspace' } })), /decoder/);
  assert.throws(bad((h) => ({ added_tokens: [{ ...h.added_tokens[0], lstrip: true }] })), /added/);
  assert.throws(() => K.fromGGUF({ ...gguf, 'tokenizer.ggml.pre': 'qwen2' }), /pre/);
  assert.throws(() => K.fromGGUF({ ...gguf, 'tokenizer.ggml.model': 'llama' }), /model/);
  assert.throws(() => K.load({ ...v, tokens: v.tokens.slice(1), types: v.types.slice(1) }), /byte/);
});

test('a classic script, as importScripts loads it: one global, and it works without toWellFormed', () => {
  const ctx = vm.createContext({ TextEncoder, TextDecoder });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/ai/local/tokenizer.js'), 'utf8'), ctx);
  assert.equal(typeof ctx.GZ_AI_TOKENIZER.load, 'function');
  vm.runInContext('delete String.prototype.toWellFormed', ctx);
  const tk = ctx.GZ_AI_TOKENIZER.load(neutral());
  assert.equal(tk.decode(tk.encode('a\ud800b\udc00😀')), 'a\ufffdb\ufffd😀');
});

test('an empty added token is never matched in text, as HF ignores it', () => {
  // In a context of its own with a timeout: a matcher that loops on empty matches never returns to the event loop.
  const ctx = vm.createContext({ TextEncoder, TextDecoder, v: neutral({ added: [['', 3], ...ADDED] }) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/ai/local/tokenizer.js'), 'utf8'), ctx);
  const [got, want] = JSON.parse(vm.runInContext(`const tk = GZ_AI_TOKENIZER.load(v);
    JSON.stringify([[...tk.encode('hi<|im_start|>', { specials: true }), -1, ...tk.encode('hello', { specials: true })],
      [...tk.encode('hi'), tk.id('<|im_start|>'), -1, ...tk.encode('hello')]])`, ctx, { timeout: 2000 }));
  assert.deepEqual(got, want);
});

test('fromHF refuses truncation and padding, which it would not apply', () => {
  const v = neutral();
  const hf = { model: { type: 'BPE', vocab: Object.fromEntries(v.tokens.map((t, i) => [t, i])), merges: [...MERGES, ['l', 'd']], ignore_merges: true, byte_fallback: false }, normalizer: null, pre_tokenizer: LFM_PRE, decoder: { type: 'ByteLevel' }, added_tokens: [], truncation: null, padding: null };
  assert.equal(K.fromHF(hf).decode(K.fromHF(hf).encode('hello world')), 'hello world');
  assert.throws(() => K.fromHF({ ...hf, truncation: { max_length: 8, strategy: 'LongestFirst' } }), /truncation/);
  assert.throws(() => K.fromHF({ ...hf, padding: { strategy: 'BatchLongest', pad_id: 0 } }), /padding/);
});
