// Background updates of Rime, Glaze's own model (docs/ai-harness.md "Model updates"). Frostdev publishes a signed model list
// beside the weights on Hugging Face (LIST): { list: { v: 1, serial, issued, models: [models.json entries, each with tools,
// minGlaze and version] }, sig }, sig Ed25519 over utf8('glaze-models-1|' + canon(list)) by the key whose public half is
// KEY (tools/vendor/model-manifest.js --sign; the owner approves every publish). A list counts only if it verifies, its
// serial is above the one held, and every entry is in the schema; entries for a newer Glaze (minGlaze) or a higher tools
// level than this harness runs (TOOLS) are skipped. A newer version of a model keeps its id (ai/local/store.js compose).
// The worker (check): only while this browser holds a downloaded Rime model and the student hasn't turned Update
// automatically off, once a day (alarm DAILY) and a few minutes after the browser starts (START, jittered; skipped when a
// check ran within the day unless a download waits to resume), never with Data Saver on. It fetches the list without
// credentials and, when there is something to do, hands it to the engine host (op 'update', ai/local/host.js), which
// verifies it again and runs update(): the newer version of the model in use downloads beside it through the store (Range
// resume, per-chunk and whole-file hashes, the quota checked first), waiting while the model runs; once verified, the swap
// waits for the model to be idle and lets the engine go. The old version stays until the new one has answered once
// (confirm); if the new one fails to load or run, the old one comes back (rollback) and that version isn't tried again
// until a newer serial. Nothing about the student is sent: the list's address is the same for everyone.
// Classic script for the worker and the host's Worker; node exports.
var GZ_AI_MODEL_UPDATES = globalThis.GZ_AI_MODEL_UPDATES || (() => {
  const ST = () => (typeof GZ_AI_STORE !== 'undefined' ? GZ_AI_STORE : require('./store.js'));
  // Frostdev's model-list key: Ed25519, the raw 32 bytes in base64url. Its private half is kept offline by the owner.
  const KEY = 'N2WP4OT7JbmkRgTKDENS93d0tK4xa9cDvafP6DaXIgk';
  const LIST = 'https://huggingface.co/frostdev-ops/Rime-1.7B-GGUF/resolve/main/glaze-models.json';
  // The highest agent-tools level this harness runs (providers/local.js levelOf; ai/ask.js offers Rime's own tools at 3).
  const TOOLS = 3;
  const DAILY = 'gz-models:daily', START = 'gz-models:start', KEPT = 'aiModelUpdates';
  const DAY = 864e5, RECENT = 20 * 36e5, CAP = 1 << 20, TIMEOUT = 30000, MAX = 32;
  const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, VERSION = /^\d{1,4}(\.\d{1,4}){0,3}$/, TAG = /^[\w.-]{1,24}$/;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const fail = (reason, message) => Object.assign(new Error(message || reason), { reason });

  // JSON with object keys sorted by code unit and no spaces: the bytes both sides sign and check.
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
      : JSON.stringify(v));
  const unb64 = (s) => {
    if (typeof s !== 'string' || !/^[\w-]+$/.test(s)) throw new Error('bad');
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  };
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  // KEY's SHA-256: which key a build trusts (the publish steps print it).
  const fingerprint = async () => hex(await globalThis.crypto.subtle.digest('SHA-256', unb64(KEY)));

  // Dotted versions, numerically; a missing part is 0.
  const compare = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return Math.sign(d); }
    return 0;
  };

  const FIELDS = ['id', 'name', 'repo', 'commit', 'file', 'url', 'size', 'chunk', 'sha256', 'total', 'license', 'quant', 'tier', 'tools', 'minGlaze', 'version', 'stock'];
  // A list entry: a models.json text model (store.js valid, a tier, no role) with its tools level, minGlaze and version.
  const entry = (m) => isObj(m) && ST().valid(m) && m.role === undefined && m.projector === undefined
    && Number.isSafeInteger(m.tier) && m.tier >= 1 && m.tier <= 9 && Number.isSafeInteger(m.tools) && m.tools >= 1 && m.tools <= 9
    && typeof m.minGlaze === 'string' && VERSION.test(m.minGlaze) && typeof m.version === 'string' && TAG.test(m.version)
    && typeof m.name === 'string' && m.name.length >= 1 && m.name.length <= 80
    && (m.license === undefined || (typeof m.license === 'string' && m.license.length <= 40)) && (m.quant === undefined || (typeof m.quant === 'string' && m.quant.length <= 16))
    && (m.stock === undefined || typeof m.stock === 'boolean');
  // The list as it will be used, or null: version 1, a serial from 1, an issue date, 1 to MAX entries, ids and tiers once each.
  const clean = (l) => {
    if (!isObj(l) || l.v !== 1 || !Number.isSafeInteger(l.serial) || l.serial < 1 || typeof l.issued !== 'string' || !TIME.test(l.issued)) return null;
    if (!Array.isArray(l.models) || !l.models.length || l.models.length > MAX || !l.models.every(entry)) return null;
    if (new Set(l.models.map((m) => m.id)).size !== l.models.length || new Set(l.models.map((m) => m.tier)).size !== l.models.length) return null;
    const pick = (m) => Object.fromEntries(FIELDS.filter((k) => m[k] !== undefined).map((k) => [k, k === 'sha256' ? [...m[k]] : m[k]]));
    return { v: 1, serial: l.serial, issued: l.issued, models: l.models.map(pick) };
  };

  // A fetched document, checked: { ok: true, list } or { ok: false, error } with error 'shape', 'key' (no Ed25519 here, or
  // an unusable key), 'signature' or 'replay' (a serial at or below `serial`, the one held). `key` is for tests.
  const verify = async (doc, { key = KEY, serial = 0 } = {}) => {
    const list = isObj(doc) ? clean(doc.list) : null;
    if (!list || typeof doc.sig !== 'string' || !/^[\w-]{86}$/.test(doc.sig)) return { ok: false, error: 'shape' };
    const S = globalThis.crypto?.subtle;
    let sig, vk;
    try { sig = unb64(doc.sig); vk = await S.importKey('raw', unb64(key), { name: 'Ed25519' }, false, ['verify']); } catch { return { ok: false, error: 'key' }; }
    if (!await S.verify({ name: 'Ed25519' }, vk, sig, new TextEncoder().encode(`glaze-models-1|${canon(doc.list)}`)).catch(() => false)) return { ok: false, error: 'signature' };
    if (list.serial <= serial) return { ok: false, error: 'replay' };
    return { ok: true, list };
  };
  // The entries this Glaze can run.
  const usable = (list, { glaze, tools = TOOLS }) => list.models.filter((m) => compare(m.minGlaze, glaze) <= 0 && m.tools <= tools);

  // ---- the state (ai/local/store.js's state file) ---------------------------------------------------------------------
  const base = (st) => ({ v: 1, serial: 0, issued: null, models: [], pins: {}, keep: {}, trial: null, failed: {}, ...(isObj(st) ? st : {}) });
  // A newer list: its usable entries; each downloaded model (ready, the versions in use) stays on its version until a swap.
  // The owner published again, so what failed before may be tried again.
  const accept = (st, list, { glaze, ready = [] }) => {
    const s = base(st), pins = { ...s.pins };
    for (const m of ready) if (!pins[m.id]) pins[m.id] = m;
    return { ...s, serial: list.serial, issued: list.issued, models: usable(list, { glaze }), pins, failed: {} };
  };
  // A download of `m` beside the version in use; an older version that was downloading is no longer kept.
  const begin = (st, m) => { const s = base(st); return { ...s, keep: { ...s.keep, [m.id]: [m] } }; };
  const swap = (st, id, next, cur) => { const s = base(st); return { ...s, pins: { ...s.pins, [id]: next }, keep: { ...s.keep, [id]: [cur] }, trial: { id, from: cur.total, to: next.total } }; };
  const confirm = (st) => { const s = base(st), { [s.trial?.id]: _, ...keep } = s.keep; return { ...s, keep, trial: null }; };
  const rollback = (st) => {
    const s = base(st), t = s.trial, prior = (s.keep[t?.id] || []).find((m) => m.total === t.from);
    if (!t || !prior) return { ...s, trial: null };
    const { [t.id]: _, ...keep } = s.keep;
    return { ...s, pins: { ...s.pins, [t.id]: prior }, keep, trial: null, failed: { ...s.failed, [t.to]: s.serial } };
  };
  // A version that failed its hashes: not kept, not tried again until a newer serial.
  const reject = (st, m) => { const s = base(st), { [m.id]: _, ...keep } = s.keep; return { ...s, keep, failed: { ...s.failed, [m.total]: s.serial } }; };

  // ---- the host's side (ai/local/host.js 'update' and its runs) -------------------------------------------------------
  // An error a model of its own causes: it won't load (assets, engine) or the engine failed without a category of its own.
  const fault = (e) => (e?.category === 'provider-unavailable' ? ['assets', 'engine'].includes(e.reason) : !e?.category && !e?.code && e?.name !== 'AbortError');
  // ctx: { store, idle(signal) (resolves when nothing runs; throws to stop), between(fn) (fn at the next idle moment, then the
  // engine let go), progress(loaded), key? }. m: { doc, id, glaze }. → { state, reason?, version? }.
  const update = async (ctx, m, signal) => {
    const { store } = ctx;
    if (typeof m?.id !== 'string' || typeof m.glaze !== 'string' || !VERSION.test(m.glaze)) return { state: 'refused', reason: 'request' };
    const held = (await store.catalog()).state;
    const r = await verify(m.doc, { key: ctx.key, serial: held?.serial || 0 });
    if (r.ok) {
      const cat = await store.catalog(), ready = (await store.list()).filter((x) => !x.role && x.state === 'ready').map((x) => cat.entries.get(x.id)).filter(Boolean);
      await store.edit((st) => (signal?.aborted || (st?.serial || 0) >= r.list.serial ? undefined : accept(st, r.list, { glaze: m.glaze, ready })));
    } else if (r.error !== 'replay') return { state: 'refused', reason: r.error };
    const cat = await store.catalog(), st = cat.state, cur = cat.entries.get(m.id), next = cat.latest.get(m.id);
    if (!cur || (await store.status(m.id)).state !== 'ready') return { state: 'none' };
    if (st?.trial) return { state: 'trial' };
    if (!next || next.total === cur.total) {
      let obsolete = [];
      if (cat.spares.has(m.id)) await store.edit((s) => {
        if (signal?.aborted || s?.trial || s?.serial !== st?.serial) return undefined;
        obsolete = s.keep?.[m.id] || [];
        const { [m.id]: _, ...keep } = s.keep || {};
        return { ...s, keep };
      });
      for (const x of obsolete) await store.drop(m.id, x.total).catch(() => {});
      return { state: 'current', ...(cur.version && { version: cur.version }) };
    }
    const begun = await store.edit((s) => (signal?.aborted || s?.trial || s?.serial !== st?.serial || s.pins?.[m.id]?.total !== cur.total
      || s.keep?.[m.id]?.some((x) => x.total === next.total) ? undefined : begin(s, next)));
    if (begun?.trial) return { state: 'trial' };
    try {
      await store.download(m.id, { total: next.total, whole: true, signal, pause: ctx.idle, onProgress: ctx.progress });
    } catch (e) {
      if (e?.reason === 'hash' && !signal?.aborted) { await store.edit((s) => signal?.aborted ? undefined : reject(s, next)); await store.drop(m.id, next.total).catch(() => {}); return { state: 'failed', reason: 'hash' }; }
      return { state: 'download', reason: typeof e?.reason === 'string' ? e.reason : 'network' };
    }
    let swapped = false;
    await ctx.between(async () => {
      if (signal?.aborted) return;
      await store.edit((s) => {
        if (signal?.aborted || s?.trial || s?.serial !== st?.serial || !s?.keep?.[m.id]?.some((x) => x.total === next.total) || s.pins?.[m.id]?.total !== cur.total) return undefined; // removed meanwhile
        swapped = true;
        return swap(s, m.id, next, cur);
      });
    });
    return swapped ? { state: 'swapped', ...(next.version && { version: next.version }) } : { state: 'download', reason: 'removed' };
  };
  // The trial's end, after its first good run: the old version goes. Or its failure: the old one comes back, the new goes.
  const settle = async (store, good) => {
    let t = null;
    await store.edit((s) => { t = s?.trial || null; return t ? (good ? confirm(s) : rollback(s)) : undefined; });
    if (t) await store.drop(t.id, good ? t.from : t.to).catch(() => {});
    return t;
  };

  // ---- the worker's side -----------------------------------------------------------------------------------------------
  // Whether a check may have anything to do, from the store's marks alone (store.js ~rime, ~none): a folder of models from
  // before the marks counts, so its first check runs and its list sets them. Loads and reads nothing else.
  const present = async (root = () => navigator.storage.getDirectory()) => {
    let top;
    try { top = await (await root()).getDirectoryHandle('glaze-models'); } catch { return false; }
    try { await top.getFileHandle('~rime'); return true; } catch { /* not marked */ }
    try { await top.getFileHandle('~none'); return false; } catch { /* not marked */ }
    for await (const k of top.keys()) if (!k.startsWith('~')) return true;
    return false;
  };
  let job = null; // the update running: { controller, version, progress }
  let checking = null;
  const stop = () => { checking?.abort(Object.assign(new Error('Update automatically is off'), { reason: 'stopped' })); };
  // The Rime model in use: the downloaded one with Advanced's tier, else the first downloaded.
  const inUse = (list, tier) => {
    const text = list.filter((m) => !m.role && !m.stock && m.state === 'ready');
    return (tier && text.find((m) => m.tier === tier)) || text[0] || null;
  };
  const say = (env, m) => { try { env.say?.({ type: 'glaze:ai-config', event: 'progress', provider: 'local', part: 'update', ...m }); } catch { /* no page listening */ } };
  // The list, fetched as the weights are: no cookies, no cache, the final host Hugging Face's, at most CAP bytes.
  const fetchList = async (env, signal) => {
    const t = new AbortController(), timer = setTimeout(() => t.abort(), TIMEOUT);
    const stop = () => t.abort(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    try {
      const r = await env.fetch(LIST, { credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', mode: 'cors', signal: t.signal });
      if (!r.ok || (r.url && !ST().allowedHost(r.url))) { await r.body?.cancel().catch(() => {}); return null; }
      const reader = r.body?.getReader();
      if (!reader) return null;
      const decoder = new TextDecoder();
      let bytes = 0, text = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > CAP || t.signal.aborted) return null;
          text += decoder.decode(value, { stream: true });
        }
        return t.signal.aborted ? null : JSON.parse(text + decoder.decode());
      } finally { await reader.cancel().catch(() => {}); }
    } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
  };
  // env: { store, settings(), tier(), fetch, host(op, args, { signal, onEvent }), local (storage area), now(), glaze, saveData(),
  // say(message), safari, key? }. reason: 'daily' | 'start' | 'now'. → { state, reason?, version? }.
  let running = null;
  const check = (env, { reason = 'daily' } = {}) => (running ||= (async () => {
    const controller = new AbortController();
    checking = controller;
    if (env.safari) return { state: 'off' };
    if ((await env.settings())?.updates === false) return { state: 'off' };
    const list = await env.store.list();
    const slot = inUse(list, await env.tier());
    if (!slot) return { state: 'none' };
    if (env.saveData?.()) return { state: 'paused', reason: 'saveData' };
    const kept = (await env.local.get(KEPT))?.[KEPT] || {}, now = env.now();
    const cat = await env.store.catalog(), st = cat.state, pending = !!st && !st.trial && Object.keys(st.keep || {}).length > 0;
    if (reason === 'start' && Number.isFinite(kept.checked) && now - kept.checked < RECENT && !pending) return { state: 'recent' };
    const note = (o) => env.local.set({ [KEPT]: { ...kept, checked: now, ...o } }).catch?.(() => {});
    let doc;
    if (controller.signal.aborted) return { state: 'stopped' };
    try { doc = await fetchList(env, controller.signal); } catch { doc = null; }
    if (controller.signal.aborted) return { state: 'stopped' };
    if (!doc) { await note({ result: 'offline' }); return { state: 'offline' }; }
    const r = await verify(doc, { key: env.key, serial: st?.serial || 0 });
    if (!r.ok && r.error !== 'replay') { await note({ result: r.error }); return { state: 'refused', reason: r.error }; }
    if (!r.ok && !pending && cat.latest.get(slot.id)?.total === cat.entries.get(slot.id)?.total) { await note({ result: 'current' }); return { state: 'current' }; }
    if ((await env.settings())?.updates === false) return { state: 'off' };
    if (!(await env.store.list()).some((m) => m.id === slot.id && m.state === 'ready')) return { state: 'none' };
    if (env.saveData?.()) return { state: 'paused', reason: 'saveData' };
    if (controller.signal.aborted) return { state: 'stopped' };
    const target = (r.ok ? r.list.models : st?.models || []).find((m) => m.id === slot.id) || cat.latest.get(slot.id);
    job = { controller, version: target?.version || null, progress: 0 };
    try {
      const out = await env.host('update', { doc, model: slot.id, glaze: env.glaze }, { signal: controller.signal, onEvent: (e) => {
        if (e?.type !== 'progress' || !Number.isFinite(e.loaded)) return;
        job.progress = Math.min(1, Math.max(0, e.loaded));
        say(env, { loaded: job.progress, ...(job.version && { version: job.version }) });
      } });
      const res = isObj(out) && typeof out.state === 'string' ? out : { state: 'failed' };
      await note({ result: res.state });
      return res;
    } catch (e) {
      if (controller.signal.aborted) return { state: 'stopped' };
      await note({ result: 'host' });
      return { state: 'failed', reason: typeof e?.reason === 'string' ? e.reason : 'host' };
    } finally {
      job = null;
      say(env, { done: true });
    }
  })().finally(() => { running = null; checking = null; }));

  // The daily alarm, made once (its time kept); at browser start, a check 2 to 10 minutes later.
  const schedule = async ({ alarms, random = Math.random }, { startup = false } = {}) => {
    if (!alarms) return;
    if (!await Promise.resolve(alarms.get(DAILY)).catch(() => null)) alarms.create(DAILY, { delayInMinutes: 60 + Math.round(random() * 120), periodInMinutes: DAY / 60000 });
    if (startup) alarms.create(START, { delayInMinutes: 2 + random() * 8 });
  };
  const alarm = (env, a) => (a?.name === DAILY ? check(env, { reason: 'daily' }) : a?.name === START ? check(env, { reason: 'start' }) : null);

  // For Settings' card: { auto, version?, update?: { version, progress } }.
  const about = async (env) => {
    const s = await env.settings();
    let slot = null;
    try { slot = inUse(await env.store.list(), await env.tier()); } catch { /* none */ }
    return { auto: s?.updates !== false, ...(slot?.version && { version: slot.version }), ...(job && { update: { version: job.version, progress: job.progress } }) };
  };

  return { KEY, URL: LIST, TOOLS, DAILY, START, KEPT, canon, fingerprint, compare, clean, verify, usable, accept, begin, swap, confirm, rollback, reject, fault, update, settle,
    check, schedule, alarm, about, stop, inUse, present };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_MODEL_UPDATES; else GZ_AI_MODEL_UPDATES;
