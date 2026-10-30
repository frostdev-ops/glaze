// A document's Contents drawer with Glaze loaded (test/fixtures/ultra-test-attempt.html): open, it is its full width, its
// links and close button reachable (its nav's class shares a prefix with Ultra's own navigation's, which Glaze's bar folds
// away); closed, its open button is a pill you can see, on the Look's surface. Glaze's rail and its top bar; three window
// sizes; a dark and a light Look.
// EXT=<checkout> NODE_PATH=<playwright> nice node scripts/ultra-contents-drawer-check.js <out dir> [--looks=a,b]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://bb.school.test/*']);
const G = require(path.join(ext, 'defaults.js'));
const site = 'https://bb.school.test', uid = '_42_1';
const out = path.resolve(process.argv[2] || 'ultra-contents-drawer-evidence');
const lookArg = process.argv.find((a) => a.startsWith('--looks='));
const LOOKS = lookArg ? lookArg.slice(8).split(',') : ['Frostdev', 'Library'];
const SIZES = [[1800, 987], [1280, 800], [1024, 768]];
const fixture = fs.readFileSync(path.join(ext, 'test/fixtures/ultra-test-attempt.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const DOC = '/ultra/courses/_101_1/document/_8130_1?courseId=_101_1';
const results = [];
const check = (v, label, actual) => { results.push({ pass: !!v, label, actual }); console.log(`${v ? 'ok  ' : 'FAIL'} ${label}${actual === undefined ? '' : ' ' + JSON.stringify(actual)}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const measure = () => {
  const q = (s) => document.querySelector(s), r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const hit = (e) => { const b = e.getBoundingClientRect(), t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!t && e.contains(t); };
  const rgba = (c) => { const m = c.match(/rgba?\(([^)]+)\)/) || c.match(/color\(srgb ([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number), s = c.startsWith('color(');
    return { r: s ? p[0] * 255 : p[0], g: s ? p[1] * 255 : p[1], b: s ? p[2] * 255 : p[2], a: p[3] ?? 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const paper = q('.MuiDrawer-paper'), nav = q('nav.js-content-navigation-drawer'), opener = q('button[class*="makeStylesexpandTocButton-"]');
  if (paper) {
    const link = nav.querySelector('a'), close = q('button[class*="makeStylescollapseButton-"]');
    return { open: true, width: r(paper).w, shown: getComputedStyle(nav).visibility === 'visible' && getComputedStyle(link).visibility === 'visible', tagged: nav.hasAttribute('data-gz-nav-root'),
      link: hit(link), close: hit(close) };
  }
  const s = getComputedStyle(opener), fill = rgba(s.backgroundColor), ink = rgba(getComputedStyle(opener.querySelector('svg')).color);
  const contrast = fill && ink ? (Math.max(lum(fill), lum(ink)) + 0.05) / (Math.min(lum(fill), lum(ink)) + 0.05) : 0;
  return { open: false, box: r(opener), alpha: fill?.a ?? 0, contrast, radius: parseFloat(s.borderTopRightRadius) || 0, hit: hit(opener), title: r(q('[class*="makeStylescontentHeaderLarge-"] h1')) };
};

(async () => {
  let ctx;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-contents-drawer-'));
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
    const setup = async (look, place) => {
      const base = G.GZ_DEFAULTS, L = G.GZ_LOOKS.find((l) => l.name === look);
      const settings = { ...base, ...G.GZ_LOOK_APPLY(base, L), navbar: { ...base.navbar, on: true, place }, motion: { ...base.motion, level: 'off' } };
      await opts.evaluate(async ({ settings, site }) => {
        await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.session.clear();
        await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] });
      }, { settings, site });
      await require('./check-env.js').ultraReady(opts);
    };
    const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
    for (const look of LOOKS) for (const place of ['rail', 'top']) {
      await setup(look, place);
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(site + DOC);
        await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-accent').trim() && document.querySelector('nav.js-content-navigation-drawer'), null, { timeout: 20000 });
        await pause(800);
        const tag = `${slug(look)} ${place} ${w}`;
        const open = await page.evaluate(measure);
        check(open.width >= 280 && open.shown && !open.tagged, `${tag}: open, the Contents drawer is its full width and shown, not taken for Ultra's navigation`, open);
        check(open.link && open.close, `${tag}: its links and close button take the pointer`, { link: open.link, close: open.close });
        await shot(`${slug(look)}-${place}-${w}-open`);
        await page.locator('button[class*="makeStylescollapseButton-"]').evaluate((e) => e.click()); await pause(400);
        const closed = await page.evaluate(measure);
        check(!closed.open && closed.alpha >= 0.5 && closed.contrast >= 3, `${tag}: closed, its open button is a tab you can see`, { alpha: closed.alpha, contrast: Math.round(closed.contrast * 10) / 10 });
        check(closed.hit && closed.radius >= 8 && closed.box.r <= closed.title.x + 1, `${tag}: the tab takes the pointer, rounded, clear of the title`, { hit: closed.hit, radius: closed.radius, box: closed.box, title: closed.title.x });
        await shot(`${slug(look)}-${place}-${w}-closed`);
        await page.locator('button[class*="makeStylesexpandTocButton-"]').click(); await pause(400);
        const again = await page.evaluate(measure);
        check(again.open && again.width >= 280 && again.shown, `${tag}: the tab opens the drawer again`, again);
      }
    }
    check(errors.length === 0, 'no page errors', errors);
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`${results.length - failed} ok, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
