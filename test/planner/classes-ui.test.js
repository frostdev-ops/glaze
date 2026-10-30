// The class schedule dialog (features/classes.js) in a VM with an inert DOM and the worker's queue: a read still under way
// when the dialog moves on or is closed and opened again changes nothing on screen (Codex W14 review), writes carry when
// they were asked for, and a script's click does nothing. The reading itself is lib/classes.js, tested in classes.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../lib/classes.js');
const T = require('../lib/todo.js');
const I = require('../lib/ics.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://canvas.test';
const KEY = C.storeKey(ORIGIN, '3');
const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:a@x', 'SUMMARY:BIO 1100 Biology', 'DTSTART;TZID=America/New_York:20260825T133000',
  'DTEND;TZID=America/New_York:20260825T144500', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20991211T235959Z', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');

const page = () => {
  const document = { activeElement: null };
  class E {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.on = {}; this.dataset = {}; this.files = []; this.value = ''; this.className = ''; this.parent = null; }
    append(...xs) { for (const x of xs) { const n = typeof x === 'object' ? x : { text: String(x) }; n.parent = this; this.children.push(n); } }
    replaceChildren(...xs) { for (const c of this.children) c.parent = null; this.children = []; this.append(...xs); }
    get firstChild() { return this.children[0] || null; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }
    addEventListener(type, f) { (this.on[type] ||= []).push(f); }
    removeEventListener(type, f) { this.on[type] = (this.on[type] || []).filter((x) => x !== f); }
    fire(type, isTrusted = true) { for (const f of this.on[type] || []) f({ type, isTrusted, target: this }); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.fire('close'); }
    get all() { return this.children.filter((c) => c instanceof E).flatMap((c) => [c, ...c.all]); }
    get text() { return [this.textContent || '', ...this.children.map((c) => (c instanceof E ? c.text : c.text))].join(' ').trim(); }
    // Enough of a selector for the file: tags, .classes, a descendant, and lists.
    is(one) { return one.startsWith('.') ? this.className.split(' ').includes(one.slice(1)) : this.tagName === one.toUpperCase(); }
    querySelectorAll(sel) {
      return this.all.filter((n) => sel.split(',').some((s) => {
        const parts = s.trim().split(/\s+/);
        if (!n.is(parts.at(-1))) return false;
        let up = n.parent;
        for (let i = parts.length - 2; i >= 0; i--) { while (up && !(up.is && up.is(parts[i]))) up = up.parent; if (!up) return false; up = up.parent; }
        return true;
      }));
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  document.createElement = (tag) => new E(tag);
  document.body = new E('body');
  const box = {};
  const area = { local: { get: async (ks) => Object.fromEntries(ks.filter((k) => k in box).map((k) => [k, structuredClone(box[k])])), set: async (p) => { Object.assign(box, structuredClone(p)); return true; } } };
  const sent = [], held = [], replies = [], imports = [], fetches = [], streams = [];
  let hold = false, holdBody = false, holdReplies = false, feed = new TextEncoder().encode(ICS);
  const wait = async () => { if (hold) await new Promise((res) => held.push(res)); };
  const c = {
    console, URL, Intl, AbortController, TextDecoder, document, location: { origin: ORIGIN, host: 'canvas.test' },
    // As a browser's: a request called off before its headers fails with an AbortError. Its body, held, answers on release,
    // and arrives in 64 KiB chunks; each stream counts the bytes handed out and whether it was cancelled.
    fetch: async (u, o = {}) => {
      fetches.push(o);
      await Promise.race([wait(), new Promise((res, rej) => o.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))]);
      const data = feed, s = { read: 0, cancelled: false };
      let body = holdBody;
      const arrive = async () => { if (body) { body = false; await new Promise((res) => held.push(res)); } };
      streams.push(s);
      return {
        ok: String(u).startsWith(ORIGIN), text: async () => new TextDecoder().decode(data),
        arrayBuffer: async () => { await arrive(); s.read = data.length; return data.slice().buffer; },
        body: { getReader: () => ({
          read: async () => {
            await arrive();
            if (s.cancelled || s.read >= data.length) return { done: true, value: undefined };
            const value = data.slice(s.read, s.read + (1 << 16));
            s.read += value.length;
            return { done: false, value };
          },
          cancel: async () => { s.cancelled = true; },
          releaseLock() {},
        }) },
      };
    },
    GZ_I18N: { locale: () => 'en' }, GZ_TODO: T, GZ_CLASSES: C, GZ_ICS: I,
    // features/import.js, held: a read is recorded and never answers.
    GZ_IMPORT: { read: (file, opts) => { imports.push({ file, opts }); return new Promise(() => {}); }, note: () => '', doubt: () => false },
    GZ_CTX: {
      t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', need: async () => {},
      profile: async () => ({ id: 3, time_zone: 'America/New_York' }), canvasCourses: async () => [{ id: '25', name: 'Biology', course_code: 'BIO 1100' }],
    },
    chrome: {
      // The worker runs each write at once; with replies held, its answer reaches the page only on release.
      runtime: { lastError: null, sendMessage: (m, cb) => { sent.push(m); C.change(structuredClone(m), area).then((r) => (holdReplies ? replies.push(() => cb(r)) : cb(r))); } },
      storage: { local: { get: (k, cb) => area.local.get([k]).then(cb) }, onChanged: { addListener() {}, removeListener() {} } },
    },
  };
  c.globalThis = c;
  vm.createContext(c);
  const ui = vm.runInContext(read('features/classes.js'), c);
  const dialog = () => document.body.children.find((x) => x.tagName === 'DIALOG' && x.open) || null;
  const find = (text, tag = 'BUTTON') => dialog()?.all.find((n) => n.tagName === tag && n.textContent === text);
  return { ui, c, box, sent, imports, fetches, streams, document, dialog, find, serve: (b) => { feed = b; }, hold: () => { hold = true; }, holdBody: () => { holdBody = true; },
    release: () => { hold = holdBody = false; held.splice(0).forEach((r) => r()); },
    holdReplies: () => { holdReplies = true; }, stopHolding: () => { holdReplies = false; }, releaseReplies: () => { holdReplies = false; replies.splice(0).forEach((r) => r()); } };
};

