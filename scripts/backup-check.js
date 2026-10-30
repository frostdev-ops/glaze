// Back up… and Restore… (Settings → Privacy and data → Backup and reset) against the unpacked extension: one marker in each
// local category goes into a real download, and a new profile restores it through the restore list: its labels, keyboard
// use and a 320px width, Cancel changing nothing, then every marker back. External requests are blocked; no school or user
// profile. EXT selects the checkout under test; the folder argument keeps the list's screenshots, light and dark.
// NODE_PATH=<playwright> nice -n 10 node scripts/backup-check.js [screenshot folder]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const env = require('./check-env.js'), lock = require('./check-env.js').lockPath(), chromeLaunch = require('./check-env.js').chromeLaunch();
const shots = process.argv[2];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let scratch, held = false, open = null;

// A new profile, installed, on Settings' Backup and reset.
const launch = async (dir) => {
  await require('./wait-for-browser.js')();
  const context = await chromium.launchPersistentContext(dir, {
    ...chromeLaunch, headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--disable-background-networking'],
  });
  open = context;
  env.noFirstRun(context);
  await context.route('**/*', (r) => new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#backup/privacy`);
  await page.waitForFunction(() => document.querySelector('#looks button'));
  await env.installed(page);
  return { context, page };
};

(async () => {
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; }
      catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nbackup-check\n`);
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-backup-check-'));
    const at = Date.now() - 60000, music = 'https://open.spotify.com/playlist/MARKplaylist0000000000';
    const seeds = {
      'notes:https://canvas.test/3': { text: 'MARK-DASHBOARD-NOTE', at },
      'gpaTerms:https://canvas.test:3': { t: [{ id: 'termone', n: 'MARK-PAST-TERM', p: 1, c: [], at }] },
      'classes:https://canvas.test/3': { tz: 'America/New_York', courses: [{ id: '25', name: 'MARK-SCHEDULE', at, periods: [{ days: [1], start: 540, end: 600, loc: 'Room', from: '', to: '', skip: [] }] }] },
      widgetLayout: { music, boards: {}, tiles: [] },
      lookFavorites: [{ code: 'mark-code', name: 'MARK-FAVORITE', at }],
      seenCourses: [{ id: '25', name: 'PRIVATE-LMS-COURSE' }],
      todoCache: { secret: 'PRIVATE-LMS-CACHE' },
      'cardImg:private-card': 'PRIVATE-CARD-PICTURE',
      gcal: { token: 'PRIVATE-CALENDAR-TOKEN' },
      'notesIdx:https://canvas.test/3': { notes: {}, folders: {}, gone: {} },
      'todo:https://canvas.test/3': { tasks: [{ id: 'k1', title: 'MARK-TASK', at }], items: {} },
    };
    const markers = ['MARK-DASHBOARD-NOTE', 'MARK-PAST-TERM', 'MARK-SCHEDULE', 'MARK-FAVORITE', music, 'MARK-TASK'];

    // Back up…, in the first profile.
    let { context, page } = await launch(path.join(scratch, 'first'));
    await page.evaluate((s) => chrome.storage.local.set(s), seeds);
    const secret = await page.evaluate(async () => {
      const send = async (op, rest) => { const r = await chrome.runtime.sendMessage({ type: 'glaze:sessions', op, ...rest }); if (!r.ok) throw new Error(r.error); return r; };
      const key = 'notesIdx:https://canvas.test/3', id = '00000000-0000-4000-8000-000000000001';
      await send('notesImport', { key, json: JSON.stringify({ format: 'glaze-notes', version: 1, site: 'https://canvas.test', folders: [], files: [], notes: [{ id, title: 'MARK-NOTE', html: '<p>MARK-NOTE-BODY</p>', at: Date.now() - 60000 }] }) });
      const share = { ...GZ_SHARING.exportKeys(GZ_SHARING.create('notes')), type: 'collection' };
      await send('importKeys', { keys: [share] });
      return share.del;
    });
    const pending = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await pending;
    assert.match(download.suggestedFilename(), /^glaze-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    const file = path.join(scratch, download.suggestedFilename());
    await download.saveAs(file);
    await context.close(); open = null;
    const zip = require(path.join(root, 'lib/doctext.js')).unzip(new Uint8Array(fs.readFileSync(file)));
    const manifest = await zip.text('glaze-backup.json');
    for (const m of markers) assert.ok(manifest.includes(m), `the backup holds ${m}`);
    for (const value of ['PRIVATE-LMS-COURSE', 'PRIVATE-LMS-CACHE', 'PRIVATE-CARD-PICTURE', 'PRIVATE-CALENDAR-TOKEN', secret]) assert.ok(!manifest.includes(value), 'caches and credentials stay out of the manifest');
    assert.ok((await zip.text('share-keys.json')).includes(secret), 'creator delete tokens are confined to share keys');
    assert.ok((await zip.text('notes/1/notes.json')).includes('MARK-NOTE-BODY'));
    assert.deepEqual(JSON.parse(manifest).notes, [{ account: 'notesIdx:https://canvas.test/3', dir: 'notes/1/' }]);
    console.log('ok the downloaded backup holds every marker');

    // Restore…, in a new profile.
    ({ context, page } = await launch(path.join(scratch, 'fresh')));
    const p = page, dialog = p.locator('#restore-pick'), title = `Restore from ${path.basename(file)}`;
    const stored = () => p.evaluate(() => chrome.storage.local.get(null));
    const pick = async (picked = file) => {
      const chooser = p.waitForEvent('filechooser');
      await p.locator('#import-btn').click();
      await (await chooser).setFiles(picked);
      await p.locator('#restore-pick[open]').waitFor();
    };
    const focused = () => p.evaluate(() => document.activeElement?.closest('label')?.textContent || document.activeElement?.textContent);
    await pick();
    assert.equal(await p.locator('#restore-title').textContent(), title);
    const names = ['Settings and Looks', 'Notes', 'Tasks and pet', 'Dashboard notes', 'Class schedules', 'GPA past terms', 'Widgets', 'Share keys'];
    assert.deepEqual(await p.locator('#restore-cats label').allTextContents(), names, 'the list shows what the file holds, in order');
    for (const name of names) assert.equal(await dialog.getByRole('checkbox', { name, exact: true }).isChecked(), true, `${name} is named by its label, and ticked`);
    assert.equal(await dialog.getByRole('group', { name: title }).count(), 1, 'the list is a group named by its heading');
    console.log('ok the restore list names each category, all ticked');
    // Keyboard: focus starts on the first box; Tab walks the list, then Cancel and Restore; Space unticks.
    assert.equal(await focused(), names[0]);
    const order = [];
    for (let i = 0; i < names.length + 1; i++) { await p.keyboard.press('Tab'); order.push(await focused()); }
    assert.deepEqual(order, [...names.slice(1), 'Cancel', 'Restore']);
    await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab');
    assert.equal(await focused(), 'Widgets');
    await p.keyboard.press('Space');
    assert.equal(await dialog.getByRole('checkbox', { name: 'Widgets', exact: true }).isChecked(), false, 'Space unticks a box');
    console.log('ok the list works from the keyboard');
    for (const width of [1440, 320]) {
      await p.setViewportSize({ width, height: width > 400 ? 1000 : 720 });
      const box = await dialog.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, `the list fits ${width}px (${box.x}..${box.x + box.width})`);
      assert.equal(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth), true, `nothing in the list scrolls sideways at ${width}px`);
      const columns = await p.locator('#restore-cats label').evaluateAll((ls) => new Set(ls.map((l) => Math.round(l.getBoundingClientRect().left))).size);
      assert.equal(columns, width > 400 ? 2 : 1, `${width > 400 ? 'two columns' : 'one column'} at ${width}px`);
      for (const b of await p.locator('#restore-pick button').all()) {
        const r = await b.boundingBox();
        assert.ok(r.x >= 0 && r.x + r.width <= width, `${await b.textContent()} is in view at ${width}px`);
      }
    }
    console.log('ok the list fits 1440px and 320px');
    await p.setViewportSize({ width: 1440, height: 1000 });
    const before = await stored();
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('#restore-pick').open);
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'import-btn', 'focus returns to Restore…');
    await pause(300);
    assert.deepEqual(await stored(), before, 'Cancel changes nothing');
    console.log('ok Escape cancels and changes nothing');
    // Invalid Settings are refused before selecting categories, leaving every store untouched.
    const broken = JSON.parse(manifest); broken.settings.parts = { x: { invalid: true } };
    const parts = await Promise.all(zip.names.map(async (name) => ({ name, data: name === 'glaze-backup.json' ? new TextEncoder().encode(JSON.stringify(broken)) : await zip.bytes(name) })));
    const badFile = path.join(scratch, 'invalid-settings.zip');
    fs.writeFileSync(badFile, new Uint8Array(await new Blob(require(path.join(root, 'lib/zip.js')).zip(parts)).arrayBuffer()));
    const badChooser = p.waitForEvent('filechooser');
    await p.locator('#import-btn').click();
    await (await badChooser).setFiles(badFile);
    await p.waitForFunction(() => /isn't a Glaze backup, or it's damaged/.test(document.querySelector('#hint').textContent));
    assert.equal(await dialog.evaluate((d) => d.open), false, 'invalid categories never reach the checklist');
    assert.deepEqual(await stored(), before, 'an invalid category changes nothing');
    console.log('ok malformed Settings changes nothing before the checklist');
    // Restore by keyboard: Tab to Restore, Enter.
    await pick();
    for (let i = 0; i < names.length + 1; i++) await p.keyboard.press('Tab');
    assert.equal(await focused(), 'Restore');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => /^Restored /.test(document.querySelector('#hint').textContent) || document.querySelector('#hint').classList.contains('err'));
    assert.match(await p.locator('#hint').textContent(), /^Restored /);
    const got = await stored();
    for (const m of markers) assert.ok(JSON.stringify(got).includes(m), `${m} is back`);
    assert.ok(got['notesIdx:https://canvas.test/3'], 'the Notes account is back');
    const note = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:sessions', op: 'notesRead', key: 'notesIdx:https://canvas.test/3', id: '00000000-0000-4000-8000-000000000001' }));
    assert.match(note.html, /MARK-NOTE-BODY/);
    const keys = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:sessions', op: 'exportKeys' }));
    assert.equal(keys.keys[0].del, secret);
    console.log('ok every marker, note body and share key is back in the new profile');
    const oldFile = path.join(scratch, 'glaze-notes.zip');
    const old = await Promise.all(zip.names.filter((name) => name.startsWith('notes/1/')).map(async (name) => ({ name: name.slice(8), data: await zip.bytes(name) })));
    fs.writeFileSync(oldFile, new Uint8Array(await new Blob(require(path.join(root, 'lib/zip.js')).zip(old)).arrayBuffer()));
    await pick(oldFile);
    assert.equal(await p.locator('#restore-account-field').isVisible(), true, 'old Notes requires an explicit destination even with one account');
    assert.equal(await p.locator('#restore-ok').isDisabled(), true);
    await p.keyboard.press('Tab');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'restore-account');
    await p.keyboard.press('c');
    assert.equal(await p.locator('#restore-account').inputValue(), 'notesIdx:https://canvas.test/3');
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => /^Restored glaze-notes/.test(document.querySelector('#hint').textContent)).catch(async (e) => { console.error(await p.evaluate(() => ({ hint: document.querySelector('#hint').textContent, active: document.activeElement?.id, open: document.querySelector('#restore-pick').open, account: document.querySelector('#restore-account').value }))); throw e; });
    console.log('ok an old Notes ZIP requires an explicit account and restores from the keyboard');
    // The list in the Looks for light and dark (automatic, following the system), wide and narrow.
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await p.evaluate(async () => { const { auto } = await chrome.storage.sync.get('auto'); await chrome.storage.sync.set({ auto: { ...GZ_SANITIZE().auto, ...auto, on: true, mode: 'device' } }); });
      for (const scheme of ['light', 'dark']) {
        await p.emulateMedia({ colorScheme: scheme });
        await p.reload();
        await p.waitForFunction(() => document.querySelector('#looks button'));
        await pick();
        for (const width of [1440, 320]) {
          await p.setViewportSize({ width, height: width > 400 ? 1000 : 720 });
          await pause(300);
          await p.screenshot({ path: path.join(shots, `restore-${width}-${scheme}.png`) });
        }
        await p.keyboard.press('Escape');
        await p.setViewportSize({ width: 1440, height: 1000 });
      }
      console.log(`ok screenshots in ${shots}`);
    }
  } finally {
    await open?.close();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
