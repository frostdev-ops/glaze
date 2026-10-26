// Announcements in Glaze's pop-up and hover preview (features/announce.js): the parts that don't touch the page, so node
// can test them: which way an entry point opens them, which clicks stay the browser's, each site's request and answer, and
// which links on the sites' own lists are announcements (find).
// The pop-up, its motion and the body's safe path are lib/popup.js's.
// Classic script; module.exports for node. Loaded on demand: a second injection keeps the first.
var GZ_ANNOUNCE_LIB = globalThis.GZ_ANNOUNCE_LIB || (() => {
  // Its settings are GZ_SPEC.announce (defaults.js): open, the everyday way; glaze (Better To Do, widgets and search), ultra,
  // canvas and moodle, each entry point's ('default' follows open); preview, delay (ms) and lines for previews.
  const ENTRIES = ['glaze', 'ultra', 'canvas', 'moodle'];

  // 'popup' or 'site' for an entry point, from the sanitized settings (o); unknown entry points follow the everyday choice.
  const mode = (o, entry) => {
    const v = ENTRIES.includes(entry) ? o?.[entry] : 'default';
    return v === 'popup' || v === 'site' ? v : o?.open === 'site' ? 'site' : 'popup';
  };
  // A click Glaze may take: the main button with no modifier. A middle click, or Ctrl, Cmd, Shift or Alt with it, keeps the
  // browser's own (a new tab or window, a download), as does a click something else already took.
  const plain = (e) => !!e && !e.defaultPrevented && !(e.button > 0) && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

  // ---- references ------------------------------------------------------------------------------------------------
  const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
  const ms = (v) => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) && t > 0 ? t : null; };
  const ID = { canvas: /^\d{1,20}$/, ultra: /^_\d{1,20}_\d{1,20}$/, moodle: /^\d{1,20}$/ };
  const own = (v, origin) => (globalThis.GZ_POPUP_LIB || require('./popup.js')).own(v, origin);
  // What open() and preview() are given, checked: { site, origin, courseId, id, url, title, course, entry, key }, or null.
  // Moodle's discussion needs no course.
  const ref = (x, origin) => {
    const site = x?.site;
    if (!ID[site] || !ID[site].test(String(x.id ?? '')) || (site !== 'moodle' && !ID[site].test(String(x.courseId ?? '')))) return null;
    const o = x.origin || origin;
    if (o !== origin) return null;
    const url = own(x.url, o);
    if (!url) return null;
    const courseId = site === 'moodle' ? String(x.courseId ?? '').replace(/\D/g, '') : String(x.courseId);
    return { site, origin: o, courseId, id: String(x.id), url, title: str(x.title).trim(), course: str(x.course, 120).trim(), entry: ENTRIES.includes(x.entry) ? x.entry : site,
      key: `${site} ${o} ${courseId} ${x.id}` };
  };

  // ---- each site's announcement ------------------------------------------------------------------------------------
  // An item: { title, author, at (ms), html (as sent; only ever shown through lib/popup.js safe), files: [{ name, url }], unread
  // (true, false, or null when the site doesn't say), locked (nothing to show here: the site's page says why) }.
  const files = (list, origin, name, url) => (Array.isArray(list) ? list : []).slice(0, 50)
    .map((f) => ({ name: str(f?.[name], 255).trim() || 'file', url: own(f?.[url], origin) })).filter((f) => f.url);
  const SITES = {
    // Canvas: the topic as its own page reads it. Opening it there marks it read (its discussion_topics show), and the
    // API's mark is the same PUT; only a topic Canvas calls unread, and one the student may open, gets it.
    canvas: {
      name: 'Canvas', peek: true,
      get: (r) => ({ url: `${r.origin}/api/v1/courses/${r.courseId}/discussion_topics/${r.id}`, method: 'GET' }),
      item: (j, origin) => ({
        title: str(j?.title).trim(), author: str(j?.author?.display_name || j?.user_name, 120).trim(), at: ms(j?.posted_at) ?? ms(j?.delayed_post_at) ?? ms(j?.created_at),
        html: str(j?.message, 2 << 20), files: files(j?.attachments, origin, 'display_name', 'url'),
        unread: j?.read_state === 'unread' ? true : j?.read_state === 'read' ? false : null, locked: !!j?.locked_for_user && !j?.message,
      }),
      mark: (r, it) => (it.unread && !it.locked ? { url: `${r.origin}/api/v1/courses/${r.courseId}/discussion_topics/${r.id}/read`, method: 'PUT' } : null),
    },
    // Blackboard Ultra: the public announcements API search already reads (lib/ultra.js SEARCH_KINDS). Its answer names the
    // author by id only, so no author; embedded files come as Blackboard's URL stub, which is this site. Ultra's read state
    // (readStatus, its private list) has no write Glaze can confirm, so nothing is marked here.
    ultra: {
      name: 'Blackboard', peek: true,
      path: (r) => `/learn/api/public/v1/courses/${r.courseId}/announcements/${r.id}?fields=id,title,body,created,availability`,
      item: (j, origin) => {
        const b = j?.body;
        const html = typeof b === 'string' ? b : str(b?.displayText, 2 << 20) || str(b?.rawText, 2 << 20);
        return {
          title: str(j?.title).trim(), author: '', at: ms(j?.availability?.duration?.start) ?? ms(j?.created) ?? ms(j?.createdDate),
          html: html.slice(0, 2 << 20).replaceAll('@X@EmbeddedFile.requestUrlStub@X@', `${origin}/`), files: [],
          unread: typeof j?.readStatus?.isRead === 'boolean' ? !j.readStatus.isRead : null, locked: false,
        };
      },
      mark: () => null,
    },
    // Moodle: the discussion, asked as its own forum page asks (mod_forum_get_discussion_posts through service.php with the
    // session key). Moodle marks the posts read as it answers, exactly as its page does, so that request is the read mark,
    // and a preview never asks it (peek: false).
    moodle: {
      name: 'Moodle', peek: false,
      get: (r, s) => ({
        url: `${s.root}/lib/ajax/service.php?sesskey=${encodeURIComponent(s.sesskey)}&info=mod_forum_get_discussion_posts`, method: 'POST',
        body: JSON.stringify([{ index: 0, methodname: 'mod_forum_get_discussion_posts', args: { discussionid: +r.id, sortby: 'created', sortdirection: 'ASC' } }]),
      }),
      item: (j, origin) => {
        const r = Array.isArray(j) ? j[0] : null;
        if (!r || r.error || !r.data) throw new Error(r?.exception?.errorcode || 'no answer');
        const posts = Array.isArray(r.data.posts) ? r.data.posts : [];
        const p = posts.find((x) => x && !x.hasparent && !x.parentid) || posts[0];
        if (!p) throw new Error('no post');
        return {
          title: str(p.subject).trim(), author: str(p.author?.fullname, 120).trim(), at: ms(Number(p.timecreated) * 1000),
          html: str(p.message, 2 << 20), files: files(p.attachments, origin, 'filename', 'url'), unread: typeof p.unread === 'boolean' ? p.unread : null,
          manualRead: p.capabilities?.controlreadstatus === true, locked: false,
        };
      },
      mark: () => null,
    },
  };

  // ---- the sites' own lists ----------------------------------------------------------------------------------------
  // The announcement link an event's target (t) is in, on one of the site's own lists (their markup, from each site's
  // source), at origin and path (the page's address): { link, ref }, ref holding what the page shows of it too (course,
  // author, at, text where shown), or null: not one, or one whose ids can't be read, which stays the site's.
  const words = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const here = (a, origin) => { try { const u = new URL(a.getAttribute('href') || '', `${origin}/`); return u.origin === origin ? u : null; } catch { return null; } };
  const out = (link, x, origin) => {
    const r = Object.fromEntries(Object.entries({ entry: x.site, ...x }).filter(([, v]) => v != null && v !== ''));
    return ref(r, origin) ? { link, ref: r } : null;
  };
  const LISTS = {
    // Ultra: a course's Announcements (a#list-item-title-<id>.list-item-title, href="#": the course from the address), and
    // links to /ultra/stream/announcement-detail?courseId=…&announcementId=…. Stream title classes also occur on
    // discussions, content and grades: only the destination identifies an announcement; its live stream href is unverified.
    ultra: (t, origin, path) => {
      const a = t.closest('a');
      if (!a) return null;
      const u = here(a, origin);
      if (!u) return null;
      const q = u.pathname === '/ultra/stream/announcement-detail' ? u.searchParams : null;
      const listed = !q && a.getAttribute('href') === '#' && a.closest('announcement-list a.list-item-title') === a;
      const courseId = q ? q.get('courseId') : listed && path.match(/^\/ultra\/courses\/(_\d+_\d+)\/announcements(?:\/|$)/)?.[1];
      const id = q ? q.get('announcementId') : listed && a.id.match(/^list-item-title-(_\d+_\d+)$/)?.[1];
      if (!courseId || !id) return null;
      const row = listed ? a.closest('tr') : null;
      return out(a, { site: 'ultra', courseId, id, url: `${origin}/ultra/stream/announcement-detail?courseId=${courseId}&announcementId=${id}`, title: words(a),
        text: words(row?.querySelector('.list-item-body')) }, origin);
    },
    // Canvas: its announcement rows (a course's Announcements, the course home's Recent Announcements: the title's
    // a.ic-item-row__content-link, not Reply's), Recent Activity's announcements (a.content_summary to
    // /courses/<id>/announcements/<id>) and the dashboard widget's "Read more".
    canvas: (t, origin) => {
      const a = t.closest('a');
      const u = a && here(a, origin), m = u?.pathname.match(/^\/courses\/(\d+)\/(?:discussion_topics|announcements)\/(\d+)\/?$/);
      if (!m) return null;
      const x = { site: 'canvas', courseId: m[1], id: m[2], url: u.href };
      const row = a.closest('.ic-announcement-row'), feed = a.closest('.stream-announcement'), card = a.closest('[data-testid*="announcement-item-"]');
      if (row) {
        if (!a.closest('.ic-item-row__content-link') || a.querySelector('[data-testid="announcement-reply"]')) return null;
        const h = row.querySelector('h3');
        let title = words(h);
        for (const s of h?.querySelectorAll('[class*="screenReaderContent"], .screenreader-only') || []) title = title.replace(words(s), '').trim();
        return out(a, { ...x, title, author: row.querySelector('.ic-item-row__author-col [aria-label]')?.getAttribute('aria-label'),
          text: words(row.querySelector('.ic-announcement-row__content')) }, origin);
      }
      if (feed) {
        if (!a.closest('.content_summary')) return null;
        const course = words(a.querySelector('.fake-link'));
        let title = words(a);
        for (const s of [course, words(a.querySelector('strong'))]) if (s && title.startsWith(s)) title = title.slice(s.length).trim();
        return out(a, { ...x, title, course }, origin);
      }
      if (card) return out(a, { ...x, title: card.getAttribute('aria-label'), course: words(card.querySelector('[data-testid*="course-name-"]')) }, origin);
      return null;
    },
    // Moodle: the course's Announcements forum (its news forum): the discussion list's titles (body.forumtype-news) and the
    // Latest announcements block's. Its preview asks nothing, so the page's words are all it shows.
    moodle: (t, origin) => {
      const a = t.closest('a');
      const u = a && here(a, origin), id = u && /\/mod\/forum\/discuss\.php$/.test(u.pathname) && !u.hash && [...u.searchParams.keys()].join() === 'd' && u.searchParams.get('d');
      if (!id) return null;
      const courseId = a.closest('body')?.className.match(/\bcourse-(\d+)\b/)?.[1];
      const x = { site: 'moodle', courseId: courseId === '1' ? null : courseId, id, url: u.href, title: a.getAttribute('title') || words(a) };
      const row = a.closest('th.topic') && a.closest('.forumtype-news [data-region="discussion-list-item"]');
      if (row) return out(a, { ...x, author: words(row.querySelector('.author .text-truncate')), at: ms(row.querySelector('.author time')?.getAttribute('datetime')) }, origin);
      const post = a.closest('.info') && a.closest('[data-block="news_items"] .post');
      return post ? out(a, { ...x, author: words(post.querySelector('.name')) }, origin) : null;
    },
  };
  const find = (site, t, origin, path = '') => {
    if (!LISTS[site] || !t?.closest) return null;
    const a = t.closest('a'), control = t.closest('button, input, select, textarea, [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [contenteditable="true"], [contenteditable=""]');
    if (control && control !== a && a?.contains(control)) return null;
    return LISTS[site](t, origin, path);
  };

  return { ENTRIES, mode, plain, ref, SITES, find };
})();

if (typeof module !== 'undefined') module.exports = GZ_ANNOUNCE_LIB; else GZ_ANNOUNCE_LIB;
