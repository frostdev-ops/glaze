// Remaining glass regression checks, on the synthetic Ultra course and a
// Canvas fixture. EXT=<checkout> NODE_PATH=<playwright> nice node scripts/glass-remaining-check.js <out dir> [scenario ...] [--looks a,b]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
// A copy holding the school's host, as the student's grant does (scripts/check-env.js staged).
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://bb.school.test/*']);
const G = require(path.join(ext, 'defaults.js'));
const site = 'https://bb.school.test', uid = '_42_1';
const out = path.resolve(process.argv[2]);
const args = process.argv.slice(3);
const lookArg = args.find((a) => a.startsWith('--looks='));
const only = args.filter((a) => !a.startsWith('--'));
const LOOKS = lookArg ? lookArg.slice(8).split(',') : ['Pumpkin Patch', 'Clear', 'Terminal', 'Aurora Night', 'Library'];
const W = Number(process.env.W || 1528), H = Number(process.env.H || 1046);
const fx = (f) => fs.readFileSync(path.join(ext, 'test/fixtures', f), 'utf8');
// The real course bar nesting (course-bar-outline.txt): div.bb-course-navigation > course-page-header > header.makeStylesheader,
// then bb-course-navigation > the toolbar.
const ultra = fx('ultra-course.html')
  .replace('`<div class="bb-course-navigation"><bb-course-navigation>`', '`<div class="bb-course-navigation">`')
  .replace('`<course-page-header><header>`', '`<course-page-header><header class="makeStylesheader-0-2-704">`')
  .replace('`</header></course-page-header>`', '`</header></course-page-header><bb-course-navigation>`')
  .replace('.bb-course-navigation { position: sticky; top: 0; z-index: 10; background: Canvas; }', '.bb-course-navigation { position: sticky; top: 0; z-index: 10; }');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const results = [];
