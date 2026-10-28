// Invoked by writer-paper-check.js <evidence directory> --adversarial under the heavy lock.
// Uses its isolated real extension, synthetic attempt, network fence and finally cleanup.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { fixtures } = require('../test/fixtures/writer-hostile.js');
const { execFileSync } = require('node:child_process');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async ({ p, el, fr, openAttempt, context, worker, id, check, until, settle, out, tmp, errors }) => {
  for (const [name, make] of Object.entries(fixtures)) {
    if (process.env.HOSTILE_FILTER && !name.includes(process.env.HOSTILE_FILTER)) continue;
    const fixture = make();
    await fr.evaluate(async ({ name, bytes }) => {
      await GZ_WRITER_PAPER.current().importFile(new File([new Uint8Array(bytes)], `${name}.docx`));
    }, { name, bytes: Array.from(fixture.bytes) });
    await settle(fr);
    const initial = await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent);
    check(initial === fixture.text, `${name}: actual paper import preserves accepted text`);
    await fr.evaluate(async () => {
      const api = GZ_WRITER_PAPER.current(), v = api.editor.view;
      let at; v.state.doc.descendants((n, pos) => { if (at == null && n.isTextblock) at = pos + 1; });
      v.dispatch(v.state.tr.insertText('Edited ', at));
      await api.version('submit');
      v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.node('paragraph')));
      await api.save();
    });
    await fr.click('.gp-status button:last-child');
    const restore = fr.locator('.gp-versions .gp-mi').filter({ hasText: 'Submitted' }).first().getByRole('menuitem');
    await restore.focus(); await p.keyboard.press('Enter');
    await until(() => fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent.startsWith('Edited ')), `${name} restored`);
    const trip = await fr.evaluate(async () => {
      const api = GZ_WRITER_PAPER.current(), before = api.editor.view.state.doc;
      const out = await api.docx(), back = GZ_WRITER_SCHEMA.paper.nodeFromJSON((await GZ_WRITER_DOCX.importDocx(out.bytes)).doc);
      back.check();
      const counts = (doc) => { const v = {}; doc.descendants((n) => { v[n.type.name] = (v[n.type.name] || 0) + 1; }); return v; };
      return { text: back.textContent, before: before.textContent, counts: counts(back), prior: counts(before), pages: api.pages() };
    });
    check(trip.text === trip.before && trip.text === 'Edited ' + fixture.text, `${name}: edit, version, keyboard restore, export and re-import keep every character`);
    for (const type of ['table', 'image', 'footnote_ref', 'list_item', 'page_break']) assert.equal(trip.counts[type], trip.prior[type], `${name}: ${type}`);
    if (name === 'forty-two-pages') check(trip.pages >= 42, '42-page fixture paginates without stalling');
  }
  if (!process.env.WRITER_SKIP_KEYBOARD) await require('./writer-keyboard-check.js')({ p, fr, check, until });
  // Real tabs, one worker: overwrite conflicts must remain recoverable as versions.
  const other = await openAttempt();
  const edit = async (f, token) => f.evaluate(async (token) => { const api = GZ_WRITER_PAPER.current(), v = api.editor.view; v.dispatch(v.state.tr.insertText(token, v.state.doc.content.size - 1)); await api.save(); }, token);
  await edit(fr, ' draft-from-tab-A');
  await edit(other.fr, ' draft-from-tab-B');
  const conflict = await other.fr.evaluate(async () => {
    const store = GZ_WRITER_PAPERS.open(), key = GZ_WRITER_PAPER.current().key();
    const versions = await Promise.all((await store.versions(key)).map((v) => store.version(key, v.id)));
    return versions.some((v) => JSON.stringify(v.doc).includes('draft-from-tab-A'));
  });
  check(conflict, 'two real tabs retain the overwritten draft in history');
  await other.p.close();
  // Reload a frame before the 800ms autosave: the one-use channel and session recovery carry the edit.
  await edit(fr, ' baseline-for-reload');
  await fr.evaluate(() => { const api = GZ_WRITER_PAPER.current(), v = api.editor.view; v.dispatch(v.state.tr.insertText(' unsaved-frame-recovery', v.state.doc.content.size - 1)); });
  await el.evaluate((e) => { e.src = 'about:blank'; });
  el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => f.src !== 'about:blank' && !f.style.opacity) && x; }, 'replacement frame');
  fr = await until(() => el.contentFrame(), 'new frame document');
  await until(() => fr.evaluate(() => GZ_WRITER_PAPER?.current()?.editor.view.state.doc.textContent.includes('unsaved-frame-recovery')), 'unsaved frame recovery');
  check(true, 'a frame reload before autosave recovers unsaved paper text');

  // Use the six-page paper with real Harper. Only the completion port is mocked; no provider or credentials.
  const fx = require('../test/fixtures/writer-paper-fixtures.js');
  await fr.evaluate(async (doc) => {
    const api = GZ_WRITER_PAPER.current(), v = api.editor.view;
    const d = GZ_WRITER_SCHEMA.paper.nodeFromJSON(doc);
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, d.content).setDocAttribute('setup', null));
    window.__completionRuns = 0;
    const connect = chrome.runtime.connect.bind(chrome.runtime);
    chrome.runtime.connect = (options) => {
      if (options.name !== 'glaze:ai') return connect(options);
      const listeners = [];
      return { onMessage: { addListener: (f) => listeners.push(f) }, onDisconnect: { addListener() {} }, disconnect() {}, postMessage(m) {
        let reply;
        if (m.op === 'status') reply = { id: m.id, type: 'status', allowed: true, ready: true, provider: 'device', caps: { text: true } };
        if (m.op === 'warm') reply = { id: m.id, type: 'warmed', ok: true };
        if (m.op === 'run') { __completionRuns++; reply = { id: m.id, type: 'end', output: '' }; }
        if (reply) setTimeout(() => listeners.forEach((f) => f(reply)), 0);
      } };
    };
    await chrome.storage.local.set({ ai: { on: true, features: { completion: true, writing: false } } });
    await GZ_WRITER_AI.refresh();
    window.__sync = [];
    const dispatch = v.dispatch.bind(v);
    v.dispatch = (tr) => { const start = performance.now(); dispatch(tr); if (tr.docChanged) __sync.push(performance.now() - start); };
    v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.atEnd(v.state.doc))); v.focus();
  }, fx.papers.mla9());
  await until(() => fr.evaluate(() => GZ_WRITER_AI.allowed('completion')), 'completion admitted');
  await settle(fr);
  const samples = [];
  for (let count = 500; count <= Number(process.env.WRITER_SESSION_KEYS || 2000); count += 500) {
    // Actual input events, pausing in each open sentence so completion and proofing run between samples.
    await p.keyboard.type((' the student considers how memory shapes the river').repeat(12).slice(0, 500), { delay: 2 });
    await pause(1400);
    const sample = await fr.evaluate(async (keys) => {
      const values = __sync.splice(0).sort((a, b) => a - b);
      const proof = await GZ_WRITER_PROOF.stats();
      return { keys, edits: values.length, median: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * .95)], heap: performance.memory?.usedJSHeapSize, completionRuns: __completionRuns, proof };
    }, count);
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' }).split('\n').map((s) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(s)).filter(Boolean);
    const browser = rows.find((r) => r[4].includes(path.join(tmp, 'profile')) && !/--type=/.test(r[4]));
    const owned = new Set(browser ? [+browser[1]] : []);
    for (let grew = true; grew;) { grew = false; for (const r of rows) if (owned.has(+r[2]) && !owned.has(+r[1])) { owned.add(+r[1]); grew = true; } }
    sample.browserMB = Math.round(rows.filter((r) => owned.has(+r[1])).reduce((n, r) => n + +r[3] / 1024, 0));
    samples.push(sample);
    console.log(`session sample: ${JSON.stringify(sample)}`);
    check(sample.edits >= 500 && sample.completionRuns > 0 && sample.proof?.lints > 0, `${count} keystrokes with real proofing and mock completion`);
  }
  fs.writeFileSync(path.join(out, 'long-session.json'), JSON.stringify(samples, null, 2));
  check(samples.every((s) => s.median <= 10), 'typing median stays within approximately 9ms during the long session');
  // Reload the isolated copy through Chrome's own developer Reload control. runtime.reload() disables
  // command-line extensions, whereas the native reload button reloads them with their original authority.
  const manager = await context.newPage();
  await manager.goto('chrome://extensions/');
  await manager.locator('extensions-toolbar #devMode').click();
  await p.bringToFront();
  await fr.evaluate(() => { const api = GZ_WRITER_PAPER.current(), v = api.editor.view; v.dispatch(v.state.tr.insertText(' extension-reload-recovery', v.state.doc.content.size - 1)); });
  await manager.locator(`extensions-item#${id} #dev-reload-button`).click();
  await manager.close();
  await pause(700);
  const wake = await context.newPage();
  await wake.goto(`chrome-extension://${id}/popup.html`);
  await require('./check-env.js').ultraReady(wake);
  await wake.close();
  await p.reload();
  const recovered = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.contentFrame(); }, 'frame after extension reload');
  await until(() => recovered.evaluate(() => GZ_WRITER_PAPER?.current()?.editor.view.state.doc.textContent.includes('extension-reload-recovery')), 'extension reload recovery');
  check(true, 'an isolated extension reload preserves the pending edit after page reload');
};
