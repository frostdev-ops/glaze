// Reminders and streak (lib/remind.js): lead times across DST and midnight in the Canvas zone, exam titles in Glaze's six
// languages, missed reminders shown once, the streak's rules, and the device state the worker keeps.
// The browser here is in Tokyo while the student's Canvas is in New York: nothing may lean on the machine's zone.
process.env.TZ = 'Asia/Tokyo';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/todo.js');
const R = require('../lib/remind.js');
const D = require('../defaults.js');

const NY = 'America/New_York';
const at = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString();
const day = (k) => T.keyDay(k);
const NOW = at('2026-10-15T16:00:00Z'); // Thursday, noon in New York
const O = D.GZ_SANITIZE({}).remind;
const TODO = { ...D.GZ_SANITIZE({}).todo, span: 'custom', unit: 'days', n: 8, start: 'rolling', past: 'month', group: false };
const row = (x) => ({ key: `assignment:${x.id || 1}`, title: 'Essay', url: '/courses/1/assignments/1', course: 'Biology', done: false, allDay: false, local: {}, ...x });
const cats = { due: true, exam: false, plan: false };
const fires = (evs) => evs.map((e) => `${e.cat} ${iso(e.at)}`);

test('its settings join the schema: every category off, three hours before by default', () => {
  const s = D.GZ_SANITIZE({});
  for (const k of ['remind', 'remindExam', 'remindPlan', 'remindClass', 'streak']) assert.equal(s.enhance[k], false, k);
  assert.deepEqual(s.remind, { m15: false, h1: false, h3: true, d1: false, d2: false, exam: '2d', plan: '15', cls: '10' });
  assert.deepEqual(D.GZ_SANITIZE({ remind: { m15: 'yes', exam: '9d', plan: 15 } }).remind, s.remind);
});

test('lead times: hours are lengths of time, days the same wall-clock time, across DST and midnight', () => {
  const o = { ...O, h3: true, d1: true, d2: true };
  // Due at 9:00 the Sunday DST ends: a day before is Saturday 9:00, 25 hours earlier.
  const fall = R.events({ rows: [row({ at: at('2026-11-01T14:00:00Z'), day: day('2026-11-01') })], cats, o, tz: NY });
  assert.deepEqual(fires(fall), ['due 2026-10-30T13:00:00.000Z', 'due 2026-10-31T13:00:00.000Z', 'due 2026-11-01T11:00:00.000Z']);
  // Spring forward: 23 hours.
  const spring = R.events({ rows: [row({ at: at('2026-03-08T13:00:00Z'), day: day('2026-03-08') })], cats, o: { ...O, d1: true, h3: false }, tz: NY });
  assert.deepEqual(fires(spring), ['due 2026-03-07T14:00:00.000Z']);
  // 11:59 PM: the day before at 11:59 PM, in New York, not in Tokyo.
  const late = R.events({ rows: [row({ at: at('2026-10-17T03:59:00Z'), day: day('2026-10-16') })], cats, o: { ...O, d1: true, h3: false }, tz: NY });
  assert.deepEqual(fires(late), ['due 2026-10-16T03:59:00.000Z']);
  // A whole-day deadline ends at midnight in the Canvas zone: three hours before is 9 PM that day.
  const whole = R.events({ rows: [row({ key: 'task:a', at: T.midnight(day('2026-10-16') + 1, NY) - 1, allDay: true, day: day('2026-10-16') })], cats, o: { ...O }, tz: NY });
  assert.deepEqual(fires(whole), ['due 2026-10-17T01:00:00.000Z']);
  assert.equal(whole[0].until, at('2026-10-17T04:00:00Z'));
  // Nothing for work that's done or has no date, nor with the category off.
  assert.deepEqual(R.events({ rows: [row({ at: NOW + 1e7, done: true }), row({ at: null, day: null })], cats, o, tz: NY }), []);
  assert.deepEqual(R.events({ rows: [row({ at: NOW + 1e7 })], cats: {}, o, tz: NY }), []);
});

