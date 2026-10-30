// Code mods' API v1 cleaners (lib/modapi.js) and the broker's calls built on them (lib/modbroker.js): every refusal.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../lib/modapi.js');
const B = require('../lib/modbroker.js');

const T = (x) => ({ type: 'text', text: x });
const stack = (children, more = {}) => ({ type: 'stack', children, ...more });

test('a component tree: every component, cleaned and unchanged when cleaned again', () => {
  const tree = stack([
    { type: 'row', children: [T('Hi'), { type: 'number', value: 3.25, label: 'GPA', unit: 'pts', digits: 2, color: 'accent' }], gap: 2, align: 'center', wrap: true },
    { type: 'list', children: [T('a'), T('b')], ordered: true, label: 'Due' },
    { type: 'ring', value: 40, max: 50, label: 'Done', color: '#AABBCC' },
    { type: 'progress', value: 0.5, max: 1 },
    { type: 'countdown', to: 1893456000000, label: 'Exam', done: 'Now' },
    { type: 'image', src: 'art/leaf.png', alt: 'A leaf', w: 64, fit: 'cover' },
    { type: 'button', id: 'go', label: 'Go', tone: 'primary' },
    { type: 'input', id: 'name', kind: 'text', label: 'Name', value: 'Kai', maxLength: 20, placeholder: 'You' },
    { type: 'input', id: 'n', kind: 'number', label: 'N', value: 2, min: 0, max: 5, step: 1 },
    { type: 'input', id: 't', kind: 'toggle', label: 'On', value: true },
    { type: 'input', id: 's', kind: 'select', label: 'Plant', options: ['Fern', 'Cactus'], value: 'Cactus' },
    { type: 'canvas', h: 120, label: 'Garden' },
  ], { label: 'Garden' });
  const c = A.tree(tree);
  assert.ok(c);
  assert.equal(c.children[2].color, '#aabbcc', 'hex colours are kept lowercase');
  assert.deepEqual(A.tree(c), c, 'idempotent');
  assert.deepEqual(A.images(c), ['art/leaf.png']);
});

test('a component tree is refused whole on anything out of its shape or limits', () => {
  const deep = (n) => (n ? stack([deep(n - 1)]) : T('x'));
  assert.ok(A.tree(deep(7)), 'eight levels');
  assert.equal(A.tree(deep(8)), null, 'nine');
  assert.ok(A.tree(stack(Array.from({ length: 50 }, () => stack(Array.from({ length: 2 }, () => T('x')))).slice(0, 49))));
  assert.equal(A.tree(stack(Array.from({ length: 51 }, () => T('x')))), null, 'more than 50 children');
  assert.equal(A.tree(stack(Array.from({ length: 4 }, () => stack(Array.from({ length: 50 }, () => T('x')))))), null, 'more than 200 nodes');
  const bad = [
    null, 'text', [], { type: 'script' }, { type: 'text' }, T(7), T('x'.repeat(501)), { ...T('x'), onclick: 'alert(1)' }, { ...T('x'), color: 'red' },
    { ...T('x'), color: '#abc' }, { ...T('x'), color: 'url(x)' }, { ...T('x'), size: 'huge' }, { ...T('x'), __proto__: { type: 'text' } },
    { type: 'number', value: NaN }, { type: 'number', value: Infinity }, { type: 'number', value: '3' }, { type: 'number', value: 1, digits: 5 },
    { type: 'ring', value: 1, max: 0 }, { type: 'countdown', to: -1 }, { type: 'countdown', to: 1.5 },
    { type: 'image', src: 'https://x.test/a.png', alt: '' }, { type: 'image', src: '../a.png', alt: '' }, { type: 'image', src: 'a.svg', alt: '' }, { type: 'image', src: 'a.png' },
    { type: 'button', id: 'Go!', label: 'x' }, { type: 'button', id: 'go', label: '' }, { type: 'button', id: 'go', label: 'x'.repeat(61) },
    { type: 'input', id: 'a', kind: 'date', label: 'x' }, { type: 'input', id: 'a', kind: 'select', label: 'x', options: [] }, { type: 'input', id: 'a', kind: 'select', label: 'x', options: ['a', 'a'] },
    { type: 'input', id: 'a', kind: 'select', label: 'x', options: ['a'], value: 'b' }, { type: 'input', id: 'a', kind: 'number', label: 'x', value: 9, max: 5 },
    { type: 'input', id: 'a', kind: 'number', label: 'x', min: 5, max: 1 }, { type: 'input', id: 'a', kind: 'text', label: 'x', value: 'long', maxLength: 2 },
    { type: 'input', id: 'a', kind: 'toggle', label: 'x', value: 'yes' }, { type: 'input', id: 'a', kind: 'text', label: 'x', options: ['a'] },
    { type: 'canvas', h: 2000 }, stack([{ type: 'canvas' }, { type: 'canvas' }]), stack([{ type: 'button', id: 'a', label: 'x' }, { type: 'button', id: 'a', label: 'y' }]),
    stack('nope'), { type: 'row', children: [], ordered: true }, { type: 'list', children: [], gap: 1 },
  ];
  for (const b of bad) assert.equal(A.tree(b), null, JSON.stringify(b));
  // Text loses control and direction characters, and keeps its line breaks only in a text block.
  assert.equal(A.tree(T('a‮\u0007b\r\nc')).text, 'a b\nc');
  assert.equal(A.tree({ type: 'button', id: 'b', label: 'a\nb' }).label, 'a b');
});

