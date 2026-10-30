// Glaze's own tokenizer for the local engine's models: byte-level BPE as LiquidAI's LFM3 specifies it (tokenizer.json at
// huggingface.co/LiquidAI/LFM3-1.7B, commit ac2586a3): no normalizer; the pre-tokenizer's one Split regex (Isolated),
// then the GPT-2 byte → character table; BPE by merge rank with ignore_merges (a piece the vocabulary holds whole is
// one token); added tokens; the ByteLevel decoder. A tokenizer.json or a GGUF's tokenizer.ggml.* keys load the same
// neutral vocabulary, and anything they say that this file doesn't do is refused rather than ignored.
// Page text can never produce a control token: encode() reads added tokens only when asked, and Glaze's own specials
// (add) only ever come from encodeWith. scripts/local-tokenizer-check.js holds it to HF tokenizers line for line.
// Classic script; node exports.
var GZ_AI_TOKENIZER = globalThis.GZ_AI_TOKENIZER || (() => {
  // GPT-2's table: printable Latin-1 bytes are themselves, the other 68 are U+0100 onwards in byte order.
  const BYTE_CHAR = new Uint16Array(256);
  const CHAR_BYTE = new Int16Array(0x144).fill(-1);
  for (let b = 0, n = 0; b < 256; b++) {
    const keep = (b >= 33 && b <= 126) || (b >= 161 && b <= 172) || b >= 174;
    BYTE_CHAR[b] = keep ? b : 256 + n++;
    CHAR_BYTE[BYTE_CHAR[b]] = b;
  }

  // HF tokenizers' regex engine (onig) has its own Unicode tables, older than any browser's: to it 17,144 of today's letters
  // (U+0C5C, U+A7CE…) and 336 digits are neither, and those decide where a word ends. Its classes are pinned here, read
  // off HF tokenizers 0.22.2's own splits of every code point ("a"+c one piece: a letter; "1"+c: a digit; c+"!" two
  // pieces and neither: White_Space), so every runtime splits as the model's tokenizer did. Ranges, each as base-36
  // "gap" or "gap.length" from the last one's end.
  const ONIG = {
    L: '1t.p,7.p,1c,b,5,6.m,2.u,2.cp,5.b,f.4,8,2,3m.4,2.1,3.3,2,7,2.2,2,2.j,2.2a,2.3u,9.4l,2.11,3,7.14,20.q,5.3,1a.16,10.1,2.2q,2,g.1,8.1,b.2,3,h,2.t,u.2g,c,p.w,a.1,5,6.l,5,a,4,o.o,8.a,6.n,2.5,i.15,1n.1h,4,j,8.9,g.f,5.7,3.1,3.l,2.6,2,4.3,4,h,e.1,2.2,f.1,b,9.5,5.1,3.l,2.6,2.1,2.1,2.1,w.3,2,k.2,h.8,2.2,2.l,2.6,2.1,2.4,4,j,g.1,o,c.7,3.1,3.l,2.6,2.1,2.4,4,v.1,2.2,g,i,2.5,4.2,2.3,4.1,2,2.1,4.1,4.2,4.b,n,1h.7,2.2,2.m,2.f,4,r.2,3,3.1,v,5.7,2.2,2.m,2.9,2.4,4,w.1,2.1,g.1,i.8,2.2,2.14,3,h,6.2,9.2,p.5,6.h,4.n,2.8,2,3.6,1n.1b,2.1,d.6,1n.1,2,2.4,2.n,2,2.9,2.1,a,3.4,2,m.3,x,1s.7,2.z,s.4,38.16,l,h.5,5.3,4,4.1,8.2,5.c,d,i.11,2,6,3.16,2.98,2.3,3.6,2,2.3,3.14,2.3,3.w,2.3,3.6,2,2.3,3.e,2.1k,2.3,3.1u,12.f,h.2d,3.5,4.h7,3.g,2.p,6.22,7.7,8.h,e.i,f.h,f.c,2.2,g.1f,10,5,1w.2g,8.4,3.x,2,6.1x,b.u,1e.t,3.4,c.17,5.p,1j.m,a.1g,2b,2m.1a,i.7,1j.t,e.1,b.17,r.z,16.2,b.z,3.a,6.16,3.2,16.3,2.5,2.1,4,6.5b,1t.7p,3.5,3.11,3.5,3.7,2,2,2,2.u,3.1g,2.6,2,4.2,2.6,4.3,3.5,5.c,6.2,2.6,39,e,h.c,2u,5,3.9,2,4.4,7,2,2,2.3,2.a,3.3,6.4,5,1h.1,22k.6c,7.3,4.1,d.11,2,6,3.1j,8,h.m,a.6,2.6,2.6,2.6,2.6,2.6,2.6,2.6,29,d2.1,17.4,6.1,5.2d,7.2,2.2h,2.3,6.16,2.2l,i.v,1d.f,e9.533,1t.h3g,1w.19,3.7g,4.f,b.1,l.1a,h.u,3.1x,1e.8,3.2u,3.1u,3.1,2,2.7,m.f,2.2,2.3,2.m,u.1f,f.1d,1r.5,4,2.1,c.r,b.m,q.s,8.1a,t,h.4,2.9,b.4,2.14,o.2,2.7,l.m,4,4.1d,2,4.1,3.4,3,2,p.2,3.a,8.2,d.5,3.5,3.5,a.6,2.6,2.16,2.d,7.36,u.8mb,d.m,5.1c,6it.a5,3.2x,13.6,d.4,6,2.9,2.c,2.4,2,2.1,2.1,2.2z,y.a2,j.1r,3.1h,15.b,39.4,2.3q,11.p,7.p,c.2g,4.5,3.5,3.5,3.2,10.b,2.p,2.i,2.1,2.e,3.d,z.3e,au.s,4.1c,1c.v,e.j,2.7,7.11,b.t,3.z,5.7,1d.4d,j.z,5.z,5.13,9.1f,d.a,2.e,2.6,2.1,2.a,2.e,2.6,2.1,4.1f,d.8m,a.l,b.7,p.5,2.15,2.8,1y.5,3,2.17,2.1,4,3.m,b.m,a.u,1u.i,2.1,b.l,b.p,1z.1j,7.1,1t,g.3,2.2,2.s,17.s,4.s,10.7,2.r,s.1h,b.l,b.i,e.h,33.20,1k.1e,e.1e,e.z,13.r,a.m,6z.15,7.1,h.2,1o.s,b,9.l,17.h,1b.k,s.m,d.1g,1m.1,3,e.18,x.o,r.z,u,3,9.y,4,d.1b,f.3,m,2,10.h,2.o,k.1,1s.6,2,2.3,2.e,2.9,8.1a,13.7,3.1,3.l,2.6,2.1,2.4,4,j,d.4,v.9,2,3,2.11,2,q,2,19.1g,j.3,l.2,v.1b,l.1,2,55.1a,16.3,11.1b,l,1o.16,e,20.q,12.6,56.17,39.1r,w.7,3,3.7,2.1,2.n,g,2,2n.7,3.12,h,2,t,b.13,8,m,c.19,k,j.20,5k.w,w.8,2.10,i,1e.t,35.6,2.1,2.11,m,q.5,2.1,2.v,f,94.i,g,2.c,2.x,3h,28.pl,6f.5f,219.2o,g.tr,i.5,q.32y,6.g6,5a2.t,1cz.fs,8.u,i.26,i.t,j.1b,h.3,w.k,6.i,c1.18,5w.1r,3l.22,6,1v.c,1t.1,2,t.4qf,9.yd,16.9,6w8.3,2.6,2.1,2.82,g,u.2,3,f.3,9.az,1s5.2y,6.c,4.8,8.9,4mf.2c,2.1y,2.1,3,3.1,3.3,2.b,2,2.6,2.1s,2.3,3.7,2.6,2.r,2.3,2.4,2,4.6,2.9f,3.o,2.o,2.u,2.o,2.u,2.o,2.u,2.o,2.u,2.o,2.7,1f9.u,7.5,7a.1p,43.18,b.6,h,8y.t,j.17,dh.r,6d.t,3,ds.6,2.3,2.1,2.e,2.5g,1o.1v,8,xh.3,2.q,2.1,2,3,2.9,2.3,2,2,7,5,2,2,2.2,2.1,2,3,2,2,2,2,2.1,2,3.3,2.6,2.3,2.3,2,2.9,2.g,6.2,2.4,2.g,3et.wyn,x.37d,7.65,3.4g1,f.5rk,g.h9,1wj.f1,15v.3t6,6.38f',
    N: '1c.9,3d.1,6,3.2,142.9,3r.9,5j.9,bh.9,3b.9,5.5,31.9,3b.9,3b.9,3.5,33.c,38.9,9.6,2w.9,2x.6,8.i,32.9,2p.9,3b.9,1z.j,7h.9,1z.9,k0.j,oi.2,6o.9,7.9,n.9,8d.9,3l.a,4m.9,7.9,53.9,2f.9,3r.9,7.9,t3,4.5,7.9,5j.1e,3.4,k7.1n,27.l,hj.t,12i,lm,q.8,f.2,9k.3,3v.9,v.7,2.e,x.9,14.e,msh.9,59.9,8x.5,4b.9,13.9,5j.9,n.9,2f.9,bb.9,gev.9,dq.18,d.1k,i.1,9i.q,11.3,u,9,3r.4,5n.9,q7.7,q.6,14.8,24.4,n.5,4h.1,3.f,3.19,1t.8,1h.1,v.2,24.4,2x.7,p.7,16.6,97.5,1d.9,7.9,7r.u,4f.9,17.3,35.6,3r.t,3l.9,1p.9,41.9,8.j,70.9,9j.9,3b.9,af.9,2v.9,7.j,25.b,bp.i,2m.9,if.9,2f.s,6c.9,1z.9,br.9,2v.k,to.32,c02.9,1t3.9,2f.9,3r.9,2.6,en.9,7b.m,imy.9,153.j,d.j,31.o,uu.1d,1tt.9,br.9,dz.9,6w.9,jx.8,3l.9,m0.1m,2.2,2.3,25.18,2.e,qr.c,25g.9',
    W: '9.4,j,2t,r,4bk,1vk.a,u.1,6,1c,335',
  };
  const cls = (packed) => {
    let at = 0, out = '';
    for (const r of packed.split(',')) {
      const [g, n = '0'] = r.split('.');
      const a = at + parseInt(g, 36), b = a + parseInt(n, 36);
      out += a === b ? `\\u{${a.toString(16)}}` : `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`;
      at = b;
    }
    return out;
  };
  // Pre-tokenizers by GGUF name, with the onig regex a tokenizer.json writes for each and its JS (made on first use).
  // onig's \s is Unicode White_Space (U+0085 in, U+FEFF out), and its (?i:'s) also takes ſ, the one letter that
  // case-folds onto those (HF: 'ſt is 'ſ, t).
  const PRE = {
    lfm2: {
      hf: "(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}{1,3}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+",
      js: () => {
        const L = cls(ONIG.L), N = cls(ONIG.N), W = cls(ONIG.W);
        return `'(?:[sS\\u017f]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])|[^\\r\\n${L}${N}]?[${L}]+|[${N}]{1,3}| ?[^${W}${L}${N}]+[\\r\\n]*|[${W}]*[\\r\\n]+|[${W}]+(?![^${W}])|[${W}]+`;
      },
      ignoreMerges: true,
    },
  };
  // GGUF token types.
  const T = { normal: 1, unknown: 2, control: 3, user: 4, unused: 5, byte: 6 };
  // Glaze's own specials. Append-only: their ids are trained into the published weights (each takes the model's next
  // reserved row, in this order), so never reorder or remove one.
  const GLAZE_TOKENS = Object.freeze(['<|gz_ctx|>', '<|/gz_ctx|>', '<|gz_data|>', '<|/gz_data|>',
    ...['writer.complete', 'writer.review', 'writer.feedback', 'writer.outline', 'writer.requirements', 'writer.cite', 'writer.sources',
      'writer.decide', 'writer.image', 'syllabus.read'].map((t) => `<|gz_task:${t}|>`)]);
  const enc = new TextEncoder();
  const fail = (what) => { throw new TypeError(`tokenizer: ${what}`); };
  // Lone surrogates → U+FFFD, as TextEncoder makes them.
  const well = (s) => (s.toWellFormed ? s.toWellFormed() : s.replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, (m) => (m.length === 2 ? m : '\ufffd')));
  const pair = (m) => {
    if (Array.isArray(m) && m.length === 2) return m;
    const s = String(m), i = s.indexOf(' ');
    if (i <= 0 || i !== s.lastIndexOf(' ') || i === s.length - 1) fail(`merge ${JSON.stringify(s)}`);
    return [s.slice(0, i), s.slice(i + 1)];
  };

  // A token's bytes as the ByteLevel decoder gives them: each character back through the table, or, when one isn't in
  // it, the token's own UTF-8 (HF's rule, per token).
  const tokenBytes = (s) => {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i), b = c < CHAR_BYTE.length ? CHAR_BYTE[c] : -1;
      if (b < 0) return enc.encode(s);
      out[i] = b;
    }
    return out;
  };

  // Merge ranks in an open-addressed table of (left id, right id) → rank, and rank → the merged id.
  const mergeTable = (merges, vocab) => {
    const cap = 1 << Math.max(10, Math.ceil(Math.log2(merges.length * 2 + 1)));
    const ka = new Int32Array(cap).fill(-1), kb = new Int32Array(cap), rk = new Int32Array(cap), to = new Int32Array(merges.length);
    const mask = cap - 1;
    const slot = (a, b) => (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b)) & mask;
    merges.forEach((m, r) => {
      const [x, y] = pair(m);
      const a = vocab.get(x), b = vocab.get(y), c = vocab.get(x + y);
      if (a === undefined || b === undefined || c === undefined) fail(`merge ${JSON.stringify(`${x} ${y}`)} is not in the vocabulary`);
      let i = slot(a, b);
      while (ka[i] !== -1 && !(ka[i] === a && kb[i] === b)) i = (i + 1) & mask;
      ka[i] = a; kb[i] = b; rk[i] = r; to[r] = c; // a merge listed twice ranks where it is last, as in HF's map
    });
    const rank = (a, b) => {
      for (let i = slot(a, b); ; i = (i + 1) & mask) {
        const k = ka[i];
        if (k === -1) return -1;
        if (k === a && kb[i] === b) return rk[i];
      }
    };
    return { rank, to };
  };

  // v: { tokens, types, merges, pre, rows?, ignoreMerges?, bos?, eos?, pad?, addBos? }: tokens by id, as GGUF lists them
  // (byte-level strings; an added token's own text), types as GGUF's, merges as "a b" or [a, b] in rank order, rows the
  // model's embedding rows (default: the tokens). opts.cache: words kept.
  const load = (v, opts = {}) => {
    const pre = PRE[v.pre];
    if (!pre) fail(`pre-tokenizer ${JSON.stringify(v.pre)}`);
    const tokens = Array.from(v.tokens, String), types = Array.from(v.types || tokens.map(() => T.normal), Number);
    if (types.length !== tokens.length) fail('types and tokens differ in length');
    const ignoreMerges = v.ignoreMerges ?? pre.ignoreMerges;
    const rows = v.rows ?? tokens.length;
    if (!Number.isInteger(rows) || rows < tokens.length) fail(`rows ${rows}`);
    const vocab = new Map(), specials = new Map(), kinds = new Uint8Array(rows).fill(T.unused);
    let longest = 0;
    tokens.forEach((t, id) => {
      const ty = types[id];
      kinds[id] = ty;
      if (ty === T.control || ty === T.user) { if (!specials.has(t)) specials.set(t, id); }
      else if (ty !== T.unused) { if (!vocab.has(t)) vocab.set(t, id); longest = Math.max(longest, t.length); }
    });
    const byteId = new Int32Array(256);
    for (let b = 0; b < 256; b++) {
      const id = vocab.get(String.fromCharCode(BYTE_CHAR[b]));
      if (id === undefined) fail(`byte 0x${b.toString(16)} has no token`);
      byteId[b] = id;
    }
    const { rank, to } = mergeTable(Array.from(v.merges || []), vocab);
    const re = new RegExp((pre.src ||= pre.js()), 'gu');
    // Added tokens in text (specials: true): leftmost, then longest, as HF's matcher; an empty one, which HF ignores, never.
    const matched = [...specials.keys()].filter(Boolean);
    const addedRe = matched.length ? new RegExp(matched.sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|'), 'g') : null;
    // Reserved rows, in id order: the unused ones (a GGUF's [PAD…]), then any rows past the tokens. GLAZE_TOKENS[i] takes
    // the i-th, so a GGUF and a tokenizer.json with the model's rows give the same ids.
    const reserved = [];
    for (let id = 0; id < rows; id++) if (kinds[id] === T.unused) reserved.push(id);
    const glaze = new Map(), glazeName = new Map(); // name ↔ id of the Glaze specials added
    const idOk = (id) => { if (!Number.isInteger(id) || id < 0 || id >= rows) throw new RangeError(`tokenizer: id ${id}`); return id; };

    // ---- BPE ---------------------------------------------------------------------------------------------------------
    let buf = new Uint8Array(1024), chars = new Uint16Array(256), sym = new Int32Array(256), next = new Int32Array(256), prev = new Int32Array(256), heap = new Float64Array(256);
    const grow = (n) => {
      if (buf.length < n * 3) buf = new Uint8Array(n * 3 + 64);
      if (sym.length < n * 3) { const m = n * 3 + 64; sym = new Int32Array(m); next = new Int32Array(m); prev = new Int32Array(m); heap = new Float64Array(m * 2); }
    };
    const P = 2 ** 32;
    // A min-heap of rank·2³² + left position: the lowest rank merges first, the leftmost on a tie.
    let h = 0;
    const push = (key) => {
      if (h === heap.length) { const g = new Float64Array(h * 2); g.set(heap); heap = g; }
      let i = h++;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p] <= key) break; heap[i] = heap[p]; i = p; }
      heap[i] = key;
    };
    const pop = () => {
      const top = heap[0], last = heap[--h];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= h) break;
        if (c + 1 < h && heap[c + 1] < heap[c]) c++;
        if (heap[c] >= last) break;
        heap[i] = heap[c]; i = c;
      }
      heap[i] = last;
      return top;
    };
    const bpe = (piece) => {
      grow(piece.length);
      const n = enc.encodeInto(piece, buf).written;
      if (ignoreMerges && n <= longest) {
        if (chars.length < n) chars = new Uint16Array(longest);
        for (let i = 0; i < n; i++) chars[i] = BYTE_CHAR[buf[i]];
        const whole = vocab.get(String.fromCharCode.apply(null, chars.subarray(0, n)));
        if (whole !== undefined) return [whole];
      }
      for (let i = 0; i < n; i++) { sym[i] = byteId[buf[i]]; prev[i] = i - 1; next[i] = i + 1 < n ? i + 1 : -1; }
      h = 0;
      for (let i = 0; i + 1 < n; i++) { const r = rank(sym[i], sym[i + 1]); if (r >= 0) push(r * P + i); }
      while (h > 0) {
        const key = pop(), r = Math.floor(key / P), i = key - r * P;
        const j = next[i];
        if (sym[i] < 0 || j < 0 || rank(sym[i], sym[j]) !== r) continue;
        sym[i] = to[r]; sym[j] = -1;
        const k = next[j];
        next[i] = k;
        if (k >= 0) prev[k] = i;
        if (prev[i] >= 0) { const q = rank(sym[prev[i]], sym[i]); if (q >= 0) push(q * P + prev[i]); }
        if (k >= 0) { const q = rank(sym[i], sym[k]); if (q >= 0) push(q * P + i); }
      }
      const out = [];
      for (let i = 0; i >= 0; i = next[i]) out.push(sym[i]);
      return out;
    };

    // Words (pre-tokenizer pieces) → ids. Two generations of opts.cache words: a word found in the older one moves to the
    // newer, and a full newer one becomes the older (deleting a Map's oldest entry one at a time is slow in V8).
    const CACHE = opts.cache ?? 16384;
    let cache = new Map(), older = new Map();
    const word = (piece) => {
      let ids = cache.get(piece);
      if (ids) return ids;
      if (piece.length > 256) return bpe(piece);
      ids = older.get(piece) || bpe(piece);
      if (cache.size >= CACHE) { older = cache; cache = new Map(); }
      cache.set(piece, ids);
      return ids;
    };

    // Ids are collected in one growing Uint32Array.
    const sink = () => {
      let a = new Uint32Array(256), n = 0;
      return {
        add(ids) {
          if (n + ids.length > a.length) { const g = new Uint32Array(Math.max(a.length * 2, n + ids.length)); g.set(a.subarray(0, n)); a = g; }
          for (let i = 0; i < ids.length; i++) a[n++] = ids[i];
        },
        get n() { return n; },
        done: () => a.slice(0, n),
      };
    };
    const pieces = (text, each) => {
      re.lastIndex = 0;
      let last = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > last) each(text.slice(last, m.index));
        each(m[0]);
        last = re.lastIndex;
      }
      if (last < text.length) each(text.slice(last));
    };
    const plainText = (text, out) => { if (text) pieces(text, (p) => out.add(word(p))); };
    const run = (text, specialsOn, out) => {
      const s = well(String(text));
      if (!specialsOn || !addedRe) return plainText(s, out);
      addedRe.lastIndex = 0;
      let last = 0, m;
      while ((m = addedRe.exec(s))) {
        plainText(s.slice(last, m.index), out);
        out.add([specials.get(m[0])]);
        last = addedRe.lastIndex;
      }
      plainText(s.slice(last), out);
    };

    // ---- decoding ----------------------------------------------------------------------------------------------------
    // Each model token's bytes, made once; null for added and unused ones.
    let base = null;
    const baseBytes = () => (base ||= Array.from({ length: rows }, (_, id) => (kinds[id] === T.normal || kinds[id] === T.unknown || kinds[id] === T.byte ? tokenBytes(tokens[id]) : null)));
    const EMPTY = new Uint8Array(0);
    const added = new Map(); // id → bytes of an added token's text, for decoding
    const idBytes = (id, specialsOn) => {
      idOk(id);
      const k = kinds[id];
      if (k === T.unused || (k === T.control && !specialsOn)) return EMPTY;
      if (k === T.control || k === T.user) {
        let b = added.get(id);
        if (!b) { b = glazeName.has(id) ? enc.encode(glazeName.get(id)) : tokenBytes(tokens[id]); added.set(id, b); }
        return b;
      }
      return baseBytes()[id];
    };

    return {
      size: rows,
      get cached() { return cache.size + older.size; },
      bos: v.bos ?? null, eos: v.eos ?? null, pad: v.pad ?? null, addBos: !!v.addBos,
      // → Uint32Array. specials: true reads the model's added tokens in the text; never Glaze's.
      encode(text, { specials: sp = false } = {}) { const out = sink(); run(text, sp, out); return out.done(); },
      count(text, { specials: sp = false } = {}) { const out = sink(); run(text, sp, out); return out.n; },
      // parts: [{ text } | { special: name }], name an added token's text or one add() registered.
      encodeWith(parts) {
        const out = sink();
        for (const p of parts) {
          const keys = p && typeof p === 'object' ? Object.keys(p) : [];
          if (keys.length !== 1 || !(keys[0] === 'text' || keys[0] === 'special')) fail('a part is { text } or { special }');
          if (keys[0] === 'text') { run(p.text, false, out); continue; }
          const id = this.id(p.special);
          if (id === undefined) fail(`unknown special ${JSON.stringify(p.special)}`);
          out.add([id]);
        }
        return out.done();
      },
      id(name) { return specials.get(name) ?? glaze.get(name); },
      // A Glaze special (one of GLAZE_TOKENS), in its reserved row; the same name keeps its id. → its id.
      add(name) {
        if (glaze.has(name)) return glaze.get(name);
        const i = GLAZE_TOKENS.indexOf(name);
        if (i < 0 || specials.has(name) || vocab.has(name)) fail(`special name ${JSON.stringify(name)}`);
        if (i >= reserved.length) fail(`no reserved row for ${name}: the model has ${reserved.length}`);
        const id = reserved[i];
        glaze.set(name, id); glazeName.set(id, name); kinds[id] = T.control;
        return id;
      },
      // Each id's bytes, a copy to keep (it is made afresh each call); null for added, unused and Glaze's tokens, which are
      // never text.
      byteStrings: () => baseBytes().map((b) => b && b.slice()),
      // Control tokens (and Glaze's) are left out unless specials: true; user-defined added tokens are their text (HF's rule).
      decode(ids, { specials: sp = false } = {}) {
        const parts = [];
        let n = 0;
        for (const id of ids) { const b = idBytes(id, sp); if (b.length) { parts.push(b); n += b.length; } }
        const all = new Uint8Array(n);
        let o = 0;
        for (const b of parts) { all.set(b, o); o += b.length; }
        return new TextDecoder('utf-8', { ignoreBOM: true }).decode(all);
      },
      // push(id) → the text that is complete so far; end() → the rest (an unfinished character as U+FFFD).
      decoder({ specials: sp = false } = {}) {
        const td = new TextDecoder('utf-8', { ignoreBOM: true });
        return { push: (id) => td.decode(idBytes(id, sp), { stream: true }), end: () => td.decode() };
      },
      // The pre-tokenizer's pieces (for tests and the check).
      split(text) { const out = []; pieces(well(String(text)), (p) => out.push(p)); return out; },
    };
  };

  // A tokenizer.json (HF tokenizers). opts: { bos, eos, pad } as token text or ids (tokenizer_config.json has them), rows,
  // and load()'s cache.
  const fromHF = (json, opts = {}) => {
    const m = json && json.model;
    if (!m || m.type !== 'BPE') fail('model: only BPE');
    if (m.byte_fallback) fail('byte_fallback');
    if (m.dropout) fail('dropout');
    if (m.unk_token != null) fail('unk_token');
    if (m.continuing_subword_prefix || m.end_of_word_suffix) fail('subword prefix or suffix');
    if (json.normalizer != null) fail('normalizer');
    if (json.truncation != null) fail('truncation');
    if (json.padding != null) fail('padding');
    const pt = json.pre_tokenizer, seq = pt && pt.type === 'Sequence' ? pt.pretokenizers : null;
    const split = seq && seq.length === 2 && seq[0].type === 'Split' && seq[0].behavior === 'Isolated' && !seq[0].invert && seq[0].pattern ? seq[0].pattern.Regex : null;
    const bl = seq && seq[1] && seq[1].type === 'ByteLevel' && !seq[1].add_prefix_space && seq[1].use_regex === false;
    const pre = Object.keys(PRE).find((k) => PRE[k].hf === split);
    if (!pre || !bl) fail('pre_tokenizer');
    if (!json.decoder || json.decoder.type !== 'ByteLevel') fail('decoder');
    if (json.post_processor != null && json.post_processor.type !== 'ByteLevel') fail('post_processor');
    const tokens = [], types = [];
    for (const [t, id] of Object.entries(m.vocab)) { tokens[id] = t; types[id] = T.normal; }
    for (const a of json.added_tokens || []) {
      if (a.lstrip || a.rstrip || a.single_word) fail(`added token ${JSON.stringify(a.content)}: lstrip, rstrip or single_word`);
      if (types[a.id] !== undefined) fail(`added token ${JSON.stringify(a.content)} is in the vocabulary`);
      tokens[a.id] = a.content; types[a.id] = a.special ? T.control : T.user;
    }
    for (let i = 0; i < tokens.length; i++) if (types[i] === undefined) { tokens[i] = ''; types[i] = T.unused; }
    const find = (x) => { if (x == null) return null; if (Number.isInteger(x)) return x; const i = tokens.indexOf(x); if (i < 0) fail(`no token ${JSON.stringify(x)}`); return i; };
    // A tokenizer.json doesn't say how many rows the model has (its config's vocab_size does): opts.rows.
    return load({ tokens, types, merges: m.merges, pre, rows: opts.rows, ignoreMerges: !!m.ignore_merges, bos: find(opts.bos), eos: find(opts.eos), pad: find(opts.pad), addBos: false }, opts);
  };

  // A GGUF's tokenizer keys (tokenizer.ggml.*, values as the GGUF reader gives them), or the neutral object load() takes.
  const fromGGUF = (kv, opts) => {
    if (!kv || !('tokenizer.ggml.tokens' in kv)) return load(kv, opts);
    const g = (k) => kv[`tokenizer.ggml.${k}`];
    if (g('model') !== 'gpt2') fail(`model ${JSON.stringify(g('model'))}: only gpt2 (byte-level BPE)`);
    if (!PRE[g('pre')]) fail(`pre-tokenizer ${JSON.stringify(g('pre'))}`);
    const id = (k) => (g(k) == null ? null : Number(g(k)));
    return load({ tokens: g('tokens'), types: g('token_type'), merges: g('merges'), pre: g('pre'), bos: id('bos_token_id'), eos: id('eos_token_id'), pad: id('padding_token_id'), addBos: !!g('add_bos_token') }, opts);
  };

  return { load, fromHF, fromGGUF, PRE, TYPES: T, GLAZE_TOKENS };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_TOKENIZER; else GZ_AI_TOKENIZER;
