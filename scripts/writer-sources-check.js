// Synthetic imported bibliographies in real standalone paper chrome. No LMS, network lookup or model requests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(__dirname, '..');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mla = 'Rivera, Alex, and Sam Patel. “Learning in School Gardens.” Journal of Garden Studies, vol. 7, no. 2, May 2024, pp. 12–19, doi.org/10.1234/gardens.2024.5.';
const apa = 'Rivera, A., & Patel, S. (2024). Learning in school gardens. Journal of Garden Studies, 7(2), 12–19. https://doi.org/10.1234/gardens.2024.5';
const raw = 'Notebook collection: Garden learning — Rivera, Alex (2024)';
const refined = { type: 'report', title: 'Garden learning', author: [{ family: 'Rivera', given: 'Alex' }], issued: { 'date-parts': [[2024]] } };
let context, tmp, extension, held = false, checks = 0;
const lock = require('./check-env.js').lockPath();
const check = (condition, name) => { assert.ok(condition, name); checks++; console.log(`ok ${name}`); };
(async () => {
  try {
    for (let n = 0; ; n++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-sources-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || n >= 120) throw e; if (n % 12 === 0) console.error('[writer-sources-check] waiting for browser lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-writer-sources-'));
    extension = env.staged(root, []);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context);
    context.setDefaultTimeout(10000);
    const network = [], errors = [];
    await context.route('**/*', (route) => { const url = route.request().url(); if (url.startsWith('chrome-extension:')) return route.continue(); network.push(url); return route.abort(); });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    await worker.evaluate(() => chrome.storage.local.clear());
    const page = async (key, enabled = false) => {
      assert.ok(require('../lib/writer-papers.js').valid(key), 'the Sources fixture opens a valid stored document key');
      const p = await context.newPage(); p.on('pageerror', (e) => errors.push(e.message));
      await p.addInitScript(({ enabled }) => {
        const listeners = new Set(), events = {}; let frame;
        globalThis.__sourceEvents = events;
        Object.defineProperty(globalThis, 'GZ_WRITER_FRAME', { configurable: true, get: () => frame, set(value) {
          frame = value; const on = value.on, getContext = value.context;
          value.on = (event, fn) => { (events[event] ||= []).push(fn); return on(event, fn); };
          value.context = () => globalThis.__sourceContext || getContext();
        } });
        const mock = globalThis.__sourceMock = { available: true, enabled, generation: 1, requests: [], pending: [], aborted: 0 };
        globalThis.GZ_WRITER_AI = {
          outlineInfo: () => ({ available: false, enabled: false, generation: mock.generation }),
          sourcesInfo: () => ({ available: mock.available, enabled: mock.enabled, generation: mock.generation }),
          followOutline: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
          setSourcesAI: async (enabled) => { mock.enabled = enabled; mock.generation++; for (const fn of listeners) fn(); },
          extractSource: (text, { signal }) => new Promise((resolve, reject) => { mock.requests.push(text); signal.addEventListener('abort', () => mock.aborted++, { once: true }); mock.pending.push({ resolve, reject, signal }); }),
        };
      }, { enabled });
      await p.goto(`chrome-extension://${id}/papers.html?paper=${encodeURIComponent(key)}`);
      await p.waitForFunction(() => !!GZ_WRITER_PAPER.current() && typeof GZ_WRITER_CITE?.sourcesView === 'function');
      return p;
    };
    const importDoc = async (p, entries) => p.evaluate((entries) => {
      const v = GZ_WRITER_PAPER.current().editor.view, s = v.state.schema;
      const para = (text) => s.nodes.paragraph.create(null, s.text(text));
      const content = ['Synthetic essay', 'A short body paragraph.', 'Works Cited', ...entries].map(para);
      v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, content));
      return JSON.stringify(v.state.doc.toJSON());
    }, entries);
    const sources = (p) => p.evaluate(() => GZ_WRITER_CITE.sources());
    const show = (p) => p.click('#gp-tab-sources');
    const waitRequests = (p, n) => p.waitForFunction((n) => __sourceMock.requests.length >= n, n);
    const resolve = (p, n, value = refined) => p.evaluate(({ n, value }) => __sourceMock.pending[n].resolve(value), { n, value });
    const sourceKey = (p) => p.evaluate(() => GZ_WRITER_SOURCES.keyOf(GZ_WRITER_FRAME.context()));

    const abbreviated = 'Keles, Betul, et al. “Social Media and Wellbeing.” Journal of Student Research, vol. 4, 2024, pp. 1–12. https://doi.org/10.1234/keles.';
    const etAl = await page('synthetic-sources-etal', true); await importDoc(etAl, [abbreviated]); await show(etAl);
    await etAl.waitForFunction(() => GZ_WRITER_CITE.sources().length === 1);
    check(await etAl.evaluate((original) => {
      const s = GZ_WRITER_CITE.sources()[0];
      return s.unparsed && !s.author && s.original === original && __sourceMock.requests.length === 0 && ['mla9', 'apa7', 'chicago17'].every((style) => {
        GZ_WRITER_CITE.use(style); return document.querySelector('.gzc-card .gzc-entry').textContent === original;
      });
    }, abbreviated) && await etAl.locator('.gzc-card button:text-is("Cite")').isDisabled(), 'et al. imports populate Sources verbatim in every style and never become single-author citations through AI');
    await etAl.close();

    const local = await page('synthetic-sources-local'), original = await importDoc(local, [mla, apa, raw]);
    await show(local); await local.waitForFunction(() => GZ_WRITER_CITE.sources().length === 2);
    check((await sources(local)).length === 2 && await local.locator('#gp-tab-sources .gp-badge').textContent() === '2', 'AI-off imports populate Sources and deduplicate the same DOI');
    check(await local.evaluate(() => __sourceMock.requests.length === 0), 'AI-off imports never invoke source extraction');
    check(await local.locator('.gzc-card:has-text("Notebook collection") button:text-is("Cite")').isDisabled(), 'uncertain imports remain reviewable without invented citation metadata');
    check(await local.evaluate((before) => JSON.stringify(GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON()) === before, original), 'importing bibliography metadata leaves the document untouched');
    for (const style of ['mla9', 'apa7', 'chicago17']) {
      await local.evaluate((style) => GZ_WRITER_CITE.use(style), style);
      check(await local.evaluate(() => {
        const rows = GZ_WRITER_CITE.list(GZ_WRITER_CITE.sources(), GZ_WRITER_CITE.style()).entries;
        return rows.every((r) => { const d = document.createElement('div'); d.innerHTML = r.html; return document.querySelector(`.gzc-card[data-id="${r.id}"] .gzc-entry`).textContent === d.textContent; });
      }), `${style} Sources cards use the shared citation formatter`);
    }
    const uncertain = (await sources(local)).find((s) => s.unparsed);
    await local.locator(`.gzc-card[data-id="${uncertain.id}"] button:text-is("Review source")`).click();
    await local.locator('.gzc-form button:text-is("Save")').click();
    check((await sources(local)).find((s) => s.id === uncertain.id).unparsed, 'saving an unchanged uncertain entry preserves its original bibliography text');
    await local.evaluate(() => GZ_WRITER_CITE.open());
    await local.locator(`.gz-cite .gzc-src[data-id="${uncertain.id}"]`).click();
    check(await local.locator('.gz-cite .gzc-form [data-field="title"]').inputValue() === raw, 'the citation picker opens uncertain sources for review before citing');
    await local.locator('.gz-cite .gzc-close').click();
    const parsed = (await sources(local)).find((s) => !s.unparsed);
    await local.locator(`.gzc-card[data-id="${parsed.id}"] button:text-is("Edit")`).click();
    await local.locator('.gzc-form [data-field="title"]').fill('A title reviewed by the student');
    await local.locator('.gzc-form button:text-is("Save")').click();
    check((await sources(local)).some((s) => s.reviewed && s.title === 'A title reviewed by the student'), 'manual edits are marked reviewed and retained');
    await local.locator(`.gzc-card[data-id="${parsed.id}"] button:text-is("Edit")`).click();
    await local.locator('.gzc-form button:text-is("Remove")').click();
    const storageKey = await sourceKey(local);
    await local.waitForFunction(async (key) => (await chrome.storage.local.get(key))[key]?.removed?.length === 2, storageKey);
    await local.reload(); await local.waitForFunction(() => !!GZ_WRITER_PAPER.current()); await show(local);
    await local.waitForFunction(() => GZ_WRITER_CITE.sources().length === 1);
    check((await sources(local))[0].unparsed, 'removed bibliography duplicates stay removed after reopening the paper');
    await local.close();

    const ai = await page('synthetic-sources-ai', true), aiDoc = await importDoc(ai, [raw]);
    await show(ai); await waitRequests(ai, 1); await resolve(ai, 0);
    await ai.waitForFunction(() => GZ_WRITER_CITE.sources()[0]?.title === 'Garden learning');
    check(await ai.evaluate((before) => !GZ_WRITER_CITE.sources()[0].unparsed && __sourceMock.requests[0] === 'Notebook collection: Garden learning — Rivera, Alex (2024)' && JSON.stringify(GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON()) === before, aiDoc), 'mocked source extraction refines the source through the existing CSL format without editing the paper');
    await ai.close();

    const edit = await page('synthetic-sources-edit', true); await importDoc(edit, [raw]); await show(edit); await waitRequests(edit, 1);
    await edit.locator('.gzc-card button:text-is("Review source")').click();
    await edit.locator('.gzc-form [data-field="title"]').fill('Student-reviewed source');
    await resolve(edit, 0); await pause(50);
    check(await edit.locator('.gzc-form [data-field="title"]').inputValue() === 'Student-reviewed source' && await edit.evaluate(() => __sourceMock.aborted > 0), 'opening a source edit cancels extraction and preserves the draft fields');
    await edit.locator('.gzc-form button:text-is("Save")').click(); await edit.reload(); await edit.waitForFunction(() => !!GZ_WRITER_PAPER.current()); await show(edit); await pause(100);
    check((await sources(edit))[0].title === 'Student-reviewed source' && await edit.evaluate(() => __sourceMock.requests.length === 0), 'reviewed source metadata survives reopening and is never overwritten by AI');
    await edit.close();

    const cancel = await page('synthetic-sources-cancel', true); await importDoc(cancel, [raw]); await show(cancel); await waitRequests(cancel, 1);
    await cancel.click('#gp-tab-checks'); await resolve(cancel, 0); await pause(50);
    check((await sources(cancel))[0].unparsed && await cancel.evaluate(() => __sourceMock.aborted === 1), 'leaving Sources cancels extraction and ignores a late response');
    await show(cancel); await waitRequests(cancel, 2);
    await cancel.locator('input[aria-label="AI source extraction"]').uncheck(); await resolve(cancel, 1); await pause(50);
    check((await sources(cancel))[0].unparsed && await cancel.evaluate(() => __sourceMock.aborted === 2), 'turning source AI off cancels extraction and retains local entries');
    await cancel.locator('input[aria-label="AI source extraction"]').check(); await waitRequests(cancel, 3);
    await cancel.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.insertText('Body edit. ', 1)); });
    await resolve(cancel, 2); await pause(50);
    check((await sources(cancel))[0].unparsed && await cancel.evaluate(() => __sourceMock.aborted === 3), 'body edits cancel in-flight extraction before its delayed refresh');
    await waitRequests(cancel, 4);
    await cancel.evaluate(async () => {
      globalThis.__sourceContext = { school: 'local', user: { id: 'other' }, course: { id: 'papers' }, item: { id: 'other-paper' } };
      await Promise.all(__sourceEvents.context.map((fn) => fn(__sourceContext)));
    });
    await resolve(cancel, 3); await pause(50);
    check((await sources(cancel))[0].unparsed, 'a response from an earlier account or paper context cannot overwrite the new source list');
    await cancel.close();

    const failure = await page('synthetic-sources-failure', true); await importDoc(failure, [raw]); await show(failure); await waitRequests(failure, 1);
    await failure.evaluate(() => __sourceMock.pending[0].reject(new Error('private provider payload')));
    await failure.locator('.gzc-view button:text-is("Try again")').waitFor({ state: 'visible' });
    check((await sources(failure))[0].unparsed && !(await failure.locator('.gzc-view').textContent()).includes('private provider payload') && await failure.locator('.gzc-card').count() === 1, 'extraction failures show a safe retry and retain the imported bibliography');
    await failure.locator('.gzc-view button:text-is("Try again")').click(); await waitRequests(failure, 2); await resolve(failure, 1);
    await failure.waitForFunction(() => GZ_WRITER_CITE.sources()[0]?.title === 'Garden learning');
    check(!(await sources(failure))[0].unparsed, 'failed extraction can be retried successfully'); await failure.close();

    const destroy = await page('synthetic-sources-destroy', true); await importDoc(destroy, [raw]);
    await destroy.evaluate(() => { const host = document.createElement('div'); document.body.append(host); globalThis.__extraSources = GZ_WRITER_CITE.sourcesView(host, { editor: GZ_WRITER_PAPER.current().editor }); __extraSources.refresh(); });
    await waitRequests(destroy, 1); await destroy.evaluate(() => __extraSources.destroy()); await resolve(destroy, 0); await pause(30);
    check((await sources(destroy))[0].unparsed && await destroy.evaluate(() => __sourceMock.aborted === 1), 'destroying a Sources panel cancels its work and rejects late results');
    await show(destroy); await waitRequests(destroy, 2);
    await destroy.evaluate(() => dispatchEvent(new Event('pagehide'))); await resolve(destroy, 1); await pause(30);
    check((await sources(destroy))[0].unparsed && await destroy.evaluate(() => __sourceMock.aborted === 2), 'pagehide cancels source extraction and rejects late results'); await destroy.close();
    check(network.length === 0, 'the entire check makes no external page or model requests');
    check(errors.length === 0, `no browser errors: ${errors.join('; ')}`);
    console.log(`${checks} Sources browser checks passed`);
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (extension) fs.rmSync(extension, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
