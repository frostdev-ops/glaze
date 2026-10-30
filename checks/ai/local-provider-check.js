// Glaze's own model in Chromium with Glaze loaded unpacked (a staged copy): Settings → AI's card, a download from its click
// through the real store into OPFS in the real engine host (an offscreen document's Worker), and the real worker's broker
// and local provider answering Writer's gray text in a document from the Documents home. The engine and the tier ladder
// are stubs written into the copy over ai/local/engine.js and ladder.js (the runner has no GPU): the engine reads the prompt
// the host tokenized and answers only when it is the fine-tune's format for writer.complete. The model is a tiny GGUF of a
// byte-level vocabulary, served by this process playing Hugging Face (huggingface.co's 302 to its CDN's 206 Range replies,
// as probe 4 measured), slowly, so the download's progress shows. The host idles out after 4 s in the copy (5 minutes as
// shipped), so its offscreen document is seen to close, and a later run starts it again. Every step is reported.
//   glaze-remote -o <evidence> -- node checks/ai/local-provider-check.js /out
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const env = require('../../tools/dev/check-env.js');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-local-provider-')));
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [], errors = [];
const until = async (fn, label, ms = 20000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const step = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`ok   ${name}`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
};

// ---- the model: a GGUF of LFM3's tokenizer shape, a byte-level vocabulary with its specials and reserved rows -------------
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
const gguf = () => {
  const parts = [], u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); }, i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); parts.push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); parts.push(b); };
  const kv = [
    ['general.architecture', 8, () => str('lfm3')], ['tokenizer.ggml.model', 8, () => str('gpt2')], ['tokenizer.ggml.pre', 8, () => str('lfm2')],
    ['tokenizer.ggml.tokens', 9, () => { u32(8); u64(TOKENS.length); TOKENS.forEach(str); }],
    ['tokenizer.ggml.token_type', 9, () => { u32(5); u64(TYPES.length); TYPES.forEach(i32); }],
    ['tokenizer.ggml.merges', 9, () => { u32(8); u64(0); }],
    ['tokenizer.ggml.bos_token_id', 4, () => u32(TOKENS.indexOf('<|startoftext|>'))], ['tokenizer.ggml.eos_token_id', 4, () => u32(TOKENS.indexOf('<|im_end|>'))],
    ['glaze.check.pad', 8, () => str('x'.repeat(2 << 20))], // a model big enough for its download to take a moment
  ];
  parts.push(Buffer.from('GGUF')); u32(3); u64(0); u64(kv.length);
  for (const [k, t, w] of kv) { str(k); u32(t); w(); }
  const body = Buffer.concat(parts);
  return Buffer.concat([body, Buffer.alloc((32 - (body.length % 32)) % 32)]);
};
const DATA = gguf(), CHUNK = 256 << 10, COMMIT = 'c'.repeat(40);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const MODEL = { id: 'check-tiny', name: 'Check tiny', repo: 'glaze-check/Tiny-GGUF', commit: COMMIT, file: 'tiny.gguf', url: `https://huggingface.co/glaze-check/Tiny-GGUF/resolve/${COMMIT}/tiny.gguf`,
  size: DATA.length, chunk: CHUNK, sha256: Array.from({ length: Math.ceil(DATA.length / CHUNK) }, (_, i) => sha(DATA.subarray(i * CHUNK, (i + 1) * CHUNK))), total: sha(DATA),
  license: 'lfm1.0', quant: 'Q4_K_M', tier: 1 };
const HOSTS = ['huggingface.co', 'us.aws.cdn.hf.co'];

