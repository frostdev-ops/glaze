// Glaze's own navigation bar (features/navbar.js), headless, in the editor's Ultra preview (preview.html runs Ultra's real
// content scripts on a mock page). Settings reach it as the editor sends them (gzPreview); nothing is saved.
// It checks that the bar stands in for Ultra's drawer (hidden, keeping the page's room), its items, order, current item
// and badges; that an item opens through Ultra's own link; the rail's icons state, tooltips, hover peek, keyboard and
// Escape; right-to-left; the phone bar and its More sheet; and that turning it off puts Ultra's drawer back.
//   NODE_PATH=/path/to/node_modules nice node scripts/navbar-check.js [screenshots directory]   (needs playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const G = require('../defaults.js');

const src = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-navbar-'));
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

let checks = 0, fails = 0;
const ok = (value, label) => { console.log(`${value ? 'ok  ' : 'FAIL'} ${label}`); if (value) checks++; else fails++; };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-navbar-run-')));
  let ctx;
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), { executablePath: CHROME, headless: true, viewport: { width: 1440, height: 900 }, locale: 'en-US',
      args: [`--disable-extensions-except=${src}`, `--load-extension=${src}`, '--host-resolver-rules=MAP * ~NOTFOUND'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`chrome-extension://${extensionId(src)}/preview.html?site=ultra`);
    await page.waitForFunction(() => globalThis.GZ_CTX);
    const send = (navbar, extra = {}) => page.evaluate((s) => window.postMessage({ gzPreview: s }, location.origin), G.GZ_SANITIZE({ navbar, enhance: { dashboard: true }, motion: { level: 'subtle' }, ...extra }));
    const bar = (fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gz-navbar')?.shadowRoot, a), [String(fn), arg]);
    const until = async (read, check, label, arg) => { const end = Date.now() + 5000; let v; while (Date.now() < end) { v = await bar(read, arg); if (check(v)) { ok(true, label); return v; } await page.waitForTimeout(50); } ok(false, `${label} (last: ${JSON.stringify(v)})`); return v; };
    const space = (v = '--gz-navbar-left') => page.evaluate((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), v);
    const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });

    // ---- off: Ultra's own drawer ----
    // ---- on by default, wide window: the open rail ----
    await send({ on: true });
    await until((r) => r && !r.host.hidden && [...r.querySelectorAll('.list .group:not(.courses) .item')].map((a) => a.dataset.id).join(' '), (v) => v === 'institution-page stream course organization calendar messages grades tools', 'the rail lists Ultra\'s items in the default groups');
    ok(await space() === '272px', 'the page keeps the open rail\'s room');
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('site-wrap')).gridTemplateColumns.startsWith('272px')), 'the page starts beside the rail');
    ok(await page.evaluate(() => document.documentElement.getAttribute('data-gz-navbar')) === 'rail auto float tabs', 'the page is told where the bar is');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.MuiDrawer-paper nav')).visibility) === 'hidden', "Ultra's own nav is out of sight, still in the page");
    ok(await bar((r) => r.querySelector('.item[aria-current="page"]')?.dataset.id) === 'course', 'the current page is marked');
    ok(await bar((r) => r.querySelector('.rail').hasAttribute('data-open') && getComputedStyle(r.querySelector('.label')).opacity === '1'), 'labels show while open');
    ok(await bar((r) => r.querySelector('.account b')?.textContent) === 'Alexandria Montgomery-Wellington', "the account is the student's name, at the foot");
    ok(await bar((r) => r.querySelector('.brand small')?.textContent) === 'School', "the brand names the school");
    ok(await bar((r) => !r.querySelector('[data-id="glaze"]') && !r.querySelector('[data-id^="glaze:"]')), "Glaze's own items are opt-in");
    await shot('open');

    // An item opens through Ultra's own link (its router), not a page load.
    await page.evaluate(() => { window.__clicked = ''; document.querySelector('.MuiDrawer-paper a[href="/ultra/calendar"]').addEventListener('click', (e) => { window.__clicked = 'calendar'; e.preventDefault(); }); });
    await bar((r) => r.querySelector('[data-id="calendar"]').click());
    ok(await page.evaluate(() => window.__clicked) === 'calendar', "an item clicks Ultra's own link");

    // A badge on Ultra's item shows on the bar's.
    await page.evaluate(() => { const a = document.querySelector('.MuiDrawer-paper a[href="/ultra/messages"]'); a.append(Object.assign(document.createElement('span'), { className: 'MuiBadge-badge', textContent: '3' })); });
    await until((r) => r.querySelector('[data-id="messages"] .badge')?.textContent, (v) => v === '3', "Ultra's unread count shows on the bar");
    ok(await bar((r) => r.querySelector('[data-id="messages"] .label').textContent) === 'Messages', "the count isn't part of the name");
    await bar((r) => r.querySelector('.list [data-id="institution-page"]').focus());
    await page.evaluate(() => { document.querySelector('.MuiBadge-badge').textContent = '7'; });
    await until((r) => r.querySelector('[data-id="messages"] .badge')?.textContent, (v) => v === '7', 'a badge redraw lands while the home item has focus');
    ok(await bar((r) => r.activeElement?.matches('.list [data-id="institution-page"]')), 'focus stays on the home item rather than its brand link');
    await bar((r) => r.activeElement?.blur());

    // ---- icons: the collapsed rail, tooltips, the peek ----
    await bar((r) => r.querySelector('.toggle').click());
    await until((r) => r.querySelector('.rail').hasAttribute('data-open'), (v) => v === false, 'the chevron collapses the rail to icons');
    ok(await space() === '96px', 'the page gets the room back');
    await page.waitForTimeout(500);
    await shot('icons');
    const grades = await bar((r) => { const b = r.querySelector('[data-id="grades"]').getBoundingClientRect(); return { x: b.x + 20, y: b.y + b.height / 2 }; });
    await page.mouse.move(grades.x, grades.y);
    await until((r) => r.querySelector('.tip').hasAttribute('data-on') && r.querySelector('.tip').textContent, (v) => v === 'Grades', 'a tooltip names an icon');
    await until((r) => r.querySelector('.rail').hasAttribute('data-peek'), (v) => v === true, 'pointing at the rail peeks it open');
    ok(await space() === '96px', 'a peek floats over the page');
    await shot('peek');
    await page.mouse.move(900, 400);
    await until((r) => r.querySelector('.rail').hasAttribute('data-open'), (v) => v === false, 'leaving it closes the peek');

    // ---- keyboard ----
    await bar((r) => r.querySelector('[data-id="course"]').focus());
    await until((r) => r.querySelector('.rail').hasAttribute('data-open'), (v) => v === true, 'focus opens the rail');
    await page.keyboard.press('ArrowDown');
    ok(await bar((r) => r.activeElement?.dataset.id) === 'organization', 'Down moves to the next item');
    await page.keyboard.press('Escape');
    ok(await bar((r) => !r.querySelector('.rail').hasAttribute('data-open') && r.activeElement?.classList.contains('toggle')), 'Escape closes the peek and keeps focus on the bar');

    // Pinning (the editor's preview doesn't save it).
    await bar((r) => r.querySelector('.toggle').click());
    await until((r) => r.querySelector('.pin').getAttribute('aria-pressed'), (v) => v === 'true', 'expanding pins it open');

    // ---- right to left ----
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    await send({ on: true, rail: 'open' });
    await until((r) => Math.round(r.querySelector('.rail').getBoundingClientRect().right), (v) => v === 1440 - 12, 'right to left, the rail sits on the right');
    await until((r) => getComputedStyle(r.querySelector('.rail')).clipPath, (v) => v === 'inset(0px round 20px)', 'and opens whole');
    await shot('rtl');
    await page.evaluate(() => { document.documentElement.dir = ''; });
    await send({ on: true });

    // ---- a phone: the bottom bar and More ----
    await page.setViewportSize({ width: 390, height: 844 });
    await until((r) => [getComputedStyle(r.querySelector('.rail')).display, getComputedStyle(r.querySelector('.tabs')).display], (v) => v[0] === 'none' && v[1] === 'flex', 'a phone gets the bottom bar instead of the rail');
    ok((await bar((r) => [...r.querySelectorAll('.tab')].map((t) => t.dataset.id || 'more'))).join(' ') === 'institution-page course calendar messages more', 'its tabs: home, courses, calendar, inbox and More');
    ok(await bar((r) => r.querySelector('.tab[data-active]')?.dataset.id) === 'course', 'the current tab is marked');
    await shot('phone');
    await bar((r) => r.querySelector('.more').click());
    await until((r) => r.querySelector('.sheet').hasAttribute('data-open') && r.activeElement?.closest('.sheet') !== null, (v) => v === true, 'More opens the sheet and moves focus into it');
    ok((await bar((r) => [...r.querySelectorAll('.sheet .row:not(.ctab-go)')].map((e) => e.dataset.id || e.dataset.act))).join(' ') === 'stream organization grades tools profile logout customize', 'the sheet has the rest, the account, signing out and Customize');
    ok((await bar((r) => r.querySelectorAll('.sheet .ctab-go').length)) === 3, 'and the course tabs');
    await page.waitForTimeout(500);
    await shot('phone-more');
    await page.keyboard.press('Escape');
    ok(await bar((r) => !r.querySelector('.sheet').hasAttribute('data-open') && r.activeElement?.classList.contains('more')), 'Escape closes it and focus goes back to More');

    await bar((r) => r.querySelector('.more').click());
    await bar((r) => r.querySelector('.customize').focus());
    await page.keyboard.press('Tab');
    ok(await bar((r) => r.activeElement === r.querySelector('.sheet .row')), 'Tab wraps within the More dialog');
    await page.keyboard.press('Shift+Tab');
    ok(await bar((r) => r.activeElement === r.querySelector('.customize')), 'Shift+Tab wraps within the More dialog');
    await bar((r) => r.querySelector('.sheet [data-id="grades"]').focus());
    await page.evaluate(() => { document.querySelector('.MuiBadge-badge').textContent = '4'; });
    await until((r) => r.querySelector('.sheet [data-id="messages"] .badge')?.textContent || r.querySelector('.tab[data-id="messages"] .badge')?.textContent, (v) => v === '4', 'a badge redraw lands while More is open');
    ok(await bar((r) => r.activeElement?.dataset.id === 'grades' && !!r.activeElement?.closest('.sheet')), 'a redraw preserves focus in the visible sheet');
    await page.evaluate(() => { const main = document.querySelector('main'); main.tabIndex = -1; main.focus(); });
    ok(await bar((r) => !!r.activeElement?.closest('.sheet')), 'the modal sheet keeps page content inert');
    await page.keyboard.press('Escape');

    await bar((r) => r.querySelector('.more').click());
    await page.mouse.click(3, 3);
    ok(await bar((r) => !r.querySelector('.sheet').open && r.activeElement === r.querySelector('.more')), 'a backdrop click closes More and restores focus');

    // The adapter must follow a new drawer, including account/sign-out links outside its nav.
    await page.evaluate(() => {
      const drawer = document.querySelector('.MuiDrawer-paper'), next = drawer.cloneNode(true);
      const footer = document.createElement('footer'); footer.append(next.querySelector('a[href="#"]')); next.append(footer); drawer.replaceWith(next);
      next.querySelector('.MuiBadge-badge').textContent = '5';
    });
    await until((r) => r.querySelector('.tab[data-id="messages"] .badge')?.textContent, (v) => v === '5', 'a replacement drawer updates the bar');
    ok(await bar((r) => !!r.querySelector('.sheet [data-id="logout"]')), 'sign out remains available in the drawer footer');

    await page.evaluate(() => {
      window.__selected = 0;
      GZ_NAVBAR_UI.add('review', { id: 'action', label: 'Review action', select: () => window.__selected++ });
    });
    await until(() => GZ_NAVBAR_UI.model()?.items.some((i) => i.id === 'mod:review.action'), Boolean, 'a mod action enters the model');
    await page.evaluate(() => { GZ_NAVBAR_UI.go('mod:review.action'); });
    ok(await page.evaluate(() => window.__selected) === 1, 'go invokes a mod action');
    await page.evaluate(() => { GZ_NAVBAR_UI.update('review', 'action', { badge: 2 }); });
    await until(() => GZ_NAVBAR_UI.model()?.items.find((i) => i.id === 'mod:review.action')?.badge, (v) => v === '2', 'a mod action update lands');
    ok(await bar((r) => r.querySelector('.sheet [data-id="mod:review.action"]')?.tagName) === 'BUTTON', 'updating an action keeps it a button');
    await page.evaluate(() => { GZ_NAVBAR_UI.clear('review'); });
    await page.setViewportSize({ width: 1440, height: 900 });

    await send({ on: true, rail: 'icons', peek: false });
    await until((r) => r.querySelector('.rail').hasAttribute('data-open'), (v) => v === false, 'settings select the icons rail');
    await bar((r) => r.querySelector('.toggle').click());
    await send({ on: true, rail: 'auto', peek: false });
    await send({ on: true, rail: 'icons', peek: false });
    await until((r) => r.querySelector('.rail').hasAttribute('data-open'), (v) => v === false, 'settings supersede a local pin choice');
    await send({ on: false });
    await page.waitForTimeout(100);
    await send({ on: true, rail: 'icons', peek: false });
    await until((r) => r && !r.host.hidden && !r.querySelector('.rail').hasAttribute('data-open'), Boolean, 'the collapsed rail is ready for keyboard focus');
    await bar((r) => r.querySelector('.pin').focus());
    ok(await bar((r) => r.querySelector('.rail').hasAttribute('data-open')), 'keyboard focus reveals the collapsed pin control');
    await send({ on: true, brand: 'none' });
    await until((r) => getComputedStyle(r.querySelector('.brand')).display, (v) => v === 'none', 'No logo hides the brand');
    await page.evaluate(() => { document.querySelector('.MuiDrawer-paper footer a[href="#"]').remove(); });
    await until((r) => getComputedStyle(r.querySelector('.out')).display, (v) => v === 'none', 'a removed sign-out link hides its control');

    // ---- course tabs: in the rail instead of their strip ----
    await send({ on: true, rail: 'open', brand: 'glaze' });
    await until((r) => [...r.querySelectorAll('.courses .ctab-go')].map((e) => e.dataset.cid).join(' '), (v) => v === '_3_1 _1_1 _2_1', 'the course tabs sit in the rail, pinned first');
    ok(await page.evaluate(() => { const s = document.getElementById('gz-ctabs'); return !s || getComputedStyle(s).display === 'none'; }), 'their strip steps aside');
    ok(await bar((r) => r.querySelector('.courses .ctab-go[aria-current="page"]')?.dataset.cid) === '_1_1', 'the open course is marked');
    ok(await bar((r) => !!r.querySelector('.courses [data-cid="_3_1"] .pinned')), 'a pinned tab shows its pin');
    await bar((r) => r.querySelector('.courses .ctab-go[data-cid="_2_1"]').click());
    await until((r) => r.querySelector('.courses .ctab-go[aria-current="page"]')?.dataset.cid, (v) => v === '_2_1', 'a tab opens its course');
    await shot('course-tabs');
    await send({ on: true, rail: 'open', tabs: false });
    await until((r) => r.querySelectorAll('.courses').length, (v) => v === 0, 'turned off, the tabs leave the bar');
    ok(await page.evaluate(() => !!document.getElementById('gz-ctabs')?.isConnected), 'and their strip comes back');

    // ---- the top bar ----
    await send({ on: true, place: 'top' });
    await until((r) => getComputedStyle(r.querySelector('.topbar')).display, (v) => v === 'flex', 'the top bar replaces the rail');
    ok(await bar((r) => getComputedStyle(r.querySelector('.rail')).display) === 'none', 'no rail with a top bar');
    ok(await space('--gz-navbar-top') === '80px' && await space() === '0px', 'the page keeps the top bar\'s room');
    ok((await bar((r) => [...r.querySelectorAll('.titems .item:not([data-over])')].map((e) => e.dataset.id).join(' '))) === 'institution-page stream course organization calendar messages grades tools', 'the items run along it');
    ok(await bar((r) => r.querySelectorAll('.ttabs .chip').length) === 3, 'the course tabs beside them');
    ok(await bar((r) => !r.querySelector('.tind').hidden && Math.abs(r.querySelector('.tind').getBoundingClientRect().left - r.querySelector('.titems [data-id="course"]').getBoundingClientRect().left) < 2), 'the marker under the current item');
    await shot('top');
    await bar((r) => r.querySelector('.tacc').click());
    await until((r) => [...r.querySelectorAll('.menu .row')].map((e) => e.dataset.id || e.dataset.act).join(' '), (v) => v === 'profile customize', 'the account opens its menu (its sign-out link was taken away above)');
    await page.keyboard.press('Escape');
    ok(await bar((r) => r.querySelector('.menu').hidden && r.activeElement === r.querySelector('.tacc')), 'Escape closes it and focus goes back');
    await page.setViewportSize({ width: 1000, height: 800 });
    await until((r) => r.querySelector('.topbar').hasAttribute('data-compact') || !r.querySelector('.tmore').hidden, Boolean, 'a narrower window: icons first, then More');
    const over = await bar((r) => [...r.querySelectorAll('.titems .item[data-over]')].map((e) => e.dataset.id));
    if (over.length) {
      await bar((r) => r.querySelector('.tmore').click());
      ok((await bar((r) => [...r.querySelectorAll('.menu .row[data-id]')].map((e) => e.dataset.id))).join(' ') === over.join(' '), 'More holds what doesn\'t fit');
      await page.keyboard.press('Escape');
    }
    await shot('top-narrow');
    await page.setViewportSize({ width: 1440, height: 900 });

    // ---- embedded ----
    await send({ on: true, style: 'embed', rail: 'open' });
    await until((r) => Math.round(r.querySelector('.rail').getBoundingClientRect().left), (v) => v === 0, 'embedded, the rail sits at the page\'s edge');
    ok(await space() === '248px', 'and the page keeps just its width');
    await shot('embed');
    await send({ on: true, style: 'embed', place: 'top' });
    await until((r) => [Math.round(r.querySelector('.topbar').getBoundingClientRect().top), Math.round(r.querySelector('.topbar').getBoundingClientRect().left)].join(','), (v) => v === '0,0', 'an embedded top bar spans the top');
    ok(await space('--gz-navbar-top') === '56px', 'and keeps 56px');

    // ---- inside a course ----
    const inCourse = async (course, label) => {
      await send({ on: true, rail: 'open', course });
      await page.evaluate(() => { history.pushState(null, '', '/ultra/courses/_1_1/outline'); dispatchEvent(new PopStateEvent('popstate')); });
      await page.waitForTimeout(150);
      const v = await page.evaluate(() => [document.getElementById('gz-navbar')?.dataset.place, document.documentElement.getAttribute('data-gz-navbar'), getComputedStyle(document.documentElement).getPropertyValue('--gz-navbar-left').trim()]);
      await page.evaluate(() => { history.back(); });
      await page.waitForTimeout(150);
      return v;
    };
    ok((await inCourse('same')).join('|') === 'rail|rail open float tabs|272px', 'inside a course: the same bar');
    ok((await inCourse('icons')).join('|') === 'rail|rail icons float tabs|96px', 'inside a course: icons only');
    ok((await inCourse('top')).join('|') === 'top|top float tabs|0px', 'inside a course: a top bar');
    ok((await inCourse('hide')).join('|') === 'none|none float tabs|0px', 'inside a course: hidden');
    await until((r) => r.host.dataset.place, (v) => v === 'rail', 'back outside, the bar as it was');

    // ---- off again: Ultra's drawer comes back ----
    await send({ on: false });
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.getElementById('gz-navbar') && !document.documentElement.style.getPropertyValue('--gz-navbar-left') && !document.documentElement.hasAttribute('data-gz-navbar')), 'turning it off takes the bar away');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.MuiDrawer-paper nav')).visibility) === 'visible', "Ultra's own nav is back");

    await send({ on: true });
    await until((r) => !!r && !r.host.hidden, Boolean, 'the bar can be enabled again');
    await send({ on: true }, { enhance: { dashboard: false } });
    await page.waitForTimeout(300);
    await send({ on: true }, { enabled: false, enhance: { dashboard: false } });
    await until((r) => !r, Boolean, 'turning Glaze off removes its navbar');
    await send({ on: true });
    await until((r) => !!r && !r.host.hidden, Boolean, 'turning Glaze back on remounts its navbar');
    await page.evaluate(() => {
      document.querySelector('.MuiBadge-badge').textContent = '6'; GZ_NAVBAR_UI.sync();
      window.dispatchEvent(new Event('pagehide'));
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await until((r) => !!r && !r.host.hidden, Boolean, 'the navbar remounts after pagehide');
    await page.evaluate(() => { document.getElementById('gz-navbar').remove(); GZ_NAVBAR_UI.sync(); });
    await until((r) => !!r && !r.host.hidden, Boolean, 'a removed navbar host is replaced');
    ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } catch (e) {
    ok(false, `ran to the end (${e.message})`);
  } finally {
    await ctx?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${checks} ok, ${fails} failed; screenshots in ${out}`);
  process.exit(fails ? 1 : 0);
})();
