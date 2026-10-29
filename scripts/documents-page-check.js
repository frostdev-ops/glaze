// Documents as a page of the site (features/settingspage.js, papers.js's embedded section), headless: the real extension on
// saved Ultra, Canvas and Moodle pages under invented school origins, Glaze's bar holding its Documents, Search and Settings
// items. The bar's Documents opens it beside the bar, marked where you are, the page under it out of reach; a document opens
// in the same frame and Back returns to the list (the tab's history one entry per document, the page told no key); typing
// there, a delete to Trash and its Undo, the Trash's Restore and Delete forever, an import and two exports work from the frame; Escape, Close, Settings and Search leave or
// take its place, back to the entry it opened from; Ctrl+K opens it the same way; Writer's AI completes a sentence in a
// document opened there (the worker's broker on a stand-in for Chrome's Prompt API, as scripts/documents-ai-check.js); a
// frame of papers.html the page makes itself stays blank and the worker refuses its writes; the popup still opens a tab.
// All other requests abort.
// Shots: inpage-<site>-<width>.png and inpage-ultra-doc-<width>.png at 1280 and 640.
//   NODE_PATH=<playwright> nice -n 10 node scripts/documents-page-check.js [shots folder]   (EXT selects the checkout)
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const G = require(path.join(root, 'defaults.js'));
const PA = require(path.join(root, 'lib/writer-papers.js'));
const ZIP = require(path.join(root, 'lib/zip.js'));
const CANVAS = 'https://emb.school.instructure.com', MOODLE = 'https://moodle.school.test', ULTRA = 'https://bb.school.test';
const fixture = (name) => fs.readFileSync(path.join(root, 'test/fixtures', name), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
const PAGES = { [`${CANVAS}/`]: 'canvas-dashboard-cards.html', [`${MOODLE}/my/`]: 'moodle-dashboard.html', [`${ULTRA}/ultra/course`]: 'ultra-courses.html' };
const SITES = [['ultra', `${ULTRA}/ultra/course`], ['canvas', `${CANVAS}/`], ['moodle', `${MOODLE}/my/`]];
const settings = G.GZ_SANITIZE({ enabled: true, navbar: { ...G.GZ_DEFAULTS.navbar, on: true }, motion: { level: 'off' }, enhance: { ...G.GZ_DEFAULTS.enhance, writer: true, palette: true } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
// A Word file of one paragraph, for Import .docx….
const docx = (text) => Buffer.concat(ZIP.zip([{ name: 'word/document.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`) }]));
// Writer's gray text: the model's answer to writer.complete after the student types " it" at the end of LAST.
const LAST = 'When Sethe returns to the clearing, the memory is not something she owns;';
const GHOST = ' arrives uninvited and rearranges the present.';
// In the worker: Chrome's Prompt API as lib/ai/providers/device.js reads it (scripts/documents-ai-check.js's stand-in).
const INSTALL = () => {
  if (globalThis.__lm) return 'kept';
  const lm = globalThis.__lm = { prompts: [] };
  const TASKS = [['You predict how the sentence', 'writer.complete'], ['You proofread a student', 'writer.review'], ['Describe only the supplied existing section', 'writer.outline'], ['You settle one spelling or grammar call', 'writer.decide']];
  const reply = (task, system) => {
    if (task === 'writer.complete') return 'it arrives uninvited and rearranges the present. Then the river takes it back.';
    if (task === 'writer.review') return JSON.stringify({ issues: [] });
    if (task === 'writer.outline') return JSON.stringify(/only "role"/.test(system) ? { role: 'body' } : { heading: 'Notes', role: 'body' });
    if (task === 'writer.decide') return JSON.stringify({ verdict: 'keep', choice: null });
    return '';
  };
  const LM = {
    availability: async (o = {}) => (o.expectedInputs?.some((i) => i.type === 'image') ? 'unavailable' : 'available'),
    params: async () => ({ defaultTopK: 3, maxTopK: 8, defaultTemperature: 1, maxTemperature: 2 }),
    create: async (o = {}) => {
      const system = (o.initialPrompts || []).filter((x) => x.role === 'system').map((x) => x.content).join('\n');
      const task = TASKS.find(([mark]) => system.includes(mark))?.[1] || '';
      const answer = () => { lm.prompts.push(task || system.slice(0, 60)); return reply(task, system); };
      return { contextWindow: 100000, contextUsage: 10, measureContextUsage: async () => 200, destroy() {}, addEventListener() {}, removeEventListener() {},
        prompt: async () => answer(), promptStreaming: () => { const text = answer(); return new ReadableStream({ start(c) { if (text) c.enqueue(text); c.close(); } }); } };
    },
  };
  Object.defineProperty(globalThis, 'LanguageModel', { value: LM, configurable: true, writable: true });
  return 'installed';
};
let total = 0, failed = 0;
const check = async (name, test) => {
  total++;
  try { await test(); console.log(`ok ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
};

(async () => {
  const lock = require('./check-env.js').lockPath();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-documents-page-'));
  const shots = path.resolve(process.argv[2] || path.join(scratch, 'shots'));
  fs.mkdirSync(shots, { recursive: true });
  let context, held = false;
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\ndocuments-page-check\n`);
    const ext = require('./check-env.js').staged(root, [`${MOODLE}/*`, `${ULTRA}/*`], scratch);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce', locale: 'en-US', acceptDownloads: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-webgl', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    require('./check-env.js').noFirstRun(context);
    context.setDefaultTimeout(15000);
    await context.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (route.request().method() === 'GET' && PAGES[u.origin + u.pathname]) return route.fulfill({ contentType: 'text/html', body: fixture(PAGES[u.origin + u.pathname]) });
      if (u.origin === CANVAS && u.pathname.startsWith('/api/v1/')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      if (u.origin === ULTRA && u.pathname.startsWith('/learn/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`, PAPERS = `${base}/papers.html`;
    const errors = [];
    const watch = (p, name) => {
      p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    };
    const record = (k) => worker.evaluate((key) => chrome.storage.local.get(`writerPaper:${key}`).then((r) => r[`writerPaper:${key}`] || null), k);
    const KEY = PA.newKey(), TITLE = 'Field notes', AI_KEY = PA.newKey();

    // ---- the student's settings and one document, written as the Documents tab writes
    const own = await context.newPage();
    watch(own, 'papers tab');
    await own.goto(PAPERS);
    await own.evaluate(async ({ s, key, title, body, ai }) => {
      await chrome.storage.sync.set({ ...s, navbarItems: { glaze: ['documents', 'search', 'settings'], tabs: ['glaze:documents'] } });
      await chrome.storage.local.set({ moodle: ['https://moodle.school.test/*'], ultra: ['https://bb.school.test'] });
      for (const [k, t, d] of [[key, title, body], [ai.key, 'Reading notes', ai.body]]) {
        const r = await chrome.runtime.sendMessage({ type: 'glaze:writerPapers', op: 'save', args: [k, { kind: 'paper', doc: d, format: 'plain', title: t, named: true }, { reason: 'import' }] });
        if (!r?.ok) throw Error(`seed: ${JSON.stringify(r)}`);
      }
    }, { s: settings, key: KEY, title: TITLE, body: doc('Notes from the archive.'), ai: { key: AI_KEY, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reading notes on Beloved' }] }, { type: 'paragraph', content: [{ type: 'text', text: LAST }] }] } } });
    await require('./check-env.js').ultraReady(own);
    await own.close();

    const page = await context.newPage();
    watch(page, 'ultra');
    const item = (p, id) => p.locator(`#gz-navbar [data-id="${id}"]:visible`).first();
    const hosted = (p) => p.evaluate(() => { const h = document.getElementById('gz-settings-page'), b = h?.getBoundingClientRect(); return b && b.width > 0 ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null; });
    const framed = (p, at = PAPERS) => p.frames().find((f) => f.url().split(/[?#]/)[0] === at && f.parentFrame());
    // Shown: the frame's document claimed its pass (papers.js lifts its veil), at the list or a document, with Close.
    const shown = async (p) => {
      const f = await until(() => framed(p), 'the Documents frame');
      await until(() => f.evaluate(() => !document.documentElement.style.getPropertyValue('opacity') && !document.body.inert
        && (document.documentElement.dataset.mode === 'paper' ? !!document.querySelector('.gp-top > .gd-btn') && !!document.querySelector('.ProseMirror') : !document.getElementById('list').hidden && !!document.querySelector('#list > .gd-btn'))), 'Documents shows, its pass claimed');
      return f;
    };
    // A shot once the frame has painted twice (an out-of-process frame draws on its own clock).
    const shoot = async (p, g, name) => {
      await until(() => g.evaluate(() => document.documentElement.dataset.mode === 'paper' || [...document.querySelectorAll('.gd-card .gd-pic')].filter((e) => e.getBoundingClientRect().top < innerHeight).every((e) => e.childElementCount)), `${name}: thumbnails`, 5000).catch(() => {});
      const seen = await g.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const e = document.elementFromPoint(innerWidth / 2, 40);
        r(`${innerWidth}x${innerHeight} ${getComputedStyle(document.documentElement).opacity} ${e?.tagName}${e?.id ? `#${e.id}` : ''}${e?.className && typeof e.className === 'string' ? `.${e.className.split(' ')[0]}` : ''}`);
      }))));
      console.log(`     ${name}: frame ${seen}`);
      await p.screenshot({ path: path.join(shots, `${name}.png`) });
    };
    const closed = (p) => until(() => p.evaluate(() => !document.getElementById('gz-settings-page')), 'Documents leaves');
    const under = (p) => p.evaluate(() => [...document.body.children, ...document.documentElement.children].filter((e) => !['gz-settings-page', 'gz-navbar'].includes(e.id) && !['HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK'].includes(e.tagName)).map((e) => [e.id || e.tagName, e.inert, getComputedStyle(e).opacity]));
    const back = (p) => p.evaluate(() => history.back());
    // The entry the page was at before Documents opened.
    const mark = (p) => p.evaluate(() => { history.replaceState({ check: 1 }, ''); return history.length; });
    const atMark = (p) => until(() => p.evaluate(() => history.state?.check === 1 && !history.state.gzSettings), 'the tab back at the entry it opened from', 5000);
    const openFromBar = async (p) => { await item(p, 'glaze:documents').click(); await until(() => hosted(p), 'the page host'); return shown(p); };

    await page.goto(`${ULTRA}/ultra/course`);
    await until(() => item(page, 'glaze:documents').count(), 'the bar with its Documents item', 20000);
    await page.evaluate(() => { window.__heard = []; addEventListener('message', (e) => __heard.push(JSON.stringify(e.data))); });
    let length = await mark(page);

    let f;
    await check('ultra: the bar opens Documents beside it, marked where you are, the page under it out of reach', async () => {
      f = await openFromBar(page);
      const [h, b] = [await hosted(page), await item(page, 'glaze:documents').boundingBox()];
      assert.ok(h.left >= b.x + b.width - 1 || h.top >= b.y + b.height - 1, `beside the bar (${JSON.stringify([h, b])})`);
      assert.equal(await item(page, 'glaze:documents').getAttribute('aria-current'), 'page');
      assert.equal(await item(page, 'glaze:settings').getAttribute('aria-current'), null);
      const u = await under(page);
      assert.ok(u.length && u.every(([, inert, op]) => inert && op === '0'), `under it: ${JSON.stringify(u)}`);
      assert.equal(await f.locator(`.gd-card[data-key="${KEY}"] .gd-title`).innerText(), TITLE);
      assert.equal(await f.locator('#list > .gd-btn').innerText(), 'Close');
      assert.equal(await page.evaluate(() => history.length), length + 1, 'one entry');
      await shoot(page, f, 'inpage-ultra-1280');
    });
    await check('ultra: a document opens in the same frame; typing there reaches storage', async () => {
      await f.locator(`.gd-card[data-key="${KEY}"] .gd-title`).click();
      f = await shown(page);
      assert.equal(new URL(f.url()).searchParams.get('paper'), KEY);
      assert.equal(page.frames().filter((x) => x.url().startsWith(PAPERS)).length, 1, 'one frame');
      assert.equal(await page.evaluate(() => history.length), length + 2, 'one entry for the document, none of the frame\'s own');
      assert.equal(await item(page, 'glaze:documents').getAttribute('aria-current'), 'page');
      await f.locator('.ProseMirror').click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Typed in place.');
      await until(async () => JSON.stringify((await record(KEY))?.doc).includes('Typed in place.'), 'the typing saved through the worker');
      await until(async () => (await f.locator('.gp-state').innerText()) === 'Saved', 'Saved');
      await shoot(page, f, 'inpage-ultra-doc-1280');
    });
    await check('ultra: the document\'s Export .docx downloads from the frame', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await f.getByRole('button', { name: 'Versions' }).click(); await f.getByRole('menuitem', { name: 'Export .docx' }).click(); })()]);
      assert.match(dl.suggestedFilename(), /\.docx$/);
      assert.ok(fs.statSync(await dl.path()).size > 1000, 'a Word file');
    });
    await check('ultra: Back returns to the list, Forward to the document', async () => {
      await back(page);
      await until(() => framed(page) && !new URL(framed(page).url()).search, 'the list in the frame');
      f = await shown(page);
      await page.evaluate(() => history.forward());
      await until(() => framed(page) && new URL(framed(page).url()).searchParams.get('paper') === KEY, 'the document again');
      f = await shown(page);
      await back(page);
      await until(() => framed(page) && !new URL(framed(page).url()).search, 'the list again');
      f = await shown(page);
    });
    await check('ultra: from the list, a delete to Trash and its Undo, Restore and Delete forever, an export and an import reach storage and the browser', async () => {
      await f.locator(`.gd-card[data-key="${KEY}"] .gd-more`).click();
      const [dl] = await Promise.all([page.waitForEvent('download'), f.locator('.gd-menu [data-act="export"]').click()]);
      assert.match(dl.suggestedFilename(), /\.docx$/);
      await f.locator(`.gd-card[data-key="${KEY}"] .gd-more`).click();
      await f.locator('.gd-menu [data-act="delete"]').click();
      await until(async () => Number.isFinite((await record(KEY))?.trashed), 'in Trash in storage');
      await f.locator('.gd-toast .gp-toast-do').click();
      await until(async () => { const r = await record(KEY); return r && !('trashed' in r) && JSON.stringify(r.doc).includes('Typed in place.'); }, 'out of Trash, whole');
      await until(() => f.locator(`.gd-card[data-key="${KEY}"]`).count(), 'listed again');
      // The Trash from the frame: Delete, then Restore from its view; a copy deleted forever.
      await f.locator(`.gd-card[data-key="${KEY}"] .gd-more`).click();
      await f.locator('.gd-menu [data-act="delete"]').click();
      await until(async () => Number.isFinite((await record(KEY))?.trashed), 'in Trash again');
      await f.locator('#gd-trash').click();
      await f.locator(`.gd-card[data-key="${KEY}"] .gd-more`).click();
      await f.locator('.gd-menu [data-act="restore"]').click();
      await until(async () => !('trashed' in (await record(KEY))), 'restored from the Trash view');
      await f.locator('#gd-trash').click();
      await until(() => f.locator(`.gd-card[data-key="${KEY}"]`).count(), 'listed after Restore');
      const keys = () => worker.evaluate(() => chrome.storage.local.get('writerPapers').then((r) => (r.writerPapers || []).map((x) => x.key)));
      const before = new Set(await keys());
      await f.locator(`.gd-card[data-key="${KEY}"] .gd-more`).click();
      await f.locator('.gd-menu [data-act="copy"]').click();
      let copy = null;
      await until(async () => (copy = (await keys()).find((k) => !before.has(k))), 'a copy');
      await f.locator(`.gd-card[data-key="${copy}"] .gd-more`).click();
      await f.locator('.gd-menu [data-act="delete"]').click();
      await until(async () => Number.isFinite((await record(copy))?.trashed), 'the copy in Trash');
      await f.locator('#gd-trash').click();
      await f.locator(`.gd-card[data-key="${copy}"] .gd-more`).click();
      await f.locator('.gd-menu [data-act="forever"]').click();
      await until(async () => !(await record(copy)) && !(await keys()).includes(copy), 'the copy deleted forever');
      await f.locator('#gd-trash').click();
      const file = path.join(scratch, 'Imported notes.docx');
      fs.writeFileSync(file, docx('Brought in from Word.'));
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), f.locator('#gd-import').click()]);
      await chooser.setFiles(file);
      await until(() => worker.evaluate(() => chrome.storage.local.get('writerPapers').then((r) => (r.writerPapers || []).some((x) => x.title === 'Imported notes'))), 'the import saved through the worker');
    });
    await check('ultra: Escape leaves, back at the entry it opened from, the page in reach', async () => {
      await f.locator('#heading').click();
      await page.keyboard.press('Escape');
      await closed(page);
      await atMark(page);
      const u = await under(page);
      assert.ok(u.every(([, inert, op]) => !inert && op === '1'), JSON.stringify(u));
      assert.equal(await item(page, 'glaze:documents').getAttribute('aria-current'), null);
    });
    await check('ultra: Close in a document leaves past both entries', async () => {
      f = await openFromBar(page);
      await f.locator(`.gd-card[data-key="${KEY}"] .gd-title`).click();
      f = await shown(page);
      await f.locator('.gp-top > .gd-btn').click();
      await closed(page);
      await atMark(page);
      // One more Back leaves the page as it would without Documents: nothing of the frame's left in the history.
      length = await page.evaluate(() => history.length);
    });
    await check('ultra: Settings in the bar takes its place, Back is Documents again; Search leaves it', async () => {
      f = await openFromBar(page);
      await item(page, 'glaze:settings').click();
      await until(() => framed(page, `${base}/options.html`), 'Settings in its place');
      assert.equal(framed(page), undefined, 'Documents gone');
      await until(async () => (await item(page, 'glaze:settings').getAttribute('aria-current')) === 'page', 'Settings marked');
      assert.equal(await item(page, 'glaze:documents').getAttribute('aria-current'), null);
      await back(page);
      f = await shown(page);
      await until(async () => (await item(page, 'glaze:documents').getAttribute('aria-current')) === 'page', 'Documents marked again');
      await item(page, 'glaze:search').click();
      await closed(page);
      await page.locator('#gz-cmd input').waitFor();
      await page.keyboard.press('Escape');
      await atMark(page);
    });
    await check('ultra: Ctrl+K → Documents opens it the same way', async () => {
      await page.keyboard.press('ControlOrMeta+k');
      await page.locator('#gz-cmd input').fill('Documents');
      const row = page.locator('#gz-cmd-list li').filter({ hasText: /^DocumentsGlaze$/ });
      await row.click();
      await until(() => hosted(page), 'the page host');
      f = await shown(page);
      assert.equal(await item(page, 'glaze:documents').getAttribute('aria-current'), 'page');
      await f.locator('#list > .gd-btn').click();
      await closed(page);
      await atMark(page);
    });
    await check('ultra: Writer\'s AI finishes a sentence in a document opened there, and Tab takes it', async () => {
      const sw = async () => context.serviceWorkers()[0] || context.waitForEvent('serviceworker');
      context.on('serviceworker', (w) => { w.evaluate(INSTALL).catch(() => {}); });
      await (await sw()).evaluate(INSTALL);
      await (await sw()).evaluate(() => chrome.storage.local.set({ ai: { on: true, model: { use: 'device' }, features: { completion: true, writing: true } } }));
      try {
        f = await openFromBar(page);
        await f.locator(`.gd-card[data-key="${AI_KEY}"] .gd-title`).click();
        f = await shown(page);
        await until(() => f.evaluate(() => !!globalThis.GZ_WRITER_AI?.allowed?.('completion') && GZ_WRITER_AI.allowed('writing')), 'the worker admits its AI port: completion and writing allowed', 20000)
          .catch(async (e) => { throw Error(`${e.message} (${await f.evaluate(() => globalThis.GZ_WRITER_AI?.gate?.()).catch((x) => x.message)})`); });
        await f.locator('.ProseMirror').click();
        await f.evaluate((text) => {
          const v = GZ_WRITER_FRAME.editor().view;
          let at = null;
          v.state.doc.descendants((n, pos) => { if (at === null && n.isTextblock && n.textContent.startsWith(text)) at = pos + n.nodeSize - 1; });
          v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at)));
          v.focus();
        }, LAST);
        await page.keyboard.type(' it');
        assert.equal(await until(() => f.evaluate(() => document.querySelector('.gz-ghost')?.firstChild?.textContent ?? null), 'the gray text'), GHOST);
        await shoot(page, f, 'inpage-ultra-ai-1280');
        await page.keyboard.press('Tab');
        await until(() => f.evaluate((text) => { let t = null; GZ_WRITER_FRAME.editor().view.state.doc.descendants((n) => { if (t === null && n.isTextblock && n.textContent.startsWith(text)) t = n.textContent; }); return t; }, LAST).then((t) => t === `${LAST} it${GHOST}`), 'Tab takes it');
        assert.ok((await (await sw()).evaluate(() => globalThis.__lm?.prompts || [])).includes('writer.complete'), 'the worker\'s model was asked writer.complete');
        await until(async () => JSON.stringify((await record(AI_KEY))?.doc).includes('rearranges the present.'), 'saved through the worker');
        await f.locator('.gp-top > .gd-btn').click();
        await closed(page);
        await atMark(page);
      } finally {
        await (await sw()).evaluate(() => chrome.storage.local.remove('ai'));
        if (await page.evaluate(() => !!document.getElementById('gz-settings-page'))) { await page.keyboard.press('Escape'); await closed(page).catch(() => {}); }
      }
    });
    await check('ultra: the page heard no document of the student\'s, and its history holds none', async () => {
      const heard = await page.evaluate(() => __heard);
      assert.ok(heard.length && heard.every((m) => !m.includes(KEY.slice(4)) && !m.includes('pass')), JSON.stringify(heard));
      assert.ok(!JSON.stringify(await page.evaluate(() => history.state)).includes(KEY.slice(4)));
    });
    await check('ultra: a papers.html frame the page makes itself stays blank, and the worker refuses its writes', async () => {
      await page.evaluate((src) => { const r = document.createElement('iframe'); r.id = 'check-rogue'; r.src = src; document.body.append(r); }, PAPERS);
      const rogue = await until(() => framed(page), 'the rogue frame');
      await until(() => rogue.evaluate(() => document.readyState === 'complete'), 'loaded');
      await pause(1500);
      assert.deepEqual(await rogue.evaluate(() => [document.documentElement.style.getPropertyValue('opacity'), document.body.inert]), ['0', true]);
      const r = await rogue.evaluate((k) => chrome.runtime.sendMessage({ type: 'glaze:writerPapers', op: 'save', args: [k, { doc: { type: 'doc', content: [{ type: 'paragraph' }] } }] }), PA.newKey());
      assert.deepEqual(r, { ok: false, error: 'sender' });
      assert.deepEqual(await rogue.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:papers', op: 'claim', pass: crypto.randomUUID() })), { ok: false });
      await page.evaluate(() => document.getElementById('check-rogue').remove());
    });
    await check('ultra at 640: Documents and a document fill the page above the bar', async () => {
      await page.setViewportSize({ width: 640, height: 860 });
      await pause(300);
      f = await openFromBar(page);
      const h = await hosted(page), b = await item(page, 'glaze:documents').boundingBox();
      console.log(`     640: page host ${JSON.stringify(h)}, bar item ${JSON.stringify(b)}`);
      assert.ok(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id === 'gz-navbar', [b.x + b.width / 2, b.y + b.height / 2]), 'the bar stays over it, in use');
      await shoot(page, f, 'inpage-ultra-640');
      await f.locator(`.gd-card[data-key="${KEY}"] .gd-title`).click();
      f = await shown(page);
      await shoot(page, f, 'inpage-ultra-doc-640');
      await f.locator('.gp-top > .gd-btn').click();
      await closed(page);
      await page.setViewportSize({ width: 1280, height: 860 });
    });
    await page.close();

    for (const [site, url] of SITES.slice(1)) {
      const p = await context.newPage();
      watch(p, site);
      try {
        await p.goto(url);
        await until(() => item(p, 'glaze:documents').count(), `${site}: the bar with its Documents item`, 20000);
        await mark(p);
        await check(`${site}: Documents opens beside the bar, marked, the page under it out of reach; Escape leaves`, async () => {
          const g = await openFromBar(p);
          assert.equal(await item(p, 'glaze:documents').getAttribute('aria-current'), 'page');
          const u = await under(p);
          assert.ok(u.length && u.every(([, inert, op]) => inert && op === '0'), JSON.stringify(u));
          assert.equal(await g.locator(`.gd-card[data-key="${KEY}"] .gd-title`).innerText(), TITLE);
          await shoot(p, g, `inpage-${site}-1280`);
          await g.locator('#heading').click();
          await p.keyboard.press('Escape');
          await closed(p);
          await atMark(p);
        });
        await check(`${site} at 640`, async () => {
          await p.setViewportSize({ width: 640, height: 860 });
          await pause(300);
          await shoot(p, await openFromBar(p), `inpage-${site}-640`);
          await p.evaluate(() => history.back());
          await closed(p);
        });
      } finally { await p.close(); }
    }

    await check('the popup still opens Documents in a tab', async () => {
      const popup = await context.newPage();
      watch(popup, 'popup');
      await popup.setViewportSize({ width: 360, height: 700 });
      await popup.goto(`${base}/popup.html`);
      const before = new Set(context.pages());
      await popup.getByRole('button', { name: 'Documents', exact: true }).click();
      const tab = await until(() => context.pages().find((x) => !before.has(x) && x.url().split(/[?#]/)[0] === PAPERS), 'papers.html in a new tab');
      await tab.close(); await popup.close();
    });
    await check('no page errors', async () => assert.deepEqual(errors, []));
  } finally {
    await context?.close().catch(() => {});
    fs.rmSync(path.join(scratch, 'profile'), { recursive: true, force: true });
    if (!process.argv[2]) console.log(`shots: ${shots}`); else fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} Documents page browser checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
