// Glaze — animated backgrounds (bg.kind "scene", "shader" and "layers"). content.js imports this module only once
// someone picks one, and only in the top frame, so three.js costs nothing otherwise.
// Cheap on purpose: drawn at a fraction of the screen's resolution and stretched by the browser
// (the softness is the look), at most 30 frames a second, and all movement is worked out in the
// shaders from one time uniform, so a frame is one uniform write and one draw. Motion off draws a
// single still frame and stops; background tabs get no animation frames at all.
// What is drawn: a built-in scene, a student's own shader (looks/glsl.js checks and wraps it),
// or up to four layers blended bottom first. All of them run under the budget guard below.
// A retry must reload a failed dependency too: the browser remembers failed module URLs.
const {
  WebGLRenderer, Scene, OrthographicCamera, PerspectiveCamera, Mesh, Points, PlaneGeometry,
  BufferGeometry, Float32BufferAttribute, ShaderMaterial, RawShaderMaterial, Color, ColorManagement,
  CustomBlending, AddEquation, OneFactor, DstColorFactor, OneMinusSrcAlphaFactor, OneMinusSrcColorFactor,
  // Through the extension's address (Firefox's linter takes a dynamic import only so, or of a literal); served on its own
  // (checks/looks/scene-check.mjs, over HTTP) there is no chrome.runtime, and three.js is the file beside it.
} = await (globalThis.chrome?.runtime?.getURL ? import(chrome.runtime.getURL(`vendor/three.js${new URL(import.meta.url).search}`)) : import('../vendor/three.js'));

// Colors pass through as written, the way CSS mixes them, so a scene matches the gradient under it.
ColorManagement.enabled = false;

const FPS = 30;
const PARALLAX = 8; // css px a scene that follows the pointer moves at most, settling in about 250 ms
// uAmount is the intensity slider, 0-1: every scene reads it as how much it may stand out.
const COMMON = `
uniform float uTime, uAspect, uPx, uAmount;
uniform vec3 uGround, uC1, uC2, uC3;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= .5; } return v; }
`;

// Full-screen scenes: one quad, all the work in the fragment shader.
const FLAT_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
const FLAT = `${COMMON}
varying vec2 vUv;
// A mix weight, scaled by intensity.
float amt(float w) { return clamp(w * (.55 + .9 * uAmount), 0., 1.); }
// A little noise below one 8-bit step, so the stretched gradients don't band.
vec3 dither(vec3 c) { return c + (hash(gl_FragCoord.xy) - .5) / 255.; }
// Distance to the nearest whole number, for drawing grid and contour lines.
float lineAt(float v) { float d = abs(fract(v + .5) - .5); return 1. - smoothstep(0., fwidth(v) * 1.2, d); }
`;
// Slow, domain-warped fog in the three colors.
const MIST = `${FLAT}
void main() {
  vec2 p = vUv * vec2(uAspect, 1.) * 1.6;
  float t = uTime * .04;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  float n = fbm(p + 2. * q + vec2(t * .5, -t * .3));
  vec3 c = mix(uGround, uC1, amt(smoothstep(.3, .85, n) * .8));
  c = mix(c, uC2, amt(smoothstep(.4, .9, q.x) * .6));
  c = mix(c, uC3, amt(smoothstep(.5, .95, q.y) * .45));
  gl_FragColor = vec4(dither(c), 1.);
}`;
// Five out-of-focus lights wandering on long, slow loops.
const ORBS = `${FLAT}
vec3 orb(vec3 c, vec3 k, float i, float r) {
  vec2 o = .5 + vec2(.42 * sin(uTime * (.031 + .007 * i) + i * 1.9), .36 * cos(uTime * (.027 + .006 * i) + i * 2.7));
  vec2 d = (vUv - o) * vec2(uAspect, 1.);
  return mix(c, k, amt(exp(-dot(d, d) / (r * r)) * .55));
}
void main() {
  vec3 c = orb(uGround, uC1, 0., .34);
  c = orb(c, uC2, 1., .3);
  c = orb(c, uC3, 2., .26);
  c = orb(c, uC1, 3., .22);
  c = orb(c, uC2, 4., .24);
  gl_FragColor = vec4(dither(c), 1.);
}`;
// Northern lights: three curtains hanging from the top, swaying, streaked with fine vertical rays,
// shading to the third color at the hem.
const BOREALIS = `${FLAT}
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime * .05;
  vec3 c = uGround;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = p.x - (.2 + .3 * fi) * uAspect - .22 * sin(p.y * 2.3 + t * (1. + fi * .3) + fi * 2.) - .3 * (fbm(vec2(p.y * 1.4 + fi * 7., t)) - .5);
    float band = exp(-x * x * 30.);
    float rays = .45 + .55 * fbm(vec2(p.x * 12. + fi * 3., t * 1.5));
    float hang = smoothstep(.12, .55, p.y) * (1. - smoothstep(.88, 1., p.y));
    vec3 k = mix(uC3, i == 1 ? uC2 : uC1, smoothstep(.25, .7, p.y));
    c = mix(c, k, amt(band * rays * hang * .7));
  }
  gl_FragColor = vec4(dither(c), 1.);
}`;
// A lava lamp: seven soft blobs rising and sinking, merging where they meet.
const LAVA = `${FLAT}
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float f = 0.;
  vec3 k = vec3(0.);
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec2 o = vec2((.15 + .7 * fract(fi * .618)) * uAspect + .1 * sin(uTime * .05 + fi * 4.), .5 + .6 * sin(uTime * (.03 + .012 * fract(fi * .37)) + fi * 2.1));
    float r = .1 + .08 * fract(fi * .73);
    vec2 d = p - o;
    float g = r * r / max(dot(d, d), 1e-4);
    f += g;
    float m = mod(fi, 3.);
    k += g * (m < .5 ? uC1 : m < 1.5 ? uC2 : uC3);
  }
  k /= f;
  float body = smoothstep(.7, 1.5, f) * .5 + smoothstep(.12, .9, f) * .25;
  gl_FragColor = vec4(dither(mix(uGround, k, amt(body))), 1.);
}`;
// A topographic map of terrain that slowly reshapes itself; every fifth contour is an index line.
const CONTOURS = `${FLAT}
void main() {
  vec2 p = vUv * vec2(uAspect, 1.) * 2.;
  float t = uTime * .012;
  float h = mix(fbm(p + vec2(t * 3., t)), fbm(p * 1.3 + vec2(4. - t, 2. + t * 2.)), .5);
  float v = h * 16.;
  float major = step(mod(floor(v + .5), 5.), .5);
  vec3 k = mix(major > .5 ? uC3 : uC1, uC2, smoothstep(.3, .7, h));
  vec3 c = mix(uGround, k, amt(.06 + .1 * h));
  c = mix(c, k, amt(lineAt(v) * (.35 + .4 * major)));
  gl_FragColor = vec4(dither(c), 1.);
}`;
// Synthwave: a striped sun over the horizon, and a grid floor gliding toward you.
const HORIZON = `${FLAT}
void main() {
  float hz = .4;
  vec3 c = uGround;
  float up = vUv.y - hz;
  if (up > 0.) {
    c = mix(c, uC2, amt(exp(-up * 7.) * .45));
    vec2 s = (vUv - vec2(.5, hz + .17)) * vec2(uAspect, 1.);
    float sun = 1. - smoothstep(.15, .155, length(s));
    float stripes = s.y > 0. ? 1. : step(.3 + s.y * -2.5, fract(s.y * 16. + uTime * .08));
    c = mix(c, mix(uC1, uC3, smoothstep(-.15, .15, s.y)), amt(sun * stripes * .7));
  } else {
    float z = .06 / -up;
    vec2 g = vec2((vUv.x - .5) * uAspect * z * 7., z * 7. + uTime * .3);
    float fade = smoothstep(0., .18, -up);
    float l = max(lineAt(g.x), lineAt(g.y)) * fade;
    c = mix(c, mix(uC3, uC1, smoothstep(0., hz, vUv.y)), amt(l * .6));
    c = mix(c, uC2, amt(exp(up * 12.) * .35));
  }
  gl_FragColor = vec4(dither(c), 1.);
}`;

// Living topography, the frostdev.io splash terrain seen from above: fbm height under a slow two-octave domain warp, cut
// into ten terraces of cut paper, a deep navy basin rising through cobalt and cyan to luminous ice. Light comes from the
// top left: each plate's cut edge is lit where it faces it, and each plate drops a soft blue shadow onto the one below
// (height sampled toward the light). The terrain rises toward the screen's edges so the reading area sits over the basin,
// misted toward the ground. A faint indigo glow drifts round every 45 s. Its time starts 24 s in, the source's own still:
// motion off shows that frame. uShift is the pointer's parallax, in screen units (looks/scene.js eases it).
const TOPOGRAPHY = `${FLAT}
uniform float uDim;
uniform vec2 uShift;
const float LV = 10.;
vec3 tier(float i) {
  vec3 c = vec3(.02, .043, .086);
  c = mix(c, vec3(.039, .102, .2), step(.5, i));
  c = mix(c, vec3(.055, .173, .353), step(1.5, i));
  c = mix(c, vec3(.078, .259, .498), step(2.5, i));
  c = mix(c, vec3(.106, .373, .682), step(3.5, i));
  c = mix(c, vec3(.118, .498, .812), step(4.5, i));
  c = mix(c, vec3(.133, .635, .878), step(5.5, i));
  c = mix(c, vec3(.298, .769, .933), step(6.5, i));
  c = mix(c, vec3(.604, .875, .965), step(7.5, i));
  return mix(c, vec3(.902, .973, .992), step(8.5, i));
}
// The source's fbm: steep falloff, so plates stay smooth and rounded.
float tfbm(vec2 p) { float v = 0., a = .55; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.02 + vec2(11.3, 7.9); a *= .45; } return v; }
float fbm2(vec2 p) { return .55 * noise(p) + .2475 * noise(p * 2.02 + vec2(11.3, 7.9)); }
// Height 0-1 at q (screen units from the centre), the warp shared by the samples of one pixel: a basin rising to the
// screen's edges, steadier in the middle, its rings bent by the same warp and a slow swirl so they sweep rather than nest.
float height(vec2 q, vec2 warp, float t) {
  float h = clamp((tfbm(q * 3. + vec2(3.1, 1.4) + warp + vec2(t * .6, -t * .25)) - .18) / .64, 0., 1.);
  vec2 d = (q - vec2(-.02, .01) + (warp - .3) * .35) * vec2(.62, 1.);
  float r = smoothstep(.04, .9, length(d + vec2(d.y, -d.x) * .25 * sin(d.x * 3. + t * 2.)));
  return clamp(h * mix(.24, .55, r) + r * .98 - .07, 0., 1.);
}
// Plate lv at fraction f of its band: its colour, a little brighter toward its lit cut edge and shaded under the next
// plate; its rim, bright where the cut faces the light (lit, 0-1); and the soft shadow of the plate above (a: that plate's
// height in tiers, sampled toward the light). fa and fw: a's and the height's change across a pixel, so no edge is
// narrower than one.
vec3 plate(float lv, float f, float lit, float a, float fa, float fw) {
  float top = step(LV - 1.5, lv); // nothing stands above the highest plate
  vec3 c = tier(lv) * (1.08 - .2 * f * (1. - top)) * (1. - .28 * (1. - top) * smoothstep(min(.75, 1. - 3. * fw), .995, f));
  c += vec3(.16, .3, .36) * (.25 + .9 * lit) * (1. - smoothstep(0., max(.08, 2. * fw), f)) * step(.5, lv);
  float k = smoothstep(-.05 - fa, .45 + fa, a - lv - 1.);
  return mix(c, c * vec3(.3, .42, .68), .62 * k);
}
void main() {
  vec2 uv = vUv + uShift;
  vec2 q = (uv - .5) * vec2(uAspect, 1.);
  float t = (uTime + 24.) * .018;
  vec2 p = q * 3. * 1.6;
  vec2 warp = .5 * vec2(fbm2(p + t), fbm2(p - t * 1.3 + 7.3));
  float h = height(q, warp, t);
  float s = clamp(h * LV, 0., LV - .001), i = floor(s), f = s - i, fw = min(fwidth(s), .5) + 1e-4;
  // Which way the slope climbs on screen; a cut faces down it, lit when that is toward the top left.
  vec2 up = vec2(dFdx(s), dFdy(s));
  float lit = clamp(dot(-up / (length(up) + 1e-5), vec2(-.707, .707)), 0., 1.);
  // (Under the top, so the highest plate casts onto the one below but never onto itself.)
  float a = min(height(q + vec2(-.009, .012), warp, t) * LV, LV - .5), b = min(height(q + vec2(-.024, .032), warp, t) * LV, LV - .5);
  float fa = fwidth(a) + 1e-4;
  // Each cut anti-aliased whole: this plate against the one below it and the one above.
  vec3 c = mix(plate(i - 1., 1., lit, a, fa, fw), plate(i, f, lit, a, fa, fw), smoothstep(-fw, fw, f));
  c = mix(c, plate(i + 1., 0., lit, a, fa, fw), smoothstep(-fw, fw, f - 1.) * step(i, LV - 1.5));
  // A wider, fainter shadow from further up the slope.
  c = mix(c, c * vec3(.42, .55, .78), .4 * smoothstep(-.1 - fa, .6 + fa, b - i - 1.));
  float g = uTime * .1396;
  vec2 o = (uv - vec2(.5 + .34 * cos(g), .5 + .26 * sin(g))) * vec2(uAspect, 1.);
  c += vec3(.2, .16, .55) * exp(-dot(o, o) * 7.) * (.1 + .12 * uAmount);
  // The reading area sits in mist.
  float well = 1. - smoothstep(.1, .6, length((uv - vec2(.52, .5)) * vec2(uAspect * .55, 1.)));
  c = mix(c, uGround, .42 * well);
  gl_FragColor = vec4(dither(mix(c, uGround, uDim)), 1.);
}`;

