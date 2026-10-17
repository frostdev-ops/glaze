// Declarative widgets on the page (features/modwidgets.js) in a VM with stand-ins: the tiles and rail widgets it hands the
// boards, what it asks the worker for, buttons that go only to this site's own pages, and following the mods and their data.
// content.js's loader for it is read from the source. The browser side is scripts/widgets-builder-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const eq = (a, b, ...m) => assert.deepStrictEqual(plain(a), plain(b), ...m);

const ID = 'abcdefghijklmnop', OTHER = 'qrstuvwxyz234567';
const PLAIN = (id = ID, slots = [{ key: 'tile:main', name: 'Main', size: 'm' }, { key: 'rail:side', name: 'Side', size: 's' }]) => ({ id, name: 'Dash', slots });
const TREE = { type: 'stack', children: [{ type: 'text', text: 'hello' }, { type: 'button', id: 'b1', label: 'Go' }] };

const page = ({ site = 'ultra', plainList = [PLAIN()], rawList, widget, hidden = false, origin = 'https://school.test' } = {}) => {
  let clock = 1000;
  const timers = new Set();
  const sent = [], declared = [], renders = [], assigned = [], syncs = [], bitmaps = [];
  const state = { list: plainList, hidden };
  const chrome = {
    runtime: { id: 'glaze', sendMessage: async (m) => {
      sent.push(m);
      if (m.op === 'asset') return { ok: true, type: 'image/png', b64: 'AAAA' };
      if (m.op === 'list') return rawList ? rawList() : { ok: true, mods: [], plain: state.list };
      if (m.op === 'widget') return widget ? widget(m) : { ok: true, tree: TREE, acts: { b1: 'next' }, links: { next: `${origin}/courses/1/assignments/2`, cid: '1' }, why: '', until: 0 };
      return { ok: false };
    } },
    storage: { onChanged: { addListener: (f) => { chrome.changed = f; } } },
  };
  const el = () => {
    const e = { style: {}, children: [], isConnected: false, className: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); },
      remove() { this.removed = true; }, attachShadow(o) { assert.equal(o.mode, 'closed'); const root = { cleared: 0, replaceChildren() { this.cleared++; } }; e.root = root; return root; } };
    return e;
  };
  const document = { get hidden() { return state.hidden; }, createElement: el, documentElement: { lang: 'de' }, addEventListener: (t, f) => { document[`on${t}`] = f; } };
  const GZ_MODUI = { render: (root, tree, o) => { renders.push({ root, tree, o }); return { canvas: null }; } };
  const ctx = vm.createContext({
    chrome, document, location: { origin, assign: (u) => assigned.push(u) }, navigator: { language: 'en' }, Promise, JSON, Map, Set, Object, Array, Number, Math, URL, Uint8Array, Blob, atob,
    createImageBitmap: async () => { const bm = { width: 1, height: 1, closed: false, close() { this.closed = true; } }; bitmaps.push(bm); return bm; }, addEventListener: (t, f) => { ctx[`on${t}`] = f; },
    setTimeout: (f, ms) => { const t = { at: clock + ms, f }; timers.add(t); return t; }, clearTimeout: (t) => timers.delete(t), Date: class extends Date { static now() { return clock; } },
    GZ_MODUI,
    GZ_WIDGETS_UI: { declare: (tiles, from) => declared.push({ tiles, from }) },
    GZ_NAV_UI: { sync: () => syncs.push(1) },
    GZ_CTX: { site, t: (k) => k, need: async () => {} },
  });
  ctx.globalThis = ctx;
  vm.runInContext(read('features/modwidgets.js'), ctx);
  const G = ctx.GZ_MODWIDGETS;
  const tick = async (ms) => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers].filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.delete(due);
      clock = due.at;
      due.f();
      await settle();
    }
    clock = end;
    await settle();
  };
  const start = async () => { G.start(); await tick(100); };
  const tile = () => Object.values(G.tiles())[0];
  const fill = async (t = tile()) => { const body = el(); const got = t.fill(body); await settle(); return { body, got, host: body.children[0] }; };
  return { G, chrome, sent, declared, renders, assigned, syncs, bitmaps, state, tick, start, tile, fill, ctx, el, widgets: () => sent.filter((m) => m.op === 'widget') };
};

