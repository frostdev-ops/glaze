// Practise with Glaze Writer on a synthetic Blackboard Ultra (scripts/ultra-mock.js): a Chromium window with this checkout's
// extension, or --ext's, on a discussion to post and reply in and an assignment to submit, so each goes through Writer as
// it would on a real course; what the mock Blackboard receives is shown on the page and kept in <practice>/received.
//   NODE_PATH=/Users/jame/Projects/gemino/node_modules node scripts/writer-practice.js [--ext <checkout>] [--fresh] [--ai mock]
// The profile (Settings, Looks, AI, papers) stays in <practice>/profile between runs; --fresh starts it over. The window is
// offline but for the AI connection set up in its Settings → AI (scripts/practice-ai.js); --ai mock sets up a stand-in model
// on this computer instead, so every AI feature answers with synthetic words for free.
// <practice> is GLAZE_PRACTICE, else ~/Projects/glaze-plans/writer/practice.
// --smoke: headless and scripted, with a profile of its own: a reply, a post, and a submission through Writer's sheet,
// checked, with Feedback from the stand-in model. Run it under the shared heavy-check lock; screenshots go to <practice>/shots.
const assert = require('node:assert/strict');
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), M = require('./ultra-mock.js'), NET = require('./practice-ai.js');
const DT = require('../lib/doctext.js');

const usage = 'NODE_PATH=/Users/jame/Projects/gemino/node_modules node scripts/writer-practice.js [--ext <checkout>] [--fresh] [--ai mock] [--smoke]';
const options = (args) => {
  const opt = { smoke: false, fresh: false, help: false, ai: '', root: path.join(__dirname, '..') };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--smoke') opt.smoke = true;
    else if (args[i] === '--fresh') opt.fresh = true;
    else if (args[i] === '--help') opt.help = true;
    else if (args[i] === '--ai' && args[i + 1] === 'mock') { opt.ai = 'mock'; i++; }
    else if (args[i] === '--ext' && args[i + 1] && !args[i + 1].startsWith('--')) opt.root = path.resolve(args[++i]);
    else throw Error(`Invalid argument: ${args[i]}\n${usage}`);
  }
  return opt;
};
// Every request goes to the proxy (a dead one at port 0, else scripts/practice-ai.js, which lets through only the AI
// connection): literal IPs, localhost and the service-worker traffic Playwright cannot route included. DNS denial covers the
// rest of the browser's own work, all but the proxy's address. Extension resources stay local; mock requests are fulfilled
// before network access.
const browserArgs = (ext, smoke, proxy = 0) => [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', `--proxy-server=http://127.0.0.1:${proxy}`, '--proxy-bypass-list=<-loopback>',
  '--disable-background-networking', '--disable-quic', ...(smoke ? [] : ['--window-size=1440,1000'])];
