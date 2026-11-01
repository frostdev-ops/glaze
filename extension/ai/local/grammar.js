// Constrained JSON decoding for the local engine: a task's schema (ai/schema.js's subset) compiled into a byte-level
// pushdown automaton for compact JSON, and per step the mask of every token whose bytes keep the answer completable,
// the end token only once the value is whole.
//   const V = GZ_AI_GRAMMAR.vocab(tokenizer.byteStrings(), { eos: [id] });  once per model: the token trie
//     byteStrings has one entry per model row (LFM3: 128,000, the tokenizer loaded with rows), so a mask is
//     ceil(rows / 32) words; rows with no text (unused [PAD] rows, control and Glaze tokens) are never set, eos aside.
//   const g = GZ_AI_GRAMMAR.compile(schema, V);                              once per schema
//   const m = g.matcher();  m.mask() → Uint32Array, token i at bit i & 31 of word i >> 5 (cached: read it, never write it);
//   m.advance(id) (throws on a token the mask leaves out); m.complete: the end token is allowed; m.done: it was taken;
//   m.fork(): an independent copy.
// What it writes is a subset of what validate() accepts, chosen so that every state it reaches can still finish:
//   - no whitespace; an object's properties in the schema's order, required ones always, optional ones skippable; then,
//     when additionalProperties isn't false, extra keys (no escapes, never a declared name) with any JSON value;
//   - numbers -?(0|[1-9]\d{0,14})(\.\d{1,6})?, integers without the fraction, held to minimum and maximum exactly;
//   - strings: any UTF-8, a token may end inside a character; the escapes \" \\ \/ \b \f \n \r \t \uXXXX, a surrogate
//     only as a \uD8xx\uDCxx pair; min/maxLength in code points, as validate() counts them;
//   - enum and const as JSON.stringify spells each value, a value kept only if it passes the whole schema;
//   - anyOf: each alternative merged with the keywords beside it (disjoint ones; type intersects; others are refused);
//   - pattern: an anchored one (^…$) over printable ASCII other than " and \ (literals, \d, classes, groups, |, ?, *, +,
//     {m,n}) runs as a DFA, held with min/maxLength (a string at most 1,024 characters); any other pattern is not
//     enforced: such a grammar has exact: false, and the caller runs validate();
//   - a value with no schema (an extra key's, an array's without items) nests at most LIMIT.depth deep;
//   - span (ai/schema.js), with compile's sources: { [source]: its text }: a string that decodes to bytes of that text,
//     written as JSON.stringify writes them (\" \\ \b \f \n \r \t, other controls \u00xx, the rest raw), cut where
//     ai/text.js folds both sides alike: it starts on a character that isn't a combining mark and ends before one that
//     isn't, holds at least min characters that fold to something (none of white space, marks, zero-width ones), and with
//     word starts after and ends before a character that isn't a letter or a digit (or an end), as writer-cite.js asks.
//     Held with maxLength (and minLength, as that many such characters). A span with a pattern, or whose source isn't
//     given or holds no such span, is an ordinary string.
// compile(schema, V, { tools }): the turn of a model that calls tools in LFM3's own syntax (ai/tasks/agent-tools.js
// native): either the JSON as above, or one call to a listed tool,
//   <tool_call>\n<function=NAME>\n(<parameter=KEY>\nVALUE\n</parameter>\n)*</function>\n</tool_call>
// its parameters in their schema's order, required ones always, each at most once, a string VALUE one line of raw text
// (no escapes) held to its length and pattern, an integer to its bounds. The tags are the model's own tokens: V needs
// their ids (vocab()'s marks, TOOL_MARKS), each read as a byte no text has (0xF8 on).
// Speed: a trie over the vocabulary's bytes is walked against the state. Inside a string, where most steps are, the
// tokens that stay in it come from a table per string state, shared by every schema on the vocabulary, and only those
// that close it are walked on. Masks are cached by state, counters capped past the longest token so repeats hit. A span
// walks the trie with its source's suffix automaton, so a mask visits only tokens that continue a span.
// Classic script; node exports.
var GZ_AI_GRAMMAR = globalThis.GZ_AI_GRAMMAR || (() => {
  const S = typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('../schema.js');
  const LIMIT = { digits: 15, fraction: 6, depth: 16, cache: 128, pattern: 1024, nfa: 4000, dfa: 512, optional: 6, source: 1 << 20 };
  const enc = new TextEncoder();
  const fail = (what) => { throw new TypeError(`grammar: ${what}`); };

  // ---- string content: one byte at a time ----------------------------------------------------------------------------
  // States: 0 a character boundary; 1–7 inside a UTF-8 character (1, 2, 3 continuation bytes left; after E0, ED, F0, F4,
  // whose next byte is narrower); 8 after \; 9–15 inside \uXXXX (15: a high surrogate's last digit); 16–21 the low
  // surrogate's \uDCxx that must follow. STEP → the next state, CLOSE, or FAIL; CNT: the byte starts a code point.
  const MICRO = 22, CLOSE = -2, FAIL = -1;
  const STEP = new Int8Array(MICRO * 256).fill(FAIL), CNT = new Uint8Array(MICRO * 256);
  const on = (s, bytes, to, c = 0) => { for (const b of bytes) { STEP[s * 256 + b] = to; CNT[s * 256 + b] = c; } };
  const span = (a, z) => Array.from({ length: z - a + 1 }, (_, i) => a + i);
  const ch = (s) => [...s].map((c) => c.charCodeAt(0));
  const HEX = ch('0123456789abcdefABCDEF');
  on(0, span(0x20, 0x7f), 0, 1); on(0, [0x22], CLOSE); on(0, [0x5c], 8, 1);
  on(0, span(0xc2, 0xdf), 1, 1); on(0, [0xe0], 4, 1); on(0, [...span(0xe1, 0xec), 0xee, 0xef], 2, 1); on(0, [0xed], 5, 1);
  on(0, [0xf0], 6, 1); on(0, span(0xf1, 0xf3), 3, 1); on(0, [0xf4], 7, 1);
  on(1, span(0x80, 0xbf), 0); on(2, span(0x80, 0xbf), 1); on(3, span(0x80, 0xbf), 2);
  on(4, span(0xa0, 0xbf), 1); on(5, span(0x80, 0x9f), 1); on(6, span(0x90, 0xbf), 2); on(7, span(0x80, 0x8f), 2);
  on(8, ch('"\\/bfnrt'), 0); on(8, ch('u'), 9);
  on(9, HEX, 10); on(9, ch('dD'), 11); on(10, HEX, 12); on(11, ch('01234567'), 12); on(11, ch('89abAB'), 13);
  on(12, HEX, 14); on(13, HEX, 15); on(14, HEX, 0); on(15, HEX, 16);
  on(16, ch('\\'), 17); on(17, ch('u'), 18); on(18, ch('dD'), 19); on(19, ch('cdefCDEF'), 20); on(20, HEX, 21); on(21, HEX, 0);
  // Raw text (a native call's string value): the same characters, " and \ plain, no escapes, ended (CLOSE) by a line feed.
  const RSTEP = STEP.slice(0, 8 * 256), RCNT = CNT.slice(0, 8 * 256);
  RSTEP[0x22] = 0; RCNT[0x22] = 1; RSTEP[0x5c] = 0; RCNT[0x5c] = 1; RSTEP[0x0a] = CLOSE;
  // LFM3's tool-call tags, in the order vocab()'s marks give them bytes 0xF8 on.
  const TOOL_MARKS = Object.freeze(['<tool_call>', '</tool_call>', '<function=', '</function>', '<parameter=', '</parameter>']);
  const MARK = 0xf8;

  // ---- the vocabulary ------------------------------------------------------------------------------------------------
  // byteStrings: each id's bytes (null or empty: never text). A trie in preorder arrays: first child, next sibling, the
  // byte into the node, the first id ending there and the next id with the same bytes.
  // marks: { name: id } of tokens with no text a grammar places by name (TOOL_MARKS), each read as the byte MARK + its
  // index; text tokens holding such a byte (no UTF-8 does) are left out.
  const vocab = (byteStrings, { eos = [], marks = {} } = {}) => {
    const size = byteStrings.length, bytes = Array.from(byteStrings, (b) => (b && b.length && !b.some((x) => x >= MARK) ? Uint8Array.from(b) : null));
    const ends = new Set([].concat(eos).filter((e) => e != null));
    for (const e of ends) if (!Number.isInteger(e) || e < 0 || e >= size) fail(`end token ${e}`);
    const names = Object.keys(marks || {}), markOf = new Map();
    if (names.length > 0x100 - MARK) fail('marks');
    names.forEach((n, k) => {
      const id = marks[n];
      if (!Number.isInteger(id) || id < 0 || id >= size || ends.has(id) || [...markOf.values()].some((m) => bytes[id]?.[0] === m)) fail(`mark ${n}`);
      bytes[id] = Uint8Array.of(MARK + k); markOf.set(n, MARK + k);
    });
    const ids = [];
    // advance() always treats an end id as control, even if its vocabulary entry has text bytes.
    for (let i = 0; i < size; i++) if (bytes[i] && !ends.has(i)) ids.push(i);
    ids.sort((x, y) => {
      const a = bytes[x], b = bytes[y], n = Math.min(a.length, b.length);
      for (let k = 0; k < n; k++) if (a[k] !== b[k]) return a[k] - b[k];
      return a.length - b.length || x - y;
    });
    let cap = 1 << 16, first = new Int32Array(cap), next = new Int32Array(cap), last = new Int32Array(cap), byte = new Uint8Array(cap), tok = new Int32Array(cap);
    const grow = () => {
      cap *= 2;
      const g = (a, T) => { const b = new T(cap); b.set(a); return b; };
      first = g(first, Int32Array); next = g(next, Int32Array); last = g(last, Int32Array); byte = g(byte, Uint8Array); tok = g(tok, Int32Array);
    };
    const tokNext = new Int32Array(size).fill(-1);
    first[0] = next[0] = last[0] = tok[0] = -1;
    let nodes = 1, longest = 0, prev = null;
    const path = [0];
    for (const id of ids) {
      const s = bytes[id];
      longest = Math.max(longest, s.length);
      let l = 0;
      if (prev) { const m = Math.min(prev.length, s.length); while (l < m && prev[l] === s[l]) l++; }
      path.length = l + 1;
      for (let k = l; k < s.length; k++) {
        if (nodes === cap) grow();
        const p = path[k], c = nodes++;
        byte[c] = s[k]; first[c] = next[c] = last[c] = tok[c] = -1;
        if (last[p] < 0) first[p] = c; else next[last[p]] = c;
        last[p] = c;
        path.push(c);
      }
      const at = path[s.length];
      tokNext[id] = tok[at]; tok[at] = id;
      prev = s;
    }
    return {
      size, words: (size + 31) >>> 5, bytes, eos: ends, nodes, longest, CAP: longest + 1,
      first: first.subarray(0, nodes), next: next.subarray(0, nodes), byte: byte.subarray(0, nodes), tok: tok.subarray(0, nodes), tokNext,
      tables: new Array(MICRO), raws: new Array(8), marks: markOf, pats: new Map(),
    };
  };

  // Per string state, from the trie's root: the tokens that stay inside the string (ids by the code points they add,
  // and all of them as a mask), and the trie nodes where a token closes it, with the code points before the quote.
  const strTable = (V, e, raw = false) => {
    const tables = raw ? V.raws : V.tables, stepT = raw ? RSTEP : STEP, cntT = raw ? RCNT : CNT;
    if (tables[e]) return tables[e];
    const { first, next, byte, tok, tokNext } = V;
    const inner = [], cnts = [], cn = [], cc = [];
    const stack = [0, e, 0];
    while (stack.length) {
      const k = stack.pop(), s = stack.pop(), nd = stack.pop();
      for (let c = first[nd]; c >= 0; c = next[c]) {
        const i = s * 256 + byte[c], to = stepT[i];
        if (to === FAIL) continue;
        if (to === CLOSE) { cn.push(c); cc.push(k); continue; }
        const nk = k + cntT[i];
        for (let t = tok[c]; t >= 0; t = tokNext[t]) { inner.push(t); cnts.push(nk); }
        if (first[c] >= 0) stack.push(c, to, nk);
      }
    }
    const top = cnts.reduce((a, b) => Math.max(a, b), 0);
    const at = new Int32Array(top + 2);
    for (const k of cnts) at[k + 1]++;
    for (let k = 1; k < at.length; k++) at[k] += at[k - 1];
    const ids = new Int32Array(inner.length), cnt = new Int32Array(inner.length), all = new Uint32Array(V.words);
    inner.forEach((t, i) => { const j = at[cnts[i]]++; ids[j] = t; cnt[j] = cnts[i]; all[t >>> 5] |= 1 << (t & 31); });
    return (tables[e] = { ids, cnt, top, all, cn: Int32Array.from(cn), cc: Int32Array.from(cc) });
  };

  // Per DFA state d, from the trie's root: the tokens whose bytes all stay in the pattern (each with its end state and
  // length), and the trie nodes where a token reaches the close (a quote, or raw text's line feed) after k characters in
  // state e. Kept on the DFA (once per vocabulary: V.pats).
  const patTable = (V, dfa, d, raw) => {
    const tables = (dfa.tables ||= { json: [], raw: [] })[raw ? 'raw' : 'json'];
    if (tables[d]) return tables[d];
    const { first, next, byte, tok, tokNext } = V, close = raw ? 0x0a : 0x22;
    const ids = [], ends = [], lens = [], cn = [], ck = [], ce = [];
    const stack = [0, d, 0];
    while (stack.length) {
      const k = stack.pop(), s = stack.pop(), nd = stack.pop();
      for (let c = first[nd]; c >= 0; c = next[c]) {
        if (byte[c] === close) { if (dfa.acc[s]) { cn.push(c); ck.push(k); ce.push(s); } continue; }
        const to = dfa.next[s][byte[c]];
        if (to < 0) continue;
        for (let t = tok[c]; t >= 0; t = tokNext[t]) { ids.push(t); ends.push(to); lens.push(k + 1); }
        if (first[c] >= 0) stack.push(c, to, k + 1);
      }
    }
    return (tables[d] = { ids: Int32Array.from(ids), ends: Int32Array.from(ends), lens: Int32Array.from(lens), cn: Int32Array.from(cn), ck: Int32Array.from(ck) });
  };

  // ---- spans of a source ---------------------------------------------------------------------------------------------
  // The source as bytes T: its UTF-8, a lone surrogate SEP (no answer byte), and with word MK at the start and after each
  // character that isn't a letter or a digit, which the decoder writes there too, so an occurrence's start is in its string.
  // Per byte of T: LEAD starts a character; END, VIS, CM, NW end one that is any, folds to something, is a combining mark,
  // isn't a letter or digit (a mark or a character norm() drops counts as one, so MK never parts what folding joins); MST,
  // NWS start a mark, a non-word character; GOOD: a span may end after it.
  const SEP = 0xff, MK = 0xfe, INF = 0x3fffffff;
  const LEAD = 1, END = 2, VIS = 4, CM = 8, NW = 16, MST = 32, NWS = 64, GOOD = 128;
  const kinds = new Map();
  const kindOf = (cp) => {
    let k = kinds.get(cp);
    if (k !== undefined) return k;
    const c = String.fromCodePoint(cp), mark = /\p{M}/u.test(c), gone = /[\u00ad\u200b-\u200d\u2060\ufeff]/u.test(c);
    k = (mark ? CM : 0) | (mark || gone || /[\p{L}\p{N}]/u.test(c) ? 0 : NW) | (mark || gone || /\s/u.test(c) ? 0 : VIS);
    if (kinds.size < 65536) kinds.set(cp, k);
    return k;
  };
  // → the suffix automaton of T { go(st, b) (-1: none), len, link, fp (an end of st's first occurrence), head/eNx/eB/eTo
  // (st's edges), flags, word, start, n }, or null past LIMIT.source.
  const automaton = (text, word) => {
    const T = [], F = [];
    if (word) { T.push(MK); F.push(0); }
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp >= 0xd800 && cp <= 0xdfff) { T.push(SEP); F.push(LEAD | NWS); continue; }
      const k = kindOf(cp), bs = cp < 0x80 ? [cp] : cp < 0x800 ? [0xc0 | (cp >> 6), 0x80 | (cp & 63)]
        : cp < 0x10000 ? [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)] : [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
      bs.forEach((b, i) => { T.push(b); F.push((i ? 0 : LEAD | (k & CM ? MST : 0) | (k & NW ? NWS : 0)) | (i === bs.length - 1 ? END | (k & (VIS | CM | NW)) : 0)); });
      if (word && k & NW) { T.push(MK); F.push(0); }
      if (T.length > LIMIT.source) return null;
    }
    const N = T.length, flags = Uint8Array.from(F);
    for (let e = 0; e < N; e++) {
      const at = word ? T[e] === MK || (flags[e] & (END | NW)) === END : (flags[e] & END) !== 0, j = e + 1;
      if (at && (j >= N || T[j] === SEP || (!(flags[j] & MST) && (!word || flags[j] & NWS)))) flags[e] |= GOOD;
    }
    const cap = 2 * N + 2, ecap = 3 * N + 8, bits = 32 - Math.clz32(2 * ecap), size = 1 << bits, mask = size - 1;
    const len = new Int32Array(cap), link = new Int32Array(cap), fp = new Int32Array(cap), head = new Int32Array(cap).fill(-1);
    const eSt = new Int32Array(ecap), eB = new Uint8Array(ecap), eTo = new Int32Array(ecap), eNx = new Int32Array(ecap), H = new Int32Array(size);
    const slot = (st, b) => {
      for (let h = (Math.imul(st * 256 + b, 0x9e3779b1) >>> (32 - bits)) & mask; ; h = (h + 1) & mask) { const e = H[h] - 1; if (e < 0 || (eSt[e] === st && eB[e] === b)) return h; }
    };
    const go = (st, b) => { const e = H[slot(st, b)] - 1; return e < 0 ? -1 : eTo[e]; };
    let n = 1, ne = 0, last = 0;
    const put = (st, b, to) => { const h = slot(st, b); let e = H[h] - 1; if (e < 0) { e = ne++; eSt[e] = st; eB[e] = b; eNx[e] = head[st]; head[st] = e; H[h] = e + 1; } eTo[e] = to; };
    link[0] = -1;
    const prim = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const c = T[i], cur = n++;
      len[cur] = len[last] + 1; fp[cur] = i;
      let p = last;
      while (p !== -1 && go(p, c) < 0) { put(p, c, cur); p = link[p]; }
      if (p === -1) link[cur] = 0;
      else {
        const q = go(p, c);
        if (len[p] + 1 === len[q]) link[cur] = q;
        else {
          const cl = n++;
          len[cl] = len[p] + 1; link[cl] = link[q]; fp[cl] = fp[q];
          for (let e = head[q]; e >= 0; e = eNx[e]) put(cl, eB[e], eTo[e]);
          while (p !== -1 && go(p, c) === q) { put(p, c, cl); p = link[p]; }
          link[q] = link[cur] = cl;
        }
      }
      prim[i] = last = cur;
    }
    return { go, len, link, fp, head, eNx, eB, eTo, flags, T, prim, n, word, start: word ? go(0, MK) : 0, D: [] };
  };
  // D[v][st] up to v = k: the fewest characters more, from any end of st's strings in T, to a GOOD end with v more visible
  // characters (INF: none). Per byte backwards, then the least over each state's suffix-link subtree.
  const distances = (A, k) => {
    if (A.D.length > k) return A.D;
    const { T, flags, prim, len, link, n } = A, N = T.length, D = Array.from({ length: k + 1 }, () => new Int32Array(n).fill(INF));
    let nx = new Int32Array(k + 1).fill(INF), cur = new Int32Array(k + 1);
    for (let e = N - 1; e >= 0; e--) {
      const j = e + 1, ok = j < N && T[j] !== SEP, c = ok && flags[j] & LEAD ? 1 : 0, g = ok && flags[j] & VIS ? 1 : 0;
      for (let v = 0; v <= k; v++) cur[v] = v === 0 && flags[e] & GOOD ? 0 : ok ? Math.min(INF, c + nx[v > g ? v - g : 0]) : INF;
      for (let v = 0; v <= k; v++) D[v][prim[e]] = cur[v];
      [nx, cur] = [cur, nx];
    }
    const by = new Int32Array(N + 2), order = new Int32Array(n);
    for (let s = 0; s < n; s++) by[len[s] + 1]++;
    for (let l = 1; l < by.length; l++) by[l] += by[l - 1];
    for (let s = 0; s < n; s++) order[by[len[s]]++] = s;
    for (let i = n - 1; i > 0; i--) { const s = order[i], p = link[s]; for (let v = 0; v <= k; v++) if (D[v][s] < D[v][p]) D[v][p] = D[v][s]; }
    return (A.D = D);
  };
  // One answer byte b in a span's state (s: 0 between characters, 1–3 continuation bytes to come, 4 after \, 5–7 after \u,
  // \u0, \u00, 8 after \u00h; st its automaton state; r characters left; v visible ones still needed; f: none yet):
  // → 0 refused, 1 taken (the state after it in Z), 2 the close.
  const Z = { s: 0, h: 0, st: 0, r: 0, v: 0, f: 0 };
  // A decoded byte d into st, `more` continuation bytes after it in its character, r already counting it.
  const feed = (n, st, r, v, f, d, more) => {
    const A = n.a;
    let t = A.go(st, d);
    if (t < 0) return 0;
    if (more === 0) {
      const fl = A.flags[A.fp[t]];
      if (f && fl & CM) return 0;
      f = 0;
      if (fl & VIS && v > 0) v--;
      if (A.word && fl & NW && (t = A.go(t, MK)) < 0) return 0;
      if (n.D[v][t] > r) return 0;
    } else if (f ? !firstLive(n, t, more) : n.D[v][t] > r) return 0;
    Z.s = more; Z.h = 0; Z.st = t; Z.r = r; Z.v = v; Z.f = f;
    return 1;
  };
  // Mid-way through the first character: some end of it is no mark and leaves a span within maxLength (kept per state, as
  // r and v are the node's own there).
  const firstLive = (n, t, more) => {
    const memo = (n.first ||= new Int8Array(n.a.n));
    if (memo[t]) return memo[t] === 1;
    const A = n.a, r = n.max - 1;
    let ok = false;
    if (more === 0) {
      const fl = A.flags[A.fp[t]], v = fl & VIS && n.min > 0 ? n.min - 1 : n.min, u = A.word && fl & NW ? A.go(t, MK) : t;
      ok = !(fl & CM) && u >= 0 && n.D[v][u] <= r;
    } else for (let e = A.head[t]; e >= 0 && !ok; e = A.eNx[e]) ok = (A.eB[e] & 0xc0) === 0x80 && firstLive(n, A.eTo[e], more - 1);
    memo[t] = ok ? 1 : 2;
    return ok;
  };
  const SHORT = { 0x22: 0x22, 0x5c: 0x5c, 0x62: 8, 0x66: 12, 0x6e: 10, 0x72: 13, 0x74: 9 };
  const short = (d) => d === 8 || d === 9 || d === 10 || d === 12 || d === 13;
  // Some byte an escape in state s can still decode to goes on.
  const escLive = (n, s, h, st, r, v, f) => {
    if (r < 1) return false;
    if (s === 4 && (feed(n, st, r - 1, v, f, 0x22, 0) || feed(n, st, r - 1, v, f, 0x5c, 0))) return true;
    for (let d = s === 8 ? h * 16 : 0, z = s === 8 ? d + 16 : 32; d < z; d++) if ((s === 4 || !short(d)) && feed(n, st, r - 1, v, f, d, 0)) return true;
    return false;
  };
  const esc = (s, h, st, r, v, f) => { Z.s = s; Z.h = h; Z.st = st; Z.r = r; Z.v = v; Z.f = f; return 1; };
  const spanStep = (n, s, h, st, r, v, f, b) => {
    if (s === 0) {
      if (b === 0x22) return v === 0 && (f || n.D[0][st] === 0) ? 2 : 0;
      if (b === 0x5c) return escLive(n, 4, 0, st, r, v, f) ? esc(4, 0, st, r, v, f) : 0;
      if (b < 0x20 || (b >= 0x80 && b < 0xc2) || b > 0xf4 || r < 1) return 0;
      return feed(n, st, r - 1, v, f, b, b < 0x80 ? 0 : b < 0xe0 ? 1 : b < 0xf0 ? 2 : 3);
    }
    if (s <= 3) return (b & 0xc0) === 0x80 ? feed(n, st, r, v, f, b, s - 1) : 0;
    let d = -1;
    if (s === 4) { if (b === 0x75) return escLive(n, 5, 0, st, r, v, f) ? esc(5, 0, st, r, v, f) : 0; d = SHORT[b] ?? -1; }
    else if (s === 5 || s === 6) { if (b === 0x30) return escLive(n, s + 1, 0, st, r, v, f) ? esc(s + 1, 0, st, r, v, f) : 0; }
    else if (s === 7) { if (b === 0x30 || b === 0x31) return escLive(n, 8, b - 0x30, st, r, v, f) ? esc(8, b - 0x30, st, r, v, f) : 0; }
    else { const x = b >= 0x30 && b <= 0x39 ? b - 0x30 : b >= 0x61 && b <= 0x66 ? b - 0x57 : -1; if (x >= 0 && !short(h * 16 + x)) d = h * 16 + x; }
    return d < 0 || r < 1 ? 0 : feed(n, st, r - 1, v, f, d, 0);
  };

  // ---- numbers -------------------------------------------------------------------------------------------------------
  // Exact decimal arithmetic, scaled by 10^fraction (1 for integers). A bound is its double's shortest decimal, rounded
  // inwards: a number inside it in decimals is inside it once parsed, rounding to a double being monotone.
  const P10 = (k) => 10n ** BigInt(k);
  const scaled = (x, sc, up) => {
    let [m, e = '0'] = String(x).toLowerCase().split('e');
    const neg = m[0] === '-';
    if (neg) m = m.slice(1);
    const [ip, fp = ''] = m.split('.'), exp = Number(e) - fp.length;
    const num = (neg ? -1n : 1n) * BigInt(ip + fp) * sc;
    if (exp >= 0) return num * P10(exp);
    const den = P10(-exp);
    let q = num / den;
    if (num % den !== 0n) { if (up && num > 0n) q += 1n; if (!up && num < 0n) q -= 1n; }
    return q;
  };
  const parts = (p) => {
    const neg = p.charCodeAt(0) === 45, body = neg ? p.slice(1) : p, dot = body.indexOf('.');
    return { neg, body, I: dot < 0 ? body : body.slice(0, dot), F: dot < 0 ? null : body.slice(dot + 1) };
  };
  const fits = (n, a, b, neg) => {
    const lo = neg ? -b : a, hi = neg ? -a : b;
    return (n.lo === null || hi >= n.lo) && (n.hi === null || lo <= n.hi);
  };
  // Whether some number with this prefix fits.
  const feasible = (n, p) => {
    const { neg, I, F } = parts(p), sc = n.sc, fd = n.int ? 0 : LIMIT.fraction;
    if (F !== null) { const m = F.length, base = (BigInt(I) * P10(m) + (m ? BigInt(F) : 0n)) * P10(fd - m); return fits(n, base, base + P10(fd - m) - 1n, neg); }
    if (I === '') return fits(n, 0n, P10(LIMIT.digits) * sc - 1n, neg) || (p === '' && fits(n, 0n, P10(LIMIT.digits) * sc - 1n, true));
    if (I === '0') return fits(n, 0n, sc - 1n, neg);
    const v = BigInt(I);
    for (let d = 0; I.length + d <= LIMIT.digits; d++) if (fits(n, v * P10(d) * sc, (v + 1n) * P10(d) * sc - 1n, neg)) return true;
    return false;
  };
  const numDone = (n, p) => {
    const { neg, I, F } = parts(p);
    if (!I || F === '') return false;
    const m = F ? F.length : 0, fd = n.int ? 0 : LIMIT.fraction;
    const v = (BigInt(I) * P10(m) + (m ? BigInt(F) : 0n)) * P10(fd - m);
    return fits(n, v, v, neg);
  };
  // → the prefix with byte b, or null.
  const numNext = (n, p, b) => {
    const { body, F } = parts(p);
    let ok = false;
    if (b === 0x2d) ok = p === '';
    else if (b === 0x2e) ok = !n.int && F === null && body.length > 0;
    else if (b >= 0x30 && b <= 0x39) ok = F !== null ? F.length < LIMIT.fraction : body !== '0' && body.length < LIMIT.digits;
    if (!ok) return null;
    const q = p + String.fromCharCode(b);
    return feasible(n, q) ? q : null;
  };


  // ---- patterns ------------------------------------------------------------------------------------------------------
  // An anchored pattern (^…$) over printable ASCII other than " and \ (so its characters are their own bytes in a JSON
  // string and in raw text) → a DFA { next: [Int32Array(256)] (-1: none), acc, n }; null for anything else: other
  // characters, ., lookarounds, backreferences, \w, \s, a negated class, or more than LIMIT.dfa states.
  const PRINT = (b) => b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c;
  const regex = (src) => {
    if (typeof src !== 'string' || src[0] !== '^' || src.length < 2 || src[src.length - 1] !== '$' || src[src.length - 2] === '\\') return null;
    const end = src.length - 1;
    let i = 1;
    const setOf = (f) => { const t = new Uint8Array(256); for (let b = 0; b < 256; b++) if (f(b)) t[b] = 1; return t; };
    const one = (c) => { const b = c.charCodeAt(0); return b > 0x7e ? null : setOf((x) => x === b); };
    const DIGIT = setOf((b) => b >= 0x30 && b <= 0x39);
    const esc = () => { const c = src[i++]; return c === 'd' ? DIGIT : c !== undefined && '\\^$.|?*+()[]{}/-'.includes(c) ? one(c) : null; };
    const cls = () => {
      if (src[i] === '^' || src[i] === ']') return null;
      const t = new Uint8Array(256);
      while (i < end && src[i] !== ']') {
        let lo;
        if (src[i] === '\\') { i++; const e = esc(); if (!e) return null; if (e === DIGIT) { DIGIT.forEach((v, b) => { if (v) t[b] = 1; }); continue; } lo = e.indexOf(1); }
        else { lo = src.charCodeAt(i++); if (lo > 0x7e) return null; }
        if (src[i] === '-' && i + 1 < end && src[i + 1] !== ']') {
          i++;
          let hi;
          if (src[i] === '\\') { i++; const e = esc(); if (!e || e === DIGIT) return null; hi = e.indexOf(1); } else hi = src.charCodeAt(i++);
          if (hi < lo || hi > 0x7e) return null;
          for (let b = lo; b <= hi; b++) t[b] = 1;
        } else t[lo] = 1;
      }
      if (src[i] !== ']') return null;
      i++;
      return t;
    };
    const atom = () => {
      const c = src[i];
      if (c === '(') {
        i++;
        if (src.startsWith('?:', i)) i += 2; else if (src[i] === '?') return null;
        const x = alt();
        if (!x || src[i] !== ')') return null;
        i++;
        return x;
      }
      if (c === '[') { i++; const t = cls(); return t && { t: 'set', s: t }; }
      if (c === '\\') { i++; const t = esc(); return t && { t: 'set', s: t }; }
      if (c === undefined || '|)?*+{}.^$]'.includes(c)) return null;
      i++;
      const t = one(c);
      return t && { t: 'set', s: t };
    };
    const piece = () => {
      let x = atom();
      while (x) {
        let min, max;
        const c = src[i];
        if (c === '?') { min = 0; max = 1; i++; } else if (c === '*') { min = 0; max = Infinity; i++; } else if (c === '+') { min = 1; max = Infinity; i++; }
        else if (c === '{') {
          const m = /^\{(\d{1,3})(,(\d{0,3}))?\}/.exec(src.slice(i, end));
          if (!m) return null;
          min = Number(m[1]); max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : min;
          if (max < min) return null;
          i += m[0].length;
        } else return x;
        if (src[i] === '?') i++; // lazy: the same strings match
        x = { t: 'rep', x, min, max };
      }
      return null;
    };
    const cat = () => { const a = []; while (i < end && src[i] !== '|' && src[i] !== ')') { const x = piece(); if (!x) return null; a.push(x); } return { t: 'cat', a }; };
    function alt() { const a = [cat()]; while (src[i] === '|') { i++; a.push(cat()); } return a.includes(null) ? null : { t: 'alt', a }; }
    const ast = alt();
    if (!ast || i !== end) return null;
    // Thompson's construction, then subsets.
    const N = [];
    const st = () => { if (N.length > LIMIT.nfa) throw new RangeError('nfa'); N.push({ e: [], on: [] }); return N.length - 1; };
    const build = (x, from) => {
      switch (x.t) {
        case 'set': { const to = st(); N[from].on.push([x.s, to]); return to; }
        case 'cat': return x.a.reduce((f, y) => build(y, f), from);
        case 'alt': { const to = st(); for (const y of x.a) { const a = st(); N[from].e.push(a); N[build(y, a)].e.push(to); } return to; }
        default: {
          let f = from;
          for (let k = 0; k < x.min; k++) f = build(x.x, f);
          if (x.max === Infinity) { const loop = st(); N[f].e.push(loop); N[build(x.x, loop)].e.push(loop); return loop; }
          const to = st();
          N[f].e.push(to);
          for (let k = x.min; k < x.max; k++) { f = build(x.x, f); N[f].e.push(to); }
          return to;
        }
      }
    };
    let start, fin;
    try { start = st(); fin = build(ast, start); } catch { return null; }
    for (const n of N) for (const [t] of n.on) for (let b = 0; b < 256; b++) if (t[b] && !PRINT(b)) return null;
    const closure = (list) => {
      const seen = new Set(list), todo = [...list];
      while (todo.length) for (const t of N[todo.pop()].e) if (!seen.has(t)) { seen.add(t); todo.push(t); }
      return [...seen].sort((a, b) => a - b);
    };
    const index = new Map(), sets = [], next = [], acc = [];
    const id = (set) => { const k = set.join(); if (!index.has(k)) { index.set(k, sets.length); sets.push(set); acc.push(set.includes(fin)); } return index.get(k); };
    id(closure([start]));
    for (let d = 0; d < sets.length; d++) {
      if (sets.length > LIMIT.dfa) return null;
      const row = new Int32Array(256).fill(-1);
      for (let b = 0x20; b < 0x7f; b++) {
        if (!PRINT(b)) continue;
        const to = [];
        for (const n of sets[d]) for (const [t, x] of N[n].on) if (t[b]) to.push(x);
        if (to.length) row[b] = id(closure(to));
      }
      next.push(row);
    }
    return { next, acc, n: sets.length };
  };
  // A pattern held with lengths: soon[d][L], the fewest characters ≥ L that finish from state d (B + 1: none), B the
  // longest string written (maxLength, at most LIMIT.pattern).
  const lengths = (dfa, max) => {
    const B = Math.min(max, LIMIT.pattern), can = Array.from({ length: dfa.n }, (_, d) => { const a = new Uint8Array(B + 1); a[0] = dfa.acc[d] ? 1 : 0; return a; });
    const succ = dfa.next.map((row) => [...new Set(row.filter((t) => t >= 0))]);
    for (let L = 1; L <= B; L++) for (let d = 0; d < dfa.n; d++) if (succ[d].some((t) => can[t][L - 1])) can[d][L] = 1;
    const soon = can.map((a) => { const o = new Int16Array(B + 2).fill(B + 1); for (let L = B; L >= 0; L--) o[L] = a[L] ? L : o[L + 1]; return o; });
    return { B, soon };
  };

  // ---- the schema → nodes --------------------------------------------------------------------------------------------
  // S string {min, max, raw}; P pattern string {dfa, min, max, B, soon, raw}; C span {a (automaton), D, min (visible
  // characters), max}; N number {int, sc, lo, hi}; L literals (a byte trie); O object {props, reqAfter, extra, names}; A
  // array {items, min, max}; Q a sequence {items}; U alternatives.
  // null: nothing fits. raw: a native call's value, no quotes, ended by a line feed.
  const trie = (list) => {
    const kids = [new Map()], term = [-1];
    list.forEach((bs, v) => {
      let t = 0;
      for (const b of bs) {
        let nx = kids[t].get(b);
        if (nx === undefined) { nx = kids.length; kids.push(new Map()); term.push(-1); kids[t].set(b, nx); }
        t = nx;
      }
      term[t] = v;
    });
    return { kids, term };
  };
  const latin1 = (bs) => { let s = ''; for (const b of bs) s += String.fromCharCode(b); return s; };
  const intersect = (a, b) => {
    const A = [].concat(a), B = [].concat(b), out = new Set();
    for (const t of A) {
      if (B.includes(t)) out.add(t);
      else if ((t === 'integer' && B.includes('number')) || (t === 'number' && B.includes('integer'))) out.add('integer');
    }
    return [...out];
  };
  const merge = (rest, alt) => {
    const out = { ...alt };
    for (const [k, v] of Object.entries(rest)) {
      if (k === 'title' || k === 'description') continue;
      if (!Object.hasOwn(alt, k)) { out[k] = v; continue; }
      if (k !== 'type') fail(`anyOf with ${k} both beside it and inside it`);
      const t = intersect(v, alt.type);
      if (!t.length) return null;
      out.type = t;
    }
    if ((Object.hasOwn(rest, 'additionalProperties') && Object.hasOwn(alt, 'properties')) || (Object.hasOwn(alt, 'additionalProperties') && Object.hasOwn(rest, 'properties'))) fail('anyOf splits properties from additionalProperties');
    return out;
  };

  const compile = (schema, V, { tools, sources } = {}) => {
    if (!V || !V.first) fail('compile needs a vocab()');
    if (!S.clean(schema)) fail('the schema is outside ai/schema.js\'s subset');
    if (tools !== undefined && (!Array.isArray(tools) || !tools.length || tools.length > 32)) fail('tools');
    if (sources !== undefined && (!S.isObj(sources) || Object.values(sources).some((t) => typeof t !== 'string'))) fail('sources');
    if (tools && TOOL_MARKS.some((n) => !V.marks?.has(n))) fail('tool calls need the marks of LFM3\'s tool tags (vocab() marks)');
    let ids = 0, exact = true;
    const mk = (o) => { o.id = ids++; return o; };
    const union = (alts) => { const a = alts.flatMap((x) => (!x ? [] : x.k === 'U' ? x.alts : [x])); return !a.length ? null : a.length === 1 ? a[0] : mk({ k: 'U', alts: a }); };
    const lit = (list) => (list.length ? mk({ k: 'L', ...trie(list) }) : null);
    const str = (min, max, raw = false) => (min > max ? null : mk({ k: 'S', min, max, raw }));
    // → a P node, null when nothing fits, undefined when the pattern can't be held.
    const pat = (src, min, max, raw = false) => {
      // The DFA once per vocabulary (V.pats), so its tables below are built once per model.
      if (!V.pats.has(src)) V.pats.set(src, regex(src));
      const dfa = V.pats.get(src);
      if (!dfa) return undefined;
      const { B, soon } = lengths(dfa, max);
      return soon[0][min] <= B ? mk({ k: 'P', dfa, min, max: Math.min(max, B), soon, raw }) : null;
    };
    const seq = (items) => (items.includes(null) ? null : mk({ k: 'Q', items }));
    // → a C node, or undefined when the span can't be held (no such source, too long, or no span of it fits).
    const autos = new Map();
    const copy = (s) => {
      const { source, min: least = 0, word = false } = s.span, text = sources && Object.hasOwn(sources, source) ? sources[source] : undefined;
      const min = Math.max(least, s.minLength ?? 0), max = Math.min(s.maxLength ?? INF - 1, INF - 1);
      if (text === undefined || min > 64) return undefined;
      const k = `${word ? 1 : 0}${source}`;
      if (!autos.has(k)) autos.set(k, automaton(text, word));
      const a = autos.get(k);
      if (!a) return undefined;
      const n = { k: 'C', a, D: distances(a, min), min, max };
      if (min > 0 && !Array.from({ length: 256 }, (_, b) => spanStep(n, 0, 0, a.start, max, min, 1, b)).some((x) => x === 1)) return undefined;
      return mk(n);
    };
    const num = (int, min, max) => {
      const sc = int ? 1n : P10(LIMIT.fraction);
      const n = mk({ k: 'N', int, sc, lo: min === undefined ? null : scaled(min, sc, true), hi: max === undefined ? null : scaled(max, sc, false) });
      return (n.lo === null || n.hi === null || n.lo <= n.hi) && feasible(n, '') ? n : null;
    };
    const anys = [];
    const any = (d) => {
      if (anys[d] !== undefined) return anys[d];
      const scalars = [lit([enc.encode('null')]), lit([enc.encode('true'), enc.encode('false')]), num(false), str(0, Infinity)];
      if (d >= LIMIT.depth) return (anys[d] = union(scalars));
      const a = mk({ k: 'A', items: null, min: 0, max: Infinity }), o = mk({ k: 'O', props: [], reqAfter: new Int32Array(1), extra: null, names: new Set(), tries: [] });
      anys[d] = union([...scalars, a, o]);
      a.items = any(d + 1); o.extra = any(d + 1);
      return anys[d];
    };
    const memo = new Map();
    const node = (s, d) => {
      let byDepth = memo.get(s);
      if (!byDepth) memo.set(s, (byDepth = new Map()));
      if (byDepth.has(d)) return byDepth.get(d);
      const out = build(s, d);
      byDepth.set(d, out);
      return out;
    };
    const build = (s, d) => {
      if (s.anyOf) {
        const rest = { ...s };
        delete rest.anyOf;
        return union(s.anyOf.map((a) => { const m = merge(rest, a); return m && node(m, d); }));
      }
      if (s.const !== undefined || s.enum !== undefined) {
        const seen = new Set(), list = [];
        for (const v of s.const !== undefined ? [s.const] : s.enum) {
          let t;
          try { t = JSON.stringify(v); } catch { continue; }
          if (t === undefined || seen.has(t) || S.validate(JSON.parse(t), s).length) continue;
          seen.add(t); list.push(enc.encode(t));
        }
        return lit(list);
      }
      const types = s.type === undefined ? ['null', 'boolean', 'number', 'string', 'array', 'object'] : [].concat(s.type);
      return union((types.includes('number') ? types.filter((t) => t !== 'integer') : types).map((t) => typed(t, s, d)));
    };
    const typed = (t, s, d) => {
      switch (t) {
        case 'null': return lit([enc.encode('null')]);
        case 'boolean': return lit([enc.encode('true'), enc.encode('false')]);
        case 'string': {
          if (s.span !== undefined && s.pattern === undefined) { const c = copy(s); if (c) return c; }
          if (s.pattern !== undefined) { const p = pat(s.pattern, s.minLength ?? 0, s.maxLength ?? Infinity); if (p !== undefined) return p; exact = false; }
          return str(s.minLength ?? 0, s.maxLength ?? Infinity);
        }
        case 'number': case 'integer': return num(t === 'integer', s.minimum, s.maximum);
        case 'array': {
          const items = s.items !== undefined ? node(s.items, d + 1) : any(d + 1), min = s.minItems ?? 0, max = items ? s.maxItems ?? Infinity : 0;
          return min > max ? null : mk({ k: 'A', items, min, max });
        }
        case 'object': {
          const own = s.properties || {}, req = new Set(s.required || []), props = [];
          for (const k of Object.keys(own)) {
            const n = node(own[k], d + 1);
            if (n) props.push({ key: k, node: n, req: req.has(k) });
            else if (req.has(k)) return null;
          }
          for (const k of req) {
            if (Object.hasOwn(own, k)) continue;
            if (s.additionalProperties === false) return null;
            props.push({ key: k, node: any(d + 1), req: true });
          }
          const reqAfter = new Int32Array(props.length + 1);
          for (let i = props.length - 1; i >= 0; i--) reqAfter[i] = reqAfter[i + 1] + (props[i].req ? 1 : 0);
          const names = new Set([...Object.keys(own), ...req].map((k) => latin1(enc.encode(k))));
          return mk({ k: 'O', props, reqAfter, extra: s.additionalProperties === false ? null : any(d + 1), names, tries: [] });
        }
      }
      return null;
    };
    // One call to tool t, as the comment at the top writes it: an alternative for each set of its optional parameters.
    const bytesOf = (...xs) => Uint8Array.from(xs.flatMap((x) => (typeof x === 'string' ? [...enc.encode(x)] : [V.marks.get(x.mark)])));
    const call = (t) => {
      if (!S.isObj(t) || typeof t.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(t.name) || !S.isObj(t.parameters) || !S.clean(t.parameters)) fail('a tool is { name, parameters }');
      // Calls write object arguments from the properties below; other root constraints are not compiled by this path.
      if ((t.parameters.type !== undefined && ![].concat(t.parameters.type).includes('object')) || t.parameters.const !== undefined
        || t.parameters.enum !== undefined || t.parameters.anyOf !== undefined) fail(`${t.name}: unsupported parameters schema`);
      const own = t.parameters.properties || {}, req = new Set(t.parameters.required || []);
      for (const k of req) if (!Object.hasOwn(own, k)) fail(`${t.name}: required ${k} has no schema`);
      const params = [];
      for (const [k, p] of Object.entries(own)) {
        if (!/^[a-z][a-z0-9_]*$/.test(k) || p.enum !== undefined || p.const !== undefined || p.anyOf !== undefined) fail(`${t.name}: parameter ${k}`);
        const types = [].concat(p.type || []);
        let value, close;
        if (types.length === 1 && types[0] === 'string') {
          const min = p.minLength ?? 0, max = p.maxLength ?? Infinity;
          value = p.pattern !== undefined ? pat(p.pattern, min, max, true) : undefined;
          if (value === undefined) { if (p.pattern !== undefined) exact = false; value = str(min, max, true); }
          close = bytesOf({ mark: '</parameter>' }, '\n');
        } else if (types.length === 1 && types[0] === 'integer') { value = num(true, p.minimum, p.maximum); close = bytesOf('\n', { mark: '</parameter>' }, '\n'); }
        else fail(`${t.name}: parameter ${k} is neither a string nor an integer`);
        const n = value && seq([lit([bytesOf({ mark: '<parameter=' }, `${k}>\n`)]), value, lit([close])]);
        if (!n && req.has(k)) return null;
        if (n) params.push({ n, req: req.has(k) });
      }
      const optional = params.filter((x) => !x.req);
      if (optional.length > LIMIT.optional) fail(`${t.name}: more than ${LIMIT.optional} optional parameters`);
      const head = lit([bytesOf({ mark: '<tool_call>' }, '\n', { mark: '<function=' }, `${t.name}>\n`)]), tail = lit([bytesOf({ mark: '</function>' }, '\n', { mark: '</tool_call>' })]);
      const alts = [];
      for (let bits = 0; bits < 1 << optional.length; bits++) alts.push(seq([head, ...params.filter((x) => x.req || (bits >> optional.indexOf(x)) & 1).map((x) => x.n), tail]));
      return union(alts);
    };
    const root = union([node(schema, 0), ...(tools || []).map(call)]);
    if (!root) fail('no JSON value fits the schema');
    return grammar(root, V, exact);
  };

  // ---- the automaton -------------------------------------------------------------------------------------------------
  // A configuration is a stack of frames, top first, each { k, n (its node), up, … }; the set of live ones is the state.
  // The parent (up) of a value's frame is already in its after-the-value state, so finishing a value is returning up.
  //   S { s: -1 before the quote, else the string state; r code points left; q still needed }
  //   C { s: -1 before the quote, else spanStep's s, h, st, r, v, f }
  //   N { p: the text so far }                L { t: trie node }
  //   O { ph: -1 before {, 0 after {, 1 after a value, 2 in a key (t: key trie node), 3 after a comma; i: next property;
  //       x: past the declared properties, into extra keys }
  //   X { an extra key: s its string state, -2 before the colon; b its bytes }     A { ph: -1 before [, 0 after [, 1 after
  //       an item; c: items so far }
  const DONE = { k: 'D' };
  // The key trie of the properties a key may name from i on: each one up to and including the next required one.
  const keyTrie = (o, i) => {
    if (o.tries[i]) return o.tries[i];
    const list = [], at = [];
    for (let j = i; j < o.props.length; j++) { list.push(enc.encode(`${JSON.stringify(o.props[j].key)}:`)); at.push(j); if (o.props[j].req) break; }
    const t = trie(list);
    t.term = t.term.map((v) => (v < 0 ? -1 : at[v]));
    return (o.tries[i] = t);
  };
  const objAt = (c, ph, i, t, x) => ({ k: 'O', n: c.n, ph, i, t, x, up: c.up });
  const start = (n, up, out) => {
    switch (n.k) {
      case 'U': for (const a of n.alts) start(a, up, out); break;
      case 'S': out.push({ k: 'S', n, s: n.raw ? 0 : -1, r: n.max, q: n.min, up }); break;
      case 'P': out.push({ k: 'P', n, s: n.raw ? 0 : -1, len: 0, up }); break;
      case 'C': out.push({ k: 'C', n, s: -1, h: 0, st: n.a.start, r: n.max, v: n.min, f: 1, up }); break;
      case 'Q': start(n.items[0], { k: 'Q', n, i: 1, up }, out); break;
      case 'N': out.push({ k: 'N', n, p: '', up }); break;
      case 'L': out.push({ k: 'L', n, t: 0, up }); break;
      case 'O': out.push({ k: 'O', n, ph: -1, i: 0, t: 0, x: 0, up }); break;
      case 'A': out.push({ k: 'A', n, ph: -1, c: 0, up }); break;
    }
  };
  const step = (c, b, out) => {
    switch (c.k) {
      case 'S': {
        if (c.s < 0) { if (b === 0x22) out.push({ k: 'S', n: c.n, s: 0, r: c.r, q: c.q, up: c.up }); return; }
        const i = c.s * 256 + b, to = (c.n.raw ? RSTEP : STEP)[i];
        if (to === CLOSE) { if (c.q <= 0) out.push(c.up); return; }
        if (to === FAIL) return;
        if (!(c.n.raw ? RCNT : CNT)[i]) out.push({ k: 'S', n: c.n, s: to, r: c.r, q: c.q, up: c.up });
        else if (c.r >= 1) out.push({ k: 'S', n: c.n, s: to, r: c.r - 1, q: c.q - 1, up: c.up });
        return;
      }
      case 'P': {
        const n = c.n;
        if (c.s < 0) { if (b === 0x22) out.push({ k: 'P', n, s: 0, len: 0, up: c.up }); return; }
        if (b === (n.raw ? 0x0a : 0x22)) { if (n.dfa.acc[c.s] && c.len >= n.min) out.push(c.up); return; }
        const t = n.dfa.next[c.s][b], len = c.len + 1;
        if (t >= 0 && len <= n.max && n.soon[t][Math.max(0, n.min - len)] <= n.max - len) out.push({ k: 'P', n, s: t, len, up: c.up });
        return;
      }
      case 'C': {
        if (c.s < 0) { if (b === 0x22) out.push({ k: 'C', n: c.n, s: 0, h: 0, st: c.st, r: c.r, v: c.v, f: c.f, up: c.up }); return; }
        const t = spanStep(c.n, c.s, c.h, c.st, c.r, c.v, c.f, b);
        if (t === 2) out.push(c.up);
        else if (t === 1) out.push({ k: 'C', n: c.n, s: Z.s, h: Z.h, st: Z.st, r: Z.r, v: Z.v, f: Z.f, up: c.up });
        return;
      }
      case 'Q': {
        if (c.i === c.n.items.length) { step(c.up, b, out); return; }
        const first = [];
        start(c.n.items[c.i], { k: 'Q', n: c.n, i: c.i + 1, up: c.up }, first);
        for (const f of first) step(f, b, out);
        return;
      }
      case 'N': {
        const p = numNext(c.n, c.p, b);
        if (p !== null) out.push({ k: 'N', n: c.n, p, up: c.up });
        else if (numDone(c.n, c.p)) step(c.up, b, out);
        return;
      }
      case 'L': {
        const nx = c.n.kids[c.t].get(b);
        if (nx !== undefined) out.push(c.n.term[nx] >= 0 && !c.n.kids[nx].size ? c.up : { k: 'L', n: c.n, t: nx, up: c.up });
        else if (c.n.term[c.t] >= 0) step(c.up, b, out);
        return;
      }
      case 'O': {
        const o = c.n;
        switch (c.ph) {
          case -1: if (b === 0x7b) out.push(objAt(c, 0, 0, 0, 0)); return;
          case 0: case 3:
            if (b === 0x7d) { if (c.ph === 0 && o.reqAfter[c.i] === 0) out.push(c.up); return; }
            if (b !== 0x22) return;
            if (!c.x && c.i < o.props.length) { const nx = keyTrie(o, c.i).kids[0].get(0x22); if (nx !== undefined) out.push(objAt(c, 2, c.i, nx, 0)); }
            if (o.extra && o.reqAfter[c.i] === 0) out.push({ k: 'X', n: o, s: 0, b: '', up: objAt(c, 1, o.props.length, 0, 1) });
            return;
          case 2: {
            const tr = keyTrie(o, c.i), nx = tr.kids[c.t].get(b);
            if (nx === undefined) return;
            const j = tr.term[nx];
            if (j >= 0) start(o.props[j].node, objAt(c, 1, j + 1, 0, 0), out);
            else out.push(objAt(c, 2, c.i, nx, 0));
            return;
          }
          case 1:
            if (b === 0x2c) { if ((!c.x && c.i < o.props.length) || (o.extra && o.reqAfter[c.i] === 0)) out.push(objAt(c, 3, c.i, 0, c.x)); }
            else if (b === 0x7d && o.reqAfter[c.i] === 0) out.push(c.up);
            return;
        }
        return;
      }
      case 'X': {
        if (c.s === -2) { if (b === 0x3a) start(c.n.extra, c.up, out); return; }
        if (b === 0x5c) return;
        const to = STEP[c.s * 256 + b];
        if (to === CLOSE) { if (!c.n.names.has(c.b)) out.push({ k: 'X', n: c.n, s: -2, b: c.b, up: c.up }); return; }
        if (to !== FAIL) out.push({ k: 'X', n: c.n, s: to, b: c.b + String.fromCharCode(b), up: c.up });
        return;
      }
      case 'A': {
        const a = c.n;
        if (c.ph === -1) { if (b === 0x5b) out.push({ k: 'A', n: a, ph: 0, c: 0, up: c.up }); return; }
        if (c.ph === 0) {
          if (b === 0x5d) { if (a.min === 0) out.push(c.up); return; }
          if (a.max > 0) { const first = []; start(a.items, { k: 'A', n: a, ph: 1, c: 1, up: c.up }, first); for (const f of first) step(f, b, out); }
          return;
        }
        if (b === 0x2c) { if (c.c < a.max) start(a.items, { k: 'A', n: a, ph: 1, c: c.c + 1, up: c.up }, out); }
        else if (b === 0x5d && c.c >= a.min) out.push(c.up);
        return;
      }
    }
  };
  const accepting = (c) => c === DONE || (c.k === 'N' ? numDone(c.n, c.p) && accepting(c.up) : c.k === 'L' ? c.n.term[c.t] >= 0 && accepting(c.up)
    : c.k === 'Q' && c.i === c.n.items.length && accepting(c.up));

  const grammar = (root, V, exact) => {
    const { first, next, byte, tok, tokNext, CAP } = V;
    const cl = (v, cap) => (cap && v > CAP ? CAP : v);
    // A configuration's key: exact (to merge equal ones), or capped (counters past CAP alike), which decides the mask:
    // no token moves a counter by CAP, so states that differ only past it allow the same tokens.
    const key = (c, cap) => {
      if (c === DONE) return 'D';
      const memo = cap ? c.K : c.k0;
      if (memo !== undefined) return memo;
      let s;
      switch (c.k) {
        case 'S': s = `S${c.n.id},${c.s},${cl(c.r, cap)},${cl(Math.max(c.q, 0), cap)}`; break;
        case 'P': s = `P${c.n.id},${c.s},${c.len}`; break;
        case 'C': s = `C${c.n.id},${c.s},${c.h},${c.st},${c.r},${c.v},${c.f}`; break;
        case 'Q': s = `Q${c.n.id},${c.i}`; break;
        case 'N': s = `N${c.n.id},${c.p}`; break;
        case 'L': s = `L${c.n.id},${c.t}`; break;
        case 'O': s = `O${c.n.id},${c.ph},${c.i},${c.t},${c.x}`; break;
        case 'X': s = `X${c.n.id},${c.s},${c.b}`; break;
        case 'A': s = cap ? `A${c.n.id},${c.ph},${cl(c.n.max - c.c, true)},${cl(Math.max(c.n.min - c.c, 0), true)}` : `A${c.n.id},${c.ph},${c.c}`; break;
      }
      s += `/${key(c.up, cap)}`;
      if (cap) c.K = s; else c.k0 = s;
      return s;
    };
    // A sequence's frame between items is replaced by its next item's start (or, past its last, by its parent), so a
    // string that begins an item is a string frame when its mask is made, on its table, not walked over the trie.
    const settle = (list) => {
      if (!list.some((c) => c.k === 'Q')) return list;
      const out = [];
      const put = (c) => {
        if (c.k !== 'Q') { out.push(c); return; }
        if (c.i === c.n.items.length) { put(c.up); return; }
        const started = [];
        start(c.n.items[c.i], { k: 'Q', n: c.n, i: c.i + 1, up: c.up }, started);
        started.forEach(put);
      };
      list.forEach(put);
      return out;
    };
    const stepSet = (set, b) => {
      const out = settle((() => { const o = []; for (const c of set) step(c, b, o); return o; })());
      if (out.length < 2) return out;
      const seen = new Set();
      return out.filter((c) => { const k = key(c, false); if (seen.has(k)) return false; seen.add(k); return true; });
    };
    // Each token from trie node nd on that the configurations take: into mask m, or, with ids, onto that list.
    const walk = (set, nd, m, ids = null) => {
      // Token byte length is independent of JSON nesting depth and may exceed the call stack.
      const stack = [set, nd];
      while (stack.length) {
        const at = stack.pop(), states = stack.pop();
        for (let c = first[at]; c >= 0; c = next[c]) {
          const ns = stepSet(states, byte[c]);
          if (!ns.length) continue;
          for (let t = tok[c]; t >= 0; t = tokNext[t]) { if (ids) ids.push(t); else m[t >>> 5] |= 1 << (t & 31); }
          if (first[c] >= 0) stack.push(ns, c);
        }
      }
    };
    // The tokens that close a string in state e and go on into what follows it (up), each with the code points it adds
    // before the close: walked once per (e, up) and kept, since they don't depend on the counters (a native call's value
    // closes at a line feed, which thousands of tokens hold).
    let closing = new Map(), closingOld = new Map();
    // The first bytes what follows a value takes: a close node's subtree is walked only where one of them starts it.
    let opened = new Map();
    const opens = (up) => {
      const k = key(up, true);
      let f = opened.get(k);
      if (f) return f;
      f = new Uint8Array(256);
      for (let b = 0; b < 256; b++) if (stepSet([up], b).length) f[b] = 1;
      if (opened.size >= LIMIT.cache) opened = new Map();
      opened.set(k, f);
      return f;
    };
    const onward = (nd, f) => { for (let c = first[nd]; c >= 0; c = next[c]) if (f[byte[c]]) return true; return false; };
    const closers = (c, T, pattern = false) => {
      const k = `${pattern ? 'p' : ''}${c.n.raw ? 'r' : 's'}${pattern ? c.n.id : ''},${c.s}/${key(c.up, true)}`;
      let out = closing.get(k) || closingOld.get(k);
      if (out) return out;
      const ids = [], ks = [], up = [c.up], f = opens(c.up), nodes = pattern ? T.cn : T.cn, counts = pattern ? T.ck : T.cc;
      for (let g = 0; g < nodes.length; g++) {
        const nd = nodes[g], before = ids.length;
        for (let t = tok[nd]; t >= 0; t = tokNext[t]) ids.push(t);
        if (first[nd] >= 0 && onward(nd, f)) walk(up, nd, null, ids);
        for (let i = before; i < ids.length; i++) ks.push(counts[g]);
      }
      out = { ids: Int32Array.from(ids), ks: Int32Array.from(ks) };
      if (closing.size >= LIMIT.cache) { closingOld = closing; closing = new Map(); }
      closing.set(k, out);
      return out;
    };
    // Inside a string: the tokens that stay in it, by the table, then those that close it, walked on from its parent.
    const strMask = (c, m) => {
      const T = strTable(V, c.s, c.n.raw), r = c.r;
      if (r >= T.top) for (let w = 0; w < m.length; w++) m[w] |= T.all[w];
      else for (let k = 0; k < T.ids.length && T.cnt[k] <= r; k++) { const t = T.ids[k]; m[t >>> 5] |= 1 << (t & 31); }
      const { ids, ks } = closers(c, T);
      for (let i = 0; i < ids.length; i++) if (ks[i] <= r && ks[i] >= c.q) { const t = ids[i]; m[t >>> 5] |= 1 << (t & 31); }
    };
    // The tokens through trie node nd, whose last byte closes a span, that go on into what follows it (up).
    const spanClosers = (nd, up) => {
      const k = `c${nd}/${key(up, true)}`;
      let out = closing.get(k) || closingOld.get(k);
      if (out) return out;
      const ids = [];
      for (let t = tok[nd]; t >= 0; t = tokNext[t]) ids.push(t);
      if (first[nd] >= 0 && onward(nd, opens(up))) walk([up], nd, null, ids);
      out = Int32Array.from(ids);
      if (closing.size >= LIMIT.cache) { closingOld = closing; closing = new Map(); }
      closing.set(k, out);
      return out;
    };
    // Inside a span: the trie walked with the span's state, a branch dropped where the source has no such bytes or what
    // follows could no longer finish; kept apart from its parent (a span starts alike in every item of a list), with the
    // trie nodes where a token closes it, whose tokens are walked on from the parent (spanClosers).
    let inner = new Map(), innerOld = new Map();
    const spanMask = (c, m) => {
      const n = c.n, k = `${n.id},${c.s},${c.h},${c.st},${c.r},${c.v},${c.f}`;
      let w = inner.get(k) || innerOld.get(k);
      if (!w) {
        const own = new Uint32Array(V.words), closes = [], stack = [0, c.s, c.h, c.st, c.r, c.v, c.f];
        while (stack.length) {
          const f = stack.pop(), v = stack.pop(), r = stack.pop(), st = stack.pop(), h = stack.pop(), s = stack.pop(), nd = stack.pop();
          for (let ch = first[nd]; ch >= 0; ch = next[ch]) {
            const t = spanStep(n, s, h, st, r, v, f, byte[ch]);
            if (t === 0) continue;
            if (t === 2) { closes.push(ch); continue; }
            for (let x = tok[ch]; x >= 0; x = tokNext[x]) own[x >>> 5] |= 1 << (x & 31);
            if (first[ch] >= 0) stack.push(ch, Z.s, Z.h, Z.st, Z.r, Z.v, Z.f);
          }
        }
        w = { own, closes };
        if (inner.size >= LIMIT.cache) { innerOld = inner; inner = new Map(); }
        inner.set(k, w);
      }
      for (let i = 0; i < m.length; i++) m[i] |= w.own[i];
      for (const ch of w.closes) { const ids = spanClosers(ch, c.up); for (let i = 0; i < ids.length; i++) { const x = ids[i]; m[x >>> 5] |= 1 << (x & 31); } }
    };
    // Inside a pattern string: the tokens that stay in it while it can still finish within its lengths, then those that
    // close it where its DFA accepts, walked on from its parent.
    const patMask = (c, m) => {
      const n = c.n, T = patTable(V, n.dfa, c.s, n.raw), rem = n.max - c.len;
      for (let i = 0; i < T.ids.length; i++) {
        const k = T.lens[i];
        if (k <= rem && n.soon[T.ends[i]][Math.max(0, n.min - c.len - k)] <= rem - k) { const t = T.ids[i]; m[t >>> 5] |= 1 << (t & 31); }
      }
      const { ids, ks } = closers(c, T, true);
      for (let i = 0; i < ids.length; i++) if (ks[i] <= rem && c.len + ks[i] >= n.min) { const t = ids[i]; m[t >>> 5] |= 1 << (t & 31); }
    };
    let cache = new Map(), older = new Map();
    const maskOf = (set) => {
      const k = set.map((c) => key(c, true)).sort().join('\n');
      let m = cache.get(k) || older.get(k);
      if (m) return m;
      m = new Uint32Array(V.words);
      const rest = [];
      for (const c of set) { if (c.k === 'S' && c.s >= 0) strMask(c, m); else if (c.k === 'P' && c.s >= 0) patMask(c, m); else if (c.k === 'C' && c.s >= 0) spanMask(c, m); else rest.push(c); }
      if (rest.length) walk(rest, 0, m);
      if (set.some(accepting)) for (const e of V.eos) m[e >>> 5] |= 1 << (e & 31);
      if (cache.size >= LIMIT.cache) { older = cache; cache = new Map(); }
      cache.set(k, m);
      return m;
    };
    const EMPTY = new Uint32Array(V.words);
    const matcher = (set, ended) => ({
      mask: () => (ended ? EMPTY : maskOf(set)),
      advance(id) {
        if (ended) throw new RangeError('grammar: the answer has ended');
        if (V.eos.has(id)) {
          if (!set.some(accepting)) throw new RangeError('grammar: the end token before the value is whole');
          ended = true; set = [];
          return;
        }
        const bs = Number.isInteger(id) ? V.bytes[id] : null;
        if (!bs) throw new RangeError(`grammar: token ${id} is not text`);
        let s = set;
        for (const b of bs) if (!(s = stepSet(s, b)).length) throw new RangeError(`grammar: token ${id} doesn't fit`);
        set = s;
      },
      get complete() { return !ended && set.some(accepting); },
      get done() { return ended; },
      // An independent copy from here (frames never change, so it shares them).
      fork: () => matcher(set, ended),
    });
    return {
      exact,
      matcher() { const set = []; start(root, DONE, set); return matcher(settle(set), false); },
    };
  };

  return { LIMIT, TOOL_MARKS, vocab, compile };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_GRAMMAR; else GZ_AI_GRAMMAR;
