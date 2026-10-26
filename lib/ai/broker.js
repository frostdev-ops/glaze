// The AI harness's broker (docs/ai-harness.md), in the worker: the one place a model is asked, and the only one that holds
// the connections (an endpoint's address, model and key). A feature asks over a runtime port named 'glaze:ai'
// (lib/background.js checks who opened it: Glaze's own pages, or Glaze in a frame of a site it runs on, never a quiz's page).
//   page → { id, op: 'run', feature, task, input }  { id, op: 'cancel' }  { id, op: 'status', feature }
//          { id, op: 'confirm', confirmId, approve }
//   worker → the run's events, each { id, type, … } (lib/ai/loop.js: thinking, text_delta, says, note, step_start, step,
//          pending, usage, reply), then { id, type: 'end', output?, pending?, steps?, meta } or { id, type: 'error', error,
//          reference?, status? }. status → { id, type: 'status', on, allowed, ready?, why?, provider?, caps? }. confirm →
//          { id, type: 'confirmed', result } | { id, type: 'declined' } | { id, type: 'error', error, note }.
// A run is checked here before anything is sent: Glaze and AI on, the feature allowed (lib/ai/settings.js), the task known,
// the chosen connection's settings clean, the model one its catalog lists (lib/ai/models.js select; unverified when no
// list could be had), what the task needs within what the provider and catalog say, the browser holding the connection's
// host, the input within LIMIT, one run at a time for a tab's feature and LIMIT.perMinute of them. Every request goes out
// through a fetch pinned to the connection's host and to the generation it was admitted on: a connection changed mid-run
// sends nothing more ('changed'). A closed port cancels its runs and drops what waits for a confirm (keep the port open while
// a run is in flight: its state dies with the worker). A page is told codes, never a provider's words, an address or a key.
// Each run leaves one row in storage.local aiCalls (lib/ai/failure.js record: the last 40, metadata only).
// Settings (options.html, its top frame) keeps the connections with 'glaze:ai-config' (config below).
// Classic script: the worker imports it on first use; module.exports for node.
var GZ_AI_BROKER = globalThis.GZ_AI_BROKER || (() => {
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('./request.js'));
  const P = () => (typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('./providers.js'));
  const T = () => (typeof GZ_AI_TASKS !== 'undefined' ? GZ_AI_TASKS : require('./task.js'));
  const A = () => (typeof GZ_AI_SETTINGS !== 'undefined' ? GZ_AI_SETTINGS : require('./settings.js'));
  const F = () => (typeof GZ_AI_FAILURE !== 'undefined' ? GZ_AI_FAILURE : require('./failure.js'));
  const E = () => (typeof GZ_AI_ENDPOINT !== 'undefined' ? GZ_AI_ENDPOINT : require('./endpoint.js'));
  const M = () => (typeof GZ_AI_MODELS !== 'undefined' ? GZ_AI_MODELS : require('./models.js'));
  const L = () => (typeof GZ_AI_LOOP !== 'undefined' ? GZ_AI_LOOP : require('./loop.js'));
  // message: a run's input as JSON (characters); perMinute: runs a tab's feature may start in a minute; all: every tab's;
  // test, catalog: how long Settings' Test and a run's catalog lookup may take.
  const LIMIT = { message: 16 << 20, perMinute: 6, all: 30, test: 20000, catalog: 8000 };
  const FEATURE = /^[a-z][a-z0-9-]{0,31}$/;
  const CALLS = 'aiCalls';
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

  // ---- the connections ------------------------------------------------------------------------------------------------
  // The worker's own IndexedDB (glaze-ai, store vault): no page's script can read it, unlike storage.local, and it is in no
  // Back up file. 'connections': { [id]: { provider, generation, …its settings } }; 'models:…': kept catalogs.
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
  // A stored connection, usable: → { id, p, cfg, generation } or null.
  const usable = (id, rec) => {
    const p = isObj(rec) && A().PROVIDERS.includes(rec.provider) ? P().get(rec.provider) : null;
    const { provider: _, ...raw } = isObj(rec) ? rec : {};
    const cfg = p && p.config(raw);
    return cfg ? { id, p, cfg, generation: rec.generation } : null;
  };
  const using = async (env, id) => (typeof id === 'string' && E().ID.test(id) ? usable(id, (await connections(env))[id]) : null);
  // Whether the browser holds the connection's host (a provider that goes nowhere holds none).
  const reaches = async (env, { p, cfg }) => !p.origin || !!await env.reach(p.origin(cfg).replace(/\*$/, ''));
  // The connection's host only, and only while the connection is the one admitted: a request anywhere else, or after the
  // address or key changed, is refused before it is made.
  const unchanged = async (env, use, signal) => {
    if ((await F().wait(() => connections(env), signal))[use.id]?.generation !== use.generation) throw R().error('changed');
  };
  const pinned = (env, use) => async (url, init) => {
    let u;
    try { u = new URL(url); } catch { throw new TypeError('address'); }
    if (!use.p.origin || u.origin !== new URL(use.cfg.base).origin) throw new TypeError('host');
    await unchanged(env, use, init?.signal);
    const response = await F().wait(() => env.fetch(url, init), init?.signal);
    try { await unchanged(env, use, init?.signal); } catch (e) { response.body?.cancel?.().catch(() => {}); throw e; }
    return response;
  };
  const cache = (env) => ({ get: (k) => env.vault.get(k), set: (k, v) => env.vault.set(k, v) });
  // The connection's catalog, if one can be had quickly; null otherwise (the model is then unverified).
  const catalog = async (env, use, signal) => {
    if (!use.p.catalog) return null;
    const t = F().deadline(LIMIT.catalog), s = F().anySignal([signal, t.signal]);
    try { return await F().wait(() => use.p.catalog(use.cfg, { fetch: pinned(env, use), cache: cache(env), signal: s.signal }), s.signal); } catch { return null; } finally { t.done(); s.done(); }
  };

  // ---- limits shared by every port ------------------------------------------------------------------------------------
  const inflight = new Map(); // `${who}|${feature}` → AbortController
  const admitted = new Map(); // controller → the connection admitted for a run or confirmation
  const revoke = (id) => { for (const [control, use] of admitted) if (use.id === id) control.abort(R().error('changed')); };
  const starts = new Map(); // the same key, and '' for all → start times in the last minute
  const often = (key, now) => {
    const recent = (k) => { const l = (starts.get(k) || []).filter((t) => now - t < 60000); starts.set(k, l); return l; };
    if (recent(key).length >= LIMIT.perMinute || recent('').length >= LIMIT.all) return true;
    starts.get(key).push(now); starts.get('').push(now);
    return false;
  };

  // ---- a port ---------------------------------------------------------------------------------------------------------
  // env: { allowed (a promise: lib/background.js's sender check), who (the sender's tab), settings() (storage.local ai),
  // enabled() (Glaze's switch), vault (get, set, remove), local (storage.local: get, set; the call record), reach(url),
  // fetch, task(id), tools?, now? }.
  const connect = (port, env) => {
    const mine = new Map(); // run id → AbortController
    const confirms = new Map(); // parked calls (lib/ai/loop.js), for this port only
    let closed = false;
    const close = () => { if (closed) return; closed = true; for (const c of mine.values()) c.abort(new DOMException('Closed', 'AbortError')); mine.clear(); confirms.clear(); };
    const post = (m) => { if (closed) return; try { port.postMessage(m); } catch { close(); } };
    const allowed = () => Promise.resolve().then(() => typeof env.allowed === 'function' ? env.allowed() : env.allowed).then((ok) => ok === true, () => false);
    const forget = (id) => {
      for (const [key, parked] of confirms) if (id === undefined || parked.runId === id) { confirms.delete(key); if (confirms.current === key) confirms.current = null; }
    };
    port.onDisconnect.addListener(close);
    port.onMessage.addListener((m) => {
      allowed().then((ok) => {
        if (!ok) { close(); try { port.disconnect(); } catch { /* gone */ } return; }
        if (!closed) handle(m).catch(() => post({ id: Number.isSafeInteger(m?.id) ? m.id : null, type: 'error', error: 'failed' }));
      });
    });
    const handle = async (m) => {
      if (!isObj(m) || !Number.isSafeInteger(m.id) || m.id < 0) return post({ id: null, type: 'error', error: 'request' });
      if (m.op === 'cancel') { mine.get(m.id)?.abort(new DOMException('Cancelled', 'AbortError')); forget(m.id); return; }
      if (m.op === 'status') return post({ id: m.id, type: 'status', ...await status(m, env) });
      if (m.op === 'run') return run(m);
      if (m.op === 'confirm') return confirm(m);
      post({ id: m.id, type: 'error', error: 'request' });
    };
    // Admission: → { s, task, use } or throws a code.
    const admit = async (m) => {
      if (!await env.enabled()) throw R().error('off');
      const s = A().clean(await env.settings());
      if (!s.on) throw R().error('off');
      if (s.features[m.feature] !== true) throw R().error('feature');
      const task = await env.task(m.task);
      if (!task) throw R().error('task');
      const use = await using(env, s.use);
      if (!use) throw R().error('setup');
      if (!await reaches(env, use)) throw R().error('permission');
      return { s, task, use };
    };
    const run = async (m) => {
      const fail = (e) => post({ id: m.id, type: 'error', error: R().code(e), ...(e?.reference && { reference: e.reference }), ...(e?.status && { status: e.status }) });
      if (mine.has(m.id) || typeof m.feature !== 'string' || !FEATURE.test(m.feature) || typeof m.task !== 'string' || !T().ID.test(m.task)
        || Object.keys(m).some((k) => !['id', 'op', 'feature', 'task', 'input'].includes(k))) return fail(R().error('request'));
      let size;
      try { size = JSON.stringify(m.input ?? null).length; } catch { return fail(R().error('input')); }
      if (size > LIMIT.message) return fail(R().error('size'));
      const key = `${env.who}|${m.feature}`;
      if (inflight.has(key)) return fail(R().error('busy'));
      const control = new AbortController();
      forget();
      inflight.set(key, control); mine.set(m.id, control);
      const now = env.now || Date.now, row = { id: F().reference(), task: m.task, feature: m.feature, startedAt: now(), state: 'running' };
      try {
        const admission = F().deadline(LIMIT.catalog), signal = F().anySignal([control.signal, admission.signal]);
        let accepted;
        try { accepted = await F().wait(() => admit(m), signal.signal); } finally { admission.done(); signal.done(); }
        const { task, use } = accepted;
        admitted.set(control, use);
        row.provider = use.p.id;
        const list = await catalog(env, use, control.signal);
        const chosen = M().select(use.cfg.model, list, { tools: !!task.tools, images: !!task.caps.images });
        const cfg = { ...use.cfg, ...(chosen.caps.context && !use.cfg.context && { context: chosen.caps.context }), ...(chosen.caps.images !== undefined && use.cfg.images === undefined && { images: chosen.caps.images }) };
        if (often(key, now())) throw R().error('often');
        if (control.signal.aborted) throw Object.assign(R().error('cancelled'), { category: 'cancelled' });
        const remember = (id) => { const parked = confirms.get(id); if (parked) Object.assign(parked, { runId: m.id, feature: m.feature, task: m.task, use }); };
        const out = await T().run(task, m.input, { provider: use.p, cfg, signal: control.signal, fetch: pinned(env, use), tools: env.tools, confirms,
          emit: (ev) => { if (control.signal.aborted || closed) return; if (ev.pending) remember(ev.pending.confirmId); post({ ...ev, id: m.id, ...(ev.id !== undefined && { event: ev.id }) }); } });
        await unchanged(env, use, control.signal);
        if (out.pending) remember(out.pending.confirmId);
        Object.assign(row, { state: out.pending ? 'pending' : 'completed', usage: out.meta.usage, steps: out.meta.rounds, parts: out.meta.parts });
        post({ id: m.id, type: 'end', ...(out.output !== undefined && { output: out.output }), ...(out.pending && { pending: out.pending }), ...(out.steps && { steps: out.steps }),
          meta: { ...out.meta, ...(chosen.unverified && { unverified: true }) } });
      } catch (e) {
        const err = control.signal.aborted && R().code(e) !== 'timeout' ? (R().code(control.signal.reason) === 'changed' ? R().error('changed') : Object.assign(R().error('cancelled'), { category: 'cancelled' })) : e;
        forget(m.id);
        Object.assign(row, { state: R().code(err), ...(err?.category && { category: err.category }), ...(err?.status && { status: err.status }), ...(err?.reference && { id: err.reference }) });
        fail(err);
      } finally {
        if (inflight.get(key) === control) inflight.delete(key);
        mine.delete(m.id); admitted.delete(control);
        row.ms = now() - row.startedAt;
        if (row.provider && env.local) await F().record(env.local, CALLS, row);
      }
    };
    // The student's answer to a pending call: claimed once, the run's admission checked again (it may only have narrowed),
    // then the tool runs, or doesn't. Glaze's H1 tools are proposals: their run gives what the page then shows or does.
    const confirm = async (m) => {
      if (typeof m.approve !== 'boolean' || mine.has(m.id)) return post({ id: m.id, type: 'error', error: 'request' });
      let parked;
      try { parked = L().claimConfirm(confirms, m.confirmId, env.now || Date.now); } catch { return post({ id: m.id, type: 'error', error: 'request' }); }
      if (!m.approve) return post({ id: m.id, type: 'declined' });
      const control = new AbortController(), timer = F().deadline(LIMIT.test), both = F().anySignal([control.signal, timer.signal]);
      mine.set(m.id, control);
      const revision = env.revision?.();
      try {
        if (closed || !await F().wait(allowed, both.signal)) throw R().error('permission');
        const { task, use } = await F().wait(() => admit(parked), both.signal);
        if (use.id !== parked.use?.id || use.generation !== parked.use.generation) throw R().error('changed');
        admitted.set(control, use);
        const tools = env.tools || (typeof GZ_AI_TOOLS !== 'undefined' ? GZ_AI_TOOLS : require('./tools.js'));
        if (!task.tools?.includes(parked.tool.name) || tools.get(parked.tool.name) !== parked.tool) throw R().error('tool');
        await unchanged(env, use, both.signal);
        if (closed || env.revision?.() !== revision) throw R().error('changed');
        const result = await F().wait(() => parked.tool.run(structuredClone(parked.args), { signal: both.signal }), both.signal);
        post({ id: m.id, type: 'confirmed', result: JSON.parse(L().output(result)) });
      } catch (e) { post({ id: m.id, type: 'error', error: R().code(control.signal.aborted ? control.signal.reason : e) }); }
      finally { mine.delete(m.id); admitted.delete(control); timer.done(); both.done(); }
    };
    return { close };
  };
  // What a feature may know before it offers AI: whether it is on and allowed, and, when it is, whether a run could start
  // (ready, else why) on which provider and with what caps. No address, model or key, and nothing fetched.
  const status = async (m, env) => {
    if (typeof m.feature !== 'string' || !FEATURE.test(m.feature)) return { on: false, allowed: false, why: 'request' };
    const s = A().clean(await env.settings());
    const on = s.on && await env.enabled();
    if (!on || s.features[m.feature] !== true) return { on, allowed: false };
    const use = await using(env, s.use);
    if (!use) return { on, allowed: true, ready: false, why: 'setup' };
    let ready = await reaches(env, use), why = ready ? undefined : 'permission';
    if (ready && typeof use.p.prepare === 'function') {
      const st = await use.p.status(use.cfg, {}).catch(() => ({ state: 'unavailable' }));
      ready = st.state === 'ready';
      if (!ready) why = ['download', 'downloading'].includes(st.state) ? st.state : 'unavailable';
    }
    return { on, allowed: true, ready, ...(why && { why }), provider: use.p.id, caps: P().caps(use.p, use.cfg) };
  };

  // ---- Settings' connections (lib/background.js 'glaze:ai-config', from options.html's top frame only) ------------------
  //   { op: 'get' } → { ok, connections: { [id]: { provider, …settings without the key, key: masked or '', origin } } }
  //   { op: 'set', id, cfg: { provider, …settings } } → { ok, origin } | { ok: false, error: 'setup', note }. A cfg with no key
  //     keeps the kept one, but only for the same address: a key never follows a changed address. A new address or key is a
  //     new generation.
  //   { op: 'remove', id } → { ok }
  //   { op: 'test', id } → { ok, state, reason?, status?, reference?, source? }: the provider's status, once its host is held.
  //   { op: 'models', id } → { ok, models, source, at } | { ok: false, error }: its catalog, for a model picker.
  //   { op: 'test', provider: 'device' } → { ok, state, reason? }: a provider with a model on this computer, before any
  //     connection uses it. { op: 'prepare', provider: 'device' } (from a click) → { ok, state, reason? } once its model is
  //     downloaded and loaded; meanwhile env.say({ type: 'glaze:ai-config', event: 'progress', provider, loaded: 0..1 }).
  //     Not queued: a download takes minutes. Settings asks 'test' again if the worker stopped before it answered.
  const local = (m, env) => {
    const p = typeof m.provider === 'string' && A().PROVIDERS.includes(m.provider) ? P().get(m.provider) : null;
    const cfg = p && typeof p.prepare === 'function' && p.config({});
    if (!cfg) return Promise.resolve({ ok: false, error: 'setup' });
    const done = (st) => ({ ok: true, state: ['ready', 'download', 'downloading', 'unavailable'].includes(st?.state) ? st.state : 'unavailable', ...(typeof st?.reason === 'string' && { reason: st.reason }) });
    const failed = () => ({ ok: true, state: 'unavailable', reason: 'failed' });
    if (m.op === 'test') return p.status(cfg, {}).then(done, failed);
    return p.prepare(cfg, { onProgress: (loaded) => { try { env.say?.({ type: 'glaze:ai-config', event: 'progress', provider: p.id, loaded }); } catch { /* no page listening */ } } }).then(done, failed);
  };
  let turn = Promise.resolve();
  const queued = (f) => { const next = turn.then(f, f); turn = next.catch(() => {}); return next; };
  const config = (m, env) => ((m?.op === 'prepare' || m?.op === 'test') && m.id === undefined ? local(m, env) : queued(async () => {
    const all = await connections(env);
    if (m?.op === 'get') {
      const out = {};
      for (const [id, rec] of Object.entries(all)) {
        const use = usable(id, rec);
        if (!use) continue;
        const { key, generation: _, ...shown } = use.cfg;
        out[id] = { provider: use.p.id, ...shown, key: key ? E().mask(key) : '', ...(use.p.origin && { origin: use.p.origin(use.cfg) }) };
      }
      return { ok: true, connections: out, providers: A().PROVIDERS.filter((id) => P().get(id)) };
    }
    if (typeof m?.id !== 'string' || !E().ID.test(m.id)) return { ok: false, error: 'setup', note: 'A connection name is 1 to 40 lowercase letters, digits or dashes.' };
    if (m.op === 'set') {
      if (!isObj(m.cfg) || !A().PROVIDERS.includes(m.cfg.provider) || !P().get(m.cfg.provider)) return { ok: false, error: 'setup', note: 'Choose a provider.' };
      const { provider, ...raw } = m.cfg;
      if (provider === 'openai') { try { E().parse(raw.base); } catch (e) { return { ok: false, error: 'setup', note: e.message }; } }
      const p = P().get(provider), before = usable(m.id, all[m.id]);
      const same = before && before.p === p && E().normalize(before.cfg.base) === E().normalize(raw.base);
      let cfg = p.config({ ...raw, ...(!Object.hasOwn(raw, 'key') && same && before.cfg.key && { key: before.cfg.key }) });
      if (!cfg) return { ok: false, error: 'setup', note: 'Check the address, the model and the key.' };
      const { generation: _, ...settings } = cfg;
      const generation = same && before.cfg.key === settings.key && before.generation ? before.generation : E().generation();
      if (!await env.vault.set(CONNECTIONS, { ...all, [m.id]: { provider, ...settings, generation } })) return { ok: false, error: 'write' };
      if (before?.generation !== generation) revoke(m.id);
      return { ok: true, ...(p.origin && { origin: p.origin(cfg) }) };
    }
    if (m.op === 'remove') { const { [m.id]: _, ...rest } = all; const ok = await env.vault.set(CONNECTIONS, rest); if (ok) revoke(m.id); return { ok }; }
    const use = usable(m.id, all[m.id]);
    if (!use) return { ok: false, error: 'setup' };
    if (m.op === 'test') {
      if (!await reaches(env, use)) return { ok: true, state: 'unavailable', reason: 'permission' };
      const timer = F().deadline(LIMIT.test);
      let st;
      try { st = await F().wait(() => use.p.status(use.cfg, { fetch: pinned(env, use), cache: cache(env), signal: timer.signal }), timer.signal); }
      catch { st = { state: 'unavailable', reason: 'failed' }; } finally { timer.done(); }
      return { ok: true, state: ['ready', 'download', 'downloading', 'unavailable'].includes(st?.state) ? st.state : 'unavailable', ...(typeof st?.reason === 'string' && { reason: st.reason }), ...(Number.isInteger(st?.status) && { status: st.status }), ...(typeof st?.reference === 'string' && { reference: st.reference }), ...(st?.source && { source: st.source }), ...(st?.unverified && { unverified: true }) };
    }
    if (m.op === 'models') {
      if (!await reaches(env, use)) return { ok: false, error: 'permission' };
      if (!use.p.catalog) return { ok: false, error: 'setup' };
      const timer = F().deadline(LIMIT.catalog);
      try { const c = await F().wait(() => use.p.catalog(use.cfg, { fetch: pinned(env, use), cache: cache(env), signal: timer.signal }), timer.signal); return { ok: true, models: c.models, source: c.source, at: c.at }; } catch (e) { return { ok: false, error: F().modelFailure(e).category }; } finally { timer.done(); }
    }
    return { ok: false, error: 'op' };
  }));

  return { LIMIT, CONNECTIONS, CALLS, vault, connect, status, config, _reset: () => { inflight.clear(); starts.clear(); } };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_BROKER; else GZ_AI_BROKER;