const observe = (context, errors) => {
  context.on('weberror', (e) => errors.push(`page: ${e.error().message}`));
  context.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
};
let interrupted = false;
const pause = async (ms) => { if (interrupted) throw Error('Practice interrupted'); await new Promise((r) => setTimeout(r, ms)); };
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const text = (html) => squash(String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'));

// The extension with the school's host in its manifest, as scripts/check-env.js stages it (the student's grant, on a real
// site), but at a fixed path: Chrome derives an unpacked extension's id from it, and the profile keeps Glaze's data by id.
const stage = (src, to, hosts = []) => {
  fs.rmSync(to, { recursive: true, force: true });
  const link = (a, b) => {
    fs.mkdirSync(b, { recursive: true });
    for (const e of fs.readdirSync(a, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const x = path.join(a, e.name), y = path.join(b, e.name);
      if (e.isDirectory()) link(x, y); else if (e.isFile()) { try { fs.linkSync(x, y); } catch { fs.copyFileSync(x, y); } }
    }
  };
  link(fs.realpathSync(src), to);
  fs.rmSync(path.join(to, 'manifest.json'));
  const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  m.host_permissions = [...new Set([...(m.host_permissions || []), `${M.SITE}/*`, ...hosts])];
  fs.writeFileSync(path.join(to, 'manifest.json'), JSON.stringify(m, null, 2));
  return fs.realpathSync(to);
};

// ---- AI in the practice window ----------------------------------------------------------------------------------------
// What the proxy lets through: an address one of Glaze's AI connections names (the worker's own store, glaze-ai/vault,
// lib/ai/broker.js) and Glaze holds the grant for. Read in the worker, the one place that may ask (a key never leaves it):
// for every previously allowed address (a removed connection or grant must stop working at once). Unknown addresses
// share a negative cache for 300 ms, so the browser's own background requests don't keep waking the worker.
const connections = async (context, id) => {
  const w = context?.serviceWorkers().find((x) => x.url().startsWith(`chrome-extension://${id}/`));
  if (!w) return [];
  return w.evaluate(async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'glaze-ai')) return [];
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('glaze-ai'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      if (!db.objectStoreNames.contains('vault')) return [];
      const all = await new Promise((resolve, reject) => { const r = db.transaction('vault').objectStore('vault').get('connections'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const out = [];
      for (const c of Object.values(all && typeof all === 'object' ? all : {})) {
        let u;
        try { u = new URL(c?.base); } catch { continue; }
        if (await chrome.permissions.contains({ origins: [`${u.protocol}//${u.hostname}/*`] })) out.push({ protocol: u.protocol, host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) });
      }
      return out;
    } finally { db.close(); }
  }).catch(() => []);
};
const reachable = (context, id) => {
  let kept = null;
  const told = new Set();
  return async ({ protocol, host, port }) => {
    const has = async () => (await kept.list).some((c) => c.protocol === protocol && c.host === host && c.port === port);
    if (!kept || Date.now() - kept.at > 300 || await has()) kept = { at: Date.now(), list: connections(context(), id()) };
    const ok = await has(), at = `${protocol}//${host}:${port}`;
    if (ok && !told.has(at)) { told.add(at); console.log(`[practice] Glaze's AI connection reaches ${at}`); }
    return ok;
  };
};
// --ai mock: Settings → AI with the stand-in model chosen and every feature on, as a student sets it up (its own connection,
// so one the owner made stays). Without it, a stand-in left from an earlier run is unchosen.
const MOCK = 'practice-mock';
const setUpAI = async (context, id, port) => {
  const on = await inExtension(context, id, async (mock) => (await chrome.storage.local.get('ai')).ai?.model?.use === mock, MOCK);
  if (!port && !on) return;
  const p = await context.newPage();
  try {
    await p.goto(`chrome-extension://${id}/options.html`);
    await p.evaluate(async ({ id, port }) => {
      const ai = (await chrome.storage.local.get('ai')).ai || {};
      if (!port) {
        await chrome.runtime.sendMessage({ type: 'glaze:ai-config', op: 'remove', id });
        await chrome.storage.local.set({ ai: { ...ai, model: null } });
        return;
      }
      const r = await chrome.runtime.sendMessage({ type: 'glaze:ai-config', op: 'set', id, cfg: { provider: 'openai', name: 'Practice', base: `http://127.0.0.1:${port}/v1` } });
      if (!r?.ok) throw Error(`the stand-in model wasn't kept: ${r?.error}`);
      await chrome.storage.local.set({ ai: { on: true, model: { use: id, model: 'practice-mock' }, features: { syllabus: true, completion: true, writing: true } } });
    }, { id: MOCK, port });
  } finally { await p.close(); }
};

// Run fn(arg) with the extension's APIs: in its worker, or, while that sleeps, in one of its pages.
const inExtension = async (context, id, fn, arg) => {
  const w = context.serviceWorkers().find((x) => x.url().startsWith(`chrome-extension://${id}/`));
  if (w) return w.evaluate(fn, arg);
  const p = await context.newPage();
  try { await p.goto(`chrome-extension://${id}/popup.html`); return await p.evaluate(fn, arg); } finally { await p.close(); }
};

// The assignment's paper frame on the attempt page, loaded and paged, from the practice home or the attempt itself.
const paper = async (p) => {
  if (new URL(p.url()).pathname !== M.ROUTES.attempt) { await p.goto(`${M.SITE}/practice`); await p.click(`a[href="${M.ROUTES.attempt}"]`); }
  const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity && f.offsetHeight > 500) && x; }, 'paper frame shown');
  const fr = await until(() => el.contentFrame(), 'paper frame document');
  await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key() && document.querySelectorAll('.gp-sheet').length > 0), 'paper loaded and paged');
  return fr;
};

