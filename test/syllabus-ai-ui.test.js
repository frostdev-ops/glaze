// H4: the syllabus import dialog (features/syllabus.js) with AI, on a stand-in page whose 'glaze:ai' port is a stub of the
// broker (lib/ai/broker.js): no port unless AI, a connection and syllabus import are all on; the status line while AI reads;
// Stop and closing the dialog cancel the run; a failed or stopped run leaves Glaze's own reading; the privacy line says
// where an endpoint's text goes; pictures go only to a model that takes them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://school.instructure.com';
const TEXT = 'Instructor: Dr. Amara Okafor\nMidterm exam: October 14, 2026\nHW 3 · Fri 9/25/2026';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

class El {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], attrs: {}, dataset: {}, style: {}, open: false, parentNode: null, on: {}, files: [], text: '' }); }
  append(...k) { for (const c of k) if (c && typeof c === 'object') { c.parentNode = this; this.children.push(c); } }
  prepend(...k) { this.append(...k); }
  before() {}
  replaceChildren(...k) { this.children = []; this.append(...k); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, f) { (this.on[type] ||= []).push(f); }
  fire(type, isTrusted = true) { for (const f of this.on[type] || []) f({ type, isTrusted, preventDefault() {} }); }
  get all() { return [this, ...this.children.flatMap((c) => c.all)]; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  contains() { return false; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get textContent() { return this.text; }
  set textContent(v) { this.text = String(v); }
}

// ai: storage.local ai; broker(m, post): the stub worker's answer to each message on the port.
// syllabus: Canvas's Syllabus page (#course_syllabus) as HTML, whose bar (Read this syllabus) is kept in bars.
const page = ({ ai, broker = () => {}, file = { name: 'syllabus.pdf' }, syllabus } = {}) => {
  const body = new El('body');
  const bars = [];
  const syl = syllabus && Object.assign(new El('div'), { innerHTML: syllabus, text: syllabus, before: (b) => bars.push(b) });
  const ports = [];
  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (m, cb) => cb?.(null),
      connect: ({ name }) => {
        const port = { name, sent: [], on: [], off: [], disconnected: false,
          onMessage: { addListener: (f) => port.on.push(f) }, onDisconnect: { addListener: (f) => port.off.push(f) },
          postMessage: (raw) => { const m = JSON.parse(JSON.stringify(raw)); port.sent.push(m); broker(m, (a) => setImmediate(() => { if (!port.disconnected) for (const f of port.on) f(structuredClone(a)); }), port); },
          disconnect: () => { port.disconnected = true; } };
        ports.push(port);
        return port;
      },
    },
    storage: { local: { get: (k, cb) => cb(ai === undefined ? {} : { ai }) }, onChanged: { addListener() {} } },
  };
  const ctx = vm.createContext({
    Intl, Date, JSON, Promise, Math, Number, String, Object, Array, Error, File, AbortController, Uint8Array, Set, Map, btoa, setTimeout, setImmediate,
    document: { body, activeElement: null, createElement: (t) => new El(t), getElementById: (id) => (id === 'course_syllabus' && syl) || null, querySelector: () => null },
    location: { origin: ORIGIN, pathname: '/courses/25/modules' },
    chrome,
    GZ_I18N: require('../lib/i18n.js'),
    GZ_IMPORT: { read: async () => ({ text: TEXT, ocr: null }), note: () => '', doubt: () => false },
    GZ_CTX: {
      t: (k, v) => (v ? k.replace(/\{(\w+)\}/g, (_, n) => v[n]) : k), locale: () => 'en', settings: () => ({ enabled: true, enhance: { syllabus: true } }), on: () => true, canvasCourseId: () => '25',
      profile: () => Promise.resolve({ id: 3 }), canvasCourses: () => Promise.resolve([{ id: '25', name: 'BIO 101 Cells', term: { start_at: '2026-08-24T00:00:00Z' } }]),
      need: (f, ready) => { if (!ready()) vm.runInContext(read(f), ctx); return Promise.resolve(); },
    },
  });
  vm.runInContext(read('features/syllabus.js'), ctx);
  const open = async () => { await ctx.GZ_SYL_UI.open(); await settle(); const dlg = body.children[0]; dlg.all.find((e) => e.id === 'gz-syl-file').files = [file]; return dlg; };
  const button = (dlg, text) => dlg.all.find((e) => e.tagName === 'BUTTON' && e.text === text);
  const statusLine = (dlg) => dlg.all.filter((e) => /gz-syl-status/.test(e.className || '')).at(-1)?.text;
  return { ctx, body, ports, bars, open, button, statusLine, title: (dlg) => dlg.all.find((e) => e.id === 'gz-syl-title')?.text };
};
const ON = { on: true, use: 'mine', features: { syllabus: true } };
// The stub broker: a status, then a run held until the test answers it.
const broker = ({ status = { on: true, allowed: true, ready: true, provider: 'device', caps: { images: true } }, runs = [] } = {}) => (m, post) => {
  if (m.op === 'status') post({ id: m.id, type: 'status', ...status });
  if (m.op === 'run') runs.push({ m, end: (output) => post({ id: m.id, type: 'end', output, meta: {} }), fail: (error) => post({ id: m.id, type: 'error', error }) });
};
const none = { text: null, quote: null };
const OUTPUT = { prof: { name: none, email: none, office: { text: 'Hollis 2140', quote: 'Instructor: Dr. Amara Okafor' }, note: none }, hours: [], meetings: [], scale: [], weights: [],
  dates: [{ title: 'HW 3', kind: 'due', when: 'Fri 9/25/2026', quote: 'HW 3 · Fri 9/25/2026' }], week1: none };
