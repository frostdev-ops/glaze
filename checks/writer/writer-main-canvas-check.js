// Glaze Writer's hand in a Canvas page's world (writer/writer-main-canvas.js) against real TinyMCE 5.10.9, pinned as
// checks/writer/writer-canvas-tinymce-check.js pins it, on a synthetic page shaped like Canvas's (test/fixtures/
// canvas-writer-assignment.html): a textarea Canvas has marked data-rich_text, a stand-in for Canvas's wrapInitCb (the
// editor's change → the textarea's change, which a quiz backs its answers up on) and for tinymce-react (its state follows
// 'change keyup setcontent'), Canvas's Insert tools as registered commands, and the Inbox's textarea with React's value
// tracker. Asserts: set reaches the editor, both listeners and undo, never focus; get reads it; exec runs only the Insert
// tools, at the end of the box; Canvas's own changes are announced and Writer's are not; a refused write changes nothing;
// the Inbox's value goes through the tracker React reads. Nothing is reached but the pinned files.
// glaze-remote -o <evidence directory> -- node checks/writer/writer-main-canvas-check.js /out (CLAUDE.md)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');

const CDN = 'https://cdn.jsdelivr.net/npm/tinymce@5.10.9/';
const FILES = {
  'tinymce.min.js': '3c3041cb95a1c979ee2205901cf1c670a36c192ef089e6f63b94beabef386c30',
  'themes/silver/theme.min.js': '05f5cf013cd5b6c793f9d5f745350088d3c5686ba001197b7ce2e1cb8c961f99',
  'icons/default/icons.min.js': '6c5a69c090aa1418082e7ad5e707bbe6c531269607e080821a7089a16e0f2b61',
  'plugins/lists/plugin.min.js': '2e7d9385c8fd8248220ff2c5f34b30ad92a6bf34e65f05b611f24c9fd820a2a2',
};
const site = 'https://glaze-check.instructure.com';
const MAIN = fs.readFileSync(path.join(__dirname, '../../extension/writer/writer-main-canvas.js'), 'utf8');
const out = process.argv[2], lock = require('../../tools/dev/check-env.js').lockPath();
const checks = [], errors = []; let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

const PAGE = `<!doctype html><html><head><script src="/tinymce/tinymce.min.js"></script></head><body>
<form id="submit_online_text_entry_form"><div class="canvas-rce__skins--root rce-wrapper"><div style="display: block"><textarea id="submission_body" name="submission[body]"></textarea></div></div>
<button type="submit">Submit Assignment</button></form>
<div id="compose-message-modal"><textarea data-testid="message-body" id="TextArea___0"></textarea></div>
<button id="elsewhere">elsewhere</button></body></html>`;

// What Canvas and React do around the boxes (packages/canvas-rce RCEWrapper onInit and wrapInitCb, tinymce-react, React's
// inputValueTracking), in the page.
const SETUP = () => new Promise((resolve, reject) => {
  window.__log = [];
  const log = (...a) => __log.push(a.join(' '));
  tinymce.init({ selector: '#submission_body', base_url: '/tinymce', suffix: '.min', skin: false, content_css: false, menubar: false, statusbar: false, plugins: 'lists',
    setup: (ed) => {
      for (const c of ['instructureEquation', 'instructureTrayForImages', 'instructureLinkCreate']) ed.addCommand(c, () => log('command', c, ed.selection.getRng().collapsed, ed.selection.getNode().textContent));
      ed.addCommand('mceInsertContent', () => log('forbidden'));
    },
    init_instance_callback: (ed) => {
      const ta = ed.getElement();
      ta.dataset.rich_text = true; // RCEWrapper.onInit
      ed.on('change', () => ta.dispatchEvent(new Event('change', { bubbles: true }))); // wrapInitCb
      ta.addEventListener('change', () => log('textarea change', ed.getContent()));
      ed.on('change keyup setcontent', (e) => log('react', e.type, ed.getContent())); // tinymce-react onEditorChange
      resolve();
    } }).catch(reject);
  // React's value tracker: an own "value" property on the node remembering the last value React set or saw, so an input
  // event counts only if the DOM value differs from it.
  const inbox = document.getElementById('TextArea___0');
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  let tracked = '';
  Object.defineProperty(inbox, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { tracked = String(v); desc.set.call(this, v); } });
  inbox.addEventListener('input', () => { const now = desc.get.call(inbox); if (now !== tracked) { tracked = now; log('react onChange', JSON.stringify(now)); } else log('react ignored input'); });
});

