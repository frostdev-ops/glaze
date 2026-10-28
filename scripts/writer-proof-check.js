// Glaze Writer's proofing in the real unpacked extension, on the synthetic Ultra boxes (test/fixtures/ultra-writer-*) with
// the real Quill 1.3.7 under them, as scripts/writer-check.js runs them: the one Harper SharedWorker shared by frames in
// tabs on five schools, lazy until a box is focused, closing when idle and back on the next lint; autocorrect and its
// undo, the underlines, the hover card by mouse and keyboard, Add to dictionary reaching another school's box, the count,
// a test's box still proofed, and Settings → Writer's proofing, dialect and autocorrect classes off and on. Memory (the browser's processes' RSS) with Harper in 1 and 5 tabs. GETs only.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-proof-check.js [evidence directory]
// PROOF_SHOTS names where the screenshots go (default /tmp/gz-writer-proof-shots).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const SITES = ['https://bb.school.test', 'https://learn.other.test', 'https://bb.third.test', 'https://bb.fourth.test', 'https://bb.fifth.test'];
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const ROUTES = { '/ultra/courses/_101_1/discussion/_9_1': 'ultra-writer-discussion.html', '/ultra/courses/_101_1/assessment/_8_1/attempt/_31_1': 'ultra-writer-test.html' };
const out = process.argv[2], shots = process.env.PROOF_SHOTS || '/tmp/gz-writer-proof-shots', lock = require('./check-env.js').lockPath();
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const checks = [], requests = [], errors = [], memory = {}; let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

// The page's world, as scripts/writer-check.js has it: a real Quill on each writable box.
const HARNESS = `(() => {
  for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
    const old = c.querySelector('.ql-editor'), placeholder = old.getAttribute('data-placeholder'), role = old.getAttribute('role');
    c.innerHTML = '';
    const q = new Quill(c, { placeholder });
    if (role) q.root.setAttribute('role', role);
    const form = c.closest('form'), attempt = c.closest('bb-assignment-attempt-authoring-panel, bb-attempt-canvas');
    const buttons = attempt ? [...document.querySelectorAll('[data-analytics-id*="footer"], [analytics-id*="footer"]')] : [...(form ? form.querySelectorAll('.js-text-editor-save, .draft-button') : [])];
    const sync = () => { const t = q.getText().trim(); for (const b of buttons) b.disabled = !t; };
    q.on('text-change', sync); sync();
  }
})();`;

// The browser's processes (the one holding the profile and every process under it): RSS in MB, in all and per process.
const rss = (profile) => {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' }).split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean)
    .map((m) => ({ pid: +m[1], ppid: +m[2], mb: +m[3] / 1024, cmd: m[4] }));
  const top = rows.find((r) => r.cmd.includes(profile) && !/--type=/.test(r.cmd));
  if (!top) return { total: 0, procs: [] };
  const mine = new Set([top.pid]);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (!mine.has(r.pid) && mine.has(r.ppid)) { mine.add(r.pid); grew = true; } }
  const procs = rows.filter((r) => mine.has(r.pid)).map((r) => ({ pid: r.pid, type: /--type=([\w-]+)/.exec(r.cmd)?.[1] || 'browser', extension: /--extension-process/.test(r.cmd), mb: Math.round(r.mb) }));
  return { total: Math.round(procs.reduce((n, p) => n + p.mb, 0)), procs };
};

