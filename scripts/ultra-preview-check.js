// Ultra's file previews in Glaze's PDF viewer (features/bbpreview.js, lib/bb-preview.js, pdf-kind.js show), in the real
// unpacked extension on the synthetic Ultra Document page and viewer chain of scripts/ultra-mock.js PREVIEW (the live probe's
// shapes: two data-bbfile attachments, viewerUrl → 302 → basic-doc-viewer's index.html → its documents API → a presigned S3
// converted.pdf served with Range). An expanded preview: Blackboard's frame until Glaze's viewer has drawn page 1, then
// Glaze's in its place, page 1's text in it, its bytes read from S3 by the frame itself (Range too); the page box jumps; collapse and
// expand; one already open when the switch comes on; the switch off, and Settings → Writer → PDFs off: Blackboard's frame;
// "converting": Blackboard's frame while it waits, then Glaze's; the documents API failing: Blackboard's frame; an address
// that ran out: asked again, then shown; Save to Documents: a PDF record in Documents; Open original: the file in a new
// tab; dark documents inverts Blackboard's frame, never Glaze's; the keyboard reaches the frame and Esc returns to the
// Preview button; at 640 px it fits. The browser's following of viewerUrl's 302 in the worker is stood in for (ultra-mock.js
// WHERE: Playwright doesn't follow a routed redirect there); the real one is the owner's live check.
// GETs only, synthetic. NODE_PATH=<playwright> node scripts/ultra-preview-check.js [dir]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const PDF = require('./pdf-fixtures.js');
const { PREVIEW: P, SITE: site, ME } = require('./ultra-mock.js');
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-ultra-preview-check');
const [SLIDES, LAB] = P.FILES;
const checks = [], errors = [];
let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 20000, state = null) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  const was = state ? await Promise.resolve().then(state).then((x) => JSON.stringify(x), (e) => `unreadable: ${e.message}`) : '';
  throw Error(`${label} timed out after ${ms} ms${last ? `: ${last.message}` : ''}${was ? `; at the deadline ${was}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
const quiet = async (fn, label, ms = 1500) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) throw Error(`${label}: it happened`); await pause(80); } return true; };

