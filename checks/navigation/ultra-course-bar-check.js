// A course's top bar with Glaze loaded (test/fixtures/ultra-course.html): whole at the top of the course; scrolled, a small
// pill of its tools at the end with no backing, the page under it reachable beside it and not moved by the fold; whole
// again under keyboard focus and back at the top. With Glaze's course strip in it the strip stays as it is. Off with its
// setting, the bar stays whole. Four window sizes; a dark and a light Look.
// EXT=<checkout> NODE_PATH=<playwright> nice node scripts/ultra-course-bar-check.js <out dir> [--looks=a,b]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://bb.school.test/*']);
const G = require(path.join(ext, 'defaults.js'));
const site = 'https://bb.school.test', uid = '_42_1';
const out = path.resolve(process.argv[2] || 'ultra-course-bar-evidence');
const lookArg = process.argv.find((a) => a.startsWith('--looks='));
const LOOKS = lookArg ? lookArg.slice(8).split(',') : ['Frostdev', 'Library'];
const SIZES = [[1800, 987], [1280, 800], [1024, 768], [768, 900]];
// The live nesting, as read on a real course (2026-10-27): the bar is the first child of the scroller, a flex column, beside
// the course's content, unpainted; its header row (course-page-header) and tools (bb-course-navigation) are inline siblings
// in it; each tool's name is a Typography span with a size of its own.
const swap = (html, from, to) => { if (!html.includes(from)) throw Error(`fixture changed: ${from}`); return html.replace(from, to); };
const fixture = [
  ['.bb-course-navigation { position: sticky; top: 0; z-index: 10; background: Canvas; }', '.bb-course-navigation { position: sticky; top: 0; z-index: 10; }'],
  ['bb-course-navigation, course-page-header { display: block; }', ''],
  ['`<div class="bb-course-navigation"><bb-course-navigation>`', '`<div class="bb-course-navigation">`'],
  ['`<course-page-header><header>`', '`<course-page-header class="react-container"><header class="makeStylesheader-0-2-45">`'],
  ['`</header></course-page-header>`', '`</header></course-page-header><bb-course-navigation>`'],
  ['<div class="makeStylestoolbar-0-2-11">', '<div class="makeStylesroot-0-2-75 makeStylestoolbar-0-2-11" role="toolbar" aria-label="Course Navigation">'],
  ['href="/ultra/courses/${c.id}/${path}">${label}</a>', 'href="/ultra/courses/${c.id}/${path}"><div class="MuiListItemText-root"><span class="MuiTypography-root MuiTypography-body1" data-title="${label}">${label}</span></div></a>'],
  ['<div class="panel-wrap hide-in-background modern"><section class="course course-color-${r.course.color}" bb-course-membership-markups="${r.course.id}">${barHtml(r.course, r.tool)}</section></div>',
    '<div class="panel-wrap hide-in-background modern">${barHtml(r.course, r.tool)}<section class="course course-color-${r.course.color}" bb-course-membership-markups="${r.course.id}"></section></div>'],
  ['</style>', '  .course-content-container > .panel-wrap { display: flex; flex-direction: column; }\n  .MuiListItemText-root { margin: 4px 0; }\n  .MuiTypography-body1 { margin: 0; font-size: 14px; line-height: 1.5; }\n</style>'],
].reduce((html, [from, to]) => swap(html, from, to), fs.readFileSync(path.join(ext, 'test/fixtures/ultra-course.html'), 'utf8'));
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const results = [];
const check = (v, label, actual) => { results.push({ pass: !!v, label, actual }); console.log(`${v ? 'ok  ' : 'FAIL'} ${label}${actual === undefined ? '' : ' ' + JSON.stringify(actual)}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// In the page: the bar's state, its rows, the first outline row and what the pointer reaches beside the pill.
const measure = () => {
  const bar = [...document.querySelectorAll('div.bb-course-navigation')].find((e) => e.getClientRects().length);
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const tools = bar.querySelector('bb-course-navigation > [class*="makeStylestoolbar"]'), head = bar.querySelector('course-page-header');
  const veil = getComputedStyle(bar, '::before'), t = getComputedStyle(tools);
  const item = document.querySelector('.content-list-item'), link = [...tools.querySelectorAll('a')].find((a) => !a.hasAttribute('aria-current')) || tools.querySelector('a');
  const lr = link.getBoundingClientRect(), pr = tools.getBoundingClientRect();
  const hit = document.elementFromPoint(lr.x + lr.width / 2, lr.y + lr.height / 2);
  // Beside the pill, inside the bar's old band: the page, not the bar.
  const besideX = document.documentElement.dir === 'rtl' ? pr.right + 24 : pr.x - 24, beside = document.elementFromPoint(besideX, pr.y + pr.height / 2);
  const scroller = document.querySelector('.course-content-container > .panel-wrap');
  return { st: scroller.scrollTop, stuck: bar.hasAttribute('data-gz-stuck'), fold: bar.style.getPropertyValue('--gz-fold'), bar: r(bar), tools: r(tools), head: r(head), item: item.getBoundingClientRect().top,
    veil: [veil.display, veil.opacity], paint: getComputedStyle(bar).backgroundColor, radius: parseFloat(t.borderTopLeftRadius) || 0, end: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gz-float-end')) || 12,
    font: parseFloat(getComputedStyle(link.querySelector('.MuiTypography-root') || link).fontSize), linkHit: !!hit && link.contains(hit), beside: !!beside && !bar.contains(beside), vw: innerWidth };
};

(async () => {
  let ctx;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-course-bar-'));
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
      if (u.hostname === 'cdn.school.test') return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const setup = async (look, strip, extra = {}) => {
      const base = G.GZ_DEFAULTS, L = G.GZ_LOOKS.find((l) => l.name === look);
      const settings = { ...base, ...G.GZ_LOOK_APPLY(base, L), navbar: { ...base.navbar, on: true, place: 'top', style: 'float' }, motion: { ...base.motion, level: 'off' },
        enhance: { ...base.enhance, tabs: !!strip, ...extra }, ...(strip ? { tabs: { ...G.GZ_SANITIZE({}).tabs, at: strip } } : {}) };
      await opts.evaluate(async ({ settings, site, uid }) => {
        await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.session.clear();
        await chrome.storage.sync.set(settings);
        await chrome.storage.local.set({ ultra: [site], [`ctabs:${site}:${uid}`]: { tabs: [1, 2].map((i) => ({ cid: `_10${i}_1`, name: `Course ${i}`, path: `/ultra/courses/_10${i}_1/outline`, at: i, top: 0 })) } });
      }, { settings, site, uid });
      await require('./check-env.js').ultraReady(opts);
    };
    const go = async (strip) => {
      await page.goto(`${site}/ultra/courses/_101_1/outline`);
      await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-accent').trim() && document.querySelector('.content-list-item'), null, { timeout: 20000 });
      if (strip) await page.locator('div.bb-course-navigation #gz-ctabs').waitFor({ timeout: 20000 });
      await pause(700);
    };
    const scroll = async (y) => { await page.locator('.course-content-container > .panel-wrap').evaluate((e, y) => { e.scrollTop = y; }, y); await pause(300); return page.evaluate(measure); };
    const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });

    for (const look of LOOKS) {
      await setup(look, false);
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await go(false);
        const tag = `${slug(look)} ${w}`;
        const top = await scroll(0);
        check(!top.stuck && top.head.h > 30 && top.veil[0] !== 'none', `${tag}: at the top the bar is whole`, { head: top.head.h, tools: top.tools.h, veil: top.veil });
        await shot(`${slug(look)}-${w}-top`);
        const down = await scroll(400);
        check(down.stuck, `${tag}: scrolled, the bar is folded`, down.fold);
        check(down.veil[0] === 'none' && /^rgba\(0, 0, 0, 0\)$|^transparent$/.test(down.paint), `${tag}: no backing behind it`, { veil: down.veil, paint: down.paint });
        check(down.head.w <= 1 && down.head.h <= 1, `${tag}: its header row is out of view`, down.head);
        check(down.tools.h <= 44 && down.tools.h <= top.bar.h / 2 && down.tools.y - down.bar.y <= 16, `${tag}: the tools are a small pill at the bar's top, under half its height`, { h: down.tools.h, w: down.tools.w, y: down.tools.y - down.bar.y, was: top.bar.h });
        check(Math.abs(down.bar.h - top.bar.h) <= 0.05, `${tag}: the bar keeps its height, clear around the pill`, { bar: down.bar.h, was: top.bar.h });
        check(down.radius >= 14, `${tag}: rounded as a pill`, down.radius);
        check(Math.abs(down.vw - down.end - down.tools.r) <= 1.5 || Math.abs(down.bar.r - down.end - down.tools.r) <= 1.5, `${tag}: at the end`, { right: down.tools.r, bar: down.bar.r, vw: down.vw });
        check(down.st === 400 && Math.abs(down.item - (top.item - 400)) <= 0.05, `${tag}: nothing under it moved`, { shift: down.item - (top.item - 400), scrollTop: down.st });
        check(down.font <= 12.5, `${tag}: smaller tool names`, down.font);
        check(down.linkHit, `${tag}: a tool in the pill takes the pointer`);
        check(down.beside, `${tag}: beside the pill the page takes the pointer`);
        await shot(`${slug(look)}-${w}-folded`);
        // Keyboard focus in the bar shows it whole, without moving the page.
        await page.locator('div.bb-course-navigation bb-course-navigation a').first().focus();
        await pause(200);
        const focused = await page.evaluate(measure);
        check(focused.head.h > 30 && focused.veil[0] !== 'none', `${tag}: keyboard focus shows it whole`, focused.head);
        check(Math.abs(focused.item - down.item) <= 0.05, `${tag}: and moves nothing`, { shift: focused.item - down.item });
        await page.evaluate(() => document.activeElement?.blur());
        const back = await scroll(0);
        check(!back.stuck && back.head.h > 30 && Math.abs(back.item - top.item) <= 0.05, `${tag}: back at the top it is whole and nothing moved`, { shift: back.item - top.item, fold: back.fold });
      }
    }
    // With Glaze's course strip in the bar (above, between or below its rows) the strip stays, on its own glass, and takes the
    // pointer; the header row folds away and the tools are the pill.
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const at of ['above', 'between', 'below']) {
      await setup(LOOKS[0], at);
      await go(true);
      const top = await scroll(0);
      const stripAt = () => page.evaluate(() => {
        const s = document.querySelector('div.bb-course-navigation #gz-ctabs'), b = s.getBoundingClientRect(), tab = s.querySelector('[data-course-id="_102_1"]').getBoundingClientRect();
        const hit = document.elementFromPoint(tab.x + tab.width / 2, tab.y + tab.height / 2);
        return { y: b.y, w: b.width, h: b.height, hit: !!hit && s.contains(hit) };
      });
      const whole = await stripAt();
      check(!top.stuck && whole.h > 30, `strip ${at}: at the top the bar and strip are whole`, whole);
      const down = await scroll(400), folded = await stripAt();
      check(down.stuck && down.veil[0] === 'none' && /^rgba\(0, 0, 0, 0\)$/.test(down.paint) && down.head.w <= 1, `strip ${at}: scrolled, the header row folds away with no backing`, { veil: down.veil, head: down.head });
      check(folded.h === whole.h && folded.w === whole.w && folded.hit, `strip ${at}: the strip stays whole and takes the pointer`, { folded, whole });
      const pillGap = at === 'below' ? down.tools.y - down.bar.y : down.tools.y - (folded.y + folded.h);
      check(down.tools.h <= 44 && Math.abs(pillGap - 12) <= 1 && Math.abs(down.bar.h - top.bar.h) <= 0.05, `strip ${at}: the tools pill a gap from the ${at === 'below' ? 'window' : 'strip'}, the bar's height kept`, { gap: pillGap, h: down.tools.h, bar: down.bar.h, was: top.bar.h });
      check(down.st === 400 && Math.abs(down.item - (top.item - 400)) <= 0.05 && down.beside && down.linkHit, `strip ${at}: nothing moved, the page and the pill take the pointer`, { shift: down.item - (top.item - 400), beside: down.beside, link: down.linkHit });
      await shot(`strip-${at}-folded`);
      await page.locator('div.bb-course-navigation #gz-ctabs [data-course-id]').first().focus();
      await pause(200);
      const focused = await page.evaluate(measure), open = await stripAt();
      check(focused.head.h > 30 && open.h > 30 && Math.abs(focused.item - down.item) <= 0.05, `strip ${at}: keyboard focus on a course tab shows the bar whole, moving nothing`, { strip: open, shift: focused.item - down.item });
      await page.evaluate(() => document.activeElement?.blur());
      const back = await scroll(0);
      check(!back.stuck && Math.abs(back.item - top.item) <= 0.05 && (await stripAt()).h > 30, `strip ${at}: whole again at the top`);
    }
    // Off with its setting (enhance.fold): the bar stays whole when scrolled, its veil behind it as before.
    await setup(LOOKS[0], false, { fold: false });
    await go(false);
    const offTop = await scroll(0), off = await scroll(400);
    check(!off.stuck && off.head.h > 30 && off.veil[0] !== 'none' && off.veil[1] === '1' && Math.abs(off.item - (offTop.item - 400)) <= 0.05, 'off with its setting, the bar stays whole when scrolled',
      { stuck: off.stuck, head: off.head.h, veil: off.veil, shift: off.item - (offTop.item - 400) });
    await shot('setting-off-scrolled');
    check(errors.length === 0, 'no page errors', errors);
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`${results.length - failed} ok, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