// Halloween: two little night scenes drawn from shapes, each a signed distance (negative inside) that
// cover() turns into smooth-edged coverage. Characters are about one unit across in their own space.
const SPOOKY = `${FLAT}
float cover(float d) { float w = fwidth(d) + 1e-4; return 1. - smoothstep(-w, w, d); }
float box(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0., 1.)); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
// Twinkling stars, only up in the sky.
float stars(vec2 p) {
  vec2 g = p * 34., id = floor(g);
  float h = hash(id);
  float d = length(fract(g) - .5 - (vec2(hash(id + 3.1), hash(id + 7.7)) - .5) * .6);
  return step(.955, h) * (1. - smoothstep(.03, .1, d)) * (.55 + .45 * sin(uTime * (1. + 2. * h) + h * 40.)) * smoothstep(.45, .8, p.y);
}
// A bat, its wings at f (1 up, -1 down), with two little eyes.
float bat(vec2 p, float f) {
  p.x = abs(p.x);
  vec2 w = rot(.5 * f) * (p - vec2(.1, .02));
  float wing = max(length((w - vec2(.32, .03)) * vec2(1., 2.6)) - .32, -(length(vec2(mod(w.x, .16) - .08, w.y + .11)) - .07));
  return min(min(length(p * vec2(1.4, 1.)) - .16, wing), seg(p, vec2(.04, .08), vec2(.1, .22)) - .04);
}
vec3 bats(vec3 c, vec2 p, vec3 k, vec3 eye) {
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 o = vec2(mod(uTime * (.045 + .02 * fi) + fi * .9, uAspect + .6) - .3, .6 + .11 * fi + .04 * sin(uTime * .8 + fi * 2.));
    vec2 q = (p - o) / (.034 - .006 * fi);
    c = mix(c, k, amt(cover(bat(q, sin(uTime * 9. + fi * 2.))) * .95));
    c = mix(c, eye, amt(cover(length(vec2(abs(q.x) - .055, q.y - .03)) - .028) * .9));
  }
  return c;
}
// Fireflies or wisps: n soft lights drifting low over the ground, each pulsing on its own beat.
vec3 lights(vec3 c, vec2 p, vec3 k, float lo, float hi) {
  for (int i = 0; i < 7; i++) {
    float fi = float(i), h = hash(vec2(fi, 9.));
    vec2 o = vec2(mod(h * 7. + uTime * (.01 + .01 * h), 1.) * uAspect + .04 * sin(uTime * .6 + fi), mix(lo, hi, hash(vec2(fi, 4.))) + .03 * sin(uTime * .9 + fi * 3.));
    float d = length(p - o);
    c = mix(c, k, amt((exp(-d * d * 9000.) * .9 + exp(-d * 40.) * .15) * (.5 + .5 * sin(uTime * 2. + fi * 5.))));
  }
  return c;
}
`;
// A graveyard on a moonlit hill: bats, drifting fog, ghosts floating by, and a skeleton who peeks
// out from behind a headstone now and then to wave.
const GRAVEYARD = `${SPOOKY}
float hill(float x) { return .27 + .03 * sin(x * 1.7 + .5) + .015 * sin(x * 4.3 + 1.); }
float stone(vec2 p) { return min(box(p - vec2(0., -.3), vec2(.5, .6)), length(p - vec2(0., .3)) - .5); }
float skull(vec2 p) { return min(length(p * vec2(1., 1.08)) - .42, box(p - vec2(0., -.38), vec2(.19, .12)) - .07); }
float holes(vec2 p) {
  float eyes = length(vec2(abs(p.x) - .16, p.y + .02) * vec2(1., .85)) - .12;
  float nose = length((p - vec2(0., -.19)) * vec2(1.8, 1.)) - .05;
  float teeth = max(abs(p.y + .4) - .07, max(abs(p.x) - .15, -(abs(fract(p.x * 10. + .5) - .5) - .38)));
  return min(min(eyes, nose), teeth);
}
float ghost(vec2 p, float t) {
  float body = max(box(p - vec2(0., -.12), vec2(.3, .3)), -.4 + .05 * sin(p.x * 20. + t * 5.) - p.y);
  return min(length(p - vec2(0., .18)) - .3, body);
}
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime;
  vec3 c = mix(uGround, uC2, amt(smoothstep(.95, .2, p.y) * .4));
  c = mix(c, uC3, amt(stars(p) * .8));
  vec2 m = p - vec2(uAspect - .3, .78);
  c = mix(c, uC3, amt(exp(-length(m) * 9.) * .3));
  c = mix(c, uC3, amt(cover(length(m) - .07) * .9));
  c = mix(c, uGround, amt((cover(length(m - vec2(.022, .015)) - .016) + cover(length(m + vec2(.024, .012)) - .011)) * .12));
  c = bats(c, p, mix(uGround, uC2, .6), uC3);
  float h = hill(p.x);
  c = mix(c, mix(uGround, uC2, .2), amt(cover(p.y - h)));
  float fog = smoothstep(.4, .14, p.y) * fbm(vec2(p.x * 1.4 - t * .04, p.y * 6. + t * .03));
  c = mix(c, uC1, amt(fog * .22));
  vec3 rock = mix(uGround, uC1, .2);
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float x = (fi + .5) / 7. * uAspect + (hash(vec2(fi, 1.)) - .5) * .1;
    float s = .042 + .02 * hash(vec2(fi, 2.));
    vec2 q = rot((hash(vec2(fi, 3.)) - .5) * .25) * (p - vec2(x, hill(x) - .02 + s * .9)) / s;
    if (i == 3) {
      // The skeleton: rises behind this stone, waves a while, and sinks back down, about every 14 s.
      float ph = mod(t * .9, 14.);
      float up = smoothstep(.5, 1.6, ph) * (1. - smoothstep(9., 10.2, ph));
      float y = mix(-1.6, 0., up);
      float wave = sin(ph * 7.) * smoothstep(2., 2.6, ph) * (1. - smoothstep(7.5, 8.2, ph));
      float above = step(h, p.y);
      vec2 k = (q - vec2(.24, .8 + y)) / .62;
      vec2 S = vec2(.36, .3 + y), E = S + vec2(.32, .18), H = E + rot(wave * .55) * vec2(.06, .36);
      float arm = min(seg(q, S, E), seg(q, E, H)) - .055;
      vec2 hq = rot(wave * .55) * (q - H);
      arm = min(arm, length(hq) - .08);
      for (int j = 0; j < 3; j++) arm = min(arm, seg(hq, vec2(0.), vec2(-.08 + .08 * float(j), .17)) - .03);
      c = mix(c, uC3, amt(cover(min(skull(k) * .62, arm)) * above));
      c = mix(c, uGround, amt(cover(holes(k)) * cover(skull(k)) * above * .9));
    }
    c = mix(c, rock, amt(cover(stone(q))));
    float cross = min(box(q - vec2(0., .12), vec2(.06, .32)), box(q - vec2(0., .26), vec2(.22, .06)));
    c = mix(c, uGround, amt(cover(cross) * step(.4, hash(vec2(fi, 5.))) * .5));
  }
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 o = vec2(mod(t * (.02 + .008 * fi) + (fi + .3) * (uAspect + .4) / 3., uAspect + .4) - .2, .4 + .1 * fi + .025 * sin(t * 1.3 + fi * 2.));
    vec2 q = (p - o) / (.075 - .012 * fi);
    float g = cover(ghost(q, t + fi));
    c = mix(c, uC1, amt(g * .8));
    float face = min(length(vec2(abs(q.x) - .11, q.y - .2) * vec2(1., .7)) - .05, length((q - vec2(0., .04)) * vec2(1., .8)) - .045);
    c = mix(c, uGround, amt(cover(face) * g * .85));
    c = mix(c, uC2, amt(cover(length(vec2(abs(q.x) - .2, q.y - .08)) - .045) * g * .35));
  }
  c = mix(c, uC1, amt(smoothstep(.2, .02, p.y) * fbm(vec2(p.x * 2. + t * .05, t * .05)) * .3));
  c = mix(c, mix(uGround, uC2, .08), amt(cover(p.y - (.09 + .02 * sin(p.x * 2.3 + 2.)))));
  c = lights(c, p, uC1, .12, .32);
  gl_FragColor = vec4(dither(c), 1.);
}`;
// A pumpkin patch at dusk: a crescent moon, bats, a crooked fence, falling leaves, fireflies, and a row
// of pumpkins that sway a little; some are jack-o'-lanterns flickering, some just have happy faces.
const PUMPKINS = `${SPOOKY}
float field(float x) { return .2 + .02 * sin(x * 1.9 + 1.) + .01 * sin(x * 5.1); }
float pumpkin(vec2 p) { return min(length(p * vec2(1., 1.25)) - .42, length(vec2(abs(p.x) - .25, p.y) * vec2(1.1, 1.25)) - .36); }
float tri(vec2 p, float w, float h) { p.x = abs(p.x); return max(-p.y, (p.x * h + p.y * w - w * h) / length(vec2(h, w))); }
float lantern(vec2 p) {
  float eyes = tri(vec2(abs(p.x) - .16, p.y - .02), .09, .14);
  float nose = tri(p - vec2(0., -.08), .05, .07);
  float mouth = max(length(p - vec2(0., -.02)) - .28, -(length(p - vec2(0., .1)) - .3));
  mouth = max(mouth, -box(vec2(abs(p.x) - .09, p.y + .16), vec2(.035, .05)));
  return min(min(eyes, nose), mouth);
}
float happy(vec2 p) {
  float eyes = length(vec2(abs(p.x) - .14, p.y - .04) * vec2(1., .8)) - .055;
  float smile = max(abs(length(p - vec2(0., -.02)) - .12) - .022, p.y + .02);
  return min(eyes, smile);
}
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime;
  vec3 c = mix(uGround, uC2, amt(smoothstep(1., .3, p.y) * .32));
  c = mix(c, uC1, amt(smoothstep(.55, .22, p.y) * .28));
  c = mix(c, uC3, amt(stars(p) * .75));
  vec2 m = p - vec2(.32, .8);
  c = mix(c, uC3, amt(exp(-length(m) * 10.) * .22));
  c = mix(c, uC3, amt(cover(max(length(m) - .065, -(length(m - vec2(.03, .018)) - .058))) * .9));
  c = bats(c, p, mix(uGround, uC2, .45), uC1);
  float back = .3 + .035 * sin(p.x * 1.3 + 1.) + .018 * sin(p.x * 3.7);
  vec3 dark = mix(uGround, uC2, .22);
  c = mix(c, dark, amt(cover(p.y - back)));
  float post = box(vec2(mod(p.x, .11) - .055, p.y - back - .028), vec2(.007, .035)) - .002;
  float rail = abs(p.y - back - .035 - .006 * sin(p.x * 9.)) - .0035;
  c = mix(c, mix(uGround, uC2, .38), amt(cover(min(post, rail)) * smoothstep(.2, .6, fbm(vec2(p.x * 2., 3.)))));
  float f = field(p.x);
  c = mix(c, mix(uGround, uC2, .12), amt(cover(p.y - f)));
  vec3 vine = mix(uGround, vec3(.3, .55, .25), .55);
  c = mix(c, vine, amt(cover(abs(p.y - f + .05 + .012 * sin(p.x * 13. + 1.)) - .003) * .8));
  for (int i = 0; i < 9; i++) {
    float fi = float(i), h = hash(vec2(fi, 1.));
    float s = .045 + .035 * hash(vec2(fi, 2.));
    float x = (fi + .5) / 9. * uAspect + (h - .5) * .08;
    vec2 q = rot(.06 * sin(t * 1.2 + fi * 1.7)) * (p - vec2(x, f - .07 - .05 * hash(vec2(fi, 3.)) + s * .42)) / s;
    float d = pumpkin(q);
    float glow = .75 + .25 * noise(vec2(t * 4., fi * 3.));
    bool lit = h > .45;
    if (lit) c = mix(c, uC3, amt(exp(-max(d, 0.) * 3.) * .25 * glow));
    vec3 skin = mix(mix(uC1, uGround, .4 * smoothstep(.1, -.45, q.y)), uC3, .25 * smoothstep(.1, .45, q.y - q.x * .4));
    skin = mix(skin, mix(uC1, uGround, .45), cover(abs(abs(q.x) - .2) - .018) * cover(d + .05));
    c = mix(c, skin, amt(cover(d)));
    c = mix(c, vine, amt(cover(box(rot(.25) * (q - vec2(.03, .46)), vec2(.05, .09)) - .02)));
    if (lit) c = mix(c, uC3, amt(cover(lantern(q)) * glow));
    else {
      c = mix(c, uGround, amt(cover(happy(q)) * .85));
      c = mix(c, uC3, amt(cover(length(vec2(abs(q.x) - .125, q.y - .07)) - .018) * .9));
      c = mix(c, uC2, amt(cover(length(vec2(abs(q.x) - .26, q.y + .06)) - .05) * .4));
    }
  }
  for (int i = 0; i < 8; i++) {
    float fi = float(i), h = hash(vec2(fi, 6.));
    vec2 o = vec2(fract(h * 3.7) * uAspect + .06 * sin(t * .8 + fi * 2.), 1.1 - mod(t * (.02 + .015 * h) + h, 1.3));
    vec2 q = rot(t * (.6 + h) + fi) * (p - o) / .014;
    vec3 leaf = mix(uC1, i == 2 || i == 5 ? uC2 : uC3, h * .7);
    c = mix(c, leaf, amt(cover(length(q * vec2(1., 2.3)) - .55) * .85));
  }
  c = lights(c, p, uC3, .08, .3);
  gl_FragColor = vec4(dither(c), 1.);
}`;
// Thanksgiving: two autumn evenings in the same shapes. tri is a triangle standing on y = 0, w wide each side and h tall.
const AUTUMN = `${SPOOKY}
float tri(vec2 p, float w, float h) { p.x = abs(p.x); return max(-p.y, (p.x * h + p.y * w - w * h) / length(vec2(h, w))); }
// Leaves with three lobes, tumbling down.
vec3 leaves(vec3 c, vec2 p, float t) {
  for (int i = 0; i < 8; i++) {
    float fi = float(i), h = hash(vec2(fi, 6.));
    vec2 o = vec2(fract(h * 3.7) * uAspect + .06 * sin(t * .8 + fi * 2.), 1.1 - mod(t * (.02 + .015 * h) + h, 1.3));
    vec2 q = rot(t * (.6 + h) + fi) * (p - o) / .017;
    vec3 leaf = mix(uC1, i == 2 || i == 5 ? uC2 : uC3, h * .7);
    float d = min(length(q * vec2(1., 2.3)) - .55, min(length((rot(.9) * q) * vec2(1., 2.6)) - .45, length((rot(-.9) * q) * vec2(1., 2.6)) - .45));
    c = mix(c, leaf, amt(cover(d) * .85));
  }
  return c;
}
`;
// A harvest moon rising over the fields: geese crossing it in a V, a barn with a lit window, corn shocks, a scarecrow
// who sways, and wheat that leans with the wind.
const HARVEST = `${AUTUMN}
float goose(vec2 p, float f) { p.x = abs(p.x); return min(seg(p, vec2(0.), vec2(.5, .28 * f)) - .05, length(p * vec2(.6, 1.)) - .09); }
// A row of wheat: one stalk to a cell, base to about s above it, each leaning on its own beat.
float wheat(vec2 p, float cell, float base, float s, float t) {
  float d = 1.;
  for (int k = -1; k <= 1; k++) {
    float id = floor(p.x / cell) + float(k), h = hash(vec2(id, cell * 91.));
    float x = (id + .2 + .6 * h) * cell, top = base + s * (.7 + .3 * hash(vec2(id, 5.)));
    float lean = (.012 + .01 * h) * sin(t * .9 + id * .7 + h * 6.);
    vec2 b = vec2(x + lean, top);
    d = min(d, seg(p, vec2(x, base - .05), b) - .0012);
    d = min(d, length((rot(-lean * 14.) * (p - b)) * vec2(1., .32)) - .0038);
  }
  return d;
}
float rise(float x) { return .33 + .04 * sin(x * 1.1 + .6) + .02 * sin(x * 2.9 + 2.); }
float slope(float x) { return .24 + .03 * sin(x * 1.7 + 2.) + .012 * sin(x * 4.6); }
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime;
  vec3 c = mix(uGround, uC2, amt(smoothstep(1., .25, p.y) * .34));
  c = mix(c, uC1, amt(smoothstep(.5, .24, p.y) * .2));
  c = mix(c, uC3, amt(stars(p) * .7));
  vec2 m = p - vec2(uAspect * .7, .5);
  float md = length(m);
  c = mix(c, uC1, amt(exp(-md * 4.5) * .35));
  vec3 moon = mix(uC1, uC3, .35 + .3 * smoothstep(-.12, .12, m.y - m.x * .3));
  moon = mix(moon, uC1 * .8, .35 * smoothstep(.45, .7, fbm(m * 14. + 3.)));
  c = mix(c, moon, amt(cover(md - .135) * .92));
  vec2 lead = vec2(mod(t * .022 + .9, uAspect + .8) - .4, .66 + .015 * sin(t * .5));
  for (int i = 0; i < 7; i++) {
    float fi = float(i), side = mod(fi, 2.) * 2. - 1., rank = floor((fi + 1.) / 2.);
    vec2 q = (p - lead - vec2(-rank * .034, side * rank * .02)) / .022;
    c = mix(c, mix(uGround, uC3, .5), amt(cover(goose(q, sin(t * 5. + fi * 1.3))) * .95));
  }
  c = mix(c, mix(uGround, uC2, .3), amt(cover(p.y - rise(p.x))));
  vec2 b = (p - vec2(.42, rise(.42) + .03)) / .06;
  float barn = min(min(box(b, vec2(.7, .5)), tri(b - vec2(0., .5), .8, .45)), min(box(b - vec2(1.05, .15), vec2(.22, .65)), length(b - vec2(1.05, .8)) - .22));
  c = mix(c, mix(uGround, uC2, .52), amt(cover(barn)));
  c = mix(c, uC3, amt(exp(-length(b - vec2(0., .02)) * 3.) * .18));
  c = mix(c, uC3, amt(cover(box(b - vec2(0., .02), vec2(.13, .19))) * (.8 + .2 * noise(vec2(t * 3., 1.)))));
  c = mix(c, mix(uGround, uC2, .16), amt(cover(p.y - slope(p.x))));
  for (int i = 0; i < 5; i++) {
    float fi = float(i), x = (fi + .35 + .3 * hash(vec2(fi, 11.))) / 5. * uAspect, s = .05 + .02 * hash(vec2(fi, 12.));
    vec2 q = (p - vec2(x, slope(x) - .012)) / s;
    float shock = cover(min(tri(q, .42, 1.), tri(vec2(q.x, 1.12 - q.y), .2, .3)));
    c = mix(c, mix(mix(uGround, uC1, .32), uC3, .12 * smoothstep(0., 1., q.y)), amt(shock));
    c = mix(c, mix(uGround, uC1, .16), amt(cover(abs(abs(q.x) - .14 * (1. - q.y)) - .012) * shock * .6));
    c = mix(c, uGround, amt(cover(abs(q.y - .78) - .03) * shock * .5));
  }
  float sx = uAspect * .22;
  vec2 q = rot(.04 * sin(t * .7)) * (p - vec2(sx, slope(sx) - .01)) / .11;
  c = mix(c, mix(uGround, uC1, .3), amt(cover(min(min(box(q - vec2(0., .5), vec2(.03, .5)), box(q - vec2(0., .72), vec2(.42, .028))), length(vec2(abs(q.x) - .46, q.y - .72)) - .06))));
  c = mix(c, mix(uGround, uC2, .62), amt(cover(min(box(q - vec2(0., .56), vec2(.17, .2)), box(q - vec2(0., .72), vec2(.36, .065))))));
  c = mix(c, mix(uGround, uC3, .55), amt(cover(length(q - vec2(0., .95)) - .13)));
  c = mix(c, uGround, amt(cover(min(length(vec2(abs(q.x) - .05, q.y - .97)) - .02, max(abs(length(q - vec2(0., .95)) - .07) - .012, q.y - .93))) * .85));
  c = mix(c, mix(uGround, uC1, .42), amt(cover(min(box(q - vec2(0., 1.06), vec2(.25, .022)), box(q - vec2(0., 1.12), vec2(.12, .06)) - .02))));
  float g = .1 + .015 * sin(p.x * 2.3 + 1.);
  c = mix(c, mix(uGround, uC1, .28), amt(cover(wheat(p, .021, g + .01, .13, t))));
  c = mix(c, mix(uGround, uC2, .08), amt(cover(p.y - g)));
  c = mix(c, mix(uGround, uC1, .45), amt(cover(wheat(p, .027, 0., .12, t + 2.))));
  c = leaves(c, p, t);
  c = lights(c, p, uC3, .08, .3);
  gl_FragColor = vec4(dither(c), 1.);
}`;
// Turkeys on parade at sundown: a row of them strutting across the field, one or two in a pilgrim's hat, under trees in
// their autumn colours, with pumpkins by the path and leaves coming down.
const TURKEYS = `${AUTUMN}
float gourd(vec2 p) { return min(length(p * vec2(1., 1.25)) - .42, length(vec2(abs(p.x) - .25, p.y) * vec2(1.1, 1.25)) - .36); }
float ridge(float x) { return .36 + .03 * sin(x * 1.3 + 2.) + .015 * sin(x * 3.3); }
float path(float x) { return .2 + .015 * sin(x * 2.1 + 1.) + .008 * sin(x * 5.3); }
// A turkey about one unit tall, walking right; w is where it is in its step.
vec3 turkey(vec3 c, vec2 q, float w, float hat) {
  vec2 f = q - vec2(-.12, .05);
  float ang = atan(f.y, -f.x), r = length(f);
  // The fan is a wedge between two lines through its root, so its edge has no jump where the angle wraps.
  vec2 u = vec2(-f.x, f.y);
  float fan = cover(max(r - .52 - .03 * cos(ang * 14.), max(-(u.y * .8776 + u.x * .4794), u.y * -.5885 - u.x * .8085)));
  vec3 fc = mix(mix(uC2, uC1, smoothstep(.2, .34, r)), uC3, smoothstep(.4, .47, r));
  fc = mix(fc, uGround, .4 * (1. - smoothstep(0., .12, abs(fract(ang * 2.23 + .5) - .5))));
  c = mix(c, mix(uGround, fc, .82), amt(fan));
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? 1. : -1.;
    vec2 hip = vec2(.02 + .06 * s, -.2), foot = hip + vec2(.12 * s * sin(w), -.26 + .05 * max(0., s * cos(w)));
    c = mix(c, mix(uGround, uC3, .6), amt(cover(min(seg(q, hip, foot), seg(q, foot, foot + vec2(.08, 0.))) - .018)));
  }
  vec2 bob = vec2(.03 * sin(w * 2.), 0.);
  vec3 skin = mix(uGround, uC1, .5);
  c = mix(c, mix(skin, uGround, .25 * smoothstep(.05, -.25, q.y)), amt(cover(length(q * vec2(1., 1.2)) - .3)));
  c = mix(c, mix(uGround, uC2, .55), amt(cover(length((rot(.3) * (q - vec2(-.04, -.02))) * vec2(1., 1.5)) - .17)));
  vec2 hd = vec2(.33, .4) + bob;
  c = mix(c, skin, amt(cover(min(seg(q, vec2(.2, .08), hd) - .055, length(q - hd) - .09))));
  c = mix(c, uC3, amt(cover(seg(q, hd + vec2(.08, 0.), hd + vec2(.16, -.03)) - .02)));
  c = mix(c, uC2, amt(cover(length((q - hd - vec2(.07, -.08)) * vec2(1., .65)) - .034)));
  c = mix(c, uGround, amt(cover(length(q - hd - vec2(.025, .02)) - .02) * .9));
  vec2 k = q - hd - vec2(-.01, .08);
  c = mix(c, mix(uGround, uC2, .3), amt(cover(min(box(k, vec2(.12, .014)), box(k - vec2(0., .07), vec2(.065, .06)))) * hat));
  c = mix(c, uC3, amt(cover(max(box(k - vec2(0., .03), vec2(.065, .014)), -box(k - vec2(0., .03), vec2(.016, .006)))) * hat));
  return c;
}
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime;
  vec3 c = mix(uGround, uC2, amt(smoothstep(1., .3, p.y) * .3));
  c = mix(c, uC1, amt(smoothstep(.62, .3, p.y) * .42));
  c = mix(c, uC3, amt(stars(p) * .5));
  vec2 s = p - vec2(uAspect * .3, .37);
  c = mix(c, uC3, amt(exp(-length(s) * 5.) * .4));
  c = mix(c, mix(uC1, uC3, .6), amt(cover(length(s) - .1) * .9));
  float cloud = smoothstep(.55, .75, fbm(vec2(p.x * 1.6 - t * .012, p.y * 7.))) * smoothstep(.45, .6, p.y) * smoothstep(1., .8, p.y);
  c = mix(c, uC2, amt(cloud * .25));
  c = mix(c, mix(uGround, uC2, .28), amt(cover(p.y - ridge(p.x))));
  for (int i = 0; i < 9; i++) {
    float fi = float(i), h = hash(vec2(fi, 21.));
    float x = (fi + .2 + .6 * h) / 9. * uAspect, sz = .045 + .03 * hash(vec2(fi, 22.));
    vec2 q = (p - vec2(x, ridge(x) - .01)) / sz;
    float crown = min(length(q - vec2(0., 1.)) - .5, min(length(q - vec2(-.35, .8)) - .36, length(q - vec2(.36, .78)) - .34)) + .03 * sin(q.x * 9. + t * .8 + fi);
    vec3 k = h < .34 ? uC1 : h < .67 ? uC2 : uC3;
    c = mix(c, mix(uGround, uC2, .15), amt(cover(box(q - vec2(0., .35), vec2(.07, .4)))));
    c = mix(c, mix(uGround, k, .6 + .14 * smoothstep(-.2, .5, q.y - 1. - q.x * .5)), amt(cover(crown)));
  }
  c = mix(c, mix(uGround, uC1, .13), amt(cover(p.y - path(p.x))));
  for (int i = 0; i < 5; i++) {
    float fi = float(i), h = hash(vec2(fi, 31.));
    float x = mod(t * .028 + fi * (uAspect + .6) / 5. + .08 * h, uAspect + .6) - .3, sz = .085 + .05 * h, w = t * 5. + fi * 2.1;
    c = turkey(c, (p - vec2(x, path(x) - .03 + sz * (.47 + .02 * abs(sin(w))))) / sz, w, step(.6, hash(vec2(fi, 32.))));
  }
  float g = .09 + .012 * sin(p.x * 3.1 + 2.);
  c = mix(c, mix(uGround, uC2, .1), amt(cover(p.y - g)));
  vec3 vine = mix(uGround, vec3(.3, .55, .25), .55);
  for (int i = 0; i < 6; i++) {
    float fi = float(i), h = hash(vec2(fi, 41.)), sz = .03 + .025 * hash(vec2(fi, 42.));
    float x = (fi + .5) / 6. * uAspect + (h - .5) * .12;
    vec2 q = (p - vec2(x, .09 + .012 * sin(x * 3.1 + 2.) - .035 + sz * .42)) / sz;
    float d = gourd(q);
    vec3 skin = mix(mix(uC1, uGround, .4 * smoothstep(.1, -.45, q.y)), uC3, .25 * smoothstep(.1, .45, q.y - q.x * .4));
    skin = mix(skin, mix(uC1, uGround, .45), cover(abs(abs(q.x) - .2) - .018) * cover(d + .05));
    c = mix(c, skin, amt(cover(d)));
    c = mix(c, vine, amt(cover(box(rot(.25) * (q - vec2(.03, .46)), vec2(.05, .09)) - .02)));
  }
  c = leaves(c, p, t);
  c = lights(c, p, uC3, .06, .26);
  gl_FragColor = vec4(dither(c), 1.);
}`;
// A fireside evening: a brick fireplace with a living fire over a bed of coals, a mantel with candles, pumpkins and a leaf
// garland, a wreath above it, a dusk window with leaves falling past, an armchair with a throw, and a ginger cat asleep on
// the rug. The firelight warms what faces the fire and leans soft shadows away from it. Room units r: 0 at the fireplace's
// middle, the floor meeting the wall at fl. Small things are drawn only near where they are, so their edges use cv() and the
// pixel's size, px, where fwidth() would be undefined.
const HEARTH = `${AUTUMN}
float cv(float d, float w) { return 1. - smoothstep(-w, w, d); }
// A pointed leaf along y: half length h, half width w.
float lens(vec2 q, float h, float w) { float r = (h * h / w + w) * .5; return length(vec2(abs(q.x) + r - w, q.y)) - r; }
// An ellipse with radii e, near enough a distance for an edge.
float oval(vec2 q, vec2 e) { return (length(q / e) - 1.) * min(e.x, e.y); }
// The fire's heat at f (y up from the coals): above 0 is flame, near 1 its pale core. Five tongues rise and fall on their own
// beats; noise carried upward makes them lick and their tips break away.
float heat(vec2 f, float t, float boost) {
  float y = max(f.y, 0.);
  float n1 = noise(vec2(f.x * 6., y * 3.6 - t * 2.9)), n2 = noise(vec2(f.x * 13. + 3., y * 7.5 - t * 5.3));
  // The higher up, the more a tongue bends and licks.
  f.x += ((n1 - .5) * .32 + .06 * sin(t * 1.7 + y * 6.)) * y * 1.1;
  float h = 1. - y / (.08 * boost) - f.x * f.x / .1156;
  for (int i = 0; i < 5; i++) {
    float fi = float(i), side = fi - 2.;
    float hi = (.5 - .055 * side * side + .07 * sin(t * (2.1 + .37 * fi) + fi * 1.9) + .04 * sin(t * (4.7 + .5 * fi) + fi * 4.)) * boost;
    float s = y / hi, wx = (f.x - side * .12 - .02 * sin(t * .8 + fi * 2.3)) / ((.085 + .025 * (1. - abs(side) * .5)) * (1.45 - min(s, 1.)));
    h = max(h, 1. - s - wx * wx);
  }
  return h - (n1 * .55 + n2 * .45 - .42) * (.2 + 1.1 * y);
}
// A log from a to b, w thick: round bark lit from the flames above and glowing in its cracks below, its cut end at b
// showing rings and a burning rim.
vec3 logC(vec3 c, vec2 q, vec2 a, vec2 b, float w, float seed, float t, float glow, float qp) {
  vec2 ax = normalize(b - a);
  float l = length(b - a), u = dot(q - a, ax), v = dot(q - a, vec2(-ax.y, ax.x)) / w;
  float d = min(max((abs(v) - 1.) * w, max(-u, u - l)), oval(vec2(u, v * w), vec2(w * .4, w)));
  float e = oval(vec2(u - l, v * w), vec2(w * .42, w)), cyl = sqrt(max(1. - v * v, 0.));
  float n = noise(vec2(u * 4. + seed * 7., v * 2.));
  vec3 bark = mix(uGround, mix(uC2, uC1, .3), .3 + .1 * n) * (.82 + .25 * smoothstep(-.3, .6, sin(v * 9. + n * 5.)));
  bark *= .42 + .38 * cyl + .35 * max(v, 0.);
  float cr = (1. - smoothstep(.0, .07, abs(n - .5))) * smoothstep(.0, .5, abs(sin(v * 4.5 + n * 3.)));
  bark = mix(bark, mix(uC1, uC3, .15), cr * (.55 + .45 * sin(t * 1.3 + u * 9. + seed * 5.)) * (.08 + .92 * smoothstep(.1, -.9, v)) * glow);
  bark = mix(bark, mix(uC1, uC3, .2), smoothstep(.6, 1., v) * .45 * glow);
  bark = mix(bark, uC1, smoothstep(-.55, -1., v) * .35 * glow);
  float ring = length(vec2((u - l) / (w * .42), v));
  vec3 grain = mix(uGround, mix(uC3, uC1, .5), .5) * (.84 + .16 * sin(ring * 26.)) * (.8 + .25 * v);
  grain = mix(grain, bark * .8, smoothstep(.8, .88, ring));
  grain = mix(grain, mix(uC1, uC3, .35), smoothstep(.7, .86, ring) * (.4 + .6 * smoothstep(-.4, .8, v)) * .7 * glow);
  return mix(mix(c, bark, cv(d, qp)), grain, cv(e, qp));
}
// A pumpkin of radii e with its stem, ribbed, lit from the left: colour and cover.
vec4 pumpkin(vec2 k, vec2 e, vec3 skin, float qp) {
  float d = oval(k, e) + .012 * smoothstep(.6, 1., k.y / e.y) * smoothstep(.3, 0., abs(k.x / e.x));
  float u = clamp(k.x / (e.x * sqrt(max(1. - k.y * k.y / (e.y * e.y), .03))), -1., 1.), th = asin(u);
  float lobe = cos(th * 5.);
  vec3 col = skin * (.55 + .4 * (.5 + .5 * lobe)) * (.78 + .32 * smoothstep(.8, -.8, u - k.y / e.y * .5));
  col *= 1. - .35 * smoothstep(.75, 1., -lobe) * (1. - abs(u) * .5);
  col = mix(col, mix(uC3, skin, .4), .3 * exp(-dot((k - e * vec2(-.4, .38)) / e, (k - e * vec2(-.4, .38)) / e) * 9.));
  col *= 1. - .3 * smoothstep(-.4, -1., k.y / e.y);
  float stem = box(rot(.25) * (k - vec2(.02, e.y * .95)), vec2(e.x * .07, e.y * .2)) - .004;
  col = mix(col, mix(uGround, mix(vec3(.3, .55, .25), skin, .35), .45) * (.8 + .3 * smoothstep(-.01, .01, k.x - .02)), cv(stem, qp));
  return vec4(col, max(cv(d, qp), cv(stem, qp)));
}
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime;
  // The fireplace stands right of the middle; on a narrow page in the middle, where the whole room draws smaller to fit.
  float fx = uAspect * mix(.5, .66, smoothstep(.8, 1.4, uAspect)), k = clamp(uAspect / 1.2, .6, 1.);
  vec2 r = vec2(p.x - fx, p.y - .25 * (1. - k)) / k;
  float px = .001 / (uPx * k), fl = .155;
  // The fire breathes: a slow swell, a quick flutter, and every few seconds a log cracks, flaring it and throwing sparks.
  float ev = floor(t * .16), et = fract(t * .16) / .16 - 1. - 3. * hash(vec2(ev, 2.));
  float pop = step(.3, hash(vec2(ev, 5.))) * step(0., et) * exp(-et * 4.);
  float flick = .84 + .1 * noise(vec2(t * 2.1, 1.)) + .06 * noise(vec2(t * 7.3, 4.)) + .2 * pop;
  vec2 L = (r - vec2(0., fl + .09)) * vec2(1., 1.25);
  float fall = flick / (1. + dot(L, L) * 10.), sway = (flick - .87) * .25;
  vec3 warm = mix(uC1, uC3, .3), wood = mix(uGround, mix(uC1, uC2, .45), .32);
  // How much each pixel turns to the fire, for the light laid over everything at the end.
  float face = .55;

  // The wall: dark paper with a faint stripe and a small dot; panelling below a rail.
  vec3 c = mix(uGround, uC2, amt(.11 + .04 * r.y));
  float sx = fract(r.x * 9. + .5) - .5;
  c = mix(c, mix(uGround, uC2, .17 + .04 * r.y), amt(cover(abs(sx) - .17) * .5));
  c = mix(c, mix(uGround, uC3, .15), amt(cover(length(vec2(sx, fract(r.y * 9.) - .5)) / 9. - .0045) * .5));
  float rail = fl + .2;
  vec2 pc = vec2((fract(r.x / .19 + .5) - .5) * .19, r.y - fl - .108), pn = pc / vec2(.07, .066);
  float pnl = box(pc, vec2(.064, .06)) - .006;
  float tone = abs(pn.y) > abs(pn.x) ? sign(pn.y) : -sign(pn.x * r.x) * .6;
  vec3 wain = mix(uGround, mix(uC2, uC1, .3), .2 + .04 * cover(pnl));
  wain *= 1. + cover(abs(pnl + .008) - .008) * tone * .28;
  wain = mix(wain, uGround, cover(abs(pnl) - .0015) * .3);
  c = mix(c, wain, amt(cover(r.y - rail)));
  c = mix(c, mix(wood, uC3, .12 * smoothstep(rail, rail + .008, r.y)), amt(cover(abs(r.y - rail - .002) - .007)));
  c = mix(c, mix(wood, uGround, .3), amt(cover(r.y - fl - .026)));
  c = mix(c, mix(wood, uC3, .1), amt(cover(abs(r.y - fl - .026) - .002)));

  // The window: dusk over a line of hills, the moon, leaves coming down past it.
  vec2 w = r - vec2(-.83, .62);
  vec3 sky = uGround;
  if (abs(w.x) < .11 && abs(w.y) < .155) {
    sky = mix(mix(uGround, uC2, .45), mix(uC2, uC1, .7), smoothstep(.13, -.1, w.y));
    vec2 mw = w - vec2(.045, .08);
    float md = length(mw);
    sky = mix(sky, mix(uC1, uC3, .6), exp(-md * 28.) * .45);
    sky = mix(sky, uC3, stars(vec2(w.x * 1.6 + .3, w.y * 1.6 + .74)) * .8);
    sky = mix(sky, mix(uC3, uC1, .15 + .2 * noise(mw * 90.)), cv(md - .024, px));
    float hills = w.y + .1 - .01 * sin(w.x * 21. + 1.) - .004 * sin(w.x * 53.) - .006 * cos(w.x * 140.) * step(w.x, -.02);
    sky = mix(sky, mix(uGround, uC2, .22), cv(hills, px));
    for (int i = 0; i < 5; i++) {
      float fi = float(i), h = hash(vec2(fi, 61.));
      float drop = t * (.022 + .015 * h) + h * 2.;
      vec2 o = vec2((hash(vec2(fi, floor(drop / .4))) - .5) * .2 + .02 * sin(t * .7 + fi * 2.), .19 - mod(drop, .4));
      sky = mix(sky, mix(uC1, i == 2 ? uC2 : uC3, h * .7), cv(lens(rot(t * (.7 + h) + fi) * (w - o), .009, .004), px) * .9);
    }
    sky = mix(sky, uC3, .05 * smoothstep(.015, 0., abs(w.x + w.y * .7 - .03) - .012));
  }
  float glass = box(w, vec2(.1, .145));
  c = mix(c, sky, amt(cover(glass)));
  c = mix(c, uGround, amt(.35 * smoothstep(-.012, 0., glass) * cover(glass)));
  float frame = min(max(box(w, vec2(.116, .161)), -glass), min(box(w, vec2(.1, .004)), box(w, vec2(.004, .145))));
  c = mix(c, mix(wood, uC3, .06), amt(cover(frame)));
  c = mix(c, uGround, amt(.3 * smoothstep(-.2, -.178, w.y) * step(w.y, -.177) * smoothstep(.14, .12, abs(w.x))));
  c = mix(c, mix(wood, uC3, .08 + .1 * smoothstep(-.17, -.16, w.y)), amt(cover(box(w - vec2(0., -.168), vec2(.135, .009)) - .002)));
  // Curtains tied back either side, folds catching the light, their hems stirring in a draft.
  float cw = .045 + .03 * smoothstep(0., .22, r.y - .56) + .055 * smoothstep(0., .35, .56 - r.y);
  float ax = abs(w.x) + .0025 * sin(t * .5 + r.y * 6.) * smoothstep(.56, .2, r.y);
  float cu = (ax - .165 + cw) / cw, curtain = max(abs(ax - .165 + cw * .5) - cw * .5, max(r.y - .805, fl + .005 - r.y));
  vec3 cloth = mix(uGround, uC2, .34) * (.72 + .36 * (.5 + .5 * cos(cu * 15.7))) * (.85 + .2 * smoothstep(.1, .9, cu));
  c = mix(c, cloth, amt(cover(curtain)));
  c = mix(c, mix(uGround, mix(uC1, uC3, .4), .55), amt(cover(max(abs(r.y - .56) - .007, curtain))));
  c = mix(c, mix(wood, uC3, .15), amt(cover(min(max(abs(r.y - .81) - .0035, abs(w.x) - .19), length(vec2(abs(w.x) - .195, r.y - .81)) - .008))));

  // The fireplace, in its own units: q is 0 at the middle of its foot and 1 under the mantel.
  vec2 q = vec2(r.x, r.y - fl) / .4;
  float qp = px / .4;
  // The chimney breast above, and the wreath on it.
  float breast = box(q - vec2(0., 2.), vec2(.7, 1.));
  c = mix(c, mix(uGround, uC2, .16), amt(cover(breast)));
  c = mix(c, uGround, amt(.25 * cover(breast) * smoothstep(-.08, 0., breast)));
  vec2 wq = q - vec2(0., 1.72);
  vec4 wr = vec4(uGround, 0.);
  if (abs(wq.x) < .38 && wq.y < .36 && wq.y > -.48) {
    float wa = atan(wq.y, wq.x + 1e-5), wd = length(wq);
    vec3 col = mix(uGround, mix(uC2, uC1, .3), .3) * (.75 + .5 * noise(wq * 45.));
    float al = cv(abs(wd - .21) - .045, qp);
    for (int j = 0; j < 3; j++) {
      float fj = float(j), off = fj / 3.;
      for (int m = 0; m < 2; m++) {
        float s = floor(wa / 6.2832 * 11. + off) + float(m), an = (s - off + .5) * 6.2832 / 11.;
        float h = hash(vec2(mod(s, 11.), fj + 3.));
        vec2 lq = rot(-an + (h - .5) * 1.1 + .5 * (fj - 1.)) * (wq - (.205 + .04 * (fj - 1.) + .015 * h) * vec2(cos(an), sin(an)));
        float lc = cv(lens(lq, .085 - .015 * fj, .033 - .004 * fj), qp);
        vec3 leaf = mix(uGround, h < .33 ? uC1 : h < .66 ? uC2 : uC3, .55 + .12 * fj);
        leaf *= .78 + .3 * smoothstep(-.02, .02, lq.x);
        leaf = mix(leaf, leaf * .6, cv(abs(lq.x) - .0035, qp) * step(abs(lq.y), .07));
        col = mix(col, leaf, lc);
        al = max(al, lc);
      }
    }
    // A bow at the foot, its tails barely stirring.
    vec2 bw = wq - vec2(0., -.215);
    float tail = min(seg(bw, vec2(0.), vec2(-.05 + .006 * sin(t * 1.1), -.14)), seg(bw, vec2(0.), vec2(.055 + .006 * sin(t * 1.3 + 1.), -.13))) - .02;
    float loops = min(oval(rot(-.35) * (bw - vec2(-.075, .02)), vec2(.075, .042)), oval(rot(.35) * (bw - vec2(.075, .02)), vec2(.075, .042)));
    vec3 rib = mix(uGround, mix(uC2, uC1, .3), .75);
    col = mix(col, rib * (.8 + .25 * smoothstep(-.2, -.05, bw.y)), cv(tail, qp));
    col = mix(col, rib * (.75 + .35 * smoothstep(-.03, .05, bw.y)), cv(loops, qp));
    col = mix(col, rib * .55, cv(min(oval(rot(-.35) * (bw - vec2(-.07, .018)), vec2(.035, .013)), oval(rot(.35) * (bw - vec2(.07, .018)), vec2(.035, .013))), qp));
    col = mix(col, rib * 1.1, cv(box(bw, vec2(.022, .026)) - .008, qp));
    wr = vec4(col, max(al, max(cv(min(tail, loops), qp), cv(box(bw, vec2(.022, .026)) - .008, qp))));
  }
  c = mix(c, wr.rgb, amt(wr.a));
  // A clock beside the breast, its pendulum swinging.
  vec2 ck = r - vec2(.47, .64);
  float ccase = min(length(ck) - .044, box(ck - vec2(0., -.085), vec2(.027, .062)) - .004);
  vec3 clock = wood * 1.1;
  if (abs(ck.x) < .05 && ck.y < .05 && ck.y > -.16) {
    vec3 col = clock;
    float fd = length(ck);
    col = mix(col, mix(uGround, uC3, .5), cv(fd - .035, px));
    float ta = atan(ck.y, ck.x + 1e-5) / 6.2832 * 12.;
    col = mix(col, wood * .6, cv(max(abs(fract(ta + .5) - .5) / 12. * 6.2832 * fd - .0012, abs(fd - .03) - .003 - .002 * step(mod(floor(ta + .5) + 300., 3.), .5)), px));
    float hr = 1.3 - t * .00145, mn = 2. - t * .0174;
    col = mix(col, wood * .5, cv(min(seg(ck, vec2(0.), .018 * vec2(cos(hr), sin(hr))), seg(ck, vec2(0.), .027 * vec2(cos(mn), sin(mn)))) - .0018, px));
    vec2 pw = ck - vec2(0., -.09);
    float win = box(pw, vec2(.017, .046));
    col = mix(col, mix(uGround, uC2, .2), cv(win, px));
    float sw = .28 * sin(t * 3.1416);
    vec2 bob = vec2(0., .04) + .07 * vec2(sin(sw), -cos(sw));
    float pend = min(seg(pw, vec2(0., .04), bob) - .0015, length(pw - bob) - .009);
    clock = mix(col, mix(uGround, uC3, .45) * (.8 + .3 * smoothstep(-.01, .01, pw.x - bob.x)), cv(pend, px) * cv(win, px));
  }
  c = mix(c, clock, amt(cover(ccase)));

  // The floor: boards running into the room, meeting far behind the fire; a sheen where the fire shines on them.
  float dz = max(.52 - r.y, .05), bx = r.x / dz * 6., bid = floor(bx), bz = 1. / dz * 2. + hash(vec2(bid, 8.));
  vec3 boards = mix(uGround, mix(uC1, uC2, .5), .15 + .05 * hash(vec2(bid, 3.)) + .025 * sin((bx - bid) * 31. + sin(bz * 3. + bid) * 2.));
  boards = mix(boards, uGround, .55 * max(lineAt(bx), lineAt(bz) * .8));
  boards = mix(boards, warm * .55, .22 * exp(-r.x * r.x * 100.) * smoothstep(-.1, fl, r.y) * flick);
  boards *= .7 + .3 * smoothstep(fl, fl - .03, r.y);
  c = mix(c, boards, amt(cover(r.y - fl)));
  face = mix(face, 1., cover(r.y - fl));
  // Shadows of the armchair and the cat, thrown away from the fire and trembling with it.
  float shw = smoothstep(.1, -.08, box(r - vec2(-.68 - sway * .3, fl + .17), vec2(.17, .17)) - .05) * cover(fl - r.y);
  float shf = smoothstep(.05, -.03, oval(r - vec2(-.76 - sway * .2, fl - .055), vec2(.27, .03))) + smoothstep(.02, -.015, oval(r - vec2(-.33 - sway * .1, .066), vec2(.08, .016)));
  c = mix(c, uGround, amt(.3 * shw + .4 * min(shf, 1.) * cover(r.y - fl)) * (.8 + .4 * (flick - .84)));

  // The hearth: a stone slab, its top and its front edge, warm where the fire shines on it.
  float slab = max(abs(q.x) - .96 + .3 * q.y, abs(q.y + .068) - .068);
  vec3 stone = mix(uGround, mix(uC3, uC2, .5), .18 + .04 * hash(vec2(floor(q.x * 3.2 + .5), 1.)));
  stone *= .9 + .12 * noise(q * vec2(14., 30.));
  float front = cover(q.y + .1);
  stone = mix(stone, uGround, .5 * lineAt(q.x * 3.2 + .5) * (1. - front));
  stone = mix(stone, stone * .62, front);
  stone = mix(stone, warm * .7, .4 * exp(-q.x * q.x * 6.) * smoothstep(-.14, 0., q.y) * flick);
  c = mix(c, stone, amt(cover(slab)));
  face = mix(face, 1.1, cover(slab));

  // The surround: bricks in a running bond round an arched opening, each a shade different, the edge toward the fire
  // catching its light, soot above the arch, and the mantel's shadow under it.
  float body = box(q - vec2(0., .5), vec2(.8, .5));
  float opening = min(box(q - vec2(0., .27), vec2(.42, .27)), oval(q - vec2(0., .54), vec2(.42, .28)));
  vec2 bb = vec2(q.x / .26 + .5 * mod(floor(q.y / .1), 2.), q.y / .1), bi = floor(bb), bf = fract(bb) - .5;
  vec2 bc = vec2((bi.x + .5 - .5 * mod(bi.y, 2.)) * .26, (bi.y + .5) * .1), toF = normalize(vec2(0., .32) - bc);
  float ex = (.5 - abs(bf.x)) * .26, ey = (.5 - abs(bf.y)) * .1;
  vec3 brick = mix(uGround, uC2, .34 + .14 * hash(bi) + .1 * noise(q * 26.));
  brick = mix(brick, mix(uGround, uC1, .42), .3 * step(.87, hash(bi + 3.)));
  float edge = (1. - smoothstep(.006, .03, ex)) * max(0., sign(bf.x) * toF.x) + (1. - smoothstep(.006, .022, ey)) * max(0., sign(bf.y) * toF.y);
  brick *= 1. - .25 * (1. - smoothstep(.006, .02, ey)) * step(bf.y, 0.);
  brick = mix(brick, warm, edge * .3 * flick * exp(-max(opening, 0.) * 3.));
  brick = mix(brick, mix(uGround, uC3, .1), cover(min(ex, ey) - .007));
  brick = mix(brick, brick * (1. + warm * .6), exp(-max(opening, 0.) * 7.) * flick);
  brick = mix(brick, uGround, .55 * smoothstep(.99, .8, q.y) * smoothstep(.62, .82, q.y) * exp(-q.x * q.x * 6.) * (.5 + .6 * noise(q * vec2(8., 3.))));
  brick = mix(brick, uGround, .45 * smoothstep(.85, 1., q.y));
  // The arch: wedge bricks round the top, a keystone in the middle.
  vec2 ae = (q - vec2(0., .54)) / vec2(.42, .28);
  float arch = max(oval(q - vec2(0., .54), vec2(.53, .38)), max(-opening, .54 - q.y));
  float ang = atan(ae.y, ae.x + 1e-5) / 3.1416 * 11.;
  vec3 vous = mix(uGround, uC2, .44 + .1 * hash(vec2(floor(ang + .5), 4.))) * (1. + .3 * flick * smoothstep(1.25, 1., length(ae)));
  vous = mix(vous, mix(uGround, uC3, .1), lineAt(ang + .5) * step(abs(ang - 5.5), 4.9));
  float key = max(box(q - vec2(0., .87), vec2(.06, .075)) - .006, -opening);
  c = mix(c, brick, amt(cover(body)));
  c = mix(c, vous, amt(cover(arch)));
  c = mix(c, mix(mix(uGround, uC2, .5), uC3, .12) * (1. + .2 * smoothstep(.83, .78, q.y) * flick), amt(cover(key)));
  face = mix(face, .5, cover(body));
  // The firebox: back and side walls of firebrick, coals, logs on a grate, the fire, and embers going up.
  vec3 fb = uGround;
  if (abs(q.x) < .47 && q.y < .86 && q.y > -.03) {
    float s = clamp((abs(q.x) - .29) / .13, 0., 1.);
    float course = (q.y - .09 * (1. - s)) / mix(.075, .094, s);
    vec3 wall = mix(uGround, uC2, .16 + .1 * s);
    wall *= 1. - .35 * cv(abs(fract(course + .5) - .5) - .05, .02);
    wall *= 1. - .3 * cv(abs(fract(q.x / .15 * (1. - s) + .5 * mod(floor(course), 2.) + .5) - .5) - .03, .04) * (1. - s);
    wall = mix(wall, uGround, .45 * smoothstep(.35, .8, q.y) * (1. - s * .5));
    float glow = flick * exp(-q.x * q.x * 9. - (q.y - .22) * (q.y - .22) * 9.77);
    wall = mix(wall, warm, glow * (.4 + .25 * s));
    wall = mix(wall, mix(uGround, uC2, .3), cv(q.y - .09 * (1. - s), qp) * .8);
    fb = wall;
    // The coal bed under the grate, each coal glowing on its own slow beat.
    float top = .075 + .012 * cos(q.x * 11.) - .2 * q.x * q.x;
    float lump = noise(vec2(q.x * 34., q.y * 46.)), pulse = noise(vec2(q.x * 9. - t * .3, t * .45));
    float bed = cv(q.y - top - .012 * (lump - .5) - .006 * sin(q.x * 61.), qp) * cv(abs(q.x) - .4, qp);
    vec3 coal = mix(mix(uC2, uC1, .5), mix(uC1, uC3, .4), smoothstep(.45, .9, pulse) * (.6 + .4 * flick));
    coal = mix(coal, mix(uGround, uC2, .22), smoothstep(.5, .62, lump) * (.75 + .25 * smoothstep(.2, .5, q.y - top + .06)));
    fb = mix(fb, coal, bed);
    // A log behind, the flames, two logs in front, the grate.
    fb = logC(fb, q, vec2(.37, .235), vec2(-.34, .2), .048, 2., t, flick, qp);
    float hh = heat(q - vec2(0., .1), t, 1. + .35 * pop);
    vec3 flame = mix(mix(uC2, uC1, .35), uC1, smoothstep(.04, .18, hh));
    flame = mix(flame, mix(uC1, uC3, .5), smoothstep(.38, .5, hh));
    flame = mix(flame, uC3, smoothstep(.7, .86, hh));
    flame = mix(flame, mix(uC2, uC1, .3), smoothstep(.15, .45, q.y - .1) * (1. - smoothstep(.08, .3, hh)) * .6);
    fb = mix(fb, warm, .25 * smoothstep(-.4, 0., hh) * smoothstep(.75, .25, q.y) * flick);
    fb = mix(fb, flame, smoothstep(0., .05, hh) * (.8 + .2 * smoothstep(0., .25, hh)) * smoothstep(top - .01, top + .04, q.y));
    fb = logC(fb, q, vec2(-.35, .11), vec2(.29, .128), .062, 5., t, flick, qp);
    float grate = min(box(vec2(abs(q.x) - .3, q.y - .03), vec2(.011, .03)), box(q - vec2(0., .052), vec2(.34, .006)) - .003);
    fb = mix(fb, mix(uGround, uC2, .12) * (1. + .8 * warm * smoothstep(.05, .06, q.y) * flick), cv(grate, qp));
    float emb = 0.;
    for (int i = 0; i < 9; i++) {
      float fi = float(i), h = hash(vec2(fi, 17.)), life = 1.8 + 1.4 * h;
      float u = fract(t / life + h), n = floor(t / life + h);
      vec2 o = q - vec2((hash(vec2(n, fi)) - .5) * .5 + (.05 * sin(t * 2.6 + fi * 3.) + .12 * (hash(vec2(n, fi + 9.)) - .5)) * u, .14 + u * .72);
      emb += exp(-dot(o, o) * 9000.) * (1. - u) * (.6 + .4 * sin(t * 13. + fi * 5.));
    }
    fb = mix(fb, mix(uC3, uC1, .3), clamp(emb, 0., 1.));
  }
  float inside = cover(opening);
  c = mix(c, fb, amt(inside));
  face = mix(face, 0., inside);
  // When a log cracks, sparks jump out over the hearth, land, and fade.
  if (et > 0. && et < 2.2 && abs(q.x) < 1.3 && q.y > -.3 && q.y < .9) {
    float sp = 0.;
    for (int i = 0; i < 6; i++) {
      float fi = float(i), h = hash(vec2(ev, fi + 40.)), h2 = hash(vec2(fi, ev + 7.));
      float tt = et - h2 * .25, land = -.02 - .1 * hash(vec2(fi, ev + 3.));
      vec2 v0 = vec2((h - .5) * 1.7, .5 + .55 * h2), p0 = vec2((h - .5) * .2, .14);
      float tl = (v0.y + sqrt(v0.y * v0.y + 5.2 * (p0.y - land))) / 2.6, ta = min(tt, tl), tz = min(max(tt - .04, 0.), tl);
      vec2 o = p0 + v0 * ta - vec2(0., 1.3 * ta * ta), o2 = p0 + v0 * tz - vec2(0., 1.3 * tz * tz);
      float d = seg(q, o, o2);
      sp += exp(-d * d * 14000.) * step(0., tt) * (1. - smoothstep(.5, 1.9, tt));
    }
    c = mix(c, mix(uC3, uC1, .25), amt(clamp(sp, 0., 1.)));
  }

  // The mantel: a shelf with a moulded edge on two brackets, its lip warm from the fire below.
  float shelf = box(q - vec2(0., 1.045), vec2(.95, .042)) - .006;
  float corbel = max(box(vec2(abs(q.x) - .82, q.y - .93), vec2(.045, .075)), -oval(vec2(abs(q.x) - .74, q.y - .855), vec2(.06, .075)));
  vec3 mwood = mix(uGround, mix(uC1, uC2, .45), .36) * (.92 + .08 * sin(q.x * 37. + sin(q.x * 6. + q.y * 30.) * 2.));
  mwood = mix(mwood, mwood * 1.25, smoothstep(1.076, 1.084, q.y));
  mwood = mix(mwood, mwood * .7, cover(abs(q.y - 1.028) - .004));
  mwood = mix(mwood, warm * .8, .3 * smoothstep(1.02, 1., q.y) * exp(-q.x * q.x * 3.) * flick);
  c = mix(c, mwood * .9, amt(cover(corbel)));
  c = mix(c, mwood, amt(cover(shelf)));
  // A garland of leaves swagged along its edge, the leaves barely moving.
  if (abs(q.x) < 1. && q.y > .86 && q.y < 1.08) {
    vec3 col = c;
    for (int j = 0; j < 2; j++) {
      float fj = float(j), gi = floor(q.x / .095 + fj * .5), gx = (gi + .5 - fj * .5) * .095;
      float gy = 1.005 - .07 * abs(sin(gx / .95 * 3.1416)) - .012 * fj, h = hash(vec2(gi, 23. + fj));
      vec2 lq = rot((mod(gi, 2.) * 2. - 1.) * (.9 + .3 * h) + .06 * sin(t * 1.2 + gi)) * (q - vec2(gx, gy));
      float lc = cv(lens(lq, .05, .021), qp) * step(abs(gx), .93);
      vec3 leaf = mix(uGround, h < .33 ? uC1 : h < .66 ? uC2 : uC3, .6) * (.8 + .3 * smoothstep(-.015, .015, lq.x));
      leaf = mix(leaf, leaf * .6, cv(abs(lq.x) - .003, qp));
      col = mix(col, leaf, lc);
    }
    c = mix(c, col, amt(1.));
  }
  // On it: three candles to the left, pumpkins and a gourd to the right.
  float halo = 0.;
  for (int i = 0; i < 3; i++) {
    float fi = float(i), tall = .22 + .1 * step(.5, fi) - .15 * step(1.5, fi);
    vec2 fq = q - vec2(-.82 + .13 * fi, 1.09 + tall + .045);
    halo += exp(-length(fq * vec2(1., .8)) * 16.) * (.88 + .12 * sin(t * 7.3 + fi * 2.) * sin(t * 3.1 + fi * 5.));
  }
  c = mix(c, warm, amt(halo * .22));
  if (q.x > -.98 && q.x < -.5 && q.y > 1.07 && q.y < 1.58) {
    vec3 col = c;
    for (int i = 0; i < 3; i++) {
      float fi = float(i), tall = .22 + .1 * step(.5, fi) - .15 * step(1.5, fi), hw = .036 - .004 * fi;
      vec2 cq = q - vec2(-.82 + .13 * fi, 1.09);
      float body = min(box(cq - vec2(0., tall * .5), vec2(hw, tall * .5)) - .004, box(cq - vec2(hw * .45, tall - .025), vec2(.006, .025)) - .006);
      float cx = cq.x / hw;
      vec3 wax = mix(uGround, uC3, .55) * (.62 + .28 * (1. - cx * cx) + .18 * smoothstep(-1., 1., cx));
      wax = mix(wax, mix(uC3, uC1, .3), .45 * smoothstep(tall - .08, tall, cq.y));
      col = mix(col, wax, cv(body, qp));
      col = mix(col, mix(uC3, uC1, .2) * .85, cv(oval(cq - vec2(0., tall - .002), vec2(hw * .85, .008)), qp));
      col = mix(col, uGround, cv(seg(cq, vec2(0., tall), vec2(.003, tall + .022)) - .003, qp));
      float gl = .88 + .12 * sin(t * 7.3 + fi * 2.) * sin(t * 3.1 + fi * 5.);
      vec2 fq = cq - vec2(0., tall + .016);
      fq.x -= (.012 * sin(t * 2.3 + fi * 2.) + .006 * sin(t * 7.1 + fi)) * fq.y / .06;
      vec2 fe = vec2(fq.x / (1. - .75 * smoothstep(.0, .08, fq.y)), fq.y - .03);
      float fd = oval(fe, vec2(.016, .04 * gl));
      vec3 fc = mix(uC1, uC3, smoothstep(.04, -.02, fd + fq.y * .4));
      col = mix(col, fc, cv(fd, qp));
    }
    c = mix(c, col, amt(1.));
  }
  if (q.x > .2 && q.x < .98 && q.y > 1.07 && q.y < 1.48) {
    vec4 pk = pumpkin(q - vec2(.44, 1.205), vec2(.17, .118), mix(uGround, uC1, .78), qp);
    vec4 pw = pumpkin(q - vec2(.66, 1.165), vec2(.105, .078), mix(uGround, uC3, .62), qp);
    vec2 gq = q - vec2(.82, 1.09);
    float gd = min(oval(gq - vec2(0., .07), vec2(.065, .07)), oval(gq - vec2(-.012, .17), vec2(.036, .06)));
    vec3 gc = mix(mix(uGround, uC3, .6), mix(uGround, uC1, .7), smoothstep(.1, .06, gq.y)) * (.75 + .35 * smoothstep(.06, -.06, gq.x));
    vec3 col = mix(c, gc, cv(gd, qp));
    col = mix(col, mix(uGround, mix(vec3(.3, .55, .25), uC1, .35), .45), cv(box(rot(-.3) * (gq - vec2(-.02, .235)), vec2(.007, .02)), qp));
    col = mix(col, pw.rgb, pw.a);
    col = mix(col, pk.rgb, pk.a);
    vec2 sl = rot(1.2) * (q - vec2(.29, 1.1));
    col = mix(col, mix(uGround, uC2, .6), cv(lens(sl, .045, .018), qp));
    c = mix(c, col, amt(1.));
  }

  // A basket of logs by the hearth.
  vec2 bk = r - vec2(.46, fl - .045);
  float basket = max(abs(bk.x) - .06 - .12 * bk.y, abs(bk.y - .03) - .03) - .004;
  vec3 weave = mix(uGround, mix(uC1, uC3, .3), .3) * (.84 + .16 * sin(bk.x * 280.) * sin(bk.y * 470.)) * (.75 + .4 * smoothstep(.06, -.06, bk.x));
  weave = mix(weave, weave * 1.2, cover(abs(bk.y - .058) - .004));
  c = mix(c, uGround, amt(.4 * smoothstep(.02, -.02, oval(bk - vec2(-.01, -.002), vec2(.085, .01)))));
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 o = bk - vec2(-.035 + .023 * fi + .006 * sin(fi * 3.), .068 + .014 * mod(fi, 2.));
    float d = length(o) - .016;
    vec3 end = mix(uGround, mix(uC3, uC1, .45), .42) * (.85 + .15 * sin(length(o) * 600.)) * (.8 + .3 * smoothstep(.02, -.02, o.x));
    c = mix(c, mix(end, wood * .8, smoothstep(-.004, -.001, d)), amt(cover(d)));
  }
  c = mix(c, weave, amt(cover(basket)));
  face = mix(face, .8, cover(basket));

  // A side table under the window: two books, a mug of cider and its steam.
  vec2 tb = r - vec2(-.83, fl);
  float table = min(min(box(tb - vec2(0., .13), vec2(.065, .006)) - .003, box(tb - vec2(0., .06), vec2(.007, .07))), oval(tb - vec2(0., -.012), vec2(.04, .007)));
  c = mix(c, uGround, amt(.35 * smoothstep(.02, -.02, oval(tb - vec2(.01, -.014), vec2(.07, .01)))));
  c = mix(c, wood * (.8 + .3 * smoothstep(.03, -.03, tb.x)), amt(cover(table)));
  float book1 = box(tb - vec2(-.005, .147), vec2(.05, .008)) - .002, book2 = box(tb - vec2(.004, .164), vec2(.043, .007)) - .002;
  c = mix(c, mix(uGround, uC2, .6), amt(cover(book1)));
  c = mix(c, mix(uGround, uC3, .45), amt(cover(box(tb - vec2(.04, .147), vec2(.008, .006)))));
  c = mix(c, mix(uGround, uC1, .55), amt(cover(book2)));
  c = mix(c, mix(uGround, uC3, .45), amt(cover(box(tb - vec2(.04, .164), vec2(.005, .005)))));
  vec2 mg = tb - vec2(0., .19);
  float mug = min(box(mg, vec2(.013, .015)) - .002, abs(length(mg - vec2(.016, .002)) - .007) - .0022);
  c = mix(c, mix(uGround, uC3, .55) * (.75 + .3 * smoothstep(.015, -.015, mg.x)), amt(cover(mug)));
  if (abs(mg.x) < .03 && mg.y > .01 && mg.y < .14) {
    float st = 0.;
    for (int i = 0; i < 2; i++) {
      float fi = float(i), y = mg.y - .018;
      float x = mg.x + .004 - fi * .008 - .008 * sin(y * 55. - t * 1.7 + fi * 2.) * smoothstep(0., .06, y);
      st += exp(-x * x * 80000.) * smoothstep(0., .02, y) * smoothstep(.11, .03, y);
    }
    c = mix(c, mix(uC3, c, .4), amt(st * .25));
  }

  // The armchair: a wingback with a tufted cushion, rolled arms, a seat cushion and a skirted base on short legs, a throw
  // over the far arm and a cushion in the corner; the side toward the fire warm, the far side in shadow.
  vec2 a = (r - vec2(-.57, fl - .045)) / .26, am = vec2(abs(a.x) - .53, a.y), th = a - vec2(-.53, 0.);
  float legs = box(vec2(abs(a.x) - .52, a.y - .035), vec2(.028, .04)) - .006;
  float back = max(max(abs(a.x) - .5 - .1 * smoothstep(.5, .85, a.y) + .07 * smoothstep(.92, 1.12, a.y), .12 - a.y), a.y - 1.13 + .12 * a.x * a.x + .1 * smoothstep(.3, .62, abs(a.x)));
  float pillow = max(box(a - vec2(0., .7), vec2(.29, .26)) - .07, a.y - .94 - .06 * cos(a.x * 2.4));
  float seat = box(a - vec2(0., .41), vec2(.38, .05)) - .035, skirt = box(a - vec2(0., .18), vec2(.62, .1)) - .025;
  float roll = length(am - vec2(0., .6)), arms = min(box(am - vec2(0., .36), vec2(.15, .24)), roll - .15);
  float chair = min(min(back, arms), skirt);
  vec3 fab = mix(uGround, uC2, .5);
  float lit = smoothstep(-.8, .8, a.x), nx = clamp(am.x / .15, -1., 1.) * sign(a.x);
  c = mix(c, mix(uGround, wood, .8), amt(cover(legs)));
  vec3 ch = fab * (.5 + .3 * lit) * (1. + .3 * smoothstep(-.07, 0., back) * smoothstep(.8, 1., a.y)) * (1. - .25 * smoothstep(.42, .55, abs(a.x)) * (1. - lit * step(0., a.x)));
  ch = mix(ch, fab * (.66 + .32 * lit) * (1. - .3 * smoothstep(-.14, 0., pillow)) * (.9 + .15 * smoothstep(.45, .95, a.y)), cover(pillow));
  ch = mix(ch, ch * .7, cover(abs(pillow) - .008));
  float tuft = min(length(vec2(abs(abs(a.x) - .15), a.y - .62)), length(vec2(min(abs(a.x), abs(abs(a.x) - .3)), a.y - .82)));
  ch *= 1. - (.2 * smoothstep(.08, 0., tuft) + .3 * cover(tuft - .016)) * cover(pillow + .03);
  ch = mix(ch, fab * (.7 + .35 * lit) * (1. + .22 * smoothstep(.43, .48, a.y) - .12 * abs(a.x)), cover(seat));
  ch = mix(ch, fab * .56 * (.75 + .35 * lit), cover(skirt));
  ch = mix(ch, ch * .62, cover(abs(a.y - .29) - .009) * cover(skirt));
  // Each arm throws a soft shadow on the seat and back on its side away from the fire.
  ch *= 1. - .3 * smoothstep(.12, 0., abs(a.x - .29)) * smoothstep(.36, .42, a.y) * smoothstep(.8, .7, a.y);
  vec3 arm = fab * (.6 + .3 * lit) * (.82 + .18 * nx + .14 * (1. - nx * nx));
  arm *= 1. + .25 * smoothstep(.05, .15, am.y - .6 + .05 * nx) * step(.55, a.y);
  arm = mix(arm, arm * .7, cover(abs(roll - .085) - .007) * smoothstep(-.02, .02, (am.x * sign(a.x) + .03) * 1.5 - a.y + .6) + cover(roll - .02) * .6);
  ch = mix(ch, arm, cover(arms));
  ch = mix(ch, ch * .6, cover(abs(arms) - .006) * smoothstep(.64, .58, a.y) * smoothstep(.08, .12, a.y));
  // The throw: plaid, over the far arm and down its front, its fringe hanging.
  float hem = .4 + .03 * sin(th.x * 26. + 1.);
  float throwD = max(min(box(th - vec2(0., .52), vec2(.17, .12)) - .02, length(th - vec2(0., .61)) - .175), hem - th.y);
  vec3 plaid = mix(uGround, uC3, .36) * (.72 + .3 * smoothstep(-.17, .17, th.x)) * (.88 + .12 * cos(th.x * 40.));
  plaid = mix(plaid, mix(uGround, uC2, .5), .55 * max(cover(abs(fract(th.x * 7.) - .5) - .12), cover(abs(fract(th.y * 7.) - .5) - .12)));
  plaid = mix(plaid, mix(uGround, uC1, .55), .5 * cover(abs(fract(th.x * 7. + .5) - .5) - .035));
  plaid *= 1. - .25 * smoothstep(.62, .78, th.y + abs(th.x) * .3);
  float fringe = max((abs(fract(th.x * 45.) - .5) - .2) / 45., max(abs(th.x) - .17, abs(th.y - hem + .03) - .035));
  ch = mix(ch, plaid * .85, cover(fringe));
  ch = mix(ch, plaid, cover(throwD));
  // A cushion in the corner nearest the fire.
  vec2 cq = rot(-.25) * (a - vec2(.22, .6));
  float cush = box(cq, vec2(.11, .1)) - .05;
  vec3 cc = mix(uGround, mix(uC1, uC2, .3), .5) * (.72 + .38 * smoothstep(-.2, .2, cq.x + cq.y)) * (1. - .25 * smoothstep(-.08, .02, cush));
  cc = mix(cc, cc * .6, cover(length(cq) - .02) + cover(abs(cush) - .006));
  ch = mix(ch, cc, cover(cush));
  c = mix(c, ch, amt(cover(min(min(chair, fringe), min(cush, throwD)))));
  face = mix(face, .25 + .75 * lit, cover(chair));

  // The braided rug, ring on ring.
  vec2 re = (r - vec2(-.3, .058)) / vec2(.29, .046);
  float er = length(re), band = floor(er * 6.);
  float br = .5 + .5 * sin(re.x * 70. + (mod(band, 2.) * 2. - 1.) * fract(er * 6.) * 6.2832);
  vec3 rug = mix(uGround, mod(band, 3.) < .5 ? uC2 : mod(band, 3.) < 1.5 ? mix(uC1, uC2, .5) : mix(uC3, uC2, .55), .26 + .06 * br);
  rug = mix(rug, uGround, .3 * lineAt(er * 6.));
  rug *= .8 + .3 * smoothstep(-.6, .6, re.x);
  c = mix(c, rug, amt(cover((er - 1.) * .046)));
  face = mix(face, 1., cover((er - 1.) * .046));
  // The cat, curled up asleep and breathing slowly, head down by the fire; now and then an ear twitches or the tail moves.
  vec2 kq = (r - vec2(-.27, .08)) / .058;
  float breath = 1. + .06 * sin(t * 1.25);
  float tw = fract(t * .13 + .3), twitch = sin(tw * 90.) * step(tw, .035) * .35;
  float ft = fract(t * .09), tip = sin(ft * 40.) * step(ft, .08) * .15;
  vec2 kb = (kq - vec2(-.1, .02)) / vec2(1., .62 * breath), hq = kq - vec2(.78, -.14);
  float kbody = max(min(oval(kq - vec2(-.1, .02 + .62 * (breath - 1.)), vec2(1., .62 * breath)), oval(kq - vec2(-.55, .15 + .48 * (breath - 1.)), vec2(.5, .48 * breath))), -kq.y - .5);
  float head = oval(hq, vec2(.37, .32));
  vec2 e1 = rot(.45) * (hq - vec2(-.2, .19)), e2 = rot(-.25 + twitch) * (hq - vec2(.15, .22));
  float ears = min(tri(e1, .13, .25), tri(e2, .13, .25)), inner = min(tri(e1 - vec2(0., .03), .065, .15), tri(e2 - vec2(0., .03), .065, .15));
  float ktail = min(min(seg(kq, vec2(-.98, -.12), vec2(-.62, -.46)), seg(kq, vec2(-.62, -.46), vec2(.15, -.55))) - .105, seg(kq, vec2(.15, -.55), vec2(.5, -.38 + tip)) - .085);
  float paws = min(oval(kq - vec2(.62, -.47), vec2(.14, .075)), oval(kq - vec2(.92, -.46), vec2(.13, .07)));
  float kat = min(min(kbody, head), min(ears, min(ktail, paws)));
  c = mix(c, uGround, amt(.4 * smoothstep(.15, -.1, oval(kq - vec2(-.1, -.5), vec2(1.3, .22)))));
  float kang = atan(kb.y + .55, kb.x + .10001);
  float stripe = smoothstep(.2, .8, sin(kang * 9. + 1.2 * sin(kang * 2.5 + 1.))) * smoothstep(.45, .85, length(kb));
  vec3 fur = mix(uGround, uC1, .55), pale = mix(uGround, uC3, .58);
  vec3 cat = fur * (.66 + .42 * smoothstep(-.7, .8, kq.x * .45 + kq.y)) * (1. - .32 * stripe);
  cat = mix(cat, fur * .45, cover(ktail - .03));
  cat = mix(cat, fur * (.58 + .2 * smoothstep(-.64, -.42, kq.y)) * (1. - .3 * smoothstep(.4, .9, sin((kq.x + kq.y * .6) * 9.)) - .25 * smoothstep(.3, .5, kq.x)), cover(ktail));
  cat = mix(cat, fur * .5, cover(head - .03));
  cat = mix(cat, fur * (.8 + .32 * smoothstep(-.3, .35, hq.x * .6 + hq.y)) * (1. - .22 * smoothstep(.4, .9, sin(hq.x * 24.)) * smoothstep(.06, .24, hq.y)), cover(head));
  cat = mix(cat, fur * (.85 + .25 * smoothstep(-.1, .2, hq.x)), cover(ears));
  cat = mix(cat, mix(uGround, mix(uC2, uC3, .5), .62), cover(inner));
  cat = mix(cat, pale, cover(oval(hq - vec2(.05, -.13), vec2(.17, .1))));
  cat = mix(cat, pale * .95, cover(paws));
  float eyes = max(abs(length(vec2(abs(hq.x - .04) - .13, hq.y + .01)) - .055) - .014, hq.y + .01);
  cat = mix(cat, fur * .28, cover(min(eyes, oval(hq - vec2(.05, -.085), vec2(.032, .02)))));
  c = mix(c, cat, amt(cover(kat)));
  face = mix(face, .4 + .6 * smoothstep(-.8, .8, kq.x), cover(kat));

  // The firelight on the room: a little, nearest the fire and on what faces it, rising and falling with it; dusk at the edges.
  c = mix(c, mix(uC1, uC2, .35), amt(.17 * exp(-length(L) * 2.6) * flick * face));
  c *= 1. + warm * amt(.7) * fall * face;
  c = mix(c, warm * .8, amt(.1 * fall * fall * face));
  vec2 vg = (vUv - vec2(.55, .45)) * vec2(1.5, 1.1);
  c = mix(c, uGround, .35 * smoothstep(.45, 1.1, length(vg)));
  gl_FragColor = vec4(dither(c), 1.);
}`;

