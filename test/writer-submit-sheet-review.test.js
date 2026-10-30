const test = require('node:test');
const assert = require('node:assert/strict');
const sheet = require('./helpers/writer-submit-sheet.cjs');

test('a viewer rebuilds its file after saving instead of reusing preview bytes', async () => {
  const s = sheet();
  s.api.kind = () => 'pdf'; s.api.ext = () => '.pdf'; delete s.api.editor;
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.edit(); s.click('.gs-primary'); await s.flush();
  assert.equal(s.builds.length, 2, 'the saved viewer file is built again');
  s.builds[1].resolve(); await s.flush();
  const sent = s.messages.find((m) => m.type === 'submit:go');
  assert.equal(new Uint8Array(sent.bytes)[0], 2);
});

test('review: a paper changed during preview export cannot submit stale cached bytes', async () => {
  const s = sheet(); await s.open();
  assert.equal(s.builds.length, 1);
  s.edit(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-primary'); await s.flush();
  for (const b of s.builds.slice(1)) b.resolve(); await s.flush();
  assert.equal(s.messages.some((m) => m.type === 'submit:go' && new Uint8Array(m.bytes)[0] === 1), false, 'the old document must never leave the sheet');
});

test('review: a document changed while its submit version saves cannot mix text and file', async () => {
  const s = sheet(); await s.open(); s.builds[0].resolve(); await s.flush();
  let finish;
  s.api.version = () => new Promise((r) => { finish = r; });
  s.click('.gs-sw'); s.click('.gs-primary'); await s.flush();
  s.edit(); finish(true); await s.flush();
  for (const b of s.builds.slice(1)) b.resolve(); await s.flush();
  assert.equal(s.messages.some((m) => m.type === 'submit:go'), false, 'a changed snapshot needs a fresh student review');
});

test('review: only a trusted student click may start a submit version', async () => {
  const s = sheet(); await s.open(); s.builds[0].resolve(); await s.flush();
  s.doc.fire(s.doc.querySelector('.gs-primary'), 'click', { isTrusted: false }); await s.flush();
  assert.equal(s.saved.length, 0);
  assert.equal(s.messages.some((m) => m.type === 'submit:go'), false);
});

test('review: a busy sheet retains keyboard focus and Cancel revokes its run', async () => {
  const s = sheet(); await s.open(); s.builds[0].resolve(); await s.flush();
  s.doc.querySelector('#gs-note').focus(); s.click('.gs-primary'); await s.flush();
  assert.equal(!!s.doc.activeElement.disabled, false, 'focus must move off disabled controls');
  const controls = s.doc.querySelectorAll('.gs-layer button').filter((b) => !b.disabled);
  assert.ok(controls.length, 'a busy sheet needs a keyboard escape');
  const cancel = s.doc.querySelector('.gs-foot .gs-btn');
  s.doc.fire(cancel, 'click'); await s.flush();
  assert.equal(s.messages.some((m) => m.type === 'submit:cancel'), true);
  assert.equal(s.messages.some((m) => m.type === 'submit:cancel'), true);
});

test('review: the submit sheet uses singular English for one check and one page', () => {
  const path = require('node:path');
  const I = process.env.WRITER_I18N_SOURCE ? require('node:vm').runInNewContext(require('node:fs').readFileSync(path.resolve(process.env.WRITER_I18N_SOURCE), 'utf8') + '\nGZ_I18N', { Intl }) : require('../lib/i18n.js');
  assert.equal(I.t('{n} checks open', { n: 1 }, 'en'), '1 check open');
  assert.equal(I.t('{n} pages', { n: 1 }, 'en'), '1 page');
  assert.equal(I.t('{n} checks open', { n: 2 }, 'en'), '2 checks open');
  assert.equal(I.t('{n} pages', { n: 2 }, 'en'), '2 pages');
});

test('review: cancelling an upload exposes the retained-file review action', async () => {
  const s = sheet(); await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-primary'); await s.flush(); s.click('.gs-foot .gs-btn'); await s.flush();
  assert.equal(s.ctx.GZ_WRITER_SUBMIT_SHEET.opened(), true, 'keep the cancellation result visible');
  assert.match(s.doc.querySelector('.gs-err').textContent, /review or remove/);
  assert.equal(s.doc.querySelector('.gs-native').hidden, false);
});

test('review: as-is Cancel during a file read sends no file afterward', async () => {
  const s = sheet(); let finish;
  const f = { name: 'original.pdf', type: 'application/pdf', size: 3, arrayBuffer: () => new Promise((r) => { finish = r; }) };
  await s.ctx.GZ_WRITER_SUBMIT_SHEET.open(s.api, f);
  s.click('.gs-primary'); await s.flush(); s.click('.gs-foot .gs-btn');
  finish(new Uint8Array([1, 2, 3]).buffer); await s.flush();
  assert.equal(s.messages.some((m) => m.type === 'submit:go'), false);
});
test('review: a submit sheet does not mount over the import card', async () => {
  const s = sheet(); let closed = 0;
  s.ctx.GZ_WRITER_IMPORT = { close: () => { closed++; } };
  await s.open(); assert.equal(closed, 1);
});
test('review: closing a sheet awaiting libraries prevents it from opening late', async () => {
  const s = sheet(); let finish;
  s.ctx.GZ_WRITER_PAPER.need = () => new Promise((r) => { finish = r; });
  const opening = s.open(); s.ctx.GZ_WRITER_SUBMIT_SHEET.close(); finish(); await opening;
  assert.equal(s.ctx.GZ_WRITER_SUBMIT_SHEET.opened(), false);
});

test('review: an oversized as-is file is rejected before any arrayBuffer read', async () => {
  const s = sheet(); let reads = 0;
  const file = { name: 'huge.pdf', size: 50e6 + 1, type: 'application/pdf', arrayBuffer: async () => { reads++; return new ArrayBuffer(3); } };
  await s.ctx.GZ_WRITER_SUBMIT_SHEET.open(s.api, file);
  if (s.ctx.GZ_WRITER_SUBMIT_SHEET.opened()) { s.click('.gs-primary'); await s.flush(); }
  assert.equal(reads, 0);
  assert.equal(s.messages.some((m) => m.type === 'submit:go'), false);
});
test('review: a malformed as-is read cannot cross the channel', async () => {
  const s = sheet();
  await s.ctx.GZ_WRITER_SUBMIT_SHEET.open(s.api, { name: 'a.pdf', size: 3, type: 'application/pdf', arrayBuffer: async () => new Uint8Array([1, 2, 3]) });
  s.click('.gs-primary'); await s.flush();
  assert.equal(s.messages.some((m) => m.type === 'submit:go'), false);
});

test('review: a failing document build leaves the sheet usable and sends nothing', async () => {
  const s = sheet();
  s.api.file = async () => { throw new Error('document build failed'); };
  await s.open(); await s.flush();
  s.click('.gs-primary'); await s.flush();
  assert.equal(s.messages.some((m) => m.type === 'submit:go'), false);
  assert.match(s.doc.querySelector('.gs-err').textContent, /could not be made/);
  assert.equal(s.doc.querySelector('.gs-primary').disabled, false);
  assert.equal(s.ctx.GZ_WRITER_SUBMIT_SHEET.busy(), false);
});

test('Save and Close: editing during a slow save never acknowledges the newer unsaved document', async () => {
  const s = sheet(), notices = [];
  let finish;
  s.api.save = () => new Promise((r) => { finish = r; });
  s.api.notify = (m) => notices.push(m);
  const saving = s.handles['submit:save']({ request: 'old-snapshot' });
  s.edit(); finish(true); await saving;
  assert.equal(s.messages.find((m) => m.type === 'submit:saved').ok, false);
  assert.deepEqual(notices, ['Not saved. Try again in a moment.']);
  s.api.save = async () => true;
  await s.handles['submit:save']({ request: 'retry' });
  assert.equal(s.messages.filter((m) => m.type === 'submit:saved').at(-1).ok, true);
});

test('Save and Close: the 30 second failure is said once and a late save cannot acknowledge again', async () => {
  const s = sheet(), notices = [];
  let finish;
  s.api.save = () => new Promise((r) => { finish = r; });
  s.api.notify = (m) => notices.push(m);
  const saving = s.handles['submit:save']({ request: 'slow' });
  // The handler's save timer, without waiting 30 seconds in a unit test.
  for (const fn of s.timers.values()) fn();
  await saving;
  finish(true); await s.flush();
  assert.equal(s.messages.filter((m) => m.type === 'submit:saved').length, 1);
  assert.equal(s.messages.at(-1).ok, false);
  assert.deepEqual(notices, ['Not saved. Try again in a moment.']);
  s.api.save = async () => true;
  await s.handles['submit:save']({ request: 'retry' });
  assert.equal(s.messages.at(-1).ok, true);
  assert.equal(notices.length, 1);
});
