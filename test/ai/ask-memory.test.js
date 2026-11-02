// Ask's memory integration: verified scope, bounded recall, trusted mutations, visible receipts and stale-answer guards.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../extension/ai/ask.js');
const M = require('../../extension/ai/memory.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const TL = require('../../extension/ai/tools.js');
const ACC = 'https://school.instructure.com/5', NOW = 1793653200000;
const said = (text = 'No memory change is useful.') => ({ call: null, answer: { text, quotes: [] } });
const call = (name, arguments_ = {}, kind = 'read') => ({ call: { name, arguments: arguments_, kind }, answer: null });
const study = { kind: 'concept', step: null, reply: 'Think about how each part depends on the whole.', followUp: null };
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = async (done) => { for (let i = 0; i < 500; i++) { if (done()) return; await pause(); } assert.fail('Ask did not settle'); };
const harness = ({ script = {}, counts, verified = true, active, assignment, document } = {}) => {
  const data = {}, local = { get: async (keys) => structuredClone(Object.fromEntries((keys === null ? Object.keys(data) : [].concat(keys)).filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]]))),
    set: async (patch) => { Object.assign(data, structuredClone(patch)); } };
  let random = 0;
  const store = M.create({ local, keys: async () => Object.keys(data), now: () => NOW, random: () => (++random).toString(16).padStart(32, '0') });
  const state = { on: true, capable: true, valid: true, ask: true, enabled: true, account: ACC, runs: [], counts: [], approvals: [], searches: [] };
  const original = store.search;
  store.search = async (...args) => { state.searches.push(structuredClone(args)); return original(...args); };
  const registry = TL.registry();
  registry.add({ name: 'todo_list', kind: 'read', group: 'courses', scope: 'account', title: 'To-dos', description: 'To-dos', parameters: A.SPECS.find((s) => s.name === 'todo_list').parameters,
    run: async (_, ctx) => ({ account: ctx.account, at: NOW, items: [] }) });
  registry.add({ name: 'assignment_read', kind: 'read', group: 'assignments', scope: 'account', title: 'Assignment', description: 'Assignment', parameters: A.SPECS.find((s) => s.name === 'assignment_read').parameters,
    run: async (_, ctx) => assignment || ({ account: ctx.account, title: 'Invented lab', instructions: 'Compare two invented samples.', at: NOW }) });
  registry.add({ name: 'document_read', kind: 'read', group: 'writer', scope: 'document', title: 'Document', description: 'Saved document', parameters: A.SPECS.find((s) => s.name === 'document_read').parameters,
    run: async (_, ctx) => typeof document === 'function' ? document(ctx.document) : document || ({ title: 'Saved draft', text: 'Earlier saved text.', at: NOW, page: 1, pages: 1 }) });
  const broker = (port) => port.onMessage.addListener(async (m) => {
    if (m.op === 'count') { state.counts.push(m); const fit = counts ? await counts(m.input, m.task) : { used: 1000, window: 4096, reserve: 768, exact: true }; return port.postMessage({ id: m.id, type: 'end', ...fit }); }
    if (m.op !== 'run') return;
    state.runs.push(m);
    const next = (script[m.task] || [])[state.runs.filter((r) => r.task === m.task).length - 1];
    try { const output = typeof next === 'function' ? await next(m.input, state, store) : next; port.postMessage(output ? { id: m.id, type: 'end', output } : { id: m.id, type: 'error', error: 'check' }); }
    catch { port.postMessage({ id: m.id, type: 'error', error: 'check' }); }
  });
  const env = { allowed: async () => true, broker, settings: async () => ({ on: true, memory: state.on, model: { use: 'openai', model: 'm' }, features: { ask: state.ask } }), enabled: async () => state.enabled,
    registry: { get: (n) => registry.get(n), describe: (t) => ({ name: t.name, inputSchema: t.parameters }) }, state: async () => ({}), refresh: async () => null,
    accounts: async () => [{ account: state.account, origin: 'https://school.instructure.com' }], local, keys: async () => Object.keys(data), now: () => NOW, turn: (f) => f(), zone: 'UTC', level: async () => 3,
    page: () => ({ url: 'https://school.instructure.com/courses/25' }), counts: counts ? true : false,
    current: async () => ({ ...(verified && { account: state.account }), ...(active && { current: structuredClone(active) }), page: { site: 'canvas', url: 'https://school.instructure.com/courses/25' },
      valid: async () => state.valid && state.account === ACC, bind: (c) => c }),
    memory: { store, on: async () => state.on, capable: async () => state.capable },
    approve: { ask: async (...args) => { state.approvals.push(args); return 'yes'; } },
    own: { writer: async () => true, read: async () => ({ items: [] }), wakes: { on: async () => false, local, read: async () => null } },
  };
  const [page, worker] = K.channel(), got = [];
  const connected = K.connect(worker, env);
  page.onMessage.addListener((m) => got.push(m));
  let id = 0;
  return { store, state, got, env, close: () => { connected.close(); page.disconnect(); }, ask: async (question, extra = {}) => { const next = ++id; page.postMessage({ id: next, op: 'ask', question, locale: 'en', site: 'canvas', ...extra }); await settled(() => got.some((m) => m.id === next && ['end', 'error'].includes(m.type))); return got.find((m) => m.id === next && ['end', 'error'].includes(m.type)); } };
};
const preference = (store, text = 'I prefer short bullet points.') => store.save(ACC, { text, evidence: text, category: 'preference' }, { question: text });

