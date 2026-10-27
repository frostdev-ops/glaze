// The draft backup as a student meets it (ACA-4, ACA-6): content.js's draft hooks, lib/drafts.js and features/drafts.js
// running together in a VM on a stand-in page, over one in-memory storage.local that a later "page" shares with an earlier
// one, as a reload or a second sign-in on the same browser profile would. Time is the test's: nothing waits.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El, matches } = require('./stand-in-dom.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const source = read('content.js');
const block = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a > 0 && b > a, `markers ${from} … ${to}`); return source.slice(a, b); };
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };

const ORIGIN = 'https://bb.school.test';
const POST = '/ultra/courses/_5_1/outline/discussion/_9_1';
const FIRST = 'My first attempt at this reply, long enough to keep.';
const SECOND = 'A second attempt, also long enough to be worth keeping.';
const T0 = Date.UTC(2026, 9, 20, 12);

// The worker (lib/background.js) the pages over one storage share, on the test's clock: what they send it ('glaze:drafts')
// runs in its one queue, against that storage.
const workers = new WeakMap();
let tabs = 0;
const workerFor = (store, clock) => {
  if (workers.has(store)) return workers.get(store);
  const listeners = [];
  const area = (s) => ({
    get: async (k) => (k == null ? structuredClone(s) : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, structuredClone(s[x])]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); }, remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  class Clock extends Date { static now() { return clock.now; } constructor(...a) { super(...(a.length ? a : [clock.now])); } }
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, structuredClone, Promise, Date: Clock, setTimeout, clearTimeout, crypto: globalThis.crypto, atob, btoa, navigator: {},
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(store), sync: area({}), onChanged: { addListener() {} } },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (m, sender, cb) => {
    for (const f of listeners) if (f(structuredClone(m), sender, (r) => cb?.(r === undefined ? r : structuredClone(r))) === true) return;
    Promise.resolve().then(() => cb?.());
  };
  workers.set(store, send);
  return send;
};

