// Memory settings UI against the real options page with a synthetic checked-broker stand-in (root integration checks the
// real worker separately). No live LMS data/network. AI and Memory off, safe Markdown, edit/conflict, account grouping,
// saved-only export, separate cache clear, keyboard/caret and 320px layout; light/dark evidence. Owned browser is closed.
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../../tools/dev/check-env.js'), root = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let context, scratch, total = 0;
const M = 'm-' + 'a'.repeat(32), N = 'm-' + 'b'.repeat(32), S = 's-' + 'c'.repeat(32), R = '1'.repeat(32);
const fixtures = [
  { v: 1, id: M, kind: 'memory', account: 'https://courses.example.test/42', revision: R, createdAt: 1, updatedAt: 2, markdown: 'I prefer concise answers and numbered steps.\n\nUse **plain language**.' },
  { v: 1, id: N, kind: 'memory', account: 'https://courses.example.test/73', revision: R, createdAt: 1, updatedAt: 2, markdown: 'I study ecology. <img src=x onerror=alert(1)>' },
  { v: 1, id: S, kind: 'course', account: 'https://courses.example.test/42', revision: R, createdAt: 1, updatedAt: 2, markdown: '# Field observations\n\n- Record the habitat.\n- Compare the samples.', source: { type: 'course-read', tool: 'course_content_read', title: 'Week 2: Field observations', observedAt: 1793577600000, complete: false } },
];
const stand = ({ fixtures }) => {
  if (!globalThis.chrome?.runtime || location.protocol !== 'chrome-extension:') return;
  const state = globalThis.memoryUi = { enabled: false, records: structuredClone(fixtures), sent: [] };
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = async (m, ...rest) => {
    if (m?.type !== 'glaze:memory') return original(m, ...rest);
    state.sent.push(structuredClone(m));
    if (m.op === 'state') return { ok: true, enabled: state.enabled };
    if (m.op === 'list') return { ok: true, records: structuredClone(state.records.filter((r) => r.kind === m.kind)) };
    if (m.op === 'settings') { state.enabled = m.enabled; return { ok: true, enabled: state.enabled }; }
    if (m.op === 'export') return { ok: true, markdown: '# Saved memories\n\n' + state.records.filter((r) => r.kind === 'memory').map((r) => r.markdown).join('\n\n') };
    if (m.op === 'clear') { state.records = state.records.filter((r) => !m.records.some((s) => r.id === s.id && r.revision === s.revision)); return { ok: true }; }
    const record = state.records.find((r) => r.id === m.id);
    if (!record) return { ok: false, error: 'not-found' };
    if (record.revision !== m.revision) return { ok: false, error: 'conflict' };
    if (m.op === 'update') Object.assign(record, { markdown: m.markdown, revision: '2'.repeat(32), edited: true });
    if (m.op === 'forget') state.records = state.records.filter((r) => r.id !== m.id);
    return { ok: true, receipt: { id: m.id, revision: '2'.repeat(32), operation: m.op === 'update' ? 'updated' : 'forgotten', persistence: 'device' } };
  };
};
async function pass(scheme) {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-memory-check-'));
  try {
    const ext = env.staged(root, [], scratch);
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: scheme,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--proxy-server=http://127.0.0.1:0', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    env.noFirstRun(context);
    await context.route('**/*', (r) => new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort());
    await context.addInitScript(stand, { fixtures });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#ai/memory`, { waitUntil: 'domcontentloaded' });
    await env.installed(page);
    await page.locator('#memory-memory-list .memory-record').nth(1).waitFor();
    await page.evaluate(async () => chrome.storage.sync.set({ auto: { ...GZ_SANITIZE().auto, on: true, mode: 'device' } }));
    const saved = page.locator(`[data-memory-id="${M}"]`), cache = page.locator(`[data-memory-id="${S}"]`);
    const check = async (name, action) => { await action(); total++; console.log(`ok ${scheme} ${name}`); };
    const shoot = async (name) => { if (!shots) return; fs.mkdirSync(shots, { recursive: true }); await page.locator('#ai-memory').screenshot({ path: path.join(shots, `memory-${name}-${scheme}.png`) }); };
    await check('AI and Memory off keep record controls available', async () => {
      assert.equal(await page.locator('#ai-on').isChecked(), false);
      assert.equal(await page.locator('#memory-on').isChecked(), false);
      assert.equal(await page.locator('#memory-export').isEnabled(), true);
      assert.equal(await page.locator('#memory-memory-list img').count(), 0);
      assert.equal(await page.locator('#memory-memory-list .memory-account').count(), 2);
      assert.match(await cache.innerText(), /Partial/);
      await cache.locator('summary').click(); assert.match(await cache.innerText(), /Compare the samples/);
      await shoot('off');
    });
    await check('edit preserves draft and caret during a broker refresh', async () => {
      const refresh = async () => {
        const before = await page.evaluate(() => memoryUi.sent.filter((m) => m.op === 'list' && m.kind === 'memory').length);
        await page.evaluate((value) => chrome.storage.local.set({ 'rimeMemory:synthetic-not-a-record': value }), before);
        await page.waitForFunction((count) => memoryUi.sent.filter((m) => m.op === 'list' && m.kind === 'memory').length > count, before);
      };
      await saved.getByRole('button', { name: 'Edit', exact: true }).focus(); await refresh();
      assert.equal(await saved.getByRole('button', { name: 'Edit', exact: true }).evaluate((e) => document.activeElement === e), true);
      await cache.locator('summary').focus(); await refresh();
      assert.equal(await cache.locator('summary').evaluate((e) => document.activeElement === e), true);
      await saved.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.locator('#memory-edit-text').fill('Use numbered steps.');
      await page.locator('#memory-edit-text').evaluate((e) => e.setSelectionRange(4, 8));
      await refresh();
      assert.equal(await page.locator('#memory-edit-text').inputValue(), 'Use numbered steps.');
      assert.equal(await page.locator('#memory-edit-text').evaluate((e) => e.selectionStart), 4);
      await saved.getByRole('button', { name: 'Save', exact: true }).click();
      await saved.locator('pre').waitFor(); assert.match(await saved.innerText(), /Use numbered steps/);
      assert.equal(await saved.getByRole('button', { name: 'Edit', exact: true }).evaluate((e) => document.activeElement === e), true);
    });
    await check('conflict preserves draft until explicit Reload', async () => {
      await saved.getByRole('button', { name: 'Edit', exact: true }).click(); await page.locator('#memory-edit-text').fill('Unsaved draft');
      await page.evaluate((id) => Object.assign(memoryUi.records.find((r) => r.id === id), { revision: '3'.repeat(32), markdown: 'Updated on another device.' }), M);
      await saved.getByRole('button', { name: 'Save', exact: true }).click();
      await saved.getByRole('button', { name: 'Reload', exact: true }).waitFor();
      assert.equal(await page.locator('#memory-edit-text').inputValue(), 'Unsaved draft');
      await shoot('conflict'); await saved.getByRole('button', { name: 'Reload', exact: true }).click();
      assert.equal(await page.locator('#memory-edit-text').inputValue(), 'Updated on another device.');
      await saved.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await saved.getByRole('button', { name: 'Edit', exact: true }).evaluate((e) => document.activeElement === e), true);
    });
    await check('saved Markdown export excludes course cache', async () => {
      const download = page.waitForEvent('download'); await page.locator('#memory-export').click(); const result = await download;
      assert.equal(result.suggestedFilename(), 'glaze-memories.md');
      const content = fs.readFileSync(await result.path(), 'utf8');
      assert.match(content, /Updated on another device/); assert.doesNotMatch(content, /Compare the samples/);
    });
    await check('320px layout and cache clear dialog', async () => {
      await page.setViewportSize({ width: 320, height: 1000 });
      await page.locator('#ai-memory').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.ok(await cache.locator('summary > span').evaluate((e) => e.getBoundingClientRect().width) > 160, 'course title keeps a readable column');
      await shoot('narrow');
      await page.locator('#memory-course-clear').click(); await page.locator('#memory-clear-ask').waitFor();
      assert.equal(await page.locator('#memory-clear-cancel').evaluate((e) => document.activeElement === e), true);
      await page.keyboard.press('Escape'); assert.equal(await cache.count(), 1);
      await page.locator('#memory-course-clear').click(); await page.locator('#memory-clear-ask button[value="ok"]').click();
      await page.locator('#memory-course-empty').waitFor(); assert.equal(await saved.count(), 1);
      await page.waitForFunction(() => !document.getElementById('memory-course-clear').disabled);
      assert.equal(await page.locator('#memory-course-clear').evaluate((e) => document.activeElement === e), true);
      await page.locator('#memory-course-clear').click(); await page.locator('#memory-clear-ask button[value="ok"]').click();
      await page.waitForFunction(() => memoryUi.sent.filter((m) => m.op === 'clear' && m.kind === 'course').length === 2);
      assert.deepEqual(await page.evaluate(() => memoryUi.sent.filter((m) => m.op === 'clear' && m.kind === 'course').at(-1).records), []);
    });
    await check('Memory switch uses the worker and page has no errors', async () => {
      await page.locator('#memory-on').click();
      for (let end = Date.now() + 5000; ;) {
        if (await page.evaluate(() => memoryUi.enabled)) break;
        if (Date.now() > end) throw new Error('switch did not save'); await wait(20);
      }
      assert.deepEqual(errors, []);
    });
  } finally { await context?.close(); context = null; fs.rmSync(scratch, { recursive: true, force: true }); scratch = null; }
}
(async () => { for (const scheme of ['light', 'dark']) await pass(scheme); console.log(`${total}/${total} memory UI browser checks passed`); })()
  .catch((e) => { console.error(e.stack); process.exitCode = 1; })
  .finally(async () => { await context?.close(); if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); });
