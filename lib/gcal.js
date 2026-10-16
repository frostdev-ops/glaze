// Google Calendar sync (Chrome; W13): a calendar named "Glaze" in the student's
// Google account, made by Glaze and the only one it touches, kept in step with what Export calendar (.ics) would save
// (lib/calexport.js, with the same choices). Runs in the background worker (lib/background.js 'glaze:gcal'), which gives
// it Chrome's sign-in; node tests run it against a local mock of the API (scripts/gcal-mock.js).
// Requests go only to www.googleapis.com (the Calendar API) and oauth2.googleapis.com (revoking the grant), never with
// cookies, never following a redirect. Classic script; module.exports for node.
//
// env: { fetch, token() → an access token from Chrome's cache (never a prompt), drop(token): Chrome forgets a token
// Google refused, sleep(ms), api, revoke: the two addresses (tests point them at the mock), act(send) (optional): the
// guard nearest each request, after the token: it reads what the run rests on, checks it, and only then calls send(),
// which issues the request with nothing awaited in between (or it throws a Fail, stopped) }.
var GZ_GCAL = globalThis.GZ_GCAL || (() => {
  // The build-time switch, off until Google verifies the app (DECISIONS.md, W13). Off: Glaze's settings show nothing
  // about Google sync, the worker refuses every operation and runs nothing, and package.sh leaves the manifest's oauth2
  // client and optional identity permission out of the package. scripts/dev-gcal.sh turns it on in its copy.
  const ON = false;
  const API = 'https://www.googleapis.com/calendar/v3';
  const REVOKE = 'https://oauth2.googleapis.com/revoke';
  // The one scope: make secondary calendars, and see, change and delete events on those (S3 §2).
  const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
  const CAL = /^[\w.+-]{1,200}@group\.calendar\.google\.com$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const BLOCK = 30 * 6e4; // a deadline shows as the half hour that ends at it (S3 §7)
  const WRITES = 150; // per run; the page asks again a minute later for the rest
  const GAP = 150; // ms between requests: at most 400 a minute, under Google's 600 per user
  const TRIES = 5;

  class Fail extends Error { constructor(code, status = 0) { super(code); this.code = code; this.status = status; } }

  // One request with Chrome's token. A 401: Chrome forgets the token and the request goes once more with a fresh one.
  // Rate limits (429, or 403 rateLimitExceeded / userRateLimitExceeded), Google's 5xx and a failed connection: truncated
  // exponential backoff with jitter, or Retry-After when given, five tries in all (Google's quota guide). ok: statuses
  // that are answers here, not failures. A Fail's code: auth, busy, missing (404), denied (403), http, stopped.
  const client = (env, signal) => {
    let sent = 0;
    return async (method, path, { body, query, ok = [] } = {}) => {
      let again = false;
      for (let n = 1; ; n++) {
        if (sent++) await env.sleep(GAP);
        if (signal?.aborted) throw new Fail('stopped');
        let token;
        try { token = await env.token(); } catch (e) { throw e instanceof Fail ? e : new Fail('auth'); }
        if (!token) throw new Fail('auth');
        const send = () => env.fetch(`${env.api || API}${path}${query ? `?${new URLSearchParams(query)}` : ''}`, {
          method, credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
          headers: { authorization: `Bearer ${token}`, ...(body && { 'content-type': 'application/json' }) },
          ...(body && { body: JSON.stringify(body) }),
        });
        let r;
        try { r = await (env.act ? env.act(send) : send()); } catch (e) { if (e instanceof Fail) throw e; r = null; }
        if (signal?.aborted) throw new Fail('stopped');
        if (r && (r.ok || ok.includes(r.status))) return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
        if (r?.status === 401 && !again) { again = true; await env.drop(token); continue; }
        const reason = r ? (await r.json().catch(() => null))?.error?.errors?.[0]?.reason || '' : '';
        const busy = !r || r.status === 429 || r.status >= 500 || (r.status === 403 && /^(rateLimitExceeded|userRateLimitExceeded)$/.test(reason));
        if (busy && n < TRIES) {
          const after = Number(r?.headers.get('retry-after'));
          await env.sleep(after > 0 ? Math.min(after, 60) * 1000 : Math.min(2 ** (n - 1) * 1000 + Math.random() * 1000, 32000));
          continue;
        }
        throw new Fail(busy ? 'busy' : r.status === 401 ? 'auth' : r.status === 404 ? 'missing' : r.status === 403 ? 'denied' : 'http', r?.status || 0);
      }
    };
  };

  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  // What Glaze compares, the same for what it writes and what Google gives back. Google answers times in the calendar's
  // zone ("…-04:00"), so they're compared as instants.
  const at = (t) => (t?.date ? t.date : Date.parse(t?.dateTime));
  const look = async (b) => (await sha(JSON.stringify([b.summary || '', b.description || '', b.location || '', at(b.start), at(b.end)]))).slice(0, 16);

  // A page's event (lib/calexport.js, lib/classes.js icsEvents) → what to write, or null. Its id is the SHA-256 of the
  // Canvas account and the event's UID in hex (base32hex's first 16 letters, as Google asks), so the same item is the same
  // event on every run and every device, and two accounts on one site never share one. Instants are UTC; a deadline (an
  // instant with no end) is the half hour before it; dates are all-day. No reminders (nothing nags) and shown as free.
  // plan, key: a "do on" day or a focus session of that Better To Do item, the kinds whose changes in Google come back.
  const prep = async (src, e) => {
    if (!e || typeof e.uid !== 'string' || !e.uid || e.uid.length > 500) return null;
    let start = e.start, end = e.end;
    const timed = typeof start === 'number';
    if (timed) {
      if (!(Number.isFinite(end) && end > start)) [start, end] = [start - BLOCK, start];
      if (!(start > 0 && end < 253402300800000)) return null;
    } else if (!(DATE.test(start) && DATE.test(end) && end > start)) return null;
    const url = /^https?:\/\//i.test(e.url || '') ? str(e.url, 2000) : '';
    const when = (v) => (timed ? { dateTime: new Date(v).toISOString() } : { date: v });
    const body = {
      summary: str(e.summary, 500), description: [str(e.description, 4000), url].filter(Boolean).join('\n\n'), location: str(e.location, 500),
      start: when(start), end: when(end), status: 'confirmed', transparency: 'transparent', reminders: { useDefault: false },
    };
    const k = (e.plan === 'on' && !timed) || (e.plan === 'session' && timed) ? e.plan : '';
    const i = k && typeof e.key === 'string' && e.key.length <= 60 ? e.key : '';
    return {
      id: await sha(`${src} ${e.uid}`), body, h: await look(body), t: end,
      k: i ? k : '', i, v: !i ? null : k === 'on' ? start : { at: start, min: Math.round((end - start) / 6e4) },
    };
  };

  // The sync state kept on this device (storage.local gcalSync), cleaned: Google's cursor (sync); for each event Glaze
  // wrote, by its id (map): its Canvas account (s), kind (k: 'on', 'session' or ''), item (i) and plan (v), when it ends
  // (t), a hash of what was written (h) and Google's etag for it (e); gone: deadlines the student deleted in Google, never
  // written again.
  const fresh = (raw) => ({
    sync: typeof raw?.sync === 'string' ? raw.sync : null,
    map: raw?.map && typeof raw.map === 'object' && !Array.isArray(raw.map) ? raw.map : {},
    gone: Array.isArray(raw?.gone) ? raw.gone.filter((x) => typeof x === 'string').slice(-1000) : [],
  });

  // Whether a plan (x: a map entry, or a prepared event: kind k, item i, plan v) is what Better To Do holds (lib/todo.js
  // clean()'s data d).
  const holds = (d, x) => {
    const l = d.items[x.i] || {};
    return x.k === 'on' ? l.on === x.v : (l.sessions || []).some((s) => s.at === x.v?.at && s.min === x.v?.min);
  };

  // One run for one Canvas account (src '<origin>/<uid>'): what changed in Google first, then what changed here.
  // events: the page's; from, first: where its range starts (an instant, and that day), before which an event Glaze no
  // longer has is history and stays in the calendar. st: fresh()'s state, changed in place; save() keeps it (after
  // reading Google's changes, every 25 writes and at the end); plans(edits): changes to the student's plans read back
  // from Google, for still(), → true once kept (anything else stops the run before Google's changes count as read, so the
  // next run reads them again); mine(): Better To Do's data as it is now, after those (a plan event whose plan isn't
  // there any more is left alone: the page read it before); whole: false, the page's read was partial, so nothing is
  // deleted for being missing from it. → { wrote, more }: more when writes are left for the next run.
  const sync = async (env, cal, st, { src, events, from, first, whole }, { signal, save = async () => {}, plans = async () => true, mine = null } = {}) => {
    const call = client(env, signal);
    const path = `/calendars/${encodeURIComponent(cal)}/events`;
    // 1. Google's changes since the cursor. The first run lists every event: none yet, or another device's.
    let got = [], cursor = st.sync, page = null;
    for (let i = 0; ; i++) {
      if (i > 50) throw new Fail('http');
      let r;
      try { r = await call('GET', path, { query: { maxResults: '2500', ...(cursor && { syncToken: cursor }), ...(page && { pageToken: page }) } }); } catch (e) {
        // An expired cursor: everything again (Google's sync guide).
        if (e.status === 410 && cursor) { cursor = null; page = null; got = []; continue; }
        throw e;
      }
      got.push(...(Array.isArray(r.json?.items) ? r.json.items : []));
      page = typeof r.json?.nextPageToken === 'string' ? r.json.nextPageToken : null;
      if (!page) { st.sync = typeof r.json?.nextSyncToken === 'string' ? r.json.nextSyncToken : null; break; }
    }
    // 2. The conflict rule (S3 §7). A deadline, task, Gradescope item or class mirrors Canvas and the schedule: edited in
    //    Google, it's written over; deleted there, it stays deleted. A "do on" day or a focus session is the student's
    //    own plan: moved in Google, the plan moves here; deleted there, the plan goes. Each only while the plan here is
    //    still what Glaze last wrote (still()): a change made here since is newer, and goes to Google instead.
    const edits = [], skip = new Set();
    for (const ev of got) {
      const m = st.map[ev?.id];
      if (!m || ev.etag === m.e) continue; // not Glaze's, or Glaze's own write
      if (ev.status === 'cancelled') {
        delete st.map[ev.id];
        if (m.k) { edits.push({ was: m, edits: [m.k === 'on' ? ['on', m.i, null] : ['dropSession', m.i, m.v]] }); skip.add(ev.id); }
        else st.gone.push(ev.id);
        continue;
      }
      m.e = str(ev.etag, 100);
      if (await look(ev) === m.h) continue; // what Glaze wrote (another device's copy of it)
      m.h = ''; // Glaze's own fields go back over the student's
      // A plan that moved: this run leaves its event alone, and the plan's change brings the next run.
      if (m.k === 'on') {
        const day = ev.start?.date || String(ev.start?.dateTime || '').slice(0, 10);
        if (DATE.test(day) && day !== m.v) { edits.push({ was: { ...m }, edits: [['on', m.i, day]] }); skip.add(ev.id); }
      } else if (m.k === 'session') {
        const a = Date.parse(ev.start?.dateTime), min = Math.round((Date.parse(ev.end?.dateTime) - a) / 6e4);
        if (a > 0 && min >= 5 && min <= 600 && (a !== m.v?.at || min !== m.v?.min)) {
          edits.push({ was: { ...m }, edits: [['dropSession', m.i, m.v], ['addSession', m.i, { at: a, min }]] });
          skip.add(ev.id);
        }
      }
    }
    if (edits.length && await plans(edits) !== true) throw new Fail('local');
    st.gone = st.gone.slice(-1000);
    await save();
    // 3. What changed here: new and changed events written, ones gone from the range deleted, past ones left as history.
    const want = new Map();
    for (const e of Array.isArray(events) ? events.slice(0, 3000) : []) {
      const w = await prep(src, e);
      if (w && !want.has(w.id)) want.set(w.id, w);
    }
    if (mine) {
      const d = await mine();
      for (const w of want.values()) if (w.k && !holds(d, w)) skip.add(w.id);
    }
    const gone = new Set(st.gone);
    const ops = [...want.values()].filter((w) => !gone.has(w.id) && !skip.has(w.id) && st.map[w.id]?.h !== w.h);
    for (const [id, m] of Object.entries(st.map)) {
      if (m?.s !== src || want.has(id) || skip.has(id)) continue;
      if (typeof m.t === 'number' ? m.t <= from : !(m.t > first)) delete st.map[id];
      // Gone from a batch the page couldn't read whole (whole: false, Ultra's calendar cut short): not proof it's gone.
      else if (whole === true) ops.push(id); // only a read the page says was whole deletes (an omitted flag deletes nothing)
    }
    let wrote = 0;
    for (const op of ops.slice(0, WRITES)) {
      if (typeof op === 'string') {
        await call('DELETE', `${path}/${op}`, { ok: [404, 410] });
        delete st.map[op];
      } else {
        // An id Google already has (another device's event, or one this device lost track of) is updated instead.
        let r = st.map[op.id] ? null : await call('POST', path, { body: { id: op.id, ...op.body }, ok: [409] });
        if (!r || r.status === 409) r = await call('PUT', `${path}/${op.id}`, { body: op.body, ok: [404] });
        if (r.status === 404) r = await call('POST', path, { body: { id: op.id, ...op.body } });
        st.map[op.id] = { s: src, k: op.k, i: op.i, v: op.v, t: op.t, h: op.h, e: str(r.json?.etag, 100) };
      }
      if (++wrote % 25 === 0) await save();
    }
    await save();
    return { wrote, more: ops.length > WRITES };
  };

  // The plan changes from sync() that still hold for one account's Better To Do data (lib/todo.js clean()): each only
  // while the plan here is what Glaze last wrote. → lib/todo.js edits.
  const still = (d, edits) => edits.filter(({ was }) => holds(d, was)).flatMap((x) => x.edits);

  // Connect: a new calendar named Glaze. → { cal, owner }: its id, and the account it's in (its read-only dataOwner,
  // shown as a label; S3 §1). tz: the student's, for the calendar's own setting.
  const connect = async (env, tz) => {
    const { json } = await client(env)('POST', '/calendars', { body: { summary: 'Glaze', ...(tz && { timeZone: tz }) } });
    if (!CAL.test(json?.id)) throw new Fail('http');
    return { cal: json.id, owner: str(json.dataOwner, 320) };
  };
  // Link another device: the calendar a code names (its id, or the id without "@group.calendar.google.com"), opened by id
  // (calendars.get takes the scope; listing calendars would need another, S3 §7a).
  const code = (s) => { const c = String(s || '').trim(); const id = c.includes('@') ? c : `${c}@group.calendar.google.com`; return CAL.test(id) ? id : null; };
  const link = async (env, raw) => {
    const cal = code(raw);
    if (!cal) throw new Fail('code');
    const { json } = await client(env)('GET', `/calendars/${encodeURIComponent(cal)}`);
    return { cal, owner: str(json?.dataOwner, 320) };
  };
  // Disconnect: the calendar deleted if the student chose it (only its owner can), and the grant revoked, which removes
  // every scope Google gave this project (S3 §5). The token goes in the body, never the address. → whether Google took it.
  const remove = (env, cal) => client(env)('DELETE', `/calendars/${encodeURIComponent(cal)}`, { ok: [404, 410] });
  const revoke = async (env, token) => {
    const r = await env.fetch(env.revoke || REVOKE, {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString(),
    }).catch(() => null);
    return !!r?.ok;
  };

  return { ON, API, REVOKE, SCOPE, Fail, client, prep, fresh, sync, still, connect, code, link, remove, revoke };
})();

if (typeof module !== 'undefined') module.exports = GZ_GCAL; else GZ_GCAL;
