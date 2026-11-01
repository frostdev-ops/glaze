// test/fixtures/ai/local-format/vocab.json (tools/dev/local-format-fixture.js: LFM3's tokenizer cut to the tokens some
// prompts reach) as Glaze's tokenizer. Ids the cut leaves out hold a name no text can produce, so the model's reserved
// rows, and with them GLAZE_TOKENS' ids, stay where they are.
const K = require('../../extension/ai/local/tokenizer.js');

module.exports = (v) => {
  const tokens = Array.from({ length: v.size }, (_, i) => `\u0000${i}`), types = new Array(v.size).fill(K.TYPES.normal);
  for (const [id, t] of Object.entries(v.tokens)) tokens[id] = t;
  for (const [id, t, special] of v.added) { tokens[id] = t; types[id] = special ? K.TYPES.control : K.TYPES.user; }
  const tok = K.load({ tokens, types, merges: v.merges, pre: v.pre, rows: v.rows, ignoreMerges: v.ignoreMerges });
  for (const t of K.GLAZE_TOKENS) tok.add(t);
  return tok;
};
