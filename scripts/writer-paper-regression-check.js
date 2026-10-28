// Focused paper-mode regressions in an isolated unpacked extension. No live LMS traffic.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js');
const root = path.resolve(__dirname, '..'), selected = process.argv[2] || 'all';
// The printed PDFs: in PAPER_EVIDENCE when named, else the run's temporary folder (never the source tree).
const evidence = () => { const d = process.env.PAPER_EVIDENCE || tmp; fs.mkdirSync(d, { recursive: true }); return d; };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let ctx, tmp, ext, passed = 0;
const run = async (name, fn) => { if (selected !== 'all' && selected !== name) return; await fn(); console.log(`ok ${name}`); passed++; };
(async () => {
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-paper-regression-'));
    ext = env.staged(root, []);
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
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
    await run('note-edit', async () => {
      const p = await page('review-note-edit');
      await p.click('.gp-tbtn:has-text("Footnote")'); await p.fill('.gp-note textarea', 'Keep this note when I click away.');
      await p.click('.gp-top h1'); await pause(100);
      assert.ok(await p.evaluate(() => JSON.stringify(GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON()).includes('Keep this note when I click away.')), 'clicking outside a footnote must commit its text');
      await p.close();
    });
    await run('image', async () => {
      const p = await page('review-image');
      await p.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 3000; const v = GZ_WRITER_PAPER.current().editor.view, S = GZ_WRITER_SCHEMA; const doc = S.paper.nodes.doc.create(null, S.paper.nodes.paragraph.create(null, S.paper.nodes.image.create({ src: canvas.toDataURL(), width: 300 }))); v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, doc.content)); });
      await pause(500);
      assert.ok(await p.evaluate(() => { const image = document.querySelector('.gp-flow img'), scale = document.querySelector('.gp-zoom').getBoundingClientRect().width / 816; return image.getBoundingClientRect().height / scale <= GZ_WRITER_STYLES.geometry(GZ_WRITER_PAPER.current().format()).body; }), 'tall pictures must fit inside the page body'); await p.close();
    });
    await run('keyboard', async () => {
      const p = await page('review-keyboard');
      await p.focus('#gp-tab-checks'); await p.keyboard.press('ArrowRight');
      assert.equal(await p.evaluate(() => document.activeElement.id), 'gp-tab-sources', 'tabs need arrow navigation');
      await p.focus('[data-run=bold]'); await p.keyboard.press('ArrowRight');
      assert.equal(await p.evaluate(() => document.activeElement.dataset.run), 'italic', 'toolbar needs arrow navigation');
      await p.close();
    });
    await run('print', async () => {
      const p = await page('review-print'); await pause(300);
      const pages = await p.evaluate(() => GZ_WRITER_PAPER.current().pages());
      const file = path.join(evidence(), 'print.pdf');
      await p.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
      const info = require('node:child_process').execFileSync('pdfinfo', [file], { encoding: 'utf8' });
      assert.equal(+/Pages:\s+(\d+)/.exec(info)[1], pages, 'print must contain every paper page');
      const text = require('node:child_process').execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' });
      assert.ok(!text.includes('Checks'), 'paper chrome must not print'); await p.close();
    });
    // A paper on A4, landscape, prints on A4 landscape pages: what its pages show, uncut.
    await run('print-page', async () => {
      const p = await page('review-print-page'); await pause(300);
      await p.evaluate(() => GZ_WRITER_PAPER.current().setup({ page: [11.69, 8.27] })); await pause(600);
      const file = path.join(evidence(), 'print-a4-landscape.pdf');
      await p.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
      const info = require('node:child_process').execFileSync('pdfinfo', [file], { encoding: 'utf8' });
      const [w, h] = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info).slice(1).map(Number);
      assert.ok(Math.abs(w - 841.7) < 2 && Math.abs(h - 595.4) < 2, `printed pages must be the paper's own (${w} x ${h} pt)`); await p.close();
    });
    await run('table', async () => {
      const p = await page('review-table');
      await p.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view, S = GZ_WRITER_SCHEMA; const d = S.parse(S.paper, '<table>' + '<tr><td><p>Row</p></td><td><p>Value</p></td></tr>'.repeat(70) + '</table><p>After table.</p>'); v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, d.content)); });
      await pause(500);
      assert.ok(await p.evaluate(() => GZ_WRITER_PAPER.current().pages() >= 3), 'a tall table must paginate between rows'); await p.close();
    });
    await run('notes', async () => {
      const p = await page('review-notes');
      await p.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view, S = GZ_WRITER_SCHEMA; const d = S.paper.nodes.doc.create(null, S.paper.nodes.paragraph.create(null, [S.paper.text('Reference'), S.paper.nodes.footnote_ref.create({ content: 'Long footnote text. '.repeat(1000) })])); v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, d.content)); });
      await pause(500);
      assert.ok(await p.evaluate(() => [...document.querySelectorAll('.gp-sheet .gp-notes')].every((n) => n.getBoundingClientRect().top >= n.parentElement.getBoundingClientRect().top + 90 * (GZ_WRITER_PAPER.current().pages() ? document.querySelector('.gp-zoom').getBoundingClientRect().width / 816 : 1))), 'long footnotes must not overflow the page top'); await p.close();
    });
    await run('thirty', async () => {
      const p = await page('review-thirty');
      await p.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view, S = GZ_WRITER_SCHEMA; const d = S.parse(S.paper, ('<p>' + 'Typing in a long paper stays responsive. '.repeat(35) + '</p>').repeat(130)); v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, d.content)); });
      await pause(500);
      const result = await p.evaluate(async () => { const api = GZ_WRITER_PAPER.current(), v = api.editor.view, before = v.dom.gzMeasured, times = []; for (let i = 0; i < 20; i++) { const start = performance.now(); v.dispatch(v.state.tr.insertText('x', 20 + i)); await new Promise((r) => setTimeout(r, 0)); times.push(performance.now() - start); } return { pages: api.pages(), measured: v.dom.gzMeasured - before, median: times.sort((a,b) => a-b)[10] }; });
      console.log(JSON.stringify(result)); assert.ok(result.pages >= 30 && result.measured <= 20); await p.close();
    });
    console.log(`${passed} paper regressions passed`);
  } finally { await ctx?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); if (ext) fs.rmSync(ext, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
