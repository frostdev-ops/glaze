// lib/scene-media.js in a VM with stand-ins for the page (test/helpers/media-env.cjs): what a video, an animated picture and a
// Lottie animation do for each of the things a background must always do. Muted and never with controls; first frame only while
// motion is off; paused while the tab is hidden; the last frame kept when Glaze is cut off; everything freed when it stops; and
// the gradient left alone, with the reason told, when it can't be shown.
const test = require('node:test');
const assert = require('node:assert/strict');
const { env } = require('./helpers/media-env.cjs');

// Long enough for the page's promises to settle (the env's digest of a kept file is one of them).
const settle = () => new Promise((done) => setTimeout(done, 20));
// What the VM made, as plain data (its objects have the VM's prototypes).
const plain = (x) => JSON.parse(JSON.stringify(x));
const URL1 = 'https://cdn.example.com/loop.webm';
const o = (media, extra = {}) => ({ x: { bg: { media } }, ground: '#102030', speed: 1, ...extra });
const kinds = (e, tag) => e.made.filter((m) => m.tag === tag);
const rig = (opts) => {
  const e = env(opts), host = e.document.createElement('div'), fails = [];
  const scene = e.start(host, () => e.live !== false, (why) => fails.push(why));
  return { e, host, scene, fails };
};
// A video that has loaded its first frame.
const video = async (r, media = { type: 'video', src: URL1 }, extra = {}) => {
  r.scene.update(o(media, extra));
  await settle();
  const v = kinds(r.e, 'video')[0];
  v?.fire('loadeddata');
  await settle();
  return v;
};

test('a video is muted, loops, has no controls and no autoplay, and plays only once its first frame is in', async () => {
  const r = rig();
  r.scene.update(o({ type: 'video', src: URL1 }));
  await settle();
  const v = kinds(r.e, 'video')[0];
  assert.deepEqual([v.muted, v.defaultMuted, v.loop, v.controls, v.playsInline, v.disablePictureInPicture, v.disableRemotePlayback, v.tabIndex], [true, true, true, false, true, true, true, -1]);
  assert.deepEqual([v.attrs.muted, v.attrs['aria-hidden'], 'autoplay' in v.attrs, v.autoplay], ['', 'true', false, undefined]);
  assert.deepEqual([v.src, v.preload], ['blob:glaze/0', 'auto'], 'the checked copy, not the address');
  assert.deepEqual([v.plays, r.host.children.length], [0, 0], 'nothing is on the page, and nothing plays, before the first frame');
  v.fire('loadeddata');
  await settle();
  assert.equal(v.plays, 1);
  assert.deepEqual(r.host.children.map((c) => c.tag), ['video', 'div'], 'the video, then the dim over it');
  assert.equal(v.css['pointer-events'], 'none');
  assert.deepEqual([v.css.position, v.css.width, v.css.height], ['absolute', '100%', '100%']);
  assert.deepEqual(r.fails, []);
});

test('fit and dim follow the Look without loading anything again, and dim fades toward the ground', async () => {
  const r = rig();
  const v = await video(r, { type: 'video', src: URL1 }, { ground: '#102030' });
  const dim = r.host.children[1];
  assert.deepEqual([v.css['object-fit'], dim.css.background, dim.css.opacity], ['cover', '#102030', '0.4'], 'the defaults: cover, dim 40');
  r.scene.update(o({ type: 'video', src: URL1, fit: 'contain', dim: 75 }, { ground: '#ffffff' }));
  assert.deepEqual([v.css['object-fit'], dim.css.background, dim.css.opacity], ['contain', '#ffffff', '0.75']);
  r.scene.update(o({ type: 'video', src: URL1, fit: 'fill', dim: 0 }));
  assert.deepEqual([v.css['object-fit'], dim.css.opacity], ['fill', '0']);
  assert.equal(r.e.srcs.length, 1, 'one load');
  assert.equal(kinds(r.e, 'video').length, 1);
});

test('loop:false stops at the end, and a finished video is not started again by the tab coming back', async () => {
  const r = rig();
  const v = await video(r, { type: 'video', src: URL1, loop: false });
  assert.equal(v.loop, false);
  assert.equal(v.plays, 1);
  v.ended = true;
  r.e.visibility(true); r.e.visibility(false);
  assert.equal(v.plays, 1, 'it stays on its last frame');
});