// ---- the stubs written into the copy -----------------------------------------------------------------------------------------
// The engine (docs/ai-harness.md): reads what the host fed it with Glaze's tokenizer, tells the check over a channel, and
// answers writer.complete's reply only for the fine-tune's format.
const ENGINE = `var GZ_AI_ENGINE = { load: async (g, opts) => {
  const tok = GZ_AI_TOKENIZER.fromGGUF(g.kv); for (const n of GZ_AI_TOKENIZER.GLAZE_TOKENS) tok.add(n);
  const say = new BroadcastChannel('glaze-check-engine'); say.postMessage({ type: 'load', opts: Object.keys(opts).sort() });
  let seen = [], reply = [], i = 0, pos = 0;
  const snap = (p, s) => ({ pos: p, seen: s.slice(), drop() {} });
  return { context: 16000,
    prefill: async (ids, { snapshot } = {}) => { seen.push(...ids); pos += ids.length; const text = tok.decode(seen, { specials: true });
      say.postMessage({ type: 'prefill', n: ids.length, text });
      reply = /<\\|gz_task:writer\\.complete\\|>/.test(text) && /<\\|gz_data\\|>/.test(text) && !/<<<DATA-/.test(text) ? [...tok.encode('it arrives uninvited and rearranges the present. Then the river takes it back.')] : [];
      i = 0; return snapshot ? snap(pos, seen) : undefined; },
    decode: async ({ sampler }) => { pos++; return i < reply.length ? reply[i++] : tok.eos; },
    snapshot: async () => snap(pos, seen), restore: async (s) => { pos = s.pos; seen = s.seen.slice(); },
    release: () => { say.postMessage({ type: 'release' }); } };
} };`;
// The ladder (ladder.js's probe and pick): the runner's GPU is a CPU fallback, which the real one refuses.
const LADDER = 'var GZ_AI_LADDER = { probe: async () => ({ adapter: {} }), pick: ({ models }) => ({ tier: models[0].tier, id: models[0].id, reason: \'fastest\', quants: [] }) };';

// ---- a document on the Documents home, as checks/documents/documents-ai-check.js seeds it --------------------------------------
const LAST = 'When Sethe returns to the clearing, the memory is not something she owns;';
const GHOST = ' arrives uninvited and rearranges the present.';
const KEY = `doc:${crypto.randomUUID()}`, NOW = Date.now();
const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const DOC = { type: 'doc', content: [p('Reading notes on Beloved'), p(LAST)] };
const records = () => ({
  [`writerPaper:${KEY}`]: { key: KEY, title: 'Reading notes', named: true, format: 'plain', updated: NOW, doc: DOC, kind: 'paper', courseName: '', url: '', words: 20, keep: false, created: NOW - 1000, revision: 2, edited: 2, submitted: null },
  writerPapers: [{ key: KEY, kind: 'paper', named: true, title: 'Reading notes', course: '', url: '', words: 20, format: 'plain', updated: NOW, submitted: null }],
  ai: { on: true, model: { use: 'local', model: '' }, features: { completion: true } },
});

