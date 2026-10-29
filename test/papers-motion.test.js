// The Documents page in motion (papers-motion.js): which motion each level and setting gives, the keyframes a document
// opens and closes with (lib/popup.js's genie, scale and fade, one implementation), and what a page leaving tells the next.
// The page itself is scripts/documents-check.js's motion section.
const test = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../papers-motion.js');
const P = require('../lib/popup.js');

const view = { left: 0, top: 0, width: 1280, height: 900, right: 1280, bottom: 900 };
const card = { left: 320, top: 400, width: 224, height: 300, right: 544, bottom: 700 };

test('each level, setting and switch gets lib/popup.js\'s choice, and none with transitions or entrances off', () => {
  assert.equal(PM.kind({ anim: 'genie', level: 'expressive' }), 'genie');
  assert.equal(PM.kind({ anim: 'genie', level: 'subtle' }), 'scale');
  assert.equal(PM.kind({ anim: 'genie', level: 'off' }), 'none');
  assert.equal(PM.kind({ anim: 'genie', level: 'expressive', reduced: true }), 'none');
  assert.equal(PM.kind({ anim: 'fade', level: 'expressive' }), 'fade');
  assert.equal(PM.kind({ anim: 'none', level: 'expressive' }), 'none');
  assert.equal(PM.kind({ anim: 'genie', level: 'expressive', trans: false }), 'none');
  assert.equal(PM.kind({ anim: 'genie', level: 'expressive', enter: false }), 'none');
  for (const level of ['off', 'subtle', 'expressive']) for (const anim of ['genie', 'fade', 'none']) for (const reduced of [false, true]) {
    assert.equal(PM.kind({ anim, level, reduced }), P.motion({ anim, level, reduced }), `${level} ${anim} ${reduced}`);
  }
});

test('a change of page crossfades with the Pop-up animation at None, and never moves with motion off', () => {
  assert.equal(PM.route({ anim: 'none', level: 'expressive' }), 'fade');
  assert.equal(PM.route({ anim: 'none', level: 'subtle' }), 'fade');
  assert.equal(PM.route({ anim: 'genie', level: 'expressive' }), 'genie');
  assert.equal(PM.route({ anim: 'none', level: 'off' }), 'none');
  assert.equal(PM.route({ anim: 'none', level: 'expressive', reduced: true }), 'none');
  assert.equal(PM.route({ anim: 'none', level: 'expressive', trans: false }), 'none');
  assert.equal(PM.route({ anim: 'none', level: 'expressive', enter: false }), 'none');
});

