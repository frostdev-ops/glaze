const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const P = require('../lib/pet.js'), T = require('../lib/todo.js'), { El } = require('./stand-in-dom.js');
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
const page = ({ delayed = false, record = { earned: { 'work:assignment:1': 20 } }, world = false } = {}) => {
  const doc = { activeElement: null }, storage = [], events = [], timers = new Map(), win = [], mounts = [], settings = { enabled: true, enhance: { pet: true } }; let next = 0, release;
  const make = (tag) => new El(tag, doc);
  doc.root = make('html'); doc.head = make('head'); doc.body = make('body'); doc.root.append(doc.head, doc.body);
  Object.assign(doc, { visibilityState: 'visible', createElement: make, getElementById: (id) => doc.root.all().find((e) => e.id === id), querySelector: (sel) => doc.root.querySelector(sel),
    addEventListener: (type, f) => events.push({ type, f }), removeEventListener: (type, f) => { const i = events.findIndex((x) => x.type === type && x.f === f); if (i >= 0) events.splice(i, 1); } });
  const profile = delayed ? new Promise((res) => { release = res; }) : Promise.resolve({ uid: '3', tz: 'UTC' });
  const c = { document: doc, console, URL, Date, Intl, Map, Set, Object, Number, Math, Array, String, Promise,
    GZ_PET: P, GZ_PET_BRAIN: require('../lib/petbrain.js'), GZ_TODO: T, GZ_CTX: { site: 'canvas', t: (k, v) => k.replace(/\{(\w+)\}/g, (m, n) => v && n in v ? v[n] : m), settings: () => settings, need: async () => {} },
    addEventListener: (type, f, opts) => win.push({ type, f, opts }), removeEventListener: (type, f) => { const i = win.findIndex((x) => x.type === type && x.f === f); if (i >= 0) win.splice(i, 1); },
    ...(world && { GZ_WIDGETS_UI: { who: async () => ({ uid: '3', tz: 'UTC' }), register() {} }, GZ_PET_WORLD: { mount: (stage, o) => { mounts.push({ stage, o }); return { stop() {}, play() {} }; }, refresh() {}, stop() {} } }),
    location: { origin: 'https://canvas.test' }, setTimeout: (f, ms) => { timers.set(++next, { f, ms }); return next; }, clearTimeout: (id) => timers.delete(id),
    chrome: { runtime: { id: 'glaze', getURL: (p) => `chrome-extension://x/${p}`, sendMessage: (m, cb) => cb({ ok: true, data: P.view(record) }) },
      storage: { onChanged: { addListener: (f) => storage.push(f), removeListener: (f) => { const i = storage.indexOf(f); if (i >= 0) storage.splice(i, 1); } } } } };
  c.globalThis = c; vm.createContext(c);
  const ui = vm.runInContext(fs.readFileSync(require.resolve('../features/pet.js'), 'utf8'), c);
  const body = make('div'); doc.body.append(body);
  c.window = c;
  return { ui, body, doc, storage, events, timers, win, mounts, settings, fire: (type, e = {}) => { for (const l of win.filter((x) => x.type === type)) { if (l.opts?.once) win.splice(win.indexOf(l), 1); l.f({ type, ...e }); } },
    write: (value) => { for (const f of [...storage]) f({ 'pet:https://canvas.test/3': { newValue: value } }, 'local'); }, chrome: c.chrome, release: () => release({ uid: '3', tz: 'UTC' }), api: { who: () => profile } };
};
test('pet mount stops storage/visibility listeners and its clock, without leaving a stylesheet link', async () => {
  const p = page(), tile = p.ui.mount(p.body, p.api); await settle();
  assert.equal(p.storage.length, 1); assert.equal(p.events.length, 1); assert.equal(p.timers.size, 1);
  tile.stop();
  assert.equal(p.storage.length, 0); assert.equal(p.events.length, 0); assert.equal(p.timers.size, 0);
  assert.equal(p.doc.head.querySelectorAll('link').length, 0);
});
test('a pet removed before identity resolves never registers listeners or schedules a clock', async () => {
  const p = page({ delayed: true }), tile = p.ui.mount(p.body, p.api);
  tile.stop(); p.release(); await settle();
  assert.equal(p.storage.length, 0); assert.equal(p.events.length, 0); assert.equal(p.timers.size, 0);
});

