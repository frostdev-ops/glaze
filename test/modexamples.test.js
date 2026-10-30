// The example mods (examples/mods): each mod folder loads the way dev mode loads one and packs into a signed bundle that
// validates (manifest, permissions, sizes), and the ones with code run against the real client (mods/host.js) and the
// real broker (lib/modbroker.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/modbundle.js');
const B = require('../lib/modbroker.js');

const root = path.join(__dirname, '..', 'examples', 'mods');
const enc = new TextEncoder();
const folders = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
// A folder as dev mode reads it: every file by its path, as bytes.
const files = (name) => Object.fromEntries(fs.readdirSync(path.join(root, name), { recursive: true })
  .filter((p) => fs.statSync(path.join(root, name, p)).isFile()).map((p) => [p.split(path.sep).join('/'), new Uint8Array(fs.readFileSync(path.join(root, name, p)))]));

// What each example is for, so a change to one can't quietly drop its point.
const WANT = {
  'card-decorator': { permissions: ['courses'], hooks: 'hooks.js', slots: [] },
  'countdown-tile': { permissions: ['todo'], hooks: 'hooks.js', slots: ['tiles:next-due'] },
  'rail-widget': { permissions: [], hooks: undefined, slots: ['rail:breathe'] },
  'workload-tool': { permissions: ['agents', 'todo'], hooks: 'hooks.js', slots: [], tools: ['workload'] },
};

test('the mod examples are all here', () => {
  assert.deepEqual(folders, Object.keys(WANT));
});

test('shader-background is a Look-parts example that round-trips as a wearable theme code', async () => {
  const X = require('../lib/lookparts.js'), S = require('../lib/share.js'), G = require('../defaults.js');
  const src = fs.readFileSync(path.join(__dirname, '../examples/looks/shader-background/shader.glsl'), 'utf8');
  assert.equal(require('../lib/glsl.js').check(src).ok, true);
  const parts = { bg: { shader: { src } } };
  assert.deepEqual(X.clean(parts), parts);
  const code = await S.encode(G.GZ_SANITIZE({ bg: { kind: 'shader' } }), {}, { x: parts });
  const back = await S.decode(code);
  assert.equal(back.bg.kind, 'shader');
  assert.deepEqual(back.parts.x, X.compact(parts));
});

for (const name of folders) {
  test(`${name}: loads from its folder, packs signed, and reads back valid`, async () => {
    const all = files(name);
    const manifest = JSON.parse(Buffer.from(all['mod.json']).toString('utf8'));
    // Left for the editor to fill in with the student's own author key, as dev mode does.
    assert.equal(manifest.author.key, undefined);
    assert.equal(all['mod.sig'], undefined);
    const key = await M.makeKey();

    // Dev mode: the folder as it is, unsigned, with the author key filled in.
    const dev = await M.bundle(Object.entries({ ...all, 'mod.json': enc.encode(JSON.stringify({ ...manifest, author: { ...manifest.author, key: key.x } })) }));
    assert.equal(dev.signed, false);
    assert.equal(M.plan(null, dev, { dev: true }).action, 'install');
    assert.equal(M.plan(null, dev, { dev: false }).reason, 'dev-off');

    // Export signed: what the editor's pack makes must read back, be signed by that key and install without dev mode.
    const rest = { ...all };
    delete rest['mod.json'];
    const packed = await M.pack(rest, manifest, key);
    const back = await M.read(packed.bytes);
    assert.equal(back.signed, true);
    assert.equal(back.key, key.x);
    assert.equal(back.id, packed.id);
    assert.deepEqual(M.plan(null, back, {}), { action: 'install', reason: 'new', newPermissions: M.caps(back.manifest), prompt: true });

    const want = WANT[name];
    assert.deepEqual((back.manifest.permissions || []).map((p) => p.id), want.permissions);
    for (const p of back.manifest.permissions || []) assert.ok(p.why.length > 20, `${p.id} says why`);
    assert.equal(back.manifest.hooks, want.hooks);
    assert.deepEqual(['tiles', 'rail'].flatMap((k) => (back.manifest.ui?.[k] || []).map((s) => `${k}:${s.id}`)), want.slots);
    assert.deepEqual((back.manifest.tools || []).map((t) => t.name), want.tools || []);

    // Sizes: far inside the caps, and small enough to travel as a pasteable code.
    const total = Object.values(back.files).reduce((n, b) => n + b.length, 0);
    assert.ok(total < M.CAP.total / 8, `${total} bytes of files`);
    assert.ok(Object.entries(back.files).filter(([p]) => p.endsWith('.js')).reduce((n, [, b]) => n + b.length, 0) < M.CAP.code / 8);
    assert.ok((await M.encode(packed.bytes)).length <= M.CAP.text);
    // Nothing a data mod may not have: no HTML beside a data permission (the manifest check refuses it too).
    if (back.manifest.permissions?.length) assert.ok(!Object.keys(back.files).some((p) => p.endsWith('.html')));
  });
}

