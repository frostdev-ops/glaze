const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const M = require('../lib/media.js');
const webm = new Uint8Array(fs.readFileSync(require('node:path').join(__dirname, 'fixtures/media/clip.webm')));

test('WebM requires complete bounded elements and a video track, not just its signature', () => {
  assert.ok(M.video(webm));
  for (const bytes of [webm.subarray(0, 65), webm.subarray(0, webm.length - 1), Uint8Array.from([...webm, 0])]) assert.equal(M.video(bytes), null);
  const fake = new Uint8Array(80);
  fake.set([0x1a, 0x45, 0xdf, 0xa3]);
  fake.set(Buffer.from('webm'), 20);
  assert.equal(M.video(fake), null);
  const streaming = webm.slice();
  streaming.fill(255, 41, 48);
  assert.ok(M.video(streaming), 'a streaming segment may omit its length');
  const badHeader = webm.slice();
  badHeader[4] = 255;
  assert.equal(M.video(badHeader), null, 'the EBML header must have a bounded length');
});

test('WebM refuses a nested element that exceeds its track and oversized decoded frames', () => {
  const damaged = webm.slice();
  const video = Buffer.from(damaged).indexOf(Buffer.from([0xe0, 0x90]));
  assert.ok(video > 0);
  damaged[video + 1] = 0xff;
  assert.equal(M.video(damaged), null);
  const huge = webm.slice();
  const width = Buffer.from(huge).indexOf(Buffer.from([0xb0, 0x81]));
  assert.ok(width > 0);
  // Set PixelWidth to 5000 using a two-byte payload and adjust its enclosing element lengths.
  const b = Buffer.from(huge);
  const resized = Buffer.concat([b.subarray(0, width), Buffer.from([0xb0, 0x82, 0x13, 0x88]), b.subarray(width + 3)]);
  resized[322]++;
  resized[275]++;
  resized[266]++;
  resized[47]++;
  assert.equal(M.video(new Uint8Array(resized)), null);
});
