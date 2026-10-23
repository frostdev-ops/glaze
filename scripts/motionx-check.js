// Look parts that move, headless: the real extension, a synthetic Ultra page, no account and no outside network (every
// other request is aborted, DNS goes nowhere).
//   NODE_PATH=<installed playwright> nice node scripts/motionx-check.js [out dir for screenshots]
//
// Part 1, the page: a Look with animations, an effect and a pointer effect on an Ultra page served with a strict
// Content-Security-Policy (`style-src 'self'`, which refuses inline styles: the page's own <style> proves it is on). The
// extension's CSS must still arrive, motion off, each of the three switches and reduced motion must stop it, the effects
// must play on a completion and on the pointer and clean up after themselves, and none of it may happen on a quiz.
// Part 2, the preview: the same Look on the options preview (preview.html, the real content script on a mock page), with
// the cost of an effect's frames measured.
//
// Look parts come from GZ_CTX.parts() (lib/lookparts.js), the real path: a Look and its parts are saved the way the editor
// saves them (the worker's glaze:look message from the options page, which writes sync `lookX` with the settings in one
// write), the page reads them after first paint and announces glaze:parts. The editor's preview is handed them in the
// message that carries its settings (gzPreviewParts), since it ignores storage.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const root = path.join(__dirname, '..');
const G = require(path.join(root, 'defaults.js'));
const M = require(path.join(root, 'lib/motionx.js'));
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-motionx-'));
const chromeLaunch = require('./check-env.js').chromeLaunch();
const PAGE = fs.readFileSync(path.join(root, 'test/fixtures/ultra-courses.html'), 'utf8');
const SITE = 'https://bb.school.test';
const CANVAS = 'https://motion.school.instructure.com';
const CANVAS_PAGE = fs.readFileSync(path.join(root, 'test/fixtures/canvas-dashboard-cards.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
  .replaceAll('http://localhost:3000', CANVAS).replace(/https?:\/\/canvas\.instructure\.com/g, CANVAS);
const POLICY = "default-src 'self'; style-src 'self'; script-src 'self' 'unsafe-inline'; img-src * data: blob:";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// Await actual values: installed Playwright does not await an async waitForFunction predicate.
const until = async (fn, ms = 6000, what = 'a condition') => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await pause(40); }
  throw new Error(`timed out waiting for ${what}`);
};
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

