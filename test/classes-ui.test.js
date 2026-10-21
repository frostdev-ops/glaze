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
  const sent = [], held = [], replies = [], imports = [];
  let hold = false, holdReplies = false, feed = new TextEncoder().encode(ICS);
  const c = {
    console, URL, Intl, AbortController, TextDecoder, document, location: { origin: ORIGIN, host: 'canvas.test' },
    fetch: async (u) => {
      if (hold) await new Promise((res) => held.push(res));
      return { ok: String(u).startsWith(ORIGIN), text: async () => new TextDecoder().decode(feed), arrayBuffer: async () => feed.slice().buffer };
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
  return { ui, box, sent, imports, document, dialog, find, serve: (b) => { feed = b; }, hold: () => { hold = true; }, release: () => { hold = false; held.splice(0).forEach((r) => r()); },
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
  const ID = 'glaze-test-id', SITE = 'https://school.instructure.com', K = C.storeKey(SITE, '3');
  const data = { [K]: { courses: [{ id: '25', name: 'Biology', at: 100, periods: [{ days: [2], start: 810, end: 885 }] }] } };
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
