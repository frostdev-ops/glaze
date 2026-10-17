// The mod blocklist in a real Chrome (lib/blocklist.js, lib/background.js), headless, in an unpacked copy of the extension:
// the editor's switch and its saved value, the worker's check waking when the editor opens (and not without a mod or with the
// switch off), WebCrypto's Ed25519 verifying a signed list, the matching mod records stopped and their reasons kept, a
// tampered list and a second check within the day changing nothing, and the worker loading blocklist.js lazily after a
// restart. The copy pins a test key made here for this run (the real OWNER_KEY is the owner's, and stays untouched); the worker's
// fetch is replaced inside it, so nothing leaves this computer, and every request outside the extension is aborted.
//   NODE_PATH=/path/to/node_modules nice -n 10 node scripts/blocklist-check.js
// One headless browser at a time across agents: it waits while another runs. The profile and the copy are removed.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');

const src = fs.realpathSync(path.join(__dirname, '..'));
const chrome = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const B = require(path.join(src, 'lib/blocklist.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (!ok) fails++; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80); } return null; };

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'jwk' }).x;
const sign = (list) => ({ list, sig: crypto.sign(null, Buffer.from(`glaze-blocklist-1|${B.canon(list)}`), privateKey).toString('base64url') });
const BAD = 'aaaaaaaaaaaaaaaa', OTHER = 'bbbbbbbbbbbbbbbb';
const now = Date.now(), iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const list = (seq, over = {}) => ({ v: 1, seq, issued: iso(now - 36e5), expires: iso(now + 6 * 864e5), mods: [BAD], bundles: [], authors: [], reasons: { [BAD]: 'Sends grades to a third party.' }, ...over });
const record = (id) => ({ id, manifest: { glaze: 1, name: id, version: '1.0.0', author: { name: 'Check author', key: 'k'.repeat(43) }, hooks: 'hooks.js' },
  files: { 'hooks.js': 'dm9pZCAwOw==' }, hash: 'h'.repeat(43), key: 'k'.repeat(43), version: '1.0.0', grants: {}, enabled: true });

