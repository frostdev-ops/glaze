// An assignment's PDF and slide deck in Glaze Writer (writer-kinds.js), in the real unpacked extension on the synthetic
// Ultra attempt writer-submit-check.js uses (test/fixtures/ultra-writer-attempt.html, Quill 1.3.7, its Ultra stand-in:
// scripts/ultra-attempt-harness.js), from the compact box (Full writer off, the default). With Settings → Writer → PDFs and
// Slides on: a .pdf dropped on Ultra's file area reaches the frame before Ultra hears it; the card asks Open in Glaze or
// Submit as is; Open in Glaze keeps the paper as a version, makes the attempt's record a PDF and shows pdf.js's viewer in
// the paper's place, as tall as a paper; a field filled is saved; Submit… sends the saved PDF (its bytes, application/pdf,
// Lastname_Title.pdf) through Ultra's upload once and clicks Ultra's Submit once; a reload opens the viewer again, the field
// still filled. The same for a .pptx: the deck in the slides viewer, and Submit sends the very bytes brought. With
// no spreadsheet kind in this build, neither Document/Spreadsheet nor New spreadsheet is offered, even if the gate is
// asked with a future spreadsheet preference (today's settings sanitizer does not retain writer.sheets).
// Switches off: a PDF on Ultra's file area is Ultra's, as before (writer-submit-check.js covers the rest of today's flows).
// GETs only, synthetic. NODE_PATH=<playwright> node scripts/writer-kinds-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const HARNESS = require('./ultra-attempt-harness.js');
const { tap } = require('./frame-tap.js');
const PDF = require('./pdf-fixtures.js');
const Z = require('../lib/zip.js');
const site = 'https://bb.school.test';
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-kinds-check');
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
const quiet = async (fn, label, ms = 800) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) throw Error(`${label}: it happened`); await pause(80); } return true; };
const sha = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');
// The fixture deck as its package (scripts/slides-check.js's): every part under test/fixtures/pptx/deck, stored.
const deck = () => {
  const dir = path.join(root, 'test/fixtures/pptx/deck');
  const walk = (d, base = '') => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== '.DS_Store')
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), `${base}${e.name}/`) : [[`${base}${e.name}`, fs.readFileSync(path.join(d, e.name))]]));
  return Buffer.concat(Z.zip(walk(dir).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, data]) => ({ name, data: new Uint8Array(data), date: new Date(2026, 9, 29, 12) }))));
};
// A PDF's text field value as pdf.js writes it: a literal string, or UTF-16 in hex.
const holds = (bytes, value) => {
  const s = Buffer.from(bytes).toString('latin1');
  const hex = Buffer.from(`﻿${value}`, 'utf16le').swap16().toString('hex');
  return s.includes(`(${value})`) || s.toLowerCase().includes(hex);
};

