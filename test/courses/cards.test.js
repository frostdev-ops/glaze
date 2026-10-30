const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../lib/cards.js');

const A = 'canvas:https://school.instructure.com/25';
const B = 'canvas:http://localhost:3000/26';

test('a card style keeps only what its kind uses, and refuses what is off', () => {
  assert.deepEqual(K.style({ k: 'solid', c: '#ABCDEF', d: '#000000', u: 'https://x.test/a.png' }), { k: 'solid', c: '#abcdef' });
  assert.deepEqual(K.style({ k: 'gradient', c: '#111111', d: '#222222', a: 90 }), { k: 'gradient', c: '#111111', d: '#222222', a: 90 });
  assert.deepEqual(K.style({ k: 'gradient', c: '#111111', d: '#222222', a: 400 }), { k: 'gradient', c: '#111111', d: '#222222' }, 'an angle out of range is dropped');
  assert.deepEqual(K.style({ k: 'image', u: 'https://x.test/a b".png', o: 40, f: 'noir', x: 20, y: 80, z: 150, c: '#ff0000' }),
    { k: 'image', u: 'https://x.test/a%20b%22.png', c: '#ff0000', o: 40, f: 'noir', x: 20, y: 80, z: 150 });
  assert.deepEqual(K.style({ k: 'image', i: 'abcdef123456', f: 'toString', z: 50 }), { k: 'image', i: 'abcdef123456' });
  for (const bad of [null, 'x', [], { k: 'sync' }, { k: 'solid' }, { k: 'solid', c: 'red' }, { k: 'gradient', c: '#111111' },
    { k: 'image' }, { k: 'image', u: 'http://x.test/a.png' }, { k: 'image', u: 'javascript:alert(1)' }, { k: 'image', i: '../../x' }, { k: 'solid', c: '#000000; x' },
    { k: 'image', u: 'https://a"b.test/a.png' }, { k: 'image', u: 'https://x.test/a.png?q\\' }]) {
    assert.equal(K.style(bad), null, JSON.stringify(bad));
  }
});

test('the cards item keeps courses by their key, a theme set without local pictures, and fits sync storage', () => {
  const got = K.styles({ [A]: { k: 'solid', c: '#123456' }, 'x") }': { k: 'solid', c: '#123456' }, '_1_1': { k: 'solid', c: '#123456' },
    '*': [{ k: 'solid', c: '#111111' }, { k: 'image', i: 'abcdef123456' }, { k: 'nope' }, ...Array(20).fill({ k: 'solid', c: '#222222' })] });
  assert.deepEqual(Object.keys(got), [A, '*']);
  assert.equal(got['*'].length, K.SET_MAX);
  assert.ok(got['*'].every((s) => !s.i));
  const many = Object.fromEntries(Array.from({ length: 200 }, (_, n) => [`canvas:https://school.instructure.com/${n}`, { k: 'image', u: `https://example.com/${'p'.repeat(60)}/${n}.jpg` }]));
  const kept = K.styles(many);
  assert.ok(K.bytes('cards', kept) <= K.ITEM_MAX);
  assert.ok(Object.keys(kept).length > 20 && Object.keys(kept).length < 200);
  assert.deepEqual(K.styles(kept), kept, 'idempotent');
  assert.deepEqual(K.styles('junk'), {});
});

test('bookmarks: https or a path on the same site, an icon from the set, at most eight a course', () => {
  const got = K.links({ [A]: [
    { n: '  Lab   notes ', u: 'https://docs.example.com/lab', i: 'book' },
    { n: 'Files', u: '/courses/25/files?x="y"', i: 'constructor', h: true },
    { n: 'bad', u: 'javascript:alert(1)' }, { n: 'bad', u: '//evil.example/x' }, { n: 'bad', u: 'http://plain.example' }, { u: '/%E0%A4%A' },
    { n: 'slash', u: '/\\evil.example' },
  ], [B]: 'nope', junk: [{ u: 'https://x.test' }] });
  assert.deepEqual(got, { [A]: [
    { n: 'Lab notes', u: 'https://docs.example.com/lab', i: 'book' },
    { n: 'Files', u: '/courses/25/files?x=%22y%22', i: 'link', h: true },
    { n: 'slash', u: '/%5Cevil.example', i: 'link' },
  ] });
  assert.equal(new URL(got[A][2].u, 'https://school.instructure.com').host, 'school.instructure.com');
  assert.equal(K.links({ [A]: Array(20).fill({ u: '/x' }) })[A].length, K.LINKS_MAX);
  const big = Object.fromEntries(Array.from({ length: 100 }, (_, n) => [`canvas:https://s.instructure.com/${n}`, Array(8).fill({ n: 'n'.repeat(40), u: `https://example.com/${'q'.repeat(80)}` })]));
  assert.ok(K.bytes('links', K.links(big)) <= K.ITEM_MAX);
});