test('start asks the worker for the declarative widgets and declares their tiles to the boards under ids the layout keeps', async () => {
  const p = page();
  await p.start();
  eq(p.sent, [{ type: 'glaze:modpage', op: 'list' }]);
  assert.equal(p.declared.length, 1);
  assert.equal(p.declared[0].from, 'plain');
  const ids = Object.keys(p.declared[0].tiles);
  eq(ids, [`m${ID.slice(0, 14)}0`]);
  assert.match(ids[0], /^m[a-z2-7]{14}[0-7]$/, 'the shape the worker keeps stored places for (lib/widgets.js change)');
  const t = Object.values(p.declared[0].tiles)[0];
  eq([t.name, t.size, t.owner], ['Main', 'm', `${ID}|tile:main`]);
  // Asking again for the same list changes nothing.
  p.G.start();
  await p.tick(100);
  assert.equal(p.declared.length, 1);
});

test('a tile draws what the worker made of its blocks, in a closed root, asking for this slot in this page\'s language', async () => {
  const p = page();
  await p.start();
  const { got } = await p.fill();
  assert.equal(typeof got.stop, 'function');
  eq(p.widgets(), [{ type: 'glaze:modpage', op: 'widget', mod: ID, slot: 'tile:main', lang: 'de' }]);
  assert.equal(p.renders.length, 1);
  eq(p.renders[0].tree, TREE);
  assert.equal(p.renders[0].o.canvas, null, 'no canvas for a widget');
  // The renderer is handed what the worker's cleaner kept, untouched, never anything of the page's.
  assert.deepEqual(Object.keys(p.renders[0].o).sort(), ['asset', 'canvas', 'send']);
  got.stop();
  assert.equal(p.renders[0].root.cleared, 1, 'stopping empties the root');
});

test('nothing to show says so in words, and a mod that went draws nothing', async () => {
  for (const [answer, text] of [[{ ok: true, tree: null, why: 'denied' }, 'This widget’s data is turned off. Turn it on in the Mods tab of Glaze’s editor.'], [{ ok: true, tree: null, why: 'empty' }, 'Nothing to show yet.']]) {
    const p = page({ widget: () => answer });
    await p.start();
    await p.fill();
    eq(p.renders[0].tree, { type: 'text', text, size: 's', muted: true });
  }
  const gone = page({ widget: () => ({ ok: false, error: 'mod' }) });
  await gone.start();
  await gone.fill();
  assert.equal(gone.renders[0].tree, null);
  assert.equal(gone.sent.filter((m) => m.op === 'list').length, 1, 'a failed answer does not start a loop of asks');
});

