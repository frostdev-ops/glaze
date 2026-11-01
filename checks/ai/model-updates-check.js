// Rime's background updates (ai/local/updates.js, docs/ai-harness.md "Model updates") in Chromium with Glaze loaded unpacked
// (a staged copy): this process plays Hugging Face (huggingface.co's 302 to its CDN's 206 Range replies, and the signed
// model list at frostdev-ops/Rime-1.7B-GGUF's resolve/main), serving three tiny GGUFs of one model id: r5 (the copy's
// models.json), r6, and r7, which the stub engine refuses to load. The copy's updates.js trusts a key made here, never the
// owner's, and nothing real is published. Steps: no request of any kind before a model is downloaded; Download (Settings'
// click); the worker's check fetches the signed list, the engine host downloads r6 beside r5 (Settings shows its progress),
// verifies it and swaps it in; r6 answers once and r5 goes; a forged list changes nothing; serial 3 offers r7, which swaps
// in, fails to load on the next run, and rolls back to r6, which answers that run; r7 isn't tried again. Every step reported.
//   glaze-remote -o <evidence> -- node checks/ai/model-updates-check.js /out
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const env = require('../../tools/dev/check-env.js');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-model-updates-')));
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [], errors = [];
const until = async (fn, label, ms = 30000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
let stop = false;
const step = async (name, fn) => {
  if (stop) { results.push({ name, ok: false, error: 'skipped: an earlier step failed' }); return; }
  try { await fn(); results.push({ name, ok: true }); console.log(`ok   ${name}`); }
  catch (e) { stop = true; results.push({ name, ok: false, error: e.stack }); console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
};

// ---- three versions of one tiny GGUF -------------------------------------------------------------------------------------
const BYTE = (() => {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  let n = 0;
  return Array.from({ length: 256 }, (_, b) => String.fromCharCode(keep.includes(b) ? b : 256 + n++));
})();
const TOKENS = [...BYTE, '<|startoftext|>', '<|im_start|>', '<|im_end|>', '<think>', '</think>', ...Array.from({ length: 20 }, (_, i) => `[PAD${i}]`)];
const TYPES = [...BYTE.map(() => 1), 3, 3, 3, 4, 4, ...Array(20).fill(5)];
const gguf = (version) => {
  const parts = [], u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); }, i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); parts.push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); parts.push(b); };
  const kv = [
    ['general.architecture', 8, () => str('lfm3')], ['tokenizer.ggml.model', 8, () => str('gpt2')], ['tokenizer.ggml.pre', 8, () => str('lfm2')],
    ['tokenizer.ggml.tokens', 9, () => { u32(8); u64(TOKENS.length); TOKENS.forEach(str); }],
    ['tokenizer.ggml.token_type', 9, () => { u32(5); u64(TYPES.length); TYPES.forEach(i32); }],
    ['tokenizer.ggml.merges', 9, () => { u32(8); u64(0); }],
    ['tokenizer.ggml.bos_token_id', 4, () => u32(TOKENS.indexOf('<|startoftext|>'))], ['tokenizer.ggml.eos_token_id', 4, () => u32(TOKENS.indexOf('<|im_end|>'))],
    ['glaze.check.version', 8, () => str(version)],
    ['glaze.check.pad', 8, () => str(version.repeat(1 << 19))], // a model big enough for its download to take a moment
  ];
  parts.push(Buffer.from('GGUF')); u32(3); u64(0); u64(kv.length);
  for (const [k, t, w] of kv) { str(k); u32(t); w(); }
  const body = Buffer.concat(parts);
  return Buffer.concat([body, Buffer.alloc((32 - (body.length % 32)) % 32)]);
};
const CHUNK = 256 << 10;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const COMMITS = { r5: '5'.repeat(40), r6: '6'.repeat(40), r7: '7'.repeat(40) };
const REPO = 'frostdev-ops/Rime-1.7B-GGUF', FILE = 'Rime-Check-Q4_K_M.gguf';
const DATA = Object.fromEntries(Object.keys(COMMITS).map((v) => [v, gguf(v)]));
const entry = (v) => {
  const d = DATA[v], sums = [];
  for (let i = 0; i * CHUNK < d.length; i++) sums.push(sha(d.subarray(i * CHUNK, (i + 1) * CHUNK)));
  return { id: 'rime-check-q4_k_m', name: 'Rime check Q4_K_M', repo: REPO, commit: COMMITS[v], file: FILE, url: `https://huggingface.co/${REPO}/resolve/${COMMITS[v]}/${FILE}`,
    size: d.length, chunk: CHUNK, sha256: sums, total: sha(d), license: 'lfm1.0', quant: 'Q4_K_M', tier: 1, tools: 3, minGlaze: '4.0.0', version: v };
};
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const TEST_KEY = publicKey.export({ format: 'jwk' }).x;
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
const signed = (serial, v, key = privateKey) => {
  const list = { v: 1, serial, issued: '2026-11-01T00:00:00Z', models: [entry(v)] };
  return { list, sig: crypto.sign(null, Buffer.from(`glaze-models-1|${canon(list)}`), key).toString('base64url') };
};
const HOSTS = ['huggingface.co', 'us.aws.cdn.hf.co'];

