// Glaze on a school's own Ultra host and on MoodleCloud, headless, with Chrome's narrow manifest: the real extension, a staged
// copy holding https://bb.school.test (the student's grant), synthetic Ultra and Moodle pages, no outside network. An Ultra
// site on the list is registered on its /ultra pages and gets Glaze where its host is held, not where it isn't; MoodleCloud
// gets Glaze's Moodle bundle from the manifest's own entry, with nothing registered for it.
// NODE_PATH=<installed playwright> nice node scripts/registered-hosts-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const held = 'https://bb.school.test', other = 'https://bb.other.test', moodle = 'https://school.moodlecloud.com';
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), [`${held}/*`]);
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-registered-hosts-'));
const out = process.argv[2];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn().catch(() => false); if (value) return value; await pause(80); }
  return false;
};
const results = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
// Glaze's sheets in a page: the links content.js puts in, by file.
const sheets = (page) => page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).filter((h) => h.startsWith('chrome-extension://')).map((h) => new URL(h).pathname.slice(1)));
(async () => {
  let ctx;
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('./check-env.js').chromeLaunch(),
      headless: true, viewport: { width: 1280, height: 860 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if ([held, other].includes(u.origin) && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: fixture('ultra-course.html') });
      if ([held, other].includes(u.origin) && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: '{"id":"_42_1"}' });
      if ([held, other].includes(u.origin) && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.origin === moodle && u.pathname === '/my/') return route.fulfill({ contentType: 'text/html', body: fixture('moodle-dashboard.html') });
      if (u.hostname.endsWith('.test') || u.origin === moodle) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const access = await opts.evaluate(async (o) => Promise.all(o.map((x) => chrome.permissions.contains({ origins: [`${x}/*`] }))), [held, other, moodle]);
    check(JSON.stringify(access) === '[true,false,true]', 'the staged copy holds the school\'s host and MoodleCloud, not the other site');
    await opts.evaluate(async (list) => { await chrome.storage.local.set({ ultra: list }); }, [held, other]);
    const ids = () => opts.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).sort());
    const want = [`ultra:${other}`, `ultra:${held}`].sort();
    check(await until(async () => JSON.stringify((await ids()).filter((x) => x.startsWith('ultra:'))) === JSON.stringify(want)), `both listed Ultra sites are registered (${(await ids()).join(', ')})`);
    const reg = await opts.evaluate(async (x) => (await chrome.scripting.getRegisteredContentScripts({ ids: [x] }))[0], `ultra:${held}`);
    check(JSON.stringify(reg.matches) === JSON.stringify([`${held}/ultra`, `${held}/ultra/*`]) && reg.js.at(-1) === 'content.js' && reg.js.includes('content-ultra.js') && reg.allFrames && reg.runAt === 'document_start', 'on its /ultra pages, with Ultra\'s first content script');

    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${held}/ultra/courses/_101_1/outline`);
    check(await until(async () => (await sheets(page)).includes('theme.css')), 'the held school host\'s Ultra page gets Glaze');
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'held.png') }); }

    await page.goto(`${other}/ultra/courses/_101_1/outline`);
    await page.waitForLoadState('load'); await pause(1500);
    check((await sheets(page)).length === 0, 'the same page on a host not held gets nothing, though its site is registered');

    await page.goto(`${moodle}/my/`);
    check(await until(async () => (await sheets(page)).includes('moodle.css')), 'MoodleCloud\'s page gets Glaze\'s Moodle sheets');
    const there = await sheets(page);
    check(!there.includes('canvas.css') && !there.includes('theme.css'), `and only Moodle's (${there.join(', ')})`);
    check(!(await ids()).some((x) => x.includes('moodlecloud')), 'from the manifest\'s entry: nothing is registered for MoodleCloud');
    if (out) await page.screenshot({ path: path.join(out, 'moodlecloud.png') });

    await opts.evaluate(async (list) => { await chrome.storage.local.set({ ultra: list }); }, [held]);
    check(await until(async () => JSON.stringify((await ids()).filter((x) => x.startsWith('ultra:'))) === JSON.stringify([`ultra:${held}`])), 'a site taken off the list loses its registration');
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(JSON.stringify({ checks: results.length, errors }, null, 2));
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks: results, errors }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
