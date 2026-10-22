// Render the shared CSS and content.js scene placement against native shell geometry.
// NODE_PATH=<playwright> nice -n 15 node scripts/background-shell-check.js [evidence directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = process.env.EXT || path.resolve(__dirname, '..'), out = process.argv[2];
const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const start = source.indexOf('  const placeScene = '), end = source.indexOf('  const stopScene = ', start);
const placement = source.slice(start, end);
const lock = require('./check-env.js').lockPath();
const failures = [], results = []; let browser, held = false;
(async () => {
  try {
    fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nbackground-shell-check\n`);
    await require('./wait-for-browser.js')();
    browser = await chromium.launch({ headless: true, ...require('./check-env.js').chromeLaunch() });
    const page = await browser.newPage(), decoder = await browser.newPage();
    await page.route('**/*', r => r.abort());
    const families = ['dashboard', 'courses', 'activity', 'global-calendar', 'global-grades', 'global-messages', 'profile', 'outline', 'calendar', 'announcements', 'discussions', 'gradebook', 'messages', 'groups', 'achievements', 'document', 'assignment', 'test', 'submission', 'discussion', 'announcement', 'standalone-item', 'retained-course', 'canvas', 'moodle'];
    for (const width of [1440, 390]) for (const dir of ['ltr', 'rtl']) for (const family of families) {
      const base = ['dashboard', 'courses', 'activity', 'global-calendar', 'global-grades', 'global-messages', 'profile', 'canvas', 'moodle'].includes(family);
      const overlay = ['document', 'assignment', 'test', 'submission', 'discussion', 'announcement'].includes(family);
      await page.setViewportSize({ width, height: 800 });
      await page.setContent(`<!doctype html><html dir="${dir}" data-gz-bg="scene"><head><style>
        html { --gz-surface-2:#102030; --gz-bg-grad:linear-gradient(#102030,#102030); --gz-bg-dim:0%; --gz-bg-blur:0px; }
        body { margin:0; } #site-wrap { position:relative; height:100vh; overflow:hidden; }
        .course-content-container { position:absolute; inset:0; }
        .panel-wrap { position:absolute; inset:80px 0 0; z-index:0; overflow:auto; }
        .tool { inset:94px ${width > 700 ? '360px' : '0'} 0 0; }
        [dir=rtl] .tool { inset-inline:0 ${width > 700 ? '360px' : '0'}; }
        .bb-offcanvas-panel { position:absolute; inset:0; z-index:10; }
        .bb-offcanvas-panel-wrap { position:absolute; inset:80px 0 0; }
        .bb-offcanvas-panel .panel-wrap { top:94px; }
        header { position:relative; height:94px; background:#00cc00; }
        #navbar { position:fixed; inset:12px 12px auto; height:50px; background:#0d1b2e; z-index:1260; }
        #sidebar { position:fixed; top:210px; bottom:12px; inset-inline-end:12px; width:${width > 700 ? 320 : 100}px; background:#0d1b2e; z-index:1000; }
        .scroll-content { height:1600px; } .route-view-container { padding-top:100px; }
      </style></head><body><div id="site-wrap">${base ? '<div class="route-view-container">' : '<div class="course-content-container"><div class="panel-wrap"><header></header>'}
      <main class="${!base && !overlay && family !== 'outline' ? 'panel-wrap tool' : 'content'}"><div class="scroll-content"></div></main>
      ${base ? '</div>' : '</div>' + (overlay ? '<div class="bb-offcanvas-panel"><div class="bb-offcanvas-panel-wrap"><header></header><div class="panel-wrap"><div class="scroll-content"></div></div></div></div>' : '') + '</div>'}
      </div><div id="navbar"></div><div id="sidebar"></div></body></html>`);
      if (family === 'standalone-item') await page.evaluate(() => {
        const item = document.createElement('div'); item.className = 'panel-wrap';
        item.innerHTML = '<header></header><div class="scroll-content"></div>';
        document.querySelector('.course-content-container').append(item);
      });
      for (const sheet of ['theme.css', 'extras.css']) await page.addStyleTag({ path: path.join(root, sheet) });
      await page.addScriptTag({ path: path.join(root, 'lib/scene-host.js') });
      // Draw a known scene frame: pixel assertions catch clipping/occlusion independently of renderer/GPU variability.
      await page.evaluate(({ placement, ultra }) => {
        const sceneCanvas = document.createElement('canvas'); sceneCanvas.id = 'gz-scene';
        sceneCanvas.width = 16; sceneCanvas.height = 16;
        const ctx = sceneCanvas.getContext('2d'); ctx.fillStyle = '#184080'; ctx.fillRect(0,0,16,16);
        const scene = { draw() {} }, modBg = null;
        const LAYERS = ':is(.panel-wrap,.bb-offcanvas-panel):not(.peek,:is(.peek,.peek-panel__content-wrapper,.ms-Panel-main) *)';
        const place = new Function('sceneCanvas','modBg','scene','ultra','LAYERS', placement + ';return placeScene;')(sceneCanvas, modBg, scene, ultra, LAYERS);
        place(); window.placeBackground = place;
      }, { placement, ultra: !['canvas', 'moodle'].includes(family) });
      if (family === 'retained-course') await page.evaluate(() => { document.documentElement.setAttribute('data-gz-ctab-framed', ''); window.placeBackground(); });
      for (const scrolled of [false, true]) {
        if (scrolled) await page.locator('.panel-wrap').evaluateAll(es=>es.forEach(e=>e.scrollTop=240));
        const png = await page.screenshot();
        const points = [[2,4], [dir === 'rtl' ? 2 : width-2,400], [Math.floor(width/2),400]];
        const pixels = await decoder.evaluate(async ({ png, points }) => {
          const im = new Image(); im.src = `data:image/png;base64,${png}`; await im.decode();
          const c = document.createElement('canvas'); c.width=im.width; c.height=im.height;
          const ctx=c.getContext('2d'); ctx.drawImage(im,0,0); return points.map(([x,y])=>[...ctx.getImageData(x,y,1,1).data].slice(0,3));
        }, { png:png.toString('base64'), points });
        const label = `${width} ${dir} ${family} ${scrolled ? 'scrolled' : 'top'}`;
        const pass = pixels.every(p=>p.every((v,i)=>Math.abs(v-[24,64,128][i])<=2));
        results.push({ label, pass, pixels }); if (!pass) failures.push(`${label}: ${JSON.stringify(pixels)}`);
        if (out && width===1440 && dir==='ltr' && !scrolled && ['outline','gradebook','submission'].includes(family)) { fs.mkdirSync(out,{recursive:true}); fs.writeFileSync(path.join(out,`${family}.png`),png); }
      }
      if (family === 'retained-course') {
        await page.evaluate(() => {
          const canvas = document.getElementById('gz-scene');
          GZ_SCENE_HOST.clear(canvas); canvas.remove();
          document.documentElement.style.setProperty('--gz-bg-grad', 'linear-gradient(#184080,#184080)');
        });
        const png = await page.screenshot();
        const pixel = await decoder.evaluate(async png => {
          const im = new Image(); im.src = `data:image/png;base64,${png}`; await im.decode();
          const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
          const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0); return [...ctx.getImageData(2, 4, 1, 1).data].slice(0, 3);
        }, png.toString('base64'));
        const label = `${width} ${dir} retained-course fallback`;
        const pass = pixel.every((v, i) => Math.abs(v - [24, 64, 128][i]) <= 2);
        results.push({ label, pass, pixels: [pixel] }); if (!pass) failures.push(`${label}: ${JSON.stringify(pixel)}`);
      }
    }
  } finally { await browser?.close(); if (held) fs.rmSync(lock,{recursive:true}); }
  if (out) { fs.mkdirSync(out,{recursive:true}); fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)); }
  console.log(`${results.length-failures.length}/${results.length} background shell pixel checks passed`);
  assert.deepEqual(failures,[]);
})().catch(e=>{console.error(e);process.exitCode=1;});
