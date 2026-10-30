// Glaze's own model in Chromium with Glaze loaded unpacked (a staged copy): Settings → AI's card, a download from its click
// through the real store into OPFS in the real engine host (an offscreen document's Worker), and the real worker's broker
// and local provider answering Writer's gray text in a document from the Documents home. The engine and the tier ladder
// are stubs written into the copy over ai/local/engine.js and ladder.js (the runner has no GPU): the engine reads the prompt
// the host tokenized and answers only when it is the fine-tune's format for writer.complete. The model is a tiny GGUF of a
// byte-level vocabulary, served by this process playing Hugging Face (huggingface.co's 302 to its CDN's 206 Range replies,
// as probe 4 measured), slowly, so the download's progress shows. The host idles out after 4 s in the copy (5 minutes as
// shipped), so its offscreen document is seen to close, and a later run starts it again. Every step is reported.
//   glaze-remote -o <evidence> -- node checks/ai/local-provider-check.js /out
// GLAZE_REAL_MODEL=<a real LFM3 .gguf> (on a machine with a GPU; GLAZE_GPU_FLAGS: Chromium's flags for it, e.g.
// checks/ai/local-engine-check.js's nvidia set): the real engine instead of the stub, that file served as the download with
// its own 64 MB chunk hashes, and Writer's run held only to reaching the engine and finishing (done, or refused by Writer's
// check: the stock model isn't the fine-tune its prompt is written for) instead of the stub's sentence.
// Pictures: the card's picture download (a tiny LFM3-VL GGUF and projector, served the same way) from its own click, then
// writer.image through the worker's broker from a Glaze page: the picture (a PNG made here) decoded by the browser in the
// engine host's Worker, sized and encoded by a stub encoder written over ai/local/vision.js, fed to the stub engine between
// <|vision_start|> and <|vision_end|> after the text model was let go, and the answer the task's own, checked.
// GLAZE_REAL_VL=<LFM3-VL .gguf> and GLAZE_REAL_MMPROJ=<its mmproj .gguf> (with GLAZE_REAL_MODEL): the real files, engine
// and encoder; GLAZE_PICTURES=<folder of .png/.jpg> reads each with writer.image and writes pictures.json (each output,
// whether it is the schema's, its time) beside the results.
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
const gguf = ({ arch = 'lfm3', tokens = TOKENS, types = TYPES } = {}) => {
  const parts = [], u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); }, i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); parts.push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); parts.push(b); };
  const kv = [
    ['general.architecture', 8, () => str(arch)],
    ...(tokens.length ? [['tokenizer.ggml.model', 8, () => str('gpt2')], ['tokenizer.ggml.pre', 8, () => str('lfm2')],
      ['tokenizer.ggml.tokens', 9, () => { u32(8); u64(tokens.length); tokens.forEach(str); }],
      ['tokenizer.ggml.token_type', 9, () => { u32(5); u64(types.length); types.forEach(i32); }],
      ['tokenizer.ggml.merges', 9, () => { u32(8); u64(0); }],
      ['tokenizer.ggml.bos_token_id', 4, () => u32(tokens.indexOf('<|startoftext|>'))], ['tokenizer.ggml.eos_token_id', 4, () => u32(tokens.indexOf('<|im_end|>'))]] : []),
    ['glaze.check.pad', 8, () => str('x'.repeat(2 << 20))], // a model big enough for its download to take a moment
  ];
  parts.push(Buffer.from('GGUF')); u32(3); u64(0); u64(kv.length);
  for (const [k, t, w] of kv) { str(k); u32(t); w(); }
  const body = Buffer.concat(parts);
  return Buffer.concat([body, Buffer.alloc((32 - (body.length % 32)) % 32)]);
};
const REAL = process.env.GLAZE_REAL_MODEL ? path.resolve(process.env.GLAZE_REAL_MODEL) : null;
const REAL_VL = REAL && process.env.GLAZE_REAL_VL ? [path.resolve(process.env.GLAZE_REAL_VL), path.resolve(process.env.GLAZE_REAL_MMPROJ || '')] : null;
const PICTURES = process.env.GLAZE_PICTURES ? path.resolve(process.env.GLAZE_PICTURES) : null;
const PICS = !REAL || !!REAL_VL; // the picture steps: with the stubs, or with the real picture files
const CHUNK = REAL ? 64 << 20 : 256 << 10, COMMIT = 'c'.repeat(40);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// A served file: its bytes a..b (inclusive), from memory (the tiny GGUFs) or a real file.
const served = (from) => {
  const size = Buffer.isBuffer(from) ? from.length : fs.statSync(from).size;
  const slice = (a, b) => {
    if (Buffer.isBuffer(from)) return from.subarray(a, b + 1);
    const buf = Buffer.alloc(b - a + 1), fd = fs.openSync(from, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, a); } finally { fs.closeSync(fd); }
    return buf;
  };
  const all = crypto.createHash('sha256'), parts = [];
  for (let i = 0; i * CHUNK < size; i++) { const b = slice(i * CHUNK, Math.min(size, (i + 1) * CHUNK) - 1); parts.push(sha(b)); all.update(b); }
  return { size, slice, sha256: parts, total: all.digest('hex') };
};
// The tiny picture model: the text model's vocabulary with LFM3-VL's two vision tokens; its projector, a clip GGUF.
const VL_TOKENS = { tokens: [...TOKENS, '<|vision_start|>', '<|vision_end|>'], types: [...TYPES, 3, 3] };
const FILES = {
  'tiny.gguf': served(REAL || gguf()),
  ...(PICS && { 'tiny-vl.gguf': served(REAL_VL ? REAL_VL[0] : gguf(VL_TOKENS)), 'tiny-mmproj.gguf': served(REAL_VL ? REAL_VL[1] : gguf({ arch: 'clip', tokens: [], types: [] })) }),
};
const entry = (file, extra) => ({ repo: 'glaze-check/Tiny-GGUF', commit: COMMIT, file, url: `https://huggingface.co/glaze-check/Tiny-GGUF/resolve/${COMMIT}/${file}`,
  size: FILES[file].size, chunk: CHUNK, sha256: FILES[file].sha256, total: FILES[file].total, license: 'lfm1.0', ...extra });
