// The AI harness's settings (docs/ai-harness.md): storage.local `ai` = { on, use, features: { <feature>: true } }. Off by
// default, on this device only: a connection (an endpoint and its key, a model on this computer) is this device's, so the
// switches that send text to it are too. They are never synced, never in a Back up file or a shared Look. on: AI may run at
// all; use: the connection it runs on (an id, lib/ai/endpoint.js ID); features: which of Glaze's features may ask
// (FEATURES). The connections themselves are in the worker's own store (lib/ai/broker.js vault), never here: any page's
// script can read storage.local. Not in defaults.js, which every page's first script loads. clean() gives what is stored
// with anything that doesn't fit at its default, as GZ_SANITIZE does. Classic script for the worker and Settings; node exports.
var GZ_AI_SETTINGS = globalThis.GZ_AI_SETTINGS || (() => {
  const KEY = 'ai';
  // Features that may ask, each off until the student allows it. A feature's id is the one its port messages carry.
  // completion: the writer's ghost text; writing: its review, feedback, requirements, citations and autocorrect calls.
  const FEATURES = ['syllabus', 'completion', 'writing'];
  // The providers a connection may use, as Glaze ships them (the mock is for tests and the eval only).
  const safari = (() => { try { return new URL((typeof globalThis.browser?.runtime?.getURL === 'function' ? globalThis.browser.runtime : globalThis.chrome?.runtime).getURL('')).protocol === 'safari-web-extension:'; } catch { return false; } })();
  const PROVIDERS = ['openai', 'device', ...(safari ? ['apple'] : [])];
  const CONNECTION = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const DEFAULTS = Object.freeze({ on: false, use: null, features: Object.freeze(Object.fromEntries(FEATURES.map((f) => [f, false]))) });
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const clean = (raw) => {
    const r = isObj(raw) ? raw : {}, f = isObj(r.features) ? r.features : {};
    // Apple Intelligence was its own choice; it is On this device now (lib/ai/broker.js onDevice).
    const use = r.use === 'apple' ? 'device' : r.use;
    return { on: r.on === true, use: typeof use === 'string' && CONNECTION.test(use) ? use : null, features: Object.fromEntries(FEATURES.map((k) => [k, f[k] === true])) };
  };
  // Whether `feature` may ask now: AI on, a connection chosen, the feature allowed.
  const allowed = (s, feature) => s.on === true && !!s.use && s.features?.[feature] === true;
  return { KEY, FEATURES, PROVIDERS, CONNECTION, DEFAULTS, clean, allowed };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_SETTINGS; else GZ_AI_SETTINGS;