// ---- the scripted run: what the owner does by hand, checked
const run = async ({ context, mock, shots, errors, ai }) => {
  const FX = require('../test/fixtures/writer-paper-fixtures.js');
  const checks = [], saved = {};
  const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
  const shot = async (p, name, full = false) => { fs.mkdirSync(shots, { recursive: true }); await pause(250); const f = path.join(shots, name); await p.screenshot({ path: f, fullPage: full }); saved[name] = f; };
  const frame = async (p, kind) => {
    const el = await until(async () => { const h = await p.$(`iframe.gz-writer[data-gz-writer-frame="${kind}"]`); return h && await h.evaluate((f) => !f.style.opacity && f.offsetHeight > 60) && h; }, `${kind} frame shown`);
    await el.evaluate((f) => f.scrollIntoView({ block: 'center' }));
    const fr = await until(() => el.contentFrame(), `${kind} frame document`);
    await until(() => fr.evaluate(() => !!document.querySelector('.ProseMirror')), `${kind} editor`);
    return { el, fr };
  };
  const latest = (kind, after) => until(() => mock.received.slice(after).find((r) => r.kind === kind), `Blackboard received the ${kind}`, 20000);
  // The keys in a paper, as a student types: gray text where they pause after a space, Tab takes it, Tab then writes a
  // tab, Escape then Tab leaves; and the Outline lists the paper. The paper is put back as it was.
  const keysIn = async (fr, where) => {
    const before = await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON());
    const para = () => fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; return v.state.selection.$head.parent.textContent; });
    const inEditor = () => fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.hasFocus());
    await fr.evaluate(() => {
      const v = GZ_WRITER_PAPER.current().editor.view, d = v.state.doc;
      let pos = 0;
      for (let i = 0; i < 6; i++) pos += d.child(i).nodeSize;
      v.focus();
      v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(d, pos - 1)));
    });
    const kb = fr.page().keyboard;
    await kb.press('Enter');
    await kb.type('The river keeps what the town ', { delay: 30 });
    const ghost = await until(() => fr.evaluate(() => document.querySelector('.gz-ghost')?.firstChild?.textContent || ''), `${where}: gray text after a space`, 8000).catch(() => '');
    check(ghost === 'and what the town remembers.', `${where}: gray text shows where the student pauses after a space (${JSON.stringify(ghost)})`);
    await kb.press('Tab');
    check(await para() === 'The river keeps what the town and what the town remembers.' && !await fr.evaluate(() => !!document.querySelector('.gz-ghost')) && await inEditor(), `${where}: Tab takes the gray text and stays in the paper`);
    await kb.press('Tab');
    check((await para()).endsWith('remembers.\t') && await inEditor(), `${where}: with no gray text, Tab writes a tab`);
    await kb.press('Escape');
    await kb.press('Tab');
    check(!await inEditor(), `${where}: Escape then Tab leaves the paper`);
    await fr.click('#gp-tab-outline');
    const outline = await fr.evaluate(() => [...document.querySelectorAll('.gp-outline .gp-ol-row')].map((b) => [b.dataset.kind, b.querySelector('span').textContent, b.querySelector('small').textContent]));
    check(outline.length >= 2 && outline[0][0] === 'title' && outline.at(-1).slice(0, 2).join() === 'list,Works Cited' && outline.every((x) => /^\d+$/.test(x[2])), `${where}: the Outline lists the title and Works Cited, each with its page (${outline.map((x) => `${x[1]} ${x[2]}`).join(' | ')})`);
    await fr.evaluate((doc) => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON(doc).content)); }, before);
    await until(() => fr.evaluate(() => document.querySelector('.gp-state')?.textContent === 'Saved'), `${where}: paper saved as it was`, 20000);
  };
  const REPLY = 'Keeping score fits the clearing as well, since Baby Suggs asks the town to remember what it lost.';
  const POST = 'The river carries what the town will not say aloud, and the clearing is where that memory can finally be spoken.';

  // Incognito keeps the extension out of this native-model check. Exercise the mock's gates independently of Writer.
  const native = await context.browser().newContext();
  try {
    await native.route('**/*', mock.handle);
    // Expected failures are isolated from the workflow's clean-console check. A local canary detects IP/proxy bypasses
    // without attempting any real site; extension-worker requests can bypass Playwright's HTTP routes.
    let hits = 0;
    const canary = require('node:http').createServer((req, res) => { hits++; res.setHeader('access-control-allow-origin', '*'); res.end('synthetic canary'); });
    let guard;
    try {
      await new Promise((resolve, reject) => { canary.once('error', reject); canary.listen(0, '127.0.0.1', resolve); });
      guard = await native.newPage();
      const url = `http://127.0.0.1:${canary.address().port}/synthetic-canary`;
      const pageBlocked = await guard.goto(url).then(() => false, () => true);
      const worker = context.serviceWorkers()[0];
      const workerBlocked = worker && await worker.evaluate(async (url) => { try { await fetch(url, { signal: AbortSignal.timeout(3000) }); return false; } catch { return true; } }, url);
      check(pageBlocked && workerBlocked && hits === 0, 'page routes and the browser proxy prevent page/extension-worker access to a loopback canary');
    } finally { await guard?.close(); await new Promise((resolve) => canary.close(resolve)); }
    const p = await native.newPage();
    observe(native, errors);
    await p.goto(`${M.SITE}${M.ROUTES.discussion}`);
    await until(() => p.evaluate(() => window.__threadReady), 'native thread');
    check(!await p.$('iframe.gz-writer'), 'native model checked without Writer');
    const editor = 'form[name="editorForm"] .ql-editor[contenteditable="true"]';
    const disabled = () => p.evaluate(() => [...document.querySelectorAll('form[name="editorForm"] .draft-button, form[name="editorForm"] .js-text-editor-save')].every((b) => b.disabled));
    await p.focus(editor);
    check(await disabled() && await p.$eval('.panel-editor-controls', (c) => c.classList.contains('ng-hide')), 'focus alone does not activate Ultra or enable Post/Save Draft');
    await p.click(editor);
    check(await disabled(), 'activating an empty composer leaves Post and Save Draft disabled');
    await p.evaluate(() => document.activeElement.blur());
    check(await p.$eval('.panel-editor-controls', (c) => c.classList.contains('ng-hide') && c.getAttribute('aria-hidden') === 'true'), 'an empty post collapses as soon as focus leaves');
    await p.$eval(editor, (e) => e.closest('.ql-container').__quill.setText('Inactive synthetic sample', 'user'));
    check(await disabled(), 'sync into the inactive native composer cannot enable Post or Save Draft');
    await p.$eval(editor, (e) => e.closest('.ql-container').__quill.setText('', 'user'));
    await p.click(editor);
    await p.keyboard.type('Synthetic native post');
    check(await p.evaluate(() => [...document.querySelectorAll('form[name="editorForm"] .draft-button, form[name="editorForm"] .js-text-editor-save')].every((b) => !b.disabled)), 'native text enables both Post and Save Draft');
    await p.$eval(editor, (e) => e.closest('.ql-container').__quill.setText('', 'user'));
    check(await disabled(), 'clearing native text disables Post and Save Draft');
    await p.evaluate(() => document.activeElement.blur());
    await p.click('button[aria-label="Reply to message from Jordan Lee"]');
    const reply = '.reply-input-wrapper';
    check(await p.$eval(`${reply} .panel-editor-controls`, (c) => c.getAttribute('ng-show') === 'isEditorActive' && !c.classList.contains('ng-hide')) && await disabled(), 'a reply opens active with empty Save Draft and Reply disabled');
    await p.$eval(`${reply} .ql-editor`, (e) => e.closest('.ql-container').__quill.setText('Synthetic native reply', 'user'));
    check(await p.$eval(reply, (r) => [...r.querySelectorAll('.draft-button, .js-text-editor-save')].every((b) => !b.disabled)), 'native reply text enables Save Draft and Reply');
    await p.$eval(`${reply} .ql-editor`, (e) => e.closest('.ql-container').__quill.setText('', 'user'));
    check(await disabled(), 'clearing a reply disables Save Draft and Reply');
    await p.click(`${reply} [ng-click="messageControl.onCancelClick()"]`);
    check(!await p.$(reply), 'native Cancel closes the empty reply');
    await p.goto(`${M.SITE}${M.ROUTES.attempt}`);
    check(await p.evaluate(() => [...document.querySelectorAll('footer button')].every((b) => b.disabled && b.classList.contains('Mui-disabled') && b.tabIndex === -1)), 'an empty attempt starts with disabled native Save and Close/Submit');
    check(await p.locator('[class*="makeStylespreview-"] [class*="makeStylesinputContainer-"] input[type=file][multiple][aria-hidden=true]').count() === 1 && !await p.$('[data-analytics-id="editor.toolbar.insertLocalFile.button"]'), 'the attempt has its separate hidden multiple-file input, without a Quill upload button');
  } finally { await native.close(); }

  const p = context.pages()[0] || await context.newPage();
  await p.goto(`${M.SITE}/practice`);
  check(await p.textContent('h1') === 'Writer practice' && await p.locator('[data-reset]').count() === 2, 'practice home: the discussion and the assignment, each with a reset');
  await p.click(`a[href="${M.ROUTES.discussion}"]`);
  await until(() => p.evaluate(() => window.__threadReady && document.documentElement.hasAttribute('data-gz-motion')), 'thread drawn and Glaze running');
  check(await p.locator('.comment-level-0').count() === 3 && await p.locator('.comment-level-1').count() === 2, 'the thread: three posts and two replies from the messages API');
  check(await p.evaluate(() => { const c = document.querySelector('.panel-editor-controls'); return c.classList.contains('ng-hide') && c.getAttribute('aria-hidden') === 'true' && !document.querySelector('form[name="editorForm"] .bb-editor-toolbar'); }) && !await p.$('iframe.gz-writer[data-gz-writer-frame="post"]'),
    'the new post starts collapsed (no toolbar, controls hidden) and stays Ultra\'s');

  // ---- a reply: Reply opens Ultra's box, Writer takes it, Ultra's Reply sends what Writer wrote
  await p.click('button[aria-label="Reply to message from Jordan Lee"]');
  const r = await frame(p, 'reply');
  await r.fr.click('.ProseMirror');
  await p.keyboard.type(REPLY, { delay: 4 });
  await until(() => p.evaluate(() => !document.querySelector('.reply-input-wrapper .js-text-editor-save').disabled), 'Ultra enables Reply');
  await shot(p, 'practice-reply.png');
  let n = mock.received.length;
  await p.click('.reply-input-wrapper .js-text-editor-save');
  const reply = await latest('reply', n);
  const replyHTML = fs.readFileSync(path.join(reply.dir, 'message.html'), 'utf8');
  check(text(replyHTML) === REPLY && /^<p>/.test(replyHTML), `Blackboard received the reply as Quill HTML (${reply.dir})`);
  check(await until(() => p.evaluate((t) => !document.querySelector('.reply-input-wrapper') && [...document.querySelectorAll('.comment-level-1 .ql-editor')].some((e) => e.textContent.includes(t)), REPLY.slice(0, 30)), 'reply drawn in the thread'),
    'the reply shows under Jordan Lee\'s post and its box closes');

  // ---- a new post: the student clicks it; Writer takes the empty composer and the caret, and Ultra's stays open
  await p.click('bb-rich-text-editor[editor-aria-label="Post text editor"] .ql-editor');
  const po = await frame(p, 'post');
  // The frame's document.hasFocus() stays false in headless Chromium; the page's focus is on the frame and the frame's on its editor.
  await until(async () => await p.evaluate(() => document.activeElement?.matches('iframe.gz-writer[data-gz-writer-frame="post"]')) && po.fr.evaluate(() => !!document.activeElement?.closest('.ProseMirror')), 'Writer holds the caret');
  check(await p.evaluate(() => !document.querySelector('.panel-editor-controls').classList.contains('ng-hide') && !!document.querySelector('form[name="editorForm"] .bb-editor-toolbar'))
    && await po.fr.evaluate(() => !document.querySelector('.ProseMirror').textContent), 'a click gives the empty post to Writer, and Ultra\'s composer stays active behind it');
  await pause(400);
  check(await p.$('iframe.gz-writer[data-gz-writer-frame="post"]') && await p.evaluate(() => !document.querySelector('.panel-editor-controls').classList.contains('ng-hide')), 'the empty post does not collapse while Writer has the caret');
  await p.keyboard.type(POST, { delay: 4 });
  await p.keyboard.press('ControlOrMeta+A');
  await p.keyboard.press('ControlOrMeta+B');
  await until(() => p.evaluate(() => !document.querySelector('form[name="editorForm"] .js-text-editor-save').disabled), 'Ultra enables Post');
  await shot(p, 'practice-post.png');
  n = mock.received.length;
  await p.click('form[name="editorForm"] .js-text-editor-save');
  const posted = await latest('post', n);
  const postHTML = fs.readFileSync(path.join(posted.dir, 'message.html'), 'utf8');
  check(postHTML.trim() === `<p><strong>${POST}</strong></p>`, `Blackboard received the formatted post HTML, in order, from its first letter (${posted.dir})`);
  await until(() => p.evaluate((t) => [...document.querySelectorAll('.comment-level-0 > .comment-entry .ql-editor')].some((e) => e.textContent.includes(t)), POST.slice(0, 30)), 'post drawn in the thread');
  await until(() => p.evaluate(() => document.querySelector('.panel-editor-controls').classList.contains('ng-hide') || document.querySelector('form[name="editorForm"] .js-text-editor-save').disabled), 'Ultra clears its composer');
  const left = await p.evaluate(() => { const f = document.querySelector('iframe.gz-writer[data-gz-writer-frame="post"]'); return f ? 'frame' : 'native'; });
  const leftText = left === 'frame' ? await po.fr.evaluate(() => document.querySelector('.ProseMirror')?.textContent || '').catch(() => '') : '';
  check(!squash(leftText), `after Post, nothing is left behind in the composer (${left})`);
  check(await p.evaluate(() => window.__sends) === 2, 'Ultra\'s Post and Reply each sent once');
  await p.click('.practice-log summary');
  await shot(p, 'practice-discussion.png', true);

  // ---- the assignment: a paper, Feedback from the stand-in model, Writer's sheet, Ultra's Submit once, Ultra's
  // confirmation, what Blackboard received. AI is set up first, as a student who turned it on comes to the attempt.
  await ai();
  let fr = await paper(p);
  const doc = FX.papers.mla9();
  doc.content[4].content[0].text = `SYNTHETIC PRACTICE PAPER: ${doc.content[4].content[0].text}`;
  await fr.evaluate(async (doc) => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON(doc).content)); }, doc);
  await until(() => fr.evaluate(() => document.querySelector('.gp-state')?.textContent === 'Saved'), 'paper saved', 20000);
  await shot(p, 'practice-paper.png');
  // The frame asks about AI before the worker has the attempt's kind; it asks again once the page has told it.
  await fr.click('#gp-tab-feedback');
  const fb = '#gp-feedback .gz-fb';
  const ready = await until(() => fr.evaluate((fb) => document.querySelector(`${fb} .gz-fb-run`)?.textContent === 'Get feedback', fb), 'Feedback ready', 10000).catch(() => false);
  check(ready, `with AI set up, Feedback offers to run on the assignment (it said: ${squash(await fr.$eval(fb, (e) => e.textContent).catch(() => ''))})`);
  await keysIn(fr, 'the attempt');
  await fr.click('#gp-tab-feedback');
  await fr.click(`${fb} .gz-fb-run`);
  const cards = await until(() => fr.evaluate((fb) => { const c = document.querySelectorAll(`${fb} .gz-fb-item`); return c.length && [...c].map((x) => x.querySelector('.gz-fb-crit')?.textContent || ''); }, fb), 'Feedback from the stand-in model', 20000);
  check(cards.join('|') === 'Criterion one|Criterion two' && await fr.evaluate((fb) => document.querySelectorAll(`${fb} .gz-fb-quote`).length > 0, fb), `Feedback came back for both rubric criteria, with passages of the draft (${cards.join(' | ')})`);
  // The attached Word prompt reached the stand-in as text. Its image capability is unverified, so the missing visual
  // observations must remain an explicit limitation instead of a claim that the picture was reviewed.
  const said = await fr.$eval(`${fb} .gz-fb-item .gz-fb-comment`, (e) => e.textContent).catch(() => '');
  check(said.includes('read against the attached Essay 2 prompt.docx, with unavailable picture observations'), `Feedback read the attached Word prompt and named the unavailable visual evidence (${said})`);
  const limitation = await fr.$$eval(`${fb} .gz-fb-comment, ${fb} .gz-fb-note`, (els) => els.map((e) => e.textContent).join(' '));
  check(limitation.includes('explore3.png') && /could not be read|cannot read images/.test(limitation), `Feedback explains the unread image limitation (${limitation})`);
  await shot(p, 'practice-feedback.png');
  await fr.click('#gp-tab-checks');
  const docText = await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.text());
  const at = await p.$eval('[data-analytics-id="assignment.attempt.authoring.footer.submit"]', (b) => { b.scrollIntoView({ block: 'center' }); const x = b.getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 }; });
  await p.mouse.click(at.x, at.y);
  await until(() => fr.evaluate(() => !!document.querySelector('.gs-layer[data-open]')), 'Writer\'s submit sheet open');
  await p.keyboard.type('Thank you for reading.', { delay: 4 });
  await fr.click('.gs-sw');
  await shot(p, 'practice-sheet.png');
  n = mock.received.length;
  await fr.click('.gs-primary');
  await until(() => p.evaluate(() => !!document.querySelector('.practice-confirm')), 'Ultra\'s confirmation', 45000);
  const listed = await p.evaluate(() => [...document.querySelectorAll('.makeStylesfileName-0-2-402')].map((e) => e.textContent));
  check(listed.join() === 'Rivera_Essay2.docx', 'Ultra listed the one file Writer attached: Rivera_Essay2.docx');
  await shot(p, 'practice-confirm.png');
  await p.click('.practice-confirm .primary');
  await until(() => p.evaluate(() => !!window.__receipt), 'the receipt');
  const sub = await latest('submission', n);
  const file = path.join(sub.dir, 'Rivera_Essay2.docx');
  check(fs.existsSync(file), `the .docx is in the received folder (${file})`);
  const read = squash(await DT.docx(new Uint8Array(fs.readFileSync(file))));
  const paras = docText.split('\n').map(squash).filter((x) => x.length > 20), missing = paras.filter((x) => !read.includes(x));
  // doctext includes the Word running header before the body; this MLA fixture exports "Rivera 1".
  check(paras.length >= 15 && !missing.length && read === squash(`Rivera 1 ${docText}`), `lib/doctext.js reads the received .docx back as the complete paper, in order (${paras.length} paragraphs)`);
  const boxText = text(fs.readFileSync(path.join(sub.dir, 'text.html'), 'utf8'));
  check(boxText === squash(`Thank you for reading. ${docText}`), 'the text box got exactly the note, then the complete paper\'s text');
  const json = JSON.parse(fs.readFileSync(path.join(sub.dir, 'submission.json'), 'utf8'));
  check(json.files.length === 1 && json.files[0].type === M.MIME && json.files[0].name === 'Rivera_Essay2.docx' && json.files[0].sha256 === crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), 'submission.json records the exact Word file received');
  await shot(p, 'practice-received.png', true);
  check(await p.evaluate(() => window.__clicks.join() === 'assignment.attempt.authoring.footer.submit' && window.__confirmations === 1) && mock.received.slice(n).filter((r) => r.kind === 'submission').length === 1 && mock.state.log.filter((r) => r.kind === 'upload').length === 1, 'after the receipt: exactly one native Submit, one confirmation, one upload and one submission');
  await p.goto(`${M.SITE}${M.ROUTES.attempt}`);
  check(await p.evaluate(() => !!window.__receipt) && !await p.$('iframe.gz-writer'), 'the attempt stays submitted: Ultra shows the receipt, no box to write in');

  // ---- Reset starts the assignment over: the attempt is fresh, Writer's fence lifts, the paper is kept
  await p.goto(`${M.SITE}/practice`);
  await p.click('[data-reset="assignment"]');
  await until(() => p.evaluate(() => document.querySelector('[data-reset="assignment"]').textContent === 'Reset ✓'), 'reset done');
  await p.click(`a[href="${M.ROUTES.attempt}"]`);
  fr = await paper(p);
  check(await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.text()) === docText, 'after Reset the attempt is fresh and Writer brings the paper back');
  await fr.click('.gp-submit');
  await until(() => fr.evaluate(() => !!document.querySelector('.gs-layer[data-open]') && !document.querySelector('.gs-err')?.textContent), 'the sheet opens again, with no refusal');
  await p.keyboard.press('Escape');
  // The owner's course-tab shape: the top page stays on another course's outline; the attempt and Writer are two
  // frames deep. The real worker must admit both Writer features for the attempt document, then run Feedback there.
  const outline = '/ultra/courses/_51980_1/outline';
  await context.route(`${M.SITE}${outline}`, (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Course tab</title><iframe name="gz-ctab:_101_1" data-gz-through src="${M.ROUTES.attempt}?courseId=_101_1" style="border:0;width:100%;height:1100px"></iframe>` }));
  await p.goto(`${M.SITE}${outline}`);
  const course = await until(() => p.frames().find((f) => new URL(f.url()).pathname === M.ROUTES.attempt), 'course-tab attempt');
  const framed = await paper(course);
  check(await until(() => framed.evaluate(() => GZ_WRITER_AI.allowed('completion') && GZ_WRITER_AI.allowed('writing')), 'course-tab AI ready'), 'a course-tab assignment admits both completion and writing through the real worker');
  await keysIn(framed, 'a course tab');
  await framed.click('#gp-tab-feedback');
  await framed.click(`${fb} .gz-fb-run`);
  const framedCards = await until(() => framed.evaluate((fb) => document.querySelectorAll(`${fb} .gz-fb-item`).length, fb), 'course-tab Feedback');
  check(framedCards === 2 && new URL(p.url()).pathname === outline && await p.locator('iframe[data-gz-through]').count() === 1, 'Feedback runs inside the course tab while the top page stays on another course outline');
  check(errors.length === 0, `no page, frame or console errors (${errors.join('; ')})`);
  return { checks, saved, paper: docText };
};

// A later run on the same profile: Glaze is back, and so is the paper, ready to submit again.
const rerun = async ({ context, paper: text0, errors }) => {
  const p = context.pages()[0] || await context.newPage();
  await p.goto(`${M.SITE}${M.ROUTES.attempt}`);
  const fr = await paper(p);
  assert.equal(await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.text()), text0);
  await fr.click('.gp-submit');
  await until(() => fr.evaluate(() => !!document.querySelector('.gs-layer[data-open]') && !document.querySelector('.gs-err')?.textContent), 'the sheet opens on the next run');
  assert.deepEqual(errors, []);
  const label = 'the next run on the same profile: Glaze comes back, the paper is kept, and the sheet opens to submit again';
  console.log(`ok ${label}`);
  return [label];
};

// An unpacked extension's id, as Chrome derives it from its folder's path.
const idOf = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

// Chromium with the staged extension on the profile, the mock on the school's host, and Glaze ready for Ultra there.
const launch = async ({ profile, ext, mock, clear, smoke, errors, own, signal, proxy }) => {
  if (smoke) await require('./wait-for-browser.js')(signal);
  if (interrupted) throw Error('Practice interrupted');
  const context = await require('playwright').chromium.launchPersistentContext(profile, {
    ...require('./check-env.js').chromeLaunch(), headless: smoke, viewport: smoke ? { width: 1440, height: 900 } : null,
    args: browserArgs(ext, smoke, proxy),
  });
  own(context);
  if (interrupted) { await context.close(); throw Error('Practice interrupted'); }
  observe(context, errors);
  env.noFirstRun(context); context.setDefaultTimeout(15000);
  const id = idOf(ext);
  // Pages end at the mock. The extension's worker goes on to the proxy for anything but the school's host: the proxy lets
  // only its AI connection by.
  const out = (req) => !!req.serviceWorker()?.url().startsWith(`chrome-extension://${id}/`) && new URL(req.url()).origin !== M.SITE;
  await context.route('**/*', (route) => (out(route.request()) ? route.continue() : mock.handle(route)));
  await context.routeWebSocket('**/*', (ws) => ws.close());
  // The mock starts every run with nothing submitted, so Writer's fences from an earlier run go too (the papers stay).
  await inExtension(context, id, async ({ site, clear }) => {
    if (clear) { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); }
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('writerSubmit:')));
    const ultra = Array.isArray(all.ultra) ? all.ultra : [];
    if (!ultra.includes(site)) await chrome.storage.local.set({ ultra: [...ultra, site] });
  }, { site: M.SITE, clear });
  await until(() => inExtension(context, id, async () => !!(await chrome.storage.local.get('ultra')).ultra), 'Glaze running');
  await env.ultraReady({ evaluate: (fn) => inExtension(context, id, fn) });
  return { context, id };
};

