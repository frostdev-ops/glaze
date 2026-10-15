importScripts('download.js', 'color.js', 'fonts.js', '../defaults.js', 'history.js', 'cards.js', 'gradecalc.js', 'gpa.js', 'todo.js', 'insights.js', 'remind.js', 'widgets.js', 'share.js', 'lookx.js', 'gradescope.js', 'syllabus.js', 'classes.js', 'doctext.js', 'notes.js', 'calexport.js', 'gcal.js');

// The storage broker: writes that must not race between tabs, sites and the editor run here, one at a time, in one
// queue. Page-origin locks wouldn't do: two schools' Canvas sites and the editor page share this storage. Each kind
// of write ('glaze:<name>') names who may ask for it and what it does, given { sync, local }; each area's get gives
// what is stored, and set and remove say whether they worked.
const brokerArea = (area) => ({
  get: (keys) => chrome.storage[area].get(keys),
  set: (patch) => chrome.storage[area].set(patch).then(() => true, () => false),
  remove: (keys) => chrome.storage[area].remove(keys).then(() => true, () => false),
});
// Who asks: Glaze's own editor page, or a content script in a tab on a Canvas site Glaze runs on.
const fromEditor = (s) => s.id === chrome.runtime.id && typeof s.url === 'string' && s.url.split(/[?#]/)[0] === chrome.runtime.getURL('options.html');
const canvasSite = (u) => chrome.storage.local.get('canvas').then(({ canvas = [] }) => (u.hostname === 'localhost' && chrome.runtime.getManifest().host_permissions.includes('http://localhost/*'))
  || u.hostname === 'instructure.com' || u.hostname.endsWith('.instructure.com') || canvas.includes(`${u.protocol}//${u.hostname}/*`), () => false);
const fromCanvas = async (s) => {
  if (s.id !== chrome.runtime.id || !s.tab) return null;
  let u;
  try { u = new URL(s.url); } catch { return null; }
  return /^https?:$/.test(u.protocol) && await canvasSite(u) ? u.origin : null;
};
// An Ultra page: a content script in a tab on an https address under /ultra (the manifest's Ultra match), on a site Glaze
// has found to be Ultra (storage.local `ultra`: origins content-ultra.js reported, 'glaze:ultra', once Glaze started
// there), by its origin. The address alone isn't proof, as a school's own Canvas host isn't (fromCanvas).
const ultraAt = (s) => {
  if (s.id !== chrome.runtime.id || !s.tab) return null;
  try { const u = new URL(s.url); return u.protocol === 'https:' && /^\/ultra(\/|$)/.test(u.pathname) ? u.origin : null; } catch { return null; }
};
const fromUltra = async (s) => {
  const o = ultraAt(s);
  return o && (await chrome.storage.local.get('ultra').then(({ ultra = [] }) => ultra.includes(o), () => false)) ? o : null;
};
// Gradescope (lib/gradescope.js), with Glaze on (enabled, the master switch) and enhance.gradescope on: its own pages (the
// top frame of a tab on www.gradescope.com: who's signed in, placings, what was read, the bar), a Canvas page (what it read
// for a Gradescope course placed with one of its own site's courses, and its own accounts' answer to "show it here?"),
// and the editor.
const switchOn = (k) => Promise.resolve().then(() => chrome.storage.sync.get(['enabled', 'enhance']))
  .then(({ enabled, enhance }) => { const s = GZ_SANITIZE({ enabled, enhance }); return s.enabled && s.enhance[k]; }).catch(() => false);
const gradescopeOn = () => switchOn('gradescope');
const fromGradescope = (s) => s.id === chrome.runtime.id && !!s.tab && s.frameId === 0 && typeof s.url === 'string' && s.url.startsWith(`${GZ_GRADESCOPE.HOST}/`);
const gradescopeFor = async (gid, s) => {
  const site = await fromCanvas(s), ultra = await fromUltra(s);
  const { gradescope } = await chrome.storage.local.get(GZ_GRADESCOPE.KEY);
  const to = GZ_GRADESCOPE.clean(gradescope).map[gid]?.to;
  return (site && to?.startsWith(`canvas:${site}/`)) || (ultra && to?.startsWith(`ultra:${ultra}/`)) ? to : null;
};
const BROKER = {
  gradescope: {
    allow: async (m, s) => fromEditor(s) || (await gradescopeOn() && ((fromGradescope(s) && m.op !== 'bind')
      || (m.op === 'rows' && !!await gradescopeFor(m.gid, s)) || (m.op === 'bind' && typeof m.key === 'string' && m.key.startsWith(`${(await fromCanvas(s)) || (await fromUltra(s))}/`)))),
    run: (m, area) => GZ_GRADESCOPE.change(m, area),
  },
  // Course cards (lib/cards.js change). A Canvas page saves one course of its own site; the editor does the rest.
  cards: {
    allow: async (m, s) => fromEditor(s) || (!!m.key && !m.nav && !m.set && !m.replace && !m.reset && GZ_CARDS.KEY.test(m.key) && m.key.startsWith(`canvas:${await fromCanvas(s)}/`)),
    run: (m, area) => GZ_CARDS.change(m, area),
  },
  // Canvas's native rail: the editor may upload a picture; a Canvas command changes settings only.
  nav: {
    allow: async (m, s) => !!m.nav && typeof m.nav === 'object' && !Array.isArray(m.nav)
      && (fromEditor(s) || (!m.image && !m.nav.i && !!await fromCanvas(s))),
    run: (m, area) => GZ_CARDS.change({ nav: m.nav, image: m.image }, area),
  },
  // Better To Do's own data (lib/todo.js change). A Canvas or Ultra page edits its own site's accounts' lists; only the
  // editor restores a backup.
  todo: {
    allow: async (m, s) => (fromEditor(s) ? !!m.restore && m.key === undefined
      : !m.restore && typeof m.key === 'string' && GZ_TODO.STORE_KEY.test(m.key) && m.key.startsWith(`todo:${(await fromCanvas(s)) || (await fromUltra(s))}/`)),
    run: (m, area) => GZ_TODO.change(m, area),
  },
  // Dashboard notes (lib/widgets.js saveNote): a Canvas or Ultra page writes its own site's accounts' notes; the newest typing wins.
  notes: {
    allow: async (m, s) => typeof m.key === 'string' && GZ_WIDGETS.NOTES_KEY.test(m.key) && m.key.startsWith(`notes:${(await fromCanvas(s)) || (await fromUltra(s))}/`),
    run: (m, { local }) => GZ_WIDGETS.saveNote(m, local),
  },
  // Reminders and the streak (lib/remind.js change): what a page has seen, snoozed or muted, for its own site's accounts
  // (Canvas or Ultra).
  remind: {
    allow: async (m, s) => typeof m.key === 'string' && GZ_REMIND.STORE_KEY.test(m.key) && m.key.startsWith(`remind:${(await fromCanvas(s)) || (await fromUltra(s))}/`),
    run: (m, area) => GZ_REMIND.change(m, area),
  },
  // Class schedules (lib/classes.js change): a Canvas or Ultra page saves, edits and deletes its own site's accounts' classes.
  classes: {
    allow: async (m, s) => typeof m.key === 'string' && GZ_CLASSES.STORE_KEY.test(m.key) && m.key.startsWith(`classes:${(await fromCanvas(s)) || (await fromUltra(s))}/`),
    run: (m, area) => GZ_CLASSES.change(m, area),
  },
  // What-if scores on Canvas (lib/gradecalc.js applyWhatIf): a page changes its own site's records only. Every tab's
  // changes and clears meet here, so a change made before a Clear all in another tab can't bring records back.
  // Stickers (lib/lookx.js): one change at a time to a page's placements (apply, on what is stored now, so two tabs'
  // changes both land), which only a page of that origin makes; the student's own sticker pictures, which every site may
  // show; and the editor's Reset everything, which leaves a watermark (stkCleared): a change made before it, still on
  // its way, is dropped instead of bringing a sticker back. Changes and pictures carry `at`, when they were made.
  stickers: {
    allow: (m, s) => {
      if (m.reset === true) return fromEditor(s);
      if (s.id !== chrome.runtime.id || !s.tab) return false;
      if (typeof m.key !== 'string') return true;
      try { return m.key.length < 2100 && GZ_LX.PAGE_KEY.test(m.key) && m.key.startsWith(`stk:${new URL(s.url).origin}/`); } catch { return false; }
    },
    run: async (m, { local }) => {
      if (m.reset === true) {
        const gone = Object.keys(await local.get(null)).filter(GZ_LX.RESET);
        return { ok: await local.set({ stkCleared: Date.now() }) && (!gone.length || await local.remove(gone)) };
      }
      const { stkCleared = 0 } = await local.get('stkCleared');
      if (typeof m.drop === 'string' && GZ_LX.ID.test(m.drop)) return { ok: await local.remove(`stkImg:${m.drop}`) };
      if (!(Number.isFinite(m.at) && m.at > stkCleared)) return { ok: false, error: 'cleared' };
      if (typeof m.key === 'string') {
        const list = GZ_LX.apply((await local.get(m.key))[m.key], m);
        return { ok: await (list.length ? local.set({ [m.key]: list }) : local.remove(m.key)) };
      }
      if (typeof m.img !== 'string' || !GZ_LX.DATA.test(m.img)) return { ok: false };
      // The cap counts the pictures stored, not a list of them that a failed write could leave behind.
      if (!GZ_LX.roomFor(await local.get(null), m.img.length)) return { ok: false, error: 'cap' };
      const id = crypto.randomUUID();
      return await local.set({ [`stkImg:${id}`]: m.img }) ? { ok: true, id } : { ok: false, error: 'write' };
    },
  },
  // Look rotation (lib/lookx.js turn): every open LMS tab asks when the turn is due, and the queue lets the first change
  // the Look; the rest find nothing due. `now`: the student asked for the next Look (the command palette).
  rotate: {
    allow: (m, s) => s.id === chrome.runtime.id && !!s.tab,
    run: async (m, { sync, local }) => {
      const s = GZ_SANITIZE(await sync.get(null));
      const { rotateState, rotateLooks } = await local.get(['rotateState', 'rotateLooks']);
      const list = GZ_LX.rotation(rotateLooks, GZ_LOOKS.map((L) => L.name));
      const r = GZ_LX.turn(rotateState, Date.now(), s.extras, list, m.now === true);
      if (r.wear >= 0) {
        const L = GZ_LOOKS.find((l) => l.name === list[r.wear]);
        // A favorite that no longer decodes is passed over: its turn goes by unworn.
        const patch = L ? GZ_LOOK_APPLY(s, L) : await GZ_SHARE.decode(list[r.wear]).then((got) => GZ_LX.wearCode(s, got), () => null);
        // Decoding takes a moment, and the editor and popup write outside this queue: if rotation was turned off or
        // changed, or the student changed the theme meanwhile, this turn is dropped rather than worn over their choice.
        if (!L) {
          const now = GZ_SANITIZE(await sync.get(null));
          const { rotateState: st } = await local.get('rotateState');
          const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
          if (!same(now.extras, s.extras) || !same(st, rotateState) || !same(GZ_HISTORY.theme(now), GZ_HISTORY.theme(s))) return { ok: false, error: 'changed' };
        }
        if (patch && !await sync.set({ version: 2, ...patch })) return { ok: false };
      }
      return { ok: r.state === rotateState || await local.set({ rotateState: r.state }) };
    },
  },
  // What a syllabus said (lib/syllabus.js tidy), per Canvas site, user and course: a page keeps or deletes its own site's.
  syllabus: {
    allow: async (m, s) => typeof m.key === 'string' && GZ_SYLLABUS.KEY.test(m.key) && m.key.startsWith(`syllabus:${await fromCanvas(s)}/`),
    // Applied in the order they were made (m.at), whatever order they arrive in: an older save or one from before a
    // delete is dropped (lib/syllabus.js change).
    run: async (m, { local }) => {
      if (m.rec !== null && !GZ_SYLLABUS.tidy(m.rec)) return { ok: false, error: 'bad' };
      const next = GZ_SYLLABUS.change((await local.get(m.key))[m.key], m);
      if (!next) return { ok: false, error: 'stale' };
      return { ok: await local.set({ [m.key]: next }), rec: GZ_SYLLABUS.tidy(next) };
    },
  },
  // The GPA's per-course choices (sync gpaCourses), its one writer: the Dashboard's GPA table and syllabus import each send
  // one course's change (lib/gradecalc.js patchGpa), applied to what is stored when its turn comes, so changes to two
  // courses, from two tabs, both stay.
  gpa: {
    allow: async (m, s) => typeof m.key === 'string' && m.key.startsWith(`canvas:${await fromCanvas(s)}/`) && !!m.patch && typeof m.patch === 'object',
    run: async (m, { sync }) => {
      const r = GZ_GRADECALC.patchGpa((await sync.get('gpaCourses')).gpaCourses, m.key, m.patch);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: await sync.set({ gpaCourses: r.prefs }), prefs: r.prefs };
    },
  },
  whatif: {
    allow: async (m, s) => {
      const site = await fromCanvas(s);
      const own = site && typeof m.key === 'string' && m.key.startsWith(`whatIf:${site}:`) && /^\w{1,40}$/.test(m.key.slice(`whatIf:${site}:`.length));
      return !!own && ['course', 'grade', 'clear'].includes(m.op) && Number.isFinite(m.at) && (m.op === 'clear' || /^\d{1,20}$/.test(String(m.cid)));
    },
    run: async (m, { local }) => {
      const got = await local.get([m.key, 'whatIfCleared']);
      const marks = got.whatIfCleared && typeof got.whatIfCleared === 'object' ? got.whatIfCleared : {};
      const r = GZ_GRADECALC.applyWhatIf(m, got[m.key], marks[m.key] || 0);
      // A clear is first the time it was asked for, kept: without it a change made earlier could bring records back
      // after a restart, so if it can't be kept nothing is cleared, and the page says so.
      if (r.cleared !== (marks[m.key] || 0)) {
        const { [m.key]: _, ...rest } = marks;
        if (!await local.set({ whatIfCleared: { ...Object.fromEntries(Object.entries(rest).slice(-49)), [m.key]: r.cleared } })) return { ok: false };
      }
      const ok = Object.keys(r.all).length ? await local.set({ [m.key]: r.all }) : await local.remove(m.key);
      return { ok };
    },
  },
  // Past terms and the GPA goal (lib/gpa.js change): a page changes its own site's records only.
  gpaterms: {
    allow: async (m, s) => typeof m.key === 'string' && GZ_GPA.KEY.test(m.key) && m.key.startsWith(`gpaTerms:${await fromCanvas(s)}:`) && Number.isFinite(m.at),
    run: async (m, { local }) => {
      const rec = GZ_GPA.change((await local.get(m.key))[m.key], m);
      return rec ? { ok: await local.set({ [m.key]: rec }) } : { ok: false, error: 'stale' };
    },
  },
  // Insights' saved term summary (lib/insights.js change): a page keeps or clears its own site's accounts' record.
  insights: {
    allow: async (m, s) => typeof m.key === 'string' && GZ_INSIGHTS.KEY.test(m.key) && m.key.startsWith(`insights:${await fromCanvas(s)}/`),
    run: (m, { local }) => GZ_INSIGHTS.change(m, local),
  },
};
// The notes app's bodies, pictures and attachments (lib/notes.js run): this extension's own IndexedDB, which only the worker
// opens; no school page can. Keys are <origin>/<uid>/<id>, so each site's and account's are apart.
let notesDb = null;
const idbDone = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const notesOpen = () => (notesDb ||= new Promise((res, rej) => {
  const r = indexedDB.open('glaze-notes', 1);
  r.onupgradeneeded = () => { for (const s of ['bodies', 'files', 'blobs']) r.result.createObjectStore(s); };
  r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); notesDb = null; }; res(r.result); };
  r.onerror = () => rej(r.error);
}).catch((e) => { notesDb = null; throw e; }));
// One transaction per call; its answer once the transaction has committed.
const notesTx = async (store, mode, f) => {
  const tx = (await notesOpen()).transaction(store, mode);
  const out = f(tx.objectStore(store));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });
  return out;
};
const NOTES_DB = {
  get: (s, k) => notesTx(s, 'readonly', (st) => idbDone(st.get(k))),
  put: (s, k, v) => notesTx(s, 'readwrite', (st) => { st.put(v, k); }),
  del: (s, keys) => notesTx(s, 'readwrite', (st) => { for (const k of keys) st.delete(k); }),
  scan: (s, prefix) => notesTx(s, 'readonly', (st) => {
    const range = prefix ? IDBKeyRange.bound(prefix, `${prefix}\uffff`) : undefined;
    return Promise.all([idbDone(st.getAllKeys(range)), idbDone(st.getAll(range))]).then(([k, v]) => k.map((x, i) => [x, v[i]]));
  }),
  keys: (s, prefix) => notesTx(s, 'readonly', (st) => idbDone(st.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)))),
  estimate: () => navigator.storage?.estimate?.(),
};
BROKER.notesapp = {
  allow: async (m, s) => typeof m.key === 'string' && GZ_NOTES.KEY.test(m.key) && m.key.startsWith(`notesIdx:${(await fromCanvas(s)) || (await fromUltra(s))}/`),
  run: (m, area) => GZ_NOTES.run(m, area, NOTES_DB).catch(() => ({ ok: false, error: 'db' })),
};
let brokerTurn = null;
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const name = typeof m?.type === 'string' && m.type.startsWith('glaze:') ? m.type.slice(6) : '';
  if (!Object.hasOwn(BROKER, name)) return;
  const h = BROKER[name];
  Promise.resolve(h.allow(m, sender)).then((ok) => (ok ? (brokerTurn ||= GZ_CARDS.queue())(() => h.run(m, { sync: brokerArea('sync'), local: brokerArea('local') })) : { ok: false, error: 'sender' }))
    .then(reply, () => reply({ ok: false, error: 'write' }));
  return true;
});

