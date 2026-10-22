// The actual Notes share UI in a small DOM, with lib/sessions.js over memory and a localhost disk relay.
// Runtime messages use the broker's stop-before-delete/leave interruption rule; no live service is contacted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../lib/sessions.js');
const N = require('../lib/notes.js');
const T = require('../lib/todo.js');
const R = require('../lib/relay.js');
const G = require('../defaults.js');
const { relay, diskStore } = require('../server/relay.js');
const { El } = require('./stand-in-dom.js');
const SOURCE = fs.readFileSync(path.join(__dirname, '../sharing/quick.js'), 'utf8');
const NK = 'notesIdx:https://school.instructure.com/5';
const clone = (v) => v === undefined ? v : structuredClone(v);
const settle = async () => { for (let i = 0; i < 15; i++) await new Promise(setImmediate); };
const until = async (f) => { const end = Date.now() + 5000; while (!await f()) { assert.ok(Date.now() < end, 'UI did not settle'); await new Promise((r) => setTimeout(r, 5)); } await settle(); };
const area = (data = {}) => ({ data, get: async (keys) => Object.fromEntries([].concat(keys ?? Object.keys(data)).filter((k) => k in data).map((k) => [k, clone(data[k])])), set: async (patch) => { Object.assign(data, clone(patch)); return true; } });
const database = (names) => {
  const stores = Object.fromEntries(names.map((s) => [s, new Map()]));
  return { stores, get: async (s, k) => clone(stores[s].get(k)), all: async (s) => [...stores[s].values()].map(clone),
    put: async (s, k, v) => { stores[s].set(k, clone(v)); }, del: async (s, k) => { for (const id of [].concat(k)) stores[s].delete(id); },
    scan: async (s, p) => [...stores[s]].filter(([k]) => k.startsWith(p)), keys: async (s, p) => [...stores[s].keys()].filter((k) => k.startsWith(p)), estimate: async () => ({ quota: 1e9, usage: 0 }) };
};
const start = async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-quick-ui-'));
  const r = relay({ db: path.join(dir, 'share.db'), store: diskStore(path.join(dir, 'blobs')) });
  t.after(async () => { await r.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const address = await r.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${address.port}`;
};
const device = (t, server) => {
  const local = area({ [NK]: N.clean({}) }), db = database(['sessions', 'files']), notes = database(['bodies', 'files', 'blobs']);
  const d = { local, db, notes, requests: [], online: true };
  d.worker = S.make({ local, sync: area(), notes, db, relay: server, dev: true, permission: async () => true,
    fetch: (...args) => { d.requests.push(args[0]); if (!d.online) throw new Error('offline'); return fetch(...args); }, WebSocket });
  d.send = (op, rest = {}) => d.worker.handle({ op, ...rest });
  t.after(() => d.worker.stop());
  return d;
};
const seed = async (d, key = NK) => {
  const id = crypto.randomUUID();
  assert.equal((await N.run({ key, op: 'save', id, base: 0, sid: crypto.randomUUID(), copy: crypto.randomUUID(), title: 'Biology', html: '<p>Kept note</p>' }, { local: d.local }, d.notes)).ok, true);
  return id;
};
const sharedNote = async (d) => {
  const id = await seed(d);
  const { sid } = await d.send('create', { kind: 'notes', title: 'Biology', key: NK, ids: [id] });
  return { id, sid };
};
const page = async (d, { note = '', relay: selected, observer = 'v2', prefs = G.GZ_DEFAULTS } = {}) => {
  const doc = { activeElement: null }, ids = new Map(), events = new Map(), calls = [], messages = [], disconnects = [], copied = [], opened = [], changes = [];
  const sync = area(prefs);
  let clock = 1000, watcher;
  const observed = new Set();
  const entry = (target, props = {}) => ({ target, time: clock, boundingClientRect: { ...target.getBoundingClientRect() }, isIntersecting: true, intersectionRatio: 1, ...(observer === 'v2' && { isVisible: true }), ...props });
  class Observer {
    constructor(f) { if (observer === 'throws') throw new Error('unsupported'); this.f = f; this.trackVisibility = observer === 'v2'; watcher = this; }
    observe(target) { observed.add(target); this.f([entry(target)]); }
    unobserve(target) { observed.delete(target); }
    disconnect() { observed.clear(); }
    takeRecords() { return []; }
  }
  const make = (tag) => {
    const e = new El(tag, doc);
    e.classList = { toggle: (name, on) => { const classes = new Set(e.className.split(/\s+/).filter(Boolean)); if (on) classes.add(name); else classes.delete(name); e.className = [...classes].join(' '); } };
    return e;
  };
  doc.root = make('html'); doc.body = make('body'); doc.root.append(doc.body); doc.activeElement = doc.body;
  doc.documentElement = doc.root;
  for (const [id, tag] of [['status', 'p'], ['ask', 'div'], ['ask-text', 'p'], ['ask-yes', 'button'], ['ask-no', 'button'], ['paused', 'p'], ['resume', 'button'], ['who', 'label'], ['name', 'input'], ['note', 'section'], ['note-title', 'h2'], ['note-state', 'p'], ['note-new', 'div'], ['share', 'button'], ['note-shared', 'div'], ['others', 'section'], ['list', 'ul'], ['invite', 'input'], ['join', 'button'], ['settings', 'button']]) {
    const e = make(tag); e.id = id; ids.set(id, e); doc.body.append(e);
  }
  ids.get('ask').hidden = true;
  ids.get('who').hidden = true;
  ids.get('ask').append(ids.get('ask-text'), ids.get('ask-yes'), ids.get('ask-no'));
  Object.assign(doc, { createElement: make, querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s) });
  const handle = async (m) => {
    calls.push(clone(m));
    if (['leave', 'delete'].includes(m.op)) d.worker.stop();
    await d.hold?.(m);
    try { const value = await d.worker.handle({ ...m, scope: { id: 'panel-ui', key: NK, note } }); if (m.op === 'list' && selected) value.relay = selected; return value; }
    catch (e) { return { ok: false, error: e.message }; }
  };
  const context = vm.createContext({ document: doc, URL, URLSearchParams, console, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return clock; } }, performance: { now: () => clock },
    ...(observer !== 'absent' && { IntersectionObserver: Observer, IntersectionObserverEntry: class { get isVisible() { return true; } } }),
    location: { search: '?t=ticket' },
    navigator: { userActivation: { isActive: true }, clipboard: { writeText: async (v) => { copied.push(v); } } },
    GZ_I18N: { page() {}, ui() {}, t: (k, vars) => k.replace(/\{(\w+)\}/g, (_, key) => vars?.[key] ?? '') }, GZ_RELAY: R,
    ...G, GZ_COLOR: require('../lib/color.js'), GZ_FONTS: require('../lib/fonts.js'),
    matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener: (name, f) => events.set(name, f),
    chrome: { storage: { sync, onChanged: { addListener(f) { changes.push(f); } } }, permissions: { contains: async () => true, request: async () => true }, tabs: { create: async (tab) => { opened.push(tab); } },
      runtime: { id: 'glaze', getURL: (f) => `chrome-extension://glaze/${f}`, connect: () => ({ onMessage: { addListener: (f) => messages.push(f) }, onDisconnect: { addListener: (f) => disconnects.push(f) }, disconnect() {},
        postMessage: (m) => { if (m.ticket) queueMicrotask(() => messages.forEach((f) => f({ id: m.id, ok: true })));
          else if (m.op) handle(m).then((r) => messages.forEach((f) => f({ id: m.id, ...r }))); } }), sendMessage: handle },
    },
  });
  vm.runInContext(SOURCE, context);
  events.get('message')?.({ data: { type: 'glaze:quick-start', ticket: 'ab'.repeat(16) } });
  await until(() => calls.some((m) => m.op === 'list') && !ids.get('who').hidden);
  const click = (el, age = 600) => { clock += age; assert.ok(el, 'button exists'); if (el.disabled) return; for (const { type, f } of el.listeners) if (type === 'click') f({ isTrusted: true, target: el, currentTarget: el }); };
  const p = { doc, calls, copied, opened, observed, changePrefs: async (patch) => { await sync.set(patch); changes.forEach((f) => f(Object.fromEntries(Object.keys(patch).map((k) => [k, {}])), 'sync')); await settle(); }, advance: (ms) => { clock += ms; }, visible: (el, props) => watcher.f([entry(typeof el === 'string' ? ids.get(el) : el, props)]),
    record: (el, props) => entry(el, props), deliver: (record) => watcher.f([record]),
    disconnect: () => disconnects.forEach((f) => f()), click: (id, age) => click(typeof id === 'string' ? ids.get(id) : id, age), get: (id) => ids.get(id), message: async () => { for (const f of messages) f({ changed: true }); await settle(); }, button: (text) => doc.root.querySelectorAll('button').find((e) => e.textContent === text) };
  return p;
};