test('episode accepts only the trusted private memory policy for memory mutations', async () => {
  for (const [name, authorization, accepted] of [['memory_save', 'memory-policy', true], ['memory_forget', 'memory-policy', true], ['todo_mark_done', 'memory-policy', false], ['memory_save', true, false]]) {
    let runs = 0;
    const out = await K.episode({ question: 'Remember my preference.', tools: [name], now: NOW, zone: 'UTC', locale: 'en',
      run: async () => ++runs === 1 ? call(name, {}, 'write') : said('Saved.'), call: async () => ({ result: { ok: true }, authorization }) });
    assert.equal(!!out.answer, accepted, `${name}/${authorization}`);
    assert.equal(runs, accepted ? 2 : 1);
  }
});

test('study.help receives unrelated saved preferences from a verified account and an optional save pass', async (t) => {
  const h = harness({ script: { 'agent.tools': [said()], 'study.help': [study] } }); t.after(h.close);
  const saved = await preference(h.store);
  const end = await h.ask('Explain photosynthesis.');
  assert.equal(end.type, 'end');
  assert.deepEqual(h.state.runs.map((r) => r.task), ['agent.tools', 'study.help']);
  assert.deepEqual(h.state.runs[0].input.tools, ['memory_save']);
  assert.equal(h.state.runs[0].input.first, undefined, 'an optional save is allowed to do nothing');
  assert.equal(h.state.runs[1].input.recall.records[0].id, saved.receipt.id);
  assert.equal(h.state.runs[1].input.recall.records[0].category, 'preference');
  assert.equal(JSON.stringify(h.state.runs[1].input.recall).includes(ACC), false);
  assert.deepEqual(h.state.searches[0].slice(0, 2), [ACC, 'Explain photosynthesis.']);
  assert.equal(h.state.searches[0][2].includePreferences, true);
  assert.equal(h.state.searches[0][2].limit, 3);
  assert.ok(h.got.some((m) => m.type === 'recall' && m.records[0].id === saved.receipt.id));
});

test('unverified scope supplies no memories and cannot make an automatic write', async (t) => {
  const h = harness({ verified: false, script: { 'study.help': [study] } }); t.after(h.close);
  await preference(h.store);
  assert.equal((await h.ask('Explain photosynthesis.')).type, 'end');
  assert.equal(h.state.searches.length, 0);
  assert.equal(h.state.runs[0].task, 'study.help');
  assert.equal(h.state.runs[0].input.recall, undefined);
});

