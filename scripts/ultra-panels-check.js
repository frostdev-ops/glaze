// The site's own panels under Glaze navigation, headless, in the editor's previews (Ultra's, Canvas's and Moodle's real content
// scripts and bar on their mock pages). A panel the site opens at the window's top or edge (Ultra's side panels: Notification
// Settings, an item's details; a MUI drawer; Canvas's trays; Moodle's drawers) keeps its title, Close and actions in reach
// with the bar at the top and as a rail, and the pet and its Return home pill step aside while one is open.
// The panels are built here with the markup and the position, z-index and size Ultra, Canvas and Moodle give them.
//   NODE_PATH=/path/to/node_modules nice -n 15 node scripts/ultra-panels-check.js [screenshots directory]
// Hold $GLAZE_LOCK (default glaze-heavy.lock in the OS temp directory) while it runs.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const G = require('../defaults.js');
require('../lib/coursetabs.js'); require('../lib/nav.js'); // their settings, so GZ_SANITIZE keeps them

const src = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ultra-panels-'));
const chromeLaunch = require('./check-env.js').chromeLaunch();
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
let checks = 0, fails = 0;
const ok = (value, label) => { console.log(`${value ? 'ok  ' : 'FAIL'} ${label}`); if (value) checks++; else fails++; };

// Ultra's side panel ("peek"): absolute at the window's top and one edge, z-index 1011 (measured in Ultra), a Close button
// straddling its inner edge, a header and a footer with Cancel and Save. Its .panel-wrap fills the panel (the Ultra preview's
// mock page gives that class the window's height).
const PANEL = (side) => `<div class="bb-offcanvas-container" id="check-layer" style="position:fixed;inset:0;z-index:1010">
  <div class="bb-offcanvas-overlay" style="position:absolute;inset:0;background:rgb(0 0 0 / .3)"></div>
  <div class="bb-offcanvas-panel bb-offcanvas-${side} peek active" role="dialog" aria-labelledby="check-title" style="position:absolute;top:0;bottom:0;${side}:0;width:520px;z-index:1011;background:#fff;display:flex">
    <div class="bb-offcanvas-panel-wrap" style="position:relative;flex:1;display:flex;flex-direction:column">
      <div class="bb-close-offset" style="position:absolute;z-index:2;top:10px;${side === 'right' ? 'left' : 'right'}:-20px"><button class="bb-close" id="check-close" aria-label="Close" type="button" style="width:40px;height:40px">×</button></div>
      <div class="panel-wrap" style="flex:1;min-height:0;display:flex;flex-direction:column">
        <header class="panel-header" style="padding:24px 30px"><h1 id="check-title" style="margin:0;font-size:24px">Notification Settings</h1></header>
        <div class="panel-content" style="flex:1"></div>
        <footer class="panel-footer" style="padding:16px 30px;display:flex;gap:8px;justify-content:flex-end"><button type="button">Cancel</button><button type="button" id="check-save">Save</button></footer>
      </div></div></div></div>`;
// A MUI temporary drawer: fixed at the top, the window's height, z-index 1200.
const DRAWER = (side) => `<div class="MuiModal-root MuiDrawer-root MuiDrawer-modal" id="check-layer" role="presentation" style="position:fixed;inset:0;z-index:1200">
  <div class="MuiBackdrop-root" style="position:fixed;inset:0;background:rgb(0 0 0 / .3)"></div>
  <div class="MuiPaper-root MuiDrawer-paper MuiDrawer-paperAnchor${side === 'right' ? 'Right' : 'Left'}" role="dialog" style="position:fixed;top:0;${side}:0;height:100%;width:420px;background:#fff;display:flex;flex-direction:column;z-index:1200">
    <header style="display:flex;justify-content:space-between;padding:16px"><h2 id="check-title" style="margin:0">Messages</h2><button id="check-close" aria-label="Close" type="button" style="width:40px;height:40px">×</button></header>
    <div style="flex:1"></div><footer style="padding:16px"><button type="button" id="check-save">Send</button></footer></div></div>`;
