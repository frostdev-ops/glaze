// The real unpacked extension drawing a custom shader and layered backgrounds from a Look's parts: lookX in storage, read by
// features/lookparts.js, GZ_CTX.parts(), content.js syncScene (the checker loaded on demand through the worker), lib/scene.js
// imported from the page, and the editor's preview frames telling their parent what the guard did. Software GL (Playwright's
// Chromium has no GPU in headless), so this checks the wiring, not speed: scripts/scene-check.mjs has the timings.
//   nice -n 10 NODE_PATH=/path/to/node_modules node scripts/scene-page-check.js [out-dir]
// One headless browser at a time across agents: wait while another is running. Every profile is temporary.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict');

const ext = require('./check-env.js').staged(path.join(__dirname, '..'), ['https://ultra.fixture.test/*']);
const out = process.argv[2] && path.resolve(process.argv[2]);
const chromeLaunch = require('./check-env.js').chromeLaunch();
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const origin = 'https://ultra.fixture.test';
const D = require(path.join(ext, 'defaults.js'));
const P = require(path.join(ext, 'lib/lookparts.js'));
const read = (f) => fs.readFileSync(path.join(ext, f), 'utf8');
const AURORA = read('assets/shaders/aurora.glsl');
const fixture = '<!doctype html><html lang="en"><head><base href="//ultra-cdn.invalid/ultra/uiv4001.0.0-rel/"><meta charset="utf-8"><title>Ultra fixture</title></head><body><div id="site-wrap"><nav id="base_tools"><a href="/ultra/institution-page"><span>Institution Page</span></a><a href="/ultra/course">Courses</a></nav><main id="main-content"><div id="main-content-inner"><h1>Stream</h1></div></main></div></body></html>';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-scene-page-')));
  const results = [], errors = [], blocked = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };
  let context, failModule = true, failedModules = 0, failDependency = true, failedDependencies = 0;
  try {
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...chromeLaunch, headless: true, viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(15000);
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') {
        if (failModule && u.pathname === '/lib/scene.js') { failModule = false; failedModules++; return r.abort(); }
        if (failDependency && u.pathname === '/lib/three.min.js') { failDependency = false; failedDependencies++; return r.abort(); }
        return r.continue();
      }
      if (u.origin !== origin) { blocked.push(u.href); return r.abort(); }
      if (u.pathname.startsWith('/ultra')) return r.fulfill({ contentType: 'text/html', body: fixture });
      if (u.pathname.startsWith('/learn/api/')) return r.fulfill({ json: u.pathname.endsWith('/users/me') ? { id: '_900_1' } : { results: [] } });
      blocked.push(u.href); return r.abort();
    });
    // Exercise the injection broker too: a rejected helper load must not poison the shorter scene retries.
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      const inject = chrome.scripting.executeScript.bind(chrome.scripting);
      globalThis.__gzSceneHostFailures = 0;
      chrome.scripting.executeScript = (details) => {
        if (details.files?.includes('lib/scene-host.js') && !globalThis.__gzSceneHostFailures) {
          globalThis.__gzSceneHostFailures++;
          return Promise.reject(new Error('simulated transient scene-host injection failure'));
        }
        return inject(details);
      };
    });
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${id}/options.html`);
    const store = (bg, lookX) => opts.evaluate(async ({ defaults, bg, lookX, origin }) => {
      await chrome.storage.sync.clear();
      const keys = Object.keys(await chrome.storage.local.get(null)).filter((k) => !['ultra', 'canvas', 'moodle'].includes(k));
      await chrome.storage.local.remove(keys);
      await chrome.storage.sync.set({ ...defaults, bg, lookX }); await chrome.storage.local.set({ ultra: [origin] });
    }, { origin, defaults: D.GZ_DEFAULTS, bg: { ...D.GZ_DEFAULTS.bg, ...bg }, lookX }).then(async () => {
      await worker.evaluate(() => queue);
      await require('./check-env.js').ultraReady(opts);
    });
    const look = async (x) => P.pack({ x });
    const open = async () => { const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message)); await page.goto(`${origin}/ultra/stream`); await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-font')); return page; };
    const scene = (page) => page.evaluate(() => { const c = document.getElementById('gz-scene'); return c && { w: c.width, h: c.height, bg: document.documentElement.getAttribute('data-gz-bg'), inside: c.parentNode.tagName }; });
    const waitScene = (page, want = true) => page.waitForFunction((w) => !!document.getElementById('gz-scene') === w, want, { timeout: 12000 }).then(() => true, () => false);
    const shot = async (page, name) => { if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `${name}.png`) }); } };
    // What Glaze's own (isolated) world of the page holds: the page's script can't see it, so a CDP context of the extension's.
    const isolated = async (page, expression) => {
      const cdp = await context.newCDPSession(page), worlds = [];
      cdp.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
      await cdp.send('Runtime.enable');
      const world = worlds.find((w) => w.origin === `chrome-extension://${id}`);
      const r = world && await cdp.send('Runtime.evaluate', { contextId: world.id, expression, returnByValue: true });
      await cdp.detach();
      return r?.result?.value;
    };
    const held = (page) => isolated(page, "JSON.stringify({ checker: typeof GZ_GLSL, src: GZ_CTX.parts()?.bg?.shader?.src?.slice(0, 11) ?? null, layers: GZ_CTX.parts()?.bg?.layers?.length ?? null })").then((v) => v && JSON.parse(v));

    // A built-in scene: unchanged.
    await store({ kind: 'scene', scene: 'pumpkins' }, '');
    let page = await open();
    check('a built-in scene still draws on the page, without the shader checker', await waitScene(page), 'no #gz-scene');
    check('a transient scene-module request failure recovers without a page reload', failedModules === 1 && !!(await scene(page)), `failed requests: ${failedModules}`);
    check('a cached dependency failure is retried under a fresh module URL', failedDependencies === 1 && !!(await scene(page)), `failed dependency requests: ${failedDependencies}`);
    check('a transient scene-host injection failure recovers through the broker', await worker.evaluate(() => globalThis.__gzSceneHostFailures) === 1 && !!(await scene(page)), 'the helper failed once before the renderer started');
    const builtin = await scene(page);
    check('  at its own 0.6 scale, and the checker was never loaded for it', builtin?.w === Math.round(1280 * 0.6) && (await held(page))?.checker === 'undefined', JSON.stringify([builtin, await held(page)]));
    await page.close();

    // A shader Look, read from lookX after first paint.
    await store({ kind: 'shader' }, await look({ bg: { shader: { src: AURORA } } }));
    page = await open();
    check('a shader Look: the canvas appears once the parts are read', await waitScene(page), 'no #gz-scene');
    await page.waitForFunction(() => document.getElementById('gz-scene')?.width === Math.round(innerWidth * 0.6), null, { timeout: 8000 }).catch(() => {});
    const shader = await scene(page);
    const got = await held(page);
    check('  it was probed, then drawn at 0.6, the page is on the shader kind (its gradient under it), and Glaze holds the parts and the checker', shader?.w === Math.round(1280 * 0.6) && shader.bg === 'shader' && got.checker === 'object' && got.src === '// Aurora r', JSON.stringify([shader, got]));
    await sleep(500); await shot(page, 'page-shader');
    // The Look changes under the page: a different shader replaces it; solid takes it away.
    await store({ kind: 'shader' }, await look({ bg: { shader: { src: AURORA.replace('Aurora ribbons', 'Aurora ribbons, edited') } } }));
    await sleep(800);
    check('  an edited shader keeps one canvas', (await page.locator('#gz-scene').count()) === 1, '');
    await store({ kind: 'solid' }, '');
    check('  back to solid, the canvas goes', await waitScene(page, false), 'still there');
    await page.close();

    // Layers.
    await store({ kind: 'layers' }, await look({ bg: { layers: [{ k: 'gradient', c: ['accent', 'accent-hi'], angle: 160 }, { k: 'scene', name: 'borealis', blend: 'add' }, { k: 'particles', shape: 'snow', count: 120, size: 14, drift: 190, c: ['#ffffff'] }] } }));
    page = await open();
    check('a layers Look: the canvas appears', await waitScene(page), 'no #gz-scene');
    await sleep(800);
    const layers = await scene(page);
    const gotLayers = await held(page);
    check('  drawn at the sharpest layer\'s scale (particles: 0.5), with no checker loaded for it', layers?.w === Math.round(1280 * 0.5) && layers.bg === 'layers' && gotLayers.layers === 3 && gotLayers.checker === 'undefined', JSON.stringify([layers, gotLayers]));
    await shot(page, 'page-layers');
    await page.close();

    // A shader the checker would refuse, put in storage past the sanitizer: the page's scene refuses it and the gradient stays.
    await store({ kind: 'shader' }, await look({ bg: { shader: { src: `#extension GL_OES_standard_derivatives : enable\n${AURORA}` } } }));
    page = await open();
    await sleep(2500);
    const refused = await held(page);
    check('a shader the checker refuses is never drawn: Glaze read it (the page\'s cleaner had no checker yet) and loaded the checker, which refused it; no canvas, the gradient stays, nothing throws',
      !(await scene(page)) && (await page.evaluate(() => document.documentElement.getAttribute('data-gz-bg'))) === 'shader' && refused.checker === 'object' && refused.src === '#extension ', JSON.stringify([await scene(page), refused]));
    await store({ kind: 'shader' }, await look({ bg: { shader: { src: AURORA } } }));
    check('  and the next, good shader does draw (the failure was remembered for that one only)', await waitScene(page), 'no #gz-scene');
    await page.close();

    // The editor's preview frames: a canvas in the frame, and the parent told what the guard did.
    for (const site of ['ultra', 'canvas']) {
      const seen = await opts.evaluate(async ({ site, settings, parts }) => {
        const messages = [];
        addEventListener('message', (e) => { if (e.data?.gzSceneStep || e.data?.gzSceneFailed) messages.push(e.data); });
        const frame = Object.assign(document.createElement('iframe'), { src: `preview.html?site=${site}`, width: 1000, height: 700 });
        document.body.append(frame);
        await new Promise((r) => addEventListener('message', function ready(e) { if (e.data?.gzPreviewReady) { removeEventListener('message', ready); r(); } }));
        frame.contentWindow.postMessage({ gzPreview: settings, gzPreviewParts: parts }, location.origin);
        for (let i = 0; i < 60 && !frame.contentDocument.getElementById('gz-scene'); i++) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 1200));
        const c = frame.contentDocument.getElementById('gz-scene');
        const got = { canvas: !!c, width: c?.width, kind: frame.contentDocument.documentElement.getAttribute('data-gz-bg'), messages: messages.slice(0, 3) };
        frame.remove();
        return got;
      }, { site, settings: { ...D.GZ_DEFAULTS, bg: { ...D.GZ_DEFAULTS.bg, kind: 'shader' } }, parts: { x: { bg: { shader: { src: AURORA } } } } });
      check(`the ${site} preview frame draws a shader Look and its parent hears the probe step`, seen.canvas && seen.kind === 'shader' && seen.messages.some((m) => m.gzSceneStep?.level === 0 && m.gzSceneStep.why === 'probe'), JSON.stringify(seen));
    }
    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
    assert.deepEqual(blocked.filter((u) => !/ultra-cdn\.invalid/.test(u)), [], 'no request left the fixture');
  } finally {
    await context?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  const bad = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ chrome: process.env.CHROME || "Playwright's bundled Chromium", passed: results.length - bad.length, failed: bad.length, failures: bad }, null, 1));
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
  process.exitCode = bad.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