test('automatic saves emit their device receipt before a later model failure and never ask approval', async (t) => {
  const text = 'I prefer short bullet points.';
  const h = harness({ script: { 'agent.tools': [call('memory_save', { text, evidence: text, category: 'preference' }, 'write')] } }); t.after(h.close);
  assert.equal((await h.ask(`${text} Explain photosynthesis.`)).type, 'error');
  assert.equal(h.state.runs.at(-1).task, 'study.help', 'the terminal failure is in the main task after the optional save');
  const receipt = h.got.find((m) => m.type === 'memory')?.receipt;
  assert.equal(receipt.operation, 'created');
  assert.equal(receipt.persistence, 'device');
  assert.equal(h.state.approvals.length, 0);
  assert.equal((await h.store.read(ACC, receipt.id)).text, text);
});

test('recall cannot publish after a memory is deleted or the setting/account changes during generation', async (t) => {
  for (const change of ['deleted', 'off', 'account']) {
    let saved;
    const h = harness({ script: { 'agent.tools': [said()], 'study.help': [async (_, state, store) => { if (change === 'deleted') await store.forget(ACC, { id: saved.receipt.id, revision: saved.receipt.revision }); else if (change === 'off') state.on = false; else state.account = 'https://school.instructure.com/6'; return study; }] } }); t.after(h.close);
    saved = await preference(h.store);
    assert.equal((await h.ask('Explain photosynthesis.')).type, 'error', change);
  }
});

test('exact request counts include recall and drop lower ranked records until the request fits', async (t) => {
  const h = harness({ counts: (input) => ({ used: 3200 + (input.recall?.records.length || 0) * 180, window: 4096, reserve: 768, exact: true }), script: { 'agent.tools': [said()], 'study.help': [study] } }); t.after(h.close);
  for (const text of ['Photosynthesis needs light.', 'Photosynthesis uses water.', 'Photosynthesis occurs in cells.']) await h.store.save(ACC, { text, evidence: text }, { question: text });
  assert.equal((await h.ask('Explain photosynthesis.')).type, 'end');
  assert.ok(h.state.counts.some((c) => c.input.recall?.records.length), 'recall reached the exact count path');
  for (const run of h.state.runs) assert.ok(!run.input.recall?.records.length, 'recall is removed if even one record would overflow');
});

test('personal recall routes through a memory read tool before its final agent answer', async (t) => {
  const h = harness({ script: { 'agent.tools': [call('memory_search', { query: 'preferences', kind: 'memory' }), said('Your saved preference asks for short bullet points.')] } }); t.after(h.close);
  await preference(h.store);
  const end = await h.ask('What do you remember about my preferences?');
  assert.equal(end.type, 'end');
  assert.equal(end.task, 'agent.tools');
  assert.deepEqual(h.state.runs[0].input.tools, ['memory_search', 'memory_read', 'memory_save', 'memory_forget']);
  assert.equal(h.state.runs[0].input.first, true, 'automatic recall does not bypass the tool-first policy');
  assert.equal(h.state.runs[1].input.steps[0].call.name, 'memory_search');
});

test('records supplied by memory_search are revalidated even when absent from automatic recall', async (t) => {
  let saved;
  const h = harness({ script: { 'agent.tools': [call('memory_search', { query: 'night owl', kind: 'memory' }), async (_, __, store) => {
    await store.forget(ACC, { id: saved.receipt.id, revision: saved.receipt.revision }); return said('Your saved fact says you are a night owl.');
  }] } }); t.after(h.close);
  saved = await h.store.save(ACC, { text: 'I am a night owl.', evidence: 'I am a night owl.' }, { question: 'I am a night owl.' });
  assert.equal((await h.ask('What do you remember about me?')).type, 'error');
  assert.equal(h.state.runs[0].input.recall, undefined, 'the explicit search result supplies the fact');
});

test('turns begun with Memory off use the existing study path without a save pass', async (t) => {
  const h = harness({ script: { 'study.help': [study] } }); t.after(h.close);
  await preference(h.store); h.state.on = false;
  assert.equal((await h.ask('Explain photosynthesis.')).type, 'end');
  assert.equal(h.state.searches.length, 0);
  assert.deepEqual(h.state.runs.map((r) => r.task), ['study.help']);
  assert.equal(h.got.some((m) => ['memory', 'recall'].includes(m.type)), false);
});