// A page: site, who is signed in (user), and the storage it shares. clock: { now } shared between pages so time runs on.
const page = async ({ site = 'ultra', user = site === 'ultra' ? '_7_1' : '7', origin = ORIGIN, store = {}, clock = { now: T0 }, pathname, posted = '', session = new Map() } = {}) => {
  const ultra = site === 'ultra';
  // The student approved the site (storage.local `ultra` by origin, `canvas` by pattern), as the worker checks.
  const approved = (store[site] ||= []), pattern = ultra ? origin : `${origin}/*`;
  if (!approved.includes(pattern)) approved.push(pattern);
  const worker = workerFor(store, clock);
  const tab = { id: ++tabs };
  const doc = { activeElement: null };
  const listeners = {};
  const fire = (type, e) => { for (const f of listeners[type] || []) f(e); };
  class Elx extends El {
    constructor(tag) { super(tag, doc); }
    matches(sel) { return matches(this, sel); }
    get attributes() { return [...(this.id ? [{ name: 'id', value: this.id }] : []), ...Object.entries(this.dataset).map(([k, v]) => ({ name: `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value: v })) ]; }
    // An event on an element reaches the document's listeners, as it bubbles there.
    dispatchEvent(ev) { super.dispatchEvent(ev); fire(ev.type, Object.assign(Object.create(ev), { target: this })); return true; }
  }
  const body = new Elx('body');
  doc.root = body;
  // Timers run by the test, in the order they fall due.
  const timers = [];
  let seq = 0;
  const advance = async (ms) => {
    const end = clock.now + ms;
    for (;;) {
      await settle();
      const next = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      timers.splice(timers.indexOf(next), 1);
      clock.now = Math.max(clock.now, next.at);
      next.f();
    }
    clock.now = end;
    await settle();
  };
  class Clock extends Date { static now() { return clock.now; } constructor(...a) { super(...(a.length ? a : [clock.now])); } }
  const area = {
    get: (k, cb) => { const r = k === null ? { ...store } : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, structuredClone(store[x])])); Promise.resolve().then(() => cb(r)); },
    set: (o, cb) => { Object.assign(store, structuredClone(o)); cb?.(); },
    remove: (k, cb) => { for (const x of [].concat(k)) delete store[x]; cb?.(); },
  };
  const ctx = vm.createContext({
    ultra, observer: {}, solo: true, tabFrame: '', settings: { enabled: true, enhance: { drafts: true } }, Element: El, HTMLTextAreaElement: El, Event: class { constructor(type) { this.type = type; } },
    location: { origin, pathname: pathname || (ultra ? POST : '/conversations') },
    document: {
      addEventListener: (type, f) => { (listeners[type] ||= []).push(f); },
      get activeElement() { return doc.activeElement; }, body,
      createElement: (tag) => new Elx(tag), createRange: () => ({ selectNodeContents() {} }),
      querySelector: (sel) => body.querySelector(sel), querySelectorAll: (sel) => body.querySelectorAll(sel),
      // The page's text, walked as the browser does: a subtree the filter rejects (2) is left out, one it skips (3) is walked.
      createTreeWalker: (root, _, { acceptNode }) => {
        const nodes = [];
        const walk = (el) => {
          if (el._html) { nodes.push({ nodeType: 3, data: el.textContent }); return; }
          for (const k of el.children) if (!(k instanceof El)) nodes.push({ nodeType: 3, data: k.textContent }); else if (acceptNode(k) !== 2) walk(k);
        };
        walk(root);
        return { nextNode: () => nodes.shift() || null };
      },
      // The browser's own editing: what Restore types in lands in the focused editor, and the page hears an input.
      execCommand: (cmd, _, html) => { const ed = doc.activeElement; ed.innerHTML = html; ed.dispatchEvent({ type: 'input' }); return true; },
    },
    sessionStorage: { get length() { return session.size; }, key: (i) => [...session.keys()][i], getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, v), removeItem: (k) => session.delete(k) },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 }, getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    chrome: { runtime: { id: 'glaze', sendMessage: (m, cb) => {
      const url = `${ctx.location.origin}${ctx.location.pathname}`;
      worker(m, { id: 'glaze', tab: { ...tab, url }, frameId: 0, url }, cb);
    } }, storage: { local: area } },
    GZ_PAGE: { describe: () => ({ rel: 'a moment ago' }) },
    setTimeout: (f, ms = 0) => { timers.push({ f, at: clock.now + ms, id: ++seq }); return seq; },
    clearTimeout: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    addEventListener() {}, Date: Clock, Promise, window: {}, globalThis: null,
    need: async (file, ready) => { if (!ready()) vm.runInContext(read(file), ctx); },
  });
  ctx.globalThis = ctx;
  ctx.window.top = ctx.window;
  vm.runInContext(`${block('  // ---- draft backup (Extras)', '  // ---- download all (Extras)')}
    globalThis.api = { watchDrafts, local, draftAt, DRAFT_ED, tidyDrafts };`, ctx);
  const flags = { failAccount: false }; // the account can't be asked for
  ctx.GZ_CTX = {
    site, t: (k, v) => String(k).replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', settings: () => ctx.settings, on: () => !!ctx.observer, local: ctx.api.local,
    draftEditor: ctx.api.DRAFT_ED, draftAt: ctx.api.draftAt,
    account: () => (flags.failAccount ? Promise.reject(new Error('offline')) : Promise.resolve(user)),
    profile: () => (flags.failAccount ? Promise.reject(new Error('offline')) : Promise.resolve({ id: Number(user) })), canvasCourses: () => Promise.resolve([{ id: 5, name: 'BIO 1100' }]),
    capi: () => Promise.reject(new Error('offline')),
  };

  // The editor: Ultra's Quill body in a post's wrapper, or Canvas's Inbox compose with its subject and recipient.
  let ed;
  if (ultra) {
    const wrap = new Elx('div');
    wrap.dataset.postId = 'post_12_3';
    ed = new Elx('div');
    Object.assign(ed, { id: 'ed1', className: 'ql-editor' });
    ed.setAttribute('contenteditable', 'true');
    wrap.append(ed);
    body.append(wrap);
  } else {
    const modal = new Elx('div');
    modal.id = 'compose-message-modal';
    const input = (testid, value) => { const e = new Elx('input'); e.setAttribute('data-testid', testid); e.value = value; return e; };
    const to = new Elx('span');
    to.setAttribute('data-testid', 'address-book-tag');
    to.id = 'address-book-label-2-user';
    ed = new Elx('textarea');
    ed.setAttribute('data-testid', 'message-body');
    ed.value = '';
    modal.append(input('subject-input', 'Lab question'), input('course-select-modal', 'BIO 1100'), to, ed);
    body.append(modal);
  }
  // What else the page shows: a sent post, say, as a block of its own.
  const show = (v) => { const p = new Elx('div'); p.append(v); body.append(p); return p; };
  if (posted) show(posted);
  const text = () => (ultra ? ed.textContent : ed.value);
  const set = (v) => { if (ultra) ed.innerHTML = v ? `<p>${v}</p>` : ''; else ed.value = v; };
  const bars = () => body.querySelectorAll('.gz-draft');
  const shown = () => bars().filter((b) => !b.hidden);
  const press = (b, label) => b.all().find((e) => e.tagName === 'BUTTON' && e.textContent === label).dispatchEvent({ type: 'click' });
  return {
    store, ed, bars, shown, advance, text, press, ctx, doc, flags, show,
    // A mutation pass, as content.js's observer runs it.
    pass: async () => { ctx.api.watchDrafts(); await settle(); },
    // The student writes (all of it at once, as a paste is): the keys and input, then a second's quiet.
    write: async (v, wait = 1000) => { set(v); ed.focus(); for (const type of ultra ? ['keydown', 'input'] : ['input']) fire(type, { type, target: ed }); await settle(); await advance(wait); },
    // The student sends it (Ultra): a click on Post beside the editor, or Ctrl+Enter in it (keys); trusted: false is a script's click.
    submit: async (how = 'click', trusted = true) => {
      if (how === 'keys') fire('keydown', { type: 'keydown', key: 'Enter', ctrlKey: true, isTrusted: trusted, target: ed });
      else {
        let b = ed.parentNode.querySelector('button');
        if (!b) { b = new Elx('button'); b.append('Post'); ed.parentNode.append(b); }
        b.dispatchEvent({ type: 'click', isTrusted: trusted });
      }
      await settle();
    },
    // The page, opened on an empty editor and left for the offer to appear: the observer's passes come as the page changes.
    open: async () => { for (const wait of [0, 100, 900, 1000]) { ctx.api.watchDrafts(); await advance(wait); } },
    keys: () => Object.keys(store).filter((k) => k.startsWith('draft:')),
  };
};

// What a stored record holds, newest first, whether it keeps older copies beside it (`prev`) or not.
const texts = (rec) => (rec ? [rec.text, ...(rec.prev || []).map((c) => c.text)] : []);
const all = (store) => Object.values(store).filter((v) => v && typeof v === 'object' && 'text' in v).flatMap(texts);

for (const site of ['ultra', 'canvas']) for (const fault of ['lastError', 'throw']) {
  test(`${site}: a failed storage read (${fault}) cannot replace an unread recovery copy`, async () => {
    const store = {}, clock = { now: T0 };
    const first = await page({ site, store, clock });
    await first.open(); await first.write(FIRST);
    const p = await page({ site, store, clock });
    const area = p.ctx.chrome.storage.local, get = area.get;
    area.get = (key, cb) => {
      if (fault === 'throw') throw new Error('read failed');
      p.ctx.chrome.runtime.lastError = { message: 'read failed' }; cb(undefined); delete p.ctx.chrome.runtime.lastError;
    };
    await p.write(SECOND);
    assert.deepEqual(all(store).sort(), [FIRST, SECOND].sort(), 'unread means preserved, and this page\'s own is kept beside it');
    area.get = get;
    await p.write(SECOND);
    assert.deepEqual(all(store).sort(), [FIRST, SECOND].sort(), 'a later successful read changes nothing');
  });
}

test('Ultra: an old recovery bar cannot restore into an editor reused for another post', async () => {
  const store = {}, clock = { now: T0 };
  const first = await page({ store, clock });
  await first.open(); await first.write(FIRST);
  const p = await page({ store, clock });
  await p.open();
  const bar = p.shown()[0];
  p.ctx.location.pathname = '/ultra/courses/_5_1/outline/discussion/_99_1';
  p.press(bar, 'Restore');
  await p.advance(1500);
  assert.equal(p.text(), '', 'the old post is not inserted into the new post');
  assert.deepEqual(all(store), [FIRST]);
});

test('Ultra: an account response without a valid user id never becomes a shared draft identity', async () => {
  for (const user of [undefined, null, '', 'undefined', '[object Object]']) {
    const p = await page();
    p.ctx.GZ_CTX.account = () => Promise.resolve(user);
    await p.write(FIRST);
    assert.deepEqual(all(p.store), [], `invalid identity ${String(user)}`);
  }
});

test('Ultra: turning backup off cancels a pending debounce before it can be enabled again', async () => {
  const p = await page();
  await p.open(); await p.write(FIRST, 100);
  p.ctx.settings.enhance.drafts = false;
  p.ctx.GZ_DRAFT_UI.drop(true);
  p.ctx.settings.enhance.drafts = true;
  await p.advance(1500);
  assert.deepEqual(all(p.store), [], 'old pending input does not return after backup was cleared');
});

test('Ultra: a storage read arriving after backup was cleared cannot resurrect its recovery offer', async () => {
  const store = {}, clock = { now: T0 };
  const first = await page({ store, clock });
  await first.open(); await first.write(FIRST);
  const p = await page({ store, clock });
  const area = p.ctx.chrome.storage.local, get = area.get;
  let finish;
  area.get = (key, cb) => { const r = structuredClone(store); finish = () => cb(r); };
  await p.pass();
  assert.equal(typeof finish, 'function');
  p.ctx.settings.enhance.drafts = false;
  p.ctx.GZ_DRAFT_UI.drop(true);
  for (const key of p.keys()) delete store[key];
  p.ctx.settings.enhance.drafts = true;
  area.get = get;
  finish();
  await p.advance(1500); await p.pass(); await p.advance(1500);
  assert.equal(p.shown().length, 0, 'no old copy on offer after the clear');
});

test('Ultra: a pending input survives reuse of its editor before the debounce', async () => {
  const p = await page();
  await p.open();
  await p.write(FIRST, 100);
  p.ctx.location.pathname = '/ultra/courses/_5_1/outline/discussion/_99_1';
  p.ed.innerHTML = '';
  await p.advance(1500);
  assert.deepEqual(all(p.store), [FIRST]);
  assert.ok(p.keys()[0].includes(POST), 'kept under the original post');
});

// ---- what has always worked: a copy kept, offered on the next page, restored or dismissed ----------------------------
for (const site of ['ultra', 'canvas']) {
  test(`${site}: what is written is kept, offered back on the next page, and Restore types it in`, async () => {
    const store = {}, clock = { now: T0 };
    const first = await page({ site, store, clock });
    await first.open();
    await first.write(FIRST);
    assert.deepEqual(all(store), [FIRST]);
    const next = await page({ site, store, clock });
    await next.open();
    assert.equal(next.shown().length, 1, 'offered');
    next.press(next.shown()[0], 'Restore');
    await next.advance(1500);
    assert.equal(next.text(), FIRST);
    assert.deepEqual(all(store), [FIRST], 'still kept, now as this page\'s own');
  });

  test(`${site}: Dismiss takes the copy away for good, and a copy that was posted is not offered`, async () => {
    const store = {}, clock = { now: T0 };
    const first = await page({ site, store, clock });
    await first.open();
    await first.write(FIRST);
    const next = await page({ site, store, clock });
    await next.open();
    next.press(next.shown()[0], 'Dismiss');
    await next.advance(500);
    assert.deepEqual(all(store), []);
    assert.equal(next.bars().length, 0);
    if (site === 'ultra') {
      await first.write(FIRST);
      await first.submit();
      first.ed.remove();
      first.show(`Reply ${FIRST} Like`);
      await first.pass();
      const again = await page({ site, store, clock, posted: `Reply ${FIRST} Like` });
      await again.open();
      assert.equal(again.bars().length, 0, 'it shows on the page already: not offered');
      assert.deepEqual(all(store), [], 'and gone');
    }
  });
}

// ---- ACA-4: whose copy it is -----------------------------------------------------------------------------------
test('Ultra: a copy one account kept is not offered to another account on the same browser profile', async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ store, clock, user: '_7_1' });
  await a.open();
  await a.write(FIRST);
  assert.deepEqual(all(store), [FIRST], 'kept for the one who wrote it');
  // A timed-out session; another student signs in and opens the same discussion.
  const b = await page({ store, clock, user: '_8_1' });
  await b.open();
  assert.equal(b.bars().length, 0, 'not offered A\'s reply to B');
  // And A, back again, is offered it.
  const again = await page({ store, clock, user: '_7_1' });
  await again.open();
  assert.equal(again.shown().length, 1, 'offered to A');
  assert.match(again.shown()[0].textContent, /Glaze kept a copy of what you wrote here/);
});

test('Ultra: the same user id and page on another school\'s Blackboard is another account', async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ store, clock, origin: 'https://one.school.test' });
  await a.open();
  await a.write(FIRST);
  const b = await page({ store, clock, origin: 'https://two.school.test' });
  await b.open();
  assert.equal(b.bars().length, 0);
  const keys = a.keys();
  await b.write(SECOND);
  assert.equal(b.keys().length, keys.length + 1, 'each school has its own copy of its own');
});

test('Ultra: what a signed-out account kept stays its own: the other account\'s typing does not replace it', async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ store, clock, user: '_7_1' });
  await a.open();
  await a.write(FIRST);
  const b = await page({ store, clock, user: '_8_1' });
  await b.open();
  await b.write(SECOND);
  assert.ok(all(store).includes(FIRST), 'A\'s copy is still there');
  assert.ok(all(store).includes(SECOND));
});

// ---- ACA-6: a copy this page didn't write ---------------------------------------------------------------------
// The first copy is kept by a page that then goes (a crash, a timed-out session): to the next page it is not its own.
const crashed = async (site, store, clock) => {
  const first = await page({ site, store, clock });
  await first.open();
  await first.write(FIRST);
  assert.deepEqual(all(store), [FIRST]);
};

test('Ultra: typing before the offer shows does not replace the copy kept before', async () => {
  const store = {}, clock = { now: T0 };
  await crashed('ultra', store, clock);
  const p = await page({ store, clock });
  await p.pass();
  await p.write(SECOND); // straight away, before the offer's 800 ms
  assert.deepEqual(all(store).sort(), [FIRST, SECOND].sort(), 'both kept');
});

test('Ultra: short text typed over the offered copy leaves it alone, and clearing it brings the offer back', async () => {
  const store = {}, clock = { now: T0 };
  await crashed('ultra', store, clock);
  const p = await page({ store, clock });
  await p.pass();
  await p.write('ok');
  assert.deepEqual(all(store), [FIRST]);
  await p.write(SECOND);
  await p.write('');
  assert.deepEqual(all(store), [FIRST], 'the typing cleared away is gone; what was kept before is not');
  await p.pass();
  await p.advance(2000);
  assert.equal(p.shown().length, 1, 'offered once the editor is empty');
});

test('Ultra: Restore puts the copy kept before back, Dismiss takes it away, and neither loses what is typed after', async () => {
  const store = {}, clock = { now: T0 };
  await crashed('ultra', store, clock);
  const p = await page({ store, clock });
  await p.pass();
  await p.write(SECOND);
  await p.write('');
  await p.pass();
  await p.advance(2000);
  p.press(p.shown()[0], 'Restore');
  await p.advance(1500);
  assert.equal(p.text(), FIRST, 'typed back in');
  assert.deepEqual(all(store), [FIRST], 'one copy, now this page\'s own');
  // Another round, dismissed this time.
  const q = await page({ store, clock });
  await q.pass();
  await q.write(SECOND);
  await q.write('');
  await q.pass();
  await q.advance(2000);
  q.press(q.shown()[0], 'Dismiss');
  await q.advance(500);
  assert.deepEqual(all(store), [], 'dismissed: gone');
  await q.write(SECOND);
  assert.deepEqual(all(store), [SECOND], 'and typing is kept as ever');
});

test('Canvas: short text typed over the offered copy no longer deletes it, and long text keeps it beside the new', async () => {
  const store = {}, clock = { now: T0 };
  await crashed('canvas', store, clock);
  const p = await page({ site: 'canvas', store, clock });
  await p.write('ok');
  assert.deepEqual(all(store), [FIRST], 'not deleted');
  await p.write(SECOND);
  assert.deepEqual(all(store).sort(), [FIRST, SECOND].sort(), 'both kept');
});

test('Canvas: the offer is hidden while there is text and comes back when it is cleared, rather than being removed for good', async () => {
  const store = {}, clock = { now: T0 };
  await crashed('canvas', store, clock);
  const p = await page({ site: 'canvas', store, clock });
  await p.pass();
  await p.advance(2000);
  assert.equal(p.shown().length, 1, 'offered');
  await p.write('typing');
  assert.equal(p.bars().length, 1, 'still there');
  assert.equal(p.shown().length, 0, 'out of the way while there is text');
  await p.write('');
  await p.pass();
  assert.equal(p.shown().length, 1, 'back when the compose is empty');
  p.press(p.shown()[0], 'Restore');
  await p.advance(1500);
  assert.equal(p.text(), FIRST);
});

test('Canvas: typing before the offer shows, then clearing it, offers the copy kept before', async () => {
  const store = {}, clock = { now: T0 };
  await crashed('canvas', store, clock);
  const p = await page({ site: 'canvas', store, clock });
  await p.write(SECOND, 100); // within the offer's 800 ms
  await p.advance(1500);
  assert.equal(p.shown().length, 0, 'nothing in the way of the typing');
  await p.write('');
  await p.pass();
  await p.advance(2000);
  assert.equal(p.shown().length, 1);
  assert.deepEqual(all(store), [FIRST]);
});

// ---- more of the same -------------------------------------------------------------------------------------------
test('Canvas: a copy from another account on the same profile is not offered', async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ site: 'canvas', store, clock, user: '7' });
  await a.open();
  await a.write(FIRST);
  const b = await page({ site: 'canvas', store, clock, user: '8' });
  await b.open();
  assert.equal(b.bars().length, 0);
});

test('Canvas: short text typed and cleared again brings the offer back, with the copy kept all along', async () => {
  const store = {}, clock = { now: T0 };
  await crashed('canvas', store, clock);
  const p = await page({ site: 'canvas', store, clock });
  await p.write('ok', 100);
  await p.write('');
  await p.pass();
  await p.advance(2000);
  assert.equal(p.shown().length, 1);
  assert.deepEqual(all(store), [FIRST]);
});

test('Ultra: copies from several unfinished visits are kept beside each other, newest offered first, three at most', async () => {
  const store = {}, clock = { now: T0 };
  const texts3 = ['Visit one: the first reply, long enough to keep.', 'Visit two: the second reply, long enough to keep.', 'Visit three: the third reply, long enough to keep.'];
  for (const text of texts3) {
    const p = await page({ store, clock });
    await p.pass();
    await p.write(text);
    clock.now += 60000;
  }
  assert.deepEqual(all(store), [...texts3].reverse(), 'all three, newest first');
  const p = await page({ store, clock });
  await p.open();
  assert.match(p.shown()[0].textContent, /kept a copy/);
  p.press(p.shown()[0], 'Restore');
  await p.advance(1500);
  assert.equal(p.text(), texts3[2], 'the newest comes back first');
  assert.deepEqual(all(store), [...texts3].reverse(), 'and the older two are still kept beside it');
  await p.write('');
  await p.pass();
  await p.advance(2000);
  p.press(p.shown()[0], 'Dismiss');
  await p.advance(2000);
  assert.deepEqual(all(store), [texts3[0]], 'dismissing one offers the next, and leaves it kept');
  assert.equal(p.shown().length, 1, 'which is on offer now');
  // More unfinished visits make room by letting the oldest go.
  const later = ['Visit four: the fourth reply, long enough to keep.', 'Visit five: the fifth reply, long enough to keep.', 'Visit six: the sixth reply, long enough to keep.'];
  for (const text of later) {
    const q = await page({ store, clock });
    await q.pass();
    await q.write(text);
    clock.now += 60000;
  }
  assert.deepEqual(all(store), [later[2], later[1], later[0]], 'three at most, the oldest let go');
});

test('Ultra: a copy older than 14 days is not offered, and does not ride along beside new text', async () => {
  const store = {}, clock = { now: T0 };
  await crashed('ultra', store, clock);
  clock.now += 15 * 864e5;
  const p = await page({ store, clock });
  await p.open();
  assert.equal(p.bars().length, 0);
  await p.write(SECOND);
  assert.deepEqual(all(store), [SECOND]);
});

test('Ultra: the sweep takes a copy kept under the old path-only key, and leaves one under the new key', async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ store, clock });
  await a.open();
  await a.write(FIRST);
  const legacy = `draft:${POST}#_12_3/ed1`; // as the earlier version kept it: no site, no account
  store[legacy] = { html: `<p>${SECOND}</p>`, text: SECOND, at: clock.now };
  const p = await page({ store, clock });
  p.ctx.api.tidyDrafts();
  await p.advance(500);
  assert.equal(legacy in store, false, 'swept');
  assert.deepEqual(all(store), [FIRST], 'the account\'s own stays');
  await p.open();
  assert.equal(p.shown().length, 1);
  assert.match(p.shown()[0].textContent, /kept a copy/);
});

test('Ultra: with the account not known yet, what is written waits for it and is kept under it; an account that cannot be asked for keeps nothing', async () => {
  const store = {}, clock = { now: T0 };
  const p = await page({ store, clock });
  p.flags.failAccount = true;
  await p.write(FIRST);
  assert.deepEqual(all(store), [], 'nothing kept under nobody');
  p.flags.failAccount = false;
  await p.advance(61000); // the retry
  await p.pass();
  await p.advance(1500);
  assert.deepEqual(all(store), [FIRST], 'kept once it is known');
  assert.ok(p.keys().every((k) => k.includes('_7_1')), 'under the account');
});

// ---- the same destination open in more than one tab: each tab's copy is its own ------------------------------------
// Each tab's change is applied to what is stored when the worker's turn comes ('glaze:drafts'), not to what the tab read.
const sorted = (a) => [...a].sort();
const OLDER = 'An older copy, from a visit that crashed, long enough to keep.';
for (const site of ['ultra', 'canvas']) {
  test(`${site}: two tabs on the same destination each keep their own copy`, async () => {
    const store = {}, clock = { now: T0 };
    const a = await page({ site, store, clock });
    const b = await page({ site, store, clock });
    await a.open(); await b.open();
    await a.write(FIRST);
    await b.write(SECOND);
    assert.deepEqual(sorted(all(store)), sorted([FIRST, SECOND]));
  });

  test(`${site}: edits interleaved between two tabs replace only each tab's own copy`, async () => {
    const store = {}, clock = { now: T0 };
    const a = await page({ site, store, clock });
    const b = await page({ site, store, clock });
    await a.open(); await b.open();
    await a.write(FIRST);
    await b.write(SECOND);
    await a.write(`${FIRST} And more.`);
    await b.write(`${SECOND} And more.`);
    assert.deepEqual(sorted(all(store)), sorted([`${FIRST} And more.`, `${SECOND} And more.`]), 'one copy a tab, its latest');
    await a.write('');
    assert.deepEqual(all(store), [`${SECOND} And more.`], 'clearing one tab takes its own copy only');
  });

  test(`${site}: a tab whose read of what is stored arrives late keeps the other tab's copy, and offers it once empty`, async () => {
    const store = {}, clock = { now: T0 };
    const a = await page({ site, store, clock });
    const b = await page({ site, store, clock });
    const area = b.ctx.chrome.storage.local, get = area.get, late = [];
    area.get = (k, cb) => get(k, (r) => late.push(() => cb(r)));
    await a.open(); await b.open();
    await a.write(FIRST);
    await b.write(SECOND);
    assert.ok(late.length, 'b read before a wrote, and has no answer yet');
    area.get = get;
    for (const f of late.splice(0)) f();
    await b.advance(1500);
    assert.deepEqual(sorted(all(store)), sorted([FIRST, SECOND]));
    await b.write('');
    assert.deepEqual(all(store), [FIRST]);
    await b.pass();
    await b.advance(2000);
    assert.equal(b.shown().length, 1, 'a\'s copy is offered in b once its editor is empty');
  });

  test(`${site}: Dismiss in one tab takes only the copy it offered, not one another tab kept since`, async () => {
    const store = {}, clock = { now: T0 };
    const crashed = await page({ site, store, clock });
    await crashed.write(OLDER);
    clock.now += 60000;
    const b = await page({ site, store, clock });
    await b.open();
    assert.equal(b.shown().length, 1, 'the older copy is offered');
    const a = await page({ site, store, clock });
    await a.write(FIRST);
    b.press(b.shown()[0], 'Dismiss');
    await b.advance(500);
    assert.deepEqual(all(store), [FIRST], 'the dismissed copy goes, the other tab\'s stays');
  });

  test(`${site}: only a confirmed send takes its own copy`, async () => {
    const store = {}, clock = { now: T0 };
    const a = await page({ site, store, clock });
    const b = await page({ site, store, clock });
    // Canvas says it was sent: the sent conversation, by this student, to this destination, with this body.
    const at = () => new Date(clock.now).toISOString();
    b.ctx.GZ_CTX.capi = (u) => Promise.resolve(u.startsWith('/conversations?') ? [{ id: 9, subject: 'Lab question', context_code: 'course_5', last_authored_message_at: at() }]
      : { subject: 'Lab question', context_code: 'course_5', participants: [{ id: '7' }, { id: '2' }], messages: [{ author_id: '7', body: SECOND, created_at: at() }] });
    await a.open(); await b.open();
    await a.write(FIRST);
    await b.write(SECOND);
    if (site === 'canvas') {
      const send = b.ctx.document.createElement('button');
      send.id = 'send-message-button';
      b.ed.parentNode.append(send);
      send.dispatchEvent({ type: 'click' });
      b.ed.parentNode.remove();
    } else {
      await b.submit();
      b.ed.remove();
      b.show(`Reply ${SECOND} Like`);
    }
    await b.pass();
    await b.advance(2000);
    assert.deepEqual(sorted(all(store)), [FIRST]);
  });

  test(`${site}: a reload keeps both tabs' copies and offers one back`, async () => {
    const store = {}, clock = { now: T0 };
    const a = await page({ site, store, clock });
    const b = await page({ site, store, clock });
    await a.open(); await b.open();
    await a.write(FIRST);
    await b.write(SECOND);
    const again = await page({ site, store, clock }); // a, reloaded
    await again.open();
    assert.equal(again.shown().length, 1, 'offered');
    assert.deepEqual(sorted(all(store)), sorted([FIRST, SECOND]));
    again.press(again.shown()[0], 'Restore');
    await again.advance(1500);
    assert.ok([FIRST, SECOND].includes(again.text()));
    assert.deepEqual(sorted(all(store)), sorted([FIRST, SECOND]), 'both still kept');
  });
}

test('Ultra: four tabs on one reply keep three copies, the newest; a tab that writes again is back, and rewriting takes no extra room', async () => {
  const store = {}, clock = { now: T0 };
  const text = (i) => `Tab ${i}: what this tab wrote, long enough to keep.`;
  const tabs4 = [];
  for (let i = 1; i <= 4; i++) { const p = await page({ store, clock }); await p.pass(); tabs4.push(p); }
  for (let i = 1; i <= 4; i++) { await tabs4[i - 1].write(text(i)); clock.now += 1000; }
  assert.deepEqual(all(store), [text(4), text(3), text(2)], 'three at most, newest first');
  await tabs4[0].write(`${text(1)} Again.`);
  assert.deepEqual(all(store), [`${text(1)} Again.`, text(4), text(3)]);
  clock.now += 1000;
  await tabs4[3].write(`${text(4)} Again.`);
  assert.deepEqual(all(store), [`${text(4)} Again.`, `${text(1)} Again.`, text(3)]);
});

// ---- posted: only all of what was written, shown on the page, says so -------------------------------------------
const QUOTE = 'A quoted assignment passage used to introduce a reply. '.repeat(12);
const LONG = 'My own analysis of the reading, a paragraph at a time. '.repeat(20);

test('Ultra: a reply that starts with a quoted introduction stays on a page that shows another reply with the same start', async () => {
  const store = {}, clock = { now: T0 };
  const draft = `${QUOTE}My original analysis that has never been posted.`;
  const a = await page({ store, clock }); await a.open(); await a.write(draft);
  const b = await page({ store, clock, posted: `${QUOTE}Someone else wrote a different analysis.` });
  await b.open();
  assert.deepEqual(all(store), [draft]);
  assert.equal(b.shown().length, 1, 'and is offered');
});

test('Ultra: a long post the page shows only the start of is no proof it went through: the copy stays', async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ store, clock });
  await a.open(); await a.write(LONG);
  a.ed.remove();
  a.show(`Reply ${LONG.slice(0, 700)}… Read more`);
  for (let i = 0; i < 4; i++) { await a.pass(); await a.advance(20000); }
  assert.deepEqual(all(store), [LONG]);
  const b = await page({ store, clock, posted: `${LONG.slice(0, 700)}… Read more` });
  await b.open();
  assert.equal(b.shown().length, 1, 'offered on the next page');
  assert.deepEqual(all(store), [LONG]);
});

for (const [what, draft] of [['a reply', LONG], ['a reply quoting the post it answers', `${QUOTE}My own reply to it.`]]) {
  test(`Ultra: a submit that fails keeps the copy of ${what}, while the editor waits and after it is left`, async () => {
    const store = {}, clock = { now: T0 };
    const a = await page({ store, clock });
    a.show(QUOTE); // the post being answered
    await a.open(); await a.write(draft);
    a.ed.setAttribute('contenteditable', 'false'); // sending: Ultra holds the editor
    await a.pass(); await a.advance(2000); await a.pass();
    assert.deepEqual(all(store), [draft], 'its own editor showing the text is no proof');
    a.ed.setAttribute('contenteditable', 'true'); // it failed: the editor is back as it was
    await a.pass();
    a.ed.remove(); // and the student leaves it
    for (let i = 0; i < 4; i++) { await a.pass(); await a.advance(20000); }
    assert.deepEqual(all(store), [draft]);
  });
}

test('Ultra: a reply whose whole text shows on the page went through: its copy goes and is not offered again', async () => {
  const store = {}, clock = { now: T0 };
  const draft = `${QUOTE}My own reply to it.`;
  const a = await page({ store, clock });
  a.show(QUOTE);
  await a.open(); await a.write(draft);
  await a.submit();
  a.ed.remove();
  await a.pass();
  assert.deepEqual(all(store), [draft], 'not yet on the page');
  a.show(`Reply\n  ${draft.replace(/\. /g, '.\n\n')}\n  Like`);
  await a.pass();
  assert.deepEqual(all(store), []);
  const b = await page({ store, clock, posted: draft });
  await b.open();
  assert.equal(b.shown().length, 0);
});

// The same whole text from someone else is no proof: only more of it than there was when the student sent theirs.
const AGREE = 'I agree with the interpretation in the assigned reading.';
const OTHER = `Another participant replied: ${AGREE}`;

test('Ultra: a reply sent with Ctrl+Enter, and then shown on the page, went through: its copy goes', async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ store, clock });
  await a.open(); await a.write(LONG);
  await a.submit('keys');
  a.ed.innerHTML = ''; // Ultra empties the editor it keeps
  a.show(`Reply ${LONG} Like`);
  await a.pass();
  assert.deepEqual(all(store), []);
});