test('motion off holds the first frame and never plays; motion back on plays', async () => {
  const r = rig();
  r.scene.update(o({ type: 'video', src: URL1 }, { speed: 0 }));
  await settle();
  const v = kinds(r.e, 'video')[0];
  v.currentTime = 3.2;
  v.fire('loadeddata');
  await settle();
  assert.deepEqual([v.plays, v.currentTime, v.paused], [0, 0, true], 'the first frame, still');
  r.scene.update(o({ type: 'video', src: URL1 }, { speed: 1 }));
  assert.equal(v.plays, 1);
  v.currentTime = 4;
  r.scene.update(o({ type: 'video', src: URL1 }, { speed: 0 }));
  assert.deepEqual([v.paused, v.currentTime], [true, 0], 'motion switched off while it plays: back to the first frame');
  assert.equal(kinds(r.e, 'video').length, 1);
});

test('a hidden tab pauses where it is, and showing it plays on; motion off stays still either way', async () => {
  const r = rig();
  const v = await video(r);
  v.currentTime = 2;
  r.e.visibility(true);
  assert.deepEqual([v.paused, v.currentTime], [true, 2], 'paused, not rewound');
  const plays = v.plays;
  r.e.visibility(false);
  assert.equal(v.plays, plays + 1);
  r.scene.update(o({ type: 'video', src: URL1 }, { speed: 0 }));
  r.e.visibility(true); r.e.visibility(false);
  assert.deepEqual([v.plays, v.paused], [plays + 1, true], 'still with motion off, hidden or not');
});

test('a video that cannot load leaves the gradient and says why, once', async () => {
  const r = rig({ preview: true });
  r.scene.update(o({ type: 'video', src: URL1 }));
  await settle();
  kinds(r.e, 'video')[0].fire('error');
  await settle();
  assert.deepEqual(r.fails, ['load']);
  assert.equal(r.host.children.length, 0);
  assert.deepEqual(plain(r.e.posted), [[{ gzMediaState: { state: 'failed', why: 'load' } }, 'chrome-extension://glaze']]);
  r.scene.update(o({ type: 'video', src: URL1 }));
  await settle();
  assert.deepEqual([r.fails.length, kinds(r.e, 'video').length], [1, 1], 'it does not try again on its own');
  assert.equal(r.e.listening(), 0);
});

test('only an https address or a kept file is ever given to an element', async () => {
  for (const src of ['http://cdn.example.com/a.webm', 'javascript:alert(1)', 'data:video/webm;base64,AAAA', '//cdn.example.com/a.webm', 'blob:https://x/1', 5]) {
    const r = rig();
    r.scene.update(o({ type: 'video', src }));
    await settle();
    assert.deepEqual(r.e.srcs, [], String(src));
    assert.deepEqual(r.fails, [typeof src === 'string' ? 'load' : 'empty'], String(src));
  }
  const r = rig();
  r.scene.update({ x: { bg: {} }, ground: '#000', speed: 1 });
  assert.deepEqual(r.fails, ['empty']);
  const q = rig();
  q.scene.update(o({ type: 'iframe', src: URL1 }));
  await settle();
  assert.deepEqual([q.fails, q.e.srcs], [['load'], []], 'a kind nobody defined');
});

test('another file replaces the first one cleanly: the old element is stopped and freed', async () => {
  const r = rig();
  const v = await video(r);
  r.scene.update(o({ type: 'video', src: 'https://cdn.example.com/two.webm' }));
  await settle();
  assert.deepEqual([v.paused, v.attrs.src, v.loads], [true, undefined, 1], 'the first one is paused, emptied and reloaded to free it');
  const w = kinds(r.e, 'video')[1];
  w.fire('loadeddata');
  await settle();
  assert.deepEqual(r.host.children.map((c) => c.tag), ['video', 'div']);
  assert.equal(r.host.children[0], w);
  assert.equal(w.plays, 1);
  // A load that finishes after another file was asked for is dropped.
  r.scene.update(o({ type: 'video', src: 'https://cdn.example.com/three.webm' }));
  await settle();
  r.scene.update(o({ type: 'video', src: 'https://cdn.example.com/four.webm' }));
  await settle();
  const [three, four] = kinds(r.e, 'video').slice(2);
  four.fire('loadeddata');
  three.fire('loadeddata');
  await settle();
  assert.equal(r.host.children[0], four);
  assert.equal(three.plays, 0);
});