test('explicit memory management while off returns its feature error without a model run', async (t) => {
  const h = harness(); t.after(h.close); h.state.on = false;
  const out = await h.ask('What do you remember about my preferences?');
  assert.equal(out.type, 'error');
  assert.equal(out.error, 'off');
  assert.equal(out.feature, 'memory');
  assert.deepEqual(h.state.runs, []);
});

test('models without the memory contract keep ordinary Ask usable and report unsupported memory', async (t) => {
  const h = harness({ script: { 'study.help': [study] } }); t.after(h.close); h.state.capable = false;
  await preference(h.store);
  assert.equal((await h.ask('Explain photosynthesis.')).type, 'end');
  assert.deepEqual(h.state.runs.map((r) => r.task), ['study.help']);
  assert.equal(h.state.runs[0].input.recall, undefined);
  assert.equal(h.state.searches.length, 0);
  for (const question of ['What do you remember about my preferences?', 'Remember that I prefer short answers.', 'Forget my saved preference.']) {
    const out = await h.ask(question);
    assert.equal(out.type, 'error');
    assert.equal(out.error, 'caps');
    assert.equal(out.feature, 'memory');
  }
  assert.equal(h.state.runs.length, 1);
  assert.equal(h.state.searches.length, 0);
  assert.equal(h.state.approvals.length, 0);
  assert.equal((await h.store.list(ACC)).items.length, 1, 'unsupported remember/forget cannot mutate stored memories');
});

test('automatic memory saving keeps all six selected school tools and uses a separate optional pass', async (t) => {
  const question = 'What are my assignments, grades and due dates?';
  const selected = K.route(question, { level: 3 }).tools;
  assert.equal(selected.length, 6);
  const h = harness({ script: { 'agent.tools': [said(), call('todo_list'), said('There are no matching records.')] } }); t.after(h.close);
  assert.equal((await h.ask(question)).type, 'end');
  assert.deepEqual(h.state.runs[0].input.tools, ['memory_save']);
  assert.deepEqual(h.state.runs[1].input.tools, selected);
  assert.equal(h.state.runs[0].input.first, undefined);
  assert.equal(h.state.runs[0].input.history, undefined);
  assert.equal(h.state.runs[0].input.help, undefined);
});

test('automatic saves use their own episode even when a larger-window inline request would initially fit', async (t) => {
  for (const window of [4096, 8192, 16384]) {
    const h = harness({ counts: () => ({ used: 1000, window, reserve: 768, exact: true }),
      script: { 'agent.tools': [said(), call('todo_list'), said('There are no matching records.')] } }); t.after(h.close);
    assert.equal((await h.ask('What is due today?')).type, 'end');
    const main = h.state.runs.find((r) => r.input.tools.includes('todo_list'));
    assert.equal(main.input.tools.includes('memory_save'), false);
    assert.deepEqual(h.state.runs[0].input.tools, ['memory_save']);
    assert.equal(h.state.counts.some((r) => r.input.tools?.includes('memory_save') && r.input.tools.length > 1), false);
  }
});

test('a producer begun before deletion cannot capture a new lease and save afterward', async (t) => {
  let saved;
  const text = 'I prefer paragraphs.';
  const h = harness({ script: { 'agent.tools': [async (_, __, store) => {
    await store.forget(ACC, { id: saved.receipt.id, revision: saved.receipt.revision });
    return call('memory_save', { text, evidence: text, category: 'preference' }, 'write');
  }, said()], 'study.help': [study] } }); t.after(h.close);
  saved = await preference(h.store);
  await h.ask(`${text} Explain photosynthesis.`);
  assert.equal(h.got.some((m) => m.type === 'memory'), false);
  assert.equal((await h.store.list(ACC)).items.length, 0);
});