test("Ultra: another participant's post with the same whole text is not this student's: the unsent copy stays and is offered", async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ store, clock });
  a.show(OTHER);
  await a.open(); await a.write(AGREE);
  const b = await page({ store, clock, posted: OTHER });
  await b.open();
  assert.deepEqual(all(store), [AGREE]);
  assert.equal(b.shown().length, 1, 'offered');
});

test('Ultra: a reply already on the page in another post, then sent and shown again, went through', async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ store, clock });
  a.show(OTHER);
  await a.open(); await a.write(AGREE);
  await a.submit();
  a.ed.remove();
  await a.pass();
  assert.deepEqual(all(store), [AGREE], 'only the other post shows it yet');
  a.show(`Reply ${AGREE} Like`);
  await a.pass();
  assert.deepEqual(all(store), []);
  const b = await page({ store, clock, posted: `${OTHER} Reply ${AGREE} Like` });
  await b.open();
  assert.equal(b.shown().length, 0);
});

for (const [what, leave] of [
  ['the editor is closed', (a) => a.ed.remove()],
  ['the student goes to another page', (a) => { a.ctx.location.pathname = '/ultra/courses/_5_1/outline'; a.ed.parentNode.remove(); }],
  ['a script clicks Post', async (a) => { await a.submit('click', false); await a.submit('keys', false); a.ed.remove(); }],
]) test(`Ultra: with no send by the student (${what}), a matching post showing up takes nothing`, async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ store, clock });
  a.show(OTHER);
  await a.open(); await a.write(AGREE);
  await leave(a);
  await a.pass();
  a.show(`Reply ${AGREE} Like`); // someone else's, just loaded
  for (let i = 0; i < 4; i++) { await a.pass(); await a.advance(20000); }
  assert.deepEqual(all(store), [AGREE]);
  const b = await page({ store, clock, posted: `${OTHER} Reply ${AGREE} Like` });
  await b.open();
  assert.equal(b.shown().length, 1, 'offered on the next page');
});

