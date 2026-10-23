// Glaze — animated backgrounds (bg.kind "scene", "shader" and "layers"). content.js imports this module only once
// someone picks one, and only in the top frame, so three.js costs nothing otherwise.
// Cheap on purpose: drawn at a fraction of the screen's resolution and stretched by the browser
// (the softness is the look), at most 30 frames a second, and all movement is worked out in the
// shaders from one time uniform, so a frame is one uniform write and one draw. Motion off draws a
// single still frame and stops; background tabs get no animation frames at all.
// What is drawn: a built-in scene, a student's own shader (lib/glsl.js checks and wraps it),
// or up to four layers blended bottom first. All of them run under the budget guard below.
// A retry must reload a failed dependency too: the browser remembers failed module URLs.
const {
  WebGLRenderer, Scene, OrthographicCamera, PerspectiveCamera, Mesh, Points, PlaneGeometry,
  BufferGeometry, Float32BufferAttribute, ShaderMaterial, RawShaderMaterial, Color, ColorManagement,
  CustomBlending, AddEquation, OneFactor, DstColorFactor, OneMinusSrcAlphaFactor, OneMinusSrcColorFactor,
} = await import(`./three.min.js${new URL(import.meta.url).search}`);

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
// motion off shows that frame. uShift is the pointer's parallax, in screen units (lib/scene.js eases it).
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
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
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
// its gradient. why: 'refused' (lib/glsl.js said no: it never reached GL), 'compile' (this device's compiler said no),
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
          const checked = G ? G.check(shader) : { ok: false, errors: [{ line: 0, message: 'The shader checker (lib/glsl.js) is not loaded.' }] };
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
    // (lib/scene-host.js passes it on), while the scene follows.
    point: (x, y) => { if (following) point(x, y); },
    get follows() { return following; },
    get clock() { return { ...clock }; },
  };
};
