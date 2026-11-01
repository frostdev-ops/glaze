// Ask Rime's context window (ai/ask.js, tools level 3): each request measured before it goes (the broker's count) and
// reported to the panel as a 'context' event; past about 70% of the model's window the chat's older turns fold into a
// summary (chat.compact, between turns; its fallback when it fails or the next question comes first); within one run, used
// results become digests when they would overflow; New chat clears it all; level 1 sends what it always sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../extension/ai/ask.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const C = require('../helpers/mcp-caches.cjs');

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 80) => { for (let i = 0; i < n; i++) await tick(); };
const ports = () => {
  const side = () => ({ on: [], gone: [], closed: false });
  const a = side(), b = side();
  const end = (me, other) => ({
    postMessage: (m) => { if (me.closed) throw new Error('closed'); const c = structuredClone(m); setTimeout(() => { if (!other.closed) other.on.forEach((f) => f(c)); }, 0); },
    onMessage: { addListener: (f) => me.on.push(f) }, onDisconnect: { addListener: (f) => me.gone.push(f) },
    disconnect: () => { if (me.closed) return; me.closed = true; setTimeout(() => { if (!other.closed) { other.closed = true; other.gone.forEach((f) => f()); } }, 0); },
  });
  return [end(a, b), end(b, a)];
};
const said = (text, quotes = []) => ({ call: null, answer: { text, quotes } });
const call = (name, args) => ({ call: { name, arguments: args, kind: A.SPECS.find((s) => s.name === name).kind }, answer: null });
const ACC = `${C.CANVAS}/5`;
// count(m) → the broker's count answer for a request ({ used, window, reserve, exact }).
const harness = ({ script = {}, level = 3, count = () => ({ used: 900, window: 4096, reserve: 768, exact: true }), counts = true, read, exclusive = false } = {}) => {
  const seen = { runs: [], counts: [], cancels: [] };
  const n = {};
  let active = null;
  const broker = (port) => port.onMessage.addListener(async (m) => {
    if (m.op === 'cancel') { seen.cancels.push(m.id); if (active === m.id) active = null; return; }
    if (m.op === 'count') { seen.counts.push(m); return port.postMessage({ id: m.id, type: 'end', ...await count(m) }); }
    if (m.op !== 'run') return;
    if (exclusive && active !== null) return port.postMessage({ id: m.id, type: 'error', error: 'busy' });
    active = m.id;
    seen.runs.push(m);
    n[m.task] = (n[m.task] || 0) + 1;
    const next = (script[m.task] || [])[n[m.task] - 1];
    const output = typeof next === 'function' ? await next(m.input) : next;
    if (active === m.id) active = null;
    port.postMessage(output ? { id: m.id, type: 'end', output } : { id: m.id, type: 'error', error: 'check' });
  });
  const env = {
    allowed: async () => true, broker, counts, settings: async () => ({ on: true, model: { use: 'openai', model: 'm' }, features: { ask: true } }), enabled: async () => true,
    registry: { get: () => null, describe: () => ({}) }, state: async () => ({}), refresh: async () => null, local: {}, keys: async () => [], turn: (f) => f(), zone: 'UTC', now: () => C.NOW,
    accounts: async () => [{ account: ACC, origin: C.CANVAS }], approve: { ask: async () => 'yes' }, level: async () => level, page: () => ({ url: `${C.CANVAS}/courses/25/grades` }),
    own: { read: read || (async () => ({ account: ACC, items: [{ id: '1', title: 'Lab report', course: 'BIO 1100', due: C.NOW + 864e5 }] })), writer: async () => true, wakes: { local: { get: async () => ({}), set: async () => {} }, read: async () => null, on: async () => true, now: () => C.NOW } },
  };
  const [page, worker] = ports();
  K.connect(worker, env);
  const got = [];
  page.onMessage.addListener((m) => got.push(m));
  return { got, seen, say: (m) => page.postMessage(m) };
};
const turn = (question, answer) => ({ question, answer });
const H3 = [turn('Which courses am I in?', 'You are in **BIO 1100**.'), turn('What is due in BIO 1100?', 'Nothing in what Glaze read.')];

test('a new question cancels unfinished compaction before taking the broker slot, even for New chat', async () => {
  for (const fresh of [false, true]) {
    let release;
    const gate = new Promise((r) => { release = r; });
    const h = harness({ exclusive: true, count: () => ({ used: 3500, window: 4096, reserve: 768, exact: true }),
      script: { 'agent.tools': [said('BIO 1100.', ['BIO 1100']), said('BIO 1100.', ['BIO 1100'])], 'chat.compact': [() => gate] } });
    try {
      h.say({ id: 1, op: 'ask', question: "What's due this week?", history: H3 });
      await settle();
      const compact = h.seen.runs.find((m) => m.task === 'chat.compact');
      assert.ok(compact, 'compaction is still running');
      h.say({ id: 2, op: 'ask', question: "What's due next week?", ...(fresh ? {} : { history: [...H3, turn("What's due this week?", 'BIO 1100.')] }) });
      await settle();
      assert.ok(h.got.some((m) => m.id === 2 && m.type === 'end'), JSON.stringify(h.got));
      assert.ok(h.seen.cancels.includes(compact.id), 'the fallback must release the real broker slot');
    } finally { release({ text: '- Late summary', quotes: [] }); await settle(); }
  }
});

