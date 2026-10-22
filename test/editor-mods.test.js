// The editor's Mods tab (lib/editor-mods.js): the prompt's permission lines and Glaze's warnings, what a mod adds, settings
// cleaned against their schema, the student's order, the grants an install or update sends, and refusals in words.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lib/editor-mods.js');
const M = require('../lib/modbundle.js');
const vm = require('node:vm');
const fs = require('node:fs');

// The mounted tab, with storage reads that tests can hold across a change event.
let ask = () => true; // what window.confirm answers; the question it was asked is in `asked`
const asked = [];
const mounted = (mods, data = {}, read = async (k, v) => v, respond = async () => ({ ok: true })) => {
  const ids = new Map(), sent = [];
  let changed;
  const element = () => ({ children: [], attrs: {}, dataset: {}, checked: false, disabled: false, textContent: '', className: '',
    onchange: null, onclick: null, classList: { toggle() {} }, addEventListener() {},
    append(...kids) { this.children.push(...kids); }, replaceChildren(...kids) { this.children = kids; },
    setAttribute(k, v) { this.attrs[k] = v; if (k === 'data-f') this.dataset.f = v; },
    contains(e) { return this === e || this.children.some((c) => c?.contains?.(e)); }, focus() { document.activeElement = this; } });
  const document = { activeElement: null, createElement: element, querySelector: () => null,
    getElementById(id) { if (!ids.has(id)) ids.set(id, element()); return ids.get(id); } };
  const local = { get: async (k) => read(k, structuredClone(Object.fromEntries([].concat(k).filter((x) => Object.hasOwn(data, x)).map((x) => [x, data[x]])))),
    set: async (patch) => { Object.assign(data, structuredClone(patch)); changed(Object.fromEntries(Object.keys(patch).map((k) => [k, {}])), 'local'); },
    remove: async (k) => { for (const x of [].concat(k)) delete data[x]; } };
  const chrome = { storage: { local, onChanged: { addListener(f) { changed = f; } } }, runtime: { getManifest: () => ({ sandbox: {} }),
    sendMessage: async (m) => { sent.push(m); return m.op === 'list' ? { ok: true, mods: structuredClone(mods) } : respond(m); } } };
  const ctx = vm.createContext({ chrome, document, GZ_MODBUNDLE: M, GZ_XPARTS: require('../lib/lookparts.js'), GZ_MODAPI: require('../lib/modapi.js'), requestAnimationFrame: (f) => f(), confirm: (q) => { asked.push(q); return ask(q); } });
  vm.runInContext(fs.readFileSync(require.resolve('../lib/editor-mods.js'), 'utf8'), ctx);
  ctx.GZ_MODSEDIT.mount({ t, and, when: String });
  const find = (f, e = document.getElementById('mods-list')) => e?.dataset?.f === f ? e : e?.children?.map((c) => find(f, c)).find(Boolean);
  return { document, sent, data, find, changed: (...args) => changed(...args) };
};
const settle = () => new Promise((r) => setImmediate(r));
const record = (id, more = {}) => { const manifest = view({ hooks: 'h.js', ...more }); return { id, enabled: true, manifest, prompt: M.prompt(manifest) }; };

const t = (k, vars = {}) => k.replace(/\{(\w+)\}/g, (s, n) => (n in vars ? String(vars[n]) : s));
const and = (a) => a.join(' and ');
const view = (more = {}) => ({ glaze: 1, name: 'Grade Ring', version: '1.0.0', author: { name: 'Kai', key: 'k'.repeat(43) }, ...more });

