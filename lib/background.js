importScripts('download.js', 'color.js', 'fonts.js', 'surfaces.js', '../defaults.js', 'history.js', 'cards.js', 'nav.js', 'nav-items.js', 'navlayout.js', 'motionx.js', 'parts.js', 'nav-store.js', 'todo.js', 'petbrain.js', 'pet.js', 'petsprites.js', 'remind.js', 'widgets.js', 'sidebar.js', 'lookparts.js', 'share.js', 'lookx.js', 'gradescope.js', 'doctext.js', 'folders.js', 'notes.js', 'calexport.js', 'gcal.js', 'coursetabs.js');

// Cache packaged broker scripts at install; parse them on first use rather than every worker wake.
const BROKER_FILES = {
  classes: ['classes.js'], syllabus: ['classes.js', 'syllabus.js'],
  gpa: ['gradecalc.js'], whatif: ['gradecalc.js'], gpaterms: ['gradecalc.js', 'gpa.js'],
  insights: ['gradecalc.js', 'insights.js'], pet: ['gradecalc.js', 'insights.js'], petSprites: ['media.js'],
};
const brokerFiles = new Set();
const brokerIn = (name) => {
  for (const file of BROKER_FILES[name] || []) if (!brokerFiles.has(file)) { importScripts(file); brokerFiles.add(file); }
};
globalThis.addEventListener?.('install', () => importScripts('gradecalc.js', 'gpa.js', 'insights.js', 'classes.js', 'syllabus.js'));

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
// The sites Glaze runs on: is `u` on an LMS (`kind`: canvas, moodle or ultra) the student approved? Canvas on *.instructure.com
// (the manifest's match) and Ultra on *.blackboard.com are Glaze's from the start. Anywhere else, what a page looks like
// proves nothing (its markup is its own, and any site can serve an /ultra/ address): only the student's yes (features/
// consent.js, 'glaze:consent') puts a site on its LMS's list in storage.local, `canvas` and `moodle` by `https://host/*`,
// `ultra` by origin. The lists are the approvals, so the sites on them before Glaze asked stay approved. Registration, the
// broker's page checks (fromCanvas, fromUltra, fromMoodle), mods and code on demand all ask here; Settings lists and removes them.
const KNOWN = { canvas: (u) => u.hostname === 'instructure.com' || u.hostname.endsWith('.instructure.com'), moodle: () => false, ultra: (u) => u.hostname.endsWith('.blackboard.com') };
const siteKey = (kind, u) => (kind === 'ultra' ? u.origin : `${u.origin}/*`);
const approved = async (kind, u) => {
  if (!/^https?:$/.test(u.protocol)) return false;
  if (kind === 'canvas' && u.hostname === 'localhost' && chrome.runtime.getManifest().host_permissions.includes('http://localhost/*')) return true;
  if (u.protocol !== 'https:') return false;
  if (!u.port && KNOWN[kind](u)) return true;
  const list = await chrome.storage.local.get(kind).then((r) => r[kind], () => null);
  return Array.isArray(list) && list.includes(siteKey(kind, u));
};
const canvasSite = (u) => approved('canvas', u);
const fromCanvas = async (s) => {
  if (s.id !== chrome.runtime.id || !s.tab) return null;
  let u;
  try { u = new URL(addressOf(s)); } catch { return null; }
  return /^https?:$/.test(u.protocol) && await canvasSite(u) ? u.origin : null;
};
// An Ultra page: a content script in a tab on an https address under /ultra (the manifest's Ultra match), on an Ultra site
// the student approved (approved: Blackboard's own hosts, or storage.local `ultra`), by its origin. The address alone isn't
// proof, as a school's own Canvas host isn't (fromCanvas).
// A sender's address. A course tab's frame (features/coursetabs.js) reports about:blank, the address of its first, empty
// document: its own origin, with its tab's page on that origin, stands in.
const addressOf = (s) => (s.frameId > 0 && s.url === 'about:blank' && /^(?:https:\/\/[^/]+|http:\/\/localhost(?::\d+)?)$/.test(s.origin || '') && s.tab?.url?.startsWith(`${s.origin}/`) ? s.tab.url : s.url);
const ultraAt = (s) => {
  if (s.id !== chrome.runtime.id || !s.tab) return null;
  try { const u = new URL(addressOf(s)); return u.protocol === 'https:' && /^\/ultra(\/|$)/.test(u.pathname) ? u.origin : null; } catch { return null; }
};
// A course tab's live frame (features/coursetabs.js) is an Ultra page of its own: a frame of a tab whose page is on the
// same Ultra site counts as that page.
const ultraPage = (s) => s.frameId === 0 || (s.frameId > 0 && !!ultraAt(s) && !!s.tab?.url?.startsWith(`${ultraAt(s)}/`));
const fromUltra = async (s) => {
  const o = ultraAt(s);
  return o && await approved('ultra', new URL(o)) ? o : null;
};
// A page of an approved Moodle, in any frame Glaze is in; its top frame (fromMoodle) may pin its navigation, through the
// same narrow broker edit as Ultra.
const moodleAt = async (s) => {
  if (s.id !== chrome.runtime.id || !s.tab) return null;
  let u;
  try { u = new URL(addressOf(s)); } catch { return null; }
  return await approved('moodle', u) ? u.origin : null;
};
const fromMoodle = (s) => (s.frameId === 0 ? moodleAt(s) : null);
// A page of any site Glaze runs on, in a frame Glaze is in (its top frame, a course tab's): what the student does there
// (the command palette's Look, rotation, opening Settings) and the code it loads. Never a tab where only lib/detect.js runs.
const lmsPage = async (s) => (await fromCanvas(s)) || (await fromUltra(s)) || (await moodleAt(s));
// Glaze's own pages: the popup, the editor and the frames it opens.
const fromGlaze = (s) => s.id === chrome.runtime.id && typeof s.url === 'string' && s.url.startsWith(chrome.runtime.getURL('')) && extensionOrigin(s);
// Gradescope (lib/gradescope.js), with Glaze on (enabled, the master switch) and enhance.gradescope on: its own pages (the
// top frame of a tab on www.gradescope.com: who's signed in, placings, what was read, the bar), a Canvas page (what it read
// for a Gradescope course placed with one of its own site's courses, and its own accounts' answer to "show it here?"),
// and the editor.
const switchOn = (k) => Promise.resolve().then(() => chrome.storage.sync.get(['enabled', 'enhance']))
  .then(async (raw) => { const { freshDefaults } = await chrome.storage.local.get('freshDefaults'); const s = GZ_SANITIZE(raw, freshDefaults?.fresh === true); return s.enabled && s.enhance[k]; }).catch(() => false);
