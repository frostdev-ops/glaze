// Headless EditorView regressions: node scripts/writer-core-check.js [name pattern].
// Run under the shared heavy-browser lock; NODE_PATH may supply Playwright and CHROME may select Chromium.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), filter = new RegExp(process.argv[2] || '.');

(async () => {
  await require('./wait-for-browser.js')();
  const browser = await chromium.launch({ headless: true, ...require('./check-env.js').chromeLaunch() });
  let failures = 0, checks = 0;
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><meta charset="utf-8"><div id="ed"></div>');
    for (const file of ['lib/pm.js', 'lib/writer-schema.js', 'lib/writer-editor.js', 'lib/writer-styles.js']) {
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
    await check('paper heading alignment overrides its format on screen', async () => {
      const result = await page.evaluate(() => {
        ed.destroy();
        document.getElementById('ed').className = 'gp-flow';
        window.ed = GZ_WRITER_EDITOR.create({ mount: document.getElementById('ed'), mode: 'paper', html: '<h1>Heading</h1>' });
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(GZ_WRITER_STYLES.css(GZ_WRITER_STYLES.FORMATS.apa7));
        document.adoptedStyleSheets = [sheet];
        const out = [];
        for (const dir of ['left', 'right', 'justify', 'center']) {
          ed.run('align', dir);
          out.push(getComputedStyle(ed.view.dom.querySelector('h1')).textAlign);
        }
        document.adoptedStyleSheets = [];
        return out;
      });
      assert.deepEqual(result, ['left', 'right', 'justify', 'center']);
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
    await check('clipboard metadata cannot restore attributes outside the allowlist', async () => {
      const result = await page.evaluate(() => {
        ed.destroy(); window.ed = GZ_WRITER_EDITOR.create({ mount: document.getElementById('ed'), mode: 'paper' });
        const html = `<p data-pm-slice='0 0 ["paragraph",{"line":"1;background:red"}]'>safe</p>`;
        const slice = GZ_PM.view.__parseFromClipboard(ed.view, '', html, false, ed.view.state.selection.$from);
        return JSON.stringify(slice.toJSON());
      });
      assert.doesNotMatch(result, /background/);
    });
    await check('oversized or deeply nested paste is refused without a page error', async () => {
      const result = await page.evaluate(() => {
        ed.run('insertText', 'keep');
        const data = new DataTransfer(); data.setData('text/html', '<span>'.repeat(5000) + 'x' + '</span>'.repeat(5000));
        ed.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        return ed.text();
      });
      assert.equal(result, 'keep');
      assert.deepEqual(errors, []);
    });
    await check('Tab stays after IME Escape, while Escape then Tab or Shift-Tab leaves', async () => {
      await page.evaluate(() => {
        document.getElementById('ed').insertAdjacentHTML('beforebegin', '<button id="before">Before</button>');
        document.getElementById('ed').insertAdjacentHTML('afterend', '<button id="after">After</button>');
        ed.setHTML('<p>words</p>'); ed.focus();
        const dom = ed.view.dom;
        dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, isComposing: true, bubbles: true }));
        dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      });
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => ed.view.hasFocus() && ed.text().includes('\t')), true, 'the IME Escape does not release Tab');
      await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'after');
      await page.evaluate(() => ed.focus());
      await page.keyboard.press('Escape'); await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'before');
    });
    assert.deepEqual(errors, [], 'no page errors');
    await page.evaluate(() => ed.destroy());
  } finally { await browser.close(); }
  console.log(`${checks - failures}/${checks} passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
