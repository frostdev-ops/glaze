// Settings IA regressions against the unpacked extension. External requests are blocked; no school or user profile.
// NODE_PATH=<playwright> nice -n 15 node scripts/settings-ia-check.js
// IA_CASE selects one regression; EXT selects the checkout under test.
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const env = require('./check-env.js'), lock = require('./check-env.js').lockPath();
const chromeLaunch = require('./check-env.js').chromeLaunch();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (page, predicate) => {
  for (const end = Date.now() + 5000; !await page.evaluate(predicate);) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${predicate}`);
    await pause(25);
  }
};
const painted = (page) => page.evaluate(async () => {
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
const layoutState = ({ remember, route, focused = false } = {}) => {
  const face = (el) => el.matches('.seg input, .switch input') ? el.closest('label') : el;
  const visible = (el) => el.checkVisibility({ visibilityProperty: true }) && face(el).checkVisibility({ visibilityProperty: true, opacityProperty: true });
  const controls = focused ? [] : [...document.querySelectorAll(':is(.top, .layout) :is(input, select, textarea, button, a[href], summary)')]
    .filter((el) => !el.closest('.editor-nav') && visible(el));
  if (remember) (window.layoutWant ??= new Map()).set(remember, controls);
  const active = document.activeElement;
  const wanted = focused ? (active && active !== document.body ? [active] : []) : [...new Set([...controls, ...window.layoutWant?.get(route) || []])];
  const off = [];
  for (const el of wanted) {
    const name = el.dataset.key || el.id || el.name || el.textContent.trim().slice(0, 30) || el.tagName;
    const box = face(el), r = box.getBoundingClientRect();
    if (!visible(el)) { off.push(`${name} is hidden`); continue; }
    if (!r.width || !r.height) { off.push(`${name} has zero size`); continue; }
    if (r.left < -1 || r.right > innerWidth + 1) off.push(`${name} ${Math.round(r.left)}..${Math.round(r.right)} is outside the viewport`);
    for (let parent = box.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowX === 'visible') continue;
      const b = parent.getBoundingClientRect(), left = b.left + parent.clientLeft;
      if (r.left < left - 1 || r.right > left + parent.clientWidth + 1) {
        off.push(`${name} is clipped by ${parent.id || parent.className || parent.tagName}`); break;
      }
    }
  }
  return { scroll: document.documentElement.scrollWidth, off, active: window.tabWant?.get(active), body: !active || active === document.body };
};
let context, scratch, held = false, total = 0, failed = 0;
const check = async (name, test) => {
  if (process.env.IA_CASE && process.env.IA_CASE !== name) return;
  total++;
  try { await test(); console.log(`ok ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
};
(async () => {
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; }
      catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nsettings-ia-check\n`);
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-settings-ia-check-'));
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...chromeLaunch, headless: true, viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--disable-background-networking'],
    });
    env.noFirstRun(context);
    await context.route('**/*', (r) => new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort());
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const open = async (hash = 'look/palette') => {
      await page.goto(`${base}/options.html#${hash}`);
      await page.waitForFunction(() => document.querySelector('#looks button'));
    };

    await check('escape', async () => {
      const host = await context.newPage();
      try {
        await host.goto(`${base}/popup.html`);
        await host.evaluate(() => {
          document.body.replaceChildren();
          const f = document.createElement('iframe');
          f.src = 'options.html#study/todo'; f.style = 'width:100%;height:800px'; document.body.append(f);
          window.closedSettings = 0;
          addEventListener('message', (e) => { if (e.data?.gzSettings === 'close') closedSettings++; });
        });
        await host.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('#looks button'));
        const frame = host.frames().find((f) => f.url().includes('options.html'));
        // The worker correctly refuses a frame without a navigation ticket. Reveal only its UI to exercise local keys.
        await frame.evaluate(() => document.documentElement.setAttribute('data-embed-ok', ''));
        const button = frame.locator('#todo button.info').first();
        await button.click(); await frame.locator('.info-pop:popover-open.placed').waitFor();
        await host.keyboard.press('Escape');
        await pause(80);
        assert.equal(await host.evaluate(() => closedSettings), 0, 'Escape must leave Settings open');
        assert.equal(await frame.locator(':popover-open').count(), 0, 'Escape closes the description');
        assert.equal(await button.evaluate((b) => document.activeElement === b), true, 'focus returns to the question button');
        await host.keyboard.press('Escape');
        await host.waitForFunction(() => closedSettings === 1);
        for (const panel of ['sharing', 'mods', 'backup']) {
          assert.equal(await frame.locator(`[data-editor-panel="${panel}"]`).getAttribute('data-gated'), '');
        }
      } finally { await host.close(); }
    });
    await check('search-site-navigation', async () => {
      await open('navigation/bar');
      const toggle = page.locator('[data-key="navbar.on"]');
      if (await toggle.isChecked()) await toggle.uncheck();
      assert.equal(await page.locator('#bb-navigation').evaluate((e) => e.open), false);
      for (const [query, key] of [['Logo size', 'nav.logoSize'], ['Expand on hover', 'nav.expandOnHover']]) {
        await page.fill('#find', query);
        assert.equal(await page.locator(`[data-key="${key}"]`).isVisible(), true, `${query} reveals its control`);
        assert.equal(await page.locator('[data-key="nav.width"]').isVisible(), false, 'unrelated controls are filtered');
        assert.equal(await page.locator('#find-status').textContent(), '1 setting');
      }
      await page.fill('#find', '');
      assert.equal(await page.locator('#bb-navigation').evaluate((e) => e.open), false, 'clearing search restores More options');
    });
    await check('announcement-settings', async () => {
      await open('pages/announcements');
      if (await page.locator('#editor-all').isChecked()) await page.locator('#editor-all').uncheck();
      for (const key of ['announce.open', 'announce.preview']) assert.equal(await page.locator(`[data-key="${key}"]`).isVisible(), true, `${key} is an everyday setting`);
      assert.equal(await page.locator('[data-editor-section="pages/popups"]').evaluate((s) => s.hasAttribute('data-folded')), true, 'Pop-ups is under All settings');
      for (const [query, key] of [['Pop-up animation', 'popup.anim'], ['Preview delay', 'announce.delay'], ['Open announcements from', 'announce.glaze']]) {
        await page.fill('#find', query);
        assert.equal(await page.locator(`[data-key="${key}"]`).isVisible(), true, `${query} reveals its control`);
      }
      await page.fill('#find', '');
      await page.locator('#editor-all').check();
      await page.selectOption('[data-key="popup.anim"]', 'fade');
      await waitFor(page, async () => (await chrome.storage.sync.get('popup')).popup?.anim === 'fade');
      await page.locator('[data-reset-section="pages/popups"]').click();
      await waitFor(page, async () => ((await chrome.storage.sync.get('popup')).popup?.anim ?? 'genie') === 'genie');
      assert.equal(await page.locator('[data-key="popup.anim"]').inputValue(), 'genie', 'Reset section puts the animation back');
      await page.locator('#editor-all').uncheck();
    });
    await check('rubric-settings', async () => {
      await open('pages/documents');
      await page.evaluate(async () => {
        const s = GZ_SANITIZE();
        await chrome.storage.sync.set({ rubric: s.rubric });
      });
      await open('pages/documents');
      if (await page.locator('#editor-all').isChecked()) await page.locator('#editor-all').uncheck();
      const mode = page.locator('[data-key="rubric.show"]'), inline = page.locator('[data-key="rubric.inline"]');
      assert.equal(await mode.isVisible(), true, 'Rubrics is an everyday setting');
      assert.equal(await mode.inputValue(), 'auto');
      assert.equal(await inline.isVisible(), false, 'inline waits for All settings');
      await page.fill('#find', "Show inline when there's room");
      assert.equal(await inline.isVisible(), true, 'search finds the inline preference');
      assert.equal(await inline.isChecked(), true);
      await page.fill('#find', '');
      assert.equal(await inline.isVisible(), false, 'clearing search restores everyday controls');
      await page.locator('#editor-all').check();
      assert.equal(await inline.isVisible(), true);
      await mode.selectOption('site');
      await inline.uncheck();
      await waitFor(page, async () => {
        const { rubric } = await chrome.storage.sync.get('rubric');
        return rubric?.show === 'site' && rubric?.inline === false;
      });
      await open('pages/documents');
      assert.equal(await mode.inputValue(), 'site', 'the selected mode survives a reload');
      assert.equal(await inline.isChecked(), false, 'the inline preference survives a reload');
      await page.locator('[data-reset-section="pages/documents"]').click();
      await waitFor(page, async () => {
        const { rubric } = await chrome.storage.sync.get('rubric');
        return rubric?.show === 'auto' && rubric?.inline === false;
      });
      assert.equal(await mode.inputValue(), 'auto', 'Reset section restores Automatic');
      assert.equal(await inline.isChecked(), false, 'Documents reset preserves the Pop-ups preference');
      await page.locator('[data-reset-section="pages/popups"]').click();
      await waitFor(page, async () => (await chrome.storage.sync.get('rubric')).rubric?.inline === true);
      assert.equal(await inline.isChecked(), true, 'Pop-ups reset restores inline');
      await page.locator('#editor-all').uncheck();
    });
    await check('legacy-section-hashes', async () => {
      const host = await context.newPage();
      try {
        await host.goto(`${base}/popup.html`);
        await host.evaluate(() => {
          document.body.replaceChildren();
          const frame = document.createElement('iframe');
          frame.src = 'options.html'; frame.style = 'width:100%;height:800px'; document.body.append(frame);
        });
        await host.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('#looks button'));
        const frame = host.frames().find((f) => f.url().includes('options.html'));
        await frame.evaluate(() => document.documentElement.setAttribute('data-embed-ok', ''));
        for (const [hash, route] of Object.entries({ 'bb-folders': 'pages/declutter', 'canvas-quizzes': 'pages/documents', 'canvas-shared': 'pages/content', 'moodle-courses': 'look/palette' })) {
          await open(hash);
          const inView = (r) => {
            const section = document.querySelector(`[data-editor-section="${r}"]`), rect = section.getBoundingClientRect();
            return editor.route() === r && rect.top < innerHeight && rect.bottom > 0;
          };
          await page.waitForFunction(inView, route);
          await host.evaluate((hash) => document.querySelector('iframe').contentWindow.postMessage({ gzSettings: 'go', hash: `#${hash}` }, location.origin), hash);
          await frame.waitForFunction(inView, route);
        }
      } finally { await host.close(); }
    });
    await check('side-list-accessibility', async () => {
      await open('look/palette');
      assert.equal(await page.locator('[data-editor-jump][href="#look/palette"]').getAttribute('aria-current'), 'location', 'the current section has a valid ARIA token');
    });
    await check('category-selection', async () => {
      await open('navigation/bar');
      await page.locator('[data-editor-tab="study"]').hover();
      assert.deepEqual(await page.locator('[data-editor-tab][aria-selected="true"]').evaluateAll((els) => els.map((el) => el.dataset.editorTab)), ['navigation']);
      const paints = await page.locator('[data-editor-tab="navigation"], [data-editor-tab="study"]').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
      assert.notEqual(paints[0], paints[1], 'hover and selection have different fills');
      await page.mouse.move(0, 0);
    });
    await check('automatic-tabs', async () => {
      await open('navigation/tabs');
      await page.evaluate(async () => {
        const s = GZ_SANITIZE();
        await chrome.storage.sync.set({ tabs: s.tabs, enhance: s.enhance, navbar: { ...s.navbar, on: false } });
      });
      await open('navigation/tabs');
      const automatic = page.locator('[name="tabs.at"][value="auto"]'), note = page.locator('[data-tabs-nav-note]');
      const reset = page.locator('[data-reset-section="navigation/tabs"]');
      assert.equal(await automatic.isChecked(), true, 'Automatic is selected for fresh settings');
      assert.equal(await reset.isVisible(), false, 'default tabs need no reset');
      assert.equal(await note.isVisible(), false, 'Automatic needs no navigation warning');
      await page.locator('label:has([name="tabs.at"][value="nav"])').click();
      assert.equal(await note.isVisible(), true, 'Only in the navigation warns immediately with navigation off');
      assert.equal(await reset.isVisible(), true);
      await automatic.locator('..').click();
      assert.equal(await note.isVisible(), false, 'Automatic clears the warning immediately');
      await waitFor(page, async () => (await chrome.storage.sync.get('tabs')).tabs?.at === 'auto');
      assert.equal(await reset.isVisible(), false);
      await page.locator('label:has([name="tabs.at"][value="below"])').click();
      await reset.click();
      assert.equal(await automatic.isChecked(), true, 'Reset restores Automatic');
      await page.fill('#find', 'Automatic');
      assert.equal(await automatic.locator('..').isVisible(), true, 'search finds Automatic');
      await page.fill('#find', '');
      await open('navigation/tabs');
      assert.equal(await automatic.isChecked(), true, 'Automatic survives a reload');
    });
    await check('setting-badges', async () => {
      const gaps = [];
      for (const [route, key] of [['pages/documents', 'enhance.quizLight'], ['courses/cards', 'card.create'], ['study/todo', 'todo.teacher'], ['study/todo', 'todo.progress']]) {
        await open(route);
        await page.locator('#editor-all').check();
        const gap = await page.locator(`[data-key="${key}"]`).evaluate((input) => {
          const label = input.closest('label'), title = label.querySelector('span:not(.desc)'), badge = label.closest('.has-badge').querySelector('.site-badge');
          const range = document.createRange(); range.selectNodeContents(title.firstChild);
          return badge.getBoundingClientRect().left - range.getBoundingClientRect().right;
        });
        if (gap < 0 || gap > 16) gaps.push(`${key}: ${gap}px`);
      }
      assert.deepEqual(gaps, [], 'badges follow their setting names');
    });
    await check('translated-layout', async () => {
      for (const lang of ['de', 'fr']) for (const embedded of [false, true]) {
        const host = await context.newPage();
        try {
          await host.setViewportSize({ width: 390, height: 844 });
          await host.addInitScript((language) => { chrome.i18n.getUILanguage = () => language; }, lang);
          let editor = host;
          if (embedded) {
            await host.goto(`${base}/popup.html`);
            await host.evaluate(() => {
              document.body.replaceChildren(); document.body.style.cssText = 'margin:0;max-width:none;padding:0';
              const f = document.createElement('iframe'); f.src = 'options.html#navigation/tabs';
              f.style = 'display:block;width:100%;height:100vh;border:0'; document.body.append(f);
            });
            await host.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('#looks button'));
            editor = host.frames().find((f) => f.url().includes('options.html'));
            await editor.evaluate(() => document.documentElement.setAttribute('data-embed-ok', ''));
          } else {
            await host.goto(`${base}/options.html#navigation/tabs`);
            await host.waitForFunction(() => document.querySelector('#looks button'));
          }
          assert.equal(await editor.locator('html').getAttribute('lang'), lang, 'the requested catalogue is rendered');
          await editor.locator('#editor-all').check();
          for (const dir of ['ltr', 'rtl']) {
            await editor.evaluate((direction) => { document.documentElement.dir = direction; }, dir);
            for (const route of ['look/type', 'navigation/bar', 'navigation/tabs', 'navigation/sidebar', 'study/todo', 'pages/documents', 'pages/popups']) {
              await editor.evaluate((hash) => { location.hash = hash; }, route);
              await editor.waitForFunction((r) => editor.route() === r, route);
              const tag = `${lang} ${embedded ? 'embedded' : 'standalone'} ${dir} ${route}`;
              const overflow = await editor.evaluate(() => {
                const width = document.documentElement.clientWidth;
                return [...document.querySelectorAll('section:not([hidden]) :is(.field, .has-info, .has-badge, .section-heading, .seg)')].filter((el) => el.getClientRects().length).map((el) => [el, el.getBoundingClientRect()]).filter(([, r]) => r.left < -1 || r.right > width + 1).map(([el]) => el.className);
              });
              assert.deepEqual(overflow, [], `${tag}: controls fit the frame`);
              const buttons = editor.locator('section button.info:visible');
              for (let i = 0; i < await buttons.count(); i++) {
                const button = buttons.nth(i);
                await button.click();
                const pop = editor.locator('.info-pop:popover-open.placed');
                await pop.waitFor();
                const fits = await pop.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1 && el.scrollWidth <= el.clientWidth + 1; });
                assert.equal(fits, true, `${tag}: ${await button.getAttribute('popovertarget')} fits`);
                await editor.evaluate(() => document.querySelector(':popover-open')?.hidePopover());
              }
              if (process.env.IA_OUT && ['navigation/tabs', 'pages/documents'].includes(route)) {
                fs.mkdirSync(process.env.IA_OUT, { recursive: true });
                await editor.locator(`[data-editor-section="${route}"]`).evaluate((el) => el.scrollIntoView());
                await host.screenshot({ path: path.join(process.env.IA_OUT, `${lang}-${embedded ? 'embedded' : 'standalone'}-${dir}-${route.replace('/', '-')}.png`) });
              }
            }
          }
        } finally { await host.close(); }
      }
    });
    await check('rtl-tabs', async () => {
      await open('look/palette');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
      const nav = page.locator('[data-editor-tab="navigation"]');
      await nav.click(); await nav.focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.editorTab), 'look', 'Right follows the RTL visual order');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.editorTab), 'navigation');
      await page.keyboard.press('End');
      const rect = await page.locator('[data-editor-tab="about"]').boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= 390, 'the selected RTL category scrolls into view');
      await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await check('layout-guards', async () => {
      await open('study/todo');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(layoutState, { remember: 'study/todo' });
      await page.setViewportSize({ width: 320, height: 900 });
      const missed = [];
      for (const [name, css] of [
        ['hidden control', '[data-key="todo.done"]{display:none!important}'],
        ['invisible control', '[data-key="todo.done"]{visibility:hidden!important}'],
        ['zero-size control', '[data-key="todo.done"]{width:0!important;height:0!important;padding:0!important;border:0!important}'],
        ['ancestor clipping', '#todo .row:has([data-key="todo.done"]){width:220px;overflow:hidden} [data-key="todo.done"]{min-width:250px}'],
        ['preview clipping', '.preview-controls{width:210px;overflow:hidden} #preview-site{min-width:250px}'],
      ]) {
        const style = await page.addStyleTag({ content: css });
        try {
          const m = await page.evaluate(layoutState, { route: 'study/todo' });
          const target = name === 'preview clipping' ? 'preview-site ' : 'todo.done ';
          if (!m.off.some((issue) => issue.startsWith(target))) missed.push(name);
        } finally { await style.evaluate((el) => el.remove()); }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert.deepEqual(missed, [], 'layout checks reject hidden, zero-size and clipped controls');
    });
    // All routes at 320px, including translated, RTL and larger text. Wide controls must remain visible and usable.
    await check('narrow-320', async () => {
      const problems = [];
      for (const variant of [{ name: 'en' }, { name: 'de', lang: 'de' }, { name: 'rtl', dir: 'rtl' }, { name: 'larger', scale: 1.25, root: '20px' }]) {
        for (const all of [false, true]) {
          const host = await context.newPage();
          try {
            await host.setViewportSize({ width: 320, height: 900 });
            if (variant.lang) await host.addInitScript((language) => { chrome.i18n.getUILanguage = () => language; }, variant.lang);
            await host.goto(`${base}/options.html#look/palette`);
            await host.waitForFunction(() => document.querySelector('#looks button'));
            await host.evaluate(async () => chrome.storage.sync.set(GZ_SANITIZE()));
            await host.reload();
            await host.waitForFunction(() => document.querySelector('#looks button'));
            if (variant.scale) {
              await host.evaluate(async (scale) => { const s = GZ_SANITIZE(); await chrome.storage.sync.set({ look: { ...s.look, scale } }); }, variant.scale);
              await host.waitForFunction((scale) => document.documentElement.style.getPropertyValue('--gz-scale') === String(scale), variant.scale);
            }
            await host.locator('#editor-all').setChecked(all);
            await host.evaluate(({ dir, root }) => {
              if (dir) document.documentElement.dir = dir;
              if (root) document.documentElement.style.fontSize = root;
            }, variant);
            assert.equal(await host.locator('[data-key="navbar.on"]').isChecked(), true, 'narrow layout includes the default navigation controls after earlier checks');
            const routes = await host.evaluate(() => [...document.querySelectorAll('[data-editor-section]')].map((s) => s.dataset.editorSection));
            const expectedRoutes = [...fs.readFileSync(path.join(root, 'options.html'), 'utf8').matchAll(/data-editor-section="([^"]+)"/g)].map((m) => m[1]);
            assert.deepEqual(routes, expectedRoutes, 'every settings route is swept');
            const panels = new Set();
            for (const route of routes) {
              await host.evaluate((hash) => { location.hash = hash; }, route);
              await host.waitForFunction((r) => editor.route() === r, route);
              const tag = `${variant.name} ${all ? 'all' : 'default'} ${route}`;
              await host.setViewportSize({ width: 1440, height: 1000 });
              await host.evaluate(layoutState, { remember: route });
              await host.setViewportSize({ width: 320, height: 900 });
              await painted(host);
              const m = await host.evaluate(layoutState, { route });
              if (m.scroll > 320) problems.push(`${tag}: page is ${m.scroll}px wide`);
              for (const off of m.off) problems.push(`${tag}: ${off}`);
              const panel = await host.evaluate(() => document.querySelector('[data-editor-panel]:not([hidden])').dataset.editorPanel);
              if (panels.has(panel)) continue;
              panels.add(panel);
              // Include the header and preview as well as the panel; a radio group is one stop.
              await host.evaluate(() => {
                window.tabWant = new Map();
                for (const el of document.querySelectorAll(':is(.top, .layout) :is(input, select, textarea, button, a[href], summary)')) {
                  if (el.disabled || el.tabIndex < 0 || el.closest('[inert], .editor-nav') || !el.checkVisibility({ visibilityProperty: true })) continue;
                  const group = el.type === 'radio' && [...tabWant.entries()].find(([o]) => o.type === 'radio' && o.name === el.name);
                  tabWant.set(el, group ? group[1] : `${tabWant.size} ${el.dataset.key || el.name || el.id || el.textContent.trim().slice(0, 30) || el.outerHTML.slice(0, 60)}`);
                }
                document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); scrollTo(0, 0);
              });
              const reached = new Set();
              let first;
              for (let i = 0; i < 2000; i++) {
                await host.keyboard.press('Tab');
                const at = await host.evaluate(layoutState, { focused: true });
                if (at.body) break;
                for (const off of at.off) problems.push(`${tag}: focused ${off}`);
                if (at.active === undefined) continue;
                if (at.active === first) break;
                first ??= at.active;
                reached.add(at.active);
              }
              const want = await host.evaluate(() => [...new Set(tabWant.values())]);
              for (const key of want) if (!reached.has(key)) problems.push(`${tag}: ${key} cannot be reached with Tab`);
            }
          } finally {
            if (variant.scale) await host.evaluate(async () => { const s = GZ_SANITIZE(), { look } = await chrome.storage.sync.get('look'); await chrome.storage.sync.set({ look: { ...look, scale: s.look.scale } }); }).catch(() => {});
            await host.close();
          }
        }
      }
      assert.deepEqual([...new Set(problems)], [], 'settings fit a 320px viewport');
    });
    await check('translated-heading-wrap', async () => {
      const host = await context.newPage();
      try {
        await host.setViewportSize({ width: 320, height: 1000 });
        await host.addInitScript(() => { chrome.i18n.getUILanguage = () => 'de'; });
        await host.goto(`${base}/options.html#navigation/items`);
        await host.waitForFunction(() => document.querySelector('#looks button'));
        await host.evaluate(() => {
          // A wide user-selected face also reproduces Linux's longer system-font metrics on macOS.
          document.documentElement.style.fontSize = '20px';
          document.querySelector('#heading-navigation-items').style.fontFamily = 'monospace';
          document.querySelector('#heading-navigation-items').style.fontSize = '25px';
        });
        assert.equal(await host.locator('#heading-navigation-items').textContent(), 'Navigationseinträge');
        for (const direction of ['ltr', 'rtl']) {
          await host.evaluate((dir) => { document.documentElement.dir = dir; }, direction);
          assert.ok(await host.evaluate(() => {
            const h = document.querySelector('#heading-navigation-items'), b = h.getBoundingClientRect();
            const r = document.createRange(); r.selectNodeContents(h);
            return document.documentElement.scrollWidth <= 320 && b.left >= 0 && b.right <= 320
              && [...r.getClientRects()].every((line) => line.left >= b.left - 1 && line.right <= b.right + 1);
          }), `${direction}: translated heading wraps within the viewport without clipping`);
        }
      } finally { await host.close(); }
    });
    await check('translated-large-layout', async () => {
      const problems = [];
      for (const lang of ['en', 'de', 'fr', 'es', 'nl', 'pt-BR']) {
        const host = await context.newPage();
        try {
          await host.addInitScript((language) => { chrome.i18n.getUILanguage = () => language; }, lang);
          await host.goto(`${base}/options.html#look/palette`);
          await host.waitForFunction(() => document.querySelector('#looks button'));
          await host.evaluate(async () => {
            const s = GZ_SANITIZE();
            await chrome.storage.sync.set({ ...s, colors: GZ_PRESET('Paper'), preset: 'Paper', look: { ...s.look, scale: 1.25 } });
            await chrome.storage.local.set({ lookHistory: [{ theme: GZ_HISTORY.theme(s), at: 1 }] });
            document.documentElement.style.fontSize = '20px';
          });
          await host.waitForFunction(() => document.documentElement.style.getPropertyValue('--gz-scale') === '1.25' && document.querySelector('#history li'));
          assert.equal(await host.locator('html').getAttribute('lang'), lang);
          for (const all of [false, true]) {
            await host.locator('#editor-all').setChecked(all);
            for (const dir of ['ltr', 'rtl']) {
              await host.evaluate((direction) => { document.documentElement.dir = direction; }, dir);
              for (const route of ['look/palette', 'look/extras', 'navigation/bar', 'study/todo', 'pages/documents']) {
                await host.evaluate((r) => editor.show(r), route);
                for (const width of [1440, 390, 320]) {
                  await host.setViewportSize({ width, height: 1000 });
                  await painted(host);
                  const m = await host.evaluate(layoutState, width === 1440 ? { remember: route } : { route });
                  const tag = `${lang} ${all ? 'all' : 'default'} ${dir} ${width} ${route}`;
                  if (m.scroll > width) problems.push(`${tag}: page is ${m.scroll}px wide`);
                  for (const off of m.off) problems.push(`${tag}: ${off}`);
                }
              }
            }
          }
        } finally { await host.close(); }
      }
      assert.deepEqual([...new Set(problems)], [], 'translated larger text and saved Looks fit without clipping');
    });
    await check('glass-parity', async () => {
      await open();
      await page.evaluate(async () => {
        const s = GZ_SANITIZE();
        await chrome.storage.sync.set({ look: { ...s.look, glass: 18 }, bg: { ...s.bg, kind: 'gradient' } });
      });
      await open();
      for (const selector of ['#palette', '.editor-nav', '.preview']) {
        assert.match(await page.locator(selector).evaluate((e) => getComputedStyle(e).backdropFilter), /blur\(15px\)/, `${selector} keeps the Look's glass`);
      }
      await page.evaluate(async () => { const { bg } = await chrome.storage.sync.get('bg'); await chrome.storage.sync.set({ bg: { ...bg, kind: 'solid' } }); });
      await open();
      assert.equal(await page.locator('#palette').evaluate((e) => getComputedStyle(e).backdropFilter), 'none', 'no invisible blur over solid colors');
    });
    await check('popover-scroll', async () => {
      await open('study/todo');
      await page.locator('#todo button.info').first().click();
      await page.locator('.info-pop:popover-open.placed').waitFor();
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForFunction(() => !document.querySelector(':popover-open'));
      assert.equal(await page.locator(':popover-open').count(), 0, 'a description dismisses when its button scrolls out of view');
    });
  } finally {
    await context?.close();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} settings IA browser checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
