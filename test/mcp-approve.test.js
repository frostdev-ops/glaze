// The approval window for agent apps (lib/mcp/approve.js): one popup serves every ask, oldest first; only that window's tab
// decides, and each ask once; the 600 s timeout, a cancel and a closed window end an ask; at most 5 wait per app; progress
// every 15 s; a worker restart sweeps what was waiting or running. The page (lib/mcp/approve.html, approve-page.js) is
// checked here for what it may read and write; scripts/mcp-approve-check.js drives it in Chromium.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('../lib/mcp/approve.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const URL_ = 'chrome-extension://glaze/lib/mcp/approve.html';
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const CLAUDE = { id: 'q2yhd4emtekyo2kc', name: 'Claude', exe: '/Applications/Claude.app/Contents/MacOS/Claude' };
const CODE = { id: 'ioiih44jk25fd3hj', name: 'Visual Studio Code', exe: '/usr/local/bin/code' };
const PAIR = { app: CLAUDE, tool: { name: 'todo_list', title: 'To-dos' }, group: 'courses' };
const GRANT = { app: CLAUDE, tool: { name: 'grades_list', title: 'Grades' }, group: 'grades' };
const ACTION = { app: CLAUDE, tool: { name: 'todo_mark_done', title: 'Mark a to-do done' }, summary: 'Mark “Essay 2” done.' };

// A worker's world: storage.session, windows and tabs that record what they were asked, and a clock whose timers run only
// when the test moves it.
const env = (over = {}) => {
  let t = 1_000_000, seq = 0, wid = 10;
  const due = new Map();
  const timers = {
    setTimeout: (f, ms) => { const id = ++seq; due.set(id, { at: t + ms, f }); return id; },
    clearTimeout: (id) => { due.delete(id); },
  };
  const tick = async (ms) => {
    const end = t + ms;
    for (;;) {
      const next = [...due].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      due.delete(next[0]);
      t = next[1].at;
      next[1].f();
      await settle();
    }
    t = end;
    await settle();
  };
  const data = {};
  const session = {
    get: async (k) => (k == null ? structuredClone(data) : Object.fromEntries([k].flat().filter((x) => x in data).map((x) => [x, structuredClone(data[x])]))),
    set: async (o) => { Object.assign(data, structuredClone(o)); },
    remove: async (k) => { for (const x of [k].flat()) delete data[x]; },
  };
  const made = [], removed = [];
  const windows = {
    create: async (o) => { const id = ++wid; made.push({ ...o, id }); return { id, tabs: [{ id: id * 100, windowId: id }] }; },
    remove: async (id) => { removed.push(id); },
  };
  const tabs = { query: async ({ windowId }) => [{ id: windowId * 100, windowId }] };
  const runtime = { id: 'glaze' };
  const deps = { windows, tabs, storage: { session }, runtime, now: () => t, timers, url: URL_, ...over };
  const a = A.create(deps);
  // A message from the page in window w: its tab, its top frame, its address.
  const from = (w, extra = {}) => ({ id: 'glaze', tab: { id: w.id * 100, windowId: w.id }, frameId: 0, url: URL_, ...extra });
  return { a, deps, data, session, made, removed, tick, due, now: () => t, from };
};
const records = (data) => Object.entries(data).filter(([k]) => k.startsWith('mcpAsk:')).map(([, v]) => v).sort((x, y) => x.at - y.at);
const outcome = (p) => { const box = { v: undefined }; p.then((v) => { box.v = v; }); return box; };

test('an ask is a storage.session record and one focused popup at the approval page', async () => {
  const e = env();
  const r = outcome(e.a.ask('pair', PAIR));
  await settle();
  const [rec] = records(e.data);
  assert.match(rec.id, /^[0-9a-f]{24}$/);
  assert.deepEqual(rec, { id: rec.id, kind: 'pair', app: { name: 'Claude', exe: CLAUDE.exe }, tool: { name: 'todo_list', title: 'To-dos' }, group: 'courses', at: 1_000_000, until: 1_000_000 + 600e3, state: 'waiting' });
  assert.equal(e.made.length, 1);
  assert.deepEqual(e.made[0], { type: 'popup', url: URL_, width: A.SIZE.width, height: A.SIZE.height, focused: true, id: e.made[0].id });
  assert.deepEqual(e.data.mcpAskWindow, { id: e.made[0].id, tab: e.made[0].id * 100 });
  assert.equal(r.v, undefined, 'it waits for the student');
});

