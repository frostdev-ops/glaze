// The widget builder and declarative widgets in the real unpacked extension, headless: a widget with no code is built in the
// editor (blocks, data pickers, a live preview from the student's own data), saved, exported as a signed .glazemod and copied
// as a code; then it is drawn on a local Ultra-shaped page under a strict and a permissive page policy, its button goes to the
// next to-do, revoking its grant takes the data away at once, and turning it off removes it. The page side then runs again
// from the Safari-staged package (no sandbox page, no mods/ folder, no features/mods.js), the build Firefox and Safari get.
// Loopback HTTPS only (macOS sandbox-exec denies everything else). NODE_PATH must name an existing Playwright installation.
//   NODE_PATH=/path/to/node_modules nice -n 10 node scripts/widgets-builder-check.js
// One headless browser at a time across agents: it waits while another runs. Its profiles, staging and server go when it is done.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https');
const { execFileSync } = require('node:child_process');
const { createHash, X509Certificate } = require('node:crypto');
// The local LMS (https://127.0.0.1) stands in the staged copy's host_permissions: the student's grant on the narrow manifest.
const ext = require('./check-env.js').staged(path.resolve(process.env.EXT || path.join(__dirname, '..')), ['https://127.0.0.1/*']);
const chrome = require('./check-env.js').chromePath() || chromium.executablePath();
const M = require(path.join(ext, 'lib/modbundle.js'));
const W = require(path.join(ext, 'lib/widgets.js'));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 12000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timeout: ${label}`); await delay(100); }
};
let fails = 0;
const ok = (c, m, detail = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${c ? '' : `  ${String(detail).slice(0, 400)}`}`); if (!c) fails++; };

const SHELL = `<!doctype html><html lang="en"><head><base href="/ultra/"><meta charset="utf-8"><title>Local LMS</title><style>
body{margin:0;font:14px system-ui}.MuiDrawer-paper{position:fixed;inset:0 auto 0 0;width:200px;background:#262626}.MuiDrawer-paper a{display:block;padding:10px 24px;color:#fff}
main{margin-left:200px;padding:20px}article{display:inline-block;width:240px;height:160px;border:1px solid #ccc;margin:8px;vertical-align:top}</style></head><body><div id="site-wrap">
<div class="MuiPaper-root MuiDrawer-paper"><nav class="makeStylesnavigation-1-2-3"><ul style="list-style:none;margin:0;padding:24px 0">
<li><a class="MuiButtonBase-root MuiListItemButton-root" href="/ultra/course">Courses</a></li><li><a class="MuiButtonBase-root MuiListItemButton-root" href="/ultra/calendar">Calendar</a></li></ul></nav></div>
<main id="main-content"><h1 id="main-heading">Courses</h1>
<article id="course-list-course-_1_1" data-course-id="_1_1" class="course-element-card"><h4 class="course-title">Biology</h4></article>
</main></div></body></html>`;

