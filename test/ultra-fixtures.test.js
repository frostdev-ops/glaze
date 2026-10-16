// Ultra JSON fixtures (test/fixtures/ultra-*.json): response shapes measured on a real Blackboard Ultra account in the
// B0 spike (docs/spikes/B0.md), every value invented. These tests keep them synthetic and keep them readable by the
// Ultra code Glaze already has, so B1's data layer starts from shapes that match what Ultra really sends.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../lib/gradecalc.js');
const GZ_PAGE = require('../lib/page.js');
const GZ_GRADES = require('../lib/grades.js');
const { GZ_COURSES, GZ_DUE_WEEK } = require('../defaults.js');

const dir = path.join(__dirname, 'fixtures');
const load = (n) => JSON.parse(fs.readFileSync(path.join(dir, `ultra-${n}.json`), 'utf8'));
const files = fs.readdirSync(dir).filter((f) => /^ultra-.*\.json$/.test(f));

test('the Ultra fixtures are synthetic: invented ids, example hosts only', () => {
  assert.ok(files.length >= 10);
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.match(text, /"_note": "Glaze test fixture: Blackboard Ultra/, `${f}: provenance note`);
    for (const host of text.match(/https?:\/\/[^/"]+/g) || []) assert.match(host, /\.example\.(edu|com)$|^https?:\/\/www\.w3\.org$/, `${f}: ${host}`);
    for (const id of text.match(/"_\d+_\d+"/g) || []) assert.match(id, /^"_\d{1,4}_1"$/, `${f}: ${id} is not an invented id`);
  }
});

test('courses, due items and grades read with the Ultra helpers Glaze has today', () => {
  const courses = GZ_COURSES(load('memberships').results);
  assert.deepEqual(Object.keys(courses), ['_101_1', '_102_1', '_103_1', '_104_1']);
  assert.equal(courses._104_1.slot, '9'); // card color index 2508 wraps onto the ten
  const week = GZ_DUE_WEEK(load('todo'), Date.parse('2026-10-15T12:00:00Z'));
  assert.deepEqual(week.map((i) => i.content), ['_706_1', '_703_1']); // Essay 3 is past the week
  const rows = load('grades').results;
  const m = G.model(rows);
  assert.equal(m.kind, 'weighted');
  assert.equal(m.overall, 88);
  assert.ok(Math.abs(m.percent() - 88) < 1e-9);
  assert.match(GZ_PAGE.overall(rows, 'en-US').label, /^88(\.00)?\s?%$/);
});

test("submission state: Ultra's own Grades page rows carry status, the attempt and its dates", () => {
  const rows = load('grades-status').results;
  assert.deepEqual(rows.map((r) => r.submissionStatus.status), ['GRADED', 'SUBMITTED', 'UNOPENED']);
  const [waiting] = GZ_GRADES.awaiting(rows);
  assert.equal(waiting.columnId, '_612_1');
  // Handed in after the due date: late, as Glaze's due chips reckon it.
  assert.equal(GZ_GRADES.late(waiting.lastAttempt.attemptDate, waiting.column.dueDate), true);
  assert.equal(GZ_GRADES.late(rows[0].lastAttempt.attemptDate, rows[0].column.dueDate), false);
  assert.equal(load('attempt').attemptReceipt.submissionDate, waiting.lastAttempt.attemptDate);
  // As measured: created, then submitted (attemptDate, equal to the receipt's submissionDate), then graded.
  const t = Date.parse;
  for (const { lastAttempt: a, column } of rows.filter((r) => r.lastAttempt)) {
    assert.equal(a.attemptReceipt.submissionDate, a.attemptDate);
    assert.ok(t(a.creationDate) <= t(a.attemptDate));
    if (a.attemptFirstGradedDate) assert.ok(t(a.attemptDate) <= t(a.attemptFirstGradedDate) && t(a.attemptFirstGradedDate) <= t(a.attemptLastGradedDate));
    assert.equal(GZ_GRADES.late(a.attemptDate, column.dueDate), GZ_GRADES.late(a.attemptReceipt.submissionDate, column.dueDate));
  }
});

test('calendar items join the gradebook by column id; a graded discussion appears twice', () => {
  const columns = new Set([...load('grades').results, ...load('grades-status').results].map((r) => r.columnId));
  const items = load('calendar-items').results;
  for (const i of items) assert.ok(columns.has(i.itemSourceId), `${i.itemSourceId} (${i.itemSourceType}) joins no column`);
  const discussion = items.filter((i) => i.itemSourceId === '_605_1').map((i) => i.itemSourceType.split('.').pop()).sort();
  assert.deepEqual(discussion, ['Engagement', 'GradableItem']);
  assert.equal(load('discussions').results[0].gradebookColumnId, '_605_1');
  assert.equal(new Set(items.map((i) => i.itemSourceId)).size, items.length - 1); // dedupe by column id
});
