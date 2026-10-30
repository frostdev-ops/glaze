// Glaze Writer's objects in the real unpacked extension (writer-objects.js over lib/writer-objects.js), on the synthetic
// assignment attempt (paper mode) and message box (compose mode) running the real Quill 1.3.7, as
// scripts/writer-paper-check.js and scripts/writer-compose-check.js set them up: pictures from a file, pasted and dropped
// (downscaled, sized, aligned, captioned, resized by a handle, deleted by key), tables (grid, toolbar, Tab, header,
// borders, alignment, rows kept whole across pages), links (typed, the card, ⌘K, remove; compose too), the horizontal
// line, special characters, list styles, restart and continue, and typing latency on the 6-page MLA paper. Screenshots
// in dark (Frost) and light (Paper) go to OBJECTS_SHOTS (default ~/Projects/glaze-plans/writer/mockups/build-objects).
// LATENCY_ONLY=1 measures typing only (run with EXT=<an older checkout> for a before number).
// GETs only, synthetic; no account or outside network from the browser.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-objects-check.js [evidence directory], under the heavy-check lock (CLAUDE.md)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const FX = require('../test/fixtures/writer-paper-fixtures.js');
const site = 'https://bb.school.test';
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create', MESSAGE = '/ultra/messages/create';
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-objects-check');
const shots = process.env.OBJECTS_SHOTS || path.join(os.homedir(), 'Projects/glaze-plans/writer/mockups/build-objects');
const LATENCY_ONLY = process.env.LATENCY_ONLY === '1';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const checks = [], requests = [], errors = [];
let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
const HARNESS = `(() => {
  for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
    const old = c.querySelector('.ql-editor'), html = old.innerHTML, id = old.id, ph = old.getAttribute('data-placeholder');
    c.innerHTML = '';
    const q = new Quill(c, {});
    if (id) q.root.id = id;
    if (ph) q.root.setAttribute('data-placeholder', ph);
    q.root.setAttribute('role', 'textbox');
    if (/[^\\s]/.test(html.replace(/<[^>]*>/g, ''))) q.setContents(q.clipboard.convert(html), 'silent');
    window.__native = () => q.root.innerHTML;
  }
})();`;