const gradescopeOn = () => switchOn('gradescope');
const fromGradescope = (s) => s.id === chrome.runtime.id && !!s.tab && s.frameId === 0 && typeof s.url === 'string' && s.url.startsWith(`${GZ_GRADESCOPE.HOST}/`);
const gradescopeFor = async (gid, s) => {
  const site = await fromCanvas(s), ultra = await fromUltra(s);
  const { gradescope } = await chrome.storage.local.get(GZ_GRADESCOPE.KEY);
  const to = GZ_GRADESCOPE.clean(gradescope).map[gid]?.to;
  return (site && to?.startsWith(`canvas:${site}/`)) || (ultra && to?.startsWith(`ultra:${ultra}/`)) ? to : null;
};
// Frames the worker trusts, by what for. Course tabs and the Settings page of an LMS tab are frames, so a plain "top frame"
// check refuses them:
// - 'settings': Settings in a tab of its own (the top frame), or the Settings frame of an LMS tab that claimed its one-use
//   ticket (glaze:settings-claim). Only the writes that hold no keys or grants ask: Sharing, Mods and Backup are gated in that
//   frame, and the worker keeps them to the editor's own tab.
// - 'download': a course page's top frame, or a course tab's frame of a page on its own site (lib/download.js).
// A claimed frame is remembered by its tab, frame and document in session storage as well (this worker sleeps while Settings
// stays open), until the tab closes. Without a document id (some browsers), the frame in that tab is what is known.
const settingsFrames = new Map(); // tab id -> { frameId, documentId? }
const settingsFrameKey = (tab) => `settingsFrame:${tab}`;
const closedSettingsTabs = new Set(); // only needed while the initial session read is outstanding
let settingsRestoreDone = !chrome.storage?.session;
const settingsFramesLoaded = settingsRestoreDone ? Promise.resolve() : new Promise((resolve) => {
  const finish = () => { settingsRestoreDone = true; closedSettingsTabs.clear(); clearTimeout(timer); resolve(); };
  const timer = setTimeout(finish, 1500); // an unavailable session store cannot stall Settings indefinitely
  Promise.resolve().then(() => chrome.storage.session?.get(null)).then((all) => {
    if (settingsRestoreDone) return;
    for (const [k, f] of Object.entries(all || {})) if (/^settingsFrame:\d+$/.test(k) && !closedSettingsTabs.has(+k.slice(14))
      && !settingsFrames.has(+k.slice(14)) && Number.isInteger(f?.frameId) && f.frameId > 0
      && (f.documentId === undefined || typeof f.documentId === 'string')) settingsFrames.set(+k.slice(14), f);
    finish();
  }, finish);
});
const claimSettingsFrame = async (s) => {
  if (!Number.isInteger(s.frameId) || s.frameId <= 0 || !Number.isInteger(s.tab?.id)
    || (s.origin !== undefined && s.origin !== chrome.runtime.getURL('').replace(/\/$/, ''))) throw Error('sender');
  const f = { frameId: s.frameId, ...(s.documentId && { documentId: s.documentId }), pending: true };
  settingsFrames.set(s.tab.id, f);
  try {
    const { pending, ...saved } = f;
    await chrome.storage.session?.set({ [settingsFrameKey(s.tab.id)]: saved });
    if (settingsFrames.get(s.tab.id) !== f) {
      if (!settingsFrames.has(s.tab.id)) await chrome.storage.session?.remove(settingsFrameKey(s.tab.id));
      throw Error('closed');
    }
    delete f.pending;
  } catch (e) { if (settingsFrames.get(s.tab.id) === f) settingsFrames.delete(s.tab.id); throw e; }
};
const trustedFrame = (s, purpose) => {
  if (purpose === 'download') return GZ_DOWNLOAD.sender(s, chrome.runtime.id);
  if (purpose !== 'settings') return false;
  if (s.frameId === 0) return true;
  if (!Number.isInteger(s.frameId) || !Number.isInteger(s.tab?.id) || !fromEditor(s)) return false;
  if (s.origin !== undefined && s.origin !== chrome.runtime.getURL('').replace(/\/$/, '')) return false; // when the browser says, it must be ours
  const f = settingsFrames.get(s.tab.id);
  return !!f && !f.pending && f.frameId === s.frameId && f.documentId === s.documentId;
};
const BROKER = {
  // Look and parts writes share rotation's queue, including a palette that clears the previous Look's parts.
  look: {
    // A setting's key: GZ_DEFAULTS's, or one a library adds to GZ_SPEC after defaults.js (todo, widgets, remind, tabs),
    // which Reset everything sends with the rest.
    allow: async (m, s) => {
      if (!m.patch || typeof m.patch !== 'object' || Array.isArray(m.patch) || Object.keys(m.patch).some((k) => !Object.hasOwn(GZ_DEFAULTS, k) && !Object.hasOwn(GZ_SPEC, k) && k !== 'card')) return false;
      if (m.partKeys !== undefined && (!fromEditor(s) || !Array.isArray(m.partKeys) || !m.partKeys.length || new Set(m.partKeys).size !== m.partKeys.length || m.partKeys.some((k) => !['bg', 'anim', 'fx', 'cursor', 'nav', 'rules'].includes(k)))) return false;
      if (fromEditor(s) || (s.id === chrome.runtime.id && s.url?.split(/[?#]/)[0] === chrome.runtime.getURL('popup.html'))) return true;
      // A page (the command palette's Look): only one of a site Glaze runs on.
      return m.parts === null && Object.keys(m.patch).every((k) => ['version', 'colors', 'preset', 'auto', 'look', 'bg', 'card'].includes(k))
        && !!await lmsPage(s);
    },
    run: async (m, area) => {
      let parts = m.parts == null ? null : GZ_XPARTS.bundle(m.parts);
      const patch = { ...m.patch };
      if (m.parts != null && (!parts || !GZ_XPARTS.same(parts, m.parts))) return { ok: false, error: 'bad' };
      // Builder edits merge in this queue, so another editor's background or motion parts survive.
      if (m.partKeys) {
        const current = await GZ_XPARTS.fromStored((await area.sync.get('lookX')).lookX, area.local);
        if (current === undefined) return { ok: false, error: 'unavailable' };
        const x = { ...current?.x };
        for (const key of m.partKeys) { if (parts?.x && Object.hasOwn(parts.x, key)) x[key] = parts.x[key]; else delete x[key]; }
        parts = { ...(Object.keys(x).length && { x }), ...(current?.m && { m: current.m }) };
        if (!Object.keys(parts).length) parts = null;
      }
      if (Object.hasOwn(patch, 'navbar')) patch.navbar = GZ_SANITIZE({ navbar: { ...(await area.sync.get('navbar')).navbar, ...patch.navbar } }).navbar;
      if (Object.hasOwn(patch, 'nav')) {
        const nav = patch.nav;
        if (!nav || typeof nav !== 'object' || Array.isArray(nav)) return { ok: false, error: 'bad' };
        delete patch.nav;
        const r = await GZ_NAV_STORE.change({ nav }, { ...area, sync: { ...area.sync,
          set: (navPatch) => GZ_XPARTS.write(area, parts, { ...patch, ...navPatch }) } });
        return r.ok ? { ok: true } : r;
      }
      return { ok: await GZ_XPARTS.write(area, parts, patch) };
    },
  },
  courseName: {
    allow: (m, s) => fromEditor(s) && trustedFrame(s, 'settings') && s.origin === chrome.runtime.getURL('').replace(/\/$/, '')
      && /^_\d+_\d+$/.test(m.id) && typeof m.name === 'string' && m.name.length <= GZ_NICK_MAX * 2,
    run: async (m, { sync }) => {
      const courses = GZ_SANITIZE(await sync.get('courses')).courses;
      GZ_COURSE_EDIT.name(courses, m.id, m.name);
      if (GZ_SYNC_BYTES('courses', courses) > GZ_SYNC_ITEM_MAX) return { ok: false };
      return { ok: await sync.set({ courses }), courses };
    },
  },
  widgetTimer: {
    allow: async (m, s) => ['toggle', 'reset', 'advance'].includes(m.op) && (fromEditor(s) || (s.frameId === 0 && !!await fromCanvas(s)) || (ultraPage(s) && !!await fromUltra(s))) && (await chrome.storage.sync.get('enabled')).enabled !== false,
    run: (m, area) => GZ_NAV_STORE.timer(m.op, area),
  },
  folders: {
    allow: async (m, s) => typeof m.key === 'string' && GZ_FOLDERS.KEY.test(m.key) && ((ultraPage(s) && m.key.startsWith(`hiddenFolders:${await fromUltra(s)}/_`))
      || m.key.startsWith(`hiddenFolders:${await fromCanvas(s)}/`) && /\/\d+\/\d+$/.test(m.key)) && await switchOn('hideFolders'),
    run: (m, area) => GZ_FOLDERS.change(m, area),
  },
  pet: {
    allow: async (m, s) => typeof m.key === 'string' && GZ_PET.KEY.test(m.key) && m.key.startsWith(`pet:${(await fromCanvas(s)) || (await fromUltra(s))}/`) && await switchOn('pet'),
    run: (m, area) => GZ_PET.change(m, area),
  },
  petSprites: {
    allow: async (m, s) => (fromEditor(s) && trustedFrame(s, 'settings') && s.origin === chrome.runtime.getURL('').replace(/\/$/, '')) || (['list', 'get'].includes(m.op) && typeof m.key === 'string' && GZ_PET.KEY.test(m.key)
      && m.key.startsWith(`pet:${(await fromCanvas(s)) || (await fromUltra(s))}/`) && await switchOn('pet')),
    run: (m, area) => GZ_PET_SPRITES.change(m, area),
  },
  gradescope: {
    allow: async (m, s) => fromEditor(s) || (await gradescopeOn() && ((fromGradescope(s) && m.op !== 'bind')
      || (m.op === 'rows' && !!await gradescopeFor(m.gid, s)) || (m.op === 'bind' && typeof m.key === 'string' && m.key.startsWith(`${(await fromCanvas(s)) || (await fromUltra(s))}/`)))),
    run: (m, area) => GZ_GRADESCOPE.change(m, area),
  },
  // Course cards (lib/cards.js change). A Canvas page saves one course of its own site; the editor does the rest.
  cards: {
    allow: async (m, s) => fromEditor(s) || (!!m.key && !m.ultra && !m.nav && !m.set && !m.replace && !m.reset && GZ_CARDS.KEY.test(m.key) && (m.key.startsWith(`canvas:${await fromCanvas(s)}/`) || (m.key.startsWith(`ultra:${await fromUltra(s)}/`) && s.frameId === 0))),
    run: (m, area) => m.ultra || m.key?.startsWith('ultra:') ? GZ_CARDS.ultraChange(m, area) : m.nav ? GZ_NAV_STORE.change(m, area) : GZ_CARDS.change(m, area),
  },
  // Canvas's native rail: the editor may upload a picture; a Canvas command changes settings only.
  nav: {
    allow: async (m, s) => !!m.nav && typeof m.nav === 'object' && !Array.isArray(m.nav)
      && (fromEditor(s) || (!m.image && !m.logoImage && !m.items && !m.nav.i && !m.nav.li && !!await fromCanvas(s))),
    run: (m, area) => GZ_NAV_STORE.change({ nav: m.nav, image: m.image, logoImage: m.logoImage, items: m.items }, area),
  },
  // Glaze's own navigation bar (lib/navbar.js): a Canvas, Ultra or Moodle page pins its rail; the editor changes only its edited fields.
  navbar: {
    allow: async (m, s) => {
      if (!m.patch || typeof m.patch !== 'object' || Array.isArray(m.patch) || !Object.keys(m.patch).length) return false;
      if (fromEditor(s)) { const n = GZ_SANITIZE({ navbar: m.patch }).navbar; return Object.keys(m.patch).every((k) => Object.hasOwn(n, k) && n[k] === m.patch[k]); }
      return Object.keys(m.patch).length === 1 && ['open', 'icons'].includes(m.patch.rail) && s.frameId === 0 && (!!await fromUltra(s) || !!await fromCanvas(s) || !!await fromMoodle(s));
    },
    run: async (m, { sync }) => {
      const navbar = GZ_SANITIZE({ navbar: { ...(await sync.get('navbar')).navbar, ...m.patch } }).navbar;
      return { ok: await sync.set({ navbar }) };
    },
  },
  // Better To Do's own data (lib/todo.js change). A Canvas or Ultra page edits its own site's accounts' lists; only the
  // editor restores a backup.
  todo: {
    allow: async (m, s) => (fromEditor(s) ? !!m.restore && m.key === undefined && s.frameId === 0
      : !m.restore && typeof m.key === 'string' && GZ_TODO.STORE_KEY.test(m.key) && m.key.startsWith(`todo:${(await fromCanvas(s)) || (await fromUltra(s))}/`)),
    run: async (m, area) => {
      // A Canvas planner answer brings its site's due list (lib/todo.js publishIn): kept per site, as content.js keeps it.
      let target = { ...area, local: { ...area.local, set: (patch) => area.local.set(dueBySite(patch)) } };
      const pets = m.restore?.pets === undefined ? {} : GZ_PET.backup(m.restore.pets);
      if (!pets) return { ok: false, error: 'bad' };
      const taskKeys = Object.keys(m.restore?.tasks || {}).filter((key) => GZ_TODO.STORE_KEY.test(key));
      const petKeys = [...new Set([...Object.keys(pets), ...taskKeys.map((key) => `pet:${key.slice(5)}`)])];
      if (petKeys.length) {
        const existing = await area.local.get([...petKeys, ...taskKeys]);
        for (const key of petKeys) {
          if (!existing[key] && !pets[key]) continue;
          const tk = `todo:${key.slice(4)}`;
          pets[key] = GZ_PET.merge(existing[key], pets[key] ?? existing[key], Object.hasOwn(m.restore.tasks || {}, tk) ? { before: existing[tk], after: m.restore.tasks[tk] } : null);
          if (!pets[key]) return { ok: false, error: 'history' };
        }
      }
      if (m.restore) {
        const parts = m.restore.parts == null ? null : GZ_XPARTS.bundle(m.restore.parts);
        if (m.restore.parts != null && (!parts || !GZ_XPARTS.same(parts, m.restore.parts))) return { ok: false, error: 'bad' };
        // Keep the existing task rollback, with the Look and its parts committed by the same sync.set.
        target = { ...area, sync: { ...area.sync, set: (patch) => GZ_XPARTS.write(area, parts, patch) } };
      }
      const r = await (m.restore ? GZ_FOLDERS.restore(m.restore, target, GZ_TODO, pets) : GZ_TODO.change(m, target));
      if (r.ok && m.restore && !await area.local.set({ freshDefaults: { fresh: false, pending: false } })) return { ...r, cleanup: false };
      return r.ok && m.restore && !await GZ_NAV_STORE.cleanup(area) ? { ...r, cleanup: false } : r;
    },
  },
  // Dashboard notes (lib/widgets.js saveNote): a Canvas or Ultra page writes its own site's accounts' notes; the newest typing wins.
  notes: {
    allow: async (m, s) => typeof m.key === 'string' && GZ_WIDGETS.NOTES_KEY.test(m.key) && m.key.startsWith(`notes:${(await fromCanvas(s)) || (await fromUltra(s))}/`),
    run: (m, { local }) => GZ_WIDGETS.saveNote(m, local),
  },
  // Where you were in a course (lib/widgets.js placeChange, features/place.js): the top frame of a Canvas page, or an Ultra
  // page, changes its own site's courses. Each tab's change is applied to what is stored when its turn comes, so two tabs
  // scrolling different courses keep both.
  place: {
    allow: async (m, s) => {
      if (typeof m.cid !== 'string' || m.cid.length > 200 || !GZ_WIDGETS.PLACE_CID.test(m.cid)) return false;
      const canvas = m.cid.startsWith('canvas:');
      const site = canvas ? s.frameId === 0 && (await fromCanvas(s)) : ultraPage(s) && (await fromUltra(s));
      return !!site && (!canvas || m.cid.startsWith(`canvas:${site}/`)) && await switchOn('place');
    },
    run: (m, { local }) => GZ_WIDGETS.placeChange(m, local),
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
  // What-if scores on Canvas and Ultra (lib/gradecalc.js applyWhatIf): a page changes its own site's records only. Every tab's
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
      try { return m.key.length < 2100 && GZ_LX.PAGE_KEY.test(m.key) && m.key.startsWith(`stk:${new URL(addressOf(s)).origin}/`); } catch { return false; }
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
    allow: async (m, s) => fromGlaze(s) || !!await lmsPage(s),
    run: async (m, { sync, local }) => {
      const s = GZ_SANITIZE(await sync.get(null));
      const { rotateState, rotateLooks, lookFavorites } = await local.get(['rotateState', 'rotateLooks', 'lookFavorites']);
      const list = GZ_LX.rotation(rotateLooks, GZ_LOOKS.map((L) => L.name), GZ_HISTORY.favorites(lookFavorites).map((f) => f.code));
      const r = GZ_LX.turn(rotateState, Date.now(), s.extras, list, m.now === true);
      if (r.wear >= 0) {
        const L = GZ_LOOKS.find((l) => l.name === list[r.wear]);
        const lookX = (await sync.get('lookX')).lookX;
        // A favorite that no longer decodes is passed over: its turn goes by unworn.
        // Favorites are saved only from the outside-code offer. Recheck old entries that predate its safety limits;
        // the student's own worn Look and history are separate and keep their full editing freedom.
        const got = L ? null : await GZ_SHARE.decode(list[r.wear]).then((g) => GZ_XPARTS.outside(g.parts).length ? null : g).catch(() => null);
        const patch = L ? GZ_LOOK_APPLY(s, L) : got && GZ_LX.wearCode(s, got);
        // Decoding takes a moment, and the editor and popup write outside this queue: if rotation was turned off or
        // changed, or the student changed the theme meanwhile, this turn is dropped rather than worn over their choice.
        if (!L) {
          const now = GZ_SANITIZE(await sync.get(null));
          const { rotateState: st } = await local.get('rotateState');
          const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
          if (!same(now.extras, s.extras) || !same(st, rotateState) || !same(GZ_HISTORY.theme(now), GZ_HISTORY.theme(s)) || !same((await sync.get('lookX')).lookX, lookX)) return { ok: false, error: 'changed' };
        }
        // The Look's parts go in with it, in the same write: a built-in Look has none, and a code brings its own or none.
        if (patch && !await GZ_XPARTS.write({ sync, local }, got?.parts || null, { version: 2, ...patch })) return { ok: false };
        if (!patch) r.state.turned = false;
      }
      return { ok: r.state === rotateState || await local.set({ rotateState: r.state }) };
    },
  },
  // What a syllabus said (lib/syllabus.js tidy), per Canvas or Ultra site, user and course: a page keeps or deletes its own
  // site's.
  syllabus: {
    allow: async (m, s) => typeof m.key === 'string' && GZ_SYLLABUS.KEY.test(m.key) && m.key.startsWith(`syllabus:${(await fromCanvas(s)) || (await fromUltra(s))}/`),
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
  // courses, from two tabs, both stay. A Canvas page sets its own site's canvas: courses; an Ultra page, its ultra: ones.
  gpa: {
    allow: async (m, s) => {
      const site = await fromCanvas(s);
      const bb = !site && await fromUltra(s);
      const own = site ? `canvas:${site}/` : bb && `ultra:${bb}/`;
      return !!own && typeof m.key === 'string' && m.key.startsWith(own) && !!m.patch && typeof m.patch === 'object';
    },
    run: async (m, { sync }) => {
      const r = GZ_GRADECALC.patchGpa((await sync.get('gpaCourses')).gpaCourses, m.key, m.patch);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: await sync.set({ gpaCourses: r.prefs }), prefs: r.prefs };
    },
  },
  whatif: {
    allow: async (m, s) => {
      const canvas = await fromCanvas(s);
      const site = canvas || (await fromUltra(s));
      const own = site && typeof m.key === 'string' && m.key.startsWith(`whatIf:${site}:`) && /^\w{1,40}$/.test(m.key.slice(`whatIf:${site}:`.length));
      // 'legacy': Glaze 2.2's Ultra scores, from an Ultra page only.
      return !!own && ['course', 'grade', 'clear', ...(canvas ? [] : ['legacy'])].includes(m.op) && Number.isFinite(m.at) && (m.op === 'clear' || /^(\d{1,20}|_\d{1,20}_\d{1,20})$/.test(String(m.cid)));
    },
    run: async (m, { local }) => {
      // Moved and taken out of the old store (whatIf) in one turn of this queue, against the record's last Clear all
      // (lib/gradecalc.js moveLegacy). A read that fails throws, so nothing changes; a write that fails stops there,
      // leaving the old store whole for the next try.
      if (m.op === 'legacy') {
        const got = await local.get([m.key, 'whatIfCleared', 'whatIf']);
        const marks = got.whatIfCleared && typeof got.whatIfCleared === 'object' ? got.whatIfCleared : {};
        const r = GZ_GRADECALC.moveLegacy(m, got[m.key], got.whatIf, marks[m.key] || 0);
        if (r.moved.length && !await local.set({ [m.key]: r.all })) return { ok: false };
        return { ok: await (r.legacy ? local.set({ whatIf: r.legacy }) : local.remove('whatIf')), moved: r.moved };
      }
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
    // The account after the site, and nothing more: a site's own prefix is also the start of the same host on a port.
    allow: async (m, s) => { const site = `gpaTerms:${(await fromCanvas(s)) || (await fromUltra(s))}:`; return typeof m.key === 'string' && GZ_GPA.KEY.test(m.key) && m.key.startsWith(site) && /^\w{1,40}$/.test(m.key.slice(site.length)) && Number.isFinite(m.at); },
    run: async (m, { local }) => {
      const rec = GZ_GPA.change((await local.get(m.key))[m.key], m);
      return rec ? { ok: await local.set({ [m.key]: rec }) } : { ok: false, error: 'stale' };
    },
  },
  // Insights' saved term summary (lib/insights.js change): a page keeps or clears its own site's accounts' record.
  insights: {
    allow: async (m, s) => typeof m.key === 'string' && GZ_INSIGHTS.KEY.test(m.key) && m.key.startsWith(`insights:${(await fromCanvas(s)) || (await fromUltra(s))}/`),
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
// The files kept for Looks' backgrounds (lib/media.js), by hash: their own IndexedDB, which only the worker opens. Pages get a
// file through 'glaze:keptFile'; storage.local keeps only their index.
let mediaDb = null;
const mediaOpen = () => (mediaDb ||= new Promise((res, rej) => {
  const r = indexedDB.open('glaze-media', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('files');
  r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); mediaDb = null; }; res(r.result); };
  r.onerror = () => rej(r.error);
}).catch((e) => { mediaDb = null; throw e; }));
const mediaTx = async (mode, f) => {
  const tx = (await mediaOpen()).transaction('files', mode);
  const out = f(tx.objectStore('files'));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });
  return out;
};
const MEDIA_FILES = {
  get: (h) => mediaTx('readonly', (st) => idbDone(st.get(h))),
  put: (h, v) => mediaTx('readwrite', (st) => { st.put(v, h); }),
  del: (hs) => mediaTx('readwrite', (st) => { for (const h of hs) st.delete(h); }),
  keys: () => mediaTx('readonly', (st) => idbDone(st.getAllKeys())),
};
// The widgets' layout (lib/widgets.js change): a Canvas or Ultra page's changes, applied to what is stored then, so two
// tabs' changes never undo each other (B7b).
BROKER.widgetLayout = {
  allow: async (m, s) => {
    if (!Array.isArray(m.ops) || m.ops.length > 64) return false;
    if (fromEditor(s)) return true;
    const canvas = s.frameId === 0 && (await fromCanvas(s));
    const site = canvas || (ultraPage(s) && (await fromUltra(s)));
    if (!site || (await chrome.storage.sync.get('enabled')).enabled === false) return false;
    if (m.fill !== undefined && (s.frameId !== 0 || m.fill !== (canvas ? 'cdash' : 'dash') || m.ops.some((o) => o?.s !== m.fill))) return false;
    // Course cards: only the page's own site's, Canvas's on its Dashboard, Ultra's on its two boards.
    const courses = m.ops.filter((o) => typeof o?.id === 'string' && o.id.startsWith('course:'));
    return !courses.length || (s.frameId === 0 && (canvas || site === await fromUltra(s)) && courses.every((o) => {
      const c = GZ_WIDGETS.course(o.id);
      return c?.origin === site && c.canvas === !!canvas && (canvas ? o.s === 'cdash' : ['courses', 'dash'].includes(o.s));
    }));
  },
  run: async (m, area) => {
    const before = await area.local.get(['widgetLayout', 'freshDefaults', 'earlyWidgetEdits', 'starterTouched']);
    // A content script can run before onInstalled. Until its reason is known, retain the old defaults and remember
    // only explicit edits; installation can then choose its baseline without losing those edits.
    let early = before.earlyWidgetEdits;
    if (!before.freshDefaults && !before.widgetLayout) {
      early = { ops: {} };
      const { enhance } = await area.sync.get('enhance');
      if (!await area.local.set({ widgetLayout: GZ_WIDGETS.kept(enhance?.widgets), earlyWidgetEdits: early })) return { ok: false, error: 'write' };
    }
    if (!await defaultEdits(m, area)) return { ok: false, error: 'write' };
    const base = !early || before.freshDefaults ? area.local : { ...area.local, set: async (patch) => {
      const lay = patch.widgetLayout, ops = { ...early.ops };
      for (const o of m.ops) {
        const tile = (o.s === 'canvas' ? lay.tiles : lay.boards[o.s] || []).find((t) => t.id === o.id);
        if (tile || (o.remove && GZ_WIDGETS.course(o.id))) ops[`${o.s}:${o.id}`] = tile ? { s: o.s, id: o.id, set: tile } : { s: o.s, id: o.id, remove: true };
      }
      early = { ...early, ops: Object.fromEntries(Object.entries(ops).slice(-1024)), ...(m.more && { more: { ...early.more, ...m.more } }), ...(m.widths && { widths: lay.widths }), ...(typeof m.music === 'string' && { music: lay.music }),
        ...(m.ops.some((o) => o.s === 'canvas' && (o.move || o.to)) && { order: lay.tiles.map((t) => t.id) }) };
      return area.local.set({ ...patch, earlyWidgetEdits: early });
    } };
    // A deliberate edit of a Dashboard board that is still the starter seed ends the synced starter flags' hold on it
    // (resumeDefaults), in the same write as the edit. Edits before the install event say the same (resumeDefaults).
    const legacy = before.widgetLayout?.starter === true && !Array.isArray(before.starterTouched) && !before.freshDefaults?.pending && !early;
    const edited = legacy ? ['dash', 'cdash'] : before.widgetLayout?.starter === true && !m.fill
      ? ['dash', 'cdash'].filter((b) => m.ops.some((o) => o?.s === b) && !before.starterTouched?.includes(b)) : [];
    const local = !edited.length ? base : { ...base, set: (patch) => base.set(patch.widgetLayout
      ? { ...patch, starterTouched: [...(before.starterTouched || []), ...edited] } : patch) };
    const r = await GZ_WIDGETS.change(m, local);
    await resumeDefaults(true);
    return r.ok ? { ...r, layout: (await area.local.get('widgetLayout')).widgetLayout } : r;
  },
};
// The sidebar's record (lib/sidebar.js change): a page's field-level changes to its own site's account's record, applied
// to what is stored then. Canvas's top frame only (a course tab's frame goes through its top); Ultra's pages and their
// course tabs' frames, as for the layout. The record's lms must be the sender's.
BROKER.sidebar = {
  allow: async (m, s) => {
    const at = GZ_SIDEBAR.parse(m.key);
    if (!at || !GZ_SIDEBAR.ops(m.ops)) return false;
    const site = at.lms === 'canvas' ? s.frameId === 0 && (await fromCanvas(s)) : ultraPage(s) && (await fromUltra(s));
    return site === at.origin && (await chrome.storage.sync.get('enabled')).enabled !== false;
  },
  run: async (m, { local, sync }, s) => {
    const at = GZ_SIDEBAR.parse(m.key);
    // Ask the exact document's existing identity reader in Glaze's isolated world, inside the write queue. A key from
    // an old account, a signed-out page or a replaced document cannot migrate or edit another account's record.
    const target = s.documentId ? { tabId: s.tab.id, documentIds: [s.documentId] } : { tabId: s.tab.id, frameIds: [s.frameId] };
    const check = chrome.scripting.executeScript({ target, func: async (lms, origin, uid) => {
      const c = globalThis.GZ_CTX;
      const here = () => (globalThis.origin || location.origin) === origin && globalThis.GZ_CTX === c && c?.site === lms && c.on();
      return here() && String(await c.account()) === uid && here();
    }, args: [at.lms, at.origin, at.uid] }).then((r) => r?.[0]?.result === true, () => false);
    // A suspended document or slow identity read must not hold every other storage write in the queue.
    let timer;
    const same = await Promise.race([check, new Promise((res) => { timer = setTimeout(() => res(false), 1500); })])
      .finally(() => clearTimeout(timer));
    if (!same) return { ok: false, error: 'sender' };
    if (!(await local.get('freshDefaultAccount')).freshDefaultAccount
      && !await local.set({ freshDefaultAccount: m.key })) return { ok: false, error: 'write' };
    if (!await defaultEdits(m, { local, sync })) return { ok: false, error: 'write' };
    const r = await GZ_SIDEBAR.change(m, local, sync, { settings: false });
    await resumeDefaults(true);
    return r.ok ? { ...r, rec: (await local.get(m.key))[m.key] } : r;
  },
};
BROKER.notesapp = {
  allow: async (m, s) => typeof m.key === 'string' && GZ_NOTES.KEY.test(m.key) && m.key.startsWith(`notesIdx:${(await fromCanvas(s)) || (await fromUltra(s))}/`),
  run: (m, area) => GZ_NOTES.run(m, area, NOTES_DB).catch(() => ({ ok: false, error: 'db' })),
};
// Mods (lib/modbundle.js): only the editor's own top frame installs, lists or changes them, and every bundle is read
// and checked again here, whatever the editor showed. Nothing here runs a mod's code.
BROKER_FILES.mods = ['zip.js', 'modapi.js', 'modwidget.js', 'modbundle.js', 'blocklist.js']; // a bundle's widget blocks are checked with modwidget.js
BROKER_FILES.modwidget = ['gradecalc.js']; // a widget's GPA
globalThis.addEventListener?.('install', () => importScripts('zip.js', 'modapi.js', 'modwidget.js', 'modbundle.js'));
BROKER.mods = {
  allow: (m, s) => fromEditor(s) && s.frameId === 0 && s.origin === chrome.runtime.getURL('').replace(/\/$/, '') && GZ_MODBUNDLE.OPS.includes(m.op),
  run: (m, area) => GZ_MODBUNDLE.change(m, area),
};
// Media for a Look (lib/media.js): the files this computer keeps for a Look's video, animated picture or Lottie animation
// (MEDIA_FILES, indexed in storage.local `lookMediaIndex`) are put, listed, kept, dropped and reset only by the editor, which
// sends the bytes; every one is read again here before it is kept.
BROKER_FILES.media = ['media.js'];
globalThis.addEventListener?.('install', () => importScripts('media.js'));
BROKER.media = {
  allow: (m, s) => fromEditor(s) && trustedFrame(s, 'settings') && ['put', 'list', 'drop', 'keep', 'reset'].includes(m.op),
  run: async (m, area) => {
    const store = { ...area, files: MEDIA_FILES };
    // Settings can open before the update event finishes, or after a failed migration. Discover legacy files there too.
    if (['list', 'reset'].includes(m.op)) await migrateMedia(store);
    return GZ_MEDIA.change(m, store, { decode: GZ_SHARE.decode });
  },
};
// A kept file for a page's background (lib/scene-media.js): as it was kept (checked and named when it was put), for the file
// the worn Look names only; the editor and its preview frame may have any. Read outside the broker's queue: only a file an
// older Glaze kept in storage.local, moving over, takes a turn.
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:keptFile') return;
  (async () => {
    if (!globalThis.GZ_MEDIA) importScripts('media.js');
    const area = { sync: brokerArea('sync'), local: brokerArea('local'), files: MEDIA_FILES };
    if (!fromPreview(s) && (!await fromLms(s) || GZ_MEDIA.fileOf((await GZ_XPARTS.fromStored((await area.sync.get('lookX')).lookX, area.local))?.x?.bg?.media?.src) !== m.h)) {
      return { ok: false, error: 'sender' };
    }
    return GZ_MEDIA.change({ op: 'file', h: m.h }, area, { queue: (f) => (brokerTurn ||= GZ_CARDS.queue())(f) });
  })().then(reply, () => reply({ ok: false, error: 'failed' }));
  return true;
});
// Kept files no Look names any more go (lib/media.js collect): when the worker starts or Glaze updates (after files an
// older Glaze kept in storage.local have moved), once history has recorded a Look change, and when favorites change. Not
// while a Look change is still resting before history records it: the Look it left may still be on its way into history.
const mediaHistory = new Set(); // snapshots queued for history still own the files of the Look just left
const migrateMedia = async (area) => {
  let keys;
  if (chrome.storage.local.getKeys) keys = await chrome.storage.local.getKeys();
  else {
    // Older browsers cannot enumerate keys cheaply. Move known files lazily; leave unseen legacy copies intact.
    const named = await GZ_MEDIA.uses(area, GZ_SHARE.decode);
    keys = [...new Set([...Object.keys(await GZ_MEDIA.index(area.local)), ...named.now, ...named.saved])].map((h) => `${GZ_MEDIA.KEY}${h}`);
  }
  return GZ_MEDIA.migrate(area, keys);
};
const sweepMedia = (update = false) => (brokerTurn ||= GZ_CARDS.queue())(async () => {
  if (!globalThis.GZ_MEDIA) importScripts('media.js');
  const local = brokerArea('local'), area = { sync: brokerArea('sync'), local, files: MEDIA_FILES };
  if (update) await migrateMedia(area);
  if (!before && !mediaHistory.size) return GZ_MEDIA.collect(area, { decode: GZ_SHARE.decode });
}).catch(() => {});
// A Lottie animation for a page's background (lib/scene-media.js): the cleaned JSON of a kept file, or of the address the
// worn Look or an eligible installed mod names (a fetch with no cookies, no referrer, no redirect and a size cap, so it is not in the broker's queue, which a
// slow host would hold up). The editor's preview may try any address the editor is showing.
// The editor and its preview frame: Glaze's own pages, trusted with any address the editor shows, and with installed mods' parts.
const fromPreview = (s) => s.id === chrome.runtime.id && typeof s.url === 'string' && [chrome.runtime.getURL('options.html'), chrome.runtime.getURL('preview.html')].includes(s.url.split(/[?#]/)[0]);
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:lottie') return;
  (async () => {
    if (!globalThis.GZ_MEDIA) importScripts('media.js');
    const free = fromPreview(s);
    const site = free ? null : await fromLms(s);
    if (!free && !site) return { ok: false, error: 'sender' };
    const area = { sync: brokerArea('sync'), local: brokerArea('local'), files: MEDIA_FILES };
    return GZ_MEDIA.change({ op: 'lottie', src: m.src }, area, { fetch: (u, i) => fetch(u, i),
      allow: async (src) => {
        if (free || (await GZ_XPARTS.fromStored((await area.sync.get('lookX')).lookX, area.local))?.x?.bg?.media?.src === src) return true;
        if (!globalThis.GZ_MODBROKER) importScripts('modapi.js', 'modwidget.js', 'modbroker.js');
        const answer = await GZ_MODBROKER.page({ op: 'parts' }, { site, local: area.local,
          blocklist: async () => (await area.local.get('modsBlocklist')).modsBlocklist?.list });
        return (answer.parts || []).some((p) => p.bg?.media?.type === 'lottie' && p.bg.media.src === src);
      } });
  })().then(reply, () => reply({ ok: false, error: 'failed' }));
  return true;
});
// Share keys and relay traffic are confined to the worker, Settings and the Notes share panel. Loading this broker
// for a backup never connects: the device-local consent switch and a live surface are checked separately.
// MV3 caches imports during install; later worker starts still load these modules only when needed.
globalThis.addEventListener?.('install', () => importScripts('relay.js', 'sharing.js', 'sessions.js'));
let sessionsWorker = null;
let sessionGeneration = 0;
// One session operation at a time, in a queue of its own: a sync talks to the relay for a while, and the storage
// broker's queue mustn't wait on it. Reads and writes of Notes, To Do, the Look and media take broker turns.
let sessionTurn = null;
// origin is optional in MessageSender: when the browser gives it, it must be the extension's own.
const extensionOrigin = (s) => s.origin === undefined || s.origin === chrome.runtime.getURL('').replace(/\/$/, '');
const sessionFrame = (s) => s.frameId === 0 && extensionOrigin(s);
// Settings (options.html, top frame) owns every operation. The Notes share panel (sharing/quick.html) is an extension
// frame inside a Notes view: the LMS page around it cannot read its keys, and it gets only the ops a quick share needs,
// for one Notes account and note. Tickets never travel in URLs. A panel consumes one on a runtime port; that port,
// rather than a reusable frameId (documentId is absent in some browsers), owns the opening's authority.
const fromSessions = (s) => fromEditor(s) && sessionFrame(s);
const quickTickets = new Map(); // unclaimed ticket -> { tab, key, note, at }
const quickPanels = new Set(); // live, authenticated ports; a new opening revokes the old one
let quickTicketTurn = null;
const quickFrame = (s) => s?.id === chrome.runtime.id && Number.isInteger(s.frameId) && s.frameId > 0
  && extensionOrigin(s) && s.url === chrome.runtime.getURL('sharing/quick.html') && typeof s.tab?.id === 'number';
const QUICK_OPS = new Set(['list', 'create', 'join', 'link', 'attach', 'leave', 'delete', 'sync', 'resume']);
const SESSION_OPS = new Set(['list', 'read', 'create', 'join', 'link', 'attach', 'useLook', 'pause', 'resume', 'sync', 'leave', 'delete', 'expiry', 'reupload', 'exportKeys', 'importKeys', 'backupNotes', 'notesRead', 'notesGetFile', 'notesFile', 'notesImport', 'relaySave', 'relayTest']);
const SESSION_NETWORK = new Set(['create', 'join', 'resume', 'sync', 'reupload', 'expiry', 'delete', 'relayTest']);
const sessions = () => {
  if (!sessionsWorker) {
    if (!globalThis.GZ_MEDIA) importScripts('media.js'); // a Look share carries its media file
    importScripts('relay.js', 'sharing.js', 'sessions.js');
    // getKeys (where the browser has it) names the Notes and To Do accounts without reading the rest of local storage.
    sessionsWorker = GZ_SESSIONS.make({ local: Object.assign(brokerArea('local'), chrome.storage.local.getKeys && { getKeys: () => chrome.storage.local.getKeys() }), sync: brokerArea('sync'), notes: NOTES_DB, keptFiles: MEDIA_FILES,
      offerLook: async (code, name, media) => { await chrome.storage.local.set({ galleryOffer: { code, name, ...(media && { media }) } }); openEditor(); return true; },
      enqueue: (f) => (brokerTurn ||= GZ_CARDS.queue())(f), serial: (f) => (sessionTurn ||= GZ_CARDS.queue())(f), notify: () => { for (const p of sessionPorts) { try { p.postMessage({ changed: true }); } catch {} } } });
  }
  return sessionsWorker;
};
const sessionPorts = new Set();
BROKER.sessions = {
  allow: (m, s) => {
    delete m.scope; // only the worker scopes a call, from the panel's ticket
    if (!SESSION_OPS.has(m.op) || JSON.stringify(m).length > (32 << 20)) return false;
    return fromSessions(s);
  },
  interrupt: (m) => { if (['pause', 'leave', 'delete', 'importKeys'].includes(m.op)) { sessionGeneration++; sessionsWorker?.stop(); } },
  run: async (m) => {
    if (m.op === 'backupNotes') return { ok: true, data: await sessions().backupNotes(m.key) };
    return sessions().handle(m);
  },
};
chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== 'glaze:quick') return;
  if (!quickFrame(p.sender)) return p.disconnect();
  let closed = false, scope = null, disconnect;
  const cleanup = () => {
    if (closed) return;
    closed = true; quickPanels.delete(panel); sessionPorts.delete(p);
    const release = disconnect; disconnect = null; release?.();
  };
  // Local disconnect may notify only the other endpoint. Release our state explicitly, in either browser behavior.
  const close = () => { cleanup(); try { p.disconnect(); } catch {} };
  const panel = { tab: p.sender.tab.id, revoke: close };
  p.onDisconnect.addListener(cleanup);
  p.onMessage.addListener((m) => {
    if (closed) return;
    const reply = (r) => { if (!closed) { try { p.postMessage({ id: m?.id, ...r }); } catch { close(); } } };
    if (!scope) {
      const t = typeof m?.ticket === 'string' && quickTickets.get(m.ticket);
      if (!t || t.tab !== panel.tab || Date.now() - t.at > 120000) { reply({ ok: false, error: 'sender' }); close(); return; }
      quickTickets.delete(m.ticket); // consumed, including on browsers without documentId
      scope = { id: m.ticket, key: t.key, note: t.note };
      quickPanels.add(panel); sessionPorts.add(p);
      disconnect = sessions().connect();
      reply({ ok: true });
      return;
    }
    if (m?.online === true) { sessionsWorker?.changed(); return; }
    if (!m || !Number.isSafeInteger(m.id) || !QUICK_OPS.has(m.op) || JSON.stringify(m).length > (32 << 20)) { reply({ ok: false, error: 'sender' }); return; }
    const request = { ...m, scope }; // ignore every client-supplied scope
    BROKER.sessions.interrupt(request);
    const generation = sessionGeneration;
    (sessionTurn ||= GZ_CARDS.queue())(() => closed || (generation !== sessionGeneration && SESSION_NETWORK.has(request.op))
      ? { ok: false, error: 'off' } : sessions().handle(request)).then(reply, (e) => reply({ ok: false, error: ['confirmation', 'unsupported', 'many'].includes(e?.message) ? e.message : 'write' }));
  });
});
chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== 'glaze:sessions') return;
  let closed = false, ready = false, disconnect;
  p.onMessage.addListener((m) => { if (ready && m?.online === true) sessionsWorker?.changed(); });
  p.onDisconnect.addListener(() => { closed = true; sessionPorts.delete(p); disconnect?.(); });
  Promise.resolve().then(async () => {
    const s = p.sender;
    const page = fromSessions(s);
    if (!page && !(s.id === chrome.runtime.id && ((s.frameId === 0 && (await fromCanvas(s))) || (ultraPage(s) && (await fromUltra(s)))))) return p.disconnect();
    if (closed) return;
    if (page) sessionPorts.add(p); // LMS ports receive no session information or keys.
    disconnect = sessions().connect(); ready = true;
  }).catch(() => p.disconnect());
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'sync' && ch.shareRelay) for (const p of sessionPorts) { try { p.postMessage({ changed: true }); } catch {} }
  if (!sessionsWorker) return;
  if (area === 'local' && ch.shareOn?.newValue !== true && ch.shareOn) sessionsWorker.stop();
  // Named, so only the shares of what changed sync: a Notes or To Do account's key, or 'look' for the Look's settings.
  const keys = area === 'local' ? Object.keys(ch).filter((k) => GZ_NOTES.KEY.test(k) || GZ_TODO.STORE_KEY.test(k))
    : area === 'sync' && ['colors', 'look', 'bg', 'nav', 'card', 'cards', 'lookX'].some((k) => k in ch) ? ['look'] : [];
  if (keys.length) sessionsWorker.changed(keys);
});
// A Notes share panel's ticket: only for a known top-frame LMS caller, and only for a Notes account on its own site.
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:quick-ticket') return;
  (quickTicketTurn ||= GZ_CARDS.queue())(async () => {
    if (!((s.frameId === 0 && (await fromCanvas(s))) || (ultraPage(s) && (await fromUltra(s)))) || typeof s.tab?.id !== 'number') return { ok: false };
    if (typeof m.key !== 'string' || !GZ_NOTES.KEY.test(m.key) || !m.key.startsWith(`notesIdx:${new URL(addressOf(s)).origin}/`)) return { ok: false };
    if (typeof m.note !== 'string' || (m.note && !GZ_NOTES.ID.test(m.note))) return { ok: false };
    for (const [k, t] of quickTickets) if (Date.now() - t.at > 120000 || t.tab === s.tab.id) quickTickets.delete(k);
    for (const p of quickPanels) if (p.tab === s.tab.id) p.revoke();
    while (quickTickets.size >= 20) quickTickets.delete(quickTickets.keys().next().value);
    const ticket = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    quickTickets.set(ticket, { tab: s.tab.id, key: m.key, note: m.note, at: Date.now() });
    return { ok: true, ticket };
  }).then(reply, () => reply({ ok: false }));
  return true;
});
// Settings as a page of an LMS tab (features/settingspage.js): a one-use ticket for that tab's top frame, claimed by the
// Settings frame it opens there. Settings shows nothing in a frame without one, so another site framing it gets a blank page.
// The frame that claimed it is the one trustedFrame accepts for Settings' own writes.
const settingsTickets = new Map(); // ticket -> { tab, at }
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:settings-ticket' && m?.type !== 'glaze:settings-claim') return;
  (async () => {
    for (const [k, t] of settingsTickets) if (Date.now() - t.at > 60000) settingsTickets.delete(k);
    if (m.type === 'glaze:settings-ticket') {
      if (s.id !== chrome.runtime.id || s.frameId !== 0 || typeof s.tab?.id !== 'number') return { ok: false };
      if (!((await fromCanvas(s)) || (ultraPage(s) && (await fromUltra(s))) || (typeof fromMoodle === 'function' && await fromMoodle(s)))) return { ok: false };
      while (settingsTickets.size >= 20) settingsTickets.delete(settingsTickets.keys().next().value);
      const ticket = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      settingsTickets.set(ticket, { tab: s.tab.id, at: Date.now() });
      return { ok: true, ticket };
    }
    const t = typeof m.ticket === 'string' && settingsTickets.get(m.ticket);
    if (!t || !fromEditor(s) || s.frameId === 0 || s.tab?.id !== t.tab) return { ok: false };
    settingsTickets.delete(m.ticket);
    await claimSettingsFrame(s); // this frame, as this document, may now save what trustedFrame(…, 'settings') lets Settings save
    return { ok: true };
  })().then(reply, () => reply({ ok: false }));
  return true;
});
// Opening Settings (Sharing, a Notes account's backup, or the navigation bar's own section) conveys no keys. A source account is a selection hint for its Notes backup; Export still needs a
// trusted click there after its key warning. Only known top-frame LMS callers and the editor may ask.
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:sessions-open') return;
  (async () => {
    if (!fromEditor(s) && !((s.frameId === 0 && (await fromCanvas(s))) || (ultraPage(s) && (await fromUltra(s))))) return { ok: false };
    const key = typeof m.key === 'string' && GZ_NOTES.KEY.test(m.key) && (fromEditor(s) || m.key.startsWith(`notesIdx:${new URL(addressOf(s)).origin}/`)) ? m.key : '';
    // The navigation bar's "Customize navigation" opens its own section instead.
    const at = m.section === 'navigation/bar' ? '#navigation/bar' : '#sharing/sessions';
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + (key ? `?notes=${encodeURIComponent(key)}#backup/notes` : at) });
    return { ok: true };
  })().then(reply, () => reply({ ok: false }));
  return true;
});
// The Dashboard's opt-in landing (features/dashboard.js), once in a tab: the first ask from an Ultra tab gets first: true,
// and the tab is remembered in this worker's session storage (in memory, gone when the browser closes, never the page's).
let brokerTurn = null;
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:landed') return;
  (brokerTurn ||= GZ_CARDS.queue())(async () => {
    if (s.frameId !== 0 || !Number.isInteger(s.tab?.id) || !chrome.storage.session || !await fromUltra(s)) return { first: false };
    const settings = GZ_SANITIZE(await chrome.storage.sync.get(['enabled', 'enhance', 'widgets']));
    if (!settings.enabled || !settings.enhance.dashboard || !settings.widgets.land) return { first: false };
    const k = `landed:${s.tab.id}`;
    if ((await chrome.storage.session.get(k))[k]) return { first: false };
    await chrome.storage.session.set({ [k]: 1 });
    return { first: true };
  })
    .then(reply, () => reply({ first: false }));
  return true;
});
chrome.tabs?.onRemoved?.addListener((id) => {
  chrome.storage.session?.remove([`landed:${id}`, settingsFrameKey(id)]).catch(() => {});
  settingsFrames.delete(id);
  if (!settingsRestoreDone) closedSettingsTabs.add(id);
  for (const [k, t] of quickTickets) if (t.tab === id) quickTickets.delete(k); // a closed tab's Notes share panel tickets
  for (const p of quickPanels) if (p.tab === id) p.revoke();
});
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const name = typeof m?.type === 'string' && m.type.startsWith('glaze:') ? m.type.slice(6) : '';
  if (!Object.hasOwn(BROKER, name)) return;
  const h = BROKER[name];
  const ready = ['courseName', 'media', 'petSprites'].includes(name) && sender.frameId !== 0 ? settingsFramesLoaded : Promise.resolve();
  ready.then(() => { brokerIn(name); return h.allow(m, sender); }).then((ok) => {
    if (!ok) return { ok: false, error: 'sender' };
    h.interrupt?.(m);
    const generation = sessionGeneration;
    if (name === 'sessions') return (sessionTurn ||= GZ_CARDS.queue())(() => generation !== sessionGeneration && SESSION_NETWORK.has(m.op)
      ? { ok: false, error: 'off' } : h.run(m));
    return (brokerTurn ||= GZ_CARDS.queue())(async () => {
      await resumeDefaults();
      return h.run(m, { sync: brokerArea('sync'), local: brokerArea('local') }, sender);
    });
  })
    .then(reply, () => reply({ ok: false, error: 'write' }));
  return true;
});

