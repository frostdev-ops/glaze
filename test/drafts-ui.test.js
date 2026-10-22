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

// A page: site, who is signed in (user), and the storage it shares. clock: { now } shared between pages so time runs on.
const page = async ({ site = 'ultra', user = site === 'ultra' ? '_7_1' : '7', origin = ORIGIN, store = {}, clock = { now: T0 }, pathname, posted = '' } = {}) => {
  const ultra = site === 'ultra';
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
      // The page's own text outside the editors, where a sent post would show.
      createTreeWalker: () => { const nodes = posted ? [{ data: posted }] : []; return { nextNode: () => nodes.shift() || null }; },
      // The browser's own editing: what Restore types in lands in the focused editor, and the page hears an input.
      execCommand: (cmd, _, html) => { const ed = doc.activeElement; ed.innerHTML = html; ed.dispatchEvent({ type: 'input' }); return true; },
    },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 }, getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    chrome: { runtime: { id: 'glaze' }, storage: { local: area } },
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
  const text = () => (ultra ? ed.textContent : ed.value);
  const set = (v) => { if (ultra) ed.innerHTML = v ? `<p>${v}</p>` : ''; else ed.value = v; };
  const bars = () => body.querySelectorAll('.gz-draft');
  const shown = () => bars().filter((b) => !b.hidden);
  const press = (b, label) => b.all().find((e) => e.tagName === 'BUTTON' && e.textContent === label).dispatchEvent({ type: 'click' });
  return {
    store, ed, bars, shown, advance, text, press, ctx, doc, flags,
    // A mutation pass, as content.js's observer runs it.
    pass: async () => { ctx.api.watchDrafts(); await settle(); },
    // The student writes (all of it at once, as a paste is): the keys and input, then a second's quiet.
    write: async (v, wait = 1000) => { set(v); ed.focus(); for (const type of ultra ? ['keydown', 'input'] : ['input']) fire(type, { type, target: ed }); await settle(); await advance(wait); },
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
    assert.deepEqual(all(store), [FIRST], 'unread means preserved, not an empty slot');
    area.get = get;
    await p.write(SECOND);
    assert.deepEqual(all(store).sort(), [FIRST, SECOND].sort(), 'a later successful read recovers');
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