test('a button goes to one of this site\'s own pages, never to an address the answer carries', async () => {
  const go = async ({ site = 'ultra', acts, links, click = 'b1', origin }) => {
    const p = page({ site, origin, widget: () => ({ ok: true, tree: TREE, acts, links, why: '', until: 0 }) });
    await p.start();
    await p.fill();
    p.renders[0].o.send('click', click);
    return p.assigned;
  };
  eq(await go({ acts: { b1: 'next' }, links: { next: 'https://school.test/ultra/courses/_1_1/outline', cid: '' } }), ['https://school.test/ultra/courses/_1_1/outline']);
  for (const next of ['https://evil.test/x', 'http://school.test/x', '//evil.test/x', 'javascript:alert(1)', 'data:text/html,x', 'https://school.test.evil.test/', '', undefined, 5]) {
    eq(await go({ acts: { b1: 'next' }, links: { next, cid: '' } }), [], String(next));
  }
  const places = { ultra: { dashboard: '/ultra/institution-page', courses: '/ultra/course', grades: '/ultra/grades', calendar: '/ultra/calendar' },
    canvas: { dashboard: '/', courses: '/courses', grades: '/grades', calendar: '/calendar' }, moodle: { dashboard: '/my/', courses: '/my/courses.php', grades: '/grade/report/overview/index.php', calendar: '/calendar/view.php?view=month' } };
  for (const [site, table] of Object.entries(places)) for (const [action, to] of Object.entries(table)) eq(await go({ site, acts: { b1: action }, links: {} }), [`https://school.test${to}`], `${site} ${action}`);
  // A course: the id must be the site's kind of id.
  eq(await go({ site: 'ultra', acts: { b1: 'course' }, links: { cid: '_12_1' } }), ['https://school.test/ultra/courses/_12_1/outline']);
  eq(await go({ site: 'canvas', acts: { b1: 'course' }, links: { cid: '42' } }), ['https://school.test/courses/42']);
  eq(await go({ site: 'moodle', acts: { b1: 'course' }, links: { cid: '42' } }), ['https://school.test/course/view.php?id=42']);
  for (const [site, cid] of [['canvas', '../../x'], ['canvas', '42/../../x'], ['ultra', '42'], ['moodle', '4;2'], ['canvas', ''], ['canvas', undefined], ['canvas', '42?x=1'], ['canvas', 7]]) eq(await go({ site, acts: { b1: 'course' }, links: { cid } }), [], `${site} ${cid}`);
  // Unknown actions and ids, including names every object has, do nothing.
  for (const action of ['open', 'https://evil.test', '__proto__', 'constructor', 'toString', '', null, 7]) eq(await go({ acts: { b1: action }, links: { next: 'https://school.test/x' } }), [], String(action));
  for (const click of ['toString', '__proto__', 'constructor', 'b2', '']) eq(await go({ acts: { b1: 'courses' }, links: {}, click }), [], click);
  eq(await go({ site: 'other', acts: { b1: 'courses' }, links: {} }), [], 'a site it does not know');
  eq(await go({ origin: 'https://school.test', acts: { b1: 'courses' }, links: {} }), ['https://school.test/ultra/course']);
});

test('a widget draws again when its data changes, once, and not while the page is hidden', async () => {
  const p = page();
  await p.start();
  await p.fill();
  assert.equal(p.widgets().length, 1);
  for (const key of ['todoCache', 'seenCourses', 'insights:https://school.test/5']) p.chrome.changed({ [key]: { newValue: {} } }, 'local');
  await p.tick(100);
  assert.equal(p.widgets().length, 1, 'waits a moment so one burst is one ask');
  await p.tick(300);
  assert.equal(p.widgets().length, 2);
  p.chrome.changed({ somethingElse: { newValue: 1 }, widgetLayout: { newValue: {} } }, 'local');
  p.chrome.changed({ todoCache: { newValue: {} } }, 'sync');
  await p.tick(500);
  assert.equal(p.widgets().length, 2, 'other keys and the other area change nothing');
  p.state.hidden = true;
  p.chrome.changed({ todoCache: { newValue: {} } }, 'local');
  await p.tick(500);
  assert.equal(p.widgets().length, 2, 'hidden: no ask');
  p.state.hidden = false;
  p.ctx.document.onvisibilitychange();
  await p.tick(10);
  assert.equal(p.widgets().length, 3, 'shown again: drawn');
});

test('a widget asks again at the time its answer changes by itself, and the latest answer wins', async () => {
  let n = 0, p;
  p = page({ widget: () => ({ ok: true, tree: { type: 'text', text: `answer ${++n}` }, acts: {}, links: {}, why: '', until: p.ctx.Date.now() + 60000 }) });
  await p.start();
  await p.fill();
  await p.tick(59000);
  assert.equal(p.widgets().length, 1);
  await p.tick(2000);
  assert.equal(p.widgets().length, 2);
  eq(p.renders.at(-1).tree, { type: 'text', text: 'answer 2' });
  // Answers that come back out of order: the older one is dropped.
  const slow = [];
  const q = page({ widget: () => new Promise((res) => slow.push(res)) });
  await q.start();
  await q.fill();
  q.chrome.changed({ todoCache: { newValue: {} } }, 'local');
  await q.tick(400);
  assert.equal(slow.length, 2);
  slow[1]({ ok: true, tree: { type: 'text', text: 'new' }, acts: {}, links: {}, why: '' });
  await settle();
  slow[0]({ ok: true, tree: { type: 'text', text: 'old' }, acts: {}, links: {}, why: '' });
  await settle();
  eq(q.renders.map((r) => r.tree.text), ['new']);
});