test('a browser that opens the popup at its own size (Safari, live 2026-10-30: the main window\'s) is brought back to the approval size', async () => {
  const e = env();
  const updated = [];
  e.deps.windows.create = async (o) => { e.made.push({ ...o, id: 9 }); return { id: 9, width: 1800, height: 1130, tabs: [{ id: 900, windowId: 9 }] }; };
  e.deps.windows.update = async (id, o) => { updated.push([id, o]); };
  e.a.ask('pair', PAIR);
  await settle();
  assert.deepEqual(updated, [[9, { width: A.SIZE.width, height: A.SIZE.height }]]);
  // One already at its size is left alone, and a browser without update still opens it.
  const f = env();
  f.deps.windows.update = async () => assert.fail('no resize needed');
  f.a.ask('pair', PAIR);
  await settle();
  const g = env();
  g.deps.windows.create = async (o) => { g.made.push({ ...o, id: 7 }); return { id: 7, width: 1800, height: 1130, tabs: [{ id: 700, windowId: 7 }] }; };
  g.a.ask('pair', PAIR);
  await settle();
  assert.deepEqual(g.data.mcpAskWindow, { id: 7, tab: 700 });
});

test('the record keeps what Glaze shows and nothing else: no arguments, no extra view fields, no staged text', async () => {
  const e = env();
  e.a.ask('grant', { ...GRANT, app: { ...CLAUDE, name: '‮Claude\n\nAllow​ everything', verified: true, ppid: 4 }, args: { secret: 1 }, extra: 'x' });
  e.a.ask('action', { ...ACTION, app: { name: 'n'.repeat(500), exe: 'e'.repeat(5000) }, tool: { name: 'todo_mark_done' }, summary: `s${'\u0007'.repeat(3)}${'y'.repeat(100)}`, args: { id: 7 } });
  await settle();
  const [grant, action] = records(e.data);
  assert.deepEqual(Object.keys(grant).sort(), ['app', 'at', 'group', 'id', 'kind', 'state', 'tool', 'until']);
  assert.deepEqual(grant.app, { name: 'Claude Allow everything', exe: CLAUDE.exe }, 'control and format characters out, spaces squeezed');
  assert.deepEqual(Object.keys(action).sort(), ['app', 'at', 'id', 'kind', 'state', 'summary', 'tool', 'until']);
  assert.equal(action.app.name.length, A.LIMIT.name);
  assert.equal(action.app.exe.length, A.LIMIT.exe);
  assert.deepEqual(action.tool, { name: 'todo_mark_done', title: '' });
  assert.equal(action.summary.length, 102);
  assert.ok(action.summary.startsWith('s y'));
});

test('a kind or view Glaze never sends is a programming error', async () => {
  const e = env();
  await assert.rejects(e.a.ask('run', PAIR), TypeError);
  await assert.rejects(e.a.ask('pair', { ...PAIR, group: undefined }), TypeError);
  await assert.rejects(e.a.ask('grant', { ...GRANT, group: '' }), TypeError);
  assert.deepEqual(records(e.data), []);
  assert.equal(e.made.length, 0);
});

// The groups are lib/ai/tools.js's: each one a tool may name is one the window asks about and names, and one Settings
// switches and names, so a new group can't be refused at its first call or left without a word.
test('every group a tool may name is asked about and named in the window, and switched and named in Settings', async () => {
  const TL = require('../lib/ai/tools.js'), E = require('../lib/editor-agents.js');
  const page = read('lib/mcp/approve-page.js');
  for (const group of TL.GROUPS) {
    const e = env();
    const got = outcome(e.a.ask('grant', { ...GRANT, group }));
    await settle();
    assert.equal(got.v, undefined, group);
    assert.equal(records(e.data)[0]?.group, group);
    assert.ok(new RegExp(`\\b${group}: t\\('[^']+'`).test(page.slice(page.indexOf('const label'), page.indexOf('const ENDED'))), `the window names ${group}`);
    assert.ok(E.GROUPS.includes(group), `Settings switches ${group}`);
    assert.notEqual(E.groupName(group, (x) => x), group, `Settings names ${group}`);
  }
  assert.deepEqual([...E.GROUPS].sort(), [...TL.GROUPS].sort());
});

