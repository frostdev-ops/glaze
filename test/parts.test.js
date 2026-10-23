// LMS parts and rules: the registry and the rule cleaner (lib/parts.js), and the rules put on and taken off a page
// (features/rules.js, run in a VM over a small stand-in DOM whose elements say which part selectors they match).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../lib/parts.js');
const G = require('../defaults.js');
const F = require('../lib/fonts.js');
const LX = require('../lib/lookx.js');
const C = require('../lib/color.js');

test('the registry: dotted names per LMS, a selector and label each, containers shared by what may move together', () => {
  assert.ok(P.PARTS.size > 60);
  for (const p of P.PARTS.values()) {
    assert.match(p.name, /^(ultra|canvas|moodle)(\.[a-z][a-z0-9-]*)+$/, p.name);
    assert.ok(p.s && !/[{};]/.test(p.s), p.name);
    assert.ok(p.label && p.st.length, p.name);
    assert.ok(p.st.every((k) => P.BOX.includes(k)), p.name);
  }
  for (const name of ['ultra.course-card', 'ultra.course-card.title', 'canvas.dashboard-card', 'canvas.global-nav', 'moodle.navbar']) assert.ok(P.has(name), name);
  assert.ok(!P.has('ultra.nope') && !P.has('') && !P.has(null) && !P.has('__proto__') && !P.has('toString'));
  // Glaze settings lives in Ultra's rail: the rail can't be hidden, nor can any LMS's main navigation.
  for (const name of ['ultra.nav', 'canvas.global-nav', 'moodle.navbar']) assert.equal(P.get(name).hide, false, name);
  assert.ok(![...P.PARTS.values()].some((p) => /#glaze|gz-/.test(p.s)), 'no part names Glaze\'s own pieces');
  // The editor's list: one LMS, labels through t().
  const list = P.list('canvas', (s) => `«${s}»`);
  assert.ok(list.length && list.every((p) => p.name.startsWith('canvas.') && /^«.+»$/.test(p.label)));
  assert.deepEqual(Object.keys(list[0]), ['name', 'label', 'hide', 'text', 'move', 'st']);
  assert.deepEqual(P.list('blackboard'), []);
});

test('rules: hide, show, move, style and label, each only where its part allows', () => {
  assert.deepEqual(P.clean({ p: 'canvas.dashboard-card', do: 'hide' }), { p: 'canvas.dashboard-card', do: 'hide' });
  assert.deepEqual(P.clean({ p: 'canvas.dashboard-card', do: 'show' }), { p: 'canvas.dashboard-card', do: 'show' });
  assert.equal(P.clean({ p: 'ultra.nav', do: 'hide' }), null);
  assert.deepEqual(P.clean({ p: 'canvas.course-nav.grades', do: 'move', to: 'canvas.course-nav.home', at: 'after' }), { p: 'canvas.course-nav.grades', do: 'move', to: 'canvas.course-nav.home', at: 'after' });
  // Only beside a part in the same container, never itself, and only before or after.
  for (const r of [{ to: 'canvas.global-nav.help', at: 'after' }, { to: 'canvas.course-nav.grades', at: 'after' }, { to: 'canvas.course-nav.home', at: 'inside' }, { to: 'canvas.course-nav.home' }, { to: 'nope', at: 'before' }]) {
    assert.equal(P.clean({ p: 'canvas.course-nav.grades', do: 'move', ...r }), null, JSON.stringify(r));
  }
  assert.equal(P.clean({ p: 'canvas.dashboard-card', do: 'move', to: 'canvas.dashboard-card.title', at: 'before' }), null, 'a card has no container to move in');
  assert.deepEqual(P.clean({ p: 'ultra.course-card.title', do: 'label', t: '  My\n\tfavourite\u0000 course  ' }), { p: 'ultra.course-card.title', do: 'label', t: 'My favourite course' });
  assert.equal([...P.clean({ p: 'ultra.course-card.title', do: 'label', t: '😀'.repeat(80) }).t].length, P.LABEL_MAX);
  for (const t of ['', '   ', 5, null]) assert.equal(P.clean({ p: 'ultra.course-card.title', do: 'label', t }), null);
  assert.equal(P.clean({ p: 'ultra.course-card', do: 'label', t: 'x' }), null, 'a card holds many texts: not relabelled');
});

test('styles: the allowlist only, colours as tokens or hex, numbers clamped, catalogue fonts', () => {
  const st = (p, s) => P.clean({ p, do: 'style', st: s })?.st ?? null;
  assert.deepEqual(st('canvas.dashboard-card', { bg: 'accent-soft', fg: '#AABBCC', bc: 'line', bw: 9, r: 40.4, p: 3, g: -2, sh: 2, o: 150, f: 'lexend' }),
    { bg: 'accent-soft', fg: '#aabbcc', bc: 'line', bw: 4, r: 32, p: 3, g: 0, sh: 2, o: 100, f: 'lexend' });
  for (const t of G.GZ_COLORS.map(([v]) => v.slice(5))) assert.deepEqual(st('canvas.footer', { bg: t }), { bg: t });
  // A text part takes colour, font and opacity only; anything else refuses the rule.
  assert.deepEqual(st('canvas.dashboard-card.title', { fg: 'ink', o: 80 }), { fg: 'ink', o: 80 });
  for (const bad of [{ r: 4 }, { bg: 'red' }, { bg: '#fff' }, { bg: 'var(--x)' }, { fg: 'accent; color: red' }, { bw: '2' }, { o: NaN }, { o: Infinity }, { f: 'Comic Neue' }, { f: 'Arial' }, { width: 3 }, {}, [], 'bg']) {
    assert.equal(st('canvas.dashboard-card.title', bad), null, JSON.stringify(bad));
  }
  assert.equal(st('canvas.footer', { f: 'Comic Neue' }), null, 'typed families are not catalogue fonts');
  assert.ok(F.LIST.every((f) => st('canvas.footer', { f: f.id })));
});

test('the cleaner refuses unknown keys and wrong shapes, and is idempotent', () => {
  for (const bad of [null, 'hide', [], { p: 'canvas.footer' }, { p: 'canvas.footer', do: 'explode' }, { p: 'canvas.footer', do: 'hide', s: '#footer' },
    { p: 'canvas.footer', do: 'hide', t: 'x' }, { p: 'canvas.footer', do: 'style', st: { bg: 'ink' }, to: 'canvas.sidebar' }, { p: 'canvas.footer', do: 'hide', __proto__: { x: 1 } },
    Object.assign(Object.create({ p: 'canvas.footer', do: 'hide' })), { p: '#footer', do: 'hide' }, { p: 'canvas.footer', do: 'hasOwnProperty' }]) {
    assert.equal(P.clean(bad), null, JSON.stringify(bad));
  }
  const raw = [
    { p: 'moodle.block.timeline', do: 'move', to: 'moodle.block.calendar-month', at: 'before' },
    { p: 'moodle.course-card.title', do: 'label', t: ' Hi  there ' },
    { p: 'moodle.footer.help', do: 'hide' },
    { p: 'moodle.course-card', do: 'style', st: { r: 99, sh: 1.6, bg: '#ABCDEF' } },
    { p: 'moodle.navbar', do: 'hide' },
  ];
  const once = P.rules(raw);
  assert.equal(once.length, 4);
  assert.deepEqual(P.rules(once), once);
  for (const r of once) assert.deepEqual(P.clean(r), r);
  assert.equal(P.rules(Array.from({ length: 100 }, () => ({ p: 'canvas.footer', do: 'hide' }))).length, P.MAX);
  assert.deepEqual(P.rules('nope'), []);
});

test('rule actions must be strings, without property-key coercion', () => {
  const raw = JSON.parse('{"p":"canvas.course-nav.home","do":["style"],"st":{"bg":"surface"}}');
  assert.doesNotThrow(() => page('canvas', canvasNav).wear([raw]));
  assert.equal(P.clean(raw), null);
  assert.doesNotThrow(() => P.plan([raw], 'canvas'));
  assert.equal(P.plan([raw], 'canvas').size, 0);
});

test('shared rules reject CSS, selector and prototype payloads without changing their prototypes', () => {
  const bad = [
    { p: 'canvas.footer, body', do: 'hide' },
    { p: 'canvas.course-nav.home', do: 'move', to: 'canvas.course-nav.grades, body', at: 'after' },
    ...['url(https://attacker.invalid/x)', 'expression(alert(1))', 'ink);color:red;/*', 'var(--other)', '#123456;opacity:0'].map((bg) => ({ p: 'canvas.footer', do: 'style', st: { bg } })),
    { p: 'canvas.footer', do: 'style', st: { f: 'system; color: red' } },
    JSON.parse('{"p":"canvas.footer","do":"hide","__proto__":{"polluted":true}}'),
    JSON.parse('{"p":"canvas.footer","do":"style","st":{"__proto__":{"polluted":true}}}'),
    JSON.parse('{"p":"canvas.footer","do":"style","st":{"constructor":"ink"}}'),
  ];
  for (const raw of bad) assert.equal(P.clean(raw), null, JSON.stringify(raw));
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.getPrototypeOf(P.plan([{ p: 'canvas.footer', do: 'style', st: { bg: 'ink' } }], 'canvas').get('canvas.footer').vars), Object.prototype);
});

test('a plan folds the rules for one LMS in order: later wins, styles merge, values as CSS variables', () => {
  const plan = P.plan([
    { p: 'canvas.footer', do: 'hide' },
    { p: 'canvas.footer', do: 'show' },
    { p: 'canvas.sidebar', do: 'hide' },
    { p: 'canvas.dashboard-card', do: 'style', st: { bg: 'surface', r: 12 } },
    { p: 'canvas.dashboard-card', do: 'style', st: { r: 20, sh: 3, p: 4, o: 85, f: 'inter', bw: 2 } },
    { p: 'canvas.dashboard-card.title', do: 'label', t: 'One' },
    { p: 'canvas.dashboard-card.title', do: 'label', t: 'Two' },
    { p: 'ultra.course-card', do: 'hide' },
    { p: 'canvas.footer', do: 'hide', junk: 1 },
  ], 'canvas');
  assert.deepEqual([...plan.keys()], ['canvas.footer', 'canvas.sidebar', 'canvas.dashboard-card', 'canvas.dashboard-card.title']);
  assert.equal(plan.get('canvas.footer').hide, false);
  assert.equal(plan.get('canvas.sidebar').hide, true);
  assert.equal(plan.get('canvas.dashboard-card.title').t, 'Two');
  const card = plan.get('canvas.dashboard-card');
  assert.deepEqual(card.vars, { '--gz-r-bg': 'var(--gz-surface)', '--gz-r-r': '20px', '--gz-r-sh': card.vars['--gz-r-sh'], '--gz-r-p': '12px', '--gz-r-o': '0.85', '--gz-r-f': F.stack('inter'), '--gz-r-bw': '2px' });
  assert.match(card.vars['--gz-r-sh'], /^0 12px 32px color-mix\(/);
  assert.deepEqual(card.fonts, ['inter']);
  assert.equal(P.value('sh', 0), 'none');
  assert.equal(P.value('fg', '#123456'), '#123456');
  assert.equal(P.plan([{ p: 'canvas.footer', do: 'hide' }], 'moodle').size, 0);
});

test('features/rules.css has a rule for every style key, and reads only its own variables', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'features/rules.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const k of P.BOX) assert.match(css, new RegExp(`\\[data-gz-r-st~="${k}"\\][^{]*\\{[^}]*var\\(--gz-r-${k}\\)`), k);
  assert.match(css, /\[data-gz-r-hide\][^{]*\{ display: none !important; \}/);
  assert.deepEqual([...new Set(css.match(/var\(--[\w-]+/g))].sort(), P.BOX.map((k) => `var(--gz-r-${k}`).sort());
});

// ---- the page side ----------------------------------------------------------------------------------------------
const OWN = '[id^="gz-"], [class^="gz-"], [class*=" gz-"]';
const OLD_OWN = '[id^="gz-"], [class^="gz-"]';
const CONTROL = 'a[href], button, input, select, textarea, summary, [contenteditable], [role="button"], [tabindex]';
class Node {
  constructor(doc) { this.doc = doc; this.parentNode = null; }
  get parentElement() { return this.parentNode instanceof El ? this.parentNode : null; }
  get isConnected() { let p = this; while (p.parentNode) p = p.parentNode; return p === this.doc.root; }
  get sibs() { return this.parentNode.children; }
  before(n) { n.remove(); n.parentNode = this.parentNode; this.sibs.splice(this.sibs.indexOf(this), 0, n); }
  after(n) { n.remove(); n.parentNode = this.parentNode; this.sibs.splice(this.sibs.indexOf(this) + 1, 0, n); }
  remove() { if (this.parentNode) { this.sibs.splice(this.sibs.indexOf(this), 1); this.parentNode = null; } }
  replaceWith(n) { this.before(n); this.remove(); }
}
class Text extends Node { constructor(doc, data) { super(doc); this.data = data; this.nodeType = 3; } }
class El extends Node {
  constructor(doc, sel = [], kids = [], props = {}) {
    super(doc);
    Object.assign(this, { nodeType: 1, sel: new Set(sel), children: [], attrs: {}, dataset: {}, id: '', className: '', ...props });
    const vars = new Map();
    this.style = { vars, getPropertyValue: (k) => vars.get(k) || '', setProperty: (k, v) => { doc.writes++; vars.set(k, v); }, removeProperty: (k) => vars.delete(k) };
    for (const k of kids) this.append(typeof k === 'string' ? new Text(doc, k) : k);
  }
  append(n) { n.remove(); n.parentNode = this; this.children.push(n); }
  matches(s) { return s === OWN || s === OLD_OWN ? /^gz-/.test(this.id) || (s === OWN ? /(^| )gz-/ : /^gz-/).test(this.className) : s === CONTROL ? ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(this.tagName) || !!this.href : s === 'a[href="#glaze"]' ? this.href === '#glaze' : this.sel.has(s); }
  closest(s) { for (let e = this; e instanceof El; e = e.parentNode) if (e.matches(s)) return e; return null; }
  all() { return this.children.flatMap((c) => (c instanceof El ? [c, ...c.all()] : [])); }
  querySelectorAll(s) { return this.all().filter((e) => e.matches(s)); }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }
  get previousElementSibling() { return this.sibs.slice(0, this.sibs.indexOf(this)).filter((n) => n instanceof El).at(-1) || null; }
  get nextElementSibling() { return this.sibs.slice(this.sibs.indexOf(this) + 1).find((n) => n instanceof El) || null; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  setAttribute(k, v) { this.doc.writes++; this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  toggleAttribute(k, on) { if (on) this.setAttribute(k, ''); else this.removeAttribute(k); }
  texts() { return this.children.flatMap((c) => (c instanceof Text ? [c] : c.texts())); }
}
const page = (site, build, at = '/', extra = {}) => {
  const doc = { writes: 0 };
  const el = (sel, kids, props) => new El(doc, [].concat(sel), kids, props);
  const body = build(el, (name) => P.get(name).s);
  const head = el([]);
  doc.root = el([], [head, body]);
  Object.assign(doc, {
    documentElement: doc.root, head,
    querySelectorAll: (s) => doc.root.querySelectorAll(s),
    getElementById: (id) => doc.root.all().find((e) => e.id === id) || null,
    createElement: () => el([]),
    createComment: () => Object.assign(new Node(doc), { nodeType: 8 }),
    createTreeWalker: (root, _, { acceptNode }) => {
      const list = root.texts().filter((n) => acceptNode(n) === 1);
      return { nextNode: () => list.shift() || null };
    },
  });
  let on = true, x = null;
  const ctx = { site, on: () => on, parts: () => x, need: () => Promise.resolve() };
  const fonts = [];
  const c = vm.createContext({ GZ_CTX: ctx, GZ_PARTS: P, GZ_LX: LX, GZ_COLOR: C, GZ_FONTS: { load: (f) => fonts.push(f) }, document: doc, location: { pathname: at }, NodeFilter: { SHOW_TEXT: 4 }, chrome: { runtime: { getURL: (f) => `ext/${f}` } }, ...extra });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'features/rules.js'), 'utf8'), c);
  return { doc, body, fonts, R: c.GZ_RULES, wear: (rules) => { x = rules && { rules }; c.GZ_RULES.sync(); }, go: (at) => { c.location.pathname = at; c.GZ_RULES.sync(); }, off: () => { on = false; c.GZ_RULES.sync(); }, sheet: () => doc.getElementById('gz-rules-css') };
};

const canvasNav = (el, s) => el('#section-tabs', [
  el(s('canvas.course-nav.home'), [el([], ['Home'])]),
  el(s('canvas.course-nav.grades'), [el([], ['Grades'])]),
  el(s('canvas.course-nav.files'), [el([], ['Files'])]),
], { id: 'section-tabs' });

test('rules cannot conceal embedded Glaze controls, including controls mounted after the Look', () => {
  const { body, wear, off } = page('canvas', (el, s) => el([], [
    el(s('canvas.sidebar'), [el([], [el([], ['Add task'], { tagName: 'BUTTON' })], { id: 'gz-todo' })]),
    el(s('canvas.dashboard-card'), ['Course']),
    el(s('canvas.dashboard-card'), [el([], ['Decoration'], { className: 'gz-decoration' })]),
    el(s('canvas.sidebar'), [el([], [el([], ['Details'], { tagName: 'SUMMARY' })], { id: 'gz-details' })]),
  ]));
  const [sidebar, card, decorated] = body.children;
  const rules = [{ p: 'canvas.sidebar', do: 'hide' }, { p: 'canvas.dashboard-card', do: 'hide' }, { p: 'canvas.dashboard-card', do: 'style', st: { o: 0, r: 12 } }];
  wear(rules);
  assert.equal(sidebar.hasAttribute('data-gz-r-hide'), false, 'task controls stay reachable');
  assert.equal(body.children[3].hasAttribute('data-gz-r-hide'), false, 'disclosure controls stay reachable');
  assert.equal(card.hasAttribute('data-gz-r-hide'), true, 'ordinary native parts can still be hidden');
  assert.equal(decorated.hasAttribute('data-gz-r-hide'), true, 'decorations do not disable native hiding');
  const control = new El(card.doc, [], [new Text(card.doc, 'Create')], { className: 'gz-mk', tagName: 'BUTTON' });
  card.append(control);
  wear(rules);
  assert.equal(card.hasAttribute('data-gz-r-hide'), false);
  assert.equal(card.style.getPropertyValue('--gz-r-o'), '');
  assert.equal(card.style.getPropertyValue('--gz-r-r'), '12px', 'safe styling remains');
  off();
  assert.deepEqual([sidebar.attrs, card.attrs, [...card.style.vars]], [{}, {}, []]);
});

test('hide and style: attributes and variables on the part\'s elements, the sheet while worn, all gone when taken off', () => {
  const { body, wear, off, sheet, doc, fonts } = page('canvas', (el, s) => el([], [
    el(s('canvas.dashboard-card'), [el(s('canvas.dashboard-card.title'), [' Biology '])]),
    el(s('canvas.dashboard-card'), [el(s('canvas.dashboard-card.title'), ['History'])]),
    el(s('canvas.footer'), ['©']),
  ]));
  const [a, b] = body.querySelectorAll(P.get('canvas.dashboard-card').s);
  const foot = body.querySelector(P.get('canvas.footer').s);
  wear([{ p: 'canvas.footer', do: 'hide' }, { p: 'canvas.dashboard-card', do: 'style', st: { bg: 'accent-soft', r: 16, f: 'lexend' } }]);
  assert.equal(sheet().href, 'ext/features/rules.css');
  assert.equal(foot.getAttribute('data-gz-r-hide'), '');
  for (const card of [a, b]) {
    assert.equal(card.getAttribute('data-gz-r-st'), 'bg r f');
    assert.equal(card.style.getPropertyValue('--gz-r-bg'), 'var(--gz-accent-soft)');
    assert.equal(card.style.getPropertyValue('--gz-r-r'), '16px');
  }
  assert.deepEqual(fonts, ['lexend']);
  // Another pass over an unchanged page writes nothing (each write is a mutation the next pass would see).
  const writes = doc.writes;
  wear([{ p: 'canvas.footer', do: 'hide' }, { p: 'canvas.dashboard-card', do: 'style', st: { bg: 'accent-soft', r: 16, f: 'lexend' } }]);
  assert.equal(doc.writes, writes);
  // A changed Look: what it no longer asks for comes off.
  wear([{ p: 'canvas.dashboard-card', do: 'style', st: { r: 4 } }]);
  assert.ok(!foot.hasAttribute('data-gz-r-hide'));
  assert.equal(a.getAttribute('data-gz-r-st'), 'r');
  assert.deepEqual([...a.style.vars], [['--gz-r-r', '4px']]);
  off();
  for (const e of [a, b, foot]) assert.deepEqual([e.attrs, [...e.style.vars]], [{}, []]);
  assert.equal(sheet(), null);
});

test('labels swap the first text and put back exactly what the page has, and a nickname wins', () => {
  const { body, wear } = page('canvas', (el, s) => el([], [
    el(s('canvas.dashboard-card.title'), [el([], ['\n  Calculus I  '])]),
    el(s('canvas.dashboard-card.title'), [el([], ['History'], { className: 'gz-new' }), el([], ['World History'])]),
  ]));
  const [one, two] = body.querySelectorAll(P.get('canvas.dashboard-card.title').s);
  const t1 = one.texts()[0], t2 = two.texts()[1];
  wear([{ p: 'canvas.dashboard-card.title', do: 'label', t: 'Math' }]);
  assert.equal(t1.data, '\n  Math  ', 'the real text\'s spacing stays');
  assert.equal(t2.data, 'Math', 'Glaze\'s own text is skipped');
  assert.equal(two.texts()[0].data, 'History');
  wear([{ p: 'canvas.dashboard-card.title', do: 'label', t: 'Maths' }]);
  assert.equal(t1.data, '\n  Maths  ');
  // The page writes the name again under the label: that is what comes back.
  t2.data = 'World History (new)';
  wear([{ p: 'canvas.dashboard-card.title', do: 'label', t: 'Maths' }]);
  assert.equal(t2.data, 'Maths');
  wear(null);
  assert.equal(t1.data, '\n  Calculus I  ');
  assert.equal(t2.data, 'World History (new)');
  // A nickname (content-ultra.js keeps the real name in data-gz-real) is left alone, and put back right if it came later.
  wear([{ p: 'canvas.dashboard-card.title', do: 'label', t: 'Maths' }]);
  const holder = t1.parentElement;
  Object.assign(holder.dataset, { gzReal: t1.data, gzNick: 'Calc' });
  t1.data = 'Calc';
  wear([{ p: 'canvas.dashboard-card.title', do: 'label', t: 'Maths' }]);
  assert.equal(t1.data, 'Calc');
  assert.equal(holder.dataset.gzReal, '\n  Calculus I  ');
});

test('moves go beside the other part in the same container, leave a marker, and go back to it', () => {
  const { body: tabs, wear, off } = page('canvas', canvasNav);
  const names = () => tabs.children.filter((n) => n instanceof El).map((e) => e.texts()[0].data);
  wear([{ p: 'canvas.course-nav.files', do: 'move', to: 'canvas.course-nav.home', at: 'before' }]);
  assert.deepEqual(names(), ['Files', 'Home', 'Grades']);
  assert.equal(tabs.children.filter((n) => n.nodeType === 8).length, 1, 'one marker where Files was');
  wear([{ p: 'canvas.course-nav.files', do: 'move', to: 'canvas.course-nav.home', at: 'before' }]);
  assert.deepEqual(names(), ['Files', 'Home', 'Grades']);
  wear([{ p: 'canvas.course-nav.files', do: 'move', to: 'canvas.course-nav.home', at: 'after' }]);
  assert.deepEqual(names(), ['Home', 'Files', 'Grades']);
  off();
  assert.deepEqual(names(), ['Home', 'Grades', 'Files']);
  assert.equal(tabs.children.length, 3, 'the marker is gone');
});

test('never on a quiz or a tool\'s page, never over Glaze\'s own pieces, never hiding Glaze settings', () => {
  for (const [site, at] of [['canvas', '/courses/1/quizzes/2/take'], ['canvas', '/courses/1/external_tools/9'], ['moodle', '/mod/quiz/attempt.php'], ['ultra', '/ultra/courses/_1_1/outline/assessment/_2_1/overview'], ['ultra', '/ultra/courses/_1_1/outline/lti/launchFrame/_3_1']]) {
    const part = { canvas: 'canvas.footer', moodle: 'moodle.footer', ultra: 'ultra.nav.footer' }[site];
    const { body, wear, sheet } = page(site, (el, s) => el([], [el(s(part), ['x'])]), at);
    wear([{ p: part, do: 'hide' }]);
    assert.ok(!body.children[0].hasAttribute('data-gz-r-hide'), at);
    assert.equal(!!sheet(), false, at);
  }
  const { body, wear } = page('ultra', (el, s) => el([], [
    el(s('ultra.nav.footer'), [el([], ['Glaze settings'], { href: '#glaze' })]),
    el(s('ultra.nav.footer'), ['Privacy'], { id: 'gz-own' }),
    el(s('ultra.nav.footer'), ['Terms']),
  ]));
  wear([{ p: 'ultra.nav.footer', do: 'hide' }, { p: 'ultra.nav', do: 'hide' }]);
  assert.deepEqual(body.children.map((e) => e.hasAttribute('data-gz-r-hide')), [false, false, true]);
});

test('quiz overview and tool entry pages clear every active rule on SPA navigation', () => {
  const paths = [
    ['canvas', '/courses/1/quizzes/2'], ['canvas', '/courses/1/quizzes/2/submissions/3'],
    ['canvas', '/courses/1/external_tools'], ['moodle', '/mod/quiz/view.php'], ['moodle', '/mod/lti/auth.php'],
  ];
  for (const [site, at] of paths) {
    const part = site === 'canvas' ? 'canvas.footer' : 'moodle.footer';
    const { body, wear, go, sheet } = page(site, (el, s) => el([], [el(s(part), ['Footer'])]));
    wear([{ p: part, do: 'hide' }, { p: part, do: 'style', st: { o: 0 } }]);
    assert.ok(sheet());
    go(at);
    assert.equal(sheet(), null, at);
    assert.deepEqual([body.children[0].attrs, [...body.children[0].style.vars]], [{}, []], at);
  }
});

test('opacity cannot hide a container holding Glaze settings', () => {
  const { body, wear, R } = page('ultra', (el, s) => el([], [
    el(s('ultra.nav'), [el([], ['Glaze settings'], { href: '#glaze' })]),
    el(s('ultra.nav.footer'), ['Footer']),
  ]));
  const [nav, footer] = body.children;
  wear([{ p: 'ultra.nav', do: 'style', st: { o: 0, bg: '#112233' } }, { p: 'ultra.nav.footer', do: 'style', st: { o: 0 } }]);
  assert.equal(nav.style.getPropertyValue('--gz-r-o'), '');
  assert.equal(nav.getAttribute('data-gz-r-st'), 'bg');
  assert.equal(nav.style.getPropertyValue('--gz-r-bg'), '#112233', 'other navigation styling still works');
  assert.equal(footer.style.getPropertyValue('--gz-r-o'), '0');
  footer.append(nav.children[0]);
  R.sync();
  assert.equal(footer.style.getPropertyValue('--gz-r-o'), '', 'a late settings item is protected on the next pass');
});

test('a colour rule that would hide Glaze settings in its own background is ignored, as opacity is', () => {
  // The page's palette (content.js sets it on <html>) and what Ultra draws: its rail on surface-2, Glaze's item in ink.
  const tokens = { '--gz-surface-2': '#102030', '--gz-ink': '#eef2f8' };
  const getComputedStyle = (e) => ({
    getPropertyValue: (k) => (e === e.doc.root ? tokens[k] || '' : ''),
    color: e.href === '#glaze' ? 'rgb(238, 242, 248)' : '', backgroundColor: e.sel.has(P.get('ultra.nav').s) ? 'rgb(16, 32, 48)' : 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
  });
  const { body, wear } = page('ultra', (el, s) => el([], [
    el(s('ultra.nav'), [el([], ['Glaze settings'], { href: '#glaze' })]),
    el(s('ultra.nav.footer'), ['Footer']),
  ]), '/', { getComputedStyle });
  const [nav, footer] = body.children;
  const colours = () => [nav.getAttribute('data-gz-r-st'), nav.style.getPropertyValue('--gz-r-fg'), nav.style.getPropertyValue('--gz-r-bg')];
  // The audit's rule: foreground and background both surface-2. Other styling stays; a part without Glaze settings keeps it.
  wear([{ p: 'ultra.nav', do: 'style', st: { fg: 'surface-2', bg: 'surface-2', r: 8 } }, { p: 'ultra.nav.footer', do: 'style', st: { fg: 'surface-2', bg: 'surface-2' } }]);
  assert.deepEqual(colours(), ['r', '', '']);
  assert.equal(nav.style.getPropertyValue('--gz-r-r'), '8px');
  assert.equal(footer.getAttribute('data-gz-r-st'), 'fg bg', 'ordinary parts are the Look\'s to colour');
  // Nearly the same colour, a token against its own hex, or one side against what the page already draws.
  for (const st of [{ fg: '#112233', bg: '#13253a' }, { fg: 'surface-2', bg: '#102030' }, { fg: '#102030' }, { fg: 'surface-2' }, { bg: '#eef2f8' }, { bg: 'ink' }]) {
    wear([{ p: 'ultra.nav', do: 'style', st }]);
    assert.deepEqual(colours(), [null, '', ''], JSON.stringify(st));
  }
  // Colours Glaze settings can be read on stay.
  wear([{ p: 'ultra.nav', do: 'style', st: { fg: '#ffffff', bg: '#112233' } }]);
  assert.deepEqual(colours(), ['fg bg', '#ffffff', '#112233']);
  wear([{ p: 'ultra.nav', do: 'style', st: { bg: '#000000' } }]);
  assert.deepEqual(colours(), ['bg', '', '#000000']);
});

test('Glaze classes are protected even after native classes', () => {
  const { body, wear } = page('ultra', (el, s) => el([], [
    el(s('ultra.nav.footer'), ['Own footer'], { className: 'native gz-own' }),
    el(s('ultra.course-card.title'), [el([], ['Own title'], { className: 'native gz-own' }), el([], ['LMS title'])]),
  ]));
  wear([{ p: 'ultra.nav.footer', do: 'hide' }, { p: 'ultra.course-card.title', do: 'label', t: 'New title' }]);
  assert.equal(body.children[0].hasAttribute('data-gz-r-hide'), false);
  assert.deepEqual(body.children[1].texts().map((n) => n.data), ['Own title', 'New title']);
});

test('SPA removal of a moved node never resurrects it from its marker', () => {
  for (const finish of ['sync', 'off', 'change']) {
    const { body: tabs, wear, off, R } = page('canvas', canvasNav);
    const files = tabs.children[2];
    wear([{ p: 'canvas.course-nav.files', do: 'move', to: 'canvas.course-nav.home', at: 'before' }]);
    files.remove();
    if (finish === 'sync') R.sync(); else if (finish === 'off') off(); else wear([{ p: 'canvas.course-nav.home', do: 'label', t: 'Start' }]);
    assert.equal(files.isConnected, false, finish);
    assert.equal(tabs.children.some((n) => n.nodeType === 8), false, finish);
  }
});

test('changing a Look resets move retries while repeated LMS interference stays bounded', () => {
  const { body: tabs, wear, off, R } = page('canvas', canvasNav);
  const files = tabs.children[2];
  const rule = { p: 'canvas.course-nav.files', do: 'move', to: 'canvas.course-nav.home', at: 'before' };
  wear([rule]);
  for (let i = 0; i < 4; i++) { tabs.append(files); R.sync(); }
  assert.equal(tabs.children.filter((n) => n instanceof El).at(-1), files, 'the LMS wins after bounded retries');
  wear([{ ...rule, to: 'canvas.course-nav.grades' }]);
  assert.equal(files.nextElementSibling.texts()[0].data, 'Grades', 'a different move gets a fresh retry budget');
  off();
  assert.deepEqual(tabs.children.map((e) => e.texts()[0].data), ['Home', 'Grades', 'Files']);
});

test('show removes the rule hide without changing the LMS inline display', () => {
  const { body, wear, off } = page('canvas', (el, s) => el([], [el(s('canvas.footer'), ['Footer'])]));
  const foot = body.children[0];
  foot.style.setProperty('display', 'grid');
  wear([{ p: 'canvas.footer', do: 'hide' }]);
  assert.equal(foot.hasAttribute('data-gz-r-hide'), true);
  wear([{ p: 'canvas.footer', do: 'hide' }, { p: 'canvas.footer', do: 'show' }]);
  assert.equal(foot.hasAttribute('data-gz-r-hide'), false);
  assert.equal(foot.style.getPropertyValue('display'), 'grid');
  off();
  assert.deepEqual([...foot.style.vars], [['display', 'grid']]);
});

// ---- the boards' course cards (features/coursecards.js): Glaze's own, drawn from the LMS's -------------------------------
const BOARD = { ultra: '.gz-w-body > article.gz-course-card', canvas: '.gz-w-body > .ic-DashboardCard[data-gz-tile-card]' };
const ON_BOARD = {
  'ultra.course-card': BOARD.ultra, 'ultra.course-card.banner': `${BOARD.ultra} .course-banner`, 'ultra.course-card.title': `${BOARD.ultra} .course-title`,
  'ultra.course-card.id': `${BOARD.ultra} .course-id`, 'ultra.course-card.status': '', 'ultra.course-card.instructors': '',
  'canvas.dashboard-card': BOARD.canvas, 'canvas.dashboard-card.image': `${BOARD.canvas} .ic-DashboardCard__header_image`,
  'canvas.dashboard-card.title': `${BOARD.canvas} .ic-DashboardCard__header-title`, 'canvas.dashboard-card.subtitle': `${BOARD.canvas} .ic-DashboardCard__header-subtitle`,
  'canvas.dashboard-card.term': `${BOARD.canvas} .ic-DashboardCard__header-term`, 'canvas.dashboard-card.actions': `${BOARD.canvas} .ic-DashboardCard__action-container`,
  'canvas.dashboard-card.menu': '',
};

test("each course-card part names its piece on the boards' cards, or none; the editor's names stay the LMS's", () => {
  assert.deepEqual({ ...P.BOARD }, BOARD);
  for (const [name, b] of Object.entries(ON_BOARD)) assert.equal(P.get(name).b, b, name);
  // Every other part, Moodle's cards among them (Moodle has no board), has no piece there.
  for (const p of P.PARTS.values()) if (!Object.hasOwn(ON_BOARD, p.name)) assert.equal(p.b, '', p.name);
  // Board pieces sit inside a board's card only: a board selector never reaches the LMS's own page.
  for (const p of P.PARTS.values()) if (p.b) assert.ok(p.b.startsWith(BOARD[p.site]) && !/[{};]/.test(p.b), p.name);
  // The editor's list is the same: no new part, no new field.
  assert.deepEqual(Object.keys(P.list('ultra')[0]), ['name', 'label', 'hide', 'text', 'move', 'st']);
  assert.ok(!['ultra', 'canvas'].some((site) => P.list(site).some((p) => /(^|[.-])board/.test(p.name))));
});

// A board tile (features/widgets.js tileEl) holding its card, built as features/coursecards.js builds each.
const ultraTile = (el, s, title = 'Biology') => el([], [
  el([], [el([], ['BIOLOGY'])], { className: 'gz-w-head' }),
  el([], [el(BOARD.ultra, [
    el(ON_BOARD['ultra.course-card.banner'], [], { className: 'course-banner' }),
    el([], [el([], ['Fall 2026'], { className: 'gz-course-term' }), el(ON_BOARD['ultra.course-card.title'], [title], { className: 'course-title', href: '/ultra/courses/_101_1/outline' }),
      el(ON_BOARD['ultra.course-card.id'], ['BIO-101'], { className: 'course-id' }), el([], ['A'], { className: 'gz-course-grade' })], { className: 'element-details' }),
    el([], ['⋯'], { className: 'gz-cm-btn', tagName: 'BUTTON' }),
  ], { className: 'gz-course-card' })], { className: 'gz-w-body' }),
], { className: 'gz-w' });
const ultraNative = (el, s) => el(s('ultra.course-card'), [el(s('ultra.course-card.banner'), []), el(s('ultra.course-card.title'), ['Biology']), el(s('ultra.course-card.status'), ['Open'])]);

test("a Look's card rules reach the board's cards as the LMS's: the card, its picture, title and code", () => {
  const { body, wear, off, sheet } = page('ultra', (el, s) => el([], [ultraNative(el, s), ultraTile(el, s)]));
  const [native, tile] = body.children;
  const card = tile.querySelector(BOARD.ultra), banner = tile.querySelector(ON_BOARD['ultra.course-card.banner']);
  const title = tile.querySelector(ON_BOARD['ultra.course-card.title']), code = tile.querySelector(ON_BOARD['ultra.course-card.id']);
  wear([
    { p: 'ultra.course-card', do: 'style', st: { r: 24, bc: 'accent', bw: 3 } },
    { p: 'ultra.course-card.banner', do: 'style', st: { bg: '#331144' } },
    { p: 'ultra.course-card.title', do: 'label', t: 'My favourite' },
    { p: 'ultra.course-card.id', do: 'style', st: { fg: 'accent' } },
    { p: 'ultra.course-card.status', do: 'hide' },
  ]);
  assert.ok(sheet());
  for (const c of [native, card]) {
    assert.equal(c.getAttribute('data-gz-r-st'), 'r bc bw');
    assert.equal(c.style.getPropertyValue('--gz-r-r'), '24px');
  }
  assert.equal(banner.style.getPropertyValue('--gz-r-bg'), '#331144');
  assert.equal(title.texts()[0].data, 'My favourite', "the board card's title is relabelled");
  assert.equal(code.getAttribute('data-gz-r-st'), 'fg');
  // The board's own pieces stay Glaze's: its header, term, grade and menu take nothing; status has no piece there.
  for (const e of tile.all()) if (![card, banner, title, code].includes(e)) assert.deepEqual([e.attrs, [...e.style.vars]], [{}, []], e.className);
  assert.equal(tile.texts()[0].data, 'BIOLOGY', "the tile's header keeps its name");
  off();
  for (const e of [card, banner, code]) assert.deepEqual([e.attrs, [...e.style.vars]], [{}, []]);
  assert.equal(title.texts()[0].data, 'Biology');
});

test("on a board, the whole card is never hidden or faded (the tile would stay, empty); its pieces may be", () => {
  const { body, wear } = page('canvas', (el, s) => el([], [el([], [el([], [el(BOARD.canvas, [
    el(ON_BOARD['canvas.dashboard-card.image'], []), el(ON_BOARD['canvas.dashboard-card.title'], [el([], ['Calculus I'])]),
  ])], { className: 'gz-w-body' })], { className: 'gz-w' }), el(s('canvas.dashboard-card'), ['Calculus I'])]));
  const [tile, native] = body.children;
  const card = tile.querySelector(BOARD.canvas), image = tile.querySelector(ON_BOARD['canvas.dashboard-card.image']);
  wear([{ p: 'canvas.dashboard-card', do: 'hide' }, { p: 'canvas.dashboard-card', do: 'style', st: { o: 40, r: 12 } }, { p: 'canvas.dashboard-card.image', do: 'hide' }]);
  assert.equal(native.hasAttribute('data-gz-r-hide'), true, "Canvas's own card hides as before");
  assert.equal(native.style.getPropertyValue('--gz-r-o'), '0.4');
  assert.equal(card.hasAttribute('data-gz-r-hide'), false);
  assert.equal(card.style.getPropertyValue('--gz-r-o'), '');
  assert.equal(card.style.getPropertyValue('--gz-r-r'), '12px', 'the rest of its style stays');
  assert.equal(image.hasAttribute('data-gz-r-hide'), true, "the card's picture hides");
});

test('what a label covers on a board card is readable as the real text, and a nickname shown there wins', () => {
  const { body, wear, R } = page('ultra', (el, s) => el([], [ultraTile(el, s, 'Biology'), ultraTile(el, s, 'Bio (mine)')]));
  const [plain, nicked] = body.children.map((t) => t.querySelector(ON_BOARD['ultra.course-card.title']));
  nicked.dataset.gzNick = '';
  wear([{ p: 'ultra.course-card.title', do: 'label', t: 'Renamed' }]);
  assert.equal(plain.texts()[0].data, 'Renamed');
  assert.equal(R.real(plain), 'Biology', 'features/coursecards.js compares its own text with this, not with the label');
  assert.equal(nicked.texts()[0].data, 'Bio (mine)', "the student's nickname is theirs");
});

test('board card piece moves use the board container and restore the original order', () => {
  const { body, wear } = page('ultra', ultraTile);
  const title = body.querySelector(ON_BOARD['ultra.course-card.title']);
  const code = body.querySelector(ON_BOARD['ultra.course-card.id']);
  wear([{ p: 'ultra.course-card.id', do: 'move', to: 'ultra.course-card.title', at: 'before' }]);
  assert.equal(title.previousElementSibling, code, 'move the board code before its own title');
  wear(null);
  assert.equal(title.nextElementSibling, code, 'put the code back after its title');
  wear([{ p: 'ultra.course-card.id', do: 'move', to: 'ultra.course-card.status', at: 'before' }]);
  assert.equal(title.nextElementSibling, code, 'a destination absent from board cards does nothing');
});