test('rail-widget: its page names only files it has', () => {
  const all = files('rail-widget');
  const html = Buffer.from(all['rail.html']).toString('utf8');
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(refs.sort(), ['rail.css', 'rail.js']);
  for (const r of refs) assert.ok(all[r], r);
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'no inline script: the frame runs only files');
});

test('rail-widget: the first breath on a new day starts a new daily count', async () => {
  let day = 'Sat Oct 17 2026', clicked;
  const writes = [], count = { textContent: '' };
  const glaze = { on() {}, theme: async () => ({ tokens: {}, motion: 'off' }), storage: {
    get: async () => ({ day, n: 4 }), set: async (key, value) => { writes.push({ key, value }); },
  } };
  const document = {
    documentElement: { style: { setProperty() {} }, dataset: {}, toggleAttribute() {} },
    getElementById: (id) => id === 'count' ? count : { addEventListener: (event, fn) => { clicked = fn; } },
  };
  const ctx = vm.createContext({ glaze, document, Date: class { toDateString() { return day; } } });
  vm.runInContext(Buffer.from(files('rail-widget')['rail.js']).toString('utf8'), ctx);
  await flush();
  assert.equal(count.textContent, '4 today');
  clicked();
  assert.equal(count.textContent, '5 today');
  day = 'Sun Oct 18 2026';
  clicked();
  assert.equal(count.textContent, '1 today');
  assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1))), { key: 'breaths', value: { day, n: 1 } });
});

