// Mod bundles in the real unpacked extension, headless: the editor page installs, lists, exports and removes a signed mod
// through the worker's 'glaze:mods' broker, as it will. Nothing reaches the network.
//   - The worker loads zip.js and modbundle.js on first use, and again after it is stopped and started (cached at install).
//   - WebCrypto has Ed25519 in the worker; missing support refuses installs with an update-browser error.
//   - A changed file is refused in the worker, whatever the editor sent; an LMS page's content script is refused as sender.
// EXT=/path/to/checkout NODE_PATH=/path/to/playwright/node_modules nice node scripts/modbundle-check.js
// One browser at a time (wait while another agent's run is up); it deletes its own profile when it is done.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ext = process.env.EXT || path.resolve(__dirname, '..');
const M = require(path.join(ext, 'lib/modbundle.js'));
const chromePath = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const LMS = 'https://school.example.test';
const enc = new TextEncoder();
const std = (b) => Buffer.from(b).toString('base64');
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end && !fn()) await new Promise((r) => setTimeout(r, 40)); };

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-modbundle-'));
  const results = [], external = [], errors = [];
  const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ` ${detail}`}`); };
  let context;
  // A run that stalls still closes its browser and deletes its profile.
  let watchdog;
  try {
    const author = await M.makeKey();
    const files = { 'hooks.js': enc.encode('glaze.ready;\n'), 'tile.html': enc.encode('<p>hi</p>\n') };
    const manifest = { glaze: 1, name: 'Check Mod', version: '1.0.0', author: { name: 'Kai' }, permissions: [{ id: 'network:api.weather.gov', why: 'Weather.' }],
      ui: { tiles: [{ id: 't', name: 'Tile', file: 'tile.html', sizes: ['m'] }] }, hooks: 'hooks.js' };
    const mod = await M.pack(files, manifest, author);
    const next = await M.pack(files, { ...manifest, version: '1.1.0' }, author);
    const changed = M.archive({ ...mod.files, 'hooks.js': enc.encode('steal();\n') });

    await require('./wait-for-browser.js')();
    watchdog = setTimeout(() => { console.log('FAIL timed out after 120 s'); process.exitCode = 1; context?.close().finally(() => { fs.rmSync(scratch, { recursive: true, force: true }); process.exit(1); }); }, 120000);
    context = await chromium.launchPersistentContext(scratch, { executablePath: chromePath, headless: true, locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND'] });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('chrome-extension:') || url.startsWith('data:')) return route.continue();
      if (url.startsWith(LMS)) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Course</title><p>course</p>' });
      external.push(url); return route.abort();
    });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const version = await sw.evaluate(() => navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1]);
    console.log(`Chrome ${version}`);
    const ed = await sw.evaluate(() => crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']).then(() => true, (e) => String(e)));
    check('WebCrypto has Ed25519 in the worker', ed === true, String(ed));

    const editor = await context.newPage();
    editor.on('pageerror', (e) => errors.push(`editor: ${e}`));
    await editor.goto(`chrome-extension://${id}/options.html`);
    const send = (m) => editor.evaluate((msg) => chrome.runtime.sendMessage({ type: 'glaze:mods', ...msg }), m);

    let r = await send({ op: 'install', zip: std(mod.bytes), hash: mod.hash, grants: ['network:api.weather.gov'], source: 'file' });
    check('the editor installs a signed mod', r.ok === true && r.action === 'install' && r.mod.id === mod.id, JSON.stringify(r).slice(0, 300));
    const loaded = await sw.evaluate(() => typeof GZ_MODBUNDLE === 'object' && typeof GZ_ZIP === 'object' && typeof GZ_BLOCKLIST?.blocked === 'function');
    check('the worker loaded the bundle reader and blocklist for it', loaded);
    const stored = await sw.evaluate((k) => chrome.storage.local.get([k, 'mods']), `mod:${mod.id}`);
    const rec = stored[`mod:${mod.id}`];
    check('the record and index are stored as the contract says', rec?.hash === mod.hash && rec.key === author.x && rec.dev === false && rec.grants['network:api.weather.gov'] === true
      && stored.mods?.[0] === mod.id && Buffer.from(rec.files['hooks.js'], 'base64').toString() === 'glaze.ready;\n', JSON.stringify(stored).slice(0, 300));

    r = await send({ op: 'install', zip: std(changed), hash: mod.hash, grants: [], source: 'file' });
    check('a changed file is refused in the worker', r.ok === false && r.error === 'bundle' && /signature/.test(r.why), JSON.stringify(r));

    // Stop the worker; the next message starts a fresh one, which must import the broker files again (cached at install).
    // Chrome's own reports of the worker's state (no Playwright handle on a stopped worker: touching one can stall it).
    const cdp = await context.newCDPSession(editor), states = [];
    cdp.on('ServiceWorker.workerVersionUpdated', (e) => { for (const v of e.versions) if (v.scriptURL.endsWith('/lib/background.js')) states.push(v.runningStatus); });
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await until(() => states.at(-1) === 'stopped');
    const stoppedAt = states.length;
    // The new worker starts without GZ_MODBUNDLE: allow() reads GZ_MODBUNDLE.OPS, so an answer means the import worked.
    r = await Promise.race([send({ op: 'list' }), new Promise((res) => setTimeout(() => res('no answer in 15 s'), 15000))]);
    const restarted = states.slice(stoppedAt).includes('running');
    check('after a worker restart the broker still loads and lists', states[stoppedAt - 1] === 'stopped' && restarted && r.ok === true && r.mods.length === 1 && !('files' in r.mods[0]),
      `${states.join(',')} ${JSON.stringify(r).slice(0, 300)}`);
    // Extension pages have the same storage and tabs APIs as the worker; the restarted worker has no handle here.
    const ask = (f, arg) => editor.evaluate(f, arg);

    r = await send({ op: 'export', id: mod.id });
    check('export gives back the same .glazemod bytes', r.ok === true && Buffer.from(r.zip, 'base64').equals(Buffer.from(mod.bytes)));

    const grant = { id: mod.id, perm: 'network:api.weather.gov' };
    await send({ op: 'revoke', ...grant });
    r = await send({ op: 'grant', ...grant });
    let current = (await ask((k) => chrome.storage.local.get(k), `mod:${mod.id}`))[`mod:${mod.id}`];
    check('the editor can restore a revoked declared grant', r.ok === true && current.grants[grant.perm] === true);
    r = await send({ op: 'grant', ...grant, perm: 'grades' });
    check('the worker refuses an undeclared grant', r.ok === false && r.error === 'bad');
    await send({ op: 'revoke', ...grant });

    const list = { v: 1, seq: 1, issued: '2026-10-16T00:00:00Z', expires: '2027-10-16T00:00:00Z', mods: [], bundles: [], authors: [author.x], reasons: { [author.x]: 'Listed.' } };
    await ask((list) => chrome.storage.local.set({ modsBlocklist: { list } }), list);
    r = await send({ op: 'install', zip: std(next.bytes), hash: next.hash, source: 'file' });
    check('after restart the real blocklist refuses an update', r.ok === false && r.reason === 'blocked' && r.blocked === 'Listed.');
    r = await send({ op: 'enable', id: mod.id });
    check('after restart the real blocklist refuses enable', r.ok === false && r.reason === 'blocked');
    await ask(() => chrome.storage.local.remove('modsBlocklist'));
    r = await send({ op: 'install', zip: std(next.bytes), hash: next.hash, source: 'file' });
    current = (await ask((k) => chrome.storage.local.get(k), `mod:${mod.id}`))[`mod:${mod.id}`];
    check('a quiet update keeps revocations and the install time, and records updatedAt', r.ok === true && r.action === 'update'
      && !current.grants[grant.perm] && current.installedAt === rec.installedAt && current.updatedAt >= rec.installedAt);

    // An LMS page's content script (the real sender fields Chrome fills in) is refused.
    const page = await context.newPage();
    await page.goto(`${LMS}/courses/1`);
    const fromPage = await ask(async (u) => {
      const [tab] = await chrome.tabs.query({ url: `${u}/*` });
      const [x] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => chrome.runtime.sendMessage({ type: 'glaze:mods', op: 'list' }) });
      return x.result;
    }, LMS);
    check('an LMS page is refused as sender', fromPage?.ok === false && fromPage.error === 'sender', JSON.stringify(fromPage));

    // A fresh page-side module with WebCrypto's Ed25519 taken away must refuse the install.
    await editor.addScriptTag({ url: `chrome-extension://${id}/lib/zip.js` });
    await editor.addScriptTag({ url: `chrome-extension://${id}/lib/modbundle.js` });
    const unsupported = await editor.evaluate(async (zip) => {
      const real = crypto.subtle.importKey;
      crypto.subtle.importKey = function (f, k, a, ...rest) { return String(a?.name || a) === 'Ed25519' ? Promise.reject(new DOMException('no', 'NotSupportedError')) : real.call(this, f, k, a, ...rest); };
      const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      try {
        const refused = await GZ_MODBUNDLE.read(bytes(zip)).then(() => 'accepted', (e) => e.message);
        return { refused, supported: await GZ_MODBUNDLE.canSign() };
      } finally { crypto.subtle.importKey = real; }
    }, std(mod.bytes));
    check('missing Ed25519 refuses installs with an update-browser error', unsupported.supported === false && /[Uu]pdate your browser/.test(unsupported.refused), JSON.stringify(unsupported));

    r = await send({ op: 'remove', id: mod.id });
    const after = await ask((k) => chrome.storage.local.get([k, 'mods']), `mod:${mod.id}`);
    check('remove takes the record and its index entry', r.ok === true && !after[`mod:${mod.id}`] && after.mods.length === 0, JSON.stringify(after));
    const trust = (await ask((k) => chrome.storage.local.get(k), `modTrust:${mod.id}`))[`modTrust:${mod.id}`];
    r = await send({ op: 'install', zip: std(mod.bytes), hash: mod.hash, grants: [], source: 'file' });
    check('removal retains the pin and highest version and prevents a downgrade', trust?.key === author.x && trust.version === next.version
      && r.ok === false && r.reason === 'version');
    r = await send({ op: 'install', zip: std(next.bytes), hash: next.hash, grants: [], source: 'file' });
    check('the exact highest signed bundle can be reinstalled', r.ok === true && r.action === 'install');
    await send({ op: 'remove', id: mod.id });
    r = await send({ op: 'clearTrust', id: mod.id });
    check('the editor can explicitly clear trust after removal', r.ok === true);

    check('nothing reached the network', external.length === 0, external.join(' '));
    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally { clearTimeout(watchdog); await context?.close(); fs.rmSync(scratch, { recursive: true, force: true }); }
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
