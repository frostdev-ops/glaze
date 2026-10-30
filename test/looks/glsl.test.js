// lib/glsl.js: the custom-shader checker and wrapper. Pure JS; the half that needs a
// WebGL2 context (compile, the loop rules ANGLE enforces) is exercised by scripts/scene-check.mjs in a headless browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../lib/glsl.js');
const I = require('../lib/i18n.js');

const shader = (name) => fs.readFileSync(path.join(__dirname, '../assets/shaders', `${name}.glsl`), 'utf8');
const EXAMPLES = ['aurora', 'starfield', 'liquid'];
const MIN = 'vec4 scene(vec2 uv) { return vec4(uv, 0., 1.); }';
const ok = (name, src) => assert.deepEqual(G.check(src).errors, [], `${name} should pass`);
const bad = (name, src, re) => {
  const r = G.check(src);
  assert.equal(r.ok, false, `${name} should fail`);
  assert.ok(r.errors.some((x) => re.test(I.t(x.message, x.vars))), `${name}: expected ${re}, got ${JSON.stringify(r.errors)}`);
  return r.errors;
};
// A scene() with three nested loops of the given passes; its cost is a * b * c plus the two statements around them.
const nest = (a, b, c) => `vec4 scene(vec2 uv) { float s = uv.x; for (int i = 0; i < ${a}; i++) for (int j = 0; j < ${b}; j++) for (int k = 0; k < ${c}; k++) s += sin(s) * .001; return vec4(s); }`;
const loop = (head, body = 's += .1;') => `vec4 scene(vec2 uv) { float s = 0.; for ${head} { ${body} } return vec4(s); }`;

test('preprocessing cannot conceal macros or change the cost checker\'s meaning', () => {
  const cases = [
    '/* before */ #define F(x) x+x+x+x\n/* before */ #define H(x) F(F(F(F(x))))\nvec4 scene(vec2 uv) { return vec4(H(uv.x)); }',
    '/* before */ #define A0 sin(s)\n' + Array.from({ length: 4 }, (_, i) => `/* before */ #define A${i + 1} (A${i}+A${i}+A${i}+A${i})`).join('\n') + '\n' + loop('(int i = 0; i < 64; i++)', 's += A4;'),
    '#define N 100000\n' + loop('(int i = 0; i < N; i++)') + '\n#if 0\n#undef N\n#define N 1\n#endif',
    '// /*\n#define N 100000\n// */\n' + loop('(int i = 0; i < N; i++)'),
    'const int N = 100000; float f() { const int N = 1; return 1.; }\n' + loop('(int i = 0; i < N; i++)'),
    '#define scene renamed\n' + nest(256, 256, 256),
    '#define N 100000\r' + loop('(int i = 0; i < N; i++)') + '\r#undef N\r#define N 1',
    '#/**/if 0\n' + MIN + '\n#/**/endif\n' + nest(256, 256, 256),
  ];
  for (const src of cases) assert.equal(G.check(src).ok, false, src);
});

test('the first frame rejects 16k statements and counts built-in work inside one statement', () => {
  assert.equal(G.check(nest(16, 32, 32)).ok, false);
  const expr = Array(100).fill('sin(uv.x + s)').join('+');
  assert.equal(G.check(loop('(int i = 0; i < 256; i++)', `s += ${expr};`)).ok, false);
  assert.equal(G.check(loop('(int i = 0; i < 256; i++)', `if (${expr} > .1) s += .1;`)).ok, false);
});

test('integer wraparound cannot turn a short counted loop into an endless one', () => {
  for (const head of ['(int i = 2147483647; i <= 2147483647; i++)', '(int i = -2147483647; i >= -2147483647; i -= 2)']) {
    assert.equal(G.check(loop(head)).ok, false, head);
  }
});

test('the three example shaders pass, cheaply', () => {
  for (const f of EXAMPLES) {
    const src = shader(f);
    ok(f, src);
    assert.ok(G.estimate(src) < G.COST_LIMIT, `${f}: ${G.estimate(src)}`);
    assert.equal(G.check(src).ok, true);
  }
});