// ---- the code, run against the real client and broker ------------------------------------------------------------------------
const SITE = 'https://school.instructure.com';
const ID = 'abcdefghijklmnop';
const flush = () => new Promise(setImmediate);
const area = (data) => ({
  data,
  async get(k) { await flush(); const keys = k === null ? Object.keys(data) : [].concat(k); return structuredClone(Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, data[x]]))); },
  async set(p) { await flush(); Object.assign(data, structuredClone(p)); return true; },
  async remove(k) { await flush(); for (const x of [].concat(k)) delete data[x]; return true; },
});
// Runs a code example's hooks.js in a Worker-like VM with the host's real `glaze` client; its calls go to the real broker.
const run = async (name, { local = {}, grants = {}, events = [] } = {}) => {
  const all = files(name);
  const manifest = JSON.parse(Buffer.from(all['mod.json']).toString('utf8'));
  const l = area({
    [`mod:${ID}`]: { id: ID, enabled: true, hash: 'h', key: 'k', version: '1.0.0', manifest, grants, files: {} },
    mods: [ID], ...local,
  });
  let turn = Promise.resolve();
  // An agent app's call to a code tool waits for its answer, as lib/mcp/modroute.js settle takes it.
  const answers = [];
  const env = { site: SITE, local: l, sync: area({}), fetch: async () => { throw new Error('no network'); }, queue: (f) => (turn = turn.then(f, f)), keys: async () => Object.keys(l.data),
    record: async (id) => (await l.get(`mod:${id}`))[`mod:${id}`], blocklist: async () => null, account: async () => '5', tool: (call, out) => { answers.push([call, out]); return true; } };
  const heard = [], listeners = [];
  const port = {
    addEventListener: (t, f) => listeners.push(f), start() {},
    // The client's calls: answered by the broker, and kept for the test to look at. A real port copies what it carries, which
    // also leaves the VM's own Object.prototype behind (the broker's cleaners check for the main realm's).
    postMessage: (sent) => {
      const m = JSON.parse(JSON.stringify(sent));
      if (typeof m.call !== 'string') return;
      B.handle({ mod: ID, call: m.call, args: m.args, via: 'worker' }, env).then((r) => {
        heard.push({ call: m.call, args: m.args, reply: r });
        for (const f of listeners) f({ data: r.ok ? { id: m.id, ok: true, value: r.value } : { id: m.id, ok: false, error: r.error } });
      });
    },
  };
  const send = (data) => { for (const f of listeners) f({ data }); };
  const ctx = vm.createContext({ setTimeout, performance, console });
  const source = fs.readFileSync(path.join(__dirname, '..', 'mods', 'host.js'), 'utf8').match(/function glazeClient\(port\) \{[\s\S]*?\n    return glaze;\n  \}/)[0];
  vm.runInContext(`(${source})`, ctx)(port);
  // As the host starts a Worker: its code, and the code tools mod.json declares for it to handle.
  const tools = (manifest.tools || []).filter((t) => t.code === true).map((t) => t.name);
  send({ run: [Buffer.from(all[manifest.hooks]).toString('utf8')], ...(tools.length && { tools }) });
  for (const [event, data] of events) send({ event, data });
  for (let i = 0; i < 40; i++) await flush();
  return { heard, answers, send, flush: async () => { for (let i = 0; i < 40; i++) await flush(); } };
};
const plain = (x) => JSON.parse(JSON.stringify(x));

test('countdown-tile: counts down to the next open assignment, and says so when there is none', async () => {
  const soon = Date.now() + 3 * 3600e3;
  const todo = (items) => ({ todoCache: { key: `todo:${SITE}/5`, at: 1, items } });
  const item = (id, title, at, extra = {}) => ({ type: 'assignment', id, cid: '42', course: 'Chem', title, at, url: `/courses/42/assignments/${id}`, ...extra });
  const { heard } = await run('countdown-tile', { grants: { todo: true }, local: todo([
    item('1', 'Past', Date.now() - 1000), item('2', 'Later', soon + 86400e3), item('3', 'Lab report', soon), item('4', 'Done', soon - 1000, { sub: { submitted: true } }),
  ]) });
  const render = heard.find((h) => h.call === 'ui.render');
  assert.equal(render.reply.ok, true, JSON.stringify(render.reply));
  assert.deepEqual(plain(render.reply.value.tree), { type: 'stack', children: [
    { type: 'text', text: 'Lab report', weight: 'bold' }, { type: 'text', text: 'Chem', size: 's', muted: true },
    { type: 'countdown', to: Math.round(soon), label: 'until it is due', done: 'Due now' }] });
  assert.equal(render.args[0], 'tile:next-due');

  const none = await run('countdown-tile', { grants: { todo: true }, local: todo([item('1', 'Past', Date.now() - 1000)]) });
  assert.deepEqual(plain(none.heard.find((h) => h.call === 'ui.render').reply.value.tree), { type: 'text', text: 'Nothing due soon.', muted: true });
});

