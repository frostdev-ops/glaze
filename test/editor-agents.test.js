// Settings → Agents (lib/editor-agents.js) on stand-in elements, with a stand-in worker answering glaze:mcp-config as
// lib/background.js does: off by default, nativeMessaging asked for first in the switch's click (never on Safari), off sent
// before the permission goes, the link's state read from storage.session mcpLink and asked of the worker only as the page
// opens and once after a wait on Starting… (Chrome), a line for every state lib/agent-link.js reports, the apps' cards and their groups, the activity list (metadata only),
// hidden on iOS and Android, and every word in every language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const I = require('../lib/i18n.js');
const L = require('../lib/agent-link.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(setImmediate); };
const RUNTIME_ID = 'abcdefghijklmnopabcdefghijklmnop';
const URLS = { chrome: `chrome-extension://${RUNTIME_ID}/`, firefox: 'moz-extension://5d4c3b2a-0000-4000-8000-000000000000/', safari: 'safari-web-extension://8F2E1D3C-0000-4000-8000-000000000000/' };
const A = 'aaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbb', C = 'cccccccccccccccc', D = 'dddddddddddddddd';
const tEn = (k, v) => I.t(k, v, 'en');

// page({ browser, os, on, link, apps, mods, calls, grant, fail, embedded }): Settings with the Agents section mounted.
//   on: the worker's consent; link: storage.session mcpLink; apps: the worker's paired apps (lib/mcp/grants.js records);
//   mods: glaze:mods list's records; calls: storage.local mcpCalls; grant: the browser's answer to the permission request;
//   fail: config ops the worker refuses.
const page = ({ browser = 'chrome', os = 'mac', on = false, link, apps = [], mods = [], calls, grant = true, fail = [], embedded = false, next, reply = (m, r) => r, readStorage = (area, keys, r) => r } = {}) => {
  const ids = new Map(), sent = [], asked = [], removed = [], copied = [], listeners = [], log = [], reloads = [], timers = new Map();
  let timer = 0;
  let gesture = false;
  const doc = { activeElement: null };
  const walk = (e) => (e && typeof e === 'object' ? [e, ...e.children.flatMap(walk)] : []);
  const el = (tag = 'div') => {
    const e = { tagName: tag.toUpperCase(), children: [], textContent: '', id: '', hidden: false, disabled: false, checked: false, className: '', type: '', href: '', attrs: {}, dataset: {}, on: {},
      append(...k) { this.children.push(...k.map((x) => (typeof x === 'string' ? Object.assign(el('#text'), { textContent: x }) : x))); },
      replaceChildren(...k) { this.children = []; this.append(...k); },
      setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
      addEventListener(type, f) { (this.on[type] ||= []).push(f); }, focus() { doc.activeElement = this; },
      // A <dialog>: closed by one of its form's buttons (value) or by Esc (nothing).
      open: false, returnValue: '', showModal() { this.open = true; }, close(value) { this.open = false; if (value !== undefined) this.returnValue = value; for (const f of this.on.close || []) f(); } };
    return e;
  };
  const byId = (id) => {
    for (const r of ids.values()) { const f = walk(r).slice(1).find((x) => x.id === id); if (f) return f; }
    if (!ids.has(id)) { const e = el(); e.id = id; ids.set(id, e); }
    return ids.get(id);
  };
  Object.assign(doc, { createElement: el, getElementById: byId, addEventListener() {}, querySelector: () => null });
  const area = (name, data) => ({
    data,
    get: async (keys) => readStorage(name, keys, structuredClone(Object.fromEntries([].concat(keys).filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]])))),
    set: async (patch) => { Object.assign(data, structuredClone(patch)); for (const f of listeners) f(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { newValue: structuredClone(v) }])), name); },
  });
  const local = area('local', { mcp: { on }, ...(calls && { mcpCalls: structuredClone(calls) }) });
  const session = area('session', link ? { mcpLink: structuredClone(link) } : {});
  // The worker, as lib/background.js mcpConfig answers.
  const worker = { on, apps: structuredClone(apps), link: link || { state: 'off', at: null } };
  const config = async (m) => {
    if (fail.includes(m.op)) return { ok: false, error: 'failed' };
    if (m.op === 'state') return { ok: true, on: worker.on, link: worker.link };
    if (m.op === 'set') {
      worker.on = m.on;
      await local.set({ mcp: { on: m.on } });
      worker.link = m.on ? (next || { state: 'restart', at: 10 }) : { state: 'off', at: 11 };
      await session.set({ mcpLink: worker.link });
      return { ok: true, link: worker.link };
    }
    if (m.op === 'apps') return { ok: true, apps: structuredClone(worker.apps) };
    if (m.op === 'grant') {
      const a = worker.apps.find((x) => x.id === m.app);
      if (!a) return { ok: false };
      if (m.on) a.grants[m.group] = true; else delete a.grants[m.group];
      return { ok: true };
    }
    if (m.op === 'revoke') { worker.apps = worker.apps.filter((x) => x.id !== m.app); return { ok: true }; }
    if (m.op === 'forget') { worker.apps = []; return { ok: true }; }
    return { ok: false, error: 'op' };
  };
  const chrome = {
    runtime: {
      id: RUNTIME_ID, getURL: (p) => URLS[browser] + p, getPlatformInfo: async () => ({ os }), reload: () => { reloads.push({ gesture }); },
      sendMessage: async (m) => {
        sent.push(structuredClone(m));
        log.push(`send ${m.type} ${m.op}`);
        if (m.type === 'glaze:mods') return m.op === 'list' ? { ok: true, mods: structuredClone(mods) } : { ok: false };
        return m.type === 'glaze:mcp-config' ? reply(m, await config(m)) : undefined;
      },
    },
    storage: { local, session, onChanged: { addListener: (f) => listeners.push(f) } },
    permissions: {
      request: (p) => { asked.push({ p: structuredClone(p), gesture, before: sent.length }); log.push('request'); return Promise.resolve(grant); },
      remove: async (p) => { removed.push(structuredClone(p)); log.push('remove'); return true; },
    },
  };
  const navigator = { clipboard: { writeText: async (s) => { copied.push(s); } } };
  const lifecycle = {};
  const window = { addEventListener: (type, f) => { (lifecycle[type] ||= []).push(f); } }; window.top = embedded ? {} : window;
  const hints = [];
  // The page's timers run only when a test says the time has passed (elapse).
  const setTimeout = (f, ms) => { timers.set(++timer, { f, ms }); return timer; }, clearTimeout = (id) => { timers.delete(id); };
  const ctx = vm.createContext({ chrome, window, navigator, document: doc, URL, Promise, Date, Number, Array, Object, Math, Map, Set, JSON, structuredClone, setTimeout, clearTimeout });
  vm.runInContext(read('lib/editor-agents.js'), ctx);
  ctx.GZ_AGENTSEDIT.mount({ t: tEn, when: (at) => `@${at}`, day: (at) => `#${at}`, hint: (s) => hints.push(s) });
  const $ = (id) => doc.getElementById(id);
  const target = (x) => (typeof x === 'string' ? $(x) : x);
  const fire = (x, type) => { const e = target(x); gesture = true; try { for (const f of e.on[type] || []) f({ isTrusted: true, target: e, currentTarget: e, preventDefault() {} }); } finally { gesture = false; } };
  const all = (e = null) => (e ? [e.textContent, e.href, ...Object.values(e.attrs), ...e.children.flatMap((k) => all(k))] : [...ids.values()].flatMap((x) => all(x)));
  const p = {
    $, sent, asked, removed, copied, hints, log, worker, local, session, walk, reloads, doc,
    waits: () => [...timers.values()].map((x) => x.ms),
    timerIds: () => [...timers.keys()],
    lifecycle: async (type, event = {}) => { for (const f of lifecycle[type] || []) f(event); await settle(); },
    elapse: async () => { for (const [k, x] of [...timers]) { timers.delete(k); x.f(); } await settle(); },
    ops: () => sent.filter((m) => m.type === 'glaze:mcp-config').map((m) => m.op),
    all,
    // A checkbox's click: the browser flips it, then the listeners run.
    toggle: async (x) => { const e = target(x); e.checked = !e.checked; fire(e, 'click'); await settle(); },
    click: async (x) => { fire(x, 'click'); await settle(); },
    linked: async (state, more = {}) => { await session.set({ mcpLink: { state, at: 5, ...more } }); await settle(); },
    line: () => text($('agents-line')),
    cards: () => $('agents-apps').children,
    card: (name) => $('agents-apps').children.find((li) => walk(li).some((x) => x.tagName === 'B' && x.textContent === name)),
    button: (within, words) => walk(within).find((x) => x.tagName === 'BUTTON' && text(x) === words),
    switches: (li) => walk(li).filter((x) => x.tagName === 'LABEL').map((l) => [text(l.children[0]), l.children[1].checked]),
    switchOf: (li, words) => walk(li).find((x) => x.tagName === 'LABEL' && text(x.children[0]) === words).children[1],
    rows: () => $('agents-calls').children.map((li) => li.children.map(text).join(' | ')),
  };
  return p;
};
const text = (e) => (e && typeof e === 'object' ? `${e.textContent}${e.children.map(text).join('')}` : '');
const open = async (opts) => { const p = page(opts); await settle(); return p; };
const E = () => require('../lib/editor-agents.js');