test('check takes any value and answers { ok, errors: [{ line, message }] }', () => {
  assert.deepEqual(G.check(MIN), { ok: true, errors: [] });
  for (const v of [undefined, null, 5, {}, [], true]) assert.deepEqual(G.check(v), { ok: false, errors: [{ line: 0, message: 'The shader is not text.' }] });
  assert.equal(G.check('').ok, false);
  const r = G.check(`uniform float k;\n${MIN}`);
  assert.deepEqual(Object.keys(r.errors[0]).sort(), ['line', 'message', 'vars']);
  assert.equal(typeof r.errors[0].line, 'number');
  ok('crlf', MIN.replace(/ /g, '\r\n'));
});

test('the size limit is 8 KiB, in characters (which are bytes: ASCII only)', () => {
  assert.equal(G.MAX, 8192);
  ok('at the limit', MIN + '\n//' + 'x'.repeat(8192 - MIN.length - 3));
  bad('over the limit', MIN + '\n//' + 'x'.repeat(8192 - MIN.length - 2), /limit/);
  const t = Date.now();
  assert.equal(bad('five megabytes', `${MIN}\n#extension x\n${'a b\n'.repeat(1.25e6)}`, /limit/).length, 1, 'only the size is said, and nothing reads the rest');
  assert.ok(Date.now() - t < 500, `${Date.now() - t} ms`);
});

