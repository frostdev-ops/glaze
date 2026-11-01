// One shipped model (ai/local/models.json) downloaded for real: Glaze loaded unpacked in Chromium, ai/local/store.js's
// default catalog in an extension page, the file fetched from huggingface.co through its redirect to HF's CDN, each chunk
// checked against its SHA-256 as it lands, then every kept chunk rehashed (verify) and the whole file's SHA-256 taken
// from what the store kept, against the manifest's `total`. Live network and the model's full size: run it on the runner.
//   node checks/ai/local-model-live-check.js [evidence folder] [model id, default rime-1.7b-q4_k_m]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const env = require('../../tools/dev/check-env.js'), chromeLaunch = require('../../tools/dev/check-env.js').chromeLaunch();
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-local-model-live-')));
const ID = process.argv[3] || 'rime-1.7b-q4_k_m';
fs.mkdirSync(out, { recursive: true });
const entry = require('../../extension/ai/local/models.json').models.find((m) => m.id === ID);
if (!entry) { console.error(`${ID} is not in models.json`); process.exit(2); }

const results = [];
const ok = (value, label, detail) => { results.push({ label, pass: !!value, ...(detail !== undefined && { detail }) }); if (!value) throw new Error(`FAIL ${label}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`); console.log(`ok   ${label}`); };
const bare = (u) => { const x = new URL(u); return `${x.origin}${x.pathname}`; };

(async () => {
  let context, profile;
  const log = [];
  const started = Date.now();
  try {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-local-model-live-profile-'));
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, { ...chromeLaunch, headless: true,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--disable-background-networking'] });
    env.noFirstRun(context);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (u.protocol !== 'https:') return;
      const h = r.headers();
      log.push({ status: r.status(), url: bare(r.url()), range: r.request().headers().range || null, acao: h['access-control-allow-origin'] || null, ...(h.location && { location: bare(h.location) }) });
    });
    page.on('requestfailed', (r) => log.push({ failed: bare(r.url()), why: r.failure()?.errorText }));
    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.addScriptTag({ url: `chrome-extension://${id}/ai/local/store.js` });

    const listed = await page.evaluate(async (want) => (await GZ_AI_STORE.list()).find((m) => m.id === want), ID);
    ok(listed && listed.state === 'missing' && listed.size === entry.size, `the default catalog lists ${ID}, not downloaded`, listed);

    const t0 = Date.now();
    const done = await page.evaluate(async (want) => {
      const marks = [];
      try {
        const r = await GZ_AI_STORE.download(want, { onProgress: (p) => { if (!marks.length || p - marks.at(-1) >= 0.1 || p === 1) marks.push(p); } });
        return { result: r, marks };
      } catch (e) { return { error: { reason: e.reason, message: String(e.message) }, marks }; }
    }, ID);
    const seconds = (Date.now() - t0) / 1000;
    ok(!done.error && done.result?.state === 'ready', `downloaded through store.js, every chunk's SHA-256 checked as it landed (${seconds.toFixed(0)} s)`, done);

    const hf = log.filter((l) => l.url === entry.url);
    const cdn = log.filter((l) => l.status === 206 && l.url !== entry.url);
    ok(hf.length && hf.every((l) => l.status === 302 && l.location && new URL(l.location).hostname.endsWith('.hf.co') && l.acao === `chrome-extension://${id}`),
      'huggingface.co answered each Range request with a 302 to its CDN, allowing the extension origin', hf.slice(0, 3));
    const hosts = [...new Set(cdn.map((l) => new URL(l.url).hostname))];
    ok(cdn.length >= entry.sha256.length && hosts.every((h) => h.endsWith('.hf.co')) && cdn.every((l) => l.acao === '*'), `the CDN (${hosts.join(', ')}) served the chunks as 206 with Access-Control-Allow-Origin *`, { replies: cdn.length, chunks: entry.sha256.length, hosts });

    const verified = await page.evaluate((want) => GZ_AI_STORE.verify(want), ID);
    ok(verified.state === 'ready', `verify rehashed all ${entry.sha256.length} kept chunks against models.json`, verified);

    // The whole file, read back from the store in slices and hashed here.
    const hash = crypto.createHash('sha256');
    let read = 0;
    await page.evaluate(async (want) => { window.F = await GZ_AI_STORE.open(want); }, ID);
    const SLICE = 16 << 20;
    for (let at = 0; at < entry.size; at += SLICE) {
      const b64 = await page.evaluate(async ([a, n]) => {
        const u = await window.F.read(a, n);
        let s = '';
        for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
        return btoa(s);
      }, [at, Math.min(SLICE, entry.size - at)]);
      const buf = Buffer.from(b64, 'base64');
      hash.update(buf); read += buf.length;
    }
    const whole = hash.digest('hex');
    ok(read === entry.size && whole === entry.total, `the whole file: ${read} bytes, SHA-256 ${whole} = models.json's total`, { read, whole, total: entry.total });

    const evidence = { id: ID, url: entry.url, size: entry.size, chunks: entry.sha256.length, total: entry.total, whole, read, seconds, results, requests: log.length, sample: log.slice(0, 6) };
    fs.writeFileSync(path.join(out, 'local-model-live-check.json'), JSON.stringify(evidence, null, 2));
    console.log(`PASS ${results.length} checks in ${((Date.now() - started) / 1000).toFixed(0)} s (evidence ${path.join(out, 'local-model-live-check.json')})`);
  } catch (e) {
    fs.writeFileSync(path.join(out, 'local-model-live-check.json'), JSON.stringify({ id: ID, results, error: String(e.stack || e), log: log.slice(-40) }, null, 2));
    console.error(e.stack || e);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => {});
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  }
})();