test('a reload stops the habitat before its next timer or late profile can repaint', async () => {
  const p = page(), live = p.ui.mount(p.body, p.api); await settle();
  delete p.chrome.runtime.id;
  live.update(); await settle();
  assert.equal(p.storage.length + p.events.length + p.timers.size, 0);
  const q = page({ delayed: true }); q.ui.mount(q.body, q.api); delete q.chrome.runtime.id;
  q.release(); await settle();
  assert.equal(q.storage.length + q.timers.size, 0);
});

test('animated characters hide Classic outfits without changing the saved outfit', async () => {
  const record = { sprite: 'rime', wear: 'bandana', earned: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`work:assignment:${i}`, 20])) };
  const p = page({ record }), live = p.ui.mount(p.body, p.api, { inDialog: true }); await settle();
  let wear = p.body.querySelector('[data-control="wear"]');
  assert.equal(wear.parentElement.hidden, true); assert.equal(wear.value, 'bandana');
  record.sprite = ''; live.update(); await settle();
  wear = p.body.querySelector('[data-control="wear"]');
  assert.equal(wear.parentElement.hidden, false); assert.equal(wear.value, 'bandana');
  assert.equal(record.wear, 'bandana'); live.stop();
});

// WID-4: the habitat's record is rewritten by the pet's own decisions; a write must not rebuild controls the student is using.
const B = require('../lib/petbrain.js');
const learned = (n) => B.learn(B.clean(), 'walk', B.vector({}), 1 + n * 0);
const level = { earned: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`work:assignment:${i}`, 20])) };
test('WID-4: a write that changes nothing shown keeps the same controls, open panel and focus', async () => {
  const p = page({ record: level }), live = p.ui.mount(p.body, p.api); await settle();
  const tab = p.body.querySelector('[data-control="tab:decor"]');
  for (const l of tab.listeners.filter((x) => x.type === 'click')) l.f({ isTrusted: true });
  const habitat = p.body.querySelector('[data-control="habitat"]'), settings = p.body.querySelector('[data-panel="decor"]');
  assert.equal(settings.hidden, false); habitat.focus();
  p.write(JSON.parse(JSON.stringify(level))); p.write(structuredClone(level)); live.update(); await settle(); live.update(); await settle();
  // Identity checks use ok(): a failed equal on two elements tries to print their whole documents.
  assert.ok(p.body.querySelector('[data-control="habitat"]') === habitat, 'the select is the same element');
  assert.ok(p.doc.activeElement === habitat);
  assert.ok(p.body.querySelector('[data-panel="decor"]') === settings); assert.equal(settings.hidden, false);
  assert.equal(p.body.querySelector('[data-control="tab:decor"]').getAttribute('aria-expanded'), 'true');
  live.stop();
});
test('WID-4: a decision that only teaches the pet updates the numbers in place, not the controls', async () => {
  const record = { ...level }, p = page({ record }), live = p.ui.mount(p.body, p.api, { inDialog: true }); await settle();
  const habitat = p.body.querySelector('[data-control="habitat"]'), wear = p.body.querySelector('[data-control="wear"]');
  assert.match(p.body.textContent, /Learned interactions: 0/);
  p.write({ ...level, brain: learned(0) }); await settle();
  assert.match(p.body.textContent, /Learned interactions: 1/);
  assert.ok(p.body.querySelector('[data-control="habitat"]') === habitat); assert.ok(p.body.querySelector('[data-control="wear"]') === wear);
  live.stop();
});
test('WID-4: a real change to what a control shows still rebuilds it', async () => {
  const p = page({ record: level }), live = p.ui.mount(p.body, p.api, { inDialog: true }); await settle();
  p.write({ ...level, habitat: 'garden' }); await settle();
  assert.equal(p.body.querySelector('[data-control="habitat"]').value, 'garden');
  p.write({ ...level, habitat: 'garden', physics: false }); await settle();
  assert.equal(p.body.querySelector('[data-control="physics"]').checked, false);
  live.stop();
});

