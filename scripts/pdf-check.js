// PDFs on the Documents page (papers.html, pdf-kind.js) in the real unpacked extension: with Settings → Writer → PDFs off
// (writer.pdf false) a .pdf is refused as before, while a PDF already kept still opens; on, it imports as a card with its first page drawn, opens in the
// viewer (pdf.js's PDFViewer: three pages, zoom, the text layer's find, AcroForm fields) whose filled field is still filled
// after closing and opening it again, Export .pdf downloads the filled file, and Esc and Back behave as a paper's. pdf.js
// runs its own worker (never the fake one in the page), the page stays white under a dark Look while its chrome wears it,
// and nothing errors, in the page or at the worker's sender check. Screenshots at 1280 and 640 px. A synthetic PDF only;
// the browser reaches no network.
// NODE_PATH=<playwright> nice -n 10 node scripts/pdf-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-pdf-check');
const checks = [], errors = [], requests = [], workers = [], shots = [], logs = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

// A three-page Letter PDF whose pages say "This is page n", with one AcroForm text field ("name") on page 1.
const fixture = () => {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const stream = (s) => `<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}\nendstream`;
  const catalog = add(null), pages = add(null), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  let field = 0;
  for (let n = 1; n <= 3; n++) {
    const content = add(stream(`BT /F1 24 Tf 72 700 Td (This is page ${n}) Tj ET`));
    const page = add(null);
    if (n === 1) field = add(`<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /Rect [72 600 372 630] /P ${page} 0 R /F 4 /DA (/Helv 12 Tf 0 g) /MK << /BC [0 0 0] >> >>`);
    objs[page - 1] = `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R${n === 1 ? ` /Annots [${field} 0 R]` : ''} >>`;
    kids.push(page);
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R /AcroForm << /Fields [${field} 0 R] /DR << /Font << /Helv ${font} 0 R >> >> /DA (/Helv 12 Tf 0 g) >> >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count 3 >>`;
  let pdf = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const at = [];
  objs.forEach((body, i) => { at.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
};

(async () => {
  let context, held = false, tmp, passed = false, page = null;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\npdf-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[pdf-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-pdf-'));
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(tmp, 'Field trip form.pdf');
    fs.writeFileSync(file, fixture());
    const ext = env.staged(root, []);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'en-US',
      reducedMotion: 'reduce', acceptDownloads: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(15000);
    await context.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.protocol === 'chrome-extension:') return r.continue(); requests.push(u.href); return r.abort(); });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    // Frost: a dark Look, so the chrome is dark while the page stays paper-white.
    const settings = (pdf) => G.GZ_SANITIZE({ preset: 'Frost', enhance: { ...G.GZ_DEFAULTS.enhance, writer: true }, writer: { ...G.GZ_DEFAULTS.writer, pdf } });
    await worker.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(s); }, settings(false));
    const HOME = `chrome-extension://${id}/papers.html`;
    const local = (k) => worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k] ?? null, k);
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    page.on('console', (m) => { const x = m.text(); logs.push(`${m.type()}: ${x}`); if (m.type() === 'error' && !/Failed to load resource|pdf-check quota refusal/.test(x)) errors.push(`console: ${x}`); if (/fake worker/i.test(x)) errors.push(`fake worker: ${x}`); });
    page.on('worker', (w) => workers.push(w.url()));
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) logs.push(`navigated: ${f.url()}`); });
    const shot = async (name) => { await pause(250); const f = path.join(out, name); await page.screenshot({ path: f }); shots.push(f); };
    const openHome = async () => { await page.goto(HOME); await until(() => page.evaluate(() => !document.getElementById('list').hidden), 'home'); };

    // ---- off: Documents is as it was
    await openHome();
    const off = await page.evaluate(() => ({ accept: document.getElementById('gd-file').accept, label: document.getElementById('gd-import').textContent }));
    check(!/pdf/i.test(off.accept) && off.label === 'Import .docx…', `off: the chooser takes Word files only (${JSON.stringify(off)})`);
    await page.setInputFiles('#gd-file', file);
    await until(() => page.evaluate(() => document.getElementById('gd-said').textContent), 'off: refusal');
    check(await page.evaluate(() => document.getElementById('gd-said').textContent === 'That file could not be read as a Word document.'), 'off: a .pdf is refused with the Word string');
    check(((await local('writerPapers')) || []).length === 0, 'off: nothing stored');

    // ---- on: import, a card with its first page
    await worker.evaluate(async (s) => { await chrome.storage.sync.set(s); }, settings(true));
    await openHome();
    const on = await page.evaluate(() => ({ accept: document.getElementById('gd-file').accept, label: document.getElementById('gd-import').textContent }));
    check(/\.pdf/.test(on.accept) && /\.docx/.test(on.accept) && on.label === 'Import…', `on: the chooser takes Word files and PDFs (${JSON.stringify(on)})`);
    await page.setInputFiles('#gd-file', file);
    const key = await until(() => page.evaluate(() => document.querySelector('.gd-card')?.dataset.key), 'the PDF card');
    const rec = await local(`writerPaper:${key}`);
    check(rec?.kind === 'pdf' && rec.title === 'Field trip form' && rec.pages === 3 && Buffer.from(rec.file, 'base64').subarray(0, 5).toString() === '%PDF-', `the record: kind pdf, its title, 3 pages, the bytes (${JSON.stringify({ kind: rec?.kind, title: rec?.title, pages: rec?.pages, size: rec?.size })})`);
    check(/^data:image\/(png|jpeg);base64,/.test(rec.thumb || '') && rec.thumb.length < 64e3, `the record keeps its first page as a picture (${(rec.thumb || '').length} chars)`);
    const cardInfo = await until(() => page.evaluate((k) => { const c = document.querySelector(`.gd-card[data-key="${k}"]`), img = c?.querySelector('.gd-pic img'); return img?.complete && img.naturalWidth > 0 ? { w: img.naturalWidth, meta: c.querySelector('.gd-meta').textContent, title: c.querySelector('.gd-title').textContent, href: c.querySelector('.gd-title').getAttribute('href') } : null; }, key), 'the card thumbnail');
    check(cardInfo.title === 'Field trip form' && /^PDF/.test(cardInfo.meta) && cardInfo.href === `papers.html?pdf=${encodeURIComponent(key)}`, `the card: title, PDF meta, link (${JSON.stringify(cardInfo)})`);
    await shot('home-1280.png');
    await page.setViewportSize({ width: 640, height: 900 });
    await shot('home-640.png');
    await page.setViewportSize({ width: 1280, height: 900 });

    // ---- open: three pages in pdf.js's viewer, its own worker
    await page.click(`.gd-card[data-key="${key}"] .gd-title`);
    await until(() => page.evaluate(() => document.querySelectorAll('.pdfViewer .page').length === 3 && !!document.querySelector('.pdfViewer .page[data-page-number="1"] canvas')), 'three pages');
    check(page.url().endsWith(`papers.html?pdf=${encodeURIComponent(key)}`), 'the viewer is the card\'s address');
    // pdf.js's words come from Glaze's catalogue (lib/pdf-l10n.js), set as its elements are added.
    const landmark = await until(() => page.evaluate(() => document.querySelector('.pdfViewer .page[data-page-number="2"]')?.getAttribute('aria-label')), 'page landmarks');
    check(landmark === 'Page 2', `each page is a landmark named in Glaze's words (${landmark})`);
    const moduleWorker = page.workers().find((w) => w.url().endsWith('/lib/pdfjs/pdf.worker.mjs'));
    const moduleType = moduleWorker && await moduleWorker.evaluate(() => { try { importScripts(); return false; } catch (e) { return /module/i.test(e.message); } });
    check(moduleType, `pdf.js runs in its module worker (${workers.join(', ')})`);
    const chrome1 = await page.evaluate(() => ({ title: document.querySelector('.gp-top h1 input')?.value ?? document.querySelector('.gp-top h1')?.textContent, back: document.querySelector('.gp-top a')?.getAttribute('href'), mode: document.documentElement.dataset.mode }));
    check(chrome1.title === 'Field trip form' && chrome1.back === 'papers.html' && chrome1.mode === 'pdf', `the top bar: Documents, the title (${JSON.stringify(chrome1)})`);
    check(await page.getByRole('region', { name: 'Field trip form', exact: true }).count() === 1, 'the scrollable PDF has a named region');
    // The page is paper under a dark Look; the bar around it is the Look's.
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    const colours = await page.evaluate(() => ({ dark: document.documentElement.hasAttribute('data-dark'), page: getComputedStyle(document.querySelector('.pdfViewer .page')).backgroundColor, bar: getComputedStyle(document.querySelector('.gp-top')).backgroundColor, ground: getComputedStyle(document.querySelector('.gq-scroll')).backgroundColor }));
    check(colours.dark && lum(colours.page) > 0.98 && lum(colours.ground) < 0.35, `dark Look: white page, dark chrome (${JSON.stringify(colours)})`);

    // ---- zoom: ± and the fits
    const width = () => page.evaluate(() => document.querySelector('.pdfViewer .page[data-page-number="1"]').getBoundingClientRect().width);
    const w0 = await width();
    await page.click('#gq-zoom-in');
    await until(async () => (await width()) > w0 * 1.05, 'zoom in');
    const w1 = await width();
    await page.click('#gq-zoom-out'); await page.click('#gq-zoom-out');
    await until(async () => (await width()) < w1 * 0.95, 'zoom out');
    await page.click('#gq-zoom');
    await page.click('[data-zoom="page-fit"]');
    const fit = await until(() => page.evaluate(() => { const p = document.querySelector('.pdfViewer .page[data-page-number="1"]').getBoundingClientRect(), s = document.querySelector('.gq-scroll').getBoundingClientRect(); return p.height <= s.height + 1 ? { p: p.height, s: s.height } : null; }), 'whole page');
    await page.click('#gq-zoom');
    await page.click('[data-zoom="page-width"]');
    const wide = await until(() => page.evaluate(() => { const p = document.querySelector('.pdfViewer .page[data-page-number="1"]').getBoundingClientRect(), s = document.querySelector('.gq-scroll').getBoundingClientRect(); return p.width > s.width * 0.85 && p.width <= s.width ? { p: p.width, s: s.width } : null; }), 'page width');
    check(w1 > w0 && fit && wide, `zoom: in ${Math.round(w0)}→${Math.round(w1)}, whole page ${JSON.stringify(fit)}, page width ${JSON.stringify(wide)}`);

    // ---- find: "page 2" in the text layer. Ctrl+F is the viewer's even where the page takes it first, as an assignment's
    // frame does for its parked paper (writer-find.js, at the document's capture phase): a stand-in for that here.
    await page.evaluate(() => {
      const grab = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); globalThis.pdfCheckGrabbed = true; } };
      document.addEventListener('keydown', grab, true);
      globalThis.pdfCheckUngrab = () => document.removeEventListener('keydown', grab, true);
    });
    await page.keyboard.press('Control+f');
    await until(() => page.evaluate(() => document.activeElement?.id === 'gq-find-q'), 'find opens on Ctrl+F');
    check(await page.evaluate(() => { globalThis.pdfCheckUngrab(); return !globalThis.pdfCheckGrabbed; }), 'Ctrl+F opens the PDF\'s find ahead of a page handler that takes it at the document');
    await page.keyboard.type('page 2');
    const found = await until(() => page.evaluate(() => { const n = document.getElementById('gq-find-n').textContent, hit = document.querySelector('.page[data-page-number="2"] .textLayer .highlight'); return hit && /1/.test(n) ? { n, hit: hit.textContent } : null; }), 'find hits');
    check(found.n === '1 of 1' && /page 2|2/.test(found.hit), `find "page 2": one hit on page 2 (${JSON.stringify(found)})`);
    await shot('viewer-find-1280.png');
    await page.locator('#gq-zoom-in').focus();
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => document.getElementById('gq-find').hidden && !document.querySelector('.textLayer .highlight')), 'Esc closes find outside its input and clears its highlights');

    // ---- fill the form field, close, open again
    await page.evaluate(() => document.querySelector('.gq-scroll').scrollTo(0, 0));
    const input = page.locator('.page[data-page-number="1"] .annotationLayer input').first();
    await input.waitFor();
    await input.fill('Ada Lovelace');
    await input.press('Tab');
    await until(() => page.evaluate(() => document.querySelector('.gp-top .gp-state')?.textContent === 'Saved'), 'saved after filling');
    const saved = await local(`writerPaper:${key}`);
    check(saved.revision > rec.revision && Buffer.from(saved.file, 'base64').length > Buffer.from(rec.file, 'base64').length, `the filled file is saved (${rec.size} → ${saved.size} bytes)`);
    // Saving (and drawing page 1 again for the card) leaves the page on screen as it was: drawn, the field filled.
    const drawnPage = () => page.evaluate(() => { const p = document.querySelector('.pdfViewer .page[data-page-number="1"]'), c = p?.querySelector('canvas'); return !!c && c.width > 0 && getComputedStyle(c).display !== 'none' && p.querySelector('.annotationLayer input')?.value === 'Ada Lovelace' && !!p.querySelector('.textLayer span'); });
    check(await until(drawnPage, 'page 1 drawn after saving', 5000), 'page 1 stays drawn with its field after saving');
    const where = await page.evaluate(() => ({ top: document.querySelector('.gq-scroll').scrollTop, focus: document.activeElement?.className || document.activeElement?.tagName }));
    await page.evaluate(() => document.querySelector('.gq-scroll').scrollTo(0, 0));
    // Page 1's words on screen, not only in the DOM.
    const onScreen = () => page.evaluate(() => { const s = document.querySelector('.gq-scroll').getBoundingClientRect(), r = document.querySelector('.pdfViewer .page[data-page-number="1"] .textLayer span')?.getBoundingClientRect(); return !!r && r.top >= s.top && r.bottom <= s.bottom; });
    check(await until(onScreen, 'page 1 on screen', 5000), `page 1's words are on screen (after Tab: ${JSON.stringify(where)})`);
    await shot('viewer-1280.png');
    await page.setViewportSize({ width: 640, height: 900 });
    // Page width follows the window.
    const refit = await until(() => page.evaluate(() => { const p = document.querySelector('.pdfViewer .page[data-page-number="1"]').getBoundingClientRect(), s = document.querySelector('.gq-scroll').getBoundingClientRect(); return p.width <= s.width && p.width > s.width * 0.85 ? { p: p.width, s: s.width } : null; }), 'page width at 640', 5000);
    check(refit, `page width refits at 640 (${JSON.stringify(refit)})`);
    await until(drawnPage, 'page 1 drawn at 640', 5000);
    await shot('viewer-640.png');
    await page.setViewportSize({ width: 1280, height: 900 });
    // Esc with nothing open leaves the tab where it is (as a paper's does); the ⋯ menu closes on it, focus back on ⋯.
    await page.keyboard.press('Escape');
    check(page.url().includes('?pdf='), 'Esc with nothing open stays on the document');
    await page.click('.gq-more');
    await until(() => page.evaluate(() => !!document.querySelector('.gq-menu [role="menuitem"]')), 'the ⋯ menu');
    const items = await page.evaluate(() => [...document.querySelectorAll('.gq-menu [role="menuitem"]')].map((b) => b.textContent));
    await shot('viewer-menu-1280.png');
    const download = page.waitForEvent('download');
    await page.click('.gq-menu [data-act="export"]');
    const d = await download, dl = path.join(tmp, 'export.pdf');
    await d.saveAs(dl);
    const bytes = fs.readFileSync(dl);
    check(items.includes('Export .pdf') && d.suggestedFilename() === 'Field trip form.pdf' && bytes.subarray(0, 5).toString() === '%PDF-' && bytes.length === saved.size, `Export .pdf downloads the saved file (${JSON.stringify(items)}, ${d.suggestedFilename()}, ${bytes.length} bytes)`);
    await page.click('.gq-more');
    await until(() => page.evaluate(() => !!document.querySelector('.gq-menu')), 'the ⋯ menu again');
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => !document.querySelector('.gq-menu') && document.activeElement?.classList.contains('gq-more')), 'Esc closes ⋯ and focus goes back to it');
    // Back to Documents with the top bar's link; the card opens the filled form again.
    await page.click('.gp-top a[href="papers.html"]');
    await until(() => page.evaluate(() => !document.getElementById('list').hidden && !!document.querySelector('.gd-card')), 'home again');
    await page.click(`.gd-card[data-key="${key}"] .gd-title`);
    const kept = await until(() => page.evaluate(() => document.querySelector('.page[data-page-number="1"] .annotationLayer input')?.value || null), 'the field after reopening');
    check(kept === 'Ada Lovelace', `the filled value is kept (${kept})`);
    // The tab's Back goes home as from a paper.
    await page.goBack();
    await until(() => page.evaluate(() => !document.getElementById('list').hidden && location.search === ''), 'Back to Documents');
    check(true, 'Back returns to Documents');

    // ---- off again: no new PDFs, the one kept still lists and opens, filled
    await worker.evaluate(async (s) => { await chrome.storage.sync.set(s); }, settings(false));
    await openHome();
    const offAgain = await page.evaluate((k) => ({ accept: document.getElementById('gd-file').accept, label: document.getElementById('gd-import').textContent, card: !!document.querySelector(`.gd-card[data-key="${k}"]`) }), key);
    check(!/pdf/i.test(offAgain.accept) && offAgain.label === 'Import .docx…' && offAgain.card, `off again: Word files only to import, the kept PDF still listed (${JSON.stringify(offAgain)})`);
    await page.setInputFiles('#gd-file', file);
    await until(() => page.evaluate(() => document.getElementById('gd-said').textContent), 'off again: refusal');
    check(((await local('writerPapers')) || []).length === 1, 'off again: a .pdf is refused, nothing new stored');
    await page.click(`.gd-card[data-key="${key}"] .gd-title`);
    const keptOff = await until(() => page.evaluate(() => document.querySelector('.page[data-page-number="1"] .annotationLayer input')?.value || null), 'the kept PDF opens with the switch off');
    check(keptOff === 'Ada Lovelace', `off again: the kept PDF opens, filled (${keptOff})`);

    // Refusing a write must keep both the last good file and the student's unsaved field on screen.
    const good = await local(`writerPaper:${key}`);
    await worker.evaluate(() => {
      globalThis.pdfCheckSet = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async (items) => {
        if (Object.keys(items).some((k) => k.startsWith('writerPaper:'))) throw new Error('pdf-check quota refusal');
        return globalThis.pdfCheckSet(items);
      };
    });
    try {
      await page.locator('.page[data-page-number="1"] .annotationLayer input').first().fill('Grace Hopper');
      await page.click('.gp-top a[href="papers.html"]');
      await until(() => page.evaluate(() => !location.search || document.querySelector('.gp-state')?.textContent === 'Not saved. Try again in a moment.'), 'quota refusal or navigation');
      check(page.url().includes('?pdf=') && await page.evaluate(() => document.querySelector('.annotationLayer input')?.value === 'Grace Hopper'), 'quota refusal keeps the unsaved form open');
      check((await local(`writerPaper:${key}`)).file === good.file, 'quota refusal keeps the last good bytes');
    } finally {
      await worker.evaluate(() => { chrome.storage.local.set = globalThis.pdfCheckSet; delete globalThis.pdfCheckSet; });
    }
    await page.click('.gp-top a[href="papers.html"]');
    await until(() => page.evaluate(() => !document.getElementById('list').hidden), 'retry saved before returning home');
    await page.click(`.gd-card[data-key="${key}"] .gd-title`);
    check(await until(() => page.evaluate(() => document.querySelector('.annotationLayer input')?.value === 'Grace Hopper'), 'the retried value'), 'retry persists the edited form before leaving');

    // Hold the worker's first save after its byte snapshot, while annotationStorage is still marked modified.
    await openHome();
    await page.evaluate(async (key) => {
      await import(chrome.runtime.getURL('lib/pdfjs/pdf.mjs'));
      const V = await import(chrome.runtime.getURL('lib/pdfjs/pdf_viewer.mjs'));
      const setDocument = V.PDFViewer.prototype.setDocument;
      V.PDFViewer.prototype.setDocument = function (doc) { globalThis.pdfCheckDoc = doc; return setDocument.call(this, doc); };
      try {
        document.getElementById('list').hidden = true;
        history.replaceState(null, '', `papers.html?pdf=${encodeURIComponent(key)}`);
        await GZ_DOC_KINDS.get('pdf').edit(key);
      } finally { V.PDFViewer.prototype.setDocument = setDocument; }
      const handler = globalThis.pdfCheckDoc._transport.messageHandler, send = handler.sendWithPromise.bind(handler);
      handler.sendWithPromise = async (action, ...args) => {
        const result = await send(action, ...args);
        if (action === 'SaveDocument' && !globalThis.pdfCheckPaused) {
          globalThis.pdfCheckPaused = true;
          await new Promise((r) => { globalThis.pdfCheckRelease = r; });
        }
        return result;
      };
    }, key);
    const racing = page.locator('.page[data-page-number="1"] .annotationLayer input').first();
    await racing.fill('First edit');
    await racing.press('Tab');
    await until(() => page.evaluate(() => globalThis.pdfCheckPaused), 'the first save snapshot');
    await racing.fill('Second edit');
    await page.click('.gp-top a[href="papers.html"]');
    await page.evaluate(() => globalThis.pdfCheckRelease());
    await until(() => page.evaluate(() => !document.getElementById('list').hidden), 'home after overlapping edits');
    await page.click(`.gd-card[data-key="${key}"] .gd-title`);
    const afterRace = await until(() => page.evaluate(() => document.querySelector('.annotationLayer input')?.value || null), 'overlapping edits reopened');
    check(afterRace === 'Second edit', `an edit made during a save is persisted before leaving (${afterRace})`);

    check(!errors.some((e) => /sender/.test(e)), 'no worker sender refusals');
    check(!errors.some((e) => /fake worker/i.test(e)), 'pdf.js never fell back to a fake worker');
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    check(requests.length === 0, `no network (${requests.join(', ')})`);
    // A browser that refuses module workers uses pdf.js's in-page worker. Its image decoders still need WebAssembly.
    const fallback = await context.newPage();
    try {
      await fallback.goto(HOME);
      await until(() => fallback.evaluate(() => !document.getElementById('list').hidden), 'fallback home');
      const result = await fallback.evaluate(async (key) => {
        globalThis.Worker = class { constructor() { throw new Error('module workers unavailable'); } };
        const P = await import(chrome.runtime.getURL('lib/pdfjs/pdf.mjs'));
        P.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.mjs');
        const rec = (await chrome.storage.local.get(`writerPaper:${key}`))[`writerPaper:${key}`];
        const data = Uint8Array.from(atob(rec.file), (c) => c.charCodeAt(0));
        const task = P.getDocument({ data, isEvalSupported: false, verbosity: 0 });
        try {
          const doc = await task.promise;
          let wasm = false;
          try { await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); wasm = true; } catch { /* the assertion reports CSP refusal */ }
          return { pages: doc.numPages, port: task._worker.port.constructor.name, wasm };
        } finally { await task.destroy(); }
      }, key);
      check(result.pages === 3 && result.port === 'LoopbackPort' && result.wasm, `module-worker refusal: the local fallback opens and can compile its image decoders (${JSON.stringify(result)})`);
    } finally { await fallback.close(); }
    passed = true;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
    // What the page was when it failed: a picture, its address, and the viewer's state.
    try {
      fs.mkdirSync(out, { recursive: true });
      await page?.screenshot({ path: path.join(out, 'failure.png') });
      fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify(await page?.evaluate(() => ({ url: location.href, mode: document.documentElement.dataset.mode, route: document.documentElement.getAttribute('data-gd-route'),
        pages: document.querySelectorAll('.pdfViewer .page').length, canvases: document.querySelectorAll('.pdfViewer canvas').length, said: document.querySelector('.gq-said')?.textContent,
        scroll: document.querySelector('.gq-scroll')?.getBoundingClientRect().toJSON(), body: document.body.innerHTML.slice(0, 3000) })), null, 1));
    } catch (err) { console.error(err); }
  } finally {
    await context?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'pdf-results.json'), JSON.stringify({ passed, checks, errors, requests, workers, shots, logs }, null, 2) + '\n');
    console.log(`${passed ? 'PASS' : 'FAIL'} pdf-check: ${checks.length} checks`);
  }
})();
