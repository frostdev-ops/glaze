// Media backgrounds in the real unpacked extension, headless: a video, an animated picture and a Lottie animation drawn behind an
// Ultra-shaped page from a Look's parts (storage → features/lookparts.js → content.js syncScene → lib/scene-media.js), each
// from an https address and from a file this computer keeps, and each checked for what a background must always do: muted and
// without controls, really playing, frozen on its first frame with motion off, paused while the tab is hidden, and the
// gradient left alone, with nothing thrown, when it can't load. Pixels are read from screenshots, so "playing" and "frozen" are
// what a person would see. Then the editor: the builder's controls write the part, a file is kept and listed and removed, and
// the preview frame draws it and tells its parent. Then a mod's own background file (an animated WebP and a Lottie file in its
// bundle, `mod:<id>/<path>` on the page), and a gallery Look's file fetched from the gallery's media address (routed here).
//   nice -n 10 NODE_PATH=/path/to/node_modules node scripts/media-check.js [out-dir]
// One headless browser at a time across agents: wait while another is running. Every profile is temporary, and no request
// leaves the fixture (a host-resolver rule maps every name to nothing, and the page's own routes answer).
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict');

const origin = 'https://ultra.fixture.test';
// A staged copy holding the fixture's host, as a student's grant for their school's Ultra would (scripts/check-env.js staged).
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), [`${origin}/*`]);
const out = process.argv[2] && path.resolve(process.argv[2]);
const chromeLaunch = require('./check-env.js').chromeLaunch();
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
// Another host, which the staged copy doesn't hold: a Look's address there is refused before any request.
const ELSEWHERE = 'https://media.elsewhere.test';
const D = require(path.join(ext, 'defaults.js'));
const P = require(path.join(ext, 'lib/lookparts.js'));
const fixtures = path.join(ext, 'test/fixtures/media');
const TYPES = { '.webm': 'video/webm', '.webp': 'image/webp', '.json': 'application/json', '.mp4': 'video/mp4' };
const fixture = '<!doctype html><html lang="en"><head><base href="//ultra-cdn.invalid/ultra/uiv4001.0.0-rel/"><meta charset="utf-8"><title>Ultra fixture</title></head><body><div id="site-wrap"><nav id="base_tools"><a href="/ultra/institution-page"><span>Institution Page</span></a><a href="/ultra/course">Courses</a></nav><main id="main-content"><div id="main-content-inner"><h1>Stream</h1></div></main></div></body></html>';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The frame colours of anim.webp (48x48, three frames of 100 ms), and the spin.json box (red, 40 wide, from x 40 to 160 in a 200x120 design).
const FRAMES = [[0, 255, 80], [100, 155, 80], [200, 55, 80]];
const M = require(path.join(ext, 'lib/media.js'));
const S = require(path.join(ext, 'lib/share.js'));
const near = (a, b, tol = 24) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

