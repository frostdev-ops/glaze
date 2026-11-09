// Glaze Writer on Canvas in the real unpacked extension, on the captured Canvas pages (test/fixtures/canvas-writer-*.html,
// local Canvas 1c9f0bb8) served at a Canvas host, each RCE redrawn by real TinyMCE 5.10.9 (pinned as
// checks/writer/writer-main-canvas-check.js pins it) with a small stand-in for what Canvas does around it: RCEWrapper's
// onInit (data-rich_text), wrapInitCb's change, tinymce-react's state, Canvas's Insert tools as commands, and the Text
// Entry form's submit, which reads the editor as getFormData's get_code does, refuses an empty one (#body_errors, the RCE
// focused) and is recorded instead of sent. Asserts, on the classic assignment: Writer takes the box (Canvas's wrapper
// hidden, its errors line kept), ⋯ says Canvas editor and offers Insert from Canvas; typing and pressing Submit at once
// submits exactly Writer's text (the flush hold); Canvas's empty-text check focuses Writer, not its hidden editor; a press
// Canvas's editor won't take is held with the reason shown; Canvas editor gives the box back with the text and the focus;
// Insert runs Canvas's tool at the end of the box; a box Writer can't keep stays Canvas's. Every non-GET is aborted.
// glaze-remote -o <evidence directory> -- node checks/writer/writer-canvas-check.js /out (CLAUDE.md)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('../../tools/dev/check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '../../extension'));
const site = 'https://glaze-check.instructure.com';
const CDN = 'https://cdn.jsdelivr.net/npm/tinymce@5.10.9/';
const FILES = {
  'tinymce.min.js': '3c3041cb95a1c979ee2205901cf1c670a36c192ef089e6f63b94beabef386c30',
  'themes/silver/theme.min.js': '05f5cf013cd5b6c793f9d5f745350088d3c5686ba001197b7ce2e1cb8c961f99',
  'icons/default/icons.min.js': '6c5a69c090aa1418082e7ad5e707bbe6c531269607e080821a7089a16e0f2b61',
  'plugins/lists/plugin.min.js': '2e7d9385c8fd8248220ff2c5f34b30ad92a6bf34e65f05b611f24c9fd820a2a2',
};
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../../test/fixtures', f), 'utf8');
const out = process.argv[2], lock = env.lockPath();
const checks = [], requests = [], errors = []; let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 10000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

