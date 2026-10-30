// Poll asynchronous browser state from Node. Each sample sends a fresh pointer input and reads the preview's current
// settings and canvas. A slow preview can become ready on a later poll; an old canvas cannot satisfy a new switch state.
module.exports = async (sample, enabled, { timeout = 20000, interval = 80 } = {}) => {
  const end = Date.now() + timeout;
  let quiet = 0;
  do {
    const state = await sample();
    if (state?.ready && state.enabled === enabled && state.drawn === enabled) {
      if (enabled || ++quiet >= 3) return true;
    } else quiet = 0;
    await new Promise((r) => setTimeout(r, interval));
  } while (Date.now() < end);
  return false;
};
