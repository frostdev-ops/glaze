// Small bounded steps keep drags, shelves and water independent of the display's frame rate.
var GZ_PET_PHYSICS = globalThis.GZ_PET_PHYSICS || (() => {
  const step = (body, { width, height, platforms = [], water = false, bounce = .18, dt = 1 / 30 }) => {
    dt = Math.max(0, Math.min(.05, dt));
    const b = { ...body }, left = b.x, top = b.y, bottom = b.y + b.h;
    b.vy = Math.min(500, b.vy + (water ? 90 : 850) * dt);
    if (water) { b.vx *= Math.exp(-2 * dt); b.vy *= Math.exp(-3 * dt); }
    b.x += b.vx * dt; b.y += b.vy * dt; b.grounded = false; b.support = null;
    const edge = Math.max(0, width - b.w), ground = Math.max(0, height - b.h);
    if (b.x < 0 || b.x > edge) { b.x = Math.max(0, Math.min(edge, b.x)); b.vx *= -.45; }
    // Headings and shelves are one-way ledges; panels can also stop a rolling or rising toy.
    const solids = platforms.filter((p) => p.solid && p.h > 0);
    for (const p of solids) {
      if (top + b.h <= p.y + 2 || top >= p.y + p.h - 2) continue;
      if (left + b.w <= p.x + 1 && b.x + b.w > p.x) { b.x = p.x - b.w; b.vx = -Math.abs(b.vx) * .45; }
      else if (left >= p.x + p.w - 1 && b.x < p.x + p.w) { b.x = p.x + p.w; b.vx = Math.abs(b.vx) * .45; }
    }
    for (const p of solids) if (b.vy < 0 && top >= p.y + p.h - 1 && b.y < p.y + p.h && b.x + b.w > p.x + 2 && b.x < p.x + p.w - 2) {
      b.y = p.y + p.h; b.vy = Math.abs(b.vy) * bounce;
    }
    const supports = [...platforms, { x: 0, y: height, w: width }].filter((p) => p.top !== false && b.vy >= 0 && bottom <= p.y + 2 && b.y + b.h >= p.y && b.x + b.w > p.x + 3 && b.x < p.x + p.w - 3).sort((a, c) => a.y - c.y);
    if (supports.length) { const p = supports[0]; b.y = p.y - b.h; b.vy = b.vy > 90 ? -b.vy * bounce : 0; b.grounded = b.vy === 0; b.support = b.grounded && p.el ? p : null; }
    if (b.y > ground) { b.y = ground; b.vy = 0; b.grounded = true; }
    if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy) * .3; }
    return b;
  };
  return { step };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET_PHYSICS; else GZ_PET_PHYSICS;