test('a load nobody waits for any more is let go: its source is emptied, and it never reaches the page', async () => {
  const r = rig();
  r.scene.update(o({ type: 'video', src: 'https://cdn.example.com/slow.webm' }));
  await settle();
  const slow = kinds(r.e, 'video')[0];
  assert.equal(slow.src, 'blob:glaze/0');
  r.scene.update(o({ type: 'video', src: 'https://cdn.example.com/other.webm' }));
  assert.deepEqual([slow.attrs.src, slow.loads], [undefined, 1], 'the slow one stops loading at once');
  await settle();
  kinds(r.e, 'video')[1].fire('loadeddata');
  slow.fire('loadeddata');
  await settle();
  assert.equal(r.host.children[0], kinds(r.e, 'video')[1]);
  assert.equal(slow.plays, 0);
  // And on stop, before anything has loaded.
  const q = rig();
  q.scene.update(o({ type: 'video', src: URL1 }));
  await settle();
  const pending = kinds(q.e, 'video')[0];
  q.scene.stop();
  assert.equal(pending.loads, 1);
});

test('Glaze cut off keeps the last frame and stops everything; stop frees it all', async () => {
  const r = rig();
  const v = await video(r);
  r.e.live = false;
  r.scene.update(o({ type: 'video', src: URL1 }));
  assert.equal(v.paused, true);
  assert.equal(r.host.children.length, 2, 'the last frame stays on the page');
  assert.equal(r.e.listening(), 0);
  r.scene.update(o({ type: 'video', src: 'https://cdn.example.com/two.webm' }));
  r.scene.draw();
  await settle();
  assert.equal(kinds(r.e, 'video').length, 1, 'a frozen background never loads again');
  r.scene.stop();
  r.scene.stop();
  assert.equal(r.host.children.length, 0);
  const s = rig();
  const w = await video(s);
  s.scene.stop();
  assert.deepEqual([w.paused, w.loads, s.host.children.length, s.e.listening()], [true, 1, 0, 0]);
  s.scene.update(o({ type: 'video', src: URL1 }));
  s.scene.draw();
  await settle();
  assert.equal(kinds(s.e, 'video').length, 1, 'after stop, nothing');
});

test('nothing waits on a timer until the page is resized, and a resize does nothing for a video', async () => {
  const r = rig();
  await video(r);
  assert.equal(r.e.timers.length, 0, 'no timer, no polling');
  r.e.resize(); r.e.tick();
  assert.deepEqual([r.fails, r.e.timers.length, r.e.timers[0].ms], [[], 1, 150]);
});

// ---- a file kept on this computer ---------------------------------------------------------------------------------------
const bytes = Uint8Array.from({ length: 300 }, (_, i) => i & 255);
// The worker's answer to 'glaze:keptFile' (lib/background.js): the file as it was kept, checked and named when it was put.
const answer = (h, reply) => async (m) => (m.type === 'glaze:keptFile' && m.h === h ? reply : { ok: false, error: 'missing' });
const kept = (rec) => answer(rec.h, { ok: true, mime: rec.t, b64: Buffer.from(rec.bytes).toString('base64') });

test('a kept file is asked of the worker and played from a blob address that is revoked after', async () => {
  const e0 = env();
  const h = e0.sha(bytes);
  const r = rig({ ask: kept({ h, t: 'video/webm', bytes }) });
  const v = await video(r, { type: 'video', src: `file:${h}` });
  assert.deepEqual(plain(r.e.messages), [{ type: 'glaze:keptFile', h }]);
  assert.deepEqual(r.e.blobs, [['blob:glaze/0', 300, 'video/webm']]);
  assert.equal(v.src, 'blob:glaze/0');
  assert.equal(v.plays, 1);
  r.scene.stop();
  assert.deepEqual(r.e.revoked, ['blob:glaze/0']);
});

// Whether the bytes are the file named was settled when the worker kept them (lib/media.js put); the page doesn't hash them.
test('a kept file that is missing, the wrong kind or not an answer is not shown', async () => {
  const h = env().sha(bytes);
  for (const [why, ask, media] of [
    ['missing', answer(h, { ok: false, error: 'missing' }), { type: 'video', src: `file:${h}` }],
    ['no worker', async () => null, { type: 'video', src: `file:${h}` }],
    ['a picture where a video was asked for', kept({ h, t: 'image/webp', bytes }), { type: 'video', src: `file:${h}` }],
    ['a type nobody plays', kept({ h, t: 'text/html', bytes }), { type: 'video', src: `file:${h}` }],
    ['an answer that is not one', answer(h, { ok: true, mime: 'video/webm' }), { type: 'video', src: `file:${h}` }],
    ['bytes that are not base64', answer(h, { ok: true, mime: 'video/webm', b64: '!!' }), { type: 'video', src: `file:${h}` }],
  ]) {
    const r = rig({ ask });
    r.scene.update(o(media));
    await settle();
    assert.deepEqual([why, r.fails, r.e.blobs.length, r.e.srcs.length], [why, ['file'], 0, 0]);
  }
});