const reviewDates = (dlg) => dlg.all.filter((e) => /gz-syl-date/.test(e.className || '')).map((row) => row.children[0].value);

test('AI off, no connection, or syllabus import not allowed: no port is opened and the review is Glaze\'s own', async () => {
  for (const ai of [undefined, { ...ON, on: false }, { ...ON, use: null }, { ...ON, features: { syllabus: false } }]) {
    const p = page({ ai, broker: broker() });
    const dlg = await p.open();
    p.button(dlg, 'Read it').fire('click');
    await settle();
    assert.equal(p.ports.length, 0, JSON.stringify(ai));
    assert.equal(p.title(dlg), 'Check what Glaze found');
    assert.deepEqual(reviewDates(dlg), ['Midterm exam'], 'extract() alone');
  }
});

test('AI on: "Reading with AI…" while it reads, then the merged review with AI\'s values marked', async () => {
  const runs = [];
  const p = page({ ai: ON, broker: broker({ runs }) });
  const dlg = await p.open();
  p.button(dlg, 'Read it').fire('click');
  await settle();
  assert.equal(runs.length, 1);
  assert.deepEqual(Object.keys(runs[0].m).sort(), ['feature', 'id', 'input', 'op', 'task']);
  assert.deepEqual([runs[0].m.feature, runs[0].m.task, runs[0].m.input.text, runs[0].m.input.names], ['syllabus', 'syllabus.read', TEXT, ['BIO 101 Cells']]);
  assert.equal(p.statusLine(dlg), 'Reading with AI…');
  assert.equal(p.button(dlg, 'Stop reading').hidden, false);
  runs[0].end(OUTPUT);
  await settle();
  assert.equal(p.title(dlg), 'Check what Glaze found');
  assert.deepEqual(reviewDates(dlg), ['Midterm exam', 'HW 3']);
  const marks = dlg.all.filter((e) => /gz-syl-ai/.test(e.className || ''));
  assert.ok(marks.length >= 2 && marks.every((e) => e.text === 'Check this'), 'AI\'s values: "Check this", marked as AI\'s');
  assert.ok(dlg.all.some((e) => e.text === 'From: “HW 3 · Fri 9/25/2026”'), 'with their quote');
});

test('Stop while AI reads: the run is cancelled and Glaze\'s own reading is reviewed', async () => {
  const runs = [];
  const p = page({ ai: ON, broker: broker({ runs }) });
  const dlg = await p.open();
  p.button(dlg, 'Read it').fire('click');
  await settle();
  p.button(dlg, 'Stop reading').fire('click');
  await settle();
  assert.deepEqual(p.ports[0].sent.at(-1), { id: runs[0].m.id, op: 'cancel' });
  assert.equal(p.title(dlg), 'Check what Glaze found');
  assert.deepEqual(reviewDates(dlg), ['Midterm exam']);
  assert.equal(p.statusLine(dlg), 'Stopped.');
  runs[0].end(OUTPUT);
  await settle();
  assert.deepEqual(reviewDates(dlg), ['Midterm exam'], 'an answer after Stop changes nothing');
});

test('closing the dialog while AI reads cancels the run and closes the port', async () => {
  const runs = [];
  const p = page({ ai: ON, broker: broker({ runs }) });
  const dlg = await p.open();
  p.button(dlg, 'Read it').fire('click');
  await settle();
  dlg.close();
  await settle();
  assert.deepEqual(p.ports[0].sent.at(-1), { id: runs[0].m.id, op: 'cancel' });
  assert.equal(p.ports[0].disconnected, true);
  assert.equal(p.body.children.length, 0);
});

