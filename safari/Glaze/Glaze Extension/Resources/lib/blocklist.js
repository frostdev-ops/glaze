// The mod blocklist: a list of mods, bundles and authors the owner has signed as harmful. While at least
// one code mod is installed on Chrome and the student hasn't turned the setting off, the worker asks frostdev.io for it at most daily and
// sends nothing about the student. A list counts only if the owner's key signed it, its `seq` is higher than any seen and
// it hasn't expired. Every installed mod it names is stopped at once and can't be turned on or installed again.
//
// Fails open. No list, a bad one or an expired one never stops a mod that no earlier good list named, and a failed check
// changes nothing. What the last good list blocked stays blocked, even after it expires: staleness means "unknown", not
// "all clear" (current() says which), so withholding or outliving the list can't lift a block. Turning the setting off
// stops the asking only; it doesn't lift blocks already made.
//
// The list is signed offline (scripts/blocklist-sign.mjs, RELEASING.md) and served as { list, sig }. The signature is
// Ed25519 over utf8('glaze-blocklist-1|' + canon(list)). Checking needs WebCrypto's Ed25519, as sharing does (Chrome 137,
// Safari 17, Firefox 129); elsewhere nothing verifies, so no list applies.
//
// Classic script; module.exports for node. In the worker it's loaded on first use (lib/background.js).
var GZ_BLOCKLIST = globalThis.GZ_BLOCKLIST || (() => {
  const G = typeof GZ_SANITIZE !== 'undefined' ? { GZ_SANITIZE } : require('../defaults.js');
  const S = globalThis.crypto.subtle;
  const te = new TextEncoder();
  // The owner's public key: Ed25519, the raw 32 bytes in base64url. Its private key is kept offline by the owner
  // (`node scripts/blocklist-sign.mjs keygen`, RELEASING.md); a list signed by anything else is refused.
  const OWNER_KEY = 'KdWyoeAi5qK10c7op_zwFp2D6kBhrBtbXnE1TakrLa4';
  const ENDPOINT = 'https://frostdev.io/glaze/mods/api/blocklist';
  // storage.local: the last good list { list, sig, seq, checkedAt }, and when a check was last tried (a failed try holds
  // off the next for an hour, so an unreachable server isn't asked on every page load).
  const KEY = 'modsBlocklist', TRIED = 'modsBlocklistTried';
  const DAY = 864e5, RETRY = 36e5, TIMEOUT = 15e3;
  // The most a response may be: 256 KiB, a few thousand entries.
  const CAP = 256 << 10;
  const REASON_MAX = 200;
  const DEFAULT_REASON = 'This mod was blocked by Glaze.';
  const ID = /^[a-z2-7]{16}$/, B64 = /^[\w-]{43}$/;
  const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

  // JSON with object keys sorted by code unit and no spaces: the bytes both sides sign and check. The list holds only
  // strings, whole numbers, arrays and objects, which makes this the same text everywhere.
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
      : JSON.stringify(v));
  const unb64 = (s) => {
    if (typeof s !== 'string' || !/^[\w-]*$/.test(s)) throw new Error('bad');
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  };
  const at = (s) => (typeof s === 'string' && TIME.test(s) ? Date.parse(s) : NaN);
  const names = (a, re) => Array.isArray(a) && a.every((x) => typeof x === 'string' && re.test(x)) && new Set(a).size === a.length;

  // The list as it will be used, or null: version 1, a seq from 1, issued before expires, ids (mods), bundle hashes and
  // author keys in their forms, and a reason (one line, ≤ 200 characters) only for something listed. Strict on purpose:
  // the signing script holds the owner to the same rules, so a typo is found before it's signed.
  const clean = (l) => {
    if (!l || typeof l !== 'object' || Array.isArray(l) || l.v !== 1 || !Number.isSafeInteger(l.seq) || l.seq < 1) return null;
    if (!(at(l.issued) < at(l.expires))) return null;
    if (!names(l.mods, ID) || !names(l.bundles, B64) || !names(l.authors, B64)) return null;
    const r = l.reasons;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    const listed = new Set([...l.mods, ...l.bundles, ...l.authors]);
    for (const [k, v] of Object.entries(r)) if (!listed.has(k) || typeof v !== 'string' || !v || v.length > REASON_MAX || /[\p{Cc}\p{Cf}]/u.test(v)) return null;
    return { v: 1, seq: l.seq, issued: l.issued, expires: l.expires, mods: [...l.mods], bundles: [...l.bundles], authors: [...l.authors], reasons: { ...r } };
  };

  // A fetched document, checked: { ok: true, list, sig } or { ok: false, error } with error one of 'shape', 'key' (no
  // usable pinned key, or no Ed25519 here), 'signature', 'expired' and 'rollback' (a seq below `seq`, the highest seen).
  // `key` is for tests; the worker never passes one.
  const verify = async (doc, { key = OWNER_KEY, now = Date.now(), seq = 0 } = {}) => {
    const list = clean(doc?.list);
    if (!list || typeof doc.sig !== 'string' || !/^[\w-]{86}$/.test(doc.sig)) return { ok: false, error: 'shape' };
    let sig, vk;
    try {
      sig = unb64(doc.sig);
      vk = await S.importKey('raw', unb64(key), { name: 'Ed25519' }, false, ['verify']);
    } catch { return { ok: false, error: 'key' }; }
    // What was signed is the list as received, whatever else it carried; only the cleaned fields are used.
    if (!await S.verify({ name: 'Ed25519' }, vk, sig, te.encode(`glaze-blocklist-1|${canon(doc.list)}`)).catch(() => false)) return { ok: false, error: 'signature' };
    if (at(list.expires) <= now) return { ok: false, error: 'expired' };
    if (list.seq < seq) return { ok: false, error: 'rollback' };
    return { ok: true, list, sig: doc.sig };
  };

  // What a cleaned list says about a mod: { by: 'mod' | 'bundle' | 'author', key, reason } or null. `rec` is an installed
  // record or a bundle about to be: { id, hash (the bundle hash, base64url), key (the author's key, base64url) }.
  const match = (list, rec) => {
    const author = rec?.key ?? rec?.manifest?.author?.key;
    const hit = list.mods.includes(rec?.id) ? ['mod', rec.id] : list.bundles.includes(rec?.hash) ? ['bundle', rec.hash] : list.authors.includes(author) ? ['author', author] : null;
    return hit && { by: hit[0], key: hit[1], reason: Object.hasOwn(list.reasons, hit[1]) ? list.reasons[hit[1]] : DEFAULT_REASON };
  };

  // The reason `rec` is blocked by the last good list, or ''. An install or a turn-on is refused on any answer but ''.
  // `local`: a storage area (get(keys) → object).
  const blocked = async (local, rec) => {
    const list = clean((await local.get(KEY))[KEY]?.list);
    return (list && match(list, rec)?.reason) || '';
  };

  // Whether the stored list says anything now: it exists and hasn't expired. A list that has is the last known answer,
  // still enforced, but the editor should show it as out of date.
  const current = (state, now = Date.now()) => !!state?.list && at(state.list.expires) > now;

  // Stops every installed mod `list` names (enabled: false, blocked: the reason, on its `mod:<id>` record), and takes
  // `blocked` off a mod the list no longer names (it stays off until the student turns it on). → { ok, blocked: [id] }
  // When supplied, the verified state is saved in the same write as the records, so either all of it changes or none.
  const apply = async (local, list, state) => {
    const index = (await local.get('mods')).mods;
    const keys = (Array.isArray(index) ? index : []).filter((id) => typeof id === 'string').map((id) => `mod:${id}`);
    const recs = keys.length ? await local.get(keys) : {};
    const patch = state ? { [KEY]: state } : {}, stopped = [];
    for (const k of keys) {
      const rec = recs[k];
      if (!rec || typeof rec !== 'object') continue;
      const hit = match(list, rec);
      if (hit) {
        if (rec.enabled !== false || rec.blocked !== hit.reason) { patch[k] = { ...rec, enabled: false, blocked: hit.reason }; stopped.push(rec.id); }
      } else if (rec.blocked !== undefined) { const { blocked: _, ...rest } = rec; patch[k] = rest; }
    }
    return { ok: !Object.keys(patch).length || await local.set(patch), blocked: stopped };
  };

  const recent = (t, span, now) => Number.isFinite(t) && t <= now && now - t < span;

  // The response body as text, or throws 'fetch' (no answer, not 200) or 'size'. Never more than CAP bytes are read.
  const download = async (env) => {
    const r = await env.fetch(ENDPOINT, {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache', redirect: 'error', signal: globalThis.AbortSignal?.timeout?.(TIMEOUT),
    });
    if (!r.ok || !r.body) throw new Error('fetch');
    if (Number(r.headers.get('content-length')) > CAP) { await r.body.cancel().catch(() => {}); throw new Error('size'); }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let text = '', n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + dec.decode();
      if ((n += value.length) > CAP) { await reader.cancel().catch(() => {}); throw new Error('size'); }
      text += dec.decode(value, { stream: true });
    }
  };

  // Manifest entry points, not permissions or declarative parts, say whether a mod contains code.
  const hasCode = (rec) => {
    const m = rec?.manifest, ui = m?.ui;
    const file = (v) => typeof v === 'string' && v.length > 0;
    return file(m?.hooks) || file(m?.worker) || [
      ...(Array.isArray(ui?.tiles) ? ui.tiles : []), ...(Array.isArray(ui?.rail) ? ui.rail : []), ui?.nav, ui?.background,
    ].some((slot) => file(slot?.file) || file(slot?.worker));
  };

  // One check, if one is due. env: sync and local (storage areas: get(keys), set(patch) → whether it worked), fetch,
  // now() in ms, enqueue(f) (runs f with the writes that must not race the mod records'). Asks only when Glaze and the
  // setting are on, a code mod is installed, and the last good check is over a day old (or a failed try over an hour). env.key
  // is for tests.
  // → { ok: true, seq, blocked } or { ok: false, error }: 'off', 'none' (no code mod installed), 'soon', 'fetch', 'size',
  // verify()'s errors, 'apply' (the writes failed, so the list wasn't kept and the next try starts afresh).
  const check = async (env) => {
    const now = env.now();
    const s = G.GZ_SANITIZE(await env.sync.get(['enabled', 'mods']));
    if (!s.enabled || !s.mods.blocklist) return { ok: false, error: 'off' };
    const got = await env.local.get(['mods', KEY, TRIED]);
    if (!Array.isArray(got.mods) || !got.mods.length) return { ok: false, error: 'none' };
    const keys = got.mods.filter((id) => typeof id === 'string').map((id) => `mod:${id}`);
    const recs = keys.length ? await env.local.get(keys) : {};
    if (!keys.some((k) => hasCode(recs[k]))) return { ok: false, error: 'none' };
    const state = got[KEY] && typeof got[KEY] === 'object' ? got[KEY] : {};
    if (recent(state.checkedAt, DAY, now) || recent(got[TRIED], RETRY, now)) return { ok: false, error: 'soon' };
    if (!await env.local.set({ [TRIED]: now })) return { ok: false, error: 'apply' };
    let doc;
    try { doc = JSON.parse(await download(env)); } catch (e) { return { ok: false, error: e.message === 'size' ? 'size' : 'fetch' }; }
    const seen = Number.isSafeInteger(state.seq) ? state.seq : 0;
    const v = await verify(doc, { key: env.key, now, seq: seen });
    if (!v.ok) return v;
    // The same seq must be the same list: a different one under it is no increase.
    if (v.list.seq === seen && v.sig !== state.sig) return { ok: false, error: 'rollback' };
    return env.enqueue(async () => {
      const done = await apply(env.local, v.list, { list: v.list, sig: v.sig, seq: v.list.seq, checkedAt: now });
      if (!done.ok) return { ok: false, error: 'apply' };
      return { ok: true, seq: v.list.seq, blocked: done.blocked };
    });
  };

  return { OWNER_KEY, URL: ENDPOINT, KEY, TRIED, DAY, RETRY, CAP, canon, clean, verify, match, blocked, current, apply, check };
})();
GZ_BLOCKLIST;
if (typeof module !== 'undefined') module.exports = GZ_BLOCKLIST;
