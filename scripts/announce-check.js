// Announcements in Glaze's pop-up, headless: the real extension on the saved Canvas Dashboard under an invented school
// origin, Better To Do listing a synthetic announcement. All answers are synthetic; every other request aborts and DNS
// resolves nowhere. No server or LMS needed. Checks the preview (delay, place, Escape), the pop-up (one GET and Canvas's
// read mark, focus in and back, Tab kept inside, Escape), a modifier click keeping the browser's new tab, the fallback to
// the site's page, the genie mid-open, and saves screenshots at 1440 and 320, light and dark, RTL with larger text (Chrome's
// default font size at 24 px, as a student would set it). Then the LMSs' own lists on synthetic Ultra, Canvas and Moodle pages
// (scripts/announce-check-sites.js).
// Takes the heavy lock ($GLAZE_LOCK, default glaze-heavy.lock in the OS temp directory).
//   NODE_PATH=/path/to/node_modules nice -n 10 node scripts/announce-check.js [screenshots directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const G = require('../defaults.js');
// A copy holding the synthetic Ultra and Moodle schools' hosts, as the student's grant does (scripts/check-env.js staged).
const ext = require('./check-env.js').staged(path.resolve(process.env.EXT || path.join(__dirname, '..')), ['https://bb.school.test/*', 'https://moodle.school.test/*']);
const out = path.resolve(process.argv[2] || '/tmp/gz-ann-shots');
const lock = require('./check-env.js').lockPath();
const chromeLaunch = require('./check-env.js').chromeLaunch();
const O = 'https://ann.school.instructure.com';
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'test/fixtures', name), 'utf8');
const frame = `<style>
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; }
  #header, #mobile-header, #breadcrumbs, #footer, #right-side, .ic-Layout-watermark { display: none; }
  #wrapper { margin: 0; } #main, #not_right_side, #content-wrapper, #content { min-width: 0; }
  #content { padding: 24px; } #dashboard_header_container { min-height: 64px; font-size: 24px; }
  .ic-DashboardCard__box__container { display: flex; flex-wrap: wrap; gap: 16px; } .ic-DashboardCard { width: 260px; }
  @media (max-width: 600px) { #content { padding: 12px; } }
</style>`;
const DASH = fixture('canvas-dashboard-cards.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '').replace('</head>', `${frame}</head>`);
const PICTURE = fs.readFileSync(path.join(__dirname, '..', 'icons/icon128.png'));
const day = (n) => new Date(Date.now() + n * 864e5).toISOString();
const ann = (id, title, n) => ({ plannable_type: 'announcement', plannable_id: id, course_id: '25', context_name: 'BIO 1100 · Cell Biology', plannable_date: day(n),
  html_url: `/courses/25/discussion_topics/${id}`, plannable: { title, read_state: 'unread' } });
const PLANNER = [
  ann('7', 'Lab moved to room 2 this week', -1), ann('8', 'Exam seating plan', -2),
  { plannable_type: 'assignment', plannable_id: '31', course_id: '25', context_name: 'BIO 1100 · Cell Biology', plannable_date: day(2), html_url: '/courses/25/assignments/31', plannable: { title: 'Lab report 3', points_possible: 10 }, submissions: { submitted: false } },
];
const TOPIC = {
  id: '7', title: 'Lab moved to room 2 this week', posted_at: day(-1), read_state: 'unread', author: { display_name: 'Dr. Ana Rivera' },
  message: `<img src="/image-redirect" alt="Redirected image"><p>Hi all, this week's lab is in <strong>room 2</strong> of the Science Building, not our usual room.</p>
<p>Bring your lab coat and goggles. We will start with a short safety briefing at 9:05.</p>
<ul><li>Read chapter 4 before you come.</li><li>Lab report 3 is due on Friday.</li></ul>
<p><img src="/courses/25/files/9/preview" alt="Floor map of the Science Building" width="128" height="128"></p>
<p>Questions? See the <a href="/courses/25/pages/lab-safety">lab safety page</a> or <a href="https://example.org/microscopes">this guide to microscopes</a>.</p>
<script>window.stolen = 1</script><img src="https://tracker.example/pixel.gif" alt="tracker"><iframe src="https://evil.example/"></iframe>
<img src="data:image/svg+xml,%3Csvg%20onload='window.stolen=1'%3E" alt="Data image">
<div style="background:url(https://tracker.example/style)">Safe text</div>`,
  attachments: [{ display_name: 'room-2-map.pdf', url: `${O}/files/9/download?download_frd=1` }],
};
const settings = (preset, extra = {}) => G.GZ_SANITIZE({ preset, colors: { ...G.GZ_PRESETS.find(([n]) => n === preset)[1] }, navbar: { on: false },
  enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), widgets: true, todo: true },
  motion: { level: 'expressive', followSystem: false }, announce: { delay: 400 }, ...extra });
