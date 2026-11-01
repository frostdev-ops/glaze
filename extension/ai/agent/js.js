// run_js (docs/ai-harness.md "Rime's own tools"): one line of JavaScript, run in Glaze's sandbox (ai/sandbox/js.js) for
// arithmetic, unit conversions, statistics, dates and small tables. ctx.js(code) runs it (in integration, through the
// panel's ai/sandbox/frame.js); where there is none (Firefox and Safari have no manifest sandbox, available()) the tool
// says so and runs nothing. agent.tools' check keeps it off graded work (ownWhy 'work'), and an answer that uses it
// still passes study.help's answer-giving rules in Ask Rime.
// → { ok, value, logs, error?, cut? } as the sandbox gives it, held to its limits again here.
// Classic script for the worker; module.exports for node.
var GZ_AI_RIME_JS = globalThis.GZ_AI_RIME_JS || (() => {
  const AT = () => (typeof GZ_AI_TASK_AGENT_TOOLS !== 'undefined' ? GZ_AI_TASK_AGENT_TOOLS : require('../tasks/agent-tools.js'));
  // code: characters; ms: how long a run may take; output: characters of value and lines together; lines, line: console's.
  const LIMIT = { code: 1000, ms: 2000, output: 4000, lines: 40, line: 500 };
  // An answer held to the limits: its own keys only. The sandbox page sends it so, and the worker checks it again.
  const tidy = (r) => {
    const o = r && typeof r === 'object' ? r : {};
    const logs = Array.isArray(o.logs) ? o.logs.filter((l) => typeof l === 'string').slice(0, LIMIT.lines).map((l) => l.slice(0, LIMIT.line)) : [];
    let value;
    try { value = ['string', 'number', 'boolean'].includes(typeof o.value) || o.value === null ? o.value : JSON.parse(JSON.stringify(o.value ?? null)); } catch { value = null; }
    if (JSON.stringify(value).length > LIMIT.output) value = JSON.stringify(value).slice(0, LIMIT.output);
    return { ok: o.ok === true, value, logs, ...(typeof o.error === 'string' && { error: o.error.slice(0, LIMIT.line) }), ...(o.cut === true && { cut: true }), ...(Number.isFinite(o.ms) && { ms: o.ms }) };
  };
  const NONE = "Glaze can run code only in Chrome; work it out step by step instead.";
  // Where the sandbox exists: a manifest sandbox page, Chrome's alone.
  const available = (browser) => browser === 'chrome';
  const spec = () => AT().SPECS.find((t) => t.name === 'run_js');
  const tools = () => [{
    name: 'run_js', kind: spec().kind, description: spec().description, parameters: spec().parameters,
    run: async (args, ctx) => {
      if (typeof ctx?.js !== 'function') return { ok: false, error: NONE };
      let r;
      try { r = await ctx.js(String(args.code)); } catch { return { ok: false, error: 'The sandbox failed; nothing ran.' }; }
      if (r?.error === 'unavailable') return { ok: false, error: NONE };
      const { ms: _, ...out } = tidy(r);
      if (!out.ok && !out.error) out.error = 'The code failed.';
      return out;
    },
  }];
  const register = (registry) => tools().map((t) => registry.add(t));
  return { LIMIT, NONE, tidy, available, tools, register };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_RIME_JS; else GZ_AI_RIME_JS;