// The command palette's "Glaze settings": a content script can't open the editor itself.
// openOptionsPage reuses an open editor tab; when Chrome refuses it, a new tab (as the popup does).
const openEditor = () => {
  const tab = () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  try { Promise.resolve(chrome.runtime.openOptionsPage()).catch(tab); } catch { tab(); }
};
chrome.runtime.onMessage.addListener((m) => { if (m === 'options') openEditor(); });

// "Use this Look in Glaze" on the gallery (lib/gallery.js): the code waits in storage.local for the editor,
// which previews it and asks. Only from the gallery's own pages, where the manifest runs that script.
// A pattern ending in /* takes that folder and below; any other is that one page.
const GALLERY = chrome.runtime.getManifest().content_scripts.find((c) => c.js.includes('lib/gallery.js'))?.matches || [];
const onGallery = (url) => {
  let here;
  try { const u = new URL(url); here = u.origin + u.pathname; } catch { return false; }
  return GALLERY.some((p) => (p.endsWith('/*') ? here.startsWith(p.slice(0, -1)) : here === p));
};
chrome.runtime.onMessage.addListener((m, { url, frameId }) => {
  const g = m?.gallery;
  if (!g || frameId !== 0 || !onGallery(url)) return;
  const text = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
  // The editor checks the code itself (lib/share.js); this only keeps the sizes sane.
  const offer = { code: text(g.code, 4000), name: text(g.name, 40), author: text(g.author, 39) };
  if (offer.code) chrome.storage.local.set({ galleryOffer: offer }).then(openEditor, console.warn);
});