for (const [name, kind, view] of [['unknown group', 'pair', { ...PAIR, group: 'Allow everything' }],
  ...[undefined, ' ', 'x'.repeat(2001)].map((summary, i) => [`invalid summary ${i}`, 'action', { ...ACTION, summary }])]) {
  test(`${name} is refused before opening`, async () => {
    const e = env();
    const got = outcome(e.a.ask(kind, view).catch((error) => error));
    await settle();
    assert.ok(got.v instanceof TypeError, 'invalid view must reject instead of waiting for approval');
    assert.equal(e.made.length, 0);
    assert.deepEqual(records(e.data), []);
  });
}

test('long trusted summaries keep their final words instead of cutting the consent scope', async () => {
  const e = env();
  const summary = `${'A'.repeat(680)} Only in the selected course.`;
  const r = outcome(e.a.ask('action', { ...ACTION, summary }).catch((error) => error));
  await settle();
  assert.equal(records(e.data)[0]?.summary, summary);
  assert.equal(r.v, undefined, 'the complete summary waits for consent');
});

test('Allow and Don\'t allow from the window decide once, and the window closes when nothing waits', async () => {
  const e = env();
  const r = outcome(e.a.ask('pair', PAIR));
  await settle();
  const [rec] = records(e.data), w = e.made[0];
  assert.deepEqual(e.a.decide({ type: 'glaze:mcp-ask', id: rec.id, answer: 'yes' }, e.from(w)), { ok: true });
  assert.deepEqual(e.a.decide({ type: 'glaze:mcp-ask', id: rec.id, answer: 'no' }, e.from(w)), { ok: false }, 'single use');
  await settle();
  assert.equal(r.v, 'yes');
  assert.equal(records(e.data)[0].state, 'yes');
  assert.deepEqual(e.removed, [w.id]);
  assert.equal(e.data.mcpAskWindow, undefined);
  // The window's own close event after Glaze removed it declines nothing.
  e.a.closed(w.id);
  const no = outcome(e.a.ask('grant', GRANT));
  await settle();
  assert.equal(e.made.length, 2, 'a new ask opens a new window');
  const g = records(e.data).find((x) => x.kind === 'grant');
  assert.deepEqual(e.a.decide({ type: 'glaze:mcp-ask', id: g.id, answer: 'no' }, e.from(e.made[1])), { ok: true });
  await settle();
  assert.equal(no.v, 'no');
  assert.equal(records(e.data).find((x) => x.id === g.id).state, 'no');
});

test('decisions come only from the window\'s own tab, top frame and page, from Glaze itself', async () => {
  const e = env();
  const r = outcome(e.a.ask('pair', PAIR));
  await settle();
  const [rec] = records(e.data), w = e.made[0];
  const msg = { type: 'glaze:mcp-ask', id: rec.id, answer: 'yes' };
  const refused = [
    {}, null, undefined,
    { id: 'glaze', url: URL_, frameId: 0 },
    e.from(w, { tab: { id: 999, windowId: w.id } }),
    e.from(w, { tab: { id: w.id * 100, windowId: w.id + 1 } }),
    e.from(w, { frameId: 3 }),
    e.from(w, { url: 'chrome-extension://glaze/options.html' }),
    e.from(w, { url: 'https://school.instructure.com/lib/mcp/approve.html' }),
    e.from(w, { id: 'another-extension' }),
  ];
  for (const s of refused) assert.deepEqual(e.a.decide(msg, s), { ok: false }, JSON.stringify(s));
  for (const m of [{ ...msg, answer: 'maybe' }, { ...msg, answer: true }, { ...msg, id: 'nope' }, { ...msg, id: undefined }, null, 'yes']) {
    assert.deepEqual(e.a.decide(m, e.from(w)), { ok: false }, JSON.stringify(m));
  }
  await settle();
  assert.equal(r.v, undefined);
  assert.equal(records(e.data)[0].state, 'waiting');
  // The page's own address with a fragment is still the page.
  assert.deepEqual(e.a.decide(msg, e.from(w, { url: `${URL_}#x` })), { ok: true });
  await settle();
  assert.equal(r.v, 'yes');
});