test('quick Stop sharing deletes then leaves across broker interruptions and preserves the note', async (t) => {
  const server = await start(t), d = device(t, server), { id, sid } = await sharedNote(d), p = await page(d, { note: id });
  p.click(p.button('Stop sharing')); await settle();
  assert.equal(p.get('ask').hidden, false);
  p.click('ask-yes');
  await until(async () => !await d.db.get('sessions', sid));
  assert.deepEqual(p.calls.filter((m) => ['delete', 'leave'].includes(m.op)).map((m) => m.op), ['delete', 'leave']);
  assert.match((await N.run({ key: NK, op: 'load', id }, { local: d.local }, d.notes)).html, /Kept note/);
  assert.match(p.get('status').textContent, /Sharing stopped/);
});

test('quick sensitive clicks fail closed without verified IntersectionObserver v2', async (t) => {
  const server = await start(t), d = device(t, server), id = await seed(d);
  for (const observer of ['absent', 'throws', 'v1']) await t.test(observer, async () => {
    const p = await page(d, { note: id, observer }), before = p.calls.length;
    p.click('share'); await settle();
    assert.equal(p.calls.length, before, 'no consent/create/link from an unverified embedded click');
    assert.match(p.get('status').textContent, /visibility protection/);
    p.click('settings'); await settle();
    assert.equal(p.opened.length, 1, 'safe Settings navigation remains available without IOv2');
    p.disconnect();
  });
});