// The command palette's "Glaze settings": a content script can't open the editor itself. Only from a site Glaze runs on, or
// its own pages.
// openOptionsPage reuses an open editor tab; when Chrome refuses it, a new tab (as the popup does).
const openEditor = () => {
  const tab = () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  try { Promise.resolve(chrome.runtime.openOptionsPage()).catch(tab); } catch { tab(); }
};
chrome.runtime.onMessage.addListener((m, s) => { if (m === 'options') Promise.resolve(fromGlaze(s) || lmsPage(s)).then((ok) => { if (ok) openEditor(); }, () => {}); });

// "Use this Look in Glaze" on the gallery (lib/gallery.js): the code waits in storage.local for the editor,
// which previews it and asks. Only from the gallery's own pages, where the manifest runs that script.
// A pattern ending in /* takes that folder and below; any other is that one page.
const GALLERY = chrome.runtime.getManifest().content_scripts.find((c) => c.js.includes('lib/gallery.js'))?.matches || [];
const onGallery = (url) => {
  let here;
  try { const u = new URL(url); here = u.origin + u.pathname; } catch { return false; }
  return GALLERY.some((p) => (p.endsWith('/*') ? here.startsWith(p.slice(0, -1)) : here === p));
};
const onModGallery = (url) => onGallery(url) && /^\/glaze\/mods(\/|$)/.test(new URL(url).pathname);
chrome.runtime.onMessage.addListener((m, { url, frameId }) => {
  const g = m?.gallery;
  if (!g || m.galleryMod || frameId !== 0 || !onGallery(url) || onModGallery(url)) return;
  const text = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
  // The editor checks the code itself (lib/share.js); this only keeps the sizes sane.
  const name = (v, max) => text(v, max).replace(/[\p{Cc}\p{Bidi_Control}]/gu, '').trim();
  const offer = { code: text(g.code, GZ_SHARE.MAX_CODE2), name: name(g.name, 40), author: name(g.author, 39) };
  if (offer.code) galleryMedia(offer.code).catch(() => null).then((media) => chrome.storage.local.set({ galleryOffer: media ? { ...offer, media } : offer })).then(openEditor, console.warn);
});
// A gallery Look whose background is a file (`file:<h>`) this computer doesn't keep: that one file, from the gallery's fixed
// address (lib/media.js fromGallery), kept as the editor's are (put: cleaned again, named by its hash, under the total cap)
// but pending: the editor previews the Look with it, and lets it go unless the student uses the Look. → the offer's
// `media`: { h, pending? } when the file is here, { h, error } when it isn't ('full': no room); null for no file. Any
// failure still offers the Look.
const galleryMedia = async (code) => {
  if (!code.startsWith(GZ_SHARE.PREFIX2)) return null; // only a glaze2 code has parts
  const m = (await GZ_SHARE.decode(code)).parts?.x?.bg?.media;
  if (!globalThis.GZ_MEDIA) importScripts('media.js');
  const h = m && GZ_MEDIA.fileOf(m.src), area = { sync: brokerArea('sync'), local: brokerArea('local'), files: MEDIA_FILES };
  if (!h) return null;
  const had = (await GZ_MEDIA.index(area.local))[h];
  if (had && GZ_MEDIA.kindOf(had.t) === m.type) return { h, ...(had.p && { pending: true }) };
  const got = await GZ_MEDIA.fromGallery(h, m.type, { fetch: (u, i) => fetch(u, i) });
  if (!got.ok) return { h, error: got.error };
  const r = await (brokerTurn ||= GZ_CARDS.queue())(() => GZ_MEDIA.change({ op: 'put', kind: m.type, b64: got.b64, expect: h, pending: true }, area, { decode: GZ_SHARE.decode }));
  return r.ok ? { h, pending: true } : { h, error: r.error };
};

