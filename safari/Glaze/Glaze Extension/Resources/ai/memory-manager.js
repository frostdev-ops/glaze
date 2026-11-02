// Memory controls shared by Settings and Ask's receipt cards. The worker supplies authority: Settings may manage all
// locally stored accounts even after logout; a school page receives only its freshly verified account. Message fields
// cannot select an account or grant Settings authority. No model is involved in edits, export or deletion.
var GZ_MEMORY_MANAGER = globalThis.GZ_MEMORY_MANAGER || (() => {
  const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const id = (v) => typeof v === 'string' && /^[ms]-[0-9a-f]{32}$/.test(v);
  const revision = (v) => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
  const kind = (v) => ['memory', 'course'].includes(v);
  const fail = (error) => ({ ok: false, error });
  const FIELDS = { state: [], settings: ['enabled'], list: ['kind'], read: ['id'], update: ['id', 'revision', 'markdown'], forget: ['id', 'revision'], clear: ['kind', 'records'], export: [] };
  const valid = (m) => {
    if (!obj(m) || m.type !== 'glaze:memory' || !Object.hasOwn(FIELDS, m.op)
      || Object.keys(m).some((k) => !['type', 'op', ...FIELDS[m.op]].includes(k)) || FIELDS[m.op].some((k) => !Object.hasOwn(m, k))) return false;
    if (m.op === 'settings') return typeof m.enabled === 'boolean';
    if (m.op === 'list') return kind(m.kind);
    if (m.op === 'read') return id(m.id);
    if (m.op === 'update') return id(m.id) && m.id[0] === 'm' && revision(m.revision) && typeof m.markdown === 'string' && !!m.markdown.trim() && m.markdown.length <= 600;
    if (m.op === 'forget') return id(m.id) && revision(m.revision);
    if (m.op === 'clear') return kind(m.kind) && Array.isArray(m.records) && m.records.length <= 5000
      && m.records.every((r) => obj(r) && Object.keys(r).sort().join() === 'id,revision' && id(r.id) && revision(r.revision)
        && r.id[0] === (m.kind === 'memory' ? 'm' : 's'));
    return true;
  };
  const run = async (message, env) => {
    if (!valid(message)) return fail('request');
    const m = structuredClone(message), all = env?.all === true, account = env?.account;
    if (!all && (typeof account !== 'string' || typeof env.valid !== 'function')) return fail('scope');
    if (['state', 'settings', 'export'].includes(m.op) && !all) return fail('scope');
    const authorized = async () => { try { return all || await env.valid() === true; } catch { return false; } };
    try {
      if (!await authorized()) return fail('scope');
      const result = await (async () => {
        if (m.op === 'state') return { ok: true, enabled: await env.state() === true };
        if (m.op === 'settings') {
          if (await env.setEnabled(m.enabled) !== true) return fail('write');
          await env.store.invalidate();
          return { ok: true, enabled: await env.state() === true };
        }
        if (m.op === 'list' || m.op === 'export') {
          const options = { kind: m.op === 'export' ? 'memory' : m.kind };
          const out = all ? await env.store.listAll(options) : await env.store.list(account, options);
          if (!out?.ok) return out || fail('write');
          if (m.op === 'list') return { ok: true, records: out.items };
          const groups = new Map();
          for (const r of out.items) { if (!groups.has(r.account)) groups.set(r.account, []); groups.get(r.account).push(r.markdown); }
          return { ok: true, markdown: '# Memories\n\n' + [...groups].map(([owner, text]) => `## ${owner}\n\n${text.join('\n\n---\n\n')}`).join('\n\n') + '\n' };
        }
        if (m.op === 'clear') {
          const options = { kind: m.kind, snapshot: m.records, ...(!all && { guard: authorized }) };
          return all ? await env.store.clearAll(options) : await env.store.clear(account, options);
        }
        // Resolve in the trusted namespace. Never return another account's matching record or its conflict body to a page.
        const found = all ? await env.store.resolveById(m.id) : await env.store.list(account);
        if (!found?.ok) return found || fail('write');
        const record = all ? found.record : found.items.find((r) => r.id === m.id);
        if (!record) return fail('not-found');
        if (m.op === 'read') return { ok: true, record };
        const options = all ? {} : { guard: authorized };
        if (m.op === 'update') return env.store.edit(record.account, { id: m.id, revision: m.revision, markdown: m.markdown }, options);
        return env.store.forget(record.account, { id: m.id, revision: m.revision }, options);
      })();
      return await authorized() ? result : fail('scope');
    } catch { return fail('write'); }
  };
  return { run, valid };
})();
if (typeof module !== 'undefined') module.exports = GZ_MEMORY_MANAGER; else GZ_MEMORY_MANAGER;