test('a card wears its own style, else the theme set in turn', () => {
  const own = { k: 'solid', c: '#111111' };
  const set = [{ k: 'solid', c: '#222222' }, { k: 'solid', c: '#333333' }];
  assert.equal(K.pick({ [A]: own, '*': set }, A, 0), own);
  assert.equal(K.pick({ '*': set }, A, 3), set[1]);
  assert.equal(K.pick({}, A, 0), null);
});

test('what a style paints', () => {
  assert.deepEqual(K.paint({ k: 'solid', c: '#123456' }), { kind: 'solid', vars: { '--gz-card-c': '#123456' } });
  assert.equal(K.paint({ k: 'gradient', c: '#111111', d: '#222222' }).vars['--gz-card-grad'], 'linear-gradient(135deg, #111111, #222222)');
  const img = K.paint({ k: 'image', u: 'https://x.test/a.png', f: 'mono', x: 10, z: 200 }, 'https://x.test/a.png').vars;
  assert.deepEqual(img, { '--gz-card-img': 'url("https://x.test/a.png")', '--gz-card-pos': '10% 50%', '--gz-card-zoom': '2', '--gz-card-filter': 'grayscale(1)', '--gz-card-ov': 'var(--gz-course)', '--gz-card-ov-a': '0.6' });
  assert.equal(K.paint({ k: 'image', i: 'abcdef123456' }, ''), null, 'a picture that is not on this device paints nothing');
  assert.equal(K.paint(null), null);
});

test('contrast is measured, never corrected', () => {
  assert.ok(K.contrast({ k: 'solid', c: '#000000' }) > 20);
  assert.ok(K.contrast({ k: 'solid', c: '#ffff00' }) < 1.1);
  // A gradient is as readable as its worst stop.
  assert.equal(K.contrast({ k: 'gradient', c: '#000000', d: '#ffffff' }), 1);
  // A bright picture under a dark overlay reads; with no overlay it doesn't.
  assert.ok(K.contrast({ k: 'image', u: 'https://x', c: '#000000', o: 80 }, { avg: '#f0f0f0' }) >= 4.5);
  assert.ok(K.contrast({ k: 'image', u: 'https://x', o: 0 }, { avg: '#f0f0f0' }) < 1.2);
  assert.equal(K.contrast({ k: 'image', u: 'https://x' }), null, "a picture the browser won't let be read");
});

// canvas.css rules, as [selector, body], comments removed; @media blocks flattened.
const cssRules = (file = 'canvas.css') => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const walk = (text) => {
    for (let i = 0; i < text.length;) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const sel = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; depth && j < text.length; j++) if (text[j] === '{') depth++; else if (text[j] === '}') depth--;
      const body = text.slice(open + 1, j - 1);
      if (sel.startsWith('@media') || sel.startsWith('@supports')) walk(body); else out.push([sel, body]);
      i = j;
    }
  };
  walk(css);
  return out;
};

test('motion off stills the pet and the particles; hover motion off stops what a hover starts', () => {
  const rules = cssRules();
  for (const [sel, body] of rules) {
    const moving = /animation:\s*gz-(pet-act|card-fall)/.test(body);
    if (!moving) continue;
    for (const s of sel.split(/,(?![^(]*\))/)) {
      assert.match(s, /:not\([^)]*\[data-gz-motion="off"\]/, `${s} animates with motion off`);
      assert.match(s, /\[data-gz-no-hover\]/, `${s} animates with hover motion off`);
    }
  }
  assert.ok(rules.some(([sel, body]) => /data-gz-motion="off"\][^{]*\.gz-pet/.test(sel) && /animation:\s*none\s*!important/.test(body)), 'an Off rule that no hover rule outranks');
});

test('Ultra board cards share the existing hover effects and the pet motion-Off rule', () => {
  const rules = cssRules('theme.css');
  assert.ok(rules.some(([sel, body]) => sel.includes('.gz-course-card') && sel.includes('data-gz-motion="off"]') && /animation:\s*none\s*!important/.test(body)), 'reduced motion stops the board pet');
  for (const effect of ['grow', 'tilt', 'glow', 'shine']) assert.ok(rules.some(([sel]) => sel.includes(`data-gz-card-hover="${effect}"`) && sel.includes('.gz-course-card')), effect);
  assert.ok(rules.some(([sel, body]) => sel.includes('.gz-course-card') && /animation:\s*gz-card-fall/.test(body)), 'board particles use the guarded shared rule');
});