test('exams: titles in all six languages, and Canvas quizzes', () => {
  const yes = {
    en: ['Midterm Exam', 'Quiz 3', 'Final', 'Unit 2 test', 'Exams week', 'Weekly quizzes'],
    de: ['Klausur Analysis', 'Abschlussprüfung', 'Zwischenprüfung Teil 1', 'Prüfungen'],
    es: ['Examen parcial', 'Prueba 2', 'Cuestionario semanal', 'Exámenes finales'],
    fr: ['Partiel de chimie', 'Contrôle continu', 'Interro 3', 'Examen final'],
    nl: ['Tentamen statistiek', 'Deeltentamen 1', 'Toets hoofdstuk 4', 'Eindtoets'],
    pt: ['Prova 1', 'Exame final', 'Questionário 2', 'Avaliação final', 'Teste de física'],
  };
  for (const [lang, titles] of Object.entries(yes)) for (const title of titles) assert.ok(R.isExam({ title }), `${lang}: ${title}`);
  for (const title of ['Essay draft', 'Lab report', 'Latest results', 'Contest entry', 'Testament reading', 'Finally done', 'Toetsenbord kopen', 'Prüfungsordnung lesen', 'Reflection']) {
    assert.ok(!R.isExam({ title }), title);
  }
  assert.ok(R.isExam({ type: 'quiz', title: 'Week 3' }));
  // Its own lead time, and an exam's reminder wins a moment it shares with a due-date one.
  const r = row({ title: 'Midterm', at: at('2026-10-20T13:00:00Z'), day: day('2026-10-20') });
  assert.deepEqual(fires(R.events({ rows: [r], cats: { due: true, exam: true }, o: { ...O, h3: false, d2: true, exam: '2d' }, tz: NY })), ['exam 2026-10-18T13:00:00.000Z']);
  assert.deepEqual(fires(R.events({ rows: [r], cats: { exam: true }, o: { ...O, exam: '1w' }, tz: NY })), ['exam 2026-10-13T13:00:00.000Z']);
  assert.deepEqual(fires(R.events({ rows: [r], cats: { due: true, exam: true }, o: { ...O, h3: true, exam: '1d' }, tz: NY })), ['exam 2026-10-19T13:00:00.000Z', 'exam 2026-10-20T10:00:00.000Z']);
});

test('plans: a "do on" day at its start, a focus session before it begins', () => {
  const r = row({ at: null, day: null, local: { on: '2026-10-16', sessions: [{ at: at('2026-10-16T18:00:00Z'), min: 45 }] } });
  const evs = R.events({ rows: [r], cats: { plan: true }, o: { ...O, plan: '15' }, tz: NY });
  assert.deepEqual(fires(evs), ['day 2026-10-16T04:00:00.000Z', 'session 2026-10-16T17:45:00.000Z']);
  assert.equal(evs[0].until, at('2026-10-17T04:00:00Z'));
  assert.equal(evs[1].until, at('2026-10-16T18:45:00Z'));
  // Other packages' reminders (class start, study) come in through extra.
  assert.equal(R.events({ rows: [], cats: {}, o: O, tz: NY, extra: [{ key: 'class:bio', cat: 'class', at: NOW, until: NOW + 6e5, title: 'Biology' }] })[0].cat, 'class');
});

test('missed while no page was open: one per item, newest first, once', () => {
  const o = { ...O, d1: true, h3: true, h1: true };
  const evs = R.events({ rows: [row({ id: 1, at: NOW + 1800e3, day: day('2026-10-15') }), row({ id: 2, title: 'Lab', at: NOW + 2 * 864e5, day: day('2026-10-17') })], cats, o, tz: NY });
  const st = R.clean({}, NOW);
  const p = R.pending(evs, st, NOW);
  // Item 1's day, three-hour and one-hour reminders have all passed: one toast, its latest. Item 2's are to come.
  assert.equal(p.show.length, 1);
  assert.equal(p.show[0].at, NOW + 1800e3 - 36e5);
  assert.equal(p.ids.length, 3);
  assert.equal(p.next, NOW + 2 * 864e5 - 864e5);
  // Seen (shown in any tab): not again. Snoozed: at its snooze. Muted: never. Past the deadline: gone.
  const seen = Object.fromEntries(p.ids.map((id) => [id, NOW]));
  assert.deepEqual(R.pending(evs, { ...st, seen }, NOW).show, []);
  const snooze = { [p.show[0].id]: NOW + 6e5 };
  const s2 = { ...st, seen: Object.fromEntries(p.ids.filter((id) => id !== p.show[0].id).map((id) => [id, NOW])), snooze };
  assert.deepEqual(R.pending(evs, s2, NOW).show, []);
  assert.equal(R.pending(evs, s2, NOW).next, NOW + 6e5);
  assert.equal(R.pending(evs, s2, NOW + 6e5).show[0].id, p.show[0].id);
  assert.deepEqual(R.pending(evs, { ...st, mute: { 'assignment:1': NOW } }, NOW).show, []);
  assert.deepEqual(R.pending(evs, st, NOW + 864e5).show.map((e) => e.key), ['assignment:2']);
  // Several items missed: the newest one shows, and the toast names the rest.
  const two = R.events({ rows: [row({ id: 1, at: NOW + 6e5, day: day('2026-10-15') }), row({ id: 3, at: NOW + 1.2e6, day: day('2026-10-15') })], cats, o: { ...O, h3: true }, tz: NY });
  assert.deepEqual(R.pending(two, st, NOW).show.map((e) => e.key), ['assignment:3', 'assignment:1']);
  // The hub's recent list: every reminder the one toast stood for, not only the one it named, and the snoozed.
  const shown = Object.fromEntries(R.pending(two, st, NOW).ids.map((id) => [id, NOW]));
  assert.deepEqual(R.recent(two, { ...st, seen: shown }, NOW).map((e) => e.key), ['assignment:1', 'assignment:3']);
  const snoozed = R.recent(two, { ...st, snooze: { [two[0].id]: NOW + 36e5 } }, NOW);
  assert.deepEqual(snoozed.map((e) => [e.key, e.snoozed]), [['assignment:1', NOW + 36e5]]);
  assert.deepEqual(R.recent(two, { ...st, seen: shown }, NOW + 4 * 864e5), [], 'three days');
  assert.deepEqual(R.recent(two, { ...st, seen: shown, mute: { 'assignment:1': NOW } }, NOW).map((e) => e.key), ['assignment:3']);
  // The hub's list: what's still to fire.
  assert.deepEqual(R.upcoming(evs, { ...st, seen }, NOW).map((e) => [e.key, e.fires]), [['assignment:2', NOW + 864e5]]);
});

