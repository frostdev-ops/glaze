// Canvas's board, headless: the real extension on the saved Dashboard DOM under an invented school origin. The page's
// frame CSS and API answers are synthetic; all other requests abort and DNS resolves nowhere. No server or LMS needed.
//   NODE_PATH=/path/to/node_modules nice node scripts/canvas-boards-check.js [screenshots directory]
// CANVAS_LOCAL=1 uses the seeded Canvas at localhost:3000 with a temporary extension/profile instead.
const { chromium } = require('playwright');
const { isDeepStrictEqual } = require('node:util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const G = require('../defaults.js');
const W = require('../lib/widgets.js');
let ext = process.env.EXT || path.join(__dirname, '..');
const local = process.env.CANVAS_LOCAL === '1';
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-canvas-boards-'));
const chromeLaunch = require('./check-env.js').chromeLaunch();
const O = local ? 'http://localhost:3000' : 'https://board.school.instructure.com';
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'test/fixtures', name), 'utf8');
const frame = `<style>
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; }
  #header, #mobile-header, #breadcrumbs, #footer, #right-side, .ic-Layout-watermark { display: none; }
  #wrapper { margin: 0; } #main, #not_right_side, #content-wrapper, #content { min-width: 0; }
  #content { padding: 24px; } #dashboard_header_container { min-height: 64px; font-size: 24px; }
  .screenreader-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .ic-DashboardCard__box__container { display: flex; flex-wrap: wrap; gap: 16px; }
  .ic-DashboardCard { width: 260px; } .ic-DashboardCard__header_image { height: 120px; }
  #gz-todo { display: block; } @media (max-width: 600px) { #content { padding: 12px; } }
</style>`;
// Keep the brandable_css links: they are Canvas's marker. No captured page code, frame, image or stylesheet is fetched.
const clean = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '').replace('</head>', frame + '</head>');
const DASH = clean(fixture('canvas-dashboard-cards.html'));
const COURSE = clean(fixture('canvas-course-home.html'));
const courses = [25, 26, 27, 28].map((id) => ({ id, name: `Course ${id}`, course_code: `C ${id}`, enrollments: [{ type: 'student', user_id: 3, computed_current_score: 90, computed_current_grade: 'A' }] }));
const api = (u) => {
  if (u.pathname === '/api/v1/users/self/profile' || u.pathname === '/api/v1/users/self') return { id: '3', time_zone: 'America/New_York' };
  if (u.pathname === '/api/v1/users/self/colors') return { custom_colors: {} };
  if (u.pathname === '/api/v1/courses') return courses;
  return [];
};
const settings = (preset, extra = {}) => G.GZ_SANITIZE({ preset, navbar: { on: false }, colors: { ...G.GZ_PRESETS.find(([n]) => n === preset)[1] },
  enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), notes: true, widgets: true, todo: true, gpa: true, ...extra } });