const main = async (args = process.argv.slice(2)) => {
  interrupted = false;
  const { smoke, fresh, help, root, ai } = options(args);
  if (help) { console.log(usage); return; }
  if (!fs.existsSync(path.join(root, 'manifest.json'))) throw Error(`No extension manifest in ${root}`);
  const practice = path.resolve(process.env.GLAZE_PRACTICE || path.join(os.homedir(), 'Projects/glaze-plans/writer/practice'));
  // A smoke run may keep its evidence in this hidden folder: staging skips hidden entries, so it cannot copy itself.
  const internalSmoke = smoke && path.relative(root, practice).split(path.sep)[0] === '.glaze-practice';
  if (practice === root || practice.startsWith(`${root}${path.sep}`) && !internalSmoke) throw Error('GLAZE_PRACTICE must be outside the extension checkout (smoke also permits .glaze-practice)');
  const lock = env.lockPath(), sessionLock = path.join(practice, 'running');
  let context, tmp, net, held = false, sessionHeld = false;
  const contexts = new Set(), errors = [], controller = new AbortController();
  const own = (c) => { contexts.add(c); c.once('close', () => contexts.delete(c)); };
  const stop = (signal) => { interrupted = true; controller.abort(); process.exitCode = signal === 'SIGINT' ? 130 : 143; for (const c of contexts) c.close().catch(() => {}); };
  const onInt = () => stop('SIGINT'), onTerm = () => stop('SIGTERM');
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  try {
    if (smoke) {
      for (let i = 0; ; i++) {
        try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-practice --smoke\n`); break; }
        catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-practice] waiting for heavy lock'); await pause(5000); }
      }
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-practice-'));
    } else {
      fs.mkdirSync(practice, { recursive: true });
      try { fs.mkdirSync(sessionLock); sessionHeld = true; fs.writeFileSync(path.join(sessionLock, 'owner'), `${process.pid}\n`); }
      catch (e) { if (e.code === 'EEXIST') throw Error(`Practice already in use (${sessionLock}); close its window before --fresh or another run`); throw e; }
    }
    const base = smoke ? tmp : practice, profile = path.join(base, 'profile');
    if (fresh && !smoke) fs.rmSync(profile, { recursive: true, force: true });
    // The stand-in model is on this computer: Glaze holds that host as a student grants it (the smoke checks Feedback with it).
    const model = smoke || ai === 'mock';
    const ext = stage(root, path.join(base, 'extension'), model ? ['http://127.0.0.1/*'] : []);
    const out = smoke ? path.join(practice, 'smoke', 'received') : path.join(practice, 'received');
    if (smoke) fs.rmSync(path.dirname(out), { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const quill = await M.quill(practice, controller.signal);
    let id;
    const mock = M.create({
      quill, out,
      onReceived: (r) => console.log(`[practice] Blackboard received a ${r.kind}: ${r.dir}`),
      // Writer keeps a submitted attempt's fence; starting the assignment over lifts it (the paper stays).
      onReset: (scenario) => (scenario === 'discussion' ? null : inExtension(context, id, async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('writerSubmit:'))); })),
    });
    net = await NET.proxy({ allowed: reachable(() => context, () => id), model });
    ({ context, id } = await launch({ profile, ext, mock, clear: smoke, smoke, errors, own, signal: controller.signal, proxy: net.port }));
    if (!smoke) await setUpAI(context, id, model ? net.port : 0);

    if (smoke) {
      const shots = path.join(practice, 'shots');
      const fail = async (e) => {
        for (const [i, pg] of (context?.pages() || []).entries()) await pg.screenshot({ path: path.join(shots, `practice-failure-${i}.png`) }).catch(() => {});
        throw e;
      };
      const r = await run({ context, mock, shots, errors, ai: () => setUpAI(context, id, net.port) }).catch(fail);
      // The next run on the same profile: Glaze comes back up, the paper is kept, and nothing is left submitted.
      await context.close();
      mock.reset();
      ({ context } = await launch({ profile, ext, mock, clear: false, smoke, errors, own, signal: controller.signal, proxy: net.port }));
      const again = await rerun({ context, paper: r.paper, errors }).catch(fail);
      console.log(JSON.stringify({ checks: r.checks.length + again.length, shots: r.saved, received: out }, null, 2));
      return;
    }
    const p = context.pages()[0] || await context.newPage();
    await p.goto(`${M.SITE}/practice`);
    console.log(`[practice] ${root} on ${M.SITE}/practice. What Blackboard receives goes to ${out}. Close the window to stop.`);
    await new Promise((r) => context.on('close', r));
  } finally {
    await Promise.allSettled([...contexts].map((c) => c.close()));
    await net?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    if (sessionHeld) fs.rmSync(sessionLock, { recursive: true, force: true });
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
  }
};

module.exports = { options, browserArgs, observe, main };
if (require.main === module) main().catch((e) => { console.error(e); process.exitCode ||= 1; });
