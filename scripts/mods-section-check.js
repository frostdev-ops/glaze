// The editor's Mods tab in the real unpacked extension, headless (lib/editor-mods.js, lib/gallery.js, lib/background.js):
//   - install from a .glazemod file and from a glazemod1: code, each through the install prompt; the prompt's warnings for a
//     mod that reads grades and has a network host, its focus trap, and only Install installing;
//   - revoke and grant, turn off and on, a setting, the order, an update that asks for more re-prompting with it marked New
//     (dropped on the drop zone), export and remove;
//   - dev mode: the author key, a folder loaded as a Dev copy (a stand-in directory handle: headless Chrome has no picker),
//     Export signed verifying with that key;
//   - the gallery handoff against a local HTTPS gallery page and bundle server: a script's click sends nothing, a real click
//     makes the worker fetch exactly that bundle, without cookies or referrer, and the editor prompts with Reviewed.
// frostdev.io resolves to a server on 127.0.0.1 with a certificate made here; every other host fails to resolve.
//   NODE_PATH=/path/to/node_modules nice -n 10 node scripts/mods-section-check.js
// One headless browser at a time across agents: it waits while another runs. Its profile and server go when it is done.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https');
const { execFileSync } = require('node:child_process');
const { createHash, X509Certificate } = require('node:crypto');

const ext = fs.realpathSync(path.join(__dirname, '..'));
const chromeLaunch = require('./check-env.js').chromeLaunch();
const M = require(path.join(ext, 'lib/modbundle.js'));
const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${String(detail).slice(0, 400)}`}`); if (!ok) fails++; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(80); } return null; };