(async () => {
  let context, profile, held = false, server, tls, ext;
  const log = [];
  const lock = require('../../tools/dev/check-env.js').lockPath();
  try {
    while (!held) { try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); } }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nlocal-provider-check\n`);
    tls = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-local-provider-tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=huggingface.co', '-keyout', path.join(tls, 'k.pem'), '-out', path.join(tls, 'c.pem')], { stdio: 'ignore' });
    server = https.createServer({ key: fs.readFileSync(path.join(tls, 'k.pem')), cert: fs.readFileSync(path.join(tls, 'c.pem')) }, async (req, res) => {
      const host = (req.headers.host || '').replace(/:\d+$/, ''), u = new URL(req.url, `https://${host}`), h = req.headers;
      log.push({ method: req.method, host, path: u.pathname, range: h.range || null, origin: h.origin || null, cookie: !!h.cookie });
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range', 'access-control-expose-headers': '*' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (host === 'huggingface.co' && u.pathname === `/glaze-check/Tiny-GGUF/resolve/${COMMIT}/tiny.gguf`) {
        res.writeHead(302, { location: 'https://us.aws.cdn.hf.co/xet-bridge-us/check/tiny.gguf?Expires=1&Signature=s', 'access-control-allow-origin': h.origin || '*' });
        return res.end();
      }
      const m = host === 'us.aws.cdn.hf.co' && /^bytes=(\d+)-(\d+)$/.exec(h.range || '');
      if (m) {
        await pause(250);
        const a = +m[1], b = Math.min(+m[2], DATA.length - 1), body = DATA.subarray(a, b + 1);
        res.writeHead(206, { ...cors, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${DATA.length}`, 'content-type': 'application/octet-stream', 'content-length': body.length });
        return res.end(body);
      }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    // The copy: its models.json, the stubs, and a 4 s idle (a file written into it replaces its link, never the source's).
    ext = env.staged(root, []);
    const put = (f, text) => { fs.rmSync(path.join(ext, f), { force: true }); fs.writeFileSync(path.join(ext, f), text); };
    put('ai/local/models.json', `${JSON.stringify({ models: [MODEL] }, null, 2)}\n`);
    put('ai/local/engine.js', ENGINE);
    put('ai/local/ladder.js', LADDER);
    const link = fs.readFileSync(path.join(root, 'ai/local/link.js'), 'utf8');
    assert.ok(link.includes('idle: 300000'), 'link.js names its idle time');
    put('ai/local/link.js', link.replace('idle: 300000', 'idle: 4000'));

    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-local-provider-profile-'));
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
    const G = require(path.join(root, 'content/defaults.js'));
    await worker.evaluate(async ({ settings, data }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set(data); },
      { settings: G.GZ_SANITIZE({ preset: 'Frost', enhance: { ...G.GZ_DEFAULTS.enhance, writer: true } }), data: records() });
    const offscreen = async () => (await sw()).evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).map((c) => c.documentUrl));

    const settings = await context.newPage();
    settings.on('pageerror', (e) => errors.push(`settings: ${e.message}`));
    await settings.goto(`${base}/options.html#ai/setup`);
    // The engine's channel, heard in Settings (the same extension origin).
    await settings.evaluate(() => { window.__engine = []; new BroadcastChannel('glaze-check-engine').onmessage = (e) => window.__engine.push(e.data); });
    const note = () => settings.evaluate(() => document.querySelector('#ai-drawer .note')?.textContent || '');

    await step('the card: Glaze on-device AI after Chrome\'s, needing a download, its size shown; nothing fetched before the click', async () => {
      const cards = await settings.evaluate(() => [...document.querySelectorAll('#ai-providers .ai-prov b')].map((b) => b.textContent));
      assert.equal(cards[cards.indexOf('Glaze on-device AI') - 1], 'Chrome on-device AI', JSON.stringify(cards));
      await settings.click('#ai-prov-local');
      assert.match(await until(async () => { const n = await note(); return n.startsWith('Needs a download') && n; }, 'its state'), /^Needs a download · 0\.0 GB$/);
      await pause(800);
      assert.deepEqual(log, [], 'no request before Download');
      assert.deepEqual(await offscreen(), [], 'no engine host for a status');
      await settings.screenshot({ path: path.join(out, 'card-download.png') });
    });
    await step('Download: the model comes through the 302 and Range requests into OPFS in the engine host, its progress shown, then Ready', async () => {
      await settings.click('#ai-drawer button.primary');
      const shown = await until(() => settings.evaluate(() => { const b = document.querySelector('#ai-drawer progress'); return b && b.value > 0 && b.value < 1 && { value: b.value, note: document.querySelector('#ai-drawer .note').textContent }; }), 'its progress');
      assert.match(shown.note, /^\d+% · 0\.0 GB$/);
      await settings.screenshot({ path: path.join(out, 'card-downloading.png') });
      await until(async () => (await note()).startsWith('Ready'), 'Ready', 30000);
      assert.deepEqual(await offscreen(), [`${base}/ai/local/host.html`], 'the offscreen document hosts it');
      const cdn = log.filter((l) => l.host === 'us.aws.cdn.hf.co' && l.method === 'GET');
      assert.equal(cdn.length, MODEL.sha256.length, 'one Range request a chunk');
      assert.ok(log.every((l) => !l.cookie), 'no cookies');
      assert.ok(log.filter((l) => l.host === 'huggingface.co').every((l) => l.origin === base), 'asked from the extension');
      const kept = await settings.evaluate(async (id) => { const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('glaze-models'); const own = await top.getDirectoryHandle(id); const names = []; for await (const [, d] of own.entries()) for await (const k of d.keys()) names.push(k); return names.sort(); }, MODEL.id);
      assert.deepEqual(kept, [...MODEL.sha256.map((_, i) => String(i)), 'ready'].sort());
      await settings.screenshot({ path: path.join(out, 'card-ready.png') });
    });
    await step('the host idles out: its offscreen document closes and the model is released', async () => {
      await until(async () => (await offscreen()).length === 0, 'the document closed', 15000);
    });

    const pg = await context.newPage();
    pg.on('pageerror', (e) => errors.push(`writer: ${e.message}`));
    pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`writer console: ${m.text()}`); });
    await step('Writer\'s gray text comes from Glaze\'s model: the fine-tune\'s prompt for writer.complete, streamed into the gray text, Tab takes it', async () => {
      await pg.goto(`${base}/papers.html?paper=${encodeURIComponent(KEY)}`);
      await until(() => pg.evaluate((k) => GZ_WRITER_PAPER?.current()?.key() === k && document.querySelectorAll('.gp-sheet').length > 0, KEY), 'the document open');
      await until(() => pg.evaluate(() => !!globalThis.GZ_WRITER_AI?.allowed?.('completion')), 'completion allowed and ready on Glaze\'s model', 30000);
      await pg.evaluate((text) => {
        const v = GZ_WRITER_FRAME.editor().view;
        let at = null;
        v.state.doc.descendants((n, pos) => { if (at === null && n.isTextblock && n.textContent.startsWith(text)) at = pos + n.nodeSize - 1; });
        v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at))); v.focus();
      }, LAST);
      await pg.keyboard.type(' it');
      const ghost = await until(() => pg.evaluate(() => document.querySelector('.gz-ghost')?.firstChild?.textContent ?? null), 'the gray text', 30000);
      assert.equal(ghost, GHOST);
      await pg.screenshot({ path: path.join(out, 'writer-ghost.png') });
      await pg.keyboard.press('Tab');
      await until(() => pg.evaluate((t) => { let s = null; GZ_WRITER_FRAME.editor().view.state.doc.descendants((n) => { if (s === null && n.isTextblock && n.textContent.startsWith(t)) s = n.textContent; }); return s?.endsWith(' it arrives uninvited and rearranges the present.'); }, LAST), 'Tab takes it');
      const heard = await settings.evaluate(() => window.__engine);
      const load = heard.find((m) => m.type === 'load'), fed = heard.filter((m) => m.type === 'prefill').at(-1)?.text || '';
      assert.deepEqual(load?.opts, ['context', 'signal'], 'Engine.load(gguf, { context, signal })');
      assert.ok(fed.startsWith('<|startoftext|><|im_start|>system\n<|gz_task:writer.complete|>'), fed.slice(0, 200));
      assert.ok(fed.endsWith('<|im_end|>\n<|im_start|>assistant\n'), fed.slice(-200));
      assert.ok(fed.includes('<|gz_data|>') && !fed.includes('<<<DATA-'), 'the fine-tune\'s fences, not the random one');
      assert.deepEqual(await offscreen(), [`${base}/ai/local/host.html`], 'the host started again for the run');
    });
    await step('Activity names the run: Tab completion · Glaze on-device AI, done', async () => {
      await settings.bringToFront();
      const row = await until(() => settings.evaluate(() => [...document.querySelectorAll('#ai-calls li')].map((li) => li.textContent).find((t) => t.includes('Glaze on-device AI'))), 'the row');
      assert.match(row, /^Tab completion · Glaze on-device AI/);
      assert.match(row, /Done/);
      await settings.screenshot({ path: path.join(out, 'activity.png') });
    });
    await step('Delete: the model goes from OPFS and the card needs a download again', async () => {
      await settings.click('#ai-prov-local'); await settings.click('#ai-prov-local');
      await until(async () => (await note()).startsWith('Ready'), 'Ready');
      await settings.getByRole('button', { name: 'Delete', exact: true }).click();
      await until(async () => (await note()).startsWith('Needs a download'), 'Needs a download');
      const left = await settings.evaluate(async (id) => { try { const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('glaze-models'); await top.getDirectoryHandle(id); return 'kept'; } catch (e) { return e.name; } }, MODEL.id);
      assert.equal(left, 'NotFoundError');
    });
    await step('no page errors, and no request but Hugging Face\'s', async () => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); });
  } catch (e) {
    results.push({ name: 'run', ok: false, error: e.stack }); console.log(`FAIL run\n  ${e.message}`);
  } finally {
    await context?.close().catch(() => {});
    server?.close();
    for (const d of [profile, tls, ext]) if (d) fs.rmSync(d, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    const passed = results.length > 0 && results.every((r) => r.ok);
    fs.writeFileSync(path.join(out, 'results.json'), `${JSON.stringify({ passed, results, errors, requests: log }, null, 2)}\n`);
    console.log(`local-provider-check: ${results.filter((r) => r.ok).length}/${results.length} passed`);
    process.exitCode = passed ? 0 : 1;
  }
})();
