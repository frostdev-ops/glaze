// Adding a school's own site on Chrome, headless, with the real unpacked extension and its real worker: the first-run tab
// opens on install; a site allowed there is approved once the page's check and the worker's own found the LMS, and its first
// page gets Glaze with no card (and Glaze's own toolbar icon for that tab); a grant from Chrome's own menus (onAdded with
// nothing asked, called on the worker as the browser would) is checked, and approved or left alone. A headless browser can't
// answer its permission prompt, so the staged copy holds the schools' hosts (the student's grant) and the first screen's
// chrome.permissions is the check's: it says what is held and grants each request. The schools are synthetic pages routed by
// the check: bb.school.edu answers as Blackboard, canvas.school.edu as Canvas, www.school.edu as a school's main website.
// NODE_PATH=<installed playwright> nice node scripts/allow-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const BB = 'https://bb.school.edu', CANVAS = 'https://canvas.school.edu', WWW = 'https://www.school.edu';
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), [`${BB}/*`, `${CANVAS}/*`, `${WWW}/*`]);
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-allow-'));
const out = process.argv[2];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn().catch(() => false); if (value) return value; await pause(100); }
  return false;
};
const results = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
const welcomeUrl = `chrome-extension://${id}/features/welcome.html`;
const sheets = (page) => page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).filter((h) => h.startsWith('chrome-extension://')).map((h) => new URL(h).pathname.slice(1)));

// The first screen's grants: the built-in hosts are held, each request is granted at once (from a click only), and what the
// page hands back is recorded. Its messages go to the real worker.
const stub = () => {
  if (!location.pathname.endsWith('/features/welcome.html')) return;
  const held = new Set(['https://*.instructure.com/*', 'https://*.blackboard.com/*', 'https://*.moodlecloud.com/*']);
  const covers = (o) => [...held].some((p) => p === o || (p.startsWith('https://*.') && o.startsWith('https://') && new URL(o.replace('/*', '/')).hostname.endsWith(p.slice(10, -2))));
  globalThis.__gz = { asked: [], removed: [] };
  chrome.permissions.contains = async ({ origins = [] }) => origins.every(covers);
  chrome.permissions.request = async ({ origins = [] }) => {
    if (!navigator.userActivation.isActive) throw new Error('This function must be called during a user gesture');
    __gz.asked.push(origins);
    origins.forEach((o) => held.add(o));
    return true;
  };
  chrome.permissions.remove = async ({ origins = [] }) => { __gz.removed.push(origins); origins.forEach((o) => held.delete(o)); return true; };
};

