// Settings' Gradescope switch, headless: the real extension (a staged copy of the shipped manifest, which doesn't hold
// www.gradescope.com) and its real Settings page and worker. Switched on, the page asks the browser for Gradescope inside the
// click; headless can't answer the prompt, so the page's chrome.permissions.request is the check's (recorded, answered no,
// then yes), and when it says yes the check stands in for the grant in the worker (contains, getAll and remove for that one
// host, as the browser would answer). Refused: the switch stays off and nothing registers. Allowed: on, and Gradescope's
// script registers. Off: unregistered, and the grant handed back.
//   NODE_PATH=<installed playwright> nice node scripts/gradescope-switch-check.js [screenshots directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const env = require('./check-env.js');
const ext = env.staged(process.env.EXT || path.join(__dirname, '..'), []);
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const GS = 'https://www.gradescope.com/*';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-gradescope-'));
const out = path.resolve(process.argv[2] || path.join(tmp, 'shots'));
fs.mkdirSync(out, { recursive: true });
let checks = 0;
const ok = (value, label) => { if (!value) throw new Error(`FAIL ${label}`); checks++; console.log(`ok   ${label}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${label}`); await pause(100); } };

(async () => {
  let ctx;
  const errors = [];
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US', reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'] });
    env.noFirstRun(ctx);
    await ctx.route('**/*', (route) => (new URL(route.request().url()).protocol === 'chrome-extension:' ? route.continue() : route.abort()));
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith(`chrome-extension://${id}/`) });
    ok(!await sw.evaluate((p) => chrome.permissions.contains({ origins: [p] }), GS), 'the staged copy doesn\'t hold www.gradescope.com');
    // Stand-in for the grant in the worker, for Gradescope only; everything else is the browser's own answer.
    await sw.evaluate((gs) => {
      const P = chrome.permissions, contains = P.contains.bind(P), getAll = P.getAll.bind(P), remove = P.remove.bind(P);
      globalThis.__gz = { held: false, removed: [] };
      P.contains = (o) => (o.origins.length && o.origins.every((x) => x === gs) ? Promise.resolve(__gz.held) : contains(o));
      P.getAll = () => getAll().then((p) => ({ ...p, origins: [...p.origins, ...(__gz.held ? [gs] : [])] }));
      P.remove = (o) => { if (o.origins?.includes(gs)) { __gz.removed.push(...o.origins); __gz.held = false; return Promise.resolve(true); } return remove(o); };
    }, GS);
    const registered = () => sw.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((l) => l.map((s) => s.id)));
    const stored = () => sw.evaluate(() => chrome.storage.sync.get('enhance').then((r) => r.enhance?.gradescope === true));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    // The page's request: recorded with whether it came inside the click; its answer is the check's.
    await page.addInitScript(() => {
      globalThis.__gz = { calls: [], answer: false };
      chrome.permissions.request = (o) => { __gz.calls.push([o.origins, navigator.userActivation.isActive]); return Promise.resolve(__gz.answer); };
    });
    await page.goto(`chrome-extension://${id}/options.html#study/todo`);
    const box = page.locator('input[data-key="enhance.gradescope"]');
    const label = page.locator('label.check', { has: box });
    await until(async () => (await label.isVisible()) && !await box.isChecked(), 'the switch, off');
    await label.scrollIntoViewIfNeeded();
    const calls = () => page.evaluate(() => __gz.calls);
    const shot = async (name) => { await label.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, `${name}.png`) }); };
    await shot('gradescope-1-off');

    // Refused.
    await label.click();
    await until(async () => (await calls()).length === 1, 'the request');
    ok(JSON.stringify(await calls()) === JSON.stringify([[[GS], true]]), `switching on asks for ${GS} alone, inside the click`);
    await pause(400);
    ok(!await box.isChecked() && !await stored(), 'refused: the switch stays off and nothing is saved');
    ok(!(await registered()).includes('gz-gradescope'), 'and Gradescope gets no script');

    // Allowed.
    await page.evaluate(() => { __gz.answer = true; });
    await sw.evaluate(() => { __gz.held = true; }); // the browser's grant, as the prompt's yes gives it
    await label.click();
    await until(async () => await box.isChecked() && await stored(), 'on and saved');
    ok((await calls()).length === 2, 'allowed: asked again in this click, and the switch is on and saved');
    ok(await until(async () => (await registered()).includes('gz-gradescope'), 'registered'), 'Gradescope\'s script is registered while the host is held');
    await shot('gradescope-2-on');

    // Off: unregistered, the grant handed back, nothing asked.
    await label.click();
    await until(async () => !await box.isChecked() && !await stored(), 'off and saved');
    ok(await until(async () => !(await registered()).includes('gz-gradescope'), 'unregistered'), 'switched off: Gradescope\'s script goes');
    ok(await until(() => sw.evaluate((gs) => __gz.removed.includes(gs), GS), 'handed back'), 'and the Gradescope grant is handed back (permissions.remove)');
    ok((await calls()).length === 2, 'switching off asks nothing');
    await shot('gradescope-3-off-again');
    ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    console.log(`${checks} checks passed; screenshots in ${out}`);
  } catch (e) {
    console.error(e.stack || String(e));
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(path.join(tmp, 'profile'), { recursive: true, force: true });
  }
})();
