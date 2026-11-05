// Rime's first availability (ai/local/updates.js first, docs/ai-harness.md "Model updates") in Chromium with Glaze loaded
// unpacked (a staged copy whose models.json is the shipped one: no Rime). This process plays Hugging Face (the signed list
// at frostdev-ops/Rime-1.7B-GGUF's resolve/main, huggingface.co's 302 to its CDN's 206 Range replies) and serves four tiny
// GGUFs under Rime's permanent ids at tiers 1 to 4. The copy's updates.js trusts a key made here, never the owner's, and
// nothing real is published. Steps: Rime's card says Not available yet with no Download, and its open asks for the list
// once (404); not again that day; a forged list and a list only for a newer Glaze leave it not available; a verified list
// turns the open card to Download with no reload; Download fetches the ladder's pick (the highest tier on the synthetic
// machine below) with the list's hashes; then the daily check takes over (a newer serial swaps in) and the card's open
// asks for no list. Every step reported.
//   glaze-remote -o <evidence> -- node checks/ai/model-first-list-check.js /out
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const env = require('../../tools/dev/check-env.js');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-model-first-list-')));
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

// ---- four tiny GGUFs, one per size, and a newer version of the largest ----------------------------------------------------
const BYTE = (() => {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  let n = 0;
  return Array.from({ length: 256 }, (_, b) => String.fromCharCode(keep.includes(b) ? b : 256 + n++));
})();
const TOKENS = [...BYTE, '<|startoftext|>', '<|im_start|>', '<|im_end|>', '<think>', '</think>', ...Array.from({ length: 32 }, (_, i) => `[PAD${i}]`)];
const TYPES = [...BYTE.map(() => 1), 3, 3, 3, 4, 4, ...Array(32).fill(5)];
const gguf = (version, pad) => {
  const parts = [], u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); }, i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); parts.push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); parts.push(b); };
  const kv = [
    ['general.architecture', 8, () => str('lfm3')], ['tokenizer.ggml.model', 8, () => str('gpt2')], ['tokenizer.ggml.pre', 8, () => str('lfm2')],
    ['tokenizer.ggml.tokens', 9, () => { u32(8); u64(TOKENS.length); TOKENS.forEach(str); }],
    ['tokenizer.ggml.token_type', 9, () => { u32(5); u64(TYPES.length); TYPES.forEach(i32); }],
    ['tokenizer.ggml.merges', 9, () => { u32(8); u64(0); }],
    ['tokenizer.ggml.bos_token_id', 4, () => u32(TOKENS.indexOf('<|startoftext|>'))], ['tokenizer.ggml.eos_token_id', 4, () => u32(TOKENS.indexOf('<|im_end|>'))],
    ['glaze.check.version', 8, () => str(version)], ['glaze.check.pad', 8, () => str('x'.repeat(pad))],
  ];
  parts.push(Buffer.from('GGUF')); u32(3); u64(0); u64(kv.length);
  for (const [k, t, w] of kv) { str(k); u32(t); w(); }
  const body = Buffer.concat(parts);
  return Buffer.concat([body, Buffer.alloc((32 - (body.length % 32)) % 32)]);
};
const CHUNK = 256 << 10;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const REPO = 'frostdev-ops/Rime-1.7B-GGUF';
// R11's entries say minGlaze 4.0.3; this tree's own version stands in, so the check runs before and after the release bump.
const GLAZE = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
// Rime's permanent ids and tiers (test/fixtures/ai/rime-list-entries.json), each a file of its own.
const SIZES = require('../../test/fixtures/ai/rime-list-entries.json').models.map((m) => ({ id: m.id, tier: m.tier, quant: m.quant, name: m.name }));
const FILES = {}; // `${commit}/${file}` → bytes
const entry = (s, version, extra = {}) => {
  const commit = crypto.createHash('sha1').update(`${version}-${s.id}`).digest('hex'), file = `Rime-1.7B-${s.quant}.gguf`;
  const d = gguf(`${version}-${s.quant}`, (1 << 18) * s.tier);
  FILES[`${commit}/${file}`] = d;
  const sums = [];
  for (let i = 0; i * CHUNK < d.length; i++) sums.push(sha(d.subarray(i * CHUNK, (i + 1) * CHUNK)));
  return { id: s.id, name: s.name, repo: REPO, commit, file, url: `https://huggingface.co/${REPO}/resolve/${commit}/${file}`, size: d.length, chunk: CHUNK,
    sha256: sums, total: sha(d), license: 'lfm1.0', quant: s.quant, tier: s.tier, tools: 3, memory: 1, scale: 1, minGlaze: GLAZE, version, ...extra };
};
const R11 = SIZES.map((s) => entry(s, 'r11'));
const R12 = SIZES.map((s) => entry(s, 'r12'));
const LATER = SIZES.map((s) => entry(s, 'r11', { minGlaze: '99.0' }));
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const TEST_KEY = publicKey.export({ format: 'jwk' }).x;
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
const signed = (serial, models, key = privateKey) => {
  const list = { v: 1, serial, issued: '2026-11-20T09:00:00Z', models };
  return { list, sig: crypto.sign(null, Buffer.from(`glaze-models-1|${canon(list)}`), key).toString('base64url') };
};
const HOSTS = ['huggingface.co', 'us.aws.cdn.hf.co'];

