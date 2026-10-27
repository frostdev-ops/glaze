// Practise with Glaze Writer on a synthetic Blackboard Ultra (scripts/ultra-mock.js): a Chromium window with this checkout's
// extension, or --ext's, on a discussion to post and reply in and an assignment to submit, so each goes through Writer as
// it would on a real course; what the mock Blackboard receives is shown on the page and kept in <practice>/received.
//   NODE_PATH=<playwright> node scripts/writer-practice.js [--ext <checkout>] [--fresh]
// The profile (Settings, Looks, AI, papers) stays in <practice>/profile between runs; --fresh starts it over.
// <practice> is GLAZE_PRACTICE, else ~/Projects/glaze-plans/writer/practice.
// --smoke: headless and scripted, with a profile of its own: a reply, a post, and a submission through Writer's sheet,
// checked. Run it under the heavy-check lock (CLAUDE.md); screenshots go to <practice>/shots.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), M = require('./ultra-mock.js');
const DT = require('../lib/doctext.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const smoke = args.includes('--smoke'), fresh = args.includes('--fresh');
const root = path.resolve(opt('--ext') || path.join(__dirname, '..'));
const practice = path.resolve(process.env.GLAZE_PRACTICE || path.join(os.homedir(), 'Projects/glaze-plans/writer/practice'));
const lock = require('./check-env.js').lockPath();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const text = (html) => squash(String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'));

// The extension with the school's host in its manifest, as scripts/check-env.js stages it (the student's grant, on a real
// site), but at a fixed path: Chrome derives an unpacked extension's id from it, and the profile keeps Glaze's data by id.
const stage = (src, to) => {
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
  m.host_permissions = [...new Set([...(m.host_permissions || []), `${M.SITE}/*`])];
  fs.writeFileSync(path.join(to, 'manifest.json'), JSON.stringify(m, null, 2));
  return fs.realpathSync(to);
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
  if (!p.url().endsWith(M.ROUTES.attempt)) { await p.goto(`${M.SITE}/practice`); await p.click(`a[href="${M.ROUTES.attempt}"]`); }
  const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity && f.offsetHeight > 500) && x; }, 'paper frame shown');
  const fr = await until(() => el.contentFrame(), 'paper frame document');
  await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key() && document.querySelectorAll('.gp-sheet').length > 0), 'paper loaded and paged');
  return fr;
};

// ---- the scripted run: what the owner does by hand, checked
const run = async ({ context, mock, shots }) => {
  const FX = require('../test/fixtures/writer-paper-fixtures.js');
  const checks = [], errors = [], saved = {};
  const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  };
  const shot = async (p, name, full = false) => { fs.mkdirSync(shots, { recursive: true }); await pause(250); const f = path.join(shots, name); await p.screenshot({ path: f, fullPage: full }); saved[name] = f; };
  const frame = async (p, kind) => {
    const el = await until(async () => { const h = await p.$(`iframe.gz-writer[data-gz-writer-frame="${kind}"]`); return h && await h.evaluate((f) => !f.style.opacity && f.offsetHeight > 60) && h; }, `${kind} frame shown`);
    await el.evaluate((f) => f.scrollIntoView({ block: 'center' }));
    const fr = await until(() => el.contentFrame(), `${kind} frame document`);
    await until(() => fr.evaluate(() => !!document.querySelector('.ProseMirror')), `${kind} editor`);
    return { el, fr };
  };
  const latest = (kind, after) => until(() => mock.received.slice(after).find((r) => r.kind === kind), `Blackboard received the ${kind}`, 20000);
  const REPLY = 'Keeping score fits the clearing as well, since Baby Suggs asks the town to remember what it lost.';
  const POST = 'The river carries what the town will not say aloud, and the clearing is where that memory can finally be spoken.';

  const p = context.pages()[0] || await context.newPage();
  watch(p);
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

  // ---- a new post: the student clicks it and types; Writer takes over after Ultra's first character
  await p.click('bb-rich-text-editor[editor-aria-label="Post text editor"] .ql-editor');
  check(await p.evaluate(() => !document.querySelector('.panel-editor-controls').classList.contains('ng-hide') && !!document.querySelector('form[name="editorForm"] .bb-editor-toolbar')), 'a click activates Ultra\'s composer: toolbar and controls');
  await p.keyboard.type(POST[0]);
  const po = await frame(p, 'post');
  // The frame's document.hasFocus() stays false in headless Chromium; the page's focus is on the frame and the frame's on its editor.
  await until(async () => await p.evaluate(() => document.activeElement?.matches('iframe.gz-writer[data-gz-writer-frame="post"]')) && po.fr.evaluate(() => !!document.activeElement?.closest('.ProseMirror')), 'Writer holds the caret');
  await p.keyboard.type(POST.slice(1), { delay: 4 });
  await until(() => p.evaluate(() => !document.querySelector('form[name="editorForm"] .js-text-editor-save').disabled), 'Ultra enables Post');
  await shot(p, 'practice-post.png');
  n = mock.received.length;
  await p.click('form[name="editorForm"] .js-text-editor-save');
  const posted = await latest('post', n);
  const postHTML = fs.readFileSync(path.join(posted.dir, 'message.html'), 'utf8');
  check(text(postHTML) === POST, `Blackboard received the post, in order, from its first letter (${posted.dir})`);
  await until(() => p.evaluate((t) => [...document.querySelectorAll('.comment-level-0 > .comment-entry .ql-editor')].some((e) => e.textContent.includes(t)), POST.slice(0, 30)), 'post drawn in the thread');
  await until(() => p.evaluate(() => document.querySelector('.panel-editor-controls').classList.contains('ng-hide') || document.querySelector('form[name="editorForm"] .js-text-editor-save').disabled), 'Ultra clears its composer');
  const left = await p.evaluate(() => { const f = document.querySelector('iframe.gz-writer[data-gz-writer-frame="post"]'); return f ? 'frame' : 'native'; });
  const leftText = left === 'frame' ? await po.fr.evaluate(() => document.querySelector('.ProseMirror')?.textContent || '').catch(() => '') : '';
  check(!squash(leftText), `after Post, nothing is left behind in the composer (${left})`);
  check(await p.evaluate(() => window.__sends) === 2, 'Ultra\'s Post and Reply each sent once');
  await p.click('.practice-log summary');
  await shot(p, 'practice-discussion.png', true);

  // ---- the assignment: a paper, Writer's sheet, Ultra's Submit once, Ultra's confirmation, what Blackboard received
  let fr = await paper(p);
  await fr.evaluate(async (doc) => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON(doc).content)); }, FX.papers.mla9());
  await until(() => fr.evaluate(() => document.querySelector('.gp-state')?.textContent === 'Saved'), 'paper saved', 20000);
  await shot(p, 'practice-paper.png');
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
  check(await p.evaluate(() => window.__clicks.join()) === 'assignment.attempt.authoring.footer.submit', 'Writer clicked Ultra\'s Submit exactly once');
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
  check(paras.length >= 15 && !missing.length, `lib/doctext.js reads the received .docx back as the paper: all ${paras.length} paragraphs`);
  const boxText = text(fs.readFileSync(path.join(sub.dir, 'text.html'), 'utf8'));
  check(boxText.startsWith('Thank you for reading.') && boxText.includes(paras.at(-1)), 'the text box got the note, then the paper\'s text');
  const json = JSON.parse(fs.readFileSync(path.join(sub.dir, 'submission.json'), 'utf8'));
  check(json.files.length === 1 && json.files[0].type === M.MIME && json.files[0].name === 'Rivera_Essay2.docx', 'submission.json records one Word file');
  await shot(p, 'practice-received.png', true);
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
  check(errors.length === 0, `no page or frame errors (${errors.join('; ')})`);
  return { checks, saved, paper: docText };
};

