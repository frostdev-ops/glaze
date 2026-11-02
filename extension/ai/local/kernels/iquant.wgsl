// Integer weight words and their f32 scales. Uses the same block decoding as quant.wgsl.
fn iq(rb: u32, s: u32, w: u32) -> u32 {
  let q = qw(rb, s, w);
//#if Q8_0
  return select((q.x >> 16u) | (q.y << 16u), q.x, ((rb + s * 34u + 2u) & 2u) == 0u);
//#endif
//#if Q4_K
  return (q.x >> ((s & 1u) * 4u)) & 0x0f0f0f0fu;
//#endif
//#if Q5_K
  return ((q.x >> ((s & 1u) * 4u)) & 0x0f0f0f0fu) | (((q.y >> (s & 7u)) & 0x01010101u) << 4u);
//#endif
//#if Q6_K
  let qq = s & 3u;
  let odd = ((rb + (s >> 3u) * 210u) & 2u) != 0u;
  let l = select(q.x, (q.x >> 16u) | (q.y << 16u), odd);
  let h = select(q.z, (q.z >> 16u) | (q.w << 16u), odd);
  let v = vec4<i32>(((bytes4(l) >> vec4<u32>(4u * (qq >> 1u))) & vec4<u32>(15u)) | (((bytes4(h) >> vec4<u32>(2u * qq)) & vec4<u32>(3u)) << vec4<u32>(4u))) - vec4<i32>(32);
  let u = bitcast<vec4<u32>>(v) & vec4<u32>(255u);
  return u.x | (u.y << 8u) | (u.z << 16u) | (u.w << 24u);
//#endif
}
