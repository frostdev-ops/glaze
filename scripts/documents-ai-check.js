// Glaze Writer's AI, proofing and Cite lookups in documents opened from the Documents home (papers.html?paper=<key>, by
// their card), in the real unpacked extension: a standalone document (doc:) and an assignment's paper. The worker's own AI
// broker, sender check and Writer tasks run on the on-device provider, over a stand-in for Chrome's Prompt API
// (LanguageModel) put into the worker; Harper runs in its SharedWorker; Cite's DOI lookup goes through the worker to
// doi.org's saved synthetic answer (test/fixtures/writer-cite-doi.json). Per document: the AI port admitted (completion
// and writing allowed and ready), the gray text taken with Tab, Feedback's one line without assignment material, Check
// with AI's anchored issue, the AI outline's labels, Harper's spelling mark in the text and in Checks, and the lookup; and
// Sources: the assignment's paper has what its attempt saved (lib/writer-sources.js keys it by the paper, as the attempt's
// frame does), so Checks finds its citation's entry, and adds and removes there; the standalone document keeps its own.
// Every step is reported, passed or failed, so a run before a fix shows each missing part. No other network.
// NODE_PATH=<playwright> nice -n 10 node scripts/documents-ai-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-documents-ai-check');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const results = [], errors = [], unexpected = [], lookups = [], visuals = [];
let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 12000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const step = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`ok ${name}`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
};

// ---- the documents: a standalone one and an assignment's paper, the same prose in each
const p = (text, attrs) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(text ? { content: [{ type: 'text', text }] } : {}) });
const OPEN = 'Reading notes on Beloved';
const MISSPELT = 'I agree that the river works as a kind of archive, but I think Morrison is definately less interested in nostalgia than in what the town chooses to forget, and the clearing seem to collect that price.';
const LAST = 'When Sethe returns to the clearing, the memory is not something she owns;';
const GHOST = ' arrives uninvited and rearranges the present.';
const NOTES = `doc:${crypto.randomUUID()}`, ESSAY = 'bb.school.test|_900_1|_101_1|_7_1';
// The sources the essay's attempt saved, under the key its frame keeps them by (test/papers-sources.test.js), and a
// citation of one in the essay.
const SR = require(path.join(root, 'lib/writer-sources.js'));
const ATTEMPT_SOURCES = 'writer:sources:bb.school.test|_900_1|_101_1|_7_1', LOCAL_SOURCES = (key) => `writer:sources:local|local|papers|${encodeURIComponent(key)}`;
const SAVED = SR.normalize({ type: 'book', title: 'Beloved', author: [{ family: 'Morrison', given: 'Toni' }], publisher: 'Knopf', issued: { 'date-parts': [[1987]] } });
const CITED = 'Paul D says the house holds what Sethe will not name (Morrison 35).';
const NOW = Date.now(), HOUR = 3600e3;
const DOCS = [
  { key: NOTES, label: 'standalone document', title: 'Reading notes', named: true, format: 'plain', updated: NOW - HOUR,
    doc: { type: 'doc', content: [p(OPEN), p(MISSPELT), p(LAST)] } },
  { key: ESSAY, label: 'assignment paper', title: 'Essay 2: Memory in Beloved', courseName: 'ENGL 2110', format: 'mla9', updated: NOW - 2 * HOUR, due: '2026-11-02T04:59:00.000Z',
    url: 'https://bb.school.test/ultra/courses/_101_1/outline', school: 'bb.school.test', user: '_900_1', course: '_101_1', content: '_7_1',
    doc: { type: 'doc', content: [p('Alex Rivera', { first: 0 }), p('Dr. Okafor', { first: 0 }), p('ENGL 2110', { first: 0 }), p('12 October 2026', { first: 0 }), p('Memory in Beloved', { align: 'center' }), p(OPEN), p(CITED), p(MISSPELT), p(LAST)] } },
];
const words = (doc) => JSON.stringify(doc).match(/"text":"([^"]*)"/g).map((m) => m.slice(8, -1)).join(' ').split(/\s+/).filter(Boolean).length;
const records = () => {
  const all = {}, index = [];
  for (const d of DOCS) {
    const { label: _, ...rec } = d;
    all[`writerPaper:${d.key}`] = { ...rec, kind: 'paper', named: d.named === true, courseName: d.courseName || '', url: d.url || '', words: words(d.doc), keep: false, created: d.updated - HOUR, revision: 2, edited: 2, submitted: null };
    index.push({ key: d.key, kind: 'paper', named: d.named === true, title: d.title, course: d.courseName || '', url: d.url || '', words: words(d.doc), format: d.format, updated: d.updated, submitted: null });
  }
  all.writerPapers = index;
  all[ATTEMPT_SOURCES] = { sources: [SAVED], at: NOW };
  // Settings → AI: on, the model on this computer for every feature, completion and Feedback on (the outline's own switch
  // defaults on).
  all.ai = { on: true, model: { use: 'device' }, features: { completion: true, writing: true } };
  return all;
};

