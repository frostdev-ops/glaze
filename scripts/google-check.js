// Google sign-in for Drive and the Picker hand-off, headless, in the real extension (a staged copy) with its real worker
// and Settings page. One stand-in answers for Google (accounts.google.com's implicit flow, userinfo, revoke) and for the
// picker pages (frostdev.io's and its GitHub Pages copy), through Playwright's route() and, for what route() can't see
// (Chrome loads launchWebAuthFlow's page in a WebContents of its own), through a local HTTPS server those hosts resolve to;
// every other host is refused. Each request is logged with which of the two served it. The worker's config is given
// stand-in ids (the shipped one is placeholders, which hide the row: checked first). The staged manifest holds identity
// (headless can't answer the permission prompt): the page's request is recorded and answered yes, and the worker's
// permissions.remove is recorded.
//   web flow: Connect from the click, the real launchWebAuthFlow through the stand-in, the row with the account; a reply
//     for another state refused; Pick with frostdev.io down goes to the copy, the token and state in the fragment only, the
//     files back; with frostdev.io up it goes there; Disconnect revokes, gives identity back, the row returns to Connect.
//   chrome flow: getAuthToken (the check's stand-in for Chrome's account) with the three scopes.
//   No token in storage.local, sync or session at any point.
//   NODE_PATH=<installed playwright> nice node scripts/google-check.js [evidence directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const env = require('./check-env.js');

const SHIPPED = require('../lib/google-config.js');
const CHROME_CLIENT = SHIPPED.chrome;
const ext = env.staged(process.env.EXT || path.join(__dirname, '..'), []);
{
  const file = path.join(ext, 'manifest.json'), m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.permissions = [...m.permissions, 'identity'];
  m.optional_permissions = m.optional_permissions.filter((p) => p !== 'identity');
  m.oauth2 = { client_id: CHROME_CLIENT, scopes: require('../lib/google-config.js').scopes };
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
  // Drive's build-time switch on in this copy only, as scripts/dev-drive.sh does (the staged file is a link: replaced, not edited).
  const g = path.join(ext, 'lib/google.js'), src = fs.readFileSync(g, 'utf8');
  if (!src.includes('\n  const ON = false;\n')) throw new Error('lib/google.js: no ON switch');
  fs.rmSync(g);
  fs.writeFileSync(g, src.replace('\n  const ON = false;\n', '\n  const ON = true;\n'));
}
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const REDIRECT = `https://${id}.chromiumapp.org/`;
const REAL = { chrome: SHIPPED.chrome, web: SHIPPED.web, ios: SHIPPED.ios, apiKey: SHIPPED.apiKey, appId: SHIPPED.appId };
const BLANK = { chrome: 'PLACEHOLDER-chrome.apps.googleusercontent.com', web: 'PLACEHOLDER-web.apps.googleusercontent.com', ios: 'PLACEHOLDER-ios.apps.googleusercontent.com', apiKey: 'PLACEHOLDER', appId: 'PLACEHOLDER' };
const PICKER = require('../lib/google-config.js').picker;
const DRIVE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN = 'ya29.check-web-token';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-google-'));
const out = path.resolve(process.argv[2] || path.join(tmp, 'shots'));
fs.mkdirSync(out, { recursive: true });
let checks = 0;
const ok = (value, label) => { if (!value) throw new Error(`FAIL ${label}`); checks++; console.log(`ok   ${label}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${label}`); await pause(100); } };

// The stand-in picker page: the contract of glaze-plans' drive-picker (fragment in, the state and files back). It reports
// what it was handed in the file's name, so the check reads it from what comes back.
const pickerPage = `<!doctype html><script>
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
  const seen = [p.get('access_token') === ${JSON.stringify(TOKEN)}, p.get('key') === ${JSON.stringify(REAL.apiKey)}, p.get('app_id') === ${JSON.stringify(REAL.appId)}, location.search === ''].join(',');
  location.replace(p.get('redirect_uri') + '#' + new URLSearchParams({ state: p.get('state'), action: 'picked', files: JSON.stringify([{ id: '1AbC_d-EfGh', name: seen + '@' + location.host, mimeType: 'application/pdf' }]) }));
</script>`;

