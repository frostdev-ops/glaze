// Glaze Writer's submit step in the real unpacked extension, on the synthetic assignment attempt (test/fixtures/
// ultra-writer-attempt.html, the probed shape) running the real Quill 1.3.7, with a stand-in for Ultra's React around it:
// its file area takes files at its root (input's change, or a drop), records them and lists each after a moment; its
// footer's Save and Close and Submit stay disabled (Mui-style) while there's no text and no file, and record clicks; a
// Submit click shows a stand-in confirmation. ?mode= changes it: empty (no text in Ultra's box), noinput (the file area
// without its input), gone (no file area), never (files never listed), stuck (Submit never enables).
// Checked: the sheet's look (screenshots beside the mockup), focus trap, Escape and Cancel changing nothing, Ultra's
// Submit (disabled or not) and Save and Close caught, the .docx landing in the input with its name, type and bytes (read
// back with lib/doctext.js), the note and text in Quill, Submit clicked exactly once and only after the file is listed,
// each failure stopping before Submit, a test untouched, the keyboard flow, and Settings → Writer's remembered paste switch. Bringing a file (writer-import.js): a .docx
// dropped on the paper asks, Open in Writer replaces the paper (a version first, Undo in the toast); one chosen in Ultra's
// own file area reaches the frame before Ultra and Submit as is attaches its very bytes (hashes compared) with the note; a PDF
// goes straight to the sheet; ⋯ → Import…; with Open uploads in Writer off, Ultra's area takes the file itself. The flows
// above run in the full view (writer.full on). The compact box (Full writer off, the default): no pages, the frame as tall
// as its text, typing autosaved to the paper and written into Ultra's box, Ultra's own Submit sending that text with no
// .docx and no sheet, the "Full writer" switch to the pages and back (caret and its line on screen kept, a 'view' version
// first), the setting kept across a reload and followed live from Settings, a PDF on Ultra's file area left to Ultra and a
// .docx's card (Open in Writer opens the pages); screenshots compact-*.png at 1280 and 640. GETs only, synthetic.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-submit-check.js [evidence directory]
// SUBMIT_SHOTS: where the screenshots go (default ~/Projects/glaze-plans/writer/mockups/build-submit); IMPORT_SHOTS, the
// import's (default ~/Projects/glaze-plans/writer/mockups/settings-ai/build-import); COMPACT_SHOTS, the compact box's
// (default ~/Projects/glaze-plans/writer/mockups/build-documents).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const FX = require('../test/fixtures/writer-paper-fixtures.js');
const DT = require('../lib/doctext.js');
const site = 'https://bb.school.test';
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create', TEST = '/ultra/courses/_101_1/assessment/_8_1/attempt/_31_1';
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SUBMIT = '[data-analytics-id="assignment.attempt.authoring.footer.submit"]', SAVE = '[data-analytics-id="course.content.assessment.footer.buttons.saveAndClose"]';
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-submit-check');
const shots = process.env.SUBMIT_SHOTS || path.join(os.homedir(), 'Projects/glaze-plans/writer/mockups/build-submit');
const checks = [], requests = [], errors = [];
let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// The page's world: a real Quill on each writable box (as scripts/writer-paper-check.js), and on an assignment attempt
// the stand-in for Ultra's React file area and footer.
const HARNESS = `(() => {
  const mode = new URLSearchParams(location.search).get('mode') || '';
  const log = window.__log = []; window.__uploads = []; window.__clicks = []; window.__picker = 0;
  let q = null;
  for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
    const old = c.querySelector('.ql-editor'), html = old.innerHTML, id = old.id;
    c.innerHTML = '';
    q = new Quill(c, {});
    if (id) q.root.id = id;
    q.root.setAttribute('role', 'textbox');
    if (!mode.includes('empty') && /[^\\s]/.test(html.replace(/<[^>]*>/g, ''))) q.setContents(q.clipboard.convert(html), 'silent');
    window.__native = () => q.root.innerHTML;
    window.__text = () => q.getText();
  }
  for (const i of document.querySelectorAll('input[type=file]')) i.addEventListener('click', () => { window.__picker++; });
  document.addEventListener('click', (e) => { const b = e.target.closest('.footer button'); if (b) window.__clicks.push(b.getAttribute('analytics-id')); });
  const panel = document.querySelector('bb-assignment-attempt-authoring-panel');
  if (!panel) return;
  const style = document.createElement('style');
  style.textContent = '.Mui-disabled { pointer-events: none; }';
  document.head.append(style);
  const root = panel.firstElementChild, area = document.querySelector('[class*="makeStylessubmission-"]'), preview = area.querySelector('[class*="makeStylespreview-"]');
  if (mode.includes('gone')) preview.remove();
  if (mode.includes('noinput')) preview.querySelector('input').remove();
  const files = [];
  const footer = { save: document.querySelector('${SAVE}'), submit: document.querySelector('${SUBMIT}') };
  const state = () => {
    const on = !mode.includes('stuck') && (q.getText().trim().length > 0 || files.length > 0);
    for (const b of [footer.save, footer.submit]) { b.disabled = !on; b.classList.toggle('Mui-disabled', !on); b.tabIndex = on ? 0 : -1; }
  };
  q.on('text-change', state);
  state();
  const take = async (list, via) => {
    for (const f of list) { window.__uploads.push({ name: f.name, type: f.type, size: f.size, via, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) }); log.push('upload'); }
    if (mode.includes('never')) return;
    setTimeout(() => {
      for (const f of list) {
        files.push(f);
        const row = document.createElement('div'), name = document.createElement('span');
        row.className = 'makeStylesfileRow-0-2-401'; name.className = 'makeStylesfileName-0-2-402'; name.textContent = f.name;
        row.append(name);
        (preview.isConnected ? preview : area).after(row);
      }
      log.push('row');
      state();
    }, 400);
  };
  root.addEventListener('change', (e) => { if (e.target.matches('input[type=file]')) take([...e.target.files], 'input'); });
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', (e) => { if (e.target.closest('[class*="makeStylesinputContainer-"]')) { e.preventDefault(); take([...e.dataTransfer.files], 'drop'); } });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('footer button');
    if (!b) return;
    window.__clicks.push(b.getAttribute('data-analytics-id'));
    log.push('click:' + b.getAttribute('data-analytics-id'));
    if (b === footer.submit) { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.id = 'ultra-confirm'; d.textContent = 'Submit this attempt?'; document.body.append(d); }
  });
})();`;

