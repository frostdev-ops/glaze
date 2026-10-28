// The AI harness's settings (docs/ai-harness.md): storage.local `ai` = { on, mode, model, models, tune, features }. Off by
// default, on this device only: a connection (a provider's key, an endpoint's address and key, a model on this computer) is
// this device's, so the switches that send text to it are too. They are never synced, never in a Back up file or a shared
// Look. on: AI may run at all; mode: 'simple' | 'advanced' (Settings shows custom endpoints and tuning in Advanced only,
// and tuning applies only there); model: the overall model, { use (a connection's id), model (its id at that provider;
// '' on this device), effort? (EFFORTS: the student's, over a task's own) }; models: a feature's own model, in that shape
// (absent: the overall one); tune: a feature's { temperature?, maxTokens?, context?, timeoutMs?, pause? } (TUNE);
// features: which of Glaze's features may ask (FEATURES). The connections themselves are in the worker's own store
// (lib/ai/broker.js vault), never here: any page's script can read storage.local. Not in defaults.js, which every page's
// first script loads. clean() gives what is stored with anything that doesn't fit at its default, as GZ_SANITIZE does.
// Classic script for the worker and Settings; node exports.
var GZ_AI_SETTINGS = globalThis.GZ_AI_SETTINGS || (() => {
  const E = () => (typeof GZ_AI_ENDPOINT !== 'undefined' ? GZ_AI_ENDPOINT : require('./endpoint.js'));
  const KEY = 'ai';
  // Features that may ask, each off until the student allows it. A feature's id is the one its port messages carry.
  // completion: the writer's ghost text; writing: its review, feedback, requirements, citations and autocorrect calls.
  const FEATURES = ['syllabus', 'completion', 'writing'];
  // The providers a connection may use, as Glaze ships them (the mock is for tests and the eval only).
  const safari = (() => { try { return new URL((typeof globalThis.browser?.runtime?.getURL === 'function' ? globalThis.browser.runtime : globalThis.chrome?.runtime).getURL('')).protocol === 'safari-web-extension:'; } catch { return false; } })();
  const PROVIDERS = ['openai', 'device', ...(safari ? ['apple'] : [])];
  const CONNECTION = /^[a-z0-9][a-z0-9-]{0,39}$/;
  // The providers Settings offers by name, each an OpenAI-compatible Chat Completions server (lib/ai/providers/openai.js)
  // at its own address, kept under its own id with only a key: base, and keys, the page that gives one. Any other id but
  // 'device' and 'apple' is an endpoint the student added (Advanced), with its own address.
  const PRESETS = Object.freeze({
    openai: Object.freeze({ base: 'https://api.openai.com/v1', keys: 'https://platform.openai.com/settings/organization/api-keys' }),
    anthropic: Object.freeze({ base: 'https://api.anthropic.com/v1', keys: 'https://platform.claude.com/settings/keys' }),
    gemini: Object.freeze({ base: 'https://generativelanguage.googleapis.com/v1beta/openai', keys: 'https://aistudio.google.com/apikey' }),
    openrouter: Object.freeze({ base: 'https://openrouter.ai/api/v1', keys: 'https://openrouter.ai/keys' }),
    xai: Object.freeze({ base: 'https://api.x.ai/v1', keys: 'https://console.x.ai/team/default/api-keys' }),
    mistral: Object.freeze({ base: 'https://api.mistral.ai/v1', keys: 'https://console.mistral.ai/api-keys' }),
    groq: Object.freeze({ base: 'https://api.groq.com/openai/v1', keys: 'https://console.groq.com/keys' }),
    deepseek: Object.freeze({ base: 'https://api.deepseek.com', keys: 'https://platform.deepseek.com/api_keys' }),
  });
  // lib/ai/request.js EFFORTS.
  const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'];
  // A feature's tuning, each [min, max] as lib/ai/request.js and lib/ai/providers/openai.js take it; pause (ms) is the
  // gray text's before it asks (writer-ai.js), completion's only.
  const TUNE = Object.freeze({ temperature: [0, 2], maxTokens: [16, 32768], context: [1000, 2000000], timeoutMs: [1000, 300000], pause: [100, 2000] });
  const MODEL = /^[^\p{Cc}\p{Bidi_Control}]{1,200}$/u;
  const NONE = Object.freeze({ use: null, model: '' });
  const DEFAULTS = Object.freeze({ on: false, mode: 'simple', model: NONE, models: Object.freeze({}), tune: Object.freeze({}), features: Object.freeze(Object.fromEntries(FEATURES.map((f) => [f, false]))) });
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  // A selection: { use, model, effort? }; Apple Intelligence was its own choice and is On this device now (lib/ai/broker.js
  // onDevice).
  const pick = (raw) => {
    const r = isObj(raw) ? raw : {}, use = r.use === 'apple' ? 'device' : r.use;
    if (typeof use !== 'string' || !CONNECTION.test(use)) return { ...NONE };
    const model = typeof r.model === 'string' && r.model.trim() === r.model && MODEL.test(r.model) ? r.model : '';
    return { use, model, ...(EFFORTS.includes(r.effort) && { effort: r.effort }) };
  };
  const tuned = (raw, feature) => {
    const r = isObj(raw) ? raw : {};
    return Object.fromEntries(Object.entries(TUNE).filter(([k, [lo, hi]]) => (k !== 'pause' || feature === 'completion') && typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k] >= lo && r[k] <= hi
      && (k === 'temperature' || Number.isSafeInteger(r[k]))).map(([k]) => [k, r[k]]));
  };
  const clean = (raw) => {
    const r = isObj(raw) ? raw : {}, f = isObj(r.features) ? r.features : {}, own = isObj(r.models) ? r.models : {}, tune = isObj(r.tune) ? r.tune : {};
    // An older Settings kept one connection for every feature (use), its model inside it: that connection is the overall
    // model's now, its model filled in from it (migrate).
    const model = pick(Object.hasOwn(r, 'model') ? r.model : { use: r.use });
    return {
      on: r.on === true, mode: r.mode === 'advanced' ? 'advanced' : 'simple', model,
      models: Object.fromEntries(FEATURES.map((k) => [k, pick(own[k])]).filter(([, s]) => s.use)),
      tune: Object.fromEntries(FEATURES.map((k) => [k, tuned(tune[k], k)]).filter(([, t]) => Object.keys(t).length)),
      features: Object.fromEntries(FEATURES.map((k) => [k, f[k] === true])),
    };
  };
  // The model a feature runs on: its own, else the overall one; null when neither names a connection. A model on this
  // computer is its provider's own; any other connection needs a model too (chosen).
  const resolve = (s, feature) => {
    const sel = s?.models?.[feature]?.use ? s.models[feature] : s?.model;
    return sel?.use ? sel : null;
  };
  const chosen = (sel) => !!sel?.use && (!!sel.model || kind(sel.use) === 'device');
  // A feature's tuning: Advanced only.
  const tuning = (s, feature) => (s?.mode === 'advanced' && isObj(s.tune?.[feature]) ? s.tune[feature] : {});
  // Whether `feature` may ask now: AI on, the feature allowed, a model chosen for it.
  const allowed = (s, feature) => s.on === true && s.features?.[feature] === true && chosen(resolve(s, feature));
  const kind = (id) => (Object.hasOwn(PRESETS, id) ? 'preset' : id === 'device' || id === 'apple' ? 'device' : 'custom');

  // An older Settings' store: one 'endpoint' connection (an OpenAI-compatible server, its address, model and key) beside
  // 'device'. migrate(stored settings, stored connections) → { settings (clean), connections, changed: { settings,
  // connections } }: the endpoint under the preset its address is (OpenRouter's, say; else an endpoint of its own, named
  // by its host), and every connection's model moved to the selections that name it and have none. The same input always
  // gives the same answer, so the broker reads through it before it is written back (lib/ai/broker.js upgrade).
  const migrate = (raw, stored) => {
    const settings = clean(raw), all = isObj(stored) ? { ...stored } : {};
    const changed = { settings: isObj(raw) && Object.hasOwn(raw, 'use'), connections: false };
    const selections = [settings.model, ...Object.values(settings.models)];
    const old = all.endpoint;
    if (isObj(old) && old.provider === 'openai') {
      const base = E().normalize(old.base);
      let id = Object.keys(PRESETS).find((p) => E().normalize(PRESETS[p].base) === base && !all[p]);
      const custom = !id;
      for (let n = 1; !id; n++) if (!all[`custom-${n}`]) id = `custom-${n}`;
      let host = '';
      try { host = new URL(old.base).host; } catch { /* not an address */ }
      delete all.endpoint;
      all[id] = { ...old, ...(custom && host && { name: host.slice(0, 40) }) };
      for (const s of selections) if (s.use === 'endpoint') { s.use = id; changed.settings = true; }
      changed.connections = true;
    }
    for (const [id, rec] of Object.entries(all)) {
      if (!isObj(rec) || rec.provider !== 'openai' || !Object.hasOwn(rec, 'model')) continue;
      const { model, ...rest } = rec;
      for (const s of selections) if (s.use === id && !s.model && typeof model === 'string' && MODEL.test(model)) { s.model = model; changed.settings = true; }
      all[id] = rest;
      changed.connections = true;
    }
    return { settings, connections: all, changed };
  };
  return { KEY, FEATURES, PROVIDERS, CONNECTION, PRESETS, EFFORTS, TUNE, DEFAULTS, clean, resolve, chosen, tuning, allowed, kind, migrate };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_SETTINGS; else GZ_AI_SETTINGS;