test('one window serves every ask, oldest first, and a decision for one leaves the others waiting', async () => {
  const e = env();
  const first = outcome(e.a.ask('pair', PAIR));
  const second = outcome(e.a.ask('action', ACTION));
  const third = outcome(e.a.ask('grant', { ...GRANT, app: CODE }));
  await settle();
  assert.equal(e.made.length, 1, 'asks made while the window opens share it');
  const recs = records(e.data);
  assert.deepEqual(recs.map((x) => x.kind), ['pair', 'action', 'grant']);
  assert.ok(recs[0].at < recs[1].at && recs[1].at < recs[2].at, 'each ask has its own place in the queue');
  const w = e.made[0];
  e.a.decide({ type: 'glaze:mcp-ask', id: recs[1].id, answer: 'no' }, e.from(w));
  await settle();
  assert.deepEqual([first.v, second.v, third.v], [undefined, 'no', undefined]);
  assert.deepEqual(e.removed, []);
  // Asked later, with the window up: no second window.
  const fourth = outcome(e.a.ask('grant', GRANT));
  await settle();
  assert.equal(e.made.length, 1);
  e.a.decide({ type: 'glaze:mcp-ask', id: recs[0].id, answer: 'yes' }, e.from(w));
  e.a.decide({ type: 'glaze:mcp-ask', id: recs[2].id, answer: 'yes' }, e.from(w));
  await settle();
  assert.deepEqual(e.removed, []);
  e.a.decide({ type: 'glaze:mcp-ask', id: records(e.data)[3].id, answer: 'no' }, e.from(w));
  await settle();
  assert.deepEqual([first.v, third.v, fourth.v], ['yes', 'yes', 'no']);
  assert.deepEqual(e.removed, [w.id]);
});

test('closing the window is Don\'t allow for every ask it shows; another window\'s close changes nothing', async () => {
  const e = env();
  const a = outcome(e.a.ask('pair', PAIR)), b = outcome(e.a.ask('grant', { ...GRANT, app: CODE }));
  await settle();
  const w = e.made[0];
  e.a.closed(w.id + 1);
  await settle();
  assert.deepEqual([a.v, b.v], [undefined, undefined]);
  e.a.closed(w.id);
  await settle();
  assert.deepEqual([a.v, b.v], ['no', 'no']);
  assert.deepEqual(records(e.data).map((x) => x.state), ['no', 'no']);
  assert.deepEqual(e.removed, [], 'the student closed it');
  // That window's tab can't decide what a new window shows.
  outcome(e.a.ask('pair', PAIR));
  await settle();
  const fresh = records(e.data).find((x) => x.state === 'waiting');
  assert.deepEqual(e.a.decide({ type: 'glaze:mcp-ask', id: fresh.id, answer: 'yes' }, e.from(w)), { ok: false });
  assert.deepEqual(e.a.decide({ type: 'glaze:mcp-ask', id: fresh.id, answer: 'yes' }, e.from(e.made[1])), { ok: true });
});

test('an ask times out after 600 s', async () => {
  const e = env();
  const r = outcome(e.a.ask('action', ACTION));
  await settle();
  await e.tick(600e3 - 1);
  assert.equal(r.v, undefined);
  await e.tick(1);
  assert.equal(r.v, 'timeout');
  assert.equal(records(e.data)[0].state, 'timeout');
  assert.deepEqual(e.removed, [e.made[0].id]);
  assert.deepEqual(e.a.decide({ type: 'glaze:mcp-ask', id: records(e.data)[0].id, answer: 'yes' }, e.from(e.made[0])), { ok: false });
});

