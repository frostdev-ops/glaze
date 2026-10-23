// A whole Look at once, headless: one glaze2 Look with a shader background, animations, event effects, a cursor effect, a nav
// layout and 20 rules, put on the Ultra preview page (an extension page: it has no page policy) and on the saved Canvas and
// Moodle pages (test/fixtures) under invented school origins, each with a strict and a permissive page Content-Security-Policy.
// A minimal served Ultra page under the strict one adds the parts that don't need Ultra's markup. Every other request is aborted
// and DNS resolves nowhere; no LMS or account is needed.
//   NODE_PATH=/path/to/node_modules nice node scripts/mods-combined-check.js [screenshots directory] [--only=<scenario id>]
//   scenario ids: ultra-preview canvas-strict canvas-open moodle-strict moodle-open ultra-served
// It checks, for each page: everything applies (the shader's canvas, the animations, an effect and the pointer's, the nav
// layout, the rules of that LMS); that motion off stops all motion (no animation frame asked for, no canvas, no keyframes) and
// the rest stays; that taking the Look off, and turning Glaze off with the Look worn, leave the page exactly as it is without
// it; that a quiz page gets none of it; and what a pass costs with and without the Look. Once, at the start: the Look goes in
// through the editor as a pasted code and comes out as an exported one, and the two are the same Look.
// One browser at a time across agents; its profile is temporary and it is deleted whatever happens.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// A copy holding the schools' hosts, as the student's grant does (scripts/check-env.js staged).
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://ultra.school.test/*', 'https://strict.moodle.test/*', 'https://open.moodle.test/*']); // the id is made from the real path
const out = process.argv.slice(2).find((a) => !a.startsWith('--'));
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const G = require(path.join(ext, 'defaults.js'));
const GLSL = require(path.join(ext, 'lib/glsl.js'));
const PARTS = require(path.join(ext, 'lib/parts.js'));
// Node cleans a code as the page does only with the checker and the registry loaded.
globalThis.GZ_GLSL = GLSL;
globalThis.GZ_PARTS = PARTS;
const S = require(path.join(ext, 'lib/share.js'));
const X = require(path.join(ext, 'lib/lookparts.js'));
const chromeLaunch = require('./check-env.js').chromeLaunch();
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the Look ------------------------------------------------------------------------------------------------------------
const SHADER = fs.readFileSync(path.join(ext, 'assets/shaders/aurora.glsl'), 'utf8');
const LINK = { id: 'library0000a', n: 'Library', u: 'https://library.example.edu/', i: 'book' };
const RULES = [
  // Blackboard Ultra
  { p: 'ultra.course-card.title', do: 'label', t: 'Mine' },
  { p: 'ultra.course-card', do: 'style', st: { r: 24, bw: 3, bc: 'accent', sh: 3 } },
  { p: 'ultra.nav.footer', do: 'hide' },
  { p: 'ultra.nav', do: 'style', st: { bg: '#331144', fg: '#ffffff' } }, // readable: a colour that would hide Glaze's item gives way
  { p: 'ultra.course-card.id', do: 'style', st: { fg: 'accent' } },
  { p: 'ultra.courses.term', do: 'style', st: { fg: 'accent-hi' } },
  { p: 'ultra.course-card.status', do: 'hide' },
  // Canvas
  { p: 'canvas.dashboard-card.title', do: 'label', t: 'Relabelled' },
  { p: 'canvas.dashboard-card', do: 'style', st: { r: 20, bg: 'accent-soft' } },
  { p: 'canvas.sidebar.todo', do: 'hide' },
  { p: 'canvas.footer', do: 'hide' },
  { p: 'canvas.dashboard-header', do: 'style', st: { fg: 'accent' } },
  { p: 'canvas.dashboard-card.subtitle', do: 'style', st: { o: 70 } },
  { p: 'canvas.global-nav.logo', do: 'hide' },
  // Moodle
  { p: 'moodle.course-card.title', do: 'label', t: 'Renamed course' },
  { p: 'moodle.course-card', do: 'style', st: { r: 16 } },
  { p: 'moodle.footer.help', do: 'hide' },
  { p: 'moodle.page-header', do: 'style', st: { bg: 'surface', p: 5, r: 16 } },
  { p: 'moodle.block.recentlyaccesseditems', do: 'move', to: 'moodle.block.calendar-month', at: 'before' },
  { p: 'moodle.course-card.progress', do: 'hide' },
];
const X_PARTS = {
  bg: { shader: { src: SHADER } },
  anim: {
    'card.enter': { s: [{ at: 0, y: 24, sc: 0.9, o: 0 }, { at: 0.6, y: -4, sc: 1.03, o: 1 }, { at: 1, y: 0, sc: 1 }], ms: 700, ease: 'spring', delay: 40, stagger: 90 },
    'tile.enter': { s: [{ at: 0, o: 0, x: -20 }, { at: 1, o: 1, x: 0 }], ms: 300 },
    'card.hover': { s: [{ at: 0 }, { at: 1, y: -8, sc: 1.04, br: 1.08 }], ms: 220, ease: [0.3, 1.5, 0.5, 1] },
    'button.press': { s: [{ at: 0 }, { at: 1, sc: 0.88 }] },
  },
  fx: { complete: { kind: 'confetti', count: 40, shapes: ['star', 'heart', 'dot'], c: ['accent', '#ff8800', 'ok'], spread: 120, gravity: 1, life: 900, size: 10 } },
  cursor: { kind: 'trail', c: ['accent', 'warn'], size: 12, len: 12, fade: 400 },
  nav: { place: 'top', groups: [{ label: 'Study', items: ['course', 'calendar', 'w:clock'] }, { label: 'Me', items: ['messages', `link:${LINK.id}`, 'profile'] }], hidden: ['help'], links: [LINK], icons: { calendar: 'star' } },
  rules: RULES,
};
// The LMS's own nav: Glaze's bar (on by default) wears a layout in its place.
const BASE = G.GZ_SANITIZE({ preset: 'Paper', colors: G.GZ_PRESET('Paper'), motion: { level: 'expressive', followSystem: false }, navbar: { on: false } });
// The Look's palette is light like the base one (an accent of its own): a switch between a dark and a light palette re-tags the page's icons
// (Glaze's own lift), which is not what the parts leave behind, and this check asks about the parts.
const LOOK = G.GZ_SANITIZE({ colors: { ...G.GZ_PRESET('Paper'), '--gz-accent': '#7c3aed' }, look: { radius: 14 }, bg: { kind: 'shader' } });

