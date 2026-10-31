// The CPU rate ultra-perf-check.js throttles to under PERF_DEVICE=neo: Speedometer 3.1 in this machine's headless Chromium,
// pinned to 6 cores like the check, against the MacBook Neo's Chrome score. Run it on the Linux runner:
//   glaze-remote -o <dir> -- node checks/courses/neo-calibrate.js /out
// SPEEDOMETER_DIR uses a local copy of github.com/WebKit/Speedometer (branch release/3.1); else it is cloned into a temp
// folder. SPEEDOMETER_ITERATIONS defaults to 10, as on browserbench.org. Record the result in ultra-perf-check.js.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { execFileSync } = require('node:child_process');
const chromeLaunch = require('../../tools/dev/check-env.js').chromeLaunch();
const { NEO_CHROME_SPEEDOMETER, NEO_CHROME_SOURCE, pinCores } = require('./ultra-perf-check.js');
const output = path.resolve(process.argv[2] || os.tmpdir(), 'neo-calibrate.json');
const iterations = Number(process.env.SPEEDOMETER_ITERATIONS || 10);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-neo-calibrate-'));
  let server, context;
  try {
    let root = process.env.SPEEDOMETER_DIR;
    if (!root) {
      root = path.join(scratch, 'speedometer');
      execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', 'release/3.1', 'https://github.com/WebKit/Speedometer', root], { stdio: 'inherit' });
    }
    const commit = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } })();
    root = fs.realpathSync(root);
    server = http.createServer((req, res) => {
      const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const pinned = pinCores();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), { ...chromeLaunch, headless: true, viewport: { width: 1280, height: 800 }, args: ['--disable-background-networking'] });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?startAutomatically&iterationCount=${iterations}`);
    // Polled from Node: the benchmark sets _hasResults once its last iteration (or an error) is in.
    for (const end = Date.now() + 25 * 60e3; !(await page.evaluate(() => globalThis.benchmarkClient?._hasResults)); await new Promise((r) => setTimeout(r, 2000))) {
      if (Date.now() > end) throw new Error('Speedometer did not finish in 25 minutes');
    }
    const score = Number(await page.locator('#result-number').textContent());
    if (!Number.isFinite(score)) throw new Error('Speedometer reported an invalid score');
    const rate = score / NEO_CHROME_SPEEDOMETER;
    const result = { date: new Date().toISOString(), commit, iterations, pinned, cores: os.cpus().length, cpu: os.cpus()[0]?.model, browser: await page.evaluate(() => navigator.userAgent),
      runnerScore: score, neoChromeScore: NEO_CHROME_SPEEDOMETER, neoSource: NEO_CHROME_SOURCE, rate: Math.max(1, Number(rate.toFixed(2))), rawRate: rate };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (rate < 1) console.log('This machine is slower than a MacBook Neo in Chrome: use rate 1.');
  } finally {
    await context?.close();
    server?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
