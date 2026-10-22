// Native discussion participant cards mount through Ultra's explicit-root IntersectionObserver.
// NODE_PATH=<installed playwright> nice -n 15 node scripts/sidebar-participants-check.js [screenshots]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = process.env.EXT || path.join(__dirname, '..');
const out = process.argv[2];
let checks = 0, fails = 0;
const check = (ok, text) => { checks++; fails += !ok; console.log(`${ok ? 'ok' : 'FAIL'} ${text}`); };
(async () => {
  let browser;
  try {
    await require('./wait-for-browser.js')();
    browser = await chromium.launch({ headless: true, ...require('./check-env.js').chromeLaunch(), args: ['--host-resolver-rules=MAP * ~NOTFOUND'], chromiumSandbox: false });
    const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
    await page.route('**/*', (r) => r.request().url().startsWith('https://bb.school.test/ultra/') ? r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }) : r.abort());
    const shot = async (name) => { if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `${name}.png`) }); } };
    const setup = async (style, surface = 'solid', short = false) => {
      await page.setViewportSize({ width: 1800, height: 900 });
      await page.goto('https://bb.school.test/ultra/courses/_101_1/discussion/_9_1');
      await page.setContent(`<style>
        * { box-sizing: border-box; } html { --gz-font: system-ui; --gz-font-head: system-ui; --gz-surface: white; --gz-ink: #182332; --gz-ink-muted: #556575; --gz-line: #c5cdd5; --gz-line-strong: #a5b0bc; --gz-radius: 16px; --gz-accent: #165ec5; }
        body { margin: 0; font: 15px/1.5 system-ui; } content-page-header { display: block; height: 47px; background: #e8eef5; }
        .routed-page > content-page-header { position: relative; z-index: 1; } .routed-page > .routed-page-body { position: relative; z-index: 0; }
        #learningModulePanelContainerId { position: fixed; top: 47px; bottom: 25px; left: 0; right: 0; padding-inline: 30px 40px; overflow: auto; }
        #full-discussions { margin-top: 136px; } .course-main-container { display: grid; grid-template-columns: minmax(0, 1fr) 427px; max-width: 1280px; margin: 0 auto; align-items: flex-start; }
        .thread { min-height: ${short ? 80 : 5232}px; background: #f2f5f8; } .layer-details { width: 427px; } .discussion-settings, .discussion-participants { padding: 12px; border: 1px solid #ccd5df; }
        .discussion-settings { min-height: 180px; } h3 { margin: 0 0 8px; } ul { margin: 0; padding: 0; list-style: none; }
        .participant-card-wrap { display: block; width: 100%; min-height: 56px; text-align: left; border: 0; border-bottom: 1px solid #dde3eb; background: white; padding: 8px; font: inherit; }
        bb-participant-card, [bb-intersection-observer-target] { display: block; }
      </style><div id="site-wrap"><section class="routed-page route-view-container"><content-page-header>Course / Discussion</content-page-header><div class="routed-page-body"><div id="learningModulePanelContainerId"><div id="full-discussions" class="full course-discussion" bb-intersection-observer-root><div class="course-main-container"><div class="thread">Native discussion thread</div><div class="layer-details"><div><bb-discussion-settings><div class="full-panel-details"><div class="discussion-settings student-details"><h3>Details &amp; Information</h3><p>Discussion due Sunday.</p></div></div></bb-discussion-settings></div><div id="full-panel-details"><div class="discussion-participants show-for-large-up"><h3>Participation</h3><ul id="participantsFilterList">${Array.from({ length: 24 }, (_, i) => `<li><button class="participant-card-wrap" data-index="${i}"><bb-participant-card><div bb-intersection-observer-target intersection-observer-target-id="${i}"></div></bb-participant-card></button></li>`).join('')}</ul></div></div></div></div></div></div></div></section></div>`);
      for (const file of ['features/apps.css', 'features/sidebar.css']) await page.addStyleTag({ path: path.join(root, file) });
      for (const file of ['lib/widgets.js', 'lib/sidebar.js']) await page.addScriptTag({ path: path.join(root, file) });
      await page.evaluate(({ style, surface }) => {
        window.nativeHost = document.querySelector('.layer-details');
        window.nativeTargets = [...document.querySelectorAll('[bb-intersection-observer-target]')];
        window.nativeButtons = [...document.querySelectorAll('.participant-card-wrap')];
        window.clicked = [];
        nativeButtons.forEach((b) => b.addEventListener('click', () => clicked.push(Number(b.dataset.index))));
        window.nativeObserver = new IntersectionObserver((entries) => {
          for (const e of entries) {
            const text = e.isIntersecting ? `Participant ${Number(e.target.getAttribute('intersection-observer-target-id')) + 1}` : '';
            if (e.target.textContent !== text) e.target.textContent = text;
          }
        }, { root: document.querySelector('[bb-intersection-observer-root]'), threshold: 0 });
        nativeTargets.forEach((e) => nativeObserver.observe(e));
        let rec = GZ_SIDEBAR.clean({ mig: 1, width: 352, chose: { width: true } });
        window.chrome = { storage: { local: { get: (key, cb) => cb({ [key]: rec }) }, onChanged: { addListener() {}, removeListener() {} } }, runtime: { sendMessage: (m, cb) => { if (m.type === 'glaze:sidebar') rec = GZ_SIDEBAR.apply(rec, m.ops, { lms: 'ultra' }); cb({ ok: true }); } } };
        window.SET = { enhance: { sidebar: true }, sidebar: { style, surface, open: 'expanded' } };
        window.GZ_CTX = { site: 'ultra', t: (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v?.[k] ?? ''), need: async () => {}, account: async () => '_42_1', courseId: () => '_101_1', settings: () => SET };
      }, { style, surface });
      await page.addScriptTag({ path: path.join(root, 'features/sidebar.js') });
      await page.evaluate(async () => { GZ_SIDEBAR_UI.sync(true); await GZ_SIDEBAR_UI.ready(); });
      await page.waitForSelector('[data-gz-sidebar-host]');
      await page.waitForTimeout(180);
    };
    const visibleCard = () => page.evaluate(() => {
      const host = nativeHost.getBoundingClientRect();
      return nativeButtons.filter((b) => { const r = b.getBoundingClientRect(); return r.top >= host.top + 80 && r.bottom <= host.bottom; }).map((b) => ({ index: Number(b.dataset.index), text: b.textContent.trim() }));
    });
    const mounted = async (tag) => { const cards = await visibleCard(); check(cards.length > 0 && cards.every((b) => b.text === `Participant ${b.index + 1}`), `${tag}: native IO mounts visible participants (${JSON.stringify(cards)})`); };
    for (const style of ['float', 'embed']) for (const surface of ['solid', 'clear', 'glass']) {
      const tag = `${style}/${surface}`;
      await setup(style, surface);
      await mounted(`${tag} expanded`);
      check(await page.evaluate(() => Math.abs(nativeHost.getBoundingClientRect().left - document.querySelector('.thread').getBoundingClientRect().right - 16) <= 1), `${tag}: expanded discussion keeps one gap beside the native sidebar`);
      await shot(`${style}-${surface}-expanded`);
      check(await page.locator('[data-gz-sidebar-host]').evaluate((e) => e.getBoundingClientRect().top >= document.querySelector('content-page-header').getBoundingClientRect().bottom), `${tag}: sidebar header is fully below the breadcrumb`);
      await page.evaluate(() => { document.getElementById('learningModulePanelContainerId').scrollTop = 1200; });
      await page.waitForTimeout(180);
      const pin = await page.locator('[data-gz-sidebar-host]').boundingBox();
      await page.evaluate(() => { document.getElementById('learningModulePanelContainerId').scrollTop = 1600; });
      await page.waitForTimeout(180);
      check(await page.locator('[data-gz-sidebar-host]').evaluate((e, y) => Math.abs(e.getBoundingClientRect().top - y) <= 1 && y >= document.querySelector('content-page-header').getBoundingClientRect().bottom, pin.y), `${tag}: sidebar sticks below the breadcrumb while the discussion scrolls`);
      await mounted(`${tag} thread scrolled`);
      await page.evaluate(() => { const scroll = document.getElementById('learningModulePanelContainerId'); scroll.scrollTop = scroll.scrollHeight; });
      await page.waitForTimeout(180);
      await mounted(`${tag} thread bottom`);
      await page.evaluate(() => { nativeHost.scrollTop = nativeHost.scrollHeight; });
      await page.waitForTimeout(180);
      await mounted(`${tag} sidebar scrolled`);
      check(await page.evaluate(() => nativeTargets[23].textContent === 'Participant 24'), `${tag}: final participant mounts when scrolled into the sidebar`);
      await page.locator('.participant-card-wrap').last().click();
      check(await page.evaluate(() => clicked.includes(23)), `${tag}: native participant click handler still works`);
      await page.locator('.gz-sb-toggle').click();
      await page.waitForTimeout(120);
      check(await page.locator('html').getAttribute('data-gz-sidebar') === 'collapsed', `${tag}: sidebar collapses`);
      check(await page.evaluate(() => Math.abs(nativeHost.getBoundingClientRect().left - document.querySelector('.thread').getBoundingClientRect().right - 16) <= 1 && nativeHost.getBoundingClientRect().width === 48), `${tag}: collapsed discussion reserves only its narrow strip and gap`);
      await page.locator('.gz-sb-toggle').click();
      await page.waitForTimeout(180);
      await mounted(`${tag} reopened`);
      await page.setViewportSize({ width: 900, height: 900 });
      await page.waitForTimeout(180);
      await page.locator('#gz-sb-launch').click();
      await page.waitForTimeout(180);
      await page.evaluate(() => { nativeHost.scrollTop = nativeHost.scrollHeight; });
      await page.waitForTimeout(180);
      await mounted(`${tag} drawer`);
      check(await page.evaluate(() => { const grid = document.querySelector('.course-main-container'); return Math.abs(nativeHost.getBoundingClientRect().right - grid.getBoundingClientRect().right + parseFloat(getComputedStyle(grid).paddingRight)) <= 1; }), `${tag}: narrow drawer stays at the discussion root's right edge`);
      check(await page.evaluate(() => { const r = nativeButtons[23].getBoundingClientRect(); return nativeButtons[23].contains(document.elementFromPoint(r.left + 15, r.top + 15)); }), `${tag}: drawer participants receive pointer hits`);
      await shot(`${style}-${surface}-drawer`);
      check(await page.evaluate(() => document.elementFromPoint(100, 400)?.classList.contains('gz-sb-backdrop')), `${tag}: backdrop intercepts discussion clicks in its native stacking context`);
      await page.evaluate(() => {
        const portal = document.createElement('div'); portal.id = 'native-modal'; portal.setAttribute('role', 'dialog');
        portal.style.cssText = 'position:fixed;z-index:5000;inset:150px 200px;background:white;border:2px solid black';
        const close = document.createElement('button'); close.textContent = 'Close native dialog'; close.addEventListener('click', () => portal.remove()); portal.append(close); document.body.append(portal); close.focus();
      });
      await page.waitForTimeout(120);
      check(await page.locator('#native-modal').evaluate((e) => e.contains(document.elementFromPoint(300, 200))) && await page.locator('.gz-sb-backdrop').isHidden(), `${tag}: native LMS modal takes pointer routing and hides the backdrop`);
      await page.getByText('Close native dialog', { exact: true }).click();
      await page.waitForTimeout(120);
      check(await page.evaluate(() => document.elementFromPoint(100, 400)?.classList.contains('gz-sb-backdrop')), `${tag}: closing the native modal restores the drawer backdrop`);
      await page.mouse.click(100, 400);
      check(await page.locator('html').getAttribute('data-gz-sidebar-open') === null, `${tag}: backdrop click closes the discussion drawer`);
      await page.evaluate(() => GZ_SIDEBAR_UI.sync(false));
      check(await page.evaluate(() => nativeHost === document.querySelector('.layer-details') && nativeTargets.every((e, i) => e === document.querySelectorAll('[bb-intersection-observer-target]')[i]) && !nativeHost.hasAttribute('data-gz-sidebar-host') && !nativeHost.hasAttribute('popover')), `${tag}: teardown preserves native nodes and restores host attributes`);
    }
    for (const style of ['float', 'embed']) {
      const tag = `${style} short discussion`;
      await setup(style, 'solid', true);
      await mounted(`${tag} expanded`);
      await page.evaluate(() => { nativeHost.scrollTop = nativeHost.scrollHeight; const scroll = document.getElementById('learningModulePanelContainerId'); scroll.scrollTop = scroll.scrollHeight; });
      await page.waitForTimeout(180);
      check(await page.evaluate(() => nativeTargets[23].textContent === 'Participant 24' && nativeButtons[23].getBoundingClientRect().bottom <= document.getElementById('learningModulePanelContainerId').getBoundingClientRect().bottom + 1), `${tag}: final participant fits inside the native scrollport`);
      const expandedHeight = await page.locator('#full-discussions').evaluate((e) => e.getBoundingClientRect().height);
      await page.locator('.gz-sb-toggle').click();
      await page.waitForTimeout(120);
      check(await page.locator('#full-discussions').evaluate((e, h) => e.getBoundingClientRect().height <= h && e.getBoundingClientRect().height < 200, expandedHeight), `${tag}: collapse does not leave a full-height native column`);
      await page.locator('.gz-sb-toggle').click();
      await page.waitForTimeout(120);
      await page.locator('.gz-sb-pagehead button').click();
      await page.waitForTimeout(120);
      check(await page.locator('.discussion-participants').isHidden() && await page.locator('.gz-sb-toggle').isVisible(), `${tag}: folding This page retains reachable sidebar controls`);
      await page.evaluate(() => { SET.sidebar.page = 'hidden'; GZ_SIDEBAR_UI.sync(true); });
      await page.waitForTimeout(120);
      check(await page.locator('html').getAttribute('data-gz-sidebar') === 'none' && await page.evaluate(() => { const grid = document.querySelector('.course-main-container'), thread = document.querySelector('.thread'); return Math.abs(thread.getBoundingClientRect().width - grid.clientWidth + parseFloat(getComputedStyle(grid).paddingRight)) < 1; }), `${tag}: hidden empty sidebar leaves no column reservation`);
      await page.evaluate(() => GZ_SIDEBAR_UI.sync(false));
      check(await page.evaluate(() => !document.documentElement.hasAttribute('data-gz-sb-native-root') && !document.documentElement.style.getPropertyValue('--gz-sb-native-top') && getComputedStyle(document.querySelector('.layer-details')).position !== 'sticky'), `${tag}: disabling restores the native grid and clears geometry variables`);
    }
    await setup('float', 'clear');
    await page.evaluate(() => {
      const root = document.getElementById('full-discussions'); root.style.cssText = 'height:690px;overflow:auto';
      GZ_SIDEBAR_UI.sync(true);
    });
    await page.waitForTimeout(180);
    await page.evaluate(() => { const root = document.getElementById('full-discussions'); root.scrollTop = 2200; });
    await page.waitForTimeout(180);
    await page.evaluate(() => { nativeHost.scrollTop = nativeHost.scrollHeight; });
    await page.waitForTimeout(180);
    await mounted('explicit IO root is also the scroll container');
    check(await page.evaluate(() => nativeTargets[23].textContent === 'Participant 24' && nativeButtons[23].getBoundingClientRect().bottom <= document.getElementById('full-discussions').getBoundingClientRect().bottom + 1), 'root scroll events update sidebar height and keep the last participant reachable');
    await shot('root-is-scroller');
    await page.evaluate(() => GZ_SIDEBAR_UI.sync(false));
  } finally {
    await browser?.close();
    console.log(`${checks - fails}/${checks} checks passed`);
    process.exitCode = fails ? 1 : 0;
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
