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
const seed = async (d) => {
  const id = crypto.randomUUID();
  assert.equal((await N.run({ key: NK, op: 'save', id, base: 0, sid: crypto.randomUUID(), copy: crypto.randomUUID(), title: 'Biology', html: '<p>Kept note</p>' }, { local: d.local }, d.notes)).ok, true);
  return id;
};
const sharedNote = async (d) => {
  const id = await seed(d);
  const { sid } = await d.send('create', { kind: 'notes', title: 'Biology', key: NK, ids: [id] });
  return { id, sid };
};
const page = async (d, { note = '', relay: selected } = {}) => {
  const doc = { activeElement: null }, ids = new Map(), events = new Map(), calls = [], messages = [], copied = [];
  const make = (tag) => {
    const e = new El(tag, doc);
    e.classList = { toggle: (name, on) => { const classes = new Set(e.className.split(/\s+/).filter(Boolean)); if (on) classes.add(name); else classes.delete(name); e.className = [...classes].join(' '); } };
    return e;
  };
  doc.root = make('html'); doc.body = make('body'); doc.root.append(doc.body); doc.activeElement = doc.body;
  for (const [id, tag] of [['status', 'p'], ['ask', 'div'], ['ask-text', 'p'], ['ask-yes', 'button'], ['ask-no', 'button'], ['paused', 'p'], ['resume', 'button'], ['who', 'label'], ['name', 'input'], ['note', 'section'], ['note-title', 'h2'], ['note-state', 'p'], ['note-new', 'div'], ['share', 'button'], ['note-shared', 'div'], ['others', 'section'], ['list', 'ul'], ['invite', 'input'], ['join', 'button'], ['settings', 'button']]) {
    const e = make(tag); e.id = id; ids.set(id, e); doc.body.append(e);
  }
  ids.get('ask').hidden = true;
  ids.get('who').hidden = true;
  ids.get('ask').append(ids.get('ask-text'), ids.get('ask-yes'), ids.get('ask-no'));
  Object.assign(doc, { createElement: make, querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s) });
  const context = vm.createContext({ document: doc, URL, URLSearchParams, console, setTimeout, clearTimeout, Date,
    location: { search: new URLSearchParams({ key: NK, note }).toString() },
    navigator: { userActivation: { isActive: true }, clipboard: { writeText: async (v) => { copied.push(v); } } },
    GZ_I18N: { page() {}, ui() {}, t: (k, vars) => k.replace(/\{(\w+)\}/g, (_, key) => vars?.[key] ?? '') }, GZ_RELAY: R,
    GZ_SANITIZE: () => ({ look: { radius: 12 }, auto: { on: false } }), GZ_SURFACES: { vars: () => ({}) }, GZ_ACTIVE_COLORS: () => ({ '--gz-accent': '#abc' }),
    matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener: (name, f) => events.set(name, f),
    chrome: { storage: { sync: area(), onChanged: { addListener() {} } }, permissions: { contains: async () => true, request: async () => true }, tabs: { create: async () => {} },
      runtime: { id: 'glaze', getURL: (f) => `chrome-extension://glaze/${f}`, connect: () => ({ onMessage: { addListener: (f) => messages.push(f) }, disconnect() {}, postMessage() {} }),
        sendMessage: async (m) => {
          calls.push(clone(m));
          if (['leave', 'delete'].includes(m.op)) d.worker.stop();
          await d.hold?.(m);
          try { const value = await d.worker.handle(m); if (m.op === 'list' && selected) value.relay = selected; return value; }
          catch (e) { return { ok: false, error: e.message }; }
        } },
    },
  });
  vm.runInContext(SOURCE, context);
  await until(() => calls.some((m) => m.op === 'list') && !ids.get('who').hidden);
  const click = (el) => { assert.ok(el, 'button exists'); if (el.disabled) return; for (const { type, f } of el.listeners) if (type === 'click') f({ isTrusted: true, target: el }); };
  const p = { doc, calls, copied, click: (id) => click(typeof id === 'string' ? ids.get(id) : id), get: (id) => ids.get(id), message: async () => { for (const f of messages) f({ changed: true }); await settle(); }, button: (text) => doc.root.querySelectorAll('button').find((e) => e.textContent === text) };
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
