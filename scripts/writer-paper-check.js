// Glaze Writer's paper mode in the real unpacked extension, on the synthetic assignment attempt (test/fixtures/
// ultra-writer-attempt.html) running the real Quill 1.3.7: the paper chrome, pagination over the 6-page fixtures
// (test/fixtures/writer-paper-fixtures.js), running headers, presets, format checks, storage across a reload and in
// papers.html, Focus, and screenshots at 1440px beside the mockup. It also writes what scripts/writer-word-fidelity.js
// compares with Word: each fixture's .docx and the editor's pages (count and each page's first line).
// GETs only, synthetic; no account or outside network from the browser.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-paper-check.js [evidence directory]
// PAPER_SHOTS: where the screenshots go (default: shots/ under the check's temporary output).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const FX = require('../test/fixtures/writer-paper-fixtures.js');
const site = 'https://bb.school.test';
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-paper-check');
const shots = process.env.PAPER_SHOTS || path.join(out, 'shots');
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
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-paper-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-paper-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-paper-'));
    fs.mkdirSync(out, { recursive: true });
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    if (crypto.createHash('sha256').update(quill).digest('hex') !== QUILL.sha256) throw Error('Quill 1.3.7 hash mismatch');

    ext = require('./check-env.js').staged(root, [`${site}/*`]);
    for (const [name, source] of [['writer-paper.js', process.env.WRITER_PAPER_SOURCE], ['writer-cite.js', process.env.WRITER_CITE_SOURCE]]) if (source) {
      const file = path.join(ext, name);
      fs.rmSync(file); fs.writeFileSync(file, fs.readFileSync(source));
    }
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: process.env.PAPER_DEBUG ? 2600 : 900 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
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
    const settings = G.GZ_SANITIZE({ writer: { full: true }, navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
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
    // The editor's pages: count, header texts, and each page's first line (as laid out).
    const pagesOf = (fr) => fr.evaluate(() => {
      const api = GZ_WRITER_PAPER.current(), v = api.editor.view, f = api.format(), geo = GZ_WRITER_STYLES.geometry(f);
      const dom = v.dom.getBoundingClientRect(), scale = dom.height / v.dom.offsetHeight, stride = geo.height + 26.4;
      const sheets = [...document.querySelectorAll('.gp-sheet')];
      const firsts = sheets.map((_, i) => {
        const top = dom.top + i * stride * scale + 2, bottom = dom.top + (i * stride + geo.body) * scale;
        // The first text line at or below this page's text top: walk the doc's textblocks by their caret tops.
        let best = null;
        v.state.doc.descendants((n, pos) => {
          if (best || !n.isTextblock || !n.textContent.trim()) return !best;
          for (let q = pos + 1; q < pos + n.nodeSize - 1; q++) {
            const c = v.coordsAtPos(q, 1);
            if (c.top >= top && c.top < bottom) { best = { pos: q, top: c.top, block: pos, node: n }; return false; }
            if (c.top >= bottom) return false;
          }
          return false;
        });
        if (!best) return '';
        let end = best.pos;
        const last = best.block + best.node.nodeSize - 1;
        while (end < last && Math.abs(v.coordsAtPos(end + 1, -1).top - best.top) < 3) end++;
        return v.state.doc.textBetween(best.pos, end, ' ').trim();
      });
      // Every line, by page: positions grouped by their caret's top.
      const lines = sheets.map(() => []);
      v.state.doc.descendants((n, pos) => {
        if (!n.isTextblock) return true;
        let cur = null;
        for (let q = pos + 1; q < pos + n.nodeSize - 1; q++) {
          const top = Math.round(v.coordsAtPos(q, 1).top);
          if (!cur || Math.abs(top - cur.top) > 3) { cur = { top, from: q, to: q + 1 }; const k = Math.floor((top - dom.top) / (stride * scale)); (lines[k] || lines.at(-1)).push(cur); } else cur.to = q + 1;
        }
        return false;
      });
      return { count: sheets.length, headers: sheets.map((s) => s.querySelector('.gp-hdr').textContent), firsts, notes: sheets.map((s) => s.querySelectorAll('.gp-notes p').length),
        // Note marks as their numbers, as Word's PDF shows them.
        lines: lines.map((ls) => ls.map((l) => { let k = 0; v.state.doc.nodesBetween(0, l.from, (n) => { if (n.type.name === 'footnote_ref') k++; }); return v.state.doc.textBetween(l.from, l.to, ' ', (n) => (n.type.name === 'footnote_ref' ? String(++k) : '')).trim(); }).filter(Boolean)) };
    });
    const shot = async (target, name, dir = shots) => { fs.mkdirSync(dir, { recursive: true }); await pause(250); const f = path.join(dir, name); await target.screenshot({ path: f }); return f; };
    const saved = {};

    // ---- a new paper on the attempt
    let { p, el, fr } = await openAttempt();
    if (process.argv.includes('--adversarial')) {
      await require('./writer-adversarial-check.js')({ p, el, fr, openAttempt, context, worker, id, check, until, settle, out, tmp, errors });
      check(errors.length === 0, `no unexpected browser errors (${errors.join('; ')})`);
      check(requests.every((r) => r.method === 'GET' && r.origin === site), 'every LMS request is a synthetic GET');
      passed = true;
      console.log(JSON.stringify({ checks: checks.length }));
      return;
    }
    check(await fr.evaluate(() => document.documentElement.dataset.mode === 'paper' && document.documentElement.dataset.kind === 'assignment'), 'the assignment attempt mounts in paper mode');
    check(await fr.evaluate(() => ['.gp-top h1', '.gp-pill', '.gp-box', '[data-run="bold"]', '[data-run="italic"]', '[data-run="underline"]', '[data-run="bulletList"]', '[data-run="orderedList"]', '.gp-submit', '.gp-tabs', '.gp-status'].every((s) => document.querySelector(s))
      && [...document.querySelectorAll('.gp-tbtn')].map((b) => b.textContent.trim()).filter(Boolean).join('|') === 'Cite|Footnote|Page break'
      && [...document.querySelectorAll('.gp-tab')].map((b) => b.firstChild.textContent).join('|') === 'Checks|Sources|Feedback|Outline'), 'paper chrome: toolbar, tabs, status bar');
    check(await fr.evaluate(() => !document.querySelector('.gp-submit').disabled), 'Submit… opens the assignment submit sheet');
    check(await fr.evaluate(() => document.querySelector('.gp-top h1').textContent === 'Essay 2: Memory in Beloved' && /^Due /.test(document.querySelector('.gp-due').textContent)), 'title bar: assignment title and due date from the gradebook column');
    const opening = await fr.evaluate(() => { const d = GZ_WRITER_PAPER.current().editor.view.state.doc; return [0, 1, 2, 3, 4, 5].map((i) => d.child(i).textContent); });
    const today = await fr.evaluate(() => GZ_WRITER_STYLES.dateText(GZ_WRITER_STYLES.FORMATS.mla9));
    check(opening[0] === 'Alex Rivera' && opening[1] === '' && opening[2] === FX.context.course && opening[3] === today && opening[4] === 'Essay 2: Memory in Beloved', `MLA heading filled from Ultra: name, (instructor left to type), course, ${today}, title`);
    check(opening[5] === "Toni Morrison's Beloved treats memory less as a record than as a debt.", 'the text already in Ultra\'s box becomes the body');
    check(await fr.evaluate(() => document.querySelector('.gp-sheet .gp-hdr').textContent === 'Rivera 1'), 'running header "Rivera 1"');
    check(await p.evaluate(() => __native().includes('treats memory less as a record than as a debt') && !__native().includes('Alex Rivera')), 'paper mode never writes into Ultra\'s editor');
    const ctx = await fr.evaluate(() => GZ_WRITER_PAPER.current().context());
    check(ctx.assignment?.rubric?.criteria?.length > 0 && /Write 1,200 words/.test(ctx.assignment.instructions), 'context carries instructions and the rubric (lib/rubric.js) for the AI');

    // ---- the 6-page fixtures
    const pages = {};
    for (const fid of ['mla9', 'apa7', 'chicago17']) {
      await load(fr, FX.papers[fid](), fid);
      pages[fid] = await pagesOf(fr);
      const api = await fr.evaluate(async () => { const o = await GZ_WRITER_PAPER.current().docx(); return Array.from(o.bytes); });
      fs.writeFileSync(path.join(out, `paper-${fid}.docx`), Buffer.from(api));
      if (process.env.PAPER_PROBE && fid === 'apa7') console.log('PROBE', JSON.stringify(await fr.evaluate(() => {
        const v = GZ_WRITER_PAPER.current().editor.view; let at = null;
        v.state.doc.descendants((n, pos) => { if (!at && n.isText && n.text.includes('its furniture')) at = pos + n.text.indexOf('its furniture'); });
        const end = at + 'its furniture whenever someone tries to close the books too early. Toni Morrison\'s Beloved treats'.length;
        const a = v.domAtPos(at), b = v.domAtPos(end), r = document.createRange(); r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset);
        const blk = a.node.parentElement.closest('p');
        return { rects: [...r.getClientRects()].map((x) => [x.left, x.top, x.width]), dom: v.dom.getBoundingClientRect().width, scale: v.dom.getBoundingClientRect().width / v.dom.offsetWidth, p: blk.offsetWidth, cls: blk.className, style: blk.getAttribute('style'), text: JSON.stringify(blk.textContent.slice(0, 400)), fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + f.weight + f.style).join(',') };
      })));
      if (process.env.PAPER_DEBUG) {
        await fr.evaluate(() => { GZ_WRITER_PAPER.current().zoom(0.32); document.querySelector('.gp-canvas').scrollTop = 0; });
        await settle(fr);
        await p.screenshot({ path: path.join(out, `pages-${fid}.png`) });
        await fr.evaluate(() => GZ_WRITER_PAPER.current().zoom('fit'));
      }
      console.log(fid, JSON.stringify(pages[fid]));
    }
    fs.writeFileSync(path.join(out, 'editor-pages.json'), JSON.stringify(pages, null, 2) + '\n');
    check(pages.mla9.count === 6, `MLA fixture paginates across 6 pages (${pages.mla9.count})`);
    check(pages.mla9.headers.join('|') === 'Rivera 1|Rivera 2|Rivera 3|Rivera 4|Rivera 5|Rivera 6', 'MLA running headers Rivera 1–6');
    check(pages.mla9.firsts[5] === 'Works Cited', 'Works Cited starts page 6 (its own page)');
    check(pages.apa7.count === 6 && pages.apa7.headers.join('|') === '1|2|3|4|5|6' && pages.apa7.firsts[1].startsWith('What the River Keeps'), 'APA: title page, page numbers 1–6, title over page 2');
    check(pages.chicago17.count === 6 && pages.chicago17.headers[0] === '' && pages.chicago17.headers[1] === '2', 'Chicago: no number on the title page, then 2…');
    check(pages.chicago17.notes.reduce((a, b) => a + b, 0) === 5 && pages.chicago17.notes[0] === 0, 'Chicago: five footnotes at the foot of their pages');

    // ---- incremental: a keystroke measures the block it's in, not the paper
    await load(fr, FX.papers.mla9(), 'mla9');
    const cost = await fr.evaluate(async () => {
      const v = GZ_WRITER_PAPER.current().editor.view, d = v.state.doc;
      let at = 0; d.forEach((n, off, i) => { if (i === 8) at = off + 5; });
      const before = v.dom.gzMeasured, times = [];
      for (let i = 0; i < 20; i++) { const t = performance.now(); v.dispatch(v.state.tr.insertText('x', at + i)); await new Promise((r) => queueMicrotask(r)); await new Promise((r) => setTimeout(r, 0)); times.push(performance.now() - t); }
      times.sort((a, b) => a - b);
      return { measured: v.dom.gzMeasured - before, median: times[10] };
    });
    console.log(`20 keystrokes: ${cost.measured} block measurements, median ${cost.median.toFixed(1)} ms each`);
    check(cost.measured <= 20, `typing re-measures only the edited block (${cost.measured} measurements for 20 keystrokes)`);

    // ---- format checks on the page
    await load(fr, FX.seeded.mla9().find(([r]) => r === 'heading-order')[1], 'mla9');
    await pause(400);
    check(await fr.evaluate(() => !!document.querySelector('.gp-issue[data-rule="heading-order"] .gp-sbtn')), 'a heading-order issue spanning paragraphs keeps its Checks card and Fix');
    await fr.click('.gp-issue[data-rule="heading-order"] .gp-sbtn');
    await until(() => fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.child(0).textContent === 'Alex Rivera'), 'heading order fixed');
    check(true, 'Fix restores heading order through the shared issues integration');
    for (const fid of ['mla9', 'apa7', 'chicago17']) {
      await load(fr, FX.papers[fid](), fid);
      check(await fr.evaluate(() => GZ_WRITER_CITE.style() === ({ mla: 'mla9', apa: 'apa7', chicago: 'chicago17' })[GZ_WRITER_PAPER.current().format().cite]), `${fid}: citations follow the paper's format`);
      await pause(400);
      const issues = await fr.evaluate(() => GZ_WRITER_ISSUES.list().map(({ source, message, rule }) => ({ source, message, rule })));
      const clean = await fr.evaluate(() => document.querySelectorAll('.gp-issue[data-rule]').length);
      check(clean === 0 && !issues.some((i) => ['format', 'cite'].includes(i.source)), `${fid}: a clean paper has no format or citation issues in Checks (${clean} cards; ${JSON.stringify(issues)})`);
      for (const [rule, json] of FX.seeded[fid]()) {
        await load(fr, json, fid);
        const found = await until(() => fr.evaluate((r) => document.querySelectorAll(`.gp-issue[data-rule="${r}"]`).length, rule), `${fid} ${rule} card`, 4000).catch(() => 0);
        check(found > 0, `${fid}: seeded ${rule} shows in Checks`);
      }
    }

    await load(fr, FX.seeded.mla9().find(([r]) => r === 'title-bold')[1], 'mla9');
    await until(() => fr.evaluate(() => GZ_WRITER_ISSUES.list().some((i) => i.source === 'format' && i.rule === 'title-bold')), 'title format underline');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view, i = GZ_WRITER_ISSUES.list().find((i) => i.rule === 'title-bold'); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, i.from))); v.focus(); });
    await p.keyboard.press('Alt+Enter');
    await fr.click('.gp-card button:has-text("Ignore")');
    check(await fr.evaluate(() => !document.querySelector('.gp-issue[data-rule="title-bold"]')), 'ignoring a format underline also removes its paper card');

    // ---- presets and the mockup state
    await load(fr, FX.papers.mla9(), 'mla9');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = 0; v.state.doc.descendants((n, pos) => { if (!at && n.isText && n.text.includes('(Morrison 35)')) at = pos + n.text.indexOf('(Morrison 35)'); }); v.dispatch(v.state.tr.insertText('(Morrison, 42)', at, at + '(Morrison 35)'.length)); });
    await until(() => fr.evaluate(() => [...document.querySelectorAll('.gp-issue')].some((c) => c.textContent.includes('(Morrison 42)'))), 'citation card');
    check(true, 'MLA citation "(Morrison, 42)" gets a card with the fix "(Morrison 42)"');
    await pause(700);
    const duplicates = await fr.evaluate(() => [...document.querySelectorAll('.gp-issue')].filter((c) => c.textContent.includes('(Morrison 42)')).length);
    check(duplicates === 1, `paper format and cite checks share one MLA citation card (${duplicates})`);
    // In the attempt panel, then in Focus (the frame fills the window): the mockup's 1440px view.
    saved.panel = await shot(p, 'paper-panel.png');
    // A loaded runner has swallowed this click (the frame still laying out); once more if Focus didn't take.
    const filled = () => el.evaluate((f) => getComputedStyle(f).position === 'fixed' && Math.round(f.getBoundingClientRect().width) === innerWidth);
    await fr.click('.gp-tbtn[aria-label="Focus"]');
    try { await until(filled, 'focus fills the window', 5000); } catch {
      if (await fr.evaluate(() => document.querySelector('.gp-tbtn[aria-label="Focus"]')?.getAttribute('aria-pressed')) !== 'true') await fr.click('.gp-tbtn[aria-label="Focus"]');
      await until(filled, 'focus fills the window');
    }
    check(true, 'Focus asks the page to fill the window with the paper (focus-mode message)');
    await settle(fr);
    await fr.click('.gp-issue[data-rule="cite-shape"]');
    await settle(fr);
    saved.paper = await shot(p, 'paper.png');
    for (const width of [390, 768]) {
      await p.setViewportSize({ width, height: 844 });
      await settle(fr);
      const narrow = await fr.evaluate(() => {
        const col = document.querySelector('.gp-col').getBoundingClientRect(), side = document.querySelector('.gp-side').getBoundingClientRect();
        const status = document.querySelector('.gp-status').getBoundingClientRect();
        return { width: innerWidth, paper: col.width, bottom: col.bottom, side: side.top, sideHeight: side.height, status: status.right };
      });
      check(narrow.paper >= narrow.width - 2 && narrow.side >= narrow.bottom - 1 && narrow.sideHeight >= 140, `${width}px: paper keeps its full width with scrollable checks below it (${JSON.stringify(narrow)})`);
      check(narrow.status <= narrow.width + 1, `${width}px: paper status stays inside the viewport`);
      saved[`narrow${width}`] = await shot(p, `paper-${width}.png`);
    }
    await p.setViewportSize({ width: 1440, height: 900 });
    await settle(fr);
    await fr.focus('.gp-flow .ProseMirror');
    await p.keyboard.press('Escape');
    if (process.env.PAPER_PROBE) console.log('PROBE esc', await fr.evaluate(() => [document.activeElement?.className, document.hasFocus(), document.querySelector('.gp-tbtn[aria-label="Focus"]').getAttribute('aria-pressed'), !!document.querySelector('.gp-menu')]));
    await until(() => el.evaluate((f) => getComputedStyle(f).position !== 'fixed'), 'focus off');
    check(true, 'Escape leaves Focus');
    // Fix, Footnote, Page break, import
    await fr.click('.gp-issue[data-rule="cite-shape"] .gp-sbtn');
    await until(() => fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('(Morrison 42)')), 'fixed');
    check(true, 'Fix applies the citation fix');
    const before = await fr.evaluate(() => document.querySelectorAll('.gp-sheet').length);
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = 0; v.state.doc.descendants((n, pos) => { if (!at && n.isText && n.text.includes('(Morrison 42)')) at = pos + n.text.indexOf('(Morrison 42)') + '(Morrison 42).'.length; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at))); v.focus(); });
    await fr.click('.gp-tbtn:has-text("Footnote")');
    await until(() => fr.evaluate(() => !!document.querySelector('.gp-note textarea')), 'note editor');
    await p.keyboard.type('See Morrison, Beloved, 42.', { delay: 2 });
    await p.keyboard.press('Enter');
    await settle(fr);
    await until(() => fr.evaluate(() => [...document.querySelectorAll('.gp-notes p')].some((x) => x.textContent === '1 See Morrison, Beloved, 42.')), 'note at the foot of its page');
    check(true, 'Footnote: the note\'s text sits at the foot of its page, numbered');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, v.state.doc.child(0).nodeSize + v.state.doc.child(1).nodeSize + v.state.doc.child(2).nodeSize + v.state.doc.child(3).nodeSize + v.state.doc.child(4).nodeSize + 3))); v.focus(); });
    await fr.click('.gp-tbtn:has-text("Page break")');
    await settle(fr);
    await until(() => fr.evaluate((n) => document.querySelectorAll('.gp-sheet').length === n + 1, before), 'a page more');
    check(true, 'Page break starts a new page');
    await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.run('undo'));
    await settle(fr);
    const input = await fr.$('input[type="file"]');
    await input.setInputFiles(path.join(out, 'paper-apa7.docx'));
    await until(() => fr.evaluate(() => !!document.querySelector('.gi-layer[data-open] .gi-default')), 'the import card');
    await fr.click('.gi-default');
    await until(() => fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('The Clearing as Ledger')), 'imported');
    const reasons = await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); const k = Object.keys(all).find((x) => x.startsWith('writerVersions:')); return all[k].map((v) => v.reason); });
    check(reasons[0] === 'import', `importing a .docx keeps the paper before it as a version (${reasons.join(', ')})`);
    await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.run('undo'));
    await settle(fr);
    check(await fr.evaluate(() => !GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('The Clearing as Ledger')), 'and the import undoes in one step');
    await fr.evaluate(() => { document.querySelector('.gp-pill').click(); });
    check(await fr.evaluate(() => [...document.querySelectorAll('.gp-menu [role^="menuitem"]')].map((b) => b.textContent).join('|').startsWith('MLA 9|APA 7|Chicago 17|Blank|New preset')), 'format pill offers MLA 9, APA 7, Chicago 17, Blank and a new preset');
    await p.keyboard.press('ArrowDown');
    check(await fr.evaluate(() => document.activeElement?.textContent === 'APA 7'), 'one Down Arrow moves from MLA to the next format');
    await p.keyboard.press('ArrowUp');
    check(await fr.evaluate(() => document.activeElement?.textContent === 'MLA 9'), 'one Up Arrow returns to the previous format');
    await p.keyboard.press('End');
    check(await fr.evaluate(() => document.activeElement?.textContent.startsWith('New preset')), 'End reaches the last format action');
    await p.keyboard.press('Home');
    check(await fr.evaluate(() => document.activeElement?.textContent === 'MLA 9'), 'Home reaches the first format');
    await p.keyboard.press('Escape');
    check(await fr.evaluate(() => document.activeElement?.matches('.gp-pill') && !document.querySelector('.gp-menu')), 'format Escape restores its opener');
    await fr.evaluate(() => document.querySelector('.gp-status button:last-child').click());
    await until(() => fr.evaluate(() => [...document.querySelectorAll('.gp-versions [role="menuitem"]')].some((b) => b.textContent === 'Documents')), 'versions menu with Documents');
    check(true, 'the status bar menu opens Documents');
    await p.keyboard.press('Escape');
    await fr.evaluate(() => document.querySelector('.gp-pill').click());
    saved.menu = await shot(p, 'paper-format-menu.png');
    await fr.evaluate(() => [...document.querySelectorAll('.gp-menu [role^="menuitem"]')].find((b) => b.textContent.startsWith('New preset')).click());
    await fr.evaluate(() => { const f = document.querySelector('.gp-form'); f.querySelector('input').value = 'Arial 11'; const s = f.querySelectorAll('select'); s[1].value = 'Arial'; s[2].value = '11'; [...f.querySelectorAll('button')].find((b) => b.textContent === 'Save').click(); });
    await settle(fr);
    check(await fr.evaluate(() => GZ_WRITER_PAPER.current().format().font === 'Arial' && GZ_WRITER_PAPER.current().format().label === 'Arial 11' && /Arial 11/.test(document.querySelector('.gp-status').textContent)), 'a custom preset (Arial 11) applies and shows in the status bar');
    check(await worker.evaluate(async () => (await chrome.storage.local.get('writerPresets:bb.school.test|_900_1'))['writerPresets:bb.school.test|_900_1']?.[0]?.label === 'Arial 11'), 'the preset is saved for this student');
    await fr.evaluate(() => { document.querySelector('.gp-pill').click(); [...document.querySelectorAll('.gp-menu [role^="menuitem"]')].find((b) => b.textContent.startsWith('MLA 9')).click(); });
    await settle(fr);

    // ---- storage: autosave, reload, papers.html sees the same paper
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view, d = v.state.doc; let end = 0; d.forEach((n, off, i) => { if (i === 6) end = off + n.nodeSize - 1; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(d, end))); v.focus(); });
    await p.keyboard.type(' A sentence typed before the reload.', { delay: 2 });
    await until(() => fr.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved'), 'autosaved');
    const key = await fr.evaluate(() => GZ_WRITER_PAPER.current().key());
    check(key === 'bb.school.test|_900_1|_101_1|_7_1', 'paper keyed by school, student, course and assignment');
    // IndexedDB written in the frame, read from papers.html below: is it one store across the two?
    await fr.evaluate(() => new Promise((ok) => { const r = indexedDB.open('gz-paper-probe', 1); r.onupgradeneeded = () => r.result.createObjectStore('p'); r.onsuccess = () => { const tx = r.result.transaction('p', 'readwrite'); tx.objectStore('p').put('frame', 'k'); tx.oncomplete = () => { r.result.close(); ok(); }; }; }));
    const trashedBeforeOpen = await fr.evaluate(async () => { const P = GZ_WRITER_PAPERS.open(), k = GZ_WRITER_PAPER.current().key(); await P.trash(k); return P.get(k); });
    await p.reload();
    ({ el, fr } = await (async () => {
      const x = await until(async () => { const y = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return y && await y.evaluate((f) => !f.style.opacity && f.offsetHeight > 500) && y; }, 'paper frame after reload');
      const d = await until(() => x.contentFrame(), 'frame after reload');
      await until(() => d.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key() && document.querySelector('.gp-state').textContent === 'Saved'), 'paper back after reload');
      return { el: x, fr: d };
    })());
    check(await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('A sentence typed before the reload.')), 'the paper survives a reload');
    const restoredOnOpen = await fr.evaluate(async () => { const P = GZ_WRITER_PAPERS.open(), k = GZ_WRITER_PAPER.current().key(); return { paper: await P.get(k), versions: await P.versions(k) }; });
    check(!('trashed' in restoredOnOpen.paper) && restoredOnOpen.paper.updated === trashedBeforeOpen.updated && restoredOnOpen.paper.revision === trashedBeforeOpen.revision,
      "Ultra restores a trashed assignment on open without changing Last edited or revision");
    check(restoredOnOpen.versions[0]?.reason === 'restore', 'opening a trashed assignment keeps a checkpoint version');
    const papers = await context.newPage();
    watch(papers, 'papers');
    await papers.goto(`chrome-extension://${id}/papers.html`);
    await until(() => papers.evaluate(() => document.querySelectorAll('.gd-card').length === 1), 'papers list');
    check(await papers.evaluate(() => document.querySelector('.gd-card .gd-title').textContent === 'Essay 2: Memory in Beloved' && /ENGL 2110/.test(document.querySelector('.gd-card .gd-meta').textContent)), 'papers.html lists the paper (same chrome.storage.local as the frame)');
    const idb = await papers.evaluate(() => new Promise((ok) => { const r = indexedDB.open('gz-paper-probe', 1); r.onupgradeneeded = () => r.result.createObjectStore('p'); r.onsuccess = () => { const q = r.result.transaction('p').objectStore('p').get('k'); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }; r.onerror = () => ok(null); }));
    console.log(`IndexedDB from the frame seen in papers.html: ${idb === 'frame' ? 'shared' : 'partitioned'}`);
    saved.papers = await shot(papers, 'papers.png');
    await papers.click('.gd-card .gd-title');
    await until(() => papers.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key() && document.querySelectorAll('.gp-sheet').length > 0), 'paper opened in papers.html');
    check(await papers.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('A sentence typed before the reload.') && !document.querySelector('.gp-submit')), 'papers.html opens the paper in the same chrome (no Submit)');
    check(await papers.evaluate(() => !!document.querySelector('.gr-ruler') && !!document.querySelector('.gzo-insert') && !!GZ_WRITER_PASTE?.before && !!GZ_WRITER_FIND && !!GZ_WRITER_COUNTS && !!GZ_WRITER_PRINT), 'papers.html loads the ruler, object tools, rich paste, Find, counts and print');
    await papers.evaluate(() => GZ_WRITER_PAPER.current().editor.view.pasteHTML('<p><span style="color:#c00000">Standalone rich paste</span></p>'));
    check(await papers.evaluate(() => { let kept = false; GZ_WRITER_PAPER.current().editor.view.state.doc.descendants((n) => { if (n.isText && n.text.includes('Standalone rich paste')) kept = n.marks.some((m) => m.type.name === 'color' && m.attrs.color === 'C00000'); }); return kept; }), 'papers.html keeps formatting through the same rich paste path');
    await papers.click('.gp-status button:last-child');
    await until(() => papers.evaluate(() => document.querySelectorAll('.gp-versions .gp-mi').length > 0), 'versions');
    check(true, 'Versions lists saved versions');
    saved.versions = await shot(papers, 'paper-versions.png');
    // A paper Word can't take (a picture kept in a form Word has no place for) says so on the list, and nothing breaks.
    // Seeded through the worker, the index's one writer: the open editor's autosave of the paste above rewrites the index
    // too, and a write around the worker's queue lost this row to it on a loaded runner.
    await papers.evaluate(async () => {
      const k = 'bb.school.test|_900_1|_101_1|_8_1';
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A picture Word can’t take: ' }, { type: 'image', attrs: { src: 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', alt: 'Chart' } }] }] };
      await GZ_WRITER_PAPERS.open().save(k, { doc, title: 'Lab report', format: 'mla9' });
    });
    await papers.goto(`chrome-extension://${id}/papers.html`);
    await until(() => papers.evaluate(() => document.querySelectorAll('.gd-card').length === 2), 'papers list with the second paper');
    await papers.evaluate(() => [...document.querySelectorAll('.gd-card')].find((a) => a.querySelector('.gd-title').textContent === 'Lab report').querySelector('.gd-more').click());
    await papers.click('.gd-menu [data-act="export"]');
    await until(() => papers.evaluate(() => document.getElementById('gd-said').textContent === 'The .docx could not be made.'), 'the list says the .docx could not be made');
    check(true, 'papers.html says when a paper\'s .docx could not be made');
    await papers.close();

    // ---- standalone documents (papers.html?paper=doc:<uuid>&format=<id>, as the Documents home opens them)
    const rows = () => worker.evaluate(async () => { const all = await chrome.storage.local.get(null); return { papers: Object.keys(all).filter((k) => k.startsWith('writerPaper:doc:')), index: (all.writerPapers || []).filter((r) => r.key.startsWith('doc:')) }; });
    const stored = (k) => worker.evaluate(async (k) => (await chrome.storage.local.get(`writerPaper:${k}`))[`writerPaper:${k}`] || null, k);
    const openDoc = async (k, format) => {
      const d = await context.newPage();
      watch(d, `doc ${format}`);
      await d.goto(`chrome-extension://${id}/papers.html?paper=${encodeURIComponent(k)}&format=${format}`);
      await until(() => d.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key() && document.querySelectorAll('.gp-sheet').length > 0 && !document.querySelector('.gp-flow').style.visibility), `document ${format} open`);
      return d;
    };
    const k1 = `doc:${crypto.randomUUID()}`;
    let d = await openDoc(k1, 'mla9');
    check(await d.evaluate(() => GZ_WRITER_PAPER.current().format().id === 'mla9' && document.querySelector('.gp-sheet .gp-hdr').textContent === '1'), '?format=mla9 opens a new MLA document');
    check(await d.evaluate(() => document.querySelector('.gp-top a').textContent === 'Documents'), 'the back link reads Documents');
    check(await d.evaluate(() => { const i = document.querySelector('.gp-top h1 input'); return i && i.getAttribute('aria-label') === 'Title' && i.placeholder === 'Untitled document' && !i.readOnly && document.querySelector('.gp-state').textContent === ''; }), 'its title is a field, Untitled document, and nothing says Saved');
    await pause(1500);
    await d.close();
    check((await rows()).papers.length === 0 && (await rows()).index.length === 0, 'an untouched new document leaves nothing behind');

    const k2 = `doc:${crypto.randomUUID()}`;
    d = await openDoc(k2, 'plain');
    check(await d.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; return GZ_WRITER_PAPER.current().format().id === 'plain' && v.state.doc.childCount === 1 && !v.state.doc.textContent && [...document.querySelectorAll('.gp-sheet .gp-hdr')].every((x) => !x.textContent); }), '?format=plain opens a blank page: no heading, header or list page');
    check(await d.evaluate(() => document.querySelector('.gp-pill').textContent === 'Blank' && !document.querySelector('.gp-list h4')), 'the pill says Blank and the checklist is empty');
    await d.evaluate(() => GZ_WRITER_PAPER.current().editor.view.focus());
    await d.keyboard.type('Field notes from Tuesday');
    await until(() => d.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved'), 'typed document saved');
    let rec = await stored(k2);
    check(rec && rec.kind === 'paper' && rec.named === false && rec.title === 'Field notes from Tuesday' && rec.format === 'plain', `typing saves it, named by its first line (${JSON.stringify(rec && { kind: rec.kind, named: rec.named, title: rec.title, format: rec.format })})`);
    check(await d.evaluate(() => document.querySelector('.gp-top h1 input').placeholder === 'Field notes from Tuesday'), 'the title field shows the derived name');
    check(await d.evaluate(() => GZ_WRITER_FORMAT.check(GZ_WRITER_PAPER.current().editor.view.state.doc, GZ_WRITER_PAPER.current().format()).issues.length === 0 && !document.querySelector('.gp-issue[data-source="format"]')), 'Blank has no format checks');
    saved.blank = await shot(d, 'document-blank.png');

    // A rename from another page (the Documents home's) while this editor holds unsaved typing.
    const home = await context.newPage();
    watch(home, 'home');
    await home.goto(`chrome-extension://${id}/papers.html`);
    await until(() => home.evaluate(() => !!globalThis.GZ_WRITER_PAPERS && document.querySelectorAll('.gd-card').length >= 1), 'home list');
    await d.keyboard.type(' and more');
    await home.evaluate((k) => GZ_WRITER_PAPERS.open().save(k, { title: 'Renamed at home', named: true }), k2);
    await until(() => d.evaluate(() => document.querySelector('.gp-top h1 input').value === 'Renamed at home'), 'rename reaches the open editor');
    check(true, 'a rename from another page shows in the open editor while it holds unsaved typing');
    await until(() => d.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved'), 'saved after rename');
    rec = await stored(k2);
    const docReasons = await worker.evaluate(async (k) => ((await chrome.storage.local.get(`writerVersions:${k}`))[`writerVersions:${k}`] || []).map((v) => v.reason), k2);
    check(rec.title === 'Renamed at home' && rec.named === true && JSON.stringify(rec.doc).includes('Field notes from Tuesday and more') && !docReasons.includes('conflict'), `the editor's next save keeps the rename and the typing, no conflict version (${rec.title}; ${docReasons.join(', ')})`);
    await d.click('.gp-top h1 input', { clickCount: 3 });
    await d.keyboard.type('My own title');
    await until(() => d.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved'), 'title saved');
    await pause(300);
    rec = await stored(k2);
    check(rec.title === 'My own title' && rec.named === true && await d.evaluate(() => document.querySelector('.gp-top h1 input').value === 'My own title'), 'a title typed in the editor is saved and stays');
    await d.fill('.gp-top h1 input', 'Title still being typed');
    await home.evaluate((k) => GZ_WRITER_PAPERS.open().save(k, { title: 'Another home rename', named: true }), k2);
    await until(() => d.evaluate(() => GZ_WRITER_PAPER.current().paper()?.title === 'Another home rename'), 'incoming rename read');
    check(await d.inputValue('.gp-top h1 input') === 'Title still being typed', 'an incoming rename preserves an in-progress title');
    await until(async () => (await stored(k2))?.title === 'Title still being typed', 'in-progress title saved');
    // Back to the title the Open from Documents cases below list and pick.
    await d.fill('.gp-top h1 input', 'My own title');
    await until(async () => (await stored(k2))?.title === 'My own title', 'title typed back');
    saved.titled = await shot(d, 'document-titled.png');
    await d.click('.gp-status button:last-child');
    await until(() => d.evaluate(() => !!document.querySelector('.gp-versions')), 'document status menu');
    check(await d.evaluate(() => ![...document.querySelectorAll('.gp-versions [role="menuitem"]')].some((b) => b.textContent === 'Open from Documents')), 'a standalone document\'s status menu has no Open from Documents');
    await d.keyboard.press('Escape');
    await home.close();
    await d.close();

    // ---- Open from Documents: the assignment's paper takes a standalone document, a version first, Undo in the toast
    const docShots = path.join(shots, 'documents');
    const KEY = 'bb.school.test|_900_1|_101_1|_7_1', k3 = `doc:${crypto.randomUUID()}`;
    const seeder = await context.newPage();
    watch(seeder, 'seeder');
    await seeder.goto(`chrome-extension://${id}/papers.html`);
    await until(() => seeder.evaluate(() => !!globalThis.GZ_WRITER_PAPERS), 'store on the home page');
    await seeder.evaluate((k) => GZ_WRITER_PAPERS.open().save(k, { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reading notes on Beloved' }] }] }, kind: 'paper', named: false, title: 'Reading notes on Beloved', format: 'apa7' }), k3);
    // The newest standalone document is in the Documents page's Trash: the sheet leaves it out.
    const k4 = `doc:${crypto.randomUUID()}`;
    await seeder.evaluate(async (k) => { const P = GZ_WRITER_PAPERS.open(); await P.save(k, { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thrown away' }] }] }, kind: 'paper', named: true, title: 'Thrown away', format: 'plain' }); await P.trash(k); }, k4);
    check(Number.isFinite((await stored(k4))?.trashed), 'a standalone document in Trash is seeded');
    await seeder.close();
    const sourceBefore = JSON.stringify(await stored(k2)), versionsOf = (k) => worker.evaluate(async (k) => ((await chrome.storage.local.get(`writerVersions:${k}`))[`writerVersions:${k}`] || []), k);
    const assignmentText = await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent);
    check(assignmentText.includes('A sentence typed before the reload.'), 'the assignment paper holds its own text before');
    const openSheet = async () => {
      await fr.evaluate(() => document.querySelector('.gp-status button:last-child').click());
      await until(() => fr.evaluate(() => [...document.querySelectorAll('.gp-versions [role="menuitem"]')].some((b) => b.textContent === 'Open from Documents')), 'Open from Documents in the status menu');
      await fr.evaluate(() => [...document.querySelectorAll('.gp-versions [role="menuitem"]')].find((b) => b.textContent === 'Open from Documents').click());
      await until(() => fr.evaluate(() => !!document.querySelector('.gp-fromdocs-layer[data-open]') && document.activeElement?.classList.contains('gp-fromdocs-row')), 'the sheet open, its first row focused');
      await settle(fr);
    };
    await openSheet();
    const sheet = await fr.evaluate(() => {
      const d = document.querySelector('.gp-fromdocs[role="dialog"]');
      return { modal: d?.getAttribute('aria-modal'), label: document.getElementById(d?.getAttribute('aria-labelledby'))?.textContent,
        rows: [...d.querySelectorAll('.gp-fromdocs-row')].map((r) => [r.querySelector('b').textContent, r.querySelector('small').textContent]), inert: document.querySelector('.gp').inert };
    });
    check(sheet.modal === 'true' && sheet.label === 'Open from Documents' && sheet.inert, `the sheet is a labelled modal dialog over an inert paper (${JSON.stringify(sheet)})`);
    check(sheet.rows.map((r) => r[0]).join('|') === 'Reading notes on Beloved|My own title' && /^APA 7 · 4 words · /.test(sheet.rows[0][1]) && /^Blank · 6 words · /.test(sheet.rows[1][1]), `the student's standalone documents, newest first, none in Trash: title, format, words, date (${JSON.stringify(sheet.rows)})`);
    check(await fr.evaluate(() => [...document.querySelectorAll('.gp-fromdocs-row')].every((r) => r.getAttribute('aria-label') === `${r.querySelector('b').textContent} · ${r.querySelector('small').textContent}`)), 'each row has its full title, format, words and date as its accessible name');
    await p.keyboard.press('ArrowDown');
    check(await fr.evaluate(() => document.activeElement === document.querySelectorAll('.gp-fromdocs-row')[1]), 'ArrowDown moves to the next document');
    await p.keyboard.press('ArrowDown');
    check(await fr.evaluate(() => document.activeElement === document.querySelector('.gp-fromdocs-row')), 'ArrowDown wraps to the first document');
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
    check(await fr.evaluate(() => document.activeElement === document.querySelector('.gp-fromdocs-row')), 'Tab stays inside the sheet');
    await p.keyboard.press('Escape');
    await until(() => fr.evaluate(() => !document.querySelector('.gp-fromdocs-layer') && document.activeElement?.matches('.gp-status button:last-child') && !document.querySelector('.gp').inert), 'Escape closes the sheet');
    check(true, 'Escape closes the sheet and returns focus to the status bar');
    for (const width of [1280, 640]) {
      await p.setViewportSize({ width, height: 800 });
      await settle(fr);
      // No preparatory scroll: a keyboard/programmatic menu opening may start with the status bar below the window.
      await p.evaluate(() => scrollTo(0, 0));
      await settle(fr);
      await openSheet();
      const box = await fr.evaluate(() => { const r = document.querySelector('.gp-fromdocs').getBoundingClientRect(), s = document.querySelector('.gp-status').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: innerWidth, h: innerHeight, status: s.bottom }; });
      const frame = await el.evaluate((f) => { const r = f.getBoundingClientRect(); return { top: r.top, left: r.left, scrollY }; });
      check(box.left >= 0 && box.right <= box.w && frame.top + box.top >= 0 && frame.top + box.bottom <= 800, `${width}px: the sheet fits the frame and the window (${JSON.stringify({ box, frame })})`);
      saved[`fromDocs${width}`] = await shot(p, `open-from-documents-${width}.png`, docShots);
      await p.keyboard.press('Escape');
    }
    await p.setViewportSize({ width: 1440, height: 900 });
    await settle(fr);
    await openSheet();
    await fr.evaluate(() => [...document.querySelectorAll('.gp-fromdocs-row')].find((r) => r.querySelector('b').textContent === 'My own title').click());
    await until(() => fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('Field notes from Tuesday and more')), 'the document in the paper');
    await until(() => fr.evaluate(() => document.querySelector('.gp-toast span')?.textContent === 'My own title'), 'the toast');
    check(await fr.evaluate(() => !GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('A sentence typed before the reload.') && GZ_WRITER_PAPER.current().format().id === 'plain' && document.querySelector('.gp-pill').textContent === 'Blank'), 'the editor shows the document, in its format');
    check(await fr.evaluate(() => document.querySelector('.gp-top h1').textContent === 'Essay 2: Memory in Beloved' && document.querySelector('.gp-toast .gp-toast-do')?.textContent === 'Undo'), 'the title stays the assignment\'s; the toast names the document and offers Undo');
    let kept = await versionsOf(KEY);
    check(kept[0]?.reason === 'import' && JSON.stringify(kept[0].doc).includes('A sentence typed before the reload.') && kept[0].format === 'mla9', `a version of the paper before is taken (${kept.map((v) => v.reason).join(', ')})`);
    const after = await stored(KEY);
    check(JSON.stringify(after.doc).includes('Field notes from Tuesday and more') && after.format === 'plain' && after.title === 'Essay 2: Memory in Beloved', 'the assignment\'s paper is saved with the document, under Ultra\'s title');
    check(JSON.stringify(await stored(k2)) === sourceBefore && (await rows()).index.some((r) => r.key === k2), 'the document stays as it was on the Documents home');
    await fr.click('.gp-toast .gp-toast-do');
    await until(() => fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('A sentence typed before the reload.') && GZ_WRITER_PAPER.current().format().id === 'mla9'), 'Undo');
    await until(() => fr.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved'), 'saved after Undo');
    kept = await versionsOf(KEY);
    check(await fr.evaluate(() => !GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('Field notes from Tuesday')) && JSON.stringify((await stored(KEY)).doc).includes('A sentence typed before the reload.') && kept[0]?.reason === 'restore', `Undo restores the paper as it was (${kept.map((v) => v.reason).join(', ')})`);
    check(JSON.stringify(await stored(k2)) === sourceBefore, 'and the document is still there, unchanged');
    const indexBefore = await worker.evaluate(async () => (await chrome.storage.local.get('writerPapers')).writerPapers);
    await worker.evaluate(() => chrome.storage.local.set({ writerPapers: [] }));
    await fr.evaluate(() => document.querySelector('.gp-status button:last-child').click());
    await until(() => fr.evaluate(() => !!document.querySelector('.gp-versions')), 'empty list status menu');
    await fr.evaluate(() => [...document.querySelectorAll('.gp-versions [role="menuitem"]')].find((b) => b.textContent === 'Open from Documents').click());
    await until(() => fr.evaluate(() => document.activeElement?.classList.contains('gp-fromdocs-x')), 'empty sheet focuses Close');
    await p.keyboard.press('Shift+Tab');
    check(await fr.evaluate(() => document.activeElement?.classList.contains('gp-fromdocs-x') && !document.querySelector('.gp-fromdocs-row')), 'an empty list traps focus on Close');
    await p.keyboard.press('Escape');
    await worker.evaluate((writerPapers) => chrome.storage.local.set({ writerPapers }), indexBefore);
    const inPapers = await context.newPage();
    watch(inPapers, 'papers assignment');
    await inPapers.goto(`chrome-extension://${id}/papers.html?paper=${encodeURIComponent(KEY)}`);
    await until(() => inPapers.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key() && document.querySelectorAll('.gp-sheet').length > 0), 'the assignment paper in papers.html');
    await inPapers.click('.gp-status button:last-child');
    await until(() => inPapers.evaluate(() => !!document.querySelector('.gp-versions')), 'status menu in papers.html');
    check(await inPapers.evaluate(() => [...document.querySelectorAll('.gp-versions [role="menuitem"]')].some((b) => b.textContent === 'Open from Documents')), 'papers.html offers Open from Documents on an assignment\'s paper');
    await inPapers.evaluate(() => [...document.querySelectorAll('.gp-versions [role="menuitem"]')].find((b) => b.textContent === 'Open from Documents').click());
    await until(() => inPapers.evaluate(() => !!document.querySelector('.gp-fromdocs-row')), 'sheet in papers.html');
    check(await inPapers.evaluate(() => { const r = document.querySelector('.gp-fromdocs').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && document.activeElement?.classList.contains('gp-fromdocs-row'); }), 'papers.html shows the sheet inside its window with a row focused');
    await inPapers.evaluate(() => [...document.querySelectorAll('.gp-fromdocs-row')].find((r) => r.querySelector('b').textContent === 'My own title').click());
    await until(() => inPapers.evaluate(() => GZ_WRITER_PAPER.current().format().id === 'plain' && GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.includes('Field notes from Tuesday and more')), 'pick in papers.html');
    check(JSON.stringify(await stored(k2)) === sourceBefore, 'a pick in papers.html also leaves the source unchanged');
    await inPapers.close();

    check(errors.length === 0, `no page or frame errors (${errors.join('; ')})`);
    check(requests.every((r) => r.method === 'GET' && r.origin === site), 'every LMS request is a synthetic GET');
    passed = true;
    console.log(`writer-paper-check: ${checks.length} passed, 0 failed`);
    console.log(JSON.stringify({ checks: checks.length, shots: saved, idb: idb === 'frame' ? 'shared' : 'partitioned' }, null, 2));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, requests, errors }, null, 2) + '\n');
  }
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), `${e.stack}\n`); process.exitCode = 1; });
