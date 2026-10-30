// Slide decks on the Documents page (papers.html, slides-kind.js) in the real unpacked extension: with Settings → Writer →
// Slides set off (writer.slides: false; it defaults on) a .pptx is refused as before; on, the fixture deck (test/fixtures/pptx/deck, zipped
// with lib/zip.js) imports as a card showing slide 1, opens in the viewer (the rail, slide 1, arrows and Page keys, zoom,
// find in the slides' text, the notes), presents in a dialog whose keys are Rimeward's and which skips the hidden slide,
// exports the bytes it was given, and Esc and Back behave as a paper's. The chrome wears a dark Look while the slide stays
// as authored, and nothing errors, in the page or at the worker's sender check. Screenshots at 1280 and 640 px. The browser
// reaches no network.
// NODE_PATH=<playwright> nice -n 10 node scripts/slides-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const Z = require(path.join(root, 'lib/zip.js'));
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-slides-check');
const checks = [], errors = [], requests = [], shots = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

// The fixture deck as its package: every part under test/fixtures/pptx/deck, stored.
const fixture = () => {
  const dir = path.join(root, 'test/fixtures/pptx/deck');
  const walk = (d, base = '') => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== '.DS_Store')
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), `${base}${e.name}/`) : [[`${base}${e.name}`, fs.readFileSync(path.join(d, e.name))]]));
  const files = walk(dir).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, data]) => ({ name, data: new Uint8Array(name === 'ppt/slides/slide2.xml' ? Buffer.from(data.toString().replace('Passive transport</a:t></a:r>', 'Passive trans</a:t></a:r><a:r><a:rPr b="1"/><a:t>port</a:t></a:r>')) : data), date: new Date(2026, 9, 29, 12) }));
  return Buffer.concat(Z.zip(files));
};

