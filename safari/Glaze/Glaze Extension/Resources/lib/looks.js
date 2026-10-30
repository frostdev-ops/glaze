// The Looks catalogue: every Look the student can pick, as one list. Built in (defaults.js GZ_LOOKS), then their own: the
// themes they saved and the gallery's they installed or saved, kept on this device in storage.local `lookFavorites`
// ({ code, name, author, at, id, from }; lib/history.js favor). A Look is known by its id, never by its name, which two can
// share: a built-in Look's id is its name (never translated, and what an older Glaze on another device reads in the synced
// courses.looks); a kept one's is `c:` and a hash of its code (in the synced courseLooks, which an older Glaze leaves alone),
// so the same gallery Look installed on two devices is the same Look on both, and a rename keeps it. The worker decodes the codes (lib/background.js) into storage.local
// `lookCatalog`, { sig, looks }, and every page reads that, never the codes: each kept Look's palette, look and background
// as its code wears them (the keys it carries; the rest stay the student's, as lib/lookx.js wearCode has it), a hash of its
// parts, and its kind: 'saved', 'gallery', or 'background' (a gallery Look whose background moves). Mods that bring a
// background lay it over whichever Look is worn while they are on (features/mods.js): they stay mods, not Looks.
// Classic script (the worker, the editor, the popup; the course menu and the palette load it on demand); module.exports
// for node.
var GZ_CATALOG = globalThis.GZ_CATALOG || (() => {
  const G = typeof GZ_LOOKS !== 'undefined' ? { GZ_LOOKS, GZ_LOOK_ON } : require('../defaults.js');
  const KEY = 'lookCatalog';
  const ID = /^c:[0-9a-z]{14}$/; // as defaults.js's courseLooks
  // Two 32-bit FNV-1a passes with different primes, as 14 base36 characters. keptAll refuses a known collision.
  const hash = (text) => {
    let a = 2166136261, b = 2166136261;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 2246822519); }
    return (a >>> 0).toString(36).padStart(7, '0') + (b >>> 0).toString(36).padStart(7, '0');
  };
  const idOf = (code) => `c:${hash(code)}`;
  const ANIMATED = ['aurora', 'scene', 'shader', 'layers', 'media'];
  const kindOf = (from, bg) => (from !== 'gallery' ? 'saved' : ANIMATED.includes(bg?.kind) ? 'background' : 'gallery');

  // ---- the kept Looks, as stored ----------------------------------------------------------------------------------
  // One entry, or null: its id (one from before ids, from its code), and where it came from (one from before that: the
  // gallery's had an author, a pasted code none).
  const kept = (f) => (f && typeof f === 'object' && typeof f.code === 'string' && typeof f.name === 'string' ? {
    id: idOf(f.code), code: f.code, name: f.name, author: typeof f.author === 'string' ? f.author : '',
    at: typeof f.at === 'number' ? f.at : 0, from: f.from === 'gallery' || f.from === 'saved' ? f.from : f.author ? 'gallery' : 'saved',
  } : null);
  // Same code: first (newest) wins, including its name. Different codes with one hash: neither may be selected by that id.
  // Keep the originals in favorites for recovery; never silently wear, unmap or delete a different Look.
  const keptAll = (list) => {
    const by = new Map(), conflicts = new Set();
    for (const e of (Array.isArray(list) ? list : []).map(kept).filter(Boolean)) {
      const old = by.get(e.id);
      if (old && old.code !== e.code) conflicts.add(e.id);
      if (!old) by.set(e.id, e);
    }
    return [...by.values()].filter((e) => !conflicts.has(e.id));
  };
  // A new one to keep (lib/history.js favor puts it first).
  const make = (code, name, author, from) => ({ code, name, author: author || '', at: Date.now(), id: idOf(code), from });

  // ---- the catalogue the worker writes --------------------------------------------------------------------------------
  const sig = (favorites) => hash(JSON.stringify(favorites ?? null));
  const px = (parts) => (parts ? hash(JSON.stringify(parts)) : '');
  // From `favorites` as stored. decode(code) → lib/share.js decode's answer, or null (or a throw) for one Glaze won't wear,
  // which is left out. `was`, the catalogue before: an entry whose code is unchanged is kept, not decoded again.
  const build = async (favorites, decode, was) => {
    const before = new Map(looks(was).map((E) => [E.id, E]));
    const out = [];
    for (const e of keptAll(favorites)) {
      const h = hash(e.code), old = before.get(e.id);
      if (old?.h === h) { out.push({ ...old, name: e.name, author: e.author, kind: kindOf(e.from, old.bg), at: e.at }); continue; }
      let got = null;
      try { got = await decode(e.code); } catch { /* damaged, or not one Glaze wears */ }
      if (got) out.push({ id: e.id, name: e.name, author: e.author, kind: kindOf(e.from, got.bg), at: e.at, h, colors: got.colors, look: got.look, bg: got.bg, px: px(got.parts) });
    }
    return { sig: sig(favorites), looks: out };
  };

  // ---- reading it --------------------------------------------------------------------------------------------------
  // The kept Looks of a stored catalogue (storage.local is Glaze's own, but an old or hand-edited one mustn't break a page).
  const looks = (cat) => (Array.isArray(cat?.looks) ? cat.looks.filter((E) => E && ID.test(E.id) && typeof E.name === 'string' && E.colors && E.look && E.bg) : []);
  // Every Look: { id, name, kind, colors, look, bg } and, for a built-in, L (for GZ_LOOK_APPLY and its parts).
  const list = (cat) => [...G.GZ_LOOKS.map((L) => ({ id: L.name, name: L.name, kind: 'builtin', colors: L.colors, look: L.look, bg: L.bg, L })), ...looks(cat)];
  const find = (all, id) => all.find((E) => E.id === id) || null;
  // [[group, entries]] of the groups with any, in order: 'builtin', 'saved', 'gallery' (with the backgrounds).
  const groups = (all) => ['builtin', 'saved', 'gallery'].map((g) => [g, all.filter((E) => (E.kind === 'background' ? 'gallery' : E.kind) === g)]).filter(([, l]) => l.length);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Whether settings `s` wear Look E as it was put on: a built-in as GZ_LOOK_ON says; a kept one's palette, each look and
  // background value its code carries, and its parts where `s` has them (the editor's and the popup's do). Key by key: Chrome
  // hands a stored object back with its keys sorted.
  const carries = (a, b) => Object.keys(b).every((k) => same(a[k], b[k]));
  const on = (s, E) => (E.L ? G.GZ_LOOK_ON(s, E.L) : !s.auto.on && carries(s.colors, E.colors) && carries(s.look, E.look) && carries(s.bg, E.bg) && (!('parts' in s) || px(s.parts) === E.px));
  // The one Look worn: a kept one first (it is the more particular), else a built-in, else null.
  const worn = (s, all) => all.find((E) => !E.L && on(s, E)) || all.find((E) => E.L && on(s, E)) || null;
  // A card's strip: its background's colors, else its palette's accents (a solid one stays plain).
  const tone = (E) => (E.bg.colors?.length ? E.bg.colors : E.bg.kind === 'solid' ? [E.colors['--gz-surface-2']] : [E.colors['--gz-accent'], E.colors['--gz-accent-hi']]);

  // ---- what refers to Looks ------------------------------------------------------------------------------------------
  // Look rotation's ticks (storage.local rotateLooks) as ids: a kept Look's code, as ticks were before ids, is its id.
  const ids = (chosen, favorites) => {
    const by = new Map(keptAll(favorites).map((e) => [e.code, e.id]));
    return Array.isArray(chosen) ? chosen.map((v) => (typeof v === 'string' && by.has(v) ? by.get(v) : v)) : [];
  };
  // Takes Look `id` off every course that wears it (settings.courses and settings.courseLooks, changed in place): back to the
  // student's theme.
  const unmap = (courses, id, kept) => {
    let n = 0;
    for (const map of [courses.looks, kept]) for (const [cid, v] of Object.entries(map)) if (v === id) { delete map[cid]; n++; }
    return n > 0;
  };

  // Kept ids an earlier 4.0 left in courses.looks, moved to courseLooks where it has room (one it has for the course stays), so
  // a 3.x device on the same sync account doesn't write them away (lib/background.js): whether any moved. `s` sanitized,
  // changed in place.
  const move = (s) => {
    const D = typeof GZ_SYNC_BYTES !== 'undefined' ? { GZ_SYNC_BYTES, GZ_SYNC_ITEM_MAX } : require('../defaults.js');
    let moved = false;
    for (const [cid, v] of Object.entries(s.courses.looks)) {
      if (!ID.test(v)) continue;
      if (!Object.hasOwn(s.courseLooks, cid)) {
        if (Object.keys(s.courseLooks).length >= 200 || D.GZ_SYNC_BYTES('courseLooks', { ...s.courseLooks, [cid]: v }) > D.GZ_SYNC_ITEM_MAX) continue;
        s.courseLooks[cid] = v;
      }
      delete s.courses.looks[cid];
      moved = true;
    }
    return moved;
  };
  // A course's kept Look where a 3.x device has since picked a built-in one (the newer pick, worn already) goes from
  // courseLooks, so that device's "Your theme" later is the theme here too: whether any went. `s` sanitized, changed in place.
  const clear = (s) => {
    let cleared = false;
    for (const [cid, v] of Object.entries(s.courses.looks)) if (Object.hasOwn(s.courseLooks, cid) && G.GZ_LOOKS.some((L) => L.name === v)) { delete s.courseLooks[cid]; cleared = true; }
    return cleared;
  };

  return { KEY, ID, hash, idOf, kept, keptAll, make, sig, build, looks, list, find, groups, on, worn, tone, ids, unmap, move, clear };
})();

if (typeof module !== 'undefined') module.exports = GZ_CATALOG; else GZ_CATALOG;
