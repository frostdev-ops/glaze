// Settings → Writer against the unpacked extension, offline: each switch and select flipped and read back from storage.sync
// (writer, enhance.writer and writerUploads), numbers kept as numbers, a dictionary word removed with its ✕, one course's
// papers cleared behind the question (through the worker) and the rest kept, and the section shot in light and dark, each
// scheme in a browser of its own since Settings paints its Look when it loads.
// NODE_PATH=<playwright> nice -n 10 node scripts/settings-writer-check.js [shots folder]
// (default: none; the stream's evidence goes to glaze-plans/writer/mockups/settings-writer/shots). EXT selects the checkout.
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const env = require('./check-env.js');
const lock = require('./check-env.js').lockPath();
const shots = process.argv[2] ? path.resolve(process.argv[2]) : '';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 8000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const SCHOOL = 'bb.school.test', USER = '_900_1';
const key = (course, content) => `${SCHOOL}|${USER}|${course}|${content}`;
const PAPERS = [[key('_101_1', '_7_1'), 'ENG 101 · Composition I'], [key('_101_1', '_8_1'), 'ENG 101 · Composition I'], [key('_101_1', '_9_1'), 'ENG 101 · Composition I'],
  [key('_202_1', '_7_1'), 'HIS 210 · The Atlantic World'], [key('_303_1', '_4_1'), 'PSY 100 · Introduction to Psychology'], [key('_303_1', '_5_1'), 'PSY 100 · Introduction to Psychology']];
