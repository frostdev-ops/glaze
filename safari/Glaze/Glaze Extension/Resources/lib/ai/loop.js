// The AI harness's agent loop (docs/ai-harness.md): a model and its tools, step by step, until the model answers without
// asking for one. Each step is one request through call() (lib/ai/providers.js run, bound to a provider); each tool call
// the model makes is checked and run (lib/ai/tools.js call) and its answer, or why there is none, goes back to the model as
// the next message. Held to limits: steps (requests), ms (all of it), tokens (what providers say they used, else counted
// high from the text); over one, it stops with that code. A cancel stops it between and inside steps.
// Classic script for the worker; module.exports for node.
var GZ_AI_LOOP = globalThis.GZ_AI_LOOP || (() => {
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('./request.js'));
  const T = () => (typeof GZ_AI_TOOLS !== 'undefined' ? GZ_AI_TOOLS : require('./tools.js'));
  const X = () => (typeof GZ_AI_TEXT !== 'undefined' ? GZ_AI_TEXT : require('./text.js'));
  // Each limit: [default, most].
  const LIMIT = { steps: [6, 16], ms: [120000, 300000], tokens: [60000, 500000] };
  const limit = (k, v) => (Number.isSafeInteger(v) && v > 0 ? Math.min(v, LIMIT[k][1]) : LIMIT[k][0]);
  const words = (messages) => messages.reduce((n, m) => n + X().tokens(m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')) + (m.toolCalls ? X().tokens(JSON.stringify(m.toolCalls)) : 0), 0);
  // { request (lib/ai/request.js), tools: [tool], call(request, { signal, onDelta }) → result, limits: { steps, ms, tokens },
  //   signal, onDelta, onStep({ step, calls: [names] }), ctx (what a tool's run is given), now }
  // → the last result, with steps, usage (all steps') and proposals: [{ tool, proposal }].
  const run = async ({ request: raw, tools: given = [], call, limits = {}, signal, onDelta, onStep, ctx, now = Date.now }) => {
    const Q = R();
    const request = Q.clean(raw);
    if (!request) throw Q.error('request');
    const tools = given.map((t) => (T().is(t) ? t : T().define(t)));
    const steps = limit('steps', limits.steps), ms = limit('ms', limits.ms), tokens = limit('tokens', limits.tokens);
    const start = now(), byName = new Map(tools.map((t) => [t.name, t])), specs = tools.map(T().spec);
    const messages = [...request.messages], proposals = [], used = { input: 0, output: 0 };
    for (let step = 1; ; step++) {
      if (signal?.aborted) throw Q.error('cancelled');
      if (step > steps || messages.length > Q.LIMIT.messages) throw Q.error('steps');
      const left = ms - (now() - start);
      if (left < Q.LIMIT.timeout[0]) throw Q.error('timeout');
      const asked = words(messages);
      if (used.input + used.output + asked > tokens) throw Q.error('limit');
      const result = await call({ ...request, messages, ...(specs.length && { tools: specs }), timeoutMs: Math.min(request.timeoutMs || left, left) }, { signal, onDelta });
      used.input += result.usage?.input ?? asked;
      used.output += result.usage?.output ?? X().tokens(result.text + (result.toolCalls ? JSON.stringify(result.toolCalls) : ''));
      onStep?.({ step, calls: (result.toolCalls || []).map((c) => c.name) });
      if (!result.toolCalls?.length) return { ...result, steps: step, usage: used, proposals };
      if (used.input + used.output > tokens) throw Q.error('limit');
      messages.push({ role: 'assistant', content: result.text ? [{ type: 'text', text: result.text }] : [], toolCalls: result.toolCalls });
      for (const c of result.toolCalls) {
        const tool = byName.get(c.name);
        const r = tool ? await T().call(tool, c.args, { signal, ctx }) : { ok: false, error: `no tool named ${c.name.slice(0, 64)}` };
        if (signal?.aborted) throw Q.error('cancelled');
        if (r.proposal) proposals.push({ tool: c.name, proposal: r.proposal });
        // What the tool gave, as data: the model reads it, it doesn't obey it.
        const text = JSON.stringify(r.ok ? (r.proposal ? { proposed: r.proposal } : { data: r.data }) : { error: r.error });
        messages.push({ role: 'tool', toolCallId: c.id, content: [{ type: 'text', text }] });
      }
    }
  };
  return { LIMIT, run };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_LOOP; else GZ_AI_LOOP;
