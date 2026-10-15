// PDF and picture import (W23), headless, on the local Canvas (http://localhost:3000; logins in
// ~/Projects/canvas-lms/glaze/credentials.env), with a throwaway copy of this checkout's extension widened to localhost,
// in a fresh profile. Each import flow (class schedule, syllabus, transcript) from a PDF and from a picture, in a light
// and a dark Look: the file goes in through the flow's own file field, Glaze's reader reads it in its frame, the review
// shows what the fixture holds, and the frame is gone afterwards. Then: a scanned PDF stopped part way and a dialog closed
// with Escape while reading (the frame goes), a locked PDF's message, a screenshot pasted into the schedule's text box,
// the import step by keyboard, its words in the six languages, the reader's own accuracy on every picture fixture (the
// browser's decoding, not node's), and whether anything asked for an address other than localhost and the extension.
// Saves the class schedule's list, light and dark, as test/fixtures/import/canvas-schedule-{light,dark}.png. Writes
// nothing to Canvas: what Save keeps goes to the throwaway profile's extension storage.
//   NODE_PATH=/path/to/node_modules node scripts/import-check.js [out dir]   (needs playwright)
//   CHROME=/path/to/chrome runs that browser instead of Chrome for Testing.
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('../defaults.js');
const I = require('../lib/i18n.js');
for (const l of ['de', 'es', 'fr', 'nl', 'pt-BR']) require(`../i18n/${l}.js`);
const { SCORE } = require('./import-truth.js');