test('quick visibility requires the whole button and resets the dwell for every question', async (t) => {
  const server = await start(t), d = device(t, server), { id } = await sharedNote(d), p = await page(d, { note: id });
  const stop = p.button('Stop sharing');
  p.visible(stop, { intersectionRatio: 0.1 }); p.click(stop); await settle();
  assert.equal(p.get('ask').hidden, true, 'a partly clipped button is not fully visible');
  assert.match(p.get('status').textContent, /fully visible and uncovered/);
  p.visible(stop, { intersectionRatio: 1, isVisible: false }); p.click(stop); await settle();
  assert.equal(p.get('ask').hidden, true, 'a covered/faded button cannot open a question');
  assert.match(p.get('status').textContent, /All sharing settings/);
  p.visible(stop, { isVisible: true }); p.click(stop, 499);
  assert.equal(p.get('ask').hidden, true, '500 ms must elapse after visibility returns');
  assert.match(p.get('status').textContent, /Wait a moment/);
  p.click(stop, 1); assert.equal(p.get('ask').hidden, false);
  p.click('ask-yes', 0); await settle();
  assert.ok(!p.calls.some((m) => m.op === 'delete'), 'a reused confirmation needs a fresh dwell for this question');
  p.disconnect();
});

test('quick rerenders and teardown release observed buttons', async (t) => {
  const server = await start(t), d = device(t, server), { id } = await sharedNote(d), p = await page(d, { note: id });
  const before = p.observed.size;
  for (let i = 0; i < 8; i++) await p.message();
  assert.equal(p.observed.size, before, 'replaced buttons do not accumulate in the observer');
  p.disconnect();
  assert.equal(p.observed.size, 0);
});