(async () => {
  let ctx;
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 860 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    const seen = [];
    ctx.on('page', (p) => seen.push(p));
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === BB && u.pathname === '/learn/api/public/v1/system/version') return route.fulfill({ contentType: 'application/json', body: '{"learn":{"major":4001,"minor":2,"patch":0}}' });
      if (u.origin === BB && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: fixture('ultra-course.html') });
      if (u.origin === BB && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: '{"id":"_42_1"}' });
      if (u.origin === BB && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.origin === CANVAS && u.pathname === '/api/v1/users/self') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"status":"unauthenticated","errors":[{"message":"user authorization required"}]}' });
      if (u.origin === CANVAS && u.pathname.startsWith('/courses')) return route.fulfill({ contentType: 'text/html', body: fixture('canvas-course-home.html') });
      if (u.origin === WWW && u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>School</title><a href="https://apply.school.edu/">Apply</a>' });
      if (u.hostname.endsWith('school.edu')) return route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>Not found</title>' });
      return route.abort();
    });
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith(`chrome-extension://${id}/`) });

    // 1. The first-run tab.
    const first = await until(async () => [...ctx.pages(), ...seen].find((p) => p.url().startsWith(welcomeUrl)));
    check(first, 'the first-run tab opens on install');
    await pause(1500);
    check(ctx.pages().filter((p) => p.url().startsWith(welcomeUrl)).length === 1, 'once');
    await first.close();

    // The worker's own toolbar icon calls, as they happen.
    await sw.evaluate(() => {
      const real = chrome.action.setIcon.bind(chrome.action);
      globalThis.__icons = [];
      Object.defineProperty(chrome.action, 'setIcon', { configurable: true, value: (o) => { __icons.push(o); return real(o); } });
    });

    // 2. A school's site allowed on the first screen.
    await ctx.addInitScript(stub);
    const w = await ctx.newPage();
    w.on('pageerror', (e) => errors.push(String(e)));
    await w.goto(welcomeUrl);
    await w.waitForSelector('#address');
    await w.type('#address', 'bb.school.edu', { delay: 20 });
    await pause(300);
    await w.click('#go');
    check(await until(() => w.evaluate(() => document.querySelector('.bar').dataset.state === 'done'), 15000), 'the first screen checks the site and settles on it');
    const local = () => sw.evaluate(() => chrome.storage.local.get(['canvas', 'moodle', 'ultra']));
    const ids = () => sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).sort());
    check(await until(async () => (await local()).ultra?.includes(BB)), `the worker checks it again and approves it (${JSON.stringify(await local())})`);
    check(await until(async () => (await ids()).includes(`ultra:${BB}`)), `and registers its /ultra pages (${(await ids()).join(', ')})`);
    check(JSON.stringify(await w.evaluate(() => globalThis.__gz.removed)) === '[]', 'nothing handed back');
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`${BB}/ultra/courses/_101_1/outline`);
    check(await until(async () => (await sheets(p)).includes('theme.css')), 'its first page gets Glaze');
    await pause(1500);
    check(await p.evaluate(() => !document.querySelector('glaze-consent')), 'with no card');
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: `${u}/*` }))[0]?.id, BB);
    check(await until(async () => (await sw.evaluate(() => __icons)).some((o) => o.tabId === tabId && o.path?.['16'])), `and Glaze's own toolbar icon for its tab (${JSON.stringify(await sw.evaluate(() => __icons))})`);
    check((await sw.evaluate(() => __icons)).every((o) => Number.isInteger(o.tabId)), 'never an icon without a tab');
    if (out) { fs.mkdirSync(out, { recursive: true }); await p.screenshot({ path: path.join(out, 'first-run-site.png') }); }

    // 3. Grants from Chrome's own menus: a Canvas site with a tab open there, then a school's main website.
    const c = await ctx.newPage();
    c.on('pageerror', (e) => errors.push(String(e)));
    await c.goto(`${CANVAS}/courses/25`);
    await c.waitForLoadState('load');
    await pause(800);
    check((await sheets(c)).length === 0, 'a Canvas site nobody approved has no Glaze');
    await sw.evaluate((o) => granting(o), `${CANVAS}/*`);
    check(await until(async () => (await local()).canvas?.includes(`${CANVAS}/*`)), 'granted from Chrome\'s menu, it is checked and approved');
    check(await until(async () => (await ids()).includes(`${CANVAS}/*`)), 'registered');
    check(await until(async () => (await sheets(c)).includes('canvas.css')), 'and Glaze goes into its open tab');
    await sw.evaluate((o) => granting(o), `${WWW}/*`);
    await pause(2500);
    const after = await local();
    check(![after.canvas, after.moodle, after.ultra].flat().some((x) => String(x).includes('www.school.edu')), 'a site that isn\'t a course site is left alone');
    check(await sw.evaluate((o) => chrome.permissions.contains({ origins: [o] }), `${WWW}/*`), 'and its grant stays the student\'s');
    if (out) await c.screenshot({ path: path.join(out, 'chrome-menu-canvas.png') });

    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(`${results.length} ok`);
  } catch (e) {
    console.error(e);
    if (errors.length) console.error('page errors:', errors.join('\n'));
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