test('countdown-tile: draws again when the plan or its settings change, and hides the course name when the student says so', async () => {
  const at = Date.now() + 3600e3;
  const r = await run('countdown-tile', { grants: { todo: true }, local: { todoCache: { key: `todo:${SITE}/5`, at: 1, items: [{ type: 'assignment', id: '1', cid: '4', course: 'Chem', title: 'Lab', at }] } } });
  const draws = () => r.heard.filter((h) => h.call === 'ui.render').length;
  assert.equal(draws(), 1);
  for (const [i, event] of ['todo', 'settings'].entries()) {
    r.send({ event, data: {} });
    await r.flush();
    assert.equal(draws(), 2 + i, event);
  }
  const off = await run('countdown-tile', { grants: { todo: true }, local: { [`modSettings:${ID}`]: { course: false }, todoCache: { key: `todo:${SITE}/5`, at: 1, items: [{ type: 'assignment', id: '1', cid: '4', course: 'Chem', title: 'Lab', at }] } } });
  const tree = off.heard.find((h) => h.call === 'ui.render').reply.value.tree;
  assert.deepEqual(plain(tree).children.map((c) => c.type), ['text', 'countdown']);
});

test('card-decorator: a badge and an accent for each course on the page, all accepted by the broker', async () => {
  const courses = [{ id: '_1_1', name: 'Intro to Biology' }, { id: '_2_1', name: 'Art' }, { id: '7', name: '   ' }];
  const { heard } = await run('card-decorator', { grants: { courses: true }, events: [['cards', { courses }]] });
  const set = heard.find((h) => h.call === 'cards.set');
  assert.equal(set.reply.ok, true, JSON.stringify(set.reply));
  assert.deepEqual(Object.keys(set.reply.value), ['7', '_1_1', '_2_1']);
  assert.equal(set.reply.value._1_1.badge, 'ITB');
  assert.equal(set.reply.value._2_1.badge, 'A');
  assert.equal(set.reply.value['7'].badge, '?');
  for (const d of Object.values(set.reply.value)) assert.ok(['accent', 'accent-hi', 'ok', 'warn'].includes(d.accent));
});

test('workload-tool: counts the open to-dos due each day ahead, by the student\'s own day, busiest first, for the days the app asks', async () => {
  const day = (n, h) => { const d = new Date(); d.setHours(h, 0, 0, 0); d.setDate(d.getDate() + n); return d.getTime(); };
  const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const item = (id, at, extra = {}) => ({ type: 'assignment', id, cid: '42', course: 'Chem', title: `Item ${id}`, at, url: `/courses/42/assignments/${id}`, ...extra });
  const items = [item('1', day(2, 9)), item('2', day(2, 17)), item('3', day(5, 12)), item('4', day(1, 10), { sub: { submitted: true } }), item('5', day(1, 11), { ov: { done: true } }),
    item('6', day(-1, 12)), item('7', null), item('8', day(9, 12)), item('9', day(1, 23))];
  const r = await run('workload-tool', { grants: { agents: true, todo: true }, local: { todoCache: { key: `todo:${SITE}/5`, at: 1, items } } });
  const ask = async (args) => {
    const id = `call-${r.answers.length}`;
    r.send({ event: 'tool.call', data: { id, name: 'workload', args } });
    await r.flush();
    const [call, out] = r.answers.at(-1);
    assert.equal(call, id);
    return plain(out);
  };
  assert.deepEqual(await ask({}), { value: { days: [{ day: ymd(day(2, 9)), due: 2 }, { day: ymd(day(1, 23)), due: 1 }, { day: ymd(day(5, 12)), due: 1 }] } });
  assert.deepEqual(await ask({ days: 3 }), { value: { days: [{ day: ymd(day(2, 9)), due: 2 }, { day: ymd(day(1, 23)), due: 1 }] } });
  assert.deepEqual(await ask({ days: 14 }), { value: { days: [{ day: ymd(day(2, 9)), due: 2 }, { day: ymd(day(1, 23)), due: 1 }, { day: ymd(day(5, 12)), due: 1 }, { day: ymd(day(9, 12)), due: 1 }] } });
  // Each answer went through the broker as a call of its own, which the broker took.
  const results = r.heard.filter((h) => h.call === 'tools.result');
  assert.equal(results.length, 3);
  for (const h of results) assert.deepEqual(h.reply, { ok: true, value: true });
});
