// LMS parts: the names a Look's rules (x.rules) use for pieces of an LMS page, and the cleaner
// for those rules. A rule never holds a selector: it names a part here, so a shared Look can't reach past this list and an
// LMS update is fixed in one place. Each part: its selector, its container (where `move` may put it, and the part it may
// be moved beside must share it), whether it may be hidden, whether its text may be relabelled, and which style keys
// apply. The selectors start from what Glaze already targets (theme.css, canvas.css, moodle.css, extras.css,
// content-ultra.js, content-canvas.js) and the saved pages in test/fixtures.
// Classic script (features/rules.js loads it on demand; the editor and lib/lookparts.js call has/list/clean);
// module.exports for node.
var GZ_PARTS = globalThis.GZ_PARTS || (() => {
  const D = typeof GZ_COLORS !== 'undefined' ? { GZ_COLORS } : require('../defaults.js');
  const F = typeof GZ_FONTS !== 'undefined' ? GZ_FONTS : require('./fonts.js');

  // Style keys. A box takes all of them; a piece of text takes colour, font and opacity.
  const BOX = ['bg', 'fg', 'bc', 'bw', 'r', 'p', 'g', 'sh', 'o', 'f'];
  const TEXT = ['fg', 'bg', 'f', 'o'];
  // The boards' course cards (features/coursecards.js): Glaze's own, drawn from the LMS's card, in a board tile's body. A
  // course-card part names its piece there too (b), so a Look's card rules reach them; board: false where there is none.
  const BOARD = { ultra: '.gz-w-body > article.gz-course-card', canvas: '.gz-w-body > .ic-DashboardCard[data-gz-tile-card]' };
  // [name, selector, label, { in: container selector, hide: false, text: relabelled, st: style keys, b: board piece }]
  const card = (site, sel, list) => list.map(([k, s, label, { board = true, ...o } = {}]) => [`${site}.${k}`, s ? `${sel} ${s}` : sel, label,
    { in: s ? sel : '', st: s ? TEXT : BOX, b: board && BOARD[site] ? (s ? `${BOARD[site]} ${s}` : BOARD[site]) : '', ...o }]);
  const ROWS = [
    // ---- Blackboard Ultra ----
    ...card('ultra', 'article.course-element-card', [
      ['course-card', '', 'Course card'],
      ['course-card.banner', '.course-banner', 'Course card picture', { st: BOX }],
      ['course-card.title', '.course-title', 'Course card title', { text: true }],
      ['course-card.id', '.course-id', 'Course card code', { text: true }],
      ['course-card.status', '.course-status', 'Course card status', { text: true, board: false }],
      ['course-card.instructors', 'bb-course-instructors', 'Course card instructors', { board: false }],
    ]),
    ['ultra.courses.term', '.course-card-term-name', 'Term heading', { st: TEXT, text: true }],
    ['ultra.recent-courses', 'bb-recent-courses-view', 'Recent courses', { st: BOX }],
    ['ultra.grades-tile', '.base-grades-course-tile', 'Grades course tile', { st: BOX }],
    // The rail holds Glaze settings, which can't be hidden; its items are x.nav's (hidden, order), not rules'.
    ['ultra.nav', 'nav#base_tools, nav[class*="makeStylesnavigation-"]', 'Navigation', { st: BOX, hide: false }],
    ['ultra.nav.logo', '.MuiDrawer-paper header.themed-logo-background-primary-fill', 'Navigation logo', { st: BOX }],
    ['ultra.nav.footer', '[class*="makeStylesfooter"]', 'Navigation footer links', { st: BOX }],
    ['ultra.course-header', 'course-page-header > header', 'Course header', { st: BOX }],
    ['ultra.course-banner', '#site-wrap course-banner', 'Course banner', { st: BOX }],
    ['ultra.course-tabs', '.bb-ui-navigation-list-horizontal', 'Course tabs', { st: BOX }],
    // Each course tab by its link's path, as the declutter switches find them (extras.css), so the language doesn't matter.
    ...[['calendar', 'Calendar tab'], ['announcements', 'Announcements tab'], ['engagement', 'Discussions tab'], ['grades', 'Gradebook tab'],
      ['messages', 'Messages tab'], ['groups/', 'Groups tab'], ['achievements', 'Achievements tab']].map(([path, label]) => [`ultra.course-tabs.${path.replace('/', '')}`,
      `.bb-ui-navigation-list-horizontal li:has(> a[href*="/${path}"])`, label, { in: '.bb-ui-navigation-list-horizontal', st: BOX, text: true }]),
    ['ultra.page-help', '.pagehelp-directive', 'Help button', { st: BOX }],
    ['ultra.announcements', 'tr.announcement-item-row', 'Announcement rows', { st: BOX }],

    // ---- Canvas ----
    ['canvas.global-nav', '#header.ic-app-header', 'Global navigation', { st: BOX, hide: false }],
    ['canvas.global-nav.logo', '#header .ic-app-header__logomark-container', 'Navigation logo', { st: BOX }],
    ...[['account', 'profile', 'Account'], ['dashboard', 'dashboard', 'Dashboard'], ['courses', 'courses', 'Courses'], ['groups', 'groups', 'Groups'],
      ['calendar', 'calendar', 'Calendar'], ['inbox', 'conversations', 'Inbox'], ['history', 'history', 'History'], ['help', 'help', 'Help']].map(([k, id, label]) => [`canvas.global-nav.${k}`,
      `#header li.ic-app-header__menu-list-item:has(> #global_nav_${id}_link)`, `${label} in navigation`, { in: '#header .ic-app-header__menu-list', st: BOX, text: true }]),
    ['canvas.dashboard-header', '.ic-Dashboard-header', 'Dashboard header', { st: BOX }],
    ['canvas.announcements', '#announcementWrapper', 'Announcements', { st: BOX }],
    ...card('canvas', '.ic-DashboardCard', [
      ['dashboard-card', '', 'Course card'],
      ['dashboard-card.image', '.ic-DashboardCard__header_image', 'Course card picture', { st: BOX }],
      ['dashboard-card.title', '.ic-DashboardCard__header-title', 'Course card title', { text: true }],
      ['dashboard-card.subtitle', '.ic-DashboardCard__header-subtitle', 'Course card code', { text: true }],
      ['dashboard-card.term', '.ic-DashboardCard__header-term', 'Course card term', { text: true }],
      ['dashboard-card.actions', '.ic-DashboardCard__action-container', 'Course card icons', { st: BOX }],
      ['dashboard-card.menu', '.ic-DashboardCard__header-button', 'Course card menu', { st: BOX, board: false }],
    ]),
    ['canvas.breadcrumbs', '.ic-app-nav-toggle-and-crumbs', 'Breadcrumbs', { st: BOX }],
    ['canvas.course-nav', '#section-tabs', 'Course menu', { st: BOX }],
    ...[['home', 'Home'], ['announcements', 'Announcements'], ['assignments', 'Assignments'], ['discussions', 'Discussions'], ['grades', 'Grades'],
      ['people', 'People'], ['pages', 'Pages'], ['files', 'Files'], ['syllabus', 'Syllabus'], ['outcomes', 'Outcomes'], ['quizzes', 'Quizzes'],
      ['modules', 'Modules'], ['collaborations', 'Collaborations'], ['conferences', 'Conferences']].map(([k, label]) => [`canvas.course-nav.${k}`,
      `#section-tabs > li:has(> a.${k})`, `${label} in the course menu`, { in: '#section-tabs', st: BOX, text: true }]),
    ['canvas.sidebar', '#right-side-wrapper', 'Sidebar', { st: BOX }],
    ['canvas.sidebar.todo', '#right-side .Sidebar__TodoListContainer', 'To Do in the sidebar', { in: '#right-side', st: BOX }],
    ['canvas.sidebar.feedback', '#right-side .events_list.recent_feedback', 'Recent feedback', { in: '#right-side', st: BOX }],
    ['canvas.footer', '#footer', 'Footer', { st: BOX }],

    // ---- Moodle (Boost) ----
    ['moodle.navbar', 'nav.navbar.fixed-top', 'Top bar', { st: BOX, hide: false }],
    ['moodle.navbar.brand', 'nav.navbar .navbar-brand', 'Site name', { st: BOX }],
    ...[['dashboard', '/my/', 'Dashboard'], ['my-courses', '/my/courses.php', 'My courses']].map(([k, href, label]) => [`moodle.navbar.${k}`,
      `.primary-navigation li.nav-item:has(> a[href$="${href}"])`, `${label} in the top bar`, { in: '.primary-navigation', st: BOX, text: true }]),
    ['moodle.navbar.notifications', 'nav.navbar .popover-region-notifications', 'Notifications', { st: BOX }],
    ['moodle.navbar.messages', 'nav.navbar [data-region="popover-region-messages"]', 'Messages', { st: BOX }],
    ['moodle.page-header', '#page-header', 'Page header', { st: BOX }],
    ['moodle.page-header.title', '#page-header .page-context-header', 'Page title', { st: TEXT, text: true }],
    ['moodle.secondary-nav', '.secondary-navigation', 'Course menu', { st: BOX }],
    ['moodle.course-index', '#theme_boost-drawers-courseindex', 'Course index', { st: BOX }],
    ['moodle.blocks', '#theme_boost-drawers-blocks', 'Blocks drawer', { st: BOX }],
    // Blocks move within their region (the drawer's, or the Dashboard's main one).
    ...[['timeline', 'Timeline'], ['calendar_month', 'Calendar'], ['calendar_upcoming', 'Upcoming events'], ['recentlyaccessedcourses', 'Recently accessed courses'],
      ['recentlyaccesseditems', 'Recently accessed items'], ['myoverview', 'Course overview'], ['online_users', 'Online users']].map(([k, label]) => [`moodle.block.${k.replace(/_/g, '-')}`,
      `.block-region > .block_${k}`, `${label} block`, { in: '.block-region', st: BOX }]),
    ...card('moodle', '.course-card[data-region="course-content"]', [
      ['course-card', '', 'Course card'],
      ['course-card.image', ':is(.card-img, .card-img-top)', 'Course card picture', { st: BOX }],
      ['course-card.title', '.coursename .multiline > span', 'Course card title', { text: true }],
      ['course-card.category', '.categoryname', 'Course card category', { text: true }],
      ['course-card.progress', '.progress', 'Course card progress', { st: BOX }],
    ]),
    ['moodle.footer', '#page-footer', 'Footer', { st: BOX }],
    ['moodle.footer.help', '.btn-footer-popover', 'Help button', { st: BOX }],
  ];
  const PARTS = new Map(ROWS.map(([name, s, label, o]) => [name, Object.freeze({ name, site: name.split('.')[0], s, label, in: o.in || '', hide: o.hide !== false, text: !!o.text, st: o.st, b: o.b || '' })]));
  const has = (name) => typeof name === 'string' && PARTS.has(name);
  const get = (name) => (has(name) ? PARTS.get(name) : null);
  // The editor's list for one LMS, labels in the page's language (t, as GZ_CTX.t or the editor's).
  const list = (site, t = (s) => s) => [...PARTS.values()].filter((p) => p.site === site)
    .map((p) => ({ name: p.name, label: t(p.label), hide: p.hide, text: p.text, move: !!p.in, st: [...p.st] }));

  // ---- the rule cleaner --------------------------------------------------------------------------
  // x.rules entries: { p, do, to, at, st, t }. One cleaner, idempotent like GZ_SANITIZE: unknown keys, a wrong type or
  // a part that can't take the action refuse the rule (null); numbers are clamped and rounded.
  const MAX = 64;
  const LABEL_MAX = 60;
  const TOKENS = new Set(D.GZ_COLORS.map(([v]) => v.slice(5)));
  const colour = (v) => (typeof v === 'string' && (TOKENS.has(v) || /^#[0-9a-f]{6}$/i.test(v)) ? v.toLowerCase() : null);
  const num = (lo, hi) => (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);
  // Catalogue fonts only: a typed family would ask Google Fonts for whatever a stranger's Look names.
  const font = (v) => (typeof v === 'string' && F.LIST.some((f) => f.id === v) ? v : null);
  const STYLE = { bg: colour, fg: colour, bc: colour, bw: num(0, 4), r: num(0, 32), p: num(0, 6), g: num(0, 6), sh: num(0, 3), o: num(0, 100), f: font };
  const KEYS = { hide: [], show: [], move: ['to', 'at'], style: ['st'], label: ['t'] };
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  const clean = (r) => {
    if (!isObj(r) || typeof r.do !== 'string' || !Object.hasOwn(KEYS, r.do) || !has(r.p)) return null;
    const part = PARTS.get(r.p), keys = KEYS[r.do];
    if (Object.keys(r).some((k) => k !== 'p' && k !== 'do' && !keys.includes(k))) return null;
    const out = { p: r.p, do: r.do };
    if (r.do === 'hide' || r.do === 'show') return part.hide ? out : null;
    if (r.do === 'move') {
      const to = get(r.to);
      if (!part.in || !to || to.name === part.name || to.in !== part.in || !['before', 'after'].includes(r.at)) return null;
      return { ...out, to: r.to, at: r.at };
    }
    if (r.do === 'label') {
      if (!part.text || typeof r.t !== 'string') return null;
      const t = [...r.t.replace(/\p{Bidi_Control}/gu, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, LABEL_MAX).join('').trim();
      return t ? { ...out, t } : null;
    }
    if (!isObj(r.st)) return null;
    const st = {};
    for (const [k, v] of Object.entries(r.st)) {
      const c = part.st.includes(k) ? STYLE[k](v) : null;
      if (c === null) return null;
      st[k] = c;
    }
    return Object.keys(st).length ? { ...out, st } : null;
  };
  // A list as x.rules holds it: at most 64, each cleaned; what doesn't clean is dropped (lib/lookparts.js compares
  // lengths to refuse a code that loses any).
  const rules = (list) => (Array.isArray(list) ? list.slice(0, MAX).map(clean).filter(Boolean) : []);

  // ---- what the page wears -----------------------------------------------------------------------
  // The rules for one LMS, folded in order into each part's end state: a later rule wins (show undoes an earlier hide,
  // style keys merge, the last label and move stand). Pure, so features/rules.js only touches the DOM.
  const STEPS = [0, 2, 4, 8, 12, 16, 24];
  const SHADOWS = ['none', '0 1px 3px', '0 4px 14px', '0 12px 32px'];
  const value = (k, v) => {
    if (k === 'bg' || k === 'fg' || k === 'bc') return v[0] === '#' ? v : `var(--gz-${v})`;
    if (k === 'bw' || k === 'r') return `${v}px`;
    if (k === 'p' || k === 'g') return `${STEPS[v]}px`;
    if (k === 'o') return String(v / 100);
    if (k === 'sh') return v ? `${SHADOWS[v]} color-mix(in srgb, var(--gz-shadow-color, #000) ${[0, 22, 28, 34][v]}%, transparent)` : 'none';
    return F.stack(v);
  };
  const plan = (list, site) => {
    const out = new Map();
    for (const r of rules(list)) {
      const part = PARTS.get(r.p);
      if (part.site !== site) continue;
      const s = out.get(r.p) || { hide: false, st: {}, t: '', move: null };
      out.set(r.p, s);
      if (r.do === 'hide' || r.do === 'show') s.hide = r.do === 'hide';
      else if (r.do === 'style') Object.assign(s.st, r.st);
      else if (r.do === 'label') s.t = r.t;
      else s.move = { to: r.to, at: r.at };
    }
    // Each part's style as the CSS variables features/rules.css reads, and the fonts to load.
    for (const s of out.values()) {
      s.vars = Object.fromEntries(Object.entries(s.st).map(([k, v]) => [`--gz-r-${k}`, value(k, v)]));
      s.fonts = s.st.f ? [s.st.f] : [];
    }
    return out;
  };

  return { PARTS, BOARD, BOX, TEXT, MAX, LABEL_MAX, STEPS, has, get, list, clean, rules, plan, value };
})();

if (typeof module !== 'undefined') module.exports = GZ_PARTS; else GZ_PARTS;
