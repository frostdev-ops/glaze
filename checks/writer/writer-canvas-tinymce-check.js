// Glaze Writer's Canvas dialect (writer/writer-schema.js canvas) through real TinyMCE 5.10.9, the editor Canvas's Rich
// Content Editor runs (local Canvas 1c9f0bb8; test/fixtures/canvas-writer-rce.json), with Canvas's element allowlists
// (test/fixtures/canvas-writer-tinymce.json). 30 documents Writer writes go in with setContent, as
// writer/writer-main-canvas.js puts them; what TinyMCE's frame body then holds (what Writer reads back) and getContent()
// (what Canvas submits) must each read back as the same document, with nothing Writer would refuse. Then TinyMCE's own
// formatting commands (underline, strikethrough, indent, alignment, nested lists, quote, headings, pre) must read as
// Writer's marks and blocks. TinyMCE's files are fetched and pinned by SHA-256 (the same bytes as npm's tinymce@5.10.9,
// integrity sha512-5bkrors87X9…); the page is synthetic and nothing else is reached.
// glaze-remote -o <evidence directory> -- node checks/writer/writer-canvas-tinymce-check.js /out (CLAUDE.md)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const S = require('../../extension/writer/writer-schema.js');

const CDN = 'https://cdn.jsdelivr.net/npm/tinymce@5.10.9/';
const FILES = {
  'tinymce.min.js': '3c3041cb95a1c979ee2205901cf1c670a36c192ef089e6f63b94beabef386c30',
  'themes/silver/theme.min.js': '05f5cf013cd5b6c793f9d5f745350088d3c5686ba001197b7ce2e1cb8c961f99',
  'icons/default/icons.min.js': '6c5a69c090aa1418082e7ad5e707bbe6c531269607e080821a7089a16e0f2b61',
  'plugins/lists/plugin.min.js': '2e7d9385c8fd8248220ff2c5f34b30ad92a6bf34e65f05b611f24c9fd820a2a2',
};
const site = 'https://glaze-check.instructure.com';
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../test/fixtures/canvas-writer-tinymce.json'), 'utf8')).config;
const out = process.argv[2], lock = require('../../tools/dev/check-env.js').lockPath();
const checks = [], errors = [], results = []; let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
const K = S.canvas, doc = (h) => JSON.stringify(S.parse(K, h).toJSON());

// Writer's side: each source read as Writer would and written in Canvas's dialect, so every one is what Writer sends.
const SOURCES = [
  '<p>One plain paragraph.</p>',
  '<p>First.</p><p>Second.</p><p>Third.</p>',
  '<p style="text-align: center;">Centred</p><p style="text-align: right;">Right</p><p style="text-align: justify;">Justified text that runs on.</p>',
  ...[1, 2, 3, 8].map((n) => `<p style="padding-left: ${n * 40}px;">Indented ${n}</p>`),
  '<p style="text-align: center; padding-left: 80px;">Both</p>',
  '<h3>Heading three</h3><h4>Heading four</h4><p>Body</p>',
  '<h3 style="text-align: center;">Centred heading</h3><h4 style="padding-left: 40px;">Indented heading</h4>',
  '<p><strong>bold</strong> <em>italic</em> <u>underline</u> <s>strike</s> x<sup>2</sup> H<sub>2</sub>O</p>',
  '<p><strong><em><s><u>all four</u></s></em></strong> and <a href="https://example.com/a?b=1&amp;c=2"><strong>a bold link</strong></a></p>',
  '<p><a href="mailto:student@example.edu">mail</a>, <a href="tel:+15551234567">call</a>, <a href="http://example.com">plain http</a></p>',
  '<p>Spaces:&nbsp; two,&nbsp;&nbsp;&nbsp; four, and&nbsp;</p><p>&nbsp;leading</p>',
  '<p>Empty after</p><p><br></p><p><br></p><p>end</p>',
  '<ul><li>one</li><li>two</li><li>three</li></ul>',
  '<ol><li>first</li><li>second</li></ol>',
  '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>',
  '<ol><li>step<ul><li>detail</li><li>detail two</li></ul></li><li>next step</li></ol>',
  '<ul><li style="text-align: center;">centred item</li><li><strong>bold</strong> item</li></ul>',
  '<ul><li>top</li></ul><ol><li>numbered after</li></ol><p>then text</p>',
  '<ul><li class="ql-indent-2">starts deep</li><li>back up</li></ul>',
  '<ol><li><br></li><li>after an empty item</li></ol>',
  '<pre>function f(x) {\n  return x &lt; 2 &amp;&amp; x &gt; 0;\n}</pre>',
  '<pre>line one\n\n    indented after a blank</pre><p>after code</p>',
  '<blockquote><p>A quoted line.</p></blockquote><p>My answer.</p>',
  '<blockquote><p>Quote with</p><ul><li>a list</li></ul><blockquote><p>and one inside</p></blockquote></blockquote>',
  '<p>Unicode: café, naïve, 日本語, emoji 🙂, “quotes” — dashes…</p>',
  '<p>&lt;not a tag&gt; &amp; ampersand &quot;straight&quot;</p>',
  '<h3>Essay</h3><p style="padding-left: 40px;">Opening.</p><ul><li>point<ol><li>sub</li></ol></li></ul><blockquote><p>cited</p></blockquote><pre>code</pre><p style="text-align: right;"><em>sig</em></p>',
];
const DOCS = SOURCES.map((h) => S.serialize(K, S.parse(K, h)));