test('card decorations, palette commands and effects', () => {
  assert.deepEqual(A.decorations({ _12_1: { badge: 'A+', accent: 'ok' }, 34: { note: 'Quiz Friday' } }), { 34: { note: 'Quiz Friday' }, _12_1: { badge: 'A+', accent: 'ok' } });
  for (const bad of [{ x: {} }, { x: { badge: 'x'.repeat(13) } }, { x: { note: 'x'.repeat(121) } }, { x: { accent: 'pink' } }, { x: { badge: '' } }, { 'a b': { badge: 'x' } }, { x: { badge: 'x', html: '<b>' } }, [], null,
    Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`c${i}`, { badge: 'x' }]))]) assert.equal(A.decorations(bad), null, JSON.stringify(bad)?.slice(0, 80));
  assert.deepEqual(A.commands([{ id: 'water', title: 'Water the plants', hint: 'Garden' }]), [{ id: 'water', title: 'Water the plants', hint: 'Garden' }]);
  for (const bad of [[{ id: 'a', title: 'x' }, { id: 'a', title: 'y' }], [{ id: 'a' }], [{ id: 'a', title: 'x', run: 'f' }], Array.from({ length: 17 }, (_, i) => ({ id: `c${i}`, title: 'x' })), {}]) assert.equal(A.commands(bad), null);
  const e = A.effect('confetti', { count: 10, c: ['accent', '#00FF00'], x: 0.25 });
  assert.deepEqual([e.fx.kind, e.fx.count, e.fx.c, e.x, e.y], ['confetti', 10, ['accent', '#00ff00'], 0.25, 1 / 3]);
  assert.ok(A.effect('ring'), 'no options: the kind\'s own');
  for (const [k, o] of [['laser', {}], ['burst', { count: 61 }], ['burst', { x: 2 }], ['burst', { shapes: ['skull'] }], ['burst', { c: ['red'] }], ['burst', { sound: 'boom' }], ['burst', 'loud']]) assert.equal(A.effect(k, o), null, `${k} ${JSON.stringify(o)}`);
});