// In the worker: Chrome's Prompt API as lib/ai/providers/device.js reads it, answering each Writer task as a model would.
const INSTALL = () => {
  if (globalThis.__lm) return 'kept';
  const lm = globalThis.__lm = { creates: 0, prompts: [] };
  const TASKS = [['You predict how the sentence', 'writer.complete'], ['You proofread a student', 'writer.review'], ['Describe only the supplied existing section', 'writer.outline'], ['You settle one spelling or grammar call', 'writer.decide']];
  const reply = (task, system, text) => {
    if (task === 'writer.complete') return 'it arrives uninvited and rearranges the present. Then the river takes it back.';
    if (task === 'writer.review') return JSON.stringify({ issues: [{ quote: 'seem', before: 'the clearing', after: 'to collect', kind: 'grammar', message: 'Agreement.', suggestions: ['seems'] }] });
    if (task === 'writer.outline') {
      const heading = /definately/.test(text) ? 'Memory and forgetting' : /Sethe returns/.test(text) ? 'Returning to the clearing' : 'Opening notes';
      return JSON.stringify(/only "role"/.test(system) ? { role: 'body' } : { heading, role: 'body' });
    }
    if (task === 'writer.decide') return JSON.stringify({ verdict: 'keep', choice: null });
    return '';
  };
  const textOf = (input) => (Array.isArray(input) ? input : [input]).flatMap((m) => (typeof m === 'string' ? [m] : Array.isArray(m?.content) ? m.content.map((x) => (typeof x?.value === 'string' ? x.value : '')) : [])).join('\n');
  const LM = {
    availability: async (o = {}) => (o.expectedInputs?.some((i) => i.type === 'image') ? 'unavailable' : 'available'),
    params: async () => ({ defaultTopK: 3, maxTopK: 8, defaultTemperature: 1, maxTemperature: 2 }),
    create: async (o = {}) => {
      lm.creates++;
      const system = (o.initialPrompts || []).filter((x) => x.role === 'system').map((x) => x.content).join('\n');
      const task = TASKS.find(([mark]) => system.includes(mark))?.[1] || '';
      const answer = (input) => { const out = reply(task, system, textOf(input)); lm.prompts.push(task || system.slice(0, 60)); return out; };
      return { contextWindow: 100000, contextUsage: 10, measureContextUsage: async () => 200, destroy() {}, addEventListener() {}, removeEventListener() {},
        prompt: async (input) => answer(input),
        promptStreaming: (input) => { const text = answer(input); return new ReadableStream({ start(c) { if (text) c.enqueue(text); c.close(); } }); } };
    },
  };
  Object.defineProperty(globalThis, 'LanguageModel', { value: LM, configurable: true, writable: true });
  return 'installed';
};

// In each page, before its scripts: the 'glaze:ai' port as the page sees it (opened, statuses heard, runs sent).
const TAP = () => {
  const ai = globalThis.__aiTap = { ports: 0, statuses: [], runs: [], disconnects: 0 };
  const proof = globalThis.__proofTap = { opens: 0, closes: 0, port: null };
  const Shared = globalThis.SharedWorker;
  if (Shared) globalThis.SharedWorker = class extends Shared {
    constructor(...a) {
      super(...a);
      if (a[1]?.name !== 'glaze-harper') return;
      proof.opens++; proof.port = this.port;
      this.port.addEventListener('message', ({ data }) => { if (data?.op === 'closing') proof.closes++; });
    }
  };
  try {
    const connect = chrome.runtime.connect.bind(chrome.runtime);
    chrome.runtime.connect = (...a) => {
      const port = connect(...a);
      if (a[0]?.name !== 'glaze:ai') return port;
      ai.ports++;
      port.onMessage.addListener((m) => { if (m?.type === 'status') ai.statuses.push({ allowed: m.allowed, ready: m.ready, provider: m.provider }); });
      port.onDisconnect.addListener(() => { ai.disconnects++; });
      const post = port.postMessage.bind(port);
      port.postMessage = (m) => { if (m?.op === 'run') ai.runs.push({ task: m.task, kind: m.input?.kind, context: m.input?.context && JSON.parse(JSON.stringify(m.input.context)) }); return post(m); };
      return port;
    };
  } catch (e) { ai.error = String(e); }
};