const check = (v, label, actual) => { results.push({ pass: !!v, label, actual }); console.log(`${v ? 'ok  ' : 'FAIL'} ${label}${actual === undefined ? '' : ' ' + JSON.stringify(actual)}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Ultra's own rules the fixture lacks, as captured (real-Gradebook.json, ann-toolbar.html, the routed discussion and panel).
const ULTRA_CSS = `
  aside.student-grade-overview { display: flex; align-items: center; gap: 12px; min-height: 96px; box-sizing: border-box; padding: 0 16px; background: #fff; border-bottom: 5px solid #e5e5e5; box-shadow: rgb(229, 229, 229) 0 -5px 0 0; }
  .gb-avatar { width: 48px; height: 48px; border-radius: 50%; background: #c96; }
  #announcement-search { padding: 16px 30px; background: #fff; } #announcement-search.hide { display: none; }
  .search-input-wrap { display: flex; align-items: center; gap: 8px; border: 1px solid #8c8c8c; border-radius: 4px; padding: 0 8px; background: #fff; }
  .search-input-wrap input { flex: 1; height: 36px; border: 0; background: transparent; font: inherit; }
  .bb-offcanvas-panel.full { position: absolute; inset: 0; inset-inline-start: 36px; z-index: 30; box-shadow: -1px 0 0 0 #cdcdcd, -6px 0 12px rgb(0 0 0 / .2); background: #fff; }
  .bb-offcanvas-panel.full .bb-offcanvas-panel-wrap { position: absolute; inset: 0; }
  .bb-offcanvas-panel.full .panel-wrap { position: absolute; inset: 0; overflow: auto; padding: 30px; box-sizing: border-box; }
  .bb-offcanvas-panel.full .panel-header { display: flex; align-items: center; height: 107px; margin: -30px -30px 0; padding: 0 30px; background: #fff; border-bottom: 1px solid #cdcdcd; }
  .bb-offcanvas-panel.full .panel-sub-title { display: block; font-size: 14px; } .bb-offcanvas-panel.full h1 { margin: 0; font-size: 32px; }
  .bb-offcanvas-panel.full .bb-close-offset { position: absolute; top: 30px; inset-inline-start: 0; }
  .bb-offcanvas-panel.full .bb-close { position: absolute; inset-inline-start: -24px; width: 40px; height: 40px; }
  .discussion-container .panel-header { display: flex; align-items: center; min-height: 90px; padding: 0 30px; background: #fff; border-bottom: 1px solid #cdcdcd; }
  .discussion-container .panel-header h1 { margin: 0; font-size: 28px; }
  content-page-header { display: block; }
  .routed-disc content-page-header > header { display: flex; align-items: center; gap: 12px; height: 47px; padding: 0 16px; background: #262626; color: #fff; }
`;
const GRADEBOOK = `<section class="guidance-wrapper gradebook-panel route-view-container"><aside class="student-grade-overview course-color-3"><div class="gb-avatar"></div><div><b>Student Name</b><div>They / Them</div></div></aside>
  <div style="padding:16px 32px"><h3>Grades</h3>${Array.from({ length: 12 }, (_, i) => `<div class="tool-row">Module ${i + 1} assignment · 9/${i + 1}/26 · Graded · 90/100</div>`).join('')}</div></section>`;
const ANNOUNCEMENTS = (open) => `<announcement-list><div><div class="page-announcement course-announcement-layer"><div class="guidance-wrapper " style="display:flex;justify-content:space-between;align-items:center;padding:16px 30px"${open ? ' hidden' : ''}><span>6 Total</span><div class="header-actions-menu__item active no-select"><div class="active no-select"><button class="MuiButtonBase-root MuiIconButton-root" type="button" id="search-button" aria-label="Search announcements">⌕</button></div></div></div>
  <div class="list-announcement-content"><div class="row collapse${open ? '' : ' hide'}" id="announcement-search"><div class="search-input-wrap"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg><label class="sr-only" for="search-input" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Search announcements</label><input class="left" id="search-input" placeholder="Search announcements" type="text" value=""><button class="MuiButtonBase-root MuiIconButton-root search-controls button super-clear" type="button" aria-label="Close">×</button></div></div>
  <div class="row collapse"><div class="tabular-list-container"><div class="tabular-list"><table class="table-content sortable-table"><tbody>${Array.from({ length: 6 }, (_, i) => `<tr class="announcement-item-row is-read"><td>Week ${7 - i}</td><td>10/${21 - i}/26</td></tr>`).join('')}</tbody></table></div></div></div></div></div></div></announcement-list>`;
// An announcement opened over the stream page, as in item4 (.bb-offcanvas-panel.full).
const OFFCANVAS = `<div class="bb-offcanvas-panel bb-offcanvas-right full active"><div class="bb-offcanvas-panel-wrap"><div class="panel-wrap">
  <header class="panel-header simple-header"><div class="panel-titles-container"><span class="panel-sub-title">Course Announcements</span><h1 class="panel-title">Week 7</h1></div></header>
  <div class="panel-content"><div class="bb-editor-container is-read-only"><p>Hello everyone</p><p>This is the last week; invented text.</p></div></div></div>
  <div class="bb-close-offset"><button class="bb-close" aria-label="Close">×</button></div></div></div>`;

(async () => {
  let ctx;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-glass-remaining-'));
  fs.mkdirSync(out, { recursive: true });
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true,
      viewport: { width: W, height: H }, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'] });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: ultra });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: uid }) });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.hostname === 'cdn.school.test') return route.fulfill({ contentType: 'text/css', body: '' });
      if (u.host === 'school.instructure.com' && u.pathname.startsWith('/courses/')) return route.fulfill({ contentType: 'text/html', body: fx('canvas-course-home.html') });
      if (u.host === 'school.instructure.com' && u.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    if (process.env.FORCED) await page.emulateMedia({ forcedColors: 'active' });
    const setup = async (look, { sidebar = true, rail = true, at = 'above', extra = {} } = {}) => {
      const base = { ...G.GZ_DEFAULTS, navbar: { ...G.GZ_DEFAULTS.navbar, on: rail, tabs: false, rail: 'icons' },
        enhance: Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, ['tabs', 'place', ...(sidebar ? ['sidebar', 'notes', 'widgets'] : [])].includes(k)])) };
      const L = G.GZ_LOOKS.find((l) => l.name === look);
      const settings = { ...base, ...G.GZ_LOOK_APPLY(base, L), motion: { ...base.motion, level: 'off' }, tabs: { ...G.GZ_SANITIZE({}).tabs, at }, glassCheckCollapsed: !!process.env.COLLAPSED, ...extra };
      await opts.evaluate(async ({ settings, site, uid }) => {
        await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.session.clear();
        await chrome.storage.sync.set(settings);
        await chrome.storage.local.set({ ultra: [site], [`ctabs:${site}:${uid}`]: { tabs: [1, 2].map((i) => ({ cid: `_10${i}_1`, name: `Course ${i}`, path: `/ultra/courses/_10${i}_1/outline`, at: i, top: 0 })) },
          [`sidebar:ultra:${site}/${uid}`]: { v: 1, rev: 1, mig: 1, open: !settings.glassCheckCollapsed, dock: [{ id: 'notes' }], dest: { notes: 'dock' } } });
      }, { settings, site, uid });
    };
    const go = async (p, ready = '#gz-ctabs [data-course-id="_102_1"]') => {
      await page.goto(site + p);
      await page.locator(ready).first().waitFor({ timeout: 20000 });
      for (let i = 0; i < 100 && await page.evaluate(() => !!document.querySelector('.spinner')); i++) await pause(100);
      await page.addStyleTag({ content: ULTRA_CSS });
      if (process.env.RTL) await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
      await pause(400);
    };
    const rect = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.right, r.bottom].map(Math.round); }, sel);
    const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });

    const S = {
      // 1. A course tool beside Glaze's own sidebar: the header group spans the window, the sidebar starts under it.
      async tool(look) {
        await setup(look); await go('/ultra/courses/_101_1/calendar');
        await page.waitForSelector('html[data-gz-sb-tool][data-gz-sidebar="expanded"]', { timeout: 15000 });
        await pause(500);
        const m = { strip: await rect('#gz-ctabs'), nav: await rect('div.bb-course-navigation'), header: await rect('course-page-header > header'), side: await rect('#gz-sidebar'),
          content: await rect('section.course > .route-view-container'), vw: W };
        check(m.header[2] >= W - 13, `${look} tool: the course header reaches the window's gap`, m);
        check(m.side[1] >= m.header[3], `${look} tool: the sidebar starts below the header`, [m.side, m.header]);
        check(m.content[2] <= m.side[0], `${look} tool: the tool's content stays clear of the sidebar`, [m.content, m.side]);
        await shot(`tool-${slug(look)}`);
      },
      // 1b. A routed document beside the sidebar.
      async routed(look) {
        await setup(look); await go('/ultra/courses/_101_1/document/_8110_1?view=content&state=view', '#gz-ctabs');
        await page.waitForSelector('html[data-gz-sidebar="expanded"]', { timeout: 15000 }); await pause(500);
        const m = { strip: await rect('#gz-ctabs'), header: await rect('[class*="headerRoot"]'), side: await rect('#gz-sidebar'), main: await rect('.routed-page main') };
        check(m.strip[2] >= W - 1 && m.header[2] >= W - 1, `${look} routed: the header row spans the window`, m);
        check(m.side[1] >= m.header[3], `${look} routed: the sidebar starts below the header`, m);
        check(m.main[2] <= m.side[0], `${look} routed: the reading stays clear of the sidebar`, m);
        await shot(`routed-${slug(look)}`);
      },
      // 2. Gradebook's overview band.
      async grades(look) {
        await setup(look); await go('/ultra/courses/_101_1/grades');
        await page.locator('section.course > .route-view-container').evaluate((e, h) => { e.innerHTML = h; }, GRADEBOOK);
        await pause(500);
        const s = await page.locator('aside.student-grade-overview').evaluate((e) => { const c = getComputedStyle(e); return [c.borderBottomWidth, c.boxShadow, c.backgroundColor]; });
        check(s[0] === '0px' && s[1] === 'none' && /, 0\)$|transparent/.test(s[2]), `${look} grades: no band or bright line under the header`, s);
        await shot(`grades-${slug(look)}`);
      },
      // 3. A routed discussion: crumbs row in content-page-header, the discussion in a panel under it.
      async discussion(look) {
        await setup(look); await go('/ultra/courses/_101_1/document/_8110_1?view=content&state=view', '#gz-ctabs');
        await page.evaluate(() => {
          const page = document.querySelector('.routed-page');
          page.classList.add('routed-disc');
          // As on Ultra: the routed page inside #site-wrap > .inner-wrap (item-dom.txt).
          document.getElementById('site-wrap').removeAttribute('id');
          const wrap = document.createElement('div'); wrap.id = 'site-wrap'; wrap.className = 'off-canvas-wrap';
          const inner = document.createElement('div'); inner.className = 'inner-wrap'; wrap.append(inner); document.body.append(wrap); inner.append(page);
          page.innerHTML = `<content-page-header class="react-container"><header class="makeStylesheader-0-2-900"><button aria-label="Close">×</button><a href="/ultra/courses/_101_1/outline">FA26-CS101-01</a> › Module 1 › <span>Discussion: Introductions</span></header></content-page-header>
            <div class="routed-page-body"><div class="panel-wrap" style="position:relative;left:0"><div class="discussion-container"><div class="panel-header panel-header-directive has-controls"><h1>Module 1: Discussion -- Introductions</h1></div>
            <div class="course-main-container" style="padding:16px 30px">${Array.from({ length: 20 }, (_, i) => `<p>Post ${i + 1}: invented reply text.</p>`).join('')}</div></div></div></div>`;
        });
        await pause(1200);
        const m = await page.evaluate(() => {
          const s = document.querySelector('#gz-ctabs'), c = document.querySelector('content-page-header > header'), t = document.querySelector('.discussion-container .panel-header');
          const r = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.right, b.bottom].map(Math.round); };
          return { at: s?.dataset.at, strip: s && r(s), crumbs: r(c), title: r(t), stripBeforeCrumbs: !!s && !!(s.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING),
            crumbsPaint: [getComputedStyle(c).borderTopLeftRadius, getComputedStyle(c).marginInlineEnd], titlePaint: [getComputedStyle(t).borderTopLeftRadius, getComputedStyle(t).marginTop] };
        });
        check(m.stripBeforeCrumbs && m.strip[3] <= m.crumbs[1], `${look} discussion: the strip sits above the breadcrumb row`, m);
        check(m.crumbsPaint[0] !== '0px' && m.crumbsPaint[1] !== '0px', `${look} discussion: the breadcrumb row is an inset rounded panel`, m.crumbsPaint);
        await shot(`discussion-${slug(look)}`);
      },
      // 4. An announcement opened as a full off-canvas panel over the stream page.
      async offcanvas(look) {
        await setup(look); await go('/ultra/courses/_101_1/announcements');
        await page.evaluate((h) => { document.querySelector('.course-content-container').insertAdjacentHTML('beforeend', h); }, OFFCANVAS);
        await pause(800);
        const m = await page.evaluate(() => {
          const p = document.querySelector('.bb-offcanvas-panel.full'), h = p.querySelector('.panel-header'), c = getComputedStyle(p), hs = getComputedStyle(h), hb = getComputedStyle(h, '::before');
          const r = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.right, b.bottom].map(Math.round); };
          return { panel: r(p), header: r(h), edge: [c.borderLeftWidth, c.boxShadow], headerPaint: [hs.backgroundColor, hs.borderTopLeftRadius, hb.content, hb.borderTopLeftRadius, hb.backdropFilter] };
        });
        check(m.edge[0] === '0px' && m.edge[1] === 'none', `${look} offcanvas: no line at the panel's left edge`, m.edge);
        check(m.headerPaint[2] === '""' && m.headerPaint[3] !== '0px', `${look} offcanvas: the header is an inset glass panel`, m.headerPaint);
        const aligned = await page.evaluate(() => {
          const h = document.querySelector('.bb-offcanvas-panel.full .panel-header'), s = document.querySelector('#gz-ctabs');
          const paint = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e, '::before'); return [r.left + parseFloat(c.left), r.right - parseFloat(c.right)]; };
          return { header: paint(h), strip: paint(s) };
        });
        check(aligned.header.every((v, i) => Math.abs(v - aligned.strip[i]) < 2), `${look} offcanvas: strip and header glass edges align`, aligned);
        const side = await page.evaluate(() => {
          const h = document.querySelector('.bb-offcanvas-panel.full .panel-header').getBoundingClientRect(), s = document.querySelector('#gz-sidebar').getBoundingClientRect();
          return { headerBottom: h.bottom, sidebarTop: s.top, state: document.documentElement.dataset.gzSidebar };
        });
        check(['drawer', 'none'].includes(side.state) || side.sidebarTop >= side.headerBottom, `${look} offcanvas: sidebar starts below the header`, side);
        await shot(`offcanvas-${slug(look)}`);
        if (side.state === 'drawer') {
          const launch = page.locator('#gz-sb-launch');
          await launch.focus(); await page.keyboard.press('Enter');
          await page.waitForSelector('html[data-gz-sidebar-open]');
          const drawer = await page.locator('#gz-sidebar').evaluate((e) => ({ top: e.getBoundingClientRect().top, focus: e.contains(document.activeElement) }));
          check(drawer.top >= side.headerBottom && drawer.focus, `${look} offcanvas: keyboard opens the drawer below the header`, drawer);
          await shot(`offcanvas-drawer-${slug(look)}`);
          await page.keyboard.press('Escape');
          check(await launch.evaluate((e) => document.activeElement === e && !document.documentElement.hasAttribute('data-gz-sidebar-open')), `${look} offcanvas: Escape closes the drawer and restores focus`);
        }
      },
      async sticky(look) {
        await setup(look); await go('/ultra/courses/_101_1/announcements');
        await page.evaluate((h) => { document.querySelector('.course-content-container').insertAdjacentHTML('beforeend', h); }, OFFCANVAS);
        await page.addStyleTag({ content: '.bb-offcanvas-panel.full .panel-header.simple-header { position: sticky; top: 0; }' });
        await pause(800);
        const pos = await page.locator('.bb-offcanvas-panel.full .panel-header').evaluate((e) => getComputedStyle(e).position);
        check(pos === 'sticky', `${look} offcanvas: native sticky positioning survives glass decoration`, pos);
        await shot(`sticky-${slug(look)}`);
      },
      async item(look) {
        await setup(look); await go('/ultra/courses/_101_1/outline');
        await page.locator('a[href*="/outline/edit/document/"]').click();
        await page.waitForSelector('#gz-ctabs[data-at="nested"]'); await pause(800);
        const m = await page.evaluate(() => {
          const s = document.querySelector('#gz-ctabs'), h = s.parentElement.querySelector('.panel-header'), b = s.parentElement.querySelector('.panel-body');
          const r = (e) => { const v = e.getBoundingClientRect(); return [v.left, v.top, v.right, v.bottom]; };
          return { header: r(h), strip: r(s), body: r(b), side: r(document.querySelector('#gz-sidebar')), rtl: document.documentElement.dir === 'rtl', state: document.documentElement.dataset.gzSidebar, vw: innerWidth };
        });
        check(m.rtl ? m.header[0] < 14 : m.header[2] >= m.vw - 13, `${look} item: header spans over sidebar column`, m);
        check(['drawer', 'none'].includes(m.state) || (m.rtl ? m.body[0] >= m.side[2] : m.body[2] <= m.side[0]), `${look} item: body stays clear of sidebar`, m);
        await page.locator('#gz-ctabs [role="tab"]').first().focus();
        await shot(`item-${slug(look)}`);
      },
      // 5. Announcements with search open.
      async search(look) {
        await setup(look); await go('/ultra/courses/_101_1/announcements');
        await page.locator('section.course > .route-view-container').evaluate((e, h) => { e.innerHTML = h; }, ANNOUNCEMENTS(true));
        await pause(600);
        const m = await page.evaluate(() => {
          const row = document.getElementById('announcement-search'), wrap = row.querySelector('.search-input-wrap');
          const a = getComputedStyle(row), b = getComputedStyle(wrap);
          return { row: [a.backgroundColor, row.hasAttribute('data-gz-light')], wrap: [b.backgroundColor, b.borderTopLeftRadius, b.borderTopWidth] };
        });
        check(/, 0\)$|transparent/.test(m.row[0]), `${look} search: no band behind the search field`, m);
        check(m.wrap[1] === '999px', `${look} search: the field is a pill`, m.wrap);
        await page.locator('#search-input').focus();
        await shot(`search-${slug(look)}`);
      },
      // 6. Canvas: the breadcrumb row holding the strip.
      async canvas(look) {
        await setup(look, { rail: false });
        await opts.evaluate(async () => { await chrome.storage.local.set({ 'ctabs:https://school.instructure.com:1': { tabs: [] } }); });
        await page.goto('https://school.instructure.com/courses/25');
        // Canvas's own layout, roughly (the fixture has none of its stylesheets): the rail, the crumbs row, the columns.
        await page.addStyleTag({ content: `body { margin: 0; font: 14px/1.4 sans-serif; } svg, i[class^="icon-"] { display: inline-block; width: 18px; height: 18px; overflow: hidden; }
          #header { position: fixed; inset: 0 auto 0 0; width: 84px; overflow: hidden; } #header > * { visibility: hidden; } #wrapper { margin-inline-start: 84px; }
          .ic-app-nav-toggle-and-crumbs { display: flex; align-items: center; min-height: 64px; box-sizing: border-box; } .ic-app-crumbs { flex: 1; min-width: 0; }
          #breadcrumbs ol { display: flex; gap: 8px; list-style: none; margin: 0; padding: 0; } #breadcrumbs li + li::before { content: "›"; margin-inline-end: 8px; }
          .screenreader-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); } #main { display: flex; } #left-side { width: 170px; flex: none; }
          #not_right_side { flex: 1; min-width: 0; padding: 0 24px; } #right-side-wrapper { width: 280px; flex: none; } img { max-width: 48px; max-height: 48px; } .skip_link, #flash_screenreader_holder { display: none; }` });
        await pause(2500);
        await page.evaluate(() => { scrollTo(0, 0); for (const e of document.querySelectorAll('#drawer-layout-content, #application, #wrapper')) e.scrollTop = 0; });
        await pause(300);

        const m = await page.evaluate(() => {
          const row = document.querySelector('.ic-app-nav-toggle-and-crumbs'), s = document.querySelector('#gz-ctabs');
          if (!row) return null;
          const c = getComputedStyle(row), b = getComputedStyle(row, '::after');
          return { strip: !!s, inRow: !!s && s.parentElement === row, row: [c.backgroundColor, c.backgroundImage.slice(0, 30), c.borderBottomWidth], panel: [b.content, b.borderTopLeftRadius] };
        });
        check(m && /, 0\)$|transparent/.test(m.row[0]) && m.row[2] === '0px', `${look} canvas: the breadcrumb row is no filled band`, m);
        await shot(`canvas-${slug(look)}`);
      },
    };
    for (const name of only.length ? only : Object.keys(S)) for (const look of LOOKS) {
      try { await S[name](look); } catch (e) { check(false, `${look} ${name}: ${e.message.split('\n')[0]}`); await shot(`${name}-${slug(look)}-error`).catch(() => {}); }
    }
    check(errors.length === 0, 'no page errors', errors.slice(0, 3));
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`${results.length - failed} ok, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