// Canvas's tray (#nav-tray-portal, InstUI's Tray at the window's start edge) and Moodle's block drawer.
const TRAY = `<div id="check-layer" style="position:fixed;top:0;bottom:0;left:0;width:448px;background:#fff;z-index:9999" role="dialog"><div class="navigation-tray-container"><button id="check-close" aria-label="Close" type="button" style="position:absolute;top:8px;right:8px;width:40px;height:40px">×</button><div class="tray-with-space-for-global-nav"><h2 id="check-title" style="margin:0;padding:24px">Courses</h2></div><button type="button" id="check-save" style="position:absolute;bottom:16px;left:100px">All courses</button></div></div>`;
const MOODLE_DRAWER = `<div id="theme_boost-drawers-blocks" class="drawer drawer-right show d-print-none" role="dialog" style="position:fixed;top:60px;right:0;width:315px;height:calc(100vh - 60px);background:#fff;z-index:1020"><div class="drawerheader" style="display:flex;justify-content:space-between;padding:8px"><h2 id="check-title" style="margin:0">Blocks</h2><button id="check-close" class="drawertoggle" aria-label="Close block drawer" type="button" style="width:40px;height:40px">×</button></div><button type="button" id="check-save" style="position:absolute;bottom:16px;left:16px">Add a block</button></div>`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ultra-panels-run-')));
  let ctx;
  const errors = [];
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), { ...chromeLaunch, headless: true, viewport: { width: 1280, height: 860 }, locale: 'en-US', reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${src}`, `--load-extension=${src}`, '--host-resolver-rules=MAP * ~NOTFOUND'] });
    require('./check-env.js').noFirstRun(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    const bar = () => page.evaluate(() => { const r = document.getElementById('gz-navbar')?.shadowRoot; return !!r && !r.host.hidden; });
    const until = async (read, label) => { const end = Date.now() + 15000; while (Date.now() < end) { if (await read().catch(() => false)) return; await page.waitForTimeout(80); } throw new Error(label); };
    const send = async (navbar) => { await page.evaluate((s) => window.postMessage({ gzPreview: s }, location.origin), G.GZ_SANITIZE({ navbar: { on: true, ...navbar }, enhance: { dashboard: true }, motion: { level: 'off' } })); await page.waitForTimeout(400); };
    // Ultra's panels are in its #site-wrap; MUI's modals in a portal at the end of <body>.
    const open = async (html) => {
      await page.evaluate((h) => { document.getElementById('check-layer')?.remove(); (!h.includes('MuiModal-root') && document.getElementById('site-wrap') || document.body).insertAdjacentHTML('beforeend', h); }, html);
      await page.waitForTimeout(1300); // the pet looks again at most once a second at rest
    };
    // What takes the pointer at the middle of each of the panel's controls: the panel's own, or what covers it.
    const reach = () => page.evaluate(() => {
      const layer = document.getElementById('check-layer');
      const at = (id) => { const e = document.getElementById(id), r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
        return { id, x: Math.round(x), y: Math.round(y), inView: y > 0 && y < innerHeight && x > 0 && x < innerWidth, ok: !!hit && (e.contains(hit) || (layer.contains(hit) && id === 'check-title')), by: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}${typeof hit.className === 'string' && hit.className ? `.${hit.className.split(' ')[0]}` : ''}` : 'nothing' }; };
      return ['check-close', 'check-title', 'check-save'].map(at);
    });
    const verdict = async (label, shot) => {
      const r = await reach();
      for (const p of r) ok(p.ok && p.inView, `${label}: ${p.id} in reach at ${p.x},${p.y}${p.ok ? '' : ` (covered by ${p.by})`}${p.inView ? '' : ' (out of the window)'}`);
      await page.screenshot({ path: path.join(out, `${shot}.png`) });
    };

    // ---- Ultra ----
    await page.goto(`chrome-extension://${extensionId(src)}/preview.html?site=ultra`);
    await page.waitForFunction(() => globalThis.GZ_CTX);
    await send({ place: 'top' });
    await until(bar, 'Ultra: the bar shows');
    ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-navbar-top').trim()) === '80px', 'Ultra: the top bar keeps 80px');
    // The pet, out wandering, with its Return home pill (features/petworld.js, as features/pet.js mounts it).
    for (const f of ['lib/petbrain.js', 'lib/petphysics.js', 'features/petworld.js']) await page.addScriptTag({ url: `chrome-extension://${extensionId(src)}/${f}` });
    const pet = await page.evaluate(() => {
      globalThis.GZ_WIDGETS_UI ||= { avatar: () => ({ play() {}, sleep() {}, wake() {}, stop() {} }) };
      const stage = document.createElement('div'); stage.style.cssText = 'position:fixed;left:300px;top:300px;width:320px;height:240px'; document.body.append(stage);
      GZ_PET_WORLD.mount(stage, { key: 'pet:check', data: GZ_PET.view({ wander: true, earned: { 'work:assignment:1': 20 } }), t: (k) => k, save: async () => ({ ok: true }) });
      return { world: !!document.querySelector('html > .gz-game-world'), home: !!document.querySelector('.gz-game-home:not([hidden])') };
    });
    ok(pet.world && pet.home, `Ultra: the pet wanders, with its Return home pill (${JSON.stringify(pet)})`);
    await page.evaluate(() => { const h = document.querySelector('.gz-game-home'); h.style.setProperty('right', '40px'); h.style.setProperty('bottom', '24px'); });
    await open(PANEL('right'));
    await verdict('Ultra top bar, a right side panel', 'ultra-top-panel-right');
    const shown = await page.evaluate(() => [...document.querySelectorAll('html > .gz-game-world, .gz-game-home')].filter((e) => getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none').map((e) => e.className));
    ok(!shown.length, `Ultra: the pet and Return home step aside while a panel is open${shown.length ? ` (${shown.join(', ')} still shown)` : ''}`);
    const home = await page.evaluate(() => { const r = document.querySelector('.gz-game-home').getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !hit?.closest('.gz-game-home'); });
    ok(home, 'Ultra: Return home takes no click over the panel');
    await page.evaluate(() => document.getElementById('check-layer').remove());
    await page.waitForTimeout(1300);
    const back = await page.evaluate(() => getComputedStyle(document.querySelector('.gz-game-home')).visibility === 'visible' && getComputedStyle(document.querySelector('html > .gz-game-world')).visibility === 'visible');
    ok(back, 'Ultra: the pet and Return home come back once the panel closes');
    await open(DRAWER('right'));
    await verdict('Ultra top bar, a MUI drawer', 'ultra-top-drawer-right');
    await send({ place: 'rail', rail: 'open' });
    await open(PANEL('left'));
    await verdict('Ultra rail, a left side panel', 'ultra-rail-panel-left');
    await open(DRAWER('left'));
    await verdict('Ultra rail, a left MUI drawer', 'ultra-rail-drawer-left');
    await open(PANEL('right'));
    await verdict('Ultra rail, a right side panel', 'ultra-rail-panel-right');

    // ---- Canvas: its tray portal sits over the bar (canvas.css) ----
    await page.goto(`chrome-extension://${extensionId(src)}/preview.html?site=canvas`);
    await page.waitForFunction(() => document.documentElement.dataset.previewReady === 'true');
    await until(bar, 'Canvas: the bar shows');
    await send({ place: 'top' });
    await page.evaluate((h) => { let p = document.getElementById('nav-tray-portal'); if (!p) { p = document.createElement('div'); p.id = 'nav-tray-portal'; p.style.cssText = 'position:relative;z-index:99'; document.body.append(p); } p.innerHTML = h; }, TRAY);
    await page.waitForTimeout(300);
    await verdict('Canvas top bar, a tray', 'canvas-top-tray');
    await page.evaluate(() => document.getElementById('nav-tray-portal').replaceChildren());

    // ---- Moodle: its drawers start below the bar (moodle.css) ----
    await page.goto(`chrome-extension://${extensionId(src)}/preview.html?site=moodle`);
    await until(bar, 'Moodle: the bar shows');
    await send({ place: 'top' });
    await open(MOODLE_DRAWER);
    await verdict('Moodle top bar, the block drawer', 'moodle-top-drawer');
    ok(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  } catch (e) { ok(false, e.message); } finally {
    await ctx?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${fails ? 'FAILED' : 'passed'}: ${checks} checks${fails ? `, ${fails} failed` : ''}. Screenshots: ${out}`);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