test('the student\'s records: replacements turned on (modReplace), settings values (modSettings), the order (modOrder)', () => {
  const manifest = { replaces: ['bg', 'effect:complete'], settings: [{ id: 'plant', type: 'choice', label: 'Plant', options: ['Fern', 'Cactus'] }, { id: 'n', type: 'number', label: 'N', min: 0, max: 10, step: 2, default: 4 }, { id: 'on', type: 'toggle', label: 'On' }, { id: 'c', type: 'color', label: 'C' }, { id: 't', type: 'text', label: 'T', max: 3 }] };
  assert.deepEqual(A.replace({ 'effect:complete': true, bg: false }, manifest), { bg: false, 'effect:complete': true });
  for (const bad of [{ nav: true }, { bg: 1 }, [], null, { __proto__: { bg: true } }]) assert.equal(A.replace(bad, manifest), null, JSON.stringify(bad));
  assert.deepEqual(A.enabled({ bg: true, nav: true, 'effect:complete': false }, manifest), ['bg'], 'only what the manifest still declares, and true');
  assert.deepEqual(A.enabled(undefined, manifest), [], 'off by default');
  assert.deepEqual(A.values({ plant: 'Cactus', n: 3, on: 'yes', c: '#ABCDEF', t: 'long', gone: 1 }, manifest), { plant: 'Cactus', n: 4, on: false, c: '#000000', t: '' }, 'what no longer fits is its default');
  assert.deepEqual(A.values(undefined, { settings: 'x' }), {});
  assert.deepEqual(A.order(['a', 'b', 'c'], ['c', 'x', 'a']), ['c', 'a', 'b']);
  assert.deepEqual(A.order(['a', 'b'], 'junk'), ['a', 'b']);
});

// ---- the broker's calls ---------------------------------------------------------------------------------------------------
test('replacement claims need the matching slot, but saved opt-ins survive a missing slot', () => {
  const manifest = { replaces: ['bg', 'nav', 'tile:timer', 'effect:complete'], ui: { background: {}, tiles: [{ id: 'other' }] } };
  const saved = { bg: true, nav: true, 'tile:timer': true, 'effect:complete': true, 'effect:grade': true };
  assert.deepEqual(A.claims(saved, manifest), ['bg', 'effect:complete']);
  assert.deepEqual(A.enabled(saved, manifest), ['bg', 'effect:complete', 'nav', 'tile:timer']);
  assert.deepEqual(A.claims(saved, { ...manifest, ui: { nav: {}, tiles: [{ id: 'timer' }] } }), ['effect:complete', 'nav', 'tile:timer']);
  assert.deepEqual(A.claims({ bg: false }, manifest), []);
});

const ID = 'abcdefghijklmnop', SITE = 'https://canvas.school.edu';
const area = (data) => ({ data, get: async (k) => (k === null ? { ...data } : Object.fromEntries([].concat(k).filter((x) => x in data).map((x) => [x, data[x]]))), set: async (o) => (Object.assign(data, o), true), remove: async (k) => { for (const x of [].concat(k)) delete data[x]; return true; } });
const rec = (over = {}) => ({ id: ID, enabled: true, hash: 'h', key: 'k', grants: { courses: true }, paths: ['art/leaf.png', 'ui.html'],
  manifest: { name: 'Garden', permissions: [{ id: 'courses', why: 'w' }], ui: { tiles: [{ id: 'garden', name: 'Garden', sizes: ['m'] }, { id: 'page', name: 'Page', file: 'ui.html', sizes: ['s'] }], rail: [{ id: 'r', name: 'R' }], nav: {}, background: null },
    settings: [{ id: 'plant', type: 'choice', label: 'Plant', options: ['Fern', 'Cactus'] }], replaces: ['nav'] }, ...over });
const env = (r = rec(), local = {}) => { const l = area({ [`mod:${ID}`]: r, ...local }); let q = Promise.resolve(); return { site: SITE, local: l, sync: area({}), queue: (f) => (q = q.then(f, f)), keys: async () => Object.keys(l.data), record: async () => r, blocklist: async () => null, fetch: async () => { throw new Error('no'); } }; };
const call = (e, c, args, via = 'worker') => B.handle({ mod: ID, call: c, args, via }, e);