// The stand-in, for route() and the server alike: { method, url, headers, body } → { status, headers, body }, or null to
// refuse the connection (frostdev.io while it's down, and anything not named here).
const log = { auth: [], userinfo: [], revoke: [], picker: [], other: [] };
const google = { stray: false, frostdev: false };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, HEAD, POST' };
const answer = ({ method, url, headers, body }, via) => {
  const u = new URL(url);
  const base = PICKER.find((p) => u.href.startsWith(p));
  if (method === 'OPTIONS') return base && base === PICKER[0] && !google.frostdev ? null : { status: 204, headers: CORS, body: '' };
  if (u.origin === 'https://accounts.google.com' && u.pathname === '/o/oauth2/v2/auth') {
    const q = Object.fromEntries(u.searchParams);
    log.auth.push({ ...q, via });
    const state = google.stray ? 'not-glaze-s-state' : q.state;
    return { status: 302, headers: { location: `${q.redirect_uri}#${new URLSearchParams({ access_token: TOKEN, token_type: 'Bearer', expires_in: '3599', scope: `email openid ${DRIVE}`, state })}` }, body: '' };
  }
  if (u.href === 'https://openidconnect.googleapis.com/v1/userinfo') {
    log.userinfo.push([headers.authorization, via]);
    return { status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ sub: '42', email: 'student@school.edu', email_verified: true }) };
  }
  if (u.href === 'https://oauth2.googleapis.com/revoke') {
    log.revoke.push([method, body, via]);
    return { status: 200, headers: CORS, body: '' };
  }
  if (base) {
    log.picker.push([method, u.origin, u.search, via]);
    if (base === PICKER[0] && !google.frostdev) return null;
    return { status: 200, headers: { ...CORS, 'content-type': 'text/html' }, body: method === 'HEAD' ? '' : pickerPage };
  }
  // Chromium's own account check (its browser sign-in), now that accounts.google.com resolves here: the browser's, not Glaze's.
  if (u.origin === 'https://accounts.google.com' && u.pathname === '/ListAccounts' && u.searchParams.get('source') === 'ChromiumBrowser') return null;
  if (u.href === 'https://school.instructure.com/embed') return { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body></body></html>' };
  log.other.push(`${via} ${u.href}`);
  return null;
};
const HOSTS = ['accounts.google.com', 'openidconnect.googleapis.com', 'oauth2.googleapis.com', ...PICKER.map((p) => new URL(p).hostname)];