// Point scenes: soft round dots in 3D, moved in the vertex shader.
const DOT = `
varying vec3 vColor;
varying float vAlpha;
void main() { gl_FragColor = vec4(vColor, vAlpha * (1. - smoothstep(.15, .5, length(gl_PointCoord - .5)))); }`;
// A field of dots seen from just above, rolling in long low swells; crests pick up the third color.
const WAVES = `${COMMON}
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 p = position;
  float w = sin(p.x * .9 + uTime * .35) * .18 + sin(p.z * 1.3 - uTime * .25 + p.x * .4) * .14 + sin((p.x + p.z) * 2.1 + uTime * .5) * .04;
  p.y += w;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * (9. + 7. * uAmount) / -mv.z;
  vColor = mix(mix(uC1, uC2, smoothstep(-4., 4., p.x)), uC3, smoothstep(.05, .3, w) * .6);
  vAlpha = smoothstep(-7., -1., p.z) * (1. - smoothstep(.5, 1.5, p.z)) * (.4 + .6 * uAmount);
}`;
// Motes rising slowly through a deep box, swaying and glinting; they fade out before they wrap.
const DUST = `${COMMON}
attribute float seed;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 p = position;
  p.y = mod(p.y + 4. + uTime * (.04 + seed * .05), 8.) - 4.;
  p.x += sin(uTime * .15 + seed * 6.283) * .25;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * (30. + seed * 40.) * (.8 + .5 * uAmount) / -mv.z;
  vColor = seed < .4 ? uC1 : seed < .75 ? uC2 : uC3;
  vAlpha = (.45 + .3 * sin(uTime * .6 + seed * 40.)) * (1. - smoothstep(3.2, 4., abs(p.y))) * (.7 + .8 * uAmount);
}`;