// The engine: answers "from <version>" (the GGUF's glaze.check.version); r7 is not a model it can load.
const ENGINE = `var GZ_AI_ENGINE = { load: async (g, opts) => {
  const tok = GZ_AI_TOKENIZER.fromGGUF(g.kv); for (const n of GZ_AI_TOKENIZER.GLAZE_TOKENS) tok.add(n);
  const v = g.kv['glaze.check.version'], say = new BroadcastChannel('glaze-check-engine');
  say.postMessage({ type: 'load', version: v });
  if (v === 'r7') throw Object.assign(new Error('not a model'), { reason: 'model' });
  const reply = [...tok.encode('from ' + v)]; let i = 0;
  return { context: 16000, device: { stub: true },
    prefill: async (ids, { snapshot } = {}) => { i = 0; return snapshot ? { drop() {} } : undefined; },
    decode: async () => (i < reply.length ? reply[i++] : tok.eos), snapshot: async () => ({ drop() {} }), restore: async () => {},
    release: () => { say.postMessage({ type: 'release', version: v }); } };
} };`;
const LADDER = 'var GZ_AI_LADDER = { probe: async () => ({ adapter: {} }), pick: ({ models }) => ({ tier: models[0].tier, id: models[0].id, reason: \'fastest\', quants: [] }) };';

