// What a media background costs, measured: the CPU a window of seconds takes in the whole browser (every process of the profile,
// summed from `ps`, so the video decoder, the compositor and the GPU process count) and on the page's main thread (CDP
// Performance.getMetrics), for a plain background, a 1280x720 video, a 640x360 animated WebP, and two Lottie animations (a small one and
// a heavy one at the limits' edge), each playing, with motion off and while the tab is hidden. Software rendering in headless Chrome,
// so the numbers are an upper bound for a machine with a GPU; the point is the ratios: motion off and a hidden tab must cost what a plain
// background costs, and playing must be something a page can carry. Needs ffmpeg and img2webp for the realistic files; without them the
// Lottie rows still run.
//   nice -n 10 NODE_PATH=/path/to/node_modules node scripts/media-cost-check.js
// One headless browser at a time across agents: it waits while another runs. The profile and the files are temporary.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const ext = fs.realpathSync(path.join(__dirname, '..'));
const chrome = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const origin = 'https://ultra.fixture.test';
const D = require(path.join(ext, 'defaults.js'));
const P = require(path.join(ext, 'lib/lookparts.js'));
const M = require(path.join(ext, 'lib/media.js'));
const fixture = '<!doctype html><html lang="en"><head><base href="//ultra-cdn.invalid/ultra/uiv4001.0.0-rel/"><meta charset="utf-8"><title>Ultra fixture</title></head><body><div id="site-wrap"><nav id="base_tools"><a href="/ultra/institution-page"><span>Institution Page</span></a><a href="/ultra/course">Courses</a></nav><main id="main-content"><div id="main-content-inner"><h1>Stream</h1></div></main></div></body></html>';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const have = (cmd) => spawnSync('which', [cmd]).status === 0;

// A Lottie file of `n` layers, each a rounded box that slides, scales and fades, the way a busy decorative animation does.
const lottie = (n) => ({ v: '5.7.0', fr: 30, ip: 0, op: 90, w: 1280, h: 720, nm: `${n} boxes`, ddd: 0, assets: [], layers: Array.from({ length: n }, (_, i) => ({
  ddd: 0, ind: i + 1, ty: 4, nm: `box ${i}`, sr: 1, ip: 0, op: 90, st: 0, bm: 0, ao: 0,
  ks: { o: { a: 1, k: [{ t: 0, s: [0], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } }, { t: 45, s: [90], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } }, { t: 90, s: [0] }] }, r: { a: 0, k: 0 },
    p: { a: 1, k: [{ t: 0, s: [80 + (i * 97) % 1100, 60 + (i * 53) % 600, 0], i: { x: 0.5, y: 1 }, o: { x: 0.5, y: 0 } }, { t: 90, s: [160 + (i * 61) % 1000, 120 + (i * 89) % 520, 0] }] },
    a: { a: 0, k: [0, 0, 0] }, s: { a: 1, k: [{ t: 0, s: [60, 60, 100], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } }, { t: 90, s: [140, 140, 100] }] } },
  shapes: [{ ty: 'gr', it: [{ ty: 'rc', d: 1, s: { a: 0, k: [90, 90] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 16 } }, { ty: 'fl', c: { a: 0, k: [0.2 + (i % 5) * 0.15, 0.5, 0.9 - (i % 4) * 0.2, 1] }, o: { a: 0, k: 100 }, r: 1 }, { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }], nm: 'g' }] })) });

