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

test('broker count gets a provider window even when its config and catalog omit context', async () => {
  const B = require('../../extension/ai/broker.js'), P = require('../../extension/ai/providers.js');
  const apple = require('../../extension/ai/providers/apple.js');
  P.add(apple);
  const previous = globalThis.GZ_AI_SETTINGS, settings = require('../../extension/ai/settings.js');
  globalThis.GZ_AI_SETTINGS = { ...settings, PROVIDERS: [...settings.PROVIDERS, 'apple'] };
  const [page, worker] = ports(), got = [];
  B.connect(worker, { who: 'count-provider-window', allowed: Promise.resolve(true), enabled: async () => true,
    settings: async () => ({ on: true, model: { use: 'native-apple', model: 'on-device' }, features: { ask: true } }),
    vault: { get: async () => ({ 'native-apple': { provider: 'apple', model: 'on-device' } }) }, task: async () => A.task });
  page.onMessage.addListener((m) => got.push(m));
  try {
    page.postMessage({ id: 1, op: 'count', feature: 'ask', task: 'agent.tools', input: { question: 'What is due?', tools: ['todo_list'], now: C.NOW, zone: 'UTC', first: true } });
    await settle();
    assert.equal(got.at(-1)?.window, P.caps(apple, apple.config({ model: 'on-device' })).context, JSON.stringify(got));
    assert.ok(got.at(-1).used > 0);
    assert.equal(got.at(-1).exact, false);
  } finally { page.disconnect(); B._reset(); globalThis.GZ_AI_SETTINGS = previous; }
});

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

test('a delayed compaction count cannot start old-chat work after New chat', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const fit = { used: 3500, window: 8192, reserve: 768, exact: true };
  const h = harness({ count: (m) => m.input.history?.length === 3 ? gate : fit,
    script: { 'agent.tools': [said('BIO 1100.', ['BIO 1100']), said('BIO 1100.', ['BIO 1100'])], 'chat.compact': [{ text: '- Old chat', quotes: [] }] } });
  h.say({ id: 1, op: 'ask', question: "What's due this week?", history: H3 });
  await settle();
  assert.ok(h.seen.counts.some((m) => m.input.history?.length === 3));
  h.say({ id: 2, op: 'ask', question: "What's due next week?" });
  await settle();
  release({ ...fit, used: 7000 });
  await settle();
  assert.equal(h.seen.runs.filter((m) => m.task === 'chat.compact').length, 0, 'the old generation was invalidated while measuring');
});