(async () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-blocklist-')));
  const ext = path.join(scratch, 'ext');
  const errors = [];
  let context;
  try {
    fs.cpSync(src, ext, { recursive: true, filter: (p) => !/^(\.git|\.claude|release|dist|node_modules|safari|notes|store|test)(\/|$)/.test(path.relative(src, p)) });
    const code = fs.readFileSync(path.join(ext, 'lib/blocklist.js'), 'utf8');
    const pinned = `const OWNER_KEY = '${B.OWNER_KEY}';`;
    if (code.split(pinned).length !== 2) throw Error('expected exactly one OWNER_KEY declaration in the temporary copy');
    fs.writeFileSync(path.join(ext, 'lib/blocklist.js'), code.replace(pinned, `const OWNER_KEY = '${pub}';`));
    const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      executablePath: chrome, headless: true, viewport: { width: 1200, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(15000);
    await context.route('**/*', (r) => (new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort()));
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const worker = async () => context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || context.waitForEvent('serviceworker');
    // Opened afresh each time (a same-address goto would only move within the page, which sends no wake).
    const editor = async () => { await page.goto('about:blank'); await page.goto(`chrome-extension://${id}/options.html#backup/privacy`); await page.waitForSelector('input[data-key="mods.blocklist"]', { state: 'attached' }); };
    const local = (k) => page.evaluate((k) => chrome.storage.local.get(k), k);
    const sync = (k) => page.evaluate((k) => chrome.storage.sync.get(k), k);
    // The worker's fetch, replaced in this worker instance: what it was asked for, and the answer the test gives.
    const serve = async (body, status = 200) => (await worker()).evaluate(({ body, status }) => {
      globalThis.asked = [];
      globalThis.fetch = async (url, init) => { asked.push({ url, init: { ...init, signal: typeof init.signal } }); return new Response(JSON.stringify(body), { status }); };
    }, { body, status });
    const asked = async () => (await worker()).evaluate(() => globalThis.asked || []);

    // 1. The switch: on by default, saved when turned off, still off after the editor is reopened.
    await editor();
    const box = () => page.evaluate(() => document.querySelector('input[data-key="mods.blocklist"]').checked);
    check('the editor has the switch, on by default', await box() === true);
    check('it sits in Backup and privacy, with its words', await page.evaluate(() => { const l = document.querySelector('input[data-key="mods.blocklist"]').closest('label'); return !!l.closest('[data-editor-section="backup/privacy"]') && /blocklist/i.test(l.textContent) && /Nothing about you is sent/.test(l.textContent); }));

    // 2. No mod installed: opening the editor asks nothing.
    await serve(sign(list(1)));
    await editor();
    await sleep(1200);
    check('no request while no mod is installed', (await asked()).length === 0, JSON.stringify(await asked()));

    // 3. A mod installed: opening the editor asks once, with a bare GET; the mod the list names is stopped, the other left.
    await page.evaluate(([a, b]) => chrome.storage.local.set({ mods: [a.id, b.id], [`mod:${a.id}`]: a, [`mod:${b.id}`]: b }), [record(BAD), record(OTHER)]);
    await editor();
    const first = await until(async () => (await local('modsBlocklist')).modsBlocklist);
    check('the list is verified (Ed25519 in Chrome) and kept', first?.seq === 1 && first.list.mods[0] === BAD, JSON.stringify(first));
    const req = await asked();
    check('exactly one request, to the blocklist address', req.length === 1 && req[0].url === 'https://frostdev.io/glaze/mods/api/blocklist', JSON.stringify(req));
    check('a bare GET: no credentials, no referrer, no-cache, no redirects, no body or headers', JSON.stringify(req[0]?.init) === JSON.stringify({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache', redirect: 'error', signal: 'object' }), JSON.stringify(req[0]?.init));
    const recs = await local([`mod:${BAD}`, `mod:${OTHER}`]);
    check('the named mod is stopped, with the reason', recs[`mod:${BAD}`].enabled === false && recs[`mod:${BAD}`].blocked === 'Sends grades to a third party.', JSON.stringify(recs[`mod:${BAD}`]));
    check('the other mod is left running', recs[`mod:${OTHER}`].enabled === true && !('blocked' in recs[`mod:${OTHER}`]));
    check('the worker answers blocked(record) from the stored list', await (await worker()).evaluate(async ([a, b]) => [await blocked(a), await blocked(b)], [{ id: BAD }, { id: OTHER }]).then((r) => r[0] === 'Sends grades to a third party.' && r[1] === ''));

    // 4. Within the day: opening the editor again asks nothing.
    await editor();
    await sleep(1200);
    check('a second check within the day makes no request', (await asked()).length === 1, JSON.stringify(await asked()));

    // 5. A list that was tampered with after signing is refused, and changes nothing. The check is due again.
    const stamp = async () => page.evaluate(() => chrome.storage.local.remove(['modsBlocklistTried']));
    await page.evaluate(() => chrome.storage.local.get('modsBlocklist').then(({ modsBlocklist }) => chrome.storage.local.set({ modsBlocklist: { ...modsBlocklist, checkedAt: modsBlocklist.checkedAt - 2 * 864e5 } })));
    const forged = sign(list(2, { mods: [OTHER], reasons: {} }));
    forged.list.mods = [BAD, OTHER];
    await serve(forged);
    await stamp();
    await editor();
    await until(async () => (await asked()).length === 1);
    await sleep(500);
    const after = await local(['modsBlocklist', `mod:${OTHER}`, 'modsBlocklistTried']);
    check('a tampered list is asked for and refused: same seq kept, the other mod still running', after.modsBlocklist.seq === 1 && after[`mod:${OTHER}`].enabled === true && typeof after.modsBlocklistTried === 'number', JSON.stringify(after));

    // 6. A newer, genuine list that also names the other mod stops it.
    await serve(sign(list(2, { mods: [BAD, OTHER], reasons: { [OTHER]: 'Loads code from elsewhere.' } })));
    await stamp();
    await editor();
    const second = await until(async () => { const r = await local(['modsBlocklist', `mod:${OTHER}`]); return r.modsBlocklist?.seq === 2 && r; });
    check('a higher seq replaces the list and stops the second mod', second && second[`mod:${OTHER}`].enabled === false && second[`mod:${OTHER}`].blocked === 'Loads code from elsewhere.', JSON.stringify(second));

    // 7. The switch off: due again, but nothing is asked.
    await page.evaluate(() => { const el = document.querySelector('input[data-key="mods.blocklist"]'); el.click(); });
    await until(async () => (await sync('mods')).mods?.blocklist === false);
    check('turning the switch off is saved', (await sync('mods')).mods?.blocklist === false);
    await serve(sign(list(3)));
    await page.evaluate(() => chrome.storage.local.get('modsBlocklist').then(({ modsBlocklist }) => chrome.storage.local.set({ modsBlocklist: { ...modsBlocklist, checkedAt: modsBlocklist.checkedAt - 2 * 864e5 } })));
    await stamp();
    await editor();
    await sleep(1200);
    check('the switch is still off after reopening, and with it off nothing is asked', await box() === false && (await asked()).length === 0, JSON.stringify(await asked()));
    check('blocks already made stand with the switch off', await (await worker()).evaluate(async () => blocked({ id: 'bbbbbbbbbbbbbbbb' })) === 'Loads code from elsewhere.');
    await page.evaluate(() => document.querySelector('input[data-key="mods.blocklist"]').click());
    await until(async () => (await sync('mods')).mods?.blocklist === true);

    // 8. A restarted worker loads blocklist.js on demand (cached when the extension was installed) and runs the check. Its
    // real fetch finds no network here, which is a failed try, recorded.
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await sleep(500);
    await stamp();
    await page.evaluate(() => chrome.storage.local.get('modsBlocklist').then(({ modsBlocklist }) => chrome.storage.local.set({ modsBlocklist: { ...modsBlocklist, checkedAt: modsBlocklist.checkedAt - 2 * 864e5 } })));
    await editor();
    const tried = await until(async () => (await local('modsBlocklistTried')).modsBlocklistTried);
    check('after a worker restart the check still runs (blocklist.js loaded on demand); offline it is a failed try', typeof tried === 'number');
    check('and the stored list is untouched by it', (await local('modsBlocklist')).modsBlocklist.seq === 2);
    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await context?.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