const MODEL = { id: 'check-tiny', name: 'Check tiny', ...entry('tiny.gguf', { quant: 'Q4_K_M', tier: 1 }) };
const VL = PICS && { id: 'check-vl', name: 'Check VL', ...entry('tiny-vl.gguf', { quant: 'Q4_K_M', role: 'pictures', projector: 'check-mmproj', stock: true }) };
const MMPROJ = PICS && { id: 'check-mmproj', name: 'Check projector', ...entry('tiny-mmproj.gguf', { quant: 'F16', role: 'projector' }) };
// A 3 × 2 PNG: red, green, blue over white, black, half-transparent grey; the host reads it back with the browser.
const PNG = (() => {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4), sum = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(td)); return Buffer.concat([len, td, sum]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(3, 0); head.writeUInt32BE(2, 4); head.set([8, 6, 0, 0, 0], 8);
  const rows = [[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255], [255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 128]];
  const raw = Buffer.concat(rows.map((r) => Buffer.from([0, ...r])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', require('node:zlib').deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();
const HOSTS = ['huggingface.co', 'us.aws.cdn.hf.co'];

// ---- the stubs written into the copy -----------------------------------------------------------------------------------------
// The engine (docs/ai-harness.md): reads what the host fed it with Glaze's tokenizer, tells the check over a channel, and
// answers writer.complete's reply only for the fine-tune's format.
// A picture prompt (the stock template, the picture between the vision tokens) is answered with writer.image's reading.
const READING = { description: 'Three coloured squares over white, black and grey.', requirements: [], complete: true, reason: '', relevance: 'relevant' };
const ENGINE = `var GZ_AI_ENGINE = { load: async (g, opts) => {
  const tok = GZ_AI_TOKENIZER.fromGGUF(g.kv); for (const n of GZ_AI_TOKENIZER.GLAZE_TOKENS) tok.add(n);
  const vision = tok.id('<|vision_start|>') !== undefined;
  const say = new BroadcastChannel('glaze-check-engine'); say.postMessage({ type: 'load', vision, opts: Object.keys(opts).sort() });
  let seen = [], reply = [], i = 0, pos = 0;
  const snap = (p, s) => ({ pos: p, seen: s.slice(), drop() {} });
  return { context: 16000, device: { stub: true },
    prefill: async (ids, { snapshot, embeds = [] } = {}) => {
      const at = seen.length; seen.push(...ids); pos += ids.length; const text = tok.decode(seen, { specials: true });
      const around = embeds.map((e) => [tok.decode([seen[at + e.at - 1]], { specials: true }), tok.decode([seen[at + e.at + e.tokens]], { specials: true }), e.tokens]);
      say.postMessage({ type: 'prefill', n: ids.length, text, vision, embeds: around });
      reply = /<\\|gz_task:writer\\.complete\\|>/.test(text) && /<\\|gz_data\\|>/.test(text) && !/<<<DATA-/.test(text) ? [...tok.encode('it arrives uninvited and rearranges the present. Then the river takes it back.')]
        : vision && around.length && around.every(([a, b]) => a === '<|vision_start|>' && b === '<|vision_end|>') ? [...tok.encode(${JSON.stringify(JSON.stringify(READING))})] : [];
      i = 0; return snapshot ? snap(pos, seen) : undefined; },
    decode: async ({ sampler }) => { pos++; return i < reply.length ? reply[i++] : tok.eos; },
    snapshot: async () => snap(pos, seen), restore: async (s) => { pos = s.pos; seen = s.seen.slice(); },
    release: () => { say.postMessage({ type: 'release', vision }); } };
} };`;
// The encoder (vision.js's interface): four tokens a picture; it tells the check the pixels the host decoded.
const VISION = `var GZ_AI_VISION = { load: async (g, opts) => {
  const say = new BroadcastChannel('glaze-check-engine'); say.postMessage({ type: 'vision', arch: g.kv['general.architecture'], opts: Object.keys(opts).sort(), device: !!opts.device?.stub });
  return { prepare: ({ width, height }) => ({ width, height, tokens: 4 }),
    encode: async (img) => { say.postMessage({ type: 'encode', width: img.width, height: img.height, pixels: Array.from(img.data) }); return { tokens: 4, width: img.width, height: img.height, buffer: {}, drop() {} }; },
    release: () => { say.postMessage({ type: 'vision-release' }); } };
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
      const asked = u.pathname.split('/').pop();
      if (host === 'huggingface.co' && u.pathname === `/glaze-check/Tiny-GGUF/resolve/${COMMIT}/${asked}` && Object.hasOwn(FILES, asked)) {
        res.writeHead(302, { location: `https://us.aws.cdn.hf.co/xet-bridge-us/check/${asked}?Expires=1&Signature=s`, 'access-control-allow-origin': h.origin || '*' });
        return res.end();
      }
      const m = host === 'us.aws.cdn.hf.co' && Object.hasOwn(FILES, asked) && /^bytes=(\d+)-(\d+)$/.exec(h.range || '');
      if (m) {
        await pause(250);
        const f = FILES[asked], a = +m[1], b = Math.min(+m[2], f.size - 1), body = f.slice(a, b);
        res.writeHead(206, { ...cors, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${f.size}`, 'content-type': 'application/octet-stream', 'content-length': body.length });
        return res.end(body);
      }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    // The copy: its models.json, the stubs, and a 4 s idle (a file written into it replaces its link, never the source's).
    ext = env.staged(root, []);
    const put = (f, text) => { fs.rmSync(path.join(ext, f), { force: true }); fs.writeFileSync(path.join(ext, f), text); };
    put('ai/local/models.json', `${JSON.stringify({ models: [MODEL, ...(PICS ? [VL, MMPROJ] : [])] }, null, 2)}\n`);
    if (!REAL) { put('ai/local/engine.js', ENGINE); put('ai/local/vision.js', VISION); }
    put('ai/local/ladder.js', LADDER);
    const link = fs.readFileSync(path.join(root, 'ai/local/link.js'), 'utf8');
    assert.ok(link.includes('idle: 300000'), 'link.js names its idle time');
    put('ai/local/link.js', link.replace('idle: 300000', 'idle: 4000'));

    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-local-provider-profile-'));
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, { ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US',
      args: [...(process.env.GLAZE_GPU_FLAGS || '').split(' ').filter(Boolean), `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking',
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
    const note = () => settings.evaluate(() => document.querySelector('#ai-drawer .line.own:not(#ai-local-pictures) .note')?.textContent || '');
    const picNote = () => settings.evaluate(() => document.querySelector('#ai-local-pictures .note')?.textContent || '');

    await step('the card: Glaze on-device AI after Chrome\'s, needing a download, its size shown; nothing fetched before the click', async () => {
      const cards = await settings.evaluate(() => [...document.querySelectorAll('#ai-providers .ai-prov b')].map((b) => b.textContent));
      assert.equal(cards[cards.indexOf('Glaze on-device AI') - 1], 'Chrome on-device AI', JSON.stringify(cards));
      await settings.click('#ai-prov-local');
      assert.match(await until(async () => { const n = await note(); return n.startsWith('Needs a download') && n; }, 'its state'), REAL ? /^Needs a download · \d+\.\d GB$/ : /^Needs a download · 0\.0 GB$/);
      await pause(800);
      assert.deepEqual(log, [], 'no request before Download');
      assert.deepEqual(await offscreen(), [], 'no engine host for a status');
      await settings.screenshot({ path: path.join(out, 'card-download.png') });
    });
    await step('Download: the model comes through the 302 and Range requests into OPFS in the engine host, its progress shown, then Ready', async () => {
      await settings.click('#ai-drawer .line.own:not(#ai-local-pictures) button.primary');
      const shown = await until(() => settings.evaluate(() => { const b = document.querySelector('#ai-drawer progress'); return b && b.value > 0 && b.value < 1 && { value: b.value, note: document.querySelector('#ai-drawer .line.own .note').textContent }; }), 'its progress');
      assert.match(shown.note, REAL ? /^\d+% · \d+\.\d GB$/ : /^\d+% · 0\.0 GB$/);
      await settings.screenshot({ path: path.join(out, 'card-downloading.png') });
      await until(async () => (await note()).startsWith('Ready'), 'Ready', REAL ? 600000 : 30000);
      assert.deepEqual(await offscreen(), [`${base}/ai/local/host.html`], 'the offscreen document hosts it');
      const cdn = log.filter((l) => l.host === 'us.aws.cdn.hf.co' && l.method === 'GET' && l.path.endsWith('/tiny.gguf'));
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
      if (REAL) {
        // The stock model isn't the fine-tune the prompt is written for, so Writer's check may refuse its words: the run
        // must reach the real engine and finish (done, or check), never fail or find the engine unavailable.
        const calls = async () => (await (await sw()).evaluate(() => chrome.storage.local.get('aiCalls'))).aiCalls || [];
        const call = await until(async () => (await calls()).find((c) => c.provider === 'local' && c.task === 'writer.complete' && c.state && c.state !== 'running'), 'the local run finished', 180000);
        console.log(`     the real engine's run: ${JSON.stringify(call)}`);
        assert.ok(['done', 'check'].includes(call.state), `state ${call.state}`);
        const ghost = await pg.evaluate(() => document.querySelector('.gz-ghost')?.firstChild?.textContent || null);
        console.log(`     gray text: ${JSON.stringify(ghost)}`);
        await pg.screenshot({ path: path.join(out, 'writer-ghost.png') });
        return;
      }
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
      if (!REAL) assert.match(row, /Done/);
      await settings.screenshot({ path: path.join(out, 'activity.png') });
    });
    // ---- pictures ----
    // writer.image through the worker's broker, from this Glaze page (a top frame of the extension, as Writer's own pages).
    let asks = 0;
    const read = (name, image) => settings.evaluate(({ name, image, id, ms }) => new Promise((resolve) => {
      const p = chrome.runtime.connect({ name: 'glaze:ai' }), t0 = performance.now();
      const timer = setTimeout(() => { p.disconnect(); resolve({ type: 'error', error: 'check-timeout', ms }); }, ms);
      p.onMessage.addListener((m) => { if (m.id === id && (m.type === 'end' || m.type === 'error')) { clearTimeout(timer); p.disconnect(); resolve({ ...m, ms: Math.round(performance.now() - t0) }); } });
      p.postMessage({ id, op: 'run', feature: 'writing', task: 'writer.image', input: { name, image, context: 'Read the attached picture for this assignment.' } });
    }), { name, image, id: ++asks, ms: REAL ? 300000 : 30000 });
    const caps = () => settings.evaluate(() => new Promise((resolve) => {
      const p = chrome.runtime.connect({ name: 'glaze:ai' });
      p.onMessage.addListener((m) => { if (m.id === 1) { p.disconnect(); resolve(m); } });
      p.postMessage({ id: 1, op: 'status', feature: 'writing' });
    }));
    if (PICS) {
      await step('the picture row: Needs a download with its size; nothing fetched before its click; caps.images false', async () => {
        await settings.evaluate(async () => { const { ai } = await chrome.storage.local.get('ai'); await chrome.storage.local.set({ ai: { ...ai, features: { ...ai.features, writing: true } } }); });
        await settings.click('#ai-prov-local'); await settings.click('#ai-prov-local');
        await until(async () => (await note()).startsWith('Ready'), 'Ready');
        const size = ((VL.size + MMPROJ.size) / 1e9).toFixed(1).replace('.', '\\.');
        assert.match(await until(async () => { const n = await picNote(); return n.startsWith('Needs a download') && n; }, 'its state'), new RegExp(`^Needs a download · ${size} GB$`));
        assert.equal(log.filter((l) => /tiny-(vl|mmproj)/.test(l.path)).length, 0, 'no request for it before Download');
        const st = await caps();
        assert.deepEqual([st.ready, st.provider, st.caps.images], [true, 'local', false], JSON.stringify(st));
        await settings.screenshot({ path: path.join(out, 'card-pictures-download.png') });
      });
      await step('the picture Download: projector and LFM3-VL through Hugging Face into OPFS, its own progress, Ready; caps.images true', async () => {
        await settings.click('#ai-local-pictures button.primary');
        await until(() => settings.evaluate(() => { const b = document.querySelector('#ai-drawer progress'); return b && b.getAttribute('aria-label') === 'Picture reading' && b.value > 0 && b.value < 1; }), 'its progress');
        assert.ok((await note()).startsWith('Ready'), 'the text model stays ready');
        await settings.screenshot({ path: path.join(out, 'card-pictures-downloading.png') });
        await until(async () => (await picNote()).startsWith('Ready'), 'Ready', REAL ? 600000 : 30000);
        for (const m of [VL, MMPROJ]) {
          assert.equal(log.filter((l) => l.host === 'us.aws.cdn.hf.co' && l.method === 'GET' && l.path.endsWith(`/${m.file}`)).length, m.sha256.length, `one Range request a chunk of ${m.file}`);
          const kept = await settings.evaluate(async (id) => { const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('glaze-models'); const own = await top.getDirectoryHandle(id); const names = []; for await (const [, d] of own.entries()) for await (const k of d.keys()) names.push(k); return names.length; }, m.id);
          assert.equal(kept, m.sha256.length + 1, `${m.id} whole in OPFS`);
        }
        const st = await caps();
        assert.deepEqual([st.ready, st.caps.images], [true, true], JSON.stringify(st));
        await settings.screenshot({ path: path.join(out, 'card-pictures-ready.png') });
      });
      await step('writer.image runs on Glaze\'s model: the PNG decoded in the host\'s Worker, encoded, fed between the vision tokens; the text model let go first', async () => {
        await settings.evaluate(() => { window.__engine = []; });
        const r = await read('squares.png', { mime: 'image/png', data: PNG.toString('base64') });
        console.log(`     writer.image: ${JSON.stringify(r).slice(0, 400)}`);
        assert.equal(r.type, 'end', JSON.stringify(r));
        if (!REAL) {
          assert.deepEqual(r.output, READING);
          const heard = await settings.evaluate(() => window.__engine);
          const vision = heard.find((m) => m.type === 'vision'), enc = heard.find((m) => m.type === 'encode');
          assert.deepEqual([vision?.arch, vision?.opts, vision?.device], ['clip', ['device', 'kernels', 'signal'], true], JSON.stringify(vision));
          assert.deepEqual([enc?.width, enc?.height], [3, 2]);
          assert.deepEqual(enc.pixels.slice(0, 20), [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255], 'the browser\'s pixels, row by row');
          assert.ok(enc.pixels.slice(20).every((v, i) => Math.abs(v - 128) <= 1), `alpha kept as decoded: ${enc.pixels.slice(20)}`);
          const fed = heard.filter((m) => m.type === 'prefill' && m.vision).at(-1);
          assert.deepEqual(fed?.embeds, [['<|vision_start|>', '<|vision_end|>', 4]]);
          assert.ok(fed.text.startsWith('<|startoftext|><|im_start|>system\nDescribe only the attached picture.') && !fed.text.includes('<|gz_'), fed.text.slice(0, 200));
          // One model at a time: a load while another is held follows its release (the host may have idled out before).
          const order = heard.filter((m) => ['load', 'release'].includes(m.type)).map((m) => `${m.type}${m.vision ? ' vl' : ''}`);
          let held = 0;
          for (const e of order) { held = e.startsWith('load') ? held + 1 : Math.max(0, held - 1); assert.ok(held <= 1, `one model at a time: ${order}`); }
          assert.ok(order.includes('load vl'), `LFM3-VL loaded: ${order}`);
        }
        const calls = (await (await sw()).evaluate(() => chrome.storage.local.get('aiCalls'))).aiCalls || [];
        assert.ok(calls.some((c) => c.task === 'writer.image' && c.provider === 'local' && c.state === 'completed'), JSON.stringify(calls.slice(0, 3)));
      });
      if (PICTURES) await step(`the picture set (${PICTURES}): each read by writer.image, its output the schema's`, async () => {
        const S = require(path.join(root, 'ai/schema.js')), W = require(path.join(root, 'ai/tasks/writer-image.js'));
        const rows = [];
        for (const f of fs.readdirSync(PICTURES).filter((x) => /\.(png|jpe?g)$/i.test(x)).sort()) {
          const r = await read(f, { mime: /\.png$/i.test(f) ? 'image/png' : 'image/jpeg', data: fs.readFileSync(path.join(PICTURES, f)).toString('base64') });
          const valid = r.type === 'end' && S.validate(r.output, W.SCHEMA).length === 0;
          rows.push({ picture: f, valid, ms: r.ms, ...(r.type === 'end' ? { output: r.output } : { error: r.error, reason: r.reason }) });
          console.log(`     ${valid ? 'valid  ' : 'INVALID'} ${f} (${r.ms} ms): ${JSON.stringify(r.output || r).slice(0, 300)}`);
        }
        fs.writeFileSync(path.join(out, 'pictures.json'), `${JSON.stringify(rows, null, 2)}\n`);
        assert.ok(rows.length && rows.every((x) => x.valid), `${rows.filter((x) => x.valid).length}/${rows.length} schema-valid`);
      });
      await step('the picture Delete: its files go, the text model stays, caps.images false again', async () => {
        await settings.locator('#ai-local-pictures').getByRole('button', { name: 'Delete', exact: true }).click();
        await until(async () => (await picNote()).startsWith('Needs a download'), 'Needs a download');
        assert.ok((await note()).startsWith('Ready'));
        const left = await settings.evaluate(async () => { const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('glaze-models'); const out = []; for await (const [k, h] of top.entries()) if (h.kind === 'directory') out.push(k); return out.sort(); });
        assert.deepEqual(left, [MODEL.id]);
        assert.equal((await caps()).caps.images, false);
      });
    }
    await step('Delete: the model goes from OPFS and the card needs a download again', async () => {
      await settings.click('#ai-prov-local'); await settings.click('#ai-prov-local');
      await until(async () => (await note()).startsWith('Ready'), 'Ready');
      await settings.locator('#ai-drawer .line.own:not(#ai-local-pictures)').getByRole('button', { name: 'Delete', exact: true }).click();
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
