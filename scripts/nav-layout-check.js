// A Look's nav layout (x.nav), headless, on all three sites: Ultra in the editor's preview page, Canvas and Moodle on their
// saved pages (test/fixtures) under invented school addresses. Every other request is aborted and DNS resolves nowhere.
// The layout reaches each page as a Look's parts do: Canvas and Moodle read it from storage (a Look saved the way the editor
// saves it, sync `lookX`, through the worker's glaze:look message), the Ultra preview is sent it with its settings
// (gzPreviewParts), since it ignores storage.
// It checks order, groups, hidden items, links, icons and a widget; the bar, the dock and the page's room for them;
// that the visual order is the focus order and aria-current stays; and that taking the Look off, or turning Glaze off,
// puts each native nav back exactly as it was. Canvas and Moodle also mount a declarative mod's rail widget, with and
// without a Look layout, then restore their native nav when the mod is disabled or removed.
//   NODE_PATH=/path/to/node_modules nice node scripts/nav-layout-check.js [screenshots directory]   (needs playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const G = require('../defaults.js');

const src = fs.realpathSync(process.env.EXT || path.join(__dirname, '..')); // the id is made from the real path
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-nav-layout-'));
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const CANVAS = 'https://nav.school.instructure.com', MOODLE = 'https://moodle.school.test';
const A = 'library0000a';
const LINK = { id: A, n: 'Library', u: 'https://library.example.edu/', i: 'book' };
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'test/fixtures', name), 'utf8');
const strip = (html, css) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '').replace('</head>', `<style>${css}</style></head>`);
// Stand-ins for each LMS's own frame CSS (not fetched): Canvas's fixed rail beside #wrapper, Moodle's fixed navbar.
const CANVAS_PAGE = strip(fixture('canvas-dashboard-cards.html'), `body { margin: 0; font: 14px/1.4 system-ui, sans-serif; }
  #header { position: fixed; inset: 0 auto 0 0; width: 84px; display: flex; flex-direction: column; }
  #header ul { list-style: none; margin: 0; padding: 0; } #header a { display: block; padding: 8px 4px; text-align: center; font-size: 11px; }
  #header .menu-item-icon-container svg, #header .ic-avatar img { width: 26px; height: 26px; } #skip_navigation_link { position: absolute; left: -9999px; }
  #wrapper { margin-left: 84px; } #content { padding: 24px; } .screenreader-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }`);
const MOODLE_PAGE = strip(fixture('moodle-dashboard.html'), `body { margin: 0; font: 14px/1.4 system-ui, sans-serif; }
  nav.navbar.fixed-top { position: fixed; inset: 0 0 auto 0; height: 60px; display: flex; align-items: center; z-index: 1030; }
  nav.navbar .container-fluid { display: flex; align-items: center; width: 100%; } .navbar-nav { display: flex; list-style: none; margin: 0; padding: 0; }
  .d-none, .visually-hidden { display: none !important; } .mds-nav-pill { display: inline-flex; padding: 8px 12px; } #page-wrapper { padding-top: 60px; }
  .drawer, [data-region="drawer"] { display: none; }`);