test('the broker cleans what a mod hands Glaze to show, and refuses the rest', async () => {
  const e = env();
  assert.deepEqual(await call(e, 'ui.render', ['tile:garden', T('hi')]), { ok: true, value: { slot: 'tile:garden', tree: { type: 'text', text: 'hi' } } });
  assert.deepEqual(await call(e, 'ui.render', ['rail:r', null]), { ok: true, value: { slot: 'rail:r', tree: null } }, 'null clears');
  assert.equal((await call(e, 'ui.render', ['nav', T('n')])).ok, true);
  for (const [args, error] of [[['tile:nope', T('x')], 'slot'], [['tile:page', T('x')], 'slot'], [['background', T('x')], 'slot'], [['tiles:garden', T('x')], 'slot'], [[7, T('x')], 'slot'],
    [['tile:garden', { type: 'html', html: '<b>' }], 'tree'], [['tile:garden'], 'args'], [['tile:garden', { type: 'image', src: 'art/other.png', alt: '' }], 'image']]) assert.deepEqual(await call(e, 'ui.render', args), { ok: false, error }, JSON.stringify(args));
  assert.equal((await call(e, 'ui.render', ['tile:garden', { type: 'image', src: 'art/leaf.png', alt: '' }])).ok, true, 'its own picture');
  assert.deepEqual(await call(e, 'cards.set', [{ 1: { badge: 'A' } }]), { ok: true, value: { 1: { badge: 'A' } } });
  assert.deepEqual(await call(e, 'cards.set', [{ 1: { badge: 'way too long badge' } }]), { ok: false, error: 'args' });
  assert.deepEqual(await call(env(rec({ grants: {} })), 'cards.set', [{ 1: { badge: 'A' } }]), { ok: false, error: 'permission' }, 'decorating needs courses granted');
  assert.deepEqual(await call(e, 'cards.set', [{ 1: { badge: 'A' } }], 'frame:tile:page'), { ok: false, error: 'permission' }, 'and only from the Worker');
  assert.deepEqual(await call(e, 'palette.set', [[{ id: 'go', title: 'Go' }]]), { ok: true, value: [{ id: 'go', title: 'Go' }] });
  assert.deepEqual(await call(e, 'palette.set', [[{ id: 'go' }]]), { ok: false, error: 'args' });
  assert.deepEqual(await call(e, 'rules.set', [[{ p: 'canvas.dashboard', do: 'hide' }]]).then((r) => r.ok), true);
  assert.deepEqual(await call(e, 'rules.set', [[]]), { ok: true, value: [] }, '[] takes them away');
  for (const bad of [[{ p: 'canvas.dashboard', do: 'hide', sel: 'body' }], [{ p: 'body', do: 'hide' }], 'x']) assert.deepEqual(await call(e, 'rules.set', [bad]), { ok: false, error: 'args' }, JSON.stringify(bad));
  assert.deepEqual(await call(e, 'look.override', [{ cursor: { kind: 'trail' } }]), { ok: true, value: { cursor: { kind: 'trail' } } });
  assert.deepEqual(await call(e, 'look.override', [null]), { ok: true, value: null });
  for (const bad of [{ cursor: { kind: 'laser' } }, { css: 'body{}' }, {}]) assert.deepEqual(await call(e, 'look.override', [bad]), { ok: false, error: 'args' }, JSON.stringify(bad));
  // A layout from code needs nav.layout, which this mod lacks (test/mod-nav.test.js has the rest); withdrawing needs none.
  assert.deepEqual(await call(e, 'nav.set', [{ hidden: ['calendar'] }]), { ok: false, error: 'permission' });
  assert.deepEqual(await call(e, 'nav.set', [null]), { ok: true, value: null });
  const arranges = rec({ grants: { courses: true, 'nav.layout': true }, manifest: { ...rec().manifest, permissions: [{ id: 'courses', why: 'w' }, { id: 'nav.layout', why: 'w' }] } });
  assert.deepEqual(await call(env(arranges), 'nav.set', [{ hidden: 'all' }]), { ok: false, error: 'args' });
  assert.equal((await call(e, 'effects.play', ['burst', { count: 5 }])).value.fx.count, 5);
  assert.deepEqual(await call(e, 'effects.play', ['laser']), { ok: false, error: 'args' });
  assert.deepEqual(await call(e, 'broadcast', [{ a: 1 }]), { ok: true, value: { a: 1 } });
  assert.deepEqual(await call(e, 'broadcast', ['x'.repeat(65 * 1024)]), { ok: false, error: 'size' });
  assert.deepEqual(await call(e, 'settings', []), { ok: true, value: { plant: 'Fern' } });
  e.local.data[`modSettings:${ID}`] = { plant: 'Cactus' };
  assert.deepEqual(await call(e, 'settings', []), { ok: true, value: { plant: 'Cactus' } });
  assert.deepEqual(await call(env(rec({ enabled: false })), 'ui.render', ['tile:garden', T('x')]), { ok: false, error: 'mod' }, 'a mod turned off shows nothing');
  assert.deepEqual(await B.handle({ mod: ID, call: 'ui.render', args: ['tile:garden', T('x')], via: 'worker' }, { ...env(), blocklist: async () => ({ mods: [ID] }) }), { ok: false, error: 'blocked' });
});

