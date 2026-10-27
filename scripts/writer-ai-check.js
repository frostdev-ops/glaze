// Glaze Writer's AI in its real frame (writer.html with writer-ai.js), headless, with the AI harness's mock provider behind a
// stand-in of the worker's 'glaze:ai' port: the real tasks (lib/ai/tasks/writer-*.js) run through lib/ai/task.js in the page,
// so the gray text shown is what writer.complete's check kept. The page side of the frame's channel is played from here.
// Flows: the gray text shows after the pause, Tab takes it, ⌥→ (Ctrl+→ off a Mac) takes a word, Esc dismisses it, typing it
// consumes it, any other key, a click or an IME composition cancels it and the run in flight; Tab still indents a list
// item; nothing with completion off or in a test's box; Check with AI (⌘⇧K) gives anchored issues; the chip's menu, the ⋯
// entry, Feedback over the chip, and the autocorrect hook. Screenshots beside the mockups.
// NODE_PATH=<playwright> nice -n 10 lockf -k <heavy lock> node scripts/writer-ai-check.js [screenshot directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), site = 'https://writer.test';
const shots = process.argv[2] || path.join(os.homedir(), 'Projects/glaze-plans/writer/mockups/build-ai');
const MAC = process.platform === 'darwin', MOD = MAC ? 'Meta' : 'Control', WORD = MAC ? 'Alt+ArrowRight' : 'Control+ArrowRight';
const AI_FILES = ['schema', 'request', 'stream', 'failure', 'endpoint', 'text', 'providers', 'tools', 'loop', 'task', 'providers/mock',
  ...['context', 'complete', 'review', 'feedback', 'requirements', 'cite', 'decide'].map((t) => `tasks/writer-${t}`)].map((f) => `lib/ai/${f}.js`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 8000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(40); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};

// In the frame, before its scripts: chrome.* as the frame sees it, with the worker's port played by the real harness.
const STUB = `(() => {
  const ai = window.__ai = { settings: { on: true, use: 'main', features: { completion: true, writing: true } }, connects: 0, runs: [], ends: [], cancels: [], next: {}, changed: [],
    status: { completion: { allowed: true, ready: true, provider: 'device', caps: { text: true } }, writing: { allowed: true, ready: true, provider: 'device', caps: { text: true, json: true } } } };
  window.GZ_WRITER_ISSUES = { sets: [], set(source, issues) { this.sets.push({ source, issues }); }, clear() {}, list: () => [], on() {} };
  window.GZ_WRITER_PROOF = { decide: null };
  const inflight = new Map();
  const connect = () => {
    ai.connects++;
    const on = [];
    const post = (m) => setTimeout(() => on.forEach((f) => f(JSON.parse(JSON.stringify(m)))), 0);
    return {
      onMessage: { addListener: (f) => on.push(f) }, onDisconnect: { addListener() {} }, disconnect() {},
      postMessage: async (m) => {
        if (m.op === 'status') return post({ id: m.id, type: 'status', on: ai.settings.on, ...(ai.settings.features[m.feature] ? ai.status[m.feature] : { allowed: false }) });
        if (m.op === 'cancel') { ai.cancels.push(m.id); inflight.get(m.id)?.abort(); return; }
        if (m.op !== 'run') return;
        const task = GZ_AI_TASKS.get(m.task);
        if (!ai.settings.features[m.feature]) return post({ id: m.id, type: 'error', error: 'feature' });
        // A supersede task's newer run cancels the one in flight, as lib/ai/broker.js does.
        if (task.rate?.supersede) for (const [id, c] of inflight) if (c.task === m.task) { c.abort(); }
        const c = Object.assign(new AbortController(), { task: m.task });
        inflight.set(m.id, c);
        ai.runs.push({ id: m.id, task: m.task, input: m.input });
        const reply = ai.next[m.task] || { text: '' };
        try {
          const out = await GZ_AI_TASKS.run(task, m.input, { provider: 'mock', cfg: { replies: [reply] }, signal: c.signal, emit: (e) => post({ ...e, id: m.id }) });
          ai.ends.push({ id: m.id, output: out.output });
          post({ id: m.id, type: 'end', output: out.output, meta: out.meta });
        } catch (e) { ai.ends.push({ id: m.id, error: e.code || String(e), detail: String(e.detail || ''), stack: String(e.stack).slice(0, 600) }); post({ id: m.id, type: 'error', error: c.signal.aborted ? 'cancelled' : e.code || 'failed' }); }
        finally { inflight.delete(m.id); }
      },
    };
  };
  window.chrome = { runtime: { sendMessage: async () => ({ ok: true }), connect },
    storage: { local: { get: async () => ({ ai: JSON.parse(JSON.stringify(ai.settings)) }) }, onChanged: { addListener: (f) => ai.changed.push(f) } } };
})();`;
const CONTEXT = {
  kind: 'reply', course: { id: '_101_1', name: 'ENGL 2110' },
  prompt: { text: 'How does Morrison use the river and the clearing as places of memory? Respond in at least 250 words, cite two sources, and reply to two classmates.' },
  thread: [{ id: 'm1', parentId: null, author: 'Jordan Lee', text: 'The river is where the past refuses to stay buried. Every time a character crosses it, they carry something they can\'t put down, and the novel keeps returning to the bank as if the water itself were keeping score.', mine: false }],
  replyTo: { id: 'm1', author: 'Jordan Lee', text: 'The river is where the past refuses to stay buried.' },
};
const QUOTED = '<p class="ql-indent-1"><em>Every time a character crosses it, they carry something they can\'t put down</em></p><p class="ql-indent-1">— Jordan Lee</p>'
  + '<p>I agree that the river works as a kind of archive, but I think Morrison is definately less interested in nostalgia than in what the town chooses to forget. Baldwin calls this "the price of the ticket," and the clearing seem to collect that price.</p>';