// "Use in Glaze" on the gallery's mod pages: { id, hash } only. The worker downloads that exact bundle (lib/modbundle.js
// offer: Glaze's only request to the gallery), and the editor opens on its install prompt; nothing installs until the
// student says so there.
chrome.runtime.onMessage.addListener((m, s) => {
  const g = m?.galleryMod;
  if (!g || Object.keys(m).length !== 1 || s.id !== chrome.runtime.id || s.frameId !== 0 || !s.tab || !onModGallery(s.url)) return;
  brokerIn('mods');
  GZ_MODBUNDLE.offer(g, { fetch: (u, i) => fetch(u, i), blocked })
    .then((modOffer) => (brokerTurn ||= GZ_CARDS.queue())(() => chrome.storage.local.set({ modOffer })))
    .then(openEditor, console.warn);
});

// Looks history (lib/history.js), whatever changed the theme: the popup, the editor, Ctrl+K on a course page,
// another computer through sync. A burst of edits (a color being dragged) counts once, when it has rested for
// 4 seconds. The theme from before the burst goes in too, so "Previous Look" always has the one that was left.
// Clearing goes through here as well ('clear-history'): it cancels the burst still resting, and its write
// queues behind any recording already under way, so nothing cleared comes back. The next change starts afresh.
let before = null, rest = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !['lookX', ...GZ_HISTORY.KEYS].some((k) => k in changes)) return;
  before ||= chrome.storage.sync.get(null).then((now) => ({ ...now, ...Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.oldValue])) }));
  clearTimeout(rest);
  rest = setTimeout(() => {
    // This burst's snapshot goes with its own write: a later burst may start before the queue gets here.
    const left = before;
    mediaHistory.add(left);
    before = null;
    serial(async () => {
      const was = await left;
      const [now, { lookHistory }] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get('lookHistory')]);
      const at = Date.now();
      // Each theme with the parts it wore (lookX). The theme left, whose parts were in this computer's local storage, can
      // no longer be told apart from the new ones: it isn't added again, having been recorded when it was worn.
      const local = brokerArea('local');
      const [wasParts, nowParts] = await Promise.all([GZ_XPARTS.fromStored(was.lookX, local), GZ_XPARTS.fromStored(now.lookX, local)]);
      const list = GZ_HISTORY.entries(lookHistory);
      await chrome.storage.local.set({ lookHistory: GZ_HISTORY.add(wasParts === undefined ? list : GZ_HISTORY.add(list, { ...was, parts: wasParts }, at), { ...now, parts: nowParts ?? null }, at) });
      mediaHistory.delete(left);
      sweepMedia();
    });
  }, 4000);
});
chrome.runtime.onMessage.addListener((m, { url }) => {
  if (m !== 'clear-history' || !String(url).startsWith(chrome.runtime.getURL(''))) return;
  clearTimeout(rest);
  before = null;
  mediaHistory.clear(); // explicitly clearing history also releases its queued snapshots
  serial(() => chrome.storage.local.set({ lookHistory: [] }));
});
// History and favorites name kept files too: once either has changed, and no Look change is still resting, files neither
// they nor the worn Look name can go.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.lookHistory || changes.lookFavorites) && !before) sweepMedia();
});