// ---- the Look ------------------------------------------------------------------------------------------------------------------
const ANIM = {
  'card.enter': { s: [{ at: 0, y: 24, sc: 0.9, o: 0 }, { at: 0.6, y: -4, sc: 1.03, o: 1 }, { at: 1, y: 0, sc: 1 }], ms: 700, ease: 'spring', delay: 40, stagger: 90 },
  'tooltip.in': { s: [{ at: 0, o: 0, bl: 6 }, { at: 1, o: 1, bl: 0 }], ms: 200 },
  'card.hover': { s: [{ at: 0 }, { at: 1, y: -8, sc: 1.04, br: 1.08 }], ms: 220, ease: [0.3, 1.5, 0.5, 1] }, // a code carries 2 to 8 stops; the last that names a key is the state
  'button.press': { s: [{ at: 0 }, { at: 1, sc: 0.88 }] },
  'tile.enter': { s: [{ at: 0, o: 0, x: -20 }, { at: 1, o: 1, x: 0 }], ms: 300 },
  'rail.open': { s: [{ at: 0, o: 0, x: -12 }, { at: 1, o: 1, x: 0 }], ms: 180 },
};
const FX = { complete: { kind: 'confetti', count: 40, shapes: ['star', 'heart', 'dot'], c: ['accent', '#ff8800', 'ok'], spread: 120, gravity: 1, life: 900, size: 10 } };
const CURSOR = { kind: 'trail', c: ['accent', 'warn'], size: 12, len: 12, fade: 400 };
const PARTS = { anim: ANIM, fx: FX, cursor: CURSOR };
const ULTRA_SETTINGS = (motion = {}) => ({ ...G.GZ_DEFAULTS, enhance: { ...G.GZ_DEFAULTS.enhance, footer: false }, navbar: { ...G.GZ_DEFAULTS.navbar, on: false }, motion: { ...G.GZ_DEFAULTS.motion, level: 'expressive', followSystem: false, ...motion } });

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motionx-'));
  const ext = fs.realpathSync(root); // Chrome derives the id from the real path
  const id = extensionId(ext);
  const external = [], errors = [];
  await require('./wait-for-browser.js')();
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), {
    ...chromeLaunch, headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  try {
    console.log(`browser ${ctx.browser()?.version?.() ?? '?'}; page policy: ${POLICY}`);
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === CANVAS) {
        if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: CANVAS_PAGE });
        if (u.pathname.startsWith('/api/v1/')) return route.fulfill({ contentType: 'application/json', body: '[]' });
        return route.abort();
      }
      if (u.origin === SITE && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: PAGE, headers: { 'content-security-policy': POLICY } });
      if (u.origin === SITE && u.pathname.startsWith('/learn/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      external.push(route.request().url());
      return route.abort();
    });
    const opts = await ctx.newPage();
    opts.on('pageerror', (e) => errors.push(`options: ${e}`));
    await opts.goto(`chrome-extension://${id}/options.html`);
    await opts.evaluate((origin) => chrome.storage.local.set({ ultra: [origin] }), SITE);
    // The Look as the editor saves it: settings and parts in one write (lib/background.js BROKER.look). `parts` is the Look's x;
    // either argument left out keeps what was saved last.
    const worn = { settings: ULTRA_SETTINGS(), parts: null };
    const store = async (settings, parts) => {
      if (settings) worn.settings = settings;
      if (parts !== undefined) worn.parts = parts && { x: parts };
      const { nav, ...patch } = worn.settings; // the rail's own look is not part of this
      const r = await opts.evaluate(({ patch, parts }) => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:look', parts, patch }, res)), { patch: { ...patch, version: 2 }, parts: worn.parts });
      if (!r?.ok) throw new Error(`the Look was not saved: ${JSON.stringify(r)}`);
    };

    // ---- part 1: the page ---------------------------------------------------------------------------------------------------
    console.log('\n-- an Ultra page under a strict style-src --');
    await store(ULTRA_SETTINGS(), null);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`page: ${e}`));
    await page.goto(`${SITE}/ultra/course`);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion') && getComputedStyle(document.documentElement).getPropertyValue('--gz-ease').trim());
    const root$ = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    const card = () => page.evaluate(() => { const c = document.querySelector('article.element-card'); const s = getComputedStyle(c); return { name: s.animationName, duration: s.animationDuration, running: c.getAnimations().length }; });
    const canvas = () => page.evaluate(() => { const c = document.getElementById('gz-fx'); return c && { aria: c.getAttribute('aria-hidden'), events: getComputedStyle(c).pointerEvents, position: getComputedStyle(c).position, parent: c.parentElement?.tagName }; });
    const gone = () => until(async () => !(await canvas()), 4000, 'the canvas to be removed');
    ok(!!(await root$('--gz-ease')), 'the extension\'s own stylesheet arrives under the policy (motion.css defines --gz-ease)');
    ok((await root$('--gz-enter')).startsWith('gz-rise 0.8s'), `without parts the entrance is Expressive's own: ${(await root$('--gz-enter')).slice(0, 24)}…`);
    const control = await page.evaluate(() => { const s = document.createElement('style'); s.textContent = 'body{outline:3px solid red}'; document.head.append(s); return getComputedStyle(document.body).outlineStyle; });
    ok(control === 'none', `control: the page's own inline <style> is refused (outline-style ${control})`);

    await store(null, PARTS);
    await until(async () => (await root$('--gz-enter')).startsWith('gz-x-'), 8000, 'the Look\'s entrance');
    const enter = await root$('--gz-enter');
    ok(/^gz-x-[0-9a-z]+ 740ms linear\(.*\) backwards$/.test(enter), `--gz-enter reads the compiled knob (the spring easing resolved): ${enter.slice(0, 40)}…`);
    ok((await root$('--gz-stagger')) === '90ms', `--gz-stagger 90ms`);
    const lift = await root$('--gz-lift'), t = await root$('--gz-t-hover'), press = await root$('--gz-press');
    ok(lift === 'translate(0px,-8px) scale(1.04)' && t === '220ms' && press === '0.88', `hover and press: lift ${lift}; hover time ${t}; press ${press}`);
    const c1 = await card();
    ok(c1.name === enter.split(' ')[0] && c1.duration === '0.74s', `a card runs it: animation-name ${c1.name}, ${c1.duration}`);
    // Hover: the card's own state, reached over the Look's time.
    await pause(1200);
    const held = () => page.evaluate(() => { const s = getComputedStyle(document.querySelector('article.element-card')); return { transform: s.transform, filter: s.filter }; });
    const rest = await held();
    await page.hover('article.element-card');
    await pause(500);
    const hot = await held();
    const ty = Number((hot.transform.match(/matrix\(([^)]*)\)/)?.[1].split(',')[5]) ?? NaN);
    ok(rest.transform === 'none' && Math.abs(ty + 8) < 0.01 && /brightness\(1\.08\)/.test(hot.filter), `a hovered card takes the Look's state: transform ${hot.transform}, filter ${hot.filter} (at rest ${rest.transform})`);
    await page.mouse.move(5, 5);
    ok(await page.evaluate(() => !document.getElementById('gz-motionx')), 'no <style> element was added: the sheet is constructed (adoptedStyleSheets)');
    ok(await page.evaluate(() => document.adoptedStyleSheets.length === 1 && [...document.adoptedStyleSheets[0].cssRules].some((r) => r.type === CSSRule.KEYFRAMES_RULE)), 'one adopted sheet, with the keyframes in it');
    ok(await page.evaluate(() => [...document.styleSheets].every((s) => !s.ownerNode || s.ownerNode.tagName !== 'STYLE' || !/gz-x-/.test(s.cssRules ? [...s.cssRules].map((r) => r.cssText).join('') : ''))), 'and none of it in a <style>');

    // The knobs still have the last word.
    await store(ULTRA_SETTINGS({ level: 'off' }));
    await until(async () => (await root$('--gz-enter')) === 'none', 6000, 'motion off to zero the entrance');
    ok((await card()).name === 'none' && (await root$('--gz-x-enter')).startsWith('gz-x-'), 'motion off: no animation on the card, while the Look\'s value is still there (nothing new checks it)');
    ok((await root$('--gz-lift')) === 'none' && (await root$('--gz-press')) === 'none' && (await root$('--gz-t-hover')) === '0s' && (await root$('--gz-stagger')) === '0s', 'motion off: lift, press, hover time and stagger all zero');
    for (const [sw, knobs] of [['enter', { '--gz-enter': 'none', '--gz-stagger': '0s' }], ['hover', { '--gz-lift': 'none', '--gz-press': 'none' }], ['transitions', { '--gz-t-hover': '0s' }]]) {
      await store(ULTRA_SETTINGS({ [sw]: false }));
      await until(async () => page.evaluate((a) => document.documentElement.hasAttribute(a), { enter: 'data-gz-no-enter', hover: 'data-gz-no-hover', transitions: 'data-gz-no-trans' }[sw]), 6000, `the ${sw} switch`);
      const got = Object.fromEntries(await Promise.all(Object.keys(knobs).map(async (k) => [k, await root$(k)])));
      ok(JSON.stringify(got) === JSON.stringify(knobs), `the ${sw} switch off: ${JSON.stringify(got)}`);
      if (sw === 'enter') ok((await card()).name === 'none', 'the ${sw} switch off: the card does not animate'.replace('${sw}', sw));
      else ok((await root$('--gz-enter')).startsWith('gz-x-'), `the ${sw} switch off leaves the entrance alone`);
    }
    await store(ULTRA_SETTINGS({ followSystem: true }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await until(async () => (await page.evaluate(() => document.documentElement.getAttribute('data-gz-motion'))) === 'off', 6000, 'reduced motion');
    ok((await root$('--gz-enter')) === 'none' && (await card()).name === 'none', 'reduced motion (follow the system): nothing animates');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await store(ULTRA_SETTINGS());
    await until(async () => (await root$('--gz-enter')).startsWith('gz-x-'), 6000, 'the entrance back');

    // An effect on a completion: the real path, a review circle turning to done.
    console.log('\n-- the effects --');
    const circle = () => page.evaluate(() => {
      document.getElementById('probe')?.remove();
      const item = document.createElement('div');
      Object.assign(item.style, { position: 'fixed', left: '60px', top: '60px', zIndex: '2147483647' });
      item.id = 'probe'; item.className = 'content-list-item';
      const b = document.createElement('button');
      b.className = 'js-review-state-icon-button'; b.setAttribute('role', 'checkbox'); b.setAttribute('aria-checked', 'false');
      Object.assign(b.style, { width: '24px', height: '24px', display: 'block' });
      item.append(b);
      document.body.append(item);
    });
    const complete = async () => { await circle(); await pause(300); await page.click('#probe button'); await page.evaluate(() => document.querySelector('#probe button').setAttribute('aria-checked', 'true')); };
    await complete();
    await until(canvas, 2000, 'the canvas for a completion');
    const cv = await canvas();
    ok(cv.aria === 'true' && cv.events === 'none' && cv.position === 'fixed' && cv.parent === 'BODY', `one canvas: aria-hidden ${cv.aria}, pointer-events ${cv.events}, ${cv.position}, in ${cv.parent}`);
    ok(await page.evaluate(() => !document.querySelector('.gz-burst')), 'a Look with its own effect has no built-in dots');
    const alive = Date.now();
    await gone();
    ok(true, `the canvas is removed once nothing is alive (${Date.now() - alive} ms after the effect started drawing; life 900)`);
    await page.screenshot({ path: path.join(out, 'page-after.png') });
    await store(null, { anim: ANIM });
    await until(async () => !(await page.evaluate(() => !!document.getElementById('gz-fx'))), 2000, 'idle');
    await complete();
    await pause(500);
    ok(!(await canvas()) && await page.evaluate(() => !!document.querySelector('.gz-burst')), 'with no effect in the Look, Expressive\'s dots are still the completion');
    await store(ULTRA_SETTINGS({ level: 'subtle' }), PARTS);
    await until(async () => (await page.evaluate(() => document.documentElement.getAttribute('data-gz-motion'))) === 'subtle', 6000, 'subtle');
    await pause(700);
    await complete();
    await until(canvas, 2000, 'the canvas at Subtle');
    ok(true, 'a Look\'s effect plays at Subtle too');
    await gone();
    await store(ULTRA_SETTINGS({ level: 'off' }), PARTS);
    await until(async () => (await page.evaluate(() => document.documentElement.getAttribute('data-gz-motion'))) === 'off', 6000, 'off');
    await complete();
    await pause(700);
    ok(!(await canvas()) && await page.evaluate(() => !document.querySelector('.gz-burst')), 'motion off: no effect and no dots on a completion');

    // The pointer.
    console.log('\n-- the pointer --');
    await store(ULTRA_SETTINGS({ level: 'subtle' }), PARTS);
    await until(async () => (await page.evaluate(() => document.documentElement.getAttribute('data-gz-motion'))) === 'subtle', 6000, 'subtle');
    await pause(700);
    await page.mouse.move(100, 200);
    for (let i = 0; i < 12; i++) await page.mouse.move(100 + i * 30, 200 + i * 10);
    await until(canvas, 1500, 'the trail canvas');
    ok(true, 'moving the pointer draws a trail');
    await page.screenshot({ path: path.join(out, 'page-trail.png') });
    const t0 = Date.now();
    await gone();
    ok(true, `and the canvas goes ${Date.now() - t0} ms after the pointer rests (fade ${CURSOR.fade} ms)`);
    await page.evaluate(() => { for (let i = 0; i < 6; i++) document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 50 + i * 20, clientY: 80, bubbles: true })); });
    await pause(400);
    ok(!(await canvas()), 'a touch pointer draws nothing');
    for (const kind of ['sparkle', 'ripple', 'glow']) {
      await store(null, { cursor: { ...CURSOR, kind } });
      await pause(300);
      for (let i = 0; i < 14; i++) await page.mouse.move(200 + i * 40, 300 + (i % 3) * 30);
      if (kind === 'ripple') await page.mouse.down(), await page.mouse.up();
      await until(canvas, 1500, `the ${kind} canvas`);
      ok(true, `${kind} draws`);
      await gone();
    }
    await store(ULTRA_SETTINGS({ level: 'subtle', hover: false }), PARTS);
    await until(async () => page.evaluate(() => document.documentElement.hasAttribute('data-gz-no-hover')), 6000, 'the hover switch');
    for (let i = 0; i < 10; i++) await page.mouse.move(300 + i * 30, 100);
    await pause(300);
    ok(!(await canvas()), 'with hover effects switched off the pointer draws nothing');
    await store(ULTRA_SETTINGS({ level: 'off' }), PARTS);
    await until(async () => (await page.evaluate(() => document.documentElement.getAttribute('data-gz-motion'))) === 'off', 6000, 'off');
    for (let i = 0; i < 10; i++) await page.mouse.move(300 + i * 30, 160);
    await pause(300);
    ok(!(await canvas()), 'motion off: the pointer draws nothing');

    // Gone with the Look, and never on a quiz.
    console.log('\n-- turning off, and a quiz --');
    await store(ULTRA_SETTINGS({ level: 'subtle' }), null);
    await until(async () => (await root$('--gz-x-enter')) === '' && (await root$('--gz-enter')).startsWith('gz-in '), 6000, 'the Look\'s CSS to go');
    ok(await page.evaluate(() => document.adoptedStyleSheets.length === 0), 'a Look without parts: the sheet is gone and the built-in entrance is back');
    await store(null, PARTS);
    await until(async () => (await root$('--gz-enter')).startsWith('gz-x-'), 6000, 'the Look again');
    await store({ ...ULTRA_SETTINGS({ level: 'subtle' }), enabled: false });
    await until(async () => (await root$('--gz-x-enter')) === '', 6000, 'Glaze off to take the Look away');
    ok(await page.evaluate(() => document.adoptedStyleSheets.length === 0 && !document.getElementById('gz-fx')), 'Glaze turned off takes the Look\'s CSS away with the rest');
    await store(ULTRA_SETTINGS({ level: 'subtle' }), PARTS);
    const quiz = await ctx.newPage();
    quiz.on('pageerror', (e) => errors.push(`quiz: ${e}`));
    await quiz.goto(`${SITE}/ultra/courses/_101_1/assessment/_5_1`);
    await quiz.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
    await pause(1200);
    ok(await quiz.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-x-enter').trim() === '' && document.adoptedStyleSheets.length === 0), 'a quiz: none of the Look\'s CSS');
    await quiz.evaluate(() => {
      const item = document.createElement('div');
      Object.assign(item.style, { position: 'fixed', left: '60px', top: '60px', zIndex: '2147483647' }); item.className = 'content-list-item';
      const b = document.createElement('button'); b.className = 'js-review-state-icon-button'; b.setAttribute('role', 'checkbox'); b.setAttribute('aria-checked', 'false');
      Object.assign(b.style, { width: '24px', height: '24px', display: 'block' }); item.append(b); document.body.append(item);
    });
    await pause(300);
    await quiz.click('.js-review-state-icon-button');
    await quiz.evaluate(() => document.querySelector('.js-review-state-icon-button').setAttribute('aria-checked', 'true'));
    for (let i = 0; i < 12; i++) await quiz.mouse.move(100 + i * 30, 200);
    await pause(600);
    ok(await quiz.evaluate(() => !document.getElementById('gz-fx') && !document.querySelector('.gz-burst')), 'a quiz: a completion and the pointer draw nothing');
    await quiz.close();

    // ---- the boards' course cards: Glaze's own, on the Courses page's board; the Look's card entrance plays on them too ----
    console.log("\n-- the board's course cards --");
    await page.close(); // done with: a settings change under it (the sidebar's) would crossfade a page nobody sees
    const W = require(path.join(root, 'lib/widgets.js'));
    const lay = W.layout({ todo: true });
    for (const b of ['courses', 'dash', 'pages']) for (const x of lay.boards[b]) x.on = false;
    const cards = ['_100_1', '_101_1', '_102_1', '_103_1'].map((cid) => ({ id: `course:${SITE}/${cid}`, on: true, size: 's' }));
    // Another tile between them: the stagger counts course cards only.
    lay.boards.courses = [...lay.boards.courses.filter((x) => x.id !== 'timer'), ...cards.slice(0, 2), { id: 'timer', on: true, size: 's' }, ...cards.slice(2)];
    await opts.evaluate((l) => chrome.storage.local.set({ widgetLayout: l }), W.layout(lay));
    // The column board (the sidebar's dock would take the timer off the board).
    const BOARD_SETTINGS = (motion) => { const st = ULTRA_SETTINGS(motion); return { ...st, enhance: { ...st.enhance, sidebar: false } }; };
    await store(BOARD_SETTINGS(), PARTS);
    const board = await ctx.newPage();
    board.on('pageerror', (e) => errors.push(`board: ${e}`));
    await board.goto(`${SITE}/ultra/course`);
    const TILE = '.gz-w[data-tile^="course:"]';
    await until(() => board.evaluate((sel) => document.querySelectorAll(sel).length === 4, TILE), 10000, "the board's course cards");
    const tiles = () => board.evaluate((sel) => [...document.querySelectorAll(sel)].map((t) => { const s = getComputedStyle(t); return { name: s.animationName, delay: s.animationDelay }; }), TILE);
    const bRoot = (n) => board.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), n);
    await until(async () => (await bRoot('--gz-x-enter')).startsWith('gz-x-'), 8000, "the Look's entrance on the board page");
    const cardName = (await bRoot('--gz-x-enter')).split(' ')[0], tileName = (await bRoot('--gz-x-enter-tile')).split(' ')[0];
    const t1 = await tiles();
    ok(t1.every((t) => t.name === `${tileName}, ${cardName}`), `each course card on the board plays the Look's card entrance after its tile's: ${t1[0].name}`);
    const order = await board.evaluate(() => [...document.querySelector('.gz-w[data-tile="timer"]').parentElement.children].map((e) => (e.dataset.tile?.startsWith('course:') ? 'card' : e.dataset.tile)).filter(Boolean).join(' '));
    ok(/timer.*card/.test(order) && JSON.stringify(t1.map((t) => t.delay)) === JSON.stringify(['0s, 0s', '0s, 0.09s', '0s, 0.18s', '0s, 0.27s']), `staggered by the Look's 90 ms, course cards only (${order}): ${t1.map((t) => t.delay).join(' | ')}`);
    ok(await board.evaluate(() => getComputedStyle(document.querySelector('.gz-w[data-tile="timer"]')).animationName) === tileName, 'another tile plays only the tile entrance');
    ok(await board.evaluate(() => [...document.querySelectorAll('.gz-w-body > .gz-course-card')].every((c) => getComputedStyle(c).animationName === 'none')), 'Ultra: no second entrance on the inner card');
    await board.screenshot({ path: path.join(out, 'board-enter.png') });
    for (const [label, settings, attr] of [['motion off', BOARD_SETTINGS({ level: 'off' }), null], ['the entrances switch off', BOARD_SETTINGS({ enter: false }), 'data-gz-no-enter']]) {
      await store(settings);
      await until(async () => board.evaluate((a) => (a ? document.documentElement.hasAttribute(a) : document.documentElement.getAttribute('data-gz-motion') === 'off'), attr), 6000, label);
      const t = await tiles();
      ok(t.every((x) => x.name.split(', ').every((n) => n === 'none')), `${label}: no entrance on the board's cards (${t[0].name})`);
    }
    await board.emulateMedia({ reducedMotion: 'reduce' });
    await store(BOARD_SETTINGS({ followSystem: true }));
    await until(() => board.evaluate(() => document.documentElement.dataset.gzMotion === 'off'), 6000, 'Ultra board follows reduced motion');
    ok((await tiles()).every((t) => t.name.split(', ').every((n) => n === 'none')), 'Ultra: reduced motion stops board entrances');
    await store(BOARD_SETTINGS(), null);
    await until(async () => (await bRoot('--gz-x-enter')) === '', 6000, 'the Look off the board page');
    ok((await tiles()).every((t) => t.name.split(', ').every((n) => n === 'none')), "without a Look, the board's cards keep still, as before");
    await board.close();
    // Canvas uses the same tile entrance, while apps.css suppresses its native card entrance inside the tile.
    const canvasLayout = W.layout({});
    canvasLayout.boards.cdash = ['27', '25', '28', '26'].map((cid) => ({ id: `course:${CANVAS}/${cid}`, on: true, size: 's' }));
    await opts.evaluate((l) => chrome.storage.local.set({ widgetLayout: l }), canvasLayout);
    await store(BOARD_SETTINGS(), PARTS);
    const canvasBoard = await ctx.newPage();
    canvasBoard.on('pageerror', (e) => errors.push(`canvas: ${e}`));
    await canvasBoard.goto(`${CANVAS}/`);
    await until(() => canvasBoard.evaluate((sel) => document.querySelectorAll(sel).length === 4, TILE), 10000, 'Canvas board course cards');
    const canvasNames = () => canvasBoard.evaluate((sel) => [...document.querySelectorAll(sel)].map((t) => getComputedStyle(t).animationName), TILE);
    await until(async () => (await canvasNames()).every((n) => n === `${tileName}, ${cardName}`), 6000, 'Canvas board Look entrance');
    ok(true, 'Canvas: the board plays the tile and card entrances');
    ok(await canvasBoard.evaluate(() => [...document.querySelectorAll('.ic-DashboardCard[data-gz-tile-card]')].every((c) => getComputedStyle(c).animationName === 'none')), 'Canvas: no second entrance on the inner card');
    await canvasBoard.evaluate(() => document.documentElement.setAttribute('data-gz-vt-in', ''));
    ok((await canvasNames()).every((n) => n.split(', ').at(-1) === 'none'), 'Canvas: a page-change transition suppresses the card entrance');
    await canvasBoard.evaluate(() => document.documentElement.removeAttribute('data-gz-vt-in'));
    await canvasBoard.emulateMedia({ reducedMotion: 'reduce' });
    await store(BOARD_SETTINGS({ followSystem: true }));
    await until(() => canvasBoard.evaluate(() => document.documentElement.dataset.gzMotion === 'off'), 6000, 'Canvas board follows reduced motion');
    ok((await canvasNames()).every((n) => n.split(', ').every((a) => a === 'none')), 'Canvas: reduced motion stops board entrances');
    await store(BOARD_SETTINGS(), null);
    await until(async () => (await canvasNames()).every((n) => n.split(', ').every((a) => a === 'none')), 6000, 'Canvas board without a Look');
    ok(true, 'Canvas: without a Look, the board keeps still');
    await canvasBoard.close();
    await opts.evaluate(() => chrome.storage.local.remove('widgetLayout'));
    await store(ULTRA_SETTINGS(), null);

    // ---- part 2: the options preview -----------------------------------------------------------------------------------------
    console.log('\n-- the options preview --');
    await store(ULTRA_SETTINGS({ level: 'subtle' }), null);
    const pv = await ctx.newPage();
    pv.on('pageerror', (e) => errors.push(`preview: ${e}`));
    await pv.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.__frames = [];
      window.requestAnimationFrame = (cb) => raf((t) => { const s = performance.now(); cb(t); window.__frames.push(performance.now() - s); });
    });
    await pv.goto(`chrome-extension://${id}/preview.html?site=ultra`);
    await pv.waitForFunction(() => document.documentElement.dataset.previewReady === 'true');
    // What the editor's frame is sent: the settings with the Look's parts (options.js); parts left out stay as they were.
    let shown = null;
    const say = (s, x) => {
      if (x !== undefined) shown = x && { x };
      return pv.evaluate(({ s, parts }) => { postMessage({ gzPreview: s, gzPreviewParts: parts }, location.origin); postMessage({ gzPreviewContext: { site: 'ultra', page: 'courses', viewport: 'desktop' } }, location.origin); }, { s, parts: shown });
    };
    const pRoot = (n) => pv.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), n);
    const pCanvas = () => pv.evaluate(() => !!document.getElementById('gz-fx'));
    await say(ULTRA_SETTINGS({ level: 'subtle' }));
    await until(async () => (await pv.evaluate(() => document.documentElement.getAttribute('data-gz-motion'))) === 'subtle', 6000, 'the preview to wear the settings');
    ok((await pRoot('--gz-enter')).startsWith('gz-in '), 'the preview without parts: the built-in entrance (Subtle)');
    await say(ULTRA_SETTINGS({ level: 'subtle' }), PARTS);
    await until(async () => (await pRoot('--gz-enter')).startsWith('gz-x-'), 8000, 'the Look in the preview');
    const pc = await pv.evaluate(() => { const c = document.querySelector('article.element-card'); const s = getComputedStyle(c); return { name: s.animationName, running: c.getAnimations().length }; });
    ok(/^gz-x-/.test(pc.name) && pc.running >= 1, `the preview's card runs the Look's entrance: ${pc.name}, ${pc.running} animation(s)`);
    await pv.screenshot({ path: path.join(out, 'preview-look.png') });
    // The two knobs with no built-in animation: dashboard tiles, and a rail's items once it is open.
    const tile = () => pv.evaluate(() => getComputedStyle(document.querySelector('.gz-w')).animationName);
    const rail = () => pv.evaluate(() => getComputedStyle(document.querySelector('nav[class*="makeStylesnavigation"] a')).animationName);
    ok(/^gz-x-/.test(await tile()), `a dashboard tile enters with the Look's animation: ${await tile()}`);
    ok((await rail()) === 'none', 'a closed rail does not animate');
    await pv.evaluate(() => document.documentElement.setAttribute('data-gz-nav-expanded', ''));
    ok(/^gz-x-/.test(await rail()), `an open rail's items play the Look's animation: ${await rail()}`);
    await pv.evaluate(() => document.documentElement.removeAttribute('data-gz-nav-expanded'));
    // The cost of an effect: the frames of a 60-piece confetti, measured as the page's own requestAnimationFrame calls.
    await pv.evaluate(() => { window.__frames.length = 0; });
    await say(ULTRA_SETTINGS({ level: 'subtle' }), { ...PARTS, fx: { complete: { kind: 'confetti', count: 60, shapes: ['star', 'heart', 'dot', 'leaf'], c: ['accent', 'warn', 'ok', '#ff00aa'], spread: 180, gravity: 1, life: 2500, size: 14 } } });
    await pause(400);
    await pv.evaluate(() => { window.__frames.length = 0; });
    await pv.evaluate(() => GZ_CTX.moment('complete'));
    await until(() => pCanvas(), 1500, 'the preview canvas');
    await pause(450);
    await pv.screenshot({ path: path.join(out, 'preview-confetti.png') });
    await until(async () => !(await pCanvas()), 5000, 'the preview canvas to go');
    const frames = await pv.evaluate(() => [...window.__frames]);
    const sorted = [...frames].sort((a, b) => a - b), mean = frames.reduce((a, b) => a + b, 0) / frames.length;
    console.log(`     60 pieces over 2.5 s: ${frames.length} frames, callback mean ${mean.toFixed(2)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(2)} ms, max ${sorted.at(-1).toFixed(2)} ms (headless, software canvas)`);
    ok(frames.length > 20 && sorted[Math.floor(sorted.length * 0.95)] < 8, 'the busiest effect stays inside a frame (p95 under 8 ms)');
    await pause(300);
    const idle = await pv.evaluate(() => window.__frames.length);
    await pause(600);
    ok((await pv.evaluate(() => window.__frames.length)) === idle, 'no frame is asked for once the effect is over');
    // Motion off in the preview.
    await say(ULTRA_SETTINGS({ level: 'off' }));
    await until(async () => (await pv.evaluate(() => document.documentElement.getAttribute('data-gz-motion'))) === 'off', 6000, 'off in the preview');
    ok((await pRoot('--gz-enter')) === 'none' && (await pv.evaluate(() => getComputedStyle(document.querySelector('article.element-card')).animationName)) === 'none', 'the preview with motion off: no animation');
    await pv.evaluate(() => document.documentElement.setAttribute('data-gz-nav-expanded', ''));
    ok((await tile()) === 'none' && (await rail()) === 'none', 'and none on a tile or an open rail');
    await pv.evaluate(() => GZ_CTX.moment('complete'));
    await pause(500);
    ok(!(await pCanvas()), 'and no effect');
    await pv.close();
    ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    ok(external.length === 0, `nothing left the machine${external.length ? `: ${[...new Set(external)].join(' ')}` : ''}`);
  } finally {
    await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${fails ? `FAILED (${fails})` : 'passed'}; screenshots in ${out}`);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
