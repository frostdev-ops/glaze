// Glaze Writer's citations in the real unpacked extension, on the synthetic Ultra discussion (test/fixtures/ultra-writer-*,
// running the real Quill 1.3.7 as scripts/writer-check.js does): the toolbar's Cite, its popover, DOI, ISBN and page
// lookups answered from saved synthetic responses (test/fixtures/writer-cite-*), the citation at the caret and in Ultra's
// Quill, ⋯ Add references, the cite issues, and the paper side panel's Sources view. No outside network from the browser:
// every request is routed here, and anything unexpected is refused and fails the check.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-cite-check.js (under the shared heavy-browser lock)
// WRITER_SHOTS names where the screenshots go (default /tmp/gz-writer-cite-shots).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const site = 'https://bb.school.test';
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const shots = process.env.WRITER_SHOTS || '/tmp/gz-writer-cite-shots';
const NEWS = 'https://news.example.com/2019/03/22/forgetting.html';
const checks = [], requests = [], errors = [], failures = [];
const review = (v, label) => { checks.push(label); if (!v) { failures.push(label); console.log(`FAIL ${label}`); } else console.log(`ok ${label}`); };
let debugFrame;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 10000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  if (debugFrame) console.error(await debugFrame.evaluate(() => ({ pop: document.querySelector('.gz-cite')?.outerHTML.slice(0, 5000), focus: document.activeElement?.outerHTML.slice(0, 200), trace: window.__citeTrace })));
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

// Real Quill on each writable box, with Ultra's enabled-state reproduced (scripts/writer-check.js's harness, cut down).
const HARNESS = `(() => {
  for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
    const old = c.querySelector('.ql-editor'), html = old.innerHTML, id = old.id, placeholder = old.getAttribute('data-placeholder');
    c.innerHTML = '';
    const q = new Quill(c, { placeholder });
    if (id) q.root.id = id;
    if (/[^\\s]/.test(html.replace(/<[^>]*>/g, ''))) q.setContents(q.clipboard.convert(html), 'silent');
  }
  window.__quill = (sel) => document.querySelector(sel).closest('.ql-container').__quill;
})();`;

