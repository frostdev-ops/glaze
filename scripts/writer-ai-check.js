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
const AI_FILES = ['lib/writer-sources.js', 'lib/writer-cite.js', ...['schema', 'request', 'stream', 'failure', 'endpoint', 'text', 'providers', 'tools', 'loop', 'task', 'providers/mock',
  ...['context', 'complete', 'review', 'image', 'feedback', 'outline', 'requirements', 'cite', 'decide'].map((t) => `tasks/writer-${t}`)].map((f) => `lib/ai/${f}.js`)];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 8000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(40); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};

// In the frame, before its scripts: chrome.* as the frame sees it, with the worker's port played by the real harness.
const STUB = `(() => {
  const ai = window.__ai = { settings: { on: true, outline: false, use: 'main', features: { completion: true, writing: true } }, connects: 0, runs: [], ends: [], cancels: [], next: {}, changed: [], seen: [],
    status: { completion: { allowed: true, ready: true, provider: 'device', caps: { text: true } }, writing: { allowed: true, ready: true, provider: 'device', caps: { text: true, json: true } } } };
  // The real issues store (lib/writer-issues.js), with every set() recorded as it lands.
  let issues;
  Object.defineProperty(window, 'GZ_WRITER_ISSUES', { configurable: true, get: () => issues, set: (v) => {
    issues = v;
    if (v && !v.sets) { v.sets = []; const set = v.set; v.set = function (source, list, range) { this.sets.push({ source, issues: list }); return set.call(this, source, list, range); }; }
  } });
  const inflight = new Map();
  const connect = () => {
    ai.connects++;
    const on = [];
    const post = (m) => setTimeout(() => on.forEach((f) => f(JSON.parse(JSON.stringify(m)))), 0);
    return {
      onMessage: { addListener: (f) => on.push(f) }, onDisconnect: { addListener() {} }, disconnect() {},
      postMessage: async (m) => {
        const allowed = ['writer.outline', 'writer.sources'].includes(m.task) ? ai.settings[m.task === 'writer.outline' ? 'outline' : 'sources'] !== false : ai.settings.features[m.feature];
        if (m.op === 'status') return post({ id: m.id, type: 'status', on: ai.settings.on, ...(allowed ? ai.status[m.feature] : { allowed: false }) });
        if (m.op === 'cancel') { ai.cancels.push(m.id); inflight.get(m.id)?.abort(); return; }
        if (m.op !== 'run') return;
        const task = GZ_AI_TASKS.get(m.task);
        if (!allowed) return post({ id: m.id, type: 'error', error: 'feature' });
        // A supersede task's newer run cancels the one in flight, as lib/ai/broker.js does.
        if (task.rate?.supersede) for (const [id, c] of inflight) if (c.task === m.task) { c.abort(); }
        const c = Object.assign(new AbortController(), { task: m.task });
        inflight.set(m.id, c);
        ai.runs.push({ id: m.id, task: m.task, input: m.input });
        if (ai.hold) await new Promise((r) => { ai.release = r; }); // held, so a check can see the run in flight
        const reply = ai.next[m.task] || { text: '' };
        try {
          const out = await GZ_AI_TASKS.run(task, m.input, { provider: 'mock', cfg: { replies: Array.isArray(reply) ? reply : [reply], seen: ai.seen }, signal: c.signal, emit: (e) => post({ ...e, id: m.id }) });
          ai.ends.push({ id: m.id, output: out.output });
          post({ id: m.id, type: 'end', output: out.output, meta: out.meta });
        } catch (e) { ai.ends.push({ id: m.id, error: e.code || String(e), detail: String(e.detail || ''), stack: String(e.stack).slice(0, 600) }); post({ id: m.id, type: 'error', error: c.signal.aborted ? 'cancelled' : e.code || 'failed' }); }
        finally { inflight.delete(m.id); }
      },
    };
  };
  const data = {}, local = { get: async () => ({ ...data, ai: JSON.parse(JSON.stringify(ai.settings)) }), set: async (o) => { Object.assign(data, o); if (o.ai) { ai.settings = JSON.parse(JSON.stringify(o.ai)); ai.changed.forEach((f) => f({ ai: { newValue: o.ai } }, 'local')); } }, remove: async (k) => { delete data[k]; } };
  window.chrome = { runtime: { sendMessage: async (m) => m.type === 'glaze:writerPapers' ? { ok: true, value: await GZ_WRITER_PAPERS.open(local)[m.op](...m.args) } : { ok: true }, connect },
    storage: { local, onChanged: { addListener: (f) => ai.changed.push(f) } } };
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
// Paragraph k of about `size` characters, its first and last words saying which it is.
const PARAS = (n, size) => Array.from({ length: n }, (_, i) => {
  let s = `Paragraph ${i + 1} opens here.`, j = 0;
  while (s.length < size - 40) s += ` Detail ${i + 1} ${++j} is about the river and the town.`;
  return `${s} Paragraph ${i + 1} ends here.`;
});
// The document so far as the model read it, from a request the stub's model saw.
const SO_FAR = /\[the document so far[^\]\n]*\]\n<<<(DATA-[0-9a-f]+)\n([\s\S]*?)\n>>>\1/;

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

    if (process.argv.includes('--compact')) {
      const q = await frame({ mode: 'paper', kind: 'assignment', html: `<p>${LAST}</p>`, ctx: { kind: 'assignment' } });
      try {
        await until(() => q.evaluate(() => !!GZ_WRITER_PAPER.current()?.compact() && GZ_WRITER_AI.allowed('completion')), 'compact paper ready');
        await check('compact paper shows completion in the box and Tab accepts only the current sentence', async () => {
          await next(q, 'writer.complete', GHOST); await end(q); await q.keyboard.type(' it');
          assert.equal(await until(() => ghost(q), 'compact ghost'), ' arrives uninvited and rearranges the present.');
          assert.ok(await q.$('#gw .gz-ghost'));
          await q.keyboard.press('Tab');
          assert.equal(await last(q), LAST + ' it arrives uninvited and rearranges the present.');
          assert.equal(await ghost(q), null);
          assert.equal(await q.evaluate(() => document.documentElement.dataset.view), 'compact');
        });
        await check('no page errors', async () => assert.deepEqual(errors, []));
      } finally { await q.close(); }
    } else {
    const p = await frame();
    await check('the chip names the connection, with a green dot, when AI is ready', async () => {
      const chip = await until(() => p.$('.slot[data-slot="ai"] .gz-ai-chip'), 'chip');
      assert.equal(await chip.textContent(), 'Chrome on-device AI');
      assert.equal(await chip.evaluate((c) => c.hasAttribute('data-ready')), true);
      assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#menu [role="menuitem"]')].map((b) => b.firstChild.textContent)), ['Blackboard editor', 'Check with AI', 'Sources', 'Add references', 'Export .txt', 'Export .md']);
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
      const set = await until(() => p.evaluate(() => GZ_WRITER_ISSUES.sets.filter((x) => x.source === 'ai').at(-1)), 'issues set');
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
      assert.deepEqual(items.slice(0, 2), ['Blackboard editor', `Check with AI${MAC ? '⌘⇧K' : 'Ctrl+Shift+K'}`], 'Blackboard editor first, then Check with AI (other parts add theirs after)');
      await p.keyboard.press('Escape');
    });
    await check('Tab leaves the chip menu and closes it without losing focus', async () => {
      await p.click('.gz-ai-chip');
      await p.keyboard.press('Tab');
      assert.equal(await p.evaluate(() => document.querySelector('.gz-ai-menu').hidden), true);
      assert.equal(await p.evaluate(() => document.activeElement.closest('.gz-ai-menu') !== null), false);
    });
    await check('completion stays quiet during continuous typing, and selection changes discard a late result', async () => {
      await reset(p);
      const n = await runs(p);
      await p.keyboard.type(' words keep coming steadily', { delay: 60 });
      assert.equal(await runs(p), n);
      await next(p, 'writer.complete', { ...GHOST, wait: 1000 });
      await reset(p); await p.keyboard.type(' it');
      await until(async () => (await runs(p)) > n, 'run');
      await p.evaluate(() => {
        const ed = GZ_WRITER_FRAME.editor(), st = ed.view.state;
        ed.view.dispatch(st.tr.setSelection(GZ_PM.state.TextSelection.create(st.doc, 2, 5)));
      });
      await pause(1200);
      assert.equal(await ghost(p), null);
    });
    await check('ghost motion stops with reduced motion and motion off, and consuming text does not animate', async () => {
      await reset(p); await next(p, 'writer.complete', GHOST);
      await p.keyboard.type(' it'); await until(() => ghost(p), 'ghost');
      await p.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.gz-ghost')).animationDuration), '0s');
      await p.emulateMedia({ reducedMotion: 'no-preference' });
      await p.evaluate(() => __page.port.postMessage({ type: 'look', look: { dark: true, motion: 'off' } }));
      await until(() => p.evaluate(() => document.documentElement.dataset.motion === 'off'), 'motion off');
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.gz-ghost')).animationDuration), '0s');
      await p.keyboard.type(' a');
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.gz-ghost')).animationName), 'none');
      await p.keyboard.press('Escape');
      await p.evaluate(() => __page.port.postMessage({ type: 'look', look: { dark: true, motion: 'subtle' } }));
    });
    await check("the autocorrect hook keeps the model's verdict and chosen candidate index", async () => {
      await next(p, 'writer.decide', { json: { verdict: 'apply', choice: 'their' } });
      const said = await p.evaluate(() => GZ_WRITER_PROOF.decide({ text: 'I agree. They put there coats on the bed. Then left.', from: 18, to: 23, suggestions: ['their', 'they\'re'] }));
      assert.deepEqual(said, { verdict: 'apply', choice: 0 });
      const input = await p.evaluate(() => __ai.runs.at(-1).input);
      assert.deepEqual([input.sentence, input.from, input.to], ['They put there coats on the bed.', 9, 14]);
      await next(p, 'writer.decide', { json: { verdict: 'apply', choice: 'they\'re' } });
      assert.deepEqual(await p.evaluate(() => GZ_WRITER_PROOF.decide({ text: 'They put there coats down.', from: 9, to: 14, suggestions: ['their', 'they\'re'] })), { verdict: 'apply', choice: 1 });
    });
    // The whole document before the caret (lib/ai/tasks/writer-complete.js): the stub's model has no window, so it reads
    // up to READ.unknown bytes of it, the earliest paragraphs left out first.
    const asked = async (html, label) => {
      await p.evaluate((h) => __page.port.postMessage({ type: 'html', html: h }), html);
      await until(async () => (await last(p)) === LAST, label);
      await end(p); await next(p, 'writer.complete', GHOST);
      await p.keyboard.type(' it');
      assert.equal(await until(() => ghost(p), `gray text in ${label}`, 4000), ' arrives uninvited and rearranges the present.', 'the gray text as before');
      const req = await p.evaluate(() => __ai.seen.at(-1));
      return { req, size: JSON.stringify(req).length, read: SO_FAR.exec(req.messages[1].content[0].text)?.[2] ?? '' };
    };
    await check('the gray text\'s request carries the whole document: the first of twenty paragraphs reaches the model', async () => {
      const paras = PARAS(20, 600), { size, read } = await asked(paras.map((t) => `<p>${t}</p>`).join('') + `<p>${LAST}</p>`, 'twenty paragraphs');
      assert.equal(read, paras.join('\n'), 'all twenty, the first one first');
      const chars = paras.join('\n').length;
      console.log(`  request: ${size} characters for ${chars} characters of document`);
      assert.ok(size > chars && size < chars + 8000, `${size} characters`);
    });
    await check('a 50-page paper reaches the model cut from its start at a paragraph, within the window', async () => {
      const paras = PARAS(100, 1000), { size, read } = await asked(paras.map((t) => `<p>${t}</p>`).join('') + `<p>${LAST}</p>`, 'a 50-page paper');
      const first = Number(/^Paragraph (\d+) opens here\./.exec(read)?.[1]), bytes = Buffer.byteLength(read, 'utf8'), chars = paras.join('\n').length;
      assert.ok(chars > 95000, `${chars} characters`);
      assert.ok(first > 1 && read === paras.slice(first - 1).join('\n'), `whole paragraphs from paragraph ${first} to the last`);
      console.log(`  request: ${size} characters for a ${chars}-character paper; ${bytes} bytes of it read, from paragraph ${first}`);
      assert.ok(bytes <= 60000 && bytes > 60000 - 1100, `${bytes} bytes read`);
      assert.ok(size < 60000 + 8000, `${size} characters`);
    });
    await check('a suggestion already shown at a sentence is not shown there again; a new one is', async () => {
      await reset(p); await next(p, 'writer.complete', GHOST);
      await p.keyboard.type(' it');
      await until(() => ghost(p), 'gray text', 3000);
      await p.keyboard.press('Escape');
      const n = await runs(p);
      await p.keyboard.type('x'); await p.keyboard.press('Backspace');
      await until(() => p.evaluate((n) => __ai.runs.filter((r) => r.task === 'writer.complete').length > n && __ai.ends.at(-1)?.id === __ai.runs.at(-1).id, n), 'asked again', 3000);
      const said = `${LAST} it arrives uninvited and rearranges the present.`;
      assert.deepEqual(await p.evaluate(() => __ai.runs.at(-1).input.past), [said], 'the frame sends what it showed');
      assert.match((await p.evaluate(() => __ai.seen.at(-1))).messages[1].content.map((p) => p.text).join('\n\n'), /\[suggestions already shown[^\n]*\n<<<DATA-[0-9a-f]+\nWhen Sethe returns/, 'the model is told');
      assert.equal((await p.evaluate(() => __ai.ends.at(-1))).error, 'check', 'the same suggestion is refused');
      await pause(300);
      assert.equal(await ghost(p), null);
      await next(p, 'writer.complete', { text: 'it arrives late and leaves early.' });
      await p.keyboard.type('x'); await p.keyboard.press('Backspace');
      assert.equal(await until(() => ghost(p), 'a new suggestion', 3000), ' arrives late and leaves early.');
      await p.keyboard.press('Escape');
    });
    await check('completion memory clears on whole replacements and fresh editor states, but survives a view switch', async () => {
      const q = await frame({ mode: 'paper', kind: 'assignment', html: `<p>${LAST}</p>`, ctx: { kind: 'assignment' } });
      try {
        await until(() => q.evaluate(() => !!GZ_WRITER_PAPER.current()), 'paper');
        const askOnce = async () => {
          await end(q); await next(q, 'writer.complete', GHOST);
          await q.keyboard.type(' it'); await until(() => ghost(q), 'memory suggestion');
          await q.keyboard.press('Escape');
        };
        await reset(q); await askOnce();
        const full = q.locator('.gp-full:visible').first();
        await full.click(); await end(q);
        await next(q, 'writer.complete', { text: 'it arrives late and leaves early.' });
        await q.keyboard.type('x'); await q.keyboard.press('Backspace');
        await until(() => ghost(q), 'suggestion after view switch');
        assert.equal((await q.evaluate(() => __ai.runs.at(-1).input.past)).length, 1, 'same paper across compact/full');
        await q.keyboard.press('Escape');
        for (const fresh of [false, true]) {
          await q.evaluate((fresh) => {
            const v = GZ_WRITER_FRAME.editor().view;
            const doc = GZ_WRITER_SCHEMA.paper.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'When Sethe returns to the clearing, the memory is not something she owns;' }] }] });
            if (fresh) v.updateState(GZ_PM.state.EditorState.create({ doc, plugins: v.state.plugins }));
            else v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, doc.content));
          }, fresh);
          await askOnce();
          assert.deepEqual(await q.evaluate(() => __ai.runs.at(-1).input.past), [], fresh ? 'another paper / Documents open: init' : 'restore / native text: whole replacement');
        }
      } finally { await q.close(); }
    });
    await check('completion sends text after the caret far enough to clip at a paragraph boundary', async () => {
      const paras = PARAS(2, 3000);
      await p.evaluate((html) => __page.port.postMessage({ type: 'html', html }), `<p>${LAST}</p>` + paras.map((t) => `<p>${t}</p>`).join(''));
      await until(() => p.evaluate(() => GZ_WRITER_FRAME.editor().view.state.doc.childCount === 3), 'three paragraphs');
      await p.evaluate(() => {
        const v = GZ_WRITER_FRAME.editor().view;
        v.focus(); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, v.state.doc.firstChild.nodeSize - 1)));
      });
      await next(p, 'writer.complete', GHOST); await p.keyboard.type(' it');
      await until(() => ghost(p), 'suggestion before later paragraphs');
      const req = await p.evaluate(() => __ai.seen.at(-1));
      const text = req.messages[1].content.map((p) => p.text).join('\n\n');
      const after = /\[the text after the caret[^\]\n]*\]\n<<<(DATA-[0-9a-f]+)\n([\s\S]*?)\n>>>\1/.exec(text)?.[2];
      assert.equal(after, '\n' + paras[0]);
      await p.keyboard.press('Escape');
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

    await check('paper Focus gives ghost text, proof cards and citation dialogs first Escape; Tab still takes a ghost in a list', async () => {
      const q = await frame({ mode: 'paper', kind: 'assignment', html: `<p>${LAST}</p>`, ctx: { kind: 'assignment' } });
      try {
        await until(() => q.evaluate(() => !!GZ_WRITER_PAPER.current()), 'paper mounted');
        await next(q, 'writer.complete', GHOST);
        await q.evaluate(() => GZ_WRITER_PAPER.current().focus(true));
        await end(q); await q.keyboard.type(' it');
        await until(() => ghost(q), 'paper ghost');
        await q.keyboard.press('Escape');
        assert.equal(await ghost(q), null, 'Escape dismisses the ghost first');
        assert.equal(await q.getAttribute('.gp-tbtn[aria-label="Focus"]', 'aria-pressed'), 'true', 'Focus stays on');
        await q.evaluate((text) => {
          const v = GZ_WRITER_FRAME.editor().view;
          let from = null;
          v.state.doc.descendants((node, pos) => { if (from === null && node.isTextblock && node.textContent.startsWith(text)) from = pos + 1; });
          if (from === null) throw new Error('paper body missing before proof check');
          GZ_WRITER_ISSUES.set('ai', [{ from, to: from + 4, kind: 'style', message: 'Review this wording.', suggestions: ['Then'] }]);
          if (!GZ_WRITER_ISSUES.list().some((i) => i.source === 'ai' && i.from === from)) throw new Error('proof issue was not seeded');
          v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, from + 1))); v.focus();
        }, LAST);
        await q.keyboard.press('Alt+Enter');
        await until(() => q.evaluate(() => !document.querySelector('.gp-card').hidden), 'proof card');
        await q.keyboard.press('Escape');
        assert.equal(await q.getAttribute('.gp-tbtn[aria-label="Focus"]', 'aria-pressed'), 'true', 'proof Escape keeps Focus');
        await q.evaluate(() => GZ_WRITER_CITE.open());
        await q.keyboard.press('Escape');
        assert.equal(await q.getAttribute('.gp-tbtn[aria-label="Focus"]', 'aria-pressed'), 'true', 'citation Escape keeps Focus');
        await q.evaluate(() => GZ_WRITER_FRAME.editor().focus());
        await q.keyboard.press('Escape');
        assert.equal(await q.getAttribute('.gp-tbtn[aria-label="Focus"]', 'aria-pressed'), 'false', 'next Escape leaves Focus');
        await q.evaluate(() => GZ_WRITER_FRAME.editor().setHTML('<ul><li><p>One</p></li><li><p>These words will</p></li></ul>'));
        await end(q); await q.keyboard.type(' it');
        await until(() => ghost(q), 'paper list ghost');
        await q.keyboard.press('Tab');
        assert.equal(await ghost(q), null);
        assert.equal(await q.evaluate(() => document.querySelectorAll('.ProseMirror li').length), 2, 'Tab takes text without nesting the list');
        assert.equal(await q.evaluate(() => document.querySelectorAll('.ProseMirror li li').length), 0);
      } finally { await q.close(); }
    });

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
        { criterion: '_10_1', status: 'partly', comment: 'Your claim is there, but it comes late.', quotes: [{ quote: 'Morrison is definately less interested in nostalgia', before: 'I think', after: 'than' }], level: null },
        { criterion: '_11_1', status: 'missing', comment: 'No source is cited yet.', quotes: [], level: null },
      ] } });
      await until(() => q.$('.gz-ai-chip[data-ready]'), 'chip');
      await q.click('.gz-ai-chip');
      await q.click('.gz-ai-fb');
      await until(() => q.evaluate(() => document.querySelectorAll('.gz-ai-pop .gz-fb-item').length === 2), 'feedback shown');
      assert.deepEqual(await q.evaluate(() => [...document.querySelectorAll('.gz-fb-item')].map((c) => [c.querySelector('.gz-fb-crit').textContent, c.querySelector('.gz-fb-chip').textContent])), [['Thesis', 'Partly'], ['Evidence', 'Missing']]);
      await pause(250);
      await q.screenshot({ path: path.join(shots, 'compose-feedback.png') });
      await check('Feedback is a named dialog, receives focus, and Escape returns to the chip', async () => {
        assert.equal(await q.evaluate(() => document.querySelector('.gz-ai-pop').getAttribute('role')), 'dialog');
        assert.equal(await q.evaluate(() => document.querySelector('.gz-ai-pop').getAttribute('aria-label')), 'Feedback');
        assert.equal(await q.evaluate(() => document.querySelector('.gz-ai-pop').contains(document.activeElement)), true);
        await q.keyboard.press('Escape');
        assert.equal(await q.evaluate(() => document.activeElement.className), 'gz-ai-chip');
        await q.keyboard.press('Enter');
        await q.keyboard.press('ArrowDown');
        await q.keyboard.press('Enter');
        await until(() => q.evaluate(() => !document.querySelector('.gz-ai-pop').hidden), 'feedback reopened');
      });
      await q.click('.gz-fb-quote');
      const sel = await q.evaluate(() => { const { state } = GZ_WRITER_FRAME.editor().view; return state.doc.textBetween(state.selection.from, state.selection.to); });
      assert.equal(sel, 'Morrison is definately less interested in nostalgia');
      // The paper's side panel mounts the same view.
      const tab = await q.evaluate(() => { const box = document.createElement('div'); document.body.append(box); GZ_WRITER_AI.feedbackView(box); return box.querySelectorAll('.gz-fb-item').length; });
      assert.equal(tab, 2);
      await q.close();
    });
    await check('the feedback model defines the outline; opt-out restores local structure; grading uses the rubric and documents as is', async () => {
      const assignment = { title: 'Garden essay', instructions: 'Explain the benefits of school gardens.',
        files: [{ name: 'Prompt.txt', url: 'https://writer.test/prompt.txt' }],
        rubric: { levels: [{ id: 'high', label: 'Proficient' }, { id: 'low', label: 'Developing' }], criteria: [
          { id: 'claim', label: 'Claim', points: 10, cells: [{ level: 'high', value: 8 }, { level: 'low', value: 4 }] },
          { id: 'evidence', label: 'Evidence', points: 10, cells: [{ level: 'high', value: 8 }, { level: 'low', value: 4 }] },
        ] } };
      const q = await frame({ mode: 'paper', kind: 'assignment', settings: { on: true, model: { use: 'device' }, outline: true, features: { writing: true } }, ctx: { kind: 'assignment', assignment } });
      try {
        await q.setViewportSize({ width: 1440, height: 900 });
        await until(() => q.evaluate(() => !!GZ_WRITER_PAPER.current()?.pages()), 'paper for outline and grading', 20000);
        await q.evaluate(() => {
          const prior = __page.port.onmessage;
          __page.port.onmessage = (e) => { prior(e); if (e.data.type === 'attachments') __page.port.postMessage({ type: 'attachments', id: e.data.id, files: [{ name: 'Prompt.txt', text: 'Support your claim with two concrete examples.' }] }); };
          const api = GZ_WRITER_PAPER.current(), v = api.editor.view;
          const body = ['School gardens connect lessons with everyday life. ', 'Students can compare the growth of different plants. ',
            'Experiments make classroom concepts easier to understand. ', 'Neighbors can share the work and the harvest. ', 'These benefits make school gardens a lasting investment. '];
          const doc = GZ_WRITER_SCHEMA.paper.nodeFromJSON(GZ_WRITER_FORMAT.template(api.format(),
            { name: 'Alex Rivera', instructor: 'Prof. Okafor', course: 'ENG2100', date: '28 October 2026', title: 'School Gardens' },
            body.map((s) => ({ type: 'paragraph', content: [{ type: 'text', text: s.repeat(8) }] }))));
          v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, doc.content));
          __ai.next['writer.outline'] = [
            { json: { heading: 'Learning in the garden', role: 'introduction' } },
            { json: { heading: 'Plant growth observations', role: 'body' } },
            { json: { heading: 'Practical experiments', role: 'body' } },
            { json: { heading: 'Community partnerships', role: 'body' } },
            { json: { heading: 'A lasting investment', role: 'conclusion' } },
          ];
          __ai.next['writer.feedback'] = { json: { criteria: [
            { criterion: 'claim', status: 'met', comment: 'Your paper states a clear claim.', quotes: [], level: 'Proficient' },
            { criterion: 'evidence', status: 'partly', comment: 'Your paper does not give the two concrete examples required.', quotes: [], level: 'Developing' },
          ], grade: { summary: 'Your paper has a clear claim but loses points for the missing concrete examples.' } } };
        });
        await q.click('#gp-tab-outline');
        await until(() => q.evaluate(() => document.querySelector('.gp-ol-label')?.textContent.startsWith('Introduction:')), 'model-defined outline', 20000);
        assert.deepEqual(await q.locator('.gp-ol-label').allTextContents(), ['Introduction: Learning in the garden', 'Body: Plant growth observations', 'Body: Practical experiments', 'Body: Community partnerships', 'Conclusion: A lasting investment']);
        await q.locator('.gp-ol-row[data-kind="section"]').nth(3).click();
        assert.ok(await q.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.selection.$from.parent.textContent.startsWith('Neighbors')));
        await q.screenshot({ path: path.join(shots, 'outline-model.png') });
        await q.getByRole('checkbox', { name: 'AI outline', exact: true }).uncheck();
        await until(() => q.evaluate(() => document.querySelector('.gp-ol-label')?.textContent === 'Introduction'), 'local outline after opt-out');
        assert.equal(await runs(q, 'writer.outline'), 1);
        await q.click('#gp-tab-feedback');
        await q.getByRole('button', { name: 'Get feedback', exact: true }).click();
        await until(() => q.evaluate(() => document.querySelector('.gz-fb-score')?.textContent === 'Estimated grade: 12/20'), 'rubric grade');
        assert.ok(await q.evaluate(() => __ai.runs.find((r) => r.task === 'writer.feedback').input.context.assignment.files[0].text.includes('two concrete examples')));
        await pause(300);
        await q.screenshot({ path: path.join(shots, 'feedback-grade.png') });
        await q.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.insertText('Revised. ', 1)); });
        await until(() => q.evaluate(() => document.querySelector('.gz-fb-grade')?.textContent.includes('Draft changed') && !document.querySelector('.gz-fb-score')), 'grade invalidated after edit');
        await q.evaluate(() => { __ai.next['writer.feedback'].json.criteria.pop(); });
        await q.locator('.gz-fb-grade .gz-fb-run').click();
        await until(() => q.evaluate(() => document.querySelector('.gz-fb-score')?.textContent === 'Score unavailable'
          && document.querySelector('.gz-fb-grade')?.textContent.includes('The assessment did not score every rubric category.')), 'unavailable score explains why');
        await q.screenshot({ path: path.join(shots, 'feedback-grade-unavailable.png') });
      } finally { await q.close(); }
    });

    // The paper's Feedback and Outline tabs as mockups E draw them: every state, Frost and Paper, wide and narrow.
    const looks = { dark: { dark: true, motion: 'subtle' }, light: { dark: false, motion: 'subtle', tokens: Object.fromEntries(Object.entries(require('../defaults.js').GZ_PRESETS.find((x) => x[0] === 'Paper')[1]).filter(([k]) => k.startsWith('--gz-'))) } };
    const built = path.join(shots, 'feedback-outline');
    fs.mkdirSync(built, { recursive: true });
    const level = (id, label, points, a, b) => ({ id, label, points, cells: [{ level: '_1_1', detail: 'Exemplary work.', value: a }, { level: '_2_1', detail: 'Developing work.', value: b }] });
    const RUBRIC = { title: 'Essay rubric', levels: [{ id: '_1_1', label: 'Proficient' }, { id: '_2_1', label: 'Developing' }],
      criteria: [level('_10_1', 'Thesis and argument', 10, 9, 6), level('_11_1', 'Use of evidence', 10, 9, 6), level('_12_1', 'Works Cited', 5, 5, 2), level('_13_1', 'MLA format', 5, 5, 3)] };
    const FX = require('../test/fixtures/writer-paper-fixtures.js');
    for (const [name, look] of Object.entries(looks)) for (const [wide, size] of [['wide', { width: 1440, height: 900 }], ['narrow', { width: 760, height: 1000 }]]) {
      await check(`Feedback and Outline as mockups E (${name}, ${wide}): head row, states, cards, levels, pages, Outline, focus ring`, async () => {
        const q = await frame({ mode: 'paper', kind: 'assignment', html: `<p>${LAST}</p>`, ctx: { kind: 'assignment', assignment: { title: 'Essay 2', instructions: 'Write 1,200 words on memory in Beloved.', rubric: RUBRIC } } });
        try {
          await q.setViewportSize(size);
          await q.evaluate((look) => __page.port.postMessage({ type: 'look', look }), look);
          await until(() => q.evaluate(() => !!GZ_WRITER_PAPER.current()), 'paper mounted');
          const doc = FX.papers.mla9();
          const body = doc.content.findIndex((n, i) => i > 4 && n.type === 'paragraph');
          doc.content.splice(body + 1, 0, { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'The clearing as ledger' }] },
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Baby Suggs\'s sermon' }] });
          await q.evaluate((doc) => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON(doc).content)); }, doc);
          await until(() => q.evaluate(() => GZ_WRITER_PAPER.current().pages() > 1), 'pages laid out');
          const side = async (file) => { await pause(260); await (await q.$('.gp-side')).screenshot({ path: path.join(built, `${file}-${name}-${wide}.png`) }); };
          await q.click('#gp-tab-feedback');
          // Not run: the button in the head row, inside the pane's padding.
          const gap = await q.evaluate(() => { const p = document.querySelector('#gp-feedback').getBoundingClientRect(), b = document.querySelector('#gp-feedback .gz-fb-head .gz-fb-run').getBoundingClientRect(); return [b.left - p.left, b.top - p.top]; });
          assert.ok(gap[0] >= 12 && gap[1] >= 12, `Get feedback sits inside the pane's padding (${gap})`);
          assert.equal(await q.$eval('#gp-feedback .gz-fb-sum', (e) => e.textContent), 'Not run yet');
          await side('feedback-not-run');
          // Reading: the run held in flight.
          await q.evaluate(() => { __ai.hold = true; });
          await next(q, 'writer.feedback', { json: { criteria: [
            { criterion: '_10_1', status: 'met', comment: 'Your thesis names the river and the clearing as two kinds of memory and holds to it.', quotes: [{ quote: 'Toni Morrison\'s Beloved treats memory less as a record', before: 'Inheritance in Beloved', after: 'than' }], level: 'Proficient' },
            { criterion: '_11_1', status: 'partly', comment: 'Two of your three claims rest on the same passage; the clearing section has no quotation of its own.', quotes: [], level: 'Developing' },
            { criterion: '_12_1', status: 'missing', comment: 'You cite Morrison and Baldwin, but Works Cited has no entries yet.', quotes: [], level: null },
            { criterion: '_13_1', status: 'met', comment: 'Your heading, header and spacing follow MLA.', quotes: [], level: 'Proficient' }] } });
          await q.click('#gp-feedback .gz-fb-run');
          await until(() => q.evaluate(() => document.querySelectorAll('#gp-feedback .gz-fb-skel').length === 3), 'skeletons while reading');
          assert.match(await q.$eval('#gp-feedback .gz-fb-run', (e) => e.textContent), /Reading your draft…/);
          assert.equal(await q.$eval('#gp-feedback .gz-fb-sum', (e) => e.textContent), 'Criteria: 4');
          await q.emulateMedia({ reducedMotion: 'reduce' });
          assert.equal(await q.$$eval('#gp-feedback .gz-spin, #gp-feedback .gz-fb-skel i', (es) => es.every((e) => getComputedStyle(e).animationName === 'none')), true, 'reduced motion stills the spinner and skeletons');
          await q.emulateMedia({ reducedMotion: 'no-preference' });
          await side('feedback-reading');
          await q.evaluate(() => { __ai.hold = false; __ai.release(); });
          await until(() => q.evaluate(() => document.querySelectorAll('#gp-feedback .gz-fb-item').length === 4), 'results');
          const cards = await q.evaluate(() => [...document.querySelectorAll('#gp-feedback .gz-fb-item')].map((c) => [c.querySelector('.gz-fb-chip').textContent, c.querySelector('.gz-fb-level')?.textContent || '']));
          assert.deepEqual(cards, [['Met', 'Proficient · 9/10'], ['Partly', 'Developing · 6/10'], ['Missing', ''], ['Met', 'Proficient · 5/5']]);
          assert.equal(await q.$eval('#gp-feedback .gz-fb-sum', (e) => e.textContent), '2 met1 partly1 missing');
          assert.match(await q.$eval('#gp-feedback .gz-fb-page', (e) => e.textContent), /^p\. \d+$/, 'a passage says its page');
          await side('feedback-results');
          await q.emulateMedia({ reducedMotion: 'reduce' });
          assert.equal(await q.$eval('#gp-feedback .gz-fb-item', (e) => getComputedStyle(e).animationName), 'none', 'reduced motion stills the cards');
          await q.emulateMedia({ reducedMotion: 'no-preference' });
          // Editing above a quoted passage moves its page; the displayed number must follow its mapped position.
          const priorPage = await q.$eval('#gp-feedback .gz-fb-page', (e) => e.textContent);
          const priorPages = await q.evaluate(() => GZ_WRITER_PAPER.current().pages());
          await q.evaluate(() => {
            const v = GZ_WRITER_PAPER.current().editor.view, n = v.state.schema.nodes;
            const prefix = GZ_PM.model.Fragment.fromArray(Array.from({ length: 50 }, () => n.paragraph.create(null, v.state.schema.text('A paragraph added above the quoted passage.'))));
            window.__feedbackPrefix = prefix.size;
            v.dispatch(v.state.tr.insert(0, prefix));
          });
          await until(() => q.evaluate((n) => GZ_WRITER_PAPER.current().pages() > n, priorPages), 'repagination above the passage');
          await until(async () => (await q.$eval('#gp-feedback .gz-fb-page', (e) => e.textContent)) !== priorPage, 'the passage page follows edits', 2000);
          await q.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.delete(0, __feedbackPrefix)); });
          await until(() => q.evaluate((n) => GZ_WRITER_PAPER.current().pages() === n, priorPages), 'original pagination restored');
          // Motion off: the cards don't animate.
          await q.evaluate(() => __page.port.postMessage({ type: 'look', look: { dark: true, motion: 'off' } }));
          await until(() => q.evaluate(() => document.documentElement.dataset.motion === 'off'), 'motion off');
          assert.equal(await q.$eval('#gp-feedback .gz-fb-item', (e) => getComputedStyle(e).animationName), 'none');
          await q.evaluate((look) => __page.port.postMessage({ type: 'look', look }), look);
          // An error: a reply that isn't the answer's shape.
          await next(q, 'writer.feedback', { text: 'not an answer' });
          await q.click('#gp-feedback .gz-fb-run');
          await until(() => q.$('#gp-feedback .gz-fb-error'), 'error card');
          assert.equal(await q.$eval('#gp-feedback .gz-fb-error .gz-fb-run', (e) => e.textContent), 'Try again');
          await side('feedback-error');
          // The tab's focus ring: the Look's rounded ring inside the tab, clear of its underline.
          await q.focus('#gp-tab-sources');
          await q.keyboard.press('ArrowRight');
          await until(() => q.evaluate(() => document.activeElement?.id === 'gp-tab-feedback'), 'keyboard focus on Feedback');
          const ring = await q.$eval('#gp-tab-feedback', (e) => { const a = getComputedStyle(e, '::after'), r = e.getBoundingClientRect(); return { outline: getComputedStyle(e).outlineStyle, shadow: a.boxShadow, radius: a.borderTopLeftRadius, bottom: parseFloat(a.bottom) }; });
          assert.ok(ring.outline === 'none' && /2px/.test(ring.shadow) && ring.radius === '8px' && ring.bottom >= 6, `a rounded ring clear of the underline (${JSON.stringify(ring)})`);
          await (await q.$('.gp-tabs')).screenshot({ path: path.join(built, `tab-focus-${name}-${wide}.png`) });
          // The Outline: title, headings with their pages, Works Cited; the caret's section marked.
          await q.click('#gp-tab-outline');
          await q.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = null; v.state.doc.descendants((n, pos) => { if (at === null && n.type.name === 'heading' && n.attrs.level === 2) at = pos + 2; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at))); });
          const rows = await until(() => q.evaluate(() => { const r = [...document.querySelectorAll('.gp-ol-row')]; return r.length && r.every((x) => x.querySelector('small').textContent) && r.map((x) => [x.dataset.kind, x.querySelector('span').textContent, x.classList.contains('cur')]); }), 'outline with pages');
          assert.deepEqual(rows.map((r) => r[0]), ['title', 'section', 'heading', 'heading', 'list']);
          assert.deepEqual(rows.filter((r) => r[2]).map((r) => r[1]), ['Baby Suggs\'s sermon'], 'the caret\'s section is marked');
          await side('outline');
          await q.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Just a start.' }] }] }).content)); });
          await until(() => q.evaluate(() => document.querySelector('.gp-ol-label')?.textContent === 'Paragraph 1'), 'unheaded draft outline', 4000);
          await q.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, v.state.schema.nodes.paragraph.create())); });
          await until(() => q.evaluate(() => /No text yet\./.test(document.querySelector('.gp-outline').textContent)), 'outline empty state', 4000);
          await side('outline-empty');
        } finally { await q.evaluate(() => { __ai.hold = false; __ai.release?.(); }).catch(() => {}); await q.close(); }
      });
    }
    await check('a paper hard break keeps the open quotation guard in its paragraph; a new paragraph releases it', async () => {
      const q = await frame({ mode: 'paper', kind: 'assignment', ctx: { kind: 'assignment', assignment: { instructions: 'Discuss memory.' } } });
      try {
        await until(() => q.evaluate(() => !!GZ_WRITER_PAPER.current()?.key() && GZ_WRITER_AI.allowed('completion')), 'paper ready');
        await next(q, 'writer.complete', { text: 'to use the board.' });
        const write = async (html) => {
          await q.evaluate((html) => { const ed = GZ_WRITER_FRAME.editor(); ed.setHTML(html); const v = ed.view; v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.atEnd(v.state.doc))); v.focus(); }, html);
          await q.keyboard.type(' to');
        };
        await write('<p>Baldwin writes “the price<br>Three things I learned are how</p>');
        await pause(1200);
        assert.equal(await runs(q), 0, 'a hard break is still inside the open quotation');
        assert.equal(await ghost(q), null);
        await write('<p>Baldwin writes “the price</p><p>Three things I learned are how</p>');
        await until(async () => (await ghost(q)) === ' use the board.', 'a new paragraph is outside the earlier quotation');
      } finally { await q.close(); }
    });
    await check('no page errors', async () => assert.deepEqual(errors, []));
    }
  } finally { await browser.close(); }
  console.log(`${checks - failures}/${checks} passed${failures ? '' : ` · screenshots in ${shots}`}`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