test('Stop cancels a stalled prompt count and releases the current question', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const fit = { used: 900, window: 8192, reserve: 768, exact: true };
  let first = true;
  const h = harness({ count: () => { if (first) { first = false; return gate; } return fit; }, script: { 'agent.tools': [said('BIO 1100.', ['BIO 1100'])] } });
  try {
    h.say({ id: 1, op: 'ask', question: "What's due this week?" });
    await settle();
    assert.equal(h.seen.counts.length, 1);
    h.say({ id: 1, op: 'cancel' });
    await settle();
    assert.ok(h.got.some((m) => m.id === 1 && m.error === 'cancelled'), 'Stop must not wait for the count');
    h.say({ id: 2, op: 'ask', question: "What's due next week?" });
    await settle();
    assert.ok(h.got.some((m) => m.id === 2 && m.type === 'end'), JSON.stringify(h.got));
    assert.ok(h.seen.cancels.includes(h.seen.counts[0].id));
  } finally { release(fit); await settle(); }
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

test('a displayed summary cannot solve an earlier study question even when its compact check passes', async () => {
  const compact = require('../../extension/ai/tasks/chat-compact.js');
  const older = turn('How do I solve 3x + 5 = 20?', 'What could you do to both sides?');
  const output = { text: '- For 3x + 5 = 20, x = 5.', quotes: ['3x + 5 = 20'] };
  assert.ok(compact.task.check(output, compact.task.input({ turns: [older] })), 'the grounding check alone accepts this');
  const h = harness({ count: () => ({ used: 3500, window: 4096, reserve: 768, exact: true }), script: {
    'agent.tools': [said('BIO 1100.', ['BIO 1100'])], 'chat.compact': [output],
  } });
  h.say({ id: 1, op: 'ask', question: "What's due this week?", history: [older, H3[0]] });
  await settle(120);
  const summary = h.got.find((m) => m.type === 'summary');
  assert.ok(summary, 'a safe deterministic summary can still be shown');
  assert.doesNotMatch(summary.text, /x = 5/, 'the summary must obey the same study rule as an answer');
  assert.match(summary.text, /How do I solve 3x \+ 5 = 20\?/);
});

test('within one run, results the model has used become digests when the next request would overflow; the latest never', async () => {
  const big = { account: ACC, items: Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), title: `Item ${i + 1}`, course: 'BIO 1100', due: C.NOW + i * 36e5, url: 'x'.repeat(200) })) };
  const h = harness({ count: (m) => ({ used: (m.input.steps?.length || 0) >= 2 ? 5000 : 1000, window: 4096, reserve: 768, exact: true }),
    read: async () => big,
    script: { 'agent.tools': [call('places_list', {}), call('wakes_list', {}), said('BIO 1100.', ['BIO 1100'])] } });
  h.say({ id: 1, op: 'ask', question: "What's due this week?", site: 'canvas' });
  await settle(120);
  const last = h.seen.runs.filter((r) => r.task === 'agent.tools').at(-1).input;
  assert.ok(last.steps[0].result.digest, JSON.stringify(last.steps[0].result).slice(0, 200));
  assert.ok(!last.steps.at(-1).result.digest, 'the latest result stays whole');
});

test('digests retain the item identity and submission facts used by tool and missed-work checks', async () => {
  let runs = 0;
  await K.episode({ question: 'Watch my lab due date', tools: [...A.NAMES], locale: 'en', now: C.NOW, zone: 'UTC', first: true,
    measure: async () => ({ used: 5000, window: 4096, reserve: 768 }),
    call: async ({ name }) => ({ result: name === 'todo_list'
      ? { account: ACC, items: [{ id: '181', type: 'assignment', courseId: '25', course: 'BIO 1100', title: 'Lab report', due: C.NOW + 864e5, submitted: false, missing: true }] }
      : { items: [] } }),
    run: async (_task, raw) => {
      if (++runs === 1) return call('todo_list', {});
      if (runs === 2) return call('wakes_list', {});
      const inp = A.task.input(raw);
      assert.equal(A.why(said('Nothing is due; Lab report.', ['Lab report']), inp), 'missed');
      assert.equal(A.why({ call: { name: 'monitor_create', arguments: { watch: 'due', type: 'assignment', id: '181' } }, answer: null }, inp), '');
      return said('Lab report.', ['Lab report']);
    } });
});

test('compacting an older scalar result retains its calculation value', async () => {
  let runs = 0;
  await K.episode({ question: 'Convert miles to km', tools: [...A.NAMES], locale: 'en', now: C.NOW, zone: 'UTC', first: true,
    measure: async () => ({ used: 5000, window: 4096, reserve: 768 }),
    call: async ({ name }) => ({ result: name === 'run_js' ? { ok: true, value: '5.15' } : { items: [] } }),
    run: async (_task, raw) => {
      if (++runs === 1) return call('run_js', { code: '3.2 * 1.609344' });
      if (runs === 2) return call('wakes_list', {});
      assert.equal(A.why(said('5.15 km.', ['5.15']), A.task.input(raw)), '');
      return said('5.15 km.', ['5.15']);
    } });
});

