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
    const send = (navbar) => page.evaluate((s) => window.postMessage({ gzPreview: s }, location.origin), G.GZ_SANITIZE({ navbar, enhance: { dashboard: true }, motion: { level: 'subtle' } }));
    const bar = (fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gz-navbar')?.shadowRoot, a), [String(fn), arg]);
    const until = async (read, check, label, arg) => { const end = Date.now() + 5000; let v; while (Date.now() < end) { v = await bar(read, arg); if (check(v)) { ok(true, label); return v; } await page.waitForTimeout(50); } ok(false, `${label} (last: ${JSON.stringify(v)})`); return v; };
    const space = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-navbar-space').trim());
    const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });

    // ---- off: Ultra's own drawer ----
    ok(await page.evaluate(() => !document.getElementById('gz-navbar')), 'off by default: no bar');
    // ---- on, wide window: the open rail ----
    await send({ on: true });
    await until((r) => r && !r.host.hidden && [...r.querySelectorAll('.list .item')].map((a) => a.dataset.id).join(' '), (v) => v === 'institution-page stream course organization calendar messages grades tools', 'the rail lists Ultra\'s items in the default groups');
    ok(await space() === '272px', 'the page keeps the open rail\'s room');
    ok(await page.evaluate(() => Math.round(document.querySelector('.MuiDrawer-root').getBoundingClientRect().width)) === 272, "Ultra's drawer holds that room");
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
    ok((await bar((r) => [...r.querySelectorAll('.sheet .row')].map((e) => e.dataset.id || e.dataset.act))).join(' ') === 'stream organization grades tools profile logout customize', 'the sheet has the rest, the account, signing out and Customize');
    await page.waitForTimeout(500);
    await shot('phone-more');
    await page.keyboard.press('Escape');
    ok(await bar((r) => !r.querySelector('.sheet').hasAttribute('data-open') && r.activeElement?.classList.contains('more')), 'Escape closes it and focus goes back to More');
    await page.setViewportSize({ width: 1440, height: 900 });

    // ---- off again: Ultra's drawer comes back ----
    await send({ on: false });
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.getElementById('gz-navbar') && !document.documentElement.style.getPropertyValue('--gz-navbar-space')), 'turning it off takes the bar away');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.MuiDrawer-paper nav')).visibility) === 'visible', "Ultra's own nav is back");
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