const LAST = 'When Sethe returns to the clearing, the memory is not something she owns;';
const GHOST = { text: 'it arrives uninvited and rearranges the present. Then the river takes it back.' };

(async () => {
  await require('./wait-for-browser.js')();
  const browser = await chromium.launch({ headless: true, ...require('./check-env.js').chromeLaunch() });
  let failures = 0, checks = 0;
  const errors = [];
  try {
    const context = await browser.newContext({ bypassCSP: true, viewport: { width: 860, height: 420 }, deviceScaleFactor: 2 });
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.origin !== site) return r.abort();
      const file = path.join(root, decodeURIComponent(u.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await context.addInitScript(STUB);
    // A frame opened by the page's side with init { mode, kind, html, context }.
    const frame = async ({ kind = 'reply', mode = 'compose', html = QUOTED + `<p>${LAST}</p>`, ctx = CONTEXT, settings } = {}) => {
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
      await page.goto(`${site}/writer.html`);
      for (const f of AI_FILES) await page.addScriptTag({ url: `${site}/${f}` });
      if (settings) await page.evaluate((s) => { __ai.settings = s; }, settings);
      await page.evaluate((init) => {
        const ch = new MessageChannel();
        window.__page = { said: [], port: ch.port1 };
        ch.port1.onmessage = ({ data }) => __page.said.push(data);
        window.postMessage({ type: 'glaze:writer', pass: 'p'.repeat(36) }, '*', [ch.port2]);
        setTimeout(() => ch.port1.postMessage({ type: 'init', look: { dark: true, motion: 'subtle' }, locale: 'en', placeholder: '', ...init }), 50);
      }, { kind, mode, html, context: ctx });
      await until(() => page.evaluate(() => !!document.querySelector('.ProseMirror')), 'editor');
      return page;
    };
    const check = async (name, fn) => {
      checks++;
      try { await fn(); console.log(`ok ${name}`); } catch (e) { failures++; console.error(`FAIL ${name}\n${e.stack || e.message}`); if (process.env.DEBUG) console.error(JSON.stringify(await context.pages().at(-1)?.evaluate(() => ({ runs: __ai.runs.map((r) => [r.id, r.task]), ends: __ai.ends, cancels: __ai.cancels })))); }
    };
    const ghost = (p) => p.evaluate(() => document.querySelector('.gz-ghost')?.firstChild?.textContent ?? null);
    const last = (p) => p.evaluate(() => GZ_WRITER_FRAME.editor().view.state.doc.lastChild.textContent);
    const runs = (p, task = 'writer.complete') => p.evaluate((task) => __ai.runs.filter((r) => r.task === task).length, task);
    // The caret at the end of the last paragraph, then words typed there.
    const end = async (p) => { await p.evaluate(() => { const ed = GZ_WRITER_FRAME.editor(); ed.focus(); const { state } = ed.view; ed.view.dispatch(state.tr.setSelection(GZ_PM.state.TextSelection.atEnd(state.doc))); }); };
    const reset = async (p, text = LAST) => { await p.evaluate((h) => __page.port.postMessage({ type: 'html', html: h }), QUOTED + `<p>${text}</p>`); await until(async () => (await last(p)) === text, 'reset'); await end(p); };
    const next = (p, task, reply) => p.evaluate(([task, reply]) => { __ai.next[task] = reply; }, [task, reply]);

    const p = await frame();
    await check('the chip names the connection, with a green dot, when AI is ready', async () => {
      const chip = await until(() => p.$('.slot[data-slot="ai"] .gz-ai-chip'), 'chip');
      assert.equal(await chip.textContent(), 'Gemini Nano');
      assert.equal(await chip.evaluate((c) => c.hasAttribute('data-ready')), true);
    });
    await check('the gray text shows after the pause, only from writer.complete\'s checked output, with the Tab keycap', async () => {
      await next(p, 'writer.complete', GHOST);
      await end(p);
      await p.keyboard.type(' it');
      assert.equal(await ghost(p), null, 'not at once');
      const shown = await until(() => ghost(p), 'gray text', 3000);
      assert.equal(shown, ' arrives uninvited and rearranges the present.', 'cut at the sentence end');
      assert.equal(await p.evaluate(() => document.querySelector('.gz-ghost .gz-k').textContent), 'Tab');
      assert.equal(await last(p), `${LAST} it`, 'nothing written yet');
      const input = await p.evaluate(() => __ai.runs.at(-1).input);
      assert.ok(input.before.endsWith('she owns; it') && input.context.thread.length === 1 && input.kind === 'reply');
      fs.mkdirSync(shots, { recursive: true });
      await pause(250);
      await (await p.$('#gw')).screenshot({ path: path.join(shots, 'compose-ghost.png') });
    });
    await check('Tab takes all of it as one step', async () => {
      await p.keyboard.press('Tab');
      assert.equal(await last(p), `${LAST} it arrives uninvited and rearranges the present.`);
      assert.equal(await ghost(p), null);
      await p.keyboard.press(`${MOD}+z`);
      assert.equal(await last(p), `${LAST} it`, 'one undo');
    });
    await check(`${WORD} takes one word, and the rest stays`, async () => {
      await reset(p);
      await p.keyboard.type(' it');
      await until(() => ghost(p), 'gray text', 3000);
      await p.keyboard.press(WORD);
      assert.equal(await last(p), `${LAST} it arrives`);
      assert.equal(await ghost(p), ' uninvited and rearranges the present.');
      await p.keyboard.press(WORD);
      assert.equal(await last(p), `${LAST} it arrives uninvited`);
    });
    await check('Esc dismisses it and writes nothing', async () => {
      await p.keyboard.press('Escape');
      assert.equal(await ghost(p), null);
      assert.equal(await last(p), `${LAST} it arrives uninvited`);
    });
    await check('typing the same characters consumes it without asking again; anything else typed ends it', async () => {
      await reset(p);
      await p.keyboard.type(' it');
      await until(() => ghost(p), 'gray text', 3000);
      const before = await runs(p);
      await p.keyboard.type(' arr');
      assert.equal(await ghost(p), 'ives uninvited and rearranges the present.');
      await p.keyboard.type('i');
      assert.equal(await ghost(p), 'ves uninvited and rearranges the present.');
      await pause(1200);
      assert.equal(await runs(p), before, 'no new run while it shows');
      await p.keyboard.type('x');
      assert.equal(await ghost(p), null, 'a different character');
    });
    await check('another key, an IME composition or a click cancels it, and a key cancels the run in flight', async () => {
      await reset(p);
      await next(p, 'writer.complete', { ...GHOST, wait: 1500 });
      const n0 = await runs(p);
      await p.keyboard.type(' it');
      await until(async () => (await runs(p)) > n0, 'run started', 3000);
      const id = await p.evaluate(() => __ai.runs.at(-1).id);
      await p.keyboard.press('ArrowLeft');
      await until(() => p.evaluate((id) => __ai.cancels.includes(id), id), 'cancel sent');
      await pause(1700);
      assert.equal(await ghost(p), null, 'its answer never shows');
      await next(p, 'writer.complete', GHOST);
      for (const [why, act] of [
        ['an IME composition', () => p.evaluate(() => GZ_WRITER_FRAME.editor().view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })))],
        ['a click elsewhere', () => p.click('.ProseMirror p >> nth=0')],
        ['another key', () => p.keyboard.press('Enter')],
      ]) {
        await reset(p);
        await p.keyboard.type(' it');
        await until(() => ghost(p), `gray text before ${why}`, 3000);
        await act();
        await until(async () => (await ghost(p)) === null, why, 1500);
        await p.evaluate(() => GZ_WRITER_FRAME.editor().view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
      }
    });
    await check('Tab with no gray text still indents a list item', async () => {
      await p.evaluate(() => __page.port.postMessage({ type: 'html', html: '<ol><li>One</li><li>Two</li></ol>' }));
      await until(async () => (await p.evaluate(() => document.querySelectorAll('.ProseMirror li').length)) === 2, 'list');
      await end(p);
      await p.keyboard.press('Tab');
      assert.equal(await p.evaluate(() => document.querySelectorAll('.ProseMirror li')[1].className), 'ql-indent-1');
    });
    await check('Check with AI (⌘⇧K) sends the draft and sets anchored issues', async () => {
      await reset(p);
      await next(p, 'writer.review', { json: { issues: [
        { quote: 'definately', before: 'Morrison is', after: 'less', kind: 'spelling', message: 'Spelling.', suggestions: ['definitely'] },
        { quote: 'seem', before: 'the clearing', after: 'to collect', kind: 'grammar', message: 'Agreement.', suggestions: ['seems'] },
        { quote: 'not in the draft', before: '', after: '', kind: 'style', message: 'Dropped.', suggestions: [] },
      ] } });
      await p.keyboard.press(`${MOD}+Shift+K`);
      const set = await until(() => p.evaluate(() => GZ_WRITER_ISSUES.sets.at(-1)), 'issues set');
      assert.equal(set.source, 'ai');
      const words = await p.evaluate((s) => s.issues.map((i) => GZ_WRITER_FRAME.editor().view.state.doc.textBetween(i.from, i.to)), set);
      assert.deepEqual(words, ['definately', 'seem']);
      assert.deepEqual(set.issues.map((i) => [i.kind, i.source, i.sure]), [['spelling', 'ai', false], ['grammar', 'ai', false]]);
    });
    await check('the chip\'s menu and ⋯ both offer Check with AI with its keys; no Feedback outside an assignment', async () => {
      await p.click('.gz-ai-chip');
      await until(() => p.evaluate(() => document.querySelector('.gz-ai-menu[data-open]')), 'chip menu');
      assert.equal(await p.evaluate(() => document.querySelector('.gz-ai-check').textContent), `Check with AI${MAC ? '⌘⇧K' : 'Ctrl+Shift+K'}`);
      assert.equal(await p.evaluate(() => document.querySelector('.gz-ai-fb').hidden), true);
      await pause(200);
      await p.screenshot({ path: path.join(shots, 'compose-chip-menu.png') });
      await p.keyboard.press('Escape');
      await p.click('#more');
      const items = await p.evaluate(() => [...document.querySelectorAll('#menu [role="menuitem"]')].filter((b) => !b.hidden).map((b) => b.textContent));
      assert.deepEqual(items, [`Check with AI${MAC ? '⌘⇧K' : 'Ctrl+Shift+K'}`, 'Blackboard editor']);
      await p.keyboard.press('Escape');
    });
    await check('the autocorrect hook asks writer.decide and applies only the first candidate it is sure of', async () => {
      await next(p, 'writer.decide', { json: { verdict: 'apply', choice: 'their' } });
      const said = await p.evaluate(() => GZ_WRITER_PROOF.decide({ text: 'I agree. They put there coats on the bed. Then left.', from: 18, to: 23, suggestions: ['their', 'they\'re'] }));
      assert.equal(said, 'apply');
      const input = await p.evaluate(() => __ai.runs.at(-1).input);
      assert.deepEqual([input.sentence, input.from, input.to], ['They put there coats on the bed.', 9, 14]);
      await next(p, 'writer.decide', { json: { verdict: 'apply', choice: 'they\'re' } });
      assert.equal(await p.evaluate(() => GZ_WRITER_PROOF.decide({ text: 'They put there coats down.', from: 9, to: 14, suggestions: ['their', 'they\'re'] })), 'suggest');
    });
    await check('nothing with completion off: no run, no gray text; the chip stays for writing', async () => {
      await p.evaluate(() => { __ai.settings.features.completion = false; __ai.changed.forEach((f) => f({ ai: {} }, 'local')); });
      await pause(100);
      await reset(p);
      const before = await runs(p);
      await p.keyboard.type(' it');
      await pause(1300);
      assert.equal(await runs(p), before);
      assert.equal(await ghost(p), null);
      assert.ok(await p.$('.gz-ai-chip'));
      await p.evaluate(() => { __ai.settings.on = false; __ai.changed.forEach((f) => f({ ai: {} }, 'local')); });
      await until(async () => !(await p.$('.gz-ai-chip')), 'chip hidden with AI off');
    });
    await p.close();

    await check('a test\'s box: no port, no chip, no gray text', async () => {
      const q = await frame({ kind: 'test' });
      await end(q);
      await q.keyboard.type(' it');
      await pause(1300);
      assert.deepEqual(await q.evaluate(() => [__ai.connects, !!document.querySelector('.gz-ai-chip'), !!document.querySelector('.gz-ghost'), typeof GZ_WRITER_PROOF.decide]), [0, false, false, 'object']);
      await q.close();
    });
    await check('Feedback over the chip for an assignment: per criterion, comments only, a passage that selects its words', async () => {
      const assignment = { title: 'Essay 2', instructions: 'Write about memory in Beloved, using two sources.', rubric: { title: 'Rubric', levels: [], criteria: [{ id: '_10_1', label: 'Thesis', cells: [] }, { id: '_11_1', label: 'Evidence', cells: [] }] } };
      const q = await frame({ kind: 'journal', ctx: { kind: 'journal', assignment } });
      await next(q, 'writer.feedback', { json: { criteria: [
        { criterion: '_10_1', status: 'partly', comment: 'Your claim is there, but it comes late.', quotes: [{ quote: 'Morrison is definately less interested in nostalgia', before: 'I think', after: 'than' }] },
        { criterion: '_11_1', status: 'missing', comment: 'No source is cited yet.', quotes: [] },
      ] } });
      await until(() => q.$('.gz-ai-chip[data-ready]'), 'chip');
      await q.click('.gz-ai-chip');
      await q.click('.gz-ai-fb');
      await until(() => q.evaluate(() => document.querySelectorAll('.gz-ai-pop .gz-fb-item').length === 2), 'feedback shown');
      assert.deepEqual(await q.evaluate(() => [...document.querySelectorAll('.gz-fb-item')].map((c) => c.querySelector('.gz-fb-lbl').textContent)), ['ThesisPartly met', 'EvidenceMissing']);
      await pause(250);
      await q.screenshot({ path: path.join(shots, 'compose-feedback.png') });
      await q.click('.gz-fb-quote');
      const sel = await q.evaluate(() => { const { state } = GZ_WRITER_FRAME.editor().view; return state.doc.textBetween(state.selection.from, state.selection.to); });
      assert.equal(sel, 'Morrison is definately less interested in nostalgia');
      // The paper's side panel mounts the same view.
      const tab = await q.evaluate(() => { const box = document.createElement('div'); document.body.append(box); GZ_WRITER_AI.feedbackView(box); return box.querySelectorAll('.gz-fb-item').length; });
      assert.equal(tab, 2);
      await q.close();
    });
    await check('no page errors', async () => assert.deepEqual(errors, []));
  } finally { await browser.close(); }
  console.log(`${checks - failures}/${checks} passed${failures ? '' : ` · screenshots in ${shots}`}`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
