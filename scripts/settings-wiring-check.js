// Real editor handlers -> sync storage -> sanitization -> reopened controls, in a disposable Chromium profile.
// NODE_PATH=<playwright> node scripts/settings-wiring-check.js [evidence directory or report.json]
// WIRING_CASE=cards runs only the preview regression. Network requests outside the extension are blocked.
// This complements settings-ia-check's real clicks/layout and the feature-specific runtime checks; dispatched
// input/change events here deliberately reach conditional controls without enabling connected services.
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('./check-env.js'), root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lock = require('./check-env.js').lockPath(), chromeLaunch = require('./check-env.js').chromeLaunch(), results = [];
let context, scratch, held = false;
const check = async (name, run) => {
  try { await run(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.error(`FAIL ${name}: ${e.stack}`); }
};
(async () => {
  try {
    for (let n = 0; !held; n++) {
      try { fs.mkdirSync(lock); held = true; }
      catch (e) { if (e.code !== 'EEXIST' || n >= 120) throw e; await wait(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nsettings-wiring-check\n`);
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-settings-wiring-'));
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...chromeLaunch, headless: true, viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    env.noFirstRun(context);
    await context.route('**/*', (r) => new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort());
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`, page = await context.newPage();
    const open = async (section = 'look/palette') => {
      await page.goto(`${base}/options.html#${section}`);
      await page.waitForFunction(() => !!document.querySelector('#looks button'));
    };
    await open();
    if (!process.env.WIRING_CASE) {
      const cases = await page.evaluate(() => {
        const schema = { ...GZ_SPEC, card: GZ_CARDS.SPEC }, initial = { ...GZ_SANITIZE(), card: GZ_CARDS.settings() };
        const read = (s, key) => key.split('.').reduce((v, k) => v?.[k], s);
        const put = (s, key, v) => { const ks = key.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], s)[last] = v; };
        // A key's [default, rule] at any depth (writer.autocorrect.typos): a group's (GZ_GROUP) rule is its own spec.
        const specOf = (key) => key.split('.').reduce((s, k, i) => (i && Array.isArray(s) ? s[1]?.[k] : s?.[k]), schema);
        const cases = [], seen = new Set();
        for (const el of document.querySelectorAll('[data-key], .seg input[type=radio]:not([data-local]), #enabled')) {
          const key = el.dataset.key || el.name || el.id;
          if (seen.has(key)) continue;
          seen.add(key);
          // Enabling Gradescope needs the browser's real permission gesture. Consent/allow checks cover that boundary.
          if (key === 'enhance.gradescope') continue;
          const group = key.split('.')[0], spec = specOf(key), before = read(initial, key);
          // An option as defaults.js declares its choice: writer.zoom's 75 is a number beside 'fit'.
          const typed = (v) => { const c = Array.isArray(spec?.[1]) ? spec[1].find((x) => String(x) === v) : undefined; return c === undefined ? v : c; };
          let value, choices;
          if (el.type === 'checkbox') choices = [false, true], value = !el.checked;
          else if (el.type === 'range') choices = [+el.min, +el.max], value = +el.value === +el.max ? +el.min : +el.max;
          else if (el.tagName === 'SELECT') choices = [...el.options].map((o) => typed(o.value)), value = choices.find((v) => v !== typed(el.value));
          else if (el.type === 'radio') choices = [...document.querySelectorAll(`input[name="${key}"]`)].map((r) => r.value), value = choices.find((v) => v !== before);
          else if (el.type === 'color') choices = ['#123456'], value = '#123456';
          else if (el.type === 'time') choices = ['13:17'], value = '13:17';
          else if (el.type === 'text') choices = ['Audit sidebar'], value = 'Audit sidebar';
          const rejected = (choices || []).filter((value) => {
            const raw = structuredClone(initial);
            put(raw, key, value);
            const clean = group === 'card' ? { card: GZ_CARDS.settings(raw.card) } : GZ_SANITIZE(raw);
            return JSON.stringify(read(clean, key)) !== JSON.stringify(value);
          });
          cases.push({ key, type: el.type, value, rejected, known: !key.includes('.') || !!spec || group === 'courses' });
        }
        return cases;
      });
      assert.ok(cases.length > 200, 'the full editor loaded');
      for (const item of cases) {
        const started = Date.now();
        await check(item.key, async () => {
          assert.ok(item.known && item.value !== undefined, 'a known setting has an alternate control value');
          assert.deepEqual(item.rejected, [], 'every offered choice / range endpoint survives sanitization');
          await page.evaluate(({ key, type, value }) => {
            const el = document.querySelector(key === 'enabled' ? '#enabled' : type === 'radio' ? `input[name="${key}"][value="${value}"]` : `[data-key="${key}"]`);
            if (type === 'checkbox' || type === 'radio') el.checked = type === 'radio' || value; else el.value = value;
            if (type === 'range' || type === 'color') el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, item);
          // Polled from here: waitForFunction takes an async predicate's promise as its answer at once.
          const saved = () => page.evaluate(async (key) => JSON.stringify(key.split('.').reduce((s, k) => s?.[k], await GZ_UI.load())), item.key);
          for (const end = Date.now() + 3000; await saved() !== JSON.stringify(item.value);) {
            if (Date.now() > end) throw new Error(`saved ${await saved()}, not ${JSON.stringify(item.value)}`);
            await wait(50);
          }
        });
        if (results.length % 25 === 0) console.log(`Checked ${results.length}/${cases.length} controls`);
        // Respect Chrome's real sync-write quota; no storage or worker mocks hide failed writes.
        await wait(Math.max(0, 650 - (Date.now() - started)));
      }
      await check('reopened controls', async () => {
        await open();
        const differences = await page.evaluate(async () => {
          const s = await GZ_UI.load(), differences = [];
          for (const el of document.querySelectorAll('[data-key], .seg input[type=radio]:not([data-local]), #enabled')) {
            const key = el.dataset.key || el.name || el.id;
            let expected = key.split('.').reduce((s, k) => s?.[k], s);
            if (key.startsWith('nav.') && Object.hasOwn(GZ_NAV.dimensions(s.nav), key.slice(4))) expected = GZ_NAV.dimensions(s.nav)[key.slice(4)];
            if (el.type === 'radio') { if (key === 'card.pet' && expected !== 'none') expected = 'selected'; if (el.checked !== (String(expected) === el.value)) differences.push(key); }
            else if (el.type === 'checkbox' ? el.checked !== expected : el.value !== String(expected)) differences.push(key);
          }
          return differences;
        });
        assert.deepEqual(differences, []);
      });
    }
    await check('Blackboard card preview follows edited and reset settings', async () => {
      await page.evaluate(async () => {
        await chrome.storage.sync.clear();
        await chrome.storage.sync.set({ card: { width: 400, gap: 30, radius: 25, height: 200, hover: 'glow', particles: 'snow', condensed: true, overlay: false } });
      });
      await open('courses/cards');
      const preview = page.frameLocator('#preview');
      await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.documentElement.dataset.previewReady, null, { timeout: 5000 });
      const state = () => preview.locator('html').evaluate((html) => ({
        width: html.style.getPropertyValue('--gz-card-w'), gap: html.style.getPropertyValue('--gz-card-gap'),
        radius: html.style.getPropertyValue('--gz-card-r'), height: html.style.getPropertyValue('--gz-card-h'),
        hover: html.getAttribute('data-gz-card-hover'), particles: html.getAttribute('data-gz-card-particles'),
        condensed: html.hasAttribute('data-gz-card-condensed'), plain: html.hasAttribute('data-gz-card-plain'),
      }));
      await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.documentElement.style.getPropertyValue('--gz-card-w') === '400px', null, { timeout: 5000 }).catch(async (error) => {
        const saved = await page.evaluate(async () => (await GZ_UI.load()).card);
        const runtime = await preview.locator('html').evaluate(() => ({ card: GZ_CTX.settings().card, enabled: GZ_CTX.settings().enabled, on: GZ_CTX.on() }));
        throw new Error(`${error.message}; saved=${JSON.stringify(saved)}; runtime=${JSON.stringify(runtime)}; preview=${JSON.stringify(await state())}`);
      });
      assert.deepEqual(await state(), { width: '400px', gap: '30px', radius: '25px', height: '200px', hover: 'glow', particles: 'snow', condensed: true, plain: true });
      await page.locator('[data-key="card.condensed"]').uncheck();
      await page.waitForFunction(() => !document.querySelector('#preview').contentDocument.documentElement.hasAttribute('data-gz-card-condensed'));
      await page.locator('[data-reset-section="courses/cards"]').click();
      await page.waitForFunction(() => document.querySelector('#preview').contentDocument.documentElement.style.getPropertyValue('--gz-card-w') === '262px');
      assert.deepEqual(await state(), { width: '262px', gap: 'initial', radius: 'initial', height: '146px', hover: 'lift', particles: 'none', condensed: false, plain: false });
    });
  } finally {
    try { await context?.close(); }
    finally { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); if (held) fs.rmSync(lock, { recursive: true, force: true }); }
    const out = process.argv[2];
    if (out) fs.writeFileSync(fs.existsSync(out) && fs.statSync(out).isDirectory() ? path.join(out, 'settings-wiring.json') : out, JSON.stringify(results, null, 2));
  }
  console.log(`${results.filter((x) => x.ok).length}/${results.length} settings wiring checks passed`);
  process.exitCode = results.some((x) => !x.ok) ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