// ---- the pages -----------------------------------------------------------------------------------------------------------
const STRICT = "default-src 'self'; style-src 'self'; script-src 'self'; img-src * data: blob:; font-src * data:; connect-src 'self'; object-src 'none'; base-uri 'self'";
const fixture = (name) => fs.readFileSync(path.join(ext, 'test/fixtures', name), 'utf8');
const strip = (html, css) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '').replace('</head>', `<style>${css}</style></head>`);
// Stand-ins for each LMS's own frame CSS (not fetched): Canvas's fixed rail beside #wrapper, Moodle's fixed navbar.
const CANVAS_CSS = `body { margin: 0; font: 14px/1.4 system-ui, sans-serif; }
  #header { position: fixed; inset: 0 auto 0 0; width: 84px; display: flex; flex-direction: column; }
  #header ul { list-style: none; margin: 0; padding: 0; } #header a { display: block; padding: 8px 4px; text-align: center; font-size: 11px; }
  #header .menu-item-icon-container svg, #header .ic-avatar img { width: 26px; height: 26px; } #skip_navigation_link { position: absolute; left: -9999px; }
  #wrapper { margin-left: 84px; } #content { padding: 24px; } .screenreader-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }`;
const MOODLE_CSS = `body { margin: 0; font: 14px/1.4 system-ui, sans-serif; }
  nav.navbar.fixed-top { position: fixed; inset: 0 0 auto 0; height: 60px; display: flex; align-items: center; z-index: 1030; }
  nav.navbar .container-fluid { display: flex; align-items: center; width: 100%; } .navbar-nav { display: flex; list-style: none; margin: 0; padding: 0; }
  .d-none, .visually-hidden { display: none !important; } .mds-nav-pill { display: inline-flex; padding: 8px 12px; } #page-wrapper { padding-top: 60px; }
  .drawer, [data-region="drawer"] { display: none; }`;
const CANVAS_DASH = strip(fixture('canvas-dashboard-cards.html'), CANVAS_CSS), CANVAS_QUIZ = strip(fixture('canvas-quiz-take.html'), CANVAS_CSS);
const CANVAS_COURSE = strip(fixture('canvas-course-home.html'), CANVAS_CSS);
const MOODLE_DASH = strip(fixture('moodle-dashboard.html'), MOODLE_CSS), MOODLE_QUIZ = strip(fixture('moodle-quiz.html'), MOODLE_CSS);
const ULTRA_HTML = '<!doctype html><html><head><base href="https://ultra.school.test/ultra/"><title>Course</title></head><body><main id="app"><h1>A course</h1><article class="element-card course-element-card"><div class="course-title">A course</div></article></main></body></html>';

const SCENARIOS = [
  { id: 'ultra-preview', site: 'ultra', preview: true, label: 'Ultra preview', card: 'article.course-element-card' },
  { id: 'canvas-strict', site: 'canvas', origin: 'https://strict.school.instructure.com', csp: STRICT, label: 'Canvas, strict CSP', card: '.ic-DashboardCard', home: '/', quiz: '/courses/25/quizzes/7/take', ready: '.ic-DashboardCard' },
  { id: 'canvas-open', site: 'canvas', origin: 'https://open.school.instructure.com', csp: null, label: 'Canvas, permissive CSP', card: '.ic-DashboardCard', home: '/', quiz: '/courses/25/quizzes/7/take', ready: '.ic-DashboardCard' },
  { id: 'moodle-strict', site: 'moodle', origin: 'https://strict.moodle.test', csp: STRICT, label: 'Moodle, strict CSP', card: '.course-card', home: '/my/', quiz: '/mod/quiz/attempt.php', ready: '.block_calendar_month' },
  { id: 'moodle-open', site: 'moodle', origin: 'https://open.moodle.test', csp: null, label: 'Moodle, permissive CSP', card: '.course-card', home: '/my/', quiz: '/mod/quiz/attempt.php', ready: '.block_calendar_month' },
  { id: 'ultra-served', site: 'ultra', origin: 'https://ultra.school.test', csp: STRICT, label: 'Ultra, strict CSP (a served page: parts only)', home: '/ultra/courses/_1_1/outline', quiz: '/ultra/courses/_1_1/assessment/_9_1', ready: 'article.course-element-card', served: true },
];

// ---- what is reported ----------------------------------------------------------------------------------------------------
const results = [];
const numbers = {};
let section = '';
const check = (name, pass, detail = '') => { results.push({ section, name, pass: !!pass, detail }); console.log(`${pass ? 'ok  ' : 'FAIL'} ${section ? `[${section}] ` : ''}${name}${pass ? '' : ` ${String(detail).slice(0, 400)}`}`); return !!pass; };
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const until = async (fn, ms = 10000, step = 80) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await pause(step); } return v; };