// Looks history (lib/history.js), whatever changed the theme: the popup, the editor, Ctrl+K on a course page,
// another computer through sync. A burst of edits (a color being dragged) counts once, when it has rested for
// 4 seconds. The theme from before the burst goes in too, so "Previous Look" always has the one that was left.
// Clearing goes through here as well ('clear-history'): it cancels the burst still resting, and its write
// queues behind any recording already under way, so nothing cleared comes back. The next change starts afresh.
let before = null, rest = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !GZ_HISTORY.KEYS.some((k) => k in changes)) return;
  before ||= chrome.storage.sync.get(null).then((now) => ({ ...now, ...Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.oldValue])) }));
  clearTimeout(rest);
  rest = setTimeout(() => {
    // This burst's snapshot goes with its own write: a later burst may start before the queue gets here.
    const left = before;
    before = null;
    serial(async () => {
      const was = await left;
      const [now, { lookHistory }] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get('lookHistory')]);
      const at = Date.now();
      await chrome.storage.local.set({ lookHistory: GZ_HISTORY.add(GZ_HISTORY.add(GZ_HISTORY.entries(lookHistory), was, at), now, at) });
    });
  }, 4000);
});
chrome.runtime.onMessage.addListener((m, { url }) => {
  if (m !== 'clear-history' || !String(url).startsWith(chrome.runtime.getURL(''))) return;
  clearTimeout(rest);
  before = null;
  serial(() => chrome.storage.local.set({ lookHistory: [] }));
});

