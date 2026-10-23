// LMS rules (x.rules), headless: the real extension on the Ultra preview and on saved Canvas and Moodle pages under invented
// school origins. The rules reach the pages the way a Look's parts do: Canvas and Moodle read them from storage (a Look saved
// the way the editor saves it, sync `lookX`), the Ultra preview is sent them with its settings (it ignores storage); content.js
// loads features/rules.js itself. The boards' course cards (Glaze's own, on Canvas's Dashboard and Ultra's Courses page) wear
// a Look's card rules as the LMS's cards do. All other requests abort; no LMS needed.
//   NODE_PATH=/path/to/node_modules nice node scripts/rules-check.js [out dir for screenshots]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const G = require('../defaults.js');
// A copy holding the school's host, as the student's grant does (scripts/check-env.js staged).
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://moodle.school.test/*', 'https://bb.school.test/*']);
const chromeLaunch = require('./check-env.js').chromeLaunch();
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const W = require('../lib/widgets.js');
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-rules-shots-'));
const CANVAS = 'https://rules.school.instructure.com', MOODLE = 'https://moodle.school.test', ULTRA = 'https://bb.school.test';
const fixture = (name) => fs.readFileSync(path.join(ext, 'test/fixtures', name), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
const PAGES = { [`${CANVAS}/`]: 'canvas-dashboard-cards.html', [`${CANVAS}/courses/25`]: 'canvas-course-home.html', [`${CANVAS}/courses/25/quizzes/7/take`]: 'canvas-quiz-take.html', [`${MOODLE}/my/`]: 'moodle-dashboard.html' };
// The boards' course cards (features/coursecards.js), where lib/parts.js finds them.
const BOARD = { canvas: '.gz-w-body > .ic-DashboardCard[data-gz-tile-card]', ultra: '.gz-w-body > article.gz-course-card' };
let checks = 0;
const ok = (value, label) => { if (!value) throw new Error(`FAIL ${label}`); console.log(`ok   ${label}`); checks++; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-rules-'));
  let ctx;
  const errors = [];
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), { ...chromeLaunch, headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-webgl', '--host-resolver-rules=MAP * ~NOTFOUND'] });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (route.request().method() === 'GET' && PAGES[u.origin + u.pathname]) return route.fulfill({ contentType: 'text/html', body: fixture(PAGES[u.origin + u.pathname]) });
      if (u.origin === CANVAS && u.pathname.startsWith('/api/v1/')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      if (u.origin === ULTRA && u.pathname === '/ultra/course') return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(ext, 'test/fixtures/ultra-courses.html'), 'utf8') });
      if (u.origin === ULTRA && u.pathname.startsWith('/learn/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.abort();
    });
    const until = async (page, fn, arg, label) => { const end = Date.now() + 10000; while (Date.now() < end) { if (await page.evaluate(fn, arg).catch(() => false)) return; await page.waitForTimeout(50); } throw new Error(`FAIL ${label}`); };
    const seen = async (page, fn, arg, label) => { await until(page, fn, arg, label); ok(true, label); };

    // ---- Ultra: the editor's preview, where the content scripts run in the page itself ----
    const ultra = await ctx.newPage();
    ultra.on('pageerror', (e) => errors.push(`ultra: ${e}`));
    await ultra.goto(`chrome-extension://${id}/preview.html?site=ultra`);
    await until(ultra, () => globalThis.GZ_CTX?.on(), null, 'the preview is themed');
    // What the editor sends its frame: the settings, and the Look's parts with them (null for none).
    const say = (x, settings = G.GZ_DEFAULTS) => ultra.evaluate(({ s, parts }) => postMessage({ gzPreview: s, gzPreviewParts: parts }, location.origin), { s: settings, parts: x && { x } });
    await say(null);
    await ultra.waitForTimeout(300);
    const before = await ultra.evaluate(() => document.getElementById('site-wrap').outerHTML);
    const RULES = [
      { p: 'ultra.course-card.title', do: 'label', t: 'My favourite' },
      { p: 'ultra.course-card', do: 'style', st: { r: 24, bw: 3, bc: 'accent', sh: 3, f: 'atkinson' } },
      { p: 'ultra.nav.footer', do: 'hide' },
      { p: 'ultra.nav', do: 'style', st: { bg: '#331144' } },
    ];
    await say({ rules: RULES });
    const look = () => ultra.evaluate(() => {
      const card = document.querySelector('article.course-element-card'), s = getComputedStyle(card);
      return { title: card.querySelector('.course-title').textContent.trim(), radius: s.borderRadius, border: `${s.borderTopWidth} ${s.borderTopStyle}`, shadow: s.boxShadow, font: s.fontFamily,
        footer: getComputedStyle(document.querySelector('[class*="makeStylesfooter"]')).display, nav: getComputedStyle(document.querySelector('nav[class*="makeStylesnavigation"]')).backgroundColor,
        sheet: !!document.getElementById('gz-rules-css')?.sheet };
    });
    await until(ultra, () => !!document.getElementById('gz-rules-css')?.sheet, null, 'rules.css loads');
    const l = await look();
    ok(l.title === 'My favourite', 'Ultra: a card title is relabelled');
    ok(l.radius === '24px' && l.border === '3px solid' && /32px/.test(l.shadow) && /Glaze Atkinson/.test(l.font), `Ultra: a card wears radius, border, shadow and font over theme.css (${l.radius}, ${l.border})`);
    ok(l.footer === 'none', 'Ultra: the rail footer is hidden by attribute and sheet');
    ok(l.nav === 'rgb(51, 17, 68)', `Ultra: the rail takes a background (${l.nav})`);
    ok(await ultra.evaluate(() => !document.querySelector('[style*="display"][data-gz-r-hide]')), 'Ultra: no inline display');
    // What a pass costs with 64 rules on this page (each is a querySelectorAll per part).
    const cost = await ultra.evaluate(() => {
      const names = [...GZ_PARTS.PARTS.keys()].filter((n) => n.startsWith('ultra.'));
      const rules = Array.from({ length: 64 }, (_, i) => ({ p: names[i % names.length], do: 'style', st: { o: 90 + (i % 10) } }));
      return rules;
    });
    await say({ rules: cost });
    await until(ultra, (n) => document.querySelectorAll('[data-gz-r-st]').length > n, 0, 'Ultra: 64 rules are on');
    const perPass = await ultra.evaluate(() => {
      const t = performance.now();
      for (let i = 0; i < 100; i++) GZ_RULES.sync();
      return (performance.now() - t) / 100;
    });
    ok(perPass < 5, `Ultra: a pass with 64 rules costs ${perPass.toFixed(3)} ms`);
    await say(null);
    await until(ultra, () => !document.getElementById('gz-rules-css'), null, 'Ultra: rules.css comes off');
    ok(await ultra.evaluate(() => document.getElementById('site-wrap').outerHTML) === before, 'Ultra: taking the rules off leaves the page exactly as it was');
    await say({ rules: RULES });
    // Ultra redraws a title: the next pass (flush, from the mutation) puts the label back.
    await ultra.evaluate(() => { const t = document.querySelector('article.course-element-card .course-title'); t.replaceChildren(document.createTextNode('Redrawn by Ultra')); });
    await until(ultra, () => document.querySelector('article.course-element-card .course-title').textContent.trim() === 'My favourite', null, 'Ultra: a redrawn title is relabelled on the next pass');
    ok(true, 'Ultra: a redrawn title is relabelled on the next pass');
    // Off with the theme: nothing stays.
    await say({ rules: RULES }, { ...G.GZ_DEFAULTS, enabled: false });
    await until(ultra, () => !document.querySelector('[data-gz-r-st], [data-gz-r-hide]') && !document.getElementById('gz-rules-css'), null, 'Ultra: theme off takes the rules off');
    ok(await ultra.evaluate(() => !document.querySelector('[data-gz-r-st], [data-gz-r-hide]') && !document.getElementById('gz-rules-css') && document.querySelector('article.course-element-card .course-title').textContent.trim() === 'Redrawn by Ultra'), 'Ultra: theme off takes every rule off');
    await ultra.close();

    // ---- Canvas and Moodle: the Look is saved the way the editor saves it, and the open page reads it from storage ----
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${id}/options.html`);
    await opts.evaluate(async () => { await chrome.storage.local.set({ moodle: ['https://moodle.school.test/*'] }); }); // the student's yes to this Moodle site
    const inject = async (url, x) => {
      const r = await opts.evaluate((parts) => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:look', parts, patch: { version: 2 } }, res)), x && { x });
      if (!r?.ok) throw new Error(`FAIL the Look was not saved: ${JSON.stringify(r)}`);
    };
    const open = async (url, ready) => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${url}: ${e}`));
      await page.goto(url);
      await until(page, (sel) => document.documentElement.style.getPropertyValue('--gz-accent') && document.querySelector(sel), ready, `${url} is themed`);
      return page;
    };

    const dash = await open(`${CANVAS}/`, '.ic-DashboardCard');
    // A fresh Dashboard's board takes the course cards (Glaze's own, drawn as Canvas's): the Look's card rules reach them, and
    // Canvas's own in its card view.
    const NATIVE = '.ic-DashboardCard:not([data-gz-tile-card])';
    await until(dash, () => document.querySelector('.gz-course-native'), null, "Canvas: the board offers Canvas's course cards");
    await until(dash, (sel) => document.querySelectorAll(sel).length === 4, BOARD.canvas, "Canvas: the board holds the four course cards");
    const names = () => dash.evaluate((sel) => [...document.querySelectorAll(`${sel} .ic-DashboardCard__header-title`)].map((e) => e.textContent), NATIVE);
    const boardCards = () => dash.evaluate((sel) => [...document.querySelectorAll(sel)].map((c) => {
      const tile = c.closest('.gz-w'), title = c.querySelector('.ic-DashboardCard__header-title'), s = getComputedStyle(c);
      return { title: title.textContent.trim(), head: tile.querySelector('.gz-w-head').textContent.trim(), radius: s.borderRadius, bg: s.backgroundColor,
        image: getComputedStyle(c.querySelector('.ic-DashboardCard__header_image')).display, tags: [...tile.querySelectorAll('[data-gz-r-st], [data-gz-r-hide]')].filter((e) => !c.contains(e) || /(^| )gz-/.test(e.className) || /^gz-/.test(e.id)).length };
    }), BOARD.canvas);
    const real = await names(), boardReal = await boardCards();
    await inject(`${CANVAS}/`, { rules: [
      { p: 'canvas.dashboard-card.title', do: 'label', t: 'Relabelled' },
      { p: 'canvas.dashboard-card', do: 'style', st: { r: 20, bg: 'accent-soft' } },
      { p: 'canvas.dashboard-card.image', do: 'style', st: { o: 30 } },
      { p: 'canvas.dashboard-card.menu', do: 'hide' },
      { p: 'canvas.sidebar.todo', do: 'hide' },
      { p: 'canvas.global-nav.help', do: 'hide' },
      { p: 'canvas.global-nav.inbox', do: 'move', to: 'canvas.global-nav.dashboard', at: 'before' },
    ] });
    await until(dash, () => !!document.getElementById('gz-rules-css')?.sheet, null, 'Canvas: rules.css loads');
    await until(dash, (sel) => [...document.querySelectorAll(`${sel} .ic-DashboardCard__header-title`)].every((e) => e.textContent.trim() === 'Relabelled'), BOARD.canvas, "Canvas: the board's card titles take the label");
    const onBoard = await boardCards();
    ok(onBoard.length === 4 && onBoard.every((c) => c.title === 'Relabelled'), "Canvas: every board card's title is relabelled");
    ok(onBoard.every((c, i) => c.head === boardReal[i].head), `Canvas: each tile's own header keeps the course's name (${onBoard.map((c) => c.head).join(', ')})`);
    ok(onBoard.every((c) => c.radius === '20px') && onBoard.every((c, i) => c.bg !== boardReal[i].bg), `Canvas: board cards take the card's radius and background over Glaze's board (${onBoard[0].radius}, ${onBoard[0].bg})`);
    ok(onBoard.every((c) => c.tags === 0), 'Canvas: nothing of the tile itself (its header, its tools) takes a rule');
    ok(await dash.evaluate((sel) => [...document.querySelectorAll(`${sel} .ic-DashboardCard__header_image`)].every((e) => getComputedStyle(e).opacity === '0.3'), BOARD.canvas), "Canvas: the board card's picture takes its rule");
    // The board writes its cards' text on each pass: a label it doesn't fight is a page that goes quiet.
    const churn = await dash.evaluate(() => new Promise((res) => {
      let n = 0;
      const mo = new MutationObserver((rs) => { n += rs.length; });
      mo.observe(document.getElementById('gz-dash'), { subtree: true, childList: true, characterData: true, attributes: true });
      setTimeout(() => { mo.disconnect(); res(n); }, 1500);
    }));
    ok(churn === 0 && (await boardCards()).every((c) => c.title === 'Relabelled'), `Canvas: the labelled board settles (${churn} changes in 1.5 s) and keeps its labels`);
    await dash.screenshot({ path: path.join(out, 'canvas-board-look.png'), fullPage: true });
    await dash.click('.gz-course-native');
    await until(dash, (sel) => [...document.querySelectorAll(sel)].every((e) => e.getClientRects().length), NATIVE, "Canvas: Canvas's course cards show");
    const c = await dash.evaluate((sel) => ({
      titles: [...document.querySelectorAll(`${sel} .ic-DashboardCard__header-title`)].map((e) => e.textContent.trim()),
      radius: getComputedStyle(document.querySelector(sel)).borderRadius,
      todo: getComputedStyle(document.querySelector('#right-side .Sidebar__TodoListContainer')).display,
      help: getComputedStyle(document.querySelector('#global_nav_help_link').parentElement).display,
      order: [...document.querySelectorAll('#header .ic-app-header__menu-list > li > a[id]')].map((a) => a.id.replace(/^global_nav_|_link$/g, '')),
    }), NATIVE);
    await until(dash, (sel) => [...document.querySelectorAll(`${sel} .ic-DashboardCard__header-title`)].every((e) => e.textContent.trim() === 'Relabelled'), NATIVE, "Canvas: its own card titles take the label");
    ok(c.titles.length === 4 && c.titles.every((t) => t === 'Relabelled'), 'Canvas: every card title is relabelled');
    ok(c.radius === '20px', `Canvas: cards take their radius over canvas.css (${c.radius})`);
    ok(c.todo === 'none' && c.help === 'none', 'Canvas: the sidebar To Do and the Help item are hidden');
    ok(c.order.indexOf('conversations') === c.order.indexOf('dashboard') - 1, `Canvas: Inbox moved before Dashboard (${c.order.join(' ')})`);
    await dash.screenshot({ path: path.join(out, 'canvas-own-cards-look.png'), fullPage: true });
    await inject(`${CANVAS}/`, null);
    await until(dash, () => !document.getElementById('gz-rules-css'), null, 'Canvas: rules come off');
    ok(JSON.stringify(await names()) === JSON.stringify(real), 'Canvas: titles come back exactly');
    ok(JSON.stringify((await boardCards()).map((c) => [c.title, c.radius, c.bg])) === JSON.stringify(boardReal.map((c) => [c.title, c.radius, c.bg])), "Canvas: the board's cards come back exactly");
    ok(await dash.evaluate(() => !document.querySelector('[data-gz-r-st], [data-gz-r-hide]') && [...document.querySelectorAll('#header .ic-app-header__menu-list > li > a[id]')].map((a) => a.id)[1] === 'global_nav_dashboard_link'
      && ![...document.querySelector('#header .ic-app-header__menu-list').childNodes].some((n) => n.nodeType === 8 && n.data === 'gz-rule')), 'Canvas: hidden parts show, Inbox is back in place, no marker left');
    await dash.close();

    const course = await open(`${CANVAS}/courses/25`, '#section-tabs');
    await inject(`${CANVAS}/courses/25`, { rules: [{ p: 'canvas.course-nav.assignments', do: 'move', to: 'canvas.course-nav.home', at: 'after' }, { p: 'canvas.course-nav.home', do: 'label', t: 'Start' }] });
    await until(course, () => document.querySelector('#section-tabs > li:nth-child(2) > a.assignments'), null, 'Canvas: Assignments moved after Home');
    ok(await course.evaluate(() => document.querySelector('#section-tabs a.home').textContent.trim() === 'Start'), 'Canvas: Assignments moved after Home, and Home relabelled');
    await inject(`${CANVAS}/courses/25`, null);
    await course.close();

    const quiz = await open(`${CANVAS}/courses/25/quizzes/7/take`, '#application');
    await inject(`${CANVAS}/courses/25/quizzes/7/take`, { rules: [{ p: 'canvas.global-nav.help', do: 'hide' }, { p: 'canvas.footer', do: 'hide' }] });
    // The control: another Canvas page, opened after the quiz, wears the same rules; by then the quiz page has read them too.
    const control = await open(`${CANVAS}/`, '.ic-DashboardCard');
    await seen(control, () => !!document.querySelector('[data-gz-r-hide]'), null, 'Canvas: the same rules are on a dashboard opened beside the quiz');
    await quiz.waitForTimeout(400);
    ok(await quiz.evaluate(() => !document.querySelector('[data-gz-r-hide]') && !document.getElementById('gz-rules-css')), 'Canvas: nothing on a quiz being taken');
    await inject(`${CANVAS}/`, null);
    await control.close();
    await quiz.close();

    const moodle = await open(`${MOODLE}/my/`, '.block_calendar_month');
    // The sweep may retag the menu button while the Look changes. Compare the title's full markup, including favourite
    // status and both visible and screen-reader names; an unrelated menu's data-gz-light is not a label restore.
    const moodleCards = () => moodle.evaluate(() => [...document.querySelectorAll('.course-card .coursename')].map((e) => e.outerHTML));
    const moodleBefore = await moodleCards();
    await inject(`${MOODLE}/my/`, { rules: [{ p: 'moodle.course-card.image', do: 'hide' }] });
    await seen(moodle, () => { const images = [...document.querySelectorAll('.course-card .card-img-top')]; return images.length && images.every((e) => e.hasAttribute('data-gz-r-hide')); }, null,
      'Moodle: course image rules reach the Boost image elements');
    await inject(`${MOODLE}/my/`, null);
    await until(moodle, () => !document.getElementById('gz-rules-css'), null, 'Moodle: image rules come off');
    await inject(`${MOODLE}/my/`, { rules: [{ p: 'moodle.course-card.title', do: 'label', t: 'Renamed course' }] });
    await seen(moodle, () => { const titles = [...document.querySelectorAll('.coursename .multiline > span')]; return titles.length && titles.every((e) => e.textContent.trim() === 'Renamed course'); }, null,
      'Moodle: visible and screen-reader course titles are relabelled');
    ok(await moodle.evaluate(() => [...document.querySelectorAll('[data-region="favourite-icon"] .visually-hidden')].every((e) => e.textContent.trim() === 'Course is starred')),
      'Moodle: title labels leave favourite status alone');
    await inject(`${MOODLE}/my/`, null);
    await until(moodle, () => !document.getElementById('gz-rules-css'), null, 'Moodle: title rules come off');
    ok(JSON.stringify(await moodleCards()) === JSON.stringify(moodleBefore), 'Moodle: course title markup is restored exactly');
    await inject(`${MOODLE}/my/`, { rules: [
      { p: 'moodle.block.recentlyaccesseditems', do: 'move', to: 'moodle.block.calendar-month', at: 'before' },
      { p: 'moodle.footer.help', do: 'hide' },
      { p: 'moodle.page-header', do: 'style', st: { bg: 'surface', p: 5, r: 16 } },
    ] });
    await until(moodle, () => document.querySelector('.block_recentlyaccesseditems')?.nextElementSibling?.matches('.block_calendar_month'), null, 'Moodle: block moved');
    await until(moodle, () => !!document.getElementById('gz-rules-css')?.sheet, null, 'Moodle: rules.css loads');
    const m = await moodle.evaluate(() => ({ help: getComputedStyle(document.querySelector('.btn-footer-popover')).display, pad: getComputedStyle(document.querySelector('#page-header')).paddingTop }));
    ok(m.help === 'none' && m.pad === '16px', `Moodle: a block moved before another, help hidden, header padded (${m.help}, ${m.pad})`);
    await inject(`${MOODLE}/my/`, null);
    await until(moodle, () => !document.getElementById('gz-rules-css') && !document.querySelector('.block_recentlyaccesseditems + .block_calendar_month'), null, 'Moodle: rules come off');
    ok(true, 'Moodle: rules come off and the block goes back');

    // ---- Ultra: the Courses page's board, its course cards (Glaze's own) beside the Look's rules for Ultra's ----
    await opts.evaluate(async ([o, layout, s]) => { await chrome.storage.local.set({ ultra: [o], widgetLayout: layout }); await chrome.storage.sync.set(s); }, [ULTRA, (() => {
      const lay = W.layout({ todo: true });
      for (const b of ['courses', 'dash', 'pages']) for (const x of lay.boards[b]) x.on = false;
      lay.boards.courses.push(...['_100_1', '_101_1', '_102_1', '_103_1'].map((cid) => ({ id: `course:${ULTRA}/${cid}`, on: true, size: 's' })));
      return W.layout(lay);
    })(), G.GZ_SANITIZE({ ...G.GZ_DEFAULTS, navbar: { ...G.GZ_DEFAULTS.navbar, on: false } })]);
    const ub = await open(`${ULTRA}/ultra/course`, 'article.course-element-card');
    await until(ub, (sel) => document.querySelectorAll(sel).length === 4, BOARD.ultra, "Ultra: the Courses page's board holds four course cards");
    const ultraCards = () => ub.evaluate((sel) => [...document.querySelectorAll(sel)].map((c) => {
      const s = getComputedStyle(c), title = c.querySelector('.course-title'), tile = c.closest('.gz-w');
      return { title: title.textContent.trim(), radius: s.borderRadius, border: `${s.borderTopWidth} ${s.borderTopStyle}`, banner: getComputedStyle(c.querySelector('.course-banner')).backgroundColor,
        code: getComputedStyle(c.querySelector('.course-id')).color, menu: !!c.querySelector('.gz-cm-btn') && getComputedStyle(c.querySelector('.gz-cm-btn')).display, shown: getComputedStyle(c).display,
        head: tile.querySelector('.gz-w-head').textContent.trim(), tags: [...tile.querySelectorAll('[data-gz-r-st], [data-gz-r-hide]')].filter((e) => !c.contains(e) || /(^| )gz-/.test(e.className) && e !== c).length };
    }), BOARD.ultra);
    const ultraReal = await ultraCards();
    await inject(`${ULTRA}/ultra/course`, { rules: [
      { p: 'ultra.course-card.title', do: 'label', t: 'My favourite' },
      { p: 'ultra.course-card', do: 'style', st: { r: 24, bw: 3, bc: 'accent' } },
      { p: 'ultra.course-card', do: 'hide' },
      { p: 'ultra.course-card.banner', do: 'style', st: { bg: '#331144' } },
      { p: 'ultra.course-card.id', do: 'style', st: { fg: '#ff8800' } },
      { p: 'ultra.course-card.id', do: 'move', to: 'ultra.course-card.title', at: 'before' },
      { p: 'ultra.course-card.status', do: 'hide' },
    ] });
    await until(ub, (sel) => [...document.querySelectorAll(`${sel} .course-title`)].every((e) => e.textContent.trim() === 'My favourite'), BOARD.ultra, "Ultra: the board's card titles take the label");
    await ub.waitForTimeout(300);
    const ultraChurn = await ub.evaluate((sel) => new Promise((resolve) => {
      let writes = 0;
      const watch = new MutationObserver((records) => { writes += records.length; });
      for (const c of document.querySelectorAll(sel)) {
        watch.observe(c.querySelector('.course-title'), { childList: true, characterData: true, subtree: true });
        watch.observe(c.closest('.gz-w').querySelector('.gz-w-head'), { childList: true, characterData: true, subtree: true });
      }
      setTimeout(() => { watch.disconnect(); resolve(writes); }, 1000);
    }), BOARD.ultra);
    ok(ultraChurn === 0, `Ultra: the labelled board settles (${ultraChurn} changes in 1 s)`);
    const u = await ultraCards();
    ok(u.every((c) => c.title === 'My favourite'), "Ultra: every board card's title is relabelled");
    ok(u.every((c) => c.radius === '24px' && c.border === '3px solid'), `Ultra: board cards take the card's radius and border (${u[0].radius}, ${u[0].border})`);
    ok(u.every((c) => c.banner === 'rgb(51, 17, 68)' && c.code === 'rgb(255, 136, 0)'), `Ultra: the board card's picture and code take theirs (${u[0].banner}, ${u[0].code})`);
    ok(await ub.evaluate((sel) => [...document.querySelectorAll(sel)].every((c) => c.querySelector('.course-id').nextElementSibling === c.querySelector('.course-title')), BOARD.ultra), 'Ultra: a code moves before its own board title');
    ok(u.every((c, i) => c.shown !== 'none' && c.menu === ultraReal[i].menu), `Ultra: a board card is never hidden, and its course menu stays as it was (${u[0].shown}, ${u[0].menu})`);
    ok(u.every((c, i) => c.head === ultraReal[i].head && c.tags === 0), `Ultra: the tile's own header and pieces take nothing (${u.map((c) => c.head).join(', ')})`);
    ok(await ub.evaluate(() => [...document.querySelectorAll('article.course-element-card .course-status')].every((e) => e.hasAttribute('data-gz-r-hide'))
      && [...document.querySelectorAll('article.course-element-card .course-title')].every((e) => e.textContent.trim() === 'My favourite')), "Ultra: its own cards (behind the board) take the same rules");
    await ub.screenshot({ path: path.join(out, 'ultra-board-look.png'), fullPage: true });
    await inject(`${ULTRA}/ultra/course`, null);
    await until(ub, () => !document.getElementById('gz-rules-css'), null, 'Ultra: rules come off the board');
    ok(JSON.stringify(await ultraCards()) === JSON.stringify(ultraReal), "Ultra: the board's cards come back exactly");
    await ub.close();

    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`${checks} checks passed; no page errors; screenshots in ${out}`);
  } finally {
    await ctx?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