test('a cancel ends the ask and updates its record; an ask cancelled before it starts opens nothing', async () => {
  const e = env();
  const ac = new AbortController();
  const r = outcome(e.a.ask('action', ACTION, { signal: ac.signal }));
  const other = outcome(e.a.ask('pair', PAIR));
  await settle();
  ac.abort();
  await settle();
  assert.equal(r.v, 'cancelled');
  assert.deepEqual(records(e.data).map((x) => x.state), ['cancelled', 'waiting']);
  assert.deepEqual(e.removed, [], 'the pairing still waits in the window');
  assert.equal(other.v, undefined);
  e.a.closed(e.made[0].id);
  await settle();
  const gone = new AbortController();
  gone.abort();
  assert.equal(await e.a.ask('pair', PAIR, { signal: gone.signal }), 'cancelled');
  assert.equal(records(e.data).length, 2);
  assert.equal(e.made.length, 1);
});

test('a window cancelled while it opens is removed once it is up', async () => {
  const e = env();
  let open;
  e.deps.windows.create = (o) => new Promise((res) => { open = () => { e.made.push({ ...o, id: 50 }); res({ id: 50, tabs: [{ id: 5000 }] }); }; });
  const ac = new AbortController();
  const r = outcome(e.a.ask('pair', PAIR, { signal: ac.signal }));
  await settle();
  ac.abort();
  await settle();
  assert.equal(r.v, 'cancelled');
  open();
  await settle();
  assert.deepEqual(e.removed, [50]);
});

test('a window that can\'t open interrupts what waits on it, and the next ask tries again', async () => {
  const e = env();
  const create = e.deps.windows.create;
  e.deps.windows.create = async () => { throw new Error('No windows'); };
  const a = outcome(e.a.ask('pair', PAIR)), b = outcome(e.a.ask('action', ACTION));
  await settle();
  assert.deepEqual([a.v, b.v], ['interrupted', 'interrupted']);
  assert.deepEqual(records(e.data).map((x) => x.state), ['interrupted', 'interrupted']);
  e.deps.windows.create = create;
  const c = outcome(e.a.ask('pair', PAIR));
  await settle();
  assert.equal(e.made.length, 1);
  assert.equal(c.v, undefined);
});

test('closing during window creation declines the queue before the popup can be registered', async () => {
  const e = env();
  let open;
  e.deps.windows.create = () => new Promise((resolve) => { open = () => resolve({ id: 50, tabs: [{ id: 5000 }] }); });
  const r = outcome(e.a.ask('pair', PAIR));
  await settle();
  e.a.closed(50);
  open();
  await settle();
  assert.equal(r.v, 'no');
  assert.equal(records(e.data)[0].state, 'no');
  assert.equal(e.data.mcpAskWindow, undefined);
});

test('closing before tab discovery fails still declines instead of reporting interruption', async () => {
  const e = env();
  let fail;
  e.deps.windows.create = async () => ({ id: 50 });
  e.deps.tabs.query = () => new Promise((resolve, reject) => { fail = () => reject(new Error('Window closed')); });
  const r = outcome(e.a.ask('pair', PAIR));
  await settle();
  e.a.closed(50);
  fail();
  await settle();
  assert.equal(r.v, 'no');
  assert.equal(e.data.mcpAskWindow, undefined);
  assert.deepEqual(e.removed, [], 'the closed popup needs no removal');
});

test('failed tab discovery removes the popup it created', async () => {
  const e = env();
  e.deps.windows.create = async () => ({ id: 77 });
  e.deps.tabs.query = async () => { throw new Error('Tab lookup failed'); };
  const r = outcome(e.a.ask('pair', PAIR));
  await settle();
  assert.equal(r.v, 'interrupted');
  assert.deepEqual(e.removed, [77]);
});

test('a window without its tab in hand finds it through tabs.query', async () => {
  const e = env();
  e.deps.windows.create = async (o) => { e.made.push({ ...o, id: 77 }); return { id: 77 }; };
  e.a.ask('pair', PAIR);
  await settle();
  assert.deepEqual(e.data.mcpAskWindow, { id: 77, tab: 7700 });
  assert.deepEqual(e.a.decide({ type: 'glaze:mcp-ask', id: records(e.data)[0].id, answer: 'no' }, e.from({ id: 77 })), { ok: true });
});

