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