// Canvas on a school's own domain (canvas.school.edu) can't be matched by address, nor can Moodle anywhere. lib/detect.js
// sees one in the page and asks here ('canvas' or 'moodle'): Glaze goes into that page now, and onto its host for good, so
// the next pages are themed from the first paint as on *.instructure.com. The hosts are also kept in storage.local, a list
// per LMS: not every browser honors persistAcrossSessions, and an update may clear them or change Glaze's file list.
// Each LMS's own first content script: Canvas's is the manifest's for *.instructure.com, Moodle's the same without Canvas's
// part (content-canvas.js). A host on both lists gets Canvas's, which holds all of Moodle's.
const canvasEntry = () => chrome.runtime.getManifest().content_scripts.find((c) => c.matches.includes('https://*.instructure.com/*'));
const glaze = (lms) => canvasEntry().js.filter((f) => lms === 'canvas' || f !== 'content-canvas.js');
const script = (id, lms) => ({ id, matches: [id], js: glaze(lms), runAt: 'document_start', allFrames: true, persistAcrossSessions: true });
// Storage and registration change one at a time: two tabs can report the same host together.
let queue = Promise.resolve();
const serial = (f) => (queue = queue.then(f).catch(console.warn));
const ensure = async () => {
  const { canvas = [], moodle = [] } = await chrome.storage.local.get(['canvas', 'moodle']);
  const have = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const todo = [...new Set([...canvas, ...moodle])].filter((id) => !have.has(id));
  if (todo.length) await chrome.scripting.registerContentScripts(todo.map((id) => script(id, canvas.includes(id) ? 'canvas' : 'moodle')));
  // Gradescope's own pages get Glaze only while Glaze and enhance.gradescope are on (lib/gradescope.js, features/gradescope.js).
  const gs = await gradescopeOn();
  if (gs && !have.has(GRADESCOPE.id)) await chrome.scripting.registerContentScripts([GRADESCOPE]);
  if (!gs && have.has(GRADESCOPE.id)) await chrome.scripting.unregisterContentScripts({ ids: [GRADESCOPE.id] });
  // The notes app's Course notes button (features/notes-home.js) on Canvas sites' course pages, only while Glaze and Notes
  // are on, so the first content script carries nothing for it. Registered afresh each time, for the sites known now.
  // Turned on: course homes already open get it now (notesHomeInto), not at their next load.
  if (have.has(NOTES_HOME)) await chrome.scripting.unregisterContentScripts({ ids: [NOTES_HOME] });
  if (await switchOn('notes')) {
    const s = notesHome(canvas);
    await chrome.scripting.registerContentScripts([s]);
    if (!have.has(NOTES_HOME)) await notesHomeInto(s);
  }
  // Google Calendar sync's page side (features/gcal.js) on Canvas sites' and Blackboard Ultra's top frames, only while
  // connected, so the first content script carries nothing for it. Registered afresh each time, for the sites known now.
  if (have.has(GCAL_PAGE)) await chrome.scripting.unregisterContentScripts({ ids: [GCAL_PAGE] });
  if (GZ_GCAL.ON && (await chrome.storage.local.get('gcal')).gcal?.cal) {
    const first = canvasEntry();
    const ultra = chrome.runtime.getManifest().content_scripts.find((c) => c.matches.includes('https://*/ultra')).matches;
    await chrome.scripting.registerContentScripts([{ id: GCAL_PAGE, js: ['features/gcal.js'], runAt: 'document_idle', persistAcrossSessions: true,
      excludeMatches: first.exclude_matches || [], matches: [...new Set([...first.matches, ...canvas, ...ultra])] }]);
  }
};
const GCAL_PAGE = 'gz-gcal';
// The hook into open tabs' top frames on its own sites' course pages (or the tabs named), never an excluded host; it checks
// the path and the switch itself.
const notesHomeInto = async (s, tabs) => {
  for (const t of tabs || await Promise.resolve().then(() => chrome.tabs.query({ url: s.matches })).catch(() => [])) {
    if (s.excludeMatches.some((p) => String(t.url).startsWith(p.slice(0, -1)))) continue;
    await chrome.scripting.executeScript({ target: { tabId: t.id, frameIds: [0] }, files: s.js }).catch(() => {});
  }
};
const NOTES_HOME = 'gz-notes-home';
const notesHome = (canvas) => {
  const first = canvasEntry();
  return { id: NOTES_HOME, js: ['features/notes-home.js'], runAt: 'document_idle', persistAcrossSessions: true, excludeMatches: first.exclude_matches || [],
    matches: [...new Set([...first.matches, ...canvas].map((p) => p.replace(/\/\*$/, '/courses/*')))] };
};
const GRADESCOPE = { id: 'gz-gradescope', matches: ['https://www.gradescope.com/*'], js: ['lib/i18n.js', 'lib/gradescope.js', 'features/gradescope.js'], runAt: 'document_idle', persistAcrossSessions: true };
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && (changes.enhance || changes.enabled)) serial(ensure); });
chrome.runtime.onInstalled.addListener(() => serial(async () => { await chrome.scripting.unregisterContentScripts(); await ensure(); }));
chrome.runtime.onStartup.addListener(() => serial(ensure));
// An Ultra site found (content-ultra.js, once Glaze has started on a page it found to be Ultra): its top frame's origin is
// kept, so its pages may write their own site's data (fromUltra).
chrome.runtime.onMessage.addListener((m, s) => {
  const o = m?.type === 'glaze:ultra' && s.frameId === 0 && ultraAt(s);
  if (o) serial(async () => { const { ultra = [] } = await chrome.storage.local.get('ultra'); if (!ultra.includes(o)) await chrome.storage.local.set({ ultra: [...ultra, o] }); });
});
chrome.runtime.onMessage.addListener((m, { tab, frameId, url }) => {
  if ((m !== 'canvas' && m !== 'moodle') || frameId !== 0 || !tab) return;
  // The page lacks Glaze (the detector checked), so inject whatever the host's registration says.
  const first = chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: glaze(m), injectImmediately: true }).catch(console.warn);
  const { protocol, hostname } = new URL(url);
  const id = `${protocol}//${hostname}/*`;
  serial(async () => {
    const { [m]: hosts = [] } = await chrome.storage.local.get(m);
    if (!hosts.includes(id)) await chrome.storage.local.set({ [m]: [...hosts, id] });
    await ensure();
    // A Canvas page found this way gets the notes hook now too (registration covers its next pages), after Glaze is in.
    if (m === 'canvas' && await switchOn('notes')) { await first; await notesHomeInto(notesHome([id]), [tab]); }
  });
});

