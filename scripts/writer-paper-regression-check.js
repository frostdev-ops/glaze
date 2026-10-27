// Focused paper-mode regressions in an isolated unpacked extension. No live LMS traffic.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js');
const root = path.resolve(__dirname, '..'), selected = process.argv[2] || 'all';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let ctx, tmp, ext, passed = 0;
const run = async (name, fn) => { if (selected !== 'all' && selected !== name) return; await fn(); console.log(`ok ${name}`); passed++; };
(async () => {
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-paper-regression-'));
    ext = env.staged(root, []);
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...env.chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(ctx);
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const page = async (key) => {
      const p = await ctx.newPage();
      await p.goto(`chrome-extension://${id}/papers.html${key ? '?paper=' + encodeURIComponent(key) : ''}`);
      await p.waitForFunction(() => !!globalThis.GZ_WRITER_PAPER && !!globalThis.GZ_WRITER_PAPERS);
      if (key) await p.waitForFunction(() => !!GZ_WRITER_PAPER.current());
      else await p.evaluate(async () => {
        const m = document.createElement('div'); document.body.append(m);
        const editor = GZ_WRITER_EDITOR.create({ mount: m, mode: 'paper', html: '<p>Native body.</p>' });
        await GZ_WRITER_PAPER.mount({ editor, t: (k) => k, standalone: true, context: () => ({ recovery: 'https://school.test/assignment/unknown' }) });
      });
      return p;
    };
    const type = (p, text) => p.evaluate((text) => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.insertText(text, 1)); }, text);
    await run('unknown', async () => {
      let p = await page(); await pause(16000); await type(p, 'Recover this unknown paper.');
      await p.evaluate(() => GZ_WRITER_PAPER.current().save());
      const saved = await p.evaluate(async () => Object.values(await chrome.storage.local.get(null)).some((v) => v?.doc && JSON.stringify(v.doc).includes('Recover this unknown paper.')));
      assert.ok(saved, 'unknown-key paper must have a durable copy');
      await p.reload(); await p.waitForFunction(() => !!globalThis.GZ_WRITER_PAPERS);
      await p.evaluate(async () => { const m = document.createElement('div'); document.body.append(m); const editor = GZ_WRITER_EDITOR.create({ mount: m, mode: 'paper', html: '<p>Native body.</p>' }); await GZ_WRITER_PAPER.mount({ editor, t: (k) => k, standalone: true, context: () => ({ recovery: 'https://school.test/assignment/unknown' }) }); });
      await pause(100); assert.ok(await p.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('Recover this unknown paper.')), 'unknown draft reopens'); await p.close();
    });
    await run('import', async () => {
      const p = await page('review-import'); await type(p, 'Unsaved typing before import.');
      const bytes = await p.evaluate(async () => { await GZ_WRITER_PAPER.need(['lib/zip.js', 'lib/doctext.js', 'lib/writer-docx.js']); return Array.from(GZ_WRITER_DOCX.exportDocx(GZ_WRITER_SCHEMA.parse(GZ_WRITER_SCHEMA.paper, '<p>Imported replacement.</p>')).bytes); });
      await p.locator('input[type=file]').setInputFiles({ name: 'import.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(bytes) });
      await p.waitForFunction(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('Imported replacement.'));
      const kept = await p.evaluate(async () => { const P = GZ_WRITER_PAPERS.open(), k = GZ_WRITER_PAPER.current().key(); return (await Promise.all((await P.versions(k)).map((v) => P.version(k, v.id)))).some((v) => JSON.stringify(v.doc).includes('Unsaved typing before import.')); });
      assert.ok(kept, 'import must version the live unsaved document'); await p.close();
    });
    await run('retry', async () => {
      const p = await page('review-retry');
      await p.evaluate(() => { const send = chrome.runtime.sendMessage.bind(chrome.runtime); let fail = true; chrome.runtime.sendMessage = (m, ...args) => { if (fail && m?.type === 'glaze:writerPapers' && m.op === 'save') { fail = false; return Promise.reject(new Error('simulated storage failure')); } return send(m, ...args); }; });
      await type(p, 'Retry this failed save.'); await p.evaluate(() => GZ_WRITER_PAPER.current().save());
      await p.evaluate(() => dispatchEvent(new Event('pagehide'))); await pause(300);
      const kept = await p.evaluate(async () => JSON.stringify((await GZ_WRITER_PAPERS.open().get('review-retry'))?.doc).includes('Retry this failed save.'));
      assert.ok(kept, 'failed saves must stay dirty and retry on pagehide'); await p.close();
    });
    await run('tabs', async () => {
      const a = await page('review-tabs'), b = await page('review-tabs');
      await type(a, 'Typed in A.'); await a.evaluate(() => GZ_WRITER_PAPER.current().save());
      await type(b, 'Typed in B.'); await b.evaluate(() => GZ_WRITER_PAPER.current().save());
      assert.ok(await a.evaluate(async () => { const P = GZ_WRITER_PAPERS.open(); return (await Promise.all((await P.versions('review-tabs')).map((v) => P.version('review-tabs', v.id)))).some((v) => JSON.stringify(v.doc).includes('Typed in A.')); }));
      await a.close(); await b.close();
    });
    console.log(`${passed} paper regressions passed`);
  } finally { await ctx?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); if (ext) fs.rmSync(ext, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
