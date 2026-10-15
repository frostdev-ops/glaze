// Glaze — animated backgrounds (bg.kind "scene"). content.js imports this module only once someone
// picks a scene, and only in the top frame, so three.js costs nothing otherwise.
// Cheap on purpose: drawn at a fraction of the screen's resolution and stretched by the browser
// (the softness is the look), at most 30 frames a second, and all movement is worked out in the
// shaders from one time uniform, so a frame is one uniform write and one draw. Motion off draws a
// single still frame and stops; background tabs get no animation frames at all.
import {
  WebGLRenderer, Scene, OrthographicCamera, PerspectiveCamera, Mesh, Points, PlaneGeometry,
  BufferGeometry, Float32BufferAttribute, ShaderMaterial, Color, ColorManagement,
} from './three.min.js';

// Colors pass through as written, the way CSS mixes them, so a scene matches the gradient under it.
ColorManagement.enabled = false;

const FPS = 30;
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
  waves: { scale: 0.5, make: (m) => [new Points(grid(), m(WAVES, DOT, true)), perspective(1.1, 0, -1.5)] },
  dust: { scale: 0.5, make: (m) => [new Points(motes(), m(DUST, DOT, true)), perspective(0, 0, -2)] },
};

// opts: { name, ground, colors: [3 hex], dim: 0-1 toward the ground, amount: 0-1, speed: 0 for a still frame }.
export const start = (canvas, live = () => true) => {
  const renderer = new WebGLRenderer({ canvas, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  const U = {
    uTime: { value: 0 }, uAspect: { value: 1 }, uPx: { value: 1 }, uAmount: { value: 0.5 },
    uGround: { value: new Color() }, uC1: { value: new Color() }, uC2: { value: new Color() }, uC3: { value: new Color() },
  };
  const material = (vertexShader, fragmentShader, transparent = false) => new ShaderMaterial({ uniforms: U, vertexShader, fragmentShader, transparent, depthTest: false, depthWrite: false });
  const scene = new Scene();
  let name = '';
  let def = null;
  let object = null;
  let camera = null;
  let speed = 0;
  let raf = 0;
  let last = 0;
  let stopped = false;

  const size = () => {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(Math.max(1, Math.round(w * def.scale)), Math.max(1, Math.round(h * def.scale)), false);
    U.uAspect.value = w / h;
    U.uPx.value = (h * def.scale) / 1000;
    if (camera.isPerspectiveCamera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  };
  const draw = () => { if (stopped) return; if (!live()) return freeze(); renderer.render(scene, camera); };
  const tick = (now) => {
    if (stopped) return;
    if (!live()) return freeze();
    raf = requestAnimationFrame(tick);
    if (now - last < 1000 / FPS - 1) return;
    U.uTime.value += (Math.min(now - last, 100) / 1000) * speed;
    last = now;
    draw();
  };
  const onResize = () => { if (stopped) return; if (!live()) return freeze(); size(); draw(); };
  addEventListener('resize', onResize);
  const drop = () => { if (object) { scene.remove(object); object.geometry.dispose(); object.material.dispose(); } };
  // Cut off (Glaze reloaded under the tab): it stops drawing and keeps its last frame on screen until the page loads
  // again, rather than leaving the page bare. Switched off (stop), everything is freed.
  const freeze = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf); raf = 0;
    removeEventListener('resize', onResize);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf); raf = 0;
    removeEventListener('resize', onResize);
    drop();
    renderer.dispose();
    renderer.forceContextLoss();
  };

  return {
    update(o) {
      if (stopped) return;
      if (!live()) return freeze();
      if (o.name !== name) {
        drop();
        name = o.name;
        def = SCENES[name] || SCENES.mist;
        [object, camera] = def.make(material);
        object.frustumCulled = false;
        scene.add(object);
      }
      U.uGround.value.set(o.ground);
      [U.uC1, U.uC2, U.uC3].forEach((u, i) => u.value.set(o.colors[i]).lerp(U.uGround.value, o.dim));
      U.uAmount.value = o.amount;
      renderer.setClearColor(U.uGround.value);
      size();
      speed = o.speed;
      if (speed && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
      if (!speed && raf) { cancelAnimationFrame(raf); raf = 0; }
      draw();
    },
    draw,
    stop,
  };
};