const WORDS = ['Morrison', 'Sethe', 'rememory', 'Okonkwo', 'Achebe', 'Nwoye'];
let context, scratch, held = false, total = 0, failed = 0, page;
const check = async (name, test) => {
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
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nsettings-writer-check\n`);
    for (const scheme of ['dark', 'light']) await pass(scheme);
  } finally {
    await context?.close().catch(() => {});
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} Settings → Writer browser checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });

async function pass(scheme) {
  try {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-settings-writer-check-'));
    const ext = env.staged(root, [], scratch);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 2600 }, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: scheme,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking',
        '--proxy-server=http://127.0.0.1:0', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    env.noFirstRun(context);
    await context.route('**/*', (r) => (new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort()));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const open = async () => {
      await page.goto('about:blank');
      await page.goto(`${base}/options.html#writer/setup`);
      await page.locator('#panel-writer').waitFor({ state: 'visible' });
      await until(() => page.evaluate(() => document.querySelectorAll('#writer-paper-list li').length > 0 && document.querySelectorAll('#writer-word-list li, #writer-words li').length > 0), 'papers and words drawn');
      await pause(300);
    };
    // The Look follows the system's light or dark (Paper and Frost); papers and words as Writer keeps them.
    await page.goto(`${base}/options.html`);
    await page.evaluate(async ({ papers, words }) => {
      await chrome.storage.sync.set({ auto: { ...GZ_SANITIZE().auto, on: true, mode: 'device' } });
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic paper text.' }] }] };
      const rows = papers.map(([key, course], i) => ({ key, title: `Paper ${i + 1}`, course, url: '', words: 3, format: 'mla9', updated: 1000 + i, submitted: null }));
      await chrome.storage.local.set({ writerPapers: rows, writerWords: words, ...Object.fromEntries(papers.map(([key]) => [`writerPaper:${key}`, { key, doc, revision: 1 }])) });
    }, { papers: PAPERS, words: WORDS });
    await open();
    const sync = () => page.evaluate(() => chrome.storage.sync.get(['writer', 'enhance']));
    const at = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
    const D = require(path.join(root, 'defaults.js'));

    await check(`${scheme}-switches`, async () => {
      const keys = await page.$$eval('#panel-writer input[type="checkbox"][data-key]', (els) => els.map((e) => e.dataset.key));
      assert.deepEqual(keys, ['enhance.writer', 'enhance.writerUploads', 'writer.ruler', 'writer.autocorrect.typos', 'writer.autocorrect.capitalI', 'writer.autocorrect.doubles', 'writer.autocorrect.smart',
        'writer.pasteAsk', 'writer.proofing', 'writer.compose.markdown', 'writer.compose.target', 'writer.compose.quote', 'writer.submit.rememberText']);
      for (const k of keys) {
        const box = page.locator(`#panel-writer [data-key="${k}"]`);
        assert.equal(await box.isChecked(), true, `${k} starts on`);
        await box.click();
        await until(async () => at(await sync(), k) === false, `${k} saved off`);
        await box.click();
        await until(async () => at(await sync(), k) === true, `${k} saved on`);
      }
      const w = (await sync()).writer;
      assert.deepEqual(w, D.GZ_SANITIZE({ writer: w }).writer, 'what is stored is clean');
    });

    await check(`${scheme}-selects`, async () => {
      for (const [k, value, want] of [['writer.format', 'apa7', 'apa7'], ['writer.zoom', '125', 125], ['writer.versions', '25', 25], ['writer.dialect', 'en-GB', 'en-GB']]) {
        const sel = page.locator(`#panel-writer select[data-key="${k}"]`);
        await sel.selectOption(value);
        await until(async () => at(await sync(), k) === want, `${k} = ${JSON.stringify(want)}`);
      }
      assert.deepEqual(await page.locator('#panel-writer select[data-key="writer.zoom"] option').evaluateAll((o) => o.map((x) => x.value)), ['fit', '75', '100', '125', '150']);
      assert.deepEqual(await page.locator('#panel-writer select[data-key="writer.versions"] option').evaluateAll((o) => o.map((x) => x.value)), ['10', '25', '40', '50', '100']);
      // Read back on a fresh load.
      await open();
      assert.equal(await page.locator('#panel-writer select[data-key="writer.zoom"]').inputValue(), '125');
      assert.equal(await page.locator('#panel-writer select[data-key="writer.versions"]').inputValue(), '25');
      // Back to the defaults through the sections' resets.
      for (const s of ['papers', 'proofing']) await page.locator(`[data-reset-section="writer/${s}"]`).click();
      await until(async () => { const w = (await sync()).writer; return w.zoom === 'fit' && w.versions === 40 && w.format === 'mla9' && w.dialect === 'en-US'; }, 'sections reset');
    });

    await check(`${scheme}-dictionary`, async () => {
      assert.deepEqual(await page.locator('#writer-words li').allTextContents(), [...WORDS].sort((a, b) => a.localeCompare(b)).map((w) => `${w}✕`));
      await page.getByRole('button', { name: 'Remove Sethe' }).click();
      await until(async () => { const v = (await page.evaluate(() => chrome.storage.local.get('writerWords'))).writerWords; return v.length === 5 && !v.includes('Sethe'); }, 'Sethe removed');
      await until(async () => (await page.locator('#writer-words li').count()) === 5, 'the list follows');
    });

    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.evaluate(() => scrollTo(0, 0));
      await pause(300);
      await page.locator('#panel-writer').screenshot({ path: path.join(shots, `settings-writer-${scheme}.png`) });
    }

    await check(`${scheme}-clear-course`, async () => {
      assert.deepEqual(await page.locator('#writer-paper-list li b').allTextContents(), ['ENG 101 · Composition I', 'PSY 100 · Introduction to Psychology', 'HIS 210 · The Atlantic World']);
      await page.getByRole('button', { name: 'Clear PSY 100 · Introduction to Psychology’s papers' }).click();
      await page.locator('#writer-clear').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#writer-clear-title').textContent(), 'Clear PSY 100 · Introduction to Psychology’s papers?');
      if (shots) await page.locator('#writer-clear').screenshot({ path: path.join(shots, `settings-writer-confirm-${scheme}.png`) });
      // Cancel changes nothing.
      await page.locator('#writer-clear-cancel').click();
      await pause(300);
      assert.equal((await page.evaluate(() => chrome.storage.local.get('writerPapers'))).writerPapers.length, 6);
      await page.getByRole('button', { name: 'Clear PSY 100 · Introduction to Psychology’s papers' }).click();
      await page.locator('#writer-clear-ok').click();
      await until(async () => (await page.evaluate(() => chrome.storage.local.get('writerPapers'))).writerPapers.length === 4, 'two papers cleared');
      const left = await page.evaluate(() => chrome.storage.local.get(null));
      assert.ok(!Object.keys(left).some((k) => k.includes('|_303_1|')), 'their papers and versions are gone');
      assert.ok(left[`writerPaper:${PAPERS[0][0]}`], 'another course\'s stay');
      await until(async () => (await page.locator('#writer-paper-list li').count()) === 2, 'the list follows');
      assert.deepEqual(errors, []);
    });
  } finally {
    await context?.close().catch(() => {});
    context = null;
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  }
}