test('a picture for the page: only an on mod\'s own picture files', async () => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const r = rec({ files: { 'art/leaf.png': b64, 'hooks.js': 'eA==' } });
  const e = env(r);
  assert.deepEqual(await B.page({ op: 'asset', mod: ID, path: 'art/leaf.png' }, e), { ok: true, type: 'image/png', b64 });
  assert.deepEqual(await B.page({ op: 'asset', mod: ID, path: 'hooks.js' }, e), { ok: false, error: 'asset' });
  assert.deepEqual(await B.page({ op: 'asset', mod: ID, path: 'art/none.png' }, e), { ok: false, error: 'asset' });
  assert.deepEqual(await B.page({ op: 'asset', mod: ID, path: '__proto__' }, e), { ok: false, error: 'asset' });
  e.local.data[`mod:${ID}`] = { ...r, enabled: false };
  assert.deepEqual(await B.page({ op: 'asset', mod: ID, path: 'art/leaf.png' }, e), { ok: false, error: 'mod' });
  assert.deepEqual(await B.page({ op: 'asset', mod: ID, path: 'art/leaf.png' }, { ...e, site: null }), { ok: false, error: 'sender' });
});

test('decoration course ids remain own data properties, including prototype-shaped ids', async () => {
  const raw = JSON.parse('{"__proto__":{"badge":"A"},"constructor":{"note":"B"}}');
  const cleaned = A.decorations(raw);
  assert.equal(Object.getPrototypeOf(cleaned), Object.prototype);
  assert.equal(Object.hasOwn(cleaned, '__proto__'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(cleaned)), raw);
  assert.deepEqual(await call(env(), 'cards.set', [raw]), { ok: true, value: raw });
});

test('the asset broker rejects pictures with oversized or unreadable dimensions before decoding on the page', async () => {
  const header = Buffer.alloc(24); header.write('\x89PNG', 0, 'latin1');
  header.writeUInt32BE(8192, 16); header.writeUInt32BE(8192, 20);
  for (const picture of [header.toString('base64'), 'not-base64!', Buffer.from('not a picture').toString('base64')]) {
    const e = env(rec({ files: { 'large.png': picture } }));
    assert.deepEqual(await B.page({ op: 'asset', mod: ID, path: 'large.png' }, e), { ok: false, error: 'asset' });
  }
});