(async () => {
  let context, held = false, tmp;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nultra-preview-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[ultra-preview-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-preview-'));
    fs.mkdirSync(out, { recursive: true });
    // The slides' PDF: six pages of about 12 MB, so pdf.js asks by Range while the whole file streams, and too big for
    // Documents (3 MB); the lab's: three small pages.
    const pdfs = { [SLIDES.hash]: PDF.large({ count: 6, size: 12e6 }), [LAB.hash]: PDF.FIXTURES.three() };
    const plan = {}; // a file's hash → its scenario (ultra-mock.js previews)
    const mock = P.previews({ site, pdf: (f) => f && pdfs[f.hash], scenario: (f) => plan[f?.hash] || {} });
    const originals = [];
    const ext = env.staged(root, [`${site}/*`]);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(20000);
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (!['GET', 'OPTIONS'].includes(req.method())) return r.abort();
      if (await mock.handle(r)) return;
      if (u.origin !== site) return r.abort();
      const file = P.FILES.find((f) => f.at === u.pathname);
      if (file && !u.search) { originals.push(u.pathname); return r.fulfill({ status: 200, contentType: file.mime, headers: { 'content-disposition': `attachment; filename="${file.name}"` }, body: Buffer.from('synthetic original') }); }
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      const data = u.pathname.endsWith('/users/me') ? ME : { results: [] };
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const failed = [];
    context.on('requestfailed', (q) => { if (q.url().startsWith(P.BUCKET)) failed.push(`${q.method()} ${q.headers().range || ''} ${q.failure()?.errorText}`); });
    // The frame's too (S3's refusal of a run-out address is the browser's own "Failed to load resource" line).
    context.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const settings = ({ enhance = {}, writer = {} } = {}) => G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), bbPreviews: true, docPages: 'plain', ...enhance }, writer: { pdf: true, ...writer } });
    // The worker's stand-in for following viewerUrl's redirect (ultra-mock.js WHERE), put back before each step.
    const where = () => worker.evaluate(mock.where);
    const set = async (s) => { await where(); await worker.evaluate(async (s) => { await chrome.storage.sync.set(s); }, settings(s)); };
    await worker.evaluate(async ({ s, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(s); await chrome.storage.local.set({ ultra: [site] }); }, { s: settings(), site });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();

    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`page console: ${m.text()}`); });
    const load = async () => {
      await p.goto(`${site}${P.ROUTE}`);
      await until(() => p.evaluate(() => !!document.documentElement.style.getPropertyValue('--gz-surface')), 'Glaze on the page');
    };
    // One attachment's state on the page: its Preview button, Blackboard's frame (shown?), Glaze's (shown? loading?).
    const view = (f) => p.evaluate((name) => {
      const box = [...document.querySelectorAll('[data-bbfile]')].find((x) => JSON.parse(x.getAttribute('data-bbfile')).linkName === name);
      const bb = box.querySelector('[class*="fileViewerContainer"] iframe:not(.gz-pv)'), gz = box.querySelector('iframe.gz-pv');
      const seen = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).opacity !== '0' && getComputedStyle(el).visibility !== 'hidden';
      return { expanded: box.querySelector('button.preview').getAttribute('aria-expanded'), bb: !!bb, bbShown: seen(bb), gz: !!gz, gzShown: seen(gz), gzFilter: gz ? getComputedStyle(gz).filter : '', bbFilter: bb ? getComputedStyle(bb).filter : '',
        gzRect: gz ? gz.getBoundingClientRect().toJSON() : null, boxRect: box.getBoundingClientRect().toJSON(), state: bb?.getAttribute('data-gz-pv') || '' };
    }, f.name);
    // Ultra's Preview button, centred first (at the window's foot Glaze's own bottom controls can sit over it), and its
    // aria-expanded seen to turn.
    const toggle = async (f) => {
      await where();
      const sel = `button[aria-label="Preview File ${f.name}"]`, was = await p.getAttribute(sel, 'aria-expanded');
      await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), sel);
      await p.click(sel);
      await until(async () => (await p.getAttribute(sel, 'aria-expanded')) !== was, `${f.name}: Preview pressed`, 5000);
    };
    const frameOf = async (f) => { const el = await p.$(`[data-bbfile*="${f.name}"] iframe.gz-pv`); return el && el.contentFrame(); };
    const glazeIn = async (f, label, ms = 30000) => {
      await until(async () => { const v = await view(f); return v.gzShown && !v.bbShown && v.bb; }, `${label}: Glaze's viewer in Blackboard's frame's place`, ms,
        async () => ({ view: await view(f), seen: { ...mock.seen, origins: [...mock.seen.origins], asks: [...mock.seen.asks] }, failed,
          frame: await (await frameOf(f))?.evaluate(() => ({ mode: document.documentElement.dataset.mode, doc: document.documentElement.dataset.doc, said: document.querySelector('.gq-said')?.textContent, pages: document.querySelectorAll('.pdfViewer .page').length, gq: !!document.querySelector('.gq') })).catch((e) => e.message) }));
      const fr = await until(() => frameOf(f), `${label}: the viewer's document`);
      return fr;
    };
    const pageText = (fr, n = 1) => fr.evaluate((n) => document.querySelector(`.pdfViewer .page[data-page-number="${n}"] .textLayer`)?.textContent || '', n);
    const shot = async (name) => { const f = path.join(out, name); await p.screenshot({ path: f }); return f; };

    // ---- an expanded preview: Blackboard's frame first, then Glaze's with page 1's text, read by Range from the frame
    await load();
    check((await view(SLIDES)).expanded === 'false' && !(await view(SLIDES)).bb, 'the Document page with its two attachments, collapsed');
    await toggle(SLIDES);
    await until(async () => (await view(SLIDES)).bbShown, "expanding shows Blackboard's frame at once");
    check(true, "expanding shows Blackboard's frame at once (it stays until Glaze's viewer has drawn)");
    let fr = await glazeIn(SLIDES, 'expanded');
    await until(async () => (await pageText(fr)).includes('Page 1 of 6'), "page 1's text in Glaze's viewer", 20000, () => pageText(fr));
    check(true, "Glaze's viewer takes Blackboard's frame's place and shows the PDF's first page text (\"Page 1 of 6\")");
    check(mock.seen.viewer >= 1 && mock.seen.api >= 1, `the worker followed viewerUrl (${mock.seen.viewer}) and asked the documents API (${mock.seen.api})`);
    check([...mock.seen.origins].every((o) => o === `chrome-extension://${id}`) && mock.seen.origins.size === 1, `the frame read the PDF from S3 itself (Origin ${[...mock.seen.origins].join(', ')})`);
    // pdf.js asks by Range only for what its first stream hasn't brought yet; here the whole file comes at once, so the
    // frame's own Range read (its CSP and S3's CORS for a Range from the extension's origin) is asked for directly.
    const ranges = mock.seen.ranges;
    const ranged = await fr.evaluate(async (u) => { const r = await fetch(u, { headers: { range: 'bytes=0-1023' } }); return { status: r.status, range: r.headers.get('content-range'), n: (await r.arrayBuffer()).byteLength }; }, P.pdfOf(SLIDES, Date.now()));
    check(ranged.status === 206 && ranged.n === 1024 && ranged.range === `bytes 0-1023/${pdfs[SLIDES.hash].length}`, `a Range read from the frame: 206, ${ranged.range} (pdf.js itself asked ${ranges} ranges)`);
    const title = await fr.evaluate(() => document.querySelector('.gp-top h1')?.textContent);
    check(title === SLIDES.name, `its title is the attachment's name ("${title}")`);
    const v1 = await view(SLIDES);
    check(v1.gzRect.height >= 640 - 1 && Math.abs(v1.gzRect.height - Math.max(640, 900 - 120)) <= 1, `as tall as an assignment's paper (${v1.gzRect.height} px at a 900 px window)`);
    await shot('expanded.png');

    // ---- the page box: page 3 on Enter, and the box follows
    await fr.click('#gq-page');
    await fr.fill('#gq-page', '3');
    await fr.press('#gq-page', 'Enter');
    await until(() => fr.evaluate(() => document.querySelector('.pdfViewer .page[data-page-number="3"]')?.getBoundingClientRect().top < 200), 'page 3 at the top after the jump', 10000);
    check((await fr.inputValue('#gq-page')) === '3' && (await fr.textContent('#gq-pages')) === '/ 6', 'the page box jumps to page 3 (/ 6)');
    await fr.focus('.gq-scroll');
    await fr.evaluate(() => { document.querySelector('.gq-scroll').scrollTop = 0; });
    await until(async () => (await fr.inputValue('#gq-page')) === '1', 'the box follows the scroll back to page 1', 5000);
    check(true, 'the page box follows the scroll');

    // ---- keyboard: Tab reaches Glaze's frame from the Preview button; Esc in it returns there
    await p.focus(`button[aria-label="Preview File ${SLIDES.name}"]`);
    let inFrame = false;
    for (let i = 0; i < 8 && !inFrame; i++) { await p.keyboard.press('Tab'); inFrame = await p.evaluate(() => document.activeElement?.matches('iframe.gz-pv')); }
    check(inFrame, 'Tab from the Preview button reaches Glaze\'s frame');
    const inside = await fr.evaluate(() => document.activeElement?.tagName);
    await p.keyboard.press('Escape');
    await until(() => p.evaluate((n) => document.activeElement?.getAttribute('aria-label') === `Preview File ${n}`, SLIDES.name), 'Esc back to the Preview button', 5000);
    check(true, `Esc in the viewer (focus on its ${inside}) returns to "Preview File ${SLIDES.name}"`);

    // ---- Open original: the file's own address in a new tab
    const tab = context.waitForEvent('page');
    await fr.click('[data-act="original"]');
    const opened = await tab;
    await until(() => originals.includes(SLIDES.at), 'the original asked for');
    check(opened !== p && originals.includes(SLIDES.at), `Open original opens ${SLIDES.at} in a new tab`);
    await opened.close().catch(() => {});

    // ---- Save to Documents past the kind's cap: refused, nothing kept
    await fr.click('[data-act="save"]');
    await until(() => fr.evaluate(() => document.querySelector('.gp-state')?.textContent === 'This PDF is too big to save.'), 'too big to save', 20000, () => fr.evaluate(() => document.querySelector('.gp-state')?.textContent));
    const papers = () => worker.evaluate(async () => { const all = await chrome.storage.local.get(null); return Object.entries(all).filter(([k]) => k.startsWith('writerPaper:doc:')).map(([k, v]) => ({ k, kind: v.kind, title: v.title, size: v.size, pages: v.pages })); });
    check((await papers()).length === 0 && !(await fr.isDisabled('[data-act="save"]')), `Save to Documents on a ${(pdfs[SLIDES.hash].length / 1e6).toFixed(1)} MB PDF: "This PDF is too big to save.", nothing kept`);

    // ---- collapse, then expand again
    await toggle(SLIDES);
    await until(async () => { const v = await view(SLIDES); return !v.bb && !v.gz && v.expanded === 'false'; }, 'collapsed: both frames gone');
    check(true, 'collapsing takes both frames away');
    await toggle(SLIDES);
    fr = await glazeIn(SLIDES, 'expanded again');
    await until(async () => (await pageText(fr)).includes('Page 1 of 6'), 'page 1 again');
    check(true, "expanding again shows Glaze's viewer again");

    // ---- dark documents: Blackboard's frame inverted, Glaze's never
    await set({ enhance: { docPages: 'dark' } });
    await until(() => p.evaluate(() => document.documentElement.getAttribute('data-gz-enhance-docPages') === 'dark'), 'dark documents on');
    check(await p.evaluate(() => document.documentElement.hasAttribute('data-gz-dark-theme')), 'the Look is dark');
    const dark = await view(SLIDES);
    check(dark.gzShown && dark.gzFilter === 'none', `dark documents leaves Glaze's frame alone (filter ${dark.gzFilter})`);
    await toggle(LAB);
    await until(async () => (await view(LAB)).bb, "the lab's preview opens", 20000, async () => ({ lab: await view(LAB), slides: await view(SLIDES), active: await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 200)) }));
    const bbDark = await view(LAB);
    check(/invert/.test(bbDark.bbFilter), `while Blackboard's frame is inverted as before (${bbDark.bbFilter})`);
    fr = await glazeIn(LAB, 'the lab');
    await until(async () => (await pageText(fr)).includes('Alpha page one'), "the lab's page 1", 20000, () => pageText(fr));
    check((await view(LAB)).gzFilter === 'none', "the lab's Glaze frame isn't inverted either");

    // ---- Save to Documents: a PDF record, titled by the file, in Documents' list
    await fr.click('[data-act="save"]');
    await until(() => fr.evaluate(() => document.querySelector('.gp-state')?.textContent === 'Saved to Documents'), 'Saved to Documents', 20000, () => fr.evaluate(() => document.querySelector('.gp-state')?.textContent));
    const saved = await papers();
    check(saved.length === 1 && saved[0].kind === 'pdf' && saved[0].title === 'Lab safety' && saved[0].size === pdfs[LAB.hash].length && saved[0].pages === 3, `Save to Documents makes one PDF record (${JSON.stringify(saved)})`);
    const index = await worker.evaluate(async () => (await chrome.storage.local.get('writerPapers')).writerPapers);
    check(JSON.stringify(index || {}).includes(saved[0].k.slice('writerPaper:'.length)), 'and it lists in Documents (the index row)');
    await set({ enhance: { docPages: 'plain' } });

    // ---- the switch off: Blackboard's frames back; on with a preview open: Glaze's at once
    await set({ enhance: { bbPreviews: false } });
    await until(async () => { const a = await view(SLIDES), b = await view(LAB); return a.bbShown && !a.gz && b.bbShown && !b.gz; }, 'switch off: Blackboard\'s frames', 10000, () => Promise.all([view(SLIDES), view(LAB)]));
    check(true, "Previews in Glaze off: both open previews are Blackboard's frames again");
    await quiet(async () => (await view(SLIDES)).gz, 'Glaze came back with the switch off');
    await set({});
    await glazeIn(SLIDES, 'switch on with the preview open');
    await glazeIn(LAB, 'switch on, the lab');
    check(true, 'switched on with previews already open: Glaze takes both');
    await set({ writer: { pdf: false } });
    await until(async () => { const a = await view(SLIDES); return a.bbShown && !a.gz; }, 'PDFs off: Blackboard\'s frame', 10000, () => view(SLIDES));
    check(true, "Settings → Writer → PDFs off: Blackboard's frame");
    await set({});
    await glazeIn(SLIDES, 'PDFs on again');
    await toggle(SLIDES); await toggle(LAB);
    await until(async () => !(await view(SLIDES)).bb && !(await view(LAB)).bb, 'both collapsed');

    // ---- the documents API failing: Blackboard's frame, and it stays
    await load(); // a fresh page: no answer kept
    plan[LAB.hash] = { api: 'fail' };
    const apiBefore = mock.seen.api;
    await toggle(LAB);
    await until(() => mock.seen.api > apiBefore, 'the API asked');
    await quiet(async () => (await view(LAB)).gz, "Glaze's frame after the API failed", 2500);
    check((await view(LAB)).bbShown, "the documents API failing: Blackboard's frame stays, no Glaze frame");
    await toggle(LAB);

    // ---- converting: Blackboard's frame while Ultra's 15 s go by, then Glaze's
    const t0 = Date.now();
    plan[LAB.hash] = { until: t0 + 8000 };
    mock.seen.asks.set(LAB.hash, 0);
    await toggle(LAB);
    await until(() => (mock.seen.asks.get(LAB.hash) || 0) >= 1, 'asked once');
    await quiet(async () => (await view(LAB)).gzShown, 'shown while converting', 5000);
    check((await view(LAB)).bbShown, "converting: Blackboard's frame while it waits");
    fr = await glazeIn(LAB, 'converted', 40000);
    check(mock.seen.asks.get(LAB.hash) >= 3 && Date.now() - t0 >= 14000, `then asked again on Ultra's 15 s (${mock.seen.asks.get(LAB.hash)} asks with Blackboard's frame's own, ${Math.round((Date.now() - t0) / 1000)} s) and shown`);
    await toggle(LAB);

    // ---- an address that ran out: S3 refuses the first, the frame asks again, and it shows
    await load();
    plan[SLIDES.hash] = { s3: 'fail-first' };
    const asks = mock.seen.viewer;
    await toggle(SLIDES);
    fr = await glazeIn(SLIDES, 'after a refused address');
    check(mock.seen.viewer >= asks + 2 && mock.seen.refused >= 1, `S3 refused the first address (${mock.seen.refused}); the frame asked again (${mock.seen.viewer - asks} viewer asks) and shows`);
    plan[SLIDES.hash] = {};
    await toggle(SLIDES);

    // ---- 640 px: the frame fits its box, the toolbar's buttons in view
    await p.setViewportSize({ width: 640, height: 800 });
    await toggle(SLIDES);
    fr = await glazeIn(SLIDES, '640 px');
    const narrow = await view(SLIDES);
    const tools = await fr.evaluate(() => ['[data-act="save"]', '[data-act="original"]', '#gq-page', '#gq-find-b'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { s, left: r.left, right: r.right, w: innerWidth }; }));
    await shot('narrow-640.png');
    check(narrow.gzRect.right <= narrow.boxRect.right + 0.5 && narrow.gzRect.left >= narrow.boxRect.left - 0.5, `at 640 px the frame fits its attachment's box (${Math.round(narrow.gzRect.width)} of ${Math.round(narrow.boxRect.width)} px)`);
    check(tools.every((x) => x.left >= 0 && x.right <= x.w + 0.5), `and its toolbar's controls are in view (${JSON.stringify(tools)})`);
    check(Math.abs(narrow.gzRect.height - 680) <= 1, `at an 800 px window it is 680 px tall (${narrow.gzRect.height})`);

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    passed = true;
  } catch (e) {
    console.error(`FAIL ${e.stack || e.message}`);
    if (errors.length) console.error(`errors: ${errors.join(' | ')}`);
    process.exitCode = 1;
  } finally {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'ultra-preview-check.json'), `${JSON.stringify({ passed, checks, errors }, null, 2)}\n`);
    await context?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    console.log(`${passed ? 'PASS' : 'FAIL'} ${checks.length} checks`);
  }
})();
