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
  const FEATURES = ['syllabus'];
  // The providers a connection may use, as Glaze ships them (the mock is for tests and the eval only). apple is added on
  // Safari only, so elsewhere a connection to it is refused.
  const PROVIDERS = ['openai', 'apple'];
  const CONNECTION = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const DEFAULTS = Object.freeze({ on: false, use: null, features: Object.freeze(Object.fromEntries(FEATURES.map((f) => [f, false]))) });
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const clean = (raw) => {
    const r = isObj(raw) ? raw : {}, f = isObj(r.features) ? r.features : {};
    return { on: r.on === true, use: typeof r.use === 'string' && CONNECTION.test(r.use) ? r.use : null, features: Object.fromEntries(FEATURES.map((k) => [k, f[k] === true])) };
  };
  // Whether `feature` may ask now: AI on, a connection chosen, the feature allowed.
  const allowed = (s, feature) => s.on === true && !!s.use && s.features?.[feature] === true;
  return { KEY, FEATURES, PROVIDERS, CONNECTION, DEFAULTS, clean, allowed };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_SETTINGS; else GZ_AI_SETTINGS;
