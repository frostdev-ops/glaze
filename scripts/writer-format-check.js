// Stream F in the real unpacked extension, on the synthetic assignment attempt (as scripts/writer-paper-check.js):
// the paper toolbar's font, size, colour, highlight and more-formatting controls; Word's and Docs' shortcuts (and ⌘⇧H
// for Replace on a Mac, ⌘H left to the system); the Paragraph dialog; the ruler (markers, tab stops, its off switch
// storage.sync writer.ruler); Page setup (A4 landscape, margins, the format's header kept, the margins check quiet, Reset
// to format); header and footer editing with page number and count fields; rich paste from Word's and Docs' clipboard
// shapes with the Keep formatting / Match the paper toast (and its off switch writer.pasteAsk), plain paste; the page's
// context menu; typing time with all of it on. Screenshots of each in FORMAT_SHOTS (default
// ~/Projects/glaze-plans/writer/format/shots). GETs only, synthetic; no account or outside network from the browser.
// NODE_PATH=<playwright> nice -n 10 lockf -k <heavy lock> node scripts/writer-format-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const FX = require('../test/fixtures/writer-paper-fixtures.js');
const site = 'https://bb.school.test';
const PASTE = require('../test/fixtures/writer-paste-html.js');
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-format-check');
const shots = process.env.FORMAT_SHOTS || path.join(os.homedir(), 'Projects/glaze-plans/writer/format/shots');
const checks = [], requests = [], errors = [];
let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

