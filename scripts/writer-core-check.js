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
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'writer-paper.css'), 'utf8').replace(/@font-face\s*\{[^}]*\}/g, '') });
    for (const file of ['lib/pm.js', 'lib/writer-schema.js', 'lib/writer-editor.js', 'lib/writer-styles.js', 'lib/writer-paginate.js']) {
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
        document.getElementById('ed').parentElement.className = 'gp-flow';
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
    await check('native sync verifies fragment whitespace and head-like text exactly', async () => {
      // Exercise the shipped verifier with the browser parser, rather than stand-in-dom's innerHTML stand-in.
      const source = fs.readFileSync(path.join(root, 'features/writer.js'), 'utf8');
      const start = source.indexOf('  const sameText ='), end = source.indexOf('  // h: what the frame shows;', start);
      assert.ok(start >= 0 && end > start);
      await page.addScriptTag({ content: `{ ${source.slice(start, end)} window.writerSameText = sameText; }` });
      const result = await page.evaluate(() => {
        const exact = document.createElement('div'), missing = document.createElement('div');
        exact.textContent = '  Draft'; missing.textContent = 'Draft';
        const style = document.createElement('div'); style.textContent = '.a{}Draft';
        return [writerSameText(exact, '  Draft'), writerSameText(missing, '  Draft'),
          writerSameText(style, '<style>.a{}</style><p>Draft</p>'), writerSameText(missing, '<style>.a{}</style><p>Draft</p>')];
      });
      assert.deepEqual(result, [true, false, true, false]);
    });
    await check('HTML paste keeps fragment whitespace before text and blocks', async () => {
      const result = await page.evaluate(() => {
        const seen = [];
        ed.view.setProps({ transformPastedHTML: (html) => html, clipboardParser: { parseSlice: (dom) => {
          seen.push(dom.textContent); return GZ_PM.model.Slice.empty;
        } } });
        for (const html of ['  Draft', '\n  <p>Draft</p>', '<meta charset="utf-8">  Draft'])
          GZ_PM.view.__parseFromClipboard(ed.view, '', html, false, ed.view.state.selection.$from);
        return seen;
      });
      assert.deepEqual(result, ['  Draft', '\n  Draft', '  Draft']);
    });
    await check('HTML paste applies Word and Docs head styles and keeps table wrappers', async () => {
      const result = await page.evaluate(() => {
        const seen = [];
        ed.view.setProps({ transformPastedHTML: (html) => html, clipboardParser: { parseSlice: (dom) => {
          seen.push({ text: dom.textContent, bold: dom.querySelector('.word')?.style.fontWeight,
            italic: dom.querySelector('.docs')?.style.fontStyle, cell: dom.querySelector('td')?.textContent });
          return GZ_PM.model.Slice.empty;
        } } });
        for (const html of ['<html><head><style>.word{font-weight:bold}</style></head><body><p class="word">Word</p></body></html>',
          '<meta charset="utf-8"><style>.docs{font-style:italic}</style><b id="docs-internal-guid"><p class="docs">Docs</p></b>',
          '<tr><td>Cell</td></tr>'])
          GZ_PM.view.__parseFromClipboard(ed.view, '', html, false, ed.view.state.selection.$from);
        return seen;
      });
      assert.equal(result[0].bold, 'bold'); assert.ok(result[0].text.endsWith('Word'));
      assert.equal(result[1].italic, 'italic'); assert.ok(result[1].text.endsWith('Docs'));
      assert.equal(result[2].cell, 'Cell');
    });
    await check('remeasurement places page gaps at natural line starts after a width change', async () => {
      const result = await page.evaluate(async (words) => {
        ed.destroy();
        document.getElementById('ed').parentElement.className = 'gp-flow';
        window.ed = GZ_WRITER_EDITOR.create({ mount: document.getElementById('ed'), mode: 'paper', html: '<p>' + words + '</p>' });
        let format = GZ_WRITER_STYLES.FORMATS.mla9;
        const sheet = new CSSStyleSheet();
        const style = () => sheet.replaceSync(GZ_WRITER_STYLES.css(format));
        document.adoptedStyleSheets = [sheet]; style();
        ed.addPlugins([GZ_WRITER_PAGINATE.plugin({ format: () => format, notes: () => [], gap: 26.4 })]);
        await new Promise((r) => setTimeout(r, 30));
        const key = GZ_WRITER_PAGINATE.key(), v = ed.view;
        v.dispatch(v.state.tr.insertText('Changed ', 1));
        const staleAfterEdit = key.getState(v.state).find().filter((d) => d.spec.key?.startsWith('gp:l:')).length;
        await new Promise((r) => setTimeout(r, 30));
        format = { ...format, margins: [1, 1.5, 1, 1.5] }; style();
        GZ_WRITER_PAGINATE.relayout(ed.view);
        await new Promise((r) => setTimeout(r, 30));
        const gaps = key.getState(v.state).find().filter((d) => d.spec.key?.startsWith('gp:l:')).map((d) => d.from);
        // Remove decorations synchronously to read the browser's natural wraps before the queued next plan.
        v.dispatch(v.state.tr.setMeta(key, GZ_PM.view.DecorationSet.empty));
        const starts = new Set(); let top = -Infinity;
        for (let q = 1; q < v.state.doc.content.size - 1; q++) {
          const y = v.coordsAtPos(q, 1).top;
          if (y > top + 3) { starts.add(q); top = y; }
        }
        const bad = gaps.filter((q) => !starts.has(q));
        ed.destroy(); document.adoptedStyleSheets = [];
        return { count: gaps.length, bad, staleAfterEdit };
      }, require('../test/fixtures/writer-docx-import.js').text(2500, 37));
      assert.ok(result.count > 1);
      assert.equal(result.staleAfterEdit, 0, 'editing drops stale inline gaps before remeasurement');
      assert.deepEqual(result.bad, []);
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
    await check('an aligned tab field may extend into the margin without wrapping', async () => {
      const result = await page.evaluate(async () => {
        ed.destroy();
        document.getElementById('ed').parentElement.className = 'gp-flow';
        window.ed = GZ_WRITER_EDITOR.create({ mount: document.getElementById('ed'), mode: 'paper', html: '<p data-gz="tabs:1l 3.25c 5.5r 6.25d">Item 6\tgate\tnight\t2,006\t19.125</p>' });
        const format = { ...GZ_WRITER_STYLES.FORMATS.mla9, first: 0, line: 1 };
        const sheet = new CSSStyleSheet(); sheet.replaceSync(GZ_WRITER_STYLES.css(format)); document.adoptedStyleSheets = [sheet];
        ed.addPlugins([GZ_WRITER_PAGINATE.plugin({ format: () => format, notes: () => [], gap: 26.4 })]);
        await new Promise((r) => setTimeout(r, 50));
        const v = ed.view, last = v.state.doc.firstChild.textContent.indexOf('19.125') + 1;
        const delta = v.coordsAtPos(last).top - v.coordsAtPos(1).top;
        ed.destroy(); document.adoptedStyleSheets = [];
        return delta;
      });
      assert.ok(Math.abs(result) < 1, `the decimal field wrapped by ${result}px`);
    });
    await check('a long aligned tab field still wraps inside the paper', async () => {
      const result = await page.evaluate(async () => {
        ed.destroy();
        document.getElementById('ed').parentElement.className = 'gp-flow';
        window.ed = GZ_WRITER_EDITOR.create({ mount: document.getElementById('ed'), mode: 'paper', html: '<p data-gz="tabs:3.25c">Term\t' + 'A longer field has several words. '.repeat(30) + '</p>' });
        const format = { ...GZ_WRITER_STYLES.FORMATS.mla9, first: 0, line: 1 };
        const sheet = new CSSStyleSheet(); sheet.replaceSync(GZ_WRITER_STYLES.css(format)); document.adoptedStyleSheets = [sheet];
        ed.addPlugins([GZ_WRITER_PAGINATE.plugin({ format: () => format, notes: () => [], gap: 26.4 })]);
        await new Promise((r) => setTimeout(r, 50));
        const v = ed.view, end = v.coordsAtPos(v.state.doc.content.size - 1), box = v.dom.getBoundingClientRect();
        const out = { wrapped: end.top > v.coordsAtPos(1).top + 10, overflow: end.left - box.right };
        ed.destroy(); document.adoptedStyleSheets = [];
        return out;
      });
      assert.equal(result.wrapped, true);
      assert.ok(result.overflow < 1, `the field extends ${result.overflow}px beyond the paper`);
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
