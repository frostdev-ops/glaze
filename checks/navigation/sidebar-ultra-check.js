// Ultra sidebar geometry and live widget continuity on synthetic pages, without an LMS or external requests.
// NODE_PATH=<installed playwright> nice -n 15 node scripts/sidebar-ultra-check.js
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = process.env.EXT || path.join(__dirname, '..');
const out = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sidebar-ultra-'));
let checks = 0, fails = 0;
const check = (ok, text) => { checks++; fails += !ok; console.log(`${ok ? 'ok' : 'FAIL'} ${text}`); };
(async () => {
  let browser;
  try {
    await require('./wait-for-browser.js')();
    browser = await chromium.launch({ headless: true, ...require('./check-env.js').chromeLaunch(), args: ['--host-resolver-rules=MAP * ~NOTFOUND'], chromiumSandbox: false });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const shot = async (name) => { if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `${name}.png`) }); } };
    await page.route('**/*', (r) => r.request().url().startsWith('https://bb.school.test/ultra/') ? r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }) : r.abort());
    const setup = async (family, w = 352) => {
      await page.goto(`https://bb.school.test/ultra/${family === 'courses' ? 'course' : 'courses/_101_1/outline'}`);
      await page.setContent(`<style>
        * { box-sizing: border-box; } body { margin: 0; } #main-content-inner { margin-left: 200px; }
        .base-courses-content, .course-outline-content { display: flex; gap: 16px; }
        .courses-panel, .outline-column { flex: 1; min-width: 0; } .todo-panel, .outline-actions { width: 300px; flex: none; }
        .bb-course-navigation { height: 60px; } .course-content-container > .panel-wrap { position: relative; z-index: 20; }
        .layer-details { position: fixed; inset: 0; z-index: 2000; background: white; }
      </style><div id="site-wrap"><div id="main-content-inner">${family === 'courses'
        ? '<section class="base-courses-container route-view-container"><div class="base-courses-header-container" style="display:flex;justify-content:space-between"><h1>Courses</h1><div class="base-header-tools"><button>Hide widgets</button><button id="tools-end">Edit layout</button></div></div><div class="base-courses-content"><div class="courses-panel"><button id="main-end" style="float:right">Last course</button></div><div class="todo-panel"><bb-todo>Native To Do</bb-todo></div></div><nav id="pager" style="display:flex;justify-content:flex-end"><button id="pager-end">Next page</button></nav></section>'
        : '<div class="course-content-container"><div class="panel-wrap"><div class="bb-course-navigation">Course navigation</div><section class="course-outline-content"><div class="outline-column"><button id="main-end" style="float:right">Last item</button></div><aside class="outline-actions"><button>Faculty</button></aside></section></div></div>'}</div></div>`);
      for (const file of ['features/apps.css', 'features/sidebar.css']) await page.addStyleTag({ path: path.join(root, file) });
      for (const file of ['lib/widgets.js', 'lib/sidebar.js']) await page.addScriptTag({ path: path.join(root, file) });
      await page.evaluate((w) => {
        const rec = GZ_SIDEBAR.clean({ mig: 1, width: w, chose: { width: true }, dock: [{ id: 'notes' }], dest: { notes: 'dock' } });
        window.chrome = { storage: { local: { get: (key, cb) => cb({ [key]: rec }) }, onChanged: { addListener() {}, removeListener() {} } }, runtime: {} };
        window.GZ_CTX = { site: 'ultra', t: (s) => s, need: async () => {}, account: async () => '_42_1', courseId: () => '_101_1', settings: () => ({ enhance: { sidebar: true, notes: true, todo: true } }) };
      }, w);
      await page.evaluate(() => {
        window.nativeRoot = [...document.documentElement.attributes].map((a) => [a.name, a.value]);
        window.nativeTree = document.getElementById('site-wrap').outerHTML;
      });
      await page.addScriptTag({ path: path.join(root, 'features/sidebar.js') });
      await page.evaluate(async () => { GZ_SIDEBAR_UI.sync(true); await GZ_SIDEBAR_UI.ready(); });
      await page.waitForSelector('[data-gz-sidebar-host]', { state: 'attached' });
      await page.waitForTimeout(100);
    };
    for (const family of ['courses', 'outline']) {
      await setup(family);
      const clear = () => page.evaluate(() => document.querySelector('#main-end').getBoundingClientRect().right + 16 <= document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().left);
      check(await clear(), `${family}: expanded content keeps the sidebar width and gap`);
      await shot(`${family}-expanded`);
      if (family === 'courses') {
        await page.evaluate(() => {
          const room = document.createElement('div'); room.id = 'gz-room';
          room.innerHTML = '<section class="gz-w" style="position:absolute;right:0;width:288px;height:100px">Course card</section>';
          document.querySelector('#main-content-inner').prepend(room);
        });
        check(await page.evaluate(() => document.querySelector('#gz-room .gz-w').getBoundingClientRect().right + 16 <= document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().left), 'course cards at the board edge keep clear of the dock too');
      }
      await page.evaluate(() => document.documentElement.setAttribute('data-gz-sidebar', 'collapsed'));
      check(await clear(), `${family}: collapsed content keeps the sidebar width and gap`);
      await page.evaluate(() => { document.getElementById('gz-room')?.remove(); GZ_SIDEBAR_UI.sync(false); });
      check(await page.locator('[data-gz-sidebar-host]').count() === 0 && await page.locator('#main-end').isVisible(), `${family}: teardown restores native flow`);
      const restored = await page.evaluate(() => ({ tree: nativeTree === document.getElementById('site-wrap').outerHTML,
        root: [...document.documentElement.attributes].map((a) => [a.name, a.value]), before: nativeRoot }));
      check(restored.tree && JSON.stringify(restored.before) === JSON.stringify(restored.root), `${family}: teardown restores the complete native DOM and html attributes (${JSON.stringify(restored)})`);
    }
    await setup('outline');
    await page.evaluate(() => { document.querySelector('aside.outline-actions').remove(); GZ_SIDEBAR_UI.sync(true); });
    await page.waitForSelector('#gz-sidebar');
    check(await page.evaluate(() => Math.abs(document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().left - document.querySelector('#main-end').getBoundingClientRect().right - 16) < 1), 'missing native host reserves the width once, without a second blank column');
    await page.evaluate(() => document.documentElement.setAttribute('data-gz-sidebar', 'collapsed'));
    check(await page.evaluate(() => Math.abs(document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().left - document.querySelector('#main-end').getBoundingClientRect().right - 16) < 1), 'missing native host reserves its collapsed width once');
    await page.evaluate(() => {
      const inner = document.querySelector('#main-content-inner'); inner.removeAttribute('id');
      inner.className = 'routed-page bb-offcanvas-container';
      document.querySelector('.course-content-container').className = '';
      GZ_SIDEBAR_UI.sync(true);
    });
    await page.waitForTimeout(100);
    check(await page.evaluate(() => Math.abs(document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().left - document.querySelector('#main-end').getBoundingClientRect().right - 16) < 1), 'a routed page without main-content-inner also reserves room');
    // Ultra's side panel (a peek: Notification Settings) in #main-content, which a drawn background isolates (extras.css):
    // the panel, its overlay at 1010 and itself at 1011 as measured live, is over Glaze's column and its launcher.
    await setup('outline');
    await page.addStyleTag({ path: path.join(root, 'extras.css') });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-gz-bg', 'gradient');
      document.querySelector('aside.outline-actions').remove(); GZ_SIDEBAR_UI.sync(true);
      document.getElementById('site-wrap').insertAdjacentHTML('beforeend', `<main id="main-content" class="bb-offcanvas-container bb-offcanvas-open over-right" style="position:fixed;inset:0;pointer-events:none">
        <div class="bb-offcanvas-overlay" style="position:absolute;inset:0;z-index:1010;background:rgb(0 0 0 / .6);pointer-events:auto"></div>
        <div class="first bb-offcanvas-panel bb-offcanvas-right peek active" style="position:absolute;top:0;bottom:0;right:0;width:420px;z-index:1011;background:#fff;display:flex;flex-direction:column;pointer-events:auto">
          <h1 id="peek-title" style="margin:24px 30px">Notification Settings</h1><div style="flex:1"></div>
          <footer style="padding:16px 30px;display:flex;gap:8px;justify-content:flex-end"><button type="button">Cancel</button><button type="button" id="peek-save">Save</button></footer></div></main>`);
      GZ_SIDEBAR_UI.sync(true);
    });
    await page.waitForSelector('#gz-sidebar');
    const over = (sel) => page.evaluate((s) => { const e = document.querySelector(s), r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit?.closest('.peek'); }, sel);
    check(await page.evaluate(() => getComputedStyle(document.getElementById('main-content')).isolation === 'isolate'), 'a drawn background isolates #main-content');
    check(await over('#gz-sidebar') && await over('#peek-save'), 'an open Ultra side panel is over Glaze\'s column, its Save in reach');
    await shot('peek-over-column');
    const settlePeek = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const reachable = (sel) => page.evaluate((s) => {
      const e = document.querySelector(s), r = e.getBoundingClientRect();
      return e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }, sel);
    // Ultra can keep closed panels mounted. Removing the entire node is not the only close path.
    for (const state of ['closed', 'hidden', 'display', 'visibility', 'offscreen', 'left', 'outside']) {
      await page.evaluate((state) => {
        const main = document.getElementById('main-content'), panel = document.querySelector('.peek'), overlay = main.querySelector('.bb-offcanvas-overlay');
        main.append(panel); main.classList.add('bb-offcanvas-open'); panel.classList.add('active');
        main.hidden = false; panel.hidden = false; panel.removeAttribute('aria-hidden');
        panel.style.cssText = 'position:absolute;top:0;bottom:0;right:0;width:420px;z-index:1011;background:#fff;display:flex;flex-direction:column;pointer-events:auto';
        overlay.style.display = 'none';
        if (state === 'closed') { main.classList.remove('bb-offcanvas-open'); panel.classList.remove('active'); panel.style.transform = 'translateX(100%)'; }
        if (state === 'hidden') main.hidden = true;
        if (state === 'display') panel.style.display = 'none';
        if (state === 'visibility') panel.style.visibility = 'hidden';
        if (state === 'offscreen') panel.style.transform = 'translateX(100%)';
        if (state === 'left' || state === 'outside') { panel.style.right = 'auto'; panel.style.left = '0'; }
        if (state === 'outside') document.body.append(panel);
      }, state);
      await settlePeek();
      check(await reachable('#gz-sidebar .gz-sb-toggle'), `${state} peek leaves the exposed column clickable`);
    }
    await page.evaluate(() => {
      const main = document.getElementById('main-content'), panel = document.querySelector('.peek');
      main.append(panel); panel.style.left = 'auto'; panel.style.right = '0';
      main.querySelector('.bb-offcanvas-overlay').style.display = '';
    });
    await settlePeek();
    await page.evaluate(() => document.documentElement.setAttribute('data-gz-sidebar', 'collapsed'));
    check(await over('#gz-sidebar'), 'an open Ultra peek covers the collapsed fixed column too');
    await page.evaluate(() => document.documentElement.setAttribute('data-gz-sidebar', 'expanded'));
    await page.setViewportSize({ width: 700, height: 900 });
    await page.waitForFunction(() => document.documentElement.dataset.gzSidebar === 'drawer' && !document.getElementById('gz-sb-launch').hidden);
    check(await over('#gz-sb-launch'), 'an open Ultra side panel is over the sidebar\'s launcher');
    await page.evaluate(() => { document.querySelector('.peek').style.bottom = '650px'; document.querySelector('.bb-offcanvas-overlay').style.display = 'none'; });
    await settlePeek();
    check(await reachable('#gz-sb-launch'), 'a peek above the launcher leaves that exposed button clickable');
    if (await reachable('#gz-sb-launch')) {
      await page.locator('#gz-sb-launch').click();
      check(await page.locator('[data-gz-sidebar-host]').evaluate((e) => e.matches(':popover-open')), 'an exposed launcher still opens the sidebar drawer');
      await page.keyboard.press('Escape');
    } else check(false, 'an exposed launcher still opens the sidebar drawer');
    await page.evaluate(() => { document.querySelector('.peek').style.bottom = '0'; document.querySelector('.bb-offcanvas-overlay').style.display = ''; });
    await settlePeek();
    check(await over('#gz-sb-launch'), 'the launcher returns below a peek that covers it again');
    for (const site of ['canvas', 'moodle']) {
      await page.evaluate((site) => { document.documentElement.removeAttribute('data-gz-sb-ultra'); document.documentElement.dataset.gzSite = site; }, site);
      check(await page.locator('#gz-sb-launch').evaluate((e) => getComputedStyle(e).zIndex !== '-1'), `${site}: Ultra peek markup does not lower the launcher`);
    }
    await page.evaluate(() => { document.documentElement.setAttribute('data-gz-sb-ultra', ''); document.documentElement.removeAttribute('data-gz-site'); });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.evaluate(() => document.getElementById('main-content').remove());
    await page.waitForFunction(() => document.documentElement.dataset.gzSidebar === 'expanded');
    check(await page.evaluate(() => { const r = document.getElementById('gz-sidebar').getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + 40)?.closest('#gz-sidebar'); }), 'with the side panel closed, the column is on top again');
    await setup('outline');
    await page.evaluate(() => {
      window.loads = 0;
      const frame = document.createElement('iframe'); frame.id = 'media';
      frame.srcdoc = '<textarea>retained draft</textarea><script>window.birth=Math.random();parent.loads++;</script>';
      document.querySelector('.gz-sb-dock').append(frame);
    });
    await page.waitForFunction(() => window.loads === 1);
    const birth = await page.frames().find((f) => f.parentFrame()).evaluate(() => window.birth);
    await page.evaluate(() => { const b = document.createElement('button'); b.textContent = 'Late schedule'; document.querySelector('aside.outline-actions').append(b); });
    await page.waitForTimeout(150);
    check(await page.evaluate(() => window.loads === 1), 'late native blocks preserve the live iframe document');
    check(await page.evaluate(() => document.querySelector('#gz-sb-widgets').getBoundingClientRect().top >= [...document.querySelector('aside.outline-actions').children].find((e) => e.textContent === 'Late schedule').getBoundingClientRect().bottom), 'late blocks remain visually above the dock');
    await page.evaluate(() => { const layer = document.createElement('div'); layer.className = 'layer-details'; layer.textContent = 'Participation'; document.body.append(layer); GZ_SIDEBAR_UI.sync(true); });
    await page.waitForFunction(() => document.documentElement.dataset.gzSidebar === 'drawer');
    await page.locator('#gz-sb-launch').click();
    check(await page.evaluate(() => { const host = document.querySelector('[data-gz-sidebar-host]'), r = host.getBoundingClientRect(); return host.contains(document.elementFromPoint(r.left + 15, r.top + 15)); }), 'details drawer is reachable above Ultra layers and ancestor stacking contexts');
    await shot('details-drawer');
    check(await page.evaluate(() => document.elementFromPoint(600, 400)?.classList.contains('gz-sb-backdrop')), 'the backdrop intercepts clicks above Ultra details');
    await page.locator('.gz-sb-more').click();
    check(await page.locator('#gz-sb-menu').isVisible(), 'drawer customization stays in the same top layer');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.querySelector('.layer-details').remove(); GZ_SIDEBAR_UI.sync(true); });
    await page.waitForFunction(() => document.documentElement.dataset.gzSidebar === 'expanded');
    check(await page.evaluate(() => window.loads === 1) && await page.frames().find((f) => f.parentFrame()).evaluate((b) => window.birth === b && document.querySelector('textarea').value === 'retained draft', birth), 'opening and closing details preserves media and drafts');
    check(await page.locator('[data-gz-sidebar-host][popover]').count() === 0, 'closing the drawer restores native host attributes');
    // Glaze's fixed footer (theme.css on Ultra), on and off: the column ends above it, and at the window's foot without it.
    await setup('outline');
    await page.evaluate(() => {
      const f = document.createElement('footer'); f.id = 'gz-footer'; f.style.cssText = 'position:fixed;inset:auto 0 0 0;height:32px;z-index:2147483000';
      document.body.append(f); document.documentElement.setAttribute('data-gz-footer', ''); dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(150);
    check(await page.evaluate(() => document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().bottom <= document.getElementById('gz-footer').getBoundingClientRect().top + 1), 'footer on: the column ends above the footer');
    await shot('outline-footer-on');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() => document.documentElement.setAttribute('data-gz-navbar', 'rail'));
    await page.waitForTimeout(150);
    await page.locator('#gz-sb-launch').click();
    check(await page.evaluate(() => { const r = document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect(); return r.bottom <= innerHeight - 96 - 32 + 1; }), 'footer and bottom bar: the drawer ends above both');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 34, left: 44, right: 0 } });
    check(await page.evaluate(() => document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().bottom <= innerHeight - 96 - 32 - 34 + 1), 'the drawer clears the bottom bar with a nonzero safe area');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    check(await page.locator('#gz-sb-launch').evaluate((e) => e.getBoundingClientRect().left >= 44 + 12 - 1), 'the RTL launcher clears the left safe area');
    await page.locator('#gz-sb-launch').click();
    check(await page.locator('[data-gz-sidebar-host]').evaluate((e) => e.getBoundingClientRect().left >= 44 + 12 - 1 && e.getBoundingClientRect().right <= innerWidth - 12), 'the RTL floating drawer clears the left safe area');
    await page.keyboard.press('Escape');
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
    await cdp.detach();
    await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.documentElement.removeAttribute('data-gz-navbar'); document.getElementById('gz-footer').remove(); document.documentElement.removeAttribute('data-gz-footer'); });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(150);
    // Floating keeps its inset from the window's edges (features/sidebar.css --gz-sb-inset); embedded reaches the foot.
    check(await page.evaluate(() => Math.abs(document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().bottom + (document.documentElement.dataset.gzSbStyle === 'float' ? 12 : 0) - innerHeight) <= 1), 'footer off: the column reaches the window\'s foot (less a floating card\'s inset)');
    await setup('courses');
    await page.evaluate(() => document.documentElement.setAttribute('data-gz-sidebar-todo', ''));
    check(await page.locator('bb-todo').isHidden(), 'screen hides native To Do after replacement');
    await page.emulateMedia({ media: 'print' });
    check(await page.locator('bb-todo').isVisible(), 'printing restores native Ultra To Do');
    // ---- Phase 6: pages as Ultra builds them live (2026-10-20), both styles, dark and light Looks ----------------------
    // A discussion's details column in its grid; an assignment's overview (Grades / Attempts absorbed into This page);
    // an unverified attempt (kept native, Save and Close and Submit never covered: stubs whose clicks are
    // counted, nothing is submitted); a page that does not match (nothing absorbed); the Gradebook's absolute tool panel.
    // Ultra's Courses page: its header and Glaze's toolbar in it, the list and the pager all end short of the expanded
    // column and its gap, at three widths and the widest column.
    await page.emulateMedia({ media: 'screen' });
    for (const width of [1800, 1440, 1280]) for (const w of [352, 480]) {
      await page.setViewportSize({ width, height: 900 });
      await setup('courses', w);
      const c = await page.evaluate(() => { const h = document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect(), r = (id) => document.getElementById(id).getBoundingClientRect().right;
        return { mode: document.documentElement.dataset.gzSidebar, left: h.left, tools: r('tools-end'), pager: r('pager-end'), list: r('main-end') }; });
      check(c.mode !== 'expanded' || [c.tools, c.pager, c.list].every((x) => x <= c.left - 16 + 1), `courses ${width} @${w}: ${c.mode}; header tools, list and pager clear of the column (${Math.round(c.tools)}, ${Math.round(c.pager)}, ${Math.round(c.list)} / ${Math.round(c.left)})`);
      if (width === 1800 && w === 480) await shot('p6-ultra-courses-header');
    }
    // Course tabs above the Courses page (features/coursetabs.js: first in #main-content-inner) keep the page's room, so
    // they never cover the column's header.
    for (const dir of ['ltr', 'rtl']) for (const mode of ['expanded', 'collapsed']) {
      await page.setViewportSize({ width: 1600, height: 900 });
      await setup('courses');
      await page.addStyleTag({ path: path.join(root, 'features/coursetabs.css') });
      const g = await page.evaluate(({ dir, mode }) => {
        const h = document.documentElement;
        h.dir = dir; h.setAttribute('data-gz-ctabs', 'page');
        if (mode === 'collapsed') h.setAttribute('data-gz-sidebar', 'collapsed');
        const strip = document.createElement('div'); strip.id = 'gz-ctabs'; strip.dataset.at = 'page';
        strip.innerHTML = '<div class="gz-ctabs-list" role="tablist"><div class="gz-ctab" role="tab" aria-selected="true">Course</div></div>';
        document.getElementById('main-content-inner').prepend(strip);
        const host = document.querySelector('[data-gz-sidebar-host]'), c = host.getBoundingClientRect(), s = strip.getBoundingClientRect();
        return { mode: h.dataset.gzSidebar, strip: [Math.round(s.left), Math.round(s.right)], column: [Math.round(c.left), Math.round(c.right)],
          clear: dir === 'rtl' ? s.left >= c.right + 16 - 1 : s.right <= c.left - 16 + 1, head: host.contains(document.elementFromPoint((c.left + c.right) / 2, c.top + 4)) };
      }, { dir, mode });
      check(g.mode === mode && g.clear && g.head, `courses ${dir} ${mode}: course tabs above the page keep clear of the column and its header (${JSON.stringify(g)})`);
      if (dir === 'ltr' && mode === 'expanded') await shot('courses-ctabs-column');
    }
    await page.setViewportSize({ width: 1600, height: 900 });
    const LOOK = { dark: '--gz-surface:#0d1b2e;--gz-surface-2:#060d18;--gz-ink:#e8f2fa;--gz-ink-muted:#8fa8c0;--gz-line:#16283f;--gz-line-strong:#24405f;--gz-accent:#17c8f4;--gz-accent-ink:#04121f;--gz-accent-soft:#082f49',
      light: '--gz-surface:#ffffff;--gz-surface-2:#f4f5f7;--gz-ink:#14181f;--gz-ink-muted:#5b6472;--gz-line:#e3e6ea;--gz-line-strong:#c8cdd4;--gz-accent:#2563eb;--gz-accent-ink:#ffffff;--gz-accent-soft:#dbeafe' };
    const panelWrap = (inner) => `<section class="assessment-overview-modern-panel routed-page route-view-container"><learning-module-panel-view class="routed-page-body"><div class="table-of-contents-disabled"><div class="panel-content-body"><div class="root-learning-module-panel"><div id="learningModulePanelContainerId" class="content-item-container">${inner}</div></div></div></div></learning-module-panel-view></section>`;
    const overview = (titled) => `<div class="content-item-container-children"><content-body><div class="base-body"><div class="content-root"><div class="standard-content-body"><div class="assessment-overview-grid">
      <div class="overview-section overview-description-section main-section-container"><h2>Description</h2><p>Write a short essay.</p></div>
      <div class="overview-section overview-due-date-section main-section-container"><h2>Due date</h2><p>Sunday 11:59 PM</p></div>
      <div class="overview-section overview-attempts-section overview-attempts-section-container">${titled ? '<h2 id="grades-attempts-header" class="section-label">Grades / Attempts</h2>' : ''}<p>Maximum points: 5</p><p>Attempts: Unlimited</p><a href="#instructions" class="button button-attempt js-multiple" id="view">View instructions</a></div>
      <div class="overview-section assessment-details-section main-section-container"><h2>Details</h2><p id="main-end-text">Rubric and more.</p><a href="#more" id="main-end">More</a></div></div></div></div></div></content-body></div>`;
    const attempt = `<bb-assignment-attempt-authoring-panel><div class="body" style="display:flex;flex-direction:column;height:100%"><div style="flex:1;overflow:auto;padding:24px"><div class="makeStylesdetails-7"><h2>Details &amp; Information</h2><p>Assessment due date: 10/25, 11:59 PM</p><p>Attempts: Unlimited</p><a href="#rubric" id="rubric">This item is graded with a rubric</a><p>Grading: Maximum points 5</p><h3>Description</h3><p>Querying a database.</p></div><div class="answer"><p id="main-end-text">Your answer goes here.</p><a href="#a" id="main-end">Attach</a></div></div>
      <div class="makeStylesfooter-2" style="display:flex;gap:16px;justify-content:center;padding:16px;border-top:1px solid var(--gz-line)"><button type="button" id="save">Save and Close</button><button type="button" id="submit">Submit</button></div></div></bb-assignment-attempt-authoring-panel>`;
    const LIVEHTML = {
      discussion: `<section class="routed-page route-view-container"><content-page-header>A discussion</content-page-header><div class="routed-page-body"><div class="students-infinite-scroll-wrap in-view-container-for-large"><section class="panel-content"><div id="discussions-tabpanel"><div class="panel-content-inner"><div id="full-discussions" class="full course-discussion"><div class="course-main-container"><div class="thread"><p>The thread, with replies.</p><button id="main-end" style="float:right">Reply</button></div><div class="layer-details"><div><bb-discussion-settings><div class="full-panel-details"><div class="discussion-settings student-details"><h3>Details &amp; Information</h3><p>Due Sunday</p></div></div></bb-discussion-settings></div><div id="full-panel-details"><div class="discussion-participants show-for-large-up"><h3>Participants</h3><input aria-label="Search"><ul><li>Sam</li><li>Alex</li></ul></div></div></div></div></div></div></div></section></div></div></section>`,
      assessment: panelWrap(overview(true)), mismatch: panelWrap(overview(false)), attempt: panelWrap(attempt),
      gradebook: `<section class="course route-view-container"><div class="course-content-container"><div class="panel-wrap hide-in-background grades"><main class="course-main-content"><div class="course-tool-content"><section class="guidance-wrapper gradebook-panel route-view-container"><table id="course-student-grades-sortable-table"><tr><th>Item</th><th>Due</th><th>Status</th><th id="grade-col">Grade</th></tr><tr><td>Essay</td><td>Oct 25</td><td>Graded</td><td>5/5</td></tr></table></section></div></main></div></div></section>`,
    };
    const PATHS = { discussion: 'courses/_101_1/discussion/_9_1', assessment: 'courses/_101_1/assessment/_7_1/overview', mismatch: 'courses/_101_1/assessment/_7_1/overview', attempt: 'courses/_101_1/assessment/_7_1/attempt', gradebook: 'courses/_101_1/grades' };
    const live = async (kind, { style = 'float', look = 'dark', width = 1600, w = 352, action = 'View instructions' } = {}) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`https://bb.school.test/ultra/${PATHS[kind]}`);
      await page.setContent(`<style>
        * { box-sizing: border-box; } html { ${LOOK[look]}; --gz-radius: 16px; --gz-shadow: 0 8px 24px rgb(0 0 0 / .35); --gz-font: system-ui; color-scheme: ${look}; }
        body { margin: 0; font: 15px/1.5 system-ui; color: var(--gz-ink); background: linear-gradient(135deg, var(--gz-surface-2), color-mix(in srgb, var(--gz-accent) 25%, var(--gz-surface-2))); min-height: 100vh; }
        #main-content-inner { margin-left: 200px; height: 100vh; position: relative; } h2, h3 { margin: 0 0 8px; }
        .routed-page > content-page-header { display: block; height: 47px; position: relative; z-index: 1; background: var(--gz-surface); }
        .routed-page:has(> content-page-header) > .routed-page-body { position: relative; z-index: 0; }
        .course-main-container { display: grid; grid-template-columns: minmax(0, 1fr) 427px; gap: 24px; padding: 24px; }
        .layer-details > * > * > * , .discussion-participants { padding: 12px; border: 1px solid var(--gz-line); border-radius: 16px; background: color-mix(in srgb, var(--gz-surface) 88%, transparent); margin-bottom: 12px; }
        .assessment-overview-modern-panel { position: relative; display: block; height: 100vh; } learning-module-panel-view, .table-of-contents-disabled, .panel-content-body { position: absolute; inset: 0; display: flex; flex-direction: column; }
        .root-learning-module-panel { display: flex; flex-direction: row-reverse; flex: 1; overflow: hidden; } #learningModulePanelContainerId { flex: 1; overflow: auto; }
        .standard-content-body { display: flex; flex-direction: column; padding: 24px; position: relative; }
        .assessment-overview-grid { display: grid; grid-template-columns: minmax(0, 1fr) 0 392px; gap: 24px; }
        .assessment-overview-grid > .main-section-container { grid-column: 1 / span 2; } .overview-attempts-section { grid-area: 1 / 3 / span 2 / span 1; padding: 16px; border: 1px solid var(--gz-line); border-radius: 16px; }
        .button { display: block; padding: 10px; text-align: center; border-radius: 12px; background: var(--gz-accent); color: var(--gz-accent-ink); }
        bb-assignment-attempt-authoring-panel { display: block; height: 100%; } .makeStylesdetails-7 { padding: 16px; border: 1px solid var(--gz-line); border-radius: 16px; max-width: 560px; }
        .course-content-container { position: relative; height: 100vh; } .course-content-container > .panel-wrap { position: absolute; left: 0; right: 0; top: 0; bottom: 0; overflow-y: auto; overflow-x: hidden; }
        .course-tool-content { padding-right: 32px; } table { width: 100%; border-collapse: collapse; } td, th { padding: 8px; border-bottom: 1px solid var(--gz-line); text-align: left; }
        button { font: inherit; padding: 8px 16px; border-radius: 999px; border: 1px solid var(--gz-line-strong); background: var(--gz-surface); color: var(--gz-ink); }
      </style><div id="site-wrap"><div id="main-content-inner">${LIVEHTML[kind]}</div></div>`);
      for (const file of ['features/apps.css', 'features/sidebar.css']) await page.addStyleTag({ path: path.join(root, file) });
      for (const file of ['lib/widgets.js', 'lib/sidebar.js']) await page.addScriptTag({ path: path.join(root, file) });
      await page.evaluate(({ style, w, action }) => {
        const rec = GZ_SIDEBAR.clean({ mig: 1, width: w, chose: { width: true }, dock: [{ id: 'notes' }], dest: { notes: 'dock' } });
        window.chrome = { storage: { local: { get: (key, cb) => cb({ [key]: rec }) }, onChanged: { addListener() {}, removeListener() {} } }, runtime: {} };
        const actionLink = document.getElementById('view');
        if (actionLink) actionLink.textContent = action;
        window.clicks = {};
        for (const id of ['view', 'rubric', 'save', 'submit']) document.getElementById(id)?.addEventListener('click', (e) => { e.preventDefault(); clicks[id] = (clicks[id] || 0) + 1; });
        const set = { enhance: { sidebar: true, notes: true, todo: true }, sidebar: { style }, navbar: { style: 'float' } };
        window.SET = set;
        window.GZ_CTX = { site: 'ultra', t: (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v?.[k] ?? ''), need: async () => {}, account: async () => '_42_1', courseId: () => '_101_1', settings: () => set };
        // The structure, before: each node's parent and index.
        window.nativeHTML = document.getElementById('site-wrap').outerHTML;
        window.before = [...document.querySelectorAll('#site-wrap *')].map((e) => [e, e.parentNode, [...e.parentNode.children].indexOf(e)]);
      }, { style, w, action });
      await page.addScriptTag({ path: path.join(root, 'features/sidebar.js') });
      await page.evaluate(async () => { GZ_SIDEBAR_UI.sync(true); await GZ_SIDEBAR_UI.ready(); });
      await page.waitForSelector('[data-gz-sidebar-host]', { state: 'attached' });
      await page.waitForTimeout(250);
    };
    const unmovedLive = () => page.evaluate(() => before.every(([e, p, i]) => e.parentNode === p && [...p.children].filter((k) => !/^gz-/.test(k.id) && !/(^|\s)gz-/.test(k.className)).indexOf(e) === i));
    const hostBox = () => page.evaluate(() => { const r = document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, mode: document.documentElement.dataset.gzSidebar }; });
    for (const style of ['float', 'embed']) for (const look of ['dark', 'light']) {
      const tag = `${style} ${look}`;
      await live('discussion', { style, look });
      check(await page.evaluate(() => document.querySelector('.layer-details').dataset.gzSidebarHost === 'native' && document.documentElement.dataset.gzSidebar === 'expanded'), `discussion ${tag}: Ultra's details column is the sidebar, expanded`);
      check(await page.evaluate(() => document.querySelector('#main-end').getBoundingClientRect().right + 16 <= document.querySelector('.layer-details').getBoundingClientRect().left + 1), `discussion ${tag}: the thread keeps clear of it`);
      check(await page.evaluate(() => {
        const header = document.querySelector('content-page-header').getBoundingClientRect();
        const head = document.querySelector('.gz-sb-head').getBoundingClientRect();
        return head.top >= header.bottom && [...document.querySelectorAll('.gz-sb-head button')].filter((e) => e.getClientRects().length).every((e) => {
          const r = e.getBoundingClientRect();
          return e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        });
      }), `discussion ${tag}: sidebar heading and controls clear the breadcrumb and receive pointer input`);
      check(await unmovedLive(), `discussion ${tag}: no node moved`);
      await shot(`p6-ultra-discussion-${style}-${look}`);
      for (const surface of ['glass', 'solid']) {
        await page.evaluate((surface) => { SET.sidebar.surface = surface; GZ_SIDEBAR_UI.sync(true); }, surface);
        await page.waitForTimeout(80);
        check(await page.locator('[data-gz-sidebar-host]').evaluate((e, surface) => {
          const c = getComputedStyle(e);
          return surface === 'solid' ? c.backdropFilter === 'none' : c.backdropFilter.includes('blur');
        }, surface), `discussion ${tag} ${surface}: the chosen surface filter`);
        check(await page.locator('[data-gz-sidebar-host]').evaluate((e, style) => {
          const c = getComputedStyle(e);
          return parseFloat(c.borderInlineStartWidth) > 0 && (style === 'float' ? c.boxShadow !== 'none' && parseFloat(c.borderRadius) > 0 : c.boxShadow === 'none' && parseFloat(c.borderRadius) === 0);
        }, style), `discussion ${tag} ${surface}: the style's border, shadow and corners`);
      }
      await live('assessment', { style, look });
      const a = await page.evaluate(() => {
        const sec = document.querySelector('.overview-attempts-section'), h = document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect(), r = sec.getBoundingClientRect(), v = document.getElementById('view').getBoundingClientRect();
        const main = document.querySelector('.assessment-details-section').getBoundingClientRect();
        return { absorbed: sec.hasAttribute('data-gz-sb-absorbed') || !!document.getElementById('gz-sb-absorb'), inside: r.left >= h.left - 1 && r.right <= h.right + 1, hit: document.elementFromPoint(v.left + v.width / 2, v.top + v.height / 2)?.id, clear: main.right <= h.left - 15 };
      });
      check(a.absorbed && a.inside, `assessment ${tag}: Grades / Attempts shows in This page`);
      check(a.hit === 'view', `assessment ${tag}: View instructions is on top and reachable (${a.hit})`);
      check(a.clear, `assessment ${tag}: the main sections keep clear of the sidebar`);
      await page.click('#view');
      check(await page.evaluate(() => clicks.view === 1), `assessment ${tag}: its own click handler still runs`);
      check(await unmovedLive(), `assessment ${tag}: no node moved`);
      check(await page.evaluate(() => nativeHTML === document.getElementById('site-wrap').outerHTML), `assessment ${tag}: native subtree bytes unchanged while absorbed`);
      await shot(`p6-ultra-assessment-${style}-${look}`);
    }
    for (const style of ['float', 'embed']) {
      await live('discussion', { style, width: 1000 });
      check(await page.evaluate(() => {
        const grid = document.querySelector('.course-main-container').getBoundingClientRect();
        const thread = document.querySelector('.thread').getBoundingClientRect();
        return document.documentElement.dataset.gzSidebar === 'drawer' && grid.right - thread.right <= 25;
      }), `discussion ${style}: closed drawer returns the details column's room to the thread`);
    }
    await live('assessment');
    await page.focus('#main-end');
    const order = await page.evaluate(() => [...document.querySelectorAll('#site-wrap a[href], #site-wrap button')].map((e) => e.id));
    check(order.indexOf('view') < order.indexOf('main-end'), 'assessment: View instructions keeps its place in the Tab order (DOM order unchanged)');
    // Collapsed (the settings start each page collapsed; this stand-in has no worker for the account's own toggle).
    await page.evaluate(() => { SET.sidebar.open = 'collapsed'; GZ_SIDEBAR_UI.sync(true); });
    await page.waitForTimeout(150);
    const back = await page.evaluate(() => ({ mode: document.documentElement.dataset.gzSidebar, marked: !!document.querySelector('[data-gz-sb-absorbed], #gz-sb-absorb'), style: document.querySelector('.overview-attempts-section').getAttribute('style') }));
    check(back.mode === 'collapsed' && !back.marked && !back.style, `assessment collapsed: the panel back in the page, no style left (${JSON.stringify(back)})`);
    await live('attempt');
    const t = await page.evaluate(() => {
      const d = document.querySelector('[class*="makeStylesdetails-"]'), hit = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id; };
      return { absorbed: d.hasAttribute('data-gz-sb-absorbed'), save: hit('save'), submit: hit('submit'), footer: !document.querySelector('.makeStylesfooter-2 [data-gz-sb-absorbed], .makeStylesfooter-2[data-gz-sb-absorbed]') };
    });
    check(!t.absorbed && await page.locator('#gz-sb-absorb').count() === 0, 'attempt: unverified Details & Information keeps native layout');
    check(t.save === 'save' && t.submit === 'submit' && t.footer, `attempt: Save and Close and Submit are never covered (${t.save}, ${t.submit})`);
    await page.click('#save'); await page.click('#submit'); await page.click('#rubric');
    check(await page.evaluate(() => clicks.save === 1 && clicks.submit === 1 && clicks.rubric === 1), 'attempt: the stub buttons and the rubric link still take their clicks');
    check(await unmovedLive(), 'attempt: no node moved');
    await shot('p6-ultra-attempt');
    await live('mismatch');
    check(await page.evaluate(() => !document.querySelector('[data-gz-sb-absorbed], #gz-sb-absorb')), 'a structure that does not match: nothing absorbed');
    // Projection safety uses real hit-testing and browser focus, including failure and restore paths.
    const isProjected = () => page.evaluate(() => !!document.querySelector('[data-gz-sb-absorbed], #gz-sb-absorb'));
    for (const style of ['float', 'embed']) {
      await live('assessment', { style });
      check(await isProjected(), `safety ${style}: starts projected`);
      for (const control of ['.gz-sb-more', '.gz-sb-toggle', '.gz-sb-pagehead button']) {
        check(await page.locator(control).evaluate((e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }), `safety ${style}: ${control} is not covered`);
      }
      await page.locator('.gz-sb-more').click();
      check(await page.locator('#gz-sb-menu').isVisible(), `safety ${style}: customization menu is reachable`);
      await page.keyboard.press('Escape');
      await live('assessment', { style });
      check(await isProjected(), `safety ${style}: keyboard check starts projected`);
      await page.focus('#view');
      check(await isProjected(), `safety ${style}: native focus remains visible in the projection`);
      await page.keyboard.press('Enter');
      check(await page.evaluate(() => clicks.view === 1 && document.activeElement.id === 'view'), `safety ${style}: keyboard activation keeps native focus and handler`);
      await page.keyboard.press('Tab');
      check(await page.evaluate(() => document.activeElement.id === 'main-end'), `safety ${style}: native Tab order remains intact`);
      check(await isProjected(), `safety ${style}: scroll check starts projected`);
      // A sidebar scroll must restore in the same event, rather than leaving native focus outside that scroller.
      await page.evaluate(() => {
        const pad = document.createElement('div'); pad.style.height = '2000px'; document.querySelector('.gz-sb-dock').append(pad);
        document.querySelector('[data-gz-sidebar-host]').scrollTop = 600;
      });
      await page.waitForTimeout(100);
      check(!await isProjected(), `safety ${style}: sidebar scrolling restores instead of clipping native controls`);
      await page.focus('#view');
      check(await page.locator('#view').evaluate((e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }), `safety ${style}: keyboard can still reach the real View instructions`);
      await page.evaluate(() => GZ_SIDEBAR_UI.sync(true));
      await page.waitForTimeout(80);
      check(!await isProjected(), `safety ${style}: subsequent passes do not restart a scroll loop`);
      await page.evaluate(() => GZ_SIDEBAR_UI.sync(false));
      check(await page.evaluate(() => nativeHTML === document.getElementById('site-wrap').outerHTML), `safety ${style}: full absorb/restore cycle is byte-identical`);
    }
    await live('assessment', { action: 'Start attempt' });
    check(await isProjected(), 'Start attempt: verified overview is projected without relying on English button text');
    await page.locator('#view').click();
    check(await page.evaluate(() => clicks.view === 1), 'Start attempt: only the fixture handler runs at its visual position');
    const ax = await page.context().newCDPSession(page);
    const tree = (await ax.send('Accessibility.getFullAXTree')).nodes;
    check(tree.some((n) => !n.ignored && n.role?.value === 'heading' && n.name?.value === 'Grades / Attempts')
      && tree.some((n) => !n.ignored && n.role?.value === 'link' && n.name?.value === 'Start attempt'), 'accessibility: original heading and action stay in the reading tree');
    check(tree.some((n) => !n.ignored && n.role?.value === 'complementary' && n.name?.value === 'Sidebar')
      && tree.some((n) => !n.ignored && n.role?.value === 'heading' && n.name?.value === 'This page'), `accessibility: Sidebar landmark and This page heading have their correct labels (${tree.filter((n) => !n.ignored && ['complementary', 'heading'].includes(n.role?.value)).map((n) => n.name?.value).join(', ')})`);
    check(await page.locator('.gz-sb-slot').getAttribute('aria-hidden') === 'true'
      && await page.locator('#gz-sidebar').getAttribute('aria-owns') === null
      && await page.locator('.gz-sb-pagehead button').getAttribute('aria-describedby') === 'grades-attempts-header', 'accessibility: the visual slot adds no duplicate content or reading-order reassignment');
    await ax.detach();
    for (const how of ['stack', 'transform', 'grid', 'heading', 'ancestor', 'focus', 'route', 'setting', 'drawer', 'print', 'long']) {
      await live('assessment');
      await page.evaluate((how) => {
        const sec = document.querySelector('.overview-attempts-section');
        if (how === 'stack') { document.getElementById('main-content-inner').style.zIndex = '20'; }
        if (how === 'transform') { document.getElementById('main-content-inner').style.transform = 'translateZ(0)'; }
        if (how === 'grid') { document.querySelector('.assessment-overview-grid').style.gridTemplateColumns = '1fr'; }
        if (how === 'heading') { document.getElementById('grades-attempts-header').id = 'unknown-heading'; }
        if (how === 'ancestor') { document.querySelector('.root-learning-module-panel').className = 'unknown'; }
        if (how === 'focus') { document.documentElement.setAttribute('data-gz-focus', ''); }
        if (how === 'route') { history.pushState({}, '', '/ultra/courses/_101_1/assessment/_8_1/attempt'); }
        if (how === 'setting') { SET.sidebar.absorb = false; }
        if (how === 'drawer') { SET.sidebar.open = 'drawer'; }
        if (how === 'print') { dispatchEvent(new Event('beforeprint')); }
        if (how === 'long') { const text = document.createElement('p'); text.textContent = 'Long description. '.repeat(500); sec.append(text); }
        GZ_SIDEBAR_UI.sync(true);
      }, how);
      await page.waitForTimeout(150);
      check(!await isProjected(), `safety ${how}: mismatch restores native flow`);
      if (how === 'focus' || how === 'setting' || how === 'drawer' || how === 'print') {
        check(await page.evaluate(() => nativeHTML === document.getElementById('site-wrap').outerHTML), `safety ${how}: no native attributes or styles left`);
      }
    }
    await live('assessment');
    const nativeStyles = await page.evaluate(() => { GZ_SIDEBAR_UI.sync(false); const c = getComputedStyle(document.querySelector('.overview-attempts-section')); return [c.position, c.padding, c.margin, c.zIndex, c.clipPath]; });
    await page.evaluate(() => GZ_SIDEBAR_UI.sync(true));
    await page.waitForTimeout(150);
    await page.emulateMedia({ media: 'print' });
    check(await page.evaluate((before) => { const c = getComputedStyle(document.querySelector('.overview-attempts-section')); return JSON.stringify(before) === JSON.stringify([c.position, c.padding, c.margin, c.zIndex, c.clipPath]); }, nativeStyles), 'printing restores native computed styles');
    await page.emulateMedia({ media: 'screen' });
    for (const style of ['float', 'embed']) for (const width of [1800, 1468, 1479, 1480, 1440, 1280]) for (const w of [352, 480]) {
      await live('gradebook', { style, width, w });
      const g = await page.evaluate(() => { const h = document.querySelector('[data-gz-sidebar-host]'), r = h.getBoundingClientRect(), tb = document.getElementById('course-student-grades-sortable-table').getBoundingClientRect(); return { mode: document.documentElement.dataset.gzSidebar, family: document.documentElement.dataset.gzSbFamily, hostLeft: r.left, tableRight: tb.right, panel: (() => { const el = document.querySelector('.course-content-container > .panel-wrap'), p = el.getBoundingClientRect(), padding = parseFloat(getComputedStyle(el).paddingInlineEnd); return { right: p.right - padding, width: p.width - padding }; })() }; });
      check(g.family === 'grades', `gradebook ${style} ${width} @${w}: the grades family`);
      check(g.mode === 'drawer' || g.tableRight <= g.hostLeft - 16 + 1, `gradebook ${style} ${width} @${w}: ${g.mode}, the table ends at the sidebar's edge less the gap (${Math.round(g.tableRight)} / ${Math.round(g.hostLeft)})`);
      check(g.mode !== 'expanded' || Math.abs(g.hostLeft - g.panel.right - 16) <= 1 && g.panel.width >= 900, `gradebook ${style} ${width} @${w}: exactly one reserved column and at least 900px of usable panel (${Math.round(g.panel.width)}px)`);
      check(g.mode !== 'expanded' || width - 200 - w - 16 - (style === 'float' ? 12 : 0) >= 900, `gradebook ${style} ${width} @${w}: expanded only with 900px for the table`);
      if (w === 480 && width === 1800) await shot(`p6-ultra-gradebook-${style}`);
    }
    await live('gradebook');
    await page.evaluate(() => document.documentElement.setAttribute('data-gz-focus', ''));
    check(await page.evaluate(() => Math.abs(document.querySelector('.course-content-container > .panel-wrap').getBoundingClientRect().right - innerWidth) <= 1), 'focus-document mode returns all sidebar room to the course tool');
    for (const tool of ['announcements', 'calendar', 'discussions', 'messages', 'groups', 'achievements']) {
      await live('gradebook');
      await page.evaluate((tool) => {
        document.querySelector('.course-content-container > .panel-wrap').className = `panel-wrap ${tool}`;
        history.replaceState({}, '', `/ultra/courses/_101_1/${tool}`);
        GZ_SIDEBAR_UI.sync(true);
      }, tool);
      await page.waitForTimeout(100);
      check(await page.evaluate(() => { const panel = document.querySelector('.course-content-container > .panel-wrap'); return Math.abs(panel.getBoundingClientRect().right - parseFloat(getComputedStyle(panel).paddingInlineEnd) + 16 - document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().left) <= 1; }), `${tool}: the course tool content keeps the sidebar's gap`);
    }
    await require('./ultra-offcanvas-fixture.js')({ page, root, check, shot });
    console.log(JSON.stringify({ checks, fails }));
    process.exitCode = fails ? 1 : 0;
  } finally { await browser?.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
