// scripts/canvas-shots.js --audit (scripts/audit.js), run against a stand-in window: it may only count what is on screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { auditFrame } = require('../scripts/audit.js');

// A window 1000×600 over a page 4000 tall, dark palette, with boxes laid out as given (viewport coordinates).
const page = (boxes) => {
  const parse = (c) => {
    const m = c.match(/^#(..)(..)(..)$/) || [];
    return m.length ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 255] : (c.match(/[\d.]+/g) || [0, 0, 0, 0]).map((v, i) => (i === 3 ? Math.round(v * 255) : +v));
  };
  let fill = '#000';
  const ctx = { clearRect() {}, fillRect() {}, set fillStyle(c) { fill = c; }, get fillStyle() { return fill; }, getImageData: () => ({ data: parse(fill) }) };
  const el = (tag, rect, style, parent, text = '') => ({
    nodeType: 1, tagName: tag, id: '', classList: [], parentElement: parent, rect, style: { backgroundImage: 'none', color: '#e6edf5', fontSize: '16px', fontWeight: '400', ...style },
    childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
    getBoundingClientRect() { return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }; },
    getAttribute: () => null, hasAttribute: () => false, closest: () => null, checkVisibility: () => true,
    contains(x) { for (let p = x; p; p = p.parentElement) if (p === this) return true; return false; },
  });
  const html = el('HTML', { left: 0, top: 0, width: 1000, height: 4000 }, { backgroundColor: '#060d18' }, null);
  const body = el('BODY', { left: 0, top: 0, width: 1000, height: 4000 }, { backgroundColor: 'rgba(0, 0, 0, 0)' }, html);
  const els = boxes.map(([rect, bg, text]) => el('DIV', rect, { backgroundColor: bg }, body, text));
  const inside = (e, x, y) => { const r = e.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; };
  const document = {
    documentElement: Object.assign(html, { scrollWidth: 1000, scrollHeight: 4000 }), body: Object.assign(body, { querySelectorAll: () => els }),
    createElement: () => ({ getContext: () => ctx }),
    elementFromPoint: (x, y) => [...els].reverse().find((e) => inside(e, x, y)) || (inside(body, x, y) ? body : null),
  };
  const vars = { '--gz-surface-2': '#060d18', '--gz-accent': '#17c8f4', '--gz-accent-hi': '#6fdcff' };
  return { document, innerWidth: 1000, innerHeight: 600, getComputedStyle: (e) => ({ ...e.style, getPropertyValue: (v) => vars[v] || '' }) };
};

test('a light box on screen is reported with the area that shows', () => {
  const { dark, issues } = auditFrame(page([[{ left: 100, top: 550, width: 500, height: 100 }, '#ffffff']]));
  assert.equal(dark, true);
  assert.deepEqual(issues.map((i) => [i.kind, i.area]), [['light-fill', 500 * 50]]);
});

test('a box wholly below the window, or clipped away, is not counted', () => {
  // Codex's case: 500×100 below a 1000×600 window in a 4000 tall page. The old audit clamped its middle into the window,
  // hit the body, and counted 50,000 px².
  assert.deepEqual(auditFrame(page([[{ left: 100, top: 3000, width: 500, height: 100 }, '#ffffff']])).issues, []);
  assert.deepEqual(auditFrame(page([[{ left: -2000, top: 10, width: 500, height: 100 }, '#ffffff', 'skip to content']])).issues, []);
});

test('a label that lets the pointer through still counts; one clipped to nothing inside its parent does not', () => {
  const label = page([[{ left: 0, top: 0, width: 300, height: 300 }, '#0d1b2e'], [{ left: 10, top: 10, width: 100, height: 20 }, 'rgba(0, 0, 0, 0)', 'Courses']]);
  const [parent, text] = label.document.body.querySelectorAll();
  text.parentElement = parent;
  text.style.color = '#2b3a4a';
  label.document.elementFromPoint = () => parent;
  assert.deepEqual(auditFrame(label).issues.map((i) => i.kind), [], 'clipped or covered: not seen');
  text.style.pointerEvents = 'none';
  assert.deepEqual(auditFrame(label).issues.map((i) => i.kind), ['text'], 'pointer-events: none: painted');
});

test('a box under something else on top is not counted', () => {
  const under = page([[{ left: 100, top: 100, width: 200, height: 100 }, '#ffffff'], [{ left: 0, top: 0, width: 1000, height: 600 }, '#0d1b2e']]);
  assert.deepEqual(auditFrame(under).issues, []);
});
