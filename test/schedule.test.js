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
});