(async () => {
  let context, held = false, tmp, passed = false;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nslides-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[slides-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-slides-'));
    fs.mkdirSync(out, { recursive: true });
    const deckBytes = fixture(), file = path.join(tmp, 'Cell Biology week 3.pptx');
    fs.writeFileSync(file, deckBytes);
    const ext = env.staged(root, []);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'en-US',
      reducedMotion: 'reduce', acceptDownloads: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    const first = env.noFirstRun(context); context.setDefaultTimeout(15000);
    await context.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.protocol === 'chrome-extension:' || u.protocol === 'blob:' || u.protocol === 'data:') return r.continue(); requests.push(u.href); return r.abort(); });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    // Frost: a dark Look, so the chrome is dark while the slide keeps its own white.
    const settings = (slides) => G.GZ_SANITIZE({ preset: 'Frost', enhance: { ...G.GZ_DEFAULTS.enhance, writer: true }, writer: { ...G.GZ_DEFAULTS.writer, sheets: false, pdf: false, slides } });
    const HOME = `chrome-extension://${id}/papers.html`;
    const page = await context.newPage();
    await page.addInitScript(() => {
      const request = Element.prototype.requestFullscreen;
      if (request) Element.prototype.requestFullscreen = function (...args) {
        return request.apply(this, args).then((v) => { globalThis.fullscreenResult = { ok: true }; return v; }, (e) => { globalThis.fullscreenResult = { ok: false, error: e.message }; throw e; });
      };
    });
    page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    page.on('console', (m) => { const x = m.text(); if (m.type() === 'error' && !/Failed to load resource/.test(x)) errors.push(`console: ${x}`); });
    await page.goto(HOME);
    await env.installed(page);
    await first.catch(() => {});
    await worker.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(s); }, settings(false));
    const local = (k) => worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k] ?? null, k);
    const shot = async (name) => { await pause(250); const f = path.join(out, name); await page.screenshot({ path: f }); shots.push(f); };
    const openHome = async () => { await page.goto(HOME); await until(() => page.evaluate(() => !document.getElementById('list').hidden), 'home'); };
    const said = () => page.evaluate(() => document.getElementById('gd-said').textContent);

    // ---- off: Documents is as it was
    await openHome();
    const off = await page.evaluate(() => ({ accept: document.getElementById('gd-file').accept, label: document.getElementById('gd-import').textContent }));
    check(!/pptx|ppsx|presentation/i.test(off.accept) && off.label === 'Import .docx…', `off: the chooser takes Word files only (${JSON.stringify(off)})`);
    await page.setInputFiles('#gd-file', file);
    await until(said, 'off: refusal');
    check(await said() === 'That file could not be read as a Word document.', 'off: a .pptx is refused with the Word string');
    check(((await local('writerPapers')) || []).length === 0, 'off: nothing stored');
    // A link to a missing deck goes home, with either switch value.
    await page.goto(`${HOME}?slides=${encodeURIComponent('doc:00000000-0000-4000-8000-000000000000')}`);
    await until(() => page.evaluate(() => !document.getElementById('list').hidden && location.search === ''), 'off: a slides link goes home');
    check(true, 'off: a ?slides= address goes home');

    // ---- on: import, a card with slide 1
    await worker.evaluate(async (s) => { await chrome.storage.sync.set(s); }, settings(true));
    await openHome();
    const on = await page.evaluate(() => ({ accept: document.getElementById('gd-file').accept, label: document.getElementById('gd-import').textContent, file: document.getElementById('gd-file').getAttribute('aria-label') }));
    check(/\.pptx/.test(on.accept) && /\.ppsx/.test(on.accept) && /\.docx/.test(on.accept) && on.label === 'Import…' && on.file === 'Import…', `on: the chooser takes Word files and decks (${JSON.stringify(on)})`);
    await page.setInputFiles('#gd-file', file);
    const key = await until(() => page.evaluate(() => document.querySelector('.gd-card')?.dataset.key), 'the deck card');
    const rec = await until(() => local(`writerPaper:${key}`), 'the record');
    check(rec.kind === 'slides' && rec.title === 'Cell Biology week 3' && rec.slides === 10 && rec.ext === '.pptx' && rec.size === deckBytes.length && Buffer.from(rec.file, 'base64').equals(deckBytes),
      `the record: kind slides, its title, 10 slides, the bytes as given (${JSON.stringify({ kind: rec.kind, title: rec.title, slides: rec.slides, size: rec.size, ext: rec.ext })})`);
    check(/Membrane transport/.test(rec.text) && /Start with the quiz/.test(rec.text), 'the record keeps the slides\' and notes\' text for search');
    check(/^data:image\/jpeg;base64,/.test(rec.thumb || '') && rec.thumb.length < 96e3, `the record keeps slide 1 as a picture (${(rec.thumb || '').length} chars)`);
    const card = await until(() => page.evaluate((k) => { const c = document.querySelector(`.gd-card[data-key="${k}"]`), img = c?.querySelector('.gd-pic img'); return img?.complete && img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight, meta: c.querySelector('.gd-meta').textContent, title: c.querySelector('.gd-title').textContent, href: c.querySelector('.gd-title').getAttribute('href') } : null; }, key), 'the card thumbnail');
    check(card.title === 'Cell Biology week 3' && /^Slides/.test(card.meta) && card.href === `papers.html?slides=${encodeURIComponent(key)}` && Math.abs(card.w / card.h - 16 / 9) < 0.02, `the card: title, Slides meta, link, a 16:9 picture (${JSON.stringify(card)})`);
    // The picture is the slide: white with its title's dark ink, read back from the decoded image.
    const ink = await page.evaluate((k) => { const img = document.querySelector(`.gd-card[data-key="${k}"] .gd-pic img`), c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let white = 0, dark = 0; for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l > 240) white++; else if (l < 80) dark++; } return { white: white / (d.length / 4), dark: dark / (d.length / 4) }; }, key);
    check(ink.white > 0.6 && ink.dark > 0.005, `the card's picture is slide 1: mostly white with dark text (${JSON.stringify(ink)})`);
    // Search finds a deck by the words on its slides.
    await page.fill('#gd-q', 'membrane');
    await until(() => page.evaluate((k) => document.querySelectorAll('.gd-card').length === 1 && !!document.querySelector(`.gd-card[data-key="${k}"]`), key), 'search by slide text');
    await page.fill('#gd-q', 'nothing like this');
    await until(() => page.evaluate(() => document.querySelectorAll('.gd-card').length === 0), 'search miss');
    await page.fill('#gd-q', '');
    check(true, 'search finds the deck by its slides\' words');
    // The ⋯ menu names the deck's own export.
    await page.click(`.gd-card[data-key="${key}"] .gd-more`);
    const cardItems = await until(() => page.evaluate(() => [...document.querySelectorAll('.gd-menu [role="menuitem"]')].map((b) => b.textContent)), 'the card menu');
    check(cardItems.includes('Export .pptx') && !cardItems.includes('Export .docx'), `the card's ⋯: Export .pptx (${JSON.stringify(cardItems)})`);
    await page.keyboard.press('Escape');
    await shot('home-1280.png');
    await page.setViewportSize({ width: 640, height: 900 });
    await shot('home-640.png');
    await page.setViewportSize({ width: 1280, height: 900 });

    // ---- open: the rail and slide 1
    await page.click(`.gd-card[data-key="${key}"] .gd-title`);
    await until(() => page.evaluate(() => document.querySelectorAll('#gs-rail [data-slide]').length === 10 && !!document.querySelector('#gs-canvas .gs-slide')), 'the viewer');
    check(page.url().endsWith(`papers.html?slides=${encodeURIComponent(key)}`), 'the viewer is the card\'s address');
    const at = () => page.evaluate(() => ({ n: document.getElementById('gs-at').textContent, cur: document.querySelector('#gs-rail [aria-current="true"]')?.dataset.slide, text: document.querySelector('#gs-canvas .gs-slide')?.textContent || '' }));
    let now = await at();
    check(now.n === '1 / 10' && now.cur === '0' && /Cell Biology/.test(now.text), `slide 1 shows, current in the rail (${JSON.stringify(now)})`);
    const top = await page.evaluate(() => ({ title: document.querySelector('.gp-top h1')?.textContent, back: document.querySelector('.gp-top a')?.getAttribute('href'), mode: document.documentElement.dataset.mode, state: document.querySelector('.gp-top .gp-state')?.textContent }));
    check(top.title === 'Cell Biology week 3' && top.back === 'papers.html' && top.mode === 'slides' && top.state === '10 slides', `the top bar: Documents, the title, the count (${JSON.stringify(top)})`);
    const rail = await until(() => page.evaluate(() => { const b = [...document.querySelectorAll('#gs-rail [data-slide]')]; return b.slice(0, 3).every((x) => x.querySelector('.gs-slide')) ? b.map((x) => [x.getAttribute('aria-label'), x.hasAttribute('data-hidden')]) : null; }), 'rail thumbnails');
    check(rail[0][0] === 'Slide 1' && rail[6][0] === 'Slide 7 (Hidden)' && rail[6][1] && !rail[5][1], `the rail names each slide, the hidden one marked (${JSON.stringify(rail.slice(5, 8))})`);
    const railA11y = await page.evaluate(() => ({
      role: document.querySelector('#gs-rail [role="tablist"]')?.getAttribute('aria-orientation'),
      tabs: document.querySelectorAll('#gs-rail [role="tab"]').length,
      stops: [...document.querySelectorAll('#gs-rail button')].filter((b) => b.tabIndex === 0).map((b) => b.dataset.slide),
      label: document.getElementById('gs-canvas').getAttribute('aria-labelledby'),
    }));
    check(railA11y.role === 'vertical' && railA11y.tabs === 10 && railA11y.stops.join() === '0' && railA11y.label === 'gs-tab-0', `rail is a labelled tablist with one tab stop (${JSON.stringify(railA11y)})`);
    await page.focus('#gs-rail [data-slide="0"]');
    await page.keyboard.press('ArrowDown');
    check(await page.evaluate(() => document.activeElement.id === 'gs-tab-1' && document.activeElement.getAttribute('aria-selected') === 'true'), 'rail arrows move focus with the selected slide');
    await page.keyboard.press('Home');
    await page.focus('#gs-canvas');
    // The slide is as authored under a dark Look; the bar around it is the Look's.
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    const colours = await page.evaluate(() => ({ dark: document.documentElement.hasAttribute('data-dark'), slide: document.querySelector('#gs-canvas .gs-slide').style.backgroundColor, bar: getComputedStyle(document.querySelector('.gp-top')).backgroundColor, ground: getComputedStyle(document.getElementById('gs-canvas')).backgroundColor }));
    check(lum(colours.slide) > 0.98 && lum(colours.ground) < 0.35, `dark Look: the slide white, the ground dark (${JSON.stringify(colours)})`);
    await shot('viewer-1280.png');

    // ---- keys: arrows, Page keys, Home and End
    await page.keyboard.press('ArrowRight');
    now = await at();
    check(now.n === '2 / 10' && now.cur === '1' && /Membrane transport/.test(now.text), `→: slide 2 (${now.n})`);
    await page.keyboard.press('PageDown');
    check((await at()).n === '3 / 10', 'Page Down: slide 3');
    await page.keyboard.press('ArrowDown');
    check((await at()).n === '4 / 10', '↓: slide 4');
    await page.keyboard.press('PageUp');
    await page.keyboard.press('ArrowUp');
    check((await at()).n === '2 / 10', 'Page Up and ↑: back two');
    await page.keyboard.press('End');
    check((await at()).n === '10 / 10', 'End: the last slide');
    await page.keyboard.press('ArrowRight');
    check((await at()).n === '10 / 10', '→ on the last slide stays');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    check((await at()).n === '1 / 10', 'Home: the first, and ← there stays');
    await page.click('#gs-rail [data-slide="4"]');
    check((await at()).n === '5 / 10', 'a rail thumbnail opens its slide');
    const table = await page.evaluate(() => [...document.querySelectorAll('#gs-canvas table tr')].map((r) => r.children.length));
    check(JSON.stringify(table) === '[3,2,3,2]', `slide 5's table with its spans (${JSON.stringify(table)})`);

    // ---- zoom: ± and Fit
    const width = () => page.evaluate(() => document.querySelector('#gs-canvas .gs-stage').getBoundingClientRect().width);
    const fitW = await width();
    await page.click('#gs-zoom-in');
    const inW = await width();
    await page.click('#gs-zoom-out'); await page.click('#gs-zoom-out');
    const outW = await width();
    const zoomLabel = await page.evaluate(() => document.getElementById('gs-zoom').textContent);
    await page.click('#gs-zoom');
    const backW = await width();
    check(inW > fitW && outW < inW && /%$/.test(zoomLabel) && Math.abs(backW - fitW) < 1, `zoom: fit ${Math.round(fitW)} → in ${Math.round(inW)} → out ${Math.round(outW)} (${zoomLabel}) → fit ${Math.round(backW)}`);
    const fitted = await page.evaluate(() => { const s = document.querySelector('#gs-canvas .gs-stage').getBoundingClientRect(), c = document.getElementById('gs-canvas').getBoundingClientRect(); return s.width <= c.width + 1 && s.height <= c.height + 1; });
    check(fitted, 'Fit: the whole slide in the view');

    // ---- find: in the slides' text, across slides
    await page.keyboard.press('Control+f');
    await until(() => page.evaluate(() => document.activeElement?.id === 'gs-find-q'), 'find on Ctrl+F');
    await page.keyboard.type('transport');
    const found = await until(() => page.evaluate(() => { const n = document.getElementById('gs-find-n').textContent; return /of/.test(n) ? { n, at: document.getElementById('gs-at').textContent, marks: document.querySelectorAll('#gs-canvas mark.gs-hit').length, cur: document.querySelectorAll('#gs-canvas mark.gs-hit-cur').length } : null; }), 'find hits');
    check(found.n === '1 of 4' && found.at === '2 / 10' && found.marks === 4 && found.cur === 1, `find "transport": 4 matches, the first on slide 2, marked (${JSON.stringify(found)})`);
    await shot('viewer-find-1280.png');
    await page.keyboard.press('Enter');
    check(await page.evaluate(() => [...document.querySelectorAll('#gs-canvas .gs-hit-cur')].map((m) => m.textContent).join('') === 'transport'), 'one find hit selects all formatted fragments');
    await page.keyboard.press('Enter');
    check(await page.evaluate(() => document.querySelector('#gs-canvas .gs-hit-cur')?.parentElement.textContent === 'Active transport'), 'the next hit after a split run selects the next occurrence');
    await page.keyboard.press('Enter');
    const last = await page.evaluate(() => ({ n: document.getElementById('gs-find-n').textContent, at: document.getElementById('gs-at').textContent }));
    check(last.n === '4 of 4' && last.at === '5 / 10', `Enter walks the matches to slide 5 (${JSON.stringify(last)})`);
    await page.keyboard.press('Enter');
    check(await page.evaluate(() => document.getElementById('gs-find-n').textContent === '1 of 4'), 'find wraps forward');
    await page.keyboard.press('Shift+Enter');
    check(await page.evaluate(() => document.getElementById('gs-find-n').textContent === '4 of 4'), 'find wraps backward');
    await page.keyboard.press('Shift+Enter');
    check((await page.evaluate(() => document.getElementById('gs-find-n').textContent)) === '3 of 4', 'Shift+Enter goes back');
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => document.getElementById('gs-find-q').value === '' && !document.querySelector('#gs-canvas mark') && document.getElementById('gs-find-n').textContent === ''), 'Esc clears find and its marks');
    check(page.url().includes('?slides='), 'Esc in find stays on the deck');

    await page.fill('#gs-find-q', 'quiz');
    await until(() => page.evaluate(() => document.querySelector('#gs-notes-pane .gs-hit-cur')), 'notes-only find match');
    check(await page.evaluate(() => !document.getElementById('gs-notes-pane').hidden && document.getElementById('gs-find-n').textContent === '1 of 1' && document.getElementById('gs-at').textContent === '1 / 10'), 'a notes-only find hit opens the notes on its slide');
    await page.focus('#gs-find-q');
    await page.keyboard.press('Escape');

    // ---- notes (find opened them while "t" matched only slide 1's notes): the button closes and opens them
    await page.keyboard.press('Home');
    if (await page.evaluate(() => document.getElementById('gs-notes').getAttribute('aria-pressed') === 'true')) {
      await page.click('#gs-notes');
      check(await page.evaluate(() => document.getElementById('gs-notes-pane').hidden && document.getElementById('gs-notes').getAttribute('aria-pressed') === 'false'), 'Notes closes the notes');
    }
    await page.click('#gs-notes');
    const notes = await until(() => page.evaluate(() => { const p = document.getElementById('gs-notes-pane'); return !p.hidden && p.textContent ? { text: p.textContent, pressed: document.getElementById('gs-notes').getAttribute('aria-pressed') } : null; }), 'the notes');
    check(notes.text === 'Start with the quiz.\nThen the lab.' && notes.pressed === 'true', `Notes: slide 1's speaker notes (${JSON.stringify(notes)})`);
    await page.keyboard.press('ArrowRight');
    check(await page.evaluate(() => document.getElementById('gs-notes-pane').textContent === ''), 'slide 2 has none');
    await page.keyboard.press('Home');
    await shot('viewer-notes-1280.png');
    await page.setViewportSize({ width: 640, height: 900 });
    check(await page.locator('#gs-zoom-in').isVisible() && await page.locator('#gs-zoom-out').isVisible(), '640 px: zoom controls remain available');
    const narrowFit = await until(async () => { const w = await width(); return w <= 640 ? w : false; }, 'fit after resizing to 640 px');
    await page.click('#gs-zoom-in');
    check(await width() > narrowFit, '640 px: zoom in changes the slide scale');
    await page.click('#gs-zoom');
    await shot('viewer-640.png');
    await page.setViewportSize({ width: 1280, height: 900 });

    // ---- Present: a dialog (full screen where the browser allows it), Rimeward's keys, the hidden slide skipped
    await page.click('#gs-present');
    await until(() => page.evaluate(() => !!document.querySelector('dialog.gs-present[open] .gs-slide')), 'the presentation');
    const pc = () => page.evaluate(() => ({ n: document.querySelector('dialog.gs-present .gs-present-n')?.textContent, text: document.querySelector('dialog.gs-present .gs-slide')?.textContent || '' }));
    const full = await until(() => page.evaluate(() => globalThis.fullscreenResult), 'fullscreen request settled');
    check(full.ok && await page.evaluate(() => !!document.fullscreenElement), `Present enters fullscreen from the button gesture (${JSON.stringify(full)})`);
    check((await pc()).n === '1 / 9', 'Present: 9 slides, the hidden one left out');
    check(await page.evaluate(() => document.activeElement === document.querySelector('dialog.gs-present .gs-present-frame')), 'Present opens with the slide focused');
    const presentFit = await page.evaluate(() => { const r = document.querySelector('dialog.gs-present .gs-stage').getBoundingClientRect(); return { w: r.width, h: r.height, iw: innerWidth, ih: innerHeight }; });
    check(presentFit.w <= presentFit.iw + 1 && presentFit.h <= presentFit.ih + 1 && (Math.abs(presentFit.w - presentFit.iw) < 2 || Math.abs(presentFit.h - presentFit.ih) < 2), `the slide fills the screen (${JSON.stringify(presentFit)})`);
    await page.focus('dialog.gs-present button:last-child');
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.activeElement === document.querySelector('dialog.gs-present button')), 'Present traps Tab within the dialog');
    await page.keyboard.press('Shift+Tab');
    check(await page.evaluate(() => document.activeElement === document.querySelector('dialog.gs-present button:last-child')), 'Present traps Shift+Tab within the dialog');
    await shot('present-1280.png');
    await page.focus('dialog.gs-present .gs-present-frame');
    await page.keyboard.press('ArrowRight');
    check((await pc()).n === '2 / 9', 'Present →');
    await page.keyboard.press(' ');
    check((await pc()).n === '3 / 9', 'Present Space');
    await page.keyboard.press('PageDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    let p6 = await pc();
    check(p6.n === '6 / 9' && /Groups/.test(p6.text), `Present Page Down and ↓: slide 6 (${p6.n})`);
    await page.keyboard.press('ArrowRight');
    p6 = await pc();
    check(p6.n === '7 / 9' && /Odds and ends/.test(p6.text) && !/Backup slide/.test(p6.text), `the next after slide 6 is slide 8: the hidden slide 7 is skipped (${p6.n})`);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('PageUp'); await page.keyboard.press('ArrowUp');
    check((await pc()).n === '4 / 9', 'Present ←, Page Up, ↑');
    await page.keyboard.press('End');
    check((await pc()).n === '9 / 9', 'Present End');
    await page.keyboard.press('Home');
    check((await pc()).n === '1 / 9', 'Present Home');
    await page.keyboard.press('ArrowRight');
    await page.focus('dialog.gs-present button[aria-label="Previous"]');
    await page.keyboard.press(' ');
    check((await pc()).n === '1 / 9', 'Space on a focused button presses it (Previous from 2 / 9)');
    await page.focus('dialog.gs-present .gs-present-frame');
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => !document.querySelector('dialog.gs-present')), 'Esc ends the presentation');
    check(await page.evaluate(() => document.activeElement?.id === 'gs-present' && !document.fullscreenElement), 'Esc ends it, out of full screen, focus back on Present');
    check(page.url().includes('?slides='), 'and the deck stays open');

    // ---- the ⋯ menu: Export .pptx gives back the bytes
    await page.click('.gs-more');
    const items = await until(() => page.evaluate(() => [...document.querySelectorAll('.gs-menu [role="menuitem"]')].map((b) => b.textContent)), 'the ⋯ menu');
    await shot('viewer-menu-1280.png');
    const download = page.waitForEvent('download');
    await page.click('.gs-menu [data-act="export"]');
    const d = await download, dl = path.join(tmp, 'export.pptx');
    await d.saveAs(dl);
    check(items.includes('Export .pptx') && d.suggestedFilename() === 'Cell Biology week 3.pptx' && fs.readFileSync(dl).equals(deckBytes), `Export .pptx downloads the deck as given (${JSON.stringify(items)}, ${d.suggestedFilename()})`);
    await page.click('.gs-more');
    await until(() => page.evaluate(() => !!document.querySelector('.gs-menu')), 'the ⋯ menu again');
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => !document.querySelector('.gs-menu') && document.activeElement?.classList.contains('gs-more')), 'Esc closes ⋯ and focus goes back to it');
    await page.keyboard.press('Escape');
    check(page.url().includes('?slides='), 'Esc with nothing open stays on the deck');

    // ---- back to Documents with the bar's link; the card again; the tab's Back
    await page.click('.gp-top a[href="papers.html"]');
    await until(() => page.evaluate(() => !document.getElementById('list').hidden && !!document.querySelector('.gd-card')), 'home again');
    await page.click(`.gd-card[data-key="${key}"] .gd-title`);
    await until(() => page.evaluate(() => !!document.querySelector('#gs-canvas .gs-slide')), 'the deck again');
    await page.goBack();
    await until(() => page.evaluate(() => !document.getElementById('list').hidden && location.search === ''), 'Back to Documents');
    check(true, 'Back returns to Documents');

    // Turning import off preserves the existing deck's card and viewer.
    await worker.evaluate(async (s) => { await chrome.storage.sync.set(s); }, settings(false));
    await openHome();
    await until(() => page.locator(`.gd-card[data-key="${key}"]`).count(), 'off: existing deck card');
    check(await page.locator('#gd-file').getAttribute('accept').then((s) => !/pptx/.test(s)), 'off: import remains Word only');
    await page.click(`.gd-card[data-key="${key}"] .gd-title`);
    await until(() => page.locator('#gs-canvas .gs-slide').count(), 'off: existing deck opens');
    check((await at()).n === '1 / 10', 'off: existing slides still open for viewing');

    check(!errors.some((e) => /sender/.test(e)), 'no worker sender refusals');
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    check(requests.length === 0, `no network (${requests.join(', ')})`);
    passed = true;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'slides-results.json'), JSON.stringify({ passed, checks, errors, requests, shots }, null, 2) + '\n');
    console.log(`${passed ? 'PASS' : 'FAIL'} slides-check: ${checks.length} checks`);
  }
})();