(async () => {
  let context, held = false, tmp, ext;
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-proof-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-proof-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-writer-proof-'));
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    const got = crypto.createHash('sha256').update(quill).digest('hex');
    if (got !== QUILL.sha256) throw Error(`Quill 1.3.7 hash mismatch: ${got}`);

    ext = require('./check-env.js').staged(root, SITES.map((s) => `${s}/*`));
    const profile = path.join(tmp, 'profile');
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(15000);
    const grades = JSON.parse(fixture('ultra-writer-gradebook.json'));
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      requests.push({ method: req.method(), origin: u.origin, path: u.pathname });
      if (req.method() !== 'GET' || !SITES.includes(u.origin)) return r.abort();
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      if (req.isNavigationRequest() && ROUTES[u.pathname]) return r.fulfill({ contentType: 'text/html', body: fixture(ROUTES[u.pathname]).replace('<head>', '<head><base href="/ultra/">').replace('</body>', '<script src="/gz-check/quill.js"></script><script src="/gz-check/harness.js"></script></body>') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      let data = { results: [] };
      if (u.pathname.endsWith('/users/me')) data = { id: '_42_1', userName: 'synthetic' };
      else if (u.pathname.includes('/gradebook/grades')) data = grades;
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
    await worker.evaluate(async ({ settings, sites }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: sites }); }, { settings, sites: SITES });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();

    const open = async (url) => {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
      await p.goto(url);
      await p.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
      return p;
    };
    const box = async (p, kind) => {
      let el;
      try { el = await until(async () => { const h = await p.$(`iframe.gz-writer[data-gz-writer-frame="${kind}"]`); return h && await h.evaluate((f) => !f.style.opacity && f.offsetHeight > 100) && h; }, `${kind} frame shown`); } catch (e) {
        // What the page holds when a box never shows: its frames, their state, and the errors so far.
        console.error('state', JSON.stringify(await p.evaluate(() => ({ url: location.href, frames: [...document.querySelectorAll('iframe.gz-writer')].map((f) => ({ kind: f.dataset.gzWriterFrame, opacity: f.style.opacity, h: f.offsetHeight, src: f.src.slice(0, 40) })), editors: document.querySelectorAll('.ql-editor').length, marked: document.querySelectorAll('[data-gz-writer]').length })).catch((x) => String(x))), errors.slice(-5));
        throw e;
      }
      const fr = await until(() => el.contentFrame(), `${kind} frame document`);
      await until(() => fr.evaluate(() => !!document.querySelector('.ProseMirror')), `${kind} editor in its frame`);
      fr.on?.('pageerror', (e) => errors.push(`frame: ${e.message}`));
      return { el, fr };
    };
    const text = (fr) => fr.evaluate(() => GZ_WRITER_FRAME.editor().text());
    const stats = (fr) => fr.evaluate(() => GZ_WRITER_PROOF.stats());
    const settle = (fr, needle, cls = 'gz-iss', ms) => until(() => fr.evaluate(({ needle, cls }) => [...document.querySelectorAll(`.ProseMirror .${cls}`)].some((s) => s.textContent === needle), { needle, cls }), `${cls} on "${needle}"`, ms);
    const shot = async (target, name) => { fs.mkdirSync(shots, { recursive: true }); await pause(250); const f = path.join(shots, name); await target.screenshot({ path: f }); return f; };
    const saved = {};
    const discussion = (site) => `${site}/ultra/courses/_101_1/discussion/_9_1`;

    // ---- one box: lazy start, autocorrect and its undo ----
    const pages = [], frames = [];
    let p = await open(discussion(SITES[0]));
    let reply = await box(p, 'reply');
    pages.push(p); frames.push(reply);
    check(await reply.fr.evaluate(() => typeof GZ_WRITER_PROOF.mode === 'undefined'), 'no Harper and no worker before a box is focused');
    await pause(1500);
    memory.framesOpen = rss(profile);
    await reply.fr.click('.ProseMirror');
    await p.keyboard.type('Morrison is less interested in nostalgea than in what teh ', { delay: 12 });
    check((await text(reply.fr)).endsWith('in what the '), 'teh → the on the space after it (the typo table)');
    check(await reply.fr.evaluate(() => { const f = document.querySelector('.gp-fix'); return !f.hidden && f.querySelector('s').textContent === 'teh' && /→ the/.test(f.textContent) && /Undo/.test(f.textContent); }), 'the autocorrect pop shows "teh → the" with Undo');
    check(await reply.fr.evaluate(() => [...document.querySelectorAll('.ProseMirror .gz-ac')].some((s) => s.textContent === 'the')), 'the fix carries the green dotted mark');
    saved.autocorrect = await shot(reply.el, 'proof-autocorrect.png');
    await p.keyboard.press(`${MOD}+z`);
    const undone = await text(reply.fr);
    check(undone === 'Morrison is less interested in nostalgea than in what teh ', `${MOD === 'Meta' ? '⌘' : 'Ctrl+'}Z right after undoes the fix only, in one step (${JSON.stringify(undone)})`);
    check(await reply.fr.evaluate(() => document.querySelector('.gp-fix').hidden), 'and the pop goes');
    await p.keyboard.type('town chooses to forget.', { delay: 12 });
    check((await text(reply.fr)).includes('what teh town'), 'a fix taken back stays as typed');
    check(await reply.fr.evaluate(() => GZ_WRITER_PROOF.mode === 'shared'), 'the frame reached Harper through a SharedWorker');

    // ---- underlines, the card by mouse and by keyboard ----
    await settle(reply.fr, 'nostalgea');
    await settle(reply.fr, 'teh');
    check(await reply.fr.evaluate(() => { const s = [...document.querySelectorAll('.ProseMirror .gz-iss')].find((x) => x.textContent === 'nostalgea'); const c = getComputedStyle(s); return s.classList.contains('gz-iss-sp') && c.textDecorationStyle === 'wavy'; }), 'spelling underlined red wavy');
    check(await reply.fr.evaluate(() => GZ_WRITER_PROOF.lastMs < 50), 'Harper lints a paragraph in under 50 ms');
    check(await reply.fr.evaluate(() => { const b = document.querySelector('.slot[data-slot="issues"] .gp-count'); return b && /2/.test(b.textContent) && b.querySelector('.dot.gp-sp'); }), 'the bar counts the issues with a red dot');
    await reply.fr.hover('.ProseMirror .gz-iss-sp >> nth=0');
    await until(() => reply.fr.evaluate(() => !document.querySelector('.gp-card').hidden), 'hover card');
    check(await reply.fr.evaluate(() => { const c = document.querySelector('.gp-card'), chips = [...c.querySelectorAll('.chip')]; return /Spelling/.test(c.querySelector('.lbl').textContent) && c.querySelector('.lbl .dot.gp-sp') && chips[0]?.textContent === 'nostalgia' && !chips[0].classList.contains('alt') && chips[1]?.classList.contains('alt') && /Ignore/.test(c.querySelector('.acts').textContent) && /Add to dictionary/.test(c.querySelector('.acts').textContent); }), 'hovering shows the card: Spelling, "nostalgia" first, then the others, Ignore, Add to dictionary');
    check(await reply.fr.evaluate(() => { const ids = new Set(GZ_WRITER_ISSUES.list().map((i) => i.id)), spans = [...document.querySelectorAll('.ProseMirror .gz-iss')]; return spans.every((s) => ids.has(s.dataset.issue)) && spans.filter((s) => s.textContent === 'nostalgea').length === 1 && !spans.some((s) => s.querySelector('.gz-iss')); }), 'each underline is one live issue, drawn once');
    saved.card = await shot(reply.el, 'proof-card.png');
    await reply.fr.click('.gp-card .chip >> nth=0');
    check((await text(reply.fr)).startsWith('Morrison is less interested in nostalgia than'), 'a chip puts its suggestion in');
    check(await reply.fr.evaluate(() => document.activeElement?.closest('.ProseMirror')), 'and the caret stays in the editor');
    // Keyboard: Alt+Enter on "teh", arrows, Escape, Enter.
    await reply.fr.evaluate(() => { const v = GZ_WRITER_FRAME.editor().view, t = GZ_WRITER_FRAME.editor().text(), i = t.indexOf('teh'); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, 2 + i))); v.focus(); });
    await p.keyboard.press('Alt+Enter');
    await until(() => reply.fr.evaluate(() => !document.querySelector('.gp-card').hidden && document.activeElement?.classList.contains('chip')), 'card from the keyboard');
    check(await reply.fr.evaluate(() => document.activeElement.textContent === 'the'), 'Alt+Enter opens the card at the caret with its first suggestion focused');
    await p.keyboard.press('ArrowRight');
    check(await reply.fr.evaluate(() => document.activeElement.textContent === 'Ignore'), 'arrows move through the card');
    await p.keyboard.press('Escape');
    check(await reply.fr.evaluate(() => document.querySelector('.gp-card').hidden && document.activeElement?.closest('.ProseMirror')), 'Escape closes it, back in the text');
    await p.keyboard.press('Alt+Enter');
    await until(() => reply.fr.evaluate(() => document.activeElement?.classList.contains('chip')), 'card again');
    await p.keyboard.press('Enter');
    check((await text(reply.fr)).includes('in what the town'), 'Enter on a suggestion applies it');

    // ---- Harper's own sure fix as you type, and a name added to the dictionary ----
    await reply.fr.click('.ProseMirror');
    await p.keyboard.press('End');
    await p.keyboard.type(' this time Sethe keeps her rememory', { delay: 12 });
    await until(async () => (await text(reply.fr)).includes('forget. This time'), 'Harper capitalises the sentence start');
    check(await reply.fr.evaluate(() => [...document.querySelectorAll('.ProseMirror .gz-ac')].some((s) => s.textContent === 'This')), 'Harper\'s sure fix (Capitalization, one suggestion) went in as autocorrect, marked');
    await settle(reply.fr, 'rememory');
    check(await reply.fr.evaluate(() => ![...document.querySelectorAll('.ProseMirror .gz-iss')].some((s) => s.textContent === 'Sethe')), 'a Capitalised word mid-sentence reads as a name: never a misspelling');
    await reply.fr.evaluate(() => { const v = GZ_WRITER_FRAME.editor().view, t = GZ_WRITER_FRAME.editor().text(), i = t.indexOf('rememory'); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, 3 + i))); v.focus(); });
    await p.keyboard.press('Alt+Enter');
    await until(() => reply.fr.evaluate(() => document.activeElement?.closest('.gp-card')), 'card for rememory');
    await until(async () => { await p.keyboard.press('ArrowRight'); return reply.fr.evaluate(() => document.activeElement.textContent === 'Add to dictionary'); }, 'to Add to dictionary', 3000);
    await p.keyboard.press('Enter');
    await until(() => reply.fr.evaluate(() => ![...document.querySelectorAll('.ProseMirror .gz-iss')].some((s) => s.textContent === 'rememory')), 'rememory unflagged');
    check(await until(async () => (await worker.evaluate(() => chrome.storage.local.get('writerWords'))).writerWords?.includes('rememory'), 'dictionary persisted'), 'Add to dictionary keeps the word in chrome.storage.local writerWords');
    memory.oneTab = rss(profile);

    // ---- more tabs on other schools: one worker ----
    for (const site of [SITES[1], SITES[0], SITES[2], SITES[3], SITES[4]]) {
      const q = await open(discussion(site));
      const b = await box(q, 'reply');
      await q.bringToFront();
      await until(async () => { await b.fr.click('.ProseMirror'); return b.fr.evaluate(() => !!document.activeElement?.closest('.ProseMirror')); }, 'focus in the new box');
      await q.keyboard.type('Sethe and Paul D argue about the rivver and rememory.', { delay: 4 });
      await until(async () => (await text(b.fr)) === 'Sethe and Paul D argue about the rivver and rememory.', 'typed in the new box');
      pages.push(q); frames.push(b);
    }
    try { for (const b of frames.slice(1)) await settle(b.fr, 'rivver', 'gz-iss', 30000); } catch (e) {
      for (const b of frames) console.error('state', JSON.stringify(await b.fr.evaluate(() => ({ t: GZ_WRITER_FRAME.editor().text(), mode: GZ_WRITER_PROOF.mode, ms: GZ_WRITER_PROOF.lastMs, issues: GZ_WRITER_ISSUES.list().map((i) => i.text), dom: [...document.querySelectorAll('.gz-iss')].map((x) => x.textContent), vis: document.visibilityState }))));
      throw e;
    }
    check(await frames[1].fr.evaluate(() => ![...document.querySelectorAll('.ProseMirror .gz-iss')].some((s) => s.textContent === 'rememory')), 'a word added at one school is known in a box at another');
    const all = [];
    for (const b of frames) all.push(await stats(b.fr));
    check(new Set(all.map((s) => s.worker)).size === 1, `one Harper worker for ${frames.length} boxes in ${pages.length} tabs on ${SITES.length} schools (worker ${all[0].worker.slice(0, 8)}…)`);
    check(all[0].ports >= frames.length && all.every((s) => s.loads === 1), `its linter loaded once (${all[0].ports} frames connected, ${all[0].lints} lints)`);
    // The AI stream's decide hook rules on a fix that isn't sure ("Their going": Grammar), here with an object verdict.
    const other = frames[1];
    await other.fr.evaluate(() => { window.__asked = []; GZ_WRITER_PROOF.decide = async (a) => { __asked.push(a); return { verdict: 'apply', choice: 0 }; }; });
    await pages[1].bringToFront();
    await other.fr.click('.ProseMirror');
    await pages[1].keyboard.press('End');
    await pages[1].keyboard.type(' Their going to the river tomorrow.', { delay: 12 });
    await until(async () => (await text(other.fr)).includes("They're going to the river"), 'decide applied');
    check(await other.fr.evaluate(() => { const a = __asked.find((x) => x.suggestions[0] === "They're"); return a && a.text.slice(a.from, a.to) === 'Their' && typeof a.context === 'object' && __asked.every((x) => x.to < x.text.length && !/\p{L}/u.test(x.text.charAt(x.to))); }), 'decide gets the paragraph, the offsets, the suggestions and the context; { verdict: \'apply\', choice } puts the choice in as autocorrect; never asked about a word still being typed');
    check(await other.fr.evaluate(() => [...document.querySelectorAll('.ProseMirror .gz-ac')].some((s) => s.textContent === "They're")), 'marked like any autocorrect');
    await pause(1500);
    memory.sixTabs = rss(profile);

    // ---- idle: the worker closes, the next lint brings it back ----
    await frames[0].fr.evaluate(() => { const w = new SharedWorker('lib/harper/shared.js', { type: 'module', name: 'glaze-harper' }); w.port.start(); w.port.postMessage({ op: 'idle', ms: 2000 }); });
    await pause(4000);
    memory.idle = rss(profile);
    await p.bringToFront();
    await reply.fr.click('.ProseMirror');
    await p.keyboard.press('End');
    await p.keyboard.type(' Then Beloved arives.', { delay: 12 });
    await settle(reply.fr, 'arives');
    check((await text(reply.fr)).endsWith('Beloved arives.'), 'a Typo whose one suggestion splits the word ("a rives") is only underlined, never applied');
    const back = await stats(reply.fr);
    check(back.worker !== all[0].worker && back.loads === 1, 'after idle the worker closed; the next lint started a new one and the underlines came back');
    check(await reply.fr.evaluate(() => GZ_WRITER_FRAME.editor().text().includes('her rememory Then Beloved') && ![...document.querySelectorAll('.ProseMirror .gz-iss')].some((s) => s.textContent === 'rememory')), 'the new worker got the dictionary back: rememory stays unflagged');
    saved.compose = await shot(reply.el, 'proof-compose.png');

    // ---- Settings → Writer: proofing, dialect and each autocorrect class, off and on ----
    // Set before the frame loads (all off), then each switched live through storage.onChanged.
    const W0 = G.GZ_SANITIZE({}).writer, setW = (w) => worker.evaluate((w) => chrome.storage.sync.set({ writer: w }), G.GZ_SANITIZE({ writer: w }).writer);
    const OFF = { ...W0, proofing: false, autocorrect: { typos: false, capitalI: false, doubles: false, smart: false } };
    // A reply typed above is backed up (enhance.drafts); its offer would hold the box: those copies go first.
    await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('draft:'))); });
    await setW(OFF);
    const sp = await open(discussion(SITES[0])), sb = await box(sp, 'reply');
    await sp.bringToFront();
    const last = () => sb.fr.evaluate(() => GZ_WRITER_FRAME.editor().view.state.doc.lastChild.textContent);
    const line = async (typed) => { await sb.fr.click('.ProseMirror'); await sp.keyboard.press(`${MOD}+End`); if (await last()) await sp.keyboard.press('Enter'); await sp.keyboard.type(typed, { delay: 12 }); await pause(250); return last(); };
    const SAMPLE = 'so teh book, i think the the end  now "q" -- x ';
    const offLine = await line(SAMPLE);
    assert.equal(offLine, SAMPLE, 'all autocorrect off before the frame loads: typos, i, doubles, double spaces, quotes and dashes stay as typed');
    check(true, 'all autocorrect off before the frame loads: typos, i, doubles, double spaces, quotes and dashes stay as typed');
    await sp.keyboard.type('nostalgea. ', { delay: 12 });
    await pause(2500);
    check(await sb.fr.evaluate(() => GZ_WRITER_ISSUES.list().length === 0 && !document.querySelector('.ProseMirror .gz-iss') && typeof GZ_WRITER_PROOF.mode === 'undefined'), 'proofing off before the frame loads: no Harper, nothing underlined');
    await setW({ ...OFF, proofing: true });
    await settle(sb.fr, 'nostalgea', 'gz-iss', 20000);
    check(true, 'proofing switched on live: the document is read and underlined');
    await setW(OFF);
    await until(() => sb.fr.evaluate(() => GZ_WRITER_ISSUES.list().length === 0 && !document.querySelector('.ProseMirror .gz-iss')), 'underlines gone');
    check(true, 'proofing switched off live: the underlines go');
    for (const [cls, typed, off, on] of [
      ['typos', 'so teh ', 'so teh ', 'so the '],
      ['capitalI', 'so i ', 'so i ', 'so I '],
      ['doubles', 'so the the end  ', 'so the the end  ', 'so the end '],
      ['smart', 'so "q" -- it\'s ', 'so "q" -- it\'s ', 'so “q” — it’s '],
    ]) {
      await setW({ ...OFF, autocorrect: { ...OFF.autocorrect, [cls]: false } });
      await pause(200);
      check(await line(typed) === off, `${cls} off: ${JSON.stringify(off)}`);
      await setW({ ...OFF, autocorrect: { ...OFF.autocorrect, [cls]: true } });
      await pause(200);
      const got = await line(typed);
      check(got === on, `${cls} switched on live: ${JSON.stringify(got)}`);
    }
    // The dialect reaches the one Harper worker; British spelling stops being flagged in British English.
    await setW({ ...W0, dialect: 'en-US' });
    await line('The colour faded. ');
    await settle(sb.fr, 'colour', 'gz-iss', 20000);
    await setW({ ...W0, dialect: 'en-GB' });
    await until(async () => (await stats(sb.fr)).dialect === 'en-GB', 'worker in British English', 10000);
    await until(() => sb.fr.evaluate(() => ![...document.querySelectorAll('.ProseMirror .gz-iss')].some((s) => s.textContent === 'colour')), 'colour unflagged in British English', 20000);
    check(true, 'dialect switched live to British English: the worker says so and "colour" is no longer flagged');
    await setW(W0);
    await sp.close();

    // ---- a test's box is proofed too ----
    const tp = await open(`${SITES[0]}/ultra/courses/_101_1/assessment/_8_1/attempt/_31_1`);
    const essay = await box(tp, 'test');
    await essay.fr.click('.ProseMirror');
    await tp.keyboard.type('i think teh answer is two.', { delay: 12 });
    check((await text(essay.fr)) === 'I think the answer is two.', 'a test\'s box still gets local autocorrect (i → I, teh → the)');
    await tp.keyboard.press(`${MOD}+a`);
    await tp.keyboard.type('unfortunatly ', { delay: 12 });
    check((await text(essay.fr)) === 'unfortunately ', 'a long curated typo is corrected');
    check(await essay.fr.evaluate(() => { const p = document.querySelector('.gp-fix'); return p.scrollWidth <= p.clientWidth && p.getBoundingClientRect().right <= innerWidth; }), 'a long autocorrect and its Undo fit inside the pop');
    await tp.close();

    check(errors.length === 0, `no page or frame errors (${errors.join('; ')})`);
    check(requests.every((r) => r.method === 'GET' && SITES.includes(r.origin)), 'every LMS request is a synthetic GET');
    passed = true;
    const harperMB = (a, b) => b.total - a.total;
    console.log(JSON.stringify({ checks: checks.length, shots: saved, memoryMB: {
      framesOpenNoHarper: memory.framesOpen.total, harperOneTab: memory.oneTab.total, sixTabs: memory.sixTabs.total, afterIdleClose: memory.idle.total,
      harperDelta1: harperMB(memory.framesOpen, memory.oneTab), fiveMoreTabs: harperMB(memory.oneTab, memory.sixTabs), releasedOnIdle: harperMB(memory.idle, memory.sixTabs),
      biggestOneTab: memory.oneTab.procs.sort((a, b) => b.mb - a.mb).slice(0, 4), biggestSixTabs: memory.sixTabs.procs.sort((a, b) => b.mb - a.mb).slice(0, 4),
    } }, null, 2));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, memory, requests: requests.length, errors }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), e.stack + '\n'); } process.exitCode = 1; });
