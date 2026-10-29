// Ultra's current assignment attempt with Glaze loaded (test/fixtures/ultra-test-attempt.html): it scrolls as one page, its
// title going up with the instructions; Save and Submit stay at the bottom, reachable, on a painted dock; the sidebar's
// column ends above them; the end of the page clears them; and the title has no room kept for a course strip that is in
// the breadcrumb row above it. Off with its setting, Ultra's own scrolling. Four window sizes; a dark and a light Look.
// EXT=<checkout> NODE_PATH=<playwright> nice node scripts/ultra-assignment-attempt-check.js <out dir> [--looks=a,b]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://bb.school.test/*']);
const G = require(path.join(ext, 'defaults.js'));
const site = 'https://bb.school.test', uid = '_42_1';
const out = path.resolve(process.argv[2] || 'ultra-assignment-attempt-evidence');
const lookArg = process.argv.find((a) => a.startsWith('--looks='));
const LOOKS = lookArg ? lookArg.slice(8).split(',') : ['Frostdev', 'Library'];
const SIZES = [[1800, 987], [1280, 800], [1024, 768], [768, 900]];
const fixture = fs.readFileSync(path.join(ext, 'test/fixtures/ultra-test-attempt.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const ATTEMPT = '/ultra/courses/_101_1/assessment/_8129_1/attempt/create?courseId=_101_1';
const results = [];
const check = (v, label, actual) => { results.push({ pass: !!v, label, actual }); console.log(`${v ? 'ok  ' : 'FAIL'} ${label}${actual === undefined ? '' : ' ' + JSON.stringify(actual)}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const measure = () => {
  const q = (s) => document.querySelector(s), r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const base = q('[class*="makeStylesbaseBody-"]'), content = q('[class*="makeStylescontentRoot-"]'), foot = q('[class*="makeStylesfooterWrapper-"]');
  const at = (e) => { const b = e.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); };
  const hit = (e) => { const t = at(e); return !!t && e.contains(t); };
  const name = (t) => t ? `${t.localName}${t.id ? '#' + t.id : ''}${t.className && typeof t.className === 'string' ? '.' + t.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}` : null;
  const host = q('[data-gz-sidebar-host]'), paint = getComputedStyle(foot).backgroundImage + ' ' + getComputedStyle(foot).backgroundColor;
  return { base: base.scrollTop, content: content.scrollTop, title: r(q('h1.js-header-text')), crumbs: r(q('content-page-header')), foot: r(foot), baseBox: r(base),
    headPad: parseFloat(getComputedStyle(q('[class*="makeStylesheaderRoot-"]')).paddingTop), buttons: [...foot.querySelectorAll('button')].every(hit),
    over: [...foot.querySelectorAll('button')].filter((e) => !hit(e)).map((e) => name(at(e))),
    upload: r(q('.gz-fx-upload')), host: host && getComputedStyle(host).display !== 'none' && host.getBoundingClientRect().width > 100 ? r(host) : null,
    sidebar: document.documentElement.getAttribute('data-gz-sidebar'), painted: !/^none rgba\(0, 0, 0, 0\)$/.test(paint), paint, strip: !!q('content-page-header #gz-ctabs') };
};

(async () => {
  let ctx;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-assignment-attempt-'));
  fs.mkdirSync(out, { recursive: true });
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true,
      viewport: { width: 1800, height: 987 }, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'] });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: fixture });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: uid }) });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    // The owner's layout: Glaze's rail, the course strip above (on a routed page, in its breadcrumb row), the sidebar.
    const setup = async (look, extra = {}) => {
      const base = G.GZ_DEFAULTS, L = G.GZ_LOOKS.find((l) => l.name === look);
      const settings = { ...base, ...G.GZ_LOOK_APPLY(base, L), motion: { ...base.motion, level: 'off' }, tabs: { ...G.GZ_SANITIZE({}).tabs, at: 'above' }, enhance: { ...base.enhance, ...extra } };
      await opts.evaluate(async ({ settings, site, uid }) => {
        await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.session.clear();
        await chrome.storage.sync.set(settings);
        await chrome.storage.local.set({ ultra: [site], [`ctabs:${site}:${uid}`]: { tabs: [1, 2].map((i) => ({ cid: `_10${i}_1`, name: `Course ${i}`, path: `/ultra/courses/_10${i}_1/outline`, at: i, top: 0 })) } });
      }, { settings, site, uid });
      await require('./check-env.js').ultraReady(opts);
    };
    const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
    const scrollTo = async (y) => { await page.locator('[class*="makeStylesbaseBody-"]').evaluate((e, y) => { e.scrollTop = y; }, y); await pause(300); return page.evaluate(measure); };

    for (const look of LOOKS) {
      await setup(look);
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(site + ATTEMPT);
        await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-accent').trim() && document.querySelector('h1.js-header-text'), null, { timeout: 20000 });
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.fonts.ready);
        await pause(900);
        const tag = `${slug(look)} ${w}`;
        const top = await page.evaluate(measure);
        check(top.headPad === 0 && top.title.y - top.crumbs.b < 64, `${tag}: no room kept above the title for a strip in the breadcrumb row`, { pad: top.headPad, gap: top.title.y - top.crumbs.b, strip: top.strip });
        check(top.buttons && Math.abs(top.foot.b - top.baseBox.b) <= 1, `${tag}: at the top, Save and Submit at the bottom and reachable`, { foot: top.foot.b, body: top.baseBox.b, over: top.over });
        await shot(`${slug(look)}-${w}-top`);
        // The wheel over the instructions scrolls the whole page.
        await page.mouse.move(Math.round(top.title.x + 40), Math.round((top.foot.y + top.title.b) / 2));
        await page.mouse.wheel(0, 400); await pause(400);
        const down = await page.evaluate(measure);
        check(down.base > 300 && down.content === 0, `${tag}: the wheel scrolls the page, not a box under the title`, { body: down.base, content: down.content });
        check(Math.abs(down.title.y - (top.title.y - down.base)) <= 1, `${tag}: the title goes up with it`, { was: top.title.y, now: down.title.y, scrolled: down.base });
        check(down.buttons && Math.abs(down.foot.b - down.baseBox.b) <= 1 && down.painted, `${tag}: Save and Submit stay at the bottom, reachable, on a painted dock`, { foot: down.foot.b, body: down.baseBox.b, paint: down.paint, over: down.over });
        if (down.host && down.sidebar !== 'drawer') check(down.host.b <= down.foot.y + 1 && down.host.y >= down.crumbs.b - 1, `${tag}: the sidebar's column ends above Save and Submit`, { host: [down.host.y, down.host.b], foot: down.foot.y, sidebar: down.sidebar });
        await shot(`${slug(look)}-${w}-scrolled`);
        const end = await scrollTo(1e6);
        check(end.upload.b <= end.foot.y + 1, `${tag}: at the end, the page clears Save and Submit`, { upload: end.upload.b, foot: end.foot.y });
        await shot(`${slug(look)}-${w}-end`);
      }
    }
    // Off with its setting (enhance.titleScroll): Ultra's own layout, the content scrolling under the title.
    await setup(LOOKS[0], { titleScroll: false });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(site + ATTEMPT);
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-accent').trim() && document.querySelector('h1.js-header-text'), null, { timeout: 20000 });
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await pause(900);
    const offTop = await page.evaluate(measure);
    const wheel = await page.locator('.gz-fx-instructions').evaluate((el) => { const r = el.getBoundingClientRect(), c = el.closest('[class*="makeStylescontentRoot-"]').getBoundingClientRect(); return { x: r.left + Math.min(100, r.width / 2), y: Math.max(r.top, c.top) + 80 }; });
    await page.mouse.move(Math.round(wheel.x), Math.round(wheel.y));
    await page.mouse.wheel(0, 400); await pause(400);
    const off = await page.evaluate(measure);
    if (!off.content) console.log('off scroll geometry', await page.evaluate(() => ['[class*="makeStylesbaseBody-"]', '[class*="makeStylescontentRoot-"]', '.gz-fx-instructions'].map((sel) => { const el = document.querySelector(sel), cs = getComputedStyle(el), r = el.getBoundingClientRect(); return { sel, rect: r.toJSON(), client: el.clientHeight, scroll: el.scrollHeight, style: el.getAttribute('style'), display: cs.display, visibility: cs.visibility, overflow: cs.overflow, flex: cs.flex, point: document.elementFromPoint(r.left + 100, Math.max(r.top, 230) + 80)?.outerHTML.slice(0, 300) }; })));

    check(off.base === 0 && off.content > 300 && Math.abs(off.title.y - offTop.title.y) <= 1, 'off with its setting, the content scrolls under the title, as Ultra has it', { body: off.base, content: off.content, title: [offTop.title.y, off.title.y] });
    await shot('setting-off-scrolled');
    check(errors.length === 0, 'no page errors', errors);
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`${results.length - failed} ok, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