// Canvas on a school's own domain (canvas.school.edu) can't be matched by address, nor can Moodle anywhere. Once the student
// approved such a site (approved, above), Glaze goes onto its host for good, so its pages are themed from the first paint as
// on *.instructure.com. Its LMS's list in storage.local is what registers it again: not every browser honors
// persistAcrossSessions, and an update may clear registrations or change Glaze's file list.
// Each LMS's own first content script: Canvas's is the manifest's for *.instructure.com, Moodle's the same without Canvas's
// part (content-canvas.js). A host on both lists gets Canvas's, which holds all of Moodle's.
const canvasEntry = () => chrome.runtime.getManifest().content_scripts.find((c) => c.matches.includes('https://*.instructure.com/*'));
const glaze = (lms) => canvasEntry().js.filter((f) => lms === 'canvas' || f !== 'content-canvas.js');
// Browser match patterns cannot name a port. The content startup and every worker trust check still use the exact origin.
const script = (id, lms) => ({ id, matches: [`${new URL(id).protocol}//${new URL(id).hostname}/*`], js: glaze(lms), runAt: 'document_start', allFrames: true, persistAcrossSessions: true });
// Storage and registration change one at a time: two tabs can report the same host together.
let queue = Promise.resolve();
const serial = (f) => (queue = queue.then(f).catch(console.warn));
const ensure = async () => {
  const stored = await chrome.storage.local.get(['canvas', 'moodle']);
  const on = await glazeOn();
  const canvas = on && Array.isArray(stored.canvas) ? stored.canvas : [], moodle = on && Array.isArray(stored.moodle) ? stored.moodle : [];
  const have = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const todo = [...new Set([...canvas, ...moodle])].filter((id) => !have.has(id));
  if (todo.length) await chrome.scripting.registerContentScripts(todo.map((id) => script(id, canvas.includes(id) ? 'canvas' : 'moodle')));
  // A site taken off its list (Settings' Sites, Reset everything) loses its registration here.
  const gone = [...have].filter((id) => /^https?:\/\//.test(id) && !canvas.includes(id) && !moodle.includes(id));
  if (gone.length) await chrome.scripting.unregisterContentScripts({ ids: gone });
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
    matches: [...new Set([...first.matches, ...canvas.map((p) => `${new URL(p).protocol}//${new URL(p).hostname}/*`)].map((p) => p.replace(/\/\*$/, '/courses/*')))] };
};
const GRADESCOPE = { id: 'gz-gradescope', matches: ['https://www.gradescope.com/*'], js: ['lib/color.js', 'lib/i18n.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js', 'lib/gradescope.js', 'features/gradescope.js'], runAt: 'document_idle', persistAcrossSessions: true };
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && (changes.enhance || changes.enabled)) serial(ensure); });
// Defaults are an install transaction, independent of whether a page already wrote its layout or migrated its dock.
// Its local intent survives worker restarts. Navigation uses a local fallback until a real sync preference is present.
// Removals use separate sync keys: a device still starting up never uploads defaults over another device's choices.
// They keep a removed starter from returning in a Dashboard that is still the untouched seed (resumeDefaults); a board its
// student has edited on this device is hers, whatever another device later removes or empties.
const STARTER_TILES = ['pet', 'timer', 'notes', 'quotes']; // lib/widgets.js STARTER
const defaultEdits = async (m, { local, sync }) => {
  const patch = {};
  for (const o of m.ops || []) {
    if (m.key && ['settings', 'todo'].includes(o.id) && ['remove', 'undock', 'dock'].includes(o.op))
      patch[`starterOff:${m.key}:${o.id}`] = o.op !== 'dock';
    if (!m.fill && ['dash', 'cdash'].includes(o.s)) {
      patch[`starterOff:${o.s}:cards`] = true;
      if ([...STARTER_TILES, 'todo'].includes(o.id) && typeof o.set?.on === 'boolean')
        patch[`starterOff:${o.s}:${o.id}`] = !o.set.on;
      if (GZ_WIDGETS.course(o.id) && (o.remove || typeof o.set?.on === 'boolean'))
        patch[`starterOff:${o.s}:${o.id}`] = o.remove === true || !o.set.on;
    }
  }
  const boards = [...new Set((m.ops || []).filter((o) => !m.fill && ['dash', 'cdash'].includes(o.s)).map((o) => o.s))];
  if (boards.length) {
    const lay = GZ_WIDGETS.apply((await local.get('widgetLayout')).widgetLayout, m);
    for (const b of boards) patch[`starterOff:${b}:empty`] = !lay.boards[b].some((t) => t.on);
  }
  // Only what changes: a tile moved by its arrow keys sends an op a press, and sync takes 120 writes a minute, past which
  // every sync write fails (this layout's, the editor's) until the minute is out.
  const had = Object.keys(patch).length ? await sync.get(Object.keys(patch)) : {};
  for (const k of Object.keys(patch)) if (had[k] === patch[k]) delete patch[k];
  return !Object.keys(patch).length || await sync.set(patch);
};
const resumeDefaults = async (force = false) => {
  const local = await chrome.storage.local.get(['freshDefaults', 'freshDefaultAccount', 'widgetLayout', 'earlyWidgetEdits', 'starterTouched']);
  let state = local.freshDefaults;
  // Seeding has settled once no install is pending; from then on only a change (a forced call) has anything to apply, and a
  // broker turn reads none of sync.
  if (!force && !state?.pending) return;
  state ||= { fresh: false, pending: false };
  const sync = await chrome.storage.sync.get(null), patch = {};
  let lay = local.widgetLayout, touched = local.starterTouched || []; // the starter boards its student has edited here
  // Old versions kept starter=true after edits and recorded no per-board intent. Preserve those existing layouts;
  // guessing from positions would mistake automatic placement for an edit (or miss a change to a starter's switch).
  if (lay?.starter === true && !Array.isArray(local.starterTouched) && !state.pending) patch.starterTouched = touched = ['dash', 'cdash'];
  else if (state.pending && !Array.isArray(local.starterTouched)) patch.starterTouched = touched = [];
  // A layout stored by an earlier version can lack boards added since (cdash); read it as the pages do.
  if (lay && !(GZ_WIDGETS.BOARDS.every((b) => Array.isArray(lay.boards?.[b])) && Array.isArray(lay.filled))) lay = GZ_WIDGETS.layout(lay, GZ_WIDGETS.mods(lay));
  if (state.pending) {
    if (!lay || local.earlyWidgetEdits) {
      lay = state.fresh ? GZ_WIDGETS.fresh() : GZ_WIDGETS.kept(sync.enhance?.widgets);
      const early = local.earlyWidgetEdits;
      if (early) {
        const ops = Object.values(early.ops);
        const edited = ['dash', 'cdash'].filter((b) => ops.some((o) => o.s === b)); // a student's choices made before the install event
        if (edited.length) patch.starterTouched = touched = [...new Set([...touched, ...edited])];
        for (let i = 0; i < ops.length; i += 64) lay = GZ_WIDGETS.apply(lay, { ops: ops.slice(i, i + 64) }, early.more);
        lay = GZ_WIDGETS.apply(lay, { ops: [], widths: early.widths, music: early.music }, early.more);
        if (early.order) lay.tiles.sort((a, b) => early.order.indexOf(a.id) - early.order.indexOf(b.id));
        patch.earlyWidgetEdits = null;
      }
    }
    state = { ...state, pending: false };
  }
  if ((state.fresh || lay?.starter === true) && lay) {
    const ops = [];
    for (const b of ['dash', 'cdash']) {
      // Only a seed nobody has arranged: a board edited here (touched) keeps what its student made of it.
      if (lay.starter !== true || touched.includes(b)) continue;
      const empty = sync[`starterOff:${b}:empty`] === true;
      // "Emptied" is about the starters; other widgets and course cards go only by a flag of their own.
      for (const t of lay.boards[b]) if (sync[`starterOff:${b}:${t.id}`] === true || (empty && STARTER_TILES.includes(t.id)))
        ops.push({ s: b, id: t.id, ...(GZ_WIDGETS.course(t.id) ? { remove: true } : { set: { on: false } }) });
    }
    for (let i = 0; i < ops.length; i += 64) lay = GZ_WIDGETS.apply(lay, { ops: ops.slice(i, i + 64) });
    for (const b of ['dash', 'cdash']) if (sync[`starterOff:${b}:cards`] === true && !lay.filled.includes(b)) lay = { ...lay, filled: [...lay.filled, b] };
    const account = state.fresh && (state.account || local.freshDefaultAccount);
    if (account && GZ_SIDEBAR.parse(account)) {
      state = { ...state, account };
      const before = (await chrome.storage.local.get(account))[account];
      if (before) {
        let rec = GZ_SIDEBAR.clean(before);
        if (!state.dockDone) {
          if (!Object.hasOwn(rec.dest, 'settings')) rec = GZ_SIDEBAR.apply(rec, [{ op: 'dock', id: 'settings' }]);
          state = { ...state, dockDone: true };
        }
        if (JSON.stringify(rec) !== JSON.stringify(before)) patch[account] = { ...rec, rev: (rec.rev + 1) % 2 ** 31 };
      }
    }
  }
  // Earlier starter installs have no transaction record, and each device can have a different first account.
  // A synced removal still applies to its matching existing record, without granting any new seeding authority.
  for (const [k, v] of Object.entries(sync)) {
    const id = k.endsWith(':settings') ? 'settings' : k.endsWith(':todo') ? 'todo' : '';
    const account = k.startsWith('starterOff:sidebar:') && id ? k.slice(11, -id.length - 1) : '';
    if (v !== true || !GZ_SIDEBAR.parse(account)) continue;
    const before = patch[account] || (await chrome.storage.local.get(account))[account];
    if (!before) continue;
    const rec = GZ_SIDEBAR.apply(before, [{ op: 'remove', id }]);
    if (JSON.stringify(rec) !== JSON.stringify(before)) patch[account] = { ...rec, rev: (rec.rev + 1) % 2 ** 31 };
  }
  if (JSON.stringify(lay) !== JSON.stringify(local.widgetLayout)) patch.widgetLayout = lay;
  if (local.freshDefaults && JSON.stringify(state) !== JSON.stringify(local.freshDefaults)) patch.freshDefaults = state;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
};
const keepWidgets = async (fresh, provisional = false) => {
  const local = await chrome.storage.local.get(['freshDefaults', 'widgetLayout']);
  if (provisional && !local.freshDefaults) {
    if (!local.widgetLayout) {
      const { enhance } = await chrome.storage.sync.get('enhance');
      await chrome.storage.local.set({ widgetLayout: GZ_WIDGETS.kept(enhance?.widgets), earlyWidgetEdits: { ops: {} } });
    }
    return;
  }
  if (!local.freshDefaults)
    await chrome.storage.local.set({ freshDefaults: { fresh, pending: true } });
  await resumeDefaults();
};
chrome.runtime.onInstalled.addListener((d) => {
  // Mark fresh installs too: a later update must not mistake their untouched starter layout for a pre-change device.
  const seeded = ['install', 'update'].includes(d?.reason)
    ? (brokerTurn ||= GZ_CARDS.queue())(() => keepWidgets(d.reason === 'install')).catch(() => {}) : Promise.resolve();
  serial(async () => { await seeded; await chrome.scripting.unregisterContentScripts(); await ensure(); });
  if (d?.reason === 'update') sweepMedia(true);
  moveChannelKeys().catch(() => {});
  if (d?.reason === 'update') serial(perSite);
});
chrome.runtime.onStartup.addListener(() => { (brokerTurn ||= GZ_CARDS.queue())(() => keepWidgets(false, true)).catch(() => {}); serial(ensure); moveChannelKeys().catch(() => {}); sweepMedia(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some((k) => k.startsWith('starterOff:')))
    (brokerTurn ||= GZ_CARDS.queue())(() => resumeDefaults(true)).catch(() => {});
});
// Due this week is kept per site (`dueWeek:<origin>`: { at, list }, content.js dueWeek). lib/todo.js still hands a Canvas
// planner's list over as Glaze 3.3.4 kept the one list, whichever site asked last (dueWeek, dueWeekAt, dueWeekFrom).
const dueBySite = ({ dueWeek, dueWeekAt, dueWeekFrom, ...patch }) => {
  try {
    const u = new URL(dueWeekFrom);
    if (Array.isArray(dueWeek) && u.protocol === 'https:' && u.origin === dueWeekFrom)
      patch[`dueWeek:${u.origin}`] = { at: Number(dueWeekAt) || 0, list: dueWeek };
  } catch { /* old invalid source: discard it */ }
  return patch;
};
// Once, on the update from 3.3.4: that one list goes under its site, and Ultra's one ten-minute gate for its course list
// (seenCoursesAt) goes, now that each Ultra site has its own (`seenCoursesAt <origin>`, content-ultra.js record).
const perSite = async () => {
  const old = await chrome.storage.local.get(['dueWeek', 'dueWeekAt', 'dueWeekFrom', 'seenCoursesAt']);
  if (!Object.keys(old).length) return;
  const { seenCoursesAt, ...moved } = dueBySite(old);
  const kept = await chrome.storage.local.get(Object.keys(moved));
  for (const k of Object.keys(moved)) if (Number(kept[k]?.at) >= moved[k].at) delete moved[k];
  if (Object.keys(moved).length) await chrome.storage.local.set(moved);
  await chrome.storage.local.remove(Object.keys(old));
};