test('a calendar link still being read when the dialog is closed and opened again leaves the new one alone', async () => {
  const p = page();
  await p.ui.open();
  p.find('Import a schedule').fire('click');
  p.dialog().querySelector('input').value = ''; // the file input: nothing chosen
  p.dialog().all.find((n) => n.type === 'url').value = `${ORIGIN}/feeds/calendars/user_x.ics`;
  p.hold();
  p.find('Read schedule').fire('click');
  await settle();
  p.dialog().close();
  await p.ui.open();
  const second = p.dialog();
  p.release();
  await settle();
  assert.equal(p.dialog(), second);
  assert.equal(second.querySelectorAll('.gz-cl-entry').length, 0, 'no review drawn into the new dialog');
  assert.match(second.querySelector('h2').textContent, /Class schedule/);
  // Within one dialog: Back while it reads, and the answer is dropped too.
  p.find('Import a schedule').fire('click');
  p.dialog().all.find((n) => n.type === 'url').value = `${ORIGIN}/feeds/calendars/user_x.ics`;
  p.hold();
  p.find('Read schedule').fire('click');
  await settle();
  p.find('Back').fire('click');
  p.release();
  await settle();
  assert.equal(p.dialog().querySelectorAll('.gz-cl-entry').length, 0);
  // Left alone, the same read reaches the review.
  p.find('Import a schedule').fire('click');
  p.dialog().all.find((n) => n.type === 'url').value = `${ORIGIN}/feeds/calendars/user_x.ics`;
  p.find('Read schedule').fire('click');
  await settle();
  assert.equal(p.dialog().querySelectorAll('.gz-cl-entry').length, 1);
});

// RFC 5545 folds lines by octets, so a fold can fall inside a character ("é", C3 A9): lib/ics.js joins it back only
// when it is given the bytes, before decoding.
test('a calendar file or link is read as bytes: a line folded inside a character still reads whole', async () => {
  const enc = (s) => new TextEncoder().encode(s);
  const [a, b] = ICS.replace('Biology', 'Biologie générale').split('énérale');
  const bytes = new Uint8Array([...enc(a), 0xc3, ...enc('\r\n '), 0xa9, ...enc(`nérale${b}`)]);
  const title = async (p) => { p.find('Read schedule').fire('click'); await settle(); return p.dialog().querySelector('.gz-cl-entry legend')?.textContent; };
  const p = page();
  await p.ui.open();
  p.find('Import a schedule').fire('click');
  p.dialog().querySelector('input').files = [{ name: 'schedule.ics', type: 'text/calendar', size: bytes.length,
    text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.slice().buffer }];
  assert.equal(await title(p), 'BIO 1100 Biologie générale', 'a file');
  const q = page();
  q.serve(bytes);
  await q.ui.open();
  q.find('Import a schedule').fire('click');
  q.dialog().all.find((n) => n.type === 'url').value = `${ORIGIN}/feeds/calendars/user_x.ics`;
  assert.equal(await title(q), 'BIO 1100 Biologie générale', 'a link');
});

