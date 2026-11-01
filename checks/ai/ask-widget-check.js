// The Ask Rime widget in a real Chromium (ai/page/ask-tile.js, ai/page/ask-chat.js, core/page/widgets.js MORE 'ask'),
// headless, in a staged copy of the extension whose worker carries a stub engine (as checks/ai/ask-check.js), on the
// synthetic Canvas Dashboard and Blackboard Ultra pages checks/core/widgets-sizes-check.js serves: the tile on Canvas's
// Dashboard and Ultra's, floating over a page on both, small and large, light, dark and solid, at 1280 and 320 px. In the
// tile: an answer, the context meter in its three bands, turns folded into a summary line opened to read it, Motion off
// moving nothing, and ⌘K's Ask Rime focusing the tile where it is shown (the dialog only where it isn't, a folded tile).
// Nothing leaves the machine. Screenshots ask-widget-<site>-<where>-<what>-<width>-<look>.png.
//   glaze-remote -e TZ=UTC -o <evidence dir> -- node checks/ai/ask-widget-check.js /out
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../../tools/dev/check-env.js');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const G = require(path.join(root, 'content/defaults.js'));
const W = require(path.join(root, 'core/widgets.js'));
const O = 'https://bb.school.test', UID = '_900_1';
const fx = (n) => fs.readFileSync(path.join(__dirname, '../../test/fixtures', `ultra-${n}.json`), 'utf8');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
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


const CANVAS = 'https://board.school.instructure.com', CUID = '3';
const CANVAS_FRAME = `<style>body { margin: 0; font: 14px/1.4 system-ui, sans-serif; }
  #header, #mobile-header, #breadcrumbs, #footer, #right-side, .ic-Layout-watermark { display: none; } #wrapper { margin: 0; }
  #main, #not_right_side, #content-wrapper, #content { min-width: 0; } #content { padding: 24px; } #dashboard_header_container { min-height: 64px; font-size: 24px; }
  .screenreader-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .ic-DashboardCard__box__container { display: flex; flex-wrap: wrap; gap: 16px; } .ic-DashboardCard { width: 260px; } .ic-DashboardCard__header_image { height: 120px; }
  @media (max-width: 600px) { #content { padding: 12px; } }</style>`;