// Only a control that names sending it is a send: its aria-label, else its text, else its title. Blackboard's own labels,
// in each language Glaze speaks.
const control = (a, { text, label, title, type, icon, into } = {}) => {
  const b = a.ctx.document.createElement('button');
  if (icon) b.append(a.ctx.document.createElement('svg'));
  if (text) b.append(text);
  if (label) b.setAttribute('aria-label', label);
  if (title) b.setAttribute('title', title);
  if (type) b.setAttribute('type', type);
  (into || a.ed.parentNode).append(b);
  return b;
};
const click = async (b) => { b.dispatchEvent({ type: 'click', isTrusted: true }); await settle(); };
// The student clicks b with the reply written, the editor closes, and the reply's whole text shows up on the page.
const clickThenShown = async (b, { before, after } = {}) => {
  const store = {}, clock = { now: T0 };
  const a = await page({ store, clock });
  await before?.(a);
  await a.open(); await a.write(AGREE);
  await click(b(a));
  await after?.(a);
  a.ed.remove();
  await a.pass();
  a.show(`Reply ${AGREE} Like`);
  for (let i = 0; i < 4; i++) { await a.pass(); await a.advance(20000); }
  return all(store);
};
const inForm = (a) => { const form = a.ctx.document.createElement('form'); a.ctx.document.body.append(form); form.append(a.ed.parentNode); return form; };

