// Glaze Writer's compose mode in the real unpacked extension, on the synthetic Ultra discussion (test/fixtures/ultra-writer-
// discussion.html, from the probe's skeletons) with the thread API answered from test/fixtures/ultra-writer-thread*.json:
// the context the frame gets, the target ring and sources pill, the Quote pop over a classmate's post (mouse and
// keyboard), Markdown and Ctrl/Cmd+Enter beside the ring, and a message's plain word count. Real Quill 1.3.7 (pinned) in
// the page, as scripts/writer-check.js runs it. GETs only; no account or outside network from the browser.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-compose-check.js [evidence directory], under the heavy-check lock (CLAUDE.md)
// WRITER_SHOTS names where the screenshots go (default /tmp/gz-writer-compose-shots).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const site = 'https://bb.school.test';
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const json = (f) => JSON.parse(fixture(f));
const PAGES = { '/ultra/courses/_101_1/discussion/_9_1': 'ultra-writer-discussion.html', '/ultra/courses/_101_1/discussion/_11_1': 'ultra-writer-discussion.html', '/ultra/messages/create': 'ultra-writer-messages.html' };
const FORUM = '/learn/api/v1/courses/_101_1/discussionboards/default/forums/';
const out = process.argv[2], shots = process.env.WRITER_SHOTS || '/tmp/gz-writer-compose-shots', lock = require('./check-env.js').lockPath();
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const checks = [], requests = [], errors = []; let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 10000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

// The same page-world harness as scripts/writer-check.js: a real Quill on each writable box, Ultra's enabled-state and
// word count around it, every button click counted.
const HARNESS = `(() => {
  window.__clicks = [];
  document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) __clicks.push(b.textContent.trim()); }, true);
  for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
    const old = c.querySelector('.ql-editor'), id = old.id, placeholder = old.getAttribute('data-placeholder');
    c.innerHTML = '';
    const q = new Quill(c, { placeholder });
    if (id) q.root.id = id;
    const form = c.closest('form'), panel = c.closest('.message-reply-container');
    const buttons = [...(form ? form.querySelectorAll('.js-text-editor-save, .draft-button') : []), ...(panel ? panel.querySelectorAll('.send') : [])];
    const sync = () => { const t = q.getText().trim(); for (const b of buttons) b.disabled = !t; };
    q.on('text-change', sync);
    sync();
  }
  window.__quill = (sel) => document.querySelector(sel).closest('.ql-container').__quill;
})();`;

// A discussion's grade row for the route's content id, in the writer gradebook fixture's shape.
const book = () => {
  const g = json('ultra-writer-gradebook.json'), row = g.results[0];
  const graded = (contentId, id, name) => ({ ...row, columnId: id, id: `_9${id.slice(2)}`, column: { ...row.column, id, contentId, columnName: name, scoreProviderHandle: 'resource/x-bb-forumlink' } });
  return { ...g, results: [...g.results, graded('_9_1', '_820_1', 'Week 6: Memory and Place'), graded('_11_1', '_830_1', 'Week 8: In Brief')] };
};
const ESSAY = ['I agree that the river works as a kind of archive, but I think Morrison is less interested in nostalgia than in what the town chooses to forget.',
  'Baldwin calls this "the price of the ticket" (Baldwin xix), and the clearing seems to collect that price.'];

