// Liquid gradient
// Two rounds of domain warping turn the Look's colours into slow, glossy currents,
// like oil on water. Nothing here is fast: it should feel like a lava lamp seen close up.

// Warped noise field; returns the field value and leaves the two warp vectors for colouring.
float field(vec2 p, float t, out vec2 q, out vec2 r) {
  q = vec2(fbm(p + vec2(0., t)), fbm(p + vec2(5.2, 1.3) - t));
  r = vec2(fbm(p + 3. * q + vec2(1.7, 9.2) + t * .6), fbm(p + 3. * q + vec2(8.3, 2.8) - t * .5));
  return fbm(p + 3. * r);
}

vec4 scene(vec2 uv) {
  vec2 p = vec2(uv.x * uAspect, uv.y) * 1.3;
  float t = uTime * .05;
  vec2 q, r;
  float f = field(p, t, q, r);

  // Body colour: ground -> first colour by height of the field, then the others in the warp vectors.
  vec3 col = mix(uGround, uC1, amt(smoothstep(.2, .8, f) * .9));
  col = mix(col, uC2, amt(smoothstep(.35, .95, length(q)) * .75));
  col = mix(col, uC3, amt(smoothstep(.45, 1., r.x) * .6));

  // Gloss: a soft highlight where the field is steep, lit from the top left.
  float e = .02;
  vec2 q2, r2;
  float fx = field(p + vec2(e, 0.), t, q2, r2);
  float fy = field(p + vec2(0., e), t, q2, r2);
  vec2 grad = vec2(fx - f, fy - f) / e;
  float light = clamp(dot(normalize(vec3(-grad * .35, 1.)), normalize(vec3(-.4, .6, .7))), 0., 1.);
  col += vec3(pow(light, 12.)) * .16 * (.5 + uAmount);

  // A gentle vignette keeps the corners calm.
  col = mix(uGround, col, 1. - .35 * smoothstep(.4, 1.1, length((uv - .5) * vec2(uAspect, 1.))));
  return vec4(col, 1.);
}
