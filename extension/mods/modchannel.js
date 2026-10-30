// Mod channels: an author's signed .glazemod carried by a share session (lib/sharing.js) of its own kind, 'modchannel',
// with one entity 'm' whose 'bundle' field is the encrypted file's reference. Links, sealing and the relay are the share
// sessions' own. The relay's sealing only says the file came from whoever holds the
// channel's edit key: a bundle is taken only as lib/modbundle.js would take a file installed by hand (its own author
// signature, the pinned key, a higher version, a prompt when it asks for more, the blocklist).
// Worker only. The worker's vault keeps `modChannelOwn:<id>`, the author's session (edit key) for a mod they publish;
// `modChannel:<id>` a followed mod's last check { tried, at, seen, error, pending: { zip, hash, version } }. The followed
// read link is the mod record's own `channel`.
var GZ_MODCHANNEL = globalThis.GZ_MODCHANNEL || (() => {
  const C = typeof GZ_SHARING !== 'undefined' ? GZ_SHARING : require('./sharing.js');
  const B = () => (typeof GZ_MODBUNDLE !== 'undefined' ? GZ_MODBUNDLE : require('./modbundle.js'));
  const DAY = 864e5;
  const OWN = (id) => `modChannelOwn:${id}`, STATE = (id) => `modChannel:${id}`;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const REF = (v) => isObj(v) && /^[\w-]{22}$/.test(v.id) && /^[\w-]{43}$/.test(v.h) && Number.isSafeInteger(v.s) && v.s > 0 && v.s <= B().CAP.archive;
  C.ADAPTERS.modchannel = {
    fields: ['bundle'],
    clean: (f, v) => (f === 'bundle' && REF(v) ? { id: v.id, h: v.h, s: v.s, n: 'mod.glazemod', t: 'application/octet-stream' } : undefined),
  };
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const code = (e) => (['link', 'gone', 'empty', 'kind', 'bundle', 'unsigned', 'version'].includes(e?.code) ? e.code : 'network');
  // A session's requests carry nothing of the student's: no cookies, no referrer, no redirects.
  const client = (st, fetch) => C.session(st, { fetch: (u, i) => fetch(u, { ...i, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' }) });

  // A link someone pasted → its session (read or edit link; http only on this computer), or null.
  const parse = (text) => (typeof text === 'string' && text.length <= 600 ? C.join(text, true) : null);
  // The read link, normalised: what a follower keeps, never an edit key.
  const readLink = async (text) => { const st = parse(text); if (!st) fail('link'); return C.session(st).link(false); };

  // The channel's newest bundle: { bytes, ref, link }. Throws { code }.
  const latest = async (text, { fetch }) => {
    const st = parse(text);
    if (!st) fail('link');
    const s = client(st, fetch);
    const r = await s.sync().catch(() => fail('network'));
    if (r.gone) fail('gone');
    if (r.more || r.bad) fail('network');
    if (st.type && st.type !== 'modchannel') fail('kind');
    const ref = s.view().m?.bundle;
    if (!st.type || !ref) fail('empty');
    const bytes = await s.get(ref).catch(() => fail('network'));
    return { bytes, ref, link: await s.link(false) };
  };

  // The author's side: a signed bundle (bytes) to the mod's channel, made on the first publish. → { ok, link } | { ok, error }.
  const publications = new WeakMap();
  const publish = async (bytes, { local, fetch, server }) => {
    let got;
    try { got = await B().read(bytes); } catch { return { ok: false, error: 'bundle' }; }
    if (!got.signed) return { ok: false, error: 'unsigned' };
    const k = OWN(got.id);
    if (!publications.has(local)) publications.set(local, new Map());
    const active = publications.get(local);
    const run = (active.get(k) || Promise.resolve()).catch(() => {}).then(async () => {
      const had = (await local.get(k))[k];
      const st = isObj(had?.st) ? had.st : C.create('modchannel', { server });
      // Followers refuse anything but a newer version; saying so here saves the upload.
      if (had?.version && B().compare(got.version, had.version) <= 0) return { ok: false, error: 'version', version: had.version };
      if (!await local.set({ [k]: { ...had, st } })) return { ok: false, error: 'write' };
      const s = client(st, fetch), previous = had?.ref || s.view().m?.bundle;
      let ref;
      try {
        ref = await s.put(bytes);
        await s.edit({ m: { bundle: { ...ref, n: 'mod.glazemod', t: 'application/octet-stream' } } });
        const r = await s.sync();
        if (r.gone || r.more || r.bad || st.pending.length) fail('network');
      } catch (e) { await local.set({ [k]: { ...had, st } }); return { ok: false, error: code(e) }; }
      const link = await s.link(false);
      if (!await local.set({ [k]: { st, ref, version: got.version, link, at: Date.now() } })) return { ok: false, error: 'write' };
      if (previous && previous.id !== ref.id) await s.removeFile(previous.id).catch(() => {});
      return { ok: true, link, version: got.version };
    });
    active.set(k, run);
    try { return await run; } finally { if (active.get(k) === run) active.delete(k); }
  };
  const ownLink = async (id, { local }) => { const v = (await local.get(OWN(id)))[OWN(id)]; return v?.link ? { ok: true, link: v.link, version: v.version } : { ok: false, error: 'missing' }; };

  // The follower's side, for each installed mod with a channel (or only `id`): at most daily unless `force` (the editor
  // opening, Check now). A newer bundle that asks for nothing new is installed as an update through lib/modbundle.js;
  // one that asks for more waits in `pending` for the editor's prompt. Failures are kept in the state, quietly.
  // env: { local, fetch, now, blocked, enqueue, install }; install(m) is the worker's 'glaze:mods' install.
  const runs = new WeakMap();
  const check = async (env, { force = false, id = null } = {}) => {
    const index = async () => { const v = (await env.local.get('mods')).mods; return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[a-z2-7]{16}$/.test(x) && (!id || x === id)) : []; };
    const ids = await index(), out = {};
    if (!runs.has(env.local)) runs.set(env.local, new Map());
    const active = runs.get(env.local);
    for (const x of ids) {
      if (!active.has(x)) active.set(x, (async () => {
        let rec, state;
        const claimed = await env.enqueue(async () => {
          if (!(await index()).includes(x)) return;
          const all = await env.local.get([`mod:${x}`, STATE(x)]);
          rec = all[`mod:${x}`]; state = isObj(all[STATE(x)]) ? all[STATE(x)] : {};
          if (!isObj(rec) || typeof rec.channel !== 'string' || (rec.enabled === false && !(force && id))) return;
          if (!force && env.now() - (state.tried || 0) < DAY) return 'soon';
          state = { ...state, tried: env.now() };
          if (!await env.local.set({ [STATE(x)]: state })) return 'write';
          return 'claimed';
        });
        if (claimed !== 'claimed') return claimed;
        let got, error;
        try { got = await latest(rec.channel, env); } catch (e) { error = code(e); }
        return env.enqueue(async () => {
          const all = await env.local.get([`mod:${x}`, STATE(x)]), current = all[`mod:${x}`], saved = all[STATE(x)];
          // A network wait must not revive a removed mod, a stopped follow, or an obsolete install.
          if (!(await index()).includes(x) || !current || current.channel !== rec.channel || current.hash !== rec.hash
            || current.installedAt !== rec.installedAt || saved?.tried !== state.tried) return;
          const next = { ...saved };
          try {
            if (error) fail(error);
            next.at = env.now(); delete next.error;
            if (got.ref.h !== saved.seen || force) {
              next.seen = got.ref.h;
              const b = await B().read(got.bytes).catch(() => fail('bundle'));
              const trust = (await env.local.get(`modTrust:${x}`))[`modTrust:${x}`] || null;
              const p = B().plan(current, b, { dev: false, blocked: String((await env.blocked(b)) || ''), trust });
              if (p.action === 'refuse') {
                delete next.pending;
                if (!['same', 'version'].includes(p.reason) || B().compare(b.version, current.version) > 0) next.error = p.reason === 'blocked' ? 'blocked' : 'refused';
              } else if (p.prompt) next.pending = { zip: B().std(got.bytes), hash: b.hash, version: b.version };
              else {
                delete next.pending;
                const r = await env.install({ op: 'install', zip: B().std(got.bytes), hash: b.hash, grants: [], source: 'link', channel: current.channel });
                if (!r?.ok) { next.error = 'refused'; delete next.seen; }
                else next.updated = env.now();
              }
            }
          } catch (e) { next.error = code(e); }
          if (!await env.local.set({ [STATE(x)]: next })) return 'write';
          return next.error || (next.pending ? 'pending' : 'ok');
        });
      })().finally(() => active.delete(x)));
      const result = await active.get(x);
      if (result !== undefined) out[x] = result;
    }
    return { ok: true, checked: out };
  };

  // Stop following: the record keeps everything but its channel.
  const unfollow = async (id, { local }) => {
    const k = `mod:${id}`, rec = (await local.get(k))[k];
    if (!isObj(rec)) return { ok: false, error: 'missing' };
    const { channel, ...rest } = rec;
    if (!await local.set({ [k]: rest })) return { ok: false, error: 'write' };
    return { ok: await local.remove(STATE(id)) };
  };
  const dismiss = async (id, { local }) => {
    const s = (await local.get(STATE(id)))[STATE(id)];
    if (isObj(s) && s.pending) { delete s.pending; return { ok: await local.set({ [STATE(id)]: s }) }; }
    return { ok: true };
  };

  return { DAY, OWN, STATE, parse, readLink, latest, publish, ownLink, check, unfollow, dismiss };
})();
GZ_MODCHANNEL;
if (typeof module !== 'undefined') module.exports = GZ_MODCHANNEL;