(async () => {
  let context, held = false, tmp, ext;
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-compose-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-compose-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-writer-compose-'));
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    const got = crypto.createHash('sha256').update(quill).digest('hex');
    if (got !== QUILL.sha256) throw Error(`Quill 1.3.7 hash mismatch: ${got}`);
    check(true, `real Quill 1.3.7 fetched and pinned (sha256 ${got.slice(0, 12)}…)`);

    ext = require('./check-env.js').staged(root, [`${site}/*`]);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(10000);
    const grades = book(), list = json('ultra-writer-thread-discussions.json'), page1 = json('ultra-writer-thread.json'), page2 = json('ultra-writer-thread-2.json'), replies = json('ultra-writer-thread-replies.json');
    const memberships = json('ultra-memberships.json');
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      requests.push({ method: req.method(), origin: u.origin, path: u.pathname, search: u.search });
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      if (req.isNavigationRequest() && PAGES[u.pathname]) return r.fulfill({ contentType: 'text/html', body: fixture(PAGES[u.pathname]).replace('<head>', '<head><base href="/ultra/">').replace('</body>', '<script src="/gz-check/quill.js"></script><script src="/gz-check/harness.js"></script></body>') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      let data = { results: [] };
      if (u.pathname.endsWith('/users/me')) data = { id: '_42_1', userName: 'synthetic' };
      else if (u.pathname.includes('/gradebook/grades')) data = grades;
      else if (/\/users\/_42_1\/memberships$/.test(u.pathname)) data = memberships;
      else if (u.pathname === '/learn/api/public/v1/courses/_101_1/discussions') data = list;
      else if (u.pathname === `${FORUM}_1101_1/messages`) data = u.searchParams.get('offset') === '2' ? page2 : page1;
      else if (u.pathname === `${FORUM}_1101_1/messages/_201_1/replies`) data = replies;
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
    await worker.evaluate(async ({ settings, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] }); }, { settings, site });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();

    const open = async (url) => {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
      await p.goto(`${site}${url}`);
      await p.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
      return p;
    };
    const box = async (p, kind) => {
      const el = await until(async () => { const h = await p.$(`iframe.gz-writer[data-gz-writer-frame="${kind}"]`); return h && await h.evaluate((f) => !f.style.opacity && f.offsetHeight > 100) && h; }, `${kind} frame shown`);
      const fr = await until(() => el.contentFrame(), `${kind} frame document`);
      await until(() => fr.evaluate(() => !!document.querySelector('.ProseMirror')), `${kind} editor in its frame`);
      return { el, fr };
    };
    const bar = (fr) => fr.evaluate(() => {
      const t = document.querySelector('[data-slot="target"]'), s = document.querySelector('[data-slot="sources"]'), arc = t.querySelector('.arc');
      const color = (v) => { const e = document.createElement('i'); e.style.color = `var(${v})`; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; };
      return { target: t.querySelector('.gz-num')?.textContent || '', ring: !!t.querySelector('svg.gz-ring:not([hidden])'), state: t.dataset.state || '', title: t.title, offset: Number(arc?.getAttribute('stroke-dashoffset')), stroke: arc && getComputedStyle(arc).stroke,
        ok: color('--gz-ok'), warn: color('--gz-warn'), accent: color('--gz-accent'),
        sources: s.textContent, sourcesShown: getComputedStyle(s).display !== 'none', sourcesTitle: s.title };
    });
    const quillHTML = (p, sel) => p.evaluate((s) => document.querySelector(s).innerHTML, sel);
    const shot = async (target, name, clip) => { fs.mkdirSync(shots, { recursive: true }); await pause(250); const f = path.join(shots, name); const { full, ...box } = clip || {}; await target.screenshot({ path: f, ...(clip && { clip: box, fullPage: !!full }) }); return f; };
    const saved = {};
    const REPLY = '.ql-editor[data-placeholder="Type a reply"]';

    // ---- the reply box's context ----
    let p = await open('/ultra/courses/_101_1/discussion/_9_1');
    const reply = await box(p, 'reply'), post = await box(p, 'post');
    const ctx = await until(() => reply.fr.evaluate(() => { const c = GZ_WRITER_FRAME.context(); return c.thread?.length && c.requirements && c; }), 'reply context with the thread');
    check(ctx.kind === 'reply' && ctx.prompt.text.startsWith('How does Morrison use the river') && ctx.course.id === '_101_1' && ctx.course.name, 'the reply frame gets the prompt from topic.body and the course');
    check(JSON.stringify(ctx.requirements) === JSON.stringify({ minWords: 250, maxWords: null, sources: 2, replies: 2 }), 'requirements read from the prompt: 250 words, 2 sources, 2 replies');
    check(ctx.thread.map((x) => x.id).join() === '_201_1,_301_1,_302_1,_202_1,_203_1' && ctx.thread.filter((x) => x.mine).map((x) => x.id).join() === '_302_1,_203_1', 'the thread: both pages, the answered post\'s replies, the student\'s own marked');
    check(ctx.replyTo.id === '_201_1' && ctx.replyTo.author === 'Jordan Lee' && ctx.replyTo.text.startsWith('The river is where'), 'replyTo: the post the reply box answers, its author from the thread data');
    check(ctx.user.name === 'Sam Rivera', 'the student\'s name from their own posts (users/me names nobody here)');
    const postCtx = await post.fr.evaluate(() => GZ_WRITER_FRAME.context());
    check(postCtx.kind === 'post' && !('replyTo' in postCtx) && postCtx.thread.length === 5, 'the post composer gets the same thread, no replyTo');
    const thread = requests.filter((r) => r.path.startsWith(FORUM) || r.path.includes('/discussions'));
    check(thread.length === 4 && thread.every((r) => r.method === 'GET'), `the thread costs four GETs: discussions, two message pages, one replies (${thread.map((r) => r.path.split('/').slice(-2).join('/') + r.search).join(', ')})`);

    // ---- the ring and the pill ----
    let b = await until(async () => { const v = await bar(reply.fr); return v.target === '0 / 250' && v; }, 'ring at 0 / 250');
    check(b.ring && Math.abs(b.offset - 94.25) < 0.1 && /At least 250 words\nReply to 2 classmates/.test(b.title), 'an empty reply: an empty ring, "0 / 250", the replies only in its tooltip');
    check(b.sourcesShown && b.sources === '❝0 / 2' && b.sourcesTitle === 'Cite 2 sources', 'the sources pill: "❝ 0 / 2"');

    // ---- Quote: mouse ----
    await p.evaluate(() => document.activeElement.blur?.());
    const quoted = 'Every time a character crosses it, they carry something they can\'t put down';
    const span = await p.evaluate((q) => {
      const body = document.querySelector('[message-id="_201_1"] .ql-editor'), t = body.querySelector('p').firstChild, i = t.data.indexOf(q);
      const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + q.length);
      const rects = [...r.getClientRects()];
      return { from: { x: rects[0].left + 1, y: rects[0].top + rects[0].height / 2 }, to: { x: rects.at(-1).right - 1, y: rects.at(-1).top + rects.at(-1).height / 2 }, mid: (rects[0].left + rects[0].right) / 2, top: rects[0].top };
    }, quoted);
    await p.mouse.move(span.from.x, span.from.y); await p.mouse.down(); await p.mouse.move(span.to.x, span.to.y, { steps: 8 }); await p.mouse.up();
    const host = await until(() => p.evaluate(() => { const h = document.querySelector('.gz-writer-quote'); return h?.isConnected && h.hasAttribute('data-open') && h.getBoundingClientRect().toJSON(); }), 'Quote pop shown');
    check(await p.evaluate((q) => getSelection().toString() === q, quoted), 'a mouse selection in the classmate\'s post shows the Quote pop, the selection untouched');
    check(host.top <= span.top && host.top > span.top - 20 && Math.abs(host.left - span.mid) < 3, `the pop sits centred above the selection's first line (${JSON.stringify({ host: [host.left, host.top], line: [span.mid, span.top] })})`);
    check(await p.evaluate(() => { const h = document.querySelector('.gz-writer-quote'); return h.previousElementSibling?.matches('.ql-container.is-read-only') && !!h.closest('[message-id="_201_1"]'); }), 'it sits right after the post\'s text, in its tab order');
    saved.quote = await shot(p, 'compose-quote.png', await p.evaluate(() => { const r = document.querySelector('.comment-entry').getBoundingClientRect(); return { x: r.left - 24, y: r.top - 64, width: r.width + 48, height: r.height + 88 }; }));
    await p.mouse.click(host.left, host.top - 14);
    await until(async () => (await quillHTML(p, REPLY)).includes('— Jordan Lee'), 'quote in the native Quill');
    const html = await quillHTML(p, REPLY);
    check(html.includes(`<p class="ql-indent-1"><em>${quoted}</em></p>`), 'clicking Quote puts the text in the reply as compose\'s quote (indented italic)…');
    check(html.includes('<p class="ql-indent-1">— Jordan Lee</p>'), '…with its author from the thread data');
    check(await p.evaluate(() => !document.querySelector('.gz-writer-quote')?.isConnected && document.activeElement?.matches('iframe[data-gz-writer-frame="reply"]')) && await reply.fr.evaluate(() => !!document.activeElement?.closest('.ProseMirror')), 'the pop goes and the reply\'s editor has focus');
    check(await reply.fr.evaluate(() => [...document.querySelectorAll('.ProseMirror p.gz-quote')].length === 2 && !!document.querySelector('.ProseMirror p.gz-quote-by.gz-quote-end')), 'the editor draws it as the mockup\'s quote block');

    // ---- writing under the quote, as the mockup has it ----
    await p.keyboard.type(ESSAY[0], { delay: 1 });
    await p.keyboard.press('Enter');
    await p.keyboard.type(ESSAY[1], { delay: 1 });
    const n = await until(async () => { const w = await reply.fr.evaluate(() => GZ_WRITER_FRAME.editor().words()); return w > 46 && w; }, 'words typed');
    b = await until(async () => { const v = await bar(reply.fr); return v.target === `${n} / 250` && v; }, 'ring counts typed words');
    check(Math.abs(b.offset - 94.25 * (1 - n / 250)) < 0.1 && b.state === '', `typing fills the ring toward the minimum (${b.target})`);
    check(b.sources === '❝1 / 2', 'an in-text citation counts: "❝ 1 / 2"');
    check(await reply.fr.evaluate(() => getComputedStyle(document.querySelector('.gz-ring .arc')).transitionDuration === '0s'), 'the ring doesn\'t animate while typing');
    saved.reply = await shot(p, 'compose-reply.png', { ...await p.evaluate(() => { const a = document.querySelector('.comment-and-reply').getBoundingClientRect(), z = document.querySelector('.reply-input-wrapper .form-buttons').getBoundingClientRect(); return { x: a.left - 40, y: a.top + scrollY - 24, width: a.width + 80, height: z.bottom - a.top + 48 }; }), full: true });

    // ---- Quote: keyboard, scroll, blur, Escape ----
    const selectQuote = (q = 'the novel keeps returning to the bank') => p.evaluate((q) => { const t = document.querySelector('[message-id="_201_1"] .ql-editor p').firstChild, i = t.data.indexOf(q), r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + q.length); getSelection().removeAllRanges(); getSelection().addRange(r); }, q);
    const popShown = () => until(() => p.evaluate(() => !!document.querySelector('.gz-writer-quote')?.isConnected), 'pop shown');
    const popGone = (label) => until(() => p.evaluate(() => !document.querySelector('.gz-writer-quote')?.isConnected), label, 3000);
    await p.evaluate(() => { document.activeElement.blur?.(); document.body.style.minHeight = '3000px'; });
    await p.mouse.click(5, 5);
    await selectQuote(); await popShown();
    await p.evaluate(() => scrollBy(0, 30)); await popGone('pop gone on scroll'); await p.evaluate(() => scrollTo(0, 0));
    check(true, 'scrolling takes the pop away');
    await selectQuote('the water itself'); await popShown();
    await p.evaluate(() => dispatchEvent(new Event('blur'))); await popGone('pop gone on blur');
    check(true, 'leaving the window takes it away');
    await selectQuote('keeping score'); await popShown();
    await p.keyboard.press('Escape'); await popGone('pop gone on Escape');
    check(true, 'Escape takes it away');
    // Tab from a selection goes on from where it is: the pop, right after the post's text.
    const kb = await p.evaluate((q) => { const t = document.querySelector('[message-id="_201_1"] .ql-editor p').firstChild, i = t.data.indexOf(q), r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + q.length); const a = r.getClientRects()[0], z = [...r.getClientRects()].at(-1); return { a: [a.left + 1, a.top + a.height / 2], z: [z.right - 1, z.top + z.height / 2] }; }, 'the novel keeps returning to the bank');
    await p.mouse.move(...kb.a); await p.mouse.down(); await p.mouse.move(...kb.z, { steps: 8 }); await p.mouse.up();
    await popShown();
    await p.keyboard.press('Tab');
    const focused = await p.evaluate(() => document.activeElement?.className);
    check(focused === 'gz-writer-quote', `Tab from the selection reaches the pop (${focused})`);
    await p.keyboard.press('Enter');
    await until(async () => (await quillHTML(p, REPLY)).includes('<em>the novel keeps returning to the bank</em>'), 'keyboard quote in Quill');
    check(true, 'Enter on the focused pop quotes');

    // ---- Markdown and Ctrl/Cmd+Enter beside the ring ----
    await reply.fr.click('.ProseMirror'); await pause(150);
    await reply.fr.evaluate(() => { const v = GZ_WRITER_FRAME.editor().view; v.dispatch(v.state.tr.setSelection(GZ_PM.state.Selection.atEnd(v.state.doc))); });
    await p.keyboard.type('- a list item from markdown ', { delay: 1 });
    await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
    await p.keyboard.type('Two **bold** words.', { delay: 1 });
    await until(async () => { const h = await quillHTML(p, REPLY); return h.includes('<li>a list item from markdown') && h.includes('<strong>bold</strong>'); }, 'markdown in Quill').catch(async (e) => { console.error(await quillHTML(p, REPLY), '\nFRAME', await reply.fr.evaluate(() => document.querySelector('.ProseMirror').innerHTML)); throw e; });
    check(true, 'Markdown shortcuts ("- ", "**…**") reach the native Quill as a list and bold');
    b = await bar(reply.fr);
    const words = await reply.fr.evaluate(() => GZ_WRITER_FRAME.editor().words());
    check(b.target === `${words} / 250` && words > 60, `the ring follows the Markdown edits (${b.target})`);
    await p.keyboard.press(`${MOD}+Enter`); await pause(400);
    check((await p.evaluate(() => __clicks.slice())).filter((c) => c === 'Reply').length === 1, 'Ctrl/Cmd+Enter beside the ring clicks the native Reply once');
    await p.close();

    // ---- ok and over: a 10–20 word prompt ----
    p = await open('/ultra/courses/_101_1/discussion/_11_1');
    const brief = await box(p, 'post');
    await until(async () => (await bar(brief.fr)).target === '0 / 10', 'ring at 0 / 10');
    check(!(await bar(brief.fr)).sourcesShown, 'no sources asked: no pill');
    await brief.fr.click('.ProseMirror');
    await p.keyboard.type('Sethe keeps her daughter in memory, and the town finally comes to the clearing.', { delay: 1 });
    b = await until(async () => { const v = await bar(brief.fr); return v.state === 'ok' && v; }, 'ring ok');
    check(b.target === '14 / 20' && b.offset === 0 && b.stroke === b.ok && b.ok !== b.accent, 'at the minimum the ring is full and turns green');
    check(b.title === '10–20 words', 'past the minimum it counts toward the maximum; its tooltip gives the range');
    saved.ok = await shot(brief.el, 'compose-ring-ok.png');
    await p.keyboard.type(' Paul D stays, Denver goes out into the world, and Beloved is gone.', { delay: 1 });
    b = await until(async () => { const v = await bar(brief.fr); return v.state === 'over' && v; }, 'ring over');
    check(b.target === "27 / 20" && b.stroke === b.warn && b.warn !== b.ok, `past the maximum it turns amber (${b.target})`);
    saved.over = await shot(brief.el, 'compose-ring-over.png');
    await p.close();

    // ---- a message: course and student only, plain word count ----
    p = await open('/ultra/messages/create?courseId=_101_1');
    const msg = await box(p, 'message');
    const mctx = await until(() => msg.fr.evaluate(() => { const c = GZ_WRITER_FRAME.context(); return c.course && c; }), 'message context');
    check(JSON.stringify(Object.keys(mctx)) === '["kind","course","user"]' && mctx.course.id === '_101_1', 'a message gets its course and the student only');
    await msg.fr.click('.ProseMirror');
    await p.keyboard.type('Could you share the reading list?', { delay: 1 });
    b = await until(async () => { const v = await bar(msg.fr); return v.target === '6 words' && v; }, 'plain word count');
    check(!b.ring && !b.title && !b.sourcesShown, 'without a target: plain "6 words", no ring, no tooltip, no pill');
    saved.message = await shot(msg.el, 'compose-message.png');
    await p.close();

    check(errors.length === 0, `no page or frame errors (${errors.join('; ')})`);
    check(requests.every((r) => r.method === 'GET' && r.origin === site), 'every LMS request is a synthetic GET');
    passed = true;
    console.log(JSON.stringify({ checks: checks.length, shots: saved }, null, 2));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, requests, errors }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), e.stack + '\n'); } process.exitCode = 1; });