const grid = () => {
  const pts = [];
  for (let i = 0; i < 160; i++) for (let j = 0; j < 80; j++) pts.push(-7 + (i * 14) / 159, 0, -7 + (j * 8.5) / 79);
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3));
};
const motes = () => {
  const pts = [];
  const seeds = [];
  for (let i = 0; i < 240; i++) {
    pts.push((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, -Math.random() * 6);
    seeds.push(Math.random());
  }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3)).setAttribute('seed', new Float32BufferAttribute(seeds, 1));
};
const perspective = (y, lookY, lookZ) => {
  const c = new PerspectiveCamera(50, 1, 0.1, 20);
  c.position.set(0, y, 2.4);
  c.lookAt(0, lookY, lookZ);
  return c;
};
const flat = (scale, frag) => ({ scale, make: (m) => [new Mesh(new PlaneGeometry(2, 2), m(FLAT_VERT, frag)), new OrthographicCamera()] });

// ---- layers (bg.kind "layers") ----------------------------------------------------------------------------------------
// Up to four of Glaze's own layers drawn into one canvas, bottom first. Every layer writes premultiplied colour and alpha
// (rgb * a, a) and its blend mode is the GL blend function that does the rest: normal (1, 1-a), add (1, 1), screen
// (1, 1-src) and multiply (dst, 1-a). A scene layer is the whole scene, ground included, as an image editor would have it:
// lay it over something with add or screen, or at less than full amount. Amount is a layer's opacity; the Look's intensity
// still sets how far colours sit from the ground (dim) and what the scenes inside do with their colours (uAmount).
const BLEND = {
  normal: [OneFactor, OneMinusSrcAlphaFactor], add: [OneFactor, OneFactor],
  screen: [OneFactor, OneMinusSrcColorFactor], multiply: [DstColorFactor, OneMinusSrcAlphaFactor],
};
const SHAPES = ['dot', 'star', 'snow', 'heart', 'leaf', 'spark'];
const STYLES = ['linear', 'radial', 'conic'];
// A built-in scene's own fragment shader, run as a layer: its main() is renamed and its colour premultiplied by the amount.
const layered = (frag) => `uniform float uLayer;\n#define main gz_main\n${frag}\n#undef main\nvoid main() { gz_main(); gl_FragColor = vec4(gl_FragColor.rgb * gl_FragColor.a * uLayer, gl_FragColor.a * uLayer); }`;
// Clouds of the three colours, see-through where there are none.
const NOISE = `${FLAT}
uniform float uLayer, uFreq;
void main() {
  vec2 p = vUv * vec2(uAspect, 1.) * uFreq;
  float t = uTime * .04;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  float n = fbm(p + 2. * q + vec2(t * .5, -t * .3));
  vec3 c = mix(mix(uC1, uC2, smoothstep(.25, .65, n)), uC3, smoothstep(.45, .9, q.x));
  float a = smoothstep(.3, .8, n) * uLayer;
  gl_FragColor = vec4(dither(c) * a, a);
}`;
// 2 to 4 colours, evenly spaced along a line, out from the middle, or round (conic closes on its first colour). CSS angles.
const GRADIENT = `${FLAT}
uniform vec3 uC4, uC5;
uniform float uLayer, uAngle, uStops;
vec3 ramp(float t) {
  t = clamp(t, 0., 1.) * (uStops - 1.);
  vec3 c = mix(uC1, uC2, clamp(t, 0., 1.));
  c = mix(c, uC3, clamp(t - 1., 0., 1.));
  c = mix(c, uC4, clamp(t - 2., 0., 1.));
  return mix(c, uC5, clamp(t - 3., 0., 1.));
}
void main() {
  vec2 p = (vUv - .5) * vec2(uAspect, 1.);
  vec2 d = vec2(sin(uAngle), cos(uAngle));
#if STYLE == 0
  float t = dot(p, d) / (abs(d.x) * uAspect + abs(d.y)) + .5;
#elif STYLE == 1
  float t = length(p) / (.5 * length(vec2(uAspect, 1.)));
#else
  float t = fract(atan(p.x, p.y) / 6.2831853 - uAngle / 6.2831853 + 1.);
#endif
  gl_FragColor = vec4(dither(ramp(t)) * uLayer, uLayer);
}`;
// Particles: points on a unit square that wraps a little past the screen, moved in the vertex shader. seed is three random
// numbers per particle: its pace and size, its phase and spin, which colour it takes.
const PARTICLE_VERT = `${COMMON}
attribute vec3 seed;
uniform float uLayer, uPt, uSpeed, uDir, uTwinkle;
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
void main() {
  vec2 sc = vec2(1. / uAspect, 1.);
  vec2 p = position.xy + vec2(sin(uDir), cos(uDir)) * sc * uSpeed * (.5 + seed.x) * uTime;
#if SHAPE == 2
  p += vec2(cos(uDir), -sin(uDir)) * sc * .012 * sin(uTime * (.3 + seed.x) + seed.y * 6.283);
#endif
  gl_Position = vec4((fract(p) * 1.24 - .12) * 2. - 1., 0., 1.);
  gl_PointSize = uPt * (.55 + .9 * seed.x);
  vColor = seed.z < .34 ? uC1 : seed.z < .67 ? uC2 : uC3;
  vAlpha = uLayer * (1. - uTwinkle * (.5 - .5 * sin(uTime * (.8 + 2.2 * seed.y) + seed.x * 40.)));
#if SHAPE == 4
  vRot = seed.y * 6.283 + uTime * (.4 + seed.x);
#elif SHAPE == 3
  vRot = .35 * sin(uTime * .5 + seed.y * 6.283);
#elif SHAPE == 1
  vRot = seed.y * 6.283 + uTime * .3 * (seed.x - .5);
#else
  vRot = 0.;
#endif
}`;
const PARTICLE_FRAG = `
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
uniform float uPt;
float dot2(vec2 v) { return dot(v, v); }
// A five-point star (outer radius r, inner ratio rf) and a heart, as signed distances: negative inside.
float sdStar(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(.809016994, -.587785252);
  const vec2 k2 = vec2(-.809016994, -.587785252);
  p.x = abs(p.x);
  p -= 2. * max(dot(k1, p), 0.) * k1;
  p -= 2. * max(dot(k2, p), 0.) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(.587785252, .809016994) - vec2(0., 1.);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0., r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.) return sqrt(dot2(p - vec2(.25, .75))) - .35355339;
  return sqrt(min(dot2(p - vec2(0., 1.)), dot2(p - .5 * max(p.x + p.y, 0.)))) * sign(p.x - p.y);
}
// A lens with points at (0, +-b).
float sdLeaf(vec2 p, float r, float d) {
  p = abs(p);
  float b = sqrt(r * r - d * d);
  return (p.y - b) * d > p.x * b ? length(p - vec2(0., b)) : length(p - vec2(-d, 0.)) - r;
}
void main() {
  vec2 p = (gl_PointCoord - .5) * vec2(2., -2.);
  float c = cos(vRot), s = sin(vRot);
  p = mat2(c, s, -s, c) * p;
  float w = 2.5 / max(uPt, 2.);
  float a;
#if SHAPE == 0
  a = 1. - smoothstep(.45, .85, length(p));
#elif SHAPE == 1
  a = 1. - smoothstep(-w, w, sdStar(p, .95, .5));
#elif SHAPE == 2
  a = pow(max(1. - length(p), 0.), 1.4);
#elif SHAPE == 3
  a = 1. - smoothstep(-w, w, sdHeart(vec2(p.x, p.y + .6) * .7) / .7);
#elif SHAPE == 4
  float leaf = sdLeaf(p * .62, 1.2, .85) / .62;
  a = (1. - smoothstep(-w, w, leaf)) * (1. - .4 * (1. - smoothstep(0., .05, abs(p.x))));
#else
  a = (1. - smoothstep(.55, 1., sqrt(abs(p.x)) + sqrt(abs(p.y)))) + .5 * exp(-dot(p, p) * 12.);
#endif
  a = clamp(a, 0., 1.) * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}`;
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
// A palette name (accent, ink-muted, …) or #rrggbb. The caller's palette is the map of --gz-* variables it already has.
const hexOf = (c, palette) => (typeof c === 'string' && (/^#[0-9a-f]{6}$/i.test(c) ? c : palette?.[`--gz-${c}`])) || '';
// A layer's colours: its own (one white is all white, two alternate), or the Look's three when it names none. [list, how many
// were its own].
const tints = (l, o) => {
  const own = (Array.isArray(l.c) ? l.c : []).slice(0, 4).map((c) => hexOf(c, o.palette)).filter(Boolean);
  return [own.length ? Array.from({ length: 5 }, (_, i) => own[i % own.length]) : o.colors, own.length];
};
// What changes a layer's program or geometry; everything else is a uniform and changes without rebuilding.
const layerKey = (ls) => ls.map((l) => [l.k, l.name, l.style, l.shape, l.count, l.blend].join('/')).join('|');
const LAYER_KINDS = ['scene', 'noise', 'gradient', 'particles'];
// One layer: its own uniforms (shared ones are the same objects as the scene's), mesh, camera and blend. paint(spec, o, ground)
// sets what the spec says; fit(scale) fits a particle's size to the drawing buffer.
const layerPart = (spec, U, maxPt) => {
  const u = { ...U, uTime: { value: 0 }, uLayer: { value: 1 }, uC1: { value: new Color() }, uC2: { value: new Color() }, uC3: { value: new Color() } };
  const [src, dst] = BLEND[spec.blend] || BLEND.normal;
  const m = (vertexShader, fragmentShader, defines = {}) => new ShaderMaterial({ uniforms: u, vertexShader, fragmentShader, defines, transparent: true, blending: CustomBlending, blendEquation: AddEquation, blendSrc: src, blendDst: dst, depthTest: false, depthWrite: false });
  const part = { u, rate: 1, fit: () => {}, paint: () => {} };
  const tint = (list, o, ground) => ['uC1', 'uC2', 'uC3', 'uC4', 'uC5'].forEach((k, i) => u[k] && list[i] && u[k].value.set(list[i]).lerp(ground, o.dim));
  const quad = (frag, defines) => { part.camera = new OrthographicCamera(); return new Mesh(new PlaneGeometry(2, 2), m(FLAT_VERT, frag, defines)); };
  if (spec.k === 'scene') {
    const def = SCENES[spec.name] || SCENES.mist;
    [part.object, part.camera] = def.make((v, f) => m(v, layered(f)));
    part.scale = def.scale;
    part.paint = (l, o, ground) => tint(tints(l, o)[0], o, ground);
  } else if (spec.k === 'noise') {
    u.uFreq = { value: 1 };
    part.object = quad(NOISE);
    part.scale = 0.3;
    part.paint = (l, o, ground) => { tint(tints(l, o)[0], o, ground); u.uFreq.value = 6 * 0.1 ** (num(l.scale, 1, 100, 40) / 100); };
  } else if (spec.k === 'gradient') {
    Object.assign(u, { uC4: { value: new Color() }, uC5: { value: new Color() }, uAngle: { value: 0 }, uStops: { value: 2 } });
    const style = Math.max(0, STYLES.indexOf(spec.style));
    part.object = quad(GRADIENT, { STYLE: style });
    part.scale = 0.2;
    part.paint = (l, o, ground) => {
      const [list, own] = tints(l, o);
      const stops = list.slice(0, Math.min(Math.max(own, 2), 4));
      if (style === 2) stops.push(stops[0]);
      tint([...stops, ...Array(5 - stops.length).fill(stops.at(-1))], o, ground);
      u.uStops.value = stops.length;
      u.uAngle.value = (num(l.angle, 0, 360, 135) * Math.PI) / 180;
    };
  } else {
    const n = Math.round(num(spec.count, 1, 400, 60));
    const pts = [], seeds = [];
    for (let i = 0; i < n; i++) { pts.push(Math.random(), Math.random(), 0); seeds.push(Math.random(), Math.random(), Math.random()); }
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3)).setAttribute('seed', new Float32BufferAttribute(seeds, 3));
    Object.assign(u, { uPt: { value: 8 }, uSpeed: { value: 0.04 }, uDir: { value: Math.PI }, uTwinkle: { value: 0 } });
    part.camera = new OrthographicCamera();
    part.object = new Points(geometry, m(PARTICLE_VERT, PARTICLE_FRAG, { SHAPE: Math.max(0, SHAPES.indexOf(spec.shape)) }));
    part.scale = 0.5;
    let size = 6;
    part.fit = (scale) => { u.uPt.value = Math.min(size * scale, maxPt / 1.5); };
    part.paint = (l, o, ground) => {
      tint(tints(l, o)[0], o, ground);
      size = num(l.size, 1, 64, 6);
      u.uDir.value = (num(l.drift, 0, 360, 180) * Math.PI) / 180;
      u.uTwinkle.value = num(l.twinkle, 0, 100, 0) / 100;
    };
  }
  return part;
};

