// Settings over the page (features/settingspage.js), headless: the real extension on saved Ultra, Canvas and Moodle pages under
// invented school origins, with Glaze navigation, the sidebar (a drawer at this width, its button on the page) and the pet
// habitat on. Settings opens from the bar's Settings item;
// over its frame's whole area nothing else may draw or take the pointer: not Glaze's own overlays (the pet, the sidebar's
// buttons, floating tiles), nor an overlay the page adds later, in <body> or beside it in <html>, however high its z-index.
// Closing puts the page back as it was. All other requests abort; no LMS needed.
//   NODE_PATH=/path/to/node_modules nice -n 15 node scripts/embedded-settings-check.js [out dir for screenshots]
// Hold $GLAZE_LOCK (default glaze-heavy.lock in the OS temp directory) while it runs.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const G = require('../defaults.js');
require('../lib/widgets.js'); // its settings in GZ_SPEC
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://moodle.school.test/*', 'https://bb.school.test/*']);
const chromeLaunch = require('./check-env.js').chromeLaunch();
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-embedded-settings-'));
const CANVAS = 'https://emb.school.instructure.com', MOODLE = 'https://moodle.school.test', ULTRA = 'https://bb.school.test';
const fixture = (name) => fs.readFileSync(path.join(ext, 'test/fixtures', name), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
const PAGES = { [`${CANVAS}/`]: 'canvas-dashboard-cards.html', [`${MOODLE}/my/`]: 'moodle-dashboard.html', [`${ULTRA}/ultra/course`]: 'ultra-courses.html' };
const SITES = [['ultra', `${ULTRA}/ultra/course`], ['canvas', `${CANVAS}/`], ['moodle', `${MOODLE}/my/`]];
const settings = G.GZ_SANITIZE({ enabled: true, navbar: { ...G.GZ_DEFAULTS.navbar, on: true }, motion: { level: 'off' },
  enhance: { ...G.GZ_DEFAULTS.enhance, pet: true, sidebar: true, widgets: true, notes: true } });
let checks = 0, fails = 0;
const ok = (value, label) => { console.log(`${value ? 'ok  ' : 'FAIL'} ${label}`); if (value) checks++; else fails++; };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-embedded-settings-run-'));
  let ctx;
  const errors = [];
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), { ...chromeLaunch, headless: true, viewport: { width: 1000, height: 800 }, reducedMotion: 'reduce', locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-webgl', '--host-resolver-rules=MAP * ~NOTFOUND'] });
    require('./check-env.js').noFirstRun(ctx);
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (route.request().method() === 'GET' && PAGES[u.origin + u.pathname]) return route.fulfill({ contentType: 'text/html', body: fixture(PAGES[u.origin + u.pathname]) });
      if (u.origin === CANVAS && u.pathname.startsWith('/api/v1/')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      if (u.origin === ULTRA && u.pathname.startsWith('/learn/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.abort();
    });
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${id}/options.html`);
    await opts.evaluate(async (s) => {
      await chrome.storage.sync.set({ ...s, navbarItems: { glaze: ['settings'] } });
      await chrome.storage.local.set({ moodle: ['https://moodle.school.test/*'], ultra: ['https://bb.school.test'] }); // the student's yes to these sites
    }, settings);
    await require('./check-env.js').ultraReady(opts);
    const until = async (page, fn, arg, label) => { const end = Date.now() + 30000; while (Date.now() < end) { const v = await page.evaluate(fn, arg).catch(() => false); if (v) return v; await page.waitForTimeout(80); } throw new Error(label); };

    for (const [site, url] of SITES) {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${site}: ${e}`));
      try {
        await page.goto(url);
        await until(page, () => !!document.documentElement.style.getPropertyValue('--gz-accent') && !!document.getElementById('gz-navbar')?.shadowRoot?.querySelector('[data-id="glaze:settings"]'), null, `${site}: themed, with the bar's Settings item`);
        // Let the sidebar and the pet arrive, then add the page's own overlays: one in <html> beside <body> before Settings opens.
        await page.waitForTimeout(1500);
        await page.evaluate(() => {
          const o = document.createElement('div');
          o.id = 'check-overlay-html';
          o.style.cssText = 'position:fixed;right:40px;bottom:40px;width:120px;height:80px;z-index:2147483647;background:#e0a';
          document.documentElement.append(o);
        });
        const own = await page.evaluate(() => [...document.querySelectorAll('[id^="gz-"], [class*="gz-"]')].filter((e) => e.getClientRects().length && ['fixed', 'absolute'].includes(getComputedStyle(e).position) && !e.closest('#gz-navbar') && +getComputedStyle(e).zIndex >= 1000).map((e) => `${e.id || e.className.split(' ')[0]} z${getComputedStyle(e).zIndex}`));
        console.log(`     ${site}: Glaze's overlays on the page: ${own.join(', ') || 'none'}`);
        await page.evaluate(() => [...document.getElementById('gz-navbar').shadowRoot.querySelectorAll('[data-id="glaze:settings"]')].find((b) => b.getClientRects().length).click());
        await until(page, () => document.getElementById('gz-settings-page')?.getBoundingClientRect().width > 0, null, `${site}: Settings opens over the page`);
        // An overlay that comes while it is open.
        await page.evaluate(() => {
          const o = document.createElement('div');
          o.id = 'check-overlay-late';
          o.style.cssText = 'position:fixed;left:50%;top:50%;width:160px;height:90px;z-index:2147483647;background:#0ae';
          document.body.append(o);
        });
        await page.waitForTimeout(600);
        const r = await page.evaluate(() => {
          const host = document.getElementById('gz-settings-page'), b = host.getBoundingClientRect();
          const name = (e) => (e ? `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}` : 'nothing');
          const inside = (x, y) => x > b.left + 2 && x < b.right - 2 && y > b.top + 2 && y < b.bottom - 2;
          const points = [];
          for (let i = 1; i < 8; i++) for (let j = 1; j < 6; j++) points.push([b.left + (b.width * i) / 8, b.top + (b.height * j) / 6, 'grid']);
          // Glaze's own overlays and the check's: their centres, where they fall over Settings.
          const overlays = [...document.querySelectorAll('body > *, html > :not(head, body)')].filter((e) => e !== host && e.id !== 'gz-navbar' && e.getClientRects().length && ['fixed', 'absolute', 'sticky'].includes(getComputedStyle(e).position));
          const seen = [];
          for (const e of overlays) for (const el of [e, ...e.querySelectorAll('*')].slice(0, 40)) {
            const q = el.getBoundingClientRect(), x = q.left + q.width / 2, y = q.top + q.height / 2;
            if (q.width && q.height && inside(x, y)) { points.push([x, y, name(el)]); if (el === e) seen.push(name(e)); }
          }
          const wrong = points.map(([x, y, what]) => [what, Math.round(x), Math.round(y), document.elementFromPoint(x, y)]).filter(([, , , at]) => at !== host).map(([what, x, y, at]) => `${what} @${x},${y} → ${name(at)}`);
          // Drawn over it: an overlay that still shows (no ancestor hides it) where it falls over Settings.
          const shows = (e) => { for (let p = e; p && p.nodeType === 1; p = p.parentElement) { const c = getComputedStyle(p); if (c.opacity === '0' || c.visibility === 'hidden' || c.display === 'none') return false; } return true; };
          const drawn = overlays.filter((e) => { const q = e.getBoundingClientRect(); return q.right > b.left && q.left < b.right && q.bottom > b.top && q.top < b.bottom && shows(e); }).map(name);
          return { points: points.length, wrong: [...new Set(wrong)].slice(0, 12), seen, drawn };
        });
        console.log(`     ${site}: overlays over Settings: ${r.seen.join(', ') || 'none'}`);
        ok(r.wrong.length === 0, `${site}: Settings is the topmost thing at all ${r.points} points over its frame${r.wrong.length ? ` (${r.wrong.join('; ')})` : ''}`);
        ok(r.drawn.length === 0, `${site}: nothing of the page shows over its frame${r.drawn.length ? ` (${r.drawn.join(', ')})` : ''}`);
        await page.screenshot({ path: path.join(out, `embedded-settings-${site}.png`) });
        await page.keyboard.press('Escape');
        await until(page, () => !document.getElementById('gz-settings-page'), null, `${site}: Settings closes`);
        const back = await page.evaluate(() => ({ inert: [...document.querySelectorAll('body > *, html > :not(head, body)')].filter((e) => e.inert).map((e) => e.id || e.tagName),
          hidden: ['check-overlay-html', 'check-overlay-late', 'gz-sb-edge', 'gz-sb-launch'].map((i) => document.getElementById(i)).filter((e) => e && getComputedStyle(e).opacity !== '1').map((e) => e.id),
          styles: ['check-overlay-html', 'check-overlay-late'].map((i) => document.getElementById(i).style.opacity) }));
        ok(!back.inert.length && !back.hidden.length && back.styles.every((v) => v === ''), `${site}: closing gives the page back, in reach and seen (${JSON.stringify(back)})`);
      } catch (e) { ok(false, `${site}: ${e.message}`); } finally { await page.close(); }
    }
    ok(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await ctx?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${fails ? 'FAILED' : 'passed'}: ${checks} checks${fails ? `, ${fails} failed` : ''}. Screenshots: ${out}`);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