// Glaze's reader (reader.html, W23) reads a PDF or picture only with a one-use pass that an import's content script got
// here first, for the reader frame it then opens in its own tab ('job'); the reader redeems it ('claim'). A site that
// frames the reader itself can't get one, since web pages can't message this worker, so it can't set the reader to
// work. A pass is a random id, lasts a minute and works once, and only for a reader in the tab that asked for it.
const readerPasses = new Map(); // pass → { tab, at }
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:reader') return;
  const now = Date.now();
  for (const [k, v] of readerPasses) if (now - v.at > 60000) readerPasses.delete(k);
  const pass = typeof m.pass === 'string' && /^[\w-]{32,64}$/.test(m.pass) ? m.pass : '';
  let from = null;
  try { from = new URL(s.url); } catch { /* no address */ }
  let ok = false;
  if (pass && s.id === chrome.runtime.id && s.tab && from) {
    if (m.op === 'job' && /^https?:$/.test(from.protocol) && readerPasses.size < 50) {
      readerPasses.set(pass, { tab: s.tab.id, at: now });
      ok = true;
    } else if (m.op === 'claim' && from.protocol === new URL(chrome.runtime.getURL('')).protocol && from.pathname === '/reader.html') {
      ok = readerPasses.get(pass)?.tab === s.tab.id;
      readerPasses.delete(pass);
    }
  }
  reply({ ok });
});

// Code on demand (content.js need()): a file the first content script leaves out runs in the frame that asks, when
// it asks (a site's part too, where its host was registered for the other LMS). Only these files, and only into a
// frame of a tab Glaze already runs in (Chrome reports which).
const SAFARI = new URL(chrome.runtime.getURL('')).protocol === 'safari-web-extension:';
const LOADABLE = new Set(['content-ultra.js', 'content-canvas.js', 'features/nav.js', 'lib/zip.js', 'lib/drafts.js', 'lib/gradecalc.js', 'features/grades.js', 'features/schedule.js', 'lib/todo.js', 'features/todo.js', 'i18n/de.js', 'i18n/es.js', 'i18n/fr.js', 'i18n/nl.js', 'i18n/pt-BR.js', 'lib/cards.js', 'features/cards.js', 'features/cardtasks.js', 'lib/moodle.js', 'features/moodle.js', 'lib/seek.js', 'features/search.js', 'lib/remind.js', 'features/reminders.js', 'features/palette.js', 'features/keys.js', 'features/coursemenu.js', 'features/previews.js', 'features/download.js', 'lib/widgets.js', 'features/widgets.js', 'lib/lookx.js', 'features/lookx.js', 'features/drafts.js', 'features/whatif.js', 'features/docs.js', 'features/place.js', 'lib/gradescope.js', 'lib/ics.js', 'lib/calexport.js', 'features/calexport.js', 'lib/gpa.js', 'lib/doctext.js', 'features/import.js', 'features/gpaterms.js', 'lib/syllabus.js', 'features/syllabus.js', 'lib/classes.js', 'features/classes.js', 'lib/insights.js', 'features/insights.js', 'lib/notes.js', 'features/notes.js', 'lib/ultra.js']);
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.type !== 'glaze:load') return;
  const files = Array.isArray(m.files) ? m.files : [];
  if (sender.id !== chrome.runtime.id || !sender.tab || !Number.isInteger(sender.frameId) || !files.length || !files.every((f) => LOADABLE.has(f))) {
    reply({ ok: false, error: 'not loadable' });
    return;
  }
  // The document that asked, where the browser names it (Chrome): one that has since navigated away gets nothing.
  // Without a documentId, the frame, after asking it whether it still holds the document that asked (content.js's
  // docId, in Glaze's own world there). A navigation between that answer and the injection is not caught.
  const target = sender.documentId ? { tabId: sender.tab.id, documentIds: [sender.documentId] } : { tabId: sender.tab.id, frameIds: [sender.frameId] };
  const same = sender.documentId ? Promise.resolve(true)
    : chrome.scripting.executeScript({ target, func: (doc) => globalThis.__gzDoc === doc, args: [String(m.doc)] }).then((r) => r?.[0]?.result !== false);
  same.then((yes) => {
    if (!yes) throw new Error('the frame holds another document now');
    return chrome.scripting.executeScript({ target, files, injectImmediately: true });
  }).then((results) => {
    // Every loadable file ends on a value (its module, its catalogue); a file that threw leaves none. Safari's results
    // for injected files aren't measured here, so there content.js's own check (is the module there?) decides.
    const r = results?.[0];
    if (r?.error) throw new Error(r.error.message || String(r.error));
    if (!SAFARI && r?.result == null) throw new Error('did not finish');
    reply({ ok: true });
  }).catch((e) => reply({ ok: false, error: String(e?.message || e) }));
  return true; // the reply comes once the files have run
});