(async () => {
  let context, tmp, ext, held = false;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-cite-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-cite-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-writer-cite-'));
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    if (crypto.createHash('sha256').update(quill).digest('hex') !== QUILL.sha256) throw Error('Quill 1.3.7 hash mismatch');
    ext = require('./check-env.js').staged(root, [`${site}/*`, `${new URL(NEWS).origin}/*`]);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(10000);
    // The lookups' answers, as doi.org (after its redirect), Open Library and a news site give them.
    const ANSWERS = {
      'https://doi.org/10.5555/gz.2026.001': { status: 302, headers: { location: 'https://api.crossref.org/v1/works/10.5555%2Fgz.2026.001/transform' } },
      'https://api.crossref.org/v1/works/10.5555%2Fgz.2026.001/transform': { contentType: 'application/vnd.citationstyles.csl+json', body: fixture('writer-cite-doi.json') },
      'https://doi.org/10.5555/slow': { contentType: 'application/vnd.citationstyles.csl+json', body: fixture('writer-cite-doi.json') },
      'https://doi.org/10.5555/missing': { status: 404, contentType: 'text/html', body: 'not found' },
      'https://openlibrary.org/api/books?bibkeys=ISBN:9780306406157&format=json&jscmd=data': { contentType: 'application/json', body: fixture('writer-cite-openlibrary.json') },
      'https://news.example.com/redirect': { status: 302, headers: { location: 'https://www.example.com/final' } },
      [NEWS]: { contentType: 'text/html; charset=utf-8', body: fixture('writer-cite-page.html') },
    };
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      requests.push({ method: req.method(), url: u.href, cookie: !!(await req.allHeaders()).cookie, referer: (await req.allHeaders()).referer || '', accept: (await req.allHeaders()).accept || '' });
      if (ANSWERS[u.href] && req.method() === 'GET') { if (u.href.endsWith('/slow')) await pause(500); return r.fulfill({ ...ANSWERS[u.href], headers: { 'access-control-allow-origin': '*', ...ANSWERS[u.href].headers } }); }
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      if (req.isNavigationRequest() && u.pathname === '/ultra/courses/_101_1/discussion/_9_1') return r.fulfill({ contentType: 'text/html', body: fixture('ultra-writer-discussion.html').replace('<head>', '<head><base href="/ultra/">').replace('</body>', '<script src="/gz-check/quill.js"></script><script src="/gz-check/harness.js"></script></body>') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(u.pathname.endsWith('/users/me') ? { id: '_42_1', userName: 'synthetic' } : { results: [] }) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
    await worker.evaluate(async ({ settings, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] }); }, { settings, site });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();

    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    await p.goto(`${site}/ultra/courses/_101_1/discussion/_9_1`);
    const el = await until(async () => { const h = await p.$('iframe.gz-writer[data-gz-writer-frame="post"]'); return h && await h.evaluate((f) => !f.style.opacity && f.offsetHeight > 100) && h; }, 'post frame shown');
    const fr = await until(() => el.contentFrame(), 'frame document'); debugFrame = fr;
    await until(() => fr.evaluate(() => !!document.querySelector('.ProseMirror') && !!globalThis.GZ_WRITER_CITE?.open), 'editor and citations in the frame');
    await fr.evaluate(() => {
      window.__citeTrace = [];
      for (const type of ['pointerdown', 'pointerup', 'click', 'submit', 'focusin', 'resize', 'scroll']) addEventListener(type, (e) => {
        const pop = document.querySelector('.gz-cite'), r = pop.getBoundingClientRect();
        __citeTrace.push({ type, target: e.target?.outerHTML?.slice(0, 180), x: e.clientX, y: e.clientY, top: r.top, bottom: r.bottom, height: innerHeight, scroll: scrollY, hidden: pop.hidden });
        if (__citeTrace.length > 35) __citeTrace.shift();
      }, true);
    });
    fr.page().on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
    const shot = async (target, name) => { fs.mkdirSync(shots, { recursive: true }); await pause(250); const f = path.join(shots, name); await target.screenshot({ path: f }); return f; };
    const saved = {};
    const POST = '.ql-editor[data-placeholder="Type a post"]';
    // The frame has grown to hold the open popover (it asks for that height as the popover changes).
    const settled = () => until(async () => { const need = await fr.evaluate(() => { const p = document.querySelector('.gz-cite'); return p.hidden ? 0 : p.offsetTop + p.offsetHeight + 6; }); return (await el.evaluate((f) => f.getBoundingClientRect().height)) >= need; }, 'frame holds the popover');
    const clickCite = async (selector) => { await settled(); await fr.click(selector); };
    const menuItem = async (label) => {
      await until(async () => { if (await fr.evaluate(() => document.getElementById('menu').hidden)) await fr.click('#more'); return fr.evaluate(() => !document.getElementById('menu').hidden); }, 'menu open');
      await fr.click(`#menu >> text=${label}`);
    };
    const quillText = () => p.evaluate((s) => __quill(s).getText().replace(/\n$/, ''), POST);
    const edText = () => fr.evaluate(() => document.querySelector('.ProseMirror').innerText.replace(/\n+$/, ''));

    // Chrome gives the framed writer page the permissions API; the check answers its prompt (headless has none) and
    // records whether each ask came inside the student's click.
    check(await fr.evaluate(() => typeof chrome.permissions?.request === 'function'), 'Chrome: chrome.permissions.request exists in the writer frame (an extension page framed in the LMS page)');
    await fr.evaluate(() => {
      window.__asks = [];
      chrome.permissions.request = (o) => { __asks.push([o.origins, navigator.userActivation.isActive]); return Promise.resolve(true); };
      window.__issues = [];
      globalThis.GZ_WRITER_ISSUES = { set: (source, list) => __issues.push([source, list]) };
    });

    // ---- the toolbar's Cite and its popover (mockup B's toolbar) ----
    await fr.click('.ProseMirror');
    await p.keyboard.type('Sethe calls the past rememory, a word that refuses the past tense. ', { delay: 2 });
    await fr.evaluate(() => { const t = document.querySelector('.ProseMirror p').firstChild, r = document.createRange(); r.setStart(t, 21); r.setEnd(t, 29); getSelection().removeAllRanges(); getSelection().addRange(r); });
    await until(() => fr.evaluate(() => !document.getElementById('tb').hidden), 'selection toolbar');
    check(await fr.evaluate(() => { const b = document.querySelector('#tb .gzc-cite'); return b?.textContent === 'Cite' && b.classList.contains('on') && b.previousElementSibling?.classList.contains('sepv'); }), 'the selection toolbar ends with Cite after a separator, as the mockup draws it');
    saved.toolbar = await shot(el, 'cite-toolbar.png');
    await fr.click('#tb .gzc-cite');
    await until(() => fr.evaluate(() => !document.querySelector('.gz-cite').hidden && document.activeElement?.classList.contains('gzc-in')), 'popover with the lookup field focused');
    check(await fr.evaluate(() => { const r = document.querySelector('.gz-cite').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1; }), 'the popover fits the frame (the frame grows for it in compose mode)');
    saved.popover = await shot(el, 'cite-popover.png');

    // The host acknowledges frame heights asynchronously. Focusing a taller form must not scroll the frame meanwhile.
    const jump = await fr.evaluate(async () => {
      const F = GZ_WRITER_FRAME, say = F.say, heights = [];
      F.say = (m) => m.type === 'height' ? heights.push(m) : say(m);
      try {
        GZ_WRITER_CITE.add({ type: 'article-journal', title: 'A source to review' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return scrollY;
      } finally { F.say = say; if (heights.length) say(heights.at(-1)); }
    });
    check(jump === 0, `a taller citation form keeps the frame still before its height is acknowledged (scrollY ${jump})`);
    await fr.press('.gz-cite [data-field="title"]', 'Escape');
    await fr.evaluate(() => GZ_WRITER_CITE.open());

    // ---- a DOI ----
    await fr.fill('.gzc-in', 'https://doi.org/10.5555/gz.2026.001');
    await clickCite('.gzc-row .sbtn');
    await until(() => fr.evaluate(() => document.querySelector('.gzc-form [data-field="title"]')?.value === 'Rememory and the River in Beloved'), 'DOI lookup fills the form');
    check(await fr.evaluate(() => document.querySelector('.gzc-type').value === 'article-journal' && document.querySelector('[data-field="author"]').value === 'Okafor, Ana\nPark, Lee' && document.querySelector('[data-field="container-title"]').value === 'Journal of Synthetic Studies'), 'doi.org\'s CSL-JSON becomes a journal article, authors one a line');
    check(requests.some((r) => r.url === 'https://doi.org/10.5555/gz.2026.001' && r.accept === 'application/vnd.citationstyles.csl+json' && !r.cookie && !r.referer), 'the worker asks doi.org for CSL-JSON, with no cookie or referrer');
    check(requests.some((r) => r.url.startsWith('https://api.crossref.org/')), 'an opaque DOI redirect resolves through the fixed Crossref CSL endpoint');
    check(await fr.evaluate(() => __asks.length === 0), 'a DOI asks the browser for no host (doi.org answers every origin)');
    saved.form = await shot(el, 'cite-form.png');
    await fr.fill('.gzc-acts .gzc-page', '115');
    await settled();
    await clickCite('.gzc-acts .sbtn[type="submit"]');
    await until(async () => (await edText()).includes('rememory (Okafor and Park 115), a word'), 'the citation at the selection\'s end');
    await until(async () => (await quillText()).includes('rememory (Okafor and Park 115), a word'), 'the citation in Ultra\'s Quill');
    check(true, 'Cite puts "(Okafor and Park 115)" after the selection, and Ultra\'s Quill has it');

    // ---- a web page: its host asked for in the click, its metadata read from untrusted HTML ----
    await fr.evaluate(() => { const v = document.querySelector('.ProseMirror'); v.focus(); const s = getSelection(); s.selectAllChildren(v.lastElementChild); s.collapseToEnd(); });
    await p.keyboard.type('Forgetting is active', { delay: 2 });
    await fr.evaluate(() => GZ_WRITER_CITE.open());
    await fr.fill('.gzc-in', NEWS);
    await fr.evaluate(() => { document.querySelector('.gzc-row .sbtn').addEventListener('click', () => { window.__clickActive = navigator.userActivation.isActive; }, { once: true }); });
    await clickCite('.gzc-row .sbtn');
    await until(() => fr.evaluate(() => document.querySelector('.gzc-form [data-field="title"]')?.value === 'Can We Get Better at Forgetting?'), 'page lookup fills the form');
    check(await fr.evaluate(() => JSON.stringify(__asks) === JSON.stringify([[['https://news.example.com/*'], true]])), 'a page\'s lookup asks for exactly https://news.example.com/*, inside the click');
    check(await fr.evaluate(() => document.querySelector('.gzc-type').value === 'article-newspaper' && document.querySelector('[data-field="author"]').value === 'Carey, Benedict' && document.querySelector('[data-field="container-title"]').value === 'The Daily Synthetic'), 'JSON-LD NewsArticle, og: and <title> become a news article');
    check(await fr.evaluate(() => window.__ran === undefined) && !requests.some((r) => r.url.includes('tracker.example.com')), 'the fetched page ran no script and loaded nothing (DOMParser, text only)');
    await settled();
    await clickCite('.gzc-acts .sbtn[type="submit"]');
    await until(async () => (await edText()).includes('Forgetting is active (Carey)'), 'page citation inserted');
    check(true, 'a page with no page number cites as "(Carey)"');

    check(await worker.evaluate(async (origin) => {
      await granting(`${origin}/*`);
      const state = await chrome.storage.local.get(['ultra', 'canvas', 'moodle']);
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      return Object.values(state).every((list) => !list?.some((v) => v.includes(origin))) && !scripts.some((s) => s.matches?.some((v) => v.includes(origin)));
    }, new URL(NEWS).origin), 'the actual feature-grant handler never enrolls or registers the citation host as an LMS');
    await fr.evaluate(() => GZ_WRITER_CITE.open());
    await fr.fill('.gzc-in', 'https://news.example.com/redirect');
    await clickCite('.gzc-row .sbtn');
    await until(() => fr.evaluate(() => !!document.querySelector('.gz-cite [data-field="URL"]')), 'opaque page redirect fallback');
    check(await fr.evaluate(() => document.querySelector('.gz-cite .gzc-status').textContent === 'This page redirects. Use its final address or add it manually.') && !requests.some((r) => r.url === 'https://www.example.com/final'), 'an opaque page redirect opens the manual form without touching its unheld destination');
    await clickCite('.gz-cite [data-do="cancel"]');
    await until(() => fr.evaluate(() => !!document.querySelector('.gz-cite .gzc-in')), 'redirect Cancel restores the lookup row');

    // ---- an ISBN, and a failed lookup ----
    await fr.evaluate(() => GZ_WRITER_CITE.open());
    await fr.fill('.gzc-in', '978-0-306-40615-7');
    await fr.press('.gzc-in', 'Enter');
    await until(() => fr.evaluate(() => document.querySelector('.gzc-form [data-field="title"]')?.value === 'The River Keeps: A novel'), 'ISBN lookup fills the form');
    check(await fr.evaluate(() => document.querySelector('[data-field="publisher"]').value === 'Plume' && document.querySelector('[data-field="issued"]').value === '1988'), 'Open Library\'s answer becomes a book');
    await settled();
    await clickCite('.gzc-form [data-do="cancel"]');
    check(await fr.evaluate(() => document.querySelectorAll('.gzc-list .gzc-src').length === 2), 'Cancel goes back to the saved sources (two)');
    await until(() => fr.evaluate(() => !!document.querySelector('.gz-cite .gzc-in')), 'ISBN Cancel restores the lookup row');
    await fr.fill('.gzc-in', '10.5555/missing');
    await clickCite('.gzc-row .sbtn');
    await until(() => fr.evaluate(() => document.querySelector('.gzc-form [data-field="DOI"]')?.value === '10.5555/missing'), 'a missing DOI opens the form with it');
    check(await fr.evaluate(() => /Nothing found/.test(document.querySelector('.gz-cite .gzc-status').textContent)), 'a DOI nobody knows says so and leaves the fields to the student');
    await settled();
    await clickCite('.gzc-form [data-do="cancel"]');
    saved.list = await shot(el, 'cite-sources-list.png');
    await fr.press('.gzc-in', 'Escape');
    check(await fr.evaluate(() => document.querySelector('.gz-cite').hidden), 'Escape closes the popover');

    // ---- the cite issues ----
    await fr.evaluate(() => { const v = document.querySelector('.ProseMirror'); v.focus(); const s = getSelection(); s.selectAllChildren(v.lastElementChild); s.collapseToEnd(); });
    await p.keyboard.type(' as Okafor shows (Okafor, 120).', { delay: 2 });
    await until(() => fr.evaluate(() => __issues.at(-1)?.[1]?.some((i) => i.message === 'MLA citation')), 'cite issues');
    check(await fr.evaluate(() => { const l = __issues.at(-1)[1], i = l.find((x) => x.message === 'MLA citation'); return __issues.at(-1)[0] === 'cite' && i.suggestions[0] === '(Okafor 120)' && i.sure; }), 'the MLA comma becomes a cite issue for GZ_WRITER_ISSUES, fix "(Okafor 120)"');

    // ---- ⋯ Add references ----
    await fr.evaluate(() => GZ_WRITER_CITE.setSources([...GZ_WRITER_CITE.sources(), { type: 'book', title: 'The River Keeps: A novel', author: [{ family: 'Rivera', given: 'Alex' }], publisher: 'Plume', issued: { 'date-parts': [[1988]] } }]));
    await fr.click('#more');
    await until(() => fr.evaluate(() => !document.getElementById('menu').hidden), 'menu');
    check(await fr.evaluate(() => [...document.querySelectorAll('#menu [role="menuitem"]')].map((b) => b.textContent).filter((x) => !x.startsWith('Check with AI')).join('|') === 'Blackboard editor|Sources|Add references'), '⋯ lists Blackboard editor, then Sources and Add references');
    saved.menu = await shot(el, 'cite-menu.png');
    await menuItem('Add references');
    const list = await until(async () => { const t = await quillText(); return t.includes('Works Cited') && t; }, 'reference list in Ultra\'s Quill');
    check(list.endsWith('Works Cited\nCarey, Benedict. “Can We Get Better at Forgetting?” The Daily Synthetic, 22 Mar. 2019, news.example.com/2019/03/22/forgetting.html.\nOkafor, Ana, and Lee Park. “Rememory and the River in Beloved.” Journal of Synthetic Studies, vol. 42, no. 2, June 2019, pp. 113-31, https://doi.org/10.5555/gz.2026.001.\nRivera, Alex. The River Keeps: A novel. Plume, 1988.'), 'Add references appends Works Cited, in order, as paragraphs Ultra\'s Quill keeps');
    check(await p.evaluate((s) => [...document.querySelector(s).querySelectorAll('p em')].map((e) => e.textContent).join('|'), POST) === 'The Daily Synthetic|Beloved|Journal of Synthetic Studies|The River Keeps: A novel', 'titles stay italic in Quill');
    await menuItem('Add references');
    await pause(300);
    check(((await quillText()).match(/Works Cited/g) || []).length === 1, 'Add references again replaces the list instead of adding another');
    saved.references = await shot(el, 'cite-references.png');
    check(await fr.evaluate(() => JSON.stringify(GZ_WRITER_CITE.count()) === JSON.stringify({ cited: 2, total: 3 })), 'GZ_WRITER_CITE.count(): 2 of 3 sources cited (the compose bar\'s pill)');

    // ---- the paper side panel's Sources view (mounted beside the editor, at the panel's 380px) ----
    await el.evaluate((f) => { f.style.height = '760px'; });
    await fr.evaluate(() => {
      const side = document.createElement('aside');
      side.style.cssText = 'position:fixed;top:0;right:0;width:380px;height:100%;overflow:auto;background:var(--gz-surface);border-left:1px solid var(--gz-line);z-index:5';
      document.body.append(side);
      window.__view = GZ_WRITER_CITE.sourcesView(side);
    });
    check(await fr.evaluate(() => document.querySelector('.gzc-view h4').textContent === 'Works Cited' && document.querySelectorAll('.gzc-card').length === 3), 'the Sources view lists the three under Works Cited');
    saved.view = await shot(el, 'cite-sources-view.png');
    await fr.evaluate(() => GZ_WRITER_CITE.use('apa7'));
    check(await fr.evaluate(() => document.querySelector('.gzc-view h4').textContent === 'References' && document.querySelector('.gzc-card .gzc-entry').textContent.startsWith('Carey, B. (2019, March 22).')), 'switching to APA 7 redraws it as References');
    await fr.click('.gzc-card:nth-child(2) .sbtn.ghost2');
    await fr.fill('.gzc-view [data-field="page"]', '113-131');
    await fr.click('.gzc-view .gzc-form [data-do="remove"]');
    check(await fr.evaluate(() => document.querySelectorAll('.gzc-card').length === 2 && GZ_WRITER_CITE.sources().length === 2), 'Edit, then Remove, takes the source out');
    review(await fr.evaluate(() => !!document.querySelector('.gzc-undo button')), 'review: removing a source offers a short Undo');
    if (await fr.evaluate(() => !!document.querySelector('.gzc-undo button'))) {
      await fr.click('.gzc-undo button');
      check(await fr.evaluate(() => GZ_WRITER_CITE.sources().length === 3), 'Undo restores the removed source');
    }
    await fr.click('.gzc-card:first-child .sbtn.ghost2');
    await fr.click('.gzc-card:first-child [data-do="cancel"]');
    review(await fr.evaluate(() => document.activeElement?.closest('.gzc-card')?.dataset.id === document.querySelector('.gzc-card')?.dataset.id), 'review: cancelling a source edit restores keyboard focus');
    await fr.click('.gzc-card:first-child .sbtn.ghost2');
    await fr.evaluate(() => GZ_WRITER_CITE.add({ title: 'Another source' }));
    review(await fr.evaluate(() => { const ids = [...document.querySelectorAll('.gzc-form [id]')].map((n) => n.id); return new Set(ids).size === ids.length; }), 'review: simultaneous citation forms have unique label targets');
    review(await fr.evaluate(() => !!document.querySelector('.gz-cite [aria-label="Close"]')), 'review: the dialog has a keyboard and screen-reader Close control');
    await fr.press('.gz-cite [data-field="title"]', 'Escape');
    await fr.click('.gzc-card:first-child [data-do="cancel"]');
    await fr.evaluate(() => { document.querySelector('aside').hidden = true; GZ_WRITER_CITE.open({ anchor: document.getElementById('more') }); });
    await fr.press('.gzc-in', 'Escape');
    review(await fr.evaluate(() => document.activeElement?.id === 'more'), 'review: Escape returns focus to the dialog invoker');
    await fr.evaluate(() => GZ_WRITER_CITE.open());
    await fr.fill('.gzc-in', '10.5555/slow');
    await clickCite('.gzc-row .sbtn');
    await fr.press('.gzc-in', 'Escape');
    await fr.evaluate(() => GZ_WRITER_CITE.add({ title: 'My manual title' }));
    await pause(750);
    review(await fr.evaluate(() => document.querySelector('.gz-cite [data-field="title"]')?.value === 'My manual title'), 'review: a closed lookup cannot overwrite a newer form');
    await fr.press('.gz-cite [data-field="title"]', 'Escape');
    // Firefox's framed extension page may lack permissions. Page lookup must fall back; public DOI/ISBN still work.
    await fr.evaluate(() => { window.__permissions = chrome.permissions; chrome.permissions = undefined; GZ_WRITER_CITE.open(); });
    await fr.fill('.gzc-in', NEWS);
    await clickCite('.gzc-row .sbtn');
    await until(() => fr.evaluate(() => !!document.querySelector('.gz-cite [data-field="URL"]')), 'no-permissions manual URL form');
    check(await fr.evaluate(() => !!document.querySelector('.gz-cite .gzc-status').textContent && document.querySelector('.gz-cite [data-field="URL"]').value === 'https://news.example.com/2019/03/22/forgetting.html'), 'without permissions, URL lookup opens the manual form with a one-line reason');
    await clickCite('.gz-cite [data-do="cancel"]');
    await until(() => fr.evaluate(() => !!document.querySelector('.gz-cite .gzc-in')), 'Cancel restores the lookup row');
    await fr.fill('.gzc-in', '10.5555/gz.2026.001');
    await clickCite('.gzc-row .sbtn');
    await until(() => fr.evaluate(() => document.querySelector('.gz-cite [data-field="title"]')?.value === 'Rememory and the River in Beloved'), 'DOI without permissions API');
    check(true, 'DOI lookup still works without the permissions API');
    await clickCite('.gz-cite [data-do="cancel"]');
    await until(() => fr.evaluate(() => !!document.querySelector('.gz-cite .gzc-in')), 'Cancel restores the lookup row');
    await fr.fill('.gzc-in', '9780306406157');
    await clickCite('.gzc-row .sbtn');
    await until(() => fr.evaluate(() => document.querySelector('.gz-cite [data-field="title"]')?.value === 'The River Keeps: A novel'), 'ISBN without permissions API');
    check(true, 'ISBN lookup still works without the permissions API');
    await fr.evaluate(() => { chrome.permissions = window.__permissions; });
    await fr.press('.gz-cite [data-field="title"]', 'Escape');
    await fr.evaluate(() => { document.querySelector('aside').hidden = false; });
    await fr.click('.gzc-view .gzc-head .sbtn');
    check(await fr.evaluate(() => document.activeElement?.classList.contains('gzc-in') && !document.querySelector('.gzc-adder').hidden), 'Add source opens the lookup in the panel');
    saved.add = await shot(el, 'cite-sources-add.png');
    await fr.evaluate(() => GZ_WRITER_CITE.add({ name: 'James Baldwin' }));
    check(await fr.evaluate(() => document.querySelector('.gz-cite [data-field="author"]')?.value === 'Baldwin, James'), 'add({ name }) (the Checks card\'s Add source) opens the form with the name filled in');

    check(!requests.some((r) => !r.url.startsWith(site) && !ANSWERS[r.url] && !r.url.startsWith(QUILL.url)), 'no request left for anywhere but the synthetic site and the three mocked lookup answers');
    check(!errors.length, `no page or frame errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(JSON.stringify({ checks: checks.length, failures: failures.length, shots: saved }, null, 2));
    assert.deepEqual(failures, [], 'citation review regressions');
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
