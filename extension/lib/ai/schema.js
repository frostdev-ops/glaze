// The AI harness's JSON Schema (docs/ai-harness.md): the subset its tasks' outputs and its tools' arguments are written in,
// and the check every model answer goes through, whatever a provider promised. clean(schema) takes a schema only when every
// keyword is one validate() reads, so nothing a task or a tool declares is quietly ignored: type (one or a list), properties,
// required, additionalProperties (a boolean), items, enum, const, anyOf, minLength, maxLength, pattern, minimum, maximum,
// minItems, maxItems, and the words title and description. Classic script for the worker; module.exports for node.
var GZ_AI_SCHEMA = globalThis.GZ_AI_SCHEMA || (() => {
  // A plain object, from this realm or another (a message from a page, a test's): no class instance.
  const isObj = (o) => { if (!o || typeof o !== 'object' || Array.isArray(o)) return false; const p = Object.getPrototypeOf(o); return p === null || Object.getPrototypeOf(p) === null; };
  const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
  const LIMIT = { depth: 12, bytes: 64 << 10, pattern: 200, errors: 20 };
  const count = (v) => Number.isSafeInteger(v) && v >= 0;
  const text = (v, max = 2000) => typeof v === 'string' && v.length <= max;
  // keyword → whether its value is well formed (node: the schema's own clean, one level down).
  const WORDS = {
    type: (v) => (typeof v === 'string' ? TYPES.includes(v) : Array.isArray(v) && v.length > 0 && v.every((t) => TYPES.includes(t)) && new Set(v).size === v.length),
    properties: (v, node) => isObj(v) && Object.keys(v).length <= 200 && Object.values(v).every(node),
    required: (v) => Array.isArray(v) && v.every((k) => text(k, 200)) && new Set(v).size === v.length,
    additionalProperties: (v) => typeof v === 'boolean',
    items: (v, node) => node(v),
    enum: (v) => Array.isArray(v) && v.length > 0 && v.length <= 500,
    const: () => true,
    anyOf: (v, node) => Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every(node),
    minLength: count, maxLength: count, minItems: count, maxItems: count,
    minimum: Number.isFinite, maximum: Number.isFinite,
    pattern: (v) => { if (!text(v, LIMIT.pattern)) return false; try { new RegExp(v, 'u'); return true; } catch { return false; } },
    title: (v) => text(v, 200), description: (v) => text(v),
  };
  // → the schema (the same object), or null when it uses anything outside the subset, nests past LIMIT.depth, or is too big.
  const clean = (schema) => {
    let size;
    try { size = JSON.stringify(schema)?.length; } catch { return null; }
    if (!size || size > LIMIT.bytes) return null;
    const node = (s, depth = 0) => isObj(s) && depth <= LIMIT.depth && Object.entries(s).every(([k, v]) => Object.hasOwn(WORDS, k) && WORDS[k](v, (x) => node(x, depth + 1)));
    return node(schema) ? schema : null;
  };
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v === 'number' ? (Number.isFinite(v) ? 'number' : 'nan') : isObj(v) ? 'object' : typeof v);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const patterns = new Map();
  const re = (p) => { if (!patterns.has(p)) { if (patterns.size > 200) patterns.clear(); patterns.set(p, new RegExp(p, 'u')); } return patterns.get(p); };
  // → [] when `value` fits `schema`, else at most LIMIT.errors messages, each with the path it is about ($.weights[2].name).
  const validate = (value, schema) => {
    const out = [];
    const say = (path, msg) => { if (out.length < LIMIT.errors) out.push(`${path}: ${msg}`); };
    const check = (v, s, path) => {
      if (out.length >= LIMIT.errors) return;
      const k = kind(v);
      if (s.type !== undefined) {
        const want = [].concat(s.type);
        if (!want.some((t) => t === k || (t === 'number' && k === 'integer'))) return say(path, `expected ${want.join(' or ')}, got ${k}`);
      } else if (!['null', 'boolean', 'number', 'integer', 'string', 'array', 'object'].includes(k)) return say(path, `not JSON (${k})`);
      if (s.const !== undefined && !same(v, s.const)) say(path, 'not the constant');
      if (s.enum && !s.enum.some((e) => same(e, v))) say(path, 'not one of the allowed values');
      if (s.anyOf) {
        const before = out.length;
        const fits = s.anyOf.some((sub) => { const keep = out.length; check(v, sub, path); const ok = out.length === keep; out.length = keep; return ok; });
        out.length = before;
        if (!fits) say(path, 'fits none of anyOf');
      }
      if (k === 'string') {
        const n = [...v].length;
        if (s.minLength !== undefined && n < s.minLength) say(path, `shorter than ${s.minLength}`);
        if (s.maxLength !== undefined && n > s.maxLength) say(path, `longer than ${s.maxLength}`);
        if (s.pattern !== undefined && !re(s.pattern).test(v)) say(path, 'does not match its pattern');
      }
      if (k === 'number' || k === 'integer') {
        if (s.minimum !== undefined && v < s.minimum) say(path, `below ${s.minimum}`);
        if (s.maximum !== undefined && v > s.maximum) say(path, `above ${s.maximum}`);
      }
      if (k === 'array') {
        if (s.minItems !== undefined && v.length < s.minItems) say(path, `fewer than ${s.minItems} items`);
        if (s.maxItems !== undefined && v.length > s.maxItems) say(path, `more than ${s.maxItems} items`);
        if (s.items) v.forEach((x, i) => check(x, s.items, `${path}[${i}]`));
      }
      if (k === 'object') {
        for (const r of s.required || []) if (!Object.hasOwn(v, r)) say(path, `missing ${r}`);
        for (const [key, x] of Object.entries(v)) {
          if (s.properties && Object.hasOwn(s.properties, key)) check(x, s.properties[key], `${path}.${key}`);
          else if (s.additionalProperties === false) say(path, `unexpected ${key}`);
        }
      }
    };
    check(value, schema, '$');
    return out;
  };
  // Whether OpenAI-style strict structured output can take the schema as it is: an object at the root, and every object
  // closed (additionalProperties: false) with all of its properties required (an optional one is typed [x, 'null']).
  const strict = (schema) => {
    const node = (s) => {
      if (!isObj(s)) return false;
      if ([].concat(s.type || []).includes('object') || s.properties) {
        const keys = Object.keys(s.properties || {});
        if (s.additionalProperties !== false || keys.length !== (s.required || []).length || !keys.every((k) => s.required.includes(k))) return false;
        if (!Object.values(s.properties || {}).every(node)) return false;
      }
      if (s.items && !node(s.items)) return false;
      return !s.anyOf || s.anyOf.every(node);
    };
    return isObj(schema) && schema.type === 'object' && node(schema);
  };
  // A model's JSON answer, read as Rimeward's askJson (src/lib/agent/oneshot.ts, MIT) reads one: from the first { to the last
  // }, so a fence or a sentence around it is tolerated, and it must be an object. undefined otherwise.
  const parse = (t) => {
    if (typeof t !== 'string') return undefined;
    let v;
    try { v = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return undefined; }
    return isObj(v) ? v : undefined;
  };
  // Rimeward's schema helpers (src/lib/agent/tools.ts, MIT): a closed object, and typed leaves with their description.
  const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
  const str = (description) => ({ type: 'string', description });
  const num = (description) => ({ type: 'number', description });
  const bool = (description) => ({ type: 'boolean', description });
  return { LIMIT, TYPES, clean, validate, strict, parse, obj, str, num, bool, isObj };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_SCHEMA; else GZ_AI_SCHEMA;
