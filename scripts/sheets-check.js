// Spreadsheets on the Documents page (papers.html, sheet-kind.js, sheet-grid.js) in the real unpacked extension. With
// Settings → Writer → Spreadsheets off (writer.sheets, the default) the New band has no Spreadsheet tile, a .csv is refused
// with the Word string, and a spreadsheet already stored still opens. On: the tile opens a blank workbook; values and
// formulas typed into it compute; the fill handle continues a series and shifts a formula; copy and paste (Glaze's own copy
// keeping formulas, Excel's HTML with its number formats); rows inserted and deleted move formulas; a renamed sheet's
// references follow it; freeze, sort, undo and redo; closing and opening again keeps it all; Export writes the file; the
// keyboard's paths through the grid; a 640 px layout. No page errors, no network, no timer under a minute. Screenshots at
// 1280 and 640 px.
// NODE_PATH=<playwright> nice -n 10 node scripts/sheets-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const M = require(path.join(root, 'lib/sheet-model.js'));
const SD = require(path.join(root, 'sheet-data.js'));
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-sheets-check');
const checks = [], errors = [], requests = [], shots = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

// A spreadsheet stored as Documents stores one (sheet-data.js): its record, its index row and its parts.
const seeded = (key, wb = M.workbook()) => {
  const sh = wb.sheets[0];
  sh.rows.set(0, new Map([[0, { t: 's', v: 'Seeded' }], [1, { t: 'n', v: 42 }]]));
  const { book, parts } = SD.split(wb);
  const rec = { key, kind: 'sheet', title: 'Kept sheet', named: true, created: 1, updated: Date.now(), revision: 1, edited: 1, book, parts: Object.fromEntries([...parts.keys()].map((n) => [n, 1])),
    grid: SD.glance(wb), text: SD.text(wb), ...SD.measure(wb) };
  return { [`writerPaper:${key}`]: rec, writerPapers: [{ key, kind: 'sheet', named: true, title: 'Kept sheet', course: '', url: '', words: 0, updated: rec.updated, submitted: null, grid: rec.grid }],
    ...Object.fromEntries([...parts].map(([n, rows]) => [`writerSheet:${key}:${n}`, { rows, rev: 1 }])) };
};

