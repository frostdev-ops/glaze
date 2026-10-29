// Writer completions at native-input boundaries, in WebKit (the default) or Chromium. All text and AI replies are
// invented; the actual Writer frame, ProseMirror editor and keyboard input run without an extension, provider or LMS.
// NODE_PATH=<playwright> node scripts/writer-completion-check.js [webkit|chromium]
// WRITER_AI_SOURCE may name a saved writer-ai.js to verify the same regression against an earlier implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const engines = require('playwright');
const root = path.resolve(__dirname, '..'), site = 'https://writer.test', engine = process.argv[2] || 'webkit';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const STUB = `(() => {
  const ai = window.__ai = { settings: { on: true, mode: 'advanced', tune: { completion: { pause: 100 } }, features: { completion: true, writing: false } },
    runs: [], cancels: [], held: [], hold: false, output: ' understand the formatting options clearly.' };
  const data = {}, local = { get: async () => ({ ...data, ai: ai.settings }), set: async (o) => Object.assign(data, o), remove: async (k) => { delete data[k]; } };
  window.chrome = { storage: { local, onChanged: { addListener() {} } }, runtime: {
    sendMessage: async (m) => m.type === 'glaze:writerPapers' ? { ok: true, value: await GZ_WRITER_PAPERS.open(local)[m.op](...m.args) } : { ok: true },
    connect() {
      const on = [], post = (m) => setTimeout(() => on.forEach((f) => f(m)), 0);
      return { onMessage: { addListener: (f) => on.push(f) }, onDisconnect: { addListener() {} }, disconnect() {}, postMessage(m) {
        if (m.op === 'status') return post({ id: m.id, type: 'status', allowed: true, ready: true, provider: 'apple' });
        if (m.op === 'warm') return post({ id: m.id, type: 'warmed' });
        if (m.op === 'cancel') { ai.cancels.push(m.id); return; }
        if (m.op !== 'run') return;
        ai.runs.push(m);
        // A cancelled provider may still deliver its already queued reply. The frame must discard it itself.
        const done = () => post({ id: m.id, type: 'end', output: ai.output });
        if (ai.hold) ai.held.push(done); else done();
      } };
    },
  } };
})();`;
const BASE = 'For this synthetic typing check I do not quite';
const filler = `<p>${'This invented paragraph examines a sample topic and explains a simple observation in clear language. '.repeat(12)}</p>`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