const LAYOUT = { tiles: [{ id: 'todo', on: true, size: 'l' }, ...['notes', 'agenda', 'timer', 'quotes', 'music', 'breathe', 'buddy', 'settings', 'pet'].map((id) => ({ id, on: false }))] };
let checks = 0;
const failures = [];
const ok = (v, label) => { checks++; if (!v) { failures.push(label); console.error(`FAIL ${label}`); } else console.log(`ok   ${label}`); };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  let held = false, ctx = null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-announce-check-'));
  try {
    for (let i = 0; !held; i++) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST' || i > 360) throw e; await new Promise((r) => setTimeout(r, 10000)); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nannounce-check\n${new Date().toISOString()}\n`);
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), { ...chromeLaunch, headless: true, viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York',
      reducedMotion: 'no-preference', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND'] });
    require('./check-env.js').noFirstRun(ctx);
    const asked = [];
    const external = new Set();
    ctx.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.origin !== O) external.add(r.url()); });
    let failTopic = false;
    await ctx.route('**/*', (route) => {
      const r = route.request(), u = new URL(r.url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      asked.push(`${r.method()} ${u.pathname}`);
      if (u.origin !== O) { asked.push(`external ${r.url()}`); return route.abort(); }
      if (u.pathname === '/image-redirect') return route.fulfill({ status: 302, headers: { location: 'https://tracker.example/redirected.png' } });
      if (r.method() === 'PUT' && u.pathname === '/api/v1/courses/25/discussion_topics/7/read') return route.fulfill({ status: 204, body: '' });
      if (r.method() !== 'GET') return route.abort();
      const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.pathname === '/api/v1/users/self/profile' || u.pathname === '/api/v1/users/self') return json({ id: '3', time_zone: 'America/New_York' });
      if (u.pathname === '/api/v1/courses') return json([{ id: '25', name: 'BIO 1100 · Cell Biology', course_code: 'BIO 1100', enrollments: [{ type: 'student' }] }]);
      if (u.pathname === '/api/v1/planner/items') return json(PLANNER);
      if (u.pathname === '/api/v1/courses/25/discussion_topics/7') return failTopic ? json({}, 500) : json(TOPIC);
      if (u.pathname === '/api/v1/courses/25/discussion_topics/8') return json({ errors: [] }, 500);
      if (u.pathname.startsWith('/api/v1/')) return json([]);
      if (u.pathname === '/courses/25/files/9/preview') return route.fulfill({ contentType: 'image/png', body: PICTURE });
      if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: DASH });
      if (/^\/courses\/25\/discussion_topics\/\d+$/.test(u.pathname)) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Canvas topic</title><h1>The site\'s page</h1>' });
      return route.abort();
    });
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    const page = await ctx.newPage(), errors = [];
    // The synthetic site page doesn't opt in to Canvas's page transition (content.js @view-transition): Chrome reports the
    // aborted transition there for a plain link too, so that one isn't the pop-up's.
    page.on('pageerror', (e) => { if (!(/\/discussion_topics\/8$/.test(page.url()) && /ViewTransition opt-in disabled/.test(String(e)))) errors.push(String(e)); });
    // Settings change with the page away, as a student would set them: no crossfade of a page being left.
    const store = async (s) => { await page.goto('about:blank'); await opts.evaluate(async ([s, l]) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); await chrome.storage.local.clear(); await chrome.storage.local.set(l); }, [s, { widgetLayout: LAYOUT, freshDefaults: { fresh: false } }]); };
    const link = (id = '7') => page.locator(`#gz-todo a[data-ann="announcement:${id}"]`);
    const open = async () => { await page.goto(`${O}/`); await link().waitFor({ timeout: 15000 }); await page.waitForTimeout(300); };
    const cdp = await ctx.newCDPSession(page);
    // The pop-up lives in a closed shadow root: its box and name through the DevTools protocol, as a page script can't.
    const find = (n, pred) => { if (pred(n)) return n; for (const k of [...(n.children || []), ...(n.shadowRoots || [])]) { const f = find(k, pred); if (f) return f; } return null; };
    const box = async (tag, cls) => {
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const n = find(root, (x) => x.nodeName === tag && (!cls || (x.attributes || []).some((v, i, a) => i % 2 === 0 && v === 'class' && a[i + 1] === cls)));
      if (!n) return null;
      const m = await cdp.send('DOM.getBoxModel', { nodeId: n.nodeId }).catch(() => null);
      if (!m) return null;
      const [x1, y1, , , x3, y3] = m.model.border;
      return { left: x1, top: y1, right: x3, bottom: y3, width: x3 - x1, height: y3 - y1 };
    };
    const ax = async () => (await cdp.send('Accessibility.getFullAXTree')).nodes;
    const dialogName = async () => (await ax()).find((n) => n.role?.value === 'dialog')?.name?.value || null;
    const focusedName = async () => { const f = (await ax()).filter((n) => n.role?.value !== 'RootWebArea' && n.properties?.some((p) => p.name === 'focused' && p.value.value)).at(-1); return f ? `${f.role?.value}:${f.name?.value}` : null; };
    const popupOpen = () => page.evaluate(() => !!document.getElementById('gz-popup'));
    const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });

    // ---- light, 1440: preview, pop-up, keyboard ----
    await store(settings('Paper'));
    await open();
    const a = await link().boundingBox();
    await page.mouse.move(a.x + 10, a.y + a.height / 2);
    await page.waitForTimeout(150);
    ok(!asked.includes('GET /api/v1/courses/25/discussion_topics/7'), 'preview: nothing asked before the delay');
    await page.waitForTimeout(700);
    ok(asked.filter((x) => x === 'GET /api/v1/courses/25/discussion_topics/7').length === 1, 'preview: one GET after the delay');
    const tip = await box('DIV', 'tip');
    ok(tip && (tip.top >= a.y + a.height - 1 || tip.bottom <= a.y + 1), 'preview: beside the link, not over it');
    ok(tip.left >= 0 && tip.right <= 1440 && tip.bottom <= 900, 'preview: inside the viewport');
    ok(await page.evaluate(() => document.querySelector('#gz-todo a[data-ann="announcement:7"]').getAttribute('aria-describedby')?.includes('gz-ann-tip')), 'preview: the link is described by it');
    await shot('preview-light-1440');
    await page.keyboard.press('Tab'); await link().focus();
    await page.mouse.move(0, 0); await page.waitForTimeout(220);
    ok(!!(await box('DIV', 'tip')), 'preview: remains while keyboard focus stays on the link');
    await page.mouse.move(tip.left + 10, tip.top + 10);
    await link().evaluate((el) => el.blur()); await page.waitForTimeout(220);
    ok(!!(await box('DIV', 'tip')), 'preview: remains while the pointer is over it');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    ok(!(await box('DIV', 'tip')), 'preview: Escape puts it away');
    ok(!asked.includes('PUT /api/v1/courses/25/discussion_topics/7/read'), 'preview: nothing marked read');
    // The pop-up: mid-genie frames (paused and sought through the DevTools protocol: they run in a closed shadow root), then settled.
    const moving = [];
    cdp.on('Animation.animationStarted', (e) => moving.push(e.animation));
    await cdp.send('Animation.enable');
    const sourceWidth = await link().evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; });
    await link().click();
    for (let i = 0; i < 40 && !moving.some((m) => m.source?.duration >= 350); i++) await page.waitForTimeout(10);
    const genie = moving.filter((m) => m.type === 'WebAnimation');
    ok(genie.some((m) => m.source?.duration >= 350 && m.source.duration <= 450), `the genie plays (${genie.map((m) => m.source?.duration).join(', ')} ms)`);
    const ids = genie.map((m) => m.id);
    await cdp.send('Animation.setPaused', { animations: ids, paused: true });
    let firstFrame;
    for (const animation of genie) {
      const resolved = await cdp.send('Animation.resolveAnimation', { animationId: animation.id });
      const data = await cdp.send('Runtime.callFunctionOn', { objectId: resolved.remoteObject.objectId,
        functionDeclaration: 'function() { return { tag: this.effect.target.tagName, frame: this.effect.getKeyframes()[0] }; }', returnByValue: true });
      if (data.result.value?.tag === 'DIALOG') firstFrame = data.result.value.frame;
    }
    const firstClip = firstFrame?.clipPath?.match(/polygon\(([-\d.]+)% [^,]+, ([-\d.]+)%/);
    const dialogWidth = (await box('DIALOG'))?.width;
    if (!firstClip || Math.abs((+firstClip[2] - +firstClip[1]) / 100 * dialogWidth - sourceWidth) >= 1) console.log('genie measurement', JSON.stringify({ firstFrame, dialogWidth, sourceWidth }));
    ok(firstClip && Math.abs((+firstClip[2] - +firstClip[1]) / 100 * dialogWidth - sourceWidth) < 1, 'genie: the funnel starts at the title text width');
    for (const [i, f] of [[1, 0.2], [2, 0.45], [3, 0.7]]) {
      await cdp.send('Animation.seekAnimations', { animations: ids, currentTime: 420 * f });
      await page.waitForTimeout(60);
      await shot(`genie-open-${i}`);
    }
    await cdp.send('Animation.setPaused', { animations: ids, paused: false });
    await cdp.send('Animation.disable');
    await page.waitForTimeout(700);
    ok(await popupOpen(), 'pop-up: open after a plain click');
    ok(await dialogName() === 'Lab moved to room 2 this week', 'pop-up: a dialog named by its title');
    const fn = await focusedName(); ok(/^heading:Lab moved/.test(fn || ''), `pop-up: focus on its title (${fn})`);
    ok(asked.filter((x) => x === 'GET /api/v1/courses/25/discussion_topics/7').length === 1, 'pop-up: no second GET after the preview');
    await page.waitForTimeout(300);
    ok(asked.includes('PUT /api/v1/courses/25/discussion_topics/7/read'), 'pop-up: Canvas\'s read mark');
    ok(!(await page.evaluate(() => window.stolen)), 'pop-up: the body\'s script never ran');
    ok(!asked.some((x) => /tracker|evil/.test(x)), 'pop-up: nothing from another site');
    ok(asked.includes('GET /image-redirect'), 'pop-up: the redirecting picture was requested');
    ok(!external.has('https://tracker.example/redirected.png'), 'pop-up: even same-origin pictures cannot redirect off-site');
    const { root: imageRoot } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const picture = find(imageRoot, (n) => n.nodeName === 'IMG' && n.attributes?.includes('Floor map of the Science Building'));
    const imageObject = picture && await cdp.send('DOM.resolveNode', { nodeId: picture.nodeId });
    const loadedImage = imageObject && await cdp.send('Runtime.callFunctionOn', { objectId: imageObject.object.objectId, functionDeclaration: 'function() { return this.naturalWidth > 0; }', returnByValue: true });
    ok(loadedImage?.result.value, 'pop-up: the same-origin picture still loads');
    const d = await box('DIALOG');
    ok(d.left >= 0 && d.right <= 1440, 'pop-up: inside the viewport at 1440');
    await shot('popup-light-1440');
    let trapped = true;
    for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i < 12; i++) {
      await page.keyboard.press(key);
      trapped &&= await page.evaluate(() => document.activeElement?.id === 'gz-popup');
    }
    ok(trapped, 'pop-up: every Tab and Shift+Tab stays inside');
    await link().evaluate((el) => el.focus());
    ok(await page.evaluate(() => document.activeElement?.id === 'gz-popup'), 'pop-up: the background is inert');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    ok(!(await popupOpen()), 'pop-up: Escape closes it');
    ok(await page.evaluate(() => document.activeElement?.matches('#gz-todo a[data-ann="announcement:7"]')), 'pop-up: focus back on the link');
    ok(await page.evaluate(() => !document.querySelector('#gz-todo li[data-unread] a[data-ann="announcement:7"]')), 'Better To Do: no longer unread');
    // Ctrl/Cmd-click: the browser's own new tab, no pop-up.
    const [tab] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }), link().click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })]);
    ok(tab && !(await popupOpen()), 'a modifier click opens a new tab, not the pop-up');
    await tab.close();
    // Unreadable: the site's page instead.
    await Promise.all([page.waitForURL(`${O}/courses/25/discussion_topics/8`, { timeout: 15000 }), link('8').click()]);
    ok(true, 'unreadable: the site\'s own page opens');


    // ---- the rest: light 320, dark 1440 and 320, RTL with larger text ----
    for (const [name, preset, width, height, rtl] of [['light-320', 'Paper', 320, 640], ['dark-1440', 'Frost', 1440, 900], ['dark-320', 'Frost', 320, 640], ['rtl-large-320', 'Paper', 320, 640, true]]) {
      await page.setViewportSize({ width, height });
      await store(settings(preset, { motion: { level: 'off' } }));
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: rtl ? 24 : 16, fixed: 13 } });
      await open();
      if (rtl) await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
      await link().scrollIntoViewIfNeeded();
      await link().click();
      await page.waitForTimeout(500);
      ok(await popupOpen(), `${name}: open`);
      const b = await box('DIALOG');
      ok(b.left >= 0 && b.right <= width + 0.5 && b.bottom <= height + 0.5, `${name}: inside the viewport (${Math.round(b.left)}..${Math.round(b.right)} of ${width})`);
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no sideways scroll`);
      await shot(`popup-${name}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    // The per-entry preview switches belong to All settings, search finds them, and Reset changes only this section.
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html#pages/announcements`);
    await opts.locator('[data-key="announce.open"]').waitFor();
    await opts.locator('#editor-all').setChecked(false);
    ok(!(await opts.locator('[data-key="announce.glazePreview"]').isVisible()), 'settings: per-entry previews stay in All settings');
    await opts.selectOption('[data-key="announce.open"]', 'site');
    await opts.fill('#find', 'Preview on hover');
    ok(await opts.locator('[data-key="announce.glazePreview"]').isVisible(), 'settings: search reveals per-entry previews');
    await opts.fill('#find', ''); await opts.locator('#editor-all').check();
    await opts.locator('[data-key="announce.glazePreview"]').uncheck();
    await opts.waitForFunction(() => new Promise((r) => chrome.storage.sync.get('announce', (s) => r(s.announce?.glazePreview === false && s.announce?.open === 'site'))));
    await opts.locator('[data-reset-section="pages/popups"]').click();
    await opts.waitForFunction(() => new Promise((r) => chrome.storage.sync.get('announce', (s) => r(s.announce?.glazePreview === true))));
    ok(await opts.locator('[data-key="announce.glazePreview"]').isChecked(), 'settings: Reset restores per-entry previews');
    ok(await opts.locator('[data-key="announce.open"]').inputValue() === 'site', 'settings: Reset preserves the everyday opening choice');
    await opts.evaluate(() => editor.show('pages/popups'));
    await opts.screenshot({ path: path.join(out, 'settings-popups-1440.png') });
    // The other adapters against their native response shapes, with the same shipped core in a browser document.
    for (const site of ['ultra', 'moodle']) {
      const fixturePage = await ctx.newPage(), origin = `https://${site}.ann.invalid`, requests = [];
      try {
        await fixturePage.route('**/*', (r) => {
          const u = new URL(r.request().url());
          if (u.origin !== origin) return r.abort();
          if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-gz-motion="off"><body><a id="source" href="/">Announcement</a></body></html>' });
          requests.push([r.request().method(), u.pathname]);
          const body = site === 'ultra' ? { title: 'Lab moved', body: TOPIC.message, created: day(-1) }
            : [{ data: { posts: [{ subject: 'Lab moved', message: '<p>Room 2.</p><script>window.stolen=1</script>', hasparent: false, unread: true, author: { fullname: 'Dr. Rivera' }, timecreated: 1792324800 }] } }];
          return r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        });
        await fixturePage.goto(`${origin}/`);
        await fixturePage.evaluate((site) => {
          window.GZ_CTX = { site, settings: () => ({ announce: { preview: true, delay: 20, lines: 3 }, popup: { anim: 'none' } }),
            t: (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v?.[k] || ''), locale: () => 'en', need: async () => {},
            moodleIn: async () => ({ session: () => ({ root: location.origin, sesskey: 'fixture' }) }) };
        }, site);
        for (const f of ['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'defaults.js', 'lib/i18n.js', 'lib/page.js', 'lib/doctext.js', 'lib/notes.js', 'lib/lmsq.js', 'lib/popup.js', 'lib/announce.js', 'lib/ultra.js', 'features/popup.js', 'features/announce.js']) await fixturePage.addScriptTag({ path: path.join(ext, f) });
        await fixturePage.evaluate(async (site) => {
          await GZ_ANNOUNCE.ready;
          window.reference = { site, courseId: site === 'ultra' ? '_25_1' : '25', id: site === 'ultra' ? '_7_1' : '7', url: `${location.origin}/announcement`, title: 'Lab moved', from: document.getElementById('source') };
          GZ_ANNOUNCE.preview(reference.from, reference); reference.from.focus();
        }, site);
        await fixturePage.waitForTimeout(200);
        ok(requests.length === (site === 'ultra' ? 1 : 0), `${site}: preview request discipline`);
        const state = await fixturePage.evaluate(async () => {
          const h = GZ_ANNOUNCE.open(reference); await h.loaded;
          window.fixtureHandle = h;
          const d = h.dialog;
          return { title: d.querySelector('h2').textContent, safe: !d.querySelector('script, iframe, [style]'), text: d.querySelector('.body').textContent, modal: d.matches(':modal') };
        });
        await fixturePage.screenshot({ path: path.join(out, `${site}-fixture.png`) });
        state.restored = await fixturePage.evaluate(() => { fixtureHandle.close(true); return document.activeElement === reference.from; });
        ok(state.title === 'Lab moved' && state.text.includes(site === 'ultra' ? 'Hi all' : 'Room 2.'), `${site}: full body and title`);
        ok(state.safe && state.modal && state.restored, `${site}: sanitized modal and focus restoration`);
        ok(requests.filter(([method, url]) => site === 'ultra' ? url.startsWith('/learn/api/') : method === 'POST').length === 1 && !requests.some(([m]) => m === 'PUT'), `${site}: one body fetch and no separate read write`);
      } finally { await fixturePage.close(); }
    }
    await require('./announce-check-sites.js')({ ctx, opts, O, ok, out });
    ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(`${checks - failures.length}/${checks} checks passed; screenshots in ${out}`);
    if (failures.length) process.exitCode = 1;
  } catch (e) {
    for (const p of ctx?.pages() || []) if (p.url().startsWith(O)) await p.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    console.error(`FAIL ${e.stack || e}`);
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
    if (held) { fs.rmSync(path.join(lock, 'owner'), { force: true }); fs.rmdirSync(lock); }
  }
})();