(async () => {
  let browser, held = false;
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-main-canvas-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-main-canvas-check] waiting for heavy lock'); await pause(5000); }
    }
    const bytes = {};
    for (const [f, sha] of Object.entries(FILES)) {
      const b = Buffer.from(await (await fetch(CDN + f)).arrayBuffer());
      const got = crypto.createHash('sha256').update(b).digest('hex');
      if (got !== sha) throw Error(`TinyMCE 5.10.9 ${f} hash mismatch: ${got}`);
      bytes[f] = b;
    }
    check(true, 'real TinyMCE 5.10.9 fetched and pinned');
    await require('../../tools/dev/wait-for-browser.js')();
    browser = await chromium.launch({ ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.origin !== site || r.request().method() !== 'GET') return r.abort();
      const f = u.pathname.slice('/tinymce/'.length);
      if (u.pathname.startsWith('/tinymce/') && bytes[f]) return r.fulfill({ contentType: 'text/javascript', body: bytes[f] });
      return u.pathname === '/' ? r.fulfill({ contentType: 'text/html', body: PAGE }) : r.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${site}/`);
    await page.evaluate(SETUP);
    // Writer marks its boxes; the helper goes in as executeScript world MAIN puts it.
    await page.evaluate(() => { document.getElementById('submission_body').setAttribute('data-gz-writer-id', 'gzw-a'); document.getElementById('TextArea___0').setAttribute('data-gz-writer-id', 'gzw-i'); });
    check(await page.evaluate(MAIN) === true, 'writer-main-canvas.js runs in the page and ends on true, as executeScript reports');
    const ask = (op, m) => page.evaluate(({ op, m }) => {
      const got = [];
      const hear = (e) => got.push(JSON.parse(e.detail));
      document.addEventListener('gz-writer:done', hear);
      document.dispatchEvent(new CustomEvent(`gz-writer:${op}`, { detail: JSON.stringify(m) }));
      document.removeEventListener('gz-writer:done', hear);
      return got;
    }, { op, m });
    const log = async () => page.evaluate(() => __log.splice(0));
    await page.evaluate(() => { window.__changed = []; document.addEventListener('gz-writer:canvas-changed', (e) => __changed.push(JSON.parse(e.detail))); document.getElementById('elsewhere').focus(); });
    await log();

    const watched = await ask('canvas-watch', { id: 'gzw-a' });
    check(watched.length === 1 && watched[0].ok, 'watch: the box is watched');
    const html = '<p style="text-align: center;">Hello <strong>Canvas</strong></p><ul><li>a<ul><li>b</li></ul></li></ul><blockquote><p>q</p></blockquote>';
    const set = await ask('canvas-set', { id: 'gzw-a', html });
    check(set.length === 1 && set[0].ok && set[0].text === 'Hello Canvasabq', `set: answered with the box's text (${set[0]?.text})`);
    const after = await page.evaluate(() => ({ content: tinymce.get('submission_body').getContent(), focus: document.activeElement.id, undo: tinymce.get('submission_body').undoManager.hasUndo() }));
    check(after.content.replace(/\n/g, '') === html, `set: TinyMCE holds Writer's document (${after.content.replace(/\n/g, '')})`);
    check(after.focus === 'elsewhere', 'set: focus stays where it was');
    check(after.undo, 'set: an undo step');
    const heard = await log();
    check(heard.some((l) => l.startsWith('textarea change ') && l.includes('Hello')), 'set: the textarea hears change (a quiz backs its answer up on it)');
    check(heard.some((l) => l.startsWith('react setcontent') && l.includes('Hello')) && heard.some((l) => l.startsWith('react change') && l.includes('Hello')), 'set: tinymce-react\'s state follows (setcontent and change)');
    check(await page.evaluate(() => __changed.length) === 0, 'set: Writer\'s own write is not announced as Canvas\'s');
    const got = await ask('canvas-get', { id: 'gzw-a' });
    check(got[0].ok && got[0].html === await page.evaluate(() => tinymce.get('submission_body').getBody().innerHTML), 'get: the frame body as the isolated world reads it');

    for (const bad of ['<p><img src="x"></p>', '<p style="color: red;">r</p>', '<script>alert(1)</script>', '<p class="x">c</p>']) {
      const r = await ask('canvas-set', { id: 'gzw-a', html: bad });
      check(r[0].ok === false, `set refuses ${bad}`);
    }
    check((await page.evaluate(() => tinymce.get('submission_body').getContent())).replace(/\n/g, '') === html && (await log()).length === 0, 'a refused set leaves the box and its listeners untouched');

    await page.evaluate(() => tinymce.get('submission_body').setContent('<p>Canvas reset it</p>'));
    check(JSON.stringify(await page.evaluate(() => __changed.splice(0))) === '[{"id":"gzw-a"}]', 'Canvas\'s own setContent is announced for the box');
    await page.evaluate(() => tinymce.get('submission_body').undoManager.undo());
    check((await page.evaluate(() => __changed.splice(0))).length >= 1, 'an undo is announced');
    await log();

    const ex = await ask('canvas-exec', { id: 'gzw-a', command: 'instructureEquation' });
    const ran = await log();
    check(ex[0].ok && ran.length === 1 && ran[0].startsWith('command instructureEquation true'), `exec: Canvas's Equation tool runs with a collapsed caret (${ran[0]})`);
    check((await ask('canvas-exec', { id: 'gzw-a', command: 'mceInsertContent' }))[0].ok === false && (await log()).length === 0, 'exec refuses anything but Canvas\'s Insert tools');

    const ib = await ask('canvas-set', { id: 'gzw-i', text: 'Hi there\n\nSecond line' });
    const ibLog = await log();
    check(ib[0].ok && ib[0].text === 'Hi there\n\nSecond line', 'Inbox: the value is set');
    check(ibLog.includes('react onChange "Hi there\\n\\nSecond line"'), `Inbox: React's tracker sees the change (${ibLog.join(' | ')})`);
    check((await ask('canvas-set', { id: 'gzw-i', html: '<p>x</p>' }))[0].ok === false, 'Inbox: HTML refused');
    check((await ask('canvas-set', { id: 'gzw-nope', html: '<p>x</p>' }))[0].ok === false, 'an unknown box answers not ok');
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    passed = true;
  } finally {
    await browser?.close();
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, errors }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), e.stack + '\n'); } process.exitCode = 1; });