// ---- Asking first ---------------------------------------------------------------------------------------------------
// A page that looks like an LMS, from a tab's top frame: lib/detect.js's 'canvas' or 'moodle', or content.js's 'ultra' from
// an /ultra page off Blackboard's own hosts. On a site the student approved, Glaze goes into that page now (a registration an
// update dropped) and stays registered. Anywhere else the page only makes its site a candidate: with Glaze on, and no Not now
// there in the past week, Glaze asks on the page (features/consent.js). Nothing is registered, read or recorded before Yes.
const LMS = ['canvas', 'moodle', 'ultra'];
const LATER = 7 * 864e5;
const glazeOn = () => chrome.storage.sync.get('enabled').then((r) => r.enabled !== false, () => false);
const pageOf = (s) => (s.documentId ? { tabId: s.tab.id, documentIds: [s.documentId] } : { tabId: s.tab.id, frameIds: [0] });
// A candidate's or an answer's page: a tab's top frame on https, and for Ultra an /ultra address. → its URL, or null.
const askedAt = (kind, s) => {
  if (!LMS.includes(kind) || s.id !== chrome.runtime.id || s.frameId !== 0 || !s.tab) return null;
  let u;
  try { u = new URL(s.url); } catch { return null; }
  return u.protocol === 'https:' && (kind !== 'ultra' || !!ultraAt(s)) ? u : null;
};
// The site on its LMS's list, with no Not now left for it, and registered.
const approve = (kind, u) => serial(async () => {
  const { [kind]: list = [], askLater = {} } = await chrome.storage.local.get([kind, 'askLater']);
  if (!await glazeOn()) return;
  if (!list.includes(siteKey(kind, u))) await chrome.storage.local.set({ [kind]: [...list, siteKey(kind, u)] });
  if (Object.hasOwn(askLater, u.origin)) await chrome.storage.local.set({ askLater: Object.fromEntries(Object.entries(askLater).filter(([o]) => o !== u.origin)) });
  await ensure();
});
// Glaze's first content script, into the page that asked rather than whatever its tab has gone on to, then a Canvas site's
// hook for the notes app (registration covers its next pages). `bar`: the question brought lib/i18n.js in, which can't run twice.
const glazeInto = async (kind, s, bar) => {
  // An all-host /ultra entry may already be waiting in content.js after detecting another LMS's markup.
  const live = await chrome.scripting.executeScript({ target: pageOf(s), func: () => !!window.__gzGlaze }).then((r) => r?.[0]?.result, () => true);
  if (live || !await glazeOn()) return;
  const first = chrome.scripting.executeScript({ target: pageOf(s), files: glaze(kind).filter((f) => !bar || f !== 'lib/i18n.js'), injectImmediately: true }).catch(console.warn);
  if (kind === 'canvas') serial(async () => { if (await switchOn('notes')) { await first; await notesHomeInto(notesHome([siteKey(kind, new URL(s.url))]), [s.tab]); } });
};
// The question, in the page's language and the student's palette. lib/detect.js's pages have none of Glaze's words yet;
// Ultra's first content script has them (lib/i18n.js).
const ask = async (kind, s) => {
  const run = (o) => chrome.scripting.executeScript({ target: pageOf(s), injectImmediately: true, ...o }).then((r) => r?.[0]?.result);
  const wordsIn = kind === 'ultra' || await run({ func: () => typeof GZ_I18N !== 'undefined' });
  await run({ files: wordsIn ? ['features/consent.js'] : ['lib/i18n.js', 'features/consent.js'] });
  const words = await run({ func: () => globalThis.GZ_CONSENT?.words() });
  if (typeof words === 'string' && words.startsWith('i18n/') && LOADABLE.has(words)) await run({ files: [words] });
  const st = GZ_SANITIZE(await chrome.storage.sync.get(['colors', 'auto', 'presets']));
  if (!await glazeOn()) return;
  await run({ func: (k, look) => globalThis.GZ_CONSENT?.show(k, look), args: [kind, { dark: GZ_ACTIVE_COLORS(st, true), light: GZ_ACTIVE_COLORS(st, false) }] });
};
chrome.runtime.onMessage.addListener((m, s) => {
  const u = typeof m === 'string' && askedAt(m, s);
  if (!u) return;
  (async () => {
    if (!await glazeOn()) return;
    if (await approved(m, u)) {
      if (m !== 'ultra') { approve(m, u); glazeInto(m, s, false); }
      return;
    }
    if (!await glazeOn() || (await chrome.storage.local.get('askLater')).askLater?.[u.origin] > Date.now()) return;
    await ask(m, s);
  })().catch(console.warn);
});
// The answer (features/consent.js, after a real click on its page): 'yes' approves the site, registers it and puts Glaze in
// the page (on Ultra, content.js starts by itself once the site is on the list); 'join' puts Glaze in a page whose site was
// approved in another tab; 'later' is Not now, kept for the 50 sites put off last.
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:consent') return;
  (async () => {
    const u = askedAt(m.kind, s);
    if (!u || !['yes', 'join', 'later'].includes(m.op) || !await glazeOn()) return { ok: false };
    if (m.op === 'later') {
      return serial(async () => {
        const { askLater = {} } = await chrome.storage.local.get('askLater');
        const kept = Object.entries(askLater).filter(([o, until]) => o !== u.origin && until > Date.now()).slice(-49);
        await chrome.storage.local.set({ askLater: Object.fromEntries([...kept, [u.origin, Date.now() + LATER]]) });
        return { ok: true };
      });
    }
    if (m.op === 'yes' && await glazeOn()) await approve(m.kind, u);
    if (!await approved(m.kind, u)) return { ok: false };
    if (m.kind !== 'ultra') glazeInto(m.kind, s, true);
    return { ok: true };
  })().then((r) => reply(r || { ok: false }), () => reply({ ok: false }));
  return true;
});
// Settings' Sites (options.js), from the editor's own tab. Remove takes a site off every list, unregisters it and forgets the
// courses and the due list Glaze read there (the student's own notes and tasks stay); Reset everything empties the lists and
// the Not nows. Pages open on a site removed keep Glaze until they reload, refused by every check above meanwhile.
const forget = async (origin) => {
  const u = new URL(origin);
  const got = await chrome.storage.local.get([...LMS, 'seenCourses', 'courseSlots', 'todoCache']);
  const patch = {};
  for (const kind of LMS) if (Array.isArray(got[kind]) && got[kind].includes(siteKey(kind, u))) patch[kind] = got[kind].filter((x) => x !== siteKey(kind, u));
  // Its courses: Ultra's by the site each names, Canvas's and Moodle's by their keys.
  const mine = ([k, c]) => c?.site === origin || k.startsWith(`canvas:${origin}/`) || k.startsWith(`moodle:${origin}/`);
  const seen = Object.entries(got.seenCourses || {});
  if (seen.some(mine)) {
    patch.seenCourses = Object.fromEntries(seen.filter((e) => !mine(e)));
    const slots = { ...got.courseSlots };
    for (const [k] of seen.filter(mine)) delete slots[k];
    patch.courseSlots = slots;
  }
  const keys = chrome.storage.local.getKeys ? await chrome.storage.local.getKeys() : Object.keys(await chrome.storage.local.get(null));
  const drop = keys.filter((k) => k === `dueWeek:${origin}` || k === `seenCoursesAt ${origin}` || k.startsWith(`seenCoursesAt moodle:${origin}/`));
  if (typeof got.todoCache?.key === 'string' && got.todoCache.key.startsWith(`todo:${origin}/`)) drop.push('todoCache');
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  if (drop.length) await chrome.storage.local.remove(drop);
  await ensure();
  return true;
};
const forgetAll = async () => {
  const all = await chrome.storage.local.get(null), origins = new Set();
  for (const kind of LMS) for (const value of Array.isArray(all[kind]) ? all[kind] : []) {
    try { origins.add(new URL(value).origin); } catch { /* old invalid entry */ }
  }
  for (const [k, c] of Object.entries(all.seenCourses || {})) {
    try { origins.add(new URL(c?.site || k.replace(/^(canvas|moodle):/, '')).origin); } catch { /* unscoped legacy entry */ }
  }
  for (const k of Object.keys(all)) if (k.startsWith('dueWeek:')) {
    try { origins.add(new URL(k.slice(8)).origin); } catch { /* invalid entry */ }
  }
  for (const origin of origins) await forget(origin);
  await chrome.storage.local.remove([...LMS, 'askLater']);
  await ensure();
  return true;
};
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:sites') return;
  let origin = null;
  try { origin = m.op === 'remove' ? new URL(m.origin).origin : null; } catch { /* not an address */ }
  if (!fromSessions(s) || !(m.op === 'reset' || (m.op === 'remove' && origin === m.origin && /^https:/.test(origin)))) { reply({ ok: false, error: 'sender' }); return; }
  serial(() => (m.op === 'remove' ? forget(origin) : forgetAll()))
    .then((ok) => reply({ ok: ok === true }));
  return true;
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
  try { from = new URL(addressOf(s)); } catch { /* no address */ }
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

