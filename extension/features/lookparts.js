// Look parts on the page: the Look's `x` (lib/lookparts.js), read after the first paint and
// only when a Look has any; content.js asks for this file then, and not otherwise. It keeps the cleaned, frozen `x` for
// GZ_CTX.parts() and fires `glaze:parts` on the document when it changes (no detail: the feature reading it asks
// GZ_CTX.parts() again, so a page script faking the event learns nothing and sets nothing).
// parts() is null on a quiz or tool page (lib/lookx.js quiet) and while Glaze is off (content.js); on a course that wears a
// Look of its own they are that Look's (read), and none until they come. The event does not fire for the first two,
// so a feature that draws something checks parts() when it draws, as it checks its own switch.
// The editor's preview feeds it with preview() instead of storage. Classic script; loaded on demand (the worker adds
// lib/lookx.js and lib/lookparts.js to it); a second injection keeps the first.
var GZ_XPARTS_PAGE = globalThis.GZ_XPARTS_PAGE || (() => {
  const L = GZ_XPARTS;
  // of: the course Look (GZ_CTX.courseLook) the parts are, or null for the theme's: a course's are given only on that course.
  let x = null, of = null, sig = '[null,false,null]', seq = 0, modBg = false;
  const course = () => globalThis.GZ_CTX?.courseLook?.() || null;
  const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
  const set = (next) => {
    const s = JSON.stringify([next, modBg, of]);
    if (s === sig) return;
    sig = s;
    x = next ? freeze(next) : null;
    document.dispatchEvent(new CustomEvent('glaze:parts'));
  };
  const quiet = () => !!globalThis.GZ_LX?.quiet(location.pathname, document)
    || /\/(quizzes|external_tools|assessment|attempt|lti)(\/|$)|\/mod\/(quiz|lti)(\/|$)/.test(location.pathname);
  // A packed string as { x, m }. What the cleaners stand on is on demand too, asked for only when the parts need it: the
  // nav cleaner (lib/navlayout.js; the worker brings lib/nav.js and lib/nav-items.js before it) for a nav, and the motion
  // tables (lib/motionx.js) for animations, effects, a pointer, a cursor effect, typing or a layer's particles.
  const libs = async (x) => {
    if (x?.nav && !globalThis.GZ_NAV_LAYOUT) await globalThis.GZ_CTX.need('lib/navlayout.js', () => globalThis.GZ_NAV_LAYOUT);
    if ((x?.anim || x?.fx || x?.cursor || x?.pointer || x?.type || x?.bg?.layers) && !globalThis.GZ_MX) await globalThis.GZ_CTX.need('lib/motionx.js', () => globalThis.GZ_MX);
    if (x?.rules && !globalThis.GZ_PARTS) await globalThis.GZ_CTX.need('lib/parts.js', () => globalThis.GZ_PARTS);
  };
  const unpack = async (packed) => {
    const raw = await L.parse(packed);
    await libs(raw?.x);
    return L.bundle(raw);
  };
  // Installed mods' parts, on every browser and whether or not their code can run here: the worker's 'parts' ask (lib/modbroker.js)
  // hands those of the mods that are on and not blocklisted, cleaned, in the student's order; they are cleaned again here.
  // Like the Look's, these apply in the top frame and live course-tab frames. L.over lays them over the Look's.
  let watching = false, hasMods = false, wasQuiet;
  const pass = () => {
    if (!watching) return;
    const q = quiet();
    if (q === wasQuiet) return;
    wasQuiet = q;
    document.dispatchEvent(new CustomEvent('glaze:parts'));
    if (!q && hasMods) read(); // a worker reply made on a quiz contains no mod parts
  };
  const theirs = async (local) => {
    if (!GZ_CTX.solo) return [];
    const ids = (await local.get('mods')).mods;
    hasMods = Array.isArray(ids) && ids.length > 0;
    if (!hasMods) return [];
    if (!watching) {
      watching = true;
      wasQuiet = quiet();
      globalThis.navigation?.addEventListener('navigatesuccess', pass);
      addEventListener('popstate', pass);
    }
    const a = await chrome.runtime.sendMessage({ type: 'glaze:modpage', op: 'parts' }), out = [];
    for (const x of Array.isArray(a?.parts) ? a.parts : []) { await libs(x); const c = L.clean(x); if (c) out.push(c); }
    return out;
  };
  // From storage: sync `lookX`, or local's when sync says so, and the mods'; on a course wearing a Look of its own (GZ_COURSE_LOOK_ID),
  // that Look's, which the worker gives by its id (lib/background.js looks). The latest read wins, whatever order they finish in.
  const read = async () => {
    const mine = ++seq, id = course();
    let P = null, M = [];
    const { sync, local } = L.areas();
    try {
      if (id) {
        const a = await chrome.runtime.sendMessage({ type: 'glaze:looks', op: 'parts', id });
        if (a?.ok && a.parts) { await libs(a.parts.x); P = L.bundle(a.parts); }
      } else {
        const packed = await L.stored((await sync.get('lookX')).lookX, local);
        P = packed ? await unpack(packed) : null;
      }
    } catch { /* unreadable: no parts */ }
    try { M = await theirs(local); } catch { /* no mods' parts */ }
    if (mine !== seq) return;
    modBg = M.some((p) => p.bg);
    of = id;
    set(L.over(P?.x ?? null, M));
  };
  // From the editor's preview: { x, m } as the editor holds them, or null, under the installed mods' parts as a page has them,
  // so a student sees a mod's background there too.
  const preview = async (P) => {
    const mine = ++seq;
    let got = null, M = [];
    try { got = P ? L.bundle(P) : null; } catch { /* no parts */ }
    try {
      const a = await chrome.runtime.sendMessage({ type: 'glaze:modpage', op: 'parts' });
      for (const x of Array.isArray(a?.parts) ? a.parts : []) { await libs(x); const c = L.clean(x); if (c) M.push(c); }
    } catch { /* no mods' parts */ }
    if (mine !== seq) return;
    modBg = M.some((p) => p.bg);
    of = null; // the editor's Look: a course with a Look of its own shows none of these
    set(L.over(got?.x ?? null, M));
  };
  // Only mods override the selected kind; use the background after code overrides have merged too.
  const bgKind = (bg) => bg && (modBg || globalThis.GZ_MODS?.hasBg()) ? (bg.shader ? 'shader' : bg.media ? 'media' : 'layers') : null;
  return { now: () => (x && !quiet() && of === course() ? x : null), read, preview, bgKind, pass };
})();
GZ_XPARTS_PAGE;
