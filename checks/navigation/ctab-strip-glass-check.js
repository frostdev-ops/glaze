// Computed glass styles against Ultra's captured header structure, including its hashed class.
// NODE_PATH=<playwright> nice node scripts/ctab-strip-glass-check.js [evidence directory]
// EXT selects the source checkout; hold the shared browser lock while running.
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
// A copy holding the school's host, as the student's grant does (scripts/check-env.js staged).
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://bb.school.test/*']);
const G = require(path.join(ext, 'defaults.js')); require(path.join(ext, 'lib/coursetabs.js'));
const site = 'https://bb.school.test', key = `ctabs:${site}:_42_1`;
const out = process.argv[2];
let html = fs.readFileSync(path.join(__dirname, '../test/fixtures/ultra-course.html'), 'utf8')
  .replace('.bb-course-navigation { position: sticky; top: 0; z-index: 10; background: Canvas; }', '.bb-course-navigation { position: sticky; top: 0; z-index: 10; }')
  .replace('.panel-wrap { position: absolute; top: 0; right: 0; bottom: 0; left: 220px;', '.panel-wrap { position: absolute; top: 0; right: 0; bottom: 0; left: 0;')
  .replace('#main-content { height: 100%; margin-left: 220px;', '#main-content { height: 100%; margin-left: 0;')
  .replace('`<div class="bb-course-navigation"><bb-course-navigation>`', '`<div class="bb-course-navigation">`')
  .replace('`<course-page-header><header>`', '`<course-page-header><header class="makeStylesheader-0-2-704">`')
  .replace('`</header></course-page-header>`', '`</header></course-page-header><bb-course-navigation>`');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const results = [];