// -- budget guard
// A frame budget for every background. Wall-clock only: timer queries are often missing. The evidence is the latency of a
// GPU fence: after the draw, fenceSync and flush, then poll it from a MessageChannel (no 4 ms timer clamp, and the page
// stays responsive) until it signals. That is the GPU's time for the frame plus about 0.7 ms of plumbing (r = 0.9988 against
// EXT_disjoint_timer_query_webgl2 in spike S2). Frame cadence can't see it (rAF held 33 ms for shaders up to 16 ms of GPU
// time) and gl.finish() doesn't block in Chrome. Polling spins the main thread for as long as the GPU takes, so only some
// frames are sampled, and none is drawn while the tab is hidden.
// It only steps down: a scale, then a still frame, then the gradient. A transient load must not make a background flap, and
// a new page load starts over. A student's shader first draws a 72x45 probe frame (a pathological one never gets a full one).
const TUNE = {
  probeScale: 0.05, // the probe frame: 72x45 on a 1440x900 screen
  probeFail: 250, // ms: a probe frame this slow is not shown at all (gradient)
  probeSmall: 15, // ms: this slow starts at the smaller scale (a full frame is 8 to 15x the probe on a GPU, and 140x on a CPU renderer)
  probeStill: 40, // ms: this slow gets one still frame at most
  budget: 12, // ms of GPU time a frame may take: about a third of a 30 fps frame, 5x the dearest built-in scene on an M5 Pro
  cap: 100, // ms: stop waiting for a fence; the frame counts as this long and steps down at once
  warm: 2, // frames after a level starts that don't count (the first draw builds the pipeline)
  window: 5, // samples whose median is judged
  fast: 8, // after a level starts, sample every frame for this many, then one in `every`
  every: 8,
  quiet: 40, // once a level has passed `settled` windows, one frame in this many
  settled: 2,
  gap: 25, // ms: if the event loop was blocked longer than this while waiting on a fence, a late reading is jank, not the GPU
  noisy: 10, // jank-tainted probe frames before falling back without a full-size draw
  lateFor: 3000, // ms: over budget and late on every sampled frame for this long, and the page itself is too slow
};
// levels: [{ scale, still? }], best first. apply(level) resizes and redraws; fail('budget', ms) when none is left;
// step(report) hears every change. probe: start before level 0 with the probe frame.
const budgetGuard = (gl, levels, { probe = false, apply, fail, step = () => {}, tune = {} }) => {
  const T = { ...TUNE, ...tune };
  const mc = new MessageChannel();
  let level = probe ? -1 : 0;
  let frames = 0; // drawn frames at this level
  let samples = [];
  let passed = 0; // windows at this level that came in under budget
  let ignored = 0; // jank-tainted probe frames
  let lateSince = 0; // when the current run of jank-tainted readings over budget began
  let waiting = false;
  let dead = false;
  let fence = null;
  const clearFence = () => { if (fence) { try { gl.deleteSync(fence); } catch {} fence = null; } waiting = false; };
  const kill = () => { if (dead) return; dead = true; clearFence(); mc.port1.onmessage = null; mc.port1.close(); mc.port2.close(); };
  const to = (l, why, ms) => {
    samples = []; frames = 0; passed = 0; lateSince = 0;
    const at = levels[l] || { scale: 0, still: true };
    step({ level: l, scale: at.scale, still: !!at.still, ms: ms == null ? null : Math.round(ms * 10) / 10, why });
    if (l >= levels.length) { kill(); return fail('budget', ms); }
    level = l;
    apply(levels[l]);
  };
  // Unmeasured student code must never graduate to a full frame.
  const quit = () => { if (probe) return to(levels.length, 'probe-unmeasured', 0); kill(); };
  const judge = (ms, tainted) => {
    if (level < 0 && ms >= T.probeFail) return to(levels.length, 'probe', ms);
    // A reading that is only an upper bound (the loop was blocked) and is over budget says nothing about the GPU, unless it
    // keeps coming: a page that is late on every sampled frame for seconds is too slow as it is. A CPU renderer does that to
    // the main thread (measured: a heavy shader's every reading was tainted, and the guard waited for ever).
    if (!tainted) lateSince = 0;
    else if (ms > T.budget) {
      lateSince ||= performance.now();
      if (performance.now() - lateSince >= T.lateFor) return to(level + 1, 'late', ms);
      if (level < 0 && ++ignored >= T.noisy) return to(levels.length, 'probe-noisy', ms);
      return;
    }
    if (level < 0) {
      // The probe's first frame builds the pipeline; a second affordable frame decides the visible level.
      if (frames <= 1) return;
      return to(ms >= T.probeStill ? levels.length - 1 : ms >= T.probeSmall ? 1 : 0, 'probe', ms);
    }
    if (frames <= T.warm) return;
    if (ms >= T.cap) return to(level + 1, 'stalled', ms);
    samples.push(ms);
    if (samples.length > T.window) samples.shift();
    if (samples.length < T.window) return;
    const med = [...samples].sort((a, b) => a - b)[T.window >> 1];
    if (med > T.budget) return to(level + 1, 'over', med);
    passed++;
  };
  // Called by the draw loop right after the draw call.
  const sample = (started = performance.now()) => {
    if (dead || waiting || gl.isContextLost()) return;
    frames++;
    if (!(level < 0 || frames <= T.fast || frames % (passed >= T.settled ? T.quiet : T.every) === 0)) return;
    try { fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); } catch { return quit(); }
    if (!fence) return quit();
    gl.flush();
    waiting = true;
    const t0 = started;
    let prev = performance.now(); // submission time is measured, not mistaken for event-loop jank
    let tainted = false;
    const spin = () => {
      if (dead) { waiting = false; return; }
      try {
        if (gl.isContextLost()) { clearFence(); return; }
        const now = performance.now();
        const ms = now - t0;
        if (now - prev > T.gap) tainted = true;
        prev = now;
        if (gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED || ms >= (level < 0 ? T.probeFail : T.cap)) {
          clearFence();
          return judge(ms, tainted);
        }
      } catch { return quit(); }
      mc.port2.postMessage(0);
    };
    mc.port1.onmessage = spin;
    mc.port2.postMessage(0);
  };
  return {
    sample,
    // Back from a long pause (a hidden tab draws nothing): the first frames are cold, so they don't count.
    rest() { if (level >= 0) { samples = []; frames = 0; lateSince = 0; } },
    // Replaced or stopped: a sampled frame still on the GPU must not move the scene that came after it.
    kill,
    get level() { return level; },
    // While a sampled frame is still on the GPU the loop doesn't queue another: a slow shader can't build a backlog.
    get busy() { return waiting; },
    get scale() { return level < 0 ? T.probeScale : levels[level].scale; },
  };
};
// -- end budget guard

