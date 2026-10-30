// The Documents home (papers.html) in the real unpacked extension: the New band, the grid's lazy thumbnails and their
// cost, the list view and its kept choice, search by title and by body text, the course filter, sort, rename (seen by an
// open editor), Make a copy, Delete to Trash and Undo (versions kept), the Trash (its view, Restore, Delete forever, opening
// one, the 30-day purge, and nothing trashed in search, courses or a mod's list), .docx drop and import and a refused .txt, the keyboard,
// accessible names and the live region, opening a card in the same tab and coming back; the student's Look on the page
// (ground, background and its motion, glass, fonts, corners, contrast over a busy photo, a live change), a mod's items
// and calls there, and the page in motion (papers-motion.js: a document opening out of its card or New tile and folding
// back with the list as it was, glides, menus, the toast; Expressive, Subtle, Off and reduced motion). Screenshots at 1280
// and 640 px in English and German, look-*.png on four Looks, and motion-*.png frames of the motion. Synthetic records
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
    await until(async () => { const n = await home.evaluate(() => __gd.renders.length); if (n <= rendersBefore) throw Error(`${n} renders, ${rendersBefore} before the scroll`); return true; }, 'evicted thumbnails redrawn at the top', 30000);
    check(true, 'evicted thumbnails are redrawn when revisited');
    const cached = await home.evaluate(() => __gd.renders.length);
    await worker.evaluate(async () => { const r = await chrome.storage.local.get('writerPapers'); await chrome.storage.local.set(r); });
    await pause(150);
    check((await home.evaluate(() => __gd.renders.length)) === cached, 'an unchanged index never redraws cached thumbnails');
    check(await home.evaluate((k) => document.querySelector(`.gd-card[data-key="${k}"] img`)?.getAttribute('src').startsWith('data:image/png;base64,'), NOTES), 'a thumbnail keeps the inline data-URL picture');
    list = await cards(home);
    const essay = list.find((c) => c.key === ESSAY), lab = list.find((c) => c.key === LAB);
    check(essay.title === 'Essay 2: Memory in Beloved' && /^ENGL 2110\s·\sMLA\s9\s·\s\d+\swords\s·\s/.test(essay.meta), `an assignment paper's card: its title, course, format, words and date (${essay.meta})`);
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
    await home.fill('#gd-q', 'never-present');
    await until(async () => { const [n, s] = [(await shown()).length, await said(home)]; if (n || s !== '0 documents') throw Error(`${n} cards, "${s}"`); return true; }, 'no match for never-present', 30000);
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

    // ---- Delete (to Trash) and Undo; the Delete key and Ctrl+Z
    const versionsBefore = (await local(`writerVersions:${NOTES}`)).map((v) => v.id);
    check(await home.evaluate(() => document.getElementById('gd-trash').closest('.gd-bin').hidden), 'with nothing in Trash the toolbar has no Trash control');
    await home.click(`${card(NOTES)} .gd-more`);
    await home.click('.gd-menu [data-act="delete"]');
    check(!(await shown()).includes(NOTES), 'Delete takes the card away at once');
    await until(async () => Number.isFinite((await local(`writerPaper:${NOTES}`))?.trashed), 'trashed in storage');
    const binnedNotes = await local(`writerPaper:${NOTES}`);
    check(JSON.stringify(binnedNotes.doc) === JSON.stringify(renamed.doc) && binnedNotes.updated === renamed.updated && (await local(`writerVersions:${NOTES}`)).map((v) => v.id).join() === versionsBefore.join()
      && (await local('writerPapers')).find((r) => r.key === NOTES).trashed === binnedNotes.trashed, 'Delete marks the paper and its index row trashed, its document, Last edited and versions untouched');
    check(await home.evaluate(() => document.querySelector('.gd-toast')?.textContent.startsWith('Deleted') && document.querySelector('.gd-toast button')?.textContent === 'Undo' && !document.getElementById('gd-trash').closest('.gd-bin').hidden), 'a Deleted toast offers Undo, and the Trash control shows');
    await shot(home, 'undo-1280-en.png');
    await home.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime); globalThis.__undoSend = send;
      chrome.runtime.sendMessage = (m, ...rest) => m?.op === 'untrash' ? Promise.resolve({ ok: false, error: 'intentional review refusal' }) : send(m, ...rest);
    });
    await home.click('.gd-toast button');
    await until(() => home.evaluate(() => document.getElementById('gd-said').textContent === 'Not saved. Try again in a moment.'), 'Undo failure reported');
    check(await home.evaluate(() => !!document.querySelector('.gd-toast button')) && !(await shown()).includes(NOTES), 'a refused Undo says so, leaves the card in Trash and stays available for retry');
    await home.evaluate(() => { chrome.runtime.sendMessage = __undoSend; });
    await home.click('.gd-toast button');
    await until(async () => (await shown()).includes(NOTES), 'undone');
    const back = await local(`writerPaper:${NOTES}`), versionsAfter = (await local(`writerVersions:${NOTES}`) || []).map((v) => v.id);
    check(back?.title === 'Reading notes, revised' && JSON.stringify(back.doc) === JSON.stringify(renamed.doc) && versionsBefore.every((v) => versionsAfter.includes(v)) && !('trashed' in back), `Undo takes the document out of Trash with its versions (${versionsAfter.join(', ')})`);
    check(back.updated === renamed.updated && versionsAfter.join() === versionsBefore.join(), 'Undo keeps Last edited and restores exactly the original versions, with no extra start');
    check(await focused(home) === NOTES, 'Undo returns focus to the restored document');
    check(!(await home.evaluate(() => !!document.querySelector('.gd-toast'))), 'the toast goes once undone');
    await home.focus(`${card(copyKey)} .gd-title`);
    await home.keyboard.press('Delete');
    check(!(await shown()).includes(copyKey), 'the Delete key deletes the focused card');
    await until(async () => Number.isFinite((await local(`writerPaper:${copyKey}`))?.trashed), 'copy deleted');
    check(await home.evaluate(() => document.activeElement?.closest('.gd-card') != null), 'focus stays in the cards after a delete');
    await home.keyboard.press('ControlOrMeta+z');
    await until(async () => (await shown()).includes(copyKey) && !('trashed' in (await local(`writerPaper:${copyKey}`))), 'Ctrl+Z undo');
    check(true, 'Ctrl+Z while the toast shows undoes the delete');

    // ---- the Trash: its own view, newest trashed first, out of search and the course choices; Restore, Delete forever, and
    // a document opened from it restored first
    const binned = async () => home.evaluate(() => [...document.querySelectorAll('.gd-card')].map((c) => c.dataset.key));
    const binOn = () => home.evaluate(() => document.getElementById('gd-trash').getAttribute('aria-pressed') === 'true');
    await home.focus(`${card(FIELD)} .gd-title`); await home.keyboard.press('Delete');
    await until(async () => Number.isFinite((await local(`writerPaper:${FIELD}`))?.trashed), 'field notes trashed');
    await home.click(`${card(LAB)} .gd-more`); await home.click('.gd-menu [data-act="delete"]');
    await until(async () => Number.isFinite((await local(`writerPaper:${LAB}`))?.trashed), 'lab trashed');
    const courseNow = await home.evaluate(() => [...document.querySelectorAll('#gd-course option')].map((o) => o.textContent));
    check(courseNow.join('|') === 'All courses|ENGL 2110|No course', `a course whose only paper is in Trash leaves the Course choices (${courseNow.join('|')})`);
    await home.fill('#gd-q', 'Field notes from Tuesday');
    await until(async () => { const s = await said(home); if (s !== '0 documents') throw Error(`"${s}"`); return true; }, 'the live search drawn with no match', 30000);
    check(!(await shown()).includes(FIELD) && await said(home) === '0 documents', 'search leaves out what is in Trash');
    await home.fill('#gd-q', '');
    await until(async () => (await shown()).length > 100, 'cleared search');
    const liveCount = (await shown()).length;
    await home.click('#gd-trash');
    await until(async () => (await binned()).join() === [LAB, FIELD].join(), 'the Trash view');
    const binBar = await home.evaluate(() => ({ course: document.getElementById('gd-course').hidden, sort: document.getElementById('gd-sort').hidden, search: !document.getElementById('gd-q').closest('.gd-search').hidden }));
    check(await binOn() && binBar.course && binBar.sort && binBar.search && await said(home) === '2 documents', `Trash shows what is in it, last trashed first, pressed, with search only, and the live region counts it (${JSON.stringify(binBar)})`);
    await home.fill('#gd-q', 'Field notes from Tuesday');
    await until(async () => (await binned()).join() === FIELD, 'search in Trash');
    check(true, 'search finds within the Trash');
    await home.fill('#gd-q', '');
    await until(async () => (await binned()).length === 2, 'Trash again');
    await home.evaluate(() => scrollTo(0, 0));
    await shot(home, 'trash-1280.png');
    await home.setViewportSize({ width: 640, height: 900 });
    await shot(home, 'trash-640.png');
    await home.setViewportSize({ width: 1280, height: 900 });
    await home.focus(`${card(FIELD)} .gd-title`); await home.keyboard.press('Shift+F10');
    const binMenu = await home.evaluate(() => [...document.querySelectorAll('.gd-menu [role="menuitem"], .gd-menu [role="separator"]')].map((b) => b.textContent || '—'));
    check(binMenu.join('|') === 'Restore|Delete forever', `Shift+F10 in Trash offers Restore and Delete forever only (${binMenu.join('|')})`);
    await home.keyboard.press('Escape');
    await home.focus(`${card(FIELD)} .gd-title`); await home.keyboard.press('Delete'); await home.keyboard.press('F2');
    await pause(200); // a window for a rename or toast that must not come
    check((await binned()).includes(FIELD) && !(await home.evaluate(() => document.querySelector('.gd-rename, .gd-toast'))) && !!(await local(`writerPaper:${FIELD}`)), 'in Trash the Delete key and F2 do nothing');
    await home.click(`${card(FIELD)} .gd-more`); await home.click('.gd-menu [data-act="restore"]');
    await until(async () => !(await binned()).includes(FIELD) && !('trashed' in (await local(`writerPaper:${FIELD}`))), 'restored');
    check(await focused(home) === LAB, 'Restore takes the card out of Trash, focus on the next one');
    // Opening a card in Trash restores it first, then opens it in this tab.
    await home.click(`${card(LAB)} .gd-title`);
    await until(() => home.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key()), 'opened from Trash');
    check(await home.evaluate((k) => GZ_WRITER_PAPER.current().key() === k, LAB) && !('trashed' in (await local(`writerPaper:${LAB}`))), 'a document opened from Trash is restored and opens in the same tab');
    await home.click('.gp-top a');
    await until(() => home.evaluate(() => !location.search && document.querySelectorAll('.gd-card').length > 0), 'home after Trash open');
    check(!(await binOn()) && (await shown()).includes(FIELD) && (await shown()).includes(LAB) && (await shown()).length === liveCount + 2
      && await home.evaluate(() => document.getElementById('gd-trash').closest('.gd-bin').hidden), 'both are listed again, and with Trash empty its control goes');
    // Delete forever: the record and its versions, at once, no Undo.
    const D5 = seeds.find((x) => x.title === 'Draft 05').key;
    await worker.evaluate(async ({ k, v }) => chrome.storage.local.set({ [`writerVersions:${k}`]: v }), { k: D5, v: VERSIONS });
    await home.focus(`${card(D5)} .gd-title`); await home.keyboard.press('Delete');
    await until(async () => Number.isFinite((await local(`writerPaper:${D5}`))?.trashed), 'draft trashed');
    await home.click('#gd-trash');
    await until(async () => (await binned()).join() === D5, 'draft in Trash');
    await home.click(`${card(D5)} .gd-more`); await home.click('.gd-menu [data-act="forever"]');
    check(!(await binned()).includes(D5), 'Delete forever takes the card away at once');
    await until(async () => !(await local(`writerPaper:${D5}`)) && !(await local(`writerVersions:${D5}`)) && !(await local('writerPapers')).some((r) => r.key === D5), 'gone for good');
    check(await home.evaluate(() => document.activeElement?.id === 'gd-q'), 'Delete forever of the last card focuses search');
    check(!(await home.evaluate(() => !!document.querySelector('.gd-toast'))), 'Delete forever removes the paper, its versions and its row, with no Undo');
    const empty = await home.evaluate(() => ({ cards: document.getElementById('gd-docs').children.length, said: document.getElementById('gd-said').textContent, shown: !document.getElementById('gd-trash').closest('.gd-bin').hidden }));
    check(await binOn() && empty.cards === 0 && empty.said === '' && empty.shown && await said(home) === '0 documents', `an empty Trash shows nothing but its pressed control (${JSON.stringify(empty)})`);
    await home.click('#gd-trash');
    await until(async () => (await shown()).length === liveCount + 1, 'out of Trash');
    check(await home.evaluate(() => document.getElementById('gd-trash').closest('.gd-bin').hidden && document.activeElement?.id === 'gd-q'), 'leaving an empty Trash hides its control and puts focus in search');

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
      const timing = await pg.evaluate(() => ({ first: __gd.firstCard, rows: __gd.rowsPaint - __gd.indexRead }));
      console.log(`${name}: first card at ${timing.first.toFixed(1)} ms; rows paint in ${timing.rows.toFixed(1)} ms after the index`);
      check(timing.rows < 150, `${name}: the painter keeps card rendering within 150 ms of the index`);
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
        const a = await margin(pg); await pause(700); const b = await margin(pg); // a window for a frame that must not be drawn
        check(await frames() === beforeFrames, `${name}: reduced motion schedules no continuing animation frames`);
        check(w.motion === 'off' && w.innerMotion === 'off' && a.equals(b), `${name}: under reduced motion the background is a still frame (motion ${w.motion}/${w.innerMotion})`);
      } else check(!w.backdrop && w.cardBlur === 'none', `${name}: a solid Look draws no background frame and no blur (${w.cardBlur})`);
      if (name === 'scene') {
        check(w.scene || errors.some((e) => /WebGL/i.test(e)), `scene: the shader's canvas is in the backdrop (${w.scene})`);
        if (w.scene) {
          await pg.emulateMedia({ reducedMotion: 'no-preference' });
          await until(() => pg.evaluate(() => document.getElementById('gd-backdrop').contentDocument.documentElement.getAttribute('data-gz-motion') === 'expressive' && document.documentElement.dataset.motion === 'expressive'), 'scene motion on');
          const a = await margin(pg);
          await until(async () => !a.equals(await margin(pg)), 'scene: the background drawn moving with motion on', 30000);
          check(true, 'scene: with motion on the background moves');
          await pg.emulateMedia({ reducedMotion: 'reduce' });
        }
      }
      for (const sel of ['.gd-card .gd-title', '.gd-card .gd-meta', 'h1', '.gd-tile-name']) {
        const k = await contrastOn(pg, sel);
        check(Number.isFinite(k) && k >= 4.5, `${name}: ${sel} reads at ${k.toFixed(2)}:1 or better against every pixel under it`);
      }
      if (name === 'photo' || name === 'lightPhoto') {
        await pg.click(`${card(NOTES)} .gd-more`);
        const menuContrast = await contrastOn(pg, '.gd-menu [role=menuitem]');
        check(Number.isFinite(menuContrast) && menuContrast >= 4.5, `${name}: the menu text meets 4.5:1 over the photo (${menuContrast.toFixed(2)})`);
        await pg.click('.gd-menu button:text-is("Delete")');
        await pg.waitForSelector('.gp-toast-do');
        for (const sel of ['.gd-toast > span', '.gp-toast-do']) {
          const k = await contrastOn(pg, sel);
          check(Number.isFinite(k) && k >= 4.5, `${name}: ${sel} meets 4.5:1 over the photo (${k.toFixed(2)})`);
        }
        await pg.click('.gp-toast-do');
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

    // ---- 30 days in Trash: the page's opening purges what was trashed 31 days ago, with its versions, and keeps 29 days
    const DAY = 864e5, OLD = `doc:${crypto.randomUUID()}`, KEPT = `doc:${crypto.randomUUID()}`;
    await worker.evaluate(async ({ recs, versions }) => {
      const rows = (await chrome.storage.local.get('writerPapers')).writerPapers, data = {};
      for (const r of recs) { data[`writerPaper:${r.key}`] = r; data[`writerVersions:${r.key}`] = versions; rows.push({ key: r.key, kind: 'paper', named: true, title: r.title, course: '', url: '', words: r.words, format: r.format, updated: r.updated, submitted: null, trashed: r.trashed }); }
      await chrome.storage.local.set({ ...data, writerPapers: rows });
    }, { versions: VERSIONS, recs: [[OLD, 'Trashed a month ago', 31], [KEPT, 'Trashed last month', 29]].map(([key, title, days]) => ({ ...(records()[`writerPaper:${NOTES}`]), key, title, named: true, updated: NOW - 40 * DAY, trashed: Date.now() - days * DAY })) });
    const purged = await openHome('en', 'purge');
    await until(async () => !(await local(`writerPaper:${OLD}`)) && !(await local(`writerVersions:${OLD}`)) && !(await local('writerPapers')).some((r) => r.key === OLD), 'purged on opening');
    check(!!(await local(`writerPaper:${KEPT}`)) && !!(await local(`writerVersions:${KEPT}`)) && (await local('writerPapers')).some((r) => r.key === KEPT),
      'opening the page removes a document trashed 31 days ago with its versions, and keeps one trashed 29 days ago');
    check(!(await purged.evaluate(() => [...document.querySelectorAll('.gd-card')].map((c) => c.dataset.key))).includes(KEPT), 'what is in Trash is not on the home');
    await purged.click('#gd-trash');
    await until(() => purged.evaluate((k) => [...document.querySelectorAll('.gd-card')].map((c) => c.dataset.key).join() === k, KEPT), 'Trash after purge');
    check(true, 'the Trash holds the 29-day document only');
    await purged.close();
    const apiOpen = await openHome('en', 'api-trash-open');
    await apiOpen.evaluate((k) => { GZ_DOCUMENTS.open(k); }, KEPT);
    await until(() => apiOpen.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key()), 'documents.open from Trash');
    check(await apiOpen.evaluate((k) => GZ_WRITER_PAPER.current().key() === k, KEPT) && !('trashed' in (await local(`writerPaper:${KEPT}`))), 'documents.open restores a trashed key before opening it');
    // Keep a trashed record for the mod list's exclusion check below.
    await apiOpen.evaluate((k) => GZ_WRITER_PAPERS.open().trash(k), KEPT);
    await apiOpen.close();

    // ---- a mod on the Documents page: its items, its calls and their limits (lib/modbroker.js, features/mods.js)
    const MOD = 'docsmodaaaaaaaaa';
    const hooksJs = `
      const save = (k, v) => glaze.storage.set(k, v);
      const page = new Promise((ok) => glaze.on('page', ok)); // told once, as the mod starts
      const tryCall = async (k, f) => { try { await save(k, { ok: true, value: await f() }); } catch (e) { await save(k, { ok: false, error: e.message }); } };
      let changes = 0;
      glaze.on('documents.change', async () => { const n = ++changes, list = await glaze.documents.list(); await save('change', { n, keys: list.map((d) => d.key), titles: list.map((d) => d.title) }); });
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
        await tryCall('rawRead', () => glaze.documents.read('bb.school.test|_900_1|_101_1|_7_1'));
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
    check(md.list.ok && md.list.value.length === shownKeys.length && md.list.value.every((d) => Object.keys(d).sort().join() === PUBLIC) && md.list.value.every((d) => /^document:[0-9a-f-]{36}$/.test(d.key)) && md.list.value.every((d, i) => PUBLIC.split(',').filter((k) => k !== 'key').every((k) => d[k] === nativeList[i][k])),
      `mod: documents.list() gives every listed document's public fields only (${md.list.value?.length} × ${Object.keys(md.list.value?.[0] || {}).sort().join(' ')})`);
    check(!JSON.stringify(md.list.value).includes('Beloved 1. A paragraph') && md.list.value.find((d) => d.title === 'Essay 2: Memory in Beloved')?.course === 'ENGL 2110' && !JSON.stringify(md.list.value).includes('bb.school.test') && !JSON.stringify(md.list.value).includes('_900_1'), 'mod: the list carries no document text, and an assignment paper\'s course');
    check(md.rawRead.ok === false && md.rawRead.error === 'args', 'mod: raw assignment storage keys cannot be used to read text');
    check(!md.list.value.some((d) => d.title === 'Trashed last month'), 'mod: documents.list() leaves out what is in Trash');
    // documents.change on Delete (into Trash) and on Undo, the list then without it and with it again.
    const changeAt = (await modData())?.change?.n || 0;
    await mp.focus(`${card(ESSAY3)} .gd-title`); await mp.keyboard.press('Delete');
    await until(async () => { const c = (await modData())?.change; return c?.n > changeAt && !c.titles.includes('Essay 3: The Clearing'); }, 'mod told of the delete');
    const changeMid = (await modData()).change.n;
    await mp.keyboard.press('ControlOrMeta+z');
    await until(async () => { const c = (await modData())?.change; return c?.n > changeMid && c.titles.includes('Essay 3: The Clearing'); }, 'mod told of the undo');
    check(!('trashed' in (await local(`writerPaper:${ESSAY3}`))), 'mod: documents.change fires as a document goes to Trash and comes back, documents.list() following');
    const changeBeforeSeed = (await modData()).change.n;
    await mp.evaluate(async (k) => {
      const P = GZ_WRITER_PAPERS.open(), old = Date.now() - 31 * 864e5;
      await P.save(k, { kind: 'paper', doc: { type: 'doc', content: [{ type: 'paragraph' }] }, format: 'plain', trashed: old });
    }, OLD);
    await until(async () => (await modData())?.change?.n > changeBeforeSeed, 'mod told of the seeded Trash record');
    const changeBeforePurge = (await modData()).change.n;
    await mp.evaluate(() => GZ_WRITER_PAPERS.open().purge());
    await until(async () => (await modData())?.change?.n > changeBeforePurge && !(await local(`writerPaper:${OLD}`)), 'mod told of the purge');
    check(true, 'mod: documents.change fires on purge');
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
    check(act.action.slot === 'documents.card' && act.action.id === 'peek' && act.action.doc.key === md.list.value[nativeList.findIndex((d) => d.key === NOTES)].key && Object.keys(act.action.doc).sort().join() === PUBLIC, `mod: a card item's click tells the mod that card's summary (${JSON.stringify(act.action.doc)})`);
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
    await pause(1500); // a window for the mod's item, which must not come
    check(await off.evaluate(() => !document.querySelector('.gd-extra button')) && !(await modData())?.ready, 'mod: without the documents grant it does not run on the Documents page');
    await off.close();
    await worker.evaluate(async (id) => chrome.storage.local.remove(['mods', `mod:${id}`, `modData:${id}`, `modPrivate:${id}`]), MOD);

    {
      // ---- motion (papers-motion.js): a document opens out of its card with the genie (Expressive) or a scale (Subtle), across
      // the two page loads, and closing folds it back into the card with the list as it was; cards glide on sort, a deleted one
      // fades where it was while the rest close up, Undo brings it back in, dropped files' cards come in; the ⋯ menu genies
      // from its button and back, the toast and the status line come and go, the drop target fades; Off and reduced motion
      // change at once. Every animation the page starts is recorded as started (RECORD), and the view transition itself.
      // Frames for the owner: motion-*.png in the shots folder, the motion slowed five times.
      const RECORD = () => {
        if (location.pathname !== '/papers.html') return;
        const log = globalThis.__mo = { vt: null, t0: 0, finished: 0, all: [] };
        chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && 'popup' in c) log.popup = c.popup.newValue?.anim || 'genie'; });
        // The frames the page draws while its transition runs: how smooth the genie is beside the page's own first work.
        addEventListener('pagereveal', (e) => {
          log.vt = !!e.viewTransition; log.t0 = performance.now(); log.frames = [];
          e.viewTransition?.finished.then(() => { log.finished = performance.now(); }, () => { log.finished = -1; });
          const tick = (t) => { log.frames.push(t); if (!log.finished && t - log.t0 < 8000) requestAnimationFrame(tick); };
          if (e.viewTransition) requestAnimationFrame(tick);
        });
        const slow = Number(sessionStorage.getItem('gz-check-slow')) || 1, animate = Element.prototype.animate;
        Element.prototype.animate = function (frames, o = {}) {
          const a = animate.call(this, frames, o), list = Array.isArray(frames) ? frames : [];
          log.all.push({ at: performance.now(), cls: typeof this.className === 'string' ? this.className : '', key: this.dataset?.key || '', ghost: !!this.hasAttribute?.('data-gz-ghost'), parent: this.parentElement?.className || '',
            pseudo: o.pseudoElement || '', route: document.documentElement.getAttribute('data-gd-route') || '', n: list.length, first: list[0] || null, last: list.at(-1) || null, duration: o.duration, easing: o.easing || '' });
          if (slow !== 1) a.playbackRate = 1 / slow;
          return a;
        };
      };
      const MOVE = (level) => G.GZ_SANITIZE({ ...settings, motion: { ...G.GZ_DEFAULTS.motion, level }, popup: { anim: 'genie' } });
      const W = 1280, H = 900;
      // A genie keyframe's near edge: its clip's first two points, as px of the box it clips (w); and its translate.
      const funnel = (f, w) => { const m = /polygon\(([-\d.]+)% ([-\d.]+)%, ([-\d.]+)% ([-\d.]+)%/.exec(f?.clipPath || ''); return m ? (m[3] - m[1]) / 100 * w : NaN; };
      const moved = (f) => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(f?.transform || ''); return m ? [+m[1], +m[2]] : [NaN, NaN]; };
      const since = async (pg, t, test = () => true) => (await pg.evaluate((t) => globalThis.__mo.all.filter((x) => x.at >= t), t)).filter(test);
      const clock = (pg) => pg.evaluate(() => performance.now());
      const landed = (pg, what) => until(() => pg.evaluate((what) => (globalThis.__mo?.vt === false || globalThis.__mo?.finished !== 0)
        && (what === 'paper' ? !!globalThis.GZ_WRITER_PAPER?.current()?.key() : !location.search && !document.getElementById('list').hidden && document.querySelectorAll('#gd-docs > .gd-card').length > 0), what), `motion: ${what} drawn`);
      const boxIn = (pg, key) => pg.evaluate((k) => { const r = document.querySelector(`#gd-docs > .gd-card[data-key="${k}"]`)?.getBoundingClientRect(); return r && { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom }; }, key);
      // The first card wholly in the window, below the toolbar.
      const visibleCard = (pg) => pg.evaluate(() => [...document.querySelectorAll('#gd-docs > .gd-card')].find((c) => { const r = c.getBoundingClientRect(); return r.top > 60 && r.bottom < innerHeight - 10; })?.dataset.key);
      // Nothing moving on the page: each case starts from rest.
      const settled = (pg) => until(() => pg.evaluate(() => !document.getAnimations().some((a) => a.playState === 'running')), 'motion: at rest', 5000);
      const openWithEnter = async (pg, key) => { await pg.mouse.move(2, H - 2); await pg.focus(`${card(key)} .gd-title`); await pg.keyboard.press('Enter'); await landed(pg, 'paper'); };
      // The frames drawn while a picture's animation ran: how many, and the longest gap between two.
      const jank = (l, x) => { const f = (l.frames || []).filter((t) => t >= x.at && t <= x.at + x.duration * 1.2); let gap = 0; for (let i = 1; i < f.length; i++) gap = Math.max(gap, f[i] - f[i - 1]); return `${f.length} frames, longest gap ${Math.round(gap)} ms`; };
      // What the view transition played, for a failure's message.
      const pictures = (l) => `transition ${l.vt}, ${l.all.filter((x) => x.pseudo).map((x) => `${x.pseudo.slice(18, 21)}/${x.route}/${x.n}/${x.duration}`).join(' ') || 'no pictures animated'}`;
      const genieOpen = (x) => x.pseudo === '::view-transition-new(root)' && x.route === 'open' && x.n >= 24;
      const genieBack = (x) => x.pseudo === '::view-transition-old(root)' && x.route === 'back' && x.n >= 24;

      await wearLook(MOVE('expressive'));
      const mo = await context.newPage();
      watch(mo, 'motion');
      await mo.emulateMedia({ reducedMotion: 'no-preference' });
      await mo.addInitScript(RECORD);
      await mo.goto(HOME);
      await landed(mo, 'home');
      await until(() => mo.evaluate(() => document.documentElement.getAttribute('data-gz-motion') === 'expressive' && !document.documentElement.hasAttribute('data-gz-no-trans')), 'motion: Expressive worn');

      // The full list is scanned once on each side of a filter; only nearby cards get FLIP animations, never per-frame reads.
      const budget = await mo.evaluate(() => {
        const docs = document.getElementById('gd-docs'), q = document.getElementById('gd-q');
        const original = Element.prototype.getBoundingClientRect;
        let reads = 0;
        Element.prototype.getBoundingClientRect = function () { if (this.parentElement === docs) reads++; return original.call(this); };
        const n = docs.children.length, start = performance.now();
        try { q.value = 'notes'; q.dispatchEvent(new Event('input')); }
        finally { Element.prototype.getBoundingClientRect = original; }
        return { n, hits: docs.children.length, ms: performance.now() - start, reads };
      });
      console.log(`motion filter: ${budget.n} cards to ${budget.hits}; ${budget.ms.toFixed(1)} ms; ${budget.reads} card box reads`);
      check(budget.n >= 180 && budget.hits > 0 && budget.hits < budget.n && budget.ms < 150 && budget.reads <= budget.n + budget.hits + 100,
        `motion: filtering hundreds of cards stays bounded (${JSON.stringify(budget)})`);
      await mo.fill('#gd-q', '');
      await settled(mo);

      // Opening on Expressive, from a list sorted by title, filtered to the documents without a course, scrolled down.
      await mo.selectOption('#gd-sort', 'title');
      await mo.selectOption('#gd-course', 'none');
      await mo.evaluate(() => scrollTo(0, 1500));
      const leftAt = await mo.evaluate(() => ({ y: scrollY, n: document.querySelectorAll('#gd-docs > .gd-card').length }));
      const openKey = await visibleCard(mo), openBox = await boxIn(mo, openKey);
      await openWithEnter(mo, openKey);
      let log = await mo.evaluate(() => globalThis.__mo);
      let pic = log.all.find(genieOpen);
      const held = pic && Math.round(pic.at - log.t0);
      check(log.vt && pic && pic.duration === 420 && pic.easing === 'linear' && Math.abs(funnel(pic.first, W) - openBox.width) < 1
        && Math.abs(moved(pic.first)[1] - (openBox.top + openBox.height / 2 <= H / 2 ? openBox.top : openBox.bottom - H)) < 0.5 && pic.first.opacity === 0 && pic.last.transform === 'none'
        && await mo.evaluate((k) => GZ_WRITER_PAPER.current().key() === k, openKey),
      `motion: on Expressive a card opens its document with the genie out of the card's box, across the page load (near edge ${funnel(pic?.first, W).toFixed(1)} px for a ${openBox.width.toFixed(1)} px card; the old page held ${held} ms while the editor drew)`);
      check(log.all.some((x) => x.route === 'hold' && x.pseudo === '::view-transition-new(root)') && log.finished - pic.at >= 400, `motion: the transition holds until the editor has drawn and lasts the whole genie (${jank(log, pic)})`);

      // Back through the editor's Documents link: the editor folds into the same card, the list where it was.
      await mo.mouse.move(2, H - 2);
      await mo.click('.gp-top a');
      await landed(mo, 'home');
      log = await mo.evaluate(() => globalThis.__mo);
      pic = log.all.find(genieBack);
      const backBox = await boxIn(mo, openKey), backAt = await mo.evaluate(() => ({ y: scrollY, n: document.querySelectorAll('#gd-docs > .gd-card').length, sort: document.getElementById('gd-sort').value, course: document.getElementById('gd-course').value }));
      check(log.vt && pic && pic.duration === 340 && Math.abs(funnel(pic.last, W) - backBox.width) < 1 && pic.last.opacity === 0,
        `motion: closing, the editor folds back into its card with the genie (near edge ${funnel(pic?.last, W).toFixed(1)} px for ${backBox?.width.toFixed(1)} px; ${pic ? `${Math.round(log.finished - pic.at)} ms, ${jank(log, pic)}` : pictures(log)})`);
      check(backAt.sort === 'title' && backAt.course === 'none' && Math.abs(backAt.y - leftAt.y) < 2 && backAt.n === leftAt.n && Math.abs(backBox.top - openBox.top) < 2 && Math.abs(backBox.left - openBox.left) < 1,
        `motion: back on the list, its order, filter and scroll are as left (${JSON.stringify(backAt)} vs ${JSON.stringify(leftAt)})`);

      // Browser Back, with a search: the same fold, the search kept.
      await mo.selectOption('#gd-course', 'all');
      await mo.selectOption('#gd-sort', 'updated');
      await mo.evaluate(() => scrollTo(0, 0));
      await mo.fill('#gd-q', 'reading');
      await until(async () => (await mo.evaluate(() => [...document.querySelectorAll('#gd-docs > .gd-card')].map((c) => c.dataset.key))).includes(NOTES), 'motion: search');
      const found = await mo.evaluate(() => [...document.querySelectorAll('#gd-docs > .gd-card')].map((c) => c.dataset.key).join());
      await openWithEnter(mo, NOTES);
      await mo.goBack();
      await landed(mo, 'home');
      await until(async () => (await mo.evaluate(() => [...document.querySelectorAll('#gd-docs > .gd-card')].map((c) => c.dataset.key).join())) === found, 'motion: the search again', 5000).catch(() => {});
      log = await mo.evaluate(() => globalThis.__mo);
      check(log.all.some(genieBack) && await mo.evaluate(() => document.getElementById('gd-q').value) === 'reading'
        && (await mo.evaluate(() => [...document.querySelectorAll('#gd-docs > .gd-card')].map((c) => c.dataset.key).join())) === found,
      'motion: the browser\'s Back folds the document into its card too, the search and its results kept');
      await mo.fill('#gd-q', '');
      await until(async () => (await mo.evaluate(() => document.querySelectorAll('#gd-docs > .gd-card').length)) > 20, 'motion: search cleared');

      // Creating: a New tile genies into the new document out of the tile's page; written in and closed, the document folds
      // into its new card, which settles in.
      await mo.mouse.move(2, H - 2);
      await settled(mo);
      const tileBox = await mo.evaluate(() => { const r = document.querySelector('.gd-tile[data-format="plain"] .gd-tile-pic').getBoundingClientRect(); return { width: r.width }; });
      await mo.focus('.gd-tile[data-format="plain"]');
      await mo.keyboard.press('Enter');
      await landed(mo, 'paper');
      log = await mo.evaluate(() => globalThis.__mo);
      pic = log.all.find(genieOpen);
      check(log.vt && pic && Math.abs(funnel(pic.first, W) - tileBox.width) < 1, `motion: a New tile genies into the new document out of its page (near edge ${funnel(pic?.first, W).toFixed(1)} px for ${tileBox.width.toFixed(1)} px)`);
      const made = await mo.evaluate(() => GZ_WRITER_PAPER.current().key());
      await mo.locator('.ProseMirror').click();
      await mo.keyboard.type('Motion, written in a new document.');
      await until(() => mo.evaluate(() => document.querySelector('.gp-state')?.textContent === 'Saved'), 'motion: new document saved');
      await mo.mouse.move(2, H - 2);
      await mo.click('.gp-top a');
      await landed(mo, 'home');
      log = await mo.evaluate(() => globalThis.__mo);
      pic = log.all.find(genieBack);
      const madeBox = await boxIn(mo, made), settles = log.all.find((x) => x.key === made && x.first?.opacity === 0);
      check(madeBox && pic && Math.abs(funnel(pic.last, W) - madeBox.width) < 1 && settles,
        `motion: closed, the new document folds into its new card and the card settles in (${JSON.stringify({ edge: funnel(pic?.last, W), card: madeBox?.width, settles: !!settles })})`);

      // In the list on Expressive: the ⋯ menu genies from its button and back into it.
      await mo.mouse.move(2, H - 2);
      await settled(mo);
      const menuKey = await visibleCard(mo);
      let t = await clock(mo);
      await mo.focus(`${card(menuKey)} .gd-title`);
      await mo.keyboard.press('Shift+F10');
      // The menu's box and its button's, and which edge of the menu is near the button (lib/popup.js genie's rule).
      const geo = await mo.evaluate((k) => {
        const m = document.querySelector('.gd-menu'), b = document.querySelector(`.gd-card[data-key="${k}"] .gd-more`).getBoundingClientRect();
        const mt = parseFloat(m.style.top), mh = m.offsetHeight, top = b.top + b.height / 2 <= mt + mh / 2;
        return { mw: m.getBoundingClientRect().width, bw: b.width, dy: top ? b.top - mt : b.bottom - (mt + mh) };
      }, menuKey);
      let menuIn = (await since(mo, t, (x) => /gd-menu/.test(x.cls)))[0];
      check(menuIn && menuIn.n >= 24 && menuIn.duration === 420 && Math.abs(funnel(menuIn.first, geo.mw) - geo.bw) < 1 && Math.abs(moved(menuIn.first)[1] - geo.dy) < 0.5,
        `motion: the ⋯ menu genies out of its button (near edge ${funnel(menuIn?.first, geo.mw).toFixed(1)} px for a ${geo.bw.toFixed(1)} px button, from ${moved(menuIn?.first)[1]} px for ${geo.dy.toFixed(1)}; ${menuIn?.n} frames, ${menuIn?.duration} ms)`);
      const unseen = (await since(mo, t, (x) => /gd-menu/.test(x.cls) && !x.ghost))[0];
      check(menuIn?.ghost === true && unseen?.n === 2 && unseen.first.opacity === 0 && unseen.last.opacity === 0, 'motion: the genie plays on a copy over the menu, which waits unseen in its place');
      await settled(mo);
      t = await clock(mo);
      await mo.keyboard.press('Escape');
      const menuOut = (await since(mo, t, (x) => /gd-menu/.test(x.cls)))[0];
      const lingers = await mo.evaluate(() => !!document.querySelector('.gd-menu')?.inert);
      await until(() => mo.evaluate(() => !document.querySelector('.gd-menu')), 'motion: menu gone');
      check(menuOut && menuOut.n >= 24 && menuOut.duration === 340 && menuOut.last.opacity === 0 && lingers, 'motion: Escape folds it back into the button (inert while it goes), then it is gone');
      // Its items take clicks where they will be from the first frame: Rename clicked while the menu still genies open.
      await settled(mo);
      const localKey = await mo.evaluate(() => [...document.querySelectorAll('#gd-docs > .gd-card')].find((c) => { const r = c.getBoundingClientRect(); return c.dataset.key.startsWith('doc:') && r.top > 60 && r.bottom < innerHeight - 10; })?.dataset.key);
      await mo.click(`${card(localKey)} .gd-more`);
      const item = await mo.evaluate(() => { const b = document.querySelector('.gd-menu [data-act="rename"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, opening: document.querySelectorAll('.gd-menu').length === 2 }; });
      await mo.mouse.click(item.x, item.y);
      check(item.opening && await mo.evaluate(() => !!document.querySelector('.gd-rename')), 'motion: while the menu genies open, its items take clicks where they will be (Rename, mid-genie)');
      await mo.keyboard.press('Escape');
      await until(() => mo.evaluate(() => !document.querySelector('.gd-menu') && !document.querySelector('.gd-rename')), 'motion: the menu turned back and went');
      await mo.mouse.move(2, H - 2);

      // Sort: the cards glide to their new places.
      await settled(mo);
      t = await clock(mo);
      await mo.selectOption('#gd-sort', 'title');
      let glides = await since(mo, t, (x) => x.cls.includes('gd-card') && !x.ghost && x.first?.translate);
      check(glides.length >= 3 && glides.every((x) => x.last.translate === '0px 0px'), `motion: a new order glides the cards on screen to their places (${glides.length} cards)`);
      await mo.selectOption('#gd-sort', 'updated');
      await mo.evaluate(() => scrollTo(0, 0));

      // Delete: the card fades where it was while the rest close up; the toast comes in; Undo takes it out and brings the card back in.
      await settled(mo);
      const delKey = await visibleCard(mo);
      t = await clock(mo);
      await mo.focus(`${card(delKey)} .gd-title`);
      await mo.keyboard.press('Delete');
      await until(() => mo.evaluate(() => !!document.querySelector('.gd-toast')), 'motion: toast');
      let all = await since(mo, t);
      const ghost = all.find((x) => x.ghost), closing = all.filter((x) => x.cls.includes('gd-card') && !x.ghost && x.first?.translate), toastIn = all.find((x) => /gd-toast/.test(x.cls));
      check(ghost && ghost.last.opacity === 0 && ghost.parent === 'gd-ghosts' && closing.length >= 1 && await mo.evaluate(() => !document.querySelector('#gd-docs > [data-gz-ghost]')),
        `motion: delete fades the card where it was (on its own layer) while ${closing.length} close up`);
      check(toastIn && toastIn.first.opacity === 0 && toastIn.first.translate === '0 8px', 'motion: the Undo toast rises in');
      t = await clock(mo);
      await mo.click('.gd-toast button');
      await until(async () => (await since(mo, t, (x) => x.key === delKey)).length > 0, 'motion: restored card animates');
      all = await since(mo, t);
      const toastOut = all.find((x) => /gd-toast/.test(x.cls)), back = all.find((x) => x.key === delKey);
      check(toastOut && toastOut.last.opacity === 0 && back && back.first.opacity === 0 && back.last.opacity === 1, 'motion: Undo fades the toast out and settles the card back in');

      // Files over the page: the drop target fades in and out; a refused file's words pop; a dropped .docx's card comes in.
      await drop(mo, [{ name: 'notes.txt', type: 'text/plain', bytes: [104, 105] }], 'over');
      let over = null;
      await until(async () => { over = await mo.evaluate(() => { const s = getComputedStyle(document.getElementById('list'), '::after'); return { o: s.opacity, v: s.visibility, d: s.transitionDuration }; }); return over.o === '1' && over.v === 'visible'; }, 'motion: the drop target shown', 30000).catch(() => {});
      t = await clock(mo);
      await drop(mo, [{ name: 'notes.txt', type: 'text/plain', bytes: [104, 105] }]);
      await until(() => mo.evaluate(() => document.getElementById('gd-said').textContent !== ''), 'motion: refusal');
      // Polled: a loaded machine can draw no frame for a while, and the fade runs on frames.
      let after = null;
      await until(async () => { after = await mo.evaluate(() => { const s = getComputedStyle(document.getElementById('list'), '::after'); return { o: s.opacity, v: s.visibility }; }); return after.o === '0' && after.v === 'hidden'; }, 'motion: the drop target gone', 3000).catch(() => {});
      check(over.o === '1' && over.v === 'visible' && /^0\.25s/.test(over.d) && after.o === '0' && after.v === 'hidden', `motion: the drop target fades in and out at the transitions' pace (${JSON.stringify([over, after])})`);
      const popped = (await since(mo, t, (x) => x.cls.includes('gd-said')))[0];
      check(popped && popped.n === 3 && popped.first.scale === 1, 'motion: the status line pops with its words');
      const keysBefore = new Set(await mo.evaluate(() => [...document.querySelectorAll('#gd-docs > .gd-card')].map((c) => c.dataset.key)));
      t = await clock(mo);
      await drop(mo, [{ name: 'Moving notes.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docx }]);
      const dropped = await until(async () => (await mo.evaluate(() => [...document.querySelectorAll('#gd-docs > .gd-card')].map((c) => c.dataset.key))).find((k) => !keysBefore.has(k)), 'motion: dropped card');
      const cameIn = await until(async () => (await since(mo, t, (x) => x.key === dropped))[0], 'motion: dropped card animates', 3000).catch(() => null);
      check(cameIn && cameIn.first.opacity === 0 && cameIn.last.opacity === 1, 'motion: a dropped file\'s card settles in');
      const sayCleared = await until(() => mo.evaluate(() => document.getElementById('gd-said').textContent === ''), 'motion: status cleared', 3000).then(() => true, () => false);
      check(sayCleared, 'motion: the next action fades the old words out, then clears them');

      // Frames for the owner, five times slower, from Chrome's screencast (as the compositor draws them): up to 16 spread over
      // each animation (span: its start and end, epoch ms), for opening, closing, the menu and a delete.
      await mo.evaluate(() => { sessionStorage.setItem('gz-check-slow', '5'); scrollTo(0, 0); });
      await mo.reload();
      await landed(mo, 'home');
      const film = async (name, act, span) => {
        const cdp = await context.newCDPSession(mo), got = [];
        cdp.on('Page.screencastFrame', (f) => { got.push({ t: f.metadata.timestamp * 1000, data: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
        await cdp.send('Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 });
        try { await act(); } finally { await cdp.send('Page.stopScreencast').catch(() => {}); await cdp.detach().catch(() => {}); }
        const { start, end } = await span(), within = got.filter((f) => f.t >= start - 40 && f.t <= end + 40);
        const pick = within.length <= 16 ? within : Array.from({ length: 16 }, (_, i) => within[Math.round(i * (within.length - 1) / 15)]);
        pick.forEach((f, i) => { const file = path.join(shots, `motion-${name}-${String(i + 1).padStart(2, '0')}.png`); fs.writeFileSync(file, Buffer.from(f.data, 'base64')); saved.push(file); });
        console.log(`     motion-${name}: ${pick.length} of ${within.length} frames in its ${Math.round(end - start)} ms (${got.length} drawn)`);
      };
      const route = (r) => () => mo.evaluate((r) => { const l = globalThis.__mo, g = l.all.find((x) => x.route === r && x.n >= 24); return { start: performance.timeOrigin + g.at, end: performance.timeOrigin + l.finished }; }, r);
      const played = (what) => () => mo.evaluate((what) => { const g = globalThis.__mo.all.filter((x) => (what === 'ghost' ? x.ghost : /gd-menu/.test(x.cls) && x.n >= 24)).at(-1); return { start: performance.timeOrigin + g.at, end: performance.timeOrigin + g.at + g.duration * 5 }; }, what);
      await mo.mouse.move(2, H - 2);
      await settled(mo);
      const shotKey = await visibleCard(mo);
      await film('open', async () => { await mo.focus(`${card(shotKey)} .gd-title`); await mo.keyboard.press('Enter'); await landed(mo, 'paper'); }, route('open'));
      await film('back', async () => { await mo.mouse.move(2, H - 2); await mo.click('.gp-top a'); await landed(mo, 'home'); }, route('back'));
      await mo.mouse.move(2, H - 2);
      await settled(mo);
      await mo.focus(`${card(await visibleCard(mo))} .gd-title`);
      await film('menu', async () => { await mo.keyboard.press('Shift+F10'); await pause(2400); }, played('menu'));
      await mo.keyboard.press('Escape');
      await settled(mo);
      await mo.focus(`${card(await visibleCard(mo))} .gd-title`);
      await film('delete', async () => { await mo.keyboard.press('Delete'); await pause(2600); }, played('ghost'));
      await mo.keyboard.press('ControlOrMeta+z');
      await mo.evaluate(() => sessionStorage.removeItem('gz-check-slow'));
      await settled(mo);

      // Subtle: a scale about the card, out and back.
      await wearLook(MOVE('subtle'));
      await until(() => mo.evaluate(() => document.documentElement.getAttribute('data-gz-motion') === 'subtle'), 'motion: Subtle worn');
      await mo.reload();
      await landed(mo, 'home');
      const subKey = await visibleCard(mo), subBox = await boxIn(mo, subKey);
      await openWithEnter(mo, subKey);
      log = await mo.evaluate(() => globalThis.__mo);
      pic = log.all.find((x) => x.pseudo === '::view-transition-new(root)' && x.route === 'open');
      const centre = `${Math.round((subBox.left + subBox.width / 2) * 10) / 10}px ${Math.round((subBox.top + subBox.height / 2) * 10) / 10}px`;
      check(log.vt && pic && pic.n === 2 && pic.first.transform === 'scale(0.96)' && pic.first.opacity === 0 && pic.first.transformOrigin === centre && pic.duration === 180,
        `motion: on Subtle a card opens its document with a scale about the card (${pic?.first.transformOrigin} for ${centre})`);
      await mo.goBack();
      await landed(mo, 'home');
      log = await mo.evaluate(() => globalThis.__mo);
      pic = log.all.find((x) => x.pseudo === '::view-transition-old(root)' && x.route === 'back');
      check(log.vt && pic && pic.last.transform === 'scale(0.96)' && pic.last.opacity === 0 && pic.duration === 140, 'motion: on Subtle closing scales the editor down into the card');
      t = await clock(mo);
      await mo.focus(`${card(await visibleCard(mo))} .gd-title`);
      await mo.keyboard.press('Shift+F10');
      menuIn = (await since(mo, t, (x) => /gd-menu/.test(x.cls)))[0];
      check(menuIn && menuIn.n === 2 && menuIn.first.opacity === 0 && menuIn.first.scale === 0.96, 'motion: on Subtle the ⋯ menu settles in (lib/motion.js enter)');
      await mo.keyboard.press('Escape');

      // Off, and reduced motion followed: nothing animates, and opening a document is a plain page change.
      for (const [name, level, reduced, switches] of [['Off', 'off', 'no-preference'], ['reduced motion', 'expressive', 'reduce'],
        ['transitions off', 'expressive', 'no-preference', { transitions: false }]]) {
        const choice = MOVE(level);
        if (switches) Object.assign(choice.motion, switches);
        await wearLook(choice);
        await mo.emulateMedia({ reducedMotion: reduced });
        await until(() => mo.evaluate((off) => off ? document.documentElement.getAttribute('data-gz-motion') === 'off' : document.documentElement.hasAttribute('data-gz-no-trans'), !switches), `motion: ${name} worn`);
        await mo.reload();
        await landed(mo, 'home');
        t = await clock(mo);
        const k = await visibleCard(mo);
        await mo.focus(`${card(k)} .gd-title`);
        await mo.keyboard.press('Shift+F10');
        const menuThere = await mo.evaluate(() => !!document.querySelector('.gd-menu'));
        await mo.keyboard.press('Escape');
        const menuGone = await mo.evaluate(() => !document.querySelector('.gd-menu'));
        await mo.selectOption('#gd-sort', 'title');
        await mo.focus(`${card(await visibleCard(mo))} .gd-title`);
        await mo.keyboard.press('Delete');
        await until(() => mo.evaluate(() => !!document.querySelector('.gd-toast')), `motion: ${name} toast`);
        const ghosts = await mo.evaluate(() => document.querySelectorAll('.gd-ghosts > *').length);
        await mo.keyboard.press('ControlOrMeta+z');
        await until(() => mo.evaluate(() => !document.querySelector('.gd-toast')), `motion: ${name} undone`);
        await mo.selectOption('#gd-sort', 'updated');
        const moves = await since(mo, t);
        await openWithEnter(mo, k);
        log = await mo.evaluate(() => globalThis.__mo);
        check(menuThere && menuGone && ghosts === 0 && moves.length === 0 && log.vt === false && log.all.length === 0,
          `motion: with ${name} nothing animates, the menu and toast come and go at once, and a document opens with no transition (${moves.length} animations, transition ${log.vt})`);
        await mo.goBack();
        await landed(mo, 'home');
      }
      await mo.emulateMedia({ reducedMotion: 'no-preference' });
      await wearLook(MOVE('expressive'));
      await worker.evaluate(() => chrome.storage.sync.set({ popup: { anim: 'none' } }));
      await mo.reload(); await landed(mo, 'home'); await settled(mo);
      t = await clock(mo);
      const noneKey = await visibleCard(mo);
      await mo.focus(`${card(noneKey)} .gd-title`); await mo.keyboard.press('Shift+F10');
      await mo.keyboard.press('Escape');
      const noneMenu = await mo.evaluate(() => !document.querySelector('.gd-menu'));
      const noneMoves = await since(mo, t);
      await openWithEnter(mo, noneKey);
      log = await mo.evaluate(() => globalThis.__mo);
      check(noneMenu && noneMoves.length === 0 && log.vt === false && log.all.length === 0,
        `motion: Pop-up None leaves no menu animation or native transition (${noneMoves.length} animations, transition ${log.vt})`);
      await mo.goBack(); await landed(mo, 'home');
      await worker.evaluate(() => chrome.storage.sync.set({ popup: { anim: 'fade' } }));
      await until(() => mo.evaluate(() => globalThis.__mo.popup === 'fade'), 'live Pop-up Fade update');
      await settled(mo);
      t = await clock(mo);
      await mo.focus(`${card(noneKey)} .gd-title`); await mo.keyboard.press('Shift+F10');
      const fadeMoves = await since(mo, t, (x) => /\bgd-menu\b/.test(x.cls));
      check(fadeMoves.some((x) => x.n === 2 && x.first.opacity === 0 && !x.first.scale && !x.first.transform), 'motion: live Pop-up Fade uses a fade without scale or genie');
      await mo.keyboard.press('Escape'); await settled(mo);
      await openWithEnter(mo, noneKey);
      log = await mo.evaluate(() => globalThis.__mo);
      check(log.vt && log.all.some((x) => x.route === 'fade' && x.first.opacity === 0 && x.last.opacity === 1), 'motion: Pop-up Fade crossfades the native pictures');
      await mo.close();
    }

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