const check = (value, label, actual) => { results.push({ pass: !!value, label, actual }); console.log(`${value ? 'ok' : 'FAIL'} ${label}${actual === undefined ? '' : ': ' + JSON.stringify(actual)}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => { for (let i = 0; i < 150; i++) { const v = await fn(); if (v) return v; await pause(100); } throw Error('condition timed out'); };
const shot = async (p, name) => { if (out) await p.screenshot({ path: path.join(out, name + '.png') }); };
const measure = (p) => p.evaluate(() => {
  const header = document.querySelector('course-page-header > header'), tools = document.querySelector('bb-course-navigation > [class*="makeStylestoolbar"]');
  const h = getComputedStyle(header), t = getComputedStyle(tools), strip = document.querySelector('#gz-ctabs'), s = getComputedStyle(strip, '::before');
  const box = (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
  const v = getComputedStyle(document.querySelector('div.bb-course-navigation'), '::before');
  return { header: box(header), tools: box(tools), strip: box(strip), inset: [s.left, s.right], border: h.borderBottomWidth,
    paints: [h.backgroundColor, t.backgroundColor], shadows: [h.boxShadow, t.boxShadow], veil: [v.content, v.opacity, v.display],
    filters: [h.backdropFilter, t.backdropFilter, s.backdropFilter], glass: getComputedStyle(document.documentElement).getPropertyValue('--gz-glass').trim() };
});
(async () => {
  let ctx;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-strip-glass-'));
  try {
    if (out) fs.mkdirSync(out, { recursive: true });
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true,
      viewport: { width: 1280, height: 800 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'] });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: html });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: '{"id":"_42_1"}' });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.hostname === 'cdn.school.test') return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    // Simulate an engine rejecting the scroll-timeline @supports block. No polyfill or runtime reads.
    const fallback = await ctx.newPage();
    const css = fs.readFileSync(path.join(ext, 'theme.css'), 'utf8').replace('@supports (animation-timeline: scroll())', '@supports (glaze-no-scroll: unsupported)');
    await fallback.setContent(`<style>${css}</style><style>
      :root { --gz-surface: #fff; --gz-surface-2: #eee; --gz-line: #999; --gz-radius: 12px; --gz-glass: 0px; }
      body { margin: 0; } .scroller { height: 400px; overflow: auto; }
      .bb-course-navigation { position: sticky; top: 0; z-index: 1; }
      header, bb-course-navigation > div { padding: 16px; } .row { height: 40px; }
    </style><div class="scroller"><div class="bb-course-navigation"><course-page-header><header>Course header</header></course-page-header>
      <bb-course-navigation><div class="makeStylestoolbar-test">Content · Calendar · Announcements</div></bb-course-navigation></div>
      ${'<div class="row">Course content scrolling beneath the header</div>'.repeat(30)}</div>`);
    await fallback.evaluate(() => { document.querySelector('.scroller').scrollTop = 180; });
    const backing = await fallback.locator('.bb-course-navigation').evaluate((e) => { const s = getComputedStyle(e, '::before'); return [s.content, s.opacity]; });
    check(backing[0] === '""' && backing[1] === '1', 'without scroll timelines the backing still veils content in header gaps', backing);
    await shot(fallback, 'without-scroll-timelines'); await fallback.close();
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const setup = async (look, at = 'above', sidebar = false) => {
      const base = { ...G.GZ_DEFAULTS, navbar: { ...G.GZ_DEFAULTS.navbar, on: true, tabs: false, rail: 'icons' },
        enhance: Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, ['tabs', 'place', ...(sidebar ? ['sidebar', 'notes', 'widgets'] : [])].includes(k)])) };
      const settings = { ...base, ...G.GZ_LOOK_APPLY(base, look), motion: { ...base.motion, level: 'off' }, tabs: { ...G.GZ_SANITIZE({}).tabs, at } };
      await opts.evaluate(async ({ settings, key, site }) => {
        await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.session.clear();
        await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site], [key]: { tabs: [1, 2].map((i) => ({ cid: `_10${i}_1`, name: `Course ${i}`, path: `/ultra/courses/_10${i}_1/outline`, at: i, top: 0 })) },
          // A docked widget, so the sidebar has something to show.
          [`sidebar:ultra:${site}/_42_1`]: { v: 1, rev: 1, mig: 1, dock: [{ id: 'notes' }], dest: { notes: 'dock' } } });
      }, { settings, key, site });
      await page.goto(`${site}/ultra/courses/_101_1/outline`);
      await page.locator('#gz-ctabs [data-course-id="_102_1"]').waitFor();
      await until(() => page.evaluate(() => !document.querySelector('.spinner') && !!document.querySelector('#gz-navbar')));
      await pause(250);
    };
    for (const look of G.GZ_LOOKS) {
      await setup(look);
      const m = await measure(page);
      check(m.border === '0px' && m.paints[0] === m.paints[1] && m.shadows[0] === m.shadows[1], `${look.name}: captured course header joins the tools without a seam`, m);
      check(m.header[0] === m.tools[0] && m.header[2] === m.tools[2], `${look.name}: header and tools align`);
      await shot(page, look.name.toLowerCase().replaceAll(' ', '-'));
      await page.locator('section.course > .route-view-container').evaluate((e) => {
        e.innerHTML = '<div class="course-announcement-layer"><div class="guidance-wrapper" style="display:flex;justify-content:space-between;padding:16px"><span>19 Total</span><div class="header-actions-menu__item"><button class="MuiButtonBase-root MuiIconButton-root" id="search-button" aria-label="Search announcements">⌕</button></div></div></div>';
      });
      const pills = await page.locator('.guidance-wrapper').evaluate((e) => [e, e.querySelector('span'), e.querySelector('button')].map((n) => { const s = getComputedStyle(n); return [s.borderBottomWidth, s.borderRadius, s.backdropFilter]; }));
      check(pills[0][0] === '0px' && pills.slice(1).every((p) => p[0] === '1px' && p[1] === '999px' && p[2] === 'none'), `${look.name}: count and search are pills without another blur`, pills);
      await page.locator('#search-button').focus();
      await shot(page, look.name.toLowerCase().replaceAll(' ', '-') + '-pills');
    }
    const look = G.GZ_LOOKS.find((l) => l.name === 'Aurora Night');
    await setup(look);
    check((await measure(page)).veil[1] === '0', 'scroll timeline leaves the background visible at the top');
    await page.locator('.course-content-container > .panel-wrap').evaluate((e) => { e.scrollTop = 200; }); await pause(200);
    // Scrolled, the bar folds to its tools with no veil (features/sticky-fold.js); shown whole under keyboard focus, the veil
    // is behind it again.
    check((await measure(page)).veil[2] === 'none', 'scrolled, the folded bar has no veil');
    await page.locator('bb-course-navigation a').first().focus(); await pause(200);
    check((await measure(page)).veil[1] === '1', 'whole under keyboard focus, scroll timeline veils content after 48px');
    await page.evaluate(() => document.activeElement?.blur());
    await shot(page, 'scrolled');
    for (const at of ['above', 'between', 'below']) {
      await setup(look, at);
      const m = await measure(page);
      check(at === 'between' ? m.border === '1px' && m.tools[1] > m.strip[1] + m.strip[3] : m.border === '0px', `${at}: the header divider matches placement`, m);
      await shot(page, at);
    }
    for (const [mode, selector] of [['routed', '.b8b-document'], ['nested', 'a[href*="/outline/edit/document/"]'], ['page', '[data-analytics-id="course.header.home"]']]) {
      await setup(look);
      await page.locator(selector).evaluate((e) => e.click());
      await page.waitForSelector(`#gz-ctabs[data-at="${mode}"]`); await pause(300);
      const room = await page.locator('#gz-ctabs').evaluate((e) => ({ x: e.getBoundingClientRect().x, rail: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gz-navbar-left')) }));
      check(room.x >= room.rail, `${mode}: the strip stays beside the rail`, room);
      if (mode === 'routed') {
        const link = await page.locator('.routed-page [class*="panelHeaderContainerRoot"] a').evaluate((e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
        check(link, 'routed: the return link receives pointer input');
      }
      await shot(page, mode);
    }
    // Beside Glaze's own sidebar, a tool page's header (the strip and the course bar) spans the window as on Content, and a
    // routed page's header row too; only the content keeps the column's room, and the column starts under the header.
    await page.setViewportSize({ width: 1528, height: 1000 });
    for (const dir of ['ltr', 'rtl']) {
      await setup(look, 'above', true);
      await page.evaluate((dir) => { document.documentElement.dir = dir; }, dir);
      await page.locator('.js-course-calendar-tool').click();
      await page.waitForSelector('html[data-gz-sb-tool][data-gz-sidebar="expanded"]', { state: 'attached' }); await pause(400);
      const room = (sel) => page.evaluate((sel) => {
        const r = (s) => { const e = document.querySelector(s), b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); };
        return { header: r(sel.header), content: r(sel.content), side: r('#gz-sidebar'), vw: innerWidth, rtl: document.documentElement.dir === 'rtl' };
      }, sel);
      const spans = (m) => (m.rtl ? m.header[0] <= 13 : m.header[2] >= m.vw - 13) && m.side[1] >= m.header[3] && (m.rtl ? m.content[0] >= m.side[2] : m.content[2] <= m.side[0]);
      const tool = await room({ header: 'course-page-header > header', content: 'section.course > .route-view-container' });
      check(spans(tool), `${dir} tool page beside the sidebar: the course header spans the window, the column starts under it, the content keeps clear`, tool);
      await shot(page, `sidebar-tool-${dir}`);
      await page.locator('.js-course-outline-tool').click(); await page.waitForSelector('.b8b-document');
      await page.locator('.b8b-document').evaluate((e) => e.click());
      await page.waitForSelector('#gz-ctabs[data-at="routed"]'); await page.waitForSelector('html[data-gz-sidebar="expanded"]:not([data-gz-sb-tool])', { state: 'attached' }); await pause(400);
      const routed = await room({ header: '.routed-page [class*="headerRoot"]', content: '.routed-page main' });
      check(spans(routed), `${dir} routed page beside the sidebar: its header row spans the window, the reading keeps clear`, routed);
      await shot(page, `sidebar-routed-${dir}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await setup(look);
    await page.locator('#gz-ctabs [data-course-id="_102_1"]').click();
    const frame = await until(() => Promise.resolve(page.frames().find((f) => f.name() === 'gz-ctab:_102_1')));
    await frame.waitForSelector('#gz-ctabs');
    // A real course frame has no base page or native nav under the course.
    await frame.evaluate(() => {
      document.querySelector('#main-content')?.remove(); document.querySelector('.MuiDrawer-paper')?.remove();
      const content = document.querySelector('.course-content-container'), course = content.querySelector('section.course');
      course.replaceWith(...course.childNodes);
      const inner = document.createElement('div'); inner.className = 'inner-wrap';
      content.replaceWith(inner); inner.append(course); course.append(content); course.classList.add('bb-offcanvas-container');
    });
    await until(() => frame.evaluate(() => document.documentElement.hasAttribute('data-gz-through') && !document.documentElement.hasAttribute('data-gz-ctab-framed')));
    await until(() => page.evaluate(() => document.documentElement.hasAttribute('data-gz-ctab-framed') && document.querySelector('iframe[data-gz-through]')));
    await pause(300);
    const f = await measure(frame);
    check(f.border === '0px' && f.paints[0] === f.paints[1], 'see-through frame keeps the joined course panel', f);
    check(f.inset[0] === '0px' && f.inset[1] === '12px', 'frame starts after the parent rail gutter', f.inset);
    check(await page.locator('#site-wrap #gz-ctabs').evaluate((e) => getComputedStyle(e).visibility === 'hidden'), 'covered page strip cannot ghost through');
    await shot(page, 'frame');
    await page.setViewportSize({ width: 375, height: 812 }); await pause(500);
    const phone = await measure(frame);
    check(phone.inset.join() === '12px,12px', 'phone frame restores both window gaps', phone.inset);
    await shot(page, 'phone-frame');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    await frame.evaluate(() => { document.documentElement.dir = 'rtl'; }); await pause(500);
    const rtl = await measure(frame);
    check(rtl.inset.join() === '12px,0px', 'RTL frame insets mirror the rail', rtl.inset);
    await shot(page, 'rtl-frame');
    await page.emulateMedia({ forcedColors: 'active' });
    check(await frame.locator('#gz-ctabs [aria-selected="true"]').evaluate((e) => getComputedStyle(e).borderTopWidth === '2px'), 'forced colors preserve the selected tab edge');
    await shot(page, 'forced-colors');
    check(errors.length === 0, 'no page errors', errors);
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    if (out) fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`${results.length - failed} ok, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