test('successful verified assignment reads are ingested with their actual observed time', async (t) => {
  const h = harness({ script: { 'agent.tools': [said(), call('assignment_read', { course: '25', assignment: '41' }), said('The assignment asks you to compare two invented samples.')] },
    active: { site: 'canvas', view: 'assignment', course: { id: '25' }, assignment: { id: '41' } },
    assignment: { title: 'Invented lab', instructions: 'Compare two invented samples.', at: NOW - 60000 } }); t.after(h.close);
  assert.equal((await h.ask('What are the instructions for this assignment?')).type, 'end');
  const rows = (await h.store.list(ACC)).items;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'course');
  assert.equal(rows[0].source.observedAt, NOW - 60000);
  assert.equal(rows[0].source.course, '25');
  assert.equal(rows[0].source.id, '41');
});

test('exact fitting removes optional current URL before losing any typed resource identity', async (t) => {
  const h = harness({ counts: (input) => ({ used: 3100 + (input.current?.url ? 400 : 0), window: 4096, reserve: 768, exact: true }),
    script: { 'agent.tools': [said(), call('assignment_read', { course: '25', assignment: '41' }), said('Compare the two invented samples.')] },
    active: { site: 'canvas', view: 'assignment', url: 'https://school.instructure.com/courses/25/assignments/41', title: 'Invented lab', course: { id: '25' }, assignment: { id: '41', title: 'Invented lab' } } }); t.after(h.close);
  assert.equal((await h.ask('What are the instructions for this assignment?')).type, 'end');
  const run = h.state.runs.find((r) => r.input.tools?.includes('assignment_read'));
  assert.equal(run.input.current.url, undefined);
  assert.equal(run.input.current.course.id, '25');
  assert.equal(run.input.current.assignment.id, '41');
  assert.equal(h.state.counts.some((r) => r.input.current?.url), true, 'the full request is counted before optional fields are removed');
});

test('only a direct correction request may replace a user-edited memory', async (t) => {
  for (const [request, explicit] of [['Explain why this approach is correct.', false], ['Do not change my saved preference.', false], ['If I change my saved preference later, remind me.', false], ['Update my assignment.', false], ['Forget my saved preference.', false], ['Forget my saved preference. Explain why this approach is correct.', false], ['Correct my saved preference.', true]]) {
    let saved, edited;
    const text = 'I prefer short bullet points.';
    const h = harness({ script: { 'agent.tools': [() => call('memory_save', { id: saved.receipt.id, revision: edited.receipt.revision, text, evidence: text, category: 'preference' }, 'write'), said(explicit ? 'Updated.' : 'No change.')], 'study.help': [study] } }); t.after(h.close);
    saved = await preference(h.store);
    edited = await h.store.edit(ACC, { id: saved.receipt.id, revision: saved.receipt.revision, markdown: 'I prefer long paragraphs.' });
    await h.ask(`${request} ${text}`);
    assert.equal((await h.store.read(ACC, saved.receipt.id)).text, explicit ? text : 'I prefer long paragraphs.', request);
    assert.equal(h.got.some((m) => m.type === 'memory'), explicit);
  }
});

test('large-window tool unions remove memory tools when off, incapable or unverified', async (t) => {
  for (const unavailable of ['off', 'capable', 'unverified']) {
    const h = harness({ counts: () => ({ used: 1000, window: 16384, reserve: 768, exact: true }),
      script: { 'agent.tools': [call('memory_search', { query: 'preferences' }), said('No matching memory.'), call('todo_list'), said('There are no matching records.')] } }); t.after(h.close);
    assert.equal((await h.ask('Show my saved memories.')).type, 'end');
    if (unavailable === 'off') h.state.on = false;
    else if (unavailable === 'capable') h.state.capable = false;
    else h.env.current = async () => ({ valid: async () => true });
    assert.equal((await h.ask('What is due today?', { history: [{ question: 'Show my saved memories.', answer: 'No matching memory.' }] })).type, 'end');
    const main = h.state.runs.find((r) => r.input.tools?.includes('todo_list'));
    assert.ok(main, unavailable);
    assert.equal(main.input.tools.some((name) => name.startsWith('memory_')), false, unavailable);
    assert.equal(main.input.recall, undefined);
  }
});

