// Headless document review geometry and local Canvas survey. Holds the shared lock for the browser's whole lifetime.
// NODE_PATH=/path/to/node_modules nice -n 15 node scripts/docreview-check.js [evidence directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const G = require('../defaults.js');
const root = path.resolve(__dirname, '..'), lock = '/private/tmp/claude-501/glaze-heavy.lock';
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-docreview-evidence-')));
const origin = 'https://review.blackboard.com', route = '/ultra/courses/_1_1/assessment/_2_1/overview/student-submission-view';
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
let css, js;
let fixture;
let held = false, ctx, tmp, checks = 0;
const ok = (value, message) => { if (!value) throw Error(message); checks++; console.log(`ok ${message}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const setup = (site, framed) => `window.chrome={runtime:{getURL:()=>${JSON.stringify(origin + '/docreview.css')}}}; window.reviewSettings=${JSON.stringify(G.GZ_DEFAULTS.docreview)}; window.reviewVisible=true; window.GZ_CTABS={visible:()=>window.reviewVisible}; window.reviewContext={site:${JSON.stringify(site)},tabFrame:${JSON.stringify(framed)},on:()=>true,t:(k)=>k,settings:()=>({docreview:window.reviewSettings})};`;
const size = (f) => f.evaluate(() => { const r = document.querySelector('[data-gz-review-part="frame"], [role="tabpanel"] iframe, #preview_frame')?.getBoundingClientRect(); return r && { width: Math.round(r.width), height: Math.round(r.height), overflow: document.documentElement.scrollWidth - innerWidth }; });
const set = (f, s) => f.evaluate((s) => { Object.assign(window.reviewSettings, s); window.reviewUI.sync(); }, s);
const install = async (f, site, framed = '') => { await f.addScriptTag({ content: setup(site, framed) }); await f.addScriptTag({ content: js }); await f.evaluate(() => { window.reviewUI = GZ_DOCREVIEW.create(window.reviewContext); }); };
const measure = async (f) => { await f.waitForTimeout(100); return size(f); };
const same = (a, b) => a.width === b.width && a.height === b.height;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  try {
    for (let n = 0; ; n++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\ndocreview-check\n${new Date().toISOString()}\n`); break; }
      catch (e) { if (e.code !== 'EEXIST') throw e; if (n % 6 === 0) console.log('Waiting for the shared browser lock'); await pause(10000); }
    }
    fixture = fs.readFileSync(path.join(root, 'test/fixtures/ultra-docreview.html'), 'utf8');
    css = fs.readFileSync(path.join(root, 'features/docreview.css'), 'utf8'); js = fs.readFileSync(path.join(root, 'features/docreview.js'), 'utf8');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-docreview-profile-'));
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(tmp, { executablePath: CHROME, headless: true, bypassCSP: true, viewport: { width: 1800, height: 987 }, reducedMotion: 'reduce' });
    await ctx.route(origin + '/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/docreview.css') return r.fulfill({ contentType: 'text/css', body: css });
      if (u.pathname === route) return r.fulfill({ contentType: 'text/html', body: fixture });
      return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>html,body{height:100%;margin:0}#gz-navbar{height:80px}#gz-footer{height:32px;position:fixed;bottom:0;width:100%}#gz-ctabs-frames{position:fixed;top:80px;bottom:32px;width:100%}#gz-ctabs-frames>iframe{width:100%;height:100%;border:0}</style></head><body><div id="gz-navbar">Glaze <div id="gz-ctabs">Course tabs</div></div><div id="gz-ctabs-frames"><iframe name="gz-ctab:_1_1" title="Course" allow="fullscreen" src="${route}"></iframe></div><div id="gz-footer">Glaze</div></body></html>` });
    });
    await ctx.route('https://annotate-us.foundations.blackboard.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Viewer fixture</title><label>Annotation <input id="annotation"></label><div style="height:1400px">Document</div>' }));
    const page = await ctx.newPage(); await page.goto(origin + '/fixture');
    const f = page.frames().find((f) => f.url() === origin + route); await f.waitForSelector('iframe');
    await install(page, 'ultra'); await install(f, 'ultra', '_1_1');
    await page.evaluate(() => { const frame = document.querySelector('#gz-ctabs-frames>iframe'); addEventListener('message', (e) => { if (GZ_DOCREVIEW.relayable(e, location.origin, frame.contentWindow, window.reviewVisible && !frame.inert)) GZ_DOCREVIEW.chrome(e.data.on, { el: frame, current: () => window.reviewVisible && !frame.inert && frame.isConnected }); }); });
    await set(f, { compact: false, fullscreen: false, focus: false });
    const before = await measure(f); ok(same(before, { width: 1370, height: 578 }), `Ultra native ${JSON.stringify(before)}`);
    await f.evaluate(() => { window.originalViewer = document.querySelector('iframe'); window.originalParent = originalViewer.parentNode; window.originalSrc = originalViewer.getAttribute('src'); window.viewerLoads = 0; originalViewer.addEventListener('load', () => viewerLoads++); });
    const viewer = f.childFrames()[0]; await viewer.locator('#annotation').fill('Kept annotation');
    await set(f, { compact: true, fullscreen: true, focus: true, hideBars: false }); await f.waitForSelector('#gz-review-focus');
    const compact = await measure(f); ok(compact.height >= before.height + 170 && compact.width === before.width, `Ultra compact ${JSON.stringify(compact)}`);
    await f.locator('#gz-review-feedback').click(); ok(await f.locator('#gz-review-feedback').getAttribute('aria-expanded') === 'true', 'feedback expands in place'); await f.locator('#gz-review-feedback').click();
    await f.evaluate(() => { const native = originalViewer.requestFullscreen.bind(originalViewer); window.fullscreenCalls = 0; originalViewer.requestFullscreen = () => { fullscreenCalls++; return native(); }; });
    await f.locator('#gz-review-fullscreen').click(); await f.waitForTimeout(100);
    const full = await f.evaluate(async () => { const result = { calls: fullscreenCalls, entered: document.fullscreenElement === originalViewer }; if (document.fullscreenElement) await document.exitFullscreen(); return result; });
    ok(full.calls === 1, `fullscreen call on the original iframe (${JSON.stringify(full)})`);
    await f.locator('#gz-review-focus').click(); const focus = await measure(f); ok(same(focus, { width: 1800, height: 875 }), `Ultra focus ${JSON.stringify(focus)}`);
    await f.locator('#gz-review-rubric').click(); ok(await f.locator('aside').isVisible(), 'rubric overlays in place'); await f.locator('#gz-review-rubric').click();
    await f.locator('#gz-review-details').click(); ok(await f.locator('.review-grade').isVisible(), 'grade and feedback stay reachable'); await f.locator('#gz-review-details').click();
    await set(f, { hideBars: true }); await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-review-immersive'));
    const immersive = await measure(f); ok(same(immersive, { width: 1800, height: 987 }), `Ultra focus with hidden bars ${JSON.stringify(immersive)}`);
    ok([before, compact, focus, immersive].every((s) => s.overflow <= 1), 'native, compact, focus and immersive have no horizontal overflow at 1800px');
    ok(await f.locator('.review-title button').evaluate((e) => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e; }), 'native close remains reachable in focus');
    await page.screenshot({ path: path.join(out, 'ultra-focus.png') });
    ok(await f.evaluate(() => document.querySelector('iframe') === originalViewer && originalViewer.parentNode === originalParent && originalViewer.getAttribute('src') === originalSrc && viewerLoads === 0), 'iframe identity, parent, src and load count unchanged');
    ok(await viewer.locator('#annotation').inputValue() === 'Kept annotation', 'viewer state survives every resize and fullscreen');
    for (const width of [1440, 800, 390]) { await page.setViewportSize({ width, height: 900 }); const s = await measure(f); ok(s.overflow <= 1, `focus has no horizontal overflow at ${width}px`); }
    await page.setViewportSize({ width: 1800, height: 987 });
    await f.locator('#gz-review-exit').click(); await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-review-immersive')); ok(same(await measure(f), compact), 'exit restores compact geometry and Glaze bars');
    await page.screenshot({ path: path.join(out, 'ultra-compact.png') });
    await page.emulateMedia({ media: 'print' }); ok(same(await measure(f), before), 'print restores native geometry'); await page.emulateMedia({ media: 'screen' });
    await set(f, { compact: false, fullscreen: false, focus: false }); ok(same(await measure(f), before), 'settings off restores native geometry');
    const report = { viewport: '1800x987', ultra: { before, compact, focus, immersive, fullscreen: full } };
    // Survey only existing student submissions. No uploads, attempts, comments, grades or submissions are created.
    const canvas = await ctx.newPage(); const local = 'http://localhost:3000';
    const file = process.env.CANVAS_CREDENTIALS || path.join(os.homedir(), 'Projects/canvas-lms/glaze/credentials.env');
    const creds = Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\n/).filter((s) => /^[A-Z_]+=/.test(s)).map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1).replace(/^['"]|['"]$/g, '')]; }));
    await canvas.goto(local + '/login/canvas'); await canvas.locator('#pseudonym_session_unique_id').fill(creds.STUDENT_EMAIL); await canvas.locator('#pseudonym_session_password').fill(creds.STUDENT_PASSWORD || creds.PASSWORD);
    await Promise.all([canvas.waitForURL((u) => !u.pathname.startsWith('/login')), canvas.locator('button[type="submit"], input[type="submit"]').first().click()]);
    const api = (p) => canvas.evaluate((p) => fetch(p, { headers: { accept: 'application/json' } }).then((r) => r.text()).then((s) => JSON.parse(s.replace(/^while\(1\);/, ''))), p);
    const me = await api('/api/v1/users/self/profile'), courses = await api('/api/v1/courses?per_page=100'); let chosen, uploaded;
    for (const course of courses) {
      const assignments = await api(`/api/v1/courses/${course.id}/assignments?include[]=submission&per_page=100`);
      for (const a of assignments) if (['submitted', 'graded'].includes(a.submission?.workflow_state)) {
        const row = { course: course.id, assignment: a.id, type: a.submission.submission_type, attachments: a.submission.attachments?.length || 0 };
        chosen ||= row; if (row.attachments) uploaded ||= row;
      }
    }
    chosen = uploaded || chosen; ok(!!chosen, 'local Canvas has an existing submitted assignment to survey');
    await canvas.goto(`${local}/courses/${chosen.course}/assignments/${chosen.assignment}/submissions/${me.id}`); await canvas.waitForSelector('.submission-details-header');
    await install(canvas, 'canvas'); await set(canvas, G.GZ_DEFAULTS.docreview);
    const survey = await canvas.evaluate(() => ({ recognized: !!GZ_DOCREVIEW.recognize(document, 'canvas', location.pathname), preview: !!document.querySelector('#preview_frame'), nativeForms: document.querySelectorAll('#content form, #content textarea, #content input[type="submit"]').length, viewers: [...document.querySelectorAll('iframe')].map((e) => ({ id: e.id, src: new URL(e.src).pathname })), overflow: document.documentElement.scrollWidth - innerWidth, changed: document.documentElement.hasAttribute('data-gz-review') }));
    const nested = await Promise.all(canvas.frames().filter((f) => f !== canvas.mainFrame()).map(async (f) => ({ url: new URL(f.url()).origin, canvadocs: await f.locator('iframe.docs-annotation-pane, iframe[src*="canvadoc_session"], iframe[src*="canvadocs"]').count().catch(() => 0) })));
    survey.nested = nested; survey.submissionType = chosen.type; survey.attachments = chosen.attachments;
    ok(survey.overflow <= 1, 'local Canvas submission has no horizontal overflow');
    if (!survey.recognized) ok(!survey.changed, 'unrecognized Canvas submission keeps native layout');
    await canvas.screenshot({ path: path.join(out, 'canvas-submission.png') });
    report.canvas = survey; report.checks = checks; fs.writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); console.log(`Evidence: ${out}`);
  } finally {
    await ctx?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) { fs.unlinkSync(path.join(lock, 'owner')); fs.rmdirSync(lock); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
