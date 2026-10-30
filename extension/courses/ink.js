// Local annotations in Canvas's document viewer (features/docviewer.js): where they are kept, the stroke math and the
// file they export to. Pure, so node can test it; classic script for the content script, module.exports for node.
//
// A page is W units wide in its own, unrotated frame, and as tall as its shape makes it (h). A stroke is
// { t: 'pen' | 'hl', c: '#rrggbb', w: width in those units, p: [x0, y0, x1, y1, …] }, so it keeps its place and its
// weight at any zoom; a rotated view only changes how the frame is drawn (matrix).
const GZ_INK = (() => {
  const W = 1000;
  const TOOLS = ['pen', 'hl'];
  const HEX = /^#[0-9a-f]{6}$/i;
  const MAX_STROKES = 2000; // a page
  const MAX_POINTS = 4000; // a stroke
  const ID = /^\d{1,20}$/;
  // One key in storage.local per Canvas site, person and file: ink:https://school.instructure.com/<user>/<file>. Someone
  // Canvas says is signed out (a public file) is the site's "anon", only ever passed as that: a person Glaze can't name
  // gets no key, so nobody's marks are shown to anyone else, and "anon" marks are never moved to a signed-in person.
  const STORE_KEY = /^ink:https:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d{1,20}|anon)\/\d{1,20}$/i;
  const storeKey = (origin, user, file) => {
    const k = `ink:${origin}/${user}/${file}`;
    return (ID.test(user) || user === 'anon') && ID.test(file) && STORE_KEY.test(k) ? k : null;
  };

  // The page's frame drawn in the view: turned clockwise `rot` quarter turns (0-3), its corner back at 0,0. The view
  // is W × h, or h × W on a quarter turn.
  const view = (rot, h) => (rot % 2 ? [h, W] : [W, h]);
  const matrix = (rot, h) => [[1, 0, 0, 1, 0, 0], [0, 1, -1, 0, h, 0], [-1, 0, 0, -1, W, h], [0, -1, 1, 0, 0, W]][rot] || [1, 0, 0, 1, 0, 0];

  const r1 = (v) => Math.round(v * 10) / 10;
  // Fewer points, same line (Ramer-Douglas-Peucker, `tol` units): a stroke drawn at 120 Hz stores a fraction of them.
  const simplify = (p, tol = 0.6) => {
    const n = p.length / 2;
    if (n < 3) return p.map(r1);
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const ax = p[2 * a], ay = p[2 * a + 1], dx = p[2 * b] - ax, dy = p[2 * b + 1] - ay;
      const len = Math.hypot(dx, dy) || 1;
      let far = 0, at = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * (p[2 * i] - ax) - dx * (p[2 * i + 1] - ay)) / len;
        if (d > far) { far = d; at = i; }
      }
      if (far > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(r1(p[2 * i]), r1(p[2 * i + 1]));
    return out;
  };

  // An SVG path through the points, smoothed through their midpoints. One point is a dot (round caps draw it).
  const path = (p) => {
    if (p.length < 4) return p.length === 2 ? `M${p[0]} ${p[1]}h0.01` : '';
    let d = `M${p[0]} ${p[1]}`;
    for (let i = 2; i < p.length - 2; i += 2) d += `Q${p[i]} ${p[i + 1]} ${r1((p[i] + p[i + 2]) / 2)} ${r1((p[i + 1] + p[i + 3]) / 2)}`;
    return `${d}L${p.at(-2)} ${p.at(-1)}`;
  };

  // Whether the eraser at x,y (radius r units) touches the stroke.
  const hits = (s, x, y, r) => {
    const reach = r + s.w / 2;
    const p = s.p;
    if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y) <= reach;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = p[i + 1], dx = p[i + 2] - ax, dy = p[i + 3] - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= reach) return true;
    }
    return false;
  };

  // An edit of one page's strokes, kept for undo: { n, add: [stroke…], del: [[index, stroke]…] } (indexes ascending,
  // into the list before the edit). apply and revert change `pages` in place; revert(apply(x)) is x again.
  const apply = (pages, op) => {
    const list = (pages[op.n] ||= []);
    for (let k = op.del.length - 1; k >= 0; k--) list.splice(op.del[k][0], 1);
    list.push(...op.add);
    if (!list.length) delete pages[op.n];
    return pages;
  };
  const revert = (pages, op) => {
    const list = (pages[op.n] ||= []);
    list.splice(list.length - op.add.length, op.add.length);
    for (const [i, s] of op.del) list.splice(i, 0, s);
    if (!list.length) delete pages[op.n];
    return pages;
  };

  // Strokes from storage or an imported file, checked: anything malformed is left out, never half-kept.
  const cleanStroke = (s) => {
    if (!s || !TOOLS.includes(s.t) || !HEX.test(s.c) || typeof s.w !== 'number' || !(s.w >= 0.5 && s.w <= 80)) return null;
    const p = s.p;
    if (!Array.isArray(p) || p.length < 2 || p.length % 2 || p.length > 2 * MAX_POINTS) return null;
    if (!p.every((v) => typeof v === 'number' && v >= -W && v <= 10 * W)) return null;
    return { t: s.t, c: s.c.toLowerCase(), w: r1(s.w), p: p.map(r1) };
  };
  const clean = (raw) => {
    const pages = {};
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    for (const [n, list] of Object.entries(src)) {
      if (!/^[1-9]\d{0,4}$/.test(n) || !Array.isArray(list)) continue;
      const ok = list.slice(0, MAX_STROKES).map(cleanStroke).filter(Boolean);
      if (ok.length) pages[n] = ok;
    }
    return pages;
  };

  // The exported file, and reading one back: its strokes join what's there, without doubles.
  const FORMAT = 'glaze-annotations';
  const exportFile = (file, pages, at = new Date()) => JSON.stringify({ format: FORMAT, version: 1, file, exported: at.toISOString(), pages });
  const importFile = (text, pages) => {
    let raw;
    try { raw = JSON.parse(text); } catch { return null; }
    if (raw?.format !== FORMAT || raw.version !== 1) return null;
    const got = clean(raw.pages);
    const out = clean(pages);
    let added = 0;
    for (const [n, list] of Object.entries(got)) {
      const have = new Set((out[n] || []).map((s) => JSON.stringify(s)));
      for (const s of list) {
        if (have.has(JSON.stringify(s)) || (out[n] || []).length >= MAX_STROKES) continue;
        (out[n] ||= []).push(s);
        added++;
      }
    }
    return { pages: out, added };
  };

  return { W, TOOLS, MAX_POINTS, STORE_KEY, storeKey, view, matrix, simplify, path, hits, apply, revert, clean, exportFile, importFile };
})();

if (typeof module !== 'undefined') module.exports = GZ_INK; else GZ_INK;