(async () => {
  let context, held = false, tmp, ext;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-submit-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-submit-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-submit-'));
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
      if (u.protocol === 'chrome-extension:') return r.continue();
      requests.push({ method: req.method(), origin: u.origin, path: u.pathname });
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      const page = { [ATTEMPT]: 'ultra-writer-attempt.html', [TEST]: 'ultra-writer-test.html' }[u.pathname];
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
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, writerUploads: true, drafts: true }, writer: { full: true } });
    await worker.evaluate(async ({ settings, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] }); }, { settings, site });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();
    const watch = (p, tag) => {
      p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
    };
    const settle = async (fr) => { await pause(150); await fr.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await pause(100); };
    const openAttempt = async (mode = '', keepPermit = false) => {
      if (!keepPermit) await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('writerSubmit:'))); });
      const p = await context.newPage();
      watch(p, `page${mode ? `?${mode}` : ''}`);
      await p.goto(`${site}${ATTEMPT}${mode ? `?mode=${mode}` : ''}`);
      const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity && f.offsetHeight > 500) && x; }, 'paper frame shown');
      const fr = await until(() => el.contentFrame(), 'frame document');
      await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key() && !document.querySelector('.gp-submit').disabled), 'paper loaded and Submit… on');
      await until(() => fr.evaluate(() => document.querySelectorAll('.gp-sheet').length > 0 && document.querySelector('.gp-flow').style.visibility === ''), 'pages drawn');
      return { p, el, fr };
    };
    const sheetOpen = (fr) => until(() => fr.evaluate(() => !!document.querySelector('.gs-layer[data-open]')), 'sheet open');
    const sheetText = (fr) => fr.evaluate(() => {
      const L = document.querySelector('.gs-layer'), q = (s) => L?.querySelector(s);
      return L && { title: q('h2').textContent, label: q('.gs-field label').textContent, name: q('.gs-name').textContent, size: q('.gs-file small').textContent, toggle: q('.gs-toggle span').textContent, sw: q('.gs-sw').getAttribute('aria-checked'),
        open: q('.gs-open')?.textContent || '', err: q('.gs-err').textContent, buttons: [...L.querySelectorAll('.gs-foot button')].map((b) => b.textContent), thumbs: L.querySelectorAll('.gs-thumb').length,
        thumbText: [...L.querySelectorAll('.gs-thumb')].map((x) => squash(x.querySelector('.ProseMirror')?.textContent).length), offsets: [...L.querySelectorAll('.gs-thumb .gp-flow')].map((x) => parseFloat(x.style.top)), headers: [...L.querySelectorAll('.gs-thumb .gp-hdr')].map((x) => x.textContent) };
      function squash(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    });
    const versions = () => worker.evaluate(async () => { const all = await chrome.storage.local.get(null); const k = Object.keys(all).find((x) => x.startsWith('writerVersions:')); return (all[k] || []).map((v) => v.reason); });
    const shot = async (target, name) => { fs.mkdirSync(shots, { recursive: true }); await pause(250); const f = path.join(shots, name); await target.screenshot({ path: f }); return f; };
    const saved = {};
    const center = async (p, sel) => { const b = await p.$eval(sel, (x) => { x.scrollIntoView({ block: 'center' }); const r = x.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); return b; };

    // ---- the sheet's look, over the 6-page MLA fixture
    let { p, el, fr } = await openAttempt();
    await fr.evaluate(async (json) => {
      const v = GZ_WRITER_PAPER.current().editor.view;
      v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON(json).content));
    }, FX.papers.mla9());
    await settle(fr);
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = 0; v.state.doc.descendants((n, pos) => { if (!at && n.isText && n.text.includes('(Morrison 35)')) at = pos + n.text.indexOf('(Morrison 35)'); }); v.dispatch(v.state.tr.insertText('(Morrison, 42)', at, at + '(Morrison 35)'.length)); });
    await until(() => fr.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved' && (globalThis.GZ_WRITER_ISSUES?.list().length || 0) > 0), 'saved, with a check open');
    await settle(fr);
    const before = { versions: (await versions()).length, native: await p.evaluate(() => __text()) };
    await fr.click('.gp-tbtn[aria-label="Focus"]');
    await until(() => el.evaluate((f) => getComputedStyle(f).position === 'fixed'), 'focus fills the window');
    await settle(fr);
    await fr.click('.gp-submit');
    await sheetOpen(fr);
    await until(() => fr.evaluate(() => / KB$/.test(document.querySelector('.gs-file small').textContent)), 'file size shown');
    const look = await sheetText(fr);
    console.log(JSON.stringify(look));
    const pages = await fr.evaluate(() => GZ_WRITER_PAPER.current().pages());
    check(look.title === 'Submit Essay 2' && look.label === 'Note to Professor Okafor' && look.toggle === 'Also paste the text in the text box' && look.sw === 'false', 'sheet: "Submit Essay 2", the note to the instructor the heading names, the paste switch off');
    check(look.name === 'Rivera_Essay2.docx' && new RegExp(`^${pages} pages · \\d+ KB$`).test(look.size), `file chip: Rivera_Essay2.docx · ${look.size}`);
    check(look.thumbs === 2 && look.headers.join('|') === 'Rivera 1|Rivera 2' && look.thumbText.every((n) => n > 1000) && look.offsets[0] === 0 && look.offsets[1] < -1000, 'the first two pages drawn from the paged view (each its own header, the text flow shifted to its page), not placeholders');
    check(/^\d+ checks? open/.test(look.open) && /Review$/.test(look.open), `open checks banner: "${look.open}"`);
    check(look.buttons.join('|') === 'Cancel|Submit' && look.err === '', 'Cancel and Submit, no error');
    check(await fr.evaluate(() => { const s = getComputedStyle(document.querySelector('.gs-sheet')); return s.transitionDuration.split(',').every((d) => d.trim() === '0.16s') && /opacity/.test(s.transitionProperty) && /transform/.test(s.transitionProperty); }), 'the sheet rises and fades in over 160 ms (transform and opacity only)');
    saved.sheet = await shot(p, 'submit.png');
    // Focus stays in the sheet: Tab and Shift+Tab wrap.
    const inside = async () => fr.evaluate(() => !!document.activeElement?.closest('.gs-layer'));
    check(await fr.evaluate(() => document.activeElement?.id === 'gs-note'), 'the note has focus when the sheet opens');
    let trapped = true;
    for (let i = 0; i < 9; i++) { await p.keyboard.press('Tab'); trapped &&= await inside(); }
    for (let i = 0; i < 9; i++) { await p.keyboard.press('Shift+Tab'); trapped &&= await inside(); }
    check(trapped, 'Tab and Shift+Tab stay in the sheet');
    check(await fr.evaluate(() => document.querySelector('.gp').inert), 'the paper behind is inert while the sheet is open');
    // Review jumps to Checks.
    await fr.click('.gs-review');
    check(await fr.evaluate(() => !document.querySelector('.gs-layer') && document.getElementById('gp-tab-checks').getAttribute('aria-selected') === 'true' && !!document.activeElement?.closest('#gp-checks, #gp-tab-checks')), 'Review closes the sheet and goes to the Checks tab');
    // Cancel and Escape change nothing.
    await fr.evaluate(() => { window.__was = document.activeElement; });
    await fr.click('.gp-submit');
    await sheetOpen(fr);
    await p.keyboard.type('A note never sent.', { delay: 2 });
    await fr.click('.gs-sw');
    check(await fr.evaluate(() => document.querySelector('.gs-sw').getAttribute('aria-checked') === 'true'), 'the switch turns on');
    await fr.click('.gs-foot .gs-btn:not(.gs-primary)');
    check(await fr.evaluate(() => !document.querySelector('.gs-layer') && document.activeElement === window.__was && window.__was !== document.body), 'Cancel closes it, focus back where it was');
    await fr.click('.gp-submit');
    await sheetOpen(fr);
    check(await fr.evaluate(() => document.querySelector('#gs-note').value === '' && document.querySelector('.gs-sw').getAttribute('aria-checked') === 'false'), 'a new sheet starts blank');
    await p.keyboard.press('Escape');
    check(await fr.evaluate(() => !document.querySelector('.gs-layer') && document.querySelector('.gp-tbtn[aria-label="Focus"]').getAttribute('aria-pressed') === 'true'), 'Escape closes the sheet only (Focus stays)');
    await pause(300);
    check(await p.evaluate(() => __uploads.length === 0 && __clicks.length === 0 && __picker === 0) && (await versions()).length === before.versions && await p.evaluate(() => __text()) === before.native, 'Cancel and Escape change nothing: no file, no click, no text in Ultra\'s box, no version');
    await fr.click('.gp-tbtn[aria-label="Focus"]');
    await until(() => el.evaluate((f) => getComputedStyle(f).position !== 'fixed'), 'focus off');
    await settle(fr);
    await fr.click('.gp-submit');
    await sheetOpen(fr);
    saved.panel = await shot(p, 'submit-panel.png');
    await p.keyboard.press('Escape');
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await fr.click('.gp-submit');
    await sheetOpen(fr);
    check(await fr.evaluate(() => getComputedStyle(document.querySelector('.gs-sheet')).transitionDuration.split(',').every((d) => d.trim() === '0s')), 'with reduced motion the sheet appears without motion');
    await p.keyboard.press('Escape');
    await p.emulateMedia({ reducedMotion: null });

    // ---- Ultra's own buttons, enabled (its box holds the fixture's text): caught before Ultra
    await p.click(SUBMIT);
    await sheetOpen(fr);
    check(await p.evaluate(() => !__clicks.length), 'Ultra\'s Submit (enabled) opens the sheet and Ultra never hears the click');
    await p.keyboard.press('Escape');
    const savedAt = await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); const k = Object.keys(all).find((x) => x.startsWith('writerPaper:')); return all[k]?.updated || 0; });
    await p.click(SAVE);
    await until(() => p.evaluate(() => __clicks.includes('course.content.assessment.footer.buttons.saveAndClose')), 'Save and Close goes on');
    const savedAfter = await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); const k = Object.keys(all).find((x) => x.startsWith('writerPaper:')); return all[k]?.updated || 0; });
    check(savedAfter > savedAt && await p.evaluate(() => __clicks.join() === 'course.content.assessment.footer.buttons.saveAndClose' && !__uploads.length), 'Save and Close saves the paper first, then Ultra\'s own goes on, once, attaching nothing');
    await p.close();

    // ---- the whole flow, by keyboard, from Ultra's disabled Submit (its box empty)
    ({ p, el, fr } = await openAttempt('empty'));
    check(await p.evaluate((s) => document.querySelector(s).disabled, SUBMIT), 'Ultra\'s Submit is disabled while its box is empty');
    const at = await center(p, SUBMIT);
    await p.mouse.click(at.x, at.y);
    await sheetOpen(fr);
    check(true, 'a press on Ultra\'s disabled Submit opens the sheet');
    const docText = await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.text());
    await p.keyboard.type('Thank you for the extension.', { delay: 2 });
    await p.keyboard.press('Tab');
    check(await fr.evaluate(() => document.activeElement?.id === 'gs-paste'), 'Tab moves to the switch');
    await p.keyboard.press('Space');
    check(await fr.evaluate(() => document.querySelector('.gs-sw').getAttribute('aria-checked') === 'true'), 'Space turns it on');
    for (let i = 0; i < 4 && !await fr.evaluate(() => document.activeElement?.classList.contains('gs-primary')); i++) await p.keyboard.press('Tab');
    check(await fr.evaluate(() => document.activeElement?.classList.contains('gs-primary')), 'Tab reaches Submit');
    const versionsBefore = (await versions()).length;
    await p.keyboard.press('Enter');
    await until(() => p.evaluate(() => __clicks.length > 0), 'Ultra\'s Submit clicked', 30000);
    await pause(800);
    const run = await p.evaluate(() => ({ uploads: __uploads, log: __log, clicks: __clicks, picker: __picker, text: __text(), confirm: !!document.getElementById('ultra-confirm') }));
    check(run.uploads.length === 1 && run.uploads[0].name === 'Rivera_Essay2.docx' && run.uploads[0].type === MIME && run.uploads[0].via === 'input' && run.picker === 0, 'the .docx lands in the file area\'s input (Rivera_Essay2.docx, the Word type), no file picker opened');
    const bytes = Buffer.from(run.uploads[0].bytes);
    fs.writeFileSync(path.join(out, 'Rivera_Essay2.docx'), bytes);
    const read = squash(await DT.docx(new Uint8Array(bytes)));
    const paras = docText.split('\n').map(squash).filter((x) => x.length > 20);
    const missing = paras.filter((x) => !read.includes(x));
    if (missing.length) console.log('missing from the .docx:', JSON.stringify(missing));
    check(paras.length >= 15 && !missing.length && bytes.length === run.uploads[0].size, `its bytes read back (lib/doctext.js) as the paper: all ${paras.length} paragraphs`);
    check(run.text.startsWith('Thank you for the extension.\n\nAlex Rivera\n') && squash(run.text).includes(paras.at(-1)), 'the note, then the paper\'s text, land in Ultra\'s Quill');
    check(run.clicks.join() === 'assignment.attempt.authoring.footer.submit', 'Ultra\'s Submit clicked exactly once');
    check(run.log.indexOf('row') > run.log.indexOf('upload') && run.log.indexOf('click:assignment.attempt.authoring.footer.submit') > run.log.indexOf('row'), `and only after Ultra listed the file (${run.log.join(' → ')})`);
    const reasons = await versions();
    check(reasons.length === versionsBefore + 1 && reasons[0] === 'submit', 'a version was saved as Submitted');
    check(run.confirm && await fr.evaluate(() => !document.querySelector('.gs-layer')), 'the sheet closes; Ultra\'s confirmation is Ultra\'s');
    await p.close();

    // ---- Settings → Writer → Submitting: the paste switch remembered, set before the frame loads and switched live
    const W0 = G.GZ_SANITIZE({ writer: { full: true } }).writer, setW = (w) => worker.evaluate((w) => chrome.storage.sync.set({ writer: w }), G.GZ_SANITIZE({ writer: w }).writer);
    const keptW = async () => (await worker.evaluate(() => chrome.storage.sync.get('writer'))).writer?.submit;
    check((await keptW())?.text === true, 'remembered by default: the switch turned on above is kept (writer.submit.text)');
    const cancelSheet = async (fr) => { await fr.click('.gs-foot button:has-text("Cancel")'); await until(() => fr.evaluate(() => !document.querySelector('.gs-layer')), 'sheet closed'); };
    await setW({ ...W0, submit: { rememberText: true, text: true } });
    ({ p, el, fr } = await openAttempt('gone'));
    await fr.click('.gp-submit'); await sheetOpen(fr);
    check((await sheetText(fr)).sw === 'true', 'remember on, left on, before the frame loads: the sheet opens with the switch on');
    await fr.click('#gs-paste'); await cancelSheet(fr); await pause(400);
    check((await keptW()).text === true, 'turned off and cancelled: nothing kept');
    await fr.click('.gp-submit'); await sheetOpen(fr);
    check((await sheetText(fr)).sw === 'true', 'so the next sheet starts on again');
    // A Submit that fails (no file area on this page) still keeps the choice it was pressed with.
    await fr.click('#gs-paste');
    await fr.click('.gs-primary');
    await until(async () => (await keptW()).text === false, 'kept off at Submit');
    await until(() => fr.evaluate(() => document.querySelector('.gs-err')?.textContent !== ''), 'the failure said');
    check(true, 'Submit keeps the switch as pressed (off)');
    await cancelSheet(fr);
    await fr.click('.gp-submit'); await sheetOpen(fr);
    check((await sheetText(fr)).sw === 'false', 'and the next sheet starts off');
    await cancelSheet(fr);
    await setW({ ...W0, submit: { rememberText: false, text: false } });
    await pause(300);
    await fr.click('.gp-submit'); await sheetOpen(fr);
    await fr.click('#gs-paste');
    await fr.click('.gs-primary');
    await until(() => fr.evaluate(() => document.querySelector('.gs-err')?.textContent !== ''), 'the failure said');
    await pause(400);
    check((await keptW()).text === false, 'remember switched off live: a Submit with the switch on keeps nothing');
    await cancelSheet(fr);
    await setW({ ...W0, submit: { rememberText: true, text: true } });
    await pause(300);
    await fr.click('.gp-submit'); await sheetOpen(fr);
    check((await sheetText(fr)).sw === 'true', 'remember switched on live: the switch starts where it was left');
    await cancelSheet(fr);
    await p.close();
    await setW(W0);

    // ---- a drop when the input isn't drawn, and a double click submits once
    ({ p, el, fr } = await openAttempt('empty,noinput'));
    await fr.click('.gp-submit');
    await sheetOpen(fr);
    await fr.dblclick('.gs-primary');
    await until(() => p.evaluate(() => __clicks.length > 0), 'submitted after a drop', 30000);
    await pause(1500);
    const drop = await p.evaluate(() => ({ uploads: __uploads.map((u) => [u.name, u.via]), clicks: __clicks, text: __text(), picker: __picker }));
    check(drop.uploads.length === 1 && drop.uploads[0].join() === 'Rivera_Essay2.docx,drop' && drop.picker === 0, 'without its input, the file is dropped on Ultra\'s drop zone (no picker)');
    check(drop.clicks.length === 1 && drop.text === '\n', 'a double click submits once; nothing chosen, nothing written into Ultra\'s box');
    await p.close();

    // ---- a second tab shares the attempt fence, even after the first native footer is remounted
    ({ p, el, fr } = await openAttempt('empty'));
    const second = await openAttempt('empty', true);
    await fr.click('.gp-submit'); await sheetOpen(fr);
    await second.fr.click('.gp-submit'); await sheetOpen(second.fr);
    await Promise.all([fr.click('.gs-primary'), second.fr.click('.gs-primary')]);
    await until(async () => (await p.evaluate(() => __clicks.length)) + (await second.p.evaluate(() => __clicks.length)) === 1, 'one tab submits');
    await until(async () => (await fr.evaluate(() => !!document.querySelector('.gs-err')?.textContent)) || (await second.fr.evaluate(() => !!document.querySelector('.gs-err')?.textContent)), 'other tab refused');
    check((await p.evaluate(() => __uploads.length)) + (await second.p.evaluate(() => __uploads.length)) === 1, 'two tabs: exactly one upload and one native Submit for the attempt');
    await p.close(); await second.p.close();

    // ---- Cancel remains usable during upload and revokes all later submission work
    ({ p, el, fr } = await openAttempt('empty'));
    await fr.click('.gp-submit'); await sheetOpen(fr); await fr.click('.gs-primary');
    await until(() => p.evaluate(() => __uploads.length === 1), 'upload started');
    check(await fr.evaluate(() => !document.querySelector('.gs-foot .gs-btn').disabled && document.activeElement?.closest('.gs-layer')), 'busy: focus stays in the sheet and Cancel remains available');
    await fr.click('.gs-foot .gs-btn:not(.gs-primary)');
    await pause(700);
    check(await p.evaluate(() => !__clicks.length && __uploads.length === 1) && await fr.evaluate(() => /review or remove/.test(document.querySelector('.gs-err').textContent) && !document.querySelector('.gs-native').hidden), 'Cancel during upload never submits and offers Blackboard review of the retained upload');
    await p.close();

    // ---- a same-named file needs native review; hand-back immediately releases capture interception
    ({ p, el, fr } = await openAttempt());
    await p.evaluate(() => { const n = document.createElement('span'); n.textContent = 'Rivera_Essay2.docx'; document.querySelector('[class*="makeStylessubmission-"]').append(n); });
    await fr.click('.gp-submit'); await sheetOpen(fr); await fr.click('.gs-primary');
    await until(() => fr.evaluate(() => !!document.querySelector('.gs-err').textContent), 'existing attachment refused');
    check(await p.evaluate(() => !__uploads.length && !__clicks.length), 'a pre-existing same-named file never triggers another upload or Submit');
    await fr.click('.gs-native');
    await until(() => p.evaluate(() => !document.querySelector('iframe.gz-writer')), 'Blackboard editor restored');
    await p.click(SUBMIT);
    check(await p.evaluate(() => __clicks.join() === 'assignment.attempt.authoring.footer.submit'), 'Blackboard editor hand-back releases native Submit interception');
    await p.close();

    // ---- failures stop before Submit
    const fail = async (mode, re, ms, label) => {
      const o = await openAttempt(mode);
      await o.fr.click('.gp-submit');
      await sheetOpen(o.fr);
      await o.fr.click('.gs-primary');
      await until(() => o.fr.evaluate(() => document.querySelector('.gs-err').textContent), `${mode} error`, ms);
      const s = await sheetText(o.fr);
      const r = await o.p.evaluate(() => ({ clicks: __clicks.filter((c) => /submit/.test(c)), uploads: __uploads.length, picker: __picker }));
      check(re.test(s.err) && r.clicks.length === 0 && r.picker === 0 && await o.fr.evaluate(() => !document.querySelector('.gs-primary').disabled), `${label}: "${s.err}"; Submit never clicked`);
      return { ...o, r };
    };
    ({ p } = await fail('empty,gone', /file upload isn’t on this page/, 8000, 'no file area'));
    await p.close();
    let f = await fail('empty,never', /didn’t list the file/, 45000, 'the file never listed');
    saved.error = await shot(f.p, 'submit-error.png');
    await f.p.close();
    f = await fail('stuck', /Submit didn’t turn on/, 30000, 'Ultra\'s Submit never enabled');
    check(f.r.uploads === 1, 'after attaching once');
    await f.fr.click('.gs-primary');
    await until(() => f.fr.evaluate(() => !document.querySelector('.gs-primary').disabled && document.querySelector('.gs-err').textContent), 'second try ends', 30000);
    check(await f.p.evaluate(() => __uploads.length === 1 && !__clicks.some((c) => /submit/.test(c))), 'a second, explicit try doesn\'t attach a second copy, and still never submits');
    await f.p.close();

    // ---- bringing a file: on the paper, in Ultra's own file area, a PDF, ⋯ → Import…, and the switch off
    const ishots = process.env.IMPORT_SHOTS || path.join(os.homedir(), 'Projects/glaze-plans/writer/mockups/settings-ai/build-import');
    const ishot = async (target, name) => { fs.mkdirSync(ishots, { recursive: true }); await pause(350); const f = path.join(ishots, name); await target.screenshot({ path: f }); return f; };
    const sha = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');
    const blankPaper = () => worker.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => /^writer(Paper|Versions):/.test(k))); });
    const paperText = (fr) => fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent);
    const cardOf = (fr) => fr.evaluate(() => {
      const c = document.querySelector('.gi-layer[data-open] .gi-card');
      return c && { name: c.querySelector('.gi-file b').textContent, meta: c.querySelector('.gi-file small').textContent, tiles: [...c.querySelectorAll('.gi-choice > span:first-of-type')].map((x) => x.textContent),
        kept: c.querySelector('.gi-kept')?.textContent || '', focus: !!document.activeElement?.classList.contains('gi-default') };
    });
    const asisOf = (fr) => fr.evaluate(() => {
      const L = document.querySelector('.gs-layer[data-open]'), q = (x) => L?.querySelector(x);
      return L && { asis: !!q('.gs-asis'), big: q('.gs-big .gs-doc')?.textContent || '', name: q('.gs-name').textContent, size: q('.gs-file small').textContent, toggle: !!q('.gs-toggle'), open: !!q('.gs-open'), thumbs: L.querySelectorAll('.gs-thumb').length, title: q('h2').textContent };
    });
    // In the frame, a .docx of the APA fixture as Writer writes one: what a student brings.
    ({ p, el, fr } = await openAttempt('empty'));
    const essay = Buffer.from(await fr.evaluate(async (json) => {
      await GZ_WRITER_PAPER.need(['lib/zip.js', 'lib/doctext.js', 'lib/writer-docx.js']);
      return Array.from((await GZ_WRITER_DOCX.exportDocx(GZ_WRITER_SCHEMA.paper.nodeFromJSON(json), { format: GZ_WRITER_STYLES.get('apa7'), surname: 'Rivera', title: 'Essay 2' })).bytes);
    }, FX.papers.apa7()));
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n%synthetic\n'), crypto.randomBytes(4096), Buffer.from('\n%%EOF\n')]);
    const files = path.join(out, 'import');
    fs.mkdirSync(files, { recursive: true });
    fs.writeFileSync(path.join(files, 'Rivera_Essay2.docx'), essay);
    fs.writeFileSync(path.join(files, 'Rivera_Essay2.pdf'), pdf);
    const marker = (() => { let x = ''; JSON.stringify(FX.papers.apa7(), (k, v) => { if (k === 'text' && !x && v.length > 60) x = v; return v; }); return x.slice(0, 50); })();
    await p.close();
    await blankPaper();
    ({ p, el, fr } = await openAttempt('empty'));
    const give = (target, sel, name, type, bytes, drop = true) => target.evaluate(({ sel, name, type, bytes, drop }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { type }));
      const at = document.querySelector(sel);
      for (const t of ['dragenter', 'dragover', ...(drop ? ['drop'] : [])]) at.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, { sel, name, type, bytes: Array.from(bytes), drop });
    // A .docx over the paper, then dropped on it: the card, over an empty paper with no word about saving it.
    await give(fr, '.gp-canvas', 'Rivera_Essay2.docx', MIME, essay, false);
    check(await fr.evaluate(() => document.querySelector('.gp-canvas').classList.contains('gp-drop')), 'a file over the paper marks it as a drop target');
    saved.dragPaper = await ishot(p, 'import-drag-paper-dark.png');
    await give(fr, '.gp-canvas', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => cardOf(fr), 'the card');
    let card = await cardOf(fr);
    console.log(JSON.stringify(card));
    check(card.name === 'Rivera_Essay2.docx' && /^\d+ KB$/.test(card.meta) && card.tiles.join('|') === 'Open in Writer|Submit as is' && !card.kept && card.focus, `a .docx dropped on the paper: the card (${card.meta}), Open in Writer focused for Enter, no "Saves current paper" over an empty paper`);
    check(await fr.evaluate(() => document.querySelector('.gp').inert), 'the paper behind is inert while the card is open');
    check(await fr.evaluate(() => { const c = getComputedStyle(document.querySelector('.gi-card')); return c.transitionDuration.split(',').every((d) => d.trim() === '0.16s') && /transform/.test(c.transitionProperty); }), 'the card rises and fades in over 160 ms');
    saved.choiceDocx = await ishot(p, 'import-choice-docx-dark.png');
    let cardTrapped = true;
    for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) { await p.keyboard.press(key); cardTrapped &&= await fr.evaluate(() => !!document.activeElement?.closest('.gi-card')); }
    check(cardTrapped, 'the import card traps Tab and Shift+Tab');
    const plain = await paperText(fr), countBefore = (await versions()).length;
    await p.keyboard.press('Escape');
    check(await fr.evaluate(() => !document.querySelector('.gi-layer') && !document.querySelector('.gp').inert) && await paperText(fr) === plain && (await versions()).length === countBefore, 'Escape closes the card and changes nothing');
    await give(fr, '.gp-canvas', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => cardOf(fr), 'the card again');
    await fr.click('.gi-x');
    check(await fr.evaluate(() => !document.querySelector('.gi-layer')) && await paperText(fr) === plain && (await versions()).length === countBefore && await p.evaluate(() => !__uploads.length), 'its close button changes nothing either');
    // A paper with text (in its last empty paragraph, the body's, not a heading line): Open in Writer says it saves it, Enter opens the file, Undo brings the paper back.
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = null; v.state.doc.forEach((n, off) => { if (n.type.name === 'paragraph' && !n.content.size) at = off + 1; }); v.dispatch(v.state.tr.insertText('A draft that the import replaces.', at ?? v.state.doc.content.size - 1)); });
    await until(() => fr.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved'), 'draft saved');
    const checksPane = () => fr.evaluate(() => [...document.querySelectorAll('#gp-checks .gp-issue, #gp-checks .gp-list > div')].map((x) => x.textContent).join('|'));
    const draft = await paperText(fr), issuesBefore = await checksPane();
    await give(fr, '.gp-canvas', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => cardOf(fr), 'the card over the draft');
    card = await cardOf(fr);
    check(card.kept === 'Saves current paper', 'over a paper with text, Open in Writer carries "Saves current paper"');
    saved.choiceReplace = await ishot(p, 'import-choice-replace-dark.png');
    const beforeCount = (await versions()).length;
    await p.keyboard.press('Enter');
    await until(async () => (await paperText(fr)).includes(marker), 'the file opened in Writer');
    await settle(fr);
    const kept = await versions();
    check(kept.length === beforeCount + 1 && kept[0] === 'import' && !(await paperText(fr)).includes('A draft that the import replaces.'), 'Enter (Open in Writer): the paper is the file\'s text, the draft kept as a version first');
    const toast = await fr.evaluate(() => ({ text: document.querySelector('.gp-toast span')?.textContent, undo: document.querySelector('.gp-toast .gp-toast-do')?.textContent }));
    check(toast.text === 'Rivera_Essay2.docx' && toast.undo === 'Undo', 'a toast with the file\'s name and Undo');
    await until(async () => (await checksPane()) !== issuesBefore, 'Checks redrawn for the file');
    check(true, `Checks refresh for the opened file (${await fr.evaluate(() => document.querySelectorAll('#gp-checks .gp-issue').length)} open)`);
    saved.opened = await ishot(p, 'import-opened-dark.png');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.insertText('Import review later edits', v.state.doc.content.size - 1)); });
    await fr.click('.gp-toast-do');
    await until(async () => (await paperText(fr)) === draft, 'undone');
    check((await versions())[0] === 'restore' && await p.evaluate(() => !__uploads.length && !__clicks.length), 'Undo restores the paper as it was; nothing went to Ultra');
    check(await worker.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).some(([k, v]) => k.startsWith('writerVersions:') && JSON.stringify(v).includes('Import review later edits'))), 'Undo after further edits keeps those edits in a restorable version');
    // ⋯ → Import…: the same card for a .docx chosen there.
    await fr.click('.gp-status button:last-child');
    await until(() => fr.evaluate(() => [...document.querySelectorAll('.gp-menu [role=menuitem]')].some((b) => b.textContent === 'Import…')), 'Import… in the menu');
    saved.menu = await ishot(p, 'import-menu-dark.png');
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), fr.evaluate(() => [...document.querySelectorAll('.gp-menu [role=menuitem]')].find((b) => b.textContent === 'Import…').click())]);
    await chooser.setFiles(path.join(files, 'Rivera_Essay2.docx'));
    await until(() => cardOf(fr), 'the card from Import…');
    check(true, '⋯ → Import… brings a chosen .docx to the same card');
    await p.keyboard.press('Escape');
    // Ultra's own input: the card in the frame, and Ultra hears nothing until Submit as is attaches the file's very bytes.
    const paperBefore = await paperText(fr), countAsis = (await versions()).length;
    await p.setInputFiles('[class*="makeStylessubmission-"] input[type=file]', path.join(files, 'Rivera_Essay2.docx'));
    await until(() => cardOf(fr), 'the card from Ultra\'s input');
    check(await p.evaluate(() => !__uploads.length && !__log.length), 'a .docx chosen through Ultra\'s "Upload files" reaches the card before Ultra hears it');
    await fr.click('.gi-choice:not(.gi-default)');
    await sheetOpen(fr);
    let asis = await asisOf(fr);
    console.log(JSON.stringify(asis));
    check(asis.asis && asis.big === 'DOCX' && asis.name === 'Rivera_Essay2.docx' && / KB$/.test(asis.size) && !asis.toggle && !asis.open && !asis.thumbs && asis.title === 'Submit Essay 2', 'Submit as is: the sheet shows the file large, the note, no paste switch, no checks');
    await p.keyboard.type('My file is attached as is.', { delay: 2 });
    saved.submitAsis = await ishot(p, 'import-submit-asis-dark.png');
    await fr.click('.gs-primary');
    await until(() => p.evaluate(() => __clicks.length > 0), 'submitted as is', 30000);
    await pause(600);
    let got = await p.evaluate(() => ({ uploads: __uploads, clicks: __clicks, text: __text(), log: __log }));
    check(got.uploads.length === 1 && got.uploads[0].name === 'Rivera_Essay2.docx' && got.uploads[0].type === MIME && got.uploads[0].via === 'input' && sha(got.uploads[0].bytes) === sha(essay), `Ultra got the original file, byte for byte (sha256 ${sha(essay).slice(0, 12)}…)`);
    check(got.text === 'My file is attached as is.\n' && got.clicks.join() === 'assignment.attempt.authoring.footer.submit' && got.log.indexOf('click:assignment.attempt.authoring.footer.submit') > got.log.indexOf('row'), 'the note in Ultra\'s box, Ultra\'s Submit clicked once after the file was listed');
    check((await versions()).length === countAsis && await paperText(fr) === paperBefore, 'the paper untouched: no version saved, its text as it was');
    await p.close();
    // A PDF on Ultra's drop zone: straight to the sheet as is.
    ({ p, el, fr } = await openAttempt('empty'));
    await give(p, '[class*="makeStylesinputContainer-"]', 'Rivera_Essay2.pdf', 'application/pdf', pdf);
    await sheetOpen(fr);
    asis = await asisOf(fr);
    check(asis.asis && asis.big === 'PDF' && asis.name === 'Rivera_Essay2.pdf' && await fr.evaluate(() => !document.querySelector('.gi-layer') && getComputedStyle(document.querySelector('.gs-big .gs-doc')).backgroundColor === 'rgb(220, 38, 38)') && await p.evaluate(() => !__uploads.length), 'a PDF dropped on Ultra\'s area: no card, straight to the sheet as is, Ultra none the wiser');
    saved.submitPdf = await ishot(p, 'import-submit-pdf-dark.png');
    await fr.click('.gs-primary');
    await until(() => p.evaluate(() => __clicks.length > 0), 'PDF submitted', 30000);
    got = await p.evaluate(() => ({ uploads: __uploads, clicks: __clicks, text: __text() }));
    check(got.uploads.length === 1 && got.uploads[0].name === 'Rivera_Essay2.pdf' && got.uploads[0].type === 'application/pdf' && sha(got.uploads[0].bytes) === sha(pdf) && got.clicks.length === 1 && got.text === '\n', 'the PDF submitted unchanged (hashes match), once, with no note');
    await p.close();
    // Open uploads in Writer off: Ultra's area takes files itself, the frame never sees them.
    const sync = await worker.evaluate(() => chrome.storage.sync.get(null));
    await worker.evaluate((s) => chrome.storage.sync.set({ enhance: { ...s.enhance, writerUploads: false } }), sync);
    ({ p, el, fr } = await openAttempt('empty'));
    await give(p, '[class*="makeStylesinputContainer-"]', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => p.evaluate(() => __uploads.length === 1), 'Ultra took the drop');
    await p.setInputFiles('[class*="makeStylessubmission-"] input[type=file]', path.join(files, 'Rivera_Essay2.pdf'));
    await until(() => p.evaluate(() => __uploads.length === 2), 'Ultra took the choice');
    await pause(400);
    check(await p.evaluate(() => __uploads.map((u) => u.via).join() === 'drop,input') && await fr.evaluate(() => !document.querySelector('.gi-layer') && !document.querySelector('.gs-layer')), 'Open uploads in Writer off: Ultra\'s area takes the drop and the choice itself, Writer shows nothing');
    await p.close();
    // The light Look (Paper), for the mockup's light shots.
    await worker.evaluate((s) => chrome.storage.sync.set({ ...s, preset: 'Paper', colors: s.paper }), { ...sync, paper: G.GZ_PRESETS.find(([n]) => n === 'Paper')[1] });
    await blankPaper();
    ({ p, el, fr } = await openAttempt('empty'));
    await until(() => fr.evaluate(() => !document.documentElement.hasAttribute('data-dark')), 'light Look');
    await give(fr, '.gp-canvas', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => cardOf(fr), 'the light card');
    saved.choiceLight = await ishot(p, 'import-choice-docx-light.png');
    await fr.click('.gi-choice:not(.gi-default)');
    await sheetOpen(fr);
    saved.submitLight = await ishot(p, 'import-submit-asis-light.png');
    await p.keyboard.press('Escape');
    await p.close();
    await worker.evaluate((s) => chrome.storage.sync.set(s), sync);

    // ---- the compact box: Settings → Writer → Full writer off (the default)
    const cshots = process.env.COMPACT_SHOTS || path.join(os.homedir(), 'Projects/glaze-plans/writer/mockups/build-documents');
    const cshot = async (target, name) => { fs.mkdirSync(cshots, { recursive: true }); await pause(350); const f = path.join(cshots, name); await target.screenshot({ path: f }); return f; };
    const fullSet = async () => (await worker.evaluate(() => chrome.storage.sync.get('writer'))).writer?.full;
    const setFull = (on) => worker.evaluate(async (on) => { const w = (await chrome.storage.sync.get('writer')).writer || {}; await chrome.storage.sync.set({ writer: { ...w, full: on } }); }, on);
    const viewOf = (fr) => fr.evaluate(() => {
      const shown = (x) => !!x && x.getClientRects().length > 0, q = (x) => document.querySelector(x);
      return { view: document.documentElement.dataset.view, pages: shown(q('.gp-sheet')), side: shown(q('.gp-side')), ruler: shown(q('.gr-ruler')), zoom: shown(q('.gp-tool')), box: shown(q('#gw')),
        inBox: !!q('#gw > .ProseMirror'), bar: shown(q('.gw-bar .gp-full')), top: shown(q('.gp-top .gp-full')), on: [...document.querySelectorAll('.gp-full')].map((b) => b.getAttribute('aria-checked')),
        label: q('.gw-bar .gp-full')?.textContent, role: q('.gw-bar .gp-full')?.getAttribute('role'), gw: Math.ceil(q('#gw').getBoundingClientRect().height) };
    });
    // The caret's top on the page (the frame's top plus its place in the frame) and the selection.
    const caretAt = async (el, fr) => { const box = await el.boundingBox(); const c = await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view, s = v.state.selection; return { top: v.coordsAtPos(s.head).top, from: s.from, to: s.to, focus: v.hasFocus() }; }); return { ...c, y: box.y + c.top }; };
    const openCompact = async (mode = '') => {
      const p = await context.newPage();
      watch(p, `compact${mode ? `?${mode}` : ''}`);
      await p.goto(`${site}${ATTEMPT}${mode ? `?mode=${mode}` : ''}`);
      const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity) && x; }, 'compact frame shown');
      const fr = await until(() => el.contentFrame(), 'frame document');
      await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key()), 'paper loaded');
      return { p, el, fr };
    };
    const frameH = (el) => el.evaluate((f) => f.getBoundingClientRect().height);
    await setFull(false);
    await blankPaper();
    await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('writerSubmit:'))); });
    ({ p, el, fr } = await openCompact('empty'));
    let v = await viewOf(fr);
    console.log(JSON.stringify(v));
    check(v.view === 'compact' && !v.pages && !v.side && !v.ruler && !v.zoom && v.box && v.inBox, 'an assignment opens compact: the compose box, no pages, side panel, ruler or zoom');
    check(v.bar && v.role === 'switch' && v.label === 'Full writer' && v.on.every((x) => x === 'false'), 'the compact bar ends in a "Full writer" switch, off');
    let h0 = await frameH(el);
    check(Math.abs(h0 - (v.gw + 6)) <= 2 && h0 < 400, `the frame is as tall as the box (${h0}px)`);
    await fr.click('#gw .ProseMirror');
    await p.keyboard.type('Memory in Beloved is a debt the town keeps.', { delay: 2 });
    await until(async () => (await p.evaluate(() => __text())) === 'Memory in Beloved is a debt the town keeps.\n', 'the text in Ultra\'s box');
    check(true, 'what is typed goes into Ultra\'s text box, as it is');
    check(await p.evaluate(() => !document.querySelector(`${'[data-analytics-id="assignment.attempt.authoring.footer.submit"]'}`).disabled), 'Ultra\'s Submit turns on with the text');
    const paperKey = await fr.evaluate(() => GZ_WRITER_PAPER.current().key());
    await until(async () => JSON.stringify((await worker.evaluate((k) => chrome.storage.local.get(`writerPaper:${k}`), paperKey))[`writerPaper:${paperKey}`]?.doc || '').includes('a debt the town keeps'), 'autosaved');
    check(true, 'and is autosaved to the assignment\'s paper in Writer\'s storage');
    for (let i = 0; i < 8; i++) { await p.keyboard.press('Enter'); await p.keyboard.type(`Line ${i + 2} of the draft.`, { delay: 1 }); }
    await until(async () => (await frameH(el)) > h0 + 60, 'the frame grows');
    check(true, `the frame grows with the text (${h0}px → ${await frameH(el)}px)`);
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, 1, 7))); });
    await until(() => fr.evaluate(() => !document.getElementById('tb').hidden), 'selection toolbar');
    check(await fr.evaluate(() => !!document.querySelector('#tb [data-run="bold"]') && !!document.querySelector('#tb .gzc-cite')), 'a selection shows compose\'s toolbar, Cite in it');
    for (const [w, hgt] of [[1280, 800], [640, 900]]) { await p.setViewportSize({ width: w, height: hgt }); await el.evaluate((f) => f.scrollIntoView({ block: 'center' })); saved[`compact${w}`] = await cshot(p, `compact-${w}.png`); }
    await p.setViewportSize({ width: 1440, height: 900 });
    // A long paper, the caret in its middle: Full writer and back keep the document, the caret, and its line on the page.
    await fr.evaluate((json) => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON(json).content)); }, { ...FX.papers.mla9(), content: [...FX.papers.mla9().content, { type: 'paragraph', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHtQAAAAASUVORK5CYII=', alt: 'Saved picture', width: 20, height: 20 } }] }] });
    await until(async () => /Works Cited/.test(await p.evaluate(() => __text())), 'the long paper in Ultra\'s box');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = 0; v.state.doc.descendants((n, pos) => { if (!at && n.isText && n.text.includes('(Morrison 35)')) at = pos + n.text.indexOf('(Morrison 35)'); }); v.focus(); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at)).scrollIntoView()); });
    await settle(fr);
    const ultraBefore = await p.evaluate(() => __text()), docBefore = await paperText(fr);
    const jsonBefore = await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON());
    const c0 = await caretAt(el, fr);
    await fr.click('.gw-bar .gp-full');
    await until(() => fr.evaluate(() => document.querySelectorAll('.gp-sheet').length > 1 && document.querySelector('.gp-flow').style.visibility === ''), 'pages drawn');
    await until(async () => (await frameH(el)) > 500, 'the paper\'s height');
    await settle(fr);
    v = await viewOf(fr);
    const c1 = await caretAt(el, fr), vh = await p.evaluate(() => innerHeight);
    console.log(JSON.stringify({ v, c0, c1 }));
    check(v.view === 'full' && v.pages && v.side && !v.box && v.top && v.on.every((x) => x === 'true'), 'Full writer on: the pages and side panel, the switch on in the title bar');
    check(c1.from === c0.from && c1.to === c0.to && c1.focus && await paperText(fr) === docBefore, 'the same document, the caret where it was, still typing');
    check(c1.y > 0 && c1.y < vh, `the caret's line in sight (${Math.round(c0.y)} → ${Math.round(c1.y)} of ${vh})`);
    await until(async () => (await fullSet()) === true, 'writer.full saved');
    check(true, 'the switch saves writer.full');
    await fr.click('.gp-top .gp-full');
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'round-trip compact');
    check(JSON.stringify(await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON())) === JSON.stringify(jsonBefore), 'compact → full → compact preserves the complete document, notes, page breaks and pictures');
    await p.evaluate(() => { const q = document.querySelector('.ql-container[data-gz-writer-id]').__quill; q.root.innerHTML = '<p><span>' + q.root.textContent + '</span></p>'; });
    await pause(150);
    check(JSON.stringify(await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON())) === JSON.stringify(jsonBefore), 'Ultra reformats the projection without replacing the paper');
    await p.evaluate((delta) => document.querySelector('.ql-container[data-gz-writer-id]').__quill.setContents(delta, 'user'), await fr.evaluate(() => GZ_WRITER_PAPER.project(GZ_WRITER_PAPER.current().editor.view.state.doc).delta));
    await fr.click('.gw-bar .gp-full');
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'full'), 'full again');
    await settle(fr);
    await p.keyboard.type('Pages only. ', { delay: 2 });
    await pause(600);
    check((await p.evaluate(() => __text())) === ultraBefore, 'typed in the pages, nothing goes into Ultra\'s box');
    for (const [w, hgt] of [[1280, 800], [640, 900]]) { await p.setViewportSize({ width: w, height: hgt }); await el.evaluate((f) => f.scrollIntoView({ block: 'start' })); saved[`compactFull${w}`] = await cshot(p, `compact-full-${w}.png`); }
    await p.setViewportSize({ width: 1440, height: 900 });
    await el.evaluate((f) => f.scrollIntoView({ block: 'start' }));
    await settle(fr);
    const c2 = await caretAt(el, fr), viewsBefore = (await versions()).filter((r) => r === 'view').length;
    await fr.click('.gp-top .gp-full');
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'compact again');
    await until(async () => (await p.evaluate(() => __text())).includes('Pages only.'), 'the box written again');
    await settle(fr);
    const c3 = await caretAt(el, fr);
    console.log(JSON.stringify({ c2, c3 }));
    check(c3.from === c2.from && c3.focus && Math.abs(c3.y - c2.y) <= 4, `Full writer off: the caret and its line where they were (${Math.round(c2.y)} → ${Math.round(c3.y)})`);
    check((await versions()).filter((r) => r === 'view').length === viewsBefore + 1, 'the paper kept as a version first');
    check((await p.evaluate(() => __text())).includes('Pages only.') && !/Morrison 35\./.test(await p.evaluate(() => __text())), 'then its text goes into Ultra\'s box again, footnotes left in the paper');
    await until(async () => (await fullSet()) === false, 'writer.full saved off');
    for (const width of [480, 479]) {
      await el.evaluate((f, width) => { f.style.width = `${width}px`; }, width);
      await until(() => fr.evaluate((width) => { const b = document.querySelector('.gw-bar .gp-full'), label = b.querySelector('.gp-full-name'); return !!label.getClientRects().length === (width >= 480) && b.getAttribute('aria-label') === 'Full writer'; }, width), `switch at ${width}px`);
      check(true, `Full writer at ${width}px keeps its accessible name and ${width >= 480 ? 'shows' : 'hides'} the visible label`);
    }
    await el.evaluate((f) => { f.style.width = 'calc(100% + 6px)'; });
    // A frame crash during failed native sync recovers its complete paper rather than its projection.
    await p.evaluate(() => { const c = document.querySelector('.ql-container[data-gz-writer-id]'); window.__savedPaperQuill = c.__quill; delete c.__quill; });
    const recoveryJSON = await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.insertText('Recovered last edit. ', v.state.selection.from)); return v.state.doc.toJSON(); });
    const oldCompact = el;
    await fr.evaluate(() => setTimeout(() => location.reload(), 0));
    await until(() => oldCompact.evaluate((f) => !f.isConnected), 'crashed compact frame retired');
    el = await until(() => p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'), 'replacement paper frame');
    fr = await until(() => el.contentFrame(), 'replacement paper document');
    await until(() => fr.evaluate(() => !!GZ_WRITER_PAPER.current()?.key()), 'recovered paper loaded');
    check(JSON.stringify(await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON())) === JSON.stringify(recoveryJSON), 'a crash mid-sync recovers the last edit, notes, page breaks and pictures');
    await p.evaluate(() => { document.querySelector('.ql-container[data-gz-writer-id]').__quill = __savedPaperQuill; });
    for (const name of ['Feedback', 'Checks']) {
      await fr.click('#more');
      await fr.click(`#menu [role="menuitem"]:text-is("${name}")`);
      await until(() => fr.evaluate((id) => document.documentElement.dataset.view === 'full' && document.getElementById(`gp-tab-${id}`).getAttribute('aria-selected') === 'true', name.toLowerCase()), `${name} from compact`);
      check(true, `compact ⋯ → ${name} opens the full view at its panel`);
      await fr.click('.gp-top .gp-full');
      await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'compact after panel');
    }
    for (const key of ['Space', 'Enter']) {
      await fr.focus('.gw-bar .gp-full'); await p.keyboard.press(key);
      await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'full' && document.querySelector('.gp-top .gp-full').getAttribute('aria-checked') === 'true'), `${key} turns Full writer on`);
      await fr.focus('.gp-top .gp-full'); await p.keyboard.press(key);
      await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact' && document.querySelector('.gw-bar .gp-full').getAttribute('aria-checked') === 'false'), `${key} turns Full writer off`);
      check(true, `${key} operates the Full writer switch in both views`);
    }
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.parse(GZ_WRITER_SCHEMA.paper, '<p>Morrison is less interested in nostalgea than in what the town chooses to forget.</p>').content)); v.focus(); });
    await until(() => fr.evaluate(() => GZ_WRITER_ISSUES.list().some((i) => i.source === 'harper') && !!document.querySelector('#gw .gz-iss')), 'Harper in compact', 30000);
    check(true, 'Harper draws proofing underlines in the compact paper');
    // Kept across a reload; and Settings → Writer → Full writer switches an open assignment live, both ways.
    await setFull(true);
    await p.close();
    ({ p, el, fr } = await openCompact('empty'));
    await until(() => fr.evaluate(() => document.querySelectorAll('.gp-sheet').length > 0), 'pages after reload');
    check((await viewOf(fr)).view === 'full' && (await frameH(el)) > 500, 'Full writer on stays on across a reload');
    const prefsPage = await context.newPage();
    await prefsPage.goto(`chrome-extension://${id}/options.html#writer/papers`);
    const row = prefsPage.locator('#panel-writer [data-key="writer.full"]');
    await row.waitFor({ state: 'visible' });
    check(await row.isChecked() && await prefsPage.locator('#writer-full-name').textContent() === 'Full writer', 'Settings → Writer → Papers: "Full writer", on');
    await row.click();
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'Settings turned it off');
    await until(async () => Math.abs((await frameH(el)) - ((await viewOf(fr)).gw + 6)) <= 2, 'the frame back to its box');
    check(true, 'Settings off: the open assignment turns compact');
    await row.click();
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'full' && document.querySelectorAll('.gp-sheet').length > 0), 'Settings turned it on');
    check(true, 'Settings on: the open assignment shows its pages again');
    await row.click();
    await until(async () => (await fullSet()) === false, 'off again');
    await prefsPage.close();
    await p.close();
    // Ultra's own Submit sends the box's text: no sheet, no file.
    await blankPaper();
    ({ p, el, fr } = await openCompact('empty'));
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'compact');
    await fr.click('#gw .ProseMirror');
    await p.keyboard.type('Submitted as text.', { delay: 2 });
    await until(async () => (await p.evaluate(() => __text())) === 'Submitted as text.\n', 'in Ultra\'s box');
    await p.click(SUBMIT);
    await pause(500);
    got = await p.evaluate(() => ({ uploads: __uploads.length, clicks: __clicks, text: __text(), confirm: !!document.getElementById('ultra-confirm') }));
    check(got.clicks.join() === 'assignment.attempt.authoring.footer.submit' && got.confirm && got.uploads === 0 && got.text === 'Submitted as text.\n' && await fr.evaluate(() => !document.querySelector('.gs-layer')), 'Ultra\'s Submit sends the text as it is: no sheet, no .docx');
    await p.close();
    // Submit as is from compact: the sheet owns the native text and its one final click.
    ({ p, el, fr } = await openCompact('empty'));
    await fr.click('#gw .ProseMirror'); await p.keyboard.type('Keep this compact draft.');
    await until(async () => (await p.evaluate(() => __text())).includes('Keep this compact draft.'), 'compact draft synced');
    await give(p, '[class*="makeStylesinputContainer-"]', 'Compact_original.docx', MIME, essay);
    await until(() => cardOf(fr), 'compact as-is card');
    await fr.click('.gi-choice:not(.gi-default)'); await sheetOpen(fr);
    await fr.fill('#gs-note', 'Original file attached.');
    await fr.click('.gs-primary');
    await until(() => p.evaluate(() => __clicks.length === 1), 'compact as-is submitted');
    check(await p.evaluate(() => __text() === 'Original file attached.\n' && __uploads.length === 1) && sha(await p.evaluate(() => __uploads[0].bytes)) === sha(essay), 'compact Submit as is attaches the original bytes once and preserves the sheet’s note without the compact draft');
    check((await paperText(fr)).includes('Keep this compact draft.'), 'Submit as is leaves the stored paper intact');
    await p.close();
    await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('writerSubmit:'))); });
    // Ultra's file area: a PDF is Ultra's; a .docx asks, over a frame as tall as a paper, and Open in Writer opens the pages.
    ({ p, el, fr } = await openCompact('empty'));
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'compact');
    await give(p, '[class*="makeStylesinputContainer-"]', 'Rivera_Essay2.pdf', 'application/pdf', pdf);
    await until(() => p.evaluate(() => __uploads.length === 1), 'Ultra took the PDF');
    check(await p.evaluate(() => __uploads[0].via === 'drop') && await fr.evaluate(() => !document.querySelector('.gi-layer, .gs-layer')), 'a PDF on Ultra\'s file area is Ultra\'s, to send with the text');
    h0 = await frameH(el);
    await give(p, '[class*="makeStylesinputContainer-"]', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => cardOf(fr), 'the card in the compact box');
    await until(async () => (await frameH(el)) > 500, 'room for the card');
    card = await cardOf(fr);
    check(card.tiles.join('|') === 'Open in Writer|Submit as is' && await p.evaluate(() => __uploads.length === 1), `a .docx asks Open in Writer or Submit as is, the frame a paper's height (${h0}px → ${await frameH(el)}px)`);
    saved.compactCard = await cshot(p, 'compact-card-1440.png');
    const compactRemnant = await p.evaluate(() => __text());
    await fr.click('.gi-default');
    await until(async () => (await paperText(fr)).includes(marker), 'opened');
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'full' && document.querySelectorAll('.gp-sheet').length > 0), 'the pages');
    check(await fullSet() === true, 'Open in Writer opens the file in the pages, Full writer on');
    check(await p.evaluate(() => __text()) === compactRemnant, 'opening the file leaves Ultra’s compact remnant available for explicit review');
    await p.click(SUBMIT); await until(() => fr.evaluate(() => !!document.querySelector('.gs-layer')), 'submit imported paper');
    check(await fr.getAttribute('#gs-keep', 'aria-checked') === 'false' && await fr.getAttribute('#gs-paste', 'aria-checked') === 'false', 'the submit sheet defaults to excluding the compact remnant and paper text');
    await fr.click('.gs-primary');
    await until(() => p.evaluate(() => !!document.getElementById('ultra-confirm')), 'imported file submitted');
    check(await p.evaluate(() => __text().trim() === '' && __uploads.length === 2 && __uploads[1].name.endsWith('.docx') && __clicks.length === 1), 'the imported .docx submits once with no duplicate compact text');
    await p.close();
    await setFull(true);

    // ---- a test: no sheet, nothing caught
    p = await context.newPage();
    watch(p, 'test');
    await p.goto(`${site}${TEST}`);
    const tel = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="test"]'); return x && await x.evaluate((ff) => !ff.style.opacity) && x; }, 'test box mounted');
    const tfr = await until(() => tel.contentFrame(), 'test frame');
    await until(() => tfr.evaluate(() => !!globalThis.GZ_WRITER_FRAME?.editor()), 'test editor');
    check(await tfr.evaluate(() => document.documentElement.dataset.mode === 'compose' && GZ_WRITER_PAPER.submit === null && !document.querySelector('.gp-submit')), 'a test\'s box is compose: no Submit…, no sheet hook');
    await p.click('.footer:not([hidden]) button[analytics-id="course.content.assessment.footer.buttons.submit"]');
    await pause(500);
    check(await p.evaluate(() => __clicks.join() === 'course.content.assessment.footer.buttons.submit') && await tfr.evaluate(() => !document.querySelector('.gs-layer')), 'a test\'s own Submit goes straight to Ultra, untouched');
    await p.close();

    check(errors.length === 0, `no page or frame errors (${errors.join('; ')})`);
    check(requests.every((r) => r.method === 'GET' && r.origin === site), 'every LMS request is a synthetic GET');
    passed = true;
    console.log(JSON.stringify({ checks: checks.length, shots: saved }, null, 2));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, requests, errors }, null, 2) + '\n');
  }
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), `${e.stack}\n`); process.exitCode = 1; });
