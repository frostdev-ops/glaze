// A Look whose background is a file kept on this computer (`file:<hash>`), and what a code can say about it (LOOK-9): "Copy theme code"
// does not copy a code that plays nothing where it is pasted, and the offer does not claim the file came with it. A Look share still
// carries the file, beside its code.
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../lib/lookparts.js');
const S = require('../lib/share.js');
const G = require('../defaults.js');

const HASH = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const LINK = 'https://cdn.example.com/loops/rain.webm';
const settings = (kind = 'media') => G.GZ_SANITIZE({ bg: { kind } });
const parts = (src, type = 'video') => ({ x: { bg: { media: { type, src, dim: 50 } } } });
const REFUSAL = /file kept on this computer, which a theme code can’t carry/;

test('Copy theme code refuses a Look whose background is a kept file, and says what to do instead', async () => {
  for (const type of ['video', 'image', 'lottie']) {
    await assert.rejects(S.encode(settings(), {}, parts(`file:${HASH}`, type), { files: false }), (e) => {
      assert.match(e.message, REFUSAL);
      assert.match(e.message, /Use a link to the file instead, or share this Look in a share session/);
      assert.equal(e.why, e.message, 'English with no placeholders: the editor translates it');
      return true;
    }, type);
  }
});

test('a link, a Look with no media and a kept file the Look is not showing all copy as a code', async () => {
  const linked = await S.encode(settings(), {}, parts(LINK), { files: false });
  assert.equal((await S.decode(linked)).parts.x.bg.media.src, LINK);
  assert.ok(await S.encode(settings('solid'), {}, null, { files: false }));
  // A file set aside while another kind of background is worn stays stored and goes in no code.
  const aside = await S.encode(settings('solid'), {}, parts(`file:${HASH}`), { files: false });
  assert.equal((await S.decode(aside)).parts, null);
});

test('a Look share still carries the kept file: the code names it and the file travels beside it', async () => {
  for (const options of [undefined, {}, { files: true }]) {
    const code = await S.encode(settings(), {}, parts(`file:${HASH}`), options);
    assert.equal((await S.decode(code)).parts.x.bg.media.src, `file:${HASH}`);
  }
});

test('the offer does not say a file came with a code that cannot bring one', () => {
  const d = (m) => X.describe({ x: { bg: { media: m } } });
  for (const [type, noun] of [['video', 'a video'], ['image', 'an animated picture'], ['lottie', 'an animation']]) {
    const [line] = d({ type, src: `file:${HASH}` });
    assert.doesNotMatch(line.why, /came with it/, type);
    assert.match(line.why, new RegExp(`^Plays ${noun} behind your pages from a file it names\\. If that file isn’t on this computer, the gradient shows instead\\.$`), type);
    assert.equal(line.vars, undefined);
  }
  // A mod's file really is in its bundle; a link names its host.
  assert.equal(d({ type: 'video', src: './a.webm' })[0].why, 'Plays a video behind your pages, from a file that came with it.');
  assert.equal(d({ type: 'video', src: LINK })[0].why, 'Plays a video behind your pages, loaded from {host}.');
});

// The editor's "Copy theme code" button, run from options.js itself with the real encoder (the way test/look-offer-review.test.js runs the offer).
const copyButton = async (parts, kind = 'media') => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../options.js'), 'utf8');
  const section = source.slice(source.indexOf("  $('#share-copy').addEventListener"), source.indexOf('  // from: the gallery Look the code came with'));
  assert.ok(section.includes('GZ_SHARE.encode('), 'the section is the copy button');
  const handlers = {}, hints = [], copied = [], box = { value: '', select() {} };
  const context = vm.createContext({
    GZ_SHARE: S, s: { ...settings(kind), parts }, hint: (...xs) => hints.push(xs), Promise,
    t: (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars?.[k]),
    $: (id) => (id === '#share-code' ? box : { addEventListener: (type, f) => { handlers[id] = f; } }),
    chrome: { storage: { sync: { get: (key, cb) => cb({}) } } },
    navigator: { clipboard: { writeText: async (code) => { copied.push(code); } } },
  });
  vm.runInContext(section, context);
  await handlers['#share-copy']();
  return { hints, copied };
};

test('Copy theme code refuses a Look with a kept-file background, says what to do, and copies nothing', async () => {
  for (const type of ['video', 'image', 'lottie']) {
    const { hints, copied } = await copyButton(parts(`file:${HASH}`, type));
    assert.deepEqual(copied, [], type);
    assert.equal(hints.length, 1, type);
    assert.match(hints[0][0], REFUSAL);
    assert.match(hints[0][0], /Use a link to the file instead, or share this Look in a share session/);
    assert.equal(hints[0][1], true, 'shown as a problem');
  }
});

test('Copy theme code still copies a link background, and a kept file that is only set aside', async () => {
  const linked = await copyButton(parts(LINK));
  assert.equal(linked.copied.length, 1);
  assert.equal((await S.decode(linked.copied[0])).parts.x.bg.media.src, LINK);
  assert.deepEqual(linked.hints, [['Theme code copied.']]);
  const aside = await copyButton(parts(`file:${HASH}`), 'solid');
  assert.equal(aside.copied.length, 1);
  assert.equal((await S.decode(aside.copied[0])).parts, null);
});
