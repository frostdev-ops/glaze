// Does Glaze Writer open a Word file as Word lays it out? Each .docx in the corpus is opened in Microsoft Word on this
// Mac (through AppleScript, as scripts/writer-word-fidelity.js does) and saved as PDF, and imported into a paper in the
// real unpacked extension on the synthetic assignment attempt (⋯ → Import… → Open in Writer). Both sides' pages are read
// as lines (Word's from pdftotext's boxes, Writer's from the editor's carets), compared page by page, and drawn side by
// side. A page passes when the counts agree and it starts within one line of where Word starts it (the owner's accepted
// tolerance). --export also saves the .docx Writer makes of each import, opens that in Word and compares it with the
// original's PDF: the round trip.
// Word: only the copies this script opens are touched (found by their own unique names, closed unsaved); Word quits only
// if this script started it. Files go in a temporary folder inside Word's container, so the sandboxed app needs no prompt.
// Browser: headless, GETs only, synthetic; no account or outside network from the browser.
// NODE_PATH=<playwright> nice -n 10 lockf -k <lock> node scripts/writer-import-fidelity.js [--export] [--word-only]
//   [--dump] [--out <dir>] [file.docx …]   (default corpus: test/fixtures/writer-docx-import.js; default out:
//   ~/Projects/glaze-plans/writer/parity). --dump prints each block's box as the browser drew it (pt from its page's top).
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const args = process.argv.slice(2), flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const option = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const roundTrip = flag('--export'), wordOnly = flag('--word-only'), dump = flag('--dump');
const out = path.resolve(option('--out') || path.join(os.homedir(), 'Projects/glaze-plans/writer/parity'));
const root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const WORD = '/Applications/Microsoft Word.app';
const words = (s) => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[ \s]+/g, ' ').trim();
const flat = (s) => words(s).replace(/ /g, '');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the corpus: files named on the command line, else the synthetic fixtures written out
const corpus = () => {
  fs.mkdirSync(path.join(out, 'files'), { recursive: true });
  if (args.length) return args.map((f) => ({ id: path.basename(f, '.docx').replace(/[^\w-]+/g, '_'), file: path.resolve(f), private: true }));
  const FX = require('../test/fixtures/writer-docx-import.js');
  return Object.keys(FX.files).map((id) => {
    const file = path.join(out, 'files', `${id}.docx`);
    fs.writeFileSync(file, FX.bytes(id));
    return { id, file };
  });
};

