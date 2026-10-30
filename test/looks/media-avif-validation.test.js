const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/media.js');

test('animated AVIF measures track samples as well as the primary image before decoding', () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/media/anim.avif'));
  const small = Buffer.from(bytes), ispe = small.indexOf('ispe');
  assert.ok(ispe > 0);
  small.writeUInt32BE(1, ispe + 8); small.writeUInt32BE(1, ispe + 12);
  assert.equal(M.avif(new Uint8Array(small), { ...M.LIMIT.sticker.image, side: 32 }), null, 'the track still decodes 48 by 48');
  const got = M.avif(new Uint8Array(small), M.LIMIT.bg.image);
  assert.deepEqual([got.w, got.h], [48, 48]);
});

test('a malformed AVIF track is refused without throwing', () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/media/anim.avif'));
  bytes.writeUInt32BE(0x7fffffff, bytes.indexOf('trak') - 4);
  assert.equal(M.avif(new Uint8Array(bytes), M.LIMIT.bg.image), null);
});