test('writes say when they were asked for; a script\'s click does nothing', async () => {
  const p = page();
  p.box[KEY] = { courses: [{ id: '25', code: 'BIO 1100', name: 'Biology', at: 1, periods: [{ days: [2, 4], start: 810, end: 885 }] }] };
  await p.ui.open();
  p.find('Delete all').fire('click', false);
  p.find('Delete', 'BUTTON');
  const yes = p.dialog().querySelector('.gz-cl-danger');
  yes.fire('click', false);
  await settle();
  assert.equal(p.sent.length, 0);
  yes.fire('click');
  await settle();
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0].op, 'clear');
  assert.ok(Number.isFinite(p.sent[0].at) && p.sent[0].at > 1);
  assert.equal(p.sent[0].tz, 'America/New_York', 'the zone the times are in goes with every write');
  assert.deepEqual(p.box[KEY].courses, []);
});

// Codex W14 review: through the real service worker (lib/background.js). A Save's permission check reads storage before
// the write is queued; held there, a later Delete all from another tab finishes first. The Save, queued after it, must
// not bring the course back: what counts is when each was pressed, checked inside the queue's turn.
test('the worker: a Save held before the queue, then Delete all, then the Save: the course stays deleted', async () => {
  // A school's own Canvas the student approved: its permission check reads the site list (Instructure's own hosts need none).
  const ID = 'glaze-test-id', SITE = 'https://canvas.school.edu', K = C.storeKey(SITE, '3');
  const data = { canvas: [`${SITE}/*`], [K]: { courses: [{ id: '25', name: 'Biology', at: 100, periods: [{ days: [2], start: 810, end: 885 }] }] } };
  const held = [];
  let holdNext = false;
  const local = {
    get: (k) => {
      const v = structuredClone(Object.fromEntries([].concat(k ?? Object.keys(data)).filter((x) => x in data).map((x) => [x, data[x]])));
      if (holdNext && k === 'canvas') { holdNext = false; return new Promise((res) => held.push(() => res(v))); }
      return Promise.resolve(v);
    },
    set: (p) => { Object.assign(data, structuredClone(p)); return Promise.resolve(); },
    remove: (ks) => { for (const x of [].concat(ks)) delete data[x]; return Promise.resolve(); },
  };
  const listeners = [];
  const none = { addListener() {} };
  const ctx = vm.createContext({
    URL, console, setTimeout, clearTimeout, crypto,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(path.join('lib', f)), ctx); },
    chrome: {
      runtime: { id: ID, getURL: (p = '') => `chrome-extension://${ID}/${p}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: none, onStartup: none, onConnect: none },
      storage: { local, sync: { get: () => Promise.resolve({}), set: () => Promise.resolve() }, onChanged: none },
      scripting: { executeScript: () => Promise.resolve([]) },
    },
  });
  vm.runInContext(read('lib/background.js'), ctx);
  const sender = { id: ID, tab: { id: 1 }, frameId: 0, url: `${SITE}/courses` };
  const send = (m) => new Promise((res) => { for (const f of listeners) f(m, sender, (r) => res(JSON.parse(JSON.stringify(r)))); });
  const course = { id: '25', name: 'Biology', periods: [{ days: [2, 4], start: 810, end: 885 }] };
  holdNext = true;
  const save = send({ type: 'glaze:classes', key: K, op: 'put', courses: [course], at: 150 }); // pressed before Delete all
  await settle();
  assert.equal(held.length, 1, 'the Save waits on its permission read');
  assert.equal((await send({ type: 'glaze:classes', key: K, op: 'clear', at: 200 })).ok, true);
  assert.deepEqual(data[K].courses, []);
  held.shift()();
  const r = await save;
  assert.equal(r.stale, true);
  assert.deepEqual(data[K].courses, [], 'Delete all holds');
  // Another site's page may not write this one's schedule.
  const other = await new Promise((res) => { for (const f of listeners) f({ type: 'glaze:classes', key: K, op: 'clear', at: 300 }, { ...sender, url: 'https://other.instructure.com/' }, (r) => res(JSON.parse(JSON.stringify(r)))); });
  assert.deepEqual(other, { ok: false, error: 'sender' });
});

// Codex W14 review: an old Save's answer, released after the dialog was closed and opened again and a newer Save made,
// must not put the older copy back into what the dialog shows next.
test('a late answer to a Save from a closed dialog leaves the newer one shown', async () => {
  const p = page();
  p.box[KEY] = { courses: [{ id: 'o-choir', code: '', name: 'Choir', at: 1, periods: [{ days: [3], start: 1080, end: 1170 }] }] };
  const rename = async (name) => {
    p.find('Edit').fire('click');
    p.dialog().all.find((n) => n.type === 'text' && n.maxLength === 200).value = name;
    p.find('Save changes').fire('click');
    await settle();
  };
  await p.ui.open();
  p.holdReplies();
  await rename('Choir (old)'); // the worker keeps it; its answer is held
  p.dialog().close();
  await p.ui.open();
  p.stopHolding(); // the new dialog's Save is answered at once; the old answer still waits
  await new Promise((res) => setTimeout(res, 2)); // a later press
  await rename('Choir (new)');
  assert.equal(p.box[KEY].courses[0].name, 'Choir (new)');
  p.releaseReplies(); // now the old Save's answer arrives
  await settle();
  p.find('Import a schedule').fire('click');
  p.find('Back').fire('click');
  assert.match(p.dialog().text, /Choir \(new\)/);
  assert.doesNotMatch(p.dialog().text, /Choir \(old\)/);
});

// Codex W14 review (P3): Add with no date chosen threw a RangeError.
test('adding a day off with no date (or half a date) adds nothing and says so', async () => {
  const p = page();
  await p.ui.open();
  p.find('Add a class').fire('click');
  const more = p.dialog().all.find((n) => n.type === 'date' && !n.value && n.parent?.parent?.className === 'gz-cl-skip');
  for (const v of ['', '2026-02-30', '2026-1']) {
    more.value = v;
    assert.doesNotThrow(() => p.find('Add').fire('click'));
    assert.equal(p.dialog().querySelectorAll('.gz-cl-chips li').length, 0, v);
    assert.match(p.dialog().querySelector('.gz-cl-say').textContent, /Choose a date first/);
  }
  more.value = '2026-11-26';
  p.find('Add').fire('click');
  assert.equal(p.dialog().querySelectorAll('.gz-cl-chips li').length, 1);
});

test('a file in the import step is read only on the student\'s own click of Read schedule, never a script\'s', async () => {
  const p = page();
  await p.ui.open();
  p.find('Import a schedule').fire('click');
  p.dialog().querySelector('input').files = [{ name: 'made-by-the-page.pdf', type: 'application/pdf', size: 9 }];
  p.find('Read schedule').fire('click', false);
  await settle();
  assert.equal(p.imports.length, 0, 'a script\'s click reads nothing');
  p.find('Read schedule').fire('click');
  await settle();
  assert.equal(p.imports.length, 1, 'the student\'s click reads it');
});

// ---- Stop reading: whatever the read was waiting on, it ends stopped and the review never comes ----------------------
const linkRead = async (p) => {
  await p.ui.open();
  p.find('Import a schedule').fire('click');
  p.dialog().all.find((n) => n.type === 'url').value = `${ORIGIN}/feeds/calendars/user_x.ics`;
  p.find('Read schedule').fire('click');
  await settle();
};
const stopped = (p) => {
  assert.equal(p.dialog().querySelectorAll('.gz-cl-entry').length, 0, 'no review');
  assert.match(p.dialog().querySelector('h2').textContent, /Import a schedule/);
  assert.equal(p.dialog().querySelector('.gz-cl-say').textContent, 'Stopped.');
  assert.equal(p.find('Read schedule').disabled, false);
};

test('Stop reading calls off a calendar link still waiting for its answer', async () => {
  const p = page();
  p.hold();
  await linkRead(p);
  assert.ok(p.fetches[0].signal, 'the request can be called off');
  p.find('Stop reading').fire('click');
  await settle();
  assert.equal(p.fetches[0].signal.aborted, true);
  stopped(p);
  p.release();
  await settle();
  stopped(p);
});

test('Stop reading while a calendar link\'s body is still arriving: stopped once it arrives', async () => {
  const p = page();
  p.holdBody();
  await linkRead(p);
  p.find('Stop reading').fire('click');
  await settle();
  p.release();
  await settle();
  stopped(p);
});

test('Stop reading while a file is read on this device: a calendar file, or a document the reader answers late', async () => {
  const p = page();
  await p.ui.open();
  p.find('Import a schedule').fire('click');
  let give;
  const bytes = new TextEncoder().encode(ICS);
  p.dialog().querySelector('input').files = [{ name: 'schedule.ics', type: 'text/calendar', size: bytes.length, arrayBuffer: () => new Promise((res) => { give = () => res(bytes.slice().buffer); }) }];
  p.find('Read schedule').fire('click');
  await settle();
  p.find('Stop reading').fire('click');
  give();
  await settle();
  stopped(p);
  // features/import.js answering after it was called off (its text came in as Stop was pressed).
  const q = page();
  let answer;
  q.c.GZ_IMPORT.read = () => new Promise((res) => { answer = () => res({ text: 'BIO 1100 Biology TR 1:30-2:45pm Life Sciences 120' }); });
  await q.ui.open();
  q.find('Import a schedule').fire('click');
  q.dialog().querySelector('input').files = [{ name: 'schedule.pdf', type: 'application/pdf', size: 9 }];
  q.find('Read schedule').fire('click');
  await settle();
  q.find('Stop reading').fire('click');
  answer();
  await settle();
  stopped(q);
});

test('closing the dialog while a calendar link is read calls the request off, and nothing is read from it', async () => {
  const p = page();
  let parsed = 0;
  p.c.GZ_CLASSES = { ...C, fromIcs: (...a) => { parsed++; return C.fromIcs(...a); } };
  p.hold();
  await linkRead(p);
  p.dialog().close();
  assert.equal(p.fetches[0].signal?.aborted, true);
  p.release();
  await settle();
  assert.equal(parsed, 0);
  assert.equal(p.dialog(), null);
  await p.ui.open();
  assert.match(p.dialog().querySelector('h2').textContent, /Class schedule/);
});

// ---- limits: 20 times a class, 60 classes -------------------------------------------------------------------------------
const say = (p) => p.dialog().querySelector('.gz-cl-say');

test('a class takes at most 20 times in the review, and an import with more says so instead of saving', async () => {
  const p = page();
  await p.ui.open();
  p.find('Add a class').fire('click');
  for (let i = 0; i < 25; i++) p.find('Add a time').fire('click');
  assert.equal(p.dialog().querySelectorAll('.gz-cl-period').length, 20);
  assert.equal(say(p).textContent, 'A class can have at most 20 times.');
  // A calendar with 21 weekly times for one class.
  const ev = (i) => ['BEGIN:VEVENT', `UID:t${i}@x`, 'SUMMARY:BIO 1100 Biology', `DTSTART;TZID=America/New_York:20260825T${C.hhmm(420 + i * 30).replace(':', '')}00`,
    `DTEND;TZID=America/New_York:20260825T${C.hhmm(440 + i * 30).replace(':', '')}00`, 'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20991211T235959Z', 'END:VEVENT'];
  const q = page();
  q.serve(new TextEncoder().encode(['BEGIN:VCALENDAR', 'VERSION:2.0', ...Array.from({ length: 21 }, (_, i) => ev(i)).flat(), 'END:VCALENDAR', ''].join('\r\n')));
  await linkRead(q);
  assert.equal(q.dialog().querySelectorAll('.gz-cl-period').length, 21);
  q.find('Save').fire('click');
  await settle();
  assert.equal(q.sent.length, 0, 'nothing sent');
  assert.equal(say(q).textContent, 'A class can have at most 20 times.');
  assert.equal(say(q).getAttribute('role'), 'alert');
  q.find('Remove this time').fire('click');
  q.find('Save').fire('click');
  await settle();
  assert.equal(q.box[KEY].courses[0].periods.length, 20);
  assert.equal(say(q).textContent, 'Saved.');
});

test('a 61st class is refused with a message, never "Saved."', async () => {
  const p = page();
  p.box[KEY] = { courses: Array.from({ length: 60 }, (_, i) => ({ id: `o-c${i}`, name: `Class ${i}`, at: 1, periods: [{ days: [1], start: 600, end: 650 }] })) };
  await p.ui.open();
  p.find('Add a class').fire('click');
  p.dialog().all.find((n) => n.type === 'text' && n.maxLength === 200).value = 'Choir';
  p.dialog().all.find((n) => n.type === 'checkbox' && String(n.dataset.day) === '3').checked = true;
  p.find('Save').fire('click');
  await settle();
  assert.equal(p.sent.length, 1);
  assert.equal(say(p).textContent, 'A schedule can have at most 60 classes.');
  assert.equal(say(p).getAttribute('role'), 'alert');
  assert.equal(p.box[KEY].courses.length, 60);
  assert.ok(!p.box[KEY].courses.some((c) => c.name === 'Choir'));
});

// ---- zones: an edit keeps the zone its class was saved in ---------------------------------------------------------------
test('editing a class from a page in another zone keeps the zone its times were saved in', async () => {
  const at = (store) => C.icsEvents(store, { from: '2026-11-02', to: '2026-11-02', tz: 'America/New_York' }).map((e) => new Date(e.start).toISOString());
  for (const [stored, want] of [
    [{ courses: [{ id: '25', name: 'Biology', at: 1, periods: [{ days: [1], start: 540, end: 600, tz: 'America/New_York' }] }] }, '2026-11-02T14:00:00.000Z'],
    [{ tz: 'America/Phoenix', courses: [{ id: '25', name: 'Biology', at: 1, periods: [{ days: [1], start: 540, end: 600 }] }] }, '2026-11-02T16:00:00.000Z'],
  ]) {
    const p = page();
    p.c.GZ_CTX.profile = async () => ({ id: 3, time_zone: 'America/Los_Angeles' });
    p.box[KEY] = stored;
    assert.deepEqual(at(p.box[KEY]), [want]);
    await p.ui.open();
    p.find('Edit').fire('click');
    p.find('Save changes').fire('click');
    await settle();
    assert.equal(p.sent[0].tz, 'America/Los_Angeles');
    assert.deepEqual(at(p.box[KEY]), [want]);
  }
});

test('an abandoned document reader cannot report progress into a reopened dialog', async () => {
  const p = page();
  await p.ui.open();
  p.find('Import a schedule').fire('click');
  p.dialog().querySelector('input').files = [{ name: 'schedule.pdf', type: 'application/pdf', size: 9 }];
  p.find('Read schedule').fire('click');
  await settle();
  const { progress } = p.imports[0].opts;
  p.dialog().close();
  await p.ui.open();
  progress('Reading page 9');
  assert.equal(say(p).textContent || '', '');
});

test('class times identify their zone in the list and the edit controls', async () => {
  const p = page();
  p.box[KEY] = { tz: 'America/Phoenix', courses: [{ id: '25', name: 'Biology', periods: [{ days: [1], start: 540, end: 600, tz: 'America/Los_Angeles' }, { days: [2], start: 600, end: 650 }] }] };
  await p.ui.open();
  assert.match(p.dialog().querySelector('.gz-cl-list').text, /America\/Los_Angeles/);
  assert.match(p.dialog().querySelector('.gz-cl-list').text, /America\/Phoenix/);
  p.find('Edit').fire('click');
  assert.match(p.dialog().querySelectorAll('.gz-cl-period')[0].text, /Starts.*America\/Los_Angeles/);
  assert.match(p.dialog().querySelectorAll('.gz-cl-period')[1].text, /Starts.*America\/Phoenix/);
});

test('a class time in the zone the page is in shows no zone', async () => {
  const p = page();
  p.box[KEY] = { courses: [{ id: '25', name: 'Biology', periods: [{ days: [1], start: 540, end: 600, tz: 'America/New_York' }] }] };
  await p.ui.open();
  assert.doesNotMatch(p.dialog().querySelector('.gz-cl-list').text, /America\//);
  p.find('Edit').fire('click');
  assert.doesNotMatch(p.dialog().querySelector('.gz-cl-period').text, /America\//);
});

test('schedule views use their controls without introductory helper paragraphs', async () => {
  const p = page();
  await p.ui.open();
  assert.equal(p.dialog().querySelectorAll('p').some((x) => /Your classes, shown/.test(x.text)), false);
  p.find('Import a schedule').fire('click');
  assert.equal(p.dialog().querySelectorAll('p').some((x) => /Glaze reads it on this device/.test(x.text)), false);
  p.dialog().querySelector('textarea').value = 'BIO 1100 Biology M 9:00-10:00am';
  p.find('Read schedule').fire('click');
  await settle();
  assert.equal(p.dialog().querySelectorAll('p').some((x) => /Nothing is saved until/.test(x.text)), false);
});

test('pasted schedules over the period limit stay in the importer with an error', async () => {
  const p = page();
  await p.ui.open();
  p.find('Import a schedule').fire('click');
  p.dialog().querySelector('textarea').value = Array.from({ length: 21 }, (_, i) => `BIO 1100 Biology M ${C.hhmm(420 + i * 20)}-${C.hhmm(430 + i * 20)} Room ${i}`).join('\n');
  p.find('Read schedule').fire('click');
  await settle();
  assert.equal(p.dialog().querySelectorAll('.gz-cl-entry').length, 0);
  assert.equal(say(p).textContent, 'A class can have at most 20 times.');
});

test('editing days off preserves import provenance through a later reimport', async () => {
  const p = page();
  const period = { days: [1], start: 540, end: 600, skip: ['2026-11-02'], importedSkip: ['2026-11-02'] };
  p.box[KEY] = { courses: [{ id: '25', name: 'Biology', periods: [period] }] };
  await p.ui.open();
  p.find('Edit').fire('click');
  const dates = p.dialog().all.filter((n) => n.type === 'date');
  dates.at(-1).value = '2026-11-09';
  p.find('Add').fire('click');
  p.find('Save changes').fire('click');
  await settle();
  assert.deepEqual(Array.from(p.sent[0].courses[0].periods[0].importedSkip || []), ['2026-11-02']);
});

test('the day-off editor stops at 200 and imported excess cannot be saved', async () => {
  const dates = Array.from({ length: 201 }, (_, i) => C.keyOf(C.dayNum('2026-01-01') + i));
  const p = page();
  p.box[KEY] = { courses: [{ id: '25', name: 'Biology', periods: [{ days: [1], start: 540, end: 600, skip: dates.slice(0, 200) }] }] };
  await p.ui.open();
  p.find('Edit').fire('click');
  p.dialog().all.filter((n) => n.type === 'date').at(-1).value = dates[200];
  p.find('Add').fire('click');
  assert.equal(p.dialog().querySelector('.gz-cl-chips').children.length, 200);
  assert.equal(say(p).textContent, 'A class time can have at most 200 days off.');
  const q = page();
  q.c.GZ_CLASSES = { ...C, fromText: () => ({ entries: [{ id: '', name: 'Biology', periods: [{ days: [1], start: 540, end: 600, skip: dates, unsure: [] }] }] }) };
  await q.ui.open();
  q.find('Import a schedule').fire('click');
  q.dialog().querySelector('textarea').value = 'schedule';
  q.find('Read schedule').fire('click');
  await settle();
  q.find('Save').fire('click');
  await settle();
  assert.equal(q.sent.length, 0);
  assert.equal(say(q).textContent, 'A class time can have at most 200 days off.');
});

test('the importer labels inputs without an instructional placeholder or format list', async () => {
  const p = page();
  await p.ui.open();
  p.find('Import a schedule').fire('click');
  assert.equal(!!p.dialog().querySelector('textarea').placeholder, false);
  assert.equal(p.dialog().querySelector('input').parent.text, 'A file');
});

test('a calendar link past the size limit stops being read once it passes it, and says it is not one Glaze can read', async () => {
  const p = page();
  const big = new Uint8Array(8 << 20).fill(10);
  big.set(new TextEncoder().encode(ICS));
  p.serve(big);
  await linkRead(p);
  const [s] = p.streams;
  assert.ok(s.read <= (5 << 20) + (1 << 16), `read ${s.read} bytes`);
  assert.equal(s.cancelled, true, 'the rest of the body is called off');
  assert.equal(p.dialog().querySelectorAll('.gz-cl-entry').length, 0, 'no review');
  assert.equal(say(p).textContent, "That link isn't a calendar Glaze can read.");
  assert.equal(say(p).getAttribute('role'), 'alert');
  // At the limit exactly, it still reads.
  const q = page();
  const full = new Uint8Array(5 << 20).fill(10);
  full.set(new TextEncoder().encode(ICS));
  q.serve(full);
  await linkRead(q);
  assert.equal(q.streams[0].cancelled, false);
  assert.equal(q.dialog().querySelectorAll('.gz-cl-entry').length, 1);
});

test('a calendar the reader refuses says so in the page\'s language, and anything unexpected still reads as a failure', async () => {
  require('../i18n/fr.js');
  const FR = globalThis.GZ_LANGS.fr;
  const fr = (k, v) => (FR[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? '');
  const paste = async (p, ics) => {
    p.c.GZ_CTX.t = fr;
    await p.ui.open();
    p.find(FR['Import a schedule']).fire('click');
    p.dialog().querySelector('textarea').value = ics;
    p.find(FR['Read schedule']).fire('click');
    await settle();
  };
  // A time zone with more changes than the reader keeps.
  const zone = ['BEGIN:VTIMEZONE', 'TZID:Far', ...Array.from({ length: 1001 }, () => ['BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0000', 'END:STANDARD']).flat(), 'END:VTIMEZONE'];
  const p = page();
  await paste(p, ICS.replace('VERSION:2.0', ['VERSION:2.0', ...zone].join('\r\n')));
  assert.equal(say(p).textContent, FR['This calendar is too big to read.']);
  assert.equal(say(p).getAttribute('role'), 'alert');
  for (const [thrown, shown] of [
    [new RangeError('calendar file too large'), 'This calendar is too big to read.'],
    [new RangeError('calendar too complex'), 'This calendar is too big to read.'],
    [new RangeError('calendar time zone too large'), 'This calendar is too big to read.'],
    [new TypeError("Cannot read properties of undefined (reading 'x')"), "Couldn't read that."],
  ]) {
    const q = page();
    q.c.GZ_CLASSES = { ...C, fromIcs: () => { throw thrown; } };
    await paste(q, ICS);
    assert.ok(FR[shown], shown);
    assert.equal(say(q).textContent, FR[shown], thrown.message);
    assert.equal(q.find(FR['Read schedule']).disabled, false);
  }
});

for (const how of ['done', 'large', 'abort', 'error']) test(`a calendar body releases its reader after ${how}`, async () => {
  const p = page();
  let body, cancel = 0;
  p.c.fetch = async (_, { signal }) => {
    body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(ICS));
        if (how === 'done') controller.close();
        if (how === 'large') controller.enqueue(new Uint8Array(5 << 20));
        signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
      },
      pull(controller) { if (how === 'error') controller.error(new TypeError('network interrupted')); },
      cancel() { cancel++; },
    });
    return new Response(body);
  };
  await linkRead(p);
  if (how === 'abort') { p.find('Stop reading').fire('click'); await settle(); stopped(p); }
  if (how === 'done') assert.equal(p.dialog().querySelectorAll('.gz-cl-entry').length, 1);
  if (how === 'large') assert.equal(cancel, 1);
  assert.equal(body.locked, false, 'the response body must not retain its reader');
});

test('a calendar response without a body is refused without buffering a fallback', async () => {
  const p = page();
  p.c.fetch = async () => ({ ok: true, body: null, arrayBuffer() { assert.fail('must not buffer'); } });
  await linkRead(p);
  assert.equal(say(p).textContent, "That link isn't a calendar Glaze can read.");
});

for (const how of ['fetch', 'body', 'file', 'dependency', 'text', 'document', 'known']) test(`schedule ${how} errors use translated student-facing words`, async () => {
  require('../i18n/fr.js');
  const FR = globalThis.GZ_LANGS.fr, p = page();
  p.c.GZ_CTX.t = (k, v) => (FR[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? '');
  const fail = () => { throw new TypeError('untranslated browser or parser error'); };
  if (how === 'text') p.c.GZ_CLASSES = { ...C, fromText: fail };
  await p.ui.open();
  p.find(FR['Import a schedule']).fire('click');
  if (how === 'fetch' || how === 'body') {
    p.dialog().all.find((n) => n.type === 'url').value = `${ORIGIN}/calendar.ics`;
    p.c.fetch = how === 'fetch' ? fail : async () => new Response(new ReadableStream({ start(c) { c.error(new TypeError('network interrupted')); } }));
  } else if (how === 'file') {
    p.dialog().querySelector('input').files = [{ name: 'schedule.ics', size: 1, arrayBuffer: fail }];
  } else if (how === 'document' || how === 'known') {
    p.dialog().querySelector('input').files = [{ name: 'schedule.pdf', size: 1 }];
    p.c.GZ_IMPORT.read = how === 'document' ? fail : () => { throw Object.assign(new Error(FR['That file is too large.']), { mine: true }); };
  } else {
    p.dialog().querySelector('textarea').value = how === 'text' ? 'BIO 1100 Mon 9:00-10:00' : ICS;
    if (how === 'dependency') p.c.GZ_CTX.need = fail;
  }
  p.find(FR['Read schedule']).fire('click');
  await settle();
  assert.equal(say(p).textContent, FR[how === 'known' ? 'That file is too large.' : "Couldn't read that."]);
  assert.equal(say(p).getAttribute('role'), 'alert');
  assert.equal(p.find(FR['Read schedule']).disabled, false);
});
