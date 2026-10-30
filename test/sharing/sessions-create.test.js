// Settings → Share sessions → Create a session: Create stays off, with the reason beside it, until it can succeed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
const A = 'notesIdx:https://canvas.school.edu/7', B = 'notesIdx:https://bb.school.edu/9';
const page = async (sources, options = {}) => {
  const nodes = new Map(), messages = [];
  class Element {
    constructor(tag = '') {
      this.tag = tag; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.children = []; this.events = {};
      const classes = new Set();
      this.classList = { contains: (k) => classes.has(k), toggle: (k, on) => (on ? classes.add(k) : classes.delete(k)) };
    }
    addEventListener(k, f) { this.events[k] = f; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    focus() {}
    querySelectorAll(selector) {
      const all = this.children.flatMap((e) => [e, ...(e.querySelectorAll?.('*') || [])]);
      return selector === '*' ? all : all.filter((e) => e.tag === 'input' && (selector !== 'input:checked' || e.checked));
    }
  }
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  node('#panel-backup').hidden = true;
  node('#ss-kind').value = 'notes';
  const state = { ok: true, on: false, sessions: options.sessions || [], sources, accounts: [], relay: 'https://share.frostdev.io', defaultRelay: 'https://share.frostdev.io', hosts: [] };
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/sessions-ui.js'), 'utf8'), {
    URL, URLSearchParams, location: { search: '' }, navigator: { userActivation: { isActive: true } }, addEventListener() {},
    GZ_I18N: { t: (k) => k, ui: () => 'en' }, GZ_NOTES: { KEY: /^notesIdx:/ }, GZ_RELAY: { normalize: (s) => s },
    document: { querySelector: node, createElement: (tag) => new Element(tag) },
    MutationObserver: class { observe() {} },
    chrome: {
      permissions: { request: options.permission || (async () => true) },
      runtime: { sendMessage: async (m) => { messages.push(m); return m.op === 'list' ? structuredClone(state) : { ok: true }; },
        connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() {} }) },
    },
  });
  await settle();
  const boxes = () => node('#ss-sources').querySelectorAll('input');
  const tick = async (...at) => { for (const i of at) { boxes()[i].checked = true; } node('#ss-sources').events.change({}); await settle(); };
  const create = node('#ss-create'), why = node('#ss-create-why');
  const kind = async (k) => { node('#ss-kind').value = k; node('#ss-kind').events.change({ isTrusted: true }); await settle(); };
  const title = async (v) => { node('#ss-title').value = v; node('#ss-title').events.input({}); await settle(); };
  return { node, create, why, boxes, tick, kind, title, messages };
};
const note = (key, id, title) => ({ kind: 'notes', key, ids: [id], title });

test('the markup starts Create off, described by the reason beside it', () => {
  assert.match(fs.readFileSync(require.resolve('../options.html'), 'utf8'), /<button type="button" id="ss-create" class="primary" aria-describedby="ss-create-why" disabled>Create encrypted session<\/button><span class="desc" id="ss-create-why" role="status"><\/span>/);
});