(async () => {
  // The Look as the editor would code it, before any browser: what a code of it looks like.
  const rulesClean = PARTS.rules(RULES);
  check('the 20 rules all clean against the registry, and the shader against the checker', rulesClean.length === 20 && GLSL.check(SHADER).ok, `${rulesClean.length} rules; ${JSON.stringify(GLSL.check(SHADER).errors)}`);
  const bundle = X.bundle({ x: X_PARTS });
  check('and the whole of the parts comes back from the cleaner unchanged', bundle && X.same(bundle, { x: X_PARTS }), JSON.stringify(bundle)?.slice(0, 200));
  const code = await S.encode(LOOK, undefined, { x: X_PARTS });
  numbers.codeChars = code.length;
  numbers.partsJsonBytes = Buffer.byteLength(JSON.stringify(X.compact(bundle.x)));
  check(`the code is glaze2 and fits (${code.length} characters, ${numbers.partsJsonBytes} bytes of parts JSON)`, code.startsWith('glaze2:') && code.length <= 20000, code.slice(0, 20));

  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-combined-')));
  const errors = [], external = [];
  let ctx;
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), {
      ...chromeLaunch, headless: true, viewport: { width: 1280, height: 860 }, locale: 'en-US', timezoneId: 'America/New_York',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    ctx.setDefaultTimeout(15000);
    const pages = new Map(); // url -> [html, csp]
    for (const sc of SCENARIOS.filter((s) => s.origin)) {
      const pick = { canvas: [CANVAS_DASH, CANVAS_QUIZ], moodle: [MOODLE_DASH, MOODLE_QUIZ], ultra: [ULTRA_HTML, ULTRA_HTML] }[sc.site];
      pages.set(sc.origin + sc.home, [pick[0], sc.csp]);
      pages.set(sc.origin + sc.quiz, [pick[1], sc.csp]);
      if (sc.site === 'canvas') pages.set(`${sc.origin}/courses/25`, [CANVAS_COURSE, sc.csp]);
    }
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      const hit = route.request().method() === 'GET' && pages.get(u.origin + u.pathname);
      if (hit) return route.fulfill({ contentType: 'text/html', body: hit[0], headers: hit[1] ? { 'content-security-policy': hit[1] } : {} });
      if (u.pathname.startsWith('/api/v1/')) return route.fulfill({ contentType: 'application/json', body: u.pathname.endsWith('/self') || u.pathname.endsWith('/profile') ? '{"id":"3"}' : '[]' });
      if (u.pathname.startsWith('/learn/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      external.push(route.request().url());
      return route.abort();
    });

    // ---- the editor: the code goes in, and comes out again --------------------------------------------------------------
    section = 'editor';
    const opts = await ctx.newPage();
    opts.on('pageerror', (e) => errors.push(`editor: ${e}`));
    await opts.goto(`chrome-extension://${id}/options.html`);
    // The student's yes to the invented schools outside the built-in hosts, and the widget layout of a device Glaze was on
    // before: a fresh Canvas Dashboard's board takes the course cards (Glaze's own, which rules and entrances leave alone).
    await opts.evaluate(async () => { await chrome.storage.local.set({ ultra: ['https://ultra.school.test'], moodle: ['https://strict.moodle.test/*', 'https://open.moodle.test/*'] }); });
    await opts.evaluate((o) => chrome.storage.local.set(o), { widgetLayout: require(path.join(ext, 'lib/widgets.js')).kept(false), ultra: SCENARIOS.filter((s) => s.site === 'ultra' && s.origin).map((s) => s.origin), moodle: SCENARIOS.filter((s) => s.site === 'moodle').map((s) => `${s.origin}/*`) });
    const baseStore = () => { const { nav, ...patch } = BASE; return opts.evaluate((p) => chrome.storage.sync.set(p), patch); };
    await baseStore();
    await opts.reload();
    await opts.waitForSelector('#share-code');
    await opts.fill('#share-code', code);
    await opts.click('#share-try');
    await opts.waitForSelector('#share-offer:not([hidden])');
    const offer = await opts.evaluate(() => document.querySelector('#share-what').textContent);
    // Each rule's part by its name, and each text it writes word for word (lib/lookparts.js describe).
    const offered = RULES.every((r) => offer.includes(PARTS.get(r.p).label)) && RULES.filter((r) => r.do === 'label').every((r) => offer.includes(`“${r.t}”`));
    check('the editor\'s offer names what the code brings', /shader/i.test(offer) && /Rearranges the navigation/.test(offer) && offered && /cursor/i.test(offer), offer);
    await opts.click('#share-apply');
    const stored = await until(() => opts.evaluate(async () => { const r = await chrome.storage.sync.get(['lookX', 'bg']); return typeof r.lookX === 'string' && r.lookX.startsWith('x1:') ? { len: r.lookX.length, kind: r.bg?.kind } : null; }));
    check('using the code stores the parts in sync beside bg.kind shader', stored?.kind === 'shader', JSON.stringify(stored));
    numbers.storedLookXChars = stored?.len;
    await opts.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { value: async (t) => { window.__copied = t; }, configurable: true }); });
    await opts.click('#share-copy');
    const exported = await until(() => opts.evaluate(() => window.__copied || ''));
    const [a, b] = [await S.decode(code), await S.decode(exported)];
    check('the exported code is a glaze2 code, and the same Look as the one that went in', exported.startsWith('glaze2:') && X.same(a.parts, b.parts) && JSON.stringify([a.colors, a.look, a.bg]) === JSON.stringify([b.colors, b.look, b.bg]), `${exported.slice(0, 12)} ${exported.length} chars`);
    numbers.exportedChars = exported.length;
    numbers.exportedCodeIsByteIdentical = exported === code;
    // The Look as the editor holds it now: its settings and its parts, and the settings it replaced.
    const worn = await opts.evaluate(async () => { const s = await GZ_UI.load(); const { parts, ...settings } = s; return { settings, parts }; });
    // What is kept has the shader's comments stripped, as a code does.
    check('the editor holds the Look: shader background, the parts whole', worn.settings.bg.kind === 'shader' && X.same(worn.parts, { x: X.compact(X_PARTS) }), JSON.stringify(worn.parts)?.slice(0, 100));
    const save = async (settings, parts) => {
      // What a Look and the switches change; the editor writes only the keys it changed.
      const patch = Object.fromEntries(['enabled', 'colors', 'preset', 'auto', 'look', 'bg', 'motion'].map((k) => [k, settings[k]]));
      const r = await opts.evaluate(({ patch, parts }) => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:look', parts, patch: { ...patch, version: 2 } }, res)), { patch, parts });
      if (!r?.ok) throw new Error(`the Look was not saved: ${JSON.stringify(r)} (${Object.keys(patch).join(' ')})`);
    };
    const quizRuntime = async (page) => {
      const cdp = await ctx.newCDPSession(page), worlds = [];
      cdp.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
      try {
        await cdp.send('Runtime.enable');
        return !!(await until(async () => {
          const w = worlds.find((c) => c.origin === `chrome-extension://${id}` && c.auxData?.type === 'isolated');
          if (!w) return false;
          const r = await cdp.send('Runtime.evaluate', { contextId: w.id, expression: 'typeof GZ_CTX === "object" && typeof GZ_XPARTS_PAGE === "object" && GZ_CTX.parts() === null && (GZ_CTX.moment("complete"), true)', returnByValue: true });
          return !r.exceptionDetails && r.result?.value === true;
        }));
      } finally { await cdp.detach(); }
    };
    await save(BASE, null);

    // ---- the pages ---------------------------------------------------------------------------------------------------------
    if (only && !SCENARIOS.some((s) => s.id === only)) throw new Error(`unknown scenario: ${only}`);
    for (const sc of SCENARIOS) {
      if (only && only !== sc.id) continue;
      section = sc.id;
      console.log(`\n-- ${sc.label} --`);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${sc.id}: ${e}`));
      const wear = (settings, parts) => (sc.preview
        ? page.evaluate(({ s, parts }) => postMessage({ gzPreview: s, gzPreviewParts: parts }, location.origin), { s: settings, parts })
        : save(settings, parts));
      // Glaze's own world on the page (the page's script can't see it): a CDP context of the extension's. The preview is one world.
      const cdp = sc.preview ? null : await ctx.newCDPSession(page);
      const worlds = [];
      cdp?.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
      const world = async (expression) => {
        if (sc.preview) return page.evaluate(expression);
        const w = worlds.filter((c) => c.origin === `chrome-extension://${id}` && c.auxData?.type === 'isolated').at(-1);
        const r = w && await cdp.send('Runtime.evaluate', { contextId: w.id, expression, returnByValue: true, awaitPromise: true });
        if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r?.result?.value;
      };
      // Ignore only derived colour/geometry sweep tags, empty styles and Glaze's asynchronous To Do replacement. Keep native titles
      // (including one held by a tooltip) and the native sidebar. Strict CSP discards inline declarations before scripts
      // touch them, so compare the live CSSOM there: blocked text may vanish, but every effective declaration must return.
      const html$ = () => page.evaluate((strict) => {
        const copy = document.documentElement.cloneNode(true);
        const live = [document.documentElement, ...document.documentElement.querySelectorAll('*')];
        for (const [i, el] of [copy, ...copy.querySelectorAll('*')].entries()) {
          if (strict) { const css = live[i].style?.cssText; el.removeAttribute('style'); if (css) el.setAttribute('style', css); }
          if (el.hasAttribute('title') || el.hasAttribute('data-gz-title')) {
            const title = el.getAttribute('data-gz-title') ?? el.getAttribute('title');
            el.removeAttribute('title'); el.removeAttribute('data-gz-title'); el.setAttribute('title', title);
          }
          if (el.getAttribute('data-gz-aria') === '1') { el.removeAttribute('aria-label'); el.removeAttribute('data-gz-aria'); }
        }
        for (const n of copy.querySelectorAll('#gz-todo')) n.remove();
        // The root's attributes in one order: one that goes and comes back (data-gz-bg-key while a scene starts) is put last.
        const root = [...copy.attributes].map((a) => [a.name, a.value]).sort(([a], [b]) => (a < b ? -1 : 1));
        for (const [n] of root) copy.removeAttribute(n);
        for (const [n, v] of root) copy.setAttribute(n, v);
        // (A constructed stylesheet is not in the markup: its count goes on the end.)
        return copy.outerHTML.replace(/ style=""/g, '').replace(/ data-gz-(dark|light|hover|vh|fixed-bottom)=""/g, '') + `<!-- adopted: ${document.adoptedStyleSheets.length} -->`;
      }, !!sc.csp);
      const settle = async (quiet = 700) => {
        let last = await html$(), since = Date.now();
        const end = Date.now() + 15000;
        while (Date.now() < end) { await pause(100); const now = await html$(); if (now !== last) { last = now; since = Date.now(); } else if (Date.now() - since >= quiet) break; }
        return last;
      };
      // The tags that differ, up to three, as the attributes that changed (what it had → what it has).
      const attrs = (t) => Object.fromEntries([...t.matchAll(/([\w:.-]+)(?:="([^"]*)")?/g)].slice(1).map((m) => [m[1], m[2] ?? '']));
      const tagDiff = (x, y) => { const [p, q] = [attrs(x), attrs(y)]; return [...new Set([...Object.keys(p), ...Object.keys(q)])].filter((k) => p[k] !== q[k]).map((k) => `${k} ${JSON.stringify(q[k])} → ${JSON.stringify(p[k])}`).join('; ') || (() => { let i = 0; while (i < x.length && x[i] === y[i]) i++; return `text at ${i}: «${x.slice(Math.max(0, i - 30), i + 50)}» vs «${y.slice(Math.max(0, i - 30), i + 50)}»`; })(); };
      const diff = (a, b) => {
        const [x, y] = [a.split('<'), b.split('<')];
        const out = [];
        for (let i = 0, j = 0; (i < x.length || j < y.length) && out.length < 3; i++, j++) {
          if (x[i] === y[j]) continue;
          const k = y.indexOf(x[i], j);
          if (k > j && k - j < 6) { out.push(`gone «<${y.slice(j, k).join('<').slice(0, 160)}»`); j = k; i--; continue; }
          out.push(`<${(x[i] ?? '').split(/[\s>]/)[0]}> ${tagDiff(x[i] ?? '', y[j] ?? '')}`);
        }
        return out.join(' | ');
      };
      const same = async (want, label, ms = 12000) => {
        let got = await html$(); const end = Date.now() + ms;
        while (got !== want && Date.now() < end) { await pause(150); got = await html$(); }
        if (got === want) return check(label, true);
        got = await settle();
        return check(label, got === want, got === want ? '' : diff(got, want));
      };
      const leftover = () => page.evaluate(() => [...document.querySelectorAll('[style]')].some((e) => /--gz-(r|x)-/.test(e.getAttribute('style'))));
      const root$ = (n) => page.evaluate((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), n);

      if (sc.preview) {
        await page.goto(`chrome-extension://${id}/preview.html?site=ultra`);
        await until(() => page.evaluate(() => globalThis.GZ_CTX?.on()));
        await wear(BASE, null);
      } else {
        if (cdp) await cdp.send('Runtime.enable');
        await page.goto(sc.origin + sc.home);
        await until(() => page.evaluate((sel) => document.documentElement.style.getPropertyValue('--gz-accent') && (!sel || document.querySelector(sel)), sc.ready));
        await cdp.send('Runtime.disable'); await cdp.send('Runtime.enable'); // announce the worlds that exist now
      }
      await pause(500);
      const policy = await page.evaluate(() => { const s = document.createElement('style'); s.textContent = 'body{outline:3px solid red}'; document.head.append(s); const o = getComputedStyle(document.body).outlineStyle; s.remove(); return o; });
      if (!sc.preview) check(sc.csp ? 'control: the page\'s own inline <style> is refused (the policy is on)' : 'control: no policy', policy === (sc.csp ? 'none' : 'solid'), policy);

      if (sc.served) {
        // A minimal Ultra page: only what reaches it by storage and the parts' own hooks; the rail and the cards are not here.
        await wear(worn.settings, worn.parts);
        const ok = await until(() => world('JSON.stringify({ n: !!GZ_CTX.parts(), scene: !!document.getElementById("gz-scene"), x: getComputedStyle(document.documentElement).getPropertyValue("--gz-x-enter").trim().slice(0, 4) })').then((v) => { const o = v && JSON.parse(v); return o?.n && o.scene && o.x === 'gz-x' ? o : null; }).catch(() => null), 20000, 200);
        check('the served Ultra page wears the parts, the shader and the animations under a strict policy', ok, JSON.stringify(ok));
        await pause(300);
        const q = await ctx.newPage();
        q.on('pageerror', (e) => errors.push(`${sc.id} quiz: ${e}`));
        await q.goto(sc.origin + sc.quiz);
        await until(() => q.evaluate(() => document.documentElement.style.getPropertyValue('--gz-accent')));
        await pause(2500);
        const qready = await quizRuntime(q);
        const qn = await q.evaluate(() => ({ scene: !!document.getElementById('gz-scene'), css: document.adoptedStyleSheets.length, x: getComputedStyle(document.documentElement).getPropertyValue('--gz-x-enter').trim(), fx: !!document.getElementById('gz-fx'), rules: !!document.querySelector('[data-gz-r-hide],[data-gz-r-st]') }));
        check('an assessment page of the same site gets none of it', qready && !qn.scene && qn.css === 0 && qn.x === '' && !qn.fx && !qn.rules, JSON.stringify({ ...qn, qready }));
        await q.close();
        await wear(BASE, null);
        await page.close();
        continue;
      }

      // The page with Glaze on and no Look (A), and with Glaze off (B): what taking the Look off, and Glaze off, must give back.
      await wear({ ...BASE, enabled: false }, null);
      const B = await (async () => { await pause(600); return settle(); })();
      await wear(BASE, null);
      await pause(600);

      // Controls: normalization must still notice real damage to native content and effective inline declarations.
      for (const [label, sel, attr] of [['a native title', 'body', 'title'], ['an effective inline style', 'body', 'style'], ...(sc.site === 'canvas' ? [['the native sidebar', '.Sidebar__TodoListContainer', 'title']] : [])]) {
        const before = await html$();
        const old = await page.evaluate(({ sel, attr }) => {
          const el = document.querySelector(sel), old = attr === 'style' ? el.style.cssText : el.getAttribute(attr);
          if (attr === 'style') el.style.setProperty('outline-offset', '13px'); else el.setAttribute(attr, 'comparison probe');
          return old;
        }, { sel, attr });
        check(`control: restoration comparison detects damage to ${label}`, (await html$()) !== before);
        await page.evaluate(({ sel, attr, old }) => { const el = document.querySelector(sel); if (attr === 'style') el.style.cssText = old; else if (old === null) el.removeAttribute(attr); else el.setAttribute(attr, old); }, { sel, attr, old });
      }
      const A = await settle();

      // ---- everything applies ----------------------------------------------------------------------------------------------
      await wear(worn.settings, worn.parts);
      const scene = await until(() => page.evaluate(() => { const c = document.getElementById('gz-scene'); return c && { w: c.width, bg: document.documentElement.getAttribute('data-gz-bg') }; }), 20000, 150);
      check('the shader background draws (a canvas under the page, the page on the shader kind)', scene && scene.bg === 'shader' && scene.w > 100, JSON.stringify(scene));
      await until(async () => (await root$('--gz-enter')).startsWith('gz-x-'), 10000);
      const enter = await root$('--gz-enter');
      const sheets = await page.evaluate(() => ({ adopted: document.adoptedStyleSheets.length, keyframes: [...(document.adoptedStyleSheets[0]?.cssRules || [])].filter((r) => r.type === CSSRule.KEYFRAMES_RULE).length, style: !!document.getElementById('gz-motionx') }));
      check('the animations are on as one constructed sheet, never a <style>', /^gz-x-/.test(enter) && sheets.adopted === 1 && sheets.keyframes >= 2 && !sheets.style, `${enter.slice(0, 30)} ${JSON.stringify(sheets)}`);
      const lift = await root$('--gz-lift'), press = await root$('--gz-press');
      check('card.hover and button.press arrive as the held states', lift === 'translate(0px,-8px) scale(1.04)' && press === '0.88', `${lift} ${press}`);
      const running = await page.evaluate((sel) => { const c = document.querySelector(sel); return { name: c && getComputedStyle(c).animationName, n: c ? c.getAnimations().length : -1 }; }, sc.card);
      check('a card of the page runs the Look\'s entrance', /^gz-x-/.test(running.name), JSON.stringify(running));

      // The rules and the nav layout of this LMS.
      const R = {
        ultra: () => page.evaluate(() => { const c = document.querySelector('article.course-element-card'), s = getComputedStyle(c); return { title: c.querySelector('.course-title').textContent.trim(), radius: s.borderRadius, border: s.borderTopWidth, footer: getComputedStyle(document.querySelector('[class*="makeStylesfooter"]')).display, nav: getComputedStyle(document.querySelector('nav[class*="makeStylesnavigation"]')).backgroundColor }; }),
        canvas: () => page.evaluate(() => ({ titles: [...document.querySelectorAll('.ic-DashboardCard__header-title')].map((e) => e.textContent.trim()), radius: getComputedStyle(document.querySelector('.ic-DashboardCard')).borderRadius, todo: getComputedStyle(document.querySelector('#right-side .Sidebar__TodoListContainer')).display })),
        moodle: () => page.evaluate(() => ({ titles: [...document.querySelectorAll('.coursename .multiline > span')].map((e) => e.textContent.trim()), radius: getComputedStyle(document.querySelector('.course-card')).borderRadius, help: getComputedStyle(document.querySelector('.btn-footer-popover')).display, pad: getComputedStyle(document.querySelector('#page-header')).paddingTop, moved: !!document.querySelector('.block_recentlyaccesseditems')?.nextElementSibling?.matches('.block_calendar_month') })),
      }[sc.site];
      await until(async () => (await page.evaluate(() => !!document.querySelector('[data-gz-r-st], [data-gz-r-hide]'))), 10000);
      const r = await R();
      const ruleOk = { ultra: () => r.title === 'Mine' && r.radius === '24px' && r.border === '3px' && r.footer === 'none' && r.nav === 'rgb(51, 17, 68)',
        canvas: () => r.titles.length && r.titles.every((t) => t === 'Relabelled') && r.radius === '20px' && r.todo === 'none',
        moodle: () => r.titles.length && r.titles.every((t) => t === 'Renamed course') && r.radius === '16px' && r.help === 'none' && r.pad === '16px' && r.moved }[sc.site]();
      check(`the ${sc.site} rules apply (the other LMSes' are ignored)`, ruleOk, JSON.stringify(r).slice(0, 300));
      const navOf = { ultra: 'nav[data-gz-nav-root] > ul', canvas: '#header .ic-app-header__main-navigation > ul', moodle: '.primary-navigation ul.more-nav' }[sc.site];
      const navIds = () => page.evaluate((l) => [...document.querySelector(l).children].filter((e) => e.dataset.gzNavId && e.getClientRects().length).map((e) => e.dataset.gzNavId), navOf);
      const ids = await until(async () => { const v = await navIds().catch(() => []); return v.includes(LINK.id) ? v : null; }, 10000) || await navIds().catch(() => []);
      // Ultra and Canvas: the groups, then the rest in the page's order (Canvas's whole list is these nine). Moodle has no calendar item or messages item here: the ones it has, in order.
      const head = ['g:0', 'course', 'calendar', 'w:clock', 'g:1', 'messages', LINK.id, 'profile'];
      const orderOk = sc.site === 'moodle' ? ['course', 'w:clock', LINK.id].every((k) => ids.includes(k)) && ids.indexOf('course') < ids.indexOf('w:clock') && ids.indexOf('w:clock') < ids.indexOf(LINK.id)
        : JSON.stringify(ids.slice(0, head.length)) === JSON.stringify(head) && (sc.site !== 'canvas' || ids.join() === [...head, 'dashboard'].join());
      check('the nav layout: its groups, order, widget and link', orderOk, ids.join(' '));
      const bar = await page.evaluate((s) => { const el = s === 'ultra' ? document.querySelector('.MuiDrawer-paper') : s === 'canvas' ? document.getElementById('header') : document.querySelector('.primary-navigation'); const r = el.getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width), place: document.documentElement.getAttribute('data-gz-nav-place') }; }, sc.site);
      check(sc.site === 'moodle' ? 'the nav stays in the top bar (Moodle\'s is one already)' : 'the nav is a bar along the top', sc.site === 'moodle' ? bar.top < 100 && bar.place === 'top' : bar.top === 0 && bar.w >= 1270 && bar.place === 'top', JSON.stringify(bar));
      const heading = await page.evaluate((l) => [...document.querySelectorAll(`${l} .gz-nav-group`)].map((e) => e.textContent), navOf);
      check('the group labels are drawn', heading.includes('Study') && (sc.site === 'moodle' || heading.includes('Me')), heading.join(','));

      // An effect, and the pointer's. Both draw on one canvas that goes when nothing is left.
      const gone = () => until(async () => !(await page.evaluate(() => !!document.getElementById('gz-fx'))), 6000, 100);
      await world('(GZ_CTX.moment("complete"), true)');
      const fxOn = await until(() => page.evaluate(() => { const c = document.getElementById('gz-fx'); return c && { aria: c.getAttribute('aria-hidden'), ev: getComputedStyle(c).pointerEvents }; }), 3000, 50);
      check('a completion plays the Look\'s effect on a canvas that ignores the pointer and is hidden from a screen reader', fxOn?.aria === 'true' && fxOn.ev === 'none', JSON.stringify(fxOn));
      await gone();
      for (let i = 0; i < 14; i++) await page.mouse.move(120 + i * 30, 300 + i * 8);
      const trail = await until(() => page.evaluate(() => !!document.getElementById('gz-fx')), 2000, 50);
      check('the pointer draws a trail', trail);
      await gone();
      if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `${sc.id}.png`) }); }

      // The theme code is already the same as the Look held (the editor part). A page's own redraw keeps the rules.
      // ---- motion off stops all motion --------------------------------------------------------------------------------------
      const counter = '(() => { if (!window.__raf) { window.__raf = { n: 0 }; const f = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => { window.__raf.n++; return f(cb); }; } return window.__raf.n; })()';
      await world(counter);
      const frames = async (ms) => { const a = await world('window.__raf.n'); await pause(ms); return (await world('window.__raf.n')) - a; };
      numbers[`${sc.id}.rafPerSecondMotionOn`] = Math.round((await frames(1000)) / 1);
      check('with motion on, Glaze asks for animation frames (the shader, at about 30 a second)', numbers[`${sc.id}.rafPerSecondMotionOn`] > 10, numbers[`${sc.id}.rafPerSecondMotionOn`]);
      await wear({ ...worn.settings, motion: { ...worn.settings.motion, level: 'off' } }, worn.parts);
      await until(async () => (await page.evaluate(() => document.documentElement.getAttribute('data-gz-motion'))) === 'off');
      await pause(1200); // a frame in flight
      await world('(GZ_CTX.moment("complete"), true)');
      for (let i = 0; i < 14; i++) await page.mouse.move(100 + i * 30, 200 + i * 10);
      const after = await frames(1500);
      const offState = await page.evaluate((sel) => { const c = document.querySelector(sel), k = c.cloneNode(true); k.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id')); c.parentElement.append(k); const o = { fx: !!document.getElementById('gz-fx'), scene: !!document.getElementById('gz-scene'), enter: getComputedStyle(document.documentElement).getPropertyValue('--gz-enter').trim(), lift: getComputedStyle(document.documentElement).getPropertyValue('--gz-lift').trim(), name: getComputedStyle(k).animationName, moving: document.getAnimations().filter((a) => /^gz-x-/.test(a.animationName || '')).length, others: document.getAnimations().map((a) => a.animationName || a.transitionProperty || a.constructor.name).join(',') }; k.remove(); return o; }, sc.card);
      numbers[`${sc.id}.rafInMotionOffWindow`] = after;
      check('motion off: no animation frame is asked for in 1.5 s, with a completion and the pointer moving', after === 0, `${after} frames`);
      check('motion off: no effect canvas, no keyframes running, the entrance and the lift are none; the shader\'s still frame stays', !offState.fx && offState.scene && offState.enter === 'none' && offState.lift === 'none' && offState.name === 'none' && offState.moving === 0, JSON.stringify(offState));
      check('motion off: the rules and the nav stay', (await page.evaluate(() => !!document.querySelector('[data-gz-r-st], [data-gz-r-hide]'))) && (await navIds()).includes(LINK.id), '');

      // ---- what a pass costs, with motion off so that only the work of a pass is counted -----------------------------------
      const metrics = async () => Object.fromEntries((await cdp2.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
      const cdp2 = await ctx.newCDPSession(page);
      await cdp2.send('Performance.enable');
      const burst = async (n = 40) => {
        const m0 = await metrics();
        await page.evaluate(async ({ n, sel }) => {
          const proto = document.querySelector(sel), made = [];
          for (let i = 0; i < n; i++) { const c = proto.cloneNode(true); c.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id')); proto.parentElement.append(c); made.push(c); await new Promise((r) => setTimeout(r, 70)); }
          await new Promise((r) => setTimeout(r, 500));
          made.forEach((c) => c.remove());
          await new Promise((r) => setTimeout(r, 500));
        }, { n, sel: sc.card });
        const m1 = await metrics();
        return { task: ((m1.TaskDuration - m0.TaskDuration) * 1000) / n, script: ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / n, style: ((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) / n, layout: ((m1.LayoutDuration - m0.LayoutDuration) * 1000) / n };
      };
      const idle = async () => { const m0 = await metrics(); await pause(3500); const m1 = await metrics(); return ((m1.TaskDuration - m0.TaskDuration) * 1000) / 40; };
      const reps = 3, withLook = [], without = [], quiet = [];
      for (let i = 0; i < reps; i++) {
        quiet.push(await idle());
        withLook.push(await burst());
        await wear({ ...BASE, motion: { ...BASE.motion, level: 'off' } }, null);
        await pause(900);
        without.push(await burst());
        await wear({ ...worn.settings, motion: { ...worn.settings.motion, level: 'off' } }, worn.parts);
        await pause(900);
      }
      const per = (rows, k) => Math.round(median(rows.map((r) => r[k])) * 100) / 100;
      const cost = { idleMsPer40: Math.round(median(quiet) * 100) / 100, withLook: { task: per(withLook, 'task'), script: per(withLook, 'script'), style: per(withLook, 'style'), layout: per(withLook, 'layout') }, withoutLook: { task: per(without, 'task'), script: per(without, 'script'), style: per(without, 'style'), layout: per(without, 'layout') } };
      cost.extraTaskMsPerPass = Math.round((cost.withLook.task - cost.withoutLook.task) * 100) / 100;
      numbers[`${sc.id}.passCost`] = cost;
      check(`a pass costs ${cost.withoutLook.task} ms without the Look and ${cost.withLook.task} ms with it (+${cost.extraTaskMsPerPass} ms; script ${cost.withoutLook.script} → ${cost.withLook.script})`, cost.extraTaskMsPerPass < 3, JSON.stringify(cost));
      const direct = await world(`(() => { const t = (f, n) => { const s = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - s) / n; }; return JSON.stringify({ rules: globalThis.GZ_RULES ? t(() => GZ_RULES.sync(), 300) : null, nav: globalThis.GZ_NAV_UI ? t(() => GZ_NAV_UI.sync(), 100) : null }); })()`).then((v) => JSON.parse(v));
      numbers[`${sc.id}.syncMs`] = { rules: direct.rules != null ? Math.round(direct.rules * 1000) / 1000 : null, nav: direct.nav != null ? Math.round(direct.nav * 1000) / 1000 : null };
      check(`one rules sync costs ${numbers[`${sc.id}.syncMs`].rules} ms and one nav sync ${numbers[`${sc.id}.syncMs`].nav} ms`, direct.rules != null && direct.rules < 1 && direct.nav != null && direct.nav < 3, JSON.stringify(direct));
      await cdp2.send('Performance.disable');
      await cdp2.detach();

      await page.mouse.move(-1, -1); // off the page: a pointer parked on an element with a title has the tooltip holding that title
      // ---- the Look off, and Glaze off ----------------------------------------------------------------------------------------
      await wear(BASE, null);
      await same(A, 'taking the Look off leaves the page exactly as it was with Glaze on and no Look');
      check('and no variable of the Look\'s is left in a style attribute', !(await leftover()));
      await wear(worn.settings, worn.parts);
      await until(async () => !!(await page.evaluate(() => document.getElementById('gz-scene'))), 20000, 150);
      await pause(800);
      await wear({ ...worn.settings, enabled: false }, worn.parts);
      await same(B, 'turning Glaze off with the Look worn leaves the page exactly as it is with Glaze off and no Look');
      check('and no variable of the Look\'s is left in a style attribute', !(await leftover()));
      await wear(worn.settings, worn.parts);
      const back = await until(() => page.evaluate(() => !!document.getElementById('gz-scene') && !!document.querySelector('[data-gz-r-st], [data-gz-r-hide]')), 20000, 150);
      check('and back on, the Look returns', back);

      // ---- a quiz page gets none of it ------------------------------------------------------------------------------------------
      if (sc.preview) {
        const previewContext = (type) => page.evaluate((page) => postMessage({ gzPreviewContext: { site: 'ultra', page, viewport: 'desktop' } }, location.origin), type);
        await previewContext('quiz');
        const bare = await until(() => page.evaluate(() => GZ_CTX.parts() === null && !document.getElementById('gz-scene') && !document.getElementById('gz-fx') && !document.getElementById('gz-rules-css') && document.adoptedStyleSheets.length === 0 && !document.querySelector('[data-gz-nav-place], .gz-nav-group, .gz-nav-link')));
        check('the mock quiz gets no Look parts, scene, animations, effects, rules or nav layout', bare);
        await world('(GZ_CTX.moment("complete"), true)');
        for (let i = 0; i < 14; i++) await page.mouse.move(100 + i * 30, 200);
        await pause(200);
        check('the mock quiz plays neither a completion effect nor a cursor effect', !(await page.evaluate(() => !!document.getElementById('gz-fx'))));
        await previewContext('courses');
        const restored = await until(() => page.evaluate(() => !!GZ_CTX.parts() && !!document.getElementById('gz-scene') && !!document.getElementById('gz-rules-css') && document.adoptedStyleSheets.length === 1 && document.documentElement.getAttribute('data-gz-nav-place') === 'top'));
        check('returning from the mock quiz restores every part of the Look', restored);
      } else {
        const q = await ctx.newPage();
        q.on('pageerror', (e) => errors.push(`${sc.id} quiz: ${e}`));
        await q.goto(sc.origin + sc.quiz);
        await until(() => q.evaluate(() => document.documentElement.style.getPropertyValue('--gz-accent') || document.readyState === 'complete'));
        await pause(3000);
        const qready = await quizRuntime(q);
        for (let i = 0; i < 14; i++) await q.mouse.move(100 + i * 30, 200);
        await pause(800);
        const none = await q.evaluate(() => ({ scene: !!document.getElementById('gz-scene'), adopted: document.adoptedStyleSheets.length, enter: getComputedStyle(document.documentElement).getPropertyValue('--gz-x-enter').trim(), fx: !!document.getElementById('gz-fx'), rules: !!document.querySelector('[data-gz-r-hide],[data-gz-r-st]') || !!document.getElementById('gz-rules-css'), nav: !!document.querySelector('[data-gz-nav-place], .gz-nav-group, .gz-nav-link') }));
        const live = await page.evaluate(() => !!document.getElementById('gz-scene') && !!document.querySelector('[data-gz-r-st], [data-gz-r-hide]'));
        check('a quiz page of the same site gets none of it (the control, the Look\'s other page, still wears it)', qready && live && !none.scene && none.adopted === 0 && none.enter === '' && !none.fx && !none.rules && !none.nav, JSON.stringify({ ...none, live, qready }));
        await q.close();
      }
      // A course that wears a Look of its own gets none of the student's parts, and no event says so: the features must follow.
      if (sc.id === 'canvas-open') {
        section = `${sc.id} course`;
        const cp = await ctx.newPage();
        cp.on('pageerror', (e) => errors.push(`${sc.id} course: ${e}`));
        await cp.goto(`${sc.origin}/courses/25`);
        const worn$ = () => cp.evaluate(() => ({ scene: !!document.getElementById('gz-scene'), enter: getComputedStyle(document.documentElement).getPropertyValue('--gz-x-enter').trim().slice(0, 4), sheets: document.adoptedStyleSheets.length, place: document.documentElement.getAttribute('data-gz-nav-place'), rules: !!document.querySelector('[data-gz-r-hide], [data-gz-r-st]'), bar: !!document.querySelector('.gz-nav-link') }));
        const wearing = (w) => w.scene && w.enter === 'gz-x' && w.sheets === 1 && w.place === 'top' && w.rules && w.bar;
        const bare = (w) => !w.scene && w.enter === '' && w.sheets === 0 && !w.place && !w.rules && !w.bar;
        const key = `canvas:${sc.origin}/25`;
        const looks = (l) => opts.evaluate(async (l) => { const { courses } = await chrome.storage.sync.get('courses'); await chrome.storage.sync.set({ courses: { ...(courses || {}), looks: l } }); }, l);
        await wear(worn.settings, worn.parts);
        const on1 = await until(async () => { const w = await worn$().catch(() => null); return w && wearing(w) ? w : null; }, 25000, 200);
        check('a course page wears the Look (shader, animations, nav layout, rules)', on1, JSON.stringify(await worn$()));
        await looks({ [key]: 'Clear' });
        const off1 = await until(async () => { const w = await worn$().catch(() => null); return w && bare(w) ? w : null; }, 15000, 200);
        check('and when that course is given a Look of its own, all of it goes (nothing fires glaze:parts for that)', off1, JSON.stringify(await worn$()));
        await looks({});
        const on2 = await until(async () => { const w = await worn$().catch(() => null); return w && wearing(w) ? w : null; }, 25000, 200);
        check('and comes back when the course\'s Look is taken off', on2, JSON.stringify(await worn$()));
        await cp.close();
      }
      await wear(BASE, null);
      await page.close();
    }
    section = 'all';
    check('no page errors', errors.length === 0, errors.join(' | '));
    // The pages' own links (fonts, images, bundles) are refused too. What matters is that nothing was asked of a host the pages
    // do not name themselves (Glaze would ask one for a web font, say).
    const named = new Set([...[CANVAS_DASH, CANVAS_QUIZ, MOODLE_DASH, MOODLE_QUIZ, ULTRA_HTML].join('').matchAll(/https?:\/\/([a-z0-9.:-]+)/gi)].map((m) => m[1].toLowerCase()));
    for (const sc of SCENARIOS) if (sc.origin) named.add(new URL(sc.origin).host);
    const foreign = external.filter((u) => !named.has(new URL(u).host));
    check(`nothing was asked of a host the pages do not name (${external.length - foreign.length} of the pages' own links were refused)`, foreign.length === 0, [...new Set(foreign)].join(' '));
  } finally {
    await ctx?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(JSON.stringify(numbers, null, 1));
  if (failed.length) { console.log(`FAILED:\n${failed.map((f) => `  [${f.section}] ${f.name} ${String(f.detail).slice(0, 300)}`).join('\n')}`); process.exitCode = 1; }
})().catch((e) => { console.error(e); process.exitCode = 1; });