test('quick confirmation does not inherit a hidden or previous question visibility timer', async (t) => {
  const server = await start(t), d = device(t, server), { id } = await sharedNote(d), p = await page(d, { note: id });
  p.click(p.button('Stop sharing')); await settle();
  p.click('ask-yes', 0); await settle();
  assert.ok(!p.calls.some((m) => m.op === 'delete'), 'fresh question cannot be confirmed immediately');
  p.disconnect();
});

test('quick ignores a click after its button moves since the visibility observation', async (t) => {
  const server = await start(t), d = device(t, server), { id } = await sharedNote(d), p = await page(d, { note: id });
  const stop = p.button('Stop sharing');
  stop.box = { left: 5, top: 5, width: 100, height: 20 };
  p.click(stop); await settle();
  assert.equal(p.get('ask').hidden, true);
  assert.match(p.get('status').textContent, /panel moved/);
  p.click(stop); await settle();
  assert.equal(p.get('ask').hidden, false, 'a new observation permits recovery after a fresh dwell');
  p.disconnect();
});

test('quick follows the Look palette, surfaces and shape, including a live dark-to-light change', async (t) => {
  const server = await start(t), d = device(t, server), id = await seed(d);
  const dark = { ...G.GZ_DEFAULTS, ...G.GZ_LOOK_APPLY(G.GZ_DEFAULTS, G.GZ_LOOKS.find((l) => l.name === 'Aurora Night')) };
  const p = await page(d, { note: id, prefs: dark });
  assert.equal(p.doc.root.style['--gz-ink'], dark.colors['--gz-ink']);
  assert.equal(p.doc.root.style['--gz-surface'], dark.colors['--gz-surface']);
  assert.equal(p.doc.root.style['--gz-radius'], '16px');
  assert.equal(p.doc.root.style.colorScheme, 'dark');
  const light = G.GZ_LOOK_APPLY(dark, G.GZ_LOOKS.find((l) => l.name === 'Library'));
  await p.changePrefs(light);
  assert.equal(p.doc.root.style['--gz-ink'], light.colors['--gz-ink']);
  assert.equal(p.doc.root.style['--gz-radius'], '6px');
  assert.match(p.doc.root.style['--gz-font'], /Literata/);
  assert.equal(p.doc.root.style.colorScheme, 'light');
  p.disconnect();
});

test('quick does not treat a delayed visibility entry as a measurement of the current box', async (t) => {
  const server = await start(t), d = device(t, server), { id } = await sharedNote(d), p = await page(d, { note: id });
  const stop = p.button('Stop sharing'), old = p.record(stop);
  stop.box = { left: 5, top: 5, width: 100, height: 20 };
  p.deliver(old); p.click(stop); await settle();
  assert.equal(p.get('ask').hidden, true);
  p.disconnect();
});

test('quick explains when restarting other accounts requires Settings', async (t) => {
  const server = await start(t), d = device(t, server), { id } = await sharedNote(d);
  const other = 'notesIdx:https://school.instructure.com/6';
  await d.local.set({ [other]: N.clean({}) });
  const otherId = await seed(d, other);
  await d.send('create', { kind: 'notes', title: 'Other account', key: other, ids: [otherId] });
  await d.send('pause');
  await d.local.set({ shareHosts: [server] });
  const p = await page(d, { note: id });
  assert.equal(p.get('paused').hidden, false);
  p.click('resume'); await settle();
  assert.ok(p.calls.some((m) => m.op === 'resume'), 'exercise the worker refusal, not the UI host precheck');
  assert.equal(d.local.data.shareOn, false);
  assert.match(p.get('status').textContent, /Resume sharing from Settings/);
  p.disconnect();
});

test('quick worker restart disables stale controls and tells the user how to reopen', async (t) => {
  const server = await start(t), d = device(t, server), { id } = await sharedNote(d), p = await page(d, { note: id });
  const before = p.calls.length;
  p.disconnect(); await settle();
  assert.match(p.get('status').textContent, /Close this panel and open Share again/);
  assert.ok(p.doc.root.querySelectorAll('button').every((b) => b.disabled));
  p.click(p.button('Copy edit invite')); await settle();
  assert.equal(p.calls.length, before, 'stale state cannot dispatch any operation');
  assert.equal(p.copied.length, 0);
});