// ---- an address the Look names: the worker fetches and cleans it; the page plays the checked copy ------------------------------
// The worker's answer to 'glaze:remoteMedia' (lib/background.js): the file as lib/media.js remote cleaned it, or why not.
const remote = (reply) => async (m) => (m.type === 'glaze:remoteMedia' ? (typeof reply === 'function' ? reply(m) : reply) : { ok: false, error: 'bad' });
const wire = (type, mime) => ({ ok: true, type, mime, b64: Buffer.from(bytes).toString('base64') });
const given = (e) => e.srcs.map(([, src]) => src).filter(Boolean);

test('a video at an address is asked of the worker and played from the checked copy, never from the address', async () => {
  const r = rig({ ask: remote(wire('video', 'video/webm')) });
  const v = await video(r);
  assert.deepEqual(plain(r.e.messages), [{ type: 'glaze:remoteMedia', src: URL1, kind: 'video' }]);
  assert.deepEqual(r.e.blobs, [['blob:glaze/0', 300, 'video/webm']]);
  assert.equal(v.src, 'blob:glaze/0');
  assert.deepEqual(given(r.e).filter((u) => u.startsWith('https:')), [], 'no element is ever given the address');
  assert.equal(v.plays, 1);
  r.scene.stop();
  assert.deepEqual(r.e.revoked, ['blob:glaze/0'], 'and the copy is let go when it stops');
});

test('a picture at an address is asked of the worker, and its first frame comes from the checked bytes', async () => {
  const r = rig({ ask: remote(wire('image', 'image/webp')) });
  r.scene.update(o({ type: 'image', src: 'https://cdn.example.com/a.webp' }, { speed: 0 }));
  await settle();
  assert.deepEqual(plain(r.e.messages), [{ type: 'glaze:remoteMedia', src: 'https://cdn.example.com/a.webp', kind: 'image' }]);
  assert.equal(r.e.bitmapClosed, true, 'decoded from the bytes, then let go');
  assert.deepEqual(given(r.e).filter((u) => u.startsWith('https:')), [], 'no picture element is ever given the address');
  assert.deepEqual(r.fails, []);
});

test('an address the worker refuses leaves the gradient, and says whether the file broke a limit', async () => {
  for (const [why, ask, want] of [
    ['over the byte cap', remote({ ok: false, error: 'big' }), 'limits'],
    ['over a side, frame or pixel cap, or not that kind of file', remote({ ok: false, error: 'type' }), 'limits'],
    ['offline or redirected', remote({ ok: false, error: 'network' }), 'load'],
    ['not an address it may fetch', remote({ ok: false, error: 'bad' }), 'load'],
    ['not this page', remote({ ok: false, error: 'sender' }), 'load'],
    ['no worker', async () => null, 'load'],
    ['the wrong kind back', remote(wire('image', 'image/webp')), 'load'],
    ['a type nobody plays', remote(wire('video', 'text/html')), 'load'],
    ['no bytes', remote({ ok: true, type: 'video', mime: 'video/webm' }), 'load'],
    ['bytes that are not base64', remote({ ok: true, type: 'video', mime: 'video/webm', b64: '!!' }), 'load'],
  ]) {
    const r = rig({ ask });
    r.scene.update(o({ type: 'video', src: URL1 }));
    await settle();
    assert.deepEqual([why, r.fails, r.e.blobs.length, given(r.e)], [why, [want], 0, []]);
  }
});

test('the editor\'s preview is told when an address broke a limit', async () => {
  const r = rig({ preview: true, ask: remote({ ok: false, error: 'big' }) });
  r.scene.update(o({ type: 'video', src: URL1 }));
  await settle();
  assert.deepEqual(plain(r.e.posted), [[{ gzMediaState: { state: 'failed', why: 'limits' } }, 'chrome-extension://glaze']]);
});