for (const [what, b] of [
  ['Cancel', (a) => control(a, { text: 'Cancel' })],
  ['Discard', (a) => control(a, { text: 'Discard' })],
  ['Save draft', (a) => control(a, { text: 'Save draft' })],
  ['Save Draft', (a) => control(a, { text: 'Save Draft' })],
  ['Close', (a) => control(a, { text: 'Close' })],
  ['Delete', (a) => control(a, { text: 'Delete' })],
  ['Edit post', (a) => control(a, { text: 'Edit post' })],
  ['Cancel, named so over the text Post', (a) => control(a, { text: 'Post', label: 'Cancel' })],
  ['an unnamed button', (a) => control(a)],
  ['an icon-only button', (a) => control(a, { icon: true })],
  ['an unnamed submit button outside a form', (a) => control(a, { type: 'submit' })],
  ['a submit button in the editor\'s form named Cancel', (a) => control(a, { text: 'Cancel', type: 'submit', into: inForm(a) })],
  ['a button named only by a word that is not sending', (a) => control(a, { text: 'Like' })],
  ...[['de', 'Abbrechen', 'Entwurf speichern'], ['es', 'Cancelar', 'Guardar borrador'], ['fr', 'Annuler', 'Enregistrer le brouillon'],
    ['nl', 'Annuleren', 'Concept opslaan'], ['pt-BR', 'Cancelar', 'Salvar rascunho']].flatMap(([lang, cancel, draft]) => [
    [`${cancel} (${lang})`, (a) => control(a, { text: cancel })],
    [`${draft} (${lang})`, (a) => control(a, { text: draft })],
  ]),
]) test(`Ultra: clicking ${what} beside the editor is no send: a matching post showing up takes nothing`, async () => {
  assert.deepEqual(await clickThenShown(b), [AGREE]);
});