test('off by default: the switch is off, no state shows, and the worker is asked once for its state and apps', async () => {
  const p = await open();
  assert.equal(p.$('agents').hidden, false);
  assert.equal(p.$('agents-on').checked, false);
  assert.equal(p.$('agents-state').hidden, true);
  assert.equal(p.$('agents-apps-box').hidden, true, 'no apps: nothing to show');
  assert.equal(p.$('agents-activity').hidden, true);
  assert.deepEqual(p.ops().sort(), ['apps', 'state']);
  assert.deepEqual(p.asked, []);
  assert.deepEqual(p.removed, []);
  assert.match(read('options.html'), /<input type="checkbox" role="switch" id="agents-on" aria-label="Agent access" data-local>/, 'the switch is not checked in the page');
});

test('on Firefox, the same click also asks for the website-content consent the listing declares, and off gives both back', async () => {
  const p = await open({ browser: 'firefox' });
  await p.toggle('agents-on');
  assert.deepEqual(p.asked[0].p, { permissions: ['nativeMessaging'], data_collection: ['websiteContent'] });
  assert.equal(p.asked[0].gesture, true, 'asked inside the click, before any await');
  await p.toggle('agents-on');
  assert.deepEqual(p.removed, [{ permissions: ['nativeMessaging'], data_collection: ['websiteContent'] }]);
});

