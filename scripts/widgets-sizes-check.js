// Every widget at every size, headless: the real extension on synthetic Ultra pages (the Dashboard board, tiles floating over a
// page, the sidebar dock) at small, medium and large, dragged small and dragged large, a 390 px phone, a light and a dark Look
// and right-to-left. Each tile is photographed and measured: nothing sticks out of it sideways, the parts it is for (the
// habitat and its main action, the clock and Start, ...) show without scrolling, the pet and its furniture stay inside the
// habitat, also after the tile is resized under them, and every pet action stays reachable. Nothing leaves the machine: Ultra's
// API is answered from test/fixtures, every other request is aborted and DNS is mapped to nowhere.
//   NODE_PATH=/path/to/node_modules nice -n 10 node scripts/widgets-sizes-check.js [out dir for screenshots]   (needs playwright)
// ONLY=<config name substring> runs part of it. One headless browser at a time across agents: it waits while another runs.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const G = require('../defaults.js');
const W = require('../lib/widgets.js');

const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://bb.school.test/*']);
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-widgets-sizes-'));
const O = 'https://bb.school.test', UID = '_900_1';
const fx = (n) => fs.readFileSync(path.join(__dirname, '..', 'test/fixtures', `ultra-${n}.json`), 'utf8');
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
let fails = 0, checks = 0;
const ok = (c, m, detail = '') => { checks++; console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${c || !detail ? '' : `  ${String(detail).slice(0, 600)}`}`); if (!c) fails++; };

const SHELL = (title, main, dir) => `<!doctype html><html lang="${dir === 'rtl' ? 'ar' : 'en'}" dir="${dir}"><head><base href="//ultra-cdn.invalid/ultra/uiv4001.0.0-rel/"><meta charset="utf-8"><title>${title}</title>
<style>
  body { margin: 0; font: 14px/1.45 "Open Sans", system-ui, sans-serif; }
  .MuiDrawer-paper { position: fixed; inset: 0 auto 0 0; width: 200px; background: #262626; }
  [dir="rtl"] .MuiDrawer-paper { inset: 0 0 0 auto; }
  .MuiDrawer-paper a { display: block; padding: 10px 24px; color: #fff; text-decoration: none; }
  #main-content-inner { padding-inline-start: 200px; }
  @media (max-width: 767px) { .MuiDrawer-paper { display: none; } #main-content-inner { padding-inline-start: 0; } }
  .base-header { padding: 24px 30px; border-bottom: 1px solid #d8d8d8; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
  h1#main-heading { margin: 0; font: 400 32px Georgia, serif; }
  .base-courses-content { display: flex; }
  .courses-panel { flex: 1; min-width: 0; padding: 24px 30px; }
  .term-group { display: flex; flex-wrap: wrap; gap: 16px; padding-bottom: 16px; }
  article.element-card { display: flex; flex-direction: column; height: 284px; width: 262px; border: 1px solid #ccc; box-sizing: border-box; }
  .course-banner { height: 128px; flex: none; background: linear-gradient(135deg, #2c5f8a, #6ab0de); }
  .element-details { padding: 8px 12px; }
  .todo-panel { width: 320px; flex: none; border-inline-start: 1px solid #d8d8d8; }
  .todo-panel aside { padding: 16px; }
  @media (max-width: 1000px) { .base-courses-content { flex-direction: column; } .todo-panel { width: auto; border: 0; } }
  .ip-app { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 24px 30px; }
  .ip-module { border: 1px solid #ccc; border-radius: 6px; padding: 16px; min-height: 140px; }
</style></head><body><div id="site-wrap">
<div class="MuiPaper-root MuiDrawer-paper"><nav class="makeStylesnavigation-1-2-3"><ul style="list-style:none;margin:0;padding:24px 0">
${[['/ultra/institution-page', 'Institution Page'], ['/ultra/stream', 'Activity'], ['/ultra/course', 'Courses']].map(([h, n]) => `<li><a class="MuiButtonBase-root MuiListItemButton-root" href="${h}">${n}</a></li>`).join('')}
</ul></nav></div>
<main id="main-content"><div id="main-content-inner">${main}</div></main></div></body></html>`;
const memberships = JSON.parse(fx('memberships')).results;
const COURSES = (dir) => SHELL('Courses', `<section class="base-courses-container route-view-container js-base-page-skip-link-target">
<div class="base-courses-header-container base-header"><h1 id="main-heading" class="page-title">Courses</h1><div class="base-header-tools"></div></div>
<div class="base-courses-content"><div class="courses-panel"><div class="base-courses"><div class="course-list"><section id="course-columns-allTerms" class="course-columns multi-column-view"><div class="course-org-list">
<h2 class="course-card-term-name">Fall 2026</h2><div class="term-group term-_2_1">
${memberships.slice(0, 4).map((x) => `<bb-base-course-card><article id="course-list-course-${x.courseId}" data-course-id="${x.courseId}" class="element-card course-element-card"><div class="course-banner"></div><div class="element-details summary"><div class="course-id">${x.course.courseId || ''}</div><h4 class="js-course-title-element">${x.course.name}</h4></div></article></bb-base-course-card>`).join('')}
</div></div></section></div></div></div>
<div class="todo-panel js-todo-panel-skip-link-target"><bb-todo class="react-container"><aside><h2>To Do</h2></aside></bb-todo></div></div></section>`, dir);
const INSTITUTION = (dir) => SHELL('Institution Page', `<section class="institution-page-container route-view-container">
<div class="black-panel-header base-header"><h1 id="main-heading" class="page-title">Institution Page</h1><div class="base-header-tools-transclude"></div></div>
<institution-page-home><div class="ip-app">${['Library hours', 'IT help desk'].map((n) => `<div class="ip-module"><h3>${n}</h3></div>`).join('')}</div></institution-page-home></section>`, dir);
const api = (u) => {
  const p = u.pathname;
  if (p.endsWith('/users/me')) return { id: UID, userName: 'student' };
  if (/\/memberships$/.test(p)) return JSON.parse(fx('memberships'));
  if (/calendars\/todo\/studentItems/.test(p)) return JSON.parse(fx('todo'));
  if (/calendars\/calendarItems/.test(p)) return JSON.parse(fx('calendar-items'));
  if (/gradebook\/grades$/.test(p)) return JSON.parse(fx('grades-status'));
  if (/\/terms$/.test(p)) return JSON.parse(fx('terms'));
  return { results: [] };
};

// The tiles: the built-in ones, the pet and a course card.
const COURSE = `course:${O}/_101_1`;
// Canvas's Dashboard, the way canvas-boards-check serves it: the saved Dashboard DOM under an invented school, synthetic API.
const CANVAS = 'https://board.school.instructure.com', CUID = '3', CCOURSE = `course:${CANVAS}/25`;
const CANVAS_FRAME = `<style>body { margin: 0; font: 14px/1.4 system-ui, sans-serif; }
  #header, #mobile-header, #breadcrumbs, #footer, #right-side, .ic-Layout-watermark { display: none; } #wrapper { margin: 0; }
  #main, #not_right_side, #content-wrapper, #content { min-width: 0; } #content { padding: 24px; } #dashboard_header_container { min-height: 64px; font-size: 24px; }
  .screenreader-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .ic-DashboardCard__box__container { display: flex; flex-wrap: wrap; gap: 16px; } .ic-DashboardCard { width: 260px; } .ic-DashboardCard__header_image { height: 120px; }
  @media (max-width: 600px) { #content { padding: 12px; } }</style>`;
const CANVAS_DASH = fs.readFileSync(path.join(__dirname, '..', 'test/fixtures/canvas-dashboard-cards.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '').replace('</head>', `${CANVAS_FRAME}</head>`);
const canvasApi = (u) => {
  if (u.pathname === '/api/v1/users/self/profile' || u.pathname === '/api/v1/users/self') return { id: CUID, time_zone: 'America/New_York' };
  if (u.pathname === '/api/v1/users/self/colors') return { custom_colors: {} };
  if (u.pathname === '/api/v1/courses') return [25, 26, 27, 28].map((id) => ({ id, name: `Course ${id}`, course_code: `C ${id}`, enrollments: [{ type: 'student', user_id: 3 }] }));
  return [];
};
// A widget made of blocks (docs/mods-widgets.md), installed and granted as the editor leaves one: a tile on the boards and a
// rail widget in Glaze's navigation, drawn by Glaze in a frame of its own.
const MOD = 'gzsizecheckmodaa', MODTILE = `m${MOD.slice(0, 14)}0`;
const MODREC = { id: MOD, enabled: true, grants: { todo: true }, manifest: { glaze: 1, name: 'Due soon', version: '1.0.0', author: { name: 'Kai', key: 'k' },
  permissions: [{ id: 'todo', why: 'Shows what is due next.' }],
  ui: { tiles: [{ id: 'main', name: 'Due soon', sizes: ['m'], blocks: [{ type: 'text', text: 'Next: {next.title}', size: 'l' }, { type: 'countdown', to: 'next.due', label: 'Due in' }, { type: 'list', items: 'todo.items', max: 3 }, { type: 'button', label: 'Open it', action: 'next' }] }],
    rail: [{ id: 'next', name: 'Next up', blocks: [{ type: 'text', text: '{next.title}' }, { type: 'countdown', to: 'next.due', label: 'Due in' }] }] } } };
const IDS = [...W.TILES, COURSE, MODTILE], CIDS = [...W.TILES, CCOURSE, MODTILE];
const tag = (id) => (id === COURSE || id === CCOURSE ? 'course' : id === MODTILE ? 'mod' : id);
// What each widget is for, which has to show without scrolling its tile.
const PRIMARY = {
  notes: ['.gz-w-note-view'], agenda: ['.gz-w-row'], timer: ['.gz-w-clock', '.gz-w-main'], quotes: ['.gz-w-quote'], music: ['form.gz-w-music input'],
  breathe: ['.gz-w-breath', '.gz-w-main'], buddy: ['.gz-w-pet'], todo: ['#gz-todo .gz-todo-head'], settings: ['.gz-w-body > button'],
  pet: ['.gz-game-habitat', '[data-control="pet"]', '[data-control="wander"]', '.gz-game-level'], course: [':is(.gz-course-card a, .ic-DashboardCard__header-title)'],
};
// Every action the habitat has, which has to be reachable at every size: in the tile, or through its More control.
const PET_ACTIONS = ['pet', 'wander', 'wear', 'sprite', 'habitat', 'physics', 'learning', 'forget', 'supply:ball', 'supply:books', 'books'];

// Sizes: a tile's size name, or the size the student dragged it to by its corner (w: its width, h: its body's height).
const SIZES = { s: { size: 's' }, m: { size: 'm' }, l: { size: 'l' }, ds: { size: 's', w: 200, h: 150 }, dl: { size: 'l', w: 680, h: 560 } };
const settingsFor = (preset, extra = {}) => G.GZ_SANITIZE({ preset, colors: { ...G.GZ_PRESETS.find(([n]) => n === preset)[1] }, ...extra,
  navbar: { ...G.GZ_DEFAULTS.navbar, on: false, ...extra.navbar }, enhance: { ...G.GZ_DEFAULTS.enhance, notes: true, widgets: true, todo: true, pet: true, dashboard: true, sidebar: false, ...extra.enhance } });
// A pet with its level-one furniture in its habitat (positions in percent of the habitat, as the student placed them).
const PET = { decor: { books: 4, shelf: 4, ball: 4, yarn: 4 }, positions: { books: { x: 82, y: 92 }, shelf: { x: 24, y: 40 }, ball: { x: 60, y: 94 }, yarn: { x: 12, y: 94 } }, habitat: 'room' };
const NOTE = { text: 'Read chapter 4 before the lab. Office hours: Tue 2pm, room 114. https://example.edu/syllabus', at: Date.now() };
// A Dashboard board with every tile on at one size, unplaced (the board puts each in free room); the rest of the layout fresh.
const MORE = { pet: { size: 'm' }, [MODTILE]: { size: 'm' } };
const board = (sz, ids = IDS, where = 'dash') => {
  const tiles = ids.map((id) => ({ id, on: true, size: sz.size, ...(sz.w && { w: sz.w }), ...(sz.h && { h: sz.h }) }));
  return W.layout({ todo: true, canvasTodo: true, filled: ['cdash', 'dash', 'courses'], tiles: W.TILES.map((id) => ({ id, on: false })), boards: { dash: [], courses: [], cdash: [], [where]: tiles } }, MORE);
};
// The same tiles floating over every page, each at its own spot.
const floating = (sz, ids, spots) => {
  const tiles = ids.map((id, i) => ({ id, on: true, size: sz.size, x: spots[i][0], y: spots[i][1], ...(sz.w && { w: sz.w }), ...(sz.h && { h: sz.h }) }));
  return W.layout({ todo: true, canvasTodo: true, filled: ['cdash', 'dash', 'courses'], tiles: W.TILES.map((id) => ({ id, on: false })), boards: { dash: [], courses: [], cdash: [], pages: tiles } }, MORE);
};

// In the page: each tile's problems. A part out of the tile sideways (or out of its body, which scrolls only up and down), a
// primary part not in view, a pet or furniture outside the habitat.
const MEASURE = ({ PRIMARY, PET_ACTIONS, COURSES, MODTILE }) => {
  const seen = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  // A CSS color as the screen shows it (a canvas reads any syntax), and the WCAG contrast of two.
  const ink = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgb = (c) => { ink.clearRect(0, 0, 1, 1); ink.fillStyle = '#000'; ink.fillStyle = c; ink.fillRect(0, 0, 1, 1); return [...ink.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (c) => rgb(c).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const name = (e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${e.className && typeof e.className === 'string' ? `.${e.className.trim().split(/\s+/).join('.')}` : ''}`;
  return [...document.querySelectorAll('section.gz-w')].filter((el) => seen(el) && !el.hidden).map((el) => {
    const id = COURSES.includes(el.dataset.tile) ? 'course' : el.dataset.tile === MODTILE ? 'mod' : el.dataset.tile, r = el.getBoundingClientRect(), body = el.querySelector(':scope > .gz-w-body');
    const problems = [];
    // Its name on one line (cut short with an ellipsis if it must), not wrapped beside its tools.
    const h3 = el.querySelector(':scope > .gz-w-head h3');
    if (h3) { const range = document.createRange(); range.selectNodeContents(h3); const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size; if (lines > 1) problems.push(`its name wraps onto ${lines} lines`); }
    // A mod's frame: Glaze draws its blocks in a closed shadow root, whose overflow still shows on the frame.
    const frame = id === 'mod' && body?.querySelector(':scope > div');
    if (frame && frame.scrollWidth > frame.clientWidth + 1) problems.push(`the mod's frame overflows (${frame.scrollWidth} > ${frame.clientWidth})`);
    // Its blocks are the mod's: a long list scrolls in a short tile, as any long content does, but it starts in view.
    if (id === 'mod' && (!frame || frame.getBoundingClientRect().top > body.getBoundingClientRect().top + 1 || !frame.getBoundingClientRect().height)) problems.push("the mod's frame is missing or not at the top");
    if (el.scrollWidth > el.clientWidth + 1) problems.push(`the tile scrolls sideways (${el.scrollWidth} > ${el.clientWidth})`);
    if (body && !body.hidden) {
      const v = body.getBoundingClientRect();
      if (body.scrollWidth > body.clientWidth + 1) problems.push(`its body scrolls sideways (${body.scrollWidth} > ${body.clientWidth})`);
      const out = [];
      for (const d of body.querySelectorAll('*')) {
        if (!seen(d) || d.closest('.gz-game-habitat, .gz-sr, .screenreader-only, [class*="sr-only"]') || d.matches('option')) continue;
        // Inside something of its own that scrolls sideways (a tray): that one is measured instead.
        let inner = false;
        for (let n = d.parentElement; n && n !== body; n = n.parentElement) { if (/auto|scroll|hidden|clip/.test(getComputedStyle(n).overflowX)) { inner = true; break; } }
        if (inner) continue;
        const b = d.getBoundingClientRect();
        if (!b.width && !b.height) continue;
        if (b.left < v.left - 1 || b.right > v.right + 1) out.push(`${name(d)} ${Math.round(b.left - v.left)}..${Math.round(b.right - v.left)} of ${Math.round(v.width)}`);
      }
      if (out.length) problems.push(`sticks out sideways: ${out.slice(0, 4).join('; ')}${out.length > 4 ? ` (+${out.length - 4})` : ''}`);
      for (const sel of PRIMARY[id] || []) {
        const p = el.querySelector(sel);
        if (!p || !seen(p)) { problems.push(`no ${sel}`); continue; }
        const b = p.getBoundingClientRect();
        if (b.top < v.top - 1 || b.bottom > v.bottom + 1 || b.left < v.left - 1 || b.right > v.right + 1) problems.push(`${sel} is not in view without scrolling (${Math.round(b.top - v.top)}..${Math.round(b.bottom - v.top)} of ${Math.round(v.height)})`);
      }
    }
    // Primary buttons: their text against their fill, at least 4.5:1 (WCAG AA), in whatever Look.
    for (const b of el.querySelectorAll('.gz-w-main, .gz-game-primary')) {
      if (!seen(b)) continue;
      const cs = getComputedStyle(b), ratio = contrast(cs.color, cs.backgroundColor);
      if (ratio < 4.5) problems.push(`"${b.textContent.trim()}" has ${ratio.toFixed(2)}:1 contrast (${cs.color} on ${cs.backgroundColor})`);
    }
    let stage = null;
    if (id === 'pet') {
      const s = el.querySelector('.gz-game-habitat');
      if (s) {
        const a = s.getBoundingClientRect();
        stage = { w: Math.round(a.width), h: Math.round(a.height), body: body && Math.round(body.getBoundingClientRect().height) };
        // It fills the tile's width, or beside the controls in a very wide tile, more than half of it.
        const room = body.clientWidth;
        if (room < 600 ? a.width < room - 2 : a.width < room * .55) problems.push(`the habitat is ${Math.round(a.width)} px wide in ${room} px of room`);
        for (const p of s.querySelectorAll('.gz-game-item, .gz-game-actor')) {
          if (!seen(p)) continue;
          const b = p.getBoundingClientRect();
          if (b.left < a.left - 1 || b.right > a.right + 1 || b.top < a.top - 1 || b.bottom > a.bottom + 1) problems.push(`${p.dataset.item || 'the pet'} is outside the habitat (${Math.round(b.left - a.left)},${Math.round(b.top - a.top)} ${Math.round(b.width)}×${Math.round(b.height)} in ${Math.round(a.width)}×${Math.round(a.height)})`);
        }
      }
      // Reachable: shown, in a panel whose tab shows, in a section whose heading shows, or through ⋯ (the whole habitat).
      const more = [...el.querySelectorAll('[data-control="more"]')].some(seen);
      const outer = (e) => { let d = null; for (let n = e.closest('details'); n && el.contains(n); n = n.parentElement.closest('details')) d = n; return d; };
      const tab = (e) => { const p = e.closest('[data-panel]'); return p && el.querySelector(`[data-control="tab:${p.dataset.panel}"]`); };
      const reach = (c) => [...el.querySelectorAll('[data-control]')].filter((e) => e.dataset.control === c).some((e) => seen(e) || (tab(e) && seen(tab(e))) || (outer(e) && seen(outer(e).querySelector(':scope > summary')) && (!tab(e) || seen(tab(e)))));
      const missing = PET_ACTIONS.filter((c) => !reach(c));
      if (!more) problems.push('no ⋯');
      if (missing.length && !more) problems.push(`actions not reachable: ${missing.join(', ')}`);
      // The tier its body's room calls for: the panels' tabs only with room (not narrow, not short in one column).
      const bw = body.clientWidth, bh = body.clientHeight, fixed = !!body.style.height, tabs = [...el.querySelectorAll('.gz-game-tab')].some(seen);
      const compact = bw < 300 || (fixed && bh < 520 && (bw < 600 || bw / bh < 1.5));
      if (compact === tabs) problems.push(`${tabs ? 'tabs' : 'no tabs'} in ${bw} × ${fixed ? bh : 'auto'}`);
      // Never mostly wall: the room is at most about two-thirds as tall as it is wide.
      const a = el.querySelector('.gz-game-habitat')?.getBoundingClientRect();
      if (a && a.height > a.width * .66 + 2) problems.push(`the room is ${Math.round(a.width)} × ${Math.round(a.height)}, mostly wall`);
    }
    return { id, w: Math.round(r.width), h: Math.round(r.height), problems, stage };
  });
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-widgets-sizes-'));
  let ctx;
  const errors = [];
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    let dir = 'ltr';
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === CANVAS && route.request().method() === 'GET') {
        if (u.pathname.startsWith('/api/v1/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(canvasApi(u)) });
        return u.pathname === '/' ? route.fulfill({ contentType: 'text/html', body: CANVAS_DASH }) : route.abort();
      }
      if (u.origin !== O || route.request().method() !== 'GET') return route.abort();
      if (u.pathname.startsWith('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(api(u)) });
      const page = { '/ultra/course': COURSES, '/ultra/institution-page': INSTITUTION }[u.pathname];
      return page ? route.fulfill({ contentType: 'text/html', body: page(dir) }) : route.fulfill({ status: 404, body: '' });
    });
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    const store = (s, local) => opts.evaluate(async ([s, local]) => {
      await chrome.storage.sync.clear(); await chrome.storage.sync.set(s);
      await chrome.storage.local.clear(); await chrome.storage.local.set(local);
    }, [s, local]).then(() => require('./check-env.js').ultraReady(opts));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.stack || String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|ERR_FAILED|404/.test(msg.text())) errors.push(msg.text()); });
    const settle = async () => {
      let last = '', same = 0;
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        const v = await page.evaluate(() => JSON.stringify([...document.querySelectorAll('section.gz-w')].map((e) => [e.dataset.tile, ...['x', 'y', 'width', 'height'].map((k) => Math.round(e.getBoundingClientRect()[k]))])));
        same = v === last ? same + 1 : 0; last = v;
        if (same >= 6) return;
        await page.waitForTimeout(100);
      }
    };
    // What is due, as Glaze keeps it from the planner (the mod's blocks and What's next read it).
    const HOUR = 36e5, due = (o, u) => ({ key: `todo:${o}/${u}`, at: Date.now(), items: [
      { type: 'assignment', id: '9', cid: '_101_1', course: 'BIO 1100: Biology I', title: 'Lab report 4: enzyme kinetics', at: Date.now() + 3 * HOUR, url: '/ultra/stream' },
      { type: 'assignment', id: '10', cid: '_102_1', course: 'ENG 1100: College Writing', title: 'Essay outline', at: Date.now() + 30 * HOUR, url: '/ultra/stream' }] });
    const local = (layout, sidebar) => ({ ultra: [O], widgetLayout: layout, mods: [MOD], [`mod:${MOD}`]: MODREC, todoCache: due(O, UID),
      ...Object.fromEntries([[O, UID], [CANVAS, CUID]].flatMap(([o, u]) => [[`notes:${o}/${u}`, NOTE], [`pet:${o}/${u}`, PET]])), ...(sidebar && { [`sidebar:ultra:${O}/${UID}`]: sidebar }) });
    const results = [];
    // One configuration: its settings and layout stored, the page opened, every tile measured and photographed.
    const run = async ({ name, preset = 'Paper', width = 1600, height = 2600, site = O, where = '/ultra/institution-page', layout, sidebar, rtl = false, sel = '#gz-dash section.gz-w', expect, after }) => {
      if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
      dir = rtl ? 'rtl' : 'ltr';
      await store(settingsFor(preset, sidebar ? { enhance: { sidebar: true } } : {}), local(layout, sidebar));
      await page.setViewportSize({ width, height });
      await page.goto(`${site}${where}`);
      // Now and then the first load after a storage reset draws no board; once more, said, before it counts as a failure.
      if (!await page.waitForSelector(sel, { timeout: 20000 }).catch(() => null)) { console.log(`note ${name}: no tiles on the first load; loading again`); await page.reload(); await page.waitForSelector(sel, { timeout: 20000 }).catch(() => {}); }
      await page.waitForSelector('section.gz-w[data-tile="pet"] .gz-game-actor', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(900); // the agenda, the notes, To Do and the course card arrive
      await settle();
      // Ultra's page scrolls inside its main, where a photo of a tile below the fold comes out blank: a window as tall as the page.
      const tall = await page.evaluate(() => Math.ceil(Math.max(innerHeight, ...[...document.querySelectorAll('section.gz-w')].map((e) => { let y = e.getBoundingClientRect().bottom; for (let n = e.parentElement; n; n = n.parentElement) y += n.scrollTop || 0; return y; })) + 120));
      if (tall > height) { await page.setViewportSize({ width, height: Math.min(tall, 16000) }); await settle(); }
      if (process.env.PROBE) console.log(JSON.stringify(await require(process.env.PROBE)(page), null, 1));
      const tiles = await page.evaluate(MEASURE, { PRIMARY, PET_ACTIONS, COURSES: [COURSE, CCOURSE], MODTILE });
      ok(tiles.length === expect, `${name}: ${tiles.length} of ${expect} widgets drawn`, tiles.map((x) => x.id).join(', '));
      await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
      for (const id of [...IDS, CCOURSE]) {
        const loc = page.locator(`section.gz-w[data-tile="${id}"]`).first();
        if (await loc.count() && await loc.isVisible()) await loc.screenshot({ path: path.join(out, `${name}-${tag(id)}.png`) }).catch(() => {});
      }
      for (const x of tiles) {
        ok(!x.problems.length, `${name} ${x.id} (${x.w}×${x.h})`, x.problems.join(' | '));
        results.push({ config: name, ...x });
      }
      ok(!errors.length, `${name}: no page errors`, errors.splice(0).join(' | '));
      if (after) await after();
    };

    for (const [preset, look] of [['Paper', 'light'], ['Midnight', 'dark']]) {
      for (const [sz, def] of Object.entries(SIZES)) await run({ name: `board-${sz}-${look}`, preset, layout: board(def), expect: IDS.length });
      await run({ name: `phone-m-${look}`, preset, width: 390, height: 2400, layout: board(SIZES.m), expect: IDS.length });
    }
    // Canvas's Dashboard: the same widgets on its board, with a Canvas course card.
    for (const [sz, look, preset, width] of [['m', 'light', 'Paper', 1600], ['ds', 'light', 'Paper', 1600], ['dl', 'dark', 'Midnight', 1600], ['m', 'phone', 'Paper', 390]]) {
      await run({ name: `canvas-${sz}-${look}`, preset, width, site: CANVAS, where: '/', layout: board(SIZES[sz], CIDS, 'cdash'), sel: '#gz-dash[data-board="cdash"] section.gz-w', expect: CIDS.length });
    }
    // The other Looks at one size: what changes with a Look is color, and every primary button must read in each.
    for (const preset of G.GZ_PRESETS.map(([n]) => n).filter((n) => !['Paper', 'Midnight'].includes(n))) await run({ name: `look-${preset.toLowerCase()}-m`, preset, layout: board(SIZES.m), expect: IDS.length });
    for (const sz of ['m', 'ds']) await run({ name: `board-${sz}-rtl`, rtl: true, layout: board(SIZES[sz]), expect: IDS.length });
    // Floating: four at a time, one in each corner of the window.
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
    // To Do has no floating place (lib/widgets.js dests), nor does a course card.
    const floaters = IDS.filter((id) => id !== 'todo' && id !== COURSE), groups = [floaters.slice(0, 4), floaters.slice(4, 8), floaters.slice(8)];
    for (const sz of ['s', 'ds']) for (const [i, ids] of groups.entries()) await run({ name: `float-${sz}-${i + 1}`, width: 1600, height: 1000, layout: floating(SIZES[sz], ids, corners), sel: '#gz-float section.gz-w', expect: ids.length });
    // The sidebar dock, at its narrowest and widest, with every widget in it (To Do follows its own place there).
    for (const sw of [288, 480]) {
      const ids = W.TILES;
      const rec = { v: 1, rev: 1, mig: 1, width: sw, chose: { width: true }, dock: ids.map((id) => ({ id, ...(sw === 288 && id === 'pet' && { h: 220 }) })), dest: Object.fromEntries(ids.map((id) => [id, 'dock'])) };
      await run({ name: `dock-${sw}`, where: '/ultra/course', layout: board(SIZES.s, []), sidebar: rec, sel: '#gz-sb-widgets section.gz-w', height: 3200, expect: ids.length });
    }

    // The habitat resized under the pet: a large tile made small (as a corner drag or another tab's change does), then large.
    if (!process.env.ONLY || 'resize'.includes(process.env.ONLY)) {
      dir = 'ltr';
      await store(settingsFor('Paper'), local(board(SIZES.dl, ['pet'])));
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(`${O}/ultra/institution-page`);
      await page.waitForSelector('section.gz-w[data-tile="pet"] .gz-game-item', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const inside = () => page.evaluate(() => {
        const s = document.querySelector('section.gz-w[data-tile="pet"] .gz-game-habitat'), a = s.getBoundingClientRect();
        return { stage: [Math.round(a.width), Math.round(a.height)], outside: [...s.querySelectorAll('.gz-game-item, .gz-game-actor')].filter((p) => p.getClientRects().length).map((p) => { const b = p.getBoundingClientRect(); return b.left < a.left - 1 || b.right > a.right + 1 || b.top < a.top - 1 || b.bottom > a.bottom + 1 ? `${p.dataset.item || 'pet'} ${Math.round(b.left - a.left)},${Math.round(b.top - a.top)}` : null; }).filter(Boolean) };
      });
      const large = await inside();
      ok(!large.outside.length, `resize: large habitat ${large.stage.join('×')} holds the pet and furniture`, large.outside.join(', '));
      const relative = () => page.evaluate(() => {
        const s = document.querySelector('section.gz-w[data-tile="pet"] .gz-game-habitat'), a = s.getBoundingClientRect();
        return Object.fromEntries([...s.querySelectorAll('.gz-game-item')].map((p) => { const b = p.getBoundingClientRect(); return [p.dataset.item, [(b.left + b.width / 2 - a.left) / a.width, (b.bottom - a.top) / a.height]]; }));
      });
      const before = await relative();
      for (const [w, h] of [[220, 180], [680, 560]]) {
        await opts.evaluate(async ([w, h]) => {
          const l = (await chrome.storage.local.get('widgetLayout')).widgetLayout;
          l.boards.dash = l.boards.dash.map((x) => (x.id === 'pet' ? { ...x, w, h } : x));
          await chrome.storage.local.set({ widgetLayout: l });
        }, [w, h]);
        await page.waitForTimeout(1500);
        const now = await inside();
        await page.locator('section.gz-w[data-tile="pet"]').screenshot({ path: path.join(out, `resize-pet-${w}x${h}.png`) }).catch(() => {});
        ok(!now.outside.length, `resize: after ${w}×${h} the habitat ${now.stage.join('×')} still holds the pet and furniture`, now.outside.join(', '));
        const rel = await relative();
        const drift = Object.entries(before).map(([k, [x, y]]) => [k, Math.max(Math.abs(x - (rel[k]?.[0] ?? 9)), Math.abs(y - (rel[k]?.[1] ?? 9)))]).filter(([, d]) => d > 0.08);
        ok(!drift.length, `resize: after ${w}×${h} furniture keeps its place relative to the habitat`, drift.map(([k, d]) => `${k} moved ${Math.round(d * 100)}%`).join(', '));
      }
      ok(!errors.length, 'resize: no page errors', errors.splice(0).join(' | '));
    }

    // More, from a small tile: the whole habitat in its dialog, on screen and outside the tile, with every action; Escape closes
    // it and gives the focus back. At a desktop window and a phone's.
    for (const [w, h] of [[1600, 1000], [390, 844]]) {
      if (process.env.ONLY && !'more'.includes(process.env.ONLY)) break;
      dir = 'ltr';
      await store(settingsFor('Paper'), local(board(SIZES.ds, ['pet'])));
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${O}/ultra/institution-page`);
      const ready = () => page.waitForSelector('section.gz-w[data-tile="pet"] [data-control="more"]', { state: 'visible', timeout: 20000 }).catch(() => null);
      if (!await ready()) { console.log(`note More at ${w} px: no habitat on the first load; loading again`); await page.reload(); await ready(); }
      await page.click('section.gz-w[data-tile="pet"] [data-control="more"]').catch(() => {});
      await page.waitForSelector('dialog.gz-game-dialog[open] .gz-game-habitat', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
      const d = await page.evaluate((actions) => {
        const box = document.querySelector('dialog.gz-game-dialog[open]');
        if (!box) return null;
        const r = box.getBoundingClientRect(), tile = document.querySelector('section.gz-w[data-tile="pet"]');
        const ids = new Set([...box.querySelectorAll('[data-control]')].map((e) => e.dataset.control));
        return { onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, outside: !tile.contains(box),
          missing: actions.filter((c) => !ids.has(c)), more: ids.has('more'), stage: box.querySelector('.gz-game-habitat').getBoundingClientRect().width, width: r.width };
      }, PET_ACTIONS);
      await page.screenshot({ path: path.join(out, `more-dialog-${w}.png`) });
      ok(d?.onScreen && d.outside, `More at ${w} px: the habitat opens in its dialog, on screen, outside the tile`, JSON.stringify(d));
      ok(d && !d.missing.length && !d.more, `More at ${w} px: the dialog has every action and no More`, JSON.stringify(d));
      ok(d && d.stage >= d.width * .8, `More at ${w} px: the dialog's habitat fills it`, JSON.stringify(d));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      ok(await page.evaluate(() => !document.querySelector('dialog.gz-game-dialog') && document.activeElement?.dataset.control === 'more'), `More at ${w} px: Escape closes it and the focus is back on More`);
      ok(!errors.length, `More at ${w} px: no page errors`, errors.splice(0).join(' | '));
    }
    // Glaze's navigation widgets (features/navbar-widgets.js) and the mod's rail widget, in each place the bar shows them: the
    // open rail, the icons rail, the top bar and its widgets dock, and a phone's More sheet and its dock. Each fits its place and
    // the window, nothing in it scrolls or is cut sideways without an ellipsis.
    const NAV = () => {
      const r = document.getElementById('gz-navbar')?.shadowRoot;
      if (!r) return null;
      const seen = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
      return [...r.querySelectorAll('.widget, .gz-mod-rail')].filter(seen).map((w) => {
        const b = w.getBoundingClientRect(), place = w.closest('.dock, .sheet, .topbar, .rail'), a = place?.getBoundingClientRect(), problems = [];
        if (b.left < -1 || b.right > innerWidth + 1 || b.top < -1 || b.bottom > innerHeight + 1) problems.push(`off the window (${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}×${Math.round(b.height)})`);
        if (a && (b.left < a.left - 1 || b.right > a.right + 1)) problems.push(`out of its ${place.className.split(' ')[0]} sideways (${Math.round(b.left - a.left)}..${Math.round(b.right - a.left)} of ${Math.round(a.width)})`);
        if (w.scrollWidth > w.clientWidth + 1) problems.push(`scrolls sideways (${w.scrollWidth} > ${w.clientWidth})`);
        const inner = w.classList.contains('gz-mod-rail') && w.firstElementChild?.getBoundingClientRect();
        if (inner && (inner.left - b.left < 4 || b.right - inner.right < 4)) problems.push(`its content touches its edge (${Math.round(inner.left - b.left)} px in)`);
        for (const d of w.querySelectorAll('.w-detail')) if (seen(d) && d.scrollWidth > d.clientWidth + 1 && w.dataset.w === 'clock') problems.push('the date is cut short');
        for (const d of w.querySelectorAll('*')) {
          if (!seen(d)) continue;
          const cs = getComputedStyle(d);
          if (/hidden|clip/.test(cs.overflowX) && d.scrollWidth > d.clientWidth + 1 && cs.textOverflow !== 'ellipsis') problems.push(`${d.className || d.tagName} is cut (${d.scrollWidth} > ${d.clientWidth})`);
        }
        return { w: w.dataset.w || 'mod', place: place?.className.split(' ')[0] || '?', size: `${Math.round(b.width)}×${Math.round(b.height)}`, problems };
      });
    };
    const bar = (fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gz-navbar')?.shadowRoot, a), [String(fn), arg]);
    const navItems = { widgets: [{ id: 'clock', at: 'top' }, { id: 'next', at: 'bottom' }, { id: 'timer', at: 'bottom' }, { id: 'pet', at: 'bottom' }] };
    for (const [name, width, height, navbar, open, want] of [
      ['nav-rail', 1600, 1000, { on: true, place: 'rail', rail: 'open' }, null, 5],
      ['nav-icons', 1600, 1000, { on: true, place: 'rail', rail: 'icons' }, null, 4],
      ['nav-top', 1600, 1000, { on: true, place: 'top' }, (r) => r.querySelector('.tdock')?.click(), 5],
      ['nav-phone-sheet', 390, 844, { on: true }, (r) => r.querySelector('.tab.more')?.click(), 4],
      ['nav-phone-dock', 390, 844, { on: true }, (r) => { r.querySelector('.tab.more')?.click(); r.querySelector('.sheet [data-act="widgets"]')?.click(); }, 1],
    ]) {
      if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
      dir = 'ltr';
      await store({ ...settingsFor('Paper', { navbar }), navbarItems: navItems }, local(board(SIZES.m, ['notes'])));
      await page.setViewportSize({ width, height });
      await page.goto(`${O}/ultra/institution-page`);
      const drawn = () => page.waitForFunction(() => document.getElementById('gz-navbar')?.shadowRoot?.querySelector('.widget'), null, { timeout: 20000 }).catch(() => null);
      if (!await drawn()) { console.log(`note ${name}: no navigation on the first load; loading again`); await page.reload(); await drawn(); }
      await page.waitForTimeout(1200); // the mod's rail widget and what is due arrive
      if (open) { await bar(open); await page.waitForTimeout(600); }
      const items = await page.evaluate(NAV);
      await page.screenshot({ path: path.join(out, `${name}.png`) });
      ok(items && items.length >= want, `${name}: ${items?.length ?? 0} widgets shown (want ${want} or more)`, JSON.stringify(items?.map((x) => `${x.w}@${x.place}`)));
      for (const x of items || []) ok(!x.problems.length, `${name} ${x.w} in the ${x.place} (${x.size})`, x.problems.join(' | '));
      ok(!errors.length, `${name}: no page errors`, errors.splice(0).join(' | '));
    }
    fs.writeFileSync(path.join(out, 'measures.json'), JSON.stringify(results, null, 1));
  } catch (e) {
    ok(false, 'the check ran to its end', e.stack || e);
  } finally {
    try { await ctx?.close(); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  console.log(`${fails ? 'FAIL' : 'ok'}: ${checks - fails}/${checks} widget size checks passed; screenshots in ${out}`);
  process.exitCode = fails ? 1 : 0;
})();
