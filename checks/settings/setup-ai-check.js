// The setup wizard's AI step (settings/welcome.html#/ai, settings/setup-ai.js) in headless Chrome with the real unpacked
// extension: Off is the default and nothing is written to storage.local `ai` until a choice; Rime picked starts its download
// from the click with its ring on the card; the feature switches, each read back from storage; a named provider's key
// connected, kept masked and its model suggested; the arrow keys; back to Off, and the done step's row. Rime is offered as a
// signed list offers it (the store's state written as an accepted list leaves it, as settings-ai-check does) and its download
// never runs: the page's prepare is answered by the check, which then sends the worker's progress events itself. The browser's
// own model says it needs a download (the check answers its status), so its card shows. OpenAI's server is a stand-in and
// the staged copy holds its host. Screenshots wide (1440×900) and narrow (390×844), dark and light, and with motion off.
// NODE_PATH=<installed playwright> node checks/settings/setup-ai-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('../../tools/dev/check-env.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-setup-ai-'));
const ext = env.staged(process.env.EXT || path.join(__dirname, '../../extension'), ['https://api.openai.com/*'], tmp);
const out = process.argv[2] || path.join(tmp, 'shots');
fs.mkdirSync(out, { recursive: true });
const LISTED = require('../../test/fixtures/ai/rime-list-entries.json').models;
const KEY = 'sk-proj-SYNTHETICWIZARD000000000000000000000000';
const ids = (list) => JSON.stringify({ object: 'list', data: list.map((id) => ({ id, object: 'model' })) });
const SERVERS = { 'https://api.openai.com/v1/models': [200, ids(['gpt-5', 'gpt-5-mini', 'gpt-4.1'])] };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
// What sticks out past the page's right edge, for a failure's message.
const wide = (page) => page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5 && e.getClientRects().length)
  .slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}:${Math.round(e.getBoundingClientRect().right)}`).join(' '));
const fits = async (page) => (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) || `${await wide(page)}`;
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await pause(100); } };

// Before the page's own scripts: the AI messages it sends, recorded by op (never a key), Rime's and the browser's model's
// downloads held by the check, and the browser's model's status answered as one that needs a download.
const stub = () => {
  globalThis.__ai = { sent: [] };
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...rest) => {
    if (m?.type === 'glaze:ai-config') {
      __ai.sent.push({ op: m.op, ...(m.id && { id: m.id }), ...(m.provider && { provider: m.provider }), activated: navigator.userActivation.isActive });
      if (m.op === 'prepare') return new Promise(() => {});
      if (m.provider === 'device' && m.op === 'test') return Promise.resolve({ ok: true, state: 'download' });
    }
    return send(m, ...rest);
  };
};

(async () => {
  let ctx;
  try {
    await require('../../tools/dev/wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    await ctx.addInitScript(stub);
    const missed = [];
    await ctx.route('**/*', (route) => {
      const url = route.request().url();
      if (new URL(url).protocol === 'chrome-extension:') return route.continue();
      const s = SERVERS[url];
      if (!s) { missed.push(url); return route.abort(); }
      return route.fulfill({ status: s[0], contentType: 'application/json', body: s[1] });
    });
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    const url = `${base}/settings/welcome.html`;
    const open = async (viewport, hash = '#/ai', motion = 'no-preference') => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' && !(m.text().startsWith('Failed to load resource') && !m.location().url.startsWith('chrome-extension:'))) errors.push(m.text()); });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto(url + hash);
      await page.locator('#ai-body .ai-choice').first().waitFor({ state: 'attached' });
      return page;
    };
    const stored = (page) => page.evaluate(async () => (await chrome.storage.local.get('ai')).ai);
    const checked = (page) => page.evaluate(() => document.querySelector('.ai-choice[aria-checked="true"]')?.dataset.choice);
    const words = (page, choice) => page.evaluate((c) => document.querySelector(`.ai-choice[data-choice="${c}"] .st`).textContent, choice);
    const sent = (page) => page.evaluate(() => __ai.sent);
    const shot = async (page, name) => { await pause(700); await page.screenshot({ path: path.join(out, `${name}.png`) }); };

    // Rime offered as an accepted signed list leaves the store, before any page asks.
    {
      const page = await open({ width: 1440, height: 900 }, '#/start');
      await env.installed(page);
      await page.evaluate(async (models) => {
        const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('glaze-models', { create: true });
        const w = await (await top.getFileHandle('~updates.json', { create: true })).createWritable();
        await w.write(JSON.stringify({ v: 1, serial: 1, issued: '2026-11-20T09:00:00Z', models, pins: {}, keep: {}, trial: null, failed: {} })); await w.close();
        const bus = new BroadcastChannel('glaze-models'); bus.postMessage({ type: 'catalog' }); bus.close();
      }, LISTED);
      await page.close();
    }

    const page = await open({ width: 1440, height: 900 });
    check(await checked(page) === 'off', 'Off is the default');
    check(await until(async () => await words(page, 'local') === '1.1 GB'), 'Rime shows its download\'s size');
    check(await until(async () => await words(page, 'device') === 'Needs a download') && await page.isVisible('.ai-choice[data-choice="device"]'), 'the browser\'s model shows where its status offers it');
    check(await stored(page) === undefined, 'nothing is written to ai before a choice');
    check(await page.isHidden('.ai-feats') && await page.isHidden('.ai-key'), 'with AI off, no features and no key');
    await shot(page, 'wide-dark-1-off');

    // Rime: its download from the click, its ring, its progress as the worker reports it.
    await page.click('.ai-choice[data-choice="local"]');
    check(await until(async () => (await stored(page))?.on === true && (await stored(page))?.model?.use === 'local'), 'Rime picked is saved: AI on, Rime the model');
    const prep = (await sent(page)).find((m) => m.op === 'prepare');
    check(prep?.provider === 'local' && prep.activated, 'its download starts from the click');
    check(await page.evaluate(() => document.querySelector('.ai-choice[data-choice="local"]').hasAttribute('data-loading')), 'its card shows the download under way');
    await worker.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:ai-config', event: 'progress', provider: 'local', loaded: 0.42 }).catch(() => {}));
    check(await until(async () => await words(page, 'local') === '42%'), 'its progress reaches the card');
    check(await page.evaluate(() => document.querySelector('.ai-choice[data-choice="local"] .arc').getAttribute('stroke-dashoffset')) === '58', 'and its ring');
    const feats = (await stored(page)).features;
    check(Object.values(feats).every((v) => v === false), `AI turned on turns no feature on, as in Settings (${JSON.stringify(feats)})`);
    check(await page.isVisible('.ai-feats'), 'the feature switches show once AI is on');
    await shot(page, 'wide-dark-2-rime');

    // The features, each read back.
    const flip = async (f, want) => {
      await page.click(`.ai-feats .switch[data-feature="${f}"]`);
      return until(async () => (await stored(page))?.features?.[f] === want && await page.evaluate((x) => document.querySelector(`.switch[data-feature="${x}"]`).getAttribute('aria-checked'), f) === String(want));
    };
    check(await flip('ask', true), 'Ask Rime turned on is saved');
    check(await flip('completion', true), 'Tab completion turned on is saved');
    check(await flip('ask', false), 'Ask Rime turned off again is saved');
    check(await page.evaluate(() => [...document.querySelectorAll('.ai-feats .switch')].map((b) => b.querySelector('.label').textContent).join()) === 'Ask Rime,Feedback,Tab completion,Syllabus import', 'the switches carry Settings\' names');
    await shot(page, 'wide-dark-3-features');

    // A provider's key: kept by the worker, shown back masked, its model chosen as Settings suggests.
    await page.click('.ai-choice[data-choice="key"]');
    check(await until(async () => (await stored(page))?.model?.use === null && (await stored(page))?.on === true), 'a key picked leaves Rime, AI still on');
    check(await page.isVisible('.ai-provs') && await page.isHidden('.ai-bar'), 'the providers show; the field waits for one');
    await shot(page, 'wide-dark-4-key');
    await page.click('.ai-prov[data-p="openai"]');
    check(await page.evaluate(() => document.activeElement?.id === 'ai-key' && document.querySelector('#ai-key').type === 'password'), 'a provider picked focuses its key field');
    await page.keyboard.press('Enter');
    check(await until(async () => await page.evaluate(() => document.querySelector('.ai-note').textContent) === 'Enter a key.'), 'an empty key is refused, with nothing sent');
    await page.fill('#ai-key', KEY);
    await page.keyboard.press('Enter');
    check(await until(async () => (await stored(page))?.model?.use === 'openai'), 'the key connected: OpenAI is the model');
    const ai = await stored(page);
    check(ai.model.model === 'gpt-5' && ai.models.completion?.model === 'gpt-5-mini', `with Settings' suggestion (${ai.model.model}, completion ${ai.models.completion?.model})`);
    check(await until(async () => await page.isVisible('.ai-bar .masked')), 'the key is shown back masked');
    const shown = await page.evaluate(() => document.querySelector('.ai-bar .masked').textContent);
    check(shown.includes('••••') && !(await page.content()).includes(KEY) && await page.inputValue('#ai-key') === '', `and never in full (${shown})`);
    check(await page.evaluate(() => document.querySelector('.ai-prov[data-p="openai"]').hasAttribute('data-connected')), 'its chip says it is connected');
    check(!missed.some((u) => u.includes('openai')), 'OpenAI reached only through the check\'s stand-in');
    await shot(page, 'wide-dark-5-key-connected');

    // The keyboard: arrows walk the choices and pick, as radios do.
    await page.focus('.ai-choice[data-choice="key"]');
    await page.keyboard.press('Home');
    check(await until(async () => (await stored(page))?.on === false) && await checked(page) === 'off' && await page.evaluate(() => document.activeElement?.dataset.choice === 'off'), 'Home goes back to Off and saves it');
    check((await stored(page)).model.use === 'openai', 'Off keeps the connection and the model, as Settings\' switch does');
    check(await page.isHidden('.ai-feats'), 'and hides the features');
    await shot(page, 'wide-dark-6-off-again');
    await page.evaluate(() => { location.hash = '#/done'; });
    check(await until(async () => await page.evaluate(() => document.querySelector('#summary dd[data-k="AI"]')?.textContent) === 'Off'), 'the done step lists AI as Off');
    await page.evaluate(() => { location.hash = '#/ai'; });
    await page.waitForFunction(() => !document.querySelector('#ai').hidden);
    await page.click('.ai-choice[data-choice="key"]');
    check(await until(async () => (await stored(page))?.on === true && (await stored(page))?.model?.use === 'openai'), 'the key again: its provider is still the model');
    await page.evaluate(() => { location.hash = '#/done'; });
    check(await until(async () => await page.evaluate(() => document.querySelector('#summary dd[data-k="AI"]')?.textContent) === 'OpenAI'), 'and the done step names it');
    await page.evaluate(() => { location.hash = '#/ai'; });
    await page.waitForFunction(() => !document.querySelector('#ai').hidden);
    await page.click('.ai-choice[data-choice="local"]');
    check(await until(async () => (await stored(page))?.model?.use === 'local'), 'Rime again');
    check(await page.evaluate(() => document.querySelectorAll('.ai-choice[role="radio"]').length === 4 && document.querySelector('.ai-choices').getAttribute('role') === 'radiogroup'
      && [...document.querySelectorAll('.ai-feats .switch')].every((b) => b.getAttribute('role') === 'switch')), 'a radio group and switches, each named');
    await page.close();

    const narrow = await open({ width: 390, height: 844 });
    // Rime chosen with nothing coming (the check held the first download): its card offers it, and starts it when clicked.
    check(await until(async () => await words(narrow, 'local') === 'Download · 1.1 GB'), 'Rime chosen but not downloading offers its download');
    await shot(narrow, 'narrow-dark-0-rime-resume');
    await narrow.click('.ai-choice[data-choice="local"]');
    check(await until(async () => (await sent(narrow)).some((m) => m.op === 'prepare' && m.provider === 'local' && m.activated)), 'and its card starts it');
    await shot(narrow, 'narrow-dark-1-rime');
    let fit = await fits(narrow);
    check(fit === true, `narrow: nothing runs off the side${fit === true ? '' : ` (${fit})`}`);
    await narrow.click('.ai-choice[data-choice="key"]');
    await narrow.waitForSelector('.ai-bar .masked', { state: 'visible' });
    await shot(narrow, 'narrow-dark-2-key');
    fit = await fits(narrow);
    check(fit === true, `narrow: the key's bar fits${fit === true ? '' : ` (${fit})`}`);
    await narrow.click('.ai-choice[data-choice="local"]');
    await until(async () => (await stored(narrow))?.model?.use === 'local');
    await narrow.close();

    // A light theme, then motion off.
    {
      const t = await open({ width: 1440, height: 900 }, '#/theme');
      await t.click('.look[data-look="Library"]');
      check(await until(async () => t.evaluate(() => document.documentElement.dataset.tone === 'light')), 'a light Look picked');
      await pause(800);
      await t.close();
    }
    const light = await open({ width: 1440, height: 900 });
    check(await until(async () => light.evaluate(() => document.documentElement.dataset.tone === 'light')), 'the step wears the light Look');
    await until(async () => await words(light, 'local') !== '');
    await shot(light, 'wide-light-1-rime');
    await light.click('.ai-choice[data-choice="key"]');
    await light.waitForSelector('.ai-bar .masked', { state: 'visible' });
    await shot(light, 'wide-light-2-key');
    await light.click('.ai-choice[data-choice="off"]');
    await until(async () => (await stored(light))?.on === false);
    await shot(light, 'wide-light-3-off');
    await light.click('.ai-choice[data-choice="local"]');
    await until(async () => (await stored(light))?.model?.use === 'local');
    await light.setViewportSize({ width: 390, height: 844 });
    await shot(light, 'narrow-light-1-rime');
    fit = await fits(light);
    check(fit === true, `narrow light: nothing runs off the side${fit === true ? '' : ` (${fit})`}`);
    await light.close();

    const calm = await open({ width: 1440, height: 900 }, '#/ai', 'reduce');
    check(await calm.evaluate(() => document.documentElement.getAttribute('data-gz-motion') === 'off'), 'reduced motion: the page\'s motion is off');
    const still = await calm.evaluate(() => [...document.querySelectorAll('.v-ai *')].every((e) => getComputedStyle(e).animationName === 'none'));
    check(still, 'motion off: the picture holds still');
    await shot(calm, 'wide-light-4-motion-off');
    await calm.setViewportSize({ width: 390, height: 844 });
    await shot(calm, 'narrow-light-2-motion-off');
    await calm.close();

    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(`${results.length} ok, screenshots in ${out}`);
  } catch (e) {
    console.error(e);
    if (errors.length) console.error('page errors:', errors.join('\n'));
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