test('at most 5 asks wait per app and 20 in all; more are busy at once, with no record', async () => {
  const e = env();
  const mine = Array.from({ length: 5 }, () => outcome(e.a.ask('action', ACTION)));
  assert.equal(await e.a.ask('action', ACTION), 'busy');
  assert.equal(await e.a.ask('pair', { ...PAIR, app: { ...CLAUDE } }), 'busy', 'the same app by its id');
  await settle();
  assert.equal(records(e.data).length, 5);
  outcome(e.a.ask('pair', { ...PAIR, app: CODE }));
  await settle();
  assert.equal(records(e.data).length, 6, 'another app still asks');
  // Without an id, an app is its name and program.
  const named = (i) => ({ ...PAIR, app: { name: `App ${i}`, exe: '/bin/x' } });
  for (let i = 0; i < 14; i++) e.a.ask('pair', named(i));
  await settle();
  assert.equal(records(e.data).length, 20);
  assert.equal(await e.a.ask('pair', named(99)), 'busy', '20 in all');
  // A decided ask frees its place.
  e.a.decide({ type: 'glaze:mcp-ask', id: records(e.data)[0].id, answer: 'no' }, e.from(e.made[0]));
  await settle();
  assert.equal(mine[0].v, 'no');
  outcome(e.a.ask('action', ACTION));
  await settle();
  assert.equal(records(e.data).filter((x) => x.state === 'waiting').length, 20);
});

test('progress every 15 s while the student decides, and none after', async () => {
  const e = env();
  const said = [];
  const progress = (...a) => { said.push(a); return true; };
  const r = outcome(e.a.ask('pair', PAIR, { progress }));
  await settle();
  await e.tick(14_999);
  assert.deepEqual(said, []);
  await e.tick(1);
  assert.deepEqual(said, [[15, undefined, 'Waiting for the student in Glaze']]);
  await e.tick(30e3);
  assert.deepEqual(said.map((x) => x[0]), [15, 30, 45]);
  e.a.decide({ type: 'glaze:mcp-ask', id: records(e.data)[0].id, answer: 'yes' }, e.from(e.made[0]));
  await settle();
  assert.equal(r.v, 'yes');
  await e.tick(120e3);
  assert.equal(said.length, 3);
  // The same call's next ask keeps counting up, so the client takes each one as progress.
  e.a.ask('grant', GRANT, { progress });
  await settle();
  await e.tick(15e3);
  assert.deepEqual(said.map((x) => x[0]), [15, 30, 45, 60]);
  // A callback that throws doesn't stop the ask; an ask without one has only its timeout.
  const bad = outcome(e.a.ask('pair', { ...PAIR, app: CODE }, { progress: () => { throw new Error('gone'); } }));
  await settle();
  await e.tick(15e3);
  assert.equal(bad.v, undefined);
  const before = e.due.size;
  e.a.ask('pair', { ...PAIR, app: { name: 'Quiet', exe: '' } });
  await settle();
  assert.equal(e.due.size, before + 1);
});

test('an approval records consent and never invents execution or completion', async () => {
  const e = env();
  const r = outcome(e.a.ask('action', ACTION));
  await settle();
  await e.tick(5000);
  e.a.decide({ type: 'glaze:mcp-ask', id: records(e.data)[0].id, answer: 'yes' }, e.from(e.made[0]));
  await settle();
  assert.equal(r.v, 'yes');
  const rec = records(e.data)[0];
  assert.equal(rec.state, 'yes');
  assert.equal(e.due.size, 0, 'approval owns no execution timer');
  await e.tick(60e3);
  assert.equal(records(e.data)[0].state, 'yes');
  // A refused action never runs; an allowed pairing isn't a run.
  outcome(e.a.ask('action', ACTION));
  outcome(e.a.ask('pair', PAIR));
  await settle();
  const [, refused, pair] = records(e.data);
  e.a.decide({ type: 'glaze:mcp-ask', id: refused.id, answer: 'no' }, e.from(e.made[1]));
  e.a.decide({ type: 'glaze:mcp-ask', id: pair.id, answer: 'yes' }, e.from(e.made[1]));
  await settle();
  assert.deepEqual(records(e.data).map((x) => x.state), ['yes', 'no', 'yes']);
});

