// The setup wizard's Navigation step (settings/welcome.html#/nav, settings/setup-nav.js) in headless Chrome with the real
// unpacked extension: every choice (the switch, side or top, the rail's labels, the style, Glaze's own items, by click and by
// arrow key) read back from storage.sync as the worker saved it, the preview following each, and the done step's row.
// Screenshots wide and narrow, in a dark and a light theme, and with motion off, go to the evidence directory.
// NODE_PATH=<installed playwright> node checks/settings/setup-nav-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = require('../../tools/dev/check-env.js').staged(process.env.EXT || path.join(__dirname, '../../extension'), []);
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-setup-nav-'));
const out = process.argv[2] || path.join(tmp, 'shots');
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };

(async () => {
  let ctx;
  try {
    await require('../../tools/dev/wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    await ctx.route('**/*', (route) => (new URL(route.request().url()).protocol === 'chrome-extension:' ? route.continue() : route.abort()));
    const url = `chrome-extension://${id}/settings/welcome.html`;
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => false); if (v || Date.now() > end) return v; await pause(100); } };
    const open = async (viewport, motion = 'no-preference', hash = '#/nav') => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto(url + hash);
      await until(() => page.evaluate(() => !!document.querySelector('.nv-power[aria-checked]') && !!document.documentElement.dataset.tone));
      return page;
    };
    const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
    const synced = (page, keys) => page.evaluate((k) => chrome.storage.sync.get(k), keys);
    const navbar = async (page) => (await synced(page, 'navbar')).navbar || {};
    const items = async (page) => JSON.stringify((await synced(page, 'navbarItems')).navbarItems?.glaze);
    // What the step shows: its choices, and the preview's bar as a share of the page it sits on.
    const view = (page) => page.evaluate(() => {
      const $ = (q) => document.querySelector(q), $$ = (q) => [...document.querySelectorAll(q)];
      const p = $('.nv-preview'), stage = $('.nv-stage').getBoundingClientRect(), bar = $('.nv-bar').getBoundingClientRect();
      const checked = (q) => $$(q).filter((e) => e.getAttribute('aria-checked') === 'true').map((e) => e.dataset.value).join();
      const shown = $$('.nv-bar .nv-items > .nv-item:not(.nv-ghost), .nv-bar .nv-foot .nv-item').filter((e) => !e.hidden);
      const inside = shown.every((e) => { const r = e.getBoundingClientRect(); return r.right <= bar.right + 0.5 && r.bottom <= bar.bottom + 0.5 && r.left >= bar.left - 0.5 && r.top >= bar.top - 0.5; });
      const label = $('.nv-items .nv-item .nv-label');
      return {
        data: { ...p.dataset }, power: $('.nv-power').getAttribute('aria-checked'), place: checked('.nv-place'), rail: checked('.nv-seg[data-key="rail"] .nv-opt'), style: checked('.nv-seg[data-key="style"] .nv-opt'),
        chips: $$('.nv-chip[aria-pressed="true"]').map((b) => b.dataset.id).join(), inert: $('.nv-choices').inert, fold: getComputedStyle($('.nv-fold')).visibility,
        own: $$('.nv-own:not(.nv-ghost)').filter((e) => !e.hidden).map((e) => e.dataset.id).join(),
        bar: { x: Math.round(bar.left - stage.left), y: Math.round(bar.top - stage.top), w: bar.width / stage.width, h: bar.height / stage.height, opacity: Number(getComputedStyle($('.nv-bar')).opacity) },
        inside, labels: Number(getComputedStyle(label).opacity), moving: $('.nv-win').getAnimations().length, focus: document.activeElement?.dataset?.value || document.activeElement?.className || '',
        // The step stays inside the page's column (the page's own width is the header's: noted below).
        fits: $('.nv').getBoundingClientRect().right <= $('main').getBoundingClientRect().right + 0.5 && $('.nv').scrollWidth <= $('.nv').clientWidth,
        wider: document.documentElement.scrollWidth - innerWidth,
      };
    });
    // The preview has stopped moving: no transition or one-off animation left in it, and the bar's box the same twice in a row.
    const settled = (page) => page.evaluate(() => !document.getAnimations().some((a) => a.playState !== 'finished' && a.effect?.getTiming().iterations !== Infinity));
    const steady = async (page) => { let last = ''; return until(async () => { const v = JSON.stringify((await view(page)).bar); const same = v === last && await settled(page); last = v; return same; }, 6000); };
    const theme = async (page, name, tone) => {
      await page.evaluate(() => { location.hash = '#/theme'; });
      await page.click(`.look[data-look="${name}"]`);
      check(await until(() => page.evaluate((t) => document.documentElement.dataset.tone === t, tone)), `${name} worn (${tone})`);
      await until(async () => (await synced(page, 'colors')).colors?.['--gz-surface'] === await page.evaluate(() => document.documentElement.style.getPropertyValue('--gz-surface').trim()));
      await page.evaluate(() => { location.hash = '#/nav'; });
      await until(() => page.evaluate(() => !document.querySelector('#nav').hidden));
      await pause(900);
    };

    // ---- wide, dark (Glaze's own theme on a fresh install) ----
    {
      const page = await open({ width: 1440, height: 900 });
      let v = await view(page);
      check(v.power === 'true' && v.place === 'rail' && v.rail === 'auto' && v.style === 'float', `a fresh install: the bar on, a side rail, Auto, floating (${v.place} ${v.rail} ${v.style})`);
      check(v.chips === 'settings' && v.own === 'settings', 'a fresh install has Glaze settings in the bar, and the preview shows it');
      check(v.data.on === 'true' && v.data.place === 'rail' && v.moving > 0, 'Auto: the preview\'s window shows labels and icons in turn');
      check(await page.evaluate(() => document.documentElement.dataset.tone) === 'dark', 'the page is dark');
      await pause(700);
      await shot(page, 'wide-dark-side-auto');

      await page.click('.nv-place[data-value="top"]');
      check(await until(async () => (await navbar(page)).place === 'top'), 'Top bar picked is saved');
      await steady(page);
      v = await view(page);
      check(v.place === 'top' && v.data.place === 'top' && v.bar.w > 0.9 && v.bar.h < 0.2, `the preview's bar runs across the top (${v.bar.w.toFixed(2)} × ${v.bar.h.toFixed(2)})`);
      check(v.fold === 'hidden', 'the rail\'s choices fold away with a top bar');
      for (const g of ['notes', 'documents', 'todo', 'search']) await page.click(`.nv-chip[data-id="${g}"]`);
      check(await until(async () => await items(page) === '["notes","documents","todo","search","settings"]'), 'every shortcut picked is saved, in the bar\'s order');
      await steady(page);
      await shot(page, 'wide-dark-top-shortcuts');
      v = await view(page);
      check(v.chips === 'notes,documents,todo,search,settings' && v.own === v.chips, 'the preview\'s bar shows each shortcut');
      check(v.inside, 'every item fits inside the top bar');

      await page.click('.nv-place[data-value="rail"]');
      check(await until(async () => (await navbar(page)).place === 'rail'), 'Side rail picked is saved');
      await page.click('.nv-seg[data-key="rail"] .nv-opt[data-value="open"]');
      check(await until(async () => (await navbar(page)).rail === 'open'), 'Labels picked is saved');
      await steady(page);
      v = await view(page);
      check(v.fold === 'visible' && v.data.rail === 'open' && v.bar.w > 0.2 && v.bar.w < 0.3 && v.labels === 1 && v.moving === 0, `Labels: an open rail with its labels (${v.bar.w.toFixed(2)})`);
      await shot(page, 'wide-dark-side-labels');
      check(v.inside, 'every item fits down the open rail');
      await page.click('.nv-seg[data-key="rail"] .nv-opt[data-value="icons"]');
      check(await until(async () => (await navbar(page)).rail === 'icons'), 'Icons picked is saved');
      await steady(page);
      v = await view(page);
      check(v.bar.w < 0.1 && v.labels === 0 && v.inside, `Icons: a narrow rail, no labels (${v.bar.w.toFixed(2)})`);
      await shot(page, 'wide-dark-side-icons');

      await page.click('.nv-seg[data-key="style"] .nv-opt[data-value="embed"]');
      check(await until(async () => (await navbar(page)).style === 'embed'), 'Embedded picked is saved');
      await steady(page);
      v = await view(page);
      check(v.bar.x === 0 && v.bar.y === 0, 'Embedded: the bar sits in the page\'s edge');
      await shot(page, 'wide-dark-embedded');
      await page.click('.nv-seg[data-key="style"] .nv-opt[data-value="float"]');
      check(await until(async () => (await navbar(page)).style === 'float'), 'Floating picked is saved');
      await steady(page);
      check((await view(page)).bar.x > 4, 'Floating: the bar floats in a gutter');

      await page.click('.nv-chip[data-id="settings"]');
      check(await until(async () => await items(page) === '["notes","documents","todo","search"]'), 'a shortcut turned off is saved');
      await steady(page);
      check((await view(page)).own === 'notes,documents,todo,search', 'and leaves the preview\'s bar');

      // Keyboard: the radio groups move and choose with the arrow keys.
      await page.focus('.nv-place[aria-checked="true"]');
      await page.keyboard.press('ArrowRight');
      check(await until(async () => (await navbar(page)).place === 'top') && (await view(page)).focus === 'top', 'an arrow key moves to Top bar and picks it');
      await page.keyboard.press('ArrowLeft');
      check(await until(async () => (await navbar(page)).place === 'rail'), 'and back to Side rail');
      await page.focus('.nv-seg[data-key="rail"] .nv-opt[aria-checked="true"]');
      await page.keyboard.press('ArrowLeft');
      check(await until(async () => (await navbar(page)).rail === 'open') && (await view(page)).focus === 'open', 'the rail\'s choices move with the arrow keys');
      await page.keyboard.press('Home');
      check(await until(async () => (await navbar(page)).rail === 'auto'), 'Home goes to Auto');
      check(await page.evaluate(() => document.querySelector('.nv-power').getAttribute('role') === 'switch' && document.querySelector('.nv-chips').getAttribute('aria-label') && document.querySelector('.nv-chip').hasAttribute('aria-pressed')), 'the switch is a switch, the shortcuts toggle buttons in a labelled group');

      await page.click('.nv-power');
      check(await until(async () => (await navbar(page)).on === false), 'the bar turned off is saved');
      await steady(page);
      v = await view(page);
      check(v.inert && v.data.on === 'false' && v.bar.opacity < 0.05, 'off: the choices are inert and the preview\'s bar is gone');
      await shot(page, 'wide-dark-off');
      check(await page.evaluate(() => { document.querySelector('.nv-place').click(); return document.querySelector('.nv-place[data-value="rail"]').getAttribute('aria-checked'); }) === 'true', 'off: a click on a choice does nothing');
      await page.click('.nv-power');
      check(await until(async () => (await navbar(page)).on === true), 'and on again');

      await page.evaluate(() => { location.hash = '#/done'; });
      check(await until(async () => (await page.evaluate(() => [...document.querySelectorAll('#summary dd')].map((d) => d.textContent))).includes('Side rail')), 'the done step names the bar');
      await page.evaluate(() => { location.hash = '#/nav'; });
      await until(() => page.evaluate(() => !document.querySelector('#nav').hidden));

      // ---- wide, light ----
      await theme(page, 'Library', 'light');
      await page.click('.nv-seg[data-key="rail"] .nv-opt[data-value="open"]');
      await until(async () => (await navbar(page)).rail === 'open');
      await steady(page);
      await shot(page, 'wide-light-side-labels');
      await page.click('.nv-place[data-value="top"]');
      await until(async () => (await navbar(page)).place === 'top');
      await steady(page);
      check((await view(page)).inside, 'light: every item fits inside the top bar');
      await shot(page, 'wide-light-top');
      await page.close();
    }

    // ---- narrow, light then dark ----
    {
      const page = await open({ width: 390, height: 844 });
      await steady(page);
      await shot(page, 'narrow-light-top');
      let v = await view(page);
      check(v.place === 'top' && v.fits && v.inside, `narrow: the choices kept, the step inside its column, the top bar's items fit${v.fits && v.inside ? '' : ` (${JSON.stringify(v)} ${await page.evaluate(() => [document.querySelector('.nv').scrollWidth, document.querySelector('.nv').clientWidth, ...[...document.querySelectorAll('.nv *')].filter((e) => e.getBoundingClientRect().right > document.querySelector('.nv').getBoundingClientRect().right + 0.5).slice(0, 6).map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().right))].join())})`}`);
      if (v.wider > 0) console.log(`note: the page is ${v.wider}px wider than the window at #/nav (header ${await page.evaluate(() => Math.round(document.querySelector('.top .rail').getBoundingClientRect().width))}px)`);
      await page.click('.nv-place[data-value="rail"]');
      await until(async () => (await navbar(page)).place === 'rail');
      await steady(page);
      v = await view(page);
      check(v.inside && v.fits, 'narrow: the rail\'s items fit');
      await shot(page, 'narrow-light-side');
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
      await pause(300);
      await shot(page, 'narrow-light-side-scrolled');
      await theme(page, 'Frost', 'dark');
      await page.evaluate(() => scrollTo(0, 0));
      await steady(page);
      await shot(page, 'narrow-dark-side');
      await page.click('.nv-place[data-value="top"]');
      await until(async () => (await navbar(page)).place === 'top');
      await steady(page);
      check((await view(page)).inside, 'narrow dark: the top bar\'s items fit');
      await shot(page, 'narrow-dark-top');
      await page.click('.nv-place[data-value="rail"]');
      await page.click('.nv-seg[data-key="rail"] .nv-opt[data-value="auto"]');
      await until(async () => (await navbar(page)).rail === 'auto' && (await navbar(page)).place === 'rail');
      await page.close();
    }

    // ---- motion off: nothing moves, Auto shows what this window would get ----
    {
      const page = await open({ width: 1440, height: 900 }, 'reduce');
      check(await page.evaluate(() => document.documentElement.dataset.gzMotion) === 'off', 'reduced motion: the page\'s motion is off');
      const v = await view(page);
      check(v.data.rail === 'auto' && v.data.wide === 'true' && v.moving === 0 && v.labels === 1 && v.bar.w > 0.2, 'motion off: Auto holds still, open on this wide window');
      await page.click('.nv-place[data-value="top"]');
      await until(async () => (await navbar(page)).place === 'top');
      check(await page.evaluate(() => [...document.querySelectorAll('.nv-bar *, .nv-win')].every((e) => !e.getAnimations().length)), 'motion off: a new choice moves nothing');
      await shot(page, 'wide-motion-off-top');
      await page.click('.nv-place[data-value="rail"]');
      await until(async () => (await navbar(page)).place === 'rail');
      await shot(page, 'wide-motion-off-side');
      await page.setViewportSize({ width: 390, height: 844 });
      await until(() => page.evaluate(() => document.querySelector('.nv-preview').dataset.wide === 'false'));
      const n = await view(page);
      check(n.labels === 0 && n.bar.w < 0.15, 'motion off: Auto on a narrow window shows icons');
      await shot(page, 'narrow-motion-off');
      await page.close();
    }

    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(`${results.length} ok, screenshots in ${out}`);
  } catch (e) {
    console.error(e);
    if (errors.length) console.error('page errors:', errors.join('\n'));
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(path.join(tmp, 'profile'), { recursive: true, force: true });
  }
})();
