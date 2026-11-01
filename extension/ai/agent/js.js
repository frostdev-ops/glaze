// run_js (docs/ai-harness.md "Rime's own tools"): one line of JavaScript for arithmetic, unit conversions, statistics,
// dates and small tables, run by QuickJS compiled to WebAssembly (extension/vendor/quickjs/, PROVENANCE.md) in the
// extension's background: Chrome's service worker, Firefox's event page and Safari's worker alike, under the extension
// pages' CSP ('wasm-unsafe-eval'). The code sees ECMAScript's own builtins and the console Glaze hands it, nothing else:
// no network, timers, storage, messaging, modules or extension APIs. Each run gets a new runtime and context, a memory and
// stack cap, and an interrupt at LIMIT.ms; value and console lines share LIMIT.output characters. The engine (about 0.5 MB
// of WebAssembly) is fetched and compiled on the first run only. agent.tools' check keeps it off graded work (ownWhy
// 'work'), and an answer that uses it still passes study.help's answer-giving rules in Ask Rime.
// run(code, { ms }) → { ok, value, logs, error?, cut?, ms }; the tool answers the same without ms.
// Classic script for the worker; module.exports for node.
var GZ_AI_RIME_JS = globalThis.GZ_AI_RIME_JS || (() => {
  const AT = () => (typeof GZ_AI_TASK_AGENT_TOOLS !== 'undefined' ? GZ_AI_TASK_AGENT_TOOLS : require('../tasks/agent-tools.js'));
  // code: characters; ms: how long a run may take; output: characters of value and lines together; lines, line: console's;
  // memory, stack: bytes one run may allocate at once and recurse into; heap: the engine's whole WebAssembly memory, in 64 KB
  // pages (QuickJS can't total what a run holds in this build, so the heap's own maximum is the cap that holds).
  const LIMIT = { code: 1000, ms: 2000, output: 4000, lines: 40, line: 500, memory: 32 << 20, stack: 512 << 10, heap: 64 << 20 };
  const ENGINE = 'vendor/quickjs/quickjs.wasm';
  const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof require === 'function' && typeof importScripts !== 'function';
  // An answer held to the limits: its own keys only, value and logs out of one budget.
  const tidy = (r) => {
    const o = r && typeof r === 'object' ? r : {};
    const logs = [];
    let left = LIMIT.output, cut = o.cut === true;
    for (const l of Array.isArray(o.logs) ? o.logs : []) {
      if (typeof l !== 'string') continue;
      if (logs.length >= LIMIT.lines || left === 0) { cut = true; continue; }
      const line = l.slice(0, Math.min(LIMIT.line, left));
      cut ||= line.length < l.length;
      logs.push(line); left -= line.length;
    }
    let value;
    try { value = ['string', 'number', 'boolean'].includes(typeof o.value) || o.value === null ? o.value : JSON.parse(JSON.stringify(o.value ?? null)); } catch { value = null; }
    const shown = typeof value === 'string' ? value : JSON.stringify(value);
    if (shown.length > left) { value = shown.slice(0, left); cut = true; }
    return { ok: o.ok === true, value, logs, ...(typeof o.error === 'string' && { error: o.error.slice(0, LIMIT.line) }), ...(cut && { cut: true }), ...(Number.isFinite(o.ms) && { ms: o.ms }) };
  };

  // ---- the engine --------------------------------------------------------------------------------------------------------
  // The bundle's script (the worker cached it at install; Firefox's event page loaded it by name), then its WebAssembly,
  // once. A failed load is forgotten, so the next run tries again.
  let loading = null, heap = null;
  const engine = () => (loading ||= (async () => {
    if (typeof GZ_QUICKJS === 'undefined') {
      if (isNode) require('../../vendor/quickjs/quickjs.js');
      else importScripts('../vendor/quickjs/quickjs.js');
    }
    const bytes = isNode ? require('node:fs').readFileSync(require('node:path').join(__dirname, '../..', ENGINE))
      : await (await fetch((globalThis.chrome?.runtime || globalThis.browser.runtime).getURL(ENGINE))).arrayBuffer();
    heap = new WebAssembly.Memory({ initial: 256, maximum: LIMIT.heap >> 16 });
    return globalThis.GZ_QUICKJS.load(bytes, heap);
  })().catch((e) => { loading = null; throw e; }));

  // A value as the code's console and result show it: strings as they are, the rest as JSON.
  const show = (v) => (typeof v === 'string' ? v : v === undefined ? 'undefined' : JSON.stringify(v) ?? String(v));
  // An error as words. Out of memory, QuickJS may have no room left to make the error or to read it out: anything but an
  // error while the heap is at its maximum is that.
  const full = () => !!heap && heap.buffer.byteLength >= LIMIT.heap * 0.9;
  const errorOf = (e) => {
    if ((typeof e?.message === 'string' && /^out of memory$/i.test(e.message)) || ((e === null || e === '' || (typeof e === 'object' && !e.message)) && full())) return 'The code ran out of memory.';
    if (e && typeof e === 'object' && typeof e.message === 'string') return `${e.name || 'Error'}: ${e.message}`;
    return `Thrown: ${show(e)}`;
  };
  const fail = (error, ms) => ({ ok: false, value: null, logs: [], error, ...(ms !== undefined && { ms }) });

  const run = async (code, { ms = LIMIT.ms } = {}) => {
    if (typeof code !== 'string' || !code.trim()) return fail('No code to run.');
    if (code.length > LIMIT.code) return fail(`The code is longer than ${LIMIT.code} characters.`);
    let Q;
    try { Q = await engine(); } catch { return fail('Glaze could not start its code engine; nothing ran.'); }
    const t0 = Date.now(), deadline = t0 + ms;
    let stopped = false;
    const rt = Q.newRuntime();
    rt.setMemoryLimit(LIMIT.memory);
    rt.setMaxStackSize(LIMIT.stack);
    rt.setInterruptHandler(() => (Date.now() > deadline ? (stopped = true) : false));
    const vm = rt.newContext();
    const logs = [];
    let size = 0, cut = false;
    try {
      // console: log, info, warn, error, debug and table, each a line held to the limits as it comes.
      const log = vm.newFunction('log', (...args) => {
        if (logs.length >= LIMIT.lines || size >= LIMIT.output) { cut = true; return; }
        const l = args.map((h) => show(vm.dump(h))).join(' ').slice(0, Math.min(LIMIT.line, LIMIT.output - size));
        size += l.length; logs.push(l);
      });
      const console_ = vm.newObject();
      for (const k of ['log', 'info', 'warn', 'error', 'debug', 'table']) vm.setProp(console_, k, log);
      vm.setProp(vm.global, 'console', console_);
      console_.dispose(); log.dispose();
      const r = vm.evalCode(code, 'run_js.js');
      const end = (out) => tidy({ ...out, logs, cut, ms: Date.now() - t0 });
      if (r.error) { const e = vm.dump(r.error); r.error.dispose(); return end(stopped ? fail(`Stopped after ${ms / 1000} seconds.`) : { ok: false, value: null, error: errorOf(e) }); }
      let h = r.value;
      // A promise: its jobs run until it settles or the time is up. getPromiseState of anything else is that value itself.
      if (vm.getPromiseState(h).notAPromise !== true) {
        while (vm.getPromiseState(h).type === 'pending' && rt.hasPendingJob() && Date.now() <= deadline) {
          const j = rt.executePendingJobs();
          if (j.error) { const e = vm.dump(j.error); j.error.dispose(); h.dispose(); return end(stopped ? fail(`Stopped after ${ms / 1000} seconds.`) : { ok: false, value: null, error: errorOf(e) }); }
        }
        const st = vm.getPromiseState(h);
        h.dispose();
        if (st.type === 'pending') return end(stopped || Date.now() > deadline ? fail(`Stopped after ${ms / 1000} seconds.`) : { ok: false, value: null, error: "The code's promise never settled." });
        if (st.type === 'rejected') { const e = vm.dump(st.error); st.error.dispose(); return end({ ok: false, value: null, error: errorOf(e) }); }
        h = st.value;
      }
      const v = vm.dump(h);
      h.dispose();
      return end({ ok: true, value: typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null ? v : v === undefined ? 'undefined' : v });
    } catch (e) {
      // An engine fault (out of memory inside a call, a broken heap): this module is dropped and the next run loads afresh.
      loading = null;
      const out = String(e?.message || e);
      return tidy({ ...fail(stopped ? `Stopped after ${ms / 1000} seconds.` : /memory/i.test(out) ? 'The code ran out of memory.' : 'The code engine failed.'), ms: Date.now() - t0 });
    } finally {
      try { vm.dispose(); rt.dispose(); } catch { loading = null; }
    }
  };

  const spec = () => AT().SPECS.find((t) => t.name === 'run_js');
  const tools = () => [{
    name: 'run_js', kind: spec().kind, description: spec().description, parameters: spec().parameters,
    run: async (args) => { const { ms: _, ...out } = await run(String(args.code)); return out; },
  }];
  const register = (registry) => tools().map((t) => registry.add(t));
  return { LIMIT, tidy, run, tools, register };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_RIME_JS; else GZ_AI_RIME_JS;