test('bonding cooldown updates the button and readout without replacing an open habitat select', async () => {
  const p = page({ record: level }), live = p.ui.mount(p.body, p.api); await settle();
  const select = p.body.querySelector('[data-control="habitat"]'); select.focus();
  p.write({ ...level, care: { day: T.dayOf(Date.now(), 'UTC'), used: 1, at: Date.now(), zone: 'UTC' } }); await settle();
  assert.ok(p.body.querySelector('[data-control="habitat"]') === select, 'a care readout change does not close the select');
  assert.equal(p.body.querySelector('[data-control="pet"]').disabled, true);
  assert.match(p.body.textContent, /Ready again in a minute/);
  live.stop();
});

test('restoring an open habitat while disabled cannot remount its world', async () => {
  for (const off of ['enabled', 'pet']) {
    const p = page({ world: true }), live = p.ui.mount(p.body, p.api); await settle();
    const before = p.mounts.length;
    p.fire('pagehide', { persisted: true });
    if (off === 'enabled') p.settings.enabled = false; else p.settings.enhance.pet = false;
    p.fire('pageshow', { persisted: true }); await settle();
    assert.equal(p.mounts.length, before, off);
    assert.equal(p.storage.length, 0, 'disabled mount is stopped');
    live.stop();
  }
});
test('WID-4: the world is still handed every new record, even when no control changed', async () => {
  const p = page({ record: level, world: true }), live = p.ui.mount(p.body, p.api); await settle();
  const before = p.mounts.length;
  p.write({ ...level, positions: { books: { x: 40, y: 40 } }, decor: { books: 4 } }); await settle();
  assert.ok(p.mounts.length > before);
  assert.deepEqual(JSON.parse(JSON.stringify(p.mounts.at(-1).o.data.positions)), { books: { x: 40, y: 40 } });
  live.stop();
});

// WID-13
const open = async (p) => { await p.ui.open(); return p.doc.root.querySelector('dialog'); };
test('WID-13: Escape closes the habitat dialog and returns focus to what opened it', async () => {
  const p = page(), opener = new El('button', p.doc); p.doc.body.append(opener); opener.focus();
  const box = await open(p);
  assert.equal(box.open, true); assert.ok(p.doc.activeElement !== opener);
  let prevented = 0;
  box.dispatchEvent({ type: 'keydown', key: 'Escape', defaultPrevented: false, preventDefault() { prevented++; } });
  assert.equal(box.open, false); assert.equal(box.isConnected, false); assert.ok(p.doc.activeElement === opener); assert.equal(prevented, 1);
  assert.equal(p.storage.length, 0);
});
test('WID-13: Escape that something inside already used, and other keys, leave the dialog open', async () => {
  const p = page(), box = await open(p);
  box.dispatchEvent({ type: 'keydown', key: 'Escape', defaultPrevented: true, preventDefault() {} });
  box.dispatchEvent({ type: 'keydown', key: 'a', defaultPrevented: false, preventDefault() {} });
  assert.equal(box.open, true);
  box.close();
});

test('a delayed close event from the previous habitat cannot steal focus from its replacement', async () => {
  const p = page(), a = new El('button', p.doc), b = new El('button', p.doc); p.doc.body.append(a, b); a.focus();
  const first = await open(p);
  let finish;
  first.close = () => { first.open = false; finish = () => first.dispatchEvent({ type: 'close' }); };
  b.focus(); await p.ui.open();
  const second = p.doc.root.querySelectorAll('dialog').find((e) => e !== first);
  const focus = p.doc.activeElement;
  assert.ok(second.contains(focus));
  finish();
  assert.ok(p.doc.activeElement === focus, 'closing the old dialog cannot restore its old opener over the new one');
  second.close();
  assert.ok(p.doc.activeElement === b, 'the replacement restores its own opener');
});

