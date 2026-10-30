// Glaze — custom shader backgrounds (x.bg.shader): the checker and the wrapper.
// The author writes helpers plus ONE entry point, in GLSL ES 1.00:
//     vec4 scene(vec2 uv)    // uv 0..1, y up, as the built-in scenes' vUv; rgb is colour, a is coverage over the ground
// wrap() puts the shared uniforms, helpers and `#line 1` in front and the dither and main() behind, so compiler errors carry
// the author's own line numbers. check() refuses what the compiler would accept but a background must not do, before any GL
// exists: it runs in the editor, in the sanitizer for theme codes and again in lib/scene.js. Pure functions, no DOM, so node
// tests it; compile() is the only part that wants a WebGL2 context. Classic script, loaded on demand (content.js need()).
//
// Why each refusal: it is there because Chrome's ANGLE accepts the thing (checked on 151, spike S2), not as a style rule.
var GZ_GLSL = globalThis.GZ_GLSL || (() => {
  const MAX = 8192; // characters, and ASCII only, so also bytes
  const MAX_LOOP = 256; // passes of one for loop
  const COST_LIMIT = 4096; // operations per pixel, including built-ins and arithmetic; see estimate()
  // What the author may rely on: the uniforms every built-in scene reads and the helpers they share (lib/scene.js COMMON and
  // FLAT, the same text), plus px(). One string, so its line count is fixed.
  const PRELUDE = [
    'precision highp float;',
    'uniform float uTime, uAspect, uPx, uAmount;',
    'uniform vec3 uGround, uC1, uC2, uC3;',
    'varying vec2 vUv;',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }',
    'float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= .5; } return v; }',
    'float amt(float w) { return clamp(w * (.55 + .9 * uAmount), 0., 1.); }',
    'mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }',
    // ESSL 1.00 under WebGL2 has no fwidth(), so edges are smoothed with this: one drawing-buffer pixel in uv-y units.
    'float px() { return 1. / (uPx * 1000.); }',
  ].join('\n');
  const RESERVED = ['hash', 'noise', 'fbm', 'amt', 'rot', 'px', 'uTime', 'uAspect', 'uPx', 'uAmount', 'uGround', 'uC1', 'uC2', 'uC3', 'vUv'];
  const EPILOGUE = '\nvoid main() { vec4 c = scene(vUv); gl_FragColor = vec4(mix(uGround, c.rgb, clamp(c.a, 0., 1.)) + (hash(gl_FragCoord.xy) - .5) / 255., 1.); }';
  // The vertex shader is fixed. A raw material declares its own attributes.
  const VERT = 'attribute vec3 position; attribute vec2 uv; varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

  // The full fragment source. No `#version`: ESSL 1.00 is what a source without one means, and three adds `#version 100`
  // itself for glslVersion '100' (a second one is a compile error). The wrapper's own lines land after the author's last.
  const wrap = (src) => `${PRELUDE}\n#line 1\n${src}${EPILOGUE}`;

  const blank = (c) => c.replace(/[^\n]/g, ' ');
  const bare = (src) => src.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, blank); // lexical order matters: // /* is just a line comment
  const isId = (k) => /^[A-Za-z_]\w*$/.test(k || '');

  // ---- cost -------------------------------------------------------------------------------------------------------
  // Statements executed per pixel by scene(): a for loop multiplies its body by its passes, a call adds the callee's cost,
  // fbm() and noise() included. The compiler accepts any constant loop (three nested 256s compile in 0.5 ms) and a small
  // probe frame cannot protect a GPU from one, because a tiny frame is latency-bound; in the spike one such shader blocked a
  // renderer for minutes. So this is the only guard on the very first frame. A safety limit, not a cost model.
  // Software GL can block the submitting thread before a fence exists. Keep this below even the 16k-statement shader that
  // took seconds to step down; count built-ins and arithmetic inside a statement too. This is a bound, not a GPU sandbox.
  // A loop has to be countable: `for (int i = A; i < B; i++)` (or <=, >, >=, i--, i += n, i -= n) with A and B whole numbers,
  // a #define of one or a const int of one. Anything else is refused rather than guessed at: a bound the checker cannot read
  // (`int(1e5)`, a const made of other consts) or a step that never reaches it is how a loop would run for minutes.
  const tokens = (text) => {
    const T = [], L = [];
    let line = 1;
    for (const m of text.matchAll(/\n|[A-Za-z_]\w*|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\S/g)) {
      if (m[0] === '\n') line++; else { T.push(m[0]); L.push(line); }
    }
    return [T, L];
  };
  const analyze = (src) => {
    const errors = [];
    const code = bare(src);
    // Object-like #defines are expanded where used (check() allows no others), so a macro can't hide a call or a bound.
    const macros = new Map();
    for (const m of code.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)(?![\w(])[ \t]*(.*?)[ \t]*$/gm)) macros.set(m[1], m[2]);
    const author = code.replace(/^[ \t]*#.*$/gm, ' ').replace(/[A-Za-z_]\w*/g, (w) => (macros.has(w) ? macros.get(w) : w));
    const consts = new Map();
    const num = (k) => (/^\d+$/.test(k) ? +k : consts.get(k));
    for (const m of author.matchAll(/\bconst\s+int\s+([A-Za-z_]\w*)\s*=\s*(\d+|[A-Za-z_]\w*)\s*;/g)) {
      if (consts.has(m[1])) errors.push({ line: author.slice(0, m.index).split('\n').length, message: 'Use a unique name for const int {name} so loop bounds are unambiguous.', vars: { name: m[1] } });
      const v = num(m[2]); if (v !== undefined) consts.set(m[1], v);
    }
    const [P, PL] = tokens(PRELUDE);
    const [A, AL] = tokens(author);
    const T = [...P, ...A], L = [...PL.map(() => 0), ...AL];

    const fns = new Map(); // name -> [[from, to)] token ranges of its bodies (overloads: the dearest counts)
    const close = (i, open, shut) => { let d = 0; do { if (T[i] === open) d++; else if (T[i] === shut) d--; i++; } while (d > 0 && i < T.length); return i; };
    for (let i = 1, d = 0; i < T.length; i++) {
      if (T[i] === '{') d++; else if (T[i] === '}') d--;
      else if (d === 0 && T[i + 1] === '(' && isId(T[i]) && isId(T[i - 1])) {
        const j = close(i + 1, '(', ')');
        if (T[j] === '{') { const k = close(j, '{', '}'); fns.set(T[i], [...(fns.get(T[i]) || []), [j + 1, k - 1]]); i = k - 1; }
      }
    }

    const memo = new Map(), open = new Set();
    const cost = (name) => {
      if (memo.has(name)) return memo.get(name);
      if (open.has(name)) return Infinity; // recursion: the compiler refuses it, and this is not a number
      open.add(name);
      const c = Math.max(0, ...fns.get(name).map(([a, b]) => run(a, b)));
      open.delete(name);
      memo.set(name, c);
      return c;
    };
    // The passes of one loop, from its tokens `( int i = A ; i < B ; i++ )`; 1 and an error when it can't be read.
    const passes = (h, line) => {
      const bad = (message, vars) => { errors.push({ line, message, ...(vars && { vars }) }); return 1; };
      const parts = [[]];
      for (const k of h.slice(1, -1)) k === ';' ? parts.push([]) : parts.at(-1).push(k);
      const [init, cond, step] = parts;
      const val = (ks) => { const neg = ks[0] === '-'; const v = ks.length === 1 + neg ? num(ks.at(-1)) : undefined; return v === undefined ? undefined : neg ? -v : v; };
      const eq = init?.indexOf('=');
      const name = init?.[eq - 1];
      const a = eq > 0 ? val(init.slice(eq + 1)) : undefined;
      const lt = cond?.[1] === '<', gt = cond?.[1] === '>', or = cond?.[2] === '=';
      const b = cond?.[0] === name && (lt || gt) ? val(cond.slice(or ? 3 : 2)) : undefined;
      const s = step?.join('');
      const by = s === `${name}++` || s === `++${name}` || s === `${name}--` || s === `--${name}` ? 1 : (s?.startsWith(`${name}+=`) || s?.startsWith(`${name}-=`) ? val(step.slice(3)) : undefined);
      if (a === undefined || b === undefined || !(by > 0)) return bad('Can\'t tell how many times this loop runs. Write it as `for (int i = 0; i < 8; i++)`, with whole numbers (or a #define or const int that is one) for the start and the end.');
      if (lt === (s.includes('-'))) return bad('This loop never reaches its end: count up with `<` and `i++` or `i += n`, down with `>` and `i--` or `i -= n`.');
      const n = Math.max(0, Math.ceil((lt ? b - a + or : a - b + or) / by));
      if (n > MAX_LOOP) bad('A loop of {n} passes is more than a background can afford (limit {limit}).', { n, limit: MAX_LOOP });
      // ESSL mediump integers guarantee only 16 bits, including the final increment used to exit the loop.
      else if (![a, b, by, a + (lt ? 1 : -1) * n * by].every((v) => Number.isSafeInteger(v) && Math.abs(v) <= 32767)) bad('Loop counters must stay within -32767..32767, including the final increment, to avoid integer overflow.');
      return n;
    };
    // Cost of the statements in t[from..to).
    const run = (from, to) => {
      let i = from;
      const parens = () => { const s = i; i = Math.min(close(i, '(', ')'), to); return T.slice(s, i); };
      const calls = (ks) => ks.reduce((n, k, j) => n + (isId(k) && ks[j + 1] === '(' && fns.has(k) ? cost(k) : 0), 0);
      const work = (ks) => Math.max(1, ks.filter((k, j) => /^[+*/%=-]$/.test(k) || (isId(k) && ks[j + 1] === '(' && !fns.has(k))).length) + calls(ks);
      const stmt = () => {
        const k = T[i];
        if (i >= to) return 0;
        if (k === 'for') { const at = i; i++; const h = parens(); return calls(h) + passes(h, L[at]) * stmt(); }
        if (k === '{') { i++; let sum = 0; while (i < to && T[i] !== '}') sum += stmt(); i++; return sum; }
        if (k === 'if' || k === 'while') { i++; const h = parens(); let c = stmt(); if (T[i] === 'else') { i++; c = Math.max(c, stmt()); } return work(h) + c; }
        // Anything else is one statement, up to its `;` (a struct's own braces and semicolons are inside it).
        const s = i;
        for (let p = 0; i < to; i++) {
          if (T[i] === '(' || T[i] === '{') p++; else if (T[i] === ')' || T[i] === '}') p--;
          else if (T[i] === ';' && p <= 0) { i++; break; }
        }
        return work(T.slice(s, i));
      };
      let sum = 0;
      while (i < to) sum += stmt();
      return sum;
    };
    return { errors, cost: fns.has('scene') ? cost('scene') : 0 };
  };
  const estimate = (src) => analyze(src).cost;

  // ---- check ------------------------------------------------------------------------------------------------------
  // Everything below is a refusal. Returns { ok, errors: [{ line, message, vars? }] }: line is 1-based
  // in the author's source, 0 for the whole file. At most 20 errors, in line order, so a pasted wall of junk stays readable.
  const check = (src) => {
    const errs = [];
    const e = (line, message, vars) => errs.push({ line, message, ...(vars && { vars }) });
    const done = () => ({ ok: !errs.length, errors: errs.sort((a, b) => a.line - b.line).slice(0, 20) });
    if (typeof src !== 'string') { e(0, 'The shader is not text.'); return done(); }
    if (src.length > MAX) { e(0, 'The shader is {n} characters; the limit is {limit}.', { n: src.length, limit: MAX }); return done(); } // nothing else reads a megabyte
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const code = bare(src);
    const cleanLines = code.split('\n');
    // ASCII only (tab and newline allowed). ANGLE accepts NUL and non-ASCII in comments; other drivers don't.
    lines.forEach((l, i) => {
      const m = l.match(/[^\t\x20-\x7e\r]/);
      if (m) e(i + 1, 'Only plain ASCII is allowed (found character code {code} at column {column}).', { code: String(m[0].codePointAt(0)), column: m.index + 1 });
      if (l.includes('\\')) e(i + 1, 'Backslash line continuations are not allowed.');
    });
    // Directives: a whitelist, matched on the raw text so a tricky comment can't hide one (a comment that names #extension
    // is refused too: simpler than a lexer, and strict on purpose).
    lines.forEach((l, i) => {
      for (const m of `${l}\n${cleanLines[i]}`.matchAll(/#\s*([A-Za-z_]*)/g)) {
        const d = m[1];
        if (['extension', 'version', 'pragma', 'line', 'error', 'include'].includes(d)) e(i + 1, '#{name} is not allowed: Glaze sets the GLSL version and extensions itself.', { name: d });
        else if (d && d !== 'define') e(i + 1, '#{name} is not allowed: only unconditional #define constants can be checked safely.', { name: d });
      }
    });
    // Macros: object-like constants only. ANGLE refuses nested function-like macros (out of memory) but accepts chained
    // object-like ones, which grow by a factor of four a level: 4^10 tokens compiled in 0.5 s, 4^11 in 3.0 s.
    const defs = [];
    let authorCode = false;
    cleanLines.forEach((l, i) => {
      const m = l.match(/^\s*#\s*define\s+(\w+)(\(?)\s*(.*)$/);
      if (m) {
        if (authorCode) e(i + 1, '#define constants must come before the shader code.');
        defs.push({ line: i + 1, name: m[1], fn: m[2] === '(', body: m[3] });
      } else if (l.trim()) authorCode = true;
    });
    if (defs.length > 32) e(0, 'At most 32 #define lines (found {n}).', { n: defs.length });
    for (const d of defs.length > 32 ? [] : defs) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(d.name)) e(d.line, '#define names must be uppercase constants.');
      if (defs.some((o) => o !== d && o.name === d.name)) e(d.line, '#define {name}: each constant must have a unique name.', { name: d.name });
      if (d.fn) e(d.line, '#define {name}(...): function-like macros are not allowed; write a function.', { name: d.name });
      else if (d.body.length > 64) e(d.line, '#define {name}: a macro body is at most 64 characters.', { name: d.name });
      else if (defs.some((o) => new RegExp(`\\b${o.name}\\b`).test(d.body))) e(d.line, '#define {name}: a macro may not use another macro (they multiply).', { name: d.name });
    }
    const at = (idx) => code.slice(0, idx).split('\n').length;
    // Glaze's declarations and its main().
    for (const m of code.matchAll(/\b(uniform|attribute|varying)\b/g)) e(at(m.index), '`{name}` is not allowed: Glaze provides the inputs (uTime uAspect uPx uAmount uGround uC1 uC2 uC3).', { name: m[1] });
    for (const m of code.matchAll(/\bmain\b/g)) e(at(m.index), 'Don\'t write main(): write `vec4 scene(vec2 uv)`; Glaze calls it for every pixel.');
    for (const m of code.matchAll(/\bgl_\w+/g)) if (m[0] !== 'gl_FragCoord') e(at(m.index), "{name}: write the colour as the result of scene(); other gl_ names are Glaze's or reserved.", { name: m[0] });
    for (const m of code.matchAll(/\b\w*__\w*/g)) e(at(m.index), '{name}: names containing a double underscore are reserved by GLSL.', { name: m[0] });
    for (const r of RESERVED) {
      const m = code.match(new RegExp(`(?:^|[;{}\\n])[ \\t]*(?:float|vec[234]|mat[234]|int|bool|void|const\\s+\\w+)\\s+${r}\\b`));
      if (m) e(at(m.index + 1), '`{name}` is already provided by Glaze; use it, or rename yours.', { name: r });
    }
    if (!/\bvec4\s+scene\s*\(\s*(?:in\s+)?vec2\s+\w+\s*\)\s*\{/.test(code)) e(0, 'Missing the entry point: `vec4 scene(vec2 uv) { ... }`.');
    // Loops and cost, once nothing else is wrong (the estimate reads a shader that is at least shaped right).
    if (!errs.length) {
      try {
        const a = analyze(src);
        errs.push(...a.errors);
        if (!a.errors.length && !Number.isFinite(a.cost)) e(0, 'A function calls itself; GLSL ES 1.00 has no recursion.'); // (or 0 x infinity)
        else if (!a.errors.length && a.cost > COST_LIMIT) e(0, 'Too heavy: about {n} operations per pixel (limit {limit}). Nested loops multiply.', { n: a.cost, limit: COST_LIMIT });
      } catch { e(0, 'This shader is nested too deeply to check.'); }
    }
    return done();
  };

  // ---- compiler messages ------------------------------------------------------------------------------------------
  // ANGLE's info log -> [{ line, message, vars? }] in the author's numbering (the wrapper's `#line 1` did the work). authorLines is
  // the number of lines in the author's source: an error past it is in Glaze's wrapper (a broken signature, an unclosed
  // brace or comment), reported as line 0. Warnings are dropped.
  const parseLog = (log, authorLines) => {
    const out = [];
    for (const l of String(log).split('\n')) {
      const m = l.match(/^(ERROR|WARNING): (\d+):(\d+|\?): (.*)$/);
      if (m) {
        if (m[1] !== 'ERROR') continue;
        const n = m[3] === '?' ? 0 : +m[3];
        if (n > authorLines) out.push({ line: 0, message: "{message} (in Glaze's wrapper, after your last line: check the signature `vec4 scene(vec2 uv)`)", vars: { message: m[4] } });
        else out.push({ line: n, message: m[4] });
      } else if (/^ERROR: /.test(l)) out.push({ line: 0, message: l.slice(7) });
    }
    return out;
  };

  // The compile check the editor runs while the student types: plain WebGL2 (a throwaway canvas context), no three, no
  // drawing. gl is that context. `#version 100` is explicit here, which is what makes ANGLE enforce the WebGL 1 loop rules.
  const compile = (gl, src) => {
    const pre = check(src);
    if (!pre.ok) return { ok: false, errors: pre.errors, stage: 'check' };
    const make = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s; };
    const vs = make(gl.VERTEX_SHADER, `#version 100\n${VERT}`);
    const fs = make(gl.FRAGMENT_SHADER, `#version 100\n${wrap(src)}`);
    const ok = gl.getShaderParameter(fs, gl.COMPILE_STATUS) && gl.getShaderParameter(vs, gl.COMPILE_STATUS);
    const log = gl.getShaderInfoLog(fs);
    let linked = '', linkOK = false;
    if (ok) {
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      linkOK = !!gl.getProgramParameter(p, gl.LINK_STATUS);
      if (!linkOK) linked = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (ok && linkOK) return { ok: true, errors: [] };
    const errors = parseLog(log, src.split('\n').length);
    if (linked) errors.push({ line: 0, message: 'Link: {message}', vars: { message: linked.trim() } });
    return { ok: false, errors: errors.length ? errors : [{ line: 0, message: 'The graphics driver rejected the shader.' }], stage: 'compile' };
  };

  return { MAX, MAX_LOOP, COST_LIMIT, PRELUDE, RESERVED, VERT, wrap, check, estimate, parseLog, compile };
})();

if (typeof module !== 'undefined') module.exports = GZ_GLSL; else GZ_GLSL;
