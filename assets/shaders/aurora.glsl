// Aurora ribbons
// Three curtains of light that ripple across the night sky, fading in from the top and
// thinning out toward the horizon. Ribbon colours come from the Look (uC1, uC2, uC3);
// the sky is the Look's ground colour, and the intensity slider (uAmount) sets how bright
// the ribbons may get.

// One ribbon: how much light it puts at point p (aspect-corrected, y up) at time t.
float ribbon(vec2 p, float seed, float t) {
  // The centre line wanders sideways as a sum of slow waves, plus a little noise.
  float centre = .2 + .3 * seed + .12 * hash(vec2(seed, 1.))
    + .10 * sin(p.y * 2.1 + t * .7 + seed * 5.)
    + .05 * sin(p.y * 5.3 - t * 1.1 + seed * 2.)
    + .20 * (fbm(vec2(p.y * 1.3 + seed * 9., t * .25)) - .5);
  float d = p.x - centre * uAspect;
  float core = exp(-d * d * 55.);              // the bright core
  float halo = exp(-abs(d) * 4.);              // the wide glow around it
  // Fine vertical rays, drifting slowly sideways.
  float rays = .35 + .65 * noise(vec2(p.x * 40. + seed * 11. + t * 2., p.y * 1.5 - t * .4));
  // Curtains hang from the top and fade out before the horizon.
  float hang = smoothstep(.05, .4, p.y) * (1. - smoothstep(.8, 1., p.y));
  return (core * rays + halo * .16) * hang;
}

vec4 scene(vec2 uv) {
  vec2 p = vec2(uv.x * uAspect, uv.y);
  float t = uTime * .35;
  vec3 col = uGround;

  // A faint glow low in the sky, in the third colour.
  col = mix(col, uC3, amt(smoothstep(.6, 0., uv.y) * .10));

  for (int i = 0; i < 3; i++) {
    float f = float(i);
    float r = ribbon(p, f, t + f * 3.7);
    // Each ribbon blends from the first colour to the second; the hem shades to the third.
    vec3 k = mix(uC1, uC2, f * .5);
    k = mix(k, uC3, smoothstep(.45, .95, uv.y));
    col = mix(col, k, amt(r * (.9 - .15 * f)));
  }

  // A few stars showing through, dimmed where the aurora is bright.
  vec2 g = p * 30.;
  vec2 id = floor(g);
  float h = hash(id);
  float d = length(fract(g) - .5 - (vec2(hash(id + 3.1), hash(id + 7.7)) - .5) * .6);
  float star = step(.97, h) * (1. - smoothstep(.02, .09, d)) * (.6 + .4 * sin(uTime * (1. + 2. * h) + h * 40.));
  col += vec3(star) * .5 * (1. - clamp(dot(col - uGround, vec3(2.)), 0., 1.)) * smoothstep(.3, .8, uv.y);

  return vec4(col, 1.);
}
