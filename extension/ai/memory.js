// Ask Rime's canonical Markdown records. Saved memories may sync; course readings stay on this device. Authority and
// fresh LMS identity belong to the caller, never to stored text. Every live mutation, including Drive and restore, uses
// this module's own queue (inside brokerTurn where needed), never a callback into the generic worker queue.
var GZ_MEMORY = globalThis.GZ_MEMORY || (() => {
  const LIMIT = Object.freeze({ memory: 600, evidence: 300, course: 20000, memories: 500, courses: 250, bytes: 2 << 20, records: 5000, page: 1200, hits: 5, query: 240 });
  const HEX = /^[a-f0-9]{32}$/, ID = /^[ms]-[a-f0-9]{32}$/, UID = /^(?:\d{1,20}|_\d{1,20}_\d{1,20})$/;
  const TOOLS = new Set(['assignment_read', 'announcement_read', 'content_read', 'syllabus_read', 'discussion_read']);
  const BAD_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  const encoder = new TextEncoder(), generations = { all: 0, accounts: new Map() }, leases = new WeakMap();
  let tail = Promise.resolve();
  const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  const only = (v, allowed, required = []) => object(v) && Reflect.ownKeys(v).every((k) => allowed.includes(k)) && required.every((k) => Object.hasOwn(v, k));
  const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !!v.trim() && !BAD_TEXT.test(v);
  const time = (v) => Number.isSafeInteger(v) && v >= 0;
  const fail = (error, extra) => ({ ok: false, error, ...extra });
  const accountOf = (value) => {
    if (typeof value !== 'string' || value.length > 300) return null;
    const at = value.lastIndexOf('/'), origin = value.slice(0, at), uid = value.slice(at + 1);
    try { const u = new URL(origin); if (!/^https?:$/.test(u.protocol) || u.origin !== origin || !UID.test(uid)) return null; } catch { return null; }
    return { account: value, origin, uid };
  };
  const kindOf = (id) => typeof id === 'string' && ID.test(id) ? (id[0] === 'm' ? 'memory' : 'course') : null;
  const keyOf = (account, id) => accountOf(account) && kindOf(id) ? `${id[0] === 'm' ? 'rimeMemory:' : 'rimeMaterial:'}${account}|${id}` : null;
  const parseKey = (key) => {
    if (typeof key !== 'string') return null;
    const prefix = key.startsWith('rimeMemory:') ? 'rimeMemory:' : key.startsWith('rimeMaterial:') ? 'rimeMaterial:' : null;
    if (!prefix) return null;
    const at = key.lastIndexOf('|'), account = key.slice(prefix.length, at), id = key.slice(at + 1);
    return keyOf(account, id) === key ? { account, id, kind: kindOf(id) } : null;
  };
  const sourceOf = (raw, kind, account) => {
    if (kind === 'memory') return only(raw, ['type', 'evidence'], ['type', 'evidence']) && raw.type === 'user-message' && str(raw.evidence, LIMIT.evidence)
      ? { type: raw.type, evidence: raw.evidence } : null;
    if (!only(raw, ['type', 'tool', 'course', 'id', 'page', 'observedAt', 'complete', 'title'], ['type', 'tool', 'course', 'observedAt', 'complete'])
      || raw.type !== 'course-read' || !TOOLS.has(raw.tool) || typeof raw.course !== 'string'
      || !(accountOf(account).uid[0] === '_' ? /^_\d{1,20}_\d{1,20}$/ : /^\d{1,20}$/).test(raw.course)
      || !time(raw.observedAt) || typeof raw.complete !== 'boolean'
      || (raw.id !== undefined && (typeof raw.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(raw.id)))
      || (raw.page !== undefined && (!Number.isSafeInteger(raw.page) || raw.page < 1 || raw.page > 1000))
      || (raw.title !== undefined && !str(raw.title, 240))) return null;
    return { type: raw.type, tool: raw.tool, course: raw.course, ...(raw.id !== undefined && { id: raw.id }), ...(raw.page !== undefined && { page: raw.page }), observedAt: raw.observedAt, complete: raw.complete, ...(raw.title !== undefined && { title: raw.title }) };
  };
  // New objects in a fixed property order give tie-breaking, backup and CAS the same canonical representation.
  const clean = (raw, key) => {
    if (!only(raw, ['v', 'id', 'account', 'kind', 'markdown', 'createdAt', 'updatedAt', 'revision', 'edited', 'category', 'source', 'deleted'], ['v', 'id', 'account', 'kind', 'createdAt', 'updatedAt', 'revision'])
      || raw.v !== 1 || !accountOf(raw.account) || !['memory', 'course'].includes(raw.kind) || kindOf(raw.id) !== raw.kind || !time(raw.createdAt) || !time(raw.updatedAt) || raw.updatedAt < raw.createdAt || typeof raw.revision !== 'string' || !HEX.test(raw.revision)
      || (key !== undefined && keyOf(raw.account, raw.id) !== key)) return null;
    const base = { v: 1, id: raw.id, account: raw.account, kind: raw.kind, createdAt: raw.createdAt, updatedAt: raw.updatedAt, revision: raw.revision };
    if (Object.hasOwn(raw, 'deleted')) {
      if (raw.deleted !== true || ['markdown', 'source', 'edited', 'category'].some((k) => Object.hasOwn(raw, k))) return null;
      return { ...base, deleted: true };
    }
    if (!str(raw.markdown, LIMIT[raw.kind]) || (Object.hasOwn(raw, 'edited') && raw.edited !== true)
      || (Object.hasOwn(raw, 'category') && (raw.kind !== 'memory' || !['fact', 'preference'].includes(raw.category)))) return null;
    const source = sourceOf(raw.source, raw.kind, raw.account);
    if (!source) return null;
    return { v: 1, id: raw.id, account: raw.account, kind: raw.kind, markdown: raw.markdown, createdAt: raw.createdAt, updatedAt: raw.updatedAt, revision: raw.revision,
      ...(raw.edited === true && { edited: true }), ...(Object.hasOwn(raw, 'category') && { category: raw.category }), source };
  };
  const canonical = (v) => JSON.stringify(v);
  const equal = (a, b) => canonical(a) === canonical(b);
  const merge = (a, b, key) => {
    const x = a == null ? null : clean(a, key), y = b == null ? null : clean(b, key);
    if ((a != null && !x) || (b != null && !y) || (x && y && keyOf(x.account, x.id) !== keyOf(y.account, y.id))) return null;
    if (!x || !y) return x || y;
    if (!!x.deleted !== !!y.deleted) return x.deleted ? x : y;
    return x.updatedAt > y.updatedAt || (x.updatedAt === y.updatedAt && canonical(x) >= canonical(y)) ? x : y;
  };
  const fits = (values, kind) => {
    if (kind !== undefined && !['memory', 'course'].includes(kind)) return false;
    if (!Array.isArray(values) && !object(values)) return false;
    const rows = Array.isArray(values) ? values.map((v) => [undefined, v]) : Object.entries(values), groups = new Map();
    for (const [key, raw] of rows) {
      const r = clean(raw, key);
      if (!r) return false;
      if (kind && r.kind !== kind) continue;
      const group = `${r.account}|${r.kind}`, n = groups.get(group) || { records: 0, active: 0, bytes: 0 };
      n.records++;
      if (!r.deleted) { n.active++; n.bytes += encoder.encode(canonical(r)).length; }
      if (n.records > LIMIT.records || n.active > LIMIT[r.kind === 'memory' ? 'memories' : 'courses'] || n.bytes > LIMIT.bytes) return false;
      groups.set(group, n);
    }
    return true;
  };
  // One queue for this module, independent of wrapper identity and brokerTurn. Work inside queued must not reenter it.
  const queued = (_env, work) => {
    const result = tail.then(work); tail = result.catch(() => {}); return result;
  };
  const epoch = (_local) => generations;
  const invalidateNow = (local, account) => { const e = epoch(local); if (account === undefined) e.all++; else e.accounts.set(account, (e.accounts.get(account) || 0) + 1); };
  // Restore calls this after publishing while it already holds queued(). It changes no data and must not reenter the
  // queue; ordinary callers use their store's queued invalidate() instead. All adapters share these account epochs.
  const invalidateHeld = (env, account) => {
    if (!env?.local || (account !== undefined && !accountOf(account))) return false;
    invalidateNow(env.local, account); return true;
  };
  const keysOf = async (env) => typeof env.keys === 'function' ? env.keys() : typeof env.local.getKeys === 'function' ? env.local.getKeys() : Object.keys(await env.local.get(null));
  const rowsOf = async (env, account) => {
    const keys = (await keysOf(env)).filter((k) => { const p = parseKey(k); return p && (account === undefined || p.account === account); });
    if (!keys.length) return [];
    const got = await env.local.get(keys);
    return keys.map((k) => clean(got[k], k)).filter(Boolean);
  };
  const canFit = async (env, key, record) => {
    const rows = await rowsOf(env, record.account), next = rows.filter((r) => keyOf(r.account, r.id) !== key).concat(record);
    return fits(next);
  };
  // Shared merge/apply for imports; Drive's own stale-read CAS can instead use replace. Neither can revive an id.
  const apply = (env, key, value) => {
    const incoming = clean(value, key);
    if (!parseKey(key) || !incoming) return Promise.resolve(fail('scope'));
    return queued(env, async () => {
      try {
        const raw = (await env.local.get(key))[key], here = raw == null ? null : clean(raw, key), next = merge(here, incoming, key);
        if (!next || (raw != null && !here)) return fail('write');
        if (equal(here, next)) return { ok: true, record: next, changed: false };
        if (!await canFit(env, key, next)) return fail('limit');
        if (await env.local.set({ [key]: next }) === false) return fail('write');
        invalidateNow(env.local, next.account);
        return { ok: true, record: next, changed: true };
      } catch { return fail('write'); }
    });
  };
  const replace = (env, key, expected, value) => {
    const before = expected == null ? null : clean(expected, key), incoming = clean(value, key);
    if (!parseKey(key) || (expected != null && !before) || !incoming) return Promise.resolve(false);
    return queued(env, async () => {
      try {
        const raw = (await env.local.get(key))[key], here = raw == null ? null : clean(raw, key);
        if ((raw != null && !here) || !equal(here, before) || (here?.deleted && !incoming.deleted)) return false;
        const next = merge(here, incoming, key);
        if (!next || !equal(next, incoming) || !await canFit(env, key, next)) return false;
        if (!equal(here, next) && await env.local.set({ [key]: next }) === false) return false;
        if (!equal(here, next)) invalidateNow(env.local, next.account);
        return true;
      } catch { return false; }
    });
  };
  const fold = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const terms = (s) => [...new Set(fold(s).match(/[\p{L}\p{N}]+/gu) || [])];
  // Keep UTF-16 pagination from splitting a surrogate pair; a page may be one character shorter at such a boundary.
  const clip = (s, n) => s.slice(0, n > 0 && /[\uD800-\uDBFF]/.test(s[n - 1] || '') && /[\uDC00-\uDFFF]/.test(s[n] || '') ? n - 1 : n);
  const pagesOf = (s) => { const out = []; while (s) { const p = clip(s, LIMIT.page); out.push(p); s = s.slice(p.length); } return out; };
  const hitOf = (r, text, score) => ({ id: r.id, revision: r.revision, kind: r.kind, text, ...(r.category && { category: r.category }), ...(r.source && { source: r.source }), ...(score !== undefined && { score }) });
  const receipt = (operation, r) => ({ ok: true, receipt: { operation, id: r.id, revision: r.revision, at: r.updatedAt, ...(!r.deleted && { text: r.markdown }), persistence: 'device' } });
  const create = (env) => {
    const now = env.now || Date.now;
    const token = (old) => {
      for (let i = 0; i < 8; i++) {
        const t = env.random ? env.random() : Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (v) => v.toString(16).padStart(2, '0')).join('');
        if (typeof t === 'string' && HEX.test(t) && t !== old) return t;
      }
      throw Error('revision');
    };
    const lease = (account) => {
      if (!accountOf(account)) return null;
      const e = epoch(env.local), value = Object.freeze({ account });
      leases.set(value, { local: env.local, account, all: e.all, generation: e.accounts.get(account) || 0 });
      return value;
    };
    const validateLease = (account, value) => {
      const l = value && leases.get(value), e = epoch(env.local);
      return !!l && l.local === env.local && l.account === account && l.all === e.all && l.generation === (e.accounts.get(account) || 0);
    };
    const mutate = (account, options, work) => {
      if (!accountOf(account)) return Promise.resolve(fail('scope'));
      const held = options?.lease;
      return queued(env, async () => {
        if (held !== undefined && !validateLease(account, held)) return fail('scope');
        try { return await work(); } catch { return fail('write'); }
      });
    };
    const load = async (account, id) => { const key = keyOf(account, id); return key ? clean((await env.local.get(key))[key], key) : null; };
    const stamp = (old) => { const at = now(); if (!time(at)) throw Error('clock'); return Math.max(at, old ? Math.min(Number.MAX_SAFE_INTEGER, old.updatedAt + 1) : 0); };
    const commit = async (r, operation) => {
      const key = keyOf(r.account, r.id), next = clean(r, key);
      if (!next) return fail('scope');
      if (!await canFit(env, key, next)) return fail('limit');
      if (await env.local.set({ [key]: next }) === false) return fail('write');
      return receipt(operation, next);
    };
    const save = (account, raw, options = {}) => {
      if (!only(raw, ['text', 'evidence', 'id', 'revision', 'category'], ['text', 'evidence']) || !str(raw.text, LIMIT.memory)
        || !str(raw.evidence, LIMIT.evidence) || (raw.category !== undefined && !['fact', 'preference'].includes(raw.category))
        || ((raw.id === undefined) !== (raw.revision === undefined)) || (raw.id !== undefined && (kindOf(raw.id) !== 'memory' || typeof raw.revision !== 'string' || !HEX.test(raw.revision)))) return Promise.resolve(fail('scope'));
      if (typeof options.question !== 'string' || !options.question.includes(raw.evidence)) return Promise.resolve(fail('evidence'));
      const input = { ...raw }, explicit = options.explicitCorrection === true;
      return mutate(account, options, async () => {
        let old = input.id ? await load(account, input.id) : null;
        if (input.id && (!old || old.deleted)) return fail('not-found');
        if (old && (old.revision !== input.revision || (old.edited && !explicit))) return fail('conflict', { current: old });
        const markdown = input.text.trim(), category = input.category || old?.category;
        if (!old) {
          old = (await rowsOf(env, account)).find((r) => r.kind === 'memory' && !r.deleted && r.markdown === markdown && (r.category || 'fact') === (category || 'fact'));
          if (old) return receipt('unchanged', old);
        } else if (old.markdown === markdown && (old.category || 'fact') === (category || 'fact')) return receipt('unchanged', old);
        let newId = input.id;
        for (let i = 0; !newId && i < 8; i++) { const proposed = `m-${token()}`; if (!(await env.local.get(keyOf(account, proposed)))[keyOf(account, proposed)]) newId = proposed; }
        if (!newId) return fail('write');
        const at = stamp(old), r = { v: 1, id: newId, account, kind: 'memory', markdown, createdAt: old?.createdAt ?? at, updatedAt: at, revision: token(old?.revision),
          ...((old?.edited || explicit) && { edited: true }), ...(category && { category }), source: { type: 'user-message', evidence: input.evidence } };
        return commit(r, old ? 'updated' : 'created');
      });
    };
    const edit = (account, raw) => {
      if (!only(raw, ['id', 'revision', 'markdown'], ['id', 'revision', 'markdown']) || kindOf(raw.id) !== 'memory' || typeof raw.revision !== 'string' || !HEX.test(raw.revision) || !str(raw.markdown, LIMIT.memory)) return Promise.resolve(fail('scope'));
      const input = { ...raw };
      return mutate(account, null, async () => {
        const old = await load(account, input.id);
        if (!old || old.deleted) return fail('not-found');
        if (old.revision !== input.revision) return fail('conflict', { current: old });
        if (old.markdown === input.markdown.trim() && old.edited) return receipt('unchanged', old);
        const markdown = input.markdown.trim();
        const result = await commit({ ...old, markdown, updatedAt: stamp(old), revision: token(old.revision), edited: true, source: { type: 'user-message', evidence: clip(markdown, LIMIT.evidence) } }, 'updated');
        if (result.ok) invalidateNow(env.local, account);
        return result;
      });
    };
    const tombstone = (old) => ({ v: 1, id: old.id, account: old.account, kind: old.kind, createdAt: old.createdAt, updatedAt: stamp(old), revision: token(old.revision), deleted: true });
    const forget = (account, raw) => {
      if (!only(raw, ['id', 'revision'], ['id', 'revision']) || !kindOf(raw.id) || typeof raw.revision !== 'string' || !HEX.test(raw.revision)) return Promise.resolve(fail('scope'));
      const input = { id: raw.id, revision: raw.revision };
      return mutate(account, null, async () => {
        const old = await load(account, input.id);
        if (!old) return fail('not-found');
        if (old.revision !== input.revision) return fail('conflict', { current: old });
        if (old.deleted) return receipt('unchanged', old);
        const result = await commit(tombstone(old), 'forgotten');
        if (result.ok) invalidateNow(env.local, account);
        return result;
      });
    };
    const ingest = (account, raw, options = {}) => {
      if (!accountOf(account) || !only(raw, ['source', 'markdown'], ['source', 'markdown']) || !str(raw.markdown, LIMIT.course)) return Promise.resolve(fail('scope'));
      const source = sourceOf(raw.source, 'course', account), markdown = raw.markdown.trim(), held = options.lease;
      if (!source) return Promise.resolve(fail('scope'));
      return mutate(account, options, async () => {
        const bytes = encoder.encode(canonical([account, source.tool, source.course, source.id || '', source.page || 1]));
        const api = globalThis.crypto?.subtle || (typeof module !== 'undefined' ? require('node:crypto').webcrypto.subtle : null);
        if (!api) return fail('write');
        const hash = Array.from(new Uint8Array(await api.digest('SHA-256', bytes)), (v) => v.toString(16).padStart(2, '0')).join('');
        if (held !== undefined && !validateLease(account, held)) return fail('scope');
        const sourceId = `s-${hash.slice(0, 32)}`, old = await load(account, sourceId);
        if (old?.deleted) return fail('not-found');
        if (old && ((old.source.complete && !source.complete) || old.source.observedAt > source.observedAt || (old.markdown === markdown && equal(old.source, source)))) return receipt('unchanged', old);
        const at = stamp(old);
        return commit({ v: 1, id: sourceId, account, kind: 'course', markdown, createdAt: old?.createdAt ?? at, updatedAt: at, revision: token(old?.revision), source }, old ? 'updated' : 'created');
      });
    };
    const listRecords = async (account, options = {}) => {
      if ((account !== undefined && !accountOf(account)) || (options.kind !== undefined && !['memory', 'course'].includes(options.kind))) return fail('scope');
      try { return { ok: true, items: (await rowsOf(env, account)).filter((r) => (!options.kind || r.kind === options.kind) && (options.includeDeleted === true || !r.deleted)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id) || a.account.localeCompare(b.account)) }; } catch { return fail('write'); }
    };
    const read = async (account, id, { page = 1 } = {}) => {
      if (!accountOf(account) || !kindOf(id) || !Number.isSafeInteger(page) || page < 1 || page > 1000) return fail('scope');
      try { const r = await load(account, id); if (!r || r.deleted) return fail('not-found'); const pages = pagesOf(r.markdown); return page > pages.length ? fail('not-found') : { ok: true, ...hitOf(r, pages[page - 1]), page, pages: pages.length }; } catch { return fail('write'); }
    };
    const search = async (account, query, options = {}) => {
      if (!str(query, LIMIT.query) || !accountOf(account) || (options.kind !== undefined && !['memory', 'course'].includes(options.kind))) return fail('scope');
      const limit = Number.isSafeInteger(options.limit) ? Math.max(1, Math.min(LIMIT.hits, options.limit)) : LIMIT.hits;
      const maxChars = Number.isSafeInteger(options.maxChars) ? Math.max(1, Math.min(LIMIT.page, options.maxChars)) : LIMIT.page;
      const listed = await listRecords(account, options); if (!listed.ok) return listed;
      const words = terms(query), phrase = fold(query.trim()), candidates = listed.items.filter((r) => !options.course || r.kind === 'memory' || r.source.course === options.course);
      const ranked = candidates.map((r) => {
        const text = fold(r.markdown), title = new Set(terms(r.source.title || r.markdown.split('\n', 1)[0])), positions = new Map();
        for (const match of r.markdown.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)) { const word = fold(match[0]); if (!positions.has(word)) positions.set(word, match.index); }
        const matches = words.reduce((sum, w) => sum + (positions.has(w) ? 1 : 0) + (title.has(w) ? 2 : 0), 0);
        const score = matches + (matches && words.length && text.includes(phrase) ? 3 : 0);
        const anchor = Math.min(...words.filter((w) => positions.has(w)).map((w) => positions.get(w)));
        let start = Number.isFinite(anchor) ? Math.max(0, anchor - Math.floor(maxChars / 4)) : 0;
        if (start && /[\uDC00-\uDFFF]/.test(r.markdown[start]) && /[\uD800-\uDBFF]/.test(r.markdown[start - 1])) start++;
        return { r, score, text: clip(r.markdown.slice(start), maxChars) };
      }).sort((a, b) => b.score - a.score || b.r.updatedAt - a.r.updatedAt || a.r.id.localeCompare(b.r.id));
      let found = ranked.filter((r) => r.score > 0), available = found.length;
      if (options.includePreferences === true && options.kind !== 'course') {
        const preference = ranked.filter((v) => v.r.kind === 'memory' && v.r.category === 'preference').sort((a, b) => b.r.updatedAt - a.r.updatedAt || a.r.id.localeCompare(b.r.id))[0];
        if (preference) {
          available += found.includes(preference) ? 0 : 1;
          let preferences = 0;
          found = found.filter((v) => v !== preference && (v.r.category !== 'preference' || ++preferences < 2)).slice(0, limit - 1).concat(preference);
        }
      }
      return { ok: true, items: found.slice(0, limit).map((h) => hitOf(h.r, h.text, h.score)), truncated: available > Math.min(limit, found.length) };
    };
    // Forget suppresses one source id. Explicit cache clearing/site removal releases that suppression so a later fresh
    // verified read can populate the cache again. Snapshot revisions protect active reads that arrived after the UI list.
    const purgeCourses = (options = {}) => {
      if (!only(options, ['origin', 'account', 'snapshot']) || (options.account !== undefined && !accountOf(options.account))
        || (options.snapshot !== undefined && (!Array.isArray(options.snapshot) || options.snapshot.some((r) => !only(r, ['id', 'revision'], ['id', 'revision']) || kindOf(r.id) !== 'course' || typeof r.revision !== 'string' || !HEX.test(r.revision))))) return Promise.resolve(fail('scope'));
      let origin = options.origin;
      if (origin !== undefined) { try { const u = new URL(origin); if (!/^https?:$/.test(u.protocol) || u.origin !== origin) return Promise.resolve(fail('scope')); } catch { return Promise.resolve(fail('scope')); } }
      const account = options.account, snapshot = options.snapshot?.map((r) => ({ ...r }));
      if (account && origin && accountOf(account).origin !== origin) return Promise.resolve(fail('scope'));
      return queued(env, async () => {
        try {
          const rows = (await rowsOf(env, account)).filter((r) => r.kind === 'course' && (!origin || accountOf(r.account).origin === origin));
          const selected = rows.filter((r) => r.deleted), receipts = []; let conflicts = 0;
          if (snapshot) for (const ref of new Map(snapshot.map((r) => [r.id, r])).values()) {
            const matches = rows.filter((r) => !r.deleted && r.id === ref.id);
            if (matches.length === 1 && matches[0].revision === ref.revision) selected.push(matches[0]); else conflicts++;
          } else selected.push(...rows.filter((r) => !r.deleted));
          for (const r of selected) receipts.push(receipt('forgotten', tombstone(r)).receipt);
          invalidateNow(env.local, account);
          if (selected.length && (typeof env.local.remove !== 'function' || await env.local.remove(selected.map((r) => keyOf(r.account, r.id))) === false)) return fail('write');
          return { ok: true, removed: selected.length, receipts, conflicts };
        } catch { return fail('write'); }
      });
    };
    const clearRecords = (account, options = {}) => {
      if (options.kind === 'course') return purgeCourses({ ...(account !== undefined && { account }), ...(options.snapshot !== undefined && { snapshot: options.snapshot }) });
      if ((account !== undefined && !accountOf(account)) || (options.kind !== undefined && !['memory', 'course'].includes(options.kind))
        || (options.snapshot !== undefined && (!Array.isArray(options.snapshot) || options.snapshot.some((r) => !only(r, ['id', 'revision'], ['id', 'revision']) || !kindOf(r.id) || typeof r.revision !== 'string' || !HEX.test(r.revision))))) return Promise.resolve(fail('scope'));
      const snapshot = options.snapshot?.map((r) => ({ ...r })), kind = options.kind;
      return queued(env, async () => {
        try {
          const rows = (await rowsOf(env, account)).filter((r) => !r.deleted && (!kind || r.kind === kind)), selected = [], receipts = [];
          let conflicts = 0;
          if (snapshot) for (const ref of new Map(snapshot.map((r) => [r.id, r])).values()) { const matches = rows.filter((r) => r.id === ref.id); if (matches.length === 1 && matches[0].revision === ref.revision) selected.push(matches[0]); else conflicts++; }
          else selected.push(...rows);
          const patch = {};
          for (const r of selected) { const gone = tombstone(r); patch[keyOf(r.account, r.id)] = gone; receipts.push(receipt('forgotten', gone).receipt); }
          if (Object.keys(patch).length && await env.local.set(patch) === false) return fail('write');
          if (account !== undefined) invalidateNow(env.local, account); else invalidateNow(env.local);
          return { ok: true, receipts, conflicts };
        } catch { return fail('write'); }
      });
    };
    const resolveById = async (id, options = {}) => {
      if (!kindOf(id)) return fail('scope');
      const all = await listRecords(undefined, options); if (!all.ok) return all;
      const matches = all.items.filter((r) => r.id === id);
      return matches.length === 1 ? { ok: true, record: matches[0] } : fail(matches.length ? 'scope' : 'not-found');
    };
    const current = async (account, refs) => {
      if (!accountOf(account) || !Array.isArray(refs) || refs.some((r) => !object(r) || !kindOf(r.id) || typeof r.revision !== 'string' || !HEX.test(r.revision))) return false;
      try { const got = await env.local.get(refs.map((r) => keyOf(account, r.id))); return refs.every((ref) => { const r = clean(got[keyOf(account, ref.id)], keyOf(account, ref.id)); return r && !r.deleted && r.revision === ref.revision; }); } catch { return false; }
    };
    return { save, edit, forget, ingest, read, search, lease, validateLease, current, purgeCourses,
      list: (account, options) => accountOf(account) ? listRecords(account, options) : Promise.resolve(fail('scope')),
      listAll: (options) => listRecords(undefined, options), resolveById,
      clear: (account, options) => accountOf(account) ? clearRecords(account, options) : Promise.resolve(fail('scope')), clearAll: (options) => clearRecords(undefined, options),
      invalidate: (account) => account !== undefined && !accountOf(account) ? Promise.resolve(false) : queued(env, () => { invalidateNow(env.local, account); return true; }) };
  };
  return { LIMIT, keyOf, parseKey, clean, merge, fits, queued, apply, replace, invalidateHeld, create, open: create };
})();
if (typeof module !== 'undefined') module.exports = GZ_MEMORY; else GZ_MEMORY;
