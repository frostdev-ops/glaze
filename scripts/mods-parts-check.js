// Installed mods' Look parts, headless: the real extension on a saved Canvas dashboard under an invented school origin. A
// parts-only mod (rules and a shader background, no code) is put in storage as the worker keeps an installed one; the open
// page lays it over the student's Look, and turning it off gives the Look back. All other requests abort; no LMS needed.
//   NODE_PATH=/path/to/node_modules nice node scripts/mods-parts-check.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ext = process.env.EXT || path.join(__dirname, '..');
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const CANVAS = 'https://parts.school.instructure.com';
const fixture = (name) => fs.readFileSync(path.join(ext, 'test/fixtures', name), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
const PAGES = { [`${CANVAS}/`]: 'canvas-dashboard-cards.html', [`${CANVAS}/courses/25/quizzes/7/take`]: 'canvas-quiz-take.html' };
const MOD = 'partsonlymodaaaa';
const SHADER = 'vec4 scene(vec2 uv) { return vec4(uC1, 1.0); }';
const record = (enabled) => ({ id: MOD, enabled, dev: false, hash: 'h', key: 'k', version: '1.0.0', source: 'file', installedAt: 1, grants: {}, files: {},
  manifest: { glaze: 1, name: 'Relabel', version: '1.0.0', permissions: [], parts: { bg: { shader: { src: SHADER } }, rules: [{ p: 'canvas.dashboard-card.title', do: 'label', t: 'From a mod' }] } } });
let checks = 0;
const ok = (value, label) => { if (!value) throw new Error(`FAIL ${label}`); console.log(`ok   ${label}`); checks++; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-modparts-'));
  let ctx;
  const errors = [];
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND'] });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (route.request().method() === 'GET' && PAGES[u.origin + u.pathname]) return route.fulfill({ contentType: 'text/html', body: fixture(PAGES[u.origin + u.pathname]) });
      if (u.origin === CANVAS && u.pathname.startsWith('/api/v1/')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.abort();
    });
    const until = async (page, fn, arg, label) => { const end = Date.now() + 10000; while (Date.now() < end) { if (await page.evaluate(fn, arg).catch(() => false)) return; await page.waitForTimeout(50); } throw new Error(`FAIL ${label}`); };
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${id}/options.html`);
    // The student's Look: a rule of its own, so the mod's add to it and the Look's comes back alone.
    const r = await opts.evaluate(() => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:look', parts: { x: { rules: [{ p: 'canvas.sidebar.todo', do: 'hide' }] } }, patch: { version: 2 } }, res)));
    ok(r?.ok, 'the student\'s Look with a rule is saved');
    const store = (o) => opts.evaluate((v) => chrome.storage.local.set(v), o);

    const dash = await ctx.newPage();
    dash.on('pageerror', (e) => errors.push(`dashboard: ${e}`));
    await dash.goto(`${CANVAS}/`);
    await until(dash, () => document.querySelector('.ic-DashboardCard') && document.querySelector('[data-gz-r-hide]'), null, 'the Look\'s rule is on');
    const titles = () => dash.evaluate(() => [...document.querySelectorAll('.ic-DashboardCard__header-title')].map((e) => e.textContent.trim()));
    const real = await titles();

    await store({ mods: [MOD], [`mod:${MOD}`]: record(true) });
    await until(dash, () => [...document.querySelectorAll('.ic-DashboardCard__header-title')].every((e) => e.textContent.trim() === 'From a mod'), null, 'the mod relabels the cards');
    ok(true, 'a parts-only mod applies on the open page as it is installed');
    ok(await dash.evaluate(() => !!document.querySelector('#right-side .Sidebar__TodoListContainer[data-gz-r-hide]')), 'the Look\'s rule stays: rules add up');
    await until(dash, () => !!document.getElementById('gz-scene'), null, 'the scene canvas is drawn');
    ok(true, 'the mod\'s shader background starts, whatever the student\'s background kind');
    ok(await dash.evaluate(() => document.documentElement.dataset.gzBg === 'shader' && document.documentElement.style.getPropertyValue('--gz-bg-blur') === '0px'), 'the shader also replaces the CSS background kind and blur');

    const quiz = await ctx.newPage();
    quiz.on('pageerror', (e) => errors.push(`quiz: ${e}`));
    await quiz.goto(`${CANVAS}/courses/25/quizzes/7/take`);
    await quiz.waitForTimeout(800);
    ok(await quiz.evaluate(() => !document.querySelector('[data-gz-r-hide], [data-gz-r-label]') && !document.getElementById('gz-scene')), 'nothing on a quiz being taken');
    await quiz.close();

    await store({ [`mod:${MOD}`]: record(false) });
    await until(dash, (want) => JSON.stringify([...document.querySelectorAll('.ic-DashboardCard__header-title')].map((e) => e.textContent.trim())) === want, JSON.stringify(real), 'titles come back');
    ok(true, 'turned off: the card titles are back');
    await until(dash, () => !document.getElementById('gz-scene'), null, 'the scene stops');
    ok(await dash.evaluate(() => document.documentElement.dataset.gzBg !== 'shader'), 'turned off: the CSS background kind is the student\'s again');
    ok(await dash.evaluate(() => !!document.querySelector('#right-side .Sidebar__TodoListContainer[data-gz-r-hide]')), 'turned off: the Look\'s own parts are what is left');

    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`${checks} checks passed; no page errors.`);
  } finally {
    await ctx?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
