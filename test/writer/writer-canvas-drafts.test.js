// What Glaze keeps of a Canvas Rich Content Editor box for Writer (writer/page/drafts.js keep and offer, writer/drafts.js),
// over one storage.local two page loads share: a copy is offered back in an empty box unless Canvas already has it as what
// the student submitted or posted there, and a quiz attempt's copy stays that attempt's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El, matches } = require('../stand-in-dom.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://canvas.school.test';
const TEXT = 'An answer long enough for Glaze to keep a copy of it.';
const SERVER = Date.UTC(2026, 10, 11, 12), AHEAD = SERVER + 5 * 60000; // the device's clock, five minutes ahead of Canvas's

// A page load: its box (a textarea Canvas marked data-rich_text), Canvas's API answers (capi) and the device's clock.
const load = ({ store, path: pathname, box, capi = async () => { throw new Error('offline'); }, now }) => {
  const doc = {};
  doc.root = new El('html', doc);
  const add = (tag, attrs = {}, parent = doc.root) => {
    const e = new El(tag, doc);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (attrs.id) e.id = attrs.id;
    if (attrs.value) e.value = attrs.value;
    parent.append(e);
    return e;
  };
  const ed = box(add);
  for (const e of [doc.root, ...doc.root.all()]) e.matches = (s) => matches(e, s);
  const local = {
    get: (k, cb) => { const r = k === null ? structuredClone(store) : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, structuredClone(store[x])])); Promise.resolve().then(() => cb(r)); },
    getKeys: async () => Object.keys(store),
    set: (o, cb) => { Object.assign(store, structuredClone(o)); cb?.(); },
    remove: (k, cb) => { for (const x of [].concat(k)) delete store[x]; cb?.(); },
  };
  class Clock extends Date { static now() { return now; } constructor(...a) { super(...(a.length ? a : [now])); } }
  const session = new Map();
  const ctx = vm.createContext({
    location: { origin: ORIGIN, pathname }, document: { querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), addEventListener() {} },
    Element: El, Date: Clock, Promise, console, setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, btoa, atob,
    sessionStorage: { get length() { return session.size; }, key: (i) => [...session.keys()][i], getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, v), removeItem: (k) => session.delete(k) },
    chrome: { runtime: { sendMessage: (m, cb) => cb?.({ ok: false }) }, storage: { local } },
    GZ_PAGE: { describe: () => ({ rel: 'a moment ago' }) },
  });
  ctx.globalThis = ctx;
  ctx.GZ_CTX = {
    site: 'canvas', t: (k) => k, locale: () => 'en', settings: () => ({ enabled: true, enhance: { drafts: true } }), on: () => true,
    local: (fn) => fn(local), capi, profile: async () => ({ id: 7 }), canvasCourses: async () => [],
    draftEditor: '#compose-message-modal textarea[data-testid="message-body"]',
    draftAt: (e) => ({ ed: e, id: e.id, near: '', path: pathname, at: now, text: e.value, html: e.value, to: [] }),
  };
  vm.runInContext(read('writer/drafts.js'), ctx);
  vm.runInContext(read('writer/page/drafts.js'), ctx);
  // Writer keeps what its frame holds as a snapshot of the box (writer/page/writer.js remember).
  const keep = async (text = TEXT) => { ctx.GZ_DRAFT_UI.keep({ ...ctx.GZ_CTX.draftAt(ed), html: `<p>${text}</p>`, text, at: now }, true); await settle(); };
  const offer = async () => { const d = await ctx.GZ_DRAFT_UI.offer(ed); return d && d.text; };
  return { ed, keep, offer };
};
// Canvas's answer, with its own clock in the Date header (whole seconds), as capi hands the response to its reply callback.
const canvas = (answers, server) => async (u, reply) => {
  if (!(u in answers)) throw new Error('offline');
  reply?.({ headers: { get: (k) => (k.toLowerCase() === 'date' ? new Date(server).toUTCString() : null) } });
  return answers[u];
};
const rce = (id, parent, attrs = {}) => (add) => add('textarea', { id, 'data-rich_text': 'true', ...attrs }, parent ? parent(add) : undefined);