test('a worker start sweeps the last worker\'s asks: waiting and running are interrupted, and a run may have happened', async () => {
  const e = env();
  const t = e.now();
  const base = { kind: 'action', app: { name: 'Claude', exe: '' }, tool: { name: 'todo_mark_done', title: '' }, summary: 'Mark it done.' };
  Object.assign(e.data, {
    'mcpAsk:a': { ...base, id: 'a', at: t - 1000, until: t + 599e3, state: 'waiting' },
    'mcpAsk:b': { ...base, id: 'b', at: t - 9000, until: t + 30e3, state: 'running' },
    'mcpAsk:c': { ...base, id: 'c', at: t - 200e3, until: t - 1, state: 'running' },
    'mcpAsk:d': { ...base, id: 'd', at: t - 5000, until: t + 595e3, state: 'no' },
    'mcpAsk:e': { ...base, id: 'e', at: t - A.KEEP - 1, until: t - A.KEEP + 600e3, state: 'yes' },
    'mcpAsk:f': 'not a record',
    mcpAskWindow: { id: 3, tab: 300 },
    mcpLink: { state: 'connected' },
  });
  // An ask made as the worker starts waits for the sweep, and the sweep leaves it alone.
  const sweeping = e.a.sweep();
  const r = outcome(e.a.ask('pair', PAIR));
  await sweeping;
  await settle();
  assert.deepEqual(e.data['mcpAsk:a'], { ...base, id: 'a', at: t - 1000, until: t + 599e3, state: 'interrupted' });
  assert.deepEqual(e.data['mcpAsk:b'], { ...base, id: 'b', at: t - 9000, until: t + 30e3, state: 'interrupted', mayHaveRun: true });
  assert.equal(e.data['mcpAsk:c'].state, 'interrupted', 'elapsed time is not evidence of completion');
  assert.equal(e.data['mcpAsk:c'].mayHaveRun, true);
  assert.equal(e.data['mcpAsk:d'].state, 'no');
  assert.equal(e.data['mcpAsk:e'], undefined, 'settled over an hour ago');
  assert.equal(e.data['mcpAsk:f'], 'not a record');
  assert.deepEqual(e.data.mcpLink, { state: 'connected' });
  assert.ok(e.removed.includes(3), 'the last worker\'s window is closed');
  const mine = records(e.data).find((x) => x.state === 'waiting');
  assert.equal(mine.kind, 'pair');
  assert.equal(r.v, undefined);
  assert.deepEqual(e.data.mcpAskWindow, { id: e.made[0].id, tab: e.made[0].id * 100 });
  assert.equal(e.a.sweep(), sweeping, 'once per worker');
});

test('settled asks are pruned an hour after they were made', async () => {
  const e = env();
  e.a.ask('pair', PAIR);
  await settle();
  const old = records(e.data)[0];
  e.a.decide({ type: 'glaze:mcp-ask', id: old.id, answer: 'no' }, e.from(e.made[0]));
  await e.tick(A.KEEP);
  e.a.ask('grant', GRANT);
  await settle();
  assert.equal(e.data[`mcpAsk:${old.id}`], undefined);
  assert.equal(records(e.data).length, 1);
});