// WID-10
test('WID-10: the wandering pet is mounted again after a back/forward-cache restore', async () => {
  const p = page({ record: { ...level, wander: true }, world: true });
  p.ui.resume(); await settle();
  assert.equal(p.mounts.length, 1); assert.equal(p.storage.length, 1);
  p.fire('pagehide', { persisted: true });
  assert.equal(p.storage.length, 0, 'the page lets go of its listener when it is put away');
  p.fire('pageshow', { persisted: false }); await settle();
  assert.equal(p.mounts.length, 1, 'an ordinary pageshow is not a restore');
  p.fire('pageshow', { persisted: true }); await settle();
  assert.equal(p.mounts.length, 2, 'the world is brought back'); assert.equal(p.storage.length, 1);
  assert.equal(p.mounts[1].o.data.wander, true);
});

test('a wandering-pet read from before pagehide cannot mount stale state after a restored read', async () => {
  const p = page({ world: true }), replies = [];
  p.chrome.runtime.sendMessage = (m, cb) => replies.push(cb);
  p.ui.resume(); await settle();
  assert.equal(replies.length, 1);
  p.fire('pagehide', { persisted: true }); p.fire('pageshow', { persisted: true }); await settle();
  assert.equal(replies.length, 2);
  replies[1]({ ok: true, data: P.view({ ...level, wander: false }) }); await settle();
  replies[0]({ ok: true, data: P.view({ ...level, wander: true }) }); await settle();
  assert.equal(p.mounts.length, 0, 'the pre-cache reply cannot resurrect a pet that is now home');
});
test('WID-10: a restore with the pet switched off in the meantime mounts nothing', async () => {
  const p = page({ record: { ...level, wander: true }, world: true });
  p.ui.resume(); await settle();
  p.fire('pagehide', { persisted: true });
  p.chrome.runtime.sendMessage = (m, cb) => cb({ ok: true, data: P.view({ ...level, wander: false }) });
  p.fire('pageshow', { persisted: true }); await settle();
  assert.equal(p.mounts.length, 1);
});
test('WID-10: an open habitat paints its world again after a restore', async () => {
  const p = page({ world: true }), box = await open(p); await settle();
  const before = p.mounts.length;
  assert.ok(before >= 1);
  p.fire('pagehide', { persisted: true }); p.fire('pageshow', { persisted: true }); await settle();
  assert.ok(p.mounts.length > before);
  box.close();
});