test('recall revisions are checked before the first model exposure after exact counting', async (t) => {
  let saved, removed = false;
  const h = harness({ counts: async (input) => {
    if (!removed && input.recall?.records.length) { removed = true; await h.store.forget(ACC, { id: saved.receipt.id, revision: saved.receipt.revision }); }
    return { used: 1000, window: 4096, reserve: 768, exact: true };
  }, script: { 'agent.tools': [said()], 'study.help': [study] } }); t.after(h.close);
  saved = await preference(h.store);
  assert.equal((await h.ask('Explain photosynthesis.')).type, 'error');
  assert.equal(removed, true);
  assert.equal(h.state.runs.length, 0, 'deleted personal text never reaches a model request');
});

test('memory receipts stay out of school material passed to study help', async (t) => {
  const text = 'I prefer short bullet points.';
  const h = harness({ counts: () => ({ used: 1000, window: 8192, reserve: 768, exact: true }),
    script: { 'agent.tools': [call('memory_save', { text, evidence: text, category: 'preference' }, 'write'), said(), call('assignment_read', { course: '25', assignment: '41' }), said('Compare the samples.')], 'study.help': [study] },
    active: { site: 'canvas', view: 'assignment', course: { id: '25' }, assignment: { id: '41' } } }); t.after(h.close);
  assert.equal((await h.ask(`Explain this assignment. ${text}`)).type, 'end');
  assert.ok(h.got.some((m) => m.type === 'memory'), 'save has its own durable receipt');
  const help = h.state.runs.find((r) => r.task === 'study.help');
  assert.match(help.input.material, /Compare two invented samples/);
  assert.doesNotMatch(help.input.material, /short bullet points|persistence|receipt|m-[0-9a-f]{32}/);
});

test('4K, 8K and 16K school requests reserve room for late results with saving isolated in a prelude', async (t) => {
  for (const window of [4096, 8192, 16384]) for (const save of [false, true]) {
    const text = 'I prefer short bullet points.';
    const step = (input) => {
      if (input.tools.includes('memory_save') && !input.steps.length && save) return call('memory_save', { text, evidence: text }, 'write');
      if (input.tools.length === 1 && input.tools[0] === 'memory_save') return said();
      return input.steps.length ? said('There are no matching records.') : call('todo_list');
    };
    const h = harness({ counts: (input) => ({ used: input.tools?.includes('todo_list') && input.steps.length ? window - 768 + (input.tools.includes('memory_save') ? 320 : -5) : 1000,
      window, reserve: 768, exact: true }), script: { 'agent.tools': Array(5).fill(step) },
      active: { site: 'canvas', view: 'assignment', course: { id: '25' }, assignment: { id: '41' } } }); t.after(h.close);
    assert.equal((await h.ask(`What is due today? ${text}`)).type, 'end', `${window}/${save}: later school results retain their reserved room`);
    const main = h.state.runs.filter((r) => r.input.tools.includes('todo_list'));
    assert.equal(main.length, 2);
    for (const run of main) {
      assert.equal(run.input.tools.includes('memory_save'), false);
      assert.equal(run.input.steps.some((s) => s.call.name === 'memory_save'), false, 'called mutation history remains in its separate checked episode');
      assert.equal(run.input.current.course.id, '25');
      assert.equal(run.input.current.assignment.id, '41');
    }
    assert.equal(h.got.filter((m) => m.type === 'memory').length, save ? 1 : 0);
    if (save) {
      const saved = h.got.find((m) => m.type === 'memory').receipt;
      assert.equal((await h.store.read(ACC, saved.id)).text, text);
      assert.ok(h.state.runs.some((r) => r.input.tools.length === 1 && r.input.steps.some((s) => s.call.name === 'memory_save' && s.result.receipt.id === saved.id)), 'the prelude retains the successful mutation receipt for grounding');
    }
    assert.ok(h.state.counts.filter((r) => r.input.tools?.includes('todo_list')).every((r) => r.input.tools.length >= 3), 'required school tool slots remain available');
  }
});

