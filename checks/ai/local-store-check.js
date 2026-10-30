// lib/ai/local/store.js in Chromium with Glaze loaded unpacked: real OPFS, fetch and crypto.subtle in an extension page.
// The check plays Hugging Face: huggingface.co's resolve URL answers 302 to us.aws.cdn.hf.co, which answers 206 Range
// replies with `Access-Control-Allow-Origin: *`, as probe 4 measured live. A 4.5 MiB "model" in 1 MiB chunks downloads,
// is cancelled after two chunks, resumes with only the rest (one chunk corrupted once on the way, refetched), verifies,
// is read in slices (also from a dedicated Worker), and is removed. A redirect to another host is refused. A remove from a
// second page ends the first page's download as removed. The shipped
// models.json loads as the default catalog. Everything else the browser asks for is aborted.
//   NODE_PATH=<playwright> node checks/ai/local-store-check.js [evidence folder]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const env = require('../../tools/dev/check-env.js'), lock = require('../../tools/dev/check-env.js').lockPath(), chromeLaunch = require('../../tools/dev/check-env.js').chromeLaunch();
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-local-store-')));
fs.mkdirSync(out, { recursive: true });

const CHUNK = 1 << 20, SIZE = 4 * CHUNK + 512 * 1024, COMMIT = 'c'.repeat(40);
const DATA = crypto.randomBytes(SIZE);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const entry = (id, file) => {
  const sums = [];
  for (let at = 0; at < SIZE; at += CHUNK) sums.push(sha(DATA.subarray(at, at + CHUNK)));
  return { id, name: id, repo: 'glaze-check/Tiny-GGUF', commit: COMMIT, file, url: `https://huggingface.co/glaze-check/Tiny-GGUF/resolve/${COMMIT}/${file}`,
    size: SIZE, chunk: CHUNK, sha256: sums, total: sha(DATA), license: 'lfm1.0', quant: 'Q4_K_M', tier: 1, stock: true };
};
const HOSTS = ['huggingface.co', 'us.aws.cdn.hf.co', 'evil.example'];
const MODELS = [entry('tiny', 'tiny.gguf'), entry('evil', 'evil.gguf')];

let checks = 0;
const results = [];
const ok = (value, label, detail) => { results.push({ label, pass: !!value, ...(detail !== undefined && { detail }) }); if (!value) throw new Error(`FAIL ${label}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`); checks++; console.log(`ok   ${label}`); };