(async () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-media-check-')));
  const results = [], errors = [], blocked = [], served = [];
  // The gallery, routed: its Looks page, and its media files by name (what each name serves, and which were asked for).
  let galleryPage = '';
  const galleryFiles = new Map(), galleryAsked = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: ok ? undefined : detail }); };
  let context, failure;
  try {
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...chromeLaunch, headless: true, viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(15000);
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.origin === 'https://frostdev.io') {
        if (u.pathname === '/glaze/looks/') return r.fulfill({ contentType: 'text/html', body: galleryPage });
        const h = u.pathname.startsWith('/glaze/looks/api/media/') ? u.pathname.slice(23) : '';
        if (h) galleryAsked.push(h);
        if (galleryFiles.has(h)) return r.fulfill({ status: 200, headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable', etag: `"${h}"` }, body: galleryFiles.get(h) });
        return r.fulfill({ status: 404, body: 'no' });
      }
      if (u.origin !== origin) { blocked.push(u.href); return r.abort(); }
      if (u.pathname.startsWith('/ultra')) return r.fulfill({ contentType: 'text/html', body: fixture });
      if (u.pathname.startsWith('/learn/api/')) return r.fulfill({ json: u.pathname.endsWith('/users/me') ? { id: '_900_1' } : { results: [] } });
      if (u.pathname.startsWith('/media/')) {
        const file = path.join(fixtures, path.basename(u.pathname));
        if (!fs.existsSync(file)) return r.fulfill({ status: 404, body: 'no' });
        served.push(path.basename(u.pathname));
        const body = fs.readFileSync(file), type = TYPES[path.extname(file)];
        // Range requests answered as a media server does (a video seeks to loop).
        const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '');
        if (range) { const from = +range[1], to = range[2] ? Math.min(+range[2], body.length - 1) : body.length - 1; return r.fulfill({ status: 206, headers: { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${from}-${to}/${body.length}` }, body: body.subarray(from, to + 1) }); }
        return r.fulfill({ status: 200, headers: { 'content-type': type, 'accept-ranges': 'bytes' }, body });
      }
      blocked.push(u.href); return r.abort();
    });
    const opts = await context.newPage();
    opts.on('pageerror', (e) => errors.push(`options: ${e.message}`));
    await opts.goto(`chrome-extension://${id}/options.html`);
    const store = (bg, lookX, motion = 'subtle') => opts.evaluate(async ({ defaults, bg, lookX, motion }) => {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set({ ...defaults, bg, lookX, motion: { ...defaults.motion, level: motion, followSystem: false } });
    }, { defaults: D.GZ_DEFAULTS, bg: { ...D.GZ_DEFAULTS.bg, ...bg }, lookX, motion });
    const wipe = () => opts.evaluate(async () => {
      if (!(await chrome.runtime.sendMessage({ type: 'glaze:media', op: 'reset' }))?.ok) throw new Error('media reset failed');
      await chrome.storage.sync.clear(); await chrome.storage.local.clear();
    });
    const look = (media) => P.pack({ x: { bg: { media } } });
    const url = (f) => `${origin}/media/${f}`;
    // The fixture's site approved (storage.local ultra) and its Ultra script registered before each page.
    const approve = async () => {
      await opts.evaluate((o) => chrome.storage.local.get('ultra').then((r) => (r.ultra || []).includes(o) || chrome.storage.local.set({ ultra: [...(r.ultra || []), o] })), origin);
      await require('./check-env.js').ultraReady(opts);
    };
    const open = async () => { await approve(); const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message)); await page.goto(`${origin}/ultra/stream`); await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-font')); return page; };
    const shot = async (page, name) => { if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `${name}.png`) }); } };
    // The colour at a point of the page, from a screenshot (decoded in the extension's page: a canvas reads pixels back).
    const pixel = async (page, x, y) => {
      const png = await page.screenshot({ clip: { x, y, width: 4, height: 4 } });
      return opts.evaluate(async (b64) => {
        const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bm.width, bm.height).getContext('2d');
        c.drawImage(bm, 0, 0);
        const d = c.getImageData(1, 1, 1, 1).data;
        return [d[0], d[1], d[2]];
      }, png.toString('base64'));
    };
    // The red box of the Lottie animation: where red begins and ends along a strip through the middle of the page, or null.
    const redSpan = async (page) => {
      const png = await page.screenshot({ clip: { x: 0, y: 396, width: 1280, height: 8 } });
      const row = await opts.evaluate(async (b64) => {
        const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bm.width, bm.height).getContext('2d');
        c.drawImage(bm, 0, 0);
        const d = c.getImageData(0, 4, bm.width, 1).data, red = [];
        for (let x = 0; x < bm.width; x++) if (d[x * 4] > 200 && d[x * 4 + 1] < 60 && d[x * 4 + 2] < 60) red.push(x);
        return red.length ? [red[0], red.at(-1)] : null;
      }, png.toString('base64'));
      return row;
    };
    // What Glaze's own (isolated) world of the page holds. One CDP session per page.
    const worlds = new Map();
    const isolated = async (page, expression) => {
      if (!worlds.has(page)) {
        const cdp = await context.newCDPSession(page), seen = [];
        cdp.on('Runtime.executionContextCreated', (e) => seen.push(e.context));
        await cdp.send('Runtime.enable');
        worlds.set(page, { cdp, seen });
      }
      const { cdp, seen } = worlds.get(page);
      const world = seen.find((w) => w.origin === `chrome-extension://${id}`);
      const r = world && await cdp.send('Runtime.evaluate', { contextId: world.id, expression, returnByValue: true, awaitPromise: true });
      if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
      return r?.result?.value;
    };
    const video = (page) => isolated(page, "(() => { const v = document.querySelector('#gz-scene video'); return v && JSON.stringify({ paused: v.paused, t: v.currentTime, muted: v.muted, loop: v.loop, controls: v.controls, autoplay: v.autoplay, ready: v.readyState, w: v.videoWidth, vol: v.volume, fit: v.style.objectFit, src: v.currentSrc.slice(0, 40), pip: v.disablePictureInPicture, aria: v.getAttribute('aria-hidden') }); })()").then((v) => v && JSON.parse(v));
    const waitFor = (page, expression, ms = 12000) => page.waitForFunction(expression, null, { timeout: ms }).then(() => true, () => false);
    const sceneThere = (page, want = true) => waitFor(page, `!!document.getElementById('gz-scene') === ${want}`);
    const hide = (page, hidden) => isolated(page, `(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${hidden} }); document.dispatchEvent(new Event('visibilitychange')); return true; })()`);
    const put = (kind, file) => opts.evaluate(async ({ kind, b64 }) => chrome.runtime.sendMessage({ type: 'glaze:media', op: 'put', kind, b64 }), { kind, b64: fs.readFileSync(path.join(fixtures, file)).toString('base64') });

    // ---- a video from an address -------------------------------------------------------------------------------------
    await store({ kind: 'media' }, await look({ type: 'video', src: url('clip.webm'), fit: 'fill', dim: 0 }));
    let page = await open();
    check('a video Look: the background appears behind the page', await sceneThere(page), 'no #gz-scene');
    await waitFor(page, "document.querySelector('#gz-scene video')?.readyState >= 2");
    let v = await video(page);
    check('  it is a muted, silent, controls-free, non-autoplaying video that loops and has no picture-in-picture', v && v.muted && v.vol !== undefined && !v.controls && !v.autoplay && v.loop && v.pip && v.aria === 'true' && v.ready >= 2 && v.w === 64, JSON.stringify(v));
    await sleep(900);
    const v2 = await video(page);
    check('  it is playing: not paused and the clock moved', v2 && !v2.paused && (v2.t > v.t || v2.t > 0.3), JSON.stringify([v, v2]));
    const spots = [];
    for (const [x, y] of [[100, 100], [400, 300], [700, 500], [1000, 650], [1200, 750]]) spots.push(JSON.stringify(await pixel(page, x, y)));
    check('  it drew into the page: stretched to the window, the test pattern showing in several colours', (await isolated(page, "document.querySelector('#gz-scene video').style.objectFit")) === 'fill' && new Set(spots).size >= 3, JSON.stringify(spots));
    check('  the page is on the media kind, with the gradient under it', (await page.evaluate(() => document.documentElement.getAttribute('data-gz-bg'))) === 'media', 'kind');
    check('  no three.js was loaded for it (the scene is a div, not a canvas)', (await isolated(page, "document.getElementById('gz-scene').tagName")) === 'DIV', 'canvas');
    await shot(page, 'video');
    // Hidden: paused where it is. Shown: playing again.
    await hide(page, true);
    await sleep(150);
    const hidden = await video(page);
    await sleep(500);
    const hidden2 = await video(page);
    check('  hidden, it pauses where it is and stays there', hidden.paused && hidden2.paused && hidden2.t === hidden.t && hidden.t > 0, JSON.stringify([hidden, hidden2]));
    await hide(page, false);
    await sleep(600);
    const shown = await video(page);
    check('  shown again, it plays on', !shown.paused && shown.t !== hidden.t, JSON.stringify(shown));
    await page.close();

    // Motion off: the first frame, no playing.
    await store({ kind: 'media' }, await look({ type: 'video', src: url('clip.webm') }), 'off');
    page = await open();
    await sceneThere(page);
    await waitFor(page, "document.querySelector('#gz-scene video')?.readyState >= 2");
    await sleep(900);
    v = await video(page);
    check('motion off: the video holds its first frame and never plays', v && v.paused && v.t === 0 && v.ready >= 2, JSON.stringify(v));
    const firstSpots = [];
    for (const [x, y] of [[100, 100], [400, 300], [700, 500], [1000, 650], [1200, 750]]) firstSpots.push(JSON.stringify(await pixel(page, x, y)));
    check('  the first frame is on screen', new Set(firstSpots).size >= 3, JSON.stringify(firstSpots));
    await shot(page, 'video-motion-off');
    // Switching motion on while the page is open plays it, off again stops it.
    await store({ kind: 'media' }, await look({ type: 'video', src: url('clip.webm') }), 'subtle');
    check('  motion turned on under the open page: it plays', await waitFor(page, "(() => { const v = document.querySelector('#gz-scene video'); return v && !v.paused && v.currentTime > 0; })()"), 'still');
    await store({ kind: 'media' }, await look({ type: 'video', src: url('clip.webm') }), 'off');
    check('  and turned off again: it stops on the first frame', await waitFor(page, "(() => { const v = document.querySelector('#gz-scene video'); return v && v.paused && v.currentTime === 0; })()"), 'still moving');
    await page.close();

    // The system's reduced-motion setting wins over the level, as for every animation.
    await store({ kind: 'media' }, await look({ type: 'video', src: url('clip.webm') }), 'subtle');
    await opts.evaluate(async () => { const s = (await chrome.storage.sync.get('motion')).motion; await chrome.storage.sync.set({ motion: { ...s, followSystem: true } }); });
    page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${origin}/ultra/stream`);
    await sceneThere(page);
    await waitFor(page, "document.querySelector('#gz-scene video')?.readyState >= 2");
    await sleep(700);
    v = await video(page);
    check('reduced motion in the system: held on its first frame', v && v.paused && v.t === 0, JSON.stringify(v));
    await page.close();

    // ---- an animated picture ----------------------------------------------------------------------------------------
    await store({ kind: 'media' }, await look({ type: 'image', src: url('anim.webp'), fit: 'fill', dim: 0 }));
    page = await open();
    check('an animated picture Look: the background appears', await sceneThere(page), 'no #gz-scene');
    await waitFor(page, "document.querySelector('#gz-scene img')?.complete");
    const colours = [];
    for (let i = 0; i < 14; i++) { colours.push(await pixel(page, 900, 600)); await sleep(60); }
    const frames = new Set(colours.map((c) => FRAMES.findIndex((f) => near(f, c, 30))).filter((i) => i >= 0));
    check('  it moves: the screen shows more than one of its frames over a second', frames.size >= 2, JSON.stringify(colours));
    check('  it is an img of the worker-cleaned blob, with no referrer', (await isolated(page, "(() => { const i = document.querySelector('#gz-scene img'); return i && i.referrerPolicy + ' ' + i.currentSrc.startsWith('blob:') + ' ' + i.naturalWidth; })()")) === 'no-referrer true 48', 'img');
    await shot(page, 'image');
    await page.close();

    await store({ kind: 'media' }, await look({ type: 'image', src: url('anim.webp'), fit: 'fill', dim: 0 }), 'off');
    page = await open();
    await sceneThere(page);
    await waitFor(page, "document.querySelector('#gz-scene canvas')");
    await sleep(500);
    const still = [];
    for (let i = 0; i < 6; i++) { still.push(await pixel(page, 900, 600)); await sleep(90); }
    check('motion off: the picture holds its first frame (a canvas, not the moving picture)', still.every((c) => near(c, FRAMES[0], 30)) && (await isolated(page, "!document.querySelector('#gz-scene img')?.getAttribute('src')")), JSON.stringify(still));
    await shot(page, 'image-motion-off');
    await page.close();

    // ---- a Lottie animation ------------------------------------------------------------------------------------------
    const kept = await put('lottie', 'spin.json');
    check('the editor keeps a Lottie file (the worker reads it again, names it by its SHA-256)', kept?.ok && /^[\w-]{43}$/.test(kept.h) && kept.type === 'lottie', JSON.stringify(kept));
    await store({ kind: 'media' }, await look({ type: 'lottie', src: `file:${kept.h}`, fit: 'cover', dim: 0 }));
    page = await open();
    check('a Lottie Look: the background appears', await sceneThere(page), 'no #gz-scene');
    check('  the player loaded on demand: a canvas in the scene, drawn by lottie\'s canvas renderer', await waitFor(page, "document.querySelector('#gz-scene canvas')"), 'no canvas');
    await sleep(250);
    // cover: the 200x120 design is scaled by max(1280/200, 800/120) = 6.67; the box (40 wide) starts at x 40 and slides to 160.
    const first = await redSpan(page);
    check('  early in the animation the red box is near the left', first && first[0] > 100 && first[1] < 520, JSON.stringify(first));
    await sleep(1100);
    const later = await redSpan(page);
    check('  it moves: later the box is further right', later && later[0] > first[0] + 150, JSON.stringify([first, later]));
    const noEval = await isolated(page, "(() => { try { return typeof lottie + ' ' + typeof lottie.loadAnimation; } catch (e) { return String(e); } })()");
    check('  the player is lottie-web\'s light build (no expressions) in Glaze\'s own world only', noEval === 'object function' && (await page.evaluate(() => typeof window.lottie)) === 'undefined', noEval);
    await shot(page, 'lottie');
    await page.close();

    await store({ kind: 'media' }, await look({ type: 'lottie', src: `file:${kept.h}`, fit: 'cover', dim: 0 }), 'off');
    page = await open();
    await sceneThere(page);
    await waitFor(page, "document.querySelector('#gz-scene canvas')");
    await sleep(500);
    const frozen = [];
    for (let i = 0; i < 5; i++) { frozen.push(await redSpan(page)); await sleep(300); }
    check('motion off: the animation holds frame 0 (the box stays at the left)', frozen.every((f) => f && f[0] > 100 && f[1] < 520 && Math.abs(f[0] - frozen[0][0]) <= 2), JSON.stringify(frozen));
    await shot(page, 'lottie-motion-off');
    await page.close();

    // Lottie from an address: the worker fetches it for the page, with no cookies and no redirect, and only the address the worn Look names.
    await store({ kind: 'media' }, await look({ type: 'lottie', src: url('spin.json'), fit: 'cover', dim: 0 }));
    page = await open();
    const lottieUrl = await waitFor(page, "document.querySelector('#gz-scene canvas')", 9000);
    check('a Lottie animation from an address: the worker fetches the file and the page draws it', lottieUrl && served.includes('spin.json'), JSON.stringify({ lottieUrl, served: served.filter((f) => f.endsWith('.json')) }));
    await page.close();
    // The worker is asked by an address nothing wears: it refuses without fetching.
    const before = served.length;
    const ask = await opts.evaluate(async (u) => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:lottie', src: u }, res)), url('other.json'));
    check('  an address the worn Look does not name is refused (the editor page may try any, a page may not)', ask?.ok === false || ask?.error === 'network', JSON.stringify(ask));

    // ---- files this computer keeps: video and picture ----------------------------------------------------------------
    const kv = await put('video', 'clip.webm'), ki = await put('image', 'anim.webp');
    check('files are kept for a video and a picture', kv?.ok && ki?.ok && kv.size > 1000, JSON.stringify([kv, ki]));
    await store({ kind: 'media' }, await look({ type: 'video', src: `file:${kv.h}`, fit: 'fill', dim: 0 }));
    page = await open();
    await sceneThere(page);
    await waitFor(page, "document.querySelector('#gz-scene video')?.readyState >= 2");
    await waitFor(page, "document.querySelector('#gz-scene video') && !document.querySelector('#gz-scene video').paused");
    v = await video(page);
    check('a kept video plays from a blob address of the page', v && /^blob:/.test(v.src) && !v.paused, JSON.stringify(v));
    await page.close();
    await store({ kind: 'media' }, await look({ type: 'image', src: `file:${ki.h}`, fit: 'fill', dim: 0 }), 'off');
    page = await open();
    await sceneThere(page);
    await waitFor(page, "document.querySelector('#gz-scene canvas')");
    await sleep(400);
    check('a kept picture with motion off draws its first frame from its own bytes', near(await pixel(page, 900, 600), FRAMES[0], 30), JSON.stringify(await pixel(page, 900, 600)));
    await page.close();

    // ---- what can't be shown ------------------------------------------------------------------------------------------
    for (const [why, media] of [
      ['a video that is not there (404)', { type: 'video', src: url('missing.webm') }],
      ['a file that is not on this computer', { type: 'video', src: `file:${'A'.repeat(43)}` }],
      ['a picture that is not a picture', { type: 'image', src: url('clip.webm') }],
      ['a Lottie address that is not Lottie', { type: 'lottie', src: url('clip.webm') }],
      ['a video on a host Glaze doesn\'t hold', { type: 'video', src: `${ELSEWHERE}/media/clip.webm` }],
      ['a Lottie address on a host Glaze doesn\'t hold', { type: 'lottie', src: `${ELSEWHERE}/media/spin.json` }],
    ]) {
      await store({ kind: 'media' }, await look(media));
      page = await open();
      await sleep(2500);
      const gone = await isolated(page, "!document.getElementById('gz-scene')");
      check(`${why}: no background element is left, the gradient shows`, gone === true && (await page.evaluate(() => document.documentElement.getAttribute('data-gz-bg'))) === 'media', JSON.stringify(gone));
      await page.close();
    }
    check('a host Glaze doesn\'t hold is never asked for the file (refused before the request)', !blocked.some((u) => u.startsWith(ELSEWHERE)), blocked.filter((u) => u.startsWith(ELSEWHERE)).join(' '));

    // ---- the editor ---------------------------------------------------------------------------------------------------
    await wipe();
    const ed = await context.newPage();
    ed.on('pageerror', (e) => errors.push(`editor: ${e.message}`));
    await ed.goto(`chrome-extension://${id}/options.html#look/background`);
    await ed.waitForFunction(() => document.getElementById('preview')?.contentDocument?.documentElement.dataset.previewReady === 'true');
    const text = (sel) => ed.locator(sel).textContent();
    await ed.evaluate(() => document.querySelector('input[name="bg.kind"][value="media"]').click());
    check('the editor offers Video or animation, and its builder appears', await ed.evaluate(() => !document.getElementById('x-media').hidden && !!document.getElementById('x-media-link')), 'no builder');
    await ed.fill('#x-media-link', 'http://ultra.fixture.test/media/clip.webm');
    await ed.dispatchEvent('#x-media-link', 'change');
    check('  a link that is not https is refused in words, and nothing is saved', /isn.t a link Glaze can use/.test(await text('#x-media-note')) && !(await ed.evaluate(async () => (await chrome.storage.sync.get('lookX')).lookX)), await text('#x-media-note'));
    await ed.fill('#x-media-link', url('clip.webm'));
    await ed.dispatchEvent('#x-media-link', 'change');
    await ed.waitForFunction(() => /Loads from/.test(document.getElementById('x-media-note').textContent));
    check('  an https link is accepted, and the editor names its host', /Loads from ultra\.fixture\.test\./.test(await text('#x-media-note')), await text('#x-media-note'));
    await sleep(700);
    const stored = await ed.evaluate(async () => (await chrome.storage.sync.get(['lookX', 'bg'])));
    const parts = typeof stored.lookX === 'string' ? await P.unpack(stored.lookX) : null;
    check('  the saved part is a cleaned x.bg.media, and the background kind is media', parts?.x?.bg?.media?.src === url('clip.webm') && parts.x.bg.media.type === 'video' && stored.bg.kind === 'media', JSON.stringify([parts, stored.bg?.kind]));
    // The preview frame draws it and tells the editor.
    check('  the preview says it is playing', await ed.waitForFunction(() => /playing it/.test(document.getElementById('x-media').textContent), null, { timeout: 15000 }).then(() => true, () => false), (await text('#x-media')).slice(-200));
    check('  the preview frame holds a video in a div, not a three.js canvas', await ed.evaluate(() => { const s = document.getElementById('preview').contentDocument.getElementById('gz-scene'); return !!s && s.tagName === 'DIV' && !!s.querySelector('video'); }), 'no video in the preview');
    // Fit, dim and loop write straight into the part.
    await ed.selectOption('#x-media select >> nth=1', 'contain');
    await ed.evaluate(() => { const r = document.querySelector('#x-media input[type="range"]'); r.value = '65'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
    await ed.evaluate(() => document.querySelector('#x-media input[type="checkbox"]').click());
    await sleep(900);
    const tuned = await P.unpack((await ed.evaluate(async () => (await chrome.storage.sync.get('lookX')).lookX)));
    check('  fit, dim and loop are saved in the part', JSON.stringify(tuned.x.bg.media) === JSON.stringify({ type: 'video', src: url('clip.webm'), fit: 'contain', dim: 65, loop: false }), JSON.stringify(tuned.x.bg.media));
    // A file: kept, named in the Look, listed, then removable once unused.
    await ed.setInputFiles('#x-media-file', path.join(fixtures, 'clip.webm'));
    await ed.waitForFunction(() => /Using a file kept on this computer/.test(document.getElementById('x-media-note').textContent), null, { timeout: 15000 });
    await ed.waitForFunction(() => /In use/.test(document.querySelector('.x-media-kept')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    check('  a file from this computer is kept and used, and the editor says a theme code can\'t carry it', /can.t carry a file/.test(await text('#x-media-note')) && /In use/.test(await text('.x-media-kept')), `${await text('#x-media-note')} | ${await text('.x-media-kept')}`);
    await ed.setInputFiles('#x-media-file', path.join(fixtures, 'anim.webp'));
    await ed.waitForFunction(() => /can.t play that file as this kind/.test(document.getElementById('x-media').textContent), null, { timeout: 15000 }).catch(() => {});
    check('  a picture sent as a video is refused in words', /can.t play that file as this kind/.test(await text('#x-media')), (await text('#x-media')).slice(-300));
    await ed.selectOption('#x-media select >> nth=0', 'image');
    await ed.setInputFiles('#x-media-file', path.join(fixtures, 'anim.webp'));
    await ed.waitForFunction(() => document.querySelectorAll('.x-media-kept li').length === 2, null, { timeout: 15000 });
    check('  the file in use has no Remove; the one not in use does', await ed.evaluate(() => [...document.querySelectorAll('.x-media-kept li')].map((li) => /In use/.test(li.textContent) + ':' + li.querySelectorAll('button').length).sort().join()) === 'false:1,true:0', 'buttons');
    await ed.evaluate(() => [...document.querySelectorAll('.x-media-kept li')].find((li) => !/In use/.test(li.textContent)).querySelector('button').click());
    await ed.waitForFunction(() => document.querySelectorAll('.x-media-kept li').length === 1);
    check('  removing the unused file leaves the one in use', await ed.evaluate(() => /In use/.test(document.querySelector('.x-media-kept li').textContent)), 'gone');
    if (out) await ed.screenshot({ path: path.join(out, 'editor.png') });
    // Another type of link: a Lottie address is accepted too, and Remove the link by emptying it.
    await ed.selectOption('#x-media select >> nth=0', 'lottie');
    await ed.fill('#x-media-link', url('spin.json'));
    await ed.dispatchEvent('#x-media-link', 'change');
    await sleep(700);
    const lot = await P.unpack((await ed.evaluate(async () => (await chrome.storage.sync.get('lookX')).lookX)));
    check('  a Lottie link is saved with its type', lot?.x?.bg?.media?.type === 'lottie' && lot.x.bg.media.src === url('spin.json'), JSON.stringify(lot?.x?.bg?.media));
    await ed.fill('#x-media-link', '');
    await ed.dispatchEvent('#x-media-link', 'change');
    await sleep(700);
    const gone = await ed.evaluate(async () => (await chrome.storage.sync.get('lookX')).lookX);
    check('  emptying the link takes the media out of the Look', !gone || !(await P.unpack(gone))?.x?.bg?.media, String(gone));

    // ---- what a mod carries: stickers and a pet (no code at all) ------------------------------------------------------
    // A record as the worker's install makes it, put straight in storage: the mod's packs, its files, no hooks.
    const MOD = 'abcdefghijklmnop';
    const sheet = await opts.evaluate(async () => {
      const c = new OffscreenCanvas(1536, 2288), g = c.getContext('2d'), counts = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
      g.fillStyle = '#d33';
      for (let row = 0; row < 11; row++) for (let f = 0; f < counts[row]; f++) g.fillRect(f * 192 + 40, row * 208 + 40, 100, 120);
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const b64 = (f) => fs.readFileSync(path.join(fixtures, f)).toString('base64');
    const record = (over = {}) => ({ id: MOD, enabled: true, hash: 'h', key: 'k', version: '1.0.0', source: 'file', installedAt: 1, dev: false, grants: {},
      manifest: { glaze: 1, name: 'Garden', version: '1.0.0', author: { name: 'Kai', key: 'A'.repeat(43) }, permissions: [], packs: { stickers: [{ id: 'wave', name: 'Waving', file: 'wave.webp' }, { id: 'spark', name: 'Spark', file: 'spark.json' }], pets: [{ id: 'mochi', name: 'Mochi 2', file: 'mochi.png' }] } },
      files: { 'wave.webp': b64('anim.webp'), 'spark.json': b64('spin.json'), 'mochi.png': sheet }, ...over });
    const stickerKey = `stk:${origin}/ultra/stream`;
    const placements = [{ id: 'p1', s: `mod:${MOD}/wave`, x: 20, y: 100, w: 120, r: 0 }, { id: 'p2', s: `mod:${MOD}/spark`, x: 70, y: 100, w: 200, r: 0 }];
    const seed = (motion, mod = record()) => opts.evaluate(async ({ defaults, motion, mod, key, placements, id }) => {
      if (!(await chrome.runtime.sendMessage({ type: 'glaze:media', op: 'reset' }))?.ok) throw new Error('media reset failed');
      await chrome.storage.sync.clear(); await chrome.storage.local.clear();
      await chrome.storage.sync.set({ ...defaults, extras: { ...defaults.extras, stickers: true }, motion: { ...defaults.motion, level: motion, followSystem: false } });
      await chrome.storage.local.set({ [`mod:${id}`]: mod, mods: [id], [key]: placements });
    }, { defaults: D.GZ_DEFAULTS, motion, mod, key: stickerKey, placements, id: MOD });
    await seed('subtle');
    page = await open();
    check('a mod\'s stickers are drawn on the page: an animated picture and a Lottie animation', await waitFor(page, "document.querySelectorAll('#gz-stickers .gz-stk').length === 2 && !!document.querySelector('#gz-stickers canvas')"), 'no stickers');
    const art = await isolated(page, "JSON.stringify([...document.querySelectorAll('#gz-stickers .gz-stk')].map((s) => s.firstChild.tagName + ':' + (s.firstChild.src || '').slice(0, 5)))");
    check('  the picture is an img of a blob the page made from the worker\'s cleaned copy, the animation a Lottie canvas', art === JSON.stringify(['IMG:blob:', 'DIV:']), art);
    const stickerColours = [];
    for (let i = 0; i < 14; i++) { stickerColours.push(await pixel(page, 256, 160)); await sleep(60); }
    check('  the animated WebP sticker moves (more than one of its frames is on screen)', new Set(stickerColours.map((c) => FRAMES.findIndex((f) => near(f, c, 30))).filter((i) => i >= 0)).size >= 2, JSON.stringify(stickerColours));
    await shot(page, 'stickers');
    check('  a mod\'s sticker is placed through the stickers\' own storage, as a placement the cleaner takes', (await opts.evaluate(async (k) => (await chrome.storage.local.get(k))[k].length, stickerKey)) === 2, '');
    await page.close();
    // Motion off: frame 0 of the picture (a canvas) and of the animation.
    await seed('off');
    page = await open();
    await waitFor(page, "document.querySelectorAll('#gz-stickers .gz-stk').length === 2 && !!document.querySelector('#gz-stickers canvas')");
    await sleep(600);
    const stickerStill = [];
    for (let i = 0; i < 6; i++) { stickerStill.push(await pixel(page, 256, 160)); await sleep(90); }
    check('motion off: the animated sticker holds its first frame in a canvas', stickerStill.every((c) => near(c, FRAMES[0], 30)) && (await isolated(page, "document.querySelector('#gz-stickers .gz-stk canvas') ? 'canvas' : 'no canvas'")) === 'canvas', JSON.stringify(stickerStill));
    await page.close();
    // The mod turned off: the placements stay, nothing is drawn for them.
    await seed('subtle', record({ enabled: false }));
    page = await open();
    await waitFor(page, "document.querySelectorAll('#gz-stickers .gz-stk').length === 2");
    await sleep(500);
    check('the mod turned off: its stickers are not drawn, and the placements wait for it', (await isolated(page, "document.querySelectorAll('#gz-stickers img, #gz-stickers canvas').length")) === 0 && (await opts.evaluate(async (k) => (await chrome.storage.local.get(k))[k].length, stickerKey)) === 2, '');
    await page.close();
    // A pack file that is not a picture: refused by the worker, so nothing is drawn.
    await seed('subtle', record({ files: { ...record().files, 'wave.webp': Buffer.from('not a picture').toString('base64') } }));
    page = await open();
    await waitFor(page, "document.querySelectorAll('#gz-stickers .gz-stk').length === 2");
    await sleep(500);
    const bad1 = await isolated(page, "JSON.stringify([...document.querySelectorAll('#gz-stickers .gz-stk')].map((s) => s.firstChild.tagName + '.' + s.firstChild.className))");
    check('a sticker file that is not what it says is not drawn (the other one still is)', bad1 === JSON.stringify(['SPAN.gz-stk-gone', 'DIV.gz-stk-lottie']), bad1);
    await page.close();

    // The pet: listed in the editor's pet library, added through the import's own checks, then in the library.
    await seed('subtle');
    const pets = await context.newPage();
    pets.on('pageerror', (e) => errors.push(`editor: ${e.message}`));
    await pets.goto(`chrome-extension://${id}/options.html#study/pet`);
    await pets.locator('#pet-library').scrollIntoViewIfNeeded(); // the library loads when it is on screen
    check('the pet library lists the pet a mod carries', await pets.waitForFunction(() => /Pets from your mods/.test(document.getElementById('pet-library')?.textContent || '') && /Mochi 2 · Garden/.test(document.getElementById('pet-library').textContent), null, { timeout: 15000 }).then(() => true, () => false), (await pets.locator('#pet-library').textContent()).slice(0, 200));
    await pets.evaluate(() => [...document.querySelectorAll('#pet-library button')].find((b) => /Add to my pets/.test(b.textContent)).click());
    await sleep(800);
    check('a click a page script made adds nothing (only a real press does)', Object.keys(await pets.evaluate(async () => (await chrome.storage.local.get('petSprites')).petSprites || {})).length === 0, '');
    await pets.getByRole('button', { name: /Add to my pets/ }).click();
    let added = null;
    for (let i = 0; i < 40 && !added; i++) { added = await pets.evaluate(async () => Object.values((await chrome.storage.local.get('petSprites')).petSprites || {}).find((p) => p.from === 'abcdefghijklmnop/mochi')); await sleep(250); }
    check('  adding it puts a re-encoded pet in the library, marked with where it came from', !!added && /^data:image\/webp/.test(added.data) && added.name === 'Mochi 2' && added.spriteVersionNumber === 2, JSON.stringify(added)?.slice(0, 200));
    check('  and the mods list now says it is added', await pets.waitForFunction(() => /Mochi 2 · Garden Added/.test(document.getElementById('pet-library').textContent), null, { timeout: 10000 }).then(() => true, () => false), (await pets.locator('#pet-library').textContent()).slice(-300));
    await pets.close();

    // ---- a mod's own background file ----------------------------------------------------------------------------------
    // An animated WebP in the mod's bundle, laid over the Look as `mod:<id>/bg/a.webp` and asked of the worker, cleaned.
    // The student's own background differs: the mod must replace its CSS kind too, so its pixels stay visible.
    const bgMod = (media, files) => record({ manifest: { ...record().manifest, packs: undefined, parts: { bg: { media } } }, files });
    const seedBg = async (mod, kind = 'solid') => { await seed('subtle', mod); await opts.evaluate(async (bg) => chrome.storage.sync.set({ bg }), { ...D.GZ_DEFAULTS.bg, kind, image: url('still.webp'), blur: 12 }); };
    await seedBg(bgMod({ type: 'image', src: './bg/a.webp', fit: 'fill', dim: 0 }, { 'bg/a.webp': b64('anim.webp') }));
    page = await open();
    check('a mod\'s bundled animated picture is its background', await sceneThere(page) && await waitFor(page, "document.querySelector('#gz-scene img')?.complete"), 'no scene');
    check('  it replaces the solid CSS background kind and clears the student\'s blur', await page.evaluate(() => document.documentElement.dataset.gzBg === 'media' && document.documentElement.style.getPropertyValue('--gz-bg-blur') === '0px'), 'kind or blur');
    check('  it is an img of a blob the page made from the worker\'s cleaned copy', (await isolated(page, "(document.querySelector('#gz-scene img')?.currentSrc || '').slice(0, 5)")) === 'blob:', 'src');
    const modColours = [];
    for (let i = 0; i < 14; i++) { modColours.push(await pixel(page, 900, 600)); await sleep(60); }
    check('  it moves (more than one of its frames on screen)', new Set(modColours.map((c) => FRAMES.findIndex((f) => near(f, c, 30))).filter((i) => i >= 0)).size >= 2, JSON.stringify(modColours));
    await shot(page, 'mod-image');
    await page.close();
    await seedBg(bgMod({ type: 'lottie', src: './spin.json', fit: 'cover', dim: 0 }, { 'spin.json': b64('spin.json') }), 'image');
    page = await open();
    check('a mod\'s bundled Lottie file is its background, drawn by the player', await sceneThere(page) && await waitFor(page, "document.querySelector('#gz-scene canvas')"), 'no canvas');
    await sleep(300);
    check('  the red box is on screen', !!(await redSpan(page)), 'no red');
    await page.close();
    await seedBg(bgMod({ type: 'image', src: './bg/a.webp', fit: 'fill', dim: 0 }, { 'bg/a.webp': b64('anim.webp') }));
    await opts.evaluate(async (id) => { const k = `mod:${id}`; const r = (await chrome.storage.local.get(k))[k]; await chrome.storage.local.set({ [k]: { ...r, enabled: false } }); }, MOD);
    page = await open();
    await sleep(2000);
    check('the mod turned off: no background from its file', (await isolated(page, "!document.getElementById('gz-scene')")) === true, 'scene');
    await page.close();

    // ---- a gallery Look's file -----------------------------------------------------------------------------------------
    const cleaned = Buffer.from(M.check(new Uint8Array(fs.readFileSync(path.join(fixtures, 'anim.webp'))), 'bg').bytes);
    const good = await M.sha(new Uint8Array(cleaned)), wrong = 'B'.repeat(43);
    galleryFiles.set(good, cleaned).set(wrong, fs.readFileSync(path.join(fixtures, 'still.webp')));
    const useLook = async (h) => {
      await wipe();
      const code = await S.encode(D.GZ_SANITIZE({ bg: { kind: 'media' } }), {}, { x: { bg: { media: { type: 'image', src: `file:${h}`, fit: 'fill', dim: 0 } } } });
      galleryPage = `<!doctype html><title>Looks</title><a href="/glaze/looks/how" data-glaze-use data-code="${code}" data-name="Spin" data-author="kai">Use this Look in Glaze</a>`;
      // The editor already open (opts) takes the offer: openOptionsPage reuses its tab.
      const g = await context.newPage();
      g.on('pageerror', (e) => errors.push(`gallery: ${e.message}`));
      await g.goto('https://frostdev.io/glaze/looks/');
      await g.click('a[data-glaze-use]');
      const e = opts;
      await g.close();
      await e.waitForFunction(() => !document.getElementById('share-offer').hidden, null, { timeout: 15000 });
      return e;
    };
    await ed.close();
    let ged = await useLook(good);
    const keptGallery = await opts.evaluate(async (h) => (await chrome.runtime.sendMessage({ type: 'glaze:keptFile', h }))?.mime, good);
    check('Use this Look: the worker fetched the Look\'s file from the gallery and kept it by its name', galleryAsked.includes(good) && keptGallery === 'image/webp', JSON.stringify([galleryAsked, keptGallery]));
    check('  the editor previews the Look with that file as its background', await ged.waitForFunction(() => !!document.getElementById('preview')?.contentDocument?.querySelector('#gz-scene img, #gz-scene canvas'), null, { timeout: 15000 }).then(() => true, () => false), 'no scene in the preview');
    if (out) await ged.screenshot({ path: path.join(out, 'gallery-look.png') });
    ged = await useLook(wrong);
    const keptWrong = await opts.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'glaze:media', op: 'list' }))?.files?.map((f) => f.h) || []);
    check('a file that is not the one the Look names: asked for, not kept, and the Look is still offered', galleryAsked.includes(wrong) && keptWrong.length === 0, JSON.stringify(keptWrong));
    await sleep(2000);
    check('  the preview shows no background from it', await ged.evaluate(() => !document.getElementById('preview')?.contentDocument?.querySelector('#gz-scene img, #gz-scene video')), 'scene');

    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
    assert.deepEqual(blocked.filter((u) => !/ultra-cdn\.invalid/.test(u)), [], 'no request left the fixture');
  } catch (e) {
    failure = e;
  } finally {
    await context?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  const bad = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ chrome: process.env.CHROME || "Playwright's bundled Chromium", passed: results.length - bad.length, failed: bad.length, failures: bad }, null, 1));
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
  if (failure) { console.error(failure); process.exitCode = 1; } else process.exitCode = bad.length ? 1 : 0;
  console.log(`${results.length - bad.length} checks passed; ${bad.length} failed${failure ? '; ' + failure.message : ''}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