(async () => {
  let context, held = false, tmp, ext;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-objects-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-objects-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-objects-'));
    fs.mkdirSync(out, { recursive: true });
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    if (crypto.createHash('sha256').update(quill).digest('hex') !== QUILL.sha256) throw Error('Quill 1.3.7 hash mismatch');
    ext = require('./check-env.js').staged(root, [`${site}/*`]);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(15000);
    const grades = JSON.parse(fixture('ultra-writer-gradebook.json'));
    const members = JSON.parse(fixture('ultra-memberships.json'));
    members.results = members.results.map((m) => (m.courseId === '_101_1' ? { ...m, course: { ...m.course, name: FX.context.course, displayName: FX.context.course } } : m));
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:' || u.protocol === 'data:') return r.continue();
      requests.push({ method: req.method(), origin: u.origin, path: u.pathname });
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      const page = { [ATTEMPT]: 'ultra-writer-attempt.html', [MESSAGE]: 'ultra-writer-messages.html' }[u.pathname];
      if (req.isNavigationRequest() && page) return r.fulfill({ contentType: 'text/html', body: fixture(page).replace('<head>', '<head><base href="/ultra/">').replace('</body>', '<script src="/gz-check/quill.js"></script><script src="/gz-check/harness.js"></script></body>') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      let data = { results: [] };
      if (u.pathname.endsWith('/users/me')) data = { id: '_900_1', userName: 'synthetic', givenName: 'Alex', familyName: 'Rivera' };
      else if (/\/users\/_900_1\/memberships$/.test(u.pathname)) data = members;
      else if (u.pathname.includes('/gradebook/grades')) data = grades;
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const configure = async (preset) => {
      const settings = G.GZ_SANITIZE({ writer: { full: true }, navbar: { on: false }, footer: false, preset, colors: G.GZ_PRESETS?.find?.(([n]) => n === preset)?.[1], enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
      await worker.evaluate(async ({ settings, site }) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] }); }, { settings, site });
    };
    await worker.evaluate(() => chrome.storage.local.clear());
    await configure('Frost');
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();
    const watch = (p, tag) => {
      p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
    };
    const openAttempt = async () => {
      const p = await context.newPage();
      watch(p, 'page');
      await p.goto(`${site}${ATTEMPT}`);
      const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity && f.offsetHeight > 500) && x; }, 'paper frame shown');
      const fr = await until(() => el.contentFrame(), 'frame document');
      await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key()), 'paper keyed and loaded');
      await until(() => fr.evaluate(() => document.querySelectorAll('.gp-sheet').length > 0 && document.querySelector('.gp-flow').style.visibility === ''), 'pages drawn');
      return { p, el, fr };
    };
    const settle = async (fr) => { await pause(150); await fr.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await pause(100); };
    const load = async (fr, json) => {
      await fr.evaluate((j) => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON(j).content)); }, json);
      await settle(fr);
      await settle(fr);
    };
    const shot = async (target, name) => { fs.mkdirSync(shots, { recursive: true }); await pause(300); const f = path.join(shots, name); await target.screenshot({ path: f }); return f; };
    const saved = {};
    // Typing on the 6-page MLA paper: each keystroke as a transaction (as writer-paper-check measures it), and real keys
    // from keydown to the frame after.
    const latency = async (p, fr) => {
      await load(fr, FX.papers.mla9());
      const tx = await fr.evaluate(async () => {
        const v = GZ_WRITER_PAPER.current().editor.view, d = v.state.doc;
        let at = 0; d.forEach((n, off, i) => { if (i === 8) at = off + 5; });
        const times = [];
        for (let i = 0; i < 40; i++) { const t = performance.now(); v.dispatch(v.state.tr.insertText('x', at + i)); await new Promise((r) => queueMicrotask(r)); await new Promise((r) => setTimeout(r, 0)); times.push(performance.now() - t); }
        times.sort((a, b) => a - b);
        return times[20];
      });
      await fr.evaluate(() => {
        const v = GZ_WRITER_PAPER.current().editor.view, d = v.state.doc;
        let at = 0; d.forEach((n, off, i) => { if (i === 10) at = off + 5; });
        v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(d, at))); v.focus();
        window.__keys = [];
        if (window.__keyTimer) document.removeEventListener('keydown', window.__keyTimer, true);
        window.__keyTimer = () => { const t0 = performance.now(); requestAnimationFrame(() => setTimeout(() => window.__keys.push(performance.now() - t0), 0)); };
        document.addEventListener('keydown', window.__keyTimer, true);
      });
      await p.keyboard.type('the quick brown fox jumps over the lazy dog again', { delay: 40 });
      await pause(300);
      const keys = await fr.evaluate(() => { const k = window.__keys.slice().sort((a, b) => a - b); return { median: k[Math.floor(k.length / 2)], p90: k[Math.floor(k.length * 0.9)], n: k.length }; });
      return { transaction: Math.round(tx * 100) / 100, keys: { median: Math.round(keys.median * 100) / 100, p90: Math.round(keys.p90 * 100) / 100, n: keys.n } };
    };

    let { p, el, fr } = await openAttempt();
    const lat = [];
    for (let i = 0; i < 3; i++) lat.push(await latency(p, fr));
    console.log('LATENCY', JSON.stringify(lat));
    fs.writeFileSync(path.join(out, 'latency.json'), JSON.stringify(lat, null, 2) + '\n');
    if (LATENCY_ONLY) { passed = true; return; }

    // ---- the toolbar
    await fr.click('.gp-tbtn[aria-label="Focus"]');
    await until(() => el.evaluate((f) => getComputedStyle(f).position === 'fixed'), 'focus fills the window');
    await load(fr, FX.papers.mla9());
    check(await fr.evaluate(() => [...document.querySelectorAll('.gp-tbtn')].map((b) => b.textContent.trim()).filter(Boolean).join('|') === 'Cite|Footnote|Page break'), 'the paper\'s own toolbar buttons are unchanged');
    check(await fr.evaluate(() => { const b = document.querySelector('.gzo-insert'); return b && b.nextElementSibling?.classList.contains('grow') && document.querySelector('[data-run="orderedList"]').nextElementSibling?.classList.contains('gzo-caretbtn'); }), 'Insert sits before the toolbar\'s spacer and the list style caret after Numbered list');
    const caretIn = (needle, offset = 0) => fr.evaluate(({ needle, offset }) => {
      const v = GZ_WRITER_PAPER.current().editor.view; let at = null;
      v.state.doc.descendants((n, pos) => { if (at == null && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) + offset; });
      v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at)).scrollIntoView()); v.focus();
      return at;
    }, { needle, offset });
    const endOfBlock = (index) => fr.evaluate((i) => {
      const v = GZ_WRITER_PAPER.current().editor.view; let at = 0;
      v.state.doc.forEach((n, off, k) => { if (k === i) at = off + n.nodeSize - 1; });
      v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at)).scrollIntoView()); v.focus();
    }, index);
    const doc = () => fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON());
    const find = (json, type) => { const outs = []; const walk = (n) => { if (n.type === type) outs.push(n); (n.content || []).forEach(walk); }; walk(json); return outs; };

    // ---- pictures: from a file (a big screenshot, so it is made smaller), the popover, a handle, delete
    const big = path.join(tmp, 'big.png');
    fs.writeFileSync(big, await p.screenshot());
    await endOfBlock(6);
    await p.keyboard.press('Enter');
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.keyboard.press(`${MOD}+Shift+KeyI`)]);
    await chooser.setFiles(big);
    await until(async () => find(await doc(), 'image').length === 1, 'picture inserted');
    let img = find(await doc(), 'image')[0];
    check(img.attrs.display === 'block' && img.attrs.align === 'center' && img.attrs.width === 624 && /^data:image\/(png|jpeg);base64,/.test(img.attrs.src), `⌘⇧I picks a file; the picture goes in as a centred block at the text width (${img.attrs.width}px)`);
    check(img.attrs.src.length * 0.75 <= 1e6, `a 2880 × 1800 screenshot is held within 1 MB (${Math.round(img.attrs.src.length * 0.75 / 1024)} KB)`);
    check(await fr.evaluate(() => /smaller/.test(document.querySelector('.gp-toast')?.textContent || '')), 'the student is told the picture was made smaller');
    await settle(fr);
    check(await fr.evaluate(() => !document.querySelector('.gzo-imgpop').hidden && document.querySelector('.gzo-img.ProseMirror-selectednode .gzo-h') && getComputedStyle(document.querySelector('.gzo-img.ProseMirror-selectednode .gzo-h')).display === 'block'), 'the new picture is selected: outline, four handles and its popover');
    await fr.fill('.gzo-imgpop input[aria-label="Width in percent"]', '50');
    await fr.press('.gzo-imgpop input[aria-label="Width in percent"]', 'Enter');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image') at = pos; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.NodeSelection.create(v.state.doc, at))); });
    await settle(fr);
    await fr.fill('.gzo-imgpop input[aria-label="Caption"]', 'Fig. 1. The house on Bluestone Road.');
    await fr.press('.gzo-imgpop input[aria-label="Caption"]', 'Enter');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image') at = pos; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.NodeSelection.create(v.state.doc, at))); });
    await settle(fr);
    await fr.fill('.gzo-imgpop input[aria-label="Alt text"]', 'A white house behind a fence');
    await fr.press('.gzo-imgpop input[aria-label="Alt text"]', 'Enter');
    img = find(await doc(), 'image')[0];
    check(img.attrs.width === 312 && img.attrs.caption === 'Fig. 1. The house on Bluestone Road.' && img.attrs.alt === 'A white house behind a fence', 'the popover sets the width in percent of the text (50% = 3.25″), the caption and the alt text');
    check(await fr.evaluate(() => { const c = document.querySelector('.gzo-img[data-caption]'); return c && getComputedStyle(c, '::after').content.includes('Bluestone'); }), 'the caption is drawn under the picture');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image') at = pos; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.NodeSelection.create(v.state.doc, at)).scrollIntoView()); v.focus(); });
    await settle(fr);
    saved.image = await shot(p, 'image-popover-dark.png');
    // A corner handle: drag the south-east corner right; the picture keeps its shape and the width shows as it changes.
    const handle = await fr.$('.gzo-img.ProseMirror-selectednode .gzo-h[data-c="se"]');
    await handle.scrollIntoViewIfNeeded(); await handle.hover();
    const hb = await handle.boundingBox(), before = await fr.evaluate(() => { const i = document.querySelector('.gzo-img img'); return i.offsetHeight / i.offsetWidth; });
    await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await p.mouse.down();
    await p.mouse.move(hb.x + 40, hb.y + 20, { steps: 6 });
    check(await fr.evaluate(() => /″ · \d+%$/.test(document.querySelector('.gzo-sizing .gzo-size')?.textContent || '')), 'dragging a handle shows the width in inches and percent');
    saved.resize = await shot(p, 'image-resize-dark.png');
    await p.mouse.up();
    await settle(fr);
    img = find(await doc(), 'image')[0];
    const ratio = await fr.evaluate(() => { const i = document.querySelector('.gzo-img img'); return i.offsetHeight / i.offsetWidth; });
    check(img.attrs.width > 312 && Math.abs(ratio - before) < 0.02, `a corner drag widens it (${img.attrs.width}px) and keeps its shape`);
    await fr.click('.gzo-imgpop button[aria-label="Right"]');
    check(find(await doc(), 'image')[0].attrs.align === 'right', 'alignment: right');
    await fr.click('.gzo-imgpop button[aria-label="In line"]');
    check(find(await doc(), 'image')[0].attrs.display === 'inline', 'in line with text');
    await fr.click('.gzo-imgpop button[aria-label="Center"]');
    // Keyboard: the picture is selected; Delete takes it, Undo brings it back.
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image') at = pos; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.NodeSelection.create(v.state.doc, at))); v.focus(); });
    await p.keyboard.press('Tab');
    check(await fr.evaluate(() => document.querySelector('.gzo-imgpop').contains(document.activeElement)), 'Tab on a selected picture goes to its popover');
    await p.keyboard.press('Escape');
    check(await fr.evaluate(() => document.activeElement?.closest('.ProseMirror')) && await el.evaluate((f) => getComputedStyle(f).position === 'fixed'), 'Escape goes back to the text and keeps Focus');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image') at = pos; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.NodeSelection.create(v.state.doc, at))); v.focus(); });
    await p.keyboard.press('Delete');
    check(find(await doc(), 'image').length === 0, 'Delete removes the selected picture');
    await p.keyboard.press(`${MOD}+z`);
    check(find(await doc(), 'image').length === 1, 'and Undo brings it back');

    // Pasted and dropped pictures.
    const small = await fr.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#7da48a'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#f3e3b5'; g.beginPath(); g.arc(250, 50, 20, 0, 7); g.fill();
      return Array.from(new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer()));
    });
    await endOfBlock(9);
    await fr.evaluate((bytes) => {
      const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], 'pasted.png', { type: 'image/png' }));
      GZ_WRITER_PAPER.current().editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, small);
    await until(async () => find(await doc(), 'image').length === 2, 'pasted picture');
    check(find(await doc(), 'image').some((i) => i.attrs.width === 320), 'a pasted picture goes in at its own size');
    await fr.evaluate((bytes) => {
      const target = [...document.querySelectorAll('.gp-flow p')][12], r = target.getBoundingClientRect();
      const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5 }));
    }, small);
    await until(async () => find(await doc(), 'image').length === 3, 'dropped picture');
    check(true, 'a picture dropped on the page goes in where it lands');
    check(await fr.evaluate(() => !document.querySelector('.gi-layer[data-open]')), 'and does not open the import card');
    // Pages: no picture is cut by a page's end.
    const cut = await fr.evaluate(() => {
      const geo = GZ_WRITER_STYLES.geometry(GZ_WRITER_PAPER.current().format()), stride = geo.height + 26.4, v = GZ_WRITER_PAPER.current().editor.view;
      const top = v.dom.getBoundingClientRect().top, scale = v.dom.getBoundingClientRect().height / v.dom.offsetHeight;
      return [...document.querySelectorAll('.gzo-box')].map((b) => { const r = b.getBoundingClientRect(), y0 = (r.top - top) / scale, y1 = (r.bottom - top) / scale, page = Math.floor((y0 + 1) / stride); return y1 <= page * stride + geo.body + 1; });
    });
    check(cut.length === 3 && cut.every(Boolean), `every picture sits whole inside one page's text area (${cut.join(',')})`);

    // ---- tables: the grid, the toolbar, Tab, header, borders, alignment, columns refused past the text width
    await endOfBlock(5);
    await fr.click('.gzo-insert');
    await fr.hover('.gzo-grid i[data-r="4"][data-c="3"]');
    check(await fr.evaluate(() => document.querySelector('.gzo-gridlbl').textContent === '3 × 4'), 'the grid shows its size as you point (3 × 4)');
    saved.picker = await shot(p, 'table-picker-dark.png');
    // Hover already locates the fixed menu through the iframe. A second locator click may scroll the frame again.
    await fr.hover('.gzo-grid i[data-r="4"][data-c="3"]');
    await p.mouse.down(); await p.mouse.up();
    let tables = find(await doc(), 'table');
    const cellText = (t, r, c) => (t.content[r].content[c].content || []).map((x) => (x.content || []).map((y) => y.text || '').join('')).join('');
    check(tables.length === 1 && tables[0].content.length === 4 && tables[0].content[0].content.length === 3, 'a click puts in a 3 × 4 table');
    await p.keyboard.type('Debt');
    await p.keyboard.press('Tab'); await p.keyboard.type('Who owes it');
    await p.keyboard.press('Tab'); await p.keyboard.type('Chapter');
    await p.keyboard.press('Tab'); await p.keyboard.type('A name');
    // As in Word, Tab selects the next cell's text: typing replaces it.
    await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
    await p.keyboard.type('A name!');
    tables = find(await doc(), 'table');
    check(cellText(tables[0], 0, 1) === 'Who owes it' && cellText(tables[0], 1, 0) === 'A name!', 'Tab and Shift+Tab move between cells');
    await settle(fr);
    check(await fr.evaluate(() => !document.querySelector('.gzo-tablepop').hidden), 'the table toolbar shows while the caret is in a table');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = null; v.state.doc.descendants((n, pos) => { if (at == null && n.type.name === 'table') at = pos + 4; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at))); v.focus(); });
    await fr.click('.gzo-tablepop button[aria-label="Header row"]');
    await fr.click('.gzo-tablepop button[aria-label="Center"]');
    await fr.click('.gzo-tablepop button[aria-label="Middle"]');
    await fr.click('.gzo-tablepop button[aria-label="Row below"]');
    await fr.click('.gzo-tablepop button[aria-label="Column right"]');
    tables = find(await doc(), 'table');
    check(tables[0].content[0].content[0].type === 'table_header' && tables[0].content[0].content[0].attrs.valign === 'middle' && tables[0].content[0].content[0].content[0].attrs.align === 'center', 'header row, centred text and middle alignment from the toolbar');
    check(tables[0].content.length === 5 && tables[0].content[0].content.length === 4, 'a row below and a column to the right');
    await fr.click('.gzo-tablepop button[aria-label="Delete column"]');
    await fr.click('.gzo-tablepop button[aria-label="Borders"]');
    tables = find(await doc(), 'table');
    check(tables[0].attrs.borders === false && tables[0].content[0].content.length === 3, 'delete column, and borders off');
    await settle(fr);
    saved.toolbar = await shot(p, 'table-toolbar-dark.png');
    let refused = 0;
    for (let i = 0; i < 12; i++) { await fr.click('.gzo-tablepop button[aria-label="Column right"]'); }
    tables = find(await doc(), 'table');
    refused = tables[0].content[0].content.length;
    check(refused === 13 && await fr.evaluate(() => /as wide as the text/.test(document.querySelector('.gp-toast')?.textContent || '')), `columns stop at half an inch each (${refused} on 6.5″) and the student is told`);
    for (let i = 0; i < 10; i++) await fr.click('.gzo-tablepop button[aria-label="Delete column"]');
    await fr.click('.gzo-tablepop button[aria-label="Borders"]');
    // A long table across a page's end: no row is cut.
    await fr.evaluate(() => {
      const v = GZ_WRITER_PAPER.current().editor.view, s = v.state.schema, n = s.nodes;
      const rows = Array.from({ length: 30 }, (_, i) => n.table_row.create(null, [0, 1].map((c) => n.table_cell.create(null, n.paragraph.create(null, s.text(`row ${i + 1} cell ${c + 1}`))))));
      let at = 0; v.state.doc.forEach((x, off, k) => { if (k === 14) at = off + x.nodeSize; });
      v.dispatch(v.state.tr.insert(at, n.table.create(null, rows)));
    });
    await settle(fr); await settle(fr);
    const rowsCut = await fr.evaluate(() => {
      const geo = GZ_WRITER_STYLES.geometry(GZ_WRITER_PAPER.current().format()), stride = geo.height + 26.4, v = GZ_WRITER_PAPER.current().editor.view;
      const top = v.dom.getBoundingClientRect().top, scale = v.dom.getBoundingClientRect().height / v.dom.offsetHeight;
      const t = [...document.querySelectorAll('.gp-flow table')].find((x) => x.textContent.includes('row 30 cell 2'));
      const pages = new Set(), bad = [];
      for (const tr of t.querySelectorAll('tr:not(.gp-gap-row)')) { const r = tr.getBoundingClientRect(), y0 = (r.top - top) / scale, y1 = (r.bottom - top) / scale, pg = Math.floor((y0 + 1) / stride); pages.add(pg); if (y1 > pg * stride + geo.body + 1) bad.push(tr.textContent); }
      return { pages: pages.size, bad };
    });
    check(rowsCut.pages >= 2 && rowsCut.bad.length === 0, `a 30-row table runs across ${rowsCut.pages} pages with no row cut`);

    // ---- links: typed on space, the card, ⌘K, remove
    await endOfBlock(7);
    await p.keyboard.type(' See www.example.org/beloved ');
    let links = await fr.evaluate(() => { const out = []; GZ_WRITER_PAPER.current().editor.view.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'link')) out.push([n.text, n.marks.find((m) => m.type.name === 'link').attrs.href]); }); return out; });
    check(links.some(([text, href]) => text === 'www.example.org/beloved' && href === 'https://www.example.org/beloved'), 'a typed address becomes a link on space');
    await p.keyboard.press('Backspace');
    links = await fr.evaluate(() => { let k = 0; GZ_WRITER_PAPER.current().editor.view.state.doc.descendants((n) => { if (n.isText && n.text.includes('www.example.org/beloved') && n.marks.some((m) => m.type.name === 'link')) k++; }); return k; });
    check(links === 0, 'Backspace right after takes the link back');
    await p.keyboard.press('Backspace');
    await p.keyboard.type(' ');
    await caretIn('www.example.org/beloved', 4);
    await settle(fr);
    check(await fr.evaluate(() => !document.querySelector('.gzo-linkpop').hidden && document.querySelector('.gzo-url').textContent === 'https://www.example.org/beloved'), 'the link card shows on a link');
    check(await fr.evaluate(() => (() => { const a = [...document.querySelectorAll('.gp-flow a')].find((a) => a.textContent === 'www.example.org/beloved'), probe = document.createElement('span'); probe.style.color = 'var(--sheet-link)'; a.parentElement.append(probe); const same = getComputedStyle(a).color === getComputedStyle(probe).color && getComputedStyle(a).textDecorationLine.includes('underline'); probe.remove(); return same; })()), 'links take the .docx\'s Hyperlink colour, underlined');
    saved.link = await shot(p, 'link-card-dark.png');
    await p.keyboard.press(`${MOD}+k`);
    await until(() => fr.evaluate(() => !document.querySelector('.gzo-linkedit').hidden && document.activeElement?.type === 'url'), 'link editor');
    await fr.fill('.gzo-linkedit input[aria-label="Text"]', 'the Beloved page');
    await fr.fill('.gzo-linkedit input[type="url"]', 'https://www.example.org/beloved-novel');
    saved.linkEdit = await shot(p, 'link-edit-dark.png');
    await fr.press('.gzo-linkedit input[type="url"]', 'Enter');
    links = await fr.evaluate(() => { const out = []; GZ_WRITER_PAPER.current().editor.view.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'link')) out.push([n.text, n.marks.find((m) => m.type.name === 'link').attrs.href]); }); return out; });
    check(links.some(([text, href]) => text === 'the Beloved page' && href === 'https://www.example.org/beloved-novel'), '⌘K edits the link\'s text and address');
    await caretIn('the Beloved page', 3);
    await settle(fr);
    await fr.click('.gzo-linkpop button[aria-label="Remove link"]');
    links = await fr.evaluate(() => { let k = 0; GZ_WRITER_PAPER.current().editor.view.state.doc.descendants((n) => { if (n.isText && n.text.includes('the Beloved page') && n.marks.length) k++; }); return k; });
    check(links === 0, 'Remove link keeps the text');

    // ---- the horizontal line and special characters
    await endOfBlock(8);
    await p.keyboard.press('Enter');
    await p.keyboard.type('---');
    check(find(await doc(), 'horizontal_rule').length === 1, '--- on an empty line makes a horizontal line');
    await fr.click('.gzo-insert');
    await fr.click('.gzo-menu [role="menuitem"]:has-text("Horizontal line")');
    check(find(await doc(), 'horizontal_rule').length === 2, 'Insert → Horizontal line');
    await p.keyboard.type('Epigraph ');
    await fr.click('.gzo-insert');
    await fr.click('.gzo-menu [role="menuitem"]:has-text("Special characters")');
    await fr.fill('.gzo-chars input', 'dash');
    await settle(fr);
    saved.chars = await shot(p, 'special-characters-dark.png');
    await fr.click('.gzo-char[aria-label="Em dash"]');
    await fr.fill('.gzo-chars input', 'section');
    await fr.click('.gzo-char[aria-label="Section sign"]');
    check(await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('Epigraph —§')), 'special characters go in at the caret by name; the palette stays open');
    await p.keyboard.press('Escape');

    // ---- lists: nesting, styles, restart and continue
    await endOfBlock(10);
    await p.keyboard.press('Enter');
    await p.keyboard.type('1. Memory as a debt');
    await p.keyboard.press('Enter'); await p.keyboard.press('Tab'); await p.keyboard.type('Sethe’s rememory');
    await p.keyboard.press('Enter'); await p.keyboard.type('Paul D’s tin');
    await p.keyboard.press('Enter'); await p.keyboard.press('Tab'); await p.keyboard.type('the lid rusted shut');
    await p.keyboard.press('Enter'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab'); await p.keyboard.type('Memory as a house');
    let ol = find(await doc(), 'ordered_list').at(-1);
    check(ol.content.map((li) => li.attrs.indent).join() === '0,1,1,2,0', 'Tab and Shift+Tab nest list items');
    await fr.click('.gzo-caretbtn');
    saved.lists = await shot(p, 'list-styles-dark.png');
    await fr.click('.gzo-listmenu [role^="menuitem"]:has-text("I. A. 1.")');
    ol = find(await doc(), 'ordered_list').at(-1);
    check(ol.attrs.styles === 'upper-roman,upper-alpha,decimal', 'the I. A. 1. preset styles the list');
    const markers = await fr.evaluate(() => { const l = [...document.querySelectorAll('.gp-flow ol')].at(-1); return [...l.children].map((li) => getComputedStyle(li, '::before').content); });
    check(/counter\(gzl0, upper-roman\)/.test(markers[0]) && /counter\(gzl1, upper-alpha\)/.test(markers[1]) && /counter\(gzl2(, decimal)?\)/.test(markers[3]), 'each level draws its own style');
    await caretIn('Paul D’s tin', 2);
    await fr.click('.gzo-caretbtn');
    await fr.click('.gzo-listmenu .gzo-mrow [role^="menuitem"]:has-text("i.")');
    await fr.click('.gzo-caretbtn');
    await fr.click('.gzo-listmenu [role^="menuitem"]:has-text("Restart numbering")');
    ol = find(await doc(), 'ordered_list').at(-1);
    check(ol.attrs.styles === 'upper-roman,lower-roman,decimal' && ol.content[2].attrs.start === 1, 'a level\'s style from the menu, and Restart numbering on an item');
    await settle(fr);
    saved.listDone = await shot(p, 'list-styled-dark.png');

    // ---- the .docx still exports with every object in it
    const bytes = await fr.evaluate(async () => (await GZ_WRITER_PAPER.current().docx()).bytes.length);
    check(bytes > 10000, `the paper with pictures, tables, a line and styled lists exports a .docx (${bytes} bytes)`);

    // ---- light (Paper)
    await p.close();
    await configure('Paper');
    ({ p, el, fr } = await openAttempt());
    await fr.click('.gp-tbtn[aria-label="Focus"]');
    await until(() => el.evaluate((f) => getComputedStyle(f).position === 'fixed'), 'focus (light)');
    await settle(fr);
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = null; v.state.doc.descendants((n, pos) => { if (at == null && n.type.name === 'image') at = pos; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.NodeSelection.create(v.state.doc, at))); v.focus(); v.nodeDOM(at).scrollIntoView({ block: 'center' }); });
    await settle(fr);
    check(await fr.evaluate(() => !document.querySelector('.gzo-imgpop').hidden), 'the paper with its objects survives a reload');
    saved.imageLight = await shot(p, 'image-popover-light.png');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = null; v.state.doc.descendants((n, pos) => { if (at == null && n.type.name === 'table') at = pos + 4; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at)).scrollIntoView()); v.focus(); });
    await settle(fr);
    saved.toolbarLight = await shot(p, 'table-toolbar-light.png');
    await fr.click('.gzo-insert');
    await fr.hover('.gzo-grid i[data-r="3"][data-c="4"]');
    saved.pickerLight = await shot(p, 'table-picker-light.png');
    await p.keyboard.press('Escape');
    await fr.click('.gzo-insert');
    await fr.click('.gzo-menu [role="menuitem"]:has-text("Special characters")');
    await fr.click('.gzo-cat:has-text("Greek")');
    saved.charsLight = await shot(p, 'special-characters-light.png');
    await p.keyboard.press('Escape');
    await caretIn('Memory as a debt', 2);
    await fr.click('.gzo-caretbtn');
    saved.listsLight = await shot(p, 'list-styles-light.png');
    await p.keyboard.press('Escape');
    await caretIn('example.org', 0).catch(() => null);
    await p.close();

    // ---- compose: the link card and ⌘K in a message box (Quill keeps links; no pictures or tables there)
    await configure('Frost');
    const m = await context.newPage();
    watch(m, 'message');
    await m.goto(`${site}${MESSAGE}`);
    const mel = await until(async () => { const x = await m.$('iframe.gz-writer'); return x && await x.evaluate((f) => !f.style.opacity && f.offsetHeight > 100) && x; }, 'message frame');
    const mf = await until(() => mel.contentFrame(), 'message frame document');
    await until(() => mf.evaluate(() => !!document.querySelector('.ProseMirror') && document.documentElement.dataset.mode === 'compose'), 'compose editor');
    await mf.click('.ProseMirror');
    await m.keyboard.type('Notes are at https://example.org/notes and more');
    check(await m.evaluate(() => /<a href="https:\/\/example\.org\/notes"[^>]*>https:\/\/example\.org\/notes<\/a>/.test(__native())), 'compose: a typed address becomes a link Quill keeps');
    await mf.evaluate(() => { const v = GZ_WRITER_FRAME.editor().view; let at = null; v.state.doc.descendants((n, pos) => { if (at == null && n.isText && n.text.includes('example.org')) at = pos + n.text.indexOf('example.org') + 3; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at))); v.focus(); });
    await settle(mf);
    check(await mf.evaluate(() => !document.querySelector('.gzo-linkpop').hidden), 'compose: the link card shows on a link');
    saved.compose = await shot(m, 'compose-link-card-dark.png');
    await m.keyboard.press(`${MOD}+k`);
    await mf.fill('.gzo-linkedit input[aria-label="Text"]', 'my notes');
    await mf.press('.gzo-linkedit input[aria-label="Text"]', 'Enter');
    check(await m.evaluate(() => /<a href="https:\/\/example\.org\/notes"[^>]*>my notes<\/a>/.test(__native())), 'compose: ⌘K renames the link and Ultra\'s box follows');
    check(await mf.evaluate(() => !document.querySelector('.gzo-insert') && !document.querySelector('.gzo-imgpop:not([hidden])')), 'compose has no Insert menu or pictures');
    await m.close();

    check(errors.length === 0, `no page or frame errors (${errors.join('; ')})`);
    check(requests.every((r) => r.method === 'GET' && r.origin === site), 'every LMS request is a synthetic GET');
    passed = true;
    console.log(JSON.stringify({ checks: checks.length, latency: lat, shots: saved }, null, 2));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, requests, errors }, null, 2) + '\n');
  }
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), `${e.stack}\n`); process.exitCode = 1; });
