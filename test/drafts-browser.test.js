// Opt-in native HTML parser/editing check: NODE_PATH=/path/to/node_modules DRAFT_BROWSER=1 nice -n 10 node --test test/drafts-browser.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Restore sanitizes legacy HTML at the native editing boundary', { skip: !process.env.DRAFT_BROWSER }, async (t) => {
  const lock = '/private/tmp/claude-501/glaze-heavy.lock';
  let held = false, browser;
  try {
    for (let i = 0; !held; i++) {
      try { fs.mkdirSync(lock); held = true; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 120) throw e; await new Promise((r) => setTimeout(r, 5000)); }
    }
    await require('../scripts/wait-for-browser.js')();
    browser = await require('playwright').chromium.launch({ headless: true });
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1wAAAABJRU5ErkJggg==';
    const cases = [
      ['pasted raster image', `<p>A sufficiently long recovery paragraph.</p><img src="${png}" alt="diagram">`],
      ['events and executable URLs', '<p onclick="window.injected=1">A sufficiently long recovery paragraph.</p><img src="x" onerror="window.injected=1"><a href="java&#x73;cript:alert(1)">link</a><a href="java&#9;script:alert(1)">tab</a>'],
      ['active elements and CSS', '<p>A sufficiently long recovery paragraph.</p><script>window.injected=1</script><style>body{display:none}</style><iframe srcdoc="<script>top.injected=1</script>"></iframe><p style="position:fixed;inset:0" id="cover">text</p>'],
      ['foreign namespaces and parser repairs', '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.injected=1>"></mglyph></table></mtext></math><svg><a xlink:href="javascript:alert(1)">svg</a></svg><p>A sufficiently long recovery paragraph.</p>'],
      ['ordinary rich text', '<p>A sufficiently long <strong>recovery</strong> paragraph.</p><blockquote><em>quotation</em></blockquote><ul><li>item</li></ul><a href="https://example.test/reading?q=1&amp;b=2">reading</a><img src="https://example.test/picture.png" alt="diagram">'],
    ];
    for (const [name, html] of cases) await t.test(name, async () => {
      const page = await browser.newPage();
      try {
        await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body><div id="ed1" class="ql-editor" contenteditable="true"></div></body></html>' }));
        await page.goto('https://bb.school.test/ultra/courses/_5_1/outline');
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../lib/drafts.js'), 'utf8') });
        await page.evaluate((html) => {
          const key = GZ_DRAFTS.ultraKey({ origin: location.origin, user: '_7_1', path: location.pathname, near: '_12_3', id: 'ed1' });
          const store = { [key]: { html, text: 'A sufficiently long recovery paragraph.', at: Date.now() } };
          window.chrome = { runtime: { sendMessage() {} }, storage: { local: {
            get: (keys, cb) => queueMicrotask(() => cb(keys === null ? structuredClone(store) : Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])))),
            set: (o, cb) => { Object.assign(store, o); cb?.(); }, remove: (keys, cb) => { for (const k of [].concat(keys)) delete store[k]; cb?.(); },
          } } };
          window.GZ_PAGE = { describe: () => ({ rel: 'now' }) };
          window.GZ_CTX = { site: 'ultra', t: (s) => s, locale: () => 'en', settings: () => ({ enhance: { drafts: true } }), on: () => true,
            account: async () => '_7_1', local: (f) => f(chrome.storage.local), draftEditor: '.ql-editor[contenteditable="true"]',
            draftAt: (ed) => ({ ed, id: ed.id, near: '_12_3', path: location.pathname, text: ed.textContent, html: ed.innerHTML, at: Date.now() }) };
        }, html);
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../features/drafts.js'), 'utf8') });
        await page.evaluate(() => GZ_DRAFT_UI.watch());
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        const got = await page.evaluate(() => {
          const ed = document.getElementById('ed1');
          return { html: ed.innerHTML, injected: !!window.injected,
            bad: [...ed.querySelectorAll('*')].flatMap((el) => [
              ...(/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|SVG|MATH|FORM|INPUT|LINK|META)$/.test(el.tagName) ? [el.tagName] : []),
              ...[...el.attributes].filter((a) => /^on/i.test(a.name) || ['style', 'srcdoc', 'id'].includes(a.name) || (/^(href|src|xlink:href)$/.test(a.name) && /^\s*(javascript|data:text|vbscript):/i.test(a.value.replace(/[\x00-\x20]/g, '')))).map((a) => a.name),
            ]) };
        });
        assert.deepEqual(got.bad, [], `unsafe markup reached insertHTML: ${got.bad.join(', ')}`);
        assert.equal(got.injected, false, 'restoring a copy must not execute stored event handlers');
        if (name === 'pasted raster image') assert.ok(got.html.includes(png), 'a safe pasted bitmap must survive recovery');
        if (name === 'ordinary rich text') {
          assert.match(got.html, /<(strong|b)>recovery<\/(strong|b)>/);
          assert.match(got.html, /<blockquote>/); assert.match(got.html, /<li>item<\/li>/);
          assert.match(got.html, /href="https:\/\/example.test\/reading/);
          assert.match(got.html, /src="https:\/\/example.test\/picture.png"/);
        }
      } finally { await page.close(); }
    });
  } finally { await browser?.close(); if (held) fs.rmdirSync(lock); }
});
