// Small bounded steps keep drags, shelves and water independent of the display's frame rate.
var GZ_PET_PHYSICS = globalThis.GZ_PET_PHYSICS || (() => {
  const step = (body, { width, height, platforms = [], water = false, dt = 1 / 30 }) => {
    dt = Math.max(0, Math.min(.05, dt));
    const b = { ...body }, bottom = b.y + b.h;
    b.vy = Math.min(500, b.vy + (water ? 90 : 850) * dt);
    if (water) { b.vx *= Math.exp(-2 * dt); b.vy *= Math.exp(-3 * dt); }
    b.x += b.vx * dt; b.y += b.vy * dt; b.grounded = false;
    const edge = Math.max(0, width - b.w), ground = Math.max(0, height - b.h);
    if (b.x < 0 || b.x > edge) { b.x = Math.max(0, Math.min(edge, b.x)); b.vx *= -.45; }
    const supports = [...platforms, { x: 0, y: height, w: width }].filter((p) => b.vy >= 0 && bottom <= p.y + 2 && b.y + b.h >= p.y && b.x + b.w > p.x + 3 && b.x < p.x + p.w - 3).sort((a, c) => a.y - c.y);
    if (supports.length) { b.y = supports[0].y - b.h; b.vy = b.vy > 90 ? -b.vy * .18 : 0; b.grounded = true; }
    if (b.y > ground) { b.y = ground; b.vy = 0; b.grounded = true; }
    if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy) * .3; }
    return b;
  };
  return { step };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET_PHYSICS; else GZ_PET_PHYSICS;