(async () => {
  let context, profile, held = false;
  let server, tls;
  const log = []; // every request the check's server answered
  const corrupt = { 3: 1 }; // chunk 3's first reply has a flipped byte
  let hold = null, letGo = () => {}; // while set, the CDN keeps chunk 2's reply
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    while (!held) { try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); } }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nlocal-store-check\n`);
    // huggingface.co, its CDN and a foreign host, all this process's TLS server (a fulfilled 302 would send the next hop
    // past Playwright's route to the real network). The resolver rule keeps the URLs as HF's, port and all.
    tls = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-local-store-tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=huggingface.co',
      '-keyout', path.join(tls, 'k.pem'), '-out', path.join(tls, 'c.pem')], { stdio: 'ignore' });
    server = https.createServer({ key: fs.readFileSync(path.join(tls, 'k.pem')), cert: fs.readFileSync(path.join(tls, 'c.pem')) }, async (req, res) => {
      const host = (req.headers.host || '').replace(/:\d+$/, ''), u = new URL(req.url, `https://${host}`), h = req.headers;
      log.push({ method: req.method, host, path: u.pathname, range: h.range || null, origin: h.origin || null, cookie: !!h.cookie });
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range', 'access-control-expose-headers': '*' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (host === 'huggingface.co' && u.pathname.startsWith('/glaze-check/Tiny-GGUF/resolve/')) {
        const to = u.pathname.endsWith('/evil.gguf') ? 'https://evil.example/x' : `https://us.aws.cdn.hf.co/xet-bridge-us/check/${u.pathname.split('/').pop()}?Expires=1&Signature=s`;
        res.writeHead(302, { location: to, 'access-control-allow-origin': h.origin || '*', 'access-control-expose-headers': 'X-Repo-Commit,ETag,Accept-Ranges,Content-Range' });
        return res.end();
      }
      if (host === 'us.aws.cdn.hf.co' || host === 'evil.example') {
        const m = /^bytes=(\d+)-(\d+)$/.exec(h.range || '');
        if (!m) { res.writeHead(200, cors); return res.end(DATA); }
        const a = +m[1], b = Math.min(+m[2], SIZE - 1);
        const body = Buffer.from(DATA.subarray(a, b + 1));
        const n = Math.floor(a / CHUNK);
        if (hold && n === 2) await hold;
        if (corrupt[n] > 0) { corrupt[n]--; body[17] ^= 0xff; }
        res.writeHead(206, { ...cors, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${SIZE}`, 'content-type': 'application/octet-stream', 'content-length': body.length });
        return res.end(body);
      }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-local-store-profile-'));
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, {
      ...chromeLaunch, headless: true,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--disable-background-networking',
        `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(',')}`, '--ignore-certificate-errors'],
    });
    env.noFirstRun(context);
    context.on('requestfailed', (r) => log.push({ failed: r.url().slice(0, 120), why: r.failure()?.errorText }));

    await context.route('**/*', (route) => {
      const u = new URL(route.request().url());
      return u.protocol === 'chrome-extension:' || HOSTS.includes(u.hostname) ? route.continue() : route.abort();
    });

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`chrome-extension://${id}/popup.html`); // no meta CSP of its own (allow.html's says connect-src 'none')
    await page.addScriptTag({ url: `chrome-extension://${id}/lib/ai/local/store.js` });
    await page.evaluate((models) => { window.S = GZ_AI_STORE.create({ models }); window.seen = []; }, MODELS);

    ok((await page.evaluate(() => S.status('tiny'))).state === 'missing', 'a new profile has no model');

    // Cancel once two chunks are kept.
    const cut = await page.evaluate(async (chunk) => {
      const c = new AbortController();
      try {
        await S.download('tiny', { signal: c.signal, onProgress: (p) => { seen.push(p); if (p * 4.5 >= 2 - 1e-9 && !c.signal.aborted) c.abort(); } });
        return { done: true };
      } catch (e) {
        // The caller's wait ends at its cancel; a chunk that had arrived is still checked and written. Wait on the state.
        let status;
        for (const end = Date.now() + 30000; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if ((status = await S.status('tiny')).bytes === 2 * chunk) break;
        return { reason: e.reason, message: String(e.message), status, later: await S.status('tiny') };
      }
    }, CHUNK);
    ok(cut.reason === 'aborted' && cut.status.state === 'partial' && cut.status.bytes === 2 * CHUNK && cut.later.bytes === 2 * CHUNK, 'cancelled after two chunks: both kept', cut);
    const first = log.filter((l) => l.host === 'us.aws.cdn.hf.co' && l.method === 'GET').map((l) => l.range);
    ok(first[0] === `bytes=0-${CHUNK - 1}` && first[1] === `bytes=${CHUNK}-${2 * CHUNK - 1}`, 'Range requests by chunk through the 302', first);
    const hf = log.filter((l) => l.host === 'huggingface.co');
    ok(hf.length >= 2 && hf.every((l) => l.path === `/glaze-check/Tiny-GGUF/resolve/${COMMIT}/tiny.gguf`), 'every chunk asks the pinned resolve URL again', hf.map((l) => l.path));

    // Resume in a fresh store (as a restarted worker would), with chunk 3 corrupted on its first reply.
    const mark = log.length;
    const resumed = await page.evaluate(async (models) => {
      const s2 = GZ_AI_STORE.create({ models }), p = [];
      const r = await s2.download('tiny', { onProgress: (x) => p.push(x) });
      return { r, first: p[0], last: p.at(-1), climbs: p.every((x, i) => !i || x >= p[i - 1]), status: await s2.status('tiny'), verify: await s2.verify('tiny') };
    }, MODELS);
    ok(resumed.r.state === 'ready' && resumed.status.state === 'ready' && resumed.verify.state === 'ready', 'resumed to ready and verified', resumed);
    ok(Math.abs(resumed.first - 2 / 4.5) < 1e-9 && resumed.last === 1 && resumed.climbs, 'progress resumes from the kept bytes and climbs to 1', resumed);
    const second = log.slice(mark).filter((l) => l.host === 'us.aws.cdn.hf.co' && l.method === 'GET').map((l) => Math.floor(+/=(\d+)/.exec(l.range)[1] / CHUNK));
    ok(JSON.stringify(second) === '[2,3,3,4]', 'only the missing chunks fetched, the corrupted one twice', second);
    const preflights = log.filter((l) => l.method === 'OPTIONS').length;

    // Slices, against the bytes served.
    const cases = [[0, 16], [CHUNK - 8, 16], [123457, 2 * CHUNK + 999], [SIZE - 5, 5], [0, SIZE]];
    const got = await page.evaluate(async ([list, size]) => {
      const m = await S.open('tiny');
      const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
      const out = [];
      for (const [o, n] of list) { const b = await m.read(o, n); out.push({ n: b.length, sha: hex(await crypto.subtle.digest('SHA-256', b)) }); }
      let range = null;
      try { await m.read(size - 1, 2); } catch (e) { range = e.name; }
      return { size: m.size, out, range };
    }, [cases, SIZE]);
    ok(got.size === SIZE, 'open reports the size');
    cases.forEach(([o, n], i) => ok(got.out[i].n === n && got.out[i].sha === sha(DATA.subarray(o, o + n)), `read(${o}, ${n}) is exact`));
    ok(got.range === 'RangeError', 'a read past the end is refused');

    // A dedicated Worker reads the same file.
    const spawned = page.waitForEvent('worker');
    await page.evaluate((src) => { window.w = new Worker(src); }, `chrome-extension://${id}/lib/ai/local/store.js`);
    const w = await spawned;
    const inWorker = await w.evaluate(async ([models, o, n]) => {
      const s = GZ_AI_STORE.create({ models });
      const m = await s.open('tiny');
      const b = await m.read(o, n);
      return { status: (await s.status('tiny')).state, sha: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (x) => x.toString(16).padStart(2, '0')).join('') };
    }, [MODELS, CHUNK - 3, CHUNK + 6]);
    ok(inWorker.status === 'ready' && inWorker.sha === sha(DATA.subarray(CHUNK - 3, 2 * CHUNK + 3)), 'a dedicated Worker opens it and reads a slice', inWorker);
    await page.evaluate(() => window.w.terminate());

    // A redirect off Hugging Face's hosts.
    const evil = await page.evaluate(async () => { try { await S.download('evil'); return { done: true }; } catch (e) { return { reason: e.reason, status: await S.status('evil') }; } });
    ok(evil.reason === 'redirect' && evil.status.state === 'missing', 'a redirect to evil.example is refused and nothing kept', evil);

    // Remove frees the space.
    const freed = await page.evaluate(async () => {
      const before = (await navigator.storage.estimate()).usage;
      await S.remove('tiny');
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('glaze-models');
      const left = []; for await (const k of dir.keys()) left.push(k);
      return { before, after: (await navigator.storage.estimate()).usage, status: await S.status('tiny'), left };
    });
    ok(freed.status.state === 'missing' && !freed.left.includes('tiny'), 'remove deletes the model', freed);
    ok(freed.before - freed.after >= SIZE * 0.9, 'and the storage estimate drops by its size', freed);

    // Two pages of the extension share the OPFS: one downloads, the other removes. The download ends as removed (the
    // remove's broadcast), the remove waits for its lock and then frees the space.
    hold = new Promise((r) => { letGo = r; });
    const other = await context.newPage();
    await other.goto(`chrome-extension://${id}/popup.html`);
    await other.addScriptTag({ url: `chrome-extension://${id}/lib/ai/local/store.js` });
    await other.evaluate((models) => { window.S = GZ_AI_STORE.create({ models }); }, MODELS);
    const at = log.length;
    await page.evaluate(() => { window.pending = S.download('tiny').then((r) => ({ r }), (e) => ({ reason: e.reason, name: e.name })); });
    for (const end = Date.now() + 30000; !log.slice(at).some((l) => l.host === 'us.aws.cdn.hf.co' && l.range === `bytes=${2 * CHUNK}-${3 * CHUNK - 1}`); await pause(50)) {
      if (Date.now() > end) throw new Error('the first page never asked for chunk 2');
    }
    const removing = await other.evaluate(async () => { await S.remove('tiny'); return S.status('tiny'); });
    const ended = await page.evaluate(() => window.pending);
    letGo(); hold = null;
    const after = await page.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('glaze-models');
      const left = []; for await (const k of dir.keys()) left.push(k);
      return { status: await S.status('tiny'), left };
    });
    ok(ended.reason === 'removed', 'a remove from another page ends its download as removed', ended);
    ok(removing.state === 'missing' && after.status.state === 'missing' && !after.left.includes('tiny'), 'and frees the model for both pages', { removing, after });
    await other.close();

    // The shipped catalog, loaded the default way.
    const shipped = await page.evaluate(async () => (await GZ_AI_STORE.list()).map(({ id, size, state }) => ({ id, size, state })));
    ok(shipped.length === 4 && shipped.every((m) => m.state === 'missing' && m.size > 1e9), 'the shipped models.json lists four LFM3 entries, none downloaded', shipped);

    const sample = log.filter((l) => l.method === 'GET' && (l.host === 'huggingface.co' || l.host === 'us.aws.cdn.hf.co'));
    fs.writeFileSync(path.join(out, 'local-store-check.json'), JSON.stringify({ checks, results, preflights, requests: log.length, sample: sample.slice(0, 6) }, null, 2));
    console.log(`PASS ${checks} checks (${preflights} preflights; evidence ${path.join(out, 'local-store-check.json')})`);
  } catch (e) {
    fs.writeFileSync(path.join(out, 'local-store-check.json'), JSON.stringify({ checks, results, error: String(e.stack || e), log }, null, 2));
    console.error(e.stack || e);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => {});
    letGo();
    server?.close();
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
    if (tls) fs.rmSync(tls, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
})();
