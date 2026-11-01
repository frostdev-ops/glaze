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
  // pages. This build undercounts allocations, so the engine heap also stays within the run's memory budget (including
  // engine overhead), below the absolute heap cap. The native allocator limit alone cannot bound many small allocations.
  const LIMIT = { code: 1000, ms: 2000, output: 4000, lines: 40, line: 500, memory: 32 << 20, stack: 512 << 10, heap: 64 << 20 };
  const ENGINE = 'vendor/quickjs/quickjs.wasm';
  const HEAP = Math.min(LIMIT.memory, LIMIT.heap);
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
      : await (await fetch(chrome.runtime.getURL('vendor/quickjs/quickjs.wasm'))).arrayBuffer();
    heap = new WebAssembly.Memory({ initial: 256, maximum: HEAP >> 16 });
    return globalThis.GZ_QUICKJS.load(bytes, heap);
  })().catch((e) => { loading = null; throw e; }));

  const full = () => !!heap && heap.buffer.byteLength >= HEAP * 0.9;
  const fail = (error, ms) => ({ ok: false, value: null, logs: [], error, ...(ms !== undefined && { ms }) });

  const execute = async (code, { ms = LIMIT.ms } = {}) => {
    if (typeof code !== 'string' || !code.trim()) return fail('No code to run.');
    if (code.length > LIMIT.code) return fail(`The code is longer than ${LIMIT.code} characters.`);
    let Q;
    try { Q = await engine(); } catch { return fail('Glaze could not start its code engine; nothing ran.'); }
    const t0 = Date.now(), deadline = t0 + ms;
    let stopped = false, rt, vm;
    const logs = [], handles = new Set();
    const own = (h) => { handles.add(h); return h; };
    let size = 0, cut = false;
    const end = (out) => {
      if (out.error === 'The code ran out of memory.') loading = null;
      return tidy({ ...(stopped || Date.now() > deadline ? fail(`Stopped after ${ms / 1000} seconds.`) : out), logs, cut, ms: Date.now() - t0 });
    };
    try {
      rt = Q.newRuntime();
      rt.setMemoryLimit(LIMIT.memory);
      rt.setMaxStackSize(LIMIT.stack);
      rt.setInterruptHandler(() => (Date.now() > deadline ? (stopped = true) : false));
      vm = rt.newContext();
      // Capture the guest's serializers before the code can replace its builtins. Only a bounded string crosses into
      // the host, including for console arguments; getters and toJSON still run under the runtime's interrupt.
      const serializer = vm.evalCode(`(() => {
        const json = JSON.stringify, str = String, slice = Function.prototype.call.bind(String.prototype.slice);
        return (v, n, error) => {
          let s;
          if (error && v && typeof v === 'object' && typeof v.message === 'string') {
            s = (typeof v.name === 'string' ? v.name : 'Error') + ': ' + v.message;
          } else {
            s = typeof v === 'string' ? v : typeof v === 'bigint' || typeof v === 'symbol' ? str(v) : json(v);
            if (s === undefined) s = str(v);
            if (error) s = 'Thrown: ' + s;
          }
          return slice(s, 0, n + 1);
        };
      })()`);
      if (serializer.error) { own(serializer.error); throw new Error('memory'); }
      const display = own(serializer.value);
      const read = (h, limit, error = false) => {
        const n = vm.newNumber(limit);
        let r;
        try {
          r = vm.callFunction(display, vm.undefined, h, n, error ? vm.true : vm.false);
          if (r.error) throw new Error(full() ? 'memory' : 'serialization');
          return vm.getString(r.value);
        } finally { n.dispose(); (r?.error || r?.value)?.dispose(); }
      };
      const error = (h) => {
        const s = read(h, LIMIT.line, true);
        return /^(?:Error|InternalError): out of memory$/i.test(s) || (full() && ['Thrown: null', 'Thrown: ""', 'Thrown: {}'].includes(s)) ? 'The code ran out of memory.' : s;
      };
      const log = own(vm.newFunction('log', (...args) => {
        if (logs.length >= LIMIT.lines || size >= LIMIT.output) { cut = true; return; }
        const limit = Math.min(LIMIT.line, LIMIT.output - size);
        let line = '';
        for (let i = 0; i < args.length; i++) {
          if (i) line += ' ';
          if (line.length > limit) { cut = true; break; }
          const s = read(args[i], limit - line.length);
          line += s;
          if (line.length > limit) { cut = true; break; }
        }
        line = line.slice(0, limit);
        size += line.length; logs.push(line);
      }));
      const console_ = own(vm.newObject());
      for (const k of ['log', 'info', 'warn', 'error', 'debug', 'table']) vm.setProp(console_, k, log);
      vm.setProp(vm.global, 'console', console_);
      const r = vm.evalCode(code, 'run_js.js');
      if (r.error) return end({ ok: false, value: null, error: error(own(r.error)) });
      let h = own(r.value), st = vm.getPromiseState(h);
      // Inspect a settled promise once: each inspection creates an owned result handle.
      if (st.notAPromise !== true) {
        while (st.type === 'pending' && rt.hasPendingJob() && Date.now() <= deadline) {
          const j = rt.executePendingJobs();
          if (j.error) return end({ ok: false, value: null, error: error(own(j.error)) });
          st = vm.getPromiseState(h);
        }
        if (st.type === 'pending') return end({ ok: false, value: null, error: "The code's promise never settled." });
        if (st.type === 'rejected') return end({ ok: false, value: null, error: error(own(st.error)) });
        h = own(st.value);
      }
      const type = vm.typeof(h), s = read(h, LIMIT.output - size);
      let value = s;
      if (!['string', 'bigint', 'symbol'].includes(type) && s.length <= LIMIT.output - size) {
        try { value = JSON.parse(s); } catch { /* undefined and non-JSON primitives remain words */ }
      }
      return end({ ok: true, value });
    } catch (e) {
      // An engine fault (out of memory inside a call, a broken heap): reload on the next run.
      loading = null;
      const out = String(e?.message || e);
      return end(fail(/memory/i.test(out) ? 'The code ran out of memory.' : 'The code engine failed.'));
    } finally {
      // Each cleanup is independent: a broken handle or context must not skip the runtime's disposal.
      for (const resource of [...handles, vm, rt]) {
        try { if (resource?.alive) resource.dispose(); } catch { loading = null; }
      }
      // WebAssembly memory cannot shrink when a context is freed. A previous run's high-water mark must not make
      // an ordinary exception in a fresh context look like an allocation failure.
      if (full()) loading = null;
    }
  };

  // Keep engine acquisition inside the same turn as execution and cleanup. Callers awaiting one shared load must not
  // retain that module after another caller faults it and drops the cache.
  let queue = Promise.resolve();
  const run = (code, options) => {
    const turn = queue.then(() => execute(code, options));
    queue = turn.catch(() => {});
    return turn;
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
