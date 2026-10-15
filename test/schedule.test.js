// Auto light/dark on a schedule (W5): the boundary math in defaults.js, and the content script's quiz gate.
process.env.TZ = 'America/New_York'; // DST: 2026-03-08 02:00 → 03:00, 2026-11-01 02:00 → 01:00
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../defaults.js');

const at = (s) => new Date(s); // local time, no zone in the string
const iso = (d) => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toTimeString().slice(0, 5)}`;

test('settings: old auto settings keep following the device; times are checked', () => {
  const old = D.GZ_SANITIZE({ auto: { on: true, light: 'Paper', dark: 'Midnight' } });
  assert.deepEqual(old.auto, { on: true, mode: 'device', from: '20:00', to: '08:00', light: 'Paper', dark: 'Midnight' });
  const s = D.GZ_SANITIZE({ auto: { on: true, mode: 'schedule', from: '21:30', to: '7:00' } });
  assert.equal(s.auto.mode, 'schedule');
  assert.equal(s.auto.from, '21:30');
  assert.equal(s.auto.to, '08:00'); // not HH:MM
  for (const bad of ['24:00', '12:60', ' 12:00', 1200, null]) assert.equal(D.GZ_SANITIZE({ auto: { from: bad } }).auto.from, '20:00');
  assert.equal(D.GZ_SANITIZE({ auto: { mode: 'sunset' } }).auto.mode, 'device');
});

test('dark: wraps past midnight, plain ranges, equal times never dark', () => {
  const dark = (from, to, t) => D.GZ_SCHEDULE_DARK(from, to, at(`2026-10-15T${t}`));
  assert.deepEqual(['19:59', '20:00', '23:59', '00:00', '07:59', '08:00', '12:00'].map((t) => dark('20:00', '08:00', t)), [false, true, true, true, true, false, false]);
  assert.deepEqual(['08:59', '09:00', '16:59', '17:00'].map((t) => dark('09:00', '17:00', t)), [false, true, true, false]);
  assert.deepEqual(['20:00', '03:00'].map((t) => dark('20:00', '20:00', t)), [false, false]);
});

test('next boundary: the nearer of from and to, today or tomorrow; none for equal times', () => {
  const next = (from, to, t) => iso(D.GZ_SCHEDULE_NEXT(from, to, at(t)));
  assert.equal(next('20:00', '08:00', '2026-10-15T12:00'), '2026-10-15 20:00');
  assert.equal(next('20:00', '08:00', '2026-10-15T20:00'), '2026-10-16 08:00'); // exactly on one: the other
  assert.equal(next('20:00', '08:00', '2026-10-15T23:00'), '2026-10-16 08:00');
  assert.equal(next('20:00', '08:00', '2026-10-15T03:00'), '2026-10-15 08:00');
  assert.equal(next('09:00', '17:00', '2026-10-15T18:00'), '2026-10-16 09:00');
  assert.equal(D.GZ_SCHEDULE_NEXT('20:00', '20:00', at('2026-10-15T12:00')), null);
  assert.equal(D.GZ_SCHEDULE_NEXT('20:00', '08:00', at('2026-12-31T21:00')).getFullYear(), 2027);
});

test('DST: boundaries stay on the wall clock across the spring and fall changes', () => {
  // Spring: 08:00 the morning after the change is 11 hours after 20:00, not 12.
  const spring = D.GZ_SCHEDULE_NEXT('20:00', '08:00', at('2026-03-07T20:00'));
  assert.equal(iso(spring), '2026-03-08 08:00');
  assert.equal((spring - at('2026-03-07T20:00')) / 36e5, 11);
  // A boundary in the skipped hour lands on the hour after it.
  assert.equal(iso(D.GZ_SCHEDULE_NEXT('02:30', '08:00', at('2026-03-08T01:00'))), '2026-03-08 03:30');
  assert.equal(D.GZ_SCHEDULE_DARK('02:30', '08:00', at('2026-03-08T03:30')), true);
  // Fall: 13 hours.
  const fall = D.GZ_SCHEDULE_NEXT('20:00', '08:00', at('2026-10-31T20:00'));
  assert.equal(iso(fall), '2026-11-01 08:00');
  assert.equal((fall - at('2026-10-31T20:00')) / 36e5, 13);
});

test('the palette painted follows the schedule, and the device only in device mode', () => {
  const s = D.GZ_SANITIZE({ auto: { on: true, mode: 'schedule', from: '20:00', to: '08:00', light: 'Paper', dark: 'Midnight' } });
  const paper = D.GZ_PRESET('Paper'), midnight = D.GZ_PRESET('Midnight');
  assert.equal(D.GZ_ACTIVE_COLORS(s, true, at('2026-10-15T12:00')), paper);
  assert.equal(D.GZ_ACTIVE_COLORS(s, false, at('2026-10-15T21:00')), midnight);
  const device = { ...s, auto: { ...s.auto, mode: 'device' } };
  assert.equal(D.GZ_ACTIVE_COLORS(device, true, at('2026-10-15T12:00')), midnight);
  assert.equal(D.GZ_ACTIVE_COLORS({ ...s, auto: { ...s.auto, on: false } }, true), s.colors);
});

// ---- content.js: the pre-paint path ---------------------------------------------------------------------------
const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');

test('pre-paint: the first enable waits on the quiz gate, and the first paint reads the schedule now', () => {
  // The kept settings are read, the gate defined, then the first enable; nothing caches the time in between.
  const kept = source.indexOf('const kept = sessionStorage.getItem(KEPT)');
  const gate = source.indexOf('  const on = (s) =>');
  const first = source.indexOf('  if (on(settings)) enable();');
  assert.ok(kept > 0 && gate > kept && first > gate, 'kept settings, then the gate, then the first enable');
  assert.match(source, /const base = GZ_ACTIVE_COLORS\(s, darkMQ\.matches\);/);
});

test('Keep quizzes light: quiz taking and external tool pages on Canvas only, and only when asked', () => {
  const line = source.match(/  const on = (\(s\) => .+);/)[1];
  const on = (s, { pathname = '/courses/1/pages/x', tool = false, ultra = false } = {}) => vm.runInNewContext(`(${line})(s)`, {
    s, ultra, location: { pathname }, document: { getElementById: (id) => (tool && id === 'tool_content' ? {} : null) },
  });
  const quiet = D.GZ_SANITIZE({ enhance: { quizLight: true } });
  const plain = D.GZ_SANITIZE({});
  for (const pathname of ['/courses/1/quizzes/2/take', '/courses/1/quizzes/2/take/questions/9', '/courses/1/quizzes/2/history', '/courses/1/external_tools/5']) {
    assert.equal(on(quiet, { pathname }), false, pathname);
    assert.equal(on(plain, { pathname }), true, pathname);
  }
  assert.equal(on(quiet, { tool: true }), false); // New Quizzes, launched from an assignment
  assert.equal(on(quiet, { pathname: '/courses/1/quizzes/2' }), true); // the quiz's start page
  assert.equal(on(quiet, { pathname: '/courses/1/quizzes/2/take', ultra: true }), true);
  assert.equal(on({ ...plain, enabled: false }), false);
  assert.equal(on(quiet, { pathname: '/courses/1/quizzes/2/takeover' }), true); // whole segments only
});

// ---- Codex review fixes ---------------------------------------------------------------------------------------
test('times: only "HH:MM" strings; arrays, objects and numbers fall back without throwing', () => {
  for (const bad of [['21:00'], JSON.parse('{"toString":null}'), 2100, true, '21:00 ', '9:00']) {
    assert.equal(D.GZ_SANITIZE({ auto: { from: bad, to: bad } }).auto.from, '20:00');
  }
  assert.equal(D.GZ_SANITIZE({ auto: { from: '00:00', to: '23:59' } }).auto.to, '23:59');
});

// The next flip is where dark-now changes: no change before it (minute steps), a change at it.
const agree = (from, to, now) => {
  const next = D.GZ_SCHEDULE_NEXT(from, to, now);
  const here = D.GZ_SCHEDULE_DARK(from, to, now);
  for (let t = +now; t < +next; t += 6e4) assert.equal(D.GZ_SCHEDULE_DARK(from, to, new Date(t)), here, `${from}-${to} from ${now.toISOString()}: changed at ${new Date(t).toISOString()}, before ${next.toISOString()}`);
  assert.notEqual(D.GZ_SCHEDULE_DARK(from, to, next), here, `${from}-${to}: no change at ${next.toISOString()}`);
};

test('DST: dark-now and the next flip agree through the skipped and the repeated hour', () => {
  // Fall: the second 01:21 (EST) with 00:00 → 01:30: the window ended at the first 01:30; next is the next midnight.
  const second = new Date('2026-11-01T06:21:00Z');
  assert.equal(second.getHours(), 1);
  assert.equal(D.GZ_SCHEDULE_DARK('00:00', '01:30', second), false);
  assert.equal(iso(D.GZ_SCHEDULE_NEXT('00:00', '01:30', second)), '2026-11-02 00:00');
  // Spring: 02:30 doesn't exist and starts at 03:30, so 03:00 is still light and 01:55's next flip is 03:30.
  assert.equal(D.GZ_SCHEDULE_DARK('02:30', '08:00', at('2026-03-08T03:00')), false);
  assert.equal(iso(D.GZ_SCHEDULE_NEXT('02:30', '08:00', at('2026-03-08T01:55'))), '2026-03-08 03:30');
  assert.equal(D.GZ_SCHEDULE_DARK('03:00', '08:00', at('2026-03-08T03:00')), true);
  // A window the change turns inside out (02:30 → 03:00) is empty that day, not a whole day.
  assert.equal(D.GZ_SCHEDULE_DARK('02:30', '03:00', at('2026-03-08T12:00')), false);
  for (const [from, to] of [['00:00', '01:30'], ['01:30', '00:00'], ['01:15', '01:45'], ['02:30', '08:00'], ['20:00', '02:30'], ['02:30', '03:00'], ['03:00', '02:00'], ['20:00', '08:00']]) {
    for (const t of ['2026-03-07T22:10:00Z', '2026-03-08T06:55:00Z', '2026-03-08T07:20:00Z', '2026-03-08T08:00:00Z', '2026-10-31T23:00:00Z', '2026-11-01T05:10:00Z', '2026-11-01T05:40:00Z', '2026-11-01T06:21:00Z', '2026-11-01T06:50:00Z']) agree(from, to, new Date(t));
  }
});

test('the clock (features/schedule.js): one timeout to the next flip, re-armed, repaints only on a change', () => {
  let now = +new Date('2026-10-15T19:59:00-04:00');
  const pending = new Map();
  let id = 0, painted = 0, visible;
  const RealDate = Date;
  const ctx = vm.createContext({
    globalThis: {}, GZ_SCHEDULE_DARK: D.GZ_SCHEDULE_DARK, GZ_SCHEDULE_NEXT: D.GZ_SCHEDULE_NEXT, Math,
    Date: class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } },
    setTimeout: (f, ms) => { pending.set(++id, [f, ms]); return id; }, clearTimeout: (i) => pending.delete(i),
    document: { hidden: false, addEventListener: (n, f) => { visible = f; } },
  });
  const S = vm.runInContext(fs.readFileSync(require.resolve('../features/schedule.js'), 'utf8'), ctx);
  let worn = { on: true, mode: 'schedule', from: '20:00', to: '08:00' };
  const hook = { auto: () => worn, reapply: () => { painted++; S.arm(hook); } };
  for (let i = 0; i < 5; i++) S.arm(hook);
  assert.equal(pending.size, 1);
  assert.equal([...pending.values()][0][1], 6e4);
  now += 6e4; // 20:00: it fires and repaints once
  const [[k, [fire]]] = pending;
  pending.delete(k);
  fire();
  assert.equal(painted, 1);
  assert.equal(pending.size, 1);
  assert.equal([...pending.values()][0][1], 6e5); // 12 hours away: rechecked within 10 minutes
  visible(); // shown again, no change: re-armed, no repaint
  assert.deepEqual([painted, pending.size], [1, 1]);
  worn = null; // device mode, or off
  S.arm(hook);
  assert.equal(pending.size, 0);
});

// The sweep's instructor-colour check, run on stand-in elements (no browser cascade claimed).
const sweepWith = (palette) => {
  const C = require('../lib/color.js');
  const ctx = vm.createContext({
    C, ultra: false, darkTheme: true, palette, accentInk: C.parse(palette['--gz-accent-ink']), innerHeight: 900,
    SKIP: /^(img|video|canvas|svg|iframe|picture|source|path|use|script|style|link|meta)$/i, FIELD: /^(input|textarea|select)$/i,
    getComputedStyle: (e) => e.cs, hasText: (e) => e.childNodes.some((n) => n.nodeType === 3 && n.textContent.trim()),
    document: { documentElement: { cs: { getPropertyValue: () => palette['--gz-ink'] } } }, instBlue: () => false, tagBrand() {}, sweepColors: (e, c) => c,
  });
  const from = source.indexOf('  const SWEEP_TAGS'), to = source.indexOf('  const sweepAll', from);
  vm.runInContext(`${source.slice(from, to)}; globalThis.api = { sweepEls, relift }`, ctx);
  return ctx;
};
const content = { style: {}, parentElement: null, classList: { contains: (n) => n === 'user_content' } };
const textEl = (color, link = false, fill = '') => {
  const attrs = new Map();
  const e = {
    tagName: link ? 'A' : 'SPAN', isConnected: true, id: '', childNodes: [{ nodeType: 3, textContent: 'answer' }], parentElement: content,
    style: { color, backgroundColor: fill }, classList: { contains: () => false }, getAttribute: () => null, getAnimations: () => [],
    cs: { color, backgroundColor: fill ? 'rgb(255, 255, 0)' : 'rgba(0, 0, 0, 0)', backgroundImage: 'none', position: 'static', transitionDuration: '0s' },
    getAttributeNames: () => [...attrs.keys()], setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k),
    toggleAttribute: (k, on) => (on ? attrs.set(k, '') : attrs.delete(k)),
    closest: (sel) => (sel === '.user_content' ? content : sel === 'a' && link ? e : null), getBoundingClientRect: () => ({ height: 20, bottom: 30 }),
  };
  return { e, attrs };
};

test('instructor text: re-checked when one dark palette changes to another; dark authored links lifted too', () => {
  const midnight = D.GZ_PRESET('Midnight'), frost = D.GZ_PRESET('Frost');
  const ctx = sweepWith(midnight);
  const teal = textEl('#006e78'); // 3.0:1 on Midnight, 2.9:1 on Frost
  const navy = textEl('#000080');
  const link = textEl('#000080', true); // an authored navy link: lifted like text
  const accent = textEl(midnight['--gz-accent'], true); // a link in the palette's accent: left alone
  const marked = textEl('#000080', false, '#ffff00'); // navy on an instructor's yellow: the highlight fix, not a lift
  ctx.api.sweepEls([teal.e, navy.e, link.e, accent.e, marked.e]);
  assert.deepEqual([teal, navy, link, accent, marked].map((x) => x.attrs.has('data-gz-lift')), [false, true, true, false, false]);
  ctx.palette = frost;
  ctx.api.relift();
  assert.equal(teal.attrs.has('data-gz-lift'), true);
  ctx.palette = midnight;
  ctx.api.relift();
  assert.equal(teal.attrs.has('data-gz-lift'), false);
  // applySettings calls it on a dark-to-dark surface change, without a full sweep, and not when the surface stays.
  const gate = source.slice(source.indexOf('    if (dark !== darkTheme) {'), source.indexOf('    if (!s.look.tooltips)'));
  let sweeps = 0, relifts = 0;
  const run = (surface, next) => vm.runInNewContext(gate, { dark: true, darkTheme: true, observer: {}, surface, colors: { '--gz-surface': next }, clearTags() {}, sweepAll: () => sweeps++, relift: () => relifts++, WeakSet });
  run(midnight['--gz-surface'], frost['--gz-surface']);
  run(frost['--gz-surface'], frost['--gz-surface']);
  assert.deepEqual([sweeps, relifts], [0, 1]);
});

test('editor: clearing a time keeps the last valid one and saves nothing', () => {
  const opts = fs.readFileSync(require.resolve('../options.js'), 'utf8');
  const s = D.GZ_SANITIZE({ auto: { on: true, mode: 'schedule', from: '21:00', to: '07:00' } });
  let changed, saves = 0;
  const control = { type: 'time', value: '', dataset: { key: 'auto.from' }, addEventListener: (n, f) => { changed = f; } };
  const start = opts.indexOf("  for (const el of $$('[data-key]')) {", opts.indexOf('// ---- generic controls'));
  const end = opts.indexOf("  for (const r of $$('.seg", start);
  vm.runInNewContext(opts.slice(start, end), {
    s, $$: () => [control], get: (p) => p.split('.').reduce((o, k) => o[k], s), set: (p, v) => { s.auto.from = v; }, group: () => 'auto',
    renderCourses() {}, refresh() {}, save: () => saves++,
  });
  changed();
  assert.deepEqual([s.auto.from, control.value, saves], ['21:00', '21:00', 0]);
  control.value = '22:15';
  changed();
  assert.deepEqual([s.auto.from, saves], ['22:15', 1]);
});