test('Canvas RCE: with the device clock five minutes ahead, a copy Canvas already has as the submission is not offered again', async () => {
  const store = {}, at = '/courses/34/assignments/238', box = rce('submission_body');
  await load({ store, path: at, box, now: AHEAD }).keep();
  assert.equal(await load({ store, path: at, box, now: AHEAD + 60000 }).offer(), TEXT, 'offline: offered');
  const submission = canvas({ '/courses/34/assignments/238/submissions/self': { submitted_at: new Date(SERVER + 1000).toISOString(), body: `<p>${TEXT}</p>` } }, SERVER + 60000);
  assert.equal(await load({ store, path: at, box, now: AHEAD + 60000, capi: submission }).offer(), null, 'Restore would submit it twice');
});

const topic = '/courses/34/discussion_topics/80';
const view = (entries, server) => canvas({ '/courses/34/discussion_topics/80/view': { view: entries } }, server);
test('Canvas RCE: with the device clock five minutes ahead, a reply already posted is not offered again', async () => {
  const store = {}, box = rce('message-body-5');
  await load({ store, path: topic, box, now: AHEAD }).keep();
  const posted = view([{ id: 5, user_id: 9, created_at: new Date(SERVER - 3600000).toISOString(), message: '<p>A question.</p>',
    replies: [{ id: 12, user_id: 7, parent_id: 5, created_at: new Date(SERVER + 1000).toISOString(), message: `<p>${TEXT}</p>` }] }], SERVER + 60000);
  assert.equal(await load({ store, path: topic, box, now: AHEAD + 60000, capi: posted }).offer(), null);
});

test('Canvas RCE: a reply deep in a thread, which Canvas files under an entry above the one replied to, is not offered again', async () => {
  const old = new Date(SERVER - 600000).toISOString(), now = new Date(SERVER + 2000).toISOString();
  const thread = (mine) => [{ id: 5, user_id: 9, created_at: old, message: '<p>A question.</p>', replies: [
    { id: 11, user_id: 8, parent_id: 5, created_at: old, message: '<p>An answer.</p>', replies: [
      { id: 12, user_id: 9, parent_id: 11, created_at: old, message: '<p>A follow-up.</p>', replies: [
        { id: 14, user_id: 8, parent_id: 12, created_at: old, message: '<p>Deeper.</p>' }] }] },
    ...mine] }];
  // At depth 3 (entry 12) Canvas files the reply under 12's parent, 11; deeper (14), under the thread's first entry, 5.
  for (const [box, parent] of [['message-body-12', 11], ['message-body-14', 5]]) {
    const store = {};
    await load({ store, path: topic, box: rce(box), now: SERVER }).keep();
    const elsewhere = view(thread([{ id: 20, user_id: 7, parent_id: 99, created_at: now, message: `<p>${TEXT}</p>` }]), SERVER + 60000);
    assert.equal(await load({ store, path: topic, box: rce(box), now: SERVER + 60000, capi: elsewhere }).offer(), TEXT, `${box}: posted in another thread proves nothing`);
    const posted = view(thread([{ id: 20, user_id: 7, parent_id: parent, created_at: now, message: `<p>${TEXT}</p>` }]), SERVER + 60000);
    assert.equal(await load({ store, path: topic, box: rce(box), now: SERVER + 60000, capi: posted }).offer(), null, box);
  }
});

test('Canvas quiz: a retake is not offered an earlier attempt\'s answer; the same attempt still is', async () => {
  const store = {}, at = '/courses/36/quizzes/56/take';
  const quiz = (attempt) => rce('question_input_0', (add) => { const f = add('form', { id: 'submit_quiz_form' }); add('input', { type: 'hidden', name: 'attempt', value: attempt }, f); return f; }, { class: 'question_input', name: 'question_442' });
  await load({ store, path: at, box: quiz('1'), now: SERVER }).keep();
  assert.equal(await load({ store, path: at, box: quiz('2'), now: SERVER + 3600000 }).offer(), null, 'attempt 2');
  assert.equal(await load({ store, path: at, box: quiz('1'), now: SERVER + 60000 }).offer(), TEXT, 'attempt 1, after a reload');
});
