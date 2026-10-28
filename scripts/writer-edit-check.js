// Glaze Writer's editing tools in the real unpacked extension (writer-find.js, writer-counts.js, writer-print.js), on the
// synthetic assignment attempt (paper mode, the 6-page fixtures of test/fixtures/writer-paper-fixtures.js) and the
// synthetic discussion (compose mode), with real Quill 1.3.7 in the page as scripts/writer-paper-check.js runs it: Find and
// Replace (count, stepping, Escape, match case, whole word, across pages, in notes, Replace and Replace all as one undo
// each, the live region), the printed paper (Playwright's PDF of the frame's own print copy: page count and each page's
// first line against the editor's, as scripts/writer-word-fidelity.js compares Word's), ⌘P, the .txt and .md exports, the
// word count popover, and typing latency on a 6-page paper with the find bar closed and open. Screenshots go in
// ~/Projects/glaze-plans/writer/mockups/build-edit (EDIT_SHOTS). GETs only, synthetic; no account or outside network
// from the browser.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-edit-check.js [evidence directory], under the heavy-check lock (CLAUDE.md)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const FX = require('../test/fixtures/writer-paper-fixtures.js');
const site = 'https://bb.school.test';
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create', DISCUSSION = '/ultra/courses/_101_1/discussion/_9_1';
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-edit-check');
const shots = process.env.EDIT_SHOTS || path.join(os.homedir(), 'Projects/glaze-plans/writer/mockups/build-edit');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
// EDIT_ONLY=print skips Find and latency (a quicker run while working on print).
const ONLY = process.env.EDIT_ONLY || '';
const checks = [], requests = [], errors = [], numbers = {};
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
    const old = c.querySelector('.ql-editor'), html = old.innerHTML, id = old.id;
    c.innerHTML = '';
    const q = new Quill(c, {});
    if (id) q.root.id = id;
    if (/[^\\s]/.test(html.replace(/<[^>]*>/g, ''))) q.setContents(q.clipboard.convert(html), 'silent');
  }
})();`;
const words = (s) => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const head = (s) => words(s).split(' ').slice(0, 6).join(' ');

(async () => {
  let context, held = false, tmp, ext;
  const lock = env.lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-edit-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-edit-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-edit-'));
    fs.mkdirSync(out, { recursive: true });
    fs.mkdirSync(shots, { recursive: true });
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    if (crypto.createHash('sha256').update(quill).digest('hex') !== QUILL.sha256) throw Error('Quill 1.3.7 hash mismatch');
    ext = env.staged(root, [`${site}/*`]);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...env.chromeLaunch(), headless: true, acceptDownloads: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(15000);
    const grades = JSON.parse(fixture('ultra-writer-gradebook.json')), members = JSON.parse(fixture('ultra-memberships.json'));
    members.results = members.results.map((m) => (m.courseId === '_101_1' ? { ...m, course: { ...m.course, name: FX.context.course, displayName: FX.context.course } } : m));
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      requests.push({ method: req.method(), origin: u.origin, path: u.pathname });
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      const page = { [ATTEMPT]: 'ultra-writer-attempt.html', [DISCUSSION]: 'ultra-writer-discussion.html' }[u.pathname];
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
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
    await worker.evaluate(async ({ settings, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] }); }, { settings, site });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();
    // The print page is this check's own copy of the frame's print copy: what its CSP says of the copy's styles is the
    // check's, not Writer's.
    const watch = (p, tag) => {
      p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !(tag === 'print' && /Content Security Policy directive 'style-src/.test(m.text()))) errors.push(`${tag} console: ${m.text()}`); });
    };
    const settle = async (fr) => { await pause(150); await fr.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await pause(100); };
    const shot = async (target, name) => { await pause(250); const f = path.join(shots, name); await target.screenshot({ path: f }); return f; };
    const saved = {};

    // ================================================================= paper mode
    const p = await context.newPage();
    watch(p, 'page');
    await p.goto(`${site}${ATTEMPT}`);
    const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity && f.offsetHeight > 500) && x; }, 'paper frame shown');
    const fr = await until(() => el.contentFrame(), 'frame document');
    await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key()), 'paper loaded');
    await until(() => fr.evaluate(() => document.querySelectorAll('.gp-sheet').length > 0 && document.querySelector('.gp-flow').style.visibility === ''), 'pages drawn');
    fr.page().on('dialog', (d) => d.dismiss());
    const load = async (json, formatId) => {
      await fr.evaluate(async ({ json, formatId }) => {
        const api = GZ_WRITER_PAPER.current(), v = api.editor.view, fmt = GZ_WRITER_STYLES.FORMATS[formatId];
        if (api.format().id !== formatId) { document.querySelector('.gp-pill').click(); [...document.querySelectorAll('.gp-menu [role^="menuitem"]')].find((b) => b.textContent.startsWith(fmt.label)).click(); }
        await new Promise((r) => setTimeout(r, 50));
        v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON(json).content));
      }, { json, formatId });
      await settle(fr);
      await until(() => fr.evaluate(() => document.querySelector('.gp-sheet') && !document.querySelector('.gp-flow').style.visibility), 'relaid');
      await settle(fr);
    };
    const caretAt = (needle) => fr.evaluate((needle) => {
      const v = GZ_WRITER_PAPER.current().editor.view; let at = 0;
      v.state.doc.descendants((n, pos) => { if (!at && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle); });
      v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at))); v.focus();
    }, needle);
    const bar = () => fr.evaluate(() => {
      const b = document.querySelector('.ge-find'), v = GZ_WRITER_PAPER.current().editor.view, s = GZ_WRITER_FIND.key.getState(v.state);
      return { open: !!b && !b.hidden, count: b?.querySelector('.ge-count').textContent || '', focus: document.activeElement?.className || '', hits: s.hits.length, current: s.current,
        marked: document.querySelectorAll('.gp-flow .ge-hit').length, cur: document.querySelectorAll('.gp-flow .ge-cur').length, sel: [v.state.selection.from, v.state.selection.to], hit: s.hits[s.current] && [s.hits[s.current].from, s.hits[s.current].to],
        live: document.querySelector('.ge-sr')?.textContent || '', editing: document.activeElement?.classList.contains('ProseMirror') };
    });

    // ---- Find
    if (!ONLY || ONLY === 'find') {
    await load(FX.papers.mla9(), 'mla9');
    await caretAt('Toni Morrison');
    await p.keyboard.press(`${MOD}+f`);
    let b = await until(async () => { const x = await bar(); return x.open && x; }, 'find bar opens on ⌘F');
    check(b.open && /ge-in/.test(b.focus), '⌘F opens the find bar in the paper\'s frame with its field focused');
    await p.keyboard.type('clearing');
    await pause(100);
    const total = await fr.evaluate(() => GZ_WRITER_FIND.search(GZ_WRITER_PAPER.current().editor.view.state.doc, 'clearing', {}).length);
    b = await bar();
    check(total >= 6 && b.hits === total && b.count === `1 of ${total}`, `live count "1 of ${total}" as the query is typed (${b.count})`);
    check(b.cur === 1 && b.marked >= total, `every match marked, one current (${b.marked} marks, ${b.cur} current)`);
    const pagesHit = await fr.evaluate(() => {
      const v = GZ_WRITER_PAPER.current().editor.view, top = v.dom.getBoundingClientRect().top, scale = v.dom.getBoundingClientRect().height / v.dom.offsetHeight;
      const stride = (GZ_WRITER_STYLES.geometry(GZ_WRITER_PAPER.current().format()).height + 26.4) * scale;
      return [...new Set(GZ_WRITER_FIND.key.getState(v.state).hits.map((h) => Math.floor((v.coordsAtPos(h.from).top - top) / stride) + 1))];
    });
    check(pagesHit.length >= 3, `matches across page breaks: on pages ${pagesHit.join(', ')}`);
    await p.keyboard.press('Enter');
    b = await bar();
    check(b.count === `2 of ${total}` && b.sel[0] === b.hit[0] && b.sel[1] === b.hit[1], 'Enter steps to the next match and selects it');
    await p.keyboard.press('Shift+Enter');
    await p.keyboard.press('Shift+Enter');
    b = await bar();
    check(b.count === `${total} of ${total}`, 'Shift+Enter steps back, wrapping to the last');
    await until(async () => (await bar()).live.trim() === `${total} of ${total}`, 'announced').catch(async (e) => { throw Error(`${e.message}: live "${(await bar()).live}", count "${(await bar()).count}" ${JSON.stringify(await fr.evaluate(() => ({ n: document.querySelectorAll('.ge-sr').length, html: [...document.querySelectorAll('.ge-sr')].map((x) => x.outerHTML + x.parentElement.className) })))} timer ${await fr.evaluate(() => new Promise((r) => { const t = performance.now(); setTimeout(() => r(performance.now() - t), 10); }))} ms, focus ${await fr.evaluate(() => [document.hasFocus(), document.visibilityState, document.activeElement?.className])}`); });
    check(true, `the live region announces "${total} of ${total}"`);
    await p.keyboard.press(`${MOD}+g`);
    check((await bar()).count === `1 of ${total}`, '⌘G steps on (wrapping to the first)');
    await fr.click('.ge-tg');
    saved.findPaper = await shot(el, 'find-paper.png');
    // Light: the mockup's Paper tokens on the frame, for the picture.
    await fr.evaluate(() => { const r = document.documentElement.style, L = { '--gz-accent': '#2563eb', '--gz-accent-hi': '#1d4ed8', '--gz-accent-soft': '#dbeafe', '--gz-accent-ink': '#ffffff', '--gz-surface': '#ffffff', '--gz-surface-2': '#f4f5f7', '--gz-ink': '#14181f', '--gz-ink-muted': '#5b6472', '--gz-ink-faint': '#848b96', '--gz-line': '#e3e6ea', '--gz-line-strong': '#c8cdd4' }; window.__dark = [document.documentElement.hasAttribute('data-dark'), Object.fromEntries(Object.keys(L).map((k) => [k, r.getPropertyValue(k)]))]; for (const [k, v] of Object.entries(L)) r.setProperty(k, v); document.documentElement.removeAttribute('data-dark'); });
    saved.findPaperLight = await shot(el, 'find-paper-light.png');
    await fr.evaluate(() => { const [dark, was] = window.__dark, r = document.documentElement.style; for (const [k, v] of Object.entries(was)) if (v) r.setProperty(k, v); else r.removeProperty(k); document.documentElement.toggleAttribute('data-dark', dark); });
    await fr.focus('.ge-find .ge-in');
    b = await bar();
    const at = b.hit;
    await p.keyboard.press('Escape');
    b = await bar();
    check(!b.open && b.editing && b.sel[0] === at[0] && b.sel[1] === at[1] && b.marked === 0, 'Escape closes the bar, leaves the current match selected in the editor and clears the marks');

    // match case, whole word
    await p.keyboard.press(`${MOD}+f`);
    await until(async () => (await bar()).open, 'reopened');
    await fr.fill('.ge-find .ge-in', 'the');
    await pause(80);
    const any = (await bar()).hits;
    await fr.click('.ge-find [aria-label="Match case"]');
    const cs = (await bar()).hits;
    await fr.click('.ge-find [aria-label="Whole word"]');
    const csw = (await bar()).hits;
    const expect = await fr.evaluate(() => { const d = GZ_WRITER_PAPER.current().editor.view.state.doc, F = GZ_WRITER_FIND; return [F.search(d, 'the', {}).length, F.search(d, 'the', { cs: true }).length, F.search(d, 'the', { cs: true, word: true }).length]; });
    check(any === expect[0] && cs === expect[1] && csw === expect[2] && any > cs && cs > csw, `match case and whole word narrow the matches (${any} → ${cs} → ${csw})`);
    await fr.click('.ge-find [aria-label="Match case"]');
    await fr.click('.ge-find [aria-label="Whole word"]');

    // typing with the bar open: the new match is found after a pause
    await fr.fill('.ge-find .ge-in', 'clearing');
    await caretAt('Toni Morrison');
    await p.keyboard.type('clearing ');
    await until(async () => (await bar()).hits === total + 1, 'found again after typing', 3000);
    check((await bar()).count.endsWith(`of ${total + 1}`), 'a match typed into the paper is counted after a pause');
    await p.keyboard.press(`${MOD}+z`);

    // Replace, then Replace all, each one undo
    await load(FX.papers.mla9(), 'mla9');
    await caretAt('Toni Morrison');
    await p.keyboard.press(`${MOD}+Shift+h`);
    b = await until(async () => { const x = await bar(); return x.open && x; }, 'replace opens');
    check(await fr.evaluate(() => !document.querySelector('.ge-with').hidden && document.querySelector('.ge-tg').getAttribute('aria-expanded') === 'true'), '⌘⇧H opens Find with Replace');
    await fr.fill('.ge-find .ge-in', 'clearing');
    await fr.fill('.ge-with .ge-in', 'glade');
    await fr.click('.ge-with .ge-sb >> nth=0');
    await pause(80);
    b = await bar();
    const textOf = () => fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent);
    check(b.hits === total - 1 && (await textOf()).split('glade').length === 2 && b.count === `1 of ${total - 1}`, `Replace changes the current match and moves on (${b.count})`);
    await until(async () => (await bar()).live.trim() === '1 replaced', 'replace announced', 3000);
    check(true, 'the live region says "1 replaced"');
    await fr.click('.ge-with .ge-sb >> nth=1');
    await pause(80);
    check((await bar()).hits === 0 && (await textOf()).split('glade').length === total + 1 && (await bar()).count === 'No results', `Replace all changes the other ${total - 1} ("No results")`);
    await until(async () => (await bar()).live.trim() === `${total - 1} replaced`, 'replace all announced', 3000);
    await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.run('undo'));
    check((await textOf()).split('glade').length === 2, 'one undo brings back all the matches Replace all changed');
    await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.run('undo'));
    check(!(await textOf()).includes('glade'), 'and one more undoes the single Replace');
    await p.keyboard.press('Escape');

    // In notes: Chicago's first note; the match shown on its mark and at the page's foot
    await load(FX.papers.chicago17(), 'chicago17');
    await caretAt('Toni Morrison');
    await p.keyboard.press(`${MOD}+f`);
    await until(async () => (await bar()).open, 'reopened for notes');
    await fr.fill('.ge-find .ge-in', 'Knopf');
    await pause(150);
    const note = await fr.evaluate(() => ({ mark: !!document.querySelector('.gp-flow sup.gz-footnote.ge-cur'), count: document.querySelector('.ge-count').textContent, hl: CSS.highlights.get('ge-note')?.size || 0, text: [...(CSS.highlights.get('ge-note') || [])][0]?.toString() || '' }));
    check(note.mark && note.count === '1 of 2', 'a match inside a footnote is the current one on its note mark (1 of 2: the note, then the bibliography)');
    check(note.hl === 1 && note.text === 'Knopf', `the note's text is marked at the page's foot ("${note.text}")`);
    saved.findNote = await shot(el, 'find-note.png');
    await fr.click('.ge-tg');
    await fr.fill('.ge-with .ge-in', 'Vintage');
    await fr.click('.ge-with .ge-sb >> nth=1');
    await settle(fr);
    const notes = () => fr.evaluate(() => [...document.querySelectorAll('.gp-notes p')].map((x) => x.textContent).join(' | '));
    check((await notes()).includes('New York: Vintage, 1987') && !(await textOf()).includes('Knopf'), 'Replace all rewrites the note at the foot of its page and the bibliography');
    await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.run('undo'));
    await settle(fr);
    check((await notes()).includes('New York: Knopf, 1987') && (await textOf()).includes('Knopf'), 'one undo restores both');
    await p.keyboard.press('Escape');

    // ---- typing latency on the 6-page paper, bar closed and open (a query with many matches)
    const latency = async () => fr.evaluate(async () => {
      const v = GZ_WRITER_PAPER.current().editor.view, times = [];
      let t0 = 0;
      const down = () => { t0 = performance.now(); };
      const input = () => { const s = t0; requestAnimationFrame(() => setTimeout(() => times.push(performance.now() - s), 0)); };
      v.dom.addEventListener('keydown', down, true); v.dom.addEventListener('input', input);
      window.__lat = { stop: () => { v.dom.removeEventListener('keydown', down, true); v.dom.removeEventListener('input', input); return times; } };
    });
    const measure = async () => {
      await load(FX.papers.mla9(), 'mla9');
      await caretAt('house itself');
      await latency();
      await p.keyboard.type('the quick brown fox jumps over the lazy dog and then the river', { delay: 40 });
      await pause(600);
      const times = await fr.evaluate(() => window.__lat.stop());
      times.sort((a, b) => a - b);
      return { n: times.length, median: +times[Math.floor(times.length / 2)].toFixed(2), p90: +times[Math.floor(times.length * 0.9)].toFixed(2), max: +times.at(-1).toFixed(2) };
    };
    const dispatched = () => fr.evaluate(async () => {
      const v = GZ_WRITER_PAPER.current().editor.view, d = v.state.doc, times = [];
      let at = 0; d.forEach((n, off, i) => { if (i === 8) at = off + 5; });
      for (let i = 0; i < 40; i++) { const t = performance.now(); v.dispatch(v.state.tr.insertText('x', at + i)); await new Promise((r) => setTimeout(r, 0)); times.push(performance.now() - t); }
      times.sort((a, b) => a - b);
      return +times[20].toFixed(2);
    });
    numbers.closed = await measure();
    await load(FX.papers.mla9(), 'mla9');
    numbers.closedDispatch = await dispatched();
    await p.keyboard.press(`${MOD}+f`);
    await fr.fill('.ge-find .ge-in', 'the');
    await pause(150);
    numbers.openHits = (await bar()).hits;
    numbers.open = await measure();
    await fr.fill('.ge-find .ge-in', 'clearing');
    await pause(150);
    numbers.openFew = await measure();
    await load(FX.papers.mla9(), 'mla9');
    await pause(400);
    numbers.openDispatch = await dispatched();
    console.log(`a dispatched keystroke (median of 40, ms): bar closed ${numbers.closedDispatch}, open ${numbers.openDispatch}`);
    console.log(`typing latency (keydown → next frame, ms): bar closed ${JSON.stringify(numbers.closed)}; open on "the" (${numbers.openHits} matches) ${JSON.stringify(numbers.open)}; open on "clearing" ${JSON.stringify(numbers.openFew)}`);
    // Gated on a query as specific as a reader's (16 matches); "the" (about 200) is logged for the record.
    check(numbers.openFew.median <= Math.max(numbers.closed.median * 1.15, numbers.closed.median + 1.5), `typing latency unchanged with the find bar open on "clearing" (median ${numbers.closed.median} → ${numbers.openFew.median} ms)`);
    await fr.focus('.ge-find .ge-in');
    await p.keyboard.press('Escape');
    numbers.closedAfter = await measure();
    console.log(`typing latency with the bar closed again after: ${JSON.stringify(numbers.closedAfter)}`);

    }
    // ---- Print: ⌘P prints this frame, the file named as the .docx; the printed copy's pages are the editor's
    await fr.evaluate(() => { window.__printed = []; window.print = () => { window.__printed.push(document.title); dispatchEvent(new Event('afterprint')); }; });
    await caretAt('Toni Morrison');
    await p.keyboard.press(`${MOD}+p`);
    const printed = await fr.evaluate(() => [window.__printed, document.title]);
    check(printed[0].length === 1 && printed[0][0].startsWith('Rivera_Essay_2'), `⌘P prints the paper's frame, titled ${printed[0][0]} for the PDF's name`);
    check(printed[1] === 'Glaze Writer', 'and the frame\'s title is back after printing');
    const items = await fr.evaluate(() => GZ_WRITER_PRINT.items().map((i) => i.label));
    check(items.join('|') === 'Print…|Export PDF…|Export .txt|Export .md', `the paper's menu entries (${items.join(', ')})`);
    await fr.evaluate(() => GZ_WRITER_PRINT.items()[1].run());
    check((await fr.evaluate(() => window.__printed.length)) === 2, 'Export PDF… takes the same print path');

    const editorPages = (fid) => fr.evaluate(() => {
      const api = GZ_WRITER_PAPER.current(), v = api.editor.view, geo = GZ_WRITER_STYLES.geometry(api.format());
      const dom = v.dom.getBoundingClientRect(), scale = dom.height / v.dom.offsetHeight, stride = geo.height + 26.4;
      const sheets = [...document.querySelectorAll('.gp-zoom > div > .gp-sheet')];
      const firsts = sheets.map((_, i) => {
        const top = dom.top + i * stride * scale + 2, bottom = dom.top + (i * stride + geo.body) * scale;
        let best = null;
        v.state.doc.descendants((n, pos) => {
          if (best || !n.isTextblock || !n.textContent.trim()) return !best;
          for (let q = pos + 1; q < pos + n.nodeSize - 1; q++) { const c = v.coordsAtPos(q, 1); if (c.top >= top && c.top < bottom) { best = { pos: q, top: c.top, block: pos, node: n }; return false; } if (c.top >= bottom) return false; }
          return false;
        });
        if (!best) return '';
        let end = best.pos;
        const last = best.block + best.node.nodeSize - 1;
        while (end < last && Math.abs(v.coordsAtPos(end + 1, -1).top - best.top) < 3) end++;
        return v.state.doc.textBetween(best.pos, end, ' ').trim();
      });
      return { count: sheets.length, headers: sheets.map((s) => s.querySelector('.gp-hdr').textContent), firsts, notes: sheets.map((s) => s.querySelectorAll('.gp-notes p').length) };
    });
    const pdfPage = await context.newPage();
    watch(pdfPage, 'print');
    await pdfPage.goto(`chrome-extension://${id}/writer.html`);
    const pdfs = {};
    for (const fid of ['mla9', 'apa7', 'chicago17']) {
      await load(FX.papers[fid](), fid);
      if (fid === 'mla9') { await p.keyboard.press(`${MOD}+f`); await fr.fill('.ge-find .ge-in', 'the'); await pause(150); } // printed with matches marked
      const ed = await editorPages(fid);
      // The frame's own print copy (writer-paper.js beforeprint) with every stylesheet it prints under, in a page of its own.
      const copy = await fr.evaluate(() => {
        dispatchEvent(new Event('beforeprint'));
        // Inline styles as data: the frame sets them through CSSOM, which its CSP allows; parsed from HTML they'd be dropped.
        const print = document.querySelector('body > .gp-print').cloneNode(true);
        for (const x of [print, ...print.querySelectorAll('[style]')]) { if (x.style.cssText) x.dataset.gzStyle = x.style.cssText; x.removeAttribute('style'); }
        const html = print.outerHTML;
        const css = document.adoptedStyleSheets.map((s) => [...s.cssRules].map((r) => r.cssText).join('\n')).join('\n');
        dispatchEvent(new Event('afterprint'));
        return { html, css, root: [...document.documentElement.attributes].map((a) => [a.name, a.value]), style: document.documentElement.getAttribute('style') || '' };
      });
      fs.writeFileSync(path.join(out, `print-${fid}.html`), copy.html);
      await pdfPage.evaluate((c) => {
        for (const [k, v] of c.root) document.documentElement.setAttribute(k, v);
        document.querySelector('body > .gp-print')?.remove();
        document.body.insertAdjacentHTML('beforeend', c.html);
        for (const x of document.querySelectorAll('[data-gz-style]')) x.style.cssText = x.dataset.gzStyle;
        const sheet = new CSSStyleSheet(); sheet.replaceSync(c.css); document.adoptedStyleSheets = [sheet];
      }, copy);
      await pdfPage.evaluate(() => document.fonts.ready);
      await pdfPage.emulateMedia({ media: 'print' });
      if (fid === 'mla9') check(await pdfPage.evaluate(() => { const h = document.querySelector('.gp-print .ge-hit'), u = document.querySelector('.gp-print .gz-iss'); return !!h && getComputedStyle(h).backgroundColor === 'rgba(0, 0, 0, 0)' && (!u || getComputedStyle(u).textDecorationLine === 'none'); }), 'find\'s marks and proofing underlines are in the print copy but print unmarked');
      const pdf = path.join(out, `print-${fid}.pdf`);
      await pdfPage.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
      await pdfPage.emulateMedia({ media: 'screen' });
      const count = +/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }))[1];
      const size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }));
      const firsts = [], hdrs = [];
      for (let k = 1; k <= count; k++) {
        let lines = execFileSync('pdftotext', ['-layout', '-f', String(k), '-l', String(k), pdf, '-'], { encoding: 'utf8' }).split('\n').map(words).filter(Boolean);
        const header = ed.headers[k - 1] || '';
        if (header && lines[0]?.endsWith(header)) { hdrs.push(header); lines = lines.slice(1); } else hdrs.push('');
        firsts.push(lines[0] || '');
      }
      const pages = Array.from({ length: Math.max(count, ed.count) }, (_, k) => {
        const a = head(ed.firsts[k]), b2 = head(firsts[k]);
        return a === b2 ? 'same' : a && b2 && (words(firsts[k]).includes(a) || words(ed.firsts[k]).includes(b2)) ? '±1 line' : 'differs';
      });
      pdfs[fid] = { editor: ed.count, printed: count, size: size && `${size[1]}x${size[2]}`, headers: hdrs, pages };
      console.log(fid, JSON.stringify(pdfs[fid]));
      check(count === ed.count, `${fid}: the printed PDF has the editor's ${ed.count} pages (${count})`);
      const once = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' }).split('Professor Okafor').length - 1;
      check(once === 1, `${fid}: the PDF's text holds each line once, not the other pages' clipped text (${once})`);
      check(size && Math.round(+size[1]) === 612 && Math.round(+size[2]) === 792, `${fid}: Letter pages (${size?.[1]} x ${size?.[2]} pt)`);
      check(pages.every((x) => x !== 'differs'), `${fid}: each printed page starts on the editor's first line (${pages.join(', ')})`);
      check(hdrs.join('|') === ed.headers.join('|'), `${fid}: running headers and page numbers printed (${ed.headers.join(', ')})`);
      if (fid === 'chicago17') {
        const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
        check(['Knopf, 1987), 35.', 'Price of the Ticket, xx.'].every((s) => words(text).includes(s)), 'chicago17: footnotes printed at the foot of their pages');
      }
      if (fid === 'mla9') { await fr.focus('.ge-find .ge-in'); await p.keyboard.press('Escape'); }
    }
    await pdfPage.close();
    fs.writeFileSync(path.join(out, 'print-pages.json'), JSON.stringify(pdfs, null, 2) + '\n');

    // ---- exports (the paper's entries run as its menu would)
    const download = async (fn) => { const [d] = await Promise.all([p.waitForEvent('download'), fn()]); const f = path.join(out, d.suggestedFilename()); await d.saveAs(f); return { name: d.suggestedFilename(), text: fs.readFileSync(f, 'utf8') }; };
    const txt = await download(() => fr.evaluate(() => GZ_WRITER_PRINT.items()[2].run()));
    check(/^Rivera_.*\.txt$/.test(txt.name) && txt.text.includes('\n\nNotes\n\n[1] Toni Morrison, Beloved (New York: Knopf, 1987), 35.') && txt.text.includes('Bibliography'), `Export .txt: ${txt.name}, notes after the text`);
    const md = await download(() => fr.evaluate(() => GZ_WRITER_PRINT.items()[3].run()));
    check(md.name.endsWith('.md') && md.text.includes('[^1]: Toni Morrison, *Beloved* (New York: Knopf, 1987), 35.') && md.text.includes('# The Clearing as Ledger'), `Export .md: ${md.name}, headings, emphasis and footnotes`);

    // ---- the word count popover (the status bar's count, opened as the paper's hook would)
    await load(FX.papers.mla9(), 'mla9');
    await fr.evaluate(() => GZ_WRITER_COUNTS.open(document.querySelector('.gp-status > span:nth-child(2)')));
    const pop = () => fr.evaluate(() => { const x = document.querySelector('.ge-counts'); return { open: !!x && !x.hidden, rows: [...(x?.querySelectorAll('tr') || [])].map((r) => [...r.cells].map((c) => c.textContent)), bar: document.querySelector('.gp-status > span:nth-child(2)').textContent }; });
    let c = await pop();
    const row = (r, label) => r.rows.find((x) => x[0] === label);
    check(c.open && `${row(c, 'Words')?.[1]} words` === c.bar && row(c, 'Pages')?.[1] === '6' && /min$/.test(row(c, 'Reading time')?.[1] || ''), `the popover: ${c.rows.map((r) => r.join(' ')).join('; ')}`);
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view, d = v.state.doc; let a = 0, z = 0; d.forEach((n, off, i) => { if (i === 5) { a = off + 1; z = off + n.nodeSize - 1; } }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(d, a, z))); });
    await settle(fr);
    c = await pop();
    check(c.rows[0].join('|') === '|Selection|Total' && row(c, 'Paragraphs')?.[1] === '1' && +row(c, 'Words')[1] > 0 && +row(c, 'Words')[1] < +row(c, 'Words')[2].replace(/\D/g, ''), `with text selected, a Selection column (${row(c, 'Words').join(' ')})`);
    saved.counts = await shot(el, 'counts-paper.png');
    await p.keyboard.press('Escape');
    check(!(await pop()).open, 'Escape closes the popover');

    // ================================================================= compose mode
    const q = await context.newPage();
    watch(q, 'compose');
    await q.goto(`${site}${DISCUSSION}`);
    const cel = await until(async () => { const h = await q.$('iframe.gz-writer[data-gz-writer-frame="post"]'); return h && await h.evaluate((f) => !f.style.opacity && f.offsetHeight > 100) && h; }, 'post frame shown');
    const cf = await until(() => cel.contentFrame(), 'post frame document');
    await until(() => cf.evaluate(() => !!document.querySelector('.ProseMirror')), 'compose editor');
    await cf.click('.ProseMirror');
    await q.keyboard.type('Morrison\'s clearing is less a refuge than a ledger. When Baby Suggs preaches in the clearing, she asks for love the town will refuse.', { delay: 2 });
    await q.keyboard.press(`${MOD}+f`);
    await until(() => cf.evaluate(() => document.querySelector('.ge-find')?.hidden === false), 'compose find bar');
    await q.keyboard.type('clearing');
    await pause(100);
    check(await cf.evaluate(() => document.querySelector('.ge-count').textContent === '1 of 2' && document.querySelectorAll('.ProseMirror .ge-hit').length === 2 && !!document.querySelector('#gw > .ge-find')), 'compose: ⌘F finds in the box ("1 of 2"), the bar inside its top right');
    const height = await cel.evaluate((f) => f.offsetHeight);
    saved.findCompose = await shot(cel, 'find-compose.png');
    await q.keyboard.press('Escape');
    check(await cf.evaluate(() => document.querySelector('.ge-find').hidden && document.activeElement.classList.contains('ProseMirror')), 'compose: Escape returns to the editor');
    check(await cel.evaluate((f, h) => f.offsetHeight === h, height), 'the bar never changes the box\'s height');
    await q.keyboard.press('ArrowRight'); // the match Escape left selected, collapsed
    await cf.click('[data-slot="target"]');
    c = await cf.evaluate(() => { const x = document.querySelector('.ge-counts'); return { open: !!x && !x.hidden, rows: [...x.querySelectorAll('tr')].map((r) => [...r.cells].map((c) => c.textContent)), ring: document.querySelector('[data-slot="target"] .gz-num').textContent, expanded: document.querySelector('[data-slot="target"]').getAttribute('aria-expanded') }; });
    check(c.open && c.expanded === 'true' && `${row(c, 'Words')[1]} words` === c.ring && !row(c, 'Pages') && row(c, 'Sentences')[1] === '2', `compose: the word count opens the popover (${c.rows.map((r) => r.join(' ')).join('; ')})`);
    saved.countsCompose = await shot(cel, 'counts-compose.png');
    await q.keyboard.press('Escape');
    await cf.click('#more');
    const menu = await cf.evaluate(() => [...document.querySelectorAll('#menu [role="menuitem"]')].map((x) => x.textContent));
    check(menu.includes('Export .txt') && menu.includes('Export .md') && !menu.some((x) => /Print/.test(x)), `compose ⋯: ${menu.join(', ')}`);
    saved.menuCompose = await shot(cel, 'menu-compose.png');
    const [d] = await Promise.all([q.waitForEvent('download'), cf.click('#menu >> text=Export .txt')]);
    const f = path.join(out, d.suggestedFilename()); await d.saveAs(f);
    check(fs.readFileSync(f, 'utf8') === 'Morrison’s clearing is less a refuge than a ledger. When Baby Suggs preaches in the clearing, she asks for love the town will refuse.\n', `compose Export .txt (${d.suggestedFilename()})`);
    const printNot = await cf.evaluate(() => { let called = false; window.print = () => { called = true; }; document.querySelector('.ProseMirror').dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: navigator.platform.includes('Mac'), ctrlKey: !navigator.platform.includes('Mac'), bubbles: true, cancelable: true })); return called; });
    check(!printNot, 'compose leaves ⌘P to the browser');

    check(errors.length === 0, `no page or frame errors (${errors.join('; ')})`);
    check(requests.every((r) => r.method === 'GET' && r.origin === site), 'every LMS request is a synthetic GET');
    passed = true;
    console.log(JSON.stringify({ checks: checks.length, shots: saved, latency: numbers, print: pdfs }, null, 2));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, requests, errors, numbers }, null, 2) + '\n');
  }
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), `${e.stack}\n`); process.exitCode = 1; });