test('a video or picture the decoder finds past the side limit is dropped, whatever the container said', async () => {
  // The worker read the size from the container; the decoder is the one that has to hold the frames.
  for (const [w, h] of [[5000, 100], [100, 4097], [8192, 8192]]) {
    const r = rig({ ask: remote(wire('video', 'video/webm')), preview: true });
    r.scene.update(o({ type: 'video', src: URL1 }));
    await settle();
    const v = kinds(r.e, 'video')[0];
    Object.assign(v, { videoWidth: w, videoHeight: h });
    v.fire('loadeddata');
    await settle();
    assert.deepEqual([r.fails, r.host.children.length, v.attrs.src, v.loads, r.e.revoked], [['limits'], 0, undefined, 1, ['blob:glaze/0']], `${w} x ${h}`);
    assert.deepEqual(plain(r.e.posted), [[{ gzMediaState: { state: 'failed', why: 'limits' } }, 'chrome-extension://glaze']]);
    const p = rig({ ask: remote(wire('image', 'image/webp')), natural: [w, h] });
    p.scene.update(o({ type: 'image', src: 'https://cdn.example.com/a.webp' }));
    await settle();
    assert.deepEqual([p.fails, p.host.children.length], [['limits'], 0], `a picture ${w} x ${h}`);
  }
  // At the limit is fine, and so is a decoder that does not say.
  const ok = rig({ ask: remote(wire('video', 'video/webm')) });
  ok.scene.update(o({ type: 'video', src: URL1 }));
  await settle();
  const v = kinds(ok.e, 'video')[0];
  Object.assign(v, { videoWidth: 4096, videoHeight: 4096 });
  v.fire('loadeddata');
  await settle();
  assert.deepEqual([ok.fails, ok.host.children.length], [[], 2]);
  const kept = rig({ ask: remote(wire('image', 'image/webp')), natural: [4096, 4096] });
  kept.scene.update(o({ type: 'image', src: 'https://cdn.example.com/a.webp' }));
  await settle();
  assert.deepEqual(kept.fails, []);
});

test('the page and the worker agree on the longest side', () => {
  const side = Number(/^const SIDE = (\d+);/m.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '../lib/scene-media.js'), 'utf8'))[1]);
  assert.equal(side, require('../lib/media.js').LIMIT.bg.image.side);
});

test('video decoder dimensions are refused at metadata time before waiting for a first frame', async () => {
  const r = rig();
  r.scene.update(o({ type: 'video', src: URL1 }));
  await settle();
  const v = kinds(r.e, 'video')[0];
  v.videoWidth = 5000; v.videoHeight = 100;
  v.fire('loadedmetadata');
  await settle();
  assert.deepEqual(r.fails, ['limits']);
  assert.equal(v.src, '');
  assert.ok(r.e.revoked.includes('blob:glaze/0'));
});

test('abandoning a remote video before its copy arrives, or before its first frame, releases it at once', async () => {
  for (const stop of [true, false]) {
    let answer;
    const wait = new Promise((done) => { answer = done; });
    const r = rig({ ask: async (m) => { await wait; return remote(wire('video', 'video/webm'))(m); } });
    r.scene.update(o({ type: 'video', src: URL1 }));
    await settle();
    if (stop) r.scene.stop(); else r.scene.update(o({ type: 'video', src: 'https://cdn.example.com/two.webm' }));
    answer();
    await settle();
    assert.deepEqual(kinds(r.e, 'video').filter((v) => v.src === 'blob:glaze/0'), [], 'the stale copy never reaches an element');
    assert.ok(r.e.revoked.includes('blob:glaze/0'), 'and its blob is revoked');
    r.scene.stop();
  }
});

// ---- an animated picture ------------------------------------------------------------------------------------------------
test('an animated picture shows in an img, and motion off swaps it for its first frame in a canvas', async () => {
  const r = rig();
  r.scene.update(o({ type: 'image', src: 'https://cdn.example.com/a.webp' }));
  await settle();
  const [img, probe] = kinds(r.e, 'img'), canvas = kinds(r.e, 'canvas')[0];
  assert.equal(probe.src, '', 'the element that checked it decodes is let go');
  assert.deepEqual([img.alt, img.decoding, img.referrerPolicy, img.draggable], ['', 'async', 'no-referrer', false]);
  assert.equal(img.src, 'blob:glaze/0');
  const box = r.host.children[0];
  assert.deepEqual(box.children, [img]);
  assert.equal(r.e.draws.length, 0, 'no canvas is drawn while it moves');
  r.scene.update(o({ type: 'image', src: 'https://cdn.example.com/a.webp' }, { speed: 0 }));
  await settle();
  assert.equal(img.src, '', 'the moving picture is taken away');
  assert.deepEqual(box.children, [canvas]);
  assert.equal(r.e.draws.length, 1);
  assert.deepEqual([canvas.width, canvas.height], [640, 360]);
  r.scene.update(o({ type: 'image', src: 'https://cdn.example.com/a.webp' }, { speed: 1 }));
  assert.deepEqual(box.children, [img]);
  assert.equal(img.src, 'blob:glaze/0');
  r.scene.update(o({ type: 'image', src: 'https://cdn.example.com/a.webp' }, { speed: 0 }));
  await settle();
  assert.equal(r.e.draws.length, 1, 'the first frame is drawn once');
  r.scene.update(o({ type: 'image', src: 'https://cdn.example.com/a.webp', fit: 'contain' }));
  assert.deepEqual([img.css['object-fit'], canvas.css['object-fit']], ['contain', 'contain']);
});