for (const [what, b] of [
  ['Post', (a) => control(a, { text: 'Post' })],
  ['Reply', (a) => control(a, { text: 'Reply' })],
  ['Submit', (a) => control(a, { text: 'Submit' })],
  ['Send', (a) => control(a, { text: 'Send' })],
  ['Respond', (a) => control(a, { text: 'Respond' })],
  ['Save and post', (a) => control(a, { text: 'Save and post' })],
  ['  POST  ', (a) => control(a, { text: '  POST  ' })],
  ['an icon named Post by aria-label', (a) => control(a, { icon: true, label: 'Post' })],
  ['an icon named Post by title', (a) => control(a, { icon: true, title: 'Post' })],
  ['an unnamed submit button in the editor\'s form', (a) => control(a, { icon: true, type: 'submit', into: inForm(a) })],
  ...[['de', 'Veröffentlichen'], ['es', 'Publicar'], ['fr', 'Publier'], ['nl', 'Posten'], ['pt-BR', 'Publicar']].map(([lang, post]) => [`${post} (${lang})`, (a) => control(a, { text: post })]),
]) test(`Ultra: a reply sent with ${what}, and then shown on the page, went through: its copy goes`, async () => {
  assert.deepEqual(await clickThenShown(b), []);
});

for (const [what, away] of [
  ['another discussion', (a) => { a.ctx.location.pathname = '/ultra/courses/_5_1/outline/discussion/_10_1'; }],
  ['another course', (a) => { a.ctx.location.pathname = '/ultra/courses/_6_1/outline/discussion/_99_1'; }],
  ['the same page for another course', (a) => { a.ctx.location.search = '?courseId=_6_1'; }],
]) test(`Ultra: sent, then Ultra moved to ${what} where matching text shows: the copy stays`, async () => {
  assert.deepEqual(await clickThenShown((a) => control(a, { text: 'Post', type: 'submit' }), { before: (a) => { a.ctx.location.search = '?courseId=_5_1'; }, after: away }), [AGREE]);
});