// ---- the streak ----
const item = (id, due, sub = { submitted: false }, x = {}) => ({ type: 'assignment', id: String(id), cid: '5', course: 'Biology', title: `A${id}`, at: at(due), url: `/courses/5/assignments/${id}`, sub, ov: null, ...x });
const built = (items, now = NOW, tz = NY, data, o = TODO) => T.build({ items, data, o, now, tz, cids: null });
const today = T.dayOf(NOW, NY);

test('streak: days in a row, and today counts once nothing due today is open', () => {
  // A first day with nothing due: one.
  const s = R.streak(built([]), null, today);
  assert.deepEqual([s.start, s.current, s.best, s.extended], [today, 1, 1, true]);
  // Ten days in, with something due tonight still open: today doesn't count yet.
  const open = R.streak(built([item(1, '2026-10-16T03:59:00Z')]), { start: today - 10, best: 4 }, today);
  assert.deepEqual([open.current, open.best, open.extended], [10, 10, false]);
  // Handed in: it does.
  assert.equal(R.streak(built([item(1, '2026-10-16T03:59:00Z', { submitted: true })]), { start: today - 10, best: 4 }, today).current, 11);
});

test('streak: a miss ends a run, excused never does, late work does, and work with nothing to hand in is left out', () => {
  const st = { start: today - 10, best: 12 };
  const miss = R.streak(built([item(1, '2026-10-13T03:59:00Z')]), st, today); // due Monday night, not handed in
  assert.deepEqual([miss.start, miss.was, miss.keys, miss.broke, miss.current, miss.best], [day('2026-10-13'), today - 10, ['assignment:1'], day('2026-10-12'), 3, 12]);
  assert.equal(R.streak(built([item(1, '2026-10-13T03:59:00Z', { excused: true })]), st, today).current, 11);
  assert.equal(R.streak(built([item(1, '2026-10-13T03:59:00Z', { submitted: true, late: true })]), st, today).broke, day('2026-10-12'));
  assert.equal(R.streak(built([item(1, '2026-10-13T03:59:00Z', { submitted: true, graded: true })]), st, today).current, 11);
  assert.equal(R.streak(built([item(1, '2026-10-13T03:59:00Z', null, { type: 'wiki_page' })]), st, today).current, 11);
  // Before the run started, or forgiven by a restore: no effect.
  assert.equal(R.streak(built([item(1, '2026-10-01T03:59:00Z')]), st, today).current, 11);
  assert.equal(R.streak(built([item(1, '2026-10-13T03:59:00Z')]), { ...st, ok: ['assignment:1'] }, today).current, 11);
  // Missed tonight: no streak today, and tomorrow starts afresh.
  const tonight = R.streak(built([item(1, '2026-10-15T15:00:00Z')]), st, today);
  assert.deepEqual([tonight.start, tonight.current], [today + 1, 0]);
  // The student's own task, ticked off after its due date.
  const task = { tasks: [{ id: 'x', title: 'Read', due: { day: '2026-10-13' }, done: at('2026-10-14T15:00:00Z') }], items: {} };
  assert.equal(R.streak(built([], NOW, NY, task), st, today).broke, day('2026-10-13'));
});

