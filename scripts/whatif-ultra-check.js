// Ultra's what-if calculator loads on a course's Gradebook, on the page and in a course tab's frame, with Ultra's system
// category keys shown as names. Real unpacked extension, headless Chrome, synthetic Ultra fixture.
// NODE_PATH=<installed playwright> nice node scripts/whatif-ultra-check.js
// EXT=<another checkout> runs it against that code (the code before a fix).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const site = 'https://bb.school.test', user = '_900_1';
const G = require(path.join(ext, 'defaults.js'));
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const html = fixture('ultra-course.html');
// The fixture course's gradebook, its Discussion category titled with Ultra's language key as a real course's is.
const grades = JSON.parse(fixture('ultra-grades.json'));
for (const r of grades.results) if (r.column.gradebookCategory?.title === 'Discussion') r.column.gradebookCategory.title = 'DISCUSSION.NAME';
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-whatif-ultra-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn(); if (value) return value; await pause(100); }
  throw new Error('condition timed out');
};
const results = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
// Ultra's overall grade header, which the calculator goes under; then the calculator opened and read once it settles.
const calc = async (where) => {
  await where.evaluate(() => { const a = document.createElement('aside'); a.className = 'student-grade-overview'; a.textContent = 'Overall grade'; document.body.append(a); });
  await where.waitForSelector('#gz-calc');
  // What it says before anyone opens it: opening it after a failure would try again and hide that failure.
  await pause(1500);
  const shut = await where.evaluate(() => document.getElementById('gz-calc').textContent);
  await where.evaluate(() => { const d = document.getElementById('gz-calc'); if (!d.open) d.querySelector('summary').click(); });
  return until(() => where.evaluate((shut) => {
    const d = document.getElementById('gz-calc'), text = d?.textContent || '';
    return /couldn't load|Blackboard now/.test(text) && { shut, text, totals: [...d.querySelectorAll('dd')].map((e) => e.textContent), groups: [...d.querySelectorAll('legend > span')].map((e) => e.textContent) };
  }, shut));
};
(async () => {
  let ctx;
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('./check-env.js').chromeLaunch(),
      headless: true, viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      const json = (body) => route.fulfill({ contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'cache-control': 'no-store' } });
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: html });
      if (u.origin === site && u.pathname === '/learn/api/v1/users/me') return json({ id: user });
      if (u.origin === site && u.pathname === `/learn/api/v1/users/${user}/memberships`) return json(fixture('ultra-memberships.json'));
      if (u.origin === site && /^\/learn\/api\/v1\/courses\/_10\d_1\/gradebook\/grades$/.test(u.pathname)) return json(grades);
      if (u.origin === site && u.pathname.startsWith('/learn/api/')) return json({ results: [] });
      if (u.origin === 'https://cdn.school.test' && u.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    await opts.evaluate(async ({ settings, site, user }) => {
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ ultra: [site] }); // the student's yes to this Ultra site (lib/background.js approved)
      await chrome.storage.local.set({ [`ctabs:${site}:${user}`]: { tabs: [{ cid: '_102_1', name: 'Synthetic course 2', path: '/ultra/courses/_102_1/grades', top: 0, at: 1, pin: false }] } });
    }, { settings: { ...G.GZ_DEFAULTS, enhance: { ...G.GZ_DEFAULTS.enhance, calc: true, tabs: true } }, site, user });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${site}/ultra/courses/_101_1/grades`);
    const top = await calc(page);
    console.log(JSON.stringify(top));
    check(!/couldn't load/.test(top.shut + top.text) && top.totals[0] === '88%', `on the page the calculator loads Blackboard's 88% (${top.totals.join(', ')})`);
    check(top.groups.includes('Discussion · 20%') && !top.groups.some((g) => /\.NAME/.test(g)), `system categories read as names (${top.groups.join(', ')})`);
    // The owner's case: the Gradebook in a course tab's frame.
    await page.locator('#gz-ctabs [data-course-id="_102_1"]').click();
    const frame = await until(() => Promise.resolve(page.frames().find((f) => f.name() === 'gz-ctab:_102_1')));
    await frame.waitForSelector('#gz-ctabs');
    await until(() => frame.evaluate(() => !document.documentElement.hasAttribute('data-gz-ctab-framed')));
    // As the owner saw it: the frame's own gradebook answer in before the calculator starts.
    await pause(1500);
    const framed = await calc(frame);
    console.log(JSON.stringify(framed));
    check(!/couldn't load/.test(framed.shut + framed.text) && framed.totals[0] === '88%', `in a course tab's frame the calculator loads too (${framed.totals.join(', ')})`);
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    console.log(JSON.stringify({ checks: results.length }));
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
