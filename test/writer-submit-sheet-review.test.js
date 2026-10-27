const test = require('node:test');
const assert = require('node:assert/strict');
const sheet = require('./helpers/writer-submit-sheet.cjs');

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
  assert.equal(s.ctx.GZ_WRITER_SUBMIT_SHEET.opened(), false);
});

test('review: the submit sheet uses singular English for one check and one page', () => {
  const path = require('node:path');
  const I = process.env.WRITER_I18N_SOURCE ? require('node:vm').runInNewContext(require('node:fs').readFileSync(path.resolve(process.env.WRITER_I18N_SOURCE), 'utf8') + '\nGZ_I18N', { Intl }) : require('../lib/i18n.js');
  assert.equal(I.t('{n} checks open', { n: 1 }, 'en'), '1 check open');
  assert.equal(I.t('{n} pages', { n: 1 }, 'en'), '1 page');
  assert.equal(I.t('{n} checks open', { n: 2 }, 'en'), '2 checks open');
  assert.equal(I.t('{n} pages', { n: 2 }, 'en'), '2 pages');
});
