// The AI harness's broker (docs/ai-harness.md), in the worker: the one place a model is asked, and the only one that holds
// the connections (each provider's settings, a key among them). A feature asks over a runtime port named 'glaze:ai'
// (lib/background.js checks who opened it: Glaze's own pages, or Glaze in a tab of a site it runs on, never a quiz's page):
//   page → { id, op: 'run', feature, task, input }  { id, op: 'cancel' }  { id, op: 'status', feature }
//   worker → { id, type: 'progress', part?, parts?, step? }  { id, type: 'delta', text } (a task with stream only)
//            { id, type: 'result', output, proposals?, meta }  { id, type: 'error', error }  { id, type: 'status', on, allowed,
//            ready?, provider?, caps?, why? }
// A run is checked here before anything is sent: Glaze and AI on, the feature allowed (lib/ai/settings.js), the task known,
// a connection for the chosen provider that cleans, what the task needs within the provider's caps, the browser holding the
// provider's host, the input within LIMIT, at most one run at a time for a tab's feature and LIMIT.perMinute of them. The
// request, the answer and the task's check then go through lib/ai/task.js. A closed port cancels its runs. A page is told
// a code, never a provider's words, a connection or a key. Settings (options.html, its top frame) keeps the connections
// with 'glaze:ai-config' (config below). Classic script: the worker imports it on first use; module.exports for node.
var GZ_AI_BROKER = globalThis.GZ_AI_BROKER || (() => {
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('./request.js'));
  const P = () => (typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('./providers.js'));
  const T = () => (typeof GZ_AI_TASKS !== 'undefined' ? GZ_AI_TASKS : require('./task.js'));
  const A = () => (typeof GZ_AI_SETTINGS !== 'undefined' ? GZ_AI_SETTINGS : require('./settings.js'));
  // message: a run's input as JSON (characters); perMinute: runs a tab's feature may start in a minute; all: every tab's.
  const LIMIT = { message: 16 << 20, perMinute: 6, all: 30, test: 20000 };
  const FEATURE = /^[a-z][a-z0-9-]{0,31}$/;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

  // ---- the connections ------------------------------------------------------------------------------------------------
  // The worker's own IndexedDB (glaze-ai, store vault): no page's script can read it, unlike storage.local, and it is in no
  // Back up file. One record, 'connections': { [provider id]: its settings }.
  const vault = (idb = globalThis.indexedDB) => {
    let db = null;
    const open = () => (db ||= new Promise((resolve, reject) => {
      const r = idb.open('glaze-ai', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames?.contains?.('vault')) r.result.createObjectStore('vault'); };
      r.onerror = () => reject(r.error);
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); db = null; }; resolve(r.result); };
    }).catch((e) => { db = null; throw e; }));
    const tx = async (mode, f) => {
      const t = (await open()).transaction('vault', mode), r = f(t.objectStore('vault'));
      let value;
      r.onsuccess = () => { value = r.result; };
      await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = t.onabort = () => reject(t.error); });
      return value;
    };
    return { get: (k) => tx('readonly', (s) => s.get(k)), set: (k, v) => tx('readwrite', (s) => s.put(v, k)).then(() => true, () => false), remove: (k) => tx('readwrite', (s) => s.delete(k)).then(() => true, () => false) };
  };
  const CONNECTIONS = 'connections';
  const connections = async (env) => { const v = await env.vault.get(CONNECTIONS); return isObj(v) ? v : {}; };
  // A provider and its connection, both usable, or null.
  const using = async (env, id) => {
    const p = A().PROVIDERS.includes(id) ? P().get(id) : null;
    const cfg = p && p.config((await connections(env))[id]);
    return cfg ? { p, cfg } : null;
  };
  // Whether the browser holds the provider's host (a provider that goes nowhere holds none).
  const reaches = async (env, { p, cfg }) => !p.origin || !!await env.reach(p.origin(cfg).replace(/\*$/, ''));
  // The provider's own host only: a fetch anywhere else is refused before it is made.
  const pinned = (env, { p, cfg }) => (url, init) => {
    let u;
    try { u = new URL(url); } catch { return Promise.reject(new TypeError('address')); }
    return p.origin && `${u.protocol}//${u.hostname}/*` === p.origin(cfg) ? env.fetch(url, init) : Promise.reject(new TypeError('host'));
  };

  // ---- limits shared by every port ------------------------------------------------------------------------------------
  const inflight = new Map(); // `${who}|${feature}` → AbortController
  const starts = new Map(); // the same key, and '' for all → start times in the last minute
  const often = (key, now) => {
    const recent = (k) => { const l = (starts.get(k) || []).filter((t) => now - t < 60000); starts.set(k, l); return l; };
    if (recent(key).length >= LIMIT.perMinute || recent('').length >= LIMIT.all) return true;
    starts.get(key).push(now); starts.get('').push(now);
    return false;
  };

  // ---- a port ---------------------------------------------------------------------------------------------------------
  // env: { allowed (a promise: lib/background.js's sender check), who (the sender's tab), settings() (lib/ai/settings.js
  // clean of storage.local ai), enabled() (Glaze's switch), vault (get, set, remove), reach(url), fetch, task(id), tools?, now?,
  // activity?({ feature, task, provider, at, size, ok }) }.
  const connect = (port, env) => {
    const mine = new Map(); // run id → AbortController
    let closed = false;
    const close = () => { if (closed) return; closed = true; for (const c of mine.values()) c.abort(new DOMException('Closed', 'AbortError')); mine.clear(); };
    const post = (m) => { if (closed) return; try { port.postMessage(m); } catch { close(); } };
    const gate = Promise.resolve(env.allowed).then((ok) => ok === true, () => false);
    port.onDisconnect.addListener(close);
    port.onMessage.addListener((m) => {
      gate.then((ok) => {
        if (!ok) { close(); try { port.disconnect(); } catch { /* gone */ } return; }
        if (!closed) handle(m).catch(() => post({ id: Number.isSafeInteger(m?.id) ? m.id : null, type: 'error', error: 'failed' }));
      });
    });
    const handle = async (m) => {
      if (!isObj(m) || !Number.isSafeInteger(m.id) || m.id < 0) return post({ id: null, type: 'error', error: 'request' });
      if (m.op === 'cancel') { mine.get(m.id)?.abort(new DOMException('Cancelled', 'AbortError')); return; }
      if (m.op === 'status') return post({ id: m.id, type: 'status', ...await status(m, env) });
      if (m.op === 'run') return run(m);
      post({ id: m.id, type: 'error', error: 'request' });
    };
    const run = async (m) => {
      const fail = (error) => post({ id: m.id, type: 'error', error });
      if (mine.has(m.id) || typeof m.feature !== 'string' || !FEATURE.test(m.feature) || typeof m.task !== 'string' || !T().ID.test(m.task)
        || Object.keys(m).some((k) => !['id', 'op', 'feature', 'task', 'input'].includes(k))) return fail('request');
      let size;
      try { size = JSON.stringify(m.input ?? null).length; } catch { return fail('input'); }
      if (size > LIMIT.message) return fail('size');
      const key = `${env.who}|${m.feature}`;
      if (inflight.has(key)) return fail('busy');
      const control = new AbortController();
      inflight.set(key, control); mine.set(m.id, control);
      const now = env.now || Date.now;
      let provider = null;
      try {
        if (!await env.enabled()) throw R().error('off');
        const s = A().clean(await env.settings());
        if (!s.on) throw R().error('off');
        if (s.features[m.feature] !== true) throw R().error('feature');
        const task = await env.task(m.task);
        if (!task) throw R().error('task');
        const use = await using(env, s.use);
        if (!use) throw R().error('setup');
        provider = use.p.id;
        if (!await reaches(env, use)) throw R().error('permission');
        if (often(key, now())) throw R().error('often');
        if (control.signal.aborted) throw R().error('cancelled');
        post({ id: m.id, type: 'progress', part: 0 });
        const out = await T().run(task, m.input, { provider: use.p, cfg: use.cfg, signal: control.signal, fetch: pinned(env, use), tools: env.tools,
          onDelta: (text) => post({ id: m.id, type: 'delta', text }), onProgress: (x) => post({ id: m.id, type: 'progress', part: x.part, parts: x.parts }),
          onStep: (x) => post({ id: m.id, type: 'progress', step: x.step }) });
        const { task: id, version, finish, usage, steps, parts } = out.meta;
        post({ id: m.id, type: 'result', output: out.output, ...(out.proposals && { proposals: out.proposals }), meta: { task: id, version, provider, finish, usage, steps, parts } });
        env.activity?.({ feature: m.feature, task: m.task, provider, at: now(), size, ok: true });
      } catch (e) {
        const code = R().code(e);
        fail(control.signal.aborted && code !== 'timeout' ? 'cancelled' : code);
        if (provider) env.activity?.({ feature: m.feature, task: m.task, provider, at: now(), size, ok: false });
      } finally {
        if (inflight.get(key) === control) inflight.delete(key);
        mine.delete(m.id);
      }
    };
    return { close };
  };
  // What a feature may know before it offers AI: whether it is on and allowed, and, when it is, whether a run could start
  // (ready, else why) on which provider and with what caps. No address, model or key.
  const status = async (m, env) => {
    if (typeof m.feature !== 'string' || !FEATURE.test(m.feature)) return { on: false, allowed: false, why: 'request' };
    const s = A().clean(await env.settings());
    const on = s.on && await env.enabled();
    if (!on || s.features[m.feature] !== true) return { on, allowed: false };
    const use = await using(env, s.use);
    if (!use) return { on, allowed: true, ready: false, why: 'setup' };
    const ok = await reaches(env, use);
    return { on, allowed: true, ready: ok, ...(!ok && { why: 'permission' }), provider: use.p.id, caps: P().caps(use.p, use.cfg) };
  };

  // ---- Settings' connections (lib/background.js 'glaze:ai-config', from options.html's top frame only) ------------------
  //   { op: 'get' } → { ok, connections: { [id]: settings without the key, key: whether one is kept, origin } }
  //   { op: 'set', provider, cfg } → { ok, origin } | { ok: false, error: 'setup' }. A cfg with no key keeps the kept one,
  //     but only for the same host: a key never follows a changed address.
  //   { op: 'remove', provider } → { ok }
  //   { op: 'test', provider } → { ok, state, reason? }: the provider's status (lib/ai/providers.js), once its host is held.
  let turn = Promise.resolve();
  const queued = (f) => { const next = turn.then(f, f); turn = next.catch(() => {}); return next; };
  const known = (id) => typeof id === 'string' && A().PROVIDERS.includes(id) && !!P().get(id);
  const config = (m, env) => queued(async () => {
    const all = await connections(env);
    if (m?.op === 'get') {
      const out = {};
      for (const [id, raw] of Object.entries(all)) {
        const p = known(id) && P().get(id), cfg = p && p.config(raw);
        if (!cfg) continue;
        const { key, ...shown } = cfg;
        out[id] = { ...shown, key: !!key, ...(p.origin && { origin: p.origin(cfg) }) };
      }
      return { ok: true, connections: out };
    }
    if (!known(m?.provider)) return { ok: false, error: 'setup' };
    const p = P().get(m.provider);
    if (m.op === 'set') {
      if (!isObj(m.cfg)) return { ok: false, error: 'setup' };
      const before = p.config(all[m.provider]);
      let cfg = p.config(m.cfg);
      if (cfg && !Object.hasOwn(m.cfg, 'key') && before?.key && p.origin && p.origin(before) === p.origin(cfg)) cfg = p.config({ ...m.cfg, key: before.key });
      if (!cfg) return { ok: false, error: 'setup' };
      if (!await env.vault.set(CONNECTIONS, { ...all, [m.provider]: cfg })) return { ok: false, error: 'write' };
      return { ok: true, ...(p.origin && { origin: p.origin(cfg) }) };
    }
    if (m.op === 'remove') { const { [m.provider]: _, ...rest } = all; return { ok: await env.vault.set(CONNECTIONS, rest) }; }
    if (m.op === 'test') {
      const cfg = p.config(all[m.provider]);
      if (!cfg) return { ok: false, error: 'setup' };
      if (!await reaches(env, { p, cfg })) return { ok: true, state: 'unavailable', reason: 'permission' };
      const st = await p.status(cfg, { fetch: pinned(env, { p, cfg }), signal: AbortSignal.timeout(LIMIT.test) }).catch(() => ({ state: 'unavailable', reason: 'failed' }));
      return { ok: true, state: ['ready', 'download', 'downloading', 'unavailable'].includes(st?.state) ? st.state : 'unavailable', ...(typeof st?.reason === 'string' && { reason: st.reason }) };
    }
    return { ok: false, error: 'op' };
  });

  return { LIMIT, CONNECTIONS, vault, connect, status, config, _reset: () => { inflight.clear(); starts.clear(); } };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_BROKER; else GZ_AI_BROKER;
