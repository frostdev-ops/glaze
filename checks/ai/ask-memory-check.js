// Focused Ask memory view check in Chromium, with a synthetic worker transport. The real chat and shared Ask sheet run;
// no school, provider, stored user data, server or extension permissions are used. The worker broker has separate tests.
// glaze-remote -e TZ=UTC -o <evidence dir> -- node checks/ai/ask-memory-check.js /out
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../extension'), out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'glaze-ask-memory'));
const ID = `m-${'1'.repeat(32)}`, SOURCE = `s-${'2'.repeat(32)}`, REV = 'a'.repeat(32), NEXT = 'b'.repeat(32);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const results = [];
(async () => {
  let browser;
  fs.mkdirSync(out, { recursive: true });
  try {
    browser = await chromium.launch({ ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true });
    for (const variant of ['dialog', 'tile']) for (const width of [1280, 320]) for (const dark of [false, true]) {
      const name = `${variant}-${width}-${dark ? 'dark' : 'light'}`, page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
      try {
        await page.route('**/*', (route) => route.abort());
        await page.setContent('<!doctype html><html lang="en"><head><title>Ask memory check</title></head><body></body></html>');
        await page.addStyleTag({ content: read('core/page/apps.css') });
        await page.addStyleTag({ content: `html { --gz-font: system-ui,sans-serif; --gz-font-head: system-ui,sans-serif; --gz-accent: ${dark ? '#9ec5ff' : '#215b9d'}; --gz-ink: ${dark ? '#f3f4f7' : '#17202b'}; --gz-ink-muted: ${dark ? '#bbc2cb' : '#4b5665'}; --gz-surface: ${dark ? '#202630' : '#ffffff'}; --gz-surface-2: ${dark ? '#303845' : '#edf1f7'}; --gz-line: ${dark ? '#5b6573' : '#acb8c7'}; --gz-line-strong: ${dark ? '#7b8797' : '#8596aa'}; --gz-radius: 14px; --gz-err: ${dark ? '#ffb0a8' : '#a6271d'}; } body { margin: 0; padding: 12px; box-sizing: border-box; background: ${dark ? '#10151c' : '#e9edf3'}; } #gz-ask { margin: auto; } .gz-ask-tile { width: min(700px,100%); height: 750px; max-height: calc(100vh - 24px); margin: auto; color: var(--gz-ink); background: var(--gz-surface); border: 1px solid var(--gz-line); border-radius: 14px; overflow: hidden; }` });
        await page.evaluate(({ ID, REV }) => {
          window.requests = []; window.messages = []; window.ports = [];
          window.response = async (message) => message.op === 'read' ? { ok: true, record: { id: ID, revision: REV, kind: 'memory', markdown: 'Prefer short explanations with one example.' } } : { ok: false, error: 'conflict' };
          window.GZ_CTX = { t: (k) => k, locale: () => 'en', on: () => true, settings: () => ({ enabled: true }) };
          window.chrome = { storage: { local: { get: (_, cb) => cb({ ai: { on: true, features: { ask: true } } }) } }, runtime: {
            sendMessage: async (message) => { window.requests.push(message); return window.response(message); },
            connect: () => { const listeners = []; const port = { onMessage: { addListener: (fn) => listeners.push(fn) }, onDisconnect: { addListener() {} }, disconnect() {}, postMessage(message) { window.messages.push(message); if (message.op === 'status') queueMicrotask(() => this.emit({ id: message.id, type: 'status', ready: true })); }, emit(message) { for (const listener of listeners) listener(message); } }; window.ports.push(port); return port; },
          } };
        }, { ID, REV });
        await page.addScriptTag({ content: read('ai/page/ask-chat.js') });
        await page.evaluate((variant) => {
          const host = document.createElement(variant === 'dialog' ? 'dialog' : 'section');
          if (variant === 'dialog') host.id = 'gz-ask'; else host.className = 'gz-ask-tile';
          document.body.append(host); window.chat = GZ_ASK_CHAT.mount(host, { variant }); if (variant === 'dialog') host.showModal();
          window.chat.ask({ question: 'Help me study.' });
        }, variant);
        await page.waitForFunction(() => window.messages.some((m) => m.op === 'ask'));
        await page.evaluate(({ ID, SOURCE, REV }) => {
          const id = window.messages.find((m) => m.op === 'ask').id, port = window.ports.at(-1);
          port.emit({ id, type: 'recall', records: [{ id: ID, revision: REV, kind: 'memory', text: 'Prefer short explanations with one example.' }, { id: SOURCE, revision: REV, kind: 'course', text: '<h1>Cell notes</h1>\nA long_word_'.repeat(12), source: { title: 'Biology notes', complete: false } }], truncated: true });
          port.emit({ id, type: 'memory', receipt: { operation: 'created', id: ID, revision: REV, at: 1793577600000, text: 'Prefer short explanations with one example.', persistence: 'device' } });
          port.emit({ id, type: 'error', error: 'invalid-response' });
        }, { ID, SOURCE, REV });
        await page.locator('.gz-ask-memory').waitFor();
        await page.getByText('Memory used', { exact: true }).click();
        await page.getByText('Memory saved on this device', { exact: true }).click();
        assert.equal(await page.locator('.gz-ask-recall h1').count(), 0, 'recall markup is literal');
        assert.equal(await page.locator('.gz-ask-err').count(), 1, 'receipt survives answer failure');
        await page.locator('.gz-ask-memory-edit').click();
        const input = page.locator('.gz-ask-memory-input'); await input.waitFor();
        await input.fill('Keep this unsaved draft when another device changes the memory.');
        await page.locator('.gz-ask-memory-save').click();
        await page.getByText('This memory changed. Reload it before saving.', { exact: true }).waitFor();
        assert.equal(await input.inputValue(), 'Keep this unsaved draft when another device changes the memory.');
        assert.equal(await input.getAttribute('writingsuggestions'), 'false');
        const overflow = await page.evaluate(() => [...document.querySelectorAll('.gz-ask-memory,.gz-ask-recall,.gz-ask-memory-input')].map((el) => ({ cls: el.className, over: el.scrollWidth > el.clientWidth + 1 })).filter((x) => x.over));
        assert.deepEqual(overflow, [], 'memory content fits the available width');
        await page.screenshot({ path: path.join(out, `ask-memory-${name}.png`), fullPage: true });
        await page.locator('.gz-ask-memory-cancel').click();
        await page.evaluate(({ ID, NEXT }) => { window.response = async () => ({ ok: true, receipt: { operation: 'forgotten', id: ID, revision: NEXT, at: 1793577600001, persistence: 'device' } }); }, { ID, NEXT });
        await page.locator('.gz-ask-memory-delete').click();
        await page.getByText('Memory deleted', { exact: true }).waitFor();
        assert.equal(await page.locator('.gz-ask-memory pre').count(), 0);
        const requests = await page.evaluate(() => window.requests);
        assert.ok(requests.every((m) => m.type === 'glaze:memory' && !Object.hasOwn(m, 'account')));
        results.push({ name, ok: true }); console.log(`ok ${name}`);
      } catch (error) { results.push({ name, ok: false, error: error.stack }); console.error(`FAIL ${name}: ${error.stack}`); }
      finally { await page.close(); }
    }
  } finally {
    await browser?.close();
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  }
  if (results.some((r) => !r.ok)) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
