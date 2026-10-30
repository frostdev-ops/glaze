// Canvas's files in Glaze's viewers (features/canvasopen.js), headless: the real extension (a staged copy that also holds the
// check's file server) on saved Canvas pages under an invented Canvas cloud host, its API and file server answered by the
// check; all else aborts and DNS resolves nowhere. A file page's PDF preview gets Open in Glaze with the document buttons:
// the click (and only it) reads the file through the worker's byte port, Glaze's PDF viewer takes the preview's place, and the
// button again puts Canvas's back. A module's .pptx row and a page's file link open the slides viewer below them, Esc there
// returns to the button, and Save to Documents keeps the deck. Settings → Writer → Slides off: no button by the deck (the PDF
// keeps its own); Previews in Glaze off: none at all. A file the server refuses, or one locked, keeps Canvas's preview and the
// button says so. Screenshots at 1280 px.
//   NODE_PATH=<playwright> nice node scripts/canvas-suite-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const G = require(path.join(root, 'defaults.js')), Z = require(path.join(root, 'lib/zip.js'));
const O = 'https://school.instructure.com', HOST = 'files.cdn-a.test';
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'gz-canvas-suite-check'));
const checks = [], errors = [], fetched = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 30000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${typeof label === 'function' ? await label() : label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
const fixture = (f) => fs.readFileSync(path.join(root, 'test/fixtures', f), 'utf8');

// A two-page Letter PDF whose pages say "This is page n".
const pdf = () => {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null), pages = add(null), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'), kids = [];
  for (let n = 1; n <= 2; n++) {
    const s = `BT /F1 24 Tf 72 700 Td (This is page ${n}) Tj ET`, content = add(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count 2 >>`;
  let s = '%PDF-1.7\n';
  const at = [];
  objs.forEach((body, i) => { at.push(s.length); s += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
};
// The slides fixture deck (test/fixtures/pptx/deck), zipped as slides-check does.
const deck = () => {
  const dir = path.join(root, 'test/fixtures/pptx/deck');
  const walk = (d, base = '') => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== '.DS_Store')
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), `${base}${e.name}/`) : [[`${base}${e.name}`, fs.readFileSync(path.join(d, e.name))]]));
  return Buffer.concat(Z.zip(walk(dir).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, data]) => ({ name, data: new Uint8Array(data), date: new Date(2026, 9, 29, 12) }))));
};
// The course's files: 21 a PDF, 22 a deck, 23 a PDF the server refuses, 24 locked, 25 a Word file (no kind of Glaze's here),
// 26 a CSV.
const FILES = {
  21: { name: 'Syllabus.pdf', body: pdf(), type: 'application/pdf' },
  22: { name: 'Week 3.pptx', body: deck(), type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  23: { name: 'Broken.pdf', body: null, type: 'application/pdf' },
  24: { name: 'Answers.pdf', body: pdf(), type: 'application/pdf', locked: true },
  25: { name: 'Notes.docx', body: Buffer.from('docx'), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  26: { name: 'Grades.csv', body: Buffer.from('Name,Score\nAda,91\nGrace,88\n'), type: 'text/csv' },
};
const api = (u) => {
  const f = /^\/api\/v1\/files\/(\d+)(\/public_url)?$/.exec(u.pathname), x = f && FILES[f[1]];
  if (x) return f[2] ? { public_url: `https://${HOST}/${f[1]}/${encodeURIComponent(x.name)}?sig=s` } : { id: f[1], display_name: x.name, filename: x.name, size: x.body?.length || 1000, 'content-type': x.type, locked_for_user: !!x.locked };
  if (u.pathname === '/api/v1/users/self' || u.pathname === '/api/v1/users/self/profile') return { id: '3', name: 'Sam' };
  return [];
};
const strip = (s) => s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
// The file page of file `id`: Canvas's #doc_preview with its own preview frame.
const FILE_PAGE = (id) => strip(fixture('canvas-file-preview.html'))
  .replace(/<div([^>]*) id="doc_preview"[^>]*>/, (m, a) => `<div${a} id="doc_preview" data-attachment_name="${FILES[id].name}" data-attachment_id="${id}" data-mimetype="${FILES[id].type}"><iframe id="canvas-own" src="/preview-stub/${id}" title="File preview for ${FILES[id].name}" style="width:100%;height:500px;border:0"></iframe>`);
// Files with its preview open (?preview=): the overlay as Canvas's Files draws it (ef-file-preview-*, the class names
// content.js PREVIEWS reads; its markup not yet saved from a live Canvas), the deck in it.
const FILES_PREVIEW = (id) => strip(fixture('canvas-file-preview.html')).replace(/<div id="doc_preview"[^>]*>/, `<div class="ef-file-preview-overlay" role="dialog"><div class="ef-file-preview-header"><h1 class="ef-file-preview-header-filename">${FILES[id].name}</h1></div>`
  + `<div class="ef-file-preview-stretch"><iframe class="ef-file-preview-frame" src="/preview-stub/${id}" title="File preview" style="width:100%;height:500px;border:0"></iframe></div></div><div>`);
// Modules: the File row copied once per file, each its own id and name.
const MODULES = (() => {
  const page = strip(fixture('canvas-modules.html'));
  const row = /<li id="context_module_item_272"[\s\S]*?<\/li>\s*(?=<li id="context_module_item_273")/.exec(page)[0];
  const rows = ['22', '21', '23', '24', '25', '26'].map((id, i) => row.replaceAll('context_module_item_272', `context_module_item_${80 + i}`).replaceAll('Attachment_21', `Attachment_${id}`).replaceAll('Syllabus.pdf', FILES[id].name)
    .replaceAll('/modules/items/272', `/modules/items/${80 + i}`).replaceAll('module-item-272', `module-item-${80 + i}`)).join('\n');
  return page.replace(row, rows);
})();
// A page with a file link to the deck, as the rich content editor writes one.
const WIKI = strip(fixture('canvas-wiki-page.html')).replace(/(<div class="show-content[^"]*"[^>]*>)/, `$1<p>Read <a title="Week 3.pptx" href="/courses/25/files/22?wrap=1" data-api-returntype="File">Week 3.pptx</a> first.</p>`);

(async () => {
  let ctx, held = false, tmp, passed = false;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\ncanvas-suite-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[canvas-suite-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-canvas-suite-'));
    fs.mkdirSync(out, { recursive: true });
    check(/show-content/.test(WIKI) && WIKI.includes('instructure_file_link') && (MODULES.match(/class="context_module_item [^"]*attachment/g) || []).length >= 6 && FILE_PAGE(21).includes('canvas-own'), 'the saved pages carry the preview, the five File rows and the file link');
    const ext = env.staged(root, [`https://${HOST}/*`]);
    const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(ctx);
    await ctx.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (['chrome-extension:', 'blob:', 'data:'].includes(u.protocol)) return r.continue();
      if (u.origin === O && u.pathname.startsWith('/api/v1/')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(api(u)) });
      if (u.origin === O && u.pathname.startsWith('/preview-stub/')) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Canvas preview</title><p id="canvas-preview">Canvas\'s own preview</p>' });
      const page = /^\/courses\/25\/files\/(\d+)$/.exec(u.pathname);
      if (u.origin === O && page && FILES[page[1]]) return r.fulfill({ contentType: 'text/html', body: FILE_PAGE(page[1]) });
      if (u.origin === O && u.pathname === '/courses/25/files' && FILES[u.searchParams.get('preview')]) return r.fulfill({ contentType: 'text/html', body: FILES_PREVIEW(u.searchParams.get('preview')) });
      if (u.origin === O && u.pathname === '/courses/25/modules') return r.fulfill({ contentType: 'text/html', body: MODULES });
      if (u.origin === O && u.pathname === '/courses/25/pages/week-3') return r.fulfill({ contentType: 'text/html', body: WIKI });
      if (u.hostname === HOST) {
        fetched.push(u.pathname);
        const f = FILES[u.pathname.split('/')[1]];
        return f?.body ? r.fulfill({ contentType: f.type, body: f.body }) : r.fulfill({ status: 500, body: '' });
      }
      return r.abort();
    });
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith(`chrome-extension://${id}/`) });
    const set = ({ enhance = {}, writer = {} } = {}) => sw.evaluate((s) => chrome.storage.sync.set(s), G.GZ_SANITIZE({ preset: 'Frost', navbar: { on: false }, footer: false,
      enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), bbPreviews: true, docPages: 'plain', ...enhance }, writer: { ...G.GZ_DEFAULTS.writer, pdf: true, slides: true, ...writer } }));
    await set();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    page.on('console', (m) => { const x = m.text(); if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(x)) errors.push(`console: ${x}`); });
    // What the page shows of Glaze, for a wait that times out.
    const seen = () => page.evaluate(() => JSON.stringify({ glaze: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('data-gz')).length, tools: document.getElementById('gz-doc-tools')?.outerHTML.slice(0, 300) || null,
      buttons: document.querySelectorAll('.gz-co, [data-gz="open"]').length, preview: !!document.querySelector('#doc_preview iframe') })).then((x) => `${x}; errors ${JSON.stringify(errors)}`);
    const shot = async (name) => { await page.screenshot({ path: path.join(out, name) }); };
    const frameOf = async (sel = 'iframe.gz-co-frame') => { const el = await page.$(sel); return el && el.contentFrame(); };
    const gz = (sel = 'iframe.gz-co-frame') => page.evaluate((sel) => { const f = document.querySelector(sel); if (!f) return null; const cs = getComputedStyle(f); return { shown: cs.display === 'block' && cs.opacity === '1' && f.getBoundingClientRect().height > 300, n: document.querySelectorAll('iframe.gz-co-frame').length }; }, sel);

    // ---- a file page's PDF preview: Open in Glaze with the document buttons, read only on the click
    await page.goto(`${O}/courses/25/files/21`);
    const roundB = '#gz-doc-tools button[data-gz="open"]';
    await until(() => page.locator(roundB).count(), async () => `Open in Glaze with the document buttons (${await seen()})`);
    const before = await page.evaluate((b) => ({ title: document.querySelector(b).title, pressed: document.querySelector(b).getAttribute('aria-pressed'), canvas: !!document.getElementById('canvas-own')?.getBoundingClientRect().height, above: !!(document.getElementById('gz-doc-tools').compareDocumentPosition(document.getElementById('doc_preview')) & Node.DOCUMENT_POSITION_FOLLOWING) }), roundB);
    check(before.title === 'Open in Glaze' && before.pressed === 'false' && before.canvas && before.above, `the file page: Open in Glaze above Canvas's preview, not pressed (${JSON.stringify(before)})`);
    check(fetched.length === 0, 'nothing was read from the file server before the click');
    await page.click(roundB);
    await until(async () => (await gz())?.shown, async () => `Glaze's viewer in the preview's place (${JSON.stringify(await gz())}; fetched ${JSON.stringify(fetched)}; state ${await page.getAttribute(roundB, 'data-gz-co')}; errors ${JSON.stringify(errors)})`);
    let fr = await until(() => frameOf(), 'the viewer\'s document');
    const pdfView = await until(() => fr.evaluate(() => { const t = document.querySelector('.pdfViewer .page[data-page-number="1"] .textLayer')?.textContent || ''; return /This is page 1/.test(t) && { doc: document.documentElement.dataset.doc, acts: [...document.querySelectorAll('[data-act]')].map((b) => b.dataset.act).join() }; }), 'page 1 drawn in Glaze\'s PDF viewer');
    const swapped = await page.evaluate((b) => ({ hidden: document.getElementById('doc_preview').hasAttribute('data-gz-co-hidden'), pressed: document.querySelector(b).getAttribute('aria-pressed'), after: document.getElementById('doc_preview').nextElementSibling?.classList.contains('gz-co-frame') }), roundB);
    check(pdfView.doc === 'pdf' && /original/.test(pdfView.acts) && /save/.test(pdfView.acts) && swapped.hidden && swapped.pressed === 'true' && swapped.after,
      `the PDF opens in Glaze's viewer in the preview's place, with Open original and Save to Documents (${JSON.stringify({ ...pdfView, ...swapped })})`);
    check(fetched.length === 1 && fetched[0] === '/21/Syllabus.pdf', `the click read the file once, through the worker's byte port (${JSON.stringify(fetched)})`);
    await shot('canvas-file-pdf-1280.png');
    await page.click(roundB);
    await until(() => page.evaluate(() => !document.querySelector('iframe.gz-co-frame') && !document.getElementById('doc_preview').hasAttribute('data-gz-co-hidden')), 'the button again: Canvas\'s preview back');
    check(await page.getAttribute(roundB, 'aria-pressed') === 'false', 'the button again puts Canvas\'s preview back');

    // ---- failure: the file server refuses; Canvas's preview stays and the button says so
    await page.goto(`${O}/courses/25/files/23`);
    await until(() => page.locator(roundB).count(), 'Open in Glaze on the broken file');
    await page.click(roundB);
    const broke = await until(() => page.evaluate((b) => { const x = document.querySelector(b); return /^failed:/.test(x.getAttribute('data-gz-co') || '') && { state: x.dataset.gzCo, title: x.title, frames: document.querySelectorAll('iframe.gz-co-frame').length, canvas: !document.getElementById('doc_preview').hasAttribute('data-gz-co-hidden') && document.getElementById('canvas-own').getBoundingClientRect().height > 0 }; }, roundB), 'the broken file\'s failure');
    check(broke.title === "Couldn't open this file in Glaze." && broke.frames === 0 && broke.canvas, `a file the server refuses: Canvas's preview stays, the button says so (${JSON.stringify(broke)})`);

    // ---- Files' preview (?preview=): the deck opens in the preview frame's place
    await page.goto(`${O}/courses/25/files?preview=22`);
    await until(() => page.locator(roundB).count(), 'Open in Glaze on Files\' preview');
    await page.click(roundB);
    await until(async () => (await gz())?.shown, 'the slides viewer in Files\' preview');
    fr = await until(() => frameOf(), 'the preview\'s viewer document');
    const filesPv = await until(() => fr.evaluate(() => document.getElementById('gs-at')?.textContent === '1 / 10' && document.querySelector('.gp-top h1')?.textContent));
    check(filesPv === 'Week 3.pptx' && await page.evaluate(() => document.querySelector('iframe.ef-file-preview-frame').hasAttribute('data-gz-co-hidden') && document.querySelector('iframe.ef-file-preview-frame').nextElementSibling?.classList.contains('gz-co-frame')),
      `Files' preview of a deck opens in Glaze's slides viewer in the preview frame's place (${filesPv})`);
    await shot('canvas-files-preview-slides-1280.png');

    // ---- Modules: the deck's row opens the slides viewer below it; the PDF row has its own button, the Word row none
    await page.goto(`${O}/courses/25/modules`);
    const rowB = (n) => `#context_module_item_${n} .gz-co`;
    await until(() => page.evaluate(() => document.querySelectorAll('.gz-co').length === 5), async () => `buttons by the five rows Glaze opens (${await page.evaluate(() => document.querySelectorAll('.gz-co').length)})`);
    const rows = await page.evaluate(() => [80, 81, 82, 83, 84, 85].map((n) => document.querySelector(`#context_module_item_${n} .gz-co`)?.textContent || ''));
    check(JSON.stringify(rows) === JSON.stringify(['Open in Glaze', 'Open in Glaze', 'Open in Glaze', 'Open in Glaze', '', 'Open in Glaze']), `Open in Glaze by the .pptx, .pdf and .csv rows, none by the .docx (${JSON.stringify(rows)})`);
    await page.click(rowB(80));
    await until(async () => (await gz())?.shown, 'the slides viewer below the deck\'s row');
    fr = await until(() => frameOf(), 'the slides viewer\'s document');
    const slides = await until(() => fr.evaluate(() => document.querySelector('#gs-canvas .gs-slide') && { at: document.getElementById('gs-at')?.textContent, doc: document.documentElement.dataset.doc, title: document.querySelector('.gp-top h1')?.textContent, acts: [...document.querySelectorAll('[data-act]')].map((b) => b.dataset.act).join() }), 'slide 1 in Glaze\'s slides viewer');
    const placed = await page.evaluate(() => ({ expanded: document.querySelector('#context_module_item_80 .gz-co').getAttribute('aria-expanded'), inline: document.querySelector('#context_module_item_80 a.item_link').nextElementSibling?.classList.contains('gz-co'), below: document.querySelector('#context_module_item_80 .ig-row').nextElementSibling?.classList.contains('gz-co-frame') }));
    check(slides.at === '1 / 10' && slides.doc === 'slides' && slides.title === 'Week 3.pptx' && /save/.test(slides.acts) && placed.expanded === 'true' && placed.inline && placed.below,
      `the deck opens in Glaze's slides viewer below its row (${JSON.stringify({ ...slides, ...placed })})`);
    await shot('canvas-modules-slides-1280.png');
    // Esc in the viewer: back to the row's button.
    await fr.focus('#gs-canvas');
    await fr.press('#gs-canvas', 'Escape');
    await until(() => page.evaluate(() => document.activeElement === document.querySelector('#context_module_item_80 .gz-co')), 'Esc in the viewer returns to the button');
    check(true, 'Esc in the viewer returns to the row\'s button');
    // Save to Documents keeps the deck as a document of the slides kind.
    await fr.click('[data-act="save"]');
    await until(() => fr.evaluate(() => document.querySelector('.gp-top .gp-state')?.textContent === 'Saved to Documents'), async () => `Saved to Documents (says "${await fr.evaluate(() => document.querySelector('.gp-top .gp-state')?.textContent)}"; errors ${JSON.stringify(errors)})`);
    const kept = await sw.evaluate(async () => { const all = await chrome.storage.local.get(null); return Object.entries(all).filter(([k, v]) => k.startsWith('writerPaper:') && v?.kind === 'slides').map(([, v]) => ({ title: v.title, slides: v.slides })); });
    check(kept.length === 1 && kept[0].title === 'Week 3' && kept[0].slides === 10, `Save to Documents keeps the deck (${JSON.stringify(kept)})`);
    await page.click(rowB(80));
    await until(() => page.evaluate(() => !document.querySelector('iframe.gz-co-frame')), 'the button again closes the viewer');
    check(await page.getAttribute(rowB(80), 'aria-expanded') === 'false', 'the row\'s button again closes Glaze\'s viewer');
    // The CSV: the grid from memory, an edit kept nowhere, Save to Documents a spreadsheet.
    const papersNow = () => sw.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith('writerPaper:')).map(([, v]) => ({ kind: v.kind || 'paper', title: v.title })));
    const had = (await papersNow()).length;
    await page.click(rowB(85));
    await until(async () => (await gz())?.shown, 'the grid below the CSV\'s row');
    fr = await until(() => frameOf(), 'the grid\'s document');
    const cell = (r, c) => fr.evaluate(([r, c]) => document.querySelector(`#gx-grid .gx-c[data-r="${r}"][data-c="${c}"]`)?.textContent ?? null, [r, c]);
    await until(async () => (await cell(1, 0)) === 'Ada', 'Ada in A2');
    const sheet = await fr.evaluate(() => ({ doc: document.documentElement.dataset.doc, title: document.querySelector('.gp-top h1')?.textContent, versions: !!document.getElementById('gx-versions'), acts: [...document.querySelectorAll('.gx-tool [data-act]')].map((b) => b.dataset.act).join() }));
    check(sheet.doc === 'sheet' && sheet.title === 'Grades.csv' && !sheet.versions && sheet.acts === 'original,save' && await cell(2, 1) === '88', `the CSV opens in Glaze's grid from memory, no Versions, Open original and Save to Documents (${JSON.stringify(sheet)})`);
    await fr.fill('#gx-name', 'B2');
    await fr.press('#gx-name', 'Enter');
    await until(() => fr.evaluate(() => document.activeElement?.id === 'gx-grid'), 'B2 chosen in the Name box');
    await page.keyboard.type('95');
    await page.keyboard.press('Enter');
    await until(async () => (await cell(1, 1)) === '95', 'the edit on the screen');
    const afterEdit = await fr.evaluate(() => document.querySelector('.gp-top .gp-state')?.textContent || '');
    check(afterEdit === '' && (await papersNow()).length === had, `an edit shows and is kept nowhere, nor said to be saving (state "${afterEdit}")`);
    await fr.click('[data-act="save"]');
    await until(() => fr.evaluate(() => document.querySelector('.gx-said')?.textContent === 'Saved to Documents'), async () => `the CSV saved to Documents (says "${await fr.evaluate(() => document.querySelector('.gx-said')?.textContent)}"; errors ${JSON.stringify(errors)})`);
    const sheets = (await papersNow()).filter((p) => p.kind === 'sheet');
    check(sheets.length === 1 && sheets[0].title === 'Grades', `Save to Documents keeps the CSV as a spreadsheet (${JSON.stringify(sheets)})`);
    await page.click(rowB(85));
    await until(() => page.evaluate(() => !document.querySelector('iframe.gz-co-frame')), 'the grid closed');
    // A locked file: said on the button, nothing opened.
    await page.click(rowB(83));
    const locked = await until(() => page.evaluate(() => { const b = document.querySelector('#context_module_item_83 .gz-co'); return /^failed:/.test(b.dataset.gzCo || '') && { text: b.textContent, frames: document.querySelectorAll('iframe.gz-co-frame').length }; }), 'the locked file\'s answer');
    check(locked.text === "This file isn't available to you right now." && locked.frames === 0, `a locked file: the button says so, nothing opens (${JSON.stringify(locked)})`);
    check(!fetched.includes('/24/Answers.pdf'), 'and nothing of it was read');

    // ---- a page's file link opens the deck below its paragraph
    await page.goto(`${O}/courses/25/pages/week-3`);
    await until(() => page.locator('#content .show-content .gz-co').count(), 'Open in Glaze by the file link');
    await page.click('#content .show-content .gz-co');
    await until(async () => (await gz())?.shown, 'the slides viewer below the link');
    fr = await until(() => frameOf(), 'the link\'s viewer document');
    check(await until(() => fr.evaluate(() => document.getElementById('gs-at')?.textContent === '1 / 10')) && await page.evaluate(() => document.querySelector('#content .show-content p .gz-co') && document.querySelector('#content .show-content p').nextElementSibling?.classList.contains('gz-co-frame')),
      'a page\'s API file link without a class opens the deck below its paragraph');

    // ---- Settings → Writer → Slides and Spreadsheets off: no button by the deck or the CSV; the PDF keeps its own
    await set({ writer: { slides: false, sheets: false } });
    await page.goto(`${O}/courses/25/modules`);
    await until(() => page.locator(rowB(81)).count(), 'the PDF row\'s button with Slides off');
    check(await page.locator(rowB(80)).count() === 0 && await page.locator(rowB(85)).count() === 0, 'Slides and Spreadsheets off: no Open in Glaze by the deck or the CSV');
    // ---- Previews in Glaze off: none at all (Download all's buttons show the page's pass ran)
    await set({ enhance: { bbPreviews: false, download: true } });
    await page.goto(`${O}/courses/25/modules`);
    await until(() => page.locator('.gz-dl').count(), 'Download all on the page with Previews in Glaze off');
    check(await page.locator('.gz-co').count() === 0, 'Previews in Glaze off: no Open in Glaze on Canvas');

    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    passed = true;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'canvas-suite-results.json'), `${JSON.stringify({ passed, checks, errors, fetched }, null, 2)}\n`);
    console.log(`${passed ? 'PASS' : 'FAIL'} canvas-suite-check: ${checks.length} checks`);
  }
})();