test('the mods changing puts the new list in place: a removed widget\'s tile and rail go, and a stopped one draws no more', async () => {
  const p = page();
  await p.start();
  const { got } = await p.fill();
  const rail = p.G.rail();
  eq(rail.map((r) => r.key), [`${ID}|rail:side`]);
  assert.equal(rail[0].el.attrs['aria-label'], 'Side');
  assert.equal(rail[0].el.className, 'gz-nav-widget gz-mod-rail');
  assert.equal(p.G.rail()[0].el, rail[0].el, 'the same element while it stays');
  assert.deepEqual([...p.G.stats().mounts].sort(), [`${ID}|rail:side`, `${ID}|tile:main`]);
  p.state.list = [];
  p.chrome.changed({ [`mod:${ID}`]: { newValue: null } }, 'local');
  await p.tick(100);
  eq(Object.keys(p.declared.at(-1).tiles), []);
  assert.ok(p.syncs.length >= 1, 'the nav is asked to drop the rail widget');
  assert.equal(p.G.rail().length, 0);
  assert.equal(rail[0].el.removed, true);
  eq(p.G.stats().mounts, [`${ID}|tile:main`], 'the board\'s own stop() ends the tile');
  got.stop();
  eq(p.G.stats().mounts, []);
  // A second mod in the student's order gets the next tiles after the first's.
  const q = page({ plainList: [PLAIN(OTHER, [{ key: 'tile:a', name: 'A', size: 's' }, { key: 'tile:b', name: 'B', size: 'l' }]), PLAIN()] });
  await q.start();
  eq(Object.keys(q.declared.at(-1).tiles), [`m${OTHER.slice(0, 14)}0`, `m${OTHER.slice(0, 14)}1`, `m${ID.slice(0, 14)}0`]);
});

test('a picture is asked of the worker once, as the mod\'s own file, and let go when the mod changes', async () => {
  const p = page();
  await p.start();
  await p.fill();
  const bm = await p.renders[0].o.asset('img/leaf.png');
  assert.equal(await p.renders[0].o.asset('img/leaf.png'), bm, 'the same bitmap the second time');
  eq(p.sent.filter((m) => m.op === 'asset'), [{ type: 'glaze:modpage', op: 'asset', mod: ID, path: 'img/leaf.png' }]);
  assert.equal(bm.closed, false);
  p.chrome.changed({ [`mod:${ID}`]: { newValue: {} } }, 'local');
  await p.tick(100);
  assert.equal(bm.closed, true, 'a changed mod\'s pictures are closed, and asked for again');
  const again = await p.renders.at(-1).o.asset('img/leaf.png');
  assert.notEqual(again, bm);
  assert.equal(p.sent.filter((m) => m.op === 'asset').length, 2);
});

test('the worker\'s list is read for what it is: a list, or nothing', async () => {
  for (const answer of [{ ok: true, mods: [] }, null, { plain: 'x' }, { plain: { 0: PLAIN() } }, { plain: 7 }, { ok: false, error: 'sender' }]) {
    const p = page({ rawList: () => answer });
    await p.start();
    eq(Object.keys(p.declared.at(-1)?.tiles || {}), [], JSON.stringify(answer));
  }
});

test('nothing runs once the extension has gone', async () => {
  const p = page();
  await p.start();
  await p.fill();
  delete p.chrome.runtime.id;
  p.chrome.changed({ todoCache: { newValue: {} } }, 'local');
  await p.tick(500);
  assert.equal(p.widgets().length, 1);
});

test('the page side carries nothing of the sandbox and no way to run a mod\'s code', () => {
  const src = read('features/modwidgets.js').replace(/\/\/.*$/gm, '');
  for (const word of ['host.html', 'boot.js', 'GZ_MODS', 'iframe', 'Worker', 'eval(', 'Function(', 'innerHTML', 'insertAdjacentHTML', 'srcdoc', 'document.write', 'import(', '.src =', 'setAttribute(\'href\'']) assert.ok(!src.includes(word), word);
});