test('Notes: pick at least one note, from one account, a folder on its own, and a name', async () => {
  const p = await page([note(A, 'n1', 'Week 3'), note(A, 'n2', 'Week 4'), note(B, 'n3', 'Lab'), { kind: 'notes', key: A, folder: 'f1', title: 'Biology' }]);
  assert.equal(p.boxes().length, 4);
  assert.deepEqual([p.create.disabled, p.why.textContent], [true, 'Pick at least one note.']);
  await p.tick(0);
  assert.deepEqual([p.create.disabled, p.why.textContent], [false, ''], 'one note names the session after itself');
  await p.tick(1);
  assert.deepEqual([p.create.disabled, p.why.textContent], [true, 'Name the session.'], 'two notes need a name');
  await p.title('Biology notes');
  assert.deepEqual([p.create.disabled, p.why.textContent], [false, '']);
  await p.tick(2);
  assert.deepEqual([p.create.disabled, p.why.textContent], [true, 'Pick items from one account.']);
  p.boxes()[2].checked = false; await p.tick(3);
  assert.deepEqual([p.create.disabled, p.why.textContent], [true, 'Share a folder on its own, or choose notes instead.']);
  for (const b of p.boxes()) b.checked = false;
  await p.tick(3);
  assert.equal(p.create.disabled, false, 'a folder on its own');
  // A click while it can succeed creates; one that can't changes nothing.
  p.create.events.click({ isTrusted: true }); await settle();
  assert.ok(p.messages.some((m) => m.op === 'create' && m.folder === 'f1' && m.title === 'Biology notes'));
  assert.deepEqual([p.create.disabled, p.why.textContent], [true, 'Pick at least one note.'], 'the form clears and says what is next');
  const before = p.messages.length;
  p.create.events.click({ isTrusted: true }); await settle();
  assert.ok(!p.messages.slice(before).some((m) => m.op === 'create'));
});

test('Tasks: pick at least one task; a Look needs only a name', async () => {
  const p = await page([{ kind: 'todo', key: 'todo:https://canvas.school.edu/7', ids: ['t1'], title: 'Essay' }]);
  await p.kind('todo');
  assert.deepEqual([p.create.disabled, p.why.textContent], [true, 'Pick at least one task.']);
  await p.kind('look');
  assert.deepEqual([p.create.disabled, p.why.textContent], [true, 'Name the session.']);
  await p.title('My Look');
  assert.deepEqual([p.create.disabled, p.why.textContent], [false, '']);
});

test('nothing of the kind on this device: the hint stays, and the Look is offered instead', async () => {
  const p = await page([]);
  const [hint, offer] = p.node('#ss-sources').children;
  assert.equal(hint.textContent, 'No notes on this device yet. Write one in Notes on Canvas or Blackboard first.');
  assert.equal(offer.textContent, 'Share your current Look instead');
  assert.deepEqual([p.create.disabled, p.why.textContent], [true, 'Pick at least one note.']);
  offer.events.click({ isTrusted: true }); await settle();
  assert.equal(p.node('#ss-kind').value, 'look');
  assert.equal(p.node('#ss-sources').hidden, true);
  assert.equal(p.why.textContent, 'Name the session.');
  await p.title('Frostdev for the group');
  assert.equal(p.create.disabled, false);
});

test('Create stays off at the broker limits and while an action is in flight', async () => {
  const limits = require('../lib/sessions.js').LIMIT;
  assert.equal(limits.sessions, 20); assert.equal(limits.items, 200);
  const full = await page([], { sessions: Array.from({ length: limits.sessions }, () => ({ items: [], members: [], kind: 'look' })) });
  await full.kind('look'); await full.title('My Look');
  assert.deepEqual([full.create.disabled, full.why.textContent], [true, 'Leave a session before creating another (20 maximum).']);
  const many = await page(Array.from({ length: limits.items + 1 }, (_, i) => note(A, `n${i}`, `Note ${i}`)));
  await many.title('A collection'); await many.tick(...Array.from({ length: limits.items + 1 }, (_, i) => i));
  assert.deepEqual([many.create.disabled, many.why.textContent], [true, 'Pick at most 200 items.']);
  const long = await page([note(A, 'n1', 'x'.repeat(81))]); await long.tick(0);
  assert.deepEqual([long.create.disabled, long.why.textContent], [true, 'Use a session name of 80 characters or fewer.']);
  await long.title('Short name'); assert.equal(long.create.disabled, false);
  let grant;
  const busy = await page([], { permission: () => new Promise((r) => { grant = r; }) });
  await busy.kind('look'); await busy.title('My Look'); busy.create.events.click({ isTrusted: true }); await settle();
  assert.deepEqual([busy.create.disabled, busy.why.textContent], [true, 'Working…']);
  grant(false); await settle();
  assert.deepEqual([busy.create.disabled, busy.why.textContent], [false, '']);
});
