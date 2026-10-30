// Execute the checks' measurement/removal helpers against controlled state changes, without browser timing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = (name) => fs.readFileSync(path.join(__dirname, '../scripts', name), 'utf8');

const removeSites = async ({ delayCanvas = false, missingBB = false } = {}) => {
  const source = read('sites-check.js');
  const polling = source.slice(source.indexOf('const until ='), source.indexOf('const results ='));
  const removal = source.slice(source.indexOf('    const removeRow ='), source.indexOf('    // Embedded Settings:'));
  let now = 0, removedAt = 0, last = '';
  const rows = new Set(['canvas.school.edu', 'bb.school.edu']);
  const BB = 'https://bb.school.edu', CANVAS = 'https://canvas.school.edu';
  const grants = { removed: [], required: [], held: new Set([`${BB}/*`, `${CANVAS}/*`]) };
  const page = { click: async (selector) => {
    last = selector.includes('canvas.school.edu') ? 'canvas.school.edu' : 'bb.school.edu';
    rows.delete(last); removedAt = now;
    const pattern = `https://${last}/*`;
    if (!grants.required.includes(pattern)) { grants.removed.push([pattern]); grants.held.delete(pattern); }
  } };
  const state = async () => ({
    rows: [...rows].map((h) => [h]),
    status: last && !(last === 'bb.school.edu' && missingBB) && !(last === 'canvas.school.edu' && delayCanvas && now - removedAt < 200)
      ? `Removed ${last}. Glaze no longer runs there.` : '',
  });
  return vm.runInNewContext(`(async () => { ${polling}\n${removal} })()`, {
    page, state, BB, CANVAS, __gz: grants, gz: async (fn, arg) => fn(arg), local: async () => ({ canvas: [] }),
    shot: async () => {}, check: (ok, why) => assert.ok(ok, why), Date: { now: () => now }, pause: async (ms) => { now += ms; },
  });
};

test('Sites reads Remove status after the grant has gone back and the status has landed', async () => {
  await removeSites({ delayCanvas: true });
});

test('Sites fails when Remove never reports completion, even if the list and grant are correct', async () => {
  await assert.rejects(removeSites({ missingBB: true }), /Removed|status|completion/);
});
