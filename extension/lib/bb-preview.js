// Blackboard Ultra's file previews, opened in Glaze's PDF viewer (features/bbpreview.js asks; lib/background.js answers
// 'glaze:bb-preview' with ask below). Ultra converts every attachment to a PDF for its own viewer (live probe, 2026-10-30):
// the attachment's data-bbfile viewerUrl (its /bbcswebdav/ file + render=inline) redirects to basic-doc-viewer's
// index.html with the document's hash, the tenant and the original's address; that viewer's documents API answers
// { status: "done", hash, urls: { pdf } }, urls.pdf a presigned S3 address of converted.pdf good for X-Amz-Expires
// (3600 s). Each step is checked here, a GET with the session only to Blackboard's own hosts, and any other answer is a
// named failure, so the page keeps Blackboard's frame. Anything but done or a failure counts as still converting: the
// converting answer wasn't seen live, and the page asks again on Ultra's own cadence (EVERY, for FOR).
// Classic script; module.exports for node.
var GZ_BB_PREVIEW = globalThis.GZ_BB_PREVIEW || (() => {
  const HASH = /^[0-9a-f]{40}$/i, TENANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const VIEWER = /^basic-doc-viewer(?:\.[a-z0-9-]+)*\.blackboard\.com$/i, STORE = /^[a-z0-9][a-z0-9.-]*\.amazonaws\.com$/i;
  const LIMITS = Object.freeze({ url: 8192, json: 256e3, timeout: 15000 });
  const EVERY = 15000, FOR = 5 * 60e3;
  const FAILED = new Set(['failed', 'error', 'unsupported', 'rejected']);
  const plain = (u) => u.protocol === 'https:' && !u.port && !u.username && !u.password;
  const parse = (raw, base) => { try { return typeof raw === 'string' && raw.length <= LIMITS.url ? new URL(raw, base) : null; } catch { return null; } };
  // A data-bbfile viewerUrl from a page at origin: that site's own /bbcswebdav/ file, or null.
  const viewerUrl = (raw, origin) => {
    const u = parse(raw, origin);
    return u && u.origin === origin && /^https?:$/.test(u.protocol) && !u.username && !u.password && u.pathname.startsWith('/bbcswebdav/') ? u : null;
  };
  // Where viewerUrl went: basic-doc-viewer's index.html → { origin, hash, tenant, status, original }, or null.
  const viewer = (raw) => {
    const u = parse(raw);
    if (!u || !plain(u) || !VIEWER.test(u.hostname) || !/^\/ui(?:\/[\w.-]+)+\/index\.html$/.test(u.pathname)) return null;
    const p = u.searchParams, hash = p.get('hash') || '', tenant = p.get('tenantId') || '', original = parse(p.get('originalUrl') || '');
    if (!HASH.test(hash) || !TENANT.test(tenant) || !original || original.protocol !== 'https:') return null;
    return { origin: u.origin, hash, tenant, status: (p.get('status') || '').toLowerCase(), original: original.href };
  };
  // The documents API's address for it, as the viewer asks it.
  const api = (v) => `${v.origin}/api/v1/tenants/${encodeURIComponent(v.tenant)}/documents/${encodeURIComponent(v.hash)}?url=${encodeURIComponent(v.original)}`;
  // A presigned S3 address's end, in ms: X-Amz-Date (20261030T142000Z) + X-Amz-Expires seconds; else 10 minutes on.
  const expiry = (u, now) => {
    const d = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(u.searchParams.get('X-Amz-Date') || ''), s = Number(u.searchParams.get('X-Amz-Expires'));
    const at = d && Number.isSafeInteger(s) && s > 0 ? Date.UTC(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6]) + s * 1000 : now + 10 * 60e3;
    return Math.max(now, Math.min(at, now + 7 * 864e5));
  };
  // The API's JSON → { status: 'done', pdf, expires } | { status: 'converting' } | { error }.
  const answer = (j, hash, now = Date.now()) => {
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { error: 'shape' };
    if (typeof j.hash === 'string' && j.hash.toLowerCase() !== String(hash).toLowerCase()) return { error: 'shape' };
    const status = typeof j.status === 'string' ? j.status.toLowerCase() : '';
    if (FAILED.has(status)) return { error: 'refused' };
    if (status !== 'done') return { status: 'converting' };
    const pdf = parse(j.urls?.pdf);
    if (!pdf || !plain(pdf) || !STORE.test(pdf.hostname)) return { error: 'shape' };
    return { status: 'done', pdf: pdf.href, expires: expiry(pdf, now) };
  };
  // A body read to its end, stopped past max bytes (→ null).
  const text = async (r, max) => {
    if (+r.headers.get('content-length') > max) { await r.body?.cancel().catch(() => {}); return null; }
    if (!r.body) return r.text().then((s) => (s.length > max ? null : s));
    const reader = r.body.getReader(), parts = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if ((size += value.byteLength) > max) return null;
        parts.push(value);
      }
    } finally { reader.cancel().catch(() => {}); }
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.byteLength; }
    return new TextDecoder().decode(out);
  };
  // The whole chain for one viewerUrl from a page at origin, with the session: → { ok: true, status: 'done', pdf, expires },
  // { ok: true, status: 'converting' }, or { ok: false, error: address | signed-out | viewer | api | shape | refused |
  // too-big | timeout | network }.
  const ask = async (raw, origin, { fetch: get = fetch, now = Date.now, timeout = LIMITS.timeout } = {}) => {
    const from = viewerUrl(raw, origin);
    if (!from) return { ok: false, error: 'address' };
    const step = async (url, init, read) => {
      const c = new AbortController(), timer = setTimeout(() => c.abort(), timeout);
      try { const r = await get(url, { ...init, cache: 'no-store', signal: c.signal }); return await read(r); }
      catch (e) { return { error: c.signal.aborted ? 'timeout' : 'network', thrown: e }; }
      finally { clearTimeout(timer); }
    };
    const refused = (r, what) => (r.status === 401 || r.status === 403 ? 'signed-out' : !r.ok ? what : '');
    // The first hop is the school's own address and its redirect is the school's to choose, as an attachment's is; the
    // browser can't show a redirect before following it, so the request carries no referrer, and anything but the viewer's
    // own host is refused unread below.
    const at = await step(from.href, { credentials: 'include', redirect: 'follow', referrerPolicy: 'no-referrer' }, async (r) => {
      r.body?.cancel().catch(() => {});
      const no = refused(r, 'viewer');
      if (no) return { error: no };
      return viewer(r.url) || { error: new URL(r.url || from.href).origin === origin ? 'signed-out' : 'viewer' };
    });
    if (at.error) return { ok: false, error: at.error };
    const out = await step(api(at), { credentials: 'include', redirect: 'error', referrerPolicy: 'no-referrer', headers: { accept: 'application/json' } }, async (r) => {
      const no = refused(r, 'api');
      if (no) { r.body?.cancel().catch(() => {}); return { error: no }; }
      const s = await text(r, LIMITS.json);
      if (s == null) return { error: 'too-big' };
      try { return answer(JSON.parse(s), at.hash, now()); } catch { return { error: 'shape' }; }
    });
    return out.error ? { ok: false, error: out.error } : { ok: true, ...out };
  };
  return { viewerUrl, viewer, api, expiry, answer, ask, LIMITS, EVERY, FOR };
})();

if (typeof module !== 'undefined') module.exports = GZ_BB_PREVIEW;