// scale: drawing-buffer pixels per CSS pixel. Pure blur gets by on very little; lines need more.
const SCENES = {
  mist: flat(0.25, MIST),
  orbs: flat(0.2, ORBS),
  borealis: flat(0.3, BOREALIS),
  lava: flat(0.25, LAVA),
  contours: flat(0.5, CONTOURS),
  horizon: flat(0.5, HORIZON),
  graveyard: flat(0.6, GRAVEYARD),
  pumpkins: flat(0.6, PUMPKINS),
  harvest: flat(0.6, HARVEST),
  turkeys: flat(0.6, TURKEYS),
  hearth: flat(0.6, HEARTH),
  // Follows the pointer a little (at most PARALLAX css px), while it animates.
  topography: { ...flat(0.5, TOPOGRAPHY), parallax: true },
  waves: { scale: 0.5, make: (m) => [new Points(grid(), m(WAVES, DOT, true)), perspective(1.1, 0, -1.5)] },
  dust: { scale: 0.5, make: (m) => [new Points(motes(), m(DUST, DOT, true)), perspective(0, 0, -2)] },
};

// In the editor's preview (an extension page in a frame of the options page) the parent page is told what happened, to say so:
// { gzSceneFailed: { why, errors, info } } once, { gzSceneStep: { level, scale, still, ms, why } } at each step of the guard.
const tell = (m) => { if (/-extension:$/.test(location.protocol) && parent !== window) parent.postMessage(m, location.origin); };