(async () => {
  let context, held = false, tmp, ext;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\ndocuments-ai-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[documents-ai-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-documents-ai-'));
    fs.mkdirSync(out, { recursive: true });
    ext = require('./check-env.js').staged(root, []);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(12000);
    // doi.org's answer after its redirect, as scripts/writer-cite-check.js serves it; anything else is refused and listed.
    const ANSWERS = {
      'https://doi.org/10.5555/gz.2026.001': { status: 302, headers: { location: 'https://api.crossref.org/v1/works/10.5555%2Fgz.2026.001/transform' } },
      'https://api.crossref.org/v1/works/10.5555%2Fgz.2026.001/transform': { contentType: 'application/vnd.citationstyles.csl+json', body: fixture('writer-cite-doi.json') },
    };
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (ANSWERS[u.href] && req.method() === 'GET') { lookups.push(u.href); return r.fulfill({ ...ANSWERS[u.href], headers: { 'access-control-allow-origin': '*', ...ANSWERS[u.href].headers } }); }
      unexpected.push(`${req.method()} ${u.href}`);
      return r.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    // A worker that stops and starts again gets the stand-in before anything is asked of it.
    context.on('serviceworker', (w) => { w.evaluate(INSTALL).catch(() => {}); });
    const model = async () => (context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')).evaluate(INSTALL);
    const asked = async () => (context.serviceWorkers()[0] || worker).evaluate(() => globalThis.__lm?.prompts.slice() || []);
    const G = require(path.join(root, 'defaults.js'));
    const settings = G.GZ_SANITIZE({ preset: 'Frost', enhance: { ...G.GZ_DEFAULTS.enhance, writer: true } });
    await worker.evaluate(async ({ settings, data }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set(data); }, { settings, data: records() });
    await model();
    const HOME = `chrome-extension://${id}/papers.html`;

    const pages = [];
    for (const d of DOCS) {
      const tag = d.label;
      const pg = await context.newPage();
      pages.push(pg);
      pg.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
      pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
      await pg.addInitScript(TAP);
      await model();
      await pg.goto(HOME);
      await until(() => pg.evaluate((k) => !!document.querySelector(`.gd-card[data-key="${CSS.escape(k)}"] .gd-title`), d.key), `${tag}: its card on the home`);
      await pg.click(`.gd-card[data-key="${d.key.replace(/"/g, '\\"')}"] .gd-title`);
      await until(() => pg.evaluate((k) => new URLSearchParams(location.search).get('paper') === k && GZ_WRITER_PAPER?.current()?.key() === k && document.querySelectorAll('.gp-sheet').length > 0, d.key), `${tag}: opened from its card`);
      // The caret at the end of the last paragraph (an MLA paper may have more after it).
      const caret = () => pg.evaluate((text) => {
        const ed = GZ_WRITER_FRAME.editor(), v = ed.view;
        let at = null;
        v.state.doc.descendants((n, pos) => { if (at === null && n.isTextblock && n.textContent.startsWith(text)) at = pos + n.nodeSize - 1; });
        v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at)));
        v.focus();
        return at;
      }, LAST);
      const lastText = () => pg.evaluate((text) => { let s = null; GZ_WRITER_FRAME.editor().view.state.doc.descendants((n) => { if (s === null && n.isTextblock && n.textContent.startsWith(text)) s = n.textContent; }); return s; }, LAST);

      await step(`${tag}: the worker admits its AI port, completion and writing allowed and ready on the device model`, async () => {
        await until(() => pg.evaluate(() => !!globalThis.GZ_WRITER_AI?.allowed?.('completion') && GZ_WRITER_AI.allowed('writing')), 'GZ_WRITER_AI allows completion and writing');
        const tap = await pg.evaluate(() => globalThis.__aiTap);
        assert.ok(tap.ports >= 1 && tap.statuses.some((s) => s.allowed === true && s.ready === true && s.provider === 'device'), `port statuses ${JSON.stringify(tap)}`);
      });
      await step(`${tag}: Feedback says in one line that there is nothing to check against`, async () => {
        await pg.click('#gp-tab-feedback');
        const fb = await until(() => pg.evaluate(() => { const b = document.querySelector('#gp-feedback .gz-fb'); return b && !/Checking/.test(b.textContent) && { text: b.textContent, notes: b.querySelectorAll('.gz-fb-note').length, buttons: b.querySelectorAll('button').length }; }), 'the Feedback view');
        assert.deepEqual(fb, { text: 'No instructions or rubric to check against.', notes: 1, buttons: 0 });
        await pg.screenshot({ path: path.join(out, `${d.format}-feedback.png`) });
      });
      await step(`${tag}: Harper marks the misspelling in the text and lists it in Checks`, async () => {
        await caret();
        await until(() => pg.evaluate(() => GZ_WRITER_ISSUES.list().some((i) => i.source === 'harper' && i.kind === 'spelling' && i.text === 'definately')), 'Harper\'s spelling issue');
        await until(() => pg.evaluate(() => [...document.querySelectorAll('.ProseMirror .gz-iss.gz-iss-sp')].some((e) => e.textContent === 'definately')), 'the red underline');
        assert.equal(await pg.evaluate(() => getComputedStyle([...document.querySelectorAll('.ProseMirror .gz-iss-sp')].find((e) => e.textContent === 'definately')).textDecorationStyle), 'wavy', 'drawn wavy (writer-proof.css)');
        await pg.click('#gp-tab-checks');
        await until(() => pg.evaluate(() => [...document.querySelectorAll('#gp-checks .gp-issue s')].some((e) => e.textContent === 'definately')), 'the Checks card');
        const stats = await pg.evaluate(() => GZ_WRITER_PROOF.stats());
        assert.ok(stats?.worker && stats.loads >= 1, `Harper's worker answered (${JSON.stringify(stats)})`);
      });
      await step(`${tag}: the gray text finishes the sentence after the pause and Tab takes it`, async () => {
        await caret();
        await pg.keyboard.type(' it');
        const ghost = await until(() => pg.evaluate(() => document.querySelector('.gz-ghost')?.firstChild?.textContent ?? null), 'the gray text');
        assert.equal(ghost, GHOST);
        assert.deepEqual(await pg.evaluate(() => { const g = getComputedStyle(document.querySelector('.gz-ghost')), k = getComputedStyle(document.querySelector('.gz-ghost .gz-k')); return [g.pointerEvents, k.display]; }), ['none', 'inline-block'], 'styled as the frame styles it (writer-ai.css)');
        await until(() => pg.evaluate(() => getComputedStyle(document.querySelector('.gz-ghost')).opacity === '1'), 'the visible gray text');
        const colors = await pg.evaluate(() => {
          const pixel = (color) => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); };
          return { dark: document.documentElement.hasAttribute('data-dark'), sheet: pixel(getComputedStyle(document.querySelector('.gp-sheet')).backgroundColor),
            ghost: pixel(getComputedStyle(document.querySelector('.gz-ghost')).color), spelling: pixel(getComputedStyle(document.querySelector('.gz-iss-sp')).textDecorationColor) };
        });
        const luminance = (rgb) => rgb.map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((v, n, i) => v + n * [.2126, .7152, .0722][i], 0);
        const contrast = (rgb) => { const a = luminance(colors.sheet), b = luminance(rgb); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
        const measured = { document: tag, ...colors, ghostContrast: contrast(colors.ghost), spellingContrast: contrast(colors.spelling) };
        visuals.push(measured); assert.equal(colors.dark, true); assert.ok(measured.ghostContrast >= 3 && measured.spellingContrast >= 3, JSON.stringify(measured));
        await pg.screenshot({ path: path.join(out, `${d.format}-ghost.png`) });
        await pg.keyboard.press('Tab');
        assert.equal(await lastText(), `${LAST} it${GHOST}`);
        assert.ok((await asked()).includes('writer.complete'), 'the worker\'s model was asked writer.complete');
      });
      await step(`${tag}: Check with AI (${MOD}+Shift+K) underlines the issue the model found`, async () => {
        await caret();
        await pg.keyboard.press(`${MOD}+Shift+K`);
        await until(() => pg.evaluate(() => GZ_WRITER_ISSUES.list().some((i) => i.source === 'ai' && i.text === 'seem')), 'the AI issue');
        await until(() => pg.evaluate(() => [...document.querySelectorAll('.ProseMirror .gz-iss')].some((e) => e.textContent === 'seem')), 'its underline');
        assert.ok((await asked()).includes('writer.review'), 'the worker\'s model was asked writer.review');
      });
      await step(`${tag}: the Outline shows the AI's section labels`, async () => {
        await pg.click('#gp-tab-outline');
        const labels = await until(async () => { const l = await pg.locator('.gp-ol-label').allTextContents(); return l.includes('Body: Memory and forgetting') && l; }, 'AI outline labels', 20000);
        assert.ok(labels.includes('Body: Returning to the clearing'), JSON.stringify(labels));
        assert.equal(await pg.evaluate(() => document.querySelector('.gp-ol-options input[type=checkbox]')?.checked), true, 'the AI outline switch shows, on');
        await pg.screenshot({ path: path.join(out, `${d.format}-outline.png`) });
      });
      await step(`${tag}: what the AI was told of the document's place`, async () => {
        const runs = await pg.evaluate(() => __aiTap.runs);
        assert.ok(runs.length > 0, 'runs sent');
        const ctx = runs.find((r) => r.task === 'writer.complete')?.context || {};
        if (d.courseName) assert.deepEqual([ctx.kind, ctx.course?.name, ctx.assignment?.title], ['assignment', d.courseName, d.title], JSON.stringify(ctx));
        else assert.ok(!ctx.assignment && !ctx.kind && !ctx.course?.name, JSON.stringify(ctx));
      });
      await step(`${tag}: reopening reuses saved outline labels without asking the model`, async () => {
        await until(() => pg.evaluate(async (key) => (await chrome.storage.local.get(`writerPaper:${key}`))[`writerPaper:${key}`]?.outline?.scope === key, d.key), 'the outline saved under its document key');
        await pg.reload();
        await until(() => pg.evaluate(() => !!GZ_WRITER_PAPER?.current()?.key() && GZ_WRITER_AI?.allowed('writing')), 'the reopened editor and AI');
        await pg.click('#gp-tab-outline');
        await until(async () => (await pg.locator('.gp-ol-label').allTextContents()).includes('Body: Memory and forgetting'), 'the reused labels');
        assert.equal(await pg.evaluate(() => __aiTap.runs.filter((r) => r.task === 'writer.outline').length), 0, 'cached labels need no inference');
      });
      await step(`${tag}: Cite looks a DOI up through the worker`, async () => {
        await caret();
        await pg.locator('.gp-tool > .gp-tbtn', { hasText: 'Cite' }).click();
        await until(() => pg.evaluate(() => !document.querySelector('.gz-cite')?.hidden && !!document.querySelector('.gz-cite .gzc-in')), 'the Cite popover');
        await pg.fill('.gz-cite .gzc-in', 'https://doi.org/10.5555/gz.2026.001');
        await pg.click('.gz-cite .gzc-row .sbtn');
        await until(() => pg.evaluate(() => document.querySelector('.gz-cite .gzc-form [data-field="title"]')?.value === 'Rememory and the River in Beloved'), 'the lookup fills the form');
        assert.ok(lookups.includes('https://doi.org/10.5555/gz.2026.001'), `doi.org asked (${lookups})`);
        await pg.screenshot({ path: path.join(out, `${d.format}-cite.png`) });
        await pg.keyboard.press('Escape');
      });
      const stored = (k) => pg.evaluate(async (k) => (await chrome.storage.local.get(k))[k] ?? null, k);
      if (d.content) {
        await step(`${tag}: Sources has what its attempt saved, and Checks finds its citation's entry`, async () => {
          await pg.click('#gp-tab-sources');
          await until(() => pg.evaluate(() => [...document.querySelectorAll('#gp-sources .gzc-card .gzc-entry')].some((e) => e.textContent.startsWith('Morrison, Toni. Beloved.'))), 'the attempt\'s source in Sources');
          await until(() => pg.evaluate(() => GZ_WRITER_CITE.count().cited === 1), 'the citation matched to it');
          await pause(800); // past the cite checks' quiet moment (writer-cite.js recheck)
          await pg.click('#gp-tab-checks');
          const missing = await pg.evaluate(() => [...GZ_WRITER_ISSUES.list().filter((i) => /has no entry/.test(i.message)).map((i) => i.message),
            ...[...document.querySelectorAll('#gp-checks .gp-issue')].map((e) => e.textContent).filter((x) => /has no entry/.test(x))]);
          assert.deepEqual(missing, []);
          await pg.screenshot({ path: path.join(out, `${d.format}-sources-checks.png`) });
        });
        await step(`${tag}: a source added or removed in Sources is its attempt's`, async () => {
          await pg.click('#gp-tab-sources');
          await pg.locator('#gp-sources .gzc-head button', { hasText: 'Add source' }).click();
          await pg.locator('#gp-sources .gzc-adder button', { hasText: 'Add manually' }).click();
          await pg.fill('#gp-sources .gzc-adder .gzc-form [data-field="author"]', 'Okafor, Ana');
          await pg.fill('#gp-sources .gzc-adder .gzc-form [data-field="title"]', 'Rememory and the River');
          await pg.click('#gp-sources .gzc-adder .gzc-form button[type="submit"]');
          const added = await until(async () => { const s = await stored(ATTEMPT_SOURCES); return s?.sources?.length === 2 && s.sources.find((x) => x.title === 'Rememory and the River'); }, 'the added source in the attempt\'s store');
          assert.equal(await stored(LOCAL_SOURCES(d.key)), null, 'nothing under a key of Documents\' own');
          await pg.screenshot({ path: path.join(out, `${d.format}-sources.png`) });
          await pg.locator(`#gp-sources .gzc-card[data-id="${added.id}"] button`, { hasText: 'Edit' }).click();
          await pg.click('#gp-sources .gzc-form [data-do="remove"]');
          await until(async () => { const s = await stored(ATTEMPT_SOURCES); return s?.sources?.length === 1 && s.sources[0].id === SAVED.id; }, 'removed from the attempt\'s store');
        });
      } else {
        await step(`${tag}: Sources stay its own`, async () => {
          assert.deepEqual(await pg.evaluate(() => [GZ_WRITER_SOURCES.keyOf(GZ_WRITER_FRAME.context()), GZ_WRITER_CITE.sources().length]), [LOCAL_SOURCES(d.key), 0]);
        });
      }
      lookups.length = 0;
    }
    await step('two Documents tabs share one Harper, reconnect after idle close, and keep proofing', async () => {
      const stats = () => Promise.all(pages.map((pg) => pg.evaluate(() => GZ_WRITER_PROOF.stats())));
      const before = await stats();
      assert.equal(before[0].worker, before[1].worker); assert.equal(before[0].ports, 2); assert.equal(before[0].loads, 1);
      // The worker's existing idle test message shortens five minutes; observe both closing notices before any restart.
      await pages[0].evaluate(() => __proofTap.port.postMessage({ op: 'idle', ms: 1000 }));
      await until(async () => (await Promise.all(pages.map((pg) => pg.evaluate(() => __proofTap.closes)))).every((n) => n > 0), 'both idle closing notices');
      for (const pg of pages) {
        await pg.evaluate(() => { const v = GZ_WRITER_FRAME.editor().view; v.dispatch(v.state.tr.insertText(' A seperate note.', v.state.doc.content.size - 1)); });
        await until(() => pg.evaluate(() => GZ_WRITER_ISSUES.list().some((i) => i.source === 'harper' && i.text === 'seperate')), 'proofing after idle');
      }
      const after = await stats();
      assert.notEqual(after[0].worker, before[0].worker); assert.equal(after[0].worker, after[1].worker);
      assert.equal(after[0].ports, 2); assert.equal(after[0].loads, 1);
    });
    for (const pg of pages) await pg.close();
    await step('no page errors', async () => assert.deepEqual(errors, []));
    await step('no request but the DOI lookup', async () => assert.deepEqual(unexpected, []));
    passed = results.every((r) => r.ok);
    console.log(`documents-ai-check: ${results.filter((r) => r.ok).length}/${results.length} passed`);
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, results, errors, unexpected, visuals }, null, 2) + '\n');
    process.exitCode = passed ? 0 : 1;
  }
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), `${e.stack}\n`); process.exitCode = 1; });