// A Gradescope course page for a Canvas or Ultra page (lib/gradescope.js refresh, todo.gsDaily): a content script there can't
// read gradescope.com, so the worker GETs it with the student's own Gradescope session and hands back the page, which the
// Canvas page reads (a worker has no DOMParser) and keeps through 'glaze:gradescope'. Only for a course that goes to one
// of that page's site's courses, only for a Canvas account of that site that said yes to the Gradescope account kept (the
// page reads the account page fetched with it and keeps the rows only if it's still that account), only with Glaze, its
// Gradescope switch and the daily switch on (asked again before each request), and at most once a day per course, tried or not
// (gsTried, so a signed-out student isn't asked again on every page). A redirect (Gradescope sends a signed-out student
// to its sign-in page) is never followed and is no answer.
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:gradescope-page' || typeof m.gid !== 'string') return;
  (async () => {
    const to = await gradescopeFor(m.gid, s);
    const site = (await fromCanvas(s)) || (await fromUltra(s));
    const acct = GZ_GRADESCOPE.clean((await chrome.storage.local.get(GZ_GRADESCOPE.KEY))[GZ_GRADESCOPE.KEY]).acct?.id;
    // Everything this read rests on, asked again before and after each request: the switches, this Canvas account's
    // yes, for the Gradescope account kept when it started, and the course still placed with the same Canvas course.
    const allowed = async () => {
      if (!await gradescopeOn() || !GZ_SANITIZE({ todo: (await chrome.storage.sync.get('todo')).todo }).todo.gsDaily) return false;
      const r = GZ_GRADESCOPE.clean((await chrome.storage.local.get(GZ_GRADESCOPE.KEY))[GZ_GRADESCOPE.KEY]);
      const b = r.bind[m.key];
      return !!acct && r.acct?.id === acct && b?.show === true && b.id === acct && r.map[m.gid]?.to === to;
    };
    const yes = typeof m.key === 'string' && !!site && m.key.startsWith(`${site}/`);
    if (!to || !yes || !await allowed()) return { ok: false, error: 'sender' };
    const due = await (brokerTurn ||= GZ_CARDS.queue())(async () => {
      const now = Date.now();
      const { gradescope, gsTried = {} } = await chrome.storage.local.get([GZ_GRADESCOPE.KEY, 'gsTried']);
      if (now - Math.max(GZ_GRADESCOPE.clean(gradescope).courses[m.gid]?.at || 0, gsTried[m.gid] || 0) < GZ_GRADESCOPE.DAY) return false;
      await chrome.storage.local.set({ gsTried: { ...Object.fromEntries(Object.entries(gsTried).filter(([, at]) => now - at < GZ_GRADESCOPE.DAY)), [m.gid]: now } });
      return true;
    });
    if (!due) return { ok: false, error: 'soon' };
    // Two GETs, the course page and the account page (whose they are), each only while all of it still holds. A
    // redirect (signed out: to the sign-in page) is refused before a second request is made; it counts as tried.
    const get = async (path) => {
      if (!await allowed()) throw new Error('off');
      const url = `${GZ_GRADESCOPE.HOST}${path}`;
      const r = await fetch(url, { credentials: 'include', redirect: 'error', cache: 'no-store' }).catch(() => null);
      if (!r?.ok || r.url.replace(/\/$/, '') !== url) throw new Error('signed out');
      const text = await r.text();
      if (text.length > 4e6) throw new Error('size');
      if (!await allowed()) throw new Error('off'); // turned off, or the yes taken back, while it was under way
      return text;
    };
    try {
      const html = await get(`/courses/${m.gid}`);
      return { ok: true, html, account: await get('/account/edit'), to };
    } catch (e) { return { ok: false, error: e.message }; }
  })().then(reply, () => reply({ ok: false, error: 'network' }));
  return true;
});