let checks = 0, fails = 0;
const ok = (value, label) => { console.log(`${value ? 'ok  ' : 'FAIL'} ${label}`); if (value) checks++; else fails++; };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-nav-layout-run-')));
  const ext = src;
  let ctx;
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND'] });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (route.request().method() !== 'GET') return route.abort();
      if (u.origin === CANVAS && u.pathname.startsWith('/api/v1/')) return route.fulfill({ contentType: 'application/json', body: u.pathname.endsWith('/self') || u.pathname.endsWith('/profile') ? '{"id":"3"}' : '[]' });
      if (u.origin === CANVAS && u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: CANVAS_PAGE });
      if (u.origin === MOODLE && u.pathname === '/my/') return route.fulfill({ contentType: 'text/html', body: MOODLE_PAGE });
      return route.abort();
    });
    const id = extensionId(ext);
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${id}/options.html`);
    const settings = G.GZ_SANITIZE({ preset: 'Paper', colors: G.GZ_PRESET('Paper'), motion: { level: 'off' } });
    // Settings only: the Look's parts are saved by wear(), and a write here must not take them away.
    const store = (s) => opts.evaluate(async (s) => { await chrome.storage.sync.set(s); }, s);
    await store(settings);
    const errors = [];

    // The Look's layout reaches a page as the editor gives it: the preview frame is sent the parts with its settings (each
    // message carries them, or the preview lets them go), Canvas and Moodle read what the worker saved. Helpers that run in a page follow.
    let shownNav = null;
    const send = (page, s = settings) => page.evaluate(({ s, parts }) => window.postMessage({ gzPreview: s, gzPreviewParts: parts }, location.origin), { s, parts: shownNav && { x: { nav: shownNav } } });
    const wear = async (page, nav) => {
      if (page.url().startsWith('chrome-extension:')) { shownNav = nav; return send(page); }
      const r = await opts.evaluate((parts) => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:look', parts, patch: { version: 2 } }, res)), nav && { x: { nav } });
      if (!r?.ok) throw new Error(`the Look was not saved: ${JSON.stringify(r)}`);
    };
    const until = async (page, read, check, label) => { const end = Date.now() + 8000; let v; while (Date.now() < end) { v = await page.evaluate(read); if (check(v)) { ok(true, label); return v; } await page.waitForTimeout(50); } ok(false, `${label} (last: ${JSON.stringify(v)})`); return v; };
    const order = (list) => `[...document.querySelector(${JSON.stringify(list)}).children].filter((e) => e.dataset.gzNavId && e.getClientRects().length).map((e) => e.dataset.gzNavId)`;
    const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
    // The visual order of a bar is the DOM order, so the focus order follows what is seen.
    const leftToRight = (list) => `(() => { const xs = [...document.querySelectorAll(${JSON.stringify(list)} + ' a[href], ' + ${JSON.stringify(list)} + ' button')].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().left); return xs.length > 2 && xs.every((x, i) => !i || x >= xs[i - 1]); })()`;
    const M = require(path.join(ext, 'lib/modbundle.js'));
    const mod = await M.pack({}, { glaze: 1, name: 'Nav rail check', version: '1.0.0', author: { name: 'Glaze check' },
      ui: { rail: [{ id: 'check', name: 'Rail check', blocks: [{ type: 'text', text: 'Rail widget check' }] }] } }, await M.makeKey());
    const record = { id: mod.id, manifest: mod.manifest, files: Object.fromEntries(Object.entries(mod.files).map(([k, v]) => [k, M.std(v)])),
      hash: mod.hash, key: mod.key, version: mod.version, grants: {}, source: 'file', installedAt: Date.now(), enabled: true, dev: false };
    const railChecks = async (page, list, pristine, site) => {
      const seed = (enabled) => opts.evaluate(async ({ record, enabled }) => chrome.storage.local.set({ mods: [record.id],
        [`mod:${record.id}`]: { ...record, enabled }, [`modTrust:${record.id}`]: { key: record.key, version: record.version, hash: record.hash } }), { record, enabled });
      const visible = `(() => { const el = document.querySelector('.gz-mod-rail[aria-label="Rail check"]'); if (!el) return false; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && s.display !== 'none' && s.visibility !== 'hidden'; })()`;
      await wear(page, null);
      await until(page, `document.querySelector(${JSON.stringify(list)}).outerHTML`, (v) => v === pristine, `${site}: the mod rail check starts without a Look layout`);
      await seed(true);
      await until(page, visible, Boolean, `${site}: the mod rail widget has visible dimensions without a Look layout`);
      await wear(page, { place: 'left', groups: [{ label: 'Rail checks', items: ['course'] }] });
      await until(page, `!!document.querySelector(${JSON.stringify(list)} + ' [data-gz-nav-id="g:0"]') && ${visible}`, Boolean, `${site}: the mod rail widget stays visible with a Look layout`);
      await seed(false);
      await until(page, `!document.querySelector('.gz-mod-rail')`, Boolean, `${site}: disabling the mod removes its rail widget`);
      await wear(page, null);
      await until(page, `document.querySelector(${JSON.stringify(list)}).outerHTML`, (v) => v === pristine, `${site}: after disabling the mod and removing the Look, the native nav is restored`);
      await seed(true);
      await until(page, visible, Boolean, `${site}: re-enabling the mod restores its rail widget`);
      await opts.evaluate(async (id) => { await chrome.storage.local.set({ mods: [] }); await chrome.storage.local.remove([`mod:${id}`, `modTrust:${id}`]); }, mod.id);
      await until(page, `!document.querySelector('.gz-mod-rail')`, Boolean, `${site}: removing the mod removes its rail widget`);
      await until(page, `document.querySelector(${JSON.stringify(list)}).outerHTML`, (v) => v === pristine, `${site}: removing the mod restores the native nav exactly`);
    };

    // ---- Ultra, in the editor's preview page -------------------------------------------------------------------------
    {
      const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(`ultra: ${e}`));
      await page.goto(`chrome-extension://${id}/preview.html?site=ultra`);
      await send(page);
      const LIST = 'nav[data-gz-nav-root] > ul';
      await until(page, `document.querySelector('${LIST} a[href="#glaze"]') && document.querySelectorAll('${LIST} [data-gz-nav-id]').length`, (n) => n >= 10, 'Ultra: the rail captured the preview nav');
      // The student's own items (navItems): hide Tools. A worn layout stands in for them.
      await page.evaluate(() => window.postMessage({ gzNavPreview: { hidden: ['tools'] } }, location.origin));
      await until(page, `document.querySelector('${LIST} [data-gz-nav-id="tools"]').hidden`, Boolean, 'Ultra: the student\'s own hidden item applies');
      const baseline = await page.evaluate(`document.querySelector('${LIST}').outerHTML`);
      const nav = { place: 'top', groups: [{ label: 'Learn', items: ['course', 'grades', 'w:timer'] }], hidden: ['stream', 'organization'], links: [LINK], icons: { grades: 'star' } };
      await wear(page, nav);
      const want = ['g:0', 'course', 'grades', 'w:timer', 'profile', 'institution-page', 'calendar', 'messages', 'tools', 'logout', 'glaze', A];
      await until(page, order(LIST), (v) => JSON.stringify(v) === JSON.stringify(want), 'Ultra: groups, then the rest in the page\'s order, then links');
      ok(await page.evaluate(`!document.querySelector('${LIST} [data-gz-nav-id="tools"]').hidden`), 'Ultra: a worn layout overrides the student\'s own hidden items');
      ok(await page.evaluate(`['stream', 'organization'].every((id) => document.querySelector('${LIST} [data-gz-nav-id="' + id + '"]').hidden)`), 'Ultra: the layout\'s hidden items are hidden');
      ok(await page.evaluate(`(() => { const h = document.querySelector('${LIST} [data-gz-nav-id="g:0"] .gz-nav-group'); return h.textContent === 'Learn' && h.getAttribute('role') === 'heading'; })()`), 'Ultra: the group label is a heading');
      await until(page, `(() => { const a = document.querySelector('${LIST} a[href$="/ultra/grades"]'); const s = a?.querySelector('svg.gz-nav-icon'); return !!s && getComputedStyle(s).display !== 'none' && [...a.querySelectorAll('svg:not(.gz-nav-icon)')].every((x) => getComputedStyle(x).display === 'none'); })()`, Boolean, 'Ultra: the layout\'s icon stands in for the native one');
      ok(await page.evaluate(`(() => { const a = document.querySelector('${LIST} a.gz-nav-link'); return a.href === '${LINK.u}' && a.target === '_self' && a.textContent === 'Library'; })()`), 'Ultra: the layout\'s link');
      await until(page, `document.querySelector('${LIST} [data-gz-nav-id="w:timer"] .gz-nav-widget')?.textContent`, (t) => /\d+:\d\d/.test(t || ''), 'Ultra: the timer widget is drawn in its group');
      const bar = await until(page, `(() => { const r = document.querySelector('.MuiDrawer-paper').getBoundingClientRect(); return { top: r.top, h: r.height, w: r.width, pad: getComputedStyle(document.getElementById('site-wrap')).paddingTop, place: document.documentElement.getAttribute('data-gz-nav-place') }; })()`, (v) => v.place === 'top' && v.top === 0 && v.w >= 1270 && v.h <= 60, 'Ultra: a bar along the top');
      ok(bar.pad === '56px', 'Ultra: the page makes room under the bar');
      ok(await page.evaluate(leftToRight(LIST)), 'Ultra: the bar reads left to right in DOM (focus) order');
      ok(await page.evaluate(`document.querySelector('${LIST} a[href="/ultra/course"]').classList.contains('Mui-selected')`), 'Ultra: the current page keeps its mark');
      await shot(page, 'ultra-top');
      await wear(page, { ...nav, place: 'dock' });
      await until(page, `(() => { const r = document.querySelector('.MuiDrawer-paper').getBoundingClientRect(); return Math.round(innerHeight - r.bottom) === 12 && Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2; })()`, Boolean, 'Ultra: a dock floats at the bottom, centred');
      await shot(page, 'ultra-dock');
      await send(page, { ...settings, nav: { ...settings.nav, collapsed: true } });
      await page.waitForTimeout(500);
      await page.setViewportSize({ width: 800, height: 860 });
      await until(page, `!!document.querySelector('.gz-nav-expand')`, Boolean, 'Ultra: below 900px the native rail can expand with a placed Look');
      await page.setViewportSize({ width: 1280, height: 860 });
      await send(page);
      await page.waitForTimeout(500);
      await wear(page, null);
      await until(page, `document.querySelector('${LIST}').outerHTML`, (v) => v === baseline, 'Ultra: taking the Look off puts the student\'s own nav back exactly');
      ok(await page.evaluate(`!document.documentElement.hasAttribute('data-gz-nav-place') && !document.querySelector('[data-gz-nav-shell], .gz-nav-group, link[href$="features/navlayout.css"]')`), 'Ultra: no placement, label or sheet is left behind');
      const native = await page.evaluate(() => {
        const nav = document.querySelector('nav[data-gz-nav-root]').cloneNode(true);
        nav.querySelector('a[href="#glaze"]').closest('li').remove();
        for (const el of nav.querySelectorAll('[data-gz-nav-id]')) { el.removeAttribute('data-gz-nav-id'); el.removeAttribute('hidden'); }
        return nav.outerHTML;
      });
      await wear(page, { ...nav, hidden: ['profile', 'institution-page', 'stream', 'course', 'organization', 'calendar', 'messages', 'grades', 'tools', 'logout'] });
      await until(page, `document.querySelector('${LIST} [data-gz-nav-id="logout"]').hidden`, Boolean, 'Ultra: logout hidden before replacing settings');
      await page.evaluate(() => document.querySelector('a[href="#glaze"]').closest('li').remove());
      await send(page);
      await until(page, `!!document.querySelector('a[href="#glaze"]') && !document.querySelector('a[href="#glaze"]').closest('li').hidden`, Boolean, 'Ultra: recreated settings stays visible when the last native item is hidden');
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const old = document.querySelector('a[href="/ultra/stream"]').closest('li'), next = old.cloneNode(true);
        next.removeAttribute('hidden'); next.removeAttribute('data-gz-nav-id'); old.replaceWith(next);
      });
      await until(page, `document.querySelector('a[href="/ultra/stream"]').closest('li').hidden`, Boolean, 'Ultra: a SPA item replacement keeps the layout\'s hidden state');
      await page.evaluate((native) => { document.querySelector('nav[data-gz-nav-root]').outerHTML = native; }, native);
      await until(page, `!!document.querySelector('${LIST} .gz-nav-link') && document.querySelector('${LIST} [data-gz-nav-id="stream"]')?.hidden`, Boolean, 'Ultra: a SPA replacement receives the worn layout');
      await page.close();
    }

    // ---- Canvas ------------------------------------------------------------------------------------------------------
    {
      const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(`canvas: ${e}`));
      await page.goto(CANVAS + '/');
      const LIST = '#header .ic-app-header__main-navigation > ul';
      await until(page, `document.documentElement.hasAttribute('data-gz-dark-theme') || document.documentElement.style.getPropertyValue('--gz-ink') !== ''`, Boolean, 'Canvas: Glaze is on');
      let pristine = await page.evaluate(async (l) => new DOMParser().parseFromString(await (await fetch('/')).text(), 'text/html').querySelector(l).outerHTML, LIST);
      ok(await page.evaluate(`document.querySelector('${LIST}').outerHTML`) === pristine, 'Canvas: without a layout the nav is untouched');
      pristine = await page.evaluate((l) => { document.getElementById('global_nav_help_link').closest('li').setAttribute('hidden', 'hidden'); return document.querySelector(l).outerHTML; }, LIST);
      await railChecks(page, LIST, pristine, 'Canvas');
      const nav = { place: 'top', groups: [{ label: 'Study', items: ['course', 'calendar', 'w:clock'] }, { label: 'Me', items: ['messages', `link:${A}`, 'profile'] }], hidden: ['help'], links: [LINK], icons: { calendar: 'star' } };
      await wear(page, nav);
      const want = ['g:0', 'course', 'calendar', 'w:clock', 'g:1', 'messages', A, 'profile', 'dashboard'];
      await until(page, order(LIST), (v) => JSON.stringify(v) === JSON.stringify(want), 'Canvas: the layout\'s order and groups');
      ok(await page.evaluate(`document.getElementById('global_nav_help_link').closest('li').hidden`), 'Canvas: a hidden item');
      ok(await page.evaluate(`document.getElementById('global_nav_dashboard_link').closest('li').getAttribute('aria-current') === 'page'`), 'Canvas: aria-current stays on the current item');
      await until(page, `document.querySelector('${LIST} [data-gz-nav-id="w:clock"] .gz-nav-widget')?.getAttribute('aria-label')`, (t) => /Clock and date · \d/.test(t || ''), 'Canvas: the clock widget, labelled');
      await until(page, `!!document.querySelector('#global_nav_calendar_link svg.gz-nav-icon path[d^="M"]')`, Boolean, 'Canvas: the layout\'s icon');
      const bar = await until(page, `(() => { const r = document.getElementById('header').getBoundingClientRect(), w = getComputedStyle(document.getElementById('wrapper')); return { top: r.top, h: r.height, w: r.width, ml: w.marginLeft, pt: w.paddingTop }; })()`, (v) => v.top === 0 && v.w >= 1270 && v.h === 56, 'Canvas: a bar along the top');
      ok(bar.ml === '0px' && bar.pt === '56px', 'Canvas: the page takes the rail\'s width and makes room under the bar');
      ok(await page.evaluate(leftToRight(LIST)), 'Canvas: the bar reads left to right in DOM (focus) order');
      await page.focus('#global_nav_courses_link'); await page.keyboard.press('Tab');
      ok(await page.evaluate(() => document.activeElement.id) === 'global_nav_calendar_link', 'Canvas: Tab goes to the next item in the layout');
      await shot(page, 'canvas-top');
      await wear(page, { ...nav, place: 'bottom' });
      await until(page, `Math.round(innerHeight - document.getElementById('header').getBoundingClientRect().bottom)`, (v) => v === 0, 'Canvas: a bar along the bottom');
      await shot(page, 'canvas-bottom');
      await wear(page, null);
      await until(page, `document.querySelector('${LIST}').outerHTML`, (v) => v === pristine, 'Canvas: taking the Look off restores the nav exactly');
      ok(await page.evaluate(`!document.documentElement.hasAttribute('data-gz-nav-place')`), 'Canvas: no placement left behind');
      // Turning Glaze off with a layout worn.
      await wear(page, nav);
      await until(page, order(LIST), (v) => JSON.stringify(v) === JSON.stringify(want), 'Canvas: worn again');
      await store({ ...settings, enabled: false });
      await until(page, `document.querySelector('${LIST}').outerHTML`, (v) => v === pristine, 'Canvas: turning Glaze off restores the nav exactly');
      await store(settings);
      await page.close();
    }

    // ---- Moodle (5.3, Boost) -------------------------------------------------------------------------------------
    {
      const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(`moodle: ${e}`));
      await page.goto(MOODLE + '/my/');
      const LIST = '.primary-navigation ul.more-nav';
      await until(page, `document.documentElement.style.getPropertyValue('--gz-ink') !== ''`, Boolean, 'Moodle: Glaze is on (the detector registered the host)');
      const pristine = await page.evaluate(async (l) => new DOMParser().parseFromString(await (await fetch('/my/')).text(), 'text/html').querySelector(l).outerHTML, LIST);
      await railChecks(page, LIST, pristine, 'Moodle');
      const nav = { place: 'bottom', groups: [{ label: 'Learn', items: ['course', 'w:next'] }], hidden: ['dashboard'], links: [LINK] };
      await wear(page, nav);
      await until(page, order(LIST), (v) => JSON.stringify(v) === JSON.stringify(['g:0', 'course', 'w:next', A]), 'Moodle: the layout\'s order and groups');
      ok(await page.evaluate(`!!document.querySelector('${LIST} [data-gz-nav-id="course"] a[tabindex="0"]')`), 'Moodle: hiding the current item leaves a native keyboard entry point');
      await page.focus(`${LIST} [data-gz-nav-id="course"] a`);
      await page.keyboard.press('ArrowRight');
      ok(await page.evaluate(`document.activeElement.matches('${LIST} a.gz-nav-link')`), 'Moodle: ArrowRight follows the layout to its custom link');
      await page.keyboard.press('Home');
      ok(await page.evaluate(`document.activeElement.matches('${LIST} [data-gz-nav-id="course"] a')`), 'Moodle: Home returns to the first visible item');
      ok(await page.evaluate(`(() => { const a = document.querySelector('${LIST} [data-gz-nav-id="course"] a'); return (a.getAttribute('aria-describedby') || '').split(' ').some((id) => document.getElementById(id)?.textContent === 'Learn'); })()`), 'Moodle: the first item exposes its group label to screen readers');
      ok(await page.evaluate(`document.querySelector('${LIST}').lastElementChild.classList.contains('dropdownmoremenu')`), 'Moodle: its More menu stays last');
      ok(await page.evaluate(`(() => { const a = document.querySelector('${LIST} a.gz-nav-link'); return a.getAttribute('role') === 'menuitem' && a.parentElement.getAttribute('role') === 'none' && a.classList.contains('mds-nav-pill'); })()`), 'Moodle: the link is a menu item in the menubar');
      ok(await page.evaluate(`document.querySelector('${LIST} .gz-nav-group').getAttribute('aria-hidden') === 'true'`), 'Moodle: the label is not read inside the menubar');
      await until(page, `document.querySelector('${LIST} [data-gz-nav-id="w:next"] .gz-nav-widget')?.getAttribute('aria-label')`, (t) => !!t && t !== 'Next due', 'Moodle: Next due draws (no work in the fixture: an empty or failed state)');
      await until(page, `(() => { const r = document.querySelector('.primary-navigation').getBoundingClientRect(); return Math.round(innerHeight - r.bottom) === 0 && r.width >= 1270; })()`, Boolean, 'Moodle: a bar along the bottom');
      await shot(page, 'moodle-bottom');
      await wear(page, null);
      await until(page, `document.querySelector('${LIST}').outerHTML`, (v) => v === pristine, 'Moodle: taking the Look off restores the nav exactly');
      await wear(page, { ...nav, place: 'dock' });
      await until(page, order(LIST), (v) => v.length === 4, 'Moodle: worn again, as a dock');
      await shot(page, 'moodle-dock');
      await store({ ...settings, enabled: false });
      await until(page, `document.querySelector('${LIST}').outerHTML`, (v) => v === pristine, 'Moodle: turning Glaze off restores the nav exactly');
      await page.close();
    }
    ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await ctx?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${checks} checks passed, ${fails} failed; screenshots in ${out}`);
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