test('turning on asks for nativeMessaging first, in the click, then has the worker turn on; its link state shows', async () => {
  const p = await open();
  const before = p.sent.length;
  await p.toggle('agents-on');
  assert.equal(p.asked.length, 1);
  assert.deepEqual(p.asked[0].p, { permissions: ['nativeMessaging'] });
  assert.equal(p.asked[0].gesture, true, 'asked inside the click, before any await');
  assert.equal(p.asked[0].before, before, 'nothing was sent before the browser was asked');
  assert.deepEqual(p.sent.filter((m) => m.op === 'set'), [{ type: 'glaze:mcp-config', op: 'set', on: true }]);
  assert.equal(p.$('agents-on').checked, true);
  assert.equal(p.$('agents-state').hidden, false);
  assert.equal(p.line(), 'Starting…', 'the owner\'s restart decision: the grant waits for the next worker');
});

test('a refused permission leaves agent access off and tells the worker nothing', async () => {
  const p = await open({ grant: false });
  await p.toggle('agents-on');
  assert.equal(p.asked.length, 1);
  assert.equal(p.sent.filter((m) => m.op === 'set').length, 0);
  assert.equal(p.$('agents-on').checked, false);
  assert.equal(p.$('agents-state').hidden, true);
});

test('a worker that can\'t save leaves the switch as it was and says so', async () => {
  const p = await open({ fail: ['set'] });
  await p.toggle('agents-on');
  assert.equal(p.$('agents-on').checked, false);
  assert.equal(p.$('agents-said').hidden, false);
  assert.equal(text(p.$('agents-said')), 'Could not save. Try again.');
});

test('a set that fails after saving shows the consent the worker actually holds', async () => {
  for (const on of [false, true]) {
    const p = await open({ on, link: { state: on ? 'connected' : 'off', at: 1 }, reply: (m, r) => m.op === 'set' ? { ok: false } : r });
    await p.toggle('agents-on');
    assert.equal(p.worker.on, !on);
    assert.equal(p.$('agents-on').checked, !on, `saved ${!on}, even though the set reply failed`);
    assert.equal(text(p.$('agents-said')), 'Could not save. Try again.');
    assert.equal(p.$('agents-state').hidden, on);
  }
  const p = await open({ on: true, link: { state: 'connected', at: 1 }, fail: ['set'] });
  await p.toggle('agents-on');
  assert.equal(p.$('agents-on').checked, true, 'failed before saving: still on');
  assert.deepEqual(p.removed, [], 'the worker still holds on: keep its permission');
});

test('an opening state reply cannot undo a completed click', async () => {
  const gate = deferred();
  let first = true;
  const p = page({ reply: async (m, r) => {
    if (m.op === 'state' && first) { first = false; await gate.promise; }
    return r;
  } });
  await settle();
  await p.toggle('agents-on');
  assert.equal(p.$('agents-on').checked, true);
  gate.resolve();
  await settle();
  assert.equal(p.$('agents-on').checked, p.worker.on, 'the opening snapshot is older than the click');
  assert.equal(p.line(), 'Starting…');
});

test('cancelling permission keeps a pending opening consent read valid', async () => {
  const gate = deferred();
  const p = page({ on: true, grant: false, reply: async (m, r) => { if (m.op === 'state') await gate.promise; return r; } });
  await settle();
  await p.toggle('agents-on');
  gate.resolve();
  await settle();
  assert.equal(p.$('agents-on').checked, p.worker.on);
  assert.deepEqual(p.ops().filter((op) => op === 'set'), [], 'permission was cancelled');
});

test('opening storage snapshots cannot replace newer link and activity events', async () => {
  const gate = deferred();
  const p = page({ on: true, link: { state: 'restart', at: 1 }, calls: [], readStorage: async (area, keys, r) => { await gate.promise; return r; } });
  await settle();
  await p.linked('connected');
  await p.local.set({ mcpCalls: [{ at: 100, app: A, tool: 'courses_list', outcome: 'ok' }] });
  await settle();
  gate.resolve();
  await settle();
  assert.equal(p.line(), 'Ready', 'the live session event wins over the opening snapshot');
  assert.deepEqual(p.rows(), ['courses_list | @100 · Done']);
});

test('another Settings tab can turn access off while this tab awaits its set reply', async () => {
  const gate = deferred();
  const p = await open({ reply: async (m, r) => { if (m.op === 'set') await gate.promise; return r; } });
  await p.toggle('agents-on');
  p.worker.on = false;
  await p.local.set({ mcp: { on: false } });
  await p.linked('off');
  gate.resolve();
  await settle();
  assert.equal(p.$('agents-on').checked, false, 'the worker has since turned off');
  assert.equal(p.$('agents-state').hidden, true);
});

test('turning off has the worker let go first, then gives the permission back', async () => {
  const p = await open({ on: true, link: { state: 'connected', at: 1 } });
  assert.equal(p.$('agents-on').checked, true);
  assert.equal(p.line(), 'Ready');
  await p.toggle('agents-on');
  assert.deepEqual(p.asked, [], 'turning off asks for nothing');
  const set = p.log.indexOf('send glaze:mcp-config set'), remove = p.log.indexOf('remove');
  assert.ok(set >= 0 && remove > set, p.log.join(', '));
  assert.deepEqual(p.removed, [{ permissions: ['nativeMessaging'] }]);
  assert.equal(p.$('agents-on').checked, false);
  assert.equal(p.$('agents-state').hidden, true);
});