// ---- Word's side: the PDF, then its lines by page from pdftotext's boxes (pt from the page's top)
const osa = (script) => execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 180000 }).trim();
const running = () => { try { execFileSync('pgrep', ['-x', 'Microsoft Word']); return true; } catch { return false; } };
const wordPDFs = (items) => {
  if (!fs.existsSync(WORD)) throw Error('Microsoft Word is not installed');
  const box = path.join(os.homedir(), 'Library/Containers/com.microsoft.Word/Data/tmp');
  fs.mkdirSync(box, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(box, 'glaze-import-'));
  const started = !running();
  try {
    for (const it of items) {
      // A name no window of the owner's can have: the copy is found and closed by it, never by "active document".
      const name = `gz-${crypto.randomBytes(4).toString('hex')}-${it.id}`.slice(0, 60);
      const docx = path.join(tmp, `${name}.docx`), pdf = path.join(tmp, `${name}.pdf`);
      fs.copyFileSync(it.source || it.file, docx);
      const caption = osa(`tell application "Microsoft Word"
  set was to display alerts
  set display alerts to alerts none
  set mine to {"${name}.docx", "${name}.pdf"}
  try
    open POSIX file "${docx}"
    if (name of every document) does not contain "${name}.docx" then error "the copy did not open"
    set d to document "${name}.docx"
    set c to name of d
    try
      set c to caption of window 1 of d
    end try
    save as d file name "${pdf}" file format format PDF
  on error e
    repeat with n in mine
      if (name of every document) contains (n as text) then close document (n as text) saving no
    end repeat
    set display alerts to was
    error e
  end try
  repeat with n in mine
    if (name of every document) contains (n as text) then close document (n as text) saving no
  end repeat
  set display alerts to was
  return c
end tell`);
      it.compat = /compatibility mode/i.test(caption);
      const dest = path.join(out, `${it.id}${it.leg ? `-${it.leg}` : ''}-word.pdf`);
      fs.copyFileSync(pdf, dest);
      it.pdf = dest;
    }
  } finally {
    try { if (started) osa('tell application "Microsoft Word" to quit saving no'); } catch { /* already gone */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};
const pdfLines = (pdf) => {
  const html = execFileSync('pdftotext', ['-bbox-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const num = (s, k) => +new RegExp(`${k}="([\\d.]+)"`).exec(s)[1];
  const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
  return [...html.matchAll(/<page ([^>]*)>([\s\S]*?)<\/page>/g)].map(([, attrs, body]) => {
    const lines = [...body.matchAll(/<line ([^>]*)>([\s\S]*?)<\/line>/g)].map(([, a, inner]) => ({
      text: words([...inner.matchAll(/<word [^>]*>([^<]*)<\/word>/g)].map((m) => dec(m[1])).join(' ')), top: num(a, 'yMin'), bottom: num(a, 'yMax'), left: num(a, 'xMin'),
    }));
    // One visual line can come as several boxes (a tab's gap): joined by their top.
    lines.sort((a, b) => a.top - b.top || a.left - b.left);
    const joined = [];
    for (const l of lines) { const j = joined.at(-1); if (j && Math.abs(j.top - l.top) < 2) { j.text = words(`${j.text} ${l.text}`); j.bottom = Math.max(j.bottom, l.bottom); } else joined.push({ ...l }); }
    return { width: num(attrs, 'width'), height: num(attrs, 'height'), lines: joined };
  });
};
// A page's lines split into header, body and footer by the margins (pt).
const regions = (page, m) => ({
  header: page.lines.filter((l) => l.bottom <= m.top + 1).map((l) => l.text),
  body: page.lines.filter((l) => l.bottom > m.top + 1 && l.top < page.height - m.bottom - 1),
  footer: page.lines.filter((l) => l.top >= page.height - m.bottom - 1).map((l) => l.text),
});

// ---- Writer's side: the extension on the attempt fixture, each file imported, its pages read and drawn
const writerPages = async (items) => {
  const { chromium } = require('playwright');
  const env = require('./check-env.js'), FX = require('../test/fixtures/writer-paper-fixtures.js');
  const site = 'https://bb.school.test', ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
  const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
  const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
  const until = async (fn, label, ms = 20000) => {
    const start = Date.now(); let last;
    while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
    throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
  };
  const HARNESS = `(() => {
    for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
      const old = c.querySelector('.ql-editor'), id = old.id;
      c.innerHTML = '';
      const q = new Quill(c, {});
      if (id) q.root.id = id;
      q.root.setAttribute('role', 'textbox');
    }
  })();`;
  const lock = env.lockPath(), errors = [];
  let context, held = false, tmp;
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-import-fidelity\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-import-fidelity] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-import-'));
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    if (crypto.createHash('sha256').update(quill).digest('hex') !== QUILL.sha256) throw Error('Quill 1.3.7 hash mismatch');
    const ext = env.staged(root, [`${site}/*`], tmp);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...env.chromeLaunch(), headless: true, viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(20000);
    const grades = JSON.parse(fixture('ultra-writer-gradebook.json')), members = JSON.parse(fixture('ultra-memberships.json'));
    members.results = members.results.map((m) => (m.courseId === '_101_1' ? { ...m, course: { ...m.course, name: FX.context.course, displayName: FX.context.course } } : m));
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:' || u.protocol === 'blob:' || u.protocol === 'data:') return r.continue();
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
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
    await worker.evaluate(async ({ settings, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] }); }, { settings, site });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await p.goto(`${site}${ATTEMPT}`);
    const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity && f.offsetHeight > 500) && x; }, 'paper frame shown');
    const fr = await until(() => el.contentFrame(), 'frame document');
    await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key() && document.querySelectorAll('.gp-sheet').length > 0), 'paper loaded');
    const settle = async () => { for (let i = 0; i < 3; i++) { await pause(200); await fr.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); } };
    for (const it of items) {
      // ⋯ → Import…, the file, and Open in Writer when the assignment's card asks.
      const before = await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc);
      // The menu: clicked until it opens (a click while the paper is still settling can be lost).
      await until(async () => {
        if (!await fr.evaluate(() => !!document.querySelector('.gp-menu.gp-versions'))) await fr.click('.gp-status button:last-child');
        return fr.evaluate(() => [...document.querySelectorAll('.gp-menu [role=menuitem]')].some((b) => /^Import/.test(b.textContent)));
      }, 'Import… in the menu');
      const [chooser] = await Promise.all([p.waitForEvent('filechooser'), fr.evaluate(() => [...document.querySelectorAll('.gp-menu [role=menuitem]')].find((b) => /^Import/.test(b.textContent)).click())]);
      await chooser.setFiles(it.file);
      const card = await until(() => fr.evaluate(() => (document.querySelector('.gi-layer[data-open] .gi-default') ? 'card' : document.querySelector('.gp-toast') ? 'direct' : '')), 'the import card or toast');
      if (card === 'card') await fr.click('.gi-layer[data-open] .gi-default');
      await until(() => fr.evaluate((b) => GZ_WRITER_PAPER.current().editor.view.state.doc !== b && !GZ_WRITER_PAPER.current().importing(), before), `${it.id} imported`, 30000).catch(async (e) => { throw Error(`${e.message} (${(await fr.evaluate(() => document.querySelector('.gp-toast')?.textContent || '')) || errors.join('; ')})`); });
      await settle();
      await fr.evaluate(() => GZ_WRITER_PAPER.current().zoom(1));
      await settle();
      it.toast = await fr.evaluate(() => document.querySelector('.gp-toast span')?.textContent || '');
      Object.assign(it, await fr.evaluate(() => {
        const api = GZ_WRITER_PAPER.current(), v = api.editor.view, f = api.look ? api.look() : api.format(), geo = GZ_WRITER_STYLES.geometry(f);
        const dom = v.dom.getBoundingClientRect(), scale = dom.height / v.dom.offsetHeight, stride = geo.height + 26.4;
        const sheets = [...document.querySelectorAll('.gp-sheet')];
        const pages = sheets.map(() => []);
        // Each textblock's lines: positions grouped by their caret's top, in page px from the page's top.
        v.state.doc.descendants((n, pos) => {
          if (!n.isTextblock) return true;
          let cur = null;
          const end = pos + n.nodeSize - 1;
          for (let q = pos + 1; q < end; q++) {
            const c = v.coordsAtPos(q, 1), top = (c.top - dom.top) / scale;
            if (!cur || Math.abs(top - cur.y) > 3) {
              cur = { y: top, from: q, to: q + 1 };
              const k = Math.max(0, Math.min(pages.length - 1, Math.floor(top / stride)));
              pages[k].push(cur);
            } else cur.to = q + 1;
          }
          return false;
        });
        const text = (l) => v.state.doc.textBetween(l.from, l.to, ' ', (x) => (x.type.name === 'footnote_ref' ? '' : '')).replace(/\t/g, ' ');
        return {
          margins: { top: geo.top * 0.75, bottom: geo.bottom * 0.75 }, pageSize: { width: geo.width * 0.75, height: geo.height * 0.75 },
          writer: pages.map((ls, i) => ({ header: [...sheets[i].querySelectorAll('.gp-hdr')].map((h) => h.textContent).filter((x) => x.trim()), lines: ls.map((l) => ({ text: text(l), top: (l.y - i * stride) * 0.75 })).filter((l) => l.text.trim()) })),
        };
      }));
      for (const l of it.writer.flatMap((pg) => pg.lines)) l.text = words(l.text);
      if (dump) console.log(`${it.id} blocks:\n${await fr.evaluate(() => {
        const api = GZ_WRITER_PAPER.current(), v = api.editor.view, L = api.look(), g = GZ_WRITER_STYLES.geometry(L), top = v.dom.getBoundingClientRect().top, scale = v.dom.getBoundingClientRect().height / v.dom.offsetHeight, out = [];
        v.state.doc.descendants((n, pos) => {
          if (!n.isTextblock) return n.type.name !== 'table';
          const d = v.nodeDOM(pos), r = d.getBoundingClientRect(), cs = getComputedStyle(d), y = (r.top - top) / scale, page = Math.floor(y / (g.height + 26.4));
          const a = Object.entries(n.attrs).filter(([, x]) => x != null && x !== 0).map(([k, x]) => `${k}=${JSON.stringify(x)}`).join(' ');
          const brs = [...d.querySelectorAll('br, img')].map((x) => { const q = x.getBoundingClientRect(); return `${x.nodeName}.${x.className}@${((q.top - r.top) / scale * 0.75).toFixed(1)}+${(q.height / scale * 0.75).toFixed(1)}`; }).join(' ');
          out.push(`${String(out.length).padStart(3)} p${page + 1}${brs ? ` [${brs}]` : ''} y=${((y - page * (g.height + 26.4)) * 0.75).toFixed(1)} h=${(r.height / scale * 0.75).toFixed(1)} lh=${cs.lineHeight} mt=${cs.marginTop} mb=${cs.marginBottom} ${n.type.name} ${a} "${n.textContent.slice(0, 24)}"`);
          return false;
        });
        const plan = api.layout();
        return `${out.join('\n')}\nplan:\n${plan.blocks.map((b, i) => `${String(i).padStart(3)} ${b.kind} pos=${b.pos} before=${b.before} after=${b.after} slack=${b.slack} lines=${b.lines.join(',')}`).join('\n')}\nbreaks: ${JSON.stringify(plan.breaks)}`;
      })}`);
      // Each page as a picture at 2x, the page alone: no toast, issue underlines or caret over it.
      await fr.evaluate(() => {
        document.querySelector('.gp-toast')?.remove();
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('.gz-iss, .gz-ac, .gp-flow .gp-u-format { text-decoration: none !important; } .gp-cursor { display: none !important; }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        document.activeElement?.blur();
      });
      it.shots = [];
      const sheets = await fr.$$('.gp-sheet');
      for (const [k, sheet] of sheets.entries()) {
        await sheet.scrollIntoViewIfNeeded();
        await settle();
        const file = path.join(out, `${it.id}-writer-p${k + 1}.png`);
        await sheet.screenshot({ path: file });
        it.shots.push(file);
      }
      if (roundTrip) {
        const bytes = await fr.evaluate(async () => Array.from((await GZ_WRITER_PAPER.current().docx()).bytes));
        it.exported = path.join(out, 'files', `${it.id}-writer.docx`);
        fs.writeFileSync(it.exported, Buffer.from(bytes));
      }
    }
    await p.close();
  } catch (e) {
    throw Error(`${e.message}${errors.length ? ` (page errors: ${errors.slice(0, 5).join(' | ')})` : ''}`);
  } finally {
    await context?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(' | ')}`);
};

// ---- the comparison: lines placed in the text they belong to (characters, spaces ignored), page starts in Word's lines
const compare = (word, mine) => {
  const seq = (pages) => { let at = 0; const all = []; pages.forEach((pg, p) => pg.forEach((l, i) => { all.push({ page: p, i, at, text: l.text, top: l.top }); at += flat(l.text).length; })); return all; };
  const W = seq(word), E = seq(mine);
  const lineAt = (all, at) => { let k = 0; while (k + 1 < all.length && all[k + 1].at <= at) k++; return k; };
  const pages = [];
  for (let p = 0; p < Math.max(word.length, mine.length); p++) {
    const w = W.find((l) => l.page === p), e = E.find((l) => l.page === p);
    const wl = word[p] || [], el = mine[p] || [];
    // Where Writer starts this page, as a count of Word's lines from Word's start of it.
    const drift = w && e ? lineAt(W, e.at) - lineAt(W, w.at) : null;
    pages.push({ page: p + 1, word: { first: wl[0]?.text || '', last: wl.at(-1)?.text || '', lines: wl.length, top: wl[0]?.top }, writer: { first: el[0]?.text || '', last: el.at(-1)?.text || '', lines: el.length, top: el[0]?.top }, drift });
  }
  // Lines broken where Word breaks them: same text at the same place.
  const wordAt = new Map(W.map((l) => [`${l.at}|${flat(l.text)}`, l]));
  const same = E.filter((l) => wordAt.has(`${l.at}|${flat(l.text)}`)).length;
  // Vertical drift: each matching line's top against Word's, after lining up the pages' first lines.
  let dy = 0;
  for (const l of E) { const w = wordAt.get(`${l.at}|${flat(l.text)}`); const pw = pages[l.page], base = (pw?.writer.top ?? 0) - (pw?.word.top ?? 0); if (w && w.page === l.page) dy = Math.max(dy, Math.abs(l.top - w.top - base)); }
  return { pages, lines: { same, writer: E.length, word: W.length }, dy: Math.round(dy * 10) / 10 };
};

// Side by side: Word's page (pdftoppm) and Writer's, one picture per page, drawn in a page of the browser.
const sideBySide = async (it) => {
  const { chromium } = require('playwright');
  const prefix = path.join(out, `${it.id}-word`);
  execFileSync('pdftoppm', ['-png', '-r', '144', it.pdf, prefix]);
  const wordShots = fs.readdirSync(out).filter((f) => f.startsWith(`${it.id}-word-`) && f.endsWith('.png')).sort().map((f) => path.join(out, f));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sbs-'));
  const browser = await chromium.launch({ ...require('./check-env.js').chromeLaunch(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1660, height: 1150 } });
    it.sideBySide = [];
    for (let k = 0; k < Math.max(wordShots.length, it.shots.length); k++) {
      const img = (f) => (f ? `<img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">` : '<div class="none">none</div>');
      await page.setContent(`<style>body{margin:0;display:flex;gap:20px;padding:20px;background:#888;font:14px system-ui}figure{margin:0}img,.none{width:800px;height:1035px;background:#fff;display:block}figcaption{color:#fff;padding:4px 0}</style><figure>${img(wordShots[k])}<figcaption>Word, page ${k + 1}</figcaption></figure><figure>${img(it.shots[k])}<figcaption>Writer, page ${k + 1}</figcaption></figure>`);
      const file = path.join(out, `${it.id}-side-p${k + 1}.png`);
      await page.screenshot({ path: file, fullPage: true });
      it.sideBySide.push(file);
    }
  } finally { await browser.close(); fs.rmSync(tmp, { recursive: true, force: true }); for (const f of wordShots) fs.rmSync(f, { force: true }); }
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const items = corpus();
  wordPDFs(items);
  for (const it of items) it.word = pdfLines(it.pdf);
  if (wordOnly) {
    for (const it of items) console.log(`${it.id}: Word ${it.word.length} pages${it.compat ? ' (compatibility mode)' : ''}\n${it.word.map((pg, i) => `  ${i + 1}: ${pg.lines.length} lines; ${pg.lines[0]?.text.slice(0, 60)} … ${pg.lines.at(-1)?.text.slice(0, 60)}`).join('\n')}`);
    return;
  }
  await writerPages(items);
  if (roundTrip) {
    const legs = items.map((it) => ({ id: it.id, leg: 'export', source: it.exported }));
    wordPDFs(legs);
    legs.forEach((l, i) => { items[i].trip = pdfLines(l.pdf); items[i].tripPdf = l.pdf; });
  }
  let ok = true;
  const rows = [];
  for (const it of items) {
    const m = { top: it.margins.top, bottom: it.margins.bottom };
    const body = (pages) => pages.map((pg) => regions(pg, m).body);
    const r = compare(body(it.word), it.writer.map((pg) => pg.lines));
    const headers = it.word.map((pg) => regions(pg, m).header.join(' '));
    const bad = it.word.length !== it.writer.length || r.pages.some((pg) => pg.drift == null || Math.abs(pg.drift) > 1);
    let trip = null;
    if (it.trip) { trip = compare(body(it.word), body(it.trip)); trip.count = it.trip.length; trip.bad = trip.count !== it.word.length || trip.pages.some((pg) => pg.drift == null || Math.abs(pg.drift) > 1); }
    if (bad || trip?.bad) ok = false;
    await sideBySide(it);
    rows.push({ id: it.id, private: !!it.private, wordPages: it.word.length, writerPages: it.writer.length, compat: it.compat, toast: it.toast, ...r, headers: { word: headers, writer: it.writer.map((pg) => pg.header.join(' ')) }, trip: trip && { pages: trip.count, drift: trip.pages.map((pg) => pg.drift), lines: trip.lines, bad: trip.bad }, shots: it.sideBySide, bad });
    console.log(`\n${it.id}: Word ${it.word.length} pages, Writer ${it.writer.length}; ${r.lines.same} of ${r.lines.writer} lines break as Word's (Word ${r.lines.word}); worst vertical drift ${r.dy} pt ${bad ? 'FAIL' : 'ok'}${it.compat ? ' (Word: compatibility mode)' : ''}`);
    console.log('| page | Word first line | Writer first line | drift (lines) | Word header | Writer header |');
    for (const pg of r.pages) console.log(`| ${pg.page} | ${pg.word.first.slice(0, 44)} | ${pg.writer.first.slice(0, 44)} | ${pg.drift ?? '—'} | ${(headers[pg.page - 1] || '').slice(0, 20)} | ${(it.writer[pg.page - 1]?.header.join(' ') || '').slice(0, 20)} |`);
    if (trip) console.log(`round trip: Writer's .docx in Word ${trip.count} pages (original ${it.word.length}), page starts drift ${trip.pages.map((pg) => pg.drift ?? '—').join(', ')}; ${trip.lines.same} of ${trip.lines.writer} lines as the original ${trip.bad ? 'FAIL' : 'ok'}`);
  }
  fs.writeFileSync(path.join(out, `import-fidelity${args.length ? '-private' : ''}.json`), JSON.stringify(rows, null, 2) + '\n');
  console.log(`\nartifacts: ${out}`);
  if (!ok) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