const ENGINE = `var GZ_AI_ENGINE = { load: async (g) => {
  const tok = GZ_AI_TOKENIZER.fromGGUF(g.kv); for (const n of GZ_AI_TOKENIZER.GLAZE_TOKENS) tok.add(n);
  const reply = [...tok.encode('from ' + g.kv['glaze.check.version'])]; let i = 0;
  return { context: 16000, device: { stub: true },
    prefill: async (ids, { snapshot } = {}) => { i = 0; return snapshot ? { drop() {} } : undefined; },
    decode: async () => (i < reply.length ? reply[i++] : tok.eos), snapshot: async () => ({ drop() {} }), restore: async () => {}, release: () => {} };
} };`;
// The real pick over a synthetic machine (the runner has no GPU to bench): an M5 Pro's measured bench, room for every size.
const MACHINE = { adapter: { isFallbackAdapter: false }, info: { vendor: 'apple', architecture: 'metal-3', device: '', description: '', isFallbackAdapter: false },
  features: ['shader-f16', 'subgroups'], limits: { maxBufferSize: 4294967292, maxStorageBufferBindingSize: 4294967292 }, deviceMemory: 16,
  storageEstimate: { quota: 1e12, usage: 0 }, bench: { bandwidth: 175.5e9, overheadMs: 1.2 } };
const LADDER = `${fs.readFileSync(path.join(root, 'ai/local/ladder.js'), 'utf8')}
GZ_AI_LADDER.probe = async () => (${JSON.stringify(MACHINE)});`;