test("turning off Canvas's overlay never hides a card's own style", () => {
  for (const [sel, body] of cssRules()) {
    if (!/data-gz-card-plain/.test(sel) || !/opacity:\s*0\s*!important/.test(body)) continue;
    for (const s of sel.split(/,(?![^(]*\))/)) assert.match(s, /:not\(\[data-gz-card\]\)|\[data-gz-card="image"\][^,]*overlay/, `${s.trim()} also hides custom styles`);
  }
});

test('card settings: defaults, ranges and choices, and what they paint on the page', () => {
  const d = K.settings();
  assert.deepEqual(d, { width: 262, gap: -1, radius: -1, height: 146, condensed: false, overlay: true, hover: 'lift', particles: 'none', pet: 'none', icons: true, create: false });
  assert.deepEqual(K.settings({ width: 999, gap: 10, hover: 'spin', pet: 'cat', icons: 'yes', radius: 3.5 }), { ...d, gap: 10, pet: 'cat' });
  assert.deepEqual(K.settings('junk'), d);
  const p = K.page({ ...d, gap: 20, condensed: true, overlay: false });
  assert.deepEqual(p.vars, { '--gz-card-w': '262px', '--gz-card-gap': '20px', '--gz-card-r': 'initial', '--gz-card-h': '146px' });
  assert.deepEqual(p.attrs, { hover: 'lift', particles: 'none', pet: 'none', condensed: '', icons: '', plain: '' });
  assert.equal(K.page(d).attrs.plain, false);
  assert.ok(!K.LOOK.includes('icons') && !K.LOOK.includes('create') && K.LOOK.includes('pet'));
});

test('contrast is measured on what CSS paints: the overlay composited in sRGB, and none when the overlay is off', () => {
  // A white picture under 50% black is #808080 on screen: 3.95:1 with white text, not OKLab's lighter mix.
  const r = K.contrast({ k: 'image', u: 'https://x', c: '#000000', o: 50 }, { avg: '#ffffff' });
  assert.ok(Math.abs(r - 3.95) < 0.02, String(r));
  assert.equal(K.over('#ffffff', '#000000', 0.5), '#808080');
  // Overlay off (card.overlay): the picture alone.
  assert.equal(K.contrast({ k: 'image', u: 'https://x', c: '#000000', o: 90 }, { avg: '#ffffff', overlay: false }), 1);
  // A plain linear-gradient's midpoint is the sRGB one too.
  assert.equal(K.contrast({ k: 'gradient', c: '#000000', d: '#ffffff' }), 1);
  assert.ok(Math.abs(K.contrast({ k: 'gradient', c: '#000000', d: '#000000' }) - 21) < 0.01);
});

test('local pictures: scaled down, capped each and in all, and dropped with their style', () => {
  assert.deepEqual(K.fit(4000, 2000), { w: 960, h: 480 });
  assert.deepEqual(K.fit(300, 200), { w: 300, h: 200 }, 'never scaled up');
  assert.ok(K.room(1000, { a: 5000 }));
  assert.ok(!K.room(K.IMG_MAX + 1));
  assert.ok(!K.room(K.IMG_MAX, { a: K.IMG_TOTAL - K.IMG_MAX + 1 }));
  assert.deepEqual(K.orphans({ [A]: { k: 'image', i: 'aaaaaaaaaaaa' } }, { aaaaaaaaaaaa: 10, bbbbbbbbbbbb: 20 }), ['bbbbbbbbbbbb']);
  // What storage holds is what counts: every cardImg: key, by its own size.
  assert.deepEqual(K.kept({ 'cardImg:aaaaaaaaaaaa': 'data:xx', cardImgs: { zzz: 1 }, other: 'x' }), { aaaaaaaaaaaa: 7 });
  assert.match('data:image/webp;base64,AAAA', K.DATA);
  assert.doesNotMatch('data:image/svg+xml;base64,AAAA', K.DATA);
  assert.doesNotMatch('data:image/webp;base64,AA") x', K.DATA);
});