test('each request is measured before it goes: a context event with the model\'s window and the answer\'s reserve', async () => {
  const h = harness({ script: { 'agent.tools': [call('wakes_list', {}), said('You are in BIO 1100.', ['BIO 1100'])] } });
  h.say({ id: 1, op: 'ask', question: "What's due this week?" });
  await settle();
  const ctx = h.got.filter((m) => m.type === 'context');
  assert.equal(ctx.length, 2, 'one per run');
  assert.deepEqual(ctx[0], { id: 1, type: 'context', task: 'agent.tools', used: 900, window: 4096, reserve: 768, exact: true });
  assert.ok(h.got.findIndex((m) => m.type === 'context') < h.got.findIndex((m) => m.type === 'end'));
});

test('past 70% of the window, the older turns fold into a summary between turns; the next request has it and only the newer turns; it scales with the window', async () => {
  const summary = '- Asked: Which courses am I in?\n- **BIO 1100**.';
  for (const [window, folds] of [[4096, true], [32768, false]]) {
    const h = harness({ count: (m) => ({ used: m.input.history?.length >= 3 ? 2400 : 900, window, reserve: 768, exact: true }),
      script: { 'agent.tools': [said('BIO 1100 has nothing due.', ['BIO 1100']), said('Still nothing.', ['BIO 1100'])], 'chat.compact': [{ text: summary, quotes: ['Which courses am I in?', 'BIO 1100'] }] } });
    h.say({ id: 1, op: 'ask', question: "What's due in BIO 1100 this week?", history: H3 });
    await settle(120);
    assert.equal(h.seen.runs.some((r) => r.task === 'chat.compact'), folds, `window ${window}`);
    if (!folds) continue;
    const compactRun = h.seen.runs.find((r) => r.task === 'chat.compact');
    assert.deepEqual(compactRun.input.turns, [H3[0]], 'the turns before the last two');
    h.say({ id: 2, op: 'ask', question: 'And next week?', history: [...H3, turn("What's due in BIO 1100 this week?", 'BIO 1100 has nothing due.')] });
    await settle(120);
    const next = h.seen.runs.filter((r) => r.task === 'agent.tools').at(-1).input;
    assert.equal(next.summary, summary);
    assert.deepEqual(next.history.map((x) => x.question), ['What is due in BIO 1100?', "What's due in BIO 1100 this week?"]);
  }
});

test('a summary that fails its check falls back to the deterministic one', async () => {
  const h = harness({ count: () => ({ used: 3500, window: 4096, reserve: 768, exact: true }), script: { 'agent.tools': [said('BIO 1100 has nothing due.', ['BIO 1100'])] } });
  h.say({ id: 1, op: 'ask', question: "What's due in BIO 1100?", history: H3 });
  await settle(120);
  h.say({ id: 2, op: 'ask', question: 'And next week?', history: [...H3, turn("What's due in BIO 1100?", 'BIO 1100 has nothing due.')] });
  await settle(120);
  const next = h.seen.runs.filter((r) => r.task === 'agent.tools').at(-1)?.input;
  assert.match(next.summary, /^- Asked: Which courses am I in\?/m);
  assert.match(next.summary, /- BIO 1100/);
});

test('within one run, results the model has used become digests when the next request would overflow; the latest never', async () => {
  const big = { account: ACC, items: Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), title: `Item ${i + 1}`, course: 'BIO 1100', due: C.NOW + i * 36e5, url: 'x'.repeat(200) })) };
  const h = harness({ count: (m) => ({ used: (m.input.steps?.length || 0) >= 2 ? 5000 : 1000, window: 4096, reserve: 768, exact: true }),
    read: async () => big,
    script: { 'agent.tools': [call('wakes_list', {}), call('places_list', {}), said('BIO 1100.', ['BIO 1100'])] } });
  h.say({ id: 1, op: 'ask', question: "What's due this week?" });
  await settle(120);
  const last = h.seen.runs.filter((r) => r.task === 'agent.tools').at(-1).input;
  assert.ok(last.steps[0].result.digest, JSON.stringify(last.steps[0].result).slice(0, 200));
  assert.ok(!last.steps.at(-1).result.digest, 'the latest result stays whole');
});

test('New chat (no history) clears the summary; level 1 sends neither summary nor history, and no counts without the broker\'s', async () => {
  const h = harness({ count: () => ({ used: 3500, window: 4096, reserve: 768, exact: true }), script: { 'agent.tools': [said('BIO 1100.', ['BIO 1100']), said('BIO 1100.', ['BIO 1100'])], 'chat.compact': [] } });
  h.say({ id: 1, op: 'ask', question: "What's due this week?", history: H3 });
  await settle(120);
  h.say({ id: 2, op: 'ask', question: "What's due this week?" });
  await settle(120);
  const fresh = h.seen.runs.filter((r) => r.task === 'agent.tools').at(-1).input;
  assert.equal(fresh.summary, undefined);
  assert.equal(fresh.history, undefined);
  const one = harness({ level: 1, counts: false, script: { 'agent.tools': [said('BIO 1100.', ['BIO 1100'])] } });
  one.say({ id: 1, op: 'ask', question: "What's due this week?", history: H3 });
  await settle(120);
  const in1 = one.seen.runs[0].input;
  assert.equal(in1.summary, undefined);
  assert.equal(in1.history, undefined);
  assert.equal(one.seen.counts.length, 0);
  assert.equal(one.got.filter((m) => m.type === 'context').length, 0);
});