for (const [what, meanwhile] of [['', null], [', while a matching post from someone else shows up', (a) => a.show(`Reply ${AGREE} Like`)]]) {
  test(`Ultra: a send that fails keeps the copy${what}`, async () => {
    const store = {}, clock = { now: T0 };
    const a = await page({ store, clock });
    a.show(OTHER);
    await a.open(); await a.write(AGREE);
    await a.submit();
    a.ed.setAttribute('contenteditable', 'false'); // sending
    await a.pass();
    meanwhile?.(a);
    await a.pass(); await a.advance(2000); await a.pass();
    a.ed.setAttribute('contenteditable', 'true'); // it failed: the editor is back with the text
    await a.pass();
    a.ed.remove(); // and the student leaves it
    for (let i = 0; i < 4; i++) { await a.pass(); await a.advance(20000); }
    assert.deepEqual(all(store), [AGREE]);
  });
}

test('Ultra: sent, but the tab closed before the post showed: the copy stays and is offered next time', async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ store, clock });
  await a.open(); await a.write(AGREE);
  await a.submit();
  const b = await page({ store, clock, posted: `Reply ${AGREE} Like` });
  await b.open();
  assert.deepEqual(all(store), [AGREE]);
  assert.equal(b.shown().length, 1, 'offered');
});

for (const site of ['ultra', 'canvas']) for (const fault of ['throw', 'lastError', 'no reply', 'refused']) {
  test(`${site}: worker ${fault} still leaves a recoverable copy after reload`, async () => {
    const store = {}, clock = { now: T0 };
    const a = await page({ site, store, clock });
    await a.open();
    a.ctx.chrome.runtime.sendMessage = (m, cb) => {
      if (fault === 'throw') throw Error('Extension context invalidated.');
      if (fault === 'lastError') { a.ctx.chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' }; cb(); delete a.ctx.chrome.runtime.lastError; }
      if (fault === 'refused') cb({ ok: false, error: 'write' });
    };
    await a.write(FIRST);
    const b = await page({ site, store, clock });
    await b.open();
    assert.equal(b.shown().length, 1, 'recovery must not depend on a worker acknowledgement');
    b.press(b.shown()[0], 'Restore'); await b.advance(1500);
    assert.equal(b.text(), FIRST);
  });
}

for (const site of ['ultra', 'canvas']) test(`${site}: invalidated extension APIs retain a same-tab recovery journal across reload`, async () => {
  const store = {}, clock = { now: T0 }, session = new Map();
  const a = await page({ site, store, clock, session }); await a.open();
  a.ctx.chrome.runtime.sendMessage = () => { throw Error('Extension context invalidated.'); };
  for (const k of ['get', 'set', 'remove']) a.ctx.chrome.storage.local[k] = () => { throw Error('Extension context invalidated.'); };
  await a.write(FIRST);
  const b = await page({ site, store, clock, session }); await b.open();
  assert.equal(b.shown().length, 1, 'same-tab session recovery survives invalidated extension APIs');
  b.press(b.shown()[0], 'Restore'); await b.advance(1500);
  assert.equal(b.text(), FIRST);
});

for (const site of ['ultra', 'canvas']) test(`${site}: an older save delivered after clearing cannot resurrect the cleared copy`, async () => {
  const p = await page({ site }); await p.open();
  const send = p.ctx.chrome.runtime.sendMessage, late = [];
  p.ctx.chrome.runtime.sendMessage = (m, cb) => { if (m.put) late.push(() => send(m, cb)); else send(m, cb); };
  await p.write(FIRST); await p.write('');
  for (const f of late) f(); await p.advance(2000);
  const b = await page({ site, store: p.store }); await b.open();
  assert.equal(b.shown().length, 0, 'delayed puts cannot undo a later clear');
});

for (const site of ['ultra', 'canvas']) test(`${site}: dismissing a version does not hide a newer version of that tab's copy`, async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ site, store, clock }); await a.open(); await a.write(FIRST);
  const b = await page({ site, store, clock }); await b.open();
  await a.write(SECOND);
  b.press(b.shown()[0], 'Dismiss'); await b.advance(2000);
  assert.equal(b.shown().length, 1, 'only the dismissed version is suppressed');
  b.press(b.shown()[0], 'Restore'); await b.advance(1500);
  assert.equal(b.text(), SECOND);
});

