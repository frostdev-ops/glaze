// Ported from Rimeward src/lib/agent/core.ts (runLoop's rounds and batch triage, pushOutput, parkConfirm, claimConfirm,
// pauses, currentToolPolicy) and openrouter.ts (repairChatItems) (MIT), cut to what a Glaze task needs: no workspace,
// monitors, steering, children, compaction or voice. The AI harness's agent loop (docs/ai-harness.md): a model and its
// tools, round by round, until the model answers without calling one.
// Each round: its own AbortController armed before anything awaits; the conversation repaired (every call answered, so a
// cancelled or parked one never breaks the next request); one model call. A batch of calls is triaged whole, each refusal
// answered as data: an unknown tool, a write on a read-only run, a tool not offered, arguments that aren't a JSON object, a
// call without its `reason`, arguments that don't fit the tool's schema. What the policy pauses waits for the student: at
// most one per batch (the others are answered "not run — waiting"), declined on an unattended run. The rest run together;
// the policy is read again just before each (it may only narrow), a tool's error is data, and results go back in call order,
// each within LIMIT.output characters (a bigger one becomes an omission receipt, never torn JSON). A cancel answers every
// call of its batch { notRun }. Rounds are capped (default 24); Glaze also caps time and tokens.
// Events (emit): thinking { round }, text_delta { id, delta, offset }, says { id, text }, step_start { id, round, tool,
// kind, args, reason }, step { step }, pending { pending }, usage { input, output, … }, reply { id, text }. A step:
// AgentStep { id, round, tool, kind, args, reason, result?, error?, ms? }. Receipts the model sees: { error },
// { declined, note }, { notRun, note }, { interrupted, note }, { resultOmitted, outcome, note }.
// Classic script for the worker; module.exports for node.
var GZ_AI_LOOP = globalThis.GZ_AI_LOOP || (() => {
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('./request.js'));
  const S = () => (typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('./schema.js'));
  const T = () => (typeof GZ_AI_TOOLS !== 'undefined' ? GZ_AI_TOOLS : require('./tools.js'));
  const X = () => (typeof GZ_AI_TEXT !== 'undefined' ? GZ_AI_TEXT : require('./text.js'));
  const F = () => (typeof GZ_AI_FAILURE !== 'undefined' ? GZ_AI_FAILURE : require('./failure.js'));
  // output: a tool answer's characters; rounds, ms, tokens: [default, most]; confirm: how long a parked call waits.
  const LIMIT = { output: 12000, rounds: [24, 24], ms: [120000, 300000], tokens: [60000, 500000], confirm: 600000 };
  const limit = (k, v) => (Number.isSafeInteger(v) && v > 0 ? Math.min(v, LIMIT[k][1]) : LIMIT[k][0]);
  // Rimeward's parseRounds: a whole count, or null; an empty value is never 0. Glaze never runs uncapped (a worker can be
  // stopped mid-run), so 0 is the default cap here.
  const parseRounds = (raw) => {
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;
    const text = String(raw).trim();
    if (!text) return null;
    const n = Math.floor(Number(text));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  // ---- policy ----------------------------------------------------------------------------------------------------------
  // Legacy approval settings remain accepted, but cannot waive Glaze's mandatory confirmation for every nonread tool.
  // A policy may restrict which tools are offered; anything that isn't a read always waits for the student.
  const POLICY = Object.freeze({ tools: 'all', approvals: 'all' });
  const pauses = (_approvals, kind) => kind !== 'read';
  // A running loop may lose authority, never gain it from a later change.
  const narrow = (original, current) => ({
    tools: original.tools === 'read-only' || current?.tools === 'read-only' ? 'read-only' : 'all',
    approvals: original.approvals === 'all' || current?.approvals === 'all' ? 'all' : original.approvals === 'outbound' || current?.approvals === 'outbound' ? 'outbound' : 'off',
  });

  // ---- the conversation -------------------------------------------------------------------------------------------------
  // Rimeward's repairChatItems on neutral messages: every assistant call gets an answer ({ interrupted } when it has none),
  // and an answer whose call is missing is dropped; a call in keepOpen (a parked confirm) stays unanswered on purpose.
  const repair = (messages, keepOpen = new Set()) => {
    const answered = new Set(messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId));
    const called = new Set(), out = [];
    for (const m of messages) {
      if (m.role === 'tool' && !called.has(m.toolCallId)) continue;
      out.push(m);
      for (const c of m.role === 'assistant' ? m.toolCalls || [] : []) {
        called.add(c.id);
        if (!answered.has(c.id) && !keepOpen.has(c.id)) out.push({ role: 'tool', toolCallId: c.id, content: [{ type: 'text', text: JSON.stringify({ interrupted: true, note: 'This call never ran. Nothing was done. Call it again if it is still wanted.' }) }] });
      }
    }
    return out;
  };
  // A tool's answer as the model reads it: never torn JSON; past LIMIT.output an omission receipt.
  const output = (value) => {
    let json;
    try { json = JSON.stringify(value ?? null); } catch { json = JSON.stringify({ error: 'The tool answered with something that is not JSON.' }); }
    if (json.length <= LIMIT.output) return json;
    const v = value && typeof value === 'object' ? value : {};
    const failure = T().toolFailure(v);
    return JSON.stringify({ resultOmitted: true, outcome: v.declined || v.notRun ? 'not-run' : failure !== null ? 'failed' : v.ok === true ? 'succeeded' : 'unknown',
      ...(failure !== null && { error: failure.slice(0, 500) }),
      note: `Result omitted (${json.length} chars > ${LIMIT.output}); omission does not establish success or failure. Narrow the query or use pagination.` });
  };
  const answer = (id, value) => ({ role: 'tool', toolCallId: id, content: [{ type: 'text', text: output(value) }] });

  // ---- confirms ---------------------------------------------------------------------------------------------------------
  // A call waiting for the student: kept in `store` (a Map the broker holds for one port) by a single-use id. The summary
  // comes from the tool's own data (summarize), never from the model's prose about its call.
  const id64 = () => { const b = new Uint8Array(24); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const parkConfirm = async (store, { call, tool, args, ctx, signal, now = Date.now }) => {
    const confirmId = id64();
    const { reason: _, ...shown } = args;
    let summary;
    try { summary = tool.summarize ? String(await F().wait(() => tool.summarize(shown, { ...ctx, signal }), signal)).slice(0, 2000) : `${tool.name}: ${JSON.stringify(shown).slice(0, 2000)}`; } catch (e) { if (signal?.aborted) throw e; summary = tool.name; }
    if (signal?.aborted) throw signal.reason;
    if (store.current) store.delete(store.current);
    store.set(confirmId, { call: call.id, tool, args: shown, at: now() });
    store.current = confirmId;
    return { confirmId, tool: tool.name, summary };
  };
  // Single use (taking it is the claim), echo-checked against the one now waiting, expiring after LIMIT.confirm. Throws one
  // sentence.
  const claimConfirm = (store, confirmId, now = Date.now) => {
    if (typeof confirmId !== 'string' || !/^[A-Za-z0-9_-]{20,50}$/.test(confirmId)) throw new Error('That confirmation is not valid.');
    if (store.current !== confirmId) throw new Error('That confirmation is no longer current.');
    const parked = store.get(confirmId);
    store.delete(confirmId); store.current = null;
    if (!parked) throw new Error('That confirmation expired or was already decided.');
    if (now() - parked.at > LIMIT.confirm) throw new Error('That confirmation expired. Ask again.');
    return parked;
  };

  // ---- the loop ---------------------------------------------------------------------------------------------------------
  // { request (lib/ai/request.js; its tools are given here instead), tools: [tool], call(request, { signal, onDelta,
  //   onThinking }) → result, policy: () => current policy (or one), rounds, limits: { ms, tokens }, headless, stream (text
  //   deltas go to emit), signal, emit, ctx (what a tool's run is given), confirms (a Map: parked calls), now }
  // → the last result, with { reply, steps, rounds, usage, pending?, paused? }.
  const run = async ({ request: raw, tools: given = [], call, policy = POLICY, rounds, limits = {}, headless = false, stream = false, signal, emit = () => {}, ctx, confirms = new Map(), now = Date.now }) => {
    const Q = R();
    const request = Q.clean(raw);
    if (!request) throw Q.error('request');
    const tools = given.map((t) => (T().is(t) ? t : T().define(t)));
    let effective = { ...(typeof policy === 'function' ? policy() : policy) };
    const current = () => (effective = narrow(effective, typeof policy === 'function' ? policy() : policy));
    const cap = Math.min(parseRounds(rounds) || LIMIT.rounds[0], LIMIT.rounds[1]), ms = limit('ms', limits.ms), tokens = limit('tokens', limits.tokens);
    const start = now(), byName = new Map(tools.map((t) => [t.name, t]));
    let messages = [...request.messages];
    const steps = [], used = { input: 0, output: 0 };
    const cancelled = () => Object.assign(Q.error('cancelled'), { category: 'cancelled' });
    const deadline = F().deadline(ms);
    try {
    for (let round = 0; round < cap; round++) {
      // One controller per round, armed before anything awaits.
      const ac = new AbortController(), both = F().anySignal([signal, deadline.signal, ac.signal]);
      let pendingId, pendingPublished = false;
      try {
        if (both.signal.aborted) throw cancelled();
        const left = ms - (now() - start);
        if (left < Q.LIMIT.timeout[0]) throw Object.assign(Q.error('timeout'), { category: 'timeout' });
        messages = repair(messages);
        if (messages.length > Q.LIMIT.messages) throw Q.error('steps');
        const offered = T().aiTools(tools, current().tools);
        const asked = X().estimateTokens({ messages, offered });
        if (used.input + used.output + asked > tokens) throw Q.error('limit');
        emit({ type: 'thinking', round });
        const messageId = crypto.randomUUID();
        let streamed = '';
        const result = await call({ ...request, messages, ...(offered.length && { tools: offered }), timeoutMs: Math.min(request.timeoutMs || left, left) }, {
          signal: both.signal,
          onDelta: stream ? (delta) => { if (both.signal.aborted) return; const offset = streamed.length; streamed += delta; emit({ type: 'text_delta', id: messageId, delta, offset }); } : undefined,
          onThinking: (x) => { if (!both.signal.aborted) emit({ type: 'thinking', round, ...(Number.isSafeInteger(x?.tokens) && { tokens: x.tokens, estimated: x.estimated === true }) }); },
        });
        used.input += result.usage?.input ?? asked;
        used.output += result.usage?.output ?? X().estimateTokens(result.text + (result.toolCalls ? JSON.stringify(result.toolCalls) : ''));
        emit({ type: 'usage', ...used });
        const calls = result.toolCalls || [];
        if (!calls.length) { if (both.signal.aborted) throw cancelled(); emit({ type: 'reply', id: messageId, text: result.text }); return { ...result, reply: result.text, steps, rounds: round + 1, usage: used }; }
        if (used.input + used.output > tokens) throw Q.error('limit');
        if (result.text.trim()) emit({ type: 'says', id: messageId, text: result.text });
        messages.push({ role: 'assistant', content: result.text ? [{ type: 'text', text: result.text }] : [], toolCalls: calls });
        // A cancel that landed while the model answered: nothing in this batch starts.
        if (both.signal.aborted) {
          for (const c of calls) {
            const step = { id: c.id, round, tool: c.name, kind: byName.get(c.name)?.kind || 'read', args: {}, reason: '', error: 'not run — the run was stopped' };
            steps.push(step); emit({ type: 'step', step });
            messages.push(answer(c.id, { notRun: true, note: 'Not run — the run was stopped before this could start. Nothing was done.' }));
          }
          throw cancelled();
        }
        // Triage the whole batch, then run what may run, together.
        const permissions = current(), offeredNames = new Set(offered.map((t) => t.name));
        let park = null;
        const plan = calls.map((c) => {
          const def = byName.get(c.name);
          const args = Q.isObj(c.args) ? c.args : null;
          const reason = String(args?.reason ?? '').trim();
          const step = { id: c.id, round, tool: c.name, kind: def?.kind || 'read', args: args || {}, reason };
          if (!def) return { c, step: { ...step, error: 'unknown tool' }, out: { error: `no such tool: ${String(c.name).slice(0, 64)}` } };
          if (permissions.tools === 'read-only' && def.kind !== 'read') return { c, step: { ...step, error: 'read-only' }, out: { error: 'This run is read-only; only read tools may run.' } };
          if (!offeredNames.has(c.name)) return { c, step: { ...step, error: 'tool unavailable' }, out: { error: `${c.name} is unavailable under the current tools and permissions.` } };
          if (!args) return { c, step: { ...step, error: 'invalid arguments' }, out: { error: 'Tool arguments must be a JSON object. Retry with the tool’s schema.' } };
          if (!reason) return { c, step: { ...step, error: 'no reason given' }, out: { error: 'Rejected: every tool call requires a `reason`, one short sentence explaining the action. Call it again with one.' } };
          const errors = S().validate(args, offered.find((t) => t.name === c.name).parameters);
          if (errors.length) return { c, step: { ...step, error: 'invalid arguments' }, out: { error: `invalid arguments: ${errors.join('; ')}` } };
          if (pauses(permissions.approvals, def.kind)) {
            if (headless) return { c, step: { ...step, error: 'needs confirmation — declined (unattended run)' }, out: { declined: true, note: "This needs the student's confirmation and nobody is watching. Nothing was run." } };
            if (park) return { c, out: { error: `not run — waiting on the student to confirm ${park.c.name} first. Call this again afterwards if still needed.` } };
            park = { c, def, args };
            return null;
          }
          return { c, def, step };
        });
        for (const p of plan) if (p?.def) emit({ type: 'step_start', id: p.c.id, round, tool: p.c.name, kind: p.def.kind, args: p.step.args, reason: p.step.reason });
        const settled = await F().wait(() => Promise.all(plan.map(async (p) => {
          if (!p) return null;
          if (both.signal.aborted) throw both.signal.reason;
          if (!p.def) { if (p.step) emit({ type: 'step', step: p.step }); return p; }
          const started = now();
          let step, out;
          try {
            const policyNow = current();
            if (policyNow.tools === 'read-only' && p.def.kind !== 'read') throw new Error('This run is now read-only. Nothing ran.');
            if (pauses(policyNow.approvals, p.def.kind)) throw new Error('The approval policy changed before this ran. Nothing ran; propose it again.');
            const { reason: _, ...args } = p.step.args;
            out = await F().wait(() => p.def.run(structuredClone(args), { ...ctx, signal: both.signal }), both.signal);
            step = { ...p.step, result: out, ms: now() - started };
          } catch (err) {
            // Tool errors are model-visible data, never fatal to the run.
            out = { error: err instanceof Error ? err.message : String(err) };
            step = { ...p.step, error: out.error, ms: now() - started };
          }
          if (!both.signal.aborted) emit({ type: 'step', step });
          return { c: p.c, step, out };
        })), both.signal);
        // Steps and answers land in call order, whatever order they finished in.
        for (const r of settled) { if (!r) continue; if (r.step) steps.push(r.step); messages.push(answer(r.c.id, r.out)); }
        if (park) {
          if (both.signal.aborted) throw cancelled();
          const pending = await parkConfirm(confirms, { call: park.c, tool: park.def, args: park.args, ctx, signal: both.signal, now });
          pendingId = pending.confirmId;
          if (both.signal.aborted) throw cancelled();
          emit({ type: 'pending', pending });
          if (both.signal.aborted) throw cancelled();
          pendingPublished = true;
          return { ...result, reply: result.text, steps, rounds: round + 1, usage: used, pending };
        }
        if (both.signal.aborted) throw cancelled();
      } catch (e) {
        if (both.signal.aborted) {
          if (signal?.aborted && signal.reason?.name !== 'TimeoutError') throw cancelled();
          const code = both.signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled';
          throw Object.assign(Q.error(code), { category: code });
        }
        throw e;
      } finally {
        if (pendingId && !pendingPublished) { confirms.delete(pendingId); if (confirms.current === pendingId) confirms.current = null; }
        ac.abort(); both.done();
      }
    }
    const reply = `(paused after ${cap} tool rounds)`;
    emit({ type: 'reply', id: crypto.randomUUID(), text: reply });
    return { text: reply, finish: 'stop', reply, steps, rounds: cap, usage: used, paused: true };
    } finally { deadline.done(); }
  };
  return { LIMIT, POLICY, parseRounds, pauses, narrow, repair, output, parkConfirm, claimConfirm, run };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_LOOP; else GZ_AI_LOOP;
