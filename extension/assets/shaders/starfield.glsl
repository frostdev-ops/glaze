// Starfield with twinkle
// Three layers of stars drifting at different speeds for a bit of depth. Every star
// twinkles on its own beat, a few are bright enough to get a soft cross-shaped flare,
// and a very faint nebula in the Look's colours sits behind them.

// One layer of stars on a jittered grid. scale = cells across the screen height, seed picks the pattern.
// Returns the star's light at this pixel, 0 where there is no star.
float stars(vec2 p, float scale, float seed) {
  vec2 g = p * scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - .5;
  float h = hash(id + seed);
  // Only some cells hold a star; its position is jittered inside the cell.
  vec2 o = (vec2(hash(id + seed + 3.1), hash(id + seed + 7.7)) - .5) * .7;
  vec2 d = f - o;
  float r = length(d);
  float size = .018 + .05 * h * h;
  float body = 1. - smoothstep(size * .5, size, r);
  float glow = exp(-r * 20.) * .22;
  // A faint flare along the two axes, only on the brightest stars.
  float flare = (exp(-abs(d.x) * 90.) * exp(-abs(d.y) * 12.) + exp(-abs(d.y) * 90.) * exp(-abs(d.x) * 12.)) * step(.93, h) * .35;
  // The twinkle: each star has its own speed and phase, and never goes fully dark.
  float tw = .6 + .4 * sin(uTime * (1.5 + 3. * h) + h * 60.);
  return step(.7, h) * (body + glow + flare) * tw;
}

vec4 scene(vec2 uv) {
  vec2 p = vec2(uv.x * uAspect, uv.y);

  // Nebula: two slow clouds of colour, kept dark so the stars stay the subject.
  float n1 = fbm(p * 1.4 + vec2(uTime * .004, 0.));
  float n2 = fbm(p * 2.1 + vec2(7.3, -uTime * .003));
  vec3 col = uGround;
  col = mix(col, uC1, amt(smoothstep(.45, .85, n1) * .28));
  col = mix(col, uC2, amt(smoothstep(.5, .9, n2) * .20));

  for (int i = 0; i < 3; i++) {
    float f = float(i);
    // Far layers are small and slow, near layers bigger and faster.
    vec2 q = p + vec2(uTime * (.003 + .004 * f), -uTime * .001 * f);
    float s = stars(q, 16. + 11. * f, f * 17.);
    // Mostly white, tinted toward one of the Look's colours.
    vec3 tint = i == 0 ? uC1 : (i == 1 ? uC2 : uC3);
    col += mix(vec3(1.), tint, .3) * s * (.55 + .45 * uAmount);
  }
  return vec4(col, 1.);
}
