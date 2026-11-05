// Settings' Pearson switches, headless: the real extension (a staged copy of the shipped manifest, which holds no Pearson
// host) and its real Settings page and worker. A Pearson switch turned on asks the browser for Pearson's three hosts inside
// the click; headless can't answer the prompt, so the page's chrome.permissions.request is the check's (recorded, answered
// no, then yes), and on yes the check stands in for the grant in the page and the worker (contains, getAll and remove).
// Refused: the switch stays off and nothing registers. Allowed: on, and Pearson's two scripts register. A second switch asks
// again and keeps them. The last one off: unregistered, and the three hosts handed back.
//   NODE_PATH=<installed playwright> nice node checks/pearson/switch-check.js [screenshots directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const env = require('../../tools/dev/check-env.js');
const ext = env.staged(process.env.EXT || path.join(__dirname, '../../extension'), []);
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const HOSTS = env.PEARSON_HOSTS;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-pearson-switch-'));
const out = path.resolve(process.argv[2] || path.join(tmp, 'shots'));
fs.mkdirSync(out, { recursive: true });
let checks = 0;
const ok = (value, label) => { if (!value) throw new Error(`FAIL ${label}`); checks++; console.log(`ok   ${label}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${label}`); await pause(100); } };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

(async () => {
  let ctx;
  const errors = [];
  try {
    await require('../../tools/dev/wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...env.chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US', reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'] });
    env.noFirstRun(ctx);
    await ctx.route('**/*', (route) => (new URL(route.request().url()).protocol === 'chrome-extension:' ? route.continue() : route.abort()));
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith(`chrome-extension://${id}/`) });
    ok(!await sw.evaluate((o) => chrome.permissions.contains({ origins: o }), HOSTS), 'the staged copy holds no Pearson host');
    // Stand-in for the grant in the worker, for Pearson's hosts only; everything else is the browser's own answer.
    await sw.evaluate((hosts) => {
      const P = chrome.permissions, contains = P.contains.bind(P), getAll = P.getAll.bind(P), remove = P.remove.bind(P);
      globalThis.__gz = { held: false, removed: [] };
      P.contains = (o) => (o.origins?.length && o.origins.every((x) => hosts.includes(x)) ? Promise.resolve(__gz.held) : contains(o));
      P.getAll = () => getAll().then((p) => ({ ...p, origins: [...p.origins, ...(__gz.held ? hosts : [])] }));
      P.remove = (o) => { if (o.origins?.every((x) => hosts.includes(x))) { __gz.removed.push(...o.origins); return Promise.resolve(true); } return remove(o); };
    }, HOSTS);
    const registered = () => sw.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((l) => l.map((s) => s.id).filter((i) => i.startsWith('gz-pearson'))));
    const stored = (k) => sw.evaluate((k) => chrome.storage.sync.get('enhance').then((r) => r.enhance?.[k] === true), k);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    // The page's request and its own access reads: recorded, answered by the check; a yes is the grant from then on.
    await page.addInitScript((hosts) => {
      const P = chrome.permissions, contains = P.contains.bind(P);
      globalThis.__gz = { calls: [], answer: false, held: false };
      P.request = (o) => { __gz.calls.push([o.origins, navigator.userActivation.isActive]); if (__gz.answer) __gz.held = true; return Promise.resolve(__gz.answer); };
      P.contains = (o) => (o.origins?.length && o.origins.every((x) => hosts.includes(x)) ? Promise.resolve(__gz.held) : contains(o));
    }, HOSTS);
    await page.goto(`chrome-extension://${id}/options.html#pages/documents`);
    const sw_ = (k) => { const box = page.locator(`input[data-key="enhance.${k}"]`); return { box, label: page.locator('label.check', { has: box }) }; };
    const embed = sw_('pearsonEmbed'), math = sw_('pearsonMath'), viewer = sw_('pearsonViewer');
    await until(async () => (await embed.label.isVisible()) && !await embed.box.isChecked() && !await math.box.isChecked() && !await viewer.box.isChecked(), 'the three switches, off');
    await embed.label.scrollIntoViewIfNeeded();
    const calls = () => page.evaluate(() => __gz.calls);
    const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
    await shot('pearson-1-off');

    // Refused.
    await embed.label.click();
    await until(async () => (await calls()).length === 1, 'the request');
    const [first] = await calls();
    ok(same(first[0], HOSTS) && first[1] === true, 'switching on asks for the three Pearson hosts, inside the click');
    await pause(400);
    ok(!await embed.box.isChecked() && !await stored('pearsonEmbed'), 'refused: the switch stays off and nothing is saved');
    ok((await registered()).length === 0, 'and Pearson gets no script');

    // Allowed.
    await page.evaluate(() => { __gz.answer = true; });
    await sw.evaluate(() => { __gz.held = true; });
    await embed.label.click();
    await until(async () => await embed.box.isChecked() && await stored('pearsonEmbed'), 'on and saved');
    ok(await until(async () => same(await registered(), ['gz-pearson', 'gz-pearson-launch']), 'registered'), 'allowed: Pearson\'s two scripts register while its hosts are held');
    ok(!await math.box.isChecked() && !await viewer.box.isChecked(), 'the other Pearson switches stay off');
    await math.label.click();
    await until(async () => await math.box.isChecked() && await stored('pearsonMath'), 'second switch on');
    ok((await calls()).length === 3, 'a second switch asks in its own click');
    await shot('pearson-2-on');

    // One off: still registered, nothing handed back. The last off: unregistered, the three hosts handed back.
    await embed.label.click();
    await until(async () => !await embed.box.isChecked() && !await stored('pearsonEmbed'), 'first off');
    await pause(400);
    ok(same(await registered(), ['gz-pearson', 'gz-pearson-launch']) && (await sw.evaluate(() => __gz.removed)).length === 0, 'one switch left on keeps the scripts and the grant');
    await math.label.click();
    await until(async () => !await math.box.isChecked() && !await stored('pearsonMath'), 'last off');
    ok(await until(async () => (await registered()).length === 0, 'unregistered'), 'the last switch off: Pearson\'s scripts go');
    ok(await until(async () => same(await sw.evaluate(() => __gz.removed), HOSTS), 'handed back'), 'and the three Pearson hosts are handed back (permissions.remove)');
    ok((await calls()).length === 3, 'switching off asks nothing');
    await shot('pearson-3-off-again');
    ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    console.log(`${checks} checks passed; screenshots in ${out}`);
  } catch (e) {
    console.error(e.stack || String(e));
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(out.startsWith(`${tmp}${path.sep}`) ? path.join(tmp, 'profile') : tmp, { recursive: true, force: true });
  }
})();
