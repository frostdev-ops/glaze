// Glaze's own navigation bar (features/navbar.js), headless, in the editor's Ultra preview (preview.html runs Ultra's real
// content scripts on a mock page). Settings reach it as the editor sends them (gzPreview); nothing is saved.
// It checks that the bar stands in for Ultra's drawer (hidden, keeping the page's room), its items, order, current item
// and badges; that an item opens through Ultra's own link; the rail's icons state, tooltips, hover peek, keyboard and
// Escape; right-to-left; the phone bar and its More sheet; Glaze's widgets and mods' dock in each place; and that turning
// it off puts Ultra's drawer back.
//   NODE_PATH=/path/to/node_modules nice node scripts/navbar-check.js [screenshots directory]   (needs playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const G = require('../defaults.js');
require('../lib/coursetabs.js'); require('../lib/nav.js'); // their settings, so GZ_SANITIZE keeps them

const src = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-navbar-'));
const chromeLaunch = require('./check-env.js').chromeLaunch();
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

let checks = 0, fails = 0;
const ok = (value, label) => { console.log(`${value ? 'ok  ' : 'FAIL'} ${label}`); if (value) checks++; else fails++; };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-navbar-run-')));
  let ctx;
  const errors = [];
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), { ...chromeLaunch, headless: true, viewport: { width: 1440, height: 900 }, locale: 'en-US',
      args: [`--disable-extensions-except=${src}`, `--load-extension=${src}`, '--host-resolver-rules=MAP * ~NOTFOUND'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`chrome-extension://${extensionId(src)}/preview.html?site=ultra`);
    // Exercise the native items with an explicit preference, independent of fresh-install navigation defaults.
    await page.evaluate(() => chrome.storage.sync.set({ navbarItems: { glaze: [] } }));
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
    ok(await page.evaluate(() => {
      const html = document.documentElement, footer = html.hasAttribute('data-gz-footer');
      html.removeAttribute('data-gz-footer');
      const list = Object.assign(document.createElement('div'), { className: 'course-org-list' }), cards = document.createElement('div');
      cards.setAttribute('data-gz-vh', ''); list.append(cards); document.getElementById('site-wrap').append(list);
      const grows = getComputedStyle(cards).maxHeight === 'none'; list.remove();
      html.toggleAttribute('data-gz-footer', footer); return grows;
    }), 'course cards can grow beyond one viewport with the footer off');
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
    ok(await page.evaluate(() => {
      const f = Object.assign(document.createElement('div'), { id: 'gz-ctabs-frames' });
      f.style.bottom = '32px'; document.body.append(f);
      const tabs = document.getElementById('gz-navbar').shadowRoot.querySelector('.tabs');
      const fits = f.getBoundingClientRect().bottom <= tabs.getBoundingClientRect().top;
      f.remove(); return fits;
    }), 'a phone course frame leaves room for the bottom bar as well as the footer');
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
    // The student's own logo, a picture kept on this device; until one is there, the Glaze logo.
    await send({ on: true, rail: 'open', brand: 'custom' });
    await until((r) => !!r.querySelector('.brand svg.logo') && !r.querySelector('.brand img'), Boolean, 'Your logo without a picture shows the Glaze logo');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZIAwAXrgK9sD9ucwAAAAASUVORK5CYII=';
    await page.evaluate((src) => chrome.storage.local.set({ 'navLogo:a1b2c3d4e5f6': src }), png);
    await send({ on: true, rail: 'open', brand: 'custom' }, { nav: { li: 'a1b2c3d4e5f6' } });
    const own = await until((r) => r.querySelector('.brand img.own')?.src || '', (v) => v.startsWith('blob:'), 'the chosen picture becomes the logo');
    ok(await bar((r) => { const i = r.querySelector('.brand img.own'); return i.complete && i.naturalWidth === 2 && i.getBoundingClientRect().height === 34; }), 'drawn at the logo\'s height, keeping its shape');
    await page.evaluate(() => chrome.storage.local.remove('navLogo:a1b2c3d4e5f6'));
    await until((r) => !!r.querySelector('.brand svg.logo'), Boolean, 'a removed picture gives the Glaze logo back');
    await send({ on: true, brand: 'none' });
    await until((r) => getComputedStyle(r.querySelector('.brand')).display, (v) => v === 'none', 'No logo hides the brand');
    await page.evaluate(() => { document.querySelector('.MuiDrawer-paper footer a[href="#"]').remove(); });
    await until((r) => getComputedStyle(r.querySelector('.out')).display, (v) => v === 'none', 'a removed sign-out link hides its control');

    // ---- course tabs: in the rail instead of their strip ----
    await send({ on: true, rail: 'open', brand: 'glaze' });
    await until((r) => [...r.querySelectorAll('.courses .ctab-go')].map((e) => e.dataset.cid).join(' '), (v) => v === '_3_1 _1_1 _2_1', 'the course tabs sit in the rail, pinned first');
    ok(await page.evaluate(() => !!document.getElementById('gz-ctabs')?.isConnected), 'their strip stays too, unless they are only in the navigation');
    ok(await bar((r) => r.querySelector('.courses .ctab-go[aria-current="page"]')?.dataset.cid) === '_1_1', 'the open course is marked');
    ok(await bar((r) => !!r.querySelector('.courses [data-cid="_3_1"] .pinned')), 'a pinned tab shows its pin');
    await bar((r) => r.querySelector('.courses .ctab-go[data-cid="_2_1"]').click());
    await until((r) => r.querySelector('.courses .ctab-go[aria-current="page"]')?.dataset.cid, (v) => v === '_2_1', 'a tab opens its course');
    await shot('course-tabs');
    // Only in the navigation (tabs.at 'nav'): no strip, and no room kept for one; without the bar's tabs, the strip again.
    const tabsAt = (at, navbarTabs = true) => send({ on: true, rail: 'open', tabs: navbarTabs }, { tabs: { at } });
    await tabsAt('nav');
    const stripGone = async () => { const end = Date.now() + 5000; while (Date.now() < end) { if (await page.evaluate(() => !document.getElementById('gz-ctabs')?.isConnected && document.documentElement.getAttribute('data-gz-ctabs') === 'nav')) return true; await page.waitForTimeout(50); } return false; };
    ok(await stripGone(), 'only in the navigation, the strip goes and the page is told so');
    ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-ctabs-h').trim()) === '0px', 'and keeps no room for it');
    ok((await bar((r) => r.querySelectorAll('.courses .ctab-go').length)) === 3, 'the tabs are still in the bar');
    await tabsAt('nav', false);
    await until((r) => r.querySelectorAll('.courses').length, (v) => v === 0, 'with the bar\'s tabs off,');
    const stripBack = async () => { const end = Date.now() + 5000; while (Date.now() < end) { if (await page.evaluate(() => !!document.getElementById('gz-ctabs')?.isConnected && /^above /.test(document.documentElement.getAttribute('data-gz-ctabs') || ''))) return true; await page.waitForTimeout(50); } return false; };
    ok(await stripBack(), "'only in the navigation' falls back to the strip above the course");
    await tabsAt('above');
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
    await page.evaluate(() => { document.querySelector('.MuiBadge-badge').textContent = '8'; });
    await until((r) => r.querySelector('.titems [data-id="messages"] .badge')?.textContent, (v) => v === '8', 'a badge changes while the account menu is open');
    ok(await bar((r) => !r.querySelector('.menu').hidden && r.activeElement?.dataset.id === 'profile' && !!r.activeElement.closest('.menu')), 'a redraw preserves the open menu and its focused entry');
    await page.keyboard.press('Escape');
    ok(await bar((r) => r.querySelector('.menu').hidden && r.activeElement === r.querySelector('.tacc')), 'Escape closes it and focus goes back');
    await bar((r) => r.querySelector('.tacc').click());
    await page.keyboard.press('Tab');
    ok(await bar((r) => r.querySelector('.menu').hidden), 'Tab dismisses a top bar menu');
    await bar((r) => r.querySelector('.tacc').focus());
    await page.keyboard.press('ArrowDown');
    ok(await bar((r) => !r.querySelector('.menu').hidden && r.activeElement?.closest('.menu') !== null), 'Down on the account opens its menu');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 900, height: 800 });
    const longBrand = await page.evaluate(() => {
      const img = document.querySelector('.MuiDrawer-paper header img'), was = img.alt;
      img.alt = 'W'.repeat(80); GZ_NAVBAR_UI.sync();
      const r = document.getElementById('gz-navbar').shadowRoot;
      const fits = r.querySelector('.tacc').getBoundingClientRect().right <= r.querySelector('.topbar').getBoundingClientRect().right;
      img.alt = was; GZ_NAVBAR_UI.sync(); return fits;
    });
    ok(longBrand, 'a long school name keeps the account within the top bar');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; GZ_NAVBAR_UI.sync(); });
    await page.waitForTimeout(300); // the resize above closes tips once it lands
    const acc = await bar((r) => { const b = r.querySelector('.tacc').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    await page.mouse.move(acc[0], acc[1]);
    await until((r) => { const tip = r.querySelector('.tip'), b = tip.getBoundingClientRect(); return [tip.hasAttribute('data-on'), b.left, b.right, innerWidth, getComputedStyle(tip).transform]; }, (v) => v[0] && v[1] >= 0 && v[2] <= v[3], 'a top bar tooltip stays on screen in RTL');
    await page.evaluate(() => { document.documentElement.dir = ''; GZ_NAVBAR_UI.sync(); });
    await page.setViewportSize({ width: 1000, height: 800 });
    await until((r) => r.querySelector('.topbar').hasAttribute('data-compact') || !r.querySelector('.tmore').hidden, Boolean, 'a narrower window: icons first, then More');
    const over = await bar((r) => [...r.querySelectorAll('.titems .item[data-over]')].map((e) => e.dataset.id));
    if (over.length) {
      await bar((r) => r.querySelector('.tmore').click());
      ok((await bar((r) => [...r.querySelectorAll('.menu .row[data-id]')].map((e) => e.dataset.id))).join(' ') === over.join(' '), 'More holds what doesn\'t fit');
      await page.keyboard.press('Escape');
    }
    await shot('top-narrow');
    const fitted = await bar((r) => {
      r.querySelector('.tlist').style.flex = '0 0 180px';
      r.querySelector('.tmore').hidden = true;
      dispatchEvent(new Event('resize'));
      const box = r.querySelector('.titems');
      return box.scrollWidth <= box.clientWidth + 1;
    });
    ok(fitted, 'one fit reserves More before deciding which items fit');
    await page.waitForTimeout(100); // size observers settle before measuring unchanged passes
    ok(await bar((r) => {
      let reads = 0;
      const box = r.querySelector('.titems');
      const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
      Object.defineProperty(box, 'scrollWidth', { configurable: true, get() { reads++; return desc.get.call(this); } });
      for (let i = 0; i < 10; i++) GZ_NAVBAR_UI.sync();
      delete box.scrollWidth;
      return reads === 0;
    }), 'unchanged Ultra flushes do not refit the top bar');
    await bar((r) => { r.querySelector('.tlist').style.flex = ''; dispatchEvent(new Event('resize')); });
    await bar((r) => { r.querySelector('.tlist').style.flex = '0 0 180px'; });
    await until((r) => { const b = r.querySelector('.titems'); return b.scrollWidth <= b.clientWidth + 1; }, Boolean, 'changed bar sizes refit without an Ultra flush or window resize');
    await bar((r) => { r.querySelector('.tlist').style.flex = ''; });
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
      if (course === 'icons') ok(await bar((r) => ['.toggle', '.pin'].every((s) => getComputedStyle(r.querySelector(s)).display === 'none')), 'icons inside a course hides the pin and expand controls');
      await page.evaluate(() => { history.back(); });
      await page.waitForTimeout(150);
      return v;
    };
    ok((await inCourse('same')).join('|') === 'rail|rail open float tabs|272px', 'inside a course: the same bar');
    ok((await inCourse('icons')).join('|') === 'rail|rail icons float tabs|96px', 'inside a course: icons only');
    ok((await inCourse('top')).join('|') === 'top|top float tabs|0px', 'inside a course: a top bar');
    ok((await inCourse('hide')).join('|') === 'none|none float|0px', 'a hidden navbar hands course tabs back to their strip');
    await until((r) => r.host.dataset.place, (v) => v === 'rail', 'back outside, the bar as it was');

    await send({ on: true, rail: 'open' });
    await until((r) => r.querySelectorAll('.courses .ctab-go').length, (v) => v === 3, 'course tabs are ready for keyboard actions');
    await bar((r) => r.querySelector('.courses .ctab-go[data-cid="_2_1"]').focus());
    await page.keyboard.press('p');
    await until((r) => r.querySelector('.courses .ctab-go[data-cid="_2_1"] .pinned') !== null, Boolean, 'P pins the focused course tab');
    ok(await bar((r) => r.activeElement?.dataset.cid === '_2_1'), 'pinning keeps focus on the course tab');
    await page.keyboard.press('Delete');
    await until((r) => r.querySelector('.courses .ctab-go[data-cid="_2_1"]') === null, Boolean, 'Delete closes the focused course tab');
    ok(await bar((r) => r.activeElement?.dataset.act === 'tab' && !!r.activeElement.closest('.courses')), 'closing a tab focuses a surviving course tab');

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
    ok(await page.evaluate(() => !document.getElementById('gz-navbar')), 'pagehide cancels queued navbar work');
    await page.evaluate(() => GZ_NAVBAR_UI.sync());
    ok(await page.evaluate(() => !document.getElementById('gz-navbar')), 'a late sync cannot remount the navbar before pageshow');
    await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await until((r) => !!r && !r.host.hidden, Boolean, 'the navbar remounts after pagehide');
    await page.evaluate(() => { document.getElementById('gz-navbar').remove(); GZ_NAVBAR_UI.sync(); });
    await until((r) => !!r && !r.host.hidden, Boolean, 'a removed navbar host is replaced');

    // ---- Glaze's widgets: cards in the open rail, squares in the icons rail, compact in the top bar, a grid on a phone ----
    const widgets = (list) => page.evaluate((w) => chrome.storage.sync.set({ navbarItems: { widgets: w } }), list);
    await send({ on: true, rail: 'open' });
    await widgets([{ id: 'clock', at: 'top' }, { id: 'next', at: 'bottom' }, { id: 'timer', at: 'bottom' }, { id: 'pet', at: 'bottom' }]);
    await until((r) => r?.querySelector('.wtop [data-w="clock"] .w-time')?.textContent, (v) => /\d:\d\d/.test(v || ''), 'the clock shows the time at the top of the rail');
    ok((await bar((r) => [...r.querySelectorAll('.wbottom .widget')].map((w) => w.dataset.w).join(' '))) === 'next timer pet', 'what is due, the timer and the pet sit at the bottom, in order');
    await until((r) => r.querySelector('[data-w="timer"] .w-time')?.textContent, (v) => /^\d+:\d\d$/.test(v || ''), 'the focus timer shows its minutes');
    ok(await bar((r) => r.querySelector('[data-w="next"]').getAttribute('aria-disabled') === 'true' && /No upcoming work/.test(r.querySelector('[data-w="next"]').dataset.tip)), 'with nothing due, Next due says so and links nowhere');
    ok(await bar((r) => { const w = r.querySelector('.wtop .widget').getBoundingClientRect(), rail = r.querySelector('.rail').getBoundingClientRect(); return w.left >= rail.left && w.right <= rail.right; }), 'the widgets stay inside the open rail');
    await bar((r) => r.querySelector('[data-w="timer"] .w-go').click());
    await until((r) => r.querySelector('[data-w="timer"]').hasAttribute('data-running') && r.querySelector('[data-w="timer"] .w-label').textContent, (v) => v === 'Pause', 'Start runs the timer and offers Pause');
    await shot('widgets-rail');
    const pet = await bar((r) => { const p = r.querySelector('[data-w="pet"]'); p.__kept = 1; return !!p; });
    await send({ on: true, rail: 'icons' });
    await until((r) => r.querySelector('.rail:not([data-open]) [data-w="clock"]')?.getBoundingClientRect().width, (v) => v > 0 && v <= 54, 'the icons rail keeps each widget in a square');
    ok(await bar((r) => getComputedStyle(r.querySelector('[data-w="clock"] .w-detail')).display === 'none' && /\d/.test(r.querySelector('[data-w="clock"]').dataset.tip)), 'the date goes to its tip');
    ok(pet && await bar((r) => r.querySelector('[data-w="pet"]').__kept === 1), 'a widget is the same element wherever it moves');
    await send({ on: true, rail: 'icons', peek: false });
    await page.mouse.move(900, 400);
    const clockPoint = await bar((r) => { const b = r.querySelector('[data-w="clock"]').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    await page.mouse.move(...clockPoint);
    await until((r) => r.querySelector('.tip').hasAttribute('data-on') && r.querySelector('.tip').textContent, (v) => / · /.test(v || ''), 'the icons rail shows the clock details in a tooltip');
    await page.mouse.move(900, 400);
    // Mods' navigation widgets: in the rail's dock, which never moves, even when it opens over the page.
    await page.evaluate(() => {
      window.__loads = 0;
      const box = Object.assign(document.createElement('div'), { className: 'gz-nav-widget gz-mod-rail' });
      const frame = Object.assign(document.createElement('iframe'), { srcdoc: '<p style="margin:0;font:14px sans-serif;color:#9cf">Mod widget</p>', style: 'width:100%;height:60px;border:0' });
      frame.addEventListener('load', () => { window.__loads++; });
      box.append(frame); window.__modBox = box;
      globalThis.GZ_MODWIDGETS = { rail: () => [{ key: 'demo|rail:a', el: box }] };
      GZ_NAVBAR_UI.sync();
    });
    await send({ on: true, rail: 'open' });
    await until((r) => r.querySelector('.rail[data-open] .dock .gz-mod-rail') && getComputedStyle(r.querySelector('.dock')).visibility, (v) => v === 'visible', "a mod's widget shows in the open rail's dock");
    await page.waitForFunction(() => window.__loads >= 1);
    await send({ on: true, place: 'top' });
    await until((r) => [...r.querySelectorAll('.twidgets .widget')].map((w) => w.dataset.w).join(' '), (v) => v === 'clock next timer pet', 'the top bar has the widgets, compact');
    ok(await bar((r) => getComputedStyle(r.querySelector('.twidgets [data-w="next"] .w-text')).display === 'none' && !r.querySelector('.tdock').hidden), "what's due is an icon there, and a Widgets button opens mods' widgets");
    await bar((r) => r.querySelector('.tdock').click());
    await until((r) => r.host.hasAttribute('data-dock') && (() => { const d = r.querySelector('.dock').getBoundingClientRect(), t = r.querySelector('.topbar').getBoundingClientRect(); return d.top >= t.bottom && d.height > 0 && getComputedStyle(r.querySelector('.dock')).visibility === 'visible'; })(), Boolean, 'the dock opens under the top bar');
    ok(await bar((r) => getComputedStyle(r.querySelector('.rail')).visibility === 'hidden' && r.querySelector('.tdock').getAttribute('aria-expanded') === 'true'), 'the rail stands invisible around it');
    await shot('widgets-top-dock');
    await send({ on: true, place: 'top', style: 'embed' });
    await until((r) => r.host.dataset.style, (v) => v === 'embed', 'the dock follows embed style');
    ok(await bar((r) => getComputedStyle(r.querySelector('.rail')).clipPath === 'none'), 'an embedded rail cannot clip the open dock');
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; GZ_NAVBAR_UI.sync(); });
    ok(await bar((r) => getComputedStyle(r.querySelector('.rail')).clipPath === 'none'), 'an embedded RTL rail cannot clip the open dock');
    await page.evaluate(() => { document.documentElement.dir = ''; GZ_NAVBAR_UI.sync(); });
    await send({ on: true, place: 'top' });
    ok(await page.evaluate(() => window.__loads) === 1, "the mod's frame never loaded again");
    await page.keyboard.press('Escape');
    await until((r) => !r.host.hasAttribute('data-dock') && r.activeElement === r.querySelector('.tdock'), Boolean, 'Escape closes the dock and focus goes back to its button');
    await page.setViewportSize({ width: 390, height: 844 });
    await until((r) => [...r.querySelectorAll('.swidgets .widget')].map((w) => w.dataset.w).join(' '), (v) => v === 'clock next timer pet', 'on a phone the widgets are in the More sheet');
    await bar((r) => r.querySelector('.tab.more').click());
    await bar((r) => r.querySelector('.sheet [data-act="widgets"]').click());
    await until((r) => r.host.hasAttribute('data-dock') && !r.querySelector('.sheet').open && r.querySelector('.dock').getBoundingClientRect().bottom <= innerHeight - 80, Boolean, "the sheet's Widgets row opens the dock over the phone's bar");
    await shot('widgets-phone-dock');
    await page.evaluate(() => { window.__footer = document.documentElement.hasAttribute('data-gz-footer'); document.documentElement.setAttribute('data-gz-footer', ''); GZ_NAVBAR_UI.sync(); });
    ok(await bar((r) => r.querySelector('.dock').getBoundingClientRect().bottom <= r.querySelector('.tabs').getBoundingClientRect().top), 'the phone dock clears the footer and the bottom bar');
    await page.evaluate(() => { document.documentElement.toggleAttribute('data-gz-footer', window.__footer); GZ_NAVBAR_UI.sync(); });
    await page.setViewportSize({ width: 900, height: 844 });
    await until((r) => r.host.hasAttribute('data-dock') && r.querySelector('.dock').getBoundingClientRect().top >= r.querySelector('.topbar').getBoundingClientRect().bottom, Boolean, 'an open dock follows the top bar across 900px');
    await page.setViewportSize({ width: 899, height: 844 });
    await until((r) => r.host.hasAttribute('data-dock') && r.querySelector('.dock').getBoundingClientRect().bottom <= r.querySelector('.tabs').getBoundingClientRect().top, Boolean, 'an open dock returns over the phone bar below 900px');
    await page.setViewportSize({ width: 390, height: 844 });
    ok(await bar((r) => r.querySelector('.dock').getAttribute('role') === 'dialog' && r.querySelector('.tdock').getAttribute('aria-controls') === r.querySelector('.dock').id), 'the Widgets control names its dialog');
    await bar((r) => r.querySelector('.tab.more').click());
    ok(await bar((r) => r.querySelector('.sheet').open && !r.host.hasAttribute('data-dock')), 'opening the modal sheet dismisses the dock');
    await bar((r) => { const go = r.querySelector('.swidgets .w-go'); go.__focusKept = true; go.focus(); });
    await page.evaluate(() => { document.querySelector('.MuiBadge-badge').textContent = '12'; GZ_NAVBAR_UI.sync(); });
    ok(await bar((r) => r.activeElement?.__focusKept === true), 'a sheet redraw keeps focus on a widget control');
    await widgets([{ id: 'next', at: 'top' }, { id: 'timer', at: 'bottom' }]);
    await until((r) => r.querySelectorAll('.swidgets .widget').length, (v) => v === 2, 'the sheet shows a disabled next link before the timer');
    await bar((r) => r.querySelector('.sheet .customize').focus());
    await page.keyboard.press('Tab');
    ok(await bar((r) => r.activeElement === r.querySelector('.swidgets .w-go')), 'Tab wraps to the first focusable widget past a disabled next link');
    await bar((r) => r.querySelector('.sheet [data-act="widgets"]').click());

    ok(await page.evaluate(() => window.__loads) === 1, "and the mod's frame still never loaded again");
    await page.mouse.click(200, 100);
    await until((r) => !r.host.hasAttribute('data-dock'), Boolean, 'a tap outside closes it');
    await page.setViewportSize({ width: 1440, height: 900 });
    await send({ on: true, place: 'rail', course: 'top' });
    await page.evaluate(() => { window.__widgetPage = location.href; history.replaceState(null, '', '/ultra/courses/_1_1/outline'); GZ_NAVBAR_UI.sync(); });
    await until((r) => r.host.dataset.place === 'top' && r.querySelectorAll('.twidgets .widget').length === 2, Boolean, 'widgets follow the course top-bar override');
    await bar((r) => r.querySelector('.tdock').click());
    await send({ on: true, place: 'rail', course: 'hide' });
    await until((r) => r.host.dataset.place === 'none' && !r.host.hasAttribute('data-dock'), Boolean, 'hiding the course bar closes an open dock');
    ok(await page.evaluate(() => window.__loads) === 1, 'course overrides leave the mod frame in its dock');
    await page.evaluate(() => { history.replaceState(null, '', window.__widgetPage); GZ_NAVBAR_UI.sync(); });
    await page.evaluate(() => { delete globalThis.GZ_MODWIDGETS; window.__modBox.remove(); GZ_NAVBAR_UI.sync(); });
    await send({ on: true });
    await widgets([]);
    await until((r) => r.querySelectorAll('.widget').length, (v) => v === 0, 'turning the widgets off takes them away');
    await page.evaluate(() => chrome.storage.sync.remove('navbarItems'));

    const editor = await ctx.newPage();
    editor.on('pageerror', (e) => errors.push(String(e)));
    await editor.goto(`chrome-extension://${extensionId(src)}/options.html#navigation/bar`);
    await editor.waitForSelector('#nbar-items li', { state: 'attached', timeout: 5000 });
    await editor.locator('#navbar input[name="navbar.place"][value="top"]').evaluate((e) => e.click());
    const controls = await editor.locator('#navbar [data-navbar-rail]').evaluate((e) => [e.hidden, getComputedStyle(e).display]);
    ok(controls[0] && controls[1] === 'none', `top-only navigation hides the editor's rail controls (${controls.join(', ')})`);
    await editor.evaluate(() => GZ_XPARTS.write(GZ_XPARTS.areas(), { x: { nav: { groups: [{ items: ['w:clock', 'w:next'] }] } } }));
    await editor.waitForFunction(() => { const cs = document.querySelectorAll('#nbar-widgets input'); return cs.length === 4 && cs[0].checked && cs[1].checked && !cs[2].checked; }, null, { timeout: 5000 });
    ok(true, 'widget settings follow a Look changed while the editor stays open');
    await editor.locator('#nbar-widgets [data-w="pet"] input').check();
    await editor.waitForFunction(async () => (await chrome.storage.sync.get('navbarItems')).navbarItems?.widgets?.some((w) => w.id === 'pet'), null, { timeout: 5000 });
    ok(await editor.evaluate(() => document.activeElement?.matches('#nbar-widgets [data-w="pet"] input')), 'saving a widget choice keeps focus on its checkbox');
    ok(await editor.evaluate(async () => (await chrome.storage.sync.get('navbarItems')).navbarItems.widgets.map((w) => w.id).join(' ') === 'clock next pet'), 'the first personal edit preserves the worn Look widgets');

    await editor.close();
    ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } catch (e) {
    ok(false, `ran to the end (${e.message}${errors.length ? `; ${errors.join(' | ')}` : ''})`);
  } finally {
    await ctx?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${checks} ok, ${fails} failed; screenshots in ${out}`);
  process.exit(fails ? 1 : 0);
})();