test('a page that opens with motion off never puts the moving picture on the page', async () => {
  const r = rig();
  r.scene.update(o({ type: 'image', src: 'https://cdn.example.com/a.webp' }, { speed: 0 }));
  await settle();
  const [img, probe] = kinds(r.e, 'img');
  assert.deepEqual([img.src, probe.src], ['', ''], 'the picture element never loaded it');
  assert.equal(r.e.draws.length, 1);
  assert.deepEqual(r.host.children[0].children.map((c) => c.tag), ['canvas']);
  assert.deepEqual(r.fails, []);
});

test('a picture from a kept file takes its first frame from its own bytes', async () => {
  const h = env().sha(bytes);
  const r = rig({ ask: kept({ h, t: 'image/webp', bytes }) });
  r.scene.update(o({ type: 'image', src: `file:${h}` }, { speed: 0 }));
  await settle();
  assert.equal(r.e.bitmapClosed, true, 'decoded from the bytes, then let go');
  assert.equal(r.e.draws.length, 1);
  assert.deepEqual(r.e.blobs.map((b) => b.slice(1)), [[300, 'image/webp']]);
  r.scene.stop();
  assert.deepEqual(r.e.revoked, ['blob:glaze/0']);
});

test('a picture that will not decode is not shown', async () => {
  const r = rig({ decodeFails: true });
  r.scene.update(o({ type: 'image', src: 'https://cdn.example.com/a.webp' }));
  await settle();
  assert.deepEqual(r.fails, ['load']);
  assert.equal(r.host.children.length, 0);
});

test('a hidden tab leaves a picture alone: the browser draws nothing for it', async () => {
  const r = rig();
  r.scene.update(o({ type: 'image', src: 'https://cdn.example.com/a.webp' }));
  await settle();
  const img = kinds(r.e, 'img')[0];
  r.e.visibility(true);
  assert.equal(img.src, 'blob:glaze/0');
  assert.equal(r.e.draws.length, 0);
});

// ---- a Lottie animation -------------------------------------------------------------------------------------------------
test('a Lottie animation: the player is imported on demand, the worker hands over cleaned JSON, and it draws to a canvas at 1x', async () => {
  const json = { v: '5.7.0', w: 200, h: 120 };
  const r = rig({ ask: async () => ({ ok: true, json, canvases: 1 }) });
  assert.equal(r.e.ctx?.lottie, undefined);
  r.scene.update(o({ type: 'lottie', src: 'https://cdn.example.com/a.json', fit: 'contain' }));
  await settle();
  assert.deepEqual(plain(r.e.messages), [{ type: 'glaze:lottie', src: 'https://cdn.example.com/a.json' }]);
  const [a] = r.e.anims;
  assert.deepEqual(plain([a.o.renderer, a.o.loop, a.o.autoplay, a.o.animationData]), ['canvas', true, false, json]);
  assert.deepEqual(plain(a.o.rendererSettings), { preserveAspectRatio: 'xMidYMid meet', clearCanvas: true, dpr: 1 });
  assert.deepEqual(plain(a.calls), [['setSubframe', false], 'play']);
  assert.deepEqual(r.host.children.map((c) => c.tag), ['div', 'div']);
  assert.equal(a.o.container, r.host.children[0]);
  assert.deepEqual(r.fails, []);
});

test('Lottie holds frame 0 with motion off, pauses while hidden, and plays again', async () => {
  const r = rig();
  r.scene.update(o({ type: 'lottie', src: 'https://cdn.example.com/a.json' }, { speed: 0 }));
  await settle();
  const [a] = r.e.anims;
  assert.deepEqual(plain(a.calls), [['setSubframe', false], ['goToAndStop', 0, true]]);
  r.scene.update(o({ type: 'lottie', src: 'https://cdn.example.com/a.json' }, { speed: 1 }));
  assert.equal(a.calls.at(-1), 'play');
  r.e.visibility(true);
  assert.equal(a.calls.at(-1), 'pause');
  r.e.visibility(false);
  assert.equal(a.calls.at(-1), 'play');
  r.scene.update(o({ type: 'lottie', src: 'https://cdn.example.com/a.json', loop: false }));
  assert.equal(a.calls.at(-1), 'destroy', 'looping is part of what loads: the first one is destroyed');
  await settle();
  assert.equal(r.e.anims.length, 2);
  assert.equal(r.e.anims[1].o.loop, false);
});