(async () => {
  let context, held = false, tmp;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-kinds-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-kinds-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-kinds-'));
    fs.mkdirSync(out, { recursive: true });
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    if (crypto.createHash('sha256').update(quill).digest('hex') !== QUILL.sha256) throw Error('Quill 1.3.7 hash mismatch');
    const ext = require('./check-env.js').staged(root, [`${site}/*`]);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(20000);
    const grades = JSON.parse(fixture('ultra-writer-gradebook.json')), members = JSON.parse(fixture('ultra-memberships.json'));
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      if (req.isNavigationRequest() && u.pathname === ATTEMPT) return r.fulfill({ contentType: 'text/html', body: fixture('ultra-writer-attempt.html').replace('<head>', '<head><base href="/ultra/">').replace('</body>', '<script src="/gz-check/quill.js"></script><script src="/gz-check/harness.js"></script></body>') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      let data = { results: [] };
      if (u.pathname.endsWith('/users/me')) data = { id: '_900_1', userName: 'synthetic', givenName: 'Alex', familyName: 'Rivera' };
      else if (/\/users\/_900_1\/memberships$/.test(u.pathname)) data = members;
      else if (u.pathname.includes('/gradebook/grades')) data = grades;
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const settings = (w) => G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, writerUploads: true, drafts: true }, writer: { full: false, ...w } });
    const reset = (w) => worker.evaluate(async ({ s, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(s); await chrome.storage.local.set({ ultra: [site] }); }, { s: settings(w), site });
    await reset({ pdf: true, slides: true });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();
    const local = () => worker.evaluate(async () => chrome.storage.local.get(null));
    const record = async () => { const all = await local(), k = Object.keys(all).find((x) => x.startsWith('writerPaper:')); return k ? all[k] : null; };
    const versions = async () => { const all = await local(), k = Object.keys(all).find((x) => x.startsWith('writerVersions:')); return all[k] || []; };
    const open = async () => {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`page console: ${m.text()}`); });
      await p.goto(`${site}${ATTEMPT}?mode=empty`);
      const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity) && x; }, 'the frame shown', 30000);
      const fr = await until(() => el.contentFrame(), 'frame document');
      await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key()), 'loaded', 30000);
      return { p, el, fr };
    };
    const give = (p, name, type, bytes) => p.evaluate(({ name, type, bytes }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { type }));
      const at = document.querySelector('[class*="makeStylesinputContainer-"]');
      for (const t of ['dragenter', 'dragover', 'drop']) at.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, { name, type, bytes: Array.from(bytes) });
    const cardOf = (fr) => fr.evaluate(() => { const c = document.querySelector('.gi-layer[data-open] .gi-card'); return c && { name: c.querySelector('.gi-file b').textContent, tiles: [...c.querySelectorAll('.gi-choice > span:first-of-type')].map((x) => x.textContent) }; });
    const sheetOf = (fr) => fr.evaluate(() => { const L = document.querySelector('.gs-layer[data-open]'), q = (x) => L?.querySelector(x); return L && { name: q('.gs-name').textContent, big: q('.gs-big .gs-doc')?.textContent || '', toggle: !!q('.gs-toggle:not([for="gs-keep"])'), size: q('.gs-file small').textContent, title: q('h2').textContent }; });
    const shot = async (p, name) => { await pause(300); const f = path.join(out, name); await p.screenshot({ path: f }); return f; };
    const pdfBytes = PDF.acroform(), deckBytes = deck();

    // ---- no spreadsheet kind in this build: no choice offered, including with the future preference passed to the gate
    let { p, el, fr } = await open();
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'compact');
    await quiet(() => fr.evaluate(() => !!document.querySelector('.gk-choose')), 'Document/Spreadsheet offered without a spreadsheet kind');
    check(await fr.evaluate(() => GZ_WRITER_KINDS.offers({ sheets: true }).length === 0 && !document.querySelector('.gk-choose') && ![...document.querySelectorAll('#menu [role="menuitem"]')].some((b) => /spreadsheet/i.test(b.textContent))), 'no spreadsheet kind here: even with sheets on the gate offers nothing; no Document/Spreadsheet choice or New spreadsheet');
    await fr.locator('#gw .ProseMirror').fill('Text beside the PDF.');
    await until(() => p.evaluate(() => __text().trim() === 'Text beside the PDF.'), 'compact text in Ultra');

    // ---- a PDF: Ultra's file area → the card → Open in Glaze → the viewer in the paper's place
    const h0 = await el.evaluate((f) => f.getBoundingClientRect().height);
    await give(p, 'Field trip form.pdf', 'application/pdf', pdfBytes);
    await until(() => cardOf(fr), 'the card');
    const card = await cardOf(fr);
    check(card.tiles.join('|') === 'Open in Glaze|Submit as is' && card.name === 'Field trip form.pdf' && await p.evaluate(() => __uploads.length === 0), `a .pdf on Ultra's file area asks Open in Glaze or Submit as is, Ultra hearing nothing (${JSON.stringify(card)})`);
    await tap(fr, '.gi-default');
    await until(() => fr.evaluate(() => document.documentElement.dataset.doc === 'pdf' && document.querySelectorAll('.gk .pdfViewer .page').length === 3 && !!document.querySelector('.gk .pdfViewer .page[data-page-number="1"] canvas')), 'the PDF viewer', 40000,
      () => fr.evaluate(() => ({ doc: document.documentElement.dataset.doc, pages: document.querySelectorAll('.pdfViewer .page').length, said: document.querySelector('.gq-said')?.textContent })));
    const h1 = await until(async () => { const h = await el.evaluate((f) => f.getBoundingClientRect().height); return h > 600 && h; }, 'a paper\'s height');
    let rec = await record(), vs = await versions();
    check(rec.kind === 'pdf' && sha(Buffer.from(rec.file, 'base64')) === sha(pdfBytes) && rec.pages === 3 && rec.doc == null, `the attempt's record is the PDF, its bytes as brought (${JSON.stringify({ kind: rec.kind, pages: rec.pages, size: rec.size })})`);
    check(vs.some((v) => v.reason === 'import' && (v.kind || 'paper') === 'paper'), `the paper kept as a version first (${vs.map((v) => `${v.reason}:${v.kind || 'paper'}`).join(', ')})`);
    check(await fr.evaluate(() => { const shown = (x) => !!x && x.getClientRects().length > 0; return !shown(document.querySelector('#gw')) && !shown(document.querySelector('.gp:not(.gp-standalone)')) && shown(document.querySelector('.gk .gp-submit')) && !document.querySelector('.gk .gp-top a[href]'); }),
      `the viewer in the paper's place, its own Submit…, no way to Documents (frame ${h0}px → ${h1}px)`);
    await shot(p, 'kinds-pdf-1440.png');
    // Fill the form's text field: saved.
    const input = fr.locator('.gk .page[data-page-number="1"] .annotationLayer input').first();
    await input.fill('Rivera Field');
    await input.press('Tab');
    await until(async () => holds(Buffer.from((await record()).file, 'base64'), 'Rivera Field'), 'the filled PDF saved', 20000);
    rec = await record();
    check(rec.kind === 'pdf' && rec.file && holds(Buffer.from(rec.file, 'base64'), 'Rivera Field'), `a filled field is saved into the record's PDF (${rec.size} bytes)`);
    // PDF → Word → Undo exercises the real importer, file-version restore and viewer disposal in the assignment frame.
    const word = await fr.evaluate(async () => {
      await GZ_WRITER_PAPER.need(['lib/writer-color.js', 'lib/zip.js', 'lib/doctext.js', 'lib/writer-docx.js', 'lib/writer-objects-docx.js']);
      const doc = GZ_WRITER_SCHEMA.paper.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Replacement Word draft.' }] }] });
      return Array.from((await GZ_WRITER_DOCX.exportDocx(doc, { format: GZ_WRITER_STYLES.get('plain') })).bytes);
    });
    await give(p, 'replacement.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', word);
    await until(() => cardOf(fr), 'Word card over PDF');
    await tap(fr, '.gi-default');
    await until(async () => (await record())?.kind === 'paper' && await fr.evaluate(() => !document.documentElement.dataset.doc && GZ_WRITER_PAPER.current()?.editor?.text().includes('Replacement Word draft.')), 'Word replaces PDF');
    check(!(await record()).file && await fr.evaluate(() => !!document.querySelector('.gp-toast-do')), 'Word import replaces the PDF only after parsing and offers Undo');
    await tap(fr, '.gp-toast-do');
    await until(() => fr.evaluate(() => document.documentElement.dataset.doc === 'pdf' && document.querySelector('.gk .annotationLayer input')?.value === 'Rivera Field'), 'Undo restores filled PDF', 40000);
    check((await record()).kind === 'pdf' && holds(Buffer.from((await record()).file, 'base64'), 'Rivera Field'), 'Undo restores the PDF kind, its viewer and its filled bytes');
    // Submit…: the sheet with the PDF large, no paste switch; Submit attaches the saved PDF once and clicks Ultra's Submit once.
    await tap(fr, '.gk .gp-submit');
    await until(() => sheetOf(fr), 'the sheet');
    const sh = await sheetOf(fr);
    check(sh.name === 'Rivera_Essay2.pdf' && sh.big === 'PDF' && !sh.toggle, `the sheet names the PDF Lastname_Title.pdf, no paste switch (${JSON.stringify(sh)})`);
    await until(() => fr.evaluate(() => document.querySelector('#gs-held')?.value === 'Text beside the PDF.'), 'held compact text shown');
    check(await fr.evaluate(() => document.querySelector('#gs-keep').getAttribute('aria-checked') === 'false'), 'the old compact text is shown in the sheet with Keep off by default');
    await shot(p, 'kinds-pdf-sheet-1440.png');
    await tap(fr, '.gs-primary');
    await until(() => p.evaluate(() => __clicks.filter((c) => /footer\.submit/.test(c)).length === 1), 'Ultra\'s Submit clicked', 40000, () => p.evaluate(() => ({ uploads: __uploads.map((u) => u.name), clicks: __clicks, log: __log, err: null })));
    await quiet(() => p.evaluate(() => __clicks.filter((c) => /footer\.submit/.test(c)).length > 1 || __uploads.length > 1), 'a second upload or Submit');
    const up = await p.evaluate(() => __uploads.map((u) => ({ name: u.name, type: u.type, bytes: u.bytes })));
    rec = await record(); vs = await versions();
    check(up.length === 1 && up[0].name === 'Rivera_Essay2.pdf' && up[0].type === 'application/pdf' && sha(up[0].bytes) === sha(Buffer.from(rec.file, 'base64')) && holds(up[0].bytes, 'Rivera Field'),
      `the saved PDF attached once: its name, application/pdf, the record's very bytes, the field filled (${up.map((u) => `${u.name} ${u.type} ${u.bytes.length}`).join('; ')})`);
    check(await until(async () => (await versions()).some((v) => v.reason === 'submit'), 'the Submitted version'), 'Ultra\'s Submit clicked once; the version is marked Submitted');
    check(await p.evaluate(() => !__text().trim()), 'PDF submission with Keep off clears the old compact text from Ultra');
    await p.close();

    // ---- the attempt again: the PDF viewer at once, the field still filled
    ({ p, el, fr } = await open());
    await until(() => fr.evaluate(() => document.documentElement.dataset.doc === 'pdf' && !!document.querySelector('.gk .annotationLayer input')), 'the viewer again', 40000);
    const again = await until(() => fr.evaluate(() => document.querySelector('.gk .annotationLayer input')?.value), 'the field');
    check(again === 'Rivera Field' && await fr.evaluate(() => !document.querySelector('.gw .ProseMirror')?.getClientRects().length), `a reload opens the PDF viewer, the field still filled (${again})`);
    await p.close();

    // ---- a deck: Open in Glaze → the slides viewer; Submit sends the very bytes brought
    await reset({ pdf: true, slides: true });
    ({ p, el, fr } = await open());
    await give(p, 'Cell Biology week 3.pptx', PPTX, deckBytes);
    await until(() => cardOf(fr), 'the deck\'s card');
    check((await cardOf(fr)).tiles.join('|') === 'Open in Glaze|Submit as is', 'a .pptx asks Open in Glaze or Submit as is');
    await tap(fr, '.gi-default');
    await until(() => fr.evaluate(() => document.documentElement.dataset.doc === 'slides' && document.querySelectorAll('.gk .gs-rail-b').length === 10 && !!document.querySelector('.gk #gs-canvas [role="group"]')), 'the slides viewer', 40000);
    rec = await record(); vs = await versions();
    check(rec.kind === 'slides' && rec.slides === 10 && sha(Buffer.from(rec.file, 'base64')) === sha(deckBytes) && vs.some((v) => v.reason === 'import'), `the record is the deck, its bytes as brought, the paper a version first (${JSON.stringify({ kind: rec.kind, slides: rec.slides })})`);
    await shot(p, 'kinds-slides-1440.png');
    await tap(fr, '.gk .gp-submit');
    await until(() => sheetOf(fr), 'the deck\'s sheet');
    check((await sheetOf(fr)).name === 'Rivera_Essay2.pptx', `the sheet names the deck Lastname_Title.pptx (${(await sheetOf(fr)).name})`);
    await tap(fr, '.gs-primary');
    await until(() => p.evaluate(() => __clicks.filter((c) => /footer\.submit/.test(c)).length === 1), 'Ultra\'s Submit clicked for the deck', 40000);
    await quiet(() => p.evaluate(() => __uploads.length > 1), 'a second upload');
    const dup = await p.evaluate(() => __uploads.map((u) => ({ name: u.name, type: u.type, bytes: u.bytes })));
    check(dup.length === 1 && dup[0].name === 'Rivera_Essay2.pptx' && dup[0].type === PPTX && sha(dup[0].bytes) === sha(deckBytes), `the deck attached once, byte for byte, as a presentation (${dup.map((u) => `${u.name} ${u.type}`).join('; ')})`);
    await p.close();

    // ---- switches off: a PDF on Ultra's file area is Ultra's, as before
    await reset({});
    ({ p, el, fr } = await open());
    await give(p, 'Field trip form.pdf', 'application/pdf', pdfBytes);
    await until(() => p.evaluate(() => __uploads.length === 1), 'Ultra took the PDF');
    check(await p.evaluate(() => __uploads[0].via === 'drop') && await fr.evaluate(() => !document.querySelector('.gi-layer, .gs-layer') && !document.documentElement.dataset.doc), 'PDFs and Slides off: a PDF on Ultra\'s file area is Ultra\'s, no card, no viewer');
    await p.close();

    check(!errors.length, `no page errors (${errors.join(' | ')})`);
    passed = true;
  } catch (e) {
    console.error(e);
    if (errors.length) console.error('page errors:', errors.join('\n'));
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    console.log(`${passed ? 'PASS' : 'FAIL'} writer-kinds-check: ${checks.length} checks`);
  }
})();
