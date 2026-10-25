const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { El } = require('./stand-in-dom.js');

test('an old Notes ZIP requires a visible account choice even with only one account', async () => {
  const doc = { createElement: (tag) => new El(tag, doc) }, nodes = {};
  for (const id of ['restore-pick', 'restore-cats', 'restore-ok', 'restore-account-field', 'restore-account', 'restore-title', 'restore-cancel']) nodes[id] = new El('div', doc);
  const source = fs.readFileSync(require.resolve('../options.js'), 'utf8');
  const start = source.indexOf('  const askRestore ='), end = source.indexOf('  // ---- backup ----', start);
  const ctx = vm.createContext({ document: doc, $: (s) => nodes[s.slice(1)], URL, backupNames: () => ({ notes: 'Notes' }), t: (s) => s, GZ_BACKUP: { CATS: ['notes'] } });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.pick = askRestore;', ctx);
  const pending = ctx.pick({ name: 'glaze-notes.zip' }, { kind: 'notes', cats: { notes: [{ site: 'https://school.test' }] } }, ['notesIdx:https://school.test/5']);
  assert.equal(nodes['restore-account-field'].hidden, false);
  assert.equal(nodes['restore-ok'].disabled, true);
  nodes['restore-pick'].returnValue = 'cancel'; nodes['restore-pick'].close();
  assert.equal(await pending, null);
});