test('the genie opens out of the card\'s box: its first frame is a strip the card\'s width at the card, its last the page at rest', () => {
  const f = PM.frames('genie', card, view);
  assert.equal(f.kind, 'genie');
  assert.deepEqual(f.timing, P.timing('genie', false));
  const g = P.genie(card, view);
  assert.deepEqual(f.frames.map(({ transformOrigin, ...x }) => x), g.frames, 'lib/popup.js\'s keyframes, as they are');
  assert.ok(f.frames.every((x) => x.transformOrigin === g.origin));
  const first = f.frames[0], last = f.frames.at(-1);
  const xs = first.clipPath.match(/polygon\(([-\d.]+)% ([-\d.]+)%, ([-\d.]+)% ([-\d.]+)%/).slice(1).map(Number);
  assert.ok(Math.abs((xs[2] - xs[0]) / 100 * view.width - card.width) < 1, `the funnel starts at the card's width (${xs})`);
  const [, dy] = first.transform.match(/translate\([-\d.]+px, ([-\d.]+)px\)/).map(Number);
  assert.ok(Math.abs(dy - (card.bottom - view.bottom)) < 0.1 || Math.abs(dy - (card.top - view.top)) < 0.1, `it starts at the card's edge (${dy})`);
  assert.equal(first.opacity, 0);
  assert.equal(last.transform, 'none');
  assert.equal(last.opacity, 1);
  assert.equal(PM.frames('genie', card, view, true).timing.duration, P.timing('genie', true).duration, 'closing takes the genie\'s closing time');
});

test('without a box to grow from, the genie scales in (and shrinks out) about the middle; Subtle scales about the card', () => {
  for (const box of [null, { ...card, left: 2000, right: 2224 }, view]) {
    assert.equal(PM.frames('genie', box, view).kind, 'scale');
    assert.equal(PM.frames('genie', box, view, true).kind, 'shrink');
    assert.equal(PM.frames('genie', box, view).frames[0].transformOrigin, '50% 50%');
  }
  const s = PM.frames('scale', card, view);
  assert.equal(s.kind, 'scale');
  assert.deepEqual(s.timing, P.timing('scale', false));
  assert.deepEqual(s.frames.map(({ transformOrigin, ...x }) => x), P.FRAMES.scale);
  assert.ok(s.frames.every((x) => x.transformOrigin === '432px 550px'), s.frames[0].transformOrigin);
  assert.deepEqual(PM.frames('fade', card, view).frames, P.FRAMES.fade);
  assert.equal(PM.frames('none', card, view), null);
  assert.equal(PM.frames('spin', card, view), null);
});

test('a menu genies from its button: on screen is the window\'s test, smaller is the menu\'s', () => {
  const menu = { left: 900, top: 140, width: 180, height: 170, right: 1080, bottom: 310 }, button = { left: 1050, top: 104, width: 30, height: 30, right: 1080, bottom: 134 };
  assert.equal(PM.frames('genie', button, menu, false, view).kind, 'genie');
  assert.equal(PM.frames('genie', { ...button, top: -60, bottom: -30 }, menu, false, view).kind, 'scale', 'a button scrolled away');
});

test('closing plays the frames backwards: offsets mirrored, order reversed', () => {
  assert.deepEqual(PM.backwards([{ offset: 0, opacity: 0 }, { offset: 0.25, opacity: 0.5 }, { offset: 1, opacity: 1 }]),
    [{ offset: 0, opacity: 1 }, { offset: 0.75, opacity: 0.5 }, { offset: 1, opacity: 0 }]);
  assert.deepEqual(PM.backwards(P.FRAMES.fade), [{ opacity: 1 }, { opacity: 0 }]);
});

test('an address names the document it opens and a New tile\'s format', () => {
  assert.deepEqual(PM.address('?paper=doc%3Aab-12&format=mla9'), { key: 'doc:ab-12', format: 'mla9' });
  assert.deepEqual(PM.address('?paper=bb.school.test%7C_1_1'), { key: 'bb.school.test|_1_1', format: '' });
  assert.deepEqual(PM.address('?sheet=doc%3Ax', ['paper', 'sheet']), { key: 'doc:x', format: '' });
  assert.equal(PM.address(''), null);
  assert.equal(PM.address('?format=mla9'), null);
});

test('what a page leaving tells the next is checked before it is used', () => {
  const ok = PM.handoff(JSON.stringify({ at: '?paper=doc%3Aa', kind: 'genie', box: { left: 1, top: 2, width: 3, height: 4 }, back: null }));
  assert.deepEqual(ok, { at: '?paper=doc%3Aa', kind: 'genie', box: { left: 1, top: 2, width: 3, height: 4, right: 4, bottom: 6 }, back: null, format: '' });
  assert.equal(PM.handoff(JSON.stringify({ at: '', kind: 'genie', back: 'doc:b', format: 'mla9' })).format, 'mla9');
  assert.equal(PM.handoff(JSON.stringify({ at: '', kind: 'spin' })), null);
  assert.equal(PM.handoff(JSON.stringify({ kind: 'fade' })), null);
  assert.equal(PM.handoff('{'), null);
  assert.equal(PM.handoff(null), null);
  assert.equal(PM.handoff(JSON.stringify({ at: '', kind: 'scale', box: { left: NaN, top: 0, width: 5, height: 5 }, back: 'doc:a' })).box, null);
  assert.equal(PM.handoff(JSON.stringify({ at: '', kind: 'scale', box: { left: 0, top: 0, width: 0, height: 5 }, back: 'doc:a' })).box, null);
  assert.equal(PM.handoff(JSON.stringify({ at: '', kind: 'fade', back: 'doc:a' })).back, 'doc:a');
});

test('the list\'s place (search, filters, order, scroll) is read back only in its own shape', () => {
  assert.deepEqual(PM.place(JSON.stringify({ q: 'lab', course: 'c:BIOL 1010', kind: '', sort: 'title', y: 640, back: 'doc:a', fresh: true })),
    { q: 'lab', course: 'c:BIOL 1010', kind: '', sort: 'title', y: 640, back: 'doc:a', fresh: true });
  assert.deepEqual(PM.place(JSON.stringify({ q: 7, course: null, sort: 'random', y: -5 })), { q: '', course: 'all', kind: '', sort: 'updated', y: 0, back: null, fresh: false });
  assert.equal(PM.place('nope'), null);
  assert.equal(PM.place(JSON.stringify({ q: 'x'.repeat(5000) })).q.length, 200);
});
