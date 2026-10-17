// Ultra's boards, headless (B7b): the real extension on synthetic Courses, Institution and start pages built from
// docs/spikes/B7.md (B0's anchors; invented courses and modules), served under a made-up school's address. Nothing
// leaves the machine: Ultra's API is answered from test/fixtures, every other request is aborted and DNS is mapped to
// nowhere. It checks that the Courses page's tiles float where the panel was without covering Ultra's To Do; that
// they move only in Edit layout, by pointer (snapped, with a guide; Alt: free) and by keys (announced), and are where
// they were after a reload; that a narrow window stacks them and keeps the layout; the Dashboard's tabs (arrow keys,
// remembered, headed Dashboard, with Better To Do and no overlap when fresh); course cards picked, styled and given a
// picture in the boards' Course cards dialog (B10); a widget floating over every page, once, on
// a course's page clear of the nav and its top bar, and an old (B5) float carried over; and the opt-in landing (once,
// never on a reload). Screenshots: both boards and a course page, light and dark, 1280 and 375.
//   NODE_PATH=/path/to/node_modules node scripts/ultra-boards-check.js [out dir for screenshots]   (needs playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const zlib = require('zlib');
const G = require('../defaults.js');
require('../lib/widgets.js'); // its settings in GZ_SPEC

const ext = process.env.EXT || path.join(__dirname, '..');
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ultra-boards-'));
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const O = 'https://bb.school.test';
const fx = (n) => fs.readFileSync(path.join(__dirname, '..', 'test/fixtures', `ultra-${n}.json`), 'utf8');
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
let fails = 0;
// A tiny picture for the Course cards dialog's "Choose a picture": a 4×4 PNG, drawn here (two colors in stripes).
const png = () => {
  const chunk = (type, data) => { const b = Buffer.alloc(8 + data.length + 4); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const head = Buffer.alloc(13); head.writeUInt32BE(4, 0); head.writeUInt32BE(4, 4); head[8] = 8; head[9] = 2; // 8-bit RGB
  const rows = Buffer.concat(Array.from({ length: 4 }, (_, y) => Buffer.from([0, ...Array.from({ length: 4 }, () => (y % 2 ? [0x22, 0x88, 0x55] : [0xee, 0xaa, 0x22])).flat()])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
};
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

// Ultra's frame: the MUI drawer (200px, B7.md) and the page right of it; under 768px the drawer goes (Ultra's phone layout).
// Its links go through a stand-in router (Ultra's <base href> is its CDN's).
const SHELL = (title, main, script = '') => `<!doctype html><html lang="en"><head><base href="//ultra-cdn.invalid/ultra/uiv4001.0.0-rel/"><meta charset="utf-8"><title>${title}</title>
<style>
  body { margin: 0; font: 14px/1.45 "Open Sans", system-ui, sans-serif; }
  .MuiDrawer-paper { position: fixed; inset: 0 auto 0 0; width: 200px; background: #262626; }
  .MuiDrawer-paper a { display: block; padding: 10px 24px; color: #fff; text-decoration: none; }
  main#main-content { margin-left: 200px; }
  @media (max-width: 767px) { .MuiDrawer-paper { display: none; } main#main-content { margin-left: 0; } }
  .base-header { padding: 24px 30px; border-bottom: 1px solid #d8d8d8; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
  h1#main-heading { margin: 0; font: 400 32px Georgia, serif; }
  .base-courses-content { display: flex; }
  .courses-panel { flex: 1; min-width: 0; padding: 24px 30px; }
  .course-org-list { display: grid; }
  .course-card-term-name { margin: 0; padding: 12px 0; font-size: 18px; }
  .term-group { display: flex; flex-wrap: wrap; gap: 16px; padding-bottom: 16px; }
  article.element-card { display: flex; flex-direction: column; height: 284px; width: 262px; border: 1px solid #ccc; box-sizing: border-box; }
  .course-banner { height: 128px; flex: none; background: linear-gradient(135deg, #2c5f8a, #6ab0de); }
  .element-details { padding: 8px 12px; }
  .todo-panel { width: 320px; flex: none; border-left: 1px solid #d8d8d8; }
  .todo-panel aside { padding: 16px; }
  .todo-section { border-radius: 4px; padding: 16px; margin-bottom: 12px; text-align: center; border: 1px solid #d8d8d8; }
  @media (max-width: 1000px) { .base-courses-content { flex-direction: column; } .todo-panel { width: auto; border-left: 0; } }
  .ip-app { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 24px 30px; }
  .ip-module { border: 1px solid #ccc; border-radius: 6px; padding: 16px; min-height: 140px; }
</style></head><body><div id="site-wrap">
<div class="MuiPaper-root MuiDrawer-paper"><nav class="makeStylesnavigation-1-2-3"><ul style="list-style:none;margin:0;padding:24px 0">
${[['/ultra/profile', 'Profile'], ['/ultra/institution-page', 'Institution Page'], ['/ultra/stream', 'Activity'], ['/ultra/course', 'Courses'], ['/ultra/calendar', 'Calendar']].map(([h, n]) => `<li><a class="MuiButtonBase-root MuiListItemButton-root" href="${h}">${n}</a></li>`).join('')}
</ul></nav></div>
<main id="main-content"><div id="main-content-inner">${main}</div></main></div>
<script>document.addEventListener('click', (e) => { const a = e.target.closest('a[href^="/ultra/"]'); if (a && !e.defaultPrevented) { e.preventDefault(); location.assign(location.origin + a.getAttribute('href')); } });${script}</script>
</body></html>`;

const m = JSON.parse(fx('memberships')).results;
const COURSES = SHELL('Courses', `<section class="base-courses-container route-view-container js-base-page-skip-link-target">
<div class="base-courses-header-container base-header"><h1 id="main-heading" class="page-title">Courses</h1><div class="base-header-tools"></div></div>
<div class="base-courses-content"><div class="courses-panel"><div class="base-courses"><div class="course-list"><section id="course-columns-allTerms" class="course-columns multi-column-view"><div class="course-org-list">
<h2 class="course-card-term-name">Fall 2026</h2><div class="term-group term-_2_1">
${m.slice(0, 4).map((x) => `<bb-base-course-card><article id="course-list-course-${x.courseId}" data-course-id="${x.courseId}" class="element-card course-element-card"><div class="course-banner"></div><div class="element-details summary"><div class="course-id">${x.course.courseId || ''}</div><h4 class="course-title"><span class="js-course-title-element">${x.course.name}</span></h4><div class="course-status">Open</div></div></article></bb-base-course-card>`).join('\n')}
</div></div></section></div></div></div>
<div class="todo-panel js-todo-panel-skip-link-target"><bb-todo class="react-container"><aside><h2>To Do</h2>
<div id="todo-overdue-section" role="region" class="todo-section">No overdue items in past 7 days</div>
<div id="todo-due-today-section" role="region" class="todo-section">No items due today</div>
<div id="todo-due-soon-section" role="region" class="todo-section">Lab report 4 · Oct 17</div></aside></bb-todo></div></div></section>`);
const INSTITUTION = SHELL('Institution Page', `<section class="institution-page-container route-view-container">
<div class="black-panel-header base-header"><h1 id="main-heading" class="page-title">Institution Page</h1><div class="base-header-tools-transclude"></div></div>
<institution-page-home><div class="ip-app">${['Library hours', 'IT help desk', 'Campus news', 'Writing center'].map((n) => `<div class="ip-module"><h3>${n}</h3><p>Synthetic module for the check.</p></div>`).join('')}</div></institution-page-home></section>`);
// Ultra's start: it routes on to its stream once it has loaded (here, a moment later).
// A course's page (B8.md): its sticky two-row top bar (94px), then the outline.
const OUTLINE = SHELL('Course', `<div class="course-content-container"><div class="panel-wrap modern">
<div class="bb-course-navigation" style="position:sticky;top:0;z-index:10;height:94px;box-sizing:border-box;padding:12px 30px;background:#fff;border-bottom:1px solid #d8d8d8"><b>BIO 1100: Biology I</b><nav><a class="js-course-outline-tool">Content</a> · <a class="js-course-calendar-tool">Calendar</a> · <a class="js-course-grades-tool">Gradebook</a></nav></div>
<section class="course-outline-content" style="display:flex;gap:24px;padding:24px 30px"><div class="outline-column" style="flex:1">${['Week 1: Cells', 'Week 2: Genetics', 'Lab report 4', 'Midterm review'].map((n, i) => `<div class="content-list-item" data-content-id="_${300 + i}_1" style="border:1px solid #d8d8d8;padding:14px;margin-bottom:8px">${n}</div>`).join('')}</div>
<aside class="outline-actions" style="width:300px"><div class="outline-action-block js-details-and-actions" style="border:1px solid #d8d8d8;padding:14px"><h3 id="detailsActionsHeader">Details &amp; Actions</h3><a id="course-outline-roster-link">Roster</a></div></aside></section></div></div>`);
const STREAM = SHELL('Activity Stream', '<section class="js-base-stream-container route-view-container"><div class="base-header"><h1 id="main-heading">Activity Stream</h1></div><div id="activity-stream" style="padding:24px 30px">Nothing new.</div></section>',
  "if (/^\\/ultra\\/?$/.test(location.pathname)) setTimeout(() => history.replaceState(null, '', location.origin + '/ultra/stream'), 50);");

const api = (u) => {
  const p = u.pathname;
  if (p.endsWith('/users/me')) return { id: '_900_1', userName: 'student' };
  if (/\/memberships$/.test(p)) return JSON.parse(fx('memberships'));
  if (/calendars\/todo\/studentItems/.test(p)) return JSON.parse(fx('todo'));
  if (/calendars\/calendarItems/.test(p)) return JSON.parse(fx('calendar-items'));
  if (/gradebook\/grades$/.test(p)) return JSON.parse(fx('grades-status'));
  if (/\/terms$/.test(p)) return JSON.parse(fx('terms'));
  return { results: [] };
};

const settingsFor = (preset, extra = {}) => G.GZ_SANITIZE({ preset, colors: { ...G.GZ_PRESETS.find(([n]) => n === preset)[1] }, enhance: { ...G.GZ_DEFAULTS.enhance, notes: true, widgets: true }, ...extra });

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b7b-'));
  let ctx;
  const errors = [];
  try {
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), {
      executablePath: CHROME, headless: true, viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    const requests = [];
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin !== O || route.request().method() !== 'GET') return route.abort();
      if (u.pathname.startsWith('/learn/api/')) requests.push(u.pathname + u.search);
      if (u.pathname.startsWith('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(api(u)) });
      const page = { '/ultra/course': COURSES, '/ultra/institution-page': INSTITUTION, '/ultra': STREAM, '/ultra/': STREAM, '/ultra/stream': STREAM, '/ultra/courses/_101_1/outline': OUTLINE }[u.pathname];
      return page ? route.fulfill({ contentType: 'text/html', body: page }) : route.fulfill({ status: 404, body: '' });
    });
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    const store = (s, local) => opts.evaluate(async ([s, local]) => {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(s);
      if (local) { await chrome.storage.local.clear(); await chrome.storage.local.set(local); }
    }, [s, local]);
    const layout = () => opts.evaluate(() => chrome.storage.local.get('widgetLayout').then((r) => r.widgetLayout));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|ERR_FAILED|404/.test(msg.text())) errors.push(msg.text()); });
    const shot = async (name) => { await page.evaluate(() => getSelection().removeAllRanges()); await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true }); };
    const until = async (read, check, message) => {
      const end = Date.now() + 10000;
      while (Date.now() < end) { const value = await read(); if (check(value)) return value; await page.waitForTimeout(50); }
      throw new Error(message);
    };
    const stable = async () => {
      let last = '', same = 0;
      await until(() => page.evaluate(() => JSON.stringify([...document.querySelectorAll('section.gz-w')].map((e) => [e.dataset.tile, ...['x', 'y', 'width', 'height'].map((k) => Math.round(e.getBoundingClientRect()[k]))]))), (value) => { same = value === last ? same + 1 : 0; last = value; return same >= 5; }, 'widget geometry did not settle');
    };
    const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { left: r.left, top: r.top + scrollY, right: r.right, bottom: r.bottom + scrollY, width: r.width }; }, sel);
    const tile = (id) => `section.gz-w[data-tile="${id}"]`;
    // Narrow shots are one tall window: Glaze's Ultra theme scrolls the page inside main, which a full-page shot misses.
    const open = async (where, width, height = width < 768 ? 2400 : 860) => {
      await page.setViewportSize({ width, height });
      await page.goto(`${O}${where}`);
      await page.waitForSelector(where === '/ultra/course' ? `${tile('quotes')}` : '#gz-dash[data-board="dash"] section.gz-w', { timeout: 15000 });
      await page.waitForTimeout(700); // the agenda and the notes arrive
    };
    const editingStill = async (label) => {
      await stable();
      const geometry = () => page.evaluate(() => [...document.querySelectorAll('#gz-dash .gz-w, #gz-room > .gz-w')].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.tile, r.left, r.top + scrollY, r.width, r.height]; }));
      const before = JSON.stringify(await geometry());
      for (const state of ['Edit layout', 'Done']) {
        await page.click('.gz-dash-edit'); await stable();
        ok(JSON.stringify(await geometry()) === before, `${label}: ${state} keeps tile dimensions and spots`);
      }
    };
    const notes = { [`notes:${O}/_900_1`]: { text: 'Read chapter 4 before the lab. Office hours: Tue 2pm.', at: Date.now() } };

    if (!process.env.B10_ONLY) {
    // ---- light: both boards as they start, wide and narrow ---------------------------------------------------------
    await store(settingsFor('Paper'), notes);
    for (const width of [1280, 375]) {
      await open('/ultra/course', width);
      const room = await page.evaluate(() => document.querySelector('#gz-room') && document.querySelector('#gz-room').parentElement.className);
      if (width === 1280) {
        ok(/route-view-container/.test(room || ''), 'Courses: the tiles\' layer is first in Ultra\'s page');
        // Better To Do (on by default) in place of Ultra's To Do, or Ultra's own.
        const grid = await rect('#gz-panel .gz-dash-grid'), todo = (await rect('#gz-todo')) || (await rect('bb-todo aside')), last = await rect(tile('quotes')), first = await rect(tile('notes'));
        ok(Math.abs(first.right - grid.right) < 1 && Math.abs(first.top - grid.top) < 1, 'Courses: the first tile is where the panel\'s grid starts');
        ok(todo.top >= last.bottom, `Courses: the To Do starts below the tiles (${Math.round(todo.top)} ≥ ${Math.round(last.bottom)})`);
        ok(first.left >= 200, 'Courses: no tile under the nav');
      } else {
        ok(await page.evaluate(() => document.querySelector('#gz-panel .gz-dash-grid').hasAttribute('data-stack') && !!document.querySelector('#gz-panel .gz-dash-grid section.gz-w')), 'Courses, 375px: the tiles stack in the panel');
        ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Courses, 375px: no sideways scroll');
      }
      await editingStill(`Courses ${width}`);
      await shot(`courses-light-${width}`);
      await open('/ultra/institution-page', width);
      if (width === 1280) {
        ok(await page.evaluate(() => getComputedStyle(document.querySelector('institution-page-home')).display === 'none'), "Dashboard: Ultra's own page is hidden under it");
        ok(await page.evaluate(() => document.querySelector('div.base-header-tools-transclude [role="tablist"] [role="tab"][aria-selected="true"]')?.textContent === 'Dashboard'), 'Dashboard: its tab, chosen, in the header');
        ok(await page.evaluate(() => document.querySelector('h1#main-heading').textContent === 'Dashboard'), 'Dashboard: the page is headed Dashboard');
        await page.waitForSelector('section.gz-w[data-tile="todo"] #gz-todo', { timeout: 10000 }).catch(() => {});
        ok(await page.evaluate(() => !!document.querySelector('section.gz-w[data-tile="todo"] #gz-todo')), 'Dashboard: Better To Do in its tile');
        const boxes = await page.evaluate(() => [...document.querySelectorAll('#gz-dash section.gz-w')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
        ok(boxes.length === 5 && boxes.every((a) => boxes.every((b) => a === b || a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t)), `Dashboard, fresh: ${boxes.length} widgets, none over another`);
        const used = await page.evaluate(() => { const g = document.querySelector('#gz-dash .gz-dash-grid').getBoundingClientRect(); const t = [...document.querySelectorAll('#gz-dash section.gz-w')].map((e) => e.getBoundingClientRect()); return { left: Math.min(...t.map((r) => r.left)) - g.left, right: g.right - Math.max(...t.map((r) => r.right)) }; });
        ok(Math.abs(used.left - used.right) <= 1, `Dashboard, fresh: in the middle of its room (${Math.round(used.left)} | ${Math.round(used.right)})`);
      } else ok(await page.evaluate(() => document.querySelector('#gz-dash .gz-dash-grid').hasAttribute('data-stack')), 'Dashboard, 375px: stacked');
      await editingStill(`Dashboard ${width}`);
      await shot(`dash-light-${width}`);
    }

    // ---- moving tiles on the Courses page (a window tall enough that the pointer reaches every tile) --------------
    await open('/ultra/course', 1280, 1400);
    const before = await rect(tile('notes'));
    await page.mouse.move(before.left + 120, before.top + 14);
    await page.mouse.down();
    await page.mouse.move(500, 300, { steps: 6 });
    await page.mouse.up();
    ok(JSON.stringify(await rect(tile('notes'))) === JSON.stringify(before), 'not editing: a drag moves nothing');
    await page.click('#gz-toolbar .gz-dash-edit');
    ok(await page.evaluate(() => document.querySelector('#gz-dash .gz-sr[role="status"]')?.textContent.startsWith('Editing the layout')), 'Edit layout: said');
    // Notes to the empty middle, by its heading: snapped to the grid (from the page's left, 200px).
    const grab = (id) => rect(`${tile(id)} .gz-w-head h3`);
    const g0 = await grab('notes');
    await page.mouse.move(g0.left + 60, g0.top + 5);
    await page.mouse.down();
    await page.mouse.move(640 + 60, 300 + 5, { steps: 8 });
    await page.mouse.move(645 + 60, 307 + 5, { steps: 2 });
    await page.mouse.up();
    let n = await rect(tile('notes'));
    // On the grid, or lined up with another widget (its edges, centre, or a gap beside it), whichever was within reach.
    const lines = await page.evaluate(() => [...document.querySelectorAll('#gz-room section.gz-w:not([data-tile="notes"])')].flatMap((e) => { const r = e.getBoundingClientRect(); return [r.top, r.bottom, r.bottom + 16, r.top - 16, (r.top + r.bottom) / 2]; }));
    const lined = (v, h) => [v, v + h, v + h / 2].some((x) => lines.some((l) => Math.abs(l - x) < 1));
    ok((n.left - 200) % 16 === 0 && (n.top % 16 === 0 || lined(n.top, n.bottom - n.top)), `a drag lands on the grid, or lined up with another widget (${n.left - 200}, ${n.top})`);
    // The timer beside it: its top lines up with the notes' top, with a guide while it moves.
    const t0 = await rect(tile('timer')), tg = await grab('timer');
    await page.mouse.move(tg.left + 60, tg.top + 5);
    await page.mouse.down();
    // Let go a pixel off both lines, so no other tile's line is nearer (the column's tiles can line up there too).
    await page.mouse.move(n.right + 16 + 1 + 60 + (tg.left - t0.left), n.top + 5 + 1 + (tg.top - t0.top), { steps: 8 });
    const guides = await page.evaluate(() => [...document.querySelectorAll('#gz-room .gz-guide')].filter((g) => !g.hidden).length);
    ok(guides >= 1, `a guide shows on the line it meets (${guides})`);
    await shot('courses-drag-guide-light-1280');
    await page.mouse.up();
    await until(layout, (l) => Number.isFinite(l?.boards?.courses?.find((x) => x.id === 'timer')?.x), 'timer drag not saved');
    await stable();
    const tm = await rect(tile('timer'));
    ok(Math.abs(tm.top - n.top) < 1 && Math.abs(tm.left - (n.right + 16)) < 1, 'it snaps beside the other tile, tops lined up');
    // Alt: exactly where it's let go.
    const q0 = await rect(tile('quotes')), qg = await grab('quotes');
    await page.mouse.move(qg.left + 60, qg.top + 5);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(n.left + 77 + 60 + (qg.left - q0.left), n.top + 133 + 5 + (qg.top - q0.top), { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const q1 = await rect(tile('quotes'));
    ok(Math.abs(q1.left - (n.left + 77)) < 1.5 && Math.abs(q1.top - (n.top + 133)) < 1.5, `Alt places it freely, over the notes (${Math.round(q1.left - n.left)}, ${Math.round(q1.top - n.top)}; from ${Math.round(q0.left - n.left)}, ${Math.round(q0.top - n.top)})`);
    ok(await page.evaluate(() => +document.querySelector('section.gz-w[data-tile="quotes"]').style.zIndex > +document.querySelector('section.gz-w[data-tile="notes"]').style.zIndex), 'the one moved last is on top');
    // Keys: one grid step, said, the tile keeps the focus.
    await page.focus(tile('timer'));
    await page.keyboard.press('ArrowLeft');
    const tk = await rect(tile('timer'));
    ok(Math.abs(tk.left - (tm.left - 16)) < 1, 'ArrowLeft: one grid step');
    ok(await page.evaluate(() => /^Moved Focus timer: \d+ px from the left, \d+ px from the top$/.test(document.querySelector('#gz-dash .gz-sr').textContent)), 'the move is said');
    ok(await page.evaluate(() => document.activeElement?.dataset.tile === 'timer'), 'the tile keeps the focus');
    await page.keyboard.press('Shift+ArrowDown');
    ok(Math.abs((await rect(tile('timer'))).top - (tk.top + 64)) < 1, 'Shift+ArrowDown: four steps');
    // Anywhere on it while editing, its content too (which waits meanwhile): a drag by the middle of its body.
    const tb = await rect(`${tile('timer')} .gz-w-body`), t1 = await rect(tile('timer'));
    ok(await page.evaluate(() => document.querySelector('section.gz-w[data-tile="timer"] .gz-w-body').inert && !document.querySelector('.gz-w-grip, .gz-w-size')), 'editing: its content waits; no handle, no size picker');
    await page.mouse.move(tb.left + 40, tb.top + 20); await page.mouse.down(); await page.mouse.move(tb.left + 40 - 160, tb.top + 20, { steps: 6 }); await page.mouse.up();
    await stable();
    ok(t1.left - (await rect(tile('timer'))).left > 140, 'a drag by its body moves it');
    // Its corner: dragged, it resizes (snapped), on top, kept.
    const rc = await rect(`${tile('timer')} .gz-w-resize`), t2 = await rect(tile('timer'));
    await page.mouse.move(rc.left + 9, rc.top + 9); await page.mouse.down(); await page.mouse.move(rc.left + 9 + 70, rc.top + 9 + 90, { steps: 8 }); await page.mouse.up();
    await until(layout, (l) => Number.isInteger(l?.boards?.courses?.find((x) => x.id === 'timer')?.w), 'timer resize not saved');
    await stable();
    const t3 = await rect(tile('timer'));
    ok(t3.width > t2.width + 40 && t3.bottom - t3.top > t2.bottom - t2.top + 50 && Math.abs(t3.left - t2.left) < 1, `the corner resizes it, its left edge where it was (${Math.round(t2.width)} → ${Math.round(t3.width)})`);
    await shot('courses-resize-light-1280');
    // A double-click on its corner: its own size again.
    await page.dblclick(`${tile('timer')} .gz-w-resize`);
    await until(layout, (l) => !('w' in (l?.boards?.courses?.find((x) => x.id === 'timer') || { w: 1 })), 'timer size not reset');
    await stable();
    ok(Math.abs((await rect(tile('timer'))).width - t2.width) < 1, 'a double-click on the corner: its own size again');
    await shot('courses-overlap-edit-light-1280');
    await page.click('#gz-toolbar .gz-dash-edit'); // Done
    const kept = await rect(tile('quotes'));
    await page.reload();
    await page.waitForSelector(tile('quotes'));
    await page.waitForTimeout(500);
    ok(JSON.stringify(await rect(tile('quotes'))) === JSON.stringify(kept), 'after a reload, where it was');
    // The toolbar is in the page's header; Hide widgets takes every widget away, and Show widgets brings them back.
    ok(await page.evaluate(() => !!document.querySelector('div.base-courses-header-container div.base-header-tools > #gz-toolbar')), 'the toolbar is in the page header');
    const vis = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#gz-room section.gz-w')].map((e) => [e.dataset.tile, e.getClientRects().length > 0])));
    ok(await page.evaluate(() => !document.querySelector('#gz-panel h2, #gz-panel .gz-panel-toggle')), 'no Notes and widgets heading to fold');
    await page.click('#gz-toolbar .gz-dash-hide');
    await page.waitForTimeout(200);
    v = await vis();
    ok(Object.values(v).every((on) => !on) && await page.evaluate(() => document.querySelector('#gz-toolbar .gz-dash-hide').textContent === 'Show widgets'), `Hide widgets: every widget away (${JSON.stringify(v)})`);
    await shot('courses-hidden-light-1280');
    await page.click('#gz-toolbar .gz-dash-hide');
    await page.waitForTimeout(200);
    ok(Object.values(await vis()).every(Boolean), 'Show widgets: all back');
    // Narrow: stacked, the layout kept; wide again: back where they were.
    const saved = JSON.stringify(await layout());
    await page.setViewportSize({ width: 375, height: 860 });
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.querySelector('#gz-panel .gz-dash-grid').hasAttribute('data-stack')), 'narrow: stacked');
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.waitForTimeout(400);
    ok(JSON.stringify(await layout()) === saved && JSON.stringify(await rect(tile('quotes'))) === JSON.stringify(kept), 'wide again: the same layout, the same spots');

    // ---- the Dashboard: tabs, and a layout of its own -----------------------------------------------------------
    await open('/ultra/institution-page', 1280, 1400);
    await page.focus('[role="tab"][aria-selected="true"]');
    await page.keyboard.press('ArrowRight');
    ok(await page.evaluate(() => document.activeElement?.textContent === 'Institution page' && document.getElementById('gz-dash').hidden && getComputedStyle(document.querySelector('institution-page-home')).display !== 'none'), 'ArrowRight: Ultra\'s page, the board hidden');
    await shot('dash-ip-tab-light-1280');
    await page.reload();
    await page.waitForSelector('[role="tab"][aria-selected="true"]');
    ok(await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]').textContent === 'Institution page'), 'the last tab is remembered');
    await page.focus('[role="tab"][aria-selected="true"]');
    await page.keyboard.press('Home');
    await page.waitForTimeout(500);
    await page.click('#gz-dash .gz-dash-edit');
    const ag = await grab('agenda'), nd = await rect(tile('notes'));
    await page.mouse.move(ag.left + 60, ag.top + 5);
    await page.mouse.down();
    await page.mouse.move(nd.left + 200 + 60, nd.top + 90 + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300); // the worker stores the change
    const lay = await layout();
    const differ = lay.boards.courses.filter((x, i) => JSON.stringify(x) !== JSON.stringify(JSON.parse(saved).boards.courses[i]));
    ok(lay.boards.dash.find((x) => x.id === 'agenda').x !== null && !differ.length, `the Dashboard moves alone; the Courses page keeps its layout${differ.length ? `: ${JSON.stringify(differ)} was ${JSON.stringify(JSON.parse(saved).boards.courses.filter((x) => differ.some((d) => d.id === x.id)))}` : ''}`);
    ok(await page.evaluate(() => !document.querySelector('#gz-dash .gz-dash-grid').hasAttribute('data-stack')), 'tiles laid over each other on purpose stay laid out (no stack)');
    await shot('dash-overlap-edit-light-1280');
    await page.click('#gz-dash .gz-dash-edit');

    // ---- floating over every page ----------------------------------------------------------------------------
    const arranged = await layout();
    await open('/ultra/course', 1280, 1400);
    await page.click('#gz-toolbar .gz-dash-edit');
    await page.click(`${tile('timer')} button[aria-label="Float Focus timer on every Blackboard page"]`);
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.querySelectorAll('section.gz-w[data-tile="timer"]').length === 1 && !!document.querySelector('#gz-float section.gz-w[data-tile="timer"]')), 'Float on every page: the timer floats, once');
    await page.click('#gz-toolbar .gz-dash-edit');
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width < 768 ? 860 : 860 });
      await page.goto(`${O}/ultra/courses/_101_1/outline`);
      await page.waitForSelector(tile('timer'), { timeout: 15000 });
      await page.waitForTimeout(500);
      const g = await page.evaluate(() => { const t = document.querySelector('section.gz-w[data-tile="timer"]').getBoundingClientRect(); const bar = document.querySelector('div.bb-course-navigation').getBoundingClientRect(); const nav = document.querySelector('.MuiDrawer-paper').getBoundingClientRect(); return { t: { l: t.left, tp: t.top, r: t.right, b: t.bottom }, bar: bar.bottom, nav: nav.width ? nav.right : 0, w: innerWidth, h: innerHeight, others: document.querySelectorAll('section.gz-w').length }; });
      ok(g.t.l >= g.nav && g.t.tp >= g.bar && g.t.r <= g.w && g.t.b <= g.h, `a course page, ${width}px: the timer floats clear of the nav and the course's top bar, on screen`);
      ok(g.others === 1, `a course page, ${width}px: only the floating widget, not the Courses page's`);
      await page.screenshot({ path: path.join(out, `outline-float-light-${width}.png`) });
      if (width === 375) {
        const start = await rect(`${tile('timer')} .gz-w-head h3`);
        const beforeTouch = await rect(tile('timer'));
        const touch = await ctx.newCDPSession(page);
        try {
          await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
          await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.left + 20, y: start.top + 5, id: 1 }] });
          await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.left + 4, y: start.top - 59, id: 1 }] });
          await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally { await touch.detach(); }
        await page.waitForTimeout(500);
        const moved = await rect(tile('timer'));
        ok(moved.top < beforeTouch.top && moved.left >= 0 && moved.right <= width, 'touch drag: global timer moves and stays on screen at 375px');
        await page.screenshot({ path: path.join(out, 'outline-float-touch-light-375.png') });
      }
    }
    await page.waitForTimeout(800);
    const idleWrites = await page.evaluate(() => new Promise((resolve) => {
      let count = 0;
      const observer = new MutationObserver((records) => { count += records.filter((r) => r.target.closest?.('#gz-float, #gz-dash, #gz-room, .gz-dash-tabs')).length; });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
      setTimeout(() => { observer.disconnect(); resolve(count); }, 1200);
    }));
    ok(idleWrites === 0, `global float idle: ${idleWrites} own DOM/style writes in 1.2 seconds`);

    // B8 can add/resize its own strip after the widgets mount. RTL rails and a footer leave the same bounded room.
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.evaluate(() => {
      const nav = document.querySelector('.MuiDrawer-paper');
      Object.assign(nav.style, { left: 'auto', right: '0' });
      const strip = document.createElement('div');
      strip.id = 'synthetic-b8'; strip.dataset.gzKeepClear = '';
      Object.assign(strip.style, { position: 'fixed', left: '0', right: '200px', top: '94px', height: '48px', background: '#598', zIndex: 100 });
      document.body.append(strip);
    });
    await page.waitForTimeout(700);
    const clear = () => page.evaluate(() => {
      const t = document.querySelector('#gz-float section.gz-w').getBoundingClientRect();
      const bar = document.querySelector('#synthetic-b8').getBoundingClientRect();
      const nav = document.querySelector('.MuiDrawer-paper').getBoundingClientRect();
      const footer = document.querySelector('#synthetic-footer')?.getBoundingClientRect();
      return t.left >= 0 && t.right <= nav.left && t.top >= bar.bottom && t.bottom <= (footer?.top ?? innerHeight);
    });
    ok(await clear(), 'global float: a late B8 strip and RTL right rail stay clear');
    await page.evaluate(() => { document.querySelector('#synthetic-b8').style.height = '80px'; });
    await page.waitForTimeout(400);
    ok(await clear(), 'global float: a keep-clear strip resizing remeasures its room');
    await page.setViewportSize({ width: 1280, height: 380 });
    await page.evaluate(() => {
      const footer = document.createElement('div');
      footer.id = 'synthetic-footer'; footer.dataset.gzKeepClear = '';
      Object.assign(footer.style, { position: 'fixed', left: '0', right: '200px', bottom: '0', height: '60px', background: '#965', zIndex: 100 });
      document.body.append(footer);
    });
    await page.waitForTimeout(700);
    ok(await page.evaluate(() => document.querySelector('#gz-float').hasAttribute('data-stack')), 'short room: tall float uses a scrolling stack');
    const bounded = await page.evaluate(() => {
      const f = document.querySelector('#gz-float').getBoundingClientRect(), bar = document.querySelector('#synthetic-b8').getBoundingClientRect(), nav = document.querySelector('.MuiDrawer-paper').getBoundingClientRect(), foot = document.querySelector('#synthetic-footer').getBoundingClientRect();
      return f.left >= 0 && f.right <= nav.left && f.top >= bar.bottom && f.bottom <= foot.top;
    });
    ok(bounded, 'stack stays inside the room, clear of the right rail, B8 strip and footer');
    await page.screenshot({ path: path.join(out, 'outline-float-rtl-short-1280.png') });
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForSelector(tile('timer'));
    await page.click(`${tile('timer')} button[aria-label="Put Focus timer back on the Courses page"]`);
    await page.waitForTimeout(300);
    await open('/ultra/course', 1280);
    ok(await page.evaluate(() => !!document.querySelector('#gz-room section.gz-w[data-tile="timer"]') && !document.querySelector('#gz-float section.gz-w')), 'back on the Courses page, at its place');
    // An old layout (B5): music floating over every Ultra page at the top left of the window.
    const old = { tiles: ['notes', 'agenda', 'timer', 'quotes', 'music', 'breathe', 'buddy'].map((id) => ({ id, on: id === 'music' || id === 'notes', float: id === 'music', x: id === 'music' ? 0 : null, y: id === 'music' ? 0 : null })) };
    await opts.evaluate((l) => chrome.storage.local.set({ widgetLayout: l }), old);
    await page.goto(`${O}/ultra/courses/_101_1/outline`);
    await page.waitForSelector(tile('music'), { timeout: 15000 });
    await stable();
    const floatTop = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('div.bb-course-navigation, [data-gz-keep-clear]')].map((e) => e.getBoundingClientRect().bottom)) + 12);
    const mus = await page.evaluate(() => document.querySelector('section.gz-w[data-tile="music"]').getBoundingClientRect().toJSON());
    ok(Math.abs(mus.left - (200 + 12)) <= 1 && Math.abs(mus.top - floatTop) <= 1, `an old float still floats, at its place in the room (${Math.round(mus.left)}, ${Math.round(mus.top)})`);
    await store(settingsFor('Frost'));
    await page.reload();
    await page.waitForSelector(tile('music'), { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, 'outline-float-dark-1280.png') });
    await page.setViewportSize({ width: 375, height: 860 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, 'outline-float-dark-375.png') });
    await opts.evaluate((l) => chrome.storage.local.set({ widgetLayout: l }), arranged);

    // ---- dark: the moved layouts, wide and narrow -------------------------------------------------------------
    await store(settingsFor('Frost'));
    for (const width of [1280, 375]) {
      await open('/ultra/course', width);
      await shot(`courses-dark-${width}`);
      await open('/ultra/institution-page', width);
      await shot(`dash-dark-${width}`);
    }

    // ---- Dashboard defaults can opt a tile into every page without enabling the older Courses widgets switch -----
    await store(settingsFor('Paper', { enhance: { ...G.GZ_DEFAULTS.enhance, notes: false, widgets: false, pet: false } }), notes);
    await open('/ultra/institution-page', 1280);
    await page.click('#gz-dash .gz-dash-edit');
    await page.click(`${tile('timer')} button[aria-label="Float Focus timer on every Blackboard page"]`);
    await page.waitForTimeout(400);
    await page.click('[role="tab"][data-tab="ip"]');
    ok(await page.evaluate(() => document.getElementById('gz-dash').hidden && document.querySelectorAll('#gz-float section[data-tile="timer"]').length === 1), 'native Institution tab: board hidden, explicitly global timer stays once');
    await page.goto(`${O}/ultra/courses/_101_1/outline`);
    await page.waitForSelector('#gz-float section[data-tile="timer"]', { timeout: 10000 }).catch(() => {});
    ok(await page.evaluate(() => document.querySelectorAll('section[data-tile="timer"]').length === 1 && !!document.querySelector('#gz-float section[data-tile="timer"]')), 'Dashboard float works on a course route with the older Widgets switch off');

    // ---- the landing: opt-in, once, never a reload ------------------------------------------------------------
    await store(settingsFor('Paper', { widgets: { ...G.GZ_SANITIZE({}).widgets, land: false } }));
    const land = await ctx.newPage();
    await land.setViewportSize({ width: 1280, height: 860 });
    await land.goto(`${O}/ultra`);
    await land.waitForTimeout(1500);
    ok(new URL(land.url()).pathname === '/ultra/stream', `off by default: Ultra's own start page (${new URL(land.url()).pathname})`);
    await land.close();
    await store(settingsFor('Paper', { widgets: { ...G.GZ_SANITIZE({}).widgets, land: true } }));
    const tab = await ctx.newPage();
    await tab.setViewportSize({ width: 1280, height: 860 });
    await tab.goto(`${O}/ultra/stream`);
    await tab.waitForTimeout(1500);
    ok(new URL(tab.url()).pathname === '/ultra/stream', 'a page asked for by address is left alone');
    await tab.goto(`${O}/ultra`);
    await tab.waitForURL('**/ultra/institution-page', { timeout: 8000 }).catch(() => {});
    ok(new URL(tab.url()).pathname === '/ultra/institution-page', 'on: the start page goes on to the Dashboard');
    await tab.goto(`${O}/ultra`);
    await tab.waitForTimeout(1500);
    ok(new URL(tab.url()).pathname === '/ultra/stream', 'once in a tab: the next start stays');
    await tab.close();
    const fresh = await ctx.newPage();
    await fresh.goto(`${O}/ultra`);
    await fresh.waitForURL('**/ultra/institution-page', { timeout: 8000 }).catch(() => {});
    await fresh.reload();
    await fresh.waitForTimeout(1500);
    ok(new URL(fresh.url()).pathname === '/ultra/institution-page', 'a reload of the Dashboard stays (no loop)');
    await fresh.close();
    }
    // ---- B10: course cards use the boards, never React's nodes or a new reader ---------------------------------
    const base = require('../lib/widgets.js').layout({ todo: true });
    for (const board of ['courses', 'dash', 'pages']) for (const x of base.boards[board]) x.on = false;
    const courseTile = 'section.gz-w[data-tile^="course:"]';
    for (const preset of ['Paper', 'Frost']) for (const width of [1280, 375]) {
      await store(settingsFor(preset, { enhance: { ...G.GZ_DEFAULTS.enhance, notes: false, widgets: true, todo: false, cardTasks: true, overall: true, coursemenu: true, newgrades: true, newcontent: true } }), { ...notes, widgetLayout: base, ucards: {} });
      await page.setViewportSize({ width, height: width < 768 ? 2400 : 1400 });
      await page.goto(`${O}/ultra/course`);
      await page.waitForSelector('#gz-toolbar .gz-dash-edit');
      ok(!(await layout()).boards.courses.some((x) => x.id.startsWith('course:')), `B10 ${preset} ${width}: opt-in, native list stays`);
      await page.click('#gz-toolbar .gz-dash-edit');
      await page.waitForSelector('.gz-course-open');
      await stable();
      const count = requests.length;
      const native = await page.locator('article.course-element-card').count();
      // The Course cards dialog: modal, labelled, the focus in it; every course, as a small card; all of them one click.
      await page.click('.gz-course-open');
      await page.waitForSelector('#gz-ccm[open] .gz-ccm-item');
      ok(await page.evaluate(() => { const d = document.getElementById('gz-ccm'); return d.matches(':modal') && d.contains(document.activeElement) && document.getElementById(d.getAttribute('aria-labelledby'))?.textContent === 'Course cards'; }), `B10 ${preset} ${width}: the Course cards dialog is modal and labelled, the focus in it`);
      ok(await page.locator('#gz-ccm .gz-ccm-item article[data-gz-card-preview]').count() === native, `B10 ${preset} ${width}: each course is in it as a small card`);
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('gz-ccm').scrollWidth <= document.getElementById('gz-ccm').clientWidth), `B10 ${preset} ${width}: the dialog fits, no sideways scroll`);
      await page.click('#gz-ccm .gz-ccm-tools button.gz-w-main'); // Select all: highlighted while the board has none
      await page.waitForSelector(`${courseTile} .gz-course-card`);
      await stable();
      ok(await page.evaluate((n) => document.querySelector('#gz-ccm .gz-ccm-count').textContent === `On this board: ${n}. Room for ${48 - n} more.` && document.querySelectorAll('#gz-ccm .gz-ccm-item[data-on]').length === n, native), `B10 ${preset} ${width}: Select all ticks them all, and the count says so`);
      await page.mouse.move(0, 0); await shot(`b10-modal-${preset.toLowerCase()}-${width}`);
      await page.click('#gz-ccm .gz-ccm-item .gz-ccm-style');
      await page.waitForSelector('#gz-ccm .gz-ccm-look:not([hidden])');
      await page.mouse.move(0, 0); await shot(`b10-modal-style-${preset.toLowerCase()}-${width}`);
      if (preset === 'Paper' && width === 1280) {
        // A look from the dialog: the second course a gradient, then a picture from this computer; both on its board card.
        const item = page.locator('#gz-ccm .gz-ccm-item').nth(1), id = await item.locator('article').getAttribute('data-course-id');
        const ukey = `ultra:${O}/${id}`, onBoard = `${courseTile} article.gz-course-card[data-course-id="${id}"]`;
        await item.locator('.gz-ccm-style').click();
        await item.locator('.gz-ccm-kinds label', { hasText: 'Gradient' }).click();
        await page.waitForSelector(`${onBoard}[data-gz-card="gradient"]`);
        ok(await item.locator('article[data-gz-card="gradient"]').count() === 1, 'B10: a gradient chosen in the dialog shows on its card and its preview');
        await item.locator('.gz-ccm-kinds label', { hasText: 'Picture' }).click();
        await item.locator('input[type="file"]').setInputFiles({ name: 'lab.png', mimeType: 'image/png', buffer: png() });
        await page.waitForSelector(`${onBoard}[data-gz-card="image"]`);
        const kept = await opts.evaluate(async (k) => { const { ucards } = await chrome.storage.sync.get('ucards'); const s = ucards?.[k]; const img = s?.i && (await chrome.storage.local.get(`ultraCardImg:${s.i}`))[`ultraCardImg:${s.i}`]; return { k: s?.k, local: !!s?.i && !s.u, img: /^data:image\/(webp|jpeg);base64,/.test(img || '') }; }, ukey);
        ok(kept.k === 'image' && kept.local && kept.img, `B10: a picture from this computer is kept on it, as the card's own (${JSON.stringify(kept)})`);
        ok(await item.locator('article[data-gz-card="image"]').count() === 1 && await page.locator(onBoard).evaluate((e) => /data:image\//.test(getComputedStyle(e).getPropertyValue('--gz-card-img'))), 'B10: the picture shows on the board card and the preview');
        await page.mouse.move(0, 0); await shot('b10-modal-picture-paper-1280');
        // The full editor, over the dialog; Esc closes only it, and the focus goes back to the course's Style.
        await item.locator('button', { hasText: 'Card style and bookmarks' }).click();
        await page.waitForSelector('#gz-ce[open]');
        ok(await page.evaluate(() => document.getElementById('gz-ce').matches(':modal') && document.getElementById('gz-ccm').open), 'B10: the card editor opens over the dialog');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#gz-ce', { state: 'detached' });
        ok(await page.evaluate((cid) => document.getElementById('gz-ccm')?.open && document.activeElement === [...document.querySelectorAll('#gz-ccm .gz-ccm-item')].find((li) => li.querySelector('article').dataset.courseId === cid)?.querySelector('.gz-ccm-style'), id), 'B10: Esc closes the editor only, the focus back on Style');
        await opts.evaluate(() => chrome.storage.sync.remove('ucards'));
      }
      await page.keyboard.press('Escape');
      await page.waitForSelector('#gz-ccm', { state: 'detached' });
      ok(await page.evaluate(() => document.activeElement?.classList.contains('gz-course-open')), `B10 ${preset} ${width}: Esc closes the dialog, the focus back on its button`);
      const nativeColor = await page.locator(`${courseTile} .gz-course-card`).evaluateAll((es) => es.map((e) => ({ id: e.dataset.courseId, classes: e.className, color: getComputedStyle(e.querySelector('.course-banner')).backgroundColor })));
      ok(nativeColor.some((c) => /course-color-3/.test(c.classes)) && new Set(nativeColor.map((c) => c.color)).size > 1, 'B10: native slot colours reach the banner before any custom card style');
      ok(await page.locator(courseTile).count() >= native, `B10 ${preset} ${width}: each loaded course is a tile`);
      ok(await page.evaluate(() => document.documentElement.hasAttribute('data-gz-course-tiles') && getComputedStyle(document.querySelector('.course-columns')).display === 'none'), 'B10: native list steps aside');
      ok(await page.locator('article.course-element-card').count() === native, 'B10: React keeps all its nodes');
      await opts.evaluate(() => chrome.storage.sync.set({ ucards: { ['ultra:https://bb.school.test/_101_1']: { k: 'gradient', c: '#aa2244', d: '#2255aa', a: 45 } }, ulinks: { ['ultra:https://bb.school.test/_101_1']: [{ n: 'Course calendar', u: 'https://bb.school.test/ultra/calendar', i: 'calendar' }] } }));
      await page.waitForSelector(`${courseTile} article[data-gz-card="gradient"]`);
      ok(await page.locator(`${courseTile} .gz-bm a`).count() > 0, 'B10: existing bookmark and style painter applies');
      // While editing, a card is a thing to move: its menu waits until Done.
      const menuButton = page.locator(`${courseTile} .gz-cm-btn`).first();
      ok(await menuButton.evaluate((b) => !!b.closest('[inert]')), 'B10: editing, the card\'s content waits');
      await page.click('#gz-toolbar .gz-dash-edit');
      await menuButton.click(); await page.waitForSelector('#gz-cm');
      ok(await page.locator('#gz-cm').count() === 1, 'B10: existing course menu opens');
      await page.keyboard.press('Escape');
      await page.click('#gz-toolbar .gz-dash-edit');
      const geometry = await page.locator(courseTile).evaluateAll((es) => es.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, term: e.querySelector('.gz-course-term').textContent }; }));
      ok(geometry.every((a) => a.l >= 0 && a.r <= width && geometry.every((b) => a === b || a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t)), `B10 ${preset} ${width}: cards fit without overlap`);
      ok(requests.length === count, `B10 ${preset} ${width}: adding cards starts no requests (${requests.length - count})`);
      await page.mouse.move(0, 0); await shot(`b10-courses-${preset.toLowerCase()}-${width}`);
      await page.click('.gz-course-native');
      ok(await page.evaluate(() => !document.documentElement.hasAttribute('data-gz-course-tiles') && getComputedStyle(document.querySelector('.course-columns')).display !== 'none'), 'B10: native filters remain reachable');
      await page.click('.gz-course-native');
      const key = await page.locator(courseTile).first().getAttribute('data-tile');
      const first = page.locator(tile(key));
      await first.locator('.gz-w-fold').click();
      ok(await first.locator('.gz-w-body').isHidden(), 'B10: fold works');
      await first.locator('.gz-w-fold').click();
      if (width === 1280) {
        const before = await first.boundingBox();
        await first.focus(); await page.keyboard.press('ArrowDown');
        await until(layout, (l) => Number.isFinite(l.boards.courses.find((x) => x.id === key)?.y), 'course move not saved');
        await stable();
        const after = await first.boundingBox();
        ok(Math.abs(after.y - before.y - 16) < 1, 'B10: keyboard movement on the card itself');
        await first.locator('.gz-w-resize').focus(); await page.keyboard.press('Shift+ArrowRight');
        await until(layout, (l) => l.boards.courses.find((x) => x.id === key)?.w === Math.round(after.width) + 64, 'course resize not saved');
        await page.reload(); await page.waitForSelector(tile(key)); await stable();
        ok(Math.round((await page.locator(tile(key)).boundingBox()).width) === Math.round(after.width) + 64, 'B10: size survives reload');
      }
      // Same-origin in-app navigation (not while editing); modified clicks are left as native link behaviour.
      if (await page.locator('#gz-toolbar .gz-dash-edit[aria-pressed="true"]').count()) await page.click('#gz-toolbar .gz-dash-edit');
      const route = await page.locator(`${courseTile} .course-title`).first().getAttribute('href');
      await page.evaluate(() => { window.__b10SameDocument = true; });
      await page.locator(`${courseTile} .course-title`).first().click();
      ok(page.url() === route && await page.evaluate(() => window.__b10SameDocument === true), 'B10: course link opens in-app');
      await page.goto(`${O}/ultra/institution-page`); await page.waitForSelector('#gz-dash .gz-dash-edit');
      await page.click('#gz-dash .gz-dash-edit'); await page.waitForSelector('.gz-course-open');
      await page.click('.gz-course-open'); await page.waitForSelector('#gz-ccm[open] .gz-ccm-item');
      ok(await page.locator('#gz-ccm .gz-ccm-tools button.gz-w-main').count() === 0, 'B10: the Dashboard\'s dialog doesn\'t push Select all');
      await page.locator('#gz-ccm .gz-ccm-item .gz-ccm-pick').first().click();
      await page.waitForSelector(`${courseTile} .gz-course-card`); await stable();
      await page.keyboard.press('Escape'); await page.waitForSelector('#gz-ccm', { state: 'detached' });
      ok(await page.locator(courseTile).count() === 1, 'B10: Dashboard adds one chosen course');
      ok((await layout()).boards.courses.filter((x) => x.id.startsWith('course:')).length > 1, 'B10: Dashboard keeps the Courses layout');
      await page.mouse.move(0, 0); await shot(`b10-dash-${preset.toLowerCase()}-${width}`);
      await page.goto(`${O}/ultra/course`); await page.waitForSelector(courseTile);
      await page.click('#gz-toolbar .gz-dash-edit');
      while (await page.locator(courseTile).count()) await page.locator(`${courseTile} button[aria-label^="Remove "]`).first().click();
      ok(await page.evaluate(() => !document.documentElement.hasAttribute('data-gz-course-tiles') && getComputedStyle(document.querySelector('.course-columns')).display !== 'none'), 'B10: removing every card restores Ultra');
    }
    // The To Do resized by its corner keeps its height independently beside the course-card layout fields.
    const todoLayout = require('../lib/widgets.js').layout(base);
    for (const board of ['courses', 'dash']) todoLayout.boards[board].find((x) => x.id === 'todo').on = true;
    await store(settingsFor('Paper', { enhance: { ...G.GZ_DEFAULTS.enhance, notes: false, widgets: true, todo: true } }), { widgetLayout: todoLayout });
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto(`${O}/ultra/institution-page`); await page.waitForSelector(`${tile('todo')} #gz-todo`);
    await page.click('#gz-dash .gz-dash-edit');
    const tc = await page.locator(`${tile('todo')} .gz-w-resize`).boundingBox();
    await page.mouse.move(tc.x + 9, tc.y + 9); await page.mouse.down(); await page.mouse.move(tc.x + 9 + 40, tc.y + 9 + 160, { steps: 8 }); await page.mouse.up();
    await until(layout, (l) => Number.isInteger(l.boards.dash.find((x) => x.id === 'todo')?.h), 'To Do resize not saved');
    const todoH = (await layout()).boards.dash.find((x) => x.id === 'todo').h;
    ok(await page.locator(`${tile('todo')} > .gz-w-body`).evaluate((e, h) => e.style.height === `${h}px` && getComputedStyle(e).overflowY === 'auto', todoH), 'To Do: resized by its corner, its list scrolling inside');
    await page.reload(); await page.waitForSelector(`${tile('todo')} #gz-todo`);
    ok(await page.locator(`${tile('todo')} > .gz-w-body`).evaluate((e, h) => e.style.height === `${h}px`, todoH), 'To Do: resized height survives reload');
    await page.goto(`${O}/ultra/course`); await page.waitForSelector(`${tile('todo')} #gz-todo`);
    ok(await page.locator(`${tile('todo')} > .gz-w-body`).evaluate((e) => e.style.height === ''), 'To Do: Courses keeps its independent height');
    // A full board: unchanged passes must settle, and toggling Glaze must restore the native list exactly.
    await store(settingsFor('Paper', { enhance: { ...G.GZ_DEFAULTS.enhance, notes: false, widgets: true, todo: false, cardTasks: false, overall: false, newgrades: false, newcontent: false } }), { widgetLayout: base });
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto(`${O}/ultra/course`); await page.waitForSelector('#gz-toolbar');
    await page.evaluate(() => {
      const group = document.querySelector('.term-group'), sample = group.firstElementChild;
      group.replaceChildren(...Array.from({ length: 48 }, (_, i) => {
        const node = sample.cloneNode(true), card = node.querySelector('article');
        card.dataset.courseId = `_${101 + i}_1`; card.id = `course-list-course-_${101 + i}_1`;
        card.querySelector('.js-course-title-element').textContent = `Synthetic course ${i + 1}`;
        return node;
      }));
    });
    await page.click('#gz-toolbar .gz-dash-edit'); await page.waitForSelector('.gz-course-open');
    await stable(); const stressRequests = requests.length, started = Date.now();
    await page.click('.gz-course-open'); await page.waitForSelector('#gz-ccm[open] .gz-ccm-item');
    await page.click('#gz-ccm .gz-ccm-tools button.gz-w-main');
    await page.waitForSelector(`${courseTile} .gz-course-card`); await page.keyboard.press('Escape'); await stable();
    const stressMs = Date.now() - started;
    ok(await page.locator(courseTile).count() === 48 && (await layout()).boards.courses.filter((x) => x.id.startsWith('course:')).length === 48, `B10: 48-card board mounts and persists (${stressMs} ms including geometry settling)`);
    const writes = await page.evaluate(async () => {
      let n = 0; const observer = new MutationObserver((rs) => { n += rs.length; });
      observer.observe(document.querySelector('#gz-room'), { subtree: true, attributes: true, childList: true, characterData: true });
      await new Promise((r) => setTimeout(r, 1200)); observer.disconnect(); return n;
    });
    ok(writes === 0, `B10: 48 idle cards produce ${writes} DOM/style mutations in 1.2 seconds`);
    ok(requests.length === stressRequests, 'B10: 48-card mount starts no requests');
    await opts.evaluate(() => chrome.storage.sync.set({ card: { pet: 'cat', hover: 'grow', particles: 'snow' } }));
    await page.waitForSelector(`${courseTile} .gz-pet`);
    ok(await page.locator(`${courseTile} .gz-pet`).first().evaluate((e) => getComputedStyle(e).animationName === 'none'), 'B10: reduced motion stills the shared card pet');
    await page.evaluate(() => { document.documentElement.setAttribute('data-gz-motion', 'expressive'); document.documentElement.removeAttribute('data-gz-no-hover'); });
    await page.click('#gz-toolbar .gz-dash-edit'); // Done: hover is for cards in use
    await page.locator(`${courseTile} .gz-course-card`).first().hover();
    ok(await page.locator(`${courseTile} .gz-course-card`).first().evaluate((e) => getComputedStyle(e).transform !== 'none' && getComputedStyle(e, '::before').animationName === 'gz-card-fall'), 'B10: shared hover growth and particles reach board cards');
    await opts.evaluate(() => chrome.storage.sync.set({ enabled: false }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-course-tiles'));
    ok(await page.locator('article.course-element-card').count() === 48 && await page.locator(courseTile).count() === 0, 'B10: disabling Glaze restores all 48 untouched native cards');
    await opts.evaluate(() => chrome.storage.sync.set({ enabled: true }));
    await page.waitForSelector(`${courseTile} .gz-course-card`); await stable();
    ok(await page.locator(courseTile).count() === 48, 'B10: re-enabling restores the saved board');
    ok(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
  } finally {
    try { await ctx?.close(); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  console.log(`${fails ? 'FAILED' : 'passed'}; screenshots in ${out}`);
  process.exitCode = fails ? 1 : 0;
})();