(async () => {
  assert.ok(['webkit', 'chromium'].includes(engine), 'choose webkit or chromium');
  const lock = require('./check-env.js').lockPath();
  fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
  let browser, checks = 0, failures = 0;
  try {
    browser = await engines[engine].launch({ headless: true, ...(engine === 'chromium' ? require('./check-env.js').chromeLaunch() : {}) });
    const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1100, height: 800 } }), errors = [];
    await context.addInitScript(STUB);
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url()), file = path.join(root, decodeURIComponent(u.pathname));
      if (u.origin !== site || !file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return r.abort();
      const source = u.pathname === '/writer-ai.js' && process.env.WRITER_AI_SOURCE || file;
      return r.fulfill({ contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(source) });
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${site}/writer.html`);
    await page.evaluate(({ base, filler }) => {
      const ch = new MessageChannel(); window.__page = { port: ch.port1 };
      window.postMessage({ type: 'glaze:writer', pass: 'p'.repeat(36) }, '*', [ch.port2]);
      setTimeout(() => ch.port1.postMessage({ type: 'init', mode: 'paper', kind: 'assignment', locale: 'en',
        html: `${filler.repeat(9)}<p>${base}</p><p>Works Cited</p><p>Sample source entry.</p>`,
        context: { kind: 'assignment', assignment: { id: 'synthetic-completion', title: 'Synthetic typing check' } }, look: { dark: false, motion: 'subtle' } }), 50);
    }, { base: BASE, filler });
    await page.waitForFunction(() => GZ_WRITER_AI.allowed('completion') && GZ_WRITER_PAPER.current()?.key());
    const text = () => page.evaluate(() => { const v = GZ_WRITER_FRAME.editor().view; return v.state.selection.$head.parent.textContent; });
    const ghost = () => page.evaluate(() => document.querySelector('.gz-ghost')?.firstChild?.textContent ?? null);
    const reset = async ({ hold = false, marked = false } = {}) => {
      await page.evaluate(({ base, hold, marked }) => {
        __ai.hold = hold; __ai.held = [];
        const v = GZ_WRITER_FRAME.editor().view; let pos;
        v.state.doc.descendants((n, p) => { if (n.isTextblock && n.textContent.startsWith(base)) pos = p; });
        const node = v.state.doc.nodeAt(pos), tr = v.state.tr.insertText(base, pos + 1, pos + node.nodeSize - 1);
        if (marked) tr.addMark(pos + 1, pos + 1 + base.length, v.state.schema.marks.italic.create());
        else tr.removeMark(pos + 1, pos + 1 + base.length);
        tr.setSelection(GZ_PM.state.TextSelection.create(tr.doc, pos + 1 + base.length));
        v.dispatch(tr.scrollIntoView()); v.focus();
      }, { base: BASE, hold, marked });
    };
    const show = async (options) => { await reset(options); await page.keyboard.type(' here'); await page.waitForSelector('.gz-ghost'); };
    const held = async () => { await reset({ hold: true }); await page.keyboard.type(' here'); await page.waitForFunction(() => __ai.held.length > 0); };
    const release = () => page.evaluate(() => { __ai.hold = false; __ai.held.splice(0).forEach((f) => f()); });
    const check = async (name, fn) => {
      checks++;
      try { await fn(); console.log(`ok ${engine}: ${name}`); }
      catch (e) { failures++; console.error(`FAIL ${engine}: ${name}\n${e.stack || e}`); }
    };
    await check('arrival in a multipage paper preserves the native caret, focus and document', async () => {
      await held();
      const before = await page.evaluate(() => { const v = GZ_WRITER_FRAME.editor().view, s = getSelection(); return { doc: v.state.doc.toJSON(), head: v.state.selection.head, focus: v.hasFocus(), node: s.focusNode.nodeName, offset: s.focusOffset }; });
      await release(); await page.waitForSelector('.gz-ghost');
      assert.deepEqual(await page.evaluate(() => { const v = GZ_WRITER_FRAME.editor().view, s = getSelection(); return { doc: v.state.doc.toJSON(), head: v.state.selection.head, focus: v.hasFocus(), node: s.focusNode.nodeName, offset: s.focusOffset }; }), before);
      assert.ok(await page.locator('.gp-sheet').count() >= 5, 'a real multipage paper');
    });
    await check('matching input consumes the suggestion, and divergent input preserves every character', async () => {
      await show(); await page.keyboard.type(' under', { delay: 15 });
      assert.equal(await ghost(), 'stand the formatting options clearly.');
      await page.keyboard.type('x then keep typing', { delay: 15 });
      assert.equal(await text(), BASE + ' here underx then keep typing');
    });
    await check('Tab accepts the suggestion; the word shortcut leaves the rest available', async () => {
      await show(); await page.keyboard.press('Tab');
      assert.equal(await text(), BASE + ' here understand the formatting options clearly.');
      await show(); await page.keyboard.press(process.platform === 'darwin' ? 'Alt+ArrowRight' : 'Control+ArrowRight');
      assert.equal(await text(), BASE + ' here understand');
      assert.equal(await ghost(), ' the formatting options clearly.');
    });
    await check('a key starts cancelling before its document transaction exists', async () => {
      await held(); const before = await text();
      await page.evaluate(() => GZ_WRITER_FRAME.editor().view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true })));
      await release(); await pause(80);
      assert.equal(await ghost(), null, 'a queued reply cannot insert a widget between keydown and native input');
      assert.equal(await text(), before, 'the early guard does not perform the browser edit');
      await page.keyboard.type('q'); assert.equal(await text(), before + 'q');
    });
    for (const inputType of ['insertText', 'insertReplacementText', 'insertFromPaste']) await check(`${inputType} cancels a queued reply before native DOM input`, async () => {
      await held(); const before = await text();
      const allowed = await page.evaluate((inputType) => GZ_WRITER_FRAME.editor().view.dom.dispatchEvent(new InputEvent('beforeinput', { inputType, data: 'safe', bubbles: true, cancelable: true })), inputType);
      await release(); await pause(80);
      assert.equal(allowed, true, 'leave the native input uncancelled');
      assert.equal(await ghost(), null, 'a reply must not change the caret while native input is pending');
      assert.equal(await text(), before);
      await page.keyboard.type('safe'); assert.equal(await text(), before + 'safe');
    });
    await check('modifier keys alone do not discard a pending suggestion', async () => {
      await held();
      await page.evaluate(() => GZ_WRITER_FRAME.editor().view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true })));
      await release(); await page.waitForSelector('.gz-ghost'); assert.ok(await ghost());
    });
    await check('composition cancels an in-flight result before inserting any text', async () => {
      await held();
      await page.evaluate(() => GZ_WRITER_FRAME.editor().view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })));
      await release(); await pause(80); assert.equal(await ghost(), null);
      await page.evaluate(() => GZ_WRITER_FRAME.editor().view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
      await pause(50);
    });
    await check('repeated arrivals at an italic boundary preserve every native keystroke', async () => {
      let expected = BASE + ' here';
      await show({ marked: true });
      for (let i = 0; i < 12; i++) {
        const suffix = ` words continue marker${i}`;
        await page.keyboard.type(suffix, { delay: 5 }); expected += suffix;
        assert.equal(await text(), expected);
        await page.waitForSelector('.gz-ghost');
      }
    });
    await check('no page errors', () => assert.deepEqual(errors, []));
    console.log(`${checks - failures}/${checks} passed (${engine})`);
    process.exitCode = failures ? 1 : 0;
  } finally { try { await browser?.close(); } finally { fs.rmSync(lock, { recursive: true, force: true }); } }
})().catch((e) => { console.error(e); process.exitCode = 1; });
