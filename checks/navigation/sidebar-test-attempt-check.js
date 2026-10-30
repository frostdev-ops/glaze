// Ultra's older test attempt with Glaze loaded (test/fixtures/ultra-test-attempt.html): its Details & Information is the
// sidebar beside the questions, the drawer's opener stays off Save and Submit, and an editor menu opened at the page's foot
// is in view. Synthetic page, no account or network.
// A manifest-covered synthetic host avoids a Chromium startup race where a new dynamic registration is listed but
// not yet injected into the renderer. Host registration has its own checks; this check exercises the sidebar.
// NODE_PATH=<playwright> nice node scripts/sidebar-test-attempt-check.js <out dir>   (EXT=<checkout> to check another)
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://school.blackboard.com/*']);
const G = require(path.join(ext, 'defaults.js'));
const site = 'https://school.blackboard.com', uid = '_42_1';
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sidebar-test-')));
const ATTEMPT = '/ultra/courses/_101_1/assessment/_8123_1/attempt/_8124_1';
const html = fs.readFileSync(path.join(ext, 'test/fixtures/ultra-test-attempt.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
let fails = 0;
const check = (v, label, actual) => { fails += !v; console.log(`${v ? 'ok  ' : 'FAIL'} ${label}${actual === undefined ? '' : ' ' + JSON.stringify(actual)}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let ctx;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sidebar-test-profile-'));
  fs.mkdirSync(out, { recursive: true });
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true,
      viewport: { width: 1800, height: 987 }, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'] });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: uid }) });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: html });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const base = { ...G.GZ_DEFAULTS, footer: true, navbar: { ...G.GZ_DEFAULTS.navbar, on: true, place: 'top', style: 'float', tabs: false },
      motion: { ...G.GZ_DEFAULTS.motion, level: 'off' }, enhance: Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, ['sidebar', 'notes', 'widgets'].includes(k)])) };
    await opts.evaluate(async ({ settings, site, uid }) => {
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.session.clear();
      await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ ultra: [site], [`sidebar:ultra:${site}/${uid}`]: { v: 1, rev: 1, mig: 1, open: true, dock: [{ id: 'notes' }], dest: { notes: 'dock' } } });
    }, { settings: base, site, uid });
    await require('./check-env.js').ultraReady(opts);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const box = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width) }; }, sel);
    const hitsInside = (sel, dx = 0.5) => page.evaluate(({ sel, dx }) => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); const x = r.left + r.width * dx, y = r.top + r.height / 2; return e.contains(document.elementFromPoint(x, y)); }, { sel, dx });
    const disjoint = (a, b) => !!a && !!b && (a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);

    for (const [w, h] of [[1800, 987], [1280, 800], [1024, 768]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(site + ATTEMPT);
      await page.waitForSelector('html[data-gz-sidebar]', { timeout: 20000 }).catch(async (e) => {
        console.error('Sidebar startup diagnostics', JSON.stringify({ errors, tabs: ctx.pages().map((p) => p.url()), page: await page.evaluate(() => ({
          visibility: document.visibilityState,
          html: Object.fromEntries([...document.documentElement.attributes].map((a) => [a.name, a.value])),
          hosts: [...document.querySelectorAll('[data-gz-sidebar-host]')].map((e) => e.className),
        })), content: await opts.evaluate(async (url) => {
          const [tab] = await chrome.tabs.query({ url });
          if (!tab) return null;
          return { registered: await chrome.scripting.getRegisteredContentScripts(), storage: await chrome.storage.local.get('ultra'), execution: await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({
            started: !!window.__gzGlaze, ultra: typeof GZ_SITE_ULTRA, colors: typeof GZ_COLOR, base: !!document.head?.querySelector('base[href*="/ultra/"]'), ctx: !!globalThis.GZ_CTX, on: globalThis.GZ_CTX?.on(), sidebar: !!globalThis.GZ_SIDEBAR_UI,
            state: globalThis.GZ_SIDEBAR_UI?.context(),
          }) }) };
        }, site + ATTEMPT) }));
        throw e;
      });
      await pause(800);
      const mode = await page.evaluate(() => document.documentElement.dataset.gzSidebar);
      const host = await page.evaluate(() => { const d = document.querySelector('.assessment-summary'); return { native: d?.getAttribute('data-gz-sidebar-host'), kind: document.documentElement.dataset.gzSbAssessment,
        widgets: !!d?.contains(document.getElementById('gz-sb-widgets')), own: !!document.getElementById('gz-sidebar') }; });
      check(host.native === 'native' && host.kind === 'test' && host.widgets && !host.own, `${w}: the test's details are the sidebar, with the widgets, and no second column`, host);
      const questions = await box('.panel-content-full'), details = await box('.assessment-summary'), submit = await box('.panel-footer-fixed .js-send-draft-button');
      if (w >= 1280) {
        check(mode === 'expanded', `${w}: the sidebar is expanded`, mode);
        check(questions.w >= 600, `${w}: the questions keep at least 600px`, questions);
        check(details.l >= questions.r && details.r <= w, `${w}: one column right of the questions, inside the window`, { questions, details });
        check(await page.evaluate(() => getComputedStyle(document.querySelector('.assessment-summary h2')).visibility === 'visible'), `${w}: Details & Information shows at the column's top`);
        check(await hitsInside('.panel-footer-fixed .js-send-draft-button', 0.97), `${w}: Submit's right edge is Submit's`, submit);
      } else {
        check(mode === 'drawer', `${w}: the sidebar is a drawer`, mode);
        const launch = await box('#gz-sb-launch');
        check(disjoint(launch, submit), `${w}: the drawer's opener stays off Submit`, { launch, submit });
        check(await hitsInside('.panel-footer-fixed .js-send-draft-button', 0.97), `${w}: Submit's right edge is Submit's`, submit);
        check(await hitsInside('.panel-footer-fixed .js-save-draft-button', 0.97), `${w}: Save and Close is Save and Close's`);
        await page.click('#gz-sb-launch'); await pause(300);
        check(await page.evaluate(() => { const e = document.querySelector('.assessment-summary h2'), r = e.getBoundingClientRect(); return r.width > 0 && e.contains(document.elementFromPoint(r.left + 4, r.top + r.height / 2)); }),
          `${w}: the details are in the opened drawer`);
        await page.screenshot({ path: path.join(out, `test-${w}-drawer.png`) });
        await page.keyboard.press('Escape'); await pause(200);
      }
      await page.screenshot({ path: path.join(out, `test-${w}-top.png`) });
      // The foot of the test: the colour menu opened under the last editor.
      await page.evaluate(() => { const p = document.querySelector('.assessment-attempt-panel'); p.scrollTop = p.scrollHeight; });
      await pause(300);
      if (w >= 1280) {
        const head = await box('.gz-sb-head'), scroller = await box('.assessment-attempt-panel');
        const top = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gz-sb-top')) || 0);
        check(head.t >= Math.max(scroller.t, top) - 1, `${w}: at the test's foot the sidebar's head is still in view`, { head, scroller, top });
      }
      await page.click('button[aria-label="Color picker"]'); await pause(300);
      const red = await box('button[aria-label="Red"]'), foot = await box('.panel-footer-fixed');
      check(await hitsInside('button[aria-label="Red"]') && red.b <= foot.t, `${w}: the colour menu's last colour is in view above the footer`, { red, foot });
      await page.screenshot({ path: path.join(out, `test-${w}-color-menu.png`) });
      await page.click('button[aria-label="Color picker"]'); await pause(150);
      await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.querySelector('.assessment-attempt-panel').scrollTop = 0; });
      await pause(300);
      const rtlQuestions = await box('.panel-content-full'), rtlDetails = await box('.assessment-summary');
      if (w >= 1280) check(rtlDetails.r <= rtlQuestions.l && rtlDetails.l >= 0, `${w}: RTL keeps details beside the questions inside the window`, { questions: rtlQuestions, details: rtlDetails });
      else {
        const rtlLaunch = await box('#gz-sb-launch'), rtlSubmit = await box('.panel-footer-fixed .js-send-draft-button');
        check(disjoint(rtlLaunch, rtlSubmit), `${w}: RTL drawer opener stays off Submit`, { launch: rtlLaunch, submit: rtlSubmit });
      }
      await page.evaluate(() => document.documentElement.removeAttribute('dir'));
    }
    check(!errors.length, 'no page errors', errors);
    console.log(JSON.stringify({ fails, out }));
    process.exitCode = fails ? 1 : 0;
  } finally {
    await ctx?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
