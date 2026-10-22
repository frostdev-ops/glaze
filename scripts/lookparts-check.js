// Look parts in the real unpacked extension, headless: a stand-in Ultra page (the real content script) and the editor and
// popup pages (the real options.js, ui.js). Nothing on it reaches the network.
//   - With no parts, the page loads nothing for them.
//   - Pasting a glaze2 code previews its parts in the editor's frame; "Use this theme" stores them, and the page gets
//     GZ_CTX.parts() and one glaze:parts event, from storage alone.
//   - A plain glaze1 code, and a built-in Look from the popup, clear them again.
//   - Parts too big for a sync item live in local storage with a hash in sync, and the page reads them there.
//   - A quiz page gets none.
// EXT=/path/to/checkout NODE_PATH=/path/to/playwright/node_modules nice node scripts/lookparts-check.js
// One browser at a time (wait while another agent's run is up); it deletes its own profile when it is done.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ext = process.env.EXT || path.resolve(__dirname, '..');
const G = require(path.join(ext, 'defaults.js')), S = require(path.join(ext, 'lib/share.js')), X = require(path.join(ext, 'lib/lookparts.js'));
const chromeLaunch = require('./check-env.js').chromeLaunch();
const LMS = 'https://school.example.test';
const PAGE = `${LMS}/ultra/courses/_1_1/outline`, QUIZ = `${LMS}/ultra/courses/_1_1/assessment/_9_1`;
const html = '<!doctype html><html><head><base href="https://school.example.test/ultra/"><title>Course</title></head><body><main id="app"><h1>A course</h1></main></body></html>';
const SHADER = '// a ring\nfloat ring(vec2 p) {\n    return smoothstep(0.3, 0.29, length(p - 0.5));\n}\nvec4 scene(vec2 uv) {\n    return vec4(uC1, ring(uv));\n}';
const PARTS = { x: { bg: { shader: { src: SHADER } }, cursor: { kind: 'sparkle', c: ['accent'], size: 14 }, anim: { 'card.enter': { s: [{ at: 0, y: 12, o: 0 }, { at: 1, y: 0, o: 1 }], ms: 300 } }, nav: { place: 'top', hidden: ['grades'] } } };
const until = async (fn, ok = (v) => v, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 40)); } return v; };

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-lookparts-'));
  const results = [], external = [], errors = [];
  const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ` ${detail}`}`); };
  let context;
  try {
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(scratch, { ...chromeLaunch, headless: true, viewport: { width: 1280, height: 850 }, locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-webgl', '--host-resolver-rules=MAP * ~NOTFOUND'] });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('chrome-extension:') || url.startsWith('data:')) return route.continue();
      if (url.startsWith(LMS)) return route.fulfill({ contentType: 'text/html', body: html });
      external.push(url); return route.abort();
    });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const state = (url = PAGE) => sw.evaluate(async (u) => {
      const [tab] = await chrome.tabs.query({ url: u });
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ loaded: typeof GZ_XPARTS_PAGE, parts: globalThis.GZ_CTX ? globalThis.GZ_CTX.parts() : 'no GZ_CTX' }) });
      return r.result;
    }, url);
    const stored = () => sw.evaluate(async () => ({ sync: await chrome.storage.sync.get(['lookX', 'bg']), local: await chrome.storage.local.get('lookX') }));

    // ---- the page, with no parts ---------------------------------------------------------------------------------------
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`page: ${e}`));
    await page.goto(PAGE);
    await until(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--gz-accent')));
    await page.evaluate(() => { window.__parts = 0; document.addEventListener('glaze:parts', (e) => { window.__parts++; window.__detail = e.detail; }); });
    let s = await state();
    check('with no parts the page loads nothing for them, and GZ_CTX.parts() is null', s.loaded === 'undefined' && s.parts === null, JSON.stringify(s));

    // ---- the editor: paste, preview, use ---------------------------------------------------------------------------------
    const editor = await context.newPage();
    editor.on('pageerror', (e) => errors.push(`editor: ${e}`));
    await editor.goto(`chrome-extension://${id}/options.html`);
    await until(() => editor.evaluate(() => !!document.querySelector('#share-code')));
    const mine = G.GZ_SANITIZE({ bg: { kind: 'shader' }, look: { radius: 8 } });
    const code = await S.encode(mine, undefined, PARTS);
    check('the code is glaze2 and short enough for chat', code.startsWith('glaze2:') && code.length < 1500, `${code.length} characters`);
    await editor.fill('#share-code', code);
    await editor.click('#share-try');
    await until(() => editor.evaluate(() => !document.querySelector('#share-offer').hidden));
    const what = await editor.evaluate(() => document.querySelector('#share-what').textContent);
    check('the offer says what the code brings', /shader|cursor effect|animations|sidebar/i.test(what) && !/undefined/.test(what), what);
    const frame = () => editor.frames().find((f) => f.url().includes('preview.html'));
    const previewed = await until(() => frame()?.evaluate(() => globalThis.GZ_CTX?.parts() ?? null), (v) => !!v);
    check('the editor\'s preview frame has the parts before anything is saved', previewed?.cursor?.kind === 'sparkle' && previewed?.bg?.shader && !(await stored()).sync.lookX, JSON.stringify(previewed)?.slice(0, 200));
    await editor.click('#share-apply');
    const after = await until(() => stored(), (v) => typeof v.sync.lookX === 'string' && v.sync.lookX.startsWith('x1:'));
    check('using the theme stores the parts in sync, beside bg.kind shader', typeof after.sync.lookX === 'string' && after.sync.bg?.kind === 'shader' && !after.local.lookX, JSON.stringify(after).slice(0, 200));
    s = await until(() => state(), (v) => !!v.parts);
    const fired = await page.evaluate(() => ({ n: window.__parts, detail: window.__detail }));
    check('the open page got the parts from storage: GZ_CTX.parts() and one glaze:parts event, without detail', s.loaded === 'object' && s.parts?.cursor?.kind === 'sparkle' && s.parts.bg.shader.src.length < SHADER.length && fired.n === 1 && !fired.detail, JSON.stringify({ s, fired }).slice(0, 300));

    // ---- a plain code and a built-in Look clear them ----------------------------------------------------------------------
    await editor.fill('#share-code', await S.encode(G.GZ_SANITIZE({ look: { radius: 10 }, bg: { kind: 'aurora' } })));
    await editor.click('#share-try');
    await until(() => editor.evaluate(() => !document.querySelector('#share-offer').hidden));
    await editor.click('#share-apply');
    s = await until(() => state(), (v) => v.parts === null);
    check('a glaze1 code, used, leaves no parts: the page lets go of them and says so once', s.parts === null && (await stored()).sync.lookX === '' && (await page.evaluate(() => window.__parts)) === 2);
    await editor.close();

    // ---- parts too big for sync live in local storage -------------------------------------------------------------------
    // A real shader (the page loads the GLSL checker for a shader Look, which refuses anything that is not GLSL) with 8,000
    // incompressible characters in a block comment: about 9 KB once packed, over a sync item's 8 KB.
    const filler = [...Array(94)].map((_, i) => String.fromCharCode(33 + i)).filter((c) => !'/*#\\'.includes(c));
    const big = { x: { bg: { shader: { src: `vec4 scene(vec2 uv) { return vec4(uC1, 1.0); }\n/*${Array.from(require('node:crypto').randomBytes(8000), (b) => filler[b % filler.length]).join('')}*/` } } } };
    const wrote = await sw.evaluate((P) => GZ_XPARTS.write({ sync: brokerArea('sync'), local: brokerArea('local') }, P, { version: 2 }), big);
    const where = await stored();
    check('parts too big for a sync item are in local storage, with their hash in sync', wrote === true && where.sync.lookX?.h && typeof where.local.lookX === 'string', JSON.stringify(where).slice(0, 200));
    s = await until(() => state(), (v) => !!v.parts);
    check('and the page reads them there', s.parts?.bg?.shader?.src.length > 7000 && (await page.evaluate(() => window.__parts)) === 3, JSON.stringify(s).slice(0, 120));

    const deviceEditor = await context.newPage();
    await deviceEditor.goto(`chrome-extension://${id}/options.html`);
    const notice = await until(() => deviceEditor.evaluate(() => document.querySelector('#look-parts-storage')?.textContent || ''), (v) => !!v, 1000);
    check('the editor identifies parts kept on this device only', /extras.*this device only/i.test(notice), notice || 'no storage notice');
    await sw.evaluate(() => chrome.storage.local.set({ lookX: 'mismatched device copy' }));
    const missing = await until(() => deviceEditor.evaluate(() => document.querySelector('#look-parts-storage')?.textContent || ''), (v) => /unavailable/i.test(v));
    check('a sync hash with a different local copy is identified as unavailable', /unavailable.*this device/i.test(missing), missing);
    await until(() => state(), (v) => v.parts === null);
    await sw.evaluate((s) => chrome.storage.local.set({ lookX: s }), where.local.lookX);
    await until(() => state(), (v) => !!v.parts);
    await deviceEditor.close();

    // ---- a quiz page gets none ------------------------------------------------------------------------------------------
    const quiz = await context.newPage();
    await quiz.goto(QUIZ);
    await until(() => quiz.evaluate(() => document.documentElement.style.getPropertyValue('--gz-accent')));
    await until(() => state(QUIZ), (v) => v.loaded === 'object');
    s = await state(QUIZ);
    check('a quiz page has the parts read and still gets none from GZ_CTX.parts()', s.loaded === 'object' && s.parts === null, JSON.stringify(s).slice(0, 120));
    await quiz.close();

    // ---- the popup's Look sheet -----------------------------------------------------------------------------------------
    const popup = await context.newPage();
    popup.on('pageerror', (e) => errors.push(`popup: ${e}`));
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.click('#look');
    await popup.waitForSelector('#looks .look');
    await popup.click('#looks .look:text-is("Clear")'); // one with a bundled font: Looks with web fonts ask Google Fonts, blocked here
    const cleared = await until(() => stored(), (v) => v.sync.lookX === '');
    check('a built-in Look from the popup clears the parts, in sync and in local', cleared.sync.lookX === '' && !cleared.local.lookX, JSON.stringify(cleared).slice(0, 160));
    s = await until(() => state(), (v) => v.parts === null);
    check('and the page lets go of them', s.parts === null && (await page.evaluate(() => window.__parts)) === 6);
    await popup.close();

    check('no request left the browser', external.length === 0, [...new Set(external)].join(' '));
    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally { await context?.close(); fs.rmSync(scratch, { recursive: true, force: true }); }
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