(async () => {
  let context, held = false, tmp, passed = false;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nsheets-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[sheets-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sheets-'));
    fs.mkdirSync(out, { recursive: true });
    const csv = path.join(tmp, 'Scores.csv');
    fs.writeFileSync(csv, '﻿Name,Score\r\nAda,91\r\nGrace,88\r\n');
    const ext = env.staged(root, []);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'en-US',
      reducedMotion: 'reduce', acceptDownloads: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    const first = env.noFirstRun(context); context.setDefaultTimeout(15000);
    await context.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.protocol === 'chrome-extension:' || u.protocol === 'blob:' || u.protocol === 'data:') return r.continue(); requests.push(u.href); return r.abort(); });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const settings = (sheets) => G.GZ_SANITIZE({ preset: 'Frost', enhance: { ...G.GZ_DEFAULTS.enhance, writer: true }, writer: { ...G.GZ_DEFAULTS.writer, sheets } });
    const HOME = `chrome-extension://${id}/papers.html`;
    const page = await context.newPage();
    // Every interval the page starts, with its delay: none may fire more often than once a minute.
    await page.addInitScript(() => {
      const si = globalThis.setInterval;
      globalThis.gzIntervals = [];
      globalThis.setInterval = function (fn, ms, ...rest) { globalThis.gzIntervals.push(Number(ms) || 0); return si.call(this, fn, ms, ...rest); };
    });
    page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    page.on('console', (m) => { const x = m.text(); if (m.type() === 'error' && !/Failed to load resource/.test(x)) errors.push(`console: ${x}`); });
    await page.goto(HOME);
    await env.installed(page);
    await first.catch(() => {});
    await worker.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(s); }, settings(false));
    const local = (k) => worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k] ?? null, k);
    const painted = () => page.evaluate(async () => { await document.fonts.ready; await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); });
    const shot = async (name) => { await painted(); const f = path.join(out, name); await page.screenshot({ path: f }); shots.push(f); };
    const openHome = async () => { await page.goto(HOME); await until(() => page.evaluate(() => !document.getElementById('list').hidden), 'home'); };
    const said = () => page.evaluate(() => document.getElementById('gd-said').textContent);
    // The grid's view of a cell: its shown text, by row and column (0-based), where it is drawn.
    // (after the frame a change or a move draws in)
    const cell = (r, c) => page.evaluate(async ([r, c]) => { await new Promise(requestAnimationFrame); return document.querySelector(`#gx-grid .gx-c[data-r="${r}"][data-c="${c}"]`)?.textContent ?? null; }, [r, c]);
    const nameBox = () => page.evaluate(() => document.getElementById('gx-name').value);
    const formula = () => page.evaluate(() => document.getElementById('gx-formula').value);
    const grid = () => page.waitForSelector('#gx-grid .gx-c[data-r="0"][data-c="0"]');
    const go = async (ref) => { await page.click('#gx-name'); await page.fill('#gx-name', ref); await page.keyboard.press('Enter'); await until(async () => (await nameBox()) === ref.toUpperCase(), `go to ${ref}`); };
    const type = async (text) => { await page.keyboard.type(text); await page.keyboard.press('Enter'); };
    const saved = async (key) => until(async () => { const busy = await page.evaluate(() => document.querySelector('.gp-top .gp-state')?.textContent || ''); const rec = await local(`writerPaper:${key}`); return !busy && rec; }, 'saved');

    // ---- off: no tile, a .csv refused, a spreadsheet already here opens
    const kept = 'doc:00000000-0000-4000-8000-00000000c0de';
    await worker.evaluate(async (o) => { await chrome.storage.local.set(o); }, seeded(kept));
    await openHome();
    const off = await page.evaluate(() => ({ tile: !!document.querySelector('.gd-tile[data-kind="sheet"]'), accept: document.getElementById('gd-file').accept, label: document.getElementById('gd-import').textContent, tiles: document.querySelectorAll('.gd-tile').length }));
    check(!off.tile && off.tiles === 4 && !/xlsx|csv|spreadsheet/i.test(off.accept) && off.label === 'Import .docx…', `off: no Spreadsheet tile, Word files only (${JSON.stringify(off)})`);
    await page.setInputFiles('#gd-file', csv);
    await until(said, 'off: refusal');
    check(await said() === 'That file could not be read as a Word document.', 'off: a .csv is refused with the Word string');
    check(((await local('writerPapers')) || []).length === 1, 'off: nothing new stored');
    const keptCard = await until(() => page.evaluate((k) => { const c = document.querySelector(`.gd-card[data-key="${k}"]`); return c && c.querySelector('.gx-thumb') ? { meta: c.querySelector('.gd-meta').textContent, text: c.querySelector('.gx-thumb').textContent, href: c.querySelector('.gd-title').getAttribute('href') } : null; }, kept), 'off: the kept card');
    check(/^Spreadsheet/.test(keptCard.meta) && /Seeded/.test(keptCard.text) && /42/.test(keptCard.text) && keptCard.href === `papers.html?sheet=${encodeURIComponent(kept)}`, `off: the kept spreadsheet's card shows its cells (${JSON.stringify(keptCard)})`);
    await page.click(`.gd-card[data-key="${kept}"] .gd-title`);
    await grid();
    check(await cell(0, 0) === 'Seeded' && await cell(0, 1) === '42', 'off: a stored spreadsheet still opens');
    // A link to a missing spreadsheet, or a new one while off, goes home.
    await page.goto(`${HOME}?sheet=${encodeURIComponent('doc:00000000-0000-4000-8000-000000000001')}&new`);
    await until(() => page.evaluate(() => !document.getElementById('list').hidden && location.search === ''), 'off: a new-sheet link goes home');
    check(true, 'off: ?sheet=…&new goes home');

    // ---- on: the tile, the chooser, a .csv import
    await worker.evaluate(async (s) => { await chrome.storage.sync.set(s); }, settings(true));
    await openHome();
    const on = await page.evaluate(() => { const t = document.querySelector('.gd-tile[data-kind="sheet"]'); return { tile: !!t, name: t?.querySelector('.gd-tile-name')?.textContent, cells: t?.querySelectorAll('.gx-th-c').length, accept: document.getElementById('gd-file').accept, label: document.getElementById('gd-import').textContent, tiles: document.querySelectorAll('.gd-tile').length }; });
    check(on.tile && on.name === 'Spreadsheet' && on.cells === 24 && on.tiles === 5 && /\.xlsx/.test(on.accept) && /\.csv/.test(on.accept) && on.label === 'Import…', `on: the Spreadsheet tile, a 6×4 grid, and the chooser takes spreadsheets (${JSON.stringify(on)})`);
    await shot('home-1280.png');
    await page.setViewportSize({ width: 640, height: 900 });
    await painted();
    const row = await page.evaluate(() => [...document.querySelectorAll('.gd-tile')].map((t) => Math.round(t.getBoundingClientRect().top)));
    check(new Set(row).size === 1 && row.length === 5, `640 px: the five New tiles share one row (${row})`);
    await shot('home-640.png');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.setInputFiles('#gd-file', csv);
    const imported = await until(() => page.evaluate((kept) => [...document.querySelectorAll('.gd-card')].map((c) => c.dataset.key).find((k) => k !== kept), kept), 'the imported card');
    const irec = await until(() => local(`writerPaper:${imported}`), 'the imported record');
    check(irec.kind === 'sheet' && irec.title === 'Scores' && irec.cells === 6 && irec.grid[1][0] === 'Ada' && irec.grid[2][1] === '88', `the .csv: a sheet record, its cells and card text (${JSON.stringify({ kind: irec.kind, title: irec.title, cells: irec.cells, grid: irec.grid.slice(0, 3) })})`);
    check(((await local(`writerVersions:${imported}`)) || []).length === 1, 'the import keeps a first version');

    // ---- New → Spreadsheet: a blank workbook, nothing stored before the first edit
    const before = ((await local('writerPapers')) || []).length;
    await page.click('.gd-tile[data-kind="sheet"]');
    await grid();
    const key = await page.evaluate(() => new URLSearchParams(location.search).get('sheet'));
    check(/^doc:/.test(key) && ((await local('writerPapers')) || []).length === before, 'New → Spreadsheet opens a blank workbook and stores nothing yet');
    const a11y = await page.evaluate(() => { const g = document.getElementById('gx-grid'); return { role: g.getAttribute('role'), active: g.getAttribute('aria-activedescendant'), cells: document.querySelectorAll('#gx-grid .gx-c').length, focused: document.activeElement === g }; });
    check(a11y.role === 'grid' && a11y.active === 'gx-c-0-0' && a11y.cells > 200 && a11y.cells < 2500 && a11y.focused, `the grid: role=grid, A1 active, a pool of cells, focused (${JSON.stringify(a11y)})`);

    // ---- typing values and formulas
    await type('Item 1');
    check(await nameBox() === 'A2', 'Enter moves down');
    await type('10');
    await type('20');
    await type('=SUM(A2:A3)');
    check(await cell(3, 0) === '30', 'a formula computes');
    await go('A4');
    check(await formula() === '=SUM(A2:A3)', 'the formula bar shows the formula');
    await go('B1');
    await type('Mon');
    await go('C2');
    await type('=A2*2');
    check(await cell(1, 2) === '20', 'C2 = A2*2');
    await saved(key);
    check(((await local('writerPapers')) || []).some((r) => r.key === key && r.kind === 'sheet'), 'the first edit stores it');

    // ---- the fill handle: a series and a formula shift
    const handle = async (to) => {
      const box = await page.evaluate(() => { const h = document.querySelector('#gx-grid .gx-handle:not([hidden])'), r = h?.getBoundingClientRect(); return r && r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });
      assert.ok(box, 'a fill handle');
      const target = await page.evaluate(([r, c]) => { const el = document.querySelector(`#gx-grid .gx-c[data-r="${r}"][data-c="${c}"]`).getBoundingClientRect(); return { x: el.x + el.width / 2, y: el.y + el.height / 2 }; }, to);
      await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 6 }); await page.mouse.up();
    };
    await go('B1');
    await handle([2, 1]);
    check(await cell(1, 1) === 'Tue' && await cell(2, 1) === 'Wed', 'the fill handle continues Mon into Tue, Wed');
    await go('C2');
    await handle([2, 2]);
    check(await cell(2, 2) === '40', 'filling C2 down gives C3 = A3*2 = 40');
    await go('C3');
    check(await formula() === '=A3*2', 'the filled formula moved with it');

    // ---- copy and paste: Glaze's own copy keeps formulas; Excel's HTML brings its formats
    const clip = (type, data) => page.evaluate(([type, data]) => {
      const dt = new DataTransfer();
      for (const [k, v] of Object.entries(data || {})) dt.setData(k, v);
      document.getElementById('gx-grid').dispatchEvent(new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }));
      return { text: dt.getData('text/plain'), html: dt.getData('text/html') };
    }, [type, data]);
    await go('C2');
    const copied = await clip('copy');
    check(copied.text === '20' && /<table>/.test(copied.html), `copy puts the shown text and a table on the clipboard (${JSON.stringify(copied)})`);
    await go('E2');
    await clip('paste', { 'text/plain': copied.text, 'text/html': copied.html });
    check(await cell(1, 4) === '40' && await formula() === '=C2*2', 'pasting Glaze\'s own copy keeps the formula, moved');
    await go('A2');
    await page.keyboard.press('Shift+ArrowDown');
    const two = await clip('copy');
    await go('D2');
    await clip('paste', { 'text/plain': two.text });
    check(await cell(1, 3) === '10' && await cell(2, 3) === '20', 'a two-cell copy pastes two cells');
    await go('G1');
    await clip('paste', { 'text/plain': '0.5\t1200', 'text/html': '<html><head><style>.xl65{mso-number-format:"0\\.0%";}</style></head><body><table><tr><td class=xl65>50.0%</td><td style="mso-number-format:\'\\#\\,\\#\\#0\'">1,200</td></tr></table></body></html>' });
    check(await cell(0, 6) === '50.0%' && await cell(0, 7) === '1,200', `Excel's HTML pastes with its number formats (${await cell(0, 6)}, ${await cell(0, 7)})`);

    // ---- rows: insert above row 1 and every formula moves; delete it again
    const menuAt = async (r, c, act) => {
      const at = await page.evaluate(([r, c]) => { const sel = c < 0 ? `#gx-grid .gx-rh-c[data-r="${r}"]` : `#gx-grid .gx-c[data-r="${r}"][data-c="${c}"]`; const el = document.querySelector(sel).getBoundingClientRect(); return { x: el.x + el.width / 2, y: el.y + el.height / 2 }; }, [r, c]);
      await page.mouse.click(at.x, at.y, { button: 'right' });
      await page.click(`.gx-menu [data-act="${act}"]`);
    };
    await menuAt(0, -1, 'row-above');
    check(await cell(4, 0) === '30' && await cell(1, 0) === 'Item 1', 'a row inserted above row 1 moves the cells down');
    await go('A5');
    check(await formula() === '=SUM(A3:A4)', 'and the formula with them');
    await menuAt(0, -1, 'delete-rows');
    await go('A4');
    check(await formula() === '=SUM(A2:A3)' && await cell(3, 0) === '30', 'deleting it moves them back');

    // ---- sheets: add one, read across, rename the first and the reference follows
    await page.click('#gx-add');
    await until(() => page.evaluate(() => document.querySelector('.gx-tab[aria-selected="true"]')?.textContent === 'Sheet2'), 'Sheet2');
    await grid();
    await type('=Sheet1!A4');
    check(await cell(0, 0) === '30', 'Sheet2 reads Sheet1');
    await page.dblclick('.gx-tab >> text=Sheet1');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Data');
    await page.keyboard.press('Enter');
    await until(() => page.evaluate(() => [...document.querySelectorAll('.gx-tab')].map((t) => t.textContent).join() === 'Data,Sheet2'), 'renamed');
    await page.click('.gx-tab >> text=Sheet2');
    await go('A1');
    check(await formula() === '=Data!A4' && await cell(0, 0) === '30', 'renaming Sheet1 to Data rewrites Sheet2\'s reference');
    await page.click('.gx-tab >> text=Data');
    await grid();

    // ---- freeze the top row: it stays while the rest scrolls
    await page.click('#gx-freeze');
    await page.click('.gx-menu [data-act="freeze-row"]');
    await page.evaluate(() => { const s = document.querySelector('#gx-grid .gx-scroll'); s.scrollTop = 2000; s.dispatchEvent(new Event('scroll')); });
    await until(() => page.evaluate(() => !!document.querySelector('#gx-grid .gx-tr .gx-c[data-r="0"][data-c="0"]') && !document.querySelector('#gx-grid .gx-br .gx-c[data-r="1"]')), 'frozen row 1 after scrolling');
    check(await page.evaluate(() => document.querySelector('#gx-grid .gx-tr .gx-c[data-r="0"][data-c="0"]').textContent) === 'Item 1', 'the frozen top row stays in view');
    await page.evaluate(() => { const s = document.querySelector('#gx-grid .gx-scroll'); s.scrollTop = 0; s.dispatchEvent(new Event('scroll')); });

    // ---- sort, undo, redo
    await go('F1');
    for (const v of ['Cy', 'Ab', 'Bo']) await type(v);
    await go('F1');
    await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowDown');
    await page.click('#gx-sort-az');
    check([await cell(0, 5), await cell(1, 5), await cell(2, 5)].join() === 'Ab,Bo,Cy', 'Sort A to Z');
    await page.keyboard.press('Control+z');
    check([await cell(0, 5), await cell(1, 5), await cell(2, 5)].join() === 'Cy,Ab,Bo', 'Ctrl+Z undoes the sort');
    await page.keyboard.press('Control+y');
    check([await cell(0, 5), await cell(1, 5), await cell(2, 5)].join() === 'Ab,Bo,Cy', 'Ctrl+Y redoes it');

    // ---- the keyboard's paths
    await go('A1');
    await page.keyboard.press('Control+ArrowDown');
    check(await nameBox() === 'A4', 'Ctrl+Down: the end of the data');
    await page.keyboard.press('Control+Home');
    check(await nameBox() === 'A1', 'Ctrl+Home: A1');
    await page.keyboard.press('Tab');
    check(await nameBox() === 'B1', 'Tab: right');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('End');
    await page.keyboard.press('Home');
    check(await nameBox() === 'A1', 'Home: the row\'s start');
    await page.keyboard.press('PageDown');
    const down = await nameBox();
    check(/^A\d+$/.test(down) && Number(down.slice(1)) > 20, `Page Down: a screen down (${down})`);
    await go('A2');
    await page.keyboard.press('F2');
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    check(await cell(1, 0) === '105' && await cell(3, 0) === '125', 'F2 edits in place, the caret at the end');
    await go('A2');
    await page.keyboard.type('77');
    await page.keyboard.press('Escape');
    check(await cell(1, 0) === '105', 'Esc leaves the cell as it was');
    await page.keyboard.press('Control+z');
    check(await cell(1, 0) === '10', 'Ctrl+Z undoes the F2 edit');
    // Clicking a cell while writing a formula puts its reference in.
    await go('H3');
    await page.keyboard.type('=');
    const a3 = await page.evaluate(() => { const el = document.querySelector('#gx-grid .gx-c[data-r="2"][data-c="0"]').getBoundingClientRect(); return { x: el.x + 10, y: el.y + 8 }; });
    await page.mouse.click(a3.x, a3.y);
    await page.keyboard.type('+1');
    await page.keyboard.press('Enter');
    await go('H3');
    check(await formula() === '=A3+1' && await cell(2, 7) === '21', `clicking A3 while writing a formula inserts it (${await formula()})`);
    const status = await page.evaluate(() => { const g = document.getElementById('gx-grid'); return { live: document.getElementById('gx-live')?.getAttribute('aria-live'), multi: g.getAttribute('aria-multiselectable') }; });
    check(status.live === 'polite' && status.multi === 'true', 'a polite live region; a multi-select grid');
    await go('A2');
    await page.keyboard.press('Shift+ArrowDown');
    check(/Sum: 30/.test(await page.evaluate(() => document.getElementById('gx-status').textContent)), 'the status bar sums the selection');
    await shot('sheet-1280.png');

    // ---- close and open again: the values are kept
    await saved(key);
    await page.click('.gp-top a[href="papers.html"]');
    await until(() => page.evaluate((k) => !document.getElementById('list').hidden && !!document.querySelector(`.gd-card[data-key="${k}"] .gx-thumb`), key), 'home with the new card');
    check(await page.evaluate((k) => /Item 1/.test(document.querySelector(`.gd-card[data-key="${k}"] .gx-thumb`).textContent), key), 'its card shows its cells');
    await page.click(`.gd-card[data-key="${key}"] .gd-title`);
    await grid();
    check(await cell(3, 0) === '30' && await cell(2, 2) === '40' && await cell(0, 5) === 'Ab' && await cell(0, 6) === '50.0%', 'reopened: values, formulas, the sort and formats kept');
    check(await page.evaluate(() => [...document.querySelectorAll('.gx-tab')].map((t) => t.textContent).join()) === 'Data,Sheet2', 'reopened: both sheets, renamed');
    check(!!await page.$('#gx-grid .gx-tr .gx-c[data-r="0"]'), 'reopened: still frozen');

    // ---- export
    await page.click('#gx-more');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.gx-menu [data-act="export"]')]);
    const file = path.join(tmp, download.suggestedFilename());
    await download.saveAs(file);
    const body = fs.readFileSync(file, 'utf8');
    check(/\.(csv|xlsx)$/.test(download.suggestedFilename()) && (/\.xlsx$/.test(file) || /Item 1/.test(body)), `Export writes the spreadsheet (${download.suggestedFilename()})`);

    // ---- 640 px
    await page.setViewportSize({ width: 640, height: 900 });
    await painted();
    const narrow = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, grid: document.getElementById('gx-grid').getBoundingClientRect().width, cells: document.querySelectorAll('#gx-grid .gx-c').length }));
    check(narrow.over <= 0 && narrow.grid > 500 && narrow.cells > 50, `640 px: no page overflow, the grid fills the width (${JSON.stringify(narrow)})`);
    await shot('sheet-640.png');
    await page.setViewportSize({ width: 1280, height: 900 });

    // ---- the rest of the toolbar and the tabs: number formats, find and replace, versions, autocomplete, Ctrl+click,
    // a column's width, duplicate, hide, delete and undo a sheet
    await go('A2');
    await page.click('#gx-format');
    await page.click('.gx-menu [data-act="fmt-currency"]');
    check(await cell(1, 0) === '$10.00', `Currency from the format menu (${await cell(1, 0)})`);
    await page.keyboard.press('Control+f');
    await page.fill('#gx-find-q', 'bo');
    await until(async () => (await page.evaluate(() => document.getElementById('gx-find-n').textContent)) === '1 of 1', 'find');
    check(await nameBox() === 'F2', 'Find goes to the match');
    await page.fill('#gx-rep-q', 'Bob');
    await page.click('#gx-rep-all');
    check(await cell(1, 5) === 'Bob', 'Replace all');
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => document.getElementById('gx-find').hidden && document.activeElement?.id === 'gx-grid'), 'find closed');
    await go('J1');
    await page.keyboard.type('=SU');
    const offered = await until(() => page.evaluate(() => { const l = document.getElementById('gx-complete'); return !l.hidden && [...l.querySelectorAll('[role="option"]')].map((o) => o.textContent); }), 'autocomplete');
    check(offered.includes('SUM'), `typing =SU offers SUM (${offered.slice(0, 5)})`);
    for (let i = 0; i < offered.length && (await page.evaluate(() => document.querySelector('#gx-complete [aria-selected="true"]')?.textContent)) !== 'SUM'; i++) await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.querySelector('#gx-complete [aria-selected="true"]')?.textContent), 'SUM', 'SUM can be selected within the offered list');
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.getElementById('gx-edit').value) === '=SUM(', 'Tab takes SUM(');
    await page.keyboard.type('A3:A4)');
    await page.keyboard.press('Enter');
    check(await cell(0, 9) === '50', `=SUM(A3:A4) (${await cell(0, 9)})`);
    await go('A3');
    const c3 = await page.evaluate(() => { const el = document.querySelector('#gx-grid .gx-c[data-r="2"][data-c="2"]').getBoundingClientRect(); return { x: el.x + 10, y: el.y + 8 }; });
    await page.keyboard.down('Control'); await page.mouse.click(c3.x, c3.y); await page.keyboard.up('Control');
    check(/Count: 2/.test(await page.evaluate(() => document.getElementById('gx-status').textContent)), 'Ctrl+click adds a second range');
    const left = () => page.evaluate(() => document.querySelector('#gx-grid .gx-ch-c[data-c="1"]').getBoundingClientRect().left);
    const hy = await page.evaluate(() => { const r = document.querySelector('#gx-grid .gx-ch-c[data-c="1"]').getBoundingClientRect(); return r.y + r.height / 2; });
    const b0 = await left();
    await page.mouse.move(b0, hy); await page.mouse.down(); await page.mouse.move(b0 + 60, hy, { steps: 4 }); await page.mouse.up();
    check(Math.abs((await left()) - b0 - 60) <= 2, 'dragging a column\'s edge widens it');
    await page.click('#gx-versions');
    const vers = await until(() => page.evaluate(() => document.querySelectorAll('.gx-menu [data-act="restore"]').length), 'versions');
    check(vers >= 1, `Versions lists the kept versions (${vers})`);
    await page.keyboard.press('Escape');
    const tabsNow = () => page.evaluate(() => [...document.querySelectorAll('.gx-tab')].map((t) => t.textContent).join());
    const tabMenu = async (name, act) => { await page.click(`.gx-tab >> text="${name}"`, { button: 'right' }); await page.click(`.gx-menu [data-act="${act}"]`); };
    await tabMenu('Sheet2', 'duplicate');
    await until(async () => (await tabsNow()) === 'Data,Sheet2,Sheet2 (2)', 'duplicate');
    await tabMenu('Sheet2 (2)', 'hide');
    await until(async () => (await tabsNow()) === 'Data,Sheet2', 'hide');
    await tabMenu('Sheet2', 'unhide');
    await until(async () => (await tabsNow()) === 'Data,Sheet2,Sheet2 (2)', 'unhide');
    await tabMenu('Sheet2 (2)', 'delete');
    await until(async () => (await tabsNow()) === 'Data,Sheet2', 'delete');
    await page.focus('#gx-grid');
    await page.keyboard.press('Control+z');
    await until(async () => (await tabsNow()) === 'Data,Sheet2,Sheet2 (2)', 'undo delete');
    check(true, 'a sheet duplicates, hides, unhides, deletes and comes back with Ctrl+Z');

    // Keyboard access after a grid edit: Escape releases the next Tab to native focus order, and the format menu's
    // custom field is reachable from its presets without a pointer.
    await page.keyboard.press('Escape'); await page.keyboard.press('Shift+Tab');
    check(await page.evaluate(() => document.activeElement?.id) === 'gx-formula', 'Escape then Shift+Tab reaches the formula bar');
    await page.keyboard.press('Escape');
    await page.focus('#gx-format'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.activeElement?.id) === 'gx-fmt-code', 'Tab from a format preset reaches Custom format');
    await page.keyboard.press('Escape');
    await saved(key);

    // The model's largest workbook still draws only a viewport of pooled cells, and scrolling reuses those elements.
    const bigKey = 'doc:00000000-0000-4000-8000-00000000b16b', big = M.workbook();
    for (let r = 0; r < 1000; r++) big.sheets[0].rows.set(r, new Map(Array.from({ length: 250 }, (_, c) => [c, { t: 'n', v: r * 250 + c }])));
    await worker.evaluate(async (o) => { await chrome.storage.local.set(o); }, seeded(bigKey, big));
    const opened = Date.now();
    await page.goto(`${HOME}?sheet=${encodeURIComponent(bigKey)}`); await grid(); await painted();
    const render = await page.evaluate(() => { window.gzPool = [...document.querySelectorAll('#gx-grid .gx-c')]; return window.gzPool.length; });
    check(render > 200 && render < 2500, `250,000 cells: a viewport pool (${render} cells, ${Date.now() - opened} ms to paint)`);
    await page.evaluate(() => { const s = document.querySelector('.gx-scroll'); s.scrollTop = 10000; });
    await until(() => page.evaluate(() => document.querySelector('#gx-grid .gx-c[data-r="500"]')), 'large workbook scrolled');
    check(await page.evaluate(() => window.gzPool.some((el) => el.isConnected) && document.querySelectorAll('#gx-grid .gx-c').length < 2500), '250,000 cells: scrolling reuses pooled elements');

    const intervals = await page.evaluate(() => globalThis.gzIntervals || []);
    check(intervals.every((ms) => ms >= 60000), `no interval under a minute (${JSON.stringify(intervals)})`);
    check(!errors.some((e) => /sender/.test(e)), 'no worker sender refusals');
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    check(requests.length === 0, `no network (${requests.join(', ')})`);
    passed = true;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'sheets-results.json'), JSON.stringify({ passed, checks, errors, requests, shots }, null, 2) + '\n');
    console.log(`${passed ? 'PASS' : 'FAIL'} sheets-check: ${checks.length} checks`);
  }
})();
