// Declarative widgets on the page: mods with no code whose tiles and rail widgets are blocks in their mod.json (lib/modwidget.js).
// Unlike features/mods.js this runs wherever Glaze does, Firefox and Safari too, since it starts no frame, Worker or sandbox.
// content.js loads it when the worker's list names such a mod that is on, in the top frame of a page Glaze is on. For each of
// their tiles on the widget boards (features/widgets.js declare) and rail widgets on the nav (features/nav.js) it asks the
// worker for the widget's tree ('widget': the worker reads only the data the mod declared and the student granted, for this
// site, and cleans the tree) and draws it in a closed root with features/modui.js, which sets text and properties only. A button
// runs one of Glaze's own actions, a page of this LMS, never an address a mod chose. Nothing polls: a widget is asked for
// again when its data, the mods or the page's visibility change, and once at the time its answer next changes by itself.
var GZ_MODWIDGETS = globalThis.GZ_MODWIDGETS || (() => {
  const ctx = () => globalThis.GZ_CTX;
  const t = (k) => ctx().t(k);
  const alive = () => !!globalThis.chrome?.runtime?.id;
  const ask = (m) => (alive() ? chrome.runtime.sendMessage({ type: 'glaze:modpage', ...m }).catch(() => null) : Promise.resolve(null));

  let list = []; // [{ id, name, slots: [{ key, name, size }] }], from the worker, in the student's order
  let wired = false, asking = 0, revision = 0, drawing = 0;
  const mounts = new Map(); // `${mod}|${slot}` → { root, timer, n, acts, links }
  const railBoxes = new Map(); // `${mod}|${slot}` → the rail's element
  const assets = new Map(); // `${mod}|${path}` → Promise<ImageBitmap>

  const ui = () => (globalThis.GZ_MODUI ? Promise.resolve(globalThis.GZ_MODUI) : ctx()?.need('features/modui.js', () => globalThis.GZ_MODUI).then(() => globalThis.GZ_MODUI));
  // One of the mod's pictures, asked of the worker (which gives only that mod's own files), decoded here.
  const asset = (id, path) => {
    const k = `${id}|${path}`;
    if (!assets.has(k)) {
      const pending = ask({ op: 'asset', mod: id, path }).then((a) => {
        if (!a?.ok) throw new Error('asset');
        return createImageBitmap(new Blob([Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0))], { type: a.type }));
      });
      assets.set(k, pending);
      pending.catch(() => { if (assets.get(k) === pending) assets.delete(k); });
    }
    return assets.get(k);
  };

  // ---- buttons: Glaze's own actions ------------------------------------------------------------------------------------------
  const PLACE = {
    ultra: { dashboard: '/ultra/institution-page', courses: '/ultra/course', grades: '/ultra/grades', calendar: '/ultra/calendar' },
    canvas: { dashboard: '/', courses: '/courses', grades: '/grades', calendar: '/calendar' },
    moodle: { dashboard: '/my/', courses: '/my/courses.php', grades: '/grade/report/overview/index.php', calendar: '/calendar/view.php?view=month' },
  };
  const COURSE = { ultra: [/^_\d+_\d+$/, (id) => `/ultra/courses/${id}/outline`], canvas: [/^\d+$/, (id) => `/courses/${id}`], moodle: [/^\d+$/, (id) => `/course/view.php?id=${id}`] };
  // The page an action goes to, on this site only: the next to-do's own link came from the worker, built on this site's origin.
  const go = (m, id) => {
    const action = Object.hasOwn(m.acts, id) ? m.acts[id] : '', site = ctx()?.site;
    let to = '';
    if (action === 'next') to = m.links.next;
    else if (action === 'course') to = typeof m.links.cid === 'string' && COURSE[site]?.[0].test(m.links.cid) ? COURSE[site][1](m.links.cid) : '';
    else to = PLACE[site]?.[action] || '';
    try { const u = new URL(to, location.origin); if (typeof to === 'string' && to && u.origin === location.origin) location.assign(u.href); } catch { /* not an address */ }
  };

  // ---- one widget ------------------------------------------------------------------------------------------------------------
  // Draw it, and again at the time its answer next changes by itself. A hidden page draws when it is shown again.
  const draw = async (k) => {
    const m = mounts.get(k);
    if (!m || document.hidden) return;
    clearTimeout(m.timer);
    const n = ++m.n, [mod, slot] = k.split('|');
    const [U, a] = await Promise.all([ui(), ask({ op: 'widget', mod, slot, lang: document.documentElement.lang || navigator.language })]).catch(() => []);
    if (!U || mounts.get(k) !== m || n !== m.n) return; // the renderer did not load, or this answer is old
    m.acts = a?.ok && a.acts ? a.acts : {};
    m.links = a?.ok && a.links ? a.links : {};
    const note = (text) => ({ type: 'text', text, size: 's', muted: true });
    // A mod that went (turned off, removed, blocked) shows nothing; the storage change that did it updates the list.
    const tree = a?.ok && a.tree ? a.tree : a?.ok ? note(a.why === 'denied' ? t('This widget’s data is turned off. Turn it on in the Mods tab of Glaze’s editor.') : t('Nothing to show yet.')) : null;
    U.render(m.root, tree, { send: (kind, id) => { if (kind === 'click') go(m, id); }, asset: (p) => asset(mod, p), canvas: null });
    if (Number.isFinite(a?.until)) m.timer = setTimeout(() => draw(k), Math.min(2 ** 31 - 1, Math.max(1000, a.until - Date.now()) + 50));
  };
  // The slot's element `el` takes the widget. → stop().
  const attach = (id, key, el) => {
    const k = `${id}|${key}`;
    detach(k);
    const m = { root: el.attachShadow({ mode: 'closed' }), timer: 0, n: 0, acts: {}, links: {} };
    mounts.set(k, m);
    draw(k);
    return () => detach(k, m);
  };
  const detach = (k, only) => {
    const m = mounts.get(k);
    if (!m || (only && m !== only)) return;
    mounts.delete(k);
    clearTimeout(m.timer);
    m.root.replaceChildren();
  };
  const redraw = () => { clearTimeout(drawing); drawing = setTimeout(() => { for (const k of mounts.keys()) draw(k); }, 300); };

  // ---- where they go ----------------------------------------------------------------------------------------------------------
  // Tiles for features/widgets.js: { tile id: { name, size, owner, fill } }, an id of the kind the layout keeps for a mod's tiles
  // (lib/widgets.js change): m, the mod id's first 14 characters and the tile's place in its manifest. A mod is code or
  // declarative, never both, so these never meet features/mods.js's.
  const tiles = () => Object.fromEntries(list.flatMap((m) => m.slots.filter((s) => s.key.startsWith('tile:')).map((s, i) => [`m${m.id.slice(0, 14)}${i}`, {
    name: s.name, size: s.size, owner: `${m.id}|${s.key}`,
    fill: (body) => {
      const el = document.createElement('div');
      el.style.cssText = 'width:100%';
      body.append(el);
      return { stop: attach(m.id, s.key, el) };
    },
  }])));
  // Rail widgets for features/nav.js to put among its own.
  const rail = () => {
    const want = list.flatMap((m) => m.slots.filter((s) => s.key.startsWith('rail:')).map((s) => [m, s]));
    for (const k of [...railBoxes.keys()]) if (!want.some(([m, s]) => `${m.id}|${s.key}` === k)) { detach(k); railBoxes.get(k).remove(); railBoxes.delete(k); }
    return want.map(([m, s]) => {
      const k = `${m.id}|${s.key}`;
      if (!railBoxes.has(k)) {
        const box = document.createElement('div');
        box.className = 'gz-nav-widget gz-mod-rail';
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', s.name);
        const el = document.createElement('div');
        el.style.cssText = 'width:100%';
        box.append(el);
        railBoxes.set(k, box);
        attach(m.id, s.key, el);
      }
      return { key: k, el: railBoxes.get(k) };
    });
  };
  const place = () => {
    if (!ctx()) return;
    globalThis.GZ_WIDGETS_UI?.declare?.(tiles(), 'plain');
    const want = list.some((m) => m.slots.some((s) => s.key.startsWith('rail:')));
    if (want || railBoxes.size) {
      if (!want) rail();
      ctx().need('features/nav.js', () => globalThis.GZ_NAV_UI).then(() => GZ_NAV_UI.sync(), () => {});
    }
  };

  // ---- following the mods -----------------------------------------------------------------------------------------------------
  // Ask the worker which widgets to show; a new list is put in place, and `force` draws the widgets again whatever came.
  const refresh = (force = false) => {
    clearTimeout(asking);
    const current = ++revision;
    asking = setTimeout(() => ask({ op: 'list' }).then((a) => {
      if (current !== revision) return;
      const next = Array.isArray(a?.plain) ? a.plain : [];
      const changed = JSON.stringify(next) !== JSON.stringify(list);
      list = next;
      if (changed) place();
      if (changed || force) {
        // A mod that changed may carry other pictures under the same names: they are asked for again.
        for (const p of assets.values()) p.then((bm) => bm.close(), () => {});
        assets.clear();
        for (const k of mounts.keys()) draw(k);
      }
    }), 50);
  };
  const wire = () => {
    wired = true;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) for (const k of mounts.keys()) draw(k); });
    chrome.storage.onChanged.addListener((c, area) => {
      if (!alive()) return;
      const keys = Object.keys(c);
      if (area === 'sync' && c.enabled) refresh(true);
      if (area !== 'local') return;
      if (keys.some((k) => k === 'mods' || k === 'modOrder' || k === 'modDev' || k === 'modsBlocklist' || k.startsWith('mod:'))) refresh(true);
      else if (keys.some((k) => k === 'todoCache' || k === 'seenCourses' || k.startsWith('insights:'))) redraw();
    });
  };
  const start = () => { if (!wired) wire(); refresh(); };
  return { start, tiles, rail, stats: () => ({ list, mounts: [...mounts.keys()] }) };
})();
if (typeof module !== 'undefined') module.exports = GZ_MODWIDGETS; else GZ_MODWIDGETS;