test('theme codes carry how cards look and linked card styles, never a picture from this computer', async () => {
  const G = require('../defaults.js');
  const S = require('../lib/share.js');
  const s = { ...G.GZ_SANITIZE({}), card: K.settings({ hover: 'glow', pet: 'cat', create: true, width: 300 }) };
  const cards = { [A]: { k: 'image', i: 'abcdef123456' }, [B]: { k: 'image', u: 'https://pics.example/a.jpg', f: 'warm' }, 'canvas:https://s.instructure.com/9': { k: 'solid', c: '#123456' } };
  const got = await S.decode(await S.encode(s, cards));
  assert.deepEqual(got.card, { width: 300, hover: 'glow', pet: 'cat' }, 'how cards look, not what they do (create)');
  assert.deepEqual(got.cards, [cards[B], cards['canvas:https://s.instructure.com/9']]);
  // Nothing card-ish when it's all defaults: older Glaze reads the code as before.
  const plain = await S.decode(await S.encode(G.GZ_SANITIZE({})));
  assert.deepEqual([plain.card, plain.cards], [{}, []]);
  const make = async (obj) => {
    const z = await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return `glaze1:${Buffer.from(z).toString('base64url')}`;
  };
  const c = G.GZ_COLORS.map(([, , d]) => d.slice(1)).join('');
  for (const [why, obj] of [
    ['a local picture', { c, d: [{ k: 'image', i: 'abcdef123456' }] }],
    ['an http picture', { c, d: [{ k: 'image', u: 'http://pics.example/a.jpg' }] }],
    ['a broken style', { c, d: [{ k: 'solid', c: 'red' }] }],
    ['too many styles', { c, d: Array(9).fill({ k: 'solid', c: '#111111' }) }],
    ['a behaviour setting', { c, k: { create: true } }],
    ['out of range', { c, k: { width: 9999 } }],
    ['not a list', { c, d: { k: 'solid', c: '#111111' } }],
  ]) await assert.rejects(S.decode(await make(obj)), Error, why);
});

test('every valid saved state gives a code that decodes back to it, or a clear "too long" at copy time', async () => {
  const G = require('../defaults.js');
  const S = require('../lib/share.js');
  // Deterministic states: settings at their edges, and card styles with every optional field, including the longest
  // links the cards item can hold (signed links: no repeats for deflate to fold).
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  const hex = () => `#${rnd(0xffffff).toString(16).padStart(6, '0')}`;
  const styleOf = (n, long) => [
    () => ({ k: 'solid', c: hex() }),
    () => ({ k: 'gradient', c: hex(), d: hex(), ...(rnd(2) && { a: rnd(361) }) }),
    () => ({ k: 'image', u: `https://pics.example/${long ? Array.from({ length: long }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[rnd(36)]).join('') : n}.jpg`, ...(rnd(2) && { c: hex() }), ...(rnd(2) && { o: rnd(101) }), f: Object.keys(K.FILTERS)[1 + rnd(7)], x: rnd(101), y: rnd(101), z: 100 + rnd(201) }),
  ][n % 3]();
  let copied = 0, refused = 0;
  for (let n = 0; n < 60; n++) {
    const long = n % 10 === 9 ? 850 : n % 10 === 8 ? 300 : 0;
    const cards = K.styles(Object.fromEntries(Array.from({ length: 1 + rnd(8) }, (_, i) => [`canvas:https://s.instructure.com/${i}`, styleOf(n + i, long)])));
    const card = K.settings(Object.fromEntries(Object.entries(K.SPEC).map(([k, [d, rule]]) => [k, rnd(2) ? d : rule === 'bool' ? !d : typeof rule[0] === 'number' ? rule[rnd(2)] : rule[rnd(rule.length)]])));
    const s = { ...G.GZ_SANITIZE({}), card };
    let code;
    try { code = await S.encode(s, cards); } catch (e) { assert.match(e.message, /too long for a code/); refused++; continue; }
    const got = await S.decode(code);
    copied++;
    assert.deepEqual(got.cards, Object.values(cards).filter((v) => !v.i).slice(0, K.SET_MAX));
    for (const [k, v] of Object.entries(got.card)) assert.equal(v, card[k]);
  }
  assert.ok(copied > 40, `${copied} copied, ${refused} refused`);
  // The worst the cards item allows: eight pictures with long signed links. Refused when copied, never a code that
  // its own decoder calls damaged.
  const worst = K.styles(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`canvas:https://s.instructure.com/${i}`, { k: 'image', u: `https://pics.example/${Array.from({ length: 850 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[rnd(36)]).join('')}` }])));
  assert.equal(Object.keys(worst).length, 8);
  await assert.rejects(S.encode(G.GZ_SANITIZE({}), worst), /too long for a code/);
});