test('AI failing, or a syllabus too long for it, leaves Glaze\'s own reading, and the status line says so', async () => {
  for (const [error, said] of [['invalid-response', "AI couldn't read it. This is what Glaze read."], ['size', 'That syllabus is too long for AI. This is what Glaze read.']]) {
    const runs = [];
    const p = page({ ai: ON, broker: broker({ runs }) });
    const dlg = await p.open();
    p.button(dlg, 'Read it').fire('click');
    await settle();
    runs[0].fail(error);
    await settle();
    assert.equal(p.title(dlg), 'Check what Glaze found');
    assert.deepEqual(reviewDates(dlg), ['Midterm exam']);
    assert.equal(p.statusLine(dlg), said);
  }
  // Not ready (the model still downloading): no run at all.
  const runs = [];
  const p = page({ ai: ON, broker: broker({ runs, status: { on: true, allowed: true, ready: false, why: 'downloading' } }) });
  const dlg = await p.open();
  p.button(dlg, 'Read it').fire('click');
  await settle();
  assert.equal(runs.length, 0);
  assert.deepEqual(reviewDates(dlg), ['Midterm exam']);
});

test('the privacy line: this computer keeps the local words, an endpoint says its host', async () => {
  const local = 'Glaze reads it on this device. Nothing is sent anywhere, and nothing is kept until you check it and save.';
  const desc = (dlg) => dlg.all.find((e) => /gz-syl-desc/.test(e.className || '')).text;
  for (const [ai, status, want] of [
    [undefined, undefined, local],
    [ON, { on: true, allowed: true, ready: true, provider: 'device', caps: {} }, local],
    [ON, { on: true, allowed: true, ready: true, provider: 'openai', caps: {}, to: 'openrouter.ai' }, 'Glaze reads it and sends the text to openrouter.ai. Nothing is kept until you check it and save.'],
  ]) {
    const p = page({ ai, broker: broker({ status }) });
    const dlg = await p.open();
    assert.equal(desc(dlg), want);
  }
});

test('pictures go with the text only to a model that takes them', async () => {
  const file = { name: 'calendar.png', size: PNG.length, arrayBuffer: async () => PNG.buffer.slice(0), slice: (a, b) => ({ arrayBuffer: async () => PNG.buffer.slice(a, b) }) };
  for (const [caps, n] of [[{ images: true }, 1], [{ images: false }, 0], [{}, 0]]) {
    const runs = [];
    const p = page({ ai: ON, file, broker: broker({ runs, status: { on: true, allowed: true, ready: true, provider: 'device', caps } }) });
    const dlg = await p.open();
    p.button(dlg, 'Read it').fire('click');
    await settle();
    assert.equal(runs[0].m.input.images.length, n, JSON.stringify(caps));
    if (n) assert.deepEqual({ ...runs[0].m.input.images[0] }, { type: 'image', mime: 'image/png', data: Buffer.from(PNG).toString('base64') });
  }
});

test('Read this syllabus on Canvas\'s page: AI on this computer reads it too, an endpoint never without the dialog saying so', async () => {
  const html = '<p>Instructor: Dr. Amara Okafor</p><p>Midterm exam: October 14, 2026</p><p>HW 3 · Fri 9/25/2026</p>';
  for (const [status, runsWanted] of [[{ on: true, allowed: true, ready: true, provider: 'device', caps: {} }, 1], [{ on: true, allowed: true, ready: true, provider: 'openai', caps: {}, to: 'openrouter.ai' }, 0]]) {
    const runs = [];
    const p = page({ ai: ON, syllabus: html, broker: broker({ runs, status }) });
    p.ctx.GZ_SYL_UI.sync(true);
    await settle();
    p.bars[0].all.find((e) => e.tagName === 'BUTTON' && e.text === 'Read this syllabus').fire('click');
    await settle(30);
    assert.equal(runs.length, runsWanted, status.provider);
    runs[0]?.end(OUTPUT);
    await settle();
    const dlg = p.body.children[0];
    assert.equal(p.title(dlg), 'Check what Glaze found');
    assert.deepEqual(reviewDates(dlg), runsWanted ? ['Midterm exam', 'HW 3'] : ['Midterm exam']);
  }
  // AI off: straight to the review, as without AI.
  const p = page({ syllabus: html, broker: broker() });
  p.ctx.GZ_SYL_UI.sync(true);
  await settle();
  p.bars[0].all.find((e) => e.tagName === 'BUTTON' && e.text === 'Read this syllabus').fire('click');
  await settle(30);
  assert.equal(p.ports.length, 0);
  assert.deepEqual(reviewDates(p.body.children[0]), ['Midterm exam']);
});