test('quick Stop sharing can forget an already deleted session while offline', async (t) => {
  const server = await start(t), d = device(t, server), { id, sid } = await sharedNote(d);
  await d.send('delete', { sid }); d.online = false;
  const p = await page(d, { note: id }), before = d.requests.length;
  p.click(p.button('Stop sharing')); await settle(); p.click('ask-yes'); await settle();
  assert.equal(await d.db.get('sessions', sid), undefined, 'a known-deleted share only needs its local keys forgotten');
  assert.equal(d.requests.length, before, 'leaving a known-deleted session does not need its relay');
  assert.match((await N.run({ key: NK, op: 'load', id }, { local: d.local }, d.notes)).html, /Kept note/);
});

test('quick view-only Join keeps a visible session for its detached Notes copy', async (t) => {
  const server = await start(t), creator = device(t, server), joined = device(t, server), { sid } = await sharedNote(creator);
  const link = (await creator.send('link', { sid })).link, p = await page(joined);
  p.get('invite').value = link; p.click('join');
  assert.equal(p.get('ask').hidden, false, 'a non-default relay requires an inline confirmation');
  p.click('ask-yes');
  await until(() => p.get('status').textContent.startsWith('Joined.'));
  const session = (await joined.send('list')).sessions[0];
  assert.equal(session.bound, false, 'a view invite keeps its editable Notes copy detached');
  assert.equal(session.account, NK, 'the detached copy still belongs to its selected Notes account');
  assert.equal(session.notes.length, 1);
  assert.equal(p.get('others').hidden, false);
  assert.ok(p.button('Leave'), 'the joined view session remains manageable from Notes');
  const copy = session.notes[0], localNote = joined.local.data[NK].notes[copy];
  await N.run({ key: NK, op: 'save', id: copy, base: localNote.rev, sid: crypto.randomUUID(), copy: crypto.randomUUID(), title: 'My copy', html: '<p>Local edit</p>' }, { local: joined.local }, joined.notes);
  await joined.send('sync', { sid });
  assert.match(Object.values((await joined.send('read', { sid })).view).map((x) => x.html || '').join(' '), /Kept note/);
  assert.doesNotMatch(Object.values((await joined.send('read', { sid })).view).map((x) => x.html || '').join(' '), /Local edit/);
  p.click(p.button('Leave')); await settle(); p.click('ask-yes');
  await until(async () => !await joined.db.get('sessions', sid));
  assert.match((await N.run({ key: NK, op: 'load', id: copy }, { local: joined.local }, joined.notes)).html, /Local edit/);
});

test('quick custom-relay confirmation cancels before joining and disables controls during the confirmed join', async (t) => {
  const server = await start(t), creator = device(t, server), joined = device(t, server), { sid } = await sharedNote(creator);
  const link = (await creator.send('link', { sid, edit: true })).link, p = await page(joined);
  p.get('invite').value = link; p.click('join');
  assert.equal(p.get('ask').hidden, false);
  assert.equal(!!p.get('ask-yes').disabled, false, 'the confirmation can be answered');
  p.click('ask-no'); await settle();
  assert.equal(p.get('ask').hidden, true);
  assert.equal(p.calls.filter((m) => m.op === 'join').length, 0);
  assert.equal(joined.requests.length, 0);

  let release;
  const gate = new Promise((r) => { release = r; });
  joined.hold = (m) => m.op === 'join' ? gate : undefined;
  t.after(release);
  p.get('invite').value = link; p.click('join'); p.click('ask-yes');
  await until(() => p.calls.some((m) => m.op === 'join'));
  assert.ok(p.doc.root.querySelectorAll('button').every((b) => b.disabled), 'no second action starts while the join is pending');
  p.click('join'); assert.equal(p.calls.filter((m) => m.op === 'join').length, 1);
  release();
  await until(() => p.get('status').textContent.startsWith('Joined.'));
  assert.ok(p.doc.root.querySelectorAll('button').every((b) => !b.disabled));
});

