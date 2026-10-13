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
  waves: { scale: 0.5, make: (m) => [new Points(grid(), m(WAVES, DOT, true)), perspective(1.1, 0, -1.5)] },
  dust: { scale: 0.5, make: (m) => [new Points(motes(), m(DUST, DOT, true)), perspective(0, 0, -2)] },
};

// opts: { name, ground, colors: [3 hex], dim: 0-1 toward the ground, amount: 0-1, speed: 0 for a still frame }.
export const start = (canvas) => {
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

  const size = () => {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(Math.max(1, Math.round(w * def.scale)), Math.max(1, Math.round(h * def.scale)), false);
    U.uAspect.value = w / h;
    U.uPx.value = (h * def.scale) / 1000;
    if (camera.isPerspectiveCamera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  };
  const draw = () => renderer.render(scene, camera);
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    if (now - last < 1000 / FPS - 1) return;
    U.uTime.value += (Math.min(now - last, 100) / 1000) * speed;
    last = now;
    draw();
  };
  const onResize = () => { size(); draw(); };
  addEventListener('resize', onResize);
  const drop = () => { if (object) { scene.remove(object); object.geometry.dispose(); object.material.dispose(); } };

  return {
    update(o) {
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
    stop() {
      cancelAnimationFrame(raf);
      removeEventListener('resize', onResize);
      drop();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
};