// Code mods (lib/modbroker.js): a mod's API calls ('glaze:mod') and the page's own asks ('glaze:modpage'),
// only from Glaze's content script in the top frame of an LMS page Glaze runs on and is on for, never a quiz or a tool's
// page. Parts also go to same-site Ultra course frames. The broker checks everything else.
globalThis.addEventListener?.('install', () => importScripts('modapi.js', 'modwidget.js', 'modbroker.js'));
const modQuiet = (p) => GZ_LX.quiet(p) || /\/(quizzes|external_tools|assessment|attempt|lti)(\/|$)|\/mod\/(quiz|lti)(\/|$)/.test(p);
const fromLms = async (s, parts = false) => {
  if (s.id !== chrome.runtime.id || !s.tab || (s.frameId !== 0 && !(parts && ultraPage(s)))) return null;
  let u;
  try { u = new URL(addressOf(s)); } catch { return null; }
  if (u.protocol !== 'https:' || modQuiet(u.pathname)) return null;
  if ((await chrome.storage.sync.get('enabled')).enabled === false) return null;
  return (await fromCanvas(s)) || (await fromUltra(s)) || (await approved('moodle', u) ? u.origin : null);
};
const modKept = new Map(); // storage key → { at: generation, value }: mod:<id> and modsBlocklist
let modGen = 0;
const modPending = new Map(); // mod id → in-flight calls, cancelled on revocation
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && Object.keys(c).some((k) => k.startsWith('mod:') || k === 'modsBlocklist')) { modGen++; modKept.clear(); }
  const all = (area === 'sync' && c.enabled?.newValue === false) || (area === 'local' && (c.mods || c.modsBlocklist || (c.modDev && c.modDev.newValue !== true)));
  for (const [id, pending] of modPending) if (all || (area === 'local' && c[`mod:${id}`])) for (const control of pending) control.abort();
});
const modRead = async (k) => {
  if (modKept.has(k)) return modKept.get(k);
  const gen = modGen, value = (await chrome.storage.local.get(k))[k];
  const kept = k === 'modsBlocklist' ? value?.list : GZ_MODBROKER.usable(value, k.slice(4), true) ? { id: value.id, enabled: true, dev: value.dev, blocked: value.blocked, hash: value.hash, key: value.key, grants: value.grants, manifest: { permissions: value.manifest.permissions, parts: value.manifest.parts, ui: value.manifest.ui, settings: value.manifest.settings, replaces: value.manifest.replaces }, paths: Object.keys(value.files || {}) } : null;
  if (gen !== modGen) return modRead(k); // a change heard while reading: retry before using the grant
  modKept.set(k, kept);
  return kept;
};
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:mod' && m?.type !== 'glaze:modpage') return;
  (async () => {
    if (!globalThis.GZ_MODBROKER) importScripts('modapi.js', 'modwidget.js', 'modbroker.js');
    if (m.op === 'widget') brokerIn('modwidget');
    const local = brokerArea('local');
    const control = m.type === 'glaze:mod' || m.op === 'widget' ? new AbortController() : null;
    if (control) { if (!modPending.has(m.mod)) modPending.set(m.mod, new Set()); modPending.get(m.mod).add(control); }
    const timer = control && setTimeout(() => control.abort(new DOMException('Timed out', 'TimeoutError')), GZ_MODBROKER.LIMIT.timeout);
    try {
      // The editor's preview shows installed mods' parts and their background files as a page would (same checks, no code).
      const preview = m.type === 'glaze:modpage' && ['parts', 'media'].includes(m.op) && fromPreview(s);
      const env = { site: preview ? 'editor' : await fromLms(s, m.type === 'glaze:modpage' && m.op === 'parts'), signal: control?.signal, local, sync: brokerArea('sync'), fetch: (u, i) => fetch(u, control ? { ...i, signal: control.signal } : i), queue: (f) => (brokerTurn ||= GZ_CARDS.queue())(f),
        keys: async () => (chrome.storage.local.getKeys ? chrome.storage.local.getKeys() : Object.keys(await chrome.storage.local.get(null))),
        record: (id) => modRead(`mod:${id}`), blocklist: () => modRead('modsBlocklist') };
      return await (m.type === 'glaze:mod' ? GZ_MODBROKER.handle(m, env) : GZ_MODBROKER.page(m, env));
    } finally {
      clearTimeout(timer);
      if (control) { const pending = modPending.get(m.mod); pending.delete(control); if (!pending.size) modPending.delete(m.mod); }
    }
  })().then(reply, () => reply({ ok: false, error: 'failed' }));
  return true;
});

// Code on demand (content.js need()): a file the first content script leaves out runs in the frame that asks, when
// it asks (a site's part too, where its host was registered for the other LMS). Only these files, and only into a
// frame of a site Glaze runs on (lmsPage), or a catalogue into Gradescope's pages (features/gradescope.js).
const SAFARI = new URL(chrome.runtime.getURL('')).protocol === 'safari-web-extension:';
const LOADABLE = new Set(['lib/scene-host.js', 'lib/nav.js', 'features/light.js', 'lib/nav-items.js', 'lib/navlayout.js', 'content-ultra.js', 'content-canvas.js', 'features/nav.js', 'lib/navbar.js', 'features/navbar-canvas.js', 'features/navbar-moodle.js', 'features/navbar.js', 'features/navbar-widgets.js', 'features/settingspage.js', 'lib/folders.js', 'features/folders.js', 'lib/zip.js', 'lib/drafts.js', 'lib/gradecalc.js', 'features/grades.js', 'features/schedule.js', 'lib/todo.js', 'features/todo.js', 'i18n/de.js', 'i18n/es.js', 'i18n/fr.js', 'i18n/nl.js', 'i18n/pt-BR.js', 'lib/cards.js', 'features/cards.js', 'features/cardtasks.js', 'lib/moodle.js', 'features/moodle.js', 'lib/seek.js', 'features/search.js', 'lib/remind.js', 'features/reminders.js', 'features/palette.js', 'features/keys.js', 'features/coursemenu.js', 'features/previews.js', 'features/download.js', 'lib/widgets.js', 'lib/sidebar.js', 'features/sidebar.js', 'features/widgets.js', 'features/coursecards.js', 'features/dashboard.js', 'lib/lookx.js', 'features/lookx.js', 'lib/lookparts.js', 'features/lookparts.js', 'lib/motionx.js', 'features/drafts.js', 'features/docs.js', 'features/docreview.js', 'features/place.js', 'lib/gradescope.js', 'lib/ics.js', 'lib/calexport.js', 'features/calexport.js', 'lib/gpa.js', 'lib/doctext.js', 'features/import.js', 'features/gpaterms.js', 'lib/syllabus.js', 'features/syllabus.js', 'lib/classes.js', 'features/classes.js', 'lib/insights.js', 'features/insights.js', 'lib/notes.js', 'features/notes.js', 'lib/ultra.js', 'lib/pet.js', 'lib/petbrain.js', 'lib/petphysics.js', 'features/petworld.js', 'lib/petsprites.js', 'lib/petplayer.js', 'features/pet.js', 'lib/coursetabs.js', 'features/coursetabs.js', 'features/sharing.js', 'lib/parts.js', 'features/rules.js', 'features/motionx.js', 'lib/glsl.js', 'features/mods.js', 'features/modui.js', 'features/modwidgets.js']);
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.type !== 'glaze:load') return;
  const files = Array.isArray(m.files) ? m.files : [];
  if (sender.id !== chrome.runtime.id || !sender.tab || !Number.isInteger(sender.frameId) || !files.length || !files.every((f) => LOADABLE.has(f))) {
    reply({ ok: false, error: 'not loadable' });
    return;
  }
  Promise.resolve().then(async () => fromGlaze(sender) || !!await lmsPage(sender) || (fromGradescope(sender) && files.every((f) => f.startsWith('i18n/')))).then((ok) => {
    if (ok) loadInto(m, sender, files, reply);
    else reply({ ok: false, error: 'sender' });
  }, () => reply({ ok: false, error: 'sender' }));
  return true; // the reply comes once the files have run
});
const loadInto = (m, sender, files, reply) => {
  if (files.includes('features/mods.js')) blocklistCheck(); // a page is about to run mods: the daily blocklist check, if due
  if (files.includes('features/mods.js')) channelCheck().catch(() => {}); // and the daily check of followed mod channels
  const injected = [...new Set([...(files.includes('content-ultra.js') ? ['lib/nav.js'] : []), ...(files.includes('features/nav.js') ? ['lib/nav.js', 'lib/nav-items.js', 'lib/navlayout.js'] : []), ...(files.includes('features/navbar-canvas.js') ? ['lib/nav.js', 'lib/nav-items.js', 'lib/navlayout.js'] : []), ...(files.includes('features/navbar-moodle.js') ? ['lib/nav.js', 'lib/nav-items.js', 'lib/navlayout.js'] : []), ...(files.includes('features/navbar.js') ? ['lib/nav.js', 'lib/nav-items.js', 'lib/navlayout.js', 'lib/navbar.js'] : []), ...(files.includes('lib/navlayout.js') ? ['lib/nav.js', 'lib/nav-items.js'] : []), ...(files.includes('features/coursetabs.js') ? ['lib/coursetabs.js'] : []), ...(files.includes('features/lookparts.js') ? ['lib/lookx.js', 'lib/lookparts.js'] : []), ...files])];
  // The document that asked, where the browser names it (Chrome): one that has since navigated away gets nothing.
  // Without a documentId, the frame, after asking it whether it still holds the document that asked (content.js's
  // docId, in Glaze's own world there). Pin the probe's document id too where available. Pinned or not, a navigation
  // landing as the files go in can run them in the frame's next document before its first content script (seen on
  // Chrome), so modules must tolerate arriving before their bootstrap in a replacement document.
  let target = sender.documentId ? { tabId: sender.tab.id, documentIds: [sender.documentId] } : { tabId: sender.tab.id, frameIds: [sender.frameId] };
  const same = sender.documentId ? Promise.resolve(true)
    : chrome.scripting.executeScript({ target, func: (doc) => globalThis.__gzDoc === doc, args: [String(m.doc)] }).then((r) => {
      if (r?.[0]?.result !== true) return false;
      if (r[0].documentId) target = { tabId: sender.tab.id, documentIds: [r[0].documentId] };
      return true;
    });
  same.then((yes) => {
    if (!yes) throw new Error('the frame holds another document now');
    return chrome.scripting.executeScript({ target, files: injected, injectImmediately: true });
  }).then((results) => {
    // Every loadable file ends on a value (its module, its catalogue); a file that threw leaves none. Safari's results
    // for injected files aren't measured here, so there content.js's own check (is the module there?) decides.
    const r = results?.[0];
    if (r?.error) throw new Error(r.error.message || String(r.error));
    if (!SAFARI && r?.result == null) throw new Error('did not finish');
    reply({ ok: true });
  }).catch((e) => reply({ ok: false, error: String(e?.message || e) }));
};

// The mod blocklist (lib/blocklist.js): a signed list of mods to stop, asked for at most daily and only while a code mod is
// installed on Chrome and the setting is on. Nothing is scheduled: a page loading the mods runtime (glaze:load above) and the editor
// opening ('glaze:blocklist') wake it. One check at a time; its writes go through the broker's queue, with the mod records'.
// The network wait does not.
globalThis.addEventListener?.('install', () => importScripts('blocklist.js'));
const blocklist = () => { if (typeof GZ_BLOCKLIST === 'undefined') importScripts('blocklist.js'); return GZ_BLOCKLIST; };
let blocklistRun = null;
const blocklistCheck = () => new URL(chrome.runtime.getURL('')).protocol !== 'chrome-extension:'
  ? Promise.resolve({ ok: false, error: 'off' }) : (blocklistRun ||= blocklist().check({
  sync: brokerArea('sync'), local: brokerArea('local'), fetch: (url, init) => fetch(url, init), now: () => Date.now(),
  enqueue: (f) => (brokerTurn ||= GZ_CARDS.queue())(f),
}).catch(() => ({ ok: false, error: 'fetch' })).finally(() => { blocklistRun = null; }));
// For the mods code in this worker: the reason a mod ({ id, hash, key } of an installed record or a bundle about to be
// installed) is blocked, or ''. Refuse an install or a turn-on on any answer but ''.
const blocked = (record) => blocklist().blocked(brokerArea('local'), record);
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:blocklist') return;
  if (s.id !== chrome.runtime.id || (!s.tab && !fromEditor(s))) { reply({ ok: false, error: 'sender' }); return; }
  blocklistCheck().then(reply);
  return true;
});