// opts: { kind, name, x, palette, ground, colors: [3 hex], dim: 0-1 toward the ground, amount: 0-1, speed: 0 for a still frame }.
//   kind 'shader' draws x.bg.shader.src and 'layers' draws x.bg.layers (x is the Look's parts, GZ_CTX.parts()); anything else
//   draws the built-in `name`. palette is the --gz-* map that layers' colour names are looked up in.
// onFail(why, errors, info) is called once, after the scene has stopped, when a background can't be shown; the caller keeps
// its gradient. why: 'refused' (looks/glsl.js said no: it never reached GL), 'compile' (this device's compiler said no),
// 'lost' (a student's shader, and the GL context went), 'budget' (over budget at the last step) or 'empty' (nothing to
// draw); or 'dropped' (a built-in scene or layers whose context the browser took and never gave back), which a new canvas
// can show again. errors: [{ line, message }], lines in the student's own source. info: { level, ms } for 'budget'.
//   clock: { t, at }: the scene is t seconds in at wall-clock time `at` (ms since the epoch), moving at speed from there; a
//   course tab's frame takes the page's (scene.clock), so its copy of the background shows the same moment. Omitted, the
//   scene keeps its own, starting at 0.
// onStep({ level, scale, still, ms, why }) hears every step the guard takes, so an editor can say what happened: level 0 is
// the best, one past the last is the gradient, ms is what was measured.
export const start = (canvas, live = () => true, onFail = () => {}, onStep = () => {}) => {
  const renderer = new WebGLRenderer({ canvas, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  const U = {
    uTime: { value: 0 }, uAspect: { value: 1 }, uPx: { value: 1 }, uAmount: { value: 0.5 },
    uGround: { value: new Color() }, uC1: { value: new Color() }, uC2: { value: new Color() }, uC3: { value: new Color() },
    uDim: { value: 0 }, uShift: { value: [0, 0] },
  };
  const material = (vertexShader, fragmentShader, transparent = false) => new ShaderMaterial({ uniforms: U, vertexShader, fragmentShader, transparent, depthTest: false, depthWrite: false });
  // A student's shader is ESSL 1.00 (glslVersion '100' on a raw material: three adds only `#version 100`), so ANGLE applies
  // the WebGL loop rules even though the context is WebGL2. The built-in scenes stay on three's ESSL 3.00 wrapper.
  const raw = (vertexShader, fragmentShader) => new RawShaderMaterial({ glslVersion: '100', uniforms: U, vertexShader, fragmentShader, depthTest: false, depthWrite: false });
  let name = '';
  let def = null;
  let parts = []; // [{ object, camera, scene, u, rate }] drawn in this order; u holds the uniforms its material reads
  let levels = [];
  let speed = 0;
  let raf = 0;
  let last = 0;
  let scale = 0.5; // drawing-buffer pixels per CSS pixel: the scene's own, less once the guard steps down
  let still = false; // the guard has stepped down to one still frame
  let g = null; // the budget guard
  let stopped = false;
  let failed = false;
  let needsSize = true;
  let clock = { t: 0, at: 0 };
  const wall = () => (performance.timeOrigin || 0) + performance.now();
  const timeNow = () => (clock.at ? clock.t + ((wall() - clock.at) / 1000) * speed : clock.t);
  const setTime = () => { if (still) return; const t = timeNow(); for (const p of parts) p.u.uTime.value = t * p.rate; };
  // The pointer's parallax: where it is headed (screen units), and whether the scene listens at all.
  let aim = [0, 0], following = false;
  // x, y in this window's pixels, read against where the canvas sits: in a course tab's frame it spans the page's viewport.
  const point = (x, y) => {
    const r = canvas.getBoundingClientRect?.() || { left: 0, top: 0, width: canvas.clientWidth || innerWidth, height: canvas.clientHeight || innerHeight };
    if (!r.width || !r.height) return;
    aim = [(((x - r.left) / r.width) * 2 - 1) * (PARALLAX / r.width), -(((y - r.top) / r.height) * 2 - 1) * (PARALLAX / r.height)];
  };
  const onPoint = (e) => { if (e.pointerType !== 'touch') point(e.clientX, e.clientY); };
  const follow = (on) => {
    if (on === following) return;
    following = on;
    (on ? addEventListener : removeEventListener)('pointermove', onPoint, { passive: true });
    if (!on) { aim = [0, 0]; U.uShift.value = [0, 0]; }
  };

  // A background that can't be shown. The scene stops on the next microtask (three calls onShaderError from inside render(),
  // and nothing may be disposed under it), then the caller hears why.
  const fail = (why, errors = [], info) => {
    if (failed || stopped) return;
    failed = true;
    queueMicrotask(() => { if (stopped) return; stop(); onFail(why, errors, info); tell({ gzSceneFailed: { why, errors, info } }); });
  };
  // Only a student's shader can be what hung the GPU, so only it is not brought back after a lost context. The built-in
  // scenes and layers keep three's own restore, but a browser may never give the context back: WebKit takes the oldest of
  // more than 16 for good, counting stopped ones until they are collected (each course tab shown again starts a new one).
  // Not back in 3 s, it is 'dropped', once on screen (a new context from a hidden page could take one that is showing).
  let lostAt = 0, lostTimer = 0;
  const syncFollow = () => follow(!!def?.parallax && speed > 0 && !still && !document.hidden && !lostAt);
  const dropped = () => { if (lostAt && !document.hidden) fail('dropped'); };
  const onLost = () => {
    if (def?.custom) return fail('lost', [{ line: 0, message: 'The graphics context was lost while drawing this shader. One that takes the GPU too long does that.' }]);
    lostAt = performance.now(); clearTimeout(lostTimer); lostTimer = setTimeout(dropped, 3000);
    syncFollow();
  };
  const onRestored = () => { lostAt = 0; clearTimeout(lostTimer); syncFollow(); g?.rest(); onResize(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  // Back from a hidden tab (which draws nothing) the first frames are cold. The page's own pace can't tell: on a CPU
  // renderer every frame is seconds apart.
  const onShow = () => {
    syncFollow();
    if (document.hidden) return;
    if (lostAt && performance.now() - lostAt >= 3000) return dropped();
    g?.rest(); onResize();
  };
  document.addEventListener('visibilitychange', onShow);
  // three calls this, during render(), when a program fails to compile or link.
  const onShader = (gl, program, vs, fs) => {
    const errors = def.G.parseLog(gl.getShaderInfoLog(fs), def.lines);
    const message = String(gl.getProgramInfoLog(program)).trim();
    fail('compile', errors.length ? errors : [{ line: 0, message: message ? 'The graphics driver rejected the shader. {message}' : 'The graphics driver rejected the shader.', ...(message && { vars: { message } }) }]);
  };
  const wantsLoop = () => (speed > 0 && !still) || g?.level < 0;
  // The guard moved to a level: its resolution, and whether it still animates.
  const apply = (lv) => {
    scale = lv.scale;
    still = !!lv.still;
    syncFollow();
    canvas.style.visibility = ''; // out of the probe
    needsSize = true;
    draw();
    if (!wantsLoop() && raf) { cancelAnimationFrame(raf); raf = 0; }
  };

  const size = () => {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), false);
    U.uAspect.value = w / h;
    U.uPx.value = (h * scale) / 1000;
    for (const p of parts) {
      p.fit?.(scale);
      if (p.camera.isPerspectiveCamera) { p.camera.aspect = w / h; p.camera.updateProjectionMatrix(); }
    }
  };
  const draw = () => {
    if (stopped || failed) return;
    if (!live()) return freeze();
    if (document.hidden) return;
    if (g?.busy) { if (!raf) raf = requestAnimationFrame(tick); return; }
    if (needsSize) { size(); needsSize = false; }
    const started = performance.now();
    if (parts.length > 1) renderer.clear(); // layers blend over each other: clear once, then draw each
    for (const p of parts) renderer.render(p.scene, p.camera);
    g?.sample(started);
  };
  const tick = (now) => {
    raf = 0;
    if (stopped || failed) return;
    if (!live()) return freeze();
    if (document.hidden) return;
    raf = requestAnimationFrame(tick);
    if (now - last < 1000 / FPS - 1 || g?.busy) return;
    setTime();
    if (following) {
      const k = 1 - Math.exp(-Math.min(now - last, 100) / 80), [x, y] = U.uShift.value;
      U.uShift.value = [x + (aim[0] - x) * k, y + (aim[1] - y) * k];
    }
    last = now;
    draw();
    if (!wantsLoop() && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  const onResize = () => {
    if (stopped || failed) return;
    if (!live()) return freeze();
    needsSize = true; draw();
    if (wantsLoop() && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  };
  addEventListener('resize', onResize);
  const drop = () => { for (const p of parts) { p.scene.remove(p.object); p.object.geometry.dispose(); p.object.material.dispose(); } parts = []; };
  // Cut off (Glaze reloaded under the tab): it stops drawing and keeps its last frame on screen until the page loads
  // again, rather than leaving the page bare. Switched off (stop), everything is freed.
  const freeze = () => {
    if (stopped) return;
    stopped = true;
    g?.kill(); // a late reading would resize the canvas, and the last frame with it
    cancelAnimationFrame(raf); raf = 0;
    removeEventListener('resize', onResize);
    follow(false);
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    clearTimeout(lostTimer);
    document.removeEventListener('visibilitychange', onShow);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    g?.kill();
    cancelAnimationFrame(raf); raf = 0;
    removeEventListener('resize', onResize);
    follow(false);
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    clearTimeout(lostTimer);
    document.removeEventListener('visibilitychange', onShow);
    drop();
    renderer.dispose();
    renderer.forceContextLoss();
  };
  // The guard needs a WebGL2 fence; without one (not seen, three itself needs WebGL2) nothing is measured.
  const arm = () => {
    const gl = renderer.getContext();
    if (g) return;
    if (typeof gl?.fenceSync !== 'function') { if (def.custom) fail('budget', [{ line: 0, message: 'This device cannot measure shader drawing time safely.' }]); return; }
    const over = (why, ms) => fail(why, [{ line: 0, message: `Drawing this took ${Math.round(ms)} ms a frame even at its lowest setting; a background gets ${TUNE.budget}.` }], { level: levels.length, ms: Math.round(ms * 10) / 10 });
    g = budgetGuard(gl, levels, { probe: !!def.custom, apply, fail: over, step: (s) => { onStep(s); tell({ gzSceneStep: s }); } });
    if (def.custom) canvas.style.visibility = 'hidden'; // the probe frame is a 72x45 stretch: not for show
    scale = g.scale;
  };

  return {
    update(o) {
      if (stopped || failed) return;
      if (!live()) return freeze();
      // A new speed starts from the time reached at the old one.
      if (o.clock) clock = { t: +o.clock.t || 0, at: +o.clock.at || 0 };
      else if (!clock.at || o.speed !== speed) clock = { t: timeNow(), at: wall() };
      speed = o.speed;
      const shader = o.kind === 'shader' ? o.x?.bg?.shader?.src : null;
      const layers = o.kind === 'layers' && Array.isArray(o.x?.bg?.layers) ? o.x.bg.layers.filter((l) => l && LAYER_KINDS.includes(l.k)).slice(0, 4) : null;
      if (o.kind === 'shader' ? typeof shader !== 'string' : o.kind === 'layers' && !layers?.length) return fail('empty', [{ line: 0, message: 'There is nothing to draw: this Look has no shader or layers.' }]);
      const key = shader !== null ? `shader:${shader}` : layers ? `layers:${layerKey(layers)}` : o.name;
      if (key !== name) {
        drop();
        name = key;
        g?.kill();
        g = null;
        still = false;
        if (shader !== null) {
          // A shader reaches GL only through here, and only after the checker has passed it (again: the sanitizer did once).
          const G = globalThis.GZ_GLSL;
          const checked = G ? G.check(shader) : { ok: false, errors: [{ line: 0, message: 'The shader checker (looks/glsl.js) is not loaded.' }] };
          if (!checked.ok) { name = ''; return fail('refused', checked.errors); }
          def = { scale: 0.6, custom: true, G, lines: shader.split('\n').length };
          parts = [{ object: new Mesh(new PlaneGeometry(2, 2), raw(G.VERT, G.wrap(shader))), camera: new OrthographicCamera(), u: U, rate: 1 }];
        } else if (layers) {
          const gl = renderer.getContext();
          const maxPt = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
          parts = layers.map((l) => layerPart(l, U, maxPt));
          def = { scale: Math.max(...parts.map((p) => p.scale)) };
        } else {
          def = SCENES[o.name] || SCENES.mist;
          const [object, camera] = def.make(material);
          parts = [{ object, camera, u: U, rate: 1 }];
        }
        for (const p of parts) { p.scene = new Scene(); p.object.frustumCulled = false; p.scene.add(p.object); }
        renderer.autoClear = parts.length < 2;
        renderer.debug.onShaderError = def.custom ? onShader : null; // a built-in's errors keep three's own log
        // The best level is the scene's own scale; then 0.2 if that is much bigger; then one still frame at the smaller.
        scale = def.scale;
        levels = [{ scale }, ...(scale >= 0.3 ? [{ scale: 0.2 }] : []), { scale: Math.min(scale, 0.2), still: true }];
      }
      // A built-in scene or layers hold one still frame without being measured: only a student's shader, and anything that
      // animates, is watched.
      if (parts.length && (def.custom || speed > 0)) arm();
      U.uGround.value.set(o.ground);
      if (layers) {
        parts.forEach((p, i) => {
          p.rate = num(layers[i].speed, 0, 200, 100) / 100;
          p.u.uLayer.value = num(layers[i].amount, 0, 100, 70) / 100;
          p.paint(layers[i], o, U.uGround.value);
        });
      } else [U.uC1, U.uC2, U.uC3].forEach((u, i) => u.value.set(o.colors[i]).lerp(U.uGround.value, o.dim));
      U.uAmount.value = o.amount;
      U.uDim.value = o.dim;
      syncFollow();
      renderer.setClearColor(U.uGround.value);
      setTime();
      needsSize = true;
      if (wantsLoop() && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
      if (!wantsLoop() && raf) { cancelAnimationFrame(raf); raf = 0; }
      draw();
    },
    draw,
    stop,
    // The pointer over the other document (a course tab's frame, or the page around it), in this window's pixels
    // (looks/scene-host.js passes it on), while the scene follows.
    point: (x, y) => { if (following) point(x, y); },
    get follows() { return following; },
    get clock() { return { ...clock }; },
  };
};
