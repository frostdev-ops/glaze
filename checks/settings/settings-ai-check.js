// Settings → AI against the unpacked extension: an older store read as its provider, Connect, a refused key, the model
// picker and the effort a model takes, a feature's own model, Advanced's endpoint and tuning, AI off, and search; each
// state shot in light and dark, each scheme in a browser of its own since Settings paints its Look when it loads. The providers' servers are stand-ins (no network; OpenRouter's list is its own, as kept in
// test/fixtures), and the copy's manifest holds their hosts, which a headless browser couldn't grant.
// NODE_PATH=<playwright> nice -n 10 node scripts/settings-ai-check.js [shots folder]
// AI_CASE selects one check, AI_SCHEME one scheme ('light' or 'dark'); EXT selects the checkout under test.
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const env = require('./check-env.js');
const lock = require('./check-env.js').lockPath();
const shots = process.argv[2] ? path.resolve(process.argv[2]) : '';
const routed = fs.readFileSync(path.join(root, 'test/fixtures/openrouter-models.json'), 'utf8');
const KEY = 'sk-or-v1-0000synthetic0000000000000000000000000000000000000000000000';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// The stand-in servers: OpenRouter's key record and list, OpenAI's and Groq's ids, Anthropic refusing the key, Ollama's ids.
const ids = (list) => JSON.stringify({ object: 'list', data: list.map((id) => ({ id, object: 'model' })) });
const SERVERS = {
  'https://openrouter.ai/api/v1/key': [200, JSON.stringify({ data: { label: 'sk-or-v1-000...000' } })],
  'https://openrouter.ai/api/v1/models': [200, routed],
  'https://api.openai.com/v1/models': [200, ids(['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'])],
  'https://api.groq.com/openai/v1/models': [200, ids(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'])],
  'https://api.anthropic.com/v1/models?limit=1000': [401, JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })],
  'http://localhost:11434/v1/models': [200, ids(['qwen2.5-coder:7b', 'llama3.2:3b', 'gpt-oss:20b'])],
};
const HOSTS = ['https://openrouter.ai/*', 'https://api.openai.com/*', 'https://api.groq.com/*', 'https://api.anthropic.com/*', 'http://localhost/*'];
let context, scratch, held = false, total = 0, failed = 0, page;
const check = async (name, test) => {
  if (process.env.AI_CASE && process.env.AI_CASE !== name) return;
  total++;
  try { await test(); console.log(`ok ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); if (shots) await page?.screenshot({ path: path.join(shots, `failed-${name}.png`), fullPage: true }).catch(() => {}); }
};
(async () => {
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; }
      catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nsettings-ai-check\n`);
    for (const scheme of process.env.AI_SCHEME ? [process.env.AI_SCHEME] : ['light', 'dark']) await pass(scheme);
  } finally {
    await context?.close();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} Settings → AI browser checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });

