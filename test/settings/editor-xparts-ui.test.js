const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lib/editor-xparts.js');

// The real builder with an inert DOM; emulate focus loss when a focused subtree is replaced.
const page = (parts) => {
  const document = { activeElement: null };
  class El {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.parent = null;
      this.textContent = ''; this.value = ''; this.id = ''; this.className = '';
      this.onclick = this.onchange = this.oninput = this.onkeydown = null;
    }
    append(...kids) { for (const kid of kids) { if (kid instanceof El) kid.parent = this; this.children.push(kid); } }
    contains(el) { return el === this || this.all.includes(el); }
    get all() { return this.children.filter((c) => c instanceof El).flatMap((c) => [c, ...c.all]); }
    replaceChildren(...kids) {
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      for (const kid of this.children) if (kid instanceof El) kid.parent = null;
      this.children = []; this.append(...kids);
    }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'data-f') this.dataset.f = String(v); }
    addEventListener() {}
    closest(sel) { return sel === '[data-f]' ? (this.dataset.f ? this : this.parent?.closest(sel)) : null; }
    querySelector(sel) { return this.all.find((e) => sel === '[data-f]' ? e.dataset.f : e.dataset.f === /^\[data-f="(.*)"\]$/.exec(sel)?.[1]) || null; }
    querySelectorAll() { return []; }
    focus() { document.activeElement = this; }
  }
  document.body = new El('body'); document.activeElement = document.body;
  document.createElement = (tag) => new El(tag);
  for (const id of ['xnav', 'xrules', 'heading-look-nav-layout', 'heading-look-rules']) { const e = new El('div'); e.id = id; document.body.append(e); }
  document.getElementById = (id) => document.body.all.find((e) => e.id === id);
  document.querySelectorAll = () => [];
  const was = Object.fromEntries(['document', 'CSS', 'requestAnimationFrame', 'addEventListener'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.assign(globalThis, { document, CSS: { escape: (s) => s }, requestAnimationFrame: (f) => f(), addEventListener() {} });
  const s = { parts: structuredClone(parts) }, writes = [];
  E.mount({ s, t: (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v?.[k]), refresh: E.render, save: (keys) => writes.push({ keys, parts: structuredClone(s.parts) }), navItems: () => ({}), preview() {}, frame: {} });
  const find = (f) => document.body.querySelector(`[data-f="${f}"]`);
  return { s, writes, document, find,
    fire: (f, type = 'click', value) => { const e = find(f); assert.ok(e, f); e.focus(); if (type === 'change') e.value = value; e[`on${type}`]({ target: e, key: value, preventDefault() {} }); },
    close: () => { for (const [k, d] of Object.entries(was)) if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; },
  };
};
const rule = (p) => ({ p, do: 'hide' });

test('repeated rule and group moves keep focus with the moved row', () => {
  const rules = ['ultra.courses.term', 'ultra.course-card.status', 'ultra.course-card.id'].map(rule);
  const p = page({ x: { nav: { groups: ['A', 'B', 'C'].map((label) => ({ label, items: [] })) }, rules } });
  try {
    p.fire('r2:drag', 'keydown', 'ArrowUp');
    assert.equal(p.document.activeElement.dataset.f, 'r1:drag');
    p.document.activeElement.onkeydown({ key: 'ArrowUp', preventDefault() {} });
    assert.deepEqual(p.s.parts.x.rules, [rules[2], rules[0], rules[1]]);
    p.fire('group0:down');
    assert.equal(p.document.activeElement.dataset.f, 'group1:down');
    p.document.activeElement.onclick();
    assert.deepEqual(p.s.parts.x.nav.groups.map((g) => g.label), ['B', 'C', 'A']);
  } finally { p.close(); }
});

test('removing or hiding a focused row returns focus to a usable builder control', () => {
  const p = page({ x: { nav: { groups: [{ items: ['calendar'] }] }, rules: [rule('ultra.courses.term')] } });
  try {
    p.fire('calendar:hide');
    assert.equal(p.document.activeElement.dataset.f, 'calendar:show');
    p.fire('calendar:show');
    assert.equal(p.document.activeElement.dataset.f, 'calendar:hide');
    p.fire('r0:remove');
    assert.equal(p.document.activeElement.dataset.f, 'rule:add');
    p.fire('nav:remove');
    assert.equal(p.document.activeElement.dataset.f, 'nav:mine');
  } finally { p.close(); }
});

test('moving identical rows still moves focus and does not leak a pending focus target', () => {
  const r = rule('ultra.courses.term');
  const p = page({ x: { nav: { groups: [{ items: [] }, { items: [] }] }, rules: [r, r] } });
  try {
    p.fire('r1:drag', 'keydown', 'ArrowUp');
    assert.equal(p.document.activeElement.dataset.f, 'r0:drag');
    p.fire('group0:down');
    assert.equal(p.document.activeElement.dataset.f, 'group1:down');
  } finally { p.close(); }
});
