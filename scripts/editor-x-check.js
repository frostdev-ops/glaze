// The editor's Look parts builders (lib/editor-x*.js), headless, in the real unpacked extension's options page: a shader
// typed with a mistake (shown at its line, not saved), an example shader saved and drawn in the preview with the guard's
// step said in words, a preset layer stack reordered from the keyboard, ready animations played in the Ultra preview, an
// effect tried and silenced by motion off, a cursor effect, the device-only status, a glaze2 code, and labelled controls.
// No network: every request outside the extension is aborted. Software GL, so this checks wiring, not speed.
//   NODE_PATH=/path/to/node_modules nice -n 10 node scripts/editor-x-check.js [out-dir for screenshots]
// One headless browser at a time across agents: it waits while another runs. The profile is temporary and removed.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');

const ext = fs.realpathSync(path.join(__dirname, '..'));
const out = process.argv[2] && path.resolve(process.argv[2]);
const chromeLaunch = require('./check-env.js').chromeLaunch();
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const AURORA = fs.readFileSync(path.join(ext, 'assets/shaders/aurora.glsl'), 'utf8');
const BG = require(path.join(ext, 'lib/editor-xbg.js'));
const M = require(path.join(ext, 'lib/editor-xmotion.js'));
const XP = require(path.join(ext, 'lib/lookparts.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (!ok) fails++; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80); } return null; };

(async () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-editor-x-')));
  const errors = [];
  let context;
  try {
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...chromeLaunch, headless: true, viewport: { width: 1400, height: 1000 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(15000);
    await context.route('**/*', (r) => (new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort()));
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      globalThis.shaderChecks = [];
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...args) {
        const gl = get.apply(this, args);
        if (args[0] === 'webgl2' && this.id !== 'gz-scene' && gl) shaderChecks.push(gl);
        return gl;
      };
    });
    await page.goto(`chrome-extension://${id}/options.html#look/background`);
    await page.waitForFunction(() => document.getElementById('preview')?.contentDocument?.documentElement.dataset.previewReady === 'true');

    const preview = () => page.frames().find((f) => f.url().includes('preview.html'));
    const stored = () => page.evaluate(async () => (await GZ_XPARTS.read(GZ_XPARTS.areas()))?.x ?? null);
    const shot = async (name) => { if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false }); } };
    const kind = (k) => page.evaluate((k) => document.querySelector(`input[name="bg.kind"][value="${k}"]`).click(), k);
    // The select labelled `label` (its .field's first span) inside `within`, set to value as a person would.
    const pick = (within, label, value) => page.evaluate(({ within, label, value }) => {
      const s = [...document.querySelector(within).querySelectorAll('label')].find((l) => l.firstElementChild?.textContent === label).querySelector('select');
      s.focus(); s.value = value; s.dispatchEvent(new Event('change'));
    }, { within, label, value });
    const press = (text, within = 'body') => page.evaluate(({ text, within }) => [...document.querySelector(within).querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text).click(), { text, within });

    // ---- shader -------------------------------------------------------------------------------------------------------------
    await kind('shader');
    check('Custom shader shows the shader builder and hides the layers', await page.evaluate(() => !document.getElementById('x-shader').hidden && document.getElementById('x-layers').hidden));
    const broken = 'vec4 scene(vec2 uv) {\n  float a = .5;\n  float b = a +;\n  return vec4(uC1, a);\n}';
    await page.fill('#x-shader-code', broken);
    const shown = await until(() => page.evaluate(() => [...document.querySelectorAll('#x-shader .x-errors li')].map((li) => li.textContent).join(' | ')));
    check('a typo is listed at its line, by this device\'s compiler, before anything is saved', /^Line 3/.test(shown || ''), shown);
    check('  the gutter marks line 3 with text, not only colour', await page.evaluate(() => document.querySelector('#x-shader .x-gutter .bad')?.textContent.trim() === '3 !'));
    check('  the problem count is said politely', await page.evaluate(() => { const s = document.getElementById('x-shader-say'); return s.getAttribute('aria-live') === 'polite' && /problem/i.test(s.textContent); }));
    check('  and nothing was saved', !(await stored())?.bg);
    check('driver diagnostics enter the editor as text', await page.evaluate(() => {
      const text = '<img src=x onerror=alert(1)><script>throw 1</script>';
      dispatchEvent(new MessageEvent('message', { origin: location.origin, source: document.getElementById('preview').contentWindow,
        data: { gzSceneFailed: { why: 'compile', errors: [{ line: 3, message: text }] } } }));
      return document.querySelector('#x-shader .x-errors').textContent.includes(text) && !document.querySelector('#x-shader .x-errors img, #x-shader .x-errors script');
    }));
    await page.evaluate(() => [...document.querySelectorAll('#x-shader .x-errors button')][0].click());
    check('  Line 3 moves the caret to that line', await page.evaluate(() => { const c = document.getElementById('x-shader-code'); return document.activeElement === c && c.selectionStart === c.value.indexOf('  float b'); }));
    page.once('dialog', (d) => d.accept());
    await press('Aurora ribbons', '#x-shader');
    const saved = await until(async () => (await stored())?.bg?.shader?.src);
    check('an example replaces it, passes, and is saved as the Look\'s shader', saved === AURORA, String(saved).slice(0, 40));
    check('  the problems are gone', await page.evaluate(() => !document.querySelector('#x-shader .x-errors li') && !document.querySelector('#x-shader .x-gutter .bad')));
    const said = await until(() => page.evaluate(() => [...document.querySelectorAll('#x-shader [role="status"]')].map((p) => p.textContent).find((t) => /device/.test(t))), 15000);
    check('the preview draws it and the guard\'s step is said in words', !!said, said);
    check('  with a canvas in the preview', await until(() => preview().evaluate(() => !!document.getElementById('gz-scene'))));
    console.log(`     (${said})`);
    await shot('shader');

    // ---- layers -------------------------------------------------------------------------------------------------------------
    await kind('layers');
    await page.selectOption('#x-layers select[aria-label="Start from a preset stack"]', '0');
    let layers = await until(async () => (await stored())?.bg?.layers);
    check('a preset stack is saved as it is (shader kept)', XP.same(layers, BG.PRESETS[0][1]) && (await stored()).bg.shader?.src === AURORA, JSON.stringify(layers));
    await page.focus('#x-layers [data-focus="up-0"]');
    await page.keyboard.press('Enter');
    layers = await until(async () => { const l = (await stored())?.bg?.layers; return l?.[0]?.k === 'particles' && l; });
    check('Move up from the keyboard reorders the stack', !!layers);
    check('  focus follows the moved layer, and the move is announced', await page.evaluate(() => document.activeElement?.dataset.focus === 'up-1' && /layer 2 of 2/.test([...document.querySelectorAll('#x-layers [role="status"]')].map((p) => p.textContent).join(' '))));
    check('  Move up at the top stays focusable but does nothing', await page.evaluate(() => document.activeElement.getAttribute('aria-disabled') === 'true'));
    await page.keyboard.press('Enter');
    check('  (still two layers in the same order)', XP.same((await stored()).bg.layers, layers));
    await press('Add a layer', '#x-layers');
    await press('Add a layer', '#x-layers');
    check('Add a layer stops at four', await page.evaluate(() => document.getElementById('x-layer-add').disabled && document.querySelectorAll('#x-layers .x-stack > li').length === 4));
    await page.selectOption('#x-layers .x-stack > li:nth-child(3) select', 'scene');
    const third = await until(async () => { const l = (await stored())?.bg?.layers?.[2]; return l?.k === 'scene' && l; });
    check('a layer\'s kind changes to a fresh one that cleans', XP.same(third, BG.fresh('scene')), JSON.stringify(third));
    await shot('layers');

    // ---- motion -------------------------------------------------------------------------------------------------------------
    await page.goto(`chrome-extension://${id}/options.html#look/motion`);
    await page.waitForFunction(() => document.getElementById('preview')?.contentDocument?.documentElement.dataset.previewReady === 'true');
    // The Ultra preview's course outline: the page whose own entrance (page.enter) shows there.
    await page.evaluate(() => { document.getElementById('preview-site').value = 'ultra'; document.getElementById('preview-page').value = 'outline'; document.getElementById('preview-page').dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => document.getElementById('preview')?.contentDocument?.documentElement.dataset.previewReady === 'true');
    await page.click('details[data-moment="page.enter"] summary');
    await page.selectOption('details[data-moment="page.enter"] select', 'rise');
    const rise = await until(async () => (await stored())?.anim?.['page.enter']);
    check('a ready animation is saved for its moment', XP.same(rise, M.ENTER.rise[1]), JSON.stringify(rise));
    check('  and the preview has its keyframes', await until(() => preview().evaluate(() => /gz-x-/.test(getComputedStyle(document.documentElement).getPropertyValue('--gz-x-enter-page')))));
    check('  its stops are editable, two of them with their values', await page.evaluate(() => document.querySelectorAll('details[data-moment="page.enter"] ol > li').length === 2));
    await page.evaluate(() => document.querySelector('details[data-moment="page.enter"] select[aria-label="Add a value to stop 1"]').focus());
    await page.selectOption('details[data-moment="page.enter"] select[aria-label="Add a value to stop 1"]', 'r');
    const turned = await until(async () => { const a = (await stored())?.anim?.['page.enter']; return a?.s?.[0] && 'r' in a.s[0] && a; });
    check('a value added to a stop is saved, and the moment is now built by hand', !!turned && (await page.evaluate(() => document.querySelector('details[data-moment="page.enter"] select').value)) === 'custom');
    await preview().evaluate(() => { globalThis.started = []; document.addEventListener('animationstart', (e) => started.push(e.animationName)); });
    await press('Play in the preview', 'details[data-moment="page.enter"]');
    check('Play replays the entrance in the preview', await until(() => preview().evaluate(() => started.some((n) => n.startsWith('gz-x-'))), 3000),
      await preview().evaluate(() => JSON.stringify({ started, page: document.documentElement.dataset.previewPage })));
    await press('Add a stop after', 'details[data-moment="page.enter"]');
    await page.evaluate(() => {
      const at = document.querySelector('details[data-moment="page.enter"] ol > li input[type="range"]');
      at.focus(); at.value = '75'; at.dispatchEvent(new Event('change'));
    });
    const reordered = await until(async () => {
      const stops = (await stored())?.anim?.['page.enter']?.s;
      return stops?.[1]?.at === 0.75 && stops;
    }, 1500);
    check('moving a stop past another saves the sorted stops with their values', !!reordered && reordered[1].y === 16 && reordered[1].r === 0);
    check('focus follows the moved stop', await page.evaluate(() => document.activeElement === document.querySelector('details[data-moment="page.enter"] ol > li:nth-child(2) input[type="range"]')));

    await page.evaluate(() => { document.querySelector('details[data-event="complete"]').open = true; });
    await pick('details[data-event="complete"]', 'Effect', 'confetti');
    const fx = await until(async () => (await stored())?.fx?.complete);
    check('an event effect is saved with only its kind; its sliders show the defaults', XP.same(fx, { kind: 'confetti' }));
    await press('Try it', '#x-motion');
    check('  Try it plays it in the preview', !!(await until(() => preview().evaluate(() => !!document.getElementById('gz-fx')), 3000)));
    await pick('#x-motion', 'Cursor effect', 'sparkle');
    check('a cursor effect is saved', XP.same(await until(async () => (await stored())?.cursor), { kind: 'sparkle' }));
    await shot('motion');

    // Motion off: the preview holds still, the editor says so.
    await page.evaluate(() => document.querySelector('input[name="motion.level"][value="off"]').click());
    await sleep(600);
    await preview().evaluate(() => document.getElementById('gz-fx')?.remove());
    await press('Try it', '#x-motion');
    await sleep(800);
    check('with motion off the editor says so and Try it plays nothing', /Motion is off/.test(await page.evaluate(() => document.querySelector('#x-motion [role="status"]').textContent)) && !(await preview().evaluate(() => !!document.getElementById('gz-fx'))));
    await page.evaluate(() => document.querySelector('input[name="motion.level"][value="subtle"]').click());

    for (const site of ['canvas', 'moodle']) {
      await page.selectOption('#preview-site', site);
      await page.waitForFunction((site) => {
        const doc = document.getElementById('preview')?.contentDocument;
        return doc?.documentElement?.dataset.previewReady === 'true' && doc.documentElement.dataset.previewSite === site;
      }, site);
      check(`${site} preview loads the motion runtime and custom keyframes`, await until(() => preview().evaluate(() => !!globalThis.GZ_MOTIONX && /gz-x-/.test(getComputedStyle(document.documentElement).getPropertyValue('--gz-x-enter-page'))), 1500));
      await press('Try it', 'details[data-event="complete"]');
      check(`${site} preview plays event effects`, !!await until(() => preview().evaluate(() => !!document.getElementById('gz-fx')), 1500));
      check(`${site} preview has no obsolete Ultra-only motion notice`, !/Blackboard Ultra preview/.test(await page.locator('#x-motion [role="status"]').first().textContent()));
      await page.evaluate(() => document.querySelector('input[name="motion.level"][value="off"]').click());
      await until(() => preview().evaluate(() => !document.getElementById('gz-fx')));
      await press('Try it', 'details[data-event="complete"]');
      await sleep(700);
      check(`${site} motion off silences effects`, !await preview().evaluate(() => !!document.getElementById('gz-fx')));
      await page.evaluate(() => document.querySelector('input[name="motion.level"][value="subtle"]').click());
      if (site === 'canvas') {
        await page.selectOption('#preview-page', 'quiz');
        await until(() => preview().evaluate(() => !getComputedStyle(document.documentElement).getPropertyValue('--gz-x-enter-page')));
        await press('Try it', 'details[data-event="complete"]');
        await sleep(700);
        check('quiz previews suppress Look animations and effects', await preview().evaluate(() => !GZ_CTX.parts() && !document.getElementById('gz-fx') && !getComputedStyle(document.documentElement).getPropertyValue('--gz-x-enter-page')));
        await page.selectOption('#preview-page', 'outline');
      }
    }

    // The device-only status is repeated beside the builders.
    await page.evaluate(() => { const s = document.getElementById('look-parts-storage'); s.hidden = false; s.textContent = 'Extras on this device only.'; });
    check('the "extras on this device only" status shows beside the builders', await until(() => page.evaluate(() => [...document.querySelectorAll('[data-x-storage]')].every((p) => !p.hidden && p.textContent === 'Extras on this device only.'))));

    // A theme code carries the parts.
    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('no clipboard')); });
    await page.evaluate(() => document.getElementById('share-copy').click());
    const code = await until(() => page.evaluate(() => document.getElementById('share-code').value));
    check('Copy theme code writes a glaze2 code with the parts', /^glaze2:/.test(code || ''), String(code).slice(0, 12));

    // Every control the builders made has a name a screen reader reads.
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('#x-shader, #x-layers, #x-motion')].flatMap((h) => [...h.querySelectorAll('input, select, textarea, button')])
      .filter((c) => !(c.getAttribute('aria-label') || c.closest('label')?.textContent.trim() || (c.tagName === 'BUTTON' && c.textContent.trim()))).map((c) => c.outerHTML.slice(0, 80)));
    check('every builder control is labelled', !unnamed.length, unnamed.join(' '));
    await page.goto(`chrome-extension://${id}/options.html#look/background`);
    await page.waitForSelector('#x-shader-code', { state: 'attached' });
    await page.evaluate(() => { document.getElementById('reset-all').click(); document.getElementById('reset-all').click(); });
    await kind('shader');
    await page.fill('#x-shader-code', broken);
    await until(() => page.locator('#x-shader .x-errors li').count());
    await page.evaluate(() => { document.getElementById('reset-all').click(); document.getElementById('reset-all').click(); });
    check('Reset everything clears an invalid shader draft and its errors even without saved parts', await page.evaluate(() => !document.getElementById('x-shader-code').value && !document.querySelector('#x-shader .x-errors li')));
    // Make a spare compiler context in this new page, then check its lifetime explicitly.
    await kind('shader');
    await page.fill('#x-shader-code', AURORA);
    await until(() => page.evaluate(() => shaderChecks.length));
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
    check('the spare shader compiler context is released on pagehide', await until(() => page.evaluate(() => shaderChecks.length && shaderChecks.every((gl) => gl.isContextLost())), 1500));
    check('no page errors', !errors.length, errors.join(' | '));
  } finally {
    await context?.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
