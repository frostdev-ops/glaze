// A school's own sites stay registered while Glaze's registrations are brought up to date, headless, with the real unpacked
// extension and its real worker: a staged copy holding https://canvas.school.test, https://another.school.test and
// https://bb.school.test (the student's grants), all on their LMS's list. With nothing changed, the worker's pass over the
// registrations makes no call (Chrome's own answers, match patterns sorted, read as what Glaze asked for); with an older file list and older matches registered, it updates both in
// place, never unregistering, and their pages get Glaze. (chrome.runtime.reload() leaves a --load-extension copy
// unloaded headless, so the update itself is test/register-update.test.js's.)
// NODE_PATH=<installed playwright> nice node scripts/register-update-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const C = 'https://canvas.school.test', A = 'https://another.school.test', B = 'https://bb.school.test';
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), [`${C}/*`, `${A}/*`, `${B}/*`]);
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-register-update-'));
const out = process.argv[2];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn().catch(() => false); if (value) return value; await pause(80); }
  return false;
};
const results = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
const sheets = (page) => page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).filter((h) => h.startsWith('chrome-extension://')).map((h) => new URL(h).pathname.slice(1)));
// The worker's pass over the registrations (ensure), with each call that changes them recorded.
const pass = (sw) => sw.evaluate(async () => {
  const s = chrome.scripting, calls = [], real = {};
  for (const k of ['registerContentScripts', 'unregisterContentScripts', 'updateContentScripts']) {
    real[k] = s[k];
    s[k] = (o, ...rest) => { calls.push([k, (o?.ids || o || []).map((x) => x.id || x)]); return real[k].call(s, o, ...rest); };
  }
  try { await serial(ensure); } finally { Object.assign(s, real); }
  return calls;
});
const registered = (sw) => sw.evaluate(async () => Object.fromEntries((await chrome.scripting.getRegisteredContentScripts()).map((s) => [s.id, s])));
// Key order aside: Chrome hands back an updated registration's fields in its own order.
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
const worker = async (ctx) => until(async () => ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)));

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
      if (u.origin === B && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: fixture('ultra-course.html') });
      if (u.origin === B && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: '{"id":"_42_1"}' });
      if (u.origin === B && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.origin === C && u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fixture('canvas-dashboard-cards.html') });
      if (u.origin === C && u.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      if (u.hostname.endsWith('.test')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const sw = await worker(ctx);
    check(!!sw, 'the worker is up');
    // Notes' hook takes both Canvas sites, listed out of the order Chrome sorts them in.
    await sw.evaluate(async (o) => { await chrome.storage.local.set(o); }, { canvas: [`${C}/*`, `${A}/*`], ultra: [B] });
    const ids = [`${C}/*`, `ultra:${B}`];
    check(await until(async () => { const r = await registered(sw); return [...ids, `${A}/*`].every((x) => x in r) && r['gz-notes-home']?.matches.includes(`${A}/courses/*`); }), 'the listed sites and Notes\' hook on them are registered');
    const want = await registered(sw);
    check(JSON.stringify(await pass(sw)) === '[]', 'with nothing changed, the pass makes no call');

    // An older version's registrations: Canvas's first content script without its Canvas part, Ultra's on /ultra/* only.
    await sw.evaluate(async ([c, u]) => {
      const was = Object.fromEntries((await chrome.scripting.getRegisteredContentScripts()).map((s) => [s.id, s]));
      await chrome.scripting.unregisterContentScripts({ ids: [c, u] });
      await chrome.scripting.registerContentScripts([{ ...was[c], js: was[c].js.filter((f) => f !== 'content-canvas.js'), matchOriginAsFallback: true, css: ['canvas.css'] }, { ...was[u], matches: [was[u].matches.at(-1)] }]);
    }, ids);
    const old = await registered(sw);
    check(!old[ids[0]].js.includes('content-canvas.js') && old[ids[1]].matches.length === 1 && old[ids[0]].matchOriginAsFallback && old[ids[0]].css.includes('canvas.css'), 'the older registrations are in place');
    const calls = await pass(sw);
    check(JSON.stringify(calls) === JSON.stringify([['updateContentScripts', ids]]), `the pass updates both in place and nothing else (${JSON.stringify(calls)})`);
    const now = await registered(sw);
    check(canon(now) === canon(want), `each is as Glaze registers it now${canon(now) === canon(want) ? '' : `: ${canon(now)} vs ${canon(want)}`}`);

    // Chromium accepts a world update without applying it. Only that id needs replacement after the in-place attempt.
    await sw.evaluate(async (c) => {
      const [s] = await chrome.scripting.getRegisteredContentScripts({ ids: [c] });
      await chrome.scripting.unregisterContentScripts({ ids: [c] });
      await chrome.scripting.registerContentScripts([{ ...s, world: 'MAIN' }]);
    }, ids[0]);
    check((await registered(sw))[ids[0]].world === 'MAIN', 'the older execution world is registered');
    const worldCalls = await pass(sw);
    check(JSON.stringify(worldCalls) === JSON.stringify([['updateContentScripts', [ids[0]]], ['unregisterContentScripts', [ids[0]]], ['registerContentScripts', [ids[0]]]]), `only the registration whose world Chromium retained is replaced (${JSON.stringify(worldCalls)})`);
    check(canon(await registered(sw)) === canon(want), 'the replacement restores the execution world');
    check(JSON.stringify(await pass(sw)) === '[]', 'the next pass leaves the repaired registrations alone');

    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${C}/`);
    check(await until(async () => (await sheets(page)).includes('canvas.css')), `the Canvas site's page gets Glaze (${(await sheets(page)).join(', ')})`);
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'canvas.png') }); }
    await page.goto(`${B}/ultra/courses/_101_1/outline`);
    check(await until(async () => (await sheets(page)).includes('theme.css')), 'the Ultra site\'s page gets Glaze');
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(JSON.stringify({ checks: results.length, errors }, null, 2));
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks: results, errors }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