// The page's world: a real Quill on the writable box, Ultra's footer behaviour around it (as scripts/writer-check.js).
const HARNESS = `(() => {
  for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
    const old = c.querySelector('.ql-editor'), html = old.innerHTML, id = old.id;
    c.innerHTML = '';
    const q = new Quill(c, {});
    if (id) q.root.id = id;
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
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-format-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-format-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-format-'));
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
    const rubric = JSON.parse(fixture('ultra-rubric-numeric.json'));
    const column = { ...rubric.column, id: '_810_1', contentId: '_7_1', rubricAssociations: rubric.column.rubricAssociations.map((a) => ({ ...a, entityId: '_810_1' })) };
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      requests.push({ method: req.method(), origin: u.origin, path: u.pathname });
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      if (req.isNavigationRequest() && u.pathname === ATTEMPT) return r.fulfill({ contentType: 'text/html', body: fixture('ultra-writer-attempt.html').replace('<head>', '<head><base href="/ultra/">').replace('</body>', '<script src="/gz-check/quill.js"></script><script src="/gz-check/harness.js"></script></body>') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      let data = { results: [] };
      // /users/me: its id as the repo's fixtures have it; the name fields as Ultra's discussion messages carry them
      // (probe notes), not yet seen on /users/me itself.
      if (u.pathname.endsWith('/users/me')) data = { id: '_900_1', userName: 'synthetic', givenName: 'Alex', familyName: 'Rivera' };
      else if (/\/users\/_900_1\/memberships$/.test(u.pathname)) data = members;
      else if (u.pathname.includes('/gradebook/grades')) data = grades;
      else if (u.pathname.endsWith('/gradebook/columns/_810_1')) data = column;
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
    await worker.evaluate(async ({ settings, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] }); }, { settings, site });
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
    // A fixture in, as the student's paper (one undoable step), and its pages once they settle.
    const load = async (fr, json, formatId) => {
      await fr.evaluate(async ({ json, formatId }) => {
        const api = GZ_WRITER_PAPER.current(), v = api.editor.view;
        const fmt = GZ_WRITER_STYLES.FORMATS[formatId];
        if (api.format().id !== formatId) { document.querySelector('.gp-pill').click(); [...document.querySelectorAll('.gp-menu [role^="menuitem"]')].find((b) => b.textContent.startsWith(fmt.label)).click(); }
        await new Promise((r) => setTimeout(r, 50));
        v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON(json).content));
      }, { json, formatId });
      await settle(fr);
      await until(() => fr.evaluate(() => document.querySelector('.gp-sheet') && !document.querySelector('.gp-flow').style.visibility), 'relaid');
      await settle(fr);
    };
    const shot = async (target, name) => { fs.mkdirSync(shots, { recursive: true }); await pause(250); const f = path.join(shots, name); await target.screenshot({ path: f }); return f; };
    const saved = {};
    const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
    // The text of a word, selected; a node's marks and attributes; the caret in a paragraph.
    const pick = (fr, word) => fr.evaluate((w) => {
      const v = GZ_WRITER_PAPER.current().editor.view; let at = -1;
      v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(w)) at = pos + n.text.indexOf(w); return at < 0; });
      v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at, at + w.length)).scrollIntoView()); v.focus(); return at;
    }, word);
    const marksOf = (fr, word) => fr.evaluate((w) => {
      const v = GZ_WRITER_PAPER.current().editor.view; let hit = null;
      v.state.doc.descendants((n) => { if (!hit && n.isText && n.text.includes(w)) hit = n; return !hit; });
      return hit ? Object.fromEntries(hit.marks.map((m) => [m.type.name, { ...m.attrs }])) : null;
    }, word);
    const blockOf = (fr, word) => fr.evaluate((w) => {
      const v = GZ_WRITER_PAPER.current().editor.view; let hit = null;
      v.state.doc.descendants((n, pos) => { if (!hit && n.isTextblock && n.textContent.includes(w)) hit = { type: n.type.name, attrs: { ...n.attrs }, pos, before: v.state.doc.resolve(pos).nodeBefore?.type.name || null }; return !hit; });
      return hit;
    }, word);
    const menuClick = (fr, label) => fr.evaluate((l) => { const b = [...document.querySelectorAll('.gp-menu [role^=menuitem]')].find((x) => x.textContent.startsWith(l)); if (!b) throw Error(`no menu item ${l}`); b.click(); }, label);
    const docAttrs = (fr) => fr.evaluate(() => JSON.parse(JSON.stringify(GZ_WRITER_PAPER.current().editor.view.state.doc.attrs)));
    const cardRules = (fr) => fr.evaluate(() => [...document.querySelectorAll('.gp-issue[data-rule]')].map((c) => c.dataset.rule));

    let { p, fr } = await openAttempt();
    await load(fr, FX.papers.mla9(), 'mla9');

    // ---- the toolbar
    const tool = await fr.evaluate(() => {
      const t = document.querySelector('.gp-tool');
      return { font: document.querySelector('.gp-font')?.textContent, size: document.querySelector('.gp-size-in')?.value, fits: t.scrollWidth <= t.clientWidth + 1, width: t.clientWidth, scroll: t.scrollWidth,
        labels: ['Font', 'Font size', 'More formatting', 'Text colour', 'Highlight', 'Paragraph…', 'More'].every((l) => document.querySelector(`.gp-tool [aria-label="${l}"]`)),
        tbtn: [...document.querySelectorAll('.gp-tbtn')].map((b) => b.textContent.trim()).filter(Boolean).join('|') };
    });
    check(tool.font === 'Times New Roman' && tool.size === '12' && tool.labels, `toolbar: font "${tool.font}", size ${tool.size}, more formatting, colour, highlight, ¶, ⋯`);
    check(tool.fits, `the toolbar fits its ${tool.width}px without scrolling (${tool.scroll}px of controls)`);
    check(tool.tbtn === 'Cite|Footnote|Page break', 'Cite, Footnote and Page break keep their names');
    saved.toolbarNarrow = await shot(p, 'format-toolbar-narrow.png');
    const folded = await fr.evaluate(() => [...document.querySelectorAll('.gp-tool [hidden]')].length);
    if (folded) {
      await fr.click('.gp-more');
      const items = await fr.evaluate(() => [...document.querySelectorAll('.gp-menu [role^=menuitem]')].map((b) => b.firstChild.textContent));
      check(items.includes('Undo') && items.includes('Page setup…'), `a narrow toolbar folds ${folded} controls into ⋯ (${items.join(', ')})`);
      await fr.click('.gp-more');
    }
    // The rest at a wide window, every control on the toolbar.
    await p.setViewportSize({ width: 1920, height: 1000 });
    await settle(fr);
    check(await fr.evaluate(() => { const t = document.querySelector('.gp-tool'); return !t.querySelector('[hidden]') && t.scrollWidth <= t.clientWidth + 1; }), 'at 1920px every control is on the toolbar');
    saved.toolbar = await shot(p, 'format-toolbar.png');

    // ---- font, size, colour, highlight, more formatting
    await pick(fr, 'consent');
    await fr.click('.gp-font'); await menuClick(fr, 'Arial');
    check((await marksOf(fr, 'consent')).text_style?.font === 'Arial', 'Font → Arial marks the selection');
    await fr.evaluate(() => { const i = document.querySelector('.gp-size-in'); i.focus(); i.value = '14'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    check((await marksOf(fr, 'consent')).text_style?.size === 14, 'typing 14 in the size box sets 14 pt');
    await pick(fr, 'consent');
    await p.keyboard.press(`${MOD}+Shift+Period`);
    check((await marksOf(fr, 'consent')).text_style?.size === 16, `${MOD}+⇧> steps to 16 pt`);
    await fr.click('.gp-tool [aria-label="Text colour"]');
    saved.colour = await shot(p, 'format-colour.png');
    await fr.click('.gp-palette [aria-label="#C00000"]');
    check((await marksOf(fr, 'consent')).color?.color === 'C00000' && await fr.evaluate(() => /192, 0, 0/.test(getComputedStyle(document.querySelector('.gp-flow [data-gz-color="C00000"]')).color)), 'Text colour → dark red, drawn on the page');
    await fr.click('.gp-tool [aria-label="Highlight"]');
    await fr.click('.gp-palette [aria-label="Yellow"]');
    check((await marksOf(fr, 'consent')).highlight?.color === 'yellow', 'Highlight → yellow');
    await fr.click('.gp-tool [aria-label="More formatting"]');
    saved.more = await shot(p, 'format-more.png');
    await menuClick(fr, 'Small caps');
    check(!!(await marksOf(fr, 'consent')).small_caps && await fr.evaluate(() => getComputedStyle(document.querySelector('.gp-flow [data-gz-caps="small"]')).fontVariantCaps === 'small-caps'), 'More formatting → Small caps, drawn as small caps');
    check(await fr.evaluate(() => document.querySelector('.gp-font').textContent === 'Arial' && document.querySelector('.gp-size-in').value === '16'), 'the toolbar shows the selection\'s font and size');
    await pick(fr, 'consent');
    await p.keyboard.press(`${MOD}+Backslash`);
    check(Object.keys(await marksOf(fr, 'consent')).length === 0, `${MOD}+\\ clears font, size, colour, highlight and caps`);

    // ---- Word's and Docs' shortcuts; Find's ⌘⇧H
    const keys = [[`${MOD}+Shift+KeyX`, 'strike'], [`${MOD}+Equal`, 'sub'], [`${MOD}+Shift+Equal`, 'sup']];
    for (const [k, mark] of keys) {
      await pick(fr, 'inherits');
      await p.keyboard.press(k);
      check(!!(await marksOf(fr, 'inherits'))?.[mark], `${k} → ${mark}`);
      await pick(fr, 'inherits'); await p.keyboard.press(k);
    }
    await pick(fr, 'inherits');
    await p.keyboard.press(`${MOD}+Shift+KeyE`);
    check((await blockOf(fr, 'inherits')).attrs.align === 'center', '⌘⇧E centres');
    await p.keyboard.press(`${MOD}+Shift+KeyL`);
    check((await blockOf(fr, 'inherits')).attrs.align === null, '⌘⇧L aligns left');
    await p.keyboard.press(`${MOD}+BracketRight`);
    check((await blockOf(fr, 'inherits')).attrs.indent === 1, '⌘] indents');
    await p.keyboard.press(`${MOD}+BracketLeft`);
    await p.keyboard.press(`${MOD}+Alt+Digit2`);
    check((await blockOf(fr, 'inherits')).type === 'heading' && (await blockOf(fr, 'inherits')).attrs.level === 2, '⌘⌥2 makes a heading 2');
    await p.keyboard.press(`${MOD}+Alt+Digit0`);
    check((await blockOf(fr, 'inherits')).type === 'paragraph', '⌘⌥0 makes it body text again');
    await p.keyboard.press(`${MOD}+Shift+Digit8`);
    check((await blockOf(fr, 'inherits')).type === 'list_item', '⌘⇧8 makes a bulleted list');
    await p.keyboard.press(`${MOD}+Shift+Digit8`);
    const pages0 = await fr.evaluate(() => GZ_WRITER_PAPER.current().pages());
    await p.keyboard.press(`${MOD}+Enter`);
    await until(() => fr.evaluate((n) => GZ_WRITER_PAPER.current().pages() === n + 1, pages0), '⌘Enter page break');
    check(true, '⌘Enter puts in a page break');
    await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.run('undo'));
    await settle(fr);
    if (MOD === 'Meta') {
      await p.keyboard.press('Meta+KeyH');
      check(await fr.evaluate(() => !document.querySelector('.ge-find:not([hidden])')), '⌘H is left to macOS (Hide)');
    }
    await p.keyboard.press(`${MOD}+Shift+KeyH`);
    check(await fr.evaluate(() => !!document.querySelector('.ge-find:not([hidden]) .ge-with:not([hidden])')), '⌘⇧H opens Find with Replace');
    await p.keyboard.press('Escape');

    // ---- the Paragraph dialog
    await pick(fr, 'Critics');
    await fr.click('.gp-tool [aria-label="Paragraph…"]');
    const dlg0 = await fr.evaluate(() => { const d = document.querySelector('.gp-para'); return d && { line: d.querySelector('select[aria-label="Line spacing"]').value, special: d.querySelector('select[aria-label="Special"]').value, by: d.querySelector('input[aria-label="By"]').value, widow: d.querySelectorAll('.gp-checks input')[2].checked }; });
    check(dlg0?.line === '2' && dlg0.special === 'first' && /0[.,]5/.test(dlg0.by) && dlg0.widow, 'the dialog opens on the format\'s values: double, first line 0.5″, widow control');
    await fr.evaluate(() => {
      const d = document.querySelector('.gp-para'), set = (sel, v) => { const x = d.querySelector(sel); x.value = v; x.dispatchEvent(new Event('change', { bubbles: true })); };
      set('select[aria-label="Line spacing"]', 'exact'); set('input[aria-label="At"]', '18 pt'); set('input[aria-label="Before"]', '12'); set('select[aria-label="Special"]', 'hanging');
      d.querySelectorAll('.gp-checks input')[0].checked = true; d.querySelectorAll('.gp-checks input')[3].checked = true;
    });
    saved.paragraph = await shot(p, 'format-paragraph.png');
    await fr.evaluate(() => [...document.querySelectorAll('.gp-para button')].find((b) => b.textContent === 'Apply').click());
    await settle(fr);
    const para = await blockOf(fr, 'Critics');
    check(para.attrs.exact === 18 && para.attrs.before === 12 && para.attrs.first === -0.5 && para.attrs.keepNext === true && para.attrs.line === null && para.attrs.after === null && para.before === 'page_break',
      `Apply stores what differs (exactly 18 pt, 12 pt before, hanging 0.5″, keep with next) and a page break before (${JSON.stringify(para.attrs)})`);
    const lh = await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let dom = null; v.state.doc.descendants((n, pos) => { if (!dom && n.isTextblock && n.textContent.includes('Critics')) dom = v.nodeDOM(pos); return !dom; }); return dom && getComputedStyle(dom).lineHeight; });
    check(lh === '24px', `the exact line height is drawn (18 pt: ${lh})`);
    await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.run('undo'));
    await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.run('undo'));
    await settle(fr);
    check((await blockOf(fr, 'Critics')).attrs.exact === null && (await blockOf(fr, 'Critics')).before !== 'page_break', 'and it undoes');

    // ---- the ruler
    const ruler = await fr.evaluate(() => {
      const r = document.querySelector('.gr-ruler'), s = r?.querySelector('.gr-strip'), sheet = document.querySelector('.gp-sheet').getBoundingClientRect(), api = GZ_WRITER_PAPER.current();
      return r && !r.hidden && { strip: s.getBoundingClientRect().width, sheet: sheet.width, left: s.getBoundingClientRect().left, sheetLeft: sheet.left, numbers: [...r.querySelectorAll('.gr-inch')].map((x) => x.textContent).filter(Boolean).join(','), scale: api.view.scale() };
    });
    check(ruler && Math.abs(ruler.strip - ruler.sheet) < 1.5 && Math.abs(ruler.left - ruler.sheetLeft) < 1.5 && ruler.numbers.startsWith('1,2,3,4,5,6'), `the ruler is the page's width at the zoom, numbered from the margin (${ruler && ruler.numbers})`);
    await pick(fr, 'Critics');
    const markAt = (sel) => fr.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.left + r.width / 2; }, sel);
    const first = await markAt('.gr-first'), margin = await markAt('.gr-edge-l'), inch = 96 * ruler.scale;
    check(Math.abs(first - margin - inch / 2) < 2, 'the first-line marker sits half an inch in');
    const frameBox = await (await p.$('iframe.gz-writer')).boundingBox(), rulerY = await fr.evaluate(() => document.querySelector('.gr-strip').getBoundingClientRect().top);
    await p.mouse.move(frameBox.x + first, frameBox.y + rulerY + 3); await p.mouse.down(); await p.mouse.move(frameBox.x + margin + inch, frameBox.y + rulerY + 3, { steps: 5 }); await p.mouse.up();
    await settle(fr);
    check((await blockOf(fr, 'Critics')).attrs.first === 1, `dragging the first-line marker to 1″ sets it (${(await blockOf(fr, 'Critics')).attrs.first})`);
    await p.mouse.click(frameBox.x + margin + inch * 3, frameBox.y + rulerY + 10);
    await settle(fr);
    check(JSON.stringify((await blockOf(fr, 'Critics')).attrs.tabs) === '[[3,"l"]]', 'a click on the ruler adds a left tab stop at 3″');
    saved.ruler = await shot(p, 'format-ruler.png');
    const tabX = await markAt('.gr-tab');
    await p.mouse.click(frameBox.x + tabX, frameBox.y + rulerY + 11);
    await settle(fr);
    check(JSON.stringify((await blockOf(fr, 'Critics')).attrs.tabs) === '[[3,"c"]]', 'a click on a stop makes it centred');
    await p.mouse.move(frameBox.x + tabX, frameBox.y + rulerY + 11); await p.mouse.down(); await p.mouse.move(frameBox.x + tabX, frameBox.y + rulerY + 70, { steps: 5 }); await p.mouse.up();
    await settle(fr);
    check((await blockOf(fr, 'Critics')).attrs.tabs === null, 'dragging a stop off the ruler removes it');
    await fr.click('.gp-more'); await menuClick(fr, 'Show ruler');
    await settle(fr);
    check(await fr.evaluate(() => document.querySelector('.gr-ruler').hidden) && (await worker.evaluate(async () => (await chrome.storage.sync.get('writer')).writer?.ruler)) === false, '⋯ → Show ruler hides it and remembers writer.ruler false');
    await worker.evaluate(async () => { const w = (await chrome.storage.sync.get('writer')).writer || {}; await chrome.storage.sync.set({ writer: { ...w, ruler: true } }); });
    await until(() => fr.evaluate(() => !document.querySelector('.gr-ruler').hidden), 'the ruler back from storage');
    check(true, 'the ruler follows storage.sync writer.ruler');

    // ---- Page setup
    await fr.click('.gp-more'); await menuClick(fr, 'Page setup…');
    await fr.evaluate(() => {
      const d = document.querySelector('.gp-page'), set = (sel, v) => { const x = d.querySelector(sel); x.value = v; x.dispatchEvent(new Event('change', { bubbles: true })); };
      set('select[aria-label="Paper size"]', 'a4'); [...d.querySelectorAll('.gp-seg button')][1].click(); set('input[aria-label="Left"]', '1.25'); set('input[aria-label="Right"]', '1.25');
    });
    saved.pagesetup = await shot(p, 'format-pagesetup.png');
    await fr.evaluate(() => [...document.querySelectorAll('.gp-page button')].find((b) => b.textContent === 'Apply').click());
    await settle(fr); await pause(400);
    const setup = (await docAttrs(fr)).setup;
    check(setup && JSON.stringify(setup.page) === '[11.69,8.27]' && JSON.stringify(setup.margins) === '[1,1.25,1,1.25]' && setup.own === true, `Page setup → A4 landscape, 1.25″ sides, the student's own setup (${JSON.stringify(setup && [setup.page, setup.margins])})`);
    check(await fr.evaluate(() => Math.abs(document.querySelector('.gp-sheet').getBoundingClientRect().width / GZ_WRITER_PAPER.current().view.scale() - 11.69 * 96) < 1 && document.querySelector('.gp-sheet .gp-hdr').textContent === 'Rivera 1'), 'the pages are A4 landscape and keep the format\'s header "Rivera 1"');
    check(!(await cardRules(fr)).includes('margins'), 'the margins check stays quiet for the student\'s own setup');
    // ---- header and footer
    const sheet2 = await fr.evaluate(() => { const s = document.querySelectorAll('.gp-sheet')[1].getBoundingClientRect(), sc = GZ_WRITER_PAPER.current().view.scale(); return { x: s.left + s.width / 2, y: s.top + 0.6 * 96 * sc, yf: s.bottom - 0.4 * 96 * sc }; });
    await fr.evaluate(({ x, y }) => { const c = document.querySelector('.gp-canvas'); c.scrollTop += y - 200; }, sheet2);
    await settle(fr);
    const s2 = await fr.evaluate(() => { const s = document.querySelectorAll('.gp-sheet')[1].getBoundingClientRect(), sc = GZ_WRITER_PAPER.current().view.scale(); return { x: s.left + s.width / 2, y: s.top + 0.62 * 96 * sc, yf: s.bottom - 0.45 * 96 * sc }; });
    await p.mouse.dblclick(frameBox.x + s2.x, frameBox.y + s2.y);
    await until(() => fr.evaluate(() => document.querySelector('.gp-hf-header')?.textContent === 'Rivera 2'), 'header editing on page 2');
    check(true, 'a double-click in page 2\'s top margin edits its header ("Rivera 2")');
    await p.keyboard.type(' of ');
    await fr.click('.gp-hfbar button:has-text("Page count")');
    saved.header = await shot(p, 'format-header.png');
    await fr.click('.gp-hfbar button:has-text("Done")');
    await settle(fr);
    const hdr = (await docAttrs(fr)).setup.headers.default;
    check(JSON.stringify(hdr?.[0]?.runs) === JSON.stringify([{ text: 'Rivera ' }, { field: 'PAGE' }, { text: ' of ' }, { field: 'NUMPAGES' }]), `Done stores the header's text and fields (${JSON.stringify(hdr?.[0]?.runs)})`);
    const pages = await fr.evaluate(() => GZ_WRITER_PAPER.current().pages());
    check(await fr.evaluate((n) => document.querySelectorAll('.gp-sheet')[2].querySelector('.gp-hdr').textContent === `Rivera 3 of ${n}`, pages), `page 3's header reads "Rivera 3 of ${pages}"`);
    await p.mouse.dblclick(frameBox.x + s2.x, frameBox.y + s2.yf);
    await until(() => fr.evaluate(() => !!document.querySelector('.gp-hf-footer')), 'footer editing');
    await p.keyboard.type('Draft');
    await p.keyboard.press(`${MOD}+Enter`);
    await settle(fr);
    check(await fr.evaluate(() => [...document.querySelectorAll('.gp-sheet .gp-ftr')].every((f) => f.textContent === 'Draft')), 'the footer reads "Draft" on every page');
    const xml = await fr.evaluate(async () => { const o = await GZ_WRITER_PAPER.current().docx(); return Object.entries(o.parts).filter(([k]) => /word\/(header|footer)\d\.xml|document\.xml/.test(k)).map(([k, v]) => `${k}:${v}`).join('\n'); });
    check(/header\d\.xml:[^\n]*\n?[^\n]*Rivera [\s\S]*?NUMPAGES/.test(xml) && /footer\d\.xml:[\s\S]*?Draft/.test(xml) && /<w:pgSz w:w="16834" w:h="11909"/.test(xml), 'the .docx carries the page, the header\'s fields and the footer');
    await fr.click('.gp-more'); await menuClick(fr, 'Page setup…');
    await fr.evaluate(() => [...document.querySelectorAll('.gp-page button')].find((b) => b.textContent === 'Reset to format').click());
    await settle(fr);
    check((await docAttrs(fr)).setup === null && await fr.evaluate(() => document.querySelectorAll('.gp-sheet')[1].querySelector('.gp-hdr').textContent === 'Rivera 2'), 'Reset to format takes the setup away: Letter, "Rivera 2"');

    // ---- rich paste
    const paste = (html, shift = false) => fr.evaluate(({ html, shift }) => {
      // Into a new empty paragraph at the end, so the paste's first block keeps its kind.
      const v = GZ_WRITER_PAPER.current().editor.view;
      v.dispatch(v.state.tr.insert(v.state.doc.content.size, v.state.schema.nodes.paragraph.create()));
      const d = v.state.doc;
      v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(d, d.content.size - 1))); v.focus();
      if (shift) v.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }));
      const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', html.replace(/<[^>]*>/g, ''));
      v.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      if (shift) v.dom.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    }, { html, shift });
    await paste(PASTE.word.html);
    await until(() => fr.evaluate(() => !!document.querySelector('.gp-toast .gp-toast-choice')), 'the paste toast');
    const toast = await fr.evaluate(() => [...document.querySelectorAll('.gp-toast span, .gp-toast-choice')].map((x) => x.textContent).join('|'));
    check(toast === 'Pasted with its formatting|Keep formatting|Match the paper', `after a rich paste the toast asks once (${toast})`);
    check((await marksOf(fr, 'red words'))?.color?.color === 'C00000' && (await marksOf(fr, 'highlighted words'))?.highlight?.color === 'yellow' && (await blockOf(fr, 'A Heading From Word'))?.type === 'heading' && await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('nested bullet')), 'Word\'s paste keeps its colour, highlight, heading and lists');
    saved.paste = await shot(p, 'format-paste.png');
    await fr.click('.gp-toast-choice:has-text("Match the paper")');
    await settle(fr);
    check(!(await marksOf(fr, 'red words')).color && !(await marksOf(fr, 'highlighted words')).highlight && (await docAttrs(fr)).paste === 'match', 'Match the paper takes the formatting away and is remembered on the paper');
    await paste(PASTE.docs.html);
    await settle(fr); await pause(300);
    check(!(await fr.evaluate(() => !!document.querySelector('.gp-toast .gp-toast-choice'))) && !(await marksOf(fr, 'red highlighted words')).color, 'the next paste matches the paper without asking');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.setDocAttribute('paste', null)); });
    await worker.evaluate(async () => { const w = (await chrome.storage.sync.get('writer')).writer || {}; await chrome.storage.sync.set({ writer: { ...w, pasteAsk: false } }); });
    await pause(200);
    await paste(PASTE.docs.html.replace('A Heading From Docs', 'Second Docs Heading'));
    await settle(fr); await pause(300);
    check(!(await fr.evaluate(() => !!document.querySelector('.gp-toast .gp-toast-choice'))) && (await marksOf(fr, 'Second Docs Heading'))?.text_style?.font === 'Arial', 'writer.pasteAsk false: formatting kept, no toast');
    await paste('<p><b>plain please</b> <span style="color:#ff0000">red</span></p>', true);
    await settle(fr);
    check(await marksOf(fr, 'plain please') && Object.keys(await marksOf(fr, 'plain please')).length === 0, '⇧ paste (⌘⇧V) pastes plain text');

    // ---- the context menu
    await pick(fr, 'Critics');
    await settle(fr);
    const crit = await fr.evaluate(() => { const r = [...document.querySelectorAll('.gp-flow p')].find((x) => x.textContent.includes('Critics')).getBoundingClientRect(); return { x: r.left + 40, y: r.top + 8 }; });
    await p.mouse.click(frameBox.x + crit.x, frameBox.y + crit.y, { button: 'right' });
    const ctxItems = await fr.evaluate(() => [...document.querySelectorAll('.gp-menu [role^=menuitem]')].map((b) => b.firstChild.textContent).join('|'));
    check(ctxItems === 'Paste|Paste without formatting|Paragraph…|Clear formatting' || ctxItems === 'Cut|Copy|Paste|Paste without formatting|Paragraph…|Clear formatting', `the page's context menu (${ctxItems})`);
    await menuClick(fr, 'Paragraph…');
    check(await fr.evaluate(() => !!document.querySelector('.gp-para')), 'its Paragraph… opens the dialog');
    await p.keyboard.press('Escape');

    // ---- typing with all of it on: the 6-page MLA paper, as writer-paper-check measures it
    await load(fr, FX.papers.mla9(), 'mla9');
    const cost = await fr.evaluate(async () => {
      const v = GZ_WRITER_PAPER.current().editor.view, d = v.state.doc;
      let at = 0; d.forEach((n, off, i) => { if (i === 8) at = off + 5; });
      const times = [];
      for (let i = 0; i < 20; i++) { const t = performance.now(); v.dispatch(v.state.tr.insertText('x', at + i)); await new Promise((r) => queueMicrotask(r)); await new Promise((r) => setTimeout(r, 0)); times.push(performance.now() - t); }
      times.sort((a, b) => a - b);
      return times[10];
    });
    console.log(`20 keystrokes with the ruler on: median ${cost.toFixed(1)} ms each`);

    check(errors.length === 0, `no page or frame errors (${errors.join('; ')})`);
    check(requests.every((r) => r.method === 'GET' && r.origin === site), 'every LMS request is a synthetic GET');
    passed = true;
    console.log(JSON.stringify({ checks: checks.length, shots: saved, typing: cost }, null, 2));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, requests, errors }, null, 2) + '\n');
  }
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), `${e.stack}\n`); process.exitCode = 1; });
