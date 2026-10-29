// The Documents home (papers.html) in the real unpacked extension: the New band, the grid's lazy thumbnails and their
// cost, the list view and its kept choice, search by title and by body text, the course filter, sort, rename (seen by an
// open editor), Make a copy, Delete and Undo (versions kept), .docx drop and import and a refused .txt, the keyboard,
// accessible names and the live region, opening a card in the same tab and coming back; the student's Look on the page
// (ground, background and its motion, glass, fonts, corners, contrast over a busy photo, a live change) and a mod's items
// and calls there. Screenshots at 1280 and 640 px in English and German, and look-*.png on four Looks. Synthetic records
// only; the browser reaches no network (a Look's fonts are refused and counted apart, the photo is served here).
// NODE_PATH=<playwright> nice -n 10 node scripts/documents-check.js [evidence directory]
// DOCUMENTS_SHOTS: where the screenshots go (default ~/Projects/glaze-plans/writer/mockups/build-documents).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-documents-check');
const shots = process.env.DOCUMENTS_SHOTS || path.join(os.homedir(), 'Projects/glaze-plans/writer/mockups/build-documents');
const checks = [], errors = [], requests = [], fontRequests = [];
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net']);
let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

// ---- the seeded documents: two assignment papers (one submitted), a named and an unnamed local document, and fillers
const NOW = Date.now(), HOUR = 3600e3;
const p = (text, attrs) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(text ? { content: [{ type: 'text', text }] } : {}) });
const words = (doc) => JSON.stringify(doc).match(/"text":"([^"]*)"/g).map((m) => m.slice(8, -1)).join(' ').split(/\s+/).filter(Boolean).length;
const ESSAY = 'bb.school.test|_900_1|_101_1|_7_1', LAB = 'bb.school.test|_900_1|_102_1|_9_1', ESSAY3 = 'bb.school.test|_900_1|_101_1|_8_1';
// The PNG and inline image shape are the writer-objects round-trip fixture.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const NOTES = `doc:${crypto.randomUUID()}`, FIELD = `doc:${crypto.randomUUID()}`;
const body = (n, lead) => Array.from({ length: n }, (_, i) => p(`${lead} ${i + 1}. A paragraph of plain prose that fills the page the way a student's draft does, sentence after sentence, with nothing but text in it.`));
const seeds = [
  { key: ESSAY, title: 'Essay 2: Memory in Beloved', courseName: 'ENGL 2110', format: 'mla9', updated: NOW - 1 * HOUR, url: 'https://bb.school.test/ultra/courses/_101_1/outline',
    doc: { type: 'doc', content: [p('Alex Rivera', { first: 0 }), p('Dr. Okafor', { first: 0 }), p('ENGL 2110', { first: 0 }), p('12 October 2026', { first: 0 }), p('Memory in Beloved', { align: 'center' }), ...body(6, 'Beloved')] } },
  { key: LAB, title: 'Lab report 3', courseName: 'BIOL 1010', format: 'apa7', updated: NOW - 50 * HOUR, submitted: NOW - 49 * HOUR,
    doc: { type: 'doc', content: [p('Enzyme rates at three temperatures'), ...body(5, 'Catalase')] } },
  { key: ESSAY3, title: 'Essay 3: The Clearing', courseName: 'ENGL 2110', format: 'mla9', updated: NOW - 70 * HOUR, doc: { type: 'doc', content: body(4, 'Clearing') } },
  { key: NOTES, title: 'Reading notes', named: true, format: 'plain', updated: NOW - 3 * HOUR, doc: { type: 'doc', content: [p('Chapter one, the house on Bluestone Road.'), { type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, alt: 'Diagram', width: 96, display: 'inline', align: null, caption: '' } }] }, ...body(3, 'Notes')] } },
  { key: FIELD, title: 'Field notes from Tuesday', named: false, format: 'plain', updated: NOW - 5 * HOUR, doc: { type: 'doc', content: [p('Field notes from Tuesday'), p('The heliotrope by the fence had opened by noon.'), ...body(2, 'Field')] } },
  ...Array.from({ length: 195 }, (_, i) => ({ key: `doc:${crypto.randomUUID()}`, title: `Draft ${String(i + 1).padStart(2, '0')}`, named: i % 2 === 0, format: ['plain', 'mla9', 'apa7', 'chicago17'][i % 4],
    updated: NOW - (6 + i) * HOUR, doc: { type: 'doc', content: [p(`Draft ${String(i + 1).padStart(2, '0')}`), ...body(3 + (i % 5), `Draft ${i + 1}`)] } })),
];
const VERSIONS = [{ id: 'v1-aaaaaa', at: NOW - 4 * HOUR, reason: 'start', words: 5, bytes: 100, format: 'plain', keep: false, doc: { type: 'doc', content: [p('Chapter one.')] } },
  { id: 'v2-bbbbbb', at: NOW - 3.5 * HOUR, reason: 'edit', words: 12, bytes: 200, format: 'plain', keep: false, doc: { type: 'doc', content: [p('Chapter one, the house.')] } }];
const records = () => {
  const all = {}, index = [];
  for (const s of seeds) {
    const rec = { key: s.key, kind: 'paper', named: s.named === true, title: s.title, courseName: s.courseName || '', url: s.url || '', format: s.format, doc: s.doc, words: words(s.doc), keep: false,
      created: s.updated - HOUR, updated: s.updated, revision: 3, edited: 3, submitted: s.submitted || null };
    all[`writerPaper:${s.key}`] = rec;
    index.push({ key: s.key, kind: 'paper', named: rec.named, title: rec.title, course: rec.courseName, url: rec.url, words: rec.words, format: rec.format, updated: rec.updated, submitted: rec.submitted });
  }
  all[`writerVersions:${NOTES}`] = VERSIONS;
  all.writerPapers = index.sort((a, b) => b.updated - a.updated);
  return all;
};

// What each home page records from its first script on: each thumbnail render's main-thread time and when it ended, every
// storage.local get's key count, and when the first card appeared. lang: chrome.i18n's UI language for the page.
const PROBE = ({ lang }) => {
  if (location.pathname === '/preview.html') {
    globalThis.__gdRAF = 0;
    const raf = requestAnimationFrame;
    globalThis.requestAnimationFrame = (fn) => raf((now) => { __gdRAF++; fn(now); });
    return;
  }
  if (location.pathname !== '/papers.html') return; // not the mods' sandboxed host
  globalThis.__gd = { renders: [], gets: [], firstCard: null, rowsPaint: null, indexRead: null, disconnects: 0 };
  const IO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class extends IO { disconnect() { __gd.disconnects++; sessionStorage.setItem('review-disconnects', String(__gd.disconnects)); return super.disconnect(); } };
  if (lang) { try { chrome.i18n.getUILanguage = () => lang; } catch {} }
  let thumb;
  Object.defineProperty(globalThis, 'GZ_WRITER_THUMB', { configurable: true, get: () => thumb, set: (v) => {
    const render = v.render;
    v.render = (...a) => { const t = performance.now(); try { return render(...a); } finally { const e = performance.now(); __gd.renders.push({ ms: e - t, at: e }); } };
    thumb = v;
  } });
  const get = chrome.storage.local.get.bind(chrome.storage.local);
  chrome.storage.local.get = (k, ...rest) => { __gd.gets.push(Array.isArray(k) ? k.slice() : k); const reading = get(k, ...rest); if (k === 'writerPapers') reading.then(() => { __gd.indexRead ??= performance.now(); }); return reading; };
  new MutationObserver((_, o) => { if (document.querySelector('.gd-card')) { __gd.firstCard = performance.now(); requestAnimationFrame(() => { __gd.rowsPaint = performance.now(); }); o.disconnect(); } }).observe(document, { childList: true, subtree: true });
};