// Mod channels (lib/modchannel.js): an author publishes a signed bundle to a share session; a follower's Glaze checks it
// when the editor opens (or Check now) and at most daily when a page runs mods, never otherwise. Network waits stay out
// of the broker's queue; writes to mod records go through it. Every bundle is checked by lib/modbundle.js as a hand install.
globalThis.addEventListener?.('install', () => importScripts('modchannel.js'));
const CHANNEL_OPS = new Set(['follow', 'publish', 'ownLink', 'check', 'unfollow', 'dismiss']);
const channels = () => {
  if (typeof GZ_MODCHANNEL === 'undefined') {
    brokerIn('mods');
    importScripts('relay.js', 'sharing.js', 'modchannel.js');
  }
  return GZ_MODCHANNEL;
};
const queued = (f) => (brokerTurn ||= GZ_CARDS.queue())(f);
// A channel author's key (storage.local `modChannelOwn:<id>`: the session's edit key and delete token) is kept in the
// worker's own IndexedDB, beside the share sessions' (glaze-sharing, `vault`): a script in any page can read
// storage.local, and none can read this. lib/modchannel.js asks for it through this area like any other key. One still
// in storage.local moves when it is first asked for, and the rest move once at startup (channelKeysMoved). One area
// for all, as modchannel.js keys its queues by it.
const OWN_KEY = /^modChannelOwn:[a-z2-7]{16}$/;
let channelArea = null;
const channelLocal = () => {
  if (channelArea) return channelArea;
  if (typeof GZ_SESSIONS === 'undefined') importScripts('relay.js', 'sharing.js', 'sessions.js');
  const base = brokerArea('local'), vault = GZ_SESSIONS.database();
  // Startup migration and publishing share this turn: an older copy cannot finish moving over a new author key.
  const turn = GZ_CARDS.queue();
  const names = (keys) => (typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : null);
  return (channelArea = {
    get: (keys) => turn(async () => {
      const all = names(keys);
      if (!all?.some((k) => OWN_KEY.test(k))) return base.get(keys);
      const out = all.some((k) => !OWN_KEY.test(k)) ? await base.get(all.filter((k) => !OWN_KEY.test(k))) : {};
      for (const k of all.filter((x) => OWN_KEY.test(x))) {
        let v = await vault.get('vault', k);
        if (v === undefined) {
          v = (await base.get(k))[k];
          if (v !== undefined) await vault.put('vault', k, v);
        }
        // A prior removal may have failed after the vault write committed. Retry it even when the vault already wins.
        if (v !== undefined) { if (!await base.remove(k)) throw new Error('storage'); out[k] = v; }
      }
      return out;
    }),
    set: (patch) => turn(async () => {
      const own = Object.keys(patch).filter((k) => OWN_KEY.test(k)), rest = Object.fromEntries(Object.entries(patch).filter(([k]) => !OWN_KEY.test(k)));
      try { for (const k of own) await vault.put('vault', k, patch[k]); } catch { return false; }
      // A copy left in storage.local goes with the write: the new one is the only one.
      if (own.length && !await base.remove(own)) return false;
      return Object.keys(rest).length ? base.set(rest) : true;
    }),
    remove: (keys) => turn(async () => {
      const all = names(keys) || [];
      if (!await base.remove(all)) return false;
      try { for (const k of all.filter((x) => OWN_KEY.test(x))) await vault.del('vault', k); } catch { return false; }
      return true;
    }),
  });
};
const moveChannelKeys = async () => {
  const flag = 'channelKeysMoved';
  if ((await chrome.storage.local.get(flag))[flag]) return;
  const stored = chrome.storage.local.getKeys ? await chrome.storage.local.getKeys() : Object.keys(await chrome.storage.local.get(null));
  const own = stored.filter((k) => OWN_KEY.test(k));
  if (own.length) {
    await channelLocal().get(own);
    if (Object.keys(await chrome.storage.local.get(own)).length) return; // one stayed: tried again at the next start
  }
  await chrome.storage.local.set({ [flag]: true });
};
const channelEnv = () => ({ local: channelLocal(), fetch: (u, i) => fetch(u, i), now: () => Date.now(), blocked, enqueue: queued,
  install: (m) => GZ_MODBUNDLE.change(m, { local: brokerArea('local') }) });
const channelCheck = (opts) => channels().check(channelEnv(), opts);
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:modchannel') return;
  if (!fromEditor(s) || s.frameId !== 0 || s.origin !== chrome.runtime.getURL('').replace(/\/$/, '') || !CHANNEL_OPS.has(m.op)) { reply({ ok: false, error: 'sender' }); return; }
  const id = typeof m.id === 'string' && /^[a-z2-7]{16}$/.test(m.id) ? m.id : null;
  (async () => {
    if (m.id !== undefined && !id) return { ok: false, error: 'bad' };
    const C = channels(), env = channelEnv();
    if (m.op === 'follow') {
      // The newest bundle for the editor's install prompt; nothing is stored until the student installs it.
      try { const got = await C.latest(m.link, env); return { ok: true, zip: GZ_MODBUNDLE.std(got.bytes), link: got.link }; } catch (e) { return { ok: false, error: e.code || 'network' }; }
    }
    if (m.op === 'publish') {
      if (typeof m.zip !== 'string' || m.zip.length > Math.ceil(GZ_MODBUNDLE.CAP.archive / 3) * 4) return { ok: false, error: 'bad' };
      let bytes;
      try { bytes = Uint8Array.from(atob(m.zip), (c) => c.charCodeAt(0)); } catch { return { ok: false, error: 'bad' }; }
      const server = GZ_RELAY.normalize((await chrome.storage.sync.get('shareRelay')).shareRelay) || GZ_SHARING.SERVER;
      return C.publish(bytes, { ...env, server });
    }
    if (m.op === 'check') return channelCheck({ force: true, id });
    if (!id) return { ok: false, error: 'bad' };
    if (m.op === 'ownLink') return C.ownLink(id, env);
    return queued(() => (m.op === 'unfollow' ? C.unfollow : C.dismiss)(id, env));
  })().then(reply, () => reply({ ok: false, error: 'network' }));
  return true;
});

// Course tabs' snapshots (features/coursetabs.js): pictures of course pages the student was on (the visible tab, taken
// here at the page's ask, only while that tab is the one on screen), kept for a tab switch after a reload. In storage.session, which the browser holds in memory and never writes to disk, and which pages'
// content scripts can't read (only this worker); where a browser has none, in this worker's memory. Gone when the browser
// closes, when Glaze or the tabs are switched off (below), when another account turns up on the site, or on sign-out.
// Only a Canvas or Ultra page's top frame asks, for its own origin (never one the message names). Sizes: lib/coursetabs.js.
const SNAP_MEM = new Map();
let snapTurn;
const snapQueue = (fn) => (snapTurn ||= GZ_CARDS.queue())(fn);
const snapArea = chrome.storage.session || {
  get: async (k) => (k === null ? Object.fromEntries(SNAP_MEM) : SNAP_MEM.has(k) ? { [k]: SNAP_MEM.get(k) } : {}),
  set: async (o) => { for (const [k, v] of Object.entries(o)) SNAP_MEM.set(k, v); },
  remove: async (ks) => { for (const k of [].concat(ks)) SNAP_MEM.delete(k); },
};
// The keys alone where the browser can (getKeys): reading everything would read every picture.
const allKeys = async () => (snapArea.getKeys ? snapArea.getKeys() : Object.keys(await snapArea.get(null)));
const snapKeys = async (site) => (await allKeys()).filter((k) => k.startsWith(site ? `snap:${site}|` : 'snap:'));
// Only documents that identified themselves here receive cache/account invalidations.
const snapNotify = async (site, state) => {
  await Promise.allSettled(state.docs.map(async (d) => {
    const tab = await chrome.tabs.get(d.tab);
    const u = new URL(tab.url);
    if (u.origin !== site) return;
    await chrome.tabs.sendMessage(d.tab, { type: 'glaze:tabs-state', site, uid: state.uid, epoch: state.epoch }, d.id ? { documentId: d.id } : { frameId: 0 });
  }));
};
const snapEpoch = (previous) => Math.max(Date.now(), (previous || 0) + 1);
// The picture of tab `tabId` as it is on screen now, or null: the tab must be its window's active one before and after
// (a switch of browser tab in between throws it away), still on `site`.
const snapShot = async (tabId, site) => {
  const before = await chrome.tabs.get(tabId).catch(() => null);
  if (!before?.active || !before.url?.startsWith(`${site}/`)) return null;
  // Shown blurred (features/coursetabs.js picture): a lower quality is not seen, and is a smaller picture to keep.
  const shot = await chrome.tabs.captureVisibleTab(before.windowId, { format: 'jpeg', quality: 60 }).catch(() => null);
  const after = await chrome.tabs.get(tabId).catch(() => null);
  return shot && after?.active && after.windowId === before.windowId && after.url?.startsWith(`${site}/`) && /^data:image\/jpeg;base64,/.test(shot) ? shot : null;
};
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:snap') return;
  snapQueue(async () => {
    const ultra = s.frameId === 0 && await fromUltra(s);
    const site = ultra || (s.frameId === 0 && await fromCanvas(s));
    const kind = ultra ? 'ultra' : 'canvas';
    if (!site || !await switchOn('tabs') || !GZ_CTABS_LIB.validId(m.uid, kind)) return null;
    // Birth time orders documents across account changes; the extension sender authorizes every request.
    if (!Number.isSafeInteger(s.tab?.id) || s.tab.id < 0 || !Number.isFinite(m.born) || m.born <= 0 || m.born > Date.now() + 1000
      || (s.documentId !== undefined && (typeof s.documentId !== 'string' || !s.documentId || s.documentId.length > 128))) return null;
    const who = `snapwho:${site}`;
    let state = (await snapArea.get(who))[who];
    if (!state || typeof state !== 'object' || !Array.isArray(state.docs)) state = { uid: null, floor: 0, epoch: 0, docs: [] };
    const matches = (d) => d.tab === s.tab.id && (s.documentId ? d.id === s.documentId : !d.id && d.born === m.born);
    const doc = state.docs.find(matches);
    if (m.op === 'hello') {
      if ((doc && (doc.revoked || doc.uid !== m.uid || doc.born !== m.born)) || (!doc && m.born <= state.floor)) return { stale: true };
      if (state.uid !== m.uid) {
        await snapArea.remove(await snapKeys(site));
        state.floor = state.uid || state.epoch ? Math.max(state.floor, Date.now()) : 0;
        state.docs.forEach((d) => { d.revoked = true; });
        state.uid = m.uid;
        state.epoch = snapEpoch(state.epoch);
      }
      if (!doc) state.docs.push({ tab: s.tab.id, id: s.documentId || '', born: m.born, uid: m.uid, revoked: false });
      state.docs = state.docs.slice(-64);
      await snapArea.set({ [who]: state });
      await snapNotify(site, state);
      return { ok: true, epoch: state.epoch };
    }
    if (!doc || doc.born !== m.born || doc.revoked || doc.uid !== m.uid || state.uid !== m.uid || m.epoch !== state.epoch) return null;
    if (m.op === 'drop') {
      await snapArea.remove(await snapKeys(site));
      state.epoch = snapEpoch(state.epoch);
      if (m.signout) { state.uid = null; state.floor = Math.max(state.floor, Date.now()); state.docs.forEach((d) => { d.revoked = true; }); }
      await snapArea.set({ [who]: state });
      await snapNotify(site, state);
      return { ok: true };
    }
    if (!GZ_CTABS_LIB.validId(m.cid, kind)) return null;
    const k = `snap:${site}|${m.uid}|${m.cid}`;
    if (m.op === 'forget') return snapArea.remove(k).then(() => true);
    if (m.op === 'get') return (await snapArea.get(k))[k] || null;
    if (m.op !== 'shot') return null;
    const path = String(m.path), q = path.indexOf('?'), p = q < 0 ? path : path.slice(0, q);
    if (GZ_CTABS_LIB.safe(p, q < 0 ? '' : path.slice(q + 1)) !== path || !GZ_CTABS_LIB.owns(p, m.cid)) return null;
    const nums = (a, n) => Array.isArray(a) && a.length === n && a.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e5) ? a.map(Math.round) : null;
    const size = nums(m.size, 2), strip = m.strip === null ? null : nums(m.strip, 3);
    if (!size || (m.strip !== null && !strip)) return null;
    const shot = await snapShot(s.tab.id, site);
    if (!shot || shot.length > GZ_CTABS_LIB.SNAP_ONE) return null;
    const snap = { cid: m.cid, path, at: Date.now(), strip, size, shot, n: shot.length };
    // The least recently kept go first, past the total (every site and account together). Sizes from this site's record
    // (state.sizes, kept beside the pictures and checked against the keys there); the pictures are read only for keys it lacks.
    const keys = (await snapKeys()).filter((x) => x !== k), sizes = state.sizes || {};
    const all = keys.some((x) => !sizes[x]) ? await snapArea.get(null) : {};
    const of = (x) => sizes[x] || [all[x]?.n || 0, all[x]?.at || 0];
    const drop = GZ_CTABS_LIB.fit([...keys.map((x) => [x, ...of(x)]), [k, snap.n, snap.at]]);
    if (!drop.includes(k)) {
      await snapArea.remove(drop);
      state.sizes = Object.fromEntries([...keys, k].filter((x) => x.startsWith(`snap:${site}|`) && !drop.includes(x)).map((x) => [x, x === k ? [snap.n, snap.at] : of(x)]));
      await snapArea.set({ [k]: snap, [who]: state });
    }
    return { snap };
  }).then((r) => reply(r ? (m.op === 'get' ? { snap: r } : typeof r === 'object' ? r : { ok: true }) : null), () => reply(null));
  return true;
});
// Carry the observed off event through the queue: a rapid on event must not erase the clear.
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'sync' || !(c.enabled?.newValue === false || c.enhance?.newValue?.tabs === false)) return;
  snapQueue(async () => {
    await snapArea.remove(await snapKeys());
    for (const k of (await allKeys()).filter((x) => x.startsWith('snapwho:'))) {
      const state = (await snapArea.get(k))[k];
      if (!Array.isArray(state?.docs)) continue;
      state.epoch = snapEpoch(state.epoch);
      await snapArea.set({ [k]: state });
      await snapNotify(k.slice(8), state);
    }
  });
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
      // A Canvas or Ultra page, for an account of its own site, with its range's start and the events it worked out, and
      // whether it read them whole (an Ultra read can be partial: then nothing is deleted for being missing).
      const site = (await fromCanvas(s)) || (await fromUltra(s));
      const src = typeof m.src === 'string' && m.src.slice(0, m.src.lastIndexOf('/'));
      if (!site || src !== site || !GZ_TODO.STORE_KEY.test(`todo:${m.src}`) || !Number.isFinite(m.from) || !/^\d{4}-\d{2}-\d{2}$/.test(m.first) || !Array.isArray(m.events)
        || typeof m.consent !== 'string' || m.consent.length > 4000 || typeof m.whole !== 'boolean') return { ok: false, error: 'sender' };
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

// Signed URLs come only from the active content script's Canvas API; bytes never pass through the page. The port comes from
// a course page's top frame or from a course tab's frame (trustedFrame).
// Acknowledgements bound Chrome's JSON message queue; disconnect aborts both fetch and reader.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'canvas-zip') return;
  let origin;
  try {
    if (!trustedFrame(port.sender, 'download')) return port.disconnect();
    origin = new URL(port.sender.url);
  } catch { return port.disconnect(); }
  // Production has HTTPS hosts only. The explicit localhost permission exists only in scratch builds.
  const dev = origin.hostname === 'localhost' && chrome.runtime.getManifest().host_permissions.includes('http://localhost/*') ? origin.origin : '';
  if (!GZ_DOWNLOAD.url(origin.href, dev)) return port.disconnect();
  const ready = approved('canvas', origin).catch(() => false);
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