test('prompt lines: Glaze words first, the author\'s reason kept apart, new permissions marked', () => {
  const v = view({ permissions: [{ id: 'grades', why: 'Draws a ring.' }, { id: 'network:api.weather.gov', why: 'Rain.' }] });
  const ls = E.lines(v, t);
  assert.deepEqual(ls.map((l) => l.id), ['grades', 'network:api.weather.gov']);
  assert.equal(ls[0].text, 'Grades — reads your grades and GPA in every course.');
  assert.equal(ls[0].why, 'Draws a ring.');
  assert.equal(ls[1].text, 'Network — sends and receives data from api.weather.gov.');
  assert.ok(ls.every((l) => !l.fresh));
  assert.deepEqual(E.lines(v, t, ['network:api.weather.gov']).map((l) => l.fresh), [false, true]);
  // A page of its own is asked about too, with no author reason.
  const framed = E.lines(view({ ui: { tiles: [{ id: 'a', name: 'A', file: 'a.html', sizes: ['m'] }] } }), t);
  assert.deepEqual(framed.map((l) => [l.id, l.why]), [['code', ''], ['frame', '']]);
  // Code is asked about too: the line says so, and a widget Glaze draws itself has none.
  const hooked = E.lines(view({ hooks: 'hooks.js' }), t);
  assert.deepEqual(hooked.map((l) => [l.id, l.text]), [['code', 'Runs its author’s code — Glaze doesn’t draw it itself.']]);
  assert.deepEqual(E.lines(view({ permissions: [{ id: 'todo', why: 'x' }], ui: { tiles: [{ id: 'a', name: 'A', sizes: ['m'], blocks: [{ type: 'text', text: 'hi' }] }] } }), t).map((l) => l.id), ['todo']);
});

test('warnings: personal data with a network host names both, own pages, Chrome, unsigned and not reviewed', () => {
  const v = view({ permissions: [{ id: 'grades', why: 'x' }, { id: 'todo', why: 'y' }, { id: 'network:a.example', why: 'z' }, { id: 'network:b.example', why: 'w' }], hooks: 'hooks.js' });
  const ws = E.warnings(v, { t, and, signed: true, source: 'file', runs: true });
  assert.deepEqual(ws.map((w) => w.kind), ['data', 'chrome', 'review']);
  assert.equal(ws[0].text, 'This mod could send your to-dos and grades to a.example and b.example.');
  assert.equal(ws[1].text, 'Its code runs only in Chrome.');
  // Reviewed from the gallery, but unsigned would be refused there; here: unsigned, no runtime, own page, no data.
  const framed = view({ ui: { rail: [{ id: 'r', name: 'R', file: 'r.html' }] }, permissions: [{ id: 'network:a.example', why: 'z' }] });
  const ws2 = E.warnings(framed, { t, and, signed: false, source: 'gallery', runs: false });
  assert.deepEqual(ws2.map((w) => w.kind), ['frame', 'chrome', 'dev']);
  assert.match(ws2[1].text, /^Needs Chrome/);
  // Data without a host, or a host without data: no combination warning. A declarative mod: no Chrome line.
  assert.ok(!E.warnings(view({ permissions: [{ id: 'grades', why: 'x' }] }), { t, signed: true, source: 'gallery', runs: true }).length);
  assert.ok(!E.warnings(view({ permissions: [{ id: 'network:a.example', why: 'x' }] }), { t, signed: true, source: 'gallery', runs: true }).length);
});

test('what a mod adds, its source and its author fingerprint', () => {
  const v = view({ ui: { tiles: [{ id: 'g', name: 'Garden', sizes: ['m'] }], rail: [{ id: 'r', name: 'Clock' }], nav: {}, background: null }, hooks: 'h.js',
    replaces: ['bg', 'effect:grade', 'tile:timer'], settings: [{ id: 'a', type: 'toggle', label: 'A' }], parts: { cursor: { kind: 'trail' } } });
  const got = E.adds(v, t);
  for (const line of ['A tile: Garden', 'A rail widget: Clock', 'A navigation of its own', 'Code that runs while you use your school pages', 'Can replace the background',
    'Can replace the grade effect', 'Can replace the timer tile', '1 settings']) assert.ok(got.includes(line), line);
  assert.ok(!got.includes('A background of its own'));
  assert.equal(E.fingerprint('11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'), '11qY AYKx CrfV S_7T');
  assert.equal(E.fingerprint(null), '');
  assert.equal(E.sourceText('gallery', t), 'From Glaze’s gallery');
  assert.equal(E.sourceText('nope', t), '');
  assert.equal(E.hasCode(view()), false);
  assert.equal(E.hasCode(view({ ui: { background: { file: 'b.html' } } })), true);
});