// Google Calendar sync (lib/gcal.js; Chrome only, with the optional identity permission granted on the editor's Connect).
// The editor connects (a new Glaze calendar, or another device's by its link code), clears an error after signing in
// again, or disconnects; a Canvas page (features/gcal.js) hands over its events for its own site's account. One
// operation at a time, in a queue of its own: a run talks to Google for a while, and the storage broker's queue mustn't
// wait on it. Disconnect stops a run under way. State: storage.local gcal (the calendar, its account's label, gen, the
// last run per Canvas account, the last error) and gcalSync (lib/gcal.js fresh()), both for one connection (gen): a run
// keeps what it learned only while that connection stands. Plans moved in Google reach Better To Do's data through the
// broker's queue, each only while the plan there is what Glaze last wrote (lib/gcal.js still).
const gcalEnv = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
  // Chrome's cached token, never a prompt (the editor's click asks); none without the calendar scope.
  token: async () => {
    const r = await chrome.identity.getAuthToken({ interactive: false });
    if (Array.isArray(r?.grantedScopes) && !r.grantedScopes.includes(GZ_GCAL.SCOPE)) throw new GZ_GCAL.Fail('auth');
    return typeof r === 'string' ? r : r?.token;
  },
  drop: (token) => Promise.resolve().then(() => chrome.identity.removeCachedAuthToken({ token })).catch(() => {}),
};
// gcalEpoch: Disconnect moves it on as it arrives, so every sync already running or waiting in the queue stops at its
// next step, before Disconnect revokes anything.
let gcalQueue = Promise.resolve(), gcalStop = null, gcalEpoch = 0;
// What a run rests on, by area. A change to any of them heard while a guard reads stops the run, even if the read was
// served before the change: the guard nearest each side effect then acts on nothing older than what it has heard.
const GCAL_WATCH = { sync: ['enabled', 'enhance', 'todo'], local: ['gcal', 'gradescope'] };
const gcalRuns = new Set();
chrome.storage.onChanged.addListener((c, area) => {
  if (GCAL_WATCH[area]?.some((k) => k in c)) for (const run of gcalRuns) run.heard = true;
});
const gcalTurn = (f) => { const p = gcalQueue.then(f); gcalQueue = p.catch(() => {}); return p; };
const gcalState = async () => (await chrome.storage.local.get('gcal')).gcal;
const gcalOps = {
  connect: async (m) => {
    if ((await gcalState())?.cal) return { ok: false, error: 'connected' };
    const c = m.code ? await GZ_GCAL.link(gcalEnv, m.code) : await GZ_GCAL.connect(gcalEnv, typeof m.tz === 'string' && GZ_TODO.zone(m.tz) ? m.tz : undefined);
    const gen = crypto.randomUUID();
    await chrome.storage.local.set({ gcal: { gen, cal: c.cal, owner: c.owner, at: Date.now(), last: {}, error: '' }, gcalSync: { gen, ...GZ_GCAL.fresh() } });
    serial(ensure);
    return { ok: true };
  },
  retry: async () => {
    const g = await gcalState();
    if (g?.cal) await chrome.storage.local.set({ gcal: { ...g, error: '' } });
    return { ok: !!g?.cal };
  },
  // drop: also delete the Glaze calendar; if that fails, nothing changes. Then the grant is revoked, Chrome forgets its
  // tokens and Glaze its state. → revoked: whether Google confirmed (false with no token to revoke: had).
  disconnect: async (m) => {
    const g = await gcalState();
    if (m.drop === true && g?.cal) await GZ_GCAL.remove(gcalEnv, g.cal);
    const token = await gcalEnv.token().catch(() => null);
    const revoked = !!token && await GZ_GCAL.revoke(gcalEnv, token);
    await Promise.resolve().then(() => chrome.identity.clearAllCachedAuthTokens()).catch(() => {});
    await chrome.storage.local.remove(['gcal', 'gcalSync']);
    serial(ensure);
    return { ok: true, revoked, had: !!token };
  },
  // epoch: gcalEpoch when the page's message arrived. A run goes on only while everything its events were composed under
  // still holds (lib/calexport.js consent: Glaze's switch, the export's choices, the Gradescope switch and this account's
  // answer), the build switch is on, the connection is the one it started on and no Disconnect has come since. act() is
  // the guard nearest each side effect, each request to Google and each write here: one read of all of it (and of the
  // keys the write needs), then the check, then the request or write issued with nothing awaited in between. A failed
  // read, or a change to any of it heard while the read was on its way, counts as no. Once it doesn't hold, nothing more
  // of the batch goes: the page composes a new one. What can't be guarded: a change landing after the read is answered
  // reaches the request already sent (Google has it; it can't be recalled), and the next guard stops the run.
  sync: async (m, epoch) => {
    if (epoch !== gcalEpoch) return { ok: false, error: 'stopped' };
    const run = { heard: false };
    gcalRuns.add(run);
    try {
      const read = (keys = []) => Promise.all([chrome.storage.local.get(['gcal', 'gradescope', ...keys]), chrome.storage.sync.get(GCAL_WATCH.sync)]);
      const [l0, s0] = await read().catch(() => []);
      const g = l0?.gcal;
      if (!g?.cal || !s0 || !GZ_SANITIZE(s0).enabled) return { ok: false, error: 'off' };
      if (g.error === 'missing' || g.error === 'denied') return { ok: false, error: g.error };
      const holds = ([l, s]) => {
        const z = GZ_SANITIZE(s);
        return epoch === gcalEpoch && GZ_GCAL.ON && z.enabled && l.gcal?.gen === g.gen && GZ_CALEXPORT.consent(z, z.todo, l.gradescope, m.src) === m.consent;
      };
      if (!holds([l0, s0])) return { ok: false, error: 'stopped' };
      const act = async (f, keys) => {
        run.heard = false;
        const v = await read(keys).catch(() => null);
        if (!v || run.heard || !holds(v)) throw new GZ_GCAL.Fail('stopped');
        return f(v[0]);
      };
      const { gcalSync } = await chrome.storage.local.get('gcalSync');
      const st = GZ_GCAL.fresh(gcalSync?.gen === g.gen ? gcalSync : null);
      const ctl = gcalStop = new AbortController();
      const keep = (patch) => act((l) => chrome.storage.local.set(patch(l.gcal)));
      const key = `todo:${m.src}`;
      // In the broker's queue, with Better To Do's other writes (which all go through it): the plans as stored, checked
      // and changed in one turn, written with nothing awaited after the check. → whether the write was kept.
      const plans = (edits) => (brokerTurn ||= GZ_CARDS.queue())(() => {
        const keys = [...new Set(edits.map((x) => `todo:${x.was.s}`))].filter((k) => GZ_TODO.STORE_KEY.test(k));
        return act((l) => {
          const patch = {};
          for (const k of keys) {
            const d = GZ_TODO.clean(l[k]);
            const list = GZ_GCAL.still(d, edits.filter((x) => `todo:${x.was.s}` === k));
            for (const e of list) GZ_TODO.edit(d, e);
            if (list.length) patch[k] = GZ_TODO.clean(d);
          }
          return Object.keys(patch).length ? brokerArea('local').set(patch) : true;
        }, keys);
      });
      const mine = async () => GZ_TODO.clean((await chrome.storage.local.get(key))[key]);
      let out;
      try {
        const r = await GZ_GCAL.sync({ ...gcalEnv, act }, g.cal, st, m, { signal: ctl.signal, plans, mine, save: () => keep(() => ({ gcalSync: { gen: g.gen, ...st } })) });
        out = { ok: true, wrote: r.wrote, more: r.more };
      } catch (e) { out = { ok: false, error: e?.code || 'network' }; }
      if (gcalStop === ctl) gcalStop = null;
      if (out.error === 'stopped') return out;
      // When each account last ran (features/gcal.js waits 15 minutes from it), and how the run ended, for the editor.
      await keep((now) => ({ gcal: { ...now, last: { ...Object.fromEntries(Object.entries(now.last || {}).slice(-19)), [m.src]: Date.now() }, error: out.ok ? '' : out.error } })).catch(() => {});
      return out;
    } finally { gcalRuns.delete(run); }
  },
};
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:gcal' || typeof m.op !== 'string' || !Object.hasOwn(gcalOps, m.op)) return;
  const epoch = gcalEpoch;
  (async () => {
    if (!GZ_GCAL.ON) return { ok: false, error: 'off' }; // the build-time switch (lib/gcal.js)
    if (m.op === 'sync') {
      // A Canvas or Ultra page, for an account of its own site, with its range's start and the events it worked out.
      const site = (await fromCanvas(s)) || (await fromUltra(s));
      const src = typeof m.src === 'string' && m.src.slice(0, m.src.lastIndexOf('/'));
      if (!site || src !== site || !GZ_TODO.STORE_KEY.test(`todo:${m.src}`) || !Number.isFinite(m.from) || !/^\d{4}-\d{2}-\d{2}$/.test(m.first) || !Array.isArray(m.events)
        || typeof m.consent !== 'string' || m.consent.length > 4000) return { ok: false, error: 'sender' };
    } else if (!fromEditor(s)) return { ok: false, error: 'sender' };
    else if (m.op === 'disconnect') { gcalEpoch++; gcalStop?.abort(); }
    return gcalTurn(() => gcalOps[m.op](m, epoch));
  })().then(reply, (e) => reply({ ok: false, error: e?.code || 'network' }));
  return true;
});