(async () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-media-cost-')));
  const media = {};
  const small = lottie(8), heavy = lottie(300);
  for (const [name, json] of [['small.json', small], ['heavy.json', heavy]]) {
    const got = M.lottie(JSON.stringify(json));
    if (!got) throw new Error(`${name} is over the Lottie limits: it would not be kept`);
    fs.writeFileSync(path.join(scratch, name), got.bytes);
    media[name] = 'application/json';
  }
  if (have('ffmpeg')) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=5', '-c:v', 'libvpx-vp9', '-b:v', '1500k', '-deadline', 'realtime', '-cpu-used', '8', path.join(scratch, 'big.webm')]);
    media['big.webm'] = 'video/webm';
    if (have('img2webp')) {
      for (let i = 0; i < 20; i++) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=1:duration=1,hue=h=${i * 18}`, '-frames:v', '1', path.join(scratch, `f${String(i).padStart(2, '0')}.png`)]);
      execFileSync('img2webp', ['-lossy', '-q', '60', '-d', '50', '-loop', '0', ...Array.from({ length: 20 }, (_, i) => path.join(scratch, `f${String(i).padStart(2, '0')}.png`)), '-o', path.join(scratch, 'anim.webp')]);
      media['anim.webp'] = 'image/webp';
    }
  }
  const results = [];
  let context;
  try {
    const profile = path.join(scratch, 'profile');
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chrome, headless: true, viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(20000);
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.origin !== origin) return r.abort();
      if (u.pathname.startsWith('/ultra')) return r.fulfill({ contentType: 'text/html', body: fixture });
      if (u.pathname.startsWith('/learn/api/')) return r.fulfill({ json: u.pathname.endsWith('/users/me') ? { id: '_900_1' } : { results: [] } });
      const file = path.join(scratch, path.basename(u.pathname));
      if (u.pathname.startsWith('/media/') && fs.existsSync(file)) {
        const body = fs.readFileSync(file), type = media[path.basename(file)];
        const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '');
        if (range) { const from = +range[1], to = range[2] ? Math.min(+range[2], body.length - 1) : body.length - 1; return r.fulfill({ status: 206, headers: { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${from}-${to}/${body.length}` }, body: body.subarray(from, to + 1) }); }
        return r.fulfill({ status: 200, headers: { 'content-type': type, 'accept-ranges': 'bytes' }, body });
      }
      return r.abort();
    });
    // The editor's live preview would keep playing while the measured tab is hidden.
    const opts = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const store = (bg, lookX, motion) => opts.evaluate(async ({ defaults, bg, lookX, motion }) => {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set({ ...defaults, bg, lookX, motion: { ...defaults.motion, level: motion, followSystem: false } });
    }, { defaults: D.GZ_DEFAULTS, bg: { ...D.GZ_DEFAULTS.bg, ...bg }, lookX, motion });
    // CPU seconds of every process of this profile, from ps (cputime is 0:12.34 or 1:02:03.45).
    const cpu = () => {
      const out = execFileSync('ps', ['-ax', '-o', 'time=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 });
      let total = 0;
      for (const line of out.split('\n')) {
        if (!line.includes(profile)) continue;
        const m = /^\s*(?:(\d+):)?(\d+):(\d+\.\d+)/.exec(line);
        if (m) total += (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + +m[3];
      }
      return total;
    };
    const rows = [['plain background', null, 'subtle']];
    if (media['big.webm']) rows.push(['video 1280x720 VP9, playing', { type: 'video', src: `${origin}/media/big.webm`, fit: 'cover' }, 'subtle'], ['video, motion off', { type: 'video', src: `${origin}/media/big.webm` }, 'off']);
    if (media['anim.webp']) rows.push(['animated WebP 640x360 x 20, playing', { type: 'image', src: `${origin}/media/anim.webp`, fit: 'cover' }, 'subtle'], ['animated WebP, motion off', { type: 'image', src: `${origin}/media/anim.webp` }, 'off']);
    rows.push(['Lottie, 8 layers, playing', { type: 'lottie', src: `${origin}/media/small.json`, fit: 'cover' }, 'subtle'], ['Lottie, 8 layers, motion off', { type: 'lottie', src: `${origin}/media/small.json` }, 'off'],
      ['Lottie, 300 layers (the limit is 500), playing', { type: 'lottie', src: `${origin}/media/heavy.json`, fit: 'cover' }, 'subtle'], ['Lottie, 300 layers, motion off', { type: 'lottie', src: `${origin}/media/heavy.json` }, 'off']);
    // Keeping options.html open would animate its preview too and charge that work to the hidden LMS tab.
    if (context.pages().some((p) => p.url().startsWith('chrome-extension:'))) throw new Error('an extension preview would contaminate the CPU sample');
    const WINDOW = 6000;
    for (const [name, spec, motion] of rows) {
      await store(spec ? { kind: 'media' } : { kind: 'solid' }, spec ? await P.pack({ x: { bg: { media: spec } } }) : '', motion);
      const page = await context.newPage();
      await page.goto(`${origin}/ultra/stream`);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-font'));
      if (spec) await page.waitForFunction(() => !!document.getElementById('gz-scene')?.firstChild, null, { timeout: 15000 }).catch(() => {});
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
      for (const hidden of spec ? [false, true] : [false]) {
        if (spec) {
          const world = await context.newCDPSession(page);
          const seen = [];
          world.on('Runtime.executionContextCreated', (e) => seen.push(e.context));
          await world.send('Runtime.enable');
          const w = seen.find((x) => x.origin === `chrome-extension://${id}`);
          if (w) await world.send('Runtime.evaluate', { contextId: w.id, expression: `Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${hidden} }); document.dispatchEvent(new Event('visibilitychange'));` });
        }
        await sleep(2000);
        const a = await metric(), c0 = cpu(), t0 = Date.now();
        await sleep(WINDOW);
        const b = await metric(), c1 = cpu(), t1 = Date.now();
        results.push({ name: hidden ? `${name}, tab hidden` : name, browserCpuPct: Math.round(((c1 - c0) / ((t1 - t0) / 1000)) * 100), mainThreadPct: Math.round(((b.TaskDuration - a.TaskDuration) / ((b.Timestamp - a.Timestamp) || 1)) * 1000) / 10, scriptPct: Math.round(((b.ScriptDuration - a.ScriptDuration) / ((b.Timestamp - a.Timestamp) || 1)) * 1000) / 10 });
      }
      await page.close();
    }
  } finally {
    await context?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  const base = results[0];
  console.log(JSON.stringify({ chrome: 'Chrome for Testing (Playwright chromium-1243), headless, software rendering, 1280x800', window: '6 s after 2 s of warmup', results }, null, 1));
  for (const r of results) console.log(`${r.name.padEnd(56)} browser ${String(r.browserCpuPct).padStart(4)}% of one core   main thread ${String(r.mainThreadPct).padStart(5)}%   script ${String(r.scriptPct).padStart(5)}%`);
  // Motion off must cost what a plain background costs, in the whole browser, within the noise of a few percent of a core. Hidden is
  // emulated (the page itself is still visible to the browser, so its compositor and an <img> carry on, as no real hidden tab's would):
  // what Glaze controls is the page's own work. A Lottie renderer must also release its composited canvas while paused.
  const still = results.filter((r) => /motion off/.test(r.name) && !/hidden/.test(r.name)).filter((r) => r.browserCpuPct > base.browserCpuPct + 5);
  const hidden = results.filter((r) => /hidden/.test(r.name)).filter((r) => r.scriptPct > 0.5 || r.mainThreadPct > base.mainThreadPct + 1 || (/Lottie/.test(r.name) && r.browserCpuPct > base.browserCpuPct + 5));
  for (const [why, list] of [['motion off costs more than a plain background', still], ['a hidden tab still runs script, the main thread or the Lottie compositor', hidden]]) {
    if (list.length) { console.log(`FAIL ${why}: ${list.map((r) => r.name).join('; ')}`); process.exitCode = 1; }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