for (const site of ['ultra', 'canvas']) test(`${site}: a sleeping worker does not accumulate every superseded edit`, async () => {
  const p = await page({ site }); await p.open();
  p.ctx.chrome.runtime.sendMessage = () => {};
  for (let i = 0; i < 8; i++) await p.write(`${FIRST} edit ${i}`);
  const pending = Object.values(p.store).filter((m) => m?.put);
  assert.equal(pending.length, 1, 'only the newest durably written version needs a journal entry');
  const b = await page({ site, store: p.store }); await b.open();
  b.press(b.shown()[0], 'Restore'); await b.advance(1500);
  assert.equal(b.text(), `${FIRST} edit 7`);
});

test('Ultra: legacy stored HTML is sanitized before insertHTML, including previous copies', async () => {
  for (const previous of [false, true]) {
    const p = await page();
    const key = `draft:ultra:${ORIGIN}/_7_1${POST}#_12_3/ed1`;
    const bad = { text: FIRST, html: `<p onclick="alert(1)">${FIRST}</p><img src=x onerror="alert(1)"><script>alert(1)</script>`, at: T0 };
    p.store[key] = previous ? { prev: [bad] } : bad;
    await p.open(); p.press(p.shown()[0], 'Restore'); await p.advance(1500);
    assert.doesNotMatch(p.ed.innerHTML, /onclick|onerror|<script/i, 'unsafe stored HTML must never reach the editor');
    assert.equal(p.text(), FIRST);
  }
});

test('Ultra: a delayed detached snapshot cannot replace a newer saved edit', async () => {
  const p = await page(); await p.open(); await p.write(FIRST);
  const old = p.ctx.api.draftAt(p.ed);
  await p.write(SECOND); p.ed.remove();
  p.ctx.GZ_DRAFT_UI.take(old); await p.advance(1000);
  assert.deepEqual(all(p.store), [SECOND], 'older snapshots do not become newly timestamped edits');
});

// ---- The recovery journal (draft:pending:…): what a page writes before the worker has the change ----------------------------
const journalOf = (store, session = new Map()) => [...Object.keys(store), ...session.keys()].filter((k) => k.startsWith('draft:pending:'));

for (const site of ['ultra', 'canvas']) test(`${site}: a confirmed change leaves no journal behind`, async () => {
  const store = {}, clock = { now: T0 }, session = new Map();
  const a = await page({ site, store, clock, session }); await a.open(); await a.write(FIRST);
  assert.deepEqual(journalOf(store, session), []);
  const b = await page({ site, store, clock, session }); await b.open();
  b.press(b.shown()[0], 'Dismiss'); await b.advance(1500);
  assert.deepEqual(journalOf(store, session), []);
});

for (const site of ['ultra', 'canvas']) test(`${site}: pages that write while the worker never answers keep a journal no bigger than the copies it can hold`, async () => {
  const store = {}, clock = { now: T0 };
  for (let i = 0; i < 6; i++) {
    const p = await page({ site, store, clock }); await p.open();
    p.ctx.chrome.runtime.sendMessage = () => {};
    await p.write(`${FIRST} visit ${i}`);
  }
  assert.ok(journalOf(store).length <= 3, `${journalOf(store).length} journal entries`);
  const b = await page({ site, store, clock }); await b.open();
  b.press(b.shown()[0], 'Restore'); await b.advance(1500);
  assert.equal(b.text(), `${FIRST} visit 5`);
});

for (const site of ['ultra', 'canvas']) test(`${site}: a copy dismissed while the worker never answers is not kept anywhere`, async () => {
  const store = {}, clock = { now: T0 }, session = new Map();
  const a = await page({ site, store, clock }); await a.open();
  a.ctx.chrome.runtime.sendMessage = () => {};
  await a.write(FIRST);
  const b = await page({ site, store, clock, session });
  b.ctx.chrome.runtime.sendMessage = () => {};
  await b.open();
  b.press(b.shown()[0], 'Dismiss'); await b.advance(1500);
  assert.equal(JSON.stringify([store, [...session]]).includes(FIRST), false, 'the dismissed text is gone from storage');
  const c = await page({ site, store, clock }); await c.open();
  assert.equal(c.bars().length, 0);
  assert.equal(JSON.stringify(store).includes(FIRST), false);
});

test('Ultra: dismissing a copy kept without a page id leaves no copy of its text', async () => {
  const p = await page();
  p.store[`draft:ultra:${ORIGIN}/_7_1${POST}#_12_3/ed1`] = { html: `<p>${FIRST}</p>`, text: FIRST, at: T0 - 1000 };
  await p.open(); p.press(p.shown()[0], 'Dismiss'); await p.advance(1500);
  assert.equal(JSON.stringify(p.store).includes(FIRST), false);
  const b = await page({ store: p.store }); await b.open();
  assert.equal(b.bars().length, 0);
});

for (const site of ['ultra', 'canvas']) for (const fault of ['setItem', 'access']) test(`${site}: sessionStorage that throws (${fault}) still keeps and offers the copy`, async () => {
  const store = {}, clock = { now: T0 };
  const deny = (p) => {
    if (fault === 'access') Object.defineProperty(p.ctx, 'sessionStorage', { get() { throw Error('SecurityError'); } });
    else p.ctx.sessionStorage.setItem = () => { throw Error('QuotaExceededError'); };
  };
  const a = await page({ site, store, clock }); deny(a); await a.open(); await a.write(FIRST);
  const b = await page({ site, store, clock }); deny(b); await b.open();
  b.press(b.shown()[0], 'Restore'); await b.advance(1500);
  assert.equal(b.text(), FIRST);
});

for (const site of ['ultra', 'canvas']) test(`${site}: a journal the worker never answered is handed to it on the next load`, async () => {
  const store = {}, clock = { now: T0 };
  const a = await page({ site, store, clock }); await a.open();
  a.ctx.chrome.runtime.sendMessage = () => {};
  await a.write(FIRST);
  assert.equal(journalOf(store).length, 1);
  const b = await page({ site, store, clock }); await b.open();
  assert.deepEqual(journalOf(store), [], 'replayed and folded into the record');
  assert.deepEqual(all(store), [FIRST]);
  assert.equal(b.shown().length, 1);
});

test('Ultra: Writer snapshots survive a detached editor and remain available to native recovery', async () => {
  const p = await page(); await p.open();
  const snapshot = { ...p.ctx.api.draftAt(p.ed), html: `<p>${FIRST}</p>`, text: FIRST };
  p.ed.parentNode.setAttribute('data-gz-writer', 'reply');
  p.ed.remove();
  p.ctx.GZ_DRAFT_UI.keep(snapshot); await p.advance(0);
  const next = await page({ store: p.store }); await next.open();
  assert.equal(await next.ctx.GZ_DRAFT_UI.ready(next.ed), false, 'recovery takes precedence over Writer takeover');
  next.press(next.shown()[0], 'Restore'); await next.advance(1500);
  assert.equal(next.text(), FIRST);
});