// A later run on the same profile: Glaze is back, and so is the paper, ready to submit again.
const rerun = async ({ context, paper: text0 }) => {
  const errors = [];
  const p = context.pages()[0] || await context.newPage();
  p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
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
const launch = async ({ profile, ext, mock, clear }) => {
  if (smoke) await require('./wait-for-browser.js')();
  const context = await chromium.launchPersistentContext(profile, {
    ...require('./check-env.js').chromeLaunch(), headless: smoke, viewport: smoke ? { width: 1440, height: 900 } : null,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, smoke ? '--host-resolver-rules=MAP * ~NOTFOUND' : `--host-resolver-rules=MAP ${new URL(M.SITE).host} ~NOTFOUND`, ...(smoke ? ['--disable-background-networking'] : ['--window-size=1440,1000'])],
  });
  env.noFirstRun(context); context.setDefaultTimeout(15000);
  await context.route(`${M.SITE}/**`, mock.handle);
  const id = idOf(ext);
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

(async () => {
  let context, tmp, held = false;
  try {
    if (smoke) {
      for (let i = 0; ; i++) {
        try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-practice --smoke\n`); break; }
        catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-practice] waiting for heavy lock'); await pause(5000); }
      }
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-practice-'));
    }
    const base = smoke ? tmp : practice, profile = path.join(base, 'profile');
    if (fresh && !smoke) fs.rmSync(profile, { recursive: true, force: true });
    const ext = stage(root, path.join(base, 'extension'));
    const out = smoke ? path.join(practice, 'smoke', 'received') : path.join(practice, 'received');
    if (smoke) fs.rmSync(path.dirname(out), { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const quill = await M.quill(practice);
    let id;
    const mock = M.create({
      quill, out,
      onReceived: (r) => console.log(`[practice] Blackboard received a ${r.kind}: ${r.dir}`),
      // Writer keeps a submitted attempt's fence; starting the assignment over lifts it (the paper stays).
      onReset: (scenario) => (scenario === 'discussion' ? null : inExtension(context, id, async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('writerSubmit:'))); })),
    });
    ({ context, id } = await launch({ profile, ext, mock, clear: smoke }));

    if (smoke) {
      const shots = path.join(practice, 'shots');
      const fail = async (e) => {
        for (const [i, pg] of (context?.pages() || []).entries()) await pg.screenshot({ path: path.join(shots, `practice-failure-${i}.png`) }).catch(() => {});
        throw e;
      };
      const r = await run({ context, mock, shots }).catch(fail);
      // The next run on the same profile: Glaze comes back up, the paper is kept, and nothing is left submitted.
      await context.close();
      mock.reset();
      ({ context } = await launch({ profile, ext, mock, clear: false }));
      const again = await rerun({ context, paper: r.paper }).catch(fail);
      console.log(JSON.stringify({ checks: r.checks.length + again.length, shots: r.saved, received: out }, null, 2));
      return;
    }
    const p = context.pages()[0] || await context.newPage();
    await p.goto(`${M.SITE}/practice`);
    console.log(`[practice] ${root} on ${M.SITE}/practice. What Blackboard receives goes to ${out}. Close the window to stop.`);
    process.once('SIGINT', () => context.close());
    await new Promise((r) => context.on('close', r));
  } finally {
    await context?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