// Every check in one color scheme, in a fresh browser and profile.
async function pass(scheme) {
  try {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-settings-ai-check-'));
    const ext = env.staged(root, HOSTS, scratch);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 3000 }, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: scheme,
      // Routing supplies every response; a missed route (including a worker's) cannot reach a real provider.
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking',
        '--proxy-server=http://127.0.0.1:0', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    env.noFirstRun(context);
    const served = [];
    await context.route('**/*', (r) => {
      const url = r.request().url();
      if (new URL(url).protocol === 'chrome-extension:') return r.continue();
      const s = SERVERS[url];
      if (!s) return r.abort();
      served.push([url, r.request().headers()]);
      return r.fulfill({ status: s[0], contentType: 'application/json', body: s[1] });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', (e) => console.error(`[page error] ${e.message}`));
    const open = async () => {
      // The same address with its hash would only scroll: a fresh page each time.
      await page.goto('about:blank');
      await page.goto(`${base}/options.html#ai/setup`);
      await page.locator('#ai-on').waitFor({ state: 'attached' });
      await pause(300);
    };
    // The worker's own store, as an older Settings left it.
    const older = (connections) => page.evaluate(async (all) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('glaze-ai', 1); r.onupgradeneeded = () => r.result.createObjectStore('vault'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      await new Promise((res, rej) => { const t = db.transaction('vault', 'readwrite'); t.objectStore('vault').put(all, 'connections'); t.oncomplete = res; t.onerror = () => rej(t.error); });
      db.close();
    }, connections);
    const stored = () => page.evaluate(async () => ({ ai: (await chrome.storage.local.get('ai')).ai, get: await chrome.runtime.sendMessage({ type: 'glaze:ai-config', op: 'get' }) }));
    // The panel from the page's top, so Settings' bar never covers it.
    const shoot = async (name) => {
      if (!shots) return;
      fs.mkdirSync(shots, { recursive: true });
      await page.evaluate(() => scrollTo(0, 0));
      await pause(250);
      await page.locator('#panel-ai').screenshot({ path: path.join(shots, `settings-${name}-${scheme}.png`) });
    };
    const now = Date.now();
    const CALLS = [
      { id: 'a', task: 'writer.feedback', feature: 'writing', provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', state: 'completed', startedAt: now - 60000, ms: 4000, usage: { input: 3000, output: 410 } },
      { id: 'b', task: 'writer.complete', feature: 'completion', provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', state: 'completed', startedAt: now - 180000, ms: 900, usage: { input: 2700, output: 260 }, count: 38 },
    ];

    await check('migration', async () => {
      await open();
      // The Look follows the system's light or dark (Paper and Frost), so each state is shot in both.
      await page.evaluate(async () => chrome.storage.sync.set({ auto: { ...GZ_SANITIZE().auto, on: true, mode: 'device' } }));
      await page.evaluate(async (calls) => chrome.storage.local.set({ ai: { on: true, use: 'endpoint', features: { syllabus: true, completion: true, writing: true } }, aiCalls: calls }), CALLS);
      await older({ endpoint: { provider: 'openai', base: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v4.1-flash-1017', key: KEY, generation: 'g-1' } });
      await open();
      await page.locator('#ai-providers .ai-prov', { hasText: 'OpenRouter' }).locator('.st.ok').waitFor();
      const s = await stored();
      assert.deepEqual(s.ai.model, { use: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017' });
      assert.deepEqual(s.ai.features, { syllabus: true, completion: true, writing: true });
      assert.deepEqual(Object.keys(s.get.connections).sort(), ['openrouter']);
      assert.ok(!JSON.stringify(s).includes(KEY), 'the key never comes back');
      await page.locator('#ai-pick-model').getByText('DeepSeek V4.1 Flash 1017').waitFor();
      await page.locator('#ai-feature-list .ai-feat').first().locator('.ai-effort').waitFor();
      // Its catalog says Off, Low and High.
      assert.deepEqual(await page.locator('#ai-feature-list .ai-feat').first().locator('.ai-effort .stops button').allTextContents(), ['Off', 'Low', 'High']);
      const effort = page.locator('#ai-feature-list .ai-feat').first().locator('.ai-effort');
      assert.equal(await effort.getByRole('radio', { checked: true }).innerText(), 'High');
      const thumb = effort.locator('.thumb');
      assert.ok(await thumb.isVisible(), 'the effort in effect has a thumb before an override is saved');
      const geometry = await effort.evaluate((e) => {
        const thumb = e.querySelector('.thumb').getBoundingClientRect(), track = e.querySelector('.track').getBoundingClientRect();
        return { center: thumb.x + thumb.width / 2, end: track.right, width: thumb.width };
      });
      assert.ok(geometry.width > 0 && Math.abs(geometry.center - geometry.end) < 1, 'High is drawn at the end of the track');
      await shoot('connected');
    });

    await check('connect', async () => {
      await page.locator('#ai-providers .ai-prov', { hasText: 'OpenAI' }).click();
      await page.locator('#ai-key').fill('sk-proj-0000synthetic00000000000000');
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await page.locator('#ai-providers .ai-prov', { hasText: 'OpenAI' }).locator('.st.ok').waitFor();
      assert.ok(served.some(([u, h]) => u === 'https://api.openai.com/v1/models' && h.authorization === 'Bearer sk-proj-0000synthetic00000000000000'));
      assert.equal((await stored()).get.connections.openai.key, 'sk-p••••0000');
      await page.locator('#ai-providers .ai-prov', { hasText: 'Groq' }).click();
      await page.locator('#ai-key').fill('gsk_0000synthetic0000000000000000');
      await page.locator('#ai-key').press('Enter');
      await page.locator('#ai-providers .ai-prov', { hasText: 'Groq' }).locator('.st.ok').waitFor();
    });

    await check('keyerror', async () => {
      await page.locator('#ai-providers .ai-prov', { hasText: 'Anthropic' }).click();
      await page.locator('#ai-key').fill('sk-ant-api03-0000synthetic000000');
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await page.getByText('Key refused · HTTP 401').waitFor();
      const asked = served.findLast(([u]) => u.startsWith('https://api.anthropic.com/'));
      assert.equal(asked[1]['x-api-key'], 'sk-ant-api03-0000synthetic000000');
      await page.locator('#ai-providers .ai-prov', { hasText: 'Anthropic' }).locator('.st.bad').waitFor();
      await shoot('keyerror');
      await page.locator('#ai-providers .ai-prov', { hasText: 'Anthropic' }).click();
    });

    await check('picker', async () => {
      // Tab completion on its own model: Groq's.
      await page.locator('#ai-pick-completion').click();
      await page.locator('.ai-picker .side button', { hasText: 'Groq' }).click();
      await page.locator('.ai-picker li', { hasText: 'llama-3.3-70b-versatile' }).click();
      // Feedback on OpenAI's GPT-5 mini, with its four efforts, Low chosen.
      await page.locator('#ai-pick-writing').click();
      await page.locator('.ai-picker .side button', { hasText: 'OpenAI' }).click();
      await page.locator('#ai-pick-search').fill('gpt-5-mini');
      await page.locator('#ai-pick-search').press('ArrowDown');
      await page.locator('#ai-pick-search').press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'ai-pick-writing', 'choosing gives focus back to its button');
      const row = page.locator('#ai-feature-list .ai-feat').nth(2);
      await row.locator('.ai-effort').waitFor();
      assert.deepEqual(await row.locator('.ai-effort .stops button').allTextContents(), ['Default', 'Minimal', 'Low', 'Medium', 'High']);
      await row.getByRole('radio', { name: 'Low' }).click();
      await pause(200);
      const s = (await stored()).ai;
      assert.deepEqual(s.models, { completion: { use: 'groq', model: 'llama-3.3-70b-versatile' }, writing: { use: 'openai', model: 'gpt-5-mini', effort: 'low' } });
      assert.equal(await page.locator('#ai-feature-list .ai-feat').nth(1).locator('.ai-effort').count(), 0, 'a model with no effort control hides the slider');
      await shoot('split');
      await page.locator('#ai-pick-writing').click();
      await page.locator('.ai-picker').waitFor();
      assert.equal(await page.locator('.ai-picker').evaluate((e) => getComputedStyle(e).animationName), 'none', 'reduced motion: no pop');
      await shoot('picker');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.ai-picker').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'ai-pick-writing', 'Escape gives focus back');
    });

    await check('advanced', async () => {
      await page.locator('label', { hasText: 'Advanced' }).click();
      await page.locator('#ai-providers .ai-prov.add').click();
      await page.getByRole('button', { name: 'Ollama' }).click();
      await page.getByRole('button', { name: 'Save' }).click();
      await page.getByText('3 models').waitFor();
      const s = await stored();
      assert.deepEqual([s.get.connections['custom-1'].name, s.get.connections['custom-1'].base], ['Ollama', 'http://localhost:11434/v1']);
      await page.locator('#ai-pick-completion').click();
      await page.locator('.ai-picker .side button', { hasText: 'Ollama' }).click();
      await page.locator('.ai-picker li', { hasText: 'qwen2.5-coder:7b' }).click();
      assert.equal(await page.locator('#ai-tune-completion-pause').count(), 1, 'tab completion has its pause');
      assert.equal(await page.locator('#ai-tune-writing-pause').count(), 0);
      await page.locator('#ai-tune-completion-temperature').fill('2');
      await page.locator('#ai-tune-completion-temperature').dispatchEvent('change');
      await pause(200);
      assert.deepEqual((await stored()).ai.tune, { completion: { temperature: 0.2 } });
      // Saved, its drawer stays open.
      assert.equal(await page.locator('#ai-providers .ai-prov', { hasText: 'Ollama' }).getAttribute('aria-expanded'), 'true');
      await shoot('advanced');
      await page.locator('#ai-providers .ai-prov', { hasText: 'Ollama' }).click();
      await page.locator('label', { hasText: 'Simple' }).click();
      await page.locator('.ai-tune').first().waitFor({ state: 'detached' });
      assert.equal(await page.locator('.ai-tune').count(), 0, 'Simple shows no tuning');
      assert.equal(await page.locator('#ai-providers .ai-prov', { hasText: 'Ollama' }).count(), 0, 'nor endpoints');
    });

    await check('device', async () => {
      await page.locator('#ai-providers .ai-prov', { hasText: 'Chrome on-device AI' }).click();
      await page.locator('#ai-drawer .note').filter({ hasText: /\S/ }).waitFor();
      await shoot('device');
      await page.locator('#ai-providers .ai-prov', { hasText: 'Chrome on-device AI' }).click();
    });

    await check('search', async () => {
      for (const [words, id] of [['tab completion', '#ai-features'], ['effort', '#ai-features'], ['providers', '#ai'], ['activity', '#ai-activity']]) {
        await page.locator('#find').fill(words);
        await pause(150);
        assert.ok(await page.locator(id).isVisible(), `${words} finds ${id}`);
      }
      await page.locator('#find').fill('');
    });

    await check('empty', async () => {
      await page.evaluate(async () => { await chrome.storage.local.set({ ai: { on: true, features: {} }, aiCalls: [] }); for (const id of ['openrouter', 'openai', 'groq', 'anthropic', 'custom-1']) await chrome.runtime.sendMessage({ type: 'glaze:ai-config', op: 'remove', id }); });
      await open();
      assert.ok(await page.locator('#ai-pick-model.none').isVisible());
      await shoot('empty');
    });

    await check('off', async () => {
      await page.evaluate(async (calls) => chrome.storage.local.set({ ai: { on: false }, aiCalls: calls }), CALLS);
      await open();
      assert.ok(!await page.locator('#ai-connection').isVisible() && !await page.locator('#ai-features').isVisible());
      assert.ok(await page.locator('#ai-activity').getByText('Feedback · OpenRouter · deepseek/deepseek-v4.1-flash-1017').isVisible());
      await shoot('off');
    });
  } finally {
    await context?.close();
    context = null;
    fs.rmSync(scratch, { recursive: true, force: true });
    scratch = '';
  }
}