(async () => {
  let context, held = false, tmp, ext;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\ndocuments-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[documents-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-documents-'));
    fs.mkdirSync(out, { recursive: true });
    fs.mkdirSync(shots, { recursive: true });
    ext = require('./check-env.js').staged(root, []);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'America/New_York',
      reducedMotion: 'reduce', acceptDownloads: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(15000);
    // A Look's web fonts load from their CDNs (lib/fonts.js): refused here like everything else, and counted apart.
    await context.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.protocol === 'chrome-extension:') return r.continue(); (FONT_HOSTS.has(u.hostname) ? fontRequests : requests).push(r.request().url()); return r.abort(); });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const settings = G.GZ_SANITIZE({ preset: 'Frost', enhance: { ...G.GZ_DEFAULTS.enhance, writer: true } });
    await worker.evaluate(async ({ settings, data }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set(data); }, { settings, data: records() });
    const HOME = `chrome-extension://${id}/papers.html`;
    const local = (k) => worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k] ?? null, k);
    const watch = (pg, tag) => {
      pg.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
      pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|intentional review refusal|Error: not a zip file/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
    };
    const openHome = async (lang = null, tag = 'home') => {
      const pg = await context.newPage();
      watch(pg, tag);
      await pg.addInitScript(PROBE, { lang });
      await pg.goto(HOME);
      await until(() => pg.evaluate(() => document.querySelectorAll('.gd-card').length > 0 && !document.getElementById('list').hidden), `${tag} cards`);
      return pg;
    };
    const cards = (pg) => pg.evaluate(() => [...document.querySelectorAll('.gd-card')].map((c) => ({ key: c.dataset.key, title: c.querySelector('.gd-title').textContent, meta: c.querySelector('.gd-meta').textContent, badge: c.querySelector('.gd-badge:not([hidden])')?.textContent || '', thumb: !!c.querySelector('.gd-pic > .gt-thumb') })));
    const card = (key) => `.gd-card[data-key="${key}"]`;
    const said = (pg) => pg.evaluate(() => document.getElementById('gd-count').textContent);
    const focused = (pg) => pg.evaluate(() => document.activeElement?.closest('.gd-card')?.dataset.key || document.activeElement?.id || document.activeElement?.className || '');
    const shot = async (pg, name) => { await pause(200); const f = path.join(shots, name); await pg.screenshot({ path: f }); saved.push(f); return f; };
    const saved = [];
    const total = seeds.length;

    // ---- the page and the New band
    let home = await openHome();
    check(await home.evaluate(() => document.title === 'Documents' && document.querySelector('h1').textContent === 'Documents'), 'title and h1 read Documents');
    const tiles = await home.evaluate(() => [...document.querySelectorAll('.gd-new .gd-tile')].map((a) => ({ name: a.querySelector('.gd-tile-name').textContent, label: a.querySelector('.gt-thumb')?.getAttribute('aria-hidden'), href: a.getAttribute('href'), thumb: !!a.querySelector('.gt-thumb'), format: a.dataset.format, text: a.querySelector('.gt-thumb')?.textContent })));
    check(await home.evaluate(() => document.querySelector('.gd-new h2')?.textContent === 'New'), 'the New band has its h2');
    check(tiles.map((x) => x.name).join('|') === 'Blank|MLA 9|APA 7|Chicago 17' && tiles.every((x) => x.thumb && x.label === 'true'), `New tiles Blank, MLA 9, APA 7, Chicago 17, each drawn (${JSON.stringify(tiles.map((x) => x.name))})`);
    check(tiles.every((x) => /^papers\.html\?paper=doc%3A[0-9a-f-]{36}&format=(plain|mla9|apa7|chicago17)$/.test(x.href)), 'each tile links papers.html?paper=<new doc: key>&format=<id>');

    check(tiles.every((x) => x.format === 'plain' ? !/Your name|Instructor|Course|Date|Title/.test(x.text) : ['Your name', 'Instructor', 'Course', 'Date', 'Title'].every((v) => x.text.includes(v))), 'format tiles show their opening placeholders; Blank stays empty');

    // ---- the grid and its thumbnails
    await until(async () => (await home.evaluate(() => __gd.renders.length)) >= 12, '12 thumbnails');
    const probe = await home.evaluate(() => ({ ...__gd, nav: performance.getEntriesByType('navigation')[0]?.startTime || 0 }));
    check(total === 200 && probe.rowsPaint - probe.indexRead < 150, `200 document rows paint within 150 ms of the index read (${(probe.rowsPaint - probe.indexRead).toFixed(1)} ms)`);
    const t12 = probe.renders[11].at, since = t12 - probe.firstCard;
    console.log(`first card at ${probe.firstCard.toFixed(0)} ms; 12th thumbnail at ${t12.toFixed(0)} ms from navigation (${since.toFixed(0)} ms after the first card)`);
    check(t12 <= 400, `the first 12 thumbnails are drawn within 400 ms of navigation (${t12.toFixed(0)} ms)`);
    let list = await cards(home);
    check(list.length === total, `the grid lists every document (${list.length} of ${total})`);
    const drawnFirst = list.filter((c) => c.thumb).length;
    check(drawnFirst >= 12 && drawnFirst < total, `thumbnails are drawn lazily: ${drawnFirst} of ${total} near the screen`);
    const thumbGets = probe.gets.filter((g) => Array.isArray(g) && g.every((k) => k.startsWith('writerPaper:')));
    check(thumbGets.length > 0 && thumbGets.every((g) => g.length <= 12), `thumbnail records come 12 or fewer per storage get (${thumbGets.map((g) => g.length).join(', ')})`);
    for (let i = 0; i < total; i += 12) {
      await home.evaluate((i) => document.querySelectorAll('.gd-card')[i].scrollIntoView({ block: 'start' }), i);
      await until(() => home.evaluate((i) => !!document.querySelectorAll('.gd-card')[i].querySelector('.gt-thumb'), i), `thumbnail ${i}`);
    }
    check(await home.evaluate(() => document.querySelectorAll('.gd-pic .gt-thumb').length <= 48), 'after visiting 200 documents, at most 48 thumbnails are retained');
    const renders = await home.evaluate(() => __gd.renders.map((r) => r.ms));
    const worst = Math.max(...renders);
    console.log(`${renders.length} thumbnail renders; median ${renders.slice().sort((a, b) => a - b)[renders.length >> 1].toFixed(2)} ms, worst ${worst.toFixed(2)} ms`);
    check(worst <= 6, `each thumbnail costs at most 6 ms of main thread (worst ${worst.toFixed(2)} ms)`);
    // The clock in a page is coarse (0.1 ms): 50 renders of the largest seeded paper, timed together, say what one costs.
    const block = await home.evaluate(async (k) => {
      const rec = (await chrome.storage.local.get(`writerPaper:${k}`))[`writerPaper:${k}`], n = 50, t = performance.now();
      for (let i = 0; i < n; i++) GZ_WRITER_THUMB.render(GZ_WRITER_THUMB.firstPage(rec.doc), rec.format, { scale: 0.25 });
      const ms = (performance.now() - t) / n;
      __gd.renders.splice(-n);
      return ms;
    }, ESSAY);
    console.log(`50 renders of the largest paper back to back: ${block.toFixed(3)} ms each`);
    check(block > 0 && block <= 6, `a thumbnail of the largest seeded paper costs ${block.toFixed(3)} ms (50 timed together)`);
    check(await home.evaluate(() => [...document.querySelectorAll('.gt-thumb')].filter((t) => !t.closest('.gd-tile')).every((t) => t.parentElement.matches('.gd-card > .gd-pic') && t.getAttribute('aria-hidden') === 'true')), 'each thumbnail sits in its own card, hidden from assistive tech');
    const rendersBefore = renders.length;
    await home.evaluate(() => scrollTo(0, 0));
    await pause(300);
    check((await home.evaluate(() => __gd.renders.length)) > rendersBefore, 'evicted thumbnails are redrawn when revisited');
    const cached = await home.evaluate(() => __gd.renders.length);
    await worker.evaluate(async () => { const r = await chrome.storage.local.get('writerPapers'); await chrome.storage.local.set(r); });
    await pause(150);
    check((await home.evaluate(() => __gd.renders.length)) === cached, 'an unchanged index never redraws cached thumbnails');
    check(await home.evaluate((k) => document.querySelector(`.gd-card[data-key="${k}"] img`)?.getAttribute('src').startsWith('data:image/png;base64,'), NOTES), 'a thumbnail keeps the inline data-URL picture');
    list = await cards(home);
    const essay = list.find((c) => c.key === ESSAY), lab = list.find((c) => c.key === LAB);
    check(essay.title === 'Essay 2: Memory in Beloved' && /^ENGL 2110 · MLA 9 · \d+ words · /.test(essay.meta), `an assignment paper's card: its title, course, format, words and date (${essay.meta})`);
    check(lab.badge === 'Submitted' && list.filter((c) => c.badge).length === 1, 'the submitted paper carries the Submitted badge, and only it');
    check(list.find((c) => c.key === FIELD).title === 'Field notes from Tuesday' && list.find((c) => c.key === NOTES).title === 'Reading notes', 'local documents show their named and derived titles');
    check(list.map((c) => c.key).join() === seeds.slice().sort((a, b) => b.updated - a.updated).map((s) => s.key).join(), 'Last edited orders the grid newest first');
    check(await said(home) === `${total} documents`, `the live region says "${total} documents"`);
    // A stored change to a drawn paper redraws its thumbnail, from the change itself.
    await worker.evaluate(async (k) => { const r = (await chrome.storage.local.get(`writerPaper:${k}`))[`writerPaper:${k}`]; r.doc.content.unshift({ type: 'paragraph', content: [{ type: 'text', text: 'A sentence added elsewhere.' }] }); r.revision++; r.updated = Date.now(); await chrome.storage.local.set({ [`writerPaper:${k}`]: r }); }, ESSAY);
    await until(() => home.evaluate((k) => document.querySelector(`.gd-card[data-key="${k}"] .gt-thumb`)?.textContent.includes('A sentence added elsewhere.'), ESSAY), 'stale thumbnail redrawn');
    check(true, 'a change in storage marks a thumbnail stale and it is drawn again');

    // A burst of autosaves invalidates once; the index's redraw cannot bypass the queued idle render.
    await home.evaluate(() => { __gd.idles = []; __gd.idle = requestIdleCallback; globalThis.requestIdleCallback = (fn) => { __gd.idles.push(fn); return 0; }; __gd.beforeBurst = __gd.renders.length; });
    for (let i = 0; i < 8; i++) await worker.evaluate(async ({ k, i }) => {
      const name = `writerPaper:${k}`, r = (await chrome.storage.local.get(name))[name];
      r.doc.content[0].content[0].text = `Autosave ${i}.`; r.revision++;
      await chrome.storage.local.set({ [name]: r, writerPapers: (await chrome.storage.local.get('writerPapers')).writerPapers });
    }, { k: ESSAY, i });
    check(await home.evaluate(() => __gd.renders.length === __gd.beforeBurst && __gd.idles.length === 1), 'eight autosaves queue one thumbnail draw without index redraw storms');
    await home.evaluate(() => { globalThis.requestIdleCallback = __gd.idle; __gd.idles.splice(0).forEach((fn) => fn()); });
    await until(() => home.evaluate((k) => document.querySelector(`.gd-card[data-key="${k}"] .gt-thumb`)?.textContent.includes('Autosave 7.'), ESSAY), 'latest autosave thumbnail');
    check(await home.evaluate(() => __gd.renders.length === __gd.beforeBurst + 1), 'the burst draws only the newest thumbnail');

    // ---- accessible names
    const names = await home.evaluate(() => {
      const label = (el) => el?.getAttribute('aria-label') || el?.textContent.trim();
      const c = document.querySelector('.gd-card'), more = c.querySelector('.gd-more');
      return { search: label(document.getElementById('gd-q')), course: label(document.getElementById('gd-course')), sort: label(document.getElementById('gd-sort')),
        grid: label(document.getElementById('gd-grid')), listB: label(document.getElementById('gd-list')), pressed: [document.getElementById('gd-grid').getAttribute('aria-pressed'), document.getElementById('gd-list').getAttribute('aria-pressed')].join(),
        imp: label(document.getElementById('gd-import')), file: label(document.getElementById('gd-file')), more: label(more), popup: more.getAttribute('aria-haspopup'), described: document.getElementById(more.getAttribute('aria-describedby'))?.textContent === c.querySelector('.gd-title').textContent,
        link: c.querySelector('.gd-title').tagName === 'A' && c.querySelector('.gd-title').getAttribute('href').startsWith('papers.html?paper='), kindHidden: c.querySelector('.gd-kind')?.getAttribute('aria-hidden'),
        listName: document.getElementById(document.getElementById('gd-docs').getAttribute('aria-labelledby'))?.textContent, live: document.getElementById('gd-count').getAttribute('aria-live'),
        tabbable: [...document.querySelectorAll('#gd-docs a, #gd-docs button')].filter((e) => e.tabIndex >= 0).length };
    });
    check(names.search === 'Search' && names.course === 'Course' && names.sort === 'Sort' && names.grid === 'Grid' && names.listB === 'List' && names.pressed === 'true,false' && names.imp === 'Import .docx…' && names.file === names.imp, `the toolbar's controls are named (${JSON.stringify(names)})`);
    check(names.more === 'More' && names.popup === 'menu' && names.described && names.link && names.kindHidden === 'true' && names.listName === 'Documents' && names.live === 'polite', 'cards: a titled link, a More menu button described by its title, the kind icon hidden; the list is named Documents');
    check(names.tabbable === 1, `the cards are one Tab stop (${names.tabbable} tabbable)`);
    const darkContrast = await home.evaluate(() => {
          // Through a canvas: a color-mix() fill serialises as color(srgb …).
          const g = new OffscreenCanvas(1, 1).getContext('2d'), rgb = (s) => { g.clearRect(0, 0, 1, 1); g.fillStyle = s; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
          const lum = (c) => c.map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
          const bg = lum(rgb(getComputedStyle(document.querySelector('.gd-card')).backgroundColor));
          return ['.gd-title', '.gd-meta'].map((sel) => { const fg = lum(rgb(getComputedStyle(document.querySelector(sel)).color)); return (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05); });
        });
    check(darkContrast.every((v) => v >= 4.5), `dark Look: card title and metadata meet 4.5:1 (${darkContrast.map((v) => v.toFixed(2)).join(', ')})`);
    await shot(home, 'grid-1280-en.png');

    // ---- list view, kept across a reload
    await home.click('#gd-list');
    check(await home.evaluate(() => document.getElementById('list').dataset.view === 'list' && document.getElementById('gd-list').getAttribute('aria-pressed') === 'true' && document.getElementById('gd-grid').getAttribute('aria-pressed') === 'false'), 'List shows rows and is pressed');
    await shot(home, 'list-1280-en.png');
    await home.reload();
    await until(() => home.evaluate(() => document.querySelectorAll('.gd-card').length > 0), 'cards after reload');
    check(await home.evaluate(() => document.getElementById('list').dataset.view === 'list'), 'the List choice is kept across a reload (localStorage)');
    await home.click('#gd-grid');
    check(await home.evaluate(() => document.getElementById('list').dataset.view === 'grid' && localStorage.getItem('gz-documents-view') === 'grid'), 'Grid again, and kept');

    // ---- search
    const shown = () => home.evaluate(() => [...document.querySelectorAll('.gd-card')].map((c) => c.dataset.key));
    await home.fill('#gd-q', 'reading');
    await until(async () => (await shown()).join() === NOTES, 'title search');
    check(await said(home) === '1 document', 'search by title: one document, and the live region says so');
    await home.fill('#gd-q', 'ENGL');
    await until(async () => (await shown()).sort().join() === [ESSAY, ESSAY3].sort().join(), 'course search');
    check(true, 'search matches a course name');
    await home.fill('#gd-q', 'HÉLIOTROPE');
    await until(async () => (await shown()).join() === FIELD, 'body search');
    const bodyGets = (await home.evaluate(() => __gd.gets)).filter((g) => Array.isArray(g) && g.every((k) => k.startsWith('writerPaper:')));
    check(bodyGets.every((g) => g.length <= 12), 'search by body text finds a word only the document\'s text holds');
    const d07 = seeds.filter((s) => /^Draft .*07$/.test(s.title)).map((s) => s.key).sort().join();
    await home.fill('#gd-q', 'paragraph 07 draft');
    await until(async () => (await shown()).sort().join() === d07, 'several terms');
    check(true, 'every search term must match, title and body together');
    await home.focus('#gd-q');
    await home.keyboard.press('Escape');
    await until(async () => (await shown()).length === total, 'Esc clears');
    check(await home.evaluate(() => document.getElementById('gd-q').value === ''), 'Esc in the search field clears it');

    // Once every body is cached, changing or clearing a query must still render even with no reads left to await.
    await home.fill('#gd-q', 'never-present'); await pause(300);
    await home.fill('#gd-q', 'HÉLIOTROPE');
    await until(async () => (await shown()).join() === FIELD, 'warm-cache query');
    check(true, 'a query change after the body cache is warm paints the new result');
    await home.fill('#gd-q', '');
    await until(async () => (await shown()).length === total, 'warm-cache clear');
    check(true, 'clearing a warm-cache query paints all documents');

    // A body read held across an edit must not overwrite the new search result; a superseded query must stop too.
    const searchPage = await openHome('en', 'search races'), target = seeds.at(-1).key;
    const holdSearch = async () => {
      await searchPage.evaluate((k) => {
        const get = chrome.storage.local.get.bind(chrome.storage.local); globalThis.__blocked = false;
        chrome.storage.local.get = async (names, ...rest) => {
          const got = await get(names, ...rest);
          if (!__blocked && Array.isArray(names) && names.includes(`writerPaper:${k}`)) {
            __blocked = true; await new Promise((r) => { globalThis.__release = r; });
          }
          return got;
        };
      }, target);
    };
    await holdSearch(); await searchPage.fill('#gd-q', 'newuniqueword');
    await until(() => searchPage.evaluate(() => __blocked), 'held body scan');
    await worker.evaluate(async (k) => {
      const name = `writerPaper:${k}`, r = (await chrome.storage.local.get(name))[name];
      r.doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'newuniqueword' }] }); r.updated = Date.now(); r.revision++;
      const index = (await chrome.storage.local.get('writerPapers')).writerPapers.map((x) => x.key === k ? { ...x, updated: r.updated } : x);
      await chrome.storage.local.set({ [name]: r, writerPapers: index });
    }, target);
    await until(() => searchPage.evaluate((k) => [...document.querySelectorAll('.gd-card')].map((c) => c.dataset.key).join() === k, target), 'new stored body result');
    await searchPage.evaluate(() => __release()); await pause(100);
    check(await searchPage.evaluate((k) => [...document.querySelectorAll('.gd-card')].map((c) => c.dataset.key).join() === k, target), 'a body read started before a storage edit cannot replace its new search result');
    await searchPage.reload(); await until(() => searchPage.evaluate(() => document.querySelectorAll('.gd-card').length > 0), 'search reload');
    // The updated target is now first; hold an unvisited record at the other end instead.
    const abortKey = seeds.at(-2).key;
    await searchPage.evaluate((k) => {
      const get = chrome.storage.local.get.bind(chrome.storage.local); globalThis.__blocked = false;
      chrome.storage.local.get = async (names, ...rest) => { const got = await get(names, ...rest); if (!__blocked && Array.isArray(names) && names.includes(`writerPaper:${k}`)) { __blocked = true; await new Promise((r) => { globalThis.__release = r; }); } return got; };
    }, abortKey);
    await searchPage.fill('#gd-q', 'never-present'); await until(() => searchPage.evaluate(() => __blocked), 'held old query');
    await searchPage.fill('#gd-q', 'Lab report'); await searchPage.evaluate(() => __release()); await pause(100);
    check(await searchPage.evaluate((k) => [...document.querySelectorAll('.gd-card')].map((c) => c.dataset.key).join() === k, LAB), 'a superseded body scan cannot repaint the newer query');
    await searchPage.close();
    await worker.evaluate(async ({ k, updated }) => {
      const name = `writerPaper:${k}`, r = (await chrome.storage.local.get(name))[name]; r.updated = updated; r.doc.content.pop(); r.revision++;
      await chrome.storage.local.set({ [name]: r, writerPapers: (await chrome.storage.local.get('writerPapers')).writerPapers.map((x) => x.key === k ? { ...x, updated } : x) });
    }, { k: target, updated: seeds.at(-1).updated });
    await until(async () => (await shown()).length === total, 'home updated after body race');

    // ---- course filter
    const opts = await home.evaluate(() => [...document.querySelectorAll('#gd-course option')].map((o) => o.textContent));
    check(opts.join('|') === 'All courses|BIOL 1010|ENGL 2110|No course', `Course offers All, each course by name, No course (${opts.join('|')})`);
    await home.selectOption('#gd-course', { label: 'ENGL 2110' });
    check((await shown()).sort().join() === [ESSAY, ESSAY3].sort().join(), 'a course shows only its papers');
    await home.selectOption('#gd-course', { label: 'No course' });
    check((await shown()).length === total - 3 && !(await shown()).some((k) => k.includes('|')), 'No course shows only documents without one');
    await home.selectOption('#gd-course', { label: 'All courses' });
    check((await shown()).length === total, 'All courses shows every document');

    // ---- sort
    await home.selectOption('#gd-sort', 'title');
    const byTitle = (await cards(home)).map((c) => c.title);
    check(byTitle.join('|') === byTitle.slice().sort(new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare).join('|') && byTitle[0] === 'Draft 01', 'Title sorts A to Z');
    await home.selectOption('#gd-sort', 'updated');
    check((await cards(home))[0].key === ESSAY, 'Last edited sorts newest first again');

    // ---- rename, seen by the document open in another tab
    const editor = await context.newPage();
    watch(editor, 'editor');
    await editor.goto(`${HOME}?paper=${encodeURIComponent(NOTES)}`);
    await until(() => editor.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key() && document.querySelector('.gp-top h1 input')?.value === 'Reading notes'), 'editor open');
    await home.bringToFront();
    await home.focus(`${card(NOTES)} .gd-title`);
    await home.keyboard.press('F2');
    await until(() => home.evaluate(() => document.activeElement?.matches('.gd-rename')), 'rename field');
    check(await home.evaluate(() => document.activeElement.getAttribute('aria-label') === 'Title' && document.activeElement.value === 'Reading notes'), 'F2 renames in place: a Title field holding the name');
    await shot(home, 'rename-1280-en.png');
    await home.keyboard.press('Escape');
    check(await home.evaluate((s) => !document.querySelector('.gd-rename') && document.activeElement?.matches(`${s} .gd-title`), card(NOTES)), 'Esc cancels a rename and focus returns to the card');
    await home.keyboard.press('F2');
    await home.keyboard.press('ControlOrMeta+A');
    await home.keyboard.type('Reading notes, revised');
    await home.keyboard.press('Enter');
    await until(async () => (await local(`writerPaper:${NOTES}`))?.title === 'Reading notes, revised', 'rename saved');
    let renamed = await local(`writerPaper:${NOTES}`);
    check(renamed.named === true && (await cards(home)).find((c) => c.key === NOTES).title === 'Reading notes, revised', 'Enter saves the name (named) through the worker, and the card shows it');
    await until(() => editor.evaluate(() => document.querySelector('.gp-top h1 input').value === 'Reading notes, revised'), 'editor title');
    check(true, 'the open editor in another tab shows the new title');
    await editor.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.insertText(' Unsaved typing.')); });
    await home.focus(`${card(NOTES)} .gd-title`); await home.keyboard.press('F2');
    await home.fill('.gd-rename', 'Race title'); await home.keyboard.press('Enter');
    await until(async () => (await local(`writerPaper:${NOTES}`))?.title === 'Race title', 'race rename');
    await editor.evaluate(() => GZ_WRITER_PAPER.current().save());
    check((await local(`writerPaper:${NOTES}`)).title === 'Race title' && JSON.stringify((await local(`writerPaper:${NOTES}`)).doc).includes('Unsaved typing.'), 'a home rename racing editor typing keeps both the title and the text');
    await home.focus(`${card(NOTES)} .gd-title`); await home.keyboard.press('F2');
    await home.fill('.gd-rename', 'Reading notes, revised'); await home.keyboard.press('Enter');
    await until(async () => (await local(`writerPaper:${NOTES}`))?.title === 'Reading notes, revised', 'name back');
    await editor.close();
    const essayMenu = await home.evaluate(async (s) => { document.querySelector(`${s} .gd-more`).click(); await new Promise((r) => requestAnimationFrame(r)); const items = [...document.querySelectorAll('.gd-menu [role="menuitem"]')].map((b) => b.textContent); document.querySelector(`${s} .gd-more`).click(); return items; }, card(ESSAY));
    check(essayMenu.join('|') === 'Make a copy|Export .docx|Delete', `an assignment paper's menu has no Rename (${essayMenu.join('|')})`);

    renamed = await local(`writerPaper:${NOTES}`);

    // ---- Make a copy
    await home.click(`${card(NOTES)} .gd-more`);
    const notesMenu = await home.evaluate(() => [...document.querySelectorAll('.gd-menu [role="menuitem"]')].map((b) => b.textContent));
    check(notesMenu.join('|') === 'Rename|Make a copy|Export .docx|Delete', `a document's menu: Rename, Make a copy, Export .docx, Delete (${notesMenu.join('|')})`);
    check(await home.evaluate((s) => document.activeElement?.matches('.gd-menu [role="menuitem"]') && document.querySelector(`${s} .gd-more`).getAttribute('aria-expanded') === 'true', card(NOTES)), 'the menu opens with focus on its first item');
    await shot(home, 'menu-1280-en.png');
    await home.click('.gd-menu [data-act="copy"]');
    await until(async () => (await cards(home)).some((c) => c.title === 'Copy of Reading notes, revised'), 'the copy');
    const copyKey = (await cards(home)).find((c) => c.title === 'Copy of Reading notes, revised').key;
    const copy = await local(`writerPaper:${copyKey}`);
    check(/^doc:/.test(copyKey) && copy.named === true && copy.kind === 'paper' && !copy.courseName && JSON.stringify(copy.doc) === JSON.stringify(renamed.doc), 'Make a copy saves a new named document with the same text');
    check(JSON.stringify(copy.doc).includes(PNG), 'Make a copy preserves data-URL pictures');
    check(await focused(home) === copyKey, 'focus moves to the copy');

    await home.focus(`${card(copyKey)} .gd-title`); await home.keyboard.press('F2');
    await home.fill('.gd-rename', '<img src=x onerror=alert(1)>'); await home.keyboard.press('Enter');
    await until(async () => (await local(`writerPaper:${copyKey}`))?.title === '<img src=x onerror=alert(1)>', 'literal title saved');
    check(await home.evaluate((k) => document.querySelector(`.gd-card[data-key="${k}"] .gd-title`).textContent === '<img src=x onerror=alert(1)>' && !document.querySelector(`.gd-card[data-key="${k}"] .gd-title img`), copyKey), 'HTML in a title stays literal text');

    await home.focus(`${card(copyKey)} .gd-title`); await home.keyboard.press('F2');
    await home.fill('.gd-rename', 'Copy of Reading notes, revised'); await home.keyboard.press('Enter');
    await until(async () => (await local(`writerPaper:${copyKey}`))?.title === 'Copy of Reading notes, revised', 'copy name back');

    // ---- Delete and Undo; the Delete key and Ctrl+Z
    const versionsBefore = (await local(`writerVersions:${NOTES}`)).map((v) => v.id);
    await home.click(`${card(NOTES)} .gd-more`);
    await home.click('.gd-menu [data-act="delete"]');
    check(!(await shown()).includes(NOTES), 'Delete takes the card away at once');
    await until(async () => !(await local(`writerPaper:${NOTES}`)) && !(await local(`writerVersions:${NOTES}`)), 'deleted in storage');
    check(await home.evaluate(() => document.querySelector('.gd-toast')?.textContent.startsWith('Deleted') && document.querySelector('.gd-toast button')?.textContent === 'Undo'), 'a Deleted toast offers Undo; the paper and its versions are gone from storage');
    await shot(home, 'undo-1280-en.png');
    await home.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime); globalThis.__undoSend = send;
      chrome.runtime.sendMessage = (m, ...rest) => m?.op === 'merge' ? Promise.resolve({ ok: false, error: 'intentional review refusal' }) : send(m, ...rest);
    });
    await home.click('.gd-toast button');
    await until(() => home.evaluate(() => document.getElementById('gd-said').textContent === 'Not saved. Try again in a moment.'), 'Undo failure reported');
    check(await home.evaluate(() => !!document.querySelector('.gd-toast button')), 'a refused Undo keeps its recovery snapshot available for retry');
    await home.evaluate(() => { chrome.runtime.sendMessage = __undoSend; });
    await home.click('.gd-toast button');
    await until(async () => (await shown()).includes(NOTES), 'undone');
    const back = await local(`writerPaper:${NOTES}`), versionsAfter = (await local(`writerVersions:${NOTES}`) || []).map((v) => v.id);
    check(back?.title === 'Reading notes, revised' && JSON.stringify(back.doc) === JSON.stringify(renamed.doc) && versionsBefore.every((v) => versionsAfter.includes(v)), `Undo puts the document back with its versions (${versionsAfter.join(', ')})`);
    check(back.updated === renamed.updated && versionsAfter.join() === versionsBefore.join(), 'Undo keeps Last edited and restores exactly the original versions, with no extra start');
    check(await focused(home) === NOTES, 'Undo returns focus to the restored document');
    check(!(await home.evaluate(() => !!document.querySelector('.gd-toast'))), 'the toast goes once undone');
    await home.focus(`${card(copyKey)} .gd-title`);
    await home.keyboard.press('Delete');
    check(!(await shown()).includes(copyKey), 'the Delete key deletes the focused card');
    await until(async () => !(await local(`writerPaper:${copyKey}`)), 'copy deleted');
    check(await home.evaluate(() => document.activeElement?.closest('.gd-card') != null), 'focus stays in the cards after a delete');
    await home.keyboard.press('ControlOrMeta+z');
    await until(async () => (await shown()).includes(copyKey) && !!(await local(`writerPaper:${copyKey}`)), 'Ctrl+Z undo');
    check(true, 'Ctrl+Z while the toast shows undoes the delete');

    // ---- drop and import .docx; a .txt is refused
    const docx = await home.evaluate(async () => {
      await GZ_WRITER_PAPER.need(['lib/zip.js', 'lib/doctext.js', 'lib/writer-docx.js', 'lib/writer-objects-docx.js']);
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Imported from Word: the river keeps what the town forgets.' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'A second paragraph of the dropped file.' }] }] };
      return Array.from(GZ_WRITER_DOCX.exportDocx(doc, { format: GZ_WRITER_STYLES.FORMATS.plain, surname: '', title: '' }).bytes);
    });
    const docxPaths = ['a', 'b'].map((d) => { fs.mkdirSync(path.join(tmp, d)); const f = path.join(tmp, d, 'River notes.docx'); fs.writeFileSync(f, Buffer.from(docx)); return f; });
    const drop = (pg, files, phase = 'drop') => pg.evaluate(({ files, phase }) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
      const fire = (type) => document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      fire('dragenter'); fire('dragover');
      if (phase === 'drop') fire('drop');
    }, { files, phase });
    const before = (await shown()).length;
    await drop(home, [{ name: 'River notes.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docx }], 'over');
    check(await home.evaluate(() => document.getElementById('list').hasAttribute('data-drop')), 'dragging files over the page shows the drop state');
    await shot(home, 'drop-1280-en.png');
    await drop(home, [{ name: 'River notes.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docx }]);
    await until(async () => (await cards(home)).some((c) => c.title === 'River notes'), 'dropped document');
    check(!(await home.evaluate(() => document.getElementById('list').hasAttribute('data-drop'))), 'the drop state goes on drop');
    const riverKey = (await cards(home)).find((c) => c.title === 'River notes').key;
    const river = await local(`writerPaper:${riverKey}`), riverVersions = await local(`writerVersions:${riverKey}`);
    check(/^doc:/.test(riverKey) && river.kind === 'paper' && river.format === 'mla9' && JSON.stringify(river.doc).includes('the river keeps what the town forgets') && riverVersions?.length >= 1, `a dropped .docx becomes a new document in the default format, with a version (${river.format}; ${riverVersions?.map((v) => v.reason).join(', ')})`);
    check((await shown()).length === before + 1, 'one document per file');
    await drop(home, [{ name: 'notes.txt', type: 'text/plain', bytes: [104, 105] }]);
    await until(() => home.evaluate(() => document.getElementById('gd-said').textContent === 'That file could not be read as a Word document.'), 'refusal');
    check((await shown()).length === before + 1, 'a .txt is refused with "That file could not be read as a Word document." and adds nothing');
    await home.setInputFiles('#gd-file', docxPaths);
    await until(async () => (await cards(home)).filter((c) => c.title === 'River notes').length === 3, 'imported two');
    check(await home.evaluate(() => document.getElementById('gd-said').textContent === ''), 'Import .docx… takes several files, one document each, and clears the old refusal');

    await drop(home, [{ name: 'Broken.docx', bytes: [1, 2, 3] }]);
    await until(() => home.evaluate(() => document.getElementById('gd-said').textContent === 'That file could not be read as a Word document.'), 'broken Word refusal');
    check((await shown()).length === before + 3, 'a broken .docx reports its failure in the status line and creates no document');
    const beforeBatch = (await shown()).length;
    await drop(home, Array.from({ length: 23 }, (_, i) => ({ name: `Batch ${i}.docx`, bytes: docx })));
    await until(() => home.evaluate(() => document.getElementById('gd-said').textContent === 'Choose up to 20 files at a time.'), 'batch limit');
    check((await shown()).length === beforeBatch + 20, 'a 23-file drop imports 20 and reports the limit');

    // ---- Export .docx from the menu
    const download = home.waitForEvent('download');
    await home.click(`${card(ESSAY)} .gd-more`);
    await home.click('.gd-menu [data-act="export"]');
    const file = await download;
    check(/\.docx$/.test(file.suggestedFilename()), `Export .docx downloads the paper (${file.suggestedFilename()})`);

    // ---- keyboard
    await home.evaluate(() => scrollTo(0, 0));
    const order = await shown();
    await home.focus('.gd-card .gd-title[tabindex="0"]');
    const startAt = order.indexOf(await focused(home));
    await home.keyboard.press('Home');
    check(await focused(home) === order[0], 'Home goes to the first card');
    await home.keyboard.press('ArrowRight');
    check(await focused(home) === order[1], 'Right Arrow moves to the next card');
    const cols = await home.evaluate(() => { const c = [...document.querySelectorAll('.gd-card')]; return c.filter((x) => x.offsetTop === c[0].offsetTop).length; });
    await home.keyboard.press('ArrowDown');
    check(await focused(home) === order[1 + cols], `Down Arrow moves a row down (${cols} columns)`);
    await home.keyboard.press('ArrowUp');
    await home.keyboard.press('ArrowLeft');
    check(await focused(home) === order[0], 'Up and Left Arrows move back');
    await home.keyboard.press('End');
    check(await focused(home) === order.at(-1), 'End goes to the last card');
    check(await home.evaluate(() => [...document.querySelectorAll('#gd-docs a, #gd-docs button')].filter((e) => e.tabIndex >= 0).length === 1 && document.activeElement.tabIndex === 0), 'roving focus keeps one Tab stop on the focused card');
    await home.click('#gd-list');
    await home.focus('.gd-title[tabindex="0"]'); await home.keyboard.press('Home'); await home.keyboard.press('ArrowDown');
    check(await focused(home) === order[1], 'list Down Arrow moves by one row');
    await home.keyboard.press('ArrowUp'); check(await focused(home) === order[0], 'list Up Arrow moves back one row');
    await home.click('#gd-grid'); await home.focus('.gd-title[tabindex="0"]');
    await home.keyboard.press('Home');
    await home.keyboard.press('Shift+F10');
    check(await home.evaluate(() => document.activeElement?.matches('.gd-menu [role="menuitem"]')), 'Shift+F10 opens the card\'s menu');
    await home.keyboard.press('ArrowDown');
    check(await home.evaluate(() => document.activeElement === document.querySelectorAll('.gd-menu [role="menuitem"]')[1]), 'arrows move in the menu');
    await home.keyboard.press('Escape');
    check(await home.evaluate((k) => !document.querySelector('.gd-menu') && document.activeElement?.closest('.gd-card')?.dataset.key === k, order[0]), 'Esc closes the menu, focus back on the card');
    await home.keyboard.press('ContextMenu');
    check(await home.evaluate(() => !!document.querySelector('.gd-menu')), 'the ContextMenu key opens it too');
    await home.keyboard.press('Escape');
    await home.keyboard.press('/');
    check(await home.evaluate(() => document.activeElement?.id === 'gd-q'), '/ focuses search');
    await home.keyboard.type('lab');
    await until(async () => (await shown()).join() === LAB, 'typed search');
    await home.keyboard.press('Escape');
    await until(async () => (await shown()).length === order.length, 'cleared');
    check(true, 'Esc clears the search');
    await home.focus('.gd-card .gd-title[tabindex="0"]');
    await home.keyboard.press('Home');
    await home.keyboard.press('Enter');
    await until(() => home.evaluate(() => location.search.startsWith('?paper=') && !!GZ_WRITER_PAPER?.current()?.key() && document.querySelectorAll('.gp-sheet').length > 0), 'opened with Enter');
    check(await home.evaluate((k) => GZ_WRITER_PAPER.current().key() === k, order[0]), 'Enter opens the focused card in the same tab');
    check(await home.evaluate(() => Number(sessionStorage.getItem('review-disconnects')) > 0), 'leaving home disconnects its IntersectionObserver');
    await home.goBack();
    await until(() => home.evaluate(() => !location.search && document.querySelectorAll('.gd-card').length > 0), 'back home');
    check((await shown()).length === order.length, 'and Back returns to the list');
    await home.click(`${card(LAB)} .gd-title`);
    await until(() => home.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key()), 'opened by click');
    check(await home.evaluate((k) => GZ_WRITER_PAPER.current().key() === k && !document.querySelector('.gp-submit'), LAB), 'clicking a title opens it in the same tab');
    await home.click('.gp-top a');
    await until(() => home.evaluate(() => !location.search && document.querySelectorAll('.gd-card').length > 0), 'Documents link home');
    check(true, 'the editor\'s Documents link comes back to the list');

    // ---- a New tile: an untouched document leaves nothing behind
    await home.click('.gd-tile[data-format="plain"]');
    await until(() => home.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key() && GZ_WRITER_PAPER.current().format().id === 'plain'), 'new Blank');
    const fresh = await home.evaluate(() => GZ_WRITER_PAPER.current().key());
    await shot(home, 'editor-1280-en.png');
    await home.click('.gp-top a');
    await until(() => home.evaluate(() => document.querySelectorAll('.gd-card').length > 0), 'home after new');
    check(!(await local(`writerPaper:${fresh}`)) && !(await shown()).includes(fresh), 'a New tile opens a fresh document; untouched, it leaves nothing behind');

    for (const format of ['mla9', 'apa7', 'chicago17']) {
      await home.click(`.gd-tile[data-format="${format}"]`);
      await until(() => home.evaluate(() => !!GZ_WRITER_PAPER.current()?.key()), `new ${format}`);
      const key = await home.evaluate(() => GZ_WRITER_PAPER.current().key());
      await home.click('.gp-top a'); await until(() => home.evaluate(() => !document.getElementById('list').hidden), 'home after formatted New');
      check(!(await local(`writerPaper:${key}`)), `an untouched New ${format} leaves no empty record`);
    }

    // Unknown routes return home without writing or mounting a paper over another kind.
    const unknown = `doc:${crypto.randomUUID()}`;
    const future = { ...(await local(`writerPaper:${NOTES}`)), key: unknown, kind: 'future-kind' };
    await worker.evaluate(async (r) => chrome.storage.local.set({ [`writerPaper:${r.key}`]: r }), future);
    for (const key of ['not-a-key', `doc:${crypto.randomUUID()}`, unknown]) {
      const pg = await context.newPage(); watch(pg, 'unknown route');
      await pg.goto(`${HOME}?paper=${encodeURIComponent(key)}`);
      await until(() => pg.evaluate(() => !document.getElementById('list').hidden), 'unknown route home');
      check(await pg.evaluate(() => !GZ_WRITER_PAPER.current() && !location.search), 'an invalid, missing or unsupported-kind paper route returns home');
      await pg.close();
    }
    check(JSON.stringify(await local(`writerPaper:${unknown}`)) === JSON.stringify(future), 'an unsupported kind stays unchanged');
    await worker.evaluate(async (k) => chrome.storage.local.remove(`writerPaper:${k}`), unknown);

    // ---- 640 px, and German
    const narrow = async (pg, lang) => {
      await pg.setViewportSize({ width: 640, height: 900 });
      await pg.evaluate(() => scrollTo(0, 0));
      const lay = await pg.evaluate(() => { const c = [...document.querySelectorAll('.gd-card')]; const q = document.getElementById('gd-q').closest('.gd-search').getBoundingClientRect(), s = document.getElementById('gd-sort').getBoundingClientRect(); return { cols: c.filter((x) => x.offsetTop === c[0].offsetTop).length, own: q.bottom <= s.top + 1, wide: document.documentElement.scrollWidth <= innerWidth }; });
      check(lay.cols === 2 && lay.own && lay.wide, `${lang} 640 px: two columns, search on its own line, nothing wider than the window (${JSON.stringify(lay)})`);
      await shot(pg, `grid-640-${lang}.png`);
      await pg.click('#gd-list'); await shot(pg, `list-640-${lang}.png`); await pg.click('#gd-grid');
      const first = await pg.evaluate(() => document.querySelector('.gd-card').dataset.key);
      await pg.click(`.gd-card[data-key="${first}"] .gd-more`); await shot(pg, `menu-640-${lang}.png`); await pg.keyboard.press('Escape');
      const named = await pg.evaluate(() => [...document.querySelectorAll('.gd-card')].find((c) => c.dataset.key.startsWith('doc:')).dataset.key);
      await pg.focus(`.gd-card[data-key="${named}"] .gd-title`); await pg.keyboard.press('F2'); await shot(pg, `rename-640-${lang}.png`); await pg.keyboard.press('Escape');
      await drop(pg, [{ name: 'River notes.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docx }], 'over'); await shot(pg, `drop-640-${lang}.png`);
      await pg.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.docx')); document.body.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true, relatedTarget: null })); });
      check(!(await pg.evaluate(() => document.getElementById('list').hasAttribute('data-drop'))), `${lang}: the drop state goes when the drag leaves the window`);
      await pg.setViewportSize({ width: 1280, height: 900 });
    };
    await narrow(home, 'en');
    await home.setViewportSize({ width: 640, height: 900 });
    await home.focus(`${card(copyKey)} .gd-title`); await home.keyboard.press('Delete'); await until(() => home.evaluate(() => !!document.querySelector('.gd-toast')), 'toast 640'); await shot(home, 'undo-640-en.png'); await home.keyboard.press('ControlOrMeta+z');
    await until(async () => (await shown()).includes(copyKey), 'undo at 640');
    await home.click('.gd-tile[data-format="mla9"]');
    await until(() => home.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key() && document.querySelectorAll('.gp-sheet').length > 0), 'editor at 640');
    await shot(home, 'editor-640-en.png');
    await home.close();

    const de = await openHome('de', 'home de');
    check(await de.evaluate(() => document.title === 'Dokumente' && document.querySelector('h1').textContent === 'Dokumente' && document.querySelector('.gd-new h2').textContent === 'Neu' && document.querySelector('.gd-tile-name').textContent === 'Leer'), 'German: Dokumente, Neu, Leer');
    check(await de.evaluate(() => document.getElementById('gd-count').textContent === `${document.querySelectorAll('.gd-card').length} Dokumente` && document.getElementById('gd-grid').getAttribute('aria-label') === 'Raster'), 'German: the live region and the view buttons are translated');
    await until(() => de.evaluate(() => __gd.renders.length >= 12), 'de thumbnails');
    await shot(de, 'grid-1280-de.png');
    await de.click('#gd-list'); await shot(de, 'list-1280-de.png'); await de.click('#gd-grid');
    await de.click(`${card(NOTES)} .gd-more`); await shot(de, 'menu-1280-de.png');
    check(await de.evaluate(() => [...document.querySelectorAll('.gd-menu [role="menuitem"]')].map((b) => b.textContent).join('|') === 'Umbenennen|Kopie erstellen|.docx exportieren|Löschen'), 'German menu: Umbenennen, Kopie erstellen, .docx exportieren, Löschen');
    await de.keyboard.press('Escape');
    await de.focus(`${card(NOTES)} .gd-title`); await de.keyboard.press('F2'); await shot(de, 'rename-1280-de.png'); await de.keyboard.press('Escape');
    await de.focus(`${card(copyKey)} .gd-title`); await de.keyboard.press('Delete');
    await until(() => de.evaluate(() => document.querySelector('.gd-toast')?.textContent === 'GelöschtRückgängig'), 'German toast');
    check(true, 'German toast: Gelöscht, Rückgängig');
    await shot(de, 'undo-1280-de.png'); await de.keyboard.press('ControlOrMeta+z');
    await until(async () => (await de.evaluate(() => [...document.querySelectorAll('.gd-card')].map((c) => c.dataset.key))).includes(copyKey), 'de undo');
    await drop(de, [{ name: 'River notes.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docx }], 'over'); await shot(de, 'drop-1280-de.png');
    await de.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.docx')); document.body.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true, relatedTarget: null })); });
    await narrow(de, 'de');
    await de.setViewportSize({ width: 640, height: 900 });
    await de.focus(`${card(copyKey)} .gd-title`); await de.keyboard.press('Delete'); await until(() => de.evaluate(() => !!document.querySelector('.gd-toast')), 'de toast 640'); await shot(de, 'undo-640-de.png'); await de.keyboard.press('ControlOrMeta+z');
    await until(async () => (await de.evaluate(() => [...document.querySelectorAll('.gd-card')].map((c) => c.dataset.key))).includes(copyKey), 'de undo 640');
    await de.setViewportSize({ width: 1280, height: 900 });
    await de.click('.gd-tile[data-format="apa7"]');
    await until(() => de.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key() && document.querySelectorAll('.gp-sheet').length > 0), 'de editor');
    check(await de.evaluate(() => document.querySelector('.gp-top a').textContent === 'Dokumente'), 'German editor header: the Dokumente link');
    await shot(de, 'editor-1280-de.png');
    await de.setViewportSize({ width: 640, height: 900 });
    await shot(de, 'editor-640-de.png');
    await de.close();

    // The store's 2000-row ceiling: visiting distant cards evicts thumbnails instead of retaining every image tree.
    const base = await local('writerPapers'), extras = Array.from({ length: 2000 - base.length }, () => `doc:${crypto.randomUUID()}`);
    await worker.evaluate(async ({ keys, source }) => {
      const data = {}, rows = (await chrome.storage.local.get('writerPapers')).writerPapers;
      for (const key of keys) { const r = { ...source, key, title: 'Archive', named: true, updated: 1 }; data[`writerPaper:${key}`] = r; rows.push({ key, kind: r.kind, named: true, title: r.title, course: '', url: '', words: r.words, format: r.format, updated: 1, submitted: null }); }
      await chrome.storage.local.set({ ...data, writerPapers: rows });
    }, { keys: extras, source: await local(`writerPaper:${FIELD}`) });
    const archive = await openHome('en', '2000 documents');
    check(await archive.evaluate(() => document.querySelectorAll('.gd-card').length === 2000), 'the 2000-document index paints every row');
    for (let i = 0; i < 2000; i += 200) {
      await archive.evaluate((i) => document.querySelectorAll('.gd-card')[i].scrollIntoView({ block: 'start' }), i);
      await until(() => archive.evaluate((i) => !!document.querySelectorAll('.gd-card')[i].querySelector('.gt-thumb'), i), `archive ${i}`);
    }
    check(await archive.evaluate(() => document.querySelectorAll('.gd-pic .gt-thumb').length <= 48), '2000 documents retain at most 48 thumbnail trees after distant scrolls');
    await archive.close();
    await worker.evaluate(async (keys) => { const gone = new Set(keys); await chrome.storage.local.remove(keys.map((k) => `writerPaper:${k}`)); await chrome.storage.local.set({ writerPapers: (await chrome.storage.local.get('writerPapers')).writerPapers.filter((r) => !gone.has(r.key)) }); }, extras);

    // Light Paper Look, both sizes and languages, with measured title and metadata contrast on the actual card.
    const light = G.GZ_SANITIZE({ ...settings, preset: 'Paper', colors: G.GZ_PRESET('Paper') });
    await worker.evaluate(async (s) => chrome.storage.sync.set(s), light);
    for (const lang of ['en', 'de']) {
      const pg = await openHome(lang, `light ${lang}`);
      await until(() => pg.evaluate(() => !document.documentElement.hasAttribute('data-dark')), 'light Look');
      for (const width of [1280, 640]) {
        await pg.setViewportSize({ width, height: 900 }); await pg.evaluate(() => scrollTo(0, 0));
        await shot(pg, `grid-${width}-${lang}-light.png`);
        const contrast = await pg.evaluate(() => {
          // Through a canvas: a color-mix() fill serialises as color(srgb …).
          const g = new OffscreenCanvas(1, 1).getContext('2d'), rgb = (s) => { g.clearRect(0, 0, 1, 1); g.fillStyle = s; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
          const lum = (c) => c.map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
          const bg = lum(rgb(getComputedStyle(document.querySelector('.gd-card')).backgroundColor));
          return ['.gd-title', '.gd-meta'].map((sel) => { const fg = lum(rgb(getComputedStyle(document.querySelector(sel)).color)); return (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05); });
        });
        check(contrast.every((v) => v >= 4.5), `light ${lang} ${width}: card title and metadata meet 4.5:1 (${contrast.map((v) => v.toFixed(2)).join(', ')})`);
        await pg.click('#gd-list'); await shot(pg, `list-${width}-${lang}-light.png`); await pg.click('#gd-grid');
      }
      await pg.close();
    }

    // ---- the page wears the student's Look, as Settings does: ground, background, glass, fonts, corners, motion
    // Four Looks: Frost (the default palette, a solid ground), Library (light), Frostdev (a scene drawn by the shader painter)
    // and a busy photo (pure black and white blocks and lines at a low dim). The photo is served here, from no network.
    const photo = await worker.evaluate(async () => {
      const c = new OffscreenCanvas(1600, 1000), g = c.getContext('2d'), cols = ['#000000', '#ffffff', '#ff2d55', '#ffd60a', '#0a84ff', '#30d158', '#ffffff', '#000000', '#bf5af2'];
      for (let y = 0; y < 1000; y += 25) for (let x = 0; x < 1600; x += 40) { g.fillStyle = cols[(x / 40 + (y / 25) * 3) % cols.length]; g.fillRect(x, y, 40, 25); }
      for (let i = 0; i < 400; i++) { g.strokeStyle = cols[i % cols.length]; g.lineWidth = 2 + (i % 5); g.beginPath(); g.arc((i * 97) % 1600, (i * 61) % 1000, 10 + ((i * 13) % 120), 0, 7); g.stroke(); }
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    });
    await context.route('https://photos.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(photo, 'base64') }));
    const C = require(path.join(root, 'lib/color.js')), F = require(path.join(root, 'lib/fonts.js'));
    const lookOf = (name, over = {}) => { const L = G.GZ_LOOKS.find((x) => x.name === name); return G.GZ_SANITIZE({ ...settings, ...G.GZ_LOOK_APPLY(settings, L), ...over }); };
    const LOOKS = {
      frost: settings,
      light: lookOf('Library'),
      scene: lookOf('Frostdev'),
      photo: lookOf('Lagoon', { bg: { ...G.GZ_DEFAULTS.bg, kind: 'image', image: 'https://photos.test/busy.png', dim: 0 } }),
      lightPhoto: lookOf('Library', { bg: { ...G.GZ_DEFAULTS.bg, kind: 'image', image: 'https://photos.test/busy.png', dim: 0 } }),
    };
    const wearLook = (s) => worker.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); }, s);
    const rgbOf = (hex) => `rgb(${hex.match(/\w\w/g).map((x) => parseInt(x, 16)).join(', ')})`;
    // What the page wears: its ground, the backdrop and what the backdrop's painter has, the glass, fonts and corners.
    const worn = (pg) => pg.evaluate(() => {
      const html = document.documentElement, b = document.getElementById('gd-backdrop'), inner = b?.contentDocument?.documentElement;
      const card = getComputedStyle(document.querySelector('.gd-card')), top = getComputedStyle(document.querySelector('.gd-top'));
      // A colour as sRGB bytes, through a canvas (color-mix() serialises as color(srgb …)).
      const g = new OffscreenCanvas(1, 1).getContext('2d'), rgb = (css) => { g.clearRect(0, 0, 1, 1); g.fillStyle = css; g.fillRect(0, 0, 1, 1); return `rgb(${[...g.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(', ')})`; };
      return { ground: rgb(getComputedStyle(html).backgroundColor), body: getComputedStyle(document.body).backgroundImage + ' ' + getComputedStyle(document.body).backgroundColor, bg: html.getAttribute('data-gz-bg'),
        dark: html.hasAttribute('data-dark'), motion: html.dataset.motion, backdrop: !!b, shown: !!b?.hasAttribute('data-shown'), innerBg: inner?.getAttribute('data-gz-bg') ?? null,
        innerMotion: inner?.getAttribute('data-gz-motion') ?? null, scene: !!inner?.querySelector('#gz-scene'), cardBlur: card.backdropFilter, topBlur: top.backdropFilter,
        cardRadius: card.borderTopLeftRadius, head: getComputedStyle(document.querySelector('h1')).fontFamily, body2: getComputedStyle(document.body).fontFamily };
    });
    // The worst contrast between an element's text colour and every pixel under its text: the text made transparent, its box
    // photographed, each pixel's luminance against the ink's.
    const contrastOn = async (pg, sel) => {
      const box = await pg.evaluate((sel) => {
        const el = document.querySelector(sel), r = el.getBoundingClientRect(), color = getComputedStyle(el).color;
        el.style.setProperty('color', 'transparent', 'important');
        return { x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, r.height), color };
      }, sel);
      await pause(120);
      const png = await pg.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
      await pg.evaluate((sel) => document.querySelector(sel).style.removeProperty('color'), sel);
      return pg.evaluate(async ({ b64, color }) => {
        const bm = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
        const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d');
        g.drawImage(bm, 0, 0);
        const d = g.getImageData(0, 0, bm.width, bm.height).data;
        const lum = (r, gr, b) => [r, gr, b].map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
        const one = new OffscreenCanvas(1, 1).getContext('2d');
        one.fillStyle = color; one.fillRect(0, 0, 1, 1);
        const L = lum(...one.getImageData(0, 0, 1, 1).data.slice(0, 3));
        let min = Infinity;
        for (let i = 0; i < d.length; i += 4) { const l = lum(d[i], d[i + 1], d[i + 2]); min = Math.min(min, (Math.max(l, L) + .05) / (Math.min(l, L) + .05)); }
        return min;
      }, { b64: png.toString('base64'), color: box.color });
    };
    // A strip of the page's margin, beside the panels: only the background shows there.
    const margin = (pg) => pg.screenshot({ clip: { x: 2, y: 120, width: 18, height: 300 } });
    const lookPage = async (name) => {
      await wearLook(LOOKS[name]);
      const pg = await openHome('en', `look ${name}`);
      await until(() => pg.evaluate(() => !!document.querySelector('.gd-pic .gt-thumb')), `${name} thumbnails`);
      return pg;
    };
    for (const name of ['frost', 'light', 'scene', 'photo', 'lightPhoto']) {
      const s = LOOKS[name], art = s.bg.kind !== 'solid', pg = await lookPage(name);
      const colors = G.GZ_ACTIVE_COLORS(s, false);
      if (art) await until(() => pg.evaluate(() => document.getElementById('gd-backdrop')?.hasAttribute('data-shown')), `${name} backdrop shown`);
      // A scene's canvas follows its module's import, after the frame already wears the Look's ground.
      if (s.bg.kind === 'scene') await until(() => pg.evaluate(() => !!document.getElementById('gd-backdrop').contentDocument.querySelector('#gz-scene')), `${name} scene canvas`, 10000).catch(() => {});
      const w = await worn(pg);
      fs.writeFileSync(path.join(out, `look-${name}.json`), JSON.stringify(w, null, 1));
      check(w.ground === rgbOf(colors['--gz-surface-2']) && /none rgba\(0, 0, 0, 0\)/.test(w.body), `${name}: the page's ground is the Look's (${w.ground}, the body clear)`);
      check(w.dark === (C.brightness(C.parse(colors['--gz-surface'])) < .5), `${name}: data-dark follows the Look (${w.dark})`);
      check(w.cardRadius === `${s.look.radius}px`, `${name}: cards take the Look's corners (${w.cardRadius})`);
      const bare = (f) => f.replace(/["']/g, '').replace(/\s*,\s*/g, ',');
      check(bare(w.head) === bare(F.stack(s.look.head === 'auto' ? s.look.font : s.look.head)) && bare(w.body2) === bare(F.stack(s.look.font)), `${name}: the Look's fonts, its heading font on the headings (${w.head})`);
      if (art) {
        check(w.backdrop && w.shown && w.innerBg === w.bg && w.bg === (s.bg.kind === 'image' ? 'image' : s.bg.kind), `${name}: the Look's background is drawn behind the page by Settings' painter (${w.innerBg})`);
        check(/blur\(/.test(w.cardBlur) && /blur\(/.test(w.topBlur), `${name}: the panels and cards are glass over it (${w.cardBlur})`);
        // Reduced motion (this browser's, followed by default): the painter's motion is off and the background holds still.
        const frames = () => pg.evaluate(() => document.getElementById('gd-backdrop').contentWindow.__gdRAF);
        const beforeFrames = await frames();
        const a = await margin(pg); await pause(700); const b = await margin(pg);
        check(await frames() === beforeFrames, `${name}: reduced motion schedules no continuing animation frames`);
        check(w.motion === 'off' && w.innerMotion === 'off' && a.equals(b), `${name}: under reduced motion the background is a still frame (motion ${w.motion}/${w.innerMotion})`);
      } else check(!w.backdrop && w.cardBlur === 'none', `${name}: a solid Look draws no background frame and no blur (${w.cardBlur})`);
      if (name === 'scene') {
        check(w.scene || errors.some((e) => /WebGL/i.test(e)), `scene: the shader's canvas is in the backdrop (${w.scene})`);
        if (w.scene) {
          await pg.emulateMedia({ reducedMotion: 'no-preference' });
          await until(() => pg.evaluate(() => document.getElementById('gd-backdrop').contentDocument.documentElement.getAttribute('data-gz-motion') === 'expressive' && document.documentElement.dataset.motion === 'expressive'), 'scene motion on');
          const a = await margin(pg); await pause(900); const b = await margin(pg);
          check(!a.equals(b), 'scene: with motion on the background moves');
          await pg.emulateMedia({ reducedMotion: 'reduce' });
        }
      }
      for (const sel of ['.gd-card .gd-title', '.gd-card .gd-meta', 'h1', '.gd-tile-name']) {
        const k = await contrastOn(pg, sel);
        check(Number.isFinite(k) && k >= 4.5, `${name}: ${sel} reads at ${k.toFixed(2)}:1 or better against every pixel under it`);
      }
      if (name === 'photo' || name === 'lightPhoto') {
        await pg.click('.gd-card:first-child .gd-more');
        const menuContrast = await contrastOn(pg, '.gd-menu [role=menuitem]');
        check(Number.isFinite(menuContrast) && menuContrast >= 4.5, `${name}: the menu text meets 4.5:1 over the photo (${menuContrast.toFixed(2)})`);
        await pg.click('.gd-menu button:text-is("Delete")');
        await pg.waitForSelector('.gd-toast-do');
        for (const sel of ['.gd-toast > span', '.gd-toast-do']) {
          const k = await contrastOn(pg, sel);
          check(Number.isFinite(k) && k >= 4.5, `${name}: ${sel} meets 4.5:1 over the photo (${k.toFixed(2)})`);
        }
        await pg.click('.gd-toast-do');
        await until(() => pg.evaluate(() => !document.querySelector('.gd-toast')), 'photo deletion undone');
      }
      for (const width of [1280, 640]) {
        await pg.setViewportSize({ width, height: 900 }); await pg.evaluate(() => scrollTo(0, 0));
        const rows = await pg.evaluate(() => new Set([...document.querySelectorAll('.gd-tile')].map((t) => t.offsetTop)).size);
        check(rows === 1, `${name} ${width}: the four New tiles keep one row inside the panel (${rows})`);
        await shot(pg, `look-${name}-${width}.png`);
      }
      await pg.close();
    }
    // A Look changed in Settings or the popup repaints an open page: solid Frost to the Frostdev scene and back.
    await wearLook(LOOKS.frost);
    const live = await openHome('en', 'look live');
    check((await worn(live)).backdrop === false, 'live: Frost starts with no background frame');
    await worker.evaluate(async (s) => chrome.storage.sync.set(s), LOOKS.scene);
    await until(() => live.evaluate(() => document.documentElement.getAttribute('data-gz-bg') === 'scene' && document.getElementById('gd-backdrop')?.hasAttribute('data-shown')), 'live repaint to scene');
    const w2 = await worn(live);
    check(w2.cardRadius === '16px' && /blur\(/.test(w2.cardBlur) && /Manrope/i.test(w2.head), `live: a Look change in storage repaints the open page (${w2.cardRadius}, ${w2.head})`);
    await worker.evaluate(async (s) => chrome.storage.sync.set(s), LOOKS.light);
    await until(() => live.evaluate(() => !document.documentElement.hasAttribute('data-dark') && !document.getElementById('gd-backdrop')), 'live repaint to light');
    check(true, 'live: back to a solid light Look, the background frame goes');
    await live.close();
    await wearLook(settings);

    // ---- a mod on the Documents page: its items, its calls and their limits (lib/modbroker.js, features/mods.js)
    const MOD = 'docsmodaaaaaaaaa';
    const hooksJs = `
      const save = (k, v) => glaze.storage.set(k, v);
      const page = new Promise((ok) => glaze.on('page', ok)); // told once, as the mod starts
      const tryCall = async (k, f) => { try { await save(k, { ok: true, value: await f() }); } catch (e) { await save(k, { ok: false, error: e.message }); } };
      glaze.on('documents.action', async (d) => {
        await save('action', d);
        if (d.slot === 'documents.card') {
          await tryCall('read', () => glaze.documents.read(d.doc.key));
          await tryCall('export', async () => { const f = await glaze.documents.export(d.doc.key); return { name: f.name, mime: f.mime, size: f.bytes.length, zip: f.bytes[0] === 0x50 && f.bytes[1] === 0x4b }; });
        } else {
          const list = await glaze.documents.list();
          await tryCall('open', () => glaze.documents.open(list[0].key));
        }
      });
      (async () => {
        await glaze.documents.add('documents.toolbar', { id: 'newest', label: 'Open newest' });
        await glaze.documents.add('documents.card', { id: 'peek', label: 'Peek' });
        await tryCall('page', () => page);
        await tryCall('list', () => glaze.documents.list());
        await tryCall('early', () => glaze.documents.open('doc:00000000-0000-0000-0000-000000000000'));
        await tryCall('todo', () => glaze.todo());
        await tryCall('style', () => glaze.documents.style({ radius: 24, column: 300 }));
        await save('ready', true);
      })();`;
    const modRec = { id: MOD, enabled: true, hash: 'h', key: 'k', version: '1.0.0', source: 'file', installedAt: 1, dev: false,
      manifest: { glaze: 1, name: 'Doc Tools', version: '1.0.0', permissions: [{ id: 'documents', why: 'w' }, { id: 'documents.read', why: 'w' }], hooks: 'hooks.js' },
      grants: { documents: true, 'documents.read': true }, files: { 'hooks.js': Buffer.from(hooksJs).toString('base64') } };
    await worker.evaluate(async (data) => chrome.storage.local.set(data), { mods: [MOD], [`mod:${MOD}`]: modRec });
    const modData = () => local(`modData:${MOD}`);
    const mp = await openHome('en', 'mod');
    await until(async () => (await modData())?.ready, 'mod ready', 20000);
    const md = await modData();
    fs.writeFileSync(path.join(out, 'mod-data.json'), JSON.stringify({ ...md, list: { ok: md.list.ok, n: md.list.value?.length, first: md.list.value?.[0] } }, null, 1));
    check(md.page?.value?.site === 'documents' && md.page.value.kind === 'documents', `mod: its page event says the Documents page (${JSON.stringify(md.page?.value)})`);
    const tool = await mp.evaluate(() => [...document.querySelectorAll('.gd-extra button')].map((b) => ({ text: b.textContent, title: b.title })));
    check(tool.length === 1 && tool[0].text === 'Open newest' && tool[0].title === 'Doc Tools', `mod: its documents.toolbar item renders in the toolbar with its name (${JSON.stringify(tool)})`);
    const nativeList = await mp.evaluate(() => GZ_DOCUMENTS.list());
    const shownKeys = nativeList.map((d) => d.key);
    const PUBLIC = 'course,format,key,kind,title,updated,words';
    check(md.list.ok && md.list.value.length === shownKeys.length && md.list.value.every((d) => Object.keys(d).sort().join() === PUBLIC) && md.list.value.every((d) => /^document:[0-9a-f-]{36}$/.test(d.key)) && md.list.value.every((d, i) => JSON.stringify({ ...d, key: '' }) === JSON.stringify({ ...nativeList[i], key: '' })),
      `mod: documents.list() gives every listed document's public fields only (${md.list.value?.length} × ${Object.keys(md.list.value?.[0] || {}).sort().join(' ')})`);
    check(!JSON.stringify(md.list.value).includes('Beloved 1. A paragraph') && md.list.value.find((d) => d.title === 'Essay 2: Memory in Beloved')?.course === 'ENGL 2110' && !JSON.stringify(md.list.value).includes('bb.school.test') && !JSON.stringify(md.list.value).includes('_900_1'), 'mod: the list carries no document text, and an assignment paper\'s course');
    check(md.early.ok === false && md.early.error === 'permission', `mod: documents.open without a click on its own item is refused (${md.early.error})`);
    await mp.evaluate(() => document.querySelector('.gd-extra button').click());
    await until(async () => (await modData())?.open, 'synthetic mod item click');
    check((await modData()).open.error === 'permission' && new URL(mp.url()).search === '', 'mod: a synthetic item click cannot authorize opening a document');
    check(md.todo.ok === false && md.todo.error === 'call', `mod: a school page's call is refused on the Documents page (${md.todo.error})`);
    check(md.style.ok && await mp.evaluate(() => getComputedStyle(document.querySelector('.gd-card')).borderTopLeftRadius === '24px' && getComputedStyle(document.documentElement).getPropertyValue('--gd-column').trim() === '300px'), 'mod: documents.style sets the page\'s --gd-* hooks (24px corners, 300px columns)');
    await shot(mp, 'look-mod-1280.png');
    await mp.click(`${card(NOTES)} .gd-more`);
    const menuItems = await mp.evaluate(() => [...document.querySelectorAll('.gd-menu [role="menuitem"], .gd-menu [role="separator"]')].map((b) => b.getAttribute('role') === 'separator' ? '—' : b.textContent));
    check(menuItems.join('|') === 'Rename|Make a copy|Export .docx|Delete|—|Peek', `mod: its documents.card item follows Glaze's own in a card's ⋯ menu (${menuItems.join(' | ')})`);
    await shot(mp, 'look-mod-menu-1280.png');
    await mp.click('.gd-menu .gd-added');
    await until(async () => (await modData())?.export, 'mod card action');
    const act = await modData();
    check(act.action.slot === 'documents.card' && act.action.id === 'peek' && act.action.doc.key === md.list.value.find((d) => d.title === 'Reading notes').key && Object.keys(act.action.doc).sort().join() === PUBLIC, `mod: a card item's click tells the mod that card's summary (${JSON.stringify(act.action.doc)})`);
    fs.writeFileSync(path.join(out, 'mod-action.json'), JSON.stringify({ ...act, list: undefined }, null, 1));
    const notesText = require(path.join(root, 'lib/doc-home.js')).flat((await local(`writerPaper:${NOTES}`)).doc);
    check(act.read.ok && act.read.value.key === act.action.doc.key && act.read.value.title === act.action.doc.title && act.read.value.text === notesText && notesText.includes('the house on Bluestone Road'), 'mod: documents.read (documents.read) gives the document\'s text, as stored');
    check(act.export.ok && /\.docx$/.test(act.export.value.name) && act.export.value.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && act.export.value.size > 1000 && act.export.value.zip, `mod: documents.export gives the .docx through its kind (${JSON.stringify(act.export.value)})`);
    await mp.click('.gd-extra button');
    await until(() => mp.evaluate(() => /[?&]paper=/.test(location.search)), 'mod open after a click');
    const opened = new URLSearchParams(await mp.evaluate(() => location.search)).get('paper');
    check(opened === nativeList[0].key, `mod: documents.open right after a click on its own item opens that document (${opened})`);
    await mp.close();
    // Without the documents grant the mod doesn't run here.
    await worker.evaluate(async ({ id, rec }) => chrome.storage.local.set({ [`mod:${id}`]: { ...rec, grants: { documents: false, 'documents.read': true } }, [`modData:${id}`]: {} }), { id: MOD, rec: modRec });
    const off = await openHome('en', 'mod off');
    await pause(1500);
    check(await off.evaluate(() => !document.querySelector('.gd-extra button')) && !(await modData())?.ready, 'mod: without the documents grant it does not run on the Documents page');
    await off.close();
    await worker.evaluate(async (id) => chrome.storage.local.remove(['mods', `mod:${id}`, `modData:${id}`, `modPrivate:${id}`]), MOD);

    check(!errors.some((e) => /sender/.test(e)), 'no worker sender refusals');
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    check(requests.length === 0, `no network requests (${requests.join(', ')})`);
    passed = true;
    console.log(`documents-check: ${checks.length} passed, 0 failed`);
    console.log(JSON.stringify({ checks: checks.length, shots: saved }, null, 2));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, errors, requests }, null, 2) + '\n');
  }
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), `${e.stack}\n`); process.exitCode = 1; });
