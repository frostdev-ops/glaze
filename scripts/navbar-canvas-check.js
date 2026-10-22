// Canvas navigation: synthetic editor preview, then real Canvas at localhost:3000 using local test logins only.
// Uses a temporary localhost-enabled extension and profile, removed on exit. No installed extension is changed.
// Hold $GLAZE_LOCK (default glaze-heavy.lock in the OS temp directory) and run under nice (as for the full test suite).
// NODE_PATH=/path/to/node_modules nice -n 15 node scripts/navbar-canvas-check.js [screenshots directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const G = require('../defaults.js'); require('../lib/coursetabs.js'); require('../lib/nav.js');
const src = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'glaze-navbar-canvas-evidence'));
const chromeLaunch = require('./check-env.js').chromeLaunch();
const local = 'http://localhost:3000';
const credentialsFile = process.env.CANVAS_CREDENTIALS || path.join(os.homedir(), 'Projects/canvas-lms/glaze/credentials.env');
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const settings = (navbar = {}, extra = {}) => G.GZ_SANITIZE({ enabled: true, navbar: { on: true, ...navbar }, enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), tabs: true }, tabs: { at: 'nav' }, motion: { level: 'off' }, ...extra });
let checks = 0, ctx, opts, page, tmp, ext, groupId = '', groupOwned = false, historySetting = null, feedbackSetting = null;
const canvasRoot = path.join(os.homedir(), 'Projects/canvas-lms');
const rails = (code) => require('node:child_process').execFileSync('docker', ['compose', 'exec', '-T', 'web', 'bundle', 'exec', 'rails', 'runner', code], { cwd: canvasRoot, encoding: 'utf8', timeout: 60000 });
// Canvas's Setting cache is process-local; HUP clears it without restarting the app or its containers.
const reloadCanvas = () => require('node:child_process').execFileSync('docker', ['compose', 'exec', '-T', 'web', 'ruby', '-e', `Dir.glob('/proc/[0-9]*/cmdline').each { |p| begin; Process.kill('HUP', p.split('/')[2].to_i) if File.read(p).start_with?('Passenger RubyApp:'); rescue Errno::ENOENT, Errno::ESRCH; end }`], { cwd: canvasRoot, timeout: 10000 });
const errors = [], shots = [], apiResults = [], layoutFailures = [];
const ok = (v, label) => { if (!v) throw Error(label); console.log(`ok   ${label}`); checks++; };
const layoutProbe = (v, label) => { if (v) ok(v, label); else { layoutFailures.push(label); console.error(`FAIL ${label}`); } };
const wait = async (read, accepts, label) => { let v; const end = Date.now() + 20000; do { v = await read(); if (accepts(v)) return v; await page.waitForTimeout(80); } while (Date.now() < end); throw Error(`${label} (last: ${JSON.stringify(v)})`); };
const bar = (fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gz-navbar')?.shadowRoot, a), [String(fn), arg]);
const ready = () => wait(() => bar((r) => !!r && !r.host.hidden), Boolean, 'navbar ready');
const shot = async (name) => { const p = path.join(out, `${name}.png`); await page.screenshot({ path: p }); shots.push(p); };
const set = async (navbar, extra) => { await opts.evaluate((s) => chrome.storage.sync.set(s), settings(navbar, extra)); await page.waitForTimeout(250); };
const closePanel = async () => { await bar((r) => r?.querySelector('.panel .close')?.click()); };
const openPanel = async (id, scope = '.rail') => {
  await closePanel();
  const before = page.url();
  await bar((r, a) => r.querySelector(`${a.scope} [data-id="${a.id}"]`).click(), { id, scope });
  await wait(() => bar((r) => { const p = r?.querySelector('.panel'); return p && !p.hidden && !!p.querySelector('.body, [data-act="panel-retry"]'); }), Boolean, `${id} panel response`);
  const result = await bar((r) => ({ error: !!r.querySelector('.panel [data-act="panel-retry"]'), title: r.querySelector('.panel h2')?.textContent, rows: [...r.querySelectorAll('.panel a.row')].map((a) => ({ label: a.textContent.trim(), href: a.href })), empty: r.querySelector('.panel .body .note')?.textContent }));
  ok(page.url() === before, `${id} opens without jumping to a page`);
  ok(!await page.locator('#nav-tray-portal [role=dialog], #global_nav_tray_container [role=dialog]').count(), `${id} leaves Canvas trays closed`);
  ok(!result.error, `${id} opens a Glaze panel (${result.rows.length} links)`);
  return result;
};
const navigateRow = async (id) => {
  const result = await openPanel(id), row = result.rows[0];
  ok(!!row, `${id} has a real destination`);
  await shot(`live-${id}-panel`);
  const dest = new URL(row.href);
  if (dest.origin !== local) {
    // Exercise the popup destination without sending a request to an external help provider.
    await ctx.route(row.href, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Help destination check</title>' }));
    const request = ctx.waitForEvent('request', { predicate: (r) => r.isNavigationRequest() && r.url() === row.href });
    const opened = page.waitForEvent('popup');
    await page.locator('#gz-navbar .panel a.row').first().click();
    const p = await opened; await request; await p.waitForURL(row.href); ok(true, `${id} row opens its external destination (network intercepted)`); await p.close(); await ctx.unroute(row.href);
  } else {
    await page.locator('#gz-navbar .panel a.row').first().click();
    await wait(async () => {
      if (new URL(page.url()).pathname === dest.pathname) return true;
      return page.frames().some((f) => { try { return new URL(f.url()).pathname === dest.pathname; } catch { return false; } });
    }, Boolean, `${id} row navigation`);
    ok(true, `${id} row navigates to ${dest.pathname}`);

  }
};
const overlap = async (name) => {
  const r = await page.evaluate(() => {
    const root = document.getElementById('gz-navbar')?.shadowRoot, h = root?.host, place = h?.dataset.place;
    const box = document.getElementById('wrapper')?.getBoundingClientRect(), content = document.getElementById('content')?.getBoundingClientRect();
    const top = root?.querySelector('.tsub:not([hidden])')?.getBoundingClientRect() || root?.querySelector('.topbar').getBoundingClientRect();
    // The icons rail is clipped from a wider element; its full bounding box includes the hidden peek area.
    return { place, x: box?.x, y: box?.y, cx: content?.x, cy: content?.y, rail: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gz-navbar-left')), bottom: top?.bottom, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  ok(!r.overflow, `${name}: no horizontal overflow`);
  if (r.place === 'rail') ok(r.x >= r.rail - 1 && r.cx >= r.rail - 1, `${name}: content clears the rail`);
  if (r.place === 'top') ok(r.cy >= r.bottom - 1, `${name}: content clears both top rows`);
};
const nativeGeometry = () => page.evaluate(() => Object.fromEntries(['header', 'mobile-header', 'wrapper', 'main', 'left-side', 'sticky-container'].map((id) => {
  const e = document.getElementById(id), s = e && getComputedStyle(e);
  return [id, s && [s.display, s.position, s.top, s.marginInlineStart, s.marginInlineEnd, s.paddingTop]];
})));
async function login(who, credentials) {
  await ctx.clearCookies();
  console.log(`local login: ${who.toLowerCase()}`);
  await page.goto(local + '/login/canvas');
  await page.locator('#pseudonym_session_unique_id').fill(credentials[`${who}_EMAIL`]);
  await page.locator('#pseudonym_session_password').fill(credentials[`${who}_PASSWORD`] || credentials.PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login')), page.locator('button[type="submit"], input[type="submit"]').first().click()]);
  await ready();
}
const api = async (route, method = 'GET', form) => {
  const token = (await ctx.cookies(local)).find((c) => c.name === '_csrf_token')?.value;
  const r = await ctx.request.fetch(local + route, { method, headers: { Accept: 'application/json', ...(token ? { 'X-CSRF-Token': decodeURIComponent(token) } : {}) }, ...(form ? { form } : {}) });
  const body = await r.text();
  if (!r.ok()) throw Error(`Local Canvas ${route}: ${r.status()}`);
  return JSON.parse(body.replace(/^\s*while\(1\);/, ''));
};
(async () => {
  fs.mkdirSync(out, { recursive: true });
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-navbar-canvas-run-'))); ext = path.join(tmp, 'extension'); fs.mkdirSync(ext);
  try {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) if (/\.(js|css|html)$/.test(e.name) || ['lib', 'features', 'i18n', '_locales', 'assets', 'fonts', 'icons', 'mods', 'sharing'].includes(e.name)) fs.cpSync(path.join(src, e.name), path.join(ext, e.name), { recursive: true });
    const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json')));
    m.host_permissions.push('http://localhost/*');
    m.content_scripts.find((s) => s.matches.includes('https://*.instructure.com/*')).matches.push('http://localhost/*');
    for (const w of m.web_accessible_resources) w.matches.push('http://localhost/*');
    fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...chromeLaunch, headless: true, viewport: { width: 1440, height: 1000 }, locale: 'en-US', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
    opts = await ctx.newPage(); await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e))); page.setDefaultNavigationTimeout(30000);
    page.on('response', (r) => { if (r.url().startsWith(local + '/api/v1/') || r.url() === local + '/help_links') apiResults.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    await page.goto(`chrome-extension://${extensionId(ext)}/preview.html?site=canvas`);
    await page.waitForFunction(() => document.documentElement.dataset.previewReady === 'true'); await ready();
    ok(await page.locator('#header').evaluate((e) => getComputedStyle(e).display) === 'none', 'preview replaces Canvas global nav');
    ok(await bar((r) => r.querySelector('[data-id="messages"] .badge')?.textContent) === '3', 'preview reads native unread badge');
    ok(await bar((r) => !!r.querySelector('.cmenu [data-id="cm:0"][aria-current="page"]')), 'preview integrates course menu and active page');
    await overlap('preview rail'); await shot('preview-rail');
    const send = async (navbar) => { await page.evaluate((s) => window.postMessage({ gzPreview: s }, location.origin), settings(navbar)); await page.waitForTimeout(250); };
    await send({ place: 'top' }); await overlap('preview top'); await shot('preview-top');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#gz-navbar .tabs .more').click();
    ok(await bar((r) => r.querySelector('.sheet').open), 'preview phone More sheet'); await shot('preview-phone-sheet');
    await page.keyboard.press('Escape'); await send({ on: false });
    ok(await page.locator('#header').evaluate((e) => getComputedStyle(e).display) !== 'none', 'preview off restores Canvas');

    // Real Canvas: no API mocking or page-world replacement of the adapter.
    const credentials = Object.fromEntries(fs.readFileSync(credentialsFile, 'utf8').split(/\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')]; }));
    await page.setViewportSize({ width: 1440, height: 1000 }); await set();
    await login('STUDENT', credentials);
    ok(await page.locator('#header').evaluate((e) => getComputedStyle(e).display) === 'none', 'live replaces global nav by default');
    const native = await page.locator('#menu a[id]').evaluateAll((es) => es.map((e) => ({ id: e.id, badge: e.querySelector('.menu-item__badge')?.textContent.trim() || '' })));
    await opts.evaluate(() => chrome.storage.sync.set({ navbarItems: { widgets: [{ id: 'clock', at: 'top' }, { id: 'timer', at: 'bottom' }] } }));
    await wait(() => bar((r) => !!r.querySelector('.wtop [data-w="clock"] .w-time')?.textContent && !!r.querySelector('.wbottom [data-w="timer"] .w-time')?.textContent), Boolean, 'Canvas rail widgets ready');
    ok(true, 'local Canvas renders the clock and timer in the rail');
    const model = await bar((r) => [...r.querySelectorAll('.rail .item[data-id]')].map((e) => ({ id: e.dataset.id, badge: e.querySelector('.badge')?.textContent || '' })));
    const L = require('../lib/navlayout.js');
    ok(native.filter((a) => L.canvas(a.id)).every((a) => model.some((b) => b.id === L.canvas(a.id) && b.badge === a.badge)), 'live items and badges match Canvas');
    ok(await bar((r) => !!r.querySelector('[data-id="dashboard"][aria-current="page"]')), 'live Dashboard is active');
    await overlap('live dashboard'); await shot('live-dashboard');
    // A native-markup fixture covers school LTI links, which the local seed does not install.
    await page.evaluate(() => {
      const li = Object.assign(document.createElement('li'), { id: 'gz-check-tool', className: 'globalNavExternalTool' });
      li.append(Object.assign(document.createElement('a'), { href: '/courses', target: '_blank', textContent: 'School library' })); document.getElementById('menu').append(li);
    });
    await wait(() => bar((r) => !!r.querySelector('.rail [data-id=tools]')), Boolean, 'school tool discovery');
    await openPanel('tools');
    const toolBefore = page.url();
    const popup = page.waitForEvent('popup'); await page.locator('#gz-navbar .panel a.row').first().click();
    const toolPage = await popup; await toolPage.waitForURL(local + '/courses'); await toolPage.close();
    ok(page.url() === toolBefore, 'same-origin school tool preserves its new-tab launch');
    await page.evaluate(() => document.getElementById('gz-check-tool').remove());
    for (const [id, nativeId] of [['calendar', 'calendar'], ['messages', 'conversations']]) {
      const href = await page.locator(`#global_nav_${nativeId}_link`).getAttribute('href'), dest = new URL(href, local);
      await page.locator(`#gz-navbar .rail [data-id="${id}"]`).click();
      await wait(() => new URL(page.url()).pathname, (p) => p === dest.pathname, `${id} native navigation`); await ready();
      ok(await bar((r, id) => !!r.querySelector(`.rail [data-id="${id}"][aria-current=page]`), id), `${id} navigates through Canvas and becomes active`);
      await page.goto(local + '/'); await ready();
    }
    const courses = await openPanel('course'); ok(courses.rows.length >= 4, 'live Courses contains enrolled courses and All courses');
    await shot('live-courses-panel');
    const firstCourse = new URL(courses.rows[0].href).pathname;
    await page.goto(local + firstCourse); await ready();
    await set({ on: false }); const nativeBefore = await nativeGeometry(); await set(); await ready();
    await wait(() => bar((r) => r.querySelectorAll('.cmenu .item').length), (n) => n > 0, 'live course menu');
    ok(await page.locator('#left-side').evaluate((e) => getComputedStyle(e).display) === 'none', 'live course menu replaces Canvas sidebar');
    ok(await page.locator('#courseMenuToggle').evaluate((e) => getComputedStyle(e).display) === 'none', 'live course toggle hidden');
    await overlap('live course rail'); await shot('live-course-rail');
    await set({}, { declutter: { help: true, tabs: ['grades'] } });
    ok(await bar((r) => !r.querySelector('.rail [data-id=help]') && ![...r.querySelectorAll('.cmenu a')].some((a) => /\/grades\/?$/.test(a.pathname))), 'integrated navigation honors Hide help and hidden course Grades');
    await set({ style: 'embed', rail: 'icons' }); await overlap('live embedded icons');
    await set();
    // The local server serves LTR CSS; set the effective page direction as an RTL Canvas build does.
    const direction = await page.evaluate(() => ({ html: document.documentElement.getAttribute('dir'), body: document.body.style.direction }));
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.body.style.direction = 'rtl'; });
    await set({ rail: 'open' });
    await wait(() => bar((r) => r.host.dir), (dir) => dir === 'rtl', 'RTL navbar');
    ok(await bar((r) => document.getElementById('wrapper').getBoundingClientRect().right <= r.querySelector('.rail').getBoundingClientRect().left + 1), 'RTL course content clears the right rail');
    await openPanel('course');
    ok(await bar((r) => r.querySelector('.panel').getBoundingClientRect().right <= r.querySelector('.rail').getBoundingClientRect().left - 7), 'RTL panel opens beside the rail');
    await shot('live-course-rtl'); await closePanel();
    await page.evaluate((d) => { if (d.html === null) document.documentElement.removeAttribute('dir'); else document.documentElement.setAttribute('dir', d.html); document.body.style.direction = d.body; }, direction);
    await set({ place: 'top' });
    await wait(() => bar((r) => r.querySelectorAll('.twidgets .widget').length === 2 && !!r.querySelector('.twidgets [data-w="timer"] .w-time').textContent), Boolean, 'Canvas top widgets ready');
    ok(true, 'local Canvas renders the clock and timer in the top bar');
    ok(await bar((r) => !r.querySelector('.tsub').hidden && r.querySelectorAll('.tsub .item').length > 0), 'live course menu is top-bar second row');
    await overlap('live course top'); await shot('live-course-top');
    await page.setViewportSize({ width: 1100, height: 1000 });
    const sub = await bar((r) => { const b = r.querySelector('.tsub').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.move(sub.x, sub.y); await page.mouse.wheel(1600, 0);
    await wait(() => bar((r) => { const e = r.querySelector('.tsub'), last = e.querySelector('.item:last-child'); return getComputedStyle(e).overflowX === 'auto' && last.getBoundingClientRect().right <= e.getBoundingClientRect().right; }), Boolean, 'course menu scrolls to its last item');
    ok(true, 'all course links remain reachable in a narrow top bar'); await shot('live-course-top-narrow');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await set({ place: 'top', cmenu: false });
    ok(await page.locator('#left-side').evaluate((e) => getComputedStyle(e).display) !== 'none', 'course-menu off restores native course menu');
    layoutProbe(await page.locator('#sticky-container').evaluate((e) => parseFloat(getComputedStyle(e).top) >= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gz-navbar-top'))), 'native sticky course menu clears the top bar with tabs hosted in navigation');
    await set({ on: false });
    ok(await page.locator('#header').evaluate((e) => getComputedStyle(e).display) !== 'none' && !await page.locator('#gz-navbar').count(), 'live navbar off restores native global nav');
    ok(JSON.stringify(await nativeGeometry()) === JSON.stringify(nativeBefore), 'navbar off restores native header, wrapper, main, course menu and sticky styles exactly');
    await shot('live-off');
    await set({}, { enabled: false });
    ok(!await page.locator('#gz-navbar').count(), 'turning Glaze off removes its Canvas navbar');
    await set(); await ready();
    if (!await page.locator('#global_nav_history_link').count()) {
      const result = rails("puts 'GLAZE_PAGE_VIEWS=' + Setting.get('enable_page_views', 'false'); Setting.set('enable_page_views', 'db')");
      historySetting = /^GLAZE_PAGE_VIEWS=(.*)$/m.exec(result)?.[1] || 'false';
      reloadCanvas();
      console.log('local fixture: temporarily enabled database page views for History');
      await page.reload(); await ready();
    }
    // Existing local groups are reused; if the seed has none, make a temporary group for a real row navigation check.
    let groups = await api('/api/v1/users/self/groups');
    if (!groups.length) { const g = await api('/api/v1/groups', 'POST', { name: 'Glaze navigation check', is_public: 'false' }); groupId = String(g.id); groupOwned = true; groups = [g]; await page.reload(); await ready(); }
    ok(groups.length > 0, 'local test account has a real group');
    await page.goto(local + '/'); await ready();
    const helpLinks = await api('/help_links');
    if (!helpLinks.some((l) => ['#teacher_feedback', '#create_ticket'].includes(l.url))) {
      const result = rails("puts 'GLAZE_FEEDBACK=' + Setting.get('show_feedback_link', 'false'); Setting.set('show_feedback_link', 'true')");
      feedbackSetting = /^GLAZE_FEEDBACK=(.*)$/m.exec(result)?.[1] || 'false'; reloadCanvas();
      console.log('local fixture: temporarily enabled native Help forms (never submitted)');
      await page.reload(); await ready();
    }
    await openPanel('help');
    const support = await bar((r) => r.querySelector('.panel [data-run="help:teacher_feedback"]')?.dataset.run || r.querySelector('.panel [data-run="help:create_ticket"]')?.dataset.run);
    ok(!!support, 'Help retains Canvas built-in support forms');
    await bar((r, run) => r.querySelector(`.panel [data-run="${run}"]`).click(), support);
    await page.locator('#help_tray').waitFor({ state: 'visible' });
    await page.locator('#help_tray textarea, #help_tray input, #help_tray select').first().waitFor({ state: 'visible' });
    ok(await page.locator('#help_tray textarea, #help_tray input, #help_tray select').count() > 0, 'native Canvas support form remains visible and usable');
    // Wait for the tray's slide transition and verify a real control receives input above the rail.
    const usable = await page.locator('#help_tray textarea, #help_tray input, #help_tray select').first().click({ trial: true, timeout: 3000 }).then(() => true, () => false);
    layoutProbe(usable, 'Canvas native tray paints above Glaze navigation');
    await shot('live-native-help-form');
    await page.keyboard.press('Escape');
    await page.locator('#help_tray').waitFor({ state: 'hidden' });
    for (const id of ['profile', 'course', 'groups', 'help', 'history']) {
      await navigateRow(id);
      if (id === 'course') {
        const second = new URL(courses.rows[1].href).pathname;
        // The course row opened that course in its tab over the page; a load brings back the tab on screen, so start clean.
        await page.evaluate(() => sessionStorage.removeItem('gz-ctabs-shown'));
        await page.goto(local + second); await ready();
        await wait(() => bar((r) => [...r.querySelectorAll('.rail .ctab-go')].filter((e) => e.getAttribute('aria-current') !== 'page').length), (n) => n > 0, 'another saved course tab');
        await bar((r) => [...r.querySelectorAll('.rail .ctab-go')].find((e) => e.getAttribute('aria-current') !== 'page').click());
        await wait(() => page.evaluate(() => { const f = document.querySelector('#gz-ctabs-frames[data-on] > iframe:not([style*="visibility: hidden"]):not([style*="display: none"])'); return !!f?.contentDocument?.documentElement.hasAttribute('data-gz-navbar-frame') && !document.querySelector('#gz-ctabs-frames .gz-ctabs-pic'); }), Boolean, 'course frame navigation');
        // The frame fills the window under the bar (its background runs under the glass); its page keeps the rail's room.
        const inset = await page.locator('#gz-ctabs-frames[data-on] > iframe:not([style*="visibility: hidden"]):not([style*="display: none"])').evaluate((f) => Math.round(f.contentDocument.getElementById('wrapper').getBoundingClientRect().left));
        ok(inset >= 271, `course frame's page keeps the rail room (${inset}px)`);
        ok(await page.locator('#gz-ctabs-frames[data-on] > iframe:not([style*="visibility: hidden"]):not([style*="display: none"])').evaluate((f) => getComputedStyle(f.contentDocument.getElementById('header')).display === 'none'), 'course frame has no duplicate Canvas nav');
        const modulePath = await page.locator('#gz-ctabs-frames[data-on] > iframe:not([style*="visibility: hidden"]):not([style*="display: none"])').evaluate((f) => f.contentDocument.querySelector('#section-tabs a.modules')?.pathname);
        ok(!!modulePath, 'framed course has a Modules destination');
        await page.locator('#gz-navbar .cmenu a').filter({ hasText: /^Modules$/ }).click();
        await wait(() => page.locator('#gz-ctabs-frames[data-on] > iframe:not([style*="visibility: hidden"]):not([style*="display: none"])').evaluate((f) => f.contentDocument?.location.pathname), (p) => p === modulePath, 'course menu navigates inside the frame');
        await wait(() => bar((r) => r.querySelector('.cmenu [aria-current=page]')?.pathname), (p) => p === modulePath, 'course menu follows the frame after a full Canvas navigation');
        ok(true, 'framed course menu updates its active page after navigation');
        await shot('live-course-frame');
        await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250);
        ok(await bar((r) => document.getElementById('gz-ctabs-frames').getBoundingClientRect().bottom <= r.querySelector('.tabs').getBoundingClientRect().top), 'phone course frame clears the bottom bar and footer');
        await shot('live-phone-frame');
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      await page.goto(local + '/'); await ready();
    }
    await page.setViewportSize({ width: 390, height: 844 }); await ready();
    ok(await page.locator('#mobile-header').evaluate((e) => getComputedStyle(e).display) === 'none', 'live phone native hamburger is replaced');
    await page.locator('#gz-navbar .tabs .more').click();
    ok(await bar((r) => r.querySelector('.sheet').open), 'live phone More sheet opens'); await shot('live-phone-sheet');
    await page.keyboard.press('Escape');
    await openPanel('course', '.tabs');
    ok(await bar((r) => r.querySelector('.panel').hasAttribute('data-phone')), 'live phone Courses is a Glaze sheet');
    ok(await bar((r) => r.querySelector('.panel').getBoundingClientRect().bottom <= r.querySelector('.tabs').getBoundingClientRect().top - 7), 'phone panel clears the bottom bar with the footer on'); await shot('live-phone-panel');
    await closePanel();
    await set({ on: false }); ok(await page.locator('#mobile-header').evaluate((e) => getComputedStyle(e).display) !== 'none', 'live phone off restores native header'); await shot('live-phone-off');
    await page.setViewportSize({ width: 1440, height: 1000 }); await set();
    if (groupOwned) { await api(`/api/v1/groups/${groupId}`, 'DELETE'); groupOwned = false; }
    await login('ADMIN', credentials);
    await navigateRow('admin'); await shot('live-admin');
    await page.goto(local + '/'); await ready(); await openPanel('profile');
    await page.locator('#gz-navbar .panel [data-run=logout]').click();
    await page.waitForURL((u) => u.pathname.startsWith('/login'));
    ok(true, 'live sign out ends the Canvas session');
    await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(300);
    ok(!await page.locator('#gz-navbar').count() && !await page.locator('html[data-gz-navbar]').count(), 'signed-out Canvas has no cached navigation or reserved room'); await shot('live-signed-out');
    ok(!errors.length, `no page errors (${errors.join(' | ')})`);
    ok(!layoutFailures.length, `no layout regressions (${layoutFailures.join(' | ')})`);
  } catch (e) {
    console.error(`FAIL ${e.stack}`); process.exitCode = 1;
    if (opts && page.url().startsWith(local)) console.error('ISOLATED', JSON.stringify(await opts.evaluate(async () => { const t = (await chrome.tabs.query({})).find((t) => t.url?.startsWith('http://localhost:3000')); if (!t) return null; return chrome.scripting.executeScript({ target: { tabId: t.id }, func: async () => { const X = globalThis.GZ_CTX; return { site: X?.site, on: X?.on(), settings: X?.settings().navbar, adapter: typeof globalThis.GZ_NAVBAR_CANVAS, renderer: typeof globalThis.GZ_NAVBAR_UI, live: globalThis.GZ_NAVBAR_UI?.live(), load: X && await X.need('features/navbar-canvas.js', () => globalThis.GZ_NAVBAR_CANVAS).then(() => 'ok', (e) => String(e)) }; } }); }).catch((e) => String(e))));
    if (page && !page.isClosed()) { await shot('failure').catch(() => {}); console.error('PAGE', page.url()); console.error('NAV', JSON.stringify(await bar((r) => r && { words: document.documentElement.getAttribute('data-gz-navbar'), items: [...r.querySelectorAll('.rail [data-id]')].map((e) => e.dataset.id), panel: r.querySelector('.panel')?.textContent }).catch(() => null))); }
  } finally {
    if (feedbackSetting !== null) { try { rails(`Setting.set('show_feedback_link', ${JSON.stringify(feedbackSetting)})`); reloadCanvas(); feedbackSetting = null; } catch (e) { console.error('Could not restore local Help setting:', e.message); process.exitCode = 1; } }
    if (historySetting !== null) { try { rails(`Setting.set('enable_page_views', ${JSON.stringify(historySetting)})`); reloadCanvas(); historySetting = null; } catch (e) { console.error('Could not restore local page-view setting:', e.message); process.exitCode = 1; } }
    if (groupOwned) await api(`/api/v1/groups/${groupId}`, 'DELETE').catch((e) => { console.error('Could not remove local test group:', e.message); process.exitCode = 1; });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, errors, layoutFailures, screenshots: shots, apiResults }, null, 2) + '\n');
    try { await ctx?.close(); } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
    console.log(`${checks} checks; screenshots: ${out}`);
  }
})();