test('settings are cleaned against the schema: types, ranges, steps, choices, colours, text', () => {
  const specs = [
    { id: 'on', type: 'toggle', label: 'On', default: true },
    { id: 'pick', type: 'choice', label: 'Pick', options: ['Fern', 'Cactus'] },
    { id: 'n', type: 'number', label: 'N', min: 0, max: 10, step: 0.5, default: 2 },
    { id: 'c', type: 'color', label: 'C' },
    { id: 's', type: 'text', label: 'S', max: 5 },
  ];
  assert.deepEqual(E.settings(specs, undefined), { on: true, pick: 'Fern', n: 2, c: '#000000', s: '' });
  assert.deepEqual(E.settings(specs, { on: 'yes', pick: 'Rose', n: 99, c: 'red', s: 42, extra: 1 }), { on: true, pick: 'Fern', n: 10, c: '#000000', s: '' });
  assert.deepEqual(E.settings(specs, { on: false, pick: 'Cactus', n: 3.3, c: '#ABCDEF', s: ' a‮\u0000b  cdefgh ' }), { on: false, pick: 'Cactus', n: 3.5, c: '#abcdef', s: 'a b c' });
  assert.equal(E.value(specs[2], -5), 0);
  assert.equal(E.value(specs[2], NaN), 2);
  assert.equal(E.value({ type: 'number', min: 0, max: 1, step: 0.1 }, 0.30000000000000004), 0.3);
  assert.equal(E.value({ type: 'number', min: 0, max: 10, step: 3 }, 10), 9, 'a step never lands past max');
  assert.equal(E.value({ type: 'text' }, 'x'.repeat(600)).length, 500);
  // Idempotent: a cleaned record cleans to itself.
  const once = E.settings(specs, { n: 7.74, s: 'hello world' });
  assert.deepEqual(E.settings(specs, once), once);
  assert.deepEqual(E.settings(null, { a: 1 }), {});
});

test('settings defaults are cleaned too and number steps stay inside the range', () => {
  const specs = [{ id: 'n', type: 'number', min: 0, max: 10, step: 0.5, default: 3.3 },
    { id: 's', type: 'text', default: 'a\u200bb', max: 5 }];
  assert.deepEqual(E.settings(specs), { n: 3.5, s: 'a b' });
  assert.equal(E.value({ type: 'number', min: 0, max: 10, step: 6 }, 10), 6);
  assert.equal(E.value({ type: 'number', min: 0, max: 0.3, step: 0.1 }, 0.3), 0.3);
});