test('refused before any GL: #extension, #version, #pragma, #line and other directives', () => {
  bad('extension', `#extension GL_OES_standard_derivatives : enable\n${MIN}`, /#extension/);
  bad('extension, spaced', `# extension GL_FOO : enable\n${MIN}`, /#extension/);
  bad('extension in a comment (strict on purpose)', `// #extension x\n${MIN}`, /#extension/);
  bad('version', `#version 300 es\n${MIN}`, /#version/);
  bad('pragma', `#pragma optimize(off)\n${MIN}`, /#pragma/);
  bad('line', `#line 5\n${MIN}`, /#line/);
  bad('error', `#error no\n${MIN}`, /#error/);
  bad('include', `#include "x"\n${MIN}`, /#include/);
  bad('unknown directive', `#foo\n${MIN}`, /#foo is not allowed/);
  ok('a hash that is not a directive', `// issue #3, see # 4\n${MIN}`);
  bad('the conditionals', `#define A 1\n#ifdef A\n#else\n#endif\n#ifndef B\n#endif\n#if A\n#elif 0\n#endif\n#undef A\n${MIN}`, /only unconditional/);
});

test('refused: non-ASCII, NUL, backslashes', () => {
  bad('non-ascii', `// café\n${MIN}`, /ASCII/);
  bad('nul', `${MIN}\u0000`, /ASCII/);
  bad('a control character', `${MIN}\u0007`, /ASCII/);
  bad('backslash', `#define A 1 \\\n+ 2\n${MIN}`, /Backslash/);
  ok('tabs', `\t${MIN}`);
});

test('refused: author uniform, attribute, varying, main, gl_*, double underscores; the names Glaze provides', () => {
  bad('uniform', `uniform float k;\n${MIN}`, /uniform/);
  bad('attribute', `attribute float k;\n${MIN}`, /attribute/);
  bad('varying', `varying vec2 k;\n${MIN}`, /varying/);
  bad('main', `${MIN}\nvoid main() {}`, /main/);
  bad('gl_FragColor', 'vec4 scene(vec2 uv) { gl_FragColor = vec4(1.); return vec4(0.); }', /gl_FragColor/);
  bad('gl_Position', 'vec4 scene(vec2 uv) { gl_Position = vec4(1.); return vec4(0.); }', /gl_Position/);
  ok('gl_FragCoord is fine', 'vec4 scene(vec2 uv) { return vec4(gl_FragCoord.xy / 1000., 0., 1.); }');
  bad('a double underscore', 'vec4 scene(vec2 uv) { float a__b = 1.; return vec4(a__b); }', /double underscore/);
  for (const name of G.RESERVED.filter((n) => /^[a-z]/.test(n) && !/^u|^vUv/.test(n))) bad(`redefine ${name}`, `float ${name}(vec2 p) { return 0.; }\n${MIN}`, new RegExp(`\`${name}\``));
  for (const name of G.RESERVED.filter((n) => /^u[A-Z]|^vUv/.test(n))) bad(`redeclare ${name}`, `float ${name} = 1.;\n${MIN}`, new RegExp(`\`${name}\``));
  ok('the provided names, used', 'vec4 scene(vec2 uv) { return vec4(vec3(fbm(uv * uAspect) + hash(uv) + noise(uv) + amt(uTime) + px() + uPx + uAmount), 1.) + vec4(uGround + uC1 + uC2 + uC3, 0.) + vec4(rot(1.) * uv, vUv); }');
  ok('a parameter may shadow', 'float f(float px) { return px; }\nvec4 scene(vec2 uv) { return vec4(f(1.)); }');
  ok('words in comments and inside longer names', '// the main idea, uniform look, varying speed\n/* gl_FragColor is not used */\nvec4 scene(vec2 uv) { float domain = 1., uniformity = 2.; return vec4(domain + uniformity); }');
});

test('the entry point is vec4 scene(vec2 uv)', () => {
  bad('missing', 'float f() { return 1.; }', /entry point/);
  bad('wrong argument', 'vec4 scene(vec3 uv) { return vec4(1.); }', /entry point/);
  bad('wrong return', 'vec3 scene(vec2 uv) { return vec3(1.); }', /entry point/);
  ok('named however', 'vec4 scene(vec2 p) { return vec4(p, 0., 1.); }');
  ok('with in', 'vec4 scene(in vec2 p) { return vec4(p, 0., 1.); }');
});

test('#define: object-like constants only, short, few, none built from another', () => {
  bad('function-like', `#define SQ(x) ((x)*(x))\n${MIN}`, /function-like/);
  bad('chained', `#define A0 1.\n#define A1 (A0+A0+A0+A0)\n${MIN}`, /another macro/);
  bad('long body', `#define K ${'1.+'.repeat(30)}0.\n${MIN}`, /64 characters/);
  bad('too many', Array.from({ length: 33 }, (_, i) => `#define D${i} ${i}.`).join('\n') + `\n${MIN}`, /At most 32/);
  ok('32 is fine', Array.from({ length: 32 }, (_, i) => `#define D${i} ${i}.`).join('\n') + `\n${MIN}`);
  ok('plain constants', `#define PI 3.14159\n#define N 6\n#define TAU 6.28318\n${MIN}`);
});

test('loops: the end must be a whole number, a #define or a const int, and at most 256 passes', () => {
  bad('100000 passes', loop('(int i = 0; i < 100000; i++)'), /100,000 passes/);
  bad('257 passes', loop('(int i = 0; i < 257; i++)'), /257 passes/);
  ok('256 passes', loop('(int i = 0; i < 256; i++)'));
  ok('<=', loop('(int i = 0; i <= 8; i++)'));
  ok('counting down', loop('(int i = 8; i > 0; i--)'));
  ok('counting down to zero', loop('(int i = 8; i >= 0; i--)'));
  ok('a step of 2', loop('(int i = 0; i < 16; i += 2)'));
  ok('from a negative start', loop('(int i = -2; i <= 2; i++)'));
  ok('a #define', `#define N 6\n${loop('(int i = 0; i < N; i++)')}`);
  ok('a const int', `const int N = 6;\n${loop('(int i = 0; i < N; i++)')}`);
  ok('a const int from another', `const int N = 6;\nconst int M = N;\n${loop('(int i = 0; i < M; i++)')}`);
  bad('a #define over the limit', `#define N 1000\n${loop('(int i = 0; i < N; i++)')}`, /1,000 passes/);
  bad('a const over the limit', `const int N = 1000;\n${loop('(int i = 0; i < N; i++)')}`, /1,000 passes/);
  bad('a reversed loop over the limit', loop('(int i = 100000; i > 0; i--)'), /100,000 passes/);
  // Bounds the checker can't read are refused, not guessed: each of these is accepted by ANGLE as a constant expression.
  for (const [name, head] of [
    ['int(1e5)', '(int i = 0; i < int(1e5); i++)'], ['a sum', '(int i = 0; i < 100000 + 0; i++)'], ['a product', '(int i = 0; i < 1000 * 1000; i++)'],
    ['a parenthesised bound', '(int i = 0; i < (8); i++)'], ['reversed operands', '(int i = 0; 8 > i; i++)'], ['!=', '(int i = 0; i != 8; i++)'],
    ['==', '(int i = 0; i == 0; i++)'], ['a start that is an expression', '(int i = 1 + 1; i < 8; i++)'], ['a missing part', '(int i = 0; i < 8)'], ['an empty header', '()'],
  ]) bad(name, loop(head), /Can't tell how many times/);
  bad('a const made of consts', `const int K = 1000;\nconst int K2 = K * K;\n${loop('(int i = 0; i < K2; i++)')}`, /Can't tell/);
  bad('a bound from a variable', 'vec4 scene(vec2 uv) { int n = 4; float s = 0.; for (int i = 0; i < n; i++) s += .1; return vec4(s); }', /Can't tell/);
  // Steps that never get there: ANGLE accepts these and the loop would run for billions of passes (or forever).
  bad('counting up with i--', loop('(int i = 0; i < 4; i--)'), /never reaches/);
  bad('counting down with i++', loop('(int i = 8; i > 0; i++)'), /never reaches/);
  bad('a step of zero', loop('(int i = 0; i < 4; i += 0)'), /Can't tell/);
  bad('a negative step', loop('(int i = 8; i > 0; i += -1)'), /Can't tell/);
  bad('an odd step', loop('(int i = 0; i < 4; i *= 2)'), /Can't tell/);
  assert.equal(bad('the line of the loop', `// a\n// b\n${loop('(int i = 0; i < 100000; i++)')}`, /100,000 passes/)[0].line, 3);
});

test('cost: nested loops multiply, helpers and built-in operations count, 4,096 per pixel is the limit', () => {
  assert.equal(G.COST_LIMIT, 4096);
  assert.equal(G.estimate(nest(16, 16, 16)), 16 * 16 * 16 * 4 + 2);
  bad('nested 64^3', nest(64, 64, 64), /Too heavy/);
  bad('nested 256^3', nest(256, 256, 256), /Too heavy/);
  ok('nested 8^3', nest(8, 8, 8));
  assert.equal(G.estimate('float g(float x) { for (int i = 0; i < 200; i++) x += sin(x); return x; }\nvec4 scene(vec2 uv) { float s = uv.x; for (int j = 0; j < 200; j++) s = g(s); return vec4(s); }'),
    1 + 200 * (1 + (600 + 1)) + 1, 'built-in sin and += are counted inside the callee');
  assert.equal(G.estimate('#define N 6\nconst int M = 3;\nvec4 scene(vec2 uv) { float s = 0.; for (int i = 0; i < N; i++) { for (int j = 0; j < M; j++) s += 1.; } return vec4(s); }'), 1 + 6 * 3 * 2 + 1);
  assert.equal(G.estimate(nest(0, 5000, 5000)), 2, 'a loop that never runs costs nothing');
  ok('just under', `vec4 scene(vec2 uv) { float s = 0.; for (int i = 0; i < 256; i++) for (int j = 0; j < 7; j++) s += uv.x; return vec4(s); }`);
  bad('just over', `vec4 scene(vec2 uv) { float s = 0.; for (int i = 0; i < 256; i++) for (int j = 0; j < 256; j++) for (int k = 0; k < 4; k++) s += uv.x; return vec4(s); }`, /Too heavy.*operations per pixel/);
  // The ways to hide the cost from a reader that only looks at the loops it can see.
  const heavy = 'float heavy(float x) { for (int j = 0; j < 256; j++) for (int k = 0; k < 256; k++) x += sin(x); return x; }';
  bad('a callee declared before it is defined', `float heavy(float x);\nvec4 scene(vec2 uv) { float s = uv.x; for (int i = 0; i < 256; i++) s = heavy(s); return vec4(s); }\n${heavy}`, /Too heavy/);
  bad('a call in an if condition', `${heavy}\nvec4 scene(vec2 uv) { float s = uv.x; for (int i = 0; i < 256; i++) if (heavy(s) > 0.) s += 1.; return vec4(s); }`, /Too heavy/);
  bad('a call through a #define', `#define H heavy(s)\n${heavy}\nvec4 scene(vec2 uv) { float s = uv.x; for (int i = 0; i < 256; i++) s = H; return vec4(s); }`, /Too heavy/);
  bad('a loop bound through a #define', '#define N 100000\nvec4 scene(vec2 uv) { float s = 0.; for (int i = 0; i < N; i++) for (int j = 0; j < 256; j++) s += 1.; return vec4(s); }', /passes/);
  bad('an overloaded function, the dearer one', `float h(float x) { return x; }\n${heavy.replace('heavy', 'h').replace('float x)', 'vec2 x)').replace('x += sin(x)', 'x.x += sin(x.x)').replace('return x', 'return x.x')}\nvec4 scene(vec2 uv) { float s = uv.x; for (int i = 0; i < 256; i++) s = h(uv); return vec4(s); }`, /Too heavy/);
  bad('a struct declared inside a loop does not unbalance the count', 'vec4 scene(vec2 uv) { float s = 0.; for (int i = 0; i < 256; i++) { struct A { float a; }; for (int j = 0; j < 256; j++) for (int k = 0; k < 256; k++) s += 1.; } return vec4(s); }', /Too heavy/);
  bad('recursion', 'float f(float x) { return x > 0. ? f(x - 1.) : 0.; }\nvec4 scene(vec2 uv) { return vec4(f(3.)); }', /calls itself/);
  bad('recursion in a loop that never runs', 'float f(float x) { return f(x); }\nvec4 scene(vec2 uv) { float s = 0.; for (int i = 0; i < 0; i++) s += f(s); return vec4(s); }', /calls itself/);
  ok('a plain helper chain', 'float a(float x) { return x * 2.; }\nfloat b(float x) { return a(x) + a(x + 1.); }\nvec4 scene(vec2 uv) { return vec4(b(uv.x)); }');
});

test('the checker stays fast on hostile 8 KiB inputs, and never throws', () => {
  const cases = {
    spaces: ' '.repeat(8192), semis: ';'.repeat(8192), braces: '{;'.repeat(4096), open_braces: '{'.repeat(8192), floats: 'float '.repeat(1365),
    comment_open: '/*'.repeat(4096), hashes: '# '.repeat(4096), for_open: 'for (int i = 0; i < 1; i++;'.repeat(300), parens: '('.repeat(8000),
    scene_sig: 'vec4 scene( vec2 ' + ' '.repeat(8000) + ')', defines: '#define A 1\n'.repeat(700), uniform_words: 'uniform '.repeat(1000),
    calls: 'float a(float x) { return a(x); }\n'.repeat(200) + MIN, protos: 'float f(float x); '.repeat(450) + MIN,
    typed_calls: 'a b(a b(a b(a b('.repeat(500) + MIN, deep_blocks: `vec4 scene(vec2 uv) ${'{'.repeat(3000)}${'}'.repeat(3000)}`,
  };
  for (const [name, src] of Object.entries(cases)) {
    const t = process.hrtime.bigint();
    let r;
    assert.doesNotThrow(() => { r = G.check(src); }, name);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.equal(typeof r.ok, 'boolean', name);
    assert.ok(ms < 1000, `${name}: ${ms} ms`);
  }
});

test('blank lines at the shader size boundary do not repeatedly rescan the file', () => {
  const src = '\n'.repeat(G.MAX - MIN.length) + MIN;
  const start = performance.now();
  assert.equal(G.check(src).ok, true);
  assert.ok(performance.now() - start < 400, 'an 8 KiB shader must not stall the editor');
  bad('indented declaration', `    float uTime = 1.;\n${MIN}`, /already provided/);
});

test('wrap: the shared prelude, then #line 1 and the author\'s source, then main', () => {
  const w = G.wrap(MIN);
  assert.ok(w.startsWith(G.PRELUDE));
  assert.ok(w.includes(`\n#line 1\n${MIN}\nvoid main()`));
  assert.ok(!/#version/.test(w), 'three adds #version 100; a second one would not compile');
  assert.equal(w.split('\n').length, G.PRELUDE.split('\n').length + 1 + MIN.split('\n').length + 1, 'the author\'s source sits on the lines after #line 1');
  assert.ok(w.endsWith('/ 255., 1.); }'), 'the dither, composited over the ground');
  // A last line that is a comment can't swallow main().
  assert.ok(G.wrap(`${MIN}\n// done`).includes('// done\nvoid main()'));
  assert.deepEqual(Object.keys(G).sort(), ['COST_LIMIT', 'MAX', 'MAX_LOOP', 'PRELUDE', 'RESERVED', 'VERT', 'check', 'compile', 'estimate', 'parseLog', 'wrap']);
});

test('the prelude\'s helpers are the built-in scenes\' own, word for word', () => {
  const scene = fs.readFileSync(path.join(__dirname, '../lib/scene.js'), 'utf8').replace(/\s+/g, '');
  const lines = G.PRELUDE.split('\n').filter((l) => /^(float|mat2) (hash|noise|fbm|amt|rot)\(/.test(l));
  assert.equal(lines.length, 5);
  for (const l of lines) assert.ok(scene.includes(l.replace(/\s+/g, '')), `lib/scene.js has no ${l.slice(0, 30)}…`);
});

test('compiler messages come back with the author\'s lines', () => {
  assert.deepEqual(G.parseLog("ERROR: 0:5: 'i' : Loop index cannot be compared with non-constant expression\n", 20), [{ line: 5, message: "'i' : Loop index cannot be compared with non-constant expression" }]);
  const wrapper = G.parseLog("ERROR: 0:25: 'scene' : no matching overloaded function found\n", 20);
  assert.equal(wrapper[0].line, 0);
  assert.match(wrapper[0].message, /in Glaze's wrapper/);
  assert.deepEqual(G.parseLog("WARNING: 0:2: 'x' : y\n", 20), []);
  assert.equal(G.parseLog('ERROR: Recursive function call in the following call chain: f\n', 20)[0].line, 0);
  assert.deepEqual(G.parseLog('', 3), []);
  assert.deepEqual(G.parseLog('something else entirely', 3), [], 'only ERROR lines count; the caller says something when there are none');
  assert.deepEqual(G.parseLog("ERROR: 0:?: 'x' : y", 3), [{ line: 0, message: "'x' : y" }]);
});

test('compile: the editor\'s check against a context, refusing before it touches one', () => {
  const calls = [];
  const gl = new Proxy({}, { get: (_, k) => (...a) => { calls.push(k); return k === 'getShaderParameter' ? true : k === 'getProgramParameter' ? true : k === 'getShaderInfoLog' ? '' : {}; } });
  assert.deepEqual(G.compile(gl, `uniform float k;\n${MIN}`).stage, 'check');
  assert.deepEqual(calls, [], 'a refused shader never reaches GL');
  const fine = G.compile(gl, MIN);
  assert.deepEqual(fine, { ok: true, errors: [] });
  assert.ok(calls.includes('shaderSource') && calls.includes('linkProgram') && calls.includes('deleteShader'));
  const sources = []; const bg = Object.assign(Object.create(null), { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader: (t) => t, shaderSource: (t, s) => sources.push(s), compileShader() {}, getShaderParameter: (t) => t === 2 ? false : true,
    getShaderInfoLog: () => "ERROR: 0:3: 'i' : Loop index cannot be compared with non-constant expression", deleteShader() {} });
  const r = G.compile(bg, `// a\n// b\n${loop('(int i = 0; i < 8; i++)')}`);
  assert.equal(r.ok, false); assert.equal(r.stage, 'compile'); assert.equal(r.errors[0].line, 3);
  assert.ok(sources.every((s) => s.startsWith('#version 100\n')), 'ESSL 1.00 explicitly: that is what makes ANGLE enforce the WebGL 1 loop rules');
});

test('compile rejects a failed link even when the driver supplies no error log', () => {
  const gl = new Proxy({}, { get: (_, k) => () => k === 'getShaderParameter' ? true : k === 'getProgramParameter' ? false : k === 'getShaderInfoLog' || k === 'getProgramInfoLog' ? '' : {} });
  const r = G.compile(gl, MIN);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'compile');
  assert.match(r.errors[0].message, /driver rejected/);
});