(async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mods-section-')));
  let context, server;
  let watchdog;
  try {
    // ---- fixtures ----
    const author = await M.makeKey();
    const SETTINGS = [{ id: 'ring', type: 'toggle', label: 'Show the ring', default: true }, { id: 'size', type: 'number', label: 'Size', min: 1, max: 9, step: 1, default: 3 },
      { id: 'tint', type: 'color', label: 'Tint', default: '#3366cc' }, { id: 'plant', type: 'choice', label: 'Plant', options: ['Fern', 'Cactus'] }, { id: 'note', type: 'text', label: '\u200b', default: 'a\u200bb', max: 20 }];
    const ringFiles = { 'hooks.js': enc.encode('glaze.ready;\n') };
    const ringManifest = { glaze: 1, name: 'Grade Ring', version: '1.0.0', author: { name: 'Kai' }, hooks: 'hooks.js', ui: { background: {} }, settings: SETTINGS, replaces: ['bg'],
      permissions: [{ id: 'grades', why: 'Draws a ring for each course grade.' }, { id: 'network:api.weather.gov', why: 'Rains when it rains outside.' }] };
    const ring = await M.pack(ringFiles, ringManifest, author);
    const ring2 = await M.pack(ringFiles, { ...ringManifest, version: '1.1.0', replaces: ['bg', 'nav'], permissions: [...ringManifest.permissions, { id: 'todo', why: 'Counts what is due.' }] }, author);
    const pets = await M.pack(ringFiles, { glaze: 1, name: 'Calm Pack', version: '1.0.0', author: { name: 'Ana' }, hooks: 'hooks.js', ui: { background: {} }, replaces: ['bg'] }, author);
    const petsCode = await M.encode(pets.bytes);
    const clock = await M.pack({ 'hooks.js': enc.encode('glaze.ready;\n') }, { glaze: 1, name: 'Gallery Clock', version: '2.0.0', author: { name: 'Lee' }, hooks: 'hooks.js' }, author);
    const ringFile = path.join(tmp, 'grade-ring.glazemod');
    fs.writeFileSync(ringFile, ring.bytes);

    // ---- the local gallery ----
    const keyFile = path.join(tmp, 'tls.key'), certFile = path.join(tmp, 'tls.cert');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=frostdev.io', '-addext', 'subjectAltName=DNS:frostdev.io', '-keyout', keyFile, '-out', certFile], { stdio: 'ignore' });
    const tls = { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
    const spki = createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    const hits = [];
    const bundlePath = `/glaze/mods/api/mods/${clock.id}/${clock.hash}.glazemod`;
    server = https.createServer(tls, (req, res) => {
      hits.push({ url: req.url, cookie: req.headers.cookie || '', referer: req.headers.referer || '', origin: req.headers.origin || '' });
      if (req.url === bundlePath) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(Buffer.from(clock.bytes)); }
      if (req.url.startsWith('/glaze/mods/clock')) {
        res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'gallery=1; Path=/; Secure; SameSite=Lax' });
        return res.end(`<!doctype html><title>Gallery Clock</title><a id="use" href="/glaze/mods/help" data-glaze-mod data-id="${clock.id}" data-hash="${clock.hash}">Use in Glaze</a>`);
      }
      res.writeHead(404); res.end('no');
    });
    const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

    await require('./wait-for-browser.js')();
    watchdog = setTimeout(() => { console.log('FAIL timed out after 180 s'); context?.close().finally(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); }); }, 180000);
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...chromeLaunch, headless: true, locale: 'en-US', acceptDownloads: true, viewport: { width: 1200, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--ignore-certificate-errors-spki-list=${spki}`, '--disable-background-networking', '--disable-component-update', '--no-proxy-server',
        `--host-resolver-rules=MAP frostdev.io 127.0.0.1:${port}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`] });
    context.setDefaultTimeout(10000);
    const errors = [];
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const editor = await context.newPage();
    editor.on('pageerror', (e) => errors.push(`editor: ${e}`));
    editor.on('dialog', (d) => d.accept());
    await editor.goto(`chrome-extension://${id}/options.html#mods/installed`);
    const local = (keys) => editor.evaluate((k) => chrome.storage.local.get(k), keys);
    const rec = async (mid) => (await local(`mod:${mid}`))[`mod:${mid}`];
    const promptOpen = () => editor.evaluate(() => document.getElementById('mod-prompt').open);
    const promptText = () => editor.evaluate(() => document.getElementById('mod-prompt').innerText);

    // Navigation finishes before the settings load and the worker's first list reply have drawn the empty state.
    await editor.locator('#mods-empty').waitFor({ state: 'visible' });
    check('the Mods tab shows, empty', await editor.evaluate(() => !document.getElementById('panel-mods').hidden && !document.getElementById('mods-empty').hidden
      && document.getElementById('tab-mods').getAttribute('aria-selected') === 'true'));

    // ---- install from a file ----
    await editor.setInputFiles('#mod-file', ringFile);
    check('a file opens the install prompt', await until(promptOpen));
    const text = await promptText();
    check('the prompt names the mod, its author key and that it is from a file', /Install Grade Ring\?/.test(text) && text.includes(`author key ${author.x.slice(0, 4)}`) && /From a file/.test(text), text);
    check('each permission in Glaze words, then the author quoted', text.includes('Grades — reads your grades and GPA in every course.') && /The author says:\s*“?Draws a ring for each course grade\.”?/.test(text)
      && await editor.evaluate(() => [...document.querySelectorAll('#mod-prompt-perms q')].map((q) => q.textContent).join('|')) === 'Draws a ring for each course grade.|Rains when it rains outside.', text);
    check('warns that grades could go to the network host', text.includes('This mod could send your grades to api.weather.gov.'), text);
    check('warns Chrome-only and not reviewed, and not unsigned', /Its code runs only in Chrome\./.test(text) && /Not reviewed/.test(text) && !/Unsigned/.test(text), text);
    check('only Cancel and Install, Cancel focused', await editor.evaluate(() => [...document.querySelectorAll('#mod-prompt button')].map((b) => b.textContent).join(',') === 'Cancel,Install'
      && document.activeElement.id === 'mod-prompt-cancel'));
    for (let i = 0; i < 5; i++) await editor.keyboard.press('Tab');
    check('focus stays in the prompt', await editor.evaluate(() => document.getElementById('mod-prompt').contains(document.activeElement)));
    check('the page behind the prompt is inert', await editor.evaluate(() => { const b = document.getElementById('mod-file-btn'); b.focus(); return document.getElementById('mod-prompt').matches(':modal') && document.activeElement !== b; }));
    await editor.keyboard.press('Escape');
    check('Escape cancels without installing', !await promptOpen() && !(await local('mods')).mods);
    await editor.setInputFiles('#mod-file', ringFile);
    await until(promptOpen);
    await editor.evaluate(() => document.getElementById('mod-prompt-install').click());
    await sleep(150);
    check('a synthetic Install click cannot install', !(await rec(ring.id)));
    if (await rec(ring.id)) {
      await editor.evaluate(async (id) => {
        await chrome.runtime.sendMessage({ type: 'glaze:mods', op: 'remove', id });
        await chrome.runtime.sendMessage({ type: 'glaze:mods', op: 'clearTrust', id });
      }, ring.id);
      await editor.setInputFiles('#mod-file', ringFile);
      await until(promptOpen);
    }
    await editor.evaluate(() => document.getElementById('mod-prompt').close('install'));
    await sleep(150);
    check('closing with an install return value cannot install', !(await rec(ring.id)));
    if (await rec(ring.id)) await editor.evaluate(async (id) => {
      await chrome.runtime.sendMessage({ type: 'glaze:mods', op: 'remove', id });
      await chrome.runtime.sendMessage({ type: 'glaze:mods', op: 'clearTrust', id });
    }, ring.id);
    await editor.setInputFiles('#mod-file', ringFile);
    await until(promptOpen);
    await editor.evaluate(async (zip) => {
      await chrome.storage.local.set({ modOffer: { id: 'replacement', hash: 'replacement', zip } });
    }, Buffer.from(pets.bytes).toString('base64'));
    await sleep(150);
    check('a gallery offer cannot replace an open consent prompt', /Install Grade Ring\?/.test(await promptText()));
    await editor.evaluate(() => chrome.storage.local.remove('modOffer'));
    await editor.keyboard.press('Escape');
    await editor.setInputFiles('#mod-file', ringFile);
    await until(promptOpen);
    await editor.click('#mod-prompt-install');
    const r1 = await until(() => rec(ring.id));
    check('Install installs with the hash shown and every grant', r1?.hash === ring.hash && r1.grants.grades && r1.grants['network:api.weather.gov'] && r1.source === 'file', JSON.stringify(r1 && { ...r1, files: 0 }));
    const card = `#mods-list [data-mod="${ring.id}"]`;
    await editor.waitForSelector(card);
    check('the card shows name, version, author key, permissions and the author', /Grade Ring/.test(await editor.innerText(card)) && /Version 1\.0\.0/.test(await editor.innerText(card))
      && (await editor.innerText(card)).includes(`author key ${author.x.slice(0, 4)}`) && /The author says/.test(await editor.innerText(card)));
    check('setting labels and values cannot bypass the sanitized view', await editor.evaluate((sel) => {
      const card = document.querySelector(sel);
      return !/[\p{Cf}\p{Bidi_Control}]/u.test(card.textContent + [...card.querySelectorAll('input')].map((i) => i.value).join(''));
    }, card));

    // ---- revoke and grant, off and on, a setting ----
    const perm = (p) => `${card} [data-f="${ring.id}:perm:${p}"]`;
    await editor.uncheck(perm('network:api.weather.gov'));
    check('revoke', await until(async () => !(await rec(ring.id)).grants['network:api.weather.gov']));
    await editor.check(perm('network:api.weather.gov'));
    check('grant', await until(async () => (await rec(ring.id)).grants['network:api.weather.gov'] === true));
    await editor.uncheck(`${card} [data-f="${ring.id}:on"]`);
    check('turn off', await until(async () => (await rec(ring.id)).enabled === false));
    await editor.check(`${card} [data-f="${ring.id}:on"]`);
    check('turn on', await until(async () => (await rec(ring.id)).enabled === true));
    await editor.fill(`${card} [data-f="${ring.id}:set:size"]`, '42');
    await editor.press(`${card} [data-f="${ring.id}:set:size"]`, 'Enter');
    await editor.selectOption(`${card} [data-f="${ring.id}:set:plant"]`, { label: 'Cactus' });
    const sets = await until(async () => { const v = (await local(`modSettings:${ring.id}`))[`modSettings:${ring.id}`]; return v?.plant === 'Cactus' && v; });
    check('settings save cleaned against the schema', sets?.size === 9 && sets.ring === true && sets.tint === '#3366cc', JSON.stringify(sets));
    await editor.evaluate((id) => {
      const change = (key, value) => { const e = document.querySelector(`[data-f="${id}:set:${key}"]`); e.value = value; e.dispatchEvent(new Event('change', { bubbles: true })); };
      change('size', '5');
      change('note', 'hello');
    }, ring.id);
    await sleep(200);
    const rapid = (await local(`modSettings:${ring.id}`))[`modSettings:${ring.id}`];
    check('two setting changes together keep both edits', rapid.size === 5 && rapid.note === 'hello', JSON.stringify(rapid));

    // ---- install from a code; order ----
    await editor.fill('#mod-code', petsCode);
    await editor.click('#mod-code-read');
    await until(promptOpen);
    check('a code prompts too, asking for nothing', /It asks for nothing/.test(await promptText()));
    await editor.click('#mod-prompt-install');
    check('installed from a code', (await until(() => rec(pets.id)))?.source === 'code');
    await editor.waitForSelector('#mods-order-group:not([hidden])');
    await editor.click(`[data-f="order:${ring.id}:down"]`);
    check('the order list writes modOrder', await until(async () => JSON.stringify((await local('modOrder')).modOrder) === JSON.stringify([pets.id, ring.id])));

    // ---- replacement switches ----
    const swt = (id, k) => `#mods-list [data-mod="${id}"] [data-f="${id}:replace:${k}"]`;
    check('one switch per declared key, off by default', await editor.locator(`[data-mod="${pets.id}"] [data-f*=":replace:"]`).count() === 1
      && await editor.locator(`[data-mod="${ring.id}"] [data-f*=":replace:"]`).count() === 1 && !await editor.isChecked(swt(pets.id, 'bg')) && /Replace the background/.test(await editor.innerText(`[data-mod="${pets.id}"]`)));
    await editor.check(swt(pets.id, 'bg'));
    check('a switch turns a replacement on and stores modReplace', await until(async () => JSON.stringify((await local(`modReplace:${pets.id}`))[`modReplace:${pets.id}`]) === '{"bg":true}'));
    await editor.check(swt(ring.id, 'bg'));
    check('two mods on the same place: the order says which wins', await until(async () => /Calm Pack wins this place/.test(await editor.innerText(`[data-mod="${ring.id}"]`))));

    // ---- an update with a new permission, dropped on the drop zone ----
    await editor.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), dt = new DataTransfer();
      dt.items.add(new File([bytes], 'grade-ring-1.1.glazemod'));
      const zone = document.getElementById('mod-drop');
      zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, Buffer.from(ring2.bytes).toString('base64'));
    await until(promptOpen);
    const up = await promptText();
    check('an update that asks for more prompts again with the new one marked', /Update Grade Ring\?/.test(up) && await editor.evaluate(() => [...document.querySelectorAll('#mod-prompt-perms .mod-new')].map((li) => li.textContent).join('|')).then((s) => s.includes('To Do') && !s.includes('Grades')), up);
    await editor.click('#mod-prompt-install');
    const r2 = await until(async () => { const r = await rec(ring.id); return r?.version === '1.1.0' && r; });
    check('the update keeps the grants and adds the new one, and shows "Updated"', r2 && r2.grants.todo && r2.grants.grades && r2.updatedAt && await until(() => editor.innerText(card).then((s) => /Updated /.test(s))));

    const kept = (await local(`modReplace:${ring.id}`))[`modReplace:${ring.id}`];
    check('the update keeps the replacement and leaves its new key off', kept?.bg === true && !kept.nav && await editor.locator(`[data-mod="${ring.id}"] [data-f*=":replace:"]`).count() === 2 && !await editor.isChecked(swt(ring.id, 'nav')));
    await editor.evaluate((id) => {
      for (const [key, value] of [['bg', false], ['nav', true]]) {
        const input = document.querySelector(`[data-f="${id}:replace:${key}"]`);
        input.checked = value; input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, ring.id);
    check('two replacement changes together keep both edits', await until(async () => {
      const s = (await local(`modReplace:${ring.id}`))[`modReplace:${ring.id}`];
      return s && s.bg !== true && s.nav === true;
    }));
    await editor.focus(swt(ring.id, 'nav'));
    await editor.keyboard.press('Space');
    check('replacement switches have a native label, work by keyboard and retain focus', await until(async () => {
      const s = (await local(`modReplace:${ring.id}`))[`modReplace:${ring.id}`];
      return s?.nav === false && await editor.evaluate((id) => {
        const input = document.activeElement;
        return input.dataset.f === `${id}:replace:nav` && input.type === 'checkbox' && /Replace the nav bar/.test(input.labels[0]?.textContent);
      }, ring.id);
    }));

    // ---- export, remove ----
    const [dl] = await Promise.all([editor.waitForEvent('download'), editor.click(`[data-f="${ring.id}:export"]`)]);
    const exported = fs.readFileSync(await dl.path());
    check('export downloads the installed .glazemod', dl.suggestedFilename() === 'grade-ring.glazemod' && Buffer.compare(exported, Buffer.from(ring2.bytes)) === 0, dl.suggestedFilename());
    await editor.click(`[data-f="${pets.id}:remove"]`);
    check('remove (after the question) takes the mod and its settings away', await until(async () => !(await rec(pets.id)) && !(await local('mods')).mods.includes(pets.id)
      && !(`modReplace:${pets.id}` in await local(`modReplace:${pets.id}`))));

    // ---- dev mode ----
    check('dev tools are hidden until dev mode is on', await editor.evaluate(() => document.getElementById('mod-dev-tools').hidden));
    await editor.check('#mod-dev');
    await editor.waitForSelector('#mod-dev-tools:not([hidden])');
    check('dev mode is saved as modDev', (await local('modDev')).modDev === true);
    await editor.click('#mod-key-make');
    const key = await until(async () => (await local('modAuthor')).modAuthor);
    check('the author key is made and shown', key?.x && await until(() => editor.innerText('#mod-key-now').then((s) => s.includes(key.x.slice(0, 4)))));
    let emptyBackup = false;
    const onBackup = () => { emptyBackup = true; };
    editor.on('download', onBackup);
    await editor.click('#mod-key-save');
    await sleep(200);
    editor.off('download', onBackup);
    check('the backup requires a passphrase before exporting the private key', !emptyBackup && await editor.evaluate(() => document.activeElement.id === 'mod-key-pass'));
    await editor.fill('#mod-key-pass', 'correct horse battery');
    let syntheticBackup = false;
    const onSyntheticBackup = () => { syntheticBackup = true; };
    editor.on('download', onSyntheticBackup);
    await editor.evaluate(() => document.getElementById('mod-key-save').click());
    await sleep(400);
    editor.off('download', onSyntheticBackup);
    check('a synthetic click cannot export the author key', !syntheticBackup);
    const [kdl] = await Promise.all([editor.waitForEvent('download'), editor.click('#mod-key-save')]);
    const backup = JSON.parse(fs.readFileSync(await kdl.path(), 'utf8'));
    check('the key backup is passphrase-locked', backup.glazeAuthorKey === 1 && backup.ct && !backup.key && backup.x === key.x);
    // A stand-in for the folder picker: the same handle shape Chrome gives (entries(), kind, getFile()).
    await editor.evaluate(() => {
      const file = (name, text) => ({ kind: 'file', getFile: async () => new File([text], name) });
      const dir = (entries) => ({ kind: 'directory', entries: async function* () { yield* Object.entries(entries); } });
      window.showDirectoryPicker = async () => dir({
        'mod.json': file('mod.json', JSON.stringify({ glaze: 1, name: 'Dev Timer', version: '0.1.0', author: { name: 'Me' }, hooks: 'src/main.js' })),
        '.DS_Store': file('.DS_Store', 'junk'),
        src: dir({ 'main.js': file('main.js', 'glaze.ready;\n') }),
      });
    });
    await editor.evaluate(() => { document.getElementById('mod-folder').disabled = false; });
    await editor.click('#mod-folder');
    await until(promptOpen);
    const dev = await promptText();
    check('a folder loads as an unsigned Dev copy, with the warning', /Install Dev Timer\?/.test(dev) && /Unsigned \(Dev\)/.test(dev) && /From a folder/.test(dev), dev);
    await editor.click('#mod-prompt-install');
    const devId = await until(async () => (await local('mods')).mods.find((x) => x !== ring.id));
    const devRec = await rec(devId);
    check('the Dev copy is installed, unsigned, with the author key filled in', devRec?.dev === true && devRec.key === key.x && devRec.source === 'dev' && !('mod.sig' in devRec.files) && !('.DS_Store' in devRec.files));
    const [sdl] = await Promise.all([editor.waitForEvent('download'), editor.click('#mod-export-signed')]);
    const signed = await M.read(new Uint8Array(fs.readFileSync(await sdl.path())));
    check('Export signed packs the folder signed with the author key', signed.signed === true && signed.key === key.x && signed.id === devId && sdl.suggestedFilename() === 'dev-timer.glazemod');
    await editor.evaluate(() => {
      window.showDirectoryPicker = async () => ({ kind: 'directory', entries: async function* () {} });
    });
    await editor.click('#mod-folder');
    await sleep(200);
    check('a failed folder load cannot export the previous folder', await editor.isDisabled('#mod-export-signed'));

    // ---- the gallery ----
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`gallery: ${e}`));
    await page.goto('https://frostdev.io/glaze/mods/clock');
    await page.evaluate(() => document.getElementById('use').click());
    await sleep(800);
    check('a script-made click hands nothing over: the link goes to the instructions', !hits.some((h) => h.url === bundlePath) && !(await local('modOffer')).modOffer
      && hits.some((h) => h.url === '/glaze/mods/help'));
    await page.goto('https://frostdev.io/glaze/mods/clock');
    await page.click('#use');
    check('a real click makes the worker fetch that exact bundle', await until(async () => hits.some((h) => h.url === bundlePath)));
    const bundleHits = hits.filter((h) => h.url.startsWith('/glaze/mods/api/'));
    check('one request, without cookies or referrer', bundleHits.length === 1 && !bundleHits[0].cookie && !bundleHits[0].referer, JSON.stringify(bundleHits));
    check('the gallery page stays where it is', page.url() === 'https://frostdev.io/glaze/mods/clock');
    const opened = await until(async () => { for (const p of context.pages()) if (p.url().startsWith(`chrome-extension://${id}/options.html`) && await p.evaluate(() => document.getElementById('mod-prompt').open)) return p; return null; }, 10000);
    check('the editor opens on the install prompt', !!opened);
    const gtext = opened ? await opened.evaluate(() => document.getElementById('mod-prompt').innerText) : '';
    check('the prompt says Reviewed and from the gallery, with no not-reviewed warning', /Install Gallery Clock\?/.test(gtext) && /From Glaze’s gallery/.test(gtext) && /Reviewed/.test(gtext) && !/Not reviewed/.test(gtext), gtext);
    if (opened) {
      const original = (await local('modOffer')).modOffer;
      await opened.evaluate((o) => chrome.storage.local.set({ modOffer: o }), { id: pets.id, hash: pets.hash, zip: Buffer.from(pets.bytes).toString('base64') });
      await sleep(150);
      await opened.keyboard.press('Escape');
      check('cancelling an older gallery prompt preserves and shows the newer offer', await until(() => opened.evaluate(() => document.getElementById('mod-prompt').open && /Install Calm Pack\?/.test(document.getElementById('mod-prompt-title').textContent)))
        && (await local('modOffer')).modOffer?.hash === pets.hash);
      await opened.keyboard.press('Escape');
      await opened.evaluate((o) => chrome.storage.local.set({ modOffer: o }), original);
      await until(() => opened.evaluate(() => document.getElementById('mod-prompt').open));
    }
    if (opened) await opened.click('#mod-prompt-install');
    const g = await until(() => rec(clock.id));
    check('installed from the gallery, Reviewed, and the offer cleared', g?.source === 'gallery' && g.hash === clock.hash && !(await local('modOffer')).modOffer);
    check('no request but the page and the bundle', hits.every((h) => h.url.startsWith('/glaze/mods/clock') || ['/glaze/mods/help', bundlePath, '/favicon.ico'].includes(h.url)), JSON.stringify(hits));
    check('no page errors', errors.length === 0, errors.join('\n'));
  } catch (e) {
    console.log(`FAIL ${e.stack || e}`);
    fails++;
  } finally {
    clearTimeout(watchdog);
    await context?.close().catch(() => {});
    server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exitCode = fails ? 1 : 0;
})();