const CANVAS_DASH = fs.readFileSync(path.join(__dirname, '../../test/fixtures/canvas-dashboard-cards.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '').replace('</head>', `${CANVAS_FRAME}</head>`);
const canvasApi = (u) => {
  if (u.pathname === '/api/v1/users/self/profile' || u.pathname === '/api/v1/users/self') return { id: CUID, time_zone: 'America/New_York' };
  if (u.pathname === '/api/v1/users/self/colors') return { custom_colors: {} };
  if (u.pathname === '/api/v1/courses') return [25, 26, 27, 28].map((id) => ({ id, name: `Course ${id}`, course_code: `C ${id}`, enrollments: [{ type: 'student', user_id: 3 }] }));
  return [];
};

const SHIM = `
globalThis.askCheck = { script: {}, seen: [] };
ai();
if (!GZ_AI_SETTINGS.PROVIDERS.includes('stub')) GZ_AI_SETTINGS.PROVIDERS.push('stub');
GZ_AI_PROVIDERS.add({ id: 'stub', config: (raw) => (raw && typeof raw === 'object' ? { ...raw } : null), caps: () => ({ text: true, json: true, context: globalThis.askCheck?.window || 4096 }), status: async () => ({ state: 'ready' }),
  run: async (req) => {
    const task = req.task?.id, next = (askCheck.script[task] || []).shift();
    const text = req.messages.map((m) => [].concat(m.content).map((c) => (typeof c === 'string' ? c : c.text || '')).join('')).join('\\n');
    const mark = /\\[result \\d+ todo_mark_done[^\\]]*\\]\\n<<<(DATA-[0-9a-f]+)\\n([\\s\\S]*?)\\n>>>\\1/.exec(text);
    askCheck.seen.push({ task, steps: (text.match(/\\[result \\d+ /g) || []).length, ...(mark && { mark: JSON.parse(mark[2]) }) });
    if (!next) throw Object.assign(new Error('script'), { category: 'invalid-response' });
    // { wait, out }: the answer after wait ms (a run caught mid-way for its screenshot).
    if (next.wait) await new Promise((r) => setTimeout(r, next.wait));
    let out = next.wait ? next.out : next;
    // { mark: title }: mark the to-do of that title done, by the type and id the last to-do list gave.
    if (next.mark) {
      const lists = [...text.matchAll(/\\[result \\d+ todo_list[^\\]]*\\]\\n<<<(DATA-[0-9a-f]+)\\n([\\s\\S]*?)\\n>>>\\1/g)];
      const item = lists.length ? JSON.parse(lists.at(-1)[2]).items?.find((i) => String(i.title).includes(next.mark)) : null;
      out = { call: { name: 'todo_mark_done', arguments: item ? { type: item.type, id: String(item.id) } : {} }, answer: null };
    }
    return { text: JSON.stringify(out), model: 'stub', finish: 'stop' };
  } });
globalThis.glazeIn = async (url) => {
  const [t] = (await chrome.tabs.query({})).filter((x) => x.url === url);
  if (!t) return { on: false };
  const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id, frameIds: [0] }, func: () => ({ on: !!globalThis.GZ_CTX?.on() }) });
  return r?.result;
};
`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(100); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
let total = 0, failed = 0;
const results = [];
const check = async (name, test) => {
  total++;
  try { const evidence = await test(); results.push({ name, ok: true, evidence }); console.log(`ok ${name}`); }
  catch (e) { failed++; results.push({ name, ok: false, error: e.stack }); console.error(`FAIL ${name}: ${e.stack}`); }
};
const LOOKS = { light: ['Paper', 'gradient'], dark: ['Midnight', 'gradient'], solid: ['Paper', 'solid'] };
const settingsFor = (look, motion = 'normal') => {
  const [preset, bg] = LOOKS[look];
  return G.GZ_SANITIZE({ preset, colors: { ...G.GZ_PRESETS.find(([n]) => n === preset)[1] }, bg: { kind: bg }, motion: { level: motion, followSystem: false }, footer: false,
    navbar: { ...G.GZ_DEFAULTS.navbar, on: false }, enhance: { ...G.GZ_DEFAULTS.enhance, notes: true, widgets: true, dashboard: true, todo: false, pet: false, sidebar: false, palette: true } });
};
const AI = { on: true, model: { use: 'custom-1', model: 'stub' }, features: { ask: true } };
// Layouts: the tile on a board (Canvas's cdash, Ultra's dash) or floating (Canvas's tiles, Ultra's pages), the rest off.
const MORE = { ask: { size: 'l' } };
const lay = (where, size) => {
  const tile = { id: 'ask', on: true, size };
  return W.layout({ todo: true, canvasTodo: true, filled: ['cdash', 'dash', 'courses'],
    tiles: [...W.TILES.map((id) => ({ id, on: false })), ...(where === 'cfloat' ? [{ ...tile, float: true, x: 0.62, y: 0.08 }] : [{ id: 'ask', on: false }])],
    boards: { dash: where === 'dash' ? [tile] : [], courses: [], cdash: where === 'cdash' ? [tile] : [], pages: where === 'pages' ? [{ ...tile, x: 0.6, y: 0.08 }] : [] } }, MORE);
};

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ask-widget-'));
  const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'gz-ask-widget'));
  fs.mkdirSync(out, { recursive: true });
  const lock = env.lockPath();
  let context, held = false;
  try {
    while (!held) { try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); } }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nask-widget-check\n`);
    const ext = require('../../tools/dev/check-env.js').staged(root, [`${O}/*`], scratch);
    const worker0 = fs.readFileSync(path.join(ext, 'background/background.js'), 'utf8');
    fs.rmSync(path.join(ext, 'background/background.js'));
    fs.writeFileSync(path.join(ext, 'background/background.js'), worker0 + SHIM);
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...env.chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    env.noFirstRun(context);
    context.setDefaultTimeout(15000);
    const errors = [], refused = [];
    await context.route('**/*', (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      const json = (b) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
      if (u.origin === CANVAS && req.method() === 'GET') return u.pathname.startsWith('/api/v1/') ? json(canvasApi(u)) : r.fulfill({ contentType: 'text/html', body: CANVAS_DASH });
      if (u.origin === O && req.method() === 'GET') {
        if (u.pathname.startsWith('/learn/api/')) return json(api(u));
        const page = { '/ultra/course': COURSES, '/ultra/institution-page': INSTITUTION }[u.pathname];
        return page ? r.fulfill({ contentType: 'text/html', body: page('ltr') }) : r.fulfill({ status: 404, body: '' });
      }
      if (!/\.invalid$/.test(u.hostname)) refused.push(`${req.method()} ${u.href}`);
      return r.abort();
    });
    const worker = context.serviceWorkers().find((w) => w.url().endsWith('/background/background.js')) || await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => { await GZ_AI_BROKER.vault().set('connections', { 'custom-1': { provider: 'stub', model: 'stub', generation: 'g-1' } }); });
    const script = (s, window = 4096) => worker.evaluate(([x, w]) => { askCheck.script = x; askCheck.seen = []; askCheck.window = w; }, [s, window]);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    const shots = [];
    // One scene: settings and layout stored, the page opened, the tile's chat drawn, its box the same from its first frame.
    const scene = async ({ look = 'light', where, size, url, motion }) => {
      await page.goto('about:blank');
      await worker.evaluate(async ([s, l]) => {
        await chrome.storage.sync.clear(); await chrome.storage.sync.set(s);
        const keep = Object.keys(await chrome.storage.local.get(null)).filter((k) => !['ultra'].includes(k));
        await chrome.storage.local.remove(keep); await chrome.storage.local.set(l);
      }, [settingsFor(look, motion), { ultra: [O], ai: AI, widgetLayout: lay(where, size) }]);
      await env.ultraReady(worker);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(url);
      const tile = page.locator('section.gz-w[data-tile="ask"]');
      await tile.locator('.gz-ask-chat .gz-ask-input').waitFor({ timeout: 20000 });
      const first = await tile.boundingBox();
      await pause(400);
      const later = await tile.boundingBox();
      assert.deepEqual([first.width, first.height].map(Math.round), [later.width, later.height].map(Math.round), 'the tile drawn whole: no size change after its first frame');
      return tile;
    };
    const look = async (name) => {
      await worker.evaluate((s) => chrome.storage.sync.set(s), settingsFor(name));
      await until(() => page.evaluate((bg) => document.documentElement.getAttribute('data-gz-bg') === bg, LOOKS[name][1]), `the ${name} look`);
    };
    const snap = async (name, widths = [1280, 320]) => {
      for (const w of widths) {
        await page.setViewportSize({ width: w, height: w === 320 ? 700 : 900 });
        await until(() => page.evaluate(() => { const t = document.querySelector('section.gz-w[data-tile="ask"]'); const r = t?.getBoundingClientRect(); return !!r && r.width > 0 && t.scrollWidth <= t.clientWidth + 1; }), `the tile fits ${w} px`);
        await until(() => page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.gz-ask-tile')).every((a) => a.playState !== 'running' || a.effect.getTiming().iterations === Infinity)), 'entrances finished');
        await page.locator('section.gz-w[data-tile="ask"]').scrollIntoViewIfNeeded();
        const file = path.join(out, `ask-widget-${name}-${w}.png`);
        await page.screenshot({ path: file });
        shots.push(file);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    };
    const askIn = async (tile, q) => {
      const n = await tile.locator('.gz-ask-a').count();
      await tile.locator('.gz-ask-input').first().fill(q);
      await tile.locator('.gz-ask-input').first().press('Enter');
      await until(async () => (await tile.locator('.gz-ask-a').count()) > n && !(await tile.locator('.gz-ask-a').nth(n).getAttribute('data-streaming').then((v) => v !== null)), `the answer to ${q}`, 20000);
      return (await tile.locator('.gz-ask-a').nth(n).locator('.gz-ask-text').allTextContents()).join('');
    };
    const meter = (tile) => tile.locator('.gz-ask-meter').evaluate((m) => ({ hidden: m.hidden, n: m.querySelector('.gz-ask-meter-n').textContent, band: m.dataset.band || '', label: m.getAttribute('aria-label') }));
    const study = (reply) => ({ kind: 'hint', step: null, reply, followUp: null });

    await check('Canvas Dashboard: the tile on the board, large, light, dark and solid', async () => {
      await scene({ where: 'cdash', size: 'l', url: `${CANVAS}/` });
      const inBoard = await page.evaluate(() => !!document.querySelector('#gz-dash section.gz-w[data-tile="ask"]'));
      assert.ok(inBoard, 'on the Dashboard board');
      for (const lk of ['light', 'dark', 'solid']) { await look(lk); await snap(`canvas-board-l-empty-${lk}`); }
      return { inBoard };
    });

    await check('Canvas Dashboard: an answer in the tile, its meter in the head, three bands', async () => {
      await look('light');
      const tile = page.locator('section.gz-w[data-tile="ask"]');
      await script({ 'study.help': [study('**Mitosis** splits one cell into two. What happens to the chromosomes first?')] });
      const text = await askIn(tile, 'Explain mitosis');
      const m0 = await meter(tile);
      assert.equal(m0.hidden, false);
      assert.match(m0.n, /^\d+%$/);
      assert.match(m0.label, /^\d+% of the context window used$/);
      await snap('canvas-board-l-answer-light');
      const used = Number(m0.n.slice(0, -1)) * 4096 / 100;
      const bands = {};
      for (const [band, share] of [['warm', 0.8], ['warn', 0.95]]) {
        await script({ 'study.help': [study('Think about what each phase does.')] }, Math.max(64, Math.round(used / share)));
        await tile.locator('.gz-ask-input').first().fill('And then?');
        await tile.locator('.gz-ask-input').first().press('Enter');
        await until(async () => (await meter(tile)).band === band, `the ${band} band`);
        await until(async () => !(await tile.locator('.gz-ask-stop').isVisible()), 'the run ends');
        bands[band] = await meter(tile);
        await snap(`canvas-board-l-meter-${band}-light`, [1280]);
      }
      return { text: text.slice(0, 60), m0, bands };
    });

    await check('Canvas Dashboard: turns folded into a summary show as one line, opened to read it', async () => {
      const tile = page.locator('section.gz-w[data-tile="ask"]');
      await tile.locator('.gz-ask-new').click();
      await script({ 'study.help': [1, 2, 3, 4].map((i) => study(`Look again at step ${i}. What changes?`)), 'chat.compact': [{ text: '- Asked about mitosis\n- **Prophase** comes first', quotes: [] }] });
      for (const q of ['Explain mitosis', 'What is prophase?', 'What is metaphase?', 'What is anaphase?']) await askIn(tile, q);
      await tile.locator('.gz-ask-fold').waitFor({ timeout: 20000 });
      const said = await tile.locator('.gz-ask-fold summary').textContent();
      assert.equal(said, 'Earlier messages summarized');
      await tile.locator('.gz-ask-fold summary').click();
      const inside = await tile.locator('.gz-ask-fold .gz-ask-md').textContent();
      assert.ok(inside.trim().length > 0, 'the summary inside');
      await tile.locator('.gz-ask-fold').scrollIntoViewIfNeeded();
      const file = path.join(out, 'ask-widget-canvas-board-l-fold-light-1280.png');
      await page.screenshot({ path: file }); shots.push(file);
      return { said, inside: inside.slice(0, 80) };
    });

    await check('⌘K\'s Ask Rime focuses the tile where it is shown, no dialog; folded, the dialog opens', async () => {
      const row = async () => {
        await page.keyboard.press(`${MOD}+k`);
        const input = page.locator('#gz-cmd input');
        await input.waitFor({ state: 'visible' });
        await input.fill('Ask Rime');
        const r = page.locator('#gz-cmd li[role="option"]').filter({ has: page.locator('span', { hasText: /^Ask Rime$/ }) });
        await r.first().waitFor();
        await r.first().click();
      };
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await row();
      await until(() => page.evaluate(() => document.activeElement?.classList.contains('gz-ask-input') && !!document.activeElement.closest('section.gz-w[data-tile="ask"]')), 'the tile\'s question focused');
      assert.equal(await page.locator('#gz-ask').count(), 0, 'no dialog');
      await page.locator('section.gz-w[data-tile="ask"] .gz-w-fold').click();
      await until(() => page.evaluate(() => document.querySelector('section.gz-w[data-tile="ask"]')?.hasAttribute('data-fold')), 'folded');
      await row();
      await page.locator('#gz-ask[open]').waitFor();
      await page.keyboard.press('Escape');
      await until(async () => (await page.locator('#gz-ask').count()) === 0, 'the dialog closes');
      await page.locator('section.gz-w[data-tile="ask"] .gz-w-fold').click();
      return { ok: true };
    });

    await check('Canvas: the tile floating over the page, small, light and dark; Motion off moves nothing in it', async () => {
      await scene({ where: 'cfloat', size: 's', url: `${CANVAS}/courses/25` });
      for (const lk of ['light', 'dark']) { await look(lk); await snap(`canvas-float-s-empty-${lk}`); }
      await scene({ where: 'cfloat', size: 's', url: `${CANVAS}/courses/25`, motion: 'off' });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const tile = page.locator('section.gz-w[data-tile="ask"]');
      await script({ 'study.help': [study('What do you notice first?')] });
      await tile.locator('.gz-ask-input').first().fill('Explain mitosis');
      await tile.locator('.gz-ask-input').first().press('Enter');
      const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.gz-ask-tile') && a.playState === 'running').length);
      await until(async () => (await tile.locator('.gz-ask-a').count()) > 0, 'the answer');
      const streaming = await tile.locator('.gz-ask-a').first().getAttribute('data-streaming');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(moving, 0, 'nothing animates with Motion off');
      assert.equal(streaming, null, 'the answer whole at once');
      await snap('canvas-float-s-answer-light');
      return { moving, streaming };
    });

    await check('Ultra Dashboard: the tile on the board, large and small, light, dark and solid', async () => {
      await scene({ where: 'dash', size: 'l', url: `${O}/ultra/institution-page` });
      assert.ok(await page.evaluate(() => !!document.querySelector('#gz-dash section.gz-w[data-tile="ask"]')), 'on the Dashboard board');
      for (const lk of ['light', 'dark', 'solid']) { await look(lk); await snap(`ultra-board-l-empty-${lk}`); }
      await scene({ where: 'dash', size: 's', url: `${O}/ultra/institution-page` });
      await snap('ultra-board-s-empty-light');
      return { ok: true };
    });

    await check('Ultra: the tile floating over the Courses page, medium, light and dark', async () => {
      await scene({ where: 'pages', size: 'm', url: `${O}/ultra/course` });
      for (const lk of ['light', 'dark']) { await look(lk); await snap(`ultra-float-m-empty-${lk}`); }
      const tile = page.locator('section.gz-w[data-tile="ask"]');
      await script({ 'study.help': [study('Which part of the cell cycle is this?')] });
      await askIn(tile, 'Explain mitosis');
      await snap('ultra-float-m-answer-dark');
      return { ok: true };
    });

    await check('nothing left the school\'s own sites, and the pages threw nothing', async () => {
      assert.deepEqual(refused, []);
      assert.deepEqual(errors, []);
      return { shots: shots.length };
    });
  } catch (e) {
    failed++;
    results.push({ name: 'setup', ok: false, error: e.stack });
    console.error(e);
  } finally {
    await context?.close().catch(() => {});
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'ask-widget-check.json'), JSON.stringify({ total, failed, results }, null, 2));
    console.log(`${total - failed}/${total} passed; evidence in ${out}`);
    process.exitCode = failed ? 1 : 0;
  }
})();