test('Lottie follows a resize with a debounced resize of its canvas, and is destroyed on stop', async () => {
  const r = rig();
  r.scene.update(o({ type: 'lottie', src: 'https://cdn.example.com/a.json' }));
  await settle();
  const [a] = r.e.anims;
  r.e.resize(); r.e.resize(); r.e.resize();
  assert.equal(r.e.timers.filter((t) => !t.dead).length, 1, 'the earlier waits are cancelled');
  assert.equal(r.e.timers.at(-1).ms, 150);
  r.e.tick();
  assert.equal(a.calls.filter((c) => c === 'resize').length, 1);
  r.scene.stop();
  assert.equal(a.calls.at(-1), 'destroy');
  assert.equal(r.e.listening(), 0);
});

test('Lottie that the worker refuses, or whose player will not load, leaves the gradient', async () => {
  for (const [why, ask, want] of [
    ['refused', async () => ({ ok: false, error: 'type' }), 'load'],
    ['no answer', async () => null, 'load'],
    ['the file is not here', async () => ({ ok: false, error: 'missing' }), 'file'],
  ]) {
    const r = rig({ ask });
    r.scene.update(o({ type: 'lottie', src: 'file:' + 'A'.repeat(43) }));
    await settle();
    assert.deepEqual([why, r.fails, r.host.children.length, r.e.anims.length], [why, [want], 0, 0]);
  }
  const r = rig();
  r.e.lottieOk = false;
  r.scene.update(o({ type: 'lottie', src: 'https://cdn.example.com/a.json' }));
  await settle();
  assert.deepEqual(r.fails, ['module']);
});

test('Lottie is never imported for a video or a picture', async () => {
  const r = rig();
  await video(r);
  assert.equal(r.e.ctx?.lottie, undefined);
  assert.deepEqual(plain(r.e.messages), [{ type: 'glaze:remoteMedia', src: URL1, kind: 'video' }], 'only the video\'s own file is asked for');
});

test('the editor\'s preview is told when it plays', async () => {
  const r = rig({ preview: true });
  await video(r);
  assert.deepEqual(plain(r.e.posted), [[{ gzMediaState: { state: 'ready' } }, 'chrome-extension://glaze']]);
  const p = rig();
  await video(p);
  assert.deepEqual(p.e.posted, [], 'a page tells nobody');
});


test('idle Lottie detaches its rendering canvas and keeps a still image until playback resumes', async () => {
  const r = rig();
  const spec = { type: 'lottie', src: 'https://cdn.example.com/a.json' };
  r.scene.update(o(spec));
  await settle();
  const box = r.host.children[0], canvas = box.children[0];
  assert.equal(canvas.tag, 'canvas');
  r.e.visibility(true);
  assert.equal(canvas.parentNode, null, 'a hidden tab has no composited renderer canvas');
  assert.deepEqual([canvas.width, canvas.height], [0, 0], 'the backing buffer is released');
  assert.equal(box.children[0].tag, 'img');
  assert.equal(r.e.anims[0].calls.at(-1), 'pause');
  r.e.visibility(false);
  assert.equal(box.children[0], canvas, 'playback reuses the paused renderer');
  r.scene.update(o(spec, { speed: 0 }));
  assert.equal(canvas.parentNode, null, 'motion off also releases the composited canvas');
  assert.equal(box.children[0].tag, 'img');
  assert.deepEqual(plain(r.e.anims[0].calls.at(-1)), ['goToAndStop', 0, true]);
  const blobs = r.e.blobs.length;
  r.scene.draw(); r.e.resize(); r.e.tick();
  assert.equal(box.children[0].tag, 'img');
  assert.equal(r.e.blobs.length, blobs + 1, 'only a resize replaces the still');
  r.scene.stop();
  assert.equal(r.e.revoked.length, r.e.blobs.length, 'all still images are released');
});


test('stopping or replacing a Lottie that is still loading destroys its renderer immediately', async () => {
  for (const stop of [true, false]) {
    const r = rig({ lottieDelayed: true });
    r.scene.update(o({ type: 'lottie', src: 'https://cdn.example.com/a.json' }));
    await settle();
    const a = r.e.anims[0];
    assert.ok(a);
    if (stop) r.scene.stop(); else r.scene.update(o({ type: 'video', src: URL1 }));
    assert.ok(a.calls.includes('destroy'));
    assert.equal(r.host.children.length, 0);
  }
});