test('the page renders from storage.session and sends only its decision', () => {
  const html = read('lib/mcp/approve.html'), js = read('lib/mcp/approve-page.js');
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'self'[^"]*connect-src 'none'/);
  for (const f of ['../../ui.css', 'approve.css', '../i18n.js', '../../defaults.js', 'approve-page.js']) assert.ok(html.includes(`"${f}"`), f);
  for (const l of ['de', 'es', 'fr', 'nl', 'pt-BR']) assert.ok(html.includes(`<script src="../../i18n/${l}.js"></script>`), l);
  assert.ok(!/<script>/.test(html) && !/\son\w+=/.test(html), 'no inline script or handlers');
  // Don't allow comes first and has the focus; Allow is the primary button.
  const no = html.indexOf('id="no"'), yes = html.indexOf('id="yes"');
  assert.ok(no > 0 && yes > no);
  assert.match(html, /<button id="no" type="button" autofocus>Don't allow<\/button>/);
  assert.match(html, /<button id="yes" type="button" class="primary">Allow<\/button>/);
  assert.ok(!/\.(?:inner|outer)HTML\s*=|insertAdjacentHTML|document\.write/.test(js), 'text only');
  assert.ok(!/onMessage|location\.(?:search|hash)|URLSearchParams/.test(js), 'nothing but the records says what to show');
  assert.match(js, /chrome\.storage\.session\.get\(null\)/);
  assert.match(js, /chrome\.storage\.onChanged\.addListener/);
  assert.match(js, /type: 'glaze:mcp-ask', id: shown\.id, answer/);
  assert.match(js, /e\.key === 'Escape'/);
  assert.equal(A.PREFIX, 'mcpAsk:');
});

test('the approval page is not reachable from web pages', () => {
  const m = require('../manifest.json');
  const listed = (m.web_accessible_resources || []).flatMap((w) => w.resources);
  assert.ok(!listed.some((r) => /^lib\/(?:mcp\/|\*)|approve/.test(r)), listed.join(', '));
});

// Execute the shipped page with a small DOM and controlled focus/clock, including native button default actions.
const pageEnv = async () => {
  const handlers = {}, events = {}, sent = [], due = new Map(), elements = new Map();
  let focused = true, seq = 0;
  const document = { activeElement: null, hasFocus: () => focused, visibilityState: 'visible', documentElement: { style: {} },
    addEventListener: (type, fn) => { (events[type] ||= []).push(fn); },
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, { id, hidden: false, textContent: '', attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; }, focus() { document.activeElement = this; },
        addEventListener(type, fn) { this[type] = fn; } });
      return elements.get(id);
    } };
  const fire = (list, type, extra = {}) => {
    const e = { key: '', repeat: false, isComposing: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const fn of list[type] || []) fn(e);
    return e;
  };
  vm.runInNewContext(read('lib/mcp/approve-page.js'), { document,
    window: { addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); } },
    GZ_I18N: { page() {}, ui: () => 'en', t: (k, values = {}) => k.replace(/\{(\w+)\}/g, (_, p) => values[p]) },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: (fn) => { due.set(++seq, fn); return seq; }, clearTimeout: (id) => due.delete(id),
    chrome: { storage: { session: { get: async () => ({ 'mcpAsk:a': { ...ACTION, id: 'a', kind: 'action', at: 1, state: 'waiting' } }) },
      onChanged: { addListener() {} }, sync: { get: async () => ({}) } },
    runtime: { sendMessage: (m, cb) => { sent.push(m); cb({ ok: true }); } } },
  });
  await settle();
  return { sent, el: document.getElementById,
    elapse: () => { const jobs = [...due.values()]; due.clear(); jobs.forEach((f) => f()); },
    focus: (value) => { focused = value; fire(handlers, value ? 'focus' : 'blur'); },
    key: (extra) => { const e = fire(events, 'keydown', extra); if (!e.defaultPrevented && e.key === 'Enter') document.activeElement?.click(); return e; },
  };
};

test('the page disarms on blur and waits again after focus returns', async () => {
  const p = await pageEnv();
  p.elapse();
  p.focus(false);
  p.el('yes').click();
  assert.equal(p.sent.length, 0, 'a background window cannot approve');
  p.focus(true);
  p.el('yes').click();
  assert.equal(p.sent.length, 0, 'focus starts a new input guard');
  assert.equal(p.el('no').attrs['aria-disabled'], 'true');
  p.elapse();
  p.el('yes').click();
  assert.equal(p.sent[0].answer, 'yes');
});

test('held and composing Enter keys cannot activate Allow after the guard expires', async () => {
  for (const extra of [{ repeat: true }, { isComposing: true }]) {
    const p = await pageEnv();
    p.elapse();
    p.el('yes').focus();
    p.key({ key: 'Enter', ...extra });
    assert.equal(p.sent.length, 0, JSON.stringify(extra));
    p.key({ key: 'Enter' });
    assert.equal(p.sent[0].answer, 'yes', 'a fresh, intentional key still works');
  }
});
