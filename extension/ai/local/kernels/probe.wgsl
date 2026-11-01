// Where each invocation sits in its subgroup: the kernels' subgroup path assumes invocation li is lane li mod size.
@group(0) @binding(0) var<storage, read_write> O: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(subgroup_invocation_id) lane: u32, @builtin(subgroup_size) size: u32) {
  O[li] = (size << 16u) | lane;
  O[256u + li] = u32(subgroupShuffleXor(f32(li), 1u));
}