(async () => {
  let browser, held = false;
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-canvas-tinymce-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-canvas-tinymce-check] waiting for heavy lock'); await pause(5000); }
    }
    check(DOCS.length === 30, `30 documents in Canvas's dialect (${DOCS.length})`);
    for (const [i, h] of DOCS.entries()) assert.deepEqual(S.loses(K, h), [], `document ${i} is one Writer keeps`);
    const bytes = {};
    for (const [f, sha] of Object.entries(FILES)) {
      const b = Buffer.from(await (await fetch(CDN + f)).arrayBuffer());
      const got = crypto.createHash('sha256').update(b).digest('hex');
      if (got !== sha) throw Error(`TinyMCE 5.10.9 ${f} hash mismatch: ${got}`);
      bytes[f] = b;
    }
    check(true, `real TinyMCE 5.10.9 fetched and pinned (${Object.keys(FILES).length} files by SHA-256)`);

    await require('../../tools/dev/wait-for-browser.js')();
    browser = await chromium.launch({ ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.origin !== site || r.request().method() !== 'GET') return r.abort();
      const f = u.pathname.slice('/tinymce/'.length);
      if (u.pathname.startsWith('/tinymce/') && bytes[f]) return r.fulfill({ contentType: 'text/javascript', body: bytes[f] });
      if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><script src="/tinymce/tinymce.min.js"></script></head><body><textarea id="submission_body"></textarea></body></html>` });
      return r.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${site}/`);
    await page.evaluate((cfg) => new Promise((resolve, reject) => {
      tinymce.init({ selector: '#submission_body', base_url: '/tinymce', suffix: '.min', skin: false, content_css: false, menubar: false, statusbar: false,
        plugins: 'lists', ...cfg, init_instance_callback: () => resolve() }).catch(reject);
    }), config);
    const ver = await page.evaluate(() => `${tinymce.majorVersion}.${tinymce.minorVersion}`);
    check(ver === '5.10.9', `TinyMCE ${ver} running with Canvas's allowlists`);

    // Writer → TinyMCE: setContent, then what its frame body holds and what Canvas would submit.
    let same = 0;
    for (const [i, h] of DOCS.entries()) {
      const r = await page.evaluate((html) => { const ed = tinymce.get('submission_body'); ed.setContent(html); ed.undoManager.add(); return { body: ed.getBody().innerHTML, content: ed.getContent(), text: ed.getBody().textContent }; }, h);
      results.push({ i, sent: h, ...r });
      for (const [what, got] of [['frame body', r.body], ['getContent', r.content]]) {
        assert.deepEqual(S.loses(K, got), [], `document ${i}: TinyMCE's ${what} holds nothing Writer refuses: ${got}`);
        assert.equal(doc(got), doc(h), `document ${i}: TinyMCE's ${what} reads back as the document Writer sent\n  sent ${h}\n  got  ${got}`);
      }
      assert.equal(S.text(S.parse(K, r.body)).text, S.text(S.parse(K, h)).text, `document ${i}: the same text`);
      if (S.serialize(K, S.parse(K, r.content)) === h) same++;
    }
    check(true, `all 30 documents round trip through TinyMCE: its frame body and getContent() read back as what Writer sent, nothing refused (${same}/30 byte for byte)`);

    // TinyMCE's own formatting → Writer.
    const run = (html, steps) => page.evaluate(({ html, steps }) => {
      const ed = tinymce.get('submission_body');
      ed.setContent(html);
      for (const [cmd, arg, at] of steps) {
        const body = ed.getBody();
        if (at === 'all') ed.selection.select(body, true);
        else if (typeof at === 'number') ed.selection.select(body.children[at], true);
        ed.execCommand(cmd, false, arg);
      }
      return { body: ed.getBody().innerHTML, content: ed.getContent() };
    }, { html, steps });
    const COMMANDS = [
      ['Underline', '<p>word</p>', [['Underline', null, 'all']], (d) => d.firstChild.firstChild.marks.map((m) => m.type.name).join() === 'underline'],
      ['Strikethrough', '<p>word</p>', [['Strikethrough', null, 'all']], (d) => d.firstChild.firstChild.marks.map((m) => m.type.name).join() === 'strike'],
      ['Bold and Italic', '<p>word</p>', [['Bold', null, 'all'], ['Italic', null, 'all']], (d) => d.firstChild.firstChild.marks.map((m) => m.type.name).sort().join() === 'bold,italic'],
      ['Superscript', '<p>x</p>', [['Superscript', null, 'all']], (d) => d.firstChild.firstChild.marks[0]?.type.name === 'sup'],
      ['Indent twice', '<p>para</p>', [['Indent', null, 0], ['Indent', null, 0]], (d) => d.firstChild.attrs.indent === 2],
      ['JustifyCenter', '<p>para</p>', [['JustifyCenter', null, 0]], (d) => d.firstChild.attrs.align === 'center'],
      ['JustifyFull', '<p>para</p>', [['JustifyFull', null, 0]], (d) => d.firstChild.attrs.align === 'justify'],
      ['a nested bulleted list', '<p>one</p><p>two</p>', [['InsertUnorderedList', null, 'all'], ['Indent', null, null]], null],
      ['a numbered list', '<p>one</p><p>two</p>', [['InsertOrderedList', null, 'all']], (d) => d.firstChild.type.name === 'ordered_list' && d.firstChild.childCount === 2],
      ['a quote', '<p>quoted</p>', [['mceBlockQuote', null, 0]], (d) => d.firstChild.type.name === 'blockquote' && d.firstChild.firstChild.textContent === 'quoted'],
      ['Heading 3', '<p>title</p>', [['FormatBlock', 'h3', 0]], (d) => d.firstChild.type.name === 'heading' && d.firstChild.attrs.level === 3],
      ['Heading 4', '<p>title</p>', [['FormatBlock', 'h4', 0]], (d) => d.firstChild.type.name === 'heading' && d.firstChild.attrs.level === 4],
      ['Preformatted', '<p>code</p>', [['FormatBlock', 'pre', 0]], (d) => d.firstChild.type.name === 'code_block' && d.firstChild.textContent === 'code'],
    ];
    for (const [name, html, steps, wanted] of COMMANDS) {
      let r, want = wanted;
      if (name === 'a nested bulleted list') {
        r = await page.evaluate(() => {
          const ed = tinymce.get('submission_body');
          ed.setContent('<p>one</p><p>two</p>');
          ed.selection.select(ed.getBody(), true);
          ed.execCommand('InsertUnorderedList');
          const second = ed.getBody().querySelectorAll('li')[1];
          ed.selection.setCursorLocation(second.firstChild, 1);
          ed.execCommand('Indent');
          return { body: ed.getBody().innerHTML, content: ed.getContent() };
        });
        want = (d) => d.firstChild.type.name === 'bullet_list' && d.firstChild.childCount === 2 && d.firstChild.child(1).attrs.indent === 1;
      } else r = await run(html, steps);
      results.push({ command: name, ...r });
      for (const [what, got] of [['frame body', r.body], ['getContent', r.content]]) {
        assert.deepEqual(S.loses(K, got), [], `${name}: TinyMCE's ${what} holds nothing Writer refuses: ${got}`);
        assert.ok(want(S.parse(K, got)), `${name}: Writer reads TinyMCE's ${what} as it was formatted: ${got}`);
      }
      check(true, `TinyMCE's ${name} reads as Writer's (${r.content})`);
    }
    const empty = await page.evaluate(() => { const ed = tinymce.get('submission_body'); ed.setContent(''); return ed.getBody().innerHTML; });
    check(/data-mce-bogus/.test(empty) && doc(empty) === doc('<p></p>') && S.loses(K, empty).length === 0, `an empty RCE's body (${empty}) is one empty paragraph to Writer`);
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    passed = true;
  } finally {
    await browser?.close();
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, errors, results }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), e.stack + '\n'); } process.exitCode = 1; });
