// The DocViewer, headless (W9): the real extension on a Canvas file page (test/fixtures/canvas-file-preview.html) that
// frames the DocViewer fixture (test/fixtures/canvas-docviewer.html), both served from playwright routes under their
// real hostnames. Nothing leaves the machine: every other request is aborted and DNS is mapped to nowhere. It checks the
// palette (dark and light), dimmed and inverted pages and the darkDocs migration, Glaze off, the annotation toolbar by
// keyboard, drawing, highlighting, undo and redo, the eraser, export, clear, import, the page picture, a page drawn
// again, zoom, rotation, and German words. There is no canvadocs on a local Canvas: a real signed-in viewer is still a
// check by hand before release.
//   NODE_PATH=/path/to/node_modules node scripts/docviewer-check.js [out dir for screenshots]   (needs playwright)
//   CHROME=/path/to/chrome runs that browser instead of Chrome for Testing.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const G = require('../defaults.js');

const ext = path.join(__dirname, '..');
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-docviewer-'));
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const fx = (f) => fs.readFileSync(path.join(ext, 'test/fixtures', f), 'utf8');
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const BLOB = encodeURIComponent(JSON.stringify({ user_id: 170000000000042, attachment_id: 21, type: 'canvadoc' }));
const KEY = 'ink:https://school.instructure.com/170000000000042/21';
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w9-'));
  await require('./wait-for-browser.js')();
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), {
    executablePath: CHROME, headless: true, viewport: { width: 1100, height: 900 }, reducedMotion: 'reduce', colorScheme: 'dark',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  try {
    let lang = 'en';
    const external = [];
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      // Canvas frames /api/v1/canvadoc_session?blob=…, which redirects to canvadocs; playwright doesn't route a
      // redirect's second request, so the frame opens canvadocs directly with the same blob (test/docviewer.test.js
      // reads the real address).
      if (u.host === 'school.instructure.com' && /^\/courses\/25\/files\/21/.test(u.pathname)) {
        const body = fx('canvas-file-preview.html').replace(/<iframe src="\/\/docs\.google\.com[^"]*"/, `<iframe id="file-preview-iframe" src="https://canvadocs.instructure.com/1/sessions/abc/view?from=/api/v1/canvadoc_session&amp;blob=${BLOB}&amp;hmac=x"`).replace('<html dir="ltr" lang="en"', `<html dir="ltr" lang="${lang}"`);
        return route.fulfill({ contentType: 'text/html', body });
      }
      if (u.host === 'canvadocs.instructure.com') return route.fulfill({ contentType: 'text/html', body: fx('canvas-docviewer.html').replace('</head>', '<style>.Page{position:relative;width:612px;margin:20px auto}.Pages{padding:10px}</style></head>') });
      if (u.host === 'school.instructure.com' && u.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      external.push(u.href);
      return route.abort();
    });
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    const set = (s) => opts.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); }, s);
    const local = () => opts.evaluate(() => chrome.storage.local.get(null));
    const look = (name) => ({ ...G.GZ_DEFAULTS, colors: G.GZ_PRESETS.find(([n]) => n === name)[1], preset: name });
    const page = await ctx.newPage();
    const frame = async () => {
      await page.waitForSelector('#file-preview-iframe');
      for (let i = 0; i < 50; i++) { const f = page.frames().find((x) => x.url().startsWith('https://canvadocs.')); if (f) { await f.waitForLoadState(); return f; } await page.waitForTimeout(100); }
      throw new Error('no docviewer frame');
    };
    const load = async () => { await page.goto('https://school.instructure.com/courses/25/files/21'); const f = await frame(); await page.waitForTimeout(600); return f; };

    // Dark (Frost), pages plain, no ink.
    await set({ ...look('Frost') });
    let f = await load();
    const surf = G.GZ_PRESETS.find(([n]) => n === 'Frost')[1];
    const st = await f.evaluate(() => ({ docs: document.documentElement.hasAttribute('data-gz-docs'), bg: getComputedStyle(document.body).backgroundColor, bar: getComputedStyle(document.querySelector('.ViewerControls')).backgroundColor, ink: !!document.querySelector('#gz-ink-bar, .gz-ink'), pages: document.documentElement.getAttribute('data-gz-pages'), glazeContent: !!window.__gzGlaze }));
    ok(st.docs, 'dark: the viewer wears the palette');
    const rgb = (hex) => `rgb(${hex.slice(1).match(/../g).map((h) => parseInt(h, 16)).join(', ')})`;
    ok(st.bg === rgb(surf['--gz-surface-2']), `dark: background is the ground ${st.bg}`);
    ok(st.bar === rgb(surf['--gz-surface']), `dark: toolbar is the surface ${st.bar}`);
    ok(!st.ink, 'annotations off by default: no toolbar, no layer');
    ok(st.pages === null, 'pages plain by default');
    ok(!st.glazeContent, 'the first content script is not in the canvadocs frame');
    const parentFilter = await page.evaluate(() => getComputedStyle(document.getElementById('file-preview-iframe')).filter);
    ok(parentFilter === 'none', `the canvadocs frame is not inverted from outside (${parentFilter})`);
    await page.screenshot({ path: path.join(out, 'frost-plain.png') });

    // Dimmed pages, then inverted (the old switch, migrated).
    await set({ ...look('Frost'), enhance: { ...G.GZ_DEFAULTS.enhance, docPages: 'dim' } });
    await page.waitForTimeout(500);
    ok(await f.evaluate(() => document.documentElement.getAttribute('data-gz-pages')) === 'dim', 'a settings change reaches the open frame (dim) without a reload');
    ok(await f.evaluate(() => getComputedStyle(document.querySelector('.Page-canvas-container')).filter).then((x) => /brightness/.test(x)), 'dimmed pages: the page canvas is dimmed');
    const raw = { ...look('Frost'), enhance: { ...G.GZ_DEFAULTS.enhance, darkDocs: true } };
    delete raw.enhance.docPages;
    await set(raw);
    await page.waitForTimeout(500);
    ok(await f.evaluate(() => document.documentElement.getAttribute('data-gz-pages')) === 'dark', 'darkDocs: true from 2.2 inverts the pages');
    ok(await f.evaluate(() => getComputedStyle(document.querySelector('.PageAnnotations')).filter) === 'none', 'Canvas annotation layer is never filtered');

    // Light (Paper): palette on, pages never dimmed in a light palette.
    await set({ ...look('Paper'), enhance: { ...G.GZ_DEFAULTS.enhance, docPages: 'dim' } });
    await page.waitForTimeout(500);
    const paper = G.GZ_PRESETS.find(([n]) => n === 'Paper')[1];
    ok(await f.evaluate(() => getComputedStyle(document.body).backgroundColor) === rgb(paper['--gz-surface-2']), 'light: ground from Paper');
    ok(await f.evaluate(() => document.documentElement.getAttribute('data-gz-pages')) === null, 'light: pages not dimmed');
    await page.screenshot({ path: path.join(out, 'paper.png') });

    // Glaze off: the frame goes back to Canvas's own look.
    await set({ ...look('Frost'), enabled: false });
    await page.waitForTimeout(500);
    ok(await f.evaluate(() => !document.documentElement.hasAttribute('data-gz-docs') && !document.getElementById('gz-docs') && !document.querySelector('style')?.textContent.includes('--gz-')), 'Glaze off: nothing left in the frame');

    // Annotations on.
    await set({ ...look('Frost'), enhance: { ...G.GZ_DEFAULTS.enhance, docInk: true } });
    f = await load();
    const bar = f.locator('#gz-ink-bar');
    ok(await bar.count() === 1, 'annotations on: the toolbar is there');
    ok(await f.locator('#page-1 > svg.gz-ink').count() === 1, 'a layer on page 1');
    // Keyboard: Tab reaches the Annotate button, Enter opens the tools with the pen picked.
    await f.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) { await page.keyboard.press('Tab'); reached = await f.evaluate(() => document.activeElement?.id === 'gz-ink-bar' && document.activeElement.shadowRoot.activeElement?.getAttribute('aria-label') === 'Annotate'); }
    ok(reached, 'keyboard: Tab reaches Annotate');
    await page.keyboard.press('Enter');
    ok(await f.evaluate(() => document.documentElement.getAttribute('data-gz-tool')) === 'pen', 'Enter picks the pen');
    ok(await bar.locator('button[aria-label="Pen"]').getAttribute('aria-pressed') === 'true', 'pen shows pressed');
    // Draw a stroke on page 1.
    await f.locator('#page-1').evaluate((p) => p.scrollIntoView());
    const box = await f.locator('#page-1').boundingBox();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 100 + i * 10, box.y + 100 + Math.sin(i / 3) * 20);
    await page.mouse.up();
    await page.waitForTimeout(300);
    let L = await local();
    ok(L[KEY]?.pages?.['1']?.length === 1, `a stroke saved under ${KEY}`);
    const s = L[KEY]?.pages?.['1']?.[0];
    ok(s && s.t === 'pen' && s.p.length >= 4 && s.p.length < 42, `simplified: ${s?.p.length / 2} points kept of 21`);
    ok(!JSON.stringify(L).includes('school.instructure.com/') || Object.keys(L).every((k) => k === KEY || !k.startsWith('ink:')), 'one key only');
    // Highlighter and a second stroke, then undo/redo with the keyboard.
    await bar.locator('button[aria-label="Highlighter"]').click();
    await page.mouse.move(box.x + 100, box.y + 300); await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 300, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(200);
    ok((await local())[KEY]?.pages['1'].length === 2, 'highlight saved');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    ok((await local())[KEY]?.pages['1'].length === 1, 'Ctrl+Z undoes');
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(200);
    ok((await local())[KEY]?.pages['1'][1]?.t === 'hl', 'Ctrl+Shift+Z redoes');
    await page.screenshot({ path: path.join(out, 'ink.png') });
    // Eraser across the first stroke.
    await bar.locator('button[aria-label="Eraser"]').click();
    await page.mouse.move(box.x + 150, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x + 150, box.y + 160, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(200);
    L = await local();
    ok(L[KEY]?.pages['1'].length === 1 && L[KEY].pages['1'][0].t === 'hl', 'eraser removed the pen stroke only');
    // Export, then clear page, then import it back.
    const [dl] = await Promise.all([page.waitForEvent('download'), bar.locator('button[aria-label="Export annotations"]').click()]);
    const file = path.join(out, 'export.json');
    await dl.saveAs(file);
    ok(JSON.parse(fs.readFileSync(file, 'utf8')).format === 'glaze-annotations', `export downloads ${dl.suggestedFilename()}`);
    await bar.locator('button[aria-label="Clear page"]').click();
    await page.waitForTimeout(200);
    ok(!(KEY in await local()), 'clear page empties the file: key removed');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z'); // tool down: Ctrl+Z is the viewer's, nothing happens
    await page.waitForTimeout(200);
    ok(!(KEY in await local()), 'with no tool picked, Ctrl+Z is left to the viewer');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), bar.locator('button[aria-label="Import annotations"]').click()]);
    await chooser.setFiles(file);
    await page.waitForTimeout(400);
    ok((await local())[KEY]?.pages['1'].length === 1, 'import brings the marks back');
    const [pic] = await Promise.all([page.waitForEvent('download'), bar.locator('button[aria-label="Save page as picture"]').click()]);
    ok(/^page-1-21\.png$/.test(pic.suggestedFilename()), `page picture ${pic.suggestedFilename()}`);
    // Re-render on scroll: the viewer replaces a page's contents; the layer comes back with the marks.
    await f.evaluate(() => { const p = document.getElementById('page-1'); p.replaceChildren(...[...p.children].filter((c) => !c.matches('.gz-ink')).map((c) => c.cloneNode(true))); });
    await page.waitForTimeout(300);
    ok(await f.locator('#page-1 > svg.gz-ink path').count() === 1, 'a page drawn again gets its layer and marks back');
    // Zoom: the page doubles in width; the layer follows, the stroke keeps its place in page units.
    await f.evaluate(() => { document.getElementById('page-1').style.width = '1224px'; });
    await page.waitForTimeout(300);
    const vb = await f.locator('#page-1 > svg.gz-ink').getAttribute('viewBox');
    ok(/^0 0 1000 \d+$/.test(vb), `viewBox in page units at any zoom: ${vb}`);
    // Rotation: a click on the rotate button turns the frame a quarter turn.
    await f.locator('button[aria-label="Rotate Page Clockwise By 90 Degrees"]').click();
    await page.waitForTimeout(300);
    ok(/^matrix\(0,1,-1,0,/.test(await f.locator('#page-1 > svg.gz-ink g').getAttribute('transform')), 'rotate: the layer turns a quarter');
    await page.screenshot({ path: path.join(out, 'ink-rotated.png') });

    // German.
    lang = 'de';
    f = await load();
    await page.waitForTimeout(1500);
    ok(await f.locator('#gz-ink-bar button[aria-label="Anmerken"]').count() === 1, 'German page: the toolbar speaks German');
    const hosts = [...new Set(external.map((u) => new URL(u).host))];
    ok(hosts.every((h) => /^((school|canvas)\.instructure\.com|localhost:3000)$/.test(h)), `only the fixtures' own assets were asked for (all aborted; DNS is mapped to nowhere): ${hosts.join(', ')}`);
    console.log(`screenshots in ${out}`);
  } finally {
    await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