const root = path.join(__dirname, '..');
const FX = path.join(root, 'test/fixtures/import');
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-import-'));
const BASE = 'http://localhost:3000';
const CREDS = path.join(os.homedir(), 'Projects/canvas-lms/glaze/credentials.env');
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const NOT_EXTENSION = new Set(['assets', 'safari', 'scripts', 'store', 'test', 'parity', 'dist', 'release', 'node_modules']);
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const look = (name) => G.GZ_SANITIZE({ preset: name, colors: { ...G.GZ_PRESETS.find(([n]) => n === name)[1] }, enhance: { ...G.GZ_DEFAULTS.enhance, syllabus: true, gpa: true } });
const frames = (page) => page.evaluate(() => document.querySelectorAll('iframe[src*="reader.html"]').length);

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-import-run-')));
  const ext = path.join(tmp, 'ext');
  fs.mkdirSync(ext);
  for (const f of fs.readdirSync(root)) if (f !== 'manifest.json' && !f.startsWith('.') && !NOT_EXTENSION.has(f) && !/\.(md|sh)$/.test(f)) fs.cpSync(path.join(root, f), path.join(ext, f), { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  // Glaze's first script is one entry per site (content-ultra.js, content-canvas.js): localhost gets Canvas's, as
  // scripts/canvas-shots.js does.
  const glaze = m.content_scripts.filter((e) => e.js.at(-1) === 'content.js');
  for (const e of [...m.content_scripts.filter((x) => !glaze.includes(x)), ...m.web_accessible_resources]) e.matches.push('http://localhost/*');
  m.content_scripts.push({ ...glaze.find((e) => e.matches.includes('https://*.instructure.com/*')), matches: ['http://localhost/*'], exclude_matches: undefined });
  m.host_permissions.push('http://localhost/*');
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1,
    reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    // Anything not the local Canvas or the extension is refused, and noted as Glaze's when an extension page or
    // worker asked for it (the reader and its workers); the page language can be swapped (?glaze_lang=de serves the
    // page as <html lang="de">, which is what Glaze writes its words in).
    const away = [], canvasAway = new Set();
    await ctx.route('**/*', async (route) => {
      const req = route.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (u.host !== 'localhost:3000') {
        let from = 'a worker';
        try { from = req.frame().url(); } catch { /* a worker's request has no frame */ }
        if (from === 'a worker' || from.startsWith('chrome-extension:')) away.push(`${u.href} (from ${from})`); else canvasAway.add(u.origin);
        return route.abort();
      }
      const lang = u.searchParams.get('glaze_lang');
      if (!lang) return route.continue();
      u.searchParams.delete('glaze_lang');
      const res = await route.fetch({ url: u.href });
      route.fulfill({ response: res, body: (await res.text()).replace(/(<html[^>]*\slang=")[^"]*"/, `$1${lang}"`) });
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const cred = Object.fromEntries(fs.readFileSync(CREDS, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => l.split(/=(.*)/s).slice(0, 2).map((s) => s.trim().replace(/^(["'])(.*)\1$/, '$2'))));
    try {
      await page.goto(`${BASE}/login/canvas`);
      await page.fill('input[name="pseudonym_session[unique_id]"]', cred.STUDENT_EMAIL);
      await page.fill('input[name="pseudonym_session[password]"]', cred.STUDENT_PASSWORD || cred.PASSWORD);
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }), page.press('input[name="pseudonym_session[password]"]', 'Enter')]);
    } catch { throw new Error(`Canvas login failed (is ${BASE} up?)`); }
    const courses = await (await ctx.request.get(`${BASE}/api/v1/courses?per_page=50`)).json();
    const bio = courses.find((c) => c.course_code === 'BIO 1100')?.id;
    if (!bio) throw new Error('no BIO 1100 on the local Canvas');
    const id = extensionId(ext);
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${id}/options.html`);
    const set = (s) => opts.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); await chrome.storage.local.clear(); }, s);

    const open = async (url) => {
      await page.goto(BASE + url, { timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('[data-gz-loading], [data-gz-reveal]'), null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
    };
    const palette = async (cmd) => {
      await page.keyboard.press('ControlOrMeta+KeyK');
      await page.getByRole('combobox').fill(cmd);
      await page.keyboard.press('Enter');
    };
    const shot = (name, el) => (el ? page.locator(el).screenshot({ path: path.join(out, `${name}.png`) }) : page.screenshot({ path: path.join(out, `${name}.png`) }));
    // The class schedule's import step, a file chosen and read; → the dialog's review (or its message).
    const schedule = async (file) => {
      await open('/');
      await palette('Class schedule');
      await page.getByRole('button', { name: 'Import a schedule' }).click();
      await page.setInputFiles('#gz-cl input[type="file"]', path.join(FX, file));
      await page.getByRole('button', { name: 'Read schedule' }).click();
    };
    const reviewed = (sel, n) => page.waitForFunction(([s, n]) => document.querySelectorAll(s).length >= n, [sel, n], { timeout: 60000 }).then(() => true, () => false);

    for (const [name, theme] of [['Paper', 'light'], ['Frost', 'dark']]) {
      await set(look(name));
      // ---- class schedule ----
      for (const [file, n] of [['timetable.pdf', 5], ['timetable-photo.jpg', 3]]) {
        await schedule(file);
        const done = await reviewed('#gz-cl .gz-cl-entry', n);
        const found = await page.$$eval('#gz-cl .gz-cl-entry > legend', (ls) => ls.map((l) => l.textContent));
        const times = await page.$$eval('#gz-cl .gz-cl-period input[type="time"]', (is) => is.map((i) => i.value));
        const marks = await page.$$eval('#gz-cl [data-unsure]', (xs) => xs.length);
        const note = await page.locator('#gz-cl .gz-cl-ocr').textContent().catch(() => '');
        ok(done, `${theme} schedule from ${file}: ${found.length} classes (${found.join(', ')}), times ${times.slice(0, 4).join(' ')}…, ${marks} marked "Check this"${note ? `, note: ${note}` : ''}`);
        if (file.endsWith('.pdf')) ok(found.length === 5 && times[0] === '09:00' && times[1] === '09:50' && !note, `${theme} schedule from the PDF: all five, exact`);
        else ok(!!note && marks > 0, `${theme} schedule from a photo: the OCR note and "Check this" marks`);
        ok(await frames(page) === 0, `${theme} schedule from ${file}: the reader's frame is gone`);
        await shot(`${theme}-schedule-${file.replace(/\W/g, '-')}`, '#gz-cl');
        if (file.endsWith('.pdf')) {
          await page.getByRole('button', { name: 'Save', exact: true }).click();
          await page.waitForSelector('#gz-cl .gz-cl-list');
          await page.waitForTimeout(300);
          await page.locator('#gz-cl').screenshot({ path: path.join(FX, `canvas-schedule-${theme}.png`) });
        }
        await page.keyboard.press('Escape');
      }
      // ---- syllabus, on BIO 1100's Syllabus page ----
      for (const [file, want] of [['syllabus.pdf', 'Dr. Amara Okafor'], ['syllabus.png', 'Dr. Amara Okafor']]) {
        await open(`/courses/${bio}/assignments/syllabus`);
        await page.getByRole('button', { name: 'Use a file or text' }).click();
        await page.setInputFiles('#gz-syl-file', path.join(FX, file));
        await page.getByRole('button', { name: 'Read it' }).click();
        const done = await page.waitForSelector('#gz-syl-dlg .gz-syl-set', { timeout: 60000 }).then(() => true, () => false);
        const name = done ? await page.locator('#gz-syl-dlg .gz-syl-set input[type="text"]').first().inputValue() : '';
        const checks = await page.$$eval('#gz-syl-dlg .gz-syl-check', (xs) => xs.length);
        const note = await page.$$eval('#gz-syl-dlg .gz-syl-issues', (xs) => xs.map((x) => x.textContent).join(' '));
        ok(done && name === want, `${theme} syllabus from ${file}: professor "${name}", ${checks} "Check this"${note ? `, note: ${note}` : ''}`);
        ok(file.endsWith('.pdf') ? !/from a picture/.test(note) : /from a picture/.test(note), `${theme} syllabus from ${file}: the OCR note only for the picture`);
        ok(await frames(page) === 0, `${theme} syllabus from ${file}: the reader's frame is gone`);
        await shot(`${theme}-syllabus-${file.replace(/\W/g, '-')}`, '#gz-syl-dlg');
        await page.keyboard.press('Escape');
      }
      // ---- transcript, in the Dashboard's GPA ----
      for (const file of ['transcript.pdf', 'transcript-photo.jpg']) {
        await open('/');
        await page.locator('.gz-gpa-hist > summary').click();
        await page.getByText('Import from a transcript').click();
        await page.setInputFiles('#gz-gpa [data-f="imp:file"]', path.join(FX, file));
        const done = await page.waitForSelector('#gz-gpa .gz-gpa-review', { timeout: 60000 }).then(() => true, () => false);
        const terms = await page.$$eval('#gz-gpa .gz-gpa-review legend', (ls) => ls.map((l) => l.textContent));
        const grades = await page.$$eval('#gz-gpa .gz-gpa-review input[data-f$=":g"]', (is) => is.map((i) => i.value));
        const text = await page.locator('#gz-gpa .gz-gpa-review').textContent();
        ok(done && terms.length === 3 && grades.length === 10, `${theme} transcript from ${file}: terms ${terms.join(', ')}; grades ${grades.join(' ')}`);
        ok(file.endsWith('.pdf') ? !/from a picture/.test(text) : /from a picture/.test(text), `${theme} transcript from ${file}: the OCR note only for the picture`);
        ok(await frames(page) === 0, `${theme} transcript from ${file}: the reader's frame is gone`);
        await shot(`${theme}-transcript-${file.replace(/\W/g, '-')}`, '#gz-gpa');
      }
    }

    // ---- stopping, closing, a locked PDF ----
    await set(look('Paper'));
    await schedule('transcript-scan.pdf');
    await page.waitForFunction(() => document.querySelectorAll('iframe[src*="reader.html"]').length === 1, null, { timeout: 10000 }).catch(() => {});
    const during = await frames(page);
    await page.getByRole('button', { name: 'Stop reading' }).click();
    await page.waitForTimeout(300);
    ok(during === 1 && await frames(page) === 0 && /Stopped/.test(await page.locator('#gz-cl .gz-cl-say').textContent()), `Stop reading: the frame (${during} while reading) is gone, "Stopped."`);
    await page.getByRole('button', { name: 'Read schedule' }).click();
    await page.waitForFunction(() => document.querySelectorAll('iframe[src*="reader.html"]').length === 1, null, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok(await frames(page) === 0 && !(await page.$('#gz-cl')), 'Escape while reading closes the dialog and the reader goes with it');
    await schedule('locked.pdf');
    await page.waitForFunction(() => /password/.test(document.querySelector('#gz-cl .gz-cl-say')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    ok(/protected by a password/.test(await page.locator('#gz-cl .gz-cl-say').textContent()), `a locked PDF: "${await page.locator('#gz-cl .gz-cl-say').textContent()}"`);
    await page.keyboard.press('Escape');

    // ---- by keyboard: the import step's order, and Stop reading in focus while it reads ----
    await open('/');
    await palette('Class schedule');
    await page.getByRole('button', { name: 'Import a schedule' }).press('Enter');
    const order = [];
    for (let i = 0; i < 5; i++) {
      order.push(await page.evaluate(() => { const a = document.activeElement; return `${a.tagName.toLowerCase()}${a.type ? `[${a.type}]` : ''}${a.tagName === 'BUTTON' ? `:${a.textContent}` : ''}`; }));
      await page.keyboard.press('Tab');
    }
    ok(order.join(' → ') === 'input[file] → textarea[textarea] → input[url] → button[button]:Read schedule → button[button]:Back', `keyboard order: ${order.join(' → ')}`);
    await page.setInputFiles('#gz-cl input[type="file"]', path.join(FX, 'transcript-scan.pdf'));
    await page.getByRole('button', { name: 'Read schedule' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('iframe[src*="reader.html"]').length === 1, null, { timeout: 10000 }).catch(() => {});
    const stopFocused = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.activeElement?.textContent);
    ok(stopFocused === 'Stop reading' && after === 'Read schedule' && await frames(page) === 0, `keyboard: Enter on Read schedule puts "${stopFocused}" in focus, Enter there stops it, focus back on "${after}"`);
    await page.keyboard.press('Escape');

    // ---- a screenshot pasted into the schedule's text box ----
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await open('/');
    await palette('Class schedule');
    await page.getByRole('button', { name: 'Import a schedule' }).click();
    const png = fs.readFileSync(path.join(FX, 'timetable.png')).toString('base64');
    const copied = await page.evaluate(async (b64) => {
      const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' });
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); return true; } catch (e) { return String(e); }
    }, png);
    await page.locator('#gz-cl textarea').focus();
    await page.keyboard.press('ControlOrMeta+KeyV');
    const pasted = await reviewed('#gz-cl .gz-cl-entry', 5);
    ok(copied === true && pasted, `a pasted screenshot is read: ${copied === true ? (pasted ? 'five classes' : 'nothing read') : `clipboard unavailable here (${copied})`}`);
    await page.keyboard.press('Escape');

    // ---- the import step's words in the six languages ----
    const label = 'A file: .ics calendar, PDF, picture or screenshot, saved web page (.html), Word (.docx) or text';
    for (const lang of ['en', 'de', 'es', 'fr', 'nl', 'pt-BR']) {
      await open(`/?glaze_lang=${lang}`);
      await page.keyboard.press('ControlOrMeta+KeyK');
      await page.getByRole('combobox').fill(I.t('Class schedule', {}, lang));
      await page.keyboard.press('Enter');
      await page.locator('#gz-cl .gz-cl-import').click();
      const got = await page.locator('#gz-cl .gz-cl-field > span').first().textContent();
      ok(got === I.t(label, {}, lang), `${lang}: "${got}"`);
      await page.keyboard.press('Escape');
    }

    // ---- a site framing the reader itself, with no pass: nothing is read ----
    await open('/');
    const framed = await page.evaluate((src) => new Promise((resolve) => {
      const f = Object.assign(document.createElement('iframe'), { src });
      f.onload = () => {
        const ch = new MessageChannel();
        const quiet = setTimeout(() => resolve('no answer'), 3000);
        ch.port1.onmessage = ({ data }) => { clearTimeout(quiet); resolve(data.type); };
        f.contentWindow.postMessage({ type: 'glaze:read', pass: crypto.randomUUID(), file: new File(['%PDF-1.7'], 'x.pdf'), kind: 'pdf' }, '*', [ch.port2]);
      };
      document.body.append(f);
    }), `chrome-extension://${id}/reader.html`);
    ok(framed === 'no answer', `a site that frames the reader itself, with a pass it made up, gets ${framed}`);

    // ---- the reader's own accuracy on the pictures, decoded by the browser ----
    // One reader per file, each with a pass put in the worker's list for its tab (as an import's content script asks).
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || await ctx.waitForEvent('serviceworker');
    for (const f of Object.keys(SCORE).filter((x) => fs.existsSync(path.join(FX, x)))) {
      const reader = await ctx.newPage();
      await reader.goto(`chrome-extension://${id}/reader.html`);
      const tab = await reader.evaluate(() => chrome.tabs.getCurrent().then((t) => t.id));
      const pass = crypto.randomUUID();
      await sw.evaluate(([p, t]) => readerPasses.set(p, { tab: t, at: Date.now() }), [pass, tab]);
      const at = Date.now();
      const r = await reader.evaluate(([b64, name, p]) => new Promise((resolve) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const ch = new MessageChannel();
        ch.port1.onmessage = ({ data }) => { if (data.type !== 'progress') resolve(data); };
        window.postMessage({ type: 'glaze:read', pass: p, file: new File([bytes], name), kind: GZ_DOCTEXT.kind(name, '', bytes.subarray(0, 16)), langs: [] }, '*', [ch.port2]);
      }), [fs.readFileSync(path.join(FX, f)).toString('base64'), f, pass]);
      const s = SCORE[f](r.text || '');
      console.log(`     browser: ${f}: ${s.ok}/${s.of} = ${Math.round((s.ok / s.of) * 100)}%, extra ${s.extra}${r.ocr ? `, OCR confidence ${r.ocr.conf}, unsure lines ${r.ocr.unsure.length}` : ''}, ${Date.now() - at} ms`);
      await reader.close();
    }

    ok(!away.length, `the reader and its workers asked for nothing but the extension's own files${away.length ? `: ${[...new Set(away)].join(', ')}` : ''}${canvasAway.size ? ` (Canvas's own pages asked ${[...canvasAway].join(', ')}, refused)` : ''}`);
    ok(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
    console.log(`Screenshots in ${out}`);
  } finally {
    await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