// A tile too small for the habitat's sections (apps.css shows More then) still reaches every action: More opens the whole
// habitat in its dialog, outside the tile. The dialog has them all at its size, so no More of its own.
test('More opens the whole habitat in its dialog, which has every action of the tile and no More', async () => {
  const p = page({ world: true }), live = p.ui.mount(p.body, p.api); await settle();
  const more = p.body.querySelector('[data-control="more"]');
  assert.ok(more, 'the tile has More');
  assert.equal(more.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(more.getAttribute('aria-label'), 'Open Pet habitat');
  const pat = p.body.querySelector('[data-control="pet"]');
  assert.equal(pat.title, p.body.querySelector('.gz-game-care').textContent, 'the Pet button carries the bonding sentence as its tooltip');
  for (const l of more.listeners.filter((x) => x.type === 'click')) l.f({ isTrusted: true });
  await settle();
  const box = p.doc.body.children.find((e) => e.tagName === 'DIALOG');
  assert.ok(box?.open, 'the habitat dialog is open');
  const ids = (root) => new Set(root.querySelectorAll('[data-control]').map((e) => e.dataset.control));
  assert.equal(ids(box).has('more'), false, 'the dialog has no More');
  for (const c of ids(p.body)) if (c !== 'more') assert.ok(ids(box).has(c), `${c} is in the dialog`);
  box.close(); live.stop();
});

// The habitat in a tile: the room first with name and level on it; today's bonding moments on the Pet button (the sentence its
// description); Wellbeing, Decorate and Progress as one-at-a-time panels; Settings only in the dialog; status only when out.
test('the habitat tile: allowance on the Pet button, one panel at a time, Settings in the dialog, status only while exploring', async () => {
  const p = page({ world: true }), live = p.ui.mount(p.body, p.api); await settle();
  const game = p.body.querySelector('.gz-game');
  assert.equal(game.children[0].className, 'gz-game-habitat', 'the room comes first');
  const pat = p.body.querySelector('[data-control="pet"]'), care = p.body.querySelector('.gz-game-care');
  assert.equal(pat.querySelector('.gz-game-left').textContent, '5/5');
  assert.equal(pat.getAttribute('aria-describedby'), care.id);
  assert.equal(care.textContent, '5 of 5 bonding moments left today');
  assert.equal(p.body.querySelectorAll('p.gz-game-care').length, 0, 'no helper line');
  const tabs = p.body.querySelectorAll('.gz-game-tab').map((b) => b.dataset.control);
  assert.deepEqual(tabs, ['tab:wellbeing', 'tab:decor', 'tab:about']);
  assert.equal(p.body.querySelector('[data-control="wear"]'), null, 'Settings is the dialog\'s');
  const click = (el) => { for (const l of el.listeners.filter((x) => x.type === 'click')) l.f({ isTrusted: true }); };
  const shown = () => p.body.querySelectorAll('.gz-game-panel').filter((e) => !e.hidden).map((e) => e.dataset.panel);
  assert.deepEqual(shown(), []);
  click(p.body.querySelector('[data-control="tab:decor"]')); assert.deepEqual(shown(), ['decor']);
  click(p.body.querySelector('[data-control="tab:about"]')); assert.deepEqual(shown(), ['about']);
  assert.equal(p.body.querySelector('[data-control="tab:decor"]').getAttribute('aria-expanded'), 'false');
  assert.match(p.body.querySelector('[data-panel="about"]').textContent, /total XP/, 'the XP numbers are in Progress');
  click(p.body.querySelector('[data-control="tab:about"]')); assert.deepEqual(shown(), [], 'pressed again, it closes');
  const status = p.body.querySelector('.gz-game-overview .gz-game-hint');
  assert.equal(status.hidden, true, 'no status at home');
  live.stop();
  const q = page({ world: true, record: { earned: { 'work:assignment:1': 20 }, wander: true } }), out = q.ui.mount(q.body, q.api); await settle();
  const away = q.body.querySelector('.gz-game-overview .gz-game-hint');
  assert.equal(away.hidden, false); assert.equal(away.textContent, 'Exploring the page');
  out.stop();
  const d = page({ world: true }), box = d.ui.mount(d.body, d.api, { inDialog: true }); await settle();
  assert.deepEqual(d.body.querySelectorAll('.gz-game-tab').map((b) => b.dataset.control), ['tab:wellbeing', 'tab:decor', 'tab:about', 'tab:settings']);
  assert.ok(d.body.querySelector('[data-panel="settings"] [data-control="wear"]'));
  box.stop();
});

test('closing More after changing the habitat returns focus to the tile’s current More button', async () => {
  const p = page({ world: true }), live = p.ui.mount(p.body, p.api); await settle();
  const more = p.body.querySelector('[data-control="more"]'); more.focus();
  for (const l of more.listeners.filter(x => x.type === 'click')) l.f({ isTrusted: true });
  await settle();
  const box = p.doc.root.querySelector('dialog');
  p.write({ ...level, habitat: 'garden' }); await settle();
  const current = p.body.querySelector('[data-control="more"]');
  assert.ok(current.isConnected, 'the tile keeps a reachable More button');
  box.close();
  assert.ok(p.doc.activeElement === current, 'focus returns to the connected More control after a repaint');
  live.stop();
});