test('8K school history stays intact without a current block when optional saving would overflow late', async (t) => {
  const history = [{ question: 'Earlier general question. '.repeat(100), answer: 'Earlier explanatory response. '.repeat(100) }];
  const step = (input) => input.tools.length === 1 && input.tools[0] === 'memory_save' ? said()
    : input.steps.length ? said('There are no matching records.') : call('todo_list');
  const h = harness({ counts: (input) => ({ used: input.tools?.includes('todo_list') && input.steps.length ? input.tools.includes('memory_save') ? 7744 : 7419 : 1000,
    window: 8192, reserve: 768, exact: true }), script: { 'agent.tools': Array(3).fill(step) } }); t.after(h.close);
  assert.equal((await h.ask('What is due today?', { history })).type, 'end');
  const main = h.state.runs.filter((r) => r.input.tools.includes('todo_list'));
  for (const run of main) { assert.deepEqual(run.input.history, history); assert.equal(run.input.current, undefined); }
  assert.equal(h.state.runs[0].input.history, undefined, 'the optional prelude never rewrites or carries conversation history');
});

test('ordinary large-window tool unions do not inherit memory schemas from explicit management turns', async (t) => {
  const h = harness({ counts: () => ({ used: 1000, window: 16384, reserve: 768, exact: true }),
    script: { 'agent.tools': [call('memory_search', { query: 'preferences' }), said('No matching memory.'), said(), call('todo_list'), said('There are no matching records.')] } }); t.after(h.close);
  const question = 'Show my saved memories.';
  assert.equal((await h.ask(question)).type, 'end');
  assert.deepEqual(h.state.runs[0].input.tools, ['memory_search', 'memory_read', 'memory_save', 'memory_forget'], 'direct management retains its tools');
  const history = [{ question, answer: 'No matching memory.' }];
  assert.equal((await h.ask('What is due today?', { history })).type, 'end');
  const main = h.state.runs.filter((r) => r.input.tools.includes('todo_list'));
  for (const run of main) {
    assert.equal(run.input.tools.some((name) => name.startsWith('memory_')), false);
    assert.deepEqual(run.input.history, history, 'the management conversation remains historical text');
  }
});

test('explicit memory management requires a freshly verified account before exposing its tools', async (t) => {
  const h = harness({ verified: false, script: { 'agent.tools': [call('memory_search', { query: 'preferences' }), said('No matching memory.')] } }); t.after(h.close);
  assert.equal((await h.ask('Show my saved memories.')).type, 'error');
  assert.equal(h.state.runs.length, 0);
});

test('queued memory producers recheck scope and switches after awaited storage reads', async (t) => {
  for (const operation of ['save', 'ingest', 'forget']) for (const change of ['on', 'capable', 'valid', 'ask', 'enabled']) {
    let saved;
    const text = 'I prefer short bullet points.';
    const h = harness({ script: { 'agent.tools': operation === 'ingest' ? [said(), call('assignment_read', { course: '25', assignment: '41' }), said('Compare the samples.')]
      : [() => operation === 'forget' ? call('memory_forget', { id: saved.receipt.id, revision: saved.receipt.revision }, 'write') : call('memory_save', { text, evidence: text }, 'write'), said()], 'study.help': [study] } }); t.after(h.close);
    if (operation === 'forget') saved = await preference(h.store);
    const original = h.store[operation], get = h.env.local.get;
    let revoked = false;
    h.store[operation] = (...args) => {
      h.env.local.get = async (keys) => {
        const value = await get(keys);
        if (!revoked) { revoked = true; h.state[change] = false; }
        return value;
      };
      return original(...args);
    };
    await h.ask(operation === 'ingest' ? 'What are the instructions for this assignment?' : operation === 'forget' ? 'Forget my saved preference.' : `${text} Explain photosynthesis.`);
    assert.equal(revoked, true, `${operation}/${change} reached the awaited mutation`);
    assert.equal(h.got.some((m) => m.type === 'memory'), false, `${operation}/${change} did not publish a receipt`);
    const records = (await h.store.list(ACC)).items;
    assert.equal(records.length, operation === 'forget' ? 1 : 0, `${operation}/${change} did not commit`);
  }
});

