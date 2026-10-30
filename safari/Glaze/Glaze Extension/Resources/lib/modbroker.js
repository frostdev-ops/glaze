// Code mods' permission broker. Every call a mod makes reaches the service worker as
// { type: 'glaze:mod', mod, call, args, via } from Glaze's content script (features/mods.js), and this is the one place it is
// checked: the sender is Glaze in an LMS tab (lib/background.js resolves it to env.site) or the Documents page (env.site
// 'documents', which has its own calls), the mod is installed, on and not
// blocklisted, the call is in the API, its permission is declared and granted, and its arguments and answer are within
// limits. The page side asks here too for the mods to start ({ type: 'glaze:modpage' }). Classic script: the worker imports it
// on first use; module.exports for node.
var GZ_MODBROKER = globalThis.GZ_MODBROKER || (() => {
  // The worker's own copies (classic scripts it imports: top-level consts, not globalThis properties), else node's.
  const sanitize = () => (typeof GZ_SANITIZE !== 'undefined' ? GZ_SANITIZE : require('../defaults.js').GZ_SANITIZE);
  const color = () => (typeof GZ_COLOR !== 'undefined' ? GZ_COLOR : require('./color.js'));
  const api = () => (typeof GZ_MODAPI !== 'undefined' ? GZ_MODAPI : require('./modapi.js'));
  const X = () => (typeof GZ_XPARTS !== 'undefined' ? GZ_XPARTS : require('./lookparts.js'));
  const NL = () => (typeof GZ_NAV_LAYOUT !== 'undefined' ? GZ_NAV_LAYOUT : require('./navlayout.js'));
  // The stickers a mod carries are read with lib/media.js: the worker brings it on first use, as it brings this file.
  const media = () => (typeof GZ_MEDIA !== 'undefined' ? GZ_MEDIA : typeof require === 'function' ? require('./media.js') : (importScripts('media.js'), GZ_MEDIA));
  const WG = () => (typeof GZ_MODWIDGET !== 'undefined' ? GZ_MODWIDGET : require('./modwidget.js'));
  const KIB = 1024, MIB = 1024 * KIB;
  // args: what one call may carry (a storage value up to the quota, with room for its key); value: what an answer may.
  const LIMIT = { args: MIB + 16 * KIB, value: 4 * MIB, store: MIB, body: 2 * MIB, timeout: 15000, items: 500, inflight: 64, picture: 4096 };
  const ID = /^[a-z2-7]{16}$/; // lowercase base32, 16 characters (the bundle's mod id)
  // Personal data: documents (the titles, courses and counts of the student's documents) and documents.read (their text).
  const DATA = ['courses', 'todo', 'grades', 'nav.read', 'documents', 'documents.read'];
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const bytes = (s) => new TextEncoder().encode(s).length;
  const fail = (error) => ({ ok: false, error });
  class Refusal extends Error { constructor(code) { super(code); this.code = code; } }
  const no = (code) => { throw new Refusal(code); };

  // ---- the installed record (package P writes it; only its own fields are read) ---------------------------------------
  const record = async (local, id) => (await local.get(`mod:${id}`))[`mod:${id}`];
  // On, not blocked, and an unsigned copy only while dev mode is on; its saved enabled switch stays unchanged.
  const usable = (rec, id, dev) => isObj(rec) && rec.id === id && rec.enabled === true && !rec.blocked && (!rec.dev || dev === true) && isObj(rec.manifest);
  // The signed blocklist as stored after its check (storage.local modsBlocklist): by mod, by bundle hash, by author key.
  // None stored, or not a list: nothing is blocked (it fails open).
  const blocked = (list, rec) => isObj(list) && ['mods', 'bundles', 'authors'].some((k, i) => Array.isArray(list[k]) && list[k].includes([rec.id, rec.hash, rec.key][i]));

  // ---- permissions -----------------------------------------------------------------------------------------------------
  // A host as the URL parser writes it (lowercase, an IDN as punycode), and only a public name: never an address, the
  // student's own machine or a local network name, a port, a path or credentials. '' when it isn't one.
  const LOCAL = /(^|\.)(localhost|local|internal|lan|home\.arpa)$/;
  const host = (h) => {
    if (typeof h !== 'string' || !h || h.length > 253) return '';
    let u;
    try { u = new URL(`https://${h}/`); } catch { return ''; }
    const n = u.hostname;
    const name = u.host === n && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password;
    return name && /^[a-z\d-]+(\.[a-z\d-]+)+$/.test(n) && !/^[\d.]+$/.test(n) && !LOCAL.test(n) ? n : '';
  };
  // A permission id the way it is compared: network:<host> written as above, the rest as they are.
  const perm = (p) => (typeof p !== 'string' ? '' : p.startsWith('network:') ? (host(p.slice(8)) && `network:${host(p.slice(8))}`) : p);
  // Declared in the mod's manifest and granted by the student, both.
  const granted = (rec, want) => !!want
    && Array.isArray(rec.manifest.permissions) && rec.manifest.permissions.some((p) => isObj(p) && perm(p.id) === want)
    && isObj(rec.grants) && Object.keys(rec.grants).some((g) => rec.grants[g] === true && perm(g) === want);
  const declares = (rec, ids) => Array.isArray(rec.manifest.permissions) && rec.manifest.permissions.some((p) => isObj(p) && ids.includes(p.id));

  // ---- the calls ------------------------------------------------------------------------------------------------------
  // Each: perm, the permission it needs (a function of its arguments for network:<host>; null when the arguments name none),
  // worker (true: a mod's Worker only), and run(args, env), which answers or throws a Refusal. To add a call, add an entry.
  const storeKey = (id) => `modData:${id}`;
  // A mod that held personal data stays Worker-only across permission changes and signed updates.
  const privateKey = (id) => `modPrivate:${id}`;
  const stored = async (env) => { const d = (await env.local.get(storeKey(env.mod)))[storeKey(env.mod)]; return isObj(d) ? d : {}; };
  const key = (k) => (typeof k === 'string' && k.length >= 1 && k.length <= 256 ? k : no('args'));
  // A store change, in the worker's write queue so two tabs' changes both land. fromEntries makes every key an own property,
  // __proto__ included, so no key reaches a prototype.
  const change = (env, edit) => env.queue(async () => {
    const next = Object.fromEntries(edit(Object.entries(await stored(env))));
    if (env.signal?.aborted) no('cancelled');
    if (bytes(JSON.stringify(next)) > LIMIT.store) no('quota');
    if (!await (Object.keys(next).length ? env.local.set({ [storeKey(env.mod)]: next }) : env.local.remove(storeKey(env.mod)))) no('write');
    return true;
  });
  // The page's own site only: an LMS tab's mod sees that site's courses, plans and grades, never another school's.
  const site = (env) => env.site;
  const own = (k, env) => k.startsWith(`${site(env)}/`);
  // And only the plans and grades of the account signed in on the page that asked: env.account(), which the worker answers
  // from Glaze's own content script in that document (lib/background.js modAccount), never from what a mod sends. → its id,
  // or null while it is unknown (nothing is read). Glaze's editor preview (lib/editor-widget.js) has no page and passes no
  // env.account: '', this site's newest record.
  const UID = /^(\d{1,20}|_\d{1,20}_\d{1,20})$/;
  const account = async (env) => {
    if (env.account === undefined) return '';
    try { const u = await env.account(); return typeof u === 'string' && UID.test(u) ? u : null; } catch { return null; }
  };
  const asker = (env) => (typeof env.account === 'function' ? env.account : async () => null);
  const n = (v) => (Number.isFinite(v) ? v : null);
  const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const plan = async (env) => {
    const uid = await account(env);
    const c = uid === null ? null : (await env.local.get('todoCache')).todoCache;
    const k = isObj(c) && typeof c.key === 'string' ? c.key : '';
    return (uid ? k === `todo:${site(env)}/${uid}` : k.startsWith('todo:') && own(k.slice(5), env)) && Array.isArray(c.items) ? c.items : [];
  };
  const planItem = (i, env) => ({
    id: s(i.id, 40), type: s(i.type, 40), courseId: s(i.cid, 40), course: s(i.course, 120), title: s(i.title, 300), due: n(i.at),
    url: typeof i.url === 'string' && i.url.startsWith('/') && !i.url.startsWith('//') ? site(env) + i.url.slice(0, 2000) : '',
    done: !!i.ov?.done, submitted: !!i.sub?.submitted, graded: !!i.sub?.graded, late: !!i.sub?.late, missing: !!i.sub?.missing,
  });
  // A nav layout from a mod's code (nav.set, nav.layout, a nav in look.override) needs nav.layout granted, and its links go
  // only to pages of this tab's school site, as nav.add's do (lib/navlayout.js onSite): a link elsewhere refuses the whole
  // call, so none of the layout applies. Otherwise any mod could hide the student's Grades item and put its own in its place
  // with what it read in the address, and send that off-site with no network permission. A bundle's static parts.nav ('parts'
  // below) carries none of the student's data, so its links may go anywhere. Withdrawing a layout (null) needs nothing:
  // glaze.nav.items sends that whenever its function gives nothing.
  const layoutPerm = (v) => (v === null ? '' : 'nav.layout');
  const siteLinks = (nav, env) => (NL().offsite(nav, env.site).length ? no('args') : nav);
  const layout = (a, env) => (a[0] === null ? null : siteLinks(X().clean({ nav: a[0] })?.nav ?? no('args'), env));
  const CALLS = {
    'storage.get': { perm: '', run: async (a, env) => { const d = await stored(env); if (!a.length) return d; const k = key(a[0]); return Object.hasOwn(d, k) ? d[k] : null; } },
    'storage.set': { perm: '', run: (a, env) => { const k = key(a[0]); if (a.length < 2 || a[1] === undefined) no('args'); return change(env, (e) => [...e.filter(([x]) => x !== k), [k, a[1]]]); } },
    'storage.remove': { perm: '', run: (a, env) => { const k = key(a[0]); return change(env, (e) => e.filter(([x]) => x !== k)); } },
    // { tokens: { accent: '#17c8f4', … } (the palette's --gz-* names without the prefix), dark, motion: 'off' | 'subtle' | 'expressive' }
    theme: { perm: '', run: async (a, env) => {
      const x = sanitize()(await env.sync.get(['colors', 'motion']));
      const C = color();
      return { tokens: Object.fromEntries(Object.entries(x.colors).map(([k, v]) => [k.replace(/^--gz-/, ''), v])), dark: C.brightness(C.parse(x.colors['--gz-surface'])) < 0.5, motion: x.motion.level };
    } },
    // [{ id, name, code, color }]: the courses Glaze has seen on this site (storage.local seenCourses).
    courses: { perm: 'courses', run: async (a, env) => {
      const all = (await env.local.get('seenCourses')).seenCourses;
      const o = site(env);
      return Object.entries(isObj(all) ? all : {}).filter(([k, c]) => isObj(c) && (/^_\d+_\d+$/.test(k) ? c.site === o : /^(canvas|moodle):/.test(k) && own(k.slice(k.indexOf(':') + 1), env)))
        .slice(0, LIMIT.items).map(([k, c]) => ({ id: k.slice(k.lastIndexOf('/') + 1), name: s(c.name, 200), code: s(c.code, 80), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : null }));
    } },
    // [{ id, type, courseId, course, title, due (ms or null), url, done, submitted, graded, late, missing }]: the planner as
    // Glaze last read it, when that was for this page's account (storage.local todoCache). Planner notes' text stays out.
    todo: { perm: 'todo', run: async (a, env) => (await plan(env)).slice(0, LIMIT.items).filter(isObj).map((i) => planItem(i, env)) },
    // The cached plan's due items in [from, to], ms since 1970; at most 60 days and LIMIT.items results.
    schedule: { perm: 'todo', run: async (a, env) => {
      if (a.length !== 2 || !a.every((v) => Number.isSafeInteger(v) && v >= 0) || a[1] < a[0] || a[1] - a[0] > 60 * 864e5) no('args');
      return (await plan(env)).filter((i) => isObj(i) && Number.isFinite(i.at) && i.at >= a[0] && i.at <= a[1])
        .slice(0, LIMIT.items).map((i) => planItem(i, env));
    } },
    // [{ courseId, name, percent, at }] (or one course's, given its id): each course's latest grade from Insights' record for
    // this page's account (storage.local insights:<site>/<user>). [] until Insights has run for it.
    grades: { perm: 'grades', run: async (a, env) => {
      if (a.length && (typeof a[0] !== 'string' || a[0].length > 40)) no('args');
      const uid = await account(env);
      if (uid === null) return [];
      const keys = uid ? [`insights:${site(env)}/${uid}`] : (await env.keys()).filter((k) => k.startsWith(`insights:${site(env)}/`));
      const recs = Object.values(keys.length ? await env.local.get(keys) : {}).filter(isObj);
      const rec = recs.sort((x, y) => (n(y.at) || 0) - (n(x.at) || 0))[0];
      return (Array.isArray(rec?.courses) ? rec.courses : []).filter((c) => isObj(c) && Array.isArray(c.trend) && c.trend.length && (!a.length || String(c.id) === a[0]))
        .slice(0, LIMIT.items).map((c) => { const [at, pct] = c.trend.at(-1); return { courseId: String(c.id), name: s(c.name, 200), percent: n(pct), at: n(at) }; });
    } },
    // { status, ok, headers: { content-type, … }, text }: the worker fetches a granted host for the mod with no cookies or
    // credentials, no referrer, GET or POST, an allowlist of headers, no redirect (any is refused, so none leaves the host),
    // a timeout, and at most LIMIT.body bytes back.
    fetch: { perm: (a) => { const u = target(a[0]); return u ? `network:${u.hostname}` : null; }, run: (a, env) => get(target(a[0]), a[1], env) },
    // The mod's settings schema with the student's values (storage.local modSettings:<id>), or each default.
    settings: { perm: '', run: async (a, env) => api().values((await env.local.get(`modSettings:${env.mod}`))[`modSettings:${env.mod}`], env.rec.manifest) },
    // The calls below answer with what the page then shows or does (features/mods.js applies only an answer): each is
    // cleaned here, so a page never acts on what a mod sent unless it passed.
    // (slot, tree | null) → { slot, tree }: a slot the manifest declares and draws from its Worker (no file of its own, and
    // not a declarative widget's, which Glaze draws from its blocks), and a tree whose pictures are the mod's own.
    'ui.render': { perm: '', run: (a, env) => {
      const slot = slotOf(env.rec.manifest, a[0]);
      if (!slot || slot.file !== undefined || slot.blocks !== undefined) no('slot');
      if (a.length !== 2) no('args');
      if (a[1] === null) return { slot: a[0], tree: null };
      const tree = api().tree(a[1]);
      if (!tree) no('tree');
      if (api().images(tree).some((p) => !env.rec.paths?.includes(p))) no('image');
      return { slot: a[0], tree };
    } },
    // { courseId: { badge, accent, note } }: shown on those courses' cards on the next pass.
    'cards.set': { perm: 'courses', run: (a) => api().decorations(a[0]) ?? no('args') },
    // A nav layout (Look parts' x.nav) standing in for the student's own while this mod is first to give one, or null:
    // glaze.nav.items' answer, nav.layout's by another name.
    'nav.set': { perm: (a) => layoutPerm(a[0]), run: layout },
    // nav.read: the bar's model, filled in by the page (features/mods.js) once this says the mod may have it; a Worker only.
    'nav.model': { perm: 'nav.read', run: () => true },
    // nav.items: the mod's own items in Glaze's bar, cleaned here; a link only to a page of this LMS site.
    'nav.add': { perm: 'nav.items', run: (a, env) => api().navItem(a[0], env.site) ?? no('args') },
    'nav.update': { perm: 'nav.items', run: (a, env) => { const patch = api().navItem(a[1], env.site, true); if (typeof a[0] !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(a[0]) || !patch) no('args'); return { id: a[0], patch }; } },
    'nav.remove': { perm: 'nav.items', run: (a) => (typeof a[0] === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(a[0]) ? { id: a[0] } : no('args')) },
    // nav.layout: a layout proposed over the student's, as nav.set; never saved, and the student can say "Use my own".
    'nav.layout': { perm: 'nav.layout', run: layout },
    // A replacement nav's way to open a bar item: only with the student's nav switch on (the page also wants a click in its slot).
    'nav.go': { perm: '', run: async (a, env) => {
      if (!api().claims((await env.local.get(replaceKey(env.mod)))[replaceKey(env.mod)], env.rec.manifest).includes('nav')) no('permission');
      return typeof a[0] === 'string' && a[0].length <= 80 ? { id: a[0] } : no('args');
    } },
    'palette.set': { perm: '', run: (a) => api().commands(a[0]) ?? no('args') },
    // Look rules (x.rules), added after the worn Look's; [] takes them away.
    'rules.set': { perm: '', run: (a) => (Array.isArray(a[0]) && !a[0].length ? [] : X().clean({ rules: a[0] })?.rules ?? no('args')) },
    // Look parts over the student's Look while the mod runs on this page, never saved; null takes them away. A nav in them is
    // a layout from code, as nav.layout's.
    'look.override': { perm: (a) => (isObj(a[0]) && Object.hasOwn(a[0], 'nav') ? 'nav.layout' : ''), run: (a, env) => {
      if (a[0] === null) return null;
      const parts = X().clean(a[0]);
      if (!parts) no('args');
      const media = parts.bg?.media, declared = env.rec.manifest.parts?.bg?.media;
      // Page media loads bypass the network broker: code may only reuse its manifest's fixed source and type.
      if (media && (media.src !== declared?.src || media.type !== declared?.type)) no('permission');
      if (parts.nav) siteLinks(parts.nav, env);
      return served(parts, env.mod);
    } },
    'effects.play': { perm: '', run: (a) => api().effect(a[0], a[1] ?? {}) ?? no('args') },
    // To the mod's own Worker and frames on this page, and nowhere else.
    broadcast: { perm: '', run: (a) => { if (a.length !== 1 || bytes(JSON.stringify(a[0] ?? null)) > 64 * KIB) no('size'); return a[0] ?? null; } },
    // The Documents page's (papers.html: env.site 'documents'). Each answer is what the page then acts on (papers.js), only
    // for a key it lists: the list's public summaries, opening or starting a document within a second of a click on one of
    // the mod's own items, a document's text or its exported file (documents.read), the mod's items, its --gd-* hooks.
    'documents.list': { perm: 'documents', run: () => true },
    'documents.open': { perm: 'documents', run: (a) => ({ key: api().docKey(a[0]) ?? no('args') }) },
    'documents.create': { perm: 'documents', run: (a) => api().docCreate(a[0] ?? {}) ?? no('args') },
    'documents.read': { perm: 'documents.read', run: (a) => ({ key: api().docKey(a[0]) ?? no('args') }) },
    'documents.export': { perm: 'documents.read', run: (a) => ({ key: api().docKey(a[0]) ?? no('args') }) },
    'documents.add': { perm: 'documents', run: (a) => api().docItem(a[0], a[1]) ?? no('args') },
    'documents.remove': { perm: 'documents', run: (a) => api().docSlot(a[0], a[1]) ?? no('args') },
    'documents.style': { perm: 'documents', run: (a) => (a[0] === null ? null : api().docStyle(a[0]) ?? no('args')) },
    // (call, value, error?): a code tool's answer (glaze.tools.handle), to the agent app's call waiting for it from this tab
    // (env.tool: lib/mcp/modroute.js settle), which takes only its own, still on the account it was called for. An error is
    // the handler's text, at most 500 characters. The answer is held to a call's own argument limit, below LIMIT.value.
    'tools.result': { perm: 'agents', worker: true, run: async (a, env) => {
      if ((a.length !== 2 && a.length !== 3) || typeof a[0] !== 'string' || !/^[\w-]{1,64}$/.test(a[0])) no('args');
      const err = a[2] ?? null;
      if (err !== null && (typeof err !== 'string' || !err)) no('args');
      const out = err === null ? { value: a[1] ?? null } : { error: [...err].slice(0, 500).join('') };
      const uid = await account(env);
      if (env.signal?.aborted) no('cancelled');
      if (typeof env.tool !== 'function' || await env.tool(a[0], out, uid) !== true) no('call');
      return true;
    } },
  };
  // Where a call runs: the Documents page has the documents calls and those that need no LMS page; an LMS page the rest.
  const ON_DOCUMENTS = ['storage.get', 'storage.set', 'storage.remove', 'theme', 'settings', 'broadcast'];
  const here = (call, site) => (site === 'documents' ? call.startsWith('documents.') || ON_DOCUMENTS.includes(call) : !call.startsWith('documents.'));
  const replaceKey = (id) => `modReplace:${id}`;
  // Parts for the page: a background file the mod carries (`./<path>`) becomes `mod:<id>/<path>`, which the page asks
  // for by name ('media' below), so a file is always the one its own mod declared.
  const served = (x, id) => (x?.bg?.media?.src.startsWith('./') ? { ...x, bg: { ...x.bg, media: { ...x.bg.media, src: `mod:${id}/${x.bg.media.src.slice(2)}` } } } : x);
  // A manifest's slot by its key: tile:<id>, rail:<id>, nav or background. → { name?, file? } or null.
  const slotOf = (manifest, key) => {
    const ui = isObj(manifest?.ui) ? manifest.ui : {};
    if (typeof key !== 'string') return null;
    if (key === 'nav' || key === 'background') return isObj(ui[key]) ? ui[key] : null;
    const [kind, id] = key.split(':');
    const list = { tile: ui.tiles, rail: ui.rail }[kind];
    return Array.isArray(list) ? list.find((x) => isObj(x) && x.id === id && key === `${kind}:${id}`) || null : null;
  };
  // Extensions cannot see the resolved IP; HTTPS on port 443 and certificate validation block rebinding to local services.
  const target = (raw) => {
    if (typeof raw !== 'string' || raw.length > 4096) return null;
    let u;
    try { u = new URL(raw); } catch { return null; }
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && host(u.hostname) === u.hostname ? u : null;
  };
  const HEADERS = new Set(['accept', 'accept-language', 'content-language', 'content-type', 'authorization']);
  const SHOWN = ['content-type', 'content-length', 'etag', 'last-modified', 'date', 'cache-control'];
  const get = async (u, init = {}, env) => {
    if (!isObj(init)) no('args');
    const method = init.method === undefined ? 'GET' : typeof init.method === 'string' ? init.method.toUpperCase() : '';
    if (!['GET', 'POST'].includes(method)) no('method');
    const headers = {};
    if (init.headers !== undefined) {
      if (!isObj(init.headers)) no('args');
      for (const [k, v] of Object.entries(init.headers)) {
        if (!HEADERS.has(k.toLowerCase()) || typeof v !== 'string' || v.length > 8192 || /[\r\n\0]/.test(v)) no('header');
        headers[k.toLowerCase()] = v;
      }
    }
    if (init.body !== undefined && (method !== 'POST' || typeof init.body !== 'string')) no('args');
    // The student granted the host to the mod; the browser must hold it for Glaze too (asked for at install, or when the
    // permission was switched on: lib/editor-mods.js). Not held, the request would fail on CORS: refused before it.
    if (!await env.reach(u.href)) no('permission');
    let r;
    try {
      r = await env.fetch(u.href, { method, headers, body: init.body, credentials: 'omit', referrer: '', referrerPolicy: 'no-referrer', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(LIMIT.timeout) });
    } catch (e) { no(e?.name === 'TimeoutError' ? 'timeout' : 'network'); }
    // redirect 'manual': any redirect comes back opaque, and is refused rather than followed anywhere.
    if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) { r.body?.cancel?.().catch(() => {}); no('redirect'); }
    if (Number(r.headers.get('content-length')) > LIMIT.body) { r.body?.cancel?.().catch(() => {}); no('size'); }
    const parts = [];
    let got = 0;
    const reader = r.body?.getReader();
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          if (got > LIMIT.body) no('size');
          parts.push(value);
        }
      } catch (e) { reader.cancel().catch(() => {}); if (e instanceof Refusal) throw e; no(e?.name === 'TimeoutError' ? 'timeout' : 'network'); }
    }
    const all = new Uint8Array(got);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    return { status: r.status, ok: r.ok, headers: Object.fromEntries(SHOWN.filter((h) => r.headers.has(h)).map((h) => [h, r.headers.get(h)])), text: new TextDecoder().decode(all) };
  };

  // ---- one call ---------------------------------------------------------------------------------------------------------
  // m: { mod, call, args, via } ('worker', or a frame UI's 'frame:<slot>'). env: { site (the sender's LMS origin, or null),
  // account() (the page's account, above), local, sync (storage areas: get, and set/remove that say whether they worked),
  // keys() (storage.local's keys), fetch, queue(f) (the worker's write queue), record(id), blocklist(), tool?(call, out, uid)
  // (tools.result's hand-off: whether an agent call waiting in that tab took it) }.
  // → { ok: true, value } or { ok: false, error }.
  const handle = async (m, env) => {
    if (!env.site) return fail('sender');
    if (!isObj(m) || typeof m.mod !== 'string' || !ID.test(m.mod)) return fail('mod');
    if (typeof m.call !== 'string' || !Object.hasOwn(CALLS, m.call) || !here(m.call, env.site)) return fail('call');
    if (!Array.isArray(m.args)) return fail('args');
    let size;
    try { size = bytes(JSON.stringify(m.args)); } catch { return fail('args'); }
    if (size > LIMIT.args) return fail('size');
    try {
      const rec = await env.record(m.mod);
      if (!usable(rec, m.mod, (await env.local.get('modDev')).modDev)) return fail('mod');
      if (blocked(await env.blocklist(), rec)) return fail('blocked');
      // Only a mod granted documents runs on the Documents page ('list' below).
      if (env.site === 'documents' && !granted(rec, 'documents')) return fail('permission');
      const c = CALLS[m.call];
      const want = typeof c.perm === 'function' ? c.perm(m.args) : c.perm;
      if (want === null) return fail('args');
      if (want && !granted(rec, want)) return fail('permission');
      if (c.worker && m.via !== 'worker') return fail('permission');
      // Personal data goes only to a mod's Worker, which has no DOM to send it out of the page with.
      if (DATA.includes(want) && m.via !== 'worker') return fail('permission');
      const privateMod = (await env.local.get(privateKey(m.mod)))[privateKey(m.mod)] === true;
      if (m.via !== 'worker' && (declares(rec, DATA) || privateMod)) return fail('permission');
      if (DATA.includes(want) && !privateMod && !await env.queue(() => env.local.set({ [privateKey(m.mod)]: true }))) return fail('write');
      if (env.signal?.aborted) return fail('cancelled');
      const value = await c.run(m.args, { ...env, account: asker(env), mod: m.mod, rec });
      if (env.signal?.aborted) return fail('cancelled');
      const out = JSON.stringify(value === undefined ? null : value);
      if (bytes(out) > LIMIT.value) return fail('size');
      return { ok: true, value: JSON.parse(out) };
    } catch (e) { return fail(e instanceof Refusal ? e.code : 'failed'); }
  };

  // ---- the page's own asks ----------------------------------------------------------------------------------------------
  // 'list' → { mods: [...], plain: [{ id, name, slots: [{ key, name, size }] }] }. plain: the mods with declarative widgets (lib/modwidget.js),
  // on and not blocklisted; they start nothing. mods: [{ id, name, worker (its hooks' code, or null), slots, on, events, text }]: the mods to start in this
  // tab, those installed, on, not blocklisted and with code or a slot, in the student's order (modOrder).
  // slots: [{ key (tile:<id>, rail:<id>, nav, background), name, size (a tile's first size), file: its HTML (frame UI) or
  // null (drawn by Glaze from the Worker's tree) }]; a mod that declares a data permission, or ever held data, has no file.
  // on: the replacements the student turned on that have a matching slot (modReplace, GZ_MODAPI.claims). events: the data events it
  // may hear (its granted courses, todo, grades). text: its html, js and css sources, when a slot has a file. tools: the code
  // tools mod.json declares, by name, for its Worker's glaze.tools.handle (none: no key); the worker routes a call to one only
  // while the student lets apps use it.
  // 'parts' → { parts: [x] }: the Look parts (lib/lookparts.js, cleaned here) of every mod that is on and not blocklisted, code
  // or none, in the student's order, for features/lookparts.js to lay over the student's Look on every browser.
  // 'stopped' (mod, why): the watchdog stopped one; kept for the editor (storage.local modStops). 'asset' (mod, path): one
  // of an on mod's pictures as { type, b64 }, for an image in its tree.
  const WHY = ['hung', 'error', 'navigated'];
  const text = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const FRAME = /\.html?$/i, TEXT = /\.(html?|js|css)$/i;
  const PICTURE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
  const SLOT = /^(nav|background|(tile|rail):[a-z][a-z0-9-]{0,31})$/;
  const toRun = (rec, privateMod, replaced) => {
    const files = isObj(rec.files) ? rec.files : {};
    const src = (p) => (typeof p === 'string' && typeof files[p] === 'string' ? text(files[p]) : null);
    const ui = isObj(rec.manifest.ui) ? rec.manifest.ui : {};
    const pages = !privateMod && !declares(rec, DATA);
    const slot = (key, e, more = {}) => ({ key, name: s(e.name, 40), ...more, file: pages && typeof e.file === 'string' && FRAME.test(e.file) && Object.hasOwn(files, e.file) ? e.file : null });
    const slots = [
      ...(Array.isArray(ui.tiles) ? ui.tiles : []).filter(isObj).map((e) => slot(`tile:${e.id}`, e, { size: Array.isArray(e.sizes) && ['s', 'm', 'l'].includes(e.sizes[0]) ? e.sizes[0] : 's' })),
      ...(Array.isArray(ui.rail) ? ui.rail : []).filter(isObj).map((e) => slot(`rail:${e.id}`, e)),
      ...['nav', 'background'].filter((k) => isObj(ui[k])).map((k) => slot(k, ui[k])),
    ].filter((x) => SLOT.test(x.key));
    const worker = src(rec.manifest.hooks);
    if (worker === null && !slots.some((x) => x.file)) return null;
    const tools = (Array.isArray(rec.manifest.tools) ? rec.manifest.tools : []).filter((t) => isObj(t) && t.code === true && typeof t.name === 'string').map((t) => t.name);
    return { id: rec.id, name: s(rec.manifest.name, 80), worker, slots, on: api().claims(replaced, rec.manifest), events: DATA.filter((p) => granted(rec, p)),
      text: slots.some((x) => x.file) ? Object.fromEntries(Object.keys(files).filter((p) => TEXT.test(p)).map((p) => [p, src(p)])) : {}, ...(tools.length && { tools }) };
  };
  // A mod as the Documents page runs it: its Worker alone, or nothing.
  const worker = (r) => (typeof r?.worker === 'string' ? { ...r, slots: [], on: [], text: {} } : null);
  const page = async (m, env) => {
    if (!env.site) return fail('sender');
    // The Documents page starts only the Workers of mods granted documents, with no slots of a school page, and keeps their stops.
    const docs = env.site === 'documents';
    if (docs && !['list', 'stopped', 'runtime'].includes(m?.op)) return fail('sender');
    if (m?.op === 'list' || m?.op === 'parts') {
      const ids = (await env.local.get('mods')).mods;
      const list = await env.blocklist();
      const want = api().order(Array.isArray(ids) ? [...new Set(ids)].filter((id) => typeof id === 'string' && ID.test(id)) : [], (await env.local.get('modOrder')).modOrder);
      if (m.op === 'parts') {
        const recs = await env.local.get(['modDev', ...want.flatMap((id) => [`mod:${id}`, `modNavLayout:${id}`])]), parts = [];
        for (const id of want) {
          const rec = recs[`mod:${id}`];
          const x = usable(rec, id, recs.modDev) && !blocked(list, rec) && isObj(rec.manifest.parts) ? X().clean(rec.manifest.parts) : null;
          if (x && recs[`modNavLayout:${id}`] === false) delete x.nav;
          if (x && Object.keys(x).length) parts.push(served(x, id));
        }
        return { ok: true, parts };
      }
      const recs = await env.local.get(['modDev', ...want.flatMap((id) => [`mod:${id}`, privateKey(id), replaceKey(id), `modNavLayout:${id}`])]);
      const mods = [], plain = [];
      for (const id of want) {
        const rec = recs[`mod:${id}`];
        if (!usable(rec, id, recs.modDev) || blocked(list, rec) || (docs && !granted(rec, 'documents'))) continue;
        const decl = docs ? [] : WG().slots(rec.manifest);
        if (decl.length) plain.push({ id, name: s(rec.manifest.name, 80), slots: decl });
        try {
          const privateMod = recs[privateKey(id)] === true;
          const r = docs ? worker(toRun(rec, true, null)) : toRun(rec, privateMod, recs[replaceKey(id)]);
          if (r && declares(rec, DATA) && !privateMod && !await env.queue(() => env.local.set({ [privateKey(id)]: true }))) continue;
          if (r) mods.push({ ...r, arranges: recs[`modNavLayout:${id}`] !== false });
        } catch { /* a file that isn't base64: not started */ }
      }
      return { ok: true, mods, plain };
    }
    // 'widget' (mod, slot, lang) → a declarative widget's tree for this page (lib/modwidget.js): its blocks, resolved with only
    // the data its mod declared and the student granted, read for this site and this page's account. No code of the mod's runs, in any tab.
    if (m?.op === 'widget' && typeof m.mod === 'string' && ID.test(m.mod) && typeof m.slot === 'string') {
      const rec = await env.record(m.mod);
      if (!usable(rec, m.mod, (await env.local.get('modDev')).modDev) || blocked(await env.blocklist(), rec)) return fail('mod');
      const blocks = WG().blocks(slotOf(rec.manifest, m.slot)?.blocks);
      if (!blocks) return fail('slot');
      if (env.signal?.aborted) return fail('cancelled');
      let who;
      const scoped = { ...env, account: () => (who ||= account({ account: asker(env) })), mod: m.mod, rec };
      const data = await WG().collect(WG().needs(blocks).filter((p) => granted(rec, p)), (p) => CALLS[p].run([], scoped));
      if (env.signal?.aborted) return fail('cancelled');
      return { ok: true, ...WG().resolve(blocks, data, { lang: typeof m.lang === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(m.lang) ? m.lang : undefined, paths: rec.paths }), ...(who && await who === null && { accountPending: true }) };
    }
    if (m?.op === 'asset' && typeof m.mod === 'string' && ID.test(m.mod) && typeof m.path === 'string') {
      const rec = (await env.local.get(`mod:${m.mod}`))[`mod:${m.mod}`];
      if (!usable(rec, m.mod, (await env.local.get('modDev')).modDev) || blocked(await env.blocklist(), rec)) return fail('mod');
      const type = PICTURE[m.path.slice(m.path.lastIndexOf('.') + 1).toLowerCase()];
      if (!type || !isObj(rec.files) || !Object.hasOwn(rec.files, m.path) || typeof rec.files[m.path] !== 'string') return fail('asset');
      try {
        const D = typeof GZ_DOCTEXT !== 'undefined' ? GZ_DOCTEXT : require('./doctext.js');
        const size = D.imageSize(Uint8Array.from(atob(rec.files[m.path]), (c) => c.charCodeAt(0)));
        if (!size || size.w > LIMIT.picture || size.h > LIMIT.picture) return fail('asset');
      } catch { return fail('asset'); }
      return { ok: true, type, b64: rec.files[m.path] };
    }
    // 'packs': what the mods that are on bring, by name (no bytes): [{ mod, name, stickers: [{ id, name }], pets: [{ id, name }] }]. Works
    // for a mod with no code at all. 'sticker' (mod, id): one of them, read again and cleaned on the way out, as
    // { kind: 'image', mime, animated, b64 } or { kind: 'lottie', json }; anything that does not check is refused.
    if (m?.op === 'packs' || (m?.op === 'sticker' && typeof m.mod === 'string' && ID.test(m.mod) && typeof m.id === 'string')) {
      const stored = (await env.local.get('mods')).mods, list = await env.blocklist(), dev = (await env.local.get('modDev')).modDev;
      const ids = m.op === 'packs' ? (Array.isArray(stored) ? [...new Set(stored)].filter((id) => typeof id === 'string' && ID.test(id)) : []) : [m.mod];
      const recs = ids.length ? await env.local.get(ids.map((id) => `mod:${id}`)) : {};
      const out = [];
      for (const id of api().order(ids, (await env.local.get('modOrder')).modOrder)) {
        const rec = recs[`mod:${id}`];
        if (!usable(rec, id, dev) || blocked(list, rec)) continue;
        const p = media().packs(rec.manifest.packs, (f) => isObj(rec.files) && Object.hasOwn(rec.files, f));
        if (!p) continue;
        if (m.op === 'packs') { out.push({ mod: id, name: s(rec.manifest.name, 80), stickers: (p.stickers || []).map(({ id: i, name }) => ({ id: i, name })), pets: (p.pets || []).map(({ id: i, name }) => ({ id: i, name })) }); continue; }
        const item = (p.stickers || []).find((x) => x.id === m.id);
        let got = null;
        try { got = item && typeof rec.files[item.file] === 'string' && media().check(media().unstd(rec.files[item.file]), 'sticker'); } catch { /* not base64 */ }
        if (!got) return fail('asset');
        return got.type === 'lottie' ? { ok: true, kind: 'lottie', json: got.json, canvases: got.canvases } : { ok: true, kind: 'image', mime: got.mime, animated: got.animated, b64: media().std(got.bytes) };
      }
      return m.op === 'packs' ? { ok: true, packs: out } : fail('asset');
    }
    // 'media' (src: `mod:<id>/<path>`): the background file a mod carries, for lib/scene-media.js, read again and cleaned on
    // the way out as lib/media.js keeps a Look's: { kind: 'lottie', json, canvases } or { kind: 'video' | 'image', mime, b64 }.
    // Only the file the mod's own parts name as their background, of that type, and only while the mod is on and not blocked.
    if (m?.op === 'media' && typeof m.src === 'string') {
      const [, id, path] = /^mod:([a-z2-7]{16})\/(.+)$/.exec(m.src) || [];
      if (!id || X().MEDIA.mod(m.src) !== path) return fail('asset');
      const rec = (await env.local.get(`mod:${id}`))[`mod:${id}`];
      if (!usable(rec, id, (await env.local.get('modDev')).modDev) || blocked(await env.blocklist(), rec)) return fail('mod');
      const want = rec.manifest.parts?.bg?.media;
      if (!isObj(want) || want.src !== `./${path}` || !isObj(rec.files) || typeof rec.files[path] !== 'string') return fail('asset');
      let got = null;
      try { got = media().check(media().unstd(rec.files[path]), 'bg'); } catch { /* not base64 */ }
      if (!got || got.type !== want.type) return fail('asset');
      return got.type === 'lottie' ? { ok: true, kind: 'lottie', json: got.json, canvases: got.canvases } : { ok: true, kind: got.type, mime: got.mime, b64: media().std(got.bytes) };
    }
    if (m?.op === 'stopped' && typeof m.mod === 'string' && ID.test(m.mod) && WHY.includes(m.why)) {
      return env.queue(async () => {
        const { modStops } = await env.local.get('modStops');
        const kept = Object.entries(isObj(modStops) ? modStops : {}).filter(([k]) => k !== m.mod).slice(-49);
        return { ok: await env.local.set({ modStops: Object.fromEntries([...kept, [m.mod, { why: m.why, at: Date.now() }]]) }) };
      });
    }
    // 'runtime' (ok): whether a page found the mods host to be a working sandbox (features/mods.js), kept for the editor,
    // which shows code mods as needing Chrome where it isn't (or where the package has no sandbox). Written only on a change.
    if (m?.op === 'runtime' && typeof m.ok === 'boolean') {
      return env.queue(async () => {
        const { modRuntime } = await env.local.get('modRuntime');
        return { ok: modRuntime?.ok === m.ok || await env.local.set({ modRuntime: { ok: m.ok, at: Date.now() } }) };
      });
    }
    return fail('op');
  };

  return { LIMIT, ID, CALLS, handle, page, host, perm, target, blocked, record, usable, declares, slotOf };
})();
if (typeof module !== 'undefined') module.exports = GZ_MODBROKER; else GZ_MODBROKER;
