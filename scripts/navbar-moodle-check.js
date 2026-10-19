// Headless navigation checks in the editor preview and the local Moodle test instance.
// NODE_PATH=<playwright node_modules> nice -n 15 node scripts/navbar-moodle-check.js [evidence directory]
// The caller holds /private/tmp/claude-501/glaze-heavy.lock. HTTP permissions use a temporary extension/profile.
// A calendar block is added only to a GLZ test course and removed in finally, alongside the browser profile.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const source = path.resolve(__dirname, '..'), G = require('../defaults.js');
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-moodle-evidence-')));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-moodle-run-'))), ext = path.join(tmp, 'extension');
const checks = [], errors = [], services = [];
const ok = (value, label) => { assert.ok(value, label); checks.push(label); console.log('ok ' + label); };
const until = async (fn, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw Error('Timed out: ' + fn); };
(async () => {
  let ctx, blockId;
  const mdc = path.join(os.homedir(), 'Projects/moodle-dev/mdc');
  const localPhp = (code) => execFileSync(mdc, ['exec', '-T', 'webserver', 'php'], { input: '<?php define("CLI_SCRIPT", true); require("/var/www/html/config.php"); \\core\\session\\manager::set_user(get_admin()); ' + code, encoding: 'utf8' }).trim();
  try {
    fs.mkdirSync(out, { recursive: true });
    for (const name of ['failure.json', 'failure.png', 'results.json']) fs.rmSync(path.join(out, name), { force: true });
    fs.cpSync(source, ext, { recursive: true, filter: (f) => !/^\.(git|claude)$|^(safari|node_modules|dist|release|test|docs)$/.test(path.basename(f)) });
    const m = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
    m.host_permissions.push('http://localhost:8081/*');
    for (const w of m.web_accessible_resources) w.matches.push('http://localhost:8081/*');
    m.content_scripts.push({ matches: ['http://localhost:8081/*'], js: m.content_scripts.find((c) => c.matches.includes('https://*.instructure.com/*')).js.filter((f) => f !== 'content-canvas.js'), run_at: 'document_start' });
    fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));
    const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { headless: true, executablePath: process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking'] });
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    await worker.evaluate((s) => chrome.storage.sync.set(s), G.GZ_SANITIZE({ enhance: { dashboard: false }, motion: { level: 'off' } }));
    worker.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await worker.evaluate(() => chrome.storage.local.set({ moodle: ['http://localhost/*'] }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.stack || String(e)));
    page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.endsWith('/lib/ajax/service.php')) services.push({ origin: u.origin, method: u.searchParams.get('info'), verb: r.method(), session: !!u.searchParams.get('sesskey') }); });
    const bar = (fn) => page.evaluate((s) => (0, eval)(s)(document.getElementById('gz-navbar')?.shadowRoot), String(fn));
    const mounted = () => until(() => bar((r) => !!r && !r.host.hidden));
    const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
    const settings = async (patch) => { await worker.evaluate(async (patch) => { const s = (await chrome.storage.sync.get('navbar')).navbar; await chrome.storage.sync.set({ navbar: { ...s, ...patch } }); }, patch); await new Promise((r) => setTimeout(r, 300)); };
    await page.goto(`chrome-extension://${id}/preview.html?site=moodle`); await mounted();
    ok(await page.evaluate(() => {
      const adapter = GZ_NAVBAR_MOODLE(GZ_CTX);
      return ['data-toggle', 'data-bs-toggle'].every((toggle) => {
        // Boost 4.5 and 5.0 core/moremenu_children, including a link inside More.
        const doc = document.implementation.createHTMLDocument('Boost course');
        doc.body.className = 'course-5';
        doc.body.innerHTML = `<div class="secondary-navigation"><ul><li data-key="coursehome"><a href="${location.origin}/course/view.php?id=5" ${toggle}="tab">Course</a></li><li class="dropdown"><a href="#" ${toggle}="dropdown">More</a><ul class="dropdown-menu"><li data-key="participants"><a href="${location.origin}/user/index.php?id=5" ${toggle}="tab" aria-current="true">Participants</a></li></ul></li></ul></div>`;
        const items = adapter.menu(doc)?.items;
        return items?.length === 2 && items[1].key === 'participants' && items[1].active;
      });
    }), 'Boost 4.x and 5.0 course tabs and active More links integrate');
    ok(await bar((r) => r.querySelector('[data-id="dashboard"]') && r.querySelector('[data-id="notifications"] .badge')?.textContent === '2'), 'preview draws Moodle items and badges');
    ok(await page.locator('nav.navbar').evaluate((e) => getComputedStyle(e).display === 'none'), 'preview native header is hidden');
    await shot('preview-rail');
    await page.evaluate((s) => window.postMessage({ gzPreview: s, gzPreviewContext: { site: 'moodle', page: 'outline', viewport: 'desktop' } }, location.origin), G.GZ_SANITIZE({ navbar: { place: 'top' } }));
    await until(() => bar((r) => r.querySelector('.tsub [data-id="cm:0"]')));
    ok(await bar((r) => r.querySelector('.tsub').textContent.includes('Reports')), 'preview top row includes dropdown course pages');
    await shot('preview-top-course');
    // Real Moodle. Successful panel responses come directly from its AJAX services.
    const env = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'Projects/moodle-dev/credentials.env'), 'utf8').split('\n').filter((s) => /^[A-Z_]+=/.test(s)).map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1).replace(/^['"]|['"]$/g, '')]; }));
    await page.goto('http://localhost:8081/login/index.php');
    await page.locator('#username').fill(env.STUDENT_USERNAME); await page.locator('#password').fill(env.STUDENT_PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login/'), { timeout: 90000 }), page.locator('#loginbtn').click()]);
    await page.goto('http://localhost:8081/my/courses.php'); await mounted();
    await until(() => bar((r) => r.querySelector('[data-id="profile"]')));
    ok(await bar((r) => r.querySelector('[data-id="course"][aria-current="page"]')), 'local Moodle marks My courses active');
    ok(await page.locator('nav.navbar').evaluate((e) => getComputedStyle(e).display === 'none'), 'local Moodle header is replaced');
    ok(await bar((r) => +r.querySelector('[data-id="notifications"] .badge')?.textContent > 0), 'real notification count appears');
    await worker.evaluate(() => chrome.storage.sync.set({ navbarItems: { widgets: [{ id: 'clock', at: 'top' }, { id: 'timer', at: 'bottom' }] } }));
    await until(() => bar((r) => !!r.querySelector('.wtop [data-w="clock"] .w-time')?.textContent && !!r.querySelector('.wbottom [data-w="timer"] .w-time')?.textContent));
    ok(true, 'local Moodle renders the clock and timer in the rail');
    await shot('local-rail');
    await bar((r) => r.querySelector('.toggle').click());
    await until(() => worker.evaluate(async () => (await chrome.storage.sync.get('navbar')).navbar.rail === 'icons'));
    ok(true, 'Moodle rail pin persists through the broker');
    await settings({ rail: 'open' });
    const openPanel = async (id) => { await page.evaluate((id) => { const r = document.getElementById('gz-navbar').shadowRoot; r.querySelector('.panel .close')?.click(); r.querySelector(`[data-id="${id}"]`).click(); }, id); await until(() => bar((r) => r.querySelector('.panel .body .row, .panel .body .note'))); };
    await openPanel('profile');
    ok(await bar((r) => r.querySelector('.panel').textContent.includes('Preferences') && r.querySelector('.panel a[href*="logout.php?sesskey="]')), 'profile panel contains real user links and sign out'); await shot('local-profile');
    await bar((r) => r.querySelector('.panel a[href*="/user/preferences.php"]').click()); await page.waitForURL('**/user/preferences.php'); await mounted(); ok(true, 'profile row navigates to Moodle preferences');
    const notificationRequest = '**/lib/ajax/service.php?*info=message_popup_get_popup_notifications*';
    const failRequest = (route) => route.abort('failed');
    await page.route(notificationRequest, failRequest);
    await page.evaluate(() => document.getElementById('gz-navbar').shadowRoot.querySelector('[data-id="notifications"]').click());
    await until(() => bar((r) => r.querySelector('[data-act="panel-retry"]')));
    ok(true, 'failed AJAX shows the retry control');
    await page.unroute(notificationRequest, failRequest);
    await bar((r) => r.querySelector('[data-act="panel-retry"]').click());
    await until(() => bar((r) => r.querySelector('.panel .body a.row')));
    ok(await bar((r) => r.querySelector('.panel .body a.row')?.textContent.length > 0), 'notifications panel has real AJAX rows'); await shot('local-notifications');
    const notificationHref = await bar((r) => r.querySelector('.panel .body a.row').href);
    await bar((r) => r.querySelector('.panel .body a.row').click()); await page.waitForURL(notificationHref); await mounted(); ok(true, 'notification row navigates to its real destination');
    await page.goto('http://localhost:8081/my/courses.php'); await mounted();
    await openPanel('messages');
    const messageRows = await bar((r) => [...r.querySelectorAll('.panel .body a.row')].map((a) => a.href));
    ok(messageRows.length > 0, 'messages panel has real conversation rows'); await shot('local-messages');
    await bar((r) => r.querySelector('.panel .body a.row').click()); await page.waitForURL(messageRows[0]); await mounted(); ok(true, 'conversation row opens Moodle messaging page');
    await page.goto('http://localhost:8081/my/courses.php'); await mounted();
    const courseHref = await page.locator('a[href*="/course/view.php?id="]').first().getAttribute('href');
    const courseId = new URL(courseHref).searchParams.get('id');
    blockId = localPhp(`$course = $DB->get_record('course', ['id' => ${+courseId}], '*', MUST_EXIST); if (strpos($course->idnumber, 'GLZ-') !== 0) { throw new Exception('not a test course'); } $PAGE->set_course($course); $PAGE->set_context(context_course::instance($course->id)); $PAGE->set_pagelayout('course'); $PAGE->set_url('/course/view.php', ['id' => $course->id]); $PAGE->blocks->add_region('side-pre'); $block = $PAGE->blocks->add_block('calendar_month', 'side-pre', 0, false, 'course-view-*'); echo $block->instance->id;`);
    assert.match(blockId, /^\d+$/);
    await settings({ on: false });
    await page.goto(courseHref);
    const nativeStyles = () => page.evaluate(() => {
      const nav = getComputedStyle(document.querySelector('nav.navbar')), page = getComputedStyle(document.getElementById('page')), wrap = getComputedStyle(document.getElementById('page-wrapper'));
      return [nav.display, nav.height, page.marginTop, page.height, wrap.paddingTop, wrap.paddingInlineStart, getComputedStyle(document.querySelector('.secondary-navigation')).display, getComputedStyle(document.querySelector('.btn-footer-popover')).bottom];
    });
    const original = await nativeStyles();
    await settings({ on: true }); await mounted();
    await until(() => bar((r) => r.querySelector('.cmenu [data-id^="cm:"]')));
    ok(await page.locator('.secondary-navigation').evaluate((e) => getComputedStyle(e).display === 'none'), 'native secondary navigation is hidden');
    ok(await bar((r) => r.querySelector('.cmenu').textContent.includes('Participants') && r.querySelector('.cmenu').textContent.includes('Grades')), 'course pages appear in the rail');
    ok(await bar((r) => r.querySelector('.cmenu').textContent.includes('Activities') && r.querySelector('.cmenu').textContent.includes('Competencies')), 'serialized course overflow pages remain available'); await shot('local-course-rail');
    const drawers = async (name) => {
      for (const target of ['courseindex', 'blocks']) {
        await page.mouse.move(page.viewportSize().width / 2, page.viewportSize().height / 2);
        await page.evaluate(() => document.activeElement?.blur());
        await until(async () => await page.locator('.tooltip.show').count() === 0);
        const drawer = page.locator(`#theme_boost-drawers-${target}`);
        ok(await drawer.count() === 1, name + ' ' + target + ' drawer is available');
        if (!await drawer.evaluate((e) => e.classList.contains('show'))) {
          const toggle = page.locator(`[data-target="theme_boost-drawers-${target}"][data-action="toggle"]`).filter({ visible: true }).first();
          if (await toggle.count()) await toggle.click();
        }
        await new Promise((r) => setTimeout(r, 400));
        ok(await drawer.evaluate((e) => e.classList.contains('show')), name + ' ' + target + ' drawer opens');
        ok(await drawer.evaluate((e) => { const r = e.getBoundingClientRect(), s = document.documentElement.style, side = parseFloat(s.getPropertyValue('--gz-navbar-left') || 0); const tabs = document.getElementById('gz-navbar').shadowRoot.querySelector('.tabs'), bottom = getComputedStyle(tabs).display === 'none' ? innerHeight : tabs.getBoundingClientRect().top; return r.bottom <= bottom + 1 && r.x >= (document.documentElement.dir === 'rtl' ? 0 : side) - 1 && r.right <= innerWidth - (document.documentElement.dir === 'rtl' ? side : 0) + 1 && r.y >= parseFloat(s.getPropertyValue('--gz-navbar-top') || 0) - 1; }), name + ' ' + target + ' drawer clears the bar');
        await shot(name + '-' + target);
        await drawer.locator('[data-action="closedrawer"]').first().click();
        await until(() => drawer.evaluate((e) => !e.classList.contains('show')));
      }
    };
    await drawers('local-rail');
    const headerAndFooter = async (name) => {
      ok(await page.locator('#page-header').evaluate((e) => { const r = e.getBoundingClientRect(), s = document.documentElement.style, side = parseFloat(s.getPropertyValue('--gz-navbar-left') || 0); return r.top >= parseFloat(s.getPropertyValue('--gz-navbar-top') || 0) - 1 && (document.documentElement.dir === 'rtl' ? r.right <= innerWidth - side + 1 : r.left >= side - 1); }), name + ' page header clears the bar');
      // Course pages do not always contain a sticky footer: exercise its CSS with an inert fixed element.
      ok(await page.evaluate(() => {
        const existing = document.getElementById('sticky-footer'), e = existing || Object.assign(document.createElement('div'), { id: 'sticky-footer' });
        if (!existing) { e.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:48px'; document.body.append(e); }
        const r = e.getBoundingClientRect(), s = getComputedStyle(document.documentElement), side = parseFloat(s.getPropertyValue('--gz-navbar-left') || 0), tabs = document.getElementById('gz-navbar').shadowRoot.querySelector('.tabs'), bottom = getComputedStyle(tabs).display === 'none' ? innerHeight : tabs.getBoundingClientRect().top;
        const fits = r.left >= (document.documentElement.dir === 'rtl' ? 0 : side) - 1 && r.right <= innerWidth - (document.documentElement.dir === 'rtl' ? side : 0) + 1 && r.bottom <= bottom + 1;
        if (!existing) e.remove(); return fits;
      }), name + ' sticky footer clears the bar');
    };
    await headerAndFooter('local-rail');
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    await settings({ rail: 'icons' });
    await until(() => bar((r) => r.host.dir === 'rtl'));
    await drawers('local-rtl'); await headerAndFooter('local-rtl');
    await page.evaluate(() => { document.documentElement.dir = ''; });
    await settings({ rail: 'open' });
    await settings({ place: 'top' });
    await until(() => bar((r) => r.querySelectorAll('.twidgets .widget').length === 2 && !!r.querySelector('.twidgets [data-w="timer"] .w-time').textContent));
    ok(true, 'local Moodle renders the clock and timer in the top bar');
    await until(() => bar((r) => !r.querySelector('.tsub').hidden));
    ok(await page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue('--gz-navbar-top')) === 124), 'top course row reserves its full height'); await drawers('local-top');
    await headerAndFooter('local-top');
    await settings({ cmenu: false });
    ok(await page.locator('.secondary-navigation').evaluate((e) => getComputedStyle(e).display !== 'none'), 'course menu switch restores secondary navigation');
    await settings({ cmenu: true });
    await page.setViewportSize({ width: 768, height: 900 });
    await until(() => bar((r) => getComputedStyle(r.querySelector('.tabs')).display !== 'none'));
    // Boost animates the fixed footer controls when the viewport changes.
    await until(() => page.locator('.btn-footer-popover').evaluate((e) => e.getBoundingClientRect().bottom <= document.getElementById('gz-navbar').shadowRoot.querySelector('.tabs').getBoundingClientRect().top));
    ok(await page.evaluate(() => {
      const tabs = document.getElementById('gz-navbar').shadowRoot.querySelector('.tabs');
      const communication = Object.assign(document.createElement('button'), { className: 'btn btn-icon btn-footer-communication' });
      document.getElementById('page-footer').append(communication);
      try { return [document.querySelector('.btn-footer-popover'), communication].every((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().bottom <= tabs.getBoundingClientRect().top); }
      finally { communication.remove(); }
    }), '768px fixed footer controls clear the bottom navigation');
    await page.setViewportSize({ width: 390, height: 844 });
    await until(() => bar((r) => getComputedStyle(r.querySelector('.tabs')).display !== 'none'));
    await bar((r) => r.querySelector('.tabs [data-act="more"], .tabs .more').click());
    await until(() => bar((r) => r.querySelector('.sheet').open));
    ok(await bar((r) => r.querySelector('.sheet').textContent.includes('Participants')), 'phone More sheet includes the course menu'); await shot('local-phone-sheet');
    await page.keyboard.press('Escape'); await drawers('local-phone'); await headerAndFooter('local-phone');
    const main = page.locator('#region-main [role="main"], #region-main, main').first();
    const originalTabindex = await main.getAttribute('tabindex');
    await bar((r) => r.querySelector('.skip').click());
    await settings({ on: false });
    await until(() => bar((r) => !r));
    ok(await main.getAttribute('tabindex') === originalTabindex, 'off restores the Skip to content focus target');
    ok(await page.locator('nav.navbar').evaluate((e) => getComputedStyle(e).display !== 'none') && await page.locator('.secondary-navigation').evaluate((e) => getComputedStyle(e).display !== 'none'), 'off restores native header and secondary nav');
    ok(await page.evaluate(() => !document.documentElement.hasAttribute('data-gz-navbar') && !document.documentElement.style.getPropertyValue('--gz-navbar-left')), 'off clears navbar room and attributes'); await shot('local-phone-off');
    await page.setViewportSize({ width: 1440, height: 1000 });
    ok(JSON.stringify(await nativeStyles()) === JSON.stringify(original), 'off restores the original desktop Moodle geometry'); await shot('local-desktop-off');
    ok(await worker.evaluate(async () => { const all = await chrome.storage.local.get(null), rows = Object.entries(all).filter(([k]) => k.startsWith('navbarSeen:http://localhost:8081')); return rows.length > 0 && rows.every(([, items]) => items.every((i) => typeof i.path === 'string' && !i.path.includes('sesskey') && (!i.path.includes('?') || i.path.endsWith('?redirect=0')))); }), 'last-seen navigation caches paths without session keys');
    for (const method of ['message_popup_get_popup_notifications', 'core_message_get_conversations']) {
      const requests = services.filter((s) => s.method === method);
      ok(requests.length > 0 && requests.every((s) => s.origin === 'http://localhost:8081' && s.verb === 'POST' && s.session), method + ' uses local POST with a session key');
    }
    ok(errors.length === 0, 'no page or extension worker runtime errors');
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, errors, services }, null, 2));
    console.log(`${checks.length} checks passed; screenshots: ${out}`);
  } catch (e) {
    await ctx?.pages().at(-1)?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    const w = ctx?.serviceWorkers()[0];
    const diagnostic = await w?.evaluate(async () => {
      const tab = (await chrome.tabs.query({ url: 'http://localhost:8081/*' }))[0];
      return tab ? (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ ctx: !!globalThis.GZ_CTX, on: globalThis.GZ_CTX?.on(), site: globalThis.GZ_CTX?.site, navbar: globalThis.GZ_CTX?.settings().navbar, nav: typeof GZ_NAV, items: typeof GZ_NAV_ITEMS, layout: typeof GZ_NAV_LAYOUT, adapter: typeof GZ_NAVBAR_MOODLE, ui: typeof GZ_NAVBAR_UI, host: !!document.querySelector('#gz-navbar') }) }))[0].result : null;
    }).catch((e) => String(e));
    fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ checks, errors, diagnostic, error: String(e) }, null, 2));
    throw e;
  } finally {
    try { await ctx?.close(); }
    finally {
      try { if (blockId && /^\d+$/.test(blockId)) localPhp(`require_once($CFG->libdir . '/blocklib.php'); $block = $DB->get_record('block_instances', ['id' => ${+blockId}]); if ($block) blocks_delete_instance($block);`); }
      finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