const DRAFT = `document:${'c'.repeat(32)}`, OTHER_DRAFT = `document:${'d'.repeat(32)}`;
const draft = (truncated = false) => ({ site: 'canvas', view: 'document', title: 'Live draft', course: { id: '25', name: 'Active course' },
  document: { id: DRAFT, title: 'Live draft', kind: 'paper', revision: 17, saved: false },
  material: { source: 'writer', text: 'Live unsaved draft excerpt.', truncated } });
const roomy = () => ({ used: 1000, window: 4096, reserve: 768, exact: true });

test('study material preserves live draft provenance and never fills a partial excerpt with its saved version', async (t) => {
  for (const truncated of [false, true]) {
    const h = harness({ counts: roomy, active: draft(truncated), document: { title: 'Old stored draft', text: 'CONFLICTING SAVED BODY', at: NOW, page: 1, pages: 2 },
      script: { 'agent.tools': [call('document_read', { document: DRAFT }), said('Consider the structure of your draft.')], 'study.help': [study] } }); t.after(h.close); h.state.on = false;
    assert.equal((await h.ask('Help me with this draft.')).type, 'end');
    const help = h.state.runs.find((r) => r.task === 'study.help');
    assert.match(help.input.material, /Live unsaved draft excerpt/);
    assert.match(help.input.material, /"source":"writer"/);
    assert.match(help.input.material, /"saved":false/);
    assert.match(help.input.material, /"revision":17/);
    assert.match(help.input.material, new RegExp(`"truncated":${truncated}`));
    assert.doesNotMatch(help.input.material, /CONFLICTING SAVED BODY|Old stored draft/);
    assert.ok(h.state.counts.some((m) => m.task === 'study.help' && m.input.material === help.input.material), 'the complete labelled material is counted');
    const SH = require('../../extension/ai/tasks/study-help.js'), X = require('../../extension/ai/text.js');
    const input = SH.task.input(help.input);
    assert.ok(input, 'the existing study schema accepts the material');
    const request = SH.task.build(input, { text: X });
    assert.ok(request.fenced.data >= 2, 'material and question retain the existing data fences');
    assert.doesNotMatch(request.messages[0].content, /Live unsaved draft excerpt/);
  }
});

test('partial page instructions keep their source and partial flag in study material', async (t) => {
  const h = harness({ active: { site: 'canvas', view: 'assignment', course: { id: '25' }, assignment: { id: '41' }, material: { source: 'instructions', text: 'Only the visible instructions.', truncated: true } },
    script: { 'study.help': [study] } }); t.after(h.close); h.state.on = false;
  assert.equal((await h.ask('Explain the concept.')).type, 'end');
  const help = h.state.runs.find((r) => r.task === 'study.help');
  assert.match(help.input.material, /"source":"instructions"/);
  assert.match(help.input.material, /"truncated":true/);
  assert.match(help.input.material, /Only the visible instructions/);
});

test('independently targeted saved documents do not inherit the active draft or its context', async (t) => {
  for (const target of [OTHER_DRAFT, DRAFT]) {
    const h = harness({ counts: roomy, active: draft(true), document: { title: 'Requested saved document', text: 'EXPLICIT SAVED BODY', at: NOW, page: 1, pages: 2 },
      script: { 'agent.tools': [call('document_read', { document: target }), said('Consider the requested document structure.')], 'study.help': [study] } }); t.after(h.close); h.state.on = false;
    assert.equal((await h.ask(`Help me with the saved document ${target}.`)).type, 'end');
    const help = h.state.runs.find((r) => r.task === 'study.help');
    assert.match(help.input.material, /EXPLICIT SAVED BODY/);
    assert.match(help.input.material, /"source":"document_read"/);
    assert.match(help.input.material, /"saved":true/);
    assert.match(help.input.material, /"truncated":true/);
    assert.doesNotMatch(JSON.stringify(help.input), /Live unsaved draft excerpt|Live draft|Active course/);
  }
});