test('a digest still guards against missed work beyond its retained item titles', async () => {
  let runs = 0;
  await K.episode({ question: 'What is due?', tools: [...A.NAMES], locale: 'en', now: C.NOW, zone: 'UTC', first: true,
    measure: async () => ({ used: 5000, window: 4096, reserve: 768 }),
    call: async ({ name }) => ({ result: name === 'todo_list' ? { items: Array.from({ length: 13 }, (_, i) => ({ title: `Lab ${i}`, submitted: i !== 12 })) } : { items: [] } }),
    run: async (_task, raw) => {
      if (++runs === 1) return call('todo_list', {});
      if (runs === 2) return call('wakes_list', {});
      assert.equal(A.why(said('Nothing is due; Lab 0.', ['Lab 0']), A.task.input(raw)), 'missed');
      return said('Lab 0.', ['Lab 0']);
    } });
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

test('a rejected oversized question cannot clear the accepted chat summary', async () => {
  const summary = '- BIO 1100';
  const h = harness({ count: () => ({ used: 3500, window: 4096, reserve: 768, exact: true }), script: {
    'agent.tools': [said('BIO 1100.', ['BIO 1100']), said('BIO 1100.', ['BIO 1100'])],
    'chat.compact': [{ text: summary, quotes: ['BIO 1100'] }],
  } });
  h.say({ id: 1, op: 'ask', question: "What's due this week?", history: H3 });
  await settle();
  h.say({ id: 2, op: 'ask', question: 'x'.repeat(K.LIMIT.question + 1) });
  await settle();
  assert.ok(h.got.some((m) => m.id === 2 && m.error === 'size'));
  h.say({ id: 3, op: 'ask', question: 'And next week?', history: [...H3, turn("What's due this week?", 'BIO 1100.')] });
  await settle();
  assert.equal(h.seen.runs.filter((m) => m.task === 'agent.tools').at(-1).input.summary, summary);
});

// The chat's side of folding (ai/page/ask-chat.js): each question may come on a new port, so the panel hears the summary
// and carries it back with only the turns after the folded ones.
test('a fold is told to the chat as a summary event, with how many of the turns it was sent it folded', async () => {
  const summary = '- Asked: Which courses am I in?\n- **BIO 1100**.';
  const h = harness({ count: (m) => ({ used: m.input.history?.length >= 3 ? 2400 : 900, window: 4096, reserve: 768, exact: true }),
    script: { 'agent.tools': [said('BIO 1100 has nothing due.', ['BIO 1100'])], 'chat.compact': [{ text: summary, quotes: ['Which courses am I in?', 'BIO 1100'] }] } });
  h.say({ id: 1, op: 'ask', question: "What's due in BIO 1100 this week?", history: H3 });
  await settle(120);
  const told = h.got.filter((m) => m.type === 'summary');
  assert.deepEqual(told, [{ id: 1, type: 'summary', text: summary, turns: 1 }]);
  assert.ok(h.got.findIndex((m) => m.type === 'end') < h.got.findIndex((m) => m.type === 'summary'), 'after its question ends');
});

for (const task of ['agent.tools', 'study.help']) test(`${task}: the fourth small-window answer hands off a fallback before end while model compaction is unfinished`, async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const history = [...H3, turn('Any reminders?', 'None.')];
  const h = harness({ count: () => ({ used: 900, window: 4096, reserve: 768 }), script: {
    'agent.tools': [said('BIO 1100.', ['BIO 1100'])],
    'study.help': [{ reply: 'Look at the chromosomes.', followUp: '' }],
    'chat.compact': [() => gate],
  } });
  try {
    h.say({ id: 1, op: 'ask', question: task === 'study.help' ? 'Explain mitosis' : "What's due this week?", history });
    await settle();
    assert.ok(h.seen.runs.some((m) => m.task === 'chat.compact'), 'model compaction is still running');
    const end = h.got.findIndex((m) => m.type === 'end');
    assert.ok(end >= 0, 'the answer does not wait for compaction');
    const handoff = h.got.findIndex((m) => m.type === 'summary');
    assert.ok(handoff >= 0 && handoff < end, 'the page must own the summary before it can replace the port');
    assert.equal(h.got[handoff].turns, 2);
    assert.match(h.got[handoff].text, /Which courses am I in/);
  } finally { release({ text: '- BIO 1100', quotes: ['BIO 1100'] }); await settle(); }
});

test('a question on a new port carries the chat\'s summary: the next request has it; a bad one is refused', async () => {
  const summary = '- Asked: Which courses am I in?\n- **BIO 1100**.';
  const h = harness({ script: { 'agent.tools': [said('Still nothing.', ['BIO 1100'])] } });
  h.say({ id: 1, op: 'ask', question: 'And next week?', history: H3.slice(1), summary });
  await settle(120);
  assert.equal(h.seen.runs.filter((r) => r.task === 'agent.tools').at(-1).input.summary, summary);
  for (const [id, bad] of [[2, 5], [3, 'x'.repeat(701)]]) h.say({ id, op: 'ask', question: 'And next week?', history: H3, summary: bad });
  await settle(60);
  assert.deepEqual(h.got.filter((m) => m.id >= 2 && m.type === 'error').map((m) => [m.id, m.error]), [[2, 'request'], [3, 'request']]);
});

const EVERY = A.NAMES.filter((n) => !n.startsWith('memory_')).sort();
const READS = [...new Set([...K.READS.flatMap((k) => K.TOOLS[k] || K.TOOLS3[k] || []), 'accounts_list'])].filter((n) => A.SPECS.find((t) => t.name === n).kind === 'read').sort();

test('from 16K up every records turn offers every tool but memory\'s, so turns share the system turn; below 16K each question gets its own', async () => {
  const toolsOf = (h, n) => [...h.seen.runs.filter((r) => r.task === 'agent.tools')[n].input.tools].sort();
  const chat = async (window, questions) => {
    const h = harness({ count: () => ({ used: 900, window, reserve: 768, exact: true }), script: { 'agent.tools': questions.map(() => said('Done.', [])) } });
    const history = [];
    for (const [i, q] of questions.entries()) {
      h.say({ id: i + 1, op: 'ask', question: q, ...(history.length && { history: history.slice() }) });
      await settle(120);
      history.push(turn(q, 'Done.'));
    }
    return h;
  };
  const Q = ["What's due this week?", 'Any new announcements in BIO 1100?', 'Any new announcements in BIO 1100?'];
  const big = await chat(16384, Q);
  for (const n of [0, 1, 2]) assert.deepEqual(toolsOf(big, n), EVERY, `turn ${n + 1}`);
  const small = await chat(4096, Q);
  assert.deepEqual(toolsOf(small, 1), [...K.route(Q[1], { locale: 'en', level: 3 }).tools].sort(), 'below 16K, the question\'s own');
});

test('the tool union follows the current provider window when it changes during a chat', async () => {
  const questions = ["What's due this week?", 'Any new announcements in BIO 1100?'];
  for (const windows of [[32768, 8192], [8192, 32768]]) {
    let window = windows[0];
    const h = harness({ count: () => ({ used: 900, window, reserve: 768, exact: true }),
      script: { 'agent.tools': questions.map(() => said('Done.')) } });
    h.say({ id: 1, op: 'ask', question: questions[0] });
    await settle();
    window = windows[1];
    h.say({ id: 2, op: 'ask', question: questions[1], history: [turn(questions[0], 'Done.')] });
    await settle();
    const routed = questions.map((q) => K.route(q, { locale: 'en', level: 3 }).tools);
    const expected = window >= K.UNION.from ? EVERY : routed[1];
    assert.deepEqual([...h.seen.runs.filter((m) => m.task === 'agent.tools').at(-1).input.tools].sort(), expected.sort(), `window ${windows.join(' -> ')}`);
  }
});

test('compaction includes the offered tool union in its context budget', async () => {
  const questions = ["What's due this week?", 'Any new announcements in BIO 1100?', 'Any new announcements in BIO 1100?'];
  const h = harness({ count: (m) => ({ used: m.input.history?.length >= 3 ? 10000 + K.unionCost(m.input.tools) : 900,
    window: 16384, reserve: 768, exact: true }),
    script: { 'agent.tools': questions.map(() => said('Done.')), 'chat.compact': [{ text: '- Due dates', quotes: [] }] } });
  const history = [];
  for (const [i, question] of questions.entries()) {
    h.say({ id: i + 1, op: 'ask', question, ...(history.length && { history: history.slice() }) });
    await settle();
    history.push(turn(question, 'Done.'));
  }
  const offered = h.seen.runs.filter((m) => m.task === 'agent.tools').at(-1).input.tools;
  assert.ok(10000 + K.unionCost(offered) + 768 > 16384 * 0.7, 'the union crosses the compaction threshold');
  assert.ok(h.seen.runs.some((m) => m.task === 'chat.compact'), 'compaction must not budget only the smaller routed set');
  assert.deepEqual(h.seen.counts.find((m) => m.input.history?.length === 3).input.tools, offered);
});

test('study-help readers are offered record reads only, keep the retained chat, and New chat clears the union', async () => {
  const questions = ["What's due this week?", 'Help me understand the BIO 1100 syllabus', 'Any new announcements in BIO 1100?', 'What is my grade in BIO 1100?'];
  const routes = questions.map((q) => K.route(q, { locale: 'en', level: 3 }));
  for (const window of [16384, 8192]) {
    const h = harness({ count: () => ({ used: 900, window, reserve: 768, exact: true }),
      script: { 'agent.tools': questions.map(() => said('Done.')), 'study.help': [{ reply: 'Read the syllabus.', followUp: '' }] } });
    const history = [];
    for (const [i, question] of questions.entries()) {
      h.say({ id: i + 1, op: 'ask', question, ...(i > 0 && i < 3 && { history: history.slice() }), ...(i === 1 && { summary: 'Earlier plan: exclude practice work.' }) });
      await settle();
      history.push(turn(question, 'Done.'));
    }
    const runs = h.seen.runs.filter((m) => m.task === 'agent.tools');
    const expected = window >= K.UNION.from ? READS : routes[1].read;
    assert.deepEqual([...runs[1].input.tools].sort(), [...expected].sort(), `reader, window ${window}`);
    assert.deepEqual(runs[1].input.history, [history[0]], 'the actual reader receives the retained conversation');
    assert.equal(runs[1].input.summary, 'Earlier plan: exclude practice work.');
    const admission = h.seen.counts.filter((m) => m.input.help).at(-1).input;
    assert.deepEqual(admission.history, [history[0]], 'reader admission counts the same conversation');
    assert.equal(admission.summary, runs[1].input.summary);
    const later = window >= K.UNION.from ? EVERY : routes[2].tools;
    assert.deepEqual([...runs[2].input.tools].sort(), [...later].sort(), `after the reader, window ${window}`);
    assert.deepEqual([...runs[3].input.tools].sort(), window >= K.UNION.from ? EVERY : [...routes[3].tools].sort(), 'New chat forgets every earlier tool');
  }
});

test('a large selected window carries more than six complete turns without premature compaction', async () => {
  const history = Array.from({ length: 12 }, (_, i) => turn(`Earlier topic ${i}: ${'reading '.repeat(100)}`, 'Consider the quoted source. '.repeat(50)));
  const h = harness({ count: () => ({ used: 9000, window: 32768, reserve: 768, exact: true }),
    script: { 'agent.tools': [said('Done.')] } });
  h.say({ id: 1, op: 'ask', question: "What's due in BIO 1100?", history });
  await settle();
  assert.equal(h.got.find((m) => m.type === 'error'), undefined, 'the worker accepts bounded history for the selected window');
  const run = h.seen.runs.find((r) => r.task === 'agent.tools');
  assert.deepEqual(run?.input.history, history);
  assert.equal(h.seen.runs.some((r) => r.task === 'chat.compact'), false, 'available context retains those turns verbatim');
});

test('study follow-ups and their readers discover the current window before trimming history on a renewed port', async () => {
  const history = Array.from({ length: 12 }, (_, i) => turn(`Reading topic ${i}: ${'source '.repeat(400)}`, 'Consider the repeated imagery. '.repeat(100)));
  for (const window of [4096, 32768]) for (const reader of [false, true]) {
    const h = harness({ count: () => ({ used: 900, window, reserve: 600, exact: true }),
      script: { 'agent.tools': [said('Read the course material.')], 'study.help': [{ reply: 'Which image recurs?', followUp: null }] } });
    h.say({ id: 1, op: 'ask', question: reader ? 'Explain the BIO 1100 syllabus' : 'Explain metaphor', history });
    await settle();
    const run = h.seen.runs.find((r) => r.task === 'study.help');
    assert.ok(run, JSON.stringify(h.got));
    assert.deepEqual(run.input.history, window === 4096 ? history.slice(-6).map((h) => ({ question: h.question.slice(0, 2000), answer: h.answer.slice(0, 2000) })) : history);
    const reads = reader || window >= K.UNION.from;
    assert.equal(h.seen.runs.some((r) => r.task === 'agent.tools'), reads, 'from 16K every study question reads first; below, only help naming records');
    if (reads) {
      const expected = window === 4096 ? history.slice(-6).map((h) => ({ question: h.question.slice(0, 2000), answer: h.answer.slice(0, 2000) })) : history;
      assert.deepEqual(h.seen.runs.find((r) => r.task === 'agent.tools').input.history, expected);
      const readerCounts = h.seen.counts.filter((m) => m.input.help);
      assert.deepEqual(readerCounts[1].input.history, expected, 'selected-window offer counts the full retained reader context');
    }
  }
});

// The page deliberately recreates its port between questions (Safari can retire the idle worker).
test('a recreated port restores the bounded tool union, even after its topic was folded away', async () => {
  const first = harness({ count: () => ({ used: 900, window: 16384, reserve: 768 }), script: { 'agent.tools': [said('Done.')] } });
  first.say({ id: 1, op: 'ask', question: "What's due this week?" });
  await settle();
  const carried = first.got.find((m) => m.type === 'tools');
  assert.ok(carried?.tools.includes('todo_list'), 'the page receives the union before the answer');
  const next = harness({ count: () => ({ used: 900, window: 16384, reserve: 768 }), script: { 'agent.tools': [said('Done.')] } });
  next.say({ id: 2, op: 'ask', question: 'Any new announcements in BIO 1100?', history: H3.slice(0, 1), summary: '- Earlier due dates', tools: carried.tools });
  await settle();
  const input = next.seen.runs.find((m) => m.task === 'agent.tools').input;
  assert.ok(input.tools.includes('todo_list'));
  assert.ok(input.tools.includes('announcements_list'));
  assert.ok(next.got.findIndex((m) => m.type === 'tools') < next.got.findIndex((m) => m.type === 'end'));
  // Every tool from 16K: New chat's own forgetting shows below it, where a question keeps its topics' tools.
  const small = harness({ count: () => ({ used: 900, window: 8192, reserve: 768 }), script: { 'agent.tools': [said('Done.')] } });
  small.say({ id: 3, op: 'ask', question: 'What is my grade in BIO 1100?', tools: carried.tools });
  await settle();
  assert.ok(!small.seen.runs.filter((m) => m.task === 'agent.tools').at(-1).input.tools.includes('todo_list'), 'New chat ignores carried tools');
});

test('carried tools reject unknown, repeated, oversized and non-list values before changing the chat', async () => {
  const h = harness();
  const expensive = A.NAMES.filter((n) => n !== 'accounts_list');
  assert.ok(K.unionCost(expensive) > K.UNION.budget);
  const bad = [['not_a_tool'], ['todo_list', 'todo_list'], expensive, 'todo_list', null];
  for (const [i, tools] of bad.entries()) h.say({ id: i, op: 'ask', question: 'What is due?', history: H3, tools });
  await settle();
  assert.deepEqual(h.got.filter((m) => m.type === 'error').map((m) => m.error), bad.map(() => 'request'));
  assert.equal(h.seen.runs.length, 0);
});
