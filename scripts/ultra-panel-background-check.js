// Real CSS on a synthetic Ultra panel, using the native gutter/close-button structure observed on Blackboard.
// NODE_PATH=/path/to/node_modules nice -n 15 node scripts/ultra-panel-background-check.js [receipt folder]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = process.env.EXT || path.resolve(__dirname, '..');
const out = process.argv[2];
const chromeLaunch = require('./check-env.js').chromeLaunch();
const fixture = `<!doctype html><html><head><style>
  html { --gz-surface-2: #102030; --gz-bg-grad: linear-gradient(#102030, #102030); --gz-bg-dim: 0%;
    --gz-bg-image: linear-gradient(#102030, #102030); --gz-bg-1: #102030; --gz-bg-2: #102030; --gz-bg-3: #102030; }
  body { margin: 0; }
  #site-wrap { position: relative; height: 100vh; overflow: clip; }
  .underneath { position: absolute; inset: 0; background: repeating-linear-gradient(red 0 12px, #ff9900 12px 24px); }
  .bb-offcanvas-panel { position: absolute; inset: 0 0 0 36px; z-index: 10; }
  [dir=rtl] .bb-offcanvas-panel { inset: 0 36px 0 0; }
  .bb-offcanvas-panel-wrap { height: 100%; }
  .panel-wrap { position: absolute; inset: 0; overflow: auto; }
  .bb-close-offset { position: absolute; top: 30px; inset-inline-start: 0; }
  .bb-close { position: absolute; inset-inline-start: -24px; width: 40px; height: 40px; border: 0; background: #fff; color: #000; }
  .below-header .panel-wrap { top: 94px; }
  header { position: relative; height: 94px; background: #00cc00; }
  .scroll-content { height: 1400px; }
  .peek-panel__content-wrapper { position: absolute; inset: 0 0 0 60%; z-index: 30; }
</style></head><body><div id="site-wrap"><div class="underneath"></div>
<div class="bb-offcanvas-panel full"><div class="bb-offcanvas-panel-wrap">
  <header hidden>Course header</header><div class="panel-wrap"><div class="scroll-content"></div></div>
  <div class="bb-close-offset"><button class="bb-close" aria-label="Close">×</button></div>
</div></div></div></body></html>`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-panel-background-'));
  let context;
  const failures = []; let checks = 0;
  const check = (value, message) => { checks++; if (!value) failures.push(message); };
  try {
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, { ...chromeLaunch, headless: true, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage(), decoder = await context.newPage();
    // Decode screenshot pixels in a separate blank document, without another image dependency.
    const pixels = async (points) => decoder.evaluate(async ({ png, points }) => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3));
    }, { png: (await page.screenshot()).toString('base64'), points });
    for (const width of [1280, 375]) for (const dir of ['ltr', 'rtl']) for (const kind of ['gradient', 'image', 'aurora', 'scene', 'solid']) {
      await page.setViewportSize({ width, height: 800 });
      await page.setContent(fixture);
      for (const sheet of ['theme.css', 'motion.css', 'extras.css']) await page.addStyleTag({ path: path.join(root, sheet) });
      await page.evaluate(({ dir, kind }) => {
        document.documentElement.dir = dir; document.documentElement.dataset.gzBg = kind;
        document.documentElement.style.setProperty('--gz-bg-blur', '6px');
        document.querySelector('button').onclick = () => document.body.dataset.closed = 'yes';
        if (kind === 'scene') {
          const canvas = document.createElement('canvas'); canvas.id = 'gz-scene';
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#184080'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          document.querySelector('.panel-wrap').append(canvas);
        }
      }, { dir, kind });
      const label = `${width} ${dir} ${kind}`;
      const x = dir === 'ltr' ? 20 : width - 20;
      const clickable = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') === 'Close', [x, 50]);
      check(clickable, `${label}: the protruding close button must be hit-testable`);
      await page.mouse.click(x, 50);
      check(await page.locator('body').getAttribute('data-closed') === 'yes', `${label}: the gutter click must activate Close`);
      if (kind !== 'solid') {
        const [gutter, inside] = await pixels([[x, 200], [width / 2, 200]]);
        check(gutter[0] < 100, `${label}: covered navigation must not show through the gutter (${gutter})`);
        if (kind === 'scene') check(gutter.every((v, i) => Math.abs(v - inside[i]) < 3), `${label}: the scene must continue across the gutter (${gutter} vs ${inside})`);
      }
      if (out && width === 1280 && dir === 'ltr' && kind === 'scene') {
        fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'announcement-gutter.png') });
      }
      // A discussion's inner scroller starts below the header: its fixed background must stay below it.
      await page.evaluate(() => { document.querySelector('.bb-offcanvas-panel').classList.add('below-header'); document.querySelector('header').hidden = false; document.querySelector('.panel-wrap').scrollTop = 200; });
      const [header] = await pixels([[width / 2, 15]]);
      check(header[1] > 150 && header[0] < 40, `${label}: the scrolled background must not cover the course header (${header})`);
      if (kind === 'scene') {
        const [aboveGutter, gutter, inside] = await pixels([[x, 15], [x, 200], [dir === 'ltr' ? 60 : width - 60, 200]]);
        check(gutter.every((v, i) => Math.abs(v - inside[i]) < 3), `${label}: the scrolled scene must continue across the gutter (${gutter} vs ${inside})`);
        check(aboveGutter[2] < 70 && gutter[2] > 100, `${label}: the scene must stay below the header in the gutter (${aboveGutter} vs ${gutter})`);
      }
    }
    // Announcement panels pad the scroller, then pull their header back with a negative margin.
    // Inserting the strip before that header must reserve its whole row, including at large tab sizes.
    for (const width of [1280, 375]) for (const dir of ['ltr', 'rtl']) for (const at of ['above', 'between', 'below']) for (const size of ['small', 'medium', 'large']) {
      await page.setViewportSize({ width, height: 800 });
      await page.setContent(`<!doctype html><html dir="${dir}" data-gz-bg="scene" data-gz-ctabs="${at} ${size}"><head><style>
        * { box-sizing: border-box; } body { margin: 0; }
        #site-wrap { position: relative; height: 100vh; overflow: clip; }
        .bb-offcanvas-panel { position: absolute; inset: 0; inset-inline-start: 36px; }
        .panel-wrap { position: absolute; inset: 0; overflow: auto; padding: ${width < 700 ? 20 : 30}px; }
        .panel-header { display: flex; align-items: center; height: 107px; margin: -${width < 700 ? 20 : 30}px -${width < 700 ? 20 : 30}px 0; padding: 0 ${width < 700 ? 20 : 30}px; }
        .panel-titles-container { flex: 1; min-width: 0; } .panel-sub-title { display: block; font: 14px/21px sans-serif; }
        h1 { margin: 0; font: 32px/45px sans-serif; } .panel-content { position: relative; min-height: 140px; }
        .bb-close { position: absolute; top: 30px; inset-inline-start: -24px; width: 40px; height: 40px; }
      </style></head><body><div id="site-wrap"><div class="bb-offcanvas-panel"><div class="panel-wrap">
        <header class="panel-header simple-header"><div class="panel-titles-container"><span class="panel-sub-title">Course Announcements</span><h1>Week 7</h1></div></header>
        <div class="panel-content">Announcement content</div>
      </div><button class="bb-close" aria-label="Close">×</button></div></div></body></html>`);
      for (const sheet of ['theme.css', 'motion.css', 'extras.css']) await page.addStyleTag({ path: path.join(root, sheet) });
      await page.evaluate(({ at, size }) => {
        const strip = document.createElement('div'); strip.id = 'gz-ctabs'; strip.dataset.at = 'nested'; strip.dataset.size = size; strip.dataset.shape = 'pill';
        strip.innerHTML = '<div class="gz-ctabs-list" role="tablist" aria-label="Course tabs"><div class="gz-ctab" role="tab" aria-selected="true"><span class="gz-ctab-name">Spanish 110</span></div><div class="gz-ctab" role="tab" aria-selected="false"><span class="gz-ctab-name">Computer Science</span></div></div>';
        const header = document.querySelector('header'); if (at === 'above') header.before(strip); else header.after(strip);
      }, { at, size });
      const geometry = await page.evaluate(() => {
        const rect = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
        const label = document.querySelector('.panel-sub-title'), r = label.getBoundingClientRect();
        return { strip: rect('#gz-ctabs'), header: rect('header'), content: rect('.panel-content'), subtitleVisible: [r.top + 1, r.top + r.height / 2, r.bottom - 1].every((y) => document.elementFromPoint(r.left + r.width / 2, y) === label) };
      });
      const label = `${width} ${dir} ${at} ${size}`;
      check(at === 'above' ? geometry.header.top >= geometry.strip.bottom : geometry.strip.top >= geometry.header.bottom, `${label}: course tabs must not overlap the native panel header (${JSON.stringify(geometry)})`);
      check(geometry.subtitleVisible, `${label}: the full announcement subtitle must remain exposed`);
      check(geometry.content.top >= Math.max(geometry.header.bottom, geometry.strip.bottom), `${label}: announcement content must follow both header and tabs`);
      if (out && width === 1280 && dir === 'ltr' && at === 'above' && size === 'large') await page.screenshot({ path: path.join(out, 'announcement-course-tabs.png') });
    }
    // A course open over the Courses page, a scene's host its container (lib/scene-host.js): Glaze's controls on the
    // cards underneath (course menu, bookmarks, a condensed title) stay under the course, seen and clicked.
    for (const width of [1280, 375]) for (const dir of ['ltr', 'rtl']) for (const kind of ['gradient', 'image', 'aurora', 'scene', 'shader', 'layers', 'media', 'solid']) {
      const drawn = ['scene', 'shader', 'layers', 'media'].includes(kind);
      await page.setViewportSize({ width, height: 800 });
      await page.setContent(`<!doctype html><html dir="${dir}" data-gz-bg="${kind}" data-gz-enhance-coursemenu data-gz-card-condensed data-gz-ctabs="page"><head><style>
        body { margin: 0; } #site-wrap { position: relative; height: 100vh; overflow: hidden; } #main-content { height: 100%; overflow-y: auto; }
        article { width: 262px; height: 284px; margin: 16px; } .course-banner { height: 128px; }
        #gz-room > .gz-w { inset-inline-end: 8px; top: 100px; width: 100px; height: 120px; }
        .panel-wrap { position: absolute; inset: 0; z-index: 10; overflow-y: auto; }
      </style></head><body><div id="site-wrap"><main id="main-content"><div id="main-content-inner"><div id="gz-ctabs" data-at="page"><button>Retained course</button></div>
        <div id="gz-room"><section class="gz-w" style="z-index:999"><button>Moved board tile</button></section></div>
        <section class="base-courses-container"><div class="course-list multi-column-view">
        <article id="course-list-course-_101_1" class="element-card course-element-card" data-course-id="_101_1"><div class="course-banner"></div><div class="gz-bm"><a href="#">Syllabus</a></div>
        <div class="element-details"><h4 class="course-title">Biology</h4></div><button type="button" class="gz-cm-btn" aria-label="Colour and look"></button></article>
      </div></section></div></main><div class="course-content-container"><div class="panel-wrap"><section class="course"><p>Course content</p></section></div></div></div></body></html>`);
      for (const sheet of ['theme.css', 'motion.css', 'extras.css', 'features/apps.css', 'features/coursetabs.css']) await page.addStyleTag({ path: path.join(root, sheet) });
      await page.addScriptTag({ path: path.join(root, 'lib/scene-host.js') });
      if (drawn) await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.id = 'gz-scene';
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#184080'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        GZ_SCENE_HOST.place(canvas, true);
      });
      const hits = await page.evaluate(() => [...document.querySelectorAll('.gz-cm-btn, .gz-bm, .course-title, #gz-room button, #gz-ctabs button')].map((e) => {
        const r = e.getBoundingClientRect();
        return [e.className, !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.course-content-container')];
      }));
      check(hits.every(([, under]) => under), `${width} ${dir} ${kind}: cards, moved board tiles and page tabs stay under an open course (${JSON.stringify(hits)})`);
      if (out && width === 375 && dir === 'ltr' && kind === 'scene') { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'course-over-cards.png') }); }
      await page.evaluate(() => {
        const canvas = document.getElementById('gz-scene'); if (canvas) { GZ_SCENE_HOST.clear(canvas); canvas.remove(); }
        document.querySelector('.course-content-container').remove();
      });
      const restored = await page.locator('.gz-cm-btn, #gz-room button, #gz-ctabs button').evaluateAll((els) => els.every((e) => {
        const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      }));
      check(restored, `${width} ${dir} ${kind}: closing the course restores card, board and tab hit targets`);
    }
    // Peek/Fabric side sheets and their descendants never acquire full-page backgrounds or clipping.
    for (const selector of ['bb-offcanvas-panel peek', 'peek-panel__content-wrapper', 'ms-Panel-main']) {
      await page.setContent(`<!doctype html><html data-gz-bg="gradient"><body><div class="${selector}"><div class="bb-offcanvas-panel"><div class="panel-wrap"></div></div></div></body></html>`);
      await page.addStyleTag({ path: path.join(root, 'extras.css') });
      const styles = await page.locator('body div').evaluateAll((els) => els.map((e) => ({ cls: e.className, clip: getComputedStyle(e).clipPath, before: getComputedStyle(e, '::before').content })));
      check(styles.every((s) => s.clip === 'none' && s.before === 'none'), `${selector}: partial-width sheets must keep their own background and clipping (${JSON.stringify(styles)})`);
    }
  } finally { await context?.close(); fs.rmSync(profile, { recursive: true, force: true }); }
  console.log(`${checks - failures.length}/${checks} Ultra panel background checks passed`);
  assert.deepEqual(failures, []);
})().catch((e) => { console.error(e); process.exitCode = 1; });