(async () => {
  let ctx, server;
  const errors = [];
  try {
    // The server's certificate: made here, for this run; the browser is told to accept it (--ignore-certificate-errors).
    const { execFileSync } = require('node:child_process');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem'), '-days', '1', '-subj', '/CN=glaze-google-check'], { stdio: 'ignore' });
    server = require('node:https').createServer({ key: fs.readFileSync(path.join(tmp, 'key.pem')), cert: fs.readFileSync(path.join(tmp, 'cert.pem')) }, (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const a = answer({ method: req.method, url: `https://${req.headers.host.replace(/:\d+$/, '')}${req.url}`, headers: req.headers, body: Buffer.concat(chunks).toString() }, 'server');
        if (!a) return req.socket.destroy();
        res.writeHead(a.status, a.headers);
        res.end(a.body);
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const rules = [...HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`), 'MAP * ~NOTFOUND'].join(', ');
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US', reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--host-resolver-rules=${rules}`, '--ignore-certificate-errors', '--disable-background-networking', '--renderer-process-limit=1'] });
    env.noFirstRun(ctx);
    await ctx.route('**/*', async (route) => {
      const r = route.request(), u = new URL(r.url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.hostname.endsWith('.chromiumapp.org')) return route.abort(); // Chrome's auth flow takes the address before it loads
      const a = answer({ method: r.method(), url: r.url(), headers: r.headers(), body: r.postData() || '' }, 'route');
      return a ? route.fulfill({ status: a.status, headers: a.headers, body: a.body }) : route.abort('connectionrefused');
    });
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith(`chrome-extension://${id}/`) });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/options.html`);
    await env.installed(page);
    // Every token the stand-ins hand out, looked for in all three storage areas.
    const noToken = async (label) => {
      const all = await page.evaluate(async () => JSON.stringify(await Promise.all(['local', 'sync', 'session'].map((a) => chrome.storage[a].get(null)))));
      ok(!all.includes(TOKEN) && !all.includes('ya29.check-chrome-token'), `${label}: no token in storage.local, sync or session`);
    };
    const row = page.locator('#gdrive');
    // A fresh Settings each time (a goto to the same address and hash would only move to the fragment).
    const open = async () => {
      await page.goto('about:blank');
      await page.goto(`chrome-extension://${id}/options.html#writer/papers`);
      await page.evaluate(() => {
        globalThis.__gz = { asked: [] };
        chrome.permissions.request = (o) => { __gz.asked.push([o.permissions, navigator.userActivation.isActive]); return Promise.resolve(true); };
      });
    };

    // The shipped config: Glaze's clients. The row offers Connect, and nothing reaches Google before a click.
    await open();
    ok(await until(() => sw.evaluate(() => typeof GZ_GOOGLE_CONFIG === 'object' && typeof google === 'object' && google !== null), 'Settings asked the worker'), 'Settings asks the worker for Drive\'s status');
    await until(() => row.isVisible(), 'the row, shipped config');
    ok(await page.locator('#gdrive-connect').isVisible() && (await page.locator('#gdrive-who').textContent()) === '', 'the shipped config: Settings offers Connect for Google Drive');
    ok(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:google', op: 'status' })).then((s) => s.ok && s.flow === 'chrome'), 'Chromium with the store client signs in with getAuthToken');

    // Placeholders: no row.
    await sw.evaluate((c) => Object.assign(GZ_GOOGLE_CONFIG, c), BLANK);
    await open();
    await pause(300);
    ok(await row.isHidden(), 'placeholders: Settings shows no Google Drive row');
    ok(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:google', op: 'status' })).then((s) => s.why === 'setup'), 'and the worker says why: setup');
    ok(log.auth.length + log.userinfo.length + log.picker.length === 0, 'and nothing reached Google or the picker');

    // ---- web flow: the Chrome client left a placeholder, so this Chromium signs in as Edge and Brave do ----
    await sw.evaluate((c) => Object.assign(GZ_GOOGLE_CONFIG, c), { ...REAL, chrome: 'PLACEHOLDER-chrome.apps.googleusercontent.com' });
    // Worker stand-in for removing the required identity of this staged copy: recorded.
    await sw.evaluate(() => { globalThis.__gzRemoved = []; const P = chrome.permissions, remove = P.remove.bind(P); P.remove = (o) => (o.permissions?.includes('identity') ? (__gzRemoved.push(o), Promise.resolve(true)) : remove(o)); });
    await open();
    await until(() => row.isVisible(), 'the row');
    ok(await page.locator('#gdrive-connect').isVisible() && await page.locator('#gdrive-disconnect').isHidden() && (await page.locator('#gdrive-who').textContent()) === '', 'set up: the row offers Connect, off until connected');
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'google-1-connect.png') });

    google.stray = true;
    await page.locator('#gdrive-connect').click();
    await until(async () => (await page.locator('#hint').textContent()).includes("didn't connect"), 'refused');
    ok(log.auth.length === 1, 'a reply for another state: Google was asked once');
    ok(await page.locator('#gdrive-connect').isVisible() && !await page.evaluate(() => chrome.storage.local.get('google').then((r) => r.google)), 'and refused: nothing kept, Connect still offered');
    ok(log.userinfo.length === 0, 'the stray token was never used');
    google.stray = false;

    await page.locator('#gdrive-connect').click();
    await until(async () => (await page.locator('#gdrive-who').textContent()) === 'student@school.edu', 'connected');
    const q = log.auth.at(-1);
    ok(q.client_id === REAL.web && q.response_type === 'token' && q.redirect_uri === REDIRECT && q.scope === `${DRIVE} openid email` && /^[\w-]{43}$/.test(q.state) && q.prompt === 'select_account', 'Connect: the Web client\'s implicit flow, our redirect, the three scopes, a state');
    ok(JSON.stringify(await page.evaluate(() => __gz.asked)) === JSON.stringify([[['identity'], true], [['identity'], true]]), 'each Connect asks for identity alone, inside the click');
    ok(log.userinfo.at(-1)[0] === `Bearer ${TOKEN}`, 'the account is read with the token');
    ok(await page.locator('#gdrive-disconnect').isVisible() && await page.locator('#gdrive-connect').isHidden(), 'connected: the account and Disconnect');
    const saved = await page.evaluate(() => chrome.storage.local.get('google').then((r) => r.google));
    ok(JSON.stringify(Object.keys(saved).sort()) === '["at","email","flow","sub"]' && saved.flow === 'web' && saved.sub === '42', 'storage.local google: the account (its email and Google id), the flow and when');
    await noToken('connected');
    await page.screenshot({ path: path.join(out, 'google-2-connected.png') });

    // No Picker key: Pick alone says setup, and no picker page is asked.
    await sw.evaluate(() => { GZ_GOOGLE_CONFIG.apiKey = 'PLACEHOLDER'; });
    ok(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:google', op: 'pick' })).then((x) => x.ok === false && x.why === 'setup'), 'without the Picker key, Pick says setup');
    ok(log.picker.length === 0 && !await row.isHidden(), 'and nothing is probed; the account stays connected');
    await sw.evaluate((k) => { GZ_GOOGLE_CONFIG.apiKey = k; }, REAL.apiKey);

    // Pick, frostdev.io down: its copy on GitHub Pages.
    const pick = () => page.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:google', op: 'pick' }));
    let r = await pick();
    ok(r.ok && r.files.length === 1 && r.files[0].id === '1AbC_d-EfGh' && r.files[0].mimeType === 'application/pdf', `Pick: the file comes back (${JSON.stringify(r)})`);
    ok(r.files[0].name === `true,true,true,true@${new URL(PICKER[1]).host}`, 'from the GitHub Pages copy, handed the token, key and project in the fragment, nothing in the query');
    ok(JSON.stringify(log.picker.slice(0, 2).map(([m, o]) => [m, o])) === JSON.stringify([['HEAD', 'https://frostdev.io'], ['HEAD', 'https://frostdev-ops.github.io']]), 'frostdev.io probed first, then its copy');
    ok(log.picker.every(([, , search]) => search === ''), 'no picker request carries a query');
    google.frostdev = true;
    log.picker.length = 0;
    r = await pick();
    ok(r.ok && r.files[0].name.endsWith('@frostdev.io'), 'with frostdev.io up, the picker is frostdev.io\'s');
    ok(log.picker.every(([, origin]) => origin === 'https://frostdev.io'), 'and its copy isn\'t asked');
    ok(log.auth.length === 2, 'the held token served both picks: no new sign-in');
    await noToken('after picking');

    // A Disconnect the worker didn't carry out is no Disconnect.
    await sw.evaluate(() => { globalThis.__gzDisconnect = google.disconnect; google.disconnect = async () => ({ ok: false, why: 'network' }); });
    await page.locator('#gdrive-disconnect').click();
    await until(async () => (await page.locator('#hint').textContent()).includes("Couldn't disconnect"), 'failed disconnect');
    ok(await page.locator('#hint').evaluate((h) => h.classList.contains('err')), 'a failed Disconnect says so, as an error');
    ok(await page.locator('#gdrive-disconnect').isVisible() && (await page.locator('#gdrive-who').textContent()) === 'student@school.edu', 'and the account and Disconnect stay');
    await sw.evaluate(() => { google.disconnect = __gzDisconnect; });

    // Disconnect.
    await page.locator('#gdrive-disconnect').click();
    await until(async () => await page.locator('#gdrive-connect').isVisible(), 'disconnected');
    ok(JSON.stringify(log.revoke.map(([m, b]) => [m, b])) === JSON.stringify([['POST', `token=${encodeURIComponent(TOKEN)}`]]), 'Disconnect revokes the token with Google');
    ok(await sw.evaluate(() => JSON.stringify(__gzRemoved)) === JSON.stringify([{ permissions: ['identity'] }]), 'and gives identity back');
    ok(!await page.evaluate(() => chrome.storage.local.get('google').then((x) => x.google)) && (await page.locator('#gdrive-who').textContent()) === '', 'and forgets the account: Connect again');
    ok((await page.locator('#hint').textContent()) === 'Disconnected.', 'Disconnected.');
    ok(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:google', op: 'pick' })).then((x) => x.why === 'connect'), 'Pick after Disconnect: not connected');
    await page.screenshot({ path: path.join(out, 'google-3-disconnected.png') });

    // ---- chrome flow: the manifest's client is the config's, so this Chromium uses getAuthToken (the check's stand-in) ----
    await sw.evaluate((c) => {
      Object.assign(GZ_GOOGLE_CONFIG, c);
      globalThis.__gzAuth = [];
      chrome.identity.getAuthToken = async (d) => { __gzAuth.push(d); return { token: 'ya29.check-chrome-token', grantedScopes: d.scopes }; };
      chrome.identity.removeCachedAuthToken = async () => {};
    }, REAL);
    await open();
    await until(() => row.isVisible(), 'the row, chrome flow');
    const before = log.auth.length;
    await page.locator('#gdrive-connect').click();
    await until(async () => (await page.locator('#gdrive-who').textContent()) === 'student@school.edu', 'connected, chrome flow');
    ok(await sw.evaluate(() => JSON.stringify(__gzAuth[0])) === JSON.stringify({ interactive: true, scopes: [DRIVE, 'openid', 'email'] }), 'Chrome: getAuthToken, interactive, for exactly the three scopes');
    ok(log.auth.length === before && log.userinfo.at(-1)[0] === 'Bearer ya29.check-chrome-token', 'and no web flow');
    await noToken('chrome flow');
    await page.locator('#gdrive-disconnect').click();
    await until(async () => await page.locator('#gdrive-connect').isVisible(), 'disconnected, chrome flow');
    ok(log.revoke.at(-1)[1] === 'token=ya29.check-chrome-token', 'Disconnect revokes Chrome\'s token');

    // Settings framed in a school's page with no permissions API (Firefox gives such a frame none): Connect asks nothing
    // there and opens Settings' own tab at Writer → Papers.
    const lms = await ctx.newPage();
    lms.on('pageerror', (e) => errors.push(`lms: ${e}`));
    await lms.addInitScript(() => {
      if (location.protocol !== 'chrome-extension:') return;
      Object.defineProperty(chrome, 'permissions', { value: undefined, configurable: true });
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.__gzSent = [];
      chrome.runtime.sendMessage = (m, ...a) => { __gzSent.push(m); return send(m, ...a); };
    });
    await lms.goto('https://school.instructure.com/embed');
    const tabId = await sw.evaluate(() => chrome.tabs.query({ url: 'https://school.instructure.com/embed' }).then((t) => t[0].id));
    const ticket = await sw.evaluate(async (tabId) => {
      const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => chrome.runtime.sendMessage({ type: 'glaze:settings-ticket' }) });
      return r.result.ticket;
    }, tabId);
    await lms.evaluate((url) => { const f = document.createElement('iframe'); f.src = url; f.style.cssText = 'width:1200px;height:850px'; document.body.append(f); }, `chrome-extension://${id}/options.html?t=${ticket}#writer/papers`);
    const frame = await until(async () => lms.frames().find((f) => f.url().includes('/options.html')), 'embedded Settings');
    await until(() => frame.evaluate(() => document.documentElement.hasAttribute('data-embed-ok')), 'claimed frame');
    ok(await frame.evaluate(() => typeof chrome.permissions?.request !== 'function'), 'the frame has no permissions API, as Firefox gives it');
    await until(() => frame.locator('#gdrive').isVisible(), 'the row, framed');
    const tabs = ctx.pages().length, asked = log.auth.length;
    await frame.locator('#gdrive-connect').click();
    const own = await until(async () => ctx.pages().find((p) => p !== page && p.url().startsWith(`chrome-extension://${id}/options.html`) && p.url().endsWith('#writer/papers')), 'Settings\' own tab');
    ok(ctx.pages().length > tabs && own, 'framed Connect opens Settings in its own tab, at Writer → Papers');
    const sent = await frame.evaluate(() => __gzSent.map((m) => [m.type, m.op || m.hash])).catch(() => null);
    ok(!sent || !sent.some(([type, op]) => type === 'glaze:google' && op === 'connect'), 'and asks the worker for no sign-in from the frame');
    ok(log.auth.length === asked, 'nothing reached Google');
    await own.close();
    await lms.close();

    // Safari's native flow, the worker's answers stood in for: Settings asks for no identity permission (Safari has none), and
    // asks again while the app's sign-in is pending.
    await sw.evaluate(() => {
      globalThis.__gzNative = { status: google.status, connect: google.connect, connects: 0 };
      google.status = async () => ({ ok: true, flow: 'native', email: __gzNative.connects >= 3 ? 'student@icloud.com' : null });
      google.connect = async () => (++__gzNative.connects < 3 ? { ok: false, why: 'pending' } : { ok: true, email: 'student@icloud.com' });
    });
    await open();
    await until(() => row.isVisible(), 'the row, native');
    await page.locator('#gdrive-connect').click();
    await until(async () => (await page.locator('#gdrive-who').textContent()) === 'student@icloud.com', 'connected, native', 30000);
    ok(await sw.evaluate(() => __gzNative.connects) === 3, 'native: Settings asks again while the sign-in is pending, until it\'s done');
    ok(JSON.stringify(await page.evaluate(() => __gz.asked)) === '[]', 'and asks for no identity permission');
    ok(!(await page.locator('#hint').textContent()).includes("didn't connect"), 'and shows no failure while it waits');
    await sw.evaluate(() => { google.status = __gzNative.status; google.connect = __gzNative.connect; });

    // Who may ask: a page Glaze doesn't trust for this (the pop-up) is refused.
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    ok(await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:google', op: 'connect' })).then((x) => x.why === 'sender'), 'the pop-up can\'t connect');
    await popup.close();

    ok(log.other.length === 0, `no other address asked (${log.other.join(' ')})`);
    ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    const via = (rows, at) => [...new Set(rows.map(at))].join('+');
    console.log(`served by: auth ${via(log.auth, (x) => x.via)}, userinfo ${via(log.userinfo, (x) => x[1])}, revoke ${via(log.revoke, (x) => x[2])}, picker ${via(log.picker, (x) => x[3])}`);
    console.log(`${checks} checks passed; screenshots in ${out}`);
  } catch (e) {
    console.error(e.stack || String(e));
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    await new Promise((r) => (server ? server.close(r) : r()));
    fs.rmSync(out.startsWith(`${tmp}${path.sep}`) ? path.join(tmp, 'profile') : tmp, { recursive: true, force: true });
  }
})();