const old = { tiles: [
  { id: 'timer', on: true, size: 's' }, { id: 'quotes', on: true, size: 'm' }, { id: 'notes', on: true, size: 'l' },
  { id: 'music', on: true, size: 's', float: true, x: 0, y: 0 },
  ...['agenda', 'breathe', 'buddy', 'todo'].map((id) => ({ id, on: false })),
] };
let checks = 0;
const ok = (value, label) => { if (!value) throw new Error(label); console.log(`ok   ${label}`); checks++; };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-boards-profile-'));
  let ctx;
  try {
    if (local) {
      const src = ext; ext = path.join(tmp, 'extension'); fs.mkdirSync(ext);
      for (const e of fs.readdirSync(src, { withFileTypes: true })) if (/\.(js|css|html)$/.test(e.name) || ['lib', 'features', 'i18n', '_locales', 'assets', 'fonts', 'icons', 'mods', 'sharing'].includes(e.name)) fs.cpSync(path.join(src, e.name), path.join(ext, e.name), { recursive: true });
      const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json')));
      manifest.host_permissions.push('http://localhost/*');
      manifest.content_scripts.find((s) => s.matches.includes('https://*.instructure.com/*')).matches.push('http://localhost/*');
      for (const w of manifest.web_accessible_resources) w.matches.push('http://localhost/*');
      fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
      ext = fs.realpathSync(ext);
    }
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), { ...chromeLaunch, headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...(!local ? ['--host-resolver-rules=MAP * ~NOTFOUND'] : [])],
    });
    if (!local) await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin !== O || route.request().method() !== 'GET') return route.abort();
      if (u.pathname.startsWith('/api/v1/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(api(u)) });
      if (u.pathname === '/' || u.pathname === '/courses/25') return route.fulfill({ contentType: 'text/html', body: u.pathname === '/' ? DASH : COURSE });
      return route.abort();
    });
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    const store = (s, l) => opts.evaluate(async ([s, l]) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); if (l) { await chrome.storage.local.clear(); await chrome.storage.local.set(l); } }, [s, l]);
    const layout = () => opts.evaluate(() => chrome.storage.local.get('widgetLayout').then((r) => r.widgetLayout));
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const tile = (id) => `section.gz-w[data-tile="${id}"]`;
    const rects = () => page.locator('#gz-dash .gz-dash-grid > .gz-w').evaluateAll((es) => es.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.tile, x: r.x, y: r.y, w: r.width, h: r.height }; }));
    const until = async (read, check, label) => { const end = Date.now() + 10000; while (Date.now() < end) { const value = await read(); if (check(value)) return value; await page.waitForTimeout(50); } throw new Error(label); };
    const stable = async () => {
      let last = '', same = 0;
      await until(async () => JSON.stringify(await rects()), (v) => { same = v === last ? same + 1 : 0; last = v; return same >= 5; }, 'board geometry did not settle');
    };
    const open = async (where = '/') => { await page.goto(O + where); await page.waitForSelector(where === '/' ? '#gz-dash[data-board="cdash"] .gz-w' : '#gz-float .gz-w'); await stable(); };
    const edit = () => page.click('#gz-dash .gz-dash-edit');
    const press = async (id, body = true, dx = 0, dy = 0, free = false) => {
      const b = await page.locator(`${tile(id)} ${body ? '.gz-w-body' : '.gz-w-head'}`).boundingBox();
      if (free) await page.keyboard.down('Alt');
      await page.mouse.move(b.x + b.width / 2, b.y + 10); await page.mouse.down();
      if (dx || dy) await page.mouse.move(b.x + b.width / 2 + dx, b.y + 10 + dy, { steps: 6 });
      await page.mouse.up(); if (free) await page.keyboard.up('Alt');
      await stable();
    };
    const cardsClear = async () => page.evaluate(() => {
      const cards = document.getElementById('DashboardCard_Container').getBoundingClientRect(), grid = document.querySelector('.gz-dash-grid').getBoundingClientRect();
      return [...document.querySelectorAll('#gz-dash .gz-w')].every((e) => e.getBoundingClientRect().bottom <= cards.top + 1) && grid.bottom <= cards.top + 1;
    });
    const nativeGrid = async () => {
      for (const dir of ['ltr', 'rtl']) for (const width of [1600, 1280, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((dir) => { document.documentElement.dir = dir; }, dir);
        const rows = await page.evaluate(() => {
          const host = document.querySelector('#DashboardCard_Container .ic-DashboardCard__box__container'), r = host.getBoundingClientRect();
          const cards = [...host.querySelectorAll('.ic-DashboardCard')].map((e) => { const a = e.getBoundingClientRect(); return { left: a.left - r.left, top: a.top, width: a.width }; });
          return { width: r.width, row: cards.filter((c) => Math.abs(c.top - cards[0].top) < 1).sort((a, b) => a.left - b.left) };
        });
        ok(Math.abs(rows.row[0].left) < 1 && Math.abs(rows.row.at(-1).left + rows.row.at(-1).width - rows.width) < 1,
          `native grid ${dir} ${width}: card borders stay inside their tracks`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
      await stable();
    };
    const notes = { [`notes:${O}/3`]: { text: 'Read chapter 4. Office hours Tuesday at 2pm.', at: Date.now() } };
    if (local) {
      const credentialsFile = process.env.CANVAS_CREDENTIALS || path.join(os.homedir(), 'Projects/canvas-lms/glaze/credentials.env');
      const credentials = Object.fromEntries(fs.readFileSync(credentialsFile, 'utf8').split(/\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')]; }));
      await page.goto(O + '/login/canvas');
      await page.locator('#pseudonym_session_unique_id').fill(credentials.STUDENT_EMAIL);
      await page.locator('#pseudonym_session_password').fill(credentials.STUDENT_PASSWORD || credentials.PASSWORD);
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login')), page.locator('button[type="submit"], input[type="submit"]').first().click()]);
      const courses = await page.evaluate(() => fetch('/api/v1/courses', { headers: { accept: 'application/json' } }).then((r) => r.text()).then((s) => JSON.parse(s.replace(/^while\(1\);/, ''))));
      await store(settings('Paper'), { widgetLayout: old });
      await open();
      await nativeGrid();
      ok(JSON.stringify((await rects()).map((x) => x.id)) === JSON.stringify(['timer', 'quotes', 'notes', 'todo']), 'local: legacy board migrates in reading order');
      ok(await page.locator(tile('timer')).count() === 1 && await page.locator(tile('music')).count() === 1, 'local: one instance per destination');
      ok(await cardsClear(), 'local: board reserves room above native course cards');
      await page.click(`${tile('music')} button[aria-label="Put Music back on this page"]`); await stable();
      await edit(); await press('timer', true, 32, 48, true);
      const moved = (await layout()).boards.cdash.find((x) => x.id === 'timer');
      ok(moved.x !== null && moved.y !== null, 'local: pointer board drag saves its spot');
      await page.locator(tile('timer')).focus(); await page.keyboard.press('Shift+ArrowDown');
      await until(layout, (l) => l.boards.cdash.find((x) => x.id === 'timer').y === moved.y + 64, 'local key move not saved');
      ok(true, 'local: keyboard board move saves a grid step');
      const width = (await page.locator(tile('timer')).boundingBox()).width;
      await page.locator(`${tile('timer')} .gz-w-resize`).focus(); await page.keyboard.press('ArrowRight');
      await until(layout, (l) => l.boards.cdash.find((x) => x.id === 'timer').w === width + 16, 'local resize not saved');
      ok(true, 'local: keyboard resize saves width');
      await edit(); await stable(); const saved = await rects();
      await page.reload(); await page.waitForSelector(tile('timer')); await stable();
      ok(isDeepStrictEqual(await rects(), saved), 'local: board geometry survives reload');
      await edit(); await page.click(`${tile('timer')} button[aria-label="Float Focus timer over every page"]`);
      await until(layout, (l) => l.tiles.find((x) => x.id === 'timer').float, 'local float not saved');
      await open(`/courses/${courses[0].id}`);
      ok(await page.locator(`#gz-float ${tile('timer')}`).count() === 1 && await page.locator(tile('timer')).count() === 1, 'local: floating follows the course page once');
      await press('timer', false, -32, -32, true);
      const floated = (await layout()).tiles.find((x) => x.id === 'timer');
      await page.reload(); await page.waitForSelector(tile('timer'));
      ok(isDeepStrictEqual((await layout()).tiles.find((x) => x.id === 'timer'), floated), 'local: floating geometry survives reload');
      await page.click(`${tile('timer')} button[aria-label="Put Focus timer back on the Dashboard"]`); await open();
      ok(await page.locator(`#gz-dash ${tile('timer')}`).count() === 1 && !await page.locator(`#gz-float ${tile('timer')}`).count(), 'local: float returns to its board without a duplicate');
      await page.setViewportSize({ width: 390, height: 1000 }); await stable();
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'local: phone layout has no horizontal overflow');
      await page.screenshot({ path: path.join(out, 'canvas-board-local-phone.png') });
      ok(!errors.length, `local: no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
      console.log(`passed; ${checks} checks on local Canvas; screenshots in ${out}`);
      return;
    }
    await store(settings('Paper'), { widgetLayout: old, ...notes });
    await open();
    await nativeGrid();
    if (process.env.CANVAS_GRID_ONLY === '1') return;
    ok(JSON.stringify((await rects()).map((x) => x.id)) === JSON.stringify(['timer', 'quotes', 'notes', 'todo']), 'old grid reading order migrates with the To Do widget');
    ok((await rects()).find((x) => x.id === 'notes').w === 512, 'old large size is its default width');
    ok(await page.locator('#gz-float section[data-tile="music"]').count() === 1, 'legacy float stays global, once');
    ok(await page.locator(tile('music')).evaluate((e) => { const r = e.getBoundingClientRect(); return Math.abs(r.left - 12) < 1 && Math.abs(r.top - 12) < 1; }), 'legacy normalized float spot is kept');
    await page.waitForSelector('#gz-gpa'); await page.waitForSelector('#gz-todo');
    ok(await page.evaluate(() => document.getElementById('dashboard_header_container').nextElementSibling.id === 'gz-dash' && document.getElementById('DashboardCard_Container').previousElementSibling.id === 'gz-gpa' && document.querySelector('#gz-dash .gz-w[data-tile="todo"] #gz-todo') && !document.querySelector('#right-side #gz-todo')), 'Better To Do lives in its widget; GPA and native course cards keep their places');
    ok(await cardsClear(), 'board reserves height above the course cards');
    // Restore the old float to the board so it cannot intercept board gestures.
    await page.click(`${tile('music')} button[aria-label="Put Music back on this page"]`); await stable();
    await edit();
    ok(await page.locator('#gz-dash .gz-w-body').evaluateAll((es) => es.every((e) => e.inert)), 'Edit layout makes content inert');
    ok(await page.locator('#gz-dash .gz-w-grip, #gz-dash .gz-w-size, #gz-dash .gz-w[draggable="true"]').count() === 0, 'old grid controls are gone');
    await press('timer', true, 2, 0);
    ok((await layout()).boards.cdash.find((x) => x.id === 'timer').x === null, 'under 4px: a press raises without moving');
    const tb = await page.locator(tile('timer')).boundingBox(), gb = await page.locator('.gz-dash-grid').boundingBox();
    await page.mouse.move(tb.x + 20, tb.y + tb.height / 2); await page.mouse.down();
    await page.mouse.move(gb.x + 20 + 20, tb.y + tb.height / 2 + 32, { steps: 6 });
    ok(await page.locator('.gz-guide:visible').count() > 0, 'snapped body drag shows a guide');
    await page.mouse.up(); await stable();
    const beforeEdit = await rects();
    await press('timer', true, 0, 80, true);
    let saved = await until(layout, (l) => l?.boards?.cdash.find((x) => x.id === 'timer')?.y !== null, 'body drag not saved');
    ok(saved.boards.cdash.filter((x) => x.on).every((x) => x.x !== null && x.y !== null) && saved.widths.cdash > 0, 'body drag settles every spot in one room');
    const afterDrag = await rects();
    ok(Math.abs(afterDrag.find((x) => x.id === 'timer').y - beforeEdit.find((x) => x.id === 'timer').y - 80) <= 1, 'Alt body drag places freely');
    await page.locator(tile('timer')).focus(); await page.keyboard.press('Shift+ArrowDown');
    await until(layout, (l) => l.boards.cdash.find((x) => x.id === 'timer').y === saved.boards.cdash.find((x) => x.id === 'timer').y + 64, 'keyboard move not saved');
    ok(await page.locator('.gz-sr').textContent().then((s) => /Moved Focus timer/.test(s)), 'tile arrow keys move and announce');
    const b = await page.locator(tile('timer')).boundingBox();
    const corner = await page.locator(`${tile('timer')} .gz-w-resize`).boundingBox();
    await page.keyboard.down('Alt'); await page.mouse.move(corner.x + 9, corner.y + 9); await page.mouse.down(); await page.mouse.move(corner.x + 57, corner.y + 73, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Alt');
    saved = await until(layout, (l) => Number.isInteger(l.boards.cdash.find((x) => x.id === 'timer').w), 'corner resize not saved');
    const resized = saved.boards.cdash.find((x) => x.id === 'timer');
    ok(resized.w === Math.round(b.width) + 48 && resized.h >= 48, 'pointer corner resize keeps width and body height');
    await press('notes');
    saved = await until(layout, (l) => l.boards.cdash.find((x) => x.id === 'notes').z > l.boards.cdash.find((x) => x.id === 'timer').z, 'raise not saved');
    ok(saved.boards.cdash.find((x) => x.id === 'notes').z > saved.boards.cdash.find((x) => x.id === 'timer').z, 'press raises and persists z');
    const beforeDone = await rects(); await edit(); await stable();
    ok(JSON.stringify(await rects()) === JSON.stringify(beforeDone), 'Done keeps tile dimensions and spots');
    await page.reload(); await page.waitForSelector(tile('timer')); await stable();
    ok(Math.round((await page.locator(tile('timer')).boundingBox()).width) === resized.w, 'resize survives reload');
    ok(await cardsClear(), 'moved and resized board still keeps course cards clear');
    // A known placed block: width changes preserve relative geometry, then flow, then stack only below tile width.
    let block = W.layout(old); block.tiles.find((x) => x.id === 'music').float = false;
    for (const x of block.boards.cdash) x.on = ['timer', 'quotes'].includes(x.id);
    block = W.apply(block, { ops: [{ s: 'cdash', id: 'timer', set: { x: 80, y: 16 } }, { s: 'cdash', id: 'quotes', set: { x: 240, y: 320 } }], widths: { cdash: 1232 } });
    await opts.evaluate((l) => chrome.storage.local.set({ widgetLayout: l }), block);
    await page.reload(); await page.waitForSelector(tile('timer')); await stable();
    const original = await rects();
    await page.setViewportSize({ width: 1000, height: 900 }); await stable();
    const shrunk = await rects();
    ok(Math.abs((shrunk[1].x - shrunk[0].x) - (original[1].x - original[0].x)) < 1 && shrunk[1].y - shrunk[0].y === original[1].y - original[0].y, 'zoom-like width keeps a block');
    await page.setViewportSize({ width: 450, height: 900 }); await stable();
    ok(!await page.locator('.gz-dash-grid').evaluate((e) => e.hasAttribute('data-stack')), 'narrower than the block: flow at own widths');
    await page.setViewportSize({ width: 375, height: 900 }); await stable();
    ok(await page.locator('.gz-dash-grid').evaluate((e) => e.hasAttribute('data-stack')), 'narrower than a tile: stack');
    ok(await cardsClear(), 'stack keeps cards clear');
    ok(isDeepStrictEqual(await layout(), block), 'width changes preserve stored layout');
    await page.setViewportSize({ width: 1280, height: 900 }); await stable();
    ok(JSON.stringify(await rects()) === JSON.stringify(original), 'wide room restores placed block');
    // Resize, float, resize without editing, raise from its body, drag by heading, reload, return from another page.
    await edit();
    await page.locator(`${tile('timer')} .gz-w-resize`).focus(); await page.keyboard.press('ArrowRight');
    await until(layout, (l) => l.boards.cdash.find((x) => x.id === 'timer').w === 304, 'key resize not saved');
    await page.click(`${tile('timer')} button[aria-label="Float Focus timer over every page"]`);
    await until(layout, (l) => l.tiles.find((x) => x.id === 'timer').float, 'float not saved');
    ok((await layout()).tiles.find((x) => x.id === 'timer').w === 304, 'board resize goes with the float');
    await page.click(`${tile('quotes')} button[aria-label="Float Quote over every page"]`);
    await until(layout, (l) => l.tiles.find((x) => x.id === 'quotes').float, 'second float not saved');
    await open('/courses/25');
    await press('timer');
    saved = await until(layout, (l) => l.tiles.find((x) => x.id === 'timer').z > l.tiles.find((x) => x.id === 'quotes').z, 'float raise not saved');
    ok(saved.tiles.find((x) => x.id === 'timer').z > saved.tiles.find((x) => x.id === 'quotes').z, 'floating body press raises and persists z');
    await page.locator(`${tile('timer')} .gz-w-resize`).focus(); await page.keyboard.press('ArrowRight');
    await until(layout, (l) => l.tiles.find((x) => x.id === 'timer').w === 320, 'float key resize not saved');
    ok(await page.locator(`${tile('timer')} .gz-w-body`).evaluate((e) => !e.inert), 'global float content works without editing');
    await press('timer', false, -64, -64, true);
    const floated = (await layout()).tiles.find((x) => x.id === 'timer');
    await page.reload(); await page.waitForSelector(tile('timer')); await stable();
    ok((await layout()).tiles.find((x) => x.id === 'timer').x === floated.x && Math.round((await page.locator(tile('timer')).boundingBox()).width) === 320, 'float size and normalized spot survive reload');
    await page.click(`${tile('timer')} button[aria-label="Put Focus timer back on the Dashboard"]`);
    await open();
    ok(await page.locator('#gz-dash section[data-tile="timer"]').count() === 1 && await page.locator('#gz-float section[data-tile="timer"]').count() === 0, 'float returns to its board once');
    // Both themes at wide and phone widths, with all four original board tiles for rendered review.
    const screenshots = W.layout(old); screenshots.tiles.find((x) => x.id === 'music').float = false;
    screenshots.boards.cdash.find((x) => x.id === 'music').on = true;
    for (const preset of ['Paper', 'Frost']) for (const width of [1280, 375]) {
      await store(settings(preset), { widgetLayout: screenshots, ...notes });
      await page.setViewportSize({ width, height: 1000 }); await open();
      const beforeEditing = await rects();
      await edit(); await stable();
      ok(isDeepStrictEqual(await rects(), beforeEditing), `${preset} ${width}: Edit layout keeps tile dimensions and spots`);
      await edit(); await stable();
      ok(isDeepStrictEqual(await rects(), beforeEditing), `${preset} ${width}: Done keeps tile dimensions and spots`);
      ok(await cardsClear(), `${preset} ${width}: cards clear`);
      await page.screenshot({ path: path.join(out, `canvas-board-${preset.toLowerCase()}-${width}.png`), fullPage: true });
    }
    ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    console.log(`passed; ${checks} checks; screenshots in ${out}`);
  } finally {
    try { await ctx?.close(); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