(async () => {
  let context, profile, held = false, server, tls, ext;
  const log = [];
  let published = null; // the list huggingface.co serves now (null: 404)
  const lock = require('../../tools/dev/check-env.js').lockPath();
  try {
    while (!held) { try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); } }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nmodel-first-list-check\n`);
    tls = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-model-first-list-tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=huggingface.co', '-keyout', path.join(tls, 'k.pem'), '-out', path.join(tls, 'c.pem')], { stdio: 'ignore' });
    server = https.createServer({ key: fs.readFileSync(path.join(tls, 'k.pem')), cert: fs.readFileSync(path.join(tls, 'c.pem')) }, async (req, res) => {
      const host = (req.headers.host || '').replace(/:\d+$/, ''), u = new URL(req.url, `https://${host}`), h = req.headers;
      log.push({ at: Date.now(), method: req.method, host, path: u.pathname, range: h.range || null, cookie: !!h.cookie, referer: h.referer || null });
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range', 'access-control-expose-headers': '*' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (host === 'huggingface.co' && u.pathname === `/${REPO}/resolve/main/glaze-models.json`) {
        if (!published) { res.writeHead(404, cors); return res.end(); }
        res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify(published));
      }
      const key = host === 'huggingface.co' && u.pathname.startsWith(`/${REPO}/resolve/`) && u.pathname.slice(`/${REPO}/resolve/`.length);
      if (key && FILES[key]) {
        res.writeHead(302, { location: `https://us.aws.cdn.hf.co/xet-bridge-us/check/${key}?Expires=1&Signature=s`, 'access-control-allow-origin': h.origin || '*' });
        return res.end();
      }
      const cdn = host === 'us.aws.cdn.hf.co' && u.pathname.replace('/xet-bridge-us/check/', '');
      const m = cdn && FILES[cdn] && /^bytes=(\d+)-(\d+)$/.exec(h.range || '');
      if (m) {
        const d = FILES[cdn], a = +m[1], b = Math.min(+m[2], d.length - 1), body = d.subarray(a, b + 1);
        res.writeHead(206, { ...cors, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${d.length}`, 'content-type': 'application/octet-stream', 'content-length': body.length });
        return res.end(body);
      }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    // The copy: the shipped models.json (no Rime), the stub engine, the real ladder on a synthetic machine, the key made here.
    ext = env.staged(root, []);
    const put = (f, text) => { fs.rmSync(path.join(ext, f), { force: true }); fs.writeFileSync(path.join(ext, f), text); };
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ext, 'ai/local/models.json'), 'utf8')).models.filter((m) => !m.role), [], 'the copy bundles no Rime');
    put('ai/local/engine.js', ENGINE);
    put('ai/local/ladder.js', LADDER);
    const upd = fs.readFileSync(path.join(root, 'ai/local/updates.js'), 'utf8');
    const KEY_LINE = /const KEY = '[\w-]{43}';/;
    assert.ok(KEY_LINE.test(upd), 'updates.js names its key');
    put('ai/local/updates.js', upd.replace(KEY_LINE, `const KEY = '${TEST_KEY}';`));

    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-model-first-list-profile-'));
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, { ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US',
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
    // AI on, no model chosen: Settings reads Rime's state only when its card opens.
    await worker.evaluate(async () => { await chrome.storage.local.set({ ai: { on: true, features: {} } }); });
    const check = async () => (await sw()).evaluate(async () => { ai(); return GZ_AI_MODEL_UPDATES.check(modelUpdatesEnv(), { reason: 'daily' }); });
    // The last try a day ago: the card's next open may ask again.
    const nextDay = async () => (await sw()).evaluate(async () => { const k = 'aiModelUpdates', { [k]: v = {} } = await chrome.storage.local.get(k); await chrome.storage.local.set({ [k]: { ...v, listed: Date.now() - 864e5 - 1000 } }); });
    const lists = () => log.filter((l) => l.path.endsWith('/glaze-models.json') && l.method === 'GET');
    const opfs = (page) => page.evaluate(async () => {
      const out = {};
      try { const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('glaze-models'); for await (const [k, h] of top.entries()) if (h.kind === 'directory') { out[k] = []; for await (const t of h.keys()) out[k].push(t); } } catch { /* none */ }
      return out;
    });
    const tagOf = (m) => `${m.total.slice(0, 16)}-${CHUNK}`;

    const settings = await context.newPage();
    settings.on('pageerror', (e) => errors.push(`settings: ${e.message}`));
    await settings.goto(`${base}/options.html#ai/setup`);
    const note = () => settings.evaluate(() => document.querySelector('#ai-drawer .line.own:not(#ai-local-pictures):not(#ai-local-update) .note')?.textContent || '');
    const buttons = () => settings.evaluate(() => [...document.querySelectorAll('#ai-drawer button')].map((b) => b.textContent));
    const reopen = async () => { await settings.click('#ai-prov-local'); await settings.click('#ai-prov-local'); };
    const evidence = {};

    await step('Settings open, Rime\'s card shut: no request of any kind', async () => {
      await pause(500);
      assert.deepEqual(log, []);
    });
    await step('Rime\'s card: Not available yet, no Download, no picture row; its open asks for the signed list once, without cookies or referrer', async () => {
      await settings.click('#ai-prov-local');
      await until(async () => (await note()) === 'Not available yet', 'Not available yet');
      await until(() => lists().length === 1, 'the list request');
      assert.deepEqual(await buttons(), []);
      assert.equal(await settings.locator('#ai-local-pictures').count(), 0);
      assert.ok(log.every((l) => !l.cookie && !l.referer), JSON.stringify(log));
      assert.deepEqual(log.map((l) => l.host), ['huggingface.co'], 'nothing but the list');
      await settings.screenshot({ path: path.join(out, 'card-pending.png') });
    });
    await step('the card opened again the same day asks nothing', async () => {
      await reopen();
      await until(async () => (await note()) === 'Not available yet', 'Not available yet');
      await pause(800);
      assert.equal(lists().length, 1);
    });
    await step('the next day, a list signed by another key leaves Rime not available', async () => {
      published = signed(1, R11, crypto.generateKeyPairSync('ed25519').privateKey);
      await nextDay(); await reopen();
      await until(() => lists().length === 2, 'the list request');
      await pause(800);
      assert.equal(await note(), 'Not available yet');
      assert.deepEqual(await buttons(), []);
    });
    await step('the next day, a list only for a newer Glaze leaves Rime not available', async () => {
      published = signed(1, LATER);
      await nextDay(); await reopen();
      await until(() => lists().length === 3, 'the list request');
      await pause(800);
      assert.equal(await note(), 'Not available yet');
      assert.deepEqual(await buttons(), []);
    });
    await step('the next day, a verified list: the open card turns to Download with no reload, and Advanced lists its four sizes', async () => {
      published = signed(1, R11);
      await nextDay(); await reopen();
      await until(async () => (await note()).startsWith('Needs a download · '), 'Needs a download', 20000);
      assert.equal(lists().length, 4);
      assert.ok((await buttons()).includes('Download'));
      await settings.evaluate(() => { const r = document.getElementById('ai-mode-advanced'); r.checked = true; r.dispatchEvent(new Event('change')); });
      await settings.locator('#ai-local-tier').waitFor();
      evidence.sizes = await settings.locator('#ai-local-tier option').allTextContents();
      assert.deepEqual(evidence.sizes.map((s) => s.split(' · ')[0]), ['Auto', ...R11.map((m) => m.name)]);
      assert.equal(await settings.locator('#ai-local-auto').count(), 0, 'Update automatically waits for a model');
      await settings.screenshot({ path: path.join(out, 'card-listed.png') });
      await settings.evaluate(() => { const r = document.getElementById('ai-mode-simple'); r.checked = true; r.dispatchEvent(new Event('change')); });
    });
    await step('Download fetches the ladder\'s pick, the highest tier here, from the list\'s address with its hashes', async () => {
      const before = log.length;
      await settings.click('#ai-drawer .line.own button.primary');
      await until(async () => /^Ready · r11 · /.test(await note()), 'Ready · r11', 60000);
      const top = R11.find((m) => m.tier === 4);
      const files = await opfs(settings);
      assert.deepEqual(files, { [top.id]: [tagOf(top)] }, JSON.stringify(files));
      const got = log.slice(before).filter((l) => l.method === 'GET');
      assert.ok(got.some((l) => l.host === 'huggingface.co' && l.path === new URL(top.url).pathname), 'the pinned resolve address');
      assert.equal(got.filter((l) => l.host === 'us.aws.cdn.hf.co').length, top.sha256.length, 'one Range request a chunk');
      assert.ok(got.every((l) => l.path.includes(top.commit)), 'no other size');
      evidence.downloaded = { id: top.id, total: top.total, tag: tagOf(top) };
      await settings.screenshot({ path: path.join(out, 'card-ready.png') });
    });
    await step('then the daily check takes over: a newer serial downloads and swaps in; the card\'s open asks for no list', async () => {
      published = signed(2, R12);
      const r = await check();
      assert.deepEqual(r, { state: 'swapped', version: 'r12' });
      assert.equal(lists().length, 5);
      await nextDay(); await reopen();
      await until(async () => /^Ready · r12 · /.test(await note()), 'Ready · r12');
      await pause(800);
      assert.equal(lists().length, 5, 'with Rime offered the card asks nothing');
      await settings.evaluate(() => { const r = document.getElementById('ai-mode-advanced'); r.checked = true; r.dispatchEvent(new Event('change')); });
      await settings.locator('#ai-local-auto').waitFor();
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
    console.log(`model-first-list-check: ${results.filter((r) => r.ok).length}/${results.length} passed`);
    process.exitCode = passed ? 0 : 1;
  }
})();
