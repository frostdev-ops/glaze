// Headless EditorView regressions. Run with NODE_PATH=/Users/jame/Projects/gemino/node_modules
// nice -n 10 lockf -k /private/tmp/claude-501/glaze-heavy.lock node scripts/writer-core-check.js [name pattern].
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), filter = new RegExp(process.argv[2] || '.');

(async () => {
  const browser = await chromium.launch({ headless: true });
  let failures = 0, checks = 0;
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><meta charset="utf-8"><div id="ed"></div>');
    for (const file of ['lib/pm.js', 'lib/writer-schema.js', 'lib/writer-editor.js']) {
      const content = process.env.WRITER_REVIEW_BASE && file !== 'lib/pm.js'
        ? execFileSync('git', ['show', `${process.env.WRITER_REVIEW_BASE}:${file}`], { cwd: root, encoding: 'utf8' })
        : fs.readFileSync(path.join(root, file), 'utf8');
      await page.addScriptTag({ content });
    }
    const check = async (name, fn) => {
      if (!filter.test(name)) return;
      checks++;
      try {
        await page.evaluate(() => { if (typeof window.ed?.destroy === 'function') window.ed.destroy(); window.ed = GZ_WRITER_EDITOR.create({ mount: document.getElementById('ed') }); ed.focus(); });
        await fn();
        console.log(`ok ${name}`);
      } catch (e) { failures++; console.error(`FAIL ${name}\n${e.message}`); }
    };
    await check('setHTML is isolated from typing on both sides of history', async () => {
      const result = await page.evaluate(() => {
        ed.run('insertText', 'a');
        ed.setHTML('<p>fresh</p>');
        ed.run('insertText', 'b');
        ed.run('undo'); const fresh = ed.html();
        ed.run('undo'); const prior = ed.html();
        ed.run('redo'); const redo = ed.html();
        return { fresh, prior, redo };
      });
      assert.deepEqual(result, { fresh: '<p>fresh</p>', prior: '<p>a</p>', redo: '<p>fresh</p>' });
    });
    await check('plain paste preserves spaces, blank lines and UTF-16 text', async () => {
      const input = '  😀  x\n\nשלום  ';
      const result = await page.evaluate((input) => {
        const data = new DataTransfer(); data.setData('text/plain', input);
        ed.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        return { text: ed.text(), html: ed.html() };
      }, input);
      assert.equal(result.text, input);
      assert.equal(result.html, '<p>&nbsp;&nbsp;😀&nbsp;&nbsp;x</p><p><br></p><p>שלום&nbsp;&nbsp;</p>');
    });
    assert.deepEqual(errors, [], 'no page errors');
    await page.evaluate(() => ed.destroy());
  } finally { await browser.close(); }
  console.log(`${checks - failures}/${checks} passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
