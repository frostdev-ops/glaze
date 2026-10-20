// The background worker's sidebar writes ('glaze:sidebar', lib/background.js with lib/sidebar.js), its storage in
// memory: who may write which account's record, changes from two tabs in the queue, a failed write, the one-time move
// of To Do, and a new install's mark.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../lib/sidebar.js');
const W = require('../lib/widgets.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const CANVAS = 'https://school.instructure.com', CANVAS2 = 'https://other.instructure.com', ULTRA = 'https://bb.example.edu', ULTRA2 = 'https://bb.other.edu';
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };

const worker = ({ local = {} } = {}) => {
  const m = require('../manifest.json');
  const store = { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [ULTRA, ULTRA2], ...local }, session: {} };
  const fail = { set: 0 }, slow = { get: 0 };
  const accounts = { [CANVAS]: '42', [CANVAS2]: '42', [ULTRA]: '_9_1', [ULTRA2]: '_9_1' };
  const pages = new Map(), probes = [];
  const area = (s, name) => ({
    get: async (k) => {
      for (let i = 0; i < (name === 'local' ? slow.get : 0); i++) await new Promise(setImmediate);
      return structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])));
    },
    set: async (v) => { if (name === 'local' && fail.set && fail.set--) throw Error('quota'); Object.assign(s, structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const listeners = [], installed = [];
  const context = vm.createContext({
    URL, console, TextEncoder, structuredClone, Promise, Date, Intl, setTimeout, clearTimeout, crypto: globalThis.crypto,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => m,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener: (f) => installed.push(f) }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      tabs: { onRemoved: { addListener() {} } },
      storage: { session: area(store.session, 'session'), local: area(store.local, 'local'), sync: area(store.sync, 'sync'), onChanged: { addListener() {} } },
      scripting: {
        getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {},
        executeScript: async (o) => {
          probes.push(JSON.parse(JSON.stringify(o.target)));
          const s = pages.get(o.target.documentIds?.[0] || `${o.target.tabId}:${o.target.frameIds[0]}`);
          if (!s) throw Error('document gone');
          const origin = new URL(s.url === 'about:blank' ? s.tab.url : s.url).origin;
          const page = vm.createContext({ location: { origin }, GZ_CTX: {
            site: origin.includes('instructure') ? 'canvas' : 'ultra', on: () => true, me: async () => accounts[origin],
          } });
          return [{ result: await vm.runInContext(`(${o.func})(...${JSON.stringify(o.args || [])})`, page) }];
        },
      },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (msg, sender) => new Promise((res) => {
    pages.set(sender.documentId || `${sender.tab.id}:${sender.frameId}`, sender);
    let kept = false;
    for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) kept = true;
    if (!kept) res('ignored');
  });
  return { store, send, installed, fail, slow, accounts, pages, probes };
};
// A tab's frame: Canvas's pages anywhere on the site, Ultra's under /ultra.
const at = (url, frameId = 0, tab = url) => ({ id: 'glaze', url, frameId, tab: { id: 1, url: tab } });
const cKey = (o = CANVAS, uid = '42') => S.key('canvas', o, uid), uKey = (o = ULTRA, uid = '_9_1') => S.key('ultra', o, uid);
const sb = (key, ops) => ({ type: 'glaze:sidebar', key, ops });
const CP = at(`${CANVAS}/courses/1`), UP = at(`${ULTRA}/ultra/course`);

test("a Canvas or Ultra page writes its account's record; any other sender, frame or shape is refused", async () => {
  const w = worker();
  const ok = await w.send(sb(cKey(), [{ op: 'width', px: 400 }]), CP);
  assert.equal(ok.ok, true); assert.equal(ok.rec.width, 400); assert.equal(w.store.local[cKey()].width, 400);
  assert.equal((await w.send(sb(uKey(), [{ op: 'open', v: false }]), UP)).ok, true);
  assert.equal((await w.send(sb(uKey(), [{ op: 'open', v: true }]), at(`${ULTRA}/ultra/courses/_1_1/outline`, 3, `${ULTRA}/ultra/course`))).ok, true, "an Ultra course tab's frame is an Ultra page");
  const before = structuredClone(w.store.local);
  const refused = [
    [sb(cKey(CANVAS2), [{ op: 'open', v: false }]), CP, 'another Canvas site'],
    [sb(cKey(), [{ op: 'open', v: false }]), at(`${CANVAS}/courses/1`, 2), "a Canvas frame (course tabs relay through their top)"],
    [sb(cKey(), [{ op: 'open', v: false }]), at('https://evil.example/x'), 'a site Glaze is not on'],
    [sb(cKey(), [{ op: 'open', v: false }]), { ...CP, id: 'other-extension' }, 'another extension'],
    [sb(S.key('canvas', ULTRA, '42'), [{ op: 'open', v: false }]), UP, 'an Ultra page writing a Canvas record'],
    [sb(uKey(), [{ op: 'open', v: false }]), CP, 'a Canvas page writing an Ultra record'],
    [sb(uKey(ULTRA2), [{ op: 'open', v: false }]), UP, 'another Ultra site'],
    [sb(uKey(), [{ op: 'open', v: false }]), at(`${ULTRA}/webapps/portal`), 'outside /ultra'],
    [sb(uKey(), [{ op: 'open', v: false }]), at(`${ULTRA}/ultra/course`, 2, `${CANVAS}/x`), "an Ultra frame in another site's tab"],
    [sb(`sidebar:canvas:${CANVAS}/x`, [{ op: 'open', v: false }]), CP, 'a malformed key'],
    [sb(cKey(), []), CP, 'no ops'],
    [sb(cKey(), Array(33).fill({ op: 'open', v: false })), CP, 'too many ops'],
    [sb(cKey(), [{ op: 'open', v: false }, { op: 'drop' }]), CP, 'an unknown op'],
    [sb(cKey(), { op: 'open' }), CP, 'ops not a list'],
    [{ type: 'glaze:sidebar', ops: [{ op: 'open', v: false }] }, CP, 'no key'],
  ];
  for (const [msg, sender, why] of refused) assert.deepEqual(await w.send(msg, sender), { ok: false, error: 'sender' }, why);
  assert.deepEqual(w.store.local, before);
  w.store.sync.enabled = false;
  assert.deepEqual(await w.send(sb(cKey(), [{ op: 'open', v: false }]), CP), { ok: false, error: 'sender' }, 'Glaze switched off');
});

test('two schools and two accounts on one site each keep their own record; none overwrites another', async () => {
  const w = worker();
  const keys = [cKey(CANVAS, '1'), cKey(CANVAS, '2'), cKey(CANVAS2, '1')];
  w.accounts[CANVAS] = '1';
  await w.send(sb(keys[0], [{ op: 'dock', id: 'notes' }]), CP);
  w.accounts[CANVAS] = '2';
  await w.send(sb(keys[1], [{ op: 'dock', id: 'timer' }, { op: 'width', px: 300 }]), CP);
  w.accounts[CANVAS2] = '1';
  await w.send(sb(keys[2], [{ op: 'remove', id: 'todo' }]), at(`${CANVAS2}/`));
  w.accounts[ULTRA] = w.accounts[ULTRA2] = '_1_1';
  await w.send(sb(uKey(ULTRA, '_1_1'), [{ op: 'todoScope', v: 'all' }]), UP);
  await w.send(sb(uKey(ULTRA2, '_1_1'), [{ op: 'dock', id: 'quotes' }]), at(`${ULTRA2}/ultra/stream`));
  const L = w.store.local;
  assert.deepEqual(S.docked(L[keys[0]]).map((x) => x.id), ['todo', 'notes']);
  assert.deepEqual(S.docked(L[keys[1]]).map((x) => x.id), ['todo', 'timer']); assert.equal(L[keys[1]].width, 300); assert.equal(L[keys[0]].width, 352);
  assert.equal(L[keys[2]].dest.todo, 'off'); assert.ok(!L[keys[2]].dest.notes);
  assert.equal(L[uKey(ULTRA, '_1_1')].todoScope, 'all'); assert.equal(L[uKey(ULTRA2, '_1_1')].todoScope, 'follow');
  assert.ok(!L[uKey(ULTRA, '_1_1')].dest.quotes);
});

test('sidebar writes match the authenticated account in the exact sending document, including sign-out', async () => {
  const w = worker();
  for (const [sender, key, origin, uid] of [[CP, cKey(), CANVAS, '42'], [UP, uKey(), ULTRA, '_9_1']]) {
    const doc = { ...sender, documentId: `doc-${uid}` };
    const other = origin === CANVAS ? cKey(CANVAS, '99') : uKey(ULTRA, '_99_1');
    const before = structuredClone(w.store.local);
    assert.deepEqual(await w.send(sb(other, [{ op: 'width', px: 410 }]), doc), { ok: false, error: 'sender' });
    assert.deepEqual(w.store.local, before, 'another account must not even be migrated');
    assert.equal((await w.send(sb(key, [{ op: 'width', px: 410 }]), doc)).ok, true);
    assert.deepEqual(w.probes.at(-1), { tabId: doc.tab.id, documentIds: [doc.documentId] });
    w.accounts[origin] = null;
    assert.deepEqual(await w.send(sb(key, [{ op: 'width', px: 450 }]), doc), { ok: false, error: 'sender' }, 'signed out');
    assert.equal(w.store.local[key].width, 410);
    w.accounts[origin] = uid;
  }
  const doc = { ...CP, documentId: 'replaced' };
  const pending = w.send(sb(cKey(), [{ op: 'width', px: 470 }]), doc);
  w.pages.delete(doc.documentId);
  assert.deepEqual(await pending, { ok: false, error: 'sender' }, 'the document no longer exists');
  assert.equal(w.store.local[cKey()].width, 410);
});

test("two tabs' changes to different fields both survive, in the queue's order", async () => {
  const w = worker();
  w.slow.get = 3;
  const a = w.send(sb(cKey(), [{ op: 'dock', id: 'notes' }, { op: 'fold', id: 'notes', v: true }]), CP);
  const b = w.send(sb(cKey(), [{ op: 'width', px: 420 }, { op: 'dock', id: 'timer' }]), at(`${CANVAS}/`));
  const c = w.send(sb(cKey(), [{ op: 'section', family: 'grades', part: 'page', v: true }]), CP);
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.ok(ra.ok && rb.ok && rc.ok);
  const r = w.store.local[cKey()];
  assert.deepEqual(S.docked(r).map((x) => [x.id, !!x.fold]), [['todo', false], ['notes', true], ['timer', false]]);
  assert.equal(r.width, 420); assert.deepEqual(r.fold, { grades: { page: true } });
  assert.deepEqual([ra.rec.rev, rb.rec.rev, rc.rec.rev], [1, 2, 3], 'each answer is what was stored after it');
});

test('changes to the same field land in queue order; a removal and a late resize leave it removed', async () => {
  const w = worker();
  await w.send(sb(cKey(), [{ op: 'dock', id: 'notes' }]), CP);
  w.slow.get = 2;
  const r = await Promise.all([
    w.send(sb(cKey(), [{ op: 'width', px: 300 }]), CP), w.send(sb(cKey(), [{ op: 'width', px: 450 }]), CP),
    w.send(sb(cKey(), [{ op: 'remove', id: 'notes' }]), CP), w.send(sb(cKey(), [{ op: 'height', id: 'notes', h: 500 }]), CP),
  ]);
  assert.ok(r.every((x) => x.ok));
  const rec = w.store.local[cKey()];
  assert.equal(rec.width, 450); assert.equal(rec.dest.notes, 'off');
  assert.deepEqual(rec.dock.find((x) => x.id === 'notes'), { id: 'notes', gone: true });
  assert.deepEqual(S.docked(rec).map((x) => x.id), ['todo']);
});

test('a failed write answers ok: false and leaves the stored record as it was; the next one works', async () => {
  const w = worker();
  await w.send(sb(cKey(), [{ op: 'dock', id: 'notes' }]), CP);
  const kept = structuredClone(w.store.local[cKey()]);
  w.fail.set = 1;
  assert.deepEqual(await w.send(sb(cKey(), [{ op: 'remove', id: 'notes' }]), CP), { ok: false, error: 'write' });
  assert.deepEqual(w.store.local[cKey()], kept);
  const again = await w.send(sb(cKey(), [{ op: 'remove', id: 'notes' }]), CP);
  assert.equal(again.ok, true); assert.equal(again.rec.rev, kept.rev + 1);
  // A first migration that cannot be written leaves the account unmigrated, so placement doesn't change yet.
  const f = worker();
  f.fail.set = 1;
  assert.equal((await f.send(sb(cKey(), [{ op: 'migrate' }]), CP)).ok, false);
  assert.ok(!(cKey() in f.store.local));
});

test('migration happens once, in the queue, against the layout stored then, before any other change; the layout is untouched', async () => {
  const lay = W.apply(W.layout(), { ops: [{ s: 'cdash', id: 'notes', set: { on: true, x: 10, y: 10 } }] });
  const w = worker({ local: { widgetLayout: lay } });
  const first = await w.send(sb(cKey(), [{ op: 'migrate' }]), CP);
  assert.equal(first.rec.mig, 1); assert.deepEqual(S.docked(first.rec).map((x) => x.id), ['todo']);
  assert.deepEqual(first.rec.ret.todo, { to: 'board', board: 'cdash' });
  const again = await w.send(sb(cKey(), [{ op: 'migrate' }]), CP);
  assert.deepEqual(again, first, 'repeated: nothing written');
  assert.deepEqual(w.store.local.widgetLayout, lay);
  // A first change that isn't the migration still migrates first, so the student's change is applied after it.
  const v = worker({ local: { widgetLayout: lay } });
  const r = await v.send(sb(cKey(), [{ op: 'remove', id: 'todo' }]), CP);
  assert.equal(r.rec.mig, 1); assert.equal(r.rec.dest.todo, 'off');
  assert.equal((await v.send(sb(cKey(), [{ op: 'migrate' }]), CP)).rec.dest.todo, 'off', 'a later migrate cannot bring it back');
  // With Better To Do off, nothing moves.
  const off = worker({ local: { widgetLayout: lay } });
  off.store.sync.enhance.todo = false;
  const o = await off.send(sb(cKey(), [{ op: 'migrate' }]), CP);
  assert.equal(o.rec.mig, 1); assert.deepEqual(o.rec.dest, {});
  // Ultra boards that disagree: offered, not moved.
  const split = W.apply(W.layout(), { ops: [{ s: 'dash', id: 'todo', set: { on: false } }] });
  const u = worker({ local: { widgetLayout: split } });
  const ur = await u.send(sb(uKey(), [{ op: 'migrate' }]), UP);
  assert.deepEqual(ur.rec.offer, { todo: 'pending' }); assert.deepEqual(ur.rec.dest, {});
});

test('a new install marks its layout fresh, an update does not, and the mark gives To Do in the dock', async () => {
  const fresh = worker();
  fresh.installed[0]({ reason: 'install' }); await settle();
  assert.equal(fresh.store.local.widgetLayout.sidebarFresh, true);
  fresh.installed[0]({ reason: 'update' }); await settle();
  assert.equal(fresh.store.local.widgetLayout.sidebarFresh, true, 'kept by later updates');
  const r = await fresh.send(sb(uKey(), [{ op: 'migrate' }]), UP);
  assert.deepEqual(S.docked(r.rec).map((x) => x.id), ['todo']);
  // A layout change keeps the mark (lib/widgets.js layout passes it through).
  await fresh.send({ type: 'glaze:widgetLayout', ops: [{ s: 'cdash', id: 'notes', set: { on: true } }] }, CP);
  assert.equal(fresh.store.local.widgetLayout.sidebarFresh, true);
  const old = worker();
  old.installed[0]({ reason: 'update' }); await settle();
  assert.ok(!('sidebarFresh' in old.store.local.widgetLayout));
});
