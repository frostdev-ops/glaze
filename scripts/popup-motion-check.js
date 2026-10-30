// Synthetic shared-popup motion: real browser geometry, curved text/table strips, interruption, focus, reduced motion
// and cleanup. No LMS, account, server, extension profile or network. Screenshots stay outside the repository.
// NODE_PATH=/path/to/node_modules nice -n 10 node scripts/popup-motion-check.js [/tmp/glaze-genie]
// POPUP_ENGINE=webkit checks WebKit too; POPUP_FRAMES=/tmp/genie-frames captures an opening/closing sequence at 60 fps.
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const env = require('./check-env.js');
const out = path.resolve(process.argv[2] || '/tmp/glaze-genie');
const lock = require('./check-env.js').lockPath();
let browser, held = false, checks = 0;
const ok = (value, label) => { assert.ok(value, label); checks++; console.log(`ok ${label}`); };

(async () => {
  try {
    for (let i = 0; !held; i++) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST' || i > 180) throw e; await new Promise((r) => setTimeout(r, 1000)); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\npopup-motion-check\n${new Date().toISOString()}\n`);
    fs.mkdirSync(out, { recursive: true });
    await require('./wait-for-browser.js')();
    const engine = process.env.POPUP_ENGINE === 'webkit' ? webkit : chromium;
    browser = await engine.launch({ ...(engine === chromium ? env.chromeLaunch() : {}), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
    const errors = [], requests = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/*', (r) => { requests.push(r.request().url()); return r.abort(); });
    await page.setContent(`<!doctype html><html data-gz-motion="expressive"><style>
      :root { --gz-font: system-ui; --gz-radius: 18px; --gz-surface: #14293e; --gz-ink: #ecf6fc; --gz-ink-muted: #9cb5c7;
        --gz-line: #2d475d; --gz-line-strong: #476278; --gz-accent: #22c9ec; --gz-font-head: system-ui; }
      body { background: #091625; color: #ecf6fc; font: 16px system-ui; margin: 0; min-height: 100vh; }
      main { padding: 72px; } h1 { font-size: 26px; } button { font: inherit; cursor: pointer; }
      .source { color: #93e7f8; background: #17394e; border: 1px solid #356076; border-radius: 10px; padding: 12px 18px; }
      .cards { display: flex; gap: 20px; margin-top: 50px; } article { padding: 26px; border: 1px solid #29445b; border-radius: 18px; background: #11263a; width: 300px; }
      article p { color: #9cb5c7; line-height: 1.6; } #below { position: fixed; right: 60px; bottom: 40px; }
    </style><main><h1>Course activity</h1><button class="source" id="above">View grading rubric</button>
      <div class="cards"><article><h2>Research paper</h2><p>Evaluate the argument, evidence and organization of the submitted paper.</p></article>
      <article><h2>Announcements</h2><p>Course updates and the next studio meeting.</p><button class="source" id="middle">Studio moved to room 204</button></article></div>
      <button class="source" id="below">Open announcement</button></main></html>`);
    await page.evaluate(() => {
      // Only this synthetic fixture exposes the closed root for assertions and deterministic animation seeks.
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (o) { return attach.call(this, { ...o, mode: 'open' }); };
      window.GZ_CTX = { t: (s) => s, settings: () => ({ popup: { anim: 'genie' } }), need: async () => {} };
      window.GZ_LMSQ = {}; window.GZ_NOTES = {};
      window.finished = 0;
      window.openPopup = (source = 'above', rubric = true) => {
        const body = document.createElement('div');
        if (rubric) {
          const table = document.createElement('table');
          for (const row of [['Criterion', 'Excellent', 'Developing', 'Needs work'],
            ['Argument', 'Clear, specific thesis supported throughout.', 'Thesis is present; the reasoning needs focus.', 'The central claim is difficult to identify.'],
            ['Evidence', 'Relevant sources support each major claim.', 'Some claims need stronger support.', 'Sources are missing or unrelated.'],
            ['Organization', 'Ideas build logically with clear transitions.', 'The sequence is mostly clear.', 'Ideas are disconnected.'],
            ['Style', 'Precise language and consistent citations.', 'Some wording and citations need attention.', 'Frequent errors interrupt the reading.']]) {
            const tr = document.createElement('tr');
            for (const text of row) { const td = document.createElement(table.rows.length ? 'td' : 'th'); td.textContent = text; tr.append(td); }
            table.append(tr);
          }
          body.append(table);
        } else {
          for (const text of ['Our next studio meets in room 204 on Thursday at 10:00.', 'Bring your sketchbook and your first draft. We will begin with a short group critique, followed by time to revise.', 'The reading for this week is available in Course Content.']) {
            const p = document.createElement('p'); p.textContent = text; body.append(p);
          }
        }
        window.handle = GZ_POPUP.open({ title: rubric ? 'Research paper rubric' : 'Studio moved to room 204', meta: 'Writing and research · Dr. Rivera', wide: rubric,
          source: document.getElementById(source), body, onClose: () => window.finished++ });
      };
      window.animations = () => [...document.querySelector('#gz-popup')?.shadowRoot.querySelectorAll('*') || []].flatMap((el) => el.getAnimations());
      window.seek = (p) => { for (const a of animations()) { a.pause(); a.currentTime = p * a.effect.getTiming().duration; } };
      window.finish = () => { for (const a of animations()) a.finish(); };
    });
    for (const file of ['lib/popup.js', 'features/popup.js']) await page.addScriptTag({ path: path.join(__dirname, '..', file) });
    await page.evaluate(() => GZ_POPUP.ready);
    for (const [source, rubric] of [['above', true], ['below', false], ['middle', false]]) {
      await page.evaluate(([s, r]) => { openPopup(s, r); seek(0.01); }, [source, rubric]);
      const start = await page.evaluate(() => {
        const root = document.querySelector('#gz-popup').shadowRoot;
        return { strips: root.querySelectorAll('.genie-strip').length, hidden: root.querySelector('.genie-stage')?.getAttribute('aria-hidden'),
          focused: root.activeElement?.id, duplicatedIds: root.querySelectorAll('.genie-stage [id]').length,
          realName: root.querySelector('dialog').getAttribute('aria-labelledby') };
      });
      ok(start.strips >= 8 && start.strips <= 20, `${source}: content bends in bounded strips`);
      ok(start.hidden === 'true' && start.duplicatedIds === 0 && start.focused === start.realName, `${source}: one accessible dialog with focus on its actual title`);
      for (const p of [0.2, 0.45, 0.7, 0.9]) {
        await page.evaluate((p) => seek(p), p);
        const gap = await page.evaluate(() => {
          const strips = [...document.querySelector('#gz-popup').shadowRoot.querySelectorAll('.genie-strip')];
          const point = (el, x, y) => { const p = new DOMMatrix(getComputedStyle(el).transform).transformPoint({ x, y }); return [p.x / p.w, p.y / p.w]; };
          let max = 0;
          for (let i = 0; i < strips.length - 1; i++) for (const x of [0, strips[i].clientWidth]) {
            const a = strips[i], b = strips[i + 1], y = parseFloat(a.firstElementChild.style.top) - parseFloat(b.firstElementChild.style.top);
            const l = point(a, x, y), r = point(b, x, 0);
            max = Math.max(max, Math.hypot(l[0] - r[0], l[1] - r[1]));
          }
          return max;
        });
        ok(gap < 1, `${source} at ${p}: interpolated strip seams stay below one pixel (${gap.toFixed(3)})`);
        await page.screenshot({ path: path.join(out, `${source}-${Math.round(p * 100)}.png`) });
      }
      await page.evaluate(() => finish());
      await page.waitForFunction(() => !document.querySelector('#gz-popup').shadowRoot.querySelector('.genie-stage'));
      ok(await page.evaluate(() => animations().length === 0), `${source}: no animation or visual copies remain after opening`);
      await page.screenshot({ path: path.join(out, `${source}-open.png`) });
      await page.evaluate(() => { handle.close(); seek(0.45); });
      ok(await page.evaluate((s) => document.activeElement.id === s && document.querySelector('#gz-popup').shadowRoot.querySelector('dialog').inert, source), `${source}: focus returns before the inert closing effect`);
      await page.screenshot({ path: path.join(out, `${source}-close.png`) });
      await page.evaluate(() => finish());
      await page.waitForFunction(() => !document.querySelector('#gz-popup'));
    }
    // Reverse an opening in place, with no new sheet or a snap to a fully open pose.
    const reverse = await page.evaluate(() => {
      openPopup(); seek(0.35);
      const root = document.querySelector('#gz-popup').shadowRoot, strip = root.querySelector('.genie-strip');
      const before = getComputedStyle(strip).transform, a = animations();
      handle.close(); for (const x of a) x.pause();
      return { same: strip === root.querySelector('.genie-strip') && before === getComputedStyle(strip).transform,
        reverse: a.every((x) => x.playbackRate < 0), focused: document.activeElement.id };
    });
    ok(reverse.same && reverse.reverse && reverse.focused === 'above', 'mid-open close reverses the existing sheet without jumping');
    await page.evaluate(() => { openPopup('below', false); seek(0.5); });
    ok(await page.locator('#gz-popup').count() === 1, 'reopening removes the previous closing effect immediately');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => !document.querySelector('#gz-popup').shadowRoot.querySelector('.genie-stage'));
    ok(await page.evaluate(() => animations().length === 0), 'turning on reduced motion settles a running effect immediately');
    await page.evaluate(() => handle.close());
    await page.evaluate(() => openPopup());
    ok(await page.evaluate(() => animations().length === 0), 'reduced motion opens without effects');
    await page.evaluate(() => handle.close());
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { openPopup(); seek(0.4); });
    await page.setViewportSize({ width: 900, height: 900 });
    await page.waitForFunction(() => !document.querySelector('#gz-popup').shadowRoot.querySelector('.genie-stage'));
    ok(await page.evaluate(() => animations().length === 0), 'resize settles the effect and releases all animations');
    await page.evaluate(() => handle.close(true));
    const bounded = await page.evaluate(() => {
      const body = document.createElement('div');
      for (let i = 0; i < 1100; i++) { const span = document.createElement('span'); span.textContent = 'Criterion '; body.append(span); }
      window.handle = GZ_POPUP.open({ title: 'Large rubric', source: document.getElementById('above'), body, onClose: () => finished++ });
      const root = document.querySelector('#gz-popup').shadowRoot;
      const fallback = !root.querySelector('.genie-stage') && animations().some((a) => a.effect.getKeyframes()[0].clipPath);
      handle.close(true);
      return fallback;
    });
    ok(bounded, 'large documents use the bounded curved silhouette without making thousands of extra copies');
    const noApi = await page.evaluate(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = undefined;
      try {
        openPopup();
        const root = document.querySelector('#gz-popup').shadowRoot;
        const visible = !root.querySelector('.genie-stage') && getComputedStyle(root.querySelector('header')).opacity === '1';
        handle.close();
        return visible && !document.querySelector('#gz-popup');
      } finally { Element.prototype.animate = animate; }
    });
    ok(noApi, 'missing animation support leaves a visible, usable dialog and closes cleanly');
    ok(await page.evaluate(() => finished === 9), 'every opened dialog closes exactly once');
    ok(errors.length === 0, `no browser errors (${errors.join(', ')})`);
    ok(requests.length === 0, 'no network requests');
    if (process.env.POPUP_FRAMES) {
      const frames = path.resolve(process.env.POPUP_FRAMES);
      fs.mkdirSync(frames, { recursive: true });
      await page.setViewportSize({ width: 1100, height: 800 });
      await page.evaluate(() => { openPopup(); seek(0); });
      let n = 0;
      const shot = async () => page.screenshot({ path: path.join(frames, `${String(n++).padStart(4, '0')}.png`) });
      for (let i = 0; i <= 25; i++) { await page.evaluate((p) => seek(p), i / 25); await shot(); }
      for (let i = 0; i < 24; i++) fs.copyFileSync(path.join(frames, `${String(n - 1).padStart(4, '0')}.png`), path.join(frames, `${String(n++).padStart(4, '0')}.png`));
      await page.evaluate(() => { handle.close(); seek(0); });
      for (let i = 0; i <= 20; i++) { await page.evaluate((p) => seek(p), i / 20); await shot(); }
      for (let i = 0; i < 24; i++) fs.copyFileSync(path.join(frames, `${String(n - 1).padStart(4, '0')}.png`), path.join(frames, `${String(n++).padStart(4, '0')}.png`));
    }
    console.log(`${checks} popup motion checks passed`);
  } finally {
    await browser?.close();
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