test('quick non-Notes invites are retained for Settings without attaching them to Notes', async (t) => {
  const server = await start(t), creator = device(t, server), joined = device(t, server), key = 'todo:https://school.instructure.com/5';
  await creator.local.set({ [key]: T.clean({ tasks: [{ id: 'task-1', title: 'Read chapter' }] }) });
  const { sid } = await creator.send('create', { kind: 'todo', title: 'Tasks', key, ids: ['task-1'] });
  const link = (await creator.send('link', { sid })).link, p = await page(joined);
  p.get('invite').value = link; p.click('join'); p.click('ask-yes');
  await until(() => p.get('status').textContent.includes('not for notes'));
  assert.equal(p.calls.filter((m) => m.op === 'attach').length, 0);
  assert.equal((await joined.send('list')).sessions[0].kind, 'todo');
  assert.equal(N.list(joined.local.data[NK]).length, 0);
});

test('quick offline Join retains its keys and appears after the promised Settings recovery', async (t) => {
  const server = await start(t), creator = device(t, server), joined = device(t, server), { sid } = await sharedNote(creator);
  const link = (await creator.send('link', { sid, edit: true })).link, p = await page(joined);
  joined.online = false;
  p.get('invite').value = link; p.click('join'); p.click('ask-yes');
  await until(() => p.get('status').textContent.startsWith('Joined, but'));
  assert.match(p.get('status').textContent, /All sharing settings once it connects/);
  assert.ok(await joined.db.get('sessions', sid), 'the offline join is retained');
  assert.equal(p.calls.filter((m) => m.op === 'attach').length, 0);
  joined.online = true;
  await joined.send('sync', { sid });
  await joined.send('attach', { sid, key: NK });
  await p.message();
  assert.equal(p.get('others').hidden, false);
  assert.ok(p.button('Leave'));
  const session = (await joined.send('list')).sessions[0];
  assert.match((await N.run({ key: NK, op: 'load', id: session.notes[0] }, { local: joined.local }, joined.notes)).html, /Kept note/);
});

test('a share too big to sync says so in the panel, not Offline', async (t) => {
  const server = await start(t), d = device(t, server), { id, sid } = await sharedNote(d);
  // What the worker keeps after a sync that could not hold what it read (lib/sessions.js update()).
  await d.db.put('sessions', sid, { ...await d.db.get('sessions', sid), status: 'big', error: 'state' });
  const p = await page(d, { note: id });
  assert.equal(p.get('note-state').textContent, 'Shared · Too big to sync — local copy kept');
});

test('a scoped panel sees and acts on only its Notes account, and shares only its own note', async (t) => {
  const server = await start(t), d = device(t, server), { id, sid } = await sharedNote(d);
  const OTHER = 'notesIdx:https://school.instructure.com/6';
  d.local.data[OTHER] = N.clean({});
  const other = await seed(d, OTHER);
  const { sid: otherSid } = await d.send('create', { kind: 'notes', title: 'Elsewhere', key: OTHER, ids: [other] });
  const scope = { key: NK, note: id }, scoped = (op, rest = {}) => d.send(op, { ...rest, scope });
  const list = await scoped('list');
  assert.deepEqual(list.sessions.map((s) => s.sid), [sid]);
  assert.ok(list.sources.every((s) => s.key === NK) && list.accounts.every((k) => k === NK));
  assert.deepEqual(list.scope, scope);
  await assert.rejects(scoped('link', { sid: otherSid }), /bad/, 'another account\'s invite');
  await assert.rejects(scoped('leave', { sid: otherSid }), /bad/);
  await assert.rejects(scoped('create', { kind: 'notes', title: 'x', key: OTHER, ids: [other] }), /bad/, 'another account');
  await assert.rejects(scoped('create', { kind: 'notes', title: 'x', key: NK, ids: [id, other] }), /bad/, 'more than its note');
  await assert.rejects(scoped('create', { kind: 'look', title: 'x' }), /bad/, 'not a Look');
  await assert.rejects(d.send('create', { kind: 'notes', title: 'x', key: NK, ids: [id], scope: { key: NK, note: '' } }), /bad/, 'the account view shares nothing');
  assert.ok((await scoped('link', { sid, edit: true })).link);
});