test('order: the saved order over what is installed, new mods last; moves stay inside the list', () => {
  assert.deepEqual(E.order(['a', 'b', 'c'], ['c', 'x', 'a', 'c']), ['c', 'a', 'b']);
  assert.deepEqual(E.order(['a', 'b'], 'junk'), ['a', 'b']);
  assert.deepEqual(E.move(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(E.move(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(E.move(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
  assert.deepEqual(E.move(['a', 'b'], 'z', 1), ['a', 'b']);
});

test('grants: an install grants what it asked for; an update keeps revocations and adds only what was shown as new', () => {
  const v = view({ permissions: [{ id: 'grades', why: 'x' }, { id: 'todo', why: 'y' }, { id: 'network:a.example', why: 'z' }] });
  assert.deepEqual(E.grantsFor(v, null, []), ['grades', 'todo', 'network:a.example']);
  assert.deepEqual(E.grantsFor(v, { grants: { grades: true } }, ['network:a.example']), ['grades', 'network:a.example'], 'todo was revoked and stays so');
});

test('refusals in words, and the stop reasons the runtime keeps', () => {
  assert.equal(E.refusal({ error: 'refused', reason: 'blocked', blocked: 'Bad.' }, t), 'Glaze has blocked this mod: Bad.');
  assert.match(E.refusal({ error: 'refused', reason: 'dev-off' }, t), /dev mode/);
  assert.equal(E.refusal({ error: 'bundle', why: 'That mod has two files named {path}.', vars: { path: 'a.js' } }, t), 'That mod has two files named a.js.');
  assert.equal(E.refusal({ error: 'refused', reason: 'nonsense' }, t), 'Glaze couldn’t do that.');
  assert.equal(E.refusal(undefined, t), 'Glaze couldn’t do that.');
  for (const why of ['hung', 'error', 'navigated']) assert.ok(E.stopText(why, t));
  assert.equal(E.stopText('other', t), '');
});

test('the prompt reads only the sanitized view: no zero-width characters reach a line', async () => {
  const AUTHOR = { kty: 'OKP', crv: 'Ed25519', d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' };
  const mod = await M.pack({ 'h.js': new TextEncoder().encode('1;\n') }, { glaze: 1, name: 'Ring​', version: '1.0.0', author: { name: 'K⁠ai' },
    permissions: [{ id: 'grades', why: 'Rings\u200b evil\u2060.' }], hooks: 'h.js' }, AUTHOR);
  const got = E.lines(mod.prompt, t);
  assert.equal(got[0].why, 'Rings evil.');
  assert.equal(mod.prompt.name, 'Ring');
});

test('channel updates disclose the contacted relay host through translation', () => {
  const seen = [];
  const translate = (key, vars) => { seen.push(key); return t(key, vars); };
  assert.equal(E.channelNotice('https://relay.example:8443/j#1.r.key', translate), 'Updates are checked at relay.example:8443 about once a day');
  assert.equal(E.channelNotice('broken', translate), '');
  for (const lang of ['de', 'es', 'fr', 'nl', 'pt-BR']) {
    require(`../i18n/${lang}.js`);
    assert.ok(globalThis.GZ_LANGS[lang][seen[0]]?.includes('{host}'), lang);
  }
});

test('replacement labels, and the mod that wins a place is the first in the student\'s order that has it on', () => {
  assert.deepEqual(['bg', 'nav', 'effect:complete', 'tile:timer'].map((k) => E.replaceLabel(k, t)),
    ['Replace the background', 'Replace the nav bar', 'Replace the complete effect', 'Replace the timer tile']);
  const claims = { a: ['nav'], b: ['bg', 'nav'], c: ['bg'] };
  assert.equal(E.winner('nav', ['b', 'a', 'c'], claims), 'b');
  assert.equal(E.winner('nav', ['a', 'b', 'c'], claims), 'a');
  assert.equal(E.winner('bg', ['a', 'b', 'c'], claims), 'b');
  assert.equal(E.winner('tile:timer', ['a', 'b', 'c'], claims), null);
});

test('winner notes ignore mods without the claimed slot and mods that cannot run', async () => {
  const replaces = ['bg', 'nav', 'tile:timer', 'effect:complete'];
  const a = record('a', { name: 'Empty', replaces });
  const b = record('b', { name: 'First', replaces, ui: { background: {}, nav: {}, tiles: [{ id: 'timer', name: 'Timer', sizes: ['m'] }] } });
  const c = record('c', { ...b.manifest, name: 'Second' });
  const data = Object.fromEntries(['a', 'b', 'c'].map((id) => [`modReplace:${id}`, Object.fromEntries(replaces.map((k) => [k, true]))]));
  const p = mounted([a, b, c], data);
  await settle();
  for (const key of ['bg', 'nav', 'tile:timer']) {
    assert.equal(p.find(`a:wins:${key}`), undefined);
    assert.match(p.find(`c:wins:${key}`).textContent, /^First wins/);
  }
  assert.match(p.find('c:wins:effect:complete').textContent, /^Empty wins/, 'effects need no UI slot');
  for (const change of [{ enabled: false }, { blocked: 'Blocked' }, { manifest: view({ replaces }) }]) {
    const q = mounted([{ ...b, ...change }, c], data);
    await settle();
    assert.equal(q.find('c:wins:bg'), undefined, 'an inactive mod cannot compete');
  }
  data.modRuntime = { ok: false };
  p.changed({ modRuntime: {} }, 'local');
  await settle();
  assert.equal(p.find('c:wins:bg'), undefined);
});

test('winner notes exclude a frame-only update whose mod previously held private data', async () => {
  const first = record('a', { name: 'Frame', hooks: undefined, replaces: ['bg'], ui: { background: { file: 'bg.html' } } });
  const second = record('b', { replaces: ['bg'], ui: { background: {} } });
  const p = mounted([first, second], { 'modPrivate:a': true, 'modReplace:a': { bg: true }, 'modReplace:b': { bg: true } });
  await settle();
  assert.equal(p.find('b:wins:bg'), undefined, 'the worker cannot start this frame-only mod');
  p.data['modPrivate:a'] = false;
  p.changed({ 'modPrivate:a': {} }, 'local');
  await settle();
  assert.match(p.find('b:wins:bg').textContent, /^Frame wins/);
});

test('winner notes exclude Dev copies while dev mode is off', async () => {
  const first = { ...record('a', { name: 'Dev', replaces: ['bg'], ui: { background: {} } }), dev: true };
  const second = record('b', { replaces: ['bg'], ui: { background: {} } });
  const p = mounted([first, second], { modDev: true, 'modReplace:a': { bg: true }, 'modReplace:b': { bg: true } });
  await settle();
  assert.match(p.find('b:wins:bg').textContent, /^Dev wins/);
  p.data.modDev = false;
  p.changed({ modDev: { newValue: false } }, 'local');
  await settle();
  assert.equal(p.find('b:wins:bg'), undefined);
});

test('each replacement switch sends only the key that changed', async () => {
  const p = mounted([record('a', { replaces: ['bg', 'nav'] })]);
  await settle();
  p.find('a:replace:bg').onchange({ target: { checked: true } });
  p.find('a:replace:nav').onchange({ target: { checked: true } });
  await settle();
  assert.deepEqual(p.sent.filter((m) => m.op === 'replace').map((m) => JSON.parse(JSON.stringify(m.set))), [{ bg: true }, { nav: true }]);
});

test('Remove offers to take the mod\'s stored data too, on by default, and says what it will do', async () => {
  const p = mounted([record('a')]);
  await settle();
  const wipe = p.find('a:wipe');
  assert.equal(wipe.checked, true, 'on by default');
  asked.length = 0;
  await p.find('a:remove').onclick();
  assert.equal(asked.at(-1), 'Remove Grade Ring? Its settings and the data it stored on this device go too.');
  assert.equal(p.sent.filter((m) => m.op === 'remove').at(-1).data, true);
  wipe.checked = false;
  await p.find('a:remove').onclick();
  assert.equal(asked.at(-1), 'Remove Grade Ring? Its settings on this device go too, but the data it stored stays.');
  assert.equal(p.sent.filter((m) => m.op === 'remove').at(-1).data, false);
  ask = () => false;
  const before = p.sent.length;
  await p.find('a:remove').onclick();
  assert.equal(p.sent.length, before, 'cancelling sends nothing');
  ask = () => true;
});

test('Remove waits for the broker before clearing settings and keeps them after a failed removal', async () => {
  let release;
  const data = { 'modSettings:a': { plant: 'Fern' } };
  const p = mounted([record('a')], data, undefined, () => new Promise((r) => { release = r; }));
  await settle();
  const pending = p.find('a:remove').onclick();
  await settle();
  assert.ok(data['modSettings:a'], 'settings remain while the broker is working');
  p.find('a:wipe').checked = false;
  assert.equal(p.sent.at(-1).data, true, 'the confirmed choice was captured before awaiting');
  release({ ok: false, error: 'write' });
  await pending;
  assert.ok(data['modSettings:a'], 'failed removal preserves settings');
  const retry = p.find('a:remove').onclick();
  await settle();
  assert.equal(p.sent.at(-1).data, false);
  release({ ok: true });
  await retry;
  assert.equal(data['modSettings:a'], undefined, 'success removes settings even when cached data was kept');
  assert.equal(p.document.activeElement, p.document.getElementById('heading-mods-installed'));
});

test('a replacement change during a draw is rendered after the pending read', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const data = { 'modReplace:a': { bg: false } };
  let held = false;
  const p = mounted([record('a', { replaces: ['bg'] })], data, async (keys, snapshot) => {
    if (Array.isArray(keys) && !held) { held = true; await gate; }
    return snapshot;
  });
  await settle();
  assert.equal(held, true);
  data['modReplace:a'] = { bg: true };
  p.changed({ 'modReplace:a': {} }, 'local');
  release();
  await settle();
  assert.equal(p.find('a:replace:bg').checked, true, 'the storage event must not be lost while drawing');
});


test('the install prompt discloses remote backgrounds without claiming there is no network', async () => {
  const source = fs.readFileSync(require.resolve('../lib/editor-mods.js'), 'utf8');
  const start = source.indexOf('    const prompt = async ');
  const end = source.indexOf('    // A bundle', start);
  const ids = new Map();
  const $ = (id) => {
    if (!ids.has(id)) ids.set(id, { textContent: '', replaceChildren(...children) { this.children = children; }, focus() {} });
    return ids.get(id);
  };
  const ctx = vm.createContext({ $, t, and, URL, lines: E.lines, plain: E.plain, warnings: E.warnings, fingerprint: E.fingerprint, sourceText: E.sourceText,
    channelNotice: E.channelNotice, runs: async () => true, dialog: { open: false, showModal() { this.open = true; } },
    h: (tag, props, ...children) => ({ tag, ...props, children }), pending: null });
  vm.runInContext(`${source.slice(start, end)}\nthis.prompt = prompt;`, ctx);
  const media = (src) => view({ parts: { bg: { media: { type: 'video', src } } } });
  for (const remote of [true, false]) {
    const prompt = media(remote ? 'https://media.example/loop.webm' : `file:${'a'.repeat(43)}`);
    await ctx.prompt({ prompt, signed: true }, new Uint8Array(), 'file', null, []);
    const note = $('mod-prompt-perms-note').textContent;
    const ws = $('mod-prompt-warn').children;
    if (remote) {
      assert.doesNotMatch(note, /no network/);
      assert.ok($('mod-prompt-perms').children.some((li) => li.children.some((w) => /media.example/.test(w?.textContent) && /address/.test(w.textContent))), 'the host sees the address and use');
    } else {
      assert.match(note, /no network/);
      assert.ok(!ws.some((w) => /media.example/.test(w.textContent)));
    }
  }
});


test('dev folder scans bound depth and empty directory counts before reading files', async () => {
  const source = fs.readFileSync(require.resolve('../lib/editor-mods.js'), 'utf8');
  const start = source.indexOf('    const walk = async '), end = source.indexOf('    const loadFolder =', start);
  const ctx = vm.createContext({ B: () => M, Uint8Array });
  vm.runInContext(`${source.slice(start, end)}\nthis.walk = walk;`, ctx);
  let visited = 0;
  const deep = (n) => ({ kind: 'directory', async *entries() { visited++; if (n < 40) yield ['deep', deep(n + 1)]; } });
  await assert.rejects(ctx.walk(deep(0)), /./);
  assert.ok(visited <= M.CAP.depth + 1, 'stop before descending past the supported path depth');
  visited = 0;
  for (const prefix of ['dir-', '.hidden-']) {
    visited = 0;
    const many = { async *entries() { for (let i = 0; i < M.CAP.files * M.CAP.depth + 1; i++) { visited++; yield [`${prefix}${i}`, { kind: 'directory', async *entries() {} }]; } } };
    await assert.rejects(ctx.walk(many), /./);
    assert.ok(visited <= M.CAP.files * M.CAP.depth + 1);
  }
});


test('author creation in the editor uses the shared worker operation', async () => {
  const source = fs.readFileSync(require.resolve('../lib/editor-mods.js'), 'utf8');
  const start = source.indexOf('    const makeKey = async () =>'), end = source.indexOf("    $('mod-export-signed')", start);
  const requests = [], key = {};
  const ctx = vm.createContext({ send: async (m) => { requests.push(m.op); return { ok: true, key, created: false }; }, say() {}, keySaid: {}, t });
  vm.runInContext(`${source.slice(start, end)}\nthis.makeKey = makeKey;`, ctx);
  assert.equal(await ctx.makeKey(), key);
  assert.deepEqual(requests, ['author']);
});


test('remote media host changes are shown as New without becoming network grants', () => {
  const v = view({ parts: { bg: { media: { type: 'video', src: 'https://media.example/a.webm' } } } });
  const ls = E.lines(v, t, ['media:media.example']);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].id, 'media:media.example');
  assert.equal(ls[0].fresh, true);
  assert.match(ls[0].text, /media.example.*address/);
  assert.equal(ls[0].why, '');
  assert.deepEqual(E.grantsFor(v, null, ['media:media.example']), []);
});


test('installed remote-media disclosure has no grant checkbox', async () => {
  const p = mounted([record('a', { parts: { bg: { media: { type: 'video', src: 'https://media.example/a.webm' } } } })]);
  await settle();
  assert.equal(p.find('a:perm:media:media.example'), undefined, 'implicit host consent is not a declared grant');
});