(async () => {
  let context, profile, held = false, server, tls, ext;
  const log = [];
  let published = null; // the list huggingface.co serves now (null: 404)
  const lock = env.lockPath();
  try {
    while (!held) { try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); } }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nmodel-updates-check\n`);
    tls = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-model-updates-tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=huggingface.co', '-keyout', path.join(tls, 'k.pem'), '-out', path.join(tls, 'c.pem')], { stdio: 'ignore' });
    server = https.createServer({ key: fs.readFileSync(path.join(tls, 'k.pem')), cert: fs.readFileSync(path.join(tls, 'c.pem')) }, async (req, res) => {
      const host = (req.headers.host || '').replace(/:\d+$/, ''), u = new URL(req.url, `https://${host}`), h = req.headers;
      log.push({ at: Date.now(), method: req.method, host, path: u.pathname, range: h.range || null, origin: h.origin || null, cookie: !!h.cookie });
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range', 'access-control-expose-headers': '*' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (host === 'huggingface.co' && u.pathname === `/${REPO}/resolve/main/glaze-models.json`) {
        if (!published) { res.writeHead(404, cors); return res.end(); }
        res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify(published));
      }
      const v = Object.keys(COMMITS).find((k) => u.pathname === `/${REPO}/resolve/${COMMITS[k]}/${FILE}`);
      if (host === 'huggingface.co' && v) {
        res.writeHead(302, { location: `https://us.aws.cdn.hf.co/xet-bridge-us/check/${v}?Expires=1&Signature=s`, 'access-control-allow-origin': h.origin || '*' });
        return res.end();
      }
      const cv = host === 'us.aws.cdn.hf.co' && u.pathname.split('/').pop();
      const m = cv && DATA[cv] && /^bytes=(\d+)-(\d+)$/.exec(h.range || '');
      if (m) {
        await pause(300);
        const d = DATA[cv], a = +m[1], b = Math.min(+m[2], d.length - 1), body = d.subarray(a, b + 1);
        res.writeHead(206, { ...cors, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${d.length}`, 'content-type': 'application/octet-stream', 'content-length': body.length });
        return res.end(body);
      }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    // The copy: models.json with r5, the stub engine and ladder, and updates.js trusting the key made here.
    ext = env.staged(root, []);
    const put = (f, text) => { fs.rmSync(path.join(ext, f), { force: true }); fs.writeFileSync(path.join(ext, f), text); };
    put('ai/local/models.json', `${JSON.stringify({ models: [entry('r5')] }, null, 2)}\n`);
    put('ai/local/engine.js', ENGINE);
    put('ai/local/ladder.js', LADDER);
    const upd = fs.readFileSync(path.join(root, 'ai/local/updates.js'), 'utf8');
    const KEY_LINE = /const KEY = '[\w-]{43}';/;
    assert.ok(KEY_LINE.test(upd), 'updates.js names its key');
    put('ai/local/updates.js', upd.replace(KEY_LINE, `const KEY = '${TEST_KEY}';`));

    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-model-updates-profile-'));
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, { ...env.chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking',
        `--host-resolver-rules=${HOSTS.map((x) => `MAP ${x} 127.0.0.1:${port}`).join(',')}, MAP * ~NOTFOUND`, '--ignore-certificate-errors'] });
    env.noFirstRun(context); context.setDefaultTimeout(20000);
    const unexpected = [];
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:' || HOSTS.includes(u.hostname)) return r.continue();
      unexpected.push(u.href); return r.abort();
    });
    const sw = async () => context.serviceWorkers()[0] || context.waitForEvent('serviceworker');
    const worker = await sw(), id = new URL(worker.url()).host, base = `chrome-extension://${id}`;
    await worker.evaluate(async () => { await chrome.storage.local.set({ ai: { on: true, model: { use: 'local', model: '' }, features: {} } }); });
    // A check now, as the alarm's: → its result.
    const check = async () => (await sw()).evaluate(async () => { ai(); return GZ_AI_MODEL_UPDATES.check(modelUpdatesEnv(), { reason: 'daily' }); });
    const run = async () => (await sw()).evaluate(async () => { ai(); return GZ_AI_LOCAL.link().call('run', { model: 'rime-check-q4_k_m', parts: [{ text: 'hello' }], stable: 0, sampler: {}, maxTokens: 16 }); });
    const opfs = (page) => page.evaluate(async () => {
      const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('glaze-models');
      const tags = []; try { for await (const k of (await top.getDirectoryHandle('rime-check-q4_k_m')).keys()) tags.push(k); } catch { /* none */ }
      let state = null; try { state = JSON.parse(await (await (await top.getFileHandle('~updates.json')).getFile()).text()); } catch { /* none */ }
      return { tags: tags.sort(), state };
    });
    const tagOf = (v) => `${entry(v).total.slice(0, 16)}-${CHUNK}`;
    const alarms = async () => (await sw()).evaluate(async () => (await chrome.alarms.getAll()).map((a) => ({ name: a.name, periodInMinutes: a.periodInMinutes })));

    const settings = await context.newPage();
    settings.on('pageerror', (e) => errors.push(`settings: ${e.message}`));
    await settings.goto(`${base}/options.html#ai/setup`);
    await settings.evaluate(() => { window.__engine = []; new BroadcastChannel('glaze-check-engine').onmessage = (e) => window.__engine.push(e.data); });
    const note = () => settings.evaluate(() => document.querySelector('#ai-drawer .line.own:not(#ai-local-pictures):not(#ai-local-update) .note')?.textContent || '');
    const updateNote = () => settings.evaluate(() => document.querySelector('#ai-local-update .note')?.textContent || '');
    const evidence = {};

    await step('the daily alarm is scheduled at install', async () => {
      const a = await until(async () => (await alarms()).find((x) => x.name === 'gz-models:daily'), 'the alarm');
      assert.equal(a.periodInMinutes, 1440);
      evidence.alarms = await alarms();
    });
    await step('no model downloaded: a check asks nothing of the network', async () => {
      published = signed(2, 'r6');
      assert.deepEqual(await check(), { state: 'none' });
      assert.deepEqual(log, [], 'no request at all');
    });
    await step('Download from Settings\' click: r5 is here, its version on the card', async () => {
      await settings.click('#ai-prov-local');
      await until(async () => (await note()).startsWith('Needs a download'), 'its state');
      await settings.click('#ai-drawer .line.own button.primary');
      await until(async () => /^Ready · r5 · /.test(await note()), 'Ready · r5', 60000);
      assert.deepEqual((await opfs(settings)).tags, [tagOf('r5')]);
    });
    await step('check → download → verify → swap: the signed list fetched without cookies, r6 downloads beside r5 with its progress shown, then swaps in', async () => {
      const before = log.length;
      let early = null;
      const running = check().then((r) => { early = r; return r; });
      const shown = await until(async () => { if (early && early.state !== 'swapped') throw Error(`the check ended ${JSON.stringify(early)}`); const n = await updateNote(); return /^r6 · \d+%$/.test(n) && n; }, 'the update row', 30000);
      evidence.updateRow = shown;
      await settings.screenshot({ path: path.join(out, 'card-updating.png') });
      const mid = await opfs(settings);
      assert.ok(mid.tags.includes(tagOf('r5')), 'r5 stays while r6 downloads');
      const r = await running;
      assert.deepEqual(r, { state: 'swapped', version: 'r6' });
      const asked = log.slice(before);
      const list = asked.filter((l) => l.path.endsWith('/glaze-models.json'));
      assert.equal(list.length, 1);
      assert.ok(asked.every((l) => !l.cookie), 'no cookies');
      assert.equal(asked.filter((l) => l.host === 'us.aws.cdn.hf.co' && l.path.endsWith('/r6') && l.method === 'GET').length, entry('r6').sha256.length, 'one Range request a chunk');
      const after = await opfs(settings);
      assert.deepEqual(after.tags, [tagOf('r5'), tagOf('r6')].sort(), 'both versions until r6 answers');
      assert.deepEqual(after.state.trial, { id: 'rime-check-q4_k_m', from: entry('r5').total, to: entry('r6').total });
      assert.equal(after.state.serial, 2);
      evidence.afterSwap = { tags: after.tags, trial: after.state.trial };
      await settings.click('#ai-prov-local'); await settings.click('#ai-prov-local');
      await until(async () => /^Ready · r6 · /.test(await note()), 'Ready · r6');
      await settings.screenshot({ path: path.join(out, 'card-r6.png') });
    });
    await step('r6 answers once, then r5 is deleted', async () => {
      const r = await run();
      assert.equal(r.text, 'from r6');
      const st = await until(async () => { const o = await opfs(settings); return o.tags.length === 1 && o; }, 'r5 deleted');
      assert.deepEqual(st.tags, [tagOf('r6')]);
      assert.equal(st.state.trial, null);
    });
    await step('a list signed by another key changes nothing', async () => {
      published = signed(9, 'r7', crypto.generateKeyPairSync('ed25519').privateKey);
      assert.deepEqual(await check(), { state: 'refused', reason: 'signature' });
      assert.equal((await opfs(settings)).state.serial, 2);
    });
    await step('rollback: serial 3 offers r7, which swaps in, fails to load on the next run, and r6 comes back and answers it', async () => {
      published = signed(3, 'r7');
      assert.deepEqual(await check(), { state: 'swapped', version: 'r7' });
      assert.equal((await opfs(settings)).state.trial.to, entry('r7').total);
      const r = await run();
      assert.equal(r.text, 'from r6', 'the run answered by the old version');
      const loads = await settings.evaluate(() => window.__engine.filter((e) => e.type === 'load').map((e) => e.version));
      assert.ok(loads.includes('r7'), JSON.stringify(loads));
      const st = await until(async () => { const o = await opfs(settings); return o.tags.length === 1 && o; }, 'r7 dropped');
      assert.deepEqual(st.tags, [tagOf('r6')]);
      assert.equal(st.state.pins['rime-check-q4_k_m'].version, 'r6');
      assert.deepEqual(st.state.failed, { [entry('r7').total]: 3 });
      evidence.afterRollback = { tags: st.tags, failed: st.state.failed, loads };
    });
    await step('the same list again does not retry r7', async () => {
      const before = log.filter((l) => l.path.endsWith('/r7')).length;
      assert.equal((await check()).state, 'current');
      assert.equal(log.filter((l) => l.path.endsWith('/r7')).length, before);
    });
    await step('Update automatically off: a check asks nothing', async () => {
      await settings.click('#ai-mode-advanced');
      await settings.click('#ai-prov-local'); await settings.click('#ai-prov-local');
      const box = settings.locator('#ai-local-auto');
      await box.waitFor();
      assert.equal(await box.isChecked(), true);
      await box.uncheck();
      await until(() => worker.evaluate(async () => (await chrome.storage.local.get('ai')).ai.updates === false), 'saved');
      await settings.screenshot({ path: path.join(out, 'card-advanced-off.png') });
      const before = log.length;
      assert.deepEqual(await check(), { state: 'off' });
      assert.equal(log.length, before);
    });
    await step('no page errors, and no request but Hugging Face\'s', async () => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); });
    fs.writeFileSync(path.join(out, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  } catch (e) {
    results.push({ name: 'run', ok: false, error: e.stack }); console.log(`FAIL run\n  ${e.message}`);
  } finally {
    await context?.close().catch(() => {});
    server?.close();
    for (const d of [profile, tls, ext]) if (d) fs.rmSync(d, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    const passed = results.length > 0 && results.every((r) => r.ok);
    fs.writeFileSync(path.join(out, 'results.json'), `${JSON.stringify({ passed, results, errors, requests: log.map(({ at, ...r }) => r) }, null, 2)}\n`);
    console.log(`model-updates-check: ${results.filter((r) => r.ok).length}/${results.length} passed`);
    process.exitCode = passed ? 0 : 1;
  }
})();