test('a still image that decodes late cannot clear a picture that has resumed playing', async () => {
  let release;
  const bitmapWait = new Promise((done) => { release = done; });
  const h = env().sha(bytes), r = rig({ ask: kept({ h, t: 'image/webp', bytes }), bitmapWait });
  const spec = { type: 'image', src: `file:${h}` };
  r.scene.update(o(spec));
  await settle();
  const img = kinds(r.e, 'img')[0];
  r.scene.update(o(spec, { speed: 0 }));
  r.scene.update(o(spec, { speed: 1 }));
  release();
  await settle();
  assert.equal(img.src, 'blob:glaze/0');
  assert.equal(r.host.children[0].children[0], img);
  r.scene.stop();
});

test('stopping before a media source resolves prevents a late network load', async () => {
  for (const type of ['video', 'image']) {
    const r = rig();
    r.scene.update(o({ type, src: URL1 }));
    r.scene.stop();
    await settle();
    assert.deepEqual(r.e.srcs, [], type);
    assert.equal(r.host.children.length, 0);
  }
});

test('abandoning a kept video before its first frame revokes its blob immediately', async () => {
  const h = env().sha(bytes);
  for (const stop of [true, false]) {
    const r = rig({ ask: kept({ h, t: 'video/webm', bytes }) });
    r.scene.update(o({ type: 'video', src: `file:${h}` }));
    await settle();
    const pending = kinds(r.e, 'video')[0];
    assert.equal(pending.src, 'blob:glaze/0');
    if (stop) r.scene.stop(); else r.scene.update(o({ type: 'video', src: URL1 }));
    assert.deepEqual(r.e.revoked, ['blob:glaze/0'], 'no load event is needed to release the kept file');
    pending.fire('loadeddata');
    await settle();
    assert.deepEqual(r.e.revoked, ['blob:glaze/0'], 'a late completion cannot release it twice');
    r.scene.stop();
  }
});

test('Lottie rejects aggregate viewport buffers before setup and before an oversized resize', async () => {
  const ask = async () => ({ ok: true, json: { w: 1, h: 1 }, canvases: 1001 });
  const huge = rig({ ask });
  huge.scene.update(o({ type: 'lottie', src: 'https://cdn.example.com/mattes.json' }));
  await settle();
  assert.equal(huge.e.anims.length, 0, 'tiny authored dimensions cannot conceal viewport-sized matte canvases');
  assert.deepEqual(huge.fails, ['load']);

  const r = rig({ ask: async () => ({ ok: true, json: { w: 1, h: 1 }, canvases: 5 }) });
  r.scene.update(o({ type: 'lottie', src: 'https://cdn.example.com/mattes.json' }));
  await settle();
  assert.equal(r.e.anims.length, 1, 'ordinary mattes still work');
  r.e.width = 10000; r.e.height = 10000;
  r.e.resize(); r.e.tick();
  assert.deepEqual(r.fails, ['load']);
  assert.equal(r.e.anims[0].calls.includes('resize'), false, 'no oversized backing buffers are requested');
});

test('Lottie requires worker-checked canvas metadata', async () => {
  for (const canvases of [undefined, 0, -1, 1.5, Infinity, '1']) {
    const r = rig({ ask: async () => ({ ok: true, json: { w: 1, h: 1 }, canvases }) });
    r.scene.update(o({ type: 'lottie', src: 'https://cdn.example.com/mattes.json' }));
    await settle();
    assert.equal(r.e.anims.length, 0, String(canvases));
    assert.deepEqual(r.fails, ['load']);
  }
});

test('Lottie setup keeps its measured size while asynchronous initialization is pending', async () => {
  const r = rig({ lottieDelayed: true, ask: async () => ({ ok: true, json: { w: 1, h: 1 }, canvases: 5 }) });
  r.scene.update(o({ type: 'lottie', src: 'https://cdn.example.com/mattes.json' }));
  await settle();
  const a = r.e.anims[0];
  assert.deepEqual([a.o.container.css.width, a.o.container.css.height], ['1280px', '800px']);
  r.e.width = r.e.height = 10000;
  for (const f of a.listeners.DOMLoaded) f();
  await settle();
  assert.deepEqual(r.fails, ['load']);
  assert.ok(a.calls.includes('destroy'));
});
