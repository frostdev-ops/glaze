// Features that belong to some pages only, loaded when one of them is open, so a new one costs the first content script
// nothing: content.js's passes call sync() (its one hook). Each entry is test(location, site) → whether this is such a
// page, the file (also in lib/background.js LOADABLE) and the global it defines; while the page is one, that module gets
// sync() on every pass, and off() once when it stops being one. Loaded on demand on every page Glaze is on; a second
// injection keeps the first.
//
//   GZ_ROUTES.add(test, file, name)   // a routed feature (the table below, or at run time)
var GZ_ROUTES = globalThis.GZ_ROUTES || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null; // landed before this document's bootstrap: asked for again by its content.js
  const table = [];
  const live = new Set();
  const add = (test, file, name) => { table.push({ test, file, name }); };
  add((url, site) => site === 'ultra' ? /^\/ultra\/courses\/_\d+_\d+\/(?:assessment\/_\d+_\d+\/(?:overview|attempt(?:\/create)?)|discussion\/_\d+_\d+)\/?$/.test(url.pathname)
    : site === 'canvas' && /^\/courses\/\d+\/assignments\/\d+\/?$/.test(url.pathname), 'features/rubric.js', 'GZ_RUBRIC_UI');
  // The site's own announcement lists, opening in Glaze's pop-up: Ultra's Activity Stream and a course's Announcements;
  // Canvas's Dashboard, a course's home and Announcements; Moodle's course page and its forums (the news forum's list).
  const LISTS = { ultra: /^\/ultra\/(?:stream|courses\/_\d+_\d+\/announcements)(?:\/|$)/, canvas: /^\/(?:courses\/\d+(?:\/(?:announcements|activity_stream))?\/?)?$/, moodle: /\/(?:course|mod\/forum)\/view\.php$/ };
  add((l, site) => LISTS[site]?.test(l.pathname) || (site === 'canvas' && /^\/courses\/\d+\/discussion_topics\/?$/.test(l.pathname) && /[?&]only_announcements=(?:1|true)\b/.test(l.search || '')),
    'features/announce.js', 'GZ_ANNOUNCE');
  add((l, site) => site === 'ultra' && /^\/ultra\/courses\/_\d+_\d+\/announcements\/?$/.test(l.pathname), 'features/announce-read.js', 'GZ_ANNOUNCE_READ');
  add((l, site) => site === 'ultra' && /^\/ultra\/courses\/_\d+_\d+\/engagement\/?$/.test(l.pathname)
    && (globalThis.GZ_DISCUSSION_NAV?.pending() || sessionStorage.getItem('gz-discussion-jump')), 'features/discussion-nav.js', 'GZ_DISCUSSION_NAV');
  const sync = () => {
    for (const e of table) {
      let yes = false;
      try { yes = !!e.test(location, ctx.site); } catch { /* a test that throws matches nothing */ }
      if (yes) {
        live.add(e);
        ctx.need(e.file, () => globalThis[e.name]).then(() => { if (live.has(e)) globalThis[e.name].sync?.(); }, () => {});
      } else if (live.delete(e)) globalThis[e.name]?.off?.();
    }
  };
  return { add, sync };
})();

GZ_ROUTES;
