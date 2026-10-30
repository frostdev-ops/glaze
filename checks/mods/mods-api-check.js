// The Glaze API v1 on a page, headless: the real unpacked extension on a local Ultra-shaped page (loopback HTTPS only,
// macOS sandbox-exec denies everything else), under a strict and a permissive page policy. Fixture mods: a data mod (a
// floating tile drawn from its Worker's component tree, with a picture and a canvas, a card decorator, a palette command,
// the completion effect replaced), a frame-UI mod with a rail widget, and a nav replacement turned on and off. Then motion
// off, a mod turned off and a mod blocklisted while they run. NODE_PATH must name an existing Playwright installation.
//   NODE_PATH=/path/to/node_modules node scripts/mods-api-check.js
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https');
const { execFileSync } = require('node:child_process');
const { createHash, X509Certificate } = require('node:crypto');
// A staged copy holding the loopback Ultra's host (https on 127.0.0.1), as a student's grant for their school would.
const ext = require('./check-env.js').staged(path.resolve(process.env.EXT || path.join(__dirname, '..')), ['https://127.0.0.1/*']);
const chrome = require('./check-env.js').chromePath() || chromium.executablePath();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timeout: ${label}`); await delay(100); }
};
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

const ID = { data: 'abcdefghijklmnop', rail: 'qrstuvwxyz234567', nav: 'aaaaaaaaaaaaaaab' };
const b64 = (s) => Buffer.from(s).toString('base64');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const record = (id, manifest, files, grants = {}) => ({ id, enabled: true, hash: `h-${id}`, key: 'fixture-key', version: '1.0.0', grants, dev: false, manifest: { glaze: 1, name: manifest.name, ...manifest }, files });
// Runs as mod code in the data mod's Worker, never as extension code.
const DATA = `
glaze.ui.render('tile:garden', { type: 'stack', label: 'Garden', children: [
  { type: 'text', text: 'Garden', size: 'l', weight: 'bold' },
  { type: 'row', children: [{ type: 'ring', value: 3, max: 4, label: 'Watered' }, { type: 'number', value: 3.5, label: 'GPA', color: 'accent' }] },
  { type: 'button', id: 'water', label: 'Water' },
  { type: 'input', id: 'plant', kind: 'select', label: 'Plant', options: ['Fern', 'Cactus'] },
  { type: 'image', src: 'leaf.png', alt: 'Leaf', w: 16, h: 16 },
  { type: 'canvas', h: 60, label: 'Garden canvas' },
] }).then((r) => glaze.storage.set('rendered', true), (e) => glaze.storage.set('rendered', e.message));
glaze.ui.render('tile:nope', { type: 'text', text: 'x' }).catch((e) => glaze.storage.set('refusedSlot', e.message));
glaze.ui.render('tile:garden', { type: 'html', html: '<img src=x onerror=alert(1)>' }).catch((e) => glaze.storage.set('refusedTree', e.message));
glaze.ui.canvas('tile:garden').then((c) => { const g = c.getContext('2d'); const draw = () => { g.fillStyle = '#ff0000'; g.fillRect(0, 0, c.width, c.height); requestAnimationFrame(draw); }; draw(); });
glaze.on('ui', (d) => glaze.storage.set('ui', d));
glaze.on('canvas.pause', (d) => glaze.storage.set('paused', d.paused));
glaze.on('page', (d) => glaze.storage.set('page', d));
glaze.on('effect', (d) => { glaze.storage.set('effect', d.moment); glaze.effects.play('confetti', { count: 20 }); });
glaze.cards.decorate((courses) => Object.fromEntries(courses.map((c) => [c.id, { badge: 'A+', accent: 'ok', note: 'Watered' }])));
glaze.palette.commands([{ id: 'water', title: 'Water the garden', run: () => glaze.storage.set('palette', true) }]);
glaze.settings().then((s) => glaze.storage.set('settings', s));
`;
const MODS = () => [
  record(ID.data, { name: 'Garden', permissions: [{ id: 'courses', why: 'Badges on your course cards.' }], hooks: 'hooks.js', replaces: ['effect:complete'],
    ui: { tiles: [{ id: 'garden', name: 'Garden', sizes: ['m'] }] }, settings: [{ id: 'plant', type: 'choice', label: 'Plant', options: ['Fern', 'Cactus'] }] },
  { 'hooks.js': b64(DATA), 'leaf.png': PNG }, { courses: true }),
  record(ID.rail, { name: 'Clock', permissions: [], hooks: 'hooks.js', ui: { rail: [{ id: 'clock', name: 'Clock', file: 'rail.html' }] } },
    { 'hooks.js': b64('void 0'), 'rail.html': b64('<!doctype html><body><p id=t>rail</p><script src="rail.js"></script>'), 'rail.js': b64("glaze.storage.set('railRan', true);") }),
  record(ID.nav, { name: 'Nav', permissions: [{ id: 'nav.items', why: 'An item of its own.' }], hooks: 'hooks.js', replaces: ['nav', 'tile:timer'], ui: { nav: {}, tiles: [{ id: 'timer', name: 'Mod timer', sizes: ['s'] }] } },
    { 'hooks.js': b64("glaze.ui.render('nav', { type: 'stack', label: 'Mod nav', children: [{ type: 'button', id: 'home', label: 'Mod home' }] }); glaze.ui.render('tile:timer', { type: 'text', text: 'Replacement timer content' });"
      + "glaze.nav.add({ id: 'hose', label: 'Hose', icon: 'star', action: true }).then(() => glaze.storage.set('added', true), (e) => glaze.storage.set('added', e.message));"
      + "glaze.nav.add({ id: 'away', label: 'Away', href: 'https://elsewhere.test/' }).catch((e) => glaze.storage.set('away', e.message));"
      + "glaze.on('nav.action', (d) => glaze.storage.set('action', d.id));") }, { 'nav.items': true }),
];
const SHELL = `<!doctype html><html lang="en"><head><base href="/ultra/"><meta charset="utf-8"><title>Local LMS</title><style>
body{margin:0;font:14px system-ui}.MuiDrawer-paper{position:fixed;inset:0 auto 0 0;width:200px;background:#262626}.MuiDrawer-paper a{display:block;padding:10px 24px;color:#fff}
main{margin-left:200px;padding:20px}article{display:inline-block;width:240px;height:160px;border:1px solid #ccc;margin:8px;vertical-align:top}</style></head><body><div id="site-wrap">
<div class="MuiPaper-root MuiDrawer-paper"><nav class="makeStylesnavigation-1-2-3"><ul style="list-style:none;margin:0;padding:24px 0">
<li><a class="MuiButtonBase-root MuiListItemButton-root" href="/ultra/course">Courses</a></li><li><a class="MuiButtonBase-root MuiListItemButton-root" href="/ultra/calendar">Calendar</a></li></ul></nav></div>
<main id="main-content"><h1 id="main-heading">Courses</h1>
<article id="course-list-course-_1_1" data-course-id="_1_1" class="course-element-card"><h4 class="course-title">Biology</h4></article>
<article id="course-list-course-_2_1" data-course-id="_2_1" class="course-element-card"><h4 class="course-title">History</h4></article>
</main></div></body></html>`;

(async () => {
  fs.mkdirSync(path.join(ext, '.sandbox-check'), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(ext, '.sandbox-check', 'api-'));
  let context, lms, deadline;
  try {
    const key = path.join(tmp, 'k'), cert = path.join(tmp, 'c');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    const tls = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
    const spki = createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    lms = https.createServer(tls, (req, res) => {
      if (req.url.includes('/api/')) { res.setHeader('content-type', 'application/json'); res.end('{"results":[]}'); return; }
      if (req.url.includes('strict')) res.setHeader('content-security-policy', "default-src 'self'; script-src 'none'; frame-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'");
      res.setHeader('content-type', 'text/html');
      res.end(SHELL);
    });
    await new Promise((r) => lms.listen(0, '127.0.0.1', r));
    const origin = `https://127.0.0.1:${lms.address().port}`;
    const wrapper = path.join(tmp, 'chrome'), q = (v) => `'${v.replaceAll("'", "'\\''")}'`;
    fs.writeFileSync(path.join(tmp, 'net.sb'), '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))');
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${q(path.join(tmp, 'net.sb'))} ${q(chrome)} "$@"\n`, { mode: 0o700 });
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { executablePath: wrapper, headless: true, viewport: { width: 1280, height: 800 }, args: [
      `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--ignore-certificate-errors-spki-list=${spki}`, '--disable-background-networking', '--disable-component-update', '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    deadline = setTimeout(() => context?.close().catch(() => {}), 240000);
    const logs = [];
    context.on('page', (p) => { p.on('pageerror', (e) => logs.push(`pageerror ${e.message}`)); p.on('crash', () => logs.push('CRASH')); });
    context.on('console', (m) => { if (logs.length < 60) logs.push(`console ${m.type()}: ${m.text().slice(0, 300)}`); });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    // In Glaze's own world on the page (content scripts' globals).
    // The function's source goes into the expression the worker evaluates (through the debugger, so no eval in a page).
    const inPage = (page, func, arg = null) => sw.evaluate(`(async () => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url === ${JSON.stringify(page.url())});
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ${String(func)}, args: [${JSON.stringify(arg)}] }).catch((e) => [{ result: String(e) }]);
      return r.result;
    })()`);
    const stats = (page) => inPage(page, () => globalThis.GZ_MODS?.stats() || null);
    const stored = (id, k) => sw.evaluate(async ([id, k]) => (await chrome.storage.local.get(`modData:${id}`))[`modData:${id}`]?.[k], [id, k]);
    const set = (area, o) => sw.evaluate(([area, o]) => chrome.storage[area].set(o), [area, o]);
    // Everything in the page, through closed shadow roots (the DOM domain sees them).
    const tree = async (page) => {
      const cdp = await context.newCDPSession(page);
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const all = [];
      const walk = (n, shadow) => { all.push({ ...n, shadow }); for (const c of n.children || []) walk(c, shadow); for (const s of n.shadowRoots || []) walk(s, s.shadowRootType); if (n.contentDocument) walk(n.contentDocument, shadow); };
      walk(root, null);
      const attr = (n, k) => { const a = n.attributes || []; const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
      const text = (n) => (n.nodeType === 3 ? n.nodeValue : (n.children || []).map(text).join(''));
      const box = async (n) => { const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: n.backendNodeId }); const c = model.content; return { x: (c[0] + c[2]) / 2, y: (c[1] + c[5]) / 2, w: model.width, h: model.height }; };
      return { all, attr, text, box, cdp };
    };
    // One pixel of the page, decoded on a blank page (no page policy there).
    const pixel = async (page, x, y) => {
      const shot = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 2, height: 2 } });
      const blank = await context.newPage();
      const px = await blank.evaluate(async (b) => { const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b}`)).blob()); const c = new OffscreenCanvas(2, 2); const g = c.getContext('2d'); g.drawImage(bm, 0, 0); return [...g.getImageData(0, 0, 1, 1).data]; }, shot.toString('base64'));
      await blank.close();
      return px;
    };
    const install = (over = {}) => sw.evaluate(async ({ origin, mods, ID, over }) => {
      await chrome.storage.local.clear();
      await chrome.storage.sync.set({ enabled: true, enhance: { sidebar: false }, motion: { level: 'subtle' } });
      await chrome.storage.local.set({ ultra: [origin], mods: mods.map((m) => m.id), modOrder: [ID.data, ID.rail, ID.nav], ...Object.fromEntries(mods.map((m) => [`mod:${m.id}`, m])),
        [`modReplace:${ID.data}`]: { 'effect:complete': true }, [`modSettings:${ID.data}`]: { plant: 'Cactus' },
        widgetLayout: GZ_WIDGETS.layout({ tiles: [{ id: `m${ID.data.slice(0, 14)}0`, size: 'm' }], boards: { pages: [{ id: `m${ID.data.slice(0, 14)}0`, on: true, size: 'm' }] } }, { [`m${ID.data.slice(0, 14)}0`]: { size: 'm' } }), ...over });
    }, { origin, mods: MODS(), ID, over }).then(() => delay(300)).then(() => until(() => sw.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((l) => l.some((x) => x.id.startsWith('ultra:')) || chrome.runtime.getManifest().content_scripts.some((x) => x.js.includes('content-ultra.js') && x.matches.includes('https://*/ultra/*')))), 'the loopback Ultra registered'));

    for (const mode of ['strict', 'permissive']) {
      console.log(`-- ${mode} page policy`);
      await install();
      const page = await context.newPage();
      await page.goto(`${origin}/ultra/course?${mode}`);
      let last;
      const s0 = await until(async () => { const s = last = await stats(page); return s?.runtime === true && Object.keys(s.ready).length === 3 && s; }, 'three mods ready').catch(async (e) => { console.log('stats', JSON.stringify(last), JSON.stringify(await inPage(page, () => ({ m: typeof GZ_MODS, c: typeof GZ_CTX, attrs: [...document.documentElement.attributes].map((a) => a.name).join(' ') })).catch(String)), JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(['modRuntime', 'modStops'])))); throw e; });
      ok(true, `three mods started (ready in ${Math.max(...Object.values(s0.ready))} ms)`);
      ok(await until(() => stored(ID.data, 'rendered'), 'tree rendered') === true, 'a data mod renders its tile from its Worker');
      ok(await until(() => stored(ID.data, 'refusedSlot'), 'slot refused') === 'slot', 'a slot the manifest lacks is refused');
      ok(await until(() => stored(ID.data, 'refusedTree'), 'tree refused') === 'tree', 'markup in a tree is refused');
      eq(await until(() => stored(ID.data, 'settings'), 'settings'), { plant: 'Cactus' }, 'glaze.settings() gives the student\'s value');
      const where = await until(() => stored(ID.data, 'page'), 'page event');
      ok(where.site === 'ultra' && where.kind === 'courses', `on('page') ${JSON.stringify(where)}`);
      // The tile, drawn in a closed root: its button, its picture and its canvas.
      let t = await until(async () => { const x = await tree(page); return x.all.some((n) => n.nodeName === 'BUTTON' && x.text(n) === 'Water') && x; }, 'tile button').catch(async (e) => {
        console.error('tile diagnostics', JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(['widgetLayout', 'freshDefaults']))), JSON.stringify(await inPage(page, () => ({ widgets: !!globalThis.GZ_WIDGET_UI, enhance: GZ_CTX.settings().enhance }))));
        throw e;
      });
      const button = t.all.find((n) => n.nodeName === 'BUTTON' && t.text(n) === 'Water');
      ok(button.shadow === 'closed', 'the tree is in a closed shadow root');
      ok(t.all.some((n) => n.nodeName === 'CANVAS' && t.attr(n, 'aria-label') === 'Leaf' && t.attr(n, 'role') === 'img'), 'its picture is drawn on a canvas, labelled');
      ok(t.all.some((n) => t.attr(n, 'role') === 'progressbar' && t.attr(n, 'aria-valuenow') === '3'), 'the ring is a progressbar for screen readers');
      const at = await t.box(button);
      await page.mouse.click(at.x, at.y);
      eq(await until(() => stored(ID.data, 'ui'), 'ui event'), { slot: 'tile:garden', id: 'water', kind: 'click' }, 'a button press goes back to the mod');
      const canvas = t.all.find((n) => n.nodeName === 'CANVAS' && t.attr(n, 'aria-label') === 'Garden canvas');
      const c = await t.box(canvas);
      ok(c.w > 50 && c.h === 60, `the canvas follows the slot (${c.w}x${c.h})`);
      const red = await until(async () => { const p = await pixel(page, c.x, c.y); return p[0] > 200 && p[1] < 60 && p; }, 'the Worker\'s drawing on the page', 8000).catch(() => null);
      ok(!!red, `what the Worker draws shows in the slot ${JSON.stringify(red)}`);
      ok((await stats(page)).frames > 0, 'pictures arrive from the Worker');
      // The frame UI's rail widget: its own host in the rail.
      ok(await until(() => stored(ID.rail, 'railRan'), 'rail frame ran') === true, 'a frame-UI mod runs in its rail widget');
      t = await tree(page);
      ok(t.all.some((n) => n.nodeName === 'IFRAME' && t.attr(n, 'title') === 'Clock' && n.shadow === 'closed'), 'its host is in the rail, in a closed root');
      ok(await page.evaluate(() => document.querySelectorAll('iframe').length === 0 && frames.length === 0), 'the page sees no frame');
      // Cards, palette, effect.
      t = await until(async () => { const x = await tree(page); return x.all.filter((n) => n.nodeName === 'B' && x.text(n) === 'A+').length === 2 && x; }, 'card badges');
      ok(true, 'both course cards carry the mod\'s badge');
      eq(await inPage(page, () => GZ_MODS.cmds().map((x) => x.label)), ['Water the garden'], 'the palette lists the mod\'s command');
      await inPage(page, () => GZ_MODS.cmds()[0].run());
      ok(await until(() => stored(ID.data, 'palette'), 'palette ran') === true, 'the command runs in the mod');
      await inPage(page, () => document.dispatchEvent(new CustomEvent('glaze:moment', { detail: { name: 'complete', x: 300, y: 300 } })));
      ok(await until(() => stored(ID.data, 'effect'), 'effect replaced') === 'complete', 'the replaced moment goes to the mod');
      ok(await until(() => page.evaluate(() => !!document.getElementById('gz-fx')), 'effect canvas', 4000).catch(() => false), 'its effect plays (glaze.effects.play)');
      // Nav replacement: on, then off.
      // nav.items: the mod's own item in Glaze's bar, marked as its own; a link to another site refused; a real click told to it.
      if (await inPage(page, () => !!globalThis.GZ_NAVBAR_UI?.live())) {
        ok(await until(() => stored(ID.nav, 'added'), 'nav item added') === true, 'glaze.nav.add puts an item in the bar');
        eq(await until(() => stored(ID.nav, 'away'), 'away refused'), 'args', 'an item linking to another site is refused');
        const item = page.locator('#gz-navbar [data-id="mod:aaaaaaaaaaaaaaab.hose"]').first();
        await until(() => item.isVisible(), 'mod item shown');
        eq(await item.getAttribute('aria-description'), 'From Nav', 'shown as the mod\'s');
        await item.click();
        eq(await until(() => stored(ID.nav, 'action'), 'nav.action'), 'hose', 'a real click reaches the mod as nav.action');
      }
      // With Glaze's bar drawn, the replacement stands in for the bar; without it, for Ultra's own nav.
      const barLive = await inPage(page, () => !!globalThis.GZ_NAVBAR_UI?.live());
      const native = () => page.evaluate(() => getComputedStyle(document.querySelector('nav[class*="makeStylesnavigation-"]')).display);
      const glazeBar = () => page.evaluate(() => [...(document.getElementById('gz-navbar')?.shadowRoot?.querySelectorAll('.rail, .topbar, .tabs') || [])].some((e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'));
      if (barLive) ok(await glazeBar(), 'Glaze\'s bar shows while the replacement is off');
      else ok(await native() !== 'none', 'the nav is Ultra\'s while the replacement is off');
      const nativeBefore = await native();
      await set('local', { [`modReplace:${ID.nav}`]: { nav: true } });
      await until(async () => (barLive ? !await glazeBar() : await native() === 'none'), 'nav replaced');
      t = await until(async () => { const x = await tree(page); return x.all.some((n) => n.nodeName === 'BUTTON' && x.text(n) === 'Mod home') && x; }, 'mod nav drawn');
      ok(t.all.some((n) => t.attr(n, 'role') === 'navigation' && t.attr(n, 'aria-label') === 'Nav'), 'the mod\'s nav takes its place, as navigation');
      if (barLive) {
        eq(await native(), nativeBefore, 'Ultra\'s own nav stays as Glaze keeps it (hidden under the bar)');
        const box = await page.evaluate(() => { const r = document.querySelector('.gz-mod-nav').getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, room: getComputedStyle(document.documentElement).getPropertyValue('--gz-navbar-left').trim() }; });
        ok(box.w > 0 && box.h > 0 && box.left === 0 && `${box.w}px` === box.room, 'it fills the room the bar keeps for the page', box);
        eq((await stats(page)).navMode, 'bar', 'in Glaze\'s bar\'s place');
      }
      ok((await stats(page)).ready[ID.nav] !== undefined && !(await stats(page)).gone[ID.nav], 'turning it on restarts nothing');
      await set('local', { [`modReplace:${ID.nav}`]: { nav: false } });
      await until(async () => !(await page.evaluate(() => !!document.querySelector('.gz-mod-nav'))) && (barLive ? await glazeBar() : await native() !== 'none'), 'nav back');
      ok(true, barLive ? 'turned off, Glaze\'s bar is back' : 'turned off, Ultra\'s nav is back exactly');
      // An opted-in built-in tile uses the mod's renderer, then restores the native renderer.
      await set('local', { [`modReplace:${ID.nav}`]: { 'tile:timer': true }, widgetLayout: { boards: { pages: [
        { id: `m${ID.data.slice(0, 14)}0`, on: true, size: 'm' }, { id: 'timer', on: true, size: 's' },
      ] } } });
      await until(async () => { const x = await tree(page); return x.all.some((n) => n.nodeName === 'P' && x.text(n) === 'Replacement timer content'); }, 'built-in tile replaced');
      ok(true, 'an opted-in built-in tile renders the mod UI');
      await set('local', { [`modReplace:${ID.nav}`]: {} });
      await until(async () => { const x = await tree(page); return !x.all.some((n) => x.text(n) === 'Replacement timer content') && x.all.some((n) => n.nodeName === 'H3' && x.text(n) === 'Focus timer'); }, 'native tile restored');
      ok(true, 'revoking a tile replacement restores the native widget');
      // Motion off: the Worker's frames pause and no effect plays.
      await set('sync', { motion: { level: 'off' } });
      ok(await until(() => stored(ID.data, 'paused'), 'paused') === true, 'motion off pauses the Worker\'s frames');
      await inPage(page, () => document.getElementById('gz-fx')?.remove());
      await sw.evaluate((id) => chrome.storage.local.remove(`modData:${id}`), ID.data);
      await inPage(page, () => document.dispatchEvent(new CustomEvent('glaze:moment', { detail: { name: 'complete' } })));
      await delay(800);
      ok(!(await stored(ID.data, 'effect')) && !(await page.evaluate(() => !!document.getElementById('gz-fx'))), 'and with motion off the moment plays nothing');
      // A mod turned off, and one blocklisted, while they run.
      await sw.evaluate(async (id) => { const k = `mod:${id}`; const r = (await chrome.storage.local.get(k))[k]; await chrome.storage.local.set({ [k]: { ...r, enabled: false } }); }, ID.data);
      await until(async () => { const x = await tree(page); return !x.all.some((n) => n.nodeName === 'BUTTON' && x.text(n) === 'Water') && !x.all.some((n) => n.nodeName === 'B' && x.text(n) === 'A+'); }, 'data mod gone');
      ok((await inPage(page, () => GZ_MODS.cmds().length)) === 0, 'turned off mid-run: its tile, badges and command go');
      await set('local', { modsBlocklist: { list: { v: 1, seq: 1, mods: [ID.rail] }, sig: 'checked', seq: 1 } });
      await until(async () => { const x = await tree(page); return !x.all.some((n) => n.nodeName === 'IFRAME' && x.attr(n, 'title') === 'Clock'); }, 'rail frame gone');
      ok(true, 'blocklisted mid-run: its rail widget\'s frame is removed');
      ok(!logs.includes('CRASH'), 'no page crashed');
      await page.close();
    }
    console.log(logs.filter((l) => !/favicon/.test(l)).slice(0, 20).join('\n'));
  } catch (e) {
    fails++;
    console.error(e.stack);
  } finally {
    clearTimeout(deadline);
    await context?.close().catch(() => {});
    lms?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`Cleanup: owned browser, listener and profile removed. ${fails ? `${fails} FAILED` : 'all passed'}`);
    process.exitCode = fails ? 1 : 0;
  }
  // The same value, whatever order an object's keys come back in (storage sorts them).
  function eq(a, b, m) {
    const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
    ok(canon(a) === canon(b), `${m}${canon(a) === canon(b) ? '' : ` (got ${canon(a)})`}`);
  }
})();
