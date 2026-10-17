// Soft rings that spread from two slowly drifting points, in the Look's first two colours.
vec4 scene(vec2 uv) {
  vec2 p = vec2(uv.x * uAspect, uv.y);
  float rings = 0.;
  for (int i = 0; i < 2; i++) {
    float f = float(i);
    vec2 centre = vec2(uAspect * (.3 + .4 * f), .5 + .2 * sin(uTime * .2 + f * 2.));
    rings += sin(length(p - centre) * 12. - uTime * 1.2 + f * 1.7);
  }
  float light = smoothstep(.2, 2., rings);
  return vec4(mix(uC1, uC2, uv.y), amt(light * .6));
}