(async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-widgets-builder-')));
  let context, lms, deadline;
  const launch = async (extPath, profile) => {
    const wrapper = path.join(tmp, 'chrome'), q = (v) => `'${v.replaceAll("'", "'\\''")}'`;
    fs.writeFileSync(path.join(tmp, 'net.sb'), '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))');
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${q(path.join(tmp, 'net.sb'))} ${q(chrome)} "$@"\n`, { mode: 0o700 });
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, { executablePath: wrapper, headless: true, viewport: { width: 1280, height: 900 }, acceptDownloads: true, locale: 'en-US', args: [
      `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`, `--ignore-certificate-errors-spki-list=${spki}`, '--disable-background-networking', '--disable-component-update', '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    context.setDefaultTimeout(10000);
    const logs = [];
    context.on('page', (p) => { p.on('pageerror', (e) => logs.push(`pageerror ${e.message}`)); p.on('crash', () => logs.push('CRASH')); });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    return { sw, logs, id: new URL(sw.url()).host };
  };
  let spki, origin;
  try {
    const key = path.join(tmp, 'k'), cert = path.join(tmp, 'c');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    const tls = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
    spki = createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    const hits = [];
    lms = https.createServer(tls, (req, res) => {
      hits.push(req.url);
      if (req.url.includes('/api/')) { res.setHeader('content-type', 'application/json'); res.end('{"results":[]}'); return; }
      if (req.url.includes('strict')) res.setHeader('content-security-policy', "default-src 'self'; script-src 'none'; frame-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'");
      res.setHeader('content-type', 'text/html');
      res.end(SHELL);
    });
    await new Promise((r) => lms.listen(0, '127.0.0.1', r));
    origin = `https://127.0.0.1:${lms.address().port}`;
    deadline = setTimeout(() => { console.log('FAIL timed out after 300 s'); context?.close().catch(() => {}); }, 300000);

    // What the student's browser already holds from their school: the planner, Insights and the courses Glaze has seen.
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const HOUR = 36e5, now = Date.now();
    const seed = async (sw, over = {}) => sw.evaluate(async ({ origin, now, over }) => {
      await chrome.storage.local.clear();
      await chrome.storage.sync.set({ enabled: true, enhance: {}, motion: { level: 'subtle' } });
      await chrome.storage.local.set({ ultra: [origin],
        todoCache: { key: `todo:${origin}/5`, at: now, items: [
          { type: 'assignment', id: '9', cid: '_1_1', course: 'Biology', title: 'Lab report', at: now + 3 * 36e5, url: '/ultra/stream/assignment/9' },
          { type: 'assignment', id: '10', cid: '_2_1', course: 'History', title: 'Essay outline', at: now + 30 * 36e5, url: '/ultra/stream/assignment/10' },
          { type: 'assignment', id: '11', cid: '_1_1', course: 'Biology', title: 'Old quiz', at: now - 5 * 36e5, url: '/ultra/stream/assignment/11' },
        ] },
        [`insights:${origin}/5`]: { at: now, courses: [{ id: '_1_1', name: 'Biology', trend: [[now - 1e6, 91.5]] }, { id: '_2_1', name: 'History', trend: [[now - 1e6, 84]] }] },
        seenCourses: { _1_1: { name: 'Biology', site: origin, code: 'BIO' }, _2_1: { name: 'History', site: origin, code: 'HIS' } }, ...over });
    }, { origin, now, over });
    const tree = async (page) => {
      const cdp = await context.newCDPSession(page);
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const all = [];
      const walk = (n, shadow) => { all.push({ ...n, shadow }); for (const c of n.children || []) walk(c, shadow); for (const s of n.shadowRoots || []) walk(s, s.shadowRootType); if (n.contentDocument) walk(n.contentDocument, shadow); };
      walk(root, null);
      const attr = (n, k) => { const a = n.attributes || []; const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
      const text = (n) => (n.nodeType === 3 ? n.nodeValue : (n.children || []).map(text).join(''));
      // The box of a node found above, asked of a session of its own (this one is let go).
      const box = async (n) => {
        const again = await context.newCDPSession(page);
        await again.send('DOM.getDocument', { depth: -1, pierce: true });
        const { model } = await again.send('DOM.getBoxModel', { backendNodeId: n.backendNodeId }).finally(() => again.detach().catch(() => {}));
        const c = model.content;
        return { x: (c[0] + c[2]) / 2, y: (c[1] + c[5]) / 2, w: model.width, h: model.height };
      };
      await cdp.detach().catch(() => {});
      return { all, attr, text, box, inClosed: (n) => n.shadow === 'closed', strings: () => all.filter((n) => n.nodeType === 3 && n.shadow === 'closed').map((n) => n.nodeValue.trim()).filter(Boolean) };
    };
    const inPage = (sw, page, func) => sw.evaluate(`(async () => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url === ${JSON.stringify(page.url())});
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ${String(func)} }).catch((e) => [{ result: String(e) }]);
      return r.result;
    })()`);

    // =============================== the editor ===============================
    let first = await launch(ext, path.join(tmp, 'profile-a'));
    let { sw, logs, id } = first;
    await seed(sw);
    const editor = await context.newPage();
    editor.on('pageerror', (e) => logs.push(`editor pageerror ${e.message}`));
    editor.on('dialog', (d) => d.accept());
    await editor.goto(`chrome-extension://${id}/options.html#mods/widget`);
    await editor.waitForSelector('#wb-blocks .wb-block');
    const local = (keys) => editor.evaluate((k) => chrome.storage.local.get(k), keys);
    const preview = async () => { const t = await tree(editor); return t.strings().join(' | '); };
    const block = (i) => editor.locator(`.wb-block[data-block="${i}"]`);
    ok(await editor.evaluate(() => !document.getElementById('panel-mods').hidden && document.getElementById('heading-mods-widget') !== null), 'the Widget builder is in the Mods tab');
    ok(await editor.evaluate(() => document.getElementById('wb-author').value === 'Me' && document.getElementById('wb-tile').checked && !document.getElementById('wb-rail').checked), 'it starts as a medium tile, authored by "Me"');
    ok((await editor.locator('.wb-block').count()) === 2, 'two starter blocks: a text with a data hole and a countdown');

    // The preview shows the student's own data from this device, in a closed root.
    const live = await until(async () => { const p = await preview(); return /Next: Lab report/.test(p) && p; }, 'preview of the next to-do');
    ok(/Next: Lab report/.test(live), `the preview fills the data hole with the next to-do: ${live}`);
    ok((await editor.innerText('#wb-data')).includes(`Your own data from ${new URL(origin).host}, shown on this device only.`), 'and says whose data it is');
    ok((await tree(editor)).all.some((n) => n.shadow === 'closed' && n.nodeName === 'DIV'), 'the preview is in a closed shadow root');

    // Add a number, a list and a button; bind them with the picker.
    for (const type of ['number', 'list', 'button', 'number']) {
      await editor.selectOption('#wb-add-type', type);
      await editor.click('#wb-add');
    }
    ok((await editor.locator('.wb-block').count()) === 6, 'blocks are added from the list');
    ok(await block(2).locator('select').first().inputValue() === 'todo.count', 'a number block starts bound to the open to-dos');
    await block(2).getByLabel('Unit').fill('left');
    const shown = await until(async () => { const p = await preview(); return /3 left/.test(p) && p; }, 'number in the preview');
    ok(/3 left/.test(shown), `a number block shows the count of open to-dos (three, one of them past due) with its unit: ${shown}`);
    await block(3).getByLabel('How many').fill('2');
    const rows = await until(async () => { const p = await preview(); return /Old quiz · Biology/.test(p) && /Lab report · Biology/.test(p) && !/Essay outline/.test(p) && p; }, 'list cut to two rows in the preview');
    ok(!/Essay outline/.test(rows), `a list shows at most the rows asked for, soonest first: ${rows}`);
    // The data picker offers allowlisted paths only.
    const options = await block(2).locator('select').first().locator('option').allTextContents();
    ok(options.includes('To-dos still open') && options.includes('A number I type') && !options.some((o) => /url|note|password|secret/i.test(o)), `the picker offers Glaze's own paths: ${options.join(', ')}`);
    // A hole is inserted where the cursor is.
    await block(0).getByLabel('Insert data into the text').selectOption('next.course');
    ok((await block(0).locator('textarea').inputValue()).endsWith('{next.course}'), 'a hole is added from the picker to the text');
    await block(0).locator('textarea').fill('Next: {next.title} ({next.course})');
    // A block missing something is named, the preview waits, and saving refuses.
    await block(0).locator('textarea').fill('');
    await until(() => block(0).locator('.mod-warn').isVisible(), 'the missing-something message');
    ok(await block(0).locator('.mod-warn').isVisible(), 'an empty text block says it is missing something');
    await editor.fill('#wb-name', 'Due Soon');
    await editor.fill('#wb-author', 'Kai');
    await editor.click('#wb-save');
    ok(/Some blocks are missing something\./.test(await until(() => editor.innerText('#wb-said'), 'refusal said')) && !(await local('mods')).mods, 'saving is refused while a block is incomplete, and nothing is installed');
    await block(0).locator('textarea').fill('Next: {next.title} ({next.course})');
    await block(0).getByLabel('Size').selectOption('l');
    await block(4).getByLabel('Button text').fill('Open it');
    // A second number, bound to the grade point average (the worker reads Insights' record for it).
    await block(5).locator('select').first().selectOption('grades.gpa');
    await block(5).getByLabel('Label').fill('GPA');
    await block(5).getByLabel('Decimals').fill('2');
    // A ring of the to-dos done out of all of them, and a picture the student adds from a file.
    for (const type of ['ring', 'image']) {
      await editor.selectOption('#wb-add-type', type);
      await editor.click('#wb-add');
    }
    ok((await block(7).innerText()).includes('No picture yet'), 'an image block starts without a picture');
    await block(6).getByLabel('Label').fill('Done');
    await editor.click('#wb-save');
    ok(/Some blocks are missing something\./.test(await until(() => editor.innerText('#wb-said'), 'image refused')) && !(await local('mods')).mods, 'an image block cannot be saved until it has a picture');
    await block(7).locator('input[type=file]').setInputFiles({ name: 'leaf.png', mimeType: 'image/png', buffer: PNG });
    await block(7).getByLabel('Describe it').fill('A leaf');
    await block(7).getByLabel('Width in pixels').fill('24');
    await until(() => block(7).innerText().then((x) => x.includes('leaf.png') || /picture-\d+\.png/.test(x)), 'the picture chosen');
    // It shows in the navigation too.
    await editor.check('#wb-rail');
    // Its reasons for the data, in words the person installing it will see.
    await editor.waitForSelector('#wb-why-grades');
    ok((await editor.locator('#wb-reasons input').count()) === 2 && /To Do/.test(await editor.innerText('#wb-reasons')) && /Grades/.test(await editor.innerText('#wb-reasons')), 'it asks for a reason for each kind of data its blocks use: to-dos and grades');
    await editor.fill('#wb-why-todo', 'Shows what is due next.');
    await editor.fill('#wb-why-grades', 'Shows my grade point average.');
    const gpa = await until(async () => { const p = await preview(); return /3\.35/.test(p) && p; }, 'GPA in the preview');
    ok(/GPA/.test(gpa), `the preview works out the grade point average from Insights' grades: ${gpa}`);

    // Save: signed with a new author key, installed without a prompt.
    await editor.click('#wb-save');
    const said = await until(async () => { const s = await editor.innerText('#wb-said'); return /Installed Due Soon\./.test(s) && s; }, 'saved');
    ok(/Made your author key/.test(said), `saving makes the author key and says to back it up: ${said}`);
    const { mods } = await local('mods');
    ok(mods?.length === 1, 'one mod is installed');
    const mid = mods[0];
    const rec = (await local(`mod:${mid}`))[`mod:${mid}`];
    const author = (await local('modAuthor')).modAuthor;
    ok(rec.source === 'builder' && rec.dev === false && rec.key === author.x && rec.version === '1.0.0' && rec.enabled === true, 'a signed local mod from the builder, by the student\'s key', JSON.stringify({ s: rec.source, d: rec.dev, v: rec.version }));
    ok(Object.keys(rec.files).sort().join().replace(/img\/picture-\d+\.png/, 'PNG') === 'PNG,mod.json,mod.sig' && !rec.manifest.hooks && atob(rec.files[rec.manifest.ui.tiles[0].blocks[7].src]) === PNG.toString('latin1'), 'it has no code and no files but its manifest, signature and the picture chosen');
    ok(JSON.stringify(rec.grants) === '{"grades":true,"todo":true}' && rec.manifest.permissions.map((p) => `${p.id}:${p.why}`).join('|') === 'grades:Shows my grade point average.|todo:Shows what is due next.', 'it asked for to-do and grade data with the reasons typed, and the student\'s own grants are on');
    ok(rec.manifest.ui.tiles[0].sizes[0] === 'm' && rec.manifest.ui.rail[0].blocks.length === 8 && rec.manifest.ui.tiles[0].blocks.length === 8, 'a medium tile and a navigation widget of the same eight blocks');

    // The Mods tab: the card says the data stays here, and opens the builder again.
    await editor.goto(`chrome-extension://${id}/options.html#mods/installed`);
    const card = await until(async () => { const t = await editor.innerText('.mod-card').catch(() => ''); return /Due Soon/.test(t) && t; }, 'installed card');
    ok(/To Do — shows your to-dos and due dates, on this device only\./.test(card) && /Grades — shows your grades and GPA, on this device only\./.test(card) && /Made in the widget builder/.test(card) && !/Needs Chrome|Its code runs only in Chrome/.test(card), 'the card says the data is shown on this device only, and does not call it Chrome-only code', card);
    await editor.click('.mod-card button:has-text("Edit in the widget builder")');
    await until(() => editor.evaluate(() => document.getElementById('wb-name').value === 'Due Soon' && document.querySelectorAll('.wb-block').length === 8), 'builder opened with the widget');
    const reopened = await editor.evaluate(() => ({ why: document.getElementById('wb-why-todo')?.value, author: document.getElementById('wb-author').value, top: document.getElementById('heading-mods-widget').getBoundingClientRect().top, focus: document.activeElement.id }));
    ok(reopened.why === 'Shows what is due next.' && reopened.author === 'Kai' && reopened.top >= 0 && reopened.top < 600 && reopened.focus === 'wb-name', 'the widget opens in the builder again with its reasons, the builder in view', JSON.stringify(reopened));

    // Export: the same widget, a higher version, as a signed .glazemod anyone can read.
    const [download] = await Promise.all([editor.waitForEvent('download'), editor.click('#wb-export')]);
    const exported = fs.readFileSync(await download.path());
    const got = await M.read(new Uint8Array(exported));
    ok(download.suggestedFilename() === 'due-soon.glazemod' && got.signed && got.key === author.x && got.version === '1.0.1' && got.id === mid, 'exporting saves the next version and downloads it signed by the same key', `${download.suggestedFilename()} ${got.version}`);
    ok(Object.keys(got.files).sort().join().replace(/img\/picture-\d+\.png/, 'PNG') === 'PNG,mod.json,mod.sig' && M.caps(got.manifest).join() === 'grades,todo', 'the file holds only its manifest, signature and picture, and asks for to-dos and grades');
    ok((await local(`mod:${mid}`))[`mod:${mid}`].version === '1.0.1' && (await local(`mod:${mid}`))[`mod:${mid}`].updatedAt > 0, 'and the installed copy is that version, quietly updated');
    await editor.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.copied = t; } }, configurable: true }); });
    await editor.click('#wb-copy');
    const code = await until(() => editor.evaluate(() => window.copied), 'a copied code');
    const fromCode = await M.read(await M.decode(code));
    ok(fromCode.id === mid && fromCode.version === '1.0.2' && fromCode.signed, 'copying makes a glazemod1: code of the saved version, which reads back signed');
    // A block is removed from the form.
    await editor.selectOption('#wb-add-type', 'text');
    await editor.click('#wb-add');
    ok((await editor.locator('.wb-block').count()) === 9, 'a block is added');
    await editor.locator('.wb-block[data-block="8"] button:has-text("Remove")').click();
    ok((await editor.locator('.wb-block').count()) === 8, 'and removed');

    // The same widget, offered from a file, goes through the install prompt, which says what a widget with no code means.
    const file = path.join(tmp, 'due-soon.glazemod');
    fs.writeFileSync(file, await M.decode(code));
    await editor.evaluate(async (id) => { await chrome.runtime.sendMessage({ type: 'glaze:mods', op: 'remove', id }); }, mid);
    await editor.goto(`chrome-extension://${id}/options.html#mods/add`);
    await editor.setInputFiles('#mod-file', file);
    await until(() => editor.evaluate(() => document.getElementById('mod-prompt').open), 'the install prompt');
    const prompt = await editor.innerText('#mod-prompt');
    ok(/Install Due Soon\?/.test(prompt) && /From a file/.test(prompt), 'a widget file opens the install prompt', prompt);
    ok(prompt.includes('It has no code. Glaze draws it itself, so what it shows stays on this device:') && !prompt.includes('It asks for:'), 'the prompt says it has no code and what it shows stays on this device', prompt);
    ok(prompt.includes('To Do — shows your to-dos and due dates, on this device only.') && prompt.includes('Grades — shows your grades and GPA, on this device only.') && /The author says:\s*“?Shows my grade point average\.”?/.test(prompt), 'each data line says it is shown on this device only, with the author\'s reason quoted', prompt);
    ok(!/Chrome|could send|page of its own|Unsigned/.test(await editor.innerText('#mod-prompt-warn')) && /Not reviewed/.test(prompt), 'and none of the code mod warnings: only that nobody reviewed it', await editor.innerText('#mod-prompt-warn'));
    await editor.click('#mod-prompt-install');
    await until(async () => (await local(`mod:${mid}`))[`mod:${mid}`], 'installed from the prompt');
    const again = (await local(`mod:${mid}`))[`mod:${mid}`];
    ok(again.source === 'file' && JSON.stringify(again.grants) === '{"grades":true,"todo":true}' && again.version === '1.0.2', 'Install grants what the prompt showed', JSON.stringify([again.source, again.grants, again.version]));

    // =============================== the page ===============================
    // The tile is placed on the floating surface the way "Float over every page" does.
    // Store the complete layout the board saves, including its mod tile catalogue. The fresh staged profile's worker
    // normalizes old/incomplete layouts before page-side declarations arrive; boards alone cannot declare a mod tile.
    const layout = W.layout({ boards: { pages: [{ id: `m${mid.slice(0, 14)}0`, on: true, size: 'm' }] } },
      { [`m${mid.slice(0, 14)}0`]: { size: 'm' } });
    await sw.evaluate((l) => chrome.storage.local.set({ widgetLayout: l }), layout);
    const record = (await local(`mod:${mid}`))[`mod:${mid}`];
    const trust = (await local(`modTrust:${mid}`))[`modTrust:${mid}`];
    await editor.close();

    const pageChecks = async (label, sw, logs, modes) => {
      for (const mode of modes) {
        console.log(`-- ${label}, ${mode} page policy`);
        const page = await context.newPage();
        await page.goto(`${origin}/ultra/course?${mode}`);
        const t = await until(async () => { const x = await tree(page); return x.strings().includes('Next: Lab report (Biology)') && x; }, 'the tile drawn');
        const lines = t.strings();
        ok(true, `${label}: the tile shows the next to-do from the student's own data (${lines.join(' | ')})`);
        ok(lines.includes('3 left') && lines.includes('To-dos left'), `${label}: the number block counts the open to-dos`, lines.join('|'));
        ok(lines.includes('3.35') && lines.includes('GPA'), `${label}: and the GPA is worked out in the worker from Insights' grades (A- and B, equally weighted)`, lines.join('|'));
        const rail = await until(async () => { const x = await tree(page); const r = x.all.find((n) => n.nodeName === 'DIV' && /gz-mod-rail/.test(x.attr(n, 'class') || '')); return r && x; }, 'the rail widget', 6000).catch(() => null);
        ok(!!rail && rail.strings().filter((s) => s === 'Next: Lab report (Biology)').length === 2, `${label}: the navigation widget shows the same blocks, drawn in a closed root`, rail ? rail.strings().join('|') : 'no rail widget');
        ok(lines.some((s) => s.startsWith('Old quiz · Biology')) && lines.some((s) => s.startsWith('Lab report · Biology')) && !lines.some((s) => s.startsWith('Essay outline')), `${label}: the list shows two rows, soonest first`);
        ok(t.all.some((n) => n.nodeName === 'SPAN' && t.attr(n, 'role') === 'timer' && /\d/.test(t.text(n))), `${label}: the countdown counts to the next to-do`);
        ok(t.all.some((n) => t.attr(n, 'role') === 'progressbar' && t.attr(n, 'aria-label') === 'Done' && t.attr(n, 'aria-valuemax') === '3' && t.attr(n, 'aria-valuenow') === '0'), `${label}: the ring shows the to-dos done out of all of them, for screen readers too`);
        const leaf = await until(async () => { const x = await tree(page); const n = x.all.find((c) => c.nodeName === 'CANVAS' && x.attr(c, 'aria-label') === 'A leaf'); return n && { x, n }; }, 'the picture', 6000).catch(() => null);
        ok(!!leaf && leaf.n.shadow === 'closed' && leaf.x.attr(leaf.n, 'role') === 'img' && (await leaf.x.box(leaf.n)).w === 24, `${label}: the mod's own picture is drawn on a canvas, labelled, 24 pixels wide`);
        const button = t.all.find((n) => n.nodeName === 'BUTTON' && t.text(n) === 'Open it');
        ok(!!button && button.shadow === 'closed' && !t.attr(button, 'disabled'), `${label}: the button is there, in a closed root`);
        ok(await page.evaluate(() => document.querySelectorAll('iframe').length === 0 && frames.length === 0), `${label}: the page has no frame of Glaze's for it`);
        ok(await inPage(sw, page, () => typeof GZ_MODS === 'undefined' && GZ_MODWIDGETS.stats().list.length === 1 && GZ_MODWIDGETS.stats().mounts.length === 2), `${label}: only the widget side runs (GZ_MODS is not even loaded)`);
        const at = await t.box(button);
        await page.mouse.click(at.x, at.y);
        await page.waitForURL(`${origin}/ultra/stream/assignment/9`, { timeout: 8000 });
        await until(async () => (await tree(page)).strings().includes('Next: Lab report (Biology)'), 'the tile on the next page');
        ok(true, `${label}: the button goes to the next to-do's page on this site, where the tile is too`);
        await page.goto(`${origin}/ultra/course?${mode}`);
        await until(async () => (await tree(page)).strings().includes('Next: Lab report (Biology)'), 'tile again');
        if (mode === modes.at(-1)) {
          // Revoking one grant takes that data away at once and leaves the other.
          await sw.evaluate(async (id) => { const k = `mod:${id}`; const r = (await chrome.storage.local.get(k))[k]; await chrome.storage.local.set({ [k]: { ...r, grants: { todo: true } } }); }, mid);
          const half = await until(async () => { const x = await tree(page); return !x.strings().includes('3.35') && x.strings().includes('Next: Lab report (Biology)') && x; }, 'grades gone, to-dos kept');
          ok(!half.strings().includes('GPA'), `${label}: with only the grades grant revoked the GPA goes and the to-dos stay`);
          await sw.evaluate(async (id) => { const k = `mod:${id}`; const r = (await chrome.storage.local.get(k))[k]; await chrome.storage.local.set({ [k]: { ...r, grants: {} } }); }, mid);
          const gone = await until(async () => { const x = await tree(page); return x.strings().includes('Next: – (–)') && x; }, 'data gone after revoking');
          ok(!gone.strings().some((s) => /Lab report|Old quiz|Essay/.test(s)) && !gone.all.some((n) => n.nodeName === 'SPAN' && gone.attr(n, 'role') === 'timer'), `${label}: with the grant revoked the tile shows none of the data`);
          const disabled = gone.all.find((n) => n.nodeName === 'BUTTON' && gone.text(n) === 'Open it');
          ok(!!disabled && gone.attr(disabled, 'disabled') !== null, `${label}: and its button is off`);
          await sw.evaluate(async (id) => { const k = `mod:${id}`; const r = (await chrome.storage.local.get(k))[k]; await chrome.storage.local.set({ [k]: { ...r, grants: { todo: true, grades: true } } }); }, mid);
          await until(async () => (await tree(page)).strings().includes('3.35'), 'data back after granting');
          ok(true, `${label}: granting it again brings the data back`);
          // New data from the school shows without a reload.
          await sw.evaluate(async (now) => {
            const { todoCache } = await chrome.storage.local.get('todoCache');
            await chrome.storage.local.set({ todoCache: { ...todoCache, items: [{ type: 'assignment', id: '12', cid: '_1_1', course: 'Biology', title: 'Poster', at: now + 2 * 36e5, url: '/ultra/stream/assignment/12' }, ...todoCache.items] } });
          }, Date.now());
          await until(async () => (await tree(page)).strings().includes('Next: Poster (Biology)'), 'new to-do shown');
          ok(true, `${label}: a new to-do read from the school shows without reloading`);
          // Turned off, the tile goes.
          await sw.evaluate(async (id) => { const k = `mod:${id}`; const r = (await chrome.storage.local.get(k))[k]; await chrome.storage.local.set({ [k]: { ...r, enabled: false } }); }, mid);
          await until(async () => !(await tree(page)).strings().some((s) => s.startsWith('Next:')), 'tile gone when off');
          ok(true, `${label}: turned off mid-run, the tile goes`);
        }
        ok(!logs.includes('CRASH') && !logs.some((l) => /pageerror/.test(l)), `${label}: no page crashed or threw`, logs.join('\n'));
        await page.close();
      }
    };
    await pageChecks('Chrome package', sw, logs, ['strict', 'permissive']);
    await context.close();
    context = null;

    // ========= the package Firefox and Safari get: no sandbox, no code mods' files =========
    const dist = path.join(tmp, 'dist'), stage = path.join(tmp, 'stage');
    fs.mkdirSync(dist);
    execFileSync('sh', ['package.sh'], { cwd: ext, env: { ...process.env, DIST: dist }, stdio: 'pipe' });
    execFileSync('unzip', ['-q', path.join(dist, fs.readdirSync(dist).find((f) => f.endsWith('.zip'))), '-d', stage]);
    execFileSync('sh', [path.join(ext, 'scripts/safari-manifest.sh'), path.join(stage, 'manifest.json')]);
    ok(!fs.existsSync(path.join(stage, 'mods')) && !fs.existsSync(path.join(stage, 'features/mods.js')) && fs.existsSync(path.join(stage, 'features/modwidgets.js')) && fs.existsSync(path.join(stage, 'features/modui.js'))
      && JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8')).sandbox === undefined, 'the staged package has no sandbox page, no mods/ folder and no features/mods.js, and keeps the widget side and its renderer');
    const second = await launch(stage, path.join(tmp, 'profile-b'));
    await seed(second.sw, { widgetLayout: layout, mods: [mid], [`mod:${mid}`]: record, [`modTrust:${mid}`]: trust });
    ok(await second.sw.evaluate(() => !chrome.runtime.getManifest().sandbox), 'this browser has no manifest sandbox, so code mods could not run here');
    await pageChecks('no-sandbox package', second.sw, second.logs, ['permissive']);
  } catch (e) {
    fails++;
    console.error(e.stack);
  } finally {
    clearTimeout(deadline);
    await context?.close().catch(() => {});
    lms?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`Cleanup: owned browser, listener and profiles removed. ${fails ? `${fails} FAILED` : 'all passed'}`);
    process.exitCode = fails ? 1 : 0;
  }
})();