// ---- content.js: when features/modwidgets.js is asked for ----------------------------------------------------------------------
test('content.js loads the declarative widgets on every browser, in the top frame, once the worker names one to show', async () => {
  const src = read('content.js');
  const gate = src.slice(src.indexOf('  const modsIn ='), src.indexOf('  ready.then(() => modsIn(true));'));
  const run = async ({ top = true, isPreview = false, on = true, sandbox = false, index = [ID], mods = [], plainList = [PLAIN()], answer, loaded = {} } = {}) => {
    const asked = [], started = [], messages = [];
    const ctx = vm.createContext({
      isPreview, settings: {}, on: () => on, no: () => {},
      local: (fn) => fn({ get: (k, cb) => { assert.equal(k, 'mods'); cb(index === null ? {} : { mods: index }); } }),
      chrome: { runtime: { getManifest: () => (sandbox ? { sandbox: { pages: ['mods/host.html'] } } : {}), sendMessage: async (m) => { messages.push(m); return answer || { ok: true, mods, plain: plainList }; } } },
      need: async (file) => { asked.push(file); if (file === 'features/mods.js') ctx.GZ_MODS = { start: () => started.push('mods') }; else ctx.GZ_MODWIDGETS = { start: () => started.push('widgets') }; },
    });
    ctx.window = {};
    ctx.window.top = top ? ctx.window : {};
    ctx.globalThis = ctx;
    if (loaded.mods) ctx.GZ_MODS = { start: () => started.push('mods again') };
    if (loaded.widgets) ctx.GZ_MODWIDGETS = { start: () => started.push('widgets again') };
    vm.runInContext(`const partsIn = () => {}; const solo = window.top === window;\n${gate}\nmodsIn();`, ctx);
    await settle();
    return { asked, started: plain(started), messages: plain(messages) };
  };
  eq(await run(), { asked: ['features/modwidgets.js'], started: ['widgets'], messages: [{ type: 'glaze:modpage', op: 'list' }] }, 'Firefox and Safari: no sandbox, still widgets');
  eq((await run({ sandbox: true })).asked, ['features/modwidgets.js'], 'Chrome with only widgets installed');
  eq((await run({ sandbox: true, mods: [{ id: ID }], plainList: [] })).asked, ['features/mods.js'], 'Chrome with only code mods');
  eq((await run({ sandbox: true, mods: [{ id: ID }] })).asked, ['features/mods.js', 'features/modwidgets.js'], 'both');
  eq((await run({ sandbox: false, mods: [{ id: ID }], plainList: [] })).asked, [], 'code mods wait for the sandbox, as before');
  for (const [why, opts] of [['a frame', { top: false }], ['the editor preview', { isPreview: true }], ['Glaze off or a quiz page', { on: false }], ['widgets loaded already', { loaded: { widgets: true } }]]) {
    eq((await run(opts)).asked, [], why);
  }
  eq((await run({ sandbox: true, mods: [{ id: ID }], loaded: { mods: true } })).asked, ['features/modwidgets.js'], 'one loaded, the other still asked for');
  eq(await run({ index: [] }), { asked: [], started: [], messages: [] }, 'nothing installed: not even a message');
  eq(await run({ index: null }), { asked: [], started: [], messages: [] }, 'never installed any');
  eq((await run({ plainList: [], mods: [] })).asked, [], 'installed, but none on or none declarative: the worker names none');
  eq((await run({ answer: { ok: true, mods: [] } })).asked, [], 'an older answer without a plain list');
});

test('dev mode changes refresh the declarative widget list', async () => {
  const p = page();
  await p.start();
  p.state.list = [];
  p.chrome.changed({ modDev: { newValue: false } }, 'local');
  await p.tick(100);
  eq(p.G.stats().list, []);
  p.state.list = [PLAIN()];
  p.chrome.changed({ modDev: { newValue: true } }, 'local');
  await p.tick(100);
  assert.equal(p.G.stats().list.length, 1);
  assert.match(read('content.js'), /\/\^mod\(s\$\|:\|Dev\$\|Order\$\|sBlocklist\$\)\/\.test\(k\)\)\) modsIn\(true\)/);
});
