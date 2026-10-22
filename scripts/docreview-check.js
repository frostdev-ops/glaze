// Headless document review geometry and local Canvas survey. Holds the shared lock for the browser's whole lifetime.
// NODE_PATH=/path/to/node_modules nice -n 15 node scripts/docreview-check.js [evidence directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const G = require('../defaults.js');
const root = path.resolve(__dirname, '..'), lock = require('./check-env.js').lockPath();
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-docreview-evidence-')));
const origin = 'https://review.blackboard.com', route = '/ultra/courses/_1_1/assessment/_2_1/overview/student-submission-view';
const chromeLaunch = require('./check-env.js').chromeLaunch();
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
const reachable = (f, selector) => f.locator(selector).evaluateAll((es) => es.length > 0 && es.every((e) => {
  e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return r.width > 0 && r.height > 0 && e.contains(hit);
}));
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
    ctx = await chromium.launchPersistentContext(tmp, { ...chromeLaunch, headless: true, bypassCSP: true, viewport: { width: 1800, height: 987 }, reducedMotion: 'reduce' });
    await ctx.route(origin + '/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/docreview.css') return r.fulfill({ contentType: 'text/css', body: css });
      if (u.pathname === route) return r.fulfill({ contentType: 'text/html', body: fixture });
      return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>html,body{height:100%;margin:0}#gz-navbar{height:80px}#gz-footer{height:32px;position:fixed;bottom:0;width:100%}#gz-ctabs-frames{position:fixed;top:80px;bottom:32px;width:100%}#gz-ctabs-frames>iframe{width:100%;height:100%;border:0}</style></head><body><div id="gz-navbar">Glaze <div id="gz-ctabs">Course tabs</div></div><div id="gz-ctabs-frames"><iframe name="gz-ctab:_1_1" title="Course" allow="fullscreen" src="${route}"></iframe></div><div id="gz-footer">Glaze</div></body></html>` });
    });
    await ctx.route('https://annotate-us.foundations.blackboard.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Viewer fixture</title><label>Annotation <input id="annotation"></label><div style="height:1400px">Document</div>' }));
    await ctx.route('http://localhost:3000/**', (r) => {
      const req = r.request(), u = new URL(req.url());
      return ['GET', 'HEAD'].includes(req.method()) || req.method() === 'POST' && u.pathname === '/login/canvas' ? r.continue() : r.abort();
    });
    const layers = await ctx.newPage();
    try { await require('./ultra-offcanvas-fixture.js')({ page: layers, root, check: ok, shot: (name) => layers.screenshot({ path: path.join(out, `${name}.png`) }) }); }
    finally { await layers.close(); }
    const page = await ctx.newPage(); await page.goto(origin + '/fixture');
    const f = page.frames().find((f) => f.url() === origin + route); await f.waitForSelector('iframe');
    await install(page, 'ultra'); await install(f, 'ultra', '_1_1');
    await page.evaluate(() => { const frame = document.querySelector('#gz-ctabs-frames>iframe'); addEventListener('message', (e) => {
      if (window.dropReviewMessages) return;
      const doc = frame.contentDocument;
      const current = () => window.reviewVisible && !frame.inert && frame.isConnected && frame.contentDocument === doc && doc.documentElement.hasAttribute('data-gz-review-focus') && doc.documentElement.hasAttribute('data-gz-review');
      if (GZ_DOCREVIEW.relayable(e, location.origin, frame.contentWindow, window.reviewVisible && !frame.inert)) GZ_DOCREVIEW.chrome(e.data.on, { el: frame, current });
    }); });
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
    ok(full.calls === 1 && full.entered, `fullscreen enters on the original iframe (${JSON.stringify(full)})`);
    await f.locator('#gz-review-focus').click(); const focus = await measure(f); ok(same(focus, { width: 1800, height: 815 }), `Ultra focus ${JSON.stringify(focus)}`);
    ok(await reachable(f, '#gz-review-exit, .review-title button'), 'exit and native close centres are reachable in focus');
    ok(await f.evaluate(() => document.activeElement.id === 'gz-review-exit'), 'focus moves to Exit');
    await f.locator('#gz-review-rubric').click(); ok(await f.locator('aside').isVisible(), 'rubric overlays in place'); await f.locator('#gz-review-rubric').click();
    await f.locator('#gz-review-details').click(); ok(await f.locator('.review-grade').isVisible(), 'grade and feedback stay reachable'); await f.locator('#gz-review-details').click();
    await set(f, { hideBars: true }); await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-review-immersive'));
    const immersive = await measure(f); ok(same(immersive, { width: 1800, height: 903 }), `Ultra focus with hidden bars ${JSON.stringify(immersive)}`);
    ok(await f.evaluate(() => { const v = originalViewer.getBoundingClientRect(), s = document.getElementById('gz-review-strip').getBoundingClientRect(); return v.bottom <= s.top; }), 'focus strip reserves space outside the viewer');
    ok(await reachable(page, '#gz-review-bars'), 'Show Glaze bars is reachable outside the course frame');
    ok(await page.locator('#gz-navbar').evaluate((e) => getComputedStyle(e).transitionDuration === '0s'), 'reduced motion removes bar transitions');
    ok([before, compact, focus, immersive].every((s) => s.overflow <= 1), 'native, compact, focus and immersive have no horizontal overflow at 1800px');
    ok(await f.locator('.review-title button').evaluate((e) => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e; }), 'native close remains reachable in focus');
    await page.screenshot({ path: path.join(out, 'ultra-focus.png') });
    ok(await f.evaluate(() => document.querySelector('iframe') === originalViewer && originalViewer.parentNode === originalParent && originalViewer.getAttribute('src') === originalSrc && viewerLoads === 0), 'iframe identity, parent, src and load count unchanged');
    ok(await viewer.locator('#annotation').inputValue() === 'Kept annotation', 'viewer state survives every resize and fullscreen');
    await page.emulateMedia({ media: 'print' }); ok(same(await measure(f), before), 'printing while focused and immersive restores native geometry'); await page.emulateMedia({ media: 'screen' });
    for (const width of [1440, 800, 390]) { await page.setViewportSize({ width, height: 900 }); const s = await measure(f); ok(s.overflow <= 1 && await reachable(f, '#gz-review-exit, .review-title button'), `focus exits are reachable without horizontal overflow at ${width}px`); }
    await page.setViewportSize({ width: 1800, height: 987 });
    await f.locator('#gz-review-exit').click(); await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-review-immersive')); ok(same(await measure(f), compact), 'exit restores compact geometry and Glaze bars');
    ok(await f.evaluate(() => document.activeElement.id === 'gz-review-focus'), 'exit restores the entry focus');
    await page.screenshot({ path: path.join(out, 'ultra-compact.png') });
    await page.emulateMedia({ media: 'print' }); ok(same(await measure(f), before), 'print restores native geometry'); await page.emulateMedia({ media: 'screen' });
    await set(f, { compact: false, fullscreen: false, focus: false }); ok(same(await measure(f), before), 'settings off restores native geometry');
    const report = { viewport: '1800x987', ultra: { before, compact, focus, immersive, fullscreen: full } };
    // Mimic tab visibility and a React attribute update without replacing or moving the native viewer.
    await set(f, G.GZ_DEFAULTS.docreview);
    await f.evaluate(() => { originalParent.hidden = true; }); await f.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-review'));
    await f.evaluate(() => { originalParent.hidden = false; }); await f.waitForSelector('#gz-review-focus');
    await f.evaluate(() => { document.querySelector('.review-grade').setAttribute('style', 'color: rgb(20, 30, 40)'); }); await f.waitForTimeout(100);
    ok(await f.evaluate(() => document.querySelector('iframe') === originalViewer && originalViewer.parentNode === originalParent && originalViewer.getAttribute('src') === originalSrc && viewerLoads === 0), 'Instructions/file visibility and React attribute updates retain viewer identity and load count');
    await f.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); for (const extra of [{ isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, ...extra })); });
    ok(!await f.evaluate(() => document.documentElement.hasAttribute('data-gz-review-focus')), 'composition and modifier shortcuts stay native');
    await f.locator('#gz-review-focus').click(); await viewer.locator('#annotation').focus(); await viewer.locator('#annotation').press('f');
    ok(await f.evaluate(() => document.documentElement.hasAttribute('data-gz-review-focus')) && await reachable(f, '#gz-review-exit'), 'cross-origin typing leaves focus unchanged and visible Exit reachable');
    await f.locator('#gz-review-exit').click();
    await f.locator('#gz-review-focus').click(); await f.locator('#gz-review-exit').press('Escape');
    ok(!await f.evaluate(() => document.documentElement.hasAttribute('data-gz-review-focus')), 'Escape exits when the review page has focus');
    await f.locator('#gz-review-focus').click(); await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-review-immersive'));
    await f.evaluate(() => { reviewContext.on = () => false; });
    await f.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-review-focus'));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-review-immersive'));
    ok(!await f.evaluate(() => document.documentElement.hasAttribute('data-gz-review-focus')), 'extension invalidation restores review and parent bars');
    await f.evaluate(() => { reviewContext.on = () => true; reviewUI.sync(); });
    await f.locator('#gz-review-focus').click(); await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-review-immersive'));
    await f.evaluate(() => { reviewUI.teardown(); });
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-review-immersive'));
    ok(await f.locator('[data-gz-review-part], [data-gz-review-ui]').count() === 0, 'teardown removes every owned mark and control');
    // Unknown controls beside the panel must remain visible at the same coordinates in every requested mode.
    await f.evaluate(() => {
      const box = document.createElement('div'); box.id = 'native-actions'; box.style = 'position:fixed;bottom:0;left:30%;z-index:2;background:white';
      box.innerHTML = '<button type="submit">Submit</button><button>Save and Close</button><button>New attempt</button><button>Grading</button><textarea aria-label="Comment"></textarea>'; document.body.append(box);
      window.nativeRects = [...box.children].map((e) => JSON.stringify(e.getBoundingClientRect()));
      window.nativeListeners = 0; const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (...args) { if (this instanceof Node && box.contains(this)) nativeListeners++; return add.apply(this, args); };
      window.reviewUI = GZ_DOCREVIEW.create(reviewContext);
    });
    for (const mode of ['native', 'compact', 'focus', 'fullscreen']) {
      await set(f, { compact: mode !== 'native', focus: mode === 'focus', fullscreen: mode === 'fullscreen' }); await f.evaluate(() => reviewUI.enter());
      ok(await reachable(f, '#native-actions > button, #native-actions > textarea') && await f.evaluate(() => !document.documentElement.hasAttribute('data-gz-review') && [...document.getElementById('native-actions').children].every((e, i) => JSON.stringify(e.getBoundingClientRect()) === nativeRects[i]) && nativeListeners === 0), `Submit, Save and Close, attempts, grading and comment centres remain native in ${mode}`);
    }
    await f.evaluate(() => document.getElementById('native-actions').remove()); await set(f, G.GZ_DEFAULTS.docreview);
    await f.locator('#gz-review-focus').click(); await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-review-immersive'));
    await page.evaluate(() => { window.dropReviewMessages = true; });
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-review-immersive'), null, { timeout: 6000 });
    ok(await f.evaluate(() => document.documentElement.hasAttribute('data-gz-review-focus')), 'parent lease restores bars when child renewals stop');
    await page.evaluate(() => { window.dropReviewMessages = false; }); await f.locator('#gz-review-exit').click();
    await f.locator('#gz-review-focus').click(); await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-review-immersive'));
    await page.evaluate(() => { document.querySelector('#gz-ctabs-frames>iframe').inert = true; });
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-review-immersive')); ok(true, 'hiding the owned frame restores bars');
    await f.evaluate(() => { reviewVisible = false; reviewUI.cover(); });
    await page.evaluate(() => { document.querySelector('#gz-ctabs-frames>iframe').inert = false; });
    await f.evaluate(() => { reviewVisible = true; reviewUI.cover(); });
    await f.locator('#gz-review-focus').click(); await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-review-immersive'));
    await page.evaluate(() => document.querySelector('#gz-ctabs-frames>iframe').remove());
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-review-immersive')); ok(true, 'removing the owned frame restores bars');
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
    const canvasBefore = await size(canvas);
    await install(canvas, 'canvas'); await set(canvas, G.GZ_DEFAULTS.docreview);
    const survey = await canvas.evaluate(() => ({ recognized: !!GZ_DOCREVIEW.recognize(document, 'canvas', location.pathname), preview: !!document.querySelector('#preview_frame'), nativeForms: document.querySelectorAll('#content form, #content textarea, #content input[type="submit"]').length, viewers: [...document.querySelectorAll('iframe')].map((e) => ({ id: e.id, src: new URL(e.src).pathname })), overflow: document.documentElement.scrollWidth - innerWidth, changed: document.documentElement.hasAttribute('data-gz-review') }));
    const nested = await Promise.all(canvas.frames().filter((f) => f !== canvas.mainFrame()).map(async (f) => ({ url: new URL(f.url()).origin, canvadocs: await f.locator('iframe.docs-annotation-pane, iframe[src*="canvadoc_session"], iframe[src*="canvadocs"]').count().catch(() => 0) })));
    survey.nested = nested; survey.submissionType = chosen.type; survey.attachments = chosen.attachments;
    ok(survey.overflow <= 1, 'local Canvas submission has no horizontal overflow');
    if (!survey.recognized) ok(!survey.changed, 'unrecognized Canvas submission keeps native layout');
    if (survey.nativeForms) ok(!survey.changed, 'Canvas comment and resubmission pages remain entirely native');
    const controls = '#content textarea, #content input[type="submit"], #content button[type="submit"]';
    if (await canvas.locator(controls).count()) for (const mode of ['compact', 'focus', 'fullscreen']) {
      await set(canvas, { compact: true, focus: mode === 'focus', fullscreen: mode === 'fullscreen' }); await canvas.evaluate(() => reviewUI.enter());
      ok(await reachable(canvas, controls) && !await canvas.evaluate(() => document.documentElement.hasAttribute('data-gz-review')), `local Canvas native control centres stay reachable in ${mode}`);
    }
    report.canvasSize = { before: canvasBefore, after: await size(canvas) };
    await canvas.screenshot({ path: path.join(out, 'canvas-submission.png') });
    report.canvas = survey; report.checks = checks; fs.writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); console.log(`Evidence: ${out}`);
  } finally {
    try { await ctx?.close(); } finally {
      try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
      finally { if (held && fs.readFileSync(path.join(lock, 'owner'), 'utf8').split('\n')[0] === String(process.pid)) { fs.unlinkSync(path.join(lock, 'owner')); fs.rmdirSync(lock); } }
    }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