// The captured page, its RCE as Canvas mounts one before TinyMCE draws it (a textarea in the wrapper), its captured scripts
// and frames gone; the brandable_css links stay (they are how Glaze knows Canvas).
const ASSIGNMENT = (() => {
  const raw = fixture('canvas-writer-assignment.html'), from = raw.indexOf('<div id="tinymce-parent-of-submission_body"'), to = raw.indexOf('<div id="body_errors">');
  assert.ok(from > 0 && to > from, 'the assignment fixture has its RCE and errors line');
  const wrap = '<div id="tinymce-parent-of-submission_body" class="ic-RichContentEditor"><div class="canvas-rce__skins--root rce-wrapper" style="margin-bottom: 0.5rem;"><div style="display: block;"><textarea id="submission_body" style="height: 400px; resize: none;" name="submission[body]"></textarea></div><span id="submission_body_statusbar" data-testid="RCEStatusBar">0 words</span></div></div>\n          ';
  return (raw.slice(0, from) + wrap + raw.slice(to)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace('</body>', '<script src="/tinymce/tinymce.min.js"></script><script src="/gz-check/canvas.js"></script></body>');
})();
// What Canvas does around an RCE, in the page (packages/canvas-rce RCEWrapper onInit, wrapInitCb, tinymce-react; the Text
// Entry form's submit, ui/features/submit_assignment/jquery/index.jsx). ?html= puts that in the box first.
const CANVAS = `(() => {
  window.__log = []; window.__submits = []; window.__commands = [];
  const ta = document.getElementById('submission_body');
  ta.value = new URLSearchParams(location.search).get('html') || '';
  tinymce.init({ selector: '#submission_body', base_url: '/tinymce', suffix: '.min', skin: false, content_css: false, menubar: false, statusbar: false, plugins: 'lists', height: 400,
    setup: (ed) => {
      for (const c of ['mceInstructureImage', 'instructureRecord', 'mceInstructureDocuments', 'instructureEquation', 'instructureTrayForCourseLinks'])
        ed.addCommand(c, () => __commands.push({ c, collapsed: ed.selection.getRng().collapsed, atEnd: ed.selection.getRng().endOffset === ed.selection.getNode().childNodes.length || ed.selection.getRng().endContainer.nodeType === 3 && ed.selection.getRng().endOffset === ed.selection.getRng().endContainer.length, text: ed.getBody().textContent }));
    },
    init_instance_callback: (ed) => {
      const ta = ed.getElement();
      ta.dataset.rich_text = true;
      ed.on('change', () => ta.dispatchEvent(new Event('change', { bubbles: true })));
      ed.on('change keyup setcontent', () => __log.push('react ' + ed.getContent()));
    } });
  const form = document.getElementById('submit_online_text_entry_form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = tinymce.get('submission_body').getContent(), doc = new DOMParser().parseFromString(body, 'text/html');
    const empty = doc.querySelectorAll('*:not(p):not(html):not(head):not(body)').length === 0 && ![...doc.querySelectorAll('p')].some((p) => p.children.length > 0 || p.textContent.trim());
    if (empty) {
      document.getElementById('body_errors').textContent = 'Text entry must not be empty';
      document.getElementById('submission_body_ifr').contentWindow.document.body.focus();
      __submits.push({ empty: true });
      return;
    }
    __submits.push({ body, text: doc.body.textContent });
  });
})();`;

(async () => {
  let context, held = false, tmp, ext;
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-canvas-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-canvas-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-writer-canvas-'));
    const bytes = {};
    for (const [f, sha] of Object.entries(FILES)) {
      const b = Buffer.from(await (await fetch(CDN + f)).arrayBuffer());
      const got = crypto.createHash('sha256').update(b).digest('hex');
      if (got !== sha) throw Error(`TinyMCE 5.10.9 ${f} hash mismatch: ${got}`);
      bytes[f] = b;
    }
    check(true, 'real TinyMCE 5.10.9 fetched and pinned');

    ext = env.staged(root, [`${site}/*`]);
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...env.chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(10000);
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      requests.push({ method: req.method(), origin: u.origin, path: u.pathname });
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      const f = u.pathname.slice('/tinymce/'.length);
      if (u.pathname.startsWith('/tinymce/') && bytes[f]) return r.fulfill({ contentType: 'text/javascript', body: bytes[f] });
      if (u.pathname === '/gz-check/canvas.js') return r.fulfill({ contentType: 'text/javascript', body: CANVAS });
      if (req.isNavigationRequest() && u.pathname === '/courses/34/assignments/238') return r.fulfill({ contentType: 'text/html', body: ASSIGNMENT });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      if (u.pathname === '/api/v1/users/self/profile' || u.pathname === '/api/v1/users/self') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 3, name: 'Sam Taylor' }) });
      if (u.pathname.startsWith('/api/v1/')) return r.fulfill({ contentType: 'application/json', body: '[]' });
      return r.fulfill({ status: 404, body: '' });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const G = require(path.join(root, 'content/defaults.js'));
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
    await worker.evaluate(async (settings) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); }, settings);

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
    const tiny = (p) => p.evaluate(() => ({ html: tinymce.get('submission_body').getContent(), text: tinymce.get('submission_body').getBody().textContent }));
    const writerText = (fr) => fr.evaluate(() => GZ_WRITER_FRAME.editor().text());
    const menu = async (fr, pick) => {
      await fr.click('#more');
      await until(() => fr.evaluate(() => !document.getElementById('menu').hidden), 'the ⋯ menu open');
      return pick ? fr.click(pick) : fr.evaluate(() => [...document.querySelectorAll('#menu [role="menuitem"], #menu [data-insert-head]')].map((b) => b.textContent));
    };
    const A = '/courses/34/assignments/238';

    // ---- Writer takes the Text Entry box ----
    let p = await open(A);
    let a = await box(p, 'assignment');
    check(await p.evaluate(() => getComputedStyle(document.querySelector('.rce-wrapper')).display === 'none' && document.querySelector('iframe.gz-writer').nextElementSibling === document.querySelector('.rce-wrapper')), 'Writer stands in for the whole RCE, in its place; Canvas\'s wrapper is hidden');
    check(await p.evaluate(() => { const e = document.getElementById('body_errors'); return e.isConnected && getComputedStyle(e).display !== 'none' && !document.querySelector('.rce-wrapper').contains(e); }), '#body_errors stays outside the hidden wrapper, shown');
    check(await a.fr.evaluate(() => document.documentElement.dataset.site === 'canvas' && document.documentElement.dataset.dialect === 'canvas'), 'the frame writes Canvas\'s dialect');
    check(JSON.stringify(await menu(a.fr)) === JSON.stringify(['Canvas editor', 'Insert from Canvas', 'Image', 'Media', 'Document', 'Equation', 'Course link']), '⋯: Canvas editor, then Insert from Canvas\'s five tools');
    await p.keyboard.press('Escape');

    // ---- Canvas's empty-text check: the focus comes back to Writer ----
    await p.click('#submit_online_text_entry_form button[type="submit"]');
    await until(() => p.evaluate(() => __submits.length === 1), 'the empty submit checked');
    check(await p.evaluate(() => __submits[0].empty && document.getElementById('body_errors').textContent === 'Text entry must not be empty'), 'an empty box: Canvas\'s own check refuses it, its error shown below Writer');
    await until(() => p.evaluate(() => document.activeElement?.matches('iframe.gz-writer')), 'focus back in Writer');
    check(true, 'Canvas focusing its hidden editor puts the focus in Writer');
    await p.evaluate(() => { __submits.length = 0; });

    // ---- typing, then Submit at once: exactly Writer's text goes ----
    await a.fr.click('.ProseMirror');
    await p.keyboard.type('Reading response: the river is the archive.', { delay: 1 });
    await p.keyboard.press('Enter');
    await p.keyboard.type('- first point **kept** and the last words', { delay: 0 });
    await p.click('#submit_online_text_entry_form button[type="submit"]');
    await until(() => p.evaluate(() => __submits.length >= 1), 'the submit recorded');
    await pause(300); // a second submit, if the hold let two through, would be recorded by now
    const subs = await p.evaluate(() => __submits.slice());
    const typed = await writerText(a.fr);
    check(subs.length === 1, `one press, one submit (${subs.length})`);
    check(squash(subs[0].text) === squash(typed) && /the last words$/.test(squash(subs[0].text)), `Submit sends Writer's text, its last words included (${squash(subs[0].text)})`);
    check(/<ul>\s*<li>first point <strong>kept<\/strong> and the last words<\/li>\s*<\/ul>/.test(subs[0].body), `in Canvas's dialect (${subs[0].body.replace(/\n/g, '')})`);
    await p.evaluate(() => { __submits.length = 0; });

    // ---- a press Canvas's editor won't take is held, and says so ----
    await p.evaluate(() => { window.__get = tinymce.get; tinymce.get = () => null; });
    await a.fr.click('.ProseMirror');
    await p.keyboard.type(' More.', { delay: 0 });
    await p.click('#submit_online_text_entry_form button[type="submit"]');
    const note = await until(() => a.fr.evaluate(() => { const n = document.getElementById('note'); return !n.hidden && n.textContent; }), 'the held note');
    check(note === 'Not sent: Canvas didn’t take your text. Try again.' && await p.evaluate(() => __submits.length === 0), `a write Canvas's editor refused holds the press, nothing submitted, and the bar says why ("${note}")`);
    await p.evaluate(() => { tinymce.get = window.__get; });
    await p.keyboard.type('!', { delay: 0 });
    await until(() => a.fr.evaluate(() => document.getElementById('note').hidden), 'the note gone');
    await until(async () => squash((await tiny(p)).text) === squash(await writerText(a.fr)), 'Canvas\'s editor in step again');
    check(true, 'the next edit clears the note and syncs again');

    // ---- ⋯ → Canvas editor: the box back, with the text and the focus ----
    const before = await writerText(a.fr);
    await menu(a.fr, '#menu [data-do="native"]');
    await until(() => p.evaluate(() => !document.querySelector('iframe.gz-writer') && getComputedStyle(document.querySelector('.rce-wrapper')).display !== 'none'), 'the RCE back');
    check(squash((await tiny(p)).text) === squash(before), 'Canvas editor gives the box back holding Writer\'s text');
    check(await until(() => p.evaluate(() => document.activeElement?.id === 'submission_body_ifr'), 'focus in the RCE'), 'and puts the caret in Canvas\'s editor');
    await p.close();

    // ---- ⋯ → Insert from Canvas → Image: Canvas's tool, at the end of the box ----
    p = await open(A);
    a = await box(p, 'assignment');
    await a.fr.click('.ProseMirror');
    await p.keyboard.type('An image goes after this', { delay: 0 });
    await menu(a.fr, '#menu [data-insert="image"]');
    await until(() => p.evaluate(() => __commands.length === 1), 'Canvas\'s image tool run');
    const ran = await p.evaluate(() => __commands[0]);
    check(ran.c === 'mceInstructureImage' && ran.collapsed && ran.atEnd && ran.text === 'An image goes after this', `Insert → Image runs Canvas's own image tool, the caret at the end of Writer's text (${JSON.stringify(ran)})`);
    check(await p.evaluate(() => !document.querySelector('iframe.gz-writer') && getComputedStyle(document.querySelector('.rce-wrapper')).display !== 'none'), 'the box is Canvas\'s again for the picture');
    await p.close();

    // ---- what Writer can't keep stays Canvas's ----
    const refused = '<ul><li><p>a</p><p>b</p></li></ul>';
    p = await open(`${A}?html=${encodeURIComponent(refused)}`);
    await until(() => p.evaluate(() => document.documentElement.hasAttribute('data-gz-writer-main-canvas') && !document.querySelector('iframe.gz-writer')), 'the frame refused the box');
    check(await p.evaluate(() => getComputedStyle(document.querySelector('.rce-wrapper')).display !== 'none' && !document.querySelector('[data-gz-writer]')), 'a box holding blocks inside a list item stays Canvas\'s, shown, unmarked');
    check(squash((await tiny(p)).text) === 'ab' && (await p.evaluate(() => __log.length)) === 0, 'and nothing was written into it');
    await p.close();

    const sent = requests.filter((r) => r.method !== 'GET');
    check(sent.length === 0, `nothing but GETs left the page (${sent.map((r) => `${r.method} ${r.path}`).join(', ')})`);
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    passed = true;
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, errors }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), e.stack + '\n'); } process.exitCode = 1; });
