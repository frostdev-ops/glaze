// Ultra's course tabs, headless (B8): the real extension on a synthetic Ultra (test/fixtures/ultra-course.html, built from
// parity/spikes/B8.md: the sticky two-row course bar, course panels, items opened over them, an SPA router), served under a
// made-up school's address. Nothing leaves the machine: every other request is aborted and DNS is mapped to nowhere.
// It opens courses, then checks: tabs open, switch, close (×, middle click, Delete), pin, move (keyboard, drag) and cap;
// a switch shows the course's copy at once and fades to the live page, back where the tab was (page and scroll), and never
// into an assessment; the strip above, between and below the bar's rows, on an item panel and above a page, never over
// Ultra's own controls; the copies are dropped when the tabs are switched off and when another account signs in; and no
// request is made for any of it. Screenshots: each placement, Frost (dark) and Paper (light), 1280 and 375 px wide.
//   NODE_PATH=/path/to/node_modules node scripts/ultra-tabs-check.js [out dir for screenshots]   (needs playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const G = require('../defaults.js');
require('../lib/coursetabs.js');

const ext = process.env.EXT || path.join(__dirname, '..');
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ultra-tabs-'));
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'test/fixtures/ultra-course.html'), 'utf8');
const SITE = 'https://bb.school.test';
const CSS_URL = 'https://cdn.school.test/ultra/uiv4001.0.0-rel.37_abc/app.css';
const COURSES = [['_101_1', 'Computer Science I', 'FA26-CS101-01', 1], ['_102_1', 'Spanish 110', 'FA26-SPAN110-02', 2], ['_103_1', 'Calculus II', 'FA26-MATH201-01', 4],
  ['_104_1', 'World History', 'FA26-HIST150-01', 6], ['_105_1', 'Biology Lab', 'FA26-BIO120-01', 8]];
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b8-'));
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), {
    executablePath: CHROME, headless: true, viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  let user = '_42_1';
  const requests = []; // everything the page asked for besides Glaze's own extension files
  try {
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      requests.push(`${u.host}${u.pathname}`);
      if (u.origin === SITE && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: PAGE });
      if (u.href === CSS_URL) return route.fulfill({ contentType: 'text/css', body: '.course-content-container{min-height:100vh}\n.panel-wrap{overscroll-behavior:contain}', headers: { 'cache-control': 'max-age=3600' } });
      if (u.origin === SITE && u.pathname === '/learn/api/v1/users/me') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: user }) });
      if (u.origin === SITE && /^\/learn\/api\/v1\/users\/_\d+_1\/memberships/.test(u.pathname)) {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: COURSES.map(([id, name, code, i]) => ({ courseId: id, courseCardColorIndex: i, userHasHidden: false, role: 'S', course: { id, courseId: code, displayId: code, name, isOrganization: false } })) }) });
      }
      if (u.origin === SITE && u.pathname.startsWith('/learn/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.abort();
    });
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    const settings = (o = {}) => opts.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); },
      { ...G.GZ_DEFAULTS, colors: G.GZ_PRESETS.find(([n]) => n === (o.preset || 'Frost'))[1], preset: o.preset || 'Frost', enhance: { ...G.GZ_DEFAULTS.enhance, ...o.enhance }, tabs: { ...G.GZ_SANITIZE({}).tabs, ...o.tabs } });
    const session = () => opts.evaluate(() => chrome.storage.session.get(null));
    await settings();
    const page = await ctx.newPage();
    const strip = () => page.evaluate(() => {
      const s = document.getElementById('gz-ctabs');
      return s && { at: s.dataset.at, tabs: [...s.querySelectorAll('[role="tab"]')].map((e) => ({ cid: e.dataset.courseId, sel: e.getAttribute('aria-selected') === 'true', pin: e.hasAttribute('data-pin'), label: e.getAttribute('aria-label') })), note: s.querySelector('.gz-ctabs-note')?.textContent || '' };
    });
    const order = async () => (await strip())?.tabs.map((x) => x.cid).join(' ');
    const settled = (cid) => page.waitForFunction((c) => !document.getElementById('gz-ctabs-snap') && !document.querySelector('.spinner, [data-gz-loading]')
      && document.querySelector(`#gz-ctabs [role="tab"][data-course-id="${c}"][aria-selected="true"]`), cid, { timeout: 10000 });
    const open = async (cid) => {
      await page.click('[data-analytics-id="course.header.home"]').catch(() => {});
      await page.waitForSelector(`a[href="/ultra/courses/${cid}/outline"]`);
      await page.click(`a[href="/ultra/courses/${cid}/outline"]`);
      await settled(cid);
    };
    const scroller = () => page.evaluate(() => document.querySelector('.course-content-container > .panel-wrap')?.scrollTop);

    // ---- opening courses; the strip outside a course ----
    await page.goto(`${SITE}/ultra/course`);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
    await page.click('a[href="/ultra/courses/_101_1/outline"]');
    await settled('_101_1');
    let s = await strip();
    ok(s.tabs.length === 1 && s.tabs[0].sel && s.tabs[0].label === 'Computer Science I', `a course opened gets a tab, named and selected (${JSON.stringify(s.tabs)})`);
    ok(s.at === 'above', `above the course's bar by default (${s.at})`);
    // Gradebook, scrolled: the place the tab keeps.
    await page.click('a.js-course-grades-tool');
    await page.waitForFunction(() => location.pathname.endsWith('/grades') && !document.querySelector('.spinner'));
    await page.evaluate(() => { document.querySelector('.course-content-container > .panel-wrap').scrollTop = 600; });
    await page.waitForTimeout(800);
    await page.click('[data-analytics-id="course.header.home"]');
    await page.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'page');
    ok(true, 'outside a course, the strip shows above the page');
    await page.click('a[href="/ultra/courses/_102_1/outline"]');
    await settled('_102_1');
    await open('_103_1');
    ok(await order() === '_101_1 _102_1 _103_1', `each course opened gets a tab, in order (${await order()})`);

    // ---- a switch: the copy at once, then the live page, back where the tab was ----
    const before = requests.length;
    await page.click('#gz-ctabs [data-course-id="_101_1"]');
    const snapAt = await page.waitForSelector('#gz-ctabs-snap', { timeout: 300 }).then(() => true, () => false);
    ok(snapAt, 'a click on a tab shows its course\'s copy at once');
    await page.screenshot({ path: path.join(out, 'switch-copy-frost-1280.png') });
    ok(await page.evaluate(() => !!document.querySelector('.spinner')), 'while Ultra is still building the live page (its spinner is under the copy)');
    await settled('_101_1');
    ok(await page.evaluate(() => location.pathname) === '/ultra/courses/_101_1/grades', 'the live page is the tab\'s own place (Gradebook)');
    await page.waitForTimeout(500);
    ok(Math.abs((await scroller()) - 600) <= 2, `and its scroll (${await scroller()})`);
    ok(requests.length === before, `no request for the switch (${requests.slice(before).join(', ') || 'none'})`);

    // ---- never back into an assessment ----
    await page.click('a.js-course-outline-tool');
    await page.waitForFunction(() => location.pathname.endsWith('/outline') && document.querySelector('a[href*="/assessment/"]'));
    await page.click('a[href*="/assessment/"]');
    await page.waitForFunction(() => location.pathname.includes('/assessment/'));
    const views = await page.evaluate(() => window.__assessmentViews);
    await page.click('#gz-ctabs [data-course-id="_102_1"]');
    await settled('_102_1');
    await page.click('#gz-ctabs [data-course-id="_101_1"]');
    await settled('_101_1');
    ok(await page.evaluate(() => location.pathname) === '/ultra/courses/_101_1/outline', `a tab left in an assessment goes back to the course's tool (${await page.evaluate(() => location.pathname)})`);
    ok(await page.evaluate(() => [window.__assessmentViews, window.__attempts]).then(([v, a]) => v === views && a === 0), 'the assessment wasn\'t opened again, nor an attempt started');

    // ---- an item opened over the course: the strip at its panel ----
    await page.click('a[href*="/document/"]');
    await page.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'nested');
    const nested = await page.evaluate(() => { const r = document.getElementById('gz-ctabs').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 40, r.top + r.height / 2); return !!e?.closest('#gz-ctabs'); });
    ok(nested, 'on a document opened over the course, the strip is on top, at its panel');
    await page.screenshot({ path: path.join(out, 'nested-frost-1280.png') });
    await page.click('.panel-header a');
    await page.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'above');

    // ---- pin, move, close ----
    await page.hover('#gz-ctabs [data-course-id="_103_1"]');
    await page.click('#gz-ctabs [data-course-id="_103_1"] .gz-ctab-pin');
    s = await strip();
    ok(s.tabs[0].cid === '_103_1' && s.tabs[0].pin && /pinned/.test(s.tabs[0].label), `a pinned tab goes first and says so (${await order()})`);
    await page.focus('#gz-ctabs [data-course-id="_101_1"]');
    await page.keyboard.press('Shift+ArrowRight');
    ok(await order() === '_103_1 _102_1 _101_1', `Shift+→ moves a tab (${await order()})`);
    ok(await page.evaluate(() => document.activeElement?.dataset.courseId) === '_101_1', 'and it keeps the focus');
    await page.keyboard.press('ArrowLeft');
    ok(await page.evaluate(() => document.activeElement?.dataset.courseId) === '_102_1', '← moves the focus');
    await page.keyboard.press('Delete');
    ok(await order() === '_103_1 _101_1', `Delete closes the focused tab (${await order()})`);
    await open('_104_1');
    await page.click('#gz-ctabs [data-course-id="_101_1"]');
    await settled('_101_1');
    await page.click('#gz-ctabs [data-course-id="_104_1"]', { button: 'middle' });
    ok(await order() === '_103_1 _101_1', `a middle click closes a tab (${await order()})`);
    // Dragging: the last unpinned tab to the first unpinned place.
    await open('_104_1');
    const box = async (cid) => page.locator(`#gz-ctabs [data-course-id="${cid}"]`).boundingBox();
    const from = await box('_104_1');
    const to = await box('_101_1');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + from.width / 2 + ((to.x + 10) - (from.x + from.width / 2)) * i / 8, from.y + from.height / 2);
    await page.mouse.up();
    ok(await order() === '_103_1 _104_1 _101_1', `a tab drags into place, within its group (${await order()})`);
    // The cap: past it, the least recently used unpinned tab closes, with a word.
    await settings({ tabs: { cap: 3 } });
    await page.waitForTimeout(400);
    await open('_105_1');
    s = await strip();
    ok(s.tabs.length === 3 && !s.tabs.some((x) => x.cid === '_101_1') && s.tabs.some((x) => x.cid === '_103_1'), `past the cap, the oldest unpinned tab closes (${await order()})`);
    ok(/Closed Computer Science I/.test(s.note), `and the strip says which ("${s.note}")`);
    await page.setViewportSize({ width: 375, height: 860 });
    await page.screenshot({ path: path.join(out, 'cap-word-frost-375.png') });
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForFunction(() => !document.querySelector('#gz-ctabs .gz-ctabs-note')?.textContent, null, { timeout: 8000 });

    // ---- placements, light and dark, wide and narrow ----
    await settings({ tabs: { cap: 8 } });
    for (const preset of ['Frost', 'Paper']) {
      for (const at of ['above', 'between', 'below']) {
        for (const width of [1280, 375]) {
          await settings({ preset, tabs: { at, cap: 8, color: at === 'between' ? 'tint' : at === 'below' ? 'theme' : 'off', mark: at === 'below' ? 'icon' : 'dot', shape: at === 'between' ? 'pill' : 'tab' } });
          await page.setViewportSize({ width, height: 860 });
          await page.waitForFunction((a) => document.getElementById('gz-ctabs')?.dataset.at === a && !document.querySelector('[data-gz-loading], [data-gz-reveal]'), at);
          await page.mouse.move(5, 850);
          await page.waitForTimeout(300);
          const g = await page.evaluate(() => {
            const r = (e) => e.getBoundingClientRect();
            const st = document.getElementById('gz-ctabs');
            const one = document.querySelector('course-page-header');
            const two = document.querySelector('.js-course-navigation');
            const hit = (e) => { const b = r(e); const x = document.elementFromPoint(b.left + Math.min(60, b.width / 2), b.top + b.height / 2); return !!x && e.contains(x); };
            return { s: r(st).toJSON(), one: r(one).toJSON(), two: r(two).toJSON(), free: hit(one) && hit(two) && hit(st), wide: document.documentElement.scrollWidth - innerWidth };
          });
          const tag = `${at} ${preset} ${width}px`;
          const where = { above: g.s.bottom <= g.one.top + 1, between: g.one.bottom <= g.s.top + 1 && g.s.bottom <= g.two.top + 1, below: g.two.bottom <= g.s.top + 1 }[at];
          ok(where, `${tag}: the strip is ${at === 'between' ? 'between the rows' : `${at} the bar`} (strip ${Math.round(g.s.top)}–${Math.round(g.s.bottom)}, rows ${Math.round(g.one.top)}, ${Math.round(g.two.top)}–${Math.round(g.two.bottom)})`);
          ok(g.free, `${tag}: it covers none of the bar, and nothing covers it`);
          ok(g.wide <= 0, `${tag}: no sideways scroll`);
          await page.screenshot({ path: path.join(out, `${at}-${preset.toLowerCase()}-${width}.png`) });
        }
      }
      // Scrolled: the strip stays with the sticky bar.
      await page.evaluate(() => { document.querySelector('.course-content-container > .panel-wrap').scrollTop = 900; });
      await page.waitForTimeout(150);
      ok(await page.evaluate(() => { const r = document.getElementById('gz-ctabs').getBoundingClientRect(); return r.top >= -1 && r.bottom < 200; }), `${preset}: scrolled, the strip stays at the top with the bar`);
      await page.evaluate(() => { document.querySelector('.course-content-container > .panel-wrap').scrollTop = 0; });
      // An item panel and a page outside a course, in this palette.
      await settings({ preset });
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.click('a.js-course-outline-tool').catch(() => {});
      await page.waitForSelector('a[href*="/document/"]');
      await page.click('a[href*="/document/"]');
      await page.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'nested');
      await page.screenshot({ path: path.join(out, `nested-${preset.toLowerCase()}-1280.png`) });
      await page.click('.panel-header a');
      await page.click('[data-analytics-id="course.header.home"]');
      await page.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'page');
      await page.screenshot({ path: path.join(out, `page-${preset.toLowerCase()}-1280.png`) });
      await page.click('a[href="/ultra/courses/_105_1/outline"]');
      await settled('_105_1');
    }

    // ---- the copies: in the worker's memory only, dropped on switch-off and on another account ----
    let kept = Object.keys(await session()).filter((k) => k.startsWith('snap:'));
    ok(kept.length >= 1 && kept.every((k) => k.startsWith(`snap:${SITE}|_`)), `copies are kept in storage.session, for this site (${kept.length})`);
    await settings({ enhance: { tabs: false } });
    await page.waitForFunction(() => !document.getElementById('gz-ctabs'));
    await page.waitForTimeout(300);
    kept = Object.keys(await session()).filter((k) => k.startsWith('snap:'));
    ok(!kept.length, `switched off: the strip goes, and every copy (${kept.length} left)`);
    await settings();
    await page.waitForSelector('#gz-ctabs [role="tab"]');
    await page.click('#gz-ctabs [data-course-id="_103_1"]');
    await settled('_103_1');
    await page.waitForTimeout(300);
    ok(Object.keys(await session()).some((k) => k.startsWith('snap:')), 'on again, a switch keeps a copy again');
    user = '_43_1';
    await page.reload();
    await page.waitForSelector('#gz-ctabs [role="tab"]');
    await page.waitForTimeout(500);
    kept = Object.keys(await session()).filter((k) => k.startsWith('snap:'));
    ok(!kept.length && (await session())[`snapwho:${SITE}`] === '_43_1', `another account on the site: the last one's copies go (${kept.length} left)`);
    ok(await order() === '_103_1', `and it starts its own list (${await order()})`);
    // The student's two page loads (the first and the reload), each with Ultra's stylesheet: the copies' own link to it
    // came from the browser's cache, and no course page was ever fetched or opened.
    const asked = requests.filter((r) => r.startsWith('bb.school.test/ultra') || r.startsWith('cdn.'));
    ok(asked.length === 4 && asked.filter((r) => r.startsWith('cdn.')).length === 2, `the only page loads are the student's own (${asked.join(', ')})`);

    // ---- the editor: its section, and the strip on the preview's Ultra mock, live ----
    await settings({ tabs: { at: 'between', color: 'tint', shape: 'pill' } });
    await opts.setViewportSize({ width: 1280, height: 900 });
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html#tabs`);
    const pv = opts.frameLocator('#preview');
    await pv.locator('#gz-ctabs[data-at="between"] [role="tab"]').first().waitFor({ timeout: 8000 });
    ok(await pv.locator('#gz-ctabs [role="tab"]').count() === 3, 'the editor\'s preview shows the strip, between the mock bar\'s rows');
    await opts.locator('label:has(> input[name="tabs.at"][value="below"])').click();
    await pv.locator('#gz-ctabs[data-at="below"]').waitFor({ timeout: 4000 }).then(() => ok(true, 'and follows an edit before it is saved'), () => ok(false, 'and follows an edit before it is saved'));
    await opts.locator('#tabs').scrollIntoViewIfNeeded();
    await opts.screenshot({ path: path.join(out, 'editor-frost-1280.png') });
  } finally {
    await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${fails ? 'FAILED' : 'passed'}; screenshots in ${out}`);
  process.exitCode = fails ? 1 : 0;
})();