test('streak: work with nothing to hand in that is due today never holds today back', () => {
  const st = { start: today - 10, best: 0 };
  const s = R.streak(built([item(1, '2026-10-16T03:59:00Z', null, { type: 'wiki_page' })]), st, today);
  assert.deepEqual([s.extended, s.current], [true, 11]);
});

test('streak: a late hand-in ends a run whatever "done means"', () => {
  const st = { start: today - 10, best: 0 };
  const late = [item(1, '2026-10-13T03:59:00Z', { submitted: true, late: true })];
  assert.equal(R.streak(built(late, NOW, NY, undefined, { ...TODO, done: 'manual' }), st, today).broke, day('2026-10-12'));
  // Handed in on time but not ticked, with "only what I tick": nothing missed.
  assert.equal(R.streak(built([item(1, '2026-10-13T03:59:00Z', { submitted: true })], NOW, NY, undefined, { ...TODO, done: 'manual' }), st, today).broke, null);
});

test('streak: days are the Canvas zone\'s', () => {
  // 11:30 PM Tuesday in New York is 5:30 AM Wednesday in Berlin. A run that started Wednesday: only Berlin's breaks.
  const items = [item(1, '2026-10-14T03:30:00Z')];
  assert.equal(R.streak(built(items, NOW, NY), { start: day('2026-10-14'), best: 0 }, T.dayOf(NOW, NY)).broke, null);
  assert.equal(R.streak(built(items, NOW, 'Europe/Berlin'), { start: day('2026-10-14'), best: 0 }, T.dayOf(NOW, 'Europe/Berlin')).broke, day('2026-10-14'));
});

// ---- the state the worker keeps ----
const area = (stored = {}) => {
  const box = JSON.parse(JSON.stringify(stored));
  return { box, local: { get: async (ks) => Object.fromEntries(ks.filter((k) => k in box).map((k) => [k, box[k]])), set: async (p) => { Object.assign(box, JSON.parse(JSON.stringify(p))); return true; } } };
};
const KEY = R.storeKey('https://canvas.test', '3');

test('the worker: a reminder is leased to one tab, seen only once that tab showed it, and free again if it never did', async () => {
  const a = area();
  const id = `assignment:1@${NOW}`;
  const la = await R.change({ key: KEY, op: 'claim', tab: 'a', ids: [id, 'nonsense'] }, a, NOW);
  assert.deepEqual([la.claimed, la.until], [[id], NOW + R.LEASE], 'a claim says when its lease ends');
  assert.ok(la.lease);
  assert.deepEqual(a.box[KEY].seen, {}, 'not seen until shown');
  assert.deepEqual((await R.change({ key: KEY, op: 'claim', tab: 'b', ids: [id] }, a, NOW)).claimed, []);
  // Tab a closed (or went quiet) without showing it: once the lease runs out, b may.
  const later = NOW + R.LEASE + 1;
  const lb = await R.change({ key: KEY, op: 'claim', tab: 'b', ids: [id] }, a, later);
  assert.deepEqual(lb.claimed, [id]);
  assert.deepEqual((await R.change({ key: KEY, op: 'confirm', tab: 'a', lease: la.lease, ids: [id] }, a, later)).confirmed, []);
  assert.deepEqual(a.box[KEY].seen, {}, "a's stale lease confirms nothing");
  assert.deepEqual((await R.change({ key: KEY, op: 'confirm', tab: 'b', lease: 'made-up', ids: [id] }, a, later)).confirmed, [], 'nor a lease it never had');
  await R.change({ key: KEY, op: 'confirm', tab: 'b', lease: lb.lease, ids: [id] }, a, later);
  assert.deepEqual([a.box[KEY].seen, a.box[KEY].held], [{ [id]: later }, {}]);
  assert.deepEqual((await R.change({ key: KEY, op: 'claim', tab: 'a', ids: [id] }, a, later)).claimed, []);
  // What the page reckons: another tab's lease waits until it runs out; its own doesn't.
  const ev = [{ id, key: 'assignment:1', at: NOW - 1, until: NOW + 864e5 }];
  const st = R.clean({ held: { [id]: { by: 'a', lease: 'x', until: NOW + R.LEASE } } }, NOW);
  assert.deepEqual([R.pending(ev, st, NOW, 'b').show.length, R.pending(ev, st, NOW, 'b').next], [0, NOW + R.LEASE]);
  assert.equal(R.pending(ev, st, NOW, 'a').show.length, 1);
  // A confirm that comes after its lease ended still counts while no other claim has replaced the lease.
  const id2 = `assignment:2@${NOW}`;
  const l2 = await R.change({ key: KEY, op: 'claim', tab: 'a', ids: [id2] }, a, NOW);
  assert.deepEqual((await R.change({ key: KEY, op: 'confirm', tab: 'a', lease: l2.lease, ids: [id2] }, a, NOW + R.LEASE + 5)).confirmed, [id2]);
  await R.change({ key: KEY, op: 'snooze', id, until: NOW + 36e5 }, a, NOW);
  assert.deepEqual([a.box[KEY].seen[id], a.box[KEY].snooze], [undefined, { [id]: NOW + 36e5 }]);
  await R.change({ key: KEY, op: 'mute', item: 'assignment:1' }, a, NOW);
  assert.deepEqual(a.box[KEY].mute, { 'assignment:1': NOW });
  await R.change({ key: KEY, op: 'unmute', item: 'assignment:1' }, a, NOW);
  assert.deepEqual(a.box[KEY].mute, {});
  assert.equal((await R.change({ key: 'remind:javascript:alert(1)/3', op: 'mute', item: 'assignment:1' }, a, NOW)).ok, false);
  assert.equal((await R.change({ key: KEY, op: 'nothing' }, a, NOW)).ok, false);
});