test('Safari holds nativeMessaging from the start: nothing is asked for or given back', async () => {
  const p = await open({ browser: 'safari' });
  await p.toggle('agents-on');
  assert.deepEqual(p.asked, []);
  assert.equal(p.$('agents-on').checked, true);
  await p.toggle('agents-on');
  assert.deepEqual(p.removed, []);
  assert.deepEqual(p.sent.filter((m) => m.op === 'set').map((m) => m.on), [true, false]);
});

test('the link state follows storage.session mcpLink; a state change asks the worker nothing, and nothing polls', async () => {
  const p = await open({ on: true, link: { state: 'restart', at: 1 } });
  assert.equal(p.line(), 'Starting…');
  const sent = p.sent.length;
  await p.linked('connecting');
  assert.equal(p.line(), 'Starting…');
  await p.linked('connected', { host: '1.0.0', browser: 'chrome' });
  assert.equal(p.line(), 'Ready');
  await p.linked('exited', { error: 'Native host has exited.' });
  assert.match(p.line(), /^The helper stopped/);
  assert.equal(p.sent.length, sent, 'a state change sends nothing');
  assert.deepEqual(p.waits(), [], 'no timer outside Starting…');
  const js = read('lib/editor-agents.js').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(js, /setInterval|requestIdleCallback/, 'no poll');
  assert.equal(js.match(/setTimeout\(/g).length, 1, 'one timer: Starting…\'s wait');
});

// Finding 2 of the 4.0.0 beta: on Chrome a worker that predates the grant has no connectNative, and Chrome starts the next
// one only for an event, which an open Settings never sent, so Starting… stayed until something else woke Glaze.
test('Starting… on Chrome is bounded: after the wait the page asks the worker once, and the state it answers shows', async () => {
  const { WAIT } = E();
  assert.ok(WAIT > 40e3 && WAIT <= 60e3, `${WAIT}: past Chrome's idle stop (30 s, checked every 10 s), within a minute`);
  const p = await open({ on: true, link: { state: 'restart', at: 1 } });
  assert.equal(p.line(), 'Starting…');
  assert.deepEqual(p.waits(), [WAIT]);
  const before = p.ops().length;
  // A worker started for the ask connects as it starts; the helper isn't installed.
  p.worker.link = { state: 'not-installed', at: 20, error: 'Specified native messaging host not found.' };
  await p.elapse();
  assert.deepEqual(p.ops().slice(before), ['state'], 'one ask');
  assert.equal(p.line(), 'In Claude Desktop, add the Glaze extension. For other apps, run npx glaze-mcp setup');
  assert.deepEqual(p.waits(), [], 'and no poll after it');
});

test('a worker still without connectNative after the wait: the line says to restart the browser, and Glaze reloads nothing', async () => {
  const p = await open({ on: true, link: { state: 'restart', at: 1 } });
  await p.elapse();
  assert.equal(p.line(), 'Restart your browser to start the helper');
  assert.equal(p.$('agents-state').dataset.tone, 'bad');
  assert.equal(p.$('agents-copy').hidden, true);
  assert.equal(p.$('agents-allow').hidden, true);
  assert.deepEqual(p.reloads, [], 'Glaze never reloads itself: open documents and Writer saves stay as they are');
  assert.deepEqual(p.waits(), [], 'asked once');
  // Whatever the worker writes next replaces it.
  await p.linked('connected');
  assert.equal(p.line(), 'Ready');
});

test('the wait belongs to Starting…: a newer state, a newer write than the ask, or off ends it', async () => {
  const p = await open({ on: true, link: { state: 'restart', at: 1 } });
  await p.linked('connected');
  assert.deepEqual(p.waits(), []);
  await p.linked('connecting');
  assert.equal(p.waits().length, 1, 'Starting… again, a wait again');
  await p.toggle('agents-on');
  assert.equal(p.$('agents-on').checked, false);
  assert.deepEqual(p.waits(), []);

  const gate = deferred();
  const q = await open({ on: true, link: { state: 'restart', at: 1 }, reply: async (m, r) => { if (m.op === 'state' && gate.armed) await gate.promise; return r; } });
  gate.armed = true;
  const asking = q.elapse();
  await q.linked('connected');
  gate.resolve();
  await asking;
  assert.equal(q.line(), 'Ready', 'the worker\'s write after the ask wins over its answer');
});

test('opening Settings on a restart left by an earlier worker waits again from the start', async () => {
  const p = await open({ on: true, link: { state: 'restart', at: 1 } });
  assert.deepEqual(p.ops().filter((o) => o === 'state'), ['state'], 'asked once as it opens, a trigger in the worker');
  assert.equal(p.waits().length, 1);
});

test('connecting and restart share one Starting… wait and one ask', async () => {
  const p = await open({ on: true, link: { state: 'restart', at: 1 } });
  const timer = p.timerIds();
  await p.linked('connecting');
  assert.deepEqual(p.timerIds(), timer, 'the same Starting… line keeps its original deadline');
  p.worker.link = { state: 'restart', at: 20 };
  const before = p.ops().length;
  await p.elapse();
  assert.equal(p.line(), 'Restart your browser to start the helper', 'the one answer of restart says so at once');
  assert.deepEqual(p.waits(), [], 'the answer never starts a second wait');
  await p.linked('restart');
  await p.elapse();
  assert.deepEqual(p.ops().slice(before), ['state'], 'still only one ask in this Starting… episode');
});

test('a recheck from an earlier Starting… episode cannot offer Restart in a fresh one', async () => {
  const gate = deferred();
  const p = await open({ on: true, link: { state: 'restart', at: 1 }, reply: async (m, r) => {
    if (m.op === 'state' && gate.armed) { gate.armed = false; await gate.promise; }
    return r;
  } });
  gate.armed = true;
  const asking = p.elapse();
  await p.toggle('agents-on');
  await p.toggle('agents-on');
  assert.equal(p.line(), 'Starting…');
  gate.resolve();
  await asking;
  assert.equal(p.line(), 'Starting…', 'the old answer cannot consume the new episode\'s wait');
  assert.deepEqual(p.waits(), [E().WAIT]);
});

test('leaving Settings cancels its wait, including late opening reads, and a restored page waits afresh', async () => {
  const p = await open({ on: true, link: { state: 'restart', at: 1 } });
  const before = p.ops().length;
  await p.lifecycle('pagehide');
  assert.deepEqual(p.waits(), [], 'no timer survives pagehide');
  await p.linked('connecting');
  await p.elapse();
  assert.deepEqual(p.ops().slice(before), [], 'a hidden page cannot re-arm the wait');
  await p.lifecycle('pageshow', { persisted: true });
  assert.deepEqual(p.waits(), [E().WAIT], 'a restored page has one fresh wait');

  const gate = deferred();
  const q = page({ on: true, link: { state: 'restart', at: 1 }, reply: async (m, r) => {
    if (m.op === 'state') await gate.promise;
    return r;
  } });
  await settle();
  await q.lifecycle('pagehide');
  gate.resolve();
  await settle();
  assert.deepEqual(q.waits(), [], 'an opening reply after pagehide cannot start a wait');
});

test('Firefox and Safari keep their lines: no wait, no ask, no restart', async () => {
  const { line } = E();
  for (const browser of ['firefox', 'safari']) {
    const p = await open({ browser, on: true, link: { state: 'connecting', at: 1 } });
    assert.equal(p.line(), 'Starting…', browser);
    assert.deepEqual(p.waits(), [], browser);
    await p.linked('restart');
    assert.deepEqual(p.waits(), [], browser);
    assert.equal(line({ state: 'restart', at: 1 }, { browser, stuck: true }, tEn).text, 'Starting…', browser);
  }
});

test('Settings has no control that reloads Glaze, on any browser', async () => {
  assert.ok(!/id="agents-restart"/.test(read('options.html')));
  for (const browser of ['chrome', 'firefox', 'safari']) {
    const p = await open({ browser, on: true, link: { state: 'restart', at: 1 } });
    await p.elapse();
    assert.deepEqual(p.reloads, [], browser);
  }
});

test('every state lib/agent-link.js reports has its line, with the command to run and Copy', async () => {
  const { line, NO_NODE } = E();
  const states = [...L.STATES, NO_NODE];
  for (const browser of ['chrome', 'firefox']) {
    for (const state of states) {
      const l = line({ state, at: 1 }, { browser, id: RUNTIME_ID }, tEn);
      if (state === 'off') { assert.equal(l, null); continue; }
      assert.ok(l && l.text && ['ok', 'wait', 'bad'].includes(l.tone), `${browser} ${state}`);
      if (l.command) assert.equal(l.text.split('{command}').length, 2, `${state}: the command goes in its sentence once`);
    }
  }
  // On Safari the helper is the Glaze app, which starts by itself; there is no permission to ask for and no command.
  for (const state of ['restart', 'connecting', 'connected', 'exited', 'not-installed', 'old-helper']) {
    const l = line({ state, at: 1 }, { browser: 'safari' }, tEn);
    assert.ok(l && !l.command, `safari ${state}`);
  }
  const p = await open({ on: true, link: { state: 'not-installed', at: 1, error: 'Specified native messaging host not found.' } });
  assert.equal(p.line(), 'In Claude Desktop, add the Glaze extension. For other apps, run npx glaze-mcp setup');
  const code = p.walk(p.$('agents-line')).find((x) => x.tagName === 'CODE');
  assert.equal(code.textContent, 'npx glaze-mcp setup');
  assert.equal(code.attrs.translate, 'no');
  assert.equal(code.attrs.dir, 'ltr');
  assert.equal(p.$('agents-copy').hidden, false);
  await p.click('agents-copy');
  assert.deepEqual(p.copied, ['npx glaze-mcp setup']);
  assert.deepEqual(p.hints, ['Copied.']);
  const want = {
    forbidden: `npx glaze-mcp setup --extension-id ${RUNTIME_ID}`,
    exited: 'The helper stopped; Glaze is retrying. npx glaze-mcp doctor says why.',
    'old-helper': 'Update the helper: npx glaze-mcp@latest setup',
    restart: 'Starting…', connecting: 'Starting…', connected: 'Ready',
    [NO_NODE]: 'Install Node.js 18+ for browsers to start the helper',
    'needs-permission': 'Allow Glaze to start the helper',
  };
  for (const [state, words] of Object.entries(want)) {
    await p.linked(state);
    assert.equal(p.line(), words, state);
    assert.equal(p.$('agents-copy').hidden, !['forbidden', 'exited', 'old-helper'].includes(state), `${state}: Copy`);
    assert.equal(p.$('agents-allow').hidden, state !== 'needs-permission', `${state}: Allow`);
    assert.equal(p.$('agents-state').dataset.tone, state === 'connected' ? 'ok' : ['restart', 'connecting'].includes(state) ? 'wait' : 'bad', `${state}: tone`);
  }
  await p.linked('forbidden');
  await p.click('agents-copy');
  assert.equal(p.copied.at(-1), `npx glaze-mcp setup --extension-id ${RUNTIME_ID}`);
  await p.linked('off');
  assert.equal(p.$('agents-state').hidden, true);
});

test('Firefox: asked in the click; a helper that doesn\'t list Glaze reads as not-installed, whose line runs setup; exited has no error of its own', async () => {
  const p = await open({ browser: 'firefox', next: { state: 'not-installed', at: 10, error: 'No such native application io.frostdev.glaze_mcp' } });
  await p.toggle('agents-on');
  assert.equal(p.asked.length, 1);
  assert.equal(p.asked[0].gesture, true, 'Firefox forgets the gesture across an await');
  assert.equal(p.line(), 'In Claude Desktop, add the Glaze extension. For other apps, run npx glaze-mcp setup');
  await p.linked('exited');
  assert.equal(p.line(), 'The helper stopped; Glaze is retrying. npx glaze-mcp doctor says why.', 'Firefox gives no error text');
  await p.linked('connected');
  assert.equal(p.line(), 'Ready', 'connected at once after the grant: no restart on Firefox');
});

test('the Claude Desktop bundle\'s no-node state, as its helper reports it', async () => {
  const p = await open({ on: true, link: { state: 'no-node', at: 1, error: 'no-node' } });
  assert.equal(p.line(), 'Install Node.js 18+ for browsers to start the helper');
  assert.equal(p.$('agents-copy').hidden, true);
});

test('needs-permission: Allow asks for nativeMessaging in its click, and nothing else', async () => {
  const p = await open({ on: true, link: { state: 'needs-permission', at: 1 } });
  const sent = p.sent.length;
  await p.click('agents-allow');
  assert.equal(p.asked.length, 1);
  assert.equal(p.asked[0].gesture, true);
  assert.equal(p.sent.length, sent, 'the worker hears permissions.onAdded itself');
});

test('Safari: the Glaze app from frostdev.io, which starts by itself', async () => {
  const p = await open({ browser: 'safari', on: true, link: { state: 'not-installed', at: 1, error: 'no agent bridge' } });
  assert.equal(p.line(), 'Agent access in Safari needs the Glaze app from frostdev.io');
  assert.equal(p.$('agents-app').hidden, false);
  assert.equal(p.$('agents-copy').hidden, true);
  assert.match(read('options.html'), /<a id="agents-app" href="https:\/\/frostdev\.io\/glaze" target="_blank" rel="noopener" translate="no" hidden>frostdev\.io\/glaze<\/a>/);
  await p.linked('connecting');
  assert.equal(p.line(), 'Starting…');
  assert.equal(p.$('agents-app').hidden, true);
  await p.linked('exited');
  assert.equal(p.line(), 'The Glaze app stopped; Glaze is retrying.');
  await p.linked('old-helper');
  assert.equal(p.line(), 'Update the Glaze app from frostdev.io');
  assert.equal(p.$('agents-app').hidden, false);
});

const APPS = [
  { id: A, name: 'Claude Code', exe: '/usr/local/bin/claude', verified: true, at: 1000, used: 5000, grants: { courses: true, [`mod:${B}`]: true }, declined: {} },
  { id: C, name: 'Cursor', exe: '/Applications/Cursor.app/Contents/MacOS/Cursor', verified: true, at: 2000, used: 2000, grants: {}, declined: { pair: 3000 } },
];
const MODS = [
  { id: B, manifest: { name: 'Due Soon', tools: [{ name: 'due' }] }, prompt: { name: 'Due Soon' }, enabled: true },
  { id: D, manifest: { name: 'No Tools' }, prompt: { name: 'No Tools' }, enabled: true },
];

test('an app\'s card: its name as it reports itself, its program, when it was paired and last used, a switch per group and per mod with tools, and Revoke', async () => {
  const p = await open({ apps: APPS, mods: MODS });
  assert.equal(p.$('agents-apps-box').hidden, false, 'apps show with agent access off too, so they can be revoked');
  assert.equal(p.cards().length, 2);
  const card = p.card('Claude Code');
  assert.ok(p.all(card).includes('as the app reports itself'));
  assert.ok(p.all(card).includes('/usr/local/bin/claude'));
  assert.ok(p.all(card).includes('Paired #1000 · Last used @5000'));
  assert.deepEqual(p.switches(card), [['Courses, to-dos and schedule', true], ['Grades', false], ['Writer documents', false], ['Assignments and rubrics', false], ['The mod Due Soon', true]]);
  assert.ok(!p.all(card).some((x) => /No Tools/.test(x)), 'a mod without agent tools has no switch');
  const grades = p.switchOf(card, 'Grades');
  assert.equal(grades.attrs.role, 'switch');
  assert.ok(Object.hasOwn(grades.attrs, 'data-local'));
  await p.toggle(grades);
  assert.deepEqual(p.sent.filter((m) => m.op === 'grant'), [{ type: 'glaze:mcp-config', op: 'grant', app: A, group: 'grades', on: true }]);
  assert.equal(p.worker.apps[0].grants.grades, true);
  assert.equal(p.switchOf(p.card('Claude Code'), 'Grades').checked, true);
  await p.toggle(p.switchOf(p.card('Claude Code'), 'The mod Due Soon'));
  assert.equal(p.sent.filter((m) => m.op === 'grant').at(-1).group, `mod:${B}`);
  assert.equal(p.worker.apps[0].grants[`mod:${B}`], undefined);
  await p.click(p.button(p.card('Claude Code'), 'Revoke'));
  assert.deepEqual(p.sent.filter((m) => m.op === 'revoke'), [{ type: 'glaze:mcp-config', op: 'revoke', app: A }]);
  assert.equal(p.card('Claude Code'), undefined);
});

test('a refused grant puts its switch back', async () => {
  const p = await open({ apps: APPS, mods: MODS, fail: ['grant'] });
  await p.toggle(p.switchOf(p.card('Claude Code'), 'Grades'));
  assert.equal(p.switchOf(p.card('Claude Code'), 'Grades').checked, false);
  assert.equal(text(p.$('agents-said')), 'Could not save. Try again.');
});

test('a declined app says so and has only Forget, which lets it ask again', async () => {
  const p = await open({ apps: APPS, mods: MODS });
  const card = p.card('Cursor');
  assert.ok(p.all(card).includes('Declined'));
  assert.deepEqual(p.switches(card), [], 'a declined app holds no groups');
  assert.equal(p.button(card, 'Revoke'), undefined);
  await p.click(p.button(card, 'Forget'));
  assert.deepEqual(p.sent.filter((m) => m.op === 'revoke'), [{ type: 'glaze:mcp-config', op: 'revoke', app: C }]);
});

test('Forget all apps forgets every app; a mod group an app still holds shows by its id once the mod is gone', async () => {
  const p = await open({ apps: APPS, mods: [] });
  assert.deepEqual(p.switches(p.card('Claude Code')).at(-1), [`The mod ${B}`, true]);
  await p.click('agents-forget');
  p.$('agents-forget-ask').close('ok');
  await settle();
  assert.deepEqual(p.ops().filter((o) => o === 'forget'), ['forget']);
  assert.equal(p.cards().length, 0);
  assert.equal(p.$('agents-apps-box').hidden, true);
});

// Finding 9 of the 4.0.0 beta: Forget all apps cleared every app and the activity list in one click. It asks first, as
// Settings → Writer's Clear all papers and documents does, in a <dialog>, never the browser's confirm().
test('Forget all apps asks first: Cancel (which has the focus) and Esc keep every app; only Forget all forgets', async () => {
  const p = await open({ apps: APPS, mods: MODS });
  const ask = p.$('agents-forget-ask'), forgets = () => p.ops().filter((o) => o === 'forget');
  await p.click('agents-forget');
  assert.equal(ask.open, true, 'a question first');
  assert.equal(p.doc.activeElement, p.$('agents-forget-cancel'), 'Cancel has the focus');
  assert.deepEqual(forgets(), []);
  ask.close('cancel');
  await settle();
  assert.deepEqual(forgets(), [], 'Cancel');
  await p.click('agents-forget');
  ask.close();
  await settle();
  assert.deepEqual(forgets(), [], 'Esc');
  assert.equal(p.cards().length, 2);
  await p.click('agents-forget');
  assert.equal(ask.returnValue, '', 'each question starts unanswered');
  ask.close('ok');
  await settle();
  assert.deepEqual(forgets(), ['forget']);
  assert.equal(p.cards().length, 0);

  const html = read('options.html'), js = read('lib/editor-agents.js').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(js, /\bconfirm\(/);
  assert.match(html, /<button type="button" class="wr-danger" id="agents-forget">Forget all apps<\/button>/, 'drawn as Clear all papers and documents is');
  const dialog = html.slice(html.indexOf('<dialog id="agents-forget-ask"'), html.indexOf('</dialog>', html.indexOf('<dialog id="agents-forget-ask"')));
  assert.match(dialog, /^<dialog id="agents-forget-ask" aria-labelledby="agents-forget-title" aria-describedby="agents-forget-note">\s*<form method="dialog">/);
  assert.match(dialog, /<h3 id="agents-forget-title">Forget all apps\?<\/h3>/);
  assert.match(dialog, /<p class="desc" id="agents-forget-note">[^<]+<\/p>/);
  assert.match(dialog, /<button value="cancel" id="agents-forget-cancel">Cancel<\/button><button value="ok" class="primary wr-go">Forget all<\/button>/);
  assert.ok(html.indexOf('<dialog id="agents-forget-ask"') > html.indexOf('<div id="panel-backup"'), 'outside the sections, so settings search never hides it');
  assert.match(html, /:is\(#writer-clear, #agents-forget-ask\) \.wr-go/, 'its Forget all is drawn as Clear all is');
  const words = [...dialog.matchAll(/>([^<]+)</g)].map((m) => m[1].trim()).filter((w) => /\p{L}/u.test(w));
  assert.equal(words.length, 4, words.join(' | '));
  for (const lang of Object.keys(globalThis.GZ_LANGS)) for (const w of words) assert.notEqual(I.t(w, {}, lang), w, `${lang}: "${w}"`);
});

test('the activity list: time, app, tool and outcome, newest first, and nothing else of a row', async () => {
  const calls = [
    { at: 100, app: A, tool: 'courses_list', group: 'courses', kind: 'read', outcome: 'ok', ms: 12 },
    { at: 200, app: 'zzzzzzzzzzzzzzzz', tool: 'todo_mark_done', group: 'courses', kind: 'write', outcome: 'declined', ms: 4000 },
    { at: 50, app: A, tool: 'courses_list', outcome: 'weird' },
    { at: 60, app: A, tool: '<b>x</b>', outcome: 'ok' },
    { at: 300, app: A, tool: 'grades_list', group: 'grades', kind: 'read', outcome: 'error', ms: 30, secret: 'LEAKED' },
    'not a row',
  ];
  const p = await open({ apps: APPS, calls });
  assert.equal(p.$('agents-activity').hidden, false);
  assert.deepEqual(p.rows(), ['grades_list · Claude Code | @300 · Failed', 'todo_mark_done | @200 · Declined', 'courses_list · Claude Code | @100 · Done']);
  assert.ok(p.$('agents-calls').children[0].children[1].className.includes('bad'), 'a failure stands out');
  assert.ok(!p.all().some((x) => /LEAKED|weird|<b>/.test(String(x))), 'nothing but metadata');
  await p.local.set({ mcpCalls: [...calls, { at: 400, app: A, tool: 'schedule_list', outcome: 'timeout' }] });
  await settle();
  assert.equal(p.rows()[0], 'schedule_list · Claude Code | @400 · Timed out', 'a new row shows as it is recorded');
  assert.ok(p.ops().filter((o) => o === 'apps').length >= 2, 'and the apps are read again, for their last use');
  const { outcome, OUTCOMES } = E();
  assert.deepEqual(OUTCOMES, require('../lib/mcp/grants.js').OUTCOMES, 'every outcome lib/mcp/grants.js records');
  for (const o of OUTCOMES) assert.notEqual(outcome(o, tEn), o, o);
  assert.equal(outcome('invalid', tEn), 'Invalid request', "an app's malformed call is not the student's refusal");
  assert.notEqual(outcome('invalid', tEn), outcome('refused', tEn));
});

test('hidden on iOS and Android, where no helper can run; the worker is asked nothing there', async () => {
  for (const os of ['ios', 'android']) {
    const p = await open({ os });
    assert.equal(p.$('agents').hidden, true, os);
    assert.deepEqual(p.sent, [], os);
  }
});

test('embedded Settings mounts nothing: the AI panel opens in a tab of its own', async () => {
  const p = await open({ embedded: true, apps: APPS });
  assert.deepEqual(p.sent, []);
  assert.deepEqual(p.$('agents-apps').children, []);
});

test('the page: Agents is the AI tab\'s last section, Extension only, with a jump link, local controls, every id once and its script before options.js', () => {
  const html = read('options.html'), js = read('lib/editor-agents.js'), opts = read('options.js');
  const panel = html.slice(html.indexOf('<div id="panel-ai"'), html.indexOf('<div id="panel-backup"'));
  assert.match(panel, /<section id="agents" data-editor-section="ai\/agents" data-sites="Extension only" aria-labelledby="heading-ai-agents">/);
  const routes = [...panel.matchAll(/data-editor-section="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(routes.at(-1), 'ai/agents');
  assert.match(html, /<div data-editor-jumps="ai" hidden>(?:<a [^>]+>[^<]+<\/a>)*<a href="#ai\/agents" data-editor-jump>Agents<\/a><\/div>/);
  for (const [, tag] of panel.matchAll(/(<input[^>]*>)/g)) assert.match(tag, /data-local/, tag);
  assert.match(opts, /GZ_AGENTSEDIT\.mount\(/);
  const drawn = new Set([...js.matchAll(/\.id = '([\w-]+)'/g)].map((m) => m[1]));
  const used = new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]).filter((id) => !drawn.has(id)));
  assert.ok(used.size >= 12, String([...used]));
  for (const id of used) assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
  const order = ['lib/editor-agents.js', 'options.js'].map((f) => html.indexOf(`<script src="${f}"></script>`));
  assert.ok(order[0] > 0 && order[1] > order[0], String(order));
  assert.match(panel, /id="agents-line" role="status" aria-live="polite"/);
  assert.match(panel, /id="agents-said" role="status" aria-live="polite"/);
});

test('every word of Settings → Agents is in every language', () => {
  const html = read('options.html'), js = read('lib/editor-agents.js').replace(/\/\/[^\n]*/g, '');
  const section = html.slice(html.indexOf('<section id="agents"'), html.indexOf('</section>', html.indexOf('<section id="agents"')));
  const fromHtml = [...section.replace(/<(\w+)[^>]*translate="no"[^>]*>[\s\S]*?<\/\1>/g, '').matchAll(/>([^<]+)</g)].map((m) => m[1].replace(/\s+/g, ' ').trim()).filter((s) => /\p{L}/u.test(s));
  const fromJs = [...js.matchAll(/\bt\('((?:\\.|[^'\\])*)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  const words = new Set([...fromHtml, ...fromJs, 'Agents', 'Agent access']);
  assert.ok(words.size > 25, `${words.size} words`);
  for (const [lang, cat] of Object.entries(globalThis.GZ_LANGS)) for (const w of words) assert.ok(w in cat, `${lang}: "${w}"`);
  // The commands stay as they are, in every language.
  for (const lang of Object.keys(globalThis.GZ_LANGS)) {
    for (const k of ['In Claude Desktop, add the Glaze extension. For other apps, run {command}', 'The helper stopped; Glaze is retrying. {command} says why.', 'Update the helper: {command}']) {
      assert.equal(I.t(k, {}, lang).split('{command}').length, 2, `${lang}: ${k}`);
    }
  }
});