// Safari wakes its containing app for a silent update check; Chrome never enters this gate.
if (new URL(chrome.runtime.getURL('')).protocol === 'safari-web-extension:') {
  (async () => {
    const now = Date.now();
    const { safariUpdateCheckAt = 0 } = await chrome.storage.local.get('safariUpdateCheckAt');
    if (now - safariUpdateCheckAt < 24 * 60 * 60 * 1000) return;
    // Record the attempt first, so native or network failures cannot cause repeated wakeups.
    await chrome.storage.local.set({ safariUpdateCheckAt: now });
    await chrome.runtime.sendNativeMessage('io.frostdev.Glaze', { type: 'check-updates' });
  })().catch(() => {});
}

// Signed URLs come only from the active content script's Canvas API; bytes never pass through the page.
// Acknowledgements bound Chrome's JSON message queue; disconnect aborts both fetch and reader.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'canvas-zip') return;
  let origin;
  try {
    if (!GZ_DOWNLOAD.sender(port.sender, chrome.runtime.id)) return port.disconnect();
    origin = new URL(port.sender.url);
  } catch { return port.disconnect(); }
  // Production has HTTPS hosts only. The explicit localhost permission exists only in scratch builds.
  const dev = origin.hostname === 'localhost' && chrome.runtime.getManifest().host_permissions.includes('http://localhost/*') ? origin.origin : '';
  if (!GZ_DOWNLOAD.url(origin.href, dev)) return port.disconnect();
  const ready = chrome.storage.local.get('canvas').then(({ canvas = [] }) => {
    return !!dev || origin.hostname === 'instructure.com' || origin.hostname.endsWith('.instructure.com') || canvas.includes(`${origin.protocol}//${origin.hostname}/*`);
  }).catch(() => false);
  const ctl = new AbortController();
  let used = 0, busy = false, ack = null, stall = 0;
  // An idle connection is not a download: fail a stalled fetch/stream after 45 seconds.
  const fresh = () => { clearTimeout(stall); stall = setTimeout(() => { ctl.abort(); ack?.(); port.disconnect(); }, 45000); };
  const send = (m) => { if (!ctl.signal.aborted) port.postMessage(m); };
  port.onDisconnect.addListener(() => { clearTimeout(stall); ctl.abort(); ack?.(); });
  port.onMessage.addListener((m) => {
    if (m?.type === 'ping') { send({ type: 'ping' }); return; }
    if (m?.type === 'ack') { ack?.(); ack = null; return; }
    if (m?.type !== 'file' || busy) return;
    busy = true;
    (async () => {
      if (!await ready) throw new Error('sender');
      fresh();
      const url = GZ_DOWNLOAD.url(m.url, dev);
      if (!url) throw new Error('url');
      const r = await fetch(url, { credentials: 'omit', redirect: 'follow', cache: 'no-store', signal: ctl.signal });
      if (!r.ok || !GZ_DOWNLOAD.url(r.url, dev)) throw new Error('response');
      GZ_DOWNLOAD.bytes(used, Number(r.headers.get('content-length') || 0));
      const reader = r.body?.getReader();
      if (reader) try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          fresh();
          used = GZ_DOWNLOAD.bytes(used, value.length);
          for (let at = 0; at < value.length; at += 65536) {
            const frame = value.subarray(at, at + 65536);
            let raw = '';
            for (let i = 0; i < frame.length; i += 16384) raw += String.fromCharCode(...frame.subarray(i, i + 16384));
            await new Promise((resolve) => { ack = resolve; send({ type: 'chunk', data: btoa(raw) }); });
            ctl.signal.throwIfAborted();
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
      send({ type: 'done' });
    })().catch((e) => {
      send({ type: 'error', code: ['limit', 'url', 'sender', 'response'].includes(e.message) ? e.message : 'network' });
    }).finally(() => { clearTimeout(stall); busy = false; });
  });
});