test('the worker: a streak is kept only over the one it was reckoned from; restores are a few a month', async () => {
  const a = area();
  const s = { start: 100, best: 3, was: null, keys: [], ok: [], broke: null };
  assert.equal((await R.change({ key: KEY, op: 'streak', from: null, streak: s }, a, NOW)).ok, true);
  // Another tab broke it meanwhile (start 105): a page still reckoning from 100 changes nothing.
  await R.change({ key: KEY, op: 'streak', from: 100, streak: { ...s, start: 105, was: 100, keys: ['assignment:1'], broke: 104 } }, a, NOW);
  assert.equal((await R.change({ key: KEY, op: 'streak', from: 100, streak: { ...s, best: 9 } }, a, NOW)).error, 'stale');
  // A restore: the run from before the miss, the miss forgiven.
  const r = await R.change({ key: KEY, op: 'restore', month: '2026-10' }, a, NOW);
  assert.deepEqual([r.ok, r.data.streak.start, r.data.streak.ok, r.data.streak.was, r.data.restores], [true, 100, ['assignment:1'], null, { month: '2026-10', n: 1 }]);
  // Nothing to restore now; another break, another restore; then none left until November.
  assert.equal((await R.change({ key: KEY, op: 'restore', month: '2026-10' }, a, NOW)).error, 'none');
  const broke = { ...a.box[KEY].streak, start: 110, was: 100, keys: ['assignment:2'], broke: 109 };
  await R.change({ key: KEY, op: 'streak', from: 100, streak: broke }, a, NOW);
  assert.equal((await R.change({ key: KEY, op: 'restore', month: '2026-10' }, a, NOW)).ok, true);
  await R.change({ key: KEY, op: 'streak', from: 100, streak: { ...broke, keys: ['assignment:3'] } }, a, NOW);
  assert.equal(R.left(a.box[KEY], '2026-10'), 0);
  assert.equal((await R.change({ key: KEY, op: 'restore', month: '2026-10' }, a, NOW)).error, 'none');
  assert.equal(R.left(a.box[KEY], '2026-11'), R.RESTORES);
  assert.equal((await R.change({ key: KEY, op: 'restore', month: '2026-11' }, a, NOW)).ok, true);
});

test('clean: what storage or a page hands over is checked, and old entries go', () => {
  const old = NOW - 40 * 864e5;
  const c = R.clean({
    seen: { [`assignment:1@${NOW}`]: NOW, [`assignment:2@${old}`]: old, 'bad id': NOW, [`assignment:3@${NOW}`]: 'x' },
    snooze: { [`task:a@${NOW}`]: NOW + 1 },
    mute: { 'assignment:1': NOW, '<b>': NOW, 'quiz:4': old - 60 * 864e5 },
    streak: { start: 100, best: -3, keys: ['assignment:1', 7], ok: 'no' },
    restores: { month: 'soon', n: 1 },
  }, NOW);
  assert.deepEqual(c, {
    seen: { [`assignment:1@${NOW}`]: NOW }, snooze: { [`task:a@${NOW}`]: NOW + 1 }, held: {}, mute: { 'assignment:1': NOW },
    streak: { start: 100, best: 0, was: null, keys: ['assignment:1'], ok: [], broke: null }, restores: null,
  });
  assert.deepEqual(R.clean(null, NOW), { seen: {}, snooze: {}, held: {}, mute: {}, streak: null, restores: null });
});
